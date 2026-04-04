# Financial Modeler Pro — Claude Code Project Brief
**Last updated: 2026-04-04**

---

## ⚠️ STRICT SESSION RULES — READ FIRST

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
**ALWAYS update this CLAUDE.md at the end of every session** to reflect:
- Any new files created (add to the correct folder list)
- Any feature status changes (update the Feature Status table)
- Any new environment variables added

### Do NOT touch list
- `next.config.ts` — subdomain routing is live and correct
- `app/globals.css` — design system tokens, do not restructure
- `vercel.json` — deployment config is live
- `supabase/migrations/` — never edit existing migrations; create new ones only
- Any feature marked ✅ Complete unless explicitly asked by the user
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
| Rich Text | @tiptap/react + starter-kit + image | 2.27.2 |
| Drag & Drop | @hello-pangea/dnd | ^18.0.1 |
| Passwords | bcryptjs (Training Hub) / scrypt via Node (Modeling Hub) | ^3.0.3 |
| Toast | react-hot-toast | ^2.6.0 |
| Sanitization | isomorphic-dompurify | ^3.3.0 |

---

## External Services

| Service | Purpose | Config |
|---------|---------|--------|
| **Supabase** | Database | `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`, `NEXT_PUBLIC_SUPABASE_ANON_KEY` |
| **Resend** | Transactional email | `RESEND_API_KEY`, `EMAIL_FROM_TRAINING`, `EMAIL_FROM_NOREPLY` |
| **Google Apps Script** | Training registration + attendance source of truth | URL stored in `training_settings` table (`apps_script_url` field) |
| **hCaptcha** | Spam protection on signup forms (both hubs) | `HCAPTCHA_SECRET_KEY`, `NEXT_PUBLIC_HCAPTCHA_SITE_KEY` |
| **Anthropic Claude API** | AI market research + contextual help agents | `ANTHROPIC_API_KEY` |
| **Vercel** | Hosting + edge middleware | Auto-deploy on `main` push |

---

## Authentication Systems

### Training Hub (learn.financialmodelerpro.com)
- **Source of truth**: Google Apps Script (student roster + Registration IDs)
- **Password storage**: `training_passwords` table (bcrypt hashed)
- **Session**: httpOnly cookie `training_session` (1-hour TTL) + localStorage mirror
- **Sign-in flow**: email+password → `POST /api/training/validate` → check pending/unconfirmed → check device trust → set session cookie
- **Registration flow**: form → hCaptcha verify → insert `training_pending_registrations` → send confirmation email → click link → Apps Script call → `training_registrations_meta` confirmed
- **Device trust**: `fmp-trusted-device` cookie → `trusted_devices` table (30-day TTL)
- **New device OTP**: `training_email_otps` table, 6-digit code, 10-min expiry
- **Inactivity logout**: 1-hour `useInactivityLogout` hook on dashboard → `POST /api/training/logout`
- **Resend confirmation**: `POST /api/training/resend-confirmation` — checks `training_pending_registrations` or `email_confirmed=false` in meta
- **Key files**: `src/lib/training/training-session.ts`, `app/api/training/validate/route.ts`, `app/api/training/register/route.ts`

### Modeling Hub (app.financialmodelerpro.com)
- **Auth provider**: NextAuth.js Credentials (JWT strategy, 1-hour maxAge)
- **Password storage**: `users.password_hash` (scrypt via Node `crypto.scrypt`)
- **Session**: NextAuth JWT cookie
- **Sign-in flow**: email+password → NextAuth `authorize()` → check `email_confirmed` → check device trust → JWT issued
- **Registration flow**: form → hCaptcha verify → insert `users` (email_confirmed=false) → send confirmation email → click link → `email_confirmed=true` → signin
- **Device trust**: `fmp-trusted-device` cookie → `trusted_devices` table (30-day TTL)
- **New device OTP**: `modeling_email_otps` table, 6-digit code, 10-min expiry
- **Inactivity logout**: 1-hour `useInactivityLogout` hook on portal + dashboard → `signOut()` from next-auth
- **Resend confirmation**: `POST /api/auth/resend-confirmation` — only sends if `email_confirmed=false` in users table
- **Key files**: `src/lib/shared/auth.ts`, `app/api/auth/register/route.ts`, `app/api/auth/confirm-email/route.ts`, `app/api/auth/device-verify/route.ts`, `app/api/auth/resend-confirmation/route.ts`

---

## Database Tables (Supabase)

### Modeling Hub
| Table | Purpose |
|-------|---------|
| `users` | Accounts: id, email, name, password_hash, role, subscription_plan, subscription_status, phone, city, country, email_confirmed, confirmed_at |
| `projects` | REFM saved projects (JSON blob) |
| `password_resets` | Tokens for forgot-password flow |
| `modeling_email_otps` | 6-digit device-verify OTPs (10-min TTL) |

### Training Hub
| Table | Purpose |
|-------|---------|
| `training_registrations_meta` | Student records: registration_id, email, name, course, city, country, email_confirmed, confirmed_at |
| `training_passwords` | Bcrypt password hashes keyed by registration_id |
| `training_pending_registrations` | Staging table before email confirmation |
| `training_email_otps` | 6-digit device-verify OTPs (10-min TTL) |
| `training_settings` | Admin config: apps_script_url, etc. |
| `training_admin_actions` | Admin action history for students |

### Shared Auth
| Table | Purpose |
|-------|---------|
| `trusted_devices` | hub, identifier, device_token (UNIQUE), expires_at (30 days) |
| `email_confirmations` | hub, email, token (UNIQUE), expires_at (24hr), used_at |

### Content & CMS
| Table | Purpose |
|-------|---------|
| `site_pages` | Dynamic nav pages with href, label, ordering |
| `branding_config` | White-label colors, logos |
| `articles` | Blog/knowledge base articles |
| `announcements` | Site-wide announcements |
| `testimonials` | Student/user testimonials (hub-tagged) |
| `contact_submissions` | Contact form entries |
| `media` | Uploaded media asset references |

### Training Platform
| Table | Purpose |
|-------|---------|
| `courses` | Course definitions (3SFM, BVM, etc.) |
| `sessions` | Course sessions (days/modules) |
| `lessons` | Individual lesson items |
| `cohorts` | Training cohort groups |
| `cohort_enrollments` | Student ↔ cohort membership |
| `student_progress` | Lesson/video completion tracking |
| `student_notes` | Per-lesson student notes |
| `student_feedback` | Course feedback submissions |
| `assessment_questions` | Quiz question bank |
| `assessment_attempts` | Student quiz attempt results |
| `certificates` | Issued certificate records |
| `certificate_layouts` | Admin-configurable certificate templates |
| `transcript_tokens` | Shareable transcript access tokens |

### Admin & Misc
| Table | Purpose |
|-------|---------|
| `audit_log` | Admin action audit trail |
| `permissions` | Role → permission flags |
| `pricing_plans` | Subscription plan definitions |
| `pricing_features` | Feature flags per plan |
| `pricing_modules` | Module access per plan |

---

## Feature Status

| Feature | Status | Notes |
|---------|--------|-------|
| **Training Hub — Auth (login/logout/session)** | ✅ Complete | Custom session, 1hr TTL, httpOnly cookie |
| **Training Hub — Registration + Email Confirm** | ✅ Complete | hCaptcha + pending table + Apps Script post-confirm |
| **Training Hub — Device Trust + OTP** | ✅ Complete | `training_email_otps`, 30-day trust cookie |
| **Training Hub — Resend Confirmation Email** | ✅ Complete | `POST /api/training/resend-confirmation`, shown on signin on EmailNotConfirmed |
| **Training Hub — Inactivity Logout** | ✅ Complete | `useInactivityLogout` on dashboard |
| **Training Hub — Dashboard** | ✅ Complete | Video player, progress, notes, feedback |
| **Training Hub — Assessments / Quiz** | ✅ Complete | Question bank, attempts, auto-score |
| **Training Hub — Certificate System** | ✅ Complete | PDF cert, QR verify, Certifier API, public verify page |
| **Training Hub — Transcript** | ✅ Complete | Shareable token-gated PDF transcript |
| **Training Hub — Profile** | ✅ Complete | Avatar upload, name/city/country |
| **Modeling Hub — Auth (login/logout/session)** | ✅ Complete | NextAuth JWT, 1hr session |
| **Modeling Hub — Registration + Email Confirm** | ✅ Complete | hCaptcha + email_confirmed flag + confirmation email |
| **Modeling Hub — Device Trust + OTP** | ✅ Complete | `modeling_email_otps`, 30-day trust cookie |
| **Modeling Hub — Resend Confirmation Email** | ✅ Complete | `POST /api/auth/resend-confirmation`, shown on signin on EmailNotConfirmed |
| **Modeling Hub — Inactivity Logout** | ✅ Complete | `useInactivityLogout` on portal + dashboard |
| **Subdomain Routing** | ✅ Complete | next.config.ts rewrites/redirects, no middleware auth |
| **Admin Panel** | ✅ Complete | Users, training, certificates, CMS, branding, pricing, audit |
| **Admin — Training Hub section** | ✅ Complete | Students, cohorts, assessments, analytics, comms |
| **Admin — Certificate Editor** | ✅ Complete | Layout config, sync to Certifier API |
| **CMS / Dynamic Nav** | ✅ Complete | `site_pages` table, admin editable |
| **Email System** | ✅ Complete | Resend, 11 templates, FROM.training + FROM.noreply |
| **Apps Script Integration** | ✅ Complete | Register student, fetch registration ID, attendance |
| **REFM Module 1 — Project Setup** | ✅ Complete | Timeline, Land & Area, Dev Costs, Financing |
| **REFM Module 2 — Revenue Analysis** | ❌ Not Started | Stub only |
| **REFM Module 3 — Operating Expenses** | ❌ Not Started | Stub only |
| **REFM Module 4 — Returns & Valuation** | ❌ Not Started | Stub only |
| **REFM Module 5 — Financial Statements** | ❌ Not Started | Stub only |
| **REFM Module 6 — Reports & Visualizations** | ❌ Not Started | Stub only |
| **REFM Modules 7–11** | ❌ Not Started | Placeholder stubs |
| **Excel / PDF Export (REFM)** | ✅ Complete | exceljs static + formula, @react-pdf/renderer |
| **AI Agents** | 🔄 In Progress | Market rates + research agents wired; contextual help stub |
| **Pricing / Subscriptions** | 🔄 In Progress | Plans + features in DB; enforcement partial |
| **White-label / Branding** | 🔄 In Progress | DB-driven config; BrandingThemeApplier wired |
| **BVM / FPA / other modeling platforms** | ❌ Not Started | Config defined, no platform content yet |

---

## Folder Structure

### `app/` — Routes by subdomain

#### Main Site (`financialmodelerpro.com`)
```
app/
├── (portal)/page.tsx            # Legacy portal group
├── layout.tsx                   # Root layout, SessionProvider, Inter font
├── globals.css                  # SINGLE SOURCE OF TRUTH for all CSS tokens
├── about/page.tsx
├── about/ahmad-din/page.tsx
├── articles/page.tsx
├── articles/[slug]/page.tsx
├── confidentiality/page.tsx
├── contact/page.tsx
├── forgot-password/page.tsx
├── login/page.tsx
├── portal/page.tsx              # Authenticated app hub (all platforms grid)
├── pricing/page.tsx
├── privacy-policy/page.tsx
├── reset-password/page.tsx
├── settings/page.tsx
├── t/[token]/page.tsx
├── testimonials/submit/page.tsx
└── verify/[uuid]/page.tsx       # Certificate public verification
```

#### Admin (`financialmodelerpro.com/admin`)
```
app/admin/
├── layout.tsx
├── page.tsx
├── announcements/page.tsx
├── articles/page.tsx + [id]/ + new/
├── audit/page.tsx
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
├── pages/page.tsx
├── permissions/page.tsx
├── plans/page.tsx
├── pricing/page.tsx
├── projects/page.tsx
├── settings/page.tsx
├── testimonials/page.tsx + modeling/ + training/
├── training/page.tsx + [courseId]/
├── training-hub/page.tsx + analytics/ + assessments/ + certificates/
│   + cohorts/ + communications/ + course-details/ + students/
├── training-settings/page.tsx
├── transcript-editor/page.tsx
├── users/page.tsx
└── whitelabel/page.tsx
```

#### Training Hub (`learn.financialmodelerpro.com` → `/training/`)
```
app/training/
├── page.tsx
├── [courseId]/page.tsx
├── [courseId]/assessment/page.tsx
├── assessment/[tabKey]/page.tsx
├── certificate/page.tsx
├── certificates/page.tsx
├── confirm-email/page.tsx       # Forwards token to /api/training/confirm-email
├── dashboard/page.tsx
├── forgot/page.tsx
├── login/page.tsx
├── register/page.tsx            # hCaptcha + city/country fields
├── set-password/page.tsx
├── signin/page.tsx              # Sign-in + device OTP + resend confirmation link
├── submit-testimonial/page.tsx
└── transcript/[token]/page.tsx
```

#### Modeling Hub (`app.financialmodelerpro.com` → `/modeling/`)
```
app/modeling/
├── page.tsx
├── [slug]/page.tsx
├── confirm-email/page.tsx       # Forwards token to /api/auth/confirm-email
├── dashboard/page.tsx           # Inactivity logout wired
├── login/page.tsx
├── signin/page.tsx              # Sign-in + signup + device OTP + resend confirmation link
└── submit-testimonial/page.tsx

app/refm/page.tsx                # REFM platform
app/portal/page.tsx              # Authenticated hub — inactivity logout wired
```

### `app/api/` — API Routes

#### Auth (Modeling Hub)
```
app/api/auth/
├── [...nextauth]/route.ts
├── confirm-email/route.ts         # GET: verify token → email_confirmed=true → redirect
├── device-verify/route.ts         # POST action:send|check — OTP for new device
├── forgot-password/route.ts
├── register/route.ts              # POST: hCaptcha + create user + send confirm email
├── resend-confirmation/route.ts   # POST: resend confirm email if email_confirmed=false
└── reset-password/route.ts
```

#### Training (Training Hub)
```
app/api/training/
├── [courseId]/assessment/route.ts + submit/
├── activity/route.ts
├── attempt-status/route.ts
├── certificate/route.ts + certificate-image/
├── certificates/route.ts
├── confirm-email/route.ts         # GET: verify token → Apps Script → meta confirmed
├── course-details/route.ts
├── device-verify/route.ts         # POST action:send|check — OTP for new device
├── feedback/route.ts
├── logout/route.ts
├── notes/route.ts
├── profile/route.ts
├── progress/route.ts
├── proxy-ping/route.ts
├── questions/route.ts
├── register/route.ts              # POST: hCaptcha + pending_registrations + confirm email
├── resend-confirmation/route.ts   # POST: resend confirm email for pending/unconfirmed
├── resend-id/route.ts
├── send-verification/route.ts
├── set-password/route.ts
├── submit-assessment/route.ts
├── submit-testimonial/route.ts
├── transcript-link/route.ts
├── upload-avatar/route.ts
├── validate/route.ts              # POST: password + pending check + email_confirmed + device trust
└── verify-email/route.ts
```

#### Admin
```
app/api/admin/
├── announcements/ articles/ asset-types/ audit-log/
├── assessments/ + attempts/ + questions/
├── certificate-layout/ certificates/sync/
├── contact-submissions/ content/ env-check/ founder/ media/ modules/ pages/ permissions/
├── pricing/features/ + modules/ + plans/
├── projects/ testimonials/ training/ + [courseId]/lessons/
├── training-actions/ + [id]/
├── training-hub/ + analytics/ + assessments/ + certificates/
│   + cohorts/ + cohorts/[id]/ + communications/ + student-journey/
│   + student-progress/ + students/
├── training-settings/ users/ whitelabel/
```

#### Other
```
app/api/
├── agents/market-rates/ + research/
├── branding/ cms/ contact/ email/send/
├── export/excel/ + pdf/
├── health/ modeling/submit-testimonial/
├── permissions/ projects/ qr/
├── t/[token]/pdf/
├── testimonials/ + student/
└── user/account/ + password/ + profile/
```

---

### `src/components/`
```
src/components/
├── admin/
│   ├── AnnouncementsManager.tsx  AuditLogViewer.tsx  CmsAdminNav.tsx
│   ├── PermissionsManager.tsx  ProjectsBrowser.tsx  RichTextEditor.tsx
│   └── SystemHealth.tsx
├── landing/
│   ├── AdminEditBar.tsx  ArticleCard.tsx  CategoryFilter.tsx
│   ├── CourseCard.tsx  InlineEdit.tsx  SharedFooter.tsx  VideoPlayer.tsx
├── layout/
│   ├── Navbar.tsx               # All links are absolute <a> tags (cross-domain safe)
│   └── NavbarServer.tsx         # absolutizeHref() converts DB hrefs to absolute
├── pricing/
│   └── PricingAccordion.tsx
├── refm/
│   ├── Dashboard.tsx  OverviewScreen.tsx  PlanBadge.tsx
│   ├── ProjectsScreen.tsx  RealEstatePlatform.tsx  Sidebar.tsx  Topbar.tsx
│   ├── modals/ — ExportModal  ProjectModal  RbacModal  VersionModal
│   └── modules/ — Module1Area  Module1Costs  Module1Financing  Module1Timeline
├── shared/
│   ├── BrandingSettingsPanel.tsx  BrandingThemeApplier.tsx
│   ├── SessionProviderWrapper.tsx  UpgradePrompt.tsx
├── training/
│   ├── CountdownTimer.tsx
│   └── dashboard/
│       ├── AboutThisCourse.tsx  BvmLockedContent.tsx  CertificateImageCard.tsx
│       ├── CourseContent.tsx  FeedbackModal.tsx  ProfileModal.tsx
│       ├── SessionCard.tsx  ShareModal.tsx  Skeleton.tsx  StatusBadge.tsx
│       ├── TestimonialModal.tsx  index.ts  types.ts
└── ui/
    └── ColorPicker.tsx  OfficeColorPicker.tsx  Toaster.tsx
```

---

### `src/lib/`
```
src/lib/
├── email/
│   ├── sendEmail.ts             # Resend wrapper — FROM.training + FROM.noreply
│   └── templates/
│       ├── _base.ts  accountConfirmation.ts  certificateIssued.ts
│       ├── confirmEmail.ts      # Confirmation link email (both hubs)
│       ├── deviceVerification.ts # OTP email (both hubs)
│       ├── lockedOut.ts  otpVerification.ts  passwordReset.ts
│       ├── quizResult.ts  registrationConfirmation.ts  resendRegistrationId.ts
├── modeling/real-estate/
│   ├── export/ — export-excel-formula  export-excel-static  export-pdf
│   └── modules/ — module1-setup(✅) module2–6(❌ stubs) module7–11(placeholders)
├── shared/
│   ├── audit.ts       auth.ts          captcha.ts       cms.ts
│   ├── deviceTrust.ts emailConfirmation.ts  password.ts  permissions.ts
│   ├── storage.ts     supabase.ts      urls.ts
└── training/
    ├── certificateLayout.ts  certifier.ts  sheets.ts
    ├── training-session.ts   videoTimer.ts
```

---

### `src/hooks/`
```
src/hooks/
├── useInactivityLogout.ts   # 1hr idle → logout; accepts logoutUrl OR onLogout callback
├── useProject.ts
├── useRequireAdmin.ts
├── useRequireAuth.ts
├── useSubscription.ts
└── useWhiteLabel.ts
```

### `src/types/`
```
branding.types.ts  deck.types.ts  next-auth.d.ts  project.types.ts
revenue.types.ts   scenario.types.ts  settings.types.ts  subscription.types.ts
```

### `src/config/`
```
courses.ts    # Course + session definitions (3SFM, BVM)
platforms.ts  # 10 platform definitions — 1 live (REFM), 9 coming soon
```

### `src/core/`
```
branding.ts  core-calculations.ts  core-formatters.ts  core-state.ts  core-validators.ts
```

---

## Modeling Platforms (`src/config/platforms.ts`)

| Slug | Name | Status |
|------|------|--------|
| `real-estate` | Real Estate Financial Modeling (REFM) | ✅ Live |
| `bvm` | Business Valuation Modeling | ❌ Coming Soon |
| `fpa` | FP&A Modeling Platform | ❌ Coming Soon |
| `erm` | Equity Research Modeling | ❌ Coming Soon |
| `pfm` | Project Finance Modeling | ❌ Coming Soon |
| `lbo` | LBO Modeling Platform | ❌ Coming Soon |
| `cfm` | Corporate Finance Modeling | ❌ Coming Soon |
| `eum` | Energy & Utilities Modeling | ❌ Coming Soon |
| `svm` | Startup & Venture Modeling | ❌ Coming Soon |
| `bcm` | Banking & Credit Modeling | ❌ Coming Soon |

---

## Subdomain Routing (`next.config.ts`)

- `learn.financialmodelerpro.com/` → rewrites to `/training` (URL unchanged)
- `app.financialmodelerpro.com/` → rewrites to `/modeling` (URL unchanged)
- Main-site paths on learn. or app. → redirect to `financialmodelerpro.com`
- `/training/*` on main domain → redirect to `learn.financialmodelerpro.com`
- `/modeling/*` or `/refm/*` on main domain → redirect to `app.financialmodelerpro.com`

**Critical**: All `<Link>` in Navbar uses plain `<a>` tags with absolute URLs. NavbarServer `absolutizeHref()` converts DB-sourced relative hrefs to absolute before rendering.

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

### Scripts
```bash
npm run type-check   # tsc --noEmit — must be zero errors
npm run build        # next build --webpack (avoids MAX_PATH on Windows/OneDrive)
npm run verify       # type-check + lint + build
```

### Health Check
`GET /api/health` → `{ status: 'ok', platform: 'financial-modeler-pro', version: '3.0', timestamp }`

---

## Database Migrations Log

| File | Description |
|------|-------------|
| `002_phase1_cms.sql` | Phase 1 CMS tables |
| `003_branding_config.sql` | Branding config table |
| `004_site_pages.sql` | Dynamic nav pages |
| `005_training_assessments.sql` | Assessment questions + attempts |
| `006_permissions.sql` | RBAC permissions table |
| `007_audit_log.sql` | Admin audit trail |
| `008_password_resets.sql` | Password reset tokens |
| `009_testimonials_contact.sql` | Testimonials + contact submissions |
| `010_rename_training_hub.sql` | Table renames |
| `011_contact_nav.sql` | Contact + nav updates |
| `012_training_settings.sql` | Training settings (Apps Script URL) |
| `013_training_admin_actions.sql` | Admin action history |
| `014_pricing.sql` | Plans, features, modules tables |
| `015_contact_nav_email.sql` | Email field on contact |
| `016_fix_nav_urls.sql` | Nav URL fixes |
| `017_seed_courses_curriculum.sql` | Course + session seed data |
| `018_pricing_initial_plans.sql` | Seed pricing plans |
| `019_rename_modeling_hub.sql` | Modeling hub renames |
| `020_course_descriptions.sql` | Course description fields |
| `021_student_testimonials.sql` | Student testimonial visibility |
| `022_student_dashboard_features.sql` | Dashboard feature fields |
| `023_training_intelligence.sql` | Analytics/progress features |
| `024_profile_extensions.sql` | Extended profile fields |
| `025_testimonial_hub_visibility.sql` | Hub-specific testimonial flags |
| `026_session_config.sql` | Session configuration |
| `027_auth_enhancements.sql` | hCaptcha cols, device trust, email confirm, OTP tables ✅ Run |

---

## Legacy Reference

`_legacy_backup/js/refm-platform.js` — 7,599-line original CDN implementation.
- AppRoot: lines 1–70 | State: 72–200 | Calculations: 200–900
- Excel export: 900–1,900 | Project Manager UI: 1,900–3,800
- Main render: 3,800–5,700 | Module 1 UI: 5,700–7,520 | Stubs: 7,520–7,598
