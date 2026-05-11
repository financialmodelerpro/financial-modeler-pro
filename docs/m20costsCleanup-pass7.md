# M2.0M Pass 7, Costs Architecture Simplification

**Date:** 2026-05-11
**Scope:** Drop the Master + Replica inheritance pattern from Costs Inputs. Rebuild as a clean per-asset model with asset pill navigation. Six polish fixes around the rewrite.

---

## Guiding principle: one editable table per asset, never two views

Pass 4 introduced the inheritance surface (master template + per-asset replicas + Override toggle). User feedback: too many tables, edits stack on edits, "what's the source of truth?" is unclear. Pass 7 deletes the inheritance surface entirely from the Inputs UI. Each asset owns its own cost lines. No master. No replicas. No overrides.

Combined views still live in the Results sub-tab (Tables 1-4 already aggregate per-asset).

---

## Fix matrix

| # | Area | Change |
|---|------|--------|
| 1 | Tab 2 Land Parcels UI | Remove Roads %/Parks % cells from each parcel row. Add a project-level summary block after the Total Land row with Apply NDA toggle + Roads % + Parks % inputs and a Gross/Net NDA derivation. |
| 2 | Tab 2 Sub-unit verification | Collapse the multi-row verification block to a single compact line. |
| 3 | Tab 2 Sub-units table | `table-layout: fixed` + explicit colgroup. Area visible in both Area + Units modes (editable in Area, derived caption in Units). Add "Total Revenue (No Indexation)" column: Area mode = Area x Rate; Units mode = Count x Rate. |
| 4 | Tab 3 Costs table | Refined colgroup widths: Cost Line 220, Method 200, Category 100, Driver 100, Value 120, Start 60, End 60, Phasing 100, Total 140, Toggle 60, Delete 40. Ellipsis + title tooltip on overflow. |
| 5 | Tab 3 Costs UI | ARCHITECTURE REWRITE. Drop master template + per-asset replicas + Override toggle. Replace with `PerAssetInputsView`: phase filter, asset pill bar, single editable cost line table for the selected asset. Each cost line in storage carries `targetAssetId` (every line is asset-owned). |
| 6 | Tab 3 Costs UI | Drop "All Assets" combined input view. Combined remains in Results sub-tab. |
| 7 | Results | No changes. |

---

## Schema changes (v8 additive + deprecation)

### Cost lines are now always asset-owned

- `CostLine.targetAssetId` is now **required** in the post-Pass-7 surface. The schema field stays optional for back-compat with legacy snapshots; migration backfills it for every line.
- Composed id pattern extends from `${baseId}__${phaseId}` to `${baseId}__${phaseId}__${assetId}` so every line is globally unique.
- `CostOverride[]` is deprecated. Schema retained for legacy snapshots; UI no longer reads or writes. Migration flattens overrides into per-asset lines.
- `Project.costInputMode` already deprecated since Pass 4. No re-introduction.

### Allocated costs (project-wide)

`category: 'allocated'` lines stay on a single asset (UX convention: place them on the phase's first visible asset). Calc engine continues to compute the pool against aggregated phase metrics and distribute per asset via `costDriver` (BUA / Land / Value share). No schema change.

---

## Migration `migrateM20costsPass7PerAsset`

Idempotent. Runs on every hydrate (`stripV8Wrapper`, `stripWrapper`, `migrateLegacyToV8`).

Walk: for each cost line currently in `costLines`:
1. If `line.targetAssetId` is set, KEEP AS-IS (already per-asset).
2. If `line.targetAssetId` is undefined (legacy "master" line), REPLICATE to each visible asset in the same phase:
   - New id = `${baseId}__${phaseId}__${assetId}` (preserve baseId derivation).
   - Set `targetAssetId = asset.id`.
   - If a matching `CostOverride` exists for this line + asset, fold its fields onto the replica (method, value, phasing, distribution, perSubUnitRates, startPeriod, endPeriod, debtPctOverride, equityPctOverride, disabled). Otherwise the replica inherits the master values verbatim.
3. Remove the original master line (id without assetId suffix).

After walking lines, clear `costOverrides[]`. (Schema retained, but migration drops the data; the UI no longer surfaces it.)

Banner stamped on snapshots that needed flattening: `M20COSTS_PASS7_NOTICE = "Costs UI simplified to per-asset inputs. Existing cost lines flattened so each asset owns its values. Review in Tab 3."`.

Edge cases:
- Phase has zero visible assets: master lines are dropped (nothing to replicate to). User adds assets first.
- `selectedLineIds` references on `percent_of_selected` lines: each replica's `selectedLineIds` are rewritten to the same asset's per-asset replicas of the referenced base ids.
- Cost line with `targetAssetId` set BUT no matching asset (orphan): dropped on hydrate.
- Auto-IDC lines (`isLocked=true`, id starts `auto-idc__`): already per-asset (`targetAssetId` populated by `applyIdcToCapex`). Untouched.

---

## UI changes

### Tab 3 Inputs (new layout)

```
TAB 3: DEVELOPMENT COSTS

[1. Inputs]  [2. Results]

Header line: "All figures in SAR '000"

PHASE FILTER: [All Phases v]
ASSET PILLS: [Asset 1 (P2)] [Asset 2 (P2)] [Asset 3 (P3)] [+ Add]

────────────────────────────────────────
SELECTED ASSET: Asset 1 (Phase 2, Sell)
  Stats: BUA / NSA / Land sqm / Land Cost

  COST LINES TABLE (editable, per-asset)
  Cost Line | Method | Category | Driver | Value | Start | End | Phasing | Total | Toggle | X

  [+ Add Cost Line]

  Asset Subtotal: X
```

### Tab 1 Land Parcels (Pass 7 Fix 1)

Per-parcel Roads/Parks cells removed; project-level NDA card now lives below the Total Land row of the Parcels table:

```
Land Parcels Totals: 22,066 sqm | SAR 2.17B

NDA Calculation (project-level):
  [ ] Apply NDA Deduction
  Roads %: [12.0]
  Parks %: [ 8.0]
  Gross NDA = 22,066 x (100% - 12% - 8%) = 17,653 sqm
  Net NDA   = 17,653 sqm
```

The Pass 6 Tab 1 NDA card is the same data, just moved into the per-parcel section of Tab 2 to live with the Total Land row.

### Tab 2 Sub-units table (Pass 7 Fix 2 + 3)

- Sub-unit verification block collapses to a single line: `Verification: BUA 130,874 | NSA 84,297 | Eff 64.4% | Land 5,718 | Land Cost 562.94M`.
- Sub-unit table headers: `Type | Category | Metric | Area (sqm) | Unit Size | Count | Rate | Total Revenue (No Indexation) | -`.
- `table-layout: fixed` with colgroup. Area always rendered. Units mode shows derived area as a caption inside the Area cell.
- Total Revenue column: read-only computed cell.

---

## Cross-tab integration

- **Auto-IDC** (Tab 4 -> Tab 3): unchanged. `applyIdcToCapex` already targets each asset; lines land directly in the per-asset table.
- **Land In-Kind -> Equity Tranche** (Tab 3 -> Tab 4): unchanged. Tab 4's auto-equity effect reads aggregated in-kind land value via `resolveAssetAreaMetrics`.
- **Financing hooks** (`getCapexExclLandInKind` etc.): unchanged. Hooks aggregate via `computeAssetCost` per asset, then sum to project periods. The migration produces an equivalent set of per-asset breakdowns; aggregated capex per period is bit-identical post-migration for snapshots that didn't carry overrides.

---

## Commit plan

1. This design note.
2. P7-Fix 5a: schema + migration (`migrateM20costsPass7PerAsset` + `M20COSTS_PASS7_NOTICE`).
3. P7-Fix 5b + 6: per-asset Inputs UI (drop Master + Replicas + Override toggle, replace with `PerAssetInputsView`).
4. P7-Fix 1: Roads/Parks NDA summary block on Tab 2.
5. P7-Fix 2: sub-unit verification compact line.
6. P7-Fix 3: sub-units Total Revenue column + alignment.
7. P7-Fix 4: cost table column widths balanced.
8. Verifier `verify-m20costsCleanup-pass7.ts` + CLAUDE.md update.

Each commit type-checks clean. Vercel verified per commit.

---

## Deferred from this pass

- Dedicated "Project Common Costs" section above the asset pills (allocated costs still attach to the first visible asset for now; promotion to a top-level section if user feedback finds it confusing).
- Results sub-tab tweaks (Pass 7 leaves Results untouched per brief).
- Playwright spec (verifier + manual smoke covers the surface).
