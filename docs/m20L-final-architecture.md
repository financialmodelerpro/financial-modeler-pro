# M2.0L Final Architecture, Inheritance + Category + Driver

**Date:** 2026-05-11
**Status:** Final extensions to the Pass 4 parent/child inheritance cost engine. Schema stays v8 additive. No rewrites; this is a delta on top of Pass 4.

---

## Pass 4 recap

- One master `CostLine[]` per phase (project-wide).
- `CostOverride[]` keyed by `(assetId, lineId)` carries per-asset overrides.
- `CostOverride.overridden`: false = inactive (read master) / true (or legacy undefined) = active (per-field override with master fallback).
- `CostOverride.startPeriod` / `endPeriod`: optional per-asset timing override.
- UI: master template at top + per-asset resolved replicas below; each row has Source pill + Override toggle.

## What Pass 5 adds

### 1. Cost Category per line (Direct vs Allocated)

```ts
type CostCategory = 'direct' | 'allocated';
```

- **Direct (default for most lines):** the cost belongs to the asset it's computed against. The current per-asset compute path (`rate × asset.bua = asset's contribution`) covers this. No allocation factor applied to non-`fixed` methods (Pass 3 Fix 3 semantic preserved).
- **Allocated:** the cost is a project-wide pool that splits across visible assets in the phase using a driver. Standard catalog examples: a master-planning fee, a project-management retainer, an infrastructure pool that funds all assets.

```ts
type CostDriver = 'bua_share' | 'land_share' | 'value_share';
```

Driver is required only when `category === 'allocated'`. The calc engine applies the share at compute time:
- `bua_share` -> asset's BUA / phase total BUA
- `land_share` -> asset's land sqm / phase total land sqm
- `value_share` -> asset's resolved development value / phase total

Direct lines ignore driver entirely.

### 2. Auto-derived Cost Type (internal)

```ts
type CostType = 'hard' | 'soft' | 'land_cash' | 'land_in_kind' | 'operating';
```

Not user-visible. Derived from method + line id at compute time:
- `method = 'percent_of_cash_land'` -> `land_cash`
- `method = 'percent_of_inkind_land'` -> `land_in_kind`
- `stage = 'operating'` -> `operating`
- `stage = 'soft'` -> `soft`
- everything else with `stage = 'hard'` -> `hard`

Used by Results tables and future M5 benchmark callouts. Schema does NOT store costType; `deriveCostType(line)` returns it on demand.

### 3. Migration

`migrateM20Pass5Categories` runs at the tail of the migration chain:
- For every existing master `CostLine`, set `category = 'direct'` if undefined. (All pre-Pass-5 lines were effectively direct under the Pass 3 calc fix.)
- For lines whose `allocationBasis === 'bua_share' | 'land_share' | 'category'` AND whose method is one of the asset-specific methods, leave `category = 'direct'` but flag a one-line note in the migration banner. (No automatic conversion to `allocated`; users opt in.)
- New: `PASS5_MIGRATION_NOTICE = "Cost lines now carry Category + Driver. Existing lines default to Direct; review Tab 3 to mark project-wide pools as Allocated."`

### 4. UI

Master row gains two new cells:
- **Category** dropdown: Direct / Allocated.
- **Driver** dropdown (visible only when Category = Allocated): BUA share / Land share / Value share.

Per-asset replica rows display Category + Driver as read-only badges (inheritance still applies: per-asset overrides can override category + driver if needed, but the typical use is to keep these at the master level).

Sub-unit table tweak (Pass 5):
- Units metric: the derived Area cell is dropped from the row and rendered as a small caption below the row (`{count} units × {unitArea} sqm = {totalArea} sqm`). Frees a column.
- Area metric: unchanged from Pass 3 (Unit Size + Count columns absent entirely).

## Commit plan

1. **This file** (design note, first commit).
2. **Schema**: `CostCategory` + `CostDriver` types + optional fields on `CostLine`; `CostType` enum + `deriveCostType()` helper; migration; banner.
3. **UI**: Category + Driver dropdowns on master row; sub-unit Units-mode caption.
4. **Calc engine**: when `category === 'allocated'`, apply `driver`-based factor; when `direct`, skip allocation as today.
5. **Verifier** `scripts/verify-m20L-pass5.ts` + docs (CLAUDE.md status + Module 1 Conventions Cost engine block).

Per-commit Vercel deployment verification mandatory.
