# Feature Documentation

> Referenced from CLAUDE.md, detailed feature specs, flows, and architectural decisions.

---

## Feature Status

| Feature | Status | Notes |
|---------|--------|-------|
| **Articles, paste-and-go publishing (2026-07-08/09)** | ✅ Complete | Full overhaul of the CMS articles system. **Authoring** (`/admin/articles`): body editor is **HTML-source only** (verbatim save, no rich-text mode after it was found to flatten `<figure>`); dual image upload (hero `cover_url` + mid image via `{{MID_IMAGE}}` marker); OG image (falls back to hero); freeform tags; **categories** many-to-many (`categories` + `article_categories`, mig 187) with inline-create multi-select + a manage view; **writer/instructor byline** (mig 188: `writer_id` -> `instructors` + `writer_name`/`writer_title` snapshot, editable per-article override + re-sync, publish requires a writer); **hero placement toggle** (mig 189 `hero_before_content`, above/after the title). Slug-uniqueness pre-check. **Public render** (`/articles`, `/articles/[slug]`): raw HTML rendered via `dangerouslySetInnerHTML` after `{{MID_IMAGE}}` resolution + **strict allow-list sanitize** (`sanitize-html`, pure Node; swapped off isomorphic-dompurify which 500'd on Vercel serverless); byline via `AuthorByline`/`resolveByline` (writer snapshot, title `|`->`·` normalized, single-author fallback); clean plain-text excerpts; Category + Writer filter rows; heroes are plain `<img>` (Supabase host not allowlisted for `next/image`). Migs 187/188/189 all APPLIED. Detail in CLAUDE-DB.md (migs) + CLAUDE-ROUTES.md (routes/components). |
| **REFM platform (current, 2026-06-14)** | ✅ M1-M5 done, M6 live | M1 Setup/Land/Capex/Financing LOCKED; M2 Revenue, M3 Opex, M4 Financial Statements (Schedules/P&L/CF/BS, balances by construction), M5 Returns & RE Metrics all built; **M6 Scenario Analysis LIVE** (case-engine surface + explicit override editor + comparison matrix); M7 Reports = stub. **Excel MODEL export** + **PDF export** are full module-for-module mirrors (Excel = hardcoded snapshot, one navy palette, tabs in module order; verify-excel-export 129/129). Detailed per-module rows below are historical; see CLAUDE-REFM.md for current detail. |
| **Training Hub, Auth** | ✅ Complete | Custom session, 1hr TTL, httpOnly cookie; RegID sign-in resolves email via Apps Script |
| **Training Hub, Registration + Email Confirm** | ✅ Complete | hCaptcha + pending table + Next.js-native confirmation link (no Apps Script). The earlier dual-email flow (6-digit OTP via `/api/training/send-verification` AND a confirmation link) was simplified 2026-04-23: the OTP step was redundant because account creation only happens on the link click, so it just produced two emails for one signup. RegisterForm now POSTs the form directly to `/api/training/register`, which writes the pending row + emails one confirmation link, and the click hits `/api/training/confirm-email` to allocate RegID + write meta + write password. The OTP routes themselves are kept (used by `/training/set-password` for the password-reset flow). **Phone number is required for new signups (FIX 2, 2026-04-23):** PhoneInput renders with `required`, client + server both validate the concatenated `phoneCode + phoneLocal` against E.164 (`^\+[1-9]\d{6,14}$`), and the value lands in `training_pending_registrations.phone` then `training_registrations_meta.phone` on confirm. Migration 139 declares the column with `ADD COLUMN IF NOT EXISTS` for rebuild reproducibility (no-op against the existing prod schema). NULL stays valid for ~9 pre-collection legacy rows; the requirement is enforced only at signup time. Admin students page now displays phone (with click-to-call `tel:` link) and the search bar matches against phone too. |
| **Training Hub, Device Trust + OTP** | ✅ Complete | `training_email_otps`, 30-day trust cookie |
| **Training Hub, Resend Confirmation Email** | ✅ Complete | `POST /api/training/resend-confirmation` |
| **Training Hub, Inactivity Logout** | ✅ Complete | `useInactivityLogout` on dashboard |
| **Training Hub, Dashboard** | ✅ Complete | Redesigned: overview + course views, collapsible sidebar, mobile bottom nav, badge download, attachment counts |
| **Training Hub, Assessments / Quiz** | ✅ Complete | Client-side scoring, shuffle toggles, timer bypass |
| **Training Hub, Certificate System** | ✅ Complete | Inline fire-and-forget issuance the moment a final exam passes (no cron). Internal pdf-lib PDF gen, sharp badge overlay, Supabase storage, `email_sent_at` delivery tracking (migration 124), admin safety-net panel "Eligible but not issued" + `✉ Resend Email` for unsent rows |
| **Training Hub, Model Submission Gate (certificate credibility upgrade)** | ✅ Complete (migration 148, 2026-04-29; gate dormant until admin flip) | Students must build and upload their own financial model for admin review before the Final Exam unlocks. Effort-based pass/reject by Ahmad on a 5-business-day SLA, 3 attempts, 10 MB cap, file types `xlsx`/`xls`/`xlsm`/`pdf`. Soft-launch posture: every per-course `model_submission_required_<course>` flag ships `'false'`, `model_submission_announcement_only` ships `'true'`, so the gate is dormant out of the box; admins flip per-course at `/admin/training-settings` after the notice broadcast. **Phase A** (commit `c2b02e4`): schema (`model_submissions` table + private `model-submissions` storage bucket + 7 settings) + `getModelSubmissionStatus()` reader. **Phase B** (commit `c42239d`): server-side gate in `certificateEngine.issueCertificateForPending()` + `/api/training/submit-assessment` (final-exam scores fail-open silently if admin had not approved a model before the gate flipped). **Phase C** (commit `70d45fd`): student-facing `<ModelSubmissionCard>` 6-state machine on the dashboard (soft-launch banner / locked / pending review / approved / rejected with attempts left / exhausted) + `POST /api/training/model-submission` (FormData upload, attempts cap, one-pending guard, file-type + size validation, MIME normalization). **Phase D** (commit `bddb5e2`): admin review queue `/admin/training-hub/model-submissions` with filters + paginated list + review modal, `POST /api/admin/model-submissions/[id]/review` (approve / reject with reviewer note + audit log entry), `GET /api/admin/model-submissions/[id]/file` private-bucket proxy, `modelSubmissionApproved` + `modelSubmissionRejected` email templates. **Phase E.1** (commit `38a0bec`): dashboard hoists status fetch (parallel `?courseCode=3SFM` + `=BVM`), `<SessionCard>` grew an optional `lockReason` prop, Final-exam SessionCard swaps to a "Submit your model" lock when gate is on and not approved, `/training/assessment/[*_Final]` client-side gate redirects to `/training/dashboard?gate=model-submission`. **Phase E.2** (commit `9cd4f66`): Model Submission Gate admin card on `/admin/training-settings` with audit-logged toggles via `/api/admin/training-settings/model-submission-gate` (`admin_audit_log.action='model_submission_gate_change'` with before/after values). **Phase F.1** (commit `059aa40`): admin alert email fires fire-and-forget via `next/server` `after()` when a new submission lands, gated by `model_submission_admin_notify_enabled` + `model_submission_admin_notify_email` settings. **Phase F.2** (commit `68ba5de`): per-course guidance text + optional sample template URL surfaced on the student card; baked default guidance per course used when admin has not populated the setting; URL scheme restricted to `http(s)` at the read boundary. **Phase F.3** (commit `a67b4bf`): daily 08:00 UTC cron `/api/cron/model-submission-stale` emails an admin digest of `pending_review` rows older than `model_submission_stale_threshold_days` (default 2). Reuses F.1 enable + recipient settings. **Phase F.4** (commit `06074b9`): `scripts/model_submission_notice_broadcast.ts` CLI for the existing-student notice email broadcast - per-scope idempotency stamp in `training_settings.model_submission_notice_broadcast_<scope>_at` plus `--scope`/`--dry-run`/`--limit`/`--force` flags + `admin_audit_log` row per run. Cutover order: notice broadcast → wait `notice_days` → flip per-course `required_<course>` ON in admin → optionally flip `announcement_only` OFF. Force-issue (`/admin/training-hub/certificates`) keeps bypassing the gate as the admin escape hatch. **Hot-fix scope correction (commit `f09b337`, 2026-05-06)**: model-submission gate was incorrectly applied to per-session assessments (Session 2 quiz was blocked with "first upload model"). Fix scopes the gate to FINAL EXAM ONLY via a new canonical helper `src/hubs/training/lib/assessment/modelGateScope.ts` exporting `resolveIsFinal(tabKey)` (checks course's `sessions[].isFinal === true` flag plus the `_Final` suffix alias) and `looksLikeModelGateError(err)` for misleading error-message overrides. `app/api/training/questions/route.ts` + `app/api/training/submit-assessment/route.ts` + `app/training/assessment/[tabKey]/page.tsx` rerouted from `tabKey.endsWith('_FINAL')` heuristic to `resolveIsFinal(tabKey)`; `getAssessmentQuestions` in `sheets.ts` accepts and forwards an `isFinal` param so the Apps Script side never sees a Final flag for a per-session quiz. Verifier `scripts/verify-model-gate-scope.ts` (17 assertions covering S1..S18, L1..L7, _Final aliases, error detector). **Reviewed-model return (mig 185, 2026-07-07, commit `90e9ad26`):** the return leg. On APPROVE the admin can attach a marked-up reviewed model + a comment (the comment already existed as `review_note`); the student receives it via an email download LINK and in the dashboard. Additive: `model_submissions` gains `reviewed_file_path/name/size/mime` (nullable); the review route accepts multipart (decision, note, optional file) alongside JSON, uploads the reviewed file to the SAME private bucket (`reviewed/` prefix) with rollback-on-DB-failure, and passes a download URL to the extended `modelSubmissionApproved` template; new student route `GET /api/training/model-submission/[id]/reviewed-file` (training-session auth + ownership-checked proxy); the `<ModelSubmissionCard>` approved state shows the comment + a Download-reviewed-model link. Approve WITHOUT a file behaves exactly as before (exam-unlock gate reads only `status='approved'`, untouched); old submissions load fine (nullable columns, `select('*')`). Shared `modelSubmission/fileTypes.ts` helper reused by the submit/review/download routes. Mig 185 APPLIED 2026-07-07. |
| **Training Hub, WhatsApp Group Link** | ✅ Complete (migration 123) | Admin sets a `https://chat.whatsapp.com/` invite URL via `/admin/training-settings` (validated before save). When non-empty, the dashboard sidebar renders a green "Join WhatsApp Group" button beside the LinkedIn + YouTube CTAs in both expanded and collapsed states; empty value hides the button entirely. Public read via `GET /api/training/community-links` with server-side URL-shape re-validation so a malformed DB value can never leak to students. |
| **Training Hub, Transcript** | ✅ Complete | Token-gated HTML + PDF, QR code, Certificate ID, CMS-driven, ASCII-only |
| **Training Hub, Profile** | ✅ Complete | Avatar upload, name/city/country |
| **Training Hub, Live Sessions** | ✅ Complete | Full CRUD, registration/RSVP, public pages, watch tracking, email notifications, YouTube player + subscribe banner + like button + comments |
| **Training Hub, Course Attachments** | ✅ Complete | Per-lesson + per-course files, in-dashboard preview |
| **Training Hub, Share Experience** | ✅ Complete | 3-tab modal (written, video, social), both hubs |
| **Public Training Sessions** | ✅ Complete | SSR pages, public API, learn homepage preview |
| **Modeling Hub, Auth** | ✅ Complete | NextAuth JWT, 1hr session |
| **Modeling Hub, Registration + Email Confirm** | ✅ Complete | hCaptcha + email_confirmed flag |
| **Modeling Hub, Device Trust + OTP** | ✅ Complete | `modeling_email_otps`, 30-day trust cookie |
| **Modeling Hub, Resend Confirmation** | ✅ Complete | `POST /api/auth/resend-confirmation` |
| **Modeling Hub, Inactivity Logout** | ✅ Complete | `useInactivityLogout` on portal + dashboard |
| **Subdomain Routing** | ✅ Complete | next.config.ts rewrites/redirects |
| **Admin Panel** | ✅ Complete | Full admin: users, training, certificates, CMS, branding, pricing, audit |
| **Admin, Auth (unified /admin entry, 2026-04-24)** | ✅ Complete | The 4-page welcome/intermediate chain (/admin → /admin/login welcome → /admin/login form → /login callbackUrl form) was collapsed into a single entry at `/admin`. Server component checks session: authed admin → 307 `/admin/dashboard`, unauthed → render `<AdminLoginClient />` inline. No searchParams reading, no callbackUrl plumbing - post-signin destination is hard-coded to `/admin/dashboard`. Ancient files deleted: `app/admin/login/page.tsx`, `app/admin/login/LoginForm.tsx`, `app/login/page.tsx`, `src/lib/shared/safeAdminCallback.ts`. Admins now go through the SAME trusted-device OTP flow as students (the `if (user.role === 'admin') return` bypass in `authorize()` was removed; email-confirmation bypass kept because admin rows are pre-confirmed). NextAuth config: `pages.signIn` + `pages.error` both `/admin`; `callbacks.redirect` coerces any auth-cycle path to `/admin/dashboard`. Middleware owns `/login`, `/admin/login`, and `/admin/:path+` with 307 + `Cache-Control: no-store, no-cache, must-revalidate` headers so browser-cached 308s from old deployments are replaced on the first fresh hit (four progressive fix attempts - edb5772, a2ffd62, 36b0fb1, 4818896, 697d018 - were needed because the previous 308s emitted by `next.config.redirects({ permanent: true })` lacked explicit cache-control headers and `next.config.headers()` doesn't compose onto 3xx responses). |
| **Admin, Training Hub section** | ✅ Complete | Students, cohorts, assessments, analytics, comms, reset attempts |
| **Admin, Platform Analytics (2026-04-24)** | ✅ Complete | New comprehensive dashboard at `/admin/analytics` covering all 7 requested metrics: (1) total students + daily signup growth (area chart w/ cumulative overlay), (2) active 7d/30d tiles (any assessment completion OR watch-history update inside the window), (3) per-session funnel (enrolled → watched → attempted → passed, distinct emails), (4) biggest drop-off callout, (5) certificate issue rate, (6) head-to-head course comparison (stat cards + grouped bar chart), (7) live-session attendance (registered vs admin-marked attended vs watched vs completed-watched). Range filter 7/30/90/all-time applies only to growth trend; funnel / course / cert / live sections are cumulative. `GET /api/admin/analytics` fans out 8 parallel Supabase queries and aggregates server-side. Recharts. Responsive: auto-fit grids + scrollable tables on narrow viewports. Sidebar Analytics nav entry repointed from `/admin/training-hub/analytics` (now a redirect) to `/admin/analytics`. |
| **Admin, Communications (rewritten 2026-04-23)** | ✅ Complete | Compose-and-send page at `/admin/training-hub/communications` with three pre-built re-engagement templates (Never Started, Stalled ≥7 days idle, Almost Done ≥65%) auto-filled when admin picks a group. POST `/api/admin/training-hub/communications` rebuilt from scratch: `sendEmailBatch` chunked at 100 + 200ms stagger (Brevo Promise.allSettled loop since 2026-05-11 commit `166a8ec`; previously Resend `batch.send`), each message wrapped in `baseLayoutBranded()` (gold CTA button for standalone URL lines, teal inline links, organizer baked into description, paragraph lift via regex). Tokens `{name} / {full_name} / {reg_id} / {email}` resolved server-side per recipient from `training_registrations_meta` (one IN query for the whole batch). Custom-list sentinels (`name=email`, `registrationId=email`) detected and dropped so unknown recipients do not echo their email as their name. `training_email_log.status` captures real per-recipient sent/failed outcome (previously blanket 'sent' even when Apps Script was unreachable). Dropout-group filtering uses a single eligible set (`emailConfirmed && !certificateIssued`) then partitions by last_activity + passed-session counts from the roster (fixed 65% threshold vs old broken 80% vs distinct-tab-key denominator). |
| **Admin, Certificate Designer (consolidated 2026-04-24)** | ✅ Complete | Single page at `/admin/certificate-designer` with four internal tabs that consolidate what used to be four separate sidebar items: **Templates** (cert PDF + badge PNG uploads for 3SFM/BVM), **Certificate Layout** (drag-position text fields on cert PDF, was `/admin/certificate-editor`), **Badge Layout** (Cert ID + Issue Date overlay on badge PNG, was `/admin/badge-editor`), **Transcript Layout** (header drag-positioner + body/footer settings, was `/admin/transcript-editor`). `?tab=<key>` drives selection; auth + `CmsAdminNav` + page header live on parent shell; each tab is a self-contained component owning its own state. The four old URLs are now 5-line server components that `redirect()` to `/admin/certificate-designer?tab=<key>` so existing bookmarks keep working. The Templates tab's old "Issued Certificates / Sync from Apps Script" table was removed (duplicate of `/admin/training-hub/certificates`). The issued-list page (`/admin/training-hub/certificates`) keeps its own sidebar entry and its own page (revoke / force-issue / eligible-but-not-issued safety net). Sidebar entry "Certificate Designer" has `matchPaths: ['/admin/certificates', '/admin/certificate-editor', '/admin/badge-editor', '/admin/transcript-editor']` so it stays highlighted on any cert-family URL. |
| **CMS / Dynamic Nav** | ✅ Complete | `site_pages` table, admin editable |
| **CMS, Dynamic Page Builder** | ✅ Complete | 21 section types, drag-and-drop, SEO, per-field visibility checkboxes, per-field width/alignment controls. **Home page** Option B (053-063, 067-068). **Training page** Option B (065-066): 9 sections. **Modeling page** Option B (070): 7 sections. **Modeling platform sub-pages** Option B (071-072): per-platform CMS via `modeling-{slug}` pattern, Real Estate has 7 sections including stats bar. Other pages use SectionRenderer + `_dynamic` markers. Smart editors: SmartColumnsEditor, SmartTeamEditor, FounderEditor, PaceMakersEditor, CardsEditor (benefits[]/cards[] smart detect), ProcessStepsEditor (steps[] in timeline). Universal ParagraphsEditor on all sections with per-paragraph alignment. TextImageEditor: body field, audience cards, side+bg image always visible, paragraphs. CmsParagraphs shared renderer for Text, CTA, Hero, Cards, List, TextImage sections. Admin modules page shows "Content Ready ✓" / "Setup Required" per platform with page builder links |
| **CMS, Book a Meeting Page** | ✅ Complete | `/book-a-meeting`, Calendly inline embed (no redirect). Founder card header, "What to expect" checklist, Calendly widget, email + WhatsApp direct contact options, "Back to Founder Profile" link. Widget URL from `page_sections.team.content.booking_url` (admin editable). Component: `src/hubs/main/components/booking/CalendlyEmbed.tsx`, dynamic script load, guarded against duplicate injection. |
| **Email System** | ✅ Complete | Brevo (`@getbrevo/brevo` v5, migrated from Resend on 2026-05-11 commit `166a8ec`), 11 templates all using `baseLayoutBranded()` (sender-agnostic; templates were untouched in the migration). All 3 remaining triggers migrated from Apps Script to Next.js: quizResult (submit-assessment, now FINAL EXAM ONLY — per-session emails removed in the same Brevo commit; per-session results are dashboard-only), registrationConfirmation (confirm-email), lockedOut (submit-assessment when max attempts, still fires per-session). `/api/email/send` bridge kept for backwards compat. **Admin Communications** (`/admin/training-hub/communications` Send Campaign) goes through `sendEmailBatch` + `baseLayoutBranded()` (Brevo Promise.allSettled loop with binary ok/fail semantics; previously Resend `batch.send`). Per-recipient outcomes drive the `training_email_log.status` column (sent / failed). `{name}` token in the body resolves to the recipient's first name. |
| **Live Session Email Automation** | ✅ Complete | Auto-announcement on publish (or manual), 24h + 1h reminders (cron daily 6AM UTC - Hobby plan limit), recording-available email, 4 CMS-editable templates with placeholders, test send, admin Email Settings page |
| **Live Session Announcement Reliability** | ✅ Complete (migration 138, 2026-04-22) | Rebuilt end-to-end after a 4-of-9 partial failure during testing. `sendEmailBatch()` in `src/shared/email/sendEmail.ts` originally wrapped Resend's `batch.send([...])` (one HTTP request per 100 recipients, one rate-limit slot instead of 10 parallel bursts). Migrated to Brevo on 2026-05-11 (commit `166a8ec`): one request per item over `transactionalEmails.sendTransacEmail` (Brevo has no per-item batch endpoint), with binary ok/fail semantics preserved (any per-item failure marks the batch failed; `ids[]` only populated when ok=true). **2026-06-13 hardening:** the first Brevo shim fired the whole batch at once (`Promise.allSettled` over every item), reintroducing the concurrent burst the Resend `batch.send` had removed; `sendEmailBatch` now sends in THROTTLED WAVES of 10 with a 200ms inter-wave pause (`ids[]` stays index-aligned). Diagnosed end-to-end: Brevo delivered all 78, DKIM/SPF/DMARC valid, not blacklisted - the original "not received" report was Gmail tab placement, not a send failure (see memory `project_live_session_announce_deliverability`; read-only probes `scripts/diagnose_announce.ts` + `diagnose_brevo_events.ts` + `verify_announce_delivery.ts`). **Same-day `liveSessionNotification.ts` body fixes:** (1) `descriptionToEmailHtml()` preserves the plain-text session description structure (blank line→block, `•` lines→`<ul>/<li>`, `\n`→`<br>`, HTML-escaped, Unicode-bold headings kept) to match the session page's `white-space:pre-wrap`; (2) date box + View & Register CTA moved ABOVE the long description so the CTA is never hidden behind Gmail's "•••" trimmed-content toggle; (3) `greetingName()` greets by roster profile name (`r.name`), prettifies an email only when no name exists, else "Student"; (4) **timezone fix** - session date/time formatted with `timeZone: <session>.timezone` (was the server TZ, so a 6PM Asia/Karachi session showed 1PM on the UTC Vercel server); same fix applied to the registration-confirmation + `buildSessionPlaceholders` + the two `live_session_scheduled` auto-newsletter paths. The `announcement_recipient_log.resend_message_id` column name was deliberately retained for backwards compatibility; it now stores Brevo message ids. New child table `announcement_recipient_log` (migration 138) with per-recipient `status` (pending/sent/failed/bounced/complained), `resend_message_id`, per-row `error_message`, partial index on failed rows. Notify route seeds all recipients as `pending` before the batch fires, UPDATEs each to `sent` or `failed` from the response, recomputes aggregate counts on the parent `announcement_send_log` row so retries reflect reality. Two new POST modes: `recipientEmails: string[]` (explicit picker allowlist + test-send), `retrySendLogId: string` (re-attempt only the failed/bounced rows of a prior dispatch, in place on the same audit row). Course filter `target: '3sfm'\|'bvm'\|'all'` now actually wires through a `training_enrollments` JOIN - the "decorative filter" comment in the route is gone. Admin picker modal (`/admin/training-hub/live-sessions` → Send Announcement): search bar, course filter pills, per-row checkboxes, "Send to myself only", "Select all (filtered)", "Clear selection", "Preview to my inbox"; after send switches to per-recipient status table with pills + CSV export + "Retry N Failed" that only re-sends the bad rows. Announcement email template no longer leaks the Teams join URL - the "Direct join link" footnote was removed, replaced with "Register to get the join link, calendar invite and session materials"; registered students still get the link via `registrationConfirmationTemplate` + reminder emails. |
| **Teams Calendar Integration (real Outlook events + host invite)** | ✅ Complete (2026-04-22, commits 698f991 + 8db26e8) | Switched from `POST /users/{id}/onlineMeetings` (URL-only meeting) to `POST /users/{id}/events` with `isOnlineMeeting:true` + `onlineMeetingProvider:"teamsForBusiness"` so Outlook: (a) writes a calendar entry on the host's Outlook/Teams calendar, (b) creates the Teams meeting + auto-renders the Join button in the event body, (c) fires the standard "Microsoft Teams meeting" invitation email to the organizer. Requires Azure `Calendars.ReadWrite` (Application) with admin consent (added to the tenant 2026-04-22, `~30 min` propagation). New helpers in `src/integrations/teams/teamsMeetings.ts`: `createCalendarEventWithMeeting`, `updateCalendarEvent`, `deleteCalendarEvent`, `toGraphDateTime` (UTC ISO → Graph `dateTimeTimeZone` via `sv-SE` locale, `Asia/Karachi` default). Backwards-compatible wrappers `updateMeetingOrEvent` / `deleteMeetingOrEvent` try `/events` first and fall back to legacy `/onlineMeetings` on 404, so pre-migration session rows (whose `teams_meeting_id` holds an online-meeting id, not an event id) remain editable and deletable with no DB migration. Two follow-up fixes (commit 8db26e8): stopped sending `body` on POST + PATCH because custom body suppresses Outlook's auto-injected Teams Join block; added the host as a single `required` attendee because empty `attendees[]` makes Outlook skip the invitation email. Legacy `createTeamsMeeting` / `updateTeamsMeeting` / `deleteTeamsMeeting` stay in the file as the fallback leg of the wrappers. |
| **Modeling Hub - Admin Post-Login Bypass** | ✅ Complete (2026-04-22, commit 6c29bf5) | Before this fix, `ensureNotComingSoon('modeling')` in `src/shared/comingSoon/guard.ts` redirected every visitor to `/signin` regardless of admin role - so even admins who logged in successfully were bounced back to "Launching Soon" the moment they hit `/refm` or any other gated `/modeling/*` segment. The guard now resolves NextAuth session server-side and bypasses redirect for `role === 'admin'` OR `isEmailWhitelisted(email)`. `/modeling/signin` + `/modeling/register` pages additionally auto-redirect already-logged-in admins (and any authed user when the toggle is off) straight to `/modeling/dashboard` so the CS page is never rendered for a valid session. The dashboard's stale-session bounce-back now uses `/signin?bypass=true` so a returning admin with expired JWT lands on the real sign-in form instead of the CS countdown. Training Hub guard behavior unchanged (still redirects non-bypassed visitors to `/signin`). |
| **Course Player Sidebar - Collapse + Mobile Drawer** | ⚠️ Removed 2026-04-23 | `CoursePlayerLayout` no longer renders a session-list sidebar. The sidebar (full 240px nav rail with chevron-collapse + mobile off-canvas drawer + "Sessions (N)" pill) was a distraction during watching. Replaced with a single `← Back` button in `CourseTopBar` driven by the existing `backUrl` + `backLabel` props. After Mark Complete + assessment the student naturally lands back on the course view. The `sessions` and `currentSessionId` props on `CoursePlayerLayout` are now optional and ignored (kept for backward compat with callers that still pass them). The `fmp_player_sidebar_collapsed` localStorage key is no longer read or written. |
| **Course Player - Mobile Video Fix** | ✅ Complete (2026-04-22, commit 2282e47) | Students reported the video iframe was "missing" on phones even though the top bar, notes, and comments panels all rendered. Root cause: the Screen-2 video wrapper set `aspectRatio: 16/9` while wrapping `YouTubePlayer` which already uses a padding-bottom 56.25% trick (`height: 0`). With no explicit width and a height-zero child, the aspect-ratio resolved to a 0x0 box inside the mobile flex column - iframe loaded but was invisible. Fixed by replacing the wrapper with `width: 100%, background: #000` and letting YouTubePlayer's own responsive container handle 16:9. Also added a mobile-only `useEffect` that auto-opens `videoOpen` so the player is the first content the student sees (desktop still shows Screen 1 banner + description + click-to-watch). `CourseTopBar` action buttons are now `flexWrap: wrap` to stop horizontal overflow of 6+ action buttons on 375px viewports. Cascades automatically to `/training/watch/*`, `/training/live-sessions/*`, and the public `/training-sessions/*` detail since all three use `CoursePlayerLayout`. |
| **Platform Walkthrough Video** | ✅ Complete (2026-04-22, commit 16dee47 + afe167c + b9e7201) | Admin pastes a YouTube / Vimeo / generic URL into `/admin/training-settings` under the new "🎥 Platform Walkthrough Video" card. Stored in `training_settings.platform_walkthrough_url` - no migration, the existing K/V table absorbs new keys natively. Button renders in the Training Hub dashboard hero's right column (flex row with welcome text on the left) so it does not add vertical height; gold gradient (`#C9A84C → #D4AF37`, navy text) to match the Points stat / 100%-progress / Certified-badge accent already in use. Click opens a fullscreen modal with an embedded iframe: YouTube IDs route through `youtube-nocookie.com/embed/{id}?autoplay=1&rel=0&modestbranding=1` (no cookies, no related-video end screen); anything else (Vimeo / self-hosted) gets a generic iframe of the URL plus a fallback "Trouble loading? Open in new tab →" rescue link. Modal closes on Escape / X / backdrop tap. Empty URL = button hidden, no broken or disabled state. Public read: `GET /api/training/community-links` extended to also return `platformWalkthroughUrl` alongside `whatsappGroupUrl` with server-side URL-shape re-validation. |
| **Apps Script Integration** | ✅ Complete | Register student, fetch registration ID, attendance |
| **REFM Module 5 (Returns & Valuation) (2026-06-01, commits `9095ae7` + `19f0292` + `1c2d149`)** | 🟡 WIP, full module shipped. Pure engine `src/core/calculations/returns/` (IRR Newton+bisection, MOIC, NPV t=0, fractional payback, terminal value exit-multiple/perpetuity, RE-metric primitives all null-guarded). Resolver `returns-resolvers.ts` `computeReturnsSnapshot(snap, project)` builds 3 signed streams (FCFF unlevered / FCFE levered / Dividends realised) + step-by-step `buildup` component lines + terminal value + RE-metric feeders. UI: **Returns tab** (assumptions: discount rate / exit year / terminal method+inputs; IRR/MOIC/NPV/Payback KPIs across all 3 bases; per-stream table; signed streams; FCFF/FCFE/Dividend step-by-step build-up tables) + **RE Metrics tab** (Yield on Cost, Cap Rate, Development Spread, Profit on Cost/Margin, Equity Multiple, LTV at Exit, Debt Yield, Min/Avg DSCR, Interest Cover, Cash-on-Cash + per-period coverage). Additive `Project.returns` config. Sidebar enabled (modules-config module5 disabled→false, soon→wip; m5Tabs in RealEstatePlatform). Dividends sized by FS Cash Sweep + Dividend policy (not the funding gap), flow into Returns. Verifiers `verify-returns-engine` 44/44 (Excel cross-checked) + `verify-returns-snapshot` 30/30. |
| **REFM Module 4 (Financial Statements) (2026-05-20 → 2026-06-01)** | 🟡 WIP, BALANCES BY CONSTRUCTION. P&L + Direct/Indirect CF + BS + Schedules, all from `computeFinancialsSnapshot`. BS reconciles AND Direct==Indirect every period. **2026-06-01 fixes:** Indirect-CF inventory + interest double-count (`0ac4020` + `ad907e1`), capex-past-handover BS floor (`f0a3575`), BS-tab AP-link omitting HQ AP (`cf6200d`). Funding Methods 2/3 calculate + gap-sized drawdown via guarded two-pass (`03a18ec` → `7d340fc`); BS balances + Direct==Indirect for all 4 methods. Verifiers: m4-bs-reconciliation 184, m4-reconciliation-broad 24, bs-hq-ap-link 5, funding-methods 45. |
| **REFM Module 3 (Operating Expenses), Pass 3-4 (2026-05-19, commits `aef0126` + `b121b20`)** | 🟡 WIP, Pass 3 + Pass 4 polish in. **Pass 3** (`aef0126`) moved inflation off per-line config onto an asset-level (and HQ-level) default with per-line override. % of revenue and % of GOP lines are now hard-skipped by the engine (auto-escalate via revenue stream); only fixed-cost modes (fixed_baseline / per_room_year / per_sqm_year) accept inflation. Schema: `Asset.opex.defaultIndexation` + `Project.hqOpex.defaultIndexation` + `OpexLine.useAssetDefault`. UI: 4-pill Off / Flat / Compound / Per-Year `InflationPanel` at the top of each asset card and HQ card; line table Inflation column shows `— auto via revenue` for % lines and `Inherits: <method> <rate>` + Override for fixed lines. Resolver auto-seeds `defaultOpexIndexation()` (3% yoy_compound) so legacy snapshots produce identical numbers. **Pass 4** (`b121b20`) added per-line Single/YoY rate mode (`OpexLine.rateMode` + `yoyRates?: number[]`) so each cost line can either be one value compounded by Asset Inflation OR a per-period rate array that bypasses inflation entirely. UI: new Rate column with Single / YoY pill toggle; YoY rows expand a per-period rate strip below. Output tab rewritten: dropped inline GOP/NOI flow, restructured to category-wise tables per asset (Hospitality: Revenue Breakdown → Direct → Indirect → Management → Reserves; Retail: Revenue Breakdown → Property Operating → Recoveries (memo) → Other Charges). Project rollup at the bottom uses the same category headers, one row per contributing asset. Retail lite seed adds `repairs_maintenance` category and rewrites `defaultLeaseOpexLines` to 7 lines (Property mgmt / R&M / Insurance / Utilities / Service charge recoverable / Property tax / Reserves). Verifier `scripts/verify-opex.ts` **38 / 38** (A-E preserved, F-series pins Pass 3 inflation rules, G-series pins Pass 4 YoY rules). |
| **Sidebar Universal Module Tabs (2026-05-19, commit `7c631f4`)** | ✅ Complete | RealEstatePlatform exports a single `MODULE_TABS` record keyed by module key { module1: m1Tabs, module2: m2Tabs, module3: m3Tabs }; Sidebar.tsx now reads sub-tabs from this map instead of hard-coded `isModule1`/`isModule2` branches. Module 3 immediately gets the same Inputs / Output dropdown as M1 and M2 with zero per-module code. Future modules (M4/M5/M6) just add their tabs to the map; the sidebar code stays untouched. |
| **REFM Module 3 (Operating Expenses), Pass 1-2 (2026-05-18, commits `8884d1b` → `062c168`)** | 🟡 WIP, line-item engine + Inputs/Output UI shipped | Per-asset Opex build for Hospitality + Lease, plus project-wide HQ overheads. **Engine** `src/core/calculations/opex/` (5 files: types / assetOpex / hqOpex / defaults / index). `OpexLine` with 9 modes (`fixed_baseline`, `pct_of_room_rev`, `pct_of_fb_rev`, `pct_of_other_rev`, `pct_of_total_rev`, `pct_of_lease_rev`, `per_room_year`, `per_sqm_year`, `pct_of_gop`) and 19 categories (3 direct + 6 indirect + 4 mgmt/reserve + 4 fixed charges + 4 HQ + other). Each line carries its own `IndexationConfig` (same shape as M2 revenue). Two-pass evaluation: Pass A resolves every non-GOP line; Pass B aggregates Direct + Indirect, derives GOP = Revenue − Direct − Indirect, then fills `pct_of_gop` lines. `AssetOpexResult` exposes per-line per-period arrays + bucket aggregates (direct / indirect / mgmt / other) + GOP + GOP margin + NOI. HQ engine restricted to fixed_baseline + pct_of_total_rev. KPMG SC7-mirroring default seeds: 15 hospitality lines (rooms / F&B / other dept directs, G&A / IT / S&M / POM / Energy / EOSB indirects, mgmt base / tech / incentive, replacement reserve, rent & insurance, property tax), 5 lease lines (property mgmt, CAM, utilities, insurance, property tax), 4 HQ lines (payroll, office, professional, other). **Resolver** `lib/opex-resolvers.ts`: `computeAllOpexResults(state, revenueSnap)` walks every non-Sell asset, builds per-asset OpexRevenueContext from M2 (room / F&B / other / total / lease per period), resolves [opsStartIdx, opsEndIdx] from phase + operationsStartYearOverride, derives total keys / leasable sqm from M1 sub-units, calls computeAssetOpex + computeHQOpex against project total revenue. Returns `ProjectOpexSnapshot` { byAsset, projectTotals (5 buckets + GOP + NOI), hq, totalOpexPerPeriodInclHQ }. Default-seeds when an asset / project has no opex config. **Schema**: `Asset.opex.lines[]` per-asset + `Project.hqOpex.lines[]` project-wide. Both optional. **UI**: `Module3Opex.tsx` (Inputs tab) phase-grouped collapsible asset cards mirroring M2 layout; per-asset OpexLineTable with mode-aware value cell (PercentageInput for pct_* modes, AccountingNumberInput otherwise), inflation toggle + rate, on/off checkbox, remove + add-line. HQ section at top. Seed defaults button per empty asset. `Module3OpexOutput.tsx` (Output tab) per-asset narrative: Drivers (Total Revenue) → Direct → GOP + margin → Indirect → Mgmt + reserve → Other fixed charges → Bottom line (Total Opex + NOI). HQ + Project Total tables at the bottom. PeriodTable supports rowFmt + aggregation ('sum' / 'last' / 'avg'). Module 3 status flipped 'soon' → 'wip' in modules-config. New exported `m3Tabs` in RealEstatePlatform. **Verifier** `scripts/verify-opex.ts` **26 / 26 green**: A-series Hospitality directs / indirects / GOP / mgmt incentive % of GOP / NOI / GOP margin (12 tests); B-series Lease % of lease rev / per-sqm CAM with inflation / property tax / insurance / total opex / no stray per_room lines (6); C-series indexation YoY compound 3% ratio (1); D-series disabled line stays zero, drops the indirect bucket (2); E-series HQ engine fixed_baseline + pct_of_total_rev + total (5). Reference benchmark structure walked through: KPMG SC7 hospitality opex hierarchy (departmental directs + undistributed indirects + mgmt fee base/tech/incentive + replacement reserve + rent & insurance) + v1.16 P&L grouping (Hospitality / Retail per-asset opex + HQ Expenses → EBIZDA shape). Every reference number stays configurable per `[[feedback_reference_model_only]]`. **Inputs polish** (commit `faf16c8`): asset filter tightened to Operate + Lease only (Sell + Manage parents + pure Sell excluded; companions still in via strategy='Operate'); strategy badge updated to "Hospitality" / "Hospitality (Manage side)" / "Retail / Lease"; **Apply to all Hospitality / Retail** button per asset card clones the current asset's lines onto every other same-strategy asset with fresh per-asset line ids; per-line Inflation column rewritten as three always-visible segmented buttons (Off / Flat / Yearly — commit `062c168`); Yearly auto-renders a per-year % strip on the row below (uses engine's existing `yoy_per_period` indexation method). **Phase startDate cascade** (commit `50a4c89`): updatePhase now slides per-period arrays so user data stays anchored to its phase's calendar years. Storage is project-axis-indexed (arr[0] = first project year); axis origin = min(phase startYears). Moving the EARLIEST phase shifts the origin, which would otherwise misalign every OTHER phase's data in absolute terms. Cascade computes phaseDelta + originDelta, shifts changed phase's assets by (phaseDelta - originDelta), shifts other phases' assets by (-originDelta) to counter the origin move, and syncs project.startDate. `shiftAssetPerPeriodArrays` helper covers every project-axis array on Asset.revenue (Sell pre/post velocity, cash + recognition % strips, indexation growthPerPeriod, Operate ADR ramp + occupancy + keysParticipation + fb/otherRevenue per-period arrays + indexation, Lease occupancy + rentIndexation) and Asset.opex (every line's indexation.growthPerPeriod). **Remaining for M3 LOCK**: Pass 3 (Schedules feed extension surfacing per-asset opex lines for M4 to consume + AP roll-forward DPO-driven + optional capex capitalize wire-back to M1 Tab 3 for pre-operating lines), Pass 4 (extended verifier covering more reference benchmark scenarios + LOCK). |
| **REFM Module 2 (Revenue), Phase 1 Residential Sell (M2 Passes 1-6, 2026-05-16)** | 🟡 WIP, Residential Sell flow live through Pass 6 (windowed inline form). **Pass 5** (commit `b45e25e`): UI redesign per user feedback. `RealEstatePlatform.canAccess` fixed - returns true for any module with `requiredPlan === 'free'` (previously returned false for every featureKey, silently lock-iconing Module 1 + Module 2 and intercepting clicks). Page rebuilt from strategy-grouped grid to phase-wise sections matching M1 Tab 2 (navy phase header bar, click to collapse, per-phase localStorage memory). Simple inline inputs per Sell asset (velocity grid + cash profile strip + recognition method pill). Complex modal demoted behind an Advanced button. Multi-cohort lock: when extra cohorts exist (set in Advanced), inline grid becomes read-only with amber "N cohorts - edit in Advanced" chip. Writes go directly via `updateAsset` (no draft state). **Pass 6** (commit `44dda8f`): per-asset construction-anchored windows + pre/post split + sale price display. AssetCard derives windows from phase fields (`constructionStartIdx`, `handoverYear`, `operationsStartIdx`, `operationsEndIdx`). Single velocity section replaced with two scoped sections: "Pre-Sales velocity · Construction \<year\> to \<year\>" (only construction-year columns, handover `*`-marked) and "Post-Sales velocity · Operations \<year\> to \<year\>". Cash profile strip scope tightened to `constructionStart..operationsEnd`. Sub-unit row labels show sale price inline read from `unitPrice + metric` (e.g. "1 BR · SAR 1,599,000 / unit"). `setCohortVelocity` gains `kind: 'pre' \| 'post'`. `InlineGrid` + `InlineProfileStrip` take `WindowCell[]` instead of `yearLabels + handoverYear`. Storage stays project-axis-indexed; only UI window changes.\n\n**Earlier passes (1-4):** Pass 1 shipped Module 2 sidebar entry + asset-list shell + new `'wip'` ModuleStatus / `.badge-wip` amber pill. Pass 2 shipped pure engine at `src/core/calculations/revenue/` (9 files: types / indexation / cohort / payment / recognition / escrow / sell / reconcile / index). `ProfileMode = 'absolute_with_catchup' \| 'relative_to_sale'` configurable per cohort. Cohort matrix is the shared mechanic for both cash and recognition (matches the reference model rows 46-50 + 181-184). `Asset.revenue?.sell?` schema added additive. Verifier `scripts/verify-revenue-rebuild.ts` Fixture A (synthetic) + Fixture B (the reference model T2, pre-sales 2,539,827 SAR'000 reconciles within 0.0014%). Pass 3 shipped per-asset form modal (now Advanced view) with 2-col body + live preview. Pass 4 shipped multi-cohort support: engine adds `Cohort` type + `AssetSellConfig.cohorts?` (additive), velocity cap global across cohorts. Fixture C (2-cohort 50/50 split = identical totals) + Fixture C2 (overflow flagged). **Verifier total: 76 pass / 0 fail / 76**. **Remaining for Phase 1 lock**: surface five output schedules per asset + project; Sales During Operation surfacing; indexation editor + verifier fixture with indexation on; dashboard hook + M2 KPI tiles; Phase 1 verifier-script per `feedback_phase_verification_workflow` and LOCK. Then Phase 2 Hospitality, Phase 3 Lease, Phase 4 Sell+Manage. |
 | Pure-engine + form-modal stack for Residential Sell. **Pass 1** (commit `3e9c453`): Module 2 sidebar entry + asset-list shell grouped by strategy (Residential Sell / Hospitality Operate / Lease / Sell+Manage). New `'wip'` ModuleStatus with `.badge-wip` amber pill. `Module2Revenue.tsx` shows per-asset cards with phase + type + status + sub-unit summary; Configure Revenue button is live for Sell, stubbed for the other 3 strategies. **Pass 2** (commit `8ebaa80`): pure engine at `src/core/calculations/revenue/` (9 files: types / indexation / cohort / payment / recognition / escrow / sell / reconcile / index). `ProfileMode = 'absolute_with_catchup' \| 'relative_to_sale'` configurable per cohort so the engine serves the wider real estate market, not just the reference model's regional convention (per `feedback_reference_model_only`). Cohort matrix is the shared mechanic for both cash and recognition (matches the reference model rows 46-50 + 181-184: cohort sold in year N catches up the cumulative profile through N as a lump at N, then per-profile in later years). `Asset.revenue?.sell?` schema added additive (no SCHEMA_VERSION bump). Verifier `scripts/verify-revenue-rebuild.ts` Fixture A (synthetic PIT, 14 assertions) + Fixture B (the reference model T2 with both 1BR + 2BR sub-units, over-time profile [0.30,0.30,0.30,0.10], escrow 4% release Y6 - pre-sales total 2,539,827 reference-currency'000 reconciles within 0.0014% on every cell). **Spec deviation flagged**: spec's "cumulative cash >= cumulative recognition" identity dropped from reconciler - false for PIT with deferred milestones AND for over-time when recognition front-loads ahead of cash (both observed the reference model behaviours). Universal totals identity already covers correctness. **Pass 3** (commit `4574b97`): per-asset form modal `Module2SellModal.tsx`. 1180px modal with 2-col body: left (velocity grid rows=sub-units cols=years with pre + post stacked rows, cash payment profile %-per-year strip, recognition method picker + over-time profile strip + PIT anchor select, escrow block enabled+heldPct+releaseYear, indexation block); right (live preview table for 5 streams + reconciliation chip with per-identity list, updated on every keystroke). Handover year highlighted blue with * marker. FAST blue inputs. Configure Revenue button opens modal; label flips to 'Edit Revenue Config' when `asset.revenue.sell` exists. Save commits via `updateAsset`. **Pass 4** (commit `83de2ac`): multi-cohort support. Engine adds `Cohort` type + `AssetSellConfig.cohorts?: Cohort[]` (additive). Each cohort runs its own cash + recognition pipeline with cohort's own profile (or asset-level fallback) and per-sub-unit price override. Velocity cap is GLOBAL across cohorts per sub-unit (cumulativeShareBySubUnit map) so "no sub-unit oversells" invariant holds across launches. Reconciler velocity-sum-bound identity sums across cohorts. UI: cohorts tab bar with +/× controls + inline rename; selected cohort scopes velocity grid + Price Override section. Backward compat: Pass-3 configs without cohorts migrate to single Cohort 1 on modal load. Verifier Fixture C: 2-cohort 50/50 split of B MUST sum cell-for-cell identical (28 assertions, every delta=0.00). Fixture C2: cross-cohort velocity overflow flagged. **Verifier total: 76 pass / 0 fail / 76**. **Remaining for Phase 1 lock**: Pass 5 (five output schedules surfaced per asset + project), Pass 6 (Sales During Operation post-handover surfacing), Pass 7 (indexation editor + verifier fixture with indexation on), Pass 8 (dashboard hook + M2 KPI tiles), Pass 9 (Phase 1 verifier-script per `feedback_phase_verification_workflow` and LOCK). Then Phase 2 Hospitality, Phase 3 Lease, Phase 4 Sell+Manage. |
| **REFM Module 1, M2.0j Costs Audit + Display Fixes (Phase M2.0j, 2026-05-07)** | ✅ Complete (Module 1 production-ready) | 16 audit + display + structural fixes after M2.0i. Schema stays v8; phasing value-set narrows but read-side accepts legacy values. **Fix 1**: `Phase.constructionPeriods` accepts 0; `computePhaseTimeline` returns `operationsStart === phase.startDate` when cp=0; Tab 1 displays "Operational from start" caption. **Fix 2**: `Asset.type` defaults to '' on add; `resolveTypeCatalog` returns the union of all per-category catalogs for Mixed-Use / Custom; placeholder + "Type (optional)" label. **Fix 3**: Land Parcel rate column header reads `{currency}/sqm`; effective NDA rate `{currency}/NDA sqm`. **Fix 4**: comment in formatter explaining UI vs export differences; new `formatScaledForExport` helper (no K/M suffix). **Fix 5**: `formatPercent` default decimals 1→2; new `formatArea(num, decimals)` helper (no scale conversion); ParcelRow threads scale + decimals + rate / NDA / total cells use `formatScaled` / `formatArea`; parcels totals row reformats live. **Fix 6**: SubUnitRow bidirectional sync, when metric=Units, both Count AND Area editable; switching preserves area sqm; inline "Unit Size required" warning when metric=Units AND unitArea=0. **Fix 7**: New `AccountingNumberInput` primitive at `src/hubs/modeling/platforms/refm/components/ui/AccountingNumberInput.tsx`. Renders raw type=number on focus + accounting-formatted text on blur. Wired into cost line Value, parcel rate, sub-unit unitPrice. Percent-method values stay scale='full'. **Fix 8**: `costLineCaption` helper in `@core/calculations` returns "Rate × BUA Total → 4,500 × 130,874 sqm BUA = 588,933,000 SAR" caption per method. Cost row renders inline below the value cell. Threads asset metrics through metricsByAsset map → AssetCostSection → CostRow. **Fix 9**: New `COST_PHASING_OPTIONS` export ['even', 'manual']; legacy values ('frontloaded' / 'backloaded' / 'sCurve' / 'phase_aligned') still acceptable on read but folded to 'even' on save via `migrateM20jPhasing` (idempotent migration step in stripWrapper). UI dropdown shows only Even + Manual %. **Fix 10**: New `costLinePeriodEndDate` + `costLineProjectPeriodIndex` helpers. Tab 3 cost row periodLabel now phase-scoped (uses phase.startDate when set). Phase 2 (start 2026-01-01) Y1 displays "Dec 26", not "Dec 25". **Fix 11**: Capex by Period rows offset perPeriod[] by `(phaseStartYear - projectStartYear)` so Phase 2 Y1 lands in project column "Dec 26"; SummaryTables receives `phases` prop + `key={`summary-${granularity}`}` to force a clean remount on Annual / Quarterly / Monthly toggle. **Fix 12**: Capex by Period filters out asset rows with assetTotal=0. **Fix 13**: Stage label ("Land · custom") removed from cost line UI; only 'custom' marker stays for custom lines. Stage stays internal. **Fix 14+15**: Capex by Stage / Capex Summary by Treatment / Capex by Cost Type per Asset all removed from Tab 3 Results. Capex by Period is the single remaining summary. **Fix 16**: New asset selector bar at top of Tab 3 Inputs with "All Assets" + per-asset buttons. Selecting one asset filters per-phase sections + summary cards. 3 summary cards beneath cost lines: Excl. Land / Excl. Land In-Kind / Incl. Land In-Kind, computed via new `computeAssetCostSummaryFromBreakdown` helper. Verifier `scripts/verify-m20j.ts` (60 pass / 0 fail / 2 skip without dev server) + Playwright `tests/e2e/m20j-costs-audit.spec.ts` (8 specs + dark-mode). New file: `src/hubs/modeling/platforms/refm/components/ui/AccountingNumberInput.tsx`. Commits 8d3fdc0 (Fix 1+9), b3b7747 (Fix 2+3+4+5 partial), 8d6c986 (Fix 6), 60d0c03 (Fix 7+8+10+12+13+14+15), 7e54f9a (Fix 11+16), 34d113f (verifier+Playwright), 1c00c3c (docs sweep), 99da9a4 (tsc fix). |
| **Phase P-Sync, Platform & Module Admin Sync (2026-05-07)** | ✅ Complete | Three-way source of truth between admin dashboard, REFM workspace sidebar, and public marketing site. Closes the loop between three previously disjoint module/platform listings (the static `MODULES` constant in REFM, the legacy `modules` table in admin, and the hardcoded marketing `PLATFORMS` config) by introducing **two new Supabase tables** (`platform_modules`, `platform_module_pages` via migration `p_sync_platform_modules.sql`), a **public API surface** (4 endpoints), an **admin two-level UI** (`/admin/platform-modules` + `/admin/platform-modules/[id]/pages`), a **dynamic REFM sidebar fetch** (usePlatformModules hook with static fallback), and a **public marketing page set** (`/modeling-hub` + per-platform + per-module). Schema: `platform_modules` (per-platform sub-modules with status: live/coming_soon/hidden/pro/enterprise + gating_tier: free/pro/enterprise + features jsonb + screenshots jsonb) + `platform_module_pages` (page_section: hero/features/how_it_works/cta/testimonials, content_blocks jsonb). RLS public-read filters status='hidden' / visible=false; service-role bypasses for admin writes. Cascade delete on module pages. updated_at trigger. Seeded with 11 REFM modules at M2.0i state + Module 1 page content. Lib: `src/shared/cms/platform-modules.ts` exports PlatformModule + PlatformModulePage interfaces, 9 helper functions (getPlatformModules / getPlatformModuleBySlug / getPlatformModulePages / getPlatformModuleWithPages public reads + adminListPlatformModules / adminListPlatformModulePages / adminUpsertPlatformModule / adminDeletePlatformModule / adminUpsertPlatformModulePage / adminDeletePlatformModulePage admin writes + getSectionContent typed extractor), 5 typed content interfaces (HeroContent / FeaturesContent / HowItWorksContent / CtaContent / TestimonialsContent). API routes: `GET/POST /api/platforms/[platformSlug]/modules` (public list + admin create), `GET/PATCH/DELETE /api/platforms/[platformSlug]/modules/[moduleSlug]` (public single + admin update/delete), `GET/POST /api/admin/platform-module-pages` (admin list + upsert), `PATCH/DELETE /api/admin/platform-module-pages/[id]` (admin update/delete). Cache-Control: public, s-maxage=300 on public reads. Admin UI at `/admin/platform-modules`: Level 1 platform tabs (REFM/BVM/FPA/...) reading legacy `modules` table, Level 2 modules table per active platform with inline create/edit/delete + status cycling + features textarea. Per-row link to `/admin/platform-modules/[id]/pages` (5-section editor: hero/features/how_it_works/cta/testimonials with JSON textarea + visibility toggle + pre-seeded templates). CmsAdminNav grew "Platform Modules" 📚 entry under Modeling Hub group. REFM sidebar dynamic fetch via `src/hubs/modeling/platforms/refm/lib/usePlatformModules.ts` hook; falls back to STATIC_SIDEBAR_MODULES (computed from MODULES constant) during inflight or on fetch error. Sidebar.tsx accepts optional `modules` prop. Marketing site: `/modeling-hub` (overview grid of platforms reading legacy modules table), `/modeling-hub/[platformSlug]` (per-platform overview with modules grid), `/modeling-hub/[platformSlug]/[moduleSlug]` (per-module marketing page rendering hero + features + how_it_works + testimonials + cta). All three use NavbarServer + SharedFooter and pull footer copy from cms_content. ISR `revalidate=60`. Verifier `scripts/verify-psync.ts` (70 pass / 0 fail / 3 skip without dev server) covering 18 SQL marker checks + 4 route file checks + 20 lib helper checks + 26 source markers + em-dash sweep across 12 new files + Playwright presence/run gate. Playwright `tests/e2e/psync-flow.spec.ts` (4 specs targeting marketing surface + public API). 8 commits: 5c418e3 (SQL migration), 3e9bb89 (TypeScript types + lib helpers), c7829b7 (API routes), b902b15 (Admin 2-level UI), 545642a (REFM sidebar dynamic fetch), 6049109 (Marketing site pages), b99676b (verifier + Playwright), 9bbefa5 (docs sweep). |
| **REFM Module 1, M2.0i Module 1 final polish (2026-05-07)** | ✅ Complete | 10 fixes closing M2.0h. Drop modelType input + Display Settings (Scale + Decimals) panel + Parking Bays drop + units/area metric rename + strategy short labels + sticky sidebar + compact reconciliation + operational phase historical baseline. Verifier `scripts/verify-m20i.ts` (59 pass / 0 fail / 2 skip without dev server) + Playwright `tests/e2e/m20i-final-polish.spec.ts` (7 specs + dark-mode). |
| **REFM Module 1, M2.0 → M2.0g rebuild on v5/v6/v7/v8 schema (2026-05-06)** | ✅ Complete (Module 1 production-ready on v8) | **M2.0** (v5 hard-cut spec rebuild): flat Project → Phase → Asset → SubUnit hierarchy replaces v3/v4 Master Holding / Sub-Project / Plot / Zone / FAR / Cascade. 4 tabs: 1. Project & Phases, 2. Assets & Sub-units, 3. Costs, 4. Financing. ProjectWizard collapses to 3 steps. Single 47.8 KB v5 baseline replaces the 3 pre-M2.0 baselines. Pre-v5 snapshots flag with explicit "Schema migrated to v5. Please recreate" error (hard-cut policy). **M2.0b** restores the FMP brand-styled shell on v5 (navy gradient topbar, gold logo, FAST sidebar, KPI dashboard, branded modals, dark-mode toggle); 5 commits. **M2.0c** schema bumps v5→v6: open-ended CostLine catalog (id: string, custom + seed coexist via isLocked), 13 cost methods (rate_per_*, percent_of_*), 6 phasing curves (even/frontloaded/backloaded/sCurve/manual/phase_aligned), 5×5 financing matrix (5 drawdown × 5 repayment). **M2.0d** schema bumps v6→v7: AssetStrategy 'Hybrid' renamed 'Sell + Manage' (the reference Sell+Manage example pattern), 9-line cost catalog with stable ids, classifyAssetCapex per strategy (Sell/Sell+Manage → COGS, Operate/Lease → FixedAssets + depreciation), computeCashFlowImpact for in-kind equity, custom cost popup (stage at create-time). **M2.0e** wizard simplification + Tab 2 full asset entry (additive on v7): wizard Step 2 unit suffix + Phase Start Date column, Step 3 collapses to project-type radio (6 types), Tab 2 phase grouping + Asset card Phase/Status dropdowns + sub-unit Rate Unit column. **M2.0f** structural fixes (additive on v7, 6 fixes): header clipping (`.pm-toolbar` `position: fixed` → `sticky`), multi-parcel land allocation (`AssetLandAllocation` single/split/weighted modes + `PARCEL_WEIGHTED_AVG` + `PARCEL_CUSTOM_RATE` sentinels), `PROJECT_TYPES` expanded 6 → 14 (adds Industrial, Data Center, Education, Healthcare, Marina, Hospitality + Branded Residences, Senior Living, Self-Storage), Phase Start Date persistence to Tab 1 (was wizard-only), project end-date off-by-one (Dec 31 of last year, not Jan 1 of next), sub-unit BUA as source of truth (`asset.buaTotal` removed in favor of derived `computeAssetAreaTotals` from sub-units). **M2.0g** display + reconciliation + Costs restructure + v8 schema (7 fixes + 3 addendum, 11 commits): period end-of-period dates (Dec 31 not Jan 1; the reference model endYear 2038 not 2039), land allocation per-parcel rate selection (default to first parcel + Custom Rate option), Display Scale toggle (full/thousands/millions via `formatScaled` + `formatScaledCurrency`), BUA reconciliation with asset-level Support + Parking inputs, reconciliation row breakdown, Direct/Indirect labels removed, Costs Tab Inputs/Results sub-tabs with 4 summary tables (Capex by Period per cost-line, Capex by Stage transposed, Capex by Treatment, NEW Capex by Cost Type per Asset, all with Total in 2nd column), Manual % phasing UI restoration (per-period inputs + auto-normalize button), period labels Y0/Dec 25, **schema bump v7→v8**: annual-only inputs (`outputGranularity: 'annual' \| 'quarterly' \| 'monthly'` replaces `modelType`, with v7 monthly migration aggregating phase periods 12 → 1), three new cost methods (`rate_x_support_area`, `rate_x_parking_area`, `rate_x_specific_subunit`), `SubUnitCategory` drops 'Parking' (asset-level `parkingArea` instead). Verifiers: `verify-m20.ts`, `verify-m20b.ts` (51 pass), `verify-m20c.ts` (48 pass legacy drift), `verify-m20d.ts` (71 pass), `verify-m20e.ts` (58 pass), `verify-m20f.ts` (61 pass), `verify-m20g.ts` (68 pass canonical green). Playwright specs: `m20-full-flow`, `m20b-shell`, `m20c-costs-financing` (skipped frozen), `m20d-costs-polish`, `m20e-wizard-tab2`, `m20f-structural-fixes`, `m20g-display-recon-costs`. Single 47.8 KB v5/v6/v7/v8 baseline at `scripts/baselines/module1-v5.json` (sha256 22923b5275a7 after v8 bump; previously 824ef8e1706d after M2.0e v7, 7418013202fc after M2.0d, 15ed6f865342 after M2.0c). **Hard-cut continues at every schema bump**: pre-vN snapshots flag with explicit error rather than silent coercion. **Module 1 production-ready on v8; next phase is M2.1 Revenue.** |
| **REFM Module 1, Project Setup (frozen pre-M2.0)** | ⚠️ Superseded by M2.0+ rebuild | **4 tabs after M1.12** (Land tab dissolved): 1. Schedule, 2. Build Program, 3. Dev Costs, 4. Financing. All four tabs share one `useModule1Store`: Schedule + Build Program subscribe directly + nest a sectioned Module1Hierarchy under each (sections="structure" for Schedule's Project Structure tree, sections="assets" for Build Program's Asset & Sub-Unit Editor); Dev Costs + Financing receive prop-drilled setter wrappers from RealEstatePlatform. Sub-phases: M1.R (cost engine + Zustand restoration) → M1.5 (multi-asset + multi-phase + storage v3 bump) → M1.5b (UX polish + per-tab Quick Setup wizard) → M1.6 (Supabase persistence) → M1.7 (Area Program + plots / zones / sub-units / parking, 2026-05-02) → M1.8 (Smart Project Creation Wizard with progressive disclosure, 2026-05-03 + 5-commit hotfix series 2026-05-03 → 2026-05-04) → M1.9 (UX redesign: wizard captures country + project timeline upfront; numbered 1→6 tab sequence with Schedule first; wizard projects land on Schedule for validation, 2026-05-04) → M1.9b (Hierarchy tab dissolved + nested under Schedule + Build Program; D7/D8 disambiguation labels; What-goes-here callouts on all 5 tabs, 2026-05-04 → 2026-05-05) → M1.10 (setup-completeness: plot defaults inside FAR ceiling on first paint, platform-layer category-sum allocation derivation, wizard Step 2 fits 1080p, Land vs Plot reconciliation row, modal-step Plot + Parcel setup wizards, 2026-05-05) → M1.10b (Plot Setup polish: Plot + Parcel wizards portal to document.body + center in viewport, inline Plot form reconciled with the wizard at 15 writable fields, accessible InputLabel + ⓘ tooltip primitive with plain-English help wired into every input across all 5 Module 1 tabs, 2026-05-05) → M1.11 (holistic re-audit + 22 fixes: ProjectWizard portals to document.body + step3Valid tolerance widened to 0.1; ProjectTimelineVisual replaces M1.9 single-bar block with 4 semantic dates per phase + per-phase rows when phases.length > 1; dead identity setters on Module1Timeline + Module1Area pruned; parcelFieldHelp + assetStrategyHelp shared modules with InputLabel coverage extended to Module1AreaProgram strategy/zone/GFA fields + Module1Costs row headers + Module1Financing per-line Debt %; em-dash sweep across 175 files, 2026-05-05) → M1.12 (Land tab dissolved + tab consolidation 5→4: Land Parcels capture moves into ProjectWizard Step 2; Build Program grows a Land Parcels block at the top with full CRUD + Setup Wizard CTA; Site Parameters (Project Roads / Project FAR / Non-Enclosed) no longer have a UI surface, live only on per-Plot card; tableHeaderLabelStyle + parcelHeaderLabelStyle FAST contrast convention applied to Module 1 table headers, 2026-05-06) → M1.13 (FormulaCaption primitive renders inline plain-English live formulas adjacent to every derived output across all 4 tabs: 10 envelope + 8 cascade + 5 parking + 3 Land Parcel formulas on Build Program, Schedule timeline summary captions, Dev Costs per-row method formulas, Financing Debt = LTV * CapEx / Periodic Rate / Repayment captions, 2026-05-06) → M1.13b (eliminate Computed Envelope + Cascade Preview + Timeline Summary panels; Build Program inputs regrouped into 8 ordered sections (Plot envelope, Podium, Typical tower, Floors check, Public area split, Parking surface/vertical/basement) with formula captions inline beneath the input row that completes them; Financing Debt Summary rolled up to a clean reckoning without duplicate formula lines; Playwright proximity spec asserts every caption sits within 200 vertical pixels of its driving input, 2026-05-06). **Module 1 ships production-ready after M1.13b; next phase is M2.0.** |
| **REFM Module 1, Land Tab Elimination + 4-Tab Consolidation (Phase M1.12, 2026-05-06)** | ✅ Complete | Reduces Module 1 from 5 tabs to 4. Wizard Step 2 grows a Land Parcels capture block with default 100k @ 500 single-row seed, +Add Parcel button, inline edit, real-time totals row (area / value / weighted cash share); buildWizardSnapshot maps draft.parcels into snapshot.landParcels; per-plot area derives from totalParcelArea / draft.plotCount preserving the M1.10 Plot vs Parcel split. Build Program tab grows a `LandParcelsBlock` at the top with the same 5-column CRUD surface (name, area, rate, cashPct, inKindPct) bound to Zustand `setLand` directly, plus a "🪄 Setup wizard" CTA opening ParcelSetupWizard. Header row uses the FAST contrast convention via new local `parcelHeaderStyle` (navy bg) + `parcelHeaderLabelStyle` (white text + bold) constants threaded into `<InputLabel textStyle={...}>`. Help copy reuses `PARCEL_FIELD_HELP` from M1.11/3. Land tab dissolved entirely: m1Tabs reduces from 5 to 4 entries (1. Schedule, 2. Build Program, 3. Dev Costs, 4. Financing); Module1Area import + JSX mount removed from RealEstatePlatform.tsx. State schema preserved: `landParcels`, `projectFAR`, `projectRoadsPct`, `projectNonEnclosedPct` still on HydrateSnapshot so calc engine signatures + snapshot fixtures stay bit-identical; only the UI surface is gone. Site Parameters (Project Roads / Project FAR / Non-Enclosed) lose all UI surfaces; per-Plot card under Build Program is the single source of truth users edit. Module1Costs.tsx grows `tableHeaderLabelStyle` constant threaded through 7 InputLabel instances inside `<th>` cells (Cost Name / Stage / Method / Input Value / Start / End / Phasing) for FAST WCAG AA contrast. Verifier `scripts/verify-m112.ts` (5 sections, 21 pass / 0 fail / 0 skip with dev server up; 15 / 0 / 2 without). Playwright `tests/e2e/m112-flow.spec.ts` (2 specs, 18.7s: wizard Step 2 parcel CRUD + post-create 4-tab row asserts no Land tab + Build Program parcel block + 8 light/dark tab screenshots). Commits: ae7fec6 (wizard), 8f99ce2 (Build Program), b056062 (tab dissolve), 4287623 (FAST contrast), 2a2b3a7 (verifier + Playwright), 72b558e (docs sweep). All snapshot diffs bit-identical. **Deferred to M2.0**: ProjectFAR / Roads % / NEA auto-derive from per-plot values (calc engine still reads stored project-level scalars). |
| **REFM Module 1, Inline Live Formulas (Phase M1.13, 2026-05-06)** | ✅ Complete | New shared primitive at `src/hubs/modeling/platforms/refm/components/ui/FormulaCaption.tsx` renders a small italic "= <expression> = <values> = <result>" line adjacent to every derived output across all 4 Module 1 tabs. Caller passes the fully formatted text + an optional testId; the primitive renders on transparent background with `data-formula="true"` for Playwright counting; live values substitute into the inline expression on every input edit (caption is a permanent rendered node, only inline numbers change → no layout reflow). Coverage: **Build Program** 10 envelope formulas (Plot Area * Max FAR for Max GFA, Footprint * Podium Floors for Podium GFA, etc.), 8 asset cascade chain formulas (GFA → MEP → Net GFA → GSA / GLA → BUA → TBA → BoH → Other Tech), 5 parking capacity formulas (capacity = area / bay-size), 3 Land Parcel totals formulas. **Schedule** End / Total Periods / Type captions. **Dev Costs** per-row Method × Base = Total formula with selected-costs sum live for percent_base rows, plus grand-total caption per asset via `buildCostFormula()` helper. **Financing** Debt = LTV * CapEx + Equity = (1 - LTV) * CapEx, Periodic Rate = Annual / 12 (monthly) or = Annual (annual) with resolved 4-decimal periodic rate, Principal per Period = Total Debt / Repayment Periods, plus Debt Summary card with 5 paired formula rows. Verifier `scripts/verify-m113.ts` (5 sections, 23 pass / 0 fail / 0 skip with dev server up; 20 / 0 / 1 without; 11 markers in section 4 covering F1 primitive, S1 Schedule, B1-B4 Build Program, C1-C2 Dev Costs, P1-P2 Financing, X1 em-dash sweep). Playwright `tests/e2e/m113-formulas.spec.ts` (1 spec, 13.4s: walks all 4 tabs asserting FormulaCaption testIds + live recompute on Plot inputs (Max FAR / Plot Area edit updates Max GFA caption inline within 3s) + 8 light/dark tab screenshots). Commits: af3d429 (FormulaCaption primitive), e87afe1 (Build Program inline formulas), f35ac44 (Schedule), cb2cb2f (Dev Costs), c6a3017 (Financing), afe4f00 (verifier + Playwright), 20e7ea5 (docs sweep). All snapshot diffs bit-identical. **Note**: superseded layout-wise by M1.13b but the FormulaCaption primitive + per-tab formula coverage are unchanged; M1.13b only changes how the formulas are arranged on the page. |
| **REFM Module 1, Inline-Formula Layout / Panel Dissolution (Phase M1.13b, 2026-05-06)** | ✅ Complete (Module 1 production-ready) | Eliminates the "Computed Envelope", "Cascade Preview", and "Timeline Summary" panels; every formula now sits directly under the input row that completes it. **Build Program** restructure: 4-column 15-input grid + Computed Envelope panel + Cascade Preview panel dissolved into 8 ordered sections each with a small uppercase header + thin top border: 1. Plot envelope (Plot Buildable Area + Max FAR → Max GFA), 2. Podium (Podium Coverage + Podium Floors → Footprint, Podium GFA, Public Area), 3. Typical tower (Typical Coverage + Typical Floors → Typical GFA, Total Built GFA + utilization), 4. Floors check (Total Floors with podium+typical sanity check), 5. Public area split (Landscape % + Hardscape % → Landscape Area, Hardscape Area, Surface Parking), 6. Parking surface (Surface Bay → Surface Capacity), 7. Parking vertical (Vertical Bay + Vertical Parking Floors → Vertical Capacity), 8. Parking basement (Basement Bay + Count + Efficiency → Basement Usable + Basement Capacity). Each cascade output renders as an inline FormulaCaption stack beneath the cascade inputs (no panel wrapper); 14 plot-formula testIds + 8 cascade-formula testIds + 8 section testIds wired for Playwright proximity assertions. ParkingSummary kept as compact roll-up (its Required vs Allocated math depends on Sub-Units which live outside the plot input grid). Removed legacy `calcRow` + `CascadeCell` helpers. **Schedule**: Timeline Summary panel dissolved; 3 captions re-anchored (Granularity toggle → 1-line caption explaining monthly/annual; Project Start Date → Project End caption; Project Overlap → Total Periods caption). **Financing**: Debt Summary card rolled up to clean 5-row reckoning without FormulaCaption rows inside (formulas already inline above); card label rolled back from "Debt Summary (live formulas)" to "Debt Summary". Verifier `scripts/verify-m113b.ts` (5 sections, 23 pass / 0 fail / 0 skip with dev server up; 20 / 0 / 1 without; 11 markers including A1-A6 panel-absence + section + formula testIds, S1-S2 Schedule, F1-F2 Financing, X1 em-dash sweep). Playwright `tests/e2e/m113b-formulas-inline.spec.ts` (1 spec, 14.5s) walks all 4 tabs with two contracts: (1) panel absence — the 3 dissolved panels MUST NOT render (count == 0 on testId + label searches); (2) proximity — each driving input followed by its formula caption within 200 vertical pixels (assertProximate helper computes bounding-box distance) covering Schedule (Overlap → Total Periods, Project Start → Project End) and Build Program (Max FAR → Max GFA, Podium Floors → Podium GFA, Typical Floors → Total Built, Hardscape → Surface Parking, Surface Bay → Surface Capacity, Vertical Floors → Vertical Capacity, Basement Efficiency → Basement Capacity); plus live recompute + 8 light/dark tab screenshots. Commits: 8aa81b7 (Build Program), 2afb188 (Schedule), 365a5a1 (Financing), 0e39c4d (verifier + Playwright), 2d147cd (docs sweep + M1.13 artifact updates so verify-m113 + m113-formulas spec keep passing alongside M1.13b's stricter assertions). All snapshot diffs bit-identical. |
| **REFM, Smart Project Creation Wizard (Phase M1.8, 2026-05-03 → 2026-05-04)** | ✅ Complete | Replaces the legacy "+ New Project" → ProjectModal flow with a guided 3-step wizard that pre-creates the project structure. Wizard flow: **Step 1 Basics** (Name, Location, Currency dropdown from COUNTRY_DATA, Model Type, Start Date default today+6mo, Status). **Step 2 Structure** (Master Holding toggle default OFF, phases Single/Multiple radio with conditional 2-10 input, plots Single/Multiple radio with conditional 2-20 input). **Step 3 Assets** (project-type radio Residential/Hospitality/Retail/Office/Mixed-Use/Custom; default-asset matrix per type, Residential=1/Hospitality=1/Retail=1/Office=1/Mixed-Use=3/Custom=0; editable rows with Type/Category/Allocation%/Remove + Auto-balance to 100% + live total readout; validation gates Continue on \|sum-100\|<0.01). Esc + backdrop click prompt dirty-confirm if user entered data; tab navigation; Back/Continue preserve all state. On Create: pure `buildWizardSnapshot(draft)` helper turns draft into a HydrateSnapshot (1 SubProject + N Phases + N Plots + 1 Asset per row + 1 placeholder SubUnit per asset bound to Phase 1+Plot 1; MH only when toggle ON; sub-unit metric per category Sell/Operate→count, Lease→area; deductPct/efficiencyPct seeds per category Sell 10/85, Operate 15/80, Lease 5/90). `handleCreateProjectFromWizard` in RealEstatePlatform: hydrate store → POST /api/refm/projects with snapshot → activate → attach auto-save → route to Area Program tab. WizardProjectType collapses 6 display values to 3 store ProjectType values (Residential→'residential', Hospitality→'hospitality', else→'mixed-use'). Optional `hierarchyDisclosure?: 'progressive' \| 'manual'` field on HydrateSnapshot: wizard projects ship 'progressive', `enrichWithHierarchyDefaults` pads pre-M1.8 snapshots to 'manual'. **Hierarchy tab progressive disclosure**: in 'progressive' mode the Master Holding card hides while MH disabled. **Hierarchy tab top-of-tab action bar** (both modes): + Add Phase, + Add Plot, Enable Master Holding (only when MH off). Verifier `scripts/verify-m18.ts` (5 sections, **19 pass / 0 fail / 1 skip without dev server**). **Playwright regression-guard specs:** `tests/e2e/m18-wizard-repro.spec.ts` (1 spec, wizard create does not crash, asserts no console.error / no React boundary, area-program tab mounts) + `tests/e2e/m18-wizard-flow.spec.ts` (2 specs, every Module 1 tab shows the wizard data with no re-prompts, cross-tab edits propagate via store; reload + reopen project persists wizard data via direct `window.__module1Store` inspection). Both specs depend on `app/test-fixtures/m18-wizard/page.tsx`, a dev-only fixture that mounts RealEstatePlatform inside a stubbed NextAuth SessionProvider so Playwright skips the production /refm auth gate. **Initial commit series:** M1.8/1 `5a0af4e` (scaffold + state machine), M1.8/2 `fb8d0d3` (Step 1 Basics), M1.8/3 `7f49a6b` (Step 2 Structure), M1.8/4 `cebcd61` (Step 3 Assets), M1.8/5 `87e8aea` (transactional create), M1.8/6 `5659de1` (Hierarchy progressive disclosure), M1.8/7 `f15a459` (Hierarchy action buttons), M1.8/8 `a1fab63` (verifier + Playwright + docs sweep). **Post-launch hotfix series (5 commits):** `a15fcbc` fix 1/3 (Step 1 layout, Model Type + Status paired so Step 1 fits 1080p without scroll); `e217978` fix 2/3 (modal width 640px → 1080px); `5085958` fix 3/3 (page error after Create, added `attachToProjectFromLocalSnapshot` helper in `module1-sync.ts` to skip the round-trip re-hydrate after create; flagged the underlying recogniser bug as M2.0/A follow-up at the time); `4721e80` fix 4 (Module1AreaProgram crash, `useShallow` selectors were wrapping `s.X.filter(...)` which produces a new array reference per render. Zustand v5's `shallow` runs Object.is on each top-level value of the outer object, so a new filter result made the snapshot differ every render → React's "getSnapshot should be cached" warning → "Maximum update depth exceeded" → React boundary surfaces "This page couldn't load." Latent on M1.7 because `compareEntries` matches two empty arrays as equal, once the wizard mints the first plot, the loop trips. Fix: pulled filters out into separate `useModule1Store(s => s.X)` subscriptions + `useMemo` derivations across all 6 useShallow + filter call sites in Module1AreaProgram); `66a20f5` fix 5 (systemic data wipe, every snapshot the system POSTs (wizard create, legacy create, auto-save via `extractSnapshot`) is bare `HydrateSnapshot` with no `version: 3` discriminator. The recogniser at `module1-migrate.ts:isNewV3` required `version === 3` AND array shape, so on every reload `loadProject` → `hydrationFromAnySnapshot` → `isNewV3` rejected the wizard payload → fell through to `{ ...DEFAULT_MODULE1_STATE }` → store wiped, all tabs empty. Fix: shape-based recognition, any payload with `assets[]` + `phases[]` + `costs[]` arrays is treated as v3, regardless of the `version` field. Safe because v2 snapshots have neither a flat `assets[]` nor a `phases[]`. The previous `attachToProjectFromLocalSnapshot` workaround now becomes belt-and-braces, both paths work. **Audit confirmed all 6 tabs share the single `useModule1Store`; no duplicate local form state for project-level data; "every tab is empty" was caused by the recogniser, not by tab wiring.**). |
| **REFM Module 1, UX Redesign (Phase M1.9, 2026-05-04)** | ✅ Complete | Wizard captures country (auto-derives currency) + Project Timeline (construction + operations + overlap) up front in Step 1/2 so wizard-minted phases ship with timing wired in via `buildWizardSnapshot`. Schedule + Land tabs strip duplicate inputs that overlapped Hierarchy editing (Asset Mix + Deduction & Efficiency panels removed from Module1Area; Project Identity card removed from Module1Timeline; tab renamed "Project Schedule"). Numbered 1→6 tab labels (Schedule / Land / Build Program / Dev Costs / Financing / Hierarchy) with Schedule moved to position 1; wizard-created projects land on Schedule for validation (manual project creation still lands on Hierarchy because there's no asset structure yet). Verifier `scripts/verify-m19.ts` (16 pass / 0 fail / 2 skip without dev server) + Playwright `tests/e2e/m19-redesign-flow.spec.ts` (2 specs, both pass 22.9s). Commits 591315b (wizard country + timing), 7626120 (Module1Area strip), 93b6f1e (Module1Timeline strip), 382a0c3 (numbered tabs + Schedule landing), b8b54cc (verifier), a8b9f34 (Playwright). All snapshot diffs bit-identical. |
| **REFM Module 1, Hierarchy Dissolution + Nested Mounts (Phase M1.9b, 2026-05-04 → 2026-05-05)** | ✅ Complete | Standalone Hierarchy tab dissolved into the workflow. Module1Hierarchy gains optional `sections?: 'all' | 'structure' | 'assets'` prop: 'structure' renders Master Holding + Sub-Project + Phase rows with each Phase's asset/sub-unit subtree replaced by a slim "🧱 N assets · Edit assets in Build Program" stub; 'assets' suppresses MH + the header + Add-Sub-Project block + first-time empty gate, leaving just per-Asset + per-Sub-Unit cards. Module1Timeline mounts `<Module1Hierarchy sections="structure" />` in a Project Structure card below the schedule body; Module1AreaProgram mounts `<Module1Hierarchy sections="assets" />` in an Asset & Sub-Unit Detail Editor card below the plots list. m1Tabs drops to 5 entries; default + manual-create + wizard-create all land on Schedule. D7/D8 disambiguation labels: Schedule's "Construction / Operations / Overlap" → "Project Construction / Operations / Overlap"; Land's "FAR" → "Project FAR (whole-site ceiling)" + "(of total land)" / "(balconies / terraces)" suffixes; Build Program h2 renamed "Area Program" → "Build Program". What-goes-here callouts on all 5 tabs name canonical scope ("What goes here") + delegated scope ("Not here"). Verifier `scripts/verify-m19b.ts` (19 pass / 0 fail / 2 skip without dev server; 29 / 0 / 1 with server) + Playwright `tests/e2e/m19b-redesign-flow.spec.ts` (2 specs, 28.3s). Commits abe9917 (sections prop), 6d3b720 (nested mounts), 75908f9 (dissolve tab), 0a71c0a (D7/D8 + Schedule/Land callouts), 40b6912 (Build Program/Dev Costs/Financing callouts), 813f448 (verifier), Playwright spec. All snapshot diffs bit-identical. |
| **REFM Module 1, Setup-Completeness Hardening (Phase M1.10, 2026-05-05)** | ✅ Complete | Five fixes turning fresh wizard projects into already-validated state: (1) plot defaults inside FAR ceiling on first paint — `DEFAULT_PLOT_*` constants tuned (podiumFloors 2→1, typicalFloors 10→6, typicalCoveragePct 40→30) so utilisation lands at 80% (was 173.3%); calc engine untouched. (2) Platform-layer category-sum allocation derivation — RealEstatePlatform's `resAsset / hospAsset / retAsset` resolvers replaced with `firstByCategory` walking `assets[]` in array order matching on category, so wizard-minted ids (`wizardasset_1/2/3`) resolve correctly; `residentialPercent / hospitalityPercent / retailPercent` now sum allocationPct across every asset in the bucket (no more 0% Mixed-Use badge after wizard create). (3) Wizard Step 2 fits 1080p — section gap shrunk sp-3 → sp-2; MH paragraph compressed; Phases/Plots panels collapsed into a 2-col grid (~120-140px reduction). (4) Land vs Plot reconciliation row in Build Program — `landParcels[]` (financial — what you own) and `Plot[]` (physical — what you build on) stay independent; reconciliation row shows Parcel total · Plot total · ✓ matches / ⚠ diverges (1 sqm tolerance); Land tab heading relabelled "Land Parcels (financial — what you own)"; Build Program input renamed "Plot Buildable Area". (5) Per-plot + per-parcel modal-step setup wizards — `PlotSetupWizard.tsx` (4 steps: Envelope → Floors → Parking → Assets) mounted from each PlotEditor card; `ParcelSetupWizard.tsx` (2 steps: build list → review with totals) mounted from the Land Parcels card; both seeded from existing values so they read as edit-not-restart, both commit via store actions on Save & Close. Verifier `scripts/verify-m110.ts` (25 pass / 0 fail / 1 skip with dev server) + Playwright `tests/e2e/m110-flow.spec.ts` (3 specs: Mixed-Use wizard lands clean + PlotSetupWizard 4-step walkthrough + ParcelSetupWizard 2-step walkthrough). Commits d295dc8 (plot defaults), e9305d4 (allocation derivation), 6419b3a (wizard Step 2), d47c268 (reconciliation + relabels), 9f48b76 (PlotSetupWizard), 89667ab (ParcelSetupWizard), 8f383c8 (verifier), cfbb4f2 (Playwright + screenshots). All snapshot diffs bit-identical. |
| **REFM Module 1, Plot Setup Polish + InputLabel Tooltips (Phase M1.10b, 2026-05-05)** | ✅ Complete | Three connected fixes: (1) Plot + Parcel wizards render via React `createPortal(jsx, document.body)` (z-index 9999) instead of inline JSX nested in tab content. Pre-fix the modal inherited an ancestor's containing-block (transform/will-change on the platform shell), so `position: fixed` resolved relative to that ancestor and the wizard rendered below the viewport when scrolled. SSR guard: `if (typeof document === 'undefined') return null;`. (2) Inline Plot form vs Plot Setup Wizard reconciled — both surfaces now expose all 15 writable Plot fields with identical labels (Plot Buildable Area, Max FAR, Podium Coverage, Total Floors, Podium Floors, Typical Floors, Typical Coverage, Landscape, Hardscape, Surface Bay, Vertical Bay, Basement Bay, Basement Count, Basement Efficiency, Vertical Parking Floors); label drift fixed ("Coverage" → "Podium Coverage", "Basements" → "Basement Count", "Basement Eff." → "Basement Efficiency"); PlotDraft type extended with verticalParkingFloors. (3) Reusable `<InputLabel label help inputId textStyle />` primitive at `src/hubs/modeling/platforms/refm/components/ui/InputLabel.tsx` — 154-line component (no Radix dep) with uppercase label + ⓘ help button; hover or keyboard focus reveals an absolutely-positioned tooltip; Escape + click-outside dismiss; ARIA `aria-describedby` (wired conditionally while open) + `aria-expanded` + `role="tooltip"` on the bubble + `pointerEvents: 'none'` so the bubble never steals clicks. Wired into Schedule (Model Granularity, Project Start Date, Project Construction/Operations/Overlap), Land (Land Parcels table headers via `PARCEL_FIELD_HELP` map + Site Parameters), Build Program + Plot/Parcel wizards (Plot help via shared `plotFieldHelp.ts` keyed by 15 writable field names + Parcel help via shared `parcelFieldHelp.ts`), Dev Costs (Alloc Basis + Input Mode), Financing (Financing Mode, Debt % of CapEx (LTV), Interest Rate, Capitalize Interest During Construction, Repayment Method, Repayment Period). Verifier `scripts/verify-m110b.ts` (18 pass / 0 fail / 0 skip with dev server up; section 4b detects the 15th field via `.field` accessor since verticalParkingFloors lives in a standalone JSX block rather than a quoted-key numField path) + Playwright `tests/e2e/m110b-flow.spec.ts` (2 specs, 44.6s: Plot Setup Wizard portal regression guard + 15-field inline form + light/dark hover-driven tooltip screenshots). Commits 57a8fc0 (portals), 719542c (15-field reconciliation), b8918c8 (InputLabel primitive), 0bf9e7b (Schedule + Land wiring), 6b32ee8 (Build Program + wizards wiring + plotFieldHelp shared module), b80b617 (Dev Costs + Financing wiring), ddfb638 (verifier), 476b109 (Playwright + screenshots). All snapshot diffs bit-identical. |
| **REFM Module 1, Holistic Re-Audit + 22 Fixes (Phase M1.11, 2026-05-05)** | ✅ Complete (Module 1 production-ready) | Comprehensive Module 1 holistic re-audit covering 7 areas (data flow integrity, UX coherence, ProjectTimelineVisual, Land vs Build Program redundancy, calc correctness, first-time user flow, regression check on M1.5b through M1.10b) executed via 4 parallel Explore agents and produced `docs/MODULE_1_AUDIT_M1.11.md` with 22 issues catalogued (4 Critical / 8 Major / 6 Minor / 4 out-of-scope) and a 12-area fix grouping. **Fixes shipped in 13 commits, all snapshot diffs bit-identical:** (1) ProjectWizard portals to document.body via React `createPortal` with SSR guard + step3Valid tolerance widened from `< 0.01` to `< 0.1` so floating-point drift on auto-balance doesn't gate Continue. (2) `ProjectTimelineVisual.tsx` — new ~200-line ui component replaces M1.9 single-bar block with horizontal phase bar + 4 semantic dates per phase (Project start / Operations start / Construction end / Project end) using `Intl.DateTimeFormat('en-GB', { month: 'short', year: 'numeric' })`; renders one row per phase when phases.length > 1; testIds `timeline-bar-${id}` / `timeline-axis-${id}` / `timeline-overlap-${id}` / `timeline-overlap-callout-${id}` for Playwright; subscribes to phases via useShallow. (3) Land tab cleanup — dead identity setters (setProjectName, setProjectType, setCountry, setCurrency, setResidentialPercent, setHospitalityPercent, setRetailPercent + matching deduct + efficiency setters) pruned from Module1Timeline + Module1Area + RealEstatePlatform JSX call sites; Module1Area now subscribes directly to `setLand` via `useModule1Store(s => s.setLand)` and writes via `setLand({ landParcels })` instead of prop-drilled `setLandParcels`; new shared `parcelFieldHelp.ts` module with 5 keys; ParcelSetupWizard label drift fixed ("Name" → "Parcel Name", "Rate (/sqm)" → "Rate (per sqm)"). (4) Module1AreaProgram strategy/zone/GFA fields wrapped in `<InputLabel>` via new shared `assetStrategyHelp.ts` (6 keys); em-dash placeholders replaced with literal text ("(none)", "(no zone)", "(blank if 100)", `'n/a'` for non-finite numbers, `'auto'` for empty zone). (5) Module1Costs — What-goes-here callout expanded with "Phase scope:" sub-paragraph; 7 cost row column headers wrapped in InputLabel. (6) Module1Financing — per-line Debt % header wrapped in InputLabel with `textStyle: { color: 'var(--color-on-primary-navy)' }` override for the on-navy chrome. **Em-dash sweep**: 1,386 em-dashes removed across 175 files via `sed 's/ — /, /g; s/—/,/g'`; excluded `js/refm-platform.js` (legacy) and `verify-m*.ts` docstrings. New writing rule added at top of CLAUDE.md STRICT SESSION RULES: "NEVER use em-dashes". Verifier `scripts/verify-m111.ts` (23 pass / 0 fail / 1 skip with dev server up; includes `stripCommentLines` helper to filter `//` / `*` / `/*` lines so docstring mentions of removed setters don't false-fail) + Playwright `tests/e2e/m111-full-flow.spec.ts` (2 specs, 49.9s: ProjectWizard portal regression guard + wizard create + 5-tab walkthrough using `axis = page.locator('[data-testid^="timeline-axis-"]').first()` to scope timeline date labels; 10 light + dark screenshots into `tests/screenshots/M1.11/`). C1 (Status field never reaches store) was a false positive from the audit agent; verification confirmed `RealEstatePlatform.tsx:1248` already passes `status: draft.status` to `pclient.createProject`. **Module 1 production-ready after this phase; next phase is M2.0** (deferred items: ProjectFAR migration from Land to per-Plot derivation, section-pill labels (Inputs / Calculated), calc-vs-input pencil/fx icons, financial-vocabulary hover tooltips). |
| **REFM Module 1, Area Program (Phase M1.7, 2026-05-02)** | ✅ Complete | New tab between Land & Area and Dev Costs adds Plot (between Phase and Asset, with envelope inputs: plotArea, FAR, coverage, podium/typical floors split, landscape/hardscape pct, basement count + efficiency, parking bay sizes, optional vertical-parking floors) and optional Zone (logical sub-division of Plot, e.g. "Zone 1A"). Per-asset operating Strategy (Develop & Sell / Lease / Operate, Primary + optional Secondary with allocation %) with category-keyed defaults; per-asset cascade overrides (MEP %, BoH %, otherTech %); per-asset GFA override or pro-rata via allocationPct. Per-asset Sub-Unit schedule (Studio / 1BR / 2BR / 3BR / Hotel Key / Office / Retail) with parking-bays-per-unit override and category-aware type suggestions via `<datalist>`. Live computed envelope panel (maxGFA / footprint / podiumGFA / typicalGFA / totalBuiltGFA / publicArea / landscape / hardscape / surface parking / basement usable). Live cascade preview per asset (GFA / MEP / Net GFA / GSA-GLA / BUA Excl / TBA / BoH / Other Tech). Live parking summary per plot (required from sub-units, surface / vertical / basement allocated vs. capacity, deficit warning when demand > capacity). Industry-typical defaults: FAR 3.0, Coverage 60%, Basement Eff. 95%, bay sizes 25/40/44 sqm; cascade by category Sell 8/3/3, Lease 12/5/4, Operate 15/12/5, Hybrid 12/8/4; parking ratios Studio/1BR 1.0, 2BR 1.6, 3BR 2.0, Hotel Key 1.0, Office/Retail 1.0 / 25 sqm. Pure calc engines (`computePlotEnvelope`, `computeAreaCascade`, `computePlotParkingCapacity`, `allocateParking`) live in `@core/calculations` with no REFM-type imports (one-way dep preserved). Cascade-aware deletes: removePlot drops zones + clears asset.plotId/zoneId (asset survives); removeZone clears asset.zoneId only; removePhase / removeSubProject cascade through plots → zones. Persistence: extends `refm_projects.snapshot` JSONB shape (no new tables); `enrichWithHierarchyDefaults` pads `plots: [] / zones: []` for pre-M1.7 snapshots. Verifier: `scripts/verify-m17.ts` (5 sections, 25 pass / 0 fail / 2 skip without dev server: DB JSONB roundtrip, route 401 smoke, calc correctness via 3 snapshot diffs + spot assertions, store CRUD + cascade integrity, Playwright headless light/dark sign-in screenshots + /refm gate confirm). New regression-guard track: `tests/fixtures/module1-areaprogram.json` + `tests/snapshots/module1-areaprogram-baseline.json` (2.8 KB) + `scripts/module1-areaprogram-snapshot.ts` + `scripts/module1-areaprogram-diff.ts`. Commits: M1.7/1 fd2767e (types + store), M1.7/2 baa0e27 (calc engines), M1.7/3 af471e7 (Strategy + Sub-Unit), M1.7/4 041feaa (fixture + diff target), M1.7/5 ac2f2c5 (UI plots + zones + strategy), M1.7/6 4ea532f (UI sub-units + parking), M1.7/7 f8b6bfd (Playwright + verify-m17). Patterns memory: `project_m17_patterns.md`. |
| **Modeling Hub, Canonical Post-Signin Landing (foundation rebuild, 2026-04-30)** | ✅ Complete | `/modeling/dashboard` repurposed from a 3-card grid to the canonical sidebar layout for `app.financialmodelerpro.com`. Server component now fetches CMS keys `logo_url` + `logo_height_px` + `header_height_px` (defaults 36 / 64, same as main-site `NavbarServer`) so the hub topbar dimensions match the main site exactly. Renders topbar at `minHeight: headerHeight` and sidebar at `top: headerHeight, height: calc(100vh - ${headerHeight}px)`. `app/portal/page.tsx` collapsed to a 5-line `redirect('${APP_URL}/modeling/dashboard')` so historical bookmarks keep working; `/portal` removed from `MAIN_PATHS` in `next.config.ts`; `src/middleware.ts` swapped its non-admin `/admin/*` rejection redirect from `/portal` to `/`; `src/shared/email/templates/accountConfirmation.ts` re-targeted both `${APP_URL}/portal` references to `${APP_URL}/modeling/dashboard`. Modeling Hub is now end-to-end on the app.* subdomain, no host hops to apex. Cookie-scope ergonomics improved as a side benefit (NextAuth cookie stays within a single host, no Domain attribute needed); the prior Phase 4 cookie-scope regression (briefly investigated then reverted via Option A) is documented as a known issue but explicitly out-of-scope for this session, NextAuth config NOT modified. |
| **Modeling Hub, Hub-level Dark Mode (2026-04-30)** | ✅ Complete | `/modeling/dashboard` server component owns its own dark-mode toggle: `localStorage['modelingDarkMode']` (default → `window.matchMedia('(prefers-color-scheme: dark)').matches`), `data-theme={'light' | 'dark'}` on the root container, theme tokens applied via inline-style object so server-render produces the right initial paint without a flash. Scoped to the modeling layout, does NOT leak into `/admin/*` or `/training/*` surfaces. Independent of the REFM workspace toggle (see next row) since the hub is post-signin chrome and REFM is the modeling tool, operator may want them set differently. |
| **REFM, Workspace Dark Mode (2026-04-30)** | ✅ Complete | ☀️/🌙 toggle in REFM Topbar between ⚙️ Settings and ← Hub. Own `localStorage['refmDarkMode']` key (separate from `modelingDarkMode`); default → `prefers-color-scheme`. Theme scoped via `body[data-refm-theme="dark"] .app-shell` selectors so it never bleeds into admin or training surfaces (verified). New design token `--color-on-primary-navy: #FFFFFF` added to `app/globals.css` after `--color-accent-warm`, brand-locked white that is NOT overridden in dark scope; required because the existing `--color-grey-white` token is overridden to `#1A222F` in dark, which would have flipped any "white text on navy chrome" usage to invisible. The dark mode override block in `globals.css` declares overrides for bg, surface, grey-white, grey-pale, border, border-light, muted, meta, body, grey-dark, heading, row-alt, row-hover, input-bg, warning-bg, warning-text, navy-light, navy-pale, shadow-1/2/hover. |
| **REFM, Project Name Editing (2026-04-30)** | ✅ Complete | ProjectModal already supported edit mode but `onConfirm` was hardcoded to `handleCreateProject`. New `handleEditProject(name, location)` callback in `RealEstatePlatform.tsx` mutates the active project, syncs state, persists to localStorage `refm_v2`, fires toast. New `handleEditProjectClick(pid?)` opens the modal in edit mode. Two UI entry points: Overview header pencil ✏️ button next to the project name h1, and a per-row pencil ✏️ button between Open and Delete on `ProjectsScreen`. Both gated on `can('canEditProject')`. Edits persist and update display in Sidebar pill, Topbar context button, Overview header, Dashboard tile, and ProjectsScreen list. Same commit added defensive hydration cleanup: `loadFromStorage()` drops a stale `s.activeProjectId` if it doesn't resolve to a real project so the Overview screen no longer silently blanks after a project is deleted from another tab, replaced with an actionable empty state. |
| **REFM, Module Roadmap consolidation (2026-04-30)** | ✅ Complete | Sidebar listed all 11 modules but Dashboard's Module Roadmap only showed 1-6 (drift bug, two parallel hardcoded lists). Both surfaces now consume `MODULES` from a single source of truth at the new file `src/hubs/modeling/platforms/refm/lib/modules-config.ts` (`MODULES: readonly ModuleConfig[]` with 11 entries; `ModuleStatus = 'done' | 'soon' | 'pro' | 'enterprise'`; `ModulePlan = 'free' | 'professional' | 'enterprise'`). `shortLabel` powers the narrow sidebar rail; `longLabel` powers the wide dashboard roadmap rows. Dashboard introduces `STATUS_BADGE` map (4 variants done / soon / pro / enterprise) routed through design tokens + `color-mix()`. Sidebar derives `sidebarModules = [...STATIC_NAV, ...MODULES.map(toSidebarItem)]`. Adding/renaming/reordering a module now requires editing one list. |
| **REFM, Phase 4.x design-token retrofit (2026-04-29 → 2026-04-30, 15 phases shipped)** | ✅ Complete | Continued Phase 4 retrofit pattern that originated in commit `bcea1a7`: replace inline rgba/hex literals across REFM components with `color-mix(in srgb, var(--color-X) Y%, transparent)` so light/dark modes flip together via the existing token system. **Phase 4.1**: baseline (commit `bcea1a7`, prior session). **Phase 4.2** OverviewScreen.tsx (commit `afd0e4d`): 4 hardcoded literals (Total GFA accent + active-version border/bg + LOADED pill). Same commit added the Edit Project pencil + actionable empty state. **Phase 4.3** ProjectsScreen.tsx (commit `a75708f`): STATUS_COLORS map + ACTIVE pill, 5 rgba literals + 1 hex (`#92400e` → `var(--color-gold-dark)`); normalized `var(--color-green-dark)` → `var(--color-success)`. Companion commit (`6ae4344`) wired the per-row pencil ✏️ Edit button. **Phase 4.4** Sidebar.tsx (commit `9a0fe71`): 2 inline rgba literals replaced with `color-mix(in srgb, var(--color-on-primary-navy) X%, transparent)`. **Phase 4.5** Topbar.tsx (commit `11e098b`): 12 hardcoded literals replaced; imports `DEFAULT_BRANDING` from `@/src/core/branding` so OfficeColorPicker fallbacks stay as actual hex strings (the picker requires `hexToRgb`-able input, CSS vars wouldn't work), keeps source file free of inline hex while preserving picker compatibility; `← Portal` (with `/portal` href) replaced with `← Hub` linking to `/modeling/dashboard`; Sign Out button border alpha via `color-mix`. **Phases 4.6-4.9**, Module 1 tabs (`cd9740f` Module1Timeline, `273ec50` Module1Area, `0226e22` Module1Costs, `7a318cd` Module1Financing): established the **FAST cell pattern** that supersedes the yellow `.input-assumption` class inside REFM. Inputs flip to blue (`var(--color-navy-pale)` bg + `var(--color-navy)` text via local `inputStyle` constant); calculated output panels use `calcOutputStyle` (`var(--color-grey-pale)` bg + `var(--color-heading)` text); active states use `color-mix(var(--color-primary), transparent)`; on-navy text routes through `var(--color-on-primary-navy)`. 39× className="input-assumption" removed across the four tabs because the global `!important` rule in app/globals.css would override the new inline blue. Module1Area swapped the off-canon hospitality `#7c3aed` purple for `var(--color-navy-mid)` (matches Module1Financing canonical at line 122); Area Hierarchy table column-header pastels migrated to `color-mix` derivations of `var(--color-on-primary-navy)` against `--color-navy / --color-gold / --color-negative`. Module1Financing handled the largest mix (40 hex/rgba/'white' literals), including dead `var(--token, #literal)` fallback hexes that were stripped because tokens are always defined globally. **Phase 4.10** PlanBadge.tsx (`2e486c1`): 3 plan-tier hex literals relocated through `src/styles/tokens.ts` `PLAN_COLOR`; alpha-suffix hex pattern (`${color}1A`/`${color}40`) rewritten to `color-mix` so it works with CSS-var inputs. **Phases 4.11-4.14**, REFM modals (`f0535b8` ProjectModal, `e16d333` VersionModal, `71f72ce` RbacModal, `97d6de7` ExportModal): same on-navy header chrome pattern across all four (`color: 'var(--color-on-primary-navy)'` + `color-mix(--color-on-primary-navy, transparent)` for backgrounds); ExportModal additionally folded its self-contained Tailwind-gray palette (gray-200/400/500/700/900 + Tailwind blue-600) onto canonical FMP tokens. **Phase 4.15** RealEstatePlatform.tsx (`48e5f3d`): 6 hex/rgba sites in two JSX overlay blocks (Module 8 lock overlay + upgrade-prompt backdrop); the dark-mode plumbing block (`darkMode` useState + `body.dataset.refmTheme` useEffect + `toggleDarkMode` callback at lines 295-330) is byte-identical post-retrofit so the workspace toggle continues to work. **Final state**: REFM folder is hex/rgba/'white'/input-assumption-free across all 15 files end-to-end. Module 1 regression-guard snapshot (`scripts/module1-snapshot-diff.ts`) stays at 17.5 KB baseline (exit 0 each step), strictly visual changes only. |
| **Excel / PDF Export (REFM)** | ✅ Complete | exceljs static + formula, @react-pdf/renderer |
| **REFM Modules 2–11** | ❌ Not Started | Stubs/placeholders only |
| **AI Agents** | 🔄 In Progress | Market rates + research wired; contextual help stub |
| **Pricing / Subscriptions** | 🔄 Platform Pricing only | `/admin/pricing` is now a single Platform Pricing surface (no tab bar). Plans tab + Page Content tab + Pricing Features tab + Module Access tab all removed across 2026-04-27 / 2026-04-28 commits. **Migration 145** dropped the `pricing_plans` table (commit `777e1bf`). Hero text + FAQ for the public `/pricing` page are edited in **Page Builder → Pricing** (slug='pricing'); the public page now reads `page_sections` directly (commit `50e22fa`). Plan-based feature gating was ripped out in commit `d8405e5` (Path A, Permissions removal); REFM premium features lock to `false` until paid tiers go live. |
| **White-Label** | ❌ Removed (commit `a000fbd`) | Admin-write-only feature with REFM Topbar as lone consumer (per-client name/logo override). Hook + admin page + sidebar entry + `BrandingConfig.whiteLabel` field all deleted. Reintroduce as a focused new feature when an enterprise customer needs it. |
| **Branding** | ✅ Merged into Header Settings (commit `ab5db30`) | Brand Colors section now lives at the top of `/admin/header-settings`. `/admin/branding` is a 5-line server redirect to the new home so existing bookmarks keep working. Same `/api/branding` GET + PATCH endpoints, same `branding_config` table, same `BrandingThemeApplier` consumer, only the editing surface relocated. Sidebar Branding entry removed; Header Settings gains `matchPaths: ['/admin/branding']` so the rail stays highlighted on stale links. Drives `--color-primary` / `--color-secondary` CSS tokens. |
| **Modeling Hub, Coming Soon Mode** | ✅ Complete | Originally a single `modeling_hub_coming_soon` toggle; as of migration 136 replaced by split signin + register toggles (see row below). Legacy API `/api/admin/modeling-coming-soon` still live for backward compat. |
| **Modeling Hub - Pre-Launch Lockdown + Access Whitelist** | ✅ Complete (migrations 136 + 137) | Replaces the single-toggle model with two independent Coming Soon controls (signin / register) plus a real `modeling_access_whitelist` table so admins can grant individual email bypasses with a UI instead of editing a CSV string. Gating chain threads the same predicate into every entry point: `canEmailSigninModeling` gates NextAuth `authorize()` (admin role still short-circuits), `canEmailRegisterModeling` gates `/api/auth/register` (403 with "invite-only" copy) + `/api/auth/confirm-email` (redirects to `/signin?error=invite-only` for stale tokens). Server pages: `/modeling/signin` renders `ModelingComingSoon(variant='signin')` when the signin toggle is on (bypass via `?bypass=true`); `/modeling/register` renders `ModelingComingSoon(variant='register')` when the register toggle is on, with a cleaner admin share flow - `?email=whitelisted@address` server-verifies the whitelist and renders the form with a locked, green-pill "✓ Invited" email input so the API-side whitelist check can't be sidestepped. Admin surface: two `LaunchStatusCard`s on `/admin/modules` (Sign In + Register), dedicated whitelist UI at `/admin/modeling-access` (add-email form with optional note, Revoke per row, toggle-state summary + preview links), sidebar nav entry 🔑 Access Whitelist under Modeling Hub, info banner on `/admin/users` warning that adding a user there does NOT grant access. Migration 136 also deletes six unauthorized accounts that slipped in pre-lockdown with a full `admin_audit_log` trail. |
| **Modeling Hub - Register Page UX (Coming Soon + Invite Path)** | ✅ Complete (2026-04-21) | Previously the register form rendered on every visit with the API as the only gate, so strangers filled out the whole form before getting a 403. Now matches the signin pattern exactly: toggle OFF → form for everyone; toggle ON + no params → `ModelingComingSoon(variant='register')` UI with countdown + "Have an invite? Register here →" link; toggle ON + `?bypass=true` → form (QA escape hatch, API still gates); toggle ON + `?email=whitelisted@address` → server-verified invite path, form renders with email pre-filled + locked. New files: `app/modeling/register/ComingSoonWrapper.tsx` (mirrors the signin wrapper). `RegisterForm` gained optional `invitedEmail` prop + green-pill "✓ Invited" affordance. |
| **Modeling Hub, Platform Sub-pages CMS** | ✅ Complete | CMS-editable via `modeling-{slug}` pattern, Real Estate fully seeded (071-072), other platforms auto-setup from admin |
| **CMS, Universal Paragraphs (legacy)** | ⚠️ Superseded | ParagraphsEditor DELETED 2026-04-18 (Phase 2A). The universal Tiptap RichTextarea now handles multi-paragraph body text natively (Enter → new `<p>`). Orphan `content.paragraphs[]` DB rows are harmless (unread). `CmsParagraphs` renderer still exists for backward compat. |
| **CMS, Universal CmsField Rendering (Phase 1)** | ✅ Complete | `src/hubs/main/components/cms/CmsField.tsx` is the ONLY way CMS text reaches the frontend. Handles `{field}_visible` / `{field}_align` / `{field}_width` / HTML detection / `.fmp-rich-text` class / plain-text paragraph splitting. All 21 section renderers + home/training/modeling/modeling-[slug]/ahmad-din/book-a-meeting/contact inline blocks use it. Enforcement rules in CmsField docstring + CLAUDE.md. |
| **CMS, Universal Rich Text Editor (Phase 2A)** | ✅ Complete | `RichTextarea` rewritten as Tiptap editor (StarterKit + Underline + Link + Color + TextStyle + custom FontSize mark). Selection-based floating toolbar with B / I / U / S, font size, color presets, lists, link, clear formatting. Enter → new `<p>`, Shift+Enter → `<br>`. Used on 17+ fields (hero subtitle/power/trust, text body, text_image body, cta subtitle, faq answer, pacemakers desc/desc2, countdown subtitle, founder bio/long_bio/philosophy, cards descriptions, testimonials quotes, team bios, list items, timeline descriptions, pricing descriptions, founder projects). |
| **CMS, Array Item VF (Phase 2B)** | ✅ Complete | `ItemVF` + `ItemBar` helpers in page-builder. Per-item visibility + alignment + width + delete on every array editor (cards, testimonials, team, faq, list, timeline, pricing tiers, logo grid, founder projects). TwoPlatforms column VF keys now stored INSIDE `columns[i]` (was top-level `col{i}_*`, broken). Frontend renderers filter `item.visible !== false`. Migration 097 backfills legacy TwoPlatforms keys. |
| **CMS, Book a Meeting (Calendly Embed)** | ✅ Complete | See "CMS, Book a Meeting Page" row. |
| **CMS, LinkedIn on Testimonials** | ✅ Complete | Blue LinkedIn button with SVG icon on training testimonial cards |
| **YouTube Player + Subscribe** | ✅ Complete | YT IFrame API player (replaces raw iframe), styled subscribe banner, like button (admin-toggleable via show_like_button), watch completion tracking (50 pts) |
| **YouTube Comments Cache** | ✅ Complete | Server-side proxy fetches comments via YouTube Data API v3, caches in youtube_comments_cache table (24h TTL), empty state shows "Be the first to comment" CTA |
| **Watch Progress Indicators** | ✅ Complete | Green "Watched" badge on live session cards, watch-history API, session_watch_history with status + watch_percentage columns |
| **Training Hub, Certification Watch Tracking** | ✅ Complete | certification_watch_history table tracks video in_progress/completed. Gates "Take Assessment" on dashboard. Watch page writes on play + every progress tick + Mark Complete. As of migrations 146+147 the row carries the canonical `watch_intervals` JSONB plus `completed_via` + `video_load_at`; see Watch Tracking Rebuild row below. |
| **Training Hub, Watch Tracking Rebuild (Phases 2-5, 2026-04-28, migrations 146 + 147)** | ✅ Complete (analytics-only post-2026-04-29) | Smoking-gun fix for the multi-session resume bug + safety valve + visibility + recovery. **Phase 2 (mig 146)**: persists `watch_intervals JSONB` on both `certification_watch_history` and `session_watch_history`. The pre-146 tracker only persisted the scalar `watch_seconds` baseline, so on a return visit `max(baseline, sumNew + open)` froze multi-session viewers at the largest single contiguous run forever (Fakhri stuck at 46% despite watching 100%). The tracker now hydrates from JSONB on mount and POSTs a snapshot of merged intervals every progress tick; server unions incoming + existing and re-derives `watch_seconds = sumIntervals(merged)` with a wall-clock rate limit on the new portion. Five tracker fixes in `watchTracker.ts` + `YouTubePlayer.tsx`: (a) `onPlay` closes the prior interval before opening a new one (covers PLAYING -> BUFFERING -> PLAYING glitches), (b) cross-session interval union via `initialIntervals` prop, (c) BUFFERING treated as a soft pause, (d) tracker stored in `useRef` so prop updates re-seed without remount, (e) `WatchProgressPayload` with a `force` flag set on close events so consumers bypass their POST throttle and the final partial interval lands in the DB. **Phase 3 (mig 147)**: manual override path. New columns `completed_via TEXT NULL` ('threshold' / 'manual' / 'admin_override') and `video_load_at TIMESTAMPTZ NULL` (server-stamped on first POST per row, anchors the elapsed-time check). UI: CourseTopBar gains a checkbox-gated "I confirm I have watched this video" + Mark Complete button when watch% is in the [50, threshold) band. Server enforces pct >= 50 AND wall-clock elapsed >= total_seconds * 0.8 before honouring; a 403 with diagnostic info bounces tampered submits. **Phase 4**: `WatchProgressBar` re-enabled with color-coded fill (red < 30, amber 30 to threshold, green at threshold) + dashed threshold marker + bypass-aware copy. Student-facing surfaces still hide the literal threshold percentage in the ghost hint, but the bar shows actual progress because the manual override path needs the student to know they're in the [50, threshold) band. New admin endpoint `POST /api/admin/sessions/[tabKey]/force-complete-for-student` (admin-gated, routes by tabKey prefix, writes to `admin_audit_log` with `action='watch_force_complete'`, awards +50 points on live-session rows that hadn't received them). Admin students panel's Progress modal gains a Watch Progress table with per-row Force Unlock buttons. **Phase 5**: surgical recovery sweep for 4 stuck students (`muhammadtayyabmadni07`, `yusra.tufail`, `daniyal1012`, `fakhrizanul`) via `scripts/phase5_recovery.ts`; all unblocked, all 4 audit entries confirmed by `scripts/phase5_verify.ts`. **Three unlock paths going forward**: `threshold` (auto at >=70%), `manual` (student override at >=50% + elapsed-time check), `admin_override` (admin force-unlock from the panel). The 70% threshold itself is unchanged (`training_settings.watch_enforcement_threshold`). Commits `c9a20e4`, `13cb260`, `e2dd9a4`, `670fb51`. |
| **Training Hub, Watch Enforcement (70% rule)** | ❌ Removed 2026-04-29 (commit `f583c70`) | The global watch-percentage gate was retired in favour of a simpler video-ended Mark Complete trigger (see "Mark Complete (video-ended trigger)" row below). Five files deleted: `app/api/training/watch-enforcement/route.ts`, `app/api/admin/watch-enforcement-stats/route.ts`, `src/hubs/training/components/WatchProgressBar.tsx`, `src/hubs/training/lib/watch/watchEnforcementCheck.ts`, `src/hubs/training/lib/watch/watchThresholdVerifier.ts`. Both watch endpoints (`/api/training/certification-watch` + `/api/training/live-sessions/[id]/watched`) no longer 403 on threshold and dropped the `manual_override` block. `verifyWatchThresholdMet` call removed from `certificateEngine.issueCertificateForPending`. `loadWatchEnforcement` + `watchThresholdMet` + `watchDetails` removed from `certificateEligibility`. The entire Watch Enforcement card on `/admin/training-settings` (global toggle, threshold slider, per-session bypass table, search + filters + sort + bulk row actions, summary stats, `LiveSessionRow`/`SessionRow`/`SessionKind` types, `SummaryStat`/`TypeBadge` helpers) was removed. Settings keys `watch_enforcement_enabled` / `watch_enforcement_threshold` / `watch_enforcement_bypass_*` remain in `training_settings` but no code reads them. Skip-to-end is now permitted by design, certificate credibility comes from the model-submission gate (migration 148), not watch percentage. The interval-merging tracker stays running for analytics fidelity (admin Watch Progress + Platform Analytics + per-live-session-assessment opt-in `require_watch_before_assessment` gate). |
| **Training Hub, Mark Complete (video-ended trigger, post-2026-04-29)** | ✅ Complete (commits `f583c70` + `f790fa9`) | `markCompleteCallback = videoEnded && !markedComplete ? handleMarkComplete : undefined`, uniform across the cert watch page (3SFM/BVM) and the live-session watch page. `videoEnded` flips to true via `YouTubePlayer.onEnded`, single-fire guarded by `endedFired`. Three triggers: (1) tick fallback `currentTime >= duration - 20` during normal playback (primary unlock signal, Mark Complete surfaces 20 seconds before video ends so the student can watch the wrap-up + click immediately); (2) YT `PlayerState.ENDED` (final fallback for videos where the tick missed); (3) PAUSED-at-tail with `currentTime >= duration - 1` (corner case: scrubbed to last second + paused before next tick). Edge cases: video shorter than 20s fires on first tick (acceptable); scrub past d-20 fires on next tick; rewind after seen leaves the button visible (parent state sticky). Server-side endpoints accept `status='completed'` without re-checking percentage. The `nearEnd` near-end-window requirement, `manualOverrideAvailable` checkbox, `watchHint` ghost message, and `WatchProgressBar` mount are all gone. |
| **Live Session Registration + Join (2026-04-23)** | ✅ Complete | Major UX rebuild across dashboard card + session detail page: (a) Register button on dashboard card is gone - all registration happens on the detail page now, card is click-through only (one canonical commit surface). (b) Register/Join card renders at the TOP of the detail page via new `CoursePlayerLayout.topContent` slot (previously at the END so students scrolled past description + attachments to find it). (c) Join Session button appears IMMEDIATELY after registration - removed the 30-min-before-start gate from `joinLinkAvailable` server-side so students can paste the Teams URL into their calendar / pre-test mic; yellow warning band under Join explains "Session starts {date} at {time}". (d) Multi-provider Add-to-Calendar (`CalendarDropdown.tsx`): Google / Outlook / Apple (.ics) / Yahoo + .ics-fallback, organizer baked into description. (e) `handleRegister` immediately refetches `/register?email=` after POST success so the Join button surfaces without waiting for the 30s poll. (f) Redirect chain preserved through signin + register: `/signin?redirect=X` honoured by `SignInForm`, `RegisterForm`, `/api/training/register` (encodes into confirmation link as `&redirect=`), `/training/confirm-email` (forwards), `/api/training/confirm-email` (appends to `/signin?confirmed=true`). Public `/training-sessions/[id]` page gains a prominent "Sign In to Register" + "Create Account to Register" card for unauthed visitors (previously a thin "Sign in to earn points" banner). |
| **Training Hub, Watch Resume / Continue** | ✅ Complete (2026-04-21) | `playerVars.start` restores the student's `last_position` across logout/login and different devices on both watch pages. `YouTubePlayer.startSeconds` prop + `CoursePlayerLayout.resumePositionSeconds` threaded from the watch-record GET. Clamps: `status='completed'` → resume at 0 (rewatch from beginning); `last_position ≤ 10s` → skip seek; `last_position ≥ total − 30s` → skip seek (YT's `start` param loops back to 0 past-end); null/missing → 0. Tracker floor (`Math.max(prev, baselineWatchedSec, watchedSec)`) preserves threshold credit across reloads, the resume only moves the playhead; watched-seconds never drops. |
| **Training Hub, Video Swap Auto-Reset** | ✅ Complete (2026-04-21) | `src/hubs/training/lib/watch/detectVideoChange.ts` → heuristic `abs diff > 30s AND relative diff > 10%` on `existing vs incoming total_seconds`. Applied inside both watch endpoints (`POST /api/training/certification-watch` + `POST /api/training/live-sessions/[id]/watched`). On verdict `changed=true`: reset `watch_seconds`/`total_seconds` to incoming, demote `status='in_progress'`, clear `completed_at`/`watched_at`/`points_awarded`/`last_position`. Admin-only nuclear reset at `POST /api/admin/sessions/[tabKey]/reset-watch-progress` routes by prefix (`LIVE_<uuid>` → session_watch_history; else → certification_watch_history). Red "Reset Watch Progress" buttons in both session editors (uses `window.confirm` because the live-sessions admin page shadows `confirm` with state). |
| **Training Hub, Interactive Onboarding Tour** | ✅ Complete (migration 120) | `driver.js@^1.4.0` walkthrough on first dashboard visit, react-joyride rejected React 19 peer dep. Component: `src/hubs/training/components/DashboardTour.tsx`. Highlights sidebar nav, courses, live sessions, profile menu, share button via `data-tour="…"` attrs on real UI (no fake overlays). State: `training_registrations_meta.tour_completed` (migration 120), one-shot. API: `POST /api/training/tour-status` toggles it. Restart via profile dropdown's "Restart Tour" action. Copy avoids mentioning watch threshold percentage. |
| **Training Hub, Coming Soon Bypass List** | ✅ Complete (migration 121) | Fills the gap where Modeling Hub's NextAuth admin role skips the Coming-Soon gate in `authorize()` but Training Hub's cookie-based session has no role field. `training_settings.training_hub_bypass_list`, case-insensitive comma-separated emails OR registration IDs. Guard at `src/shared/comingSoon/guard.ts` + lookup at `hubBypassList.ts`. Both `/training/signin` + `/training/register` server-gate. `PreLaunchBanner` on authed dashboard tells bypass-listed testers they're viewing a live build while the hub is still Coming Soon to the public. Admin UI to edit the list TBD, edit the row directly for now. |
| **Auto-Launch Cron (Coming Soon → LIVE)** | 🔒 Wired but disabled (migration 118) | Admins can schedule a Coming Soon → LIVE flip at `launch_date`. Settings seeded: `{training_hub,modeling_hub}_auto_launch` (default `'false'`) + `{hub}_last_auto_launched_at`. Route `GET /api/cron/auto-launch-check` flips `coming_soon='false'` + `auto_launch='false'` (one-shot) + audits `last_auto_launched_at=ISO` when `enabled && auto_launch && launch_date <= now()` (CRON_SECRET bearer required). **UI gated by `AUTO_LAUNCH_UI_ENABLED=false` in `LaunchStatusCard`** because Vercel Hobby only supports daily crons and launch-flip needs 5-min granularity to be useful. `vercel.json` cron entry rolled back. Manual toggles in `/admin/training-settings` + `/admin/modules` remain authoritative. Ship when we upgrade to Pro. |
| **Live Session Reminders, per-registration flags** | ✅ Complete (migration 122) | 24h + 1h reminder flags moved from per-session (`live_sessions`, migration 043) to per-registration (`session_registrations.reminder_{24h,1h}_sent`). Fixes the "late registrant never gets 24h reminder" bug where the session-level flag was already set by the first registrant. `/api/cron/session-reminders` + partial indexes on `false` rows keep the lookup cheap. Session-level `announcement_sent` stays on `live_sessions` ("don't remind about an unpublished session"). `src/hubs/training/lib/sessionAnnouncement.ts` (note: file has been removed from the source tree; the code path is documented historically) centralizes the email build across cron + admin `/notify` + register endpoints. |
| **Mobile Responsiveness Pass** | ✅ Complete (2026-04-21) | C1-C9 Critical + I1-I18 Important issues resolved. CSS-only auto-collapse pattern `minmax(min(100%, Npx), 1fr)` used across grids. Hero, sticky headers, session cards, sidebar nav, mobile bottom nav, admin tables, forms, buttons all verified on 320px / 375px / 768px / 1024px viewports. |
| ~~**Marketing Studio PNG Render Reliability**~~ | ⚠️ Removed 2026-04-24 | `imageToDataUri` 5s timeout patch was specific to the deleted Phase 1.5 canvas editor. The new template-driven Marketing Studio (migration 142) uses `fetchAsBase64` in `src/features/marketing-studio/image-utils.ts` with the same defensive try/catch pattern; the upstream image surface is much smaller (logo + trainer photo + optional uploaded background) so the timeout escape hatch was no longer load-bearing. |
| **Share Template, `{hubUrl}` variable** | ✅ Complete (migration 119) | Soft-upgrade: 5 templates get `\n\nLearn more at {hubUrl}` appended (assessment_passed, achievement_card, live_session_watched, session_shared, daily_certifications_roundup), but only when the existing text doesn't already mention the learn subdomain OR `{hubUrl}`. Admin edits preserved. `certificate_earned` intentionally excluded (already embeds `{verifyUrl}`). Idempotent. |
| **Share Template, hashtags mandatory + read-only preview** | ✅ Complete (2026-04-21) | Every share post now emits hashtags from `share_templates.hashtags` automatically appended to the body with `\n\n` + space-joined `#…` tokens. Student-side ShareModal preview textarea is read-only, students can't edit the merged text; admin edits on `/admin/training-hub/share-templates` are the single authority. LinkedIn clipboard always carries text + hashtags merged. |
| **Training Hub, Supabase Assessment Results** | ✅ Complete | training_assessment_results table (migration 090). Dual-write: Apps Script + Supabase. Progress route merges Supabase over Apps Script for instant dashboard updates. **Attempts counter is server-authoritative**, `submit-assessment` reads existing row's `attempts` and increments server-side, ignoring stale client `attemptNo`. `attempt-status` overlays Supabase row over Apps Script so the assessment page sees accurate attempt count at load. |
| **Training Hub, Assessment Timer Persistence** | ✅ Complete | `assessment_timer_${tabKey}_${attemptNo}` in localStorage records attempt start epoch. Page remount / navigate-away / reload resume from stored clock. If timer has expired while student was away → auto-submit with whatever answers were saved in `assessment_answers_${tabKey}`. Clock derived each tick from storage (no drift). `beforeunload` handler warns student while `pageState === 'taking'`. Cleared on manual or auto submit. |
| **Training Hub, Retake Flow** | ✅ Complete | `/api/training/certification-watch` POST guards against `'completed' → 'in_progress'` downgrade. Revisiting a watched video after a failed attempt no longer silently flips the row back to in_progress and hides the "Take Assessment" button. `'completed'` is now a terminal state. |
| **Training Hub, Universal Share Utility** | ✅ Complete | `shareTo(platform, { text, url, hashtags, onCopied })` in `src/shared/share/share.ts`, copies final text (with hashtags merged) to clipboard first, then opens the compose window. Platforms: `linkedin | whatsapp | twitter | copy`. LinkedIn always uses the plain feed composer (`/feed/?shareActive=true`), never `share-offsite`, so the textarea's `@`-mentions survive paste and trigger LinkedIn tag suggestions. `<ShareModal>` wraps the utility and seeds its editable textarea with `text + hashtags` merged so students see exactly what the clipboard holds before clicking share. |
| **Training Hub, Share Templates System** | ✅ Complete (migrations 114-117) | Centralized admin-editable share text. Table `share_templates` + four `training_settings` keys drive every share button across the platform. `renderShareTemplate(template, vars)` pure function auto-normalizes `{course}` via `resolveCourseName()` (COURSES short-code → full title) and `formatShareDate()` (canonical `en-GB` long form). `useShareTemplate(key)` client hook with module-level cache + DEFAULT_TEMPLATES fallback. Admin page `/admin/training-hub/share-templates` with Global Mention Settings card (brand/founder handle inputs + `Prefix @` toggles + live preview) and per-template editor (title, textarea, variable-picker chips, hashtag chip editor, active toggle, live preview with SAMPLE_VARS). Per-template `mention_brand`/`mention_founder` columns kept for schema compat but ignored at render. Universal sink: CertificateImageCard + VerifyActions + SessionCard + LiveSessionCard(Large) + assessment results + CourseTopBar watch-page share. |
| **Training Hub, Daily Certifications Roundup** | ✅ Complete (migration 117) | `/admin/training-hub/daily-roundup` lets admin share one post per day celebrating every student who earned a cert that day instead of one post per student. Date picker (defaults today, capped at today) + `GET /api/admin/certificates/by-date?date=YYYY-MM-DD` returning every `cert_status='Issued'` row for the UTC calendar day. Per-student checklist with Select all / Clear; live preview rebuilds on every toggle. Template `daily_certifications_roundup` uses `{studentList}`, `{verifyLinks}`, `{count}`, `{date}` + global `{@brand}`/`{@founder}`. Share Roundup button opens the universal ShareModal. Pulls the latest admin-edited template from the public API on mount. Admin nav entry: 🎓 Daily Roundup under Training Hub. |
| **Verify Page, Inline Document Previews** | ✅ Complete | `/verify/[uuid]` on learn subdomain renders inline PDF + badge previews between the credential details grid and QR/actions row. 2-column layout: left stacks Certificate (4:3 PDF iframe, `#toolbar=0` hides browser chrome) + Badge (1:1 `<img>` with soft-gold radial backdrop); right column is the taller Transcript (3:4 PDF iframe, prefers pre-cached `transcript_url` for instant load). Navy header strip with gold/blue accent label + `Open Full ↗` + floating `⛶ View` mobile-fallback pill. Downloads + share buttons sit below the QR. Metadata pinned to learn via `app/verify/layout.tsx` (metadataBase + canonical + og:url) so LinkedIn preview cards always show learn.* in the footer. |
| **SEO, Subdomain-Correct OG Metadata** | ✅ Complete | Per-subdomain layouts override root's MAIN_URL defaults: `app/training/layout.tsx`, `app/modeling/layout.tsx`, `app/verify/layout.tsx` each pin `metadataBase`, `alternates.canonical`, and `openGraph.url` to their own host. Specific pages (e.g. `/verify/[uuid]`) further refine with full per-URL canonical. `robots.ts` adds `Allow: /api/og/` (longest-match wins over broader `/api/` disallow) so LinkedInBot / Twitterbot / WhatsApp can fetch the dynamic OG images. Universal rule: every page's `og:url` and canonical match its actual URL, share previews always point to the URL that was shared, never redirect preview to a parent page. |
| **SEO, Search Engine Verification (Google + Bing)** | ✅ Complete | `app/layout.tsx` metadata.verification carries both Google Search Console (`google: 'jfT1RuMQksYExlTJUB_dB5Jisp_BBw6XCHEihIb-0pc'`) and Bing Webmaster Tools (`other: { 'msvalidate.01': '914C3726459EF363BC996DD79F3CF8E7' }`). Renders `<meta name="google-site-verification">` + `<meta name="msvalidate.01">` sitewide; both auto-verify once Vercel redeploys. |
| **SEO, Canonical / Sitemap / JSON-LD Audit (2026-04-24)** | ✅ Complete | Search Console flagged 1 "Page with redirect" + 14 "Discovered - currently not indexed". Two real bugs fixed: (1) `/training-sessions` (list) and `/training-sessions/[id]` (detail) had `alternates.canonical = MAIN_URL/...` but main-domain hits 307 to LEARN, so the canonical Google was told to index was itself a redirect. Both now resolve to `LEARN_URL/training-sessions...` matching where the page is actually served, and the sitemap entries also moved from MAIN to LEARN. (2) Legal pages (`/privacy-policy`, `/terms-of-service`, `/confidentiality`) only landed in the sitemap via the `cms_pages WHERE status='published'` branch, fragile if a row drifts. Added explicit fallback entries (low priority, yearly cadence) and a final dedup-by-URL pass so the cms_pages branch still wins on `lastModified` when present. Also wired `CourseJsonLd` for 3SFM and BVM on the `/training` landing page (helper existed but wasn't being called). `/about` 308 redirect to `/about/ahmad-din` is intentional and not the source of the warning (sitemap lists destination, no internal links to bare `/about`). All other SEO scaffolding (sitemap, robots, Org/WebSite JSON-LD, EventJsonLd on session detail, ArticleJsonLd on article detail, per-page generateMetadata, Search Console + Bing verification) was already in place. **Follow-up (commit `d27b7f9`)**: Search Console then flagged `/home` as a separate "Page with redirect" issue. Root cause: the cms_pages branch in `app/sitemap.ts` emits `${MAIN_URL}/${slug}` for every published row, and `cms_pages` has a `slug='home'` row that holds the home page CMS content for the page-builder admin (the page itself is canonically served at `/`). Added `SKIP_SLUGS = new Set(['home', 'about', 'modeling-hub'])` to the cms_pages loop, `home` would duplicate `/`, `about` 308s to `/about/ahmad-din`, `modeling-hub` 308s to `/modeling`. After re-deploy + re-submit, `/sitemap.xml` will no longer contain any of these. |
| **Dashboard, Upcoming Live Sessions Preview** | ✅ Complete | `LiveSessionsSection` on `/training/dashboard` shows upcoming-only (recordings live on `/training/live-sessions`). Grid capped at 3 cards (`slice(0, 3)` + `auto-fit, minmax(260px, 1fr)`), graceful 2/1 collapse on narrow viewports. Empty state: dashed-border placeholder with `CalendarClock` icon + `Browse recordings →` link (previously the block disappeared when nothing was upcoming). |
| **Training Hub, Achievement Card** | ✅ Complete | Dynamic OG image at `/api/training/achievement-image` (satori ImageResponse). Shows session, score, course, student name, reg ID, date. Logo from CMS (SVG→PNG via sharp). Admin-controlled logo height. **Context-aware for live sessions**: with assessment = green score circle + PASSED pill; without assessment = teal duration circle + ATTENDED pill, with session duration shown on both variants |
| **Training Hub, Share System** | ✅ Complete (superseded by Share Templates row above) | Every share surface now pulls from the centralized `share_templates` table via `useShareTemplate` + `renderShareTemplate`. SessionCard, CertificateImageCard, VerifyActions, LiveSessionCard(Large), assessment results, CourseTopBar watch-page share all use the same pipeline, admin edits template copy once, every button updates. Share modal textarea shows the merged text + hashtags exactly as they'll land on LinkedIn. |
| **OG Social Previews** | ✅ Complete | Per-domain OG banners: `/api/og` (learn), `/api/og/modeling` (app), `/api/og/main` (main site). CMS-driven hero text, logo from header_settings (sharp SVG→PNG). Assessment layout.tsx with dynamic OG tags per session |
| **Newsletter System (rebuild 2026-04-27, migration 143; Brevo since 2026-05-11)** | ✅ Complete (send path on Brevo; engagement webhook pending) | Production rebuild from a sequential per-email send loop + hardcoded template fork to a DB-driven, batch-sending, segmentable, schedulable, click-trackable pipeline shared between manual sends and event-driven auto-notifications. **Schema (migration 143)**: `newsletter_recipient_log` (per-recipient row with status pending/sent/failed/bounced/complained/opened/clicked + `resend_message_id` (column name retained for backwards compatibility; now stores Brevo message ids since 2026-05-11) + sent/opened/clicked timestamps + error_message; UNIQUE on `(campaign_id, email)`); `newsletter_templates` (admin-editable subject + body library; `event_type` matched by auto-notify; seeded with 6 templates mirroring the previously-hardcoded `generateContent` / `generateEmail` functions); `scheduled_at` + `segment` columns on `newsletter_campaigns`, status CHECK extended with 'scheduled' + 'cancelled'. **Sender** (`src/shared/newsletter/sender.ts`): resolves segment → seeds pending log rows → 100/batch via `sendEmailBatch()` (Brevo `Promise.allSettled` loop since 2026-05-11 commit `166a8ec`; was `resend.batch.send()`) → 200ms stagger → updates each row with returned message_id + status → updates aggregate counts. Used by manual send, scheduled cron, auto-notify, and retry-failed (the last passes explicit `recipients` array). **Segments** (`src/shared/newsletter/segments.ts`): 7 segments, `all_active`, `active_30_days`, `passed_3sfm`, `passed_bvm`, `never_started`, `has_certificate`, `no_certificate`. `targetHub='all'` deduplicates by email. **Link wrap** (`src/shared/newsletter/linkWrap.ts`): every `<a href>` rewrites to `/api/newsletter/click?msg={msg}&campaign=X&url=encoded`; UTM params auto-appended on internal hosts; unsubscribe + click endpoints skipped. **Webhook**: the old Resend webhook (`/api/webhooks/resend`) was **removed 2026-07-02** (Brevo is the provider, so Resend never sent events to it after the 2026-05-11 migration). Engagement tracking (open/bounce/complaint -> `newsletter_recipient_log`) via a Brevo webhook is a pending follow-up; until then click tracking is the only live engagement signal. **Click tracking** (`GET /api/newsletter/click`): public 302 redirector, best-effort row update, never blocks the user-facing redirect — now the only live engagement signal until the Brevo webhook lands. **Cron** (`GET /api/cron/newsletter-scheduled`): `CRON_SECRET` bearer; polls `status='scheduled' AND scheduled_at <= now()` (limit 20/tick); `vercel.json` daily 07:00 UTC (Hobby tier limit; finer cadence requires Pro). **Admin UI** (`/admin/communications-hub?tab=newsletter`): five sub-tabs, Subscribers (existing), Compose (template picker + segment dropdown + schedule datetime + live recipient count + Send-test-to-my-inbox button + Schedule-Send vs Send-Now CTA), **Templates (new)** (list + edit DB templates, per-event-type token chips, name + event_type + active toggle + RichTextEditor body), Campaigns (analytics modal: 6 stat cards sent/opened/clicked/failed/bounced/complained, open + click rates, per-recipient table, Retry-N-Failed button, Cancel-scheduled-send, CSV export, Delete), Auto Notifications (existing). **Signup opt-in**: checked-by-default GDPR-friendly checkbox on both `/training/register` and `/modeling/register`; fire-and-forget `POST /api/newsletter/subscribe` after successful registration. **Auto-notify refactor** (`src/shared/newsletter/autoNotify.ts`): now calls `renderForEvent(eventType, vars)` from the templates engine first, falls back to a hardcoded shell only when no DB template exists; then hands off to `sendCampaign()` so manual + auto sends share the batch + recipient log + retry path. **Env vars**: `BREVO_API_KEY` drives sends. `RESEND_WEBHOOK_SECRET` is retained ONLY as the bearer-token check on `/api/email/send` (the Apps Script email bridge); the webhook it was named for is removed. Rename to `EMAIL_BRIDGE_BEARER_SECRET` is a bookmarked follow-up (see CLAUDE-TODO.md). |
| **Marketing Studio (rebuild 2026-04-24, migration 142)** | ✅ Complete | Hard-reset from the Phase 1.5 freeform canvas editor (deleted entirely) to a focused template-driven tool at **`/admin/training-hub/marketing-studio`** (was `/admin/marketing-studio`). 4 asset types, brand-locked: **LinkedIn Banners** (3 variants, Profile 1584×396, Post 1200×627, Quote 1200×627), **Live Session Banner** (1200×627, auto-fills from a `live_sessions` row pick: title, datetime, timezone, duration, instructor; badge auto-toggles "LIVE SESSION" / "NEW RECORDING"), **YouTube Thumbnail** (1280×720), **Article Banner** (1200×630, auto-fills from `articles` row pick). **Asset Library** tab supports PNG / JPEG / WebP background uploads (max 10 MB) into the `marketing-assets` bucket; rename + delete with storage cleanup. Picker thumbnails appear in every editor; selection overlays a 55-70% navy scrim for text readability. **Brand pack enforced**: trainer photo + name + title fixed to default `instructors` row, FMP logo fixed per template, primary color from `email_branding.primary_color` drives every gradient via `lighten()` / `darken()`, single-color palette across all 4 asset types. **Render**: single dispatcher `POST /api/admin/training-hub/marketing-studio/render` returns `next/og` `ImageResponse` PNG using shared Inter font loader. **Migration 142**: drops `marketing_designs` + `marketing_brand_kit`, creates `marketing_uploaded_assets`, ensures `marketing-assets` storage bucket exists with public-read policy. Sidebar entry moved from Content section to Training Hub section between Communications and Share Templates. Admin-only, role-gated on every API + page; **Modeling Hub will get its own separate Marketing Studio later** at a different path. |
| **Marketing Studio - Multi-Instructor + Photo Upload + Drag-Resize (2026-04-24, follow-up)** | ✅ Complete | Three connected upgrades on top of the rebuild that flexed the brand-locked-only stance back toward "still on-brand but movable". (1) **Instructor photo upload** on `/admin/training-hub/instructors`: circular preview swatch + Upload Photo button + Remove button. POSTs file to existing `/api/admin/media` (cms-assets bucket); accepts PNG / JPEG / WebP up to 10 MB; auto-fills `photo_url`. URL paste-input still works. (2) **Multi-instructor selection** on every banner: each banner content type gained `instructorIds: string[]`. New `<InstructorPicker>` shared component renders a scrollable checklist with photo thumbnails + name + title + `(default)` badge + selection-rank chips (`#1`/`#2`/`#3`) showing render order. New API `GET /api/admin/training-hub/marketing-studio/instructors` returns active rows by `display_order`. Live Session editor's session-pick now auto-fills `instructorIds: [session.instructor_id]` (was using legacy text columns). Templates render single big trainer card when length=1, horizontal row of up to 4 cards when length≥2 (LinkedIn Post + Live Session); YouTube Thumbnail + Article Banner use the FIRST picked instructor only (template real-estate constraint). Empty list = falls back to default trainer from brand pack via `resolveInstructors()`. New `loadInstructorsByIds(ids[])` in `brand.ts` preserves admin pick order. Render route fetches each instructor's photo as base64 in parallel and passes a `Record<id, dataUri>` to every template. (3) **Drag + resize layout editor** on every template: each template now exports a `TemplateLayout` (canvas + `LAYOUT_DEFAULTS` rect per zone + descriptors with `resizable: bool`). Templates were refactored to absolute-position movable zones over a fixed background/header/footer scaffold. Same `mergeLayout(defaults, content.layout)` runs server-side (satori) and client-side (drag overlay), single source of truth. New `<LayoutEditor>` shared component overlays drag-and-resize boxes on the server PNG: move = drag anywhere on the box, resize = drag right edge / bottom edge / SE corner (resizable zones only). Mouse delta in screen-px is divided by displayed scale to get canvas-px delta; `clampRect()` keeps zones inside the canvas. Auto-render hook `useAutoRender` (350ms debounce) replaces the explicit "Generate Preview" button: any state change re-fetches the PNG; optimistic ghost rect during drag means motion feels instant. Per-template movable zones (logo + brand strips intentionally stay anchored): LinkedIn Profile (headline / subtitle / cta / trainerCard), LinkedIn Post (headline / subtitle / cta / trainerStrip), LinkedIn Quote (quoteBlock / trainerBadge), Live Session (headline / metaRow / cta / instructorStrip), YouTube Thumbnail (badge / title / subtitle / trainerCircle), Article Banner (eyebrow / title / authorBadge). Reset Layout button per editor wipes overrides; only diff vs defaults is persisted in `content.layout`. **No new packages**, drag handles use plain `mousedown`/`mousemove` listeners, no `react-rnd`. **No schema change**, uses existing `instructors.photo_url` column + `live_sessions.instructor_id`. |
| **Newsletter, Auto Notifications** | ✅ Complete | Triggers on article publish, live session publish/recording. Admin toggle per event type. Duplicate prevention via unique index. **2026-04-27**: refactored to render through `newsletter_templates` (migration 143) instead of hardcoded `generateEmail()`; eliminates manual-vs-auto template drift. Hands off to shared `sendCampaign()` so auto sends use the same batch + recipient log + retry path as manual sends and surface in the same Campaigns analytics modal. |
| **Legal Pages** | ✅ Complete | Privacy Policy, Terms of Service, Confidentiality & Terms (published), Refund Policy (draft). CMS-editable via Page Builder. Full PMBC legal entity details |
| **Founder Profile, Comprehensive** | ✅ Complete | Full career bio (Dallah, ACWA Power, PPP), Why FMP mission story, expertise/industry/market/personal sections. **All founder data now lives in `page_sections.team`** (home page team section). Legacy `founder_profile` table and `/admin/founder` standalone editor removed 2026-04-18 (migration 098 drops the table). Editing: Page Builder → Founder section (6 tabs). Hero contact (LinkedIn + Book a Meeting) + "Get in Touch" section at bottom of `/about/ahmad-din` with email/WhatsApp/LinkedIn/booking (admin-configurable in Booking Page tab). |
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
- **Never re-fetch questions during submission**, scoring is 100% client-side
- `/api/training/submit-assessment` accepts pre-scored data, writes to both Apps Script AND Supabase `training_assessment_results` (dual-write). Also sends quiz result email + locked-out email from Next.js
- **Server-authoritative attempt counter (2026-04-18):** `submit-assessment` reads the existing `training_assessment_results` row and increments `attempts = existing + 1` before writing. Client-side `attemptNo` is advisory only. `attempt-status` route overlays the Supabase row over Apps Script so the assessment page loads with the correct attempt count.
- **Timer persistence (2026-04-18):** `assessment_timer_${tabKey}_${attemptNo}` in localStorage records start epoch. Navigate-away/reload resumes the existing clock; expiry triggers auto-submit with saved answers; counts as the attempt. `beforeunload` warning active while `pageState === 'taking'`.
- `/api/training/progress` fetches from Apps Script, then merges Supabase results over the top (Supabase wins for any session it has data for, instant, no Apps Script delay)
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

## Badge Editor, Server Rendering

### What doesn't work on Vercel (DO NOT USE)
| Approach | Why it fails |
|----------|-------------|
| SVG `<text>` composite via sharp | sharp silently drops `<text>` elements |
| Sharp Pango `sharp({ text: ... })` | Font size ignored on Vercel (always 12px) |
| Embedded woff2 base64 in SVG | librsvg can't render woff2 |
| Embedded TTF base64 in SVG | 2.7MB SVG chokes librsvg |
| `@resvg/resvg-js` | Native binary, webpack can't bundle .node files |

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
- No `transform: undefined`, use conditional spread: `...(condition ? { transform: value } : {})`
- `serverExternalPackages: ['satori']` in next.config.ts

---

## Transcript PDF, ASCII-only rule

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

## Training Hub Sign-in, OTP Consistency

### Key rule
The email used to STORE the OTP must be the EXACT SAME email used to VERIFY it.

### Flow
- **Email input**: validate resolves regId -> OTP sent to email -> verified with same email
- **RegID input**: validate resolves email from DB -> OTP sent to resolved email -> verified with resolved email
- `deviceEmail` state always set from `json.email.toLowerCase()` from validate API response
- `isDeviceTrusted()` checks by email (not regId)
- `trustDevice()` stores by email.toLowerCase() (not regId)

### Files
- `app/training/signin/page.tsx`, client OTP flow
- `app/api/training/validate/route.ts`, `isDeviceTrusted(cookie, email, 'training')`
- `app/api/training/device-verify/route.ts`, `trustDevice(email.toLowerCase(), 'training')`

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
- Join link NEVER shown on list page, only on detail page after registration + 30 min before
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
- `/training/dashboard`, overview (default)
- `/training/dashboard?course=3sfm`, directly opens course view
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
- `UpcomingSessionsPreview` on `app/training/page.tsx`, up to 3 upcoming sessions
- Auto-hides if no upcoming sessions exist

---

## CFI-Style Course Player System

### CoursePlayerLayout (`src/hubs/training/components/player/CoursePlayerLayout.tsx`)
Full-page immersive layout for watching training sessions and certification videos:
- **Left sidebar**: Navy background, session list with checkmarks/numbers, back link
- **Top bar** (`CourseTopBar.tsx`): Session title, action icons (Subscribe, Like, Ask Question, Share), Mark Complete button, Take Assessment button, Continue link
- **Main area**: Two states, Screen 1 (session info + "Watch Session" button) and Screen 2 (embedded YouTubePlayer + comments panel)
- **Right panel**: YouTube comments (desktop only, when video open)
- **Mobile**: Single column, sidebar below content

### Certification Watch Page (`app/training/watch/[courseId]/[sessionKey]/page.tsx`)
- Embedded video player for certification course sessions (3SFM, BVM)
- Mark Complete unlocks 20 seconds before the video ends, `YouTubePlayer.onEnded` fires when the tick crosses `currentTime >= duration - 20` (commit `f790fa9`, 2026-04-29). Final fallback: YT `PlayerState.ENDED`. Corner case: PAUSED-at-tail when `currentTime >= duration - 1`.
- Two-step flow: Mark Complete → Take Assessment
- Progress restored from `progressMap` (DB-backed via `/api/training/progress`)
- Watch tracker still posts intervals to `certification_watch_history` for analytics; nothing gates Mark Complete on percentage anymore (commit `f583c70`).
- Dashboard SessionCard "Watch Video" links to internal watch page (not external YouTube)

### Student Notes (`src/hubs/training/components/StudentNotes.tsx`)
- Per-session private notes with bold/bullet toolbar
- Auto-save on blur via `POST /api/training/session-notes`
- Table: `session_notes` (session_id + student_email UNIQUE)

### Subscribe Modal (`src/hubs/training/components/SubscribeModal.tsx`)
- Clean modal with YouTube subscribe link (`?sub_confirmation=1`)
- No Google widget dependency, simple reliable button

### Welcome Modal (`src/hubs/training/components/WelcomeModal.tsx`)
- First-visit modal with YouTube + LinkedIn buttons
- Configurable `storageKey` prop (default `fmp_welcomed`, Training Hub uses `fmp_hub_welcomed`)
- Shows on Training Hub pages + public training sessions pages

### Follow Popups (`src/shared/components/FollowPopup.tsx`)
- LinkedIn + YouTube buttons in: main site footer, Training Hub sidebar, post-complete popup, 60s video popup, site-wide 60s popup
- sessionStorage dedup, auto-dismiss, configurable

### Certificate Issuance (inline-triggered, migration 124)

Final-exam pass is the trigger. The old daily `/api/cron/certificates` route was deleted and its `vercel.json` schedule entry removed. Certificates now issue within seconds of the student clicking Submit on a passing final-exam attempt.

- **Primary path**: `app/api/training/submit-assessment/route.ts` fires `issueCertificateForStudent(cleanEmail, courseCode, { issuedVia: 'auto' })` as fire-and-forget when `didPass && isFinal === true`. The student's HTTP response returns immediately; PDF + badge render, Supabase Storage upload, DB insert, and the `certificateIssuedTemplate` email all run in the background. The courseCode is derived from the tab_key prefix (`BVM_*` → `BVM`, else `3SFM`) to stay consistent with the `training_assessment_results.course_id` derivation a few lines above.
- **Engine helper `issueCertificateForStudent(email, courseCode, options)`** lives in `src/hubs/training/lib/certificates/certificateEngine.ts`. Flow: skip if an `Issued` row already exists (cheap early-out), run `checkEligibility`, build the `PendingCertificate`, hand off to `issueCertificateForPending`. Safe to call multiple times because the unique index on `(LOWER(email), course_code)` from migration 111 is the hard DB guard.
- **Email delivery tracking**: `student_certificates.email_sent_at TIMESTAMPTZ NULL` (migration 124) is stamped after `sendEmail` resolves successfully in `issueCertificateForPending`. A null stamp means the cert was generated but the email never went out (Brevo outage, bad address, template error; previously Resend before 2026-05-11). Surfaces as a yellow "Unsent" pill + `✉ Resend` button (verb: send-again) on `/admin/training-hub/certificates`. Partial index keeps the "needs resend" lookup constant-time.
- **Safety-net panel** at `/admin/training-hub/certificates`:
  - **🛟 Eligible but not issued**, queries `GET /api/admin/certificates/pending` which reads `certificate_eligibility_raw` where `final_passed=true` minus rows already `Issued` in `student_certificates`. Per-row `⚡ Issue Now` button fires `POST /api/admin/certificates/issue-pending { email, courseCode }`. Bulk `Issue All Pending` fires `POST /api/admin/certificates/issue-pending { all: true }` and reports `{ issued, skipped, failed }`.
  - **Email column** in the main cert table shows the `email_sent_at` pill state. `✉ Resend` button calls `POST /api/admin/certificates/resend-email { certificateId }` which rebuilds the template, sends, and stamps the column.
  - **Force-Issue** remains for explicit overrides (bypasses watch threshold; records `issued_via='forced'` + `issued_by_admin`). Distinct from "Issue Now" on the pending list which still runs the full eligibility gate.
- **Idempotency**: the inline trigger, the force-issue override, and the pending-list "Issue Now" button all resolve to `issueCertificateForPending` which does a SELECT-then-INSERT-or-UPDATE keyed by `(LOWER(email), course_code)`. Two concurrent calls are blocked by the unique index; the pre-check in `issueCertificateForStudent` avoids regenerating PDFs for already-issued students. Admin force-issue bypasses the pre-check because that entry point legitimately allows re-issuance.
- **Fix addresses** the pre-launch diagnosis RED findings: latency (was up to 24 hours via daily cron, now sub-minute inline), observability (was zero, now `email_sent_at` + pending panel give full visibility), and Apps Script coupling (the cron was the last place Apps Script polling still drove timing; the engine's Apps Script sync remains best-effort and non-blocking).

### Live Session Achievement Card (context-aware)

`/api/training/achievement-image` accepts two new query params that switch the right-side visual and add duration context on all live-session cards. 3SFM/BVM cards are unaffected because they never pass these params and the route defaults preserve the legacy score-circle render.

- **`has_assessment`**: `'true'` (default) renders the existing green score circle + `✓ PASSED` pill using `score`. `'false'` replaces the right column with a teal 200px circle showing the session duration in its native copy slot (e.g. `90 MIN` / `1H 30M`) plus a `✓ ATTENDED` pill, and swaps the top-left eyebrow from `🏆 Assessment Passed` to `🎓 Session Completed`.
- **`duration`**: integer minutes. Rendered on both variants. The number formats as `45 MIN` under 60 minutes, `2H` on the hour, `1H 30M` otherwise. On the with-assessment variant it appears as a clock-icon chip in the bottom meta row alongside the date + reg ID, so score + duration read cleanly side by side. On the without-assessment variant it becomes the hero stat inside the right circle; if duration is missing, the circle falls back to a 🎥 glyph so the card still looks intentional.
- **Call site**: `src/hubs/training/components/dashboard/LiveSessionCardLarge.tsx` `achievementCardUrl()` derives `has_assessment` from `session.has_assessment` (column added in migration 105) and `duration` from `live_sessions.duration_minutes`. Both flow into `ShareModal.cardImageUrl` for the student preview and share. Eligibility for the card is unchanged: with assessment requires a pass, without assessment requires watch ≥ threshold.
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

### ShareExperienceModal (`src/shared/components/ShareExperienceModal.tsx`)
3 Tabs: Written Review (star rating, LinkedIn URL), Video Testimonial (Loom/YouTube), Social Share (LinkedIn/Twitter/WhatsApp/Copy)

### Integration Points
- Dashboard sidebar: "Share Experience" item
- Dashboard achievements: "Share Your Experience" button
- Dismissable banner when `totalPassed >= 1` (localStorage: `fmp_share_banner_dismissed`)
- TrainingShell sidebar link to `/training/submit-testimonial`

### Validation
- LinkedIn URL: must match `linkedin.com/in/` pattern
- Video URL: must match `loom.com` or `youtube.com` or `youtu.be`

---

# Module 1 (REFM) Phase History (frozen pre-M2.0)

> Historical narrative of the v3 / v4 Module 1 evolution from M1.R (2026-04 cost-engine + Zustand restoration) through M1.13d (2026-05-06 EquationRow Build Program). M2.0 (2026-05-06) hard-cut the schema to v5 and replaced this entire surface; see CLAUDE.md for current Module 1 status (M2.0 / M2.0b / M2.0c on the v5/v6 schema).
>
> For deeper history (commit-level v3 → v4 evolution), run `git log -- 'src/hubs/modeling/platforms/refm/lib/state/module1-types.ts'`.

For history, see CLAUDE-FEATURES.md and `git log -- 'src/hubs/modeling/platforms/refm/lib/state/module1-types.ts'` for the v3/v4 evolution. The text below is the M1.13b closure note retained as historical reference; M2.0 supersedes it.

### Module 1 status (legacy, M1.13b dissolves the calc panels into inline formulas)
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
plain-English help wired into every input across all 5 Module 1 tabs) → M1.11
(holistic re-audit + 22 coordinated fixes: ProjectWizard portal mount, semantic Project
Timeline Visual with multi-phase awareness, dead setters removed from Module1Area +
Module1Timeline, asset Strategy + Zone tooltips on Build Program, parcel state-path
unified to Zustand setLand, shared parcelFieldHelp + assetStrategyHelp modules, Dev
Costs phase-scope explainer + cost row tooltips, Financing per-line Debt % tooltip,
em-dash sweep across the whole repo with new writing rule prohibiting reintroduction)
→ M1.12 (Land tab dissolved + tab consolidation 5→4: Land Parcels capture moved
upfront into ProjectWizard Step 2 with default 100k @ 500 single-row seed and inline
add/remove + live totals; Build Program grows a Land Parcels block at the top of the
tab with the same CRUD surface plus the Setup Wizard CTA; Site Parameters Project
Roads % / Project FAR / Non-Enclosed Area % no longer have a UI surface and live only
on the per-Plot card under Build Program; Module 1 table headers gain the FAST
contrast convention via tableHeaderLabelStyle / parcelHeaderLabelStyle (white-on-navy
InputLabel) so column titles stay legible in light + dark mode)
→ M1.13 (Module 1 self-explanatory: a new FormulaCaption primitive renders a small
italic "= <expression> = <values> = <result>" line adjacent to every derived
output across all 4 tabs, with live values substituted into the plain-English
formula on every input edit)
→ **M1.13b** (eliminate the separate "Computed Envelope" + "Cascade Preview" +
"Timeline Summary" panels; restructure Build Program inputs into 8 ordered
sections with formula captions sitting directly under the input row that completes
each formula. Plot Envelope -> Podium -> Typical Tower -> Floors check -> Public
Area Split -> Parking surface -> Parking vertical -> Parking basement; cascade
chain renders inline beneath the cascade inputs as a stack of 8 formula captions;
Schedule timeline summary panel dissolved into 3 inline captions next to the
Granularity / Project Start / Overlap inputs; Financing Debt Summary card rolled
up to a clean reckoning without duplicate formula lines. Playwright proximity
spec asserts every formula caption sits within 200 vertical pixels of its driving
input).
→ **M1.13c** (step-by-step verifiable calculation flow: every input
followed by a VerifiedResult primitive that visually binds three
elements into one verification unit, the formula expression in plain
English, the substituted values with proper math operators (× ÷),
and the result chip with units. Validation states tint the result
chip ('warn' amber, 'error' red) and surface an issue callout when
the value is invalid. Wired across all 4 tabs: Build Program flips
to error when utilization > 100% of Max GFA, when cascade MEP+BoH+
Other > 100% of GFA, or when parking allocator deficit > 0; Schedule
flips to error when Construction + Operations - Overlap <= 0 (warn
when overlap exceeds either window); Dev Costs flips to warn when
the rate / percent base resolves to 0; Financing flips to warn at
LTV = 0% (all-equity), to error at LTV >= 100%, and to warn when
Repayment Periods exceeds Operations window. Playwright spec asserts
the over-FAR push (Max FAR=1, Typical Floors=20, Typical Coverage=
60%) flips Total Built GFA chip ok → error in place, then resetting
to sane values flips back to ok).
→ **M1.13d** (Build Program adopts the EquationRow 3-box layout per
user feedback that the M1.13c VerifiedResult was still too dense:
every plot envelope step + every cascade step now reads left-to-
right as one math equation, [field] op [field] = [result chip].
Inputs are editable yellow boxes; derived values (Footprint, Public
Area, etc.) render as read-only dashed boxes when they feed
downstream rows so the user sees the calc chain visually. 14 plot
envelope rows + 8 cascade rows + 1 parking allocator row per plot,
each with section headers acting as subtle dividers (Plot Envelope,
Podium, Typical Tower, Floors Check, Public Area Split, Parking
surface / vertical / basement). Validation states preserved on
result chips, ok green-pale, warn amber, error red, with issue
callout rendered as sibling below the row. Three-input rows
supported (Typical GFA = Plot × Coverage × Floors, parking allocator
total = Surface + Vertical + Basement) so any equation up to 3
input fields fits in one visual row). **Module 1 ships production-
ready after M1.13d; next phase is M2.0 (revenue, opex, deferred
calc-engine refinements including the per-plot derive of project-
level FAR / Roads / NEA still read by calculateAreaHierarchy from
stored snapshot fields).**

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
  selects replaced (literal `(none)` instead of bare em-dash for blank
  Secondary strategy, `(no zone)` instead of em-dash plus parenthetical).
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

**M1.12 Land tab elimination + 4-tab consolidation (6 commits, 2026-05-06,
all snapshot diffs bit-identical):**
- `ae7fec6` 1/6 (wizard): ProjectWizard Step 2 grows a Land Parcels
  capture block. New `WizardDraftParcel` interface + `parcels:
  WizardDraftParcel[]` field on WizardDraft seeded with one row
  (`Land 1`, 100,000 sqm, 500 / sqm, 60 / 40 cash split). New
  `Step2LandParcels` component (~150 lines) renders an inline grid
  with Parcel Name + Area + Rate + Cash % + In-Kind % columns, a
  `+ Add Parcel` button, a remove control per row when count > 1, and
  a totals row showing total area / total value / weighted cash share.
  Step 2 validation gate extended via `step2ParcelsValid` (every
  parcel has area > 0, rate > 0, cashPct + inKindPct sum to 100 within
  tolerance). data-testid markers (`wizard-parcels-section`,
  `wizard-add-parcel`, `wizard-parcel-row-{id}`,
  `wizard-parcel-{id}-{field}`, `wizard-parcels-totals`) wired for
  Playwright. `buildWizardSnapshot` maps `draft.parcels` to
  `LandParcel[]` and writes `snapshot.landParcels`; per-plot area
  derives from `totalParcelArea / draft.plotCount` so the wizard
  preserves the Plot vs Parcel split established in M1.10.
- `8f99ce2` 2/6 (Build Program): Land Parcels block lifts to the top
  of the Build Program tab as a full-CRUD section above the
  reconciliation row. New `LandParcelsBlock` component renders the
  same 5-column table as the wizard but bound to the Zustand store
  via `setLand({ landParcels })`. Header row uses the FAST contrast
  convention via new local `parcelHeaderStyle` (navy bg) +
  `parcelHeaderLabelStyle` (white text, bold) constants threaded into
  `<InputLabel textStyle={...}>`. Help copy reuses `PARCEL_FIELD_HELP`
  from `lib/copy/parcelFieldHelp.ts` (M1.11/3) so Wizard, Build
  Program, and `ParcelSetupWizard` share one source of truth.
  ParcelSetupWizard CTA stays as a "🪄 Setup wizard" button on the
  block.
- `b056062` 3/6 (tab consolidation): Land tab dissolved entirely.
  `m1Tabs` reduces from 5 to 4 entries: 1. Schedule, 2. Build Program,
  3. Dev Costs, 4. Financing. `Module1Area` import + JSX mount removed
  from `RealEstatePlatform.tsx`; replaced with a docstring marker
  explaining that the underlying state schema (`landParcels`,
  `projectFAR`, `projectRoadsPct`, `projectNonEnclosedPct`) is
  preserved so calc engine signatures + snapshot fixtures stay
  bit-identical; only the UI surface is gone. Existing snapshots
  load through `module1-migrate.ts` unchanged. ProjectFAR / Roads % /
  Non-Enclosed % no longer have any UI surface in M1.12; the per-Plot
  card under Build Program is the single source of truth users edit.
  Auto-derive (weighted average from per-plot maxFAR + plot
  landscape / hardscape coverage) deferred to M2.0 so the calc
  engine signature does not change inside this phase.
- `4287623` 4/6 (FAST contrast): Module 1 table-header contrast audit.
  `Module1Costs.tsx` grows a local `tableHeaderLabelStyle` constant
  (`color: var(--color-on-primary-navy); fontWeight: var(--fw-bold)`)
  threaded through 7 InputLabel instances inside `<th>` cells (Cost
  Name, Stage / Scope, Method / Base, Input Value, Start, End,
  Phasing). Mirrors the new `parcelHeaderLabelStyle` introduced for
  Build Program in M1.12/2. Light-mode reads cleanly because the
  navy bg gives white text the WCAG AA contrast it needs; dark mode
  unchanged because the convention was already partly in place
  pre-audit.
- `2a2b3a7` 5/6 (verifier + Playwright): scripts/verify-m112.ts
  mirrors the M1.11 5-section template (DB / routes / calc / state /
  UI). Section 4 markers F1 (m1Tabs has 4 entries with no `'land'`
  key), F2 (Module1Area is unmounted from RealEstatePlatform), F3
  (numbered labels renumbered 1→4), P1 (wizard parcel default seed),
  P2 (Step2LandParcels mounted in ProjectWizard), P3
  (buildWizardSnapshot writes landParcels), B1 (Build Program
  LandParcelsBlock mount), B2 (FAST contrast constants present),
  C1 (Module1Costs tableHeaderLabelStyle present). Result: 21 pass /
  0 fail / 0 skip with dev server up; 15 pass / 0 fail / 2 skip
  without dev server. tests/e2e/m112-flow.spec.ts has 2 specs:
  (1) wizard Step 2 parcel CRUD (default seed, +Add Parcel, edit
  area / rate / split, remove, live totals), (2) post-create flow
  asserts the 4-tab row (no Land tab) + Build Program parcel block
  is the canonical CRUD surface + 8 light/dark tab screenshots into
  tests/screenshots/M1.12/. Both pass locally (18.7s).
- (this commit) 6/6 (docs sweep): CLAUDE.md M1.12 series block,
  scripts table entry, Playwright spec entry, Module 1 status header
  extended with the M1.12 completion line.

**M1.13 Module 1 self-explanatory inline live formulas (7 commits,
2026-05-06, all snapshot diffs bit-identical):**
- `af3d429` 1/7 (primitive): src/hubs/modeling/platforms/refm/components/
  ui/FormulaCaption.tsx. New shared primitive that renders a single
  line of small italic meta-color text shaped "= <expression> =
  <substituted with current values> = <result>". Caller passes the
  fully formatted text + an optional testId; the primitive just
  renders it on transparent background under the value chip so the
  formula visually recedes behind the FAST grey calc-output style.
  data-formula="true" attribute on every render so Playwright can
  count captions per tab. Forbids em-dashes by convention (M1.11
  writing rule).
- `e87afe1` 2/7 (Build Program): Module1AreaProgram grows formula
  captions on every derived output. calcRow + CascadeCell + ParkingCell
  helpers each accept an optional formula prop; the legacy "Computed
  envelope" panel now renders 10 plain-English formulas (Plot Area *
  Max FAR for Max GFA, Footprint * Podium Floors for Podium GFA, etc.)
  with live values substituted. Cascade preview gains 8 captions
  walking the GFA -> MEP -> Net GFA -> GSA / GLA -> BUA -> TBA -> BoH
  -> Other Tech chain. Parking summary gains 5 captions showing
  capacity = area / bay-size for surface / vertical / basement.
  LandParcelsBlock tfoot sprouts 3 captions for Total Area, Total
  Value, weighted Cash %. data-testids: computed-envelope-{plotId},
  cascade-preview-{assetId}, calc-row-{label}, cascade-cell-{label},
  parking-cell-{label}, parcel-formula-area / -value / -cash.
- `f35ac44` 3/7 (Schedule): Module1Timeline Timeline Summary panel
  rebuilt as a 4-cell grid with FormulaCaption rows beneath End,
  Total Periods, and Type. End formula: Project Start + Total Periods.
  Total Periods formula: Construction + Operations - Overlap with the
  three input numbers substituted live. Type formula explains what
  monthly vs annual granularity means in practice ("1 period = 1
  month" vs "1 period = 1 year, 12 months per bucket"). data-testids:
  timeline-summary, timeline-formula-end, timeline-formula-total-
  periods, timeline-formula-type.
- `cb2cb2f` 4/7 (Dev Costs): Module1Costs gets a buildCostFormula
  helper that, given a CostItem + the resolved AreaMetrics, returns
  the plain-English formula string for the active method (Fixed
  Amount, Rate * Total Land / NDA / Roads / GFA / BUA, % of Selected
  Costs, % of Total / Cash / In-Kind Land Value). Each cost row's
  Total cell now renders the formula caption beneath the value via
  data-testid="cost-formula-{cost.id}". The asset's Grand Total tfoot
  cell carries a sum-of-stages caption via data-testid="cost-grand-
  total-formula-{assetType}". Selected-costs sum is computed live for
  percent_base rows so users see exactly which dollar base the
  percentage applied to.
- `c6a3017` 5/7 (Financing): Module1Financing adds 3 input-side
  formula captions and rebuilds the Debt Summary card as 5 live-
  formula rows. Inputs: financing-formula-debt-equity (Debt = LTV *
  CapEx + Equity = (100 - LTV) * CapEx with both numbers live),
  financing-formula-periodic-rate (Annual / 12 for monthly or
  Annual for annual; rendered with the resolved 4-decimal periodic
  rate), financing-formula-repayment (Principal per Period = Debt /
  Repayment Periods for Fixed; placeholder for Cash Sweep). Debt
  Summary: Total CapEx, Debt, Equity, Estimated Interest, All-in
  Cost of Debt; each value paired with a formula explaining how it
  derives. data-testid="financing-debt-summary".
- `afe4f00` 6/7 (verifier + Playwright): scripts/verify-m113.ts
  mirrors the M1.12 5-section template. Section 4 has 11 markers
  (F1 primitive, S1 Schedule, B1-B4 Build Program, C1-C2 Dev Costs,
  P1-P2 Financing, X1 em-dash sweep). Result: 23 pass / 0 fail / 0
  skip with dev server up; 20 pass / 0 fail / 1 skip without (UI
  rendering skips on no server). tests/e2e/m113-formulas.spec.ts
  has 1 spec walking Schedule -> Build Program -> Dev Costs ->
  Financing, asserting the right testIds on each tab + the live-
  recompute contract: editing a Plot's Max FAR or Plot Area updates
  the Max GFA caption inline within 3 seconds (no unmount, no
  reflow). 8 light + dark screenshots into tests/screenshots/M1.13/.
  Both pass locally (10.4s).
- (this commit) 7/7 (docs sweep): CLAUDE.md M1.13 series block,
  scripts table entry, Playwright spec entry, Module 1 status header
  extended with the M1.13 completion line.

**M1.13b inline-formula layout (5 commits, 2026-05-06, all snapshot
diffs bit-identical):**
- `8aa81b7` 1/5 (Build Program): Module1AreaProgram restructure. The
  previous 4-column 15-input grid + Computed Envelope panel + Cascade
  Preview panel are dissolved. Inputs regroup into 8 ordered sections,
  each with a small uppercase header + thin top border:
  Plot envelope (Plot Buildable Area + Max FAR -> Max GFA),
  Podium (Podium Coverage + Podium Floors -> Footprint, Podium GFA,
  Public Area), Typical tower (Typical Coverage + Typical Floors ->
  Typical GFA, Total Built GFA + utilization), Floors check (Total
  Floors with podium+typical sanity check), Public area split
  (Landscape % + Hardscape % -> Landscape Area, Hardscape Area, Surface
  Parking), Parking surface (Surface Bay -> Surface Capacity), Parking
  vertical (Vertical Bay + Vertical Parking Floors -> Vertical
  Capacity), Parking basement (Basement Bay + Count + Efficiency ->
  Basement Usable + Basement Capacity). Each cascade output renders as
  an inline FormulaCaption stack beneath the cascade inputs (no panel
  wrapper). 14 plot-formula testIds + 8 cascade-formula testIds + 8
  section testIds wired for Playwright proximity assertions.
  ParkingSummary kept as a compact roll-up at the bottom of the plot
  card (its Required vs Allocated math depends on Sub-Units which live
  outside the plot input grid). Removed legacy calcRow + CascadeCell
  helpers.
- `2afb188` 2/5 (Schedule): Module1Timeline dissolves the gray
  "Timeline Summary (live formulas)" panel. Three inline captions
  re-anchored: Granularity toggle gets a 1-line caption explaining
  what monthly vs annual means; Project Start Date input gets the
  Project End caption (= Start + Total Periods); Project Overlap
  input gets the Total Periods caption (= Construction + Operations -
  Overlap). Removed unused calcOutputStyle + labelStyle constants.
- `365a5a1` 3/5 (Financing): Module1Financing Debt Summary card
  reverts to a clean 5-row roll-up without FormulaCaption rows
  inside. The per-input formula captions inline above (debt-equity,
  periodic-rate, repayment) already explain the math; the summary
  serves as a reckoning of the resolved values. Card label rolled up
  from "Debt Summary (live formulas)" back to "Debt Summary".
- `0e39c4d` 4/5 (verifier + Playwright): scripts/verify-m113b.ts
  mirrors the M1.13 5-section template; section 4 grows new panel-
  absence + per-formula testId markers (A1-A6 Build Program, S1-S2
  Schedule, F1-F2 Financing, X1 em-dash sweep). Result: 23 pass / 0
  fail / 0 skip with dev server up. tests/e2e/m113b-formulas-inline.
  spec.ts (1 spec, 14.5s) walks all 4 tabs with two contracts:
  (1) panel absence, the 3 dissolved panels MUST NOT render; (2)
  proximity, each driving input is followed by its formula caption
  within 200 vertical pixels (assertProximate helper computes
  bounding-box distance). Schedule: Overlap -> Total Periods, Project
  Start -> Project End. Build Program: Max FAR -> Max GFA, Podium
  Floors -> Podium GFA, Typical Floors -> Total Built GFA, Hardscape
  -> Surface Parking, Surface Bay -> Surface Capacity, Vertical
  Floors -> Vertical Capacity, Basement Efficiency -> Basement
  Capacity. Live recompute on Max FAR + Plot Area still works (caption
  text substitutes inline, no unmount). Financing Debt Summary card
  has zero FormulaCaption rows + label is "Debt Summary" (not "Debt
  Summary (live formulas)"). 8 light + dark screenshots into
  tests/screenshots/M1.13b/.
- (this commit) 5/5 (docs sweep + M1.13 artifact updates): updated
  scripts/verify-m113.ts B1/B2/S1/P2 markers + tests/e2e/m113-
  formulas.spec.ts assertions to track the new inline-layout testIds
  (formula-max-gfa-{id} instead of computed-envelope-{id}; "Debt
  Summary" instead of "Debt Summary (live formulas)") so M1.13's
  verifier and spec stay green alongside M1.13b's. CLAUDE.md M1.13b
  series block, scripts table entry, Playwright spec entry, Module 1
  status header extended.

**M1.13c step-by-step verifiable calculation flow (8 commits,
2026-05-06, all snapshot diffs bit-identical):**
- `7c8d492` 1/8 (primitive): src/hubs/modeling/platforms/refm/components/
  ui/VerifiedResult.tsx. New shared primitive that renders one
  verification step visually binding three pieces into one row:
  the formula expression in plain English, the live substitution
  with current numbers, and the result chip with units. Validation
  state ('ok' / 'warn' / 'error') tints the row + chip and surfaces
  an issue callout to the right when not 'ok'. data-formula="true",
  data-state, and data-result-chip="true" attributes wired so
  Playwright + future regression specs can target the shape without
  reading display text. Display text uses Unicode operators (× ÷)
  per the M1.13c brief; internal data attributes stay ASCII for
  selector simplicity. Sits below the input(s) with a 200 vertical
  px proximity contract carried over from M1.13b.
- `776b15d` 2/8 (Schedule): Module1Timeline replaces the 3
  FormulaCaption rows (granularity, project end, total periods)
  with VerifiedResult verification steps. Overlap step gains a
  validation derivation: state='warn' when overlapPeriods exceeds
  Construction or Operations window; state='error' when
  Construction + Operations - Overlap <= 0 (model would have no
  periods to run). testIds preserved so M1.13b proximity contract
  still holds.
- `d00187d` 3/8 (Build Program): Module1AreaProgram converts every
  plot envelope formula (Max GFA, Footprint, Podium GFA, Public
  Area, Typical GFA, Total Built GFA, Floors check, Landscape,
  Hardscape, Surface Parking, 3 parking capacities, 2 basement
  outputs) plus all 8 cascade outputs (GFA, MEP, BoH, Other Tech,
  Net GFA, BUA Excl, TBA, GSA/GLA) plus 3 land-parcel totals into
  VerifiedResult steps. Math operators upgraded to × and ÷.
  Validation states wired:
    * Total Built GFA: state='error' when utilization > 100% of
      Max GFA. Issue chip names the exact percentage.
    * Floors check: state='warn' when Podium + Typical does not
      match Total Floors.
    * Surface Parking: state='warn' when Landscape + Hardscape >
      100% of public area.
    * Cascade Net GFA: state='error' when MEP + BoH + Other Tech
      > 100% of GFA (cascade over-deducts).
    * Parking allocator: state='error' when alloc.deficit > 0,
      with the deficit named in the issue chip.
  ParkingCell render simplified, the per-cell FormulaCaption is
  removed in favour of a new bottom-row VerifiedResult on the
  allocator total. Land parcel totals show per-parcel substitution
  chains (e.g. "100,000 × 500 + 25,000 × 700 = ...").
- `6721522` 4/8 (Dev Costs): Module1Costs replaces the cost-row
  FormulaCaption in the Total cell with VerifiedResult.
  buildCostFormula refactored into buildCostFormulaParts that
  returns a structured (formula, substitution, result) tuple so the
  three pieces wire cleanly into the primitive. Math operators
  upgraded (Rate × GFA, Rate × NDA, Rate × BUA, ...). Validation
  state: soft-warn (amber) when the cost method is rate or percent
  and the resolved base resolves to 0 (rate_gfa with GFA=0,
  percent_base with selectedSum=0, etc.). Issue chip names which
  base collapsed so the user can fix the upstream input. Grand
  Total tfoot row also becomes a VerifiedResult so Σ-of-stages
  is visible inline.
- `d628745` 5/8 (Financing): Module1Financing replaces the 3
  inline FormulaCaption rows (debt-equity, periodic-rate,
  repayment) with VerifiedResult steps. Math operators upgraded
  (Debt = LTV × Total CapEx, Periodic Rate = Annual Rate ÷ 12,
  Principal per Period = Total Debt ÷ Repayment Periods).
  Validation states:
    * LTV: state='warn' when LTV = 0% (all-equity sanity flag);
      state='error' when LTV >= 100%.
    * Repayment: state='warn' when repaymentPeriods >
      operationsPeriods (the math clamps to ops window, but the
      user has typed a value the model silently overrides).
  Debt Summary card preserved as a clean roll-up per M1.13b's F1
  contract (no VerifiedResult / FormulaCaption rows inside).
- `4ba4c90` 6/8 (M1.13b spec operator update + import cleanup):
  M1.13b spec asserted FormulaCaption text contained 'X * Y ='
  literals with ASCII *. Updated to '× Y =' so the M1.13b
  regression test continues to pass alongside the new primitive's
  Unicode operators. Also dropped the now-unused FormulaCaption
  import from Module1AreaProgram.tsx (every caller switched to
  VerifiedResult in M1.13c/3).
- `d560bb4` 7/8 (verifier + Playwright): scripts/verify-m113c.ts
  mirrors the standing 5-section template. Section 4 has 17
  markers across V1 (primitive shape), B1-B5 (Build Program), S1-
  S3 (Schedule), C1-C4 (Dev Costs), F1-F4 (Financing), X1 (em-
  dash sweep). Result: 27 pass / 0 fail / 1 skip with dev server
  up; 24 pass / 0 fail / 2 skip without. tests/e2e/m113c-step-
  flow.spec.ts (1 spec, 20.6s) walks all 4 tabs and asserts:
  (1) every VerifiedResult render carries data-formula="true",
  data-state ∈ {ok, warn, error}, and a data-result-chip child;
  (2) math operators (× ÷) appear in rendered text not just source;
  (3) validation flip, push Plot to over-FAR (Max FAR=1, Typical
  Floors=20, Typical Coverage=60%) and Total Built GFA chip flips
  ok → error with issue callout visible; reset to sane values and
  it flips back to ok; (4) live recompute, edit Plot Area to
  200,000 and Max GFA chip shows "200,000 × 3" inline; (5) Debt
  Summary card stays a clean roll-up (no data-formula rows
  inside, M1.13b F1 carryover); (6) proximity contract still
  holds for the 5 key chain anchor inputs. 9 screenshots into
  tests/screenshots/M1.13c/ (4 light + 4 dark + 1 over-FAR
  validation state).
- (this commit) 8/8 (docs sweep): CLAUDE.md M1.13c series block,
  scripts table entry, Playwright spec entry, Module 1 status
  header extended with the M1.13c completion line.

**M1.13d Build Program 3-box equation-row layout (3 commits,
2026-05-06, all snapshot diffs bit-identical):**
- `c4dbc01` 1/3 (primitive): src/hubs/modeling/platforms/refm/components/
  ui/EquationRow.tsx. New shared primitive renders one calculation
  step as a horizontal row, [field] op [field] = [result chip].
  Two field kinds: 'input' (editable yellow box, FAST navy-pale bg
  + navy text, carries canonical input element id) and 'derived'
  (read-only dashed box, grey-pale bg + meta text, used when a
  value is computed upstream and feeds the current row). Result
  chip carries data-result-chip + data-formula + data-state for
  Playwright targeting; validation tints the chip and surfaces an
  issue callout below the row when state is 'warn' or 'error'.
  Operators between fields use Unicode math (× ÷ + -); equals is a
  literal "=". Up to 3 input fields per row supported (Typical GFA,
  parking allocator total).
- `5e53c2e` 2/3 (refactor): Module1AreaProgram PlotEditor renders
  the entire 14-step plot envelope chain (Max GFA, Footprint,
  Podium GFA, Public Area, Typical GFA, Total Built GFA, Floors
  check, Landscape, Hardscape, Surface Parking, 3 parking
  capacities, 2 basement outputs) and the 8-step asset cascade
  (GFA, MEP, BoH, Other Tech, Net GFA, BUA Excl, TBA, GSA/GLA) as
  EquationRow steps. The parking allocator total (Surface +
  Vertical + Basement = Total Allocated) also adopted; deficit
  flips to error state. Land parcel totals retained as
  VerifiedResult (data shape is sum-of-rows not equation chain).
  Cleanup: numField helper, sectionGridStyle helper,
  formulaStackStyle helper, and the now-unused VerifiedState
  type-only import all removed (each render block builds its own
  EquationField factories inline). testIds preserved end-to-end:
  every existing formula-* testId carries through to the chip,
  and new row-* testIds added for the row containers.
- `afe374b` 3/3 (verifier + Playwright + spec updates):
  scripts/verify-m113d.ts mirrors the standing 5-section template;
  section 4 has 9 markers across E1 (primitive shape), B1-B7
  (Build Program rows / cascade rows / allocator / formula testId
  preservation / legacy helper removal / validation state wiring),
  X1 (em-dash sweep). Result: 21 pass / 0 fail / 0 skip with dev
  server up. tests/e2e/m113d-equation-rows.spec.ts (1 spec, 4.9s)
  walks the Build Program tab and asserts: layout shape across all
  15 envelope rows, derived chain visible (Public Area row has 2
  derived + 0 inputs; Surface Parking has 3 derived + 0 inputs),
  3-input row works (Typical GFA has 1 derived + 2 inputs),
  validation flip (over-FAR push flips Total Built chip to error
  with issue chip; reset flips back to ok), live recompute (Plot
  Area edit updates Max GFA chip text in place). M1.13b spec
  updated to assert the new chip-numeric format ('1,000,000' for
  200,000 × 5) and the proximity helper relaxed to accept both
  horizontal adjacency (chip side-by-side with input in the same
  EquationRow) and vertical adjacency (chip below input within
  200 px). M1.13c spec same proximity update; × ÷ operator
  assertions moved from chip text to row container text;
  validation flip uses chip testId for data-state and row testId
  for issue chip child. All 3 specs pass in parallel (17.6s total).

**M1.13d pattern decisions for downstream phases:**
- EquationRow is the canonical layout for "input drives a derived
  value" UX whenever the calculation reads naturally as a math
  equation (≤ 3 input fields). VerifiedResult remains correct for
  contexts where the data shape is sum-of-rows, free-form
  derivation, or single-line summary that does not split cleanly
  into N input fields × 1 result.
- Derived field rendering is the missing M1.13c piece. By making
  upstream-computed values visible as read-only dashed boxes IN
  THE ROW that consumes them, the user reads the calc chain
  visually instead of having to remember "which value did this
  come from". Footprint feeding Podium GFA + Public Area is the
  prototypical case; same applies to MEP / BoH / Other feeding
  Net GFA in the cascade.
- Section headers stay as subtle uppercase dividers (small font,
  thin top border, var(--color-heading) + meta letter-spacing),
  not boxed cards. They group related rows but never compete
  with the rows for attention.
- testIds split into two layers: row-{name}-{plotId} on the
  EquationRow container (use for: targeting the issue chip
  child, assertions about the whole row) and formula-{name}-
  {plotId} on the chip (use for: data-state checks, text content
  of the resolved value). The split lets specs check both row-
  level and chip-level contracts cleanly.
- Validation issue callouts render as siblings of the row content,
  not children of the chip. This keeps the chip a single text
  node (easier to toContainText against) while the issue text
  reads as a sentence below the row when applicable.

**M1.13c pattern decisions for downstream phases:**
- VerifiedResult is the canonical primitive for "input drives a
  derived value" UX in Module 2+ (revenue, opex, returns). The
  formula + substitution + result-chip triple becomes the unit of
  verification, so users can sanity-check every derivation in
  place rather than reading a separate output panel. FormulaCaption
  is retained for narrow contexts where only the formula text is
  needed (no result chip), but VerifiedResult is preferred whenever
  there is a discrete result with units.
- Validation states should fail loud at the result, not silent at
  the input. A user who types Max FAR=1 with Typical Floors=20 has
  not made an input error per se; the cascade has run past the FAR
  ceiling. Marking the chip 'error' with an issue callout names
  the consequence rather than the keystroke. Validation derivations
  live next to where they are surfaced so the developer can audit
  the rule with the chip's substitution chain.
- Math operators in display text use Unicode (× ÷ ± ≤ ≥) for
  readability; internal data attributes and testIds stay ASCII so
  Playwright selectors work without dealing with Unicode escapes.
  Operator swap is a display-text-only concern, no impact on
  calc engine or persistence.
- Roll-up summary cards (Financing Debt Summary, ParkingSummary)
  remain valuable for resolved-totals views even when every
  derivation is visible inline above. The card label stays
  understated and contains no inline formulas.
- Live recompute by inline-text substitution remains the contract
  M1.13c+ exercises. Captions become permanent rendered nodes;
  only their inline numbers change on input edit.

**M1.13b pattern decisions for downstream phases:**
- Eliminate calc-output panels in favour of input-anchored formula
  stacks. Panels that summarise derivations (Computed Envelope,
  Cascade Preview, Timeline Summary) tend to feel disconnected from
  the inputs that drive them, especially for first-time users. Inline
  captions, anchored to the last input that completes each formula,
  read top-to-bottom with the user's mental model.
- Section headers are subtle by default (small uppercase + thin top
  border + `var(--color-heading)`), not boxed cards. They divide the
  flow without competing with the input/formula pairs for attention.
- Roll-up summary cards are still useful for resolved-totals views
  (Financing Debt Summary, ParkingSummary). They should NOT duplicate
  formula text already shown inline above. The card label stays
  understated ("Debt Summary", not "Debt Summary (live formulas)").
- Proximity contract: formula caption sits within 200 vertical pixels
  of its driving input's bottom edge, anchored after the LAST input
  that completes the formula. Playwright's assertProximate helper
  computes bounding-box distance to enforce this.

**M1.13 pattern decisions for downstream phases:**
- FormulaCaption is the canonical way to surface input -> output
  relationships in Module 2+ (revenue, opex, returns). Caller-formats-
  text gives flexibility for different operators (* / + -) and units
  without expanding the primitive's API surface.
- Live recompute via inline-text substitution avoids layout reflow.
  Captions become permanent rendered nodes; only their inline numbers
  change on input edit. This is the contract Playwright tests in
  m113-formulas.spec.ts exercise.
- Plain-English formula text is preferred over LaTeX or pure math
  notation. M1.13 captions read like a sentence with operators
  spelled out (e.g., "Plot Area * Max FAR" not "PA x FAR" or
  "PA \\times FAR"). Operators stick to ASCII (* not x or X).

**M1.12 deferred to M2.0 (calc engine territory, out of scope per
phase brief):**
- ProjectFAR / Roads % / Non-Enclosed % auto-derive: today the calc
  engine reads stored project-level scalars from the snapshot. Plot
  cards are the only UI surface that edit per-plot maxFAR + landscape
  / hardscape coverage. M2.0 should derive the project-level scalars
  via weighted average so the snapshot can drop the redundant fields
  entirely.
- Migration sweep on existing user projects: snapshots written before
  M1.12 still carry the project-level scalars and load fine because
  the schema is preserved. M2.0 derive will need a one-time recompute
  + persist pass on live data so historical projects converge with
  newly created ones.

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

---

# Module 1 (REFM) M2.0 Phase History (M2.0 → M2.0i, archived 2026-05-11)

> Detailed closure blocks for the v5 → v6 → v7 → v8 schema rebuild and the M2.0b → M2.0i polish series. M2.0j is the current live state and remains documented inline in CLAUDE.md. The per-phase "pattern decisions" sections have been consolidated into "Module 1 Conventions" in CLAUDE.md, see there first; the entries below are the original commit-by-commit narrative kept for cold-session reference.

### M2.0L 4-fix follow-up (2026-05-11)

Four fixes layered on M2.0L. Detail lives in CLAUDE.md "Module 1 status (2026-05-11, M2.0L + 4-fix follow-up)" and CLAUDE-TODO.md. Commits: `60128b1` graceful legacy migration via `isLooseSnapshot()` + `migrateLegacyToV8()` + `LEGACY_MIGRATION_NOTICE` banner, `db7e578` Cost Input Mode (Same / Individual) chooser modal + persistent toggle + `SameModeCostTable` + `editsGoToLine` prop on `CostRow`, `62b843a` sub-unit metric UX cleanup (Area mode hides Unit Size + Count; Units mode hides Area input, shows derived caption), `47d6f08` cost multiplier asset-area fallback (`resolveAssetAreaMetrics` falls back to `asset.buaSqm`/`asset.sellableBuaSqm` when sub-units empty) + `costLineCaption` "no `<X>` defined yet" warning chip on missing area / count. Schema stays v8 additive (`Project.costInputMode?` optional). Type-check clean every commit.

### Module 1 status (2026-05-07, M2.0i Module 1 final polish, foundation for M2.0j)

**M2.0i:** Final Module 1 polish closing the 10 issues
Ahmad raised after M2.0h. Module 1 reads cleanly to a first-time
financial modeler: all inputs annual, all outputs flexible-granularity
with proper distribution, all formatting correct, operational phases
handled properly. Schema stays at v8 (additive Project.displayDecimals,
Phase.status / historicalBaseline, Asset.historicalBaseline; rename
SubUnitMetric 'count' -> 'units' is type-only, runtime accepts both).
8 commits:

- **/1 (Fix 1, drop Model Granularity input)**: Tab 1 Project Identity
  card removes the Model Granularity dropdown. Tab 3 + Tab 4 captions
  drop the "Granularity: monthly/annual" subline (replaced with
  "inputs entered annually"). Wizard already shipped Reporting
  Granularity (output) in M2.0g; no input-side change needed there.
  modelType stays on schema for legacy compat but is no longer
  user-facing.
- **/2 (Fix 3, Display Settings panel)**: New `DisplayDecimals` enum
  (0/1/2/3) on Project. Tab 1 grows a Display Settings card above
  Project Identity with Scale (Full/Thousands/Millions) + Decimals
  radios. `formatScaled(num, scale, decimals)` already accepted
  `decimals`; M2.0i threads it through every render path. New
  helper `makeProjectFormatter(prefs)` returns a one-arg formatter
  pulling both. Threaded through CostRow, AssetCostSection,
  SummaryTables, TrancheCard, Module1Assets fmtCurrency, Dashboard
  fmtMoney, OverviewScreen fmtMoney. Header line at top of every
  tab + dashboard + overview reflects the chosen scale/decimals
  immediately.
- **/3 (Fix 5, drop Parking Bays)**: Asset card areas row collapses
  from 4 to 3 columns (Support / Parking / GFA Override).
  `Asset.parkingBaysRequired` stays on schema for legacy compat.
  CostMethod dropdown filters out `'rate_per_parking_bay'` so new
  lines cannot select it; existing snapshots still compute. Per
  the spec: parking-bay-driven revenue (e.g. fee per bay/year)
  models as a Leasable sub-unit going forward.
- **/4 (Fix 7 + Fix 8)**:
    - Fix 7 (strategy short labels): `STRATEGY_LABELS` shrinks
      from full sentences to single-word labels ('Sell' / 'Operate'
      / 'Lease' / 'Sell + Manage'). New `STRATEGY_TOOLTIPS` map
      provides the longform explanation as a hover title attribute
      on each `<option>` and on the `<select>` itself.
    - Fix 8 (sticky sidebar): RealEstatePlatform outer wrapper
      switches from `minHeight: 100vh` to `height: 100vh; overflow:
      hidden`. Combined with the existing `.app-shell { overflow:
      hidden }` and `<main overflow: auto>`, only the workspace
      content scrolls; sidebar stays visible during long Tab 3
      summary tables.
- **/5 (Fix 6, sub-unit metric area/units)**: Type rename
  `SubUnitMetric` from `'count' | 'area'` to `'units' | 'area'`.
  Calc engine (`computeSubUnitArea`, `computeAssetUnitCount`)
  treats legacy `'count'` as `'units'` on read so v8 snapshots
  written before M2.0i continue to compute. Module1Assets
  `SubUnitRow` rewrites: dropdown labels are now "Units" and
  "Area"; new `switchMetric` helper preserves the underlying
  area sqm when toggling (478 units × 100 sqm/unit = 47,800 sqm
  switches to area=47,800 sqm; switching back gives count=478).
  When metric=Area, count derives = area / unitSize and renders
  read-only (with '-' fallback when unitSize is 0). Unit Size
  input is always editable (so derivation works in both modes).
  Wizard / Tab 2 default sub-unit creation switches from
  `metric: 'count'` to `metric: 'units'`.
- **/6 (Fix 9, compact reconciliation)**: New `LandReconciliation-
  Block` and `AssetAreaReconciliationBlock` components in
  Module1Assets. Collapsed default state: single summary line
  with status icon (✓/✗/⚠) + headline. Click to expand reveals
  the full itemized grid (M2.0h shape, unchanged content). Auto-
  expands on mismatch. localStorage persistence: keys
  'm20i-land-recon-collapsed' and 'm20i-asset-recon-collapsed'
  carry the user's preference across sessions.
- **/7 (Fix 10, operational phase historical baseline)**: New
  `PhaseStatus` type (`planning / construction / operational`)
  and `PhaseHistoricalBaseline` interface (sunk capex, equity,
  debt drawn, current outstanding, cumulative depreciation, NBV
  fixed assets, last-12-months revenue + opex, optional
  occupancy / ADR / rent rate). Both `Phase` and `Asset` gain
  optional `historicalBaseline` field. Tab 1 phases table grows
  a Status column; selecting Operational reveals a 9-column
  Historical Baseline form spanning the row. Calc engine adds
  `computePhaseHistorical(phase)` returning opening balances and
  `computeOperationalRunRate(baseline, period, revGrowth%,
  opexGrowth%)` rolling forward the trailing-12-month revenue +
  opex with compound growth (defaults 3% / 2%). M5 Statements
  will consume both.
- **/8 (verifier + Playwright)**: `scripts/verify-m20i.ts`
  (59 pass / 0 fail / 2 skip without authenticated dev server).
  `tests/e2e/m20i-final-polish.spec.ts` (7 specs + dark-mode).

### Module 1 status (2026-05-07, M2.0h area hierarchy + cost granularity + display cleanup + migration banner, foundation for M2.0i)

**M2.0h:** Closes the 6 structural / display issues
Ahmad raised after eyeballing M2.0g: existing v7 projects need a
migration trigger + banner; currency suffix on every cell is noisy;
area model needs proper NSA / BUA / GFA hierarchy; NDA optional toggle
at parcel level for jurisdictions reserving roads / parks; construction
cost rate needs flexibility to per-sub-unit; runtime view granularity
toggle on Tab 3 Results was deferred from M2.0g and ships now. Schema
stays at v8 (additive Parcel.hasNdaDeduction / roadsPct / parksPct,
CostMethod.per_sub_unit_custom_rates, CostLine.perSubUnitRates fields
do not bump the version). 8 commits:

- **/1 (schema + calc engine)**: Parcel gains `hasNdaDeduction?:
  boolean`, `roadsPct?: number`, `parksPct?: number` (all optional,
  default OFF). CostMethod adds `'per_sub_unit_custom_rates'` (17
  methods total). CostLine + CostOverride gain `perSubUnitRates?:
  Record<string, number>` keyed on sub-unit id with reserved keys
  `'__support__'` / `'__parking__'`. Five new pure helpers in
  @core/calculations: `computeAssetAreaHierarchy(asset, subUnits)`
  returns { nsa, bua, gfa, breakdown } where NSA = sum of revenue
  sub-units, BUA = NSA + Support, GFA = BUA + Parking;
  `computeParcelNda(parcel)` returns { area, roadsArea, parksArea,
  nda, totalCost, effectiveNdaRate }; `computeCostLinePerSubUnit`;
  `distributeAnnualToPeriods(annual[], granularity, phasing)`;
  `formatPeriodLabel(iso, granularity)` returns 'Dec 25' / 'Q1 25'
  / 'Mar 25'. `resolveAssetAreaMetrics` rewires `bua` / `gfa` /
  `nsa` outputs to consume the new hierarchy.
- **/2 (Tab 2 area hierarchy UI)**: Module1Assets asset card areas
  row drops the M2.0g "Asset BUA Total" hand-typed input (BUA
  derives now). New shape: 4 inputs (Support / Parking / Parking
  Bays / GFA override) followed by 3 chips (NSA / BUA / GFA).
  Asset card Reconciliation block rewritten to itemize sub-units
  leading into NSA, then sub-unit Support + asset Support into BUA,
  then asset Parking into GFA. Project-wide Globals card grows 5
  -> 3+5 columns.
- **/3 (Tab 2 parcel NDA)**: Land Parcels block expands from 6 to
  11 columns adding NDA? toggle + Roads% + Parks% + NDA +
  Effective NDA Rate. Land Reconciliation conditionally adds a
  "Total NDA" line.
- **/4 (Tab 3 per-sub-unit + granularity)**: Module1Costs cost
  row method dropdown gains "Per sub-unit custom rates". Tab 3
  Results sub-tab grows runtime granularity toggle (Annual /
  Quarterly / Monthly).
- **/5 (currency display cleanup)**: New `currencyHeaderLine`
  helper. In-cell currency suffixes removed across Module1Assets /
  Module1Costs / Module1Financing.
- **/6 (v7 -> v8 migration banner)**: module1-migrate.ts gains
  `M20H_MIGRATION_NOTICE`. RealEstatePlatform shows a dismissable
  success banner once per project open. attachToProject kicks an
  immediate save when migration ran (so banner won't reappear).
- **/7 (verifier)**: scripts/verify-m20h.ts (62 pass / 0 fail / 2
  skip).
- **/8 (Playwright)**: tests/e2e/m20h-area-hierarchy-cost-
  granularity.spec.ts (6 specs).

### Module 1 status (2026-05-06, M2.0g display + reconciliation + Costs restructure, foundation for M2.0h)

**M2.0g:** Closes the 7 display + reconciliation +
Cost-tab issues Ahmad eyeballed in M2.0f, plus 3 addendum items
(Manual % phasing UI restoration, period labels, structural shift
to annual-only inputs + multi-granularity outputs). Schema bumps
to v8 (modelType becomes outputGranularity; v7 monthly snapshots
migrate by aggregating periods 12 -> 1). 11 commits:

- **/1 (Fix 3, Display Scale)**: Project gains optional
  `displayScale: 'full' | 'thousands' | 'millions'`. New
  `formatScaled` / `formatScaledCurrency` helpers in
  `core/formatters` use accounting format throughout. Wizard Step
  1 grows a Display Scale radio.
- **/2 (Fix 6, drop Direct/Indirect labels)**: per-asset cost
  segregation makes every cost direct by definition. CostRow
  drops the deriveCostScope import + scope display.
- **/3 (Fix 1, period end-of-period dates)**: New `periodEndDate`
  helper returns the LAST DAY of a period span. computePhase-
  Timeline uses periodEndDate for constructionEnd / operationsEnd.
- **/4 (Fix 4 + 5, asset Support/Parking + BUA reconciliation)**:
  Asset gains 3 optional fields: `buaTotal`, `supportArea`,
  `parkingArea`. Tab 2 asset card areas row replaces M2.0f
  5-column derived display with 6-column input row. BUA
  Reconciliation block shows itemized breakdown. SubUnitCategory
  drops 'Parking' (M2.0f-only); migrateM20gParkingSubUnits folds
  legacy Parking sub-unit areas into asset.parkingArea.
  CostMethod gains 3 new options: rate_x_support_area,
  rate_x_parking_area, rate_x_specific_subunit.
- **/5 (Fix 2, land allocation parcel default + reconciliation)**:
  Asset card Parcel dropdown defaults to FIRST phase parcel. Two
  sentinels: '(Weighted Average across parcels)' and '(Custom
  Rate)'. PARCEL_WEIGHTED_AVG and PARCEL_CUSTOM_RATE sentinels.
  computeLandReconciliation returns parcelsTotalSqm /
  parcelsTotalValue vs assetsAllocatedSqm / assetsAllocatedValue.
- **/6 (Addendum 3, v8 schema bump)**: Schema bumps to v8.
  Project gains `outputGranularity: 'annual' | 'quarterly' |
  'monthly'`. Inputs always entered ANNUALLY; output granularity
  drives reporting. Migration v7 -> v8 aggregates monthly to
  annual. SCHEMA_VERSION = 8.
- **/7 (Addendum 2, period labels Y0/Dec 25)**: getPeriodLabel
  rewrites: idx=0 -> 'Y0', annual -> 'Dec YY', monthly -> 'Mar
  25'.
- **/8 (Addendum 1, Manual % phasing restore)**: CostRow renders
  expanded sub-row when effective phasing === 'manual'. Auto-
  normalize button scales values to sum 100.
- **/9 (Fix 7, Costs sub-tabs + 4 summary tables)**: Module1Costs
  grows internal sub-tab toggle: Inputs / Results. 4 summary
  tables: Capex by Period, Capex by Stage (transposed), Capex
  Summary by Treatment, Capex by Cost Type per Asset. Header
  pattern: every summary table uses [Description] [Total]
  [Period/Stage/Type cols...].
- **/10 (verifier + Playwright)**: scripts/verify-m20g.ts (68
  pass / 0 fail / 2 skip) + tests/e2e/m20g-display-recon-
  costs.spec.ts (5 specs). Snapshot baseline 47.8 KB sha
  22923b5275a7 (v8).
- **/11 (docs sweep)**.

### Module 1 status (M2.0f, 2026-05-06, foundation for M2.0g)

**M2.0f:** Closes the 6 structural issues Ahmad
flagged after eyeballing M2.0d + M2.0e together (header clipping,
multi-parcel rates, project-type catalog, phase startDate
persistence, project end off-by-one, sub-unit BUA double-entry).
Additive schema (no SCHEMA_VERSION bump, v7 stays). 5 commits +
docs sweep:

- **/1 (Fix 1, layout)**: globals.css `.pm-toolbar` switches from
  `position: fixed` to `position: sticky; top: 0`. Drops
  `.module-view`'s redundant `padding: 0 sp-3 sp-3`.
- **/2 (Fix 3, project type catalog)**: `PROJECT_TYPES` expanded
  from 6 to 14 entries (Industrial, Data Center, Education,
  Healthcare, Marina, Hospitality + Branded Residences, Senior
  Living, Self-Storage added).
- **/3 (Fix 4 + 5, Phase Start Date + endYear)**: Tab 1 grows
  Phase Start Date column + three read-only computed columns
  (Construction End / Operations Start / Operations End) via
  `computePhaseTimeline`. `ProjectTimeline.endYear` (no +1 offset)
  + `totalPeriods`.
- **/4 (Fix 2 + 6, multi-parcel + sub-unit BUA)**: Asset gains
  `landAllocation: { parcelId?, sqm?, pct?, multiParcelSplits? }`
  and SubUnitCategory `'Parking'`. computeAssetLandBreakdown +
  validateLandAllocation. computeAssetBua / computeAssetSellable-
  Bua treat sub-units as source of truth.
- **/5 (verifier + Playwright)**: scripts/verify-m20f.ts (62 pass
  / 0 fail / 2 skip) + tests/e2e/m20f-structural-fixes.spec.ts
  (4 specs).
- **/6 (docs sweep)**.

### Module 1 status (M2.0e, 2026-05-06, foundation for M2.0f)

**M2.0e:** Wizard simplification + Tab 2 becomes the
canonical asset entry surface. Closes the 6 testing-feedback items
Ahmad raised after M2.0d (wizard column units, Phase Start Date,
Step 3 too detailed, Tab 2 needs phase grouping + sub-unit table +
project-type-aware Type catalog). Additive schema (no SCHEMA_VERSION
bump, v7 stays); 8 commits:

- **/1 (schema additions)**: Three optional fields on the v7
  schema: Phase.startDate?: string (ISO), Asset.status?: 'planned'
  | 'construction' | 'operational', Project.projectType?:
  'Residential' | 'Hospitality' | 'Retail' | 'Office' |
  'Mixed-Use' | 'Custom'. Catalogs: ASSET_TYPES_BY_PROJECT_TYPE +
  SUGGESTED_CATEGORIES_BY_PROJECT_TYPE. Two new pure calc helpers:
  computePhaseTimeline + computeProjectTimeline.
- **/2 (Wizard Step 2)**: WizardDraftPhase.startDate required.
  Step 2 column headers gain unit suffix tracking modelType.
  addPhase auto-defaults next phase startDate.
- **/3 (Wizard Step 3 simplified)**: WizardDraft.assets[] removed.
  WizardDraft.projectType added (single pick). Step 3 collapses
  to 6-radio project-type pick + "Tab 2 will suggest" preview.
- **/4 (Tab 2 rewrite)**: Module1Assets full rewrite. Per-phase
  asset sections replace flat "Assets" list. AssetCard rebuilt
  with header row + ManagementAgreementForm (Sell + Manage) /
  UsefulLifeForm (Operate / Lease) conditional sub-forms. Status
  badge color: planned = grey, construction = warm amber,
  operational = green-success.
- **/5 (snapshot baseline regen)**: 47.8 KB sha 824ef8e1706d.
- **/6 (verifier)**: scripts/verify-m20e.ts (58 pass / 0 fail /
  2 skip).
- **/7 (Playwright)**: tests/e2e/m20e-wizard-tab2.spec.ts (6
  specs).
- **/8 (docs sweep)**.

### Module 1 status (M2.0d, 2026-05-06, foundation for M2.0e)

**M2.0d:** Closes the 8 testing-feedback items
Ahmad raised on M2.0c. Schema bumps to v7 (pre-v7 hard-cut
continues the precedent v5 -> v6 set). 9 commits:

- **/1 (layout)**: globals.css `.main-content` drops `margin-
  left:240px` + `transition` + `height: calc(100vh - 40px)`.
- **/2 (schema v7)**: AssetStrategy 'Hybrid' renamed 'Sell +
  Manage' (the reference Sell+Manage example pattern). Asset gains optional
  managementAgreement + usefulLifeYears. CostMethod gains
  'rate_per_parking_bay'. CostLine gains optional targetAssetId
  + disabled. CostOverride gains disabled. makeDefaultCostLines
  replaces v6 12-line catalog with M2.0d 9-line standard.
  STANDARD_COST_LINE_IDS exported. SCHEMA_VERSION = 7.
- **/3 (calc engine)**: Five new pure helpers: deriveCostStage,
  deriveCostScope, resolveUsefulLifeYears, classifyAssetCapex
  (returns { COGS, FixedAssets, Depreciation } per strategy),
  computeCashFlowImpact (excludes equity-in-kind portion).
- **/4 (Tab 2 Sell+Manage UI)**: STRATEGY_LABELS long-form
  labels. Conditional ManagementAgreementForm / UsefulLifeForm
  sub-forms.
- **/5 (Costs tab rewrite)**: Module1Costs end-to-end rewrite.
  Per-phase header -> per-asset collapsible AssetCostSection ->
  9-row cost table per asset -> "+ Add Custom Cost" button ->
  3 capex summary tables. Stage / Scope dropdowns REMOVED from
  row UI. Custom Cost Popup. Override write rules: editing in
  asset section creates costOverride keyed by (assetId, lineId).
- **/6 (Tab 4 equity in-kind)**: Module1Financing tile bar
  grew 4 -> 5 tiles: Phase CapEx, Total Debt, Cash Equity,
  In-Kind Equity, Total Interest.
- **/7 (snapshot baseline regen)**: 47.6 KB sha 7418013202fc.
- **/8 (verifier)**: scripts/verify-m20d.ts (71 pass / 0 fail
  / 2 skip).
- **/9 (Playwright)**: tests/e2e/m20d-costs-polish.spec.ts (7
  specs). M2.0c spec .skip()'d (frozen artifact).

### Module 1 status (M2.0c, 2026-05-06, restores Dev Costs + Financing on v6)

**M2.0c (foundation for M2.0d):** Dev Costs + Financing functionality
fully restored to pre-M2.0 capability with all data binding adapted
to v5/v6 schema. Schema bumps from v5 to v6 to absorb the open-ended
cost-line catalog and 5×5 financing matrix. 4 commits:

- **/1 (sidebar layout)**: globals.css `.sidebar` drops
  `position: fixed; top: 40px; left: 0`. New rules: `.app-shell
  { display: flex; flex: 1; min-height: 0; overflow: hidden; }`,
  `.sidebar { position: relative; height: 100%; flex-shrink: 0;
  }`.
- **/2 (v6 schema + calc + UI)**: CostMethod expands from 6 closed
  enums to 13 open methods. CostLine becomes open-ended (id
  string, stage, scope, allocationBasis, startPeriod, endPeriod,
  phasing, distribution, selectedLineIds, isLocked,
  requiresCountry). DrawdownMethod expands to 5; RepaymentMethod
  expands to 5; FinancingTranche grows optional assetId. Project
  grows country + projectRoadsPct. 12-default cost catalog seeds.
  Calc engine rewrite: resolveAssetAreaMetrics, calculateItem-
  Total dispatching across 13 methods, distribute returning 6
  phasing curves, resolveAllocationFactor, computeAssetCost (3
  passes), computePhaseCost, computeFinancing handling 5 drawdown
  × 5 repayment with IDC capitalization. Module1Costs +
  Module1Financing UI rewrites.
- **/3 (snapshot baseline regen)**: 30.8 KB -> 49.6 KB sha
  15ed6f865342.
- **/4 (verifier + Playwright + docs)**: scripts/verify-m20c.ts
  (54 pass / 0 fail / 2 skip). tests/e2e/m20c-costs-
  financing.spec.ts (5 specs).

**Pre-v6 snapshots:** isPreV6Snapshot detects v5 by costLine.key
field and flags with hard-cut "Schema migrated to v6. Please
recreate this project." Backward-compat aliases isV5Snapshot /
isPreV5Snapshot resolve to v6 implementations.

### Module 1 status (M2.0b, 2026-05-06, brand-styled shell on v5)

**M2.0b (foundation for M2.0c):** the v5 hard-cut M2.0 rebuild
stripped the FMP brand identity (navy gradient topbar, gold logo,
FAST sidebar, KPI dashboard, branded modals, dark-mode toggle) and
replaced it with slim placeholder components. M2.0b restores all
of that against the v5 schema across 5 commits:

- **/1 (Topbar + Sidebar)**: Topbar (~360 lines) brings back
  pm-toolbar layout. Sidebar (~210 lines) brings back sb-pv-
  panel + module list + PlanBadge + Module 1 sub-tab list.
- **/2 (Dashboard + ProjectsScreen + OverviewScreen)**: Dashboard
  (~340 lines) with kpi-card grid. ProjectsScreen (~280 lines)
  with pm-project-card grid. OverviewScreen (~310 lines) with
  4-tab quick-link cards + Phase Summary + Version History.
- **/3 (modals)**: ProjectModal / VersionModal / RbacModal /
  ExportModal brand-chromed.
- **/4 (RealEstatePlatform shell rewire)**: shell wires every new
  prop signature. darkMode toggles body[data-refm-theme="dark"].
- **/5 (verifier + Playwright + config)**: scripts/verify-m20b.ts
  (51 pass / 0 fail / 2 skip). tests/e2e/m20b-shell.spec.ts (4
  specs). New playwright.config.ts with baseURL=http://
  localhost:3000.

### Module 1 status (M2.0, 2026-05-06, v5 hard-cut foundation)

**M2.0:** Module 1 is rebuilt end-to-end against the reference model Residential
Cashflow v1.13. The v3/v4 hierarchy (Master Holding / Sub-Project /
Plot / Zone / FAR / Cascade / Parking Allocator / Build Program
tab / Land tab / Hierarchy tab) is gone. The new flat schema is:

```
{ version: 5, project, phases[], parcels[], landAllocationMode,
  assets[], subUnits[], costLines[], costOverrides[],
  financingTranches[], equityContributions[] }
```

**4 tabs:**
- 1. Project & Phases: project meta + Phase[] timing
- 2. Assets & Sub-units: Land Parcels block + landAllocationMode +
  Asset cards with strategy (Sell/Operate/Lease/Hybrid) + GFA/BUA/
  sellable BUA/parking + nested Sub-unit editor
- 3. Costs: 9 fixed cost lines per phase with method + value +
  phasing + per-asset overrides
- 4. Financing: per-phase tranches (5 drawdown × 3 repayment + IDC
  capitalization + cash sweep) + Equity contributions

**Hard-cut policy:** v3/v4 snapshots return error "Schema migrated
to v5. Please recreate this project." (module1-migrate.ts
isPreV5Snapshot detects + flags). Supabase migration
`m2_0_module1_rebuild.sql` bumps schema_version DEFAULT 4 -> 5 and
auto-archives pre-v5 projects.

**M2.0 deliverables:** v5 types/store/migrate, slim 869-line calc
engine, 4 new tab components, 3-step ProjectWizard rewrite, slim
shell components, single 30.8 KB v5 snapshot baseline, verify-
m20.ts (42 pass / 0 fail / 1 skip), m20-full-flow.spec.ts.

### M2.0 Pass 11 (2026-05-13, Tab 3 Costs + Results polish, 14 commits + 1 diagnostic)

Closes the cost-line + period-axis cleanup that started at the
top of Pass 10. Schema stays v8 additive.

- **Copy panel rewrite (Fix 1, 3, 5, 7).** Project-level "Copy
  cost configuration" panel above the phase filter. Source asset
  picker `<select>` grouped by phase + multi-select targets across
  every phase grouped by phase. Apply does a one-time deep clone:
  writes a FULL `CostOverride` on source AND every target with
  cloned `distribution[]` / `perSubUnitRates{}`, so subsequent
  master edits stop cascading. Cross-phase targets match lines by
  case-insensitive name (master cost line ids are phase-scoped).
- **Universal period range (Fix 2, 4, 13).** Engine offsets
  propagated everywhere: per-asset row, per-line nested row, footer,
  and the active-range scanner all apply
  `phaseStartYear - projectStartYear`. Results column axis is now
  the union of non-zero data across in-scope assets;
  `annualPeriodCount = max(totalConstructionPeriods, dataLastAnnual + 1, 1)`
  capped at 60. No more 24-year hard cap, no more truncation of
  operations-tail line endings.
- **One source of truth, per-line per-period (Fix 6).**
  `AssetCostBreakdown.perLinePerPeriod: Record<lineId, number[]>`
  filled by the same `distributeItemCost` call that feeds
  `perPeriod`. Module1Costs Table 1 per-line rows consume it
  directly; the prior "smear line total proportional to asset curve"
  approximation is gone (was destroying manual % + single-period
  line phasing for multi-line assets).
- **Universal editability (Fix 8, 12).** `isStartEndLocked` dropped
  to constant `false`; Start/End is editable on Land, Auto-IDC, and
  every other line on every phase. `effStartPeriod` / `effEndPeriod`
  constants in CostRow mirror `effMethod` / `effValue` / `effPhasing`,
  so the input value reads the override when one exists (fixes a
  read/write asymmetry where writes went to override but the input
  snapped back to master on rerender).
- **Universal area picking (Fix 10).** `resolveAssetAreaMetrics`
  switches `bua` / `nsa` / `gfa` to `Math.max(hierarchy, asset-level)`.
  Stub sub-units no longer drown out a real `asset.buaSqm`;
  identical rule across every phase + asset.
- **Results visual polish (Fix 9, 11, 14).** Combined view: each
  asset = header row (name only, full `colSpan`, navy 12% fill) ->
  per-line rows -> closing subtotal row ("Subtotal - {name}",
  full-row fill via per-`<td>` background, total + per-period
  values). Single Asset view drops the header + Project Total
  footer; the closing subtotal is the only summary row. Same
  pattern across Tables 1, 2, 3, 4 (renderSummary).

### M2.0 Pass 12 (2026-05-13, Universal formatting standards + Tab 4 Financing deep refactor, 15 commits)

Two parallel tracks: a platform-wide formatting / token standard,
and an 8-commit Tab 4 Financing refactor. Schema stays v8 additive.

- **Shared `_shared/tableStyles.ts` token suite.** New module-level
  file at
  `src/hubs/modeling/platforms/refm/components/modules/_shared/tableStyles.ts`
  owning every results-table style: `ROW_ASSET_HEADING` / `ROW_DATA`
  / `ROW_SUBTOTAL` (light navy 12% fill + top+bottom navy borders)
  / `ROW_GRAND_TOTAL` (navy fill + white bold + top+bottom border)
  / `CELL_HEADER` (navy fill, white uppercase, centered horizontally
  + vertically) / `TABLE_TITLE` (display block, fontSize 13,
  fontWeight 700, marginBottom var(--sp-1)). Base cell carries
  `verticalAlign: 'middle'` + `borderTop/Bottom: 'none'` to override
  the global `td { border-bottom: 1px solid var(--color-border) }`
  in `app/globals.css` line 319. Every Tab 1 / 2 / 3 / 4 results
  table now routes through these tokens.
- **Universal accounting + percent format on blur.**
  `AccountingNumberInput` rewritten (commit `88affc6`): stays on
  `type="text"` + `inputMode="decimal"` throughout, blur-formats via
  `formatAccounting` (commas, parens for negatives, "-" for zero,
  blank via `blankWhenZero`), focus reveals raw editable number.
  Avoids the v2-era bugs (readOnly look, type-swap focus loss). New
  `PercentageInput` mirrors the pattern with `formatPercent`
  (2 decimals, "%" suffix, parens for negatives, "0.00%" explicit
  for zero). `formatPercent` helper extended for parens-negative.
  Every raw `<input type="number">` for currency / area / period /
  count across REFM Module 1 + ProjectWizard migrated; every
  percent input migrated to `PercentageInput`. DSCR covenant left
  on `AccountingNumberInput` (it is a ratio, not a percent).
- **Tab 3 phase buttons + AssetCostSection default-collapsed.**
  Phase Filter `<select>` replaced with a row of pill buttons using
  the same `pillStyle(isActive)` treatment as the asset pills
  directly below (commit `b45869d`). Per-asset cost section in
  Tab 3 Inputs flipped from `useState(false)` to `useState(true)`
  (default-collapsed; matches Tab 2 convention).
- **Tab 4 Financing 8-commit deep refactor (commits `99a7a59` ->
  `e1e5279`):**
  - **Fix 1 - Asset Filter removed.** Dropdown deleted from header;
    `assetFilter` / `selectedAssetId` / `viewMode` / `phaseFilter`
    marked `@deprecated` on `ProjectFinancingConfig` (kept on schema
    for snapshot round-trip).
  - **Fix 2 - Method 2 per-line engine wire** (later removed in
    Pass 13). New `PerLineAssetCapex` + `PerAssetLineRatioOverride`
    exported types; `ComputeFundingContext` additive
    `perLineAssetCapex` + `perAssetRatioOverrides`; new
    `resolveMethod2Ratio` helper with precedence per-asset
    `CostOverride.debtPctOverride/equityPctOverride` ->
    `lineItemRatios.master[baseLineId]` -> `fixedRatio`.
  - **Fix 3 - Existing Operations.** Additive fields on
    `FinancingTranche`: `origin?: 'new' | 'existing'`,
    `openingBalance?`, `remainingTenorPeriods?`,
    `remainingRepaymentPeriods?`. `computeFinancing` branches at
    the top for existing facilities (skip drawdown switch, seed
    `balance = openingBalance`, replace tranche.repaymentPeriods
    with effRepaymentPeriods, force graceEndIdx = 0, force-expense
    IDC). TrancheCard new Facility Origination radio row reveals
    the existing-facility input panel.
  - **Fix 4 - YoY % per-period editor + engine.** New exported
    `normalizeYoYSchedule(raw, n)` helper. New `year_on_year_pct`
    branch in `computeFinancing` repayment switch. TrancheCard
    per-period `PercentageInput` grid + live green/amber sum chip.
  - **Fix 5 - Mixed IDC exposed.** Three IDC options render
    explicitly (no coalescing). Conditional `idcMixedSplitPeriod`
    input appears when `idcTreatment === 'mixed'`.
  - **Fix 6 - Deferred Payment land editor + helper.** New exported
    `expandDeferredSchedule(schedule, totalPeriods)` helper. Editor
    in Land Funding card with type selector + start/end + per-period
    Manual % grid OR even preview. Engine wire of
    `expandDeferredSchedule` into `computeAssetCost`'s land-cash
    distribution is deferred to a follow-up.
  - **Fix 7 - Capital Structure Inputs Sources collapsible +
    unified formula.** Sources table wrapped in `<details>` (default
    collapsed). Source data switched to `stack.equityBreakdown` +
    `stack.debtBreakdown` so it matches the Schedules Capital Stack
    Summary table line for line.
  - **Fix 8 - `land-inkind` method-based lookup.** Auto-detect
    filters by `method === 'percent_of_inkind_land'` + `!disabled`
    + matching `phaseId` (not hardcoded id). Corrects drift on
    `sourceCostLineId` of existing in-kind EquityContributions on
    the same write.
- **Universal `TABLE_TITLE` token (commit `88a55c0`).** Every
  above-table caption across Tabs 2 / 3 / 4 routes through the new
  `TABLE_TITLE` style constant for explicit `fontWeight: 700`.

### M2.0 Pass 13 (2026-05-13, Universal results-table layout + Tab 4 Financing restructure, 5 commits)

Three commits land the universal results-table layout standard +
three Tab 4 restructure fixes. Schema mostly stays v8 additive
EXCEPT for the Method 2 schema fields removed in Fix 1 (explicit
authorized exception per the brief).

- **Universal prior-period column (commit `1c89859`).** New shared
  helper `buildResultsPeriodAxis({ startIso, granularity,
  numAnnualPeriods, cropAnnualOffset? })` in
  `src/hubs/modeling/platforms/refm/components/modules/_shared/periodAxis.ts`
  prepends ONE prior calendar period (Dec YY at annual, Q4 YY at
  quarterly, Dec YY at monthly) before the first active column.
  Pure layout, zero engine change. Consumed by Tab 3 Results
  (Tables 1-4), Tab 4 Inputs Summary, Tab 4 Schedules. The
  drawdown-zero column filter on Tab 4 Inputs was dropped so the
  axis matches Tab 3 column-for-column; Tab 4 Schedules 24-year cap
  raised to 60 to match Tab 3 horizon; local `getPeriodLabel`
  helper deleted (now routed through `generatePeriodLabels` via the
  shared helper).
- **Universal column-width consistency.** `_shared/tableStyles.ts`
  gains `COLUMN_WIDTHS = { total: 110, period: 75, labelMin: 200 }`
  + `tableMinWidth(count)` helper + `whiteSpace:'nowrap'` on every
  numeric/header cell token. Every results table renders
  `<table style={{ width:'100%', tableLayout:'fixed',
   minWidth: tableMinWidth(axis.count) }}>` with a shared
  `<colgroup>` (flexible label + fixed Total + fixed period cols).
  When granularity flips (monthly adds columns), all stacked tables
  on the same page adjust uniformly top-to-bottom because they
  share the same colgroup pattern and minWidth. ScheduleTable's
  prop signature changes `columns: string[]` -> `labels: string[]`
  + `minWidth: number` and renders its prior cell internally.
- **Fix 1 - Method 2 (Line-Item Based Financing) removed entirely
  (commit `3e41344`).** Authorized exception to the additive-only
  rule. `FundingMethodId` narrows `1|2|3|4 -> 1|3|4`;
  `FUNDING_METHOD_IDS` / `FUNDING_METHOD_LABELS[2]` /
  `FUNDING_METHOD_DESCRIPTIONS[2]` / `FundingMethod2LineRatio` /
  `FundingMethod2Config` / `ProjectFinancingConfig.lineItemRatios?`
  / `DEFAULT_FUNDING_METHOD_2_CONFIG` /
  `CostOverride.debtPctOverride` /
  `CostOverride.equityPctOverride` / `PerLineAssetCapex` /
  `PerAssetLineRatioOverride` / `resolveMethod2Ratio` /
  `ComputeFundingContext.perLineAssetCapex` +
  `perAssetRatioOverrides` / Method-2 branch in `computeFunding`
  all deleted. UI: `renderMethodInputs id===2` branch +
  `inputs-summary-tables` Method 2 piping + all `funding-method-2`
  / `m2-*` data-testids gone. Tab 3 cost-override propagation drops
  `effDebtPct` / `effEquityPct` plus the `debtPctOverride` /
  `equityPctOverride` fields on `makeOverride`. New outermost
  migration `migrateM20pass13DropMethod2()` forces
  `fundingMethod===2 -> 1`, strips `lineItemRatios`, strips
  `debtPctOverride` / `equityPctOverride` from every CostOverride.
  Wired into both `stripV8Wrapper` + `stripWrapper`. Verifiers
  `scripts/verify-m20M.ts` + `scripts/verify-m20M-pass4.ts`:
  Section 5 inverted to assert Method 2 UI / schema / build paths
  are GONE.
- **Fix 2 - New Capex Breakdown table on top of Tab 4 Inputs
  (commit `3038e34`).** Three rows (Capex excluding Land /
  Land Cash Value / Total Capex Incl Cash Land = ROW_GRAND_TOTAL)
  driven by `inputsSummary.totals` + new
  `inputsSummary.landCashPerPeriod` slice (sum of
  `percent_of_cash_land` cost-line series). Row 3 reconciles to
  Tab 3 Table 2 (Total Capex Incl Land) minus Land In-Kind value.
  Granularity toggle at the top right of the block via new shared
  `_shared/GranularityRadioBar.tsx` component (also consumed by
  Tab 3 Costs Results; Tab 4 Schedules keeps its inline bar because
  the radios are bundled with facility-filter pills there).
  `inputsSummary` memo extended with `parcelCashPerPeriod`
  (per-parcel Land Cash split pro rata by
  `area * rate * cashPct / 100`).
- **Fix 3 - Two-rule Method 1 engine + Debt/Equity Required tables
  (commit `c944df8`).** `ComputeFundingContext` gains optional
  `landCashPerPeriod` + `parcelCashPerPeriod` arrays; when supplied,
  Method 1 splits capex: non-land routes via `fixedRatio`, Land
  Cash routes per-parcel via new `parcelDebtEquityFractions()`
  helper (`100pct_equity` / `100pct_debt` / `custom_split` /
  `in_kind` -> equity / `deferred_payment` -> equity for now,
  engine wire pending). Callers that omit the arrays get the
  pre-Pass-13 uniform fallback (numerically identical to old
  Method 1). `computeEquity.totalEquityNeed` reads from the actual
  `debtEquitySplit.equity` sum instead of `totalNeed * equityPct`
  so the two-rule routing flows through to In-Kind / Cash split.
  Old 3-table Inputs Summary collapsible (Funding / Debt / Equity)
  deleted along with its `inputsSummaryCollapsed` localStorage key
  `m20-financing-summary-collapsed`. New always-visible Total Debt
  Required (single ROW_GRAND_TOTAL row) + Total Equity Required
  (Equity Cash / Equity In-Kind / Total = ROW_GRAND_TOTAL) tables
  render after Capital Structure Sources, before the Debt
  Facilities list.

Commits: `1c89859` (universal prior column + COLUMN_WIDTHS,
Pass 12 closure) -> `3e41344` (Fix 1 Method 2 removal) ->
`3038e34` (Fix 2 Capex Breakdown) -> `c944df8` (Fix 3 Debt/Equity
Required + two-rule engine). Type-check + build clean on every
commit.

### M2.0 Pass 14 (2026-05-13, Universal Annual Basis + Column Width Balance, 3 commits)

- **Annual-only basis until M5 FS (commit `5701b19`).** Granularity
  toggle removed across Tab 3 Results, Tab 4 Inputs, ProjectWizard.
  Shared `_shared/GranularityRadioBar.tsx` deleted. Tab 3 Costs Results
  `transformAnnualSeries` reduced to identity (quarterly + monthly
  distribution branches deleted). M5 Financial Statements will
  reintroduce granularity scoped to FS output only. `project.outputGranularity`
  marked @deprecated.
- **Data-driven period axis (commit `db8596e`).** 60-year hard cap
  removed everywhere. `buildResultsPeriodAxis` no longer takes a
  `granularity` arg or applies a cap; caller picks `numAnnualPeriods`
  from project duration + active-data extent. Tab 3 Results computes
  `annualPeriodCount = max(totalConstructionPeriods, activeLastAnnual + 1, 1)`.
- **Column widths re-balance to 22% / equal-others (commit `18084dd`).**
  `COLUMN_WIDTHS = { label: '22%' }` + `nonLabelColumnPct(count)` helper.
  Every results table renders `<table style={{ width: '100%', tableLayout: 'fixed' }}>`
  with `<colgroup>` of label@22% + N × equal-pct cols.

### M2.0 Pass 15 (2026-05-13, Tab 4 Final Redesign Pass, 9 commits incl. 5b polish)

- **Period axis matches Tab 3 + 1 trailing year (commits `d732cb6`, `3a5b767`).**
  New `inputsAxis` memo derives first/last non-zero indices from
  `inputsSummary.totals` (with Y0 anchor when projectInKindLandValue > 0
  to match Tab 3's inclusive-extent start), then `numAnnualPeriods = last - first + 1 + 1`
  (the +1 trailing year). Capex Breakdown + Debt/Equity Required +
  Funding Requirement tables consume `inputsAxis.axis` and crop their
  row data via `inputsAxis.cropRow(...)`. Schedules untouched.
- **Tab 4 Inputs layout reordered (commit `c2c488d`).** Capex Breakdown
  moved from position 2 to position 7. New order: Project Financing
  Settings → Funding Method → Funding Basis → Land Funding → Capital
  Structure Overview → Debt Facilities → Capex Breakdown → Funding
  Requirement → Total Debt Required → Total Equity Required.
- **Input sections compressed (commit `441e189`).** Project Financing
  Settings tightened (single flex row). Funding Method changed to
  horizontal 3-card grid (repeat(3, 1fr)). Funding Basis dropped
  redundant Method field. Capital Structure Overview compressed from
  7 cards to 1 headline + 6 compact cards (later removed entirely in
  Pass 18).
- **LTV wording removed across Tab 4 (commits `b6a7a30`, `0faf40b`).**
  Tranche covenant → "Max Debt %"; Capital Structure card → "Debt %"
  (later removed). DRAWDOWN_METHOD_LABELS.capex_basis + types comments
  updated.
- **Funding Requirement table (commit `e4d15c5`).** New IIFE block.
  Calls `computeFunding` 3 times per render (one per method); 4 rows
  rendered: Method 1 / Method 2 / Method 3 / Selected (mirrors active
  method via ROW_GRAND_TOTAL styling).
- **Per-facility Grace Interest Treatment (commit `74143d5`).** New
  `FinancingTranche.graceInterestTreatment` field (additive). Migration
  `migrateM20pass15GraceTreatment` backfills 'capitalize' on legacy
  tranches; new tranches default to 'pay_from_ocf'. UI dropdown next
  to Grace Period. Engine wire: when method = 2 (Net Funding) and
  treatment = 'add_to_funding_need', accrued grace interest =
  `principal × rate × graceYears` added to capexPerPeriod.
- **Tab 1 per-asset pre-capex with debt/equity validation chip (commit `839e066`).**
  New `Asset.historicalPreCapex / historicalDebtAmount / historicalEquityAmount`
  fields (additive). Operational-phase reveal in Module1ProjectPhases adds
  "Per-asset Historical Baseline" sub-panel with 5-col grid per asset +
  validation chip (green Balances / amber Mismatch). New `historicalPriorTotals`
  memo on Tab 4 sums per-asset values; Capex Breakdown prior cell gets
  preCapex, Total Debt Required prior gets debt, Total Equity Required
  prior gets equity.

### M2.0 Passes 16-18 (2026-05-13, Tab 4 Verification Fixes, 9 commits)

- **Pass 16 — Land Funding Debt%/Equity% inputs (commit `996f1b1`).**
  Per-parcel dropdown (5 options) + custom-split + deferred editor
  collapsed to single auto-paired Debt%/Equity% pair. New
  `ParcelFundingConfig.debtPct/equityPct` (additive); fundingType +
  customDebtPct + customEquityPct + deferredSchedule marked @deprecated.
  Migration `migrateM20pass16LandFundingSimplify` maps legacy enums to
  direct fields. `parcelDebtEquityFractions` prefers new fields.
- **Pass 16 — Capital Structure Overview removed (commit `d7f07fe`).**
  Entire 7-card block + per-facility breakdown `<details>` deleted.
  Sources vs Uses match check inlined as small chip next to Total Capex
  on Funding Basis row.
- **Pass 17 — Funding methods renumbered to 1/2/3 (commit `9674bb1`).**
  `FundingMethodId: 1|3|4 → 1|2|3`. Migration `migrateM20pass17MethodRenumber`
  flips legacy `fundingMethod` values.
- **Pass 18 — Engine: Methods 2 and 3 affect non-land capex only
  (commit `dd52bd8`).** `computeFunding` land/non-land split applies to
  ALL three methods (was Method 1 only). Land cash always routed via
  parcel ratios uniformly across methods.
- **Pass 18 — Capital Stack Summary block dropped from Schedules
  (commit `2199cdd`).** Renumbered remaining 5 blocks (Debt Movement 1,
  Combined Debt Service 2, Finance Cost 3, IDC Summary 4, Equity
  Movement 5).
- **Pass 18 — Schedules drawdown wired from Funding Requirement
  (commit `d729c02`).** `computeFinancing` gains optional
  `precomputedDrawSchedule?: number[]` arg. `resultsMap` moved below
  `funding` memo; per-facility drawdown = `funding.debtEquitySplit.debt[offset+i] × facilitySharePct/100`
  (only allocation rule; no waterfall). Existing facilities skip the
  arg (drawWindow=0). `tranche.ltvPct` + `drawdownMethod` marked
  @deprecated.
- **Pass 18 — YoY% editor uses repayment periods (commit `e2594b8`).**
  Editor falls back to phase.constructionPeriods when repaymentPeriods
  is 0. makeDefaultFinancingTranche.repaymentPeriods lowered from 60 to 0.
- **Pass 18 — Percentage reconciliation audit (commit `e2a6cb4`).**
  Land Funding render normalises equity to 100 - debt; Pass 16 migration
  normalises legacy custom_split pairs to sum 100.
- **Pass 18 — Methods 2 + 3 blank until M2/M4 ship (commit `3e918ef`).**
  Funding Requirement table renders dashes for stubbed methods via
  `isMethodStubbed(m)` guard. Selected row also renders dashes when
  active method is 2 or 3. Engine still computes; only display blanked.
  Flip the guard to false when M2 Revenue + M4 FS engines wire.

### M2.0 Pass 19 (2026-05-13, Tab 4 Inputs Axis Off-By-One Fix, 1 commit)

- **`inputsAxis` aligned column-for-column with Tab 3 (commit `ae7eb5a`).**
  Pre-Pass-19 the memo walked `inputsSummary.totals[i]` for `i >= 0`
  and treated each totals-index as a column index, but `totals[0]` is
  the Y0 lump (= `phase.perPeriod[0]` for Phase 1) that Tab 3 drops
  (`Module1Costs.tsx:1652` walks `bd.perPeriod[i]` for `i >= 1` with
  `col = offset + i - 1`). The off-by-one pushed every data value one
  column to the right (1,031,493 at "Dec 27" instead of "Dec 26") and
  shifted the prior label to "Dec 24" instead of "Dec 25". Fix: walk
  `totals[1..]` mapping `col = i - 1`; `cropRow` offsets array reads
  by `+1`; in-kind lump placed at `inputsAxis.first + 1` instead of
  totals-index 0. Shared across Capex Breakdown / Funding Requirement
  / Total Debt Required / Total Equity Required tables.

### M2.0 Pass 20 (2026-05-13, Tab 4 Schedules Rebuild + Engine Cleanup + Equity Fix, 4 commits)

- **Schedules sub-tab rebuilt from scratch (commit `0322515`).** Old 6-block
  Schedules deleted. New layout: filter pill bar (Combined default +
  per-facility) followed by 5 tables in order: Debt Movement (per
  facility) → Combined Debt Service → Finance Cost (per facility) →
  IDC Summary → Equity Movement. New `schedulesAxis` memo with
  project-operation-end cap (`inputsSummary.totalPeriods - 1`),
  extended when any facility's data outruns that horizon. Off-by-one
  cropping helpers (`cropProject` for project-aligned arrays,
  `cropFacility(arr, phaseOffset)` for facility-local arrays) mirror
  Pass 19's pattern: skip Y0 lump, map facility-local i to project col
  `phaseOffset + i - 1`. Orphan "Capital Stack Movement" table removed.

- **`computeFinancing` legacy drawdown switch deleted (commit `b15f58b`).**
  The 80-line `switch (tranche.drawdownMethod)` block + dependencies
  (`ltvPct`, `tranche.principal`, `availabilityPeriods`,
  `drawdownDistribution`, `drawdownMinCashFloor`, `drawdownIncludeLand`,
  `drawdownCustomSchedule`) removed. Drawdown now derives exclusively
  from `precomputedDrawSchedule`. Schema fields stay `@deprecated` for
  snapshot back-compat. Existing facilities keep `drawSchedule = 0`
  and amortise from `openingBalance`.

- **Grace Interest Treatment reshuffled to 4 options (commit `c032f37`).**
  Enum changed from `'pay_from_ocf' | 'add_to_funding_need' |
  'capitalize'` to `'capitalize' | 'raise_via_funding' | 'raise_as_debt'
  | 'pay_from_ocf'`. New tranches default to `'capitalize'` (was
  `'pay_from_ocf'`). Both TrancheCard dropdowns updated. Migration
  `migrateM20pass20GraceRename` renames legacy `'add_to_funding_need'`
  → `'raise_via_funding'`. `m3GraceCapexAdd` memo renamed
  `graceFundingCapexAdd`; funding memo consumes the add regardless of
  active method (was Method-2-only gate). `'raise_as_debt'` +
  `'pay_from_ocf'` user-selectable but stub to capitalize behaviour
  pending new-debt synthesis + M2/M4 OCF wires.

- **Equity Cash is additive to In-Kind (commit `ce2f210`).** Two
  coordinated bug fixes for the Dec 26 zero-equity bug: (engine)
  `computeEquity` was `cashContribution = totalEquityNeed -
  inKindContribution` then rescaling per-period weights, which
  downscaled every period in the Equity Movement schedule by `(1 -
  inKind/totalCash)`. (UI) `Module1Financing.tsx:2061` had
  `cashEquityRow = equityAllRow.map((v, i) => max(0, v - inKindRow[i]))`,
  which clamped Dec 26's 106,846 cash equity to 0 when the 675,341
  in-kind lump landed at the same column. Both subtractions dropped.
  `funding.debtEquitySplit.equity` already represents pure cash equity
  per period; in-kind is a separate additive memo source. Funding
  identity: `total_debt + total_cash_equity = capex_excl_in-kind`.

### M2.0 Passes 37-48 (2026-05-14, Tab 4 polish + Module 1 audit + Dashboard redesign + admin DB-driven, 14 commits)

- **Pass 37 (commit `167e5eb`).** Finance Cost (Existing) KPI tile split
  off from Finance Cost (New). Existing tile renders only when at
  least one existing tranche has `openingBalance > 0` OR
  `financeCostExisting > 0` (otherwise the 5-tile grid stays compact).

- **Pass 38 (commit `d209a86`).** Tab 1 Historical Baseline trimmed to
  opening BS items only. Removed UI fields: `historicalCapexTotal`,
  `historicalEquityContributed`, `historicalDebtDrawn`,
  `last12MonthsRevenue`, `last12MonthsOpex`, `currentOccupancy`,
  `currentAdr`, `currentRentRate`. Engine `existing.ts` rewired to
  derive `preCapexTotal` + `equityTotal` from per-asset
  `Asset.historicalPreCapex` + `Asset.historicalEquityAmount`. Schema
  fields kept `@deprecated` for legacy snapshot parse.

- **Pass 41 + 41b (commits `1f555a4` + `5ddfd9d`).**
  `currentDebtOutstanding` removed from Tab 1 entirely; Tab 4 Existing
  Facility -> Opening Balance is the sole entry point. Tab 3 Costs
  tile bar dropped Operating from filter + tile bar; "Total Capex
  Excl. Land" tile (= Hard + Soft + Operating) added with navy left-
  bar. `isActiveExisting()` filter applied to every existing-only
  block on Schedules sub-tab (Debt Movement, Combined Debt Service "-
  Existing" rows, Finance Cost group header, IDC Summary in Pass 42).

- **Pass 42 (commit `7ff3e12`).** Module 1 audit fixes. 13
  `PercentageInput` / `AccountingNumberInput` calls on Tab 4 lacked
  `style` prop and rendered as raw browser default; added
  `style={inputStyle}` to all of them (Min Cash Reserve, Method 1
  ratios, Method 4 amounts, Existing Opening Balance, 5 rate-row
  fields with muted variant on the read-only Interest Rate, Facility
  Share %, Cash Sweep Ratio). Topbar amber dot switched from
  hardcoded `#fbbf24` to `var(--color-warning, #f59e0b)` + color-mix
  shadow for design-token consistency.

- **Pass 43 (commit `430fa33`).** `migrationsApplied: string[]` field
  added to `Module1Store` + `HydrateSnapshot`. Each migration helper
  appends a stable key (e.g. `MIGRATION_KEY_PASS7 =
  'm20costs-pass7'`) on output; `snapshotNeedsXxx` checks short-
  circuit when the marker is present. Banner fires once per project,
  not every reload. `buildWizardSnapshot` pre-marks Pass 7 applied on
  brand-new projects.

- **Pass 44 (commit `b207beb`).** Tab 4 "Existing Operations Summary"
  card added between Min Cash Reserve and Funding Method. New
  optional `existingRetainedEarnings: number` field on
  `PhaseHistoricalBaseline`. Section renders only when at least one
  operational phase exists.

- **Pass 45 (commit `2460b95`).** Dashboard fully redesigned. Hero
  strip (project name + status pill + meta line + Save/Edit
  buttons), 6 KPI tiles (Land / GFA / CapEx / Funding / Existing
  Ops / Duration), 4-card module deck with completion hints, Phase
  Summary table with inline share-of-capex bar + operational-phase
  tooltip exposing all 6 existing-ops fields, reconciliation chip
  strip (asset balances / funding ratio / equity / project-end),
  Version History panel.

- **Pass 46 (commit `8c63eef`).** Asset Classes section on REFM
  marketing page. `/api/admin/asset-types` GET opened to public
  (filters to `visible = true` by default; admin gets full list via
  `?includeHidden=1`). `/app/modeling/[slug]/page.tsx` fetches
  server-side when `slug === 'real-estate'`, renders an "Asset Class
  Coverage" section between Modules and CTA with auto-fit card grid.

- **Pass 47 + 47b (commits `b55fa50` + `e047892`).** Legacy Overview
  sidebar entry removed (Pass 45 Dashboard subsumed it);
  `activeModule === 'overview'` aliased to Dashboard so existing
  routes keep working. **Pass 47b fixed a Rules-of-Hooks violation in
  Dashboard.tsx** (two `useMemo` calls were below the no-project
  early return — crashed `/refm` on transition between empty + project
  states). Both `useMemo` blocks hoisted above the early return.

- **Pass 48 (commits `537c397` + `7441d85`).** Full move of
  Historical Baseline from Tab 1 to Tab 4. Tab 1 Historical Baseline
  block deleted (Cumulative Depreciation, NBV, per-asset
  Pre-Capex/Debt/Equity rows, validation chips, operational-phase
  reveal block, all related local state). Tab 4 1b. Existing
  Operations card extended: per-asset Pre-Capex / Existing Debt /
  Existing Equity now editable here as the sole entry point, project-
  wide totals tile bar moved below the per-asset rows with green/red
  Existing Debt facility cross-check. Plus dead code sweep (~593
  lines: `CostInputModeModal`, `ManagementAgreementForm`,
  `UsefulLifeForm`, `OverviewScreen.tsx` deleted, multiple unused
  imports).

**Migrations applied 2026-05-14:** `150_p_sync_platform_modules.sql`
(renumbered, slug seeds corrected to `real-estate`),
`151_p_extend_modules_marketing.sql` (7 marketing columns on
`modules` + `delete_platform_cascade(uuid)` function). Modeling
Dashboard now reads platforms from DB; admin Add/Remove platform
flows on `/admin/platform-modules`.

**Admin consolidation:** previously two Module Manager pages
(`/admin/modules` for platforms, `/admin/platform-modules` for
sub-modules); now `/admin/platform-modules` is the single Module
Manager (platform-level edit + sub-module CRUD + Asset Classes
section under the REFM tab). `/admin/modules` rebadged "Launch
Settings" (Coming Soon toggles + early-access whitelist only).

### M2.0 Passes 49-55 (2026-05-14 late session, Existing Facility form polish + Dashboard fix, 7 commits)

- **Pass 49 (`f7fd059`)**: docs sync after Pass 48 — CLAUDE.md root
  status line tightened, CLAUDE-FEATURES Pass 37-48 archive section
  added, CLAUDE-ROUTES OverviewScreen.tsx deletion noted, memory
  entries for project_m20_pass48_decisions + feedback_visual_not_tooltip.

- **Pass 50 (`5a02880`)**: collapsed the Pass 44/48 standalone "1b.
  Existing Operations" card at the top of Financing inputs INTO each
  Existing Facility's TrancheCard. Phase picker dropdown added to the
  facility row (was implicit). Inline dashed-amber panel renders
  beneath when the selected phase is `status === 'operational'`,
  containing per-phase opening BS (Cum Dep / NBV / Retained Earnings)
  + per-asset baseline rows (Pre-Capex / Existing Debt / Existing
  Equity + balances chip) + phase-level totals. Hint message when
  phase is not Operational. Eliminates the cross-tab confusion the
  Pass 48 standalone card created.

- **Pass 51 (`3649595`)**: Dashboard Existing Operations KPI tile -
  fixed accounting double-count. Headline was `preCapexTotal +
  debtOutstandingTotal + equityTotal`, which violates the funding
  identity `Pre-Capex = Debt + Equity` and inflates the figure to
  approximately 2x Pre-Capex. Headline now = Pre-Capex alone;
  sublabel reads "Pre-Capex (= X debt + Y equity)" so the breakdown
  stays visible.

- **Pass 52 (`6389be4`)**: click-to-sync "Facility Opening Bal"
  cross-check tile. Clicking the red mismatch tile copied the
  per-asset Existing Debt total into tranche.openingBalance.
  Superseded by Pass 54 (auto-sync removes the need for the click).

- **Pass 53 (`3ea0280`)**: relocated the Existing Operations panel
  BELOW the rate + repayment rows inside the facility card. New
  field order: facility identity row -> rate row -> repayment row ->
  per-phase BS + per-asset baseline panel. Matches the natural
  read order (identity -> terms -> historical context). Implemented
  by closing the top `{isExisting && (<>...</>)}` fragment after the
  basic row and opening a second one after the CashSweepEditor.

- **Pass 54 (`442b53e`)**: single source of truth for existing
  debt. Per-asset `historicalDebtAmount` is now the SOLE input;
  tranche.openingBalance is read-only and auto-synced via a useEffect
  that writes `Math.round(phaseAssetsTotDebt)` whenever it drifts
  from the rounded openingBalance by >= 1. Removes the Pass 52
  click-to-sync tile (mismatch is structurally impossible). Phase-
  totals row drops from 4 tiles to 3 (Pre-Capex / Existing Debt with
  "flows into Opening Balance" sublabel / Existing Equity). Fallback:
  Opening Balance becomes editable when the phase has no assets yet
  so users can sketch a facility size before detailing the asset
  breakdown. Multi-facility-per-phase caveat documented in commit
  body (second facility would clobber the first; acceptable for now
  since no user flow requires it).

- **Pass 55 (`2b0c217`)**: existing-facility YoY % editor now spans
  the full operations horizon when Repayment Periods is unset.
  Previous expression `Math.max(0, (t.remainingRepaymentPeriods ?? 0)
  - 1)` collapsed to 0 when periods = 0 (the default), so
  endYear === startYear and the editor rendered a single 2026-2026
  grid. Fix branches: new facility -> operationsEndYear; existing
  with periods > 0 -> `start + periods - 1` capped at operationsEnd;
  existing with periods <= 0 -> operationsEndYear (matches new-
  facility behavior so the editor is immediately usable).

**Session close 2026-05-14 EoD.** Status: 23 commits across Passes
37-55. User confirmed: tomorrow's work = Module 1 fine-tuning then
final lock. Outstanding low-priority items (deferred): schema
deprecation cleanup on `PhaseHistoricalBaseline` (8 `@deprecated`
fields kept for legacy parse), multi-existing-facility-per-phase
edge case in Pass 54 auto-sync.
