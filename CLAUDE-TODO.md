# Pending Work & Backlog

> Forward-looking only: active follow-ups, in-progress work, backlog, legacy reference. Completed phase narratives live in **CLAUDE-FEATURES.md** (archive) and `git log` (authoritative). Do not re-add "Recently Completed" sections here when closing a phase, write the closure into CLAUDE-FEATURES.md instead.

---

## ACTIVE FOLLOW-UP, Rename RESEND_WEBHOOK_SECRET to EMAIL_BRIDGE_BEARER_SECRET (2026-05-11)

After the Brevo re-migration, the env var name `RESEND_WEBHOOK_SECRET` is misleading: it doubles as the bearer token for `POST /api/email/send` (used by the Google Apps Script bridge) and has nothing to do with Resend anymore. Rename to a vendor-neutral `EMAIL_BRIDGE_BEARER_SECRET` in a future commit. Steps:

1. Add `EMAIL_BRIDGE_BEARER_SECRET` to Vercel env vars with the same value as `RESEND_WEBHOOK_SECRET`.
2. Update `app/api/email/send/route.ts` to read `EMAIL_BRIDGE_BEARER_SECRET` (fallback to legacy `RESEND_WEBHOOK_SECRET` for one deploy cycle).
3. Update Apps Script to send the new header name.
4. Remove the legacy `RESEND_WEBHOOK_SECRET` env var + the legacy fallback after one deploy cycle.
5. Update `.env.example` + `app/api/admin/env-check/route.ts` to reflect the new name.

Out of scope for the email vendor migration; bookmark it here so it doesn't get forgotten.

---

## In Progress

| Feature | Current State | What Remains |
|---------|--------------|--------------|
| **AI Agents** | Market rates + research agents wired | Contextual help agent (stub only) |
| **Pricing / Subscriptions** | `/admin/pricing` is now a single Platform Pricing surface (no tab bar). Plans + Page Content + Pricing Features + Module Access tabs all removed across 2026-04-27 / 2026-04-28. Migration 145 dropped `pricing_plans`. Page Builder → Pricing owns hero + FAQ for the public page. Plan-based feature gating ripped out (commit `d8405e5`); REFM stubs `canAccess()` → `false`. | Reintroduce plan-based gating as a focused new feature spec when paid tiers go live (server-enforced from day one, built on the surviving `platform_pricing` + `platform_features` + `plan_feature_access` tables). |
| **Branding** | Brand Colors section moved into `/admin/header-settings` (2026-04-28, commit `ab5db30`). `/admin/branding` is a 5-line redirect. Drives `--color-primary` / `--color-secondary` via `BrandingThemeApplier`. | None, Header Settings owns brand colors + logos + favicon + header text + header layout in one place; Page Builder owns page copy. |

---

## Not Started, REFM Modules

> Module 1 ships production-ready on the v8 schema. Current REFM status (M2.0 Pass 9, 2026-05-12) lives in CLAUDE-REFM.md. Next phase is **M2.1 Revenue Analysis**, which consumes the v8 HydrateSnapshot. Pattern decisions for downstream modules are codified in the "Module 1 Conventions" block in CLAUDE-REFM.md.

| Module | Name | Status |
|--------|------|--------|
| Module 2 | Revenue Analysis | Stub only (next up; reads v8 HydrateSnapshot, asset.status gates revenue per period, rate-unit drives revenue stream) |
| Module 3 | Operating Expenses | Stub only |
| Module 4 | Returns & Valuation | Stub only |
| Module 5 | Financial Statements | Stub only (consumes `classifyAssetCapex` + `computeCashFlowImpact` from M2.0d unchanged) |
| Module 6 | Reports & Visualizations | Stub only |
| Modules 7-11 | (various) | Placeholder stubs |

**Deferred from M2.0 / M2.0g (carried forward):**
- Module 2 Revenue: cohort collection (Sell + Sell+Manage), hospitality USAH (Operate + count), retail NOI (Lease + area), mixed strategy. Asset.status drives revenue gating (`planned` no revenue, `construction` pre-sale only, `operational` full).
- Module 3 Cashflow: real surplus-driven cash sweep math (today straight-lines outstanding balance).
- Module 5 Statements: full IDC schedule breakdown (capitalised vs paid in cash post-construction).
- Excel + PDF exports: stub modal in M2.0; rebuild against v8 in M2.1+.
- Wizard polish: type bank auto-pre-fills GFA/BUA defaults from sub-unit metric; preset templates ("Saudi mixed-use", "Branded residences", "Hotel-led resort") seed Tab 2 with industry-typical asset mixes.

**Deferred from M2.0L / M2.0M Financing (carried forward):**
- DSCR breach alerts (Module 5 dependency).
- Equity waterfall + IRR hurdle math (Module 4 dependency).
- Cash-sweep with full operating cashflow (Module 5 dependency; capex-only proxy ships today).
- Sharia Murabaha / Ijara product templates.
- Multi-currency facilities.
- Refinancing flows.
- True per-asset financing schedule breakdown across multi-asset phases.
- Methods 2-4 full calc-engine wiring (Method 2 line-item application, Method 3 net-of-revenue, Method 4 period-by-period deficit math). Inputs persist today; calc completes when upstream Revenue + CF engines ship via the FinancingDataHooks contract.
- Real `getClosingCashBalance` from M3 Cash Flow engine (today walks a local sim).

**Deferred from M2.0M Pass 7 (carried forward):**
- Dedicated Project Common Costs section above asset pills (allocated lines still attach to the first visible asset; promotion deferred pending user feedback).
- Playwright e2e for the per-asset Costs Inputs surface (verifier + manual smoke cover today).

---

## Not Started, Modeling Platforms

| Platform | Slug |
|----------|------|
| Business Valuation Modeling | `bvm` |
| FP&A Modeling Platform | `fpa` |
| Equity Research Modeling | `erm` |
| Project Finance Modeling | `pfm` |
| LBO Modeling Platform | `lbo` |
| Corporate Finance Modeling | `cfm` |
| Energy & Utilities Modeling | `eum` |
| Startup & Venture Modeling | `svm` |
| Banking & Credit Modeling | `bcm` |

All have config in `src/config/platforms.ts` + corresponding rows in `platform_modules` admin table. No platform content yet. When a platform starts active development, create `CLAUDE-{slug}.md` per the per-platform MD convention (see CLAUDE-MODELING-HUB.md).

---

## Legacy Reference

`_legacy_backup/js/refm-platform.js`, 7,599-line original CDN implementation.
- AppRoot: lines 1-70 | State: 72-200 | Calculations: 200-900
- Excel export: 900-1,900 | Project Manager UI: 1,900-3,800
- Main render: 3,800-5,700 | Module 1 UI: 5,700-7,520 | Stubs: 7,520-7,598
