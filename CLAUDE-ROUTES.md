# Routes & Folder Structure

> Referenced from CLAUDE.md, all page routes, API routes, components, and lib structure.

---

## `app/`, Routes by subdomain

### Main Site (`financialmodelerpro.com`)
```
app/
├── (cms)/[slug]/page.tsx        # Dynamic CMS catch-all
├── (portal)/page.tsx            # Home page, CMS Option B (each section from page_sections fed into custom JSX)
├── (portal)/HeroScrollBtn.tsx   # Client scroll button
├── (portal)/FounderExpand.tsx   # Client expand/collapse for founder profile (long bio, experience, philosophy)
├── layout.tsx                   # Root layout, SessionProvider, Inter font
├── globals.css                  # SINGLE SOURCE OF TRUTH for all CSS tokens
├── about/ahmad-din/page.tsx     # Founder profile page, reads from page_sections team content; "Get in Touch" section with email/WhatsApp/LinkedIn/booking
# NOTE: app/about/page.tsx DELETED 2026-04-18, /about redirects to /about/ahmad-din (next.config.ts)
├── articles/page.tsx
├── articles/[slug]/page.tsx
├── book-a-meeting/page.tsx      # Calendly inline embed (no redirect) via CalendlyEmbed component; reads booking_url from CMS team section
├── contact/page.tsx
├── forgot-password/page.tsx
├── login/page.tsx               # Full admin login UI (200 response, no redirect)
├── modeling-hub/page.tsx        # Phase P-Sync 2026-05-07: public overview of all platforms (REFM, BVM, FPA, ...) reading legacy `modules` table via getModules. Grid of platform cards with icon + name + description + status pill, each linking to /modeling-hub/[platformSlug].
├── modeling-hub/[platformSlug]/page.tsx  # Phase P-Sync 2026-05-07: per-platform overview, lists every visible platform_modules row with description + status pill + link to per-module marketing page. Uses getPlatformModules helper.
├── modeling-hub/[platformSlug]/[moduleSlug]/page.tsx  # Phase P-Sync 2026-05-07: per-module marketing landing rendering hero + features + how_it_works + testimonials + cta sections from platform_module_pages. Uses getPlatformModuleWithPages + getSectionContent. notFound() on missing module. ISR 60s.
├── portal/page.tsx              # 5-line redirect → ${APP_URL}/modeling/dashboard (2026-04-30). Modeling Hub is canonically on app.* subdomain; this main-domain entry is preserved only so historical bookmarks keep working. Removed from MAIN_PATHS in next.config.ts.
├── pricing/page.tsx
├── reset-password/page.tsx
├── settings/page.tsx
├── t/[token]/page.tsx
├── testimonials/submit/page.tsx
├── verify/layout.tsx            # Pins metadataBase + canonical + og:url to LEARN_URL so share previews always show learn.* in the card footer (no main-domain inheritance from root layout)
├── verify/page.tsx              # Verify ID lookup form
├── verify/VerifySearchForm.tsx  # Client lookup form
├── verify/[uuid]/page.tsx       # Certificate public verification, dark gradient hero, NavbarServer, inline Certificate/Badge/Transcript preview grid (4:3 PDF iframe + 1:1 badge img + 3:4 transcript iframe with pre-cache fallback), QR, downloads + Share Certificate
└── verify/[uuid]/VerifyActions.tsx # Client share flow: downloads + ShareModal using certificate_earned template
```

### Admin (`financialmodelerpro.com/admin`)
```
app/admin/
├── layout.tsx                   # AdminGuard -> AdminProtected child; skips the auth hook on /admin so the login form renders inline
├── page.tsx                     # Single admin auth entry (2026-04-24). Server component: authed admin -> redirect /admin/dashboard, else render <AdminLoginClient />. No searchParams, no callbackUrl.
├── AdminLoginClient.tsx         # Credentials + device-OTP flow. No useSearchParams, post-signin destination hard-coded to /admin/dashboard.
├── analytics/page.tsx           # Platform-wide analytics dashboard (2026-04-24). 7 metrics: signup growth, active 7/30d, per-session funnel, drop-off callout, certificate rate, course comparison, live-session attendance. Uses recharts.
├── dashboard/page.tsx           # Protected entry point -> redirects to /admin/cms
├── announcements/page.tsx
├── articles/page.tsx + [id]/ + new/
├── audit/page.tsx
├── badge-editor/page.tsx           # 5-line redirect -> /admin/certificate-designer?tab=badge (consolidated 2026-04-24)
├── branding/page.tsx              # 5-line redirect -> /admin/header-settings (2026-04-28, commit ab5db30), Brand Colors merged into Header Settings. Sidebar entry removed; Header Settings has matchPaths: ['/admin/branding'] so the rail stays highlighted on stale links.
├── certificate-designer/           # Consolidated cert design hub (2026-04-24, commit 5d81e06)
│   ├── page.tsx                    # Tab dispatcher: ?tab=templates|certificate|badge|transcript (default templates)
│   ├── TemplatesTab.tsx            # 3SFM/BVM cert PDF + badge PNG uploads (was /admin/certificates)
│   ├── CertificateLayoutTab.tsx    # Drag-position text fields on cert PDF (was /admin/certificate-editor)
│   ├── BadgeLayoutTab.tsx          # Cert ID + Issue Date overlay on badge PNG (was /admin/badge-editor)
│   └── TranscriptLayoutTab.tsx     # Header drag-positioner + body/footer settings (was /admin/transcript-editor)
├── certificate-editor/page.tsx     # 5-line redirect -> /admin/certificate-designer?tab=certificate
├── certificates/page.tsx           # 5-line redirect -> /admin/certificate-designer (templates tab)
├── cms/page.tsx
├── contact/page.tsx
├── content/page.tsx
├── health/page.tsx
# NOTE: app/admin/founder/page.tsx DELETED 2026-04-18, founder editing moved to Page Builder → Founder section (team)
# NOTE: app/admin/login/page.tsx + LoginForm.tsx DELETED 2026-04-24, the welcome/intermediate/form chain collapsed into /admin itself. Legacy /admin/login URL is now a 307 in middleware (src/middleware.ts), not a page.
# NOTE: app/login/page.tsx DELETED 2026-04-24, same: handled by middleware 307 with no-cache headers.
├── media/page.tsx
├── modeling-access/page.tsx       # Modeling Hub access whitelist admin (migration 136): add-email form + per-row Revoke + toggle-state summary. Sidebar nav entry 🔑 Access Whitelist under Modeling Hub.
├── modules/page.tsx                # Modeling Hub modules; two LaunchStatusCards (Sign In + Register, migration 136) + banner linking to /admin/modeling-access at the top.
├── platform-modules/page.tsx       # Phase P-Sync 2026-05-07: 2-level admin UI for `platform_modules` (per-platform sub-modules). Level 1 platform tabs reading legacy `modules` table, Level 2 modules table per active platform with inline create/edit/delete + status cycling (live/coming_soon/pro/enterprise/hidden) + features textarea. CmsAdminNav entry "Platform Modules" 📚 under Modeling Hub group.
├── platform-modules/[id]/pages/page.tsx  # Phase P-Sync 2026-05-07: 5-section page-content editor (hero/features/how_it_works/cta/testimonials) for one platform module. JSON textarea per section, per-section visibility toggle, save button per section. Linked from each row on the parent /admin/platform-modules page.
# NOTE: app/admin/overrides + app/admin/permissions + app/admin/plans DELETED 2026-04-27 (commit d8405e5), Permissions system removed in Phase 5 of admin cleanup. REFM canAccess() stubs to false until paid tiers go live. Migration 144 drops the underlying tables.
├── page-builder/page.tsx         # CMS page list
├── page-builder/[slug]/page.tsx  # Section editor with drag-and-drop
├── pages/page.tsx
├── pricing/page.tsx                  # 2026-04-28 (commits 50e22fa + 777e1bf): single Platform Pricing surface. Plans tab + Page Content tab + Pricing Features tab + Module Access tab all gone; tab bar removed entirely. Plan-create/edit form, PlanCard sub-component, planFromRow / savePlan / deletePlan / duplicatePlan / user-search effect all deleted. Hero text + FAQ for the public /pricing page are now edited in Page Builder → Pricing.
├── projects/page.tsx
├── settings/page.tsx
├── testimonials/page.tsx + modeling/ + training/
├── training/page.tsx + [courseId]/
├── communications-hub/         # NEW 2026-04-27: unified hub merging the four old comms surfaces. page.tsx (tab dispatcher: campaigns | email-settings | share-templates | newsletter; auth gate; CmsAdminNav with active='/admin/communications-hub') + CampaignsTab.tsx (targeted student emails + history + share-modal copy editor) + EmailSettingsTab.tsx (email_branding + live-session email_templates) + ShareTemplatesTab.tsx (centralized share-text admin: Global Mention Settings card + per-template editor with variable-picker chips, hashtag chip editor, active toggle, live preview) + NewsletterTab.tsx (rebuilt 2026-04-27, 5 internal sub-tabs: Subscribers / Compose / **Templates (new)** / Campaigns / Auto Notifications. Compose adds template picker + segment dropdown + schedule datetime + Send-test-to-my-inbox button + Schedule-Send vs Send-Now CTA. Templates is the DB-backed editor for newsletter_templates rows. Campaigns row click opens an analytics modal with 6 stat cards, open/click rates, per-recipient table, Retry-N-Failed, Cancel-scheduled, CSV export, Delete.)
├── training-hub/page.tsx + analytics/ (redirects to /admin/analytics 2026-04-24) + assessments/ + certificates/ + live-sessions/ + live-sessions/email-settings/page.tsx (5-line redirect -> /admin/communications-hub?tab=email-settings)
│   + cohorts/ + communications/page.tsx (5-line redirect -> /admin/communications-hub?tab=campaigns) + course-details/ + students/ + instructors/
│   + share-templates/page.tsx (5-line redirect -> /admin/communications-hub?tab=share-templates)
│   + daily-roundup/            # Daily certifications roundup: date picker + per-student checklist + live preview + Share Roundup via ShareModal (migration 117 template)
│   + model-submissions/        # Model-submission review queue (migration 148): admin-only list with status / course / search filters, pagination, "View File" iframe modal in the review dialog (admin proxy at /api/admin/model-submissions/[id]/file streams from the private bucket), Approve / Reject actions with reviewer note. Sidebar entry "Model Submissions" 📥 in CmsAdminNav.
│   + marketing-studio/         # Training Hub Marketing Studio (rebuild 2026-04-24, migration 142; multi-instructor + drag-resize follow-up commit b0823b9): page.tsx tab shell + LinkedInBannerStudio.tsx (3 variants) + LiveSessionBannerStudio.tsx (auto-fills from live_sessions incl. instructor_id) + YouTubeThumbnailStudio.tsx + ArticleBannerStudio.tsx (auto-fills from articles) + AssetLibrary.tsx (uploads) + studio-shared.tsx (shared primitives incl. useAutoRender 350ms-debounce hook) + InstructorPicker.tsx (multi-select checklist with photo thumbs, name, title, default badge, selection-rank chips) + LayoutEditor.tsx (drag-and-resize zone overlay on the server PNG; move = drag box, resize = drag right edge / bottom edge / SE corner)
├── training-settings/page.tsx
├── transcript-editor/page.tsx     # 5-line redirect -> /admin/certificate-designer?tab=transcript (consolidated 2026-04-24)
├── newsletter/page.tsx           # 5-line redirect -> /admin/communications-hub?tab=newsletter (consolidated 2026-04-27)
# NOTE: app/admin/marketing-studio/* DELETED 2026-04-24, Phase 1.5 canvas editor (page.tsx + brand-kit/page.tsx) replaced by template-driven Training Hub edition at /admin/training-hub/marketing-studio. Old URL is now a 404 (Modeling Hub will get its own at a different path later).
└── users/page.tsx
# NOTE: app/admin/whitelabel/page.tsx DELETED 2026-04-27 (commit a000fbd), White-Label feature removed. REFM Topbar reads platform name + logo directly from the branding store (default values).
```

### Public Training Sessions
```
app/training-sessions/
├── page.tsx                     # Server component: SSR sessions list
├── SessionsClient.tsx           # Client: hero, grid cards, countdown, CTAs
├── [id]/page.tsx                # Server component: SSR session detail
└── [id]/DetailClient.tsx        # Client: detail with countdown, video, instructor
```

### Certification Watch Page
```
app/training/watch/
└── [courseId]/[sessionKey]/page.tsx  # Embedded video player for cert courses (S1, S2, etc.)
                                      # CoursePlayerLayout + timer + assessment flow
```

### Training Hub (`learn.financialmodelerpro.com`)
```
app/training/
├── layout.tsx                   # OG metadata for learn. domain (metadataBase, og:image → /api/og)
# Per-route layout.tsx files added 2026-04-21 so share previews of deep links inherit learn-subdomain OG defaults:
#   [courseId]/layout.tsx  assessment/layout.tsx  certificate/layout.tsx  certificates/layout.tsx
#   dashboard/layout.tsx   live-sessions/layout.tsx  material/layout.tsx  transcript/layout.tsx
#   watch/layout.tsx
├── page.tsx                     # CMS Option B (065-066), revalidate=0
├── CurriculumCard.tsx           # Course card component
├── TestimonialsCarousel.tsx     # Auto-scrolling testimonials with LinkedIn buttons
├── UpcomingSessionsPreview.tsx  # 3-column session preview cards
├── [courseId]/page.tsx
├── [courseId]/assessment/page.tsx
├── assessment/[tabKey]/page.tsx   # Assessment quiz page with share section
├── assessment/[tabKey]/layout.tsx # OG metadata with dynamic achievement image per session
├── certificate/page.tsx
├── certificates/page.tsx
├── confirm-email/page.tsx
├── dashboard/page.tsx            # Overview + course views, collapsible sidebar
├── forgot/page.tsx
├── live-sessions/page.tsx
├── live-sessions/[id]/page.tsx
├── login/page.tsx
├── register/page.tsx
├── set-password/page.tsx
├── signin/page.tsx
├── submit-testimonial/page.tsx
└── transcript/[token]/page.tsx
```

### Modeling Hub (`app.financialmodelerpro.com`)
```
app/modeling/
├── layout.tsx                   # OG metadata for app. domain (metadataBase, og:image → /api/og/modeling)
├── page.tsx                     # CMS Option B (070), revalidate=0
├── ComingSoon.tsx               # Coming soon page component (shared by signin/register)
├── [slug]/page.tsx              # CMS platform sub-pages (071-072), revalidate=0
├── confirm-email/page.tsx
├── dashboard/page.tsx           # Canonical post-signin landing on app.* (rebuilt 2026-04-30). Server-fetches CMS keys logo_url + logo_height_px + header_height_px (defaults 36 / 64) so the hub topbar matches main-site NavbarServer dimensions. Renders the sidebar layout (topbar minHeight=headerHeight, sidebar top=headerHeight + height=calc(100vh - {headerHeight}px)). Owns its own dark-mode toggle via localStorage['modelingDarkMode'] (default → prefers-color-scheme), data-theme attribute does NOT leak into /admin or /training surfaces.
├── register/page.tsx            # Server component - gates on modeling_hub_register_coming_soon (migration 136); supports ?email=whitelisted@address shortcut that server-verifies the whitelist and renders the form with the email locked; otherwise renders ModelingRegisterComingSoonWrapper
├── register/RegisterForm.tsx    # Client signup form; accepts optional invitedEmail prop that pre-fills + locks the email input with a green "✓ Invited" affordance
├── register/ComingSoonWrapper.tsx # Register-side Coming Soon wrapper: reads ?bypass=true for QA, otherwise renders ModelingComingSoon(variant='register')
├── signin/page.tsx              # Server component - gates on modeling_hub_signin_coming_soon (migration 136); renders ModelingComingSoonWrapper when toggle is on
├── signin/SignInForm.tsx        # Client sign-in + signup + device OTP (extracted)
├── signin/ComingSoonWrapper.tsx # Handles ?bypass=true for admin access
└── submit-testimonial/page.tsx
# NOTE: app/modeling/login/page.tsx was DELETED

app/refm/layout.tsx              # OG metadata for app. domain (added 2026-04-21 for subdomain canonical)
app/refm/page.tsx                # REFM platform
app/portal/page.tsx              # Authenticated hub
```

---

## `app/api/`, API Routes

### Auth (Modeling Hub)
```
app/api/auth/
├── [...nextauth]/route.ts
├── confirm-email/route.ts         # GET: verify token -> email_confirmed=true
├── device-verify/route.ts         # POST action:send|check
├── forgot-password/route.ts
├── register/route.ts              # POST: hCaptcha + create user + confirm email
├── resend-confirmation/route.ts   # POST: resend if email_confirmed=false
└── reset-password/route.ts
```

### Training (Training Hub)
```
app/api/training/
├── [courseId]/assessment/route.ts + submit/
├── activity/route.ts
├── attempt-status/route.ts
├── certificate/route.ts + certificate-image/
├── certificates/route.ts
├── confirm-email/route.ts
├── course-details/route.ts
├── device-verify/route.ts
├── feedback/route.ts
├── logout/route.ts
├── notes/route.ts
├── profile/route.ts
├── progress/route.ts
├── proxy-ping/route.ts
├── questions/route.ts
├── register/route.ts
├── resend-confirmation/route.ts
├── resend-id/route.ts
├── send-verification/route.ts
├── set-password/route.ts
├── submit-assessment/route.ts
├── submit-testimonial/route.ts
├── transcript-link/route.ts
├── upload-avatar/route.ts
├── validate/route.ts
├── verify-email/route.ts
├── badges/download/route.ts
├── assessment-settings/           # GET: shuffle settings per course
├── attachments/                   # GET: visible file attachments
├── live-sessions/                 # GET: published sessions with attachments
├── live-sessions/[id]/            # GET: single session detail
├── live-sessions/[id]/register/   # POST/DELETE/GET: register/cancel/status
├── live-sessions/[id]/watched/    # GET (status) + POST. POST accepts watch_seconds/total_seconds/last_position/watch_intervals/manual_override. Server unions incoming + existing JSONB watch_intervals (mig 146) and recomputes watch_seconds from the merged set with a wall-clock rate limit on the new portion. Stamps video_load_at on first POST (mig 147), stamps completed_via on flip to completed ('threshold' or 'manual'). Manual override path requires pct >= 50 AND elapsed >= total_seconds * 0.8; 403 with diagnostics on either fail. Awards 50 points on first transition to completed.
├── live-sessions/registration-status-batch/ # POST: batch status
├── watch-history/                 # GET: student watch history (session_watch_history rows)
├── certification-watch/           # GET (returns rows with watch_intervals JSONB so the player can hydrate the tracker on mount) + POST. POST body: { student_email, tab_key, course_id, status, watch_seconds?, total_seconds?, last_position?, watch_intervals? }. Server unions incoming + existing JSONB watch_intervals (mig 146) and recomputes watch_seconds from the merged set with a wall-clock rate limit on the new portion. Legacy callers without intervals fall back to MAX(existing, incoming) on the scalar. Stamps video_load_at on first POST. On flip to completed: completed_via='threshold' (legacy column kept). Video swap auto-detection resets intervals + clears completed_via. (Threshold + manual_override gates removed 2026-04-29 with watch enforcement.)
# DELETED 2026-04-29: watch-enforcement/, global watch-threshold gate retired
├── youtube-comments/              # GET: cached YouTube comments (24h DB cache via youtube_comments_cache)
├── achievement-image/route.tsx    # GET: dynamic OG achievement card image (satori ImageResponse, sharp SVG→PNG logo)
├── tour-status/route.ts           # POST: toggle training_registrations_meta.tour_completed, one-shot dashboard walkthrough (migration 120)
└── model-submission/              # GET ?courseCode=3SFM|BVM → ModelSubmissionStatusResult for the dashboard card. POST FormData (file, courseCode, studentNotes?) uploads a model to the private model-submissions bucket and inserts a model_submissions row with status='pending_review'. Validates: auth via training_session cookie, courseCode normalization, gate-on check, one-pending guard (409), attempts cap (403), file extension allow-list, MIME detection, file size cap (clamped 1-50 MB via training_settings). On success: fires fire-and-forget admin alert email via next/server `after()` (Phase F.1, gated by model_submission_admin_notify_enabled + model_submission_admin_notify_email). Migration 148.
```

### Admin
```
app/api/admin/
├── analytics/                   # GET /api/admin/analytics?range=7|30|90|all → platform-wide dashboard data. Fans out 8 parallel Supabase queries (meta, enrollments, assessments, watch history, certs, live_sessions, session_registrations, session_watch_history) and aggregates server-side. Admin-only. range filters the growth-trend window only; funnel / course / cert / live-session sections are cumulative so they reflect the current platform state at a glance (2026-04-24).
├── announcements/ articles/ asset-types/ audit-log/
├── assessments/ + attempts/ + questions/
├── badge-layout/                # GET/POST badge field positions
├── badge-preview/               # POST: generate badge PNG preview
├── certificate-layout/ certificates/sync/ certificates/upload-template/
# certificates/settings and certificates/generate, REMOVED. They backed the legacy "Certificate Generation" tile on /admin/certificates which paired with the retired daily cron. Replaced by the inline trigger plus the safety-net panel on /admin/training-hub/certificates.
├── certificates/by-date/        # GET ?date=YYYY-MM-DD → every cert_status='Issued' row for the UTC calendar day (powers Daily Roundup admin page)
├── certificates/pending/        # GET: eligible-but-not-issued list (powers safety-net panel on /admin/training-hub/certificates)
├── certificates/issue-pending/  # POST { email, courseCode } | { all: true }, single-student or bulk issue via issueCertificateForStudent; idempotent via pre-check + unique index
├── certificates/check-eligibility/ # POST { email, courseCode } → full EligibilityResult (passedSessions, missingSessions, reason). watchThresholdMet/watchDetails dropped 2026-04-29 with watch enforcement.
├── certificates/force-issue/    # POST { email, courseCode, nameOverride?, regIdOverride? }, bypasses watch threshold; records issued_via='forced' + issued_by_admin
├── certificates/resend-email/   # POST { certificateId }, rebuilds + resends certificateIssuedTemplate and stamps student_certificates.email_sent_at
├── model-submissions/                # GET: list + filter (status / course / search) + paginated; admin queue at /admin/training-hub/model-submissions (migration 148)
├── model-submissions/[id]/review/    # POST { decision: 'approve' | 'reject', reviewNote }: writes review + audit log + fires modelSubmissionApproved/Rejected email
├── model-submissions/[id]/file/      # GET: admin-only proxy that streams the upload from the private model-submissions bucket so the bucket can stay private
├── training-settings/model-submission-gate/ # POST { key, value }: audit-logged write for the 3 gate flags. Admin-only. Writes admin_audit_log action='model_submission_gate_change' with before/after values. Other gate-related K/V pairs (notify settings, guidance, sample URL) go through the generic /api/admin/training-settings endpoint.
├── share-templates/             # GET: list all templates + merged ShareSettings (admin editor)
├── share-templates/[key]/       # PATCH: update single template (title/template_text/hashtags/mention_brand/mention_founder/active)
├── share-templates/settings/    # PATCH: brand_mention / founder_mention / brand_prefix_at / founder_prefix_at, strips leading @ on mention inputs, re-reads full settings after write
├── contact-submissions/ content/ env-check/ media/ modules/ modules/cms-status/ pages/ permissions/
# NOTE: app/api/admin/founder/route.ts DELETED 2026-04-18, founder data written via /api/admin/page-sections
├── modeling-coming-soon/        # GET/PATCH: legacy single-toggle endpoint (kept for backward compat)
├── modeling-signin-coming-soon/ # GET/PATCH: Modeling Hub signin-side Coming Soon toggle (migration 136)
├── modeling-register-coming-soon/ # GET/PATCH: Modeling Hub register-side Coming Soon toggle (migration 136)
├── modeling-access/             # GET (list entries), POST { email, note } add - modeling_access_whitelist CRUD, admin-gated
├── modeling-access/[id]/        # DELETE: revoke whitelist entry by id
├── pricing/features/                # /api/admin/pricing/plans/ DELETED 2026-04-28 (commit 777e1bf), Plans tab removed + migration 145 drops pricing_plans table. /api/admin/pricing/modules/ DELETED 2026-04-27 (commit 4a5abe3). Only /api/admin/pricing/features + /coupons + /platform remain.
├── projects/ testimonials/ training/ + [courseId]/lessons/
├── training-actions/ + [id]/
├── training-hub/ + analytics/ + assessments/ + certificates/
│   + cohorts/ + cohorts/[id]/ + communications/ + student-journey/
│   + student-progress/ + students/
│   # student-progress: GET ?email&regId returns { progress, watch }. Phase 4 / 2026-04-28 extended to read both certification_watch_history + session_watch_history in parallel and return the watch[] alongside the existing progress payload. Powers the Watch Progress table + Force Unlock buttons in the Progress modal on /admin/training-hub/students.
│   # communications/route.ts: 2026-04-23 rewrite - POSTs send via sendEmailBatch (now Brevo, Promise.allSettled loop with binary ok/fail semantics; was Resend `batch.send` until 2026-05-11 commit `166a8ec`) wrapped in baseLayoutBranded (gold CTA button for URL lines, teal inline links, organizer in description). Previously delegated to Apps Script with no brand layout. Per-recipient success/failure written to training_email_log.status. Tokens {name} / {full_name} / {reg_id} / {email} resolved server-side from training_registrations_meta.
│   # communications dropout groups: common gate (emailConfirmed AND NOT certificateIssued), then neverStarted / stalled (>=1 pass + >=7 days idle) / almostDone (>=65% sessions), no longer uses 80% threshold or distinct-attempt denominator.
├── live-playlists/              # CRUD for playlists
├── live-sessions/               # GET/POST + PUT banner upload
├── live-sessions/[id]/          # PATCH/DELETE
├── live-sessions/[id]/notify/   # GET: session + recipients[] (for picker modal) + history[], supports ?sendLogId=X to fetch per-recipient log rows (migration 138). POST: send emails via sendEmailBatch (Brevo Promise.allSettled loop since 2026-05-11 commit `166a8ec`; previously Resend `batch.send`); seeds announcement_recipient_log rows as 'pending' before the batch fires, UPDATEs each to sent/failed from the response. `announcement_recipient_log.resend_message_id` column name retained for backwards compatibility, now stores Brevo message ids. New POST modes: `recipientEmails: string[]` (explicit picker allowlist / test send), `retrySendLogId: string` (re-attempt failed/bounced rows of a prior dispatch in place). `target: '3sfm'|'bvm'|'all'` now filters via training_enrollments JOIN.
├── live-sessions/[id]/registrations/ # GET/PATCH
├── newsletter/subscribers/       # GET: paginated subscriber list with stats
├── newsletter/export/           # GET: CSV download
├── newsletter/send/             # POST 2026-04-27 rebuild: accepts { subject, body, targetHub, segment, scheduledAt? } OR { templateKey, templateVars, ... }. Inserts campaign row; if scheduledAt set → status='scheduled' for the cron to pick up; else fires void sendCampaign() (fire-and-forget batch send via sendEmailBatch — Brevo Promise.allSettled loop since 2026-05-11; was resend.batch.send — 100/batch, 200ms stagger).
├── newsletter/test-send/        # NEW 2026-04-27. POST: renders subject+body or template, sends one [TEST]-prefixed email to the admin's session email (or supplied toEmail) via newsletter shell. No log row, no batch, no segment query. Powers the "Send to my inbox" Compose button.
├── newsletter/templates/        # NEW 2026-04-27 (migration 143). GET: list every newsletter_templates row + per-event-type variable schema. POST: create new template (template_key, name, subject_template, body_html, event_type?, active?).
├── newsletter/templates/[key]/  # NEW 2026-04-27. PATCH: update name/subject/body/event_type/active. DELETE: drop template by template_key.
├── newsletter/segments/         # NEW 2026-04-27. GET ?segment=X&targetHub=Y returns { count, segments[] }, count is the live recipient count for the Compose UI; segments[] is the metadata for the dropdown (key/label/description per segment).
├── newsletter/campaigns/        # GET: campaign history
├── newsletter/campaigns/[id]/   # NEW 2026-04-27. GET: campaign + recipients[] from newsletter_recipient_log + computed totals (sent/failed/bounced/complained/opened/clicked/pending) + openRate + clickRate. PATCH { action: 'cancel' }: scheduled → cancelled. DELETE: drop campaign (recipient log rows cascade via FK).
├── newsletter/campaigns/[id]/retry/ # NEW 2026-04-27. POST: re-send to every failed/bounced row of the recipient log. Resolves emails back to active subscribers (skips ones who unsubscribed since), passes them to sendCampaign({ recipients: [...] }), then recomputes sent_count/failed_count from the FULL log so totals reflect cumulative successes (sender.ts only counts the retry batch by itself).
├── newsletter/content-items/    # GET: items from live_sessions/articles for compose auto-populate
├── newsletter/enhance/          # POST: AI rewrite via Anthropic API
├── newsletter/auto-settings/    # GET/PATCH: auto-notification toggles
# app/api/admin/marketing-studio/* DELETED 2026-04-24, Phase 1.5 canvas API routes (render, generate-caption(s), data-sources, designs/[id], brand-kit) all removed. Replaced by:
├── training-hub/marketing-studio/render/         # POST { type, content }: dispatcher returns next/og ImageResponse PNG at the template's fixed dimensions. Loads brand pack + selected instructors (loadInstructorsByIds preserves admin pick order) + their photos in parallel; passes instructors[] + Record<id, base64> to every template. Admin-only.
├── training-hub/marketing-studio/brand/          # GET: resolved BrandPack (logo, primaryColor, default trainer) for client-side preview rendering
├── training-hub/marketing-studio/live-sessions/  # GET: 60 most recent live_sessions for the session picker (Live Session Banner + YouTube Thumbnail editors). Returns instructor_id so the editor can auto-fill the picker with the session's instructor.
├── training-hub/marketing-studio/articles/       # GET: 80 most recent published articles for the Article Banner editor's picker
├── training-hub/marketing-studio/instructors/    # GET: every active instructor row (active=true ordered by display_order). Powers the multi-select InstructorPicker (added 2026-04-24, commit b0823b9).
├── training-hub/marketing-studio/uploads/        # GET (list) + POST (upload PNG/JPEG/WebP, max 10 MB), writes to marketing-assets bucket + marketing_uploaded_assets table
├── training-hub/marketing-studio/uploads/[id]/   # PATCH (rename) + DELETE (storage + DB cleanup in lockstep)
# DELETED 2026-04-29: watch-enforcement-stats/, admin Watch Enforcement card retired
├── sessions/[tabKey]/reset-watch-progress/ # POST: admin-only nuclear reset, deletes every watch-history row for the session. Routes by prefix: LIVE_<uuid> → session_watch_history; else → certification_watch_history (tab_key match). Paired with red buttons in both session editors. (2026-04-21)
├── sessions/[tabKey]/force-complete-for-student/ # POST { email, reason }: admin-only per-student force-unlock. Mirrors reset-watch-progress's prefix routing (LIVE_ vs cert). Flips status='completed' + completed_via='admin_override' + completed_at=now (cert) / watched_at=now (live), clamps watch_percentage to the row's actual coverage, awards +50 points on live-session rows that hadn't received them. Idempotent: returns alreadyCompleted=true on already-done rows without overwriting honest 'threshold'/'manual' provenance. Writes to admin_audit_log with action='watch_force_complete' + previous state + reason. Phase 4 / migration 147. Surfaced via Force Unlock buttons in the Progress modal on /admin/training-hub/students.
├── generate-images/             # POST: satori+sharp generate mission/vision PNGs → Supabase
├── page-sections/               # CRUD for page_sections + cms_pages
├── reset-attempts/              # POST: reset via Apps Script
├── training-settings/ users/
├── site-settings/               # GET/PATCH/POST: global site settings + file upload
├── email-templates/             # GET: all templates + branding
├── email-templates/branding/    # GET/PATCH: universal email branding
├── email-templates/[key]/       # GET/PATCH: single template by key
├── email-templates/[key]/test/  # POST: send test email to admin
├── live-sessions/[id]/announce/ # POST: manual announcement send
├── platform-module-pages/         # Phase P-Sync 2026-05-07. GET ?moduleId=<uuid>: admin list of platform_module_pages rows for a module. POST: admin upsert by (module_id, page_section).
├── platform-module-pages/[id]/    # Phase P-Sync 2026-05-07. PATCH: update single page section (content_blocks JSONB + visible). DELETE: drop a section.
```

### Public Platform & Module API (Phase P-Sync)
```
app/api/platforms/
├── [platformSlug]/modules/route.ts                    # GET (public, list all modules with status != 'hidden') + POST (admin create). Cache-Control: public, s-maxage=300.
└── [platformSlug]/modules/[moduleSlug]/route.ts       # GET (public, single module + visible page sections bundled) + PATCH (admin update) + DELETE (admin, by ?id= or by slug fallback).
```

### Other API Routes
```
app/api/
├── agents/market-rates/ + research/
├── branding/                      # GET: public, PATCH: admin only
├── cms/ contact/ cron/session-reminders/ cron/auto-launch-check/ cron/newsletter-scheduled/ email/send/
# cron/certificates, REMOVED. Certificate issuance is now inline (fire-and-forget from /api/training/submit-assessment when a final-exam submission passes). Admin safety-net at /admin/training-hub/certificates covers any gaps.
# cron/session-reminders, per-registration reminder flag model (migration 122): reads session_registrations.reminder_{24h,1h}_sent; CRON_SECRET bearer auth.
# cron/auto-launch-check, (disabled UI) flips {hub}_coming_soon='false' + one-shot auto_launch='false' when launch_date <= now(). Gated by AUTO_LAUNCH_UI_ENABLED=false in LaunchStatusCard; Vercel Hobby only supports daily crons so vercel.json entry was rolled back.
# cron/newsletter-scheduled, NEW 2026-04-27. CRON_SECRET bearer auth. Polls newsletter_campaigns WHERE status='scheduled' AND scheduled_at <= now() (limit 20/tick); for each, calls sendCampaign() with the stored subject/body/target_hub/segment. Per-campaign try/catch flips a single failure to status='failed' without aborting the rest of the batch. vercel.json schedule: daily at 07:00 UTC (Hobby tier limit; finer cadence requires Pro). Reuses CRON_SECRET, no new env var.
# cron/model-submission-stale, NEW 2026-04-29 (Phase F.3). CRON_SECRET bearer auth. Polls model_submissions WHERE status='pending_review' AND submitted_at <= now() - INTERVAL <model_submission_stale_threshold_days> (default 2 days, capped 1-30) and emails a digest to model_submission_admin_notify_email. Reuses the F.1 enable + recipient settings (no separate kill-switch). Skips silently when the toggle is off, recipient empty, or the queue is clean. No per-row "reminder_sent" flag, daily until handled is the posture. vercel.json schedule: daily at 08:00 UTC.
├── export/excel/ + pdf/
├── health/ modeling/submit-testimonial/
├── permissions/ projects/ qr/
├── t/[token]/pdf/
├── testimonials/ + student/
├── public/training-sessions/      # GET: public list (no auth, no live_url/password)
├── public/training-sessions/[id]/ # GET: public detail (no auth, no live_url/password)
├── training/session-notes/        # GET+POST: per-student notes per session (upsert)
├── training/community-links/      # GET: public returns { whatsappGroupUrl, platformWalkthroughUrl } with server-side URL-shape re-validation (migrations 123 + 2026-04-22 training_settings.platform_walkthrough_url key). Empty strings hide their corresponding UI (Join WhatsApp Group sidebar button, Watch Platform Walkthrough hero button).
├── newsletter/subscribe/          # POST: hub-segmented subscribe (public, rate-limited). Now also fired fire-and-forget by /training/register + /modeling/register on successful signup when the GDPR opt-in checkbox is checked (default ON).
├── newsletter/unsubscribe/        # GET: per-hub unsubscribe via token (HTML response)
├── newsletter/click/              # NEW 2026-04-27. GET ?msg=<message_id>&campaign=<id>&url=<encoded>. Public click-tracking redirector. Best-effort UPDATE on newsletter_recipient_log (matched by resend_message_id, column name unchanged but now holds Brevo message ids post 2026-05-11), then 302 to the decoded url. Always 302s, tracking blip never blocks the user. Rejects non-http(s) URLs. **Note**: the Resend webhook canonical click-tracking path is dormant after the Brevo migration; this endpoint is the only live click-tracking surface until a Brevo webhook is wired.
├── webhooks/resend/               # 2026-04-27. **Dormant after Brevo migration 2026-05-11 (commit `166a8ec`)** — Resend no longer sends events to this endpoint. Handler kept in place pending Brevo webhook integration. POST. Resend webhook receiver. Verifies Svix-style signature manually using Node crypto.createHmac('sha256', ...) (no svix dep). Headers svix-id / svix-timestamp / svix-signature checked against RESEND_WEBHOOK_SECRET (whsec_<base64>); 5-minute replay window; multi-signature header support. Routes events: email.delivered → stamp sent_at if null; email.opened → opened_at + status='opened'; email.clicked → clicked_at + status='clicked'; email.bounced → status='bounced' + (on hard bounce) flips subscriber status='bounced'; email.complained → status='complained' + flips subscriber status='unsubscribed'. Unknown types are no-ops.
├── og/route.tsx                   # GET: Training Hub OG banner (1200x630, CMS hero, logo)
├── og/modeling/route.tsx          # GET: Modeling Hub OG banner (1200x630, CMS hero, logo)
├── og/main/route.tsx              # GET: Main site OG banner (1200x630, CMS hero, logo)
├── og/certificate/[id]/route.tsx  # GET: Dynamic cert OG image (satori ImageResponse), student name + course + grade + date + ID + gold seal; used by /verify/[uuid] share previews
├── share-templates/[key]/route.ts # GET: Public template fetch, merges training_settings mention strings + prefix_at toggles into response so client hook renders immediately
└── user/account/ + password/ + profile/
```

---

## Restructure note (Phase 2, 2026-04-28)

`src/` is now organized along a three-tier architecture: **core → shared → hubs**. Path aliases (`@core/*`, `@shared/*`, `@training/*`, `@modeling/*`, `@platforms/*`, `@main/*`, `@features/*`, `@integrations/*`) are defined in `tsconfig.json`; `eslint-plugin-boundaries` enforces the import-direction rules. The legacy `@/*` alias still resolves to repo-root and is retained because `app/` files use it heavily. All paths below reflect the post-restructure layout.

## `src/components/` (admin shell only)

Cross-hub admin editor primitives, used by every `app/admin/*` page. Hub-owned components live under `src/hubs/<hub>/components/` (see below); generic primitives live under `src/shared/components/`.

```
src/components/admin/
├── AuditLogViewer.tsx
├── CmsAdminNav.tsx
├── InstructorPicker.tsx              # Multi-select roster picker (Marketing Studio)
├── LaunchStatusCard.tsx              # Hub Coming-Soon admin card (toggle + launch date)
├── LiveSessionAssessmentEditor.tsx
├── MediaPicker.tsx
├── ProjectsBrowser.tsx
├── RichTextEditor.tsx                # Tiptap full toolbar (rich_text section only)
├── RichTextarea.tsx                  # Tiptap + floating toolbar (used by 17+ CMS text fields)
└── SystemHealth.tsx
```

## `src/shared/`, cross-hub primitives

```
src/shared/
├── audit/index.ts                    # writeAuditEvent + admin_audit_log writer
├── auth/
│   ├── captcha.ts                    # hCaptcha verification helper
│   ├── deviceTrust.ts                # Trusted-device cookie issue/verify
│   ├── emailConfirmation.ts          # Token issuance + verify
│   ├── nextauth.ts                   # NextAuth authOptions (admin auth source)
│   └── password.ts                   # bcrypt + scrypt helpers
├── cms/index.ts                      # getAllPageSections / getPageSections / getTestimonialsForPage
├── cms/platform-modules.ts           # Phase P-Sync 2026-05-07. Public reads + admin writes for platform_modules + platform_module_pages tables. 9 helpers: getPlatformModules / getPlatformModuleBySlug / getPlatformModulePages / getPlatformModuleWithPages / adminListPlatformModules / adminListPlatformModulePages / adminUpsertPlatformModule / adminDeletePlatformModule / adminUpsertPlatformModulePage / adminDeletePlatformModulePage / getSectionContent. 5 typed content interfaces: HeroContent / FeaturesContent / HowItWorksContent / CtaContent / TestimonialsContent.
├── comingSoon/
│   ├── bypassList.ts                 # isIdentifierAllowed (hub-agnostic primitive, mig 121)
│   └── guard.ts                      # shouldGateComingSoon primitive (DI version)
├── components/
│   ├── BrandingThemeApplier.tsx      # Hydrates branding store + injects --color-primary / --color-secondary
│   ├── CountdownTimer.tsx            # Reusable Days/Hrs/Min/Sec grid
│   ├── FollowPopup.tsx               # Reusable LinkedIn+YouTube follow popup
│   ├── PhoneInput.tsx
│   ├── PreLaunchBanner.tsx           # Bypass-list banner on authed surfaces (mig 121)
│   ├── SessionProviderWrapper.tsx
│   ├── ShareExperienceModal.tsx      # 3-tab testimonial modal for both hubs
│   ├── SiteFollowPopup.tsx           # Site-wide 60s popup wrapper
│   ├── UpgradePrompt.tsx
│   ├── layout/
│   │   ├── Navbar.tsx                # Absolute <a> tags; filters visible !== false
│   │   └── NavbarServer.tsx          # absolutizeHref() for DB hrefs
│   └── ui/
│       ├── ColorPicker.tsx
│       ├── OfficeColorPicker.tsx
│       └── Toaster.tsx
├── email/
│   ├── sendEmail.ts                  # Brevo wrapper (migrated from Resend 2026-05-11, commit `166a8ec`). sendEmail() → transactionalEmails.sendTransacEmail; sendEmailBatch() → Promise.allSettled loop over sendTransacEmail, binary ok/fail semantics preserved (any per-item failure marks the batch failed; ids[] only populated when ok=true).
│   ├── sendTemplatedEmail.ts         # CMS-template email sender (placeholder replacement, batching)
│   └── templates/
│       _base, accountConfirmation, certificateIssued, confirmEmail,
│       deviceVerification, lockedOut, otpVerification, passwordReset,
│       liveSessionNotification, quizResult, registrationConfirmation, resendRegistrationId,
│       newsletter (custom baseLayoutNewsletter())
│       # All template functions are async (use baseLayoutBranded), callers must await.
│       # quizResult is now FINAL-EXAM-ONLY (per-session quiz emails removed 2026-05-11,
│       # commit `166a8ec`; per-session pass/fail visible on the dashboard); lockedOut still
│       # fires for per-session quizzes that exhaust attempts.
├── hooks/
│   ├── useInactivityLogout.ts
│   ├── useProject.ts
│   ├── useRequireAdmin.ts
│   └── useRequireAuth.ts
├── htmlUtils/                        # isHtml() detection
├── newsletter/
│   ├── autoNotify.ts                 # sendAutoNewsletter, fire-and-forget per-event toggle (mig 143 rebuild)
│   ├── linkWrap.ts                   # /api/newsletter/click rewrite + UTM injection
│   ├── segments.ts                   # SEGMENTS metadata + resolveSegment / countSegment
│   ├── sender.ts                     # sendCampaign central pipeline (manual / scheduled / auto / retry)
│   └── templates.ts                  # DB-backed template engine (interpolate / renderForEvent)
├── ogFonts/index.ts                  # Inter font loader for satori OG images
├── seo/
│   ├── canonical.ts                  # canonicalUrl(path, 'main' | 'learn' | 'app')
│   └── components/
│       ├── Breadcrumbs.tsx
│       └── StructuredData.tsx        # OrganizationJsonLd / WebSiteJsonLd / PersonJsonLd / CourseJsonLd / ArticleJsonLd / EventJsonLd / BreadcrumbJsonLd / FAQJsonLd
├── share/
│   ├── share.ts                      # Universal shareTo(platform, options) utility
│   ├── shareTemplates.ts             # Render engine (renderShareTemplate / resolveCourseName / formatShareDate)
│   ├── useShareTemplate.ts           # Client hook (module-level cache + in-flight dedup)
│   └── components/
│       └── ShareModal.tsx            # UNIVERSAL ShareModal (cross-hub)
└── storage/index.ts                  # Supabase storage helpers
```

## `src/hubs/`

### `src/hubs/main/` (marketing site + booking + CMS section renderers)
```
src/hubs/main/
├── components/
│   ├── booking/CalendlyEmbed.tsx
│   ├── cms/
│   │   ├── CmsField.tsx              # UNIVERSAL CMS TEXT RENDERER. ALL CMS text fields must render via <CmsField>.
│   │   ├── SectionRenderer.tsx       # Maps section_type -> component
│   │   ├── index.ts
│   │   └── sections/                 # Hero, Text, RichText, Image, TextImage, Columns, Cards, Cta, Faq,
│   │                                 # Stats, List, Testimonials, PricingTable, Video, Banner, Spacer,
│   │                                 # Embed, Team, Timeline, LogoGrid, Countdown, CmsParagraphs
│   ├── landing/
│   │   ├── AdminEditBar.tsx  ArticleCard.tsx  CategoryFilter.tsx  CourseCard.tsx
│   │   ├── InlineEdit.tsx  SharedFooter.tsx  VideoPlayer.tsx
│   ├── newsletter/NewsletterSubscribeForm.tsx   # Hub checkboxes + email input, shown in SharedFooter
│   └── pricing/PricingAccordion.tsx
└── lib/                              # (currently empty, main-hub server helpers go here)
```

### `src/hubs/training/` (Training Hub, learn.financialmodelerpro.com)
```
src/hubs/training/
├── components/
│   ├── CalendarDropdown.tsx          # Multi-provider Add-to-Calendar (Google/Outlook/Apple/Yahoo/.ics)
│   ├── DashboardTour.tsx             # driver.js interactive walkthrough on first dashboard visit (mig 120)
│   ├── StudentNotes.tsx              # Per-session student notes with bold/bullet toolbar + auto-save
│   ├── SubscribeModal.tsx            # YouTube subscribe modal
│   ├── TrainingShell.tsx             # Shared layout (header + sidebar + footer + mobile nav + CMS logo)
# DELETED 2026-04-29: WatchProgressBar.tsx, student-facing watch UI retired
│   ├── WelcomeModal.tsx              # First-visit modal (configurable localStorage key)
│   ├── YouTubeComments.tsx           # Cached YouTube comments (24h DB cache)
│   ├── YouTubePlayer.tsx             # YT IFrame API player. Interval-merging tracker in useRef (mig 146 Phase 2). startSeconds resume + initialIntervals JSONB hydration. Emits onProgress(WatchProgressPayload) with force=true on real close events.
│   ├── dashboard/
│   │   ├── AboutThisCourse.tsx  BvmLockedContent.tsx  CertificateImageCard.tsx
│   │   ├── CourseContent.tsx  FeedbackModal.tsx  FilePreviewModal.tsx  ProfileModal.tsx
│   │   ├── LiveSessionCard.tsx  LiveSessionCardLarge.tsx  LiveSessionsContent.tsx
│   │   ├── LiveSessionsPanel.tsx  LiveSessionsSection.tsx  RecordedLiveSessionRow.tsx
│   │   ├── SessionCard.tsx  ShareModal.tsx  Skeleton.tsx  StatusBadge.tsx
│   │   ├── TestimonialModal.tsx  index.ts  types.ts
│   ├── player/
│   │   ├── CoursePlayerLayout.tsx    # Video + children layout. Sidebar removed 2026-04-23. `topContent` slot for register-card-on-top.
│   │   ├── CourseTopBar.tsx          # Fixed dark bar (top: measured, z-index 140). Hosts Back + Subscribe + Like + Ask Question + Share + Mark Complete + Assessment.
│   │   └── ShareModal.tsx            # Thin forwarder → @shared/share/components/ShareModal
│   └── sessions/SessionCard.tsx      # Universal live session card (variant: student|public)
├── config/courses.ts                 # 3SFM + BVM session definitions
└── lib/
    ├── appsScript/                   # appsScript.ts, regIdAllocator.ts, sheets.ts, studentRoster.ts
    ├── assessment/                   # attemptInProgress.ts, attemptInProgressClient.ts, liveSessionAssessments.ts, modelGateScope.ts (NEW 2026-05-06 commit f09b337, hot-fix scope helper for Final Exam model-submission gate; isFinalExamAssessment(assessmentName) returns true only when normalized name === 'final exam' so live-session assessments + practice quizzes are not blocked by the gate), shuffle.ts
    ├── certificates/                 # certificateEligibility.ts, certificateEngine.ts, certificateLayout.ts, certifier.ts
    ├── liveSessions/                 # calendar.ts, liveSessionsForStudent.ts
    ├── progress/                     # progressCalculator.ts, progressFromSupabase.ts
    ├── session/                      # training-session.ts, trainingSessionCookie.ts
    ├── share/resolveCourseName.ts    # Training-specific course name resolver
    ├── watch/                        # detectVideoChange.ts, videoTimer.ts, watchTracker.ts (watchEnforcementCheck.ts + watchThresholdVerifier.ts deleted 2026-04-29)
    ├── comingSoon.ts                 # Training-Hub Coming-Soon state reader
    └── ensureNotComingSoon.ts        # Training-Hub Coming-Soon page guard (composes shouldGateComingSoon primitive with bypass list)
```

### `src/hubs/modeling/` (Modeling Hub, app.financialmodelerpro.com)
```
src/hubs/modeling/
├── components/                       # (currently empty, Modeling Hub-wide components go here; all current hub UI lives in app/modeling/* and platforms/*)
├── config/platforms.ts               # 10 platform definitions (1 live: REFM, 9 coming soon)
├── lib/
│   ├── access.ts                     # modeling_access_whitelist gate (mig 136)
│   ├── comingSoon.ts                 # Modeling-Hub state readers (signin + register toggles)
│   └── ensureNotComingSoon.ts        # Modeling-Hub page guard (composes shouldGateComingSoon primitive)
└── platforms/
    ├── refm/                         # Real Estate Financial Modeling, only live platform
    │   ├── components/
    │   │   ├── Dashboard.tsx  PlanBadge.tsx     # OverviewScreen.tsx DELETED Pass 47/48 2026-05-14: redundant after Pass 45 Dashboard rewrite covers both portfolio + project overview; activeModule==='overview' now aliases to Dashboard for legacy deep links
    │   │   ├── ProjectsScreen.tsx  RealEstatePlatform.tsx  Sidebar.tsx  Topbar.tsx
    │   │   ├── modals/ (Export, Project, ProjectWizard [M1.8 2026-05-03, replaces ProjectModal new-flow, 3-step wizard with FAST blue inputs, dirty-confirm Esc, asset matrix per project type; M1.11/1 2026-05-05 wraps return JSX in createPortal(jsx, document.body) with SSR guard so the modal renders centered in the viewport even when ancestor containing-blocks would otherwise swallow position:fixed], PlotSetupWizard [NEW M1.10/6 9f48b76 2026-05-05, 4-step modal wizard for per-plot Envelope -> Floors -> Parking -> Assets, mounted from each PlotEditor card via "Setup wizard" button, M1.10b/1 57a8fc0 portals to document.body], ParcelSetupWizard [NEW M1.10/7 89667ab 2026-05-05, 2-step modal wizard for Land Parcels build + review, mounted from the Land Parcels card via "Setup wizard" button, M1.10b/1 57a8fc0 portals to document.body], Module2SellModal [NEW M2 Pass 3 2026-05-16 commit 4574b97 + EXTENDED Pass 4 commit 83de2ac, 1180px per-asset Residential Sell form. 2-col body: left (cohort tab bar + per-cohort velocity grid + per-cohort price-override + asset-level cash profile + recognition method/anchor/profile + escrow block + indexation block), right (live preview table for 5 streams + reconciliation chip + identity list). Pass 4 added cohort tabs with +/x controls + inline rename; selected cohort scopes velocity grid + price overrides], Rbac, Version)
    │   │   # components/modules/Module2RevenueOutput.tsx + Module2CostOfSales.tsx + Module2Schedules.tsx (NEW M2 Pass 7 2026-05-17): three read-only output sub-tabs under Module 2 (Tab 2/3/4). Module2RevenueOutput renders 4 period tables (Pre-Sales / Post-Sales / Recognition / Cash) via computeAllSellResults. Module2CostOfSales renders capex tile strip + 3 period tables (CoS per period / Cumulative CoS / Gross Margin) using buildCostOfSales(recognition, totalCapex). Module2Schedules renders 4 balance-sheet tables (AR closing / Unearned closing / Escrow Balance / Net Cash to Developer) using buildAccountsReceivable + buildUnearnedRevenue. All three use _shared/tableStyles tokens (CELL_HEADER, ROW_DATA, ROW_GRAND_TOTAL, COLUMN_WIDTHS, nonLabelColumnPct) so columns rebalance with axis size.
    │   │   # lib/revenue-resolvers.ts (NEW M2 Pass 7 2026-05-17): bridge between Zustand store and pure revenue engine. computeAllSellResults(state) returns ProjectRevenueSnapshot { axisLength, projectStartYear, yearLabels, bySellAsset: Map<assetId, SellAssetResult>, projectTotals }. computeAssetCapex(state, assetId) runs computeAssetCost with project.financing.parcelFunding threaded in. computeAssetScheduleBundle(state, result) packages AR + Unearned + CoS per asset. ResolverState type narrows the Module1Store slice consumed.
    │   │   # core/calculations/revenue/{accountsReceivable, unearnedRevenue, costOfSales}.ts (NEW M2 Pass 7 2026-05-17): three pure schedule builders. AR per period = max(0, cum rec - cum cash). Unearned per period = max(0, cum cash - cum rec). CoS per period = totalCapex × recognition[i] / totalRecognition (matching principle; cumulative CoS reaches totalCapex when recognition fully realises). All exported through revenue/index.ts. Verifier scripts/verify-m2-pass7.ts 12/12.
    │   │   ├── modules/ (Module1AreaProgram, Module1Costs, Module1Financing, Module1Hierarchy, Module1Timeline, Module2Revenue [NEW M2 Pass 1 2026-05-16 commit 3e9c453 - strategy-grouped asset list; REWRITTEN M2 Pass 5 commit b45e25e - phase-wise sections matching M1 Tab 2 layout (navy phase header + collapse + per-phase localStorage), simple inline per-asset inputs with single velocity grid + cash strip + recognition pill, Advanced button opens Module2SellModal; EXTENDED M2 Pass 6 commit 44dda8f - per-asset construction-anchored windows, pre/post split into two scoped grids (Pre-Sales · Construction <year> to <year> + Post-Sales · Operations <year> to <year>), sale price shown per sub-unit read from M1 unitPrice + metric (e.g. 'SAR 1,599,000 / unit' or 'SAR 5,400 / sqm'), cash profile scope tightened to constructionStart..operationsEnd])   # Module1Area DISSOLVED M1.12 2026-05-06 (Land tab eliminated, parcel CRUD lifted into ProjectWizard Step 2 + Build Program Land Parcels block)
    │   │   ├── modules/_shared/tableStyles.ts   # NEW M2.0 Pass 12 2026-05-13 (commits 2618e27 / 02dbd0b / 6ad624c / 88a55c0), single source of truth for results-table styling across REFM Module 1. Exports: TABLE_HEADER_BLUE + TABLE_HEADER_TEXT + ROW_SUBTOTAL_FILL color constants; ROW_DATA / ROW_ASSET_HEADING / ROW_SUBTOTAL / ROW_GRAND_TOTAL cell-level style objects (each as { name, num } pair for label + numeric cells); CELL_HEADER (navy fill, white uppercase bold, centered horizontally + vertically) and TABLE_TITLE (display block, fontSize 13, fontWeight 700, marginBottom var(--sp-1)). Internal CELL_BASE sets verticalAlign:'middle' + borderTop/Bottom:'none' so the project-wide `td { border-bottom: 1px solid var(--color-border) }` in app/globals.css line 319 stops painting a striped grid through data rows. **EXTENDED M2.0 Pass 13 2026-05-13 (commit 1c89859):** added `COLUMN_WIDTHS` + `tableMinWidth(periodCount)` helper + `whiteSpace:'nowrap'` on every numeric/header cell token. **REPLACED M2.0 Pass 14 2026-05-13 (commit 18084dd):** fixed-px column widths swapped for percentage-based model. `COLUMN_WIDTHS = { label: '22%' }` + new `nonLabelColumnPct(nonLabelColumnCount)` helper returning `(78 / count).toFixed(4)%`. Every results table renders `<table style={{ width:'100%', tableLayout:'fixed' }}>` with `<colgroup>` of label@22% + N × equal-pct cols. Adding/removing period columns rebalances every non-label column proportionally; label stays at 22%.
    │   │   ├── modules/_shared/periodAxis.ts    # NEW M2.0 Pass 13 2026-05-13 (commit 1c89859), universal period-axis builder. Exports `buildResultsPeriodAxis({ startIso, granularity, numAnnualPeriods, cropAnnualOffset? })` returning `{ priorLabel, activeLabels, labels, count }`. **SIMPLIFIED M2.0 Pass 14 2026-05-13 (commits 5701b19 + db8596e):** `granularity` arg dropped (annual-only until M5 FS); 60-year hard cap removed; caller picks `numAnnualPeriods` from project duration + active-data extent. Consumed by Module1Costs Tab 3 Results + Module1Financing Tab 4 Inputs (Capex Breakdown, Funding Requirement, Debt/Equity Required) + Schedules.
    │   │   ├── modules/_shared/AssetQuickNav.tsx # NEW M2 Pass 9M 2026-05-21 (commit eea1fa6), sticky pill strip rendered at the top of every per-asset surface (M2 Revenue Inputs + Output, M2 CoS, M3 Opex Inputs + Output, M4 Fixed Assets). Pills grouped by strategy bucket (Residential / Hospitality / Retail). Click dispatches `fmp:asset-nav-expand` with the asset id; collapsible parents (PhaseSection / AssetSection / StrategyGroup / StrategyBucket) listen and selectively expand only the section + card that owns the asset, then smooth-scroll to it with an outline pulse. Caller passes `assetIds` prop to each PhaseSection/StrategyBucket so the listener can match.
    │   │   # modules/_shared/GranularityRadioBar.tsx   # DELETED M2.0 Pass 14 2026-05-13 (commit 5701b19), granularity toggle removed across the platform (annual-only basis). M5 Financial Statements will reintroduce a granularity toggle scoped to FS output only. `project.outputGranularity` field is `@deprecated` but stays on schema for back-compat.
    │   │   └── ui/ (InputLabel [NEW M1.10b/3 b8918c8 2026-05-05, reusable label primitive with uppercase label + ⓘ help button + tooltip on hover/focus, aria-describedby + Esc + click-outside dismiss, no external tooltip dep; consumed by all 4 Module 1 tabs + Plot/Parcel wizards], ProjectTimelineVisual [NEW M1.11/2 2026-05-05, horizontal phase timeline bar with 4 semantic dates (Project start / Operations start / Construction end / Project end) + per-phase rows when phases.length > 1; replaces M1.9 single-bar block; subscribes to phases via useShallow], FormulaCaption [NEW M1.13/1 af3d429 2026-05-06, plain-English formula display primitive rendering "= <text>" in small italic meta-color with data-formula="true" + data-testid hook; consumed inline beneath driving inputs across Module1AreaProgram + Module1Timeline + Module1Costs + Module1Financing after M1.13b dissolved the standalone Computed Envelope / Cascade Preview / Timeline Summary panels], AccountingNumberInput [NEW M2.0j Fix 7 2026-05-07; **REWRITTEN M2.0 Pass 12 88affc6 2026-05-13** to format on blur via formatAccounting (commas, parens for negatives, "-" for zero, blank via blankWhenZero). Stays on `type="text"` + `inputMode="decimal"` throughout (no element re-mount on focus); focus reveals raw editable number. Parser handles commas + wrapping parens (negative). Now consumed by every currency / area / period / count input across Tabs 1-4 + ProjectWizard], PercentageInput [NEW M2.0 Pass 12 4c052e3 2026-05-13, parallel to AccountingNumberInput. Blur-formats via formatPercent (2 decimals, "%" suffix, parens for negatives, "0.00%" for zero - percentages never collapse to a dash). Parser strips commas + trailing "%" + wrapping parens. Consumed by every percent input across Tabs 1-4 + ProjectWizard (Method 1/3/4 ratios, Method 2 per-line, Interest %, Facility Share %, fees, LTV covenant, parcel custom Cash/InKind/Roads/Parks, manual phasing distribution, etc.). DSCR covenant stays on AccountingNumberInput - it is a ratio, not a percent])
    │   │   # Module1AreaProgram.tsx (NEW M1.7, 2026-05-02; M1.8 fix 4 4721e80 2026-05-04), store-direct tab between Land & Area and Dev Costs. Plot CRUD + Zone CRUD + per-Asset Strategy / area-cascade overrides + Sub-Unit schedule with parking ratios + live computed envelope panel + per-asset cascade preview + per-plot parking summary card with deficit warning. FAST blue inputs, calc-output gray outputs. data-testid hooks (plot-card, zone-row, asset-strategy, subunit-table, parking-summary, parking-deficit) for Playwright. **Pattern (M1.8 fix 4 4721e80):** subscribes to useModule1Store via base-array selectors (`useModule1Store(s => s.X)`) + useMemo derivations rather than wrapping `s.X.filter(...)` inside `useShallow`, the older pattern returned a fresh array reference per render which tripped React's "getSnapshot should be cached" warning into a Maximum update depth loop once the store had data. Applies to all 6 derive-and-render call sites in this file (Module1AreaProgram top-level + PlotEditor + AssetStrategyRow + AssetAssignPicker + SubUnitTable + ParkingSummary).
    │   │   # Topbar.tsx hosts ☀️/🌙 dark-mode toggle (2026-04-30), own localStorage['refmDarkMode'] key (separate from hub-level modelingDarkMode); default → prefers-color-scheme; theme scoped via body[data-refm-theme="dark"] .app-shell so it never bleeds into /admin or /training.
    │   │   # Sidebar.tsx + Dashboard.tsx (2026-04-30): both surfaces consume MODULES from ../lib/modules-config to eliminate the 1-6 vs 1-11 drift bug. Sidebar derives sidebarModules = [...STATIC_NAV, ...MODULES.map(toSidebarItem)]; Dashboard's Module Roadmap maps MODULES with longLabel + STATUS_BADGE map (4 variants done/soon/pro/enterprise routed through design tokens + color-mix).
    │   │   # OverviewScreen.tsx + ProjectsScreen.tsx + RealEstatePlatform.tsx (2026-04-30): pencil ✏️ Edit Project entry points (Overview header pencil + ProjectsScreen row pencil) gated on can('canEditProject'), wired through new handleEditProject(name, location) callback that mutates active project, syncs state, persists to localStorage refm_v2. Defensive hydration cleanup drops a stale activeProjectId if it doesn't resolve to a real project so Overview no longer silently blanks.
    │   └── lib/
    │       ├── copy/ (plotFieldHelp.ts [NEW M1.10b/5 6b32ee8 2026-05-05, Record<string,string> with 15 keys covering every writable Plot field; shared between inline Plot form + PlotSetupWizard so label drift can't happen], parcelFieldHelp.ts [NEW M1.11/3 2026-05-05, 5 keys (name, area, rate, cashPct, inKindPct); shared between Land tab inline parcel table + ParcelSetupWizard], assetStrategyHelp.ts [NEW M1.11/4 2026-05-05, 6 keys (primaryStrategy, primaryStrategyPct, secondaryStrategy, secondaryStrategyPct, zone, gfaOverride) for Module1AreaProgram strategy + zone + GFA override fields])
    │       ├── export/ (excel-formula, excel-static, pdf)
    │       ├── modules/ (module1-setup(done), module2-6(stubs), module7-11(placeholders))
    │       ├── modules-config.ts     # NEW 2026-04-30, single source of truth for all 11 REFM modules. Exports `MODULES: readonly ModuleConfig[]`, types `ModuleStatus = 'done' | 'soon' | 'pro' | 'enterprise'` and `ModulePlan = 'free' | 'professional' | 'enterprise'`. Per-module fields: num, key, icon, shortLabel (sidebar), longLabel (dashboard), featureKey, requiredPlan, status, disabled, disabledReason. Consumed by both Sidebar.tsx and Dashboard.tsx so adding/renaming/reordering a module requires editing one list. (Phase P-Sync 2026-05-07: this static list now functions as a fallback; the runtime sidebar fetches dynamic data from /api/platforms/refm/modules via usePlatformModules.)
    │       ├── usePlatformModules.ts # NEW Phase P-Sync 2026-05-07. Custom hook that fetches /api/platforms/[platformSlug]/modules at mount and converts each row into SidebarNavItem shape. Falls back to STATIC_SIDEBAR_MODULES (computed from MODULES constant) during inflight or on fetch error so sidebar never renders empty. Sidebar.tsx accepts an optional `modules` prop; RealEstatePlatform passes the dynamic list down.
    │       └── wizard/buildWizardSnapshot.ts     # NEW 2026-05-03 (Phase M1.8/5), pure helper: WizardDraft → HydrateSnapshot. mapWizardToProjectType collapses 6 wizard display values to 3 store ProjectType values; mints 1 SubProject + N Phases + N Plots + 1 Asset per row + 1 placeholder SubUnit per asset bound to Phase 1+Plot 1; sub-unit metric per category (Sell/Operate→count, Lease→area); deduct/efficiency seeds per category (Sell 10/85, Operate 15/80, Lease 5/90, Hybrid 10/85). Stamps `hierarchyDisclosure: 'progressive'` so the Hierarchy tab hides MH when disabled.
    # lib/persistence/module1-sync.ts (2026-05-03 hotfix M1.8 fix 3/3 5085958): NEW exported helper `attachToProjectFromLocalSnapshot(projectId, snapshot)` alongside the existing `attachToProject`. Writes active-id marker + cache + starts the auto-save subscriber WITHOUT calling `loadProject`. Used by the wizard create path where the store already holds the just-POSTed snapshot. Belt-and-braces after M1.8 fix 5 (66a20f5): the underlying recogniser has been relaxed so the round-trip `attachToProject` no longer wipes wizard data, but the local-snapshot path still avoids the redundant network round-trip + hydrate.
    # lib/state/module1-migrate.ts (M1.8 fix 5 66a20f5 2026-05-04): `isNewV3` is now SHAPE-BASED, accepts any payload with assets[] + phases[] + costs[] arrays regardless of `version` discriminator. Why: every snapshot the system POSTs (wizard create, legacy create, auto-save) is bare HydrateSnapshot with no `version: 3` field, and the strict check used to fall through to DEFAULT_MODULE1_STATE on every reload, silently wiping wizard data. v2 snapshots are still routed through migrateLegacyToNew (they have residentialCosts/hospitalityCosts/retailCosts but no flat assets[] / phases[] / costs[], so the relaxed check correctly distinguishes them).
    # lib/state/module1-migrate.ts (M2.0L Fix 1 60128b1 2026-05-11): adds `isLooseSnapshot()` permissive detector (accepts any object with `project` field or any data array) + `migrateLegacyToV8()` that backfills every M2.0g/h/i/j/L additive field with safe defaults, renames legacy `'Hybrid'` strategy to `'Sell + Manage'`, remaps v6 cost-line ids (`site-prep` / `structural` / `mep` / `finishing` / `professional-fees` / etc.) to closest v7 standards, then pipes through the full v7->v8 chain (modelType aggregate, Parking sub-unit fold, phasing normalize, M2.0L phase-scoped id dedupe). Replaces the previous two hard-error fallbacks (`"Unrecognized project shape"` and `"Project schema older than v8"`) with the permissive path. New exported constant `LEGACY_MIGRATION_NOTICE = "Project updated to latest schema, please verify your inputs."` surfaced once via `CheckedHydration.migrationNotice` (existing pipe).
    # lib/state/module1-types.ts (M2.0L Fix 2 db7e578 2026-05-11): new optional `Project.costInputMode?: 'same' | 'individual'` field + `CostInputMode` type + `COST_INPUT_MODES` / `COST_INPUT_MODE_LABELS` exports. Drives Tab 3 layout (Same: one cost table per phase, no asset selector; Individual: per-asset selector + sections).
    # lib/state/module1-types.ts (M2.0 Passes 15-20, 2026-05-13): consolidated Tab 4 / Asset schema additions. **Pass 15 (commit 839e066)**: new optional `Asset.historicalPreCapex` / `historicalDebtAmount` / `historicalEquityAmount` (additive, operational-phase only). **Pass 16 (commit 996f1b1)**: `ParcelFundingConfig.debtPct?` / `equityPct?` added (direct inputs); legacy `fundingType` / `customDebtPct` / `customEquityPct` / `deferredSchedule` marked @deprecated. **Pass 17 (commit 9674bb1)**: `FundingMethodId` narrowed from `1|3|4` to `1|2|3`. Method 2 = Net Funding (was 3); Method 3 = Cash Deficit (was 4). **Pass 18 (commit d729c02)**: `FinancingTranche.ltvPct` + `drawdownMethod` marked @deprecated (Pass 20 engine removes the consumer). **Pass 20 (commit c032f37)**: `FinancingTranche.graceInterestTreatment?: 'capitalize' | 'raise_via_funding' | 'raise_as_debt' | 'pay_from_ocf'` (4 options; was Pass 15's 3-option enum). New tranches default to `'capitalize'`. Legacy `'add_to_funding_need'` migrated to `'raise_via_funding'`.
    # lib/state/module1-migrate.ts (M2.0 Passes 13/15/16/17/20, 2026-05-13): five outermost migrations chained in both stripV8Wrapper + stripWrapper. **migrateM20pass13DropMethod2** (commit 3e41344): forces `fundingMethod===2 → 1`, strips `lineItemRatios` + `debt/equityPctOverride` on every CostOverride. **migrateM20pass15GraceTreatment** (commit 74143d5): backfills `graceInterestTreatment: 'capitalize'` on legacy tranches. **migrateM20pass16LandFundingSimplify** (commit 996f1b1, Pass 18 audit normalisation): maps each `ParcelFundingConfig.fundingType` to direct `debtPct`/`equityPct` (custom_split: `equity = 100 - debt`; 100pct_equity/in_kind/deferred_payment → 0/100; 100pct_debt → 100/0). **migrateM20pass17MethodRenumber** (commit 9674bb1): `fundingMethod: 3 → 2`, `4 → 3`. **migrateM20pass20GraceRename** (commit c032f37): `graceInterestTreatment: 'add_to_funding_need' → 'raise_via_funding'`.
    # components/modules/Module1Financing.tsx (M2.0 Passes 14-20, 2026-05-13, 20 commits): major Tab 4 restructure. **Pass 14**: granularity radio + `subPerYear` removed; data-driven axis (no 60-period cap); column widths via `nonLabelColumnPct(count)`. **Pass 15 (Final Redesign)**: layout reordered (Capex Breakdown to position 7, Funding Requirement at 8, Total Debt/Equity Required at 9-10); compressed Project Financing Settings / Funding Method (3 horizontal cards); LTV wording removed; new `inputsAxis` memo + new Funding Requirement IIFE (3 methods + Selected row) + new Grace Interest Treatment dropdown in TrancheCard + new `historicalPriorTotals` memo. **Pass 16**: Land Funding card collapsed to Debt%/Equity%. **Pass 17**: `fundingMethod` renumber rewrites. **Pass 18**: Capital Structure Overview removed (match chip moved to Funding Basis); `resultsMap` moved below `funding` to derive `precomputedDrawSchedule = funding.debtEquitySplit.debt[offset+i] × facilitySharePct/100`; YoY% editor falls back to `phase.constructionPeriods`; Funding Requirement Methods 2/3 + Selected row render dashes via `isMethodStubbed(m)`. **Pass 19 (commit ae7eb5a)**: `inputsAxis` walks `totals[1..]` mapping `col = i - 1` (was `totals[0..]`); fixes the data-shifted-right + "Dec 24" prior-label off-by-one; in-kind lump placed at `inputsAxis.first + 1` instead of totals-index 0. **Pass 20 (commits 0322515, b15f58b, c032f37, ce2f210)**: Schedules sub-tab rebuilt (5 tables: Debt Movement / Combined Debt Service / Finance Cost / IDC Summary / Equity Movement + filter pill bar; new `schedulesAxis` with operation-end cap + `cropProject` / `cropFacility` helpers; orphan Capital Stack Movement removed); TrancheCard grace dropdown shows 4 options in new order; `m3GraceCapexAdd` renamed `graceFundingCapexAdd` and applied across all 3 funding methods (was Method-2-only); equity cash row no longer subtracts in-kind (`cashEquityRow = [...funding.debtEquitySplit.equity]`).
    # components/modules/Module1ProjectPhases.tsx (M2.0 Pass 15 2026-05-13 commit 839e066): PhaseRow gains "Per-asset Historical Baseline" sub-panel on operational-phase reveal (5-col grid: Name / Pre-Capex / Existing Debt / Existing Equity / validation chip). Chip is green "Balances" when `pre = debt + equity` (within 1 unit), amber "Mismatch" otherwise.
    # core/calculations/index.ts (M2.0 Passes 17/18/20, 2026-05-13): **Pass 17** rewrites every `method === 1/3/4` branch in `computeFunding` + `pickRatio` to `1/2/3`. **Pass 18 (commit dd52bd8)**: `computeFunding` two-rule split applies to ALL three methods (was Method 1 only). For each method: split capex into `nonLandCapex` + `landCashPerPeriod`; size non-land per method-specific logic; route land cash uniformly via `parcelDebtEquityFractions`. **Pass 18 (commit d729c02)**: `computeFinancing` gains optional `precomputedDrawSchedule?: number[]` arg. **Pass 20 (commit b15f58b)**: legacy `switch (tranche.drawdownMethod)` block + dependencies (`ltvPct`, `tranche.principal`, `availabilityPeriods`, `drawdownDistribution`, `drawdownMinCashFloor`, `drawdownIncludeLand`, `drawdownCustomSchedule`) deleted from `computeFinancing`; drawdown derives exclusively from `precomputedDrawSchedule`. **Pass 20 (commit ce2f210)**: `computeEquity` no longer subtracts in-kind from cash equity. `cashPerPeriod[i] = funding.debtEquitySplit.equity[i]` directly; `inKindPerPeriod[0] = landInKindValue` stays as additive memo source. Funding identity: `total_debt + total_cash_equity = capex_excl_in-kind`. Fixes the Dec 26 zero-equity bug.
    # components/modules/Module1Costs.tsx (M2.0L Fix 2 db7e578 2026-05-11): adds `CostInputModeModal` (first-open chooser when `Project.costInputMode` undefined), `SameModeCostTable` (one cost table per phase, edits route directly to `CostLine` via new `editsGoToLine` prop on `CostRow`), cost-input-mode toggle button at top of Tab 3. Individual->Same with active overrides surfaces confirm dialog + clears every `costOverride` row.
    # components/modules/Module1Assets.tsx (M2.0L Fix 3 62b843a 2026-05-11): sub-unit table hides cells per metric. Area mode renders Unit Size + Count as muted dashes; Units mode renders Area as read-only caption `subunit-{id}-area-readout` showing `count x unitArea`. `canSwitchMetric` guard + round-trip preservation unchanged.
    # core/calculations/index.ts (M2.0L Fix 4 47d6f08 2026-05-11): `resolveAssetAreaMetrics` falls back to `asset.buaSqm` / `asset.sellableBuaSqm` when sub-units are empty (was 0). `gfa` cascades `asset.gfaSqm -> hierarchy.gfa -> bua`. `costLineCaption` emits `"<rate> x - (no <X> defined yet) = 0"` for every area / count driven method (BUA / NSA / GFA / Land / NDA / Roads / Support / Parking area / Unit count / Parking bays / specific sub-unit / per-sub-unit rates) when the metric is 0.
    # core/calculations/revenue/escrow.ts (NEW M2 Pass 9h 2026-05-19, commit 87f0075): re-introduced after the M2 Pass 7d removal of the legacy escrow.ts. New design is per-project / per-asset configurable. `computeEscrow({axisLength, heldPct, releaseYearIdx, preSalesCashPerPeriod})` returns held / release / cumulativeBalance / netMovement / cashFlowAdjustment + totals. Methodology anchored to the reference Cashflow v1.16 Escrow tab: held[t] = preSalesCash[t] x heldPct; release lump on configured release year = sum(held[0..releaseIdx]); balance rolls forward and clamps to zero; CF adjustment = release - held (negative during accumulation, positive on release lump). heldPct=0 short-circuits to all-zero output. Exported through revenue/index.ts. Verifier scripts/verify-escrow.ts 31/31.
    # components/modules/Module2Escrow.tsx (NEW M2 Pass 9h 2026-05-19, commit 87f0075): the new 5th Module 2 sub-tab (m2-escrow). 3 collapsible PhaseSection blocks: Inputs (project Held % + project default release year + per-asset Inherit/Override table with Held % override + Release Year override), Schedules (6 output PeriodTable: A Pre-Sales Inflows by Asset / B Held per Asset / C Release per Asset / D Net Movement / E Cumulative Locked Balance project-wide / F CF Impact with Less Held + Add Release + Net Adjustment), Per-Asset Detail (collapsible per-asset roll-forward, default closed). Reads computeEscrowSnapshot via revenue-resolvers; writes via setProject({ escrow }) + updateAsset({ revenue.sell.escrow }). Reference client name never appears anywhere.
    # lib/revenue-resolvers.ts (M2 Pass 9h 2026-05-19, commit 87f0075): added `computeEscrowSnapshot(state, revenueSnap)` + types ProjectEscrowSnapshot + EscrowAssetRow. Walks every Sell + Sell+Manage parent (no companions / pure Operate / Lease — they have no pre-sales cash); resolves effective heldPct (asset override > project default > 0) + effective releaseYear (asset override > project default > handover year computed from phase startDate + constructionPeriods); threads preSalesCashPerPeriod from existing SellAssetResult into computeEscrow; returns per-asset map + project totals + axisLength + yearLabels.
    # lib/state/module1-types.ts (M2 Pass 9h 2026-05-19, commit 87f0075): additive optional `Project.escrow?: { heldPct?: number; defaultReleaseYear?: number }` + `Asset.revenue.sell.escrow?: { heldPctOverride?: number; releaseYearOverride?: number }`. Defaults: heldPct=0 disables escrow; defaultReleaseYear undefined = per-asset handover year fallback. All fields optional so legacy snapshots load identically.
    # components/RealEstatePlatform.tsx (M2 Pass 9h + M4 Pass 1 UI 2026-05-19, commit 87f0075): m2Tabs gains 5th entry { key: 'm2-escrow', icon: '🔒', label: '5. Escrow' }; render switch routes to Module2Escrow. m4Tabs constant added with one entry { key: 'm4-fixed-assets', icon: '🏗️', label: '1. Fixed Assets & D&A' }; new `module4` branch in the activeModule switch wires up Module4FixedAssets. MODULE_TABS map gets a `module4` key so the universal sidebar dropdown picks it up automatically.
    # lib/modules-config.ts (M4 Pass 1 UI 2026-05-19, commit 87f0075): Module 4 status flipped 'soon' -> 'wip', disabled false, disabledReason removed.
    # components/modules/Module3OpexOutput.tsx (M3 Lease Revenue Breakdown fix 2026-05-19, commit 87f0075): lease revenue breakdown table now emits a "Lease Revenue" data row (indent 1) + "Total Revenue" grand-total row, mirroring the Hospitality Rooms/F&B/Other + Total Revenue pattern. Previously the single-stream lease table rendered only the grand-total row which visually broke the rhythm vs the multi-stream hospitality tables.
    # components/modules/Module4FixedAssets.tsx (NEW M4 Pass 1 UI 2026-05-19, commit 87f0075; **rebuilt Pass 1c+d commit 26c221b 2026-05-19**): the Module 4 Fixed Assets surface. **Pass 1c+d** rebuilt asset-level (no phase nesting). New Method dropdown (Straight Line / Reducing Balance) + Useful Life input + Rate input (live when RB selected) at the top of each AssetSection. Three tables per asset: Land Roll-Forward (Opening + Additions = Closing, no dep), Depreciable Assets Roll-Forward (Opening + Additions − Depreciation = Closing + Accumulated Depreciation), Total Fixed Assets (Land + Depreciable closing). Strategy outer section kept (Hospitality / Operations + Retail / Lease) but phase divider dropped — assets list directly under each strategy. Project Total rollup at the bottom with the same three-table shape. Existing-operations Opening Land + Building NBV rendered read-only with a hint to edit on Module 1 Tab 4. Outer wrapper uses width:100% with no maxWidth on description paragraphs per [[feedback_full_width_tabs]]. Module 4 first surface. Consumes computeAllFixedAssetResults (from fixed-assets-resolvers.ts shipped in commit 1b5e9b9). Strategy-first wrapper: outer PhaseSection per strategy (Hospitality / Operations + Retail / Lease), nested PhaseDivider per phase, collapsible AssetSection per asset. Per-asset roll-forward PeriodTable: Opening NBV (last col aggregation) + Additions total + Land (sub-row, non-depreciable) + Depreciable basis (sub-row) + (-) Depreciation + Closing NBV (last col, grand total) + Accumulated Depreciation (last col). Closing project rollup PhaseSection (__project__) with the same shape for project totals. No engine changes; pure read.
    # core/calculations/depreciation/ (NEW M4 Pass 1 2026-05-19, commit 1b5e9b9; **refactored Pass 1c+d commit 26c221b 2026-05-19**): **Pass 1c+d** dropped Land from the engine (engine handles ONLY depreciable additions + NBV; resolver builds Land roll-forward separately), added Reducing Balance method (`buildReducingBalance(base, rate, startIdx, axisLength, life)` returns nbv × rate per period with optional life-cap window). DepreciationMethod = 'straight_line' | 'reducing_balance'. AssetFixedAssetConfig adds `method?` + `reducingBalanceRate?`. Default RB rate = 2/usefulLifeYears (double-declining convention) when no custom rate supplied. AssetFixedAssetResult exposes `method` + `effectiveRate` for UI surfacing. Vintage handling preserved for both methods (each addition opens its own stream from max(t, startIdx)). Verifier extended to 82/82 (J/K/L sections cover RB).
    # lib/fixed-assets-resolvers.ts (M4 Pass 1c+d 2026-05-19, commit 26c221b; **M4 Pass 2W 2026-05-24**): refactored to compose Land + Depreciable separately. `LandRollForward { openingPerPeriod, additionsPerPeriod, closingPerPeriod, openingAtAxisStart, totalAdditions, closingAtAxisEnd }` exposed alongside the engine's depreciable result. `AssetFixedAssetRow` now carries `land + depreciable + combinedOpeningPerPeriod + combinedClosingPerPeriod + usefulLifeYears`. `ProjectFixedAssetSnapshot.projectTotals` exposes `land + depreciable + combinedOpening/Closing`. Threads `asset.depreciationMethod` + `asset.depreciationRate` into the engine. **Pass 2W**: `projectOntoAxis` rule changed `projIdx = i === 0 ? offset - 1 : offset + i - 1` → `projIdx = i === 0 ? Math.max(0, offset - 1) : offset + i - 1` so Phase 1's (offset=0) Y0 lump lands at axis Y0 instead of being dropped at projIdx=-1; symmetric with the equity engine's in-kind stamping. Closed the user-reported ~1.4M BS imbalance during construction years.
    # lib/financials-resolvers.ts (M4 Pass 2 series 2026-05-20 → **Pass 2Z 2026-05-24**): M4 composer. `computeFinancialsSnapshot(state)` pulls every upstream engine (revenue / opex / AP / escrow / fixed assets / financing) and produces P&L + Direct CF + Indirect CF + BS + IDC allocation + cashSweep + dividends. **Pass 2O**: extracted `computeIdcSnapshot(state, financing, ctx)` standalone helper (Module 1 Financing renders IDC without re-composing the full FS pipeline); `AssetIDCRow` carries `depreciationPerPeriod` + `closingNbvPerPeriod` for Op/Lease assets. **Pass 2P**: `ProjectBS.statutoryReserveTransferPerPeriod` + `dividendsPerPeriod` added; CF financing block uses `equityCashArr` (drop in-kind) + `cashFromInv = exclLandInKind` (cash basis); new `equityInKindDrawdownPerPeriod` memo on Direct + Indirect CF. **Pass 2Q**: `AssetIDCRow` gains `physicalLandSqm` + `physicalBuaSqm` (both populated regardless of active basis). **Pass 2R**: `computeFundingGap(snap)` helper + `FundingGapSnapshot` exposing Method 2 (Capex vs Pre-Sales) + Method 3 (Cash Deficit Funding). **Pass 2R-Fix**: Sell asset Inventory capex switched from uniform spread → `computeAssetCost().breakdown.perPeriod` projected onto axis (same offset rule as fixed-assets-resolvers). **Pass 2S**: `computeCashSweep` forward-pass post-processor with per-tranche priority + start-year + sweep-ratio config. **Pass 2T**: refactored `computeCashSweep` → `computeCashWaterfall` returning both `CashSweepSnapshot` + `DividendSnapshot` (before-sweep → cash sweep → after-sweep). **Pass 2T-Fix**: per-phase EBITDA cap on cumulative dividends. **Pass 2U**: `Method3WaterfallSnapshot` with full per-period waterfall. **Pass 2W**: financials-resolvers Sell inventory accumulator gets the `Math.max(0, offset-1)` Phase 1 rescue. **Pass 2Y**: `CashSweepSnapshot.interestSavingsPerPeriod` exposes per-tranche balance reduction × periodic rate (memo only; full P&L mutation deferred).
    # core/calculations/financing/debtEquity.ts (**M4 Pass 2Z 2026-05-24**): `computeDebtEquitySplit` signature gains optional `phases?` + `project?` params. In-kind equity stamping was previously a lump at `inKind[0]` regardless of parcel's phase; now stamped per parcel at `projIdx = Math.max(0, offset - 1)` of the owning phase — symmetric with the asset-side projection rule (capex.ts + fixed-assets-resolvers.ts + financials-resolvers.ts post Pass 2W). Closes the residual BS imbalance for Phase 3+ (offset >= 2).
    # core/calculations/financing/capex.ts (**M4 Pass 2W 2026-05-24**): `aggregateProjectCapex` projection rule `projIdx = i === 0 ? offset - 1 : offset + i - 1` → `projIdx = i === 0 ? Math.max(0, offset - 1) : offset + i - 1`. Same Phase 1 i=0 rescue as fixed-assets-resolvers + financials-resolvers — all three sites carry the symmetric rule so capex outflow + Land/NBV asset booking + equity in-kind stamping align per period.
    # core/calculations/financing/existing.ts (**M4 Pass 2X 2026-05-24**): `buildExistingAggregate` signature gains optional `project?` param. Now skips existing tranches whose `originationYear >= projectStartYear` from `debtOutstandingTotal` + `debtByPhase` — those openingBalances are already routed through `drawSchedule[origIdx]` as in-axis cash inflow (schedule.ts:84-87); previously counting them in the prior-column lump too caused a double-count on the BS prior column.
    # core/calculations/financing/schedule.ts (M4 Pass 2N-Fix series 2026-05-21; **M4 Pass 2O 2026-05-24**): `FacilityResult` gains `interestForAssetBasis` (accounting side, depends on Project.idcConfig.capitalize) + `interestDuringConstruction` (gross stream). `combineDebtService` aggregates `totalInterestForAssetBasis` + derives `totalInterestExpensed = totalInterestAccrued − totalInterestForAssetBasis` (accrual basis). Interest block at line ~252 decoupled: accounting (cap=Y → goes to `interestForAssetBasis`; cap=N → P&L) and funding (debt_drawdown → grows `bal`; cash → `interestPaid`) are independent decisions on `Project.idcConfig`.
    # lib/state/module1-types.ts (M4 Pass 1d 2026-05-19, commit 26c221b): additive optional `Asset.depreciationMethod?: 'straight_line' | 'reducing_balance'` + `Asset.depreciationRate?: number` (RB rate as decimal). Default method 'straight_line'; rate falls back to 2/usefulLifeYears when undefined and method is RB. **M5 2026-06-01:** additive optional `Project.returns?` { discountRate, exitYearOffset, terminalMethod, exitMultiple, perpetuityGrowth } for the Returns module.
    # core/calculations/returns/ (NEW M5 2026-06-01, commit `9095ae7`): pure returns engine, no snapshot/store coupling. `irr.ts` (npv t=0-convention, irr Newton+bisection, moic, paybackPeriod fractional, peakExposure), `terminalValue.ts` (exit-multiple / Gordon perpetuity + terminalEquityValue = EV−debt), `metrics.ts` (yieldOnCost, capRate, profitOnCost, profitMargin, loanToValue, equityMultiple, debtYield, dscrSeries, icrSeries, cashOnCashSeries, each null-guarding its denominator), `index.ts` (`computeReturns(input)` produces IRR/MOIC/NPV/Payback per stream + RE metric block), `types.ts`. Verifier `scripts/verify-returns-engine.ts` (44/44, Excel cross-checked).
    # lib/returns-resolvers.ts (NEW M5 2026-06-01, commit `19f0292`; build-up `1c2d149`): `computeReturnsSnapshot(snap, project)` maps the M4 snapshot onto the engine. Builds 3 signed streams (FCFF = CFO+CFI−inKindLand+terminal EV; FCFE = FCFF+debtDraw−principal−interest+terminal equity; Dividends = −equity in + distributions + terminal equity), the `buildup` component block (step-by-step lines), NOI, terminal values, RE-metric feeders. `resolveReturnsConfig` + `DEFAULT_RETURNS_CONFIG` (10% / exit last year / 8x NOI). Verifier `scripts/verify-returns-snapshot.ts` (30/30).
    # components/modules/Module5Returns.tsx + Module5Metrics.tsx + Module5Shared.tsx (NEW M5 2026-06-01): Returns tab (assumptions panel + IRR/MOIC/NPV/Payback KPIs across FCFF/FCFE/Dividends + per-stream table + signed streams + step-by-step build-up tables) and RE Metrics tab (Yield on Cost, Cap Rate, Dev Spread, Profit on Cost/Margin, Equity Multiple, LTV at Exit, Debt Yield, Min/Avg DSCR, Interest Cover, Cash-on-Cash + per-period coverage ratios). Shared MetricCard/MetricGrid/AssumptionsPanel + fmtPct/fmtX/fmtYears. Wired in RealEstatePlatform (m5Tabs: m5-returns / m5-metrics) + modules-config module5 enabled (disabled→false, soon→wip).
    # core/calculations/financing/funding.ts (**funding Methods 2/3 2026-06-01**, commits `03a18ec` → `7d340fc`): `computeFundingRequirement(capex, financingConfig, gapInputs?)`. Methods 2/3 now calculate (m2/m3 totals from the per-period gap) + read their OWN ratio (netFundingConfig / cashDeficitConfig). GAP-SIZED drawdown: set `customDebt/EquityByPeriod` ONLY when a real gap is fed (gapTotal>0), which sizes debt/equity to the net requirement; else capex fallback (no custom arrays, because an all-zero custom curve trips `useCustom` in debtEquity.ts and zeroes funding). Method 3 gap-sized excludes the min-cash buffer (gap already nets it). `FundingGapInputs` re-exported from `financing/index.ts`; `FinancingContext.fundingGap?` threads it. financials-resolvers `computeFinancialsSnapshot(state, opts?)` feeds the gap via a guarded two-pass (pass 1 capex-sized → computeFundingGap → re-run once with the gap; only Methods 2/3). Verifier `scripts/verify-funding-methods.ts` (45/45). BS balances + Direct==Indirect for all 4 methods.
    # components/modules/Module4BalanceSheet.tsx (**BS AP-link fix 2026-06-01**, commit `cf6200d`): when NOT phase-filtered, the BS-check Accounts Payable LINKS to `snap.ap.projectTotals.closingApPerPeriod` (includes HQ AP) instead of summing per-asset `snap.ap.byAsset` (Operate/Lease only). The per-asset sum omitted HQ AP, so the UI's re-derived BS Check drifted by HQ-opex×DPO/365 (compounding at the inflation rate) while the snapshot itself balanced.
    # lib/revenue-resolvers.ts (M2 Pass 9h release-year fix 2026-05-19, commit 26c221b): computeEscrowSnapshot default release year for an asset = handoverYear + 1 (year AFTER construction completes) instead of handoverYear. Per-asset override > project default > handoverYear + 1.
    # components/modules/Module2Escrow.tsx (M2 Pass 9h release-year + full-width fix, commit 26c221b): help text + Default Release Year placeholder updated to reflect handover + 1 default. Outer wrapper width:100% + maxWidth on description paragraph dropped per [[feedback_full_width_tabs]].
    # core/calculations/depreciation/ (NEW M4 Pass 1 2026-05-19, commit 1b5e9b9): Module 4 Fixed Assets + Depreciation engine. 4 files (types.ts / straightLine.ts / fixedAssets.ts / index.ts). Pure straight-line allocator `buildStraightLine(base, life, startIdx, axisLength)`: returns number[] where indices [startIdx, startIdx+life) carry `base/life`; out-of-axis residual stays as NBV at exit (reference model's net-worth exit convention). `computeAssetFixedAssets(config)`: per-period vintage roll-forward — each depreciable addition opens its own SL stream from `max(t, startIdx)` so post-handover refurb additions depreciate from their own spend year; existing-operations opening NBV is a vintage anchored at idx 0 over remaining life. Roll-forward: `closing[t] = max(0, opening[t] + additionsPerPeriod[t] − depreciationPerPeriod[t])`. Land additions excluded from depreciation base via `additionsLandPerPeriod` (life=0 by convention) but echoed through opening / closing NBV (Land sits on BS as non-depreciable). Methodology mirrors the reference Excel v7.0 Fixed Asset block (10-component opening + addition − depreciation = closing, per-line useful life with Land=0); component split (Land / Hard / Soft only in Pass 1) widens in later passes when Capitalised Interest @ 7 yrs + Pre-Op @ 7 yrs surface as separate streams.
    # lib/fixed-assets-resolvers.ts (NEW M4 Pass 1 2026-05-19, commit 1b5e9b9): bridge between Zustand store + pure depreciation engine. `computeAllFixedAssetResults(state)` walks every Hospitality (Operate) + Retail (Lease) + Sell+Manage companion asset (Sell + Sell+Manage parents excluded — capex flows through M2 CoS instead, never hits BS as Fixed Assets). Capex per-period projection onto project axis uses the same offset rule as `aggregateProjectCapex` (financing/capex.ts): local i=0 -> projIdx = offset − 1 (Phase 1 drops Y0 lump); local i>=1 -> projIdx = offset + i − 1. Threads `breakdown.perPeriod` + `breakdown.perPeriodLandTotal` so the engine separates Land from depreciable additions. Opening NBV reads `asset.historicalPreCapexBuilding` (Pass 56 split; Land seeds non-depreciable basis). Useful life via existing `resolveUsefulLifeYears` + `DEFAULT_USEFUL_LIFE_YEARS` (Hospitality 20 / Retail 25 / Office 25 / Residential 30 / default 25). Returns `ProjectFixedAssetSnapshot { axisLength, projectStartYear, yearLabels, byAsset, projectTotals }`.
    # core/calculations/opex/ (NEW M3 Pass 1 2026-05-18, commit 8884d1b; EXTENDED Pass 3 commit aef0126 2026-05-19 + Pass 4 commit b121b20 2026-05-19): Module 3 Operating Expense engine. 5 files. **Pass 3 (aef0126)** added `defaultIndexation?: IndexationConfig` to AssetOpexInputs + HQOpexInputs, added `useAssetDefault?: boolean` to OpexLine, exported new `defaultOpexIndexation()` helper (3% yoy_compound starting year 0). Engines now skip indexation for any %-of-rev / pct_of_gop line (auto-escalation via revenue) and resolve fixed-cost lines to asset/HQ default unless the line carries useAssetDefault:false. Per-line indexation seeds removed from defaultHospitalityOpexLines / defaultLeaseOpexLines / defaultHQOpexLines; fixed-cost lines born with useAssetDefault:true so legacy snapshots produce identical numbers via the resolver's auto-seed. **Pass 4 (b121b20)** added `rateMode?: 'single' | 'yoy'` + `yoyRates?: number[]` to OpexLine; when rateMode==='yoy' the engine reads yoyRates[t] directly per period and bypasses inflation entirely (same multiplier rules per mode: per_room×keys, per_sqm×sqm, pct_*×revenue, pct_of_gop×gop). Added `repairs_maintenance` to OpexLineCategory. defaultLeaseOpexLines rewrote retail seed to 7-line lite version (Property mgmt / R&M / Insurance / Utilities / Service charge recoverable / Property tax / Reserves). Verifier scripts/verify-opex.ts 38/38 (A/B/C/D/E preserved + F-series Pass 3 inflation rules + G-series Pass 4 YoY rules).
    # lib/opex-resolvers.ts (NEW M3 Pass 2 2026-05-18, commit 8884d1b; UPDATED commit faf16c8 2026-05-18 + Pass 3 commit aef0126 2026-05-19 + Pass 4 commit b121b20 2026-05-19): bridge between Zustand store + M2 revenue snapshot + pure opex engine. computeAllOpexResults(state, revenueSnap) walks every Operate or Lease asset (Sell + Manage parents and pure Sell are skipped — only the companion / pure hospitality / lease side carries opex), builds per-asset OpexRevenueContext (room/F&B/other/total/lease per period sourced from byHospitalityAsset or byLeaseAsset), resolves [opsStartIdx, opsEndIdx] from phase + per-asset operationsStartYearOverride, derives total keys / leasable sqm from M1 sub-units. **Pass 3+** threads `defaultIndexation` (asset-level + HQ-level) into the engines, auto-seeding `defaultOpexIndexation()` when the snapshot has none so legacy data renders identically. **Pass 4+** passes through per-line `rateMode` + `yoyRates` so the engines can honour year-by-year overrides. Returns ProjectOpexSnapshot { byAsset, projectTotals, hq, totalOpexPerPeriodInclHQ }.
    # lib/state/module1-store.ts (UPDATED commit 50a4c89 2026-05-18): updatePhase cascade. When a phase's startDate changes, slides per-period arrays so each asset's data stays anchored to its phase's calendar years. Storage is project-axis-indexed (arr[0] = first project year); computeProjectTimeline derives the axis origin as min(phase startYears). Moving the EARLIEST phase shifts the origin, which would otherwise misalign every OTHER phase's data in absolute terms. Cascade: (1) compute phaseDelta = newPhaseYear - oldPhaseYear; (2) compute originDelta = newOrigin - oldOrigin; (3) shift assets in the changed phase by (phaseDelta - originDelta) so they follow the phase; (4) shift assets in OTHER phases by (-originDelta) to counter the axis origin move; (5) sync project.startDate to the new origin. New shiftAssetPerPeriodArrays helper covers every project-axis array on Asset.revenue (sell sub-unit pre/post velocity, cash + recognition profile percentages, sell/operate/lease indexation growthPerPeriod, operate occupancyPerPeriod, keysParticipationProfile, fb + otherRevenue per-period mode arrays + indexation, lease occupancyPerPeriod) and Asset.opex (every line's indexation.growthPerPeriod).
    # components/modules/Module3Opex.tsx (NEW M3 Pass 2 2026-05-18, commit 8884d1b; EXTENDED commits faf16c8 + 062c168 2026-05-18; **rewritten Pass 3 commit aef0126 2026-05-19 + Pass 4 commit b121b20 2026-05-19**): Inputs tab. **Pass 3** replaced the old 3-pill inline inflation control with a reusable `InflationPanel` (4 pills: Off / Flat / Compound / Per-Year + rate input + per-year strip). Each asset card and the HQ card now lead with an **Asset Inflation** panel that drives every fixed-cost line below it. Line table's Inflation column shows `— auto via revenue` for %-of-rev / pct_of_gop and an **Inherits: <method> <rate>** badge + **Override** button for fixed-cost lines. Override expands a compact per-line InflationPanel; **Use asset default** reverts. Apply-to-strategy now copies both `defaultIndexation` and `lines[]`. **Pass 4** added a per-row **Rate** column with a Single / YoY pill toggle. YoY rows replace the Value input with `↓ year-by-year` and expand a per-period rate strip below (currency or % depending on mode); the Inflation cell shows `— supplied by YoY rates`. Added `repairs_maintenance` to the LEASE category dropdown and reordered LEASE_CATEGORIES + CATEGORY_LABELS for the new retail-lite seed.
    # components/modules/Module3OpexOutput.tsx (NEW M3 Pass 2 2026-05-18, commit 8884d1b; **rewritten Pass 4 commit b121b20 2026-05-19**; **re-skinned Pass 5 commit 9604902 2026-05-19**): Output tab (read-only). **Pass 4** dropped the inline P&L flow + GOP / NOI / margin rows (those compose in M4) and restructured to category-wise tables. Each operating asset section now leads with **Revenue Breakdown** (Hospitality: Rooms / F&B / Other / Total; Retail: Total Lease Revenue) followed by standalone tables per category. Hospitality: Direct Costs · Indirect / Undistributed · Management Fees · Reserves & Other Charges. Retail: Property Operating Costs · Pass-Through / Recoveries (memo) · Other Charges. New `hospBucketFor()` + `leaseBucketFor()` routing helpers map each OpexLineCategory to its section bucket. **Pass 5 (9604902)** re-skinned the output to match Module 2 Revenue / CoS: strategy-first outer `PhaseSection` (Hospitality / Operations + Retail / Lease) with nested `PhaseDivider` per phase and a collapsible `AssetSection` per asset. Project rollup moved into a closing `PhaseSection phaseId="__project__"` and the per-category rollup tables now use strategy section header rows + asset rows + section subtotal + grand total (mirroring `Module2CostOfSales`). No engine changes; `verify-opex` 38/38 still green.
    # lib/state/module1-types.ts (M3 Pass 2 2026-05-18, commit 8884d1b; UPDATED Pass 3 commit aef0126 2026-05-19 + Pass 4 commit b121b20 2026-05-19): Asset.opex / Project.hqOpex shapes. **Pass 3** added optional `defaultIndexation` on each. **Pass 4** added optional `rateMode: 'single' | 'yoy'` + `yoyRates?: number[]` on each line shape. All fields optional so legacy snapshots load identically.
    # lib/modules-config.ts (M3 Pass 2 2026-05-18, commit 8884d1b): Module 3 (OpEx) status flipped 'soon' -> 'wip', disabled false. longLabel 'Operating Expenses & Cash Flow' -> 'Operating Expenses'.
    # components/RealEstatePlatform.tsx (M3 Pass 2 2026-05-18, commit 8884d1b; UPDATED Sidebar Universal commit 7c631f4 2026-05-19): new exported m3Tabs (2 tabs: Inputs + Opex Output). New 'module3' branch in the render switch mirrors module2's tab bar + no-project guard. Imports Module3Opex + Module3OpexOutput. **Sidebar Universal (7c631f4)** added exported `MODULE_TABS: Record<string, ReadonlyArray<SidebarSubTab>>` that maps `module1 → m1Tabs`, `module2 → m2Tabs`, `module3 → m3Tabs`. Sidebar.tsx reads from this map instead of hard-coding `isModule1`/`isModule2` branches, so future modules (M4/M5/M6) just register their tabs here and the sidebar code stays untouched.
    # components/Sidebar.tsx (UPDATED Sidebar Universal commit 7c631f4 2026-05-19): refactored to read sub-tabs from `MODULE_TABS` map exported by RealEstatePlatform. The old `isModule1 || isModule2` + two hard-coded sub-tab render blocks are replaced with a single generic block that walks `MODULE_TABS[mod.key]`. Module 3 now gets the same dropdown UX as M1/M2 with no code changes; same applies to every future module that registers tabs in the map.
    # core/calculations/revenue/ (NEW M2 Pass 2 2026-05-16 commit 8ebaa80, EXTENDED Pass 4 commit 83de2ac): Module 2 Revenue engine. 9 files: types.ts (AssetSellConfig + Cohort + SellAssetResult + ProfileMode 'absolute_with_catchup' | 'relative_to_sale'); indexation.ts (applyIndexation with none / single_rate / yoy_compound / step methods); cohort.ts (shared buildCohortMatrix used by BOTH cash and recognition - absolute-year-with-catchup mechanic where a cohort sold in year N pays/recognizes the cumulative-to-date profile as a catchup lump at N then per profile in later years, matches the reference model rows 46-50 + 181-184); payment.ts (distributeCashCollection wraps cohort.ts with cash profile); recognition.ts (buildRecognition - point_in_time lump at handover or sale_year, or over_time via cohort engine); escrow.ts (buildEscrowMovement - reference-style cumulative hold + full release at trigger year, matches the reference model rows 11-34; engine retained but unused after M2 lock); sell.ts (computeSellAsset orchestrator iterating per cohort when present or single-cohort path otherwise, global cumulativeShareBySubUnit cap so no sub-unit oversells across cohorts + resolveHandoverYear helper); reconcile.ts (7 universal identities: cash-equals-sales totals / recognition-equals-sales totals / escrow-balance identity / held-equals-released / net-cash identity / velocity-sum-bound across cohorts / post-sales alignment - dropped spec's cash-leads-recognition identity since false for PIT with deferred milestones AND over-time when recognition front-loads); index.ts (public exports).
    └── bcm/  bvm/  cfm/  erm/  eum/  fpa/  lbo/  pfm/  svm/   # Coming-soon stubs (config-driven)
```

## `src/features/`, domain-flat features (single-hub or planned cross-hub)

```
src/features/
└── marketing-studio/                 # Training Hub Marketing Studio (rebuild 2026-04-24, mig 142)
    ├── brand.ts                      # loadBrandPack + loadInstructorsByIds
    ├── image-utils.ts                # SERVER-ONLY. fetchAsBase64 + sharp SVG→PNG. Imports `sharp`.
    ├── style-utils.ts                # CLIENT-SAFE pure helpers (lighten/darken/formatSessionDateTime)
    ├── layout.ts                     # Zone-based drag-resize layout system (mergeLayout / rectToStyle / clampRect)
    ├── types.ts                      # AssetType, BrandPack, RenderRequest discriminated union, Instructor, ZoneRect
    └── templates/
        ├── article-banner.tsx        # ArticleBannerTemplate (1200x630)
        ├── linkedin-banner.tsx       # 3 variants: Profile (1584x396), Post (1200x627), Quote (1200x627)
        ├── live-session.tsx          # LiveSessionTemplate (1200x627)
        └── youtube-thumbnail.tsx     # YouTubeThumbnailTemplate (1280x720)
```

## `src/integrations/`, external API clients

```
src/integrations/
├── anthropic/                        # (currently empty, direct SDK use today; centralize here when reused across features)
├── resend/                           # (currently empty; vestigial folder, kept until ARCHITECTURE.md tree is swept. Brevo SDK is used directly from @shared/email/sendEmail.ts as of 2026-05-11, commit `166a8ec`.)
├── teams/teamsMeetings.ts            # Microsoft Graph client. createCalendarEventWithMeeting / updateCalendarEvent / deleteCalendarEvent + legacy onlineMeetings fallback. Requires AZURE_TENANT_ID, AZURE_CLIENT_ID, AZURE_CLIENT_SECRET, TEAMS_HOST_USER_EMAIL.
└── youtube/                          # (currently empty, direct fetch today; centralize when reused)
```

## `src/core/`, pure business primitives (no I/O, no framework)

```
src/core/
├── branding/index.ts                 # Branding type + defaults
├── calculations/index.ts             # Pure financial calculations
├── db/supabase.ts                    # Supabase client factories (serverClient + browser anon)
├── env/                              # (currently empty, env-var loaders go here)
├── formatters/index.ts               # Pure number/date/string formatters
├── state/index.ts                    # Pure state shapes (Zustand store types)
└── types/                            # branding.types.ts  deck.types.ts  next-auth.d.ts  project.types.ts  revenue.types.ts  scenario.types.ts  settings.types.ts
```

## `tests/`, Playwright e2e specs + screenshots

```
tests/
├── e2e/
│   ├── m17-area-program.spec.ts             # M1.7 verifier UI section (sign-in screenshots + /refm gate)
│   ├── m18-wizard.spec.ts                   # M1.8 verifier UI section + 3 documented test.skip authed-session specs
│   ├── m18-wizard-repro.spec.ts             # NEW 2026-05-04 (M1.8 fix 4 4721e80), wizard create regression-guard. Asserts no console.error / no React boundary fallback / Area Program tab mounts after wizard create.
│   ├── m18-wizard-flow.spec.ts              # NEW 2026-05-04 (M1.8 fix 5 66a20f5), every Module 1 tab shows wizard data (no re-prompts) + cross-tab edits propagate via shared store + reload-persists wizard data via direct window.__module1Store inspection. Catches systemic hydration wipes that the `isNewV3` recogniser used to cause.
│   ├── m19-redesign-flow.spec.ts            # NEW 2026-05-04 (M1.9 redesign), 2 specs: wizard with country=UAE (auto-AED) + construction/operations/overlap timing lands on Schedule tab + asserts numbered 1-6 tab row + duplicate inputs stripped from Schedule and Land tabs; light + dark screenshots into tests/screenshots/M1.9/
│   ├── m19b-redesign-flow.spec.ts           # NEW 2026-05-05 (M1.9b polish), 2 specs: Hierarchy dissolved (1->5 tabs) + Project Structure tree nested under Schedule + Asset & Sub-Unit Editor nested under Build Program + D7/D8 disambiguation labels + What-goes-here callouts on all 5 tabs; light + dark screenshots into tests/screenshots/M1.9b/
│   ├── m110-flow.spec.ts                    # NEW 2026-05-05 (M1.10 setup-completeness), 3 specs: Mixed-Use wizard lands clean (no 0% allocation badge, no Over FAR badge, reconciliation row visible) + PlotSetupWizard 4-step walkthrough + ParcelSetupWizard 2-step walkthrough; screenshots into tests/screenshots/M1.10/
│   ├── m110b-flow.spec.ts                   # NEW 2026-05-05 (M1.10b Plot Setup polish), 2 specs: Plot Setup Wizard portal regression guard (scroll to bottom of Build Program, open wizard, assert bounding box centered in 1440x900 viewport, focus help icon, assert tooltip visible, press Esc, assert dismissal) + inline Plot form references all 15 writable-field labels + light/dark hover-driven tooltip screenshots into tests/screenshots/M1.10b/
│   ├── m111-full-flow.spec.ts               # NEW 2026-05-05 (M1.11 holistic re-audit), 2 specs: ProjectWizard portal regression guard (asserts createPortal + viewport-centered bounding box) + wizard create + 5-tab walkthrough using axis = page.locator('[data-testid^="timeline-axis-"]').first() to scope timeline date labels; 10 light + dark screenshots into tests/screenshots/M1.11/
│   ├── m112-flow.spec.ts                    # NEW 2026-05-06 (M1.12 Land tab elimination + 4-tab consolidation), 2 specs: wizard Step 2 parcel CRUD (default seed Land 1 / 100k sqm / 500 / 60-40 split, +Add Parcel, edit area / rate / split, remove, live totals row) + post-create flow asserts the 4-tab row (no "Land" tab) + Build Program Land Parcels block is the canonical CRUD surface; 8 light/dark tab screenshots into tests/screenshots/M1.12/
│   ├── m113-formulas.spec.ts                # NEW 2026-05-06 (M1.13 Module 1 self-explanatory), 1 consolidated spec: walks all 4 tabs asserting FormulaCaption testIds (formula-max-gfa-{id}, cascade-preview-*, timeline-formula-*, cost-formula-*, financing-formula-*) + live recompute (edits Plot Max FAR + Plot Area, asserts Max GFA caption text updates inline within 3s without layout reflow); 8 light/dark tab screenshots into tests/screenshots/M1.13/
│   ├── m113b-formulas-inline.spec.ts        # NEW 2026-05-06 (M1.13b inline-layout polish), 1 spec with two contracts: (1) panel absence (computed-envelope-*, cascade-preview-*, timeline-summary, "Debt Summary (live formulas)" all count == 0) + (2) proximity (assertProximate helper using bounding-box arithmetic verifies each driving input is followed by its FormulaCaption within 0..200 vertical pixels); live recompute reassertion + 8 light/dark tab screenshots into tests/screenshots/M1.13b/
│   ├── m20-full-flow.spec.ts                # NEW 2026-05-06 (M2.0 spec rebuild), 2 specs: 3-step ProjectWizard create + 4-tab landing on Module 1 v5 + 8 light/dark tab screenshots into tests/screenshots/M2.0/
│   ├── m20b-shell.spec.ts                   # NEW 2026-05-06 (M2.0b shell restoration), 4 specs: brand topbar/sidebar/dashboard chrome + dark-mode body-attribute toggle + 3-modal open/close (ProjectModal / VersionModal / ExportModal) + light/dark screenshots into tests/screenshots/M2.0b/. New playwright.config.ts adds baseURL=http://localhost:3000 (overridable via PLAYWRIGHT_BASE_URL).
│   ├── m20c-costs-financing.spec.ts         # SKIPPED 2026-05-06 (frozen v6 contract; 5 specs left .skip()'d as historical artifact, superseded by m20d-costs-polish.spec.ts which validates the per-asset segregated layout introduced by M2.0d).
│   ├── m20d-costs-polish.spec.ts            # NEW 2026-05-06 (M2.0d Costs polish + v7), 7 specs: layout (no sidebar bleed) + Tab 2 Sell+Manage agreement form + Tab 3 per-asset segregation + custom cost popup (stage at create-time) + 3 capex summary tables (Capex by Period, by Stage, by Treatment) + Tab 4 in-kind equity tile + granularity-aware schedule labels + 6 light/dark screenshots into tests/screenshots/M2.0d/
│   ├── m20e-wizard-tab2.spec.ts             # NEW 2026-05-06 (M2.0e wizard simplification + Tab 2 full asset entry), 6 specs: wizard Step 2 unit suffix reactive to modelType + Phase Start Date column auto-default + wizard Step 3 simplified to 6-radio project-type pick + Tab 2 phase grouping + Asset card Phase/Status dropdowns + sub-unit Rate Unit column (per unit / per sqm / per room/night) + light/dark screenshots into tests/screenshots/M2.0e/
│   ├── m20f-structural-fixes.spec.ts        # NEW 2026-05-06 (M2.0f structural fixes), 4 specs: Fix 1 Tab 1 header not clipped + Fix 2 + 6 multi-parcel allocation with per-parcel rates and end-of-period anchor + Fix 3 PROJECT_TYPES catalog expanded to 14 entries (Industrial, Data Center, Education, Healthcare, Marina, Hospitality + Branded Residences, Senior Living, Self-Storage) + Fix 4 + 5 Phase Start Date persistence to Tab 1 + Fix 6 sub-unit BUA as source of truth (asset.buaTotal removed). Light/dark screenshots into tests/screenshots/M2.0f/
│   ├── m20g-display-recon-costs.spec.ts     # NEW 2026-05-06 (M2.0g display + reconciliation + Costs sub-tabs + v8 schema). 5 specs: Fix 3 + Addendum 3 wizard Step 1 Display Scale (full/thousands/millions) + Reporting Granularity replaces Model Granularity, Fix 7 Tab 3 Inputs/Results sub-tabs with 4 summary tables on Results (capex by Period, by Stage, by Treatment, by Cost Type, all with Total in 2nd column), Fix 2 Tab 2 land reconciliation block at top + parcel dropdown defaults to first parcel + Custom Rate option, Fix 4 + 5 Tab 2 asset card asset-level Support/Parking inputs + BUA reconciliation block with itemized breakdown, Addendum 1 Manual % phasing reveals per-period inputs + auto-normalize button. Light/dark screenshots into tests/screenshots/M2.0g/
│   ├── m20h-area-hierarchy-cost-granularity.spec.ts # NEW 2026-05-07 (M2.0h area hierarchy + cost granularity + display cleanup), 6 specs: currency header line + NSA/BUA/GFA hierarchy chips + parcel NDA toggle + per-sub-unit custom rates sub-row + Tab 3 Results granularity toggle + dark-mode screenshot. tests/screenshots/M2.0h/
│   ├── m20i-final-polish.spec.ts            # NEW 2026-05-07 (M2.0i Module 1 final polish), 7 specs + dark-mode: no Model Granularity input (Fix 1) + Display Settings panel (Fix 3) + no Parking Bays input (Fix 5) + sub-unit Units/Area labels (Fix 6) + Strategy short labels (Fix 7) + Land reconciliation compact summary (Fix 9) + operational phase historical baseline (Fix 10). tests/screenshots/M2.0i/
│   ├── psync-flow.spec.ts                   # NEW Phase P-Sync 2026-05-07, 4 specs: /modeling-hub overview platforms grid + /modeling-hub/refm modules grid (or empty-state) + /modeling-hub/refm/project-setup hero + features + cta sections + /api/platforms/refm/modules JSON shape (modules array with project-setup module 1). tests/screenshots/psync/
│   └── m20j-costs-audit.spec.ts             # NEW Phase M2.0j 2026-05-07, 8 specs + dark-mode: Fix 1 Construction Years input min=0 + "Operational from start" caption + Fix 3 Land Parcel rate column header is "{currency}/sqm" + Fix 5 Display Scale propagation to Land Parcel + Fix 6 sub-unit area+units bidirectional sync (count↔area) + Fix 9 cost line phasing dropdown shows only Even + Manual % + Fix 8 + 13 cost line caption with multiplier + no stage label + Fix 14+15 Tab 3 Results shows only Capex by Period table + Fix 16 Inputs sub-tab has asset selector + 3 summary cards. tests/screenshots/M2.0j/
└── screenshots/                             # gitignored, regenerated per Playwright run
```

`tests/screenshots/`, `test-results/`, and `playwright-report/` are gitignored. Snapshot baselines (`tests/snapshots/module1-*-baseline.json`) and fixtures (`tests/fixtures/module1-*.json`) ARE committed.

## `app/test-fixtures/`, dev-only Playwright mount points

```
app/test-fixtures/
└── m18-wizard/page.tsx                      # NEW 2026-05-04, mounts RealEstatePlatform inside a stubbed NextAuth SessionProvider so Playwright skips the production /refm auth gate + Coming-Soon layout guard. Returns notFound() in production builds. Exposes useModule1Store on `window.__module1Store` so specs can read store state directly (more reliable than driving the topbar/sidebar to surface a tab).
```

## `docs/`, internal design + audit notes (not user-facing)

```
docs/
├── MODULE_1_AUDIT_M1.11.md                  # NEW 2026-05-05, comprehensive holistic Module 1 re-audit covering 7 areas (data flow integrity, UX coherence, ProjectTimelineVisual, Land vs Build Program redundancy, calc correctness, first-time user flow, regression check on M1.5b through M1.10b). Catalogues 22 issues (4 Critical / 8 Major / 6 Minor / 4 out-of-scope) and the 12-area fix grouping. Source for the M1.11 fix series.
└── MODULE_1_CAPABILITIES.md                 # First-time-user walkthrough reference; per-tab capabilities summary.
```

## `scripts/`, regression-guard verifiers (one per phase)

```
scripts/
├── module1-snapshot-diff.ts                 # Legacy single-phase, 17.5 KB baseline (frozen, pre-M2.0 v3/v4 era)
├── module1-multiphase-diff.ts               # Multi-phase v4, 23.0 KB baseline (frozen, pre-M2.0 v3/v4 era)
├── module1-areaprogram-diff.ts              # M1.7 Area Program, 2.8 KB baseline (frozen, pre-M2.0 v3/v4 era)
├── module1-v5-diff.ts                       # NEW M2.0 (regenerated through M2.0g), single canonical baseline scripts/baselines/module1-v5.json. 47.8 KB sha256 22923b5275a7 after M2.0g v8 schema bump (was 47.8 KB sha256 824ef8e1706d after M2.0e, 47.6 KB sha256 7418013202fc after M2.0d, 49.6 KB sha256 15ed6f865342 after M2.0c). Replaces the 3 pre-M2.0 baselines (still on disk for excavation but no longer regenerated).
├── verify-m17.ts                            # M1.7 Area Program (25 pass / 0 fail / 2 skip without dev server)
├── verify-m18.ts                            # M1.8 Smart Project Wizard (19 pass / 0 fail / 1 skip without dev server)
├── verify-m19.ts                            # M1.9 UX redesign (16 pass / 0 fail / 2 skip without dev server)
├── verify-m19b.ts                           # M1.9b Hierarchy dissolution + nested mounts (19 pass without dev server / 29 pass with dev server)
├── verify-m110.ts                           # NEW 2026-05-05, M1.10 setup-completeness, 5-section verifier covering plot defaults inside FAR ceiling, platform-layer category-sum allocation derivation, wizard Step 2 1080p fit, Land vs Plot reconciliation row, modal-step Plot + Parcel setup wizards. 25 pass / 0 fail / 1 skip with dev server up.
├── verify-m110b.ts                          # NEW 2026-05-05, M1.10b Plot Setup polish, 5-section verifier covering portal-to-document.body, 15-field reconciliation between inline Plot form and Plot Setup Wizard (section 4b uses .field accessor for verticalParkingFloors so the standalone-block field is recognised alongside the quoted-key numField fields), and InputLabel + tooltip primitive wired into every input across all 5 Module 1 tabs. 18 pass / 0 fail / 0 skip with dev server up.
├── verify-m111.ts                           # NEW 2026-05-05, M1.11 holistic re-audit fix verifier, 5-section verifier covering ProjectWizard portal + step3Valid tolerance, ProjectTimelineVisual mount, Module1Area + RealEstatePlatform dead-setter cleanup + parcelFieldHelp wiring, assetStrategyHelp wiring, Module1Costs + Module1Financing InputLabel coverage. Includes stripCommentLines helper to filter // /* * lines so docstring mentions of removed setters don't false-fail. 23 pass / 0 fail / 1 skip with dev server up.
├── verify-m112.ts                           # NEW 2026-05-06, M1.12 Land tab elimination + 4-tab consolidation, 5-section verifier with section 4 markers F1 (m1Tabs has 4 entries with no 'land' key), F2 (Module1Area unmounted from RealEstatePlatform), F3 (numbered labels renumbered 1-4), P1 (wizard parcel default seed), P2 (Step2LandParcels mounted), P3 (buildWizardSnapshot writes landParcels), B1 (Build Program LandParcelsBlock mount), B2 (FAST contrast constants), C1 (Module1Costs tableHeaderLabelStyle). 21 pass / 0 fail / 0 skip with dev server up; 15 pass / 0 fail / 2 skip without dev server.
├── verify-m113.ts                           # NEW 2026-05-06, M1.13 Module 1 self-explanatory verifier, 5-section verifier with section 4 markers covering FormulaCaption primitive (file existence + data-formula attr + testId hook), per-tab formula testId coverage (Schedule timeline-formula-*, Build Program formula-max-gfa-* + cascade-preview-*, Dev Costs cost-formula-* + cost-grand-total-formula-*, Financing financing-formula-*), em-dash absence sweep across the 4 module files. 23 pass / 0 fail / 0 skip with dev server up.
├── verify-m113b.ts                          # NEW 2026-05-06, M1.13b inline-layout verifier, 5-section verifier with 11 markers (A1-A6 panel-absence assertions on dissolved Computed Envelope / Cascade Preview / Timeline Summary panels + section header testIds + new inline FormulaCaption testIds, S1-S2 Schedule timeline-formula re-anchored to driving inputs, F1-F2 Financing Debt Summary rolled up to clean reckoning + financing-formula testIds, X1 em-dash sweep). 23 pass / 0 fail / 0 skip with dev server up.
├── verify-m20.ts                            # NEW 2026-05-06, M2.0 spec rebuild (v5 hard-cut). 5-section verifier covering schema/types (SCHEMA_VERSION=5..8, AssetStrategy enum, CostMethod enum), v5 baseline diff sha + size, calc helpers (computePhaseTimeline / computeProjectTimeline / periodEndDate), source markers (4 Module 1 tab files), Playwright presence + run gate. Fixture updated through M2.0e (startDate + projectType) and M2.0g (outputGranularity + displayScale). 39 pass / 3 fail / 1 skip without dev server (legacy drift from later phase marker text changes; functional state still verified via verify-m20[d-g]).
├── verify-m20b.ts                           # NEW 2026-05-06, M2.0b shell restoration verifier. 47 source-file markers across Topbar, Sidebar, Dashboard, ProjectsScreen, OverviewScreen, ProjectModal, VersionModal, RbacModal, ExportModal, RealEstatePlatform shell. Em-dash sweep. 51 pass / 0 fail / 2 skip without dev server.
├── verify-m20c.ts                           # NEW 2026-05-06, M2.0c Dev Costs + Financing on v6 verifier. 51 source-file markers, 13-method calc spot-checks, monthly + annual granularity assertions. Loosened SCHEMA_VERSION + COST_METHODS asserts after M2.0d/M2.0g (>= 14 methods, schema accepts v6+) so later schema bumps don't false-fail this earlier verifier. 48 pass / 6 fail / 2 skip without dev server (legacy drift from later phase additions, functional state still verified via verify-m20[d-g]).
├── verify-m20d.ts                           # NEW 2026-05-06, M2.0d Costs polish + v7 verifier. 5 sections: schema (16 assertions), routes + baseline diff, calc unit tests (10 assertions covering deriveCostStage / deriveCostScope / classifyAssetCapex per strategy / computeCashFlowImpact / resolveUsefulLifeYears), 39 source-file markers, em-dash sweep across 7 files, Playwright presence + run gate. 71 pass / 0 fail / 2 skip without dev server.
├── verify-m20e.ts                           # NEW 2026-05-06, M2.0e wizard simplification + Tab 2 full asset entry verifier. 5 sections: schema (10 assertions covering >= 6 ProjectTypes additive precedent), routes + baseline diff (47.8 KB sha 824ef8e1706d at phase close, regenerated to sha 22923b5275a7 after M2.0g v8 bump), calc (9 assertions covering computePhaseTimeline annual + monthly + fallback + computeProjectTimeline min/max), 35 source-file markers, em-dash sweep across 5 files, Playwright presence + run gate. 58 pass / 0 fail / 2 skip without dev server.
├── verify-m20f.ts                           # NEW 2026-05-06, M2.0f structural fixes verifier (closes 6 testing-feedback items: header clipping, multi-parcel allocation per-parcel rates, project type catalog 6→14 entries, Phase Start Date persistence to Tab 1, project end-date off-by-one, sub-unit BUA as source of truth). 5 sections including end-of-period date assertions (year-end on Dec 31, not Jan 1 of next year), AssetLandAllocation mode coverage (single / split / weighted), 14-entry PROJECT_TYPES expansion. 61 pass / 0 fail / 2 skip without dev server.
├── verify-m20g.ts                           # NEW 2026-05-06, M2.0g display + reconciliation + Costs restructure + v8 schema verifier (canonical green). 5 sections covering Display Scale (full/thousands/millions formatScaled + formatScaledCurrency), period end-of-period dates (Dec 31 of last year for annual the reference model shape, the reference model endYear 2038 not 2039), land reconciliation (parcels-sqm / allocated-sqm / status), asset-level Support/Parking inputs + BUA reconciliation block + itemized breakdown, Costs Inputs/Results sub-tabs + 4 summary tables (Total in 2nd column), Manual % phasing per-period inputs + auto-normalize, v8 schema bump (annual-only inputs, outputGranularity replaces modelType, v7 monthly migration aggregates 12→1 to annual). 68 pass / 0 fail / 2 skip without dev server.
├── verify-m20h.ts                           # NEW 2026-05-07, M2.0h area hierarchy + cost granularity + display cleanup verifier (62 pass / 0 fail / 2 skip without dev server).
├── verify-m20i.ts                           # NEW 2026-05-07, M2.0i Module 1 final polish verifier covering 10 fixes (drop modelType, Display Settings, NDA, drop Parking Bays, units/area metric, strategy short labels, sticky sidebar, compact reconciliation, operational baseline). 59 pass / 0 fail / 2 skip without dev server.
├── verify-psync.ts                          # NEW Phase P-Sync 2026-05-07, Platform & Module Admin Sync verifier. 5 sections: 18 SQL marker checks against p_sync_platform_modules.sql + 4 route file checks + smoke against /api/platforms/refm/modules + 20 lib helper / type checks against src/shared/cms/platform-modules.ts + 26 source-file markers across admin pages, sidebar hook, marketing pages, CmsAdminNav + em-dash sweep across 12 new files + Playwright presence/run gate (tests/e2e/psync-flow.spec.ts). 70 pass / 0 fail / 3 skip without dev server.
├── verify-m20j.ts                           # NEW Phase M2.0j 2026-05-07, Module 1 audit + display verifier (canonical green). 5 sections: schema (COST_PHASING_OPTIONS narrowing + normalizeCostPhasing + computePhaseTimeline cp=0 branch), routes + baseline diff (bit-identical), calc helpers (costLineCaption per method + costLineProjectPeriodIndex offset + computeAssetCostSummaryFromBreakdown 3 totals + formatPercent default 2 decimals + formatArea + formatScaledForExport), 49 source-file markers across 10 files + em-dash sweep, Playwright presence + run gate (tests/e2e/m20j-costs-audit.spec.ts). 60 pass / 0 fail / 2 skip without dev server.
├── verify-revenue-rebuild.ts                # Module 2 Revenue engine verifier (Module 2 lock baseline). Covers Sell + Hospitality + Lease + Sell+Manage engines plus AR / Unearned / CoS / reconciliation. Fixture A (synthetic Point-in-Time, 14 assertions including cohort catchup arithmetic at every period). Fixture B (the reference model T2 with 1BR 47,800 sqm @ 33,456 + 2BR 36,497.1 @ 33,505, over-time profile [0.30,0.30,0.30,0.10] - pre-sales total 2,539,827 reference-currency'000 reconciles within 0.0014% on every cell). 133 pass / 0 fail.
├── verify-opex.ts                            # Module 3 Opex engine verifier (Pass 1 baseline 2026-05-18, commit 8884d1b; EXTENDED Pass 3 commit aef0126 + Pass 4 commit b121b20 2026-05-19). **38 / 38**. A/B/C/D/E preserved (the legacy 26 tests; B5 expectation updated for the Pass 4 retail-lite seed; engines now receive `defaultIndexation: defaultOpexIndexation()` so the previous inflation numbers stay identical). **F-series Pass 3 (6)** pins the Pass 3 inflation rules: F1 %-of-rev ignores line indexation, F2 pct_of_gop ignores line indexation, F3 fixed line inherits asset default, F4 per-line override beats default, F5 HQ fixed inherits HQ default, F6 HQ pct_of_total_rev never indexes. **G-series Pass 4 (6)** pins the YoY rate-mode rules: G1 fixed_baseline YoY uses yoyRates[t] directly, G2 per_room_year YoY × keys, G3 pct_of_total_rev YoY × revenue, G4 YoY ignores asset defaultIndexation, G5 HQ fixed_baseline YoY ignores HQ default, G6 pct_of_gop YoY × gop.
└── verify-versioning.ts                      # NEW 2026-05-31 (Phase M-Versioning, commit d25a20b). Pure unit tests for src/hubs/modeling/platforms/refm/lib/persistence/snapshot-diff.ts. **40 / 40**. Sections: A identity (self-diff is empty); B project meta scalar change; C nested project field (project.startDate); D id-keyed array add / remove / update + first-assignment of optional scalar correctly classifies as kind='add'; E nested asset update walks revenue.sell.saleVelocityPct down to the leaf; F costOverrides compound key (assetId::lineId) add + update; G number-array leaf (preSalesVelocityPctPerPeriod) reports as one entry not per-index; H snapshotsEqual mirrors deepEqual; I null-safety (null→snap = single root add, snap→null = single root remove, null→null = empty).
```

## 2026-05-31 session: new files + path adds

REFM platform-infra session shipped 7 commits. New file map:

- **`supabase/migrations/152_refm_version_change_log.sql`** (commit `d25a20b`) — adds `base_version_id uuid` FK + `change_log jsonb` columns to `refm_project_versions`. Idempotent. **NOT YET APPLIED to production Supabase as of 2026-05-31 EOD** — server code tolerates missing columns via fallback path (commits `e2a7ba9` / `988dde5`). Apply manually via dashboard SQL editor when ready.
- **`src/hubs/modeling/platforms/refm/lib/persistence/snapshot-diff.ts`** (commit `d25a20b`) — pure diff lib. Exports `diffSnapshots(before, after): ChangeLogEntry[]` + `snapshotsEqual(a, b): boolean`. id-keyed array matching for phases / parcels / assets / subUnits / costLines / financingTranches / equityContributions. Compound (assetId, lineId) keying for costOverrides. Nested-object recursion. number[] leaves report as single entries.
- **`src/hubs/modeling/platforms/refm/components/modals/NameVersionModal.tsx`** (commit `d25a20b`, refined `7d76bf4`) — two modes: `'start-session'` (no longer auto-triggered; reachable only via manual Save Version button when no session is active) and `'rename'` (default mode triggered by the auto-start banner's Rename button + by topbar Save when a session is already active). Exports `defaultSessionLabel(now?: Date): string` mirroring sync module's helper so banner + modal labels stay in sync.
- **`scripts/verify-versioning.ts`** (commit `d25a20b`) — see verifier list above.

Files MODIFIED in the same session:
- `RealEstatePlatform.tsx`: handleSelectProject / handleCreateFromWizard / boot useEffect reordered to detach-then-hydrate-then-flip-id. Added `isSwitchingProject` overlay (commit `ca5c152`). Added `sessionStartedToast` + `sessionToastTimerRef` listener for `fmp:refm-session-started` (commit `7d76bf4`).
- `lib/persistence/module1-sync.ts`: state machine VIEWING → EDITING with sessionBaseSnapshot / sessionBaseVersionId / editingVersionId tracking. `onStoreChange` auto-starts a session on first edit via `startEditSession(defaultSessionLabel())` (no modal block); `isStartingSession` lock prevents concurrent POSTs. Cross-project save guard in `runAutoSave` after the await (commit `ca5c152` + `7d76bf4`).
- `lib/persistence/server.ts`: schema-tolerant fallback (`VERSION_COLS_FULL` → `VERSION_COLS_BASE` on PG `42703` / PGRST204). Paginated `listVersionsPaginated` walking `.range(from, to)` pages of 1000 up to 50k. `isMissingColumnError` accepts full error object + checks SQL state codes (commits `e2a7ba9` + `988dde5` + `ff96aad`).
- `app/api/refm/projects/[id]/versions/[versionId]/route.ts`: new PATCH handler. Re-loads `existing.base_version_id` server-side and recomputes `change_log` via `diffSnapshots` before persisting; never trusts client-supplied diff.
- `lib/persistence/client.ts`: new `patchVersion()` wrapper. `SaveVersionInput` gains `baseVersionId`.
- `lib/persistence/types.ts`: `RefmProjectVersionRow` + `RefmProjectVersionListItem` gain `base_version_id` + `change_log` fields. New `ChangeLogEntryDTO` interface.
- `components/modals/VersionModal.tsx`: per-version expandable change log + date filter bar (From / To pickers + label search + "Pre-May 30" quick-button + progressive "Show 100 more" reveal; default render limit 50).

## Deleted artifacts (kept for searchability)

- `app/admin/announcements/page.tsx` + `AnnouncementsManager.tsx` + `/api/admin/announcements/`, DELETED 2026-04-27 (commit fd0aabf), orphan stub
- `src/components/admin/PermissionsManager.tsx` + `app/admin/{permissions,overrides,plans}/` + `useSubscription.ts` + `subscription.types.ts`, DELETED 2026-04-27 (commit d8405e5), Permissions removal (Phase 5)
- `src/components/admin/BrandingSettingsPanel.tsx`, DELETED 2026-04-27 (commit ee959ad), orphan
- `app/admin/whitelabel/` + `useWhiteLabel.ts`, DELETED 2026-04-27 (commit a000fbd), White-Label removal
- `src/components/marketing/*` + `src/lib/marketing/*`, DELETED 2026-04-24, Marketing Studio rebuild
- `app/admin/marketing-studio/*`, DELETED 2026-04-24, replaced by `/admin/training-hub/marketing-studio/`
- `src/components/cms/renderCmsText.tsx`, DELETED 2026-04-18, superseded by CmsField
- `src/components/training/SubscribeButton.tsx`, `EngagementBar.tsx`, `PlaylistSidebar.tsx`, legacy components removed during the player rebuild
- `app/admin/login/page.tsx`, `app/admin/login/LoginForm.tsx`, `app/login/page.tsx`, `proxy.ts`, DELETED 2026-04-24, admin auth unification
- `app/api/admin/founder/route.ts`, DELETED 2026-04-18, founder editing now via Page Builder

## Boundary lint rules (Phase 2.7)

`eslint-plugin-boundaries` (`boundaries/dependencies` rule) enforces import direction in `eslint.config.mjs`. Allow-graph: core → core; shared → core/shared/integ; main/training/modeling → core/shared/integ/<self-hub>; platform → core/shared/integ/modeling/platform; feature → core/shared/integ/feature; integ → core/shared; app → any. New cross-hub regressions are caught at lint time. One deferred suppression remains: `src/shared/auth/nextauth.ts` (NextAuth `authorize()` references modeling-hub gates, slated for dependency-inversion refactor).
