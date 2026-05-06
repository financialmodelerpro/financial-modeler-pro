# Financial Modeler Pro, Claude Code Project Brief
**Last updated: 2026-05-06 (M2.0c restores full Dev Costs + Financing on v6 schema)**

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

# Module 1 v5 (M2.0) regression-guard snapshot diff (single baseline,
# replaces the 3 retired ones)
npx tsx scripts/module1-v5-diff.ts              # MAAD-Spec v5, 30.8 KB baseline (sha256 0424dde6fb19)

# Per-phase verifier (5 sections: schema/types / calc / state / source markers / Playwright UI)
npx tsx scripts/verify-m20.ts                   # M2.0 MAAD-Spec rebuild (42 pass / 0 fail / 1 skip without dev server)
npx tsx scripts/verify-m20b.ts                  # M2.0b shell restoration (51 pass / 0 fail / 2 skip without dev server / unauth)
npx tsx scripts/verify-m20c.ts                  # M2.0c full Dev Costs + Financing on v6 (54 pass / 0 fail / 2 skip without authenticated dev server)

# Playwright e2e specs (M2.0 v5/v6 contract)
npx playwright test tests/e2e/m20-full-flow.spec.ts        # 2 specs: 3-step wizard create + 4-tab landing (no Land/Build Program/Hierarchy) + 8 light/dark tab screenshots; live-recompute spec asserts editing GFA in Tab 2 updates Tab 3 phase total
npx playwright test tests/e2e/m20b-shell.spec.ts           # 4 specs: brand topbar/sidebar/dashboard chrome + dark-mode body attribute toggle + 3-modal open-close + light/dark screenshots
npx playwright test tests/e2e/m20c-costs-financing.spec.ts # 5 specs: sidebar non-overlay layout + 13-method cost catalog + 6 phasing modes + 5×5 financing matrix + IDC toggle + granularity-aware schedule labels + light/dark screenshots
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

### Module 1 status (2026-05-06, **M2.0c restores full Dev Costs + Financing on v6**)
**M2.0c (current, ships):** Dev Costs + Financing functionality
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