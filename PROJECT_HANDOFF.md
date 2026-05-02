# Project Handoff — Financial Modeler Pro
**Snapshot date: 2026-04-30**

Use this file to resume development in a new chat session. Read `CLAUDE.md` first for strict project rules.

**Related docs:**
- `CLAUDE.md` — Project rules, tech stack, auth systems, routing, env vars
- `CLAUDE-DB.md` — Database tables, storage buckets, migrations log
- `CLAUDE-FEATURES.md` — Detailed feature specs, architectural decisions
- `CLAUDE-ROUTES.md` — All page routes, API routes, component/lib structure
- `CLAUDE-TODO.md` — Backlog, pending REFM modules, future platforms
- `ARCHITECTURE.md` — Three-tier folder structure rationale, alias guide, boundary rules, how to add a platform/hub
- `RESTRUCTURE_PLAN.md` — 8-phase folder restructure plan (executed 2026-04-28 → 2026-04-29; complete)

---

## REFM Phase 4.6-4.15 design-token retrofit (continuation, 2026-04-30)

Eleven commits (`cd9740f`, `71e4822`, `273ec50`, `0226e22`, `7a318cd`, `2e486c1`, `f0535b8`, `e16d333`, `71f72ce`, `97d6de7`, `48e5f3d`) closed out the entire REFM `src/hubs/modeling/platforms/refm/` design-token retrofit started in the prior session. Strict scope: visual-only (no routing, layout, calculation, or logic changes); hex/rgba/`'white'`/`input-assumption` grep returns zero matches per file; Module 1 regression-guard snapshot exit 0; type-check + build green at every commit.

**FAST cell pattern established (Phase 4.6, propagated through 4.7-4.9)** — Module 1 input cells now use `inputStyle = { background: 'var(--color-navy-pale)', color: 'var(--color-navy)' }` and calculated outputs use `calcOutputStyle` keyed off `var(--color-grey-pale)` instead of the global `.input-assumption` class. Removing the className at the call site is required because the class uses `!important` in `globals.css` and would override inline blue. Indentation drift after `replace_all` className removal was fixed via three targeted Edits in Phase 4.8.

**Per-phase commits:**

| # | Commit | File | What changed |
|---|--------|------|--------------|
| 4.6 | `cd9740f` | `Module1Timeline.tsx` | 7 className refs + 9 hex/rgba; AI Assist gradient purple→navy; phase bars via `color-mix()` |
| 4.7 | `273ec50` | `Module1Area.tsx` | 15 className + 8 hex/rgba; hospitality `#7c3aed` → `var(--color-navy-mid)`; Area Hierarchy `<th>` pastels via `color-mix(var(--color-on-primary-navy) 60%, var(--color-navy/--color-gold/--color-negative))`; module-card bg → `var(--color-grey-pale)` (calculated panel signal) |
| 4.8 | `0226e22` | `Module1Costs.tsx` | 11 className + 7 hex/rgba; 5× `rgba(27,79,138,0.08)` → 8% navy color-mix; `'#fff'` on Stage Add → `var(--color-on-primary-navy)`; three-line indentation drift fixed |
| 4.9 | `7a318cd` | `Module1Financing.tsx` | Largest sweep: 16 hex/rgba + 6 className + 24× `'white'`; stripped dead CSS-var fallbacks (`var(--color-navy, #1B4F8A)` → `var(--color-navy)`, `var(--shadow-1, ...)` → `var(--shadow-1)`, `var(--color-row-alt, ...)` → `var(--color-row-alt)`); all `'white'` → `'var(--color-on-primary-navy)'` |
| 4.10 | `2e486c1` | `PlanBadge.tsx` | 3 hex sites + alpha-derivation rewrite. Imports `PLAN_COLOR as TOKEN_PLAN_COLOR` from `@/src/styles/tokens`. `${color}1A`/`${color}40` hex-suffix alpha → `color-mix(in srgb, ${color} 10%/25%, transparent)` so it works with CSS-var values |
| 4.11 | `f0535b8` | `ProjectModal.tsx` | 3 rgba + 1 `'white'` |
| 4.12 | `e16d333` | `VersionModal.tsx` | 6 hex/rgba + 1 `'white'`; `#BBF7D0` → `var(--color-green)` |
| 4.13 | `71f72ce` | `RbacModal.tsx` | 2 hex/rgba; SELECTED pill Tailwind blue triad → brand navy via `color-mix(in srgb, var(--color-primary) 20%/30%, transparent)` |
| 4.14 | `97d6de7` | `ExportModal.tsx` | 19 hex/rgba + 5 `'white'`/`'#fff'`; `#6b7280`→`var(--color-grey-mid)`; `#2563EB`→`var(--color-navy)`; `#7C3AED`→`TOKEN_PLAN_COLOR.enterprise.color`; same alpha-derivation rewrite as PlanBadge |
| 4.15 | `48e5f3d` | `RealEstatePlatform.tsx` | 6 hex/rgba in JSX overlay blocks. Dark-mode plumbing (lines 295-330: `darkMode` useState, `body.dataset.refmTheme` useEffect, `toggleDarkMode` callback) preserved byte-identical |
| docs | `71e4822` | docs + settings | Compacted CLAUDE.md + refreshed handoff/feature/route/todo notes between Phases 4.6 and 4.7 |

**Canonical resolutions made during this sweep:**
- Hospitality color: `#7c3aed` was off-canon Tailwind enterprise-tier purple; `Module1Financing.tsx:122` already maps hospitality to `var(--color-navy-mid)` — aligned every REFM hospitality reference
- PLAN_COLOR is now centralized in `src/styles/tokens.ts` — components import from the canonical palette so per-file grep stays clean even where CSS vars cannot be used (PLAN_COLOR.enterprise stays as a literal hex inside tokens.ts because color-mix on CSS-var values doesn't survive in places like react-pdf)
- Hex-suffix alpha pattern (`${color}1A` / `${color}40`) replaced with `color-mix(in srgb, ${color} 10%/25%, transparent)` so it works whether `${color}` is a literal hex or a `var(--token)` reference

**No new files, no new packages, no schema changes, no new API routes.** **Modified files:** 10 REFM components + 4 docs (`CLAUDE.md`, `CLAUDE-FEATURES.md`, `CLAUDE-TODO.md`, `PROJECT_HANDOFF.md`). Module 1 regression-guard snapshot stayed at 17.5 KB baseline; type-check + build green throughout. Both light + dark REFM themes render correctly.

---

## Modeling Hub foundation rebuild + REFM dark mode + Phase 4.2-4.5 retrofits (complete, 2026-04-30)

Eleven commits (`93ab0af`, `005e7ce`, `b4691b7`, `afd0e4d`, `6ae4344`, `dba0952`, `a75708f`, `e20f436`, `9a0fe71`, `cfca60a`, `11e098b`) completed three connected pieces of work:

**1. Phase 4 cookie-scope rollback (Option A)** — `93ab0af` reverted prior Phase 4 commits that introduced a NextAuth cookie-scope regression. Verified functional match to baseline `bcea1a7`.

**2. Foundation rebuild — Modeling Hub canonical landing on `app.*` subdomain** — eliminated cross-subdomain assumptions before resuming Phase 4. `app/portal/page.tsx` collapsed to a 5-line `redirect('${APP_URL}/modeling/dashboard')`. `/portal` removed from `MAIN_PATHS` in `next.config.ts`. `src/middleware.ts` swapped its non-admin `/admin/*` rejection redirect from `/portal` to `/`. `src/shared/email/templates/accountConfirmation.ts` re-targeted both `${APP_URL}/portal` references. `app/modeling/dashboard/page.tsx` repurposed from a 3-card grid to the canonical sidebar layout — server-fetches CMS keys `logo_url` + `logo_height_px` + `header_height_px` (defaults 36 / 64, matching main-site `NavbarServer`); renders topbar at `minHeight: headerHeight` and sidebar at `top: headerHeight, height: calc(100vh - ${headerHeight}px)`. Hub-level dark mode toggle via `localStorage['modelingDarkMode']` (default → `prefers-color-scheme`); `data-theme` does NOT leak into `/admin` or `/training`. **Cookie-scope bug deliberately out-of-scope** — NextAuth config NOT modified per session constraint; documented as a deferred known issue in CLAUDE-TODO.md.

**3. REFM workspace dark mode + Phase 4.2-4.5 retrofits + project name editing + Module Roadmap consolidation** — (a) ☀️/🌙 toggle in REFM Topbar with own `localStorage['refmDarkMode']` key (separate from hub toggle), default → `prefers-color-scheme`, scoped via `body[data-refm-theme="dark"] .app-shell` so it never bleeds into admin/training. New design token `--color-on-primary-navy: #FFFFFF` added to `app/globals.css` (NOT overridden in dark scope) — required because `--color-grey-white` is overridden to `#1A222F` in dark and would have flipped white-on-navy chrome to invisible. (b) Phase 4.2 OverviewScreen.tsx (4 literals + edit pencil + actionable empty state). Phase 4.3 ProjectsScreen.tsx (STATUS_COLORS + ACTIVE pill + per-row edit pencil). Phase 4.4 Sidebar.tsx (2 literals via `--color-on-primary-navy`). Phase 4.5 Topbar.tsx (12 literals; imports `DEFAULT_BRANDING` for OfficeColorPicker hex fallbacks since the picker uses `hexToRgb` and rejects CSS vars; `← Portal` → `← Hub`). (c) Project name editing wired: ProjectModal already supported edit mode but `onConfirm` was hardcoded — new `handleEditProject(name, location)` callback in `RealEstatePlatform.tsx` mutates active project, syncs state, persists to `localStorage refm_v2`, fires toast. Two UI entry points: Overview header pencil + ProjectsScreen row pencil, both gated on `can('canEditProject')`. Defensive hydration: `loadFromStorage()` drops a stale `activeProjectId` if it doesn't resolve. (d) Module Roadmap consolidation: Sidebar listed all 11 modules but Dashboard only showed 1-6 (drift bug). Both surfaces now consume `MODULES` from new file `src/hubs/modeling/platforms/refm/lib/modules-config.ts` (11 entries; `ModuleStatus = 'done' | 'soon' | 'pro' | 'enterprise'`). Dashboard introduces `STATUS_BADGE` map routed through design tokens + `color-mix()`.

**No new packages, no schema changes, no new API routes.** **One new file**: `src/hubs/modeling/platforms/refm/lib/modules-config.ts`. Type-check + build green at every commit; Module 1 regression-guard snapshot stays at 17.5 KB baseline (exit 0 each step).

---

## Watch enforcement removed; Mark Complete simplified (complete, 2026-04-29)

Two commits closed out the watch-enforcement experiment that started in migration 103:

- **`f583c70`** — global watch-percentage gate retired. 5 files deleted (`app/api/training/watch-enforcement/route.ts`, `app/api/admin/watch-enforcement-stats/route.ts`, `src/hubs/training/components/WatchProgressBar.tsx`, `src/hubs/training/lib/watch/watchEnforcementCheck.ts`, `src/hubs/training/lib/watch/watchThresholdVerifier.ts`). Server-side: `/api/training/certification-watch` + `/api/training/live-sessions/[id]/watched` no longer 403 on threshold and dropped the `manual_override` block; `verifyWatchThresholdMet` removed from `certificateEngine.issueCertificateForPending`; `loadWatchEnforcement` + `watchThresholdMet` + `watchDetails` removed from `certificateEligibility` and the consumer in `/admin/training-hub/certificates`. Client-side: enforcement state, manual override checkbox, ghost watch hint, `WatchProgressBar` mount, and the fetch to `/api/training/watch-enforcement` all stripped from both watch pages. Admin: the entire Watch Enforcement card on `/admin/training-settings` removed (global toggle, threshold slider, per-session bypass table, search/filters/sort, bulk row actions, summary stats, helper components, type definitions). Settings keys (`watch_enforcement_enabled` / `watch_enforcement_threshold` / `watch_enforcement_bypass_*`) remain in `training_settings` but no code reads them. Net: -1548 lines across 21 files. The interval-merging tracker stays running for analytics fidelity (admin Watch Progress + Platform Analytics + per-live-session-assessment opt-in `require_watch_before_assessment` gate).
- **`f790fa9`** — Mark Complete now surfaces 20 seconds before the video ends. The tick fallback inside `YouTubePlayer.tsx` changed from `currentTime >= duration - 1` to `currentTime >= duration - 20`. Detection chain (single-fire guarded by `endedFired`): tick at d-20 (primary), `PlayerState.ENDED` (final fallback), PAUSED-at-`d - 1` (corner case). Both watch pages share the `onEnded` prop so the change applies uniformly.

**No new files, no new packages, no schema changes, no new API routes.** Skip-to-end is now permitted by design — certificate credibility comes from the model-submission gate (migration 148), not watch percentage.

---

## Certificate credibility upgrade — model-submission gate (complete, 2026-04-29; gate dormant)

Migration 148 plus six rollout phases (A → F.4) shipped during the 2026-04-29 session. The full code path is in production but the gate is **dormant**: every per-course `model_submission_required_<course>` flag in `training_settings` ships `'false'`, so until admin flips one, the system behaves exactly like the pre-migration platform.

**Manual cutover procedure:**

1. **Apply migration 148** via the Supabase dashboard (idempotent — re-runs are no-ops). This creates the `model_submissions` table, the private `model-submissions` storage bucket, and seeds 7 settings rows.
2. **Configure Phase F.1 admin alerts** at `/admin/training-settings` → Model Submission Gate → "📧 New-submission email alerts": enter the recipient email, leave the Alerts toggle ON, click Save. Empty recipient = alerts off (documented).
3. **Populate Phase F.2 guidance** in the same card → "📝 Per-course guidance + sample template": write what students should build for 3SFM and BVM, paste optional sample-template URLs (Supabase storage, Drive, GitHub — anything `https://`). Save each course independently. The student card backs out to a baked default if guidance is empty.
4. **Broadcast the existing-student notice** via `npx tsx --env-file=.env.local scripts/model_submission_notice_broadcast.ts --scope all --dry-run` (preview), then drop `--dry-run` to send. Per-scope idempotency stamps in `training_settings` prevent duplicate sends; use `--force` only after investigating a partial-failure run.
5. **Wait the configured notice period** (`model_submission_notice_days`, default 7) so students have time to start building.
6. **Flip the per-course gate** at `/admin/training-settings` → Model Submission Gate. Toggle `Require Model for 3SFM` and/or `Require Model for BVM` ON. The confirm dialog explains the immediate effect (Final Exam SessionCard switches to a "Submit your model" lock for every student who has not yet sat the Final Exam). Each flip is captured in `admin_audit_log` with action `model_submission_gate_change` + before/after values.
7. **Optionally flip `Announcement Only` OFF** once enforcement is live so the soft-launch banner stops showing alongside the live upload UI.

**Daily operations:**
- Reviews land in the queue at `/admin/training-hub/model-submissions`. Status / course / search filters + paginated list. Each row opens a modal with student details, file preview iframe, reviewer-note textarea, and Approve / Reject actions.
- The 08:00 UTC stale-submission cron at `/api/cron/model-submission-stale` emails a digest to the F.1 recipient when any pending submission has been waiting longer than `model_submission_stale_threshold_days` (default 2). Reuses the F.1 enable + recipient settings.
- Force-issue from `/admin/training-hub/certificates` continues to bypass the gate as the documented admin escape hatch (the cert engine respects `options.force=true`).

**Rolling back:** to disable the gate after enabling it, flip `model_submission_required_<course>` back to `'false'` via the admin UI. Already-pending rows stay in the queue and remain reviewable, but they no longer block the Final Exam. To remove the feature entirely, drop the table and bucket via a new migration (data + uploaded files are lost) — schema-only re-introduction is just re-applying migration 148.

---

## 8-phase folder restructure (complete, 2026-04-29)

Phases 2.1–2.8 of `RESTRUCTURE_PLAN.md` shipped as separate commits, each independently revertable, with `npm run verify` (type-check + lint + build) green between every step.

- **Phase 2.1**: target folder scaffolding (`src/core/`, `src/shared/`, `src/hubs/{main,training,modeling}/`, `src/features/`, `src/integrations/`).
- **Phases 2.2–2.5**: ~220 files moved via `git mv` so history is preserved (commits `Restructure 2.2` through `Restructure 2.5`). One Vercel build break in Phase 2.5 (sed-edited importers were unstaged when only renames were committed; fixed in `463ff8a` by explicitly staging all 25 modified files).
- **Phase 2.6**: cleaned up the 5 cross-hub violations from `PLATFORM_INVENTORY.md`. Share family relocated to `src/shared/share/`. `comingSoonGuard` dependency-inverted into a pure `shouldGateComingSoon` primitive at `src/shared/comingSoon/guard.ts` plus per-hub adapters. `COURSES`-aware share resolver extracted to `src/hubs/training/lib/share/resolveCourseName.ts`.
- **Phase 2.7**: 8 path aliases (`@core`, `@shared`, `@training`, `@modeling`, `@platforms`, `@main`, `@features`, `@integrations`) + `eslint-plugin-boundaries` v6 enforcement. CI now blocks any new cross-hub regression.
- **Phase 2.8**: documentation only — this file plus CLAUDE.md / CLAUDE-DB.md / CLAUDE-ROUTES.md / CLAUDE-FEATURES.md / `ARCHITECTURE.md` updated to reflect the new layout.

Net source-tree state: 0 cross-hub violations on the original 5; one TODO-tracked deferred suppression in `src/shared/auth/nextauth.ts` for the planned NextAuth `authorize()` dependency-inversion follow-up. All 206 routes still serve, no behavior changes, no migrations needed.

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
| Watch tracking (recordings) | ✅ Complete | `session_watch_history` table, 50 points on first watch. Rebuilt 2026-04-28 (migrations 146 + 147) — JSONB `watch_intervals` for cross-session accumulation, `completed_via` provenance, manual override path at >=50% + admin force-unlock. See "Watch Tracking Rebuild" row in CLAUDE-FEATURES.md. |
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
| Users management | ✅ Complete | User list and management |
| Training Hub section | ✅ Complete | 9 specialized sub-pages |
| Live Sessions management | ✅ Complete | Full CRUD + notifications + registrations modal |
| Certificate editor | ✅ Complete | Dual layout editor |
| Badge editor | ✅ Complete | Field positions + live preview |
| Transcript editor | ✅ Complete | CMS-driven + PDF preview |
| Certificates management | ✅ Complete | Sync, upload, generate, auto-generation toggle |
| Training settings | ✅ Complete | Apps Script URL, shuffle toggles, timer bypass |
| Testimonials (all/training/modeling) | ✅ Complete | Hub-specific filtering |
| Branding | ✅ Merged into Header Settings (2026-04-28, commit `ab5db30`) | Brand Colors section now lives at the top of `/admin/header-settings`. `/admin/branding` is a 5-line server redirect to the new home so existing bookmarks keep working. Same `/api/branding` GET + PATCH endpoints, same `branding_config` table, same `BrandingThemeApplier` consumer — only the editing surface relocated. Sidebar entry removed; Header Settings gains `matchPaths: ['/admin/branding']`. |
| Pricing | ✅ Single Platform Pricing surface | `/admin/pricing` rewritten 2026-04-28 (commits `50e22fa` + `777e1bf`) — no tab bar. Plans tab + Page Content tab + Pricing Features tab + Module Access tab all removed across 2026-04-27 / 2026-04-28. Migration 145 dropped `pricing_plans` (commit `777e1bf`). Hero text + FAQ for the public `/pricing` page are now edited in **Page Builder → Pricing** (slug='pricing'); the public page reads `page_sections` directly. Plan-based feature gating ripped out in commit `d8405e5`; REFM premium features lock to `false` until paid tiers go live. |
| Audit log | ✅ Complete | `AuditLogViewer` component |
| System health | ✅ Complete | `SystemHealth` component |
| Media management | ✅ Complete | Upload and manage assets |
| Modules config | ✅ Complete | Module configuration panel |
| Founder profile | ✅ Complete | Admin founder page editor (Page Builder → team) |
| Contact submissions | ✅ Complete | View + update status |
| Projects browser | ✅ Complete | REFM saved projects |

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
| Pricing enforcement not implemented | REFM | Plan-based feature gating system was removed 2026-04-27 (commit `d8405e5`). REFM `canAccess()` stubs to `false`, locking premium features pre-launch. Pricing tables `pricing_features` + `pricing_modules` were dropped in migration 144; the generic `pricing_plans` catalog was dropped in migration 145 (2026-04-28). When paid tiers launch, gating returns as a focused new feature spec — server-enforced from day one, built on the surviving `platform_pricing` + `platform_features` + `plan_feature_access` tables. |

### P2 — Visual consistency

| Bug | Location | Details |
|-----|----------|---------|
| Public page cards don't match dashboard | `app/training-sessions/SessionsClient.tsx` | Cards are inline-styled divs. Dashboard uses `SessionCard.tsx`. No shared component exists. |
| Dashboard preview vs full listing mismatch | `UpcomingSessionsPreview.tsx` vs `live-sessions/page.tsx` | Two different card designs for the same sessions. |

### P3 — Minor / cosmetic

| Bug | Location | Details |
|-----|----------|---------|
| Instructor title fallback text | `app/training-sessions/[id]/DetailClient.tsx:268` | Falls back to "Financial Modeling Expert" when title is empty. May not be desired for all instructors. Null guards are in place (`&&` and `||`). |

### Not bugs — verified working
- Instructor title null checks: properly guarded with `&&` / `||` across all surfaces
- Profile photo crop: react-easy-crop integrated, square aspect, zoom slider
- Points/streak: loads from activity API, displays in dashboard
- No TODO/FIXME/HACK comments found in codebase

---

## 3. Last 11 Git Commits (2026-04-30 continuation session — Phases 4.6-4.15)

| Hash | Date | Message |
|------|------|---------|
| `48e5f3d` | 2026-04-30 | Phase 4.15: retrofit RealEstatePlatform onto design tokens (last in sweep) |
| `97d6de7` | 2026-04-30 | Phase 4.14: retrofit ExportModal onto design tokens |
| `71f72ce` | 2026-04-30 | Phase 4.13: retrofit RbacModal onto design tokens |
| `e16d333` | 2026-04-30 | Phase 4.12: retrofit VersionModal onto design tokens |
| `f0535b8` | 2026-04-30 | Phase 4.11: retrofit ProjectModal onto design tokens |
| `2e486c1` | 2026-04-30 | Phase 4.10: retrofit PlanBadge onto design tokens |
| `7a318cd` | 2026-04-30 | Phase 4.9: retrofit Module1Financing onto design tokens (FAST cell pattern) |
| `0226e22` | 2026-04-30 | Phase 4.8: retrofit Module1Costs onto design tokens (FAST cell pattern) |
| `273ec50` | 2026-04-30 | Phase 4.7: retrofit Module1Area onto design tokens (FAST cell pattern from Phase 4.6) |
| `71e4822` | 2026-04-30 | docs + settings: compact CLAUDE.md, refresh handoff/feature/route/todo notes |
| `cd9740f` | 2026-04-30 | Phase 4.6: retrofit Module1Timeline onto design tokens + establish FAST cell pattern for Module 1 |

The continuation session closed out the entire REFM design-token retrofit. Prior session (also 2026-04-30, commits `93ab0af` → `11e098b`) had completed Phases 4.2-4.5 plus the Modeling Hub foundation rebuild on `app.*` subdomain + REFM workspace dark mode + Module Roadmap consolidation. With Phases 4.6-4.15 shipped, all REFM components in `src/hubs/modeling/platforms/refm/` are now canonical-token-only — `grep -E '(#[0-9a-f]{3,8}|rgba?\(|"white"|input-assumption)'` returns zero matches across the folder.

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
| `CRON_SECRET` | Bearer token for Vercel cron job auth (`/api/cron/session-reminders`, `/api/cron/auto-launch-check`, `/api/cron/newsletter-scheduled`). Certificate cron retired — certificates issue inline on final-exam submit. |
| `APPS_SCRIPT_URL` | Google Apps Script deployment URL (primary, fallback in DB) |
| `RESEND_WEBHOOK_SECRET` | Resend webhook signing secret (`whsec_...`) for `/api/webhooks/resend` (newsletter delivery / open / click / bounce / complaint events) |
| `AZURE_TENANT_ID`, `AZURE_CLIENT_ID`, `AZURE_CLIENT_SECRET`, `TEAMS_HOST_USER_EMAIL` | Microsoft Graph credentials for live-session Teams meeting auto-generation |
| `YOUTUBE_API_KEY`, `NEXT_PUBLIC_YOUTUBE_CHANNEL_ID` | YouTube Data API v3 key + channel ID for cached comments + Subscribe button |

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
4. **Code location**: `src/hubs/training/lib/appsScript/sheets.ts` handles the resolution

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

The most recent session (2026-04-30 continuation) was the **REFM Phase 4.6-4.15 design-token retrofit closeout** — eleven commits (10 retrofit + 1 docs compaction) finishing the entire `src/hubs/modeling/platforms/refm/` token sweep. See the top section "REFM Phase 4.6-4.15 design-token retrofit (continuation, 2026-04-30)" for the per-phase commit table. **Net: 10 component files + 4 docs modified, 0 new files, 0 packages, 0 schema changes, 0 new API routes.** Module 1 regression-guard snapshot stayed at 17.5 KB baseline (exit 0 each step); type-check + build green at every commit; both light and dark REFM themes verified.

The session before that (2026-04-30, commits `93ab0af` → `11e098b`) was a **Modeling Hub foundation rebuild + Phase 4.x retrofit resumption**. Eleven commits across three connected pieces of work:

### Changes made (commits `93ab0af` → `11e098b`)
- **Phase 4 cookie-scope rollback (Option A, `93ab0af`)**: combined revert of prior Phase 4 commits that introduced a NextAuth cookie-scope regression. Verified functional match to baseline `bcea1a7`, snapshot diff exit 0, type-check + build clean, then pushed.
- **Foundation rebuild on app.* subdomain (`005e7ce`)**: eliminated cross-subdomain assumptions before resuming Phase 4. `app/portal/page.tsx` collapsed to a 5-line `redirect('${APP_URL}/modeling/dashboard')`. `/portal` removed from `MAIN_PATHS` in `next.config.ts`. `src/middleware.ts` swapped non-admin `/admin/*` rejection redirect from `/portal` to `/`. `accountConfirmation.ts` re-targeted `${APP_URL}/portal` references. `app/modeling/dashboard/page.tsx` repurposed from a 3-card grid to the canonical sidebar layout (server-fetches CMS keys for header dimensions; renders topbar + sidebar; owns hub-level dark mode via `localStorage['modelingDarkMode']`). Cookie-scope bug deliberately out-of-scope per session constraint — NextAuth config NOT modified; documented as deferred known issue.
- **REFM workspace dark mode (`b4691b7`)**: ☀️/🌙 toggle in Topbar with own `localStorage['refmDarkMode']` key. New design token `--color-on-primary-navy: #FFFFFF` (NOT overridden in dark) added to `globals.css` because `--color-grey-white` is overridden to `#1A222F` in dark scope and would have flipped white-on-navy chrome to invisible. Theme scoped via `body[data-refm-theme="dark"] .app-shell`.
- **Phase 4.2 OverviewScreen.tsx (`afd0e4d`)**: 4 hardcoded literals replaced + edit pencil ✏️ next to project name + actionable empty state when activeProjectId is stale.
- **Project edit pencil + Phase 4.3 ProjectsScreen.tsx (`6ae4344` + `a75708f`)**: per-row pencil ✏️ Edit button + token retrofit (STATUS_COLORS map + ACTIVE pill).
- **Module Roadmap consolidation (`dba0952` + `e20f436`)**: new file `src/hubs/modeling/platforms/refm/lib/modules-config.ts` is single source of truth for all 11 modules; Sidebar + Dashboard both consume it. Drift bug (Sidebar showed 11, Dashboard showed 1-6) fixed.
- **Phase 4.4 Sidebar.tsx (`9a0fe71`)**: 2 inline rgba literals replaced via `--color-on-primary-navy`.
- **Project name editing wired (`cfca60a`)**: `handleEditProject(name, location)` callback in `RealEstatePlatform.tsx` mutates active project, syncs state, persists to `localStorage refm_v2`. Defensive hydration cleanup of stale activeProjectId.
- **Phase 4.5 Topbar.tsx (`11e098b`)**: 12 hardcoded literals replaced; imports `DEFAULT_BRANDING` so OfficeColorPicker fallbacks stay as actual hex; `← Portal` → `← Hub`.

**Net total**: 11 commits, 1 new file (`modules-config.ts`), 13 modified files, 0 packages, 0 schema changes, 0 new API routes.

### Manual action required
None. All changes are code-only.

### Unfinished from that session
None — all 11 commits shipped to `origin/main`. Type-check + full build passed at every step. Module 1 regression-guard snapshot stays at 17.5 KB baseline (exit 0 each step).

### Deferred known issue
**NextAuth cookie scope** — Phase 4 had attempted to introduce a Domain-attribute cookie scope to support cross-subdomain navigation, and that change broke admin auth. The Path 2 foundation rebuild eliminated the cross-subdomain assumption (Modeling Hub is end-to-end on `app.*`), so the default exact-host cookie scope works. If a future session needs SSO between admin/main + app.*, revisit Phase 4's commits as the starting point and wire the CSRF + session token cookies together so they share a domain-scope policy; do NOT cherry-pick just the cookie config.

---

## 7-prior. Earlier session (2026-04-28) — admin cleanup follow-up

The 2026-04-28 session was a **follow-up admin cleanup** continuing the trim work from 2026-04-27. Three further surfaces consolidated:

### Changes made (commits `ab5db30` → `777e1bf`)
- **Part A** (`ab5db30`): Branding merged into Header Settings. After 2026-04-27's Phase 4 reduced `/admin/branding` to two color fields, the dedicated page was a thin wrapper. Brand Colors section moved to the top of `/admin/header-settings`, wired to the same `/api/branding` GET + PATCH endpoints. `saveAll()` now fires the cms_content writes plus `/api/branding` PATCH in parallel. `/admin/branding/page.tsx` reduced to a 5-line server `redirect('/admin/header-settings')`. Sidebar Branding entry removed; Header Settings gains `matchPaths: ['/admin/branding']` so the rail stays highlighted on stale links. `BrandingThemeApplier` + `branding_config` table + `--color-primary` / `--color-secondary` injection all unchanged. Net -349 / +102.
- **Part B-2** (`50e22fa`): Pricing Page Content tab removed. Diagnosis surfaced a real bug: the tab wrote to `cms_content` (section='pricing_page') but Page Builder writes to `page_sections` (slug='pricing'); the public `/pricing` page only read from `cms_content`, so Page Builder edits for the pricing slug were dead writes. Migration 046 had already seeded `page_sections` correctly, so `/pricing` was repointed to `getAllPageSections('pricing')` — hero badge / title / subtitle from `pricing.hero` content, FAQ items from `pricing.faq` content's `items[]` (with per-item `visible !== false` filter). Tab type narrowed to `'plans' \| 'platform'`. Net -84 / +35.
- **Part B-1** (`777e1bf`): Plans tab removed + migration 145. The generic Free/Starter/Professional/Enterprise plan catalog (`pricing_plans`, migs 014/018) was the original pricing model but never wired into payment or feature gating — `platform_pricing` + `platform_features` + `plan_feature_access` (migs 076/077) is the canonical per-platform model that drives the public pricing page. Home-page pricing-teaser plan-name pill row removed (only public consumer); replaced with a clean "View Full Pricing →" CTA-only block. With Plans gone + Page Content gone, only Platform Pricing remained — `/admin/pricing/page.tsx` rewritten with no tab bar at all. Files deleted: `app/api/admin/pricing/plans/route.ts`, the local `getPublicPlanNames()` helper in home page, the orphan `getPublicPlanNames()` export in `src/lib/shared/cms.ts`. `Plan` / `UserOption` / `FormState` types + `BLANK_FORM` + `PlanCard` sub-component + plan handlers + user-search effect all gone. Migration 145: `DROP TABLE IF EXISTS pricing_plans CASCADE`. Net -598 / +156.

**Net total**: ~-1031 lines across 3 commits, 7 files modified, 1 file deleted, 1 migration created.

### Manual action required
- **Apply migration 145 via Supabase dashboard SQL editor before next deploy.** Migration 144 from the 2026-04-27 session has already been run. Migration 145 is idempotent (`IF EXISTS` + `CASCADE`) so re-runs are safe.

### Unfinished from that session
None — all 3 commits shipped to `origin/main`. Type-check + full build passed at every step. Both migrations 144 and 145 confirmed applied in Supabase.

---

## 8. Next Steps (prioritized)

### Immediate (polish from last session)
1. Test join button flow end-to-end with a real upcoming session
2. Verify badge images display correctly (check `badge_url` population)
3. NextAuth `authorize()` dependency inversion (lift the one remaining `eslint-disable boundaries/dependencies` in `src/shared/auth/nextauth.ts` by exposing an `authorizeOptions: { extraGates: BypassCheck[] }` opt — see CLAUDE.md follow-ups)

### Short-term
4. Reintroduce pricing/subscription enforcement as a focused new feature spec when paid tiers go live (the previous system was removed 2026-04-27 in commit `d8405e5` — admin-only with no server-side gating). Server-enforced from day one, smaller surface than the deleted system.
5. Complete AI contextual help agent (stub exists)

### Medium-term
7. REFM Module 2: Revenue Analysis
8. REFM Module 3: Operating Expenses
9. REFM Module 4: Returns & Valuation
10. REFM Modules 7-9

### Long-term
11. 9 additional modeling platforms (BVM, FPA, ERM, PFM, LBO, CFM, EUM, SVM, BCM)

---

## 9. Key File Quick Reference

> Path aliases (`@core/`, `@shared/`, `@training/`, `@modeling/`, `@platforms/`, `@main/`, `@features/`, `@integrations/`) are defined in `tsconfig.json`. See `ARCHITECTURE.md` for the full alias table + boundary rules.

| What | Where |
|------|-------|
| Project rules | `CLAUDE.md` |
| Architecture rationale | `ARCHITECTURE.md` |
| Database docs | `CLAUDE-DB.md` |
| Feature specs | `CLAUDE-FEATURES.md` |
| Route map | `CLAUDE-ROUTES.md` |
| Backlog | `CLAUDE-TODO.md` |
| NextAuth options (admin auth) | `src/shared/auth/nextauth.ts` |
| Training Hub session helpers | `src/hubs/training/lib/session/training-session.ts` |
| Apps Script calls | `src/hubs/training/lib/appsScript/sheets.ts` |
| Certificate engine | `src/hubs/training/lib/certificates/certificateEngine.ts` |
| Email templates | `src/shared/email/templates/` |
| Design tokens | `app/globals.css` |
| Supabase client | `src/core/db/supabase.ts` |
| CMS helpers | `src/shared/cms/index.ts` |
| Navbar | `src/shared/components/layout/Navbar.tsx` |
| Training dashboard page | `app/training/dashboard/page.tsx` |
| Admin entry | `app/admin/page.tsx` |

---

## Migrations Status

**Latest**: `148_model_submissions.sql` (model-submission gate — 2026-04-29; gate dormant by default).
**Next number**: `149` (numbering gaps at `069`, `073`, `127` are skipped, not missing — see CLAUDE-DB.md).
**Manual apply**: migration `148` must be applied via Supabase dashboard before deploy (idempotent). Migrations `146` + `147` are also manual-apply (idempotent `ADD COLUMN IF NOT EXISTS`).
**Rule**: Never edit existing migrations; create new numbered files.
**2026-04-30 session (Phases 4.2-4.5 + foundation rebuild)**: no new migrations.
**2026-04-30 continuation session (Phases 4.6-4.15)**: no new migrations.
