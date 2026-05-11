# M2.0 Costs Pass 9 - Land Zero Render Diagnostic

**Date:** 2026-05-12
**Status:** Diagnostic only. No code changes in this commit.

## TL;DR

Land (Cash) + Land (In-Kind) cost lines render `0` (or `0.00 K`) in the Tab 3 Total column because the autoByBua land allocation path calls `computeAssetBua(asset, subUnits)` directly, and that helper has a narrower fallback than `resolveAssetAreaMetrics` does. When an asset carries one or more sub-unit rows with zero area (a common state for projects in early modelling), `computeAssetBua` returns 0, which collapses `landSqm = 0` -> `landValue = 0` -> `cashLandValue = 0` -> `Land cost total = 0`.

`resolveAssetAreaMetrics` was patched in M2.0L Fix 4 / Pass 3 widening to fall back to `asset.buaSqm` when the sub-unit-derived BUA is zero (`src/core/calculations/index.ts:650-652`). `computeAssetBua` was NOT patched, so the cost engine still walks the broken path for land sizing in autoByBua mode.

Previous passes claimed to fix Land rendering but only touched downstream surfaces (formatters, migrations, UI). The calc-engine fallback gap survived every pass.

## Trace (file:line refs)

### Cost line creation

`src/hubs/modeling/platforms/refm/lib/state/module1-types.ts:1773-1785`:
```ts
{
  id: id('land-cash'), phaseId, name: 'Land (Cash)',
  method: 'percent_of_cash_land', value: 100,
  stage: 'land', scope: 'direct', allocationBasis: 'land_share',
  startPeriod: 0, endPeriod: 0, phasing: 'even',
  isLocked: true,
},
{
  id: id('land-inkind'), phaseId, name: 'Land (In-Kind)',
  method: 'percent_of_inkind_land', value: 100,
  ...
}
```

Master lines, `targetAssetId` undefined. `value: 100` = take 100% of the asset's cashLandValue / inKindLandValue.

### Pass 7 migration replicates per asset

`src/hubs/modeling/platforms/refm/lib/state/module1-migrate.ts:291-312`: walks master cost lines, emits one replica per visible asset with `targetAssetId: a.id` and id `${baseId}__${phaseId}__${assetId}`. Replicas keep `method: 'percent_of_cash_land'`, `value: 100`.

### CostRow render

`src/hubs/modeling/platforms/refm/components/modules/Module1Costs.tsx:1310-1334`: for each line in `assetLines`:
```ts
const total = breakdown.byLineId[line.id] ?? 0;
return <CostRow ... total={total} ... />;
```

`Total` cell at `src/hubs/modeling/platforms/refm/components/modules/Module1Costs.tsx:720-721`:
```tsx
<div ... data-testid={`cost-${asset.id}-${line.id}-total`}>
  {formatScaled(total, scale, decimals)}
</div>
```

`formatScaled(0, 'thousands', 0)` -> `"0 K"`. The cell renders `0 K`, which the user reads as zero. (Side note: per Pass 9 Fix 4 + Pass 4 Fix 6 already shipped, `formatScaled` should be replaced with `formatAccounting` for the Cost Inputs table so zero renders as `-` rather than `0.00 K`. That polish is orthogonal to this root cause.)

### Why `total` is zero

`breakdown.byLineId[line.id]` -> populated at `src/core/calculations/index.ts:1099` via `{ ...directTotals, ...percentTotals }`. For `percent_of_cash_land` (a direct method), the relevant write is `directTotals[r.line.id] = lineTotal * allocFactor` at line 1068. `lineTotal` comes from `calculateItemTotal` at line 1052 with method=`percent_of_cash_land`:

`src/core/calculations/index.ts:781-784`:
```ts
case 'percent_of_cash_land':
  return m.cashLandValue * (clamp(v, 0, 100) / 100);
```

So `lineTotal = m.cashLandValue * (100/100) = m.cashLandValue`. If `cashLandValue == 0`, lineTotal=0, byLineId[id]=0, Total cell renders 0.

### Why `cashLandValue` is zero

`resolveAssetAreaMetrics` at `src/core/calculations/index.ts:564-691`:
```ts
const breakdown = computeAssetLandBreakdown(asset, parcels, assets, subUnits, mode);
// ...
const landValue = breakdown.landValue;
// ...
if (breakdown.splits.length > 0) {
  // multi-parcel splits path (cashPct/inKindPct per split source parcel)
} else {
  const agg = computeLandAggregate(phaseParcels);
  const valueShare = agg.totalValue > 0 ? landValue / agg.totalValue : 0;
  cashLandValue = agg.cashValue * valueShare;
  inKindLandValue = agg.inKindValue * valueShare;
}
```

If `landValue == 0`, then `valueShare == 0`, then `cashLandValue == 0` even when `agg.cashValue > 0` (parcels have area + rate + cashPct).

### Why `landValue` is zero in Branch 3 (autoByBua / legacy)

`computeAssetLandBreakdown` at `src/core/calculations/index.ts:269-279`:
```ts
const agg = computeLandAggregate(phaseParcels);
const landSqm = computeAssetLandSqm(asset, parcels, assets, subUnits, mode);
if (agg.totalAreaSqm <= 0 || landSqm <= 0) {
  return { landSqm, landValue: 0, rate: 0, splits: [] };
}
```

If `landSqm == 0`, returns `landValue: 0` without ever multiplying.

### Why `landSqm` is zero (the actual break point)

`computeAssetLandSqm` at `src/core/calculations/index.ts:168-198`, autoByBua branch:
```ts
// autoByBua
const phaseAssets = assets.filter((a) => a.phaseId === asset.phaseId);
const totalBua = phaseAssets.reduce((s, a) => s + computeAssetBua(a, subUnits), 0);
if (totalBua <= 0) return 0;
const myBua = computeAssetBua(asset, subUnits);
return agg.totalAreaSqm * (myBua / totalBua);
```

`computeAssetBua` at `src/core/calculations/index.ts:136-140`:
```ts
export function computeAssetBua(asset: Asset, subUnits: SubUnit[]): number {
  const phaseSubUnits = subUnits.filter((u) => u.assetId === asset.id);
  if (phaseSubUnits.length === 0) return Math.max(0, asset.buaSqm ?? 0);
  return phaseSubUnits.reduce((s, u) => s + computeSubUnitArea(u), 0);
}
```

**Fallback gap:** when `phaseSubUnits.length > 0` BUT every sub-unit has `metricValue == 0` (or `metric='units'` with `metricValue == 0` and/or `unitArea == 0`), the sum is 0. The helper returns 0, and the `asset.buaSqm` fallback NEVER fires.

In contrast, `resolveAssetAreaMetrics` at `src/core/calculations/index.ts:649-652` has the correct fallback:
```ts
const hierarchy = computeAssetAreaHierarchy(asset, subUnits);
const bua = hierarchy.bua > 0
  ? hierarchy.bua
  : Math.max(0, asset.buaSqm ?? 0);
```

So `resolveAssetAreaMetrics` returns `bua = asset.buaSqm` (non-zero) for the same asset where `computeAssetBua` returns 0. The two helpers disagree, and the autoByBua land path picks the wrong one.

### Why previous passes failed to fix

- **M2.0L Fix 4 / Pass 3 widening** patched `resolveAssetAreaMetrics` to fall back to `asset.buaSqm`. It did NOT patch `computeAssetBua` directly. Reason: every `rate_per_bua` cost line uses `m.bua` (the `resolveAssetAreaMetrics` output), which has the fallback. The land path was overlooked because it goes through a different helper (`computeAssetLandSqm` -> `computeAssetBua`).
- **Pass 7 (per-asset rewrite)** replicated the master Land lines correctly, didn't touch land sizing.
- **Pass 8** clamped `endPeriod` and shipped UI polish (NDA card, sub-unit metric per-asset, dropdown layout). Didn't touch land sizing.
- **M2.0M Pass 3 / Pass 4 (financing)** routed funding off `inputsSummary.totals` which uses `computeAssetCost` per asset. The cost engine sees the same `m.cashLandValue == 0` and emits zero for Land lines.

Every pass touched a downstream surface. No pass touched `computeAssetBua`.

## Specific fix plan

### Fix 8 root-cause patch (calc-engine)

Patch `computeAssetBua` to fall back to `asset.buaSqm` when the sub-unit sum is zero:

`src/core/calculations/index.ts:136-140`:
```diff
 export function computeAssetBua(asset: Asset, subUnits: SubUnit[]): number {
   const phaseSubUnits = subUnits.filter((u) => u.assetId === asset.id);
   if (phaseSubUnits.length === 0) return Math.max(0, asset.buaSqm ?? 0);
-  return phaseSubUnits.reduce((s, u) => s + computeSubUnitArea(u), 0);
+  const sum = phaseSubUnits.reduce((s, u) => s + computeSubUnitArea(u), 0);
+  return sum > 0 ? sum : Math.max(0, asset.buaSqm ?? 0);
 }
```

Same pattern for `computeAssetSellableBua` (NSA fallback) at `src/core/calculations/index.ts:142-148`, since the autoByBua land path may also see NSA paths in future revenue work and the symmetry matters.

### Acceptance criteria (DOM-level)

After the patch, with MAAD-shape fixture (1 phase, 1 asset, BUA 130,874 sqm, sub-units empty OR with `metricValue=0`, parcel 22,066 sqm × 98,450 SAR × 80% cash / 20% in-kind):

- `assetMetrics.bua = 130,874` (from asset.buaSqm fallback)
- `landSqm = totalAreaSqm * (myBua/totalBua) = 22,066 * 1 = 22,066 sqm`
- `landValue = totalValue * valueShare = 2,171,933,700 * 1 = 2,171,933,700 SAR`
- `cashLandValue = 2,171,933,700 * 80% = 1,737,546,960 SAR`
- `inKindLandValue = 2,171,933,700 * 20% = 434,386,740 SAR`
- Tab 3 Land (Cash) cost line Total cell renders `1,737,546,960` (formatted per displayScale)
- Tab 3 Land (In-Kind) cost line Total cell renders `434,386,740`

If asset has 4 visible siblings with same BUA each, the share is 1/4 and each renders 25% of total. Either way, NON-ZERO values render in DOM.

### Fallback chain documented

For `computeAssetBua`:
1. No sub-units yet -> `asset.buaSqm` (existing).
2. Sub-units present but sum to 0 -> `asset.buaSqm` (new, this patch).
3. Sub-units sum to > 0 -> sub-unit sum (existing).

For `computeAssetLandSqm` (autoByBua):
1. `splits` present -> `sum(splits.sqm)` (existing).
2. mode='sqm' -> `asset.landAllocation.sqm ?? asset.landAreaSqm ?? 0` (existing).
3. mode='percent' -> `agg.totalAreaSqm * pct/100` (existing).
4. mode='autoByBua' -> `agg.totalAreaSqm * (myBua/totalBua)` where myBua/totalBua now correctly fall back to `asset.buaSqm` (this patch makes it work).

## Plan

1. This diagnostic note (no code changes).
2. Fix 8 (force fix Land zero): patch `computeAssetBua` + `computeAssetSellableBua` fallback to `asset.buaSqm` / `asset.sellableBuaSqm` when sub-units exist but sum to zero. Verify with MAAD-shape unit + (where possible) Playwright DOM assertion.
3. Fix 1 (round derived Count): `Math.round(area / unitSize)` in sub-unit table Units mode.
4. Fix 2 (NDA recon shows NDA): reconciliation block at top of Tab 2 walks Total Parcel Land - Roads% - Parks% = Net Developable Area; asset allocations sum to NDA (or Total when NDA disabled).
5. Fix 3 (End period drop max cap): drop HTML5 max + JS clamp on endPeriod input. Informational warning chips only; blocking error only when End < Start.
6. Fix 4 (universal K/M suffix strip): replace remaining `formatScaled` cell calls with `formatAccounting` (zero -> `-`, no K/M suffix). Scale once in tab header line.
7. Fix 5 (method caption drop = result): `costLineCaption` drops the trailing `= result` part. Formula only.
8. Fix 6 (collapsible cost line rows): per-row collapsible state. Collapsed = Name + Method + Total + Toggle + Delete. Expanded = full inputs. localStorage persists per row.
9. Fix 7 (Phase 3 click behavior): verify Pass 8 empty-phase logic survives Pass 9 changes.
10. Verifier + CLAUDE.md.
