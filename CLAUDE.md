# Financial Modeler Pro, Claude Code Project Brief
**Last updated: 2026-05-06**

> **See also:**
> - [CLAUDE-DB.md](CLAUDE-DB.md), Database tables, storage buckets, migrations log
> - [CLAUDE-FEATURES.md](CLAUDE-FEATURES.md), Feature status, detailed feature specs & flows
> - [CLAUDE-ROUTES.md](CLAUDE-ROUTES.md), All page routes, API routes, components, lib structure
> - [CLAUDE-TODO.md](CLAUDE-TODO.md), Pending work, backlog, legacy reference

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

# Module 1 regression-guard snapshot diffs (run per commit; all 3 must be exit 0)
npx tsx scripts/module1-snapshot-diff.ts        # legacy single-phase, 17.5 KB baseline
npx tsx scripts/module1-multiphase-diff.ts      # multi-phase v4, 23.0 KB baseline
npx tsx scripts/module1-areaprogram-diff.ts     # M1.7 Area Program, 2.8 KB baseline

# Per-phase verifier (5 sections: DB / routes / calc / state / Playwright UI)
npx tsx --env-file=.env.local scripts/verify-m17.ts   # M1.7 Area Program (25 pass / 0 fail / 2 skip without dev server)
npx tsx --env-file=.env.local scripts/verify-m18.ts   # M1.8 Smart Project Wizard (19 pass / 0 fail / 1 skip without dev server)
npx tsx --env-file=.env.local scripts/verify-m19.ts   # M1.9 UX redesign (16 pass / 0 fail / 2 skip without dev server)
npx tsx --env-file=.env.local scripts/verify-m19b.ts  # M1.9b polish (19 pass / 0 fail / 2 skip without dev server; 29 pass / 0 fail / 1 skip with dev server)
npx tsx --env-file=.env.local scripts/verify-m110.ts  # M1.10 setup-completeness (25 pass / 0 fail / 1 skip with dev server)
npx tsx --env-file=.env.local scripts/verify-m110b.ts # M1.10b Plot Setup polish (18 pass / 0 fail / 0 skip with dev server)
npx tsx --env-file=.env.local scripts/verify-m111.ts  # M1.11 holistic audit + fix pass (23 pass / 0 fail / 1 skip without dev server)

# Playwright e2e specs (M1.8 + M1.9 + M1.9b + M1.10 + M1.10b + M1.11 regression-guards)
npx playwright test tests/e2e/m18-wizard-repro.spec.ts     # 1 spec, wizard create does not crash
npx playwright test tests/e2e/m18-wizard-flow.spec.ts      # 2 specs, every tab shows wizard data + reload persists
npx playwright test tests/e2e/m19-redesign-flow.spec.ts    # 2 specs, wizard lands on Schedule tab + numbered tab row + light/dark screenshots
npx playwright test tests/e2e/m19b-redesign-flow.spec.ts   # 2 specs, Hierarchy dissolved (1→5 tabs) + nested mounts + D7/D8 labels + What-goes-here callouts + light/dark screenshots
npx playwright test tests/e2e/m110-flow.spec.ts            # 3 specs, Mixed-Use wizard lands clean (no 0% / no Over FAR / reconciliation row) + Plot wizard + Parcel wizard walkthroughs + screenshots
npx playwright test tests/e2e/m110b-flow.spec.ts           # 2 specs, Plot Setup Wizard portal-centers in viewport + tooltip a11y (focus reveal, Esc dismiss) + 15-field inline form + light/dark tooltip screenshots
npx playwright test tests/e2e/m111-full-flow.spec.ts       # 2 specs, ProjectWizard portal regression guard + full first-time flow walking 5 tabs with M1.11 fix markers + 10 light/dark tab screenshots
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

### Module 1 status (2026-05-06)
**All sub-phases shipped:** M1.R (cost engine + Zustand restoration) → M1.5 (multi-asset
+ multi-phase + storage v3 bump) → M1.5b (UX polish + Quick Setup wizard inside Hierarchy)
→ M1.6 (Supabase persistence + version history) → M1.7 (Area Program tab + plots / zones
/ sub-units / parking allocator) → M1.8 (Smart Project Creation Wizard with progressive
disclosure + Master Holding hidden by default) → M1.9 (UX redesign: wizard captures
country + project timeline upfront; Schedule and Land tabs strip duplicate inputs;
numbered 1→6 tab sequence with Schedule first; wizard-created projects land on Schedule
for validation) → M1.9b (Hierarchy tab dissolved + nested under Schedule + Build Program;
D7/D8 disambiguation labels; What-goes-here callouts on all 5 tabs) → M1.10 (setup-
completeness fixes: plot defaults inside FAR ceiling on first paint, platform-layer
category-sum allocation derivation, wizard Step 2 fits 1080p, Land vs Plot reconciliation
row, modal-step Plot + Parcel setup wizards) → M1.10b (Plot Setup polish: Plot+Parcel
wizards portal to document.body + center in viewport, inline Plot form reconciled with
the wizard at 15 writable fields, accessible InputLabel + ⓘ tooltip primitive with
plain-English help wired into every input across all 5 Module 1 tabs) → **M1.11**
(holistic re-audit + 22 coordinated fixes: ProjectWizard portal mount, semantic Project
Timeline Visual with multi-phase awareness, dead setters removed from Module1Area +
Module1Timeline, asset Strategy + Zone tooltips on Build Program, parcel state-path
unified to Zustand setLand, shared parcelFieldHelp + assetStrategyHelp modules, Dev
Costs phase-scope explainer + cost row tooltips, Financing per-line Debt % tooltip,
em-dash sweep across the whole repo with new writing rule prohibiting reintroduction).
**Module 1 ships production-ready after M1.11; next phase is M2.0 (revenue, opex,
deferred calc-engine refinements).**

**M1.10 setup-completeness series (8 commits, 2026-05-05 → 2026-05-06, all snapshot diffs bit-identical):**
- `d295dc8` 2/8: tune plot defaults so fresh plots stay inside FAR ceiling.
  podiumFloors 2→1, typicalFloors 10→6, typicalCoveragePct 40→30. Math:
  (60·1 + 30·6) / (3·100) = 80% utilisation (was 173.3%). No calc engine
  change, only `DEFAULT_PLOT_*` constants. Snapshot fixtures all pin
  these values explicitly so baselines unaffected. (M1.10/1 pin commit
  unnecessary, every fixture with plot data already pins.)
- `e9305d4` 3/8: platform-layer category-sum allocation derivation.
  RealEstatePlatform's `resAsset / hospAsset / retAsset` no longer use
  `assetById.get(LEGACY_ASSET_IDS.X)` (which missed wizard-minted ids
  like `wizardasset_1/2/3`). Replaced with `firstByCategory` resolver
  walking `assets[]` in array order matching on category (Sell ↔
  residential, Operate ↔ hospitality, Lease ↔ retail). `residentialPercent`
  / `hospitalityPercent` / `retailPercent` now sum allocationPct across
  every asset in the bucket. Cost setters + filters route through the
  resolved id so the cost-seeder effect picks up wizard-minted assets.
  Snapshot fixtures have one asset per category with id matching the
  legacy literal so resolution is unambiguous either way.
- `6419b3a` 4/8: wizard Step 2 fits 1080p without scroll. Section gap
  shrunk sp-3 → sp-2; MH descriptive paragraph compressed to a one-
  liner; Phases (Q2) + Plots (Q3) collapsed into a 2-column grid row.
  Estimated content-height reduction ~120-140px.
- `d47c268` 5/8: Land vs Plot reconciliation row + relabels.
  `landParcels[]` (financial, what you own) and `Plot[]` (physical ,
  what you build on) stay independent arrays but Build Program now
  surfaces a reconciliation row showing Parcel total · Plot total ·
  ✓ matches / ⚠ diverges. Tolerance 1 sqm. Land tab heading renamed
  "Land Parcels (financial, what you own)"; Build Program "Plot Area"
  input renamed "Plot Buildable Area" so the financial-vs-physical
  distinction is visible in both surfaces.
- `9f48b76` 6/8: Build Program per-plot setup wizard
  (`PlotSetupWizard.tsx`). 4-step modal walk, Envelope (FAR + coverage)
  → Floors (podium + typical + typicalCoverage with live envelope
  preview showing utilisation %) → Parking (3 bay sizes + basement
  count + efficiency) → Assets (checkbox list of existing assets to
  re-bind to this plot via plotId updates). Local draft + Set of
  assigned asset ids; nothing leaks to the store until Save & Close.
  Cancel discards. Mounted from each PlotEditor card via "🪄 Setup
  wizard" button. Form view stays primary.
- `89667ab` 7/8: Land tab parcel setup wizard
  (`ParcelSetupWizard.tsx`). 2-step modal walk, build parcel list
  with "+ Add another parcel" pattern → review with totals → Save &
  Close commits via `setLand({ landParcels: next })`. Seeded from
  existing parcels so it reads as edit-not-restart. Mounted from the
  Land Parcels card via "🪄 Setup wizard" button. Form view stays
  primary.
- `8f383c8` 8/8 (verifier): scripts/verify-m110.ts. 5-section verifier
  with section 4 covering all 5 fixes. Result: 25 pass / 0 fail / 1
  skip with dev server up.
- `cfbb4f2` 9/8 (Playwright + screenshots): tests/e2e/m110-flow.spec.ts.
  3 specs: (1) wizard Mixed-Use lands clean (no 0% allocation badge,
  no Over FAR badge, reconciliation row visible), (2) PlotSetupWizard
  4-step walkthrough, (3) ParcelSetupWizard 2-step walkthrough +
  screenshots into tests/screenshots/M1.10/.

**M1.10b Plot Setup polish series (8 commits, all snapshot diffs bit-identical):**
- `57a8fc0` 1/8: Plot+Parcel wizards render via React `createPortal` to
  `document.body` (z-index 9999) instead of inline JSX nested in the
  Build Program / Land tab content. Pre-fix the modal inherited an
  ancestor's containing-block (transform/will-change on the platform
  shell), so `position: fixed` resolved relative to that ancestor and
  the wizard rendered below the viewport when scrolled. Portal mounts
  break out of the layout tree. SSR guard: `if (typeof document ===
  'undefined') return null;` so server render stays safe.
- `719542c` 2/8: reconcile inline Plot form vs Plot Setup Wizard
  fields. Both surfaces now expose all 15 writable Plot fields with
  identical labels: Plot Buildable Area, Max FAR, Podium Coverage,
  Total Floors, Podium Floors, Typical Floors, Typical Coverage,
  Landscape, Hardscape, Surface Bay, Vertical Bay, Basement Bay,
  Basement Count, Basement Efficiency, Vertical Parking Floors. Label
  drift fixed ("Coverage" → "Podium Coverage", "Basements" → "Basement
  Count", "Basement Eff." → "Basement Efficiency"). PlotDraft type
  extended with verticalParkingFloors so the wizard captures every
  field the inline form does.
- `b8918c8` 3/8: reusable `<InputLabel label help inputId textStyle />`
  primitive at `src/hubs/modeling/platforms/refm/components/ui/
  InputLabel.tsx`. Renders uppercase label + ⓘ help button. Hover or
  keyboard focus reveals an absolutely-positioned tooltip; Escape +
  click-outside dismiss. ARIA: `aria-describedby` (wired conditionally
  while open), `aria-expanded`, `role="tooltip"` on the bubble.
  `pointerEvents: 'none'` on the bubble so it never steals clicks
  back. No external tooltip library, Radix would have been heavier
  than this 154-line primitive justifies.
- `0bf9e7b` 4/8: wire InputLabel into Schedule + Land tabs. Schedule:
  Model Granularity, Project Start Date, Project Construction, Project
  Operations, Project Overlap. Land: Land Parcels table headers (Parcel
  Name / Area / Rate / Cash % / In-Kind %) via a data-driven map, plus
  Site Parameters (Project Roads, Project FAR, Non-Enclosed Area %).
  Help copy is plain-English and explains the modeling consequence
  (e.g. "Years vs Months, controls how every cashflow is bucketed").
- `6b32ee8` 5/8: wire InputLabel into Build Program + Plot/Parcel
  wizards. Plot help copy lives at `src/hubs/modeling/platforms/refm/
  lib/copy/plotFieldHelp.ts` as a `Record<string, string>` keyed by
  the 15 writable field names, so the inline form, the wizard, and any
  future surface share one source of truth. Parcel wizard uses an
  in-file `PARCEL_HELP` map (5 keys). All `<label>` elements in both
  surfaces now render via `<InputLabel>`.
- `b80b617` 6/8: wire InputLabel into Dev Costs + Financing. Dev Costs:
  Alloc Basis + Input Mode (with `textStyle` override for the smaller
  inline labels). Financing: Financing Mode, Debt % of CapEx (LTV),
  Interest Rate, Capitalize Interest During Construction (restructured
  from `<label>` wrapper to inline checkbox + InputLabel sibling so the
  ⓘ icon doesn't break the label/checkbox click target), Repayment
  Method, Repayment Period.
- `ddfb638` 7/8 (verifier): scripts/verify-m110b.ts. 5-section verifier
  with section 4 covering all three M1.10b fixes. Section 4b detects
  the 15th field (verticalParkingFloors) via `.field` accessor in
  Module1AreaProgram since it lives in a standalone JSX block rather
  than the quoted-key numField path. Result: 18 pass / 0 fail / 0 skip
  with dev server up.
- `476b109` 8/8 (Playwright + screenshots): tests/e2e/m110b-flow.spec.ts.
  2 specs: (1) Plot Setup Wizard portal regression guard, scroll to
  the bottom of Build Program (where a non-portal modal would inherit
  the parent containing-block and render below the fold), open the
  wizard, assert bounding box centered in 1440×900 viewport, focus a
  help icon, assert tooltip becomes visible, press Escape, assert
  dismissal; (2) inline Plot form references all 15 writable-field
  labels + light/dark hover-driven tooltip screenshots into
  tests/screenshots/M1.10b/. Both pass (44.6s).

**M1.11 holistic audit + fix pass (12 commits, 2026-05-06, all snapshot diffs bit-identical):**
- `92dcc57` 0/12 (audit): docs/MODULE_1_AUDIT_M1.11.md, single comprehensive
  audit document covering 7 areas (data flow, per-tab UX, visual schedule,
  Land vs Build Program redundancy, calc reconciliation, first-time flow,
  M1.5b through M1.10b regression check). 22 issues found (4 critical, 8
  major, 6 minor, 4 out of scope). One audit finding (C1: Status field
  silently dropped) was a false positive on verification: `RealEstatePlatform.tsx:1248`
  already passes `status: draft.status` to `pclient.createProject` so it
  reaches the project record correctly. Audit commit also added the writing
  rule "NEVER use em-dashes" to CLAUDE.md.
- `04699cb` 1/12 (Wizard polish, C2 + M8): ProjectWizard renders via
  createPortal to document.body with the SSR guard pattern, mirroring the
  M1.10b/1 fix on Plot/Parcel wizards. step3Valid allocation tolerance
  bumped from 0.01 to 0.1 so manual entry of equal thirds (33.333 x 3 =
  99.999 in float math) passes the gate while truly wrong sums are still
  rejected.
- `53e13bf` 2/12 (Schedule, C3): Project Timeline Visual rebuild as a
  dedicated `components/ui/ProjectTimelineVisual.tsx` component. Renders
  4 boundary date labels (Project start, Operations start, Construction
  end, Project end) inline on the axis, plus an Overlap window callout
  when overlap > 0. Multi-phase aware: subscribes to phases via useShallow
  and renders one bar per phase with phase name + period range header.
  Date math uses Intl.DateTimeFormat('en-GB') for locale-stable display.
- `747514a` 3/12 (Land cleanup, M1 + M4 + m1): dead setters removed from
  Module1Area + Module1Timeline props interfaces. Module1Area writes
  landParcels via Zustand setLand directly (the prop-drilled
  setLandParcels wrapper in RealEstatePlatform is gone). New shared
  `lib/copy/parcelFieldHelp.ts` module exports PARCEL_FIELD_HELP keyed by
  the 5 Parcel field names; both the inline parcel table on Module1Area
  and ParcelSetupWizard now import from this single source of truth.
  Wizard label "Name" canonicalised to "Parcel Name", "Rate (/sqm)" to
  "Rate (per sqm)", inline "Rate (/{currency} per sqm)" to "Rate (per
  sqm, {currency})".
- `ff22059` 4/12 (Build Program, M2): Asset strategy block on the asset
  card wrapped in InputLabel with plain-English help. New
  `lib/copy/assetStrategyHelp.ts` module exports ASSET_STRATEGY_HELP with
  6 keys (primaryStrategy, primaryStrategyPct, secondaryStrategy,
  secondaryStrategyPct, zone, gfaOverride). Em-dash placeholders in
  selects replaced ("(none)" instead of "—" for blank Secondary strategy,
  "(no zone)" instead of "— (no zone)").
- `347bae3` 5/12 (Dev Costs, M3 + M7a): What-goes-here callout grew a
  Phase Scope sub-paragraph explaining how the active sub-project context
  interacts with cost rows; per-row phase override deferred to M2.0
  (legacy CostItem schema would need migrating to the multi-phase
  CostLine schema, which touches the calc engine and is out of M1.11
  scope). Cost row column headers (Cost Name, Stage/Scope, Method/Base,
  Input Value, Start, End, Phasing) wrapped in InputLabel with plain-
  English help.
- `db23508` 6/12 (Financing, M7b): per-line Debt % column header on the
  Development Costs by Line Item summary table wrapped in InputLabel
  with help explaining when the override applies (only when Financing
  Mode is set to per-line). Top-level Financing inputs already covered
  by M1.10b/6.
- `208cade` 7/12 (em-dash sweep, pass 1): 200 em-dashes removed from the
  10 hot-path Module 1 surface files plus the supporting state, lib, and
  ui modules. Two sed passes per file: ` em-dash ` → `, ` and bare
  `em-dash` → `,`. Two literal-value contexts where the sweep produced a
  meaningless comma were caught and fixed (Module1AreaProgram fmt() for
  non-finite returns "n/a"; Zone areaSharePct placeholder is "auto").
- `a26d992` 8/12 (em-dash sweep, pass 2): 474 em-dashes removed across
  148 src + app + scripts + tests files. Same sed rules. Skips js/refm-platform.js
  (legacy, 242 occurrences) and verify-m*.ts docstrings per audit policy.
- `9453f99` 9/12 (em-dash sweep, pass 3): 712 em-dashes removed across 13
  tracked markdown files (CLAUDE.md, CLAUDE-FEATURES.md, CLAUDE-TODO.md,
  CLAUDE-ROUTES.md, CLAUDE-DB.md, PROJECT_HANDOFF.md, CMS_REFERENCE.md,
  ARCHITECTURE.md, docs/MODULE_1_CAPABILITIES.md, and others). After this
  commit the repository carries zero tracked em-dashes outside the
  exclusion list.
- `f757fb6` 10/12 (verifier): scripts/verify-m111.ts. 5-section verifier
  with section 4 covering all 22 audit items via state markers (portal
  imports, tooltip-help imports, dead-setter absence with stripCommentLines
  to ignore docstring mentions, em-dash absence sweep). 23 pass / 0 fail
  / 1 skip without dev server.
- `0d89e9a` 11/12 (Playwright + screenshots): tests/e2e/m111-full-flow.spec.ts.
  2 specs: (1) ProjectWizard portal regression guard, scrolls page to
  bottom and asserts modal bounding box centers in 1440x900 viewport;
  (2) full first-time flow walks the wizard then 5 tabs, asserts the C3
  timeline-axis testId surfaces the 4 boundary labels, m1 Parcel field
  labels are visible, M2 strategy labels are present, M3 Phase scope
  callout is visible, then captures 10 light + dark tab screenshots into
  tests/screenshots/M1.11/. Both pass (49.9s).
- (this commit) 12/12 (docs sweep): CLAUDE.md M1.11 closure note, scripts
  table entry, Playwright spec entry, Module 1 status header extended
  with the M1.11 completion line.

**M1.11 deferred to M2.0 (calc engine territory, out of scope per audit):**
- `getSameForAllFactor` division-by-zero guard when all assets are hidden
  (`src/core/calculations/index.ts:377-385`).
- `projectNDA` clamp to non-negative when projectRoadsPct > 100
  (`src/core/calculations/index.ts:156`).
- Repayment math style: straight-line vs amortization (PMT formula).
  Document the assumption or switch to amortization in M2.0.
- Snapshot diff numeric tolerance: byte-for-byte JSON equality is fine
  today (deterministic pure functions) but introduce tolerance if M2.0
  changes any arithmetic order.
- Per-row phaseId scope toggle on Dev Costs: requires migrating from
  legacy CostItem to multi-phase CostLine schema; calc engine impact.
- ProjectFAR migration from Land tab to Build Program → Plot (auto-
  derive from per-plot maxFARs).

**M1.10 deferred (not yet scoped):**
- ProjectFAR migration from Land to Build Program → Plot (calc still
  consumes it as a project-level scalar; needs auto-derive from per-
  plot maxFARs first).
- Section-pill labels (Inputs / Calculated), calc-vs-input pencil/fx
  icons next to every field, hover tooltips for the financial
  vocabulary (Sub-Unit, Strategy, FAR, Cascade), carried over from
  M1.9b deferred list.
- Remove unused setters from Module1Area + Module1Timeline prop
  interfaces (still tagged with eslint-disable so RealEstatePlatform
  binding doesn't shift).

**M1.9 redesign series (6 commits, 2026-05-04, all snapshot diffs bit-identical):**
- `591315b` 1/15: ProjectWizard step 1 currency dropdown becomes country dropdown
  (auto-derives currency); Step 2 grows a Project Timeline section (construction +
  operations + overlap periods, unit hint follows modelType). buildWizardSnapshot
  wires the wizard's timing into every minted phase (clamped: overlap ≤ construction;
  opsStart = construction − overlap + 1). Snapshot.country populated from wizard.
- `7626120` 2/15: strip Asset Mix + Deduction & Efficiency panels from Module1Area.
  Both edited the same backing data the Hierarchy tab edits per-asset
  (residentialPercent = resAsset.allocationPct in RealEstatePlatform.tsx:334), so the
  duplication confused users about which tab is canonical. Site Parameters card
  stays (FAR, Roads %, Non-Enclosed % all still calc-input). Added a
  "Where did Asset Mix go?" explainer pointing to Hierarchy.
- `93b6f1e` 3/15: strip Project Identity card (project name, type, country / market
  dropdown, currency input) from Module1Timeline. Tab renamed to "Project Schedule";
  layout collapses 2-column → 1-column. Subtitle directs users to wizard / Hierarchy
  for identity fields. Props interface keeps now-unused identity setters with
  eslint-disable so RealEstatePlatform binding doesn't change in this commit.
- `382a0c3` 4/15: m1Tabs gains a numeric `step` field; visible labels become
  "1. Schedule / 2. Land / 3. Build Program / 4. Dev Costs / 5. Financing /
  6. Hierarchy". Reorder: Schedule moves to position 1, Hierarchy to position 6.
  handleCreateProjectFromWizard switches `setActiveTab('area-program')` →
  `setActiveTab('timeline')` so the user lands on Schedule and validates the
  wizard's capture before drilling further. Manual project creation still lands
  on Hierarchy (no asset structure yet, so the data tree is the right starting
  point).
- `b8b54cc` 5/15: scripts/verify-m19.ts, 5-section per-phase verifier. 16 pass /
  0 fail / 2 skip without dev server. Section 4 includes a static source-file
  inspection that asserts JSX-context patterns (`>Project Identity<`, `>Asset Mix<`)
  are gone, false-positive free, so docstrings referencing the removed surfaces
  don't trip.
- `a8b9f34` 6/15: tests/e2e/m19-redesign-flow.spec.ts, 2 Playwright specs.
  Spec 1 walks wizard with country='United Arab Emirates' (auto-AED) +
  construction=7/operations=11/overlap=1, asserts Schedule landing tab, numbered
  tab row, M1.9 strip both tabs, stored snapshot has the wizard timing. Spec 2
  captures Schedule + Land tab screenshots (light + dark) into
  tests/screenshots/M1.9/. Both pass locally (2 passed, 22.9s).

**M1.9b polish series (8 commits, 2026-05-04 → 2026-05-05, all snapshot diffs bit-identical):**
- `abe9917` 1/8: Module1Hierarchy gains optional `sections?: 'all' | 'structure' | 'assets'`
  prop. `sectionsMode === 'all'` is the legacy default (full render). 'structure' renders
  Master Holding + Sub-Project + Phase rows and replaces each Phase's Asset/SubUnit subtree
  with a slim "🧱 N assets · Edit assets in Build Program" stub. 'assets' suppresses MH +
  the header + the Add-Sub-Project block + first-time empty gate, leaving just the per-Asset
  + per-Sub-Unit cards. Slice via visibility gates rather than extraction (the component
  is 2,500 lines; full extraction would have doubled the diff).
- `6d3b720` 2-3/8: Module1Timeline mounts `<Module1Hierarchy sections="structure" />` in a
  "🗂️ Project Structure (Master Holding · Sub-Projects · Phases)" section card below the
  schedule body. Module1AreaProgram mounts `<Module1Hierarchy sections="assets" />` in a
  "🧱 Asset & Sub-Unit Detail Editor" section card below the plots list.
- `75908f9` 4/8: dissolve standalone Hierarchy tab. m1Tabs drops to 5 entries (no
  'hierarchy' key). RealEstatePlatform default `useState('hierarchy')` →
  `useState('timeline')`; manual `handleCreateProject` `setActiveTab('hierarchy')` →
  `setActiveTab('timeline')`; `{activeTab === 'hierarchy' && <Module1Hierarchy />}` render
  branch removed. Wizard- and manual-created projects both land on Schedule (step 1).
- `0a71c0a` 5/8: D7 + D8 disambiguation labels + What-goes-here callouts on Schedule + Land.
  Schedule's "Construction / Operations / Overlap" relabelled "Project Construction /
  Operations / Overlap"; per-Phase overrides now live in the structure tree on the same
  tab. Land's "Floor Area Ratio (FAR)" → "Project FAR (whole-site ceiling)"; Roads % gets
  "(of total land)" suffix; Non-Enclosed % gets "(balconies / terraces)" suffix.
  Primary-tinted callouts at the top of Schedule + Land state canonical scope ("What goes
  here") + delegated scope ("Not here").
- `40b6912` 6/8: extend What-goes-here callouts to Build Program + Dev Costs + Financing.
  Build Program h2 renamed "Area Program" → "Build Program" to match the M1.9 tab label.
- `813f448` 7/8: scripts/verify-m19b.ts, 5-section per-phase verifier covering Hierarchy
  dissolution + sections prop + nested mounts + What-goes-here callouts on all 5 tabs +
  D7/D8 labels. 19 pass / 0 fail / 2 skip without dev server; 29 pass / 0 fail / 1 skip
  with dev server up.
- `<m19b/8>` 8/8: tests/e2e/m19b-redesign-flow.spec.ts, 2 Playwright specs. Spec 1 walks
  wizard, asserts Schedule landing tab + 1→5 tab row (no "6. Hierarchy") + Project
  Structure card mount + D7 labels visible + What-goes-here callout + D8 label on Land +
  Build Program h2 + Asset & Sub-Unit Detail Editor mount. Spec 2 captures Schedule + Land
  + Build Program screenshots (light + dark) into tests/screenshots/M1.9b/. Both pass
  locally (2 passed, 28.3s).

**M1.9b deferred (true architectural follow-on, separate session):**
- Merge Project & Schedule even further: dissolve the Schedule tab + the structure tree
  card into a unified "1. Project & Schedule" surface where the Master Holding /
  Sub-Project / Phase tree drives the timing inputs (per-Phase section instead of
  project-level seed). Today the M1.9b mount keeps both surfaces side-by-side which is
  workable but still leaves project-level + per-phase timing visible at the same time.
- Section-pill labels (Inputs / Calculated), calc-vs-input pencil/fx icons next to every
  field, hover tooltips for the financial vocabulary (Sub-Unit, Strategy, FAR, Cascade).
- Remove unused setters from Module1Area + Module1Timeline prop interfaces (still tagged
  with eslint-disable so RealEstatePlatform binding doesn't shift).
- ProjectFAR migration from Land to Build Program → Plot (calc still consumes it as a
  project-level scalar; needs auto-derive from per-plot maxFARs first).

**Audit (2026-05-04, fix 5):** all 6 Module 1 tabs share a single `useModule1Store`
(direct subscription for Hierarchy + Area Program; prop-drilled setter wrappers from
RealEstatePlatform for Timeline / Land & Area / Dev Costs / Financing). No tab keeps a
private copy of project-level data. Cross-tab edits propagate via the store. The wizard
writes a complete `HydrateSnapshot` on create, every field a tab reads is covered, with
`DEFAULT_MODULE1_STATE` standing in for fields the wizard does not capture (country,
landParcels, projectFAR, costs, financing, those belong to dedicated tabs).

**M1.8 wizard hotfix series (5 commits, 2026-05-03 → 2026-05-04):**
- `a15fcbc` fix 1/3: pair Model Type + Status on same row in Step 1
- `e217978` fix 2/3: widen modal from 640px → 1080px
- `5085958` fix 3/3: skip round-trip re-hydrate after wizard create (added
  `attachToProjectFromLocalSnapshot` workaround; the underlying recogniser bug was flagged
  as M2.0/A follow-up at the time)
- `4721e80` fix 4: stabilise `Module1AreaProgram` `useShallow` selectors, every
  `useShallow(s => ({ ..., filtered: s.X.filter(...) }))` was producing a fresh array
  reference per render, tripping React's "getSnapshot should be cached" warning into a
  Maximum update depth loop once the store had data. Pulled filters out into separate
  `useModule1Store(s => s.X)` subscriptions + `useMemo` derivations.
- `66a20f5` fix 5: relax `isNewV3` recogniser in `module1-migrate.ts`, every snapshot
  the system POSTs (wizard create, legacy create, auto-save) is bare `HydrateSnapshot`
  with no `version: 3` discriminator. The strict recogniser silently fell through to
  `DEFAULT_MODULE1_STATE` on every reload, wiping the wizard data. Now shape-based:
  any payload with `assets[]` + `phases[]` + `costs[]` arrays is treated as v3.

**Snapshot baselines (3, all maintained at every commit):**
- `module1-snapshot-diff.ts`, legacy single-phase, **17.5 KB**
- `module1-multiphase-diff.ts`, multi-phase v4, **23.0 KB**
- `module1-areaprogram-diff.ts`, M1.7 Area Program, **2.8 KB**

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