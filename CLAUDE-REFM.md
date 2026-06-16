# Real Estate Financial Modeling (REFM), Claude Code Project Brief
**Last updated: 2026-06-16. Lock status: M1 LOCKED (M2.0 Pass 58 base), M2 LOCKED (Pass 9N), M3 LOCKED (Pass 5d), M4 DONE (Financial Statements: Schedules / P&L / CF / BS, balances by construction + Direct==Indirect), M5 DONE (Returns & RE Metrics + Lender Covenants), M6 Scenario Analysis LIVE, M7 Reports = stub. Full verifier suite green via `npx tsx scripts/verify-*.ts`.**

## 2026-06-16 session: M6 override pipeline (empirical), platform shell, admin module mgmt

Full day, ~12 commits (`0b7f7fe0`..`9bc12e80`). Three themes:

**1. Module 6 scenario override pipeline.** Empirically PROVEN sound: `scripts/verify-module6-pipeline.ts` (19/19) drives the REAL store (`hydrate`/`setActiveCase`/`setCaseFieldValue`) + real `buildCaseComparisonReport` and asserts OBSERVED comparison deltas (the prior `verify-module6-scenarios` tested labels + a `scen.overrides` shortcut, so it passed 127/127 while users saw "no delta"). `applyOverrides` loses nothing; ~60/108 numeric fields move a KPI, the rest are inert by config/semantics, NOT a broken merge. Fixes: (a) opex inflation `normalizeOpexIndexation()` in `core/calculations/opex/defaults.ts` coerces a method-less rate to `yoy_compound` (applied in `opex-resolvers.ts` asset+HQ + mirrored in `Module3Opex.tsx`); (b) "N overrides" counts REAL diffs not stored keys (`caseComparisonReport` + `Module6Scenarios`); (c) **inert-lever gating** `inactiveLeverReason(path, model)` in `assumptionGrid.ts` drops/labels levers dead under the active config (fixed-ratio Debt% under funding Method 2/3, tranche interest/LTV under Method 1, perpetuity growth under exit-multiple, occupancy on Operate assets, opex inflation with no fixed-cost lines, lease baseRate when unitPrice set); (d) null-FCFF headline: comparison leads with Equity IRR (FCFE), `Project IRR (FCFF)` renders "n/a (no unlevered IRR)" via KPI `nullLabel`; (e) added **NPV (FCFF)** row so discount rate has a metric; (f) per-period levers (`occupancyPct`) stripped from grid via `isPerPeriodLever()`; (g) Group B polish: Tax/Zakat off curated, Capex-matched construction labels (`Construction (BUA), per sqm` / `(Parking), per bay`), land-price lever (`parcels[id].rate`), sticky-header grid, comparison metrics (Total Financing Cost / Cap Rate at Exit / Min DSCR, TDC split into Land + Capex). LIVE-PROJECT proof (FMP RE HUB, funding Method 3): debt%/occupancy/opex were inert for real config reasons (gap-sized debt / per-period occupancy / no fixed-cost opex lines); ADR + discount rate move 13/8 KPIs. `verify-module6-scenarios` 128/128, `verify-module6-pipeline` 19/19.

**2. Platform shell.** No default project on sign-in (boot no longer auto-opens cached `readActiveProjectId`); lands on Dashboard. **Projects tab removed** (both nav sources) — Dashboard hub replaces it. `Dashboard.tsx` rebuilt as the project-AGNOSTIC all-projects hub (portfolio tiles + recent activity + project cards w/ Open + Delete-with-confirm). NEW `Overview.tsx` = open-project investor summary (returns / economics / capital-structure donut / timeline / health chips) via `computeFinancialsSnapshot`->`computeReturnsSnapshot`, no engine change, no nav cards. `renderModule` routes `dashboard`->Dashboard, `overview`->Overview (no longer aliased). Universal module lock: Overview + every `module1..11` disabled until a project is open. **View/edit lock**: opening a project lands on Overview in VIEW mode (read-only, `pointer-events:none` on module content + "View only" banner); Topbar/banner **Edit** button runs the save-as / name-version flow then unlocks. This fixes VERSION CHURN: `module1-sync` gained an `editingEnabled` gate (`setEditingEnabled`) so the store subscriber ignores view-mode changes (no auto-session/autosave/version); `startEditSession` + entering edit mode flip it on. New projects open in edit mode on Setup. New Project modal no longer closes on backdrop (X / Create only). Sidebar width 264->304->**325** (`--sidebar-width`; wrapper has `zoom: 0.8`) + widened `.sidebar-nav` scrollbar (11px). Visual design pass on Dashboard + Overview (navy hero band, brand-accented sections, kpi-card pattern, status-accented cards).

**3. Admin module reorder / hide + the read/write disconnect (CRITICAL).** Root cause of "hidden doesn't hide / reorder doesn't propagate": admin WRITES `platform_slug='real-estate'` (the legacy `modules.slug`; migration seeds + re-keys to it) but the workspace READ `usePlatformModules('refm')` -> empty -> hardcoded `STATIC_SIDEBAR_MODULES` fallback (all visible, fixed order). Fix: `export REFM_PLATFORM_SLUG = 'real-estate'` (read == write slug) + pure testable `toSidebarNavList()` (filters Hidden, orders by `display_order`, stable `module${number}` key, position label). Reorder via admin ▲/▼ arrows (`moveModule` rewrites `display_order`; `number` stays the stable routing identity, no migration). Hidden = excluded from sidebar AND non-routable (`renderModule` guard). Marketing pages use position numbering too. `verify-psync` 78/78 (incl. read-slug == seed-slug + a live endpoint check when the dev server is up).

## 2026-06-15 session: Lender Covenants (M5 RE Metrics)

**Lender Covenants section on the RE Metrics tab (`lib/covenants.ts` + `Module5Metrics.tsx`, verifier `scripts/verify-covenants.ts` 32/32, commit `ec9e2e5b`).** Pure display-layer evaluation over the EXISTING returns snapshot — NO engine/snapshot change. Editable covenant thresholds saved to `Project.covenants` (seeded from `DEFAULT_COVENANTS`: DSCR ≥ 1.20x, ICR ≥ 2.00x, LTV ≤ 60%, Debt Yield ≥ 10%); each row shows worst (binding period) / avg + Pass/Breach + a per-period heatmap. DSCR/ICR read straight off the snapshot (worst = engine min, matching the cards); Debt Yield = NOI/debt (n/a where no debt). **LTV is measured at PEAK DEBT, not at exit:** debt is repaid by exit so LTV-at-exit is a trivial ~0% that is meaningless to a lender. The model has no per-period property value, so the value basis is GDV (Gross Development Value): LTV per period = debt outstanding / GDV, and the binding (max) point IS the peak-debt LTV. The basis is surfaced in the UI (`peak debt / GDV` caption + `LTV (peak debt)` label) and in the section description. Where GDV is unavailable it falls back to a single-point LTV at exit, explicitly labelled "LTV at exit" via `CovenantEval.basis`/`basisLabel`, so it cannot be mistaken for a peak-leverage covenant. Derived from existing snapshot series only (`debtOutstandingPerPeriod` + `developmentEconomics.gdv`).

## 2026-06-14 session: Excel MODEL export full module mirror + Module 6 Scenario Analysis

**Excel MODEL export (`lib/excel/buildModelWorkbook.ts`, verifier `scripts/verify-excel-export.ts` 129/129).** A hardcoded snapshot of the whole platform, one tab per module surface, tab order = the module sequence (Cover, Inputs, Timeline, Land & Area, Capex, Financing, Revenue, Opex, Schedules, P&L, Cash Flow, Balance Sheet, Returns, Checks). Each output tab is a faithful mirror built from the SAME shared report builders the on-screen tabs + PDF use (`m4Reports` / `cosReports` / `opexReports` / `financingReports` / `capexReports`) and the snapshots (`computeFinancialsSnapshot` / `computeReturnsSnapshot`):
- **Inputs** holds EVERY model input, grouped by domain divider band in module order: Project / Phases / Land parcels / Assets / Sub-units / Returns / Capex cost lines, then `CAPEX` is followed by `FINANCING INPUTS` (Module 1), then `REVENUE INPUTS`, then `OPEX INPUTS`. The module output tabs echo their own input slice marked "from the Inputs tab".
- **Revenue** mirrors all 5 Module 2 sub-tabs (Inputs / Output incl. vintage matrices / Cost of Sales / Schedules / Escrow). **Opex** mirrors the 3 Module 3 sub-tabs. **Schedules** mirrors the 2 Module 4 sub-tabs (Fixed Assets & D&A; BS Schedules A1-A4 / L1-L3 / E1-E2). **P&L / Cash Flow / Balance Sheet** are the full M4 statements (terminology-driven labels). **Returns** mirrors the M5 Returns + RE Metrics tabs section-for-section (KPI cards, sources & uses, funding mix, exposure, debt analytics, returns-by-basis, FCFF/FCFE/Distributed build-ups). Sensitivity grid is a pending unit.
- **One standard navy palette throughout** (no green / per-tab colours): navy tabs + totals, deep-navy section bands, pale-navy subtotals, teal removed; red reserved for genuine check failures. The verifier locks the palette + the tab sequence.

**Module 6 Scenario Analysis (`components/modules/Module6Scenarios.tsx`, verifier `scripts/verify-module6-scenarios.ts` 79/79). DONE (grid 2026-06-15, b9281cae).** A surface over the EXISTING case engine (do not rebuild it): case list (reuses store actions), comparison matrix (`buildCaseComparisonReport`), and a multi-case **assumptions grid** (Section 2). The grid: rows grouped under Inputs-tab category dividers with plain-English labels + asset/phase/facility/parcel/method attribution (so no ambiguous duplicate rows); columns = every case incl. an editable Management; curated key-driver default view + "show all" toggle + add-row picker. **Presentation layer in `lib/cases/assumptionGrid.ts`** (labels / categories / curated set / `buildGridContext` attribution / format helpers) — the override engine (`applyOverrides` / `snapshot-diff`) is untouched. Construction cost levers are MODEL-AWARE: when a project enters costs per-asset, `curatedDefaultFields` surfaces one row per asset from `costOverrides[assetId::lineId]` (the real rates) instead of the phase-level master (which is 0 or a stale seed); zero/disabled/unused levers are dropped. Per-field percent-scale detection (fractions 0-1: discount/tax/indexation; whole 0-100: debt/occupancy/contingency/pre-op/prof-fee) renders all percents at 2dp via `formatAssumptionValue`/`parseAssumptionInput` (edit in displayed unit); rates/prices keep accounting. Store actions `setCaseFieldValue`/`resetCaseFieldValue` edit ANY case (base reflows the active scenario). Backlog: construction-timeline overrides (need a cascade-on-override). The earlier explicit single-case override editor (16/16) was replaced by this grid. Config swap: `modules-config.ts` Module 6 = Scenario Analysis (enabled), Module 7 = Reports (stub); placeholders renamed `module6-scenario.ts` / `module7-reports.ts`. New `enumerateOverridableFields(model)` in `lib/cases/applyOverrides.ts` mirrors the `diffSnapshots` grammar so the picker only offers fields that round-trip (id / reference fields excluded). New store action `setOverridePath(path, value)` writes the same live override map as auto-capture. Per-element override grammar: `snapshot-diff.PER_ELEMENT_ARRAYS` (parcelFunding by parcelId) + `findElement` generic `field=value` selector so `project.financing.parcelFunding[parcelId=P].debtPct` round-trips. Value-only + base-untouched intact. Coverage audit: sale price / area already round-trip via top-level `subUnits[id=X].unitPrice` / `.unitArea`; per-period curves (cash / recognition / lease occupancy) and per-sub-unit velocity stay whole-array auto-capture. Re-basing = a later unit.

**2026-06-04 session (detail in memory `[[project_pdf_mirror_autosync_2026-06-04]]`):** M4 phase views (P&L→EBITDA / CF→Operations+Investing / BS consolidated-only); SHARED report builders in `lib/reports/` (m4/opex/capex/financing/cos) — both the on-screen M4 tabs AND the PDF render from `m4Reports.ts` (auto-sync mirror), the PDF mirrors M1/M2/M3/M5 via the other builders. `ExportModal` version picker (export any saved version, file named after it; `modelFromSnapshot`). Cases follow-ups A/B/C: viewing a case no longer starts an edit session (`stripVolatile` in module1-sync), per-input "≠ Management" `OverrideBadge` + Reset, scenario edits described in the change_log (`diffCases`). Auto-updating **platform walkthrough guide** (`lib/guide/`, Topbar "Guide" button): in-app view + PDF/Markdown download, structure derived from MODULES + MODULE_TABS.

<!-- Historical narrative (2026-06-01/02: M5 sponsor-IRR rework, funding Methods 2/3 gap-sizing, conditional IDC + iterative fixed-point loop, funding-gap 3-schedule split) retained below; full detail in memory + git. -->

**Module 5 (Returns & Valuation) NEW 2026-06-01 (commits `9095ae7` engine + `19f0292` resolver/UI/sidebar): pure IRR/MOIC/NPV/Payback on FCFF/FCFE/Dividends + terminal value (exit-multiple/perpetuity/none) + RE metrics (Yield on Cost, Cap Rate, DSCR, LTV at Exit, Equity Multiple, Debt Yield, ICR, Cash-on-Cash, Profit Margin). Engine `src/core/calculations/returns/` (pure), resolver `returns-resolvers.ts`, UI `Module5Returns`/`Module5Metrics`, additive `Project.returns` config. Funding Methods 2/3 calculate + GAP-SIZED drawdown via a guarded two-pass in `computeFinancialsSnapshot` (commits `03a18ec` → `7d340fc`); BS balances + Direct==Indirect for all 4 methods. M5 build-up: step-by-step FCFF/FCFE/Dividend derivation tables (commit `1c2d149`). **2026-06-02 — M5 reworked to a SPONSOR-IRR / project-inception view: every stream leads with an INCEPTION period (index 0 = projectStartYear − 1) carrying existing operations. FCFF inception = −existing pre-capex; axis = CFO + CFI (new capex), NO in-kind land line (non-cash, already in CFO via CoS/dep). FCFE inception = −pre-capex + existing debt opening (= −existing equity); axis adds debt draw − principal − interest − in-kind land. In-kind land + existing-debt-opening appear on FCFE only. Per-period bridge FCFE = FCFF + debt draw − principal − interest − in-kind + terminal-equity adj. `fin.existing.{preCapexTotal,debtOutstandingTotal}` feed inception; `ReturnsSnapshot.streamYearLabels` + `buildup.{existingPreCapex,existingDebtOpening,existingEquity}PerPeriod` added; IRR is headline, NPV still computed. verify-returns-snapshot 30→38 (SPONSOR section).** Platform infra: project-switch state-leak fixed + session-based versioning with per-version change_log shipped (commits `ca5c152` + `d25a20b`). **2026-06-02 — Funding Gap sub-tab split into THREE segregated schedules (Method 3 Funding Requirement / Debt Repayment via Cash Sweep / Dividend via Cash Sweep), each ending in its own Closing Cash chained to the Direct CF closing (pre-distribution −sweep = post-sweep −dividend = final); cash-sweep order now EXISTING loans first then priority; NEW `idcConfig.fundingMode: 'conditional'` raises IDC debt only to the extent needed to maintain the minimum cash reserve — in surplus-cash construction periods the interest is PAID IN CASH (still capitalised to the asset basis), via a per-tranche `interestCapitalizedCashPaid` engine reclassification (no new composer balance term: `debtServiceCash = accrued − capitalized + principal` auto-carries the cash outflow). The drawdown ↔ finance cost ↔ balance circularity (the one Excel resolves with iterative calc) is now solved by an ITERATIVE FIXED-POINT LOOP: `computeFinancialsSnapshot` wraps an inner `computeFinancialsSnapshotOnce`, re-deriving `{fundingGap, idcCashBudget}` via `deriveCircularInputs` and re-running until both stop changing (max per-period delta < 1, cap 25 iters); the SAME loop also converges Methods 2/3 gap-sizing (replacing the old single re-pass). Each pass is internally consistent so BS balances + Direct==Indirect at every iteration; convergence pins drawdown + finance cost. Explicit-opts callers still do one pass. BS balances + Direct==Indirect, debt lower than the all-capitalised case.** FULL VERIFIER SUITE GREEN 2026-06-02: 25 scripts, 0 fail (idc-depreciation 113→135 §J conditional IDC, funding-methods 45→59 [IDC] + [CONV] fixed-point, bs-reconciliation +N5 existing-first sweep).**

## Cases (scenario management), shipped 2026-06-03 (commits `bb19ae6` + `2682a35`)

Scenario/case management on the REFM model. A "case" = the base ("Management") model plus a flat map of field OVERRIDES (value changes only, no per-case add/remove of entities). The **Management Case** is the base/reference; **Downside** + **Upside** are seeded override-cases; users rename + add custom cases.

- **Merge engine `lib/cases/applyOverrides.ts`** (pure): `applyOverrides(base, overrides)` = inverse of `diffSnapshots` (deep-clone + set each path; missing entities skipped); `buildOverrides(base, edited)` derives the map via `diffSnapshots` (one path grammar); `getByPath`; `seedCases` / `baseCaseId` / `normaliseCases`. Override paths use the diff scheme (`assets[id=X].revenue.sell.pricePerUnit`, `costLines[id=Y].value`, `costOverrides[a::l].x`, `landAllocationMode`).
- **Store** (`module1-store.ts`): top-level model fields ALWAYS hold the ACTIVE case's merged model, so every component + setter is case-agnostic. New `cases[]` + `activeCaseId` + `baseSnapshot`; methods `setActiveCase` (flush current → load target) / `addCase` / `renameCase` / `removeCase` / `clearCaseOverrides` / `resetOverridePath` / `extractPersistSnapshot`. `hydrate` auto-seeds the Management base + normalises legacy snapshots (additive, schema-tolerant).
- **Persistence** (`module1-sync.ts`): `extractSnapshot` delegates to `extractPersistSnapshot`, so the persisted form is always base model + cases + activeCaseId (never the merged active model). Cases version with the snapshot.
- **UI**: `CaseSwitcher.tsx` in the Topbar (switch/add/rename/delete + overrides list with Reset/Reset-all + amber chip on scenario); `Module5CaseComparison.tsx` = Returns "3. Case Comparison" tab (every case computed via the pure pipeline; KPI rows × case columns + delta vs Management). `m5Tabs` gained `m5-cases`.
- **Verifiers**: `verify-cases.ts` 19/19; `verify-returns-snapshot.ts` +3 real-engine cases checks (89 total).
- **Known/accepted (follow-ups in CLAUDE-TODO.md NEXT SESSION):** switching cases marks the project dirty (persists last-viewed case, can auto-start a session); `diffSnapshots` doesn't yet describe scenario-only edits in the change_log; per-input inline override badges deferred (Case Manager + comparison tab cover visibility).

## Latest financing + returns work (2026-06-02)

Commits this session, on `main`: `2f5adad` consolidated cash waterfall, `045828f`/`042828f` conditional IDC + segregated schedules, `45ecbc8` Method 3 drawdown table restored, `225b66d` M1→M5 audit (9 fixes), `056add3`/`dbbe580` M5 Returns Pass 1 + final revision, `ea7ac63` M5 terminal 100% payout + Method 3 gap excludes debt repayment, `ab451a8` docs optimize, `c6e78f6` dividends-after-debt + terminal payout moved into the engine, `2d400aa` single project-level dividend start year, `0994f76` project-level dividend policy + repo em-dash scrub, `1817c02` Cash Sweep sub-tab, `3301350` per-tranche Debt Paid + pre-sweep opening fix, `5db031d` full-project PDF export, `5d71d4b` Dividend Policy to top of Cash Sweep tab.

- **M5 terminal 100% payout (`ea7ac63` → moved to engine in `c6e78f6`):** at the exit period no minimum cash is retained; all cash above the opening-cash seed is distributed. NOW booked in the financing engine (`computeCashWaterfall`: `terminalPayoutPeriod` = `project.returns.exitYearOffset ?? N-1`, `terminalCashFloor` = `historicalOpeningCashTotal`), added to `totalDividendsPerPeriod[exit]` so it flows through Direct CF + BS + Returns and the cash-sweep Dividends line ties to FCFE / Distributed Equity. The returns-resolver-only fold was removed. New `DividendSnapshot.terminalPayoutPerPeriod`.
- **Dividends are ONE after-debt rule, no toggle (`c6e78f6`):** `statusPriority` is always `'after_sweep'` (before-sweep tier retired). BS Check label now tolerant (balanced if `maxAbsDiff < max(1000, totalL&E×1e-6)`, rounding noise on a billions project).
- **Single project-level dividend controls (`2d400aa` + `0994f76`):** `Project.dividendStartYear` (one start year, default = year after the last construction period) + `Project.dividendPolicy { enabled, payoutRatio, mode }` drive EVERY phase via `computeCashWaterfall` (`dividendStartYear` + `projectDividendPolicy` params); unset => legacy per-phase fallback. Per-phase Dividend Policy table + EBITDA-cap detail table removed from the UI.
- **Method 3 gap excludes existing debt repayment (`ea7ac63`):** `computeFundingGap` no longer subtracts `existingDebtRepaymentPerPeriod` (never raise NEW debt to repay OLD debt). Repayment is serviced from cash on hand.
- **Financing Cash Sweep sub-tab (`1817c02`):** Module1Financing now has Inputs / Schedules / Funding Gap / **Cash Sweep**. `FundingGapView` takes a `view: 'gap' | 'sweep'` prop, sections gated on it (Method 2 + Method 3 → gap; Cash Waterfall + per-tranche sweep + Dividend Policy → sweep). `5d71d4b` then moved the Dividend Policy to the TOP of the sweep tab (inputs above the waterfall they drive).
- **Per-tranche Debt Paid + pre-sweep fix (`3301350`):** Cash Waterfall splits Debt Paid per facility (`facilities.get(id).principalRepaid`) with a reconciling total. `computeCashWaterfall`'s per-tranche `preSweepOutstanding` now = `postSweep + THIS period's sweep` (was `postSweep + cumulative sweep`, so a fully-repaid tranche showed its original opening forever).
- **Full-project PDF report (`5db031d` → REWRITTEN `76aea30` 2026-06-03):** `lib/pdf/generateProjectPdf.ts` (pdf-lib). All-landscape FULL document (not a summary): portrait Cover + auto Executive Summary → one landscape section per selected module split into Inputs/Outputs/Schedules bands in tab order, every period table led by the universal prior-year column, `displayScale` default Millions. Builders return `TaggedItem[]`; modules + parts picked via `opts.moduleSections`. Embeds Inter full (`subset:false` is mandatory — fontkit subsetting emits a subset program Acrobat rejects). NO em-dashes. Pure (reads the snapshots, no new calc). verify-pdf-export 17/17. **Full per-builder coverage + the FAST-shading/whole-platform-coverage follow-ups (`4af1914` + `5b956a3`) are detailed in CLAUDE-ROUTES.md `generateProjectPdf.ts` entries + memory `[[project_pdf_mirror_autosync_2026-06-04]]` / `[[project_pdf_coverage_selection_2026-06-07]]`.**
- **Excel MODEL export, FULL LIVE REBUILD 2026-06-11 (commit `8983760`):** `lib/excel/{styles,buildModelWorkbook,liveModel}.ts` (ExcelJS). A SIMPLE, fully formula-linked 14-sheet three-statement + returns model, so editing any input flows to the IRR (ExportModal "Excel" -> `generateModelWorkbookBuffer`). KEY: every calc cell = `fcell(formula, result)` where `result` comes from `liveModel.ts`, a pure TS twin computing the SAME arithmetic the Excel formulas emit (opens correct, recalculates on edit, self-consistent). Kept the 5 already-live tabs (Cover/Assumptions/Timeline/Land & Area/Capex); REBUILT live: Revenue (`base × per-period profile%`, the Capex allocation pattern), Cost of Sales (`revenue × dev-cost/GDV`), Opex (`revenue × ratio` + HQ), **Financing = the engine** (depreciation, interest = `rate × opening debt`, tax, deficit-funded debt/equity drawdown + surplus cash-sweep, a clean FORWARD recurrence, NO circularity), P&L + Cash Flow (link-and-present), Balance Sheet (rolls forward, **balances by construction**, verified diff=0), Returns (NOI + terminal value + FCFF/FCFE streams + live `IRR()`/`NPV()`/MOIC, IRR seeded with the twin's value as the convergence guess), Checks. SIMPLIFIED vs the platform engine (escrow / milestone-AR / IDC-capitalisation / multi-method funding); magnitudes follow the same drivers, financing/IRR use the simplified recurrence. Verifiers: `scripts/verify-excel-export.ts` (67, structure + liveness + reconciliation) + `scripts/verify-excel-recalc.ts` (7, **HyperFormula evaluates the formula graph** to prove streams recompute cell-for-cell, NPV matches the twin, an input edit moves the output, catching wrong references that cached values hide). Shared fixture `scripts/excelSampleState.ts`. Known limits: exit-year COLUMN fixed at build (editing the offset re-prices terminal value, doesn't re-window the IRR range); not a byte-for-byte engine mirror. See memory `project_excel_full_rebuild_2026-06-11`.

**Inputs-at-top audit:** most tabs already lead with inputs (M4 BS = Working Capital + Equity Inputs; M5 = AssumptionsPanel; M1 inputs in the Inputs sub-tab; M2/M3 dedicated Inputs tabs). Only the Cash Sweep tab needed the fix (above). Redundancy: the Cash Waterfall closing == M4 CF closing == BS cash etc. are intentional cross-views / tie-outs, NOT removed (per the user's "only if it won't affect our work" gate).

**Outstanding ops (carry forward until done):**
- Migrations **152** (version change_log) + **153** (version_label / task_name / comment) are NOT yet applied to production Supabase. Apply via the dashboard SQL editor. Code is schema-tolerant so the platform runs without them, but the change_log + named-version features stay inert until applied.
- M4 follow-ups still open: financing/IDC CF residual, capex-past-handover BS gap, opening-cash seed offset (all printed by `verify-m4-reconciliation-broad.ts`), per-asset non-uniform capex spread, PIT-handover Unearned negative window.

### Project-switch state-leak (commit `ca5c152`)

A project switch could write the new project's snapshot to the previous project's `refm_project_versions` row (data corruption), leak the old store snapshot into the new id for 200-500ms (visual), and clobber `lastSavedJson` cross-project. Fix: **detach-before-hydrate everywhere** (the non-negotiable rule codified in the versioning conventions above), `await attach` before flipping `activeProjectId` (+ `isSwitchingProject` overlay), and a cross-project guard in `runAutoSave`. **Recovery convention**: `refm_project_versions` is append-only, so pre-pollution snapshots reload via VersionModal "Load"; the migration-152 change log localizes which save corrupted the data. Full root-cause detail in memory `[[project_session_2026-05-31]]`.

### Session-based versioning (commit `d25a20b`, migration 152)

Replaces the M1.6 "every keystroke creates a new auto-save version" model with a session-based one driven by user intent:

1. Project opens read-only against the most recent version (`sessionBaseVersionId`).
2. User's first edit fires `fmp:refm-session-needs-name` window event → `NameVersionModal` opens.
3. Naming the session POSTs ONE new version row pinned via `base_version_id`, and every subsequent edit PATCHes the SAME row in place (`patchVersion` endpoint at `/api/refm/projects/[id]/versions/[versionId]`).
4. Server pre-computes `change_log = diffSnapshots(base.snapshot, this.snapshot)` on every PATCH (or POST), so the history UI renders "what changed" from one column.
5. `VersionModal` history list gains a "View log" toggle per version, expanding into typed add / remove / update entries with before → after value chips.

**State machine** (`module1-sync.ts`):
```
VIEWING ──first edit──▶ WAITING_FOR_NAME
WAITING_FOR_NAME ──startEditSession──▶ EDITING
WAITING_FOR_NAME ──revertEditSession──▶ VIEWING
EDITING ──store mutation──▶ EDITING (PATCH in place)
* ──detach──▶ (detached)
```

**Architectural conventions locked**:
- **Detach-before-hydrate is non-negotiable.** Any code that mutates the Zustand store on behalf of a different project MUST call `detachSync()` first. Otherwise the prior project's autosave subscriber catches the hydrate event.
- **Session = version.** One named version row per editing session. PATCHes in place. The pre-fix "auto-save creates N versions per session" pattern is retired.
- **Auto-start on first edit, no blocking modal** (refined 2026-05-31 evening). The sync subscriber detects the first snapshot-changing edit and calls `startEditSession(defaultLabel)` automatically. UI shows a non-blocking banner with Rename + Dismiss buttons. Never lose an edit to a discarded modal.
- **Diff is server-computed against the row's base.** PATCH endpoint re-loads `existing.base_version_id` and recomputes `change_log`; it never trusts a client-supplied diff (defense against polluted history).
- **`change_log` is on the row**, not derived. Survives base-version deletion (`ON DELETE SET NULL`). Versions stay readable even if their base is gone; the diff just records the pre-deletion comparison.
- **`refm_project_versions` stays append-only.** Migration 152 adds columns but never deletes / mutates existing rows; recovery from data corruption uses the version history via VersionModal "Load".
- **All new server-side reads/writes that depend on a new column MUST ship with a schema-tolerant fallback.** Pattern: try-FULL-select-first, catch PostgreSQL error code `42703` / PostgREST `PGRST204`, retry with BASE select and synthesize the new fields. Cache the probe result module-scope (`m152Applied: boolean | undefined`) to avoid double-probing per request. Reason: project convention is "apply migrations manually via Supabase dashboard" (see CLAUDE-DB.md migrations 142-148 entries), so production schema lags repo schema for hours-to-days.
- **Reads from any potentially-large table MUST paginate** via explicit `.range(from, to)` in pages of 1000. PostgREST's default `max-rows=1000` silently truncates and the dropped rows are typically the OLDEST (DESC order) — exactly the slice users need for historical recovery. See `listVersionsPaginated` in `lib/persistence/server.ts` for the pattern.

**Files + hotfixes**: migration 152 + `snapshot-diff.ts` / `module1-sync.ts` / `server.ts` / `client.ts` / the two versions API routes + `NameVersionModal` / `VersionModal` + `verify-versioning.ts` (40/40). Post-`d25a20b` hotfixes `e2a7ba9` / `988dde5` (schema-tolerant `isMissingColumnError` via PG `42703` / PostgREST `PGRST204`) / `ff96aad` (paginated `listVersionsPaginated` + History date filter) / `7d76bf4` (auto-start on first edit + non-blocking banner). Per-file detail in CLAUDE-ROUTES.md "2026-05-31 session" + memory `[[project_session_2026-05-31]]`.


## 2026-05-25 session (M4 statements correctness + UI polish)

Two root-cause fixes closed the user-reported BS imbalance + Direct/Indirect mismatch, plus UI work. All render-layer + composer; engine schedules (the "ready" source of truth) untouched.

- **Escrow = restricted cash, not a liability** (commits `b2ddf48` + `e544267`). Escrow was a current liability while the held cash was removed from operating cash with no offsetting asset, AND the two CF methods used opposite escrow signs. Now escrow is a restricted-cash ASSET (`ProjectBS.escrowRestrictedCashPerPeriod`), Indirect CFO uses `−escrowChange` (matching Direct's `netRevAdj`). BS UI: "Restricted Cash (Escrow)" under Current Assets. BS Schedules: moved L3→A4. Zero-escrow fixtures always balanced, which hid it.
- **Residential P&L revenue uses RECOGNISED timing** (commit `f8dbfd4`). Per-asset Sell P&L summed `presalesRevenuePerPeriod` (sale-value timing) instead of `presalesRecognitionPerPeriod` (the recognition profile — the SAME field Module 2 Revenue Output renders as "Pre-Sales Recognised", `Module2RevenueOutput.tsx:1310`). PAT disagreed with the Unearned schedule, so cash methods diverged + Unearned could go negative. Fix at `financials-resolvers.ts` revRow build: `presalesRecognitionPerPeriod + postSalesRevenuePerPeriod`. M4 P&L now matches Module 2 per-asset recognition exactly (over-time / handover / custom). Verifier S pins it.
- **Both CF methods sum their OWN line items to their OWN closing cash** (commits `890ba33` + `ea3c402`). Direct closing = running sum of Direct net CF (also the BS Cash source); Indirect closing = running sum of Indirect net CF. They agree only because both are correct (not copied). Indirect now mirrors Direct's sweep + dividend adjustments + exposes Opening/Closing cash.
- **Per-line BS Reconciliation Bridge** (commit `2213615`): `snap.bsReconciliation` decomposes Δ(BS diff) = NetCF − Δ(Liab+Equity) + Δ(non-cash Assets), exact identity (`unexplained` must be ~0). Rendered on the BS tab to localize any future leak by line.
- **Universal prior-year column** (commit `8fe9ceb`): every results table leads with a prior-year column (= projectStartYear − 1); M2/M3 local `PeriodTable` + shared `VintageMatrix` auto-derive it to match M1/M4. Same commit: `VintageMatrix` header "Cohort Total" → "Total"; removed "Cum % Sold" from the Revenue 1c table.
- **AP DPO inputs moved to Opex Inputs tab** (commit `b9ea22a`): Project Default DPO + Days basis + per-asset override now on Module 3 Opex Inputs (card "💳 Accounts Payable (DPO)"); Output tab keeps only the AP roll-forward.

Verifier sections P5/P6/R/S pin: Direct==Indirect (with dividends), bridge exact identity, escrow balances, recognition == Module 2.

## Pass 2O → 2Z (2026-05-24 session) — condensed

Full per-pass detail lives in memory `[[project_m4_pass2o_through_2z]]` + git history. Summary: IDC policy split (`Project.idcConfig`, accounting/funding decoupled via `interestForAssetBasis` on `FacilityResult`) → BS Equity split (Cash / In-Kind / Existing) + RE roll-forward → IDC integrated into Fixed Assets roll-forward → Funding Gap sub-tab (`computeFundingGap`, Methods 2 + 3) → Cash Sweep + Dividend consolidated master waterfall (`computeCashWaterfall` → `CashSweepSnapshot` + `DividendSnapshot`, per-phase EBITDA cap, priority by phase.status) → Phase 1 i=0 lump rescue + per-parcel in-kind stamping (the 2026-05-24 BS-imbalance fixes; superseded as the full balance fix by the 2026-05-25 escrow + recognition root causes above). The durable conventions from that session:

**Architectural conventions (apply to all future modules):**
- **Projection rule**: phase-local `i=0` (the "Y0 lump") lands at `projIdx = Math.max(0, offset - 1)` on the project axis. Phase 1 (offset=0) goes to axis Y0; Phase 2+ goes to `offset-1` (the year before phase starts). Mirror this rule on EVERY side that consumes phase-local arrays (capex / equity / debt / inventory) so BS stays balanced.
- **Prior-year column convention** (made UNIVERSAL 2026-05-25, commit `8fe9ceb`): EVERY results table on the platform renders a prior column (= projectStartYear − 1) between Total and the first axis year, so the year axis aligns column-for-column across all modules. Module 1 (`buildResultsPeriodAxis`) + Module 4 (`m4Table.tsx` `priorYearLabel`) already did this; Module 2 (Revenue Output / CoS / Schedules / Escrow) + Module 3 (Opex Output) now match via auto-derive (`resolvedPriorYear = priorYearLabel ?? yearLabels[0] - 1`) inside each local `PeriodTable` + the shared `VintageMatrix`. Pre-axis events (existing equity, existing debt opening, pre-capex, opening NBV / Land) appear in the prior column; M2/M3 prior cells are blank (no pre-axis activity). Axis values shift right by one cell. Inline `<tr>` rendering MUST include the empty prior cell to align with the helper headers. Same commit: `VintageMatrix` row-total header default "Cohort Total" → "Total"; removed the "Cum % Sold" trailing column from the Revenue 1c table. See `[[project_universal_prior_year_column]]`.
- **In-kind equity**: stamped per parcel at the owning phase's projected i=0 axis index (Pass 2Z). Never lump at axis[0] regardless of phase.
- **IDC policy split**: accounting (capitalize) and funding (sweep mode) are independent decisions. Engine carries both via separate fields on `FacilityResult`.
- **Cash sweep + dividend waterfall**: single consolidated master view (Pass 2V). Per-phase EBITDA cap enforced on dividends (Pass 2T-Fix). Priority assigned by phase.status (Pass 2U-Fix). Cash availability above min reserve checked at each step.

**Current state (2026-05-21):**

- **Module 4 (Financial Statements)** is composing live. `computeFinancialsSnapshot` in `src/hubs/modeling/platforms/refm/lib/financials-resolvers.ts` pulls every upstream engine (revenue / opex / AP / escrow / fixed assets / financing) and produces P&L + Direct CF + Indirect CF + BS + IDC allocation. Module 4 sidebar has 4 tabs: **Schedules** (parent shell with Fixed Assets & D&A + BS Schedules sub-tabs) / **P&L** / **Cash Flow** / **Balance Sheet**. Phase filter buttons on all 4 surfaces.
- **Pass 2N-Fix series** closed every off-by-one slice + BS imbalance + AR settlement bug raised in the user audit:
  - **Debt outstanding off-by-one** (commit `cc301ed`): composer + BS Feeders + BS surface all read `fac.outstanding[t]` (length-N, year-t closing). Previous `.slice(1, 1+N)` was dropping year-0 closing and zeroing the last year. New `FacilityResult.openingBalance` exposes pre-axis balance for the BS prior column.
  - **Financing slice off-by-one across 11 sites** (commit `89fb5db`): IDC capitalised, interest expensed, capex, equity / debt draws, debt repays, interest paid — all changed to `.slice(0, N)`. Stale "+1" docstring in `financing/types.ts` updated.
  - **BS Share Capital seeded with priorEquity** (commits `89fb5db`, `035cfb3`): includes pre-axis equity opening (`priorEquity + cumulative new draws`). Equity engine's `existingEquityPerPeriod` lump removed from composer's `equityDraws` to avoid double-count through `cashFromFin → netCf → closingCash`.
  - **A1 AR + L2 Unearned literal per-asset mirrors** (commit `035cfb3`): drops SDO-inclusive billed/collected rows; each surface now shows opening + pre-sales sale value − pre-sales cash collected = closing PLUS a per-asset closing breakdown beneath. Project total = literal sum of per-asset rows.
  - **CF financing consolidated by origin** (commit `da83c06`): Existing / New buckets instead of per-tranche detail. Phase tag dropped. Prior column seeded with existing equity / debt opening / pre-capex.
  - **Cohort tail-catchup** (commit `47ab734`): cash payment profile positions past axis end (e.g. 5-year cohort with cash to year 7) used to be silently dropped, leaving AR stuck at the un-collected residual forever. Now any percentage at `position >= N` settles at the last axis year (N-1), so every cohort row sums to 100% of cohortValue and AR closes to 0. Applies to both `absolute_with_catchup` and `relative_to_sale` modes.
  - **M2 CoS Capex by stage now includes IDC** (commit `89fb5db`): per-asset IDC pulled from `finSnap.idc.byAsset`, added to `capexPerPeriod` so CoS unwinds IDC alongside base capex.
  - **CF UI polish** (commits `dece8f9`, `47ab734`): P&L + Direct CF strategy buckets show subtotal inline on dropdown header (no separate Total row). Total column +25% width. Pre-Capex row above Total Capex when historical pre-capex > 0. Finance Cost (Capitalised via IDC drawdown) memo per origin so the user sees finance cost being "paid" during construction via debt drawdown.
- **M2 Pass 9L** (commit `0e7e1d3`): Sell+Manage companion (Operate side) moves from Residential to Hospitality bucket on Revenue Inputs. Each strategy bucket now carries only inputs for that strategy; companion gets "linked to {parent}" chip.
- **M2 Pass 9L-Fix** (commit `dafa40a`): every dual-write setter (velocity / cash / recognition / occupancy) rebuilds byPhase from the full updated legacy axis instead of `paddedArray(existingByPhase, phaseLen)` + single-index assign. The previous pattern produced an empty byPhase covering the full phase window that SHADOWED legacy values entered in prior sessions, wiping historical entries the user hadn't re-typed. Hydration migration `migrateM2Pass9LBackfillByPhase` auto-repairs existing snapshots on load.
- **M2 Pass 9M + M3 Pass 5d** (commits `eea1fa6`, `18caaa0`, `7893eb8`, `b8d042e`): sticky asset quick-nav strip on every per-asset M2 / M3 / M4 surface. `AssetQuickNav` lives in `_shared/`. Click a pill → expand the parent section + smooth-scroll to the asset card with an outline pulse. Selective expand (only the target asset's section, not all).
- **Excel-style trace-to-source scaffolding** (commit `47ab734`): `M4Row.trace` field + ⤴ icon dispatches `fmp:trace-to`. `RealEstatePlatform` listens, flips active module + tab, scrolls. Foundation for wiring P&L Finance Cost → BS L4 Debt, etc.

**Open follow-ups (in priority order):**

1. **M1 Funding Methods 2 + 3** (cash-deficit driven), sized against the real CF deficit from M4. Method 1 (Total Capex) is live; 2 + 3 stay stubbed pending user testing of M4 statements first.
2. **Per-asset capex non-uniform spread** within construction windows. Project totals stay exact via the financing engine; per-asset CF / Inventory approximation is acceptable today but flagged.
3. **PIT-handover recognition economics**: point-in-time handover recognises ALL pre-sales at the handover year, including cohorts sold AFTER handover, which can make Unearned briefly negative. The statements still balance + tie (M4 mirrors Module 2 exactly); deferring later cohorts is an optional Module 2 recognition-engine tweak, not a balance issue.

> BS imbalance + Direct/Indirect mismatch: **RESOLVED 2026-05-25** (escrow restricted-cash + residential recognised-revenue root causes). BS balances by construction and both CF methods tie; the per-line Reconciliation Bridge on the BS tab localizes any future leak. See the 2026-05-25 session block at the top.

**M2 lock conventions** (apply to M3 + M4 unless overridden):
- The reference Excel at repo root is the verification benchmark, not a behavioural spec. Every reference-specific behaviour stays configurable; never hard-code currency, locale, escrow, or DSO defaults into engine paths.
- Engine storage today is HYBRID per [[project_m4_pass2h_period_data_fix]]: asset-scoped per-period fields are PHASE-LOCAL (`ByPhase: number[]`, `arr[0]` = first year of owning phase); HQ + financing year-keyed (`ByYear: Record<string, number>`). Legacy axis-indexed `number[]` fields remain on schema but marked `@deprecated` and zeroed by hydration migrations.
- Vintage matrices (cohort year × cash year, cohort year × recognition year, capex year × CoS year) are the canonical mechanic for both recognition and cash distribution.
- PIT recognition handover = LAST construction year (`phaseStart + cp − 1 − projectStart`), NOT first operations year. Verifier A2-1..A2-5 pin this.
- INPUTS group by strategy bucket; OUTPUTS group by phase. Inputs flat by asset list, phase shown as a small tag per card.
- Every UI setter writing to a phase-local array MUST prune out-of-window indices on save. Pattern: pass `validPhaseIndices: Set<number>` into the write helper.
- See [[project_audit_2026-05-20]] for the full current state.

<!-- LOCKED-module pass narrative collapsed 2026-06-15. The escrow + fixed-assets/
     depreciation engine mechanics below are preserved in full in CLAUDE-ROUTES.md
     (escrow.ts / depreciation/ / fixed-assets-resolvers lib entries) + the cited
     memory files; this is the one-line index. -->

**M2 Escrow engine (Pass 9h/9h-1..3, LOCKED, commits `87f0075` → `7ab3019`):** per-project/per-asset configurable `computeEscrow` (`held[t]=preSalesCash×heldPct`, release lump on the release year, balance rolls to zero; heldPct=0 disables). Schema `Project.escrow?` + `Asset.revenue.sell.escrow?` (override > default > handover+1). `Module2Escrow.tsx` 5th sub-tab; verify-escrow 46/46. Detail: `[[project_m2_pass9h_escrow]]` / `[[project_m2_pass9h1_escrow_simplified]]` + ROUTES escrow.ts.

**M4 Fixed Assets + Depreciation engine (Pass 1/1c/1d, LOCKED, commits `1b5e9b9` → `26c221b`):** `src/core/calculations/depreciation/` — SL + Reducing Balance allocators (RB default rate `2/life`), per-addition vintage roll-forward from `max(t,startIdx)`, residual stays as NBV at exit. Resolver `computeAllFixedAssetResults` walks Operate/Lease/companion assets only (Sell capex flows through M2 CoS); Land split out as non-depreciable (life=0); capex projection mirrors `aggregateProjectCapex`. Asset schema `depreciationMethod`/`depreciationRate` (optional). verify-fixed-assets 82/82. Reference-benchmark methodology (10-component v7.0 block) in `[[reference_v7_depreciation]]`; decisions in `[[project_m4_pass1_decisions]]`.

**Module 3 status (Opex, LOCKED Pass 5d):** `src/core/calculations/opex/` — per-asset `computeAssetOpex` + project-wide `computeHQOpex`, two-pass (Pass A non-GOP lines, Pass B GOP = Revenue − Direct − Indirect → `pct_of_gop`). **Durable rule: inflation applies ONLY to fixed-cost modes** (`fixed_baseline` / `per_room_year` / `per_sqm_year`); %-of-revenue + `pct_of_gop` lines auto-escalate via the stream (engine zeroes their indexation). Asset/HQ `defaultIndexation` + per-line `useAssetDefault` override; `rateMode: 'single' | 'yoy'` (+ `yoyRates[]`) bypasses inflation. Applies to Hospitality/Operate (incl. companions) + Retail/Lease only (Sell parents + pure Sell have no opex). verify-opex 38/38. Full line-mode / category / seed / UI detail in CLAUDE-ROUTES.md opex/ entry + memory `[[project_m3_pass3_decisions]]` / `[[project_m3_pass5b_decisions]]`.

**Phase startDate cascade** (commit `50a4c89`): NOTE this cascade was later DISABLED (2026-05-20, commit `b209afe`, memory `[[project_phase_date_cascade_disabled]]`) — `updatePhase` no longer shifts asset arrays, user inputs are preserved verbatim, and storage is now the HYBRID phase-local / year-keyed model (see the M2 lock conventions above). The original sliding-array cascade is retained in git history only.

**Module 2 final state (LOCKED Pass 9N):** Revenue engines Residential Sell / Hospitality (Operate + Sell+Manage companions) / Retail-Lease; PIT recognition handover / sale_year / custom; CoS `costOfSalesV2` joint-cumulative (Drivers → Vintage Matrix → Summary → Inventory roll-forward); shared `VintageMatrix` (Cash + Recognition + CoS); rental-pool enrollment toggle (auto-link vs Day-1); Schedules tab = raw line-item FS feed (zero rows hidden). Retired Phase Overlap → per-asset `operationsStartYearOverride`; "3. Costs" → "3. Capex". Snap-to-zero |x|<1000. Pass detail in memory `[[project_m2_pass7_decisions]]` / `[[project_m2_pass9i_9j_9k]]` / `[[project_m2_pass9L_byphase_shadow]]`.

**Engine conventions (carry into M3):**
- Pre-sales: revenue lumps at sale year; cash via payment profile; recognition via recognition profile (or PIT anchor).
- Post-sales (SDO): revenue = cash = recognition in same period.
- Hospitality + Lease: revenue = cash = recognition same period; AR delay via DSO engine.
- Project axis: `arr[0]` = first active project year.
- YoY rounding (units or sqm) before revenue computation.
- Sale value drives AR + UR (gross credit); cash drains AR; recognition drains UR.
- AR/UR signatures: `buildAccountsReceivable(saleValue, cash, N)`, `buildUnearnedRevenue(recognition, saleValue, N)`.

---

<!-- Per-pass narrative archived (2026-05-20). M1 M2.0 phase history
     (Passes 11-58 inc. 2026-05-12 diagnostic blocks + M2.0 Pass 56-58
     lock-in), M2 Pass 1-7 build narrative, and M2.0 Passes 11-55 themes
     are in CLAUDE-FEATURES.md "Module 1 (REFM) M2.0 Phase History".
     See git history for raw per-pass commit detail. -->

> **See also:**
> - [CLAUDE.md](CLAUDE.md), Root project brief, session rules, stack, auth, envs
> - [CLAUDE-MODELING-HUB.md](CLAUDE-MODELING-HUB.md), Modeling Hub platform catalog + P-Sync conventions
> - [CLAUDE-FEATURES.md](CLAUDE-FEATURES.md), Archived Module 1 phase narratives (M1.R → M1.13d pre-M2.0, M2.0 → M2.0i post-rebuild)
> - [CLAUDE-DB.md](CLAUDE-DB.md), Database tables, migrations log
> - [CLAUDE-ROUTES.md](CLAUDE-ROUTES.md), Routes + components + lib structure

---

## REFM Design System

REFM (Module 1 tabs + shell + modals + Area Program tab) uses **FAST input blue** instead of `.input-assumption`:
- Input bg: `var(--color-navy-pale)` + text: `var(--color-navy)` via the local `inputStyle` constant in each component
- Calculated outputs use `calcOutputStyle`: `var(--color-grey-pale)` bg + `var(--color-heading)` text
- Established Phases 4.6 → 4.15 (2026-04-30), extended into M1.7 Area Program tab (2026-05-02)
- The `.input-assumption` class is reserved for actual financial-model assumption cells (rates, ratios, escalators) and continues to apply outside REFM

---

## REFM Verifier Scripts

Active engine + composer coverage (run all on every meaningful change). **25 scripts, full suite green 2026-06-02.** Per-script counts grow as sections are added, so run a script for its live total rather than trusting a hard-coded number here. Run the whole suite with `for f in scripts/verify-*.ts; do npx tsx "$f"; done` (PowerShell: `Get-ChildItem scripts/verify-*.ts | % { npx tsx $_.FullName }`).

```bash
# M2 / M3 / M4 / M5 + financing (current daily loop)
npx tsx scripts/verify-revenue-rebuild.ts         # M2 Sell + Hospitality + Lease + AR + UR
npx tsx scripts/verify-escrow.ts                  # M2 Pass 9h escrow + cleanup
npx tsx scripts/verify-cost-of-sales-v2.ts        # M2 Pass 9e + 9N cohort tail-catchup
npx tsx scripts/verify-opex.ts                    # M3 asset + HQ opex engine
npx tsx scripts/verify-opex-ap.ts                 # M4 Pass 2a Accounts Payable
npx tsx scripts/verify-fixed-assets.ts            # M4 Pass 1 depreciation
npx tsx scripts/verify-idc-depreciation.ts        # M4 IDC -> D&A + annuity amortization (§K)
npx tsx scripts/verify-asset-cost-allocation.ts   # M1 computeAssetCost allocation
npx tsx scripts/verify-m4-bs-reconciliation.ts    # M4 BS identities + debt/share-cap
npx tsx scripts/verify-m4-reconciliation-broad.ts # M4 Direct==Indirect + BS bridge (broad guard)
npx tsx scripts/verify-bs-hq-ap-link.ts           # BS HQ-AP link (cf6200d drift guard)
npx tsx scripts/verify-funding-methods.ts         # Methods 2/3 gap-sizing + conditional IDC + sweep + fixed-point [CONV]
npx tsx scripts/verify-returns-engine.ts          # M5 pure IRR/MOIC/payback/TV/RE-metrics/analytics + Pass 2 partners/sensitivity (101)
npx tsx scripts/verify-returns-snapshot.ts        # M5 stream build-up + sponsor-IRR + sources/uses + Pass 2 partners/exit-year/per-asset/sensitivity (81)
npx tsx scripts/verify-phase-date-preservation.ts # M4 Pass 2h hybrid storage
npx tsx scripts/verify-phase-date-scenarios.ts    # M2/M3 setter dual-write + 9L-Fix
npx tsx scripts/verify-versioning.ts              # session versioning + change_log
npx tsx scripts/verify-version-naming.ts          # auto version names + rollover
npx tsx scripts/verify-pdf-export.ts              # full-project PDF export smoke test (pdf-lib)
npx tsx scripts/verify-cases.ts                   # scenario/case merge engine (applyOverrides/buildOverrides/seed) 19/19

# Module 1 historical (LOCKED; run only when touching M1 code)
npx tsx scripts/verify-tab3-regression-2.ts       # Tab 3 regressions
npx tsx scripts/verify-tab2-pass3.ts              # Tab 2 quick fixes
npx tsx scripts/verify-m20costsCleanup-pass10.ts  # M2.0 Pass 10 Costs cleanup
npx tsx scripts/verify-m20M.ts                    # M2.0M Financing rewrite
# Older scripts/verify-m20*.ts remain runnable; not part of the daily loop.

# Playwright e2e
npx playwright test tests/e2e/m20L-costs-financing.spec.ts  # 10 specs + dark-mode
```

### Per-phase verification workflow (M1.7+)
Standing preference (2026-05-02): every REFM phase ships a `scripts/verify-[phaseId].ts` covering 5 sections:
1. **Database / persistence**: Supabase JSONB roundtrip via service-role
2. **Route smoke tests**: 401-without-auth gates; skips when `localhost:3000` is down
3. **Calculation correctness**: snapshot diffs + targeted assertions on fixture inputs
4. **State integrity**: load fixture into store, mutate via store actions, assert cascade
5. **UI rendering**: Playwright headless light + dark screenshots saved to `tests/screenshots/[phase]/{light,dark}-*.png`; skips when dev server is down or Playwright not installed

Test-user fixture id `00000000-0000-0000-0000-000000000000` with `ON DELETE CASCADE` cleans downstream rows on teardown. M1.7 reference: 25 pass / 0 fail / 2 skip without dev server.

**Dev dependencies**: `@playwright/test ^1.59.1` + chromium browser (`npx playwright install chromium`).

---

## Module 1 Conventions (v8 + M2.0L contract, applies to all downstream modules)

> Single source of truth for Module 1 patterns and downstream-module obligations. Replaces the per-phase "pattern decisions" sections that ran M2.0 → M2.0L. Archived per-phase narrative lives in CLAUDE-FEATURES.md under "Module 1 (REFM) M2.0 Phase History".

**Schema + migrations**
- **Hard-cut on every schema bump.** Pre-vN snapshots flag with explicit error rather than silent coercion. v3/v4 → v5, v5 → v6, v6 → v7, v7 → v8 all follow this policy. Non-version-bumping additive fields (M2.0f, M2.0h, M2.0i, M2.0j, M2.0L) default off/undefined for legacy snapshots.
- **Phase-scoped cost line ids (M2.0L).** Standard catalog ids compose as `${baseId}__${phaseId}` to keep them globally unique across multi-phase projects. Use `composeLineId` / `deriveLineBaseId` / `isStandardCostLineBaseId` from `module1-types.ts`. Calc engine helpers that key by line id (e.g., `deriveCostStage`, `selectedLineIds` resolution) strip the suffix before lookup. Custom user lines (`custom-${timestamp}`) are already unique. `migrateM20lDedupeCostLineIds` retrofits legacy duplicate-id snapshots on hydrate.
- **Migration banner pattern.** `CheckedHydration.migrationNotice` → `AttachResult.migrationNotice` → dismissable banner once per project open. Migration helper kicks an immediate save so banner doesn't reappear.
- **Snapshot baseline: ONE file per major schema version** at `scripts/baselines/module1-v5.json` (now v8 content, name retained).

**Timing**
- **Phase.startDate is authoritative.** Tab 1 + Tab 2 read `computePhaseTimeline(phase, project)`. M5 Statements + M3 Cashflow consume same helper for column dates.
- **`constructionPeriods === 0` is canonical for operational phases.** computePhaseTimeline returns `operationsStart === phase.startDate` when cp=0. Asset.status='operational' on cp=0 phases gets historical baseline treatment.
- **End-of-period dates everywhere.** Use `periodEndDate`; never display "Jan 1 of next year" as period end.
- **`ProjectTimeline.endYear` is inclusive.** No +1 offset in display layers.
- **Period dates align to PHASE start.** Cost / revenue / opex / financing schedules all measure from `phase.startDate`. Project-wide rollup tables offset by `(phaseStartYear - projectStartYear)` to place phase Y1 in project Y2 / Y3 correctly.

**Status + lifecycle**
- **Phase + Asset status drives lifecycle treatment.** `'planning' / 'construction' / 'operational'`. Operational reveals `historicalBaseline` (sunk capex / equity / debt / accumulated dep / trailing revenue + opex). M5 reads `computePhaseHistorical(phase)` for opening balances + `computeOperationalRunRate(baseline, period)` for rollforward.
- **Status pill colors:** planned = grey, construction = warm amber, operational = green-success. M5 + M3 reuse same scale.
- **Asset.type is optional.** Treat `''` as unspecified. Useful Life falls back to category default (`DEFAULT_USEFUL_LIFE_YEARS`: residential 30 / hospitality 20 / retail 25 / default 25).

**Inputs + outputs**
- **Inputs are annual; outputs flex.** No user-visible "model granularity" toggle. Every Module 1 input is annual. Display uses `distributeAnnualToPeriods(annualValues, granularity, phasing)` with sum-integrity guarantee. M2.1 / M3 / M5 adopt same convention.
- **`project.outputGranularity` is the project-wide view setting.** Tab 3 / Tab 4 / future M5 all read it.
- **Phasing is Even + Manual % only.** Read-side accepts legacy `frontloaded` / `backloaded` / `sCurve` / `phase_aligned` via `migrateM20jPhasing`. Manual % UX: per-period inputs + sum indicator + auto-normalize button.

**Display + formatting**
- **Project-scoped formatting.** `project.displayScale` (full/thousands/millions) + `project.displayDecimals` (0..3). Use `formatScaled(num, scale, decimals)` or `makeProjectFormatter(project)`. Cells render pure numbers (no currency suffix).
- **Currency lives in the per-tab header line** via `currencyHeaderLine(currency, scale)` → "All figures in SAR" / "...SAR '000" / "...SAR M".
- **Percentages always 2 decimals** via `formatPercent` default. **Areas (sqm) use `formatArea`** (no scale conversion). **Integer counts bypass scale via `formatInteger`**.
- **MANDATORY platform-wide input primitives** (applies to every Module - 1, 2, 3, 4, 5+):
  - **Every money / currency / area / count input MUST use `AccountingNumberInput`.** Raw `<input type="number">` on focus + accounting-formatted text on blur (commas, parens for negatives, `-` for zero with `blankWhenZero` option, currency suffix never). Parser handles commas + wrapping parens.
  - **Every percent input MUST use `PercentageInput`.** Default 2 decimals + `%` suffix + parens for negatives + `0.00%` for zero (percentages never collapse to a dash). Value prop is in percent units (0-100), onChange returns the same. Parser strips commas + trailing `%` + wrapping parens. Storage convention: when the underlying engine stores 0-1, multiply by 100 for `value` and the setter divides back.
  - **Never use bare `<input type="number">` for money/percent in new code.** Bare inputs lose the formatting + parsing contract and break the platform's visual consistency. Audit existing surfaces during feature work and migrate.
  - Examples: M1 Tab 4 financing inputs (Pass 42), M2 Pass 7 velocity grids + cash/recognition profile strips migrated 2026-05-16.

**Area hierarchy**
- **Three-tier hierarchy: NSA ⊂ BUA ⊂ GFA.** NSA = revenue sub-units (Sellable + Operable + Leasable); BUA = NSA + Support (sub-unit + asset-level); GFA = BUA + Parking (asset-level). Consume `computeAssetAreaHierarchy(asset, subUnits)`; never re-derive from `Asset.buaSqm` directly.
- **Sub-unit BUA is source of truth.** `computeAssetBua` / `computeAssetSellableBua` fall back to `asset.buaSqm` only when sub-units are empty.
- **SubUnitMetric is `'units' | 'area'`.** Legacy `'count'` accepted on read. Use `switchMetric()` to preserve area sqm on toggle.
- **Parking is sqm-only at the cost-engine level.** No parkingBays input. Parking-bay-driven revenue (fee/bay/year) models as a Leasable sub-unit.

**Land**
- **Multi-parcel landAllocation.** Asset gains `landAllocation: { parcelId?, sqm?, pct?, multiParcelSplits?, customRate? }`. Sentinels: `PARCEL_WEIGHTED_AVG`, `PARCEL_CUSTOM_RATE`. M2.1 reads `Asset.landAllocation` for per-parcel disposition.
- **Parcel NDA is parcel-level.** Each parcel carries `hasNdaDeduction` + `roadsPct` + `parksPct`. Land allocation references NDA (not gross area); full parcel cost flows to assets at inflated effective NDA rate.
- **Reconciliation is compact-by-default.** Collapsed summary line with status icon (✓/✗/⚠) + expand affordance + auto-expand on mismatch + localStorage persistence. Pattern applies to land reconciliation, asset area reconciliation, and future revenue/debt/capex reconciliations.

**Cost engine**
- **Direct vs Allocated category (M2.0L Pass 5).** Every `CostLine` carries `costCategory?: 'direct' | 'allocated'` (default `direct`). Direct = asset-specific (current Pass 3+ math: `rate × asset.metric`, `allocFactor = 1` except for method='fixed'). Allocated = project-wide pool, split per asset via `costDriver` (`bua_share` / `land_share` / `value_share`). Calc engine computes Allocated lines against `aggregatePhaseMetrics(phaseAssets, metricsByAsset)` to get the pool, then `resolveDriverFactor(driver, asset, ...)` distributes per asset. `value_share` currently falls back to `bua_share` (deferred until M2.1 Revenue ships projected per-asset value). Auto-derived `CostType` (`hard` / `soft` / `land_cash` / `land_in_kind` / `operating`) via `deriveCostType(line)` is internal-only, not user-visible.
- **Parent/child inheritance is the canonical Costs UX (M2.0L Pass 4).** One editable master cost line table per phase (`CostLine[]` with `targetAssetId === undefined`) + per-asset resolved replicas below. Each replica row carries a Source pill (Inherited/Override) + an Override toggle button. **NOTE Pass 7 (2026-05-12) deprecated this surface**: Tab 3 Inputs is now per-asset only; CostOverride[] flattened on hydrate.
- **CostOverride resolution:** `override.overridden === false` reverts to master entirely. `override.overridden !== false` (true OR legacy undefined treated as true) uses override fields with master fallback per field. Same rule for the migration banner: legacy CostOverride entries stamp `overridden=true` on hydrate via `migrateM20Pass4Inheritance`.
- **`Project.costInputMode` is deprecated.** Stripped on hydrate. The Same vs Individual mode UX is gone; the inheritance surface always renders both views.
- **Capex Excl Land In-Kind is the cash-impact schedule** that feeds the Financing module's drawdown curve for debt sizing + equity funding requirement. Results Table 3 in Tab 3. Land In-Kind is non-cash equity (Tab 4 In-Kind Equity tile, never on Cash Flow Statement); Total Capex Incl Land Value (Results Table 2) is the basis for Fixed Assets / Inventory book value in M5.
- **Capex capitalisation rule.** Every cost line capitalises into asset basis. `classifyAssetCapex(asset, capexBasis, landTotal)` routes to `{ COGS, FixedAssets, Depreciation }` per strategy. Land never depreciates.
- **Land in-kind treatment.** `computeCashFlowImpact(capexBasis, landInKindPortion)` returns `{ cashOutflow, equityInKind }`. M3 Cashflow consumes directly.
- **`CostLine` is open-ended `id: string`.** Custom + seed lines coexist; `isLocked` protects seed rows. `STANDARD_COST_LINE_IDS` exports the 9-line standard catalog. `deriveCostStage(line)` returns stage by stable id; custom lines fall back to `line.stage`.
- **Per-sub-unit custom rates** is the pattern for granular cost differentiation. `CostMethod = 'per_sub_unit_custom_rates'` + `CostLine.perSubUnitRates` keyed on sub-unit id with reserved keys `'__support__'` / `'__parking__'`. M2.1 can mirror with `RevenueLine.perSubUnitRates`.
- **Cost line caption pattern.** Inline caption under value cell showing `rate × metric = total`. M2.1 follows with `revenueLineCaption`.

**Strategy + revenue obligations (for M2.1)**
- **Sell / Operate / Lease / Sell + Manage.** Short labels with `STRATEGY_TOOLTIPS` map for longform hover.
- **Sub-unit category + metric drive Rate Unit** (Sellable+units = per unit, Operable+units = per room/night, Leasable+area = per sqm/year, etc.). M2.1 wires each combination to its revenue stream.
- **Sell + Manage** drives recurring management fee revenue via `Asset.managementAgreement` (managementFeePct × operating revenue over agreementDurationPeriods, starting at agreementStartPeriod or handover).
- **Asset.status gates revenue:** planned = no revenue, construction = pre-sale only (Sell + Sell+Manage), operational = full revenue per strategy.

**Layout + UX**
- **Sticky sidebar.** Outer wrapper `height: 100vh; overflow: hidden`; scrollable `<main>`. Standard for any module shell.
- **Sub-tab Inputs / Results pattern** is canonical for editable + read-only views. M2.1 + M3 follow.
- **Per-asset selector + 3 summary cards** is canonical Inputs layout. Asset selector bar + per-asset section + 3 summary cards.
- **Hide zero rows in Results.** Filter `total=0` rows from display; keep in Inputs.
- **Granularity toggle remounts via key.** `key={`summary-${granularity}`}` to avoid stale state.
- **Summary table column convention:** [Description] [Total] [Period/Stage/Type cols...] so totals visible without scrolling right.

**Catalogs**
- **Project type catalog is additive.** 14 project types with `ASSET_TYPES_BY_PROJECT_TYPE` filter for Tab 2 Type dropdown. `SUGGESTED_CATEGORIES_BY_PROJECT_TYPE` provides empty-state nudges; never auto-creates assets.

---

## Module 1 archived phase history (M2.0 → M2.0j)

Full closure narrative for each phase below lives in **CLAUDE-FEATURES.md** under "Module 1 (REFM) M2.0 Phase History (M2.0 → M2.0j, archived 2026-05-11)". One-line index here for quick recall:

- **M2.0j** (2026-05-07), 16 audit + display + structural fixes (cp=0, Asset.type optional, Land Parcel rate header, Display Scale export comment, Display Scale + Decimals on Land Parcel, sub-unit area/units bidirectional sync, accounting format on blur, cost line caption per method, phasing simplified to Even+Manual, period dates align to phase start, Capex by Period audit + granularity remount, hide zero rows, drop stage labels, drop 3 summary tables, asset selector + 3 summary cards). `verify-m20j.ts` + `m20j-costs-audit.spec.ts`. Superseded by M2.0L which fixed the cost line duplication bug it introduced.
- **M2.0i** (2026-05-07), final polish (10 fixes): Display Settings panel, drop Model Granularity input + Parking Bays, sub-unit Units/Area, Strategy short labels, compact reconciliation, Operational phase Historical Baseline. `verify-m20i.ts` + `m20i-final-polish.spec.ts`.
- **M2.0h** (2026-05-07), area hierarchy + cost granularity (6 fixes + v7→v8 migration banner): NSA/BUA/GFA tiers, parcel NDA toggle, per-sub-unit custom rates, runtime granularity toggle, currency header line. `verify-m20h.ts` + `m20h-area-hierarchy-cost-granularity.spec.ts`.
- **M2.0g** (2026-05-06), display + reconciliation + Costs restructure (v7→v8 schema bump): annual-only inputs, displayScale, end-of-period dates, asset Support/Parking, land reconciliation, sub-tabs Inputs/Results, 4 summary tables, Manual % phasing restore. `verify-m20g.ts` + `m20g-display-recon-costs.spec.ts`.
- **M2.0f** (2026-05-06), structural fixes (6 fixes): 14 project types, Phase Start Date column, multi-parcel landAllocation, sub-unit BUA source of truth, Parking sub-unit. `verify-m20f.ts` + `m20f-structural-fixes.spec.ts`.
- **M2.0e** (2026-05-06), wizard simplification + Tab 2 canonical entry: per-phase asset sections, Sell+Manage / UsefulLife sub-forms, Status pill, computePhaseTimeline. `verify-m20e.ts` + `m20e-wizard-tab2.spec.ts`.
- **M2.0d** (2026-05-06), Costs polish + v7 schema: Sell+Manage rename, per-asset cost segregation, classifyAssetCapex, computeCashFlowImpact, 3 summary tables, Tab 4 In-Kind Equity tile. `verify-m20d.ts` + `m20d-costs-polish.spec.ts`.
- **M2.0c** (2026-05-06), Dev Costs + Financing restore on v6: 13 cost methods, 5×5 financing matrix, IDC capitalization, per-tranche schedules. `verify-m20c.ts` + `m20c-costs-financing.spec.ts` (skipped, frozen).
- **M2.0b** (2026-05-06), brand-styled shell on v5: Topbar + Sidebar + Dashboard + Modals restored, dark-mode toggle, playwright.config.ts baseURL. `verify-m20b.ts` + `m20b-shell.spec.ts`.
- **M2.0** (2026-05-06), v5 hard-cut rebuild: flat Project → Phase → Asset → SubUnit hierarchy, 4 tabs, 9 fixed cost lines, 5×3 financing matrix, 30.8 KB v5 baseline. `verify-m20.ts` + `m20-full-flow.spec.ts`.

---

## Module 1 phase history (M1.R through M1.13d, pre-M2.0)

M2.0 (2026-05-06) hard-cut Module 1 to the v5 schema, replacing the v3 / v4 hierarchy (Master Holding / Sub-Project / Plot / Zone / FAR / Cascade / Parking Allocator). The pre-M2.0 narrative (M1.R → M1.5 → M1.5b → M1.6 → M1.7 → M1.8 → M1.9 → M1.9b → M1.10 → M1.10b → M1.11 → M1.12 → M1.13 → M1.13b → M1.13c → M1.13d) plus M1.8 wizard hotfix series and the legacy 3-baseline snapshot diff pattern lives in **CLAUDE-FEATURES.md** under "Module 1 (REFM) Phase History (frozen pre-M2.0)". Read it only if you are excavating an old commit or a deferred-from-M1 issue resurfaces; current work happens against M2.0 Pass 9 on v8.
