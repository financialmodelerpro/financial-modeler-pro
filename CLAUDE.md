# Financial Modeler Pro — Claude Code Project Brief
**Last updated: 2026-05-04**

> **See also:**
> - [CLAUDE-DB.md](CLAUDE-DB.md) — Database tables, storage buckets, migrations log
> - [CLAUDE-FEATURES.md](CLAUDE-FEATURES.md) — Feature status, detailed feature specs & flows
> - [CLAUDE-ROUTES.md](CLAUDE-ROUTES.md) — All page routes, API routes, components, lib structure
> - [CLAUDE-TODO.md](CLAUDE-TODO.md) — Pending work, backlog, legacy reference

---

## STRICT SESSION RULES — READ FIRST

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
**When a task spans two domains**, read only those two folders — nothing else.

### End-of-session rule
**ALWAYS update CLAUDE.md files at the end of every session** to reflect:
- Any new files created (add to the correct folder list in CLAUDE-ROUTES.md)
- Any feature status changes (update the Feature Status table in CLAUDE-FEATURES.md)
- Any new environment variables added
- Any new database tables or migrations (add to CLAUDE-DB.md)

### Do NOT touch list
- `next.config.ts` — subdomain routing is live and correct; clean auth URL rewrites + redirects added; app. `/register` rewrite goes to `/modeling/register` (dedicated page, NOT `/modeling/signin?tab=register`)
- `src/middleware.ts` — `/admin/:path*` protection is live; `/admin/login` AND `/admin` root excluded
- `app/globals.css` — design system tokens, do not restructure
- `vercel.json` — deployment config is live
- `supabase/migrations/` — never edit existing migrations; create new ones only
- Any feature marked Complete unless explicitly asked by the user
- Cross-feature shared files (`src/lib/shared/`, `src/lib/email/`) without explicit instruction

---

## Project Overview

**Financial Modeler Pro** — Multi-hub SaaS platform with three web properties:

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
| Auth — Modeling Hub | NextAuth.js (JWT, 1hr session) | ^4.24.13 |
| Auth — Training Hub | Custom (httpOnly cookie + localStorage) | — |
| Forms | react-hook-form + zod + @hookform/resolvers | ^7 / ^4 / ^5 |
| Icons | lucide-react | ^0.577.0 |
| Utilities | clsx, tailwind-merge | — |
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

**Navbar auth links**: Use file-level constants `APP_URL` and `LEARN_URL` with `??` fallbacks — never raw `process.env` without fallback.

---

## Design System (DO NOT CHANGE)

- **Single source of truth**: `app/globals.css`
- Colors: `--color-primary`, `--color-primary-dark`, etc.
- Spacing: 8px grid — `--sp-1` (8px) through `--sp-5` (48px)
- Typography: `--font-h1` through `--font-micro`
- Component classes: `.card`, `.kpi-card`, `.btn-primary`, `.table-standard`
- Financial inputs (Training Hub + admin): `.input-assumption` class (yellow bg `--color-warning-bg`)
- **REFM (Module 1 tabs + shell + modals + new Area Program tab) uses FAST input blue** instead of `.input-assumption` — `var(--color-navy-pale)` bg + `var(--color-navy)` text via the local `inputStyle` constant in each component. Established Phases 4.6 → 4.15 (2026-04-30) and extended into the M1.7 Area Program tab (2026-05-02). Calculated outputs use the same pattern's `calcOutputStyle` (`var(--color-grey-pale)` bg + `var(--color-heading)` text). The `.input-assumption` class is reserved for actual financial-model assumption cells (rates, ratios, escalators) and continues to apply outside REFM.
- **Do NOT use Tailwind utility classes for layout tokens**

---

## Deployment — Vercel

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
npm run type-check   # tsc --noEmit — must be zero errors
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

# Playwright e2e specs (M1.8 + M1.9 regression-guards)
npx playwright test tests/e2e/m18-wizard-repro.spec.ts     # 1 spec — wizard create does not crash
npx playwright test tests/e2e/m18-wizard-flow.spec.ts      # 2 specs — every tab shows wizard data + reload persists
npx playwright test tests/e2e/m19-redesign-flow.spec.ts    # 2 specs — wizard lands on Schedule tab + numbered tab row + light/dark screenshots
```

### Per-phase verification workflow (M1.7+)
Standing preference (2026-05-02): every REFM phase ships a `scripts/verify-[phaseId].ts`
covering 5 sections — (1) Database / persistence (Supabase JSONB roundtrip via service-role),
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

### Module 1 status (2026-05-04)
**All sub-phases shipped:** M1.R (cost engine + Zustand restoration) → M1.5 (multi-asset
+ multi-phase + storage v3 bump) → M1.5b (UX polish + Quick Setup wizard inside Hierarchy)
→ M1.6 (Supabase persistence + version history) → M1.7 (Area Program tab + plots / zones
/ sub-units / parking allocator) → M1.8 (Smart Project Creation Wizard with progressive
disclosure + Master Holding hidden by default) → M1.9 (UX redesign: wizard captures
country + project timeline upfront; Schedule and Land tabs strip duplicate inputs;
numbered 1→6 tab sequence with Schedule first; wizard-created projects land on Schedule
for validation).

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
- `b8b54cc` 5/15: scripts/verify-m19.ts — 5-section per-phase verifier. 16 pass /
  0 fail / 2 skip without dev server. Section 4 includes a static source-file
  inspection that asserts JSX-context patterns (`>Project Identity<`, `>Asset Mix<`)
  are gone — false-positive free, so docstrings referencing the removed surfaces
  don't trip.
- `a8b9f34` 6/15: tests/e2e/m19-redesign-flow.spec.ts — 2 Playwright specs.
  Spec 1 walks wizard with country='United Arab Emirates' (auto-AED) +
  construction=7/operations=11/overlap=1, asserts Schedule landing tab, numbered
  tab row, M1.9 strip both tabs, stored snapshot has the wizard timing. Spec 2
  captures Schedule + Land tab screenshots (light + dark) into
  tests/screenshots/M1.9/. Both pass locally (2 passed, 22.9s).

**M1.9 deferred to M1.9b (architecturally invasive, separate session):**
- Dissolve Hierarchy tab into Project & Schedule (Master Holding + Sub-Project +
  Phase) and Build Program (Assets + Sub-Units full editor). Requires building
  the merged Project & Schedule tab + porting Hierarchy's per-asset editor into
  Build Program. Larger refactor — keeping Hierarchy as step 6 in M1.9 ship.
- Inline guidance: "What goes here" callouts at the top of each tab,
  section-pill labels (Inputs / Calculated), calc-vs-input pencil/fx icons,
  hover tooltips for vocabulary (Sub-Unit, Strategy, FAR, Cascade).
- Remove unused setters from Module1Area + Module1Timeline prop interfaces
  (currently kept with eslint-disable so RealEstatePlatform binding doesn't
  shift).
- ProjectFAR move from Land to Build Program → Plot (per audit; deferred
  because calc still consumes it as a project-level scalar — needs auto-derive
  from per-plot maxFARs to migrate cleanly).

**Audit (2026-05-04, fix 5):** all 6 Module 1 tabs share a single `useModule1Store`
(direct subscription for Hierarchy + Area Program; prop-drilled setter wrappers from
RealEstatePlatform for Timeline / Land & Area / Dev Costs / Financing). No tab keeps a
private copy of project-level data. Cross-tab edits propagate via the store. The wizard
writes a complete `HydrateSnapshot` on create — every field a tab reads is covered, with
`DEFAULT_MODULE1_STATE` standing in for fields the wizard does not capture (country,
landParcels, projectFAR, costs, financing — those belong to dedicated tabs).

**M1.8 wizard hotfix series (5 commits, 2026-05-03 → 2026-05-04):**
- `a15fcbc` fix 1/3: pair Model Type + Status on same row in Step 1
- `e217978` fix 2/3: widen modal from 640px → 1080px
- `5085958` fix 3/3: skip round-trip re-hydrate after wizard create (added
  `attachToProjectFromLocalSnapshot` workaround; the underlying recogniser bug was flagged
  as M2.0/A follow-up at the time)
- `4721e80` fix 4: stabilise `Module1AreaProgram` `useShallow` selectors — every
  `useShallow(s => ({ ..., filtered: s.X.filter(...) }))` was producing a fresh array
  reference per render, tripping React's "getSnapshot should be cached" warning into a
  Maximum update depth loop once the store had data. Pulled filters out into separate
  `useModule1Store(s => s.X)` subscriptions + `useMemo` derivations.
- `66a20f5` fix 5: relax `isNewV3` recogniser in `module1-migrate.ts` — every snapshot
  the system POSTs (wizard create, legacy create, auto-save) is bare `HydrateSnapshot`
  with no `version: 3` discriminator. The strict recogniser silently fell through to
  `DEFAULT_MODULE1_STATE` on every reload, wiping the wizard data. Now shape-based:
  any payload with `assets[]` + `phases[]` + `costs[]` arrays is treated as v3.

**Snapshot baselines (3, all maintained at every commit):**
- `module1-snapshot-diff.ts` — legacy single-phase, **17.5 KB**
- `module1-multiphase-diff.ts` — multi-phase v4, **23.0 KB**
- `module1-areaprogram-diff.ts` — M1.7 Area Program, **2.8 KB**

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
- GET is public (no auth) — PATCH requires admin