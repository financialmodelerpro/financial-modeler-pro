# Platform Inventory

> Read-only diagnostic snapshot for restructure planning. Generated 2026-04-28.
> Sources: live filesystem, git status, plus the four CLAUDE-*.md companion docs.
> Discrepancies between code and docs are flagged inline.

---

## Section 1. High-Level Architecture

### Three hubs, one Next.js app

| Hub | Public host | Served from | Auth model |
|-----|-------------|-------------|------------|
| Main Site | `financialmodelerpro.com` (Vercel auto-redirects apex to `www.`) | `app/(portal)/`, `app/(cms)/[slug]/`, `app/about/`, `app/articles/`, `app/contact/`, `app/pricing/`, `app/portal/`, `app/verify/`, `app/t/`, `app/admin/*` | NextAuth (admin only) |
| Training Hub | `learn.financialmodelerpro.com` | `app/training/*`, `app/training-sessions/*` (rewritten via `next.config.ts`) | Custom `training_session` httpOnly cookie + 1-hour TTL |
| Modeling Hub | `app.financialmodelerpro.com` | `app/modeling/*`, `app/refm/*`, `app/portal/*` (rewritten via `next.config.ts`) | NextAuth Credentials (JWT, 1-hour) |

All three are served by a single Next.js 16 deployment. No separate processes, no separate databases. The Vercel project hosts one `next.js build` artifact and the host header determines which hub renders.

### Subdomain routing (`next.config.ts`)

Three host-rewrite groups in `beforeFiles`:
- `learn.*` root rewrites to `/training`; `/signin`, `/register`, `/forgot` rewrite to `/training/signin`, `/training/register`, `/training/forgot`. `/training-sessions` is served as-is on learn.
- `app.*` root rewrites to `/modeling`; `/signin`, `/register` rewrite to `/modeling/signin`, `/modeling/register`.
- All other paths fall through to the matching `app/...` route.

Cross-host redirects in `redirects()`:
- Main-site paths (`/about`, `/articles`, `/pricing`, `/contact`, `/login`, `/forgot-password`, `/reset-password`, `/admin`, `/portal`, `/t`, `/testimonials`, `/confidentiality`, `/privacy-policy`) on `learn.*` or `app.*` 307 to main.
- Main domain `/training/:path*`, `/refm/:path*`, `/modeling/:path*`, `/training-sessions[/:id]`, `/verify/:id` 308 to the appropriate subdomain. Host regex is `(www\.)?financialmodelerpro\.com` to catch both apex (post-Vercel-hop) and www.
- Legacy `/admin/login`, `/login`, `/admi` 307 to `/admin`.
- `/about` 308 to `/about/ahmad-din`. `/modeling-hub`, `/modeling-hub/*` 308 to `/modeling`, `/modeling/*`.

### Auth model details

| Hub | Provider | Session storage | Password storage | Device trust | OTP table |
|-----|----------|-----------------|------------------|--------------|-----------|
| Training | Custom (`src/lib/training/training-session.ts`) | httpOnly cookie `training_session` + localStorage mirror | `training_passwords` (bcrypt) | `trusted_devices` keyed by email | `training_email_otps` |
| Modeling | NextAuth Credentials | NextAuth JWT cookie | `users.password_hash` (Node `crypto.scrypt`) | `trusted_devices` keyed by email | `modeling_email_otps` |
| Admin | NextAuth Credentials | NextAuth JWT cookie | `users.password_hash` | `trusted_devices` keyed by email | `modeling_email_otps` (shared with Modeling, since admin is just a NextAuth role) |

The `trusted_devices` and `email_confirmations` tables are the only auth surface shared across hubs.

### Database approach

Hybrid:
- **Supabase** is the primary data layer. 141 migrations on disk in `supabase/migrations/` (numbered up to 145 with gaps at 069, 073, 127). Supabase covers students, certificates, watch progress, assessment results, content, newsletter, marketing studio, instructors, live sessions.
- **Google Apps Script** is still the source of truth for the Training Hub student roster and Registration ID allocation. `src/lib/training/appsScript.ts` and `src/lib/training/sheets.ts` mediate. Only four call sites remain: `app/training/assessment/[tabKey]/page.tsx`, `app/api/admin/reset-attempts/route.ts`, `app/api/training/questions/route.ts`, `app/api/training/course-details/route.ts`.

Storage buckets (Supabase Storage): `certificates`, `badges`, `course-materials`, `live-session-banners`, `cms-assets`, `marketing-assets`.

### Tech stack snapshot (`package.json`)

| Layer | Tech | Version |
|-------|------|---------|
| Framework | next | ^16.2.1 |
| React | react / react-dom | 19.2.3 |
| TS | typescript | ^5 |
| Styling | tailwindcss | ^4 |
| State | zustand | ^5.0.11 |
| Charts | recharts | ^3.8.0 |
| DB client | @supabase/supabase-js | ^2.99.1 |
| Auth | next-auth | ^4.24.13 |
| Email | resend | ^6.10.0 |
| Forms | react-hook-form / zod / @hookform/resolvers | ^7 / ^4 / ^5 |
| AI | @anthropic-ai/sdk | ^0.78.0 |
| PDF | pdf-lib | ^1.17.1 |
| Excel | exceljs | ^4.4.0 |
| Image | sharp | ^0.34.5 |
| OG render | satori | ^0.26.0 |
| Tiptap | @tiptap/react + 7 extensions | 2.27.2 |
| Drag (admin) | @hello-pangea/dnd | ^18.0.1 |
| Drag (canvas, unused) | react-rnd | ^10.5.3 |
| Onboarding | driver.js | ^1.4.0 |
| Captcha | @hcaptcha/react-hcaptcha | ^2.0.2 |
| Analytics | @vercel/analytics + @vercel/speed-insights | ^2 |

Build command is `next build --webpack` (Turbopack disabled because of MAX_PATH on Windows/OneDrive).

---

## Section 2. Hub-by-hub Feature Inventory

### 2A. Main Site (`financialmodelerpro.com`)

#### Public-facing pages

| Route | File | Purpose |
|-------|------|---------|
| `/` | `app/(portal)/page.tsx` | Home (CMS Option B; sections from `page_sections` slug=`home`) |
| `/about/ahmad-din` | `app/about/ahmad-din/page.tsx` | Founder profile (reads `page_sections.team`) |
| `/articles` | `app/articles/page.tsx` | Article index |
| `/articles/[slug]` | `app/articles/[slug]/page.tsx` | Article detail with `ArticleJsonLd` |
| `/book-a-meeting` | `app/book-a-meeting/page.tsx` | Calendly inline embed (URL from `page_sections.team.content.booking_url`) |
| `/contact` | `app/contact/page.tsx` | Contact form |
| `/pricing` | `app/pricing/page.tsx` | Reads `page_sections` slug=`pricing` (commit `50e22fa`) plus `platform_pricing` |
| `/portal` | `app/portal/page.tsx` | Authed hub showing all 10 platforms (live + coming soon). Imports `@/src/config/platforms` |
| `/verify` | `app/verify/page.tsx` + `VerifySearchForm.tsx` | Public certificate ID lookup form |
| `/verify/[uuid]` | `app/verify/[uuid]/page.tsx` + `VerifyActions.tsx` | Public verification page (cert PDF + badge + transcript previews + share). Layout pins canonical to `learn.*` |
| `/t/[token]` | `app/t/[token]/page.tsx` | Token-gated transcript |
| `/(cms)/[slug]` | `app/(cms)/[slug]/page.tsx` | Catch-all dynamic CMS pages (privacy-policy, terms-of-service, confidentiality, refund-policy) |
| `/forgot-password`, `/reset-password`, `/settings`, `/testimonials/submit` | Various | Auth + settings |
| `/about` | (redirect via `next.config.ts`) | 308 to `/about/ahmad-din` |

#### Authenticated user features

The portal page is the only authed experience on the main domain. It requires NextAuth (admin or non-admin user) and lists every `PLATFORMS` entry. There is no per-user persistence on the main domain itself.

#### Admin features

`app/admin/*` (28 admin pages plus dynamic routes). Documented in detail in Section 5.

#### Integrations (this hub)

- Calendly inline embed for `/book-a-meeting`.
- hCaptcha on contact form.
- Vercel Analytics + Speed Insights mounted in `app/layout.tsx`.

### 2B. Training Hub (`learn.financialmodelerpro.com`)

#### Public-facing pages

| Route | File | Purpose |
|-------|------|---------|
| `/training` | `app/training/page.tsx` | Marketing landing (CMS Option B, slug=`training`, migrations 065-066) |
| `/training-sessions` | `app/training-sessions/page.tsx` + `SessionsClient.tsx` | Public live-session list (no auth, no `live_url`) |
| `/training-sessions/[id]` | `app/training-sessions/[id]/page.tsx` + `DetailClient.tsx` | Public live-session detail (no `live_url` until registered + 30 min before) |
| `/signin`, `/register`, `/forgot` | Rewrites to `/training/signin`, `/training/register`, `/training/forgot` | Custom auth |
| `/training/coming-soon` | `app/training/coming-soon/page.tsx` | Standalone CS preview |
| `/training/confirm-email` | `app/training/confirm-email/page.tsx` | Email-confirmation token landing |
| `/verify/[uuid]` | (canonical host = learn) | Cert verification, see Main Site |

#### Authenticated user features (gated by `training_session` cookie)

| Route | File | Notes |
|-------|------|-------|
| `/training/dashboard` | `app/training/dashboard/page.tsx` | Overview + course view, mobile bottom nav, sidebar collapsible, walkthrough tour |
| `/training/[courseId]` | `app/training/[courseId]/page.tsx` | Course shell (3SFM, BVM) |
| `/training/[courseId]/assessment` | `app/training/[courseId]/assessment/page.tsx` | Course-level assessment entry |
| `/training/assessment/[tabKey]` | `app/training/assessment/[tabKey]/page.tsx` | Per-session quiz with timer + share |
| `/training/watch/[courseId]/[sessionKey]` | `app/training/watch/[courseId]/[sessionKey]/page.tsx` | Embedded video player + watch enforcement |
| `/training/live-sessions` | `app/training/live-sessions/page.tsx` + `LiveSessionsClient.tsx` | Auth list of upcoming + recorded |
| `/training/live-sessions/[id]` | `app/training/live-sessions/[id]/page.tsx` | Live-session detail with register/join |
| `/training/live-sessions/[id]/assessment` | `app/training/live-sessions/[id]/assessment/page.tsx` + `AssessmentClient.tsx` | Native live-session quiz (migration 105) |
| `/training/certificate`, `/training/certificates` | Cert pages | One-cert + multi-cert |
| `/training/transcript/[token]` | `app/training/transcript/[token]/page.tsx` | Token-gated transcript |
| `/training/material/*` | `app/training/material/layout.tsx` | Material download paths |
| `/training/profile`, `/training/submit-testimonial` | Profile + testimonial submission | |
| `/training/set-password` | Password set/reset for OTP-driven flow | |

#### Admin features (Training-Hub-owned but live under `/admin/*` on main domain)

See Section 5. Specifically the `Training Hub` sidebar section: `/admin/training-hub/*`, `/admin/training/*`, `/admin/training-settings`, `/admin/certificate-designer`, `/admin/communications-hub`.

#### Integrations (this hub)

- Google Apps Script (roster + RegID + assessment dual-write).
- Microsoft Graph / Teams (`src/lib/integrations/teamsMeetings.ts`) for live-session calendar event + meeting auto-generation.
- YouTube Data API v3 for cached comments and embedded player.
- Resend for student emails.
- Anthropic Claude (newsletter rewrite assist).

### 2C. Modeling Hub (`app.financialmodelerpro.com`)

#### Public-facing pages

| Route | File | Purpose |
|-------|------|---------|
| `/modeling` | `app/modeling/page.tsx` | Marketing landing (CMS Option B, slug=`modeling`, migration 070) |
| `/modeling/[slug]` | `app/modeling/[slug]/page.tsx` | Per-platform sub-page (CMS-first, falls back to `PLATFORMS` config) |
| `/signin`, `/register` | Rewrites to `/modeling/signin`, `/modeling/register` | NextAuth-backed auth |
| `/modeling/confirm-email` | `app/modeling/confirm-email/page.tsx` | Email-confirmation landing |
| `/modeling/submit-testimonial` | `app/modeling/submit-testimonial/page.tsx` | Testimonial submission |

#### Authenticated user features

| Route | File | Notes |
|-------|------|-------|
| `/modeling/dashboard` | `app/modeling/dashboard/page.tsx` | Authed hub showing all platforms |
| `/refm` | `app/refm/page.tsx` | The only live platform; loads `RealEstatePlatform` (1427 lines) |
| `/portal` | `app/portal/page.tsx` | (Cross-hub) authed hub when accessed on app subdomain |

The authentication chain is gated by `modeling_hub_signin_coming_soon` and `modeling_hub_register_coming_soon` (migration 136 split). Whitelist via `modeling_access_whitelist` table; admins skip the gate via NextAuth role; `?bypass=true` is a QA escape.

#### Admin features

See Section 5. Specifically the `Modeling Hub` sidebar section: `/admin/modules`, `/admin/modeling-access`.

#### Integrations (this hub)

- Anthropic Claude (`src/agents/agent-*.ts`) for market research + market data + contextual help. Each file is a 2-line stub today (`export {};`); only `/api/agents/market-rates/route.ts` and `/api/agents/research/route.ts` carry real logic.
- Excel and PDF export via exceljs and @react-pdf/renderer (REFM only).

---

## Section 3. Modeling Hub Platforms

Source: `src/config/platforms.ts` + actual filesystem state.

| Slug | shortName | Status (config) | Modules complete (config) | Filesystem state |
|------|-----------|-----------------|---------------------------|------------------|
| `real-estate` | REFM | live | Module 1 complete; Modules 2 in_progress; 3-6 planned | Module 1 implemented (`src/components/refm/modules/Module1Area.tsx` 435L, `Module1Costs.tsx` 1355L, `Module1Financing.tsx` 1094L, `Module1Timeline.tsx` 381L, `src/lib/modeling/real-estate/modules/module1-setup.ts` 210L). Modules 2-11 are 2-line `export {};` stubs in `src/lib/modeling/real-estate/modules/`. Excel + PDF export files (`export-excel-static.ts`, `export-excel-formula.ts`, `export-pdf.ts`) are also 2-line stubs despite CLAUDE.md claiming "Excel / PDF Export (REFM) Complete" |
| `business-valuation` | BVM | coming_soon | empty `modules: []` | No code |
| `fpa-modeling` | FP&A | coming_soon | empty | No code |
| `equity-research` | ERM | coming_soon | empty | No code |
| `project-finance` | PFM | coming_soon | empty | No code |
| `lbo-modeling` | LBO | coming_soon | empty | No code |
| `corporate-finance` | CFM | coming_soon | empty | No code |
| `energy-utilities` | EUM | coming_soon | empty | No code |
| `startup-venture` | SVM | coming_soon | empty | No code |
| `banking-credit` | BCM | coming_soon | empty | No code |

#### Discrepancy flag

CLAUDE-FEATURES.md says `Excel / PDF Export (REFM) Complete | exceljs static + formula, @react-pdf/renderer`. The actual library files are stubs:

```
2 D:/FMP/.../export-excel-formula.ts
2 D:/FMP/.../export-excel-static.ts
2 D:/FMP/.../export-pdf.ts
```

Either the export logic was inlined into `src/components/refm/modals/ExportModal.tsx` (226L) and the lib files are abandoned scaffolding, or the export feature is itself a stub. This needs human verification before any claim of "complete" is made externally.

#### Shared infrastructure dependencies (REFM)

- `@/src/config/platforms` for module list (declarative).
- `@/src/types/project.types`, `@/src/types/scenario.types`, `@/src/types/revenue.types`, `@/src/types/deck.types`, `@/src/types/branding.types`, `@/src/types/settings.types` (all in `src/types/`).
- `@/src/core/core-calculations`, `@/src/core/core-formatters`, `@/src/core/core-state`, `@/src/core/branding`.
- `@/src/components/ui/OfficeColorPicker` (only foreign import in `src/components/refm/Topbar.tsx`).
- `useRequireAuth` (`src/hooks/useRequireAuth.ts`).

REFM has no imports from `@/src/lib/training`, `@/src/components/training`, `@/src/components/landing`, `@/src/components/cms`. It is cleanly self-contained except for the universal hooks/types.

---

## Section 4. Shared Infrastructure

### 4A. `src/components/shared/`

| File | Purpose |
|------|---------|
| `BrandingThemeApplier.tsx` | Hydrates branding store, injects `--color-primary` / `--color-secondary` |
| `CountdownTimer.tsx` | Reusable Days/Hrs/Min/Sec grid (per-hub theming) |
| `FollowPopup.tsx` | LinkedIn + YouTube follow toast |
| `PhoneInput.tsx` | E.164 phone input |
| `PreLaunchBanner.tsx` | Banner for Coming-Soon bypass-listed testers (migration 121) |
| `SessionProviderWrapper.tsx` | NextAuth session provider |
| `ShareExperienceModal.tsx` | 3-tab testimonial share modal (used by both hubs) |
| `SiteFollowPopup.tsx` | Site-wide 60s popup wrapper |
| `UpgradePrompt.tsx` | Premium-feature lock card (REFM consumes; gates default to `false` post-Permissions removal) |

Imports check: zero hub-specific imports. Clean.

### 4B. `src/lib/shared/`

| File | Purpose |
|------|---------|
| `audit.ts` | `admin_audit_log` writer |
| `auth.ts` | NextAuth Credentials provider for Modeling Hub + Admin. Imports `modelingComingSoon`, `modelingAccess` |
| `captcha.ts` | hCaptcha verifier |
| `cms.ts` | `getAllPageSections`, `getPageSections`, `getTestimonialsForPage` |
| `comingSoonGuard.ts` | **Cross-hub leak**: imports `getTrainingCookieSession` from `@/src/lib/training/trainingSessionCookie` |
| `deviceTrust.ts` | `trusted_devices` reader/writer |
| `emailConfirmation.ts` | `email_confirmations` token table |
| `htmlUtils.ts` | `isHtml()` detector |
| `hubBypassList.ts` | Training Hub bypass-list lookup (migration 121) |
| `modelingAccess.ts` | `canEmailSigninModeling`, `canEmailRegisterModeling`, whitelist CRUD |
| `modelingComingSoon.ts` | `getModelingSigninComingSoonState`, etc. |
| `ogFonts.ts` | Inter font loader for satori |
| `password.ts` | scrypt + bcrypt verify helpers |
| `storage.ts` | Supabase Storage helpers |
| `supabase.ts` | `getServerClient()`, `serverClient` exports |
| `trainingComingSoon.ts` | Training Hub coming-soon state |
| `urls.ts` | `URLS` constant + `URLS.training()`, `URLS.modeling()`, `URLS.refm()`, `URLS.verify()`. **Currently unused** (zero importers found via grep) |

Imports check: only `comingSoonGuard.ts` violates the boundary.

### 4C. Core infrastructure

| Layer | File(s) | Notes |
|-------|---------|-------|
| Database client | `src/lib/shared/supabase.ts` | `getServerClient()` factories |
| Auth helpers | `src/lib/shared/auth.ts`, `deviceTrust.ts`, `emailConfirmation.ts`, `password.ts` | Modeling Hub + Admin |
| Training-specific session | `src/lib/training/training-session.ts`, `trainingSessionCookie.ts` | Training Hub only |
| Email | `src/lib/email/sendEmail.ts` (single + `sendEmailBatch`), `sendTemplatedEmail.ts` (CMS-driven) | All hubs |
| File storage | `src/lib/shared/storage.ts` | Supabase Storage wrapper |
| API helpers | None centralized; routes use `NextResponse.json()` directly | |
| URLs | `src/lib/shared/urls.ts` | Currently unreferenced, but ready for adoption |

### 4D. Email system

#### Templates (`src/lib/email/templates/`)

| Template | Purpose |
|----------|---------|
| `_base.ts` | `baseLayoutBranded()` (async; reads `email_branding` row). Legacy `baseLayout()` retained but unused |
| `accountConfirmation.ts` | Modeling Hub email confirm |
| `certificateIssued.ts` | Cert email |
| `confirmEmail.ts` | Generic confirm |
| `deviceVerification.ts` | OTP for new-device |
| `liveSessionNotification.ts` | Has its own `emailShell()` that fetches `email_branding` directly |
| `lockedOut.ts` | Quiz max-attempts |
| `newsletter.ts` | Custom `baseLayoutNewsletter()` with `Structured Modeling. Real-World Finance.` signature |
| `otpVerification.ts` | OTP container |
| `passwordReset.ts` | Password reset |
| `quizResult.ts` | Quiz pass/fail |
| `registrationConfirmation.ts` | Live-session registration confirmation |
| `resendRegistrationId.ts` | Email RegID lookup |

All template functions are async; callers must `await`.

#### Newsletter pipeline (`src/lib/newsletter/`, migration 143)

| File | Role |
|------|------|
| `sender.ts` | `sendCampaign()` central pipeline. Resolves segment, seeds `pending` rows, fires `resend.batch.send([100])`, 200ms stagger, updates per-row status. Single entry for manual + scheduled + auto + retry-failed |
| `segments.ts` | 7 segments: `all_active`, `active_30_days`, `passed_3sfm`, `passed_bvm`, `never_started`, `has_certificate`, `no_certificate` |
| `templates.ts` | DB-backed engine (`getTemplate(key)`, `renderForEvent(eventType, vars)`) |
| `linkWrap.ts` | Rewrites every `<a href>` to `/api/newsletter/click?msg={msg}&campaign=X&url=encoded` |
| `autoNotify.ts` | Article-publish, live-session-publish, recording-available triggers; calls `renderForEvent` then hands off to `sendCampaign` |

Triggers consumed: `/api/admin/newsletter/send`, `/api/admin/newsletter/test-send`, `/api/cron/newsletter-scheduled` (daily 07:00 UTC), `/api/webhooks/resend` (Svix HMAC-SHA256 manual verification), `/api/newsletter/click` (302 redirector), `/api/newsletter/subscribe` (signup opt-in fire-and-forget), `/api/newsletter/unsubscribe`.

Auto-notify is consumed by both Training Hub events (article publish, live-session publish/recording) and is also forward-compatible for Modeling Hub. The pipeline itself is hub-neutral.

### 4E. File / Image processing

| Pipeline | Location | Notes |
|----------|----------|-------|
| PDF generation (certs, transcripts) | `src/lib/training/certificateEngine.ts`, `src/lib/training/certificateLayout.ts` | pdf-lib |
| Badge rendering | `src/lib/training/certificateEngine.ts` | satori SVG -> sharp PNG composite onto base badge PNG |
| OG images | `app/api/og/route.tsx` (learn), `app/api/og/main/route.tsx`, `app/api/og/modeling/route.tsx`, `app/api/og/certificate/[id]/route.tsx`, `app/api/training/achievement-image/route.tsx` | satori `ImageResponse` + sharp |
| Marketing Studio render | `app/api/admin/training-hub/marketing-studio/render/route.ts` | Single dispatcher; satori `ImageResponse` per template (LinkedIn 3 variants, Live Session, YouTube, Article) |
| Image utils | `src/lib/marketing-studio/image-utils.ts` (server only, imports sharp) and `style-utils.ts` (client safe). Split by commit `0e2129a` to keep sharp out of the client bundle |

---

## Section 5. Admin Panel Inventory

Sidebar source: `src/components/admin/CmsAdminNav.tsx` (consumed by 30 admin pages).

### Universal admin (apply to all hubs)

| Route | What it does |
|-------|--------------|
| `/admin` | Single auth entry. Authed admin -> 307 `/admin/dashboard`, else render `<AdminLoginClient />` |
| `/admin/dashboard` | Server redirect to `/admin/cms` |
| `/admin/analytics` | Platform-wide analytics dashboard (signups, active 7/30d, course funnel, certificate rate, course comparison, live sessions). 8 parallel Supabase queries. Uses recharts (2026-04-24) |
| `/admin/audit` | `audit_log` viewer |
| `/admin/health` | System health check |
| `/admin/users` | User list (NextAuth `users` table) |
| `/admin/settings` | Account settings |
| `/admin/site-settings` | Global site settings (header, footer, colors, SEO JSONB) |
| `/admin/header-settings` | Header logo / nav config + Brand Colors (merged in commit `ab5db30`) |
| `/admin/branding` | 5-line redirect to `/admin/header-settings` |
| `/admin/cms` | CMS hub overview |
| `/admin/content` | Content overview |
| `/admin/page-builder` | Page list |
| `/admin/page-builder/[slug]` | Section editor with drag-and-drop (21 section types) |
| `/admin/pages` | Pages list |
| `/admin/projects` | Modeling Hub projects browser |
| `/admin/media` | Media uploads |
| `/admin/articles` | + `[id]/`, `new/` |
| `/admin/contact` | Contact submissions |
| `/admin/testimonials` | + `modeling/`, `training/` (hub-tagged) |

### Training Hub admin (sidebar section)

| Route | What it does |
|-------|--------------|
| `/admin/training-hub` | Training overview |
| `/admin/training-hub/students` | Student list |
| `/admin/training-hub/cohorts` + `/[id]` | Cohort management |
| `/admin/training-hub/assessments` | Assessment results table |
| `/admin/training-hub/certificates` | Issued certs + safety-net "Eligible but not issued" panel + Email column with Resend |
| `/admin/training-hub/instructors` | Instructor roster (migration 106) |
| `/admin/training-hub/live-sessions` + `/email-settings` | Live session CRUD; email-settings is now a 5-line redirect |
| `/admin/training-hub/course-details` | Per-course detail editor |
| `/admin/training-hub/marketing-studio` | 4 banner template editors + asset library (migration 142) |
| `/admin/training-hub/daily-roundup` | Daily certs roll-up post (migration 117) |
| `/admin/training-hub/analytics` | Redirect to `/admin/analytics` |
| `/admin/training-hub/communications` | 5-line redirect to `/admin/communications-hub?tab=campaigns` |
| `/admin/training-hub/share-templates` | 5-line redirect to `/admin/communications-hub?tab=share-templates` |
| `/admin/training` + `/[courseId]` | Course manager (per-course structure + content) |
| `/admin/training-settings` | Apps Script URL, Watch Enforcement, Assessment Settings, Training Hub launch toggle, walkthrough video URL |
| `/admin/communications-hub` | Unified hub with 4 tabs: campaigns / email-settings / share-templates / newsletter (commit `5d81e06`) |
| `/admin/certificate-designer` | 4 internal tabs: Templates / Certificate Layout / Badge Layout / Transcript Layout (consolidated 2026-04-24) |
| `/admin/badge-editor`, `/admin/certificate-editor`, `/admin/transcript-editor`, `/admin/certificates` | All 5-line redirects to `/admin/certificate-designer` |
| `/admin/newsletter` | 5-line redirect to `/admin/communications-hub?tab=newsletter` |

### Modeling Hub admin (sidebar section)

| Route | What it does |
|-------|--------------|
| `/admin/modules` | Modeling modules + 2 LaunchStatusCards (signin + register Coming Soon) |
| `/admin/modeling-access` | Whitelist CRUD (migration 136) |

### Pricing / Commerce admin

| Route | What it does |
|-------|--------------|
| `/admin/pricing` | Single Platform Pricing surface (post commit `777e1bf` + `50e22fa`); previous Plans / Page Content / Pricing Features / Module Access tabs all removed |

### Removed in 2026-04-27 cleanup (do not assume present)

- `/admin/announcements` (Phase 1, commit `fd0aabf`)
- `/admin/whitelabel` (Phase 3, commit `a000fbd`)
- `/admin/permissions`, `/admin/overrides`, `/admin/plans` (Phase 5, commit `d8405e5`)
- `/admin/founder` (2026-04-18; founder lives in Page Builder Founder section)
- `/admin/login`, `/login` (2026-04-24; both 307 to `/admin` via middleware)

### Logical hub ownership of admin pages

| Hub | Admin pages |
|-----|-------------|
| Universal | analytics, audit, health, users, settings, site-settings, header-settings, branding (redirect), cms, content, page-builder, pages, projects, media, articles, contact, testimonials |
| Training | training-hub/*, training/*, training-settings, certificate-designer, communications-hub, daily-roundup |
| Modeling | modules, modeling-access |
| Both / Mixed | pricing (Platform Pricing applies to all 10 platforms) |

---

## Section 6. Database Inventory

Source: CLAUDE-DB.md cross-checked against `supabase/migrations/`. 141 migration files on disk; numbered to 145 with gaps at 069, 073, 127.

### A. Auth (cross-hub)

| Table | Hub |
|-------|-----|
| `users` | Modeling Hub + Admin |
| `password_resets` | Modeling Hub |
| `modeling_email_otps` | Modeling Hub + Admin (since admin is a NextAuth role) |
| `training_passwords` | Training Hub |
| `training_pending_registrations` | Training Hub |
| `training_email_otps` | Training Hub |
| `trusted_devices` | Cross-hub (column `hub` discriminates) |
| `email_confirmations` | Cross-hub (column `hub` discriminates) |

### B. Training Hub tables

`training_registrations_meta`, `training_settings`, `training_admin_actions`, `training_assessment_results`, `training_email_log`, `training_enrollments` (mig 132), `live_session_assessments`, `live_session_attempts`, `assessment_attempts_in_progress` (mig 126), `certification_watch_history`, `session_watch_history`, `student_certificates`, `student_progress`, `student_notes`, `student_feedback`, `cohorts`, `cohort_enrollments`, `assessment_questions`, `assessment_attempts`, `certificate_layouts`, `certificate_eligibility_raw` (view, mig 109), `transcript_tokens`, `course_attachments`, `courses`, `sessions`, `lessons`, `share_templates` (mig 114-117), `instructors` (mig 106).

### C. Modeling Hub tables

`projects`, `modeling_access_whitelist` (mig 136). REFM persists projects in this single JSON-blob table.

### D. CMS / Content tables

`site_pages`, `branding_config`, `cms_pages`, `page_sections`, `cms_content`, `articles`, `testimonials`, `contact_submissions`, `media`. The `announcements` table was referenced by deleted code; verify it was dropped or remains unused.

### E. Email system tables

`email_branding`, `email_templates`, `site_settings`. Newsletter has its own group (F).

### F. Newsletter tables (migs 091-092 + rebuild 143)

`newsletter_subscribers`, `newsletter_subscribers_legacy`, `newsletter_campaigns` (with `scheduled_at`, `segment` from mig 143), `newsletter_recipient_log` (mig 143), `newsletter_templates` (mig 143), `newsletter_auto_settings`.

### G. Live Sessions tables

`live_sessions`, `live_playlists`, `session_registrations` (with `reminder_*_sent` from mig 122), `session_watch_history`, `youtube_comments_cache`, `announcement_send_log`, `announcement_recipient_log` (mig 138).

### H. Pricing / Commerce tables

`platform_pricing`, `coupon_codes`, `platform_features`, `plan_feature_access`. Mig 144 dropped `pricing_features`, `pricing_modules`, `user_permissions`, `plan_permissions`, `features_registry`. Mig 145 dropped `pricing_plans`.

### I. Admin / System tables

`audit_log`, `admin_audit_log` (parallel cleanups historically). Mig 098 dropped `founder_profile`. Mig 142 dropped `marketing_designs`, `marketing_brand_kit`; created `marketing_uploaded_assets`.

### Discrepancy flag

CLAUDE-DB.md migrations log shows entries 002 to 145, but 069, 073, 127 are absent on disk. CLAUDE-DB.md itself is silent on this. Re-running migrations from scratch in a clean environment should still land in the documented schema state because each migration is self-contained, but the gap is worth confirming before any production rebuild.

---

## Section 7. API Route Inventory

### A. Public (no auth)

- `app/api/og/*` (learn, main, modeling, certificate/[id])
- `app/api/health/route.ts`
- `app/api/branding/route.ts` (GET only; PATCH is admin)
- `app/api/cms/route.ts`
- `app/api/contact/route.ts`
- `app/api/public/training-sessions/*`
- `app/api/share-templates/[key]/route.ts`
- `app/api/testimonials/*`
- `app/api/qr/*`
- `app/api/newsletter/subscribe/route.ts`
- `app/api/newsletter/unsubscribe/route.ts`
- `app/api/newsletter/click/route.ts`
- `app/api/training/community-links/route.ts`
- `app/api/t/[token]/pdf/route.ts` (token-gated, public path)

### B. Auth required (Training Hub)

`app/api/training/[courseId]/*`, `app/api/training/activity/*`, `app/api/training/assessment-settings/*`, `app/api/training/assessment/*` (state, resume, pause, start), `app/api/training/attempt-status/*`, `app/api/training/attachments/*`, `app/api/training/badges/download/*`, `app/api/training/certificate/*`, `app/api/training/certificate-image/*`, `app/api/training/certificates/*`, `app/api/training/certification-watch/*`, `app/api/training/confirm-email/*`, `app/api/training/course-details/*`, `app/api/training/device-verify/*`, `app/api/training/feedback/*`, `app/api/training/live-sessions/*` (and nested `[id]/`, `[id]/register`, `[id]/watched`, `[id]/assessment`, `[id]/attempts`, `registration-status-batch`), `app/api/training/logout/*`, `app/api/training/notes/*`, `app/api/training/profile/*`, `app/api/training/progress/*`, `app/api/training/proxy-ping/*`, `app/api/training/questions/*`, `app/api/training/register/*`, `app/api/training/resend-confirmation/*`, `app/api/training/resend-id/*`, `app/api/training/send-verification/*`, `app/api/training/session-notes/*`, `app/api/training/set-password/*`, `app/api/training/submit-assessment/*`, `app/api/training/submit-testimonial/*`, `app/api/training/tour-status/*`, `app/api/training/transcript/*`, `app/api/training/transcript-cached/[id]/*`, `app/api/training/transcript-link/*`, `app/api/training/upload-avatar/*`, `app/api/training/validate/*`, `app/api/training/verify-email/*`, `app/api/training/watch-enforcement/*`, `app/api/training/watch-history/*`, `app/api/training/youtube-comments/*`, `app/api/training/achievement-image/route.tsx`.

### C. Auth required (Modeling Hub)

`app/api/auth/*` (NextAuth catchall + register, confirm-email, device-verify, forgot-password, resend-confirmation, reset-password). `app/api/projects/*` for REFM project persistence. `app/api/agents/market-rates/*` and `app/api/agents/research/*` for AI agents (REFM). `app/api/export/excel/*`, `app/api/export/pdf/*`. `app/api/modeling/submit-testimonial/*`. `app/api/user/*` (account, password, profile).

### D. Admin only (NextAuth role=admin)

All under `app/api/admin/*` (45+ routes). Notable groups:
- `analytics/`
- `articles/`, `assessments/`, `attempts/`, `audit-log/`, `badge-layout/`, `badge-preview/`, `certificate-layout/`, `contact-submissions/`, `content/`, `env-check/`, `media/`, `pages/`, `page-sections/`, `projects/`, `testimonials/`, `users/`
- `certificates/by-date`, `pending`, `issue-pending`, `check-eligibility`, `force-issue`, `resend-email`, `sync`, `upload-template`
- `share-templates/`, `share-templates/[key]/`, `share-templates/settings/`
- `email-templates/` (and `[key]/`, `[key]/test/`, `branding/`)
- `live-playlists/`, `live-sessions/` (and `[id]/`, `[id]/announce/`, `[id]/notify/`, `[id]/registrations/`, `[id]/assessment/`, `[id]/attempts/`)
- `newsletter/subscribers/`, `export/`, `send/`, `test-send/`, `templates/` (and `[key]/`), `segments/`, `campaigns/` (and `[id]/`, `[id]/retry/`), `content-items/`, `enhance/`, `auto-settings/`
- `training-hub/marketing-studio/render/`, `brand/`, `live-sessions/`, `articles/`, `instructors/`, `uploads/` (and `[id]/`)
- `training-hub/communications/`, `assessments/`, `student-journey/`, `student-progress/`, `students/`, `analytics/`, `cohorts/`, `cohorts/[id]/`, `certificates/`
- `instructors/`, `modules/`, `modeling-coming-soon/`, `modeling-signin-coming-soon/`, `modeling-register-coming-soon/`, `modeling-access/`, `modeling-access/[id]/`
- `pricing/features/`, `pricing/coupons/`, `pricing/platform/`
- `reset-attempts/`, `sessions/[tabKey]/reset-watch-progress/`, `training/` (and `[courseId]/lessons/`), `training-actions/` (and `[id]/`), `training-coming-soon/`, `training-register-coming-soon/`, `training-settings/`, `watch-enforcement-stats/`
- `teams/test-connection/`
- `generate-images/`, `site-settings/`, `share-templates/`, `page-sections/`

### E. Cron (CRON_SECRET bearer)

- `/api/cron/session-reminders` (daily 06:00 UTC)
- `/api/cron/newsletter-scheduled` (daily 07:00 UTC)
- `/api/cron/auto-launch-check` (route exists, vercel.json entry rolled back; UI gated by `AUTO_LAUNCH_UI_ENABLED=false`)

### F. Webhook

- `/api/webhooks/resend` (POST, Svix HMAC-SHA256)

### Hub ownership of routes

| Group | Hub ownership |
|-------|----------------|
| `/api/training/*` | Training |
| `/api/auth/*` | Modeling + Admin |
| `/api/projects/*`, `/api/agents/*`, `/api/export/*`, `/api/modeling/*` | Modeling |
| `/api/og/main` | Main |
| `/api/og`, `/api/og/certificate/*`, `/api/og/modeling` | Per-host (all hubs share file) |
| `/api/admin/*` | Admin (touches all hubs) |
| `/api/public/training-sessions/*` | Public-facing Training |
| `/api/cms`, `/api/contact`, `/api/branding` | Main / shared |
| `/api/newsletter/*` | Hub-neutral |
| `/api/share-templates/[key]` | Hub-neutral surface for Training Hub data (cross-hub leak, see Section 9) |
| `/api/cron/*` | Hub-neutral infrastructure |
| `/api/webhooks/resend` | Hub-neutral |

---

## Section 8. Current Folder Structure

```
D:\FMP\financial-modeler-pro\
+-- app\                         Next.js App Router routes
|   +-- (cms)\[slug]\            Catch-all dynamic CMS pages
|   +-- (portal)\                Home page (CMS Option B)
|   +-- about\ahmad-din\         Founder profile
|   +-- admin\                   28 admin pages + dynamic routes (universal + per-hub mixed)
|   +-- api\                     200+ API routes grouped by domain
|   +-- articles\                Public article index + detail
|   +-- book-a-meeting\          Calendly inline embed
|   +-- contact\                 Contact form
|   +-- forgot-password\         Auth
|   +-- modeling\                Modeling Hub pages (rewritten on app.*)
|   +-- portal\                  Authed multi-platform hub
|   +-- pricing\                 Public pricing
|   +-- refm\                    Real Estate platform mount
|   +-- reset-password\          Auth
|   +-- settings\                Account settings
|   +-- t\[token]\               Token-gated transcript
|   +-- testimonials\submit\     Testimonial submission
|   +-- training\                Training Hub pages (rewritten on learn.*)
|   +-- training-sessions\       Public live-session pages
|   +-- verify\                  Cert verification (canonical learn.*)
|   +-- globals.css              Single source of truth for all CSS tokens
|   +-- layout.tsx               Root layout (SessionProvider, Inter, OG)
|   +-- not-found.tsx            Custom 404
|   +-- robots.ts                Sitemap robots
|   \-- sitemap.ts               Auto-generated sitemap
+-- src\
|   +-- agents\                  3 stub files (2 lines each); real logic lives in app/api/agents/
|   +-- assets\                  Static fonts (Inter Regular/Bold/ExtraBold)
|   +-- components\
|   |   +-- admin\               9 admin-tooling components
|   |   +-- booking\             CalendlyEmbed
|   |   +-- cms\                 CmsField + 21 SectionRenderer subcomponents
|   |   +-- landing\             Marketing site components (CourseCard, ArticleCard, SharedFooter, ...)
|   |   +-- layout\              Navbar, NavbarServer
|   |   +-- modeling\            (placeholder folder)
|   |   +-- newsletter\          NewsletterSubscribeForm
|   |   +-- pricing\             PricingAccordion
|   |   +-- refm\                REFM platform components (8 top + 4 modules + 4 modals = 6469 lines)
|   |   +-- seo\                 (likely Breadcrumbs, StructuredData)
|   |   +-- sessions\            SessionCard universal
|   |   +-- shared\              9 cross-hub components
|   |   +-- training\            Training Hub components (TrainingShell, dashboard/, player/, share/, ...)
|   |   \-- ui\                  ColorPicker, OfficeColorPicker, Toaster
|   +-- config\                  courses.ts (Training-specific) + platforms.ts (Modeling-specific)
|   +-- constants\               (likely empty or near empty)
|   +-- core\                    Shared computation: branding (157L), core-calculations (460L), core-formatters (52L), core-state (123L), core-validators (2L stub)
|   +-- hooks\                   useInactivityLogout, useProject, useRequireAdmin, useRequireAuth (4 only post-cleanup)
|   +-- lib\
|   |   +-- email\               Sender + 13 templates
|   |   +-- integrations\        teamsMeetings.ts (Microsoft Graph)
|   |   +-- marketing-studio\    types, brand, image-utils, style-utils, layout, 4 templates
|   |   +-- modeling\            real-estate (modules + export — modules 2-11 + all 3 export files are 2-line stubs)
|   |   +-- newsletter\          autoNotify, sender, segments, templates, linkWrap (mig 143)
|   |   +-- seo\                 canonical helper
|   |   +-- shared\              19 cross-hub libs
|   |   \-- training\            25 Training Hub libs
|   +-- middleware.ts            Admin auth + cache-busting
|   +-- styles\                  (likely empty after globals.css consolidation)
|   \-- types\                   7 type files (post subscription.types.ts deletion)
+-- supabase\
|   +-- backups\                 Pre-restructure SQL backups
|   +-- migrations\              143 SQL files on disk (numbered up to 147, gaps at 069/073/127). Latest pair: 146 (watch_intervals JSONB) + 147 (completed_via + video_load_at) ship the watch tracking rebuild.
|   +-- schema.sql               (snapshot)
|   \-- seed-permissions.sql     (legacy seed)
+-- public\                      Static assets (logos, icons, images)
+-- scripts\                     5 utility scripts (backup_apps_script_students.ts, testEmails.ts, diagnose_stuck_watch.ts, phase5_recovery.ts, phase5_verify.ts). The latter three were added 2026-04-28 for the watch tracking rebuild Phase 5 surgical recovery.
+-- _legacy_backup\              Old static-HTML prototype (CLAUDE.md, index.html, js/, styles.css)
+-- D:FMPfinancial-modeler-proappapitrainingbadgesdownload\   (orphan empty directory, see Sec 11)
+-- js\                          Top-level legacy JS bundle (app.js, branding.js, portal.js, projects.js, refm-platform.js, settings.js)
+-- next.config.ts               Subdomain rewrites + redirects
+-- vercel.json                  Crons + cache-control headers
+-- package.json
+-- tsconfig.json
+-- eslint.config.mjs            (referenced _legacy_backup)
+-- CLAUDE.md, CLAUDE-DB.md, CLAUDE-FEATURES.md, CLAUDE-ROUTES.md, CLAUDE-TODO.md, PROJECT_HANDOFF.md
```

Pattern observation:
- `src/components/` is split by hub (`refm/`, `training/`) plus shared groupings (`shared/`, `landing/`, `cms/`, `layout/`, `seo/`, `ui/`, `booking/`, `sessions/`, `newsletter/`, `pricing/`, `admin/`).
- `src/lib/` is split by hub (`training/`, `modeling/`) plus shared groupings (`shared/`, `email/`, `newsletter/`, `integrations/`, `marketing-studio/`, `seo/`).
- `app/` is split by hub via folder convention (`app/training/`, `app/modeling/`, `app/refm/`, `app/admin/`) plus catch-all main-site folders.
- The split is consistent at the top level. Boundaries break down only in the cross-cutting cases documented in Section 9.

---

## Section 9. Cross-Hub Dependencies (Critical)

Every violation listed here is a file that imports across the hub boundary as drawn in Section 8. Each breaks the assumption that hubs can be split apart cleanly. Difficulty rating reflects how hard the dependency is to remove.

### Category 1: Training importing Modeling

| Source | Target | Difficulty |
|--------|--------|------------|
| (none) | | |

Clean.

### Category 2: Modeling importing Training

| Source | Target | Difficulty |
|--------|--------|------------|

Clean.

### Category 3: Admin importing hub-specific code (expected; documented for completeness)

The admin panel is by design cross-hub. Examples (not exhaustive):
- `app/admin/training-hub/daily-roundup/page.tsx:6` imports `@/src/components/training/share/ShareModal`.
- `src/components/admin/LiveSessionAssessmentEditor.tsx` imports several `@/src/lib/training/` files.
- `app/api/admin/training-hub/communications/route.ts`, `analytics/route.ts`, `assessments/route.ts`, `student-journey/route.ts`, `student-progress/route.ts`, `students/route.ts`, `cohorts/[id]/route.ts`, `route.ts` import various `@/src/lib/training/*`.
- `app/api/admin/certificates/{force-issue,issue-pending,pending,check-eligibility}/route.ts` import `@/src/lib/training/certificateEngine`, `certificateEligibility`.
- `app/api/admin/share-templates/[key]/route.ts`, `share-templates/route.ts`, `share-templates/settings/route.ts` import `@/src/lib/training/shareTemplates`.
- `app/api/admin/reset-attempts/route.ts` imports `@/src/lib/training/appsScript`.
- `app/api/admin/badge-preview/route.ts`, `certificate-layout/route.ts` import `@/src/lib/training/certificateLayout`.
- `app/api/admin/live-sessions/[id]/assessment/route.ts`, `attempts/route.ts` import `@/src/lib/training/liveSessionAssessments`.

These are expected. Document the surface so a future "Admin separated to its own deployment" decision has the full picture.

### Category 4: Main Site importing hub-specific code

| # | Source file | Line | Import statement | Why it crosses | Difficulty |
|---|-------------|------|------------------|----------------|------------|
| 4.1 | `app/verify/[uuid]/VerifyActions.tsx` | 4 | `import { ShareModal } from '@/src/components/training/share/ShareModal';` | Cert verify page is on main domain (canonical-host on learn) but reuses Training Hub's share modal | Low: copy the component to `src/components/shared/` and update Training Hub to import from there |
| 4.2 | `app/verify/[uuid]/VerifyActions.tsx` | 5 | `import { useShareTemplate } from '@/src/lib/training/useShareTemplate';` | Same | Low: same shared move |
| 4.3 | `app/verify/[uuid]/VerifyActions.tsx` | 6 | `import { renderShareTemplate, formatShareDate } from '@/src/lib/training/shareTemplates';` | Same | Low: move shareTemplates engine to shared |
| 4.4 | `app/api/share-templates/[key]/route.ts` | (top) | `import { DEFAULT_BRAND_MENTION, DEFAULT_FOUNDER_MENTION } from '@/src/lib/training/shareTemplates';` | Public API endpoint hosted at main-domain `/api/share-templates/...` reads training-specific defaults | Low: same shared move |

The `/verify/[uuid]` page is canonically served at `learn.financialmodelerpro.com/verify/...` (forced by `app/verify/layout.tsx` and the redirect rule in `next.config.ts`), so philosophically the page belongs to Training Hub even though the file lives at `app/verify/`. Either move the route under `app/training/verify/` or accept the boundary leak as a deliberate cross-hub surface.

### Category 5: Shared code importing hub-specific code (forbidden)

| # | Source file | Line | Import statement | Why it crosses | Difficulty |
|---|-------------|------|------------------|----------------|------------|
| 5.1 | `src/lib/shared/comingSoonGuard.ts` | 8 | `import { getTrainingCookieSession } from '@/src/lib/training/trainingSessionCookie';` | Shared guard pulls in Training-Hub-specific cookie helper | Medium: invert the dependency so `comingSoonGuard` accepts the session-resolver as a parameter, OR move `trainingSessionCookie.ts` into a hub-neutral session helper |

This is the only true shared-code violation. Everything else is either hub-internal or admin-cross-hub.

### Category 6: Other component-folder leaks

- `src/components/refm/Topbar.tsx:11` imports `@/src/components/ui/OfficeColorPicker`. UI is shared infrastructure -> fine.
- `src/components/layout/NavbarServer.tsx` references `/refm` in route logic but does not import REFM code. Fine.

### Category 7: Hub-specific config leakage

- `@/src/config/courses` consumed by 23 files: 22 inside Training scope + admin + 1 in shared share-template engine (`src/lib/training/shareTemplates.ts` itself). All consumers are inside Training Hub, admin, or training-routed pages. **Clean for Training**.
- `@/src/config/platforms` consumed by 5 files: `app/sitemap.ts`, `app/modeling/dashboard/page.tsx`, `app/modeling/page.tsx`, `app/modeling/[slug]/page.tsx`, `app/portal/page.tsx`. Outside-Modeling consumers are sitemap (hub-neutral, expected) and `/portal` (which is the cross-hub authed hub on `app.*`). **Clean for Modeling**.

### Summary table

| Category | Violations |
|----------|------------|
| 1: Training -> Modeling | 0 |
| 2: Modeling -> Training | 0 |
| 3: Admin -> hub | (expected, large surface) |
| 4: Main Site -> hub | 4 (all in `/verify` and its public API) |
| 5: Shared -> hub | 1 (`comingSoonGuard.ts`) |
| 6: Other component leaks | 0 |
| 7: Config leakage | 0 |

**Bottom line**: 5 actionable violations out of an 800+ file codebase. The hub split is real and largely respected. The `/verify` family is the only main-site surface that needs help; the rest is admin (expected) or REFM internals.

---

## Section 10. Deployment Configuration

### `next.config.ts`

- `outputFileTracingRoot: __dirname` to silence the workspace-root lockfile warning on Windows/OneDrive.
- `serverExternalPackages: ['satori']` so webpack does not bundle satori (loaded at runtime).
- `headers()`: explicit `Cache-Control: no-store, no-cache, must-revalidate` on `/login` and `/admin/login` (defense in depth alongside `vercel.json`).
- `rewrites().beforeFiles`: per-host root and clean auth URL rewrites (already documented in Section 1).
- `redirects()`: subdomain-aware host regex `(www\.)?financialmodelerpro\.com` + 308 (`permanent: true`) for canonical moves like `/training/:path*` -> `learn.*`. 307s for legacy admin URLs and learn-side `/training/signin` -> `/signin`.

### `src/middleware.ts`

- Owns `/login`, `/admin`, `/admin/login`, `/admin/:path+`.
- All redirects 307 with no-cache headers (`Cache-Control: no-store, no-cache, must-revalidate, max-age=0`, `Pragma: no-cache`, `Expires: 0`) to overwrite stale 308s cached by browsers.
- `/admin` itself is passed through (with no-cache headers) so the inline login form renders.
- `/admin/:path+` requires NextAuth role=admin; non-admin gets 307 to `/portal`; unauth gets 307 to `/admin`.

### `vercel.json`

- `crons`: `/api/cron/session-reminders` (06:00 UTC daily), `/api/cron/newsletter-scheduled` (07:00 UTC daily). The `auto-launch-check` cron is not scheduled (per CLAUDE notes; UI is gated off until Vercel Pro).
- `headers`: API CORS allow-all, plus explicit no-store/CDN-no-store on `/admin`, `/admin/:path*`, `/login`.

### Environment variables (from CLAUDE.md)

Auth + DB: `NEXTAUTH_SECRET`, `NEXTAUTH_URL`, `SUPABASE_URL`, `SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY`, `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`.
URLs: `NEXT_PUBLIC_APP_URL`, `NEXT_PUBLIC_MAIN_URL`, `NEXT_PUBLIC_LEARN_URL`.
Email: `RESEND_API_KEY`, `RESEND_WEBHOOK_SECRET`, `EMAIL_FROM_TRAINING`, `EMAIL_FROM_NOREPLY`.
Captcha: `HCAPTCHA_SECRET_KEY`, `NEXT_PUBLIC_HCAPTCHA_SITE_KEY`.
AI: `ANTHROPIC_API_KEY`.
YouTube: `YOUTUBE_API_KEY`, `NEXT_PUBLIC_YOUTUBE_CHANNEL_ID`.
Teams: `AZURE_TENANT_ID`, `AZURE_CLIENT_ID`, `AZURE_CLIENT_SECRET`, `TEAMS_HOST_USER_EMAIL`.
Cron: `CRON_SECRET`.

### Build configuration

`npm run build` -> `next build --webpack` (Turbopack disabled).
`npm run type-check` -> `tsc --noEmit`.
`npm run verify` -> type-check + lint + build.

---

## Section 11. Technical Debt Map

### Apps Script integration legacy

Four routes still hit Apps Script for question fetch + roster + reset. Cert issuance moved off the daily cron to inline-fire (commit, migration 124). The remaining Apps Script callers are: `app/training/assessment/[tabKey]/page.tsx`, `app/api/admin/reset-attempts/route.ts`, `app/api/training/questions/route.ts`, `app/api/training/course-details/route.ts`. Future split work should plan to replicate or remove these last four touch points before lifting the Training Hub.

### Module 2-11 stubs (REFM)

`src/lib/modeling/real-estate/modules/module{2-11}-*.ts` are 2-line `export {};` stubs. `src/lib/modeling/real-estate/export/{export-excel-formula,export-excel-static,export-pdf}.ts` are also 2-line stubs even though CLAUDE-FEATURES.md claims Excel + PDF Export is Complete. **Action: confirm whether export logic was inlined into `ExportModal.tsx` or whether the feature is still a stub. The doc and the code disagree.**

### Empty agent files

`src/agents/agent-contextual.ts`, `agent-market-data.ts`, `agent-research.ts` are 2-line stubs. Real agent logic lives in `app/api/agents/market-rates/route.ts` and `app/api/agents/research/route.ts`. The `src/agents/` folder can either be deleted or filled out depending on where the user wants agent code to live.

### `core-validators.ts` stub

`src/core/core-validators.ts` is 2 lines. Either delete or implement.

### Orphan top-level folders

- `_legacy_backup/` (CLAUDE.md, index.html, js/, styles.css). Old static-HTML prototype. Referenced by `eslint.config.mjs` (likely an ignore rule). Safe to remove if confirmed unused.
- `js/` (app.js, branding.js, portal.js, projects.js, refm-platform.js, settings.js). Same generation. Safe to remove if confirmed unused.
- `D:FMPfinancial-modeler-proappapitrainingbadgesdownload\`. Empty directory whose name encodes a Windows path. Almost certainly a `mkdir -p` accident with mis-quoted backslashes. Safe to delete.

### `src/lib/shared/urls.ts` unused

The central `URLS` constant has zero importers. Either adopt it everywhere `process.env.NEXT_PUBLIC_LEARN_URL` is read, or delete it.

### Sub-tabs-within-tabs

`/admin/communications-hub` Newsletter tab nests its own 5-tab strip (Subscribers / Compose / Templates / Campaigns / Auto Notifications) inside the parent's 4-tab strip (campaigns / email-settings / share-templates / newsletter). CLAUDE.md acknowledges this and says it was kept verbatim per "load existing functionality unchanged". Cosmetic, not blocking.

### Marketing Studio in Training Hub admin

`app/admin/training-hub/marketing-studio/` is intentionally Training-Hub-only; CLAUDE.md notes Modeling Hub will get its own at a different path later. The `src/lib/marketing-studio/` library is shared infrastructure and lives outside any hub folder, but the API (`app/api/admin/training-hub/marketing-studio/`) is hub-scoped. When Modeling Hub gets its own, the lib will need to be either parameterized by hub or duplicated.

### Migration log gaps

Migrations 069, 073, 127 are absent on disk. CLAUDE-DB.md does not mention the gaps. Confirm before any greenfield rebuild.

### Performance concerns

- `/admin/analytics` runs 8 parallel Supabase queries on every load and aggregates server-side. Acceptable today; will need pagination or pre-aggregation tables when student count crosses ~10k.
- Newsletter `sendCampaign()` resolves segments by full table scan over the active subscriber set. Fine at current ~100 subscribers; would need a materialized view or background-job worker at ~10k+ active.

### Security considerations

- `/api/cms`, `/api/branding` GET endpoints are public. CLAUDE.md flags both. `cms_content` row that contains `header_settings.logo_url` etc. is intentionally public; nothing sensitive should ever live there.
- Resend webhook (`/api/webhooks/resend`) verifies Svix HMAC manually using `crypto.createHmac('sha256', ...)` with a 5-minute replay window. Implementation is sound; rotate `RESEND_WEBHOOK_SECRET` if the secret leaks.
- Admin protection lives in two places: middleware (`src/middleware.ts`) and individual route handlers (manual `getServerSession` checks). Centralize in middleware longer-term to reduce drift risk.

---

## Section 12. Restructure Readiness Assessment

### A. Separability Analysis

#### Training Hub

- **Today's state**: dominantly self-contained. Routes under `app/training/*`, `app/training-sessions/*`, public API at `app/api/training/*`, libs at `src/lib/training/*`, components at `src/components/training/*`. Auth model is fully independent of NextAuth.
- **Blockers to separation**:
  - 4 imports from `app/verify/` (Main Site) into `@/src/components/training/share` and `@/src/lib/training/{useShareTemplate, shareTemplates}`. Verify page is canonically Training-Hub anyway.
  - 1 import from `@/src/lib/shared/comingSoonGuard.ts` into `@/src/lib/training/trainingSessionCookie`. Inverted dependency from a hub-neutral file.
  - Apps Script touches (4 files). Either keep Apps Script as an external dep or migrate fully to Supabase before splitting.
  - Admin panel hits `@/src/lib/training/*` heavily. If Training Hub deploys to its own repo without admin, those admin routes need to either move with it or become cross-repo API consumers.
  - Newsletter auto-notify, instructor roster, marketing studio, share templates all live under or read from training-area concepts but the libraries themselves (`src/lib/newsletter`, `src/lib/marketing-studio`) are hub-neutral and could be reused.
- **Effort to separate cleanly**: medium. The number of files to move is large but the boundary violations are small. Two weeks of focused work plus stabilization.

#### Modeling Hub

- **Today's state**: extremely self-contained. REFM's only foreign dep is `OfficeColorPicker` from `src/components/ui/`. Modules 2-11 are stubs. Coming Soon mode means there's no production traffic.
- **Blockers to separation**:
  - REFM project persistence in `projects` table (Supabase). Easy to migrate.
  - `src/agents/*` stubs. Either move or fill out.
  - `app/portal/page.tsx` straddles Main Site and Modeling Hub — it's an authed hub showing all platforms but lives under main-domain routing rules and is rewritten on `app.*` only via the absence of explicit redirects. Pin its ownership before splitting.
  - Admin pages `/admin/modules`, `/admin/modeling-access` will follow Modeling Hub if admin splits; otherwise stay with admin.
- **Effort to separate cleanly**: low. Could be lifted in days, not weeks. The fact that 9 of 10 platforms are still empty makes this even easier.

#### Main Site

- **Today's state**: hub-neutral by design. Imports `@/src/config/platforms` for the portal page, `@/src/config/courses` for sitemap and a few CMS links. No imports from hub-specific lib code except the 4 cross-hub `/verify` imports.
- **Blockers**: the same 4 `/verify` imports.
- **Effort**: trivial once `/verify` is moved into Training Hub or share helpers move into shared.

### B. Restructure Complexity

- **Estimated complexity**: medium overall. Depending on the chosen approach (see C), it ranges from low (move helpers into shared) to high (full monorepo split).
- **Critical risks**:
  - **Training Hub down for any window** breaks 30+ active students.
  - **Apps Script integration** is fragile; touching it without a real test path can corrupt the student roster.
  - **Inline cert issuance** (`/api/training/submit-assessment`) is fire-and-forget and has zero observability beyond `student_certificates.email_sent_at`. A typo in an import path can silently stop new certs from issuing.
  - **Auth helpers in `src/lib/shared/auth.ts`** sit on the Modeling Hub critical path. A circular import or a stale type breaks both Modeling Hub and Admin login at once.
  - **`vercel.json` cron schedules** are fragile across renames; a moved route file breaks the cron silently until it misses an execution.
- **Specific files where mistakes break Training Hub**:
  - `src/lib/training/training-session.ts`, `trainingSessionCookie.ts` (cookie auth)
  - `src/lib/training/certificateEngine.ts`, `certificateEligibility.ts`, `watchThresholdVerifier.ts` (cert fire-and-forget chain)
  - `src/lib/training/appsScript.ts`, `sheets.ts` (roster + RegID)
  - `app/api/training/validate/route.ts`, `register/route.ts`, `confirm-email/route.ts`, `submit-assessment/route.ts`, `live-sessions/[id]/watched/route.ts`, `certification-watch/route.ts` (gated paths students hit)

### C. Recommended Approach Options

#### Option 1: Minimal reorganization (lowest risk)

- **What changes**:
  - Move `ShareModal`, `useShareTemplate`, `shareTemplates`, `share.ts` from `src/components/training/share/`, `src/lib/training/` into `src/components/shared/share/`, `src/lib/shared/share/`. Update Training Hub imports.
  - Invert `src/lib/shared/comingSoonGuard.ts` to take a `getSessionFromCookie` function instead of importing `trainingSessionCookie` directly. Or move `trainingSessionCookie.ts` to `src/lib/shared/`.
  - Delete or wire `src/lib/shared/urls.ts` (decide). Adopt across the codebase if kept.
  - Delete `_legacy_backup/`, `js/`, the `D:FMP...` orphan directory.
  - Document gaps in migration log (069, 073, 127).
- **What stays the same**: every route, every API, every admin page. No DB changes. No deployment changes.
- **Risk to Training Hub**: very low. All changes are local refactors with no behavior change.
- **Time estimate**: 1 day.
- **Future portability gain**: small but durable. Hub boundaries become enforceable by lint rule. Subsequent restructures get easier.
- **Files that must move**: ShareModal + share helpers, possibly trainingSessionCookie.
- **Files that should NOT move**: anything under `src/lib/training/{certificateEngine,appsScript,sheets,training-session}` unless and until the full split happens.

#### Option 2: Internal restructure with clear hub boundaries (medium risk)

- **What changes**:
  - Reorganize `src/components/` into `src/components/{shared,main,training,modeling}/...` with `shared` containing only true cross-hub primitives. Same for `src/lib/`.
  - Move `app/verify/*` under `app/training/verify/*` and update next.config.ts host rewrites so `learn.*/verify/*` rewrites correctly. Or extract verify into a hub-neutral subfolder.
  - Move `app/portal/page.tsx` decision: pin to Modeling Hub (rename to `app/modeling/portal/page.tsx`) or keep cross-hub.
  - Adopt a path-alias-per-hub (`@training/*`, `@modeling/*`, `@shared/*`) replacing today's monolithic `@/src/*`. Enforce via ESLint `no-restricted-imports` so Training cannot import Modeling and vice versa.
  - Centralize all admin protection in middleware (remove per-route `getServerSession` boilerplate).
- **What stays the same**: production routes (URLs unchanged), DB schema, deployment config except for any rewrite changes for `/verify`.
- **Risk to Training Hub**: medium. File moves under `src/components/training/` and `src/lib/training/` can break dozens of imports; if a single broken import slips into deploy, students see runtime errors.
- **Time estimate**: 3-5 days plus a stabilization week.
- **Future portability gain**: high. After Option 2, splitting any one hub into its own deployment becomes a mechanical lift-and-rename rather than a refactor.
- **Files that must move**: about 40-60 files (mostly under `src/components/training/`, `src/components/refm/`, `src/lib/training/`, `src/lib/modeling/`).
- **Files that should NOT move**: `app/api/admin/*` (deferred until admin separation), `vercel.json` cron paths.

#### Option 3: Full monorepo conversion (highest risk)

- **What changes**:
  - Convert `D:\FMP\financial-modeler-pro\` into a monorepo with `apps/{main,training,modeling,admin}/` plus `packages/{shared,email,newsletter,cms}/`. Use pnpm workspaces or Turborepo.
  - Each app has its own `next.config`, its own deployment, its own subdomain.
  - Shared packages publish via workspace protocol; types are exported from `packages/shared/types`.
  - Database stays one Supabase instance; tables grouped by hub; admin app cross-reads as today.
  - CI gains per-package builds, per-package tests.
- **What stays the same**: Supabase tables, environment variables (per-app).
- **Risk to Training Hub**: high. Migration window will likely require a freeze and a coordinated cutover. The Training Hub goes through every routing layer (subdomain rewrites, NextAuth-vs-cookie auth, Apps Script integration) so each piece can fail independently.
- **Time estimate**: 4-6 weeks of focused work.
- **Future portability gain**: maximum. After Option 3, Training Hub can be sold, gifted, hot-swapped, or red/green deployed without touching Modeling Hub or Admin. Each sub-team owns its own pipeline.
- **Files that must move**: practically all source files, but mostly mechanical moves inside their existing folder.
- **Files that should NOT move yet**: Apps Script integration (must come fully off Apps Script first), inline cert engine (must gain test coverage first), live-session Teams integration (must verify Azure permissions still work cross-deployment).

#### Recommended sequencing

1. Do Option 1 in week 1. Lock in clean boundaries.
2. Decide between Option 2 and Option 3 once Modeling Hub launches paid tiers (currently pre-launch). The choice depends on whether the user wants a single-team monolith with internal boundaries (Option 2) or independently deployable sub-products (Option 3).

### D. Safety guidelines for restructure

Mandatory rules during any restructure pass:

1. **Never edit and move in the same commit**. A move-only commit is reviewable by `git log --follow`. A move-plus-rewrite commit is not.
2. **Never delete a file that is still imported**. Run `npm run type-check` after every batch of moves; the build catches dangling imports better than grep.
3. **Never skip `npm run verify` before pushing**. The full triple of type-check + lint + build is the only end-to-end signal.
4. **Never touch `app/api/training/submit-assessment/route.ts`, `certification-watch/route.ts`, `validate/route.ts` without a test plan**. These are the load-bearing student paths.
5. **Never reorder migrations**. Add new migrations with the next available number; never renumber.
6. **Never edit `vercel.json` cron paths without confirming the cron registration in Vercel dashboard updated**. A move can silently disable a cron.
7. **Never change the auth cookie name or shape**. `training_session`, NextAuth JWT, and `fmp-trusted-device` names are baked into 30+ active student sessions. Renaming them logs every student out instantly.
8. **Never combine a restructure commit with a feature commit**. One should be a pure refactor; the other should be functional.

#### Order of operations for any restructure

1. Read this document, then read CLAUDE.md, CLAUDE-FEATURES.md, CLAUDE-ROUTES.md, CLAUDE-DB.md.
2. Write a per-batch plan (5-10 file moves per batch).
3. Run `npm run verify` on a clean baseline.
4. Execute one batch.
5. Run `npm run verify`. If anything fails, revert the batch.
6. Run a manual smoke test: `/`, `/training`, `/modeling`, `/training/dashboard` (with cookie), `/admin`. All should 200.
7. Commit.
8. Push to a feature branch and let Vercel preview build.
9. Click through preview: home, training landing, training dashboard, modeling signin, admin signin.
10. Merge only if smoke tests pass on preview.

#### Rollback plan

- Every restructure batch must be a single commit so `git revert <hash>` is the rollback.
- If multiple commits accumulate before failure surfaces, `git revert <oldest-bad-hash>..HEAD --no-commit` then `git commit`.
- If a deployed build fails for the Training Hub specifically, revert the most recent merge to `main` and redeploy.
- Maintain a list of "known good" commit hashes from successful previous deploys; the most recent one is the baseline.

#### Deployment strategy

Incremental, never big-bang. For Option 1 and Option 2, every batch is its own deploy. For Option 3, plan a freeze window with a fallback DNS pointer back to the previous deployment.

### E. Quick wins

Each of these takes under 30 minutes, can be done independently, and reduces restructure risk:

1. **Delete `D:FMPfinancial-modeler-proappapitrainingbadgesdownload\`** orphan directory (mkdir typo).
2. **Decide and execute on `_legacy_backup/`, `js/`** (delete or move into a documentation folder).
3. **Decide and execute on `src/agents/*` stubs** (delete the folder or fill out the files).
4. **Delete `src/core/core-validators.ts`** (2-line stub).
5. **Delete `src/lib/modeling/real-estate/modules/module{2-11}-*.ts`** placeholder stubs and the 3 export stubs (or keep them with TODO markers if they signal future scope to the team).
6. **Delete `src/lib/shared/urls.ts`** if not adopted, or adopt it everywhere via a 30-min sed pass.
7. **Move `src/components/training/share/ShareModal.tsx` to `src/components/shared/share/ShareModal.tsx`** and update the 4 importers. This eliminates Category 4 violations 4.1.
8. **Move `src/lib/training/{useShareTemplate,shareTemplates,share}` into `src/lib/shared/share/`** and update importers. Eliminates Category 4 violations 4.2-4.4.
9. **Invert `comingSoonGuard.ts`** to accept a session-resolver as a parameter rather than importing `trainingSessionCookie`. Eliminates Category 5 violation.
10. **Rename `app/admin/badge-editor`, `certificate-editor`, `transcript-editor`, `certificates`, `newsletter`, `branding`** redirect-only files to a single `RedirectShim.tsx` to reduce file count. Optional clean-up.

After 1-9, the boundary table at the end of Section 9 is fully clean. After that, Option 2 or Option 3 becomes a mechanical exercise rather than a debugging exercise.

### F. What to avoid

- **Do not move `app/admin/*` pages without first centralizing admin auth in middleware**. Today every admin route does its own session check; moving them around without unifying that check first risks shipping a page where the check was forgotten.
- **Do not split `src/lib/training/certificateEngine.ts` into hub-neutral primitives**. It is the load-bearing critical path for cert issuance. Refactor only inside the file; do not extract.
- **Do not change `cookieName: 'training_session'`** in `src/lib/training/training-session.ts`. Cookie name change == every student logged out.
- **Do not delete `app/login/page.tsx`** if it still exists. (It was deleted 2026-04-24; verify on disk before assuming.) The `/login` URL is now handled by middleware redirect; a stale file would intercept first.
- **Do not change `next.config.ts` `MAIN_HOST_RE`** without re-testing every Search Console URL. The history of fixes there is long and easy to regress.
- **Do not delete `src/lib/training/appsScript.ts`** until a Supabase replacement is in place for question fetch + course details + reset-attempts. The four call sites are documented in Section 11.
- **Do not run a destructive `git clean -fdx`** in this repo without first archiving `_legacy_backup/` and `js/` if either contains historic prototype work the user wants to keep.
- **Do not introduce `react-rnd` imports anywhere new**. It is in `package.json` only because the deleted Phase 1.5 canvas editor used it; keeping it loaded in fresh code wastes ~80kb in client bundle.

---

## Section 13. Training Hub Continuity Guarantee

This is the load-bearing checklist. Any restructure proposal that breaks an item below must be revised before merging.

### Routes students hit during normal usage (must keep returning 200 with the same render)

- `learn.financialmodelerpro.com/` -> `app/training/page.tsx` (rewritten)
- `/signin`, `/register`, `/forgot` (rewritten to `/training/signin`, etc.)
- `/training/dashboard`
- `/training/[courseId]` (3sfm, bvm)
- `/training/assessment/[tabKey]`
- `/training/[courseId]/assessment`
- `/training/watch/[courseId]/[sessionKey]`
- `/training/live-sessions`, `/training/live-sessions/[id]`, `/training/live-sessions/[id]/assessment`
- `/training/certificate`, `/training/certificates`
- `/training/transcript/[token]`
- `/training/profile`, `/training/submit-testimonial`, `/training/set-password`
- `/training/confirm-email`
- `/training-sessions`, `/training-sessions/[id]`
- `/verify`, `/verify/[uuid]` (canonical `learn.*`)

### API endpoints Training Hub depends on (every one must keep returning the same shape)

- `POST /api/training/validate`
- `POST /api/training/register`
- `GET /api/training/confirm-email`
- `POST /api/training/resend-confirmation`, `resend-id`, `send-verification`, `set-password`
- `POST /api/training/device-verify`
- `GET /api/training/profile`, `POST` (upload-avatar), `notes`
- `GET /api/training/progress`
- `GET /api/training/questions`
- `POST /api/training/submit-assessment`  **(triggers cert issuance fire-and-forget)**
- `GET /api/training/attempt-status`, `assessment-settings`, `attachments`, `course-details`
- `GET /api/training/live-sessions`, `/[id]`, `/[id]/register`, `/[id]/watched`, `/[id]/assessment`, `/[id]/attempts`, `/registration-status-batch`
- `GET/POST /api/training/certification-watch`
- `GET /api/training/watch-enforcement`
- `GET /api/training/watch-history`
- `GET /api/training/youtube-comments`
- `GET /api/training/certificate`, `certificate-image`, `certificates`
- `GET /api/training/transcript`, `transcript-cached/[id]`, `transcript-link`
- `GET /api/training/community-links`
- `POST /api/training/feedback`, `submit-testimonial`, `tour-status`, `logout`
- `GET /api/public/training-sessions`, `/[id]`
- `GET /api/share-templates/[key]`
- `GET /api/og` (learn OG)
- `GET /api/training/achievement-image`
- `GET /api/og/certificate/[id]`
- `GET /api/t/[token]/pdf`

### Database query paths

- All paths go through `src/lib/shared/supabase.ts` (`getServerClient()`). If the Supabase URL or service-role key changes, every Training route fails. Pin these in env vars and verify before any deploy.
- Apps Script paths go through `src/lib/training/appsScript.ts` and `src/lib/training/sheets.ts`. Apps Script URL stored in `training_settings` row; do not move that key without coordinated update.
- Watch enforcement reads `certification_watch_history` (3SFM/BVM) and `session_watch_history` (live sessions) with MAX-merge semantics. Both must keep their write contracts.

### Apps Script integration touch points (must keep working)

- `src/lib/training/appsScript.ts` Apps Script HTTP client.
- `src/lib/training/sheets.ts` progress normalization.
- `src/lib/training/certificateEngine.ts` (best-effort Apps Script sync still happens here).
- Calls from: `app/training/assessment/[tabKey]/page.tsx`, `app/api/admin/reset-attempts/route.ts`, `app/api/training/questions/route.ts`, `app/api/training/course-details/route.ts`.
- Apps Script URL is read from `training_settings.apps_script_url`; if the row name changes, every call 500s.

### Cron jobs that must keep running

- `/api/cron/session-reminders` (06:00 UTC daily). Reads `session_registrations.reminder_*_sent` flags. If renamed, students miss their 24h and 1h reminders silently.
- `/api/cron/newsletter-scheduled` (07:00 UTC daily). Reads `newsletter_campaigns.status='scheduled'`. If renamed, scheduled sends never fire.
- Both gated by `CRON_SECRET` bearer.

### Scheduled tasks that must not be interrupted

- Inline cert issuance in `submit-assessment/route.ts`. Fire-and-forget. Any error path that throws synchronously breaks the student-facing 200. Wrap any new code in the route with try/catch.
- Newsletter `sendCampaign()` 200ms stagger. The 100/batch chunking is rate-limit-bound; any code path that calls `resend.emails.send` directly outside `sendEmailBatch` risks the 5/sec limit.

### Restructure-validation checklist

A proposed restructure passes only if all of the following hold:

- [ ] Every route in the "Routes students hit" list above is reachable in a Vercel preview build.
- [ ] Every API in the "API endpoints" list above returns the same shape under a smoke-test (curl or Postman).
- [ ] `npm run verify` exits 0.
- [ ] `vercel.json` cron paths still resolve to existing routes.
- [ ] `src/lib/training/appsScript.ts` is reachable (path or alias updated everywhere).
- [ ] `process.env.NEXT_PUBLIC_LEARN_URL` resolves and `/verify/[uuid]` canonical points to learn.
- [ ] `training_session` cookie still authenticates a student to `/training/dashboard`.
- [ ] NextAuth login still authenticates an admin to `/admin/dashboard`.
- [ ] Inline cert issuance fires when a final-exam pass POST hits `/api/training/submit-assessment`. Verify by checking `student_certificates.email_sent_at` after a test pass.
- [ ] No new Category 4, 5, 6, or 7 violation introduced by the restructure (re-run the boundary grep from Section 9).

If any item above fails, the restructure must be revised or reverted before being merged into `main`.

---

End of inventory.
