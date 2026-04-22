# Pending Work & Backlog

> Referenced from CLAUDE.md - features not yet started or in progress.

---

## Recently Completed - Teams Calendar Rebuild + Announcement Reliability + Mobile Player (2026-04-22 session, commits `6c29bf5` → `8db26e8`)

| Feature | Status |
|---------|--------|
| **Modeling Hub - admin post-login bypass** | Complete (commit `6c29bf5`). `src/lib/shared/comingSoonGuard.ts` now resolves NextAuth session server-side and skips the redirect for `role === 'admin'` OR `isEmailWhitelisted(email)`. `/modeling/signin` + `/modeling/register` auto-redirect already-logged-in admins (and any authed user when the toggle is off) straight to `/modeling/dashboard`. The dashboard's stale-session bounce-back uses `/signin?bypass=true` so a returning admin with expired JWT lands on the real sign-in form instead of the CS countdown. Training Hub guard behavior preserved. |
| **Course player sidebar - collapse + mobile drawer** | Complete (commit `ef29a01`). Desktop chevron toggles 240px ↔ 64px rail, preference persisted in `localStorage['fmp_player_sidebar_collapsed']`. Mobile (<768px) turned into off-canvas drawer opened via navy "Sessions (N)" pill; backdrop/X dismisses; auto-closes on session navigate via `useEffect` watching `currentSessionId`. |
| **Mobile video iframe was missing** | Complete (commit `2282e47`). Root cause was a Screen-2 wrapper with `aspectRatio: 16/9` stacked over YouTubePlayer's own padding-bottom trick - collapsed to 0x0 inside the mobile flex column even though the iframe loaded. Fixed with `width: 100%, background: #000` wrapper. Also auto-opens `videoOpen` on mobile mount so video is the first content; `CourseTopBar` action row now `flexWrap: wrap` to stop horizontal overflow of 6+ action buttons on 375px. |
| **Platform walkthrough video** | Complete (commits `16dee47`, `afe167c`, `b9e7201`). Admin pastes URL into `/admin/training-settings` → stored in `training_settings.platform_walkthrough_url` (no migration, existing K/V table). Gold-gradient button lands on the Training Hub dashboard hero's right column (flex row, does not add vertical height). Fullscreen modal embeds YouTube via `youtube-nocookie.com/embed/{id}?autoplay=1&rel=0&modestbranding=1`; non-YT URLs get a generic iframe + "Open in new tab" fallback. Public read via `GET /api/training/community-links` extended to return `platformWalkthroughUrl` alongside `whatsappGroupUrl`. |
| **Teams calendar integration - real Outlook events** | Complete (commits `698f991`, `8db26e8`). Switched `createTeamsMeeting` (POST `/users/{id}/onlineMeetings`, URL-only) to `createCalendarEventWithMeeting` (POST `/users/{id}/events` with `isOnlineMeeting:true` + `onlineMeetingProvider:"teamsForBusiness"`) so Outlook creates a calendar entry on the host's Outlook/Teams calendar + auto-generates the Teams meeting with a rendered Join button + fires the standard invitation email to the organizer. Requires Azure `Calendars.ReadWrite` (Application) with admin consent, added to the tenant 2026-04-22. New helpers: `createCalendarEventWithMeeting`, `updateCalendarEvent`, `deleteCalendarEvent`, `toGraphDateTime` (UTC ISO → Graph `dateTimeTimeZone` via `sv-SE` locale, `Asia/Karachi` default), plus try-then-fallback wrappers `updateMeetingOrEvent` / `deleteMeetingOrEvent` that try `/events` first and fall back to `/onlineMeetings` on 404 so pre-migration sessions remain editable without a DB migration. Second commit `8db26e8` fixed two follow-up bugs: (a) custom `body.content` was suppressing Outlook's auto-injected Teams Join block (underlying `onlineMeeting.joinUrl` existed, just not rendered) → removed `body` from POST + PATCH, (b) empty `attendees: []` made Outlook skip the invitation email → added host as single `required` attendee (self-invite pattern, no calendar-entry duplicate). Dead `buildEventBody` helper deleted. |
| **Live session announcement reliability (migration 138)** | Complete (commit `28d5887`). Rebuilt after a 4-of-9 partial failure pattern during testing. `sendEmailBatch()` in `src/lib/email/sendEmail.ts` wraps Resend's `batch.send([...])`: one HTTP request per 100 recipients, one rate-limit slot instead of 10 parallel bursts. New child table `announcement_recipient_log` (migration 138) with per-recipient `status` (pending/sent/failed/bounced/complained), `resend_message_id`, per-row `error_message`, `UNIQUE(send_log_id, email)`, partial index on failed rows for the retry hot path. Notify route seeds recipients as `pending` before the batch fires, UPDATEs each to `sent`/`failed` from the response, recomputes aggregate counts on `announcement_send_log` so retries reflect reality. Two new POST modes: `recipientEmails: string[]` (picker allowlist / test-send), `retrySendLogId: string` (re-attempt only the failed/bounced rows of a prior dispatch in place). Course filter `target: '3sfm'\|'bvm'\|'all'` now actually filters via `training_enrollments` JOIN. Admin modal rebuilt: search + course pills + per-row checkboxes + "Send to myself only" + "Select all (filtered)" + "Clear selection" + "Preview to my inbox"; after send switches to per-recipient status table with pills + CSV export + "Retry N Failed" button. |
| **Announcement email leaked Teams join URL** | Complete (commit `8db26e8`). The "Direct join link: <url>" footnote in `liveSessionNotificationTemplate` was exposing the Teams join URL to every recipient, including students who had not registered. Removed; replaced with neutral "Register to get the join link, calendar invite and session materials" copy. Registered students still receive the link via `registrationConfirmationTemplate` + reminder templates (unchanged). |

**Packages installed this session: none.** All changes reused existing deps (Resend SDK 6.10.0 already had `batch.send`, Next.js Image APIs unchanged, no new icons beyond what `lucide-react` already exposes).

**Schema changes this session:**
- Migration 138 (`138_announcement_recipient_log.sql`): creates `announcement_recipient_log` table with FK to `announcement_send_log(id) ON DELETE CASCADE`, `status` CHECK constraint, `UNIQUE(send_log_id, email)`, + two indexes (`idx_announcement_recipient_log_send` on FK, partial `idx_announcement_recipient_log_failed` on `(send_log_id) WHERE status IN ('failed','bounced')`).
- New `training_settings` key `platform_walkthrough_url` (no migration - the existing K/V table absorbs new keys natively, default empty string hides the button).

**Azure permission added (tenant-level, one-time, outside migrations):**
- `Calendars.ReadWrite` (Application) on `FMP Training Hub` app registration with admin consent. `~30 min` propagation before the new event flow works on first use.

**New API routes this session: none.** All changes extended existing routes:
- `GET /api/training/community-links` extended to also return `platformWalkthroughUrl`
- `GET /api/admin/live-sessions/[id]/notify` extended with `?sendLogId=X` mode for per-recipient log lookup + now returns full `recipients[]` list for the picker
- `POST /api/admin/live-sessions/[id]/notify` extended with `recipientEmails` and `retrySendLogId` body fields

**New non-route files this session:**
- `supabase/migrations/138_announcement_recipient_log.sql`

**Modified files (backend):**
- `src/lib/shared/comingSoonGuard.ts` - admin role + whitelist bypass for modeling hub
- `src/lib/integrations/teamsMeetings.ts` - new calendar-event helpers + timezone helper + compat wrappers
- `src/lib/email/sendEmail.ts` - new `sendEmailBatch` helper
- `src/lib/email/templates/liveSessionNotification.ts` - removed direct-join-URL footnote
- `app/api/admin/live-sessions/route.ts` - POST calls `createCalendarEventWithMeeting`
- `app/api/admin/live-sessions/[id]/route.ts` - PATCH/DELETE call the wrapper helpers
- `app/api/admin/live-sessions/[id]/notify/route.ts` - full rewrite with batch + per-recipient logging
- `app/api/training/community-links/route.ts` - added `platformWalkthroughUrl`

**Modified files (UI):**
- `app/admin/training-hub/live-sessions/page.tsx` - rich picker modal replacing the simple confirm dialog (node-driven surgical replacement because the file literally stored `✉` as ASCII bytes that Edit tool couldn't match)
- `app/admin/training-settings/page.tsx` - Platform Walkthrough Video card
- `app/modeling/signin/page.tsx` - auto-redirect logged-in admins + whitelisted
- `app/modeling/register/page.tsx` - auto-redirect logged-in users to dashboard
- `app/modeling/dashboard/page.tsx` - bounce-back now uses `?bypass=true`
- `app/training/dashboard/page.tsx` - hero flex row with Watch Platform Walkthrough gold button + modal
- `src/components/training/player/CoursePlayerLayout.tsx` - desktop collapse + mobile drawer + mobile video fix + auto-open videoOpen
- `src/components/training/player/CourseTopBar.tsx` - `flexWrap: wrap` on action buttons

---

## Recently Completed - Modeling Hub Lockdown + Dashboard UI Cleanup (2026-04-21 session continuation, commits `c988518` → `bf20a59`)

| Feature | Status |
|---------|--------|
| **Modeling Hub pre-launch lockdown** | Complete (migrations 136 + 137, commits `c988518`, `4de63b5`, `1f6e734`). Splits the single `modeling_hub_coming_soon` toggle into independent `modeling_hub_signin_coming_soon` + `modeling_hub_register_coming_soon` with their own launch dates. Creates `modeling_access_whitelist` table (`email UNIQUE`, `note`, `added_by`, `added_at`) pre-seeded with the admin. Purges six unauthorized accounts that slipped in through the previously-unguarded `/modeling/register` page with full `admin_audit_log` trail (subquery resolves `admin_id` to the admin UUID since the live schema has `admin_id NOT NULL`; initial commit without the lookup failed with 23502, fixed in `4de63b5`). Migration 137 force-upserts both toggles to `'true'`. Gating threads through `src/lib/shared/modelingAccess.ts` into `/api/auth/register`, `/api/auth/confirm-email`, NextAuth `authorize()`, and both server pages. Admin UI: two `LaunchStatusCard`s on `/admin/modules`, new `/admin/modeling-access` page with add-email form + per-row Revoke + toggle-state summary, sidebar nav entry 🔑 Access Whitelist, warning banner on `/admin/users`. |
| **Register page UX with invite links** | Complete (commit `1f6e734`). `/modeling/register` now server-gates identically to signin: toggle OFF → form; toggle ON + no params → Coming Soon UI with "Have an invite? Register here →" link; `?bypass=true` → form (QA escape); `?email=whitelisted@address` → server-verifies whitelist and renders form with pre-filled, locked email showing green "✓ Invited" pill. New files: `app/modeling/register/ComingSoonWrapper.tsx`. `RegisterForm` gained optional `invitedEmail` prop. Copy avoids exposing the bypass mechanism to strangers. |
| **Sidebar + course view UI cleanup** | Complete (commit `af2eab2`). Sidebar 3SFM/BVM Transcript items retired. Course view (`?course=3sfm\|bvm`): extra `CertificateImageCard` below `CourseContent` removed (was showing every cert regardless of course). Inside `CourseContent` the fully-styled "Certificate Earned" card block removed; only Locked (BVM pre-unlock) + Not-Yet-Earned placeholders remain. |
| **Hide Not-Yet-Earned card + drop badges transcripts** | Complete (commit `9ead65f`). Main dashboard `#dash-achievements` transcript buttons block removed - `transcriptToast` state retired, errors now route through the shared `dashToast` overlay. Not-Yet-Earned gate changed from `!(finalPassed && courseCert)` to just `!courseCert` (first attempt). |
| **Cert-Aware course view + course_code threading** | Complete (commit `6203a5e`). Root cause of the Not-Yet-Earned fix not landing: `/api/training/certificate` was returning `course` as the free-form full title ("3-Statement Financial Modeling") but the client was matching against the short code ('3sfm'). API now exposes `courseCode` in `DashboardCert`. `Certificate` type gains optional `courseCode`. `CourseContent.find()` prefers `courseCode` case-insensitive with a free-form fallback. Everywhere that used `finalPassed && courseCert` downgraded to just `courseCert` (pre-migration students lack the Final session row). `certStatus` returns `'Earned'` on cert presence; `isOfficial` label true for cert-holders; View Certificate button renders with cascading href (`certPdfUrl` → `verificationUrl` → `certifierUrl` → `/verify/<id>`); Exam Prep Mode hidden; banner waterfall reordered so `courseCert` branch is first. |
| **Two-column certificate card layout** | Complete (commit `44eed1e`). `CertificateImageCard` body reshaped to a CSS grid with `repeat(auto-fit, minmax(240px, 1fr))`, 20px gap. Left column: meta + QR. Right column: Download PDF / Badge / Transcript / Share / Verify stacked full-width. Collapses to 1 column under ~500px without a viewport media query. Header, Distinction pill, gradient body, Pending-state card unchanged. Height dropped from ~620px to ~280-320px per issued cert. |
| **Footer double-© fix** | Complete (commit `ff3e1b4`). `SharedFooter` defensively strips any leading `©` / `&copy;` / `&#169;` plus whitespace from the rendered value (case-insensitive). Template still owns the literal `©` character so values without one still render correctly. Admin edits through `InlineEdit` save what they type and the strip re-applies on the next render - single-© invariant is self-healing, zero caller/CMS changes needed. |
| **Cert card per-card data binding fix** | Complete (commit `bf20a59`). Critical launch blocker: `CertificateImageCard` fetched `/api/training/certificate-image?email=X` on mount and overwrote its own `cert` prop with the newest single row the endpoint returns (`order by issued_at desc limit 1`). For students with multiple certs both cards rendered the BVM row (same certificate_id, QR, PDF, badge, transcript, verify link). Fix: card now fetches by `certId` (globally unique); email fallback threads `courseCode`. API gained optional `?courseCode=` filter for email-path defense. Dashboard caller adds `sortedCertificates` (`{'3SFM': 0, 'BVM': 1}`) used in both the cert-cards map and the Certificate Badges grid. Tile `courseLabel` also fixed - was `cert.course === '3sfm'` which never matched; now uses `courseCode` with regex fallback. |

**Packages installed this session: none.** All changes reused existing deps.

**Schema changes this session:**
- Migration 136 (`136_modeling_hub_lockdown.sql`): seeds 4 new `training_settings` keys (`modeling_hub_signin_coming_soon`/`_launch_date`, `modeling_hub_register_coming_soon`/`_launch_date`); creates `modeling_access_whitelist` table with `idx_modeling_wl_email_lower` partial index; seeds admin whitelist row; captures audit trail for 6 user deletions in `admin_audit_log`; deletes email-keyed `trusted_devices` rows; deletes 6 users.
- Migration 137 (`137_force_modeling_toggles_coming_soon.sql`): force-upserts both modeling hub toggles to `'true'` via `ON CONFLICT DO UPDATE`.

**New API routes this session:**
- `GET/PATCH /api/admin/modeling-signin-coming-soon` (admin)
- `GET/PATCH /api/admin/modeling-register-coming-soon` (admin)
- `GET /api/admin/modeling-access` (list entries, admin)
- `POST /api/admin/modeling-access` (add entry, admin)
- `DELETE /api/admin/modeling-access/[id]` (revoke, admin)

**New non-route files this session:**
- `supabase/migrations/136_modeling_hub_lockdown.sql`
- `supabase/migrations/137_force_modeling_toggles_coming_soon.sql`
- `src/lib/shared/modelingAccess.ts` (whitelist + admin + signin/register access predicates)
- `app/admin/modeling-access/page.tsx` (whitelist admin UI)
- `app/api/admin/modeling-access/route.ts`
- `app/api/admin/modeling-access/[id]/route.ts`
- `app/api/admin/modeling-signin-coming-soon/route.ts`
- `app/api/admin/modeling-register-coming-soon/route.ts`
- `app/modeling/register/ComingSoonWrapper.tsx`

**Modified files (gating + UI):**
- `src/lib/shared/modelingComingSoon.ts` (adds `getModelingSigninComingSoonState` + `getModelingRegisterComingSoonState`; legacy helper kept)
- `src/lib/shared/auth.ts` (NextAuth `authorize` uses new signin key + whitelist bypass)
- `app/api/auth/register/route.ts` (`canEmailRegisterModeling` gate before existing-email lookup)
- `app/api/auth/confirm-email/route.ts` (`canEmailRegisterModeling` gate for stale tokens)
- `app/modeling/signin/page.tsx` (reads new signin key)
- `app/modeling/register/page.tsx` (whitelist ?email= short-circuit + `ModelingRegisterComingSoonWrapper`)
- `app/modeling/register/RegisterForm.tsx` (`invitedEmail` prop, locked input)
- `app/modeling/ComingSoon.tsx` (register variant gets "Have an invite? Register here →" link)
- `app/admin/modules/page.tsx` (two `LaunchStatusCard`s + whitelist banner)
- `app/admin/users/page.tsx` (info banner re: Modeling Hub access lockdown)
- `src/components/admin/CmsAdminNav.tsx` (🔑 Access Whitelist nav entry under Modeling Hub)
- `app/api/training/certificate/route.ts` (DashboardCert exposes `courseCode`)
- `app/api/training/certificate-image/route.ts` (optional `courseCode` email-path filter + response includes `course_code`)
- `src/components/training/dashboard/types.ts` (Certificate gains optional `courseCode`)
- `src/components/training/dashboard/CourseContent.tsx` (courseCode matching, banner waterfall reorder, View Cert href cascade, Exam Prep Mode cert-aware, Not-Yet-Earned gate = `!courseCert`, "Certificate Earned" inline card removed)
- `src/components/training/dashboard/CertificateImageCard.tsx` (fetch by certId, two-column grid layout, courseCode threaded into email fallback)
- `app/training/dashboard/page.tsx` (sidebar transcripts removed, inline cert card below CourseContent removed, achievements transcript block removed, `transcriptToast` retired → `dashToast`, `sortedCertificates` memo, tile courseLabel uses courseCode)
- `src/components/landing/SharedFooter.tsx` (defensive leading-© strip)

---

## Recently Completed - Launch Readiness (2026-04-21 session, commits `c37dde9` → `8fb0a77`)

| Feature | Status |
|---------|--------|
| **WhatsApp Group Link** | Complete (migration 123) — `training_settings.whatsapp_group_url` seeded `''`. Admin UI at `/admin/training-settings` validates `https://chat.whatsapp.com/…` before save. Green sidebar CTA on Training Hub dashboard (expanded + collapsed variants). Empty value hides the button. Public read: `GET /api/training/community-links` re-validates server-side. New files: `app/api/training/community-links/route.ts`, `supabase/migrations/123_whatsapp_group_url.sql`. Commit `c37dde9`. |
| **Context-aware live-session achievement card** | Complete — `/api/training/achievement-image` accepts `has_assessment` + `duration` params. With assessment = green score circle + PASSED pill (legacy render). Without assessment = teal duration circle + ATTENDED pill. Duration chip on both variants. `LiveSessionCardLarge.tsx` `achievementCardUrl()` helper threads params from `session.has_assessment` + `session.duration_minutes`. 3SFM/BVM cards unchanged because legacy callers omit the new params. Commit `c37dde9`. |
| **Recorded live-session achievement card fix** | Complete — first pass missed `SessionCard.tsx` which is the actual component rendering recorded live sessions via the `RecordedLiveSessionRow` adapter (not `LiveSessionCardLarge` as originally assumed). `SessionCard` now accepts optional `hasAssessment` (default true for 3SFM/BVM backward compat) + `durationMinutes`. Shared `buildAchievementCardUrl()` helper drops the score param when `hasAssessment === false`, sets `has_assessment=false`, and always appends duration when provided. `RecordedLiveSessionRow` threads both props through. Commit `2f2f81d`. |
| **Inline certificate issuance + daily cron retired** | Complete (migration 124) — certificates issue the moment a student passes their final exam via fire-and-forget `issueCertificateForStudent(email, courseCode)` from `/api/training/submit-assessment`. Old `/api/cron/certificates` route deleted; `vercel.json` cron entry removed. Engine helper does a cheap skip-if-already-issued pre-check, runs `checkEligibility`, and hands off to `issueCertificateForPending`. Idempotent via unique index on `(LOWER(email), course_code)` from migration 111. Migration 124 adds `student_certificates.email_sent_at TIMESTAMPTZ NULL` + partial index `idx_student_certificates_email_unsent` for constant-time resend lookups. `issueCertificateForPending` stamps the column after `sendEmail` resolves. Note: task spec requested migration 123 but 123 was already taken by the WhatsApp migration earlier in the session, so email_sent_at landed as 124. Commit `6ae892a`. |
| **Admin certificates safety-net panel** | Complete — `/admin/training-hub/certificates` gained a top "🛟 Eligible but not issued" panel with per-row `⚡ Issue Now` + bulk `Issue All Pending (N)`. The main cert table gained an `Email` column (Sent / Unsent pill) with a `✉ Resend` button on unsent rows. Three new admin routes: `GET /api/admin/certificates/pending` (eligibility view minus Issued rows), `POST /api/admin/certificates/issue-pending` (`{ email, courseCode }` or `{ all: true }`), `POST /api/admin/certificates/resend-email` (`{ certificateId }`). New files: `app/api/admin/certificates/pending/route.ts`, `app/api/admin/certificates/issue-pending/route.ts`, `app/api/admin/certificates/resend-email/route.ts`. Commit `6ae892a`. |
| **Legacy Certificate Generation tile removed** | Complete — the `/admin/certificates` "⚙️ Certificate Generation" card with its `Automatic Generation` toggle + `⚡ Generate Now` button was diagnosed fully obsolete (zero live consumers after the cron was deleted in `6ae892a`; replaced by the safety-net panel). Deleted: `/api/admin/certificates/settings`, `/api/admin/certificates/generate`, `processPendingCertificates()` in `certificateEngine.ts`, orphan `getPendingCertificates` import, orphan `@keyframes spin` style, stale "cron every 15 minutes" tip copy. Two orphan data rows left in place (no schema change without approval): `cms_content.certificate_settings.auto_generation_enabled`, `training_settings.cert_last_generated`. Commit `8fb0a77`. |

**Packages installed this session: none.** All changes used existing dependencies (lucide-react icons, inline SVG for WhatsApp glyph, existing Supabase + Resend clients).

**Schema changes this session:**
- Migration 123 (`123_whatsapp_group_url.sql`): seeds `training_settings.whatsapp_group_url = ''` with `ON CONFLICT DO NOTHING`.
- Migration 124 (`124_cert_email_sent_at.sql`): adds `student_certificates.email_sent_at TIMESTAMPTZ NULL` + partial index `idx_student_certificates_email_unsent ON student_certificates (email, certificate_id) WHERE email_sent_at IS NULL AND cert_status = 'Issued'`.

**New API routes this session:**
- `GET /api/training/community-links` (public)
- `GET /api/admin/certificates/pending` (admin)
- `POST /api/admin/certificates/issue-pending` (admin)
- `POST /api/admin/certificates/resend-email` (admin)

**Deleted API routes this session:**
- `GET /api/cron/certificates`
- `GET/POST /api/admin/certificates/settings`
- `POST /api/admin/certificates/generate`

**New non-route files this session:**
- `supabase/migrations/123_whatsapp_group_url.sql`
- `supabase/migrations/124_cert_email_sent_at.sql`
- `app/api/training/community-links/route.ts`
- `app/api/admin/certificates/pending/route.ts`
- `app/api/admin/certificates/issue-pending/route.ts`
- `app/api/admin/certificates/resend-email/route.ts`

---

## Recently Completed — Pre-Launch Polish (2026-04-21 session)

| Feature | Status |
|---------|--------|
| **Watch Resume / Continue** | Complete — `YouTubePlayer.startSeconds` prop threaded via `CoursePlayerLayout.resumePositionSeconds`; both watch pages capture `last_position` from the GET response and pass it through. Clamps: completed → 0, `<10s` → skip, `≥ total−30` → skip, null → 0. Tracker floor preserves threshold credit across reloads so the resume only moves the playhead, not the counter. (Uncommitted as of doc update.) |
| **Video Swap Auto-Detection + Admin Reset** | Complete — `src/lib/training/detectVideoChange.ts` heuristic (`abs > 30s AND rel > 10%`). Both watch endpoints reset progress + demote status + clear audit timestamps on a detected swap. `POST /api/admin/sessions/[tabKey]/reset-watch-progress` routes by `LIVE_` prefix vs course tab_keys; red reset buttons in both session editors. Commit `b96fe23`. |
| **Mark Complete — final 20s + ENDED fallback** | Complete — `canMarkComplete = nearEnd && (thresholdMet || bypass)`. `nearEnd = liveCurrentPos >= liveTotalSec - 20 || videoEnded`. Fixed two root causes of "button stuck hidden": PAUSED-at-end fallback in `YouTubePlayer` + tracker baseline capture at mount with stale prop. Monotonic-max floor on `liveWatchSec`. Commits `cae696a`, `7f39fe9`, `4f3d675`, `2a6f5f5`. |
| **Live-Session Completion Flow** | Complete — `isWatched` effect filters `status === 'completed'` (not any history row) so an in-progress tick no longer masquerades as completion. `handleMarkComplete` parses 403 errors with `{ current, required }` and surfaces threshold-not-met to the student. Commit `2cf7777`. |
| **Interactive Onboarding Tour** | Complete (migration 120) — `driver.js@^1.4.0` walkthrough on first dashboard visit. `training_registrations_meta.tour_completed` flag + `POST /api/training/tour-status`. `src/components/training/DashboardTour.tsx`. Tour copy avoids mentioning watch threshold. Commit `a9bf40a`. |
| **Auto-Launch Cron (disabled at UI)** | Complete wiring, gated off — migration 118 seeds `{hub}_auto_launch` + `{hub}_last_auto_launched_at`. `/api/cron/auto-launch-check` flips `coming_soon='false'` + one-shot clear. `AUTO_LAUNCH_UI_ENABLED=false` in `LaunchStatusCard` because Vercel Hobby only supports daily crons — re-enable when we upgrade to Pro. `vercel.json` entry rolled back. Commits `e05a51c`, `6cda7fb`. |
| **Session Reminders — per-registration** | Complete (migration 122) — flags moved from `live_sessions` to `session_registrations.reminder_{24h,1h}_sent` + partial indexes on `false` rows. Late registrants now receive the right window. `src/lib/training/sessionAnnouncement.ts` centralizes the email build. Commit `fed8ece`. |
| **Coming-Soon bypass list** | Complete (migration 121) — `training_settings.training_hub_bypass_list` seeded with owner email + RegID. `src/lib/shared/hubBypassList.ts` + `comingSoonGuard.ts`. `PreLaunchBanner` on authed dashboard. Admin UI TBD. Commit `ba218bc`. |
| **Share template `{hubUrl}` variable** | Complete (migration 119) — append `\n\nLearn more at {hubUrl}` to 5 templates via soft-upgrade predicate; admin edits preserved; idempotent. Commit `589db84`. |
| **Hashtags mandatory + read-only preview** | Complete — every share post auto-merges `hashtags[]` into the body; student-side ShareModal textarea is read-only (admin edits on share-templates page are the single authority). Commits `30ded6d`, `0ffcfc3`. |
| **Watch threshold hidden from students** | Complete — every student-facing surface (CourseTopBar ghost hint, SessionCard, WatchProgressBar label) hides the literal `X% to go` numeric. The rule exists to gate progression, not to be advertised. Commit `1d45bf7`. |
| **Live-session registration flow + email pipeline** | Complete — register endpoint now fires announcement/confirmation email via `sessionAnnouncement.ts`; cron reminder flags flipped per registration. Commit `fed8ece`. |
| **Dashboard upcoming-session card layout** | Complete — fixed 3-2-1 grid, 25% shorter (width reverted), auto-collapse via `minmax(min(100%, Npx), 1fr)`. Commits `8ceca27`, `25a93a6`, `8585bce`. |
| **Mobile responsiveness pass** | Complete — C1-C9 Critical + I1-I18 Important issues resolved across hero, sticky headers, session cards, sidebar nav, mobile bottom nav, admin tables, forms, buttons. Verified on 320/375/768/1024 viewports. Commit `cd3f250`. |
| **Marketing Studio PNG render** | Complete — `imageToDataUri` gets a 5s AbortController; render route gets `maxDuration=60` + unresolved count logging. Fixes "Failed to fetch" where a single slow image URL stalled the whole render past the serverless timeout. Commit `dfb0ab3`. |
| **System Health — SUPABASE_URL fallback** | Complete — env-check respects either `NEXT_PUBLIC_SUPABASE_URL` or `SUPABASE_URL` so the System Health card no longer false-alarms "Supabase URL (server) MISSING". Commit `886fa4d`. |
| **Per-subdomain layout.tsx files** | Complete — added `layout.tsx` to each route group under `app/training/*` (`[courseId]`, `assessment`, `certificate`, `certificates`, `dashboard`, `live-sessions`, `material`, `transcript`, `watch`) + `app/refm/` so deep links inherit learn/app subdomain OG defaults and share previews show the correct card. |

---

## Recently Completed — Share Templates + Verify Previews + OG canonicalization (2026-04-19 / 2026-04-20 session)

| Feature | Status |
|---------|--------|
| **Share templates — centralized system** (migrations 114-117) | Complete — `share_templates` table + four `training_settings` keys for global brand/founder mention strings + `@` prefix toggles. Render engine at `src/lib/training/shareTemplates.ts` with `renderShareTemplate`, `resolveCourseName`, `formatShareDate`. Client hook `useShareTemplate` with module cache + fallback. Admin page `/admin/training-hub/share-templates` with Global Mention Settings card + per-template editor. 5 seeded templates (certificate_earned, assessment_passed, achievement_card, live_session_watched, session_shared). Every share call site migrated (CertificateImageCard / VerifyActions / SessionCard / LiveSessionCard(Large) / assessment results / CourseTopBar). Commits `e155b54`, `a667c8d`, `fe8e6e3`, `0604db5`, `e691c92`. |
| **Daily certifications roundup** (migration 117) | Complete — `/admin/training-hub/daily-roundup` admin page + `GET /api/admin/certificates/by-date` endpoint. Template uses `{studentList}`, `{verifyLinks}`, `{count}`, `{date}`. One roll-up post per day instead of one post per student. Share Roundup button opens universal ShareModal. Nav entry 🎓 Daily Roundup under Training Hub. Commit `3c0f752`. |
| **Verify page — inline PDF + badge previews** | Complete — 2-column preview grid: Certificate PDF (4:3 iframe) + Badge PNG (1:1 img with soft-gold radial backdrop) on left, Transcript PDF (3:4 iframe, pre-cache-first) on right. Navy header strips + `Open Full ↗` + floating `⛶ View` mobile pill. Commits `5cb1c7e`, `608c4aa`. |
| **Dashboard cert share — ShareModal preview** | Complete — `CertificateImageCard` opens ShareModal with OG certificate image preview + editable text + platform buttons matching Achievement Card pattern. Commit `70f305a`. |
| **Subdomain-correct OG metadata + LinkedIn OG image** | Complete — `app/verify/layout.tsx` created with `metadataBase` / canonical / og:url pinned to LEARN_URL. Training + Modeling layouts gained explicit `alternates.canonical`. `robots.ts` adds `Allow: /api/og/` so LinkedInBot can fetch OG images. `URLS.verify` helper canonicalized to learn subdomain. Admin certificates fallback no longer routes legacy certifier_uuid certs to main. Sitemap lists `/verify` on learn. Commits `2097ddb`, `756cff9`. |
| **Share text — course name + date format fixes** | Complete — `resolveCourseName()` + `formatShareDate()` baked into render engine. `/api/training/certificate` no longer prefers `course_code` over `course` (was serving "3SFM" to dashboard). All call sites route dates through `formatShareDate()`. ShareModal now seeds draft with text + hashtags merged so students see exactly what's copied. Commits `fe8e6e3`, `0604db5`. |
| **Dashboard upcoming-only live sessions preview** | Complete — removed Recorded sub-section from dashboard block (full library stays on `/training/live-sessions`). Grid capped at 3 cards. Empty-state card replaces silent disappearance. Commit `bbc37be`. |
| **Google Search Console verification** | Complete — token added to `app/layout.tsx` metadata.verification. Commit `4d31229`. |
| **Bing Webmaster Tools verification** | Complete — `msvalidate.01` token added via `metadata.verification.other`. Both `<meta name="google-site-verification">` and `<meta name="msvalidate.01">` render sitewide. Commit `578eed7`. |

---

## Recently Completed — Marketing Studio + Watch Enforcement (2026-04-18 session, continued)

| Feature | Status |
|---------|--------|
| **Marketing Studio — Phase 1** (migration 100) | Complete — `marketing_designs` + `marketing_brand_kit` tables. 3 templates (YouTube Thumbnail / LinkedIn Post / Instagram Post) via satori `ImageResponse`. Admin page at `/admin/marketing-studio`, Brand Kit editor at `/admin/marketing-studio/brand-kit`. Anthropic single-platform caption generator. Saved designs list. Admin nav entry under Content. Commit `a21d1c5`. |
| **Marketing Studio — Phase 1.5 (canvas editor)** (migration 101, `react-rnd@^10.5.3`) | Complete — drag-and-drop canvas replaces fixed templates. Element-based design (text / image / shape) with absolute positioning. `react-rnd` drag + resize, auto-fit zoom, undo/redo stack (50), keyboard shortcuts (Delete / Ctrl+Z/Y / Ctrl+D / Ctrl+C/V / Arrow nudge). `src/components/marketing/canvas/{CanvasEditor,ElementRenderer,PropertiesPanel}.tsx`. 5 starting presets + Blank Custom. Migration 101 adds `dimensions`/`background`/`elements` jsonb to `marketing_designs` + `additional_logos`/`additional_photos`/`uploaded_images` to `marketing_brand_kit`. Commit `2e8f624`. |
| **Marketing Studio — Custom backgrounds + aspect-ratio lock + FMP YouTube preset** (migration 102) | Complete — `background_library` jsonb added to `marketing_brand_kit`. Background panel: upload → save to library → reuse; brand-typed entries non-deletable; optional dark overlay. `lockAspectRatio` toggle per image/shape element (images default ON). Image elements support border ring (color + width). Text element italic toggle. `fmpYoutubeThumbnailPreset` with session badge, teal ring founder photo, gold dividers. Commit `025563a`. |
| **Marketing Studio — Phase 2 (multi-platform + auto-populate + multi-caption)** (`jszip@^3.10.1`) | Complete — FMP LinkedIn Post + FMP Instagram Post presets. Quick Fill panel auto-populates text from articles / live sessions / training sessions via id-prefix matching. Multi-platform caption generator (LinkedIn / Instagram / Facebook / WhatsApp / Twitter / YouTube) with parallel `Promise.all` + tone selector (Professional / Casual / Thought Leader / Educational). Export to All Platforms ZIP. Saved designs sidebar with lazy-rendered thumbnails + template filter. Commit `9dfaeb3`. |
| **Marketing Studio — Phase 3A (9 FMP presets + 5 variants)** | Complete — 6 new FMP platform presets: YouTube Banner 2560×1440, LinkedIn Banner 1584×396, Instagram Story 1080×1920, Facebook Post 1200×630, Twitter/X 1600×900, WhatsApp Status 1080×1920. 5 template variants scaled proportionally to any dimensions: Session Announcement, Quote/Insight, Platform Launch, Achievement Spotlight, Article Promo. Preset picker grouped by platform (YOUTUBE / LINKEDIN / INSTAGRAM / FACEBOOK / OTHER / CUSTOM). `variant_id` persisted in existing `content` jsonb — no migration. Commit `283e9b4`. |
| **Video Watch Enforcement (70% rule)** (migration 103) | Complete — client-side interval-merging tracker (`src/lib/training/watchTracker.ts`) so seeking can't inflate counts. YouTubePlayer reports `onProgress(sec, total, pos)` every ~10s. Watch page posts to `/api/training/certification-watch` with MAX server-side merge. Mark Complete gated until `watch_percentage ≥ threshold`. `WatchProgressBar` component above Mark Complete + thin bar on dashboard session cards (red <30% / amber <threshold / green ≥threshold + dashed threshold marker). Migration 103 adds `watch_seconds`/`total_seconds`/`watch_percentage`/`last_position`/`updated_at` to `certification_watch_history` + seeds `watch_enforcement_enabled`/`_threshold` in `training_settings`. Commit `1db1430`. |
| **Watch Enforcement — default for all future sessions** | Complete — missing bypass row = enforcing (no seeding needed). Admin UI session list is union of `COURSES` + distinct tab_keys in `certification_watch_history`. Status badges show "Enforcing (default)" vs "Bypassed" vs "Global OFF". Summary card shows enforcing/bypassed counts at a glance. `verifyWatchThresholdMet()` in `src/lib/training/watchThresholdVerifier.ts` gates cert issuance in `processPendingCertificates` — grandfathers pre-migration-103 rows (no watch data) so historical certs aren't blocked. New endpoint `/api/admin/watch-enforcement-stats`. Commit `0950ac7`. |

---

## Recently Completed — CMS Universalization + Training Hub fixes (2026-04-18 session)

| Feature | Status |
|---------|--------|
| **CmsField — Universal Rendering (Phase 1)** | Complete — `src/components/cms/CmsField.tsx` is the only way CMS text reaches the frontend. All 21 section renderers + all Option B pages use it. Handles visibility / alignment / width / HTML detection / paragraph splitting. Enforcement docstring + CLAUDE.md rules. |
| **RichTextarea → Tiptap (Phase 2A)** | Complete — rewrote `src/components/admin/RichTextarea.tsx` as a Tiptap editor with StarterKit + Underline + Link + Color + TextStyle + custom FontSize. Installed `@tiptap/extension-underline@2.27.2`. Replaced 10 plain textareas with RichTextarea. Removed legacy `ParagraphsEditor` + `AlignPicker` (orphan `content.paragraphs[]` harmless). |
| **Array Item VF + TwoPlatforms fix (Phase 2B)** | Complete — `ItemVF` / `ItemBar` helpers in page-builder. Per-item VF on 9 array editors. TwoPlatforms VF keys now stored inside `columns[i]`. 8 frontend renderers filter `item.visible !== false`. Migration 097 backfill. |
| **Attempts counter (server-authoritative)** | Complete — `/api/training/submit-assessment` increments `attempts` from existing Supabase row, ignoring stale client `attemptNo`. `/api/training/attempt-status` overlays Supabase over Apps Script. |
| **Timer persistence + auto-submit** | Complete — localStorage `assessment_timer_${tabKey}_${attemptNo}` records start epoch. Page remount resumes clock; expiry auto-submits saved answers; counts as the attempt. `beforeunload` guard during 'taking'. |
| **Retake flow fix** | Complete — `/api/training/certification-watch` guards against `'completed' → 'in_progress'` downgrade. 'completed' is terminal. Fixes "had to re-mark complete after failed attempt" bug. |
| **Universal Share Utility** | Complete — `src/lib/training/share.ts` `shareTo()` + `src/components/training/share/ShareModal.tsx`. Copy-first-then-open pattern. Dashboard + watch-page + SessionCard + assessment results all use the utility. |
| **Calendly inline embed** | Complete — `src/components/booking/CalendlyEmbed.tsx` dynamically loads widget.js on mount. `/book-a-meeting` embeds inline (no redirect). Reads URL from `page_sections.team.content.booking_url`. Fallback to contact options when URL empty. |
| **founder_profile table dropped** | Complete — Migration 098. Deleted `/admin/founder/` + `/api/admin/founder/` + `getFounderProfile()` from `src/lib/shared/cms.ts`. All founder data lives in `page_sections.team`. |
| **/about page removed** | Complete — Deleted `app/about/page.tsx`. Redirect `/about → /about/ahmad-din` in next.config.ts. Footer + nav entries repointed. Migration 099 cleans up orphan DB rows. |
| **Founder contact fields** | Complete — Email + WhatsApp added to FounderEditor Booking Page tab. "Get in Touch" section at bottom of `/about/ahmad-din` shows email/WhatsApp/LinkedIn/booking as readable clickable text. Hero buttons kept LinkedIn + Book a Meeting only. |
| **Hero universal VF** | Complete — Home, Training, Modeling, Modeling [slug], Founder page heroes all respect `cmsVisible` + `fw()` + `CmsField`. Missing fields (powerStatement/softCta/trustLine/tags) added to Modeling Hub hero. Width pattern `min(1200px, 90vw)` + subtitle maxWidth 960 standardized across heroes. |
| **CTA field-name dual-read** | Complete — Modeling + Training pages read admin's `buttonText`/`buttonUrl`/`subtitle` first, fall back to legacy `cta_text`/`cta_url`/`description`. Fixes "bottom CTA edits not reflecting". |

---

## Previous Session (earlier)

| Feature | Status |
|---------|--------|
| **Assessment Internal Route** | Complete — assessment uses `/training/assessment/[tabKey]` instead of Apps Script formUrl (always empty). Dashboard shows "Take Assessment →" button |
| **Dashboard Header Match** | Complete — dashboard header matches main Navbar: rgba bg, blur, 64px height, 40px padding, border-bottom |
| **Certification Watch Tracking** | Complete — `certification_watch_history` table (migration 088). Watch page writes in_progress on play, completed on Mark Complete. Dashboard gates assessment behind completion |
| **Email Migration to Next.js** | Complete — quizResult, registrationConfirmation, lockedOut emails now sent from Next.js. `/api/email/send` bridge kept for backwards compat. Migration 089 syncs email logo |
| **Supabase Assessment Results** | Complete — `training_assessment_results` table (migration 090). Dual-write: Apps Script + Supabase. Progress route merges Supabase over Apps Script for instant reads |
| **In Progress Status Badge** | Complete — StatusBadge shows amber "In Progress" when video started/completed but assessment not taken |
| **Achievement Card System** | Complete — dynamic OG image (`/api/training/achievement-image`), satori ImageResponse, sharp SVG→PNG logo, student name + reg ID + score + course + date. Admin-controlled logo height |
| **Share System** | Complete — SessionCard: Share modal (textarea, LinkedIn auto-copy + compose, Copy Text) + Card modal (preview + download). Assessment result page: same pattern. LinkedIn opens compose with auto-copied text |
| **OG Social Previews** | Complete — Per-domain OG banners: `/api/og` (learn), `/api/og/modeling` (app), `/api/og/main` (main). CMS-driven hero text, logo from header_settings (sharp SVG→PNG). Assessment layout.tsx with dynamic OG tags. metadataBase on all layouts |
| **LinkedIn + YouTube Sidebar** | Complete — Follow Us section in dashboard sidebar with LinkedIn + YouTube buttons (expanded + collapsed states) |
| **Back to Course Navigation** | Complete — assessment page "Back to Dashboard" includes `?course=` param for correct course context |
| **Watch Page Passed State** | Complete — shows "Assessment Done" instead of "Take Assessment" when session already passed. assessmentPassed prop through CoursePlayerLayout → CourseTopBar |
| **Assessment Blocks Passed** | Complete — assessment page checks progress API (Supabase-merged) on mount, immediately shows "Already Passed" screen if session passed |
| **Dashboard Share Banner** | Complete — "Enjoying your progress?" banner opens modal (same pattern as session share) with textarea + LinkedIn + Copy Text |

---

## In Progress

| Feature | Current State | What Remains |
|---------|--------------|--------------|
| **AI Agents** | Market rates + research agents wired | Contextual help agent (stub only) |
| **Pricing / Subscriptions** | Plans + features in DB | Enforcement partial — needs gating logic |
| **White-label / Branding** | DB-driven config, BrandingThemeApplier wired | Full theming coverage |

---

## Not Started — REFM Modules

| Module | Name | Status |
|--------|------|--------|
| Module 2 | Revenue Analysis | Stub only |
| Module 3 | Operating Expenses | Stub only |
| Module 4 | Returns & Valuation | Stub only |
| Module 5 | Financial Statements | Stub only |
| Module 6 | Reports & Visualizations | Stub only |
| Modules 7–11 | (various) | Placeholder stubs |

---

## Not Started — Modeling Platforms

| Platform | Slug |
|----------|------|
| Business Valuation Modeling | `bvm` |
| FP&A Modeling Platform | `fpa` |
| Equity Research Modeling | `erm` |
| Project Finance Modeling | `pfm` |
| LBO Modeling Platform | `lbo` |
| Corporate Finance Modeling | `cfm` |
| Energy & Utilities Modeling | `eum` |
| Startup & Venture Modeling | `svm` |
| Banking & Credit Modeling | `bcm` |

All have config in `src/config/platforms.ts` but no platform content.

---

## Legacy Reference

`_legacy_backup/js/refm-platform.js` — 7,599-line original CDN implementation.
- AppRoot: lines 1-70 | State: 72-200 | Calculations: 200-900
- Excel export: 900-1,900 | Project Manager UI: 1,900-3,800
- Main render: 3,800-5,700 | Module 1 UI: 5,700-7,520 | Stubs: 7,520-7,598
