# Financial Modeler Pro — Claude Code Project Brief
**Last updated: 2026-04-18** (session end — Video watch enforcement (migration 103) with interval-merging tracker + admin toggles, Marketing Studio Phase 3A (9 FMP platform presets grouped by category + 5 template variants + variant-aware Quick Fill), Phase 2 (Quick Fill auto-populate + multi-caption + ZIP export), Phase 1.5 + background library + aspect-ratio lock, drag-and-drop canvas editor, react-rnd, element-based designs, multi-asset brand kit, universal CmsField rendering path, Tiptap RichTextarea upgrade, array-item VF, retake + timer persistence, attempts counter server-authoritative, founder_profile table dropped, /about page removed, universal share utility, Calendly inline embed on /book-a-meeting, migrations 097-102)

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

### Modeling Hub Coming Soon Mode
- Setting: `training_settings` table, key `modeling_hub_coming_soon`, value `'true'`/`'false'`
- Server helper: `src/lib/shared/modelingComingSoon.ts` → `isModelingComingSoon()`
- Signin page: server component checks setting → shows `ComingSoonWrapper` (handles `?bypass=true`) or `SignInForm`
- Register page: server component checks setting → shows `ModelingComingSoon` or `RegisterForm`
- Admin toggle: `/admin/modules` page header, API `GET/PATCH /api/admin/modeling-coming-soon`
- Files: `app/modeling/signin/SignInForm.tsx`, `app/modeling/signin/ComingSoonWrapper.tsx`, `app/modeling/register/RegisterForm.tsx`, `app/modeling/ComingSoon.tsx`

### Training Hub Coming Soon Mode
- Settings: `training_settings` table — keys `training_hub_coming_soon` (`'true'`/`'false'`) + `training_hub_launch_date` (ISO 8601 string, optional). Upserted on first admin save; no migration needed.
- Server helper: `src/lib/shared/trainingComingSoon.ts` → `getTrainingComingSoonState()` returns `{ enabled, launchDate }`, plus `isTrainingComingSoon()` shortcut.
- Signin page (`app/training/signin/page.tsx`): server component checks state → renders `TrainingComingSoonWrapper` (handles `?bypass=true`) or `TrainingSignInForm`.
- Register page (`app/training/register/page.tsx`): server component checks state → renders `TrainingComingSoon` or `TrainingRegisterForm` (client component extracted to `app/training/register/RegisterForm.tsx`).
- Direct page: `app/training/coming-soon/page.tsx` always renders the coming soon screen (useful for preview/share).
- Dashboard redirect chain: unauthenticated `/training/dashboard` already sends to `/signin`, which is gated — no middleware change needed.
- `TrainingComingSoon` component (`app/training/ComingSoon.tsx`): FMP-branded dark gradient hero, "Training Hub" badge, countdown timer (if `launchDate` set), newsletter waitlist form (hubs=['training']), LinkedIn/YouTube links, Back to Home. Shows "Already have access? Sign in →" bypass on signin variant only.
- `CountdownTimer` (`src/components/shared/CountdownTimer.tsx`): reusable Days/Hrs/Min/Sec grid, teal digits on navy cards, updates every 1s via setInterval, fires optional `onComplete`, swaps in "We're Live!" banner at 0.
- Admin toggle: `/admin/modules` adds a second launch-status card below the Modeling Hub one. Toggle enables/disables coming soon; when ON a `datetime-local` picker with Save Launch Date + Clear + Preview buttons appears. Timezone hint uses `Intl.DateTimeFormat().resolvedOptions().timeZone`.
- API: `GET/PATCH /api/admin/training-coming-soon` — GET returns `{ enabled, launchDate }`, PATCH accepts `{ enabled?, launchDate? }` (partial upsert, admin-gated via NextAuth role).

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

### Share System
- **SessionCard**: "Share" button → modal with textarea (pre-written text), LinkedIn (auto-copies text + opens compose), Copy Text
- **SessionCard**: "Card" button → modal with achievement image preview + download PNG
- **Assessment result page**: same share pattern (textarea + LinkedIn + Copy Text + card preview + download)
- **Dashboard share banner**: "Enjoying your progress?" → modal with same textarea/LinkedIn/Copy pattern
- **ShareModal** (watch page): motivational share text with Training Hub URL, LinkedIn auto-copy + open feed, WhatsApp pre-fill

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
