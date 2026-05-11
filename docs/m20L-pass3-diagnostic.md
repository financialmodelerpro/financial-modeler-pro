# M2.0L Pass 3, Diagnostic Note

**Date:** 2026-05-11
**Trigger:** User reports multiple Pass 2 fixes (commits b03fa02 / 5c50ae3 / 267478a / 9871fbe / 0dc7897) "did NOT land properly. Multiple fixes still broken in browser."

## Per-fix audit of current code state

### Fix 1, sub-unit hide Unit Size + Count when Area mode (b03fa02)
- Code state: `Module1Assets.tsx` line 1226 detects `showUnitColumns = assetSubUnits.some(metric === 'units')`. Headers + `<col>` + `<td>` all wrapped in `{showUnitColumns && ...}`.
- Behaviour: columns hide ONLY when EVERY sub-unit in the asset table is Area metric. If even one sub-unit uses Units, columns show for the entire table (mixed table).
- Browser gap: likely the user added a single Units sub-unit which forces columns on for everything else. Or, deploy failed (Vercel HTTP 500 on commits 5c50ae3 / 267478a). The shipped behaviour is per-table not per-row; this matches the brief's interpretation of "Area mode = no Units rows in the table" but may not match a per-sub-unit-row expectation. **Status: code shipped; behaviour may be misinterpreted by user. Reaffirm.**

### Fix 2, fixed column widths (b03fa02)
- Code state: `tableLayout: 'fixed'` + `<colgroup>` widths per column. Widths shift between 6-col and 9-col layouts because hiding 2 columns frees space; widths within each layout are identical row to row.
- Browser gap: probably not the user's complaint. **Status: shipped.**

### Fix 3, cost engine reads area + value (5c50ae3)
- Code state:
  - `Module1Costs.tsx` line 2051: `metricsByAsset` phase-scopes `phaseAssets`. ✓
  - `calculations/index.ts` line 965: `FIXED_METHODS_NEEDING_ALLOC = new Set(['fixed'])`. Only `fixed` method goes through `resolveAllocationFactor`; every other method gets `allocFactor = 1`. ✓
  - `resolveAssetAreaMetrics` line 591: `bua = hierarchy.bua > 0 ? hierarchy.bua : (assetSubUnitCount === 0 ? asset.buaSqm : 0)`. ← **Gap: if sub-units exist but their computed area is 0 (e.g., metric=units, unitArea=0), bua stays 0 even when asset.buaSqm is populated.**
- Browser gap: Same-mode user with sub-units but missing Unit Size values would see x 0. Legacy projects that have asset.buaSqm but stub sub-units with no Unit Size suffer the same way.
- **Fix needed:** widen the fallback to `bua = hierarchy.bua || asset.buaSqm` (use whichever is non-zero). Same for NSA.

### Fix 4, Same vs Individual aggregation (9871fbe)
- Code state: `aggregatePhaseMetrics(phaseAssets, metricsByAsset)` sums every AssetAreaMetrics field. SameModeCostTable passes this to the master row.
- Browser gap: only as a downstream of Fix 3 (if every asset's m.bua = 0, sum is also 0). Once Fix 3 hardens, Fix 4 unblocks. **Status: shipped, blocked on Fix 3.**

### Fix 5, value column unit hint (267478a)
- Code state: `valueUnitHint(method, currency)` returns SAR / SAR/sqm / SAR/unit / SAR/bay / % / "Multiple rates". Renders below the value input as italic caption.
- Browser gap: only visible if commit deployed. Vercel HTTP 500 on commit 267478a may have prevented deploy of this fix until a later commit retriggered build. **Status: shipped; deploy-dependent.**

### Fix 6, inputs always full-scale (267478a)
- Code state: cost line value input is `scale="full"` (no longer `scale={effMethod.startsWith('percent_') ? 'full' : scale}`). Other AccountingNumberInput uses (parcel rate, sub-unit unitPrice) were already `scale="full"`.
- Browser gap: deploy-dependent. **Status: shipped.**

### Fix 7, End period max from construction periods (267478a)
- Code state: `<input type="number" max={constructionPeriods}>` + `aria-invalid` + "into operations" warning when `line.endPeriod > constructionPeriods`.
- Browser gap: **HTML `max` attribute does NOT prevent typing higher values in all browsers; it only validates on form submit.** Existing cost lines with hardcoded endPeriod=24 (from when the asset's cp was 24 at seed time) are not retroactively clamped.
- **Fix needed:** auto-clamp `line.endPeriod` to `min(line.endPeriod, constructionPeriods)` when rendering, or surface a one-click "Clamp to construction window" button.

### Fix 8, delete button per cost line (267478a)
- Code state: `{!isLocked && <button onClick={confirm + onRemoveLine}>✕ delete</button>}` in the Toggle column. Locked seed lines (Land Cash / Land In-Kind / auto-IDC) keep button hidden.
- Browser gap: deploy-dependent. **Status: shipped.**

### Fix 9, 4 stacked Results tables (0dc7897)
- Code state: existing "Capex by Period (per cost line)" + 3 new `renderSummary` calls for Excl All Land / Excl Land In-Kind / Incl All Land. `perPeriodLandTotal` + `perPeriodLandInKind` added to `AssetCostBreakdown`. Hide-zero rows filter, total in 2nd position.
- Browser gap: deploy-dependent. **Status: shipped.**

### Fix 10, Same Mode master + replicas (9871fbe)
- Code state: master editable table + per-asset read-only replicas below. Each replica shows asset-specific multiplier captions + subtotal.
- Browser gap: deploy-dependent + blocked on Fix 3 if multipliers all resolve to 0. **Status: shipped, blocked on Fix 3.**

## Root causes for "still broken in browser" feedback

1. **Vercel HTTP 500 clone failures** on commits 5c50ae3 + 267478a (reported by user). Deploys for Fixes 3, 5, 6, 7, 8 may have skipped until a later commit retriggered build. **Action: every commit in this Pass 3 series triggers fresh build; user should pull/refresh.**

2. **Fix 3 area fallback too narrow** (only fires when zero sub-units). When user has stub sub-units with zero area (unitArea blank, count blank), `hierarchy.bua` is 0 AND `assetSubUnitCount > 0`, so the fallback to `asset.buaSqm` does NOT trigger. **Action: widen fallback to `hierarchy.bua || asset.buaSqm`.**

3. **Fix 7 max-bound is soft.** HTML `max` doesn't prevent state values > max, and existing cost lines from the default seed carry hardcoded values that exceed user's reduced construction window. **Action: auto-clamp at render time, or display "exceeds construction window" warning prominently.**

## New fixes (Pass 3)

- **Fix 11:** merge Rate + Rate Unit columns in sub-unit table into a single dynamic header.
- **Fix 12:** currency propagation audit. Most UI already uses `project.currency` parameterized; verify no hardcoded `SAR` strings in visible labels.
- **Fix 13:** drop the per-cost-line strategy tagline. M2.0j Fix 13 already removed Stage labels but the `accountingDestination(asset)` text still renders inside the asset section HEADER (not per cost line). User's complaint may target either the asset section header (which is correct, it's strategy-level) or the per-row `title` tooltip. **Action: drop per-row Stage tooltip; keep asset-header destination.**

## Commit plan

1. **This file** (diagnostic note, first commit).
2. **Re-fix Fix 3** (widen area fallback to `||`).
3. **Re-fix Fix 7** (auto-clamp endPeriod at render).
4. **Fix 11** (merge Rate columns).
5. **Fix 12** (currency hardcode audit, scan + remove any visible SAR literals).
6. **Fix 13** (drop per-row Stage tooltip).
7. **Docs update** (CLAUDE.md / CLAUDE-TODO.md).
