# M2.0 Costs Cleanup Pass 10, Regression Audit

**Date:** 2026-05-12
**Author:** Claude Code (pre-implementation audit)
**Status:** Baseline. No code changes in this commit. Required by Pass 10 brief.

## Why this audit

User opened Pass 10 brief reporting Pass 9 regressions:
- "removed things from start and end and value also not showing to add input why things going worse"
- Some assets render blank cost line tables (Residential Tower 01, Phase 3 Branded Apt T4 & T5)
- Land Cash + Land In-Kind still showing zero despite Pass 9 Fix 8 claim

Before any code changes, audit the actual current state to avoid mis-diagnosing the root cause a fourth time (Pass 6/7/8/9 all mis-diagnosed Land Zero).

## Methodology

Read current commit `318dfe0` (M2.0M Pass 7 + M2.0 Pass 9 shipped). Quote actual code at suspect locations. No fixes; just findings.

---

## Surface 1, Tab 3 cost line table columns

**Location:** `src/hubs/modeling/platforms/refm/components/modules/Module1Costs.tsx:561-754`

**Finding:** All 9 columns (Cost Line / Method / Value / Start / End / Phasing / Total / Toggle / Delete) ARE rendered. Pass 9 Fix 6 added per-row collapse state that defaults to collapsed (true). When collapsed, Value / Start / End / Phasing cells render `-` (dash) instead of editable inputs.

```ts
// Module1Costs.tsx:561-569
const collapseKey = `m20-cost-row-collapsed-${line.id}`;
const readCollapsed = (): boolean => {
  if (typeof window === 'undefined') return true;
  try {
    const stored = window.localStorage.getItem(collapseKey);
    return stored === null ? true : stored === 'true';  // <-- DEFAULTS TRUE
  } catch { return true; }
};
const [collapsed, setCollapsed] = React.useState<boolean>(readCollapsed);
```

**Root cause of user "removed" perception:** Every row collapses by default, hiding the input cells behind dashes. User sees a row of dashes and concludes the inputs were deleted. Nothing was actually deleted; the affordance to expand is too subtle.

**Verdict:** No restoration needed (Pass 10 Fix 1 task is misnamed). What IS needed: keep the default-collapsed (Fix 6 explicitly requires this) but improve discoverability:
- Show Value + Total in the collapsed row header (read-only) so the user sees the numbers without expanding.
- Pulse / hover-hint the chevron on first session load.
- Optionally: auto-expand the row when the user clicks anywhere on it (not just the chevron).

---

## Surface 2, Blank cost lines for some assets

**Location:** `src/hubs/modeling/platforms/refm/components/modules/Module1Costs.tsx:2608-2709`

**Finding:** activeAsset selection has a fallback (`visiblePillAssets.find(...) ?? visiblePillAssets[0]`). The 4-part render guard at line 2709 is:

```ts
{phaseHasAssets && activeAsset && assetBreakdown && assetMetrics && (...)}
```

Where:
- `phaseHasAssets` = current phase has visible assets
- `activeAsset` = resolved active asset (fallback works)
- `assetBreakdown` = `breakdownByAssetId.get(activeAsset.id)` (from calc engine)
- `assetMetrics` = `metricsByAsset.get(activeAsset.id)` (from area resolver)

**Most likely root cause for blank:** `metricsByAsset` returns undefined for an asset that has no sub-units AND no `asset.buaSqm`. metricsByAsset is built by walking `resolveAssetAreaMetrics`. If the asset is mid-creation (sub-units empty, buaSqm zero, no land allocation), the map entry may simply be missing.

Same risk on `breakdownByAssetId`: when calc engine throws or returns no entry for an asset, the guard fails silently.

**Files Pass 10 will touch:** Module1Costs.tsx lines around 2334-2419 (metricsByAsset + breakdownByAssetId build).

**Fix approach:** ensure BOTH maps always have an entry per visible asset (default to zero-metrics + zero-breakdown when calc has nothing). Then the 4-part guard reduces to `phaseHasAssets && activeAsset`, and the render-blank case disappears.

---

## Surface 3, Land Zero render flow

**Location:** `src/core/calculations/index.ts:145-209`

**Pass 9 Fix 8 claim:** patched `computeAssetBua` + `computeAssetSellableBua` to fall back to `asset.buaSqm`. Confirmed at line 145-150:

```ts
export function computeAssetBua(asset: Asset, subUnits: SubUnit[]): number {
  const phaseSubUnits = subUnits.filter((u) => u.assetId === asset.id);
  if (phaseSubUnits.length === 0) return Math.max(0, asset.buaSqm ?? 0);
  const sum = phaseSubUnits.reduce((s, u) => s + computeSubUnitArea(u), 0);
  return sum > 0 ? sum : Math.max(0, asset.buaSqm ?? 0);
}
```

This fixes the case where sub-units exist but all have `metricValue=0`. Good.

**But Pass 9 missed:** `computeAssetLandSqm` autoByBua branch (line 203-208):

```ts
const phaseAssets = assets.filter((a) => a.phaseId === asset.phaseId);
const totalBua = phaseAssets.reduce((s, a) => s + computeAssetBua(a, subUnits), 0);
if (totalBua <= 0) return 0;            // <-- LINE 206, returns 0 when no BUA across phase
const myBua = computeAssetBua(asset, subUnits);
return agg.totalAreaSqm * (myBua / totalBua);
```

If ALL phase assets have zero BUA (no sub-units AND no buaSqm), totalBua = 0, return 0, asset.landSqm = 0, Land cost = 0.

**The Pass 9 Fix 8 fallback only helps when at least one asset in the phase carries a non-zero `buaSqm`. If every asset is bare, line 206 still returns zero.**

This explains why Land Zero "persists in some projects" even after Pass 9. The reference fixture (130874 BUA on one asset) DOES trigger the Pass 9 fallback successfully, hence the verifier passes. But a user project where assets carry zero BUA (because user hasn't entered it yet) still renders zero.

**Pass 10 fix:** when `totalBua <= 0` in autoByBua mode, fall back to per-asset equal share of `agg.totalAreaSqm` across visible phase assets. Or, more conservatively, return `agg.totalAreaSqm / phaseAssets.length` per asset. This guarantees a non-zero land allocation even when the user hasn't entered BUA on any asset yet.

---

## Surface 4, Sell + Manage current implementation

**Location:**
- Strategy enum: `src/hubs/modeling/platforms/refm/lib/state/module1-types.ts:85`
- ManagementAgreement: `module1-types.ts:558-563`
- UI: `Module1Assets.tsx:1097-1781`

**Current shape:** Sell+Manage is ONE asset with embedded `managementAgreement` (managementFeePct, ownerRevenueSharePct, agreementStartPeriod, agreementDurationPeriods). UI renders the management agreement inputs (Module1Assets.tsx:1765-1781) only when `asset.strategy === 'Sell + Manage'`.

**No companion asset exists today.** User wants Pass 10 to introduce one (`[Parent] - Operate`, auto-generated, `keys = parent's sellable units`).

**Pass 10 work:**
- Schema additions: `Asset.parentAssetId / isCompanion / companionType: 'operate' / unitsFromParent`.
- Mutation: when user picks 'Sell + Manage' as strategy on an asset, auto-insert a sibling companion asset. When user removes the parent or switches strategy, cascade-delete companion.
- UI: Tab 2 nests companion under parent visually. Tab 3 surfaces companion as its own pill (so the user can configure hospitality cost lines on it).
- Cost engine: companion does NOT participate in land allocation (no double-counting). `computeAssetLandSqm` and `aggregatePhaseMetrics` must filter `isCompanion` from land basis aggregation.
- Drop the existing Management Fee % + Owner Share % UI (keep fields on schema for back-compat, do not render).
- Calc engine: ManagementAgreement fields no longer used until M2.1; companion's revenue stream picks up the operate-strategy revenue path when M2.1 ships.

---

## Surface 5, NDA + Land Reconciliation

**Location:** `Module1Assets.tsx:1859-2019`

**Current shape:** When projectNdaEnabled, the recon walks:
- Total Parcel Land - Roads% - Parks% = Net Developable Area (NDA)
- Asset allocations (per-asset sqm rows ARE rendered at line 1955-1967, contrary to user report)
- Total Allocated row with `✓ matches NDA` chip

**What's missing:**
1. Per-asset Land Cost column. Current grid is 2-col (Asset name | Sqm Allocated). Pass 10 needs 3-col (Asset name | Sqm Allocated | Asset Land Cost).
2. `Unassigned Land = NDA - Total Allocated` row. Currently only the closing chip indicates mismatch; user wants an explicit subtraction row.
3. Pass 10 brief mentions "remove red section showing 'short by 10,630'", this exists at Module1Assets.tsx:1910-1911:

```ts
{landReconciliation.status === 'short' && (
  <div data-testid="land-reconciliation-short-warning">
    Short by {fmt(landReconciliation.shortBy)} sqm
  </div>
)}
```

User says the math here is wrong. Need to investigate what `landReconciliation.shortBy` actually compares. Likely compares total parcels sqm to total asset allocations, but with projectNdaEnabled it should compare NDA (post-deduction) to total asset allocations.

**Pass 10 work:**
- Add Asset Land Cost column (third grid col). Derive from `landValueAuto * (assetLandSqm / totalLandSqm)` or via `computeAssetLandValue`.
- Add Unassigned Land row.
- Recompute `shortBy` against NDA (when project-NDA enabled) instead of gross land.

---

## Surface 6, Sub-unit summary line, Revenue field missing

**Location:** `Module1Assets.tsx:2040-2079`

**Current shape:** `AssetAreaReconciliationBlock` renders:
```
Verification: BUA X | NSA X | Eff X% | Land X | Land Cost X
```

**Pass 10 wants:**
```
Verification: BUA X | NSA X | Eff X% | Land X | Land Cost X | Revenue X
```

Revenue is computable locally from sub-units: `sum(subUnit.metricValue * subUnit.unitPrice)` for revenue sub-units (Sellable / Operable / Leasable). The Total Revenue column already exists in the sub-units table (Pass 7 Fix 3, Module1Assets.tsx near line 1500 area). Need to:
- Pass `totalRevenue` as a prop to AssetAreaReconciliationBlock, OR compute inline from `subUnits.filter(u => u.assetId === asset.id)`.

---

## Surface 7, Collapsible defaults

**Current state (mixed):**

| Section | Default | localStorage |
|---------|---------|--------------|
| Phase cards (Tab 1 / Tab 2) | expanded | no |
| Asset cards (Tab 2) | expanded | no |
| Land Reconciliation | collapsed (default), auto-expand on mismatch | `m20i-land-recon-collapsed` |
| Cost line rows (Tab 3) | collapsed (Pass 9 Fix 6) | `m20-cost-row-collapsed-{lineId}` |
| Asset Cost Section (Tab 3) | expanded | no |
| Inputs Summary Tables (Tab 4) | expanded | no |

**Pass 10 brief asks:** collapsed by default EVERYWHERE. localStorage persistence per section.

**Pass 10 work:**
- Phase cards: add `collapsed=true` default + localStorage `m20-phase-collapsed-{id}`.
- Asset cards: add `collapsed=true` default + localStorage `m20-asset-collapsed-{id}`.
- Asset Cost Section: add `collapsed=true` default + localStorage `m20-asset-cost-section-collapsed-{id}`.
- Inputs Summary Tables (Tab 4 Financing): collapsible group + localStorage `m20-financing-summary-collapsed`.
- Expand All / Collapse All bulk buttons at top of Tab 2 + Tab 3.

---

## Surface 8, Number input format

**Locations across Tab 2 (Module1Assets.tsx):**
- Roads % (555), Parks % (566)
- Parcel area (747), Parcel cashPct (771), Parcel inKindPct (782)
- Sub-unit area (1164), Asset land area sqm (1216), Custom rate (1221), Asset land % (1234)
- Support area (1268), Parking area (1272), GFA sqm (1276)
- Asset-level NDA Roads/Parks % (1313, 1325)
- Management Agreement % and periods (1677, 1689, 1769-1781)
- Useful Life Years (1817)

**Total bare `<input type="number">` outside AccountingNumberInput: ~25**

Tab 1 (Module1Project.tsx) + Tab 4 (Module1Financing.tsx) likely have additional bare inputs (not enumerated this audit but Pass 10 sweeps them too).

**Pass 10 work:** wrap or replace every numeric input intended for "large numbers / money / area" with AccountingNumberInput. Percentages can stay bare (0-100 small numbers) OR also use AccountingNumberInput with decimals=2, TBD per visual review. Period numbers (Start, End, integer 0..N) stay bare.

---

## Surface 9, Cost line schema + storage

**Location:** `module1-types.ts:787-870` + `lib/state/module1-store.ts` (Zustand)

**Finding:** CostLine + CostOverride are persisted to the snapshot (per CLAUDE-REFM.md "M2.0L migrateM20lDedupeCostLineIds runs in stripWrapper / stripV8Wrapper"). They live in the Zustand store at runtime but the store hydrates from / dehydrates to the project snapshot which IS Supabase-persisted.

**Pass 7's composed-id pattern is canonical today:** every CostLine has `targetAssetId` set + id pattern `${baseId}__${phaseId}__${assetId}`. The Pass 7 migration replicated master lines per visible asset.

**Pass 10 Fix 3 reversal (hybrid):**
- Project.costLines (single array per phase, no targetAssetId, base ids like `construction__phase-2`).
- CostOverride[] re-introduced as the OPTIONAL per-asset override surface, keyed by `assetId.lineId`.
- Asset Total column recomputes per active asset's metrics on pill click.
- Lightweight Override toggle per asset+line: a small chip next to the Total column, click to open inline override input (NOT a separate replica row table).

**Migration for Pass 10 (`migrateM20costsPass10HybridCostLines`):**
1. Walk every phase's cost lines.
2. Group by `deriveLineBaseId(line.id)`.
3. For each base id group, take FIRST asset's line as the canonical master (drop targetAssetId, recompose id as `${baseId}__${phaseId}`).
4. For each non-first asset whose line value differs from master, stamp a CostOverride entry with the asset-specific value.
5. Stamp banner `M20_PASS10_NOTICE`: "Cost lines simplified to project-wide. Where assets carried different rates, the first asset's rate was used as the master. Check Tab 3 and re-enter overrides where needed."

Idempotent: re-running detects that targetAssetId is already cleared, no-op.

---

## Implementation order (Pass 10)

1. **THIS commit:** audit doc only, no code changes.
2. Fix 6 collapsed defaults (foundational, affects every other UX in Tab 2 / Tab 3). Discoverability hint on collapsed cost row addresses Fix 1 misnamed perception.
3. Fix 3 hybrid cost-line architecture (foundational schema migration; everything downstream uses Project.costLines).
4. Fix 2 ensure metricsByAsset + breakdownByAssetId default-populated per asset (fixes blank).
5. Fix 9 Land Zero deeper fallback in computeAssetLandSqm (calc engine).
6. Fix 5 NDA Recon add Asset Land Cost column + Unassigned Land row + recompute shortBy against NDA.
7. Fix 7 Sub-unit summary add Revenue.
8. Fix 4 Sell+Manage companion auto-creation (largest scope, schema + mutation + cascade-delete + cost engine filter).
9. Fix 10 Commission cost line revenue hooks (new method enum values + zero-stub hooks).
10. Fix 8 universalize accounting-format number inputs (sweep).
11. Closure: verifier + Playwright (with Land Zero screenshot proof) + CLAUDE-REFM.md update.

Total expected commits: ~12 (audit + 10 fixes + closure).

## Strict no-removal policy

Per brief: "DO NOT remove any working functionality. If a feature exists today, it stays. Only ADD or FIX what this prompt specifies." Every Pass 10 commit asserts:
- All Pass 9 verifier sections still pass.
- All Pass 8 / Pass 7 / Pass M / Pass L verifiers still pass.
- No table columns dropped except where the brief explicitly asks (e.g., Management Fee % UI hide, keep schema).

If a fix needs to deprecate something, it gets a schema field flag (`@deprecated`) but keeps the field on the snapshot for back-compat.

---

## End of audit
