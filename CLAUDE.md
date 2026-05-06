# Financial Modeler Pro, Claude Code Project Brief
**Last updated: 2026-05-06 (M2.0e wizard simplification + Tab 2 full asset entry on v7 schema)**

> **See also:**
> - [CLAUDE-DB.md](CLAUDE-DB.md), Database tables, storage buckets, migrations log
> - [CLAUDE-FEATURES.md](CLAUDE-FEATURES.md), Feature status, detailed feature specs & flows, Module 1 phase history (M1.R through M1.13d)
> - [CLAUDE-ROUTES.md](CLAUDE-ROUTES.md), All page routes, API routes, components, lib structure
> - [CLAUDE-TODO.md](CLAUDE-TODO.md), Pending work, backlog, legacy reference
> - [ARCHITECTURE.md](ARCHITECTURE.md), Three-tier folder rationale, alias guide, boundary rules
> - [PROJECT_HANDOFF.md](PROJECT_HANDOFF.md), Frozen 2026-05-02 snapshot for resuming a cold session (M1.7-era detail)

---

## STRICT SESSION RULES, READ FIRST

### Writing rule: NEVER use em-dashes

**NEVER use em-dashes (the long dash, U+2014) anywhere.** This applies to ALL output: code, code comments, UI strings, JSX text, tooltips, error messages, commit messages, documentation markdown, prompts, agent briefs, anything.

Use one of these instead, depending on intent:
- A comma, when separating clauses (most common substitute).
- A colon, when introducing a list or definition.
- Parentheses, for asides.
- "and" or "or" or "and/or", when joining alternatives.
- A period plus new sentence, when the second clause stands alone.

The codebase has 2,221 existing em-dashes (M1.11 audit). They are being swept out under M1.11. Do not introduce new ones.

### Scoping: Read ONLY the files for your task domain

| Task | Read ONLY these paths |
|------|-----------------------|
| Training auth (login / register / confirm) | `app/training/signin/` `app/training/register/` `app/training/confirm-email/` `app/training/forgot/` `app/api/training/validate/` `app/api/training/register/` `app/api/training/confirm-email/` `app/api/training/device-verify/` `app/api/training/resend-confirmation/` `src/lib/training/training-session.ts` `src/lib/shared/` |
| Training dashboard / course content | `app/training/dashboard/` `app/training/[courseId]/` `src/components/training/dashboard/` `app/api/training/` |
| Training assessment / quiz | `app/training/assessment/` `app/training/[courseId]/assessment/` `app/api/training/[courseId]/assessment/` `app/api/training/submit-assessment/` |
| Certificate / transcript | `app/training/certificate/` `app/training/certificates/` `app/training/transcript/` `src/components/training/dashboard/CertificateImageCard.tsx` `src/lib/training/certifier.ts` `src/lib/training/certificateLayout.ts` `app/api/training/certificate/` `app/api/training/certificate-image/` `app/api/t/[token]/pdf/` |
| Modeling Hub auth | `app/modeling/signin/` `app/modeling/confirm-email/` `app/api/auth/` `src/lib/shared/auth.ts` `src/lib/shared/deviceTrust.ts` `src/lib/shared/emailConfirmation.ts` `src/lib/shared/captcha.ts` |
| Modeling Hub platform (REFM) | `app/refm/` `app/modeling/` `src/components/refm/` `src/lib/modeling/` |
| Admin panel | `app/admin/` `src/components/admin/` `app/api/admin/` |
| Email system | `src/lib/email/` |
| Shared utilities | `src/lib/shared/` `src/core/` |
| Navbar / layout | `src/components/layout/` |
| Landing pages / CMS | `app/(portal)/` `app/about/` `app/articles/` `app/pricing/` `src/components/landing/` `app/api/cms/` |

**Never** read files outside the task domain.
**When a task spans two domains**, read only those two folders, nothing else.

### End-of-session rule
**ALWAYS update CLAUDE.md files at the end of every session** to reflect:
- Any new files created (add to the correct folder list in CLAUDE-ROUTES.md)
- Any feature status changes (update the Feature Status table in CLAUDE-FEATURES.md)
- Any new environment variables added
- Any new database tables or migrations (add to CLAUDE-DB.md)

### Do NOT touch list
- `next.config.ts`, subdomain routing is live and correct; clean auth URL rewrites + redirects added; app. `/register` rewrite goes to `/modeling/register` (dedicated page, NOT `/modeling/signin?tab=register`)
- `src/middleware.ts`, `/admin/:path*` protection is live; `/admin/login` AND `/admin` root excluded
- `app/globals.css`, design system tokens, do not restructure
- `vercel.json`, deployment config is live
- `supabase/migrations/`, never edit existing migrations; create new ones only
- Any feature marked Complete unless explicitly asked by the user
- Cross-feature shared files (`src/lib/shared/`, `src/lib/email/`) without explicit instruction

---

## Project Overview

**Financial Modeler Pro**, Multi-hub SaaS platform with three web properties:

| Property | Domain | Purpose |
|----------|--------|---------|
| Main site | `financialmodelerpro.com` | Marketing, admin, portal, auth |
| Training Hub | `learn.financialmodelerpro.com` | Financial modeling courses |
| Modeling Hub | `app.financialmodelerpro.com` | Interactive financial modeling tools |

**Stack: Next.js 15 (App Router) + TypeScript strict + Tailwind CSS 4 + Supabase**

---

## Tech Stack

| Layer | Technology | Version |
|-------|-----------|---------|
| Framework | Next.js (App Router) | ^16.2.1 |
| Language | TypeScript strict mode | ^5 |
| Styling | Tailwind CSS 4 + CSS custom properties | ^4 |
| State | Zustand | ^5.0.11 |
| Charts | Recharts | ^3.8.0 |
| Database | Supabase (`@supabase/supabase-js`) | ^2.99.1 |
| Auth, Modeling Hub | NextAuth.js (JWT, 1hr session) | ^4.24.13 |
| Auth, Training Hub | Custom (httpOnly cookie + localStorage) |, |
| Forms | react-hook-form + zod + @hookform/resolvers | ^7 / ^4 / ^5 |
| Icons | lucide-react | ^0.577.0 |
| Utilities | clsx, tailwind-merge |, |
| AI | @anthropic-ai/sdk | ^0.78.0 |
| Email | Resend | ^6.10.0 |
| Export | exceljs + @react-pdf/renderer | ^4.4.0 / ^4.3.2 |
| Captcha | @hcaptcha/react-hcaptcha | ^2.0.2 |
| QR Codes | qrcode | ^1.5.4 |
| PDF Generation | pdf-lib | ^1.17.1 |
| Image Processing | sharp | ^0.33.5 |
| Rich Text | @tiptap/react + starter-kit + image + text-align + link | 2.27.2 |
| Drag & Drop | @hello-pangea/dnd | ^18.0.1 |
| SVG Text Rendering | satori | latest |
| Passwords | bcryptjs (Training Hub) / scrypt via Node (Modeling Hub) | ^3.0.3 |
| Toast | react-hot-toast | ^2.6.0 |
| Sanitization | isomorphic-dompurify | ^3.3.0 |
| Image Crop | react-easy-crop | latest |

---

## External Services

| Service | Purpose | Config |
|---------|---------|--------|
| **Supabase** | Database | `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`, `NEXT_PUBLIC_SUPABASE_ANON_KEY` |
| **Resend** | Transactional email | `RESEND_API_KEY`, `EMAIL_FROM_TRAINING`, `EMAIL_FROM_NOREPLY` |
| **Google Apps Script** | Training registration + attendance source of truth | URL in `training_settings` table |
| **hCaptcha** | Spam protection on signup forms (both hubs) | `HCAPTCHA_SECRET_KEY`, `NEXT_PUBLIC_HCAPTCHA_SITE_KEY` |
| **Anthropic Claude API** | AI market research + contextual help agents | `ANTHROPIC_API_KEY` |
| **Vercel** | Hosting + edge middleware | Auto-deploy on `main` push |

---

## Authentication Systems

### Training Hub (learn.financialmodelerpro.com)
- **Source of truth**: Google Apps Script (student roster + Registration IDs)
- **Password storage**: `training_passwords` table (bcrypt hashed)
- **Session**: httpOnly cookie `training_session` (1-hour TTL) + localStorage mirror
- **Sign-in flow**: email+password -> `POST /api/training/validate` -> check pending/unconfirmed -> check device trust -> set session cookie
- **Registration flow**: form -> hCaptcha -> insert `training_pending_registrations` -> confirm email -> Apps Script -> `training_registrations_meta` confirmed
- **Device trust**: `fmp-trusted-device` cookie -> `trusted_devices` table (30-day TTL)
- **New device OTP**: `training_email_otps` table, 6-digit code, 10-min expiry
- **Inactivity logout**: 1-hour `useInactivityLogout` hook -> `POST /api/training/logout`
- **email_confirmed null handling**: Pre-migration-027 students have `email_confirmed = null`. `validate/route.ts` treats `null` as confirmed (`!== false`). Do NOT use `=== true` or these users will be blocked
- **Resend confirmation**: `resend-confirmation/route.ts` sends for `email_confirmed !== true` (covers both `false` and `null`)
- **Key files**: `src/lib/training/training-session.ts`, `app/api/training/validate/route.ts`, `app/api/training/register/route.ts`

### Modeling Hub (app.financialmodelerpro.com)
- **Auth provider**: NextAuth.js Credentials (JWT strategy, 1-hour maxAge)
- **Password storage**: `users.password_hash` (scrypt via Node `crypto.scrypt`)
- **Session**: NextAuth JWT cookie
- **Sign-in flow**: email+password -> NextAuth `authorize()` -> check `email_confirmed` -> check device trust -> JWT issued
- **Registration flow**: form -> hCaptcha -> insert `users` (email_confirmed=false) -> confirm email -> `email_confirmed=true` -> signin
- **Device trust**: `fmp-trusted-device` cookie -> `trusted_devices` table (30-day TTL)
- **New device OTP**: `modeling_email_otps` table, 6-digit code, 10-min expiry
- **Device trust identifier**: `trusted_devices.identifier` stores `email` (not user UUID). Do NOT change to `user.id`
- **Admin bypass**: In `auth.ts` `authorize()`, admin role skips BOTH `EmailNotConfirmed` and `DEVICE_VERIFICATION_REQUIRED` checks
- **Admin login flow**: `/admin` (public) -> `/admin/login` (form, excluded from middleware) -> `/admin/dashboard` -> `/admin/cms`
- **Admin layout guard**: `AdminGuard` uses child `AdminProtected` to isolate `useRequireAdmin` hook
- **Non-admin redirect**: `useRequireAdmin` redirects non-admins to `/` (not `/refm`)
- **Key files**: `src/lib/shared/auth.ts`, `app/api/auth/register/route.ts`, `app/api/auth/confirm-email/route.ts`

---

## Subdomain Routing (`next.config.ts`)

- `learn.financialmodelerpro.com/` -> rewrites to `/training` (URL unchanged)
- `app.financialmodelerpro.com/` -> rewrites to `/modeling` (URL unchanged)
- Main-site paths on learn. or app. -> redirect to `financialmodelerpro.com`
- `/training/*` on main domain -> redirect to `learn.financialmodelerpro.com`
- `/modeling/*` or `/refm/*` on main domain -> redirect to `app.financialmodelerpro.com`

### Clean Auth URLs
| Subdomain | Clean URL | Served from |
|-----------|-----------|-------------|
| learn. | `/signin` | `/training/signin` |
| learn. | `/register` | `/training/register` |
| learn. | `/forgot` | `/training/forgot` |
| app. | `/signin` | `/modeling/signin` |
| app. | `/register` | `/modeling/register` |

Use `/signin`, `/register`, `/forgot` for all training/modeling auth links.

**Critical**: Navbar uses plain `<a>` tags with absolute URLs. NavbarServer `absolutizeHref()` converts DB hrefs.

**Navbar auth links**: Use file-level constants `APP_URL` and `LEARN_URL` with `??` fallbacks, never raw `process.env` without fallback.

---

## Design System (DO NOT CHANGE)

- **Single source of truth**: `app/globals.css`
- Colors: `--color-primary`, `--color-primary-dark`, etc.
- Spacing: 8px grid, `--sp-1` (8px) through `--sp-5` (48px)
- Typography: `--font-h1` through `--font-micro`
- Component classes: `.card`, `.kpi-card`, `.btn-primary`, `.table-standard`
- Financial inputs (Training Hub + admin): `.input-assumption` class (yellow bg `--color-warning-bg`)
- **REFM (Module 1 tabs + shell + modals + new Area Program tab) uses FAST input blue** instead of `.input-assumption`, `var(--color-navy-pale)` bg + `var(--color-navy)` text via the local `inputStyle` constant in each component. Established Phases 4.6 → 4.15 (2026-04-30) and extended into the M1.7 Area Program tab (2026-05-02). Calculated outputs use the same pattern's `calcOutputStyle` (`var(--color-grey-pale)` bg + `var(--color-heading)` text). The `.input-assumption` class is reserved for actual financial-model assumption cells (rates, ratios, escalators) and continues to apply outside REFM.
- **Do NOT use Tailwind utility classes for layout tokens**

---

## Deployment, Vercel

### Environment Variables
| Variable | Description |
|----------|-------------|
| `ANTHROPIC_API_KEY` | Claude AI API key |
| `SUPABASE_URL` | Supabase project URL |
| `SUPABASE_ANON_KEY` | Supabase anon key (server alias) |
| `SUPABASE_SERVICE_ROLE_KEY` | Supabase service role (server only) |
| `NEXTAUTH_SECRET` | NextAuth JWT signing secret |
| `NEXTAUTH_URL` | `https://app.financialmodelerpro.com` |
| `NEXT_PUBLIC_APP_URL` | `https://app.financialmodelerpro.com` |
| `NEXT_PUBLIC_MAIN_URL` | `https://financialmodelerpro.com` |
| `NEXT_PUBLIC_LEARN_URL` | `https://learn.financialmodelerpro.com` |
| `NEXT_PUBLIC_SUPABASE_URL` | Supabase URL (client-safe) |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | Supabase anon key (client-safe) |
| `RESEND_API_KEY` | Resend email service key |
| `EMAIL_FROM_TRAINING` | Training sender address |
| `EMAIL_FROM_NOREPLY` | No-reply sender address |
| `HCAPTCHA_SECRET_KEY` | hCaptcha server-side secret |
| `NEXT_PUBLIC_HCAPTCHA_SITE_KEY` | hCaptcha client-side site key |
| `CRON_SECRET` | Bearer token for Vercel cron job auth (`/api/cron/certificates`) |

### Scripts
```bash
npm run type-check   # tsc --noEmit, must be zero errors
npm run build        # next build --webpack (avoids MAX_PATH on Windows/OneDrive)
npm run verify       # type-check + lint + build

# Module 1 v7 (M2.0d/M2.0e) regression-guard snapshot diff (single baseline,
# replaces the 3 retired ones)
npx tsx scripts/module1-v5-diff.ts              # M2.0e v7, 47.8 KB baseline (sha256 824ef8e1706d)

# Per-phase verifier (5 sections: schema/types / calc / state / source markers / Playwright UI)
npx tsx scripts/verify-m20.ts                   # M2.0 MAAD-Spec rebuild (fixture updated for M2.0e startDate + projectType)
npx tsx scripts/verify-m20b.ts                  # M2.0b shell restoration (51 pass / 0 fail / 2 skip without dev server / unauth)
npx tsx scripts/verify-m20c.ts                  # M2.0c full Dev Costs + Financing on v6 (looser SCHEMA_VERSION + COST_METHODS asserts after M2.0d)
npx tsx scripts/verify-m20d.ts                  # M2.0d Costs polish + v7 (71 pass / 0 fail / 2 skip without dev server)
npx tsx scripts/verify-m20e.ts                  # M2.0e wizard + Tab 2 (58 pass / 0 fail / 2 skip without dev server) <- canonical green

# Playwright e2e specs (M2.0 v5/v6/v7 contract)
npx playwright test tests/e2e/m20-full-flow.spec.ts        # 2 specs: 3-step wizard create + 4-tab landing + 8 light/dark tab screenshots
npx playwright test tests/e2e/m20b-shell.spec.ts           # 4 specs: brand topbar/sidebar/dashboard chrome + dark-mode body attribute toggle + 3-modal open-close + light/dark screenshots
npx playwright test tests/e2e/m20c-costs-financing.spec.ts # SKIPPED (frozen v6 contract; superseded by m20d-costs-polish.spec.ts)
npx playwright test tests/e2e/m20d-costs-polish.spec.ts    # 7 specs: layout (no sidebar bleed) + Tab 2 Sell+Manage agreement + Tab 3 per-asset segregation + custom cost popup + 3 capex summary tables + Tab 4 in-kind equity tile + granularity + light/dark screenshots
npx playwright test tests/e2e/m20e-wizard-tab2.spec.ts     # 6 specs: wizard Step 2 unit suffix + Phase Start Date column + Step 3 simplified + Tab 2 phase grouping + asset Phase/Status dropdowns + sub-unit Rate Unit column + light/dark screenshots
```

### Per-phase verification workflow (M1.7+)
Standing preference (2026-05-02): every REFM phase ships a `scripts/verify-[phaseId].ts`
covering 5 sections, (1) Database / persistence (Supabase JSONB roundtrip via service-role),
(2) Route smoke tests (401-without-auth gates; skips when `localhost:3000` is down),
(3) Calculation correctness (snapshot diffs + targeted assertions on fixture inputs),
(4) State integrity (load fixture into store, mutate via store actions, assert cascade),
(5) UI rendering (Playwright headless light + dark screenshots saved to
`tests/screenshots/[phase]/{light,dark}-*.png`; skips when dev server is down or Playwright
not installed). Test-user fixture id `00000000-0000-0000-0000-000000000000` with
`ON DELETE CASCADE` cleans downstream rows on teardown. M1.7 reference: 25 pass / 0 fail
/ 2 skip without dev server.

**Dev dependencies (M1.7)**: `@playwright/test ^1.59.1` + chromium browser
(`npx playwright install chromium`).

### Module 1 status (2026-05-06, **M2.0e wizard simplification + Tab 2 full asset entry**)

**M2.0e (current, ships):** Wizard simplification + Tab 2 becomes the
canonical asset entry surface. Closes the 6 testing-feedback items
Ahmad raised after M2.0d (wizard column units, Phase Start Date,
Step 3 too detailed, Tab 2 needs phase grouping + sub-unit table +
project-type-aware Type catalog). Additive schema (no SCHEMA_VERSION
bump, v7 stays); 8 commits:

- **/1 (schema additions)**: Three optional fields on the v7 schema:
  Phase.startDate?: string (ISO date), Asset.status?: 'planned' |
  'construction' | 'operational', Project.projectType?: 'Residential'
  | 'Hospitality' | 'Retail' | 'Office' | 'Mixed-Use' | 'Custom'.
  Two new closed enums + label maps (PROJECT_TYPES, ASSET_STATUSES,
  ASSET_STATUS_LABELS). Two new catalogs:
  ASSET_TYPES_BY_PROJECT_TYPE (Residential 6 / Hospitality 6 / Retail
  5 / Office 4 / Mixed-Use 11 / Custom 8) and
  SUGGESTED_CATEGORIES_BY_PROJECT_TYPE (one-line empty-state nudges).
  makeDefaultProject seeds projectType: 'Mixed-Use'. Two new pure
  calc helpers: computePhaseTimeline(phase, project) returns
  { constructionStart, constructionEnd, operationsStart, operationsEnd }
  as ISO dates (period unit follows project.modelType: monthly = +N
  months, annual = +N years; overlapPeriods deducted from
  constructionEnd to derive operationsStart; falls back to
  project.startDate + (constructionStart - 1) periods when
  phase.startDate is undefined); computeProjectTimeline returns
  { start, end, spanPeriods } where start = min phase
  constructionStart, end = max phase operationsEnd.
- **/2 (Wizard Step 2)**: WizardDraftPhase.startDate becomes a
  required field. Step 2 column headers gain unit suffix tracking
  draft.modelType ("Construction (years)" / "(months)" reactive).
  New Phase Start Date column inserted before Construction. addPhase
  auto-defaults next phase startDate = prior.startDate +
  prior.constructionPeriods (in modelType units), so Phase 2 picks
  up where Phase 1 ended; first phase defaults to draft.startDate.
- **/3 (Wizard Step 3 simplified)**: WizardDraftAsset interface
  retired. WizardDraft.assets[] removed. WizardDraft.projectType
  added (single ProjectType pick). buildWizardSnapshot outputs empty
  assets[] / subUnits[] (Tab 2 is the canonical asset entry surface
  going forward). Step 3 collapses from a 4-input + 1-sub-unit-row
  per asset card grid into a single 6-radio project-type pick + a
  "Tab 2 will suggest" preview reading
  SUGGESTED_CATEGORIES_BY_PROJECT_TYPE. Stepper label "3. Assets" ->
  "3. Project Type". step3Valid loosened to PROJECT_TYPES.includes.
- **/4 (Tab 2 rewrite)**: Module1Assets full rewrite. Land Parcels
  block + Land Allocation Mode block stay at top (unchanged).
  Per-phase asset sections replace the flat "Assets" list: each
  PhaseAssetSection header carries phase name + computePhaseTimeline
  (constructionStart to operationsEnd, period counts) + asset count
  + a "+ Add Asset" button. Empty-state prints
  SUGGESTED_CATEGORIES_BY_PROJECT_TYPE. AssetCard rebuilt with
  header row (name + Phase dropdown reassign + Strategy + Type
  catalog filtered via resolveTypeCatalog + Status pill + Visible +
  Delete), conditional ManagementAgreementForm (Sell + Manage),
  conditional UsefulLifeForm (Operate / Lease), land allocation row
  (mode A/B/C), 5 area inputs (GFA / BUA / Sellable BUA / Parking
  Bays), sub-unit table with M2.0e column shape (Type / Category /
  Metric / Area / Unit Size / Count / Rate / Rate Unit), card
  footer with BUA reconciliation (matches / mismatch by N sqm) +
  efficiency % + land cost. Status badge color: planned = grey,
  construction = warm amber, operational = green-success. Rate Unit
  derives from category + metric (per unit / per sqm / per
  room/night / per sqm/year / per unit/year). Global totals card
  (navy) at bottom shows Total BUA / Sellable / Operable / Leasable
  / Land Cost.
- **/5 (snapshot baseline regen)**: scripts/baselines/module1-v5.json
  47.8 KB sha256 824ef8e1706d (up from M2.0d 47.6 KB sha256
  7418013202fc). Drift sources: phase.startDate populated on both
  phases, project.projectType: 'Mixed-Use', Asset.status: 'planned'
  on all 4 assets, Asset 3 type 'Retail' -> 'Retail Mall' to match
  the new Mixed-Use catalog.
- **/6 (verifier)**: scripts/verify-m20e.ts (58 pass / 0 fail / 2
  skip without authenticated dev server). 5 sections: schema (10
  assertions), routes + baseline diff (47.8 KB sha 824ef8e1706d),
  calc (9 assertions covering computePhaseTimeline annual + monthly
  + fallback + computeProjectTimeline min/max), 35 source-file
  markers, em-dash sweep across 5 files, Playwright presence + run
  gate.
- **/7 (Playwright)**: tests/e2e/m20e-wizard-tab2.spec.ts (6 specs):
  wizard Step 2 unit suffix reactive to modelType + Phase Start
  Date column + auto-default for Phase 2; wizard Step 3 simplified
  (6 radios + step3 callout + suggestions box; M2.0c-era asset
  detail inputs gone via toHaveCount 0); Tab 2 phase grouping +
  globals card; Asset card Phase/Status dropdowns + Rate Unit
  column + reconciliation row; light/dark screenshots into
  tests/screenshots/M2.0e/.
- **/8 (docs sweep, this commit)**: CLAUDE.md M2.0e closure block,
  scripts table updated to point at v7 baseline 47.8 KB + verify-
  m20e canonical green + m20e-wizard-tab2.spec.ts entry, M2.0d
  status re-titled "foundation for M2.0e".

**M2.0e pattern decisions for downstream phases:**
- Wizard captures only project shape (basics + phases + land + project
  type); detail entry lives in dedicated tabs. M2.1 Revenue Tab follows
  the same pattern: wizard does NOT seed revenue lines; the Revenue
  Tab seeds defaults per asset based on category + strategy.
- Per-phase startDate is the authoritative timing source going forward.
  Module 5 Statements + Module 3 Cashflow consume computePhaseTimeline
  for concrete date display. Legacy snapshots without startDate fall
  back to the project.startDate-driven offset model so existing
  projects stay compatible.
- Sub-unit category + metric drive the "Rate Unit" presentation
  (Sellable + count = "per unit", Operable + count = "per room/night",
  Leasable + area = "per sqm/year", etc.). M2.1 Revenue must wire each
  rate-unit combination to a revenue stream:
  * Sellable + count: cohort sale revenue (units × unitPrice over
    sales schedule)
  * Sellable + area: cohort sale revenue (sqm × unitPrice over sales
    schedule)
  * Operable + count: hospitality revenue (keys × ADR × occupancy ×
    days)
  * Operable + area: hospitality revenue per sqm/year (rare; serviced
    apt model)
  * Leasable + area: rent (sqm × rent × occupancy)
  * Leasable + count: rent per unit/year
  * Support: no revenue stream (back-of-house)
- Asset.status drives revenue gating in M2.1: 'planned' = no revenue
  this period, 'construction' = pre-sale cohort revenue only (Sell +
  Sell+Manage), 'operational' = full revenue per strategy.
- Project type seeds the Type catalog filter in Tab 2 but NEVER
  auto-creates assets. Empty-state suggestions are nudges, not data
  changes. Same pattern applies to future seeds.
- Status pill color convention: planned = grey, construction = warm
  amber, operational = green-success. Module 5 Statements + Module 3
  Cashflow should reuse the same color scale for consistency.

### Module 1 status (M2.0d, 2026-05-06, foundation for M2.0e)

**M2.0d:** Closes the 8 testing-feedback items
Ahmad raised on M2.0c. Schema bumps to v7 (pre-v7 hard-cut continues
the precedent v5 -> v6 set). 9 commits:

- **/1 (layout)**: globals.css `.main-content` drops `margin-left:240px`
  + `transition` + `height: calc(100vh - 40px)`. The M2.0b shell put
  Topbar + .app-shell as a flex column with Sidebar + main-content as
  flex siblings, so the margin shim doubled the offset and clipped
  page titles ("Dashboard", "Projects", "Overview") at the left edge.
  Removed the dead `.main-content.sidebar-collapsed` companion (no
  callers grep-confirmed). Single rule now: `.main-content { flex: 1;
  overflow-y: auto; overflow-x: hidden; min-width: 0; }`.
- **/2 (schema v7)**: AssetStrategy 'Hybrid' renamed 'Sell + Manage'
  (MAAD Tower 01 pattern, build + sell to investors + retain operating
  rights via management contract). Asset gains optional
  managementAgreement: { managementFeePct, ownerRevenueSharePct,
  agreementStartPeriod?, agreementDurationPeriods? } and
  usefulLifeYears? (depreciation horizon for Operate / Lease).
  CostMethod gains 'rate_per_parking_bay' (value × asset.parkingBays).
  AssetAreaMetrics gains parkingBays. CostLine gains optional
  targetAssetId (custom lines tagged at one asset; project-wide lines
  stay untagged) and disabled (per-line on/off). CostOverride gains
  disabled (per-asset on/off). makeDefaultCostLines replaces the v6
  12-line catalog with the M2.0d 9-line standard (10 internal rows:
  land-cash + land-inkind locked, then construction-bua,
  construction-parking, infrastructure, landscaping, pre-operating,
  professional-fee, commission, contingency). STANDARD_COST_LINE_IDS
  exports the stable id list. SCHEMA_VERSION = 7. migrate.ts:
  isV7Snapshot + isPreV7Snapshot (v6 'Hybrid' + v6 catalog ids
  ('site-prep' / 'structural' / 'mep' / 'finishing' / 'professional-
  fees' plural / 'marketing' / 'project-management' / 'legal' /
  'ffe') flag pre-v7 with the canonical "Schema migrated to v7.
  Please recreate this project." error). Backward-compat aliases
  isV5Snapshot / isV6Snapshot resolve to v7 implementations.
- **/3 (calc engine)**: Five new pure helpers in @core/calculations:
  deriveCostStage(line) returns 'land' | 'hard' | 'soft' | 'operating'
  by stable id (custom lines fall back to line.stage); deriveCostScope
  returns 'direct' | 'indirect' from allocationBasis; resolveUseful-
  LifeYears reads asset.usefulLifeYears with category fallback per
  DEFAULT_USEFUL_LIFE_YEARS (residential 30 / hospitality 20 / retail
  25 / default 25); classifyAssetCapex(asset, capexBasis, landTotal)
  returns { COGS, FixedAssets, Depreciation } per strategy (Sell +
  Sell+Manage -> COGS=basis with no depreciation; Operate + Lease ->
  FixedAssets=basis with annual depreciation = (basis - landTotal) /
  usefulLifeYears, land never depreciates regardless); compute-
  CashFlowImpact(capexBasis, landInKindPortion) returns { cashOutflow:
  basis - inKindLand, equityInKind: inKindLand } so cash flow
  excludes the equity-in-kind portion. computeAssetCost respects the
  new disabled fields (zeros the row, keeps it in resolved[] for
  stage tracking) and filters out targetAssetId-tagged lines that
  belong to other assets.
- **/4 (Tab 2 Sell+Manage UI)**: Module1Assets STRATEGY_LABELS map
  renders long-form labels ("Sell + Manage, sell to investors, manage
  via agreement (Tower pattern)" etc.); enum value stays the short
  slug. Conditional sub-forms below the asset card: Management-
  AgreementForm (4 fields: management fee %, owner share % auto =
  100 - fee, agreement start period optional, duration periods
  optional) renders only when strategy === 'Sell + Manage';
  UsefulLifeForm (writeable usefulLifeYears + live "Resolved: N
  years (category default)" readout) renders only when strategy is
  Operate or Lease; Sell + Sell+Manage hide the useful-life surface.
- **/5 (Costs tab rewrite)**: Module1Costs end-to-end rewrite.
  Layout: top bar (phase selector + stage filter) -> 4-tile stage
  summary -> per-phase header (PHASE 1 . N assets) -> per-asset
  collapsible AssetCostSection (default expanded) with asset name +
  strategy badge + accounting destination string ("This will
  capitalise to {asset}, expensed as COGS when units sell" / "as
  Fixed Asset, depreciated over {N} years (land never depreciates)"
  / "no depreciation (developer does not own units post-sale)") ->
  9-row cost table per asset (name editable, method dropdown of 14
  methods, value, start, end, phasing dropdown of 6, total chip,
  ON/OFF toggle) -> "+ Add Custom Cost" button per section -> 3
  capex summary tables (Capex by Period: rows assets + project
  total, cols Y1..Y_n or M1..M_n by granularity, capped at 24 cols;
  Capex by Stage: rows periods + total, cols Land / Hard / Soft /
  Operating / Total; Capex Summary by Treatment: rows assets, cols
  Land Cash / Land In-Kind / Hard / Soft / Operating / Total Capex /
  Cash Flow Impact, where Cash Flow Impact uses computeCashFlowImpact
  to subtract in-kind land from cash outflow) -> Project Total
  navy footer. Stage / Scope dropdowns REMOVED from row UI (Fix 2);
  shown as a small subscript label + a hover title attribute on the
  row. Custom Cost Popup (CustomCostPopup component) opens on +Add:
  user picks Stage (Land / Hard / Soft / Operating) + Method + Value
  + Phasing; save creates a CostLine with targetAssetId = current
  asset, allocationBasis = 'per_asset'. Override write rules:
  editing method/value/phasing on a project-wide line in an asset
  section creates a costOverride keyed by (assetId, lineId);
  per-asset "reset" button drops the override. Custom lines write
  directly to the line.
- **/6 (Tab 4 equity in-kind)**: Module1Financing tile bar grew
  from 4 -> 5 tiles: Phase CapEx, Total Debt, Cash Equity, In-Kind
  Equity, Total Interest. New Equity Summary card below the tiles
  shows the combined Cash + In-Kind total. In-kind equity computed
  via resolveAssetAreaMetrics on each phaseAsset (sum of in-kind
  land value across the phase, allocation already resolved per
  landAllocationMode).
- **/7 (snapshot baseline regen)**: scripts/baselines/module1-v5.json
  47.6 KB sha256 7418013202fc (down from M2.0c 49.6 KB sha256
  15ed6f865342). Drift sources: 12-line v6 catalog -> 9-line M2.0d
  catalog with different rates (construction-bua at 4500/sqm BUA
  vs the old structural+mep+finishing stack); 'Hybrid' fixture asset
  flipped to 'Sell + Manage'.
- **/8 (verifier)**: scripts/verify-m20d.ts (71 pass / 0 fail / 2
  skip without authenticated dev server). 5 sections: schema (16
  assertions), routes + baseline diff, calc unit tests (10
  assertions covering deriveCostStage / deriveCostScope /
  classifyAssetCapex per strategy / computeCashFlowImpact /
  resolveUsefulLifeYears), 39 source-file markers (layout fix +
  schema v7 + migrate v7 + 9 calc helpers + Module1Assets 4 markers
  + Module1Costs 8 markers + Module1Financing 3 markers), em-dash
  sweep across 7 files, Playwright spec presence + run gate.
- **/9 (Playwright + frozen M2.0c spec)**: tests/e2e/m20d-costs-
  polish.spec.ts (7 specs): layout + Tab 2 Sell+Manage agreement +
  Tab 3 per-asset segregation + custom popup + 3 summary tables +
  Tab 4 in-kind equity + granularity + 6 light/dark screenshots
  into tests/screenshots/M2.0d/. The M2.0c spec is .skip()'d (no
  longer matches the per-asset segregated layout); intentional
  frozen artifact.

**M2.0d pattern decisions for downstream phases:**
- Stage / Scope are calc-engine-derived for the standard 9 ids;
  Module 2 Revenue should follow the same pattern (revenue line ids
  -> revenue stage / scope derive helpers).
- Capex capitalisation rule (every cost line capitalises into asset
  basis; strategy determines accounting destination via classify-
  AssetCapex) is the v7 contract. Module 5 Statements consumes
  classifyAssetCapex's output unchanged.
- Land in-kind treatment: computeCashFlowImpact subtracts in-kind
  land from cash outflow; the in-kind portion lands in Tab 4
  Financing's In-Kind Equity tile and the Capex Summary by Treatment
  table's Cash Flow Impact column. Module 5 cashflow consumes
  computeCashFlowImpact directly.
- Per-asset cost segregation (per-phase header -> per-asset
  collapsible section -> per-line override) is the canonical Costs
  UX. Module 2 Revenue should adopt the same shape (per-asset
  Revenue sections under each phase).
- Custom cost popup (user-picked stage at create time) is the
  pattern for any user-extensible catalog. Selected stage/method/
  phasing live on the line; subsequent edits use the same row.
- Sell + Manage strategy: developer's recurring management fee
  accrues post-handover via Asset.managementAgreement. Module 2
  Revenue must read the agreement to compute developer's fee
  revenue (managementFeePct × operating revenue) over
  agreementDurationPeriods (or perpetual when blank), starting at
  agreementStartPeriod (or handover when blank).
- Hard-cut continues at every schema bump: pre-v7 snapshots flag
  with explicit error rather than silent coercion. v6 -> v7 sets
  the precedent; future schema changes follow the same policy.

### Module 1 status (M2.0c, 2026-05-06, restores Dev Costs + Financing on v6)
**M2.0c (foundation for M2.0d):** Dev Costs + Financing functionality
fully restored to pre-M2.0 capability with all data binding adapted
to v5/v6 schema. Schema bumps from v5 to v6 to absorb the open-ended
cost-line catalog and 5×5 financing matrix. Three issues from
M2.0 + M2.0b addressed across 4 commits:

- **/1 (sidebar layout)**: globals.css `.sidebar` drops
  `position: fixed; top: 40px; left: 0` (a hangover from the
  pre-M2.0 layout that had a separate 40px fixed topbar). The
  M2.0b shell has Topbar + .app-shell as a flex column, so the
  sidebar needs to participate in the .app-shell flex row, not
  overlay content. New rules: `.app-shell { display: flex;
  flex: 1; min-height: 0; overflow: hidden; }`, `.sidebar
  { position: relative; height: 100%; flex-shrink: 0; }`.
  Visible regression that prompted this fix: Asset & Sub-units
  tab Area input was clipped at the left edge in M2.0b/4.
- **/2 (v6 schema + calc + UI)**: Schema bumps to v6:
  CostMethod expands from 6 closed enums to 13 open methods
  (fixed, rate_per_land, rate_per_nda, rate_per_roads,
  rate_per_gfa, rate_per_bua, rate_per_nsa, rate_per_unit,
  percent_of_selected, percent_of_construction, percent_of_-
  total_land, percent_of_cash_land, percent_of_inkind_land);
  CostLine becomes open-ended (id string, stage, scope,
  allocationBasis, startPeriod, endPeriod, phasing,
  distribution, selectedLineIds, isLocked, requiresCountry);
  CostOverride keys on lineId; DrawdownMethod expands to 5
  (capex_basis, manual, debt_equity_ratio, capex_minus_-
  presales, min_cash_floor); RepaymentMethod expands to 5
  (manual, straight_line, cashsweep_continuous, cashsweep_-
  from_period, cashsweep_min_cash); FinancingTranche grows
  optional assetId for per-asset financing detail; Project
  grows country + projectRoadsPct. 12-default cost catalog
  seeds (Land Cash locked + Site Prep + Infrastructure +
  Structural + MEP + Finishing + Professional Fees +
  Contingency + Marketing + Project Management + Legal +
  Landscaping + FF&E). Calc engine rewrite: resolveAsset-
  AreaMetrics maps v5 Asset/Parcel/Project to the metric
  bases the 13 cost methods consume (NDA = land × (1 -
  roads%), NSA = sellable BUA, unit count = sub-units where
  category != Support and metric === count); calculateItem-
  Total dispatches across the 13 methods; distribute returns
  6 phasing curves (even/frontloaded/backloaded/sCurve/
  manual/phase_aligned); resolveAllocationFactor returns
  per-asset share for the 6 allocation bases; computeAsset-
  Cost runs three passes (direct, percent_of_construction
  base = sum of stage='hard' direct, percent_of_selected
  base = sum of selectedLineIds); computePhaseCost
  aggregates per-asset and returns per-period capex curve at
  the model granularity; computeFinancing handles 5 drawdown
  × 5 repayment with IDC capitalization (annual rate /
  modelType=monthly?12:1 for periodicRate). Module1Costs UI
  rewrite: 4-stage summary tiles + phase selector + stage
  filter + cost-row table (stage/scope/method/allocation/
  value/start/end/phasing/total) + advanced row reveal for
  selectedLineIds checkboxes + manual phasing % per period
  + conditional driver requiresCountry + per-asset detail
  panel with metric tiles + per-period schedule. Module1-
  Financing UI rewrite: 4-summary tiles (CapEx/Debt/Equity/
  Interest) + per-tranche cards with LTV/Interest/Repay-
  Periods/Per-Asset selector + drawdown method dropdown
  with conditional sub-fields (drawdownIncludeLand for
  capex_minus_presales, drawdownMinCashFloor for min_cash_-
  floor) + repayment method dropdown with conditional sub-
  fields (sweepStartPeriod for cashsweep_from_period,
  sweepMinCashFloor for cashsweep_min_cash) + IDC toggle +
  per-tranche schedule table (Drawdown / Interest /
  Principal Repaid / Outstanding Balance) at model
  granularity + equity contributions section.
- **/3 (snapshot baseline regen)**: scripts/baselines/module1-
  v5.json grows from 30.8 KB sha256 0424dde6fb19 to 49.6 KB
  sha256 15ed6f865342. Future v6 calc-engine drift fails
  the diff with the canonical refresh hint.
- **/4 (verifier + Playwright + docs)**: scripts/verify-m20c.ts
  with 51 source-file markers + em-dash sweep + 13-method calc
  spot-checks + annual/monthly granularity assertions (54 pass /
  0 fail / 2 skip without authenticated dev server). tests/e2e/
  m20c-costs-financing.spec.ts with 5 specs: sidebar
  non-overlay layout, 13-method cost catalog dropdown
  options, 6 phasing modes, 5×5 financing matrix dropdown
  options, IDC toggle + per-asset selector, granularity-aware
  schedule labels (Y1/Y2 in annual mode), light/dark screenshots.

What stays from M2.0 + M2.0b: v5/v6 schema foundation (Project
+ Phase + Asset + SubUnit + Parcel hierarchy), Tab 1 + Tab 2,
ProjectWizard 3-step, brand-styled shell (Topbar, Sidebar,
Dashboard, Modals), hard-cut migration policy.

**Pre-v6 snapshots (v5 included):** module1-migrate.isPre-
V6Snapshot detects v5 by costLine.key field and flags with
hard-cut "Schema migrated to v6. Please recreate this project."
error. Backward-compat aliases isV5Snapshot / isPreV5Snapshot
still resolve to the v6 implementations.

**M2.0c pattern decisions for downstream phases:**
- CostLine is open-ended (id: string) instead of a closed enum.
  Custom user lines + seed lines coexist; isLocked flag protects
  seed rows like Land Cash.
- AssetAreaMetrics is the canonical input shape for cost
  methods. Module 2 (revenue) should add RevenueMetrics in the
  same pattern (sellable area / unit count / occupancy hours)
  rather than re-deriving from Asset directly.
- Granularity is a model-wide concept (project.modelType) that
  flows through Phase.constructionPeriods (an integer count in
  the granularity unit). The calc engine is granularity-agnostic;
  display layers handle Y1/Y2 vs Mar 25/Apr 25 labels.
- 5×5 financing matrix is the v6 contract. Module 3 (cash flow)
  should refine cash-sweep variants to consume real per-period
  cash surplus instead of the M2.0c straight-line approximation.
- Hard-cut continues at every schema bump: pre-vN snapshots flag
  with explicit error rather than silent coercion. v5 → v6 sets
  the precedent; future schema changes follow the same policy.

### Module 1 status (M2.0b, 2026-05-06, brand-styled shell on v5)
**M2.0b (foundation for M2.0c):** the v5 hard-cut M2.0 rebuild stripped the
FMP brand identity (navy gradient topbar, gold logo, FAST sidebar,
KPI dashboard, branded modals, dark-mode toggle) and replaced it
with slim placeholder components. M2.0b restores all of that against
the v5 schema across 5 commits:

- **/1 (Topbar + Sidebar)**: Topbar (~360 lines) brings back
  pm-toolbar layout with brand logo + project/version context
  buttons + Save/Export pills + admin-only QuickColorPanel + RBAC
  badge + Settings/Hub/SignOut links. Sidebar (~210 lines) brings
  back sb-pv-panel project/version rows + module list with
  PlanBadge for locked modules + Module 1 sub-tab list (4-tab v5
  contract) + collapsed-state pills + role indicator footer.
- **/2 (Dashboard + ProjectsScreen + OverviewScreen)**: Dashboard
  (~340 lines) brings back kpi-card grid (Total Land Area, Land
  Value, Total GFA, Total CapEx, Construction window, Saved
  Projects) computing live from v5 store via computeLandAggregate
  + computePhaseCost; Recent Projects strip; Module 1 + Projects
  quick-action cards; Module Roadmap with status badges driven by
  lib/modules-config. ProjectsScreen (~280 lines) brings back
  pm-project-card grid with status pills + ACTIVE badge + RBAC-
  gated Open/Edit/Delete. OverviewScreen (~310 lines) brings back
  project header + KPI tiles + 4-tab quick-link cards (project-
  phases / assets / costs / financing) + Phase Summary table with
  per-phase CapEx + Version History card.
- **/3 (modals)**: ProjectModal becomes brand-chromed picker with
  search; VersionModal becomes tabbed Save/History; RbacModal
  becomes role-card grid with per-permission ✓/✗ pills;
  ExportModal becomes branded option grid (PDF basic / PDF full /
  PDF white-label / Excel static / Excel formula model) with
  PLAN_LABEL badges. v5 carve-out: Download click writes a
  "rebuilding in M2.1" notice instead of running the legacy
  pipelines.
- **/4 (RealEstatePlatform shell rewire)**: shell wires every new
  prop signature: Topbar.{hasUnsaved/lastSavedAt/can/darkMode}, 
  Sidebar.{canSeeModule/onLockedModuleClick}, Dashboard storage,
  ProjectsScreen.{onEditProject/onDeleteProject}, Overview-
  Screen.{onLoadVersion/onSaveVersion/setActiveTab}, VersionModal.
  {projectName/onSave}, ExportModal.{canAccess}. New helpers:
  can() reads PERMISSIONS[currentUserRole]; canSeeModule reads
  MODULE_VISIBILITY[currentUserRole]; hasUnsaved subscribes to
  store changes; handleSaveVersion writes v5 snapshot via
  pclient.saveVersion + updates activeVersionId; handle-
  DeleteProject calls pclient.deleteProject + tears down active
  state. darkMode toggles body[data-refm-theme="dark"]
  (workspace-scoped per app/globals.css line 1179 contract);
  inner content wrapped in .app-shell so the dark-mode token
  swap takes effect.
- **/5 (verifier + Playwright + config)**: scripts/verify-m20b.ts
  with 47 source-file markers + em-dash sweep (51 pass / 0 fail /
  2 skip without authenticated dev server). tests/e2e/m20b-
  shell.spec.ts with 4 specs: brand topbar/sidebar/dashboard
  chrome, dark-mode body-attribute flip, 3-modal open-close,
  light/dark screenshots. New playwright.config.ts with
  baseURL=http://localhost:3000 (overridable via
  PLAYWRIGHT_BASE_URL); fixed page.goto('/refm') failing with
  "Cannot navigate to invalid URL" because no baseURL was
  configured.

What stays from M2.0: v5 schema, calc engine, 4-tab Module 1, all
4 tab components, ProjectWizard 3-step, 30.8 KB v5 snapshot
baseline (sha256 0424dde6fb19, bit-identical through M2.0b/4),
hard-cut migration policy, primitives.

**M2.0 (still current, foundation):** Module 1 is rebuilt end-to-
end against MAAD Residential Cashflow v1.13. The v3/v4 hierarchy
(Master Holding / Sub-Project / Plot / Zone / FAR / Cascade /
Parking Allocator / Build Program tab / Land tab / Hierarchy
tab) is gone. The new flat schema is:

```
{ version: 5, project, phases[], parcels[], landAllocationMode,
  assets[], subUnits[], costLines[], costOverrides[],
  financingTranches[], equityContributions[] }
```

**4 tabs:**
- 1. Project & Phases: project meta + Phase[] timing
- 2. Assets & Sub-units: Land Parcels block + landAllocationMode +
  Asset cards with strategy (Sell/Operate/Lease/Hybrid) + GFA/BUA/
  sellable BUA/parking + nested Sub-unit editor
- 3. Costs: 9 fixed cost lines per phase (Land, Construction BUA,
  Construction Parking, Infrastructure, Landscaping, Pre-operating,
  Professional fee, Commission fee, Contingency) with method + value
  + phasing + per-asset overrides
- 4. Financing: per-phase tranches (5 drawdown methods × 3 repayment
  methods + IDC capitalization + cash sweep) + Equity contributions

**Hard-cut policy:** v3/v4 snapshots return error "Schema migrated to
v5. Please recreate this project." (module1-migrate.ts isPreV5Snapshot
detects + flags). Supabase migration `m2_0_module1_rebuild.sql` bumps
schema_version DEFAULT 4 -> 5 and auto-archives pre-v5 projects.

**M2.0 deliverables:** v5 types/store/migrate, slim 869-line calc
engine (delete computePlotEnvelope/computeAreaCascade/
computePlotParkingCapacity/allocateParking; add computeAssetBua/
computeAssetSellableBua/computeAssetLandCost/computePhaseCost/
computeAssetCost/computeFinancing + distribute curves), 4 new tab
components, 3-step ProjectWizard rewrite, slim shell components
(Sidebar/Topbar/Dashboard/ProjectsScreen/OverviewScreen/Modals),
single 30.8 KB v5 snapshot baseline, verify-m20.ts (42 pass / 0
fail / 1 skip without dev server), m20-full-flow.spec.ts.

**M2.1 deferred:**
- Modules 2-11: Revenue (cohort collection / hospitality USAH /
  retail NOI / hybrid), OpEx, Returns (IRR / NPV / DSCR / MoIC),
  P&L statements, cash flow, balance sheet, deck export. All
  modules already exist as `export {};` placeholders ready to consume
  the v5 HydrateSnapshot.
- Cash sweep math: today straight-lines outstanding balance; needs
  Module 3 cashflow to drive real surplus-driven principal repayment.
- IDC schedule: today capitalises to balance; full breakdown
  (capitalised vs paid in cash post-construction) ships with Module 5
  statements.
- Excel + PDF exports: stub modal in M2.0; rebuild against v5 in M2.1.
- Wizard polish: type bank auto-pre-fills GFA/BUA defaults from sub-
  unit metric (e.g. count * unitArea) so Tab 2 doesn't need manual
  entry; preset templates ("Saudi mixed-use", "Branded residences",
  "Hotel-led resort") seed Step 3 with industry-typical asset mixes.

**M2.0 pattern decisions for downstream phases:**
- Flat Project -> Phase -> Asset -> SubUnit hierarchy. No more
  Master Holding / Sub-Project / Plot / Zone layers. If a future
  modeling need arises (e.g. portfolio rollup), it's a NEW concept,
  not a return to the M1.5 hierarchy.
- 9 standard cost lines, fixed identity. Users do NOT add cost lines;
  per-asset overrides cover the customisation cases.
- Per-phase tranches with explicit drawdown × repayment matrix.
  Cash sweep + IDC are first-class concepts at the schema level
  (vs M1.x where they were UI-toggle modifiers).
- Land allocation mode is an explicit toggle (sqm / percent /
  autoByBua), not derived. Auto-by-BUA is the recommended default.
- v5 is a hard-cut schema. Future schema bumps (v6+) follow the same
  policy: flag pre-vN snapshots with explicit error rather than
  silently coercing.
- Snapshot baseline is ONE file per major schema version (replacing
  M1's 3-baseline pattern). 30.8 KB v5 baseline at
  scripts/baselines/module1-v5.json.

---

### Module 1 phase history (M1.R through M1.13d, pre-M2.0)
M2.0 (2026-05-06) hard-cut Module 1 to the v5 schema, replacing the v3 / v4 hierarchy (Master Holding / Sub-Project / Plot / Zone / FAR / Cascade / Parking Allocator). The pre-M2.0 narrative (M1.R → M1.5 → M1.5b → M1.6 → M1.7 → M1.8 → M1.9 → M1.9b → M1.10 → M1.10b → M1.11 → M1.12 → M1.13 → M1.13b → M1.13c → M1.13d) plus M1.8 wizard hotfix series and the legacy 3-baseline snapshot diff pattern lives in **CLAUDE-FEATURES.md** under "Module 1 (REFM) Phase History (frozen pre-M2.0)". Read it only if you are excavating an old commit or a deferred-from-M1 issue resurfaces; current work happens against M2.0c on v6.

---


### Health Check
`GET /api/health` -> `{ status: 'ok', platform: 'financial-modeler-pro', version: '3.0', timestamp }`

---

## Modeling Platforms (`src/config/platforms.ts`)

| Slug | Name | Status |
|------|------|--------|
| `real-estate` | Real Estate Financial Modeling (REFM) | Live |
| `bvm` | Business Valuation Modeling | Coming Soon |
| `fpa` | FP&A Modeling Platform | Coming Soon |
| `erm` | Equity Research Modeling | Coming Soon |
| `pfm` | Project Finance Modeling | Coming Soon |
| `lbo` | LBO Modeling Platform | Coming Soon |
| `cfm` | Corporate Finance Modeling | Coming Soon |
| `eum` | Energy & Utilities Modeling | Coming Soon |
| `svm` | Startup & Venture Modeling | Coming Soon |
| `bcm` | Banking & Credit Modeling | Coming Soon |

---

## Key Architectural Notes

### certificateEngine.ts
- PDF generation uses scaleX/scaleY (editor 1240x877 -> PDF points) and per-font ascent correction
- Badge generation reads BadgeLayout from cms_content (section: badge_layout)
- Exports: BadgeLayout, BadgeTextField, DEFAULT_BADGE_LAYOUT, loadBadgeLayout()

### videoTimer.ts
- `getTimerStatus()` accepts optional `timerBypassed` param (from training_settings DB key: `timer_bypass_enabled`)

### sheets.ts
- `normalizeProgressObject()` handles both bestScore/score field names and passed/status detection with score >= 70 fallback
### `/api/branding`
- GET is public (no auth), PATCH requires admin