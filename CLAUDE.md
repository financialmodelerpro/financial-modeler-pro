# Financial Modeler Pro, Claude Code Project Brief
**Last updated: 2026-05-20.**

**Module status (REFM platform):**
- **Module 1 (Project Setup / Costs / Financing)** — LOCKED at M2.0 Pass 58. Funding Methods 2 + 3 (cash-deficit driven) still on the backlog.
- **Module 2 (Revenue + Cost of Sales + Schedules + Escrow)** — LOCKED at Pass 9k. Engines: Residential Sell, Hospitality (pure Operate + Sell+Manage companions), Retail/Office Lease + DSO AR + Escrow + CoS. Verifiers `verify-revenue-rebuild` 133/133 + `verify-escrow` 46/46 green. Inputs grouped by strategy bucket (Residential → Hospitality → Retail/Lease), phase shown as a small tag on each asset card. Phase-date bug class fully defended: storage shape is phase-local (`ByPhase`) for asset-scoped fields and year-keyed (`ByYear`) for HQ + financing tranches; setter pruning + hydration migration keep stale window data out.
- **Module 3 (Operating Expenses)** — LOCKED at Pass 5c. Per-asset line-item engine (Hospitality + Lease) + HQ corporate overheads + Pass 2a AP (DPO-driven). Inputs flat by strategy bucket; outputs grouped category-wise per asset + project rollup. Lease can carry G&A. Verifiers `verify-opex` 38/38 + `verify-opex-ap` 24/24 green.
- **Module 4 (Financial Statements)** — WIP at Pass 2L. Composer `computeFinancialsSnapshot` pulls every upstream engine and produces P&L + Direct CF + Indirect CF + BS + IDC allocation. Four sub-tabs in sidebar: Schedules (parent shell with Fixed Assets & D&A + BS Schedules sub-tabs) / P&L / Cash Flow / Balance Sheet. Pass 2j adds prior-year column (existing-ops opening balances). Pass 2k nests per-asset rows under strategy buckets. Pass 2L makes Revenue / CoS / Opex / Capex sections collapsible, replaces asset-filter dropdown with phase-filter buttons (P&L + Direct CF), and breaks debt financing into per-tranche lines (Drawdown / Drawdown IDC / Repayment / Finance Cost). Verifiers `verify-fixed-assets` 82/82 + `verify-phase-date-preservation` 16/16 green. **Known gaps**: BS phase filter not built; Indirect CF has no Phase column / filter; Finance Cost not yet split IDC-window vs Operations-window per tranche; opening cash input for projects with pre-existing financing; per-asset capex uniform spread within construction window. See [[project_audit_2026-05-20]].

**M2 lock conventions** (apply to M3+ unless overridden):
- The reference Excel at repo root is the verification benchmark, not a behavioural spec. Every reference-specific behaviour stays configurable; never hard-code currency, locale, escrow, or DSO defaults into engine paths.
- Engine storage is project-axis-indexed (`arr[0]` = first active project year). Only the UI window changes per asset / strategy.
- Vintage matrices (cohort year × cash year, cohort year × recognition year, capex year × CoS year) are the canonical mechanic for both recognition and cash distribution.
- PIT recognition handover = LAST construction year (`phaseStart + cp − 1 − projectStart`), NOT first operations year. Verifier A2-1..A2-5 pin this.
- See CLAUDE-REFM.md for the full Pass 7-9 narrative; older pass detail is archived to CLAUDE-FEATURES.md.

> **See also:**
> - [CLAUDE-MODELING-HUB.md](CLAUDE-MODELING-HUB.md), Modeling Hub wrapper, platform catalog, P-Sync admin conventions
> - [CLAUDE-REFM.md](CLAUDE-REFM.md), Real Estate Financial Modeling (REFM), Module 1 status + conventions
> - [CLAUDE-DB.md](CLAUDE-DB.md), Database tables, storage buckets, migrations log
> - [CLAUDE-FEATURES.md](CLAUDE-FEATURES.md), Feature status, archived phase narratives (M1.R → M1.13d pre-M2.0 + M2.0 → M2.0i post-rebuild)
> - [CLAUDE-ROUTES.md](CLAUDE-ROUTES.md), All page routes, API routes, components, lib structure
> - [CLAUDE-TODO.md](CLAUDE-TODO.md), Pending work, backlog, legacy reference
> - [ARCHITECTURE.md](ARCHITECTURE.md), Three-tier folder rationale, alias guide, boundary rules
> - [PROJECT_HANDOFF.md](PROJECT_HANDOFF.md), Frozen 2026-05-02 snapshot for resuming a cold session (M1.7-era detail)

---

## STRICT SESSION RULES, READ FIRST

### Writing rule: NEVER use the reference client's name

The user has shared private reference Excel models that we use as a verification benchmark only. The client / model name **must never appear in this codebase**, including:
- UI strings (tooltips, captions, hints, formula text, error messages, labels)
- Code comments
- Variable / function / file names
- Commit messages, PR descriptions, branch names
- Project documentation, MD files, README
- Test fixtures (use generic names like `refAsset`, `refPhases`, "the reference fixture")

If you need to refer to a behaviour learned from the reference Excel, use phrasing like "the reference model", "the reference benchmark", or "the reference design" — never the client's actual name. Any historical references that slip through must be scrubbed when found.

The reference Excel files at the repo root are `.gitignore`-listed and must stay that way. Do not commit them.

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

| Task | Read ONLY these paths + MDs |
|------|------------------------------|
| Training auth (login / register / confirm) | `app/training/signin/` `app/training/register/` `app/training/confirm-email/` `app/training/forgot/` `app/api/training/validate/` `app/api/training/register/` `app/api/training/confirm-email/` `app/api/training/device-verify/` `app/api/training/resend-confirmation/` `src/lib/training/training-session.ts` `src/lib/shared/` |
| Training dashboard / course content | `app/training/dashboard/` `app/training/[courseId]/` `src/components/training/dashboard/` `app/api/training/` |
| Training assessment / quiz | `app/training/assessment/` `app/training/[courseId]/assessment/` `app/api/training/[courseId]/assessment/` `app/api/training/submit-assessment/` |
| Certificate / transcript | `app/training/certificate/` `app/training/certificates/` `app/training/transcript/` `src/components/training/dashboard/CertificateImageCard.tsx` `src/lib/training/certifier.ts` `src/lib/training/certificateLayout.ts` `app/api/training/certificate/` `app/api/training/certificate-image/` `app/api/t/[token]/pdf/` |
| Modeling Hub auth | `app/modeling/signin/` `app/modeling/confirm-email/` `app/api/auth/` `src/lib/shared/auth.ts` `src/lib/shared/deviceTrust.ts` `src/lib/shared/emailConfirmation.ts` `src/lib/shared/captcha.ts` |
| Modeling Hub wrapper (sidebar, platform list, admin sync) | + read **CLAUDE-MODELING-HUB.md**. Paths: `app/admin/platform-modules/` `app/api/platforms/` `app/api/admin/platform-module-pages/` `src/lib/modeling/platform-modules/` `src/components/refm/` `src/hubs/modeling/` `app/modeling-hub/` |
| REFM platform (Module 1, Real Estate) | + read **CLAUDE-MODELING-HUB.md** + **CLAUDE-REFM.md**. Paths: `app/refm/` `app/modeling/` `src/components/refm/` `src/lib/modeling/` `src/hubs/modeling/platforms/refm/` `src/core/calculations/` (REFM bits) |
| Admin panel | `app/admin/` `src/components/admin/` `app/api/admin/` |
| Email system | `src/shared/email/` |
| Shared utilities | `src/lib/shared/` `src/core/` |
| Navbar / layout | `src/components/layout/` |
| Landing pages / CMS | `app/(portal)/` `app/about/` `app/articles/` `app/pricing/` `src/components/landing/` `app/api/cms/` |

**Never** read files outside the task domain. **When a task spans two domains**, read only those two folders, nothing else. Per-platform MD only loads when working on that platform; the global CLAUDE.md stays lean.

### End-of-session rule
**ALWAYS update CLAUDE.md files at the end of every session** to reflect:
- Any new files created (add to the correct folder list in CLAUDE-ROUTES.md)
- Any feature status changes (update the Feature Status table in CLAUDE-FEATURES.md)
- Any new environment variables added
- Any new database tables or migrations (add to CLAUDE-DB.md)
- Platform-specific work: update the relevant `CLAUDE-{platform}.md`, NOT the root CLAUDE.md

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
- **Per-platform input styles** (e.g. REFM's FAST input blue) are documented in the relevant `CLAUDE-{platform}.md`. The `.input-assumption` class is reserved for actual financial-model assumption cells (rates, ratios, escalators) and continues to apply outside platform overrides.
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

### Generic Scripts
```bash
npm run type-check   # tsc --noEmit, must be zero errors
npm run build        # next build --webpack (avoids MAX_PATH on Windows/OneDrive)
npm run verify       # type-check + lint + build
```

**Per-platform verifier scripts + per-phase verification workflow** live in the relevant `CLAUDE-{platform}.md` (e.g. CLAUDE-REFM.md for REFM Module 1).

### Health Check
`GET /api/health` -> `{ status: 'ok', platform: 'financial-modeler-pro', version: '3.0', timestamp }`

---

## Modeling Hub & Platforms

For the platform catalog, P-Sync admin sync conventions, and per-platform MD index see **[CLAUDE-MODELING-HUB.md](CLAUDE-MODELING-HUB.md)**. Live platforms have their own MD:
- **REFM (Real Estate)**: [CLAUDE-REFM.md](CLAUDE-REFM.md), currently on M2.0 Costs Cleanup Pass 9

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
