# Tab 1 + Tab 2 — current state snapshot (read-only review)

**Date:** 2026-05-12.
**Scope:** Tab 1 (Project & Phases) + Tab 2 (Assets & Sub-units).
**Source:** `src/hubs/modeling/platforms/refm/components/modules/Module1ProjectPhases.tsx`, `Module1Assets.tsx`, `src/hubs/modeling/platforms/refm/lib/state/module1-types.ts`, `src/hubs/modeling/platforms/refm/lib/state/module1-store.ts`, `src/core/calculations/index.ts`.
**Purpose:** Inventory only. No code changes.

---

## TAB 1 — Project & Phases

Component: `src/hubs/modeling/platforms/refm/components/modules/Module1ProjectPhases.tsx` (617 lines).

### 1. Current fields available

#### Display Settings (project-wide formatting controls)
| Field | Type / Values | Source line | Schema field |
|-------|---------------|-------------|--------------|
| Scale | radio: `full` / `thousands` / `millions` | 156-178 | `Project.displayScale?: DisplayScale` (types.ts:303) |
| Decimals | radio: `0` / `1` / `2` / `3` | 179-198 | `Project.displayDecimals?: DisplayDecimals` (types.ts:307) |

#### Project Identity card
| Field | Input type | Source line | Schema field |
|-------|------------|-------------|--------------|
| Project Name | text | 219-226 | `Project.name: string` |
| Currency | text (uppercased, 4 chars max) | 234-241 | `Project.currency: string` |
| Project Start Date | date (ISO) | 254-261 | `Project.startDate: string` |
| Project Status | select: `draft` / `active` / `archived` | 269-281 | `Project.status: ProjectStatus` |
| Location | text (free-text) | 289-297 | `Project.location: string` |
| Project End (display only) | derived caption | 300-309 | `computeProjectEndDate(project, phases)` |
| Project End Year + Total Periods (display) | derived caption | 308 | `computeProjectTimeline(project, phases)` |

Notes:
- Wizard captures `projectType` and `country`; Tab 1 does not edit them post-creation (see types.ts:300 `projectType?: ProjectType`; 277 `country?: string`).
- `modelType` input was dropped in M2.0i Fix 1 (243-247). Inputs are always annual; `outputGranularity` toggles only on Tab 3.
- Schema field `Project.costInputMode` is DEPRECATED (types.ts:321) and never surfaced on Tab 1.
- Project-level NDA inputs (`projectNdaEnabled`, `projectRoadsPct`, `projectParksPct`, `projectNdaScope`) were moved to **Tab 2** (P8-Fix 1, see 312-316). Tab 1 explicitly does NOT render them.

#### Phases table
Per-row (PhaseRow, line 411+):

| Column | Input type | Source line | Schema field |
|--------|------------|-------------|--------------|
| Phase Name | text | 449-457 | `Phase.name: string` |
| Phase Start Date | date (ISO; falls back to `project.startDate`) | 458-466 | `Phase.startDate?: string` |
| Construction (years) | number (min 0) | 467-477 | `Phase.constructionPeriods: number` |
| Operations (years) | number (min 0) | 478-487 | `Phase.operationsPeriods: number` |
| Overlap (years) | number (min 0, max constructionPeriods) | 488-502 | `Phase.overlapPeriods: number` |
| Construction End | derived (read-only) | 503-509 | `computePhaseTimeline(...).constructionEnd` |
| Operations Start | derived (read-only) | 510-514 | `computePhaseTimeline(...).operationsStart` |
| Operations End | derived (read-only) | 515-519 | `computePhaseTimeline(...).operationsEnd` |
| Status | select: `planning` / `construction` / `operational` | 520-531 | `Phase.status?: PhaseStatus` |
| Remove | button (gated by `phases.length > 1`) | 532-549 | — |

The schema field `Phase.constructionStart` (1-indexed period number, types.ts:375) is **not surfaced as an input**. It's set automatically on add (line 107-108: `lastPhase.constructionStart + lastPhase.constructionPeriods - lastPhase.overlapPeriods`) and used as a legacy fallback when `phase.startDate` is absent.

#### Historical Baseline (operational phase only)
Renders nested in the phase row when `phase.status === 'operational'` (line 556-614). Maps to `Phase.historicalBaseline?: PhaseHistoricalBaseline` (types.ts:355-370).

Sunk-cost / opening-balance inputs:
| Field | Source line | Schema |
|-------|-------------|--------|
| Historical Capex Total | 565-567 | `historicalCapexTotal` |
| Historical Equity Contributed | 568-571 | `historicalEquityContributed` |
| Historical Debt Drawn | 572-575 | `historicalDebtDrawn` |
| Current Debt Outstanding | 576-579 | `currentDebtOutstanding` |
| Cumulative Depreciation | 580-583 | `cumulativeDepreciationCharged` |
| Net Book Value (Fixed Assets) | 584-587 | `netBookValueFixedAssets` |

Run-rate baseline:
| Field | Source line | Schema |
|-------|-------------|--------|
| Last 12 Months Revenue | 591-594 | `last12MonthsRevenue` |
| Last 12 Months Opex | 595-598 | `last12MonthsOpex` |
| Current Occupancy % | 599-602 | `currentOccupancy?` |
| Current ADR | 603-606 | `currentAdr?` |
| Current Rent Rate | 607-610 | `currentRentRate?` |

### 2. Data flow OUT of Tab 1

Every downstream tab reads these fields through the Zustand store (`useModule1Store`). Tab 1 is the canonical writer for:
- `project` (name, currency, startDate, status, location, displayScale, displayDecimals)
- `phases[]` (full Phase[] mutation: add, update, remove)

Downstream consumers:
- **Tab 2 (Assets)**: groups assets by `asset.phaseId`, renders the phase header with `computePhaseTimeline(phase, project)` (Module1Assets.tsx:314-326), reads `project.currency` / `displayScale` / `displayDecimals` for every formatted cell.
- **Tab 3 (Costs)**: `costLine.phaseId` ties each line to a phase; phase `constructionPeriods` drives the cost time grid; `phase.status === 'operational'` skips depreciation for already-depreciated periods.
- **Tab 4 (Financing)**: `tranche.phaseId` + `equity.phaseId` rely on phase identity; `phase.startDate` + `constructionPeriods` shape drawdown / repayment windows.
- **Wizard Step 2**: writes the initial `phases[]` array with `startDate` per phase.

### 3. Calculation logic surfaced on Tab 1

| Helper | File:line | Inputs | Output |
|--------|-----------|--------|--------|
| `computePhaseTimeline(phase, project)` | calculations/index.ts:2239 | phase + project | `{ constructionStart, constructionEnd, operationsStart, operationsEnd }` (ISO dates) |
| `computeProjectTimeline(project, phases)` | calculations/index.ts:2295 | project + phases | `{ startDate, endDate, endYear, totalPeriods, start, end, spanPeriods }` (legacy aliases kept) |
| `computeProjectEndDate(project, phases)` | calculations/index.ts:2345 | project + phases | latest `operationsEnd` across phases (ISO date) |

`computePhaseTimeline` math (annual model):
- `start = phase.startDate ?? project.startDate + (constructionStart-1) periods`
- `constructionEnd = periodEndDate(start, constructionPeriods, modelType)` (Dec 31 of last construction year)
- When `constructionPeriods === 0`: `operationsStart = start` (M2.0j Fix 1, line 2252)
- Otherwise: `operationsStart = addOneDay(constructionEnd) - overlapPeriods` (line 2257-2259)
- `operationsEnd = periodEndDate(operationsStart, operationsPeriods, modelType)`

### 4. Validation rules in place on Tab 1

- Currency string clipped to 4 chars + uppercased on input (`Module1ProjectPhases.tsx:239`).
- Phase `constructionPeriods >= 0` (line 474). 0 is legal (operational phase, M2.0j Fix 1).
- Phase `operationsPeriods >= 0` (line 484).
- Phase `overlapPeriods` clamped to `[0, constructionPeriods]` (line 495-498).
- Historical baseline numeric fields clamped to `>= 0` (each input at 566-606).
- `currentOccupancy` clamped to `[0, 100]` (line 601).
- Remove button hidden when `phases.length <= 1` (line 533, prevents zero-phase state).
- No validation on `startDate` format beyond browser native `<input type="date">`.
- No cross-phase overlap validation. Phases may freely overlap or leave gaps.
- No currency code validation (free-text ISO).
- No `cashPct + inKindPct = 100` enforcement on Tab 1 (parcels are Tab 2).

### 5. Edge cases — handled vs not

Handled:
- `phase.constructionPeriods === 0` (operational from day 1; UI shows "Operational from start" caption, line 504-508).
- `phase.startDate` missing on legacy v7 snapshots: falls back to `project.startDate` (line 420-422).
- `phases.length === 0` in `computeProjectTimeline`: returns `project.startDate` for all fields (calculations/index.ts:2296-2306).
- New phase add uses prior phase's `constructionEnd` as default `startDate` (line 97-102).
- Cascade-delete on `removePhase`: drops assets, sub-units, parcels, cost lines, cost overrides, financing tranches, equity contributions (store.ts:253-276).

Not handled / no UI feedback:
- Negative `phase.constructionStart` (1-indexed; no input surfaces this).
- Phase startDate before `project.startDate` (silently allowed).
- Duplicate phase IDs (auto-generated via `phase_${Date.now()}`, but no collision guard for fast double-clicks).
- Invalid ISO date strings in `phase.startDate` (downstream `computePhaseTimeline` falls back to project.startDate, but the cell still shows the bad value).
- Empty `project.startDate` (no required field validator).
- Currency code does not validate against any ISO list.
- `last12MonthsRevenue` / `last12MonthsOpex` zero on operational phase: silently allowed (no warning).
- Phase reordering: phases render in array order; no drag-and-drop / no `sort` by `startDate`.

### 6. Schema fields used by Tab 1

`Project` (types.ts:267):
- name, currency, modelType (always 'annual'), startDate, status, location
- country (optional, set by wizard)
- displayScale, displayDecimals (Tab 1 owns these)
- projectType (set by wizard, not edited here)
- outputGranularity (Tab 3 owns)
- projectRoadsPct, projectParksPct, projectNdaEnabled, projectNdaScope (Tab 2 owns)
- resultsViewMode, resultsSelectedAssetId, costInputMode (deprecated), financing (Tab 4)

`Phase` (types.ts:372):
- id, name, constructionStart, constructionPeriods, operationsPeriods, overlapPeriods, startDate, status, historicalBaseline

`PhaseHistoricalBaseline` (types.ts:355): full read+write here.

### 7. Cross-tab integration points

- Phase identity (`phase.id`) is the join key for everything Tab 2 / Tab 3 / Tab 4 hangs off. Removing a phase cascade-deletes downstream.
- `project.currency` / `displayScale` / `displayDecimals` are read by every formatted cell across all tabs (`currencyHeaderLine` + `formatScaled` / `formatAccounting`).
- `phase.startDate` + `constructionPeriods` + `operationsPeriods` + `overlapPeriods` feed `computePhaseTimeline` which the Operating End Date chip on Tab 2 (T2P3 Fix 3) consumes.
- `phase.status === 'operational'` reveals Historical Baseline inputs here; downstream Module 5 (when it ships) reads these as opening balances.

---

## TAB 2 — Assets & Sub-units

Component: `src/hubs/modeling/platforms/refm/components/modules/Module1Assets.tsx` (2,476 lines).

### 1. Current fields available

#### Land Parcels block (rows 418-596)
Per-parcel inputs (ParcelRow at 779-863):

| Column | Input type | Source line | Schema |
|--------|------------|-------------|--------|
| Parcel Name | text | 797 | `Parcel.name: string` |
| Area (sqm) | `AccountingNumberInput` (full, 0 decimals) | 802-810 | `Parcel.area: number` |
| Rate (currency / sqm) | `AccountingNumberInput` (project decimals) | 816-828 | `Parcel.rate: number` |
| Cash % | number 0-100 (auto-mirrors inKindPct = 100 - cash) | 830-840 | `Parcel.cashPct: number` |
| In-Kind % | number 0-100 (auto-mirrors cashPct) | 841-851 | `Parcel.inKindPct: number` |
| Total Value | derived: area * rate | 855 | — |
| Remove | button (gated by `parcels.length > 1`) | 856-860 | — |

Schema fields on Parcel never surfaced as inputs (P7-Fix 1 dropped them): `hasNdaDeduction`, `roadsPct`, `parksPct` (kept for back-compat; ignored when `projectNdaEnabled` is true).

Totals row (tfoot, 465-477): `parcels-total-area`, `parcels-weighted-rate`, `parcels-cash-value`, `parcels-inkind-value`, `parcels-total-value`. All via `computeLandAggregate(parcels)`.

#### NDA card (rows 481-595, P8-Fix 1)
Project-level NDA inputs that USED to live on Tab 1:

| Field | Input | Source line | Schema |
|-------|-------|-------------|--------|
| Apply Roads/Parks Deduction | checkbox | 515-520 | `Project.projectNdaEnabled?: boolean` |
| Scope | radio: `project` / `asset` | 514-549 | `Project.projectNdaScope?: 'project' \| 'asset'` |
| Roads % | number 0-100 step 0.5 (project scope only) | 553-563 | `Project.projectRoadsPct?: number` |
| Parks % | number 0-100 step 0.5 (project scope only) | 565-575 | `Project.projectParksPct?: number` |

Derivation displayed below (577-585):
- Gross Land = sum of parcel areas
- Less Roads = gross * roadsPct/100
- Less Parks = gross * parksPct/100
- Net Developable = gross * (1 - (roadsPct + parksPct)/100)
- Caveat: "Land COST stays on gross land (purchase price unchanged)."

#### Land Reconciliation block (LandReconciliationBlock, rows 2109-2353)
3-column structured table (T2P1 Fix 2+3 rewrite + T2P3 Fix 1 tolerance):
- Header: Description / Sqm / Land Value (currency)
- Total Parcel Land (gross sum across parcels)
- Less Roads / Less Parks (only when `projectNdaEnabled`)
- Net Developable Area (always; = Total Parcel when NDA off)
- Spacer + "Asset Allocations:" sub-header
- Per-asset rows (one per non-companion visible asset; companions excluded T2P2 Fix 2, 2307-2318)
- Total Allocated row with Equal / Under / Over chips on BOTH Sqm and Land Value columns
- Unassigned Land row (residual)
- Status footer (recon-status-footer): "Sqm: X / Y NDA [chip]" + "Land Cost: X / Y Total Parcel Value [chip]"
- Tolerance: `SQM_EPSILON = 1000` sqm, `VALUE_EPSILON = 1000` (currency). Within band -> Equal + "(within rounding tolerance)" caption (T2P3 Fix 1).

#### Land Allocation Mode (rows 635-670)
| Field | Input | Source line | Schema |
|-------|-------|-------------|--------|
| Mode | radio: `sqm` / `percent` / `autoByBua` | 638-647 | `Module1Store.landAllocationMode` |
| Over/Under validation banner | conditional caption | 648-670 | `validateLandAllocation()` |

Banner only shows in `sqm` mode + status != 'ok'.

#### Per-phase Asset Sections (PhaseAssetSection, 866-984)
Header (912-945):
- Phase name + timeline caption ("constructionStart to operationsEnd")
- Asset count
- "+ Add Asset" button (calls `handleAddAssetToPhase(phaseId)` at 360-383)
- Collapse chevron (default collapsed; localStorage key `m20-phase-collapsed-{phaseId}`)

Empty state (949-965): suggests asset types from `SUGGESTED_CATEGORIES_BY_PROJECT_TYPE[project.projectType]`.

#### AssetCard (986-1820)
Default-collapsed per asset (localStorage `m20-asset-collapsed-{assetId}`).

Header row (1135-1200) — 5-column grid + Visible + Delete:
| Field | Input | Source line | Schema |
|-------|-------|-------------|--------|
| Asset Name | text | 1138-1141 | `Asset.name: string` |
| Phase | select (all phases) | 1142-1153 | `Asset.phaseId: string` |
| Strategy | select: `Sell` / `Operate` / `Lease` / `Sell + Manage` | 1154-1168 | `Asset.strategy: AssetStrategy` |
| Type (optional) | text + datalist | 1167-1178 | `Asset.type: string` |
| Status | select: `planned` / `construction` / `operational` | 1180-1185 | `Asset.status?: AssetStatus` |
| Visible | checkbox | 1187-1190 | `Asset.visible: boolean` |
| Delete | button | 1191-1198 | — |

Operating End Date chip (T2P3 Fix 3, 1209-1244):
- Renders for `asset.strategy === 'Operate'` OR `asset.isCompanion === true`
- Shows `formatOperatingEndDate(computeOperatingEndDate(asset, phase))` (e.g. "Dec 2039")
- Caption: "Operating end date from Phase Setup. Edit phase operating period to change."

Useful Life form (Lease only, 1245-1249): renders `UsefulLifeForm` for `asset.strategy === 'Lease'`. Editable `Asset.usefulLifeYears?` with resolved category-default fallback via `resolveUsefulLifeYears(asset)`.

Companion badge (1250-1267): dashed-navy chip showing parent linkage + `unitsFromParent` count.

Land Allocation block (1273-1436) — HIDDEN on companion (T2P1 Fix 5a + T2P2 Fix 2):
- Mode-dependent inputs:
  - `sqm` mode: Parcel dropdown + Land Area (sqm) + Resolved Rate or Custom Rate
  - `percent` mode: Land Allocation (%)
  - `autoByBua` mode: read-only derived sqm
- Multi-parcel splits sub-section (1298-1361): "+ Add Parcel Allocation" button
- Sentinels: `PARCEL_WEIGHTED_AVG = '__weighted__'`, `PARCEL_CUSTOM_RATE = '__custom__'`
- Land Cost read-only cell at right

Areas Row (1451-1485) — HIDDEN on companion (T2P2 Fix 2):
| Field | Input | Schema |
|-------|-------|--------|
| Support Area (sqm) | `AccountingNumberInput` | `Asset.supportArea?: number` |
| Parking Area (sqm) | `AccountingNumberInput` | `Asset.parkingArea?: number` |
| GFA Override (sqm) | `AccountingNumberInput` (0 = auto) | `Asset.gfaSqm: number` |

Per-asset NDA Row (1491-1540) — HIDDEN on companion + only when `projectNdaScope === 'asset'`:
| Field | Input | Schema |
|-------|-------|--------|
| Apply NDA | checkbox | `Asset.assetNdaEnabled?: boolean` |
| Roads % | number 0-100 step 0.5 | `Asset.assetRoadsPct?: number` |
| Parks % | number 0-100 step 0.5 | `Asset.assetParksPct?: number` |

NSA/BUA/GFA hierarchy chips (1548-1582) — HIDDEN on companion (T2P2 Fix 2):
- NSA (Net Sellable) = sum of revenue sub-units
- BUA (Built-Up) = NSA + Support
- GFA (Gross Floor) = BUA + Parking
- All derived via `computeAssetAreaHierarchy(asset, subUnits)` (calculations/index.ts:593)

Area Reconciliation summary line (AssetAreaReconciliationBlock) — HIDDEN on companion (T2P2 Fix 3) + auto-hidden on non-companion when all 8 attributes are zero (T2P2 Fix 4):
- Conditions to render: at least one of `assetSubUnits.length > 0`, `BUA > 0`, `NSA > 0`, `supportArea > 0`, `parkingArea > 0`, `landSqm > 0`, `landCost > 0`, `reconRevenue > 0`
- Single line: `Verification: BUA X | NSA X | Eff X% | Land X | Land Cost X | Revenue X`
- Mismatch warning when sub-units exist with Support/Parking but NSA = 0

Sub-units table (1611-1742, SubUnitRow at 1786+):
Per-row columns (Type / Category / Area / Unit Size / Count / Rate / Total Revenue):
| Column | Input | Schema |
|--------|-------|--------|
| Type (name) | text | `SubUnit.name: string` |
| Category | select: `Sellable` / `Operable` / `Leasable` / `Support` | `SubUnit.category: SubUnitCategory` |
| Area (sqm) | `AccountingNumberInput` | `SubUnit.metricValue` (when metric='area') |
| Unit Size (sqm) | `AccountingNumberInput` (Units mode only) | `SubUnit.unitArea?: number` |
| Count | read-only derived (Units mode) | derived = `area / unitArea` |
| Rate (currency) | `AccountingNumberInput` | `SubUnit.unitPrice: number` |
| Total Revenue (No Indexation) | derived: `count * unitPrice` or `area * unitPrice` | — |
| Remove | button | — |

Metric toggle (per asset, 1601-1646):
- Radio: `area` / `units`
- `Asset.subUnitMetric?: SubUnitMetric` (P8-Fix 2c)
- HIDDEN on companion (T2P1 Fix 5c); companion is fixed units

Companion sub-unit row branch (1813-1869, T2P1 Fix 5c):
- Read-only Type (mirror from parent), Category fixed to "Operable"
- Area/Unit Size: muted dashes (no input)
- Count: derived from parent (read-only)
- Rate: editable `SubUnit.startingAdr?` (the only editable field on companion)
- No delete button

Footer summary (1768-1803) — HIDDEN on companion (T2P2 Fix 2):
- BUA / NSA / Efficiency / Land cost (4-column grid)

#### Project Totals block (732-774)
Single navy card at bottom of Tab 2:
- 4-column row: NSA / BUA / GFA / Land Cost
- 5-column row: Sellable / Operable / Leasable / Support / Parking
- All sums across visible assets via `globals` memo (331-345)

### 2. Data flow IN to Tab 2 + OUT of Tab 2

Reads (from `useModule1Store`):
- `project` (currency, displayScale, displayDecimals, projectType, projectNdaEnabled, projectNdaScope, projectRoadsPct, projectParksPct)
- `phases` (for phase grouping + dropdown + timelines + Operating End Date)
- `parcels` (full list)
- `landAllocationMode`
- `assets` (full list)
- `subUnits` (full list)

Writes:
- `setProject({...})` — NDA inputs (Project-wide)
- `addParcel / updateParcel / removeParcel`
- `setLandAllocationMode`
- `addAsset / updateAsset / removeAsset`
- `addSubUnit / updateSubUnit / removeSubUnit` (sourced from AssetCard's own `useModule1Store` hook at line 1003-1009)

Downstream consumers:
- **Tab 3 (Costs)**: reads `assets`, `subUnits`, `parcels`, `landAllocationMode` for `computeAssetCost` per asset; iterates `costLines` filtered by phase.
- **Tab 4 (Financing)**: reads asset capex (via `computeAssetCost`) as drawdown base.
- **M5 / valuation (future)**: documented hook `getOperatingEndDate(assetId)` via `computeOperatingEndDate(asset, phase)` (docs/operating-end-date-hook.md).

### 3. Calculation logic surfaced on Tab 2

| Helper | File:line | Purpose |
|--------|-----------|---------|
| `computeLandAggregate(parcels, phaseId?)` | index.ts:127 | sum of parcel area / value / cashValue / inKindValue + weightedRate |
| `computeLandReconciliation(parcels, assets, subUnits, mode)` | index.ts:380 | project-wide totals + Equal/Over/Under flags |
| `computeAssetLandSqm(asset, parcels, assets, subUnits, mode)` | index.ts:215 | per-asset sqm allocation |
| `computeAssetLandBreakdown(asset, parcels, assets, subUnits, mode)` | index.ts:298 | per-asset {landSqm, landValue, rate, splits[]} |
| `computeAssetLandCost(asset, ...)` | index.ts:409 | alias for breakdown.landValue |
| `validateLandAllocation(parcels, assets, mode)` | index.ts:431 | Over/Under banner for `sqm` mode |
| `computeAssetBua(asset, subUnits)` | index.ts:181 | sub-unit sum, falls back to `asset.buaSqm` when zero |
| `computeAssetSellableBua(asset, subUnits)` | index.ts:188 | same, excluding Support |
| `computeAssetUnitCount(asset, subUnits)` | index.ts:200 | Sellable+Operable+Leasable unit count |
| `computeAssetAreaHierarchy(asset, subUnits)` | index.ts:593 | `{nsa, bua, gfa, breakdown}` |
| `computeParcelNda(parcel)` | index.ts:626 | per-parcel NDA + effectiveNdaRate |
| `computeSubUnitArea(u)` | index.ts:155 | metric-aware: count*unitArea or metricValue |
| `computeOperatingEndDate(asset, phase)` | index.ts:91 | hospitality end-date (T2P3 Fix 3) |
| `formatOperatingEndDate(date)` | index.ts:112 | "Mon YYYY" formatter |
| `resolveUsefulLifeYears(asset)` | index.ts:2068 | Useful Life with category fallback |

**Land Allocation resolution (T2P2 Fix 1 order, `computeAssetLandSqm` at index.ts:215):**
1. `asset.isCompanion === true` -> 0 (Rule 2)
2. `multiParcelSplits` present -> sum of splits
3. `mode === 'sqm'` and explicit `landAllocation.sqm > 0` -> that value
4. `phaseParcels.length === 0` -> 0 (no parcels = no land)
5. `agg.totalAreaSqm <= 0` -> 0
6. `mode === 'percent'` and explicit `pct > 0` -> `agg.totalAreaSqm * pct / 100`
7. `phaseAssets.length === 0` -> 0 (no non-companion assets in phase)
8. `totalBua > 0` -> `agg.totalAreaSqm * (myBua / totalBua)` (autoByBua share)
9. `totalBua === 0` -> equal-share: `agg.totalAreaSqm / phaseAssets.length`

**NDA logic (project-level when enabled):**
- Gross land cost basis = `parcel.area * parcel.rate` (unchanged regardless of NDA)
- Developable area = `total area * (1 - (roadsPct + parksPct)/100)`
- Per-asset NDA contribution flows through `resolveAssetAreaMetrics` (index.ts:650+) using either project-level percentages (when `projectNdaEnabled && scope==='project'`) or per-parcel NDA when `parcel.hasNdaDeduction` (legacy back-compat).

**Area hierarchy (computeAssetAreaHierarchy):**
- NSA = sum(Sellable area) + sum(Operable area) + sum(Leasable area)
- BUA = NSA + (sum(Support sub-unit area) + asset.supportArea)
- GFA = BUA + asset.parkingArea
- GFA override: `asset.gfaSqm > 0` wins

**Land Recon chips (T2P3 Fix 1):**
- Sqm: `Math.abs(nda - allocatedSqm) < 1000` -> Equal
- Land Value: `Math.abs(totalLandValue - allocatedValue) < 1000` -> Equal
- Both surface "(within rounding tolerance)" caption when band kicks in (non-zero gap under 1000)

### 4. Validation rules in place on Tab 2

- Parcel `cashPct` + `inKindPct` auto-mirror to 100 (834-849).
- Parcel `area`, `rate` clamped `>= 0` via `AccountingNumberInput` `min={0}`.
- Asset `landAreaSqm` clamped `>= 0` (1388).
- Asset `landAreaPct` clamped `[0, 100]` (1420).
- Asset `assetRoadsPct` / `assetParksPct` clamped `[0, 100]` step 0.5 (1486, 1498).
- Sub-unit Area + Unit Size + Rate clamped `>= 0` (Sub-unit row helpers).
- Land Allocation Over/Under banner only when `mode === 'sqm'` AND `landValidation.status !== 'ok'` (validation uses 0.5 sqm threshold at index.ts:452).
- Parcel Remove button gated by `parcels.length > 1` (859).
- Strategy switch from/to Sell+Manage auto-creates / cascade-removes companion (store.ts:317-352 updateAsset).
- `updateAsset` propagates `type` edits to companions (store.ts T2P3 Fix 2).
- `removeAsset` cascade-deletes companions + sub-units + cost lines + cost overrides (store.ts:374-381).
- `removeParcel` does NOT cascade to assets (orphan `landAllocation.parcelId` references possible; resolved at render time via fallback to first phase parcel or `'(no parcels in phase)'`).

### 5. Edge cases — handled vs not

Handled:
- Companion guards: full set (T2P1 + T2P2). Companion never renders Land Allocation block, Areas Row, NDA Row, hierarchy chips, footer summary, Area Reconciliation summary. Companion sub-units auto-mirror parent's Sellable rows.
- Phase has no parcels: per-asset `computeAssetLandSqm` returns 0 (early gate).
- Phase has no non-companion assets: explicit gate (Rule 4 critical).
- `totalBua === 0` in autoByBua mode: equal-share fallback splits phase parcel area evenly across phase assets.
- Asset has no sub-units yet: `computeAssetBua` falls back to `asset.buaSqm` (P9-Fix 8).
- Brand-new empty asset: Area Reconciliation block auto-hides (T2P2 Fix 4).
- Sub-unit metric switch (Area <-> Units) preserves total area when `unitArea > 0` (M2.0L `canSwitchMetric` guard).
- Companion sub-unit mirror sync: handled in store (`syncCompanionSubUnits`) AND hydrate-time (`migrateT2CompanionSubUnits`).
- Migration retroactively syncs companion.type to parent.type (`migrateT2P3CompanionType`).
- Parcel `cashPct + inKindPct` auto-balance to 100 on edit.
- Phase reassignment: changing `Asset.phaseId` moves the card to the new phase section in Tab 2.
- Custom Rate sentinel (`'__custom__'`) and Weighted Average sentinel (`'__weighted__'`).
- Multi-parcel splits: each split uses its source parcel's own rate.

Not handled / known gaps:
- Removing a parcel with referencing assets leaves dangling `asset.landAllocation.parcelId` references (UI falls back gracefully but cost basis becomes 0 silently).
- No "over-allocated" UI banner for `percent` mode (only `sqm` mode has the banner).
- No validation that `sum(asset.landAllocation.pct)` across phase = 100 in percent mode.
- No warning when project-wide `landAllocationMode === 'percent'` but no asset has `pct` set (all assets get 0).
- Sub-unit Area + Unit Size both > 0 with Count != round(Area/UnitSize): rounding may leave fractional unit reads; UI rounds to integer for display but math uses the underlying float.
- Asset name collision: not prevented (two assets can share the same name).
- Companion sub-unit count derives from parent — if parent's `metricValue` is in area mode, conversion uses `round(metricValue / unitArea)`; if `unitArea === 0`, count derives to 0.
- Companion cost lines: companion has no land/BUA so area-based cost methods (rate_per_bua, rate_per_land, etc.) produce 0; **no UI note explaining this** (Pass 2 brief mentioned but not shipped).
- `Project.country` change at runtime: cost lines with `requiresCountry` filter stay but no UI badge tracks this.
- `Project.projectType` change at runtime: doesn't migrate existing asset types; user keeps their old types until they edit.

### 6. Schema fields used by Tab 2

`Parcel` (types.ts:407):
- id, phaseId, name, area, rate, cashPct, inKindPct
- hasNdaDeduction, roadsPct, parksPct (back-compat only; not surfaced)

`Asset` (types.ts:535):
- id, phaseId, name, type, strategy, visible
- landAreaSqm, landAreaPct (legacy mirrors)
- landAllocation: AssetLandAllocation
- gfaSqm, buaSqm, sellableBuaSqm (buaSqm + sellableBuaSqm read-only display now; sub-units source-of-truth)
- supportArea, parkingArea, buaTotal (M2.0g additions)
- parkingBaysRequired (schema lives but is NOT surfaced post-M2.0i Fix 5)
- managementAgreement, usefulLifeYears
- status, historicalBaseline
- assetRoadsPct, assetParksPct, assetNdaEnabled (P8 per-asset NDA scope)
- subUnitMetric (P8-Fix 2c)
- parentAssetId, isCompanion, companionType, unitsFromParent (P10-Fix 4 companion)

`AssetLandAllocation` (types.ts:524):
- parcelId, sqm, pct, customRate, multiParcelSplits[]
- Sentinels: `PARCEL_WEIGHTED_AVG = '__weighted__'`, `PARCEL_CUSTOM_RATE = '__custom__'`

`AssetParcelSplit` (types.ts:505): `{ parcelId, sqm }` (multi-parcel slice)

`SubUnit` (types.ts:436):
- id, assetId, name, category, metric, metricValue, unitArea, unitPrice, priceEscalationPct
- occupancyPct, operatingMargin (Operate-only Module 2 hooks)
- parentSubUnitId, startingAdr (T2P1 Fix 5c companion mirror)

`Project` fields edited from Tab 2:
- projectNdaEnabled, projectRoadsPct, projectParksPct, projectNdaScope

### 7. Cross-tab integration points

Tab 2 -> Tab 3 (Costs):
- `assets[]`, `parcels[]`, `subUnits[]`, `landAllocationMode` feed `computeAssetCost(asset, costLines, costOverrides, parcels, assets, subUnits, mode, project, phase)`.
- Cost methods consume the calc layer:
  - `rate_per_bua` reads `computeAssetBua(asset, subUnits)`.
  - `rate_per_land`, `percent_of_cash_land`, `percent_of_inkind_land` read `computeAssetLandSqm` + `computeAssetLandBreakdown`.
  - `rate_per_unit` reads `computeAssetUnitCount`.
  - `rate_per_nda` / `rate_per_roads` read `resolveAssetAreaMetrics.ndaSqm` / `roadsSqm`.
  - `rate_per_parking_bay` reads `asset.parkingBaysRequired`.
  - `percent_of_revenue_cash` / `_sale` reads M2.1 revenue hooks (stub today).
- Per-asset cost overrides keyed by `(assetId, lineId)` (Pass 10 hybrid architecture).

Tab 2 -> Tab 4 (Financing):
- Asset capex (via Tab 3 cost engine) feeds drawdown base for tranches.
- Land in-kind portion (cash vs in-kind split per parcel) excluded from cash outflow; flows to `equityInKind` via `computeCashFlowImpact`.

Tab 2 -> Module 5 / valuation (future):
- `computeOperatingEndDate(asset, phase)` returns the terminal-year anchor for cash-flow / DCF horizons (docs/operating-end-date-hook.md).

Tab 2 -> Wizard:
- Wizard Step 3 captures `Project.projectType`; Tab 2 uses it for the asset Type dropdown filter + "+ Add Asset" empty-state suggestions (`SUGGESTED_CATEGORIES_BY_PROJECT_TYPE`).

Tab 2 reverse-dependencies (consumes from elsewhere):
- Reads `phases[]` from Tab 1 (phase headers + Operating End Date).
- Reads `project.currency` / `displayScale` / `displayDecimals` from Tab 1.

### LocalStorage keys owned by Tab 2

- `m20-phase-collapsed-{phaseId}` — phase header collapse state (default true)
- `m20-asset-collapsed-{assetId}` — asset card collapse state (default true)
- `m20i-land-recon-collapsed` — Land Reconciliation expand/collapse
- `m20i-asset-recon-{assetId}` — Area Reconciliation expand state (per asset)
- Bulk event: `m20-tab2-collapse-bulk` (dispatched by Expand all / Collapse all)

---

## Snapshot rollup

- Schema version: **v8 additive** (no new fields since T2P3 Fix 3 / Pass 10).
- Module 1 baseline snapshot: 56.2 KB, sha256 `eb70b0b6e4ba` (bit-identical with regression baseline).
- Verifiers green as of 2026-05-12: T2 Pass 3 (33/0), T2 Pass 2 (24/0), T2 Pass 1 (47/0), M2.0 Pass 10 (55/0/0).
- Tab 1 is small (617 lines) and stable: it owns Project identity + Phases + Display Settings + Historical Baselines.
- Tab 2 is large (2,476 lines) and carries most of Module 1's complexity: parcels, NDA, land allocation modes, asset cards (header, land, areas, NDA per-asset, hierarchy chips, area recon, sub-units table, footer), companion handling, project totals. Companion guard surfaces are fully swept across Pass 1 + Pass 2 + Pass 3.
