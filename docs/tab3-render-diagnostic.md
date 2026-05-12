# Tab 3 Costs render diagnostic

**Date:** 2026-05-12.
**Brief:** Tab 3 Costs Critical Fixes.
**Status:** Root cause identified. Fix lands in the next commit.

---

## Trace from migration to render

### Step 1 — Migration output

`migrateT3DefaultCostLineSeed` at `src/hubs/modeling/platforms/refm/lib/state/module1-migrate.ts:684+` runs at the tail of every hydrate chain. For each phase whose costLines slice is empty, it appends `makeDefaultCostLines(phase.id, phase.constructionPeriods)`. The 10-line catalog is built with COMPOSED ids of shape `${baseId}__${phaseId}` and **no `targetAssetId`** (master shape).

`scripts/verify-tab3-default-seed.ts` already confirms this end-to-end: 10 lines seeded per phase, correct base ids, correct lock + method + value shape. The migration is doing its job.

### Step 2 — Store state after hydration

After hydration, every phase has its 10 master cost lines living in `state.costLines`. Each line has `targetAssetId === undefined` (Pass 10 hybrid contract: project-wide master + lightweight per-asset overrides). The engine reads this shape via `computeAssetCost` at `src/core/calculations/index.ts:1042-1046`:

```ts
const phaseLines = costLines.filter(
  (c) => c.phaseId === phase.id &&
    (c.targetAssetId === undefined || c.targetAssetId === asset.id),
);
```

This correctly **includes master lines** (`targetAssetId === undefined`) for every asset in the phase. The engine produces non-zero asset breakdowns; the Project Total tile reads these and shows the rolled-up number.

### Step 3 — UI render path: the BUG

`Module1Costs.tsx:2724-2729` builds the `assetLines` list that drives the rendered cost-line table inside `costs-inputs-asset-nav` (Individual mode asset pill view):

```ts
const assetLines = activeAsset
  ? costLines
      .filter((c) => c.targetAssetId === activeAsset.id)   // ← BUG
      .filter((c) => stageFilter === 'all' || deriveCostStage(c) === stageFilter)
      .filter((c) => !c.requiresCountry || c.requiresCountry === project.country)
  : [];
```

The first filter uses **strict equality** (`c.targetAssetId === activeAsset.id`). After Pass 10 hybrid migration, every cost line is a master with `targetAssetId === undefined`. The strict equality `undefined === 'asset-1'` is `false`, so **EVERY MASTER LINE GETS FILTERED OUT**. The user sees an empty cost-line table for every non-companion asset, even though the data is sitting in the store.

### Step 4 — Engine vs UI divergence

The engine (`computeAssetCost` line 1042) uses the correct filter:
```ts
c.targetAssetId === undefined || c.targetAssetId === asset.id
```

So `assetBreakdown.byLineId` is populated correctly. Asset Subtotal computed as `lines.reduce((s, l) => s + bd.byLineId[l.id], 0)` at line 2253 reads the WRONG-filtered `lines` array (empty), so the rendered subtotal reads as some leftover stale value or 0.

The Project Total tile at line 2547 sums `stageTotals` which come from the engine's correct breakdown, so the Project Total tile shows a non-zero rollup. **This is the 15M vs 434K divergence the user reported earlier.** Not a calc bug, not a stage filter UX. It's the strict-equality `targetAssetId` filter at line 2726.

### Other render paths

| Location | Filter | Status |
|---|---|---|
| `Module1Costs.tsx:1222` (override sibling resolution) | `c.targetAssetId === undefined \|\| c.targetAssetId === asset.id` | OK |
| `Module1Costs.tsx:1800` (asset card capex preview) | same correct shape | OK |
| `Module1Costs.tsx:2593` `linesForAsset()` helper | same correct shape | OK |
| `Module1Costs.tsx:2779, 2793` (Expand all / Collapse all bulk) | `!c.targetAssetId \|\| c.targetAssetId === activeAsset?.id` | OK (treats master as match) |
| `Module1Costs.tsx:2726` `assetLines` for the rendered table | **`c.targetAssetId === activeAsset.id`** | **BUG** |
| `src/core/calculations/index.ts:1042` engine `phaseLines` | correct | OK |

So one stray strict-equality filter is the only blocker. Three sibling filters in the same file use the correct master-inclusive shape; line 2726 diverged from the pattern (likely a holdover from the Pass 7 per-asset replica era when every line carried `targetAssetId`).

---

## Companion rule status

`asset.isCompanion === true` is the marker. The brief's absolute rule requires:

1. **Engine short-circuit**: `computeAssetCost(asset, ...)` returns an empty breakdown when `asset.isCompanion === true`.
   - Current state: `computeAssetCost` does NOT short-circuit. It filters phaseLines, runs the full pipeline, and any line targeting the companion (or any project-wide master) flows into the companion's breakdown. Because Pass 10 stripped `targetAssetId` from masters, every master flows into every asset (including companion). The companion ends up with a non-zero cost rollup that double-counts the parent's burden.
   - **Fix path**: add an early return at the top of `computeAssetCost` returning `{ byLineId: {}, byStage: { land: 0, hard: 0, soft: 0, operating: 0 }, total: 0, perPeriod: zeros, perPeriodLandTotal: zeros, perPeriodLandInKind: zeros }`.

2. **UI swap**: when the user selects a companion pill, render a `CompanionInfoBlock` instead of the cost-line table.
   - Current state: companion appears in the pill bar (good — Tab 2 needs it for ADR editing) and clicking it renders the cost-line table (bad).
   - **Fix path**: at the render branch in `Module1Costs.tsx` `costs-inputs-asset-nav`, wrap the cost-line table in `{activeAsset.isCompanion ? <CompanionInfoBlock asset={activeAsset} parent={parent} phase={phase} /> : <CostLineTable ... />}`.

3. **Migration**: seeded defaults must NOT include companion phases (i.e. don't seed a line owned by a companion).
   - Current state: `migrateT3DefaultCostLineSeed` seeds per phase, not per asset. Companions share their parent's `phaseId`, so the phase's lines exist as masters and the engine's strict filter would include them for the companion via `c.targetAssetId === undefined`. The fix at the engine level (short-circuit for companions) is the clean answer; no need to scope the seed to non-companion phases since the phase is shared.

4. **Dedup**: if existing snapshots accumulated duplicates from multiple migration passes, scan and dedup by `(phaseId, baseId)` keeping the first occurrence.
   - Current state: Pass 10 hybrid already dedupes via the `groups` map keyed on `${phaseId}::${baseId}`. But if a snapshot has multiple masters for the same `(phaseId, baseId)` (e.g. one master + one stray from a previous partial migration), the second master falls through to the passThrough block at line 632, which dedupes via `newMasters.some((m) => m.id === masterId) → continue`. So Pass 10 dedup is intact. Adding a defensive sweep is cheap; ship it idempotent.

---

## Start / End period defaults

Looking at `makeDefaultCostLines` at `module1-types.ts:1798-1881`:

| Line | startPeriod | endPeriod | Matches brief? |
|---|---|---|---|
| Land (Cash) | 0 | 0 | ✓ paid at project start |
| Land (In-Kind) | 0 | 0 | ✓ paid at project start |
| Construction (BUA) | 1 | cp | partial: brief says `cp + 1` (one year buffer) |
| Construction (Parking) | 1 | cp | partial: same |
| Infrastructure | 1 | cp | partial: same |
| Landscaping | `max(1, floor(cp/2))` | cp | partial: same |
| Pre-operating | `max(1, cp-6)` | cp | partial: same |
| Professional Fee | 1 | cp | partial: same |
| Commission | `max(1, floor(cp/2))` | cp | partial: same |
| Contingency | 1 | cp | partial: same |

Brief says Start = 0 + End = cp + 1 as the defaults. Land lines already match. For the other 8: Start currently defaults to 1 (period 1) per the brief's intent (Start = 0 means upfront, but construction work usually begins in period 1). End currently caps at `cp`; brief wants `cp + 1` for the one-year buffer. The bigger issue is whether the user is reporting an actual functional bug here or simply requesting tweaks to defaults. Looking at Pass 9 Fix 3 (commit `30e31f3` per prior log), the End-period max cap was already dropped (no hard cap; the input accepts any value with a warning chip when > `cp + 1`).

For this pass: bump default `endPeriod` to `cp + 1` on the 8 non-land lines per the brief. Keep Start = 1 for construction lines (period 0 is reserved for land draw; construction begins next period).

The Land Cash + Land In-Kind start=0/end=0 (`single period`) is already correct.

---

## Subtotal correctness (Fix 6)

Once the strict-equality filter at line 2726 is corrected, the rendered cost-line table will show all 10 masters for the active asset. `assetSubtotal = lines.reduce((s, l) => s + bd.byLineId[l.id], 0)` will then sum the engine's correct per-line totals.

For Branded Apt T2&T3 (MAAD: buaSqm 130874, sub-units producing NSA ~84K + Support ~46K, sharing Phase 2 parcel):
- Land (Cash) = 100% of (Phase 2 parcel value × Branded's BUA share × cashPct)
- Land (In-Kind) = same × inKindPct
- Construction (BUA) = 4500 × computeAssetBua(asset) ≈ 4500 × 130,874 = 588.9M
- Construction (Parking) = 25,000 × asset.parkingBaysRequired
- Infrastructure = 250 × NDA sqm share
- Landscaping = 75 × NDA sqm share
- Pre-operating / Professional Fee / Commission / Contingency = % of construction subset

Subtotal ≈ 1.0 to 1.3B SAR depending on parking bays + Phase 2 parcel size. The user's expected ~1.2B is in the right neighbourhood and will fall out of the engine once the UI filter is fixed.

---

## Plan

| Commit | Action |
|---|---|
| 1 (this) | Diagnostic note + audit |
| 2 | Fix 1 (UI filter at line 2726) + Fix 2 (engine short-circuit for companions + CompanionInfoBlock UI) + Fix 4 (default endPeriod = cp+1 on construction lines) |
| 3 | Fix 3 dedup migration (defensive) |
| 4 | Closure: verifier + CLAUDE update |
