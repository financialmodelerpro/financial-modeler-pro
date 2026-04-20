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
├── layout.tsx                   # AdminGuard with AdminProtected child
├── login/page.tsx               # Two-step login UI, navy bg, gold branding, OTP step
├── page.tsx                     # PUBLIC landing page (no auth)
├── dashboard/page.tsx           # Protected entry point -> redirects to /admin/cms
├── announcements/page.tsx
├── articles/page.tsx + [id]/ + new/
├── audit/page.tsx
├── badge-editor/page.tsx
├── branding/page.tsx
├── certificate-editor/page.tsx
├── certificates/page.tsx
├── cms/page.tsx
├── contact/page.tsx
├── content/page.tsx
├── health/page.tsx
# NOTE: app/admin/founder/page.tsx DELETED 2026-04-18 — founder editing moved to Page Builder → Founder section (team)
├── media/page.tsx
├── modules/page.tsx
├── overrides/page.tsx
├── page-builder/page.tsx         # CMS page list
├── page-builder/[slug]/page.tsx  # Section editor with drag-and-drop
├── pages/page.tsx
├── permissions/page.tsx
├── plans/page.tsx
├── pricing/page.tsx
├── projects/page.tsx
├── settings/page.tsx
├── testimonials/page.tsx + modeling/ + training/
├── training/page.tsx + [courseId]/
├── training-hub/page.tsx + analytics/ + assessments/ + certificates/ + live-sessions/ + live-sessions/email-settings/
│   + cohorts/ + communications/ + course-details/ + students/ + instructors/
│   + share-templates/         # Centralized share-text admin (migrations 114-117): Global Mention Settings card + per-template editor with variable-picker chips, hashtag chip editor, active toggle, live preview
│   + daily-roundup/            # Daily certifications roundup: date picker + per-student checklist + live preview + Share Roundup via ShareModal (migration 117 template)
├── training-settings/page.tsx
├── transcript-editor/page.tsx
├── newsletter/page.tsx           # Newsletter admin: 4 tabs (Subscribers, Compose, Campaigns, Auto Notifications)
├── marketing-studio/
│   ├── page.tsx                  # Marketing Studio: template picker + live preview + field editor + AI captions
│   └── brand-kit/page.tsx        # Brand Kit editor: logos, founder photo, colors, fonts
├── users/page.tsx
└── whitelabel/page.tsx
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
├── register/page.tsx            # Server component → RegisterForm or ComingSoon
├── register/RegisterForm.tsx    # Client signup form (extracted)
├── signin/page.tsx              # Server component → ComingSoonWrapper or SignInForm
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
├── live-sessions/[id]/watched/    # POST: record watch, 50 points
├── live-sessions/registration-status-batch/ # POST: batch status
├── watch-history/                 # GET: student watch history (session_watch_history rows)
├── certification-watch/           # GET/POST: certification_watch_history — POST accepts progress fields (watch_seconds/total_seconds/last_position), MAX server-side merge
├── watch-enforcement/             # GET: {enabled, threshold, sessionBypass[tabKey], isAdmin} — powers watch page gating
├── youtube-comments/              # GET: cached YouTube comments (24h DB cache via youtube_comments_cache)
├── certification-watch/           # GET/POST: certification video watch status (in_progress/completed)
├── achievement-image/route.tsx    # GET: dynamic OG achievement card image (satori ImageResponse, sharp SVG→PNG logo)
└── tour-status/route.ts           # POST: toggle training_registrations_meta.tour_completed — one-shot dashboard walkthrough (migration 120)
```

### Admin
```
app/api/admin/
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
├── modeling-coming-soon/        # GET/PATCH: toggle coming soon mode
├── pricing/features/ + modules/ + plans/
├── projects/ testimonials/ training/ + [courseId]/lessons/
├── training-actions/ + [id]/
├── training-hub/ + analytics/ + assessments/ + certificates/
│   + cohorts/ + cohorts/[id]/ + communications/ + student-journey/
│   + student-progress/ + students/
├── live-playlists/              # CRUD for playlists
├── live-sessions/               # GET/POST + PUT banner upload
├── live-sessions/[id]/          # PATCH/DELETE
├── live-sessions/[id]/notify/   # POST: send emails via Resend
├── live-sessions/[id]/registrations/ # GET/PATCH
├── newsletter/subscribers/       # GET: paginated subscriber list with stats
├── newsletter/export/           # GET: CSV download
├── newsletter/send/             # POST: create campaign + fire-and-forget send
├── newsletter/campaigns/        # GET: campaign history
├── newsletter/content-items/    # GET: items from live_sessions/articles for compose auto-populate
├── newsletter/enhance/          # POST: AI rewrite via Anthropic API
├── newsletter/auto-settings/    # GET/PATCH: auto-notification toggles
├── marketing-studio/render/             # POST: render element-based design → PNG via ImageResponse (satori)
├── marketing-studio/generate-caption/   # POST: single-platform caption (legacy Phase 1)
├── marketing-studio/generate-captions/  # POST: multi-platform parallel captions + tone selector
├── marketing-studio/data-sources/       # GET: articles + live_sessions + training sessions for Quick Fill
├── marketing-studio/designs/            # GET (list) + POST (create) saved designs
├── marketing-studio/designs/[id]/       # GET/PATCH/DELETE single design
├── marketing-studio/brand-kit/          # GET/PATCH brand kit singleton
├── watch-enforcement-stats/             # GET: distinct tab_keys in certification_watch_history + per-key stats (for admin dynamic session list)
├── sessions/[tabKey]/reset-watch-progress/ # POST: admin-only nuclear reset — deletes every watch-history row for the session. Routes by prefix: LIVE_<uuid> → session_watch_history; else → certification_watch_history (tab_key match). Paired with red buttons in both session editors. (2026-04-21)
├── generate-images/             # POST: satori+sharp generate mission/vision PNGs → Supabase
├── page-sections/               # CRUD for page_sections + cms_pages
├── reset-attempts/              # POST: reset via Apps Script
├── training-settings/ users/ whitelabel/
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
├── cms/ contact/ cron/session-reminders/ cron/auto-launch-check/ email/send/
# cron/certificates — REMOVED. Certificate issuance is now inline (fire-and-forget from /api/training/submit-assessment when a final-exam submission passes). Admin safety-net at /admin/training-hub/certificates covers any gaps.
# cron/session-reminders — per-registration reminder flag model (migration 122): reads session_registrations.reminder_{24h,1h}_sent; CRON_SECRET bearer auth.
# cron/auto-launch-check — (disabled UI) flips {hub}_coming_soon='false' + one-shot auto_launch='false' when launch_date <= now(). Gated by AUTO_LAUNCH_UI_ENABLED=false in LaunchStatusCard; Vercel Hobby only supports daily crons so vercel.json entry was rolled back.
├── export/excel/ + pdf/
├── health/ modeling/submit-testimonial/
├── permissions/ projects/ qr/
├── t/[token]/pdf/
├── testimonials/ + student/
├── public/training-sessions/      # GET: public list (no auth, no live_url/password)
├── public/training-sessions/[id]/ # GET: public detail (no auth, no live_url/password)
├── training/session-notes/        # GET+POST: per-student notes per session (upsert)
├── newsletter/subscribe/          # POST: hub-segmented subscribe (public, rate-limited)
├── newsletter/unsubscribe/        # GET: per-hub unsubscribe via token (HTML response)
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
│   ├── AnnouncementsManager.tsx  AuditLogViewer.tsx  CmsAdminNav.tsx
│   ├── PermissionsManager.tsx  ProjectsBrowser.tsx
│   ├── RichTextEditor.tsx       # Tiptap full toolbar: headings, alignment, images, links (used ONLY by rich_text section)
│   ├── RichTextarea.tsx         # Tiptap editor + selection-based floating toolbar (B, I, U, S, font size, color presets, lists, link, clear). Enter → new <p>. Used by 17+ CMS text fields. Phase 2A rewrite 2026-04-18.
│   └── SystemHealth.tsx
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
│   ├── BrandingSettingsPanel.tsx  BrandingThemeApplier.tsx
│   ├── PhoneInput.tsx  SessionProviderWrapper.tsx  UpgradePrompt.tsx
│   └── ShareExperienceModal.tsx     # 3-tab testimonial modal for both hubs
├── newsletter/
│   └── NewsletterSubscribeForm.tsx   # Hub checkboxes + email input, shown in SharedFooter
├── marketing/
│   ├── QuickFillPanel.tsx            # Data source picker (Training / Live Session / Article) + Apply to Canvas. Calls /data-sources, invokes autoFillElements()
│   ├── CaptionsPanel.tsx             # Multi-platform caption generator with tone selector, per-platform tabs, copy buttons
│   ├── DesignsSidebar.tsx            # Saved designs grid with lazy-rendered thumbnails + template filter
│   └── canvas/
│       ├── CanvasEditor.tsx          # Drag-and-drop canvas: left (add/layers/history), center (canvas with react-rnd + auto-fit zoom), right (properties). Keyboard shortcuts, undo/redo history stack
│       ├── ElementRenderer.tsx       # Pure visual for text/image/shape CanvasElements
│       └── PropertiesPanel.tsx       # Per-type properties + Background panel when nothing selected
├── shared/
│   ├── FollowPopup.tsx              # Reusable LinkedIn+YouTube follow popup (bottom-right toast)
│   ├── SiteFollowPopup.tsx          # Site-wide 60s popup wrapper
│   └── PreLaunchBanner.tsx          # Slim banner on authed surfaces for Coming-Soon bypass-listed testers (migration 121)
├── training/
│   ├── CountdownTimer.tsx
│   ├── TrainingShell.tsx            # Shared layout (header + sidebar + footer + mobile nav + CMS logo)
│   ├── TrainingShellServer.tsx      # Server wrapper — fetches CMS logo for TrainingShell
│   ├── DashboardTour.tsx            # driver.js interactive walkthrough on first dashboard visit (migration 120). Reads/writes `tour_completed` via POST /api/training/tour-status
│   ├── YouTubePlayer.tsx            # YT IFrame API player — `startSeconds` prop (resume via playerVars.start), onNearEnd (20s), interval-merging `onProgress(watchedSec, totalSec, pos)` via watchTracker, baselineWatchedSeconds seed
│   ├── WatchProgressBar.tsx         # Watch progress bar shown above Mark Complete — %/threshold with color + dashed threshold marker + bypass-aware label
│   ├── SubscribeButton.tsx          # Legacy — unused (replaced by SubscribeModal)
│   ├── SubscribeModal.tsx           # Subscribe modal with YouTube link + ?sub_confirmation=1
│   ├── EngagementBar.tsx            # Legacy — unused (replaced by CourseTopBar)
│   ├── PlaylistSidebar.tsx          # Legacy — unused (replaced by CoursePlayerLayout sidebar)
│   ├── LikeButton.tsx               # "Like on YouTube" link button
│   ├── YouTubeComments.tsx          # Cached YouTube comments with expand/collapse
│   ├── StudentNotes.tsx             # Per-session student notes with bold/bullet toolbar + auto-save
│   ├── WelcomeModal.tsx             # First-visit welcome modal (localStorage, configurable key)
│   ├── player/
│   │   ├── CoursePlayerLayout.tsx   # CFI-style layout: left sidebar + video + right comments panel. `resumePositionSeconds` prop threads through to YouTubePlayer.startSeconds for watch resume.
│   │   ├── CourseTopBar.tsx         # Dark sticky bar: title, actions, Mark Complete, Assessment, Continue
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
│   ├── sendEmail.ts             # Resend wrapper
│   ├── sendTemplatedEmail.ts    # CMS-template email sender (placeholder replacement, batching, branded base)
│   └── templates/ (_base, accountConfirmation, certificateIssued, confirmEmail,
│       deviceVerification, lockedOut, otpVerification, passwordReset,
│       liveSessionNotification, quizResult, registrationConfirmation, resendRegistrationId)
│       newsletter.ts — custom baseLayoutNewsletter() with "Structured Modeling. Real-World Finance." signature
│       ALL template functions are async (use baseLayoutBranded) — callers must await
├── newsletter/
│   └── autoNotify.ts            # sendAutoNewsletter() — fire-and-forget, duplicate prevention, per-event-type toggle
├── marketing/                   # Canvas editor (Phase 1.5) — element-based designs
│   ├── types.ts                 # BrandKit (with array libraries), ImageAsset, CanvasElement (text/image/shape), CanvasBackground, Design, TemplatePreset, MarketingDesign
│   ├── canvasDefaults.ts        # makeTextElement/ImageElement/ShapeElement factories, backgroundToCss, uid
│   ├── presets.ts               # PRESETS array (Phase 3A): 9 FMP-branded platform presets + Blank. PRESET_GROUPS for category-grouped picker. Legacy generic presets preserved for saved-design compat. Uses element-id prefixes (title-, subtitle-, session-, etc.) for Quick Fill + ZIP export matching
│   ├── variants.ts              # VARIANTS array (Phase 3A): 5 template variants — Session Announcement, Quote, Platform Launch, Achievement Spotlight, Article Promo. build(kit, dims) scales elements proportionally to any canvas dimensions
│   ├── autoFill.ts              # autoFillElements() — id-prefix → bucket matching (title/subtitle/session), returns new elements with text content swapped
│   ├── brandKit.ts              # loadBrandKit() — reads singleton row (id=1) incl. additional_logos/photos/uploaded_images, falls back to defaults
│   └── imageToDataUri.ts        # Fetches URL → base64 data URI (sharp SVG→PNG), shared by render route
├── modeling/real-estate/
│   ├── export/ (excel-formula, excel-static, pdf)
│   └── modules/ (module1-setup(done), module2-6(stubs), module7-11(placeholders))
├── shared/
│   ├── audit.ts  auth.ts  captcha.ts  cms.ts (getAllPageSections, getPageSections, getTestimonialsForPage)  deviceTrust.ts
│   ├── emailConfirmation.ts  htmlUtils.ts(isHtml detection)  modelingComingSoon.ts  trainingComingSoon.ts  ogFonts.ts(Inter font loader)
│   ├── comingSoonGuard.ts        # Centralizes signin/register Coming-Soon gate (Training Hub) — checks hub state → bypass list → ?bypass=true query. Used by both /training/signin + /training/register server components.
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
useRequireAuth.ts        useSubscription.ts   useWhiteLabel.ts
```

## `src/types/`
```
branding.types.ts  deck.types.ts  next-auth.d.ts  project.types.ts
revenue.types.ts  scenario.types.ts  settings.types.ts  subscription.types.ts
```

## `src/config/`
```
courses.ts    # Course + session definitions (3SFM, BVM)
platforms.ts  # 10 platform definitions — 1 live (REFM), 9 coming soon
```

## `src/core/`
```
branding.ts  core-calculations.ts  core-formatters.ts  core-state.ts  core-validators.ts
```
