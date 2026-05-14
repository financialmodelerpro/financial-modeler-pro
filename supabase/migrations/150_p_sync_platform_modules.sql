-- ============================================================================
-- Phase P-Sync: Platform & Module Admin Sync (single source of truth)
-- ============================================================================
-- Adds two new tables alongside the existing `modules` table (which stores
-- platforms like REFM / BVM / FPA, despite its legacy name):
--
--   platform_modules        - per-platform modules (Module 1..N within REFM)
--   platform_module_pages   - marketing CMS content per module (hero / features
--                              / how_it_works / cta / testimonials sections)
--
-- Existing `modules` table is treated as the platforms-storage table and not
-- modified by this migration. The codebase pre-dates the platforms / modules
-- distinction; renaming the legacy table would break every downstream admin
-- API. Future cleanup may rename it.
--
-- Seed data populates the 11 REFM modules at their M2.0i state, and Module 1
-- page content matching the current capability surface.
--
-- Idempotent: safe to run multiple times. CREATE TABLE IF NOT EXISTS, INSERT
-- ON CONFLICT DO NOTHING.
-- ============================================================================

-- ── Cleanup: re-key any prior 'refm' rows to 'real-estate' ─────────────────
-- A pre-fix run of this migration seeded with platform_slug='refm', which
-- doesn't match the legacy modules.slug='real-estate'. Any such rows are
-- orphans for the admin UI; re-key them in place so the seed below uses
-- ON CONFLICT cleanly.
DO $$
BEGIN
    IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema='public' AND table_name='platform_modules') THEN
        UPDATE public.platform_modules SET platform_slug = 'real-estate' WHERE platform_slug = 'refm';
    END IF;
END $$;

-- ── platform_modules ───────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.platform_modules (
    id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    platform_slug   text NOT NULL,                     -- 'real-estate', 'business-valuation', etc. (FK by slug to modules.slug)
    slug            text NOT NULL,                     -- 'project-setup', 'revenue', etc.
    number          integer NOT NULL,                  -- 1..N display number
    name            text NOT NULL,                     -- 'Module 1: Project Setup'
    short_name      text NOT NULL,                     -- 'Setup' (sidebar)
    description     text NOT NULL DEFAULT '',
    icon_url        text,
    icon_emoji      text,                              -- '🧱' fallback when icon_url empty
    status          text NOT NULL DEFAULT 'coming_soon'
                    CHECK (status IN ('live', 'coming_soon', 'hidden', 'pro', 'enterprise')),
    gating_tier     text NOT NULL DEFAULT 'free'
                    CHECK (gating_tier IN ('free', 'pro', 'enterprise')),
    display_order   integer NOT NULL DEFAULT 0,
    features        jsonb NOT NULL DEFAULT '[]'::jsonb,
    screenshots     jsonb NOT NULL DEFAULT '[]'::jsonb,
    demo_video_url  text,
    launch_date     date,
    created_at      timestamptz NOT NULL DEFAULT now(),
    updated_at      timestamptz NOT NULL DEFAULT now(),
    UNIQUE (platform_slug, slug),
    UNIQUE (platform_slug, number)
);

CREATE INDEX IF NOT EXISTS idx_platform_modules_platform_slug
    ON public.platform_modules (platform_slug);

CREATE INDEX IF NOT EXISTS idx_platform_modules_status
    ON public.platform_modules (status);

-- updated_at trigger
CREATE OR REPLACE FUNCTION public.tg_platform_modules_touch_updated_at()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = now();
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS platform_modules_touch_updated_at ON public.platform_modules;
CREATE TRIGGER platform_modules_touch_updated_at
    BEFORE UPDATE ON public.platform_modules
    FOR EACH ROW EXECUTE FUNCTION public.tg_platform_modules_touch_updated_at();

-- ── platform_module_pages ─────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.platform_module_pages (
    id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    module_id       uuid NOT NULL REFERENCES public.platform_modules(id) ON DELETE CASCADE,
    page_section    text NOT NULL
                    CHECK (page_section IN ('hero', 'features', 'how_it_works', 'cta', 'testimonials')),
    display_order   integer NOT NULL DEFAULT 0,
    content_blocks  jsonb NOT NULL DEFAULT '{}'::jsonb,
    visible         boolean NOT NULL DEFAULT true,
    created_at      timestamptz NOT NULL DEFAULT now(),
    updated_at      timestamptz NOT NULL DEFAULT now(),
    UNIQUE (module_id, page_section)
);

CREATE INDEX IF NOT EXISTS idx_platform_module_pages_module
    ON public.platform_module_pages (module_id);

DROP TRIGGER IF EXISTS platform_module_pages_touch_updated_at ON public.platform_module_pages;
CREATE TRIGGER platform_module_pages_touch_updated_at
    BEFORE UPDATE ON public.platform_module_pages
    FOR EACH ROW EXECUTE FUNCTION public.tg_platform_modules_touch_updated_at();

-- ── RLS: public read, admin write ─────────────────────────────────────────
ALTER TABLE public.platform_modules        ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.platform_module_pages   ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS platform_modules_public_read ON public.platform_modules;
CREATE POLICY platform_modules_public_read
    ON public.platform_modules
    FOR SELECT
    USING (status <> 'hidden');

-- Service role bypasses RLS, so admin API writes always work via service-role
-- client. No write policy needed for anonymous role.

DROP POLICY IF EXISTS platform_module_pages_public_read ON public.platform_module_pages;
CREATE POLICY platform_module_pages_public_read
    ON public.platform_module_pages
    FOR SELECT
    USING (visible = true);

-- ── Seed: 11 REFM modules at M2.0i state ──────────────────────────────────
INSERT INTO public.platform_modules
    (platform_slug, slug, number, name, short_name, description, icon_emoji, status, gating_tier, display_order, features)
VALUES
    ('real-estate', 'project-setup', 1, 'Module 1: Project Setup', 'Setup',
     'Define project structure, land allocation, costs, and financing on a foundation built for institutional real estate financial modeling.',
     '🧱', 'live', 'free', 1,
     '[
        "Project hierarchy: Project to Phases to Assets to Sub-units",
        "14 project types from Residential to Data Center to Marina",
        "MAAD-spec accounting with Sell, Operate, Lease, and Sell + Manage strategies",
        "NSA / BUA / GFA area hierarchy with custom cost rates per sub-unit",
        "Multi-parcel land allocation with optional NDA deduction",
        "Per-asset cost lines with 13+ calculation methods and 6 phasing curves",
        "Annual inputs with flexible Annual / Quarterly / Monthly output reporting",
        "Operational phase support with historical baseline and run-rate forward operations",
        "Capitalization rules respecting accounting standards (COGS for sold assets, Fixed Assets for retained)",
        "Land in-kind equity contribution treatment"
     ]'::jsonb),

    ('real-estate', 'revenue', 2, 'Module 2: Revenue', 'Revenue',
     'Cohort-based sales collection, hospitality USAH revenue, retail NOI, and Sell + Manage management fees layered on Module 1 asset structure.',
     '💰', 'coming_soon', 'free', 2,
     '[
        "Cohort sales schedules with escrow and milestone collection",
        "Hospitality USAH (occupancy, ADR, RevPAR, F&B contribution)",
        "Retail and office NOI with rent escalations",
        "Sell + Manage: management fee revenue post-handover",
        "Annual revenue inputs with flexible output granularity"
     ]'::jsonb),

    ('real-estate', 'opex', 3, 'Module 3: OpEx', 'OpEx',
     'Operating expenses, payroll, marketing, and fixed-cost schedules driving cash flow over the operations window.',
     '📉', 'coming_soon', 'free', 3,
     '[
        "Per-asset OpEx schedules with category breakdown",
        "Fixed and variable cost split with revenue-driven scaling",
        "Inflation indexation per category",
        "Net Operating Income (NOI) computation"
     ]'::jsonb),

    ('real-estate', 'financials', 4, 'Module 4: Financials', 'Financials',
     'Three-statement model: P&L, cash flow, and balance sheet with capitalization respecting Module 1 accounting rules.',
     '📑', 'coming_soon', 'free', 4,
     '[
        "GAAP / IFRS three-statement model",
        "Capex flowing to COGS or Fixed Assets per asset strategy",
        "Land never depreciates, stays at cost on balance sheet",
        "Operational phase opening balances from historical baseline"
     ]'::jsonb),

    ('real-estate', 'returns', 5, 'Module 5: Returns', 'Returns',
     'IRR, NPV, MoIC, DSCR, equity multiples, and stabilised yield analysis.',
     '📈', 'coming_soon', 'free', 5,
     '[
        "Levered and unlevered IRR / NPV",
        "MoIC and equity multiple",
        "DSCR sensitivity",
        "Stabilised yield on cost"
     ]'::jsonb),

    ('real-estate', 'reports', 6, 'Module 6: Reports', 'Reports',
     'Investment committee deck, lender package, and portfolio one-pager with PDF export.',
     '📑', 'coming_soon', 'free', 6,
     '[
        "IC deck PDF export",
        "Lender package with debt service schedules",
        "Portfolio one-pager",
        "Custom report builder"
     ]'::jsonb),

    ('real-estate', 'scenarios', 7, 'Module 7: Scenarios', 'Scenarios',
     'Side-by-side scenario comparison with toggle assumptions and sensitivity tables.',
     '🔀', 'coming_soon', 'free', 7,
     '[
        "Side-by-side base / upside / downside",
        "One-variable and two-variable sensitivity tables",
        "Tornado charts on key drivers"
     ]'::jsonb),

    ('real-estate', 'portfolio', 8, 'Module 8: Portfolio', 'Portfolio',
     'Roll-up across multiple projects with consolidated returns and waterfall.',
     '🗂', 'coming_soon', 'free', 8,
     '[
        "Multi-project roll-up",
        "Consolidated returns",
        "Sponsor / LP waterfall"
     ]'::jsonb),

    ('real-estate', 'market-data', 9, 'Module 9: Market Data', 'Market Data',
     'Live market comps, Saudi-specific data layer, and AI-driven assumption suggestions.',
     '🧭', 'coming_soon', 'free', 9,
     '[
        "Saudi market comps (rents, sale prices, occupancy)",
        "AI assumption suggestions",
        "Cap rate library"
     ]'::jsonb),

    ('real-estate', 'collaborate', 10, 'Module 10: Collaborate', 'Collaborate',
     'Multi-user editing, comments, and approval workflows for IC and lender review.',
     '👥', 'pro', 'pro', 10,
     '[
        "Multi-user concurrent editing",
        "In-cell comments and threads",
        "IC approval workflow",
        "Version compare across users"
     ]'::jsonb),

    ('real-estate', 'api-access', 11, 'Module 11: API Access', 'API Access',
     'Programmatic access to your models for portfolio dashboards and downstream BI integration.',
     '🔌', 'enterprise', 'enterprise', 11,
     '[
        "REST API for project state",
        "Webhook events on save / version",
        "Bulk export to BI tools",
        "Custom integrations"
     ]'::jsonb)
ON CONFLICT (platform_slug, slug) DO NOTHING;

-- ── Seed: Module 1 page content (hero / features / how_it_works / cta) ────
DO $$
DECLARE
    m1_id uuid;
BEGIN
    SELECT id INTO m1_id FROM public.platform_modules
        WHERE platform_slug = 'real-estate' AND slug = 'project-setup' LIMIT 1;
    IF m1_id IS NULL THEN RETURN; END IF;

    INSERT INTO public.platform_module_pages (module_id, page_section, display_order, content_blocks, visible)
    VALUES
        (m1_id, 'hero', 1,
         '{
            "title": "Module 1: Project Setup",
            "subtitle": "Define your project structure, land allocation, costs, and financing on a foundation built for institutional real estate financial modeling",
            "primaryCta": { "label": "Start Modeling Free", "href": "/refm" },
            "secondaryCta": { "label": "Watch 5-Minute Demo", "href": "#demo" },
            "heroImageUrl": ""
         }'::jsonb, true),

        (m1_id, 'features', 2,
         '{
            "heading": "What you can model",
            "bullets": [
                "Project hierarchy: Project to Phases to Assets to Sub-units",
                "14 project types from Residential to Data Center to Marina",
                "MAAD-spec accounting with Sell, Operate, Lease, and Sell + Manage strategies",
                "NSA / BUA / GFA area hierarchy with custom cost rates per sub-unit",
                "Multi-parcel land allocation with optional NDA deduction",
                "Per-asset cost lines with 13+ calculation methods and 6 phasing curves",
                "Annual inputs with flexible Annual / Quarterly / Monthly output reporting",
                "Operational phase support with historical baseline and run-rate forward operations",
                "Capitalization rules respecting accounting standards (COGS for sold assets, Fixed Assets for retained)",
                "Land in-kind equity contribution treatment"
            ]
         }'::jsonb, true),

        (m1_id, 'how_it_works', 3,
         '{
            "heading": "How it works",
            "steps": [
                { "number": 1, "title": "Create project via 3-step wizard", "body": "Project basics, phases & land, asset structure." },
                { "number": 2, "title": "Define assets and sub-units in Tab 2", "body": "Per-phase grouping with Sub-units carrying NSA, Support and Parking at the asset level." },
                { "number": 3, "title": "Configure cost lines in Tab 3", "body": "Project-wide and per-asset overrides; Per Sub-unit Custom Rates for granular pricing." },
                { "number": 4, "title": "Set up financing in Tab 4", "body": "Per-phase or per-asset tranches with 5 drawdown methods and 5 repayment methods." },
                { "number": 5, "title": "View results in Annual, Quarterly, or Monthly", "body": "Inputs entered annually; output granularity toggle distributes via cost line phasing." }
            ]
         }'::jsonb, true),

        (m1_id, 'cta', 4,
         '{
            "heading": "Ready to model your next project?",
            "body": "Module 1 is free. Start a project, get the full v8 schema, and run unlimited scenarios.",
            "primaryCta": { "label": "Try Module 1 Free", "href": "/refm" },
            "secondaryCta": { "label": "See Pro Features", "href": "/pricing" }
         }'::jsonb, true)
    ON CONFLICT (module_id, page_section) DO NOTHING;
END $$;

-- ── Done. ──────────────────────────────────────────────────────────────────
