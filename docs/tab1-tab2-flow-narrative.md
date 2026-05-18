# Tab 1 + Tab 2 — end-to-end narrative walkthrough

**Audience:** new developer joining the team.
**Scope:** how Tab 1 (Project & Phases) and Tab 2 (Assets & Sub-units) actually work, end-to-end. Schema, store, calc engine, render path.
**Read-only.** No code changes.

---

## 0. Quick orientation

Module 1 of REFM lives in `src/hubs/modeling/platforms/refm/`. Three pillars:

| Pillar | File | Role |
|--------|------|------|
| Schema | `lib/state/module1-types.ts` | Type definitions, default factories, enums |
| Store | `lib/state/module1-store.ts` | Zustand store. Single source of truth. Holds project + phases + parcels + assets + subUnits + costLines + costOverrides + financing + equity. Persists to `localStorage` under the `module1-store` key |
| Migrate | `lib/state/module1-migrate.ts` | Hydration entrypoint. Converts any pre-v8 / loose shape into a current v8 snapshot before the store comes alive |

Pure math lives in `src/core/calculations/index.ts`. Calc helpers are **pure functions**: they read schema fragments and return derived values; they never mutate, never write to the store, never know about React. The component layer (Tab 1, Tab 2, Tab 3, Tab 4) calls these helpers inside `useMemo` blocks and renders the result.

The render chain is one-way:
1. User edits an input
2. `onChange` handler calls a **store action** (e.g. `updatePhase(id, patch)`)
3. Zustand sets the new state, runs any inline bookkeeping (companion sync, cascade delete)
4. Persist middleware writes the new snapshot to `localStorage`
5. Every component subscribed via `useShallow` re-renders with the new state
6. Each component re-runs its `useMemo` derivations (timeline, land breakdown, area hierarchy)
7. The visible cells update

There is no event bus, no imperative cross-component message except for two `localStorage`-backed UI collapse events (`m20-tab2-collapse-bulk`, `m20-cost-row-collapse-bulk`). The state is the contract.

---

## 1. User opens Tab 1

**What they see:**
- Big H2 "1. Project & Phases" + a small currency header line (e.g. "SAR — Full Numbers").
- A blue callout explaining "Land, assets, costs, and financing all hang off a phase, so set up phases first."
- A **Display Settings** card with Scale (Full / Thousands / Millions) and Decimals (0 / 1 / 2 / 3) radio groups.
- A **Project identity** card with Name, Currency, Project Start Date, Status, Location.
- Below the identity card, a derived caption: "Project End = 2026-01-01 + max phase duration = **2039-12-31** (end year **2039**, total **14** years)".
- A **Phases** table with one row per phase: Name / Start Date / Construction (years) / Operations (years) / Overlap / Construction End / Operations Start / Operations End / Status / Remove.
- A "+ Add Phase" button at the top of the phases table.
- When a row's Status is `operational`, a nested "Historical Baseline" sub-row appears below it with 11 financial inputs for opening balances + run-rate.

**What they edit:**
- Project meta: name, currency, start date, status, location, display scale, display decimals.
- Per phase: name, startDate, constructionPeriods, operationsPeriods, overlapPeriods, status, and the optional historical baseline.

**What gets stored:**
Everything writes through `useModule1Store` actions, which set fields on `project` (single Project) or mutate `phases[]`. The Zustand store wraps these mutations with a persist middleware so each change immediately flows to `localStorage` (`module1-store` key). On next page load, `hydrationFromAnySnapshot()` in `module1-migrate.ts` reads that key, runs the migration chain, and re-seeds the store.

**Key data flow path for ANY Tab 1 edit:**
```
<input onChange> -> setProject({...}) / updatePhase(id, {...})
  -> Zustand set() with the new partial state
  -> persist middleware writes module1-store key
  -> useShallow subscribers re-render
  -> computeProjectTimeline / computePhaseTimeline re-run inside useMemo
  -> derived "Project End", "Operations End", etc. cells update
```

---

## 2. User clicks Tab 2

When the user navigates from Tab 1 to Tab 2 (Modeling Hub routes the click through the platform shell; the actual switch is just a React re-render of the active tab content):

**What's loaded (already in memory; nothing async):**
- `project` — every field including currency, displayScale, displayDecimals, projectType, projectNdaEnabled / scope / Roads % / Parks %, country.
- `phases[]` — for grouping assets and rendering phase headers.
- `parcels[]` — for the Land Parcels table.
- `landAllocationMode` — `'sqm'` / `'percent'` / `'autoByBua'`.
- `assets[]` — for asset cards (companion rows are part of this array, distinguished by `isCompanion: true`).
- `subUnits[]` — for sub-unit tables per asset.

**What's computed automatically (inside `useMemo` blocks at `Module1Assets.tsx:298-345`):**

| Memo | Helper | Output |
|------|--------|--------|
| `aggregate` | `computeLandAggregate(parcels)` | `{ totalAreaSqm, totalValue, cashValue, inKindValue, weightedRate }` |
| `landValidation` | `validateLandAllocation(parcels, assets, mode)` | `{ parcelTotalSqm, allocatedSqm, unallocatedSqm, overAllocatedSqm, status }` |
| `landReconciliation` | `computeLandReconciliation(parcels, assets, subUnits, mode)` | `{ parcelsTotalSqm, parcelsTotalValue, assetsAllocatedSqm, assetsAllocatedValue, matches, shortBy, overBy }` |
| `phaseGroups` | inline | `[{ phase, timeline, phaseAssets[] }]` sorted by phase startDate |
| `globals` | inline + `computeAssetAreaHierarchy` | Project Totals card (NSA / BUA / GFA / breakdown sums) |

Plus, **per AssetCard** (re-runs every render of that card):
- `assetSubUnits = subUnits.filter(u => u.assetId === asset.id)`
- `sellableSum / operableSum / leasableSum / supportSum` (per category)
- `parkingSum = asset.parkingArea`
- `landBreakdown = computeAssetLandBreakdown(asset, parcels, allAssets, subUnits, mode)` → `{ landSqm, landValue, rate, splits[] }`
- `landCost = landBreakdown.landValue`
- `efficiency = derivedSellable / derivedBua`
- `phaseParcels = parcels.filter(p => p.phaseId === asset.phaseId)`
- `allocation = asset.landAllocation ?? {}`

**What's user input:**
Parcel fields, NDA toggle + percentages, land allocation mode, asset header fields, asset land allocation, asset Support/Parking/GFA overrides, asset NDA per-asset (when scope='asset'), sub-unit rows.

**Collapse state:**
The phase header and each asset card default to **collapsed**. State persists per phase / per asset via `localStorage` keys `m20-phase-collapsed-{phaseId}` and `m20-asset-collapsed-{assetId}`. There's also an "Expand all / Collapse all" bulk pair at the top of Tab 2 that writes every key in one shot and then dispatches a `m20-tab2-collapse-bulk` window event; every PhaseAssetSection + AssetCard listens for that event and re-reads its own key.

---

## 3. User adds a parcel

User clicks **+ Add Parcel** in the Land Parcels block.

**Step-by-step:**
1. The button's `onClick` runs `handleAddParcel()` at `Module1Assets.tsx:347-358`.
2. `handleAddParcel` builds a Parcel object: `{ id: 'parcel_' + Date.now(), phaseId: phases[0].id, name: 'Land N', area: 50000, rate: 500, cashPct: 60, inKindPct: 40 }`. Note: the new parcel attaches to the FIRST phase by default. There's no UI to pick a phase on add.
3. It calls `addParcel(parcel)` on the store.
4. The store action at `module1-store.ts:279`: `set((s) => ({ parcels: [...s.parcels, parcel] }))`. No cascade, no bookkeeping; parcels are leaf data.
5. Persist middleware writes `module1-store` to `localStorage`.
6. Module1Assets re-renders. The `aggregate` memo recomputes (`computeLandAggregate` re-runs since `parcels` changed). The Land Parcels table gains a new row; the totals row reads the new aggregate. The Land Reconciliation block also re-runs since its memo depends on `parcels`.

**Who reads this parcel next:**
- **Same component** (Tab 2): per-asset rendering inside each AssetCard calls `computeAssetLandBreakdown(asset, parcels, …)`. If the parcel sits in the same phase as the asset and `landAllocationMode === 'autoByBua'`, the asset starts pulling a share of this parcel's area / value via `myBua / totalBua` proportion.
- **Tab 3 (Costs)**: cost methods `percent_of_cash_land`, `percent_of_inkind_land`, `rate_per_land`, `rate_per_nda`, `rate_per_roads` all read parcels through `computeAssetLandSqm` / `computeAssetLandBreakdown` / `resolveAssetAreaMetrics`.
- **Tab 4 (Financing)**: indirectly via Tab 3's asset capex (which incorporates land cost).

**Edge case:** if `phases[]` is empty (shouldn't happen — `removePhase` is gated to leave >= 1), the button does nothing (early return at line 348).

---

## 4. User adds an asset

User clicks **+ Add Asset** inside a PhaseAssetSection header.

**Step-by-step:**
1. The button's `onClick` (line 928 of `PhaseAssetSection`) calls the prop callback `onAddAsset()`, which is wired at the parent to `() => handleAddAssetToPhase(phase.id)` (line 727).
2. `handleAddAssetToPhase(phaseId)` at line 360-383 reads how many assets already exist in this phase (for the default name "Asset N") and picks a fallback parcel (`phaseParcels[0] ?? parcels[0]`).
3. It builds an Asset object: `{ id: 'asset_' + Date.now(), phaseId, name: 'Asset N', type: '', strategy: 'Sell', visible: true, gfaSqm: 0, buaSqm: 0, sellableBuaSqm: 0, parkingBaysRequired: 0, status: 'planned', landAllocation: { parcelId: fallbackParcel.id, sqm: 0 } }`.
4. It calls `addAsset(asset)` on the store.
5. The store action at `module1-store.ts:288-302` does TWO things:
   - Push the new asset into `assets[]`.
   - If the phase has **no cost lines yet** (`s.costLines.some(c => c.phaseId === phaseId) === false`), it auto-seeds the default cost catalog via `makeDefaultCostLines(phaseId, phase.constructionPeriods)`. This is the post-Pass-10 "hybrid" architecture: cost lines are project-wide masters per `(phaseId, baseId)`. Adding the first asset in a brand-new phase triggers the master seed; subsequent assets in the same phase inherit those masters automatically (no per-asset replication).
6. Persist middleware writes.
7. Re-render: the AssetCard for the new asset mounts, collapsed by default (its `m20-asset-collapsed-{id}` localStorage key reads as missing → defaults to `true`). The phase header's asset-count caption increments.

**What auto-creates:**
- The cost line catalog (only on first asset in an otherwise empty phase).
- Nothing else. The asset has no sub-units yet, no companion (companion only auto-creates when strategy switches to Sell+Manage; see Scenario 8).

**Linkage:** the asset's `phaseId` field is the join key. Tab 2 groups assets by `phaseId` in the `phaseGroups` memo; Tab 3 filters cost lines by `costLine.phaseId === asset.phaseId`; Tab 4 reads phase startDate via `asset.phaseId → phase`.

---

## 5. User adds sub-units

User expands an AssetCard, clicks **+ Sub-unit** in the Sub-units sub-section.

**Step-by-step:**
1. Button at `Module1Assets.tsx:1727` calls `handleAddSubUnit()` at line 1091-1103.
2. `handleAddSubUnit` reads the parent asset's `strategy` to pick a sensible default:
   - `Sell` → category `Sellable`, metric `units`, metricValue 50, unitArea 100, unitPrice 1,000,000
   - `Operate` → category `Operable`, metric `units`, unitPrice 800 (ADR)
   - `Lease` → category `Leasable`, metric `area`, metricValue 1000, unitPrice 1200
   - `Sell + Manage` → category `Sellable` (parent is the sell asset; the companion handles the operate side)
3. It calls `addSubUnit(subUnit)` on the store (inherited inside AssetCard via its own `useModule1Store` hook at line 1003-1009).
4. Store action at `module1-store.ts:317-321`:
   ```
   draftSubs = [...s.subUnits, subUnit]
   nextAssets = syncCompanionUnits(s.assets, draftSubs)
   nextSubUnits = syncCompanionSubUnits(nextAssets, draftSubs)
   set({ subUnits: nextSubUnits, assets: nextAssets })
   ```
   So adding a sub-unit triggers TWO bookkeeping passes:
   - `syncCompanionUnits` recomputes `unitsFromParent` on every companion whose parent owns the new sub-unit (only triggers if at least one companion exists).
   - `syncCompanionSubUnits` mirrors the parent's Sellable sub-units onto every companion (only runs when the new sub-unit is Sellable or category changes). If the new sub-unit is Sellable and the asset has a companion, the companion automatically gains a matching shadow row with ADR=0.
5. Persist middleware writes.

**How BUA rolls up:**

The pure-function chain (no state, no events; all recomputed at render):

```
SubUnit.metricValue + SubUnit.unitArea + SubUnit.metric
  ↓ computeSubUnitArea(u)
      isUnits ? metricValue * unitArea : metricValue
  ↓ summed by category inside computeAssetAreaHierarchy(asset, subUnits)
      sellableArea + operableArea + leasableArea = NSA
      NSA + (sum Support sub-units + asset.supportArea) = BUA
      BUA + asset.parkingArea = GFA
  ↓ used by computeAssetBua(asset, subUnits)
      sub-unit sum (with fallback to asset.buaSqm when zero)
  ↓ feeds computeAssetLandSqm autoByBua share
      myBua / totalBua * phaseLandSqm
  ↓ feeds Tab 3 cost engine (rate_per_bua method)
```

**How asset rolls up to phase + project:**

Inside `Module1Assets.tsx:globals` memo (line 331-345):
```
for each visible asset:
  hier = computeAssetAreaHierarchy(asset, subUnits)
  nsa += hier.nsa
  bua += hier.bua
  gfa += asset.gfaSqm > 0 ? asset.gfaSqm : hier.gfa
  sellable += hier.breakdown.sellableArea
  ...
```

This memo drives the navy **Project Totals** card at the bottom of Tab 2. There is **no Zustand-cached phase total**; everything is derived at render. The user just sees the new sub-unit's area added into the parent asset's BUA chip, the Project Totals NSA / BUA / GFA tile increment, and the Land Reconciliation block (which calls `computeAssetLandBreakdown` which calls `computeAssetLandSqm` which calls `computeAssetBua`) updates the per-asset Sqm Allocated row.

---

## 6. User toggles NDA

The NDA card lives in Tab 2 below the Land Parcels totals row (Pass 8 moved it from Tab 1). Two controls: `Apply Roads/Parks Deduction` checkbox + `Scope` radio (`project` / `asset`). When `project` scope is active, two more inputs surface: `Roads %` and `Parks %`.

**Step-by-step — user checks "Apply Roads/Parks Deduction":**
1. `<input onChange>` calls `setProject({ projectNdaEnabled: true })`.
2. Store action `module1-store.ts:setProject` does `set((s) => ({ project: { ...s.project, projectNdaEnabled: true } }))`.
3. Persist writes.
4. Re-render path (these recompute in dependency order, all on the same render cycle):

    **a. The NDA card itself** (inline IIFE at `Module1Assets.tsx:489+`):
    - Reads `project.projectNdaEnabled`, `projectNdaScope`, `projectRoadsPct`, `projectParksPct`.
    - Computes `grossNda = totalLand * (1 - (roadsPct + parksPct) / 100)`.
    - Re-renders the derivation walk: "Gross Land: 50,000 sqm / Less Roads: X / Less Parks: Y / Net Developable: Z sqm".
    - When `scope === 'asset'`, hides the project-level Roads/Parks inputs and surfaces "Per-Asset mode: each asset card below carries its own Roads % + Parks %".

    **b. The Land Reconciliation block** (`landReconciliation` memo recomputes because `assets / parcels` reference identity might not change, BUT `computeAssetLandBreakdown` reads `project` indirectly through `resolveAssetAreaMetrics` for per-asset NDA when scope='asset'). Inside LandReconciliationBlock at line 2226+, the table recomputes:
    - `totalLand = parcelsTotalSqm` (unchanged, gross)
    - `roadsSqm = totalLand * projectRoadsPct / 100` (now > 0)
    - `parksSqm = totalLand * projectParksPct / 100` (now > 0)
    - `nda = max(0, totalLand - roadsSqm - parksSqm)` (now < totalLand)
    - Roads / Parks rows in the 3-column structured table now render (they were hidden when NDA was off).
    - Net Developable Area row updates.
    - `sqmDiff = nda - allocatedSqm` → chip might flip from Equal to Under/Over.

    **c. The summary line at the top of the Recon card** (line 2197-2211):
    - When `projectNdaEnabled` is true, the comparison switches from "parcels gross" to NDA, so the read changes from "X sqm allocated, matches parcels" to "X sqm allocated, over NDA by Y sqm" (or matches / unassigned).

    **d. Every AssetCard's Land Allocation block** (when `landAllocationMode === 'autoByBua'`):
    - `landBreakdown.landSqm` recomputes via `computeAssetLandSqm`, which now indirectly reflects NDA only when the cost engine reads `resolveAssetAreaMetrics.ndaSqm`. Note: `computeAssetLandSqm` itself uses gross `agg.totalAreaSqm` (cost basis stays on gross per design). The NDA gate kicks in downstream in `resolveAssetAreaMetrics` (lines 678-688) for the `rate_per_nda` / `rate_per_roads` cost methods.

    **e. Tab 3** (not visible right now but still subscribed): its cost engine reads `project.projectNdaEnabled` next time it renders. Methods `rate_per_nda` / `rate_per_roads` now produce non-zero totals.

**Recalculation order summary on a single NDA toggle:**
```
setProject() → store set → persist → re-render →
  NDA derivation (gross / less roads / less parks / nda)
    → Land Reconciliation table chips
    → Land Reconciliation summary caption
    → AssetCard land allocation displays (autoByBua share unchanged on the sqm side; cost basis unchanged)
    → Tab 3 cost engine on next visit
```

Toggling **Scope** from `project` to `asset` triggers the same `setProject({ projectNdaScope: 'asset' })` pathway. Effects:
- Project-level Roads % / Parks % inputs disable.
- Each AssetCard's "per-asset NDA Row" (rendered when `projectNdaEnabled && projectNdaScope === 'asset'`) appears. Asset-level `assetNdaEnabled`, `assetRoadsPct`, `assetParksPct` become the inputs.
- `resolveAssetAreaMetrics` switches to per-asset deduction when the cost engine asks for `ndaSqm`.

---

## 7. User changes a phase startDate

User edits the **Phase Start Date** date input in PhaseRow (Tab 1, `Module1ProjectPhases.tsx:458-466`).

**Step-by-step:**
1. `<input type="date" onChange>` calls `onUpdate({ startDate: e.target.value })` which the parent wires to `updatePhase(phase.id, patch)`.
2. Store action at `module1-store.ts:250-252`: `phases: s.phases.map((p) => (p.id === id ? { ...p, ...patch } : p))`.
3. Persist writes.
4. The full re-render cascade triggers in this dependency order:

**Tab 1 immediate (the row the user just edited):**
- `computePhaseTimeline(phase, project)` re-runs. It reads:
  - `phase.startDate` (new value, wins over `phase.constructionStart` fallback)
  - `phase.constructionPeriods`, `operationsPeriods`, `overlapPeriods`
  - `project.modelType` (always 'annual' on new projects)
- Returns `{ constructionStart, constructionEnd, operationsStart, operationsEnd }` ISO dates.
- The row's 4 derived cells (Construction End, Operations Start, Operations End) all update.
- Special case: `phase.constructionPeriods === 0` → caption reads "Operational from start" and `operationsStart = phase.startDate` (no overlap math; M2.0j Fix 1).

**Tab 1 project-level:**
- `computeProjectTimeline(project, phases)` re-runs. It iterates every phase, computes each timeline, takes min startDate + max operationsEnd. Returns `{ startDate, endDate, endYear, totalPeriods, ...legacy aliases }`.
- `computeProjectEndDate(project, phases)` re-runs in parallel (similar logic; returns max operationsEnd ISO).
- The "Project End = X + max phase duration = **Y** (end year **Z**, total **N** years)" caption updates.

**Tab 2 (if visible — Zustand subscribers fire regardless of which tab is active; Tab 2 components re-render even when hidden, but the work is cheap because nothing is DOM-mounted):**
- `phaseGroups` memo re-runs (deps include phases + project). Phase order may change because phases sort by startDate.
- Per asset in the affected phase: `computeOperatingEndDate(asset, phase)` re-runs. The "Operating End: Mon YYYY" chip updates for every Operate / Sell / Lease / Sell+Manage / companion asset in that phase. This is the universal end-date chip — every asset reads it (recent change: dropped the strategy gate).

**Tab 3 (Costs):**
- Cost time grid is keyed off `phase.constructionPeriods`, not `startDate`. So startDate edits don't change the grid width. But cost-line `phasing` start/end period labels and any date captions update.

**Tab 4 (Financing):**
- Drawdown / repayment schedules are period-indexed, so absolute calendar dates don't shift the grid. Caption updates only.

**Nothing recomputes asynchronously.** All `useMemo` recomputations happen synchronously inside the next render. The user's keystroke → first paint with new values is sub-100ms in practice.

---

## 8. User changes asset strategy to Sell + Manage

User opens an AssetCard, picks `Sell + Manage` from the Strategy dropdown (`Module1Assets.tsx:1156-1167`).

**Step-by-step:**
1. `<select onChange>` calls `onUpdate({ strategy: 'Sell + Manage' })`.
2. The parent PhaseAssetSection wires this through `onUpdateAsset(asset.id, patch)` → `updateAsset(id, patch)` store action.
3. Store action at `module1-store.ts:317-353` does extensive bookkeeping:

```typescript
let next = s.assets.map(a => a.id === id ? { ...a, ...patch } : a);

// T2P3 Fix 2: if 'type' is in the patch, propagate to every companion.
// (Not in this scenario; we're patching strategy only.)
if ('type' in patch) { ... }

if (!('strategy' in patch)) return { assets: next };

const before = s.assets.find(a => a.id === id);
const after  = next.find(a => a.id === id);
const becomesSellManage = before.strategy !== 'Sell + Manage' && after.strategy === 'Sell + Manage';
const leavesSellManage  = before.strategy === 'Sell + Manage' && after.strategy !== 'Sell + Manage';

if (becomesSellManage) {
  // 1. Is there already a companion? (e.g. legacy snapshot) Bail.
  const existing = s.assets.find(a => a.parentAssetId === id);
  if (existing) return { assets: next };

  // 2. Read the parent's current Sellable units count.
  const sellableUnits = s.subUnits
    .filter(u => u.assetId === id && u.category === 'Sellable')
    .reduce((sum, u) => sum + Math.max(0, u.metricValue), 0);

  // 3. Build the companion via makeCompanionAsset(parent, sellableUnits).
  //    Companion id = `companion_${parent.id}`
  //    Companion name = `${parent.name} - Operate`
  //    Companion strategy = 'Operate'
  //    Companion type = parent.type (T2P3 Fix 2, mirrored)
  //    Companion.isCompanion = true
  //    Companion.companionType = 'operate'
  //    Companion.parentAssetId = parent.id
  //    Companion.unitsFromParent = sellableUnits
  //    Companion has gfaSqm = 0, buaSqm = 0, etc. (no physical attributes)
  const companion = makeCompanionAsset(after, sellableUnits);

  // 4. Mirror parent Sellable sub-units onto the new companion immediately.
  //    syncCompanionSubUnits iterates parent Sellables, creates a SubUnit
  //    shadow per row with parentSubUnitId + startingAdr = 0.
  const nextAssets   = [...next, companion];
  const nextSubUnits = syncCompanionSubUnits(nextAssets, s.subUnits);
  return { assets: nextAssets, subUnits: nextSubUnits };
}

if (leavesSellManage) {
  // Cascade-remove every companion + its sub-units + cost lines + overrides.
  const companionIds = new Set(s.assets.filter(a => a.parentAssetId === id).map(a => a.id));
  return {
    assets: next.filter(a => !companionIds.has(a.id)),
    subUnits: s.subUnits.filter(u => !companionIds.has(u.assetId)),
    costLines: s.costLines.filter(c => !c.targetAssetId || !companionIds.has(c.targetAssetId)),
    costOverrides: s.costOverrides.filter(o => !companionIds.has(o.assetId)),
  };
}
```

4. Persist writes the new state (assets + subUnits both changed).
5. Re-render:
- A new AssetCard appears under the same PhaseAssetSection (companion shares `phaseId` with parent).
- The companion renders with **none** of: Land Allocation, Areas Row, NDA Row, hierarchy chips, footer summary, Area Reconciliation summary. It carries only: the header (5-col grid), a dashed-navy companion badge, the universal Operating End Date chip, and the Sub-units table (with mirrored rows; metric toggle + Add/Delete hidden).
- The parent retains its full UI; its strategy dropdown reads "Sell + Manage" and a `Visibility` toggle continues to work.
- The companion sub-unit rows render in **companion mode** (special branch in SubUnitRow at line 1813-1869): read-only Type, read-only "Operable" category, muted dashes for Area and Unit Size, read-only Count derived from parent, editable ADR (the only edit point), Total Revenue = `count × ADR`.

**What linkage exists post-creation:**
- `companion.parentAssetId === parent.id`
- `companion.isCompanion === true`
- `companion.companionType === 'operate'`
- `companion.unitsFromParent` mirrors `sum(parent's Sellable metricValue)` and stays in sync via `syncCompanionUnits` on every sub-unit mutation
- Each companion SubUnit has `parentSubUnitId` pointing at a parent Sellable row
- Per-asset cost overrides are NOT cascaded — they belong to the parent asset; the companion has its own (initially empty) override slice

---

## 9. User changes parent asset's units

User edits the **Area** cell of a parent asset's Sellable sub-unit row (or adds a new Sellable sub-unit).

**Step-by-step (editing existing Sellable row, parent in Units mode):**
1. `<AccountingNumberInput onChange>` for the Area cell calls `onEditAreaUnits(nextArea)` at line 1949 (when `assetMetric === 'units'`).
2. The handler computes `metricValue = nextArea / unitArea` (count derives) and calls `onUpdate({ metric: 'units', metricValue })` which routes to `updateSubUnit(u.id, patch)`.
3. Store action at `module1-store.ts:322-326`:
```
draftSubs = s.subUnits.map(u => u.id === id ? { ...u, ...patch } : u)
nextAssets = syncCompanionUnits(s.assets, draftSubs)
nextSubUnits = syncCompanionSubUnits(nextAssets, draftSubs)
set({ subUnits: nextSubUnits, assets: nextAssets })
```

Now the two sync passes fire in order:

**Pass 1: `syncCompanionUnits(assets, subUnits)` at module1-store.ts:138-152.**
- Filter assets where `isCompanion && parentAssetId` exists. If none, return early (identity-preserving).
- For each companion, recompute `sellableUnits = sum of subUnits with assetId === parentAssetId && category === 'Sellable'` and assign to `companion.unitsFromParent`.
- Only mutate the asset list if a value changed; otherwise return the same array.

**Pass 2: `syncCompanionSubUnits(assets, subUnits)` at module1-store.ts:160-200 (approx).**
- For each companion, list its existing shadow sub-units indexed by `parentSubUnitId`.
- Walk the parent's current Sellable list. For each parent row:
  - If a shadow exists for `parentSubUnitId`: preserve its `startingAdr`, update `metricValue` to the new parent count, mirror name.
  - If a shadow doesn't exist: create a fresh shadow with ADR=0.
- Drop any shadow whose parent has been deleted.
- Return the new subUnits array (changed) or the input array (unchanged).

4. Persist writes (subUnits + assets both potentially changed).
5. Re-render:
- Parent's sub-unit row shows the new Area / derived Count.
- Companion's mirrored row updates: its Count cell (derived from `metricValue`) ticks to the new number. Total Revenue (`count × startingAdr`) updates.
- Companion's badge caption "(N keys from parent's Sellable sub-units)" updates if `unitsFromParent` changed.

**Critical:** the user never touches the companion's data; every edit they make on the parent flows through the store sync. No manual sync action, no event dispatch, no API call.

---

## 10. User edits a sub-unit metric (Area → Units)

User has been working in `area` mode (entering Area sqm directly). They click the **Units** radio next to the Sub-units header in an AssetCard.

**Step-by-step:**

The radio's `onChange` calls `switchAssetMetric('units')` defined inline at `Module1Assets.tsx:1652-1668`. This is **per-asset** because metric is uniform per asset since P8-Fix 2c (`Asset.subUnitMetric`).

1. **Guard pass.** For every sub-unit on the asset, run `canSwitchMetric(u, 'units')` (lib at line 1838). It checks:
   - If switching TO `area`, always OK.
   - If switching TO `units` and `unitArea === 0` while `currentArea > 0`: refuse and return `{ ok: false, reason: 'Set Unit Size before switching to Units (current area would be lost)' }`.
2. If any sub-unit returns `ok: false`, surface `window.alert(...)` and ABORT (no state change). User must set Unit Size on the offending row first.
3. Otherwise, call `onUpdate({ subUnitMetric: 'units' })` — this writes `Asset.subUnitMetric` so subsequent reads land on the new metric (and the radio reflects the new selection).
4. Then, for each sub-unit on the asset, call `switchMetric(u, 'units')` (line 1851). This returns `{ metric, metricValue }`:
   - When switching to `'units'`: `newCount = unitArea > 0 ? currentArea / unitArea : (prev was units ? metricValue : 0)`. Return `{ metric: 'units', metricValue: newCount }`.
   - When switching to `'area'`: `currentArea = prev was units ? metricValue * unitArea : metricValue`. Return `{ metric: 'area', metricValue: currentArea }`.
5. For each sub-unit, call `updateSubUnit(u.id, patch)` which triggers the same store path as Scenario 9 (with companion sync).

**What's preserved:** total area (sqm). Switching metric does NOT change the rendered Area cell because the conversion math is designed to round-trip. The sub-unit's Total Revenue may shift slightly (units mode uses `count * unitPrice`, area mode uses `area * unitPrice`), but the underlying area stays bit-stable.

**What's derived (post-switch):**
- In `units` mode the Area cell becomes `metricValue * unitArea`, Unit Size is editable, Count is read-only derived.
- In `area` mode the Area cell is `metricValue` directly, Unit Size displays as a muted dash, Count displays as a muted dash.

**Companion impact:**
- Companion sub-units always render in **units** mode (their `metric` is hardcoded to `'units'` in `makeCompanionSubUnit`). The parent's metric switch doesn't affect the companion's render — the companion always shows Count + ADR + Total Revenue.
- BUT: `syncCompanionSubUnits` runs after each `updateSubUnit`. When the parent's Sellable row converts area→units, its `metricValue` shifts from "total area" to "count". The companion mirror reads `parent.metricValue` and updates accordingly. If the parent's metric is `'units'`, count = `parent.metricValue` directly; if it's `'area'`, count = `round(parent.metricValue / parent.unitArea)`. So the companion's mirrored count stays correct in either parent metric mode.

---

## Full the reference model shape walkthrough

Now let's walk through a complete realistic scenario from scratch: a Saudi mixed-use project with **3 phases**, parcels per phase, assets in each, sub-units, and a companion. This mirrors `tests/e2e/tab2-pass2.spec.ts`'s REF_MULTIPHASE_SNAPSHOT fixture.

### Setup the project (Tab 1)

User lands on Tab 1 of a fresh project. The default state from `DEFAULT_MODULE1_STATE` (`module1-store.ts:165-176`) gave them:
- `project = makeDefaultProject()` — empty name, USD currency, today's startDate
- `phases = [defaultPhase]` — one default "Phase 1" with constructionStart=1, constructionPeriods=24, operationsPeriods=60, overlapPeriods=0
- `parcels = [defaultParcel]` — one default parcel attached to phase 1
- `costLines = makeDefaultCostLines(defaultPhase.id, 24)` — 12-line catalog (Land Cash, Land In-Kind, Construction BUA, Construction Parking, Infrastructure, Landscaping, Pre-operating, Professional Fee, Commission, Contingency, etc.)
- `financingTranches = [defaultTranche]`

The user edits:
- Project Name: "the reference model Multi-Phase"
- Currency: "SAR"
- Project Start Date: 2026-01-01
- Status: "active"
- Location: "Riyadh, Saudi Arabia"
- Display Settings: Thousands, 0 decimals

Each edit calls `setProject({ ... })`, persists, and re-renders the project-end caption.

Now phases. The default Phase 1 isn't quite right; user wants 5y construction / 8y operations. They:
1. Edit Phase 1's Construction (years) cell from 24 → 5. `updatePhase('phase-1', { constructionPeriods: 5 })`. Re-render: Construction End cell becomes "2030-12-31", Operations End becomes "2038-12-31", Project End caption updates.
2. Edit Phase 1's Operations (years) cell from 60 → 8. `updatePhase('phase-1', { operationsPeriods: 8 })`. Re-render: Operations End → "2038-12-31", Project End → 2038-12-31.

Add Phase 2:
3. Click "+ Add Phase". `handleAddPhase()` at line 104-119 builds a new Phase with `constructionStart = lastPhase.constructionStart + lastPhase.constructionPeriods - lastPhase.overlapPeriods = 1 + 5 - 0 = 6`, and `startDate = computeNextPhaseStartDate() = computePhaseTimeline(lastPhase, project).constructionEnd = "2030-12-31"`. `addPhase(phase)` writes.
4. User edits Phase 2's Start Date to "2026-06-01" (overlapping with Phase 1). Construction 5y, operations 8y. `updatePhase('phase-2', { startDate: '2026-06-01', constructionPeriods: 5, operationsPeriods: 8 })`.

Add Phase 3:
5. Click "+ Add Phase" again. Similar flow. User sets startDate to "2027-01-01", construction 5y, ops 8y.

Now there are 3 phases. The Project End caption reads max(phase.operationsEnd) which is Phase 3's `2027 + 5 + 8 - 1 = 2034 → 2034-12-31` if Phase 3 sticks but Phase 2's is `2026-06-01 + 5 + 8 - 1 ≈ 2038` so Phase 2 actually trails latest.

### Move to Tab 2 — Land Parcels

User clicks Tab 2. The default `phase-1` parcel is still there. User wants three parcels, one per phase:

1. Click the default parcel's Name cell, rename to "Parcel 1". `updateParcel('parcel-1', { name: 'Parcel 1' })`.
2. Edit Area to 16,348 sqm, Rate to 98,450 SAR/sqm, Cash 80%, In-Kind 20%. Each is a separate `updateParcel` call.
3. Click "+ Add Parcel". New parcel attaches to `phases[0]` (Phase 1) by default. User edits its phaseId... wait, there's NO PhaseId selector on parcel rows. The user is stuck with phase-1 unless they edit the data directly. **This is a known UX gap.** (Schema field `Parcel.phaseId` exists; the UI lets the user only edit name / area / rate / cashPct / inKindPct on the visible row.)

Hmm. In practice, the user would need:
- For Phase 2 parcel: either edit JSON in localStorage, or wait for a future "Phase" dropdown on Parcel row.
- The reference fixture in `tab2-pass2.spec.ts` works because it seeds the snapshot directly into localStorage with the correct `parcel.phaseId` values pre-set.

So as of today, the UI for adding multiple parcels across multiple phases is **not fully wired**. Users who want phase-specific parcels need to seed via wizard or via direct localStorage manipulation.

Workaround in the narrative: assume the user did seed it. Now they see 3 parcels with `phaseId` = phase-1, phase-2, phase-3 respectively.

### Configure NDA

User decides to apply a Roads/Parks deduction project-wide. They check **Apply Roads/Parks Deduction**. Scope is `project` by default. They set Roads % = 15, Parks % = 5.

- 3 `setProject(...)` calls: one for `projectNdaEnabled: true`, one for `projectRoadsPct: 15`, one for `projectParksPct: 5`.
- NDA derivation card updates: Gross Land = 16,348 + Phase 2 parcel + Phase 3 parcel = total. Less Roads = total × 15%. Less Parks = total × 5%. Net Developable = total × 80%.

### Land Allocation Mode

User leaves landAllocationMode at `autoByBua` (the default). This is the cleanest mode because every asset's land share derives from its BUA proportion within its phase, with no manual entry. The Land Allocation Mode card sits below the parcels block; no validation banner shows.

### Add assets to Phase 2

User expands the Phase 2 header (clicks the chevron). The PhaseAssetSection is empty. Empty-state caption says "No assets yet in Phase 2. Suggested for Mixed-Use: ...". User clicks "+ Add Asset" inside the Phase 2 header.

- `handleAddAssetToPhase('phase-2')` runs. New asset has `phaseId: 'phase-2'`, name "Asset 1", strategy "Sell", landAllocation pointing to `parcels[0]` (which is Parcel 1 in phase-1 — wrong default, but user will fix).
- `addAsset` fires. Phase 2 has no cost lines yet, so it ALSO seeds the 12-line cost catalog at `phaseId === 'phase-2'`. The catalog appears on Tab 3 next time user visits.

User opens the new asset card:
- Rename to "Branded Apt T2&T3".
- Type: "Branded Apartments".
- Strategy stays at Sell.
- Land Allocation block: user picks "Parcel 2 (98,450 SAR/sqm)" from the parcel dropdown (the dropdown lists `phaseParcels` = parcels with `phaseId === 'phase-2'`, plus the Weighted Average and Custom Rate sentinels).
- Areas Row: user leaves Support / Parking / GFA at 0.
- Sub-units: user clicks "+ Sub-unit" → row appears with category=Sellable, metric=units, metricValue=50, unitArea=100, unitPrice=1,000,000.
- Edits row: name "1BR", metricValue 200 (count of units), unitArea 65 (sqm per unit). Sub-unit area = 200 × 65 = 13,000 sqm.
- Adds two more rows: "2BR" (300 units × 100 sqm = 30,000 sqm), "3BR" (100 units × 150 sqm = 15,000 sqm). Total BUA so far: 58,000 sqm. Plus a Support sub-unit "Common Areas" = 8,000 sqm.

After each row add / edit: `addSubUnit` / `updateSubUnit` → `syncCompanionUnits` (no companion yet, no-op) → `syncCompanionSubUnits` (no companion, no-op) → persist → re-render. The AssetCard's NSA / BUA / GFA chips update. The Project Totals NSA / BUA tile increments.

User adds a second Phase 2 asset, "Residential Tower 01":
- Same flow. Strategy: starts at Sell but user picks Sell + Manage.
- **THIS IS THE COMPANION TRIGGER.** Going from Sell → Sell+Manage flips `becomesSellManage = true`. The store auto-creates `companion_${parent.id}` with:
  - name = "Residential Tower 01 - Operate"
  - strategy = "Operate"
  - type = parent.type ("Residential Tower" or whatever the user typed; mirrors parent per T2P3 Fix 2)
  - isCompanion = true, companionType = 'operate', parentAssetId = parent.id
  - phaseId = 'phase-2'
  - All physical attributes zero
- At this moment the parent has no Sellable sub-units yet (user just changed strategy), so `unitsFromParent = 0` and the mirror is empty.

User scrolls down. The companion AssetCard appears under Phase 2 (between Branded Apt and the bottom). Companion shows: header (with read-only mirrored type), dashed-navy companion badge, Operating End Date chip, empty Sub-units table with "Mirrored from parent. Edit ADR only." note.

User adds Sellable sub-units to the parent Residential Tower 01:
- "Branded Apt" (150 units × 200 sqm = 30,000 sqm).
- "Penthouse" (10 units × 500 sqm = 5,000 sqm).

After each `addSubUnit`:
- `syncCompanionUnits` recomputes `companion.unitsFromParent = 160`.
- `syncCompanionSubUnits` mirrors the two new Sellable rows onto the companion: "Branded Apt" shadow (count=150, ADR=0), "Penthouse" shadow (count=10, ADR=0).
- The companion card now shows two mirrored sub-unit rows with the ADR cell editable.

User edits the companion's ADR cells:
- "Branded Apt" ADR: 1,200 SAR/night.
- "Penthouse" ADR: 5,000 SAR/night.
- Each calls `updateSubUnit(shadow.id, { startingAdr: x, unitPrice: x })`. `syncCompanionSubUnits` runs but no change is detected (the shadow already exists, contents identical except for ADR), so the no-op short-circuit applies.

### Add assets to Phase 3

User expands Phase 3, adds "Hotel 01" (Operate) + "Retail Mall" (Lease). Similar flow but no companion (Operate / Lease alone don't trigger Sell+Manage logic).

For Hotel 01:
- Strategy = Operate.
- Operating End Date chip renders sourced from Phase 3's timeline (2034-12-31).
- User adds Operable sub-units: "Standard Room" (100 keys, ADR 800 SAR/night), "Suite" (20 keys, ADR 1,500 SAR/night).
- Sub-units are NOT mirrored anywhere (Hotel is not a Sell+Manage parent).

For Retail Mall:
- Strategy = Lease.
- Operating End Date chip renders (same Phase 3 end date). UsefulLifeForm is **retired** (universal Operating End Date now applies; recent change). No depreciation horizon input.
- User adds Leasable sub-units: "Anchor" (5,000 sqm, rent 800 SAR/sqm/year), "Inline" (3,000 sqm, rent 1,200 SAR/sqm/year).

### What the system renders now (end state)

**Tab 1:**
- Project caption: "Project End = 2026-01-01 + max phase duration = 2034-12-31 (end year 2034, total 8 years)" (or whichever phase's operationsEnd is latest).
- Phases table: 3 rows, all read-only derived cells (constructionEnd / operationsStart / operationsEnd) computed via `computePhaseTimeline`.

**Tab 2 — Land Parcels block:**
- 3 rows (Parcel 1, Parcel 2, Parcel 3), each in their respective phase per `phaseId`.
- Totals row: total area, weighted rate, cash/in-kind values, total value via `computeLandAggregate(parcels)` (project-wide, all phases summed).

**Tab 2 — NDA card:**
- Apply Roads/Parks: ON. Scope: project. Roads 15%, Parks 5%.
- Derivation: Gross = sum, Less Roads = 20%, Net Developable = 80%.

**Tab 2 — Land Reconciliation:**
- Total Parcel Land row: gross sum.
- Less Roads (15%): roadsSqm row.
- Less Parks (5%): parksSqm row.
- Net Developable Area row: 80% of gross.
- Asset Allocations: 4 rows (Branded Apt, Residential Tower 01, Hotel 01, Retail Mall). Companion is EXCLUDED (filter `a.visible && a.isCompanion !== true` at line 2307).
- Each asset's Sqm Allocated = autoByBua share within its phase:
  - Branded Apt: 58,000 BUA / (58,000 + 35,000) total Phase 2 BUA × Phase 2 parcel area.
  - Residential Tower: 35,000 BUA / 93,000 × Phase 2 parcel.
  - Hotel: hotel BUA / (hotel + retail) BUA × Phase 3 parcel.
  - Retail Mall: retail BUA / total × Phase 3 parcel.
- Total Allocated chip: ✓ Equal (within 1000 sqm of NDA per T2P3 Fix 1 tolerance) or Under / Over depending on math.
- Status footer: "Sqm: X / Y NDA [chip]" + "Land Cost: X / Y Total Parcel Value [chip]" + optional "(within rounding tolerance)" caption.

**Tab 2 — Per-phase Asset Sections:**
- Phase 1: empty (no assets). Empty-state caption.
- Phase 2: Branded Apt + Residential Tower 01 + Residential Tower 01 - Operate (companion).
- Phase 3: Hotel 01 + Retail Mall.

**Tab 2 — Project Totals (bottom):**
- NSA = sum across visible non-Support sub-units across every asset (including parent + companion-mirrored — note: companion sub-units have `metric='units'` + `unitArea=0`, so `computeSubUnitArea` returns 0 for them, so they DON'T inflate NSA).
- BUA = NSA + Support.
- GFA = BUA + Parking.
- Land Cost = parcel total value (gross, not NDA-adjusted).

**Tab 3 (when user visits):** 
- Cost lines per phase. The 12-default catalog is seeded for each phase the moment its first asset is added.
- Cost engine runs `computeAssetCost(asset, ...)` for each asset. Each cost line resolves its method against the asset's BUA / NSA / land / units / parking. Per-asset overrides slot in via the `costOverrides[]` array. The companion's BUA = 0, so area-based cost methods produce 0 for the companion (the engine returns 0 silently — no UI note today; that's an open TODO from the Pass 2 brief).

**Tab 4 (Financing):** Drawdown / repayment schedules per tranche per phase. Reads asset capex (via Tab 3) as drawdown base.

### Hydration on next page load

User refreshes the page. Bootstrap path:
1. `module1-store.ts` Zustand instance constructs. Persist middleware kicks in.
2. Middleware reads `module1-store` from localStorage.
3. The raw JSON goes through `hydrationFromAnySnapshot(raw)` in `module1-migrate.ts:1543`.
4. That function:
   - Detects schema version (v8 / v7 / pre-v7 / loose / null).
   - Picks the appropriate migration chain. For v8: `stripV8Wrapper` which then runs the cascade.
   - The cascade (after the strip): `migrateM20gParkingSubUnits → migrateM20jPhasing → migrateM20lDedupeCostLineIds → migrateM20Pass4Inheritance → migrateM20Pass5Categories → migrateM20MFinancing → migrateM20mPass6DisplayDefaults → migrateM20mPass6NdaToProject → migrateM20mPass2Financing → migrateM20costsPass7PerAsset → migrateM20mPass3Financing → migrateM20costsPass8 → migrateM20mPass4Financing → migrateM20costsPass10Hybrid → migrateT2CompanionSubUnits → migrateT2P3CompanionType`.
   - Each migration is idempotent and additive; a current snapshot passes through unchanged.
5. The migrated snapshot is set as the initial store state.
6. Tab 1 and Tab 2 mount. `useMemo` derivations run. localStorage collapse keys (`m20-phase-collapsed-{id}` etc.) restore default-collapsed UI state.
7. The user picks up exactly where they left off.

---

## Cross-tab summary table

| Field | Owner tab | Reader tabs |
|-------|-----------|-------------|
| `project.name / currency / location / status` | Tab 1 | All tabs (currency header line) |
| `project.startDate` | Tab 1 | All tabs (timeline math) |
| `project.displayScale / displayDecimals` | Tab 1 | Every formatted cell in every tab |
| `project.projectType` | Wizard Step 3 | Tab 2 asset type catalog filter |
| `project.projectNdaEnabled / Roads / Parks / Scope` | Tab 2 NDA card | Tab 2 Land Recon, Tab 3 cost methods |
| `phase.startDate / construction / operations / overlap / status` | Tab 1 | Tab 2 phase headers + Operating End Date, Tab 3 grid, Tab 4 windows |
| `phase.historicalBaseline` | Tab 1 | Module 5 (future) |
| `parcel.area / rate / cash% / inKind%` | Tab 2 | Tab 3 land cost methods, Tab 4 in-kind equity |
| `landAllocationMode` | Tab 2 | Tab 3 cost engine |
| `asset.phaseId / strategy / type / status / visible` | Tab 2 | Tab 3 + Tab 4 |
| `asset.landAllocation` | Tab 2 | Tab 3 |
| `asset.supportArea / parkingArea / gfaSqm` | Tab 2 | Tab 3 |
| `asset.subUnitMetric` | Tab 2 (asset-level radio) | SubUnitRow render mode |
| `asset.isCompanion / parentAssetId / unitsFromParent` | Auto via `updateAsset` | Tab 2 sub-unit mirror, Tab 3 cost engine filters companion out of land/BUA |
| `subUnit.category / metric / metricValue / unitArea / unitPrice` | Tab 2 | Tab 3 cost methods (rate_per_bua, rate_per_unit), Module 2 Revenue (future) |
| `subUnit.parentSubUnitId / startingAdr` | Auto via `syncCompanionSubUnits` | Module 2 Revenue (future ADR × occupancy × days) |

---

## Performance notes

- Every `useMemo` is keyed on the array references of its dependencies. Zustand returns the same array reference if no item changed (the `set` callback returns a fresh array only when contents differ, e.g. `syncCompanionUnits` returns the input array unchanged when no companion needed updating).
- `useShallow` is the default subscriber so component re-renders only fire when the selected slice actually changes.
- The biggest re-render trigger is a phase startDate change because it ripples through every per-asset Operating End Date chip across every Tab 2 AssetCard (and every Tab 3 + Tab 4 derivation). Even so, this is a few milliseconds; the calc helpers are O(n) over assets / sub-units.
- The render layer NEVER calls back into the store inside a render (`useShallow` returns shape; component reads what it needs). All store mutations happen inside event handlers (`onClick`, `onChange`, `onBlur`).

---

## Where to look when something goes wrong

| Symptom | First place to check |
|---------|----------------------|
| "Asset shows 0 land" | `computeAssetLandSqm` resolution order in `src/core/calculations/index.ts:215`. Check `asset.isCompanion`, `phaseParcels` filter, `phaseAssets` filter, `totalBua` |
| "Companion doesn't appear after Sell+Manage" | `module1-store.ts:328-339` becomesSellManage branch. Check `existing` short-circuit (was there already a companion?) |
| "Companion sub-units don't mirror" | `syncCompanionSubUnits` at `module1-store.ts:160+`. Verify the parent's sub-unit category is exactly `'Sellable'` |
| "Phase timeline reads wrong date" | `computePhaseTimeline` at `index.ts:2239`. Check `phase.startDate` is a valid ISO string |
| "Operating End Date is null / shows '-'" | `computeOperatingEndDate` at `index.ts:91`. Returns null when phase missing or `operationsPeriods <= 0` |
| "Land Recon chip stuck on Under by a few sqm" | T2P3 Fix 1: tolerance is 1000 sqm. Anything smaller should already read Equal |
| "Edits to phase X don't propagate to assets" | `useShallow` selector in the consuming component — make sure it pulls `phases` not just one phase reference |

---

That's the full picture. Tab 1 is the timeline owner, Tab 2 is the inventory owner, the store is the contract, and the calc engine produces every derived number. Two background bookkeeping passes (`syncCompanionUnits` + `syncCompanionSubUnits`) keep companions tethered to their parents without any explicit sync action. Migrations run once at hydrate; everything else is reactive via React + Zustand.
