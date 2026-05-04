# Module 1 Holistic Re-Audit (Phase M1.11)

**Date:** 2026-05-06
**Author:** Claude Code (Opus 4.7), audit synthesis from 4 parallel Explore agents
**Goal:** Identify every issue blocking Module 1 from being a "this is what I want" first-time experience, before a single coordinated fix pass takes Module 1 to production-ready.
**Status:** AUDIT (not yet executed). Awaiting Ahmad approval of fix priorities.

---

## 1. Executive summary

The audit covered all 7 areas requested in the brief: data flow integrity, UX coherence per tab, the Project Timeline Visual, Land vs Build Program redundancy, calculation correctness on a Mixed-Use Test Case, the first-time user flow walkthrough, and a regression check on M1.5b through M1.10b.

**Issues found: 22 total.**
- **Critical (blocks or confuses first-time users): 4**
- **Major (degraded UX, workable but not "wow"): 8**
- **Minor (polish, label drift, edge cases): 6**
- **Out of scope (calc-touching, deferred to M2.0+): 4**

**Regression check: 19 of 19 prior fixes (M1.5b through M1.10b) PASS.** No phase has silently undone a prior phase. The architectural foundation is stable.

**Headline findings:**
1. The wizard captures a Status field (Draft / Active) that never reaches the store. Pure data loss.
2. ProjectWizard is the only modal that does NOT use createPortal. Plot and Parcel wizards do, after the M1.10b fix. ProjectWizard remains a latent containing-block bug.
3. The Project Timeline Visual on Schedule renders period bars without surfacing the four key date boundaries (Construction End, Operations Start, Overlap Start, Overlap End) and has no multi-phase awareness.
4. Em-dash usage is widespread (2,221 occurrences across 250 files). The new writing rule requires a sweep.
5. Module1Area and Module1Timeline interfaces still accept setters (residentialPercent, hospitalityPercent, retailPercent, plus deduct and efficiency variants, plus project identity setters) that the components no longer wire to any UI. Dead props that mislead maintainers.
6. The asset Revenue Strategy (Sell / Lease / Operate) is editable only on the Hierarchy nested editor, not on the Build Program asset card where the rest of per-asset configuration lives. New users may never set strategy and silently produce wrong revenue.

**Recommendation:** A focused 14 to 17 commit fix pass, grouped by area (Schedule, Land, Build Program, Dev Costs, Financing, Wizards, Em-dash sweep, Verifier and Playwright). Snapshot diffs stay bit-identical. No calc engine changes (those 4 items defer to M2.0).

---

## 2. Issue catalog

Each issue is tagged with: tab or area, current behavior, expected behavior, fix path, estimated commits.

### 2.1 CRITICAL (4)

#### C1: ProjectWizard "Status" field silently dropped on Create

- **Area:** ProjectWizard step 1, buildWizardSnapshot
- **Current behavior:** Wizard step 1 asks the user to pick Draft or Active (radio at `ProjectWizard.tsx:92`). `step1Valid` validates it. On Create, `buildWizardSnapshot` (`buildWizardSnapshot.ts:120-249`) never writes `status` to the snapshot. The `Module1Store` and `HydrateSnapshot` types do not have a status field. The user's choice is discarded.
- **Expected behavior:** Either (a) status reaches the store and persists across sessions, or (b) the radio is removed if it serves no model purpose.
- **Fix path:** Recommend (a). Add `projectStatus: 'Draft' | 'Active'` to `Module1Store`, `HydrateSnapshot`, and the persistence schema. Default to `'Draft'`. `buildWizardSnapshot` writes `status` from the wizard draft. Refm_projects table likely already has a `status` column (used by ProjectsScreen filters), so this may be a wiring fix rather than a schema add. Confirm before deciding.
- **Estimated commits:** 1.

#### C2: ProjectWizard does not use createPortal

- **Area:** ProjectWizard modal mounting
- **Current behavior:** ProjectWizard renders `.pm-modal-overlay` and `.pm-modal` directly inside its parent component tree (`ProjectWizard.tsx:349-444`). The fixed-positioning relies on no ancestor creating a containing block (no `transform`, `will-change`, `filter`, etc.). PlotSetupWizard and ParcelSetupWizard both portal to `document.body` after the M1.10b/1 fix; ProjectWizard is the outlier.
- **Expected behavior:** ProjectWizard portals to `document.body` with the same SSR guard pattern (`if (typeof document === 'undefined') return null`). z-index 9999 to match.
- **Fix path:** Wrap the JSX return in `createPortal(jsx, document.body)`. Mirror the M1.10b/1 commit pattern.
- **Estimated commits:** 1.

#### C3: Project Timeline Visual missing semantic date boundaries and multi-phase support

- **Area:** Schedule tab, Module1Timeline visual
- **Current behavior:** `Module1Timeline.tsx:268-303` renders a horizontal flex bar with three colored sections (Construction navy, Overlap gradient, Operations green) sized proportional to period counts. Below the bar, only Project Start and Project End render as plain text. The four other key dates (Construction End, Operations Start, Overlap Start, Overlap End) are not labeled. Multi-phase: not aware. The visual reads project-level period scalars only; per-phase overrides set inside the nested Hierarchy structure card never reach the visual.
- **Expected behavior:** Visual labels all 5 boundary dates inline. Multi-phase: render one bar per phase, vertically stacked with phase name on the left. Annual vs monthly: tick labels at appropriate granularity (monthly: every quarter, annual: every year).
- **Fix path:** Promote the visual to a small dedicated component. Compute 5 boundary dates from `projectStart` plus period offsets. Render per-phase if `phases.length > 1`. Add tick labels.
- **Estimated commits:** 1 to 2 (one for the visual rebuild, optionally one for multi-phase if it doubles diff size).

#### C4: Em-dash usage (writing rule sweep)

- **Area:** Codebase-wide
- **Current behavior:** 2,221 em-dash characters (U+2014) across 250 files. Hot paths (user-facing JSX text, tooltips, labels): around 320 occurrences. Code comments: around 380. Documentation markdown: around 480. Verification scripts: around 140. The rest in CSS, SQL, configs.
- **Top 10 files by count:** `js/refm-platform.js` (242, legacy non-React), `CLAUDE-TODO.md` (164), `CLAUDE-FEATURES.md` (94), `PROJECT_HANDOFF.md` (82), `CLAUDE-ROUTES.md` (77), `CLAUDE-DB.md` (31), `CMS_REFERENCE.md` (63), `Module1Hierarchy.tsx` (33), `ProjectWizard.tsx` (25), `Module1AreaProgram.tsx` (24).
- **Expected behavior:** Zero em-dashes anywhere. Replace with commas, colons, parens, or "and/or" depending on intent. The new writing rule lives in CLAUDE.md (added in this audit commit).
- **Fix path:** Three-pass sweep, in priority order:
  1. Hot-path JSX in `src/hubs/modeling/platforms/refm/` (the user-visible Module 1 surface).
  2. Code comments and docstrings across `src/`.
  3. Documentation markdown (CLAUDE.md, CLAUDE-FEATURES.md, etc.).
  Legacy file `js/refm-platform.js` is dead code (pre-React, replaced by the components/ tree). Recommend NOT sweeping; either delete the file or carve it out as legacy with a one-line note. Verification scripts: leave the docstring em-dashes alone in this audit pass; the code paths inside them do not surface to users. Sweep them when touched naturally.
- **Estimated commits:** 3 (hot-path, code comments, docs).

### 2.2 MAJOR (8)

#### M1: Dead setters on Module1Area and Module1Timeline interfaces

- **Area:** Module1Area.tsx, Module1Timeline.tsx, RealEstatePlatform.tsx
- **Current behavior:** Module1Area accepts `setResidentialPercent`, `setHospitalityPercent`, `setRetailPercent`, plus deduct and efficiency setters as props (lines 14-22). The component never calls any of them. M1.9 stripped the input UI but kept the prop wiring under eslint-disable. Module1Timeline accepts `projectName`, `projectType`, `country`, `currency` setters with the same dead-prop pattern (lines 33-40). RealEstatePlatform passes both sets (lines 1731-1734, 1751-1758).
- **Expected behavior:** Props interfaces match what the component actually uses. Dead setters removed.
- **Fix path:** Remove the dead setter declarations from both Props interfaces. Remove the matching bindings in RealEstatePlatform's call sites. Add a one-line comment in each component explaining why identity / asset-mix lives elsewhere (Hierarchy nested editor for asset mix, ProjectWizard plus Hierarchy for identity).
- **Estimated commits:** 1.

#### M2: Asset Revenue Strategy not editable on Build Program asset card

- **Area:** Build Program tab, Asset card UI
- **Current behavior:** `AssetClass.primaryStrategy`, `secondaryStrategy`, `secondaryStrategyPct` are model fields driving revenue computation (`module1-types.ts:166-169`). They are editable only in the Module1Hierarchy nested editor (`sections="assets"` mode). The Build Program tab's asset card surfaces area cascade (deductPct, efficiencyPct, mep%, backOfHouse%) and plot binding, but not strategy. New users completing Build Program may never set strategy, silently leaving it at `DEFAULT_STRATEGY_BY_CATEGORY`. For a Mixed-Use project that's correct by accident; for any custom mix it produces wrong revenue downstream.
- **Expected behavior:** Strategy radio or dropdown on every asset card in Build Program, with primary plus optional secondary plus split %. Tooltip explaining the three modes. Hierarchy nested editor remains the canonical detailed editor; Build Program gets the day-1 surface.
- **Fix path:** Add a "Revenue Strategy" group to each asset card (between strategy and area cascade). Wire to `useModule1Store(s => s.updateAsset)`. Help copy explains Sell / Lease / Operate.
- **Estimated commits:** 1.

#### M3: CostLine.phaseId is silent in Dev Costs UI

- **Area:** Dev Costs tab
- **Current behavior:** `CostLine.phaseId` is optional (`module1-types.ts:342`). Undefined means "applies to all phases of the active sub-project"; defined means "phase-scoped". Module1Costs has no phase selector per row. The active-phase context selector (`RealEstatePlatform.tsx:1696-1714`) controls which costs are visible, but nothing in the row UI tells the user that a row is global vs phase-scoped.
- **Expected behavior:** Each cost row shows its scope (global or phase-N) with a toggle. The What-goes-here callout on Dev Costs explains the semantics in plain English.
- **Fix path:** Add a "Scope" column or per-row toggle. When toggled to phase-scoped, a phase dropdown appears. Update the `selectCostsForActivePhase` selector to include rows with `phaseId === undefined OR === activePhaseId`. Add a callout sentence on the tab.
- **Estimated commits:** 1 to 2.

#### M4: ParcelSetupWizard and inline Land Parcels card use different state paths

- **Area:** Land tab, Parcel CRUD
- **Current behavior:** ParcelSetupWizard commits to Zustand via `useModule1Store(s => s.setLand)({ landParcels: next })` (`ParcelSetupWizard.tsx:118`). Module1Area's inline parcel form commits via a parent-passed `setLandParcels` prop (`Module1Area.tsx:100`). Both eventually serialize to the same snapshot, but the update paths diverge. Test coverage and bug-fix work doubles.
- **Expected behavior:** Both surfaces hit `setLand` directly via the store. Module1Area drops the `setLandParcels` prop in favor of a `useModule1Store` selector.
- **Fix path:** Refactor Module1Area to subscribe to `landParcels` and call `setLand` directly. Remove `setLandParcels` from the props interface. RealEstatePlatform stops passing it.
- **Estimated commits:** 1.

#### M5: Land tab vs Build Program redundancy assessment

- **Area:** Land vs Build Program tabs
- **Current behavior (decision required):** The Land tab today owns:
  - Land Parcels (acquisition cost, area, rate, cash plus in-kind split). Unique to Land.
  - Project Roads % (project-level). Not duplicated.
  - Project FAR (whole-site ceiling). Coexists with per-plot `maxFAR`. Not auto-derived from plots.
  - Project Non-Enclosed % (balconies plus terraces deducted from GFA). Coexists with per-asset `deductPct`. Not auto-derived.
  - Area Hierarchy display (read-only summary).
- **Expected behavior:** Recommendation: KEEP Land tab as parcels plus project-level site parameters. Reasons:
  1. Parcels (financial scope, what you own) are conceptually distinct from Plots (physical scope, what you build on). The M1.10/5 reconciliation row already enforces this.
  2. Project Roads %, Project FAR, Non-Enclosed % are project-wide assumptions, not per-plot. Moving them into Build Program would mix project-level and per-plot inputs in one tab.
  3. Eliminating Land entirely would force parcels into Build Program, which already carries plots, assets, and sub-units. Density penalty too high.
  4. Stripping Land to parcels-only forces project-level site params into either Schedule (already crowded with the Hierarchy structure card) or Build Program (above).
- **Fix path:** Keep Land. Tighten What-goes-here copy to make the financial-vs-physical distinction sharper. Strip dead props from M1. Optionally: surface `projectFAR` as "calculated from per-plot maxFAR" if M2.0 implements that auto-derive (deferred).
- **Estimated commits:** 0 (decision only, executed via M1's prop cleanup).

#### M6: Modal positioning consistency check

- **Area:** All Module 1 modals
- **Current behavior:** PlotSetupWizard and ParcelSetupWizard portal to `document.body` (M1.10b/1). ProjectWizard does not (C2 above). Other modals (`ProjectModal`, `VersionModal`, `ExportModal`, `RbacModal` in `components/modals/`) not audited but should be checked for the same containing-block risk.
- **Expected behavior:** All overlay modals portal to `document.body`. Standing pattern.
- **Fix path:** Spot-check each non-wizard modal. Add portal where missing. C2 covers ProjectWizard. The non-wizard modals are out of Module 1 scope but cheap to verify.
- **Estimated commits:** Folded into C2; possibly 1 standalone if non-wizard modals also need fixing.

#### M7: Tooltip coverage incomplete on Dev Costs and Financing

- **Area:** Dev Costs, Financing tabs
- **Current behavior:** Dev Costs uses InputLabel on "Alloc Basis" and "Input Mode" (M1.10b/6). The cost row template (method, value, phasing, period range) does NOT have InputLabel tooltips per cell. Financing has InputLabel on the top-level fields (Mode, Debt %, Interest Rate, Capitalize, Repayment Method, Repayment Period) but lower-level summary tables do not. Inputs the user is most likely to hover for help (cost method semantics, repayment math) lack tooltips.
- **Expected behavior:** Every input gets InputLabel with plain-English help. Output cells stay grey-pale calc style without tooltips (or with a different "calc explainer" surface).
- **Fix path:** Audit each remaining input on Dev Costs and Financing. Add InputLabel to cost row method dropdown, value, period range. Add tooltips to Financing summary table headers. Help copy module similar to `plotFieldHelp.ts`: `costFieldHelp.ts` and `financingFieldHelp.ts`.
- **Estimated commits:** 1.

#### M8: ProjectWizard auto-balance + allocation tolerance edge case

- **Area:** ProjectWizard step 3
- **Current behavior:** Allocation sum tolerance is 0.01 (`ProjectWizard.tsx:319-320`). The auto-balance button (`lines 987-1000`) rounds down and adds the remainder to the first row, which is robust. Manual entry can hit edge cases (33.33 + 33.33 + 33.34 = 100.00 passes; 33.333 + 33.333 + 33.334 sums to 100.000 but float math may yield 99.999999999... and fail the gate).
- **Expected behavior:** Tolerance covers reasonable manual entry. Help copy explains the tolerance.
- **Fix path:** Bump tolerance from 0.01 to 0.1 (still rejects truly wrong sums like 95% or 105%, accepts manual fractional entry). Add a tooltip on the allocation field explaining the rule.
- **Estimated commits:** Folded into C1's wizard-level fix or M2's strategy fix.

### 2.3 MINOR (6)

#### m1: Parcel field label drift between wizard and inline

- **Current:** ParcelSetupWizard uses "Name" and "Rate (/sqm)" (`ParcelSetupWizard.tsx:235, 243`); Module1Area inline uses "Parcel Name" and "Rate (/{currency} per sqm)" (`Module1Area.tsx:222, 237-245`). Help text comes from two sources (wizard's local `PARCEL_HELP` map, inline's per-call strings).
- **Fix:** Move both to a shared `parcelFieldHelp.ts` module (mirrors `plotFieldHelp.ts`). Standardize labels: "Parcel Name", "Area (sqm)", "Rate (per sqm, {currency})", "Cash %", "In-Kind %".
- **Commits:** Folded into M4.

#### m2: Project Timeline Visual lacks per-period tick marks for monthly mode

- **Current:** Bar shows month count text, no inline ticks.
- **Fix:** Tick every quarter for monthly, every year for annual. Folded into C3.
- **Commits:** Folded into C3.

#### m3: WizardProjectType to HydrateSnapshot.projectType mapping

- **Current:** Wizard collects "Mixed-Use", "Residential", etc. as user-facing labels. `buildWizardSnapshot` maps via a collapse function (per CLAUDE.md M1.8 patterns). Verify the mapping covers every wizard type and produces a consistent lower-case slug.
- **Fix:** Cross-reference `WIZARD_DEFAULT_ASSETS_BY_TYPE` keys against the type collapse function. Add unit test if not present.
- **Commits:** Folded into a polish commit, or 0 if already correct.

#### m4: "Build Program" vs "Area Program" naming

- **Current:** The tab label is "3. Build Program" (`RealEstatePlatform.tsx:m1Tabs`). Module file is `Module1AreaProgram.tsx`. The h2 inside the tab is "Build Program". CLAUDE.md M1.9b/6 commit shifted the heading. File name still says "AreaProgram" (legacy from M1.7).
- **Fix:** Rename the file `Module1AreaProgram.tsx` to `Module1BuildProgram.tsx` and update imports. Optional, low risk if the file is purely a heading mismatch. Defer if it touches too many imports.
- **Commits:** 0 (defer; document the mismatch in CLAUDE.md).

#### m5: Annual vs monthly date label consistency

- **Current:** Schedule shows period counts; some labels say "months" or "years"; date strings format via `toLocaleDateString` which is locale-dependent.
- **Fix:** Use a stable formatter (e.g., `Intl.DateTimeFormat('en-GB', ...)`) for the visual labels. Folded into C3.
- **Commits:** Folded into C3.

#### m6: Plot envelope NaN display when plotArea is 0

- **Current:** `Module1AreaProgram.tsx:341` shows "Utilisation 0.0%" when `plotArea = 0` because the ratio resolves to NaN, then the formatter prints "0.0%". Misleading.
- **Fix:** Show a plain-language placeholder ("n/a" or "set plot area first") when plotArea is 0, instead of "0.0%".
- **Commits:** Folded into C3 or M7.

### 2.4 OUT OF SCOPE (calc-touching, deferred to M2.0+)

These are documented for completeness but explicitly excluded from M1.11 per the "no calculation changes" constraint.

- **O1:** `getSameForAllFactor` division-by-zero gap when all assets are hidden (`src/core/calculations/index.ts:377-385`). Add explicit guard in M2.0.
- **O2:** `projectNDA = totalLandArea - projectRoadsArea` can go negative if `projectRoadsPct > 100`. No clamp. UI does not enforce 0 to 100 either. Clamp in M2.0.
- **O3:** Repayment math is straight-line (`debtClose[constructionPeriods] / repaymentPeriods`), not amortization. Documented behavior but may surprise users expecting PMT-style. Decide whether to switch in M2.0 or document as intentional.
- **O4:** Snapshot diffs (`module1-snapshot-diff.ts:43, 58`, multiphase, areaprogram) use byte-for-byte JSON line equality. No floating-point tolerance. Risk is low (pure functions, deterministic JS), but introduce numeric tolerance if M2.0 changes any arithmetic order.

---

## 3. Per-tab UX summary

| Tab | Purpose clarity | Input grouping | Input vs output | Tooltip coverage | Sequence | Redundancy with wizard |
|------|----------------|----------------|-----------------|------------------|----------|------------------------|
| 1. Schedule | CLEAR | CLEAR (3 sections) | CLEAR (FAST blue, grey calc) | OK (all top-level inputs) | OK | LOW (wizard captures construction, ops, overlap; Schedule re-asks but as confirmation) |
| 2. Land | CLEAR | CLEAR (parcels card, site params card) | CLEAR | OK | OK | LOW |
| 3. Build Program | CLEAR | CLEAR (plots, assets, sub-units) | CLEAR | OK on plot fields, MISSING strategy UI (M2) | GOOD | OK |
| 4. Dev Costs | OK (callout exists) | OK | OK | INCOMPLETE (M7) | OK | NONE |
| 5. Financing | OK | OK | OK | INCOMPLETE (M7) | N/A (last) | NONE |

The Schedule tab carries the Hierarchy structure card (sections="structure") and the Build Program carries sections="assets". Slice coherence verified by Agent 1; no leakage.

---

## 4. Calculation reconciliation (Mixed-Use 100k, FAR 3.0, 50/30/20)

Agent 3 verified:
- `calculateLandAggregates` produces `totalLandArea = 100,000`, `landValuePerSqm = rate input`.
- `calculateAreaHierarchy` produces `totalProjectGFA = 100,000 * 3 = 300,000` (after roads adjustment, `projectNDA = totalLandArea - roads`).
- Per-asset GFA: residential 150,000 (50%), hospitality 90,000 (30%), retail 60,000 (20%). Reconciles to 300,000.
- BUA derivation: `assetGFA * (1 - deductPct/100)`. Then NSA: `assetBUA * (efficiencyPct/100)`. Order is correct.
- Total Capex = Total Debt + Total Equity, summed across assets. `buildAssetFinancing` aggregates per-asset cost lines correctly.
- Drawdown schedules: distributed per period per phasing mode. Sum reconciles to Total Debt.
- Repayment schedules: straight-line `debtClose[constructionPeriods] / repaymentPeriods`. Sum reconciles to Total Debt only if interest is not capitalized post-construction (which is the documented behavior). See O3 for refinement.
- Snapshot diffs: all 3 baselines (17.5 KB legacy, 23.0 KB multi-phase, 2.8 KB area-program) bit-identical at the time of audit. Verified before this commit.

---

## 5. First-time user flow simulation

Walked the wizard plus 5 tabs programmatically (Agent 2). Findings:
- Wizard happy path completes in 3 steps. No confusion.
- Lands on Schedule tab. Project structure card (Hierarchy structure mode) shows MH (hidden) plus Sub-Project plus Phase 1. Inputs above the structure card are project-level granularity, start, construction, operations, overlap.
- Land tab: 1 default parcel pre-seeded at 100,000 sqm matching wizard plot total. User edits rate. Site params card has 3 inputs.
- Build Program tab: 1 default plot. 3 default assets (Residential Tower, Hotel, Retail Podium). Asset cards show area cascade overrides. Strategy is missing from this surface (M2). Sub-units auto-minted with one per asset.
- Dev Costs tab: 12 default cost lines auto-seeded by the legacy useEffect. User edits values. Stage groups visible. Tooltips incomplete (M7).
- Financing tab: defaults pre-seeded (60% LTV, 7.5% rate, capitalize false, repayment 20 periods). User edits. Tooltips incomplete (M7).
- KPIs populate end-to-end. No NaN observed for the happy path.

**Confusion points captured:**
1. Status radio in step 1 has no downstream effect (C1).
2. After landing on Schedule, the user may not realize the structure card below is editable (the section header looks like a summary, not a CRUD surface).
3. On Build Program, no Strategy picker; user has to know to dive into the nested Hierarchy editor (M2).
4. On Dev Costs, the relationship between cost rows and active phase is invisible (M3).

---

## 6. Regression check (M1.5b through M1.10b)

19 of 19 prior fixes verified active (Agent 4):

| Phase | Marker | Status |
|-------|--------|--------|
| M1.5b | "Quick Setup" in Module1Hierarchy | PASS |
| M1.6 | refm_project_versions in persistence/ | PASS |
| M1.7 | Area Program tab present | PASS |
| M1.8 | wizard-step-indicator testid | PASS |
| M1.8 fix 5 | isNewV3 recogniser | PASS |
| M1.9 | "1. Schedule" tab label | PASS |
| M1.9 | setActiveTab('timeline') on wizard create | PASS |
| M1.9b | m1Tabs has exactly 5 entries | PASS |
| M1.9b | sections="structure" and sections="assets" mounts | PASS |
| M1.9b | "Project Construction" + "Project FAR" labels | PASS |
| M1.9b | What-goes-here callouts on all 5 tabs | PASS |
| M1.10/2 | DEFAULT_PLOT_ constants in module1-types | PASS |
| M1.10/3 | firstByCategory resolver in RealEstatePlatform | PASS |
| M1.10/5 | land-plot-reconciliation testid | PASS |
| M1.10/6 | PlotSetupWizard.tsx exists | PASS |
| M1.10/7 | ParcelSetupWizard.tsx exists | PASS |
| M1.10b/1 | createPortal in Plot+Parcel wizards | PASS |
| M1.10b/3 | InputLabel primitive a11y markers | PASS |
| M1.10b/5 | PLOT_FIELD_HELP exports 15 keys | PASS |

**Conclusion:** No silent regressions. The architectural foundation is intact.

---

## 7. Recommended fix sequence and commit grouping

Coordinated fix pass, grouped by area not by issue, so each commit is coherent. Snapshot diffs bit-identical at every commit.

| # | Group | Issues addressed | Estimated commits |
|---|-------|------------------|-------------------|
| 1 | Wizard polish | C1 (status field), C2 (portal), M8 (allocation tolerance) | 2 |
| 2 | Schedule tab + visual | C3 (timeline visual with semantic dates and multi-phase), m2, m5 | 2 |
| 3 | Land tab cleanup | M1 (dead setters part 1), M4 (Zustand parcel path), m1 (label parity) | 1 |
| 4 | Build Program | M2 (strategy UI on asset card), m6 (envelope NaN polish) | 1 to 2 |
| 5 | Dev Costs | M3 (phase scope toggle), M7a (tooltips on cost rows) | 1 to 2 |
| 6 | Financing | M7b (tooltips on financing inputs) | 1 |
| 7 | Em-dash sweep | C4 hot-path JSX | 1 |
| 8 | Em-dash sweep | C4 code comments | 1 |
| 9 | Em-dash sweep | C4 documentation markdown | 1 |
| 10 | Verifier | scripts/verify-m111.ts (5-section template) | 1 |
| 11 | Playwright | tests/e2e/m111-full-flow.spec.ts (wizard plus 5 tabs plus KPI reconciliation) | 1 |
| 12 | Docs sweep | CLAUDE.md M1.11 closure note plus pattern decisions | 1 |

**Total: 14 to 17 commits.**

All snapshot diffs (17.5 KB / 23.0 KB / 2.8 KB) must remain bit-identical through every commit. Type-check and build pass. Light and dark verified. Screenshots into `tests/screenshots/M1.11/`.

---

## 8. Pattern decisions for downstream phases

The audit surfaced four standing patterns to lock in for M2.0+ work:

1. **Modal portaling is mandatory for all overlay modals.** PlotSetupWizard and ParcelSetupWizard set the precedent in M1.10b/1. ProjectWizard joins in M1.11. Any new modal must use `createPortal(jsx, document.body)` with the SSR guard.

2. **Wizard fields must reach the store.** Audit `buildWizardSnapshot` against the wizard draft fields whenever either changes. The C1 status drop is exactly the failure mode this prevents.

3. **Dead props are technical debt, not safety scaffolding.** When a phase removes UI for a setter, remove the setter from the props interface and from the call site in the same commit. Eslint-disable comments for unused setters become permanent confusion.

4. **Help copy modules are reusable across surfaces.** `plotFieldHelp.ts` (M1.10b/5) is the model. Pull `parcelFieldHelp.ts`, `costFieldHelp.ts`, `financingFieldHelp.ts` for the M1.11 fixes. Inline forms and modals share the same help map.

---

## 9. Approval requested

Awaiting Ahmad's go-ahead on:
1. The fix list (22 issues, of which 4 are explicitly out of scope).
2. The commit grouping (12 areas, 14 to 17 commits).
3. The Land tab decision (KEEP, with parcels plus site params; do not eliminate).
4. The em-dash sweep policy (skip `js/refm-platform.js` legacy file; skip verification-script docstrings; sweep everywhere else).

After approval, M1.11 fix execution proceeds in one coordinated pass. Verifier and Playwright at the end. CLAUDE.md M1.11 closure note caps the phase. Module 1 ships production-ready.
