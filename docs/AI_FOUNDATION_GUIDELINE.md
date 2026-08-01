# FMP AI Foundation: Guideline & Build Plan

Reference doc for the AI integration across Financial Modeler Pro. This is the plan and the standing rules. Prompts are shared with Claude Code step by step, one unit at a time, verified between each. This file is the source of truth for what we are building and why.

---

## 1. Vision

Build a **platform-agnostic AI foundation**, not a one-off feature. AI will spread across modules and, later, across platforms (REFM now; ERM and others later). The first live feature is IC narrative generation in Module 7. Everything after it plugs into the same foundation.

Principle: build the engine once. Each AI capability is a **registered feature** with its own on/off toggle, its own caps, and its own grounding rules. New features appear in the admin panel and are turned on from the dashboard, not rebuilt.

---

## 2. What the AI will do (four categories)

The foundation must support all four from day one, even though only category 1 (M7 narrative) ships first.

### Category 1 - Narrative / explanation (model-grounded)
- IC narrative generation (building now): thesis, recommendation, risks + mitigants, returns/exit commentary, scenario takeaway.
- Plain-English model summary; auto exec summaries, risk sections, one-pagers.
- Grounding: the model's own computed numbers. No external data. Cheap, safe.

### Category 2 - Assumption validation / market intelligence (external-grounded)
- Sanity-checks user inputs against market benchmarks: ADR, land rate, construction cost per sqm, cap rate, sales price.
- Example: "Your ADR of SAR 450 is ~20% below the Riyadh 4-star market (SAR 550-600). Confirm?"
- Flags inputs that look wrong before they poison the model. Highest credibility feature.
- Grounding: external market data (own benchmark dataset, or web/market-data source). Decided when this phase is built.

### Category 3 - Guidance / co-pilot (context-grounded)
- Module-aware assistant: knows the user is on M2 Revenue, explains inputs and downstream impact.
- Plain-English what-if: "show me IRR if construction rises 15%" runs the scenario.
- Onboarding guide that walks a new user through building a first model.
- Grounding: module context + current model state.

### Category 4 - Generation / drafting (creates artifacts)
- First-draft model from a project brief ("10 questions -> starter model").
- Scenario generation from a description ("what if sales slow 20%" builds a downside case).
- Deliverable drafting.
- Grounding: model + context.

### Cross-platform
- Each future platform (ERM, BVM, ...) registers its own AI features against the same foundation: its own narrative, its own validation, sharing the same client, metering, and admin controls. Build once, reuse everywhere.

---

## 3. Foundation components (what gets built)

1. **Central AI client** - one server-side Anthropic client all features call. Model config, single call path, error handling. No feature wires the key directly.
2. **Feature registry** - each AI capability registered with: id, name, category, platform, grounding type (model / external / context), enabled flag, per-tier caps. Additive schema.
3. **Server-side metering + usage tracking** - per user, per feature, per tier. Monthly reset. Each call counts. Hard-stop past cap with upgrade nudge. Enforced server-side so the UI cannot bypass it.
4. **Grounding abstraction** - features supply context by type (model / external / context). The client consumes any. Must not assume model-only, because category 2 needs external data.
5. **Admin control panel** - list every registered feature per platform; toggle on/off; set per-tier caps per feature; view usage. New features appear automatically. This is "turn on features from the dashboard".
6. **M7 IC narrative** - the first feature built on the foundation, proving the pattern end to end.

---

## 4. Metering & caps (v1)

- Count **per generation action** (each button press = one API call = one count).
- **Hard stop** at the cap with a clear "monthly AI limit reached" message + upgrade nudge. No call fires past the cap.
- Caps are **admin-editable from the dashboard**, not hardcoded. Stored in the registry, read live by the metering.
- Reset monthly.

Default caps (active plans are USD pro and firm; trial for new users):

| Plan | Monthly generations |
|---|---|
| Trial | 5 |
| Pro ($15,000/yr) | 100 |
| Firm ($27,500/yr) | 500 |

Ahmad changes these anytime from the admin panel.

Cost context: one IC narrative generation is a few cents. Even the top cap is a few dollars a month per heavy user, negligible against plan revenue. Caps exist to stop runaway abuse, not to ration normal use.

---

## 5. M7 IC narrative feature (first build)

- A **Generate** button on each narrative field + a **Generate all** button in the IC report builder.
- Generation reads the model's computed numbers and drafts the narrative in Ahmad's practitioner-teaching voice.
- **Hard grounding rule:** the AI drafts interpretation only. It never invents figures, market data, or claims the model does not support. It writes the reading of the numbers, not new facts.
- Output lands in the field as an **editable draft**. It never auto-saves or overwrites existing text without the user confirming. The user always reviews before it is in the report.
- Voice: practitioner-teaching, constructive not critical, IC-appropriate, no em dashes.
- Metered and capped per the table above, enforced server-side.

---

## 6. Build sequence (units)

One unit at a time. Diagnose first, build, verify, hold for review, then the next. Prompts shared with Code manually, unit by unit.

| Unit | Phase | Title | Migration | Depends on |
|---|---|---|---|---|
| 0 | Foundation | Diagnose AI landscape (key test, existing usage, admin-settings pattern, entitlement model) | No | - |
| 1 | Foundation | Central AI client (single call path) | Maybe | 0 |
| 2 | Foundation | Feature registry (per-feature config, platform-agnostic) | Yes | 1 |
| 3 | Foundation | Server-side metering + monthly usage caps | Yes | 2 |
| 4 | Foundation | Grounding abstraction (model / external / context) | No | 1 |
| 5 | Admin | AI admin control panel (toggles, caps, usage) | Maybe | 2, 3 |
| 6 | M7 | Register IC narrative as first AI feature | No | 2, 5 |
| 7 | M7 | IC narrative generation (grounded, editable draft) | No | 4, 6 |
| 8 | M7 | Generate buttons + quota UI | No | 3, 7 |
| 9 | M7 | End-to-end verify + voice polish | No | 5, 8 |

**Status 2026-08-01: units 0 to 9 are built and live.** The feature registers DISABLED and is switched on per platform in /admin/ai-features. Live text quality is the one thing still unproven: generation currently returns an out-of-credit billing error from the Anthropic account, which the client now reports as a billing problem rather than a model problem. The final read-through of real generated prose happens once credit is added.

Future phases (categories 2-4) are scoped and added as new units when reached. They plug into the same foundation without changing it.

---

## 7. Standing rules (every unit)

- **Diagnose first.** Each unit begins with a read-only diagnosis; Code reports before building.
- **One unit at a time.** Lock and verify a unit before the next. Respect dependencies.
- **Hold for review.** Foundation and AI-spend units hold for Ahmad's live eyeball before push.
- **Server-side enforcement.** Metering and caps enforced on the server. The UI can never bypass a cap.
- **No fabrication.** AI drafts interpretation only, grounded in real data. It never invents figures, rates, or claims.
- **Editable draft.** Generated text is an editable draft; never auto-saves or overwrites without confirmation.
- **Additive only.** Schema additive; migrations numbered, applied manually by Ahmad in Supabase.
- **Engine untouched.** verify-returns-snapshot stays 99/99. No engine or recompute changes.
- **Platform-agnostic.** The foundation serves REFM now and ERM / other platforms later. No REFM hardcoding.
- **Grounding types.** Support model / external / context grounding. Do not assume model-only (ADR/rate validation is coming).
- **Voice.** Ahmad's practitioner-teaching voice. No em dashes anywhere.
- **Commit + push.** On go-ahead: commit then push in the same step; confirm /api/health SHA == HEAD.

---

## 8. Decisions

### Settled

- **Generate-all counting** (raised for Unit 8, settled there). Each field is one counted call, because each is one API call and the count has to track the bill. The UX rule that follows: **state the cost before spending it.** The button reads `Generate all (N)`, a warning appears when N exceeds the remaining allowance, the calls run sequentially (in parallel they would race past the cap and burn credits the server then refuses), and a run that hits the cap stops and reports "Generated 3 of 5".

- **Audit-flagged drafts** (left open by Unit 4, settled at Unit 9). When the numeric audit finds a figure it cannot match to the supplied model data, the draft is **shown with a visible warning, not blocked**. Three reasons: the credit is already spent, so discarding leaves the user nothing; the audit is deliberately conservative and flags derived figures and ordinary prose digits, so auto-rejection would throw away sound drafts; and every draft is reviewed by a human before it enters a pack, which is the control that actually matters. What is NOT acceptable is silence, so the finding is logged server-side and travels with the draft into the review, where the offending figures are listed and the text stays fully editable. Locked by `verify-ic-narrative-e2e`, which fails if Apply is ever disabled on a flagged draft.

  The related prompt rule, added at Unit 9: the model is told to **describe relationships in words rather than compute them** ("the levered return sits well above the unlevered one" instead of stating a difference it worked out). Most flags come from the model doing helpful arithmetic on two supplied figures, so this cuts them at the source rather than explaining them after the fact.

- **Refunding a credit on a failed generation** (was open at Unit 9, BUILT 2026-08-01, migration 206). A generation that produces nothing does not cost quota. The credit is still consumed BEFORE the call, because consuming after success lets concurrent requests all pass the check first, so the concurrency guarantee is unchanged; the failure paths simply give it back through `ai_usage_refund()`, one atomic UPDATE floored at zero that never creates a row. Every AI failure refunds: out of credit, rate limit, timeout, network drop, refusal, unknown error, and a 200 that carried no usable text. A SUCCESS keeps its count, and so does a draft that came back audit-flagged, because the user received usable text and the warning is information about it, not a failure. The quota display re-reads the status endpoint after a failure so the restored number is the server's, not an assumption.

### Still open

- **Market-data source** for category 2 (assumption validation): own benchmark dataset vs web search / external market-data API. Decided when category 2 is built. The foundation leaves room via the external grounding type.


---

## 9. Prerequisites

- Anthropic API key: obtained and entered in admin. Unit 0 confirms it works with a live test call before any build.
