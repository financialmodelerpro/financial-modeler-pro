# Financial Modeler Pro — Claude Code Project Brief
**Last updated: 2026-04-21** (pre-launch polish session — **Resume/Continue Watching** via `playerVars.start` restored on both watch pages (live-sessions + 3SFM/BVM) with completion/near-end/short-position clamps; **Video-swap auto-detection** (`src/lib/training/detectVideoChange.ts`) on `/api/training/certification-watch` + `/api/training/live-sessions/[id]/watched` + admin-only nuclear reset `POST /api/admin/sessions/[tabKey]/reset-watch-progress` (handles LIVE_ prefix vs course tab_keys) with red reset buttons in both session editors; **Mark Complete unlocks in final 20s** via `nearEnd = pos >= total-20 || videoEnded` + `canMarkComplete = nearEnd && (thresholdMet || bypass)`; **Interactive onboarding tour** on first dashboard visit via `driver.js@^1.4.0` (migration 120 `training_registrations_meta.tour_completed`) + `POST /api/training/tour-status`; **Auto-launch cron (disabled)** — migration 118 adds per-hub `auto_launch` + `last_auto_launched_at` keys + `/api/cron/auto-launch-check` route (gated by `AUTO_LAUNCH_UI_ENABLED=false` because Vercel Hobby only supports daily crons); **Session reminder crons** refactored (migration 122) — `reminder_24h_sent`/`reminder_1h_sent` moved from `live_sessions` to `session_registrations` so late registrants still get reminders; **Training Hub Coming-Soon bypass list** (migration 121 `training_hub_bypass_list` in `training_settings` + `src/lib/shared/hubBypassList.ts` + `comingSoonGuard.ts`) for owner + pre-launch testers; **Universal share template `{hubUrl}` variable** (migration 119) appended to 5 templates with soft-upgrade predicate; **Hashtags mandatory + read-only in student preview**; watch threshold hidden from student-facing surfaces; live-session registration flow + email pipeline (`src/lib/training/sessionAnnouncement.ts`); **Mobile responsiveness pass** (C1-C9 Critical + I1-I18 Important); **Marketing Studio PNG render** fixed with 5s AbortController + `maxDuration=60` on `imageToDataUri`; System Health env-check respects `SUPABASE_URL` fallback; per-subdomain `layout.tsx` added across `app/training/*` + `app/refm/` for OG metadata inheritance)

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
| Rich Text | @tiptap/react + starter-kit + image + text-align + link + color + text-style + underline | 2.27.2 |
| Drag & Drop (CMS lists) | @hello-pangea/dnd | ^18.0.1 |
| Canvas Drag/Resize (Marketing Studio) | react-rnd | ^10.5.3 |
| ZIP Export | jszip | ^3.10.1 |
| Onboarding Tour | driver.js | ^1.4.0 |
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
| **YouTube Data API v3** | Fetch video comments (cached 24h in DB) | `YOUTUBE_API_KEY` |
| **Vercel** | Hosting + edge middleware | Auto-deploy on `main` push |
| **Vercel Web Analytics** | Page views, unique visitors, referrers, device/browser, geography | Zero-config via `@vercel/analytics` in `app/layout.tsx` |
| **Vercel Speed Insights** | Core Web Vitals (LCP, FID, CLS) for SEO | Zero-config via `@vercel/speed-insights` in `app/layout.tsx` |

---

## Certificate Issuance (Supabase-native, migration 109)

Certificates are now issued from Supabase eligibility data. Apps Script's "pending" flag is no longer a prerequisite — any student who has all required passes + meets the watch threshold will be picked up by the next cron tick.

- **Eligibility view**: `certificate_eligibility_raw` (from `training_assessment_results`) — one row per (email, course_code) with pass counters + `final_passed` flag. Migration 109.
- **Eligibility lib**: `src/lib/training/certificateEligibility.ts` — `checkEligibility(email, courseId)` runs the full course-config check (all regular + final sessions passed, watch threshold met with grandfathering + per-session bypass). `findAllEligibleFromSupabase()` returns every eligible student that doesn't already have an Issued row in `student_certificates`.
- **Engine**: `src/lib/training/certificateEngine.ts` gained `issueCertificateForPending(cert, options)` — the single per-student issuance path. `processPendingCertificates()` now scans BOTH Apps Script AND Supabase, dedups by (email|course_code), and calls `issueCertificateForPending` for each. Apps Script sync (`updateCertificateUrls`) is best-effort — a failure there no longer blocks issuance. Self-healing: a student Apps Script missed gets picked up on the next cron.
- **Force-issue**: `POST /api/admin/certificates/force-issue { email, courseCode }` — admin-only, bypasses the watch-threshold check, records the admin's email in `student_certificates.issued_by_admin` + sets `issued_via='forced'`.
- **Check eligibility**: `POST /api/admin/certificates/check-eligibility { email, courseCode }` — returns the full `EligibilityResult` (passed sessions, missing sessions, watch details, blocking reason).
- **Admin UI**: `/admin/training-hub/certificates` top card — email + course dropdown + `Check Eligibility` + `⚡ Force Issue` buttons. Shows eligibility breakdown inline; on success, links to the generated certificate PDF + badge PNG.
- **Cron unchanged**: still hits `/api/cron/certificates` every 15 min, still calls `processPendingCertificates()` — the new Supabase-first pass runs inside that same call, so no Vercel cron re-config needed.

## SEO

Full SEO implemented across all public pages.

- **Root defaults** (`app/layout.tsx`): metadataBase + title template (`%s | Financial Modeler Pro`) + keyword-rich description + OG/Twitter + robots + viewport. `<OrganizationJsonLd>` + `<WebSiteJsonLd>` rendered once in the root body for sitewide rich results.
- **Per-page metadata**: every public page has its own title + description + canonical + OG/Twitter. Dynamic pages (`/articles/[slug]`, `/modeling/[slug]`, `/training-sessions/[id]`) use `generateMetadata`.
- **Sitemap**: `app/sitemap.ts` — auto-generated from `articles`, `live_sessions`, `cms_pages`, plus the static main-domain + `learn.` + `app.` landing pages + every `PLATFORMS` config slug. Regenerates hourly. Accessible at `/sitemap.xml`.
- **Robots**: `app/robots.ts` — disallows admin/api/dashboard/auth/token routes, blocks LLM-training bots (GPTBot, ChatGPT-User, CCBot, anthropic-ai, Claude-Web, Google-Extended), points to `/sitemap.xml`. Accessible at `/robots.txt`.
- **Structured data library** (`src/components/seo/StructuredData.tsx`): `OrganizationJsonLd`, `WebSiteJsonLd`, `PersonJsonLd` (Ahmad Din's about page), `CourseJsonLd` (training modules), `ArticleJsonLd` (articles), `EventJsonLd` (live sessions — both scheduled + recorded), `BreadcrumbJsonLd`, `FAQJsonLd`. All auto-escape `</script>` to keep the JSON-LD tamper-safe.
- **Breadcrumbs**: `src/components/seo/Breadcrumbs.tsx` — visual breadcrumb + matching BreadcrumbList JSON-LD. Article + live-session detail pages already emit the JSON-LD.
- **Canonical helper**: `src/lib/seo/canonical.ts` — `canonicalUrl(path, 'main' | 'learn' | 'app')`. Used by every page that builds a canonical URL.
- **Keywords** targeted in defaults: financial modeling training, 3-Statement Financial Modeling, business valuation, real estate modeling, corporate finance training, financial modeling KSA / Saudi Arabia / GCC / Pakistan, FMVA prep, ACCA financial modeling, LBO, project finance, FP&A, transaction advisory. Weaved naturally into page descriptions — no keyword stuffing.

**Next steps (manual, ~15 min):**
1. Register on Google Search Console → verify ownership (meta tag or DNS) → submit `https://financialmodelerpro.com/sitemap.xml`.
2. Same for Bing Webmaster Tools (optional).
3. Once verified, add verification codes to `app/layout.tsx` under `metadata.verification`.

## Analytics

Site analytics via **Vercel Web Analytics + Speed Insights** — both free on the Hobby plan, currently sufficient for pre-launch traffic.

- `<Analytics />` + `<SpeedInsights />` mounted in `app/layout.tsx` (after `SessionProviderWrapper`, inside `<body>`). Both components auto-detect `production` vs `preview` / `development` — no manual gating needed.
- Tracks: page views, unique visitors, top pages, referrers (LinkedIn/Google/direct/etc), device + browser breakdown, geographic data, real-time active users.
- Speed Insights reports Core Web Vitals (LCP/FID/CLS) per-route — useful for SEO health.
- **All three subdomains** (`financialmodelerpro.com`, `learn.`, `app.`) share the same dashboard because they're served by the same Next.js deployment.
- Cookieless + GDPR-compliant by default; no consent banner required.
- **Dashboard**: Vercel project → Analytics tab (and Speed Insights tab).
- Plan to upgrade to Vercel Pro when Modeling Hub launches for higher event quotas + longer retention.

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
- Financial inputs: `.input-assumption` class (yellow bg `--color-warning-bg`)
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
| `YOUTUBE_API_KEY` | YouTube Data API v3 key (server-only, for comments fetch) |
| `NEXT_PUBLIC_YOUTUBE_CHANNEL_ID` | YouTube channel ID for subscribe button (client-safe) |

### Scripts
```bash
npm run type-check   # tsc --noEmit — must be zero errors
npm run build        # next build --webpack (avoids MAX_PATH on Windows/OneDrive)
npm run verify       # type-check + lint + build
```

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

### Booking System — Calendly Inline Embed

`/book-a-meeting` embeds Calendly inline (no redirect). The widget URL comes from `page_sections.team.content.booking_url` (admin editable in Page Builder → Founder → Booking Page tab). Default event: 60-minute Modeling Hub Advisory Meeting. Calendly account is on the free tier with Outlook + Teams integration.

- **Component:** `src/components/booking/CalendlyEmbed.tsx` — client component, dynamically injects `assets.calendly.com/assets/external/widget.js` once per page load.
- **Fallback:** when `booking_url` is empty, the page shows a "Booking Calendar Coming Soon" notice and falls through to email / WhatsApp contact options.
- **Buttons on other pages** (home founder card, `/about/ahmad-din`) continue to navigate to `/book-a-meeting` where the embed lives — no deep link to Calendly anywhere else.

### CMS Content Rendering — Rules

**All CMS text content MUST be rendered via `<CmsField>` (`src/components/cms/CmsField.tsx`).**

- Never use `{content.field}` directly in JSX for a CMS text field.
- Never call `dangerouslySetInnerHTML` manually (except intentional raw passthrough like EmbedSection iframes or SVG `cols[].icon`).
- Never hand-roll `isHtml()` detection or `.split(/\n\n/)` paragraph splitting. CmsField does all of it.
- Use `cmsVisible(content, 'field')` when you need only a visibility gate around a heavily-styled wrapper (e.g. pill badges, h1 containers).

**CmsField handles:** visibility (`{field}_visible`), alignment (`{field}_align`), width (`{field}_width`), HTML-vs-plain detection, `.fmp-rich-text` styling, paragraph splitting.

Adding a new CMS section or page → every text field uses `<CmsField>`. No exceptions. Breaking this rule reintroduces the raw-tags / ghost-UI bugs the universal renderer was built to eliminate.

### CMS Option B Pages
All three marketing pages use **Option B**: each section fetched from `page_sections` via `getAllPageSections(slug)` and fed into custom hardcoded JSX (NOT SectionRenderer). `getAllPageSections()` returns ALL sections including `visible=false`. Pattern: `section.visible === false ? null : section ? <CMS render> : <hardcoded fallback>`. All pages use `revalidate = 0` (no ISR caching).

**Home page** (`app/(portal)/page.tsx`): hero (053), stats (054), text_image x3 (055-057), two-platforms (058), founder (059-063, 067-068), pacemakers (062). Home founder card shows `credentials.slice(0, 5)` max.

**Training page** (`app/training/page.tsx`, migration 065-066): 9 sections — hero, courses (dynamic), how-it-works (steps), why-certify (benefits), cert-verification, upcoming-sessions (dynamic), testimonials (dynamic), submit-testimonial CTA, bottom CTA. Testimonial cards show LinkedIn button via `TestimonialsCarousel.tsx`.

**Modeling page** (`app/modeling/page.tsx`, migration 070): 7 sections — hero, audience/what-is (text_image with audience[] cards), platforms grid (dynamic modules), why-modeling (benefits[]), testimonials (dynamic), submit-testimonial CTA, bottom CTA.

**Modeling platform sub-pages** (`app/modeling/[slug]/page.tsx`, migration 071-072): CMS-first with config fallbacks. Slug pattern: `modeling-{platform-slug}`. Real Estate has 7 sections: hero, stats bar, what-covers (text_image), who-is-it-for (list), what-you-get (list), module guide (dynamic from config), CTA.

### CMS Editors
- SmartColumnsEditor (TwoPlatforms/PaceMakers/generic), SmartTeamEditor (Founder/generic)
- FounderEditor (6 sections: home card, credentials, photo, buttons, full profile, booking page)
- CardsEditor: smart detection for benefits[]/cards[], normalizes desc/description, shows description field for dynamic sections
- TextImageEditor: body textarea, audience cards editor, side image + background image always visible, paragraphs support
- ProcessStepsEditor: auto-detected for timeline sections with content.steps[]
- **Universal ParagraphsEditor**: renders between ActiveEditor and StyleEditor for every section type, with per-paragraph alignment (L/C/R/J)
- Per-field visibility: `content.fieldName_visible !== false` pattern across all section renderers

### Founder Section Data Structure
- `content.credentials[]` — unified list: home card shows as ✓ checklist (max 5 via `.slice(0, 5)`), about page + expanded view show as numbered teal circles. Single source of truth (experience[] removed in migration 068)
- `content.long_bio` — full background story (split by `\n\n` or `\n`). About page + expanded view
- `content.philosophy` — modeling philosophy quote
- `content.projects[]` — { id, title, description, sector, value }
- `content.booking_url` — Microsoft Bookings URL. `/book-a-meeting` page reads this
- `content.booking_expectations[]` — "What to expect" list on booking page

### Training Settings (Unified admin page)
All global training controls live at **`/admin/training-settings`**:
- **Apps Script URL** — the Google Apps Script Web App URL (still needed by 3SFM/BVM question fetch + legacy progress).
- **Transcript Editor** shortcut card.
- **Watch Enforcement** — global toggle + threshold + per-session bypass table (union of COURSES + every `live_sessions` row + unmapped cert-course history) with search, type filter, status filter, sort, bulk actions.
- **Assessment Settings** *(new, migration 108)* — global **Shuffle Questions** + **Shuffle Options** toggles. Applied client-side after questions load so one setting drives 3SFM, BVM (Apps Script-backed), and live sessions (Supabase-backed) uniformly. Helper `src/lib/training/shuffle.ts` provides `applyShufflesLive`/`applyShufflesLegacy` for Fisher-Yates with `correct_index`/`correctIndex` remapping. Live session submit endpoint additionally returns `correct_answer_texts` so the result view works regardless of option shuffle state.
- **Training Hub Launch Status** *(moved from Course Manager)* — `<LaunchStatusCard>` for the Training Hub coming-soon toggle + launch date.

**Course Manager pages** (`/admin/training` + `/admin/training/[courseId]`) are now focused purely on course structure + content. The old Timer Bypass, per-course Shuffle, and Launch Status toggles have been removed — an info banner at the top of the Course Manager links to Training Settings. The `timer_bypass_enabled` key is dropped by migration 108 since watch-enforcement supersedes it; remaining readers (`course-details` route, `videoTimer.ts`, etc.) gracefully default to `false`.

### Hub Coming Soon Mode (Modeling + Training)

Both hubs share the same pattern: a server-side gate on signin/register pages plus a reusable admin card. The toggle and an optional launch date are stored in `training_settings` per hub. When the launch date is set the public page renders a live Days/Hrs/Min/Sec countdown; when it's empty only the coming-soon message is shown.

**Shared pieces:**
- `CountdownTimer` (`src/components/shared/CountdownTimer.tsx`): reusable Days/Hrs/Min/Sec grid, updates every 1s, fires optional `onComplete`, swaps in "We're Live!" banner at zero. Accepts `accentColor` / `cardBackground` / `cardBorder` for per-hub theming.
- `LaunchStatusCard` (`src/components/admin/LaunchStatusCard.tsx`): reusable admin card. Props `{ label, icon, endpoint, previewUrl, onMessage }`. Renders the status pill + toggle + Preview ↗, and when enabled an optional `datetime-local` picker with Save / Clear. Posts to the given `endpoint` with `{ enabled }` or `{ launchDate }` partial PATCH.

**Modeling Hub:**
- Settings: `modeling_hub_coming_soon` (`'true'`/`'false'`) + `modeling_hub_launch_date` (ISO 8601, optional).
- Helper: `src/lib/shared/modelingComingSoon.ts` → `getModelingComingSoonState()` returns `{ enabled, launchDate }`; `isModelingComingSoon()` shortcut kept for back-compat.
- API: `GET/PATCH /api/admin/modeling-coming-soon` — partial upsert on either field, admin-gated.
- Public pages: `app/modeling/signin/page.tsx` + `app/modeling/register/page.tsx` server-gate and pass `launchDate` through. Signin uses `ComingSoonWrapper` with `?bypass=true` escape hatch. `ModelingComingSoon` renders blue-tinted `CountdownTimer` only when `launchDate` is set.
- Admin: `LaunchStatusCard` mounted at top of `/admin/modules`.

**Training Hub:**
- Settings: `training_hub_coming_soon` + `training_hub_launch_date`.
- Helper: `src/lib/shared/trainingComingSoon.ts` → `getTrainingComingSoonState()` / `isTrainingComingSoon()`.
- API: `GET/PATCH /api/admin/training-coming-soon`.
- Public pages: `app/training/signin/page.tsx` + `app/training/register/page.tsx` server-gate. `TrainingRegisterForm` extracted from the old page to allow the split. `TrainingComingSoon` (`app/training/ComingSoon.tsx`) adds a newsletter waitlist (hubs=['training']) + LinkedIn/YouTube links + standalone `/training/coming-soon` preview route. Countdown only renders when `launchDate` is set.
- Admin: `LaunchStatusCard` mounted at top of `/admin/training` (Course Manager page — NOT `/admin/modules`, which is for Modeling Hub only).
- Dashboard redirect chain: unauthenticated `/training/dashboard` already sends to `/signin`, which is gated — no middleware change needed.

### certificateEngine.ts
- PDF generation uses scaleX/scaleY (editor 1240x877 -> PDF points) and per-font ascent correction
- Badge generation reads BadgeLayout from cms_content (section: badge_layout)
- Exports: BadgeLayout, BadgeTextField, DEFAULT_BADGE_LAYOUT, loadBadgeLayout()

### videoTimer.ts
- `getTimerStatus()` accepts optional `timerBypassed` param (from training_settings DB key: `timer_bypass_enabled`)

### sheets.ts
- `normalizeProgressObject()` handles both bestScore/score field names and passed/status detection with score >= 70 fallback

### Email Templates — Branding System
- All 11 hardcoded email templates use `baseLayoutBranded()` from `_base.ts` (async, fetches `email_branding` table)
- `baseLayoutBranded()` provides: dynamic logo (with text fallback), `signature_html`, `footer_text`, `primary_color`
- Legacy `baseLayout()` still exists in `_base.ts` but is no longer used by any template
- `liveSessionNotification.ts` has its own `emailShell()` that also fetches `getEmailBranding()` directly
- All template functions are async — callers must `await` them
- No personal names in any email template signatures — company name only

### YouTube Integration (Live Sessions)
- **YouTubePlayer**: `src/components/training/YouTubePlayer.tsx` — YT IFrame API, tracks completion via `/api/training/live-sessions/[id]/watched`, `onNearEnd` fires 20s before end
- **SubscribeButton**: `src/components/training/SubscribeButton.tsx` — legacy, unused (replaced by SubscribeModal)
- **SubscribeModal**: `src/components/training/SubscribeModal.tsx` — clean modal with YouTube subscribe link
- **LikeButton**: `src/components/training/LikeButton.tsx` — links to YouTube for likes
- **YouTubeComments**: `src/components/training/YouTubeComments.tsx` — fetches from `/api/training/youtube-comments` (24h DB cache)
- **Admin toggle**: `show_like_button` on `live_sessions` table (default true), toggled in admin session edit form
- **Watch progress**: `session_watch_history` table, 50 points on first completion, badges on live sessions listing page

### Live Sessions — Instructor Roster (migration 106)
- **Table**: `instructors` (name, title, bio, photo_url, email, linkedin_url, credentials, display_order, is_default, active). Partial unique index `uniq_instructors_single_default` enforces at most one default. Seeded with Ahmad Din.
- **Link**: `live_sessions.instructor_id UUID REFERENCES instructors(id) ON DELETE SET NULL`. Legacy `instructor_name`/`instructor_title` columns are kept and auto-synced — every read path (cards, emails, detail pages) keeps working unchanged.
- **Admin APIs**: `GET/POST /api/admin/instructors`, `GET/PATCH/DELETE /api/admin/instructors/[id]`. PATCH demotes the previous default when promoting a new one, and fan-outs name/title changes to every linked `live_sessions` row. DELETE returns 409 + `inUse: true` + `sessionCount` if the instructor is still linked.
- **Admin page**: `/admin/training-hub/instructors` — list cards (photo avatar or initials fallback), DEFAULT / INACTIVE badges, ↑/↓ reorder, Make Default, Activate/Deactivate, Edit (modal with RichTextarea for bio), Delete (with usage-check error).
- **Picker**: `src/components/admin/InstructorPicker.tsx` — mounted in the live-session editor in place of the old two-text-input row. Dropdown of active instructors (default shows "(default)"), "+ New" inline quick-add form (name/title/credentials → auto-select on save), live preview of the selected instructor, "Manage ↗" link to the full admin page.
- **Save flow**: admin editor now posts `instructor_id`. POST `/api/admin/live-sessions` falls back to the default instructor when `instructor_id` is empty; PATCH denormalizes name/title from the instructor row when `instructor_id` is set. Existing sessions without an `instructor_id` keep their legacy text values.
- **Sidebar**: `Instructors` link added under Training Hub in `CmsAdminNav.tsx` (🎤 icon), between Live Sessions and Course Manager.

### Live Sessions — Native Assessment System (migration 105)
- **Tables**: `live_session_assessments` (one per session, stores `questions jsonb`, `pass_threshold`, `max_attempts`, `timer_minutes`, `require_watch_before_assessment`, `watch_threshold`) and `live_session_attempts` (per submission, unique on `(session_id, email, attempt_number)`). Denormalized `has_assessment` flag on `live_sessions` is kept in sync by `saveAssessment()` / `deleteAssessment()`.
- **Helper**: `src/lib/training/liveSessionAssessments.ts` — `getAssessment`, `saveAssessment`, `deleteAssessment`, `submitAttempt` (server-side scoring — compares against stored `correct_index` so clients can't cheat), `getStudentAttempts`, `getLatestAttempt`, `hasPassed`, `getWatchPercentage`, `isWatchRequirementMet`, `stripAnswersForStudent` (removes `correct_index` + `explanation` before shipping to clients).
- **Cookie helper**: `src/lib/training/trainingSessionCookie.ts` → `getTrainingCookieSession()` reads the httpOnly `training_session` cookie; used by all new student APIs.
- **Admin APIs**: `GET/PUT/POST/DELETE /api/admin/live-sessions/[id]/assessment` (admin role check via NextAuth), `GET /api/admin/live-sessions/[id]/attempts` (list every student attempt).
- **Student APIs**: `GET /api/training/live-sessions/[id]/assessment` (returns questions without answers), `POST /api/training/live-sessions/[id]/assessment/submit` (scores server-side, returns score + per-question correctness; correct answers + explanations only returned when the student passes), `GET /api/training/live-sessions/[id]/attempts` (student's own history, no answers leaked).
- **Admin UI**: `src/components/admin/LiveSessionAssessmentEditor.tsx` mounted inside `app/admin/training-hub/live-sessions/page.tsx` between the Attachments and Notifications sections. Enable toggle, pass-threshold slider (50–100%, step 5), max-attempts input, optional timer, watch-gate toggle + threshold, question list with up/down reorder + edit/delete, Tiptap-backed `RichTextarea` for question text + explanation, per-question 2–6 options with radio-to-mark-correct, Bulk Import JSON pane, self-contained Save/Delete buttons (does NOT merge into the existing `saveSession()` unified save).
- **Student page**: `/training/live-sessions` replaced its redirect with `app/training/live-sessions/page.tsx` (server) + `LiveSessionsClient.tsx` (client). Header: "LIVE SESSIONS" eyebrow + "FMP Real-World Financial Modeling" h1 + "Live sessions and recorded content" subtitle. 4-stat KPI row (Upcoming / Started / Watched / Achievement Cards). Two sections: **Upcoming** (sorted by `scheduled_datetime` ASC = soonest first) and **Recorded** (sorted ASC = oldest recording first, matching release order). Wrapped in `TrainingShell` with `activeNav="live-sessions"`.
- **LiveSessionCardLarge** (`src/components/training/dashboard/LiveSessionCardLarge.tsx`): matches the 3SFM SessionCard tokens (10px radius, 4px left-border state accent, tinted bg when passed/in-progress, 14–18px padding, 0 1px 4px rgba shadow, lift on hover). Upcoming variant: `UPCOMING` / `REGISTERED` / `LIVE NOW` badge + adaptive primary CTA (`Register` → `View Details` → `Starting soon →` → `Join Live →`) + `.ics` icon button. Recorded variant: `RECORDED` badge + `PASSED` corner badge when the student has passed, status chips (`Has Assessment` / `Assessment Passed · XX%` / `Max Attempts Reached`), watch-progress bar with a dashed threshold marker when an assessment gate exists, adaptive primary CTA (`Watch Recording` / `Continue Watching` / `Watch Again`), conditional `Take Assessment →` / `Retake Assessment →` / `🔒 Watch {threshold}% to unlock` secondary CTA, Share icon (uses universal `ShareModal`), and a gold `Award` icon that opens `ShareModal` prefilled with the existing `/api/training/achievement-image` URL (type inferred — uses live session title + score + date + student name + regId).
- **Achievement card eligibility**: with an assessment → must pass; without an assessment → watched ≥ threshold (default 70%). The card's Award button is only rendered in the eligible state.
- **Assessment taking page**: `/training/live-sessions/[id]/assessment` with server component fetching auth + session + assessment + prior attempts + watch%. `AssessmentClient` has three phases: **intro** (stats, prior attempts, watch-gate lock or attempts-exhausted lock, Start button), **quiz** (optional sticky countdown header, one-page all-questions layout with radio options, submit disabled until all answered), **result** (pass/fail icon, big score, per-question correctness with correct answer revealed only if passed, explanations if passed, Retake when attempts remain, View Achievement Card when passed).
- **Sidebar unchanged** (per spec): `TrainingShell` still shows the "Live Sessions" accordion; the new `/training/live-sessions` page is accessible via direct URL and via `activeNav` highlight.
- **Public `/training-sessions` unchanged** (per spec).

### Dashboard Live Sessions Cards
- `src/components/training/dashboard/LiveSessionCard.tsx` — two variants. **Upcoming** shows a banner with `UPCOMING` / `REGISTERED` / `LIVE NOW` badge, date/time/duration/instructor meta, and an adaptive CTA: `Register` → `View Details` (registered) → `Starting soon →` (≤15 min before, registered) → `Join Live →` (when `joinLinkAvailable`). Secondary icon is Add-to-Calendar (.ics). **Recorded** shows a teal `Recorded` badge, a green check corner when watched, date/duration/instructor meta, an amber watch-progress bar when `status=in_progress` with pct, an adaptive CTA `Watch Recording` / `Continue Watching` / `Watch Again`, and a Share icon that opens the universal `ShareModal`.
- `src/components/training/dashboard/LiveSessionsSection.tsx` — dashboard block with single "Live Sessions" header + two sub-grids (Upcoming and Recorded). Self-fetching via `getLiveSessionsForStudent(email)`. Renders nothing when neither subsection has data. Upcoming sub-grid shows registered sessions first. Layout: `grid-template-columns: repeat(auto-fit, minmax(260px, 1fr))`, matches Achievement/SessionCard visual scale (12px radius, 1px border, soft shadow, navy titles).
- Data helper: `src/lib/training/liveSessionsForStudent.ts` → `getLiveSessionsForStudent(email, courseId?, limit=3)` returns `{ upcoming, upcomingRegistered, recorded, regStatus, watchHistory }`. Wraps existing APIs (`/api/training/live-sessions?type=upcoming|recorded`, `/registration-status-batch`, `/watch-history`). `courseId` filter is a best-effort string match against `category` / `playlist.name` / `tags` (the schema has no course_id column).
- ICS helper: `src/lib/training/calendar.ts` → `downloadIcs(session)` — 90-min default when `duration_minutes` missing; no-op SSR-safe.
- Dashboard integration: `app/training/dashboard/page.tsx` replaced the old inline 3-col upcoming preview with `<LiveSessionsSection studentEmail={localSession.email} />`. The dashboard's own `upcomingSessions` state is retained solely to drive the sidebar live-now dot + quick-actions bar.

### Course Player System
- **CoursePlayerLayout**: `src/components/training/player/CoursePlayerLayout.tsx` — CFI-style: left sidebar, video, right comments panel
- **CourseTopBar**: `src/components/training/player/CourseTopBar.tsx` — dark sticky bar with actions, Mark Complete, Assessment, Continue
- **ShareModal**: `src/components/training/player/ShareModal.tsx` — Copy Link, LinkedIn, WhatsApp share
- **StudentNotes**: `src/components/training/StudentNotes.tsx` — per-session private notes with auto-save
- **WelcomeModal**: `src/components/training/WelcomeModal.tsx` — first-visit modal with YouTube+LinkedIn
- **FollowPopup**: `src/components/shared/FollowPopup.tsx` — reusable follow popup with LinkedIn+YouTube
- **Cert Watch Page**: `app/training/watch/[courseId]/[sessionKey]/page.tsx` — embedded player for certification courses
- **Live Sessions Tab**: Dashboard `?tab=live-sessions` renders `LiveSessionsContent.tsx` inline
- **Session Notes API**: `app/api/training/session-notes/route.ts` — GET+POST with upsert

### Training Hub Dashboard
- Dashboard has its OWN built-in header/sidebar (NOT TrainingShell)
- CMS logo fetched from `/api/cms?section=header_settings&keys=logo_url,logo_height_px`
- Live Sessions is a dashboard tab (`?tab=live-sessions`), not a separate page
- `/training/live-sessions` redirects to `/training/dashboard?tab=live-sessions`
- Sidebar accordion shows Upcoming/Recordings with counts
- Live Sessions label configurable via CMS key `training_hub/live_sessions_label`

### `/api/branding`
- GET is public (no auth) — PATCH requires admin

### Certification Watch Tracking
- **Table**: `certification_watch_history` (migration 088 base, migration 103 adds `watch_seconds`, `total_seconds`, `watch_percentage`, `last_position`, `updated_at`)
- **API**: `GET/POST /api/training/certification-watch` — POST accepts optional `watch_seconds`/`total_seconds`/`last_position` and uses MAX(existing, incoming) for seconds so stale updates never shrink progress
- **Watch page**: writes `in_progress` on video play, `completed` on Mark Complete
- **Dashboard**: fetches watch history, passes `completedWatchKeys`/`inProgressWatchKeys` + `watchPctMap` + `watchThreshold` to SessionCard
- **SessionCard**: "Take Assessment →" only when `isWatched=true`; StatusBadge shows "In Progress" amber badge; thin watch progress bar appears below the score row when a percentage exists and the session isn't yet passed

### Watch Enforcement — Default Behavior

All training sessions — current and future — enforce the watch threshold by default. No per-session seeding is required: a session has no `watch_enforcement_bypass_{TABKEY}` row → enforcement applies.

**Override precedence** (evaluated top-down, first match wins):
1. **NextAuth admin role** → always bypassed (lets admins test without watching)
2. **Global toggle OFF** (`watch_enforcement_enabled='false'`) → all sessions bypassed
3. **Per-session bypass** (`watch_enforcement_bypass_{TABKEY}='true'`) → that session bypassed
4. **Default** → enforce `watch_percentage ≥ watch_enforcement_threshold`

New sessions added to `src/config/courses.ts` automatically inherit global enforcement. They also appear in the admin Watch Enforcement per-session table on next page load (the table is a union of `COURSES` tab_keys + any tab_key observed in `certification_watch_history`).

**Certificate issuance gate** (`src/lib/training/watchThresholdVerifier.ts`): before `processPendingCertificates` generates a cert, it calls `verifyWatchThresholdMet(email, courseCode)`. If any required session has `watch_percentage < threshold` and isn't bypassed, the cert is skipped (logged as `watch_threshold_not_met:` error). Rows that predate migration 103 (no watch data captured) are grandfathered so historical cert issuance isn't broken.

Admin actions at `/admin/training-settings`:
- Toggle global enforcement on/off
- Change threshold (50–100%, step 5)
- Add/remove per-session bypass exceptions
- Summary shows global status + threshold + enforcing/bypassed counts at a glance

### Mark Complete — Near-End Gate (20s window)

The Mark Complete button unlocks the moment the student is genuinely approaching the end of a video, using a two-step gate that's uniform across the live-session watch page and the 3SFM/BVM certification watch page:

```
nearEnd         = liveTotalSec > 0 && (liveCurrentPos >= liveTotalSec - 20 || videoEnded)
canMarkComplete = nearEnd && (thresholdMet || bypassActive)
```

- **`nearEnd`** fires either when the YT player's `currentTime` crosses into the final 20s **or** when `videoEnded` has been set (triggered by `PlayerState.ENDED`, the `currentTime >= duration - 1` tick fallback, or the `PLAYING → PAUSED-at-end` fallback — all funnel through `onEnded` once, guarded by `endedFired`).
- **`thresholdMet`** uses the interval-merged `watch_seconds / total_seconds`, which seeking forward can't inflate. `bypassActive` covers admin / global-off / per-session bypass.
- When `canMarkComplete` is false and the student has logged playback, CourseTopBar swaps Mark Complete for a ghost hint (`Watching… X%` or `Watched X% · keep watching to finish`) so the toolbar isn't empty.
- To surface the near-end window snappily, `YouTubePlayer.startTickCheck` bypasses the normal 9.5s report throttle when `d > 0 && c >= d - 20` — parent state catches up within ~1s.
- Server-side `/watched` + `/certification-watch` re-check the threshold before accepting `status='completed'`; a tampered client POST returns 403 with `{ current, required }` which the live-session page surfaces to the student.

### Watch Resume / Continue (2026-04-21)

Resume from `last_position` works across logout/login and different devices for both watch pages. Chain:

1. **DB persistence** — every progress POST stores `watch_seconds`, `total_seconds`, `last_position`, `watch_percentage`, `status`. Wall-clock clamp prevents tampered inflation; MAX-merge prevents stale-client shrinkage.
2. **Page mount** — both watch pages fetch the stored row and seed `baselineWatchedSec` + `liveWatchSec` + `liveTotalSec` + `resumeAtSec`.
3. **YT start param** — `YouTubePlayer` accepts `startSeconds` and injects it into `playerVars.start` on `new YT.Player(…)`. YouTube honors the param reliably and survives buffering.
4. **Tracker floor** — `makeWatchTracker(baselineWatchedSeconds)` uses the baseline as a permanent floor so `watchedSeconds()` never drops below it; both pages wrap live emissions with `Math.max(prev, baselineWatchedSec, watchedSec)`.
5. **Cross-session** — DB keyed by `(email, session_id)` / `(email, tab_key)`, so any device with the same email sees the same resume state.

**Clamps applied before passing `resumeAtSec` to the player:**
- `status === 'completed'` → resume at 0 (rewatch from beginning, standard YouTube UX).
- `last_position ≤ 10s` → skip seek (treat as a fresh start).
- `last_position ≥ total − 30s` → skip seek (YT's `start` param loops back to 0 past-end).
- `last_position` null/missing → 0.

`resumePositionSeconds` is a new prop on `CoursePlayerLayout` that threads through to `YouTubePlayer.startSeconds`.

### Video Swap Auto-Detection (2026-04-21)

When an admin replaces a session's YouTube URL, the stored `total_seconds` will disagree with what the new player reports. Without intervention, the stored `watch_percentage` would be nonsense on the new video — possibly showing 100% completed against a video the student has never watched.

- **Helper**: `src/lib/training/detectVideoChange.ts` → `detectVideoChange(existingTotal, incomingTotal)` returns `{ changed: true, reason }` when `|existing − incoming| > 30s` **and** the relative diff exceeds 10%. Both a 0 on either side → `{ changed: false }` (unknown, don't trigger).
- **Applied to both endpoints**: `POST /api/training/certification-watch` + `POST /api/training/live-sessions/[id]/watched`. On verdict `changed=true`: reset `watch_seconds`/`total_seconds` to incoming, demote `status` to `in_progress`, clear `completed_at`/`watched_at`/`points_awarded`/`last_position`. Threshold guard then re-runs against the new video.
- **Admin nuclear reset**: `POST /api/admin/sessions/[tabKey]/reset-watch-progress` (admin-gated via NextAuth). Routes by prefix — `LIVE_<uuid>` → `DELETE FROM session_watch_history WHERE session_id=<uuid>`; everything else (e.g. `3SFM_S1`, `BVM_L3`, `3SFM_Final`) → `DELETE FROM certification_watch_history WHERE tab_key=<tabKey>`. Wipes every student's row so bypasses don't cover stale "completed" rows that wouldn't receive another tick from their owner.
- **Admin UI**: red "Reset Watch Progress" button inside both session editors — `/admin/training-hub/live-sessions` (uses `window.confirm` because the page shadows `confirm` with state) + `/admin/training/[courseId]`. Confirms before firing.

### Interactive Onboarding Tour (migration 120)

First-visit guided walkthrough of the Training Hub dashboard, powered by `driver.js@^1.4.0` (react-joyride rejected React 19 peer dep).

- **Component**: `src/components/training/DashboardTour.tsx` — runs once per student; highlights sidebar nav, courses, live sessions, profile menu, share button. Uses `data-tour="…"` attributes sprinkled on the real UI (no fake overlays).
- **State**: `training_registrations_meta.tour_completed BOOLEAN DEFAULT FALSE` (migration 120). One-shot: sets `true` on finish/skip.
- **API**: `POST /api/training/tour-status` — toggles the flag. Restart via profile dropdown's "Restart Tour" action (flips back to false).
- **Copy**: student-facing tour copy avoids mentioning the watch threshold percentage — the rule exists to gate progression, not to be advertised.

### Auto-Launch Cron (migration 118 — currently disabled)

Admins can schedule a Coming Soon → LIVE flip at a specific `launch_date`. Wiring is complete but **disabled** because Vercel Hobby only supports daily crons, and launch-flip needs 5-min granularity to be useful.

- **Settings seeded** (migration 118): `{training_hub,modeling_hub}_auto_launch` (`'false'`), `{training_hub,modeling_hub}_last_auto_launched_at` (`''`). Admins opt-in per hub.
- **Route**: `GET /api/cron/auto-launch-check` — polls `training_settings`, flips `coming_soon='false'` + `auto_launch='false'` (one-shot) + `last_auto_launched_at=ISO` when `enabled && auto_launch && launch_date <= now()`. `CRON_SECRET` bearer required.
- **UI gate**: `AUTO_LAUNCH_UI_ENABLED = false` in `LaunchStatusCard` hides the auto-launch opt-in until we upgrade to Pro. Manual toggles in `/admin/training-settings` + `/admin/modules` remain authoritative.
- **vercel.json**: the `*/5 * * * *` cron entry was rolled back. The route stays callable by hand for testing.

### Session Reminder Crons — per-registration flags (migration 122)

The 24h + 1h reminder crons previously used per-session flags on `live_sessions` (migration 043), which meant a student who registered inside the 24h window never got their reminder because the session-level flag was already set by the first registrant.

- **Migration 122**: adds `reminder_24h_sent BOOLEAN NOT NULL DEFAULT FALSE` + `reminder_1h_sent BOOLEAN NOT NULL DEFAULT FALSE` to `session_registrations`. Partial indexes on `false` rows keep the lookup cheap.
- **Cron**: `GET /api/cron/session-reminders` — iterates rows where the appropriate flag is false and the session is within the corresponding window, fires `liveSessionNotificationTemplate('reminder_24h' | 'reminder_1h')`, flips the flag.
- **Session-level `announcement_sent`** stays on `live_sessions` — that gates whether reminders fire at all ("don't remind about an unpublished session").
- **Helper**: `src/lib/training/sessionAnnouncement.ts` centralizes the announce-on-publish / manual-announce email build so the cron, the admin `/notify` route, and the register endpoint don't drift.

### Training Hub Coming-Soon Bypass List (migration 121)

Modeling Hub's NextAuth admin role skips the Coming-Soon gate in `authorize()`. Training Hub uses a custom cookie-based session with no role field, so migration 121 adds a per-identifier allowlist in `training_settings`:

- **Key**: `training_hub_bypass_list` — comma-separated emails OR registration IDs (case-insensitive). Seeded with the owner's email + their RegID.
- **Helper**: `src/lib/shared/hubBypassList.ts` → `isIdentifierAllowed(identifier)` reads the list, splits, trims, lowercases, matches either field.
- **Guard**: `src/lib/shared/comingSoonGuard.ts` centralizes the signin/register CS gate — checks hub state, then the bypass list, then `?bypass=true`. Both `/training/signin` + `/training/register` call it server-side.
- **Banner**: `src/components/shared/PreLaunchBanner.tsx` shows a slim pre-launch banner on the authed dashboard for bypass-listed testers so they know they're viewing a live build while the hub is still Coming Soon to the public.
- **UI**: admin editor for the list isn't built yet — edit the `training_settings` row directly for now.

### Share Template `{hubUrl}` Variable (migration 119)

Centralized share templates gain a `{hubUrl}` variable that resolves to the learn subdomain. Migration 119 soft-upgrades 5 templates (`assessment_passed`, `achievement_card`, `live_session_watched`, `session_shared`, `daily_certifications_roundup`) by appending `\n\nLearn more at {hubUrl}` — but only when `template_text` doesn't already mention the learn subdomain OR the `{hubUrl}` placeholder. Admin edits are preserved. `certificate_earned` is intentionally excluded because it already embeds `{verifyUrl}`. Migration is idempotent: re-running is a no-op because the updated rows then match the skip predicate.

### Watch Enforcement (70% rule — migration 103)
- **Interval-merging tracker**: `src/lib/training/watchTracker.ts` — records `[start, end]` intervals from PLAYING → PAUSED/ENDED transitions, merges overlaps on every commit. Seeking forward, replaying, or skipping cannot inflate the count. A `baselineWatchedSeconds` seed ensures a reload with a higher DB value never makes the live counter go backwards.
- **YouTubePlayer**: now accepts `baselineWatchedSeconds` + `onProgress(watchedSec, totalSec, pos)`. Polls getCurrentTime every 1s during PLAYING, reports roughly every 10s (plus on pause/end/unmount). Seek detection: if `|pos - (lastPos + 1)| > 2s` we close the previous segment and open a new one at the current position.
- **Watch page** (`app/training/watch/[courseId]/[sessionKey]/page.tsx`): fetches `/api/training/watch-enforcement?tabKeys=...` for `{ enabled, threshold, sessionBypass[tk], isAdmin }`. Posts progress every ~10s (throttled: needs ≥10s elapsed AND ≥5s delta). Renders `<WatchProgressBar>` above the Mark Complete button (`belowVideoContent` prop on CoursePlayerLayout). Mark Complete callback only set when `!enforcing || threshold met`; when `undefined` the button is hidden by CourseTopBar.
- **Enforcement API**: `GET /api/training/watch-enforcement?tabKeys=3SFM_S1,3SFM_S2` returns global flag + threshold (default 70) + per-tab bypass map + `isAdmin` (checked via NextAuth session — Training Hub students always `false`).
- **Admin UI**: `/admin/training-settings` → Watch Enforcement card. Global toggle (stored `watch_enforcement_enabled`), threshold slider 50–100% step 5 (`watch_enforcement_threshold`), per-session bypass table iterating all `COURSES[*].sessions` with tab_key-keyed checkboxes (`watch_enforcement_bypass_{TABKEY}`).
- **Bypass precedence**: admin role → always bypass; global disabled → always bypass; per-session bypass → bypass for that session; else enforce at threshold.
- **Progress bar component**: `src/components/training/WatchProgressBar.tsx` — color scheme red <30% / amber <threshold / green ≥threshold, dashed vertical threshold marker, `X% to go` messaging, bypass-aware labels.

### Training Assessment Results (Supabase Primary)
- **Table**: `training_assessment_results` (migration 090) — `email + tab_key` UNIQUE
- **Dual-write**: `submit-assessment` route writes to both Apps Script AND Supabase
- **Progress merge**: `progress` route fetches Apps Script, then overlays Supabase data (Supabase wins)
- **Tab key mapping**: `3SFM_S1` → sessionId `S1`; `3SFM_Final` → `S18`; `BVM_Final` → `L7`
- **Emails**: submit-assessment sends quizResultTemplate + lockedOutTemplate directly from Next.js

### Achievement Card & OG Previews
- **Achievement image**: `GET /api/training/achievement-image` — satori ImageResponse, runtime=nodejs, sharp SVG→PNG
- **Logo**: fetches from `cms_content.header_settings.logo_url` with branding/platform fallback, converts SVG→PNG via sharp
- **Admin control**: `achievement_card_logo_height` setting in Admin → Header Settings
- **OG banners**: `/api/og` (learn), `/api/og/modeling` (app), `/api/og/main` (main) — CMS hero text fetched live
- **Per-domain layouts**: `training/layout.tsx`, `modeling/layout.tsx` with domain-specific metadata + `metadataBase`
- **Assessment OG**: `assessment/[tabKey]/layout.tsx` generates metadata with session name + course from `COURSES` config

### Share System (centralized templates, migrations 114-117)

Every share button across the Training Hub resolves its text from a single admin-editable source: the `share_templates` table plus four `training_settings` keys for global brand/founder mention strings and `@`-prefix toggles. Edit copy once at `/admin/training-hub/share-templates` → every surface (certificate verify page, dashboard cert card, achievement cards, assessment passes, live session shares, watch-page generic share) picks up the change.

- **Tables / settings**: `share_templates` (`template_key` UNIQUE, `title`, `template_text`, `hashtags[]`, `mention_brand`, `mention_founder`, `active`), seeded with 5 templates (certificate_earned, assessment_passed, achievement_card, live_session_watched, session_shared) + migration 117 adds `daily_certifications_roundup`. `training_settings` holds `share_brand_mention`, `share_founder_mention`, `share_brand_prefix_at`, `share_founder_prefix_at`. Legacy per-template `mention_brand`/`mention_founder` columns are retained for schema compat but ignored at render time — all `@`-prefix decisions are global.
- **Render engine** (`src/lib/training/shareTemplates.ts`): pure `renderShareTemplate(template, vars)` with placeholder syntax `{var}` + `{@brand}` + `{@founder}`. Auto-normalizes `{course}` via `resolveCourseName()` (maps COURSES short codes like `3SFM` to full titles like `3-Statement Financial Modeling`) and exposes `formatShareDate()` as the canonical `en-GB` long-form formatter (`20 March 2026`). Every share call site routes dates through `formatShareDate()` so the output is identical across components. `DEFAULT_TEMPLATES` mirrors the migration seed for offline fallback; `SAMPLE_VARS` powers the admin preview pane with realistic multi-line cohort data.
- **Client hook** (`src/lib/training/useShareTemplate.ts`): module-level cache + in-flight dedup — one fetch per key per session regardless of how many cards mount the same template. Returns the DB template merged with settings; falls back to `DEFAULT_TEMPLATES` on fetch failure.
- **LinkedIn flow** (`src/lib/training/share.ts` + `ShareModal.tsx`): LinkedIn always opens the plain feed composer (`/feed/?shareActive=true`) — never `share-offsite`. The full text with hashtags merged in lives in the clipboard, so paste-to-post is clean and `@`-mentions the user re-types trigger LinkedIn's native tag suggestions. ShareModal seeds the editable textarea with `text + "\n\n" + #hashtag #hashtag` so students see exactly what ends up on LinkedIn before clicking share.
- **Admin page** `/admin/training-hub/share-templates`: Global Mention Settings card (brand/founder handle inputs + `Prefix @` toggles + live preview), then per-template cards with title, template-text textarea, variable-picker chips, hashtag chip editor with reorder/remove, active toggle, live preview rendered with `SAMPLE_VARS`, and a Save button. Per-template `mention_brand`/`mention_founder` checkboxes removed — control is global.
- **Daily Certifications Roundup** (`/admin/training-hub/daily-roundup`, migration 117): date picker (defaults today, capped at today) + `GET /api/admin/certificates/by-date?date=YYYY-MM-DD` returning every `cert_status='Issued'` row for the UTC calendar day. Per-student checklist with Select all / Clear shortcuts; live preview rebuilds on every toggle using `renderShareTemplate(template, { studentList, verifyLinks, count, date })`. `studentList` rendered as `✅ Name — Full Course Title` lines; `verifyLinks` as bulleted verify URLs. Share Roundup button opens the universal ShareModal. Page auto-loads the latest admin-edited template from the public API on mount so copy edits on the Share Templates page flow through instantly. Nav entry: 🎓 Daily Roundup under Training Hub.
- **Migrated call sites** (zero structural churn — API merges settings into template response): `CertificateImageCard` (dashboard) + `VerifyActions` (verify page) → `certificate_earned`; `SessionCard` → `achievement_card`; assessment results page → `assessment_passed`; `LiveSessionCardLarge` watched share → `live_session_watched`; achievement card → `achievement_card`; `LiveSessionCard` recorded share → `live_session_watched`; watch-page `CourseTopBar` ShareModal forwarder → `session_shared`.

### Verify Page (learn.\*/verify/[uuid])

Public certificate verification page served on the learn subdomain as the canonical host — QR codes, share previews, and every user-facing verify URL resolves here.

- **Hero + main card**: dark gradient backdrop (navy 071530 → 0F3D6E), `NavbarServer`, `Credential Verified` pill, branded card with student name, course, grade pill, issue date, certificate ID (monospace), QR code, and a client `VerifyActions` component that owns the share flow.
- **Inline document previews**: 2-column grid — left column stacks Certificate (4:3 PDF iframe with browser-native viewer + `#toolbar=0&navpanes=0&scrollbar=0&view=FitH`) on top and Badge (1:1 `<img>` with soft-gold radial backdrop so transparent badges stay grounded) below; right column is the taller Transcript (3:4 PDF iframe, prefers pre-cached storage URL when `transcript_url` is set to keep the hash params intact, else routes through `/api/training/transcript-cached/[id]`). Each card has a navy header strip with gold/blue accent label, `Open Full ↗` link, and a floating `⛶ View` pill as mobile fallback. Downloads (PDF, Badge, Transcript) and Share Certificate buttons sit below the QR.
- **Metadata integrity**: `app/verify/layout.tsx` pins `metadataBase = LEARN_URL`, `alternates.canonical = LEARN_URL`, and default `openGraph.url = LEARN_URL` so nothing inherits the root layout's MAIN_URL. `generateMetadata` in the page further refines with the absolute `/verify/<id>` URL on learn for og:url + canonical + og:image (`/api/og/certificate/<id>`) + twitter:image. Share previews on LinkedIn/WhatsApp/Twitter display `learn.financialmodelerpro.com` in the card footer regardless of which subdomain the user shared from.

### Subdomain-Correct OG Metadata + robots.txt

- Root `app/layout.tsx` sets site-wide defaults at MAIN_URL. Per-subdomain layouts (`app/training/layout.tsx`, `app/modeling/layout.tsx`, `app/verify/layout.tsx`) each override `metadataBase`, `alternates.canonical`, and `openGraph.url` so pages under `/training/*`, `/modeling/*`, `/verify/*` default to their subdomain root instead of inheriting main. Specific pages (e.g. `/verify/[uuid]`) further refine with their full per-URL canonical.
- `app/robots.ts` — `/api/` is disallowed for SEO hygiene, but `/api/og/` is explicitly allowed (longest-match wins in robots.txt) so LinkedInBot / Twitterbot / WhatsApp can fetch the dynamic OG images embedded in share previews. Without this carve-out the bots fall back to generic main-site imagery.
- **Universal rule**: every page's `og:url` and `alternates.canonical` must match its actual URL. Share links preview themselves — never redirect preview to the parent page.

### Dashboard Live-Sessions Preview

Dashboard block (`src/components/training/dashboard/LiveSessionsSection.tsx`) shows **upcoming-only** — recordings live on the full `/training/live-sessions` page. Single "Upcoming Live Sessions" header with `View all →` link, grid capped at 3 cards (`auto-fit, minmax(260px, 1fr)` + `slice(0, 3)` on the data), `auto-fit` collapses gracefully to 2/1 columns on narrow viewports. Empty state: dashed-border placeholder with `CalendarClock` icon, "No upcoming live sessions scheduled" message, and a `Browse recordings →` link. Previously the whole block disappeared when nothing was upcoming.

### SEO — Search Engine Webmaster Verification

`app/layout.tsx` metadata.verification carries both search-engine ownership tokens:
- `google: 'jfT1RuMQksYExlTJUB_dB5Jisp_BBw6XCHEihIb-0pc'` — renders as `<meta name="google-site-verification">` for Google Search Console.
- `other: { 'msvalidate.01': '914C3726459EF363BC996DD79F3CF8E7' }` — renders as `<meta name="msvalidate.01">` for Bing Webmaster Tools.

Both verify automatically once Vercel redeploys; confirm via **Verify** button in each respective console.

### Newsletter System (migrations 091-092)
- **Tables**: `newsletter_subscribers` (email+hub UNIQUE, per-hub unsubscribe_token), `newsletter_campaigns` (subject, body, target_hub, status, sent/failed counts, campaign_type auto/manual, source_type/source_id)
- **Auto settings**: `newsletter_auto_settings` (event_type UNIQUE, enabled, target_hub) — 6 event types seeded disabled
- **Subscribe form**: `src/components/newsletter/NewsletterSubscribeForm.tsx` — hub checkboxes (Training/Modeling), shown in SharedFooter 4th column
- **Unsubscribe**: `GET /api/newsletter/unsubscribe?token=` — per-hub, HTML response page
- **Admin**: `/admin/newsletter` — 4 tabs (Subscribers, Compose, Campaigns, Auto Notifications)
- **Compose**: type selector (live session, recording, article, certification, custom), auto-populate from DB, AI Enhance via Anthropic API, Tiptap editor
- **Auto-notify**: `src/lib/newsletter/autoNotify.ts` — `sendAutoNewsletter()` fire-and-forget, duplicate prevention via unique index, triggered from article publish + live session publish/recording
- **Email template**: `src/lib/email/templates/newsletter.ts` — custom `baseLayoutNewsletter()` with "Structured Modeling. Real-World Finance." signature
- **Deduplication**: when sending to "all", deduplicates by email (one email per person)

### Legal Pages (migration 093)
- **Pages**: privacy-policy, terms-of-service, confidentiality, refund-policy (draft)
- **CMS**: all 4 as `cms_pages` + `page_sections` (rich_text type), editable in Page Builder
- **Rendering**: served by `app/(cms)/[slug]/page.tsx` dynamic route (old hardcoded routes deleted)
- **Footer**: Privacy Policy, Terms of Service, Confidentiality & Terms links in bottom row

### Founder Profile (migration 094)
- **New fields**: `why_fmp` (mission story), `expertise[]` (10 items), `industry_focus[]` (6 items), `market_focus`, `personal`
- **Updated fields**: `bio`, `credentials[]` (10 items), `long_bio` (full career narrative), `philosophy`
- **About page**: renders all new sections (Why FMP, Expertise as tag pills, Industry as grid cards, Market Focus, Personal)

### YouTube Engagement (watch page)
- **CourseTopBar**: lucide-react icons (Bell, ThumbsUp, MessageCircle, Share2), Subscribe has red accent
- **YouTubeComments**: comment count in header, "Join the Discussion" CTA, "Leave a Comment" link, "View all on YouTube" when 10+ comments
- **SupportBanner**: warm amber card above comments, Subscribe/Like/Comment/Share pills, dismissible via sessionStorage
- **Comment deep links**: use `?lc=` parameter instead of `#comments` for reliable YouTube scroll

### Badge Visual Upgrade
- **Progress badges**: emoji replaced with styled lucide-react icons in 48px colored circles (Footprints, Flame, Zap, Target, Rocket, Trophy, Sparkles, Timer)
- **Certificate badges**: Preview (Eye icon) modal + Download button on dashboard
- **Locked badges**: grayscale icon circles at 32px

### OG Image Font Loading
- **Fonts**: `src/assets/fonts/` — Inter-Regular.ttf, Inter-Bold.ttf, Inter-ExtraBold.ttf
- **Loader**: `src/lib/shared/ogFonts.ts` — `loadOgFonts()` with in-memory cache
- **Applied to**: `/api/og`, `/api/og/main`, `/api/og/modeling`, `/api/training/achievement-image`

### CMS Rich Text Rendering
- **RichTextarea**: `src/components/admin/RichTextarea.tsx` — contenteditable div with floating selection toolbar (B, I, U, Size, Color)
- **HTML detection**: `src/lib/shared/htmlUtils.ts` — shared `isHtml()` regex used by all renderers
- **renderCmsText.tsx**: shared `CmsText` component + `isHtml` re-export for section renderers
- **Global CSS**: `.fmp-rich-text` class in `globals.css` — headings, paragraphs, lists, links, blockquotes, b/i/u/s tags
- **All section renderers**: HTML detection → `dangerouslySetInnerHTML` with `fmp-rich-text` class
- **Portal page**: PaceMakers, Two Platforms, Founder card, FounderExpand all use isHtml() detection
- **VF component**: `showLayout` defaults to `true` — all Page Builder fields get Width % + Alignment dropdowns

### Marketing Studio (Phase 1.5 — migrations 100 + 101 + 102)
**Drag-and-drop canvas editor** (replaced Phase 1 fixed templates). Element-based design: text, image, shape elements positioned with absolute coords. Backed by `react-rnd` for drag + resize.

- **Admin page**: `/admin/marketing-studio` — top bar (preset picker, dimension inputs, save/download), canvas editor below. The canvas IS the WYSIWYG preview — no separate preview panel.
- **Canvas editor**: `src/components/marketing/canvas/CanvasEditor.tsx` — 3-column: left (Add Text/Image/Shape + Layers + Undo/Redo), center (canvas with auto-fit zoom via ResizeObserver), right (properties panel). Supports multi-element designs, history stack (50 entries), keyboard shortcuts (Delete/Backspace, Ctrl+Z/Y, Ctrl+D duplicate, Ctrl+C/V copy-paste, Arrow nudge ±1 / Shift+Arrow ±10, Escape deselect).
- **Element renderer**: `src/components/marketing/canvas/ElementRenderer.tsx` — pure React visual for text/image/shape. Shared logic with server render route (same prop shape, slightly different JSX because satori is strict).
- **Properties panel**: `src/components/marketing/canvas/PropertiesPanel.tsx` — switches based on selected element. Text (font, size, weight, color, alignment, line height, letter spacing, **italic toggle**, inline content textarea), Image (URL/upload/Brand Kit picker, object fit, border radius, opacity, brightness, filter, **border ring with color**, **lock aspect ratio toggle**), Shape (bg color, border radius, border width/color, opacity, **lock aspect ratio toggle**). When nothing selected → Background panel (solid color / gradient / image). Image-type backgrounds show a 3-col library grid with upload-and-save, delete (custom only), BRAND-type badge, and an optional dark overlay with color+opacity. Aspect ratio lock wires through to `react-rnd`'s `lockAspectRatio` prop — corner handles maintain W:H; images default to locked to prevent distortion.
- **Presets** (Phase 3A — 9 FMP + Blank, grouped by platform): `src/lib/marketing/presets.ts` — element-based starting points. `PRESETS` array grouped via `PRESET_GROUPS`: **YOUTUBE** (FMP YouTube Thumbnail 1280×720, FMP YouTube Banner 2560×1440), **LINKEDIN** (FMP LinkedIn Post 1200×627, FMP LinkedIn Banner 1584×396), **INSTAGRAM** (FMP Instagram Post 1080×1080, FMP Instagram Story 1080×1920), **FACEBOOK** (FMP Facebook Post 1200×630), **OTHER** (FMP Twitter/X Post 1600×900, FMP WhatsApp Status 1080×1920), **CUSTOM** (Blank Custom). Each exports `buildPreset(brandKit) → { background, elements }`. Legacy generic presets (YouTube / LinkedIn / Instagram / Story without FMP prefix) kept in `LEGACY_PRESETS` for backward compat with old saved designs but hidden from picker. FMP presets use element-id prefixes (`title-`, `subtitle-`, `insight-`, `headline-`, `session-`, `title2-`, `tag-`, `series-`) so Quick Fill + ZIP export can remap text content across formats. `FMP_EXPORT_PRESET_IDS` drives the ZIP export target list. `fmpBackground()` helper resolves brand-uploaded library image or gradient fallback consistently.
- **Template variants** (Phase 3A — 5 variants): `src/lib/marketing/variants.ts` — one-click layout swap on any preset, scaled to current dimensions. `VARIANTS`: **Session Announcement** (NEW SESSION badge + session#), **Quote / Insight** (giant teal quote marks + italic insight), **Platform Launch** (LAUNCHING tag + 3 feature bullets + CTA button), **Achievement Spotlight** (CONGRATS strip + student name + giant score stat), **Article Promo** (NEW ARTICLE tag + headline + excerpt + READ MORE button). Each variant's `build(kit, dims)` returns `{ background, elements }` computed from proportional scalars (padding = 5.5% of min dim, font sizes = 2.2%–14% of min dim, positions as % of W/H). `orientation(dims)` picks landscape / square / portrait / banner behavior. Variants use the same id-prefix convention so Quick Fill works on any variant. Default option restores the preset's native layout. `design.variant_id` stored in the existing `content` jsonb column — no new migration needed.
- **Auto-populate (Quick Fill)**: `src/components/marketing/QuickFillPanel.tsx` — pick data source (Training / Live Session / Article) + item → click Apply → `autoFillElements()` in `src/lib/marketing/autoFill.ts` rewrites text element content by id-prefix bucket matching. Data source API: `GET /api/admin/marketing-studio/data-sources` returns `{ articles, liveSessions, trainingSessions }` (articles from `articles` table where status=published, live sessions from `live_sessions`, training from `src/config/courses.ts` `COURSES` constant, flattened into `{CourseKey}:{SessionId}` ids).
- **Multi-platform captions**: `src/components/marketing/CaptionsPanel.tsx` — LinkedIn / Instagram / Facebook / WhatsApp / Twitter / YouTube checkboxes, tone selector (Professional / Casual / Thought Leader / Educational), single "Generate All" button. API `POST /api/admin/marketing-studio/generate-captions` takes `{ template_type, elements, platforms[], tone }` and parallelises `Promise.all(platforms.map(...))` — one Claude call per platform with tailored prompt + tone modifier. Returns `{ captions: Record<platform, string> }`. Results shown in per-platform tabs with editable textarea, char count, copy button. Captions stored in `design.ai_captions` jsonb and persist via existing designs PATCH.
- **Saved designs sidebar**: `src/components/marketing/DesignsSidebar.tsx` — thumbnail grid (lazy-renders one design at a time via `/render`, caches blob URLs in component state, revokes on unmount), template-type filter dropdown, click to load, × to delete. Shows category icon + name + updated date.
- **Export to All Platforms (ZIP)**: `📦 Export All` button — lifts current design's text content (title/subtitle/session via reading-order heuristic), rebuilds each FMP preset with that content via `autoFillElements()`, renders all three to PNGs, zips them with `jszip`, triggers download. Output filenames `{slug}_youtube_1280x720.png`, `{slug}_linkedin_1200x627.png`, `{slug}_instagram_1080x1080.png`.
- **Render API**: `POST /api/admin/marketing-studio/render` — accepts `{ dimensions, background, elements }` payload. Pre-resolves all image URLs to base64 data URIs (sharp handles SVG→PNG), builds satori-compatible JSX with absolute-positioned divs, returns `ImageResponse` PNG at target dimensions.
- **Brand Kit**: `marketing_brand_kit` table (single row id=1) + migration 101 arrays `additional_logos`, `additional_photos`, `uploaded_images` (each `[{url, name}]`) + migration 102 `background_library` (`[{id, name, url, thumbnail, type: 'brand'|'custom'}]`). Editor at `/admin/marketing-studio/brand-kit` — upload libraries of logos/photos/images that the canvas image element can pull from via a grid picker. Background library managed inline from the canvas Background panel: upload a background → saves to library + applies immediately. Brand-typed backgrounds can't be deleted.
- **Designs**: `marketing_designs` table + migration 101 columns `dimensions jsonb`, `background jsonb`, `elements jsonb`. `content` column retained for backward compat (unused by canvas-mode). List/create `/api/admin/marketing-studio/designs`, update/delete `/api/admin/marketing-studio/designs/[id]`.
- **AI captions**: `POST /api/admin/marketing-studio/generate-caption` — Anthropic Claude (`claude-sonnet-4-20250514`), extracts text content from canvas elements (sorted by y then x reading order), generates platform-specific copy for LinkedIn / YouTube / Instagram / Twitter. Caption embedded in same page below canvas.
- **Types**: `src/lib/marketing/types.ts` — `CanvasElement` (text/image/shape), `CanvasBackground` (color/gradient/image), `Design` (dimensions + background + elements + ai_captions), `BrandKit` (with array fields).
- **Helpers**: `src/lib/marketing/canvasDefaults.ts` — `makeTextElement`/`makeImageElement`/`makeShapeElement` factories, `backgroundToCss()` shared by editor + server render, `uid()` id generator.
- **Admin nav**: Marketing Studio link under Content section in `CmsAdminNav.tsx`.
