# Routes & Folder Structure

> Referenced from CLAUDE.md — all page routes, API routes, components, and lib structure.

---

## `app/` — Routes by subdomain

### Main Site (`financialmodelerpro.com`)
```
app/
├── (cms)/[slug]/page.tsx        # Dynamic CMS catch-all
├── (portal)/page.tsx            # Home page — CMS Option B (each section from page_sections fed into custom JSX)
├── (portal)/HeroScrollBtn.tsx   # Client scroll button
├── (portal)/FounderExpand.tsx   # Client expand/collapse for founder profile (long bio, experience, philosophy)
├── layout.tsx                   # Root layout, SessionProvider, Inter font
├── globals.css                  # SINGLE SOURCE OF TRUTH for all CSS tokens
├── about/ahmad-din/page.tsx     # Founder profile page — reads from page_sections team content; "Get in Touch" section with email/WhatsApp/LinkedIn/booking
# NOTE: app/about/page.tsx DELETED 2026-04-18 — /about redirects to /about/ahmad-din (next.config.ts)
├── articles/page.tsx
├── articles/[slug]/page.tsx
├── book-a-meeting/page.tsx      # Calendly inline embed (no redirect) via CalendlyEmbed component; reads booking_url from CMS team section
├── contact/page.tsx
├── forgot-password/page.tsx
├── login/page.tsx               # Full admin login UI (200 response, no redirect)
├── portal/page.tsx              # Authenticated app hub (all platforms grid)
├── pricing/page.tsx
├── reset-password/page.tsx
├── settings/page.tsx
├── t/[token]/page.tsx
├── testimonials/submit/page.tsx
├── verify/layout.tsx            # Pins metadataBase + canonical + og:url to LEARN_URL so share previews always show learn.* in the card footer (no main-domain inheritance from root layout)
├── verify/page.tsx              # Verify ID lookup form
├── verify/VerifySearchForm.tsx  # Client lookup form
├── verify/[uuid]/page.tsx       # Certificate public verification — dark gradient hero, NavbarServer, inline Certificate/Badge/Transcript preview grid (4:3 PDF iframe + 1:1 badge img + 3:4 transcript iframe with pre-cache fallback), QR, downloads + Share Certificate
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
├── branding/page.tsx              # 5-line redirect -> /admin/header-settings (2026-04-28, commit ab5db30) — Brand Colors merged into Header Settings. Sidebar entry removed; Header Settings has matchPaths: ['/admin/branding'] so the rail stays highlighted on stale links.
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
# NOTE: app/admin/founder/page.tsx DELETED 2026-04-18 — founder editing moved to Page Builder → Founder section (team)
# NOTE: app/admin/login/page.tsx + LoginForm.tsx DELETED 2026-04-24 — the welcome/intermediate/form chain collapsed into /admin itself. Legacy /admin/login URL is now a 307 in middleware (src/middleware.ts), not a page.
# NOTE: app/login/page.tsx DELETED 2026-04-24 — same: handled by middleware 307 with no-cache headers.
├── media/page.tsx
├── modeling-access/page.tsx       # Modeling Hub access whitelist admin (migration 136): add-email form + per-row Revoke + toggle-state summary. Sidebar nav entry 🔑 Access Whitelist under Modeling Hub.
├── modules/page.tsx                # Modeling Hub modules; two LaunchStatusCards (Sign In + Register, migration 136) + banner linking to /admin/modeling-access at the top.
# NOTE: app/admin/overrides + app/admin/permissions + app/admin/plans DELETED 2026-04-27 (commit d8405e5) — Permissions system removed in Phase 5 of admin cleanup. REFM canAccess() stubs to false until paid tiers go live. Migration 144 drops the underlying tables.
├── page-builder/page.tsx         # CMS page list
├── page-builder/[slug]/page.tsx  # Section editor with drag-and-drop
├── pages/page.tsx
├── pricing/page.tsx                  # 2026-04-28 (commits 50e22fa + 777e1bf): single Platform Pricing surface. Plans tab + Page Content tab + Pricing Features tab + Module Access tab all gone; tab bar removed entirely. Plan-create/edit form, PlanCard sub-component, planFromRow / savePlan / deletePlan / duplicatePlan / user-search effect all deleted. Hero text + FAQ for the public /pricing page are now edited in Page Builder → Pricing.
├── projects/page.tsx
├── settings/page.tsx
├── testimonials/page.tsx + modeling/ + training/
├── training/page.tsx + [courseId]/
├── communications-hub/         # NEW 2026-04-27: unified hub merging the four old comms surfaces. page.tsx (tab dispatcher: campaigns | email-settings | share-templates | newsletter; auth gate; CmsAdminNav with active='/admin/communications-hub') + CampaignsTab.tsx (targeted student emails + history + share-modal copy editor) + EmailSettingsTab.tsx (email_branding + live-session email_templates) + ShareTemplatesTab.tsx (centralized share-text admin: Global Mention Settings card + per-template editor with variable-picker chips, hashtag chip editor, active toggle, live preview) + NewsletterTab.tsx (rebuilt 2026-04-27 — 5 internal sub-tabs: Subscribers / Compose / **Templates (new)** / Campaigns / Auto Notifications. Compose adds template picker + segment dropdown + schedule datetime + Send-test-to-my-inbox button + Schedule-Send vs Send-Now CTA. Templates is the DB-backed editor for newsletter_templates rows. Campaigns row click opens an analytics modal with 6 stat cards, open/click rates, per-recipient table, Retry-N-Failed, Cancel-scheduled, CSV export, Delete.)
├── training-hub/page.tsx + analytics/ (redirects to /admin/analytics 2026-04-24) + assessments/ + certificates/ + live-sessions/ + live-sessions/email-settings/page.tsx (5-line redirect -> /admin/communications-hub?tab=email-settings)
│   + cohorts/ + communications/page.tsx (5-line redirect -> /admin/communications-hub?tab=campaigns) + course-details/ + students/ + instructors/
│   + share-templates/page.tsx (5-line redirect -> /admin/communications-hub?tab=share-templates)
│   + daily-roundup/            # Daily certifications roundup: date picker + per-student checklist + live preview + Share Roundup via ShareModal (migration 117 template)
│   + marketing-studio/         # Training Hub Marketing Studio (rebuild 2026-04-24, migration 142; multi-instructor + drag-resize follow-up commit b0823b9): page.tsx tab shell + LinkedInBannerStudio.tsx (3 variants) + LiveSessionBannerStudio.tsx (auto-fills from live_sessions incl. instructor_id) + YouTubeThumbnailStudio.tsx + ArticleBannerStudio.tsx (auto-fills from articles) + AssetLibrary.tsx (uploads) + studio-shared.tsx (shared primitives incl. useAutoRender 350ms-debounce hook) + InstructorPicker.tsx (multi-select checklist with photo thumbs, name, title, default badge, selection-rank chips) + LayoutEditor.tsx (drag-and-resize zone overlay on the server PNG; move = drag box, resize = drag right edge / bottom edge / SE corner)
├── training-settings/page.tsx
├── transcript-editor/page.tsx     # 5-line redirect -> /admin/certificate-designer?tab=transcript (consolidated 2026-04-24)
├── newsletter/page.tsx           # 5-line redirect -> /admin/communications-hub?tab=newsletter (consolidated 2026-04-27)
# NOTE: app/admin/marketing-studio/* DELETED 2026-04-24 — Phase 1.5 canvas editor (page.tsx + brand-kit/page.tsx) replaced by template-driven Training Hub edition at /admin/training-hub/marketing-studio. Old URL is now a 404 (Modeling Hub will get its own at a different path later).
└── users/page.tsx
# NOTE: app/admin/whitelabel/page.tsx DELETED 2026-04-27 (commit a000fbd) — White-Label feature removed. REFM Topbar reads platform name + logo directly from the branding store (default values).
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
├── dashboard/page.tsx
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

## `app/api/` — API Routes

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
├── certification-watch/           # GET (returns rows with watch_intervals JSONB so the player can hydrate the tracker on mount) + POST. POST body: { student_email, tab_key, course_id, status, watch_seconds?, total_seconds?, last_position?, watch_intervals?, manual_override? }. Server unions incoming + existing JSONB watch_intervals (mig 146) and recomputes watch_seconds from the merged set with a wall-clock rate limit on the new portion. Legacy callers without intervals fall back to MAX(existing, incoming) on the scalar. Stamps video_load_at on first POST (mig 147). On flip to completed: completed_via='threshold' for the auto path (pct >= watch_enforcement_threshold) or 'manual' for the override path (manual_override=true with pct >= 50 AND wall-clock elapsed >= total_seconds * 0.8). 403 with diagnostic info on either gate fail. Video swap auto-detection resets intervals + clears completed_via.
├── watch-enforcement/             # GET: {enabled, threshold, sessionBypass[tabKey], isAdmin} — powers watch page gating
├── youtube-comments/              # GET: cached YouTube comments (24h DB cache via youtube_comments_cache)
├── achievement-image/route.tsx    # GET: dynamic OG achievement card image (satori ImageResponse, sharp SVG→PNG logo)
└── tour-status/route.ts           # POST: toggle training_registrations_meta.tour_completed — one-shot dashboard walkthrough (migration 120)
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
# certificates/settings and certificates/generate — REMOVED. They backed the legacy "Certificate Generation" tile on /admin/certificates which paired with the retired daily cron. Replaced by the inline trigger plus the safety-net panel on /admin/training-hub/certificates.
├── certificates/by-date/        # GET ?date=YYYY-MM-DD → every cert_status='Issued' row for the UTC calendar day (powers Daily Roundup admin page)
├── certificates/pending/        # GET: eligible-but-not-issued list (powers safety-net panel on /admin/training-hub/certificates)
├── certificates/issue-pending/  # POST { email, courseCode } | { all: true } — single-student or bulk issue via issueCertificateForStudent; idempotent via pre-check + unique index
├── certificates/check-eligibility/ # POST { email, courseCode } → full EligibilityResult (passedSessions, missingSessions, watchThresholdMet, reason)
├── certificates/force-issue/    # POST { email, courseCode, nameOverride?, regIdOverride? } — bypasses watch threshold; records issued_via='forced' + issued_by_admin
├── certificates/resend-email/   # POST { certificateId } — rebuilds + resends certificateIssuedTemplate and stamps student_certificates.email_sent_at
├── share-templates/             # GET: list all templates + merged ShareSettings (admin editor)
├── share-templates/[key]/       # PATCH: update single template (title/template_text/hashtags/mention_brand/mention_founder/active)
├── share-templates/settings/    # PATCH: brand_mention / founder_mention / brand_prefix_at / founder_prefix_at — strips leading @ on mention inputs, re-reads full settings after write
├── contact-submissions/ content/ env-check/ media/ modules/ modules/cms-status/ pages/ permissions/
# NOTE: app/api/admin/founder/route.ts DELETED 2026-04-18 — founder data written via /api/admin/page-sections
├── modeling-coming-soon/        # GET/PATCH: legacy single-toggle endpoint (kept for backward compat)
├── modeling-signin-coming-soon/ # GET/PATCH: Modeling Hub signin-side Coming Soon toggle (migration 136)
├── modeling-register-coming-soon/ # GET/PATCH: Modeling Hub register-side Coming Soon toggle (migration 136)
├── modeling-access/             # GET (list entries), POST { email, note } add - modeling_access_whitelist CRUD, admin-gated
├── modeling-access/[id]/        # DELETE: revoke whitelist entry by id
├── pricing/features/                # /api/admin/pricing/plans/ DELETED 2026-04-28 (commit 777e1bf) — Plans tab removed + migration 145 drops pricing_plans table. /api/admin/pricing/modules/ DELETED 2026-04-27 (commit 4a5abe3). Only /api/admin/pricing/features + /coupons + /platform remain.
├── projects/ testimonials/ training/ + [courseId]/lessons/
├── training-actions/ + [id]/
├── training-hub/ + analytics/ + assessments/ + certificates/
│   + cohorts/ + cohorts/[id]/ + communications/ + student-journey/
│   + student-progress/ + students/
│   # student-progress: GET ?email&regId returns { progress, watch }. Phase 4 / 2026-04-28 extended to read both certification_watch_history + session_watch_history in parallel and return the watch[] alongside the existing progress payload. Powers the Watch Progress table + Force Unlock buttons in the Progress modal on /admin/training-hub/students.
│   # communications/route.ts: 2026-04-23 rewrite - POSTs now send via Resend `batch.send` wrapped in baseLayoutBranded (gold CTA button for URL lines, teal inline links, organizer in description). Previously delegated to Apps Script with no brand layout. Per-recipient success/failure written to training_email_log.status. Tokens {name} / {full_name} / {reg_id} / {email} resolved server-side from training_registrations_meta.
│   # communications dropout groups: common gate (emailConfirmed AND NOT certificateIssued), then neverStarted / stalled (>=1 pass + >=7 days idle) / almostDone (>=65% sessions), no longer uses 80% threshold or distinct-attempt denominator.
├── live-playlists/              # CRUD for playlists
├── live-sessions/               # GET/POST + PUT banner upload
├── live-sessions/[id]/          # PATCH/DELETE
├── live-sessions/[id]/notify/   # GET: session + recipients[] (for picker modal) + history[], supports ?sendLogId=X to fetch per-recipient log rows (migration 138). POST: send emails via Resend batch API (2026-04-22); seeds announcement_recipient_log rows as 'pending' before the batch fires, UPDATEs each to sent/failed from the response. New POST modes: `recipientEmails: string[]` (explicit picker allowlist / test send), `retrySendLogId: string` (re-attempt failed/bounced rows of a prior dispatch in place). `target: '3sfm'|'bvm'|'all'` now filters via training_enrollments JOIN.
├── live-sessions/[id]/registrations/ # GET/PATCH
├── newsletter/subscribers/       # GET: paginated subscriber list with stats
├── newsletter/export/           # GET: CSV download
├── newsletter/send/             # POST 2026-04-27 rebuild: accepts { subject, body, targetHub, segment, scheduledAt? } OR { templateKey, templateVars, ... }. Inserts campaign row; if scheduledAt set → status='scheduled' for the cron to pick up; else fires void sendCampaign() (fire-and-forget batch send via resend.batch.send, 100/batch, 200ms stagger).
├── newsletter/test-send/        # NEW 2026-04-27. POST: renders subject+body or template, sends one [TEST]-prefixed email to the admin's session email (or supplied toEmail) via newsletter shell. No log row, no batch, no segment query. Powers the "Send to my inbox" Compose button.
├── newsletter/templates/        # NEW 2026-04-27 (migration 143). GET: list every newsletter_templates row + per-event-type variable schema. POST: create new template (template_key, name, subject_template, body_html, event_type?, active?).
├── newsletter/templates/[key]/  # NEW 2026-04-27. PATCH: update name/subject/body/event_type/active. DELETE: drop template by template_key.
├── newsletter/segments/         # NEW 2026-04-27. GET ?segment=X&targetHub=Y returns { count, segments[] } — count is the live recipient count for the Compose UI; segments[] is the metadata for the dropdown (key/label/description per segment).
├── newsletter/campaigns/        # GET: campaign history
├── newsletter/campaigns/[id]/   # NEW 2026-04-27. GET: campaign + recipients[] from newsletter_recipient_log + computed totals (sent/failed/bounced/complained/opened/clicked/pending) + openRate + clickRate. PATCH { action: 'cancel' }: scheduled → cancelled. DELETE: drop campaign (recipient log rows cascade via FK).
├── newsletter/campaigns/[id]/retry/ # NEW 2026-04-27. POST: re-send to every failed/bounced row of the recipient log. Resolves emails back to active subscribers (skips ones who unsubscribed since), passes them to sendCampaign({ recipients: [...] }), then recomputes sent_count/failed_count from the FULL log so totals reflect cumulative successes (sender.ts only counts the retry batch by itself).
├── newsletter/content-items/    # GET: items from live_sessions/articles for compose auto-populate
├── newsletter/enhance/          # POST: AI rewrite via Anthropic API
├── newsletter/auto-settings/    # GET/PATCH: auto-notification toggles
# app/api/admin/marketing-studio/* DELETED 2026-04-24 — Phase 1.5 canvas API routes (render, generate-caption(s), data-sources, designs/[id], brand-kit) all removed. Replaced by:
├── training-hub/marketing-studio/render/         # POST { type, content }: dispatcher returns next/og ImageResponse PNG at the template's fixed dimensions. Loads brand pack + selected instructors (loadInstructorsByIds preserves admin pick order) + their photos in parallel; passes instructors[] + Record<id, base64> to every template. Admin-only.
├── training-hub/marketing-studio/brand/          # GET: resolved BrandPack (logo, primaryColor, default trainer) for client-side preview rendering
├── training-hub/marketing-studio/live-sessions/  # GET: 60 most recent live_sessions for the session picker (Live Session Banner + YouTube Thumbnail editors). Returns instructor_id so the editor can auto-fill the picker with the session's instructor.
├── training-hub/marketing-studio/articles/       # GET: 80 most recent published articles for the Article Banner editor's picker
├── training-hub/marketing-studio/instructors/    # GET: every active instructor row (active=true ordered by display_order). Powers the multi-select InstructorPicker (added 2026-04-24, commit b0823b9).
├── training-hub/marketing-studio/uploads/        # GET (list) + POST (upload PNG/JPEG/WebP, max 10 MB) — writes to marketing-assets bucket + marketing_uploaded_assets table
├── training-hub/marketing-studio/uploads/[id]/   # PATCH (rename) + DELETE (storage + DB cleanup in lockstep)
├── watch-enforcement-stats/             # GET: distinct tab_keys in certification_watch_history + per-key stats (for admin dynamic session list)
├── sessions/[tabKey]/reset-watch-progress/ # POST: admin-only nuclear reset — deletes every watch-history row for the session. Routes by prefix: LIVE_<uuid> → session_watch_history; else → certification_watch_history (tab_key match). Paired with red buttons in both session editors. (2026-04-21)
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
```

### Other API Routes
```
app/api/
├── agents/market-rates/ + research/
├── branding/                      # GET: public, PATCH: admin only
├── cms/ contact/ cron/session-reminders/ cron/auto-launch-check/ cron/newsletter-scheduled/ email/send/
# cron/certificates — REMOVED. Certificate issuance is now inline (fire-and-forget from /api/training/submit-assessment when a final-exam submission passes). Admin safety-net at /admin/training-hub/certificates covers any gaps.
# cron/session-reminders — per-registration reminder flag model (migration 122): reads session_registrations.reminder_{24h,1h}_sent; CRON_SECRET bearer auth.
# cron/auto-launch-check — (disabled UI) flips {hub}_coming_soon='false' + one-shot auto_launch='false' when launch_date <= now(). Gated by AUTO_LAUNCH_UI_ENABLED=false in LaunchStatusCard; Vercel Hobby only supports daily crons so vercel.json entry was rolled back.
# cron/newsletter-scheduled — NEW 2026-04-27. CRON_SECRET bearer auth. Polls newsletter_campaigns WHERE status='scheduled' AND scheduled_at <= now() (limit 20/tick); for each, calls sendCampaign() with the stored subject/body/target_hub/segment. Per-campaign try/catch flips a single failure to status='failed' without aborting the rest of the batch. vercel.json schedule: daily at 07:00 UTC (Hobby tier limit; finer cadence requires Pro). Reuses CRON_SECRET — no new env var.
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
├── newsletter/click/              # NEW 2026-04-27. GET ?msg=<resend_id>&campaign=<id>&url=<encoded>. Public click-tracking redirector. Best-effort UPDATE on newsletter_recipient_log (matched by resend_message_id), then 302 to the decoded url. Always 302s — tracking blip never blocks the user. Rejects non-http(s) URLs. Resend webhook is the canonical click-tracking path; this endpoint is the user-facing redirect.
├── webhooks/resend/               # NEW 2026-04-27. POST. Resend webhook receiver. Verifies Svix-style signature manually using Node crypto.createHmac('sha256', ...) (no svix dep). Headers svix-id / svix-timestamp / svix-signature checked against RESEND_WEBHOOK_SECRET (whsec_<base64>); 5-minute replay window; multi-signature header support. Routes events: email.delivered → stamp sent_at if null; email.opened → opened_at + status='opened'; email.clicked → clicked_at + status='clicked'; email.bounced → status='bounced' + (on hard bounce) flips subscriber status='bounced'; email.complained → status='complained' + flips subscriber status='unsubscribed'. Unknown types are no-ops.
├── og/route.tsx                   # GET: Training Hub OG banner (1200x630, CMS hero, logo)
├── og/modeling/route.tsx          # GET: Modeling Hub OG banner (1200x630, CMS hero, logo)
├── og/main/route.tsx              # GET: Main site OG banner (1200x630, CMS hero, logo)
├── og/certificate/[id]/route.tsx  # GET: Dynamic cert OG image (satori ImageResponse) — student name + course + grade + date + ID + gold seal; used by /verify/[uuid] share previews
├── share-templates/[key]/route.ts # GET: Public template fetch — merges training_settings mention strings + prefix_at toggles into response so client hook renders immediately
└── user/account/ + password/ + profile/
```

---

## `src/components/`
```
src/components/
├── admin/
│   ├── AuditLogViewer.tsx  CmsAdminNav.tsx  ProjectsBrowser.tsx
│   ├── RichTextEditor.tsx       # Tiptap full toolbar: headings, alignment, images, links (used ONLY by rich_text section)
│   ├── RichTextarea.tsx         # Tiptap editor + selection-based floating toolbar (B, I, U, S, font size, color presets, lists, link, clear). Enter → new <p>. Used by 17+ CMS text fields. Phase 2A rewrite 2026-04-18.
│   └── SystemHealth.tsx
# NOTE: AnnouncementsManager.tsx DELETED 2026-04-27 (commit fd0aabf) — orphan stub.
# NOTE: PermissionsManager.tsx DELETED 2026-04-27 (commit d8405e5) — Permissions system removal.
├── cms/
│   ├── CmsField.tsx             # UNIVERSAL CMS TEXT RENDERER (Phase 1). ALL CMS text fields must render via <CmsField>. Handles visibility/align/width/HTML detection/paragraph splitting. See docstring for enforcement rules.
│   ├── SectionRenderer.tsx      # Maps section_type -> component
│   ├── index.ts
│   └── sections/ (Hero, Text, RichText, Image, TextImage, Columns, Cards, Cta, Faq, Stats, List,
│       Testimonials, PricingTable, Video, Banner, Spacer, Embed, Team, Timeline, LogoGrid, Countdown,
│       CmsParagraphs)
│       Every text field renders via CmsField. Array items (cards, testimonials, team, faq, list, timeline, pricing tiers, logo grid)
│       support per-item `visible !== false` filtering (Phase 2B).
│       TextImage: checklist items, background image with padding/position/fit/overlay controls, body field, audience cards.
│       # renderCmsText.tsx DELETED 2026-04-18 — superseded by CmsField
├── booking/
│   └── CalendlyEmbed.tsx        # Inline Calendly booking widget — dynamic script load, guarded. Used by /book-a-meeting.
├── sessions/
│   └── SessionCard.tsx              # Universal live session card (variant: student|public, compact mode, watched badge)
├── landing/
│   ├── AdminEditBar.tsx  ArticleCard.tsx  CategoryFilter.tsx
│   ├── CourseCard.tsx  InlineEdit.tsx  SharedFooter.tsx  VideoPlayer.tsx
├── layout/
│   ├── Navbar.tsx               # Absolute <a> tags; filters visible !== false, sorts by display_order; About removed from DEFAULT_PAGES
│   └── NavbarServer.tsx         # absolutizeHref() for DB hrefs
├── pricing/PricingAccordion.tsx
├── refm/
│   ├── Dashboard.tsx  OverviewScreen.tsx  PlanBadge.tsx
│   ├── ProjectsScreen.tsx  RealEstatePlatform.tsx  Sidebar.tsx  Topbar.tsx
│   ├── modals/ (Export, Project, Rbac, Version)
│   └── modules/ (Module1Area, Module1Costs, Module1Financing, Module1Timeline)
├── shared/
│   ├── BrandingThemeApplier.tsx     # Hydrates branding store + injects --color-primary / --color-secondary into :root
│   ├── PhoneInput.tsx  SessionProviderWrapper.tsx  UpgradePrompt.tsx
│   └── ShareExperienceModal.tsx     # 3-tab testimonial modal for both hubs
# NOTE: BrandingSettingsPanel.tsx DELETED 2026-04-27 (commit ee959ad) — orphan, no importer in tree.
├── newsletter/
│   └── NewsletterSubscribeForm.tsx   # Hub checkboxes + email input, shown in SharedFooter
# NOTE: src/components/marketing/* DELETED 2026-04-24 — Phase 1.5 canvas component tree (QuickFillPanel, CaptionsPanel, DesignsSidebar, canvas/CanvasEditor, canvas/ElementRenderer, canvas/PropertiesPanel) all removed in the Marketing Studio rebuild. New tab components are colocated under app/admin/training-hub/marketing-studio/ instead of in a shared components folder.
├── shared/
│   ├── FollowPopup.tsx              # Reusable LinkedIn+YouTube follow popup (bottom-right toast)
│   ├── SiteFollowPopup.tsx          # Site-wide 60s popup wrapper
│   └── PreLaunchBanner.tsx          # Slim banner on authed surfaces for Coming-Soon bypass-listed testers (migration 121)
├── training/
│   ├── CountdownTimer.tsx
│   ├── TrainingShell.tsx            # Shared layout (header + sidebar + footer + mobile nav + CMS logo)
│   ├── TrainingShellServer.tsx      # Server wrapper — fetches CMS logo for TrainingShell
│   ├── DashboardTour.tsx            # driver.js interactive walkthrough on first dashboard visit (migration 120). Reads/writes `tour_completed` via POST /api/training/tour-status
│   ├── YouTubePlayer.tsx            # YT IFrame API player. `startSeconds` prop (resume via playerVars.start). Interval-merging tracker stored in useRef so prop updates re-seed without remount (mig 146 Phase 2). Accepts `baselineWatchedSeconds` + `initialIntervals` (JSONB hydrated from the watch row). Emits `onProgress(WatchProgressPayload)` with `{ watchedSec, totalSec, currentPos, intervals, force }`; `force=true` on real close events (PAUSED/ENDED/BUFFERING/unmount) so the parent bypasses its POST throttle and the final partial interval lands in the DB. BUFFERING handled as a soft pause; onPlay closes any prior open interval first.
│   ├── WatchProgressBar.tsx         # Re-enabled in Phase 4 / 2026-04-28. Color-coded fill (red < 30, amber 30 to threshold, green at threshold) + dashed vertical threshold marker + bypass-aware copy. Shown above Mark Complete on both watch pages. Three label buckets: < 50% "keep watching", 50-(threshold-1) "auto-unlock at X%, or confirm manually below", >= threshold "ready to mark complete". The component was a no-op return null pre-Phase 4 because the pre-146 tracker had race conditions that made the displayed % unreliable.
│   ├── SubscribeButton.tsx          # Legacy — unused (replaced by SubscribeModal)
│   ├── SubscribeModal.tsx           # Subscribe modal with YouTube link + ?sub_confirmation=1
│   ├── EngagementBar.tsx            # Legacy — unused (replaced by CourseTopBar)
│   ├── PlaylistSidebar.tsx          # Legacy — unused (replaced by CoursePlayerLayout sidebar)
│   ├── LikeButton.tsx               # "Like on YouTube" link button
│   ├── YouTubeComments.tsx          # Cached YouTube comments with expand/collapse
│   ├── StudentNotes.tsx             # Per-session student notes with bold/bullet toolbar + auto-save
│   ├── WelcomeModal.tsx             # First-visit welcome modal (localStorage, configurable key)
│   ├── CalendarDropdown.tsx         # (2026-04-23) Multi-provider Add-to-Calendar button (Google / Outlook / Apple / Yahoo / .ics fallback). Used by dashboard LiveSessionCard + live-session detail register card. Replaces the old single .ics icon download. Organizer baked into description as "Hosted by ..." since no URL provider carries an organizer field. Dropdown closes on outside click + Escape.
│   ├── player/
│   │   ├── CoursePlayerLayout.tsx   # Video + children layout. Session list sidebar was REMOVED 2026-04-23; the "Back to course" navigation now lives in a single button inside CourseTopBar. `topContent` prop renders a block BEFORE banner/title (used by detail page to put the Register/Join card at the top). Runtime ResizeObserver reads main-nav height so the fixed CourseTopBar positions cleanly below it without overlap regardless of nav size (2026-04-24). Video wrapper `max-width: min(100%, calc((100vh - 200px) * 16/9))` keeps the 16:9 frame inside the viewport on standard desktops.
│   │   ├── CourseTopBar.tsx         # Dark bar with `position: fixed; top: topOffset` (measured) + z-index 140 to beat main nav on overlap. Hosts Back button + Subscribe + Like + Ask Question + Share + Mark Complete + Assessment/Continue.
│   │   └── ShareModal.tsx           # Thin forwarder → share/ShareModal (universal)
│   ├── share/
│   │   └── ShareModal.tsx           # UNIVERSAL ShareModal (Training Hub). Textarea preview + platform buttons (LinkedIn/WhatsApp/Twitter/Copy). Uses shareTo() utility internally. Optional cardImageUrl preview + download.
│   └── dashboard/
│       ├── AboutThisCourse.tsx  BvmLockedContent.tsx  CertificateImageCard.tsx
│       ├── CourseContent.tsx  FeedbackModal.tsx  ProfileModal.tsx
│       ├── SessionCard.tsx  ShareModal.tsx  Skeleton.tsx  StatusBadge.tsx
│       ├── FilePreviewModal.tsx  TestimonialModal.tsx  index.ts  types.ts
│       └── LiveSessionsContent.tsx  # Extracted live sessions tab content
└── ui/
    └── ColorPicker.tsx  OfficeColorPicker.tsx  Toaster.tsx
```

## `src/lib/`
```
src/lib/
├── email/
│   ├── sendEmail.ts             # Resend wrapper. Exposes single-email `sendEmail()` + `sendEmailBatch(items)` (2026-04-22) which calls `resend.batch.send([...])`, up to 100 emails per HTTP request / one rate-limit slot per call. Used by the live-session announcement flow.
│   ├── sendTemplatedEmail.ts    # CMS-template email sender (placeholder replacement, batching, branded base)
│   └── templates/ (_base, accountConfirmation, certificateIssued, confirmEmail,
│       deviceVerification, lockedOut, otpVerification, passwordReset,
│       liveSessionNotification, quizResult, registrationConfirmation, resendRegistrationId)
│       newsletter.ts — custom baseLayoutNewsletter() with "Structured Modeling. Real-World Finance." signature
│       ALL template functions are async (use baseLayoutBranded) — callers must await
├── newsletter/
│   ├── autoNotify.ts            # sendAutoNewsletter() — fire-and-forget, duplicate prevention, per-event-type toggle. **2026-04-27 rebuild**: now renders via renderForEvent(eventType, vars) from templates.ts (DB-backed), falls back to a hardcoded fallbackEmail() shell only when no row exists for the event yet (first-run before migration 143 seeds, or after manual deletion). After rendering, hands off to sendCampaign() so auto sends use the same batch + recipient log + retry pipeline as manual sends.
│   ├── sender.ts                # NEW 2026-04-27. sendCampaign() central pipeline used by manual send, scheduled cron, auto-notify, and retry-failed: resolves segment → seeds pending recipient_log rows → 100/batch via resend.batch.send → 200ms stagger → updates each row with returned message_id + status → updates campaign aggregate counts. Optional `recipients` arg short-circuits segment resolution (used by retry). sendTestEmail() is the one-off [TEST]-prefix variant — no log row, no batch, synthetic unsubscribe token.
│   ├── segments.ts              # NEW 2026-04-27. SEGMENTS metadata (key/label/description) + resolveSegment(segment, targetHub) → ResolvedRecipient[] composing the active subscriber set with filter sets from certificate_eligibility_raw, student_certificates, training_assessment_results. countSegment() for the live recipient-count UI display.
│   ├── templates.ts             # NEW 2026-04-27. DB-backed template engine. interpolate('{token}', vars) → empty string for missing tokens. getTemplate(key) / getTemplateByEvent(eventType) / listTemplates() / renderTemplate(tpl, vars) / renderForEvent(eventType, vars). TEMPLATE_VARIABLES const exposes per-event-type token schemas to the admin UI.
│   └── linkWrap.ts              # NEW 2026-04-27. wrapLinks(body, { campaignId, msgIdPlaceholder }) rewrites every <a href> to /api/newsletter/click?msg={msg}&campaign=X&url=encoded; appendUtm() injects utm_source=newsletter / utm_medium=email / utm_campaign=<id> on internal financialmodelerpro.com hosts. Skips mailto:/tel:/javascript:/anchors/unsubscribe URL/click endpoint itself. injectMessageId() helper for per-recipient {msg} swap if the call site has the message id ahead of send.
# NOTE: src/lib/marketing/* DELETED 2026-04-24 — Phase 1.5 canvas types/helpers (types, canvasDefaults, presets, variants, autoFill, brandKit, imageToDataUri) all removed in the Marketing Studio rebuild.
├── marketing-studio/            # Training Hub Marketing Studio (rebuild 2026-04-24, migration 142; multi-instructor + drag-resize follow-up commit b0823b9). Server-side template rendering via next/og ImageResponse — no canvas state.
│   ├── types.ts                 # AssetType, Instructor, BrandPack, RenderRequest discriminated union (linkedin-banner / live-session / youtube-thumbnail / article-banner), DIMENSIONS map per template, UploadedAsset DTO, ZoneRect / LayoutOverrides, resolveInstructors() helper (falls back to brand pack default when no IDs picked). Every banner content type carries `instructorIds: string[]` + `layout?: LayoutOverrides`.
│   ├── brand.ts                 # loadBrandPack() — server-side resolves logo from cms_content.header_settings.logo_url, primaryColor from email_branding, default trainer (name/title/photo/credentials) from instructors WHERE is_default=true. loadInstructorsByIds(ids[]) — fetches active rows by id and preserves admin pick order so banner render order matches the picker.
│   ├── image-utils.ts           # SERVER-ONLY. fetchAsBase64() (URL → base64 data URI for satori; sharp SVG → PNG). Imports `sharp` (Node-native). DO NOT import from a client component — webpack will try to bundle node:child_process / node:crypto and fail. Imported only by the render route.
│   ├── style-utils.ts           # CLIENT-SAFE pure helpers (split from image-utils.ts in commit 0e2129a to fix Vercel build). lighten() / darken() hex helpers used by every template's gradient; formatSessionDateTime() for Live Session banner display. No Node deps. Templates import the helpers from here so client studio editors can also import the templates' LAYOUT_DEFAULTS without dragging sharp into the client bundle.
│   ├── layout.ts                # Zone-based layout system (drag-resize support). TemplateLayout = { canvas, zones (LAYOUT_DEFAULTS per key), descriptors (label + resizable: bool) }. mergeLayout(defaults, overrides) merges admin overrides on top of template defaults — same code-path serves satori (server) and the LayoutEditor drag overlay (client). rectToStyle() converts a rect to absolute-positioning CSS. clampRect() keeps zones inside the canvas during drag.
│   └── templates/
│       ├── linkedin-banner.tsx  # 3 named exports: LinkedInProfileTemplate (1584x396), LinkedInPostTemplate (1200x627), LinkedInQuoteTemplate (1200x627). Refactored to absolute-position movable zones over a fixed background+logo+url scaffold. Each template exports its LAYOUT (LINKEDIN_PROFILE_LAYOUT, LINKEDIN_POST_LAYOUT, LINKEDIN_QUOTE_LAYOUT). TrainerCard renders single big card when length=1 OR strip/badge layout when length≥2.
│       ├── live-session.tsx     # LiveSessionTemplate (1200x627) — pulls badge/title/datetime/duration from content. Exports LIVE_SESSION_LAYOUT with movable zones (headline / metaRow / cta / instructorStrip). Strip renders up to 4 instructor cards in a horizontal row.
│       ├── youtube-thumbnail.tsx # YouTubeThumbnailTemplate (1280x720) — punchy big-type layout. Exports YOUTUBE_THUMB_LAYOUT (badge / title / subtitle / trainerCircle). Uses FIRST picked instructor for the right-third photo circle.
│       └── article-banner.tsx   # ArticleBannerTemplate (1200x630) — editorial layout. Exports ARTICLE_BANNER_LAYOUT (eyebrow / title / authorBadge). Uses FIRST picked instructor as author (or content.author override).
├── integrations/
│   └── teamsMeetings.ts          # Microsoft Graph API client for the Teams calendar event flow. Exposes `createCalendarEventWithMeeting` / `updateCalendarEvent` / `deleteCalendarEvent` (POST/PATCH/DELETE against `/users/{hostId}/events` with `isOnlineMeeting:true` + `onlineMeetingProvider:"teamsForBusiness"`), wrappers `updateMeetingOrEvent` / `deleteMeetingOrEvent` that try `/events` first and fall back to legacy `/onlineMeetings` on 404 for pre-migration session ids, `createTeamsMeeting` / `updateTeamsMeeting` / `deleteTeamsMeeting` (legacy onlineMeetings endpoint, kept for the fallback leg), `toGraphDateTime` helper (UTC ISO → Graph `dateTimeTimeZone` via `sv-SE` locale formatting, `Asia/Karachi` default), and `isTeamsConfigured` / `testTeamsConnection` helpers. Requires env vars `AZURE_TENANT_ID`, `AZURE_CLIENT_ID`, `AZURE_CLIENT_SECRET`, `TEAMS_HOST_USER_EMAIL` + Azure Application permissions `OnlineMeetings.ReadWrite.All`, `User.Read.All`, `Calendars.ReadWrite` all with admin consent.
├── modeling/real-estate/
│   ├── export/ (excel-formula, excel-static, pdf)
│   └── modules/ (module1-setup(done), module2-6(stubs), module7-11(placeholders))
├── shared/
│   ├── audit.ts  auth.ts  captcha.ts  cms.ts (getAllPageSections, getPageSections, getTestimonialsForPage)  deviceTrust.ts
│   ├── emailConfirmation.ts  htmlUtils.ts(isHtml detection)  modelingComingSoon.ts  trainingComingSoon.ts  ogFonts.ts(Inter font loader)
│   ├── modelingAccess.ts         # Modeling Hub access gate (migration 136): isEmailWhitelisted + isEmailAdmin primitives + canEmailSigninModeling / canEmailRegisterModeling high-level checks + listWhitelist (admin UI). All queries are case-insensitive on email. Threaded into /api/auth/register, /api/auth/confirm-email, auth.ts authorize(), and /modeling/register server page's ?email= invite path.
│   ├── comingSoonGuard.ts        # Centralizes signin/register Coming-Soon gate (Training Hub) - checks hub state → bypass list → ?bypass=true query. Used by both /training/signin + /training/register server components.
│   ├── hubBypassList.ts          # isIdentifierAllowed(identifier) reads training_settings.training_hub_bypass_list (migration 121), case-insensitive, matches email OR registration_id.
│   ├── password.ts  permissions.ts  storage.ts  supabase.ts  urls.ts
└── training/
    ├── appsScript.ts  certificateEngine.ts  certificateLayout.ts  certifier.ts(deprecated)
    ├── share.ts                 # Universal share utility: shareTo(platform, options), FMP_HASHTAGS, FMP_TRAINING_URL. LinkedIn always opens plain feed composer (no share-offsite URL auto-attach). Auto-copy-then-open pattern.
    ├── shareTemplates.ts        # Share template render engine (migrations 114-117): ShareTemplate + ShareSettings types, renderShareTemplate(template, vars) pure function, resolveCourseName() (COURSES short-code → full title), formatShareDate() (canonical en-GB long form), DEFAULT_TEMPLATES offline fallback, SAMPLE_VARS + TEMPLATE_VARIABLES for admin preview + variable picker
    ├── useShareTemplate.ts      # Client hook — module-level cache + in-flight dedup; initial render from DEFAULT_TEMPLATES, DB swaps in when fetch resolves. Returns ShareTemplate with brand_mention/founder_mention/prefix_at fields merged in by the API layer
    ├── watchTracker.ts           # Interval-merging playback tracker — onPlay/onTick/onClose; seeking cannot inflate counts
    ├── watchThresholdVerifier.ts # verifyWatchThresholdMet(email, courseCode) — gates cert issuance per course+session
    ├── detectVideoChange.ts      # detectVideoChange(existingTotal, incomingTotal) → verdict; abs diff > 30s AND relative diff > 10% flags a video swap. Used by both watch endpoints to reset stale progress when the admin replaces a YouTube URL (2026-04-21).
    ├── sessionAnnouncement.ts    # Centralizes announce-on-publish / manual-announce / reminder email build for live sessions so cron, admin /notify, and register endpoint don't drift.
    ├── sheets.ts  training-session.ts  videoTimer.ts
```

## `src/hooks/`
```
useInactivityLogout.ts   useProject.ts   useRequireAdmin.ts
useRequireAuth.ts
```
# NOTE: useSubscription.ts DELETED 2026-04-27 (commit d8405e5) — Permissions removal.
# NOTE: useWhiteLabel.ts DELETED 2026-04-27 (commit a000fbd) — White-Label removal. Topbar reads platform name + logo directly from the branding store.

## `src/types/`
```
branding.types.ts  deck.types.ts  next-auth.d.ts  project.types.ts
revenue.types.ts  scenario.types.ts  settings.types.ts
```
# NOTE: subscription.types.ts DELETED 2026-04-27 (commit d8405e5) — Permissions removal. Plan-name unions inlined where still needed (ExportModal, UpgradePrompt).

## `src/config/`
```
courses.ts    # Course + session definitions (3SFM, BVM)
platforms.ts  # 10 platform definitions — 1 live (REFM), 9 coming soon
```

## `src/core/`
```
branding.ts  core-calculations.ts  core-formatters.ts  core-state.ts  core-validators.ts
```
