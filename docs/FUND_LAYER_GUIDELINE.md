# FMP Fund Layer: Guideline & Build Plan

Reference doc for the fund layer in the REFM platform. This is the scope, the design decisions, and the standing rules. Prompts are given to Claude Code one step at a time, verified between each. This file is the source of truth for what we are building and why.

**Status as of 2026-08-11: Steps 1 through 7 are LIVE. The fund layer is feature complete for v1, and the toggle is now ON on the real project.** See section 8 for the 2026-08-11 presentation corrections and the state change.

**Status as of 2026-08-10: Steps 1 through 7 are LIVE. The fund layer is feature complete for v1.** Migrations 208, 209, 210 and 211 applied; Steps 4, 6 and 7 needed none. Post-Step-7 corrections the same day: the annual fee bases moved from opening NAV to TOTAL EQUITY and the arranging fee to the DEBT FACILITY, three distinct bases (section 2), the live model now loads fund terms on project open rather than on tab mount (section 7), and the stale "does not yet flow into the model" notice is gone. The browser gap in section 7 is the only thing still open. Sections 2, 3 and 4 below have been updated to match what was actually built; where the original plan changed, the change and the reason are stated rather than quietly overwritten.

---

## 1. What the fund layer is

A project today models a single development. The fund layer adds the economics of a fund or GP-LP structure on top:

- **fund management fees** charged by the Fund Manager
- a **preferred return (hurdle)** to investors
- a **performance fee (carry)** to the fund manager once the hurdle is met
- returns reported both **gross** (before fund fees) and **net** (after)

It is **additive and toggle-gated**. Every project carries a standalone-vs-fund toggle, default OFF. With the toggle off the model behaves exactly as it does today, byte-identical returns. Turning it on layers the fund economics in.

It is **independent** of the platform's other systems. It touches the model engine (M4 and M5) in a controlled, additive way, guarded by a regression verifier written before any feature code.

---

## 2. The key design decision: every fee base is linear

**The principle, unchanged since day one.** A fee is a cash outflow, so paying it RAISES the funding requirement: in a cash-deficit or funding-gap scenario the model must raise more funding to keep cash non-negative while paying the fee. That is correct and required. But if a fee were charged on anything the funding solve moves within the same period, then more funding would raise the base, which would raise the fee, which would raise the funding requirement again. That is a circular loop and it would mean touching the M4 circular solve.

So: **the fee raises funding, but the higher funding does not raise the fee.** Linear, testable, and it never enters the circular block.

### What changed from the original plan, and why

The original plan named ONE management fee on a choice of two bases (committed capital or total development cost). Step 2 replaced that with the fee set a real fund actually carries, because one rate cannot express fees with different timings and different bases. The **principle** survived intact; the **specifics** are now:

| Fee | Timing | Base |
|---|---|---|
| Fund structure fee | one time | fund size |
| Fund management fee | annual | **total equity** |
| Custody and admin fee | annual | **total equity** |
| Debt arranging fee | one time | **debt facility** (total debt raised, NOT the facility limit) |
| Other expenses | annual | flat amount |

**Fund size as a base needs care, and the original doc was imprecise about it.** The old wording said the fee is "not charged on fund size" because fund size is equity plus debt and debt is solved. That is still true of a **derived** fund size. But the fund structure fee IS charged on fund size **as a number the user types**: a target or committed figure that does not move when funding moves. The distinction is one careless line wide, so `fund_size_solved` is named explicitly in the forbidden list.

**The annual fees moved from opening NAV to FUND SIZE on 2026-08-10.** They charged on opening NAV (the close of the prior period) from Step 2, and the engine was correct: the rate was applied to each period's own opening balance, and the fee was exactly `Sigma rate x NAV_t`, verified on the real project. Two things made the base wrong anyway.

*It did not match the model.* This platform mirrors a model that sizes a fund by its TOTAL debt and equity funding over the whole period, not by a net-asset balance that moves every year. A NAV-based fee cannot be reconciled against the fund size at all, and the two figures sat side by side on the same tab.

*And it read as an error.* The fee basis is displayed as the SUM of the per-period bases, because that is the figure `basis x rate == fee` needs for an annual fee. Summing a BALANCE over fourteen years gave 41,752.1m against a fund size of 5,466.8m, about seven times larger, which looks exactly like a calculation fault. The engine was right and the presentation was indefensible. (Max single-period NAV was 3,953.2m, 0.72x the fund size, so NAV never exceeded capital raised.)

They were moved to **fund size** first, which fixed the reconciliation but over-collapsed the design: all three capital fees ended up sharing one base and the equity-only and debt-only fees lost their distinct ones. **Corrected the same day to THREE DISTINCT BASES**, matching the reference:

| Base | What it is | On the reference project |
|---|---|---|
| **Total equity** | all equity injected over the life: cash, in kind, and equity already in the project | 2,632.733m |
| **Debt facility** | total debt RAISED over the life, including capitalised interest | 2,834.066m |
| **Fund size** | total equity plus the debt facility | 5,466.799m |

so a reader can add the first two and land on the third. All three are lifetime totals resolved ONCE in the fee-free pass and then frozen, so the freeze is unchanged.

**The arranging fee charges the DEBT FACILITY, not the facility limit,** and the two are not interchangeable: on the reference project the limit resolves from an LTV cap to 4,273.822m against 2,834.066m actually raised, a 1,439.756m gap, so charging the limit meant charging a ceiling the fund never drew. `resolveFacilityLimit` still runs and the tab still displays it, but no fee charges on it. Two checks now pin that a `facilityLimitOverride` and a stated principal do NOT move the fee, so the two cannot be silently re-coupled.

**`totalEquity` and `debtFacility` are resolved INDEPENDENTLY of `fundSize`**, not read off its `equityTotal` / `debtTotal`, because a `fundSizeOverride` replaces the fund size with a typed target and zeroes those components. The equity and debt bases must keep reporting what the model actually raised even then. `buildFundCapitalRows` suppresses the reconciliation display in exactly that case, because the total is then not the sum of the parts and printing it as though it were would be a lie.

Consequences worth knowing: the annual fees are now charged in period 0 as well, where opening NAV was zero; and the basis row carries the per-period constant and a period count, so it reads as "0.50% of Total equity 2,632.7m, 14 periods" rather than one implausible number.

`opening_nav` and `facility_limit` both remain LEGAL base kinds. Both are linear and correctly implemented, and no fee uses either. `closing_nav` and `average_nav` stay forbidden.

### The rule is a data structure, not a comment

`FUND_FEE_SPECS` in `src/hubs/modeling/platforms/refm/lib/fundTerms.ts` declares each fee's `timing` and `base`. `LINEAR_FEE_BASES` is the allowed set; `CIRCULAR_FEE_BASES` names what must never appear (`closing_nav`, `average_nav`, `drawn_debt`, `total_sources`, `funding_requirement`, `fund_size_solved`). `scripts/verify-fund-terms.ts` fails on the REGISTRY, so a bad fee added to the DATA is caught as well as one added to the UI. Proven with teeth: injecting `base: 'closing_nav'` fails four checks.

### And one more layer: the schedule is FROZEN before the solver

Declaring linear bases is not sufficient on its own. `computeFinancialsSnapshot` is an iterative fixed point, and a fee computed INSIDE that loop would drift every iteration. So when the toggle is on, the engine runs a **fee-free pass** first, builds the fee schedule from it, and then threads that schedule UNCHANGED into every iteration. It is never part of the derived circular inputs, so no iteration can revise it. See Step 3 below.

---

## 3. Where it affects the model

| Module / area | What changes | Status |
|---|---|---|
| **M1 Project Setup** | New Fund Terms tab (tab 3, after Parties): the toggle, the **Fund Manager**, the five fund fees, performance fee + hurdle, the fee bases, and a per-PARTY fee distribution matrix | **LIVE** |
| **Schema** | `refm_fund_terms`, one row per project. Migration 208 (toggle + original terms), 209 (the real fee set + `fee_distribution` jsonb), 210 (`fund_manager_name` + `facility_limit_override`), 211 (`fund_size_override`, the fund size becoming model-derived) | **LIVE**, all four applied |
| **M4 Financial Statements + Funding** | Fund fees total into a **Total Fund Management Fee** line and **EBITDA is struck AFTER it** (2026-08-05, reference alignment), plus a visible **Fund Management and Other Expenses** row inside operating cash flow, which is how the fee reaches the funding requirement. A **Fund Fee Basis** table (shared builder, also on M5 and in Excel) states what each fee is charged on and the rate applied, so a zero fee is diagnosable rather than ambiguous | **LIVE** |
| **M5 Returns** | Distribution waterfall over the Distributed-Equity stream on the REFERENCE structure (one combined hurdle balance settled by a single `hurdlePaid` line, then a flat performance fee on the excess), hurdle accrual and unpaid balance, distributions net of fee, post-fee IRR and MOIC. Gross streams untouched | **LIVE** (engine + snapshot; presentation is Step 5) |
| **M5 Parties** | Fee income as a return line for the Fund Manager, via the `FeeEarner` contract, plus the net-vs-gross and waterfall UI on the Returns tab | **LIVE** |
| **Excel export** | Fee lines with their basis and Total Fund Management Fee on the P&L, the fee row in operating cash flow, a `3. Fund Layer` section on Returns, and a fund block on the Summary tab, all in the locked palette | **LIVE** |
| **PDF exports** | Full project report: fee lines and Total Fund Management Fee on the Module 4 P&L, the cash flow fee row, the Fund Fee Basis block, and a `Tab 5: Fund Layer` in Module 5. Summary PDF: the fee line and cash flow row (so the summary statements FOOT) plus its own Fund Layer page | **LIVE** |
| **M7 IC Report** | Fee sections in the IC deck | Post-launch, not gating |
| **Verifiers** | Toggle-off regression first, then the fee registry, the fee schedule, the waterfall, the fee earners, the Excel rows, both PDFs, and an end-to-end pass on the REAL project | **LIVE** (`verify-fund-layer-guard` 75, `verify-fund-terms` 182, `verify-fund-fees` 136, `verify-fund-waterfall` 382, `verify-fund-fee-income` 108, `verify-fund-excel` 69, `verify-fund-pdf` 49, `verify-fund-e2e` 86; `verify-excel-export` stays 304. **1,491 checks total**) |

### The Fund Manager

Added 2026-08-04. It is **not a project party**: it exists only while the fund layer is on, so a `refm_parties` row would give every standalone project a counterparty its model has no concept of. It lives in `fundTerms.fundManagerName`, earns **100% of all five fund management fees, unsplit** (no share to store, the entitlement is total by definition), and takes its performance-fee share through a row in the distribution matrix carrying the reserved id `__fund_manager__` (a non-uuid, so it cannot collide with a real party id).

**`resolveFeeEarners(terms) -> FeeEarner[]` is the contract Step 5 consumes**, and it is deliberately NOT `PartnerInput`. An M5 partner is defined by the equity it contributed and earns `shareholdingPct x the consolidated stream`, which is what makes Sigma partners == consolidated hold by construction. A no-equity Fund Manager dropped into that shape would take a 0% shareholding, a zero invested base and an undefined IRR, and would break that reconciliation. A fee earner sits ALONGSIDE the equity partners, not inside them.

### The facility limit is read from the model

Added 2026-08-04. The diagnosis is worth keeping: **there is no facility limit the engine enforces.** `FinancingTranche.principal` is an input but nothing reads it; `ltvPct` is an input but deprecated for per-facility scaling; and `FacilityResult.outstanding` / `drawSchedule` are SOLVED OUTPUTS straight from the funding gap. So `resolveFacilityLimit` walks inputs only: stated principal (summed), else the LTV cap (`ltvPct x capex`, and capex carries no IDC so it does not move with the funding solve), else the typed figure, with `facilityLimitOverride` to pin the typed one. The drawn balance is never read.

---

## 4. Build sequence

One step at a time. Diagnose first, build, verify, hold for review, then the next.

| Step | Title | Status | Migration |
|---|---|---|---|
| 1 | **Toggle-off regression guard** | **DONE 2026-08-03** | None needed |
| 2 | M1 Fund Terms tab + schema | **DONE 2026-08-03, EXTENDED 2026-08-04** | 208, 209, 210 |
| 3 | M4 fund fee line + funding impact | **DONE 2026-08-04** | None needed |
| 4 | **M5 waterfall + hurdle + performance fee** | **DONE 2026-08-05** (rebuilt same day to the reference structure) | None needed |
| 5 | **M5 net vs gross returns + Fund Manager fee income** | **DONE 2026-08-05** | None needed |
| 5b | **Fee basis display + model-derived fund size** | **DONE 2026-08-05** (pushed 2026-08-09) | 211 |
| 6 | **Excel export rows** | **DONE 2026-08-10** | No |
| 6b | **PDF exports + shared presentation builder** | **DONE 2026-08-10** | No |
| 7 | **End-to-end verify** | **DONE 2026-08-10** | No |

### What each completed step actually delivered

**Step 1** wrote the guard BEFORE any feature code. The design point worth remembering: the existing returns suite is property-based (identities, ranges, 1e-2 tolerance), so a uniform drift passes all 99 of its checks, while pinned golden numbers rot on the first legitimate model change. So the guard compares **the same engine run without the toggle**, in-process, on identical inputs: exact `Object.is` deep equality over the full financials and returns snapshots. It has teeth, proven against a deliberate 1e-9 drift.

**Step 2** shipped the tab and the storage, then was extended the next day to the real fee set and the per-party matrix, then again for the Fund Manager and the model-read facility limit. Each extension kept the previous columns (additive only; `carry_pct` and `hurdle_rate_pct` never changed meaning, so no data moved).

**Step 3** put the fees in M4. The fees reach the funding requirement through `cashFromOps`, which is what `computeFundingGap` reads, so no new plumbing was needed: the period-0 funding requirement rises by exactly the period-0 fee. The schedule freeze (section 2) is what keeps it out of the circular solve.

**Step 3 was REPOSITIONED on 2026-08-05 to match the reference statement layout.** Two fixes, both in the shared builders (`m4Reports.ts`), so the screen, the PDF and the Excel export all moved together from one edit:

1. **EBITDA is now struck AFTER the fund fees.** Step 3 placed them below EBITDA and above the tax line, which left the statement carrying TWO EBITDA rows ("EBITDA" and "EBITDA after fund fees"), and two EBITDA rows in one statement is exactly the kind of thing a reader quotes the wrong one of. The reference totals the fees into **`Total Fund Management Fee`** and strikes ONE EBITDA after it. The engine gained `ebitdaBeforeFundFeesPerPeriod` (the pre-fee measure), `ebitdaPerPeriod` is now net of fees, and `ebitdaAfterFundFeesPerPeriod` is retained as a documented alias so a Step 3 caller still finds the right number. **The PHASE-level P&L keeps the pre-fee measure**, because fund fees are project level and carry no phase allocation. **Known and deliberate consequence:** ICR and DSCR read `ebitdaPerPeriod`, so on a fund project they are now measured on after-fee EBITDA.
2. **The cash flow now SHOWS the fee.** `directCF.fundFeesPaidPerPeriod` was always inside `cashFromOps` (that is how it reaches the funding requirement) but had no row, so the operating section could not be footed: the total was right and unexplained. A **`Fund Management and Other Expenses`** row now sits above `Cash Flow from Operations`, carrying exactly the P&L fee line negated. The Indirect statement needs no add-back (the fee is cash in the period charged, already inside PAT), so Direct == Indirect still holds untouched.

**The resulting chain, measured on a live fixture rather than asserted** (lifetime, millions): fee 38.73 hits the P&L; EBITDA before 265.64 becomes 226.91 after, down by exactly the fee; the same 38.73 appears in operating cash flow; cash from operations falls 234.56 -> 200.05, which is the fee less the 4.21 of tax it shields; and the dividend distributable falls 73.80 -> 39.28, the same 34.5 cash effect. **The sweep leg is NOT exercised by that fixture** (no tranche has sweep configured, both sides are zero); it reads the same `preSweepClosingCash`, which the verifier separately asserts moves. The performance fee is untouched at 62.47, still computed after the DDM block, taking the Distributed-Equity IRR from 27.63% gross to 25.23% net and MOIC 7.49 to 6.40.

**One qualification on the chain that is worth keeping.** The dividend also carries a per-phase cumulative EBITDA cap that reads `phaseEbitdaPerPeriod`, and fund fees are project level with no phase allocation, so **the cap does not move**. In `cash_above_min` mode cash is the binding constraint and the chain behaves as above; wherever the EBITDA cap binds first, the fee will not reduce the dividend.

**Step 4** put the waterfall in M5. `src/core/calculations/returns/waterfall.ts` is pure and primitives-only (so the `@core` boundary holds and the resolver does the FundTerms mapping); `computeReturnsSnapshot` calls it and adds `waterfall`, `netDividendStreamPerPeriod` and `resultNetDividends` to the snapshot. No migration: `carry_pct` and `hurdle_rate_pct` have existed since migration 208 and already ride in the version snapshot.

**It was REBUILT the same day** to match the reference model. The first cut was a conventional three-tier private-equity waterfall (return of capital, then a preferred return, then a residual split). The reference is simpler and the difference is structural, so the old shape was removed rather than wrapped. **The reference mechanic, per period:**

```
hurdleAccrued    = (unpaidHurdleBoP + equityDrawn) x hurdleRate
totalHurdleOwed  = equityDrawn + unpaidHurdleBoP + hurdleAccrued
hurdlePaid       = MIN(distributions, totalHurdleOwed)
unpaidHurdleEoP  = totalHurdleOwed - hurdlePaid
excess           = distributions - hurdlePaid
performanceFee   = excess x performanceFeePct
netDistributions = distributions - performanceFee
```

Five points are worth carrying forward:

1. **There is NO return-of-capital tier, no catch-up, and no residual split.** Equity drawn folds straight into the hurdle owed and is settled by the single `hurdlePaid` line, so `unpaidHurdle` is ONE balance carrying unreturned capital AND accrued preferred together. That naming is the reference's and is the most misreadable thing in the file. The performance fee is a FLAT percentage of everything above the hurdle, not a share of a split. The verifier pins the fold-in directly (at a zero hurdle rate the balance IS the unreturned capital) and asserts the removed tier fields left no vestige on the shape.
2. **It runs over the Distributed-Equity stream**, not FCFE. That stream IS distributions: its negatives are equity drawn, its positives are cash returned. It is driven off the GROSS COMPONENTS (`existingEquity`, `equityCashAxis`, `inKindAxis`, `divPaidAxis`, `tvEquity`) rather than the netted stream, because a period can carry an equity draw and a dividend at once and netting first would hide the distribution behind the draw.
3. **The hurdle is NOT in the solve, structurally rather than carefully.** The guideline flagged it as carrying Step 3's exposure. It does not: the performance fee is a SPLIT of cash that has already left the project, so it moves no project cash, never reaches `computeFundingGap`, and M5 runs after M4 has converged. The schedule is frozen by construction, with no second fee-free pass needed. `verify-fund-waterfall` section 5 proves it by running the same project at three hurdle and fee settings and requiring the FULL financials snapshot and every gross stream to be identical across all three.
4. **The accrual compounds AND charges the same-period draw.** Substituting, the whole mechanic collapses to `owed = (BoP + drawn) x (1 + r)`, so the balance compounds at exactly `(1+r)` per period and a single draw C held n periods owes `C x (1+r)^(n+1)`. **A consequence worth knowing rather than rediscovering:** because of that extra power, an investor paid exactly the hurdle balance earns MORE than the hurdle rate as an IRR (16.64% on an 8% hurdle over one period, 8.83% over ten, converging down as the horizon lengthens). The hurdle here is a stated accrual convention, not an IRR the payment reproduces. The verifier pins the compounding identity and the closed form, and deliberately does NOT assert an IRR equality that the model does not have (the pre-rebuild version did assert it, correctly for its own opening-balance-only accrual).
5. **Proven with teeth.** Three sabotages against the rebuilt engine: dropping the same-period draw from the accrual base fails 62 checks, charging the fee on the gross distribution instead of the excess fails 35, and not folding equity drawn into the owed balance fails 79.

**Step 4 shipped NO UI.** Presentation of net vs gross was Step 5, so the waterfall lived in the snapshot and the verifier only. Deliberate scope boundary, not an oversight.

**Step 5** made the fund layer visible for the first time, and wired the fee income. Two parts, and the second one is the load-bearing design decision:

1. **The M5 surface** (`Module5Returns.tsx`). Two new sections, each gated on the snapshot's `active` flag so a standalone project renders nothing at all: **Fund Distribution Waterfall** (gross vs net IRR and MOIC tiles, a gross-vs-net comparison table, and the waterfall in the reference's exact row order) and **Fund Fee Income** (per-earner management and performance fee, with the five fee lines broken out). Two presentation rules worth keeping: **balance rows carry no lifetime total** (a balance summed across periods is meaningless), and gross distributions appear only as a **memo below** the reference sequence so the nine rows match exactly.
2. **Fee earners sit BESIDE the equity partners, never inside them.** `src/core/calculations/returns/feeEarners.ts` is a separate pure engine with its own snapshot; `PartnersSection` and `computePartnerReturns` were **not edited at all**, which is a stronger guarantee than any assertion about them. The Fund Manager takes 100% of the five management fees (never split, a constant rather than a stored input) plus its matrix share of the performance fee; project parties take only their matrix share. **Shares are never normalised**: a matrix summing to 80% allocates 80% and reports the remainder as `unallocatedPerformanceFee`, with a three-state chip separating "not allocated yet" (neutral) from "allocated wrong" (amber).

**The check that earns its place.** Within a fund-ON run, changing the fee distribution matrix must leave the ENTIRE partners block and every gross stream byte-identical, with only `feeEarners` moving. Proven with teeth by leaking the Fund Manager into the partner roster: `verify-fund-fee-income` catches it on three checks, and **all 556 pre-existing checks pass** (`verify-returns-snapshot` 99, `verify-fund-waterfall` 382, `verify-fund-layer-guard` 75). A zero-equity partner takes a 0% share, so `Sigma partners == consolidated` still holds and every property-based check survives the pollution. That is exactly the failure mode section 3 warns about, and nothing before Step 5 could see it.

**Step 5b** answered a question the statements could not: a fee reading zero told you nothing about whether the RATE was zero or the BASE was empty, and the fund structure fee did exactly that.

*The display.* One shared builder, `buildFundFeeBasisRows` in `lib/reports/m4Reports.ts`, returns fee / timing / base / rate / basis / charged per fee. It feeds the new `FundFeeBasisTable` on the M4 P&L (consolidated only: the fees are project level and carry no phase allocation) AND the M5 fee income section AND a Fund Fee Basis block on the Excel P&L tab, so screen, PDF and workbook cannot drift. The Excel block uses the free meta columns B and C for Base and Rate, which is what lets it land without shifting the period axis at column F (the sub-TOC and print setup depend on that position). P&L fee rows also state rate, base and base amount inline, and a zero basis is called out rather than left as a quiet 0.

*The fund size.* This is the part to read carefully, because it reverses a decision that section 2 defends. Fund size was a TYPED input on purpose: it is equity plus debt, debt is solved by the funding requirement, and the fees raise that requirement, so reading it live would let a fee feed its own base. It is now DERIVED (`resolveFundSize`: equity grand total + existing debt + drawdowns + capitalised IDC, the lifetime total, not any period balance). **What makes that safe is not that the danger went away, it is the FREEZE**: the value is resolved once, from the fee-free pass, before the iterative solver runs, and is then a constant for every iteration, exactly as opening NAV has been since Step 3. So the invariant is narrow and precise: the base KIND `fund_size` is linear and allowed; the VALUE is resolved once and frozen; `fund_size_solved`, a live solved figure read INSIDE the loop, stays in `CIRCULAR_FEE_BASES` and stays forbidden. `fundSizeOverride` (migration 211) pins the typed target instead, and the typed figure is also the fallback when the model raises no capital. The Fund Terms tab shows "From your model" rather than a number, because the tab has no computed snapshot and re-deriving the funding solve there would be a second implementation free to drift.

`verify-fund-fees` grew 73 -> 131 for this, including a section proving every fee shows its base and its rate, and section 6b proving the freeze holds.

**Step 6** put the fund layer in the workbook, and the diagnosis it started with is the most useful thing to carry forward: **more than half of it was already there.** The Excel P&L and Cash Flow tabs render from the SAME shared builders as the screen and the PDF (`buildPLRows`, `buildDirectCFRows`), so the five fee lines with their rate and base inline, `Total Fund Management Fee`, the single EBITDA struck after it, the Step 5b Fund Fee Basis block and the `Fund Management and Other Expenses` row inside operating cash flow had all arrived free at Steps 3 and 5b and needed no new code. That is the shared-builder decision paying out, and it was confirmed by building a fund-ON workbook and dumping every row label, not by reading the code and assuming.

What was genuinely missing was the whole M5 fund surface: the Returns tab read `rs.waterfall`, `rs.resultNetDividends` and `rs.feeEarners` nowhere at all. So Step 6 is one new section, `3. Fund Layer`, carrying the gross-vs-net KPI tiles, the terms the waterfall was run on, a gross-vs-net comparison table, the ten waterfall rows in the reference's exact order, the fee income by earner, the shared basis table, and the per-period fee income. Four points worth keeping:

1. **APPENDED as its own numbered section, not woven in where the screen puts it.** Interleaving (waterfall after Development Economics, fee income after Equity Partners) would open and close a section band inside `1. Returns` and would renumber RE Metrics on a fund project but not a standalone one. A trailing section leaves every existing row exactly where it is, and the `setSectionSink` mechanism gives it a Cover ToC entry and a per-tab sub-TOC link with no extra wiring.
2. **`fundRow` is a separate helper, deliberately.** The obvious move was to widen the existing local `moneyRow` with a `noTotal` option and a subtotal branch. That helper is shared with the FCFF / FCFE / Distributed Equity stream rows, which already pass `style: 'subtotal'`, so widening it would have changed what a STANDALONE project renders. The fund block owns its own emitter and touches nothing else.
3. **The workbook stays a hardcoded snapshot.** Every fund figure is a platform-computed constant like the EBITDA above it, written through the same emitters as its neighbours, so `verify-excel-export`'s pinned "zero formula cells" still holds. Emitting live formulas for the fund rows alone would have put recalculating cells on top of frozen ones.
4. **One real defect was found and fixed on the way.** The Excel P&L builds its `M4ReportCtx` with `fmt: (v) => String(v)` so a row's `totalOverride` round-trips back to a number, and `fundFeeLineLabel` used that same `fmt` for the inline basis amount, so since Step 5b the workbook had been reading `Fund structure fee (1.00% of Fund size 154519446.40625)`. The PDF passes `fmt.money`, so it was Excel-only. `M4ReportCtx` gained an optional `labelFmt` defaulting to `fmt` (screen and PDF unchanged) and the Excel P&L passes a compact millions formatter.

**Toggle-off was proven, not asserted.** A full cell-level fingerprint of the fund-OFF workbook (8,615 entries: value, fill and number format, across all 17 sheets) was captured BEFORE any Step 6 code and compared after: byte-identical. `verify-fund-excel` 69 pins the part that can be re-run forever, including that no fund label exists on any sheet with the toggle off. **Proven with teeth**, four sabotages against the finished build, each caught by exactly the check that should catch it: giving the balance rows a lifetime total, rendering the gross stream in the net row, swapping two waterfall rows out of the reference order, and reverting the label formatter.

**A pre-existing shape found while diagnosing, deliberately NOT changed.** In the phase-filtered Direct cash flow the fund fee row shows the full project figure in every phase. That is not a fund-layer defect: `Total Revenue Received`, `Total Operating Expenses Paid`, `Tax Paid`, `Cash Flow from Operations` and `Total Capex` all do the same there, because only the per-asset detail rows are phase-filtered in that view. It predates the fund layer and is out of scope for an additive step.

**Fund terms are still absent from the Inputs tab.** The workbook's structural rule is that inputs live on Inputs, and no fund term (toggle, rates, hurdle, fund manager, distribution matrix) appears there. Step 6 states the hurdle rate, the performance fee and the Fund Manager on the Returns tab so the waterfall can be checked by eye, and the fee bases and rates are in the Fund Fee Basis block, but a proper Fund Terms band on Inputs is a real remaining gap.

**Step 6b** closed the gap Step 6 left open, and the diagnosis is the part worth keeping.

*What was actually missing.* The full project PDF already carried the fee lines with their rate and base, Total Fund Management Fee, the EBITDA struck after it and the cash flow fee row, all inherited free from the shared `m4Reports` builders. It carried NO waterfall, no gross vs net, no fee income, and no basis block: the word "hurdle" did not occur anywhere in the document. **The summary PDF carried nothing at all, and was worse than absent**: its P&L is hand-built rather than from `buildPLRows`, and it printed `ebitdaPerPeriod`, which has been net of fund fees since Step 3, with no fee line. So the page did not foot. On the live fixture, revenue less cost of sales less opex came to -35.98m against a printed EBITDA of -56.76m, a 20.78m gap exactly equal to the fund fee and nowhere explained. That is the same defect Step 3 fixed on the main statements in August, still live on a page nobody had re-read.

*The measurement method is worth reusing.* pdf-lib embeds Inter through fontkit as a CID font, so drawn text lands in the content stream as hex GLYPH IDS, not literals, and a naive text grep silently returns nothing. A first pass at the diagnosis did exactly that and reported everything as missing, which was worthless. `scripts/pdfTextExtract.ts` rebuilds the glyph-id to unicode map from the same font bytes the generator embeds and decodes the streams, so PDF claims are now evidence. A second false reading is also worth recording: a probe for `gross)` matched `Advance received from customer (gross)` and reported gross-vs-net as present when it was not. Probe regexes need to be checked against what they actually matched.

*The fix is a shared builder, not a second implementation.* `src/hubs/modeling/platforms/refm/lib/reports/fundReports.ts` is now the ONE definition of how the fund layer is presented: row order, labels, which lines are balances, the gross-vs-net table, the earner grid, the headline cards. **The M5 screen, the Excel workbook, the full PDF and the summary PDF all render from it**, and the Step 6 inline rows in `buildModelWorkbook` were deleted rather than left as a second copy. Formatting stays the caller's (each surface passes its own money/pct/mult), because what must not drift is STRUCTURE. The three balance rows carrying no lifetime total is encoded once, as an empty `totalOverride`, so no surface has to remember the rule.

*The check that earns its place* is not the presence check. `verify-fund-pdf` section 2 asserts every surface IMPORTS the builder and that none of them re-declares a waterfall row label, so two hand-maintained copies that agree today cannot pass. Proven with teeth by three sabotages: swapping two rows in the shared builder fails 3 checks across the builder and both PDFs at once (which is the point), removing the summary fund block fails 6, and re-inlining one row label in the Excel builder fails the parallel-implementation guard alone.

*Toggle off was proven across all three exports at once*, by fingerprinting Excel cell by cell (value, fill, number format, and `pageSetup`) plus the decoded text of both PDFs, at HEAD and after: 8,660 lines, identical. The `pageSetup` inclusion matters, because the Summary tab now switches from one-page to multi-page when the fund block is present, and the fingerprint proves that switch is inert on a standalone project.

*Two things changed that were not defects in the fund layer.* `verify-fund-fee-income` had two checks that grepped the M5 component source for the row labels; those labels now live in the builder, so both were repointed at the builder OUTPUT, which is strictly stronger than a source grep and covers every surface rather than one component (107 -> 108). And the blanket fund-label sweep in `verify-fund-excel` used an alternation that did not match `Fund Management and Other Expenses`, so the toggle-off sweep had a hole; an explicit check covered that row, so nothing had been mis-verified, but the regex is now widened.

*Known and deliberate:* the full PDF truncates the inline fee labels in its narrow label column (`Fund management fee 2.00% of Opening ...`), which is why the columnar Fund Fee Basis block was added there. The Summary tab can no longer be one page on a fund project, which the user accepted explicitly when choosing full detail on every surface.

Verifiers: `verify-fund-pdf` **49**, `verify-fund-excel` 69, `verify-fund-fee-income` 108, `verify-excel-export` 304.

**Step 7** verified the whole layer end to end, and did it against **FMP RE HUB** rather than a fixture, because a fixture is chosen by the person writing the test and a real project is not. `scripts/verify-fund-e2e.ts` reads the project's latest saved version snapshot and NEVER writes: the fund terms are applied in memory, so the live project is untouched. It falls back to the shared fixture without database credentials and says so in its header rather than silently testing something smaller. **86 checks, 0 failures.**

*Worth recording, and CORRECTED on 2026-08-10:* an earlier version of this section said `refm_fund_terms` had ZERO rows. That was wrong, and the mistake is worth keeping visible because it is an easy one to repeat: the probe query selected a column named `enabled`, the column is `fund_enabled`, the query errored, and the empty fallback was reported as an empty table without the error object being checked.

**The real state is that the layer is CONFIGURED but DISABLED.** FMP RE HUB has a fully populated `refm_fund_terms` row, written 2026-08-05, carrying a fund structure fee of 0.50%, a fund management fee of 0.25%, custody and admin at 0.50%, debt arranging at 0.50%, other expenses of 3,000,000 per annum, an 8% hurdle, 20% carry, a named Fund Manager and a three-row fee distribution matrix. The one thing it does not carry is `fund_enabled`, which is **false**.

That is exactly the state Step 1's guard was written for (fully populated but disabled), so an export with no fund content anywhere is the correct and tested behaviour rather than a defect. Flipping only that flag, with every other stored value untouched, produces 403.844m of fees and 57 fund rows in the workbook (P&L 17, Cash Flow 4, Returns 36).

**A second thing that follows from the dates:** every saved version of FMP RE HUB is from 2026-06-17 and carries `project.fundTerms` ABSENT, while the terms row was written 2026-08-05. So no saved version carries fund terms at all, and exporting a VERSION through the export picker will show no fund content even once the toggle is on. A new version has to be saved after enabling.

Step 7 remains the first time the layer was exercised on real project data, because the toggle has never been on.

**What it proves, on 3 phases, 8 assets across Operate / Sell / Sell+Manage / Lease, 14 periods:**

1. **Toggle off is identical to today** with the terms FULLY POPULATED but disabled: the full financials and returns snapshots are `Object.is` identical, the P&L / both cash flows / balance sheet row builders are identical, and the Excel workbook and BOTH PDFs are identical. Turning the toggle ON with every rate at zero is also identical, which separates "the toggle does nothing" from "the fees do something".
2. **The cash chain is an EXACT identity**, not a direction: `CFO_on = CFO_off - fee + taxShield`, worst residue 2.4e-7 on a 2,040m scale, every period. Note on sign, since it is easy to get wrong: `taxPaid` is stored NEGATIVE, so the shield ADDS.
3. **The freeze, tested decisively.** The structure fee charged on **5,466.799280m**, equal to the FEE-FREE run's fund size to **0.000e+0**, while the with-fees run's fund size is **5,626.859262m**. The fees raised capital by 160.1m and the fee did not follow it. **An earlier version of this check moved `minimumCashReserve` and expected the fees not to move; that was the wrong test and it failed correctly.** Moving an INPUT legitimately changes the fee, because it changes the fee-free model the base is read from. The freeze does not claim invariance to inputs.
4. **The waterfall conserves cash** every period on both a real-terms and a cleared-hurdle case, and the unpaid hurdle balance closes into the next period's opening.
5. **Post-fee IRR and MOIC are recomputed independently** in the verifier and matched to 1e-9, rather than read back from the field under test.
6. **Changing the hurdle leaves FCFF, FCFE and the gross Distributed Equity stream byte-identical**, which is the structural claim that keeps the waterfall out of the funding solve, tested across two real settings rather than asserted.
7. **Every surface agrees**: row order matches on the screen builder, the full PDF, the summary PDF and Excel, and every waterfall total agrees between the builder and the Excel cell.

**The real project does not clear an 8% hurdle**, so at its own realistic terms excess is zero, the performance fee is zero and the unpaid hurdle at exit is 3,085.8m. The carry mechanics would have passed VACUOUSLY. Step 7 therefore runs a second cleared-hurdle case (0% hurdle: distributions 4,437.5m = hurdle 2,632.7m + excess 1,804.8m, fee 361.0m = exactly 20% of the excess) and reports both. Any future change to this verifier must keep a case that actually earns a fee.

### "EBITDA before fund fees" is NOT the standalone EBITDA

Found by Step 7 on the real project, and worth stating plainly because the field name invites the wrong reading.

`ebitdaBeforeFundFeesPerPeriod` is the pre-fee measure **within a fund-ON run**. It is NOT what the same project produces with the fund layer off. On FMP RE HUB:

```
fund OFF, EBITDA                          5,053.947m
fund ON,  ebitdaBeforeFundFeesPerPeriod   5,021.992m
gap                                          31.956m
```

**The chain, measured rather than inferred:**

```
fund fee is a cash outflow      ->  funding requirement rises
more funding                    ->  construction interest  +35.212m
construction interest           ->  IDC capitalised        +35.212m
IDC capitalised into the Sell assets' inventory
inventory released to cost of sales    ->  cost of sales    +31.956m
cost of sales                   ->  EBITDA before fees     -31.956m
```

Revenue and operating expenses are unchanged to the cent; the whole gap is cost of sales. The remaining 3.256m of IDC is still sitting in inventory and fixed assets at the horizon, and the depreciable share shows up as D&A +1.433m.

**This is not a circularity breach, and Step 7 proves that separately.** The fee schedule is frozen: the fees total exactly 1,047.144m in both runs, and the structure fee provably charges on the fee-free fund size. What moves is a SECOND-ORDER consequence *below* the fee: paying fees needs more debt, more debt capitalises more interest, and capitalised interest is a real cost of the units being sold. The economics are right. Only the label is misleading.

**So, when comparing a fund project against its standalone self, compare two RUNS, not two fields.** The pre-fee field answers "what did this fund-ON project earn before its fees", which is a different and narrower question.

**Two more things Step 7 established that are easy to misread as defects.** The balance sheet carries a worst residue of 360.8 currency units on a 7,034m sheet (5.1e-8 relative), and it is IDENTICAL with the fund layer off and on, so it is pre-existing solver convergence and not fund related; the verifier asserts a relative tolerance AND that the fund layer does not worsen it. And the waterfall's `unallocated` reads -9.5e-7 against 4,437m of distributions, a relative 2.2e-16, which is one machine epsilon: "zero by construction" is true in exact arithmetic, so the check is relative to the cash being split rather than literal zero.

**The UI is verified at SOURCE level only, and that limit is real.** `verify-fund-fee-income` section 7 asserts the sections are gated, the reference labels appear in the reference ORDER, and the fee section is a sibling of `PartnersSection`; section 7b asserts every array handed to the tables is full-length and finite, which is where a runtime crash would come from. It does NOT prove the surface renders. A real render check was attempted and abandoned: the table tree imports a CSS module, which is a Next build feature `tsx` cannot compile, and stubbing the module interop did not hold. The live browser check is therefore a genuine part of Step 5's sign-off, not a formality.

---

## 5. Scope: ship vs wait

**Ships before launch (v1):** M1 Fund Terms tab and toggle, schema, M4 fee line into the funding requirement, M5 hurdle/carry/waterfall/net-and-gross returns, M5 Parties fee income, Excel export rows, the verifiers.

**Waits:**
- a fund-size fee base DERIVED from the solve, and the circular solve it would need (v1.1, post-launch)
- M7 IC Report fee sections (post-launch, numbers already live in M5 and Excel)
- any fund entity above the project, multi-project funds (future)

---

## 6. Standing rules

- **Regression guard first.** Step 1 is the toggle-off byte-identical verifier, written before any feature code. Nothing ships if it fails.
- **Toggle off equals today.** With the fund toggle off, every existing project produces numerically identical results to today. Non-negotiable, and the guard tests it with a FULLY POPULATED but disabled block, not a bare toggle: that is the state a real user reaches.
- **Additive only.** New tab, new table, new columns. No drops, no destructive schema change. Migrations numbered, applied manually by Ahmad in Supabase.
- **Linear fee bases only.** Enforced by `FUND_FEE_SPECS` + `LINEAR_FEE_BASES` / `CIRCULAR_FEE_BASES`, not by anyone remembering.
- **Anything the solver moves must be frozen before the solve.** Step 3's fee schedule is built from a fee-free pass and passed unchanged into every iteration. Step 4 was expected to carry the same exposure and turned out not to: carry is a split of already-distributed cash, so it never reaches the funding requirement. That is asserted by a verifier, not assumed. The rule still binds anything later that spends real project cash.
- **Schema reads stay tolerant, in tiers.** The server probes 210 -> 209 -> 208 and steps down on a missing column, so the tab survives a database that lags the repo. Whatever a lower tier cannot hold still rides in the version snapshot.
- **Engine inputs live in the version snapshot.** The durable table is the tab's store; the ENGINE reads `Project.fundTerms` inside the snapshot, so a saved version reproduces the terms it was computed with and Module 6 scenarios can override them later.
- **Migrations are verified BEHAVIOURALLY.** Grepping the DDL proves presence, not behaviour. Every applied migration gets live probes on a THROWAWAY project that is deleted afterwards.
- **Engine verifiers stay green.** The returns snapshot and returns engine verifiers stay green on every step.
- **Diagnose first.** Every step starts with a read-only diagnosis, reported before building.
- **One step at a time.** Lock and verify a step before the next.
- **Hold for review.** Engine-adjacent steps (M4, M5) hold for Ahmad's live check before push.
- **No em dashes** anywhere in content.
- **Commit and push in the same step**, then confirm the deploy SHA matches HEAD.

---

## 7. Known issues and open gaps

**Gap-sized drawdown does not fully meet the computed requirement.** Found during Step 3, NOT caused by it. With `fundingMethod: 3` and a minimum cash reserve, closing cash goes negative in the first operating period because the drawdown raised is smaller than `netCashRequiredPerPeriod`. The baseline troughs at about -9.8m **with no fund fees at all**; fees deepen it by their own cash cost and no more. Not a facility size cap (LTV 60 -> 95 changes nothing) and not the drawdown method (`min_cash_floor` is identical, since Method 3 gap-sizing supplies the schedule). **Decision 2026-08-04: out of scope for an additive step, logged in CLAUDE-TODO.md for later.** `verify-fund-fees` section 5 documents why the non-negativity assertion is absent and is where it belongs once fixed.

**Fixed 2026-08-10, found by a user export rather than by any verifier: the live model did not carry the fund terms unless the Fund Terms tab had been opened.** `Project.fundTerms` is what the engine reads, and the only thing that ever put it in the store was `Module1FundTerms` mounting. So a user could have the toggle on, open the project, go straight to Export and get a workbook with no fund content anywhere and no warning, because the live model genuinely had no terms. `attachToProject` now loads them on the project-open path, merged BEFORE hydrate and before the autosave subscriber is wired (injecting after hydrate would trip the subscriber and cause the version churn the `editingEnabled` gate exists to prevent), filling only an ABSENT value so a version being viewed still wins, and folded into the dirty baseline so a project whose saved version predates the terms does not open as "unsaved".

**The related trap is now stated rather than silent.** A saved version reproduces the terms it was computed WITH, so a project that enabled the fund layer after its last save has versions that carry none. The export modal loads the selected version and, when the live model has the fund layer on and that version does not, says so plainly and points at the current working draft. It checks the version rather than guessing from dates, so the warning is a fact.

**No browser verification. THIS IS NOW THE ONLY UNVERIFIED SURFACE, and Step 7 did not close it.** Every fund step has been proven by types, verifiers and build only. The Fund Terms tab carries real UI (the Fund Manager card, the pinned matrix row, the resolved facility-limit display with its override) and the M5 Returns tab carries the waterfall and fee income sections, none of which any verifier can see. This is the same gap that let Module 7's EditLayer sit dead for about ten days behind passing checks. Step 7 proved the engine and all three exports on real data; it says nothing about whether a browser renders any of it. **Closing this is the remaining work on the fund layer.**

**The real project does not clear an 8% hurdle** (gross Distributed Equity IRR 4.38% with the fund on), so the performance fee is zero at realistic terms and the carry path only ever runs in the verifier's second, cleared-hurdle case. Not a defect, but it means nobody has yet seen a non-zero performance fee on a real project, and the first user who turns the layer on probably will not either.

**No render-level UI verification (2026-08-05).** Step 5's two M5 sections are asserted at source level only (gating, reference row ORDER, sibling placement, and the shape of every array fed to the tables). A real render check under `tsx` is blocked by the CSS-module import in the table tree, which is a Next build feature `tsx` cannot compile; stubbing the interop was tried and did not hold. Closing this properly needs either a jsdom or Playwright harness with the Next transform available, which is its own piece of work and is not gating Step 6.

**Pre-existing, unrelated: `verify-module6-scenarios` is 127 passed / 1 failed** on `Module 7 is Reports and live (enabled)`, a stale expectation left over from the Modules 6 and 7 swap (Module 7 is now "IC Presentation Builder"). Confirmed identical with all Step 4 code removed, so it is not a fund-layer regression. Logged here so the next step does not spend time re-diagnosing it.

---

## 8. Presentation corrections, 2026-08-11

A user review of an exported workbook. The engine was not touched: every change here is presentation, and toggle-off stayed byte-identical throughout.

### The state changed: the toggle is now ON

`refm_fund_terms.fund_enabled` is **true** and the latest saved version (labelled 1.0, dated 2026-08-10) carries `project.fundTerms.enabled: true`. FMP RE HUB therefore exports a full fund workbook: **359.941m of fees, 5,651.850m distributed, ZERO performance fee** because the 8% hurdle is never cleared, leaving 1,477.007m unpaid at exit.

Two earlier claims in this document are now false and are corrected rather than deleted, so the correction stays legible: the toggle HAS been on, and the saved versions DO carry fund terms.

### A baseline captured against the real project is not a baseline

**Use `buildExcelSampleState` for any before/after identity proof.** The saved FMP RE HUB version is edited IN PLACE by the user (`startEditInPlace` updates the existing row), so the version label and `created_at` stay the same while the `snapshot` changes. A fingerprint taken at the start of a session and compared at the end diverged across Capex, Revenue, Schedules, Financing and Balance Sheet, and asset names changed, which read exactly like an engine regression. It was the data moving. The FIXTURE portion being identical at HEAD is what isolated it.

Second trap from the same session: fingerprint files written on Windows can be CRLF in one capture and LF in another, and `diff` then reports the whole file as one changed hunk, which looks like total divergence. Strip with `sed 's/\r//g'` on both sides, and compare structured cell lines (sorted) separately from PDF text lines (in order).

### A base is a STOCK, and summing one is not a quantity

The fee-basis Total column summed the per-period bases, so an annual fee on total equity printed **36,858.3m against a 5,466.8m fund size** on the Excel P&L, the Excel Returns tab AND both PDFs. Encoded once in the shared builder as `basisDisplay` + `basisIsPerPeriod`: a constant base displays as the CONSTANT with its period count, and only a base that genuinely moves period to period falls back to the lifetime sum. `basis` is retained so `basis x rate == charged` stays checkable, and is marked do-not-render.

### A flat-amount fee is ONE row

Its basis and its charge are the same quantity (3.0m per period charged on a basis of 3.0m per period), so the basis/charged pair said the same thing twice. `FundFeeBasisRow.hasRate` carries that semantically rather than inferring it from `rate === '-'`, because a display string is not a fact about the fee. Rate-based fees keep both rows, where the two genuinely differ.

### Labels have to FIT

"Custody and admin fee: basis charged on (per period, 14 periods)" is 64 characters in a 34-character label column, so it rendered as "...basis charged on (p", cutting off the count it existed to show. Labels are now `<fee>: basis` / `<fee>: charged` and the period count rides on the **Base** column ("Total equity x 14"), which is 30 wide. The Rate column was **2 characters** and could not overflow because the Total cell beside it is never empty; widened to 10, only when the fund block renders.

**ExcelJS trap: `isCustomWidth` is `width !== DEFAULT_COLUMN_WIDTH` and that constant is 9.** A column set to exactly 9 is dropped from `<cols>` and the width silently does not apply. The first attempt used 9. The verifier now asserts `>= 8 && !== 9`.

### Hurdle Accrued carries no lifetime total

It joins the three balance rows in `FUND_WATERFALL_NO_TOTAL_ROWS` (the old `FUND_WATERFALL_BALANCE_ROWS` is a deprecated alias). **This is presentation judgement, not an identity, and is reversible:** the sum does reconcile, `accrued 4,496.1 + drawn 2,632.7 == paid 5,651.8 + unpaid at exit 1,477.0`. It is dropped because an accrual on a compounding balance, printed between two balance rows, reads as a balance.

### Gross equals net is explained rather than left looking broken

`fundGrossNetNote` in `fundReports.ts` renders on the M5 screen, the Excel Returns tab, the Excel Summary and both PDFs, and returns an empty string the moment a performance fee arises. On this project excess distributions are zero in EVERY period, because the hurdle accrues on (opening unpaid + same-period draw) and compounds, so `paid = MIN(dist, owed)` binds throughout.

### Fund terms are on the Inputs tab

A FUND INPUTS band closes the gap listed in section 7: the toggle, the five rates, other expenses, the hurdle, the performance fee, the Fund Manager, both override flags, the three resolved capital bases (marked computed, not typed) and the un-normalised distribution matrix.

### One reported defect that was NOT one

"Other expenses prints raw 3000000 and 42000000 while every neighbouring figure is in millions" was reported twice and investigated to the byte through the real export path: file round-trip, raw sheet XML, `styles.xml` numFmtId resolution, and a shared-strings scan. Those cells carry style `s=105` -> `numFmtId=166` -> the millions accounting format, **identical to every neighbouring fee row**, and no 7+ digit run exists as text anywhere in the workbook. The values were being read programmatically rather than rendered. **Do not re-investigate.**

A real adjacent defect was found on the way and fixed: `labelMoney` was hardcoded to millions regardless of export scale, so a full-unit export printed "0.50% of Total equity 2,632.7 m" beside a value cell of 13,163,667. It now follows `displayScale`.

### Verifier state

`verify-fund-excel` 69 -> **75** (teeth proven by four sabotages: no collapse, collapse everything, the long labels back, the width back to 9), `verify-fund-fee-income` 107 -> **109**, `verify-fund-pdf` 49, `verify-fund-fees` 136, `verify-fund-terms` 182, `verify-fund-waterfall` 382, `verify-fund-layer-guard` 75, `verify-fund-e2e` 86.

**Still unverified: none of this has been opened in a browser.** Section 7's browser gap is unchanged and now also covers the Inputs FUND band and the corrected basis block.
