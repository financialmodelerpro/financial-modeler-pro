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
├── about/page.tsx
├── about/ahmad-din/page.tsx     # Founder profile page — reads from page_sections team content
├── articles/page.tsx
├── articles/[slug]/page.tsx
├── book-a-meeting/page.tsx      # Professional booking redirect page (reads booking_url from CMS)
├── confidentiality/page.tsx
├── contact/page.tsx
├── forgot-password/page.tsx
├── login/page.tsx               # Full admin login UI (200 response, no redirect)
├── portal/page.tsx              # Authenticated app hub (all platforms grid)
├── pricing/page.tsx
├── privacy-policy/page.tsx
├── reset-password/page.tsx
├── settings/page.tsx
├── t/[token]/page.tsx
├── testimonials/submit/page.tsx
└── verify/[uuid]/page.tsx       # Certificate public verification
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
├── founder/page.tsx
├── health/page.tsx
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
│   + cohorts/ + communications/ + course-details/ + students/
├── training-settings/page.tsx
├── transcript-editor/page.tsx
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
├── youtube-comments/              # GET: cached YouTube comments (24h DB cache via youtube_comments_cache)
├── certification-watch/           # GET/POST: certification video watch status (in_progress/completed)
└── achievement-image/route.tsx    # GET: dynamic OG achievement card image (satori ImageResponse, sharp SVG→PNG logo)
```

### Admin
```
app/api/admin/
├── announcements/ articles/ asset-types/ audit-log/
├── assessments/ + attempts/ + questions/
├── badge-layout/                # GET/POST badge field positions
├── badge-preview/               # POST: generate badge PNG preview
├── certificate-layout/ certificates/sync/ certificates/upload-template/
├── certificates/settings/       # GET/POST auto_generation_enabled
├── certificates/generate/       # POST: trigger processPendingCertificates()
├── contact-submissions/ content/ env-check/ founder/ media/ modules/ modules/cms-status/ pages/ permissions/
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
├── cms/ contact/ cron/certificates/ cron/session-reminders/ email/send/
├── export/excel/ + pdf/
├── health/ modeling/submit-testimonial/
├── permissions/ projects/ qr/
├── t/[token]/pdf/
├── testimonials/ + student/
├── public/training-sessions/      # GET: public list (no auth, no live_url/password)
├── public/training-sessions/[id]/ # GET: public detail (no auth, no live_url/password)
├── training/session-notes/        # GET+POST: per-student notes per session (upsert)
├── og/route.tsx                   # GET: Training Hub OG banner (1200x630, CMS hero, logo)
├── og/modeling/route.tsx          # GET: Modeling Hub OG banner (1200x630, CMS hero, logo)
├── og/main/route.tsx              # GET: Main site OG banner (1200x630, CMS hero, logo)
└── user/account/ + password/ + profile/
```

---

## `src/components/`
```
src/components/
├── admin/
│   ├── AnnouncementsManager.tsx  AuditLogViewer.tsx  CmsAdminNav.tsx
│   ├── PermissionsManager.tsx  ProjectsBrowser.tsx
│   ├── RichTextEditor.tsx       # Tiptap: headings, alignment, images, links
│   └── SystemHealth.tsx
├── cms/
│   ├── SectionRenderer.tsx      # Maps section_type -> component
│   ├── index.ts
│   └── sections/ (Hero, Text, RichText, Image, TextImage, Columns, Cards, Cta, Faq, Stats, List,
│       Testimonials, PricingTable, Video, Banner, Spacer, Embed, Team, Timeline, LogoGrid, Countdown,
│       CmsParagraphs)
│       All sections support per-field visibility (content.fieldName_visible !== false)
│       CmsParagraphs: shared paragraph renderer supporting string[] and {text,align}[] formats
│       TextImage: checklist items, background image with padding/position/fit/overlay controls, body field, audience cards
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
├── shared/
│   ├── FollowPopup.tsx              # Reusable LinkedIn+YouTube follow popup (bottom-right toast)
│   └── SiteFollowPopup.tsx          # Site-wide 60s popup wrapper
├── training/
│   ├── CountdownTimer.tsx
│   ├── TrainingShell.tsx            # Shared layout (header + sidebar + footer + mobile nav + CMS logo)
│   ├── TrainingShellServer.tsx      # Server wrapper — fetches CMS logo for TrainingShell
│   ├── YouTubePlayer.tsx            # YT IFrame API player with onNearEnd (20s) + watch tracking
│   ├── SubscribeButton.tsx          # Legacy — unused (replaced by SubscribeModal)
│   ├── SubscribeModal.tsx           # Subscribe modal with YouTube link + ?sub_confirmation=1
│   ├── EngagementBar.tsx            # Legacy — unused (replaced by CourseTopBar)
│   ├── PlaylistSidebar.tsx          # Legacy — unused (replaced by CoursePlayerLayout sidebar)
│   ├── LikeButton.tsx               # "Like on YouTube" link button
│   ├── YouTubeComments.tsx          # Cached YouTube comments with expand/collapse
│   ├── StudentNotes.tsx             # Per-session student notes with bold/bullet toolbar + auto-save
│   ├── WelcomeModal.tsx             # First-visit welcome modal (localStorage, configurable key)
│   ├── player/
│   │   ├── CoursePlayerLayout.tsx   # CFI-style layout: left sidebar + video + right comments panel
│   │   ├── CourseTopBar.tsx         # Dark sticky bar: title, actions, Mark Complete, Assessment, Continue
│   │   └── ShareModal.tsx           # Share modal: Copy Link, LinkedIn, WhatsApp
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
│       ALL template functions are async (use baseLayoutBranded) — callers must await
├── modeling/real-estate/
│   ├── export/ (excel-formula, excel-static, pdf)
│   └── modules/ (module1-setup(done), module2-6(stubs), module7-11(placeholders))
├── shared/
│   ├── audit.ts  auth.ts  captcha.ts  cms.ts (getAllPageSections, getPageSections, getTestimonialsForPage)  deviceTrust.ts
│   ├── emailConfirmation.ts  modelingComingSoon.ts  password.ts  permissions.ts
│   ├── storage.ts  supabase.ts  urls.ts
└── training/
    ├── appsScript.ts  certificateEngine.ts  certificateLayout.ts  certifier.ts(deprecated)
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
