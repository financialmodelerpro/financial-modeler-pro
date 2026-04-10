# Project Handoff — Financial Modeler Pro
**Snapshot date: 2026-04-10**

Use this file to resume development in a new chat session. Read `CLAUDE.md` first for strict project rules.

**Related docs:**
- `CLAUDE.md` — Project rules, tech stack, auth systems, routing, env vars
- `CLAUDE-DB.md` — Database tables, storage buckets, migrations log
- `CLAUDE-FEATURES.md` — Detailed feature specs, architectural decisions
- `CLAUDE-ROUTES.md` — All page routes, API routes, component/lib structure
- `CLAUDE-TODO.md` — Backlog, pending REFM modules, future platforms

---

## 1. Full Feature Status

### Training Hub (`learn.financialmodelerpro.com`)

| Feature | Status | Notes |
|---------|--------|-------|
| Student registration (hCaptcha + pending table) | ✅ Complete | `app/training/register/page.tsx`, city/country/phone fields, Apps Script post-confirm |
| Email confirmation flow | ✅ Complete | Pending table -> confirm link -> Apps Script -> meta confirmed |
| OTP sign-in + device trust | ✅ Complete | 6-digit code, 10-min expiry, 30-day trust cookie, email-based (not regId) |
| Password set/reset | ✅ Complete | `app/training/set-password/page.tsx`, `app/training/forgot/page.tsx` |
| Resend confirmation email | ✅ Complete | `POST /api/training/resend-confirmation`, covers `null` and `false` |
| Inactivity logout (1hr) | ✅ Complete | `useInactivityLogout` hook on dashboard |
| Student dashboard (redesigned) | ✅ Complete | Overview landing + course detail views, hero, stats, quick actions, achievements |
| Collapsible sidebar | ✅ Complete | 240px/56px toggle, localStorage persistence, mobile off-canvas overlay |
| Mobile bottom nav bar | ✅ Complete | Fixed 56px bar: Home, Courses, Live, Achieve, Profile |
| Quiz/assessment flow | ✅ Complete | Client-side scoring, correctIndex stored on load, never re-fetched during submit |
| Question bank (3SFM + BVM) | ✅ Complete | Fetched from Google Apps Script at runtime (not stored in Supabase) |
| Shuffle settings (questions/options) | ✅ Complete | Per-course toggles in `training_settings` DB, admin UI alongside Timer Bypass |
| Score writing to Google Sheets | ✅ Complete | `POST /api/training/submit-assessment` -> Apps Script (pre-scored data only) |
| Progress tracking | ✅ Complete | `student_progress` table, lesson/video completion, optimistic updates |
| Points + streak system | ✅ Complete | Points (star) + streak (fire) displayed in dashboard, loaded from activity API |
| Badges earned system | ✅ Complete | Badge metadata with milestones (e.g. 5-day streak), earned badges displayed |
| Certificate generation | ✅ Complete | Internal pdf-lib PDF, daily cron (every 15 min) + manual Generate Now button |
| Badge image generation | ✅ Complete | Satori text-to-SVG + Sharp composite onto badge PNG template |
| Transcript generation | ✅ Complete | Token-gated HTML + PDF, QR code, Certificate ID, ASCII-only text |
| Profile photo upload/crop | ✅ Complete | react-easy-crop, square aspect, 1-3x zoom, round shape |
| Profile editing (name/city/country) | ✅ Complete | ProfileModal in dashboard |
| Live Sessions — admin CRUD | ✅ Complete | Full CRUD, banner upload, 34 timezones, playlists, duplicate, filters |
| Live Sessions — student pages | ✅ Complete | Upcoming/recordings sections, detail page, YouTube embed, countdown |
| Live Sessions — public pages | ✅ Complete | SSR at `/training-sessions`, no auth required, no `live_url` exposed |
| Session registration/RSVP | ✅ Complete | `session_registrations` table, batch status API, join link 30 min before |
| Email notifications (live sessions) | ✅ Complete | Announcement/reminder via Resend, targeting all/3SFM/BVM |
| Watch tracking (recordings) | ✅ Complete | `session_watch_history` table, 50 points on first watch |
| File attachments per session | ✅ Complete | Upload to `course-materials` bucket, in-dashboard preview modal |
| Share Experience / Testimonials | ✅ Complete | 3-tab modal (written, video, social), both hubs, LinkedIn/Loom validation |
| Admin — student management | ✅ Complete | Student list, progress modal with tabs, admin actions history |
| Admin — reset attempts | ✅ Complete | Per-session or all-sessions reset via Apps Script `apiResetAttempts` |
| Admin — course manager | ✅ Complete | Course editor, session/lesson management, attachment toggle |
| Admin — badge editor | ✅ Complete | Field editor (Certificate ID + Issue Date), live CSS + server preview |
| Admin — transcript editor | ✅ Complete | Header drag-to-position, CMS-driven colors, PDF Preview button |
| Admin — certificate editor | ✅ Complete | Dual layout (HTML block + PDF field), coordinate scaling, ascent correction |
| Admin — certificate management | ✅ Complete | Sync, upload template, auto-generation toggle, manual generate |
| Admin — cohorts | ✅ Complete | Cohort groups, student enrollment management |
| Admin — analytics | ✅ Complete | Training hub analytics dashboard |
| Admin — communications | ✅ Complete | Student communications panel |
| Admin — assessments | ✅ Complete | Question management, attempt viewing |
| Learn homepage session preview | ✅ Complete | `UpcomingSessionsPreview` — up to 3 cards, priority: upcoming then recordings |

### Modeling Hub (`app.financialmodelerpro.com`)

| Feature | Status | Notes |
|---------|--------|-------|
| User authentication (NextAuth JWT) | ✅ Complete | Credentials provider, 1hr session, scrypt passwords |
| Registration + email confirm | ✅ Complete | hCaptcha, `email_confirmed` flag, confirmation email |
| Device trust + OTP | ✅ Complete | `modeling_email_otps`, 30-day trust cookie |
| Forgot/reset password | ✅ Complete | `app/forgot-password/` + `app/reset-password/` pages |
| Inactivity logout | ✅ Complete | On portal + dashboard |
| Modeling dashboard | ✅ Complete | Platform cards grid, routes to `/refm` for REFM |
| REFM — Module 1: Project Setup | ✅ Complete | Timeline, Land & Area, Dev Costs, Financing |
| REFM — Module 5: Financial Statements | ✅ Complete | Implementation exists |
| REFM — Module 6: Reports & Visualizations | ✅ Complete | Implementation exists |
| REFM — Module 2: Revenue Analysis | ⏳ Pending | Stub only (empty exports) |
| REFM — Module 3: Operating Expenses | ⏳ Pending | Stub only |
| REFM — Module 4: Returns & Valuation | ⏳ Pending | Stub only |
| REFM — Modules 7-9 | ⏳ Pending | Placeholder stubs |
| REFM — Module 10: Placeholder | ✅ Complete | Implementation exists |
| REFM — Module 11: Deck | ✅ Complete | Implementation exists |
| Excel export (static + formula) | ✅ Complete | exceljs |
| PDF export | ✅ Complete | @react-pdf/renderer |
| Share Experience / Testimonials | ✅ Complete | Same modal component, `hub='modeling'` prop |

### Main Website (`financialmodelerpro.com`)

| Feature | Status | Notes |
|---------|--------|-------|
| Landing page (portal) | ✅ Complete | Inline-editable CMS, 49KB page |
| CMS page builder | ✅ Complete | 11 section types, drag-and-drop, SEO, `/(cms)/[slug]` catch-all |
| Dynamic navigation | ✅ Complete | `site_pages` table, admin editable, NavbarServer absolutizeHref() |
| About page | ✅ Complete | Modules fallback data |
| About — Ahmad Din page | ✅ Complete | Founder profile |
| Articles / blog | ✅ Complete | `app/articles/` + `[slug]`, full Supabase integration |
| Pricing page | ✅ Complete | ISR (60s revalidation), Supabase plans/features/modules |
| Contact form | ✅ Complete | Submissions to `contact_submissions` table, admin review |
| Privacy policy | ✅ Complete | 1hr revalidation |
| Confidentiality page | ✅ Complete | Static page |
| Testimonials submission | ✅ Complete | Public form at `app/testimonials/submit/page.tsx` |
| Certificate verification | ✅ Complete | `app/verify/[uuid]/page.tsx` — public verification page |
| Transcript viewer | ✅ Complete | `app/t/[token]/page.tsx` — token-gated access |

### Admin Panel (`financialmodelerpro.com/admin`)

| Section | Status | Notes |
|---------|--------|-------|
| Admin auth (two-step login) | ✅ Complete | Navy/gold branding, OTP step, excluded from middleware |
| Admin dashboard | ✅ Complete | Protected entry -> redirects to `/admin/cms` |
| CMS management | ✅ Complete | Content editing |
| Page builder | ✅ Complete | Page list + section editor with drag-and-drop |
| Articles CRUD | ✅ Complete | List + new + edit pages |
| Announcements | ✅ Complete | `AnnouncementsManager` component |
| Users management | ✅ Complete | User list and management |
| Training Hub section | ✅ Complete | 9 specialized sub-pages |
| Live Sessions management | ✅ Complete | Full CRUD + notifications + registrations modal |
| Certificate editor | ✅ Complete | Dual layout editor |
| Badge editor | ✅ Complete | Field positions + live preview |
| Transcript editor | ✅ Complete | CMS-driven + PDF preview |
| Certificates management | ✅ Complete | Sync, upload, generate, auto-generation toggle |
| Training settings | ✅ Complete | Apps Script URL, shuffle toggles, timer bypass |
| Testimonials (all/training/modeling) | ✅ Complete | Hub-specific filtering |
| Branding / white-label | 🟡 Partial | DB-driven config exists, full theming coverage incomplete |
| Pricing / plans | 🟡 Partial | Plans + features in DB, enforcement not fully wired |
| Permissions (RBAC) | ✅ Complete | `PermissionsManager` component |
| Audit log | ✅ Complete | `AuditLogViewer` component |
| System health | ✅ Complete | `SystemHealth` component |
| Media management | ✅ Complete | Upload and manage assets |
| Modules config | ✅ Complete | Module configuration panel |
| Founder profile | ✅ Complete | Admin founder page editor |
| Contact submissions | ✅ Complete | View + update status |
| Projects browser | ✅ Complete | REFM saved projects |
| Overrides | ✅ Complete | System overrides panel |
| White-label settings | 🟡 Partial | Settings exist, full coverage pending |

### Cross-Platform

| Feature | Status | Notes |
|---------|--------|-------|
| Subdomain routing | ✅ Complete | `next.config.ts` rewrites/redirects |
| Clean auth URLs (/signin, /register) | ✅ Complete | Both subdomains |
| Email system (Resend) | ✅ Complete | 11 templates, 2 sender addresses |
| Apps Script integration | ✅ Complete | Registration, questions, scores, attendance, reset |
| AI agents | 🟡 Partial | Market rates + research wired; contextual help is stub only |
| Design system (CSS tokens) | ✅ Complete | `globals.css` — do not modify |

---

## 2. Known Bugs & Issues

### P1 — Functional (needs testing/fixing)

| Bug | Location | Details |
|-----|----------|---------|
| Join button needs e2e testing | `app/training/live-sessions/[id]/page.tsx` | Logic fixed in `0d95efd` — join link appears 30 min before for registered students. Needs manual test with real upcoming session + registration data. |
| Certificate badges may show generic icons | Dashboard achievements section | Badge images may show generic fallback instead of actual PNG from Supabase `badges` bucket. Verify `badge_url` is populated in `student_certificates` table. Download API: `GET /api/training/badges/download?certId=` |
| Pricing enforcement not wired | Modeling Hub | `pricing_plans`, `pricing_features`, `pricing_modules` tables have data but gating logic in app is incomplete. Users can access features regardless of plan. |

### P2 — Visual consistency

| Bug | Location | Details |
|-----|----------|---------|
| Public page cards don't match dashboard | `app/training-sessions/SessionsClient.tsx` | Cards are inline-styled divs. Dashboard uses `SessionCard.tsx`. No shared component exists. |
| Dashboard preview vs full listing mismatch | `UpcomingSessionsPreview.tsx` vs `live-sessions/page.tsx` | Two different card designs for the same sessions. |

### P3 — Minor / cosmetic

| Bug | Location | Details |
|-----|----------|---------|
| Instructor title fallback text | `app/training-sessions/[id]/DetailClient.tsx:268` | Falls back to "Financial Modeling Expert" when title is empty. May not be desired for all instructors. Null guards are in place (`&&` and `||`). |
| White-label theming gaps | `BrandingThemeApplier` | Config is DB-driven but not all components consume the theme variables. |

### Not bugs — verified working
- Instructor title null checks: properly guarded with `&&` / `||` across all surfaces
- Profile photo crop: react-easy-crop integrated, square aspect, zoom slider
- Points/streak: loads from activity API, displays in dashboard
- No TODO/FIXME/HACK comments found in codebase

---

## 3. Last 10 Git Commits

| Hash | Date | Message |
|------|------|---------|
| `4add9bb` | 2026-04-09 | Update CLAUDE.md — full session documentation refresh |
| `0d95efd` | 2026-04-09 | Fix 4 live session bugs: instructor, preview links, join button, consistency |
| `62e178a` | 2026-04-09 | Redesign Training Sessions preview on learn homepage |
| `a6ef492` | 2026-04-09 | Fix 5 live session bugs: instructor title, cards, join link, YouTube toggle |
| `e464743` | 2026-04-09 | Redesign Training Sessions preview on dashboard overview |
| `dfb0517` | 2026-04-09 | Free access to recordings + watch tracking + instructor title |
| `9ac2ecb` | 2026-04-09 | Remove duplicate upcoming session banner from dashboard overview |
| `e411a2e` | 2026-04-09 | Fix public Training Sessions page: server-side data fetching |
| `5c4fc9c` | 2026-04-09 | Add registration status on session cards + fix admin date for recordings |
| `d51d1cc` | 2026-04-09 | Fix nav consistency, API debugging, remove tabs for sequential layout |

Last session was a rapid live sessions polish sprint: 15 files changed, +1221/-837 lines.

---

## 4. Environment Variables (full list)

| Variable | Purpose |
|----------|---------|
| `ANTHROPIC_API_KEY` | Claude AI API key for market research + help agents |
| `SUPABASE_URL` | Supabase project URL (server) |
| `SUPABASE_ANON_KEY` | Supabase anon key (server alias) |
| `SUPABASE_SERVICE_ROLE_KEY` | Supabase service role key (server only, bypasses RLS) |
| `NEXT_PUBLIC_SUPABASE_URL` | Supabase URL (client-safe) |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | Supabase anon key (client-safe) |
| `NEXTAUTH_SECRET` | NextAuth JWT signing secret |
| `NEXTAUTH_URL` | `https://app.financialmodelerpro.com` |
| `NEXT_PUBLIC_APP_URL` | `https://app.financialmodelerpro.com` (used in Navbar with `??` fallback) |
| `NEXT_PUBLIC_MAIN_URL` | `https://financialmodelerpro.com` |
| `NEXT_PUBLIC_LEARN_URL` | `https://learn.financialmodelerpro.com` (used in Navbar with `??` fallback) |
| `RESEND_API_KEY` | Resend email service API key |
| `EMAIL_FROM_TRAINING` | Training hub sender address |
| `EMAIL_FROM_NOREPLY` | No-reply sender address |
| `HCAPTCHA_SECRET_KEY` | hCaptcha server-side verification secret |
| `NEXT_PUBLIC_HCAPTCHA_SITE_KEY` | hCaptcha client-side site key |
| `CRON_SECRET` | Bearer token for Vercel cron job auth (`/api/cron/certificates`) |
| `APPS_SCRIPT_URL` | Google Apps Script deployment URL (primary, fallback in DB) |

---

## 5. Third-Party Services

| Service | What It Does | Credentials |
|---------|-------------|-------------|
| **Supabase** | PostgreSQL database, file storage (5 buckets), auth helper | `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`, `NEXT_PUBLIC_SUPABASE_*` |
| **Resend** | Transactional email delivery (11 templates: confirmation, OTP, certificates, live session notifications, quiz results, etc.) | `RESEND_API_KEY`, `EMAIL_FROM_TRAINING`, `EMAIL_FROM_NOREPLY` |
| **Google Apps Script** | Source of truth for student roster, registration IDs, assessment questions, score writing, attendance tracking, attempt resets | `APPS_SCRIPT_URL` env var OR `training_settings.apps_script_url` in Supabase |
| **hCaptcha** | Bot protection on registration forms (both Training + Modeling hubs) | `HCAPTCHA_SECRET_KEY`, `NEXT_PUBLIC_HCAPTCHA_SITE_KEY` |
| **Anthropic Claude API** | AI-powered market rates agent + research agent (contextual help is stub) | `ANTHROPIC_API_KEY` |
| **Vercel** | Hosting, edge middleware, cron jobs (certificate generation every 15 min), auto-deploy on `main` push | Vercel dashboard (no env var needed in app) |
| **Google Fonts** | Inter TTF font fetched at runtime for badge generation via Satori | No credentials (public CDN, cached in memory) |

### Where credentials are stored
- **Production**: Vercel Environment Variables dashboard
- **Local dev**: `.env.local` (gitignored)
- **Apps Script URL**: Also stored in Supabase `training_settings` table as fallback, editable at `/admin/training-settings`

---

## 6. Deployment Process

### Standard deployment
```bash
# 1. Verify locally
npm run verify          # runs: type-check + lint + build

# 2. Push to main (auto-deploys to Vercel)
git push origin main

# 3. Verify health
curl https://financialmodelerpro.com/api/health
# Expected: { "status": "ok", "platform": "financial-modeler-pro", "version": "3.0" }
```

### Individual checks
```bash
npm run type-check      # tsc --noEmit — must be zero errors
npm run build           # next build --webpack (avoids MAX_PATH on Windows/OneDrive)
```

### How to update Apps Script URL
1. **Via admin panel**: Go to `https://financialmodelerpro.com/admin/training-settings` -> update the Apps Script URL field -> Save
2. **Via env var**: Update `APPS_SCRIPT_URL` in Vercel Environment Variables dashboard -> redeploy
3. **Priority**: Env var is checked first; Supabase `training_settings` table is fallback
4. **Code location**: `src/lib/training/sheets.ts` handles the resolution

### How to run database migrations
1. Migrations are in `supabase/migrations/` (numbered 002-041)
2. **Never edit existing migrations** — create new ones with next number (042+)
3. Run via Supabase dashboard SQL editor or `supabase db push`
4. Update `CLAUDE-DB.md` after running

### Cron jobs
| Job | Schedule | Endpoint | Auth |
|-----|----------|----------|------|
| Certificate generation | Every 15 minutes | `GET /api/cron/certificates` | `Authorization: Bearer $CRON_SECRET` |

Configured in `vercel.json`. Calls `processPendingCertificates()` with 5-minute timeout.

---

## 7. What Was Last Being Worked On

The last session (2026-04-09) focused on **Live Sessions UI polish** across four surfaces:

### Changes made
- Refactored public training-sessions pages to server+client split (`SessionsClient.tsx`, `DetailClient.tsx`)
- Added watch tracking API (`/api/training/live-sessions/[id]/watched/`)
- Added batch registration status API
- Redesigned dashboard overview preview cards (3-column layout)
- Redesigned learn homepage preview (`UpcomingSessionsPreview.tsx`)
- Added YouTube embed quick toggle in admin
- Added instructor title field across all surfaces
- Fixed join button logic for registered students
- Added free access to recorded sessions

### Unfinished from that session
1. **No universal SessionCard component** — `src/components/sessions/` does not exist. Each surface (public, dashboard, student listing) renders its own card markup inline.
2. **Card design inconsistency** — public page cards, dashboard preview cards, and student listing cards all look different.
3. **Join button** — logic is in place but untested with real registration data.

---

## 8. Next Steps (prioritized)

### Immediate (polish from last session)
1. Create universal session card component at `src/components/sessions/SessionCard.tsx`
2. Test join button flow end-to-end with a real upcoming session
3. Verify badge images display correctly (check `badge_url` population)

### Short-term
4. Wire up pricing/subscription enforcement (plans exist in DB)
5. Complete AI contextual help agent (stub exists)
6. Full white-label theming coverage

### Medium-term
7. REFM Module 2: Revenue Analysis
8. REFM Module 3: Operating Expenses
9. REFM Module 4: Returns & Valuation
10. REFM Modules 7-9

### Long-term
11. 9 additional modeling platforms (BVM, FPA, ERM, PFM, LBO, CFM, EUM, SVM, BCM)

---

## 9. Key File Quick Reference

| What | Where |
|------|-------|
| Project rules | `CLAUDE.md` |
| Database docs | `CLAUDE-DB.md` |
| Feature specs | `CLAUDE-FEATURES.md` |
| Route map | `CLAUDE-ROUTES.md` |
| Backlog | `CLAUDE-TODO.md` |
| Auth (Modeling) | `src/lib/shared/auth.ts` |
| Auth (Training) | `src/lib/training/training-session.ts` |
| Apps Script calls | `src/lib/training/sheets.ts` |
| Certificate engine | `src/lib/training/certificateEngine.ts` |
| Email templates | `src/lib/email/templates/` |
| Design tokens | `app/globals.css` |
| Supabase client | `src/lib/shared/supabase.ts` |
| CMS helpers | `src/lib/shared/cms.ts` |
| Navbar | `src/components/layout/Navbar.tsx` |
| Dashboard | `app/training/dashboard/page.tsx` |
| Admin entry | `app/admin/dashboard/page.tsx` |

---

## Migrations Status

**Latest**: `041_watch_history_instructor_title.sql`
**Next number**: `042`
**All through 041 are run.** No pending migrations.
**Rule**: Never edit existing migrations.
