# Tab 2 Pass 2 audit — data ownership vs current code

**Date:** 2026-05-12
**Inputs:** `Tab2_Pass2_Data_Rules.md` (4 rules + 4 fixes).
**Scope:** Audit only. No code changes here.

---

## Rule vs Implementation

### Rule 1: Asset Land Allocation

| Priority | Rule | Current code | Gap |
|----------|------|--------------|-----|
| 1 | Explicit `landAllocation.sqm > 0` wins | `src/core/calculations/index.ts:200-203` checks `landAllocation.sqm > 0` | OK |
| 2 | `autoByBua` = `bua/totalBua * phaseLand` | line 234-235 uses `agg.totalAreaSqm` (gross sum of phase parcels) | OK for gross; NDA-aware variant not wired |
| 3 | Fallback equal-share when `totalBua=0` | line 230-233 splits `agg.totalAreaSqm` equally | OK |
| 4a | Companion (`isCompanion=true`) returns 0 | line 227 (after splits + sqm/percent + agg checks) | **Gap**: should be at top per Rule 2 |
| 4b | No parcels in phase returns 0 | line 193 `agg.totalAreaSqm <= 0 return 0` | OK |
| Crit | Phase with NO non-companion assets returns 0 for that phase | `phaseAssets` filter at line 228 + length check at line 231 | OK on path through; tighten by gating early |

Pass 1 introduced an **unconditional cross-mode fall-through** at lines 200-209
(sqm and percent modes silently fall into the autoByBua branch when the
explicit value is 0). Pass 2 keeps this behaviour because the default project
mode is `autoByBua` and most user data hits the autoByBua path directly, but
the function is reordered so that:

  1. Companion gate is the FIRST check.
  2. Phase parcels gate is the next early-return.
  3. Phase non-companion assets gate is the next early-return.
  4. Explicit sqm/percent allocations win when > 0.
  5. autoByBua bua-share or equal-share fallback finishes the resolution.

This matches the user's pseudocode order exactly and keeps the existing 5-arg
signature so every call site compiles unchanged.

### Rule 2: Companion has NO physical attributes

| Surface | Rule | Current code | Gap |
|---------|------|--------------|-----|
| Land Allocation block | hidden | `Module1Assets.tsx:1234` `{!asset.isCompanion && (...)` (Pass 1 Fix 5a) | OK |
| Area Reconciliation summary line | hidden | `AssetAreaReconciliationBlock` always renders | **Gap** Fix 3 |
| Areas Row (Support / Parking / GFA inputs) | hidden | Always renders | **Gap** Fix 2 |
| Asset NDA per-asset row | hidden | Always renders when `projectNdaScope === 'asset'` | **Gap** Fix 2 |
| NSA / BUA / GFA hierarchy chips | hidden | Always renders | **Gap** Fix 2 |
| Asset card footer summary | hidden | Always renders | **Gap** Fix 2 |
| Land Recon table per-asset rows | excludes companion | `LandReconciliationBlock` iterates `assets.filter(a => a.visible)` → companion included | **Gap** Fix 2 |
| Cost lines (area-based methods) | show 0 with note | `calculateItemTotal` uses `bua=0` for companion, so 0 is correct; no explanatory note | Defer note (cost engine returns 0 already) |

### Rule 3: Conditional rendering on companion

Implemented partially. Fix 2 + Fix 3 close the remaining surfaces listed
above.

### Rule 4: Phase-level aggregation

`computeLandReconciliation` aggregates across ALL visible assets project-wide,
including companions. After Fix 1 (companion → 0 sqm) the sum is correct, but
defensively the iteration filters companions explicitly so the LAND
reconciliation table never includes a companion row (Rule 2 surface).

---

## Fix order

1. **Fix 1 — `computeAssetLandSqm` rewrite** (calc layer only).
2. **Fix 2 — companion guard sweep** (Module1Assets.tsx + LandReconciliationBlock).
3. **Fix 3 + 4 — auto-managed recon** (AssetAreaReconciliationBlock).
4. **Closure** — verifier + Playwright DOM proof + CLAUDE-REFM.md.

Each fix lands as its own commit + push. Schema stays v8 additive (no new
fields). Tab 1 / Tab 3 / Tab 4 untouched.
