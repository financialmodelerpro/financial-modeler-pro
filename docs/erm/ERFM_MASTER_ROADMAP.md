# ERFM Master Roadmap

Developer source of truth for Equity Research Financial Modeling (ERFM).
Locked direction: 2026-09-21. Read this document before every ERFM unit.

**This document supersedes earlier ERFM commercial and implementation sequencing wherever inconsistent.**
The phases below record direction, not authorization to implement them. Only the
unit explicitly approved by the user may proceed.

## Purpose and commercial direction

ERFM is a modeling platform inside Financial Modeler Pro (FMP), alongside Real
Estate Financial Modeling (REFM). It shares the FMP ecosystem and infrastructure
while keeping its financial domain, calculations and analytical ownership separate.

The first commercial product is the **FMP / PaceMakers House Research
Subscription**. Subscribers initially consume company research, quarterly research
updates, sector research and published Equity Research Reports. FMP / PaceMakers
performs the modeling and valuation internally.

Self-service subscriber modeling comes later. House Research and Subscriber
Research must use the same company data architecture, deterministic modeling and
valuation engines, research workflow concepts and report engine. Separate
ownership, assumptions, thesis and access do not justify duplicating the engine.

Coverage targets broad Saudi listed-company research, then GCC expansion,
including non-financial companies, banks and insurers with appropriate sector
templates. Test companies do not define or cap the product universe. Coverage
and automation depth are separate: manual coverage is acceptable while automation
matures.

## Repository and worktree isolation

- Work only in `D:\FMP\fmp-erm` on `feat/erm`. Verify the directory, branch,
  `git status -sb` and `git rev-parse --short HEAD` before work. Stop on mismatch.
- Do not operate on `D:\FMP\financial-modeler-pro`, another worktree, `.claude`
  worktrees, Claude-created branches or `main`. REFM is developed independently.
- Do not synchronize, merge, rebase, reset, clean, change Git configuration or
  push unless separately authorized. Stage only the reviewed unit's files.
- Do not expose secrets, private reference documents or client-confidential data
  in source, documentation, fixtures, logs or commits.

## Folder architecture and import boundary

Follow the repository's root App Router and platform-local implementation pattern:

```text
app/erm/                                  ERFM pages and route composition
app/api/erm/                              Future ERFM HTTP endpoints
src/hubs/modeling/platforms/erm/
    components/                           ERFM screens and presentation
    lib/
        domain/                           Provider-neutral domain types and rules
        calculations/                     Pure deterministic financial engines
        data/                             Canonical data and normalization rules
        ingestion/                        Staging, validation and approval
        providers/                        Future input adapters
        persistence/                      ERFM storage and access boundaries
        research/                         Ownership and research workflows
        reports/                          Approved context and fixed report layout
        ai/                               Controlled extraction and writing
        state/                            ERFM-local application state
docs/erm/                                 Decisions and developer documentation
tests/erm/                                ERFM verification as behavior is added
```

This is the target allocation of responsibilities, not a requirement to create
empty directories. Unit 1 needs only `app/erm/`, platform-local `components/` and
this document. Create the remaining areas when a later unit actually needs them.

Routes compose the platform; domain logic lives under the ERFM platform boundary.
Use existing aliases such as `@platforms/erm/*` and `@shared/*`. ERFM must not
import `@platforms/refm/*`, REFM calculations from `src/core/calculations/`, or
REFM-specific project, asset, revenue, scenario, persistence or state types.
The name `core` alone does not make a module appropriate for ERFM reuse.

Keep calculations framework-independent and free of database, provider and AI
dependencies. Load future engines, editors, charts and exporters at their route
or feature boundary. Do not register them in the root layout, shared providers
or a global platform barrel. Existing boundary lint is useful but does not replace
review for sibling-platform imports.

## Shared FMP infrastructure

Reuse existing FMP NextAuth sessions and users, root providers, branding, design
tokens and suitable shared UI. Later units should assess existing accounts,
permissions, entitlement framework, subscriptions, storage, email, exports,
Supabase and Vercel infrastructure before adding alternatives.

Reuse does not mean adopting REFM business semantics. REFM project limits are not
company-analysis limits, and a REFM PDF template is not an equity report template.
NextAuth identity is not automatically a Supabase Auth identity; future access
design must account for server clients that bypass RLS.

Unit 1 has a dynamic `/erm` server layout using `getServerSession(authOptions)`.
Unauthenticated requests redirect to the existing `/modeling/signin?bypass=true`
route. The explicit physical route also resolves without production host rewrites.
The root layout already supplies the shared session provider and branding tokens.
The placeholder is available to any authenticated FMP user; it is not a House
Research permission gate and exposes no research data. There is no new entitlement
or billing logic and no Modeling Hub card activation. Future data operations must
enforce permissions themselves, not rely only on the layout.

## Manual-first, API-ready canonical data

Initial inputs will be manual/admin entry, Excel/CSV imports and official annual,
quarterly and interim filings. No financial-data API or provider is selected or
integrated in the foundation. EODHD, Twelve Data and other providers remain
unselected candidates for later evaluation. Do not assume an enterprise provider.
The pre-revenue incremental external data/API budget is approximately **USD
20-30 per month maximum**; future extraction/API choices must fit approved economics.

All input methods must converge through one pipeline:

```text
Manual entry / Excel or CSV / official filing extraction / future provider API
  -> staging -> normalization and deterministic validation
  -> human approval or exception handling -> canonical approved ERFM data
  -> deterministic modeling and valuation -> approved research report context
```

Provider payloads and extracted candidates are not canonical financial facts.
The engine consumes approved provider-neutral data only. Preserve company,
reporting period, metric, value, currency, unit, source document, page/reference
where available, extraction/input method, validation and approval status, and
version/restatement history. Missing data must remain explicitly missing.
Annual and quarterly observations must remain distinguishable.

The long-term asset is standardized, mapped, validated, versioned and
source-traceable public-company data, including statements, sectors, KPIs,
segments, shares, debt, cash, dividends and market observations. Premium adapters
may be connected later without changing the financial engine's contract.

## Ownership, confidentiality and access

| Boundary | Rule |
| --- | --- |
| Public-company canonical data | Approved public information with source lineage and applicable usage/licensing rights; reusable independently of analytical ownership. |
| FMP House Research | Organization-owned assumptions, models, thesis, valuations and draft reports; unpublished analysis is private. Publication is an explicit later workflow. |
| Subscriber Research | Subscriber/account-owned models, assumptions, thesis and reports, isolated from House drafts and other subscribers. |
| Advisory-confidential data | Client-confidential or non-public information stays in a separately controlled boundary. It must never automatically enter the shared ERFM SaaS dataset or become visible to other users. |

Public information encountered during advisory work may contribute only through
explicit source, rights, validation and approval checks. Do not copy client files,
private commentary or mixed confidential records into public canonical data.

House Research has unlimited company entitlement from the platform perspective.
Represent this as a research capability, **never by granting administrator rights**.
Administrative privileges, research authorship, publication permissions, subscriber
reading access and later company-analysis usage are distinct concerns. Unlimited
companies does not imply unlimited paid AI/API consumption. Final ownership keys,
membership rules and entitlement accounting require later approved design.

Future ERFM tables should be additive and clearly namespaced, with `eq_*` as the
candidate convention and ERFM-identifiable migration names following the existing
migration sequence. Do not repurpose REFM tables. Schema, foreign keys, RLS and
confidential storage separation require a separate unit; none is introduced here.

## Deterministic calculations and controlled AI

Financial statements, financial values, assumptions, EPS, WACC, ratios, forecasts,
Bear/Base/Bull scenarios, DCF, target prices and other valuation outputs must be
approved inputs or deterministic ERFM calculations. AI is never the calculation
engine and must not invent financial facts, sources or analyst views.

Future Anthropic filing extraction follows this controlled workflow:

```text
Official document -> preprocessing -> AI extraction -> structured JSON
  -> deterministic validation -> normalization
  -> human approval / exception handling -> canonical ERFM database
```

AI must never write unvalidated financial values directly into canonical tables.
Future research writing receives only approved structured ERFM context, including
approved analyst views. **AI CANNOT INTRODUCE A NEW FINANCIAL FACT.** If a fact or
view is absent from the approved context, omit it instead of inferring it. Preserve
the analyst's approval boundary for generated narrative as well as extracted data.

## Shared report engine

Equity Research Reports are a core output for both House and Subscriber Research,
with interactive web/portal and PDF renditions from the same approved context.
Normal reports are **2-3 pages**, with a **hard maximum of 5 pages**. FMP controls
sections, page count, word limits, layout, tables, charts, page breaks, valuation
sections and disclosures. AI controls neither report length nor financial content.
The engine must enforce these constraints; prompting alone is insufficient.
No report generation is part of Unit 1.

## Commercial and implementation roadmap

| Phase | Scope |
| --- | --- |
| 1 | ERFM foundation and manual canonical data workflow. Unit 1 is the documentation and isolated route foundation only. |
| 2 | Forecasting, scenarios, three statements and EPS/per-share engine. |
| 3 | DCF, comparables, blended valuation and market analytics, with sector-appropriate methods. |
| 4 | FMP House Research workflow and controlled 2-5 page report engine. |
| 5 | Research subscriber portal, entitlements, publication and PDF/email distribution. First commercial House Research subscription. |
| 6 | Anthropic-assisted filing extraction with validation and human approval. |
| 7 | Licensed data APIs where commercially justified. |
| 8 | Self-service subscriber ERFM modeling using the same underlying engine. |
| 9 | Combined Research + Modeling plans and broader GCC automation. |

## Shared seams and development protocol

Keep work additive and ERFM-local. Changes to authentication, subscriptions,
entitlements, payments, shared layouts/UI, Modeling Hub navigation/catalog,
database types/migrations, environment settings, dependencies, routing and
deployment configuration need an explicitly scoped later unit. Coordinate shared
file changes with REFM development; do not preemptively refactor either platform.

Unit 1 creates no schema, migrations, data APIs, provider integrations, financial
engines, reports, research publication, billing or email distribution. It changes
no REFM files, shared authentication/entitlements, dependencies or deployment
settings. Its screen contains future-module placeholders and no fake financial data.

For each unit:

1. Verify the worktree, branch, status and HEAD; read this roadmap and relevant patterns.
2. State the exact intended changes, then implement only that approved scope.
3. Run appropriate verification, normally `npm run type-check`, scoped lint, and
   `npm run build` when feasible. Inspect scripts before executing them. Do not
   run database-backed mutating verifiers, migrations or external-service writes
   without explicit authorization.
4. Review `git diff --check`, the complete diff including new files, and final
   status. Separate baseline failures from regressions. Do not fix unrelated
   files to force a green check. If tools are missing and installation is
   prohibited, report the verification blocker rather than claiming a pass.
5. When verification is satisfactory, create one local commit for the completed
   unit. Do not push, merge or rebase.
6. Report changes, checks, limitations, status and commit hash. **STOP.** Recommend
   the next unit only; wait for explicit approval before starting it.

Unit 1's intended commit is `feat(erm): establish isolated platform foundation`.
