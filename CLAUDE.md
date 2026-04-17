# Financial Modeler Pro — Claude Code Project Brief
**Last updated: 2026-04-18** (docs updated session end — newsletter system, auto-notifications, legal pages, founder profile update, YouTube engagement, badge visual upgrade, OG font loading, website audit fixes, CMS rich text rendering, migrations 091-096)

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
- **Table**: `certification_watch_history` (migration 088)
- **API**: `GET/POST /api/training/certification-watch`
- **Watch page**: writes `in_progress` on video play, `completed` on Mark Complete
- **Dashboard**: fetches watch history, passes `completedWatchKeys`/`inProgressWatchKeys` to SessionCard
- **SessionCard**: "Take Assessment →" only when `isWatched=true`; StatusBadge shows "In Progress" amber badge

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
