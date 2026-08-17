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

**The general form.** When a predicate decides what a user can SEE, check whether the same
predicate decides what the model COUNTS. If the two lists are built separately they will
diverge, and the direction they diverge in is invisible by construction.

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

### 10.4 A tolerance must be relative and peak-anchored

An ABSOLUTE band (`maxBsDiff < 1`) is 1.4e-10 on a seven-billion balance sheet, so a healthy 5.1e-8
residue reported CHECK. Anchoring on the worst period's OWN value divides by something that
legitimately crosses zero (net cash flow does), producing "5.0e+0 of 0.0 m". Anchor on the PEAK
magnitude over the whole horizon.

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
