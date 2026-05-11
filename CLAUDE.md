# Financial Modeler Pro, Claude Code Project Brief
**Last updated: 2026-05-12 (M2.0M Pass 4 Financing Cleanup ships: 10 fixes after the Pass 3 diagnostic revealed UI was rendering zero despite unit-tested hooks. Mandatory diagnostic in docs/m20M-pass4-diagnostic.md identified root cause (UI never called createFinancingHooks; computeCapitalStack read deprecated tranche.ltvPct + principal that Pass 3 hid from UI; Pass 3 migration cleared equityContributions[] but stack still walked them). Fixes: (10) force fix zero-rendering, route computeFunding through inputsSummary.totals (project-wide capex aggregate, all phases); bypass computeCapitalStack entirely, derive stack from funding + equity. (9) assetFilter replaces phaseFilter on Tab 4: __combined__ sentinel default; asset dropdown filters Inputs Summary + Schedules. (6) formatAccounting universal helper: zero -> "-", negative -> (n), null/undef -> "", positive -> "1,234,567"; applied across Module1Financing + Module1Costs. (1) Method 2 line-item editable table: dedupe composed line ids via deriveLineBaseId; per-row Debt% input + Equity% auto-derived; replaces "next sub-pass" placeholder. (2) Funding Basis block above facilities: 4 read-only fields (Method, Drawdown Basis, Total Capex, Total Funding Need). (3) Capital Structure Overview restructured: Total Funding lead card + Sources (Total Debt + Equity Cash + Equity In-Kind) + Uses (Total Capex + LTV + match chip). (4) TrancheCard compact 2-per-row grids replacing 4-per-row (Tenor/Availability/Grace/Repayment + output cards). (5) Drawdown periods only: drop period columns where total = 0; bottom row label simplified from "TOTAL Total Funding Required" to just "Total". (7) Schedules restructure: drop standalone Drawdown; replace Repayment with Debt Movement (Opening + Drawdown + Interest Cap + Principal Repaid + Closing); add Finance Cost per facility (Interest Accrued + Paid + IDC Cap + Expensed); renumber 1-7. (8) Equity Schedule -> Equity Movement (Opening + Cash + In-Kind + Closing, mirrors Debt Movement). migrateM20mPass4Financing idempotent (stamps assetFilter='__combined__' on legacy snapshots). M20M_PASS4_NOTICE banner takes priority in resolveBanner cascade. Verifier verify-m20M-pass4.ts 61/0/0 across 12 sections. Schema stays v8 additive.)**

> **See also:**
> - [CLAUDE-DB.md](CLAUDE-DB.md), Database tables, storage buckets, migrations log
> - [CLAUDE-FEATURES.md](CLAUDE-FEATURES.md), Feature status, detailed feature specs & flows, Module 1 phase history (M1.R → M1.13d pre-M2.0 + M2.0 → M2.0i post-rebuild)
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
| Email system | `src/shared/email/` |
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
- Cross-feature shared files (`src/lib/shared/`, `src/shared/email/`) without explicit instruction

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
| Email | Brevo (`@getbrevo/brevo`) | ^5.0.4 |
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
| **Brevo** | Transactional email (migrated from Resend 2026-05-11, commit `166a8ec`) | `BREVO_API_KEY`, `EMAIL_FROM_TRAINING`, `EMAIL_FROM_NOREPLY` |
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
| `BREVO_API_KEY` | Brevo email service key (replaced `RESEND_API_KEY` on 2026-05-11) |
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

# Module 1 regression-guard snapshot diff (single v8 baseline, replaces the legacy 3)
npx tsx scripts/module1-v5-diff.ts              # 47.8 KB baseline (sha256 824ef8e1706d)

# Per-phase verifier (5 sections: schema/types / calc / state / source markers / Playwright UI)
# Canonical green for current state: verify-m20M-pass2.ts (latest Financing surface)
npx tsx scripts/verify-m20M-pass2.ts            # M2.0M Pass 2 Tab 4 Financing cleanup (13 fixes: uniform funding, 3-method repayment, project-level minCash, phase filter, equity surfaced, Total col, 50 pass / 0 fail)
npx tsx scripts/verify-m20costsCleanup.ts       # M2.0M Pass 6 Costs cleanup (9 fixes: count caption, defaults, NDA, method col, land captions, dropdown, locked override, period reducer, plain cells, 36 pass / 0 fail)
npx tsx scripts/verify-m20M.ts                  # M2.0M Financing (schema + migration + hook layer + UI markers, 67 pass / 0 fail / 0 skip)
npx tsx scripts/verify-m20L-pass5.ts            # Category + Driver + auto-derived CostType (31 pass / 0 fail / 0 skip)
npx tsx scripts/verify-m20L-pass4.ts            # parent/child inheritance cost engine (30 pass / 0 fail / 0 skip)
npx tsx scripts/verify-m20L.ts                  # M2.0L cost duplication fix + Financing build (74 pass / 0 fail / 2 skip without dev server)
npx tsx scripts/verify-m20j.ts                  # M2.0j Module 1 audit + display, 16 fixes (60 pass / 0 fail / 2 skip without dev server)
npx tsx scripts/verify-psync.ts                 # P-Sync platform/module admin sync (70 pass / 0 fail / 3 skip)
# Older verifiers (M2.0 through M2.0i) still pass against current state and remain in scripts/.
# See CLAUDE-FEATURES.md "Module 1 (REFM) M2.0 Phase History" for per-verifier scope.

# Playwright e2e (current spec for live state)
npx playwright test tests/e2e/m20L-costs-financing.spec.ts  # 10 specs + dark-mode
npx playwright test tests/e2e/m20j-costs-audit.spec.ts     # 8 specs + dark-mode
npx playwright test tests/e2e/psync-flow.spec.ts           # 4 specs
# Older M2.0 → M2.0i specs (m20-full-flow, m20b-shell, m20d-costs-polish,
# m20e-wizard-tab2, m20f-structural-fixes, m20g-display-recon-costs,
# m20h-area-hierarchy-cost-granularity, m20i-final-polish) live in tests/e2e/
# and remain runnable. m20c-costs-financing.spec.ts is .skip()'d (frozen v6).
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

### Phase P-Sync status (2026-05-07, Platform & Module Admin Sync, three-way source of truth)

**P-Sync (ships):** Closes the loop between three previously disjoint module/platform listings (the static `MODULES` constant in REFM, the legacy `modules` table in admin, the hardcoded marketing `PLATFORMS` config) by adding two new Supabase tables (`platform_modules` + `platform_module_pages`), 9 API endpoints under `/api/platforms/[platformSlug]/modules/...` + `/api/admin/platform-module-pages/...`, an admin 2-level UI at `/admin/platform-modules`, a dynamic REFM sidebar fetch (`usePlatformModules` hook with static fallback), and 3 marketing routes (`/modeling-hub`, `/modeling-hub/[platformSlug]`, `/modeling-hub/[platformSlug]/[moduleSlug]`). RLS public-read filters `status='hidden'` / `visible=false`; service-role bypasses for admin writes. 60s ISR. 7 commits.

Full commit-by-commit narrative archived in **CLAUDE-FEATURES.md** if needed.

**P-Sync conventions (applies to all downstream platform/module work):**
- **Source of truth lives in Supabase, not in TypeScript constants.** M2.1 Revenue and downstream module additions go through `platform_modules` (admin UI) instead of editing `MODULES` in `modules-config.ts`. Static constants stay as bootstrap fallback only.
- **Three-way sync is intentional.** Admin edit → workspace sidebar (`/api/platforms/.../modules`) + marketing site (`/modeling-hub/...`) within 60s ISR. One row update, three surfaces.
- **Page-sections are jsonb, not normalized.** Each marketing section's `content_blocks` holds its own typed shape (`HeroContent` / `FeaturesContent` / `HowItWorksContent` / `CtaContent` / `TestimonialsContent`). Admin edits via JSON textarea.
- **Legacy `modules` table stays** as platforms-storage despite name predating the platform/module distinction. Rename cost > benefit.
- **RLS:** anon role never reads `status='hidden'` modules or `visible=false` page sections. Service-role bypasses for admin writes. No write policies needed for anon.

### Module 1 status (2026-05-12, **M2.0 Costs Cleanup Pass 8**)

**M2.0 Pass 8 (current, ships):** 8 targeted Costs cleanup fixes
following Pass 7 verification. Schema stays v8 additive
(`projectNdaScope` + `asset.subUnitMetric / assetRoadsPct /
assetParksPct / assetNdaEnabled` + `resultsViewMode /
resultsSelectedAssetId` added; `CostLine.costCategory / costDriver`
and `SubUnit.metric` deprecated on schema).

- **Fix 1, NDA placement + scope toggle**: Tab 1 NDA card removed.
  Tab 2 Assets & Sub-units card lives below the Land Parcels totals
  row (light-amber background). New scope toggle (`Project-level` /
  `Per-Asset`): Project mode shows single Roads % + Parks % inputs +
  Gross / Net derivation; Per-Asset mode disables project-level
  inputs and surfaces Apply Roads/Parks + Roads % + Parks % on each
  asset card. Land COST always stays on gross land; NDA only reduces
  developable area consumed by `rate_per_nda` / capacity calcs.

- **Fix 2, sub-unit UX (3 sub-fixes)**:
  - 2a: Units mode = Area + Unit Size as inputs; Count is read-only
    derived (`Count = Area / Unit Size`). Editing Area back-calcs
    count; editing Unit Size preserves displayed Area.
  - 2b: Count header swaps to dynamic label (Units / Keys / Beds /
    Bays / Tenants) per dominant revenue sub-unit category +
    strategy + type via `countUnitLabel`.
  - 2c: `Asset.subUnitMetric` becomes the single source of truth per
    asset; per-row Metric dropdown column removed; asset-level
    Area / Units radio toggle above the sub-unit table converts all
    sub-units when switched (refuses with warning when any row would
    lose non-zero area via `canSwitchMetric`).

- **Fix 3, top-right phase dropdown**: removed from Tab 3 page header
  (Phase Filter inside Inputs sub-tab is sole navigation). Empty
  phase renders a helpful message + keeps Phase Filter active so the
  user can switch phases.

- **Fix 4, drop Category + Driver**: cost line table 11 cols -> 9
  (Cost Line / Method / Value / Start / End / Phasing / Total /
  Toggle / Delete). Pass 5's Direct vs Allocated + driver split
  dropped from UI per user feedback; every cost line is per-asset
  (Pass 7 architecture). `CostLine.costCategory` + `costDriver`
  retained on schema for back-compat; calc engine treats every line
  as Direct. CostRow sub-rows use `colSpan={9}`; AssetCostSection
  tfoot Asset Subtotal label spans cols 1-6.

- **Fix 5, Start/End defaults**: new cost lines default
  `startPeriod=0`, `endPeriod=maxCp+1` where `maxCp = max(phase.constructionPeriods)`.
  Migration clamps legacy lines whose `endPeriod` exceeds
  `maxCp + 1` (e.g. legacy snapshot with hardcoded End=24 on a
  4-period project now lands at 5).

- **Fix 6, %-of-selected picker visibility**: `PercentOfSelectedPicker`
  sub-row `<td colSpan>` synced from stale 11 (left over from Pass 7's
  11-col table) to 9 (Pass 8's 9-col table). The picker contents
  (button + popover + chip strip) were intact from Pass 6 Fix 6;
  only the wrapping row's column span was wrong, causing the picker
  to render misaligned and occasionally clipped.

- **Fix 7, Phase filter no "All Phases"**: Tab 3 Phase Filter drops
  the `'__all__'` sentinel. Default = first phase with at least one
  visible asset (else first phase). Inputs sub-tab matches Pass 7
  one-asset-at-a-time semantics; combined-across-phases view stays
  in Results (P8-Fix 8).

- **Fix 8, Results Combined / Single Asset toggle**: explicit radio
  toggle at the top of Results sub-tab (replaces the M2.0L filter
  pill bar). Single Asset surfaces an asset picker dropdown beside
  the radio. State persists via `Project.resultsViewMode` +
  `resultsSelectedAssetId` so the view survives reload. `SummaryTables`
  rekey on view+asset change so the per-period tables refresh
  immediately. (Deferred per scope: the brief's deep grouping of
  Combined view's Capex by Period by cost-line type with asset
  sub-rows would require exposing per-cost-line per-asset per-period
  data from the calc engine; toggle ships, grouping enhancement
  deferred.)

- **Migration**: `migrateM20costsPass8` is idempotent; runs in all 3
  hydrate chains (`stripV8Wrapper` / `stripWrapper` /
  `migrateLegacyToV8`). Stamps `projectNdaScope='project'` when
  `projectNdaEnabled=true` and scope undefined; backfills
  `asset.subUnitMetric` from the first sub-unit's metric; clamps
  `costLine.endPeriod` to `maxCp+1`; defaults
  `project.resultsViewMode='combined'`. `M20_PASS8_NOTICE` banner
  surfaces once on first hydrate. `resolveBanner` prioritizes
  Pass 8 ahead of Pass 3 / Pass 7.

- **Verifier**: `scripts/verify-m20costsCleanup-pass8.ts` 41 pass /
  0 fail / 0 skip across 10 sections.

Commits (10): `ae02b6f` (design note) - `31a3712` (Fix 1) -
`7873107` (Fix 2) - `9cdd579` (Fix 4) - `f69c7bd` (Fix 5) -
`3ebb9f1` (Fix 6) - `fb3dd91` (Fix 7) - `7831538` (Fix 3) -
`8bc9c02` (Fix 8) - closure (migration + verifier + CLAUDE.md).
Type-check clean on every commit.

### Module 1 status (2026-05-12, **M2.0M Pass 4 Tab 4 Financing cleanup**)

**M2.0M Pass 4 (current, ships):** 10 fixes + mandatory diagnostic
after Pass 3 verification revealed Tab 4 was rendering zero despite
unit-tested hooks. Schema stays v8 additive (`assetFilter` added to
`ProjectFinancingConfig`).

- **Mandatory diagnostic** at `docs/m20M-pass4-diagnostic.md` (commit
  first). Root cause: UI never called `createFinancingHooks` (hook
  contract was documented but unconsumed); `computeCapitalStack`
  read deprecated `tranche.ltvPct` + `tranche.principal` that Pass 3
  hid from UI; Pass 3 migration cleared `equityContributions[]` but
  stack still walked them. Three intertwined bugs combined to render
  zero across all schedules.

- **Fix 10 (force fix zero-rendering)**: route `computeFunding`
  through `inputsSummary.totals` (project-wide capex aggregate
  across ALL phases). Bypass `computeCapitalStack` entirely; derive
  stack directly from `funding + equity`. `phaseTranches` debt
  breakdown uses `tranche.facilitySharePct`. MAAD-shape fixture
  (1 phase, 1 asset, BUA 130874, rate 4500) now renders 588.9M
  in Capital Structure Overview Total Funding card.

- **Fix 9 (assetFilter replaces phaseFilter)**: new
  `Project.financing.assetFilter?: string` (sentinel
  `__combined__` = all assets). Top-of-Tab-4 dropdown rebuilt as
  Asset Filter (`data-testid="financing-asset-filter"`); options =
  Combined + per-asset (visible only). `phaseFilter` retained on
  schema for back-compat (no longer rendered).

- **Fix 6 (universal accounting format)**: new `formatAccounting`
  helper in `src/core/formatters/index.ts`. Contract: zero -> `"-"`
  (en-dash), negative -> `(1,234)` (parentheses), null / undefined ->
  `""` (blank), positive -> `1,234,567` (scaled, no K/M suffix). Page
  header line keeps the scale indicator. Applied across
  Module1Financing (3 sites) + Module1Costs Results.

- **Fix 1 (Method 2 line-item table)**: `renderMethodInputs(id=2)`
  replaces the "next sub-pass" placeholder with a real editable
  table. Rows = unique cost-line `baseId`s (composed
  `${baseId}__${phaseId}__${assetId}` deduped via `deriveLineBaseId`).
  Each row: Cost Line label + Debt % editable input + Equity %
  auto-derived (100 - debtPct). Writes to
  `financingConfig.lineItemRatios.master[]` keyed by baseId.

- **Fix 2 (Funding Basis block)**: new card
  `data-testid="financing-funding-basis"` between Funding Method
  radio and Land Funding section. 4 read-only fields: Method
  (active method label), Drawdown Basis (per-method source math
  description), Total Capex (excl Land In-Kind), Total Funding Need.

- **Fix 3 (Capital Structure Overview content)**: leads with Total
  Funding as headline KPI; splits Sources (Total Debt + Equity Cash
  + Equity In-Kind sub-cards) and Uses (Total Capex + LTV +
  Sources-vs-Uses chip) into clearly labelled blocks. New
  data-testids: `cap-stack-total-funding`, `cap-stack-equity-cash`,
  `cap-stack-equity-inkind`; dropped: `cap-stack-equity`,
  `cap-stack-sources` (redundant with Total Funding).

- **Fix 4 (compact field layout)**: TrancheCard inputs and outputs
  reflow from 4-per-row to 2-per-row grids. Tenor / Availability
  pair, Grace / Repayment pair; output cards (Total Debt Drawn /
  Total Interest / Total Repayment / Periodic Rate) reflow 4x1 to
  2x2. Other rows already at 3-per-row max.

- **Fix 5 (drawdown periods only + Total row label)**: Inputs
  Summary Tables drop period columns where the funding total = 0
  (operations periods stay hidden). Active period set derived once
  from `totalsRow` and shared across all 3 sub-tables. Bottom row
  label changed from `"TOTAL Total Funding Required"` (read as
  duplicated TOTAL Total) to just `"Total"`. Total row styling
  kept: grey-pale fill + bold weight.

- **Fix 7 (Schedules restructure)**: drop standalone Drawdown
  schedule; replace Repayment with Debt Movement per facility
  (Opening Balance + Drawdown + Interest Capitalized + Principal
  Repaid + Closing Balance, ledger-style); add Finance Cost per
  facility (Interest Accrued + Interest Paid + IDC Capitalized +
  Expensed Interest = dual P&L vs cash tracking M5 will consume).
  Renumber: 1 Capital Stack Summary, 2 Debt Movement, 3 Combined
  Debt Service, 4 Finance Cost, 5 IDC Summary, 6 Equity Movement,
  7 Capital Stack Movement.

- **Fix 8 (Equity Movement)**: replace Equity Schedule with Equity
  Movement (Opening Equity + Cash Contributions + In-Kind
  Contributions + Closing Equity). Mirrors Debt Movement shape for
  visual symmetry.

- **Migration**: `migrateM20mPass4Financing` (idempotent) stamps
  `assetFilter = '__combined__'` on any snapshot whose
  `project.financing.assetFilter` is undefined. Banner
  `M20M_PASS4_NOTICE` takes priority in `resolveBanner` cascade
  ahead of Pass 3 / earlier banners. Wired into all 3 hydrate
  chains (stripV8Wrapper / stripWrapper / migrateLegacyToV8).

- **Verifier**: `scripts/verify-m20M-pass4.ts` 61 pass / 0 fail / 0
  skip across 12 sections (diagnostic file presence + Fix 10 MAAD
  fixture aggregation + Fix 9 schema/migration/UI + Fix 6
  formatAccounting contract & adoption + Fix 1 Method 2 table
  source markers + Fix 2 Funding Basis test-ids + Fix 3 Cap Stack
  cards + Fix 4 compact grids + Fix 5 activePeriods filter + Fix 7+8
  Debt Movement / Finance Cost / Equity Movement / Opening+Closing
  rows + em-dash sweep + banner cascade order).

Commits (10): `d370b64` (mandatory diagnostic) - `b297594` (Fix 10
force fix zero-rendering) - `1404bc1` (Fix 9 asset filter) -
`34326fa` (Fix 6 accounting format) - `465f041` (Fix 1 Method 2 table) -
`23bdba4` (Fix 2 Funding Basis block) - `9c36ec7` (Fix 3 Cap Stack
content) - `2b912f7` (Fix 4 compact fields) - `8f96e25` (Fix 5
drawdown periods + total row) - `35a6c92` (Fix 7+8 Schedules
restructure) - closure (verifier + CLAUDE.md). Type-check clean on
every commit.

### Module 1 status (2026-05-12, **M2.0M Pass 3 Tab 4 Financing cleanup**)

**M2.0M Pass 3 (ships, superseded by Pass 4):** 10 targeted Tab 4 fixes
simplifying the financing surface. Schema stays v8 additive
(`facilitySharePct` + `scope` re-exposed on `FinancingTranche`; all
deprecations keep their fields for back-compat).

- **Fix 1, drop Single Asset toggle**: Tab 4 Inputs always operates
  on Combined Project basis. The Combined / Single Asset toggle is
  removed; `viewMode` field stays on schema. Migration flips legacy
  `viewMode='single_asset'` to `'combined'` and clears
  `selectedAssetId`.

- **Fix 2, capex hook audit**: `getCapexExclLandInKind` (and
  siblings) verified to read per-asset cost lines correctly post
  Pass 7 (each line's `targetAssetId` matches its asset; aggregation
  across phases yields non-zero). Added new hooks
  `getCapexSchedule(assetId?)` (per-asset capex series) and
  `getLandCashValue()` (parcels' total cash share) per brief's
  hook list. MAAD-shape fixture (130,874 BUA x SAR 4,500/BUA) sums
  to SAR 588,933,000 as expected.

- **Fix 3, facility ratio inherits**: per-facility Debt % + Principal
  inputs dropped from `TrancheCard`. Facility principal auto-derives
  from chosen funding method (Method 1: total capex x debt%;
  Method 2: cost-line ratios; Method 3: net funding x debt%;
  Method 4: cash deficit x debt%). New optional
  `FinancingTranche.facilitySharePct` (0..100, sums to 100% across
  facilities in the same scope) surfaces when `facilityCount > 1`;
  single facility defaults to 100. Migration defaults missing
  multi-facility shares to even split.

- **Fix 4, re-add asset scope**: `FinancingTranche.scope:
  'project' | 'phase' | 'asset'` re-exposed on schema + UI dropdown.
  Asset-specific opens an asset picker; phase-specific opens a phase
  picker. Pass 2 hid the asset option; Pass 3 restores it.

- **Fix 5, drop drawdown method dropdown**: per-facility drawdown
  method picker + its conditional inputs (`drawdownIncludeLand`
  checkbox / `drawdownMinCashFloor` input) removed. Drawdown timing
  auto-derives from chosen funding method. `drawdownMethod` +
  related fields stay on schema for back-compat.

- **Fix 6, simplify repayment**: Equal Total / Equal Principal
  sub-method dropdown removed. Equal Repayment defaults to
  equal_principal (declining balance). Cash Sweep drops the sweep
  ratio input (both inline + Advanced section copies); defaults to
  100% of excess cash above project minimum cash reserve.
  `equalRepaymentSubMethod` + `cashSweepConfig.sweepRatio` +
  `FinancingTranche.sweepRatio` stay on schema.

- **Fix 7, drop Equity Tranches section**: entire Equity Tranches
  table (Name / Type / Source / Amount / Timing / IRR Hurdle /
  Pref. Return / Auto-marker) removed from Inputs. Equity
  auto-computes: `Total Equity Need = Total Funding x equity%`,
  `Cash Equity = Total Equity - Land In-Kind value`. Land In-Kind
  auto-detects from Tab 3 Land In-Kind cost lines via existing
  `computeEquity` helper. `equityContributions[]` stays on schema;
  migration clears stale data.

- **Fix 8, Inputs Summary Tables**: 3 stacked tables at bottom of
  Inputs sub-tab. Each renders per-asset rows (project-wide, all
  phases) x project periods, Total in 2nd position.
  - Total Funding Required = per-asset capex per period (excl Land
    In-Kind, sums to project Total Funding).
  - Total Debt Required = Funding x debt% from method.
  - Total Equity Required = Funding x equity%, with Cash + In-Kind
    sub-rows under the Total row. In-Kind Equity lumps at period 0
    (matches Land In-Kind cost line timing).
  - Asset rows with total = 0 filtered out.

- **Fix 9, Schedules math + All Phases aggregation**: closing
  balance formula verified: `Closing = Opening + Drawdown + IDC
  Capitalized - Principal Repaid` (interest paid is a separate
  cash event; does not affect debt balance). `phaseFilter='__all__'`
  now walks ALL facilities project-wide; each facility computes
  against its OWN phase's capex via `computePhaseCost` so multi-
  phase projects show every facility aligned to its phase
  timeline. `ScheduleTable` already routes `total='-'` for balance
  rows + sum-string for flow rows.

- **Fix 10, Auto-IDC integration**: `applyIdcToCapex` continues to
  emit `AutoIdcCostLineSeed` entries keyed by `targetAssetId` for
  every funded asset under a Capitalize-treatment facility. Tab 3
  per-asset cost line table renders the locked `auto-idc__*` rows
  in the appropriate asset's section. Cross-tab integration
  preserved through Pass 7's per-asset rewrite.

- **Migration**: `migrateM20mPass3Financing` is idempotent; runs in
  all 3 hydrate chains (`stripV8Wrapper` / `stripWrapper` /
  `migrateLegacyToV8`). `M20M_PASS3_NOTICE` banner surfaces once on
  first hydrate of a pre-Pass-3 snapshot. `resolveBanner`
  prioritizes Pass 3 ahead of Pass 7.

- **Verifier**: `scripts/verify-m20M-pass3.ts` 42 pass / 0 fail /
  0 skip across 12 sections. Asserts migration semantics (viewMode
  flip, equityTranches clearance, even-split facilitySharePct,
  idempotency), capex hook MAAD math, all UI source markers,
  closing balance formula via `computeFinancing` on a zero-rate
  fixture, `applyIdcToCapex` seed shape, em-dash sweep, design
  note presence. Playwright deferred per brief.

Commits (10): `9778a55` (design note) - `dd9eee8` (Fix 1) -
`72777d6` (Fix 3) - `0db5f27` (Fix 5) - `4148464` (Fix 6) -
`ad0f296` (Fix 7) - `037c45e` (Fix 4) - `dfa31a9` (Fix 8) -
`2af13ab` (Fix 9) - final commit (Fix 2 + Fix 10 + verifier +
CLAUDE.md). Type-check clean on every commit.

### Module 1 status (2026-05-12, **M2.0M Pass 7 Costs Architecture Simplification + 6 polish fixes**)

**M2.0M Pass 7 (current, ships):** Drops the Pass 4 master + replica
inheritance surface entirely. Tab 3 Inputs is now per-asset only:
phase filter + asset pill bar + single editable table for the
selected asset. CostOverride[] deprecated (schema retained for legacy
snapshot compat; migration flattens the data, UI no longer reads or
writes). Schema stays v8 additive.

- **Fix 5 (architecture rewrite)**: every `CostLine` carries required
  `targetAssetId`; composed id pattern `${baseId}__${phaseId}__${assetId}`
  for global uniqueness. `migrateM20costsPass7PerAsset` walks legacy
  snapshots, replicates each master line per visible phase asset
  (folds matching CostOverride values onto each replica per the
  same field-by-field resolution as Pass 4), drops orphan per-asset
  lines whose `targetAssetId` no longer exists, drops master lines
  in phases with zero visible assets, rewrites `selectedLineIds`
  cross-references to point at same-asset replicas, clears
  `costOverrides[]`. Idempotent on every hydrate
  (`stripV8Wrapper` / `stripWrapper` / `migrateLegacyToV8`).
  `M20COSTS_PASS7_NOTICE` banner surfaces once per migrated snapshot.

- **Fix 5b/6 (Inputs UI)**: phase filter dropdown
  (`costs-inputs-phase-filter`) + asset pill bar
  (`costs-inputs-asset-pills`) + per-asset stats summary
  (`costs-inputs-asset-stats-{id}`) + single `AssetCostSection` for
  the active asset. Add Custom Cost button emits a line with
  `id: custom-${Date.now()}__${phaseId}__${assetId}`,
  `targetAssetId` set, `costCategory: 'direct'`. Override callbacks
  pass-through as no-ops (override surface removed).

- **Fix 1 (Tab 2 NDA)**: per-parcel `NDA?` + `Roads %` + `Parks %` +
  `NDA (sqm)` + `{currency}/NDA sqm` columns removed from the parcels
  table. New project-level NDA summary card lives below the Total
  Land row: Apply NDA Deduction toggle + Roads % + Parks % inputs +
  explicit derivation (`Gross NDA = Total Land x (100% - Roads% - Parks%) = X x Y% = Z sqm` + `Net NDA = Gross NDA - (other) = Z sqm`).
  Reads/writes the existing `project.projectNdaEnabled` /
  `projectRoadsPct` / `projectParksPct` fields wired in Pass 6.

- **Fix 2 (sub-unit verification)**: `AssetAreaReconciliationBlock`
  rewritten to a single inline line: `Verification: BUA X | NSA X | Eff X% | Land X | Land Cost X`. expand/collapse + localStorage state
  (`m20i-asset-recon-collapsed`) dropped. Mismatch state (sub-units
  exist with Support/Parking but NSA = 0) surfaces ⚠ + caveat
  suffix.

- **Fix 3 (sub-units table)**: explicit colgroup (Type 14%,
  Category 11%, Metric 9%, Area 12%, Unit Size 10%, Count 9%,
  Rate 13%, Total Revenue 17%, X 5%) with `table-layout: fixed`.
  All columns always render. Area cell: Area mode keeps the editable
  input; Units mode renders a read-only derived caption
  (`count x unitArea = total area` + italic readout). Unit Size +
  Count cells render muted dashes in Area mode and editable inputs
  in Units mode. New Total Revenue (No Indexation) column =
  `metricValue x unitPrice` (Area: area x rate; Units: count x rate);
  read-only via `formatScaled`.

- **Fix 4 (Costs Input table)**: `table-layout: fixed` + explicit
  colgroup per brief: Cost Line 220 · Method 200 · Category 100 ·
  Driver 100 · Value 120 · Start 60 · End 60 · Phasing 100 · Total
  140 · Toggle 60 · Delete 40. Category + Driver dropdowns split
  from the Method cell into their own columns; Driver cell renders
  a muted dash when `costCategory='direct'`. Toggle column = On/Off
  checkbox + optional reset; Delete column = ✕ button with confirm
  dialog (hidden on locked seed lines: Land Cash / Land In-Kind /
  auto-IDC). `title` tooltip + `overflow: hidden` on every editable
  cell so overflow labels stay legible. CostRow sub-rows (Manual %
  editor / per-row money chip strip / per-sub-unit custom rates /
  PercentOfSelectedPicker) span `colSpan={11}`. AssetCostSection
  tfoot Asset Subtotal label spans cols 1-8, subtotal value in col
  9 (Total).

- **Fix 7 (Results)**: no changes per brief.

- **Verifier**: `scripts/verify-m20costsCleanup-pass7.ts` (52 pass /
  0 fail / 2 skip without dev server) covers migration semantics
  (replica counts + override fold + orphan drop + empty-phase drop
  + banner), per-asset Inputs source markers, Tab 2 NDA project-level
  card markers + per-parcel column removal, single-line sub-unit
  verification markers, sub-units table colgroup + Total Revenue
  column, Costs Input 11-column table + colgroup widths +
  Category/Driver split + colSpan={11} sub-rows, em-dash sweep on
  touched files, design note presence. Playwright spec deferred
  (verifier + manual smoke cover the surface).

- **Deferred per brief**: dedicated Project Common Costs section
  above asset pills (allocated lines still attach to the first
  visible asset; promotion deferred pending user feedback). Results
  sub-tab tweaks (Pass 7 leaves Results untouched per brief).

Commits (6): `b93ffbd` (design note) · `64583b3` (P7-Fix 5a schema +
migration) · `384b9e4` (P7-Fix 5b/6 per-asset Inputs UI) · `00e7a72`
(P7-Fix 1 NDA card) · `80b8f1b` (P7-Fix 2 sub-unit verification) ·
`528703f` (P7-Fix 3 sub-units table + Total Revenue) · `16eb88b`
(P7-Fix 4 cost table widths balanced). Type-check clean on every
commit.

### Module 1 status (2026-05-11, **M2.0M Pass 2 Tab 4 Financing cleanup**)

**M2.0M Pass 2 (current, ships):** 13 Tab 4 cleanup fixes simplifying
the financing surface. Schema stays v8 additive (`minimumCashReserve`
+ `phaseFilter` lift to project.financing top level; new repayment
sub-mode + cash-sweep config on FinancingTranche).

- **Fix 1, uniform funding pipeline.** New `computeFunding(method, ctx)`
  returns `{ totalNeed, periodArray, debtEquitySplit }` for every
  method. Step 1 (totalNeed + periodArray) is method-specific:
  Methods 1+2 = sum/distribute capex; Method 3 = net of pre-sales +
  OCF + existingCash + minCash; Method 4 = period-by-period walk
  filling to minCash floor. Steps 2-3 (ratio split, debt+equity per
  period) are uniform.

- **Fix 2, LTV -> Debt %.** TrancheCard input label + placeholder
  switched to "Debt %". Schema field stays `tranche.ltvPct`. LTV
  Covenant input + Capital Stack output ratio (real banker terms)
  preserved.

- **Fix 3, facility type dropdown hidden.** UI removes the
  `senior_construction / mezzanine / bridge / ...` dropdown. Schema
  field retained; new facilities default `senior_construction`.

- **Fix 4, MAAD refs dropped.** Drawdown label
  `'Cash-Available Basis (MAAD)' -> 'Cash-Available Basis'`. The only
  user-facing MAAD string in the codebase.

- **Fix 5, repayment methods reduced to 3.** New `RepaymentMethod`
  user-facing values: `equal_repayment` (sub-mode: `equal_total`
  annuity or `equal_principal` declining), `year_on_year_pct` (per-
  period %), `cash_sweep` (`cashSweepConfig: { startingYear,
  sweepRatio }`). UI iterates `REPAYMENT_METHODS_USER` (3 values).
  Legacy 9-value type kept on schema; `migrateM20mPass2Financing`
  maps legacy values:
  - `straight_line -> equal_repayment + equal_principal`
  - `equal_periodic_amortization -> equal_repayment + equal_total`
  - `cashsweep_* -> cash_sweep` (config built from
    `sweepStartPeriod / sweepRatio`)
  - `bullet -> equal_repayment` (tenor=1) `+ equal_total`
  - `balloon -> year_on_year_pct`
  - `manual -> year_on_year_pct` (carries
    `repaymentManualDistribution`)
  - `custom_schedule -> year_on_year_pct`

- **Fix 6, minimumCashReserve at project level.**
  `Project.financing.minimumCashReserve` is now the canonical cash
  floor across all 4 methods and the cash-sweep repayment. Top of
  Tab 4 Inputs renders the input + caption. Method 4's redundant
  per-method input retired. Migration lifts legacy
  `cashDeficitConfig.minimumCashReserve` to the top-level field when
  absent.

- **Fix 7, IDC treatment 2 options.** Dropdown reduced to Capitalize /
  Expense. Mixed retained on schema for back-compat;
  migration folds `idcTreatment='mixed' -> 'capitalize'`.
  `idcMixedSplitPeriod` input removed from UI.

- **Fix 8, asset scope dropdown removed.** Per-facility per-asset
  narrowing dropdown gone; facility scopes by phase via active phase
  filter. Migration converts any `scope='asset'` to
  `scope='phase'` using the parent phase of `scopeId`/`assetId`.

- **Fix 9, Financing cells use `formatScaledForExport`.** Both the
  TrancheCard schedule cells and the root component's schedule cells
  drop the K/M suffix per cell; scale indicator stays on the page
  header line.

- **Fix 10, Phase Filter "All Phases".** New
  `project.financing.phaseFilter` (sentinel `'__all__'` default).
  Top-of-Tab-4 dropdown shows "All Phases" + one option per phase.
  Selecting a specific phase also sets `activePhaseId` so the Inputs
  editor renders that phase's facilities + parcels + equity.
  Schedules aggregate across phases when filter is `'__all__'`
  (further consumed by the Capital Stack sources table + facility
  schedules already iterating `phaseTranches` via the resultsMap).

- **Fix 11, equity surfaced.** New
  `computeEquity(financing, fundingResult, landInKindValue)`
  returns `{ totalEquityNeed, inKindContribution, cashContribution,
  cashPerPeriod, inKindPerPeriod, openingPerPeriod, closingPerPeriod }`.
  Cash equity timing mirrors debt drawdown timing; in-kind lumps at
  period 0. Capital Stack Summary gains a Sources table with Equity
  (Cash) + Equity (In-Kind) rows + per-facility debt rows + totals
  row + Total Uses + match/gap chip. Schedules sub-tab gains "6.
  Equity Schedule" with Cash Contributions + In-Kind Contributions
  + Closing Equity rows. Capital Stack Movement renumbered to 7.

- **Fix 12, Total column 2nd position.** `ScheduleTable` accepts
  `total?: number | string` per row. Header now has a Total <th> in
  2nd position; flow rows pass `total: <sum-fmt-string>`; balance
  rows (Cumulative Drawn, Outstanding Balance, Closing Equity) pass
  `total: '-'`. Wired across Drawdown / Repayment / Combined Debt
  Service / Equity Schedule / Capital Stack Movement.

- **Fix 13, auto IDC cost line preserved.** `applyIdcToCapex` at
  `src/core/calculations/index.ts:1764-1767` skips on
  `treatment === 'expense'` only; Capitalize + legacy Mixed both
  emit. Pass 2 migration folds Mixed -> Capitalize. No code change.

- **Verifier**: `scripts/verify-m20M-pass2.ts` 50 pass / 0 fail.
  Asserts schema additions, migration mapping (8 scenarios across
  Fix 5/6/7/8/10 + idempotency), uniform funding shape across all 4
  methods (with totalNeed math checks for Methods 1/3/4), equity
  computation (total/cash/in-kind/period-array sums), UI source
  markers (12 needles across the 8 UI-touching fixes), auto IDC
  line preservation, and em-dash sweep across the 2 new files.

### Module 1 status (2026-05-11, **M2.0M Pass 6 Costs cleanup**)

**M2.0M Pass 6 (current, ships):** 9 targeted Costs fixes layered
on M2.0M. Schema stays v8 additive (`Project.projectParksPct?` +
`Project.projectNdaEnabled?` are the only new fields).

- **Fix 1, dynamic count caption (Tab 2 sub-units).** New
  `countUnitLabel(category, strategy, assetType)` helper renders a
  small caption beneath each Count cell adapting to context: Sellable
  -> "units", Operable + Operate -> "keys", Operable + healthcare-
  tagged type -> "beds", Leasable -> "tenants", Support -> "items".
  Header stays "Count"; only the caption swaps.

- **Fix 2, default Display Scale + Decimals.**
  `makeDefaultProject()` seeds `displayScale='thousands'` +
  `displayDecimals=0`. New `migrateM20mPass6DisplayDefaults` runs at
  the tail of every hydrate chain: ONLY flips snapshots that carry
  the exact pre-Pass-6 default combo (`full` + 2) -> (`thousands` +
  0). Any explicit user customisation (e.g. millions+1, full+1) is
  preserved verbatim. Percentages stay at 2 decimals via
  `formatPercent` default.

- **Fix 3, project-level Roads/Parks NDA.** New
  `Project.projectNdaEnabled` + `projectParksPct` (additive).
  `Project.projectRoadsPct` was already on schema; Pass 6 wires the
  toggle. Calc engine `resolveAssetAreaMetrics` reads project-level
  first: when `projectNdaEnabled=true`, applies
  `(projectRoadsPct + projectParksPct)` uniformly to phase land
  area; per-parcel `hasNdaDeduction` is ignored. Schema fields stay
  on `Parcel` for back-compat. `migrateM20mPass6NdaToProject` rolls
  up legacy per-parcel toggles into the project-level fields via
  area-weighted average. Tab 1 gains a "Roads + Parks Deduction
  (NDA)" card; Tab 2 surfaces a notice when project-level is on
  ("Per-parcel NDA toggles are kept for reference but do not affect
  calculations").

- **Fix 4, Method column width.** Master cost table now uses
  `tableLayout='fixed'` with `<colgroup>` widths; Method column
  capped at 200px. Per-asset replica Method cell uses
  `maxWidth: 200 + textOverflow: ellipsis + whiteSpace: nowrap`
  with `title={methodLabel}` hover tooltip on truncation.

- **Fix 5, Land cost derivation captions.**
  `costLineCaption` rewrites for `percent_of_cash_land` /
  `percent_of_inkind_land` / `percent_of_total_land`. Healthy
  path: `"{landSqm} sqm x {cashLandValue/landSqm}/sqm (cash) =
  {total}"`. Pointed warnings on zero-land (`"no land allocation
  to this asset defined yet"`), zero-rate (`"no parcel rate defined
  yet"`), zero cashPct edge case. Master Total cell already
  renders the right number when parcels carry value (autoByBua
  fallback at `computeAssetLandSqm:191-195` verified working).

- **Fix 6, `PercentOfSelectedPicker` dropdown.** Replaces the inline
  checkbox grid with a compact dropdown button
  `"Select lines (X selected)"`. Click opens a 320-480px popover
  containing the sibling list (240px scroll cap); transparent
  backdrop click-outside closes; explicit Done button. Selected
  lines also render as removable chips beneath the button.
  Scales to any number of sibling lines.

- **Fix 7, Locked-line override block.** Per-asset replica rows for
  any line with `isLocked=true` (Land Cash / Land In-Kind /
  Auto-IDC) render a non-interactive "Locked" chip instead of the
  Override button; `toggleOverride` short-circuits. Tooltip
  explains where the underlying value comes from.

- **Fix 8, Period column reducer.** Replaces the legacy
  `constructionStart - 1 + cp` reducer (which ignored phase
  startDate offsets) with a phaseStartYear-aware reducer:
  `Math.max(offset + cp)` where `offset = phaseStartYear -
  projectStartYear`. Aligns with the per-phase offset that the
  render path at `Module1Costs.tsx:1485-1494` applies, so columns
  extend exactly to the latest phase end (no spill, no truncation).

- **Fix 9, Plain numbers in Results cells.** `SummaryTables fmt`
  switches from `formatScaled` to `formatScaledForExport`, dropping
  the K / M suffix per cell. The Results sub-tab header line
  (`currencyHeaderLine`) still carries the scale indicator
  ("All figures in SAR '000"). Inputs sub-tab unaffected.

- **Verifier**: `scripts/verify-m20costsCleanup.ts` 36 pass / 0
  fail across 9 sections (one per fix). Asserts schema additions,
  migration smart-detection (3 scenarios per Fix 2; 3 scenarios
  for Fix 3 NDA migration), UI source markers, calc correctness
  (autoByBua fallback returns non-zero, project-NDA produces
  correct deduction), and caption derivation.

### Module 1 status (2026-05-11, **M2.0M Financing definitive rewrite**)

**M2.0M (current, ships):** Tab 4 Financing becomes the "funding
layer." Routes upstream data through parameter-named hooks instead
of hard-wiring against module names, so when Revenue / OpEx / Cash
Flow engines ship later, hook implementations flip from zero-stubs
to real values and consumer code does NOT change. Schema stays v8
additive.

- **Hook layer** at `src/hubs/modeling/platforms/refm/lib/financing-hooks.ts`
  exposes `FinancingDataHooks`: `getCapexExclLandInKind` /
  `getCapexInclLandInKind` / `getCapexExclTotalLand` /
  `getLandInKindValue` aggregate `AssetCostBreakdown` via
  `costLineProjectPeriodIndex` (memoised); `getPreSalesCollections` /
  `getOperatingCashFlow` / `getDepreciationSchedule` /
  `getRevenueSchedule` / `getOperatingExpenses` return zero-stubs
  until upstream engines land; `getClosingCashBalance(prevPeriod)`
  walks a local cash simulation (initial cash + cumulative debt
  drawdown at ratio - cumulative capex - interest paid) that the M3
  Cash Flow engine replaces in-place when it ships.
  `createNoopHooks(totalPeriods)` helper for component tests.
  Hook names are STABLE; future engines populate them, never rename
  them. Full contract in `docs/financing-hooks.md`.

- **Schema additions** (all optional, v8 additive):
  `Project.financing?: ProjectFinancingConfig` carries
  `fundingMethod: 1|2|3|4`, per-method config (`fixedRatio` /
  `lineItemRatios` / `netFundingConfig` / `cashDeficitConfig`),
  `parcelFunding: ParcelFundingConfig[]`, `viewMode:
  'combined'|'single_asset'`, optional `selectedAssetId`. New enums:
  `FundingMethodId`, `ParcelFundingType` (5 values: `100pct_equity` /
  `100pct_debt` / `custom_split` / `in_kind` / `deferred_payment`),
  `FundingViewMode`. Per-method config interfaces +
  `DEFAULT_PROJECT_FINANCING_CONFIG` exported as the migration default
  (Method 1, 70/30, combined view, no parcel configs).
  `CostOverride` gains `debtPctOverride` + `equityPctOverride` for
  Method 2 per-asset ratio overrides via the Pass 4 inheritance
  pattern (no separate map).

- **Funding methods**:
  - **Method 1, Fixed Ratio**: single global `debtPct/equityPct`
    applied to `getCapexExclLandInKind()`. Drawdown follows capex
    schedule × debt%.
  - **Method 2, Line-Item Based**: each cost line carries its own
    debt% / equity% in a master template; per-asset override via
    Pass 4 inheritance (new `CostOverride.debtPctOverride` +
    `equityPctOverride` fields, no separate map). Calc-engine wiring
    iterates in next sub-pass; inputs persist today.
  - **Method 3, Net Funding Requirement**: `capex - pre-sales -
    operating CF - existing cash`, then split by ratio. Pre-sales +
    OCF hooks return zero today so behaves like Method 1 until
    Revenue + CF engines ship.
  - **Method 4, Cash Deficit Funding**: period-by-period. When
    `getClosingCashBalance(t-1) < minimumCashReserve` (scalar or
    PeriodArray), draw debt + equity per ratio to fill the gap.
    Today's closing-cash uses the local sim; swaps to M3 output
    when CF ships.

- **Land special treatment** (per parcel, separate from the 4
  methods): default `100pct_equity`. `100pct_debt` rare; landowner
  in-kind auto-detected from Tab 3 `land-inkind` cost line; deferred
  payment carries its own start/end + phasing. Optional
  `facilityId` links debt-funded land to a specific facility.

- **Migration**: `migrateM20MFinancing` (idempotent) stamps a
  Method-1 / 70-30 / combined-view wrapper on any snapshot whose
  `project.financing` is undefined. Banner `M20M_FINANCING_NOTICE`:
  *"Financing module upgraded. Configure your funding method and
  capital stack in Tab 4."* Wired into `resolveBanner` ahead of
  Pass 5 / Pass 4 / M20H banners. `makeDefaultProject` seeds the
  wrapper on fresh projects. Runs in `stripV8Wrapper`,
  `stripWrapper`, and `migrateLegacyToV8` chains.

- **UI** at top of Tab 4 Inputs sub-tab adds 3 cards above Capital
  Structure: (1) View toggle `[Combined Project] [Single Asset ▼]`
  with asset dropdown when Single; (2) Funding Method radio with
  4 options + per-method input panel (`renderMethodInputs`); (3)
  Land Funding per parcel with type dropdown + conditional inputs
  per type (custom_split shows debt/equity inputs, in_kind shows
  auto-detect note, deferred shows scheduler note). Helpers
  `setFinancingConfig(patch)` + `upsertParcelFunding(parcelId,
  patch)` on the component layer.

- **Deferred per brief** (acceptable):
  - Methods 2-4 full calc-engine wiring (inputs persist today;
    Method 2 line-item application, Method 3 net-of-revenue, Method
    4 period-by-period deficit math arrive when upstream engines
    ship via the hook contract).
  - Real `getClosingCashBalance` from M3 Cash Flow engine.
  - Cash sweep based on real OCF.
  - Playwright spec (verifier + dev-server smoke covers schema +
    hooks + UI source markers; full Playwright deferred).
  - DSCR / LTV covenant breach alerts (M5 dependency).

- **Verifier**: `scripts/verify-m20M.ts` 67 pass / 0 fail / 0 skip
  across 7 sections (schema + migration + `makeDefaultProject` seed
  + design notes on disk + hook contract execution with capex sum
  + memoisation + period alignment + UI source markers + em-dash
  sweep across 5 new files).

### Module 1 status (2026-05-11, **M2.0L + 4-fix follow-up**)

**M2.0L follow-up (current, ships):** Four targeted fixes layered on
top of M2.0L. Schema stays v8 additive (`Project.costInputMode?` is
the only new field).

- **Fix 1, graceful legacy-project migration**:
  `module1-migrate.ts` adds `isLooseSnapshot()` (accepts any object
  with `project` field or any data array) and `migrateLegacyToV8()`
  that backfills every missing optional field per M2.0g/h/i/j/L
  additions, renames legacy `'Hybrid'` strategy to `'Sell + Manage'`,
  remaps v6 cost-line ids (`site-prep` / `structural` / `mep` / etc.)
  to closest v7 standards, then pipes through the full v7→v8 chain
  (modelType aggregate, Parking sub-unit fold, phasing normalize,
  M2.0L phase-scoped id dedupe). Replaces the previous hard-error
  `"Unrecognized project shape. Please recreate this project."` and
  `"Project schema older than v8"` paths. Banner uses new
  `LEGACY_MIGRATION_NOTICE` constant: `"Project updated to latest
  schema, please verify your inputs."` Surfaced once per project
  open via `CheckedHydration.migrationNotice` (existing pipe).

- **Fix 2, Cost Input Mode (Same / Individual)**:
  New `Project.costInputMode?: 'same' | 'individual'` field.
  `CostInputModeModal` opens on first Tab 3 visit when undefined.
  Toggle button stays at top of Tab 3 (`data-testid="cost-input-mode-toggle"`)
  for later switches. Same mode renders one `SameModeCostTable` per
  phase: no asset selector, no per-asset sections, edits route to
  `CostLine` directly via new `editsGoToLine` prop on `CostRow`.
  Calc engine still distributes each project-wide line per its
  `allocationBasis` (bua_share / land_share / per_asset).
  Individual→Same switch with active overrides surfaces a confirm
  dialog and then clears every `costOverride` row before flipping
  the mode. Individual mode = unchanged M2.0L behavior.

- **Fix 3, sub-unit metric UX cleanup**: Tab 2 sub-unit table now
  hides cells per metric. Area mode renders Unit Size + Count as
  muted dashes (no accidental cross-derivation). Units mode renders
  Area as a read-only caption (`subunit-{id}-area-readout`) showing
  `count × unitArea`; the user edits Count + Unit Size + Rate only.
  Existing `canSwitchMetric` guard preserved; switching with
  `unitArea>0` preserves area exactly.

- **Fix 4, cost multiplier asset-area fallback**:
  `resolveAssetAreaMetrics` in `src/core/calculations/index.ts` now
  falls back to `asset.buaSqm` / `asset.sellableBuaSqm` when sub-units
  are empty (was returning 0). `gfa` cascades through
  `asset.gfaSqm → hierarchy.gfa → bua`. `costLineCaption` emits
  `"<rate> x - (no <X> defined yet) = 0"` warning when the relevant
  metric is 0 instead of silently rendering `× 0 sqm BUA`.

Commits (4): `60128b1` (Fix 1) · `db7e578` (Fix 2) · `62b843a` (Fix 3) ·
`47d6f08` (Fix 4). Type-check clean on every commit.

### Module 1 status (2026-05-11, **M2.0L Costs diagnose-and-fix + full Financing build**)

**M2.0L (current, ships):** Closes the cost-line duplication bug
Ahmad eyeballed after M2.0j, then expands Tab 4 Financing from a
single-tab tranche editor into a full multi-facility platform with
capital-stack overview, schedules sub-tab, and cross-tab IDC sync.
Schema stays v8 (every new field is additive optional).

- **Cost duplication root cause** was `makeDefaultCostLines(phaseId)`
  emitting hardcoded ids ('land-cash', etc.) per phase, producing
  duplicate ids across phases that propagated via the store's
  `c.id === id` matchers and made the Results filter walk all 20
  lines per asset. Fix composes `${baseId}__${phaseId}` at create
  time. `composeLineId` / `deriveLineBaseId` /
  `isStandardCostLineBaseId` helpers in `module1-types.ts`.
  `deriveCostStage` strips the suffix before stage lookup; legacy
  bare ids still resolve. `migrateM20lDedupeCostLineIds` runs in
  stripWrapper/stripV8Wrapper to retrofit legacy duplicate-id
  snapshots + rewrite `selectedLineIds` + `costOverrides.lineId`.
  `Module1Costs.tsx:1141` Results filter scopes by `c.phaseId === a.phaseId`.
  Refresh: `scripts/baselines/module1-v5.json` (47.8 KB → 48.4 KB).

- **Sub-unit metric round-trip** when `unitArea=0` previously
  zeroed out area on switch to Units. New `canSwitchMetric` guard
  refuses the switch when it would destroy non-zero area, with
  inline warning. Switching with `unitArea>0` continues to
  preserve area exactly per the M2.0j formula.

- **Costs UX additions**: live currency-chip strip below Manual %
  inputs (per-period money distribution updates as user edits);
  always-visible per-row period chip strip below every active
  cost line (uses `distributeItemCost` so chips match calc
  schedules); `PercentOfSelectedPicker` sub-row with scrollable
  sibling-line checkboxes when method = `percent_of_selected`;
  Results-sub-tab filter pill bar (Combined + per-asset) with
  SummaryTables `key={`summary-${granularity}-${filter}`}` for
  clean remount on change.

- **Financing schema additions** (all optional, v8 stays):
  drawdown methods widen 5 → 9 (`+ front_loaded` `+ equal_periodic`
  `+ custom_schedule` `+ cash_available` alias for MAAD parity);
  repayment methods widen 5 → 9 (`+ equal_periodic_amortization`
  annuity / `+ bullet` / `+ balloon` / `+ custom_schedule`).
  New enums: `FacilityType` (senior_construction / senior_term /
  mezzanine / bridge / bullet / other), `InterestRateType`
  (fixed / floating), `BaseRate` (SAIBOR 1/3/6M / SOFR / EIBOR),
  `IDCTreatment` (capitalize / expense / mixed), `FeeTreatment`,
  `EquityTrancheType` (cash / in_kind / jv). `FinancingTranche`
  gains: `facilityType`, `lender`, `principal` (absolute, overrides
  ltvPct), `interestRateType`+`baseRate`+`spreadBps`,
  `tenorPeriods`+`availabilityPeriods`+`gracePeriods`, fee fields,
  `dscrCovenant`+`ltvCovenant`, `idcTreatment` (replaces boolean
  when set), `idcMixedSplitPeriod`, `balloonPct`, `sweepRatio`,
  `prepayments[]`, `pikEnabled`, `autoGenerateIdcCostLine`,
  `drawdownCustomSchedule`, `repaymentCustomSchedule`.
  `EquityContribution` gains: `type`, `source`, `scope`+`scopeId`,
  `assetId`, `irrHurdle`, `preferredReturn`,
  `autoDetectedFromCostLine`+`sourceCostLineId`.

- **Financing calc engine**: `computeEqualPeriodicPayment` (annuity
  PMT with 0-rate edge case), `computeCapitalStack` (sources /
  uses / senior+total LTV / equity+debt breakdowns / match chip
  via gap), `computeIdcSummary` (capitalised + expensed per
  facility + per period), `applyIdcToCapex` (generates
  `AutoIdcCostLineSeed[]` for cross-tab integration; pro-rata by
  BUA share when facility scope is project-wide),
  `computeCombinedDebtService` (aggregate interest / principal /
  drawdown / outstanding across facilities). `computeFinancing`
  resolves the 3-way IDC matrix (mixed uses `idcMixedSplitPeriod`),
  `gracePeriods` defers principal repayment, `availabilityPeriods`
  narrows drawdown window, `prepayments[]` apply at specific
  periods, `sweepRatio` modulates sweep-based methods.

- **Financing UI**: two sub-tabs (Inputs + Schedules). Inputs has
  the Capital Structure Overview cards at top (Total Equity / Total
  Debt / Total Sources / Total Uses / LTV Senior+Total /
  Sources-vs-Uses match chip green ✓ / amber gap-or-surplus),
  Debt Facilities section with TrancheCard exposing every new
  field (collapsible Advanced section for fees / covenants /
  prepayments / PIK), Equity Tranches table widened with
  type/source/IRR-hurdle/preferred-return columns + auto rows
  disabled-edit for cross-tab synced contributions. Schedules has
  the granularity toggle (annual / quarterly / monthly), filter
  pill bar (Combined + per-facility), and 6 tables (Capital Stack
  Summary / Drawdown per facility / Repayment per facility /
  Combined Debt Service / IDC Summary / Capital Stack Movement).

- **Cross-tab integration**: `useEffect` in Module1Financing watches
  phase + tranches + resultsMap, calls `applyIdcToCapex`, then
  materialises each seed as a read-only cost line in Tab 3
  (id = `auto-idc__${facilityId}__${assetId}`, `isLocked: true`,
  `name: "Auto: IDC from ${facility.name}"`). Orphans pruned when
  facility removed or treatment switched to expense. Second effect
  syncs `equity-auto-inkind-${phaseId}` to total Land In-Kind
  value across phase assets; auto rows carry
  `autoDetectedFromCostLine: true` and are disabled-edit in the
  Equity Tranches table.

- **Deferred per brief** (kept as known limitations): DSCR breach
  alerts (Module 5 dependency), equity waterfall + IRR hurdle math
  (Module 4), cash-sweep with full operating cashflow (Module 5
  dependency, ships with capex-only proxy), Sharia Murabaha/Ijara
  notes, multi-currency facilities, refinancing flows.

- **Verifier + Playwright**: `scripts/verify-m20L.ts` (74 pass /
  0 fail / 2 skip without dev server) covers schema + calc
  (annuity PMT / capital stack / IDC summary / 4 new drawdown
  methods / 4 new repayment methods / cross-tab seeds / custom-
  schedule clipping) + 39 source markers + em-dash sweep + spec
  presence. `tests/e2e/m20L-costs-financing.spec.ts` (10 specs
  + dark-mode): asset selector + summary cards, per-row chip
  strip, manual money chips, % of Selected picker, Results filter
  pill bar, Financing sub-tabs, Capital Structure cards, tranche
  IDC mixed split editor, Schedules 6-table layout + filter pills
  + granularity toggle.

For the M2.0j 16-fix narrative (pre-M2.0L), see CLAUDE-FEATURES.md
"Module 1 (REFM) M2.0 Phase History" archive.

### Module 1 status (2026-05-07, M2.0j archived to CLAUDE-FEATURES.md):

The full M2.0j 16-fix narrative (Construction Years = 0, Asset Type
optional, Land Parcel rate header, Display Scale export comment,
Display Scale + Decimals on Land Parcel, sub-unit area/units sync,
accounting format on blur, cost line caption, phasing simplified,
period dates align to phase start, Capex by Period audit + granularity
remount, hide zero rows, drop stage labels, drop 3 summary tables,
per-asset cost structure with asset selector + 3 summary cards) lives
in CLAUDE-FEATURES.md "Module 1 (REFM) M2.0 Phase History".


### Module 1 Conventions (v8 + M2.0L contract, applies to all downstream modules)

> Single source of truth for Module 1 patterns and downstream-module obligations. Replaces the per-phase "pattern decisions" sections that ran M2.0 → M2.0L. Archived per-phase narrative lives in CLAUDE-FEATURES.md under "Module 1 (REFM) M2.0 Phase History".

**Schema + migrations**
- **Hard-cut on every schema bump.** Pre-vN snapshots flag with explicit error rather than silent coercion. v3/v4 → v5, v5 → v6, v6 → v7, v7 → v8 all follow this policy. Non-version-bumping additive fields (M2.0f, M2.0h, M2.0i, M2.0j, M2.0L) default off/undefined for legacy snapshots.
- **Phase-scoped cost line ids (M2.0L).** Standard catalog ids compose as `${baseId}__${phaseId}` to keep them globally unique across multi-phase projects. Use `composeLineId` / `deriveLineBaseId` / `isStandardCostLineBaseId` from `module1-types.ts`. Calc engine helpers that key by line id (e.g., `deriveCostStage`, `selectedLineIds` resolution) strip the suffix before lookup. Custom user lines (`custom-${timestamp}`) are already unique. `migrateM20lDedupeCostLineIds` retrofits legacy duplicate-id snapshots on hydrate.
- **Migration banner pattern.** `CheckedHydration.migrationNotice` → `AttachResult.migrationNotice` → dismissable banner once per project open. Migration helper kicks an immediate save so banner doesn't reappear.
- **Snapshot baseline: ONE file per major schema version** at `scripts/baselines/module1-v5.json` (now v8 content, name retained).

**Timing**
- **Phase.startDate is authoritative.** Tab 1 + Tab 2 read `computePhaseTimeline(phase, project)`. M5 Statements + M3 Cashflow consume same helper for column dates.
- **`constructionPeriods === 0` is canonical for operational phases.** computePhaseTimeline returns `operationsStart === phase.startDate` when cp=0. Asset.status='operational' on cp=0 phases gets historical baseline treatment.
- **End-of-period dates everywhere.** Use `periodEndDate`; never display "Jan 1 of next year" as period end.
- **`ProjectTimeline.endYear` is inclusive.** No +1 offset in display layers.
- **Period dates align to PHASE start.** Cost / revenue / opex / financing schedules all measure from `phase.startDate`. Project-wide rollup tables offset by `(phaseStartYear - projectStartYear)` to place phase Y1 in project Y2 / Y3 correctly.

**Status + lifecycle**
- **Phase + Asset status drives lifecycle treatment.** `'planning' / 'construction' / 'operational'`. Operational reveals `historicalBaseline` (sunk capex / equity / debt / accumulated dep / trailing revenue + opex). M5 reads `computePhaseHistorical(phase)` for opening balances + `computeOperationalRunRate(baseline, period)` for rollforward.
- **Status pill colors:** planned = grey, construction = warm amber, operational = green-success. M5 + M3 reuse same scale.
- **Asset.type is optional.** Treat `''` as unspecified. Useful Life falls back to category default (`DEFAULT_USEFUL_LIFE_YEARS`: residential 30 / hospitality 20 / retail 25 / default 25).

**Inputs + outputs**
- **Inputs are annual; outputs flex.** No user-visible "model granularity" toggle. Every Module 1 input is annual. Display uses `distributeAnnualToPeriods(annualValues, granularity, phasing)` with sum-integrity guarantee. M2.1 / M3 / M5 adopt same convention.
- **`project.outputGranularity` is the project-wide view setting.** Tab 3 / Tab 4 / future M5 all read it.
- **Phasing is Even + Manual % only.** Read-side accepts legacy `frontloaded` / `backloaded` / `sCurve` / `phase_aligned` via `migrateM20jPhasing`. Manual % UX: per-period inputs + sum indicator + auto-normalize button.

**Display + formatting**
- **Project-scoped formatting.** `project.displayScale` (full/thousands/millions) + `project.displayDecimals` (0..3). Use `formatScaled(num, scale, decimals)` or `makeProjectFormatter(project)`. Cells render pure numbers (no currency suffix).
- **Currency lives in the per-tab header line** via `currencyHeaderLine(currency, scale)` → "All figures in SAR" / "...SAR '000" / "...SAR M".
- **Percentages always 2 decimals** via `formatPercent` default. **Areas (sqm) use `formatArea`** (no scale conversion). **Integer counts bypass scale via `formatInteger`**.
- **`AccountingNumberInput` is the canonical money-input primitive.** Raw `<input type="number">` on focus + accounting-formatted text on blur. Use for all numeric money inputs.

**Area hierarchy**
- **Three-tier hierarchy: NSA ⊂ BUA ⊂ GFA.** NSA = revenue sub-units (Sellable + Operable + Leasable); BUA = NSA + Support (sub-unit + asset-level); GFA = BUA + Parking (asset-level). Consume `computeAssetAreaHierarchy(asset, subUnits)`; never re-derive from `Asset.buaSqm` directly.
- **Sub-unit BUA is source of truth.** `computeAssetBua` / `computeAssetSellableBua` fall back to `asset.buaSqm` only when sub-units are empty.
- **SubUnitMetric is `'units' | 'area'`.** Legacy `'count'` accepted on read. Use `switchMetric()` to preserve area sqm on toggle.
- **Parking is sqm-only at the cost-engine level.** No parkingBays input. Parking-bay-driven revenue (fee/bay/year) models as a Leasable sub-unit.

**Land**
- **Multi-parcel landAllocation.** Asset gains `landAllocation: { parcelId?, sqm?, pct?, multiParcelSplits?, customRate? }`. Sentinels: `PARCEL_WEIGHTED_AVG`, `PARCEL_CUSTOM_RATE`. M2.1 reads `Asset.landAllocation` for per-parcel disposition.
- **Parcel NDA is parcel-level.** Each parcel carries `hasNdaDeduction` + `roadsPct` + `parksPct`. Land allocation references NDA (not gross area); full parcel cost flows to assets at inflated effective NDA rate.
- **Reconciliation is compact-by-default.** Collapsed summary line with status icon (✓/✗/⚠) + expand affordance + auto-expand on mismatch + localStorage persistence. Pattern applies to land reconciliation, asset area reconciliation, and future revenue/debt/capex reconciliations.

**Cost engine**
- **Direct vs Allocated category (M2.0L Pass 5).** Every `CostLine` carries `costCategory?: 'direct' | 'allocated'` (default `direct`). Direct = asset-specific (current Pass 3+ math: `rate × asset.metric`, `allocFactor = 1` except for method='fixed'). Allocated = project-wide pool, split per asset via `costDriver` (`bua_share` / `land_share` / `value_share`). Calc engine computes Allocated lines against `aggregatePhaseMetrics(phaseAssets, metricsByAsset)` to get the pool, then `resolveDriverFactor(driver, asset, ...)` distributes per asset. `value_share` currently falls back to `bua_share` (deferred until M2.1 Revenue ships projected per-asset value). Auto-derived `CostType` (`hard` / `soft` / `land_cash` / `land_in_kind` / `operating`) via `deriveCostType(line)` is internal-only, not user-visible.
- **Parent/child inheritance is the canonical Costs UX (M2.0L Pass 4).** One editable master cost line table per phase (`CostLine[]` with `targetAssetId === undefined`) + per-asset resolved replicas below. Each replica row carries a Source pill (Inherited/Override) + an Override toggle button. Click Override → `CostOverride` entry seeded with master values + `overridden=true`. Click ✓ Revert → drop the override entry (asset reverts to master). Master edits propagate synchronously to every non-overridden replica via Zustand subscriptions.
- **CostOverride resolution:** `override.overridden === false` reverts to master entirely. `override.overridden !== false` (true OR legacy undefined treated as true) uses override fields with master fallback per field — i.e. each `method` / `value` / `phasing` / `distribution` / `perSubUnitRates` / `startPeriod` / `endPeriod` on the override replaces the master if set; undefined fields inherit. Same rule for the migration banner: legacy CostOverride entries stamp `overridden=true` on hydrate via `migrateM20Pass4Inheritance`.
- **`Project.costInputMode` is deprecated.** Stripped on hydrate. The Same vs Individual mode UX is gone; the inheritance surface always renders both views.
- **Capex Excl Land In-Kind is the cash-impact schedule** that feeds the Financing module's drawdown curve for debt sizing + equity funding requirement. Results Table 3 in Tab 3. Land In-Kind is non-cash equity (Tab 4 In-Kind Equity tile, never on Cash Flow Statement); Total Capex Incl Land Value (Results Table 2) is the basis for Fixed Assets / Inventory book value in M5.
- **Capex capitalisation rule.** Every cost line capitalises into asset basis. `classifyAssetCapex(asset, capexBasis, landTotal)` routes to `{ COGS, FixedAssets, Depreciation }` per strategy. Land never depreciates.
- **Land in-kind treatment.** `computeCashFlowImpact(capexBasis, landInKindPortion)` returns `{ cashOutflow, equityInKind }`. M3 Cashflow consumes directly.
- **`CostLine` is open-ended `id: string`.** Custom + seed lines coexist; `isLocked` protects seed rows. `STANDARD_COST_LINE_IDS` exports the 9-line standard catalog. `deriveCostStage(line)` returns stage by stable id; custom lines fall back to `line.stage`.
- **Per-sub-unit custom rates** is the pattern for granular cost differentiation. `CostMethod = 'per_sub_unit_custom_rates'` + `CostLine.perSubUnitRates` keyed on sub-unit id with reserved keys `'__support__'` / `'__parking__'`. M2.1 can mirror with `RevenueLine.perSubUnitRates`.
- **Cost line caption pattern.** Inline caption under value cell showing `rate × metric = total`. M2.1 follows with `revenueLineCaption`.

**Strategy + revenue obligations (for M2.1)**
- **Sell / Operate / Lease / Sell + Manage.** Short labels with `STRATEGY_TOOLTIPS` map for longform hover.
- **Sub-unit category + metric drive Rate Unit** (Sellable+units = per unit, Operable+units = per room/night, Leasable+area = per sqm/year, etc.). M2.1 wires each combination to its revenue stream.
- **Sell + Manage** drives recurring management fee revenue via `Asset.managementAgreement` (managementFeePct × operating revenue over agreementDurationPeriods, starting at agreementStartPeriod or handover).
- **Asset.status gates revenue:** planned = no revenue, construction = pre-sale only (Sell + Sell+Manage), operational = full revenue per strategy.

**Layout + UX**
- **Sticky sidebar.** Outer wrapper `height: 100vh; overflow: hidden`; scrollable `<main>`. Standard for any module shell.
- **Sub-tab Inputs / Results pattern** is canonical for editable + read-only views. M2.1 + M3 follow.
- **Per-asset selector + 3 summary cards** is canonical Inputs layout. Asset selector bar + per-asset section + 3 summary cards.
- **Hide zero rows in Results.** Filter `total=0` rows from display; keep in Inputs.
- **Granularity toggle remounts via key.** `key={`summary-${granularity}`}` to avoid stale state.
- **Summary table column convention:** [Description] [Total] [Period/Stage/Type cols...] so totals visible without scrolling right.

**Catalogs**
- **Project type catalog is additive.** 14 project types with `ASSET_TYPES_BY_PROJECT_TYPE` filter for Tab 2 Type dropdown. `SUGGESTED_CATEGORIES_BY_PROJECT_TYPE` provides empty-state nudges; never auto-creates assets.

---

### Module 1 archived phase history (M2.0 → M2.0j)

Full closure narrative for each phase below lives in **CLAUDE-FEATURES.md** under "Module 1 (REFM) M2.0 Phase History (M2.0 → M2.0j, archived 2026-05-11)". One-line index here for quick recall:

- **M2.0j** (2026-05-07), 16 audit + display + structural fixes (cp=0, Asset.type optional, Land Parcel rate header, Display Scale export comment, Display Scale + Decimals on Land Parcel, sub-unit area/units bidirectional sync, accounting format on blur, cost line caption per method, phasing simplified to Even+Manual, period dates align to phase start, Capex by Period audit + granularity remount, hide zero rows, drop stage labels, drop 3 summary tables, asset selector + 3 summary cards). `verify-m20j.ts` + `m20j-costs-audit.spec.ts`. Superseded by M2.0L which fixed the cost line duplication bug it introduced.
- **M2.0i** (2026-05-07), final polish (10 fixes): Display Settings panel, drop Model Granularity input + Parking Bays, sub-unit Units/Area, Strategy short labels, compact reconciliation, Operational phase Historical Baseline. `verify-m20i.ts` + `m20i-final-polish.spec.ts`.
- **M2.0h** (2026-05-07), area hierarchy + cost granularity (6 fixes + v7→v8 migration banner): NSA/BUA/GFA tiers, parcel NDA toggle, per-sub-unit custom rates, runtime granularity toggle, currency header line. `verify-m20h.ts` + `m20h-area-hierarchy-cost-granularity.spec.ts`.
- **M2.0g** (2026-05-06), display + reconciliation + Costs restructure (v7→v8 schema bump): annual-only inputs, displayScale, end-of-period dates, asset Support/Parking, land reconciliation, sub-tabs Inputs/Results, 4 summary tables, Manual % phasing restore. `verify-m20g.ts` + `m20g-display-recon-costs.spec.ts`.
- **M2.0f** (2026-05-06), structural fixes (6 fixes): 14 project types, Phase Start Date column, multi-parcel landAllocation, sub-unit BUA source of truth, Parking sub-unit. `verify-m20f.ts` + `m20f-structural-fixes.spec.ts`.
- **M2.0e** (2026-05-06), wizard simplification + Tab 2 canonical entry: per-phase asset sections, Sell+Manage / UsefulLife sub-forms, Status pill, computePhaseTimeline. `verify-m20e.ts` + `m20e-wizard-tab2.spec.ts`.
- **M2.0d** (2026-05-06), Costs polish + v7 schema: Sell+Manage rename, per-asset cost segregation, classifyAssetCapex, computeCashFlowImpact, 3 summary tables, Tab 4 In-Kind Equity tile. `verify-m20d.ts` + `m20d-costs-polish.spec.ts`.
- **M2.0c** (2026-05-06), Dev Costs + Financing restore on v6: 13 cost methods, 5×5 financing matrix, IDC capitalization, per-tranche schedules. `verify-m20c.ts` + `m20c-costs-financing.spec.ts` (skipped, frozen).
- **M2.0b** (2026-05-06), brand-styled shell on v5: Topbar + Sidebar + Dashboard + Modals restored, dark-mode toggle, playwright.config.ts baseURL. `verify-m20b.ts` + `m20b-shell.spec.ts`.
- **M2.0** (2026-05-06), v5 hard-cut rebuild: flat Project → Phase → Asset → SubUnit hierarchy, 4 tabs, 9 fixed cost lines, 5×3 financing matrix, 30.8 KB v5 baseline. `verify-m20.ts` + `m20-full-flow.spec.ts`.

---

### Module 1 phase history (M1.R through M1.13d, pre-M2.0)
M2.0 (2026-05-06) hard-cut Module 1 to the v5 schema, replacing the v3 / v4 hierarchy (Master Holding / Sub-Project / Plot / Zone / FAR / Cascade / Parking Allocator). The pre-M2.0 narrative (M1.R → M1.5 → M1.5b → M1.6 → M1.7 → M1.8 → M1.9 → M1.9b → M1.10 → M1.10b → M1.11 → M1.12 → M1.13 → M1.13b → M1.13c → M1.13d) plus M1.8 wizard hotfix series and the legacy 3-baseline snapshot diff pattern lives in **CLAUDE-FEATURES.md** under "Module 1 (REFM) Phase History (frozen pre-M2.0)". Read it only if you are excavating an old commit or a deferred-from-M1 issue resurfaces; current work happens against M2.0j on v8.

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
