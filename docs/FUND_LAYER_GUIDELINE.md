# FMP Fund Layer: Guideline & Build Plan

Reference doc for the fund layer in the REFM platform. This is the scope, the design decisions, and the standing rules. Prompts are given to Claude Code one step at a time, verified between each. This file is the source of truth for what we are building and why.

---

## 1. What the fund layer is

A project today models a single development. The fund layer adds the economics of a fund or GP-LP structure on top:

- a **management fee** charged on the capital
- a **preferred return (hurdle)** to investors
- a **performance fee (carry)** to the fund manager once the hurdle is met
- returns reported both **gross** (before fund fees) and **net** (after)

It is **additive and toggle-gated**. Every project carries a standalone-vs-fund toggle, default OFF. With the toggle off the model behaves exactly as it does today, byte-identical returns. Turning it on layers the fund economics in.

It is **independent** of the platform's other systems. It touches the model engine (M4 and M5) in a controlled, additive way, guarded by a regression verifier written before any feature code.

---

## 2. The key design decision: linear fee base

The management fee is charged on an **input-driven base**:

- committed capital (user-entered), or
- total development cost

It is **not** charged on fund size (equity + debt) in v1.

**Why.** The fee is a cash outflow, so it increases the funding requirement: in a cash-deficit or funding-gap scenario the model must raise more funding to keep cash non-negative while paying the fee. That is correct and required. But if the fee base were fund size, then more funding would raise fund size, which would raise the fee, which would raise the funding requirement again. That is a circular loop and it would mean touching the M4 circular solve.

With an input-driven base the flow is one-directional: **the fee raises funding, but the higher funding does not raise the fee.** Linear, testable, and it never enters the circular block.

Fund-size fee base is deferred to v1.1 post-launch. It is already designed as a third enum option on the fee-base toggle, so adding it later is a new option, not a rebuild.

---

## 3. Where it affects the model

| Module / area | What changes | Effect | Additive or engine? |
|---|---|---|---|
| **M1 Project Setup** | New Fund Terms tab: standalone-vs-fund toggle (default off), fee %, fee base choice, hurdle rate, carry %, committed capital, fee-share by party role | Defines the fund inputs. No effect when toggle off | Additive (new tab + table) |
| **Schema** | New fund terms table keyed to project: toggle, fee %, fee base enum, hurdle %, carry %, committed capital, party role + fee-share fields | Storage only. Absent or empty means standalone | Additive migration |
| **M4 Financial Statements + Funding** | Management fee as an expense line, below EBITDA and above Zakat. Because the fee is a cash outflow it **increases the funding requirement**: in a funding-gap scenario the model raises more funding to keep cash non-negative while paying the fee. Fee base is linear, so the fee does not feed back into its own base | Fee raises the funding requirement by the fee amount (more debt or equity in a gap scenario). Fee does not feed back into fund size. Toggle off means no fee line, identical to today | Engine-adjacent (additive, one-directional, not circular) |
| **M5 Returns** | Adds IRR excluding fund fee (gross), hurdle accrual and unpaid hurdle balance, performance fee once the hurdle is met, distributions net of fee, and post-fee IRR and MOIC. The waterfall runs: return capital, pay preferred/hurdle, then split residual per carry | Splits returns into investor (net of fee) and fund manager (fee income). Gross returns unchanged, net returns lower by the fees | Additive (new return lines + waterfall) |
| **M5 Parties** | Fee income as a return line for the Fund Manager party, tied to the per-partner returns already built | Fund Manager gains fee income, investor parties see net-of-fee returns | Additive |
| **Excel export** | Fee line and waterfall rows added to the relevant tabs, in the locked palette | Presentation of the above | Additive |
| **M7 IC Report** | Fee sections in the IC deck (fee terms, waterfall, net vs gross) | Report presentation only | Additive, post-launch, not gating |
| **Verifiers** | Toggle-off regression first, then waterfall exhausts distributable cash, hurdle balance closes, fee-off equals current behaviour, fee flows to funding requirement | Proves the layer is safe and correct | Guardrail |

---

## 4. Build sequence

One step at a time. Diagnose first, build, verify, hold for review, then the next.

| Step | Title | Delivers | Migration | Depends on | Engine risk |
|---|---|---|---|---|---|
| 1 | **Toggle-off regression guard** | The verifier, written before any feature code: run the returns snapshot suite with the fund toggle present and OFF, require byte-identical returns to today | Maybe (toggle storage) | - | None (test only) |
| 2 | M1 Fund Terms tab + schema | Fund Terms tab with toggle, fee %, fee base choice, hurdle %, carry %, committed capital, fee-share by party role. Inputs only, no engine wiring | Yes | 1 | None |
| 3 | M4 management fee line + funding impact | Fee line below EBITDA above Zakat on the linear base. Fee flows into the funding requirement so a funding-gap project raises more funding and stays cash-non-negative. Verify no feedback into its own base | Maybe | 2 | Engine-adjacent (linear, one-directional) |
| 4 | M5 waterfall + hurdle + carry | Distribution waterfall: return capital, pay preferred/hurdle with accrual and unpaid balance, then performance fee per carry. Distributions net of fee | Maybe | 3 | Additive return logic |
| 5 | M5 net vs gross returns | Gross IRR (excluding fund fee), post-fee IRR and MOIC, investor net-of-fee returns and Fund Manager fee income wired to per-partner returns and M5 Parties | No | 4 | Additive |
| 6 | Excel export rows | Fee line and waterfall rows in the exported model, locked palette, live formulas | No | 5 | None |
| 7 | End-to-end verify | Toggle off equals today. Toggle on: fee flows to funding requirement, waterfall exhausts distributable cash, hurdle balance closes, gross vs net correct, fund manager fee income correct. Live check on FMP RE HUB | No | 6 | None |

---

## 5. Scope: ship vs wait

**Ships before launch (v1):** M1 Fund Terms tab and toggle, schema, M4 fee line into the funding requirement, M5 hurdle/carry/waterfall/net-and-gross returns, M5 Parties fee income, Excel export rows, the verifiers.

**Waits:**
- fund-size fee base and the circular solve (v1.1, post-launch)
- M7 IC Report fee sections (post-launch, numbers already live in M5 and Excel)
- any fund entity above the project, multi-project funds (future)

---

## 6. Standing rules

- **Regression guard first.** Step 1 is the toggle-off byte-identical verifier, written before any feature code. Nothing ships if it fails.
- **Toggle off equals today.** With the fund toggle off, every existing project produces numerically identical results to today. Non-negotiable.
- **Additive only.** New tab, new table, new lines. No drops, no destructive schema change. Migrations numbered, applied manually by Ahmad in Supabase.
- **Linear fee base only in v1.** Committed capital or total development cost. Do not wire the fund-size base, it is circular.
- **Engine verifiers stay green.** The returns snapshot and returns engine verifiers stay green on every step. The fee line and waterfall get their own checks.
- **Diagnose first.** Every step starts with a read-only diagnosis, reported before building.
- **One step at a time.** Lock and verify a step before the next.
- **Hold for review.** Engine-adjacent steps (M4, M5) hold for Ahmad's live check before push.
- **No em dashes** anywhere in content.
- **Commit and push in the same step**, then confirm the deploy SHA matches HEAD.
