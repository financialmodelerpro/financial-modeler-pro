# Pending Work & Backlog

> Forward-looking only: active follow-ups, in-progress work, backlog, legacy reference. Completed phase narratives live in **CLAUDE-FEATURES.md** (archive) and `git log` (authoritative). Do not re-add "Recently Completed" sections here when closing a phase, write the closure into CLAUDE-FEATURES.md instead.

---

## CLOSED 2026-08-19: Passes B and C, both shipped and browser-verified

Diagnosed and logged here as open, then built. The full narrative, with the measurements, is in
[CLAUDE-REFM.md](CLAUDE-REFM.md) 2026-08-19e (Pass B) and 2026-08-19f (Pass C).

- **Pass B** the view lock now covers model-mutating buttons by declaration, the Financing toggle
  cannot write the durable row when the store write no-ops, and both projects' two stores were made
  consistent without changing either chosen setting.
- **Pass C** `computeAssetCost` takes the revenue snapshot, `revenue/sellingCosts.ts` owns the one
  multiplication, and Module 2 Revenue shows the Selling Costs section plus a year-on-year schedule.

---
## CLOSED 2026-08-19: depreciation started a year early. FIXED

Logged here as open the same day and fixed on request. Kept rather than deleted, because the
measured figures are the record of what moved.

**The mechanism.** `fixed-assets-resolvers.ts` handed the depreciation engine `offset + cp - 1`,
the LAST CONSTRUCTION period. That index is the M2 PIT revenue-recognition handover, a deliberate
and verifier-pinned convention (A2-1..A2-5) for when a unit is handed to a buyer, and it was
reused for a different question. Revenue is recognised on handover; depreciation begins when the
asset is AVAILABLE FOR USE, which is the first operating period, `offset + cp`. One index
answering two rules.

**Fixed** to `operationsStartIdx = Math.max(0, offset + cp)`, and the `Math.min(N - 1, ...)` clamp
is gone: it turned a `cp = 0` phase into index 0 (a guess) and a phase opening beyond the axis
into a year of depreciation for an asset that never opens. The engine already returns zeros for a
start past the axis, which is the honest answer.

**Measured on both live projects:**

| project | charged before operations | lifetime depreciation | closing NBV at exit |
| --- | --- | --- | --- |
| FMP - MARINA GATE | 5.791m in 2030 -> **0** | 52.121m -> 46.329m | 92.659m -> **98.450m** |
| FMP RE HUB | 14.294m in 2029 -> **0** | 1,613.235m -> 1,598.941m | 1,344.117m -> **1,358.411m** |

The lifetime charge FALLS because a vintage whose useful life already ran past the end of the axis
loses one more year off the end. That is not value lost: closing NBV rises by the same amount to
the cent, which is the conservation identity, and the balance sheet still closes at 0.00 on both
projects. Profit after tax rises (429.599m -> 435.245m and 2,688.418m -> 2,702.332m) and tax with
it (11.238m -> 11.382m, 71.764m -> 72.121m), which is the arithmetic consequence of charging less
depreciation inside the window.

**IT TOOK TWO PASSES, and the second is the lesson.** There are TWO depreciation streams: the
asset's own capex (`computeAllFixedAssetResults`) and the IDC capitalised into it
(`computeIdcSnapshot`), each with its own hand-rolled `offset + cp - 1`. The first fix corrected
only the fixed-asset stream, so IDC depreciation still landed in the last construction year
(0.654m on FMP - MARINA GATE, 0.076m on FMP RE HUB) and the user reported it again. The
measurement script also read only the fixed-asset stream, so it reported "none" while the defect
was live. Both now call ONE shared `operationsStartIndex`, and the script reads the per-asset P&L
D&A, which sums both streams.

Final P&L D&A: 52.216m -> 51.562m (MARINA GATE) and 1,599.973m -> 1,599.897m (RE HUB) after the
IDC copy was fixed as well.

`verify-fixed-assets` 82 -> 99, sections M and N, teeth proven by three sabotages against the code
(the old index restored, the shared rule reverted, the overlap term dropped).
Its fixture is an asset that is actually BUILT: every pre-existing resolver fixture in that file
carries opening NBV with `cp = 0`, where the old and new rules both clamp to 0 and agree, which is
exactly why 82 checks could not see this.

Re-measure with `npx tsx scripts/measure-depreciation-start.ts`.

---
## PARKED, post-launch: the documentation restructure (diagnosed 2026-08-16, half done)

**Done and shipped (`52d09467`):** the migration-flag audit (all eleven PENDING markers in CLAUDE-DB.md were stale, corrected against the live schema, re-runnable via `scripts/audit-migration-flags.ts`) and **[docs/TRAPS.md](docs/TRAPS.md)**, which collects the hard-won lessons that were scattered across five files and agent memory with no authoritative copy. Every old location keeps its copy and gained a pointer.

**Deliberately HELD until after launch**, because it changes no platform behaviour and the docs should not move while end-to-end testing is running:

1. **Slim `CLAUDE.md` from ~103 KB to ~12 KB.** Only ~9.6 KB of it (STRICT SESSION RULES to end) is durable rules; the rest is module narrative that duplicates the platform docs, and it violates the file's own rule that platform work belongs in `CLAUDE-{platform}.md`. Replace the module bullets with a one-line-per-module table plus pointers. This is the highest-leverage single change: a REFM session currently reads ~308 KB before starting, which this drops to ~60 KB.
2. **Move the 25 dated session sections out of `CLAUDE-REFM.md`** into `CLAUDE-FEATURES.md` (the archive). Six sections are durable and stay: Design System, Verifier Scripts, Module 1 Conventions, and the three archive sections. Promote any rule buried in the narrative into Conventions or TRAPS.md FIRST.
3. **Archive to `docs/archive/`, moved not deleted:** `PLATFORM_INVENTORY.md`, `RESTRUCTURE_PLAN.md` (both self-labelled historical), `docs/MODULE_1_AUDIT_M1.11.md` (still reads "not yet executed" from May), `docs/MODULE_1_CAPABILITIES.md` (predates the M2.0 rebuild), `M7_IC_Layout_Spec.md` (superseded by the shipped renderer). Move the external-audience docs (`CMS_REFERENCE.md`, `REFM-PLATFORM-SUMMARY.md`, `PACEMAKERS_ADMIN_CMS_SPEC.md`, `PITCH_DECK_BRIEF.md`) to `docs/external/`.
4. **Regenerate `HANDOFF.md`** (`npm run handoff`); it is auto-generated and was ~12 commits behind.
5. **Pre-existing em dashes in markdown**: 29 in CLAUDE-ROUTES.md, 19 in CLAUDE-FEATURES.md, 13 in CLAUDE-REFM.md, 2 in CLAUDE-DB.md. `verify-no-em-dash-content` sweeps `app/` and `src/` only, so markdown has never been checked. Sweep when the files are being restructured anyway.

**ADD THESE TWO RULES to CLAUDE.md as part of item 1.** They are why the bloat accumulated, and without them it regrows:

- **The RULE goes in the docs; the STORY goes in the commit message.** Most of the 1.5 MB of markdown is session narrative that `git log` already holds. "The marketing stage crashed the financing aggregate on 2026-08-16" is history. "A stage list must never be a literal array with an `as` cast; derive it from `COST_STAGES`" is a rule.
- **Verifier counts belong in the verifier, not quoted in prose.** Every count written into a markdown file is stale by default and several already are (the `verify-strategy-switch` figure in CLAUDE.md was wrong for weeks).

---

## START HERE (2026-08-17): MODULE 1 IS CLOSED. The remaining modules have NOT had the same treatment.

**Module 1 closed on 2026-08-17 after 28 defects found by entering a real project end to end**,
across seven batches in one day, plus two more the new verifiers found themselves. Every fix is
browser-verified against the live project and a throwaway, pinned by a verifier proven by
sabotage, and every fix that could move a saved number was measured before and after. Full
narrative in [CLAUDE-REFM.md](CLAUDE-REFM.md) 2026-08-17; the traps are
[docs/TRAPS.md](docs/TRAPS.md) 7.12 and 7.15 through 7.21.

**No further Module 1 changes before launch.**

### The finding that should shape the next task

The previous START HERE said the highest-value work was to open Module 1 in a browser, because
three UI defects had got past every check. That was right, and it under-called it: **driving the
module as a user found 28.** Not one of them was found by the 120-verifier suite, and several had
been shipping for weeks (a transfer tax charged twice into the financing schedule, the statements,
the returns and both exports; a phase 1 land lump present in the model and in no period column;
capex allocated to nobody when a share basis had a zero denominator).

The lesson is the plan: **a check written from the same understanding as the code cannot find a
defect in that understanding.** Only using the product does.

### So: the same treatment, module by module, in a browser

Modules 2 to 7 have never been driven end to end this way. Suggested order, by exposure:

1. **Module 2 (Revenue, CoS, Schedules, Escrow)** and **Module 3 (Opex)**, because Module 1 now
   feeds them correctly in places it previously did not, and because the phasing / window rules
   fixed in Module 1 have counterparts here.
2. **Module 4 (Statements)**, reading the three statements against each other on screen rather
   than through the reconciliation checks, which pass by construction.
3. **Module 5 and 6**, where a wrong basis reads as a plausible number.
4. **Module 7 (the deck)**, which has never been browser-verified at all, and the fund layer,
   which has an open gap logged below since 2026-08-04.

**What to look for, from what the 28 turned out to be.** Nearly all of them were one rule written
in more than one place with more than one answer, or a number that was right in the model and
wrong (or missing, or hidden) on the screen. Concretely: a total that does not equal the sum of
the cells beside it; a row that is visible in one table and absent from another; a value that
changes by itself after you type it; a control that accepts a change that does not stick; two
tables that show the same figure and might be a split rather than a duplicate. Check the
arithmetic of a printed column by hand at least once per tab.

**Also still true and still worth doing:** the exports have not been re-read since PDF pass 3
landed, and nothing from the 2026-08-11 or 2026-08-12 sessions has been browser-verified.

### POST-LAUNCH, logged and deliberately NOT started

| Item | Why it is parked |
|---|---|
| **Consolidated input matrix** (asset rows x phase columns) | The matrix absorbs QUANTITIES cleanly (rates, values, toggles, start/end, the per-asset override layer). It cannot express STRUCTURE: `selectedLineIds` (a set-valued, order-constrained relation), manual distribution arrays (a vector per line per asset), `perSubUnitRates` (a rate sheet one level below the cell), `phasingSource`, and stage. Workable split is a matrix for numbers plus a per-line detail surface for relations and vectors. **Decide the series question BEFORE the cell contract**, or a second dimension of meaning has to be retrofitted into a shipped cell |
| **Plots table** | Not started, not scoped |
| **The FOURTH PASS** (`amount_t = f(series_t)`) | Needs a per-period resolution stage after passes 1 to 3, a series registry on the context supplied at every call site, and an ordering rule for series. **The audit says it buys nothing today**: gross list value and total collections agree to 0.0% on the live project, so the cheaper intermediate already produces the right answer. The new NOTE advisory in both PDFs and the workbook is what will make the case visible if it ever arises |
| **Parent-provided snapshot** across the ten screens | Better than every screen computing its own, but it is a shell change affecting Module1Financing, both Module 2 screens, all of Module 4 and 5, Module 7 and Overview. Doing it for one screen would leave that screen fed from above while its sibling tab computes its own |
| **Delete `financing-hooks.ts`** | Confirmed DEAD: `createFinancingHooks` is exported and imported nowhere in `src/` or `app/`. Two of the `computeAssetCost` call sites counted in early reports were never reachable |

### Known gaps left open on purpose

- An **`allocated` line using a cash base** would need a phase-wide collections total, which is not plumbed. Nothing uses it; the code says so rather than guessing.
- The **phase-filtered Direct CF** shows the full project fund fee in every phase (pre-existing; Total Revenue Received, Tax Paid and Total Capex behave the same way).
- The seeded **`commission` line computes to zero** out of the box (`percent_of_selected` with an empty `selectedLineIds`, awaiting the M2.1 revenue source). Its collections phasing default is correct but inert.

---

## PARKED FOR DISCUSSION, the AI_REVIEW_GUIDE.md audit (2026-07-31)

`AI_REVIEW_GUIDE.md` sits at the repo root, **untracked**, and is scheduled for discussion on 2026-08-01. It is a repository audit dated 2026-07-31 that was NOT produced by any Claude Code session on this project (no session transcript references it, and it has never been committed on any branch). **Treat it as untrusted input**: of the claims checked so far, one was materially wrong and one proposed the wrong fix. It is useful, not authoritative.

**Status of each finding, verified rather than assumed:**

| Finding | Status |
|---|---|
| Critical: open email relay, `/api/email/send` | **RESOLVED by deletion**, commit `921135b4`. Verified live: the endpoint now 404s. Note the audit's fix direction ("make auth mandatory") was WRONG: the endpoint had no caller at all, so securing it would have hardened a stale name around dead code. Deleted instead, with the misnamed `RESEND_WEBHOOK_SECRET`, the orphaned `accountConfirmation` template, and the dead `resendRegistrationId()` Apps Script helper |
| Critical: transcript generation by regId+email | **CLOSED BY DECISION.** Public by design, confirmed by Ahmad. Do not re-report |
| Critical: certificate PII via public lookup | **CLOSED BY DECISION.** Same |
| High: certificate-image lookups | **CLOSED BY DECISION.** Same |
| High: transcript-link, "require owner session on GET, POST and DELETE" | **PARTLY WRONG, and one piece still open.** DELETE already validates the `training_session` cookie (`route.ts:134`), so the audit is wrong there. Read access is closed by the decision above. **`POST` remains an unauthenticated WRITE**: any caller can mint a share-link row for any regId+email+courseId. Disclosure-by-design does not answer a write path. Raised once, not re-raised, awaiting a decision |
| High: stored XSS via unsanitized CMS icon HTML, `app/(portal)/page.tsx:463` | **NOT VERIFIED.** No diagnosis run |
| Medium: unsanitized newsletter HTML in the admin browser, `NewsletterTab.tsx:541` | **NOT VERIFIED** |
| 4 correctness / React findings (hook order, render-time random IDs, swallowed fetch failures, sync effect updates) | **NOT VERIFIED** |
| Quality gate: "lint failed with 401 errors and 268 warnings" | **CONFIRMED EXACTLY.** `npm run lint` reports `669 problems (401 errors, 268 warnings)` as of 2026-07-31. Type-check passes |

**For the discussion:** the unverified items are the actual agenda, since the security items are either resolved or closed by decision. The two XSS-shaped findings are the highest-value things left to check, and the lint baseline is a real and independently confirmed blocker to using lint as a CI gate.

**Housekeeping:** the file is untracked, so a working-tree clean would lose it. It has deliberately never been committed (Ahmad's instruction on 2026-07-31). Decide whether to commit it or move it out of the repo.

---

## OPEN GAP: the fund layer has never been opened in a browser (2026-08-04, still open 2026-08-11)

**Widened 2026-08-11.** The gap now also covers the corrected fund fee basis
block, the new FUND INPUTS band on the Inputs tab, the gross-vs-net note, and
the M5 waterfall caption. The fund toggle is now ON on the real project, so
these surfaces are reachable rather than hypothetical. See the START HERE
section above for the full 2026-08-11 unverified list.


Five deploys of fund-layer work (Steps 1 to 3 plus the Fund Manager and facility-limit changes) are live and proven by **types, verifiers and build only**. Nothing has been driven in a real browser.

**What is unverified visually**, in rough order of risk:

1. **The Fund Terms tab** (M1 tab 3): the Fund Manager card, the pinned `__fund_manager__` matrix row with its badge, the resolved facility-limit display and its "Enter the limit myself" override, the percent inputs (which re-sync during render via a `{text, from}` draft rather than an effect), and the per-column total chips.
2. **The M4 P&L with fees on**: one row per charged fee, the Total Fund Fees subtotal and the EBITDA after fund fees line, rendered through the shared `m4Reports` builder so they also reach the PDF and Excel.
3. **The save path end to end**: type terms, save, reload, confirm the durable row and the version snapshot agree.

**Why this is not paranoia.** Module 7's `EditLayer` sat dead for about ten days behind passing checks, found only by opening it (`[[feedback_gesture_lifecycle_pointer_capture]]`). A verifier cannot see a mis-wired checkbox, an input that will not accept a keystroke, or a panel that renders off-screen.

**Cheapest useful pass:** open a project with the fund toggle ON, fill every field on the tab, save, reload, and check M4's P&L shows the fee rows and still foots from EBITDA to PAT.

---

## RESOLVED 2026-08-18: gap-sized drawdown does not fully meet the computed requirement (raised 2026-08-04)

**The diagnosis below was WRONG about the cause, and the cause has since been fixed by
something else.** It blamed the drawdown sizing. It was the SEEDED COST WINDOW:
`makeDefaultCostLines` defaulted every line to `endPeriod = cp + 1`, so on a 2-period
construction phase a slice of construction capex landed in phase-local period 3, the first
OPERATING period, outside the window the funding was sized for. Bisected to `082b1390`
(which made the default window end AT `cp` for a different reason); measured at `b16a5fa6`,
52.416m of capex in t=2 against 34.9m drawn, hence the -9.838m trough.

`verify-fund-fees` section 5 now carries the non-negativity assertion this section asked for,
plus two guards so it cannot pass vacuously, and a check that construction capex is confined
to the construction window which fails HERE naming the cause if it ever escapes again.
The original text is kept below because the "what it is NOT" list is still useful evidence.

### Original entry, 2026-08-04

**Found during fund layer Step 3; NOT caused by it, and explicitly out of scope for an additive step. Ahmad's decision 2026-08-04: leave drawdown sizing alone, log it here for later.**

**What happens.** With `fundingMethod: 3` (cash-deficit funding) and a minimum cash reserve set, the model's closing cash goes NEGATIVE in the first operating period, because the drawdown raised is smaller than `method3Waterfall.netCashRequiredPerPeriod` for that period. On the standard hotel fixture (2 construction periods, 8 operating, min cash 5m) the trough is about **-9.8m with NO fund fees at all**. Turning fund fees on deepens it to about -11.0m, which is the fee's own cash cost and no more.

**What it is NOT.**
- Not the fund layer: the baseline troughs negative on its own, and `verify-fund-fees` pins that the fees never amplify the shortfall beyond their own cost.
- Not a facility size cap: raising the tranche `ltvPct` from 60 to 95 does not change the drawn amount or the trough.
- Not the drawdown method: switching `drawdownMethod` to `min_cash_floor` produces identical numbers, because Method 3 gap-sizing supplies the schedule and overrides the tranche's own method.

**Where to look.** `deriveCircularInputs` in `financials-resolvers.ts` feeds `method3Waterfall.netCashRequiredPerPeriod` back as `FundingGapInputs.method3PerPeriod`, and the financing engine turns that into the actual drawdown. The requirement is computed correctly (it rises by exactly the right amount when costs rise); what is drawn against it falls short once construction capex stops. Prime suspects, in order: the one-period LAG the gap formula applies (`Pass 2T-Fix`, this year's need funded from last year's cash), and whatever bounds the per-period draw inside the engine once the capex curve ends.

**Why it matters.** A feasibility model that shows negative cash is showing an infeasible plan. Any user running Method 3 with a min-cash reserve sees a trough that the funding schedule claims to have covered.

**When it is fixed**, `scripts/verify-fund-fees.ts` section 5 carries a ready-made place for the real assertion: it currently asserts the baseline troughs negative and documents WHY the non-negativity check is absent. Replace that with the non-negativity check and the comment above it.

---

## TECH DEBT, logged not fixed: `tranche.phaseId` is not a usable attribution key (2026-08-18)

**Decision 2026-08-18: log it, do not fix it now.** The Capex block is closed pre-launch,
MARINA GATE does not need it, and the only proposed fix produced two wrong answers.

**What is wrong.** A `FinancingTranche` carries a `phaseId`, which reads as "the phase this
facility funds". It is not that. On FMP RE HUB BOTH tranches are tagged `phase_1` while the
new senior debt plainly funds Phases 2 and 3, and Phase 1 is the pre-existing operating hotel
with `cp = 0`. Any rule that classifies a facility by its stored `phaseId` therefore collapses:
measured, it puts ZERO of RE HUB's 759,694k of finance cost into IDC, including the 48,008k
that genuinely is IDC today.

This is a leftover from before Pass 28 (2026-05-14), which stopped windowing a tranche to its
`phaseId` precisely because a bank funds drawdowns in every phase. The field survives because
`removePhase` cascades on it, so it cannot simply be dropped.

**What NOT to build.** A capex-share allocation, splitting each tranche's interest across
phases by that phase's share of cumulative capex and classifying each slice by that phase's
own window, was designed, measured and REJECTED on 2026-08-18. It produces two errors:

1. It reclassifies **604,800k** of the existing hotel loan's interest into IDC on RE HUB,
   because Phases 2 and 3 are building in those years. That loan is a specific borrowing
   against a complete, operating asset; qualifying activity on it has ceased.
2. It peels **9,971k** onto Phase 1, which is the pre-existing hotel with only historical
   spend, so a new construction loan cannot be funding it. The slice is an artifact of the
   hotel's 2.6bn of historical capex sitting in the denominator.

**The rule that is in force instead** (see CLAUDE-REFM.md 2026-08-18c) is the strict IAS 23
qualifying-asset test: interest is IDC only to the extent it funds an asset still under
construction in that period, attributed by what the tranche actually funds. Under it both live
projects are already correct and no engine change was needed.

**When this is picked up**, the thing to add is a real disbursement target on the tranche (what
it actually funds), not a better guess from `phaseId` and not an allocation by capex share.

---
## ⭐ START HERE (current focus, 2026-08-13)

**PASS 4 (PRESENTATION) IS DONE AND UNCOMMITTED, HELD FOR REVIEW.** Six items
raised against both PDFs and the workbook, all fixed, `verify-report-presentation`
92 with teeth proven by nine sabotages and the whole suite re-run green (see
CLAUDE-REFM.md, "export review pass 4"). It is **not committed and not
browser-verified**, and it changes what a reader SEES on surfaces the verifiers
can only string-match: a new `Closing` / `Total / Closing` heading on the balance
sheet, cash flow and schedules (screen too, not just the exports), footnote
markers replacing structural zeros in four tables, a new capital-bases block
above the fee basis table, and two dropped cards on the summary PDF's returns
page. **Read those five things in a real document before committing.** Two
notes worth carrying: the reported "capital base amount sits in the Fee charged
column" was exact for the WORKBOOK only (both PDFs already had it under Basis
charged on), and the balance-sheet heading fix needed `drawPeriodTable` to stop
hardcoding the literal `'Total'`, which it had been doing regardless of what the
builders said.

**THE EXPORTS HAVE NOT BEEN REVIEWED SINCE PASS 3 LANDED.** The PDF review
closed on 2026-08-12 in three passes (`2f546659`, `3cea19dd`, `76ed9e50`, all
deployed and SHA-confirmed against `/api/health`; see CLAUDE-REFM.md 2026-08-12
for the full narrative). Every finding came from ONE diagnosis run against the
real project. **Nobody has re-read either PDF end to end since the fixes went
in**, and pass 3 in particular changed a great deal of what the documents say:
new sections (Timeline, Land & Area, Fund Inputs, Lender Covenants, Sensitivity,
Model Integrity Checks), re-captioned headline metrics, a derived Module 5 tab
numbering, and a version line on the cover and in every footer.

What that means concretely:

1. **Re-read both PDFs.** The verifiers assert identities and the presence of
   labels; they do not judge whether the document READS well. Pass 2 changed
   page counts at two of the three scales (thousands and full go 104 -> 140pp),
   moved column widths, and introduced a label auto-shrink down to 6.5pt. None
   of that has been looked at by a human.
2. **The new sections have never been seen.** Timeline, Land & Area, Fund
   Inputs, Lender Covenants and the Sensitivity grid were written against the
   engine and asserted by string match. Their LAYOUT is unreviewed.
3. **Sensitivity is entitlement-gated in the export.** `ExportModal` passes
   `allows('sensitivity')`. Confirm in a browser that a non-entitled plan gets a
   PDF WITHOUT the grid and an entitled one gets it with.
4. **The per-tab picker + Fund Layer.** A pre-existing bug meant `Tab 5: Fund
   Layer` was never in `PDF_MODULE_TABS`, so touching the picker on a fund
   project dropped the whole fund section from the PDF. It is in the manifest
   now and tab matching is name-based rather than label-based, but the PICKER
   itself has not been exercised in a browser since.

**Known follow-up, deliberately not done:** the workbook's Checks-tab detail
text keeps a millions-pinned money formatter (so folding it into the shared
`checksReport` changed no rendered text). That pinning is the same display-scale
inconsistency pass 2 fixed everywhere else: a full-unit export prints the
residue in units and describes its peak in millions. One-line fix, needs a
fingerprint re-baseline.

**NOTHING FROM THE 2026-08-11 OR 2026-08-12 SESSIONS HAS BEEN BROWSER-VERIFIED.**
Types, verifiers and build only. In rough order of risk:

1. **The strategy-change confirm dialog and review banner** (M1 Assets). Still
   the highest risk: new interactive UI on a destructive-looking action, with
   the underlying store path rewritten. Open an asset, change its strategy,
   confirm the dialog lists what will be retained and what needs review, apply
   it, navigate away and back, and confirm the banner persists until dismissed.
   Then switch BACK and confirm the original sub-units, opex and (for Sell +
   Manage) the companion asset return intact. The round trip is proven by
   `verify-strategy-switch` at the state level, never through the actual UI. See
   [[feedback_gesture_lifecycle_pointer_capture]] for why "the verifier passes"
   has not been sufficient for interactive M1/M7 surfaces before.
2. **Both PDF exports**, per the list above.
3. **Admin > API Keys** (`05676464`): reveal, copy, the auto-hide, and whether
   the audit row actually lands in `admin_audit_log`. That last one is the only
   part whose behaviour depends on the database rather than on code that could
   be exercised offline, and that table has a `NOT NULL admin_id` history. If
   the insert fails the reveal still works by design, and the reason appears in
   the server logs as `[api-keys] audit insert failed`.
4. **The corrected fund fee basis block and the new Inputs FUND band** in a real
   Excel client, to confirm the widened Rate column and the shortened labels
   render as measured.

**Related and still open:** `FMP_PUBLIC_API_KEY` is set in `.env.local` only.
Until it is set in Vercel (Production scope) AND redeployed, the public partner
feed refuses every request and `/admin/api-keys` shows the not-configured panel.

**Stale-count warning, recorded because it bit twice:** `verify-strategy-switch`
is **54 passed + 1 PRE-EXISTING failure** ("the fixture exercises Sell + Manage",
the fixture builds no companion so those clauses never run), not the 82 this
file and CLAUDE.md recorded until 2026-08-12. Re-measure a count before quoting
it.

---

## Module 7 fixes (was START HERE, 2026-08-01)

Everything below is known-open; nothing here is a
guess about what might be wrong.

**Where Module 7 actually stands.** The IC Presentation Builder is LIVE and
substantial: slide editor with direct manipulation, 18 auto-omitting templates,
full year-by-year schedules, live ToC, native PPTX + PDF export from one shared
resolved-export contract, and AI drafting on the narrative blocks. Migration 199
applied. Detail in [CLAUDE-REFM.md](CLAUDE-REFM.md); AI detail in
[CLAUDE-AI.md](CLAUDE-AI.md).

### The gap that matters most: nobody has driven it in a browser

The deck editor and the AI panel are verified structurally and behaviourally,
NOT visually. This is not a theoretical worry:

- **EditLayer was dead for about ten days** behind passing checks (its effect
  deps changed every render, so the cleanup killed each gesture). Found only by
  opening it. See `[[feedback_gesture_lifecycle_pointer_capture]]`.
- **A hook after an early return crashed the whole Presentation tab** on
  2026-08-01, shipped past a 126-check verifier, caught by ESLint after the
  fact. Fixed in `a8b4247d`; `verify-ic-narrative-ui` now fails if any hook
  sits after an early return.

So: open Module 7 in a real browser and exercise drag, resize, snap, inline text
edit, undo/redo, slide add/duplicate/reorder, Insert data block, and export,
before trusting any of it.

### Module 7 build work still outstanding (Phase 3-4)

- **Insert menu**: add new bound objects, images, and shapes to a slide. Today
  only "Insert data block" exists (`blockLibrary.ts`).
- **Image upload**: `ImageObject` renders but there is no upload path. Use the
  timestamped-path + `STORAGE_CACHE_IMMUTABLE` convention from
  `src/shared/storage/cacheControl.ts`.
- **Group / ungroup, align / distribute**: `BaseObject.groupId` exists and is
  honoured by nothing yet.
- **PNG export** (per slide, satori + sharp). PPTX and PDF are done; PNG would
  go through the same `resolveDeckExport` contract so it cannot drift.

### AI, blocked on one external thing

- **No real generated prose has ever been read.** The Anthropic account is out
  of credit, so a Generate click spends a credit, hits the billing error, and
  now refunds it (mig 206). Once credit is added: enable **IC narrative** in
  `/admin/ai-features` (it registers DISABLED), generate one field, and read it
  for voice, for whether it teaches the mechanism rather than restating the
  table, and for whether the audit chip stays green.
- **One credit is sitting spent** on Ahmad's August counter
  (`m7_ic_narrative`, `2026-08-01`, `used: 1`) from a failed test that predates
  the refund. Refund it or leave it; it is 1 of 500.

### Older items, still genuinely open

- **Two-way Sensitivity grid** on the Excel Returns tab: the one Module 5
  section not yet mirrored (the on-screen and PDF grids already exist via
  `computeReturnsSensitivity`).
- **Scenario re-basing** in Module 6: promote a non-base case to base. Needs
  per-case override recompute against the new base.
- Per-element override grammar could extend beyond `parcelFunding` if a scenario
  needs per-period velocity / profile curves (today those stay whole-array
  auto-capture).

---

## FLAG FOR REVIEW, `src/middleware.ts` has never run in production (2026-07-30, DECISION NEEDED)

Verified, not suspected: `app/` is the project source root and there is no `src/app`, so Next resolves middleware at the ROOT (`middleware.ts`) and `src/middleware.ts` is never compiled. `.next/server/middleware-manifest.json` is `{"middleware":{}}`, the build output never mentions middleware, and `/admin/cms`, `/admin/users`, `/admin/revenue` all return **200 unauthenticated** in production. The `/login` + `/admin/login` 307s that made it look alive come from `next.config.ts` redirects (which even comment that they are the primary handler).

**Severity is contained, re-measured live 2026-08-01.** All **121** `app/api/admin/*` route files probed unauthenticated: **69 -> 401, 44 -> 403, 8 -> 200** (the 2026-07-30 note said 118 routes all guarded; the count has grown by three and the "all" was slightly too strong). The 8 open ones are read-only GETs of data the public site already renders, and every write method on those same routes is guarded: `asset-types` (GET public by design since Pass 46; a non-admin gets only `visible` rows), `modules` (platform catalog), `training` (course list, scanned for PII, none found), and five `*-coming-soon` flag readers that public pages poll by design. Admin PAGES return 200 unauthenticated (after the apex -> www 307) but the body is the generic marketing shell, no admin nav and no data, with `useRequireAdmin` bouncing the visitor once the client bundle mounts.

So: no privileged data and no mutation is reachable unauthenticated. What is missing is the documented defence-in-depth layer, and the correct phrasing of what remains is "every admin WRITE is guarded per-route, page-level enforcement is CLIENT-side".

**Do NOT just move the file to the project root.** That ACTIVATES a gate that has never executed in production. If the NextAuth JWT `role` claim is not populated as `getToken` expects, every admin is locked out on the next deploy. Sequence: confirm the claim shape on a live token first, then move, then verify `/admin/*` still loads for an admin before it reaches prod. Root CLAUDE.md "Do NOT touch list" has been corrected to record the real state.

---

## RESOLVED, `refm_project_versions` exceeds the PostgREST 1000-row cap (raised 2026-07-30, FIXED 2026-08-01)

The table holds **1,399 rows** and an unbounded `select` returns exactly **1,000** with a 200, silently dropping the rest.

**Audit of all 11 query sites in `src/hubs/modeling/platforms/refm/lib/persistence/server.ts` (2026-08-01):** ten were already bounded (`.maybeSingle()` / `.limit(1)` / the `listVersionsPaginated` range-walk added by the 2026-05-31 hotfix, plus the write paths). Exactly **one** was unbounded: the `version_count` aggregation in `listProjects`, which pulled `select('project_id').in('project_id', ids)` and used the returned array's LENGTH as the count. The row count being the answer meant the cap became the answer: the live user's project with 1,397 versions rendered as ~1,000 in the picker tile.

**No version was ever lost from history.** The version list itself (`listVersions` -> VersionModal / ExportModal) walks pages of 1000 and was verified live to return all 1,397 rows, oldest (v1) included. The damage was confined to the displayed count.

**Fix:** counting now uses one `count: 'exact', head: true` query per project (head returns no rows, so no cap can apply, and Postgres computes the count), run in parallel batches of 8; the project list itself is now walked with `.range()` too, for symmetry with the version walk. Live proof after the fix: `version_count=1397` / `listVersions rows=1397 min=1 max=1397 distinct=1397`. New verifier **`verify-refm-version-reads` 46**, half structural (every query site must carry an explicit bound) and half behavioural (an in-memory fake that truncates at 1000 exactly like PostgREST); proven to have teeth, restoring the old counting logic fails 6 checks including the 1,000-vs-1,397 case.

---

## PERF BACKLOG, Phases 2 to 4 (2026-07-30, diagnosed + measured, NOT applied)

Phase 1 shipped (parallelised sequential admin count queries: newsletter subscribers 1569ms -> 277ms, admin dashboard 855ms -> 281ms). The bigger wins are all still open, ranked by payoff per unit of effort:

1. ~~**11.6 MB of unoptimized, uncacheable PNGs on the marketing home.**~~ **DONE 2026-08-01: 9.84 MB -> 222 KB (97.8%).** The six images the live marketing pages actually reference were resized to their real CSS render box at 2x DPR and re-encoded (WebP, except the favicon which stays PNG for the non-browser surfaces that fetch it), uploaded as NEW `cms-assets/optimized/` objects with `cacheControl` one year, and the CMS re-pointed (2 `cms_content` rows + 4 `page_sections` rows). Originals untouched; rollback map at `scripts/.optimize-marketing-images.rollback.json`. Repeatable via `scripts/optimize-marketing-images.ts` (dry run by default, idempotent), locked by `verify-marketing-images` 76. **Two premises in the original note were wrong, corrected here:** (a) the images were served `max-age=3600`, NOT `no-cache`, so there was no per-navigation blocking revalidation; `no-cache` is what Supabase's CDN answers to a **HEAD** request regardless of the object's stored cacheControl, and the audit had probed with HEAD. Use a ranged GET (`Range: bytes=0-0`) to read the true header. (b) the 4.25 MB founder photo (`founder-media/`) is not referenced by any live page; the founder image actually served was a different 2.37 MB object. Still open from this item: only 1 file uses `next/image` against 80 raw `<img>`, and `next.config.ts` has no `images` config.
2. **Nothing is cached anywhere.** Zero `unstable_cache` / `'use cache'` / React `cache()` / `revalidateTag` in the codebase, and the busiest marketing pages are explicitly `revalidate = 0` (portal home, articles, contact, about, pricing, modeling, training). Result: `x-vercel-cache: MISS` on every hit, full SSR in `iad1` for every visitor. Measured cold start ~3.1s.
3. **Root-layout tax on every page sitewide.** `generateMetadata()` runs a `cms_content` query before `<head>` can flush, and `<PromoBanner />` is an async server component with no Suspense boundary costing 2 more Supabase queries. Latent landmine: the moment a Paddle API key is set, PromoBanner adds a live `GET api.paddle.com/discounts` to every page render (cached only 60s per lambda instance).
4. **Admin renders nothing server-side.** `app/admin/layout.tsx` is `'use client'` and returns `null` until `useSession()` resolves, so every admin page is a 5-hop serial waterfall (HTML shell -> ~520 KB JS -> `/api/auth/session` -> mount -> `/api/admin/*`). The layout gate reads like it is redundant with middleware, but it is not: the middleware has never run, so this client-side gate is the ONLY page-level enforcement there is. Any rework of this waterfall has to keep a gate, not drop one.
5. **Heavy libs eagerly bundled**: pdf-lib 412 KB on `/admin/certificate-designer`, recharts 348 KB on `/admin/analytics`, tiptap/prosemirror ~340 KB on page-builder / communications-hub / live-sessions. All `next/dynamic` candidates.
6. **No streaming boundaries**: zero `loading.tsx` files in `app/`, so the slowest query on a page gates first paint for the whole page.

Not a problem, checked: fonts (self-hosted `next/font` Inter, preloaded), all script tags `async`, single 62 KB CSS bundle, no oversized assets in `public/`.

---

## FLAG FOR REVIEW, Existing-operations / historical-baseline inputs not consumed by the compute pipeline (2026-06-17)

Surfaced by the Module 6 exhaustive per-field audit on the live FMP RE HUB project (`verify-module6-field-census.ts`). About 11 existing-operations inputs are EMPIRICALLY inert, an override changes nothing in the full financials + returns snapshot:

- `phases[id=*].historicalBaseline.*` (currentAdr, historicalDebtDrawn, historicalCapexTotal, currentDebtOutstanding, last12MonthsRevenue, last12MonthsOpex, netBookValueFixedAssets, historicalEquityContributed, cumulativeDepreciationCharged)
- `assets[id=*].historicalPreCapex`
- `assets[id=*].historicalDebtAmount`

This is notable because the live project DOES show a Total Financing Cost of ~820M and a finite Min DSCR, i.e. debt is being serviced, yet perturbing the historical debt / capex / baseline inputs moves NO computed output. So either (a) existing-operations debt/equity/baseline is meant to seed the base model and is being silently dropped on the path `computeFinancialsSnapshot → computeReturnsSnapshot`, or (b) these are legacy fields superseded by another input and should be removed. The audit currently DROPS them from the Module 6 picker with the reason "existing-operations baseline input; not consumed by the scenario compute pipeline (audit finding)", so they are not silent dead levers in the grid, but the underlying engine question is unanswered.

Needs a SEPARATE engine-level investigation (not a Module 6 change). Do NOT alter the historical/operational baseline wiring silently; confirm intended behaviour first. Operational-phase fixture required (FMP RE HUB phase_1 is operational, so it reproduces).

---

## RESOLVED BY DELETION, the RESEND_WEBHOOK_SECRET rename (closed 2026-07-31)

This was a bookmarked plan to rename `RESEND_WEBHOOK_SECRET` to `EMAIL_BRIDGE_BEARER_SECRET`, on the premise that the variable had ONE live use: the bearer token for `POST /api/email/send`, "the Google Apps Script email bridge".

**The premise was wrong, and the rename was never needed.** Diagnosis on 2026-07-31 established that the endpoint had no caller at all:

- Zero callers anywhere in the tree. Nothing imports the route; no client, server, or cron call exists.
- All 8 templates it served already had native in-app senders through `sendEmail` (Brevo). The 8th, `accountConfirmation`, had no caller at all and was superseded by `confirmEmailTemplate`.
- `CLAUDE-FEATURES.md` recorded, at the Brevo migration itself (commit `166a8ecb`, 2026-05-11), that the last three Apps Script email triggers had been moved into Next.js and the bridge was "kept for backwards compat". It was a compatibility shim, not a dependency.
- Apps Script handles exam questions only; it does not send platform email. Our own Apps Script client is outbound-only.
- `RESEND_WEBHOOK_SECRET` was never set in Vercel, so the `if (secret)` gate never ran: the endpoint accepted unauthenticated requests in production and would render any of 8 branded templates, to any recipient, with caller-supplied data. That is phishing-grade, from a domain that passes SPF and DKIM.

**Action taken instead of the rename:** the route, the orphaned template, the dead `resendRegistrationId()` Apps Script helper, and the env var were all DELETED. Renaming would have hardened a stale name around an endpoint that should not exist. Nothing to carry forward.

Standing lesson: a "live dependency" recorded in a commit message is an assertion, not evidence. This one was inherited across two sessions and a Resend purge before anyone tested it.

---

## In Progress

| Feature | Current State | What Remains |
|---------|--------------|--------------|
| **AI Agents** | Market rates + research agents wired | Contextual help agent (stub only) |
| **Pricing / Subscriptions** | **LIVE (paid tiers shipped).** The plan/entitlement + payment system is built and enforced: admin Plan Builder (`entitlement_plans` + `plan_permissions` + `features_registry` + `user_permissions`, migs 158-168), the live REFM gate (`resolveUserGate` + `gate.ts`) enforcing modules/exports/scenarios/versioning/branding/project cap/trial + grace-lapse, unified pricing pages (`/pricing/<segment>`), and the Paddle billing system (adapter + webhook + in-dashboard billing tab + upgrade/downgrade + cancel + convert-to-manual + manual invoices + revenue ledger + subscription lifecycle emails, migs 170-183). See CLAUDE.md (Entitlements / Subscription-management / Post-expiry-grace / Subscription-email sections) + CLAUDE-DB.md for detail. | Backlog: Brevo engagement webhook (open/click/bounce) to replace the removed Resend webhook; wire the server Paddle API key in Admin>Payments to light up live Paddle-side flows (founder task). |
| **Branding** | Brand Colors section moved into `/admin/header-settings` (2026-04-28, commit `ab5db30`). `/admin/branding` is a 5-line redirect. Drives `--color-primary` / `--color-secondary` via `BrandingThemeApplier`. | None, Header Settings owns brand colors + logos + favicon + header text + header layout in one place; Page Builder owns page copy. |

---

## REFM Module Status (2026-06-17)

Current LIVE status. For per-pass narrative see [CLAUDE-REFM.md](CLAUDE-REFM.md) + memory `project_*` files.

| Module | Name | Status |
|--------|------|--------|
| Module 1 | Project Setup / Costs / Financing | **LOCKED** at M2.0 Pass 58 (base). Funding Methods 2 + 3 calculate + gap-size the drawdown (2026-06-01); Funding Gap + Cash Sweep + Dividend waterfall live. |
| Module 2 | Revenue + CoS + Schedules + Escrow | **LOCKED** at Pass 9N. |
| Module 3 | Operating Expenses | **LOCKED** at Pass 5d. |
| Module 4 | Financial Statements | **DONE.** Schedules / P&L / CF / BS. Balances by construction (BS reconciles AND Direct == Indirect closing cash every period). |
| Module 5 | Returns & Valuation | **DONE.** IRR/MOIC on FCFF/FCFE/Dividends + terminal value + RE metrics + multi-partner returns + exit / sensitivity / per-asset. Tabs: Returns / RE Metrics / Case Comparison. |
| Module 6 | Scenario Analysis | **DONE (grid 2026-06-15, b9281cae).** Surface over the case engine: case list, multi-case **assumptions grid** (rows grouped by category with plain-English labels + asset/phase/facility attribution, columns = every case incl. an editable Management; curated key-driver default + "show all" toggle + add-row picker), comparison matrix, and a **Year-on-Year Impact tab** (per-period divergence per case; debt/equity split deduped to one block; drawdown is principal, excludes IDC). Construction levers are MODEL-AWARE: per-asset `costOverrides` win over the phase-level master (real rates, not 0/stale seed), zero/unused dropped. Percent-scale detection per field (fractions 0-1 vs whole 0-100) renders all percents at 2dp; rates/prices accounting. Exhaustively field-audited on the live project (`verify-module6-field-census`). Only the construction-timeline override stays on the backlog. |
| Module 7 | Reports & Visualizations | Stub (next module surface). |

**Cases (scenario management), shipped 2026-06-03:** Management Case = base; Downside + Upside are field-override cases (renamable, add custom). Topbar Case switcher + Returns Case Comparison tab. Engine `lib/cases/applyOverrides.ts` (merge) + `lib/cases/assumptionGrid.ts` (grid labels / categories / curated set), verify-cases 35/35. See the NEXT SESSION block above for follow-ups.

## Remaining backlog

**Module 1 financing:**
- Funding Method 2 (Net Funding Requirement) + Method 3 (Cash Deficit Funding) — display-only Funding Gap sub-tab live; wire Net Cash Required output into actual debt drawdown sizing.
- True per-asset financing schedule breakdown across multi-asset phases.
- DSCR breach alerts (M5 dependency).
- Sharia Murabaha / Ijara product templates, multi-currency, refinancing flows.

**Module 4 financial statements (remaining, non-blocking — BS balances + CF methods tie):**
- **D-2** per-asset (phase-filtered) CF revenue ignores DSO (project-level CF correct).
- **D-3** Cash Sweep interest savings full P&L mutation (ships memo-only; BS balances under sweep without it).
- **D-6** P&L + CF phase-filter column (UI parity with BS).
- Per-asset capex non-uniform spread within construction windows (project totals stay exact via financing engine).
- PIT-handover recognition recognises post-handover cohorts at handover (Unearned can go briefly negative); M4 mirrors Module 2 exactly, statements still balance. Optional Module 2 recognition tweak to defer later cohorts.
- ~~BS imbalance / manual reconciliation against reference~~ **RESOLVED 2026-05-25** (escrow + recognition root causes; balances by construction).

**Module 5 returns:**
- Equity waterfall + IRR hurdle math.
- Cash-sweep with full operating cashflow (capex-only proxy ships today as Method 4 placeholder).

**Module 6 scenarios:**
- **Construction-timeline overrides** (future unit, deferred 2026-06-15): let a scenario override construction duration / start delay (`phases[id=X].constructionPeriods` / `constructionStart` / `startDate`). These are scalar phase fields that round-trip the grammar, but a value-only override is INSUFFICIENT: the engine reads them to derive the period axis + handover, while the per-phase `byPhase` revenue / opex / occupancy arrays and each cost line's baked `startPeriod` / `endPeriod` are stored separately and do NOT move with the scalar (the phase-date cascade was deliberately disabled). Needs a cascade-on-override that re-windows the `byPhase` arrays and recomputes cost-line start/end periods, then recomputes on the corrected axis. Engine/grammar work. Until then the curated levers stay value-only (construction cost rates, contingency %, etc., which DO round-trip cleanly).

**Cross-module:**
- Excel + PDF exports rebuilt against the locked v8 schema.
- Project type-bank presets ("Saudi mixed-use", "Branded residences", "Hotel-led resort") seeded into Tab 2.
- Playwright e2e for the per-asset Costs Inputs surface.

---

## Not Started, Modeling Platforms

| Platform | Slug |
|----------|------|
| Business Valuation Modeling | `bvm` |
| FP&A Modeling Platform | `fpa` |
| Equity Research Modeling | `erm` |
| Project Finance Modeling | `pfm` |
| LBO Modeling Platform | `lbo` |
| Corporate Finance Modeling | `cfm` |
| Energy & Utilities Modeling | `eum` |
| Startup & Venture Modeling | `svm` |
| Banking & Credit Modeling | `bcm` |

All have config in `src/config/platforms.ts` + corresponding rows in `platform_modules` admin table. No platform content yet. When a platform starts active development, create `CLAUDE-{slug}.md` per the per-platform MD convention (see CLAUDE-MODELING-HUB.md).

---

## Legacy Reference

`_legacy_backup/js/refm-platform.js`, 7,599-line original CDN implementation.
- AppRoot: lines 1-70 | State: 72-200 | Calculations: 200-900
- Excel export: 900-1,900 | Project Manager UI: 1,900-3,800
- Main render: 3,800-5,700 | Module 1 UI: 5,700-7,520 | Stubs: 7,520-7,598
