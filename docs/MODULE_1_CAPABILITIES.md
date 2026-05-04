# REFM Module 1 — Capabilities Summary

**Audience:** first-time-user walkthrough author. **Last updated:** 2026-05-04.

**Module 1 status:** fully complete. Sub-phases shipped: M1.R (restoration), M1.5 (multi-asset + storage v4), M1.5b (multi-phase fan-out), M1.6 (Supabase persistence), M1.7 (Area Program), M1.8 (Smart Project Creation Wizard) + 5 wizard hotfixes (`a15fcbc` row pairing, `e217978` modal width, `5085958` skip round-trip on create, `4721e80` `useShallow` infinite-loop fix, `66a20f5` shape-based hydration recogniser). Audit on 2026-05-04 confirmed all 6 tabs share the same `useModule1Store` Zustand store with **no duplicate local state** — every tab reads from and mutates the same canonical entity arrays (`assets`, `phases`, `plots`, `zones`, `subUnits`, `costs`, `landParcels`).

Module 1 ("Project Setup") is the entry surface for every REFM project. It owns the 5-layer hierarchy (Master Holding → Sub-Project → Phase → Plot → Asset → Sub-Unit), the timeline / land / area / cost / financing inputs, and the area-program math. Modules 2-11 read from Module 1's persisted snapshot.

New projects are created through the **Smart Project Creation Wizard** (M1.8, 2026-05-03 — see §0). After Create the user lands on the **Area Program** tab with a fully-seeded structure; the Hierarchy tab is reserved for editing.

Six tabs: **Hierarchy · Area Program · Timeline · Land & Area · Dev Costs · Financing**. The non-Hierarchy tabs scope to one Sub-Project + one Phase at a time (selectors above the tabs).

---

## 0. Smart Project Creation Wizard (🪄) — NEW M1.8 (2026-05-03)

**Purpose:** replace the legacy "+ New Project" → ProjectModal flow with a guided 3-step wizard that pre-creates the full project skeleton (Master Holding optional / Sub-Project / Phases / Plots / Assets / placeholder Sub-Units) so a brand-new project lands ready to model on the Area Program tab instead of the empty Hierarchy tab.

**Modal layout:** 1080px max-width (post-launch hotfix `e217978`, up from 640px so Step 3's asset-row grid doesn't crunch). `width: '100%'` retained for narrow-viewport graceful shrink.

**Wizard flow:**

**Step 1 — Project Basics:**
- **Name** (required, free text)
- **Location** (required, free text)
- **Currency** (dropdown sourced from COUNTRY_DATA; default = SAR) — paired with Project Start Date in a 2-column grid row
- **Project Start Date** (default = today + 6 months)
- **Model Type** (`annual` | `monthly`; default `annual`) — paired with Status in a 2-column grid row (post-launch hotfix `a15fcbc` so the entire Step 1 form fits on standard 1080p without scrolling)
- **Status** (`Draft` | `Active` | `IC Review` | `Approved` | `Archived`; default `Draft`)

**Step 2 — Project Structure:**
- **Master Holding toggle** (default OFF — single-project users skip the MH layer)
- **Phases**: Single | Multiple radio. Multiple reveals a 2-10 phase-count input.
- **Plots**: Single | Multiple radio. Multiple reveals a 2-20 plot-count input.

**Step 3 — Assets:**
- **Project Type** radio with 6 display values: **Residential**, **Hospitality**, **Retail**, **Office**, **Mixed-Use**, **Custom**.
- **Default-asset matrix** seeds Step 3's asset rows per project type:
  - Residential → 1 asset (Apartments / Sell)
  - Hospitality → 1 asset (Hotel / Operate)
  - Retail → 1 asset (Retail / Lease)
  - Office → 1 asset (Office / Lease)
  - Mixed-Use → 3 assets (Apartments / Sell, Hotel / Operate, Retail / Lease) summing to 100 %
  - Custom → 0 assets (user adds rows manually)
- Editable per row: **Type** (typeahead from PREBUILT_ASSET_TYPES bucketed by category) · **Category** (`Sell` | `Operate` | `Lease` | `Hybrid`) · **Allocation %** · **Remove** button.
- **Auto-balance** button rebalances to 100 % evenly. **Live total readout** ("Total: 100.00 % ✓" green / red). Continue is gated on `|sum − 100| < 0.01`.

**Calculated outputs (on Create):**
- **Pure helper** `buildWizardSnapshot(draft) → { snapshot, assetMix, wizardType }` in `lib/wizard/buildWizardSnapshot.ts` mints stable ids and returns a complete HydrateSnapshot:
  - 1 Sub-Project (canonical id `subproject_1`, currency from wizard, MH-roll-up only when toggle ON)
  - N Phases (`phase_1` reuses canonical id; subsequent phases `phase_2..phase_N`; timing inherited from `DEFAULT_MODULE1_STATE.phases[0]` — 4 / 5 / 0 construction / operations / overlap)
  - N Plots under Phase 1 (`plot_1..plot_N`; area split evenly from a 100 k sqm seed)
  - 1 Asset per wizard row, all bound to Phase 1 + Plot 1, with industry-typical seeds: Sell 10 / 85, Operate 15 / 80, Lease 5 / 90, Hybrid 10 / 85 (`deductPct` / `efficiencyPct`)
  - 1 placeholder Sub-Unit per asset: Sell → count(1 unit), Operate → count(1 key), Lease + Hybrid → area(0)
  - `costs: []` (legacy default-cost seed `useEffect` in `RealEstatePlatform` stamps the standard 12-cost mix the first time the user opens Dev Costs)
  - `hierarchyDisclosure: 'progressive'` (wizard is the only producer of this value; legacy projects stay `'manual'`)
- **WizardProjectType collapse:** the 6 display values map down to the 3 store ProjectType values via `mapWizardToProjectType()` — Residential → `'residential'`, Hospitality → `'hospitality'`, everything else (Retail / Office / Mixed-Use / Custom) → `'mixed-use'` (the only enum that admits arbitrary asset allocations).
- **Post-create handler** `handleCreateProjectFromWizard` in `RealEstatePlatform.tsx`: hydrate store → POST `/api/refm/projects` with the snapshot → `attachToProjectFromLocalSnapshot(pid, snapshot)` (post-launch hotfix `5085958` — uses the new sync helper that writes the active-id marker + cache + starts auto-save WITHOUT a round-trip `loadProject`, sidestepping a `hydrationFromAnySnapshot` recogniser bug that wiped wizard data on a bare `HydrateSnapshot`) → `setActiveTab('area-program')` so the user lands on Area Program (not Hierarchy).

**Wizard hotfix series (2026-05-03 → 2026-05-04, all in production):**
1. `a15fcbc` — Step 1 row pairing (Currency + Project Start Date on row 1, Model Type + Status on row 2) so the form fits standard 1080p without scrolling.
2. `e217978` — modal max-width 640 → 1080 px so Step 3's asset-row grid doesn't crunch.
3. `5085958` — skip round-trip `loadProject` after wizard create (use `attachToProjectFromLocalSnapshot` instead) to keep the local snapshot intact.
4. `4721e80` — fix `useShallow` infinite loop in `Module1AreaProgram.tsx`. Six call sites refactored from `useShallow(s => ({ filtered: s.X.filter(...) }))` to base-array subscription + `useMemo` derivation. Zustand v5's `shallow` compares top-level entries with `Object.is`; calling `.filter()` inside the selector returned a new array reference every render, triggering React's "getSnapshot should be cached" infinite-loop guard. Pattern is now `const allX = useModule1Store(s => s.X); const filtered = useMemo(() => allX.filter(...), [allX, key])`.
5. `66a20f5` — relax `lib/state/module1-migrate.ts:isNewV3` to be **shape-based**. Every snapshot the system POSTs (wizard create, legacy create, auto-save) is bare `HydrateSnapshot` with no `version: 3` discriminator at the top level, so the strict `version === 3` check fell through to the legacy v2 path on reload, replaying default-seed (`projectName: 'Skyline'`, `assets:0`, `plots:0`). Recogniser now matches `(version === 3 || version === undefined) && Array.isArray(assets/phases/costs)`. Read-side only; no DB migration, no schema change.

**Key validations:**
- ⚠ Step 3 Continue is disabled while allocations don't sum to 100 % (live red total).
- ⚠ Esc / backdrop click prompts a dirty-confirm if the user entered ANY data — comparison uses `assetSignature(assets)` (joins name / type / category / allocationPct / strategy) rather than reference equality, because the wizard mints random ids via `makeWizardAssetId()` at draft creation that would never match.
- ⚠ Step 2 phase-count clamp: 2..10. Plot-count clamp: 2..20.
- Tab navigation between steps preserves all state. Back / Continue navigation never loses input.

**Persistence behavior:**
- The wizard itself persists nothing — draft state is in-memory until Create is clicked.
- On Create the snapshot follows the standard REFM persistence path: row inserted into `refm_projects` (with `asset_mix` cached for the picker tile), first version row appended to `refm_project_versions`, debounced 1.5 s auto-save attaches.
- `hierarchyDisclosure: 'progressive'` is persisted as a top-level field on the snapshot and round-trips through `enrichWithHierarchyDefaults` (legacy snapshots get padded to `'manual'`).

---

## 1. Hierarchy tab (🗂️)

**Purpose:** define the 5-layer project structure (Master Holding → Sub-Project → Phase → Plot → Asset → Sub-Unit) AFTER the wizard has seeded it. Wizard projects land on Area Program; Hierarchy is the editing surface for renaming, restructuring, and adding new layers as the project grows.

**Inputs available:**
- Master Holding **enabled** toggle (default off — single-project users keep hidden)
- Master Holding **name** (default `"Master Holding"`), **landCostMethod** (`fixed` | `rate_total_allocated`, default `fixed`), **landCostValue** (default 0), **masterDebtPrincipal / masterDebtRate / masterDebtTermPeriods** (default 0 / 0 / 0)
- Sub-Project **name**, **currency** (default project currency), **masterHoldingId** (default null), **revenueShareToMaster %** (default 0)
- Phase **name**, **subProjectId** (parent), **constructionStart** (period 1), **constructionPeriods** (default 4), **operationsPeriods** (default 5), **overlapPeriods** (default 0); **operationsStart** auto-derived = `max(1, constructionPeriods − overlapPeriods + 1)` *(locked / read-only)*
- Asset **name**, **type** (one of 20 PREBUILT_ASSET_TYPES bucketed by category), **category** (`Sell` | `Operate` | `Lease` | `Hybrid`), **allocationPct**, **deductPct**, **efficiencyPct**, **visible**, **subProjectId** (locked, derived from Phase), **phaseId** (required; the only canonical place to reassign)
- Sub-Unit **name**, **assetId** (locked, parent), **metric** (`count` | `area`; default `area` for Lease, `count` otherwise), **metricValue**, **unitPrice**, **priceEscalationPct?**

**Top-of-tab action bar (M1.8/7 — always visible, both disclosure modes):**
- **+ Add Phase** — appends Phase N+1 under the breadcrumb sub-project (or the first SP if none active). Inherits timing from the prior phase (or 4 / 5 / 0 default if none exists yet).
- **+ Add Plot** — appends Plot N+1 under the breadcrumb phase (or the active SP's first phase). Inherits seed area (or 100 k sqm fallback). Surfaces `window.alert` when no phases exist.
- **Enable Master Holding** — only visible when MH disabled. Flips `masterHolding.enabled = true` via the existing `updateMasterHolding` store action. Does NOT change `hierarchyDisclosure` — progressive projects stay progressive; users opt into more layers without abandoning the wizard's posture.

**Progressive disclosure (M1.8/6, only when `hierarchyDisclosure === 'progressive'`):**
- The Master Holding card is **hidden while MH is disabled** so wizard projects don't show an empty MH layer the user never asked for; the dedicated Enable button covers opt-in.
- Components clamp `disclosure = hierarchyDisclosure ?? 'manual'` at the top so legacy snapshots that bypass `enrichWithHierarchyDefaults` (defensive belt-and-suspenders) keep showing all 5 layers.
- Pre-M1.8 projects are stamped `'manual'` on load and continue to show every layer including the (disabled) MH card — no behaviour change.

**Calculated outputs:**
- Header context bar quick stats: "X Sub-Projects, Y Phases, Z Assets, N Sub-Units"
- Per-tier expand / collapse chevron state (UI-only, not persisted)

**Key validations:**
- ⚠ Disabling a Master Holding while sub-projects roll up under it triggers a confirm and clears their `masterHoldingId / revenueShareToMaster`
- ⚠ Sub-Project / Phase / Plot / Zone / Asset deletes confirm with a cascade preview (phases / plots / zones / assets / costs / sub-units that will drop)
- ⚠ Brand-new project bypasses this tab entirely — the wizard (§0) seeds the structure before the user sees Hierarchy

**Persistence behavior:**
- Every CRUD action writes through Zustand store actions, then debounced auto-save (1.5 s) appends a new row to `refm_project_versions` and bumps `refm_projects.current_version_id`
- Active sub-project / phase selectors are UI-only and reset on snapshot load
- `hierarchyDisclosure` (M1.8) round-trips with the snapshot as a top-level optional string; missing on load → padded to `'manual'`
- Master Holding P&L / consolidation math is **out of scope here** — that lives in M8.1 Portfolio Rollup

---

## 2. Area Program tab (📐) — NEW M1.7 (2026-05-02)

**Purpose:** define the physical envelope per Plot (FAR, coverage, floors, parking config) and the per-asset operating Strategy + area-cascade + sub-unit schedule + parking allocator. Sits between Land & Area and Dev Costs. *Depends on:* Hierarchy tab having at least one Phase (otherwise renders an empty-state pointing back to Hierarchy).

**Inputs available:**

Per-**Plot** (created via "+ Add Plot"; defaults from `makeDefaultPlot`):
- **Plot Area** (sqm; default 50,000 — must be > 0 for envelope math)
- **Max FAR** (ratio; default 3.0)
- **Coverage %** (default 60; clamped 0–100)
- **Typical Coverage %** (default 40)
- **Total Floors** (default 12) · **Podium Floors** (default 2) · **Typical Floors** (default 10)
- **Landscape %** of public area (default 40) · **Hardscape %** of public area (default 40)
- **Basements** (count, default 1) · **Basement Efficiency %** (default 95)
- **Vertical Parking Floors** (default 0)
- **Surface Bay sqm** (default 25) · **Vertical Bay sqm** (default 40) · **Basement Bay sqm** (default 44)
- Optional **length / width** (m)

Per-**Zone** (optional sub-divisions of a Plot):
- **Name** (e.g. "Zone 1A"), **plotId** (locked, parent), optional **areaSharePct**

Per-**Asset on the Plot** (assigned via "Assign an existing asset" picker):
- **Primary strategy** (`Develop & Sell` | `Develop & Lease` | `Develop & Operate`; default keyed off category — Sell→Sell, Lease→Lease, Operate→Operate, Hybrid→Sell)
- **Primary %** (default 100)
- **Secondary strategy** (optional) + **Secondary %**
- **Zone** (optional, dropdown of plot's zones)
- **GFA override (sqm)** (optional; otherwise pro-rata via `allocationPct`)
- **MEP %** override (defaults — Sell 8 / Lease 12 / Operate 15 / Hybrid 12)
- **BoH %** override (defaults — Sell 3 / Lease 5 / Operate 12 / Hybrid 8)
- **Other Tech %** (defaults — Sell 3 / Lease 4 / Operate 5 / Hybrid 4)

Per-**Sub-Unit on the Asset** (inline editable schedule with category-aware `<datalist>` suggestions):
- **Type / Name** (suggestions: Studio, 1BR, 2BR, 3BR, Apartments Type 1-3, Branded Residences, Hotel Key, Serviced Apartment, Office, Retail)
- **Metric** (`count` | `area sqm`; default `area` for Lease, `count` otherwise)
- **Quantity**
- **Parking bays / unit** override (defaults from `DEFAULT_PARKING_BAYS_BY_SUBUNIT_TYPE` keyed on Name — Studio/1BR 1.0, 2BR 1.6, 3BR 2.0, Hotel Key 1.0, Office/Retail 1.0 per 25 sqm; unknown names fall back to 1.0)

**Calculated outputs:**

Computed envelope (per Plot panel):
- **Max GFA** = `plotArea × maxFAR`
- **Footprint** (podium plate) = `plotArea × coveragePct ÷ 100`
- **Typical Footprint** = `plotArea × typicalCoveragePct ÷ 100`
- **Podium GFA** = `footprint × podiumFloors`
- **Typical GFA** = `typicalFootprint × typicalFloors`
- **Total Built GFA** = `podiumGFA + typicalGFA`
- **Public Area** = `plotArea − footprint`
- **Landscape Area** = `publicArea × landscapePct ÷ 100`
- **Hardscape Area** = `publicArea × hardscapePct ÷ 100`
- **Surface Parking Area** = `publicArea − landscapeArea − hardscapeArea` (clamped ≥ 0)
- **Basement Gross** = `footprint × basementCount`
- **Basement Usable** = `basementGross × basementEfficiencyPct ÷ 100`

Per-asset cascade preview:
- **GFA share** = `gfaOverrideSqm` (if set) OR pro-rata of plot's totalBuiltGFA by allocationPct across plot's assets
- **MEP** = `gfa × mepPct ÷ 100`
- **Back-of-House** = `gfa × backOfHousePct ÷ 100`
- **Other Tech** = `gfa × otherTechnicalPct ÷ 100`
- **Net GFA** = `gfa − mep − backOfHouse − otherTech` (clamped ≥ 0)
- **GSA / GLA** = `netGFA × asset.efficiencyPct ÷ 100`
- **BUA Excl** (BUA excluding MEP & Basement) = `gfa + backOfHouse + otherTech`
- **TBA** (Total Built Area) = `BUA Excl + MEP + basementShare` (basementShare = pro-rata of plot's basementUsable by GFA share)

Per-plot parking summary:
- **Required (sub-units)** = sum of `parkingBaysPerUnit × metricValue` (count) or `(metricValue ÷ 25) × parkingBaysPerUnit` (area) across every sub-unit on every asset bound to the plot
- **Surface Capacity** = `floor(surfaceParkingArea ÷ surfaceBaySqm)` · **Vertical** = `floor(footprint × verticalParkingFloors ÷ verticalBaySqm)` · **Basement** = `floor(basementUsableArea ÷ basementBaySqm)`
- **Allocation** (waterfall): Surface first → Vertical → Basement until demand met
- **Deficit** = required − allocated (≥ 0)

**Key validations:**
- ⚠ Amber **Over-FAR badge** in plot header when `totalBuiltGFA > maxGFA` (utilization % displayed)
- ⚠ Red **Deficit badge** on parking summary when total bays demanded > combined capacity (card flips to negative-bg)
- ⚠ Plot delete confirm lists owned zones + assets that will lose plot/zone link (asset itself survives, just leaves area-program cascade)
- ⚠ Zone delete confirm lists assets that point at it (zoneId clears; plotId preserved)
- Inputs clamp gracefully — negative → 0, percents → 0..100 — never throws

**Persistence behavior:**
- Same auto-save as Hierarchy: 1.5 s debounced version append on any plot / zone / asset / sub-unit change
- New shape lives in `refm_projects.snapshot` JSONB (`plots[]`, `zones[]`, plus optional fields on AssetClass / SubUnit). **No new tables, no migrations.**
- Pre-M1.7 snapshots load via `enrichWithHierarchyDefaults` padding `plots: []` / `zones: []`
- Active plot id is UI-only and resets on snapshot load

---

## 3. Timeline tab (📅)

**Purpose:** project metadata + single-phase periods (legacy — multi-phase editing happens on Hierarchy). Timeline period inputs read/write `phases[0]` for backward compatibility with pre-M1.5 projects.

**Inputs available:**
- **Project Name** (default `"Skyline"`)
- **Project Type** (`mixed-use` | `residential` | `hospitality` | `retail`; default `mixed-use`)
- **Country** (typeahead; default `"Saudi Arabia"`)
- **Currency** (default `"SAR"`)
- **Model Type** (`annual` | `monthly`; default `annual`)
- **Project Start** (date; default `"2025-01-01"`)
- **Construction Periods** (default 4)
- **Operations Periods** (default 5)
- **Overlap Periods** (default 0)

**Calculated outputs:**
- **Project End Date** (locked, read-only) = projectStart + `(constructionPeriods + operationsPeriods − overlapPeriods)` periods, expressed in months when `modelType=monthly` or years when `modelType=annual`; rendered as last day of the final month

**Key validations:**
- AI Assist gradient button visible when contextual-help permission granted (currently stubbed off)
- No hard validation on periods — UI accepts any non-negative number

**Persistence behavior:**
- Edits to construction/operations/overlap periods write to `phases[0]` only (multi-phase projects edit each phase via Hierarchy → Phase inline editor)
- Project metadata (name / country / currency / modelType / projectStart) persists at root of snapshot
- Same 1.5 s debounced auto-save

---

## 4. Land & Area tab (🗺️)

**Purpose:** land parcels (cash + in-kind split per parcel) + project-level site parameters (FAR, roads, non-enclosed) + asset-mix percentages + deduction/efficiency factors. Drives the Area Hierarchy table that feeds Dev Costs.

**Inputs available:**

Per **Land Parcel** (table; default 1 parcel "Land 1" 100,000 sqm @ 500/sqm, 60% cash / 40% in-kind):
- **Parcel Name**, **Area (sqm)**, **Rate (currency / sqm)**, **Cash %** (default 60), **In-Kind %** (auto-paired to `100 − Cash %`)

Site Parameters:
- **Project Roads / Infrastructure %** (default 10; range 0–50)
- **Floor Area Ratio (FAR)** (default 1.5; range 0–10, step 0.1)
- **Non-Enclosed Area %** (default 0; range 0–100)

Asset Mix (% allocation, must sum to 100):
- **🏠 Residential %** (default 50; visible if projectType ∈ residential / mixed-use)
- **🏨 Hospitality %** (default 30; visible if projectType ∈ hospitality / mixed-use)
- **🏪 Retail %** (default 20; always visible)

Deduction & Efficiency Factors (per visible asset):
- **Residential Deduct %** (range 0–50) · **Residential Efficiency %** (range 50–100)
- **Hospitality Deduct %** (range 0–50) · **Hospitality Efficiency %** (range 50–100)
- **Retail Deduct %** (range 0–50) · **Retail Efficiency %** (range 50–100)

**Calculated outputs (Area Hierarchy table — locked, read-only):**
- **Total Land Area** = sum of all parcels' Area
- **Total Land Value** = sum of `parcelArea × parcelRate`
- **Land Value per sqm** = `totalLandValue ÷ totalLandArea`
- **Cash / In-Kind Value** per parcel = `parcelArea × parcelRate × cashPct%` (and 1 − cashPct for in-kind)
- **Roads / Infra Area** = `totalLandArea × projectRoadsPct ÷ 100`
- **Net Developable Area (NDA)** = `totalLandArea − roadsArea`
- **Total Project GFA** = `NDA × FAR`
- **Total Project BUA** = `totalGFA × (1 − projectNonEnclosedPct ÷ 100)`
- **Per-asset GFA** = `totalGFA × (assetPercent ÷ 100)` (zero when asset hidden)
- **Per-asset BUA** = `assetGFA × (1 − assetDeductPct ÷ 100)`
- **Per-asset Net Saleable** = `assetBUA × assetEfficiency ÷ 100`
- **Per-asset Land Value** = `totalLandArea × assetPercent ÷ 100 × landValuePerSqm`

**Key validations:**
- ⚠ Asset Mix badge flips to red ⚠ when allocations don't sum to 100 (`|sum − 100| > 0.01`); error banner shows current total
- Cash / In-Kind % are **auto-paired** — editing one updates the other
- Last parcel cannot be removed (the "Del" button no-ops if `landParcels.length ≤ 1`)
- Site parameter inputs enforce min/max via the input element; out-of-range entries are clamped by the browser

**Persistence behavior:**
- All inputs persist to snapshot root (`landParcels[]`, `projectRoadsPct`, `projectFAR`, `projectNonEnclosedPct`, asset allocation/deduct/efficiency on the 3 canonical assets in `assets[]`)
- Same 1.5 s debounced auto-save
- Output table is recalculated on every render — never stored
- *Depends on:* Timeline tab's `projectType` (drives which asset rows are visible)

---

## 5. Dev Costs tab (💸)

**Purpose:** per-asset cost line items with 10 calculation methods (fixed amount / area-rate / land-value-percent / percent-of-other-line). Two input modes (`separate` per-asset vs `same-for-all` project-level proportioned by allocation).

**Inputs available:**
- **Cost Input Mode** (`separate` | `same-for-all`; default `separate`)
- Per cost line: **Name**, **Method** (10 options below), **Value**, **Start Period**, **End Period**, **Phasing** (`even` | manual % array), **Stage** (1=Pre-Dev / 2=Construction / 3=Post; auto-defaults from id), **Scope** (`asset` | `project`; default `asset`), **Dev Fee Mode** (`exclude` | `include`; default `exclude`), **Selected base lines** (for `percent_base` only)
- Allocation Basis (`direct_cost` | `gfa`; default `direct_cost`)

**Cost methods (the calculation each one performs):**
- **Fixed Amount** — value in currency (in same-for-all mode, locked rows are proportioned by `assetAllocPct ÷ totalVisibleAllocPct`)
- **Rate × Total Land** — `value × asset.totalAllocated` (sqm)
- **Rate × NDA** — `value × asset.netDevelopable` (sqm)
- **Rate × Roads** — `value × asset.roadsArea`
- **Rate × GFA** — `value × asset.gfa`
- **Rate × BUA** — `value × asset.bua`
- **% of Selected** — `(value ÷ 100) × sum(selected base line totals)`
- **% of Total Land Value** — `(value ÷ 100) × asset.landValue`
- **% of Cash Land Value** — `(value ÷ 100) × asset.cashLandValue`
- **% of In-Kind Land Value** — `(value ÷ 100) × asset.inKindLandValue`

**Calculated outputs:**
- **Cost Item Total** per row (formula above by method)
- **Period Distribution** = total spread across `[startPeriod..endPeriod]` either evenly or by user-supplied phasing % array; zeroed outside range, clamped to constructionPeriods
- **Asset Total** = sum of cost item totals
- **Project Total** (for `scope=project` lines) = total before allocation

**Key validations:**
- Method picker switches the value's hint label (`× sqm`, `× currency`) to match the unit
- Locked rows (`canDelete: false`, e.g. seeded Land Cash) cannot be removed
- `percent_base` rows display a checkbox list of other rows to multiply against — selecting itself is filtered out

**Persistence behavior:**
- All cost lines persist as a flat `costs[]` array keyed by `assetId` (and optional `phaseId` — undefined = sub-project-global; defined = phase-specific)
- Stage / Scope / Dev Fee Mode / Allocation Basis maps persist alongside (`costStage`, `costScope`, `costDevFeeMode`, `allocBasis`)
- Same 1.5 s debounced auto-save
- *Depends on:* Land & Area tab's Area Hierarchy outputs (every rate/% method reads from the asset's `AreaMetrics`)

---

## 6. Financing tab (🏦)

**Purpose:** debt/equity ratios (global or per-line), interest rate, repayment terms; produces per-asset financing schedules (debt + equity drawdowns, interest, repayments, balances).

**Inputs available:**
- **Interest Rate %** annual (default 7.5)
- **Financing Mode** (`fixed` global ratio | `per-line` ratio per cost line; default `fixed`)
- **Debt % of CapEx (LTV)** (default 60; only used in `fixed` mode)
- **Capitalize Interest during construction?** boolean (default false)
- **Repayment Periods** (default 5)
- **Repayment Method** (`fixed` straight-line; only one shipped today)
- Per-line **Debt %** override (only when `financingMode=per-line`; defaults to `globalDebtPct` per row)

**Calculated outputs:**
- **Periodic Rate** = `interestRate ÷ 100 ÷ (12 if monthly else 1)`
- **Total Periods** = `constructionPeriods + operationsPeriods` (read from active phase)
- Per cost line: **Debt Amount** = `total × debtPct ÷ 100`; **Equity Amount** = `total − debtAmount`
- **Debt Drawdowns** = sum of `costDist[period] × debtPct ÷ 100` across visible cost lines
- **Equity Drawdowns** = `costDist[period] × (1 − debtPct ÷ 100)`
- **Construction Phase** (periods 1..N): debt balance = open + draw + (capitalized interest if enabled); interest = `balance × periodicRate + (capitalized ? draw × rate ÷ 2 : 0)`
- **Operations Phase**: repayment per period = `endOfConstructionDebtBalance ÷ repaymentPeriods` (straight-line); interest charged on declining balance; repayment stops after `repaymentPeriods`
- **Equity Balance** runs cumulative — equity is never repaid in the schedule
- **Total Debt / Equity / Interest** = sum of per-period flows

**Key validations:**
- Operating phase repayment caps at `repaymentPeriods` (after that it's $0 / period)
- Capitalized interest only fires during construction periods
- Per-line ratios are only consulted when `financingMode=per-line`; `fixed` mode forces every line to `globalDebtPct`

**Persistence behavior:**
- All scalars persist at snapshot root (`interestRate`, `financingMode`, `globalDebtPct`, `capitalizeInterest`, `repaymentPeriods`, `repaymentMethod`, `lineRatios`)
- Same 1.5 s debounced auto-save
- Schedules are recalculated on every render — never stored
- *Depends on:* Dev Costs tab's per-asset totals + period distributions; Timeline tab's construction/operations periods + modelType

---

## Cross-tab persistence summary

- **Source of truth:** `refm_projects.snapshot` JSONB (one HydrateSnapshot per saved version), append-only history in `refm_project_versions`. RLS-locked per `user_id`.
- **Schema version:** v4. Additive extensions: M1.7 added `plots[]` + `zones[]` + optional AssetClass / SubUnit fields; M1.8 added `hierarchyDisclosure?: 'progressive' | 'manual'` at snapshot root. Pre-extension snapshots load via `enrichWithHierarchyDefaults` padding the new keys (`plots: []`, `zones: []`, `hierarchyDisclosure: 'manual'`).
- **Auto-save cadence:** 1.5 s debounced; subscribes to every store mutation; appends a new version row + bumps `current_version_id`. Manual "Save Version" via the Version modal accepts an optional label.
- **What's NOT persisted:** active sub-project / phase / plot id (UI-only — reset to first available on load), expand/collapse chevron state, "isLoading" guards, in-flight wizard drafts.
- **Version history:** every auto-save creates a new row. The Version modal lists them by `created_at DESC` and supports load (rewinds the store) + duplicate (M1.6 `/api/refm/projects/[id]/duplicate`).
- **Verification:** three independent snapshot-diff tracks gate Module 1 commits — `module1-snapshot-diff` (legacy 17.5 KB), `module1-multiphase-diff` (multi-phase 23.0 KB), `module1-areaprogram-diff` (M1.7 area program 2.8 KB). Per-phase 5-section verifiers cover DB roundtrip + routes + calc + state + Playwright UI: `verify-m17.ts` (Area Program, 25 pass / 0 fail / 2 skip without dev server) and `verify-m18.ts` (Smart Project Wizard, 19 pass / 0 fail / 1 skip without dev server — confirms `hierarchyDisclosure` round-trip + the 6→3 project-type collapse + per-category sub-unit metric + Mixed-Use seed counts + hydrate-cycle no-stale-carryover across project switches + post-fix wizard-flow Playwright spec covering all 6 tabs share single store).
- **Audit (2026-05-04):** every Module 1 tab subscribes to `useModule1Store` directly — no `useState` mirrors of store values, no per-tab "draft" copies, no derived caches that could drift. The wizard's `buildWizardSnapshot` is a pure function that returns a complete `HydrateSnapshot`; the post-create handler hydrates the store once, then every tab reads back from the same store. This guarantees that data entered in the wizard surfaces unchanged in Hierarchy / Area Program / Timeline / Land & Area / Dev Costs / Financing without any "re-prompt for the same data" UX. Two Playwright specs lock the invariant: `tests/e2e/m18-wizard-flow.spec.ts` (every tab shows wizard data + reload persistence) and `tests/e2e/m18-wizard-repro.spec.ts` (no console errors / no React error boundary / Area Program tab mounts cleanly).
