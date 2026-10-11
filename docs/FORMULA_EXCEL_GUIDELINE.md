# Formula-Linked Excel Export: Working Guideline

**Started 2026-10-11 (founder: finalise the formula-linked REFM Excel export, step by step, simple formulas, commit and push after each step).**
This is the working document for the build. Update the status table at the end of every step.

## 1. What it is

- The **hardcoded export** (`lib/excel/buildModelWorkbook.ts`) is built first, unchanged, with the cell registry recording where each figure lands.
- **Live layers** (`lib/excel/liveLayers/stage*.ts`, run in order by `formulaWorkbook.ts`) then write Excel formulas over the cells they own. Each formula caches the platform value, so the file opens showing the platform's numbers and recalculates when an input changes.
- Hidden working sheets (`Revenue Calc`, `Capex Calc`, `Cost of Sales Calc`, `Opex Calc`, `Schedules Calc`, `Statements Calc`, `Financing Calc`, `Returns Calc`) carry the arithmetic; the visible sheets present it.
- The financing is a **circular solve** Excel iterates (1,000 passes, 0.000001), mirroring the engine's fixed point.
- A configuration a layer cannot express **REFUSES by name**: that sheet stays platform values and says why. Nothing is ever hardcoded quietly.
- Access: server-side preview gate, founder's account only (`formulaExportAccess.ts`). Opening it to plans is the founder's call (feature key `excel_formula` exists).

## 2. Rules for every step

1. **Mirror the engine, never a second model.** Every formula reproduces a platform rule; the old `liveModel.ts` twin stays dead.
2. **Simple formulas** (founder, 2026-10-11): `+ - * /`, `SUM`, `IF`, `MIN`, `MAX`, `ROUND`, `IRR`, `INDEX`. Prefer a visible helper row over a long nested formula. A sum of a contiguous block is `SUM(range)`, never a chain of `+`. No `OFFSET`, `INDIRECT`, array formulas or LAMBDA.
3. **Inputs are shaded, and every shaded cell is read by a formula** (A11). Export-time structure is unshaded with the "Fixed at export" note.
4. **Refuse rather than guess.** A refusal names the configuration in the user's words.
5. **Proof is real Excel**: `npx tsx --env-file=.env.local scripts/verify-formula-workbook.ts` (A offline, B every figure in Excel, C input changes). Every step ends green on it, plus `verify-excel-export` (the hardcoded export must not move).
6. Per CLAUDE.md: also run `verify-report-readability` for export changes; commit and push each step; no em dashes; never the reference client's name.

## 3. Status at the start (measured 2026-10-11, commit 11be18b6)

**Marina Gate (the reference live project):** 30,347 formulas, nothing pending; `verify-formula-workbook` green in real Excel.

| Sheet | Status | What is still values |
|---|---|---|
| Timeline, Land & Area, Capex, Financing, Opex, P&L, Cash Flow, Balance Sheet | LIVE | nothing |
| Inputs | partial | facility share has no single cell (two copies disagree) |
| Summary | partial | key-fact labels, Phase 1 / Phase 2 EBITDA |
| Revenue | partial | the rows at the foot of the Revenue Output; the CoS basis sentence |
| Schedules | partial | nothing material (status sentence only) |
| Returns | partial | Case Comparison (by design); figures quoted in notes |
| Checks | partial | Detail sentences and NOTE advisories (as of export, by design) |
| Scenarios | values by design | the other cases |

**Every other open project (5 of 6) falls back to values on Financing, Opex, P&L, Cash Flow, Balance Sheet, Returns and Checks.** Only two refusals cause it, on all five:
1. **Terminal value by exit multiple** (the platform default) is refused; the live solve supports the exit cap rate only.
2. **HQ opex on the default seed** is refused ("the sheet does not show" the seed).

**Formula complexity (Marina Gate):** 12,522 formulas over 50 characters, 2,835 over 200, 149 over 800, longest 1,765. Main offenders:
- chained `+` sums of a block of rows (Cash Flow capex by line, Cost of Sales totals, Balance Sheet check, Financing Calc sums);
- per-sqm Capex Table 7 cells repeating a whole sum inside an `IF` and again in the division;
- the sensitivity grid and exit-year candidates: `IRR` over an inline stream inside four nested `IFERROR` guesses;
- noise terms (`+0`, `-(0)`, `MAX(0,N(x))` wrappers on cells that are always numbers).

**Refused by name, not on any current project** (lift only where a project needs it or it is cheap): cost escalation on, a CIT tax basis with loss carry-forward, tax paid after year end, a line's own receivable days, an exit before the last year, Exit Year as a live input, reducing balance depreciation, deferred plot payment, Method 4, balloon / custom repayment, fund fees on NAV, monthly models, phase overlap, existing operations.

## 4. Plan (one commit and push per step)

| # | Step | Done when |
|---|---|---|
| 0 | This guideline | committed |
| 1 | Exit multiple (and perpetuity if cheap) terminal value live in the solve and Returns | a project on exit multiple has Financing and Returns live; Marina Gate unchanged |
| 2 | HQ opex default seed shown on the sheet and live | Opex live on the default-seed projects |
| 3 | Re-census every open project; lift the next blockers found | every open project live on the statements, or a named reason |
| 4 | Formula simplification pass 1: a writer-level rewrite (contiguous `+` chains to `SUM(range)`, noise terms dropped) | max length and >200 count down sharply; Excel proof green |
| 5 | Formula simplification pass 2: helper rows for the sensitivity grid / exit-year IRRs and Capex Table 7 per-sqm | no nested `IFERROR(IRR` chains; no formula over ~400 chars where a helper row fits |
| 6 | Close the partial pieces worth closing (Summary phase EBITDA, Revenue foot rows, Inputs facility share) | each sheet's status sentence names only by-design values |
| 7 | Lift the 2026-10-06 refusals (CIT loss carry-forward, tax payment lag, per-line receivable days) and cost escalation | refusals removed, each proved on a test copy |
| 8 | Docs, CHANGELOG, session-end suite | counts stated |

## 5. Findings along the way (for the founder)

- **The five other open projects have no assets** (XYZ, ORA EAST - VILLAS, ABC, Jadan Maroom, the Musoma hall): shells. Marina Gate stays the real test bed; other shapes are proved on COPIES of it (the verifier's variants).
- **Summary phase EBITDA disagrees with the phase P&L** since 2026-10-08: the overview sums per-asset EBITDA, which leaves out the expensed selling and marketing; the phase P&L deducts it. The live Summary keeps the platform's value for that cell and says so. One rule should win (founder's call).
- **Excel runs one proof at a time**: a COM start failure (0x80080005) reads as a crash, not a check failure; re-run.
- **Inside the circular financing solve, keep `+` chains** (measured 2026-10-11): rewriting one row of `Financing Calc` from `a+b+c` to `SUM(a,b,c)` left the whole loop at #VALUE! in real Excel, ranges or single cells alike. The simplifier skips sum chains on that sheet (`CIRCULAR_SHEETS` in `liveLayers/simplify.ts`); every other rewrite there is proved exact.
- **PLATFORM DEFECT FIXED (2026-10-11): escalation ignored an asset's spend curve.** A line following its asset's curve was escalated on its own stored (even) shape, because the curve is resolved after the totals; its total stopped equalling the sum of its own periods (Marina Gate at 4%: 232,350,373.52 against 234,100,591.55). `computeAssetCost` now resolves the shape for the escalation weights too. Moves money only where escalation is on (no live project); `verify-cost-escalation` B7 fails on the old engine.
- **A velocity row's Total stays a value**: after a phase change the platform reprints the row with fewer years, so its Total depends on the export's layout, not on the model.

## 6. How to prove a step

- Full proof: `npx tsx --env-file=.env.local scripts/verify-formula-workbook.ts` (about 75 minutes in real Excel).
- Another project: `--project <id>` (B in full; C's rules may find no target there).
- Iterating: `--only <label text>` or `--no-c` (both report themselves as a failure, never a proof).

## 7. Status log

| Step | Commit | Result |
|---|---|---|
| 0 | c060dc1c | guideline written; baseline `verify-formula-workbook` 167 / 0 in real Excel |
| 1 + 2 | 8d358c0b | exit multiple live (`liveLayers/terminal.ts`, one formula twin read by the solve and the exit-year analysis); HQ default lines shown on Inputs and live (`hqOpexLinesInForce`); the indirect cash flow's cost of sales add-back no longer needs a P&L row that prints only when non-zero. Every open project now builds with no sheet on values (was 7 sheets on values on 5 of 6). Proof: `verify-formula-workbook` 170 / 1 (the one: the Inputs copy of the exit multiple was not linked, fixed in this commit, re-proved in the steps 4 to 7 run); `verify-excel-export` 363 / 0; `verify-report-readability` green |
| 3 | (census) | every open project re-built: no sheet on values on any of the six (the five shells included) |
| 4 + 5 | 18dafff8 | `liveLayers/simplify.ts`, one pass over the finished workbook: `+` chains to SUM over ranges, `MAX(0,a)+MAX(0,b)+...` along a row to `SUMIF(range,">0")`, `SUM(a)+SUM(b)` stacked into one block, dead `+0` terms and brackets dropped. The sensitivity grid's FCFE streams are rows on Returns Calc, so each grid cell is an IRR over a short range. Marina Gate: over 800 chars 114 to 33, over 400 351 to 145, over 200 2,839 to 2,552 |
| 6 | 5cdfa5a8 | the Schedules roll-forward tables' Total / Closing column live (the capitalised interest pool, equity, retained earnings) |
| 7 | (this commit) | construction cost escalation live (a factor row per phase, each line's base-year amount times its spend-weighted factor, every year's spend at (1 + rate)^year), the escalation rate typed on Inputs; CIT loss carry-forward live in the P&L and both solves (`liveLayers/taxRule.ts`); tax paid after the year end live (the payable on the balance sheet, the change in the indirect cash flow, the bridge, tax paid in both solves) where a lag was stated at export; the engine's escalation shape fixed (above). Each proved on a copy in real Excel. Proof for steps 4 to 7: `verify-formula-workbook` 183 / 0, `verify-excel-export` 363 / 0, `verify-report-readability` 81 / 0, `verify-cost-escalation` 22 / 0 |

## 8. Still open (in order)

1. **A hotel or lease line with its own receivable days** (refused by name). Best done with an operating receivables block on Revenue Calc (one row per line at its own days, one total), which also shortens the longest remaining formulas (Revenue R555, Cash Flow R20, Balance Sheet AR all repeat `MAX(0,rev)*DSO/365` per line).
2. **Longest formulas left** are logic, not sums: the per-asset IDC split in the circular solve, the Summary's text sentences, the Returns fee-income text. Only helper rows would shorten them further.
3. **Refused, no project needs them yet**: an exit before the last year and Exit Year as a live input, reducing balance depreciation, deferred plot payment, Method 4, balloon / custom repayment, fund fees on NAV, monthly models, phase overlap, existing operations, perpetuity terminal value.
4. **Release**: the export is still behind the founder-only preview gate (`formulaExportAccess.ts`); opening it to plans is the founder's call (feature key `excel_formula`).
5. **Founder's call**: Summary phase EBITDA vs phase P&L (section 5).
