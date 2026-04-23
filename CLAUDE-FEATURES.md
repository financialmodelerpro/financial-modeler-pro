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
| **Training Hub — Certificate System** | ✅ Complete | Inline fire-and-forget issuance the moment a final exam passes (no cron). Internal pdf-lib PDF gen, sharp badge overlay, Supabase storage, `email_sent_at` delivery tracking (migration 124), admin safety-net panel "Eligible but not issued" + `✉ Resend Email` for unsent rows |
| **Training Hub — WhatsApp Group Link** | ✅ Complete (migration 123) | Admin sets a `https://chat.whatsapp.com/` invite URL via `/admin/training-settings` (validated before save). When non-empty, the dashboard sidebar renders a green "Join WhatsApp Group" button beside the LinkedIn + YouTube CTAs in both expanded and collapsed states; empty value hides the button entirely. Public read via `GET /api/training/community-links` with server-side URL-shape re-validation so a malformed DB value can never leak to students. |
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
| **CMS — Book a Meeting Page** | ✅ Complete | `/book-a-meeting` — Calendly inline embed (no redirect). Founder card header, "What to expect" checklist, Calendly widget, email + WhatsApp direct contact options, "Back to Founder Profile" link. Widget URL from `page_sections.team.content.booking_url` (admin editable). Component: `src/components/booking/CalendlyEmbed.tsx` — dynamic script load, guarded against duplicate injection. |
| **Email System** | ✅ Complete | Resend, 11 templates all using `baseLayoutBranded()`. All 3 remaining triggers migrated from Apps Script to Next.js: quizResult (submit-assessment), registrationConfirmation (confirm-email), lockedOut (submit-assessment when max attempts). `/api/email/send` bridge kept for backwards compat. **Admin Communications** (`/admin/training-hub/communications` Send Campaign) also goes through Resend `batch.send` + `baseLayoutBranded()` (2026-04-23) - previously delegated to Apps Script `sendAnnouncement`, which sent raw text without the brand wrapper, no logo, no signature, and silently logged a fake 'sent' status when Apps Script was unreachable. Per-recipient outcomes now drive the `training_email_log.status` column (sent / failed) instead of a blanket 'sent'. `{name}` token in the body resolves to the recipient's first name. |
| **Live Session Email Automation** | ✅ Complete | Auto-announcement on publish (or manual), 24h + 1h reminders (cron daily 6AM UTC - Hobby plan limit), recording-available email, 4 CMS-editable templates with placeholders, test send, admin Email Settings page |
| **Live Session Announcement Reliability** | ✅ Complete (migration 138, 2026-04-22) | Rebuilt end-to-end after a 4-of-9 partial failure during testing. `sendEmailBatch()` in `src/lib/email/sendEmail.ts` wraps Resend's `batch.send([...])`: one HTTP request per 100 recipients, one rate-limit slot instead of 10 parallel bursts. New child table `announcement_recipient_log` (migration 138) with per-recipient `status` (pending/sent/failed/bounced/complained), `resend_message_id`, per-row `error_message`, partial index on failed rows. Notify route seeds all recipients as `pending` before the batch fires, UPDATEs each to `sent` or `failed` from the response, recomputes aggregate counts on the parent `announcement_send_log` row so retries reflect reality. Two new POST modes: `recipientEmails: string[]` (explicit picker allowlist + test-send), `retrySendLogId: string` (re-attempt only the failed/bounced rows of a prior dispatch, in place on the same audit row). Course filter `target: '3sfm'\|'bvm'\|'all'` now actually wires through a `training_enrollments` JOIN - the "decorative filter" comment in the route is gone. Admin picker modal (`/admin/training-hub/live-sessions` → Send Announcement): search bar, course filter pills, per-row checkboxes, "Send to myself only", "Select all (filtered)", "Clear selection", "Preview to my inbox"; after send switches to per-recipient status table with pills + CSV export + "Retry N Failed" that only re-sends the bad rows. Announcement email template no longer leaks the Teams join URL - the "Direct join link" footnote was removed, replaced with "Register to get the join link, calendar invite and session materials"; registered students still get the link via `registrationConfirmationTemplate` + reminder emails. |
| **Teams Calendar Integration (real Outlook events + host invite)** | ✅ Complete (2026-04-22, commits 698f991 + 8db26e8) | Switched from `POST /users/{id}/onlineMeetings` (URL-only meeting) to `POST /users/{id}/events` with `isOnlineMeeting:true` + `onlineMeetingProvider:"teamsForBusiness"` so Outlook: (a) writes a calendar entry on the host's Outlook/Teams calendar, (b) creates the Teams meeting + auto-renders the Join button in the event body, (c) fires the standard "Microsoft Teams meeting" invitation email to the organizer. Requires Azure `Calendars.ReadWrite` (Application) with admin consent (added to the tenant 2026-04-22, `~30 min` propagation). New helpers in `src/lib/integrations/teamsMeetings.ts`: `createCalendarEventWithMeeting`, `updateCalendarEvent`, `deleteCalendarEvent`, `toGraphDateTime` (UTC ISO → Graph `dateTimeTimeZone` via `sv-SE` locale, `Asia/Karachi` default). Backwards-compatible wrappers `updateMeetingOrEvent` / `deleteMeetingOrEvent` try `/events` first and fall back to legacy `/onlineMeetings` on 404, so pre-migration session rows (whose `teams_meeting_id` holds an online-meeting id, not an event id) remain editable and deletable with no DB migration. Two follow-up fixes (commit 8db26e8): stopped sending `body` on POST + PATCH because custom body suppresses Outlook's auto-injected Teams Join block; added the host as a single `required` attendee because empty `attendees[]` makes Outlook skip the invitation email. Legacy `createTeamsMeeting` / `updateTeamsMeeting` / `deleteTeamsMeeting` stay in the file as the fallback leg of the wrappers. |
| **Modeling Hub - Admin Post-Login Bypass** | ✅ Complete (2026-04-22, commit 6c29bf5) | Before this fix, `ensureNotComingSoon('modeling')` in `src/lib/shared/comingSoonGuard.ts` redirected every visitor to `/signin` regardless of admin role - so even admins who logged in successfully were bounced back to "Launching Soon" the moment they hit `/refm` or any other gated `/modeling/*` segment. The guard now resolves NextAuth session server-side and bypasses redirect for `role === 'admin'` OR `isEmailWhitelisted(email)`. `/modeling/signin` + `/modeling/register` pages additionally auto-redirect already-logged-in admins (and any authed user when the toggle is off) straight to `/modeling/dashboard` so the CS page is never rendered for a valid session. The dashboard's stale-session bounce-back now uses `/signin?bypass=true` so a returning admin with expired JWT lands on the real sign-in form instead of the CS countdown. Training Hub guard behavior unchanged (still redirects non-bypassed visitors to `/signin`). |
| **Course Player Sidebar - Collapse + Mobile Drawer** | ✅ Complete (2026-04-22, commit ef29a01) | `CoursePlayerLayout` sidebar previously rendered full-width below the video on mobile (eating the first viewport) and was always-on at 240px on desktop. Desktop now has a collapse/expand chevron in the sidebar header that shrinks the rail from 240px to 64px (icon-only mode, tooltips from the `title` attr); preference persisted in `localStorage['fmp_player_sidebar_collapsed']`. Mobile (<768px) turned into an off-canvas drawer (`left: -300px → 0` transition, `box-shadow`, z-index above the backdrop); opened via a navy "Sessions (N)" pill at the top of the content area, closed by tapping the backdrop or the X button, auto-closes on session navigate (`useEffect` watching `currentSessionId`) so the student never lands on the next video with the drawer still covering it. |
| **Course Player - Mobile Video Fix** | ✅ Complete (2026-04-22, commit 2282e47) | Students reported the video iframe was "missing" on phones even though the top bar, notes, and comments panels all rendered. Root cause: the Screen-2 video wrapper set `aspectRatio: 16/9` while wrapping `YouTubePlayer` which already uses a padding-bottom 56.25% trick (`height: 0`). With no explicit width and a height-zero child, the aspect-ratio resolved to a 0x0 box inside the mobile flex column - iframe loaded but was invisible. Fixed by replacing the wrapper with `width: 100%, background: #000` and letting YouTubePlayer's own responsive container handle 16:9. Also added a mobile-only `useEffect` that auto-opens `videoOpen` so the player is the first content the student sees (desktop still shows Screen 1 banner + description + click-to-watch). `CourseTopBar` action buttons are now `flexWrap: wrap` to stop horizontal overflow of 6+ action buttons on 375px viewports. Cascades automatically to `/training/watch/*`, `/training/live-sessions/*`, and the public `/training-sessions/*` detail since all three use `CoursePlayerLayout`. |
| **Platform Walkthrough Video** | ✅ Complete (2026-04-22, commit 16dee47 + afe167c + b9e7201) | Admin pastes a YouTube / Vimeo / generic URL into `/admin/training-settings` under the new "🎥 Platform Walkthrough Video" card. Stored in `training_settings.platform_walkthrough_url` - no migration, the existing K/V table absorbs new keys natively. Button renders in the Training Hub dashboard hero's right column (flex row with welcome text on the left) so it does not add vertical height; gold gradient (`#C9A84C → #D4AF37`, navy text) to match the Points stat / 100%-progress / Certified-badge accent already in use. Click opens a fullscreen modal with an embedded iframe: YouTube IDs route through `youtube-nocookie.com/embed/{id}?autoplay=1&rel=0&modestbranding=1` (no cookies, no related-video end screen); anything else (Vimeo / self-hosted) gets a generic iframe of the URL plus a fallback "Trouble loading? Open in new tab →" rescue link. Modal closes on Escape / X / backdrop tap. Empty URL = button hidden, no broken or disabled state. Public read: `GET /api/training/community-links` extended to also return `platformWalkthroughUrl` alongside `whatsappGroupUrl` with server-side URL-shape re-validation. |
| **Apps Script Integration** | ✅ Complete | Register student, fetch registration ID, attendance |
| **REFM Module 1 — Project Setup** | ✅ Complete | Timeline, Land & Area, Dev Costs, Financing |
| **Excel / PDF Export (REFM)** | ✅ Complete | exceljs static + formula, @react-pdf/renderer |
| **REFM Modules 2–11** | ❌ Not Started | Stubs/placeholders only |
| **AI Agents** | 🔄 In Progress | Market rates + research wired; contextual help stub |
| **Pricing / Subscriptions** | 🔄 In Progress | Plans + features in DB; enforcement partial |
| **White-label / Branding** | 🔄 In Progress | DB-driven config; BrandingThemeApplier wired |
| **Modeling Hub — Coming Soon Mode** | ✅ Complete | Originally a single `modeling_hub_coming_soon` toggle; as of migration 136 replaced by split signin + register toggles (see row below). Legacy API `/api/admin/modeling-coming-soon` still live for backward compat. |
| **Modeling Hub - Pre-Launch Lockdown + Access Whitelist** | ✅ Complete (migrations 136 + 137) | Replaces the single-toggle model with two independent Coming Soon controls (signin / register) plus a real `modeling_access_whitelist` table so admins can grant individual email bypasses with a UI instead of editing a CSV string. Gating chain threads the same predicate into every entry point: `canEmailSigninModeling` gates NextAuth `authorize()` (admin role still short-circuits), `canEmailRegisterModeling` gates `/api/auth/register` (403 with "invite-only" copy) + `/api/auth/confirm-email` (redirects to `/signin?error=invite-only` for stale tokens). Server pages: `/modeling/signin` renders `ModelingComingSoon(variant='signin')` when the signin toggle is on (bypass via `?bypass=true`); `/modeling/register` renders `ModelingComingSoon(variant='register')` when the register toggle is on, with a cleaner admin share flow - `?email=whitelisted@address` server-verifies the whitelist and renders the form with a locked, green-pill "✓ Invited" email input so the API-side whitelist check can't be sidestepped. Admin surface: two `LaunchStatusCard`s on `/admin/modules` (Sign In + Register), dedicated whitelist UI at `/admin/modeling-access` (add-email form with optional note, Revoke per row, toggle-state summary + preview links), sidebar nav entry 🔑 Access Whitelist under Modeling Hub, info banner on `/admin/users` warning that adding a user there does NOT grant access. Migration 136 also deletes six unauthorized accounts that slipped in pre-lockdown with a full `admin_audit_log` trail. |
| **Modeling Hub - Register Page UX (Coming Soon + Invite Path)** | ✅ Complete (2026-04-21) | Previously the register form rendered on every visit with the API as the only gate, so strangers filled out the whole form before getting a 403. Now matches the signin pattern exactly: toggle OFF → form for everyone; toggle ON + no params → `ModelingComingSoon(variant='register')` UI with countdown + "Have an invite? Register here →" link; toggle ON + `?bypass=true` → form (QA escape hatch, API still gates); toggle ON + `?email=whitelisted@address` → server-verified invite path, form renders with email pre-filled + locked. New files: `app/modeling/register/ComingSoonWrapper.tsx` (mirrors the signin wrapper). `RegisterForm` gained optional `invitedEmail` prop + green-pill "✓ Invited" affordance. |
| **Modeling Hub — Platform Sub-pages CMS** | ✅ Complete | CMS-editable via `modeling-{slug}` pattern, Real Estate fully seeded (071-072), other platforms auto-setup from admin |
| **CMS — Universal Paragraphs (legacy)** | ⚠️ Superseded | ParagraphsEditor DELETED 2026-04-18 (Phase 2A). The universal Tiptap RichTextarea now handles multi-paragraph body text natively (Enter → new `<p>`). Orphan `content.paragraphs[]` DB rows are harmless (unread). `CmsParagraphs` renderer still exists for backward compat. |
| **CMS — Universal CmsField Rendering (Phase 1)** | ✅ Complete | `src/components/cms/CmsField.tsx` is the ONLY way CMS text reaches the frontend. Handles `{field}_visible` / `{field}_align` / `{field}_width` / HTML detection / `.fmp-rich-text` class / plain-text paragraph splitting. All 21 section renderers + home/training/modeling/modeling-[slug]/ahmad-din/book-a-meeting/contact inline blocks use it. Enforcement rules in CmsField docstring + CLAUDE.md. |
| **CMS — Universal Rich Text Editor (Phase 2A)** | ✅ Complete | `RichTextarea` rewritten as Tiptap editor (StarterKit + Underline + Link + Color + TextStyle + custom FontSize mark). Selection-based floating toolbar with B / I / U / S, font size, color presets, lists, link, clear formatting. Enter → new `<p>`, Shift+Enter → `<br>`. Used on 17+ fields (hero subtitle/power/trust, text body, text_image body, cta subtitle, faq answer, pacemakers desc/desc2, countdown subtitle, founder bio/long_bio/philosophy, cards descriptions, testimonials quotes, team bios, list items, timeline descriptions, pricing descriptions, founder projects). |
| **CMS — Array Item VF (Phase 2B)** | ✅ Complete | `ItemVF` + `ItemBar` helpers in page-builder. Per-item visibility + alignment + width + delete on every array editor (cards, testimonials, team, faq, list, timeline, pricing tiers, logo grid, founder projects). TwoPlatforms column VF keys now stored INSIDE `columns[i]` (was top-level `col{i}_*`, broken). Frontend renderers filter `item.visible !== false`. Migration 097 backfills legacy TwoPlatforms keys. |
| **CMS — Book a Meeting (Calendly Embed)** | ✅ Complete | See "CMS — Book a Meeting Page" row. |
| **CMS — LinkedIn on Testimonials** | ✅ Complete | Blue LinkedIn button with SVG icon on training testimonial cards |
| **YouTube Player + Subscribe** | ✅ Complete | YT IFrame API player (replaces raw iframe), styled subscribe banner, like button (admin-toggleable via show_like_button), watch completion tracking (50 pts) |
| **YouTube Comments Cache** | ✅ Complete | Server-side proxy fetches comments via YouTube Data API v3, caches in youtube_comments_cache table (24h TTL), empty state shows "Be the first to comment" CTA |
| **Watch Progress Indicators** | ✅ Complete | Green "Watched" badge on live session cards, watch-history API, session_watch_history with status + watch_percentage columns |
| **Training Hub — Certification Watch Tracking** | ✅ Complete | certification_watch_history table tracks video in_progress/completed. Gates "Take Assessment" on dashboard. Watch page writes on play + Mark Complete |
| **Training Hub — Watch Enforcement (70% rule)** | ✅ Complete (migration 103) | Client-side interval-merging tracker (`src/lib/training/watchTracker.ts`) — seeking/re-watching can't inflate counted seconds. YouTubePlayer reports `onProgress(watchedSec, totalSec, pos)` ~every 10s; watch page posts to `/api/training/certification-watch` which takes MAX(existing, incoming) server-side + wall-clock rate limit. Mark Complete gated via `canMarkComplete = nearEnd && (thresholdMet || bypass)` where `nearEnd = pos >= total-20 || videoEnded` (2026-04-21). Progress bar above Mark Complete shows current % / threshold with color. Admin toggles live on `/admin/training-settings`. Admin UI lists sessions as a dynamic union of COURSES + tab_keys seen in watch history (new sessions inherit enforcement automatically). NextAuth admin users always bypass. Dashboard session cards display a thin watch progress bar with same color logic. Certificate engine (`verifyWatchThresholdMet`) gates cert issuance on watch threshold being met per session, grandfathering pre-migration data. **Student-facing surfaces hide the threshold percentage** — the rule exists to gate progression, not to be advertised (2026-04-21). |
| **Training Hub — Watch Resume / Continue** | ✅ Complete (2026-04-21) | `playerVars.start` restores the student's `last_position` across logout/login and different devices on both watch pages. `YouTubePlayer.startSeconds` prop + `CoursePlayerLayout.resumePositionSeconds` threaded from the watch-record GET. Clamps: `status='completed'` → resume at 0 (rewatch from beginning); `last_position ≤ 10s` → skip seek; `last_position ≥ total − 30s` → skip seek (YT's `start` param loops back to 0 past-end); null/missing → 0. Tracker floor (`Math.max(prev, baselineWatchedSec, watchedSec)`) preserves threshold credit across reloads — the resume only moves the playhead; watched-seconds never drops. |
| **Training Hub — Video Swap Auto-Reset** | ✅ Complete (2026-04-21) | `src/lib/training/detectVideoChange.ts` → heuristic `abs diff > 30s AND relative diff > 10%` on `existing vs incoming total_seconds`. Applied inside both watch endpoints (`POST /api/training/certification-watch` + `POST /api/training/live-sessions/[id]/watched`). On verdict `changed=true`: reset `watch_seconds`/`total_seconds` to incoming, demote `status='in_progress'`, clear `completed_at`/`watched_at`/`points_awarded`/`last_position`. Admin-only nuclear reset at `POST /api/admin/sessions/[tabKey]/reset-watch-progress` routes by prefix (`LIVE_<uuid>` → session_watch_history; else → certification_watch_history). Red "Reset Watch Progress" buttons in both session editors (uses `window.confirm` because the live-sessions admin page shadows `confirm` with state). |
| **Training Hub — Interactive Onboarding Tour** | ✅ Complete (migration 120) | `driver.js@^1.4.0` walkthrough on first dashboard visit — react-joyride rejected React 19 peer dep. Component: `src/components/training/DashboardTour.tsx`. Highlights sidebar nav, courses, live sessions, profile menu, share button via `data-tour="…"` attrs on real UI (no fake overlays). State: `training_registrations_meta.tour_completed` (migration 120) — one-shot. API: `POST /api/training/tour-status` toggles it. Restart via profile dropdown's "Restart Tour" action. Copy avoids mentioning watch threshold percentage. |
| **Training Hub — Coming Soon Bypass List** | ✅ Complete (migration 121) | Fills the gap where Modeling Hub's NextAuth admin role skips the Coming-Soon gate in `authorize()` but Training Hub's cookie-based session has no role field. `training_settings.training_hub_bypass_list` — case-insensitive comma-separated emails OR registration IDs. Guard at `src/lib/shared/comingSoonGuard.ts` + lookup at `hubBypassList.ts`. Both `/training/signin` + `/training/register` server-gate. `PreLaunchBanner` on authed dashboard tells bypass-listed testers they're viewing a live build while the hub is still Coming Soon to the public. Admin UI to edit the list TBD — edit the row directly for now. |
| **Auto-Launch Cron (Coming Soon → LIVE)** | 🔒 Wired but disabled (migration 118) | Admins can schedule a Coming Soon → LIVE flip at `launch_date`. Settings seeded: `{training_hub,modeling_hub}_auto_launch` (default `'false'`) + `{hub}_last_auto_launched_at`. Route `GET /api/cron/auto-launch-check` flips `coming_soon='false'` + `auto_launch='false'` (one-shot) + audits `last_auto_launched_at=ISO` when `enabled && auto_launch && launch_date <= now()` (CRON_SECRET bearer required). **UI gated by `AUTO_LAUNCH_UI_ENABLED=false` in `LaunchStatusCard`** because Vercel Hobby only supports daily crons and launch-flip needs 5-min granularity to be useful. `vercel.json` cron entry rolled back. Manual toggles in `/admin/training-settings` + `/admin/modules` remain authoritative. Ship when we upgrade to Pro. |
| **Live Session Reminders — per-registration flags** | ✅ Complete (migration 122) | 24h + 1h reminder flags moved from per-session (`live_sessions`, migration 043) to per-registration (`session_registrations.reminder_{24h,1h}_sent`). Fixes the "late registrant never gets 24h reminder" bug where the session-level flag was already set by the first registrant. `/api/cron/session-reminders` + partial indexes on `false` rows keep the lookup cheap. Session-level `announcement_sent` stays on `live_sessions` ("don't remind about an unpublished session"). `src/lib/training/sessionAnnouncement.ts` centralizes the email build across cron + admin `/notify` + register endpoints. |
| **Mobile Responsiveness Pass** | ✅ Complete (2026-04-21) | C1-C9 Critical + I1-I18 Important issues resolved. CSS-only auto-collapse pattern `minmax(min(100%, Npx), 1fr)` used across grids. Hero, sticky headers, session cards, sidebar nav, mobile bottom nav, admin tables, forms, buttons all verified on 320px / 375px / 768px / 1024px viewports. |
| **Marketing Studio PNG Render Reliability** | ✅ Complete (2026-04-21) | `imageToDataUri` wrapped with a 5s AbortController — one slow upstream image URL used to stall the whole render past the serverless timeout and return "Failed to fetch". Added `maxDuration=60` on the render route + logs unresolved image count so a bad source is easy to identify. |
| **Share Template — `{hubUrl}` variable** | ✅ Complete (migration 119) | Soft-upgrade: 5 templates get `\n\nLearn more at {hubUrl}` appended (assessment_passed, achievement_card, live_session_watched, session_shared, daily_certifications_roundup) — but only when the existing text doesn't already mention the learn subdomain OR `{hubUrl}`. Admin edits preserved. `certificate_earned` intentionally excluded (already embeds `{verifyUrl}`). Idempotent. |
| **Share Template — hashtags mandatory + read-only preview** | ✅ Complete (2026-04-21) | Every share post now emits hashtags from `share_templates.hashtags` automatically appended to the body with `\n\n` + space-joined `#…` tokens. Student-side ShareModal preview textarea is read-only — students can't edit the merged text; admin edits on `/admin/training-hub/share-templates` are the single authority. LinkedIn clipboard always carries text + hashtags merged. |
| **Training Hub — Supabase Assessment Results** | ✅ Complete | training_assessment_results table (migration 090). Dual-write: Apps Script + Supabase. Progress route merges Supabase over Apps Script for instant dashboard updates. **Attempts counter is server-authoritative** — `submit-assessment` reads existing row's `attempts` and increments server-side, ignoring stale client `attemptNo`. `attempt-status` overlays Supabase row over Apps Script so the assessment page sees accurate attempt count at load. |
| **Training Hub — Assessment Timer Persistence** | ✅ Complete | `assessment_timer_${tabKey}_${attemptNo}` in localStorage records attempt start epoch. Page remount / navigate-away / reload resume from stored clock. If timer has expired while student was away → auto-submit with whatever answers were saved in `assessment_answers_${tabKey}`. Clock derived each tick from storage (no drift). `beforeunload` handler warns student while `pageState === 'taking'`. Cleared on manual or auto submit. |
| **Training Hub — Retake Flow** | ✅ Complete | `/api/training/certification-watch` POST guards against `'completed' → 'in_progress'` downgrade. Revisiting a watched video after a failed attempt no longer silently flips the row back to in_progress and hides the "Take Assessment" button. `'completed'` is now a terminal state. |
| **Training Hub — Universal Share Utility** | ✅ Complete | `shareTo(platform, { text, url, hashtags, onCopied })` in `src/lib/training/share.ts` — copies final text (with hashtags merged) to clipboard first, then opens the compose window. Platforms: `linkedin | whatsapp | twitter | copy`. LinkedIn always uses the plain feed composer (`/feed/?shareActive=true`) — never `share-offsite` — so the textarea's `@`-mentions survive paste and trigger LinkedIn tag suggestions. `<ShareModal>` wraps the utility and seeds its editable textarea with `text + hashtags` merged so students see exactly what the clipboard holds before clicking share. |
| **Training Hub — Share Templates System** | ✅ Complete (migrations 114-117) | Centralized admin-editable share text. Table `share_templates` + four `training_settings` keys drive every share button across the platform. `renderShareTemplate(template, vars)` pure function auto-normalizes `{course}` via `resolveCourseName()` (COURSES short-code → full title) and `formatShareDate()` (canonical `en-GB` long form). `useShareTemplate(key)` client hook with module-level cache + DEFAULT_TEMPLATES fallback. Admin page `/admin/training-hub/share-templates` with Global Mention Settings card (brand/founder handle inputs + `Prefix @` toggles + live preview) and per-template editor (title, textarea, variable-picker chips, hashtag chip editor, active toggle, live preview with SAMPLE_VARS). Per-template `mention_brand`/`mention_founder` columns kept for schema compat but ignored at render. Universal sink: CertificateImageCard + VerifyActions + SessionCard + LiveSessionCard(Large) + assessment results + CourseTopBar watch-page share. |
| **Training Hub — Daily Certifications Roundup** | ✅ Complete (migration 117) | `/admin/training-hub/daily-roundup` lets admin share one post per day celebrating every student who earned a cert that day instead of one post per student. Date picker (defaults today, capped at today) + `GET /api/admin/certificates/by-date?date=YYYY-MM-DD` returning every `cert_status='Issued'` row for the UTC calendar day. Per-student checklist with Select all / Clear; live preview rebuilds on every toggle. Template `daily_certifications_roundup` uses `{studentList}`, `{verifyLinks}`, `{count}`, `{date}` + global `{@brand}`/`{@founder}`. Share Roundup button opens the universal ShareModal. Pulls the latest admin-edited template from the public API on mount. Admin nav entry: 🎓 Daily Roundup under Training Hub. |
| **Verify Page — Inline Document Previews** | ✅ Complete | `/verify/[uuid]` on learn subdomain renders inline PDF + badge previews between the credential details grid and QR/actions row. 2-column layout: left stacks Certificate (4:3 PDF iframe, `#toolbar=0` hides browser chrome) + Badge (1:1 `<img>` with soft-gold radial backdrop); right column is the taller Transcript (3:4 PDF iframe, prefers pre-cached `transcript_url` for instant load). Navy header strip with gold/blue accent label + `Open Full ↗` + floating `⛶ View` mobile-fallback pill. Downloads + share buttons sit below the QR. Metadata pinned to learn via `app/verify/layout.tsx` (metadataBase + canonical + og:url) so LinkedIn preview cards always show learn.* in the footer. |
| **SEO — Subdomain-Correct OG Metadata** | ✅ Complete | Per-subdomain layouts override root's MAIN_URL defaults: `app/training/layout.tsx`, `app/modeling/layout.tsx`, `app/verify/layout.tsx` each pin `metadataBase`, `alternates.canonical`, and `openGraph.url` to their own host. Specific pages (e.g. `/verify/[uuid]`) further refine with full per-URL canonical. `robots.ts` adds `Allow: /api/og/` (longest-match wins over broader `/api/` disallow) so LinkedInBot / Twitterbot / WhatsApp can fetch the dynamic OG images. Universal rule: every page's `og:url` and canonical match its actual URL — share previews always point to the URL that was shared, never redirect preview to a parent page. |
| **SEO — Search Engine Verification (Google + Bing)** | ✅ Complete | `app/layout.tsx` metadata.verification carries both Google Search Console (`google: 'jfT1RuMQksYExlTJUB_dB5Jisp_BBw6XCHEihIb-0pc'`) and Bing Webmaster Tools (`other: { 'msvalidate.01': '914C3726459EF363BC996DD79F3CF8E7' }`). Renders `<meta name="google-site-verification">` + `<meta name="msvalidate.01">` sitewide; both auto-verify once Vercel redeploys. |
| **Dashboard — Upcoming Live Sessions Preview** | ✅ Complete | `LiveSessionsSection` on `/training/dashboard` shows upcoming-only (recordings live on `/training/live-sessions`). Grid capped at 3 cards (`slice(0, 3)` + `auto-fit, minmax(260px, 1fr)`), graceful 2/1 collapse on narrow viewports. Empty state: dashed-border placeholder with `CalendarClock` icon + `Browse recordings →` link (previously the block disappeared when nothing was upcoming). |
| **Training Hub — Achievement Card** | ✅ Complete | Dynamic OG image at `/api/training/achievement-image` (satori ImageResponse). Shows session, score, course, student name, reg ID, date. Logo from CMS (SVG→PNG via sharp). Admin-controlled logo height. **Context-aware for live sessions**: with assessment = green score circle + PASSED pill; without assessment = teal duration circle + ATTENDED pill, with session duration shown on both variants |
| **Training Hub — Share System** | ✅ Complete (superseded by Share Templates row above) | Every share surface now pulls from the centralized `share_templates` table via `useShareTemplate` + `renderShareTemplate`. SessionCard, CertificateImageCard, VerifyActions, LiveSessionCard(Large), assessment results, CourseTopBar watch-page share all use the same pipeline — admin edits template copy once, every button updates. Share modal textarea shows the merged text + hashtags exactly as they'll land on LinkedIn. |
| **OG Social Previews** | ✅ Complete | Per-domain OG banners: `/api/og` (learn), `/api/og/modeling` (app), `/api/og/main` (main site). CMS-driven hero text, logo from header_settings (sharp SVG→PNG). Assessment layout.tsx with dynamic OG tags per session |
| **Newsletter System** | ✅ Complete | Hub-segmented subscribers, admin compose (type selector + AI enhance), auto-notifications on publish, campaign history, unsubscribe per-hub |
| **Marketing Studio** | ✅ Complete (Phase 3A) | Canvas editor + 9 FMP platform presets grouped by category (YouTube / LinkedIn / Instagram / Facebook / Other / Custom) + 5 template variants (Session Announcement, Quote, Platform Launch, Achievement Spotlight, Article Promo). Variants swap layout while keeping dimensions; proportional scaling works across all aspect ratios (banner / landscape / square / portrait). Picker grouped by platform. Variant selector row under preset picker. Quick Fill (articles / live sessions / training) auto-populates by id-prefix match, works equally well on any preset or variant. Multi-platform parallel captions (LinkedIn / Instagram / Facebook / WhatsApp / Twitter / YouTube) with tone selector. Export to All Platforms ZIP. Saved designs sidebar with thumbnails + filter. Aspect-ratio lock, background library, react-rnd drag/resize, undo/redo, keyboard shortcuts. Migrations 100 + 101 + 102 (`variant_id` stored in existing `content` jsonb — no new migration) |
| **Newsletter — Auto Notifications** | ✅ Complete | Triggers on article publish, live session publish/recording. Admin toggle per event type. Duplicate prevention via unique index |
| **Legal Pages** | ✅ Complete | Privacy Policy, Terms of Service, Confidentiality & Terms (published), Refund Policy (draft). CMS-editable via Page Builder. Full PMBC legal entity details |
| **Founder Profile — Comprehensive** | ✅ Complete | Full career bio (Dallah, ACWA Power, PPP), Why FMP mission story, expertise/industry/market/personal sections. **All founder data now lives in `page_sections.team`** (home page team section). Legacy `founder_profile` table and `/admin/founder` standalone editor removed 2026-04-18 (migration 098 drops the table). Editing: Page Builder → Founder section (6 tabs). Hero contact (LinkedIn + Book a Meeting) + "Get in Touch" section at bottom of `/about/ahmad-din` with email/WhatsApp/LinkedIn/booking (admin-configurable in Booking Page tab). |
| **About Page Removed** | ✅ Complete | Standalone `/about` page deleted 2026-04-18. `/about/ahmad-din` (founder profile) is the single source. `next.config.ts` redirects `/about → /about/ahmad-din` permanently. Footer + nav entries updated. Migration 099 cleans up orphan `page_sections` / `cms_pages` rows. |
| **YouTube Engagement CTAs** | ✅ Complete | Subscribe/Like/Comment/Share on watch page, SupportBanner, comment count + Join Discussion CTA, motivational messaging |
| **Progress Badge Visual Upgrade** | ✅ Complete | Lucide-react icons in colored circles, certificate badge preview/download modal |
| **OG Image Font Loading** | ✅ Complete | Inter fonts (Regular/Bold/ExtraBold) loaded for satori, sharper LinkedIn previews |
| **CMS Rich Text Rendering** | ✅ Complete | Universal HTML detection in all section renderers, RichTextarea admin editor with floating toolbar, global .fmp-rich-text CSS |
| **Website Audit Fixes** | ✅ Complete | Em dashes → hyphens, footer cleanup, auth terminology, email taglines unified, legal pages linked |
| **Dashboard - Sidebar + Course View Cleanup** | ✅ Complete (2026-04-21) | Sidebar trimmed: per-course `3SFM Transcript` + `BVM Transcript` items removed (transcripts still reachable from the `CertificateImageCard` Download Transcript button, the course-header Progress Transcript button, and the dashboard quick-actions bar). Course view (`/training/dashboard?course=3sfm\|bvm`): extra `CertificateImageCard` that sat below `CourseContent` removed (was rendering every cert regardless of course - full cross-course cert displays). Inside `CourseContent` the fully-styled "Certificate Earned" card block was retired in favour of the canonical UI on the main dashboard's `#dash-achievements`; only the `Certificate Locked` (BVM pre-unlock) + `Certificate Not Yet Earned` placeholders remain. Main dashboard `#dash-achievements` transcript buttons block also removed; `transcriptToast` state retired, `downloadTranscript()` errors now route through the shared `dashToast` overlay. |
| **Dashboard - Cert-Aware Course View Placeholders** | ✅ Complete (2026-04-21) | `/api/training/certificate` now exposes `course_code` in `DashboardCert`; `Certificate` type gains optional `courseCode`. `CourseContent.find()` matches certs on `courseCode` (case-insensitive) with a free-form `course` fallback for legacy rows. Everywhere that used `finalPassed && courseCert` was downgraded to just `courseCert` because `progressMap.get(finalSession.id)?.passed` is unreliable for pre-migration students (missing final session row → false → cert-aware UI never fired). `certStatus` pill now returns `'Earned'` when cert exists; `isOfficial` transcript label true for cert-holders; View Certificate button renders for any cert and resolves href via cascade (`certPdfUrl` → `verificationUrl` → `certifierUrl` → `/verify/<id>`) so post-migration certs with empty `certifierUrl` still link correctly; Exam Prep Mode banner hidden once cert exists; banner waterfall reordered so the Share-Your-Certificate branch is checked first. Result: Ahmad (has both certs) no longer sees "Not Yet Earned" / "Ready for Final Exam" / "Exam Prep Mode" on either course view. |
| **Certificate Card - Two-Column Layout** | ✅ Complete (2026-04-21) | `CertificateImageCard` body reshaped from a vertical stack (~620px tall per cert) into a CSS grid with `grid-template-columns: repeat(auto-fit, minmax(240px, 1fr))`, 20px gap, `alignItems: 'start'`. Left column: student name, course, cert ID, issued date, QR card with "Scan to verify" + verify URL text. Right column: Download Certificate PDF (navy), Download Badge (gold), Download Transcript (blue), Share Certificate (LinkedIn blue), Verify Certificate ↗ (outlined), each full-width of the column. Container-width-aware collapse to 1 column under ~500px (mobile / narrow sidebars) without a viewport media query. Header, gradient body, Distinction/grade pill, Pending-state card unchanged. |
| **Certificate Card - Per-Card Data Binding Fix** | ✅ Complete (2026-04-21) | Critical launch-blocker: every `CertificateImageCard` fetched `/api/training/certificate-image?email=X` on mount and overwrote its parent-supplied `cert` prop with the response. That endpoint does `order by issued_at desc limit 1 maybeSingle()`, so on a dashboard with multiple cards the email path always returned the NEWEST cert - both 3SFM + BVM cards rendered the BVM row (same certificate_id, same QR, same PDF/badge/transcript/verify link). Clicking Download Certificate on the 3SFM card gave you BVM. Fix: card now fetches by `certId` (globally unique per cert); email fallback stays for any legacy cert that lacks an ID and now threads `courseCode` alongside. API gained optional `?courseCode=` filter for the email path as defense-in-depth. Dashboard caller introduces `sortedCertificates` (`{'3SFM': 0, 'BVM': 1, others 99}`) used in both the cert-cards map and the Certificate Badges grid so 3SFM renders first. Tile `courseLabel` also fixed - was `cert.course === '3sfm'` which never matched the prose value `/api/training/certificate` returns; now uses `courseCode` with regex fallback. |
| **Footer - Double-© Defensive Fix** | ✅ Complete (2026-04-21) | `SharedFooter` hardcoded `©` in the bottom row then rendered the CMS/prop copyright value after it, producing `© © 2026 ...` whenever the value already included the symbol (some CMS rows and `training-sessions/*` pass `\u00A9 YYYY ...`). Now strips any leading `©` / `&copy;` / `&#169;` plus surrounding whitespace from the rendered value (case-insensitive). Template still owns the literal `©` character so values without one still render correctly. Admin edits through `InlineEdit` save whatever they type and the strip re-applies on the next render - single-© invariant is self-healing. Zero caller/CMS changes required. |
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
- `/api/training/submit-assessment` accepts pre-scored data, writes to both Apps Script AND Supabase `training_assessment_results` (dual-write). Also sends quiz result email + locked-out email from Next.js
- **Server-authoritative attempt counter (2026-04-18):** `submit-assessment` reads the existing `training_assessment_results` row and increments `attempts = existing + 1` before writing. Client-side `attemptNo` is advisory only. `attempt-status` route overlays the Supabase row over Apps Script so the assessment page loads with the correct attempt count.
- **Timer persistence (2026-04-18):** `assessment_timer_${tabKey}_${attemptNo}` in localStorage records start epoch. Navigate-away/reload resumes the existing clock; expiry triggers auto-submit with saved answers; counts as the attempt. `beforeunload` warning active while `pageState === 'taking'`.
- `/api/training/progress` fetches from Apps Script, then merges Supabase results over the top (Supabase wins for any session it has data for — instant, no Apps Script delay)
- `/api/training/questions` normalizes field names: `correctAnswer`, `answer`, `correctIndex` all mapped to `correctIndex`; `explanation` field passed through
- Question Review shown **only on pass** (score >= 70%); fail screen shows "Keep Practicing!" + "Try Again"
- After submission, dashboard receives update via sessionStorage `fmp_last_submit` + `?refresh=1` cache bust. Supabase provides instant accurate data on server side

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

### Certificate Issuance (inline-triggered, migration 124)

Final-exam pass is the trigger. The old daily `/api/cron/certificates` route was deleted and its `vercel.json` schedule entry removed. Certificates now issue within seconds of the student clicking Submit on a passing final-exam attempt.

- **Primary path**: `app/api/training/submit-assessment/route.ts` fires `issueCertificateForStudent(cleanEmail, courseCode, { issuedVia: 'auto' })` as fire-and-forget when `didPass && isFinal === true`. The student's HTTP response returns immediately; PDF + badge render, Supabase Storage upload, DB insert, and the `certificateIssuedTemplate` email all run in the background. The courseCode is derived from the tab_key prefix (`BVM_*` → `BVM`, else `3SFM`) to stay consistent with the `training_assessment_results.course_id` derivation a few lines above.
- **Engine helper `issueCertificateForStudent(email, courseCode, options)`** lives in `src/lib/training/certificateEngine.ts`. Flow: skip if an `Issued` row already exists (cheap early-out), run `checkEligibility`, build the `PendingCertificate`, hand off to `issueCertificateForPending`. Safe to call multiple times because the unique index on `(LOWER(email), course_code)` from migration 111 is the hard DB guard.
- **Email delivery tracking**: `student_certificates.email_sent_at TIMESTAMPTZ NULL` (migration 124) is stamped after `sendEmail` resolves successfully in `issueCertificateForPending`. A null stamp means the cert was generated but the email never went out (Resend outage, bad address, template error). Surfaces as a yellow "Unsent" pill + `✉ Resend` button on `/admin/training-hub/certificates`. Partial index keeps the "needs resend" lookup constant-time.
- **Safety-net panel** at `/admin/training-hub/certificates`:
  - **🛟 Eligible but not issued** — queries `GET /api/admin/certificates/pending` which reads `certificate_eligibility_raw` where `final_passed=true` minus rows already `Issued` in `student_certificates`. Per-row `⚡ Issue Now` button fires `POST /api/admin/certificates/issue-pending { email, courseCode }`. Bulk `Issue All Pending` fires `POST /api/admin/certificates/issue-pending { all: true }` and reports `{ issued, skipped, failed }`.
  - **Email column** in the main cert table shows the `email_sent_at` pill state. `✉ Resend` button calls `POST /api/admin/certificates/resend-email { certificateId }` which rebuilds the template, sends, and stamps the column.
  - **Force-Issue** remains for explicit overrides (bypasses watch threshold; records `issued_via='forced'` + `issued_by_admin`). Distinct from "Issue Now" on the pending list which still runs the full eligibility gate.
- **Idempotency**: the inline trigger, the force-issue override, and the pending-list "Issue Now" button all resolve to `issueCertificateForPending` which does a SELECT-then-INSERT-or-UPDATE keyed by `(LOWER(email), course_code)`. Two concurrent calls are blocked by the unique index; the pre-check in `issueCertificateForStudent` avoids regenerating PDFs for already-issued students. Admin force-issue bypasses the pre-check because that entry point legitimately allows re-issuance.
- **Fix addresses** the pre-launch diagnosis RED findings: latency (was up to 24 hours via daily cron, now sub-minute inline), observability (was zero, now `email_sent_at` + pending panel give full visibility), and Apps Script coupling (the cron was the last place Apps Script polling still drove timing; the engine's Apps Script sync remains best-effort and non-blocking).

### Live Session Achievement Card (context-aware)

`/api/training/achievement-image` accepts two new query params that switch the right-side visual and add duration context on all live-session cards. 3SFM/BVM cards are unaffected because they never pass these params and the route defaults preserve the legacy score-circle render.

- **`has_assessment`**: `'true'` (default) renders the existing green score circle + `✓ PASSED` pill using `score`. `'false'` replaces the right column with a teal 200px circle showing the session duration in its native copy slot (e.g. `90 MIN` / `1H 30M`) plus a `✓ ATTENDED` pill, and swaps the top-left eyebrow from `🏆 Assessment Passed` to `🎓 Session Completed`.
- **`duration`**: integer minutes. Rendered on both variants. The number formats as `45 MIN` under 60 minutes, `2H` on the hour, `1H 30M` otherwise. On the with-assessment variant it appears as a clock-icon chip in the bottom meta row alongside the date + reg ID, so score + duration read cleanly side by side. On the without-assessment variant it becomes the hero stat inside the right circle; if duration is missing, the circle falls back to a 🎥 glyph so the card still looks intentional.
- **Call site**: `src/components/training/dashboard/LiveSessionCardLarge.tsx` `achievementCardUrl()` derives `has_assessment` from `session.has_assessment` (column added in migration 105) and `duration` from `live_sessions.duration_minutes`. Both flow into `ShareModal.cardImageUrl` for the student preview and share. Eligibility for the card is unchanged: with assessment requires a pass, without assessment requires watch ≥ threshold.
- **Backward compatibility**: omitting both params produces the exact same PNG as before (green score circle, no duration row, `🏆 Assessment Passed` eyebrow), so `SessionCard.tsx` (3SFM/BVM) and `/training/assessment/[tabKey]/layout.tsx` (OG metadata) continue to render unchanged without a code edit.

### WhatsApp Group Link (migration 123)
- Admin sets a `https://chat.whatsapp.com/` invite URL via `/admin/training-settings` (validated client-side before save, stored in `training_settings.whatsapp_group_url`, empty by default)
- When non-empty, the Training Hub dashboard sidebar "Follow Us" section renders a green "Join WhatsApp Group" button beside the LinkedIn + YouTube CTAs (expanded sidebar) and a compact icon button (collapsed sidebar); empty value hides the button entirely (no broken or disabled state)
- Public read: `GET /api/training/community-links` returns `{ whatsappGroupUrl }` after server-side re-validation of the URL shape, so a malformed DB value can never leak to students
- Opens in a new tab with `rel="noopener noreferrer"`

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
