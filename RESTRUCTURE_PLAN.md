# Folder Restructure Plan

> Phase 1 deliverable. Read PLATFORM_INVENTORY.md first; this document depends on it.
> Generated 2026-04-28. Single Next.js deployment, internal reorganization for future portability.
> Training Hub is LIVE with 30+ active students; every phase is independently revertable.

---

## Section 0. Goal and Non-Goals

### Goal

Reorganize `src/` and `app/` so that Training Hub, Modeling Hub, Main Site, and individual Modeling Hub platforms (REFM, BVM stub, ...) sit in clearly-bounded folders. The reorganization makes a future split into separate deployments mechanical rather than archaeological. After this work, lifting any single hub into its own repo is a copy-and-rewire pass, not a refactor.

### Non-goals

- **Not a monorepo conversion.** No pnpm workspaces, no Turborepo, no `apps/*` + `packages/*`. Exactly one Next.js build still produces every hub.
- **Not a behavioral change.** Every URL keeps returning the same content, every API keeps the same shape, every cookie keeps the same name. Pure file moves and import updates.
- **Not a database change.** No migrations, no table renames, no column moves.
- **Not an admin separation.** Admin remains cross-hub. Admin pages keep importing hub-specific libraries because that is admin's job.
- **Not a deployment change.** Vercel project, env vars, cron schedules, subdomain rewrites all unchanged.

### Success criteria

- After every phase, `npm run verify` passes (type-check + lint + build).
- After every phase, manual smoke test of `/`, `/training`, `/modeling`, `/training/dashboard` (with cookie), `/admin` returns 200 with the same render.
- After every phase, the boundary grep from PLATFORM_INVENTORY.md Section 9 shows only the violations that phase explicitly intended to fix.
- Each phase is one commit; `git revert <hash>` is the rollback for any phase.

---

## Section A. Proposed Target Structure

The current split (PLATFORM_INVENTORY.md Section 8) is already largely hub-aligned. The target structure formalizes the existing convention rather than inventing a new one.

### A.1 Top-level layout (post-restructure)

```
financial-modeler-pro/
+-- app/                                 Next.js App Router (URL contract; do not move route files)
|   +-- (cms)/                           Catch-all CMS pages
|   +-- (portal)/                        Home (CMS Option B)
|   +-- about/                           Founder
|   +-- admin/                           Admin pages (cross-hub by design)
|   +-- api/                             API routes (kept as-is; see A.4)
|   +-- articles/, book-a-meeting/, contact/, pricing/
|   +-- forgot-password/, reset-password/, settings/, t/, testimonials/
|   +-- portal/                          Authed multi-platform hub
|   +-- modeling/                        Modeling Hub pages
|   +-- refm/                            REFM mount
|   +-- training/                        Training Hub pages
|   +-- training-sessions/               Public live-session pages (canonical learn.*)
|   +-- verify/                          Cert verification (canonical learn.*; cross-hub surface)
|   +-- globals.css, layout.tsx, not-found.tsx, robots.ts, sitemap.ts
+-- src/
|   +-- core/                            Hub-agnostic infrastructure (DB client, env, types)
|   |   +-- db/
|   |   |   +-- supabase.ts              Moved from src/lib/shared/supabase.ts
|   |   +-- env/
|   |   |   +-- urls.ts                  Moved from src/lib/shared/urls.ts (or deleted)
|   |   +-- types/                       Moved from src/types/ (project, scenario, revenue, deck, branding, settings)
|   |   +-- calculations/                Moved from src/core/core-calculations.ts
|   |   +-- formatters/                  Moved from src/core/core-formatters.ts
|   |   +-- state/                       Moved from src/core/core-state.ts
|   |   +-- branding/                    Moved from src/core/branding.ts
|   +-- shared/                          Cross-hub primitives only. No hub-specific imports allowed.
|   |   +-- auth/
|   |   |   +-- nextauth.ts              Moved from src/lib/shared/auth.ts
|   |   |   +-- deviceTrust.ts
|   |   |   +-- emailConfirmation.ts
|   |   |   +-- password.ts
|   |   |   +-- captcha.ts
|   |   +-- comingSoon/
|   |   |   +-- guard.ts                 Moved from comingSoonGuard.ts (dependency-inverted; see C.1)
|   |   |   +-- bypassList.ts            Moved from hubBypassList.ts
|   |   +-- cms/                         Moved from src/lib/shared/cms.ts
|   |   +-- email/                       Moved from src/lib/email/
|   |   +-- newsletter/                  Moved from src/lib/newsletter/
|   |   +-- seo/                         Moved from src/lib/seo/, src/components/seo/
|   |   +-- storage/                     Moved from src/lib/shared/storage.ts
|   |   +-- audit/                       Moved from src/lib/shared/audit.ts
|   |   +-- ogFonts/                     Moved from src/lib/shared/ogFonts.ts
|   |   +-- htmlUtils/                   Moved from src/lib/shared/htmlUtils.ts
|   |   +-- share/                       NEW: ShareModal + shareTemplates + useShareTemplate + share.ts
|   |   |                                (relocated from training to break Category 4 violations)
|   |   +-- components/
|   |   |   +-- BrandingThemeApplier.tsx, CountdownTimer.tsx, FollowPopup.tsx, PhoneInput.tsx,
|   |   |   |   PreLaunchBanner.tsx, SessionProviderWrapper.tsx, ShareExperienceModal.tsx,
|   |   |   |   SiteFollowPopup.tsx, UpgradePrompt.tsx
|   |   |   +-- ui/                      Moved from src/components/ui/ (ColorPicker, OfficeColorPicker, Toaster)
|   |   |   +-- layout/                  Moved from src/components/layout/ (Navbar, NavbarServer)
|   |   +-- hooks/                       Moved from src/hooks/ (useInactivityLogout, useRequireAuth, useRequireAdmin, useProject)
|   +-- hubs/
|   |   +-- main/
|   |   |   +-- components/
|   |   |   |   +-- landing/             Moved from src/components/landing/
|   |   |   |   +-- booking/             Moved from src/components/booking/
|   |   |   |   +-- cms/                 Moved from src/components/cms/ (CmsField + 21 SectionRenderer subcomponents)
|   |   |   |   +-- newsletter/          Moved from src/components/newsletter/ (subscribe form)
|   |   |   |   +-- pricing/             Moved from src/components/pricing/ (PricingAccordion)
|   |   |   |   +-- testimonials/        (Empty until content moves)
|   |   |   +-- lib/                     (Empty for now; future home for main-only helpers)
|   |   +-- training/
|   |   |   +-- components/
|   |   |   |   +-- TrainingShell.tsx, DashboardTour.tsx, StudentNotes.tsx, SubscribeModal.tsx,
|   |   |   |   |   WatchProgressBar.tsx, WelcomeModal.tsx, YouTubeComments.tsx, YouTubePlayer.tsx,
|   |   |   |   |   CountdownTimer.tsx, CalendarDropdown.tsx
|   |   |   |   +-- dashboard/           From src/components/training/dashboard/
|   |   |   |   +-- player/              From src/components/training/player/
|   |   |   |   +-- sessions/            From src/components/sessions/
|   |   |   +-- lib/
|   |   |   |   +-- session/             training-session.ts, trainingSessionCookie.ts
|   |   |   |   +-- assessment/          shuffle.ts, attemptInProgress.ts, attemptInProgressClient.ts,
|   |   |   |   |                          liveSessionAssessments.ts
|   |   |   |   +-- progress/            progressCalculator.ts, progressFromSupabase.ts
|   |   |   |   +-- watch/               watchTracker.ts, watchEnforcementCheck.ts, watchThresholdVerifier.ts,
|   |   |   |   |                          videoTimer.ts, detectVideoChange.ts
|   |   |   |   +-- certificates/        certificateEngine.ts, certificateEligibility.ts, certificateLayout.ts,
|   |   |   |   |                          certifier.ts
|   |   |   |   +-- liveSessions/        liveSessionsForStudent.ts, calendar.ts, sessionAnnouncement.ts
|   |   |   |   +-- comingSoon.ts        From trainingComingSoon.ts
|   |   |   |   +-- appsScript/          appsScript.ts, sheets.ts, regIdAllocator.ts, studentRoster.ts
|   |   |   +-- config/                  From src/config/courses.ts
|   |   +-- modeling/
|   |   |   +-- components/
|   |   |   |   +-- shell/               (Empty for now; future shared modeling chrome)
|   |   |   +-- lib/
|   |   |   |   +-- access.ts            From modelingAccess.ts
|   |   |   |   +-- comingSoon.ts        From modelingComingSoon.ts
|   |   |   +-- config/                  From src/config/platforms.ts
|   |   |   +-- platforms/
|   |   |   |   +-- refm/
|   |   |   |   |   +-- components/      From src/components/refm/ (everything: Dashboard, Topbar, Sidebar,
|   |   |   |   |   |                          OverviewScreen, ProjectsScreen, RealEstatePlatform, modules/, modals/)
|   |   |   |   |   +-- lib/             From src/lib/modeling/real-estate/ (modules + export)
|   |   |   |   +-- bvm/                 (Reserved; empty)
|   |   |   |   +-- fpa/, erm/, pfm/, lbo/, cfm/, eum/, svm/, bcm/  (Reserved; empty)
|   +-- integrations/                    Hub-neutral external services
|   |   +-- teams/                       Moved from src/lib/integrations/teamsMeetings.ts
|   |   +-- youtube/                     (Empty for now; future home)
|   |   +-- resend/                      (Captured by src/shared/email/)
|   |   +-- anthropic/                   (Future home; today /api/agents/* hosts the logic)
|   +-- features/
|   |   +-- marketing-studio/            Moved from src/lib/marketing-studio/ (hub-shared but feature-scoped)
|   +-- middleware.ts                    Stays at src/middleware.ts (Next.js convention)
|   +-- assets/                          Stays (Inter font files; consumed by satori)
|   +-- agents/                          (Decision: delete or fill out; see Quick Wins)
+-- public/                              Static assets (no change)
+-- supabase/                            Migrations (no change)
+-- scripts/                             Utility scripts (no change)
+-- next.config.ts, vercel.json, package.json, tsconfig.json
```

### A.2 Why this shape

- **Three-tier separation** (`core` -> `shared` -> `hubs`):
  - `core/` is hub-agnostic infrastructure that even `shared/` can depend on (DB client, types, env, math).
  - `shared/` is cross-hub primitives that hubs depend on (auth, email, newsletter, components used in 2+ hubs).
  - `hubs/` is hub-specific code. Hubs may depend on `core/` and `shared/`. Hubs MUST NOT depend on each other.
- **Platform sub-folders inside Modeling Hub**: every platform (REFM today; BVM, FP&A, ERM, ... tomorrow) lives at `src/hubs/modeling/platforms/<slug>/` with both `components/` and `lib/` co-located. When the day comes to lift REFM into its own deployment, everything is in one place.
- **Admin stays where it is** (`app/admin/*`). Admin is cross-hub by design (PLATFORM_INVENTORY.md Section 9, Category 3). Moving admin pages into hub folders would lose that signal.
- **`app/` does not move.** Route files keep their URLs. Only their imports change to point at the new `src/` paths.

### A.3 What NOT in this structure

- No `src/services/` layer. Services and lib live next to their hub.
- No `src/views/` or `src/pages/`. We have `app/`.
- No `src/store/` (Zustand stores live next to their feature).

### A.4 Why `app/api/` does not get hub sub-folders

Tempting alternative: split `app/api/` into `app/api/training/...`, `app/api/modeling/...`, `app/api/admin/...`. **Rejected** because:

- Today's path map is the URL contract. Moving `app/api/training/validate/route.ts` to `app/api/learn/validate/route.ts` would break every active student session.
- The current convention (`app/api/training/*` for Training Hub, `app/api/admin/*` for admin, etc.) already groups them logically. The folder names match the URL prefixes.
- The api layer's hub ownership is documented in PLATFORM_INVENTORY.md Section 7 and is sufficient for portability.

When the day comes to split a hub, the admin api routes that own that hub get copied with it; the public api routes go with the hub by virtue of their `/api/training/*` or `/api/training-sessions/*` prefix.

---

## Section B. File Move Map

Total files in `src/` (excluding stubs and empty directories): roughly 220. The map below groups every file by destination phase. A file appearing in Phase 2.x means that phase moves it.

### B.1 Phase 2.1 - Create empty target folders

No file moves. Just `mkdir -p` for the new tree:

```
src/core/db/, src/core/env/, src/core/calculations/, src/core/formatters/,
src/core/state/, src/core/branding/, src/core/types/
src/shared/auth/, src/shared/comingSoon/, src/shared/cms/, src/shared/email/,
src/shared/newsletter/, src/shared/seo/, src/shared/storage/, src/shared/audit/,
src/shared/ogFonts/, src/shared/htmlUtils/, src/shared/share/,
src/shared/components/, src/shared/components/ui/, src/shared/components/layout/,
src/shared/hooks/
src/hubs/main/components/landing/, .../booking/, .../cms/, .../newsletter/,
.../pricing/, src/hubs/main/lib/
src/hubs/training/components/, .../components/dashboard/, .../components/player/,
.../components/sessions/, src/hubs/training/lib/, .../lib/session/,
.../lib/assessment/, .../lib/progress/, .../lib/watch/, .../lib/certificates/,
.../lib/liveSessions/, .../lib/appsScript/, src/hubs/training/config/
src/hubs/modeling/components/, src/hubs/modeling/lib/, src/hubs/modeling/config/,
src/hubs/modeling/platforms/refm/components/, .../refm/lib/,
src/hubs/modeling/platforms/{bvm,fpa,erm,pfm,lbo,cfm,eum,svm,bcm}/
src/integrations/teams/, src/integrations/youtube/, src/integrations/resend/,
src/integrations/anthropic/
src/features/marketing-studio/
```

Risk level: **zero**. No imports change, no files move.

### B.2 Phase 2.2 - Move shared infrastructure (lowest risk)

| # | Current path | New path | Complexity | Notes |
|---|--------------|----------|------------|-------|
| 1 | `src/lib/shared/supabase.ts` | `src/core/db/supabase.ts` | Low | High-fanout (40+ importers); all consumers update via single sed |
| 2 | `src/lib/shared/audit.ts` | `src/shared/audit/index.ts` | Low | ~10 importers |
| 3 | `src/lib/shared/captcha.ts` | `src/shared/auth/captcha.ts` | Low | 4 importers |
| 4 | `src/lib/shared/cms.ts` | `src/shared/cms/index.ts` | Low | ~15 importers |
| 5 | `src/lib/shared/deviceTrust.ts` | `src/shared/auth/deviceTrust.ts` | Low | 6 importers |
| 6 | `src/lib/shared/emailConfirmation.ts` | `src/shared/auth/emailConfirmation.ts` | Low | 4 importers |
| 7 | `src/lib/shared/htmlUtils.ts` | `src/shared/htmlUtils/index.ts` | Low | 3 importers |
| 8 | `src/lib/shared/ogFonts.ts` | `src/shared/ogFonts/index.ts` | Low | 5 importers |
| 9 | `src/lib/shared/password.ts` | `src/shared/auth/password.ts` | Low | 4 importers |
| 10 | `src/lib/shared/storage.ts` | `src/shared/storage/index.ts` | Low | 5 importers |
| 11 | `src/lib/shared/urls.ts` | `src/core/env/urls.ts` (OR delete; see Quick Wins) | Low | 0 importers today |
| 12 | `src/lib/shared/auth.ts` | `src/shared/auth/nextauth.ts` | Medium | NextAuth options object; high-fanout |
| 13 | `src/lib/shared/hubBypassList.ts` | `src/shared/comingSoon/bypassList.ts` | Low | 2 importers |
| 14 | `src/lib/email/` (full folder) | `src/shared/email/` | Medium | 11 templates + 2 senders; ~30 importers |
| 15 | `src/lib/newsletter/` (full folder) | `src/shared/newsletter/` | Medium | 5 files; 8 importers |
| 16 | `src/lib/seo/canonical.ts` | `src/shared/seo/canonical.ts` | Low | 3 importers |
| 17 | `src/components/seo/*` | `src/shared/seo/components/*` | Low | 2 components, 4 importers |
| 18 | `src/components/shared/*` | `src/shared/components/*` | Low | 9 components, 25+ importers |
| 19 | `src/components/ui/*` | `src/shared/components/ui/*` | Low | 3 components, 5 importers |
| 20 | `src/components/layout/*` | `src/shared/components/layout/*` | Low | Navbar + NavbarServer; ~20 importers |
| 21 | `src/hooks/*` | `src/shared/hooks/*` | Low | 4 hooks, 30+ importers |
| 22 | `src/types/*` | `src/core/types/*` | Low | 7 type files; ~40 importers |
| 23 | `src/core/branding.ts` | `src/core/branding/index.ts` | Low | Already in core; just normalize folder shape |
| 24 | `src/core/core-calculations.ts` | `src/core/calculations/index.ts` | Low | REFM-only consumer |
| 25 | `src/core/core-formatters.ts` | `src/core/formatters/index.ts` | Low | REFM-only consumer |
| 26 | `src/core/core-state.ts` | `src/core/state/index.ts` | Low | REFM-only consumer |
| 27 | `src/core/core-validators.ts` | DELETE (2-line stub) | Low | Quick Win |

**File count this phase**: ~80 file moves (counting folder moves as their child files).
**Imports updated**: ~150 import statements.
**Risk level**: low. No hub-specific files move; only infrastructure that already lived in shared territory.

### B.3 Phase 2.3 - Move Main Site code

| # | Current path | New path | Complexity | Notes |
|---|--------------|----------|------------|-------|
| 28 | `src/components/landing/*` | `src/hubs/main/components/landing/*` | Low | ~10 components, 8 importers (mostly app/(portal), app/about, app/contact) |
| 29 | `src/components/booking/CalendlyEmbed.tsx` | `src/hubs/main/components/booking/CalendlyEmbed.tsx` | Low | 1 importer (`/book-a-meeting`) |
| 30 | `src/components/cms/*` | `src/hubs/main/components/cms/*` | Medium | CmsField + 21 SectionRenderers; consumed by main site, training, modeling marketing pages, admin Page Builder |
| 31 | `src/components/newsletter/NewsletterSubscribeForm.tsx` | `src/hubs/main/components/newsletter/NewsletterSubscribeForm.tsx` | Low | 2 importers (footer, training coming-soon) |
| 32 | `src/components/pricing/PricingAccordion.tsx` | `src/hubs/main/components/pricing/PricingAccordion.tsx` | Low | 1 importer (`/pricing`) |

**File count this phase**: ~35 files.
**Imports updated**: ~35 import statements.
**Risk level**: low. Main site is hub-neutral; nothing depends on these from a hub-specific path that would break.

**Caveat on `src/components/cms/`**: this folder is consumed by every hub's marketing landing page (training/page.tsx, modeling/page.tsx) plus admin Page Builder. It is genuinely shared, not main-site-only. **Decision (revisit if uncomfortable):** put it under `src/hubs/main/components/cms/` because main-site is the primary owner and it semantically renders CMS pages whose content lives in main-site tables; or alternatively put it under `src/shared/cms/components/` if the cross-hub consumption pattern feels stronger. Plan keeps it under `src/hubs/main/` for now; flip in this section if reviewer prefers shared.

### B.4 Phase 2.4 - Move Training Hub code (most critical)

This is the highest-risk phase. Training Hub is LIVE. Every move here must be followed immediately by `npm run verify` and a smoke test against `/training/dashboard` with a real session cookie.

#### B.4.a Components

| # | Current path | New path | Complexity |
|---|--------------|----------|------------|
| 33 | `src/components/training/TrainingShell.tsx` | `src/hubs/training/components/TrainingShell.tsx` | Medium |
| 34 | `src/components/training/DashboardTour.tsx` | `src/hubs/training/components/DashboardTour.tsx` | Low |
| 35 | `src/components/training/StudentNotes.tsx` | `src/hubs/training/components/StudentNotes.tsx` | Low |
| 36 | `src/components/training/SubscribeModal.tsx` | `src/hubs/training/components/SubscribeModal.tsx` | Low |
| 37 | `src/components/training/WatchProgressBar.tsx` | `src/hubs/training/components/WatchProgressBar.tsx` | Low |
| 38 | `src/components/training/WelcomeModal.tsx` | `src/hubs/training/components/WelcomeModal.tsx` | Low |
| 39 | `src/components/training/YouTubeComments.tsx` | `src/hubs/training/components/YouTubeComments.tsx` | Low |
| 40 | `src/components/training/YouTubePlayer.tsx` | `src/hubs/training/components/YouTubePlayer.tsx` | Medium - load-bearing for watch tracking |
| 41 | `src/components/training/CountdownTimer.tsx` | `src/hubs/training/components/CountdownTimer.tsx` | Low - if it duplicates `src/shared/components/CountdownTimer.tsx`, dedupe |
| 42 | `src/components/training/CalendarDropdown.tsx` | `src/hubs/training/components/CalendarDropdown.tsx` | Low |
| 43 | `src/components/training/dashboard/*` | `src/hubs/training/components/dashboard/*` | Medium - 6+ components |
| 44 | `src/components/training/player/*` | `src/hubs/training/components/player/*` | Medium - CoursePlayerLayout, CourseTopBar, ShareModal |
| 45 | `src/components/training/share/*` | NOT TO TRAINING. To `src/shared/share/components/*` (Phase 2.6 dependency-resolution; see C) | Medium |
| 46 | `src/components/sessions/*` | `src/hubs/training/components/sessions/*` | Low - SessionCard universal |

#### B.4.b Library

| # | Current path | New path | Complexity |
|---|--------------|----------|------------|
| 47 | `src/lib/training/training-session.ts` | `src/hubs/training/lib/session/training-session.ts` | High - cookie auth core |
| 48 | `src/lib/training/trainingSessionCookie.ts` | `src/hubs/training/lib/session/trainingSessionCookie.ts` | High - referenced by `comingSoonGuard` (resolve in 2.6) |
| 49 | `src/lib/training/shuffle.ts` | `src/hubs/training/lib/assessment/shuffle.ts` | Low |
| 50 | `src/lib/training/attemptInProgress.ts` | `src/hubs/training/lib/assessment/attemptInProgress.ts` | Medium |
| 51 | `src/lib/training/attemptInProgressClient.ts` | `src/hubs/training/lib/assessment/attemptInProgressClient.ts` | Low |
| 52 | `src/lib/training/liveSessionAssessments.ts` | `src/hubs/training/lib/assessment/liveSessionAssessments.ts` | Medium |
| 53 | `src/lib/training/progressCalculator.ts` | `src/hubs/training/lib/progress/progressCalculator.ts` | Medium |
| 54 | `src/lib/training/progressFromSupabase.ts` | `src/hubs/training/lib/progress/progressFromSupabase.ts` | Medium |
| 55 | `src/lib/training/watchTracker.ts` | `src/hubs/training/lib/watch/watchTracker.ts` | High - interval-merge core |
| 56 | `src/lib/training/watchEnforcementCheck.ts` | `src/hubs/training/lib/watch/watchEnforcementCheck.ts` | Medium |
| 57 | `src/lib/training/watchThresholdVerifier.ts` | `src/hubs/training/lib/watch/watchThresholdVerifier.ts` | High - cert gate |
| 58 | `src/lib/training/videoTimer.ts` | `src/hubs/training/lib/watch/videoTimer.ts` | Low |
| 59 | `src/lib/training/detectVideoChange.ts` | `src/hubs/training/lib/watch/detectVideoChange.ts` | Low |
| 60 | `src/lib/training/certificateEngine.ts` | `src/hubs/training/lib/certificates/certificateEngine.ts` | High - issuance critical path |
| 61 | `src/lib/training/certificateEligibility.ts` | `src/hubs/training/lib/certificates/certificateEligibility.ts` | High |
| 62 | `src/lib/training/certificateLayout.ts` | `src/hubs/training/lib/certificates/certificateLayout.ts` | Medium |
| 63 | `src/lib/training/certifier.ts` | `src/hubs/training/lib/certificates/certifier.ts` | Medium |
| 64 | `src/lib/training/liveSessionsForStudent.ts` | `src/hubs/training/lib/liveSessions/liveSessionsForStudent.ts` | Medium |
| 65 | `src/lib/training/calendar.ts` | `src/hubs/training/lib/liveSessions/calendar.ts` | Low |
| 66 | `src/lib/training/sessionAnnouncement.ts` (if present) | `src/hubs/training/lib/liveSessions/sessionAnnouncement.ts` | Low |
| 67 | `src/lib/training/appsScript.ts` | `src/hubs/training/lib/appsScript/appsScript.ts` | High - Apps Script bridge |
| 68 | `src/lib/training/sheets.ts` | `src/hubs/training/lib/appsScript/sheets.ts` | High |
| 69 | `src/lib/training/regIdAllocator.ts` | `src/hubs/training/lib/appsScript/regIdAllocator.ts` | High |
| 70 | `src/lib/training/studentRoster.ts` | `src/hubs/training/lib/appsScript/studentRoster.ts` | High |
| 71 | `src/lib/training/share.ts` | NOT TO TRAINING. To `src/shared/share/share.ts` (Phase 2.6) | Low |
| 72 | `src/lib/training/shareTemplates.ts` | NOT TO TRAINING. To `src/shared/share/shareTemplates.ts` (Phase 2.6) | Low |
| 73 | `src/lib/training/useShareTemplate.ts` | NOT TO TRAINING. To `src/shared/share/useShareTemplate.ts` (Phase 2.6) | Low |
| 74 | `src/lib/shared/trainingComingSoon.ts` | `src/hubs/training/lib/comingSoon.ts` | Medium - see C.1 |

#### B.4.c Config

| # | Current path | New path | Complexity |
|---|--------------|----------|------------|
| 75 | `src/config/courses.ts` | `src/hubs/training/config/courses.ts` | Medium - 23 importers |

**File count this phase**: ~85 files.
**Imports updated**: ~250 import statements (Training Hub has the densest import graph).
**Risk level**: medium-high. Mitigation: split into sub-batches (B.4.a, B.4.b, B.4.c) and verify between each. See Section F for the per-sub-batch verification list.

### B.5 Phase 2.5 - Move Modeling Hub code

#### B.5.a Modeling Hub shared

| # | Current path | New path | Complexity |
|---|--------------|----------|------------|
| 76 | `src/lib/shared/modelingAccess.ts` | `src/hubs/modeling/lib/access.ts` | Medium |
| 77 | `src/lib/shared/modelingComingSoon.ts` | `src/hubs/modeling/lib/comingSoon.ts` | Medium |
| 78 | `src/config/platforms.ts` | `src/hubs/modeling/config/platforms.ts` | Low - 5 importers |

#### B.5.b REFM platform

| # | Current path | New path | Complexity |
|---|--------------|----------|------------|
| 79 | `src/components/refm/Dashboard.tsx` | `src/hubs/modeling/platforms/refm/components/Dashboard.tsx` | Low |
| 80 | `src/components/refm/Topbar.tsx` | `src/hubs/modeling/platforms/refm/components/Topbar.tsx` | Low |
| 81 | `src/components/refm/Sidebar.tsx` | `src/hubs/modeling/platforms/refm/components/Sidebar.tsx` | Low |
| 82 | `src/components/refm/PlanBadge.tsx` | `src/hubs/modeling/platforms/refm/components/PlanBadge.tsx` | Low |
| 83 | `src/components/refm/OverviewScreen.tsx` | `src/hubs/modeling/platforms/refm/components/OverviewScreen.tsx` | Low |
| 84 | `src/components/refm/ProjectsScreen.tsx` | `src/hubs/modeling/platforms/refm/components/ProjectsScreen.tsx` | Low |
| 85 | `src/components/refm/RealEstatePlatform.tsx` | `src/hubs/modeling/platforms/refm/components/RealEstatePlatform.tsx` | Medium - 1427 lines, root component |
| 86 | `src/components/refm/modules/*` | `src/hubs/modeling/platforms/refm/components/modules/*` | Medium - 4 module files |
| 87 | `src/components/refm/modals/*` | `src/hubs/modeling/platforms/refm/components/modals/*` | Low - 4 modals |
| 88 | `src/lib/modeling/real-estate/*` | `src/hubs/modeling/platforms/refm/lib/*` | Low - mostly stubs (modules 2-11 + 3 export files) |

#### B.5.c Reserved platforms

Folders created in 2.1 stay empty (`bvm/`, `fpa/`, `erm/`, `pfm/`, `lbo/`, `cfm/`, `eum/`, `svm/`, `bcm/`).

#### B.5.d Marketing Studio

| # | Current path | New path | Complexity |
|---|--------------|----------|------------|
| 89 | `src/lib/marketing-studio/*` | `src/features/marketing-studio/*` | Medium - 8 files; consumed by admin |

#### B.5.e Integrations

| # | Current path | New path | Complexity |
|---|--------------|----------|------------|
| 90 | `src/lib/integrations/teamsMeetings.ts` | `src/integrations/teams/teamsMeetings.ts` | Low - 4 importers |

**File count this phase**: ~25 files.
**Imports updated**: ~50 import statements.
**Risk level**: low. Modeling Hub is in Coming Soon mode; only admin and the marketing landing page render Modeling content today.

### B.6 Phase 2.6 - Resolve cross-hub violations

See Section C below for the resolution strategy. Phase 2.6 file moves:

| # | Current path | New path | Complexity |
|---|--------------|----------|------------|
| 91 | `src/components/training/share/ShareModal.tsx` | `src/shared/share/components/ShareModal.tsx` | Medium - 6+ importers |
| 92 | `src/lib/training/share.ts` | `src/shared/share/share.ts` | Medium - 4 importers |
| 93 | `src/lib/training/shareTemplates.ts` | `src/shared/share/shareTemplates.ts` | Medium - 8 importers |
| 94 | `src/lib/training/useShareTemplate.ts` | `src/shared/share/useShareTemplate.ts` | Medium - 5 importers |
| 95 | `src/lib/shared/comingSoonGuard.ts` | `src/shared/comingSoon/guard.ts` (with dependency inversion; see C.1) | Medium - 2 importers |

**File count this phase**: 5 files.
**Imports updated**: ~30 import statements.
**Risk level**: medium. The dependency inversion of `comingSoonGuard` requires touching the two consumer files (`/training/signin/page.tsx` and `/training/register/page.tsx`) to pass the cookie resolver as a function argument.

### B.7 Phase 2.7 - Add tsconfig path aliases + ESLint enforcement

No file moves. Code change only:

- Update `tsconfig.json` `paths`:
  ```json
  "paths": {
    "@/*": ["./*"],
    "@core/*": ["./src/core/*"],
    "@shared/*": ["./src/shared/*"],
    "@training/*": ["./src/hubs/training/*"],
    "@modeling/*": ["./src/hubs/modeling/*"],
    "@main/*": ["./src/hubs/main/*"],
    "@platforms/*": ["./src/hubs/modeling/platforms/*"],
    "@features/*": ["./src/features/*"],
    "@integrations/*": ["./src/integrations/*"]
  }
  ```
- The legacy `@/*` alias stays so old imports compile while we rewrite. After Phase 2.8 we narrow it back.
- Update `eslint.config.mjs` to add `eslint-plugin-boundaries` rules (or `import/no-restricted-paths` if we don't want a new dep).

See Section E for the enforcement detail.

### B.8 Phase 2.8 - Documentation updates

No file moves. Update:

- `CLAUDE.md` "Scoping" table to point at new paths.
- `CLAUDE-ROUTES.md` folder reference.
- `CLAUDE-DB.md` no change (DB unchanged).
- `CLAUDE-FEATURES.md` no change unless feature ownership reads differently.
- `CLAUDE.md` "Do NOT touch list" amended for new boundary rules.
- New file: `ARCHITECTURE.md` with the decision rationale (this document, distilled).

---

## Section C. Cross-Hub Dependency Resolution

PLATFORM_INVENTORY.md Section 9 flagged 5 violations. Resolutions:

### C.1 `src/lib/shared/comingSoonGuard.ts` imports `src/lib/training/trainingSessionCookie`

**Problem**: shared code (`comingSoonGuard.ts`) imports hub-specific code (`trainingSessionCookie.ts`). This is the only Category 5 violation.

**Resolution: dependency inversion.**

`comingSoonGuard.ts` becomes:

```ts
// src/shared/comingSoon/guard.ts
export type SessionResolver = () => Promise<{ identifier: string | null }>;

export async function shouldGateComingSoon(opts: {
  hub: 'training' | 'modeling';
  // ...
  getSession: SessionResolver;
  // ...
}) {
  const session = await opts.getSession();
  // ...existing logic...
}
```

The two consumers (`app/training/signin/page.tsx`, `app/training/register/page.tsx`) inject the resolver:

```ts
import { shouldGateComingSoon } from '@shared/comingSoon/guard';
import { getTrainingCookieSession } from '@training/lib/session/trainingSessionCookie';

const result = await shouldGateComingSoon({
  hub: 'training',
  getSession: getTrainingCookieSession,
  // ...
});
```

Modeling Hub never goes through this guard (NextAuth admin role + whitelist short-circuit), so no Modeling consumer needs updating.

**Result**: shared code has zero hub-specific imports. Category 5 cleared.

### C.2-C.5 `app/verify/[uuid]/VerifyActions.tsx` and `app/api/share-templates/[key]/route.ts` import Training share helpers

**Problem**: main-domain page (`/verify/[uuid]`) and main-domain API (`/api/share-templates/[key]`) import from `src/components/training/share/` and `src/lib/training/{useShareTemplate,shareTemplates}`. These are 4 of the 5 violations.

**Resolution: relocate the share family into `src/shared/share/`.**

Justification:

- `ShareModal`, `useShareTemplate`, `shareTemplates`, `share.ts` are NOT semantically Training-Hub-specific. Modeling Hub will need them when paid tiers + achievement cards launch. The verify page already needs them. Admin already needs them. They are cross-hub primitives that happen to have been built first for Training.
- Moving them to `src/shared/share/` is a clean rename, not a refactor. No logic change.
- After the move, all 4 importers (Verify page, share-templates API, training components, admin pages) point at `@shared/share/...`.

The `share_templates` Supabase table contents are still seeded with Training-Hub-shaped templates today; that's a content fact, not an architectural fact. Modeling Hub-shaped templates can be added in the same table when those features land.

**Result**: Verify page and share-templates API no longer cross hub boundaries. Categories 4.1-4.4 cleared.

### Bonus: optionally relocate `app/verify/` under `app/training/`

**Decision: do NOT do this in this restructure.** Reasoning:

- The URL `/verify/[uuid]` is part of the public certificate-share contract. QR codes, LinkedIn share previews, and email links all encode `learn.financialmodelerpro.com/verify/<id>`. Moving the file to `app/training/verify/` would either keep the URL the same (via rewrite gymnastics) or change it (breaks share contracts).
- Even after the share helper move, `/verify/[uuid]` still imports cross-hub helpers: `share`. So the boundary is in shared land, not crossing.
- If a future restructure does extract Training Hub to its own deployment, `/verify/` either ships with Training (and the canonical-host rewrite stays in place) or stays with Main and uses cross-deployment fetches against the share-templates API. Both are workable. We can defer.

### Resolution summary

| Violation | Action | New state |
|-----------|--------|-----------|
| 5.1 (comingSoonGuard) | Dependency inversion | Shared has no hub imports |
| 4.1 (VerifyActions imports ShareModal) | Move ShareModal to shared | Main-site has no hub imports |
| 4.2 (VerifyActions imports useShareTemplate) | Move to shared | Main-site has no hub imports |
| 4.3 (VerifyActions imports shareTemplates engine) | Move to shared | Main-site has no hub imports |
| 4.4 (share-templates API imports defaults) | Move to shared | Main-site has no hub imports |

After Phase 2.6, the boundary table reads zero violations. Category 3 (admin -> hub) remains by design.

---

## Section D. Import Path Strategy

### D.1 Decision: tsconfig path aliases per zone

Three options were considered.

| Option | Pros | Cons |
|--------|------|------|
| Relative paths only (`../../`) | No tsconfig change | Refactor-hostile; renaming a folder breaks dozens of paths |
| Single `@/*` (today) | Simple | No way to enforce boundaries; everything looks the same |
| Per-zone aliases (`@core/*`, `@shared/*`, `@training/*`, ...) | Self-documenting; ESLint-enforceable | tsconfig and ESLint config grow |

**Choice: per-zone aliases.**

### D.2 Aliases (post-restructure)

```json
"paths": {
  "@/*":            ["./*"],                      // legacy escape hatch (kept short-term, removed in 2.8)
  "@core/*":        ["./src/core/*"],
  "@shared/*":      ["./src/shared/*"],
  "@main/*":        ["./src/hubs/main/*"],
  "@training/*":    ["./src/hubs/training/*"],
  "@modeling/*":    ["./src/hubs/modeling/*"],
  "@platforms/*":   ["./src/hubs/modeling/platforms/*"],
  "@features/*":    ["./src/features/*"],
  "@integrations/*":["./src/integrations/*"]
}
```

### D.3 Convention to enforce

- Importing from `@core/*` is allowed from anywhere.
- Importing from `@shared/*` is allowed from anywhere except other `@shared/*` files (no shared->shared circular paths) and `@core/*` (core may not depend on shared).
- Importing from `@training/*` is allowed from `@training/*` itself, `@main/*` (only via verified shared surfaces), `app/admin/*`, `app/training/*`, `app/api/training/*`, `app/api/admin/*`, `app/training-sessions/*`, `app/api/public/training-sessions/*`. Disallowed: from `@modeling/*`, `@platforms/*`, `@features/*`.
- Importing from `@modeling/*` is allowed from `@modeling/*` itself, `@platforms/*`, `app/admin/*`, `app/modeling/*`, `app/refm/*`, `app/portal/*`, `app/api/auth/*`, `app/api/projects/*`, `app/api/agents/*`, `app/api/export/*`. Disallowed from `@training/*`.
- Importing from `@platforms/refm/*` is allowed from `@platforms/refm/*` itself, `app/refm/*`, `@modeling/*` (parent passthrough). Disallowed from anything else.
- Importing from `@features/marketing-studio/*` is allowed from `@features/*`, `app/admin/*`, `app/api/admin/*`. Disallowed elsewhere.
- Importing from `@integrations/*` is allowed from anywhere (they wrap external services).

### D.4 Migration approach

Phase 2.2 through 2.6 update imports to the new shapes (`@/src/lib/training/...` -> `@training/lib/...`) in the same commit as the file move. This keeps the diff readable: `git log --follow` traces both the move and the call-site updates.

After Phase 2.7's tsconfig change, leftover `@/src/...` references that survived a phase get caught by `tsc` (path resolution still works because `@/*` is preserved) but flagged by lint.

After Phase 2.8 (documentation), the `@/*` alias gets narrowed to point only at `./app/*`. This forces all `src/*` imports to use the new aliases. Optional final step; can defer.

---

## Section E. Enforcement Mechanism

### E.1 Recommended: ESLint `eslint-plugin-boundaries`

Choosing `eslint-plugin-boundaries` over `import/no-restricted-paths` because:

- It models hub-vs-shared as element types, not as path globs. Less error-prone.
- It supports a "from" element type (e.g. "training files cannot import modeling files") with one rule.
- It is specifically designed for monolith-with-internal-modules, which is exactly our shape.

Add to `package.json` devDependencies and `eslint.config.mjs`:

```js
import boundaries from 'eslint-plugin-boundaries';

export default [
  // existing rules
  {
    plugins: { boundaries },
    settings: {
      'boundaries/elements': [
        { type: 'core',    pattern: 'src/core/*' },
        { type: 'shared',  pattern: 'src/shared/*' },
        { type: 'main',    pattern: 'src/hubs/main/*' },
        { type: 'training',pattern: 'src/hubs/training/*' },
        { type: 'modeling',pattern: 'src/hubs/modeling/*' },
        { type: 'platform',pattern: 'src/hubs/modeling/platforms/*' },
        { type: 'feature', pattern: 'src/features/*' },
        { type: 'integ',   pattern: 'src/integrations/*' },
        { type: 'app',     pattern: 'app/*' },
      ],
    },
    rules: {
      'boundaries/element-types': ['error', {
        default: 'disallow',
        rules: [
          { from: 'core',     allow: ['core'] },
          { from: 'shared',   allow: ['core', 'shared', 'integ'] },
          { from: 'main',     allow: ['core', 'shared', 'integ', 'main'] },
          { from: 'training', allow: ['core', 'shared', 'integ', 'training'] },
          { from: 'modeling', allow: ['core', 'shared', 'integ', 'modeling'] },
          { from: 'platform', allow: ['core', 'shared', 'integ', 'modeling', 'platform'] },
          { from: 'feature',  allow: ['core', 'shared', 'integ', 'feature'] },
          { from: 'integ',    allow: ['core', 'shared'] },
          // app routes are allowed to import anything they own
          { from: 'app',      allow: ['core', 'shared', 'main', 'training', 'modeling', 'platform', 'feature', 'integ'] },
        ],
      }],
    },
  },
];
```

This rule set encodes Section D.3 verbatim.

### E.2 Fallback: `import/no-restricted-paths`

If we'd rather not add a new devDep, the same rules can be expressed with `eslint-plugin-import`'s `no-restricted-paths`. Slightly more verbose but no extra package.

### E.3 CI gate

Add to `package.json` `verify` script: `npm run lint` already runs. Make sure ESLint exits non-zero on boundary violations and `verify` fails. Vercel preview builds run `verify`, so a violation can never reach `main`.

---

## Section F. Commit Phase Breakdown

### Phase 2.1 - Create empty target folders

- **Files moved**: 0
- **Imports updated**: 0
- **Risk**: zero
- **Commit message**: `Restructure 2.1: scaffold target folder tree`
- **Verification**: `npm run type-check` (just to confirm nothing accidentally broke)
- **Estimated commit size**: 0 file diffs (empty dirs only; git ignores empty dirs by default, so include `.gitkeep` files in each leaf)
- **Estimated effort**: 30 minutes

### Phase 2.2 - Move shared infrastructure

- **Files moved**: ~80 (lib/shared, lib/email, lib/newsletter, lib/seo, components/shared, components/ui, components/layout, components/seo, hooks, types, core/*)
- **Imports updated**: ~150 statements across ~120 files
- **Risk**: low
- **Commit message**: `Restructure 2.2: move shared infrastructure to src/shared and src/core`
- **Verification**:
  - `npm run type-check` exits 0
  - `npm run build` exits 0
  - `npm run lint` exits 0
  - Routes that load: `/`, `/about/ahmad-din`, `/articles`, `/contact`, `/pricing`
  - User flow: open home page in preview, scroll to footer, see newsletter form render
  - User flow: open `/admin` in preview, render the login form
- **Estimated commit size**: 200+ files touched
- **Estimated effort**: 1 day (file moves are mechanical; the import updates are sed + manual review)

### Phase 2.3 - Move Main Site code

- **Files moved**: ~35 (components/landing, booking, cms, newsletter, pricing)
- **Imports updated**: ~35 statements
- **Risk**: low
- **Commit message**: `Restructure 2.3: move main-site components to src/hubs/main`
- **Verification**:
  - `npm run verify` exits 0
  - Routes: `/`, `/articles`, `/articles/<a-real-slug>`, `/contact`, `/pricing`, `/about/ahmad-din`
  - Admin: `/admin/page-builder` opens, section types render in dropdown, drag-and-drop still works
- **Estimated commit size**: 70 files touched
- **Estimated effort**: half-day

### Phase 2.4 - Move Training Hub code (split into 3 sub-commits)

The riskiest phase. Split for fast rollback granularity.

#### Phase 2.4.a - Components

- **Files moved**: ~25 components
- **Imports updated**: ~80 statements
- **Risk**: medium
- **Commit message**: `Restructure 2.4.a: move Training Hub components to src/hubs/training/components`
- **Verification**:
  - `npm run verify` exits 0
  - Routes: `/training`, `/training-sessions`, `/training-sessions/<id>` (public; no cookie needed)
  - Cookie test: open `/training/dashboard` in a private window where you have a valid `training_session` cookie. Confirm video player tile renders and "Continue learning" CTA shows.
  - Cookie test: navigate to `/training/watch/3sfm/3SFM_S1`. Confirm YouTubePlayer mounts, watch progress bar renders, Mark Complete button is visible (or hidden as expected).
- **Estimated effort**: half-day

#### Phase 2.4.b - Library

- **Files moved**: ~30 library files (session, assessment, progress, watch, certificates, liveSessions, appsScript)
- **Imports updated**: ~150 statements
- **Risk**: HIGH (cert engine, watch tracker, Apps Script bridge all move here)
- **Commit message**: `Restructure 2.4.b: move Training Hub library to src/hubs/training/lib`
- **Verification**:
  - `npm run verify` exits 0
  - **Cert issuance smoke test**: in a non-prod environment, simulate a final-exam pass POST against `/api/training/submit-assessment`. Confirm a `student_certificates` row is written with `email_sent_at` set within ~30 seconds. (The pre-Phase baseline must be confirmed beforehand, against the same env.)
  - **Watch enforcement smoke test**: open `/training/watch/3sfm/3SFM_S1`. Play a few seconds. Confirm a POST hits `/api/training/certification-watch` and `watch_seconds` ticks upward.
  - **Apps Script smoke test**: open `/training/assessment/3SFM_S1`. Confirm questions render. (This route fetches from Apps Script via `appsScript.ts`.)
  - Cron route: hit `/api/cron/session-reminders` with the bearer token, confirm 200 + flag flip works (use a session that has a registered student in the 24h window).
- **Estimated effort**: 1 day plus stabilization

#### Phase 2.4.c - Config

- **Files moved**: 1 (`src/config/courses.ts`)
- **Imports updated**: ~23 statements
- **Risk**: low
- **Commit message**: `Restructure 2.4.c: move courses config to src/hubs/training/config`
- **Verification**:
  - `npm run verify` exits 0
  - Routes: `/training/dashboard`, course view shows session list correctly. The COURSES constant is the structural source of truth.
- **Estimated effort**: 1 hour

### Phase 2.5 - Move Modeling Hub code

- **Files moved**: ~25 (refm/, modeling/, platforms.ts, marketing-studio, integrations/teams)
- **Imports updated**: ~50 statements
- **Risk**: low (Coming Soon mode; only admin and the marketing landing render)
- **Commit message**: `Restructure 2.5: move Modeling Hub + REFM + Marketing Studio + integrations to src/hubs/modeling`
- **Verification**:
  - `npm run verify` exits 0
  - Routes: `/modeling`, `/modeling/real-estate`, `/admin/modules`, `/admin/modeling-access`, `/admin/training-hub/marketing-studio`
  - REFM: open `/refm` in preview as a logged-in user. Confirm `RealEstatePlatform` mounts (1427-line component).
  - Marketing Studio: open the Linkedin Post tab in admin marketing studio, generate a preview, confirm satori still renders the PNG.
- **Estimated effort**: half-day

### Phase 2.6 - Resolve cross-hub violations

- **Files moved**: 5 (ShareModal, share, shareTemplates, useShareTemplate, comingSoonGuard)
- **Imports updated**: ~30 statements
- **Code change**: dependency-invert `comingSoonGuard.ts` (one function signature change in 1 file + 2 consumer updates)
- **Risk**: medium
- **Commit message**: `Restructure 2.6: relocate share helpers + invert comingSoonGuard dependency`
- **Verification**:
  - `npm run verify` exits 0
  - Cross-hub grep (run the boundary check from PLATFORM_INVENTORY.md Section 9): zero Category 4 + 5 violations.
  - Routes: `/verify/<a-real-uuid>` renders cert + share modal works.
  - Routes: `/training/dashboard` -> open a cert card -> Share button -> modal opens with share text.
  - Routes: `/training/signin` while Coming Soon mode is on (test in preview by toggling the setting): unauth visitor sees the gate; bypass-listed email gets through.
- **Estimated effort**: half-day

### Phase 2.7 - Add tsconfig + ESLint enforcement

- **Files moved**: 0
- **Code change**: add aliases to `tsconfig.json`, add boundaries plugin to `eslint.config.mjs`
- **Risk**: low (pure additions; old `@/*` alias kept; no existing imports break)
- **Commit message**: `Restructure 2.7: add hub path aliases and boundary lint rules`
- **Verification**:
  - `npm run verify` exits 0 (both type-check and lint must be clean)
  - Smoke: introduce a deliberate violation locally (e.g. import from `@modeling/*` inside `@training/*`) and confirm `npm run lint` fails. Revert.
- **Estimated effort**: half-day

### Phase 2.8 - Documentation updates

- **Files moved**: 0
- **Files edited**: CLAUDE.md, CLAUDE-ROUTES.md, possibly CLAUDE-FEATURES.md
- **Files created**: ARCHITECTURE.md
- **Risk**: zero (docs only)
- **Commit message**: `Restructure 2.8: update CLAUDE docs and add ARCHITECTURE.md`
- **Verification**: human review only
- **Estimated effort**: half-day

### Phase total

8 phases (2.4 split into a, b, c gives 10 commits). Approximately 4-5 days of focused work plus a 2-3 day stabilization week to monitor the live Training Hub.

---

## Section G. Verification Checklist Per Phase

Every phase must pass items 1-3. Phases that touch a specific hub must additionally pass that hub's items.

### G.1 Universal items (every phase)

- [ ] `npm run type-check` exits 0
- [ ] `npm run lint` exits 0
- [ ] `npm run build` exits 0 (`next build --webpack`)

### G.2 Routes that must keep returning 200 with the same render (universal smoke)

After each phase:

- [ ] `GET /` (main home) - renders home CMS sections
- [ ] `GET /about/ahmad-din` - renders founder sections
- [ ] `GET /articles` - renders article index
- [ ] `GET /contact` - renders contact form
- [ ] `GET /pricing` - renders pricing CMS sections + platform_pricing rows
- [ ] `GET /portal` (with NextAuth session cookie) - renders 10-platform grid
- [ ] `GET /verify/<known-uuid>` - renders cert preview, badge, transcript iframes
- [ ] `GET /admin` (logged out) - renders login form
- [ ] `GET /admin/dashboard` (logged in) - renders admin shell

### G.3 Training Hub items (after Phase 2.2, 2.3, 2.4.a, 2.4.b, 2.4.c, 2.6)

- [ ] `GET /training` (rewritten on learn.) - marketing landing renders
- [ ] `GET /training-sessions` - public live-session list renders
- [ ] `GET /training-sessions/<id>` - public detail renders
- [ ] `GET /signin`, `/register`, `/forgot` (rewritten on learn.) - forms render
- [ ] With cookie: `GET /training/dashboard` - renders 3SFM + BVM cards
- [ ] With cookie: `GET /training/3sfm` - course view renders
- [ ] With cookie: `GET /training/watch/3sfm/3SFM_S1` - YouTubePlayer mounts
- [ ] With cookie: `GET /training/assessment/3SFM_S1` - quiz UI mounts (Apps Script-backed)
- [ ] With cookie: `GET /training/live-sessions` - upcoming + recorded render
- [ ] With cookie: `POST /api/training/certification-watch` - returns 200 with merged watch_seconds
- [ ] With cookie: `POST /api/training/submit-assessment` (final exam pass) - returns 200, fires cert issuance, `student_certificates.email_sent_at` populates within 30s

### G.4 Modeling Hub items (after Phase 2.2, 2.5, 2.6)

- [ ] `GET /modeling` (rewritten on app.) - marketing landing renders
- [ ] `GET /modeling/real-estate` - platform sub-page renders
- [ ] `GET /modeling/dashboard` (logged in) - dashboard renders
- [ ] `GET /refm` (logged in) - REFM platform mounts (RealEstatePlatform 1427L)
- [ ] `GET /signin`, `/register` (rewritten on app.) - forms render
- [ ] `POST /api/auth/callback/credentials` - NextAuth login succeeds for an existing user

### G.5 Admin items (after every phase)

- [ ] `GET /admin/cms` - hub overview
- [ ] `GET /admin/page-builder/home` - section editor opens, drag-and-drop works
- [ ] `GET /admin/training-hub/students` - student list renders
- [ ] `GET /admin/training-hub/marketing-studio` - 4 banner template editors render
- [ ] `GET /admin/training-hub/live-sessions` - live-session list renders, AssessmentEditor mounts on click
- [ ] `GET /admin/communications-hub` - 4-tab strip renders, Newsletter tab loads campaigns
- [ ] `GET /admin/certificate-designer` - 4-tab strip renders
- [ ] `GET /admin/modules` - 2 LaunchStatusCards render
- [ ] `GET /admin/analytics` - 8 parallel queries succeed, charts render

### G.6 Cron + webhook items (after Phase 2.2, 2.4.b, 2.7, 2.8)

- [ ] `vercel.json` cron paths still resolve to existing route files (`/api/cron/session-reminders`, `/api/cron/newsletter-scheduled`)
- [ ] `/api/cron/session-reminders` with valid bearer returns 200
- [ ] `/api/webhooks/resend` accepts a synthetic Svix-signed POST and returns 200

### G.7 Boundary integrity (after Phase 2.6 and 2.7)

- [ ] Re-run the cross-hub boundary grep from PLATFORM_INVENTORY.md Section 9. Expected: zero violations in Categories 4, 5, 6, 7. Category 3 (admin -> hub) remains by design.

---

## Section H. Rollback Plan

### H.1 Per-phase rollback

Each phase is one git commit (Phase 2.4 is three commits but each rollback-able independently).

```bash
git revert <commit-hash>            # produces a clean reverse-commit
npm run verify                       # confirm clean
git push                             # Vercel redeploys the reverse-commit
```

If a Vercel preview build fails on a phase, the commit is rolled back before merge to `main`. No production traffic ever sees a broken build because preview gates are mandatory.

If a deploy to `main` ships a broken phase (e.g. a runtime-only error not caught by build):

1. `git revert <bad-commit-hash>` on `main`
2. `git push` -> Vercel auto-redeploys
3. Identify root cause in the reverse, fix locally, redo the phase

### H.2 Multi-phase rollback

```bash
git revert <oldest-bad-commit>..HEAD --no-commit
git commit -m "Revert restructure phases X-Y"
git push
```

### H.3 Database rollback

Not applicable. Restructure is code-only. Zero schema changes, zero data writes.

### H.4 Auth cookie continuity

Critical: `training_session` cookie name, `next-auth.session-token` cookie name, and `fmp-trusted-device` cookie name MUST NOT change. PLATFORM_INVENTORY.md Section 12.F flags this. The restructure does not touch cookie names anywhere; verify by grep before each commit:

```bash
grep -rn "training_session" src/ app/        # must show same hits before and after
grep -rn "fmp-trusted-device" src/ app/      # same
grep -rn "next-auth.session" src/ app/       # same (NextAuth handles internally; we don't override)
```

### H.5 Cron path continuity

`vercel.json` cron entries reference `/api/cron/session-reminders` and `/api/cron/newsletter-scheduled`. Restructure does not move these routes (they live under `app/api/`, which doesn't move). Verify by grep:

```bash
grep "api/cron" vercel.json                  # entries match
ls app/api/cron/                              # folders exist
```

### H.6 Env var continuity

No env vars change. Restructure does not introduce new env vars or rename existing ones.

### H.7 Worst case: full restructure rollback

If after Phase 2.4 it becomes obvious the approach is wrong:

1. `git revert HEAD..<phase-2.1-hash>` to undo every phase
2. Verify, push
3. Reconsider the plan; document what went wrong in `RESTRUCTURE_RETRO.md`

---

## Section I. Estimated Effort

### I.1 Per-phase estimates (focused work)

| Phase | Activity | Effort |
|-------|----------|--------|
| 2.1 | Scaffold folders | 0.5 hours |
| 2.2 | Move shared infrastructure | 8 hours |
| 2.3 | Move Main Site code | 4 hours |
| 2.4.a | Move Training components | 4 hours |
| 2.4.b | Move Training library | 8 hours + stabilization buffer |
| 2.4.c | Move courses config | 1 hour |
| 2.5 | Move Modeling Hub + REFM + integrations | 4 hours |
| 2.6 | Resolve cross-hub violations | 4 hours |
| 2.7 | Add tsconfig + ESLint | 4 hours |
| 2.8 | Documentation | 4 hours |
| **Total focused work** | | **~42 hours / 5-6 working days** |

### I.2 Calendar estimate

Recommended pacing for a single engineer:

- **Day 1**: Phases 2.1 + 2.2 (scaffolding + shared infrastructure)
- **Day 2**: Phase 2.3 + start of 2.4 (Main Site + Training components)
- **Day 3**: Phase 2.4.b (Training library; isolate this entire day for the cert engine + watch tracker moves)
- **Day 4**: Phase 2.4.c + 2.5 + 2.6 (config + Modeling + cross-hub fixes)
- **Day 5**: Phase 2.7 + 2.8 (enforcement + docs)
- **Day 6-7**: Stabilization. Monitor `student_certificates.email_sent_at` daily, monitor `/api/cron/session-reminders` runs, monitor watch-progress writes.

### I.3 Recommended cadence

- One phase per commit. One commit per push. One push per preview build.
- Wait for Vercel preview to go green before merging. Never merge a red preview.
- After Phase 2.4.b (highest risk), pause for 24 hours of student traffic before Phase 2.4.c. If anything regresses, the rollback window is short.
- After Phase 2.7 (lint enforcement turns on), expect a wave of incidental lint failures on existing code that imported across the new boundaries pre-restructure. Fix in-line; do not add `// eslint-disable` to silence them (defeats the point).
- After Phase 2.8 (docs), narrow the legacy `@/*` alias to `app/*` only as a final cleanup commit. Optional.

### I.4 What can be parallelized

Within a phase, file moves are mechanical and parallelizable across multiple sub-folders (e.g. inside Phase 2.2, moving `src/components/shared/` and `src/lib/email/` are independent). One engineer can work them in any order; multiple engineers should NOT collaborate on the same phase to avoid merge conflicts on `tsconfig.json` or `eslint.config.mjs`.

Across phases, parallelization is unsafe: each phase depends on the previous phase's structure being live for verification.

### I.5 Stretch items deferred from this plan

The following are explicitly out of scope; they are valuable but not required for portability:

- **Splitting `app/api/` into hub-prefixed folders.** Documented in A.4. URL contract dependency.
- **Centralizing admin auth into middleware.** PLATFORM_INVENTORY.md F.7. Independent improvement.
- **Removing Apps Script integration entirely.** PLATFORM_INVENTORY.md S.11. Dependent on a Supabase replacement for question fetch + course details + reset-attempts; not a folder restructure problem.
- **Filling out Modeling Hub platforms 2-10.** Product roadmap, not architecture.
- **Filling out REFM Modules 2-11.** Product roadmap.
- **Confirming whether REFM Excel/PDF export is real or stubbed.** PLATFORM_INVENTORY.md Section 3 discrepancy. Worth resolving but not a folder restructure problem.

---

## Section J. Quick Wins (Optional Cleanups Before or After)

These are not part of the restructure proper but are obvious cleanups uncovered during planning. Each is independent and reverts in one commit.

| # | Item | Effort | When |
|---|------|--------|------|
| J.1 | Delete `D:FMPfinancial-modeler-proappapitrainingbadgesdownload\` orphan dir (mkdir typo) | 5 min | Any time |
| J.2 | Decide on `_legacy_backup/` and `js/` (delete or move to `archive/`) | 15 min | After Phase 2.8 |
| J.3 | Decide on `src/agents/*` 2-line stubs (delete or fill) | 15 min | Phase 2.5 |
| J.4 | Delete `src/core/core-validators.ts` (2-line stub) | 5 min | Phase 2.2 |
| J.5 | Delete or wire `src/lib/shared/urls.ts` (zero importers) | 30 min | Phase 2.2 |
| J.6 | Delete `src/lib/modeling/real-estate/modules/module{2-11}-*.ts` stubs and 3 export stubs (or keep as scope signal) | 15 min | Phase 2.5 |
| J.7 | Confirm migrations 069, 073, 127 are intentionally absent (PLATFORM_INVENTORY.md Section 6 discrepancy) | 30 min | Independent |
| J.8 | Confirm REFM Excel/PDF export is real (where does ExportModal.tsx generate from?) | 1 hour | Independent |
| J.9 | Dedupe `CountdownTimer.tsx` between `src/components/shared/` and `src/components/training/` | 30 min | Phase 2.4.a |
| J.10 | Centralize admin auth into middleware (eliminate per-route session checks) | 1 day | Independent (high value but separate effort) |

---

## Section K. Approval Checkpoints

Before execution, the user reviews this plan and confirms:

- [ ] Target structure (Section A) matches their intent for future portability.
- [ ] Cross-hub violation resolutions (Section C) are acceptable.
- [ ] Path alias scheme (Section D) is acceptable.
- [ ] ESLint boundary enforcement (Section E) is desired (or fall back to manual review).
- [ ] Phase ordering and granularity (Section F) is acceptable.
- [ ] Verification checklist (Section G) is comprehensive enough.
- [ ] Rollback strategy (Section H) is acceptable.
- [ ] Effort estimate (Section I) fits the available calendar.
- [ ] Quick wins (Section J) are accepted, deferred, or rejected.

After approval, execution proceeds one phase at a time, committing only on green verification.

---

## Section L. What This Plan Explicitly Does NOT Touch

To make the safety promise concrete:

- No file under `app/api/training/*` is renamed or moved (URL contract).
- No file under `app/api/auth/*` is renamed or moved (NextAuth contract).
- No file under `app/api/cron/*` is renamed or moved (Vercel cron contract).
- `next.config.ts` host rewrites and redirects are unchanged.
- `vercel.json` is unchanged.
- `src/middleware.ts` stays at its current path (Next.js convention).
- Cookie names (`training_session`, `fmp-trusted-device`) are unchanged.
- Env vars are unchanged.
- Database migrations are unchanged. No new migration files are created.
- `app/globals.css` is unchanged.
- Public assets in `public/` are unchanged.
- The Apps Script URL stored in `training_settings.apps_script_url` is unchanged.
- The certificate inline-trigger in `app/api/training/submit-assessment/route.ts` is unchanged at the route level (only its imports update).
- The watch-tracking POST endpoints (`/api/training/certification-watch`, `/api/training/live-sessions/[id]/watched`) are unchanged at the route level.
- The newsletter cron, the session-reminder cron, and the Resend webhook are unchanged at the route level.

End of plan.
