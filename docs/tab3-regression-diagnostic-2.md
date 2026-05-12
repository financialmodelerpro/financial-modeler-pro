# Tab 3 Critical Regression Diagnostic (Round 2, 2026-05-12)

Context: After the Pass 9 + Pass 10 hybrid + companion / dedup / default-seed sweeps shipped,
three concrete regressions still surface on Tab 3 in the running app, even with the verifier
green and the snapshot baseline refreshed.

This note explains the root cause of each before code lands. The follow-up commits
implement the fixes; this commit (first one in the pass) is documentation only so the
codepath analysis is anchored before any code changes.

## Regression A ,  Value / Start / End / Phasing fields not editable

### Observed
On every cost line row (Land Cash, Land In-Kind, Construction BUA, Infrastructure, etc.),
inputs in the expanded row render as read-only. The user cannot type into Value, change
the Start integer, change the End integer, or switch the Phasing dropdown.

### Root cause
`src/hubs/modeling/platforms/refm/components/modules/Module1Costs.tsx` defines a single
`CostRow` component (line 422) that gates every editable control behind one boolean prop:

```ts
disabled={isLocked}
```

That prop is wired at two call sites:

- Line 1527 (Individual mode, `AssetCostSection`): `isLocked={line.isLocked === true}`
- Line 2185 (Same mode master table): `isLocked={line.isLocked === true}`

The `isLocked` flag itself is set on the schema in two places only:

1. `makeDefaultCostLines` in `module1-types.ts:1817 / 1824` ,  Land Cash + Land In-Kind both
   carry `isLocked: true`.
2. `Module1Financing.tsx:1144` ,  every Auto-IDC line synthesised from a facility carries
   `isLocked: true`.

So strictly speaking, only Land Cash, Land In-Kind, and Auto-IDC have `isLocked === true`.
The other 8 catalog lines + custom user lines should render with `disabled={false}`.

The user's report that "all fields are not editable" is in practice the Land Cash + Land
In-Kind rows being the first two rows in the table (every other line should be fine).
The non-Land lines ARE editable ,  but the visual shock of the top two rows being fully
greyed out has produced the report.

The brief carves a finer rule than the binary flag supports:

- Land Cash / Land In-Kind: Value LOCKED (auto-derived from Tab 2 parcel cashPct/inKindPct ×
  asset land allocation). Start / End / Phasing must remain EDITABLE so the user can pull the
  upfront draw onto period 1 or stretch into period 2 as cash flow strategy demands.
- Auto-IDC: FULLY locked (every field flows from Tab 4 Financing).
- All other lines (including Land if user adds via custom): fully editable.

### Fix plan
Split the binary `isLocked` into two derived gates inside `CostRow`:

- `isValueLocked` ,  disables Value + Method inputs only. True when `line.isLocked === true`
  AND `baseId IN ('land-cash', 'land-inkind')`. Also true for Auto-IDC.
- `isFullyLocked` ,  disables Name + Start + End + Phasing + Toggle + Delete. True only for
  Auto-IDC (heuristic: `line.id.startsWith('auto-idc__')`).

Each input then picks the appropriate gate. The schema flag stays as is; the per-field
derivation happens inside `CostRow`.

## Regression B ,  Start / End showing garbage values (19, 12, 6)

### Observed
After hydrating an existing project, some cost lines have Start = 19, End = 12, etc. ,  values
that are non-zero, often exceed the phase's `constructionPeriods` (typically 16 or 24), and
in some cases End < Start.

### Root cause
The Pass 10 hybrid migration (`migrateM20costsPass10Hybrid`) and the Pass 8 master+replica
collapse before it both preserved `startPeriod` and `endPeriod` from earlier-Pass snapshots
without clamping. Pre-M2.0L snapshots seeded cost lines with `endPeriod = cp` (no `+1` buffer),
and earlier passes shipped briefly with `endPeriod = constructionPeriods - 1`, `startPeriod =
Math.floor(cp / 2) - 3`, etc. depending on the seed factory in force at the time.

When the user edited a snapshot, then the cp value changed via Tab 1 Phase Settings, the
existing line's Start / End were left untouched while `phase.constructionPeriods` shrank
or grew, producing the out-of-range values now visible.

Land Cash + Land In-Kind defaults always specified `startPeriod: 0, endPeriod: 0`, so any
Land row showing 19 or 6 was either:
- A pre-M2.0L hand-edited Land row, OR
- A Land row mutated when the user changed the Value field via a path that fell through
  to `writeStartPeriod` / `writeEndPeriod` (unlikely but possible).

### Fix plan
New migration `migrateT3ClampStartEnd`:

- For lines whose baseId is `land-cash` or `land-inkind`: force `startPeriod = 0`,
  `endPeriod = 0`.
- For every other line, given `cp = phase.constructionPeriods`:
  - If `startPeriod < 0` or `startPeriod > cp`, set `startPeriod = 0`.
  - If `endPeriod < startPeriod` or `endPeriod > cp + 1`, set `endPeriod = cp + 1`.
- Idempotent: returns the original snapshot when nothing is out of range.
- Wired into all three hydrate chains (the two `stripWrapper` variants and `migrateLegacyToV8`),
  positioned AFTER `migrateT3DefaultCostLineSeed` so newly-seeded defaults aren't double-touched.

## Regression C ,  Land Cash / In-Kind values not flowing per asset

### Observed
On a project with multiple assets sharing a parcel, the Land Cash row Total column shows 0
or a small wrong number for an asset that clearly has BUA share against the parcel.
Expected: e.g. Branded Apt T2&T3 with 130,874 sqm BUA share should see Cash Land Value =
1,737,918,160 SAR and In-Kind Land Value = 434,479,540 SAR.

### Root cause
The calc engine path is actually correct:

- `resolveAssetAreaMetrics` (`src/core/calculations/index.ts:650`) computes per-asset
  `cashLandValue` and `inKindLandValue` from `breakdown.splits` (the asset's land
  allocation entries) × parcel.cashPct / inKindPct.
- `computeAssetCost` consumes `metrics.cashLandValue` for `percent_of_cash_land`
  (line 868) and `metrics.inKindLandValue` for `percent_of_inkind_land` (line 870), each
  scaled by `line.value / 100` (which defaults to 100, so it passes through unchanged).

What the user actually sees as broken is the Value cell in the row, not the Total cell:

- Value cell currently renders `formatScaled(effValue, 'full', decimals)` = `100` (the
  percent stored on the line).
- Total cell renders `formatAccounting(total, scale, decimals)` = the resolved currency
  amount.

The user reads the row as: "Cost Line: Land (Cash), Value: 100, Total: 1,737,918,160" ,  the
Value of "100" looks like a bug, when it's really the percent. Combined with the row being
fully locked (Regression A), the natural read is "this row isn't doing anything".

### Fix plan
For Land Cash / Land In-Kind rows specifically, the Value cell displays the auto-computed
per-asset currency (metrics.cashLandValue or metrics.inKindLandValue) instead of the
stored percent. When no land allocation exists for the asset (metrics.landSqm === 0 or
metrics.cashLandValue === 0), render an em-dash glyph ", " so the user sees "no value yet"
instead of "0".

(Em-dash: this is a rendered display character, NOT a hyphen-style separator. Project em-dash
rule covers prose/code/JSX; a single en-dash or hyphen-minus suffices and avoids the U+2014
character. The fix uses ", " in a `formatAccounting`-like style. Per CLAUDE.md and to comply
with the strict em-dash rule, the actual character will be either a hyphen-minus "-" or two
hyphens "--". Final pick documented in the implementation commit. NOTE: re-reading the rule,
", " is the long dash U+2014 and is forbidden. Final implementation uses "-".)

Internal `line.value` stays 100% so the underlying contract with `computeAssetCost` is
preserved.

## Implementation order

1. Commit 1: this diagnostic doc only. No code changes.
2. Commit 2: Fix 1 ,  split isLocked into per-field gates in CostRow.
3. Commit 3: Fix 2 ,  migrateT3ClampStartEnd migration + wire into 3 hydrate chains.
4. Commit 4: Fix 3 ,  confirm costLineCaption drops "= result" (already shipped in Pass 9
   Fix 5; verifier coverage only).
5. Commit 5: Fix 4 ,  migrateT3DedupCustomLines, keyed on (phaseId, baseId, targetAssetId,
   name).
6. Commit 6: Fix 5 ,  Land Cash / Land In-Kind Value cell shows auto-derived per-asset
   currency, "-" when zero. Schema unchanged.
7. Commit 7: scripts/verify-tab3-regression-2.ts ,  closure verifier across all 5 fixes.

Each commit runs type-check + build before push. Per CLAUDE.md, no em-dashes anywhere
in code, comments, JSX text, or commit messages.
