# REFM Platform Master Plan, Modules 2 to 6

**Owner:** Ahmad. **Author:** Claude Code. **Last updated:** 2026-05-17.
**Source of truth for sequencing:** this file. Per-pass narratives still land in `CLAUDE-REFM.md`; this file is the forward map and decision log.
**Verification benchmark:** `Maad_Residential_Cashflow v1.16 05132026 all Tabs.xlsx` at repo root (17 sheets). Every MAAD-specific behaviour is configurable, MAAD is the regression fixture, not the spec.

---

## 0. Formatting parity guarantee (re-confirmed at Pass 7)

Every Module 2 and onward surface MUST consume the same design tokens already used by Module 1. No tab-local style objects, no Tailwind classes for layout. Re-confirm before each new file is created. The checklist:

| Token | Source | Used for |
|---|---|---|
| `CELL_HEADER`, `CELL_HEADER_TOTAL` | `components/modules/_shared/tableStyles.ts` | every `<th>` in a results table |
| `ROW_DATA`, `ROW_SUBTOTAL`, `ROW_GRAND_TOTAL`, `ROW_ASSET_HEADING` | same | every `<td>` (each has `.name` + `.num` + `.numTotal`) |
| `TABLE_TITLE` | same | every results-table caption |
| `COLUMN_WIDTHS.label` (`22%`) + `nonLabelColumnPct(N)` | same | `<colgroup>` widths so columns rebalance with axis size |
| `var(--color-heading)` | `app/globals.css` | every section / table heading |
| `var(--color-meta)`, `var(--color-text-muted)` | same | captions, hints, italics |
| `var(--color-navy)`, `var(--color-navy-pale)` | same | FAST blue input bg + tab strip active fill |
| `var(--color-grey-pale)` | same | calc-output / read-only chip backgrounds |
| `var(--color-border)`, `var(--color-border-strong)` | same | every border |
| `var(--color-surface)`, `var(--color-surface-alt)` | same | card / placeholder backgrounds |
| `var(--font-h1)`..`var(--font-micro)` | same | every font-size declaration |
| `var(--sp-1)`..`var(--sp-5)` | same | every padding / margin / gap |
| `var(--radius-sm)` | same | every rounded corner |
| `formatAccounting(value, project.displayScale ?? 'full', project.displayDecimals ?? 2)` | `src/core/formatters` | every currency cell |
| `formatPercent(value, 2)` | same | every % cell (2-decimal default, never scaled) |
| `formatArea(value, project.displayDecimals ?? 2)` | same | every sqm cell (never scaled) |
| `currencyHeaderLine(project.currency, project.displayScale ?? 'full')` | same | top of every output tab |
| `makeProjectFormatter({ displayScale, displayDecimals })` | same | convenience for one-line setup |

**Formatter parity contract (Pass 7b lock):**
Both Module 1 and Module 2 read `project.displayScale` and `project.displayDecimals` for every numeric cell. Hardcoded `'full'` or `0` is a bug. Pattern in every module component:
```ts
const scale: DisplayScale = project.displayScale ?? 'full';
const decimals: DisplayDecimals = project.displayDecimals ?? 2;
const fmt = useMemo(() => makeFmt(scale, decimals), [scale, decimals]);
```
Where `makeFmt = (s, d) => (v) => formatAccounting(v, s, d)` returns a closure suitable to pass to every table / matrix component as the `fmt` prop. Percentages stay locked at 2 decimals per spec; areas never scale by thousands / millions even when `displayScale = 'thousands'`. The header line `currencyHeaderLine(currency, scale)` renders once per tab so cells never carry the K / M suffix.
| `FAST_INPUT` pattern (local const, references `--color-navy-pale` + `--color-navy`) | per file | every editable input in REFM |
| `PercentageInput` + `AccountingNumberInput` | `components/ui/` | every editable currency / % cell |

Pass 7 audit result: green. Same tokens used in `Module2RevenueOutput.tsx`, `Module2CostOfSales.tsx`, `Module2Schedules.tsx` as in `Module1Financing.tsx` (116 token uses each, identical CSS variable set, identical formatter helpers). No re-format work needed for the remaining passes; just stay disciplined.

---

## 1. MAAD workbook map (17 sheets, what we model from each)

| MAAD sheet | What it holds | Our module |
|---|---|---|
| **Cover** | project overview, asset mix, currency, time horizon | M1 Tab 1 (already done) |
| **Revenue** | pre-sales schedule, indexation, cash payment + recognition profiles, escrow, hospitality (rooms + F&B + other), retail (NLA × rent) | **M2** |
| **Costs** | Hospitality opex (departmental + undistributed + management + G&A + S&M + pre-operating), Retail opex | **M3** |
| **Capex** | per-asset cost stack (Land + Construction + Infra + Landscaping + Pre-operating + Professional fee + Commission + Contingency) | M1 Tab 3 (already done) |
| **Capex Allocation** | per-line per-year % distribution of capex | M1 Tab 3 (already done) |
| **Debt** | Tranche 1 SNB Phase 1 + Tranche 2 SNB Phase 2, rate, tenor, drawdown year, repayment schedule | M1 Tab 4 (already done) |
| **CF** | Revenue Received, Costs Paid, Debt Movement, Equity Movement, Net Cash | **M4 CF statement** |
| **P&L** | Revenue, CoS, Gross Margin, OpEx, EBITDA, Depreciation, Interest, Tax, Net Income | **M4 P&L statement** |
| **Wafi Escrow** | per-asset 4% locked + release schedule | **M2** (engine done in Pass 2, surfaced in Pass 7 Tab 4) |
| **Land Summary** | per-parcel area, price, value, % per phase | M1 Tab 2 (already done) |
| **Review Summary** | key totals snapshot, capex by asset, returns | **M5 Returns + M6 Reports** |
| **Actual P&L** | VOCO (existing operations) operating P&L | **M4** existing-operations slot |
| **BS Plan** | balance sheet blueprint with line-by-line driver / source mapping | **M4 BS** |
| **BS Build** | working AR / AP / Inventory / Unearned schedules with DSO / DPO drivers | **M4 BS** (engine extends Pass 7) |
| **Memory** | project memory document | platform-side documentation |
| **Audit Findings** | model audit log | **M6 Reports** |
| **Business Inputs** (referenced) | sub-unit area, rate, mix | M1 Tab 2 (already done) |

---

## 2. Module 2 (Revenue), remaining build cadence

**Pass 7 sub-series (closed 2026-05-17), Residential Sell flow:**
- 7 (commit `8d7be25`): 4 sidebar sub-tabs (Inputs / Revenue / CoS / Schedules), AR + UR + CoS engines.
- 7a-7d: Wafi escrow + multi-cohort removal; vintage matrix; phase-wise collapsible; indexation UI.
- 7e (commit `cfff2c5`): project-wide Sell template + per-asset override + units rounding + SQM preview.
- 7f (commit `fb4f85d`): Revenue Output Block A-F structure (engine emits per-sub-unit + pre/post split arrays).
- 7g (commit `343b56d`): **REMOVED** project-wide template; every Sell asset owns its own cash + recognition + indexation. `revenueTemplates` + `overrideProfile` marked @deprecated (legacy snapshots still parse).
- 7h (commit `927d1f1`): per-asset Revenue narrative, 6 blocks per asset (SQM pre/post/total + cum %, Revenue pre/post/total per sub-unit, Recognition matrix, Cash matrix, AR, UR). Each table carries inline formula caption.
- 7i (commit `72829ba`): Inputs tab Recognition above Cash, both full row, Total column on every calc grid, Indexation Start Year input restored, Step indexation builder UI (per-row Year + Uplift% with factor display).
- 7j (commit `2783c03`): YoY rounding on SQM / units BEFORE revenue derivation. For units-metric, units rounded then area = units × areaPerUnit; for sqm-metric, area rounded to whole sqm. Revenue = roundedArea × indexedRate. Closes ~9k rounding gap vs MAAD reference.
- 7k-7p: AR + UR exploration (MAAD v1.16 roll-forward floored had stuck-balance bug; per-cohort fixed it; MAAD v7.0 literal one-shot wipe was rejected; signed roll-forward was rejected).
- **7q (commit `067678c`): FINAL AR + UR formula** = sale-value driven roll-forward.
  - AR closing = AR opening + Pre-Sales Sale Value - Cash Received (Pre-sales only)
  - UR closing = UR opening + Pre-Sales Sale Value - Revenue Recognised (Pre-sales only on credit side; post-sales nets to 0 because cash=rec same period)
  - Both stay >= 0 by construction; both settle to 0 by end of contract lifecycle.
  - Engine: `accountsReceivable.ts` 1st arg = sale value, 2nd arg = cash; `unearnedRevenue.ts` 1st arg = recognition, 2nd arg = sale value.
- 7r (commit `8134027`): Cumulative % row on Cash + Recognition profile strips (matches KPMG MAAD "Cumulative Payment Profile" line). **Confirmed MAAD v7.0 Sales During Operation parity**: Calc_Retail & Resi. rows 172-188 = `area × sale price × indexation`, recognised + cash-collected in SAME period; our engine matches byte-for-byte via `postSalesCashPerPeriod = postSalesRevenuePerPeriod.slice()` and `postSalesRecognitionPerPeriod = postSalesRevenuePerPeriod.slice()`. Per-asset totals already roll up correctly: `sum(recognitionPerPeriod)` = pre + post sale value -> P&L; `sum(cashCollectedPerPeriod)` = pre-sales cash + op-sales cash -> CF.
- 7s (2026-05-18 pt 1): surfaces Sales During Operation in Revenue Output Blocks 3 + 4 (per-asset). Block 3 splits into 3a (Pre-Sales recognition vintage matrix, unchanged) + 3b (Recognition Summary per period: Pre-Sales / Sales During Operation / Total Revenue Recognised). Block 4 splits into 4a (Pre-Sales cash vintage matrix, unchanged) + 4b (Cash Summary per period: Pre-Sales / Sales During Operation / Total Cash Collected). Engine unchanged (post-sales recognition + cash already same-period since 7f); pure UI surfacing. AR + UR (Blocks 5 + 6) intentionally remain pre-sales-only by construction (SDO collects + recognises same period, no balance forms). Replicates across every Sell asset automatically.
- 7s (2026-05-18 pt 2): restructures the Project Total section into strategy-grouped per-asset breakdown. For each of Revenue (Sales Value), Recognition, Cash the layout is: Residential / Sell (section header) -> Pre-Sales (sub-section) per-asset rows + Total Pre-Sales subtotal -> Sales During Operation (sub-section) per-asset rows + Total Sales During Operation subtotal -> Total Residential / Sell strategy grand; Hospitality / Operations (section) per-asset rows + strategy grand (zero placeholders until Pass 8); Retail / Lease (section) per-asset rows + strategy grand (zero placeholders until Pass 9); Sell + Manage (section) per-asset rows + strategy grand (zero placeholders until Pass 10). PeriodTable gained `'section'` row kind (label-only colspan over Total + year columns, navy-tinted bg) + per-row `indent` so nested groups render cleanly without restyling existing tables. Future Module 4 P&L tab will reuse the same `buildProjectGroupedRows` helper with a new `'pl'` view.

- 7t (2026-05-18): `setRecognitionMethod` was wiping the over-time `percentages` array when toggling to Point-in-Time. Engine only consumes percentages in over-time mode (sell.ts:178-189), so carrying them through PIT is inert. Fix retains the array so toggling Over-Time -> PIT -> Over-Time preserves the user's schedule.
- 7u (2026-05-18): Project Total re-grouping. Sell + Manage no longer renders as a standalone group; parent assets (the sell side) merge into Residential / Sell and gain the Pre-Sales + Sales During Operation nesting (zero placeholders until Pass 10 wires the engine), companions (the operate side) merge into Hospitality / Operations alongside pure Operate assets. Revenue (Sales Value) view drops the Pre/Post nesting because sale value is timing-agnostic; flat per-asset rows showing combined Pre + Post sale value. Recognition + Cash retain the Pre/Post nesting because timing differs there. PeriodTable's `(SAR)` / `(sqm)` unit suffix dropped from titles since the tab header already shows currency + scale; the `unit` prop is marked @deprecated but kept in the signature for back-compat.
- 7v (2026-05-18): two Inputs simplifications. (1) Single-Rate dropped from the indexation method picker (kept None / YoY Compound / Step). Engine type union still accepts 'single_rate' so legacy snapshots load; users with old data switch any method pill to migrate. Step covers the one-time bump use-case with a single entry. (2) Per-sub-unit velocity grid collapsed to a single "All sub-units" lockstep row by default; a per-asset "Split per sub-unit" toggle (localStorage-backed) reveals the existing per-sub-unit editor. Storage stays per-sub-unit so the engine is untouched; collapsed-mode writes call a new `setVelocityForAllSubUnits` helper that propagates to every sub-unit. New `buildSharedVelocityRow` helper renders sub-unit[0]'s schedule as the representative values and auto-flags divergence in the hint when sub-units have drifted apart (so the user knows editing in shared mode will overwrite all). Toggle only shows when an asset has more than one sub-unit.

- 7w (2026-05-18): Sell + Manage parents now get the FULL Sell-side treatment — velocity grid + indexation + cash profile + recognition profile (Inputs tab), per-asset narrative Blocks 1-6 (Output tab), per-asset Cost of Sales table (CoS tab), per-asset AR + UR roll-forwards (Schedules tab). Five filters updated to allow `strategy === 'Sell' || strategy === 'Sell + Manage'`: `revenue-resolvers.ts` engine loop, `Module2Revenue.tsx` `isSell` flag, `Module2RevenueOutput.tsx` `sellAssets` filter, `Module2CostOfSales.tsx` `sellAssets` filter, `Module2Schedules.tsx` `sellAssets` filter. `resolveSellConfig` is strategy-agnostic (reads `asset.revenue?.sell` directly) so no resolver changes needed beyond the loop filter. Sell + Manage companions (operate side, `isCompanion === true`) remain placeholders in Hospitality / Operations until Pass 10 wires the operate engine.

- 7x (2026-05-18): sub-unit reference chip strip on Inputs + Output tabs for every Sell asset. Read-only chips show each sub-unit's name + area + sale rate (per unit if metric='units', per sqm if metric='sqm') so users can verify the M1 Tab 2 inputs without leaving the Revenue surface. Strip lives directly under the asset header on both tabs (above the velocity grids on Inputs, above Section 1 on Output). Duplicated inline in both files (~55 lines each); future refactor candidate to `_shared/SubUnitReferenceStrip.tsx` if a third surface needs it.

- 7y (2026-05-18): metric-aware Block 1 (Output tab). Detects each asset's dominant sub-unit metric via new `resolveAssetMetric` helper. Uniform-units asset (e.g. Residential Tower 01 with `metric='units'` sub-units priced per apartment / hotel key) renders Block 1 in units with section title "Units Sold" and `unitsFmt` (integer rounding, no sqm suffix). Uniform-area asset renders in sqm as before. Mixed-metric asset falls back to sqm with an inline note (sqm is the universal denominator the engine always tracks). Engine update: `sell.ts` now populates `presalesUnitsPerPeriodPerSubUnit` + `postSalesUnitsPerPeriodPerSubUnit` (previously only the asset-level units totals were exposed). Resolver `revenue-resolvers.ts` initializes empty maps in `projectTotals` and accumulates per-sub-unit. `buildTotalSqmReconciledRows` renamed `buildTotalSoldReconciledRows` (math is generic across metrics — sold / total inventory). Reconciliation trailing column relabelled "Cum % Sold" from "Cum % of BUA". Block 2 (Revenue) formula text reads "Pre-Sales {Units|SQM} x base rate x indexation" depending on metric. Block 2c (Total Revenue) is currency-based and remains unchanged. SubUnit type `metric` is `'units' | 'area'`; UI maps 'area' to label "SQM" for user-facing copy.

Verifier `scripts/verify-revenue-rebuild.ts` 32/32 green at end of Pass 7y.

**Decision rationale captured in 7q:** the user has chosen the obligation-driven AR/UR presentation (sale value as the gross credit for both schedules) over the pure IFRS 15 cash-on-credit treatment. AR decomposes the contract via cash; UR decomposes the same contract via recognition. Two schedules share a common opening line (Pre-Sales Sale Value).

**Convention locked across the platform:**
- Pre-sales revenue lumps at sale year (engine variable: `presalesRevenuePerPeriod`).
- Pre-sales cash spreads via cash payment profile (`presalesCashPerPeriod`).
- Pre-sales recognition spreads via recognition profile (`presalesRecognitionPerPeriod`).
- Post-sales (Sales During Operation): revenue = cash = recognition in same period (operating sales).
- Project axis: arr[0] = first active project year (no prior column).
- YoY rounding (units or sqm) applies BEFORE revenue computation.

Remaining Module 2 passes:

### Pass 8, Hospitality Revenue engine + UI
- **Engine:** `src/core/calculations/revenue/hospitality.ts`. Per-asset inputs: rooms (= sub-unit count where category is hotel), starting ADR, indexation, occupancy ramp per year (% per year), F&B revenue % of rooms revenue, Other revenue % of rooms revenue, seasonality (optional). Output: `HospitalityAssetResult` with rooms revenue / F&B revenue / Other revenue / total revenue per period.
- **UI Tab 1 inputs:** Hospitality cards reuse the AssetCard layout but swap velocity grid for: ADR row + Occupancy row + F&B % + Other %, all editable inline. FAST blue inputs.
- **UI Tab 2 outputs:** add 3 new period tables for Hospitality (Rooms / F&B / Other / Total Hospitality Revenue).
- **Tab 3 CoS:** hospitality has no CoS-style matching, recognition = cash = revenue per period (operating). The CoS tab section for hospitality reads "Operating revenue, no deferred cost matching".
- **Tab 4 schedules:** AR for hospitality uses DSO driver (default 30 days, configurable). Engine produces AR per period.
- **Verifier:** `verify-m2-pass8.ts`, MAAD VOCO Hotel + Hotel 01 fixtures. Targets: VOCO 2025 = 309,010 SAR'000, VOCO Total = 6,541,596 SAR'000, Tower 01 Total = 998,402 SAR'000, Hotel 01 Total = 970,246 SAR'000.

### Pass 9, Retail / Office Lease engine + UI
- **Engine:** `src/core/calculations/revenue/lease.ts`. Per-asset inputs: NLA (= sub-unit area where category is retail / office), starting rent per sqm per year, indexation (typically 5% YoY step), occupancy ramp (% per year), service charge % of rent (optional), free-rent months (lease incentive). Output: `LeaseAssetResult` with base rent / service charge / total lease revenue per period.
- **UI Tab 1 inputs:** Lease cards swap velocity for rent + occupancy + indexation + free-rent inputs.
- **UI Tab 2 outputs:** add per-asset Retail / Office Revenue tables.
- **Tab 4 schedules:** AR uses DSO (default 60 days for retail leases).
- **Verifier:** `verify-m2-pass9.ts`, MAAD Support Retail (Phase 2) + Support Retail (Phase 3). Targets: Phase 2 Total = 220,121 SAR'000, Phase 3 Total = 115,889 SAR'000.

### Pass 10, Sell + Manage companion revenue
- **Engine:** companion (operate-side sibling of a Sell asset) inherits sub-units from parent and adds hospitality-style operating revenue starting at handover. Reuses `hospitality.ts` with the companion's own ADR + occupancy. Sell parent's pre-sales runs unchanged.
- **UI:** Sell+Manage AssetCard becomes a 2-pane card: left pane = Sell (velocity / cash / recognition) for the parent, right pane = Operate (ADR / occupancy) for the companion. Single card avoids the user navigating between two assets.
- **Verifier:** `verify-m2-pass10.ts`, MAAD Branded Apartments Tower 2 (Sell + Manage) parent + companion. Targets: parent pre-sales 2,539,827 SAR'000 + companion residual operate revenue 282,214 SAR'000.

### Pass 11, M2 dashboard hook + KPI tiles
- Add 4 Module 2 KPI tiles to the Dashboard module deck: Pre-Sales (lifetime), Post-Sales + Operate (lifetime), Recognition this year, AR / Unearned (latest closing).
- Sparkline next to each tile (recharts) showing the year-by-year trajectory.

### Pass 12, M2 Phase 1 LOCK + verifier consolidation
- Single `verify-m2-phase1.ts` covering Pass 2 + 4 + 7 + 8 + 9 + 10 fixtures end-to-end.
- 5-section structure per `[[feedback_phase_verification_workflow]]`: DB persistence, route smoke, calc correctness, state integrity, Playwright UI light + dark.
- Module 2 marked LOCKED in `modules-config.ts` (status `'done'`, badge `✓`).

---

## 3. Module 3 (OpEx), build plan

Driven by MAAD Costs sheet structure (departmental + undistributed + management + G&A + S&M + pre-operating).

### Pass 1, Engine baseline
- `src/core/calculations/opex/` new folder.
- Types: `OpexLine` (id, name, category, driver, ratePerDriver, indexation, startYear, endYear, capitalize? boolean), `OpexAssetResult` (per-period per-line totals + asset total).
- Drivers (configurable): `'percent_of_revenue'`, `'per_key_per_month'`, `'per_sqm_per_year'`, `'per_period_lump'`, `'percent_of_capex'`, `'fixed_amount'`.
- Categories: `'departmental'`, `'undistributed'`, `'management'`, `'general_admin'`, `'sales_marketing'`, `'pre_operating'`. Pre-operating is capitalized into Capex (asks the user up-front: capitalize Y/N per line).
- Pure engine, no store coupling.

### Pass 2, UI Tab 1 inputs
- 4 sub-tabs under Module 3 mirror Module 2 pattern: Inputs / Output / Capitalization / Schedules.
- Inputs tab: phase-wise asset cards with one row per OpEx line. Default seed pulls MAAD-style line catalog for each strategy (Hospitality gets dept + undist + mgmt; Retail gets G&A + S&M; Sell gets only Commission + Marketing during pre-sales).
- FAST blue inputs.

### Pass 3, UI Tab 2 output
- Per-asset OpEx period tables (5 categories) + project total. Mirror Module 2 Revenue Output styling.

### Pass 4, UI Tab 3 Capitalization
- Lines marked `capitalize: true` (pre-operating) feed back into Module 1 Tab 3 Costs as a synthetic auto-line "Pre-Operating (from M3)". User sees the flow.

### Pass 5, UI Tab 4 Schedules
- Accounts Payable schedule using DPO driver (default 90 days per MAAD BS Build).
- AP roll-forward: opening + accrued opex + accrued capex - cash paid = closing.

### Pass 6, M3 Phase 1 LOCK
- Verifier `verify-m3-phase1.ts`. MAAD VOCO opex + Hotel 01 opex + Retail opex targets. Existing VOCO Departmental = -179,960 SAR'000, Undistributed = -141,074 SAR'000, etc. from MAAD Actual P&L.

---

## 4. Module 4 (Financial Statements), build plan

Driven by MAAD BS Plan + BS Build + P&L + CF sheets.

### Pass 1, Cash Flow Statement engine + UI
- `src/core/calculations/financials/cashFlow.ts`. Pulls from M2 (revenue received), M3 (costs paid), M1 (capex paid + debt drawn / repaid + equity contributed / returned). Outputs: Operating CF / Investing CF / Financing CF / Net Change in Cash / Closing Cash.
- Sub-tab 1 of Module 4 = CF Statement, surface the cascade per period. Mirror MAAD CF sheet.

### Pass 2, Income Statement (P&L) engine + UI
- `src/core/calculations/financials/profitLoss.ts`. Pulls from M2 (revenue recognized), M3 (opex recognized), Module 1 (depreciation from capex + useful life + handover year), Module 1 (interest expense from debt amortization). Output per period: Revenue / CoS / Gross Margin / OpEx / EBITDA / Depreciation / EBIT / Interest / Zakat / Net Income.
- Sub-tab 2 of Module 4 = Income Statement.

### Pass 3, Balance Sheet engine + UI
- `src/core/calculations/financials/balanceSheet.ts`. Assets: Cash (from CF) / AR (from M2 Pass 7) / Inventory (WIP, from capex unspent) / Fixed Assets (from capex - cum depreciation). Liabilities: AP (from M3 Pass 5) / Unearned Revenue (from M2 Pass 7) / Debt LT (from M1). Equity: Paid-in (from M1) + Retained Earnings (from cum Net Income).
- Sub-tab 3 of Module 4 = Balance Sheet. Each line ties to a source cell with hover-to-trace.
- Tie-out chip: TOTAL ASSETS - TOTAL LIABILITIES - TOTAL EQUITY = 0 ± 1 SAR per period. Green or amber per the M1 reconciliation pattern.

### Pass 4, 3-statement integration verifier
- `verify-m4-three-statement.ts`. Asserts: CF Closing Cash = BS Cash, P&L Net Income flows to BS Retained Earnings change, AR change reconciles between BS roll and CF Operating, AP change reconciles between BS roll and CF Operating, Cum Depreciation reconciles between BS and P&L. MAAD targets: TOTAL ASSETS 2039 = ? (compute from sheet), closing cash 2039 = 7,126,135 SAR'000.

### Pass 5, M4 dashboard hook + LOCK

---

## 5. Module 5 (Returns & Valuation), build plan

Driven by MAAD Review Summary + CF Exit Value.

### Pass 1, Engine
- `src/core/calculations/returns/` new folder.
- Functions: `npv(rate, cashFlows)`, `irr(cashFlows)`, `equityMultiple(equityIn, equityOut)`, `payback(cashFlows)`, `terminalValue(noi, capRate)` and `terminalValueExitMultiple(revenue, multiple)`.
- Levered vs unlevered cash flows (use post-debt CF for levered IRR, pre-debt CF for unlevered).
- Configurable exit assumption (default = Year 15 NOI / 7% cap rate, MAAD style).

### Pass 2, UI 4-tab structure
- Inputs (discount rate, exit cap rate, exit multiple, hold period, etc.).
- Returns (IRR Levered / Unlevered, NPV Levered / Unlevered, Equity Multiple, Payback).
- Sensitivity (1-var + 2-var tornado / heatmap, recharts).
- Exit Value (NOI cap calc + exit multiple calc + sale proceeds waterfall).

### Pass 3, Dashboard hook + LOCK
- 4 KPI tiles: Project IRR, Equity Multiple, NPV, Payback.

---

## 6. Module 6 (Reports & Exports), build plan

### Pass 1, Excel exporter
- `src/hubs/modeling/platforms/refm/lib/export/excel-static.ts` (already exists for M1) extended to dump every Module 2 / 3 / 4 / 5 output table to its own sheet.
- Single workbook with 12+ sheets matching MAAD structure: Cover / Revenue / Costs / Capex / Capex Allocation / Debt / CF / P&L / Wafi Escrow / Land Summary / Returns / Review Summary.

### Pass 2, PDF report (Investor Memo)
- `@react-pdf/renderer` based. 12-page IC memo layout: Cover + Executive Summary + Project Overview + Land + Capex + Funding + Revenue Build + OpEx Build + Financial Statements + Returns + Sensitivity + Appendix.

### Pass 3, Audit Findings panel
- Reuse the reconciliation chip pattern. Show every identity check (M1 reconciler + M2 reconcile + M4 tie-out) in a single audit log surface. Colored by severity. Click to jump to source cell.

### Pass 4, LOCK

---

## 7. Cross-cutting decisions to capture (open)

These are open questions to lock with the user before the relevant pass starts:

1. **Tax / Zakat treatment.** MAAD uses simplified 2.5% Zakat × PBZ (pre-Zakat profit). Locked default, but offer toggle for full corporate-tax computation (jurisdictional).
2. **Currency display.** MAAD is SAR '000. The platform stores in full units, formats with thousands separator. No global '000 toggle planned; users can re-scale in the project currency setting.
3. **DSO / DPO defaults.** MAAD = 60 days DSO / 90 days DPO. Configurable per asset (Hospitality 30 days, Retail 60, Residential pre-sales bypass since AR is driven by milestone profile not DSO).
4. **Exit assumption default.** MAAD = NOI × multiple at Year 15. Default exit method = NOI / cap-rate (7% cap), with NOI multiple as secondary option in M5 Inputs.
5. **Depreciation policy.** MAAD treats VOCO existing fixed asset depreciation per IFRS schedule. Configurable per asset (straight-line vs declining balance, useful life from M1 Tab 2 already captured).
6. **Pre-operating capitalization toggle.** M3 Pass 4 needs the user to confirm: pre-operating costs go to Capex (capitalized) or P&L (expensed)? Default = capitalize per MAAD.

---

## 8. Verifier strategy (per-phase, every module)

Every phase ships a `scripts/verify-[phaseId].ts` covering the 5 sections per `[[feedback_phase_verification_workflow]]`:
1. **Database / persistence**: Supabase JSONB roundtrip via service-role.
2. **Route smoke**: 401-without-auth gates; skips when `localhost:3000` is down.
3. **Calculation correctness**: snapshot diffs + targeted assertions on MAAD fixture.
4. **State integrity**: load fixture into store, mutate via store actions, assert cascade.
5. **UI rendering**: Playwright headless light + dark screenshots saved to `tests/screenshots/[phase]/`.

MAAD totals to assert each module against (full-project numbers, SAR '000):
- Total Revenue (P&L) = 15,255,233
- Residential Pre-Sales = 6,318,676 (CF!E7:E11)
- Hospitality VOCO + Tower 01 + Hotel 01 = 7,782,978 (CF!E13:E15)
- Retail Support Phase 2 + Phase 3 = 336,010 (CF!E17:E18)
- Total Capex Incl. Land = 4,912,146 (Review Summary B23)
- Closing Cash 2039 = 7,126,136 (CF!T70)
- Min Closing Cash all years ≥ 50,000 (constraint, MAAD audit)

---

## 9. Sequencing snapshot (chronological)

| Order | Pass | Module | Theme | Verifier |
|---|---|---|---|---|
| 1 (next) | M2 Pass 8 | M2 | Hospitality revenue engine + UI | `verify-m2-pass8.ts` |
| 2 | M2 Pass 9 | M2 | Retail / Office Lease engine + UI | `verify-m2-pass9.ts` |
| 3 | M2 Pass 10 | M2 | Sell + Manage companion revenue | `verify-m2-pass10.ts` |
| 4 | M2 Pass 11 | M2 | Dashboard KPIs + sparklines | (UI-only, smoke test) |
| 5 | M2 Pass 12 | M2 | Phase 1 LOCK | `verify-m2-phase1.ts` |
| 6 | M3 Pass 1 | M3 | OpEx engine baseline | `verify-m3-pass1.ts` |
| 7 | M3 Pass 2 | M3 | Inputs tab UI | (UI-only) |
| 8 | M3 Pass 3 | M3 | Output tab UI | (UI-only) |
| 9 | M3 Pass 4 | M3 | Capitalization tab + M1 feedback | `verify-m3-pass4.ts` |
| 10 | M3 Pass 5 | M3 | Schedules (AP) tab | `verify-m3-pass5.ts` |
| 11 | M3 Pass 6 | M3 | LOCK | `verify-m3-phase1.ts` |
| 12 | M4 Pass 1 | M4 | CF Statement engine + UI | `verify-m4-pass1.ts` |
| 13 | M4 Pass 2 | M4 | P&L engine + UI | `verify-m4-pass2.ts` |
| 14 | M4 Pass 3 | M4 | BS engine + UI | `verify-m4-pass3.ts` |
| 15 | M4 Pass 4 | M4 | 3-statement integration tie-out | `verify-m4-three-statement.ts` |
| 16 | M4 Pass 5 | M4 | LOCK + Dashboard tiles | `verify-m4-phase1.ts` |
| 17 | M5 Pass 1 | M5 | Returns engine | `verify-m5-pass1.ts` |
| 18 | M5 Pass 2 | M5 | 4-tab UI (Inputs / Returns / Sensitivity / Exit) | `verify-m5-pass2.ts` |
| 19 | M5 Pass 3 | M5 | LOCK + Dashboard tiles | `verify-m5-phase1.ts` |
| 20 | M6 Pass 1 | M6 | Excel exporter (12 sheets, MAAD parity) | (manual diff against MAAD) |
| 21 | M6 Pass 2 | M6 | PDF IC memo | (visual review) |
| 22 | M6 Pass 3 | M6 | Audit findings panel | (smoke test) |
| 23 | M6 Pass 4 | M6 | LOCK | platform LOCK |

---

## 10. After M6, what comes next (out-of-scope for this plan)

- **M7 Scenarios & Sensitivity** (project-level scenario manager, base / upside / downside)
- **M8 Portfolio** (multi-project rollup, weighted average IRR, capital allocation)
- **M9 Market Data** (comparables, exit cap rate benchmarks, ADR / RevPAR benchmarks)
- **M10 Collaborate** (multi-user comments + shared scenarios, Professional plan)
- **M11 API Access** (REST API for projects, Enterprise plan)

These ship after M6 LOCK and are scoped in their own plan files.

---

## 11. Working agreements (re-state, do not drift)

- Engine stays pure (no store reads inside `src/core/calculations`). All store coupling lives in `src/hubs/modeling/platforms/refm/lib/` resolvers.
- Project-axis indexing throughout. Per-asset windowing is a UI concern only.
- No em-dashes anywhere (CLAUDE.md global rule).
- FAST blue for editable, grey-pale for calc-output, navy for table headers (CLAUDE-REFM.md design system).
- MAAD is a reference, never a hard-coded behaviour. Every MAAD assumption gets a knob (`[[feedback_maad_is_reference_only]]`).
- After every task: commit + push (no per-push confirmation needed, per `[[feedback_commit_push_workflow]]`).
- Per-phase verifier per `[[feedback_phase_verification_workflow]]`.
- MD updates stay token-efficient (`[[feedback_md_token_efficiency]]`): pass-level narrative consolidates into CLAUDE-FEATURES.md at module LOCK; this PLATFORM-PLAN.md is the forward map and stays the same length.
