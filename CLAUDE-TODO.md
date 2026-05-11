# Pending Work & Backlog

> Referenced from CLAUDE.md - features not yet started or in progress.

---

## Recently Completed, Email Migration Resend → Brevo + Per-Session Quiz Email Removal (2026-05-11, 1 commit + 1 docs commit)

Closes the Resend → Brevo transactional-email migration and removes per-session quiz result emails. Templates were untouched (sender-agnostic). Final-exam result, lockout, certificate, and all transactional emails still fire.

| # | What changed |
|---|--------------|
| 1 | `npm uninstall resend && npm install @getbrevo/brevo`. `package.json` swap: `resend ^6.10.0` → `@getbrevo/brevo ^5.0.4`. |
| 2 | `src/shared/email/sendEmail.ts` rewritten: lazy `BrevoClient` singleton on `BREVO_API_KEY`; `parseSender("Name <email>")` → Brevo's `{ name, email }` shape; `sendEmail()` signature unchanged so the 29 caller files compile without edits; returns `{ id: messageId }` to mirror the old Resend `data` shape. |
| 3 | `sendEmailBatch()` rewritten as a `Promise.allSettled` loop over `transactionalEmails.sendTransacEmail`, binary ok/fail semantics preserved from the prior Resend `batch.send` wrapper. Comment in the file explains why the `announcement_recipient_log.resend_message_id` column was deliberately NOT renamed (backwards-compat with the notify route + admin UI + audit-log readers); it now stores Brevo message ids. |
| 4 | `app/api/training/submit-assessment/route.ts`: quiz result email gated on `(isFinal ?? false) && resolveIsFinal(tabKey)` — same defense-in-depth pattern as the existing model-submission gate. Per-session quiz emails (pass or fail) no longer fire. Per-session lockout email kept (still fires when max attempts exhausted). Final-exam email still fires. |
| 5 | Env references swept: `app/api/admin/env-check/route.ts` (`RESEND_API_KEY` label → `BREVO_API_KEY`), `scripts/testEmails.ts` (comment), `.env.example` (Email section: `RESEND_API_KEY` row → `BREVO_API_KEY` row with `xkeysib-...` example). |
| 6 | `npx tsc --noEmit` clean. `npm run build` compiled in 16.2s. Zero `RESEND_API_KEY` or `from "resend"` matches in `*.ts/tsx/js/jsx`. |
| 7 | Docs commit (this entry): CLAUDE.md, PROJECT_HANDOFF.md, PLATFORM_INVENTORY.md, CLAUDE-ROUTES.md, CLAUDE-FEATURES.md, CLAUDE-TODO.md updated to reflect Resend → Brevo + path correction `src/lib/email/` → `src/shared/email/` + `sendEmailBatch` Promise.allSettled note + per-session email removal. |

**Commit hash**: `166a8ec` (migration), follow-up docs commit on 2026-05-11.

**Packages installed this session**: `@getbrevo/brevo ^5.0.4`. Removed: `resend ^6.10.0`.

**Env vars**: `BREVO_API_KEY` (new) replaces `RESEND_API_KEY`. `RESEND_WEBHOOK_SECRET` retained as bearer-token check on `/api/email/send` and for the dormant Resend webhook handler (see follow-ups).

**Follow-ups (out of scope for this commit):**
- **Resend webhook handler is dormant.** `/api/webhooks/resend` still parses Svix signatures but Resend stopped sending events the moment we cut over. Newsletter delivery / open / click / bounce / complaint tracking on `newsletter_recipient_log` is currently fed only by the `/api/newsletter/click` 302 redirector. Wiring a Brevo webhook to keep engagement signal flowing is a follow-up.
- **Source-comment cleanup**: `src/shared/newsletter/sender.ts` line 18 still says "Fire `resend.batch.send([100])`" in its docstring; the body now goes through `sendEmailBatch` which loops Brevo. Doc-only fix.
- **Newsletter path note**: `src/shared/newsletter/` is referenced as `src/lib/newsletter/` in some doc tables; that path correction is separate from this email-only sweep.
- **`RESEND_WEBHOOK_SECRET` env var name** is now misleading: it doubles as the `/api/email/send` bearer token. Rename to a generic name (e.g. `EMAIL_BRIDGE_BEARER_SECRET`) when the Brevo webhook lands.

---

## Recently Completed, REFM Module 1 Phase M2.0j Module 1 Audit + Display Fixes (2026-05-07, 8 commits)

Closes M2.0j. Resolves 16 audit + display + structural items Ahmad eyeballed in M2.0i (Issue 17 Financing deferred). Schema stays at v8; phasing value-set narrows from 6 to 2 (`COST_PHASING_OPTIONS = ['even','manual']`) but read-side accepts legacy values via `migrateM20jPhasing` (idempotent fold to 'even' on save).

| # | What changed |
|---|--------------|
| M2.0j/1 (Fix 1 + 9) | `Phase.constructionPeriods` accepts 0 (operational-from-start phases); Tab 1 shows "Operational from start" when cp=0. Phasing simplified to Even + Manual % (legacy values still accepted on read, folded to 'even' on save). |
| M2.0j/2 (Fix 2 + 3 + 4 + 5 partial) | `Asset.type` optional + `resolveTypeCatalog` returns UNION for Mixed-Use / Custom. Land Parcel header `{currency}/sqm`. New `formatScaledForExport` helper for future Export module. `formatPercent` default decimals 1 → 2. New `formatArea` helper. ParcelRow threads scale + decimals. |
| M2.0j/3 (Fix 6) | Sub-unit area/units bidirectional sync. `metric=units` → both Count + Area editable; `metric=area` → Area editable, Count derives. Switch preserves area sqm. |
| M2.0j/4 (Fix 7 + 8 + 10 + 12 + 13 + 14+15) | New `AccountingNumberInput` primitive (focus = raw, blur = accounting). New `costLineCaption` helper (rate × metric = result inline under each cost row). `costLinePeriodEndDate` + `costLineProjectPeriodIndex` for phase-scoped period dates (Phase 2 Y1 = "Dec 26", not "Dec 25"). Hide zero rows in Capex by Period. Drop stage labels under cost line names. Drop 3 of 4 summary tables (Capex by Period is the single remaining roll-up). |
| M2.0j/5 (Fix 11 + 16) | Capex by Period offsets perPeriod[] by `(phaseStartYear - projectStartYear)` so phase Y1 lands in correct project column. SummaryTables remounts on granularity toggle via `key={`summary-${granularity}`}`. Per-asset selector bar at top of Tab 3 Inputs ("All Assets" + per-asset buttons). 3 summary cards beneath: Excl. Land / Excl. Land In-Kind / Incl. Land In-Kind. |
| M2.0j/6 | NEW `scripts/verify-m20j.ts` (60 pass / 0 fail / 2 skip without dev server, **canonical green**). NEW `tests/e2e/m20j-costs-audit.spec.ts` (8 specs + dark-mode). |
| M2.0j/7 | Docs sweep: CLAUDE.md M2.0j closure block + verifier table + Playwright entry; M2.0i re-titled "foundation for M2.0j". |
| M2.0j/8 | TSC fix: import `CostLine` from `module1-types` (it's not exported from `@core/calculations`). Restores Vercel build green. |

**Verification at phase close (all green):**
- `npm run type-check`: clean
- `verify-m20j.ts`: 60 pass / 0 fail / 2 skip without dev server
- Playwright `m20j-costs-audit.spec.ts`: 8 specs + dark-mode

**M2.0j pattern decisions for downstream phases:**
- `cp=0` is canonical for operational phases (start operating from `phase.startDate`). M5 Statements + M3 Cashflow read `computePhaseTimeline` and recognise cp=0 as "no construction window".
- `Asset.type` is optional; downstream calc handles `''` as "unspecified" with category-based `DEFAULT_USEFUL_LIFE_YEARS` fallback.
- `AccountingNumberInput` is the canonical money-input primitive. All future numeric inputs (revenue cohort prices, OpEx values, financing tranche amounts) use it for consistent on-blur formatting.
- Cost line caption pattern (× metric = result). M2.1 Revenue rate inputs follow the same pattern with a parallel `revenueLineCaption` helper.
- 2-option phasing (Even + Manual %) extends to all schedules: capex, revenue, opex, financing.
- Period dates align to PHASE start. Project-wide rollup tables offset by `(phaseStartYear - projectStartYear)`.
- Granularity toggle re-mounts via `key`. Standard pattern for any new view-granularity surface.
- Hide zero rows in Results. Editable Inputs always show all rows; read-only Results hide zero-totals.
- Per-asset selector + 3 summary cards is the canonical Inputs layout for Module 2.1 Revenue Tab.
- Display Scale + Decimals propagate via `makeProjectFormatter` or threaded `scale + decimals` props. Percentages always 2 decimals via `formatPercent` default. Areas (sqm) bypass scale via `formatArea`. Currency uses `formatScaled`.

---

## Recently Completed, Phase P-Sync Platform & Module Admin Sync (2026-05-07, 7 commits)

Closes the loop between three previously disjoint module/platform listings (the static `MODULES` constant in REFM, the legacy `modules` table in admin, and the hardcoded marketing `PLATFORMS` config). Ships two new Supabase tables, a public API surface, an admin two-level UI, a dynamic REFM sidebar fetch, and a public marketing page set.

| # | What changed |
|---|--------------|
| P-Sync/1 | NEW SQL migration `supabase/migrations/p_sync_platform_modules.sql`: `platform_modules` table (per-platform sub-modules + status enum + gating_tier + features jsonb + screenshots jsonb) + `platform_module_pages` table (page_section enum: hero/features/how_it_works/cta/testimonials, content_blocks jsonb). RLS public-read filters status='hidden' / visible=false. Cascade delete on module pages. Idempotent. Seed: 11 REFM modules at M2.0i state + Module 1 page content (4 sections). |
| P-Sync/2 | NEW `src/shared/cms/platform-modules.ts` (337 lines): TypeScript types + 9 helper functions (`getPlatformModules` / `getPlatformModuleBySlug` / `getPlatformModulePages` / `getPlatformModuleWithPages` for public reads; `adminListPlatformModules` / `adminListPlatformModulePages` / `adminUpsertPlatformModule` / `adminDeletePlatformModule` / `adminUpsertPlatformModulePage` / `adminDeletePlatformModulePage` for admin writes via service-role) + 5 typed content interfaces (HeroContent / FeaturesContent / HowItWorksContent / CtaContent / TestimonialsContent). |
| P-Sync/3 | NEW API routes: `/api/platforms/[platformSlug]/modules` (GET public + POST admin), `/api/platforms/[platformSlug]/modules/[moduleSlug]` (GET public + PATCH/DELETE admin), `/api/admin/platform-module-pages` (GET + POST admin), `/api/admin/platform-module-pages/[id]` (PATCH + DELETE admin). All admin writes guarded by NextAuth admin role check. Cache-Control: public, s-maxage=300 on public reads. |
| P-Sync/4 | NEW admin UI: `/admin/platform-modules` Level 1 platform tabs (REFM/BVM/FPA/...) read from /api/admin/modules; Level 2 modules table per active platform with inline create/edit/delete + status cycling + features textarea + slug locked on edit. NEW `/admin/platform-modules/[id]/pages` page-sections editor (one card per section, JSON textarea for content_blocks, per-section visibility, pre-seeded templates). CmsAdminNav grew "Platform Modules" entry. |
| P-Sync/5 | NEW `src/hubs/modeling/platforms/refm/lib/usePlatformModules.ts`: dynamic sidebar fetch hook. Falls back to `STATIC_SIDEBAR_MODULES` (computed from legacy `MODULES` constant) during inflight or on fetch error so sidebar never renders empty. Sidebar.tsx accepts optional `modules` prop; RealEstatePlatform.tsx passes the dynamic list down. |
| P-Sync/6 | NEW marketing routes: `/modeling-hub` (overview grid of all platforms), `/modeling-hub/[platformSlug]` (per-platform overview), `/modeling-hub/[platformSlug]/[moduleSlug]` (per-module marketing page rendering hero + features + how_it_works + testimonials + cta sections). Server-rendered with NavbarServer + SharedFooter, ISR revalidate=60s. |
| P-Sync/7 | NEW `scripts/verify-psync.ts` (70 pass / 0 fail / 3 skip without dev server). NEW `tests/e2e/psync-flow.spec.ts` (4 specs targeting public marketing surface + public API endpoint). |

**P-Sync pattern decisions for downstream phases:**
- Source of truth lives in Supabase, not in TypeScript constants. M2.1 Revenue + downstream module additions happen via inserts into `platform_modules` (admin UI) instead of editing `MODULES` in modules-config.ts.
- Three-way sync is intentional. Admin edits flow to workspace sidebar (via /api/platforms/.../modules) and marketing site (via /modeling-hub/...) within ISR window (60s).
- Page-sections are jsonb, not normalized. Each marketing section's content_blocks holds its own typed shape (HeroContent / FeaturesContent / etc.). Future enhancement could provide structured form per section type.
- Existing legacy `modules` table stays. It functions as the platforms-storage table even though its name predates the platform/module distinction. Renaming would touch every downstream admin API; the cost-benefit favours the comment-only workaround.
- RLS public read filters hidden + invisible. Anon role can never read status='hidden' modules or visible=false page sections. Service role bypasses for admin writes.

---

## Recently Completed, REFM Module 1 Phase M2.0i Final Polish (2026-05-07, 8 commits)

Closes M2.0i. Final Module 1 polish closing 10 issues Ahmad raised after M2.0h. Module 1 reads cleanly to a first-time financial modeler: all inputs annual, all outputs flexible-granularity with proper distribution, all formatting correct, operational phases handled properly. Schema stays at v8 (additive `Project.displayDecimals`, `Phase.status` / `historicalBaseline`, `Asset.historicalBaseline`; `SubUnitMetric` rename `'count'` → `'units'` is type-only, runtime accepts both).

| # | What changed |
|---|--------------|
| M2.0i/1 (Fix 1) | Drop Model Granularity input from Tab 1 + Tab 3/4 captions. modelType stays on schema for legacy compat but is no longer user-facing. |
| M2.0i/2 (Fix 3) | New `DisplayDecimals` enum (0/1/2/3) on Project. Tab 1 Display Settings card with Scale + Decimals radios. New `makeProjectFormatter(prefs)` helper. Threaded through every formatted cell. |
| M2.0i/3 (Fix 5) | Drop Parking Bays input. Asset card areas row collapses 4 → 3 cols. `Asset.parkingBaysRequired` stays on schema for legacy compat; `'rate_per_parking_bay'` filtered out of new-line dropdown. Future parking-bay revenue models as a Leasable sub-unit. |
| M2.0i/4 (Fix 7 + 8) | Strategy short labels ('Sell' / 'Operate' / 'Lease' / 'Sell + Manage') + STRATEGY_TOOLTIPS hover map. Sticky sidebar via `height: 100vh; overflow: hidden` on platform shell + scrollable `<main>`. |
| M2.0i/5 (Fix 6) | `SubUnitMetric` rename `'count'` → `'units'` (read-side accepts legacy 'count'). New switchMetric helper preserves area sqm on toggle. Unit Size always editable. |
| M2.0i/6 (Fix 9) | Compact reconciliation: `LandReconciliationBlock` + `AssetAreaReconciliationBlock` collapsed-by-default with status icon (✓/✗/⚠) + headline. Auto-expand on mismatch. localStorage persistence. |
| M2.0i/7 (Fix 10) | Operational phase historical baseline. New `PhaseStatus` (planning / construction / operational) + `PhaseHistoricalBaseline` interface (sunk capex, equity, debt drawn, current outstanding, cumulative depreciation, NBV fixed assets, last-12-months revenue + opex). Tab 1 Status column + 9-col baseline form on Operational. New calc helpers: `computePhaseHistorical(phase)` + `computeOperationalRunRate(baseline, period, revGrowth%, opexGrowth%)`. M5 Statements will consume both. |
| M2.0i/8 | NEW `scripts/verify-m20i.ts` (59 pass / 0 fail / 2 skip without dev server). NEW `tests/e2e/m20i-final-polish.spec.ts` (7 specs + dark-mode). |

**M2.0i pattern decisions for downstream phases:**
- Inputs are annual; outputs flex via `distributeAnnualToPeriods`.
- Display formatting is project-scoped via `makeProjectFormatter`.
- Parking is sqm-only at the cost-engine level; revenue models via Leasable sub-unit.
- Sub-unit metric is `'units' | 'area'`; storage stays one numeric `metricValue`.
- Strategy labels short with hover tooltips. Standard for any enum-driven dropdown.
- Reconciliation compact-by-default with localStorage persistence.
- Phase + Asset status drives lifecycle treatment (planned / construction / operational).
- Sticky sidebar at platform shell level.

---

## Recently Completed, REFM Module 1 Phase M2.0h Area Hierarchy + Cost Granularity + Display Cleanup + Migration Banner (2026-05-07, 8 commits)

Closes M2.0h. Closes 6 structural / display issues Ahmad raised after M2.0g: existing v7 projects need migration trigger + banner; currency suffix on every cell is noisy; area model needs proper NSA / BUA / GFA hierarchy; NDA optional toggle at parcel level for jurisdictions reserving roads / parks; construction cost rate needs flexibility to per-sub-unit; runtime view granularity toggle on Tab 3 Results was deferred from M2.0g and ships now. Schema stays at v8 (additive `Parcel.hasNdaDeduction` / `roadsPct` / `parksPct`, `CostMethod.per_sub_unit_custom_rates`, `CostLine.perSubUnitRates`).

| # | What changed |
|---|--------------|
| M2.0h/1 | Schema + 5 calc helpers: `computeAssetAreaHierarchy(asset, subUnits)` (NSA / BUA / GFA tiers), `computeParcelNda(parcel)`, `computeCostLinePerSubUnit(line, asset, subUnits)`, `distributeAnnualToPeriods(annual[], granularity, phasing)`, `formatPeriodLabel(iso, granularity)`. resolveAssetAreaMetrics rewires bua/gfa/nsa outputs (BUA includes Support, Parking is GFA-only). |
| M2.0h/2 | Tab 2 area hierarchy UI: drop M2.0g Asset BUA Total input (BUA derives now). 4 inputs (Support / Parking / Parking Bays / GFA override) + 3 chips (NSA / BUA / GFA). Asset Reconciliation block itemizes sub-units → NSA → BUA → GFA. Globals card grows to 8 cols. |
| M2.0h/3 | Tab 2 parcel NDA: 11-column parcels block with NDA? toggle + Roads% / Parks% / NDA / Effective NDA Rate columns. Land Reconciliation conditionally adds Total NDA line. |
| M2.0h/4 | Tab 3 per-sub-unit + granularity: cost row method dropdown adds "Per sub-unit custom rates" with per-row table (sub-unit / area / rate / total). Tab 3 Results gains runtime granularity toggle (Annual / Quarterly / Monthly) re-rendering all 4 summary tables via `distributeAnnualToPeriods`. |
| M2.0h/5 | Currency display cleanup: `currencyHeaderLine(currency, scale)` returns "All figures in SAR" / "... '000" / "... M". Header line at top of every tab. In-cell currency suffixes removed (cells render pure numbers via formatScaled). |
| M2.0h/6 | v7 → v8 migration banner: `M20H_MIGRATION_NOTICE` constant + `snapshotNeedsV8Migration` fingerprint. Dismissable banner shown on first open of migrated v7 snapshot. Idempotent (saves migrated payload, banner won't reappear). |
| M2.0h/7 | NEW `scripts/verify-m20h.ts` (62 pass / 0 fail / 2 skip without dev server). |
| M2.0h/8 | NEW `tests/e2e/m20h-area-hierarchy-cost-granularity.spec.ts` (6 specs). |

**M2.0h pattern decisions for downstream phases:**
- Three-tier area hierarchy is the canonical convention from v8 forward. NSA ⊂ BUA ⊂ GFA where NSA = revenue sub-units, BUA = NSA + Support, GFA = BUA + Parking.
- Parcel NDA is parcel-level, not project-level. Each parcel carries its own toggle + roads / parks split.
- Per-sub-unit custom cost rates is the canonical pattern for granular cost differentiation.
- Runtime view granularity is project-wide and persists on the project (`project.outputGranularity`).
- Currency code lives in the per-tab header line. Cells render pure numbers via `formatScaled`.
- Migration banner pattern: hand-off via `CheckedHydration.migrationNotice` + `AttachResult.migrationNotice` + dismissable shell banner.
- Schema stays at v8 with additive optional fields. v8 snapshots that pre-date M2.0h continue to load and save without forced migration.

---

## Recently Completed, REFM Module 1 Phase M2.0g Display + Reconciliation + Costs Restructure + v8 Schema (2026-05-06, 11 commits)

Closes M2.0g. Resolves the 7 testing-feedback items + 3 addendum items Ahmad raised on M2.0f. Pivotal v7 → v8 schema bump: inputs are entered annually, output granularity (`outputGranularity: 'annual' | 'quarterly' | 'monthly'`) replaces `project.modelType`, phase periods are now always integer YEARS regardless of the eventual statement granularity. Pre-v8 monthly snapshots are migrated by aggregating each phase's `constructionPeriods / operationsPeriods / overlapPeriods` from months to years (×12 → ×1).

**Per-commit shape:** 11 commits. Snapshot baseline regenerated twice (M2.0g/3 after end-of-period date convention change, then M2.0g/9 after the v8 schema bump): `scripts/baselines/module1-v5.json` ends at 47.8 KB sha256 22923b5275a7.

| # | What changed |
|---|--------------|
| M2.0g/1 (Fix 1) | Period end-of-period dates: `periodEndDate(start, periods, modelType)` returns the LAST DAY of the last period (Dec 31 of year N for annual, last day of month N for monthly), not the FIRST DAY of period N+1. `computePhaseTimeline` + `computeProjectEndDate` re-anchored. MAAD endYear changes 2039 → 2038. |
| M2.0g/2 (Fix 2) | Tab 2 land reconciliation block at top of Module1Assets. New testIds: `land-reconciliation`, `land-reconciliation-parcels-sqm`, `land-reconciliation-allocated-sqm`, `land-reconciliation-status` (matches / mismatch by N sqm). Parcel dropdown defaults to first parcel + adds Weighted Average + Custom Rate options (`PARCEL_WEIGHTED_AVG` / `PARCEL_CUSTOM_RATE` sentinels). |
| M2.0g/3 | Snapshot baseline regenerated for end-of-period date drift (47.8 KB sha256 f30d5d219e57). |
| M2.0g/4 (Fix 3 + Addendum 3) | Wizard Step 1 grows Display Scale radio block (full / thousands / millions) + always-years column headers in Step 2 (regardless of Reporting Granularity). New `wiz-displayScale-*` testIds. Reporting Granularity replaces Model Granularity label. |
| M2.0g/5 (Fix 4 + 5) | Tab 2 asset card grows asset-level Support / Parking inputs (`supportArea`, `parkingArea`) + BUA reconciliation block with itemized breakdown (Sellable + Operable + Leasable + Support + Parking = BUA Total). Drops sub-unit category 'Parking' (asset-level instead). |
| M2.0g/6 | Display scale formatters (`formatScaled`, `formatScaledCurrency`, `formatInteger`) added to `@core/formatters`. Display scale threaded into Module1ProjectPhases / Module1Assets / Module1Costs / Module1Financing. |
| M2.0g/7 (Fix 7) | Module1Costs gains Inputs / Results sub-tabs (`costs-sub-tabs`, `costs-sub-tab-inputs`, `costs-sub-tab-results`). Results tab renders 4 summary tables (Capex by Period per cost-line, Capex by Stage transposed, Capex by Treatment, NEW Capex by Cost Type per Asset) all with Total in 2nd column. Direct / Indirect labels removed (Fix 6). Period labels Y0/Dec 25 (Addendum 2). |
| M2.0g/8 (Addendum 1) | Manual % phasing UI restoration. Selecting `phasing='manual'` on a cost line reveals per-period inputs (`*-manual-row`), live sum (`*-manual-sum`), and auto-normalize button (`*-manual-normalize`) that proportionally scales values to 100%. |
| M2.0g/9 (Addendum 3) | **v7 → v8 schema bump.** `SCHEMA_VERSION = 8`. New helpers: `isV8Snapshot`, `migrateV7ToV8` (aggregates monthly phase periods 12 → 1), `migrateM20gParkingSubUnits` (drops 'Parking' sub-units, sums area into `asset.parkingArea`). `Project.modelType` removed; `Project.outputGranularity` (`'annual' \| 'quarterly' \| 'monthly'`) added. New cost methods: `rate_x_support_area`, `rate_x_parking_area`, `rate_x_specific_subunit`. Snapshot baseline regenerated: 47.8 KB sha256 22923b5275a7. |
| M2.0g/10 | NEW `scripts/verify-m20g.ts` (5 sections, 68 pass / 0 fail / 2 skip without dev server, **canonical green**). All prior M2.0[d-f] verifiers still green via loosen-prior-verifier precedent (M2.0e ProjectTypes assertion `>= 6` not `=== 6`; M2.0d cost methods `>= 14` not `=== 14`). |
| M2.0g/11 | NEW `tests/e2e/m20g-display-recon-costs.spec.ts` (5 specs covering wizard Step 1 Display Scale + Reporting Granularity, Tab 3 Inputs/Results sub-tabs, Tab 2 land reconciliation, Tab 2 asset card asset-level Support/Parking + BUA reconciliation, Manual % phasing per-period inputs). Light/dark screenshots into `tests/screenshots/M2.0g/`. Docs sweep across CLAUDE.md (M2.0g closure block + M2.0f re-titled "foundation for M2.0g"). |

**Verification at phase close (all green):**
- `npm run type-check`: clean
- `verify-m20g.ts`: 68 pass / 0 fail / 2 skip without dev server (canonical green for the v8 schema)
- `verify-m20[d-f].ts`: still pass after the loosen-prior-verifier precedent
- Playwright `m20g-display-recon-costs.spec.ts`: 5 specs

**M2.0g pattern decisions for downstream phases:**
- Inputs are always annual; granularity is an output-time concern only. Module 5 Statements + Module 3 Cashflow consume v8 snapshots and produce annual / quarterly / monthly views by aggregation, not re-input.
- Display Scale is a model-wide property (`project.displayScale`). All numeric tiles + tables thread through `formatScaled` / `formatScaledCurrency`. Module 2 Revenue should adopt the same pattern from day one.
- End-of-period dates (Dec 31 / last day of month) are the canonical date convention going forward. `periodEndDate(start, periods, modelType)` is the single helper; never compute end as `start + periods` directly.
- Sub-unit category 'Parking' is retired; asset-level `parkingArea` is the source of truth. Module 2 Revenue should bind parking-related revenue (paid parking, valet) to `asset.parkingArea` directly.
- Costs Tab Inputs/Results split is the canonical pattern for any tab that has both editable rows and roll-up summary tables. Module 2 Revenue + Module 3 OpEx + Module 5 Statements should follow the same shape.

**Schema bump v7 → v8 is the third hard-cut.** Pre-v8 snapshots flag with "Schema migrated to v8. Please recreate this project." Same precedent as v5→v6, v6→v7.

---

## Recently Completed, REFM Module 1 Phase M2.0f Structural Fixes (2026-05-06, 6 commits)

Closes M2.0f. Resolves 6 testing-feedback items Ahmad raised after M2.0e (header clipping, multi-parcel allocation per-parcel rates, project type catalog 6 → 14, Phase Start Date persistence to Tab 1, project end-date off-by-one, sub-unit BUA as source of truth). Additive on v7 schema (no SCHEMA_VERSION bump within M2.0f; v8 ships in M2.0g).

**Per-commit shape:** 6 commits, baseline regenerated once mid-phase.

| # | What changed |
|---|--------------|
| M2.0f/1 (Fix 1) | `app/globals.css` `.pm-toolbar` `position: fixed` → `position: sticky; top: 0`. Removes a redundant 40px top offset that clipped the page header below the topbar at viewport scroll. `.module-view` removes redundant padding so the dashboard fills the new sticky envelope correctly. |
| M2.0f/2 (Fix 2) | Multi-parcel land allocation. New `AssetLandAllocation` shape (`mode: 'single' \| 'split' \| 'weighted'`) with optional `parcelSplits[]` (per-parcel sqm + cash% + in-kind%). New sentinels: `PARCEL_WEIGHTED_AVG` (allocate proportionally to all parcels), `PARCEL_CUSTOM_RATE` (per-parcel custom rate). New calc helpers: `computeAssetLandBreakdown`, `validateLandAllocation`. Module1Assets per-asset land card renders mode toggles + per-parcel rows. |
| M2.0f/3 (Fix 3) | `PROJECT_TYPES` expanded 6 → 14: adds Industrial, Data Center, Education, Healthcare, Marina, Hospitality + Branded Residences, Senior Living, Self-Storage. `SUGGESTED_CATEGORIES_BY_PROJECT_TYPE` + `ASSET_TYPES_BY_PROJECT_TYPE` updated. Wizard Step 3 radio block grows to 14 entries. |
| M2.0f/4 (Fix 4 + 5) | Phase Start Date persistence to Tab 1 (was wizard-only in M2.0e). Module1ProjectPhases gains a date input column wired to `phase.startDate`. Computed end columns (Construction End, Operations Start, Operations End) display via `periodEndDate` helper. Project end-date off-by-one fix: `computeProjectEndDate` now returns last day of last period, not first day of next period. |
| M2.0f/5 (Fix 6) | Sub-unit BUA as source of truth. `Asset.buaTotal` removed; new `computeAssetAreaTotals(asset, subUnits)` derives `buaTotal` + per-category sums + parking totals. Module1Assets BUA reconciliation block displays `derivedBuaTotal` from sub-units. Calc engine updated end-to-end (computeAssetCost reads `computeAssetAreaTotals(asset, subUnits)` instead of `asset.buaTotal`). |
| M2.0f/6 | NEW `scripts/verify-m20f.ts` (61 pass / 0 fail / 2 skip without dev server). NEW `tests/e2e/m20f-structural-fixes.spec.ts` (4 specs covering 6 fixes). Snapshot baseline regenerated for the BUA derivation drift. Docs sweep. |

**Verification at phase close (all green):**
- `npm run type-check`: clean
- `verify-m20f.ts`: 61 pass / 0 fail / 2 skip without dev server
- Playwright `m20f-structural-fixes.spec.ts`: 4 specs

---

## Recently Completed, REFM Module 1 Phase M2.0e Wizard Simplification + Tab 2 Full Asset Entry (2026-05-06, 8 commits)

Closes M2.0e. Wizard simplifies to capture only project shape (basics + phases + land + project type); detail entry lives in Tab 2 going forward. Additive schema (no SCHEMA_VERSION bump, v7 stays).

| # | What changed |
|---|--------------|
| M2.0e/1 | Schema additions: `Phase.startDate?`, `Asset.status?`, `Project.projectType?` + `PROJECT_TYPES` (6) + `ASSET_STATUSES` (3). New catalogs: `ASSET_TYPES_BY_PROJECT_TYPE` + `SUGGESTED_CATEGORIES_BY_PROJECT_TYPE`. New helpers: `computePhaseTimeline(phase, project)`, `computeProjectTimeline`. |
| M2.0e/2 | Wizard Step 2 column headers gain unit suffix tracking `draft.modelType` ("Construction (years)" / "(months)"). New Phase Start Date column inserted before Construction. addPhase auto-defaults next phase startDate = prior.startDate + prior.constructionPeriods. |
| M2.0e/3 | Wizard Step 3 simplified. `WizardDraftAsset` interface retired. `WizardDraft.assets[]` removed. `WizardDraft.projectType` added (single ProjectType pick). Step 3 collapses from per-asset card grid into a single 6-radio project-type pick + a "Tab 2 will suggest" preview. |
| M2.0e/4 | Tab 2 rewrite. Per-phase asset sections replace the flat "Assets" list. AssetCard rebuilt with header row (name + Phase dropdown reassign + Strategy + Type catalog filtered via `resolveTypeCatalog` + Status pill + Visible + Delete). Sub-unit table with new column shape (Type / Category / Metric / Area / Unit Size / Count / Rate / Rate Unit). Card footer with BUA reconciliation + efficiency % + land cost. |
| M2.0e/5 | Snapshot baseline regenerated 47.8 KB sha256 824ef8e1706d (drift sources: phase.startDate populated, project.projectType: 'Mixed-Use', Asset.status: 'planned', Asset 3 type renamed to match Mixed-Use catalog). |
| M2.0e/6 | NEW `scripts/verify-m20e.ts` (58 pass / 0 fail / 2 skip without dev server). |
| M2.0e/7 | NEW `tests/e2e/m20e-wizard-tab2.spec.ts` (6 specs). |
| M2.0e/8 | Docs sweep: CLAUDE.md M2.0e closure block, scripts table updated. |

---

## Recently Completed, REFM Module 1 Phase M1.13b Inline-Layout Polish (2026-05-06, 5 commits)

Closes M1.13b. Eliminates the standalone "Computed Envelope" / "Cascade Preview" / "Timeline Summary" panels added in M1.13 and re-anchors every formula caption inline directly beneath the input row that completes its formula. Reads as a continuous flow of input + formula + input + formula instead of input grid then panel of formulas at the bottom.

**Per-commit shape:** 5 commits, all 3 snapshot diffs (legacy 17.5 KB, multiphase 23.0 KB, areaprogram 2.8 KB) bit-identical at every step. Pure UI restructure, no calc engine touch.

| # | What changed |
|---|--------------|
| M1.13b/1 | Module1AreaProgram restructured into 8 ordered sections (Plot envelope, Podium, Typical tower, Floors check, Public area split, Parking surface, Parking vertical, Parking basement) with `SectionHeader` helper + `sectionGridStyle` + `formulaStackStyle` constants. FormulaCaption rows live directly under the input row that completes their driving inputs. Cascade preview panel dissolved into 8 inline FormulaCaption rows after MEP/BoH inputs. Removed legacy `calcRow` + `CascadeCell` helpers. LandParcelsBlock totals carry 3 FormulaCaption rows (parcel-formula-area, parcel-formula-value, parcel-formula-cash). |
| M1.13b/2 | Module1Timeline gray Timeline Summary panel dissolved. 3 captions re-anchored: `timeline-formula-type` beneath Granularity toggle, `timeline-formula-end` beneath Project Start input, `timeline-formula-total-periods` beneath Project Overlap input. Removed unused `calcOutputStyle` + `labelStyle` constants. |
| M1.13b/3 | Module1Financing Debt Summary card rolled up to clean 5-row reckoning. Inline FormulaCaption rows inside the summary card removed (they were redundant with the 3 input-side `financing-formula-*` captions retained from M1.13/5). Card label rolled back from "Debt Summary (live formulas)" to "Debt Summary". |
| M1.13b/4 | NEW `scripts/verify-m113b.ts` (5-section verifier with 11 markers: A1-A6 panel-absence + section + new inline-formula testIds, S1-S2 Schedule re-anchor, F1-F2 Financing rollup, X1 em-dash sweep). 23 pass / 0 fail / 0 skip with dev server up. NEW `tests/e2e/m113b-formulas-inline.spec.ts` (1 spec, 14.5s). Two contracts: (1) panel absence (computed-envelope-*, cascade-preview-*, timeline-summary, "Debt Summary (live formulas)" all count == 0); (2) proximity (`assertProximate` helper using bounding-box arithmetic verifies each driving input followed by its FormulaCaption within 0..200 vertical pixels). Live recompute reassertion + 8 light/dark tab screenshots into `tests/screenshots/M1.13b/`. |
| M1.13b/5 | Docs sweep: M1.13 + M1.13b series blocks added to CLAUDE.md, scripts table + Playwright spec table extended; m113-formulas.spec.ts + verify-m113.ts updated to track new inline-layout testIds (formula-max-gfa-{id} instead of computed-envelope-{id}) + rolled-up Debt Summary label. |

**Verification at phase close (all green):**
- `npm run type-check`: clean
- `module1-snapshot-diff` / `multiphase-diff` / `areaprogram-diff`: all 3 baselines untouched
- `npm run build`: clean
- `verify-m113b.ts`: 23 pass / 0 fail / 0 skip with dev server up
- Playwright `m113b-formulas-inline.spec.ts`: 1 passed (14.5s)

**No new tables, no new API routes, no new packages, no schema changes.** UI restructure only.

---

## Recently Completed, REFM Module 1 Phase M1.13 Self-Explanatory Module 1 (2026-05-06, 6 commits)

Closes M1.13. Makes Module 1 self-explanatory by surfacing every derived output's formula in plain English with live values next to its driving inputs. Every input edit recomputes the visible formula text inline (numbers swap in place, no layout reflow).

**Per-commit shape:** 6 commits, all 3 snapshot diffs bit-identical at every step. Pure UI; no calc engine touch.

| # | What changed |
|---|--------------|
| M1.13/1 | NEW `src/hubs/modeling/platforms/refm/components/ui/FormulaCaption.tsx` (~30 lines), reusable plain-English formula display primitive rendering `= <text>` in small italic meta-color, transparent bg, `data-formula="true"` + `data-testid` hook. Used by all 4 Module 1 tabs. |
| M1.13/2 | Module1AreaProgram per-Plot Computed Envelope panel + per-Asset Cascade Preview panel grow live formulas via FormulaCaption (eg "Max GFA = Plot Area * Max FAR = 100,000 * 5 = 500,000 sqm"). LandParcelsBlock totals carry 3 captions for area / value / weighted cash share. |
| M1.13/3 | Module1Timeline Schedule tab grows a Timeline Summary panel with 3 captions: model-type (Years vs Months), construction-end date math, total periods derived from construction + operations - overlap. |
| M1.13/4 | Module1Costs grows `buildCostFormula()` helper returning a plain-English formula for the active method (Per sqm / % of base / Lump sum / Per unit). Per-cost-row Total cell renders FormulaCaption beneath the value. Grand-total tfoot caption per asset. |
| M1.13/5 | Module1Financing grows 3 input-side captions: financing-formula-debt-equity (Debt = CapEx * LTV; Equity = CapEx - Debt), financing-formula-periodic-rate (annual % converted to per-period factor when modelType=monthly), financing-formula-repayment (term length explanation). Debt Summary card grows live FormulaCaption rows for Debt / Equity / Interest / Principal / Total. |
| M1.13/6 | NEW `scripts/verify-m113.ts` (5-section verifier covering FormulaCaption primitive existence + per-tab formula testId coverage + em-dash absence sweep). 23 pass / 0 fail / 0 skip with dev server up. NEW `tests/e2e/m113-formulas.spec.ts` (1 consolidated spec, 13.4s) walks all 4 tabs asserting FormulaCaption testIds + live recompute (edits Plot Max FAR + Plot Area, asserts Max GFA caption text updates inline within 3s without layout reflow). 8 light/dark tab screenshots into `tests/screenshots/M1.13/`. |

**Verification at phase close (all green):**
- `npm run type-check`: clean
- All 3 snapshot baselines untouched
- `npm run build`: clean
- `verify-m113.ts`: 23 pass / 0 fail / 0 skip with dev server up
- Playwright `m113-formulas.spec.ts`: 1 passed (13.4s)

**No new tables, no new API routes, no new packages, no schema changes.** UI-only addition.

---

## Recently Completed, REFM Module 1 Phase M1.12 Land Tab Elimination + 4-Tab Consolidation (2026-05-06, 6 commits)

Closes M1.12. Dissolves the standalone Land tab entirely. m1Tabs reduces from 5 to 4 entries: 1. Schedule, 2. Build Program, 3. Dev Costs, 4. Financing. Land Parcels capture lifts upfront into ProjectWizard Step 2 (default 100k sqm @ 500 single-row seed with inline add/remove + live totals); Build Program grows a Land Parcels block at the top of the tab with the same CRUD surface plus the Setup Wizard CTA. Site Parameters Project Roads % / Project FAR / Non-Enclosed Area % no longer have a UI surface and live only on the per-Plot card under Build Program.

**Per-commit shape:** 6 commits, all 3 snapshot diffs bit-identical at every step. Underlying state schema (`landParcels`, `projectFAR`, `projectRoadsPct`, `projectNonEnclosedPct`) is preserved so the calc engine signature + snapshot fixtures stay bit-identical; only the UI surface is gone.

| # | What changed |
|---|--------------|
| M1.12/1 (`ae7fec6`) | ProjectWizard Step 2 grows a Land Parcels capture block. New `WizardDraftParcel` interface + `parcels: WizardDraftParcel[]` field on WizardDraft seeded with one row (Land 1, 100,000 sqm, 500 / sqm, 60 / 40 cash split). NEW `Step2LandParcels` component (~150 lines) with inline Parcel Name / Area / Rate / Cash % / In-Kind % grid, +Add Parcel button, remove control per row when count > 1, totals row. Step 2 validation gate extended via `step2ParcelsValid`. data-testid hooks for Playwright. `buildWizardSnapshot` maps `draft.parcels` to `LandParcel[]` and writes `snapshot.landParcels`; per-plot area derives from `totalParcelArea / draft.plotCount`. |
| M1.12/2 (`8f99ce2`) | Build Program grows a Land Parcels block at the top of the tab. NEW `LandParcelsBlock` component renders the same 5-column table as the wizard but bound to the Zustand store via `setLand({ landParcels })`. Header row uses the FAST contrast convention via new local `parcelHeaderStyle` (navy bg) + `parcelHeaderLabelStyle` (white text, bold) constants threaded into `<InputLabel textStyle={...}>`. Help copy reuses `PARCEL_FIELD_HELP` from `lib/copy/parcelFieldHelp.ts`. ParcelSetupWizard CTA stays as a Setup wizard button on the block. |
| M1.12/3 (`b056062`) | Land tab dissolved entirely. m1Tabs reduces from 5 to 4 entries (no 'land' key). `Module1Area` import + JSX mount removed from `RealEstatePlatform.tsx`; replaced with a docstring marker explaining the schema is preserved. ProjectFAR / Roads % / Non-Enclosed % no longer have any UI surface; the per-Plot card under Build Program is the single source of truth users edit. Auto-derive deferred to M2.0 so the calc engine signature does not change inside this phase. |
| M1.12/4 (`4287623`) | Module 1 table-header contrast audit. `Module1Costs.tsx` grows a local `tableHeaderLabelStyle` constant (`color: var(--color-on-primary-navy); fontWeight: var(--fw-bold)`) threaded through 7 InputLabel instances inside `<th>` cells. Mirrors the new `parcelHeaderLabelStyle` introduced for Build Program in M1.12/2. Light-mode reads cleanly because the navy bg gives white text the WCAG AA contrast it needs. |
| M1.12/5 (`2a2b3a7`) | NEW `scripts/verify-m112.ts` mirrors the M1.11 5-section template. Section 4 markers F1 (m1Tabs has 4 entries with no 'land' key), F2 (Module1Area is unmounted), F3 (numbered labels renumbered 1-4), P1-P3 (wizard parcel default seed + Step2LandParcels mounted + buildWizardSnapshot writes landParcels), B1-B2 (Build Program LandParcelsBlock mount + FAST contrast constants), C1 (Module1Costs tableHeaderLabelStyle). 21 pass / 0 fail / 0 skip with dev server up; 15 pass / 0 fail / 2 skip without dev server. NEW `tests/e2e/m112-flow.spec.ts` (2 specs, 18.7s). Spec 1: wizard Step 2 parcel CRUD (default seed, +Add Parcel, edit area / rate / split, remove, live totals). Spec 2: post-create flow asserts the 4-tab row (no Land) + Build Program parcel block is the canonical CRUD surface + 8 light/dark tab screenshots into `tests/screenshots/M1.12/`. |
| M1.12/6 | Docs sweep: CLAUDE.md M1.12 series block, scripts table entry, Playwright spec entry, Module 1 status header extended with the M1.12 completion line. |

**Verification at phase close (all green):**
- `npm run type-check`: clean
- All 3 snapshot baselines untouched
- `npm run build`: clean
- `verify-m112.ts`: 21 pass / 0 fail / 0 skip with dev server up
- Playwright `m112-flow.spec.ts`: 2 passed (18.7s)

**No new tables, no new API routes, no new packages, no schema changes.** UI consolidation only. **Module 1 ships production-ready after M1.12; next phase is M2.0 (revenue, opex, deferred calc-engine refinements).**

**M1.12 deferred to M2.0 (calc engine territory, out of scope per phase brief):**
- ProjectFAR / Roads % / Non-Enclosed % auto-derive from per-plot maxFAR + plot landscape / hardscape coverage (today calc engine reads stored project-level scalars from snapshot; M2.0 should derive via weighted average so the snapshot can drop the redundant fields entirely).
- Migration sweep on existing user projects: snapshots written before M1.12 still carry the project-level scalars and load fine because the schema is preserved. M2.0 derive will need a one-time recompute + persist pass on live data so historical projects converge with newly created ones.

---

## Recently Completed, Training Hub Final Exam Gate Scope Correction (2026-05-06, 1 commit)

Hot-fix `f09b337` scopes the model-submission gate to the Final Exam only. Prior to the fix, the gate fired on every assessment (including practice quizzes + live-session assessments), which was not the intended behavior. NEW helper `src/hubs/training/lib/assessment/modelGateScope.ts` exports `isFinalExamAssessment(assessmentName: string): boolean` that normalizes the input and returns `true` only when the lowercased trimmed name === `'final exam'`. All gate-check sites in the assessment flow now wrap their existing gate logic in this predicate. No DB changes, no migrations, no new API routes; pure application-layer scoping.

---

## Recently Completed, REFM Module 1 Phase M1.11 Holistic Re-Audit + 22 Fixes (2026-05-05, 13 commits)

Closes M1.11 and ships **Module 1 as production-ready**. Comprehensive holistic re-audit of all 5 Module 1 tabs covering 7 areas: data flow integrity (every input writes to the canonical Zustand store, no orphaned setters), UX coherence (every label resolves to a single canonical surface), ProjectTimelineVisual (4 semantic dates instead of just Start/End), Land vs Build Program redundancy (independent arrays with reconciliation row, no double-edit risk), calc correctness (snapshot-baseline regression on all 3 fixtures stays bit-identical), first-time user flow (wizard projects land setup-complete on Schedule, no 0% / Over FAR / phantom badges), regression check on M1.5b through M1.10b. Audit produced via 4 parallel Explore agents over `src/hubs/modeling/platforms/refm/`.

**Audit doc:** `docs/MODULE_1_AUDIT_M1.11.md` (22 issues — 4 Critical / 8 Major / 6 Minor / 4 out-of-scope; 12-area fix grouping).

**Per-commit shape:** 13 commits, all snapshot diffs (legacy 17.5 KB, multiphase 23.0 KB, areaprogram 2.8 KB) bit-identical at every step. Em-dash sweep also runs across 175 files with `sed 's/ — /, /g; s/—/,/g'`, removing 1,386 em-dashes; excluded `js/refm-platform.js` (legacy bundle, untouchable) and `verify-m*.ts` docstrings (literal example text).

| # | What changed |
|---|--------------|
| M1.11/1 | ProjectWizard portals to `document.body` via React `createPortal` with SSR guard `if (typeof document === 'undefined') return null;` so the wizard stays viewport-centered when ancestor containing-blocks (transform/will-change on the platform shell) would otherwise swallow `position: fixed`. `step3Valid` tolerance widened from `< 0.01` to `< 0.1` so floating-point drift on Auto-balance doesn't gate Continue. |
| M1.11/2 | NEW `src/hubs/modeling/platforms/refm/components/ui/ProjectTimelineVisual.tsx` (~200 lines) replaces the M1.9 inline single-bar block in Module1Timeline. Renders horizontal phase bar + 4 semantic dates per phase: Project start, Operations start, Construction end, Project end. `Intl.DateTimeFormat('en-GB', { month: 'short', year: 'numeric' })`. One row per phase when `phases.length > 1`; gradient overlap strip when `overlap > 0`. testIds `timeline-bar-${id}` / `timeline-axis-${id}` / `timeline-overlap-${id}` / `timeline-overlap-callout-${id}` for Playwright. Subscribes to `phases` via `useShallow`. |
| M1.11/3 | Land tab dead-setter cleanup. Removed unused identity setters from Module1Timeline (setProjectName / setProjectType / setCountry / setCurrency / showAiButtons) and Module1Area (setResidentialPercent / setHospitalityPercent / setRetailPercent + matching deduct + efficiency setters). RealEstatePlatform JSX no longer threads them. Module1Area now subscribes directly via `const setLand = useModule1Store(s => s.setLand)` and writes via `setLand({ landParcels: next })` instead of prop-drilled `setLandParcels`. NEW shared `src/hubs/modeling/platforms/refm/lib/copy/parcelFieldHelp.ts` with 5 keys (name, area, rate, cashPct, inKindPct). ParcelSetupWizard now imports `PARCEL_FIELD_HELP` (replacing the local PARCEL_HELP map) and label drift is fixed ("Name" → "Parcel Name", "Rate (/sqm)" → "Rate (per sqm)"). |
| M1.11/4 | Module1AreaProgram InputLabel coverage. NEW shared `src/hubs/modeling/platforms/refm/lib/copy/assetStrategyHelp.ts` with 6 keys (primaryStrategy, primaryStrategyPct, secondaryStrategy, secondaryStrategyPct, zone, gfaOverride) wired into the strategy + zone + GFA override fields via `<InputLabel>`. Em-dash sweep collateral fixed: `if (!Number.isFinite(n)) return ',';` → `'n/a'`; Zone placeholder `","` → `"auto"`; literal "(none)" / "(no zone)" / "(blank if 100)" placeholders restored. |
| M1.11/5 | Module1Costs polish. What-goes-here callout expanded with a "Phase scope:" sub-paragraph naming what the tab does and doesn't own. 7 cost row column headers wrapped in InputLabel with help copy. |
| M1.11/6 | Module1Financing polish. Per-line Debt % header wrapped in InputLabel with `textStyle: { color: 'var(--color-on-primary-navy)' }` so the on-navy chrome stays readable. |
| M1.11/7-9 | Em-dash sweep across 175 files (`sed 's/ — /, /g; s/—/,/g'`), removing 1,386 em-dashes. Excludes `js/refm-platform.js` (legacy bundle) + `verify-m*.ts` docstrings (literal example text). New writing rule added at top of CLAUDE.md STRICT SESSION RULES: "NEVER use em-dashes". |
| M1.11/10 | NEW `scripts/verify-m111.ts` (5-section verifier per the standing per-phase template). 23 pass / 0 fail / 1 skip with dev server up. Includes `stripCommentLines` helper to filter `//` / `*` / `/*` lines so docstring mentions of removed setters (still in M1.7 / M1.8 docstrings inside the source files) don't false-fail. |
| M1.11/11 | NEW `tests/e2e/m111-full-flow.spec.ts` (2 specs, 49.9s). Spec 1: ProjectWizard portal regression guard, asserts createPortal + viewport-centered bounding box. Spec 2: wizard create + 5-tab walkthrough using `axis = page.locator('[data-testid^="timeline-axis-"]').first()` to scope timeline date labels (avoids strict-mode violation when "Project start" matches multiple elements). 10 light + dark screenshots into `tests/screenshots/M1.11/`. |
| M1.11/12-13 | Docs sweep + em-dash self-introduction fix in CLAUDE.md (2 em-dashes used as literal examples in description, caught and stripped in /13). |

**False positive from the audit agent** (skipped, noted in audit doc + final report): C1 (Status field never reaches store). Verification revealed `RealEstatePlatform.tsx:1248` already passes `status: draft.status` to `pclient.createProject`, so this was already wired correctly in M1.8.

**Verification at phase close (all green):**
- `npm run type-check`: clean
- `module1-snapshot-diff`: 17.5 KB matches baseline (untouched)
- `module1-multiphase-diff`: 23.0 KB matches baseline (untouched)
- `module1-areaprogram-diff`: 2.8 KB matches baseline (untouched)
- `npm run build`: clean
- `verify-m111.ts`: 23 pass / 0 fail / 1 skip with dev server up
- Playwright `m111-full-flow.spec.ts`: 2 passed (49.9s)

**No new tables, no new API routes, no new packages, no schema changes.** Pure UI + structural refactor + docs sweep. Module 1 ships production-ready.

**M2.0 deferred (carried forward):**
- ProjectFAR migration from Land to Build Program → Plot (calc still consumes it as a project-level scalar; needs auto-derive from per-plot maxFARs first).
- Section-pill labels ("Inputs" / "Calculated") on every section header.
- Calc-vs-input pencil ✏ / fx 𝑓𝑥 icons next to every field.
- Financial-vocabulary hover tooltips beyond what M1.10b already wired (Sub-Unit, Strategy, FAR, Cascade, etc.).
- Remove unused setters from Module1Area + Module1Timeline prop interfaces (still tagged with eslint-disable so RealEstatePlatform binding doesn't shift).
- Merge Project & Schedule even further: dissolve the Schedule tab + the structure tree card into a unified "1. Project & Schedule" surface where the Master Holding / Sub-Project / Phase tree drives the timing inputs (per-Phase section instead of project-level seed). Today the M1.9b mount keeps both surfaces side-by-side which is workable but still leaves project-level + per-phase timing visible at the same time.
- M2.0/A `hydrationFromAnySnapshot` recogniser was relaxed in M1.8 fix 5 (66a20f5) so this is no longer a blocker, but the legacy v2 fall-through path could still be tightened.

---

## Recently Completed, REFM Module 1 Phase M1.10b Plot Setup Polish + InputLabel Tooltips (2026-05-05, 8 commits)

Closes M1.10b. Three connected fixes follow on M1.10's Plot + Parcel setup wizards: (1) wizards portal to `document.body` so they stay viewport-centered, (2) inline Plot form vs Plot Setup Wizard reconciled to a 15-field shared spec with shared label-help copy, (3) reusable accessible `<InputLabel>` primitive with ⓘ tooltip wired into every input across all 5 Module 1 tabs.

| # | Commit | What changed |
|---|--------|--------------|
| 1 | `57a8fc0` | Plot + Parcel wizards render via React `createPortal(jsx, document.body)` (z-index 9999) instead of inline JSX nested in the Build Program / Land tab content. Pre-fix the modal inherited an ancestor's containing-block (transform/will-change on the platform shell), so `position: fixed` resolved relative to that ancestor and the wizard rendered below the viewport when scrolled. Portal mounts break out of the layout tree. SSR guard: `if (typeof document === 'undefined') return null;`. |
| 2 | `719542c` | Reconcile inline Plot form vs Plot Setup Wizard fields. Both surfaces now expose all 15 writable Plot fields with identical labels: Plot Buildable Area, Max FAR, Podium Coverage, Total Floors, Podium Floors, Typical Floors, Typical Coverage, Landscape, Hardscape, Surface Bay, Vertical Bay, Basement Bay, Basement Count, Basement Efficiency, Vertical Parking Floors. Label drift fixed ("Coverage" → "Podium Coverage", "Basements" → "Basement Count", "Basement Eff." → "Basement Efficiency"). PlotDraft type extended with verticalParkingFloors so the wizard captures every field the inline form does. |
| 3 | `b8918c8` | NEW reusable `<InputLabel label help inputId textStyle />` primitive at `src/hubs/modeling/platforms/refm/components/ui/InputLabel.tsx`. Renders uppercase label + ⓘ help button. Hover or keyboard focus reveals an absolutely-positioned tooltip; Escape + click-outside dismiss. ARIA: `aria-describedby` (wired conditionally while open), `aria-expanded`, `role="tooltip"` on the bubble. `pointerEvents: 'none'` on the bubble so it never steals clicks back. No external tooltip library, Radix would have been heavier than this 154-line primitive justifies. |
| 4 | `0bf9e7b` | Wire InputLabel into Schedule + Land tabs. Schedule: Model Granularity, Project Start Date, Project Construction, Project Operations, Project Overlap. Land: Land Parcels table headers (Parcel Name / Area / Rate / Cash % / In-Kind %) via a data-driven map, plus Site Parameters (Project Roads, Project FAR, Non-Enclosed Area %). Help copy is plain-English and explains the modeling consequence (e.g. "Years vs Months, controls how every cashflow is bucketed"). |
| 5 | `6b32ee8` | Wire InputLabel into Build Program + Plot/Parcel wizards. Plot help copy lives at `src/hubs/modeling/platforms/refm/lib/copy/plotFieldHelp.ts` as a `Record<string, string>` keyed by the 15 writable field names, so the inline form, the wizard, and any future surface share one source of truth. Parcel wizard uses an in-file `PARCEL_HELP` map (5 keys; later extracted to shared `parcelFieldHelp.ts` in M1.11/3). All `<label>` elements in both surfaces now render via `<InputLabel>`. |
| 6 | `b80b617` | Wire InputLabel into Dev Costs + Financing. Dev Costs: Alloc Basis + Input Mode (with `textStyle` override for the smaller inline labels). Financing: Financing Mode, Debt % of CapEx (LTV), Interest Rate, Capitalize Interest During Construction (restructured from `<label>` wrapper to inline checkbox + InputLabel sibling so the ⓘ icon doesn't break the label/checkbox click target), Repayment Method, Repayment Period. |
| 7 | `ddfb638` | NEW `scripts/verify-m110b.ts` (5-section verifier). Section 4b detects the 15th field (verticalParkingFloors) via `.field` accessor in Module1AreaProgram since it lives in a standalone JSX block rather than the quoted-key numField path. 18 pass / 0 fail / 0 skip with dev server up. |
| 8 | `476b109` | NEW `tests/e2e/m110b-flow.spec.ts` (2 specs, 44.6s). Spec 1: Plot Setup Wizard portal regression guard, scroll to bottom of Build Program (where a non-portal modal would inherit the parent containing-block and render below the fold), open the wizard, assert bounding box centered in 1440×900 viewport, focus a help icon, assert tooltip becomes visible, press Escape, assert dismissal. Spec 2: inline Plot form references all 15 writable-field labels + light/dark hover-driven tooltip screenshots into `tests/screenshots/M1.10b/`. |

**No new tables, no new API routes, no new packages, no schema changes.** All snapshot diffs bit-identical at every step.

---

## Recently Completed, REFM Module 1 Phase M1.10 Setup-Completeness (2026-05-05, 8 commits)

Closes M1.10. Five fixes turning fresh wizard projects into already-validated state on first paint, plus modal-step setup wizards for per-plot + per-parcel editing.

| # | Commit | What changed |
|---|--------|--------------|
| 1 | `d295dc8` (1/8) | Plot defaults inside FAR ceiling on first paint. `DEFAULT_PLOT_*` constants tuned: podiumFloors 2→1, typicalFloors 10→6, typicalCoveragePct 40→30. Math: (60·1 + 30·6) / (3·100) = 80% utilisation (was 173.3%). No calc engine change. Snapshot fixtures all pin these values explicitly so baselines unaffected. |
| 2 | `e9305d4` (2/8) | Platform-layer category-sum allocation derivation. RealEstatePlatform's `resAsset / hospAsset / retAsset` no longer use `assetById.get(LEGACY_ASSET_IDS.X)` (which missed wizard-minted ids like `wizardasset_1/2/3`). Replaced with `firstByCategory` resolver walking `assets[]` in array order matching on category (Sell ↔ residential, Operate ↔ hospitality, Lease ↔ retail). `residentialPercent / hospitalityPercent / retailPercent` now sum allocationPct across every asset in the bucket. Cost setters + filters route through the resolved id so the cost-seeder effect picks up wizard-minted assets. Snapshot fixtures have one asset per category with id matching the legacy literal so resolution is unambiguous either way. |
| 3 | `6419b3a` (3/8) | Wizard Step 2 fits 1080p without scroll. Section gap shrunk sp-3 → sp-2; MH descriptive paragraph compressed to a one-liner; Phases (Q2) + Plots (Q3) collapsed into a 2-column grid row. Estimated content-height reduction ~120-140px. |
| 4 | `d47c268` (4/8) | Land vs Plot reconciliation row + relabels. `landParcels[]` (financial, what you own) and `Plot[]` (physical, what you build on) stay independent arrays but Build Program now surfaces a reconciliation row showing Parcel total · Plot total · ✓ matches / ⚠ diverges. Tolerance 1 sqm. Land tab heading renamed "Land Parcels (financial, what you own)"; Build Program "Plot Area" input renamed "Plot Buildable Area" so the financial-vs-physical distinction is visible in both surfaces. |
| 5 | `9f48b76` (5/8) | NEW `PlotSetupWizard.tsx`. 4-step modal walk: Envelope (FAR + coverage) → Floors (podium + typical + typicalCoverage with live envelope preview showing utilisation %) → Parking (3 bay sizes + basement count + efficiency) → Assets (checkbox list of existing assets to re-bind to this plot via plotId updates). Local draft + Set of assigned asset ids; nothing leaks to the store until Save & Close. Cancel discards. Mounted from each PlotEditor card via "🪄 Setup wizard" button. Form view stays primary. |
| 6 | `89667ab` (6/8) | NEW `ParcelSetupWizard.tsx`. 2-step modal walk: build parcel list with "+ Add another parcel" pattern → review with totals → Save & Close commits via `setLand({ landParcels: next })`. Seeded from existing parcels so it reads as edit-not-restart. Mounted from the Land Parcels card via "🪄 Setup wizard" button. Form view stays primary. |
| 7 | `8f383c8` (7/8) | NEW `scripts/verify-m110.ts` (5-section verifier with section 4 covering all 5 fixes). 25 pass / 0 fail / 1 skip with dev server up. |
| 8 | `cfbb4f2` (8/8) | NEW `tests/e2e/m110-flow.spec.ts` (3 specs). Spec 1: wizard Mixed-Use lands clean (no 0% allocation badge, no Over FAR badge, reconciliation row visible). Spec 2: PlotSetupWizard 4-step walkthrough. Spec 3: ParcelSetupWizard 2-step walkthrough + screenshots into `tests/screenshots/M1.10/`. |

**M1.10 deferred (handled in M1.10b/M1.11 or carried into M2.0):**
- ✅ Plot+Parcel wizard portal-to-document.body (M1.10b/1).
- ✅ Inline Plot form vs wizard label reconciliation (M1.10b/2).
- ✅ InputLabel tooltip primitive across all 5 tabs (M1.10b/3-6).
- ⏳ ProjectFAR migration from Land to Build Program → Plot (M2.0 backlog).
- ⏳ Section-pill labels (Inputs / Calculated), calc-vs-input pencil/fx icons, hover tooltips for Sub-Unit/Strategy/FAR/Cascade vocabulary (M2.0 backlog).
- ⏳ Remove unused setters from Module1Area + Module1Timeline prop interfaces (still tagged with eslint-disable; M2.0 backlog).

**No new tables, no new API routes, no new packages, no schema changes.** All snapshot diffs bit-identical at every step.

---

## Recently Completed, REFM Module 1 Phase M1.9 + M1.9b UX Redesign + Hierarchy Dissolution (2026-05-04 → 2026-05-05, 6 + 8 commits)

**M1.9 redesign series (6 commits, 2026-05-04, all snapshot diffs bit-identical):**

| # | Commit | What changed |
|---|--------|--------------|
| 1 | `591315b` | ProjectWizard step 1 currency dropdown becomes country dropdown (auto-derives currency); Step 2 grows a Project Timeline section (construction + operations + overlap periods, unit hint follows modelType). `buildWizardSnapshot` wires the wizard's timing into every minted phase (clamped: overlap ≤ construction; opsStart = construction − overlap + 1). `Snapshot.country` populated from wizard. |
| 2 | `7626120` | Strip Asset Mix + Deduction & Efficiency panels from Module1Area. Both edited the same backing data the Hierarchy tab edits per-asset (`residentialPercent` = `resAsset.allocationPct` in `RealEstatePlatform.tsx:334`), so the duplication confused users about which tab is canonical. Site Parameters card stays (FAR, Roads %, Non-Enclosed % all still calc-input). Added a "Where did Asset Mix go?" explainer pointing to Hierarchy. |
| 3 | `93b6f1e` | Strip Project Identity card (project name, type, country / market dropdown, currency input) from Module1Timeline. Tab renamed "Project Schedule"; layout collapses 2-column → 1-column. Subtitle directs users to wizard / Hierarchy for identity fields. Props interface keeps now-unused identity setters with eslint-disable so RealEstatePlatform binding doesn't change in this commit. |
| 4 | `382a0c3` | `m1Tabs` gains a numeric `step` field; visible labels become "1. Schedule / 2. Land / 3. Build Program / 4. Dev Costs / 5. Financing / 6. Hierarchy". Reorder: Schedule moves to position 1, Hierarchy to position 6. `handleCreateProjectFromWizard` switches `setActiveTab('area-program')` → `setActiveTab('timeline')` so the user lands on Schedule and validates the wizard's capture before drilling further. Manual project creation still lands on Hierarchy (no asset structure yet, so the data tree is the right starting point). |
| 5 | `b8b54cc` | NEW `scripts/verify-m19.ts` (5-section per-phase verifier). 16 pass / 0 fail / 2 skip without dev server. Section 4 includes a static source-file inspection that asserts JSX-context patterns (`>Project Identity<`, `>Asset Mix<`) are gone. |
| 6 | `a8b9f34` | NEW `tests/e2e/m19-redesign-flow.spec.ts` (2 Playwright specs). Spec 1 walks wizard with country='United Arab Emirates' (auto-AED) + construction=7/operations=11/overlap=1, asserts Schedule landing tab, numbered tab row, M1.9 strip both tabs, stored snapshot has the wizard timing. Spec 2 captures Schedule + Land tab screenshots (light + dark) into `tests/screenshots/M1.9/`. Both pass locally (2 passed, 22.9s). |

**M1.9b polish series (8 commits, 2026-05-04 → 2026-05-05, all snapshot diffs bit-identical):**

| # | Commit | What changed |
|---|--------|--------------|
| 1 | `abe9917` | Module1Hierarchy gains optional `sections?: 'all' | 'structure' | 'assets'` prop. `sectionsMode === 'all'` is the legacy default (full render). 'structure' renders Master Holding + Sub-Project + Phase rows and replaces each Phase's Asset/SubUnit subtree with a slim "🧱 N assets · Edit assets in Build Program" stub. 'assets' suppresses MH + the header + the Add-Sub-Project block + first-time empty gate, leaving just the per-Asset + per-Sub-Unit cards. Slice via visibility gates rather than extraction (the component is 2,500 lines; full extraction would have doubled the diff). |
| 2-3 | `6d3b720` | Module1Timeline mounts `<Module1Hierarchy sections="structure" />` in a "🗂️ Project Structure (Master Holding · Sub-Projects · Phases)" section card below the schedule body. Module1AreaProgram mounts `<Module1Hierarchy sections="assets" />` in a "🧱 Asset & Sub-Unit Detail Editor" section card below the plots list. |
| 4 | `75908f9` | Dissolve standalone Hierarchy tab. `m1Tabs` drops to 5 entries (no 'hierarchy' key). RealEstatePlatform default `useState('hierarchy')` → `useState('timeline')`; manual `handleCreateProject` `setActiveTab('hierarchy')` → `setActiveTab('timeline')`; `{activeTab === 'hierarchy' && <Module1Hierarchy />}` render branch removed. Wizard- and manual-created projects both land on Schedule (step 1). |
| 5 | `0a71c0a` | D7 + D8 disambiguation labels + What-goes-here callouts on Schedule + Land. Schedule's "Construction / Operations / Overlap" relabelled "Project Construction / Operations / Overlap"; per-Phase overrides now live in the structure tree on the same tab. Land's "Floor Area Ratio (FAR)" → "Project FAR (whole-site ceiling)"; Roads % gets "(of total land)" suffix; Non-Enclosed % gets "(balconies / terraces)" suffix. Primary-tinted callouts at the top of Schedule + Land state canonical scope ("What goes here") + delegated scope ("Not here"). |
| 6 | `40b6912` | Extend What-goes-here callouts to Build Program + Dev Costs + Financing. Build Program h2 renamed "Area Program" → "Build Program" to match the M1.9 tab label. |
| 7 | `813f448` | NEW `scripts/verify-m19b.ts` (5-section per-phase verifier covering Hierarchy dissolution + sections prop + nested mounts + What-goes-here callouts on all 5 tabs + D7/D8 labels). 19 pass / 0 fail / 2 skip without dev server; 29 pass / 0 fail / 1 skip with dev server up. |
| 8 | `<m19b/8>` | NEW `tests/e2e/m19b-redesign-flow.spec.ts` (2 Playwright specs). Spec 1 walks wizard, asserts Schedule landing tab + 1→5 tab row (no "6. Hierarchy") + Project Structure card mount + D7 labels visible + What-goes-here callout + D8 label on Land + Build Program h2 + Asset & Sub-Unit Detail Editor mount. Spec 2 captures Schedule + Land + Build Program screenshots (light + dark) into `tests/screenshots/M1.9b/`. Both pass locally (2 passed, 28.3s). |

**Audit at M1.9b close (2026-05-04, fix 5):** all 6 Module 1 tabs share a single `useModule1Store` (direct subscription for Hierarchy + Area Program; prop-drilled setter wrappers from RealEstatePlatform for Timeline / Land & Area / Dev Costs / Financing). No tab keeps a private copy of project-level data. Cross-tab edits propagate via the store. The wizard writes a complete `HydrateSnapshot` on create, every field a tab reads is covered, with `DEFAULT_MODULE1_STATE` standing in for fields the wizard does not capture (country, landParcels, projectFAR, costs, financing, those belong to dedicated tabs).

**No new tables, no new API routes, no new packages, no schema changes.** Pure UI restructure + redesign across both phases.

---

## Recently Completed, REFM Module 1 Phase M1.8 Smart Project Wizard (2026-05-03, 8 commits)

Closes M1.8. Replaces the legacy "+ New Project" → ProjectModal flow with a guided 3-step **Smart Project Creation Wizard** that pre-creates the full project skeleton (1 SubProject + N Phases + N Plots + 1 Asset per row + 1 placeholder Sub-Unit per asset; Master Holding optional). On Create the user lands on **Area Program** (not Hierarchy) with everything wired and ready to model. Hierarchy tab gains a **top-of-tab action bar** (+ Add Phase, + Add Plot, Enable MH) and **progressive disclosure** for wizard projects (the empty MH card hides while MH disabled).

**Per-commit shape:**

| # | Commit | What changed |
|---|--------|--------------|
| 1 | `5a0af4e` | NEW `src/hubs/modeling/platforms/refm/components/modals/ProjectWizard.tsx`, scaffold + 3-step state machine. `WizardDraft` interface + `WIZARD_PROJECT_TYPES` (6 display values: Residential / Hospitality / Retail / Office / Mixed-Use / Custom) + `WIZARD_DEFAULT_ASSETS_BY_TYPE` matrix + `seedAssetsForType` + `makeWizardDefaultDraft` + `makeWizardAssetId` helpers. Step indicator + Back / Continue / Create chrome with `data-testid` hooks throughout for Playwright. FAST blue inputs via the local `inputStyle` constant pattern. Esc / backdrop click prompt dirty-confirm via `assetSignature(assets)` (joins name : type : category : allocationPct : strategy) so the random ids minted at draft creation don't trigger spurious confirms. |
| 2 | `fb8d0d3` | Step 1, Project Basics. Name (req) · Location (req) · Currency dropdown sourced from `COUNTRY_DATA` · Model Type radio · Project Start Date (default = today + 6 months) · Status select. Continue gated on name + location non-empty. |
| 3 | `7f49a6b` | Step 2, Project Structure. Master Holding toggle (default OFF) · Phases Single \| Multiple radio with conditional 2-10 phase-count input · Plots Single \| Multiple radio with conditional 2-20 plot-count input. |
| 4 | `cebcd61` | Step 3, Assets with project-type defaults. Project Type radio (6 values). `seedAssetsForType` populates default rows per matrix (Residential = 1 / Hospitality = 1 / Retail = 1 / Office = 1 / Mixed-Use = 3 / Custom = 0). Editable rows (Type typeahead from PREBUILT_ASSET_TYPES bucketed by category · Category select · Allocation % · Remove). Auto-balance button rebalances to 100 % evenly. Live total readout flips green at 100.00 %, red otherwise; Continue gated on `\|sum − 100\| < 0.01`. |
| 5 | `87e8aea` | Transactional create-project handler. NEW pure helper `lib/wizard/buildWizardSnapshot.ts` (`WizardDraft → { snapshot, assetMix, wizardType }`), mints stable ids (`subproject_1` / `phase_1..N` / `plot_1..N` / `asset_*`), seeds 1 placeholder Sub-Unit per asset (Sell / Operate → `count(1)`, Lease + Hybrid → `area(0)`), industry-typical `deductPct` / `efficiencyPct` per category (Sell 10 / 85, Operate 15 / 80, Lease 5 / 90, Hybrid 10 / 85), MH-roll-up only when toggle ON, costs intentionally `[]` (legacy default-cost seed `useEffect` stamps the 12-cost mix on first Dev Costs visit), and stamps `hierarchyDisclosure: 'progressive'`. NEW `mapWizardToProjectType()` collapses the 6 wizard display values to the 3 store ProjectType values (Residential → `'residential'`, Hospitality → `'hospitality'`, else → `'mixed-use'`). NEW `handleCreateProjectFromWizard` in `RealEstatePlatform.tsx`: hydrate store → POST `/api/refm/projects` with snapshot → activate → attach auto-save → `setActiveTab('area-program')` so the user lands on Area Program. ProjectsScreen `+ New Project` button now opens `<ProjectWizard>`; `<ProjectModal>` retained only for edit mode. |
| 6 | `5659de1` | Hierarchy tab progressive disclosure. NEW optional `hierarchyDisclosure?: 'progressive' \| 'manual'` field on `Module1Store` interface + `HydrateSnapshot` Pick + `DEFAULT_MODULE1_STATE` seed (so `Object.keys(DEFAULT_MODULE1_STATE)` = save-side `SNAPSHOT_KEYS` includes the field). `enrichWithHierarchyDefaults` pads missing values to `'manual'` so pre-M1.8 snapshots keep their show-all-layers behaviour. `Module1Hierarchy.tsx` subscribes via `useShallow`, clamps `disclosure = hierarchyDisclosure ?? 'manual'` at component top (belt-and-suspenders), and wraps the Master Holding card in `{!hideMHWhenDisabled && (...)}` where `hideMHWhenDisabled = disclosure === 'progressive' && !masterHolding.enabled`. |
| 7 | `f15a459` | Hierarchy tab top-of-tab action buttons. `Module1Hierarchy.tsx` header gets a 3-button action bar (always visible, both modes): **+ Add Phase** (inherits prior phase timing or 4 / 5 / 0 default), **+ Add Plot** (inherits seed area or 100 k sqm fallback; `window.alert` when no phases exist), **Enable Master Holding** (only visible when MH disabled, flips `masterHolding.enabled = true` via existing `updateMasterHolding` action, does NOT change `hierarchyDisclosure`). All three carry `data-testid` hooks (`hierarchy-add-phase` / `hierarchy-add-plot` / `hierarchy-enable-mh`) for Playwright. |
| 8 | `a1fab63` | Verifier `scripts/verify-m18.ts` (5 sections per the standing per-phase template, 13 pass / 0 fail / 2 skip without dev server): (1) DB roundtrip, inserts wizard-built snapshot via service role, asserts `hierarchyDisclosure='progressive'` + plots / zones / assets / subUnits round-trip, confirms `enrichWithHierarchyDefaults` pads missing `hierarchyDisclosure` to `'manual'` on pre-M1.8 payloads. (2) Route smoke (M1.6 endpoints still 401 without auth, no new routes added; skips when dev server unreachable). (3) Calc, runs all 3 snapshot diffs (legacy 17.5 KB / multiphase 23.0 KB / areaprogram 2.8 KB; M1.8 ships structural changes only, all baselines stay bit-identical). (4) State integrity, `buildWizardSnapshot` pure-helper: 6→3 project-type collapse table, Mixed-Use seed (3 assets / 3 sub-units / 1 plot / 1 phase / MH off / disclosure='progressive' + assetMix names), multi-phase + multi-plot + MH-on draft (4 phases / 5 plots / MH-roll-up wired via `subProject.masterHoldingId`), sub-unit metric per category (Sell / Operate → count, Lease → area), `seedAssetsForType` counts match brief matrix (1 / 1 / 1 / 1 / 3 / 0), hydrate cycle (load progressive then load enriched-legacy → no stale carry-over of `hierarchyDisclosure`). (5) Playwright, headless light + dark `/modeling/signin` screenshots saved to `tests/screenshots/m18/`; `/refm` redirect-to-auth gate. NEW `tests/e2e/m18-wizard.spec.ts` covers public surfaces + 3 documented `test.skip()` specs for full wizard end-to-end (default Mixed-Use create → Area Program landing, Custom type with manual asset entry + Auto-balance, Multi-phase + Multi-plot + MH-on path including Hierarchy tab Enable MH / + Add Phase reveal). Docs sweep: `CLAUDE.md` bumps Last updated to 2026-05-03 + adds verify-m18.ts to the per-phase verifier list; `CLAUDE-FEATURES.md` gets a new "REFM, Smart Project Creation Wizard (Phase M1.8, 2026-05-03)" row with full surface coverage; `CLAUDE-ROUTES.md` notes ProjectWizard.tsx + new `lib/wizard/buildWizardSnapshot.ts`. |

**Memory:** `project_m18_patterns.md` (6 locked-in patterns: additive optional snapshot fields require **all three** of type extension + DEFAULT seed + enrich pad; pure build-snapshot helpers live in `lib/wizard/` (or analogous `lib/<feature>/`); wizard dirty-confirm uses signature comparison not reference equality; wizard project-type display enum collapses to store ProjectType via a named pure mapper; hierarchy disclosure clamp pattern `disclosure = stored ?? 'manual'` at component top; verifier sections 2 + 5 skip cleanly when dev server returns non-200).

**No new tables, no new API routes**, M1.8 extends the `refm_projects.snapshot` JSONB shape additively with a single optional top-level field (`hierarchyDisclosure`). `enrichWithHierarchyDefaults` pads missing values to `'manual'` so legacy projects keep their show-all-layers behaviour.

**Verification at phase close (all green):**
- `npm run type-check`: clean
- `module1-snapshot-diff`: 17.5 KB matches baseline (untouched)
- `module1-multiphase-diff`: 23.0 KB matches baseline (untouched)
- `module1-areaprogram-diff`: 2.8 KB matches baseline (untouched)
- `npm run build`: clean
- `verify-m18.ts`: 13 pass / 0 fail / 2 skip without dev server

**Manual action remaining:** none, Migration 149 (refm_projects + refm_project_versions tables, applied during M1.6) is sufficient for M1.8's JSONB extension.

**Post-launch hotfixes (same day, 2026-05-03, eyeball + smoke tests):**

| # | Commit | Issue | What changed |
|---|--------|-------|--------------|
| Fix 1/3 | `a15fcbc` | Step 1 Status field placement (UX) | Wrapped Model Type + Status in a 2-column grid (same `1fr 1fr` pattern as Currency + Project Start Date one row above) so the entire Step 1 form fits on one screen without scrolling on standard 1920×1080 displays. No data-testid changes. |
| Fix 2/3 | `e217978` | Wizard width too narrow (UX) | `maxWidth` on `.pm-modal` container 640px → 1080px (+69%, satisfying brief's "at least 50% wider" target). Step 3's asset-row grid (Type / Subtype select / Category / Allocation% / Remove) was particularly cramped. `width: '100%'` retained for narrow-viewport graceful shrink. |
| Fix 3/3 | `5085958` | **BLOCKER**, page error after Create | Root cause: `handleCreateProjectFromWizard` was calling `attachSyncToProject(pid)` after `pclient.createProject` succeeded. `attachSyncToProject` round-trips through `loadProject` → `hydrationFromAnySnapshot`, whose `isNewV3` recogniser requires `s.version === 3`. Wizard snapshots are bare `HydrateSnapshot` (the type has no `version` discriminator and `buildWizardSnapshot` doesn't stamp one). The recogniser fell through to its "unrecognized shape" branch and returned `DEFAULT_MODULE1_STATE`. The store hydrate then silently wiped the wizard structure (3 assets / 1 plot / 3 sub-units → empty), and the wipe collided with the same render cycle that was flipping `setActiveTab('area-program')` plus the legacy default-cost seeder useEffect's setResidentialCosts/Hospitality/Retail calls, Module1AreaProgram mounted mid-update on a wiped store and Next.js's dev error overlay caught the boundary error ("This page couldn't load"). Project IS created in DB (writeActiveProjectId fires before the wipe); on reload, the same recogniser bug fires during restore → store reads DEFAULT_MODULE1_STATE → empty Hierarchy → user navigates to Dashboard. **Fix:** new `attachToProjectFromLocalSnapshot(projectId, snapshot)` helper in `module1-sync.ts` writes the active-id marker + cache + starts the auto-save subscriber WITHOUT calling `loadProject`. The store already holds the snapshot the server has, so the re-fetch was wasteful AND dangerous. `lastSavedJson` seeded so the first store event is a no-op. Legacy `handleCreateProject` left untouched, its wipe is benign because the legacy local snapshot IS already DEFAULT_MODULE1_STATE. |

Hotfix verification (all green):
- `npm run type-check`: clean
- `module1-snapshot-diff`: 17.5 KB matches baseline
- `module1-multiphase-diff`: 23.0 KB matches baseline
- `module1-areaprogram-diff`: 2.8 KB matches baseline
- `verify-m18.ts`: 13 pass / 0 fail / 2 skip

**Open questions parked for later (carried forward into future phases):**
- **Fixture-login / NextAuth cookie injection**, same blocker as M1.7. Once it lands, the 3 documented `test.skip()` specs in `tests/e2e/m18-wizard.spec.ts` flip to `test()` and exercise the full wizard interaction including the Area Program tab landing assertion + Hierarchy "Enable MH" / "+ Add Phase" reveals.
- **"Manual setup mode" wizard toggle** (skip wizard, drop into empty Hierarchy), not in M1.8 scope. The "Custom" project type at Step 3 covers most of this (empty assets, user adds manually). A full "skip wizard" path would replicate the legacy ProjectModal flow; reserved for if users actually request it.
- **Hierarchy disclosure toggle UI** ("switch this wizard project to manual mode permanently"), not exposed in M1.8. The Enable Master Holding button is the one explicit override; a full mode toggle isn't worth UI surface area until users actually ask for it.
- **M2.0/A, `hydrationFromAnySnapshot` recogniser bug, latent on every post-M1.6 createProject + saveVersion path.** The `isNewV3` check in `module1-migrate.ts` requires `s.version === 3`, but neither `buildWizardSnapshot` nor the legacy `extractHydrateSnapshot` stamps that field, every snapshot POSTed to `/api/refm/projects` and `/api/refm/projects/[id]/versions` since M1.6 is bare `HydrateSnapshot`. Today the M1.8 hotfix sidesteps this on the wizard create path by avoiding the round-trip re-hydrate, but every OTHER load path (Open Project from picker, Load Version from VersionModal, page-reload restore) still passes the saved snapshot through the recogniser and falls through to `DEFAULT_MODULE1_STATE` on a strict reading. Reason it isn't blowing up universally yet: (a) the cache fall-back wins for the user's own browser when localStorage holds a recent snapshot; (b) the user immediately edits → auto-save → wipe-then-re-save makes the empty state momentary on the user's screen; (c) most users have been editing single-phase / 3-asset projects whose wiped shape happens to be similar to defaults. Systemic fix: relax `isNewV3` to accept bare `HydrateSnapshot` (any object with `assets[] + phases[] + costs[]` arrays, even without `version: 3`). Need to add coverage for legacy v2 fall-through first to make sure the relaxation doesn't accidentally treat a legacy v2 row as v3-shaped. **Filed as M2.0/A; do this BEFORE shipping any cross-device project sync demos.**

---

## Recently Completed, REFM Module 1 Phase M1.7 Area Program (2026-05-02, 8 commits)

Closes M1.7. Adds the new "Area Program" tab between Land & Area and Dev Costs in REFM Module 1, introducing **Plot** (between Phase and Asset) and optional **Zone** (logical sub-division of Plot) entities, per-asset **Strategy** (Develop & Sell / Lease / Operate, Primary + optional Secondary with allocation %), per-asset **area cascade** overrides (MEP / Back-of-House / Other Technical %, GFA override), per-asset **Sub-Unit schedule** (Studio / 1BR / 2BR / 3BR / Hotel Key / Office / Retail) with parking-bays-per-unit override, live computed envelope panel, live cascade preview, and per-plot parking allocator readout (surface / vertical / basement bays vs. capacity, deficit warning).

**Per-commit shape:**

| # | Commit | What changed |
|---|--------|--------------|
| 1 | `fd2767e` | `module1-types.ts` + `module1-store.ts` + `module1-migrate.ts`, Plot + Zone interfaces, AssetStrategy enum, industry-typical defaults (FAR 3.0 / coverage 60% / basement eff. 95% / bay sizes 25/40/44 sqm / parking ratios), `makeDefaultPlot` factory, HydrateSnapshot extended with `plots[] / zones[]`, store CRUD with cascade-aware deletes (removePlot drops zones + clears asset.plotId/zoneId; removePhase / removeSubProject extended to cascade through plots/zones), selectors (`selectPlotsForPhase`, `selectZonesForPlot`, `selectAssetsForPlot`, `selectActivePlot`), `enrichWithHierarchyDefaults` pads missing `plots: [] / zones: []` on pre-M1.7 payloads. |
| 2 | `baa0e27` | `@core/calculations/index.ts`, 4 new pure functions: `computePlotEnvelope`, `computeAreaCascade`, `computePlotParkingCapacity`, `allocateParking` (waterfall: surface → vertical → basement). Inputs are plain scalars / objects so REFM types stay out of `@core` (one-way dep preserved). |
| 3 | `af471e7` | `module1-types.ts`, AssetClass extended with `primaryStrategy / primaryStrategyPct / secondaryStrategy / secondaryStrategyPct / mepPct / backOfHousePct / otherTechnicalPct / gfaOverrideSqm`. SubUnit extended with `parkingBaysPerUnit / gfaSharePct`. `DEFAULT_AREA_CASCADE_BY_CATEGORY` (Sell 8/3/3, Lease 12/5/4, Operate 15/12/5, Hybrid 12/8/4). Pure resolver helpers (`resolveAssetStrategy`, `resolveAssetCascadePcts`, `resolveSubUnitParkingBays`). |
| 4 | `041feaa` | New regression-guard track for M1.7 calc surface: `tests/fixtures/module1-areaprogram.json` (1 plot / 2 zones / 3 assets / 3 sub-units), `runAreaProgramPipeline` in `scripts/module1-pipeline.ts`, `scripts/module1-areaprogram-snapshot.ts` (baseline writer), `scripts/module1-areaprogram-diff.ts` (bit-identical comparison), `tests/snapshots/module1-areaprogram-baseline.json` (2.8 KB). |
| 5 | `ac2f2c5` | NEW component `Module1AreaProgram.tsx`, store-direct tab with Plot CRUD (envelope inputs + computed envelope panel + ⚠ Over-FAR badge), Zone CRUD (inline name + areaSharePct), per-asset Strategy + cascade-pct overrides + zone picker + GFA override + live cascade preview, Asset assignment picker for unbound assets in the active phase. `RealEstatePlatform.tsx` wires `{ key: 'area-program', icon: '📐', label: 'Area Program' }` between Land & Area and Dev Costs. |
| 6 | `4ea532f` | `Plot.verticalParkingFloors?` (optional, default 0). New `SubUnitTable` per asset (inline editable Type / Metric / Quantity / Parking-bays-per-unit override / live Bays Demanded / Delete; `<datalist>` of category-specific suggestions). New `ParkingSummary` per plot (Required / Surface / Vertical / Basement / Total Allocated; flips to negative-bg + ⚠ deficit badge when demand > capacity). |
| 7 | `f8b6bfd` | Installed `@playwright/test ^1.59.1` + chromium. NEW `scripts/verify-m17.ts` (5-section verifier per the standing per-phase preference). 25 pass / 0 fail / 2 skip without dev server. |
| 8 | `8659b0c` | Doc sweep: `CLAUDE-FEATURES.md` gets full Area Program row, `CLAUDE-ROUTES.md` adds Module1AreaProgram + Module1Hierarchy to module list, `CLAUDE-DB.md` notes the JSONB extension on `refm_project_versions.snapshot` (no new tables). |

Plus: `396bc1b` (working-tree cleanup, gitignored xlsx-extract artifacts, bumped reference workbooks).

**Memory:** `project_m17_patterns.md` (7 locked-in patterns: additive HydrateSnapshot extensions, `@core` stays REFM-type-free, resolver helpers, separate snapshot-diff track per surface, multi-level cascade-aware deletes, codified verifier template, store-direct tabs hold across modules).

**No new tables, no new API routes**, M1.7 extends the `refm_projects.snapshot` JSONB shape additively. `enrichWithHierarchyDefaults` pads `plots: [] / zones: []` on legacy snapshots so loads are non-breaking.

**Verification at phase close (all green):**
- `npm run type-check`: clean
- `module1-snapshot-diff`: 17.5 KB matches baseline (untouched)
- `module1-multiphase-diff`: 23.0 KB matches baseline (untouched)
- `module1-areaprogram-diff`: 2.8 KB matches baseline (NEW)
- `npm run build`: clean
- `verify-m17.ts`: 25 pass / 0 fail / 2 skip without dev server

**Manual action remaining:** none, Migration 149 (refm_projects + refm_project_versions tables, applied during M1.6) is sufficient for M1.7's JSONB extension.

---

## Recently Completed, REFM Phase 4.6-4.15 design-token retrofit (2026-04-30 continuation session, 10 retrofit commits + 1 docs commit)

Closes Phase 4. Every component under `src/hubs/modeling/platforms/refm/` is now hex / rgba / 'white' / `input-assumption`-free end-to-end (verified by repo-wide grep, 0 matches). Establishes the FAST cell pattern that supersedes the yellow `.input-assumption` class inside REFM.

| Phase | File | Hash | Status |
|-------|------|------|--------|
| **Phase 4.6** | `Module1Timeline.tsx` | `cd9740f` | Complete. 9 hex/rgba + 7 className refs. **First Module 1 tab** to adopt the FAST cell pattern that 4.7-4.9 then mirrored: `inputStyle` (blue) and `calcOutputStyle` (grey-pale + heading) constants per file. Inputs flip from yellow `.input-assumption` to `var(--color-navy-pale)` bg + `var(--color-navy)` text; the className must be removed at the call site because the global `!important` rule in `app/globals.css` would otherwise override the inline blue back to yellow. Timeline visual phase bars retoken'd via `color-mix(var(--color-primary)/--color-success, transparent)` at 75%. |
| **Phase 4.7** | `Module1Area.tsx` | `273ec50` | Complete. 8 hex/rgba + 15 className refs. Hospitality label colour (3 occurrences) migrated from off-canon `#7c3aed` (Tailwind enterprise-tier purple) to `var(--color-navy-mid)` matching the canonical hospitality mapping in `Module1Financing.tsx:122`. Area Hierarchy table column-header pastels (`#93c5fd / #c4b5fd / #fca5a5`) retoken'd to `color-mix(var(--color-on-primary-navy) 60%, var(--color-navy/--color-gold/--color-negative))`, three distinct hues kept (blue / gold / red) so the column triad stays visually scannable. Hospitality pastel moved from violet to pale-gold (no purple token in the system). Area Hierarchy module-card inline-bg overridden to `var(--color-grey-pale)` to signal the calculated-outputs panel under FAST. |
| **Phase 4.8** | `Module1Costs.tsx` | `0226e22` | Complete. 7 hex/rgba + 11 className refs. Active-pill backgrounds (5 buttons sharing the navy 8% tint) folded to `color-mix(var(--color-primary) 8%, transparent)`; dev-fee mode toggle kept the slightly stronger 10% pp differential. `STAGE_COLOR[stageNum]` / `STAGE_BG_RGBA[stageNum]` / `PHASE_COLOR` imports from `src/styles/tokens.ts` left untouched, they are the canonical JS-side stage palette per the policy comment at the top of tokens.ts. |
| **Phase 4.9** | `Module1Financing.tsx` | `7a318cd` | Complete. 40 hex/rgba/'white' literals + 6 className refs, largest single retrofit. 24× hardcoded `'white'` (debt/equity/total schedule headers + asset chip + KPI tuple) all routed through `var(--color-on-primary-navy)` (brand-locked white in both modes). Dead `var(--color-navy, #1B4F8A)` / `var(--shadow-1, ..., rgba)` / `var(--color-row-alt, #F9FAFB)` defensive fallbacks stripped, tokens are always defined globally so the `, #literal` halves were unreachable. Subtle `rgba(0,0,0,0.01)` alt-row tint kept at 1% intent via `color-mix(var(--color-heading) 1%, transparent)` rather than flattening to `var(--color-row-alt)` (which would be ~5× stronger). Gold-tint card (rates callout) folded to `color-mix(var(--color-gold)/--color-gold-dark, transparent)`. |
| **Phase 4.10** | `PlanBadge.tsx` | `2e486c1` | Complete. 3 hex sites + alpha-derivation pattern. Plan tier base colour map relocated through `src/styles/tokens.ts` PLAN_COLOR canonical: `'#2563EB'` (Tailwind blue-600) → `'var(--color-navy)'` (matches `PLAN_COLOR.professional.color === COLOR.navy`); `'#7C3AED'` → `TOKEN_PLAN_COLOR.enterprise.color` (intentional off-canon purple per tokens.ts comment, no purple CSS var by design); fallback aligned. The `${color}1A` / `${color}40` 8-digit-hex alpha pattern (only viable when `${color}` is a literal hex) rewritten to `color-mix(in srgb, ${color} 10%/25%, transparent)` so it works with CSS-var values. Visual delta: PRO badge text shifts from blue-600 to brand navy; ENTERPRISE unchanged. |
| **Phase 4.11** | `modals/ProjectModal.tsx` | `f0535b8` | Complete. 3 rgba sites + 1 'white'. On-navy header chrome (subtitle + close button) routed through `color-mix(var(--color-on-primary-navy), transparent)`; info-tip card border `rgba(30,58,138,0.12)` → `color-mix(var(--color-primary) 12%, transparent)`. |
| **Phase 4.12** | `modals/VersionModal.tsx` | `e16d333` | Complete. 6 hex/rgba + 1 'white'. Same on-navy header chrome as 4.11. Save-version success-card border `'#BBF7D0'` (Tailwind green-200) → `var(--color-green)` matching the `.alert-success` border in app/globals.css. Active-version row + LOADED pill folded through `color-mix(var(--color-success), transparent)`; LOADED text colour normalised to `var(--color-success)` (same value via :root alias as Phase 4.2 / 4.7). |
| **Phase 4.13** | `modals/RbacModal.tsx` | `71f72ce` | Complete. 2 hex/rgba sites, both on the SELECTED pill that floats on the dark `.rbac-role-card` surface. Tailwind blue triad (`rgba(59,130,246,0.2)` / `#93c5fd` / `rgba(59,130,246,0.3)`) collapsed to brand navy + the same `color-mix(var(--color-on-primary-navy) 60%, var(--color-navy))` pale-navy pattern Phase 4.7 used for the Area hierarchy residential `<th>`. |
| **Phase 4.14** | `modals/ExportModal.tsx` | `97d6de7` | Complete. 19 hex/rgba sites + 5 'white'/'#fff' + a 3-key plan tier colour map driving 4 separate alpha-suffix derivations, the largest single retrofit (the modal had its own self-contained Tailwind-gray palette: gray-200 / 400 / 500 / 700 / 900 plus Tailwind blue-600). Plan-tier colour map relocated through tokens.ts (free → `var(--color-grey-mid)`, professional → `var(--color-navy)`, enterprise → `TOKEN_PLAN_COLOR.enterprise.color`). All gray-N hexes folded onto canonical FMP tokens (`var(--color-heading)` / `var(--color-meta)` / `var(--color-muted)` / `var(--color-border)` / `var(--color-surface)`). Plan-pill bg/border alpha derivations rewritten via `color-mix` so they work with the new CSS-var inputs. **Behaviour delta**: in REFM dark mode the modal now picks up the dark workspace palette (grey-pale → `#1F2A3A`, surface → `#1A222F`); previously a bright white slab on the dark workspace. |
| **Phase 4.15** | `RealEstatePlatform.tsx` | `48e5f3d` | Complete. 6 hex/rgba sites in two JSX overlay blocks (Module 8 'Upgrade to edit financials' lock overlay + the upgrade-prompt modal backdrop). **Critical**: the dark-mode plumbing block at lines 295-330 (`darkMode` useState + `body.dataset.refmTheme` useEffect + `toggleDarkMode` callback) is byte-identical post-retrofit, verified, so the workspace toggle continues to flip themes and persist to `localStorage['refmDarkMode']`. **Behaviour delta**: Module 8 lock overlay's frosted-white slab `rgba(255,255,255,0.85)` swapped to `color-mix(var(--color-surface) 85%, transparent)`, so it now frosts the dark workspace surface in dark mode rather than imposing a bright white slab. |

**Net total**: 10 retrofit commits + 1 docs/settings compaction commit (`71e4822`).

**Packages installed this session: none.**

**Schema changes this session: none.**

**New API routes this session: none.**

**New non-route files this session: none.** All 10 retrofit commits are pure edits to existing files.

**Modified files (REFM only):**
- `src/hubs/modeling/platforms/refm/components/modules/Module1Timeline.tsx`, Phase 4.6 (FAST cell pattern established)
- `src/hubs/modeling/platforms/refm/components/modules/Module1Area.tsx`, Phase 4.7
- `src/hubs/modeling/platforms/refm/components/modules/Module1Costs.tsx`, Phase 4.8
- `src/hubs/modeling/platforms/refm/components/modules/Module1Financing.tsx`, Phase 4.9
- `src/hubs/modeling/platforms/refm/components/PlanBadge.tsx`, Phase 4.10
- `src/hubs/modeling/platforms/refm/components/modals/ProjectModal.tsx`, Phase 4.11
- `src/hubs/modeling/platforms/refm/components/modals/VersionModal.tsx`, Phase 4.12
- `src/hubs/modeling/platforms/refm/components/modals/RbacModal.tsx`, Phase 4.13
- `src/hubs/modeling/platforms/refm/components/modals/ExportModal.tsx`, Phase 4.14
- `src/hubs/modeling/platforms/refm/components/RealEstatePlatform.tsx`, Phase 4.15 (orchestrator, dark-mode plumbing untouched)

**Verification per phase (all green)**: Module 1 regression-guard snapshot (`npx tsx scripts/module1-snapshot-diff.ts`) stayed at 17.5 KB baseline (exit 0) every step; `npm run type-check` clean every step; `npm run build` compiled successfully every step.

**Manual action required**: eyeball verification in BOTH light + dark modes for each phase per the per-commit `⚠️` notes, the visual deltas are documented in each commit body. Specifically for Phase 4.15: open the REFM workspace, toggle dark mode on/off via the topbar ☀️/🌙 control, and reload to confirm the theme persists across hard reload and that the body[data-refm-theme] attribute is removed when leaving the workspace (no leakage into admin / training surfaces). Module 8 lock overlay frosting now follows `var(--color-surface)`, so it'll be a dark frosted slab in dark mode (intended visual delta from prior bright-white slab).

### Phase 4.6-4.15 Follow-Ups

| Item | Notes |
|------|-------|
| **Eyeball verification across all 10 retrofits** | Owed before any further visual work. Each commit body lists the specific elements to inspect. The colour-mix derivations are mathematically equivalent to the prior alpha values (or +/- 1pp for rounding), so visual deltas should be subtle except where explicitly documented (Phase 4.10 PRO badge blue→navy, Phase 4.7 hospitality purple→navy-mid + Area pastel violet→gold, Phase 4.14 ExportModal in dark mode, Phase 4.15 Module 8 lock-overlay frosting). |
| **REFM Module 2-11 retrofits** | Out of scope for Phase 4 (those modules are not yet built, see Module Roadmap). When they ship, they should be authored with the FAST pattern from day one (`inputStyle`/`calcOutputStyle` constants, no `.input-assumption` className) so we don't re-accumulate inline literals. |

---

## Recently Completed, Modeling Hub foundation rebuild + REFM dark mode + Phase 4.2-4.5 retrofits + project edit + Module Roadmap consolidation (2026-04-30 session, 11 commits)

| Phase | Status |
|-------|--------|
| **Phase 4 cookie-scope rollback (Option A)** | Complete (commit `93ab0af`, combined revert). Reverted the prior Phase 4 commits that had introduced a NextAuth cookie-scope regression. Verified functional match to baseline `bcea1a7`, snapshot diff exit 0, type-check + build clean, then pushed. |
| **Foundation rebuild, canonical landing on app.* subdomain** | Complete (commit `005e7ce`). `app/portal/page.tsx` collapsed to a 5-line `redirect('${APP_URL}/modeling/dashboard')`. `/portal` removed from `MAIN_PATHS` in `next.config.ts`. `src/middleware.ts` swapped its non-admin `/admin/*` rejection redirect from `/portal` to `/`. `src/shared/email/templates/accountConfirmation.ts` re-targeted both `${APP_URL}/portal` references to `${APP_URL}/modeling/dashboard`. `app/modeling/dashboard/page.tsx` repurposed from a 3-card grid to the canonical sidebar layout: server-fetches CMS keys `logo_url` + `logo_height_px` + `header_height_px` (defaults 36 / 64, match main-site `NavbarServer`); renders topbar at `minHeight: headerHeight` and sidebar at `top: headerHeight, height: calc(100vh - ${headerHeight}px)`. Hub-level dark mode toggle via `localStorage['modelingDarkMode']` (default → `prefers-color-scheme`), `data-theme` attribute does NOT leak into `/admin` or `/training`. **Cookie-scope bug deliberately out-of-scope**, NextAuth config NOT modified per session constraint. |
| **REFM workspace dark mode** | Complete (commit `b4691b7`). ☀️/🌙 toggle in Topbar between ⚙️ Settings and ← Hub. Own `localStorage['refmDarkMode']` key (separate from `modelingDarkMode`); default → `prefers-color-scheme`. Theme scoped via `body[data-refm-theme="dark"] .app-shell` so it never bleeds into admin or training. New design token `--color-on-primary-navy: #FFFFFF` added to `app/globals.css` (NOT overridden in dark scope) because `--color-grey-white` is overridden to `#1A222F` in dark and would have flipped white-on-navy chrome to invisible. Dark mode override block declares overrides for bg, surface, grey-white, grey-pale, border, border-light, muted, meta, body, grey-dark, heading, row-alt, row-hover, input-bg, warning-bg, warning-text, navy-light, navy-pale, shadow-1/2/hover. |
| **Phase 4.2, OverviewScreen.tsx token retrofit + project edit + defensive empty state** | Complete (commit `afd0e4d`). 4 hardcoded literals replaced (Total GFA accent + active-version border/bg + LOADED pill) routed through design tokens + `color-mix()`. Pencil ✏️ button next to project name h1 gated on `can('canEditProject')`. Replaced silent `if (!proj) return null` with an actionable empty card so a stale `activeProjectId` no longer renders a blank Overview. TypeScript narrowing fix: `if (!proj || !activeProjectId)` to satisfy `onLoadVersion(activeProjectId, vid)` typing. |
| **Project name editing wired** | Complete (commit `cfca60a`). ProjectModal already supported edit mode but `onConfirm` was hardcoded. New `handleEditProject(name, location)` callback in `RealEstatePlatform.tsx` mutates active project, syncs state, persists to localStorage `refm_v2`, fires toast. New `handleEditProjectClick(pid?)` opens modal in edit mode. Two UI entry points: Overview header pencil + ProjectsScreen row pencil. Defensive hydration: `loadFromStorage()` drops stale `activeProjectId` if it doesn't resolve to a real project (covers cross-tab delete). |
| **Phase 4.3, ProjectsScreen.tsx token retrofit + edit button** | Complete (commits `6ae4344` + `a75708f`). STATUS_COLORS map + ACTIVE pill, 5 rgba literals + 1 hex (`#92400e` → `var(--color-gold-dark)`) routed through `color-mix()`. Normalized `var(--color-green-dark)` → `var(--color-success)`. Per-row pencil ✏️ Edit button between Open and Delete (gated on `can('canEditProject')`, stops propagation). Two separate commits per session protocol, Task 1 (edit button) committed first, then Task 2 (token retrofit) committed second. |
| **Module Roadmap consolidation (Sidebar + Dashboard drift fix)** | Complete (commits `dba0952` + `e20f436`). Sidebar listed all 11 modules but Dashboard Module Roadmap only showed 1-6 (two parallel hardcoded lists). Both surfaces now consume `MODULES` from new file `src/hubs/modeling/platforms/refm/lib/modules-config.ts` (single source of truth: 11 entries, `ModuleStatus = 'done' \| 'soon' \| 'pro' \| 'enterprise'`, `ModulePlan = 'free' \| 'professional' \| 'enterprise'`). `shortLabel` for narrow sidebar rail, `longLabel` for wide dashboard rows. Dashboard introduces `STATUS_BADGE` map (4 variants routed through design tokens + `color-mix()`). |
| **Phase 4.4, Sidebar.tsx token retrofit** | Complete (commit `9a0fe71`). 2 inline rgba literals replaced with `color-mix(in srgb, var(--color-on-primary-navy) X%, transparent)`. All visual states verified to render correctly in light + dark via the new `--color-on-primary-navy` token. |
| **Phase 4.5, Topbar.tsx token retrofit** | Complete (commit `11e098b`). 12 hardcoded literals replaced. Imports `DEFAULT_BRANDING` from `@/src/core/branding` so OfficeColorPicker fallbacks stay as actual hex strings (the picker requires `hexToRgb`-able input, CSS vars wouldn't work), keeps source file free of inline hex while preserving picker compatibility. `← Portal` (with `/portal` href) replaced with `← Hub` linking to `/modeling/dashboard`. Sign Out button border alpha via `color-mix`. |

**Net total**: 11 commits across the foundation rebuild + dark mode + Phase 4.2-4.5 retrofit + project edit + Module Roadmap consolidation.

**Packages installed this session: none.**

**Schema changes this session: none.**

**New API routes this session: none.**

**New non-route files this session:**
- `src/hubs/modeling/platforms/refm/lib/modules-config.ts`, single source of truth for all 11 REFM modules, consumed by Sidebar.tsx + Dashboard.tsx.

**Modified files (top-level):**
- `app/portal/page.tsx`, full rewrite as 5-line server redirect
- `app/modeling/dashboard/page.tsx`, full rewrite as canonical sidebar layout (server-fetch CMS header keys + dark mode + topbar + sidebar)
- `next.config.ts`, `/portal` removed from `MAIN_PATHS`
- `src/middleware.ts`, non-admin `/admin/*` redirect from `/portal` to `/`
- `src/shared/email/templates/accountConfirmation.ts`, both `${APP_URL}/portal` → `${APP_URL}/modeling/dashboard`
- `app/settings/page.tsx`, duplicate `← Portal` link removed; "redirected to the portal" → "redirected to the home page"
- `app/globals.css`, new `--color-on-primary-navy: #FFFFFF` token + REFM dark mode override block (`body[data-refm-theme="dark"]` + `body[data-refm-theme="dark"] .app-shell`)
- `src/hubs/modeling/platforms/refm/components/Topbar.tsx`, Phase 4.5 retrofit + ☀️/🌙 toggle + ← Hub link
- `src/hubs/modeling/platforms/refm/components/RealEstatePlatform.tsx`, REFM dark mode state + handleEditProject callbacks + defensive hydration cleanup + sidebarModules derived from MODULES
- `src/hubs/modeling/platforms/refm/components/OverviewScreen.tsx`, Phase 4.2 retrofit + edit pencil + actionable empty state
- `src/hubs/modeling/platforms/refm/components/ProjectsScreen.tsx`, Phase 4.3 retrofit + per-row edit pencil
- `src/hubs/modeling/platforms/refm/components/Sidebar.tsx`, Phase 4.4 retrofit
- `src/hubs/modeling/platforms/refm/components/Dashboard.tsx`, Module Roadmap consolidation (consumes MODULES from modules-config)

**Manual action required**: none. All changes are code-only. Module 1 regression-guard snapshot stays at 17.5 KB baseline (exit 0 each step).

### Foundation Rebuild Follow-Ups

| Item | Notes |
|------|-------|
| **NextAuth cookie scope (deferred known issue)** | Phase 4 had attempted to introduce a Domain-attribute cookie scope so the modeling hub could survive cross-subdomain navigation, and that change broke admin auth in subtle ways (cookie now visible to all `*.financialmodelerpro.com` hosts but rejected by NextAuth's CSRF token comparison). The Path 2 foundation rebuild eliminated the cross-subdomain assumption, Modeling Hub is end-to-end on `app.*` so the default exact-host cookie scope works. NextAuth config is intentionally unchanged in this session. **If a future session needs to introduce a Domain attribute** (e.g. for SSO between admin/main + app.*), revisit Phase 4's commits as the starting point and wire the CSRF + session token cookies together so they share a domain-scope policy; do NOT cherry-pick just the cookie config. |
| **Verify dark mode doesn't leak into admin / training** | Both REFM (`body[data-refm-theme="dark"] .app-shell`) and Modeling Hub layout (`data-theme` on root container of `/modeling/dashboard` only) use scoped selectors. Verified manually during the session. Re-test if any new admin or training surface starts mounting the modeling hub layout or REFM components. |
| **OfficeColorPicker hex requirement** | Topbar.tsx imports `DEFAULT_BRANDING` for picker fallbacks because the picker uses `hexToRgb()` internally and rejects non-hex strings (including CSS var references). Document this as a known constraint if more pickers are added. Future enhancement: extend OfficeColorPicker to resolve CSS vars at the boundary so callers can pass tokens. |

---

## Recently Completed, Watch Tracking Rebuild (2026-04-28 session, commits `c9a20e4` → `670fb51`, migrations 146 + 147)

| Phase | Status |
|-------|--------|
| **Phase 2, Persist watch intervals across sessions (smoking-gun fix)** | Complete (commit `c9a20e4`, mig 146). Adds `watch_intervals JSONB` to `certification_watch_history` and `session_watch_history`. Pre-146 the tracker only persisted scalar `watch_seconds`; on a return visit `max(baseline, sumNew + open)` froze multi-session viewers at the largest single contiguous run forever (Fakhri stuck at 47% on 3SFM_S2 despite watching to completion). Now the tracker hydrates from JSONB on mount and POSTs a snapshot of merged intervals every progress tick; server unions with existing JSONB and re-derives `watch_seconds = sumIntervals(merged)` with a wall-clock rate limit on the new portion. Five tracker fixes: onPlay close-first, cross-session interval union, BUFFERING soft-pause handler, useRef re-seed without remount, force-flag on close events so the final partial interval lands in the DB. |
| **Phase 3, Manual override path** | Complete (commit `13cb260`, mig 147). New columns `completed_via TEXT NULL` (`'threshold'` / `'manual'` / `'admin_override'`) and `video_load_at TIMESTAMPTZ NULL` (server-stamped on first POST per row, anchors the elapsed-time check). UI: CourseTopBar gains a checkbox-gated "I confirm I have watched this video" + Mark Complete button when watch% is in the [50, threshold) band. Server enforces `pct >= 50` AND `wall-clock elapsed >= total_seconds * 0.8` before honouring; 403 with diagnostic info bounces tampered submits. |
| **Phase 4, Visibility (student progress bar + admin force-unlock)** | Complete (commit `e2dd9a4`). `WatchProgressBar` re-enabled with color-coded fill (red/amber/green) + dashed threshold marker + bypass-aware copy (was a no-op return null pre-Phase 4 because the pre-146 tracker had race conditions that made the displayed % unreliable). New admin endpoint `POST /api/admin/sessions/[tabKey]/force-complete-for-student` (admin-gated, prefix routing, audit_log entry, +50 points on live-session rows). Admin students panel gains a Watch Progress table with per-row Force Unlock buttons. Idempotent. |
| **Phase 5, Surgical recovery for 4 stuck students** | Complete (commit `670fb51`). `scripts/phase5_recovery.ts` mirrors the endpoint logic via service role (HTTP endpoint requires NextAuth admin cookies which are awkward to thread from a CLI; same precedent as migration 140 / 141 service-role scripts). All 4 unblocked, all 4 audit entries confirmed by `scripts/phase5_verify.ts`. Targets: `muhammadtayyabmadni07@gmail.com` (3SFM_S1, 100%), `yusra.tufail@yahoo.com` (3SFM_S1, 93%), `daniyal1012@yahoo.com` (3SFM_S1, 76%), `fakhrizanul@gmail.com` (Fakhri, 3SFM_S2, 47%). Pre-fix snapshot at `supabase/backups/stuck_watch_2026-04-28.json`; post-fix audit at `supabase/backups/phase5_recovery_2026-04-28.json`. Notable: 3 of 4 were stuck on 3SFM_S1 specifically. |

**Net total**: +2,766 / -222 lines across 5 commits + 2 SQL migrations. **Schema changes**: migrations 146 + 147 (both manual Supabase apply, idempotent). **New API routes**: `POST /api/admin/sessions/[tabKey]/force-complete-for-student`. **Updated routes**: `/api/training/certification-watch` + `/api/training/live-sessions/[id]/watched` accept `manual_override` + `watch_intervals`. **New scripts (one-shot maintenance)**: `scripts/diagnose_stuck_watch.ts`, `scripts/phase5_recovery.ts`, `scripts/phase5_verify.ts`.

**Three unlock paths going forward**: `threshold` (auto at >=70%), `manual` (student override at >=50% + elapsed-time check), `admin_override` (admin force-unlock). The 70% threshold itself is unchanged.

### Watch Tracking Follow-Ups

| Item | Notes |
|------|-------|
| **Investigate 3SFM_S1 specifically** | 3 of 4 Phase 5 stuck students were on `3SFM_S1`. Could be coincidence (S1 is the highest-traffic session) or a session-specific edge case (e.g. video duration that triggers a particular tracker race). Worth a quick look if more students surface stuck on the same session post-fix. Cross-reference: video duration, `total_seconds` distribution across stuck rows, intervals data once more rows populate post-146. |
| **Monitor for new stuck students** | Re-run `scripts/diagnose_stuck_watch.ts` periodically (every 1-2 weeks) for the first month post-fix. Bucket counts should trend toward zero AUTO_UNBLOCK / ADMIN_REVIEW. RECENTLY_ACTIVE under threshold is normal (mid-course students). If new stuck students appear despite migrations 146+147 being applied, examine their `watch_intervals` JSONB to see what the tracker captured. |
| **Watch intervals analytics (future enhancement)** | The JSONB `watch_intervals` column carries a precise minute-by-minute coverage map per student per session. Could power: heat maps showing which video segments students rewatch, drop-off detection ("60% of students stop at 18:00 mark in S5"), session-quality scoring. Not in scope for the rebuild but worth noting for a future pass. |

---

## Recently Completed, Branding merge + Pricing simplification (2026-04-28 session, commits `ab5db30` → `777e1bf`)

| Feature | Status |
|---------|--------|
| **Part A, Branding merged into Header Settings** | Complete (commit `ab5db30`). After 2026-04-27 Phase 4 had reduced `/admin/branding` to two color fields, the dedicated page was a thin wrapper. Brand Colors section now lives at the top of `/admin/header-settings`, wired to the same `/api/branding` GET + PATCH endpoints. `saveAll()` fires the cms_content writes plus `/api/branding` PATCH in parallel. `/admin/branding/page.tsx` reduced to a 5-line server `redirect('/admin/header-settings')` so existing bookmarks keep working. Sidebar Branding entry removed; Header Settings gains `matchPaths: ['/admin/branding']`. `branding_config` table + `BrandingThemeApplier` + `--color-primary` / `--color-secondary` injection all unchanged. Net -349 / +102. |
| **Part B-2, Pricing Page Content tab removed** | Complete (commit `50e22fa`). Diagnosis surfaced a real bug: the tab wrote to `cms_content` (section='pricing_page') but Page Builder writes to `page_sections` (slug='pricing'); the public `/pricing` page only read from `cms_content`, so Page Builder edits for the pricing slug were dead writes. Migration 046 had already seeded `page_sections` with the right shape. Fix: `/pricing` repointed to `getAllPageSections('pricing')`, hero badge / title / subtitle resolve from `pricing.hero` section, FAQ items resolve from `pricing.faq` section's `items[]` (with per-item `visible !== false` filter). Page Content tab UI deleted; Tab type narrowed to `'plans' \| 'platform'`. |
| **Part B-1, Pricing Plans tab removed + migration 145** | Complete (commit `777e1bf`). The generic Free/Starter/Professional/Enterprise plan catalog (`pricing_plans`, migs 014/018) was the original pricing model but never wired into payment or feature gating, `platform_pricing` + `platform_features` + `plan_feature_access` (migs 076/077) is the canonical per-platform model that actually drives the public pricing page. The home-page pricing-teaser plan-name pill row in `app/(portal)/page.tsx` was the only public consumer; replaced with a clean "View Full Pricing →" CTA-only block. With Plans gone + Page Content gone, only Platform Pricing remained, so `/admin/pricing/page.tsx` was rewritten with no tab bar at all (single-purpose surface). Net -598 / +156. |

**Net total**: -1031 lines net across 3 commits (Part A: -247 net; Part B-2: -49 net; Part B-1: -442 net).

**Packages installed this session: none.** All changes were deletions or call-site refactors.

**Schema changes this session:**
- Migration 145 (`145_drop_pricing_plans.sql`): `DROP TABLE IF EXISTS pricing_plans CASCADE`. Idempotent; re-run is no-op. **Manual Supabase apply required** (run before next deploy that depends on the dropped table).

**New API routes this session: none.** All changes were deletions:
- `DELETE app/api/admin/pricing/plans/route.ts` (full route directory removed)

**New non-route files this session:**
- `supabase/migrations/145_drop_pricing_plans.sql`

**Modified files (top-level):**
- `app/admin/branding/page.tsx`, full rewrite as 5-line server redirect (332 lines → 5 lines)
- `app/admin/header-settings/page.tsx`, Brand Colors section added at top; dual-write to `/api/branding` in `saveAll()`
- `app/admin/pricing/page.tsx`, full rewrite as Platform Pricing only (620 lines → 252 lines); no tab bar, no Plans, no Page Content
- `app/pricing/page.tsx`, repointed to `getAllPageSections('pricing')`; hero + FAQ now from `page_sections`
- `app/(portal)/page.tsx`, removed local `getPublicPlanNames()` helper + planNames pill row + unused `getServerClient` import
- `src/lib/shared/cms.ts`, removed orphan `getPublicPlanNames()` export (no remaining importers)
- `src/components/admin/CmsAdminNav.tsx`, removed Branding nav entry; Header Settings gains `matchPaths: ['/admin/branding']`

**Manual action required**:
- **Apply migration 145 via Supabase dashboard SQL editor before next deploy.** The DROP is safe to run today, the code that referenced `pricing_plans` is already gone in production after the push.

---

## Recently Completed, Multi-Phase Admin Cleanup (2026-04-27 session, commits `fd0aabf` → `73e3e89`)

| Feature | Status |
|---------|--------|
| **Phase 1, Dead Announcements stub removed** | Complete (commit `fd0aabf`). `/admin/announcements` page + `AnnouncementsManager.tsx` (212-line CRUD UI) + `/api/admin/announcements` route all queried a non-existent `announcements` table, abandoned sitewide-banners stub. Sidebar entry removed. -325 lines. |
| **Phase 2, Pricing Features + Module Access tabs removed** | Complete (commit `4a5abe3`). The two dead tabs at `/admin/pricing` wrote to `pricing_features` and `pricing_modules`, neither the public pricing page nor the Modeling Hub Modules admin (separate `modeling_modules` table) ever read them. Tab UI deleted from `app/admin/pricing/page.tsx`, `/api/admin/pricing/modules/` route deleted. Plans + Page Content + Platform Pricing tabs preserved. -316 lines. |
| **Phase 3, White-Label feature removed** | Complete (commit `a000fbd`). `/admin/whitelabel` page + `useWhiteLabel` hook + `BrandingConfig.whiteLabel` field were admin-write-only with REFM Topbar as the lone consumer (per-client name/logo override). Topbar now reads platform name + logo directly from the branding store via `getPlatformLogo()`. The `pdf_whitelabel` REFM export tier is preserved (label only, gating stubs to `false`). Sidebar entry removed. -390 lines. |
| **Phase 4, Branding slimmed to colors-only** | Complete (commit `ee959ad`). Portal Identity (5 fields) + Logos (6 fields) sections were admin-write-only with no live consumers (besides the orphan `BrandingSettingsPanel.tsx`, never imported). `BrandingThemeApplier` reads `branding.primaryColor` directly. `getPortalLogo()` deleted; `getPlatformLogo()` retained for REFM Topbar. -1054 lines. |
| **Phase 5, Permissions / User Overrides / Plans system removed** | Complete (commit `d8405e5`). The migration 006 trio (`features_registry`, `plan_permissions`, `user_permissions`) backed three sibling admin pages all wrapping the same 486-line `PermissionsManager` component. Read by REFM via `useSubscription()` client cache, but no server-side enforcement existed, gating was advisory. **Path A (aggressive)**: ripped out the entire stack. REFM premium features now stub `canAccess()` → `false` (existing `<UpgradePrompt>` overlays + lock indicators continue to render). Files deleted: 3 admin pages, 2 API routes, `src/lib/shared/permissions.ts`, `src/hooks/useSubscription.ts`, `src/components/admin/PermissionsManager.tsx`, `src/types/subscription.types.ts`. Inline-replaced: ExportModal / UpgradePrompt / PlanBadge keep `'free' \| 'professional' \| 'enterprise'` union locally. `core/branding.ts` lost the unused `USER_SUBSCRIPTION` stub + `hasAccess()`. SystemHealth lost its `/api/permissions` probe. -1169 lines, 2 sidebar entries removed. |
| **Phase 6, Migration 144** | Complete (commit `b8b6df9`). `DROP TABLE IF EXISTS … CASCADE` on the 5 dead tables: `user_permissions`, `plan_permissions`, `features_registry`, `pricing_features`, `pricing_modules`. **Apply manually via Supabase dashboard before deploy.** |
| **Phase 7, CLAUDE.md / DB / FEATURES / ROUTES docs** | Complete (commit `73e3e89`). All four primary docs reflect the cleanup. |

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
| **Live session announcement reliability (migration 138)** | Complete (commit `28d5887`; subsequently migrated to Brevo on 2026-05-11 commit `166a8ec` — `sendEmailBatch` is now a Brevo `Promise.allSettled` loop, binary ok/fail semantics preserved). Rebuilt after a 4-of-9 partial failure pattern during testing. `sendEmailBatch()` in `src/shared/email/sendEmail.ts` (originally `src/lib/email/`; moved during Phase 2.2 restructure) wrapped Resend's `batch.send([...])` at the time of this commit: one HTTP request per 100 recipients, one rate-limit slot instead of 10 parallel bursts. New child table `announcement_recipient_log` (migration 138) with per-recipient `status` (pending/sent/failed/bounced/complained), `resend_message_id`, per-row `error_message`, `UNIQUE(send_log_id, email)`, partial index on failed rows for the retry hot path. Notify route seeds recipients as `pending` before the batch fires, UPDATEs each to `sent`/`failed` from the response, recomputes aggregate counts on `announcement_send_log` so retries reflect reality. Two new POST modes: `recipientEmails: string[]` (picker allowlist / test-send), `retrySendLogId: string` (re-attempt only the failed/bounced rows of a prior dispatch in place). Course filter `target: '3sfm'\|'bvm'\|'all'` now actually filters via `training_enrollments` JOIN. Admin modal rebuilt: search + course pills + per-row checkboxes + "Send to myself only" + "Select all (filtered)" + "Clear selection" + "Preview to my inbox"; after send switches to per-recipient status table with pills + CSV export + "Retry N Failed" button. |
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
- `src/lib/email/sendEmail.ts` (now `src/shared/email/sendEmail.ts` after Phase 2.2 restructure; rewritten for Brevo on 2026-05-11) - new `sendEmailBatch` helper
- `src/lib/email/templates/liveSessionNotification.ts` (now `src/shared/email/templates/liveSessionNotification.ts`) - removed direct-join-URL footnote
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
| **WhatsApp Group Link** | Complete (migration 123), `training_settings.whatsapp_group_url` seeded `''`. Admin UI at `/admin/training-settings` validates `https://chat.whatsapp.com/…` before save. Green sidebar CTA on Training Hub dashboard (expanded + collapsed variants). Empty value hides the button. Public read: `GET /api/training/community-links` re-validates server-side. New files: `app/api/training/community-links/route.ts`, `supabase/migrations/123_whatsapp_group_url.sql`. Commit `c37dde9`. |
| **Context-aware live-session achievement card** | Complete, `/api/training/achievement-image` accepts `has_assessment` + `duration` params. With assessment = green score circle + PASSED pill (legacy render). Without assessment = teal duration circle + ATTENDED pill. Duration chip on both variants. `LiveSessionCardLarge.tsx` `achievementCardUrl()` helper threads params from `session.has_assessment` + `session.duration_minutes`. 3SFM/BVM cards unchanged because legacy callers omit the new params. Commit `c37dde9`. |
| **Recorded live-session achievement card fix** | Complete, first pass missed `SessionCard.tsx` which is the actual component rendering recorded live sessions via the `RecordedLiveSessionRow` adapter (not `LiveSessionCardLarge` as originally assumed). `SessionCard` now accepts optional `hasAssessment` (default true for 3SFM/BVM backward compat) + `durationMinutes`. Shared `buildAchievementCardUrl()` helper drops the score param when `hasAssessment === false`, sets `has_assessment=false`, and always appends duration when provided. `RecordedLiveSessionRow` threads both props through. Commit `2f2f81d`. |
| **Inline certificate issuance + daily cron retired** | Complete (migration 124), certificates issue the moment a student passes their final exam via fire-and-forget `issueCertificateForStudent(email, courseCode)` from `/api/training/submit-assessment`. Old `/api/cron/certificates` route deleted; `vercel.json` cron entry removed. Engine helper does a cheap skip-if-already-issued pre-check, runs `checkEligibility`, and hands off to `issueCertificateForPending`. Idempotent via unique index on `(LOWER(email), course_code)` from migration 111. Migration 124 adds `student_certificates.email_sent_at TIMESTAMPTZ NULL` + partial index `idx_student_certificates_email_unsent` for constant-time resend lookups. `issueCertificateForPending` stamps the column after `sendEmail` resolves. Note: task spec requested migration 123 but 123 was already taken by the WhatsApp migration earlier in the session, so email_sent_at landed as 124. Commit `6ae892a`. |
| **Admin certificates safety-net panel** | Complete, `/admin/training-hub/certificates` gained a top "🛟 Eligible but not issued" panel with per-row `⚡ Issue Now` + bulk `Issue All Pending (N)`. The main cert table gained an `Email` column (Sent / Unsent pill) with a `✉ Resend` button on unsent rows. Three new admin routes: `GET /api/admin/certificates/pending` (eligibility view minus Issued rows), `POST /api/admin/certificates/issue-pending` (`{ email, courseCode }` or `{ all: true }`), `POST /api/admin/certificates/resend-email` (`{ certificateId }`). New files: `app/api/admin/certificates/pending/route.ts`, `app/api/admin/certificates/issue-pending/route.ts`, `app/api/admin/certificates/resend-email/route.ts`. Commit `6ae892a`. |
| **Legacy Certificate Generation tile removed** | Complete, the `/admin/certificates` "⚙️ Certificate Generation" card with its `Automatic Generation` toggle + `⚡ Generate Now` button was diagnosed fully obsolete (zero live consumers after the cron was deleted in `6ae892a`; replaced by the safety-net panel). Deleted: `/api/admin/certificates/settings`, `/api/admin/certificates/generate`, `processPendingCertificates()` in `certificateEngine.ts`, orphan `getPendingCertificates` import, orphan `@keyframes spin` style, stale "cron every 15 minutes" tip copy. Two orphan data rows left in place (no schema change without approval): `cms_content.certificate_settings.auto_generation_enabled`, `training_settings.cert_last_generated`. Commit `8fb0a77`. |

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

## Recently Completed, Pre-Launch Polish (2026-04-21 session)

| Feature | Status |
|---------|--------|
| **Watch Resume / Continue** | Complete, `YouTubePlayer.startSeconds` prop threaded via `CoursePlayerLayout.resumePositionSeconds`; both watch pages capture `last_position` from the GET response and pass it through. Clamps: completed → 0, `<10s` → skip, `≥ total−30` → skip, null → 0. Tracker floor preserves threshold credit across reloads so the resume only moves the playhead, not the counter. (Uncommitted as of doc update.) |
| **Video Swap Auto-Detection + Admin Reset** | Complete, `src/lib/training/detectVideoChange.ts` heuristic (`abs > 30s AND rel > 10%`). Both watch endpoints reset progress + demote status + clear audit timestamps on a detected swap. `POST /api/admin/sessions/[tabKey]/reset-watch-progress` routes by `LIVE_` prefix vs course tab_keys; red reset buttons in both session editors. Commit `b96fe23`. |
| **Mark Complete, final 20s + ENDED fallback** | Complete, `canMarkComplete = nearEnd && (thresholdMet || bypass)`. `nearEnd = liveCurrentPos >= liveTotalSec - 20 || videoEnded`. Fixed two root causes of "button stuck hidden": PAUSED-at-end fallback in `YouTubePlayer` + tracker baseline capture at mount with stale prop. Monotonic-max floor on `liveWatchSec`. Commits `cae696a`, `7f39fe9`, `4f3d675`, `2a6f5f5`. |
| **Live-Session Completion Flow** | Complete, `isWatched` effect filters `status === 'completed'` (not any history row) so an in-progress tick no longer masquerades as completion. `handleMarkComplete` parses 403 errors with `{ current, required }` and surfaces threshold-not-met to the student. Commit `2cf7777`. |
| **Interactive Onboarding Tour** | Complete (migration 120), `driver.js@^1.4.0` walkthrough on first dashboard visit. `training_registrations_meta.tour_completed` flag + `POST /api/training/tour-status`. `src/components/training/DashboardTour.tsx`. Tour copy avoids mentioning watch threshold. Commit `a9bf40a`. |
| **Auto-Launch Cron (disabled at UI)** | Complete wiring, gated off, migration 118 seeds `{hub}_auto_launch` + `{hub}_last_auto_launched_at`. `/api/cron/auto-launch-check` flips `coming_soon='false'` + one-shot clear. `AUTO_LAUNCH_UI_ENABLED=false` in `LaunchStatusCard` because Vercel Hobby only supports daily crons, re-enable when we upgrade to Pro. `vercel.json` entry rolled back. Commits `e05a51c`, `6cda7fb`. |
| **Session Reminders, per-registration** | Complete (migration 122), flags moved from `live_sessions` to `session_registrations.reminder_{24h,1h}_sent` + partial indexes on `false` rows. Late registrants now receive the right window. `src/lib/training/sessionAnnouncement.ts` centralizes the email build. Commit `fed8ece`. |
| **Coming-Soon bypass list** | Complete (migration 121), `training_settings.training_hub_bypass_list` seeded with owner email + RegID. `src/lib/shared/hubBypassList.ts` + `comingSoonGuard.ts`. `PreLaunchBanner` on authed dashboard. Admin UI TBD. Commit `ba218bc`. |
| **Share template `{hubUrl}` variable** | Complete (migration 119), append `\n\nLearn more at {hubUrl}` to 5 templates via soft-upgrade predicate; admin edits preserved; idempotent. Commit `589db84`. |
| **Hashtags mandatory + read-only preview** | Complete, every share post auto-merges `hashtags[]` into the body; student-side ShareModal textarea is read-only (admin edits on share-templates page are the single authority). Commits `30ded6d`, `0ffcfc3`. |
| **Watch threshold hidden from students** | Superseded 2026-04-29, the watch threshold itself was retired (commit `f583c70`). Mark Complete now unlocks 20 seconds before video end via the d-20 tick fallback (commit `f790fa9`); no percentage-based gate remains. Original commit `1d45bf7`. |
| **Live-session registration flow + email pipeline** | Complete, register endpoint now fires announcement/confirmation email via `sessionAnnouncement.ts`; cron reminder flags flipped per registration. Commit `fed8ece`. |
| **Dashboard upcoming-session card layout** | Complete, fixed 3-2-1 grid, 25% shorter (width reverted), auto-collapse via `minmax(min(100%, Npx), 1fr)`. Commits `8ceca27`, `25a93a6`, `8585bce`. |
| **Mobile responsiveness pass** | Complete, C1-C9 Critical + I1-I18 Important issues resolved across hero, sticky headers, session cards, sidebar nav, mobile bottom nav, admin tables, forms, buttons. Verified on 320/375/768/1024 viewports. Commit `cd3f250`. |
| **Marketing Studio PNG render** | Complete, `imageToDataUri` gets a 5s AbortController; render route gets `maxDuration=60` + unresolved count logging. Fixes "Failed to fetch" where a single slow image URL stalled the whole render past the serverless timeout. Commit `dfb0ab3`. |
| **System Health, SUPABASE_URL fallback** | Complete, env-check respects either `NEXT_PUBLIC_SUPABASE_URL` or `SUPABASE_URL` so the System Health card no longer false-alarms "Supabase URL (server) MISSING". Commit `886fa4d`. |
| **Per-subdomain layout.tsx files** | Complete, added `layout.tsx` to each route group under `app/training/*` (`[courseId]`, `assessment`, `certificate`, `certificates`, `dashboard`, `live-sessions`, `material`, `transcript`, `watch`) + `app/refm/` so deep links inherit learn/app subdomain OG defaults and share previews show the correct card. |

---

## Recently Completed, Share Templates + Verify Previews + OG canonicalization (2026-04-19 / 2026-04-20 session)

| Feature | Status |
|---------|--------|
| **Share templates, centralized system** (migrations 114-117) | Complete, `share_templates` table + four `training_settings` keys for global brand/founder mention strings + `@` prefix toggles. Render engine at `src/lib/training/shareTemplates.ts` with `renderShareTemplate`, `resolveCourseName`, `formatShareDate`. Client hook `useShareTemplate` with module cache + fallback. Admin page `/admin/training-hub/share-templates` with Global Mention Settings card + per-template editor. 5 seeded templates (certificate_earned, assessment_passed, achievement_card, live_session_watched, session_shared). Every share call site migrated (CertificateImageCard / VerifyActions / SessionCard / LiveSessionCard(Large) / assessment results / CourseTopBar). Commits `e155b54`, `a667c8d`, `fe8e6e3`, `0604db5`, `e691c92`. |
| **Daily certifications roundup** (migration 117) | Complete, `/admin/training-hub/daily-roundup` admin page + `GET /api/admin/certificates/by-date` endpoint. Template uses `{studentList}`, `{verifyLinks}`, `{count}`, `{date}`. One roll-up post per day instead of one post per student. Share Roundup button opens universal ShareModal. Nav entry 🎓 Daily Roundup under Training Hub. Commit `3c0f752`. |
| **Verify page, inline PDF + badge previews** | Complete, 2-column preview grid: Certificate PDF (4:3 iframe) + Badge PNG (1:1 img with soft-gold radial backdrop) on left, Transcript PDF (3:4 iframe, pre-cache-first) on right. Navy header strips + `Open Full ↗` + floating `⛶ View` mobile pill. Commits `5cb1c7e`, `608c4aa`. |
| **Dashboard cert share, ShareModal preview** | Complete, `CertificateImageCard` opens ShareModal with OG certificate image preview + editable text + platform buttons matching Achievement Card pattern. Commit `70f305a`. |
| **Subdomain-correct OG metadata + LinkedIn OG image** | Complete, `app/verify/layout.tsx` created with `metadataBase` / canonical / og:url pinned to LEARN_URL. Training + Modeling layouts gained explicit `alternates.canonical`. `robots.ts` adds `Allow: /api/og/` so LinkedInBot can fetch OG images. `URLS.verify` helper canonicalized to learn subdomain. Admin certificates fallback no longer routes legacy certifier_uuid certs to main. Sitemap lists `/verify` on learn. Commits `2097ddb`, `756cff9`. |
| **Share text, course name + date format fixes** | Complete, `resolveCourseName()` + `formatShareDate()` baked into render engine. `/api/training/certificate` no longer prefers `course_code` over `course` (was serving "3SFM" to dashboard). All call sites route dates through `formatShareDate()`. ShareModal now seeds draft with text + hashtags merged so students see exactly what's copied. Commits `fe8e6e3`, `0604db5`. |
| **Dashboard upcoming-only live sessions preview** | Complete, removed Recorded sub-section from dashboard block (full library stays on `/training/live-sessions`). Grid capped at 3 cards. Empty-state card replaces silent disappearance. Commit `bbc37be`. |
| **Google Search Console verification** | Complete, token added to `app/layout.tsx` metadata.verification. Commit `4d31229`. |
| **Bing Webmaster Tools verification** | Complete, `msvalidate.01` token added via `metadata.verification.other`. Both `<meta name="google-site-verification">` and `<meta name="msvalidate.01">` render sitewide. Commit `578eed7`. |

---

## Recently Completed, Marketing Studio + Watch Enforcement (2026-04-18 session, continued)

| Feature | Status |
|---------|--------|
| **Marketing Studio, Phase 1** (migration 100) | Complete, `marketing_designs` + `marketing_brand_kit` tables. 3 templates (YouTube Thumbnail / LinkedIn Post / Instagram Post) via satori `ImageResponse`. Admin page at `/admin/marketing-studio`, Brand Kit editor at `/admin/marketing-studio/brand-kit`. Anthropic single-platform caption generator. Saved designs list. Admin nav entry under Content. Commit `a21d1c5`. |
| **Marketing Studio, Phase 1.5 (canvas editor)** (migration 101, `react-rnd@^10.5.3`) | Complete, drag-and-drop canvas replaces fixed templates. Element-based design (text / image / shape) with absolute positioning. `react-rnd` drag + resize, auto-fit zoom, undo/redo stack (50), keyboard shortcuts (Delete / Ctrl+Z/Y / Ctrl+D / Ctrl+C/V / Arrow nudge). `src/components/marketing/canvas/{CanvasEditor,ElementRenderer,PropertiesPanel}.tsx`. 5 starting presets + Blank Custom. Migration 101 adds `dimensions`/`background`/`elements` jsonb to `marketing_designs` + `additional_logos`/`additional_photos`/`uploaded_images` to `marketing_brand_kit`. Commit `2e8f624`. |
| **Marketing Studio, Custom backgrounds + aspect-ratio lock + FMP YouTube preset** (migration 102) | Complete, `background_library` jsonb added to `marketing_brand_kit`. Background panel: upload → save to library → reuse; brand-typed entries non-deletable; optional dark overlay. `lockAspectRatio` toggle per image/shape element (images default ON). Image elements support border ring (color + width). Text element italic toggle. `fmpYoutubeThumbnailPreset` with session badge, teal ring founder photo, gold dividers. Commit `025563a`. |
| **Marketing Studio, Phase 2 (multi-platform + auto-populate + multi-caption)** (`jszip@^3.10.1`) | Complete, FMP LinkedIn Post + FMP Instagram Post presets. Quick Fill panel auto-populates text from articles / live sessions / training sessions via id-prefix matching. Multi-platform caption generator (LinkedIn / Instagram / Facebook / WhatsApp / Twitter / YouTube) with parallel `Promise.all` + tone selector (Professional / Casual / Thought Leader / Educational). Export to All Platforms ZIP. Saved designs sidebar with lazy-rendered thumbnails + template filter. Commit `9dfaeb3`. |
| **Marketing Studio, Phase 3A (9 FMP presets + 5 variants)** | Complete, 6 new FMP platform presets: YouTube Banner 2560×1440, LinkedIn Banner 1584×396, Instagram Story 1080×1920, Facebook Post 1200×630, Twitter/X 1600×900, WhatsApp Status 1080×1920. 5 template variants scaled proportionally to any dimensions: Session Announcement, Quote/Insight, Platform Launch, Achievement Spotlight, Article Promo. Preset picker grouped by platform (YOUTUBE / LINKEDIN / INSTAGRAM / FACEBOOK / OTHER / CUSTOM). `variant_id` persisted in existing `content` jsonb, no migration. Commit `283e9b4`. |
| **Video Watch Enforcement (70% rule)** (migration 103) | Complete, client-side interval-merging tracker (`src/lib/training/watchTracker.ts`) so seeking can't inflate counts. YouTubePlayer reports `onProgress(sec, total, pos)` every ~10s. Watch page posts to `/api/training/certification-watch` with MAX server-side merge. Mark Complete gated until `watch_percentage ≥ threshold`. `WatchProgressBar` component above Mark Complete + thin bar on dashboard session cards (red <30% / amber <threshold / green ≥threshold + dashed threshold marker). Migration 103 adds `watch_seconds`/`total_seconds`/`watch_percentage`/`last_position`/`updated_at` to `certification_watch_history` + seeds `watch_enforcement_enabled`/`_threshold` in `training_settings`. Commit `1db1430`. |
| **Watch Enforcement, default for all future sessions** | Complete, missing bypass row = enforcing (no seeding needed). Admin UI session list is union of `COURSES` + distinct tab_keys in `certification_watch_history`. Status badges show "Enforcing (default)" vs "Bypassed" vs "Global OFF". Summary card shows enforcing/bypassed counts at a glance. `verifyWatchThresholdMet()` in `src/lib/training/watchThresholdVerifier.ts` gates cert issuance in `processPendingCertificates`, grandfathers pre-migration-103 rows (no watch data) so historical certs aren't blocked. New endpoint `/api/admin/watch-enforcement-stats`. Commit `0950ac7`. |

---

## Recently Completed, CMS Universalization + Training Hub fixes (2026-04-18 session)

| Feature | Status |
|---------|--------|
| **CmsField, Universal Rendering (Phase 1)** | Complete, `src/components/cms/CmsField.tsx` is the only way CMS text reaches the frontend. All 21 section renderers + all Option B pages use it. Handles visibility / alignment / width / HTML detection / paragraph splitting. Enforcement docstring + CLAUDE.md rules. |
| **RichTextarea → Tiptap (Phase 2A)** | Complete, rewrote `src/components/admin/RichTextarea.tsx` as a Tiptap editor with StarterKit + Underline + Link + Color + TextStyle + custom FontSize. Installed `@tiptap/extension-underline@2.27.2`. Replaced 10 plain textareas with RichTextarea. Removed legacy `ParagraphsEditor` + `AlignPicker` (orphan `content.paragraphs[]` harmless). |
| **Array Item VF + TwoPlatforms fix (Phase 2B)** | Complete, `ItemVF` / `ItemBar` helpers in page-builder. Per-item VF on 9 array editors. TwoPlatforms VF keys now stored inside `columns[i]`. 8 frontend renderers filter `item.visible !== false`. Migration 097 backfill. |
| **Attempts counter (server-authoritative)** | Complete, `/api/training/submit-assessment` increments `attempts` from existing Supabase row, ignoring stale client `attemptNo`. `/api/training/attempt-status` overlays Supabase over Apps Script. |
| **Timer persistence + auto-submit** | Complete, localStorage `assessment_timer_${tabKey}_${attemptNo}` records start epoch. Page remount resumes clock; expiry auto-submits saved answers; counts as the attempt. `beforeunload` guard during 'taking'. |
| **Retake flow fix** | Complete, `/api/training/certification-watch` guards against `'completed' → 'in_progress'` downgrade. 'completed' is terminal. Fixes "had to re-mark complete after failed attempt" bug. |
| **Universal Share Utility** | Complete, `src/lib/training/share.ts` `shareTo()` + `src/components/training/share/ShareModal.tsx`. Copy-first-then-open pattern. Dashboard + watch-page + SessionCard + assessment results all use the utility. |
| **Calendly inline embed** | Complete, `src/components/booking/CalendlyEmbed.tsx` dynamically loads widget.js on mount. `/book-a-meeting` embeds inline (no redirect). Reads URL from `page_sections.team.content.booking_url`. Fallback to contact options when URL empty. |
| **founder_profile table dropped** | Complete, Migration 098. Deleted `/admin/founder/` + `/api/admin/founder/` + `getFounderProfile()` from `src/lib/shared/cms.ts`. All founder data lives in `page_sections.team`. |
| **/about page removed** | Complete, Deleted `app/about/page.tsx`. Redirect `/about → /about/ahmad-din` in next.config.ts. Footer + nav entries repointed. Migration 099 cleans up orphan DB rows. |
| **Founder contact fields** | Complete, Email + WhatsApp added to FounderEditor Booking Page tab. "Get in Touch" section at bottom of `/about/ahmad-din` shows email/WhatsApp/LinkedIn/booking as readable clickable text. Hero buttons kept LinkedIn + Book a Meeting only. |
| **Hero universal VF** | Complete, Home, Training, Modeling, Modeling [slug], Founder page heroes all respect `cmsVisible` + `fw()` + `CmsField`. Missing fields (powerStatement/softCta/trustLine/tags) added to Modeling Hub hero. Width pattern `min(1200px, 90vw)` + subtitle maxWidth 960 standardized across heroes. |
| **CTA field-name dual-read** | Complete, Modeling + Training pages read admin's `buttonText`/`buttonUrl`/`subtitle` first, fall back to legacy `cta_text`/`cta_url`/`description`. Fixes "bottom CTA edits not reflecting". |

---

## Previous Session (earlier)

| Feature | Status |
|---------|--------|
| **Assessment Internal Route** | Complete, assessment uses `/training/assessment/[tabKey]` instead of Apps Script formUrl (always empty). Dashboard shows "Take Assessment →" button |
| **Dashboard Header Match** | Complete, dashboard header matches main Navbar: rgba bg, blur, 64px height, 40px padding, border-bottom |
| **Certification Watch Tracking** | Complete, `certification_watch_history` table (migration 088). Watch page writes in_progress on play, completed on Mark Complete. Dashboard gates assessment behind completion |
| **Email Migration to Next.js** | Complete, quizResult, registrationConfirmation, lockedOut emails now sent from Next.js. `/api/email/send` bridge kept for backwards compat. Migration 089 syncs email logo. **Update 2026-05-11 (commit `166a8ec`)**: per-session quizResult emails removed — the template now fires only for the FINAL EXAM. Per-session pass/fail visible on the dashboard. lockedOut continues to fire per-session when attempts are exhausted. |
| **Supabase Assessment Results** | Complete, `training_assessment_results` table (migration 090). Dual-write: Apps Script + Supabase. Progress route merges Supabase over Apps Script for instant reads |
| **In Progress Status Badge** | Complete, StatusBadge shows amber "In Progress" when video started/completed but assessment not taken |
| **Achievement Card System** | Complete, dynamic OG image (`/api/training/achievement-image`), satori ImageResponse, sharp SVG→PNG logo, student name + reg ID + score + course + date. Admin-controlled logo height |
| **Share System** | Complete, SessionCard: Share modal (textarea, LinkedIn auto-copy + compose, Copy Text) + Card modal (preview + download). Assessment result page: same pattern. LinkedIn opens compose with auto-copied text |
| **OG Social Previews** | Complete, Per-domain OG banners: `/api/og` (learn), `/api/og/modeling` (app), `/api/og/main` (main). CMS-driven hero text, logo from header_settings (sharp SVG→PNG). Assessment layout.tsx with dynamic OG tags. metadataBase on all layouts |
| **LinkedIn + YouTube Sidebar** | Complete, Follow Us section in dashboard sidebar with LinkedIn + YouTube buttons (expanded + collapsed states) |
| **Back to Course Navigation** | Complete, assessment page "Back to Dashboard" includes `?course=` param for correct course context |
| **Watch Page Passed State** | Complete, shows "Assessment Done" instead of "Take Assessment" when session already passed. assessmentPassed prop through CoursePlayerLayout → CourseTopBar |
| **Assessment Blocks Passed** | Complete, assessment page checks progress API (Supabase-merged) on mount, immediately shows "Already Passed" screen if session passed |
| **Dashboard Share Banner** | Complete, "Enjoying your progress?" banner opens modal (same pattern as session share) with textarea + LinkedIn + Copy Text |

---

## In Progress

| Feature | Current State | What Remains |
|---------|--------------|--------------|
| **AI Agents** | Market rates + research agents wired | Contextual help agent (stub only) |
| **Pricing / Subscriptions** | `/admin/pricing` is now a single Platform Pricing surface (no tab bar). Plans + Page Content + Pricing Features + Module Access tabs all removed across 2026-04-27 / 2026-04-28. Migration 145 dropped `pricing_plans`. Page Builder → Pricing owns hero + FAQ for the public page. Plan-based feature gating ripped out (commit `d8405e5`); REFM stubs `canAccess()` → `false`. | Reintroduce plan-based gating as a focused new feature spec when paid tiers go live (server-enforced from day one, built on the surviving `platform_pricing` + `platform_features` + `plan_feature_access` tables). |
| **Branding** | Brand Colors section moved into `/admin/header-settings` (2026-04-28, commit `ab5db30`). `/admin/branding` is a 5-line redirect. Drives `--color-primary` / `--color-secondary` via `BrandingThemeApplier`. | None, Header Settings owns brand colors + logos + favicon + header text + header layout in one place; Page Builder owns page copy. |

---

## Not Started, REFM Modules

> Module 1 ships production-ready on the v8 schema after M2.0g (2026-05-06). Next phase is **M2.1 Revenue Analysis**, which consumes the v8 HydrateSnapshot. Pattern decisions for downstream modules are codified at the bottom of CLAUDE.md M2.0g closure block (rate-unit → revenue stream mapping, asset.status revenue gating, sub-unit category drives revenue source, asset-level parkingArea consumption, Inputs/Results sub-tab pattern).

| Module | Name | Status |
|--------|------|--------|
| Module 2 | Revenue Analysis | Stub only (next up; reads v8 HydrateSnapshot, asset.status gates revenue per period, rate-unit drives revenue stream) |
| Module 3 | Operating Expenses | Stub only |
| Module 4 | Returns & Valuation | Stub only |
| Module 5 | Financial Statements | Stub only (consumes `classifyAssetCapex` + `computeCashFlowImpact` from M2.0d unchanged) |
| Module 6 | Reports & Visualizations | Stub only |
| Modules 7–11 | (various) | Placeholder stubs |

**Deferred from M2.0 / M2.0g (carried forward):**
- Module 2 Revenue: cohort collection (Sell + Sell+Manage), hospitality USAH (Operate + count), retail NOI (Lease + area), mixed strategy. Asset.status drives revenue gating (`planned` no revenue, `construction` pre-sale only, `operational` full).
- Module 3 Cashflow: real surplus-driven cash sweep math (today straight-lines outstanding balance).
- Module 5 Statements: full IDC schedule breakdown (capitalised vs paid in cash post-construction).
- Excel + PDF exports: stub modal in M2.0; rebuild against v8 in M2.1+.
- Wizard polish: type bank auto-pre-fills GFA/BUA defaults from sub-unit metric; preset templates ("Saudi mixed-use", "Branded residences", "Hotel-led resort") seed Tab 2 with industry-typical asset mixes.

---

## Not Started, Modeling Platforms

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

`_legacy_backup/js/refm-platform.js`, 7,599-line original CDN implementation.
- AppRoot: lines 1-70 | State: 72-200 | Calculations: 200-900
- Excel export: 900-1,900 | Project Manager UI: 1,900-3,800
- Main render: 3,800-5,700 | Module 1 UI: 5,700-7,520 | Stubs: 7,520-7,598
