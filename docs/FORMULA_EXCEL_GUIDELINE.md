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

## 5. Status log

| Step | Commit | Result |
|---|---|---|
| 0 | (this commit) | guideline written; baseline `verify-formula-workbook` green |
