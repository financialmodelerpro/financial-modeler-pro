# Tab 3 Inputs vs Results: per-line per-period divergence

**Date:** 2026-05-13
**Phase:** M2.0 Costs Cleanup Pass 11 (P11 Fix 6 diagnostic)
**Status:** Bug identified, fix in follow-up commit.

## Symptom

User reports (Branded Apartments T2&T3, Phase 2 starting 2026):

- **Land In-Kind** with Start=1, End=1, Phasing=Even
  - **Inputs Money SAR chip**: full line total parked on Dec 26.
  - **Results Table 1 (per-line nested row)**: line total smeared across Dec 26..Dec 30 (every period the asset has any spend).

- **Construction (BUA)** with Start=1, End=5, Phasing=Manual %
  `[10, 25, 30, 25, 10]`, total 883,400
  - **Inputs Money SAR chips**: 88,340 / 220,850 / 265,020 / 220,850 / 88,340.
  - **Results Table 1 (per-line nested row)**: a different distribution,
    not matching the manual %.

Asset-level Project Total + Asset Subtotal rows agree across both
surfaces. Only the per-cost-line sub-rows under each asset in
**Table 1 "Construction Cost Schedule by Period"** are wrong.

## Root cause

Both surfaces compute the per-period money correctly **for their own
view**, but they do so via **two different code paths** and one of
them ignores the line's phasing curve entirely.

### Inputs surface (correct)

`src/hubs/modeling/platforms/refm/components/modules/Module1Costs.tsx`

- Manual %: line 1025-1054. Money chips compute
  `money = (total * pct) / sumDenom` per chip, chip index =
  `line.startPeriod + i`. Pure manual % math, anchored to the line's
  own startPeriod.
- Non-manual: line 1067-1115. Calls
  `distributeItemCost({ ...line, phasing: effPhasing, distribution: effDistribution }, total, constructionPeriods)`
  and reads `perPeriod[p]` for `p = line.startPeriod..line.endPeriod`.
  Output is phase-relative (perPeriod[0] = Y0 upfront,
  perPeriod[1] = phase Y1).

Both branches respect `line.startPeriod`, `line.endPeriod`,
`line.phasing`, and `line.distribution`.

### Engine (correct internally)

`src/core/calculations/index.ts` `computeAssetCost`

- Line 1127-1153: resolves `{ method, value, phasing, distribution,
  startPeriod, endPeriod }` per line by merging master + override
  (master values when override is undefined / overridden === false).
- Line 1269-1296: per-period loop. For each resolved line with a
  non-zero total, calls
  `distributeItemCost({ ...r.line, phasing: r.phasing, distribution: r.distribution, startPeriod: r.startPeriod, endPeriod: r.endPeriod }, t, cp)`
  and accumulates into `perPeriod` (asset-wide, phase-relative). Also
  splits `perPeriodLandTotal` + `perPeriodLandInKind` for land
  tagging.

So `bd.perPeriod[i]` is the **asset-wide sum** of correctly-phased
line distributions. Asset row in Results Table 1 (line 1760-1788)
reads this and applies the phase offset correctly.

### Results per-line nested row (WRONG)

`src/hubs/modeling/platforms/refm/components/modules/Module1Costs.tsx`
line 1809-1858 (inside Table 1 `<tbody>`):

```ts
{linesForThisAsset.map((line) => {
  let lineTotal = 0;
  const linePerPeriodAnnual = new Array<number>(annualPeriodCount).fill(0);
  for (const pb of perPhaseBreakdowns) {
    const bd = pb.assetTotals[a.id];
    if (!bd) continue;
    const t = bd.byLineId[line.id] ?? 0;   //  <- scalar per-line total
    if (t === 0) continue;
    lineTotal += t;
    // ...
    // Approximate per-period split: distribute t across
    // perPeriod proportional to overall asset perPeriod.
    const assetPP = bd.perPeriod;
    const assetPPTotal = assetPP.reduce((s, v) => s + v, 0);
    if (assetPPTotal > 0) {
      for (let i = 0; i < pb.cp; i++) {
        const dest = offset2 + i;
        if (dest < 0 || dest >= annualPeriodCount) continue;
        const share = (assetPP[i + 1] ?? 0) / assetPPTotal;
        linePerPeriodAnnual[dest] += t * share;     //  <- BUG
      }
      // Upfront perPeriod[0] follows the same offset rule.
      if (offset2 > 0 && offset2 - 1 < annualPeriodCount && offset2 - 1 >= 0) {
        const share0 = (assetPP[0] ?? 0) / assetPPTotal;
        linePerPeriodAnnual[offset2 - 1] += t * share0;
      }
    }
  }
  // ...
})}
```

The inline comment is honest about it: "Approximate per-period split:
distribute t across perPeriod proportional to overall asset
perPeriod."

The asset-wide `perPeriod` is the **sum of every line's correctly-
phased contribution**, so its shape is dominated by whichever line(s)
have the largest totals. Smearing each line's total proportional to
that shape destroys the line's own phasing curve:

- A single-period Land line (Start=1, End=1, total = X) gets
  re-spread across every period the asset has any spend, because
  `assetPP[i+1]/assetPPTotal` is non-zero in those periods.
- A manual %-phased Construction line gets reshaped into the same
  curve as the asset average, not its own `[10, 25, 30, 25, 10]`.

`bd.byLineId[line.id]` is correct (the line's total). What's missing
is the line's own per-period schedule on the breakdown.

## Why a smear was used in the first place

`AssetCostBreakdown` exposes:
- `byLineId: Record<string, number>` — per-line **total** (scalar).
- `perPeriod: number[]` — per-period **asset total** (aggregated).

There is no per-line-per-period field. The engine throws away the
per-line distribution after summing it into `perPeriod`. The UI had
to reconstruct something, and the smear was the cheap approximation.
For single-cost-line assets it happens to be correct (the asset curve
== the line curve); for multi-line assets it is always wrong.

## Fix

One source of truth, in the engine. Extend `AssetCostBreakdown` with

```ts
perLinePerPeriod: Record<string, number[]>;
```

filled inside the existing per-period loop:

```ts
const dist = distributeItemCost(
  { ...r.line, phasing: r.phasing, distribution: r.distribution,
    startPeriod: r.startPeriod, endPeriod: r.endPeriod },
  t,
  cp,
);
perLinePerPeriod[r.line.id] = dist;     // exact per-line curve
const lim = Math.min(dist.length, periodSlots);
for (let i = 0; i < lim; i++) {
  // existing accumulation into perPeriod / perPeriodLandTotal /
  // perPeriodLandInKind stays unchanged
}
```

Module1Costs Table 1 per-line nested rows then read
`bd.perLinePerPeriod[line.id]` instead of smearing, apply the same
`offset = phaseStartYear - projectStartYear` shift used by the asset
row, and produce a per-line distribution that exactly equals the
Inputs chip strip for the same line.

Companion short-circuit returns `perLinePerPeriod: {}`. Verifier
stubs + baseline fixtures gain the field too.

## Acceptance

1. Land Start=1 End=1 Phasing=Even → single non-zero column at
   `offset = phaseStartYear - projectStartYear` (Dec 26 for Phase 2
   starting 2026 on a 2025-start project).
2. Construction Start=1 End=5 Phasing=Manual % [10,25,30,25,10] →
   5 non-zero columns Dec 26..Dec 30 with exact manual % distribution.
3. Construction Start=1 End=5 Phasing=Even → 5 equal columns
   (20% each).
4. Per-period values in Results Table 1 per-line nested row =
   Money SAR chip values in Inputs row.
5. Sum of per-period values = line "Total" cell.
6. Period range starts at correct year per phase.

Tab 4 Financing schedule has its own independent cropping path
(P4-Fix 5) and does not consume `perLinePerPeriod`; unaffected.
