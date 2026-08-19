# TRAPS

**The hard-won lessons. Read this before debugging anything that "should work".**

Every entry below cost real time to find, and most of them share one property: **the
broken thing reported success.** A grep returned nothing, a check passed, a constraint
did not fire, a column silently did not apply, a deploy silently did not happen. That
is why they are collected here rather than left in the session narrative that produced
them: the failure mode is invisible, so the only defence is having read about it.

Format is the same throughout: **Symptom** (what you will see), **Mechanism** (why),
**Fix** (what to do instead), **Proof** (the measurement that established it, so a
future session can re-run it rather than re-derive it).

Nothing here is deleted when it gets old. A trap that has not bitten in a year is not
obsolete, it is dormant.

---

## 1. Shell, encoding and generated code

### 1.1 Never transform a source file with a PowerShell text round-trip

**Symptom.** A three-line change produces a 50-insertion / 42-deletion diff. Comment
banners and symbols turn to mojibake: a multiplication sign and box-drawing characters each
come back as two or three Latin-1 characters (the classic double-encoding signature, a capital
A or a lowercase a with a diacritic followed by punctuation).

**Mechanism.** `(Get-Content f -Raw) -replace ... | Set-Content f -Encoding utf8` adds a
UTF-8 BOM and **double-encodes every non-ASCII character**. The file still parses.

**Fix.** Use the Edit tool, including for a repeated mechanical replace (`replace_all: true`).
It preserves encoding.

**Proof.** Measured 2026-08-16 on `src/core/calculations/index.ts` (2,400 lines), adding one
key to three `byStage` initialisers. **`tsc` did NOT catch it** and no behavioural verifier
did either, because the corruption lives in comments and strings. Only
`verify-no-em-dash-content` caught it, and only incidentally, because mojibake of an em dash
matches what it greps for. After any bulk edit, check `git diff --numstat` against the number
of lines you meant to change.

### 1.2 Inline `node -e` and heredocs eat backslashes

**Symptom.** A patch script runs, reports plausible failures, and matches nothing. The
instinct is to go debug the thing being tested rather than the test.

**Mechanism.** The shell strips backslashes before the code is parsed, so `/\s+/` becomes
`/s+/` (a literal "s"), `/^Tab \d+:/` becomes `/^Tab d+:/`, and a `\uE081` PUA map key vanishes entirely, leaving `{ "": "(" }`.
The resulting code **parses and runs**.

**Fix.** Write the patch script to a FILE and run it. Where a literal backslash is
unavoidable, build it with `String.fromCharCode(92)`. Always re-read the generated line
before trusting a result.

**Proof.** Cost time three separate times in the 2026-08-12 PDF export review. The `/s+/`
case failed seven verifier checks against a document that was correct.

### 1.3 CRLF makes a diff report total divergence

**Symptom.** Two fingerprint captures diff as one enormous hunk (`1,82090c1,82118`), which
reads as complete divergence.

**Mechanism.** The working tree is CRLF. One capture lands CRLF, another LF. Git Bash
`cat -A` does **not** show the `^M`, so nothing looks wrong. The same trap breaks a
`\n`-anchored patch, which matches nothing while looking correct.

**Fix.** `sed 's/\r//g'` on BOTH sides before comparing. Compare structured cell lines
(sorted) separately from PDF text lines (in order), since sorting mixes whitespace-led PDF
lines unstably.

---

## 2. Database and Supabase

### 2.1 PostgREST silently truncates at 1000 rows

**Symptom.** A count looks plausible and is wrong. The MISSING rows are the oldest, which is
exactly the slice a user needs for historical recovery.

**Mechanism.** PostgREST's default `max-rows` is **1000**. A `.select(...).order(...)` with no
`.range()` truncates with **no error and no header indicator**. On a DESC-ordered query (the
common newest-first case) the dropped rows are the oldest.

**Fix.** Any read from a table that can exceed ~500 rows uses explicit `.range(from, to)`
pagination in pages of 1000, walking until a short page, with a hard cap. Codified as
`listVersionsPaginated` in `src/hubs/modeling/platforms/refm/lib/persistence/server.ts`.

**Proof.** 2026-05-31: a project had **1371 versions**; the user needed a pre-May-30 version to
recover from a data-corruption bug and those were in the oldest 371 rows, all silently dropped.
It recurred in the 2026-08-16 downward-selection audit, which reported 1002 versions when
FMP RE HUB alone has 1398. **If your query result equals the cap, the cap IS your answer.**

### 2.2 A "PENDING apply" flag in prose is not evidence

**Symptom.** CLAUDE-DB.md says a migration is pending; CLAUDE.md says it is applied. Both are
prose and neither is checked.

**Mechanism.** The marker records the INTENT to apply. Nobody clears it after applying, and
nothing verifies it, so it decays silently. It is wrong in both directions: a false PENDING
invites a duplicate apply, a false APPLIED hides a missing column until production 500s.

**Fix.** Probe the live schema: `npx tsx --env-file=.env.local scripts/audit-migration-flags.ts`.
Flag a new migration PENDING and clear the flag in the SAME session you apply it.

**Proof.** 2026-08-16: all **eleven** PENDING markers in CLAUDE-DB.md (170-189) plus a head note
calling 212 unapplied were wrong; every object was already present. Two method notes that made
the audit trustworthy: probe a **control group** of migrations recorded APPLIED (15 were, all
correct) or you cannot find the dangerous direction; and **a failing probe is more likely a wrong
probe than a real finding** (mig 185 first reported NOT APPLIED because the table was guessed as
`reviewed_models`; it is `model_submissions`).

### 2.3 A Postgres CHECK constraint PASSES on NULL

**Symptom.** A constraint that looks right accepts exactly the row it was written to reject.

**Mechanism.** `array_length(arr, 1)` returns **NULL** on an empty array. `NULL >= 1` is NULL,
and a CHECK constraint only rejects an explicit FALSE. So `CHECK (array_length(grounding,1) >= 1)`
was a silent no-op.

**Fix.** Use **`cardinality()`** for any non-empty-array constraint. Drop a dead constraint by
DEFINITION (`pg_get_constraintdef ILIKE`), not by its auto-generated name.

**Proof.** A live `INSERT ... '{}'` was accepted (mig 203, fixed by 204). **The verifier missed it
because it asserted the constraint's TEXT via a regex over the .sql file.** See 10.1.

### 2.4 An errored query returns an empty fallback that reads as real data

**Symptom.** "The table has zero rows", reported confidently, when it is fully populated.

**Mechanism.** The probe selected a column named `enabled`; the column is `fund_enabled`. The
query **errored**, the code fell back to empty, and the empty result was reported without
checking `error`.

**Fix.** Check `error` before believing `data`. An empty result and a failed query are different
answers and must never share a code path.

**Proof.** 2026-08-10: `refm_fund_terms` was reported as having zero rows. It carried a fully
populated row written 2026-08-05. The correction is preserved in CLAUDE.md deliberately.

### 2.5 `admin_audit_log.admin_id` is NOT NULL

**Symptom.** An audit write from an unauthenticated caller turns a 401 into a 500.

**Mechanism.** There is no admin to attribute the row to, and the column rejects NULL. The table
also has no `metadata` column.

**Fix.** Unauthenticated rejections go to `public_api_audit` (mig 212), a separate table. Keep the
audit write best-effort so a logging failure never changes a response code.

**Proof.** A live insert probe failed with the not-null violation.

### 2.6 New columns must tolerate being absent

**Symptom.** A feature works locally and 500s in production.

**Mechanism.** Prod schema lags the repo between deploy and manual apply.

**Fix.** Every read of a new column is schema-tolerant, with a defined meaning for absent
(`include_in_pdf` absent means true; fund-terms probes step down 211 -> 210 -> 209 -> 208).

### 2.7 Hosted Supabase MCP OAuth does not work here

Use env service-role credentials via `npx tsx --env-file=.env.local`. Do not retry OAuth.

### 2.8 A schema-tolerant fallback can resurrect a retired secret

**Symptom.** None. That is the point: a credential someone deliberately revoked starts working again
and nothing anywhere says so.

**Mechanism.** 2.6 says a new table must tolerate being absent, and the partner feed key does exactly
that: no `public_api_keys` row means fall back to `FMP_PUBLIC_API_KEY`. Applied naively, three states
collapse into that fallback and each one is a live hole. **A retired-only history** (rotate, then
retire the new key) has no active row, so a naive resolver reads it as "no key configured" and
re-accepts the environment value the rotation superseded. **An errored read** (2.4 again, in its most
expensive form) returns an empty list, which is also "no rows". And an in-memory cache of the active
key keeps a retired key working on a warm serverless instance for the length of its TTL.

**Fix.** The fallback is gated on **no row at all**, not on "no active row": once anything has been
issued for that key id, the environment is dead forever, and retiring the last key CLOSES the
endpoint. A read error is distinguished from a missing table by PostgREST code (`42P01`, `PGRST205`)
and refuses instead of falling back. No cache; the route pays one indexed read per request, which it
can afford at 60 rpm per IP. **Proven** by `verify-api-key-rotation` against the live database, and
by sabotage: making the retired-only branch fall back to the environment fails 3 checks, and letting
the environment win over an active row fails 7.

---

## 3. Excel export (ExcelJS)

### 3.1 A column width of exactly 9 silently does not apply

**Symptom.** You set a column width, nothing changes, and there is no error.

**Mechanism.** ExcelJS `isCustomWidth` is `width !== DEFAULT_COLUMN_WIDTH`, and that constant is
**9**. A column set to exactly 9 is dropped from `<cols>` entirely.

**Fix.** Never use 9. The verifier asserts `>= 8 && !== 9`.

**Proof.** The first attempt at widening the fee-basis Rate column used 9 and did nothing.

### 3.2 `spliceRows` does not move merged ranges

**Symptom.** The workbook is corrupt and Excel refuses it or repairs it.

**Mechanism.** ExcelJS `spliceRows` shifts values and styles but leaves merged ranges pointing at
the old rows.

**Fix.** `insertRowsAt(ws, at, count)` in `excel/styles.ts`: unmerge all, splice, re-merge shifted,
then rewrite same-sheet hyperlink targets.

### 3.3 ExcelJS 4.4 has no chart API

`worksheet.addChart` is **undefined**. A native chart is not possible. The Timeline Gantt uses
coloured cells as the deliberate fallback.

### 3.4 Section-registration order is load-bearing

**Mechanism.** `applyTabGuides` -> `applyTabSubToc` (both re-base `sectionReg`) -> Cover/Guide
**last**. Every section link is an `!A<row>` anchor, so a later row insert invalidates earlier
anchors unless the Cover is written after all of them.

**Corollary (tried and reverted).** Registering the Summary tab's front-matter bands as sections
broke the anchor invariant workbook-wide, because an anchor requires column A to hold the title
and a front-matter canvas keeps column A as a margin.

### 3.5 Hyperlink cells stringify to `[object Object]`

**Symptom.** A scan reports a Cover entry is missing when it is present.

**Mechanism.** A hyperlink cell holds `{text, hyperlink}`, not a string.

**Proof.** The 2026-08-11 review first reported zero fund entries on the Cover. They were already
there.

### 3.6 A label built from the value format prints a raw float

**Symptom.** A workbook label reads `1.00% of Fund size 154519446.40625`.

**Mechanism.** The Excel P&L passes `fmt: String(v)` so a `totalOverride` round-trips as a number,
and the fee label reused that same `fmt`. The PDF was correct because it passes `fmt.money`.

**Fix.** `M4ReportCtx.labelFmt`, defaulting to `fmt`. Separately, `labelMoney` must follow
`displayScale`: it was hardcoded to millions, so a full-unit export read "2,632.7 m" beside a cell
of 13,163,667.

### 3.7 A base is a STOCK, not a flow

**Symptom.** An annual fee's basis prints 36,858.3m against a 5,466.8m fund size.

**Mechanism.** The Total column summed a per-period base across 14 periods.

**Fix.** `FundFeeBasisRow.basisDisplay` + `basisIsPerPeriod` encode the rule once; text surfaces
render "2,632.7 x 14", Excel keeps a plain number in the cell and puts the period count in the label.
Related: "Total" means a lifetime sum on the P&L but a CLOSING balance on the balance sheet, which
is why the heading is derived via `M4Row.totalIsBalance` + `resolveTotalColumnKind`.

---

## 4. PDF export (pdf-lib)

### 4.1 PDF text is glyph ids, so a naive grep returns nothing

**Symptom.** You grep the PDF for a label you can see on the page and get zero hits. A whole
diagnosis pass concludes the content is missing.

**Mechanism.** pdf-lib embeds Inter through fontkit as a **CID font**, so drawn text lands in the
content stream as hex GLYPH IDS, not literals.

**Fix.** `scripts/pdfTextExtract.ts` maps glyph ids back through the embedded font. Use it; never
grep a PDF directly.

**Proof.** The first diagnosis pass of the fund PDF work did exactly this and was worthless.

### 4.2 Decoding drops every parenthesis unless PUA codepoints are mapped back

**Symptom.** Accounting negatives `(4,507.6)` decode as positives `4,507.6`, so a correct document
reports a sign error.

**Mechanism.** Inter substitutes CASE-ALTERNATE forms for `( ) [ ] - :` beside digits or capitals,
and `glyphForCodePoint` resolves those to PRIVATE USE codepoints:

    U+E081 = (   U+E082 = )   U+E083 = [   U+E084 = ]   U+E088 = -   U+E092 = :

**Fix.** Normalise `[\uE000-\uF8FF]` through that map before matching. Every verifier added in the
2026-08-12 review does, and so must anything new.

**Proof.** The first pass of that review reported a sign error in the summary P&L **that did not
exist**. The extractor had eaten the brackets.

### 4.3 A shared builder change does nothing if the renderer hardcodes the value

**Symptom.** You fix the builder, the verifier for the builder passes, and the document is unchanged.

**Mechanism.** `drawPeriodTable` had hardcoded the literal `'Total'` and ignored `table.columns[1]`.

**Fix.** Check the renderer actually reads what the builder emits. `resolveMetrics` also had to start
measuring the HEADING as column content once it stopped being a fixed 5-character word.

---

## 5. Comparing exports and proving "nothing changed"

### 5.1 The real project is not a stable baseline

**Symptom.** A before/after fingerprint differs across Capex, Revenue, Schedules, Financing and
Balance Sheet, and even asset NAMES change. It reads exactly like an engine regression from your
own work.

**Mechanism.** The Edit choice includes "edit this version in place" (`startEditInPlace`), which
UPDATES the existing `refm_project_versions` row and leaves `created_at` unchanged. The user edits
the project mid-session. **The version list is useless as a tripwire: same label, same `created_at`,
different snapshot.**

**Fix.** Capture every identity proof against `scripts/excelSampleState.buildExcelSampleState`. The
fixture is the controlled experiment; the real project only answers "does it run and look right
today". Two consecutive runs agreeing proves determinism of the CODE, not stability of the DATA, so
it does not rescue you.

**Proof.** 2026-08-11. "Branded Apartments" became "Branded Apartments T2 & T3" mid-session.

### 5.2 A substring probe matches the wrong phrase

**Symptom.** A check reports a feature present when it is absent.

**Mechanism.** A probe for `gross)` matched `Advance received from customer (gross)`.

**Fix.** Anchor probes on a full label, not a fragment that can appear inside an unrelated one.

---

## 6. REFM UI shell

### 6.1 The shell is zoomed, so `vh` and media queries LIE inside it

**Symptom.** A full-height surface leaves ~345px of dead space, worsening on taller screens. A
breakpoint fires at the wrong physical size.

**Mechanism.** `RealEstatePlatform.tsx` renders everything inside
`height: calc(100vh / 0.8); width: calc(100vw / 0.8); zoom: 0.8`. CSS `zoom` does **not** rescale
`vh`/`vw` or viewport media queries, so the shell's coordinate space is **1.25x** the real viewport.
A 1536px viewport is 1920 CSS px inside the shell.

**Fix.** Size full-height surfaces with `height: 100%` and a flex-column ancestor
(`minHeight: 0` + child `flex: 1`), gated on the specific module so other modules keep block flow.
For breakpoints, measure the element with a ResizeObserver, never `@media`.

### 6.2 Drag and resize use pointer capture, never window listeners

**Symptom.** A gesture does nothing at all. No error.

**Mechanism.** M7's EditLayer added window listeners on pointer-down and removed them in
`useEffect(() => () => {...}, [onPointerMove, endGesture])`. Both deps changed identity every render
(they closed over a freshly filtered array), so the "unmount cleanup" ran on EVERY render. Since
`onGestureStart` pushes undo history (a setState), the first re-render after pointer-down removed
the listeners pointer-down had just added.

**Fix.** `setPointerCapture` + React `onPointerMove`/`onPointerUp`/`onPointerCancel`. There is no
listener identity to go stale, so the failure mode cannot recur. Do **not** `preventDefault()` on
pointerdown (it suppresses the compatibility mouse events `dblclick` inline editing needs); use
`touchAction: 'none'` + `userSelect: 'none'`. **An effect cleanup with non-empty deps is not
unmount-only.**

**Proof.** Shipped broken and unnoticed for ~10 days (fixed 2026-07-27, `2af77c34`). **Pure
verifiers cannot see this class of bug.** A temporary Next page mounting the real component plus a
Playwright drag, run BEFORE and AFTER, proved both. Wait for hydration (`__reactProps` on the node),
not `waitForSelector`: SSR markup exists before handlers attach. Note `app/_folder` is a PRIVATE
folder in the App Router (404), so name a temp harness route without the underscore.

---

## 7. Engine and model

### 7.1 A zero-valued seed hides a whole code path

**Symptom.** A crash that only appears when a user enters a non-zero number.

**Mechanism.** The seeded rate is zero and `computeAssetCost` skips zero-total lines, so an
unguarded bucket increment was never reached in any fixture.

**Fix.** Seed a fixture with a non-zero value for every new line kind, or the path is untested.

### 7.2 Blanking a default silently satisfies validators

**General lesson: when you blank a default, check every validator that was silently satisfied by
the old value.** The old value was doing work nobody had written down.

### 7.3 A stage list written as a literal defeats exhaustiveness

**Symptom.** A `TypeError` at runtime after adding a member to an enum-like union.

**Mechanism.** Only sites typed `Record<CostStage, number>` are compiler-guarded. A literal array
with an `as` cast asserts exhaustiveness the compiler never checks.

**Fix.** Derive every stage list from `COST_STAGES`. Never write the members out with a cast.

### 7.4 The fee-free pass must call the SOLVER, not the public entry

Otherwise it re-enters the fund branch and never terminates.

### 7.5 Compare two RUNS, not two fields

**Symptom.** `ebitdaBeforeFundFeesPerPeriod` (5,021.992m) does not equal the fund-off EBITDA
(5,053.947m), a 31.956m gap that reads as a circularity breach.

**Mechanism.** It is not one. The fee raises funding, which capitalises +35.212m of IDC into
Sell-asset inventory, which releases +31.956m to cost of sales. Fees are exactly 1,047.144m either
way.

**Fix.** To ask "what did the fund layer change", run the model twice and diff. Do not diff two
fields inside one run.

### 7.6 A downward reference read a real number

**Symptom.** A base is wrong rather than zero, so nothing looks broken.

**Mechanism.** In the three-pass cost resolution, a `percent_of_selected` line referring DOWNWARD to
a DIRECT-method line read a populated `directTotals` value (measured **150 vs 100**), while one
referring to another percent line read zero.

**Fix.** The positional rule (a line charges only on lines above it) is enforced in the ENGINE, not
only the picker. **A wrong-but-plausible number is more dangerous than a zero.**

### 7.7 A default parameter is a defect waiting for one caller to forget

**Symptom.** Every project created through the wizard seeded its cost lines running periods
**1 to 25** whatever construction length the user typed. Reported from the screen, never by a check.

**Mechanism.** `makeDefaultCostLines(phaseId, constructionPeriods = 24, ...)`. The store and the
hydrate-time seeder both passed the phase's real length; `buildWizardSnapshot` called
`makeBlankCostLines(p.id)` and the default of 24 applied. One caller out of three, and the
default made the omission invisible: no type error, no runtime error, a plausible number.

**Fix.** For a value that MUST come from the model, prefer a required parameter. Where a default
stays, a verifier should exercise the real caller (`buildWizardSnapshot`), not just the function.

**Proof.** Measured 2026-08-17 on the live project: two phases of 4 and 3 periods, 24 seeded lines,
every one of them 1 to 25. `verify-capex-structure` section C now drives the wizard itself.

### 7.8 The damage gets migrated too, so fingerprint the defect BEFORE the chain runs

**Symptom.** A repair for the 1-to-25 windows above fired on zero lines, on a project visibly
carrying the defect.

**Mechanism.** By the time it ran, the existing chain had already rewritten the numbers: Pass 8
Fix 5 clamps any `endPeriod` above `maxCp + 1` **across the project**, and `T3ClampStartEnd` then
lifts an end that has fallen below its start. So a stale `1 to 25` was already `1 to 5`, `12 to 25`
was `12 to 12`, and one row was `12 to 5`, which renders as an invalid window.

**Fix.** Run a repair on the RAW snapshot, before the migration chain, and recognise the clamped
shape as well (it is a pure function of numbers the snapshot already carries). Anything else is
fingerprinting the damage rather than the defect.

**Proof.** 2026-08-17: 0 lines repaired when it ran last in the chain; 8 lines when it ran first,
with the other phase's hand-set windows untouched.

### 7.27 One index answering two rules, and the fixture that could not tell them apart

**Symptom.** Depreciation was charged in the LAST YEAR OF CONSTRUCTION, before the asset existed to
be used. Reported by a user. Measured: 5.791m in 2030 on FMP - MARINA GATE (operations start 2031)
and 14.294m in 2029 on FMP RE HUB.

**Mechanism.** `fixed-assets-resolvers.ts` computed

    const handoverIdx = Math.max(0, Math.min(N - 1, offset + cp - 1));

and handed it to the depreciation engine as `startIdx`. `offset + cp - 1` is a real and correct
index: it is the M2 PIT REVENUE-RECOGNITION handover, deliberate and pinned by verifiers A2-1..A2-5.
It answers "when is the unit handed to the buyer". It was reused to answer "when may the asset be
depreciated", which is a different question with a different answer: when the asset is AVAILABLE FOR
USE, i.e. `offset + cp`.

Nothing was wrong with the index. What was wrong was one index answering two rules, and the variable
name (`handoverIdx`) described the rule it came from rather than the rule it was being used for, so
the mismatch was invisible at the call site.

**The clamp made it worse, quietly.** `Math.max(0, ...)` turned a `cp = 0` phase's `-1` into index 0,
a guess wearing the costume of an answer, and `Math.min(N - 1, ...)` would start a year of
depreciation in the final period for an asset whose operations begin beyond the axis. Both are gone:
`Math.max(0, offset + cp)` is right for `cp = 0`, and the engine already returns all zeros for a start
index past the axis end.

**Why 82 checks missed it.** Every resolver fixture in `verify-fixed-assets` was an EXISTING asset
with opening NBV and `cp = 0`. Under `cp = 0` the old rule clamps `-1` to `0` and the new rule gives
`0`: the two agree exactly, on every fixture in the file. The verifier had teeth and no reach.

**IT SURVIVED ITS FIRST FIX, and that is the part worth remembering.** There were TWO hand-rolled
copies: the fixed-asset resolver AND the IDC depreciation block, which depreciates the interest
capitalised into the asset. Fixing the first left the second charging a full year during
construction (0.654m on FMP - MARINA GATE, 0.076m on FMP RE HUB), small enough to look like
nothing and wrong all the same, and the user reported it again. Worse, the measurement script read
only the fixed-asset stream, so it printed "none" while the defect was still live: a measurement
blind to half the quantity is worse than no measurement. Both now call one shared
`operationsStartIndex`, and the script reads the per-asset P&L D&A, which is the sum of both.

**And the shared helper was wrong on its first attempt too.** The obvious implementation reads
`computePhaseTimeline().operationsStart` and differences the YEARS. `computePhaseTimeline` defaults
to MONTHLY when `project.modelType` is absent, so a four-period construction resolved to four
MONTHS and the index collapsed to zero. The verifier fixture caught it before it shipped. The rule
now works in PERIODS (`offset + cp - overlap`, or `offset` when `cp === 0`), the same unit every
caller already holds, which also handles `overlapPeriods` that a plain `offset + cp` gets wrong.

**Lesson.** When you reuse an index, name it for the rule it is SERVING, not the rule it came from.
`handoverIdx` passed as `startIdx` reads as correct; `operationsStartIdx` passed as `startIdx` reads
as correct AND is checkable. And when a fixture set makes two candidate rules produce the same
answer, it cannot distinguish them however many assertions it contains: add the shape where they
differ, which here was simply an asset that is actually built.

**A conservation note worth keeping.** Fixing it REDUCED lifetime depreciation charged (52.121m to
46.329m, 1,613.235m to 1,598.941m) because a vintage already running past the axis end loses one more
year off the end. That is not value lost. Closing NBV rises by the same amount to the cent, and the
balance sheet still closes at 0.00. Measure both sides before calling a reduction a defect.

---

### 7.26 One flag standing for two inputs turns a true reason into a wrong conclusion

**Symptom.** After the percent-of-revenue BASE was linked to the revenue module, the financing
aggregate and the per-asset Cash Flow reported different capex: 432,082,531.35 against
431,585,397.11 on FMP - MARINA GATE, a **497,134.24** divergence, and 1,625.87 on FMP RE HUB.

**Mechanism.** `computeAssetCost` has eleven call sites and `verify-capex-collections` already
carried a REGISTRY of them, each with a `wired` flag and a written reason, plus a check that a new
unregistered site fails. A good guard. But `wired` meant one thing, "passes the collections series",
and the collections series drives PHASING. The new revenue bases drive the AMOUNT. Two different
inputs, one flag.

So `revenue-resolvers.ts` sat in the registry as:

    { file: '...revenue-resolvers.ts', wired: false,
      why: 'computeAssetCapex reads .total only, and phasing cannot move a total' }

Every word of that reason is TRUE. A total is a sum, phasing redistributes within the sum, so
omitting the phasing series genuinely cannot change the answer. And it was read as permission to omit
the new bases too, which change the total by over a million. The registry was consulted, the reason
was correct, and the conclusion was wrong.

**Fix.** The registry carries TWO dimensions, `wired` (collections) and `bases` (revenue bases),
each with its own per-call argument scanner and its own assertion. `revenue-resolvers.ts` is now
`wired: false, bases: true`, which is the honest description.

**Lesson.** A registry entry's reason is scoped to the thing it was written about. When a function
gains a NEW input, do not reuse the existing flag: a reason that justified omitting input A will be
read as justifying omitting input B, and it will read as reasonable because it IS reasonable, about A.
Add the dimension, and re-derive every entry's answer for it rather than inheriting.

The general form: **a boolean that answers "is this site correct" is only as good as the number of
ways a site can be wrong.** When the count goes up, the boolean is no longer a guard, it is a
comforting label.

---

### 7.25 Two identity rules for one entity, and the second one is the one you wrote

**Symptom.** A Marketing line, scoped the day before to selling assets only, kept charging a leased
asset. Reported as "marketing still applied on retail". Measured live: 119,700 on Podium Retail.

**Mechanism.** A cost line's catalog identity has ONE resolver, `resolveCatalogId`, and its
precedence is `catalogId` first, then the base id. The new scope rule did not call it; it resolved
identity itself, from `deriveLineBaseId(line.id)` alone. Those agree on a SEEDED line
(`commission__phase_2` has base id `commission`) and disagree on a line added from the CATALOG
PICKER, which mints `custom-<timestamp>__<phase>` and carries the identity in `catalogId`. The live
project had one of each, so half the rule worked and the half the user was looking at did not.

**Why it survived a verifier with sabotage-proven teeth.** The fixture used seeded ids exclusively,
so both resolvers agreed on every line in it. The verifier had 44 checks and two proven sabotages and
could not see the defect, because the defect lives in a SHAPE the fixture did not contain.

**Fix.** One implementation. `deriveAssetScope` moved into `selectedBase.ts`, calls
`resolveCatalogId`, and `index.ts` re-exports it. The private copy in `selectedBase.ts` (written to
dodge an import cycle that does not exist) is deleted rather than pinned equal to the other.

**Lesson.** When adding a rule that keys off an entity's identity, CALL the existing identity
resolver; do not re-derive identity, even from something as innocent as an id prefix. And when a
fixture only contains one of the shapes a real project produces, the verifier's teeth are real but
its coverage is not: add the awkward shape as a permanent case, then prove it bites by reverting the
fix, not by mutating the fixture. A "sabotage" that changes the fixture into a shape the fixed code
handles correctly passes and proves nothing.

---

### 7.24 A basis that sums three incompatible products is wrong for two of them, and reads as merely small

**Symptom.** A marketing cost at a percentage of revenue charged almost nothing on a hotel and a
fifth of what was expected on a leased retail unit. Reported as "the marketing amount value is not
correct".

**Mechanism.** `computeAssetRevenue` is the basis every percent-of-revenue cost method charges on,
and it sums `metricValue x unitPrice` across the Sellable, Operable AND Leasable sub-units. Those
three products are not the same kind of number:

| category | the product | what it actually is |
| --- | --- | --- |
| Sellable | area x price per sqm, or units x price per unit | a genuine SALE value |
| Leasable | area x rent per sqm per year | ONE YEAR of rent at full occupancy |
| Operable | keys x ADR | ONE NIGHT at full occupancy |

So the basis is correct for the selling assets and wildly understated for the rest. **Measured
against the revenue engine's lifetime figures on the two live projects: a leased asset understated
by 5x to 11x, a hotel by 2,255x to 4,739x.** FMP RE HUB's Hotel Phase 1 carries a 1.158m basis
against 5,488.913m of revenue the model itself computes.

**Why it survived.** The number is not zero and not negative, so nothing looked broken; it just
looked small, and a percentage of a small number is a small cost, which is a plausible answer.
There is no check that a basis is the same ORDER as the quantity it claims to measure, and the
field is named `totalRevenue`, which is what a reader would want it to be.

**Fix, in two stages on the same day (2026-08-19).** First the two SELLING costs (marketing,
commission) were scoped to the assets that sell, so they stopped touching the broken half of the
basis, and the basis itself was pinned as-is with the numbers stated, because correcting it moves
numbers. Then, on instruction, **the basis itself was corrected**: it now comes from the REVENUE
MODULE (`saleRevenueTotalForAsset` / `totalRevenueTotalForAsset`) while the RATE stays an input on
the Capex tab. `percent_of_revenue_sale` reads the sale value (GDV), `percent_of_total_revenue` the
whole-hold revenue, `percent_of_revenue_cash` the collections it already read.

A subtlety that IS the fix: **zero and absent are different answers.** A held asset has no sale
value, so its sale basis is 0; had the helper returned `undefined` there, the caller would have
fallen back to the broken product and charged a marketing budget on an ADR again. So `undefined`
means only "no revenue snapshot supplied". That is why a sale-basis line now charges zero on a hotel
even with the scope forced open, which makes the scope and the basis independent defences rather than
one fix wearing two hats.

**Measured:** FMP - MARINA GATE total capex 437,844,950.00 -> 438,943,005.32, all of it the marketing
line on Marina Residences (11,438,000.00 -> 12,536,055.32, i.e. 2% of a 626.803m sale value instead
of a 571.900m product, the gap being sale price indexation the product ignores). FMP RE HUB
+1,625.87 on 4.9bn, rounding scale, because both its selling assets are Sell so product and sale
value already agreed.

**Lesson.** When a computed basis feeds a percentage, check its ORDER OF MAGNITUDE against the
quantity it names, from an independent source. A wrong basis does not announce itself: it produces a
small, believable number, where a wrong denominator producing zero would have been noticed in a day.

---

### 7.23 A rule with four copies gains a fifth argument in one of them

**Symptom.** None yet, which is the point: it was caught by a verifier during the change, not in
production.

**Mechanism.** `assetVisibleLines` is the ONE definition of which cost lines an asset carries, and
2026-08-17 made the engine call it precisely so the screen and the charge could not diverge. But the
Costs tab's own per-asset row list still spelled the filter out inline:

```ts
costLines
  .filter((c) => c.phaseId === activeAsset.phaseId)
  .filter((c) => c.targetAssetId === undefined || c.targetAssetId === activeAsset.id)
```

When the shared rule gained the selling-cost scope, the engine stopped charging a marketing line to
a leased asset while THAT list carried on showing it: shown but not charged, the exact mirror of the
country-gate defect (7.13) the shared rule was written to close. Two verifiers also pinned the old
three-argument call shape by source regex, so they went red rather than silently passing.

**Fix.** The tab calls the shared function with the asset's strategy. The stage filter stays local
and is asserted to, because it filters the VIEW and is deliberately not part of what the engine
charges.

**Lesson.** Extracting a shared rule is only half the job; the other half is removing every copy.
Grep for the SHAPE of the old filter, not just for the function name, because a surviving copy
contains no reference to the function that replaced it. And when a shared rule gains a parameter,
the guards that pin its call shape going red is the system working: update the assertion to demand
the new argument, never relax it.

---

### 7.22 One quantity recognised by two rules lands in two columns, and the Balance Sheet carries the difference

**Symptom.** The Cash Flow's Investing section did not foot: the per-asset capex rows summed to
426,407.0k against a Total Capex of 366,407.0k printed under them. Chasing the 60,000.0k gap led
to a much larger one: the Balance Sheet was out by **-25,000,000** in the construction year, and
balanced in every period after it.

**Mechanism, two layers.**

1. *Presentation.* The Total Capex subtotal has been the CASH basis since M4 Pass 2P
   (`capex.perPeriod.exclLandInKind`, because land contributed in kind never leaves the bank).
   The asset rows above it were the FULL cost. Two bases under one heading, so the column could
   not be added up. The phase filter made it worse: filtered used the full cost, unfiltered the
   cash, so changing the filter changed the BASIS and not just the scope.
2. *The real defect.* In-kind LAND is capitalised by the capex engine, per asset, in the
   CONSUMING asset's window. In-kind EQUITY was stamped by a separate walk over the parcels, at
   the OWNING parcel's phase. Those are the same quantity described twice. They agreed for as
   long as a parcel belonged to its phase; **since 2026-08-17 a parcel is PROJECT-WIDE**, so a
   Phase 2 asset can draw on Phase 1 land, and from that day the equity credit and the asset it
   creates could land in different columns. Measured: equity recognised the whole 60,000,000 at
   t=0 while the land arrived 35,000,000 at t=0 and 25,000,000 at t=1.

**This is 7.12 again with a different quantity.** There the Y0 lump rule was written in five
places with two answers; here the in-kind recognition rule was written in two places with two
answers. The fix is the same shape: delete the copy, read the one series.

**Fix.** `computeDebtEquitySplit` reads `capex.perPeriod.landInKind` verbatim, with NO fallback
to the parcel valuation: land no asset capitalises is not on the Balance Sheet, so crediting
equity for it is precisely the imbalance being removed. `AssetCF` gained `landInKindPerPeriod`,
so the Cash Flow can render the cash slice while inventory, per-asset returns and the IC report
keep the full carrying value. The in-kind land is stated on a memo row rather than dropped.

**Why the whole suite stayed green.** Every pre-existing fixture puts the parcel in the SAME
phase as the asset consuming it, and several verifiers already assert the BS balances. The
defect is unreachable in that shape. It also needs the later phase's land line off phase-local
index 0, because index 0 clamps to `offset - 1` and makes the two rules agree by accident. A
fixture has to be built for the shape, not adapted from the shape that was already there.

**Proof.** 2026-08-18. `bsDifferencePerPeriod` max |v| on the two live projects: 25,000,000.00
and 360.79 before, **0.00 and 0.00** after. The 360.79 on FMP RE HUB had been recorded in
CLAUDE.md and docs/FUND_LAYER_GUIDELINE.md as a pre-existing solver-convergence residue and
pinned as a non-defect; it was this. `verify-cf-capex-foot` **57**, teeth proven by four
sabotages (15 / 1 / 15 / 8 failures) plus a permanent COUNTERFACTUAL section that recomputes
what the retired rule would have produced on the same fixture and asserts the two disagree,
because a Balance Sheet that balances proves nothing unless the fixture could have unbalanced it
and section A cannot be sabotaged after the fact.

### 7.21 A list that mirrors another list will diverge. Compare them, never restate one

**Symptom, three times in one day, all silent.**

1. `migrateLegacyToV8` rebuilt each record from a literal naming every field it kept, so any
   field the literal did not name was destroyed on load. Three real fields went that way
   (`windowFollowsConstruction`, `phasingSource`, `capexPhasing`). See 7.16.
2. The v6-to-v7 rename map still mapped `marketing` and `project-management`, which had SINCE
   become real catalog ids, so a line the user has today was renamed into a different line and
   then deduped away. See 7.17.
3. `SEEDED_COST_LINE_IDS` was introduced so verifiers could count against the seed instead of a
   magic number. A sabotage put `rett` back into that constant and **nothing failed**, because
   every check compared the seed to the constant and the constant to nothing.

**Mechanism.** Each is a hand-maintained list whose correctness is defined by ANOTHER list: the
type's fields, the catalog's ids, the seed's output. Nothing forces the two to meet, so the
mirror drifts the moment the original changes, and the drift is silent by construction.

**Fix, in order of preference.**

- **Do not keep the mirror.** Spread the record instead of enumerating its fields (7.16). This
  is the only fix that cannot rot.
- **Derive it.** `SEEDED_COST_LINE_IDS` is `STANDARD_COST_LINE_IDS` minus what is deliberately
  not seeded, not a second literal.
- **If a mirror must exist, check the RELATIONSHIP, not the mirror.** "No key of the rename map
  is a current catalog id" and "the seed-set constant equals what the seed emits" are both
  one-line checks that fail on the next divergence. A check that restates the mirror
  ("the map contains these seven keys") passes forever and proves nothing.

**The tell.** If you can change one list, run the suite, and see green while the product is
wrong, the check is comparing a thing to itself. That is what sabotage is for: it found item 3
in this list, which the check written moments earlier had missed.

**Proof.** `verify-snapshot-field-survival` section F (rename keys vs catalog ids) and
`verify-no-hidden-cost-lines` section A (seed constant vs actual seed), both added after the
divergence they now catch.

### 7.20 A control that accepts a change and discards it is a lying screen

**Symptom.** "I set the asset phasing curve and checked the box, and it reverted to zero and
unchecked."

**Mechanism, the second one.** A project opens READ-ONLY until the user clicks Edit, and that
lock lived only at the store's model-mutating setters, which no-op **silently**. Every input
still looked and behaved editable: type into it, watch the value appear, lose it on the next
render, with nothing said. Same family as a screen showing one number while the model uses
another.

**Why the obvious fix was wrong.** A blanket `pointer-events: none` on the panel had been tried
before and removed, because it also killed collapsibles, phase and asset selectors and view
toggles. In view mode every VIEW interaction must keep working.

**Fix.** Lock the CONTROLS, not the panel: `input`, `select` and `textarea` get
`pointer-events: none` plus a muted, dashed, not-allowed treatment; buttons, rows and links are
untouched. CSS cannot stop typing into a field reached by Tab, so capture-phase handlers on the
container swallow every key except Tab, Escape and the copy shortcuts. `data-view-editable`
opts out the handful of controls that filter a view rather than change the model.

**The pair that must not drift.** The store lock and the screen lock are now ONE derivation
(`modelLocked` -> `viewLocked`), because two hand-written expressions of the same idea is how a
field ends up looking editable while the store refuses the write.

**Proof.** Browser: typing `TYPED WHILE LOCKED` into the project name leaves
`FMP - MARINA GATE`; the stage filter stays live; tabs and expand-all still work; after Edit the
same field takes the text. `verify-view-lock` 37, teeth proven by two sabotages.

### 7.19 A gate that hides a row is a defect generator, not a feature

**Symptom, twice in one week, opposite directions.** (1) A hidden transfer-tax row was CHARGED:
937,500 on a Phase 2 hotel that showed no such row, on top of the user's own line. (2) Once the
gate was honoured, SELECTING A COUNTRY made that hidden row appear and charge, doubling a cost
the user had already entered by hand.

**Mechanism.** `CostLine.requiresCountry` let a line be PRESENT BUT INVISIBLE. Every consumer
then had to remember the gate: the engine forgot it once, and the copy planner applied it on one
side only. A row nobody can see is a row nobody can delete, correct or audit.

**Fix.** Remove the gate, not just its bugs. The transfer tax is no longer seeded; it is a
catalog entry the user adds when the project needs it, and the entry stamps the land-cash
phasing onto the line. `retireCountryGatedLines` clears the flag from saved snapshots on load:
a row the country did not match is REMOVED (it was invisible and charging zero, so nothing
moves), and a row the country DID match is KEPT with the flag stripped (it is already charged, so
removing it would delete a live cost). Measured on both live projects: total capex identical to
the byte, line count 23 -> 21.

**The general form.** Visibility and money must not be governed by different conditions. If a
value is in the model it must be on the screen. A conditional row is a conditional number, and
the condition will be forgotten by one consumer.

### 7.18 A field with no editor is not a default, it is unreachable

**Symptom.** The Capex tab said "the project country is not set, so the transfer tax is not
charged", while Project & Phases plainly showed `Jeddah, Saudi Arabia`.

**Mechanism.** `Project.country` had **no editor on any screen**, and no wizard step wrote it.
The visible field was `location` ("free-text city / country / region, display only"), a
different field that drives nothing. So `country` sat at its default `''` on every project this
app has ever created, and `requiresCountry: 'Saudi Arabia'` could never match. Two behaviours
read it: the cost-line gate and the default statement terminology (Zakat).

The tempting diagnosis was "the gate matches free text and the user typed a city as well". That
would have been fixed by matching a second string, and the field would still have been
unreachable.

**Fix.** A `<select>` writing an ISO code, and ONE comparison (`countryMatches`) that resolves
both sides, so a line saved as 'Saudi Arabia' matches a project storing 'SA' with nothing
migrated on either side. The free-text location can offer its country as a one-click
suggestion; it never infers.

**The general form.** When a gate reads a field, check that a user can actually SET that field
before assuming the comparison is wrong. Ask of any behaviour-carrying field: which screen
writes this?

**Second lesson, on closing a gate.** Because the country had never been settable, users added
their own copy of the gated line. Closing the gate correctly (2026-08-17) then made setting a
country DOUBLE the cost. A fix that unblocks a path must consider what the users did while the
path was blocked.

### 7.17 A legacy rename must never target a line that exists today

**Symptom.** A marketing cost line saved by a new project was gone after reopening it.

**Mechanism.** `migrateLegacyToV8` carries a v6-to-v7 id map that renamed `marketing` to
`commission` (in v6, marketing WAS the sales commission line). `marketing` became a real catalog
id on 2026-08-15, and `project-management` on 2026-08-17. Every app-saved snapshot takes the
legacy path, so a line the user has today was renamed into a different line on the next open and
the dedupe that follows then deleted it.

**Fix.** Both keys removed, and `verify-snapshot-field-survival` now fails if ANY key of the
rename map is a current catalog id. The invariant is what is checked, not the two names: the
next catalog entry that reuses an old id would otherwise repeat this silently.

**How it was found.** Not by the report. A check written for a different defect ("the loose path
and the v8 path hydrate identically") failed with a whole line missing on one side.

### 7.16 A whitelist is the wrong shape for a migration

**Symptom.** Tick "one phasing curve for this asset", set the weights, save. The version row in
the database really does carry `capexPhasing`. Reopen the project: unchecked, empty, nothing
said. Verified in a real browser before the fix.

**Mechanism.** `migrateLegacyToV8` rebuilt every phase, parcel, asset and cost line from an
object literal naming a FIXED set of fields, so anything the literal did not name was destroyed
on load. This has now eaten three real fields: `windowFollowsConstruction`, `phasingSource` (both
cost lines) and `capexPhasing` (asset). It runs on EVERY snapshot without a version wrapper,
which is every project this app saves, so it is not a legacy path in practice.

**Fix, third time asked.** Not a fourth name on the list, and not the guard verifier added the
second time (it fails after a field has been added, and has to be repeated per type). Every
record now spreads the raw object first and normalises on top, so there is no list. This also
makes the loose path agree with the v8 path, which has always spread, and
`verify-snapshot-field-survival` proves it by round-tripping a field the verifier invented.

**The general form.** If a defect recurs, fix the SHAPE that allows it, not the instance. An
enumerate-what-you-keep transform silently discards; an enumerate-what-you-change transform
cannot.

### 7.15 Silent normalisation makes the screen and the model disagree

**Symptom.** Setting the first of two facility shares to 100% produced 66.67% and 33.33%. The
typed number was not the number in force, and there was no way to make one facility carry the
whole requirement.

**Mechanism.** `normaliseFacilityShares` rescaled: any set of shares whose sum was not 100 was
divided through by that sum. 100 and 50 became 66.67 and 33.33 on every recompute. The card even
printed "Normalised: 66.67%" underneath the 100, so the divergence was visible as a fait
accompli rather than as a problem to fix.

Worse, one MISSING share discarded every typed one: `anyMissing` triggered an equal split across
all of them, so a deliberate 70 became 50 because a neighbour had no value.

And the reconciliation already carried the right check, `Facility shares sum N (expected 100)`,
which **could never fire** because the function it guarded guaranteed 100 by construction. A
check made vacuous by the very defect it was written for.

**Fix.** Use the shares verbatim, floored at zero. Keep the equal split ONLY when no share is
typed anywhere, since then nothing is being overridden. A share absent while another is typed
resolves to zero. A sum that is not 100 is a real state the model is in, so it is stated: the
reconciliation check now fires, and the tab says which way the model is wrong ("raises more debt
than the project needs" / "leaves part of the requirement unfunded") with a one-click, explicit
repair.

**The general form.** Normalising an input behind the user's back is worse than either accepting
it or rejecting it: it cannot be seen, it cannot be overridden, and it converts an arithmetic
mistake into a model that quietly disagrees with its own inputs. If a value must satisfy a
constraint, enforce it where the value is typed and say so, or let it through and report it.
Never repair it continuously in a pure function three layers down.

**Proof.** `verify-facility-shares` 29 -> 55. Restoring the rescale fails twelve checks and
reproduces the reported 66.67 / 33.33 exactly.

### 7.14 Two identical tables are not necessarily a double count

**Symptom.** The Financing tab rendered the Senior debt schedule twice, two tables with the
same opening, drawdown, IDC and closing, and Combined Debt Service showed 214,852 against
107,426 in each. It reads exactly like a line counted twice into a total.

**Mechanism, and why it is NOT that.** There are genuinely two tranches, one seeded per phase,
and a facility's schedule is PROJECT-WIDE: since Pass 28 (2026-05-14) the engine deliberately
stopped windowing a tranche to `tranche.phaseId`, because a bank funds drawdowns in every phase
and the interest on all of them is IDC. So a facility draws the project debt requirement TIMES
ITS SHARE, and two facilities at 50% each draw identical halves whose sum is the requirement.
Measured: 107,426,203 x 2 = 214,852,407 = the debt requirement exactly, and collapsing the two
into one leaves every combined total byte-identical.

The real defect was the wizard seeding one facility per phase for an engine that finances the
project as a whole, so a per-phase facility had no per-phase meaning: it was an unlabelled 50%
share.

**Fix.** Seed ONE facility. Name the share on every facility table when there is more than one,
and say in words that identical schedules are shares of one requirement and the combined is
their sum. The note keys on the SYMPTOM (more than one new facility with identical draw
schedules), not on "no share is set", because the live project carried explicit 50 and 50 and
was identical all the same.

**The lesson.** Before removing a "duplicate", check whether the total equals the sum of the
parts or twice one part. The fix for a genuine double count and the fix for a split presented
badly are opposite actions, and applying the first to the second corrupts a correct model.
`verify-facility-shares` section B pins the arithmetic in both directions: sabotaging the share
normaliser so each facility draws 100% (a real double count) fails seven checks.

### 7.13 A gate that hides a row but not its money

**Symptom.** A Phase 2 hotel showed one Real Estate Transfer Tax line in the inputs and was
charged for two. RETT was double-charged, and the doubled figure reached the financing
schedule, the statements, the returns and both exports.

**Mechanism.** `CostLine.requiresCountry` gates a country-specific line. Three input-side
filters in the Costs tab honoured it. `computeAssetCost` built its own list filtering on phase
and target asset ONLY, so a gated line was charged while being invisible, uneditable and
undeletable. The asymmetry sat inside one function: the set of lines it charged ignored the
gate, while the set a percentage may charge ON (`assetVisibleLines`, thirty lines below)
respected it.

Reaching the broken state needs nothing unusual: type a rate while the country matches, then
change the country. The row disappears and the money does not.

**Fix.** `computeAssetCost` builds its list from `assetVisibleLines`, the same function the
screen and the base picker use. And because closing a silent overcharge opens the mirror image
(a rate that now contributes nothing, on a row you cannot see), the tab says so: "1 cost line
carries a rate but does not apply here".

**Proof.** Measured on a live project, `rett__phase_2` at 5% with the project country empty:
937,500 charged for an invisible row, on top of the user's own RETT at the same rate. The asset
subtotal went from 146,889 to 145,952 after the fix, a difference of exactly 937,500.
`verify-country-gate` 15, teeth proven by restoring the hand-rolled filter (7 failures).
(That verifier no longer exists: the gate itself was removed on 2026-08-17c and
`verify-no-hidden-cost-lines` replaced it. See 7.19.)

**The general form.** When a predicate decides what a user can SEE, check whether the same
predicate decides what the model COUNTS. If the two lists are built separately they will
diverge, and the direction they diverge in is invisible by construction. **And the better answer,
reached three weeks later the hard way: do not have the predicate at all.** A row that is in the
model belongs on the screen.

### 7.12 A fix applied to one copy of a rule leaves the other copies wrong

**Symptom.** In the construction cost schedule, Phase 1 land showed a total with every period
column a dash, while Phase 2 land phased correctly. The inputs carried the land value in both.

**Mechanism.** The mapping from a phase-local index to the project axis existed in FIVE places
with TWO answers. Local index 0 is the Y0 upfront lump (land cash, land in kind, RETT) and belongs
in the period before the phase starts, which has to be CLAMPED for a phase that starts with the
project. M4 Pass 2W (2026-05-24) clamped it in the financing aggregate and the equity engine,
because the unclamped form produced -1 for phase 1 and silently deleted the upfront land. The
Costs tab's own schedule kept `if (offset > 0)`, so it added a phase-1 lump to no column at all.
The two surfaces then disagreed for twelve weeks, and one of the tables accumulated its row total
INSIDE the dropped branch, so it reported a smaller number rather than merely misplacing one.

The docstring on the financing aggregate still described the OLD behaviour and claimed the Costs
tab matched it: "Phase 1 (offset = 0) drops its Y0 lump entirely. This guarantees the Financing
Tab shows the exact same per-year values as the Costs Tab." Both sentences had been false since
the day Pass 2W landed.

**Fix.** `phaseLocalToProjectIndex` in `capexPhasing.ts`, called by every site. When a rule is
worth a comment explaining its edge case, it is worth being a function.

**Proof.** Measured on a live project before the change: 70,000,000 of phase 1 land present in the
model, in the financing schedule and in the capex table's Total column, and absent from every one
of that table's period columns. After: land in the first period on both phases, and every row and
every table total footing (422,705 across all four tables, 362,705 excluding in-kind land,
299,705 excluding all land, matching the tile). `verify-y0-lump-placement` 23, teeth proven by
removing the clamp (5 failures) and by restoring the drop guard in one table (1 failure).

### 7.11 Two guards on the same thing, keyed off two different variables

**Symptom.** A cost row rendered its money TWICE: the amounts on the curve in force
(11,760 / 35,280 / 47,040 / 23,520 on an inherited 10/30/40/20 curve) and, directly beneath,
an even spread the model never used (29,400 four times).

**Mechanism.** One strip was guarded on `displayPhasing === 'manual'` (the RESOLVED mode) and
the other on `effPhasing !== 'manual'` (the line's OWN stored mode). Those are equal until
something resolves differently from what is stored, which is exactly what inheritance does. The
second strip then recomputed the distribution locally from the stored phasing. The comment on it
even said it rendered only when phasing was not manual "so we don't double-render and confuse the
user": right intent, wrong variable, and no check compared the two.

**Fix.** Do not render a number the engine already computed. The row now renders
`perLinePerPeriod` and calls no distribution function at all, so there is one strip and it cannot
disagree with the model. `verify-cost-catalog` asserts `distributeItemCost` never appears inside
the CostRow body, comment-stripped and scoped to the function, because a narrower assertion on one
spelling of one line was slipped past by a sabotage that renamed the variable.

### 7.9 `migrateLegacyToV8` is a FIELD WHITELIST, and most projects go through it

**Symptom.** A new `CostLine` field is written correctly by a migration and is gone by the time the
row renders. No error anywhere.

**Mechanism.** The loose path rebuilds every cost line as an object literal naming each field. A
field not named there is dropped on every hydrate, and a snapshot saved without a version wrapper
takes that path, which is the common case.

**Fix.** When adding a field to `CostLine` (or any entity that literal rebuilds), add it there too.
This is the INVERSE of the usual schema-tolerance rule: there, a new column must tolerate being
absent; here, a new field must be named or it never survives a reload.

**Proof.** 2026-08-17: `windowFollowsConstruction` set by the repair, `[follows]` present after the
direct call and absent after `hydrationFromAnySnapshotChecked`, on the same snapshot.

**IT HAPPENED TWICE.** `phasingSource` went the same way and was measured on the live project:
version 1, as the wizard wrote it, carried `marketing -> collections`, `commission -> collections`
and `rett -> land_cash`; in the version being worked on, all three read ABSENT. So a marketing line
seeded to follow sales collections was phasing on the build programme, and the row's dropdown said
"Inherit asset curve" because that is genuinely what the surviving data said. Opening the project
dropped the field in memory and the next save made it permanent.

**The guard that stops a third time.** `verify-cost-catalog` section A parses the `CostLine`
interface and the rebuild literal from source and fails on any field the literal does not name.
Proven by deleting `catalogId` from the literal: the check reports it by name. A repair
(`restoreStrippedPhasingSource`) puts back what was already destroyed, and only where the field is
ABSENT: choosing a source writes the value explicitly, including `inherit`, so a user's choice is
distinguishable from a stripped one.

### 7.10 One entity, two answers: a derivation that outranks a stored field

**Symptom.** `pre-operating` was counted as a SOFT cost by the engine's stage rollup and displayed
as OPERATING by the row badge, the stage filter and `deriveCostType`, at the same time.

**Mechanism.** The catalog seeded `stage: 'soft'` while `STANDARD_STAGE_BY_ID` said `'operating'`,
and the rollup was the one reader of the raw `line.stage` that bypassed `deriveCostStage`.

**Fix.** One derivation, read everywhere. When a stored field is outranked by a derivation, no
reader may consult the field directly. Note the precedence itself is load-bearing: the id map
outranking `stage` is how the 2026-08-16 marketing reclassification reached saved projects with no
migration, so a USER's choice needs its own field (`stageOverride`), not a write to `stage`.

---

## 8. Registries and two-step registration

### 8.1 A template registered in one place and not the other fails silently and permanently

**Symptom.** A new slide reaches freshly seeded decks and is invisible to every existing one. No
error, no notice, no failing check.

**Mechanism.** Registration is two steps: add the template to the library AND add its id under the
new key in `TEMPLATES_BY_VERSION`, then bump `DECK_SCHEMA_VERSION`. **Doing only the first silently
lifts every deck's version and adds nothing** (`candidates` empty); doing only the second never
fires.

**Fix.** `verify-deck-template-registry` asserts every template id appears in `TEMPLATES_BY_VERSION`.
Any two-step registration contract needs an equivalent check.

**Proof.** The three fund slides shipped 2026-08-13 and appeared in no exported deck.

---

## 9. Deployment

### 9.1 A sub-daily cron fails the WHOLE deploy with no deployment record

**Symptom.** `git push` succeeds, `origin/main` is correct, the dashboard shows nothing failed, and
production is hours stale.

**Mechanism.** **The Vercel account is HOBBY.** Hobby allows at most one cron run per day; a more
frequent expression **fails during deployment**, and Vercel creates **no deployment record** for the
rejection. Cron COUNT is 100 on every plan; FREQUENCY is the constraint.

**Fix.** After any `vercel.json` change, verify prod actually moved:
`curl https://app.financialmodelerpro.com/api/health` -> `.commit` must equal `git rev-parse HEAD`.
Use the **app.** subdomain (the bare domain redirects). The only other trace is the GitHub commit
status: `curl -s https://api.github.com/repos/financialmodelerpro/financial-modeler-pro/commits/<sha>/status`.

**Proof.** An every-minute cron (`f9f9506f`) left production on `55eb7653` for ~9 hours while
unrelated pushes appeared to ship.

**The reasoning error, worth not repeating.** A previous memory asserted "Vercel is PRO, the docs'
Hobby notes are STALE" from an inference ("Hobby allows only 2 crons and this account runs 6").
Both halves were wrong, and the note then "corrected" an accurate CLAUDE-ROUTES warning into saying
the opposite, destroying a true warning. **Verify a plan or limit against the live doc or an API
before overriding an existing note. The existing note usually knows something.**

### 9.2 `src/middleware.ts` has never run

Next resolves middleware at the PROJECT ROOT, and `app/` is the source root with no `src/app`, so
`src/middleware.ts` is never compiled (`middleware-manifest.json` is `{"middleware":{}}`). The
`/login` redirects that make it look alive come from `next.config.ts`. **Do not "fix" it by moving
the file** without a deliberate JWT `role`-claim test first: that would ACTIVATE a gate that has
never run and could lock admins out. Page-level admin enforcement is CLIENT-side today; every admin
WRITE is server-guarded, which is the precise claim.

### 9.3 Build uses `next build --webpack`

Turbopack is disabled because of MAX_PATH on Windows/OneDrive.

### 9.4 `getServerSession` throws without a request scope

`requireAdmin` try/catches it, or a missing session becomes a 500 instead of a 401.

### 9.5 Paddle "Something went wrong" means a token/environment mismatch

A live client token under sandbox (or the reverse). `paddleEnv.paddleEnvMismatch` guards it.

---

## 10. Verifier discipline

### 10.1 A grep proves a clause is PRESENT, never that it FIRES

The `array_length` no-op (2.3) passed a verifier that asserted the constraint's TEXT via a regex over
the `.sql` file. **After a migration with CHECK constraints, defaults or FK cascades is applied, run
a throwaway script against the real DB that tries to INSERT the rows the constraints should REJECT**,
then delete the test row. Pure verifiers cannot do this. The same applies to UI: asserting a source
file contains a string proves neither that it renders nor that it is reached.

### 10.2 Never gate an assertion on the thing it asserts

A check whose precondition is the property under test cannot fail. **A check that cannot fail is
worse than no check, because it certifies the thing it never looked at.** This is why all three
workbook integrity rows are now real comparisons of two series: two of them used to be the literal
string `'OK'` printed beside an unrelated magnitude.

### 10.3 Prove teeth by sabotage, against the PRE-FIX build

A verifier written after a fix will pass against the fixed code whether or not it works. Break the
code deliberately, one way per check, and confirm the RIGHT check fails. Restore carefully: one
silently-failed sabotage restore has already been caught on a diff.

### 10.4 A tolerance must be relative and peak-anchored, and SIZED AGAINST MEASURED NOISE

Anchoring on the worst period's OWN value divides by something that legitimately crosses zero (net
cash flow does), producing "5.0e+0 of 0.0 m". Anchor on the PEAK magnitude over the whole horizon.
That part was right and stands.

**CORRECTED 2026-08-18, and the correction is the important half.** This entry used to open: "an
ABSOLUTE band (`maxBsDiff < 1`) is 1.4e-10 on a seven-billion balance sheet, so a healthy 5.1e-8
residue reported CHECK." **The residue was not healthy.** It was 360.79 currency units, and it was
a real defect: in-kind equity recognised in a different period from the in-kind land it pays for,
which on the sister project was a 25,000,000 balance-sheet break (see 7.22). The red check was
right, and it was made green by widening the band around it.

Two mistakes ran together. The ANCHOR was genuinely broken and needed fixing. The SCALE was then
changed at the same time and in the same breath, from an absolute 1 to `peak * 1e-6`, which on that
project is 6,597 units, and nobody asked what a healthy residue actually looks like. **It is
measurable, and it was never measured.** These identities are exact by construction, so a healthy
residue is pure double-precision noise: measured with the model correct, worst 1.9e-6 on a 6,597.1m
peak, a relative 2.9e-16. The band was ten orders of magnitude above the thing it was meant to
tolerate. `CHECK_REL_TOL` is now 1e-12, which still leaves roughly 3,000x headroom.

**The rule: measure the noise floor on a model you have proved correct, then set the band a couple
of orders above THAT.** Never set it from the residue you are currently looking at, because if that
residue is a defect you have just certified it. And when a check goes red, changing the threshold is
the last hypothesis to test, not the first.

### 10.5 A verifier must not be able to cause the damage it checks for

`verify-admin-api-keys` was written to prove that rotating the partner key is admin guarded, by
POSTing to the rotate route with no session. The first version sent the REAL registry id with
`confirm: true`. That check passes today, and on the day the guard is ever removed, running the
verifier would have **rotated the live partner key** and handed the consumer a 401, with no way to
undo it. It now sends an id that is not in the registry: auth runs before the registry lookup, so
`401` rather than `404` proves exactly the same property, and the worst case if the guard is gone is
a harmless 404. Confirmed by actually removing the guard: the response became 404, the key row count
was unchanged, and the right two checks failed. **Before writing a destructive call into a verifier,
ask what that call does on the day the check fails.**

### 10.6 A source grep fires on the comment that warns about the pattern

These files document the dangerous thing they refuse. `apiKeyRegistry.ts` explains that the client
never names an environment variable by quoting `process.env[whatever the browser sent]` in its
header, and a check asserting `!/process\.env\[/` read that warning as the defect and failed on
correct code. **Strip comments before asserting the absence of a code pattern.** The other direction
is worse and is why this matters: a check that fires on prose can be silenced by deleting a comment,
so it is not testing the code at all.

### 10.7 A check for a character cannot contain that character

The em-dash sweep in a new verifier failed on its own source, because the check was written
`!src.includes('X')` with the literal em dash in it, and the verifier reads itself. Build the needle
instead: `String.fromCharCode(0x2014)`. `verify-admin-api-keys` already did this and says so; the new
file had to learn it again.

### 10.8 A verifier goes red the first time a feature is USED

`verify-public-pages-api` presents `FMP_PUBLIC_API_KEY` and asserts 200s. Once the key is rotated,
that value is not the live key and no plaintext exists anywhere, so every one of those checks would
fail and the failure would read as "the partner feed is broken" when it actually means "rotation
worked". It now resolves the live source through the same shared module the route uses and SKIPS the
checks that need an accepted key, keeping the refusal checks (which need no key and matter more).
**When adding a feature that changes a precondition a verifier depends on, check what that verifier
reports after someone uses the feature once.**

### 10.10 A pinned "pre-existing failure" is a diagnosis you have not done

**Symptom.** Five verifiers carried recorded failures in CLAUDE.md, each with a short reason and the
note "confirmed pre-existing by stashing unrelated changes and re-running". Swept on 2026-08-18: not
one was what its note said, and none of the five was a product defect, but one of them was hiding
something much worse than a red line.

- **`verify-strategy-switch`, recorded as "54 passed + 1 PRE-EXISTING FAILURE (the fixture builds no
  companion)".** The script only documented `npx tsx --env-file=.env.local` and did not load
  `.env.local` itself as every sibling does, so run the ordinary way it fell back to a two-asset
  fixture with no Sell + Manage asset. **Eight checks sat inside `if (sm)` and did not run, every
  one of them asserting that leaving Sell + Manage RETAINS the companion instead of hard deleting it
  with its sub-units, cost lines and overrides, which is the destructive bug the whole retention
  mechanism exists to prevent.** The run still printed "56 passed, 1 failed", so the output looked
  like one cosmetic gap. Run as documented it is 84 passed, 0 failed. Proven afterwards by sabotage:
  deleting the companion instead of parking it now fails three checks on the fixture path where it
  previously failed none.
- **`verify-fund-fees`, recorded as 136 and actually 133 + 3 since six commits earlier.** Two of the
  three DEMANDED THAT A DEFECT STILL BE PRESENT ("the BASELINE already troughs below zero"), and it
  had been fixed: the shortfall was never the drawdown sizing the comment blamed, it was the seeded
  `endPeriod = cp + 1` window putting construction capex in the first OPERATING period, outside the
  funded window, and `082b1390` moved it back. The third built a regex from `Math.round(amount)` and
  tested it against a raw float, so it passed only while the figure happened to round DOWN.
- **`verify-tab2-pass2` (5), `verify-module6-scenarios` (1), `verify-pricing-application-ready` (1,
  recorded as "NOT yet diagnosed").** All literal source-string greps that drifted: whitespace-exact
  multi-line matches, a module renamed, a handler extracted into a named function. The behaviour is
  present in every case.

**Mechanism.** "Confirmed pre-existing by stashing" answers only "did I cause this", which is the
less interesting question. It does not ask whether the check is right, whether the code is right, or
**how many other checks stopped running when this one broke**. A count in prose then freezes the
answer, and the next person compares against the frozen count rather than zero.

**Fix.** Zero failures, or a diagnosis with a root cause. A check that can never go green is worse
than no check: it trains everyone to read the failure line as furniture. Two specifics worth
generalising: a verifier must not need a particular invocation to be honest (load the env yourself),
and **a conditional block that skips silently must be made unconditional** or must report what it
did not run, because "56 passed" and "56 passed with 8 skipped" look identical.

### 10.9 Verifier counts do not belong in prose

Every count quoted in a markdown file is stale by default; several already are. The count lives in
the verifier.

---

## 11. Content and house style

### 11.1 The em-dash rule is unenforced in the database

`verify-no-em-dash-content` sweeps `app/` and `src/` only. `scripts/`, markdown and applied
migrations are excluded by design. **Every live violation ever found was in the DATABASE** (`courses`
descriptions, and the `page_sections` terms-of-service and privacy-policy legal pages), which nothing
sweeps and admin editing can reintroduce at any time.

**Scanning lesson: scan every text column and jsonb document, not a hand-picked list.** The first pass
named `title`/`description` only and reported 1 field / 2 occurrences; the full sweep across 19 tables
found 5 fields / 7 occurrences.

U+2013 en dash is deliberately in scope for nothing: it is legitimate in numeric ranges and is the
"not included" glyph in the pricing comparison table.

### 11.2 The reference client's name never appears in this repo

Not in code, comments, identifiers, commit messages, docs, or test fixtures. Say "the reference
model" or "the reference benchmark". The reference Excel files stay `.gitignore`-listed.

---

## Related

- [ARCHITECTURE.md](../ARCHITECTURE.md), boundary rules and the three-tier rationale
- [CLAUDE-DB.md](../CLAUDE-DB.md), migration log (flags verified 2026-08-16)
- [docs/FUND_LAYER_GUIDELINE.md](FUND_LAYER_GUIDELINE.md), fund invariants
- [docs/AI_FOUNDATION_GUIDELINE.md](AI_FOUNDATION_GUIDELINE.md), AI standing rules

No em dashes in this file.
