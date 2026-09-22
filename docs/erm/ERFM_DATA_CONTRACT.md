# ERFM Phase 1 Unit 2: canonical financial data contract

Implemented under `src/hubs/modeling/platforms/erm/lib/`. This document records
the domain contract, not a database schema or permission grant. The master
roadmap remains the implementation direction. Unit 3 has not started.

## Boundaries and conventions

The domain uses the existing Zod dependency with inferred TypeScript types.
Strict schemas reject unknown fields; validators accept unknown input without
coercion. All code is pure and imports only Zod or ERFM-local modules. No React,
REFM, provider, auth, database, filesystem or network dependency enters this layer.

IDs are opaque, nonblank strings. No database identity strategy is selected.
Country/currency codes have ISO-style uppercase shapes; MIC and ISIN have format
checks only. Membership in an authoritative code registry and ISIN check-digit
validation are deferred. Sector codes belong to a named/versioned classification.
This avoids embedding a Saudi-only industry tree.

Calendar dates use real ISO `YYYY-MM-DD` dates. Event times use UTC `Z` timestamps
with seconds and optional milliseconds. Comparisons use time values, not lexical
ordering of timestamps with different precision. Clocks and IDs are caller-supplied.

## Company, instrument and segment

`company.ts` defines issuer identity, names (optional Arabic), country, sector,
industry, company status, customary fiscal year-end, reporting currency and
optional web/IR URLs. `ListedInstrument` belongs to an issuer and holds its own
ticker, exchange/MIC, optional ISIN, share class, trading currency, dates and
active/suspended/delisted status. Company identity is independent of ticker;
multiple instruments and currencies are supported.

The customary fiscal year-end is metadata, not a rule that rewrites a historical
reporting period. Actual fiscal boundaries are explicit in every period.

Segments retain issuer labels/codes, business/geography/other type, optional
parent and inclusive validity dates. Fact validation checks issuer ownership and
validity across the measurement window. Full hierarchy cycle detection, parent
ownership, overlapping validity and reorganization reconciliation need a complete
master-data collection and belong to the future persistence/service boundary.

## Reporting periods

Every period declares its fiscal-year label, start/end and four actual quarter
ends. Boundaries must increase and Q4 must end at fiscal year end. The fiscal-year
label is issuer-declared, not inferred from the calendar year of the end date.
This supports non-December years, 52/53-week years and changed fiscal calendars.
No fixed 90/365-day test is imposed.

| Measurement | Contract |
| --- | --- |
| Instant | A date within the declared fiscal year; no duration start/end. |
| Annual duration | Exactly the declared fiscal-year start through end. |
| Quarterly duration | Q1/Q2/Q3/Q4, exactly one declared quarter, always standalone. |
| H1 / 9M interim | Fiscal year-to-date through Q2/Q3 respectively, explicitly cumulative. |
| H2 interim | Standalone Q3 plus Q4. |
| Custom interim | Explicit standalone/cumulative basis; cumulative starts at fiscal-year start. |

Thus Jan-Jun cannot be submitted as Q2. A balance-sheet observation at Q2 is an
instant at that quarter end, while its accompanying sales fact has a duration.
Document headline periods and fact periods may differ for comparative columns.
There is no subtraction of cumulative periods and no TTM computation.

## Source lineage and provenance

`SourceDocument` holds issuer, type, headline period, publication date, optional
retrieval time/URL/SHA-256, language, assurance, source classification, rights and
version/replacement reference. A checksum is optional until document bytes exist;
the schema checks its format, not its authenticity. Offline sources may omit URL.

Every reported fact requires a document ID and at least one nonempty location:
one-based page, table, statement, note or free reference (including non-paginated
records). Referenced documents must resolve to the same issuer. Manual is never
source-free. Entry methods are manual, Excel, CSV, filing extraction and provider
API, all recording an actor and time, with method-specific batch/run coordinates.
New methods require an explicit discriminated-union extension.

Public availability is not an automatic redistribution licence. Rights record a
public-reference basis, licence reference, internal restriction or unknown status.
Confidential documents must be internal-only. Unknown/internal/confidential sources
cannot support shared canonical approval. A later approval service must verify
the stated rights; this contract does not establish legal entitlement.

## Concepts, units and values

Concepts are versioned codes with definitions, statement family, measurement kind,
canonical unit dimension, sign convention and general/sector/company applicability.
Codes are extensible; there is no complete taxonomy or production metric seed set.
Concept definitions are currency-independent. Currency lives on monetary facts.

Illustrative future codes, not registered definitions or financial data:

| Family | Examples |
| --- | --- |
| Income statement | revenue, cost_of_sales, gross_profit, operating_profit, finance_cost, tax, zakat, net_income |
| Balance sheet | cash, receivables, inventory, ppe, total_assets, debt, payables, total_liabilities, equity |
| Cash flow | cfo, capex, cfi, cff, net_change_in_cash |
| Per-share | basic_eps, diluted_eps, weighted_average_shares |
| Sector KPIs | telecom.subscribers/arpu; bank.financing/deposits/nim/npl; insurance.insurance_revenue/combined_ratio; utilities.capacity/generation |

These can become namespaced concepts with sector-specific definitions. Banks,
insurers, REITs, telecom, utilities and industrial issuers need no alternate fact
pipeline. A KPI is a concept with `statement: 'kpi'`; its observations use the same
reported/normalized fact, period, segment, unit, lineage and revision contracts.

Values are **exact plain decimal strings**, not JavaScript floating-point numbers.
The discriminated missing value requires a reason; null, NaN and implicit zero
are rejected. Original display text (commas, parentheses or a dash) is retained
separately. Parsing display text into a decimal is a later explicit input operation.

Units distinguish money, money-per-share, shares, ratio and extensible quantities.
Money has a currency. Scale is a power of ten: 3 means thousands, 6 millions.
Ratios distinguish fraction, percent and basis points. Normalized units require
scale 0 or fraction representation. Quantity codes carry dimensional meaning,
such as subscribers, mw or mwh; their registry and compound-unit definitions are
future taxonomy work. Currency-specific quantities must be defined carefully
before introducing monetary KPIs such as ARPU.

## Reported and normalized facts

`ReportedFact` preserves issuer label, display text, exact reported decimal or
missing reason, printed unit label, interpreted unit/currency, period, consolidation,
optional segment/instrument, source and provenance, review and revision metadata.

`NormalizedFact` references the **exact reported revision ID** and versioned concept,
with a separate value/unit, mapping version, actor/time and explicit transformations.
Identity, concept mapping, scaling, sign change and currency conversion are named
steps with rule versions and explanations. A normalized fact inherits issuer,
period and scope through its reported reference, avoiding contradictory copies.
Downstream code receives approved canonical records resolved against these local
domain contracts, never provider payloads.

Validators enforce dimension compatibility, concept applicability, sign convention,
missing-value preservation and required transformation declarations. Identity
mapping must preserve the exact decimal and unit. They do **not** execute or prove
general transformation arithmetic, FX rates, accounting equations or reconciliations.
Passing this rule set is foundational validation, not full financial certification.
Approval of transformed amounts requires later deterministic transformation checks
and human review. No approval function is implemented here.

## Versions and approvals

Facts have a chain ID, revision number, recorded time, effective start and original
or correction origin. Reasons distinguish issuer restatement, extraction correction,
reviewer correction, taxonomy remap and unit correction. Superseded records retain
their values and point forward with a reason and effective boundary; replacement
records point backward. Review is draft/submitted/approved/rejected, with the
relevant actor/time and rejection reason required by its variant.

`validateSupersession` checks consecutive versions, reciprocal links, matching
boundaries/reasons, chronological ordering, distinct IDs and approved replacements.
Reported histories retain issuer, measurement dates and scope. Taxonomy remaps
belong only to normalized history. Normalized remaps retain the exact reported
source; a restated reported fact gets a new normalization chain. Historical
approved mappings may reference historical sources, but an active approved mapping
must reference an active approved source. No input is mutated or history deleted.

Identity mistakes (wrong issuer/period/scope) need an explicit future withdrawal
and replacement workflow, not an in-chain restatement. There is no automatic
latest-version selection or full bitemporal engine. Future persistence must make
supersession atomic, invalidate dependent active mappings after a source revision,
and enforce one accepted current version under concurrent edits.

## Validation and duplicate identity

`ValidationReport` contains a rule-set version, validity and structured issues
(code/path/severity/message). `ValidationResult<T>` returns parsed data only on
success. This can be extended with accounting, subtotal, cash, EPS and share checks
without pretending those checks run today.

Canonical duplicate identity is issuer + measurement kind/dates + consolidation +
segment + instrument + concept code + unit dimension/currency. It excludes value,
source, scale, display label, taxonomy version and revision ID. Multiple current
approved rows with this identity are conflicts, not values to sum or select silently.
Draft and superseded rows are retained and excluded from this active collision test.
Identical dates with different display coverage labels still collide; a quarter
and cumulative interim have different start dates and remain distinct.

Duplicate detection accepts already validated joined domain rows. Call the record
validators first; collision detection alone does not establish lineage or approval.
Source-specific extraction duplicate detection can later use document coordinates;
it must not replace the canonical identity rule.

## Future manual-entry boundary

`manualEntry.ts` accepts reported fields, mandatory lineage and a proposed versioned
concept. Actor, timestamp, fact ID and chain ID come from a separate trusted service
context. Editable input cannot inject approval, provenance, revisions or IDs.

`prepareManualSubmission` validates shape, period, issuer/source/scope and concept
selection and returns a **submitted reported fact** plus the proposed concept.
It neither normalizes nor approves nor saves. Draft UI state can remain incomplete
until submission. Later services must authenticate the supplied actor, enforce
permissions, resolve authoritative references, allocate IDs and persist atomically.
An unknown or restricted-rights document may be submitted for exception handling,
but cannot pass shared canonical approval.

## Files and verification

Domain modules: `primitives.ts`, `company.ts`, `period.ts`, `lineage.ts`,
`concept.ts`, `facts.ts`. Cross-record validators: `lib/data/validation.ts`.
Manual submission boundary: `lib/ingestion/manualEntry.ts`.

Pure verifier: `tests/erm/verify-data-contract.ts`, run with the repository's
standalone `tsx` convention. It contains explicitly synthetic fixtures only.
No test reads environment variables, touches a database or calls a service.
Run TypeScript and scoped lint alongside it:

```text
npm run type-check
npm exec -- eslint app/erm src/hubs/modeling/platforms/erm tests/erm
npm exec --package tsx -- tsx tests/erm/verify-data-contract.ts
```

Unit 2 verification (2026-09-22): 99 pure checks passed, zero failed;
repository TypeScript and ERFM-scoped lint passed. The optional production build
was not rerun; the previously recorded local Supabase configuration gap remains.
Only the eight ERFM library modules, this document and the pure verifier were
added. Existing files, dependency manifests and the roadmap were unchanged.

## Decisions before persistence

- Choose ID/FK policy, schema ownership and migration coordination separately.
- Define research capabilities, membership, approval actors and rights enforcement.
- Select decimal storage/precision and exact transformation arithmetic; do not use floats by default.
- Approve concept definitions, unit/quantity registry, sign conventions and sector mappings.
- Define fiscal-calendar authority and changes, source replacement rules and segment reorganizations.
- Implement atomic supersession, uniqueness/concurrency checks and dependent-mapping invalidation.
- Define withdrawal for identity errors and audit retention; preserve original evidence.

Recommended next unit: a controlled persistence design and access/approval review
against this contract before authorizing shared migrations. No Unit 3 work is included.
