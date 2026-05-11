# M2.0 Costs Cleanup Pass 8

**Date:** 2026-05-12
**Scope:** 8 targeted fixes following Pass 7 verification.

---

## Fix matrix

| # | Area | Change |
|---|------|--------|
| 1 | Tab 2 NDA placement | Move NDA card from Tab 1 to Tab 2 (below Land Parcels totals row). Add NDA Scope toggle (Project / Per-Asset). Per-Asset mode adds Roads % + Parks % + NDA toggle to each asset card. Land COST always stays on gross land; NDA only modifies the developable area used by `rate_per_nda` / development-capacity calcs. |
| 2a | Sub-units Units mode | Inputs are Area (sqm) + Unit Size (sqm). Count derives = Area / Unit Size. Replaces Pass 7's count + unitArea pattern (count = metricValue when units, derived area was displayed). |
| 2b | Count header | Replace static "Count" with dynamic label (Units / Keys / Beds / Bays / Tenants) driven by sub-unit category + asset strategy + asset type via `countUnitLabel`. Per-row caption mirrors the same label singular. |
| 2c | Metric per asset | `SubUnit.metric` deprecated. New `Asset.subUnitMetric: 'area' | 'units'` is the single source of truth per asset. UI moves the metric selector from per-row dropdown to a single asset-level toggle. Switching converts every sub-unit (preserves displayed area). |
| 3 | Top-right phase dropdown | Removed from Tab 3. Asset pill bar's preceding phase filter is the sole navigation. Empty-phase state surfaces a helpful message + keeps the phase filter dropdown interactive. |
| 4 | Drop Category + Driver | Cost line table goes 11 cols -> 9 (Cost Line, Method, Value, Start, End, Phasing, Total, Toggle, Delete). `CostLine.costCategory` + `costDriver` deprecated; schema fields stay, UI no longer surfaces them, calc engine treats every line as Direct. |
| 5 | Start/End defaults | New cost lines default `startPeriod=0`, `endPeriod=maxConstructionPeriods+1` (max across all phases). Migration clamps legacy lines whose `endPeriod` exceeds the project's max construction + 1. Warning chip when End is beyond max construction window. |
| 6 | %-of-selected dropdown | Audit `PercentOfSelectedPicker`: confirm the dropdown button + popover + chips render in the Pass 7 per-asset surface. Picker now anchors below the row's method cell instead of the dropped master/replica row that hosted it pre-Pass-7. |
| 7 | Phase filter | Drop "All Phases" option. Phase filter shows individual phases only (default = first phase with assets, else first phase). |
| 8 | Results Combined/Single | New `resultsViewMode: 'combined' | 'single_asset'` + `resultsSelectedAssetId` on Project. Toggle at top of Results sub-tab. Combined groups by cost-line type with asset sub-rows + subtotals + project total. Single Asset filters to one asset's cost lines. |

---

## Schema changes (v8 additive)

### New / re-exposed

- `Project.projectNdaScope?: 'project' | 'asset'` (Fix 1). Defaults `'project'` post-migration.
- `Asset.assetRoadsPct?: number` (Fix 1).
- `Asset.assetParksPct?: number` (Fix 1).
- `Asset.assetNdaEnabled?: boolean` (Fix 1).
- `Asset.subUnitMetric?: 'area' | 'units'` (Fix 2c). Single source of truth per asset; derived from first sub-unit's metric on hydrate.
- `Project.resultsViewMode?: 'combined' | 'single_asset'` (Fix 8). Defaults `'combined'`.
- `Project.resultsSelectedAssetId?: string` (Fix 8). Required when view mode is `single_asset`.

### Deprecated (kept on schema for back-compat, dropped from UI)

- `CostLine.costCategory` (Fix 4). Schema field retained; calc engine treats every line as Direct.
- `CostLine.costDriver` (Fix 4).
- `SubUnit.metric` (Fix 2c). Schema field retained; runtime reads `asset.subUnitMetric` when set.

---

## Migration `migrateM20costsPass8`

Idempotent. Runs on every hydrate.

1. **NDA scope default.** When `project.projectNdaEnabled === true` and `projectNdaScope` is undefined, stamp `projectNdaScope='project'`.
2. **Sub-unit metric to asset.** For each asset that lacks `subUnitMetric`: take the first sub-unit's metric (`'units'` or `'area'`; legacy `'count'` reads as `'units'`); stamp on asset. Convert every other sub-unit in the asset to that metric (preserve displayed area).
3. **Start/End clamp.** Compute `maxCp = max(phase.constructionPeriods)`. For each cost line whose `endPeriod > maxCp + 1`, clamp to `maxCp + 1`.
4. **Results view default.** Stamp `project.resultsViewMode='combined'` when undefined.

Banner stamped on snapshots that needed migrating: `M20_PASS8_NOTICE = "Costs UI refined, sub-unit metric now per-asset and NDA placement updated. Review Tab 2 + Tab 3."`.

---

## UI changes

### Tab 2 Assets & Sub-units

NDA card moves below the Land Parcels totals row, before Phase Asset sections:
- Apply Roads/Parks Deduction toggle
- NDA Scope radio (Project-level / Per-Asset)
- Project mode: single Roads % + Parks % inputs + Gross / Net derivation
- Per-Asset mode: each asset card shows its own Roads % + Parks % + Apply Roads/Parks toggle; project-level inputs disabled

Sub-units table:
- Asset-level Metric toggle (Area / Units) above the sub-unit table.
- Per-row metric dropdown removed.
- Units mode renders Unit Size column + derived Count (Count = Area / Unit Size). Area column stays editable in both modes.
- Count header swaps to dynamic label (Units / Keys / Beds / Bays / Tenants) via `countUnitLabel`.

### Tab 3 Inputs

- Top-right phase dropdown removed.
- Phase filter dropdown drops "All Phases"; first option is the first phase with assets.
- Asset pill bar stays.
- Empty-phase state renders a message + keeps the phase filter active.
- Cost line table = 9 columns (no Category, no Driver).
- New cost lines default `startPeriod=0`, `endPeriod=maxCp+1`.
- `PercentOfSelectedPicker` renders below the row when method = `percent_of_selected`.

### Tab 3 Results

- New view toggle at the top: `Combined` / `Single Asset [asset picker]`.
- Combined view: Capex by Period table groups by cost line type; each group shows asset sub-rows + a subtotal; final Project Total row.
- Single Asset view: filters to one asset's cost lines, rows = cost lines, cols = periods.
- Tables 2-4 (CAPEX Incl Land / Excl Land In-Kind / Excl Total Land) filter to that asset when Single is selected.

---

## Commit plan

1. Design note (this file).
2. P8-Fix 1: Tab 2 NDA card + scope toggle + per-asset Roads/Parks.
3. P8-Fix 2: sub-unit metric per asset + dynamic Count header + Units mode (Area + Unit Size, Count derived).
4. P8-Fix 4: drop Category + Driver columns (cost table 11 -> 9 cols).
5. P8-Fix 5: Start/End defaults + migration clamp.
6. P8-Fix 6: %-of-selected picker visibility audit.
7. P8-Fix 7: drop "All Phases" from phase filter.
8. P8-Fix 3: drop top-right phase dropdown + empty-phase state.
9. P8-Fix 8: Results Combined / Single Asset toggle + per-cost-line grouping.
10. Migration + Verifier + CLAUDE.md.

Each commit type-checks clean; Vercel verified per push.

---

## Deferred per brief

- Playwright spec (verifier + manual smoke cover the surface).
- Multi-cost-line type subtotal styling polish (basic colored row already in scope).
