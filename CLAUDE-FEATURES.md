# Feature Documentation

> Referenced from CLAUDE.md — detailed feature specs, flows, and architectural decisions.

---

## Feature Status

| Feature | Status | Notes |
|---------|--------|-------|
| **Training Hub — Auth** | ✅ Complete | Custom session, 1hr TTL, httpOnly cookie; RegID sign-in resolves email via Apps Script |
| **Training Hub — Registration + Email Confirm** | ✅ Complete | hCaptcha + pending table + Apps Script post-confirm |
| **Training Hub — Device Trust + OTP** | ✅ Complete | `training_email_otps`, 30-day trust cookie |
| **Training Hub — Resend Confirmation Email** | ✅ Complete | `POST /api/training/resend-confirmation` |
| **Training Hub — Inactivity Logout** | ✅ Complete | `useInactivityLogout` on dashboard |
| **Training Hub — Dashboard** | ✅ Complete | Redesigned: overview + course views, collapsible sidebar, mobile bottom nav, badge download, attachment counts |
| **Training Hub — Assessments / Quiz** | ✅ Complete | Client-side scoring, shuffle toggles, timer bypass |
| **Training Hub — Certificate System** | ✅ Complete | Internal pdf-lib PDF gen, sharp badge overlay, Supabase storage, daily cron + manual Generate Now |
| **Training Hub — Transcript** | ✅ Complete | Token-gated HTML + PDF, QR code, Certificate ID, CMS-driven, ASCII-only |
| **Training Hub — Profile** | ✅ Complete | Avatar upload, name/city/country |
| **Training Hub — Live Sessions** | ✅ Complete | Full CRUD, registration/RSVP, public pages, watch tracking, email notifications, YouTube player + subscribe banner + like button + comments |
| **Training Hub — Course Attachments** | ✅ Complete | Per-lesson + per-course files, in-dashboard preview |
| **Training Hub — Share Experience** | ✅ Complete | 3-tab modal (written, video, social), both hubs |
| **Public Training Sessions** | ✅ Complete | SSR pages, public API, learn homepage preview |
| **Modeling Hub — Auth** | ✅ Complete | NextAuth JWT, 1hr session |
| **Modeling Hub — Registration + Email Confirm** | ✅ Complete | hCaptcha + email_confirmed flag |
| **Modeling Hub — Device Trust + OTP** | ✅ Complete | `modeling_email_otps`, 30-day trust cookie |
| **Modeling Hub — Resend Confirmation** | ✅ Complete | `POST /api/auth/resend-confirmation` |
| **Modeling Hub — Inactivity Logout** | ✅ Complete | `useInactivityLogout` on portal + dashboard |
| **Subdomain Routing** | ✅ Complete | next.config.ts rewrites/redirects |
| **Admin Panel** | ✅ Complete | Full admin: users, training, certificates, CMS, branding, pricing, audit |
| **Admin — Training Hub section** | ✅ Complete | Students, cohorts, assessments, analytics, comms, reset attempts |
| **Admin — Certificate Editor** | ✅ Complete | Dual layout: HTML block + PDF field editor, coordinate scaling, ascent correction |
| **Admin — Badge Editor** | ✅ Complete | Satori + Sharp rendering, field editor, live preview |
| **Admin — Transcript Editor** | ✅ Complete | Header drag-to-position, CMS-driven, PDF Preview |
| **CMS / Dynamic Nav** | ✅ Complete | `site_pages` table, admin editable |
| **CMS — Dynamic Page Builder** | ✅ Complete | 21 section types, drag-and-drop, SEO, per-field visibility checkboxes, per-field width/alignment controls. **Home page** Option B (053-063, 067-068). **Training page** Option B (065-066): 9 sections. **Modeling page** Option B (070): 7 sections. **Modeling platform sub-pages** Option B (071-072): per-platform CMS via `modeling-{slug}` pattern, Real Estate has 7 sections including stats bar. Other pages use SectionRenderer + `_dynamic` markers. Smart editors: SmartColumnsEditor, SmartTeamEditor, FounderEditor, PaceMakersEditor, CardsEditor (benefits[]/cards[] smart detect), ProcessStepsEditor (steps[] in timeline). Universal ParagraphsEditor on all sections with per-paragraph alignment. TextImageEditor: body field, audience cards, side+bg image always visible, paragraphs. CmsParagraphs shared renderer for Text, CTA, Hero, Cards, List, TextImage sections. Admin modules page shows "Content Ready ✓" / "Setup Required" per platform with page builder links |
| **CMS — Book a Meeting Page** | ✅ Complete | `/book-a-meeting` — professional redirect page with founder photo, title, qualifications, "What to expect" checklist, booking calendar button (opens new tab). All text editable from FounderEditor. Booking URL from `page_sections` team content |
| **Email System** | ✅ Complete | Resend, 11 templates all using `baseLayoutBranded()` (async, DB-driven logo/signature/footer/color via email_branding table). No personal names in signatures |
| **Live Session Email Automation** | ✅ Complete | Auto-announcement on publish (or manual), 24h + 1h reminders (cron daily 6AM UTC — Hobby plan limit), recording-available email, 4 CMS-editable templates with placeholders, test send, admin Email Settings page |
| **Apps Script Integration** | ✅ Complete | Register student, fetch registration ID, attendance |
| **REFM Module 1 — Project Setup** | ✅ Complete | Timeline, Land & Area, Dev Costs, Financing |
| **Excel / PDF Export (REFM)** | ✅ Complete | exceljs static + formula, @react-pdf/renderer |
| **REFM Modules 2–11** | ❌ Not Started | Stubs/placeholders only |
| **AI Agents** | 🔄 In Progress | Market rates + research wired; contextual help stub |
| **Pricing / Subscriptions** | 🔄 In Progress | Plans + features in DB; enforcement partial |
| **White-label / Branding** | 🔄 In Progress | DB-driven config; BrandingThemeApplier wired |
| **Modeling Hub — Coming Soon Mode** | ✅ Complete | Admin toggle on /admin/modules, signin/register show coming soon page when enabled, bypass via ?bypass=true, API: /api/admin/modeling-coming-soon |
| **Modeling Hub — Platform Sub-pages CMS** | ✅ Complete | CMS-editable via `modeling-{slug}` pattern, Real Estate fully seeded (071-072), other platforms auto-setup from admin |
| **CMS — Universal Paragraphs** | ✅ Complete | ParagraphsEditor on every section type, per-paragraph alignment (L/C/R/J), CmsParagraphs shared renderer, backward-compat string[] + {text,align}[] |
| **CMS — LinkedIn on Testimonials** | ✅ Complete | Blue LinkedIn button with SVG icon on training testimonial cards |
| **YouTube Player + Subscribe** | ✅ Complete | YT IFrame API player (replaces raw iframe), styled subscribe banner, like button (admin-toggleable via show_like_button), watch completion tracking (50 pts) |
| **YouTube Comments Cache** | ✅ Complete | Server-side proxy fetches comments via YouTube Data API v3, caches in youtube_comments_cache table (24h TTL), empty state shows "Be the first to comment" CTA |
| **Watch Progress Indicators** | ✅ Complete | Green "Watched" badge on live session cards, watch-history API, session_watch_history with status + watch_percentage columns |
| **BVM / FPA / other platforms** | ❌ Not Started | Config defined, no content |

---

## Quiz / Assessment Architecture

### Flow
```
LOAD  -> GET Apps Script getQuestions -> questions + correctAnswer stored in state
TAKE  -> student picks answers -> stored in state
SCORE -> client compares answers[i] vs questions[i].correctAnswer -> score calculated
SAVE  -> POST /api/training/submit-assessment -> { tabKey, email, regId, score, passed, isFinal, attemptNo }
DONE  -> show results (pass: question review + explanations; fail: retry screen only)
```

### Key rules
- **Never re-fetch questions during submission** — scoring is 100% client-side
- `/api/training/submit-assessment` accepts pre-scored data only, forwards to Apps Script
- `/api/training/questions` normalizes field names: `correctAnswer`, `answer`, `correctIndex` all mapped to `correctIndex`; `explanation` field passed through
- Question Review shown **only on pass** (score >= 70%); fail screen shows "Keep Practicing!" + "Try Again"
- After submission, dashboard receives optimistic update via sessionStorage + `?refresh=1` cache bust

### Shuffle settings (training_settings DB)
| Key | Default | Purpose |
|-----|---------|---------|
| `shuffle_questions_3sfm` | true | Randomize question order |
| `shuffle_questions_bvm` | true | Randomize question order |
| `shuffle_options_3sfm` | false | Randomize A/B/C/D option order |
| `shuffle_options_bvm` | false | Randomize A/B/C/D option order |

- API: `GET /api/training/assessment-settings?course=3sfm`
- Toggles in admin Course Manager header (alongside Timer Bypass)
- Option shuffling is client-side with correctIndex remapping before display
- `?shuffle=false` passed to Apps Script `getQuestions` when shuffleQuestions is OFF

### Admin Reset Attempts
- Admin -> Students -> Progress modal -> **Reset Attempts** tab
- Course selector (3SFM/BVM) + Session selector dropdown
- API: `POST /api/admin/reset-attempts` -> Apps Script `apiResetAttempts`
- Clears score column in progress sheet, recalculates summary

---

## Badge Editor — Server Rendering

### What doesn't work on Vercel (DO NOT USE)
| Approach | Why it fails |
|----------|-------------|
| SVG `<text>` composite via sharp | sharp silently drops `<text>` elements |
| Sharp Pango `sharp({ text: ... })` | Font size ignored on Vercel (always 12px) |
| Embedded woff2 base64 in SVG | librsvg can't render woff2 |
| Embedded TTF base64 in SVG | 2.7MB SVG chokes librsvg |
| `@resvg/resvg-js` | Native binary — webpack can't bundle .node files |

### What works (current implementation)
**Satori + Sharp:**
1. `satori` renders text as SVG with Inter font (fetched from Google Fonts, cached in memory)
2. `sharp(Buffer.from(satoriSvg)).resize(w, h).png().toBuffer()` converts SVG to PNG
3. `sharp(badge).composite([{ input: textPng }])` composites text onto badge

### Key parameters
- Font: Inter TTF from Google Fonts (324KB, cached)
- Font size: `badgeSettings.fontSize * 2.5` (editor 14 -> render 35px)
- Centering: `display: 'flex', justifyContent: 'center'` (satori uses flexbox, not textAlign)
- Y position: `top = badgeHeight - yFromBottom - renderSize`
- No `transform: undefined` — use conditional spread: `...(condition ? { transform: value } : {})`
- `serverExternalPackages: ['satori']` in next.config.ts

---

## Transcript PDF — ASCII-only rule

PDF fonts (Helvetica) cannot render emojis or extended Unicode. All transcript text must be pure ASCII (chars 32-126).

| Character | Replaced with | Reason |
|-----------|---------------|--------|
| check mark (U+2713) | removed | Garbled in PDF |
| hourglass (U+231B) | removed | Garbled in PDF |
| em dash (U+2014) | `-` (hyphen) | Not in Helvetica |

### Banner colors
| Status | Background | Border | Text |
|--------|-----------|--------|------|
| Complete | `#F0FFF4` (green) | `#BBF7D0` | `#166534` |
| In Progress | `#EFF6FF` (blue) | `#93C5FD` | `#1E3A5F` |

### Filename convention
Format: `FMP-Transcript-FMP-{COURSE}-{YEAR}-{SERIAL}.pdf`
Construction: `regId.split('-')` -> `["FMP","2026","0001"]` -> `FMP-${courseCode}-${year}-${serial}`

---

## Training Hub Sign-in — OTP Consistency

### Key rule
The email used to STORE the OTP must be the EXACT SAME email used to VERIFY it.

### Flow
- **Email input**: validate resolves regId -> OTP sent to email -> verified with same email
- **RegID input**: validate resolves email from DB -> OTP sent to resolved email -> verified with resolved email
- `deviceEmail` state always set from `json.email.toLowerCase()` from validate API response
- `isDeviceTrusted()` checks by email (not regId)
- `trustDevice()` stores by email.toLowerCase() (not regId)

### Files
- `app/training/signin/page.tsx` — client OTP flow
- `app/api/training/validate/route.ts` — `isDeviceTrusted(cookie, email, 'training')`
- `app/api/training/device-verify/route.ts` — `trustDevice(email.toLowerCase(), 'training')`

---

## Live Session Registration Flow

### Student flow
```
Email notification -> [View & Register] -> Session detail page
-> [Register for This Session] -> Confirmation email sent
-> "You're registered!" + countdown -> Join link appears 30 min before
-> [Join Session Now] -> Teams/Zoom
```

### Key rules
- Join link NEVER shown on list page — only on detail page after registration + 30 min before
- List page shows `[View & Register]` linking to detail page
- `session_registrations` table tracks who registered + attendance
- Registration count shown publicly

### Calendar dropdown
Single `[Add to Calendar]` dropdown: Google Calendar, Outlook, Yahoo, Apple (.ics)

### Admin features
- Registrations modal: student list, "Mark All Present", "Export CSV"
- `registration_required` and `show_join_link_minutes_before` settings

---

## Student Dashboard Redesign

### Architecture
Dashboard (`app/training/dashboard/page.tsx`) has two view modes:
- **'overview'**: Landing page with hero, stats, quick actions, session banner, course cards, live preview, achievements
- **'course'**: CourseContent component (sessions, assessments, notes, video player)

### URL Routing
- `/training/dashboard` — overview (default)
- `/training/dashboard?course=3sfm` — directly opens course view
- View switches update URL via `window.history.replaceState()`

### Collapsible Sidebar
- Expanded: 240px / Collapsed: 56px with tooltips
- `localStorage` key: `fmp_sidebar_collapsed`
- Mobile: off-canvas overlay with hamburger + backdrop

### Mobile Bottom Navigation
Fixed bottom bar (56px): Home, Courses, Live, Achieve, Profile

---

## Public Training Sessions

### Routes (no auth required)
| Route | Purpose |
|-------|---------|
| `/training-sessions` | Public list (hero, filter, grid cards) |
| `/training-sessions/[id]` | Public detail (countdown, CTA, instructor) |
| `/api/public/training-sessions` | Public API: list with reg counts |
| `/api/public/training-sessions/[id]` | Public API: detail + related |

### Key Rules
- **NEVER expose** `live_url` or `live_password` on public API routes
- `youtube_url` only exposed for recorded sessions (not upcoming)
- Non-logged-in CTAs redirect to `/register?redirect=/training/live-sessions/[id]`

### Learn Homepage Integration
- `UpcomingSessionsPreview` on `app/training/page.tsx` — up to 3 upcoming sessions
- Auto-hides if no upcoming sessions exist

---

## CFI-Style Course Player System

### CoursePlayerLayout (`src/components/training/player/CoursePlayerLayout.tsx`)
Full-page immersive layout for watching training sessions and certification videos:
- **Left sidebar**: Navy background, session list with checkmarks/numbers, back link
- **Top bar** (`CourseTopBar.tsx`): Session title, action icons (Subscribe, Like, Ask Question, Share), Mark Complete button, Take Assessment button, Continue link
- **Main area**: Two states — Screen 1 (session info + "Watch Session" button) and Screen 2 (embedded YouTubePlayer + comments panel)
- **Right panel**: YouTube comments (desktop only, when video open)
- **Mobile**: Single column, sidebar below content

### Certification Watch Page (`app/training/watch/[courseId]/[sessionKey]/page.tsx`)
- Embedded video player for certification course sessions (3SFM, BVM)
- Timer starts on play, `onNearEnd` triggers Mark Complete 20s before video ends
- Two-step flow: Mark Complete → Take Assessment
- Progress restored from `progressMap` (DB-backed via `/api/training/progress`)
- Timer bypass support from `training_settings` DB key `timer_bypass_enabled`
- Dashboard SessionCard "Watch Video" links to internal watch page (not external YouTube)

### Student Notes (`src/components/training/StudentNotes.tsx`)
- Per-session private notes with bold/bullet toolbar
- Auto-save on blur via `POST /api/training/session-notes`
- Table: `session_notes` (session_id + student_email UNIQUE)

### Subscribe Modal (`src/components/training/SubscribeModal.tsx`)
- Clean modal with YouTube subscribe link (`?sub_confirmation=1`)
- No Google widget dependency — simple reliable button

### Welcome Modal (`src/components/training/WelcomeModal.tsx`)
- First-visit modal with YouTube + LinkedIn buttons
- Configurable `storageKey` prop (default `fmp_welcomed`, Training Hub uses `fmp_hub_welcomed`)
- Shows on Training Hub pages + public training sessions pages

### Follow Popups (`src/components/shared/FollowPopup.tsx`)
- LinkedIn + YouTube buttons in: main site footer, Training Hub sidebar, post-complete popup, 60s video popup, site-wide 60s popup
- sessionStorage dedup, auto-dismiss, configurable

### Live Sessions as Dashboard Tab
- `LiveSessionsContent.tsx` extracted as reusable component
- Dashboard `?tab=live-sessions` renders it inline (no page navigation)
- `/training/live-sessions` redirects to dashboard tab
- Search filter for sessions by title

### Training Hub Header
- CMS logo fetched client-side from `/api/cms?section=header_settings&keys=logo_url,logo_height_px`
- `minHeight` instead of fixed height (logo doesn't clip)
- "Training Hub" green badge beside logo
- Live Sessions sidebar accordion with Upcoming/Recordings groups + counts

---

## Share Experience & Testimonial System

### ShareExperienceModal (`src/components/shared/ShareExperienceModal.tsx`)
3 Tabs: Written Review (star rating, LinkedIn URL), Video Testimonial (Loom/YouTube), Social Share (LinkedIn/Twitter/WhatsApp/Copy)

### Integration Points
- Dashboard sidebar: "Share Experience" item
- Dashboard achievements: "Share Your Experience" button
- Dismissable banner when `totalPassed >= 1` (localStorage: `fmp_share_banner_dismissed`)
- TrainingShell sidebar link to `/training/submit-testimonial`

### Validation
- LinkedIn URL: must match `linkedin.com/in/` pattern
- Video URL: must match `loom.com` or `youtube.com` or `youtu.be`
