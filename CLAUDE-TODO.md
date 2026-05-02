# Pending Work & Backlog

> Referenced from CLAUDE.md - features not yet started or in progress.

---

## Recently Completed — REFM Phase 4.6-4.15 design-token retrofit (2026-04-30 continuation session, 10 retrofit commits + 1 docs commit)

Closes Phase 4. Every component under `src/hubs/modeling/platforms/refm/` is now hex / rgba / 'white' / `input-assumption`-free end-to-end (verified by repo-wide grep, 0 matches). Establishes the FAST cell pattern that supersedes the yellow `.input-assumption` class inside REFM.

| Phase | File | Hash | Status |
|-------|------|------|--------|
| **Phase 4.6** | `Module1Timeline.tsx` | `cd9740f` | Complete. 9 hex/rgba + 7 className refs. **First Module 1 tab** to adopt the FAST cell pattern that 4.7-4.9 then mirrored: `inputStyle` (blue) and `calcOutputStyle` (grey-pale + heading) constants per file. Inputs flip from yellow `.input-assumption` to `var(--color-navy-pale)` bg + `var(--color-navy)` text; the className must be removed at the call site because the global `!important` rule in `app/globals.css` would otherwise override the inline blue back to yellow. Timeline visual phase bars retoken'd via `color-mix(var(--color-primary)/--color-success, transparent)` at 75%. |
| **Phase 4.7** | `Module1Area.tsx` | `273ec50` | Complete. 8 hex/rgba + 15 className refs. Hospitality label colour (3 occurrences) migrated from off-canon `#7c3aed` (Tailwind enterprise-tier purple) to `var(--color-navy-mid)` matching the canonical hospitality mapping in `Module1Financing.tsx:122`. Area Hierarchy table column-header pastels (`#93c5fd / #c4b5fd / #fca5a5`) retoken'd to `color-mix(var(--color-on-primary-navy) 60%, var(--color-navy/--color-gold/--color-negative))` — three distinct hues kept (blue / gold / red) so the column triad stays visually scannable. Hospitality pastel moved from violet to pale-gold (no purple token in the system). Area Hierarchy module-card inline-bg overridden to `var(--color-grey-pale)` to signal the calculated-outputs panel under FAST. |
| **Phase 4.8** | `Module1Costs.tsx` | `0226e22` | Complete. 7 hex/rgba + 11 className refs. Active-pill backgrounds (5 buttons sharing the navy 8% tint) folded to `color-mix(var(--color-primary) 8%, transparent)`; dev-fee mode toggle kept the slightly stronger 10% pp differential. `STAGE_COLOR[stageNum]` / `STAGE_BG_RGBA[stageNum]` / `PHASE_COLOR` imports from `src/styles/tokens.ts` left untouched — they are the canonical JS-side stage palette per the policy comment at the top of tokens.ts. |
| **Phase 4.9** | `Module1Financing.tsx` | `7a318cd` | Complete. 40 hex/rgba/'white' literals + 6 className refs — largest single retrofit. 24× hardcoded `'white'` (debt/equity/total schedule headers + asset chip + KPI tuple) all routed through `var(--color-on-primary-navy)` (brand-locked white in both modes). Dead `var(--color-navy, #1B4F8A)` / `var(--shadow-1, ..., rgba)` / `var(--color-row-alt, #F9FAFB)` defensive fallbacks stripped — tokens are always defined globally so the `, #literal` halves were unreachable. Subtle `rgba(0,0,0,0.01)` alt-row tint kept at 1% intent via `color-mix(var(--color-heading) 1%, transparent)` rather than flattening to `var(--color-row-alt)` (which would be ~5× stronger). Gold-tint card (rates callout) folded to `color-mix(var(--color-gold)/--color-gold-dark, transparent)`. |
| **Phase 4.10** | `PlanBadge.tsx` | `2e486c1` | Complete. 3 hex sites + alpha-derivation pattern. Plan tier base colour map relocated through `src/styles/tokens.ts` PLAN_COLOR canonical: `'#2563EB'` (Tailwind blue-600) → `'var(--color-navy)'` (matches `PLAN_COLOR.professional.color === COLOR.navy`); `'#7C3AED'` → `TOKEN_PLAN_COLOR.enterprise.color` (intentional off-canon purple per tokens.ts comment, no purple CSS var by design); fallback aligned. The `${color}1A` / `${color}40` 8-digit-hex alpha pattern (only viable when `${color}` is a literal hex) rewritten to `color-mix(in srgb, ${color} 10%/25%, transparent)` so it works with CSS-var values. Visual delta: PRO badge text shifts from blue-600 to brand navy; ENTERPRISE unchanged. |
| **Phase 4.11** | `modals/ProjectModal.tsx` | `f0535b8` | Complete. 3 rgba sites + 1 'white'. On-navy header chrome (subtitle + close button) routed through `color-mix(var(--color-on-primary-navy), transparent)`; info-tip card border `rgba(30,58,138,0.12)` → `color-mix(var(--color-primary) 12%, transparent)`. |
| **Phase 4.12** | `modals/VersionModal.tsx` | `e16d333` | Complete. 6 hex/rgba + 1 'white'. Same on-navy header chrome as 4.11. Save-version success-card border `'#BBF7D0'` (Tailwind green-200) → `var(--color-green)` matching the `.alert-success` border in app/globals.css. Active-version row + LOADED pill folded through `color-mix(var(--color-success), transparent)`; LOADED text colour normalised to `var(--color-success)` (same value via :root alias as Phase 4.2 / 4.7). |
| **Phase 4.13** | `modals/RbacModal.tsx` | `71f72ce` | Complete. 2 hex/rgba sites — both on the SELECTED pill that floats on the dark `.rbac-role-card` surface. Tailwind blue triad (`rgba(59,130,246,0.2)` / `#93c5fd` / `rgba(59,130,246,0.3)`) collapsed to brand navy + the same `color-mix(var(--color-on-primary-navy) 60%, var(--color-navy))` pale-navy pattern Phase 4.7 used for the Area hierarchy residential `<th>`. |
| **Phase 4.14** | `modals/ExportModal.tsx` | `97d6de7` | Complete. 19 hex/rgba sites + 5 'white'/'#fff' + a 3-key plan tier colour map driving 4 separate alpha-suffix derivations — the largest single retrofit (the modal had its own self-contained Tailwind-gray palette: gray-200 / 400 / 500 / 700 / 900 plus Tailwind blue-600). Plan-tier colour map relocated through tokens.ts (free → `var(--color-grey-mid)`, professional → `var(--color-navy)`, enterprise → `TOKEN_PLAN_COLOR.enterprise.color`). All gray-N hexes folded onto canonical FMP tokens (`var(--color-heading)` / `var(--color-meta)` / `var(--color-muted)` / `var(--color-border)` / `var(--color-surface)`). Plan-pill bg/border alpha derivations rewritten via `color-mix` so they work with the new CSS-var inputs. **Behaviour delta**: in REFM dark mode the modal now picks up the dark workspace palette (grey-pale → `#1F2A3A`, surface → `#1A222F`); previously a bright white slab on the dark workspace. |
| **Phase 4.15** | `RealEstatePlatform.tsx` | `48e5f3d` | Complete. 6 hex/rgba sites in two JSX overlay blocks (Module 8 'Upgrade to edit financials' lock overlay + the upgrade-prompt modal backdrop). **Critical**: the dark-mode plumbing block at lines 295-330 (`darkMode` useState + `body.dataset.refmTheme` useEffect + `toggleDarkMode` callback) is byte-identical post-retrofit — verified — so the workspace toggle continues to flip themes and persist to `localStorage['refmDarkMode']`. **Behaviour delta**: Module 8 lock overlay's frosted-white slab `rgba(255,255,255,0.85)` swapped to `color-mix(var(--color-surface) 85%, transparent)`, so it now frosts the dark workspace surface in dark mode rather than imposing a bright white slab. |

**Net total**: 10 retrofit commits + 1 docs/settings compaction commit (`71e4822`).

**Packages installed this session: none.**

**Schema changes this session: none.**

**New API routes this session: none.**

**New non-route files this session: none.** All 10 retrofit commits are pure edits to existing files.

**Modified files (REFM only):**
- `src/hubs/modeling/platforms/refm/components/modules/Module1Timeline.tsx` — Phase 4.6 (FAST cell pattern established)
- `src/hubs/modeling/platforms/refm/components/modules/Module1Area.tsx` — Phase 4.7
- `src/hubs/modeling/platforms/refm/components/modules/Module1Costs.tsx` — Phase 4.8
- `src/hubs/modeling/platforms/refm/components/modules/Module1Financing.tsx` — Phase 4.9
- `src/hubs/modeling/platforms/refm/components/PlanBadge.tsx` — Phase 4.10
- `src/hubs/modeling/platforms/refm/components/modals/ProjectModal.tsx` — Phase 4.11
- `src/hubs/modeling/platforms/refm/components/modals/VersionModal.tsx` — Phase 4.12
- `src/hubs/modeling/platforms/refm/components/modals/RbacModal.tsx` — Phase 4.13
- `src/hubs/modeling/platforms/refm/components/modals/ExportModal.tsx` — Phase 4.14
- `src/hubs/modeling/platforms/refm/components/RealEstatePlatform.tsx` — Phase 4.15 (orchestrator, dark-mode plumbing untouched)

**Verification per phase (all green)**: Module 1 regression-guard snapshot (`npx tsx scripts/module1-snapshot-diff.ts`) stayed at 17.5 KB baseline (exit 0) every step; `npm run type-check` clean every step; `npm run build` compiled successfully every step.

**Manual action required**: eyeball verification in BOTH light + dark modes for each phase per the per-commit `⚠️` notes — the visual deltas are documented in each commit body. Specifically for Phase 4.15: open the REFM workspace, toggle dark mode on/off via the topbar ☀️/🌙 control, and reload to confirm the theme persists across hard reload and that the body[data-refm-theme] attribute is removed when leaving the workspace (no leakage into admin / training surfaces). Module 8 lock overlay frosting now follows `var(--color-surface)`, so it'll be a dark frosted slab in dark mode (intended visual delta from prior bright-white slab).

### Phase 4.6-4.15 Follow-Ups

| Item | Notes |
|------|-------|
| **Eyeball verification across all 10 retrofits** | Owed before any further visual work. Each commit body lists the specific elements to inspect. The colour-mix derivations are mathematically equivalent to the prior alpha values (or +/- 1pp for rounding), so visual deltas should be subtle except where explicitly documented (Phase 4.10 PRO badge blue→navy, Phase 4.7 hospitality purple→navy-mid + Area pastel violet→gold, Phase 4.14 ExportModal in dark mode, Phase 4.15 Module 8 lock-overlay frosting). |
| **REFM Module 2-11 retrofits** | Out of scope for Phase 4 (those modules are not yet built — see Module Roadmap). When they ship, they should be authored with the FAST pattern from day one (`inputStyle`/`calcOutputStyle` constants, no `.input-assumption` className) so we don't re-accumulate inline literals. |

---

## Recently Completed — Modeling Hub foundation rebuild + REFM dark mode + Phase 4.2-4.5 retrofits + project edit + Module Roadmap consolidation (2026-04-30 session, 11 commits)

| Phase | Status |
|-------|--------|
| **Phase 4 cookie-scope rollback (Option A)** | Complete (commit `93ab0af` — combined revert). Reverted the prior Phase 4 commits that had introduced a NextAuth cookie-scope regression. Verified functional match to baseline `bcea1a7`, snapshot diff exit 0, type-check + build clean, then pushed. |
| **Foundation rebuild — canonical landing on app.* subdomain** | Complete (commit `005e7ce`). `app/portal/page.tsx` collapsed to a 5-line `redirect('${APP_URL}/modeling/dashboard')`. `/portal` removed from `MAIN_PATHS` in `next.config.ts`. `src/middleware.ts` swapped its non-admin `/admin/*` rejection redirect from `/portal` to `/`. `src/shared/email/templates/accountConfirmation.ts` re-targeted both `${APP_URL}/portal` references to `${APP_URL}/modeling/dashboard`. `app/modeling/dashboard/page.tsx` repurposed from a 3-card grid to the canonical sidebar layout: server-fetches CMS keys `logo_url` + `logo_height_px` + `header_height_px` (defaults 36 / 64 — match main-site `NavbarServer`); renders topbar at `minHeight: headerHeight` and sidebar at `top: headerHeight, height: calc(100vh - ${headerHeight}px)`. Hub-level dark mode toggle via `localStorage['modelingDarkMode']` (default → `prefers-color-scheme`), `data-theme` attribute does NOT leak into `/admin` or `/training`. **Cookie-scope bug deliberately out-of-scope** — NextAuth config NOT modified per session constraint. |
| **REFM workspace dark mode** | Complete (commit `b4691b7`). ☀️/🌙 toggle in Topbar between ⚙️ Settings and ← Hub. Own `localStorage['refmDarkMode']` key (separate from `modelingDarkMode`); default → `prefers-color-scheme`. Theme scoped via `body[data-refm-theme="dark"] .app-shell` so it never bleeds into admin or training. New design token `--color-on-primary-navy: #FFFFFF` added to `app/globals.css` (NOT overridden in dark scope) because `--color-grey-white` is overridden to `#1A222F` in dark and would have flipped white-on-navy chrome to invisible. Dark mode override block declares overrides for bg, surface, grey-white, grey-pale, border, border-light, muted, meta, body, grey-dark, heading, row-alt, row-hover, input-bg, warning-bg, warning-text, navy-light, navy-pale, shadow-1/2/hover. |
| **Phase 4.2 — OverviewScreen.tsx token retrofit + project edit + defensive empty state** | Complete (commit `afd0e4d`). 4 hardcoded literals replaced (Total GFA accent + active-version border/bg + LOADED pill) routed through design tokens + `color-mix()`. Pencil ✏️ button next to project name h1 gated on `can('canEditProject')`. Replaced silent `if (!proj) return null` with an actionable empty card so a stale `activeProjectId` no longer renders a blank Overview. TypeScript narrowing fix: `if (!proj || !activeProjectId)` to satisfy `onLoadVersion(activeProjectId, vid)` typing. |
| **Project name editing wired** | Complete (commit `cfca60a`). ProjectModal already supported edit mode but `onConfirm` was hardcoded. New `handleEditProject(name, location)` callback in `RealEstatePlatform.tsx` mutates active project, syncs state, persists to localStorage `refm_v2`, fires toast. New `handleEditProjectClick(pid?)` opens modal in edit mode. Two UI entry points: Overview header pencil + ProjectsScreen row pencil. Defensive hydration: `loadFromStorage()` drops stale `activeProjectId` if it doesn't resolve to a real project (covers cross-tab delete). |
| **Phase 4.3 — ProjectsScreen.tsx token retrofit + edit button** | Complete (commits `6ae4344` + `a75708f`). STATUS_COLORS map + ACTIVE pill — 5 rgba literals + 1 hex (`#92400e` → `var(--color-gold-dark)`) routed through `color-mix()`. Normalized `var(--color-green-dark)` → `var(--color-success)`. Per-row pencil ✏️ Edit button between Open and Delete (gated on `can('canEditProject')`, stops propagation). Two separate commits per session protocol — Task 1 (edit button) committed first, then Task 2 (token retrofit) committed second. |
| **Module Roadmap consolidation (Sidebar + Dashboard drift fix)** | Complete (commits `dba0952` + `e20f436`). Sidebar listed all 11 modules but Dashboard Module Roadmap only showed 1-6 (two parallel hardcoded lists). Both surfaces now consume `MODULES` from new file `src/hubs/modeling/platforms/refm/lib/modules-config.ts` (single source of truth: 11 entries, `ModuleStatus = 'done' \| 'soon' \| 'pro' \| 'enterprise'`, `ModulePlan = 'free' \| 'professional' \| 'enterprise'`). `shortLabel` for narrow sidebar rail, `longLabel` for wide dashboard rows. Dashboard introduces `STATUS_BADGE` map (4 variants routed through design tokens + `color-mix()`). |
| **Phase 4.4 — Sidebar.tsx token retrofit** | Complete (commit `9a0fe71`). 2 inline rgba literals replaced with `color-mix(in srgb, var(--color-on-primary-navy) X%, transparent)`. All visual states verified to render correctly in light + dark via the new `--color-on-primary-navy` token. |
| **Phase 4.5 — Topbar.tsx token retrofit** | Complete (commit `11e098b`). 12 hardcoded literals replaced. Imports `DEFAULT_BRANDING` from `@/src/core/branding` so OfficeColorPicker fallbacks stay as actual hex strings (the picker requires `hexToRgb`-able input — CSS vars wouldn't work) — keeps source file free of inline hex while preserving picker compatibility. `← Portal` (with `/portal` href) replaced with `← Hub` linking to `/modeling/dashboard`. Sign Out button border alpha via `color-mix`. |

**Net total**: 11 commits across the foundation rebuild + dark mode + Phase 4.2-4.5 retrofit + project edit + Module Roadmap consolidation.

**Packages installed this session: none.**

**Schema changes this session: none.**

**New API routes this session: none.**

**New non-route files this session:**
- `src/hubs/modeling/platforms/refm/lib/modules-config.ts` — single source of truth for all 11 REFM modules, consumed by Sidebar.tsx + Dashboard.tsx.

**Modified files (top-level):**
- `app/portal/page.tsx` — full rewrite as 5-line server redirect
- `app/modeling/dashboard/page.tsx` — full rewrite as canonical sidebar layout (server-fetch CMS header keys + dark mode + topbar + sidebar)
- `next.config.ts` — `/portal` removed from `MAIN_PATHS`
- `src/middleware.ts` — non-admin `/admin/*` redirect from `/portal` to `/`
- `src/shared/email/templates/accountConfirmation.ts` — both `${APP_URL}/portal` → `${APP_URL}/modeling/dashboard`
- `app/settings/page.tsx` — duplicate `← Portal` link removed; "redirected to the portal" → "redirected to the home page"
- `app/globals.css` — new `--color-on-primary-navy: #FFFFFF` token + REFM dark mode override block (`body[data-refm-theme="dark"]` + `body[data-refm-theme="dark"] .app-shell`)
- `src/hubs/modeling/platforms/refm/components/Topbar.tsx` — Phase 4.5 retrofit + ☀️/🌙 toggle + ← Hub link
- `src/hubs/modeling/platforms/refm/components/RealEstatePlatform.tsx` — REFM dark mode state + handleEditProject callbacks + defensive hydration cleanup + sidebarModules derived from MODULES
- `src/hubs/modeling/platforms/refm/components/OverviewScreen.tsx` — Phase 4.2 retrofit + edit pencil + actionable empty state
- `src/hubs/modeling/platforms/refm/components/ProjectsScreen.tsx` — Phase 4.3 retrofit + per-row edit pencil
- `src/hubs/modeling/platforms/refm/components/Sidebar.tsx` — Phase 4.4 retrofit
- `src/hubs/modeling/platforms/refm/components/Dashboard.tsx` — Module Roadmap consolidation (consumes MODULES from modules-config)

**Manual action required**: none. All changes are code-only. Module 1 regression-guard snapshot stays at 17.5 KB baseline (exit 0 each step).

### Foundation Rebuild Follow-Ups

| Item | Notes |
|------|-------|
| **NextAuth cookie scope (deferred known issue)** | Phase 4 had attempted to introduce a Domain-attribute cookie scope so the modeling hub could survive cross-subdomain navigation, and that change broke admin auth in subtle ways (cookie now visible to all `*.financialmodelerpro.com` hosts but rejected by NextAuth's CSRF token comparison). The Path 2 foundation rebuild eliminated the cross-subdomain assumption — Modeling Hub is end-to-end on `app.*` so the default exact-host cookie scope works. NextAuth config is intentionally unchanged in this session. **If a future session needs to introduce a Domain attribute** (e.g. for SSO between admin/main + app.*), revisit Phase 4's commits as the starting point and wire the CSRF + session token cookies together so they share a domain-scope policy; do NOT cherry-pick just the cookie config. |
| **Verify dark mode doesn't leak into admin / training** | Both REFM (`body[data-refm-theme="dark"] .app-shell`) and Modeling Hub layout (`data-theme` on root container of `/modeling/dashboard` only) use scoped selectors. Verified manually during the session. Re-test if any new admin or training surface starts mounting the modeling hub layout or REFM components. |
| **OfficeColorPicker hex requirement** | Topbar.tsx imports `DEFAULT_BRANDING` for picker fallbacks because the picker uses `hexToRgb()` internally and rejects non-hex strings (including CSS var references). Document this as a known constraint if more pickers are added. Future enhancement: extend OfficeColorPicker to resolve CSS vars at the boundary so callers can pass tokens. |

---

## Recently Completed — Watch Tracking Rebuild (2026-04-28 session, commits `c9a20e4` → `670fb51`, migrations 146 + 147)

| Phase | Status |
|-------|--------|
| **Phase 2 — Persist watch intervals across sessions (smoking-gun fix)** | Complete (commit `c9a20e4`, mig 146). Adds `watch_intervals JSONB` to `certification_watch_history` and `session_watch_history`. Pre-146 the tracker only persisted scalar `watch_seconds`; on a return visit `max(baseline, sumNew + open)` froze multi-session viewers at the largest single contiguous run forever (Fakhri stuck at 47% on 3SFM_S2 despite watching to completion). Now the tracker hydrates from JSONB on mount and POSTs a snapshot of merged intervals every progress tick; server unions with existing JSONB and re-derives `watch_seconds = sumIntervals(merged)` with a wall-clock rate limit on the new portion. Five tracker fixes: onPlay close-first, cross-session interval union, BUFFERING soft-pause handler, useRef re-seed without remount, force-flag on close events so the final partial interval lands in the DB. |
| **Phase 3 — Manual override path** | Complete (commit `13cb260`, mig 147). New columns `completed_via TEXT NULL` (`'threshold'` / `'manual'` / `'admin_override'`) and `video_load_at TIMESTAMPTZ NULL` (server-stamped on first POST per row, anchors the elapsed-time check). UI: CourseTopBar gains a checkbox-gated "I confirm I have watched this video" + Mark Complete button when watch% is in the [50, threshold) band. Server enforces `pct >= 50` AND `wall-clock elapsed >= total_seconds * 0.8` before honouring; 403 with diagnostic info bounces tampered submits. |
| **Phase 4 — Visibility (student progress bar + admin force-unlock)** | Complete (commit `e2dd9a4`). `WatchProgressBar` re-enabled with color-coded fill (red/amber/green) + dashed threshold marker + bypass-aware copy (was a no-op return null pre-Phase 4 because the pre-146 tracker had race conditions that made the displayed % unreliable). New admin endpoint `POST /api/admin/sessions/[tabKey]/force-complete-for-student` (admin-gated, prefix routing, audit_log entry, +50 points on live-session rows). Admin students panel gains a Watch Progress table with per-row Force Unlock buttons. Idempotent. |
| **Phase 5 — Surgical recovery for 4 stuck students** | Complete (commit `670fb51`). `scripts/phase5_recovery.ts` mirrors the endpoint logic via service role (HTTP endpoint requires NextAuth admin cookies which are awkward to thread from a CLI; same precedent as migration 140 / 141 service-role scripts). All 4 unblocked, all 4 audit entries confirmed by `scripts/phase5_verify.ts`. Targets: `muhammadtayyabmadni07@gmail.com` (3SFM_S1, 100%), `yusra.tufail@yahoo.com` (3SFM_S1, 93%), `daniyal1012@yahoo.com` (3SFM_S1, 76%), `fakhrizanul@gmail.com` (Fakhri, 3SFM_S2, 47%). Pre-fix snapshot at `supabase/backups/stuck_watch_2026-04-28.json`; post-fix audit at `supabase/backups/phase5_recovery_2026-04-28.json`. Notable: 3 of 4 were stuck on 3SFM_S1 specifically. |

**Net total**: +2,766 / -222 lines across 5 commits + 2 SQL migrations. **Schema changes**: migrations 146 + 147 (both manual Supabase apply, idempotent). **New API routes**: `POST /api/admin/sessions/[tabKey]/force-complete-for-student`. **Updated routes**: `/api/training/certification-watch` + `/api/training/live-sessions/[id]/watched` accept `manual_override` + `watch_intervals`. **New scripts (one-shot maintenance)**: `scripts/diagnose_stuck_watch.ts`, `scripts/phase5_recovery.ts`, `scripts/phase5_verify.ts`.

**Three unlock paths going forward**: `threshold` (auto at >=70%), `manual` (student override at >=50% + elapsed-time check), `admin_override` (admin force-unlock). The 70% threshold itself is unchanged.

### Watch Tracking Follow-Ups

| Item | Notes |
|------|-------|
| **Investigate 3SFM_S1 specifically** | 3 of 4 Phase 5 stuck students were on `3SFM_S1`. Could be coincidence (S1 is the highest-traffic session) or a session-specific edge case (e.g. video duration that triggers a particular tracker race). Worth a quick look if more students surface stuck on the same session post-fix. Cross-reference: video duration, `total_seconds` distribution across stuck rows, intervals data once more rows populate post-146. |
| **Monitor for new stuck students** | Re-run `scripts/diagnose_stuck_watch.ts` periodically (every 1-2 weeks) for the first month post-fix. Bucket counts should trend toward zero AUTO_UNBLOCK / ADMIN_REVIEW. RECENTLY_ACTIVE under threshold is normal (mid-course students). If new stuck students appear despite migrations 146+147 being applied, examine their `watch_intervals` JSONB to see what the tracker captured. |
| **Watch intervals analytics (future enhancement)** | The JSONB `watch_intervals` column carries a precise minute-by-minute coverage map per student per session. Could power: heat maps showing which video segments students rewatch, drop-off detection ("60% of students stop at 18:00 mark in S5"), session-quality scoring. Not in scope for the rebuild but worth noting for a future pass. |

---

## Recently Completed — Branding merge + Pricing simplification (2026-04-28 session, commits `ab5db30` → `777e1bf`)

| Feature | Status |
|---------|--------|
| **Part A — Branding merged into Header Settings** | Complete (commit `ab5db30`). After 2026-04-27 Phase 4 had reduced `/admin/branding` to two color fields, the dedicated page was a thin wrapper. Brand Colors section now lives at the top of `/admin/header-settings`, wired to the same `/api/branding` GET + PATCH endpoints. `saveAll()` fires the cms_content writes plus `/api/branding` PATCH in parallel. `/admin/branding/page.tsx` reduced to a 5-line server `redirect('/admin/header-settings')` so existing bookmarks keep working. Sidebar Branding entry removed; Header Settings gains `matchPaths: ['/admin/branding']`. `branding_config` table + `BrandingThemeApplier` + `--color-primary` / `--color-secondary` injection all unchanged. Net -349 / +102. |
| **Part B-2 — Pricing Page Content tab removed** | Complete (commit `50e22fa`). Diagnosis surfaced a real bug: the tab wrote to `cms_content` (section='pricing_page') but Page Builder writes to `page_sections` (slug='pricing'); the public `/pricing` page only read from `cms_content`, so Page Builder edits for the pricing slug were dead writes. Migration 046 had already seeded `page_sections` with the right shape. Fix: `/pricing` repointed to `getAllPageSections('pricing')`, hero badge / title / subtitle resolve from `pricing.hero` section, FAQ items resolve from `pricing.faq` section's `items[]` (with per-item `visible !== false` filter). Page Content tab UI deleted; Tab type narrowed to `'plans' \| 'platform'`. |
| **Part B-1 — Pricing Plans tab removed + migration 145** | Complete (commit `777e1bf`). The generic Free/Starter/Professional/Enterprise plan catalog (`pricing_plans`, migs 014/018) was the original pricing model but never wired into payment or feature gating — `platform_pricing` + `platform_features` + `plan_feature_access` (migs 076/077) is the canonical per-platform model that actually drives the public pricing page. The home-page pricing-teaser plan-name pill row in `app/(portal)/page.tsx` was the only public consumer; replaced with a clean "View Full Pricing →" CTA-only block. With Plans gone + Page Content gone, only Platform Pricing remained, so `/admin/pricing/page.tsx` was rewritten with no tab bar at all (single-purpose surface). Net -598 / +156. |

**Net total**: -1031 lines net across 3 commits (Part A: -247 net; Part B-2: -49 net; Part B-1: -442 net).

**Packages installed this session: none.** All changes were deletions or call-site refactors.

**Schema changes this session:**
- Migration 145 (`145_drop_pricing_plans.sql`): `DROP TABLE IF EXISTS pricing_plans CASCADE`. Idempotent; re-run is no-op. **Manual Supabase apply required** (run before next deploy that depends on the dropped table).

**New API routes this session: none.** All changes were deletions:
- `DELETE app/api/admin/pricing/plans/route.ts` (full route directory removed)

**New non-route files this session:**
- `supabase/migrations/145_drop_pricing_plans.sql`

**Modified files (top-level):**
- `app/admin/branding/page.tsx` — full rewrite as 5-line server redirect (332 lines → 5 lines)
- `app/admin/header-settings/page.tsx` — Brand Colors section added at top; dual-write to `/api/branding` in `saveAll()`
- `app/admin/pricing/page.tsx` — full rewrite as Platform Pricing only (620 lines → 252 lines); no tab bar, no Plans, no Page Content
- `app/pricing/page.tsx` — repointed to `getAllPageSections('pricing')`; hero + FAQ now from `page_sections`
- `app/(portal)/page.tsx` — removed local `getPublicPlanNames()` helper + planNames pill row + unused `getServerClient` import
- `src/lib/shared/cms.ts` — removed orphan `getPublicPlanNames()` export (no remaining importers)
- `src/components/admin/CmsAdminNav.tsx` — removed Branding nav entry; Header Settings gains `matchPaths: ['/admin/branding']`

**Manual action required**:
- **Apply migration 145 via Supabase dashboard SQL editor before next deploy.** The DROP is safe to run today — the code that referenced `pricing_plans` is already gone in production after the push.

---

## Recently Completed — Multi-Phase Admin Cleanup (2026-04-27 session, commits `fd0aabf` → `73e3e89`)

| Feature | Status |
|---------|--------|
| **Phase 1 — Dead Announcements stub removed** | Complete (commit `fd0aabf`). `/admin/announcements` page + `AnnouncementsManager.tsx` (212-line CRUD UI) + `/api/admin/announcements` route all queried a non-existent `announcements` table — abandoned sitewide-banners stub. Sidebar entry removed. -325 lines. |
| **Phase 2 — Pricing Features + Module Access tabs removed** | Complete (commit `4a5abe3`). The two dead tabs at `/admin/pricing` wrote to `pricing_features` and `pricing_modules` — neither the public pricing page nor the Modeling Hub Modules admin (separate `modeling_modules` table) ever read them. Tab UI deleted from `app/admin/pricing/page.tsx`, `/api/admin/pricing/modules/` route deleted. Plans + Page Content + Platform Pricing tabs preserved. -316 lines. |
| **Phase 3 — White-Label feature removed** | Complete (commit `a000fbd`). `/admin/whitelabel` page + `useWhiteLabel` hook + `BrandingConfig.whiteLabel` field were admin-write-only with REFM Topbar as the lone consumer (per-client name/logo override). Topbar now reads platform name + logo directly from the branding store via `getPlatformLogo()`. The `pdf_whitelabel` REFM export tier is preserved (label only, gating stubs to `false`). Sidebar entry removed. -390 lines. |
| **Phase 4 — Branding slimmed to colors-only** | Complete (commit `ee959ad`). Portal Identity (5 fields) + Logos (6 fields) sections were admin-write-only with no live consumers (besides the orphan `BrandingSettingsPanel.tsx`, never imported). `BrandingThemeApplier` reads `branding.primaryColor` directly. `getPortalLogo()` deleted; `getPlatformLogo()` retained for REFM Topbar. -1054 lines. |
| **Phase 5 — Permissions / User Overrides / Plans system removed** | Complete (commit `d8405e5`). The migration 006 trio (`features_registry`, `plan_permissions`, `user_permissions`) backed three sibling admin pages all wrapping the same 486-line `PermissionsManager` component. Read by REFM via `useSubscription()` client cache, but no server-side enforcement existed — gating was advisory. **Path A (aggressive)**: ripped out the entire stack. REFM premium features now stub `canAccess()` → `false` (existing `<UpgradePrompt>` overlays + lock indicators continue to render). Files deleted: 3 admin pages, 2 API routes, `src/lib/shared/permissions.ts`, `src/hooks/useSubscription.ts`, `src/components/admin/PermissionsManager.tsx`, `src/types/subscription.types.ts`. Inline-replaced: ExportModal / UpgradePrompt / PlanBadge keep `'free' \| 'professional' \| 'enterprise'` union locally. `core/branding.ts` lost the unused `USER_SUBSCRIPTION` stub + `hasAccess()`. SystemHealth lost its `/api/permissions` probe. -1169 lines, 2 sidebar entries removed. |
| **Phase 6 — Migration 144** | Complete (commit `b8b6df9`). `DROP TABLE IF EXISTS … CASCADE` on the 5 dead tables: `user_permissions`, `plan_permissions`, `features_registry`, `pricing_features`, `pricing_modules`. **Apply manually via Supabase dashboard before deploy.** |
| **Phase 7 — CLAUDE.md / DB / FEATURES / ROUTES docs** | Complete (commit `73e3e89`). All four primary docs reflect the cleanup. |

**Net total**: -3164 lines across 33 files; 11 admin pages/components/hooks/types deleted; 4 API routes deleted; 5 DB tables dropped (migration 144); 2 sidebar sections cleaned (User Overrides + Permissions removed; White-Label removed; Announcements removed earlier).

**Packages installed this session: none.** All changes were deletions or call-site refactors.

**Schema changes this session:**
- Migration 144 (`144_admin_cleanup.sql`): drops `user_permissions`, `plan_permissions`, `features_registry`, `pricing_features`, `pricing_modules` with `IF EXISTS … CASCADE`. Idempotent; re-run is no-op. **Manual Supabase apply required.**

**New API routes this session: none.** All changes were deletions:
- `DELETE /api/admin/announcements/route.ts`
- `DELETE /api/admin/pricing/modules/route.ts`
- `DELETE /api/permissions/route.ts`
- `DELETE /api/admin/permissions/route.ts`

**New non-route files this session:**
- `supabase/migrations/144_admin_cleanup.sql`

**Deleted files (admin pages):**
- `app/admin/announcements/page.tsx`
- `app/admin/whitelabel/page.tsx`
- `app/admin/permissions/page.tsx`
- `app/admin/overrides/page.tsx`
- `app/admin/plans/page.tsx`

**Deleted files (lib / hooks / components / types):**
- `src/lib/shared/permissions.ts`
- `src/hooks/useSubscription.ts`
- `src/hooks/useWhiteLabel.ts`
- `src/components/admin/AnnouncementsManager.tsx`
- `src/components/admin/PermissionsManager.tsx`
- `src/components/shared/BrandingSettingsPanel.tsx`
- `src/types/subscription.types.ts`

**Modified files (call-site refactors):**
- `app/admin/pricing/page.tsx` (Tab union narrowed; state, useEffects, JSX for Features + Modules tabs deleted)
- `app/admin/branding/page.tsx` (full rewrite; Brand Colors only)
- `src/types/branding.types.ts` (`whiteLabel` + `portalLogo*` + 4 portal text fields removed from `BrandingConfig`)
- `src/core/branding.ts` (`whiteLabel` merge logic, `getPortalLogo`, `canAccessFeature`, `USER_SUBSCRIPTION`, `hasAccess` deleted)
- `src/components/refm/Topbar.tsx` (uses `getPlatformLogo` + branding store directly, no `useWhiteLabel`)
- `src/components/refm/RealEstatePlatform.tsx` (`useSubscription` import dropped, replaced by `canAccess: () => false` + `subLoaded: true` stub)
- `src/components/refm/PlanBadge.tsx` (no longer re-exports `SubscriptionPlan`)
- `src/components/refm/modals/ExportModal.tsx` (inline `SubscriptionPlan` union)
- `src/components/shared/UpgradePrompt.tsx` (inline `SubscriptionPlan`, `FEATURE_LABELS` typed as `Record<string, string>`)
- `src/components/shared/BrandingThemeApplier.tsx` (no `wl.enabled` branch, reads `branding.primaryColor` directly)
- `src/components/admin/SystemHealth.tsx` (`/api/permissions` probe removed; check labels renumbered)
- `src/components/admin/CmsAdminNav.tsx` (Announcements + User Overrides + Permissions + White-Label sidebar entries removed)
- `src/constants/app.ts` (`PERMISSIONS_LOAD_TIMEOUT_MS` removed)

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
| **Watch threshold hidden from students** | Superseded 2026-04-29 — the watch threshold itself was retired (commit `f583c70`). Mark Complete now unlocks 20 seconds before video end via the d-20 tick fallback (commit `f790fa9`); no percentage-based gate remains. Original commit `1d45bf7`. |
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
| **Pricing / Subscriptions** | `/admin/pricing` is now a single Platform Pricing surface (no tab bar). Plans + Page Content + Pricing Features + Module Access tabs all removed across 2026-04-27 / 2026-04-28. Migration 145 dropped `pricing_plans`. Page Builder → Pricing owns hero + FAQ for the public page. Plan-based feature gating ripped out (commit `d8405e5`); REFM stubs `canAccess()` → `false`. | Reintroduce plan-based gating as a focused new feature spec when paid tiers go live (server-enforced from day one, built on the surviving `platform_pricing` + `platform_features` + `plan_feature_access` tables). |
| **Branding** | Brand Colors section moved into `/admin/header-settings` (2026-04-28, commit `ab5db30`). `/admin/branding` is a 5-line redirect. Drives `--color-primary` / `--color-secondary` via `BrandingThemeApplier`. | None — Header Settings owns brand colors + logos + favicon + header text + header layout in one place; Page Builder owns page copy. |

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
