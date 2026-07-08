# REFM Platform Summary (Real Estate Financial Modeling)

**Purpose of this document.** A complete, source-verified written summary of the REFM platform: every module, what it contains, and what each feature does. It is written to feed the pricing page and pricing architecture, so it also surfaces every gateable, meterable, and limitable capability, and it marks each item explicitly as **Live**, **In development**, or **Stubbed/placeholder** so a not-yet-built feature is never represented as sellable.

**How status is determined.** Status reflects what the source code actually does, cross-checked against `CLAUDE-FEATURES.md` and `CLAUDE-ROUTES.md` but with the code as the source of truth. There is one nuance to read carefully: the module registry (`src/hubs/modeling/platforms/refm/lib/modules-config.ts`) carries a cosmetic `status` flag that drives the sidebar badge (DONE / WIP / SOON / PRO / ENT). Modules 2 through 5 carry a `wip` badge but are functionally complete and operational in code (full engines, outputs, verifiers). Where the badge and the build reality differ, this document states both and flags it for founder confirmation.

**Scope.** This is documentation only. No code was changed to produce it.

---

## Platform at a glance

REFM is an institutional-grade real estate development financial model delivered as a browser workspace. A user creates a project, defines its structure and assumptions across input modules, and the platform computes a full three-statement model, investment returns, and scenario comparisons, then exports them to Excel and PDF.

The platform exposes **11 module slots** in the sidebar. Modules 1 through 6 are built; modules 7 through 11 are placeholders (disabled in the sidebar with "Coming soon" / plan-gated labels).

| # | Module | Sidebar badge | Build reality | Required plan flag |
|---|--------|---------------|---------------|--------------------|
| 1 | Setup (Project Setup & Financial Structure) | DONE | **Live** | free |
| 2 | Revenue (Revenue & Sales Projections) | WIP | **Live** (built + operational) | free |
| 3 | OpEx (Operating Expenses) | WIP | **Live** (built + operational) | free |
| 4 | Financials (Financial Statements) | WIP | **Live** (built + operational) | free |
| 5 | Returns (Returns & Valuation Analysis) | WIP | **Live** (built + operational) | free |
| 6 | Scenarios (Scenario Analysis) | DONE | **Live** | free |
| 7 | Reports (Reports & Visualizations) | SOON | **Stubbed** (disabled) | free |
| 8 | Portfolio | SOON | **Stubbed** (disabled) | free |
| 9 | Market Data | SOON | **Stubbed** (disabled) | free |
| 10 | Collaborate | PRO | **Stubbed** (disabled) | professional |
| 11 | API Access | ENT | **Stubbed** (disabled) | enterprise |

A shared, pure computation pipeline underlies the analytical modules: `applyOverrides` (for scenarios) then `computeFinancialsSnapshot` (M1 to M3 engines into a financials snapshot) then `computeReturnsSnapshot` (returns and RE metrics). On-screen tabs and the PDF and Excel exports read the same shared report builders, so outputs stay in sync.

---

## Module 1: Setup (Project Setup & Financial Structure)

**Status: Live.**

**What it does.** The foundational module where the user defines the entire project structure: the timeline and phases, the land, the assets and their sub-units, the construction cost build-up, and the financing stack. Everything downstream reads from here.

**Tabs (4):** Project & Phases, Assets & Sub-units, Capex (Costs), Financing.

**Key inputs.**
- **Project identity:** name, currency, project start date, status (`draft` / `active` / `archived`), location, and display settings (scale: full / thousands / millions; decimals: 0 / 2 / 3) that drive number formatting platform-wide.
- **Phases:** per-phase name, start date, construction periods (years), operations periods (years), status (`planning` / `construction` / `operational`). Construction end, operations start, and operations end are derived.
- **Land parcels:** name, area (sqm), rate (currency per sqm), and cash percent vs in-kind percent split. Optional Net Developable Area (NDA) deduction with project-level or per-asset scope and roads percent / parks percent inputs. Land allocation mode: `sqm` / `percent` / `autoByBua`.
- **Assets (grouped by phase):** name, phase, strategy (`Sell` / `Operate` / `Lease` / `Sell + Manage`), asset type, status, visibility, useful life (for Operate / Lease depreciation), management agreement (for Sell + Manage). Area fields: GFA, BUA, sellable BUA, parking bays.
- **Sub-units (per asset):** type, category (`Sellable` / `Operable` / `Leasable` / `Support`), area, unit size, count, rate, rate unit, plus per-parcel land allocation.
- **Cost lines (per asset):** a catalog of standard lines plus custom lines, each with a calculation method. Methods include fixed amount, rate per land / NDA / GFA / BUA / NSA / unit / parking bay, rate times support area, rate times parking area, rate times a specific sub-unit, per-sub-unit custom rates, and percent-based methods. Each line has a value, start and end period, a phasing curve (`even` / `frontloaded` / `backloaded` / `sCurve` / `manual` / `phase_aligned`), an on/off toggle, and a per-asset override capability. Cost stage (Land, Hard, Soft, Operating) auto-derives.
- **Financing:** minimum cash reserve; IDC (interest during construction) policy with allocation basis (`land` / `bua`), capitalize flag, and funding mode (`debt_drawdown` / `cash` / `conditional`); a funding method selector (Method 1 Fixed Ratio, Method 2 Net Funding Requirement, Method 3 Cash Deficit, Method 4 Fixed Amount) each with its own debt/equity split or amount inputs; per-parcel land funding splits; and debt facilities (tranches) with origin (`new` / `existing`), facility type, interest rate, drawdown method (`lumpsum` / `prorata` / `percent_of_capex`), repayment method (`bullet` / `straight_line` / `per_interest`), opening balance, repayment start year, and remaining repayment periods.

**Key outputs.**
- Project timeline (start, end, total periods).
- Land reconciliation table (gross, net of NDA, allocated, with under/over-allocation warnings).
- Global project totals (NSA, BUA, GFA, land cost, area by category, parking bays).
- Capex schedule (per period by asset and by stage), capex summary by treatment.
- Financing schedules: capex breakdown, funding requirement (per method and selected), debt required per facility, equity required (cash and in-kind), debt movement, combined debt service, finance cost, IDC summary, equity movement, funding gap (Methods 2 and 3), and cash sweep (conditional IDC).

**Notable sub-features.** Multi-phase projects with overlapping windows; the Sell + Manage strategy spawns a companion Operate asset; 14-plus cost methods with per-asset overrides; manual percent phasing with auto-normalization; project-wide display scale.

**Cross-module dependencies.** Feeds Modules 2, 3, 4, and 5 with all structural and cost and financing data. Reads nothing upstream (it is the foundation).

---

## Module 2: Revenue (Revenue & Sales Projections)

**Status: Live** (built and operational; sidebar badge reads WIP).

**What it does.** Models per-asset revenue and the matching cost of sales, by strategy. Resolves sales cohorts, recognition timing, cash collection profiles, hospitality room revenue, and lease income, and produces revenue schedules, receivable and unearned-revenue roll-forwards, and the cost-of-sales vintage matrix.

**Tabs (5):** Inputs, Revenue (output), Cost of Sales (output), Schedules (raw feed), Escrow.

**Key inputs.**
- **For Sell assets:** pre-sales velocity grid (percent of units or sqm sold per construction period), sales-during-operation velocity grid, price indexation (method `none` / `single_rate` / `yoy_compound` / `step` with rate, start year, and per-step uplifts), cash payment profile (per-period collection percentages, profile mode `absolute_with_catchup`), and revenue recognition profile (method `point_in_time` with anchor `handover` / `sale_year` / `custom`, or `over_time` with per-period percentages).
- **For Operate (hospitality) assets:** starting ADR with ADR indexation, occupancy per period, guests per occupied room, days per year, and ancillary revenue (F&B and Other) each with a mode (`percent_of_rooms` / `per_guest` / `fixed_amount`) and value. Soft-open operations-start override.
- **For Lease assets:** base rent rate, rent indexation (same method set as Sell), occupancy per period, operations-start override.
- **Escrow:** held percent and release year per asset (pre-sales cash held in escrow).

**Key outputs.**
- Revenue output narratives per asset: SQM sold (pre-sales and sales-during-operation, with cumulative percent), revenue (sale value), revenue recognised (vintage matrix), cash collected (vintage matrix), accounts receivable, and unearned revenue. Hospitality output shows capacity (available and occupied room nights), ADR, and rooms / F&B / Other revenue.
- Cost of sales output: per-asset drivers, the capex-year by recognition-year vintage matrix, CoS summary (construction vs operations), and inventory roll-forward.
- Schedules (raw feed): income-statement feed (revenue, CoS, gross margin), balance-sheet feed (closing inventory, AR, unearned revenue), and cash-flow feed (cash collected, capex).
- Escrow output: pre-sales by asset, escrow balance roll-forward, and cash-flow impact.

**Notable sub-features.** Velocity grids scale automatically with M1 sub-unit inventory; three recognition modes; per-sub-unit ADR for hospitality; DSO and AR-days drivers for hospitality and lease; zero-row hiding.

**Cross-module dependencies.** Reads M1 (assets, sub-units, capex, timeline). Feeds M3 (revenue context for percent-of-revenue opex), M4 (recognition, cash, CoS, AR / UR), and M5 (revenue by strategy).

---

## Module 3: OpEx (Operating Expenses)

**Status: Live** (built and operational; sidebar badge reads WIP).

**What it does.** Models operating expenses for Operate and Lease assets plus HQ corporate overheads, with per-line inflation, and an accounts-payable roll-forward driven by Days Payable Outstanding.

**Tabs (2):** Inputs, Opex Output.

**Key inputs.**
- **Asset-level inflation default:** method pills `Off` / `Flat` / `Compound` / `Per-Year` with a rate or a per-year growth grid; applies to fixed-cost lines that inherit it.
- **Opex line items (per asset and per HQ):** name, category, mode, value (single rate or year-by-year), inflation (inherit or override), on/off, delete.
  - Categories cover hospitality (direct rooms / F&B / other, indirect G&A / IT / S&M / POM / energy / EOSB, management base / tech / incentive, replacement reserve, rent and insurance, property tax, utilities, other), lease (management, repairs and maintenance, rent and insurance, utilities, CAM, indirect G&A, property tax, replacement reserve, other), and HQ (payroll, office, professional, other).
  - Modes: fixed baseline, percent of room / F&B / other / total / lease revenue, per room per year, per sqm per year, and percent of GOP. Only fixed-cost modes take inflation; percent-of-revenue modes auto-escalate with revenue.
- **Accounts payable config:** project default DPO, per-asset DPO override, days per year.

**Key outputs.**
- Per-asset opex narratives grouped by hospitality (direct, indirect, management, reserves) or lease (operating costs, pass-through recoveries memo, other charges).
- Project rollup: HQ overheads and project opex grouped by direct / indirect / management / reserves, plus project total opex.
- Accounts payable schedule (opening, opex incurred, cash paid, closing) per asset, HQ, and project total.

**Notable sub-features.** Asset default plus per-line inflation overrides; year-by-year rate mode that bypasses inflation; percent-of-revenue auto-escalation; DPO-driven AP.

**Cross-module dependencies.** Reads M1 (assets, sub-units, phases) and M2 (revenue streams). Feeds M4 (opex into P&L, AP into balance sheet, cash paid into cash flow) and M5 (opex into NOI and margins).

---

## Module 4: Financials (Financial Statements)

**Status: Live** (built and operational; sidebar badge reads WIP).

**What it does.** Turns upstream data into the four financial statements plus supporting schedules. The balance sheet balances by construction, and the direct and indirect cash-flow methods reconcile to each other.

**Tabs (4):** Schedules (with Fixed Assets and BS Schedules sub-tabs), P&L, Cash Flow, Balance Sheet.

**Key inputs.**
- **Fixed assets:** per-asset depreciation method (straight-line or reducing-balance), useful life, reducing-balance rate.
- **P&L:** terminology mode (`standard` with EBITDA / EBIT / Tax, or `saudi` with Zakat labels), tax or zakat rate, phase filter.
- **Cash Flow:** method toggle (Direct vs Indirect), phase filter.
- **Balance Sheet:** operating AR days (DSO), statutory reserve transfer rate and cap (Saudi default), and an optional share-capital override.

**Key outputs.**
- **P&L:** revenue by strategy, cost of sales, opex, EBITDA, depreciation and amortization, EBIT, interest, PBT, tax or zakat, PAT, with per-period and total columns. Phase-filtered view stops at EBITDA.
- **Cash Flow (Direct):** operations (revenue received, escrow adjustments, opex paid, tax paid), investing (capex), financing (equity, debt, principal, interest, dividends), net cash flow, opening and closing cash.
- **Cash Flow (Indirect):** PAT plus non-cash add-backs and working-capital changes, reconciling to the direct method.
- **Balance Sheet:** fixed assets and land; current assets (cash, operating AR, residential receivables, inventory, restricted escrow cash); current liabilities (AP, unearned revenue); debt; equity (share capital, statutory reserve, retained earnings); a balance check; and a reconciliation bridge that decomposes any imbalance line by line.
- **Schedules:** per-asset land and depreciable-asset roll-forwards (including IDC integration), and the BS feeders (residential receivables, operating receivables, inventory, restricted escrow, accounts payable, unearned revenue, debt by tranche, equity cumulative, retained earnings).

**Notable sub-features.** Country / terminology modes; phase filtering with land-share allocation of D&A and tranche-filtered interest; IDC capitalised into the depreciable basis for Operate / Lease and unwound through CoS for Sell; statutory reserve mechanics; dividend line integrated into cash flow and balance sheet.

**Cross-module dependencies.** Reads M1, M2, and M3. Feeds M5 (returns) and M6 (per-case financials).

---

## Module 5: Returns (Returns & Valuation Analysis)

**Status: Live** (built and operational; sidebar badge reads WIP).

**What it does.** Computes investment returns and real-estate operating metrics from the M4 financials, including a sponsor-IRR view, multi-partner equity splits, exit-year analysis, and a two-way sensitivity grid.

**Tabs (3):** Returns, RE Metrics, Case Comparison.

**Key inputs.**
- **Returns assumptions:** discount rate, exit year, terminal value method (`Exit Multiple` / `Perpetuity (Gordon)` / `None`), exit multiple, perpetuity growth.
- **Equity partners:** partner names and per-partner allocation of cash / in-kind / existing equity by amount or percent, with auto-rebalance.
- **Lender covenants:** editable thresholds and operators for DSCR, ICR, LTV, debt yield, and custom metrics.

**Key outputs.**
- Returns on three cash-flow bases: FCFF (unlevered), FCFE (levered), and Distributed Equity (realized cash distributions), each with IRR, the cash-flow build-up from inception to exit, and a terminal value.
- Headline KPIs: Project IRR (FCFF), Equity IRR (FCFE), Distributed Equity IRR, Equity Multiple.
- Development economics: total development cost, total financing cost, profit before and after financing, development margin.
- Sources and uses (reconciles the capital stack).
- Per-partner returns (invested, shareholding, dividends, terminal distribution, IRR, MOIC).
- Two-way sensitivity grid (exit cap rate, discount rate, sales price percent, ADR percent, construction cost percent) showing equity IRR with a heatmap.
- RE Metrics: yield on cost, cap rate at exit, profit on cost, profit margin, equity multiple, LTV at exit, debt yield, min and average DSCR, min and average interest cover, average cash-on-cash, peak equity, max negative FCFE, GDV, cost-to-value, funding mix percentages, stabilised and exit NOI, stabilisation year, terminal enterprise and equity value, an exit-year analysis table, hospitality operating metrics (occupancy, ADR, RevPAR, revenue splits, available room nights), residential metrics (GDV, units sold, average price per unit and per sqm, pre-sales percent, sales velocity), lease metrics (GLA, occupancy, rent per leased sqm, total lease revenue), and the lender covenant pass/breach panel.

**Case Comparison KPI set** (the 17 KPIs in `CASE_KPIS`, shared with Module 6 and the PDF): Equity IRR (FCFE), Project IRR (FCFF), Distributed-Equity IRR, Equity MOIC, Equity Multiple, NPV (FCFF), Gross Development Value, Land Cost, Capex (construction), Total Development Cost, Total Financing Cost, Profit after Financing, Development Margin, Cap Rate at Exit, Min DSCR, Peak Equity, Terminal Equity Value.

**Notable sub-features.** Three terminal-value methods; multi-partner equity with auto-rebalance and per-partner IRR; exit-year hold-vs-sell table; two-way sensitivity (cap rate and discount rate are exact re-runs, price / ADR / cost are proportional shocks); terminology inherited from M4.

**Cross-module dependencies.** Reads M4 (financials snapshot) plus M1, M2, M3 for operating-metric bucketing. Feeds M6 (per-case KPI comparison).

---

## Module 6: Scenarios (Scenario Analysis)

**Status: Live.**

**What it does.** A what-if workbench over the existing case engine. The user creates multiple cases (Management base plus scenarios), overrides any input per case through an assumptions grid, and compares headline KPIs side by side. Scenarios are override-driven: each case stores a flat map of field-path to value, is recomputed by applying its overrides to the base model and running the full pipeline, so every case is fresh and consistent.

**Sections (3):** Cases, Assumptions by case (the grid), Comparison.

**Key inputs.**
- A "Use scenarios?" on/off toggle (data is preserved when off).
- Case management: add, rename, set active, delete (the base is never deletable).
- The assumptions grid: a field search and an add-row picker grouped by category (Project, Construction, Financing, Revenue, Opex); each row is a lever and each column is a case; cells are edited per case with per-cell and per-row reset. The base (Management) column is editable and changes the base every module reads.

**Key outputs.**
- The override map per case and a real override count (only fields that actually differ from base).
- The comparison matrix: the 17 `CASE_KPIS` per case with deltas versus the base case.

**Notable sub-features (and lever gating).** The picker only offers fields that round-trip the diff grammar. Two gating layers keep the grid honest, verified empirically against the live project by `verify-module6-field-census.ts`:
- `nonEconomicLeverReason` drops fields that are never financial levers (identity, labels, display and UI view-state, engine-derived geometry, seed-only revenue templates, legacy per-phase dividend fields, historical baselines, absolute period indices).
- `inactiveLeverReason` annotates config-inert economic levers with "not used under current settings" (for example, fixed-ratio debt percent when funding is gap-sized, exit multiple under a perpetuity terminal, per-period indexation rate, cross-strategy revenue blocks). These stay visible because they become live when the config changes.
- Per-period levers (such as sub-unit occupancy) are excluded entirely from the grid.

**Cross-module dependencies.** Reads the base snapshot and recomputes through the M4 financials and M5 returns pipelines per case. Every input any module reads is a potential override target. Cases and overrides persist on the project.

---

## Module 7: Reports (Reports & Visualizations)

**Status: Stubbed (disabled in the sidebar, "Coming soon").**

**What it does today.** Nothing functional. The module slot is a placeholder. Note that report **outputs** (PDF and Excel) already exist as platform-wide export features (see below); this module slot is specifically the planned in-app dashboards and charts surface.

**Planned content (from the registry, not built):** configurable dashboards across modules; charts for revenue, cash flow, capital structure, and returns; sensitivity tornado and waterfall visuals; export-ready visual report packs.

**Do not represent as sellable.**

---

## Module 8: Portfolio

**Status: Stubbed (disabled in the sidebar, "Coming soon").**

**What it does today.** Nothing functional. Placeholder slot.

**Planned content (not built):** cross-project roll-up of multiple developments; aggregate returns, cash flows, and capital needs; capital allocation and funding timeline view; portfolio-level KPIs and concentration analysis.

**Do not represent as sellable.**

---

## Module 9: Market Data

**Status: Stubbed (disabled in the sidebar, "Coming soon").**

**What it does today.** Nothing functional. Placeholder slot. This is the intended home of AI-driven market inputs, but no implementation exists (see AI features below: the agent routes are placeholders that return `{ status: 'ok' }`).

**Planned content (not built):** comparable transactions feed; benchmark cap rates, rents, and sale prices; construction cost indices; location and demand analytics.

**Do not represent as sellable.**

---

## Module 10: Collaborate

**Status: Stubbed (disabled in the sidebar; labeled "Requires Professional plan").**

**What it does today.** Nothing functional. The implementation file is an empty placeholder. The only collaboration-adjacent code that exists is the RBAC role model (roles, permissions, and a `canAddComments` permission flag), but there is no comment storage, no sharing mechanism, no backend role sync, and no activity log integration.

**Planned content (not built):** shared project access for teams; comments and review workflow; role-based permissions; change notifications and activity log.

**Do not represent as sellable.** The RBAC scaffolding exists and could underpin this later, but the collaboration product itself is unbuilt.

---

## Module 11: API Access

**Status: Stubbed (disabled in the sidebar; labeled "Requires Enterprise plan").**

**What it does today.** Nothing functional. The implementation file is an empty placeholder. There are no public or programmatic API endpoints, no API-key or OAuth management, no webhooks, and no scheduled exports. The internal `/api/refm/projects/*` routes exist only to serve the web UI and require a logged-in session.

**Planned content (not built):** programmatic access to models and outputs; REST endpoints for inputs and results; automated scheduled exports; webhooks for downstream integrations.

**Do not represent as sellable.**

---

## Platform-wide features (not tied to one module)

### Excel export

**Status: Live (built).** Wired into the Export modal as "Excel Model" (`generateModelWorkbookBuffer` from `lib/excel/buildModelWorkbook.ts`).

The Excel model is a **hardcoded snapshot mirror**: every computed cell is the platform-computed value written as a constant. Editing a cell does not recalculate; the user re-exports after changing inputs in the platform. It is a module-for-module mirror with these sheets, in module order: Cover, Inputs (all assumptions consolidated), Timeline, Land & Area, Capex, Revenue, Opex, Financing, Schedules, P&L, Cash Flow, Balance Sheet, Returns, Checks. Display scale (full / thousands / millions) and decimals are selectable. Guarded by `verify-excel-export` and `verify-excel-recalc`.

There is a separate, older live-formula approach in the repo (`lib/excel/liveModel.ts` and legacy `export-excel-*.ts` files) that is not the wired export path; the wired path is the hardcoded mirror described above.

### PDF and report outputs

**Status: Live (built).** Two PDF outputs plus a guide PDF, all landscape A4, all reading the same shared report builders as the on-screen tabs (so they stay in sync).
- **Full-project PDF** (`generateProjectPdf`): cover, auto-generated executive summary, then one page per selected module and tab, with period-table pagination. Covers Modules 1 through 5 content plus the M5 Case Comparison.
- **Executive summary PDF** (`generateSummaryPdf`): cover plus the executive summary only.
- **Platform guide PDF** (`lib/guide`): an auto-generated walkthrough derived from the module and tab registry, also downloadable as Markdown and viewable in-app.

**Export modal selection** (`ExportModal.tsx`): choose format (Full PDF, Summary PDF, Excel), then per-module and per-tab inclusion (PDF full), a version picker (current working draft or any saved version), number scale, decimals, and a scenario case picker. Only built modules (1 to 5) are selectable as full PDF content; future modules are not offered.

### Scenario and sensitivity analysis

**Status: Live (built).** Scenario analysis is Module 6 (cases, override grid, comparison matrix). Sensitivity analysis is the two-way grid on the Module 5 Returns tab (equity IRR across two chosen variables). Both feed the PDF.

### Guide / walkthrough

**Status: Live (built).** Auto-updating in-app guide plus Markdown and PDF download, generated from the live module and tab registry.

### Save, version, and persistence

**Status: Live (built).** Projects and versions persist to Supabase (`refm_projects`, `refm_project_versions`). Capabilities: session-based editing with auto-save (debounced), a view/edit lock (projects open read-only until the user clicks Edit, which eliminates version churn), auto-generated version names with major.minor rollover plus a required task name and comment, and paginated version history. Reads are schema-tolerant (fall back gracefully if a migration is not yet applied).

### Roles and permissions (RBAC)

**Status: Live (built) as an in-app model; not yet bound to real subscription or org roles.** Four roles and an 11-key permission map.

Roles: **Admin**, **Analyst**, **Reviewer**, **Viewer**.

Permission keys: `canCreateProject`, `canEditProject`, `canDeleteProject`, `canManageVersions`, `canEditInputs`, `canSave`, `canChangeBranding`, `canViewReports`, `canAddComments`, `canExport`, `canImport`.

Module visibility per role (`MODULE_VISIBILITY`):
- Admin: dashboard, projects, overview, modules 1 to 6.
- Analyst: dashboard, projects, overview, modules 1 to 4 and 6 (note: not module 5).
- Reviewer: dashboard, projects, module 6.
- Viewer: dashboard, module 6.

Permission matrix:

| Permission | Admin | Analyst | Reviewer | Viewer |
|---|:--:|:--:|:--:|:--:|
| canCreateProject | yes | yes | no | no |
| canEditProject | yes | yes | no | no |
| canDeleteProject | yes | no | no | no |
| canManageVersions | yes | yes | no | no |
| canEditInputs | yes | yes | no | no |
| canSave | yes | yes | no | no |
| canChangeBranding | yes | no | no | no |
| canViewReports | yes | yes | yes | yes |
| canAddComments | yes | yes | yes | no |
| canExport | yes | yes | yes | no |
| canImport | yes | yes | no | no |

**Important caveat for pricing:** RBAC is currently an in-app selector (defaults to Admin) and is enforced only at the UI layer. The REFM API routes do not yet enforce per-role checks. So the role model is real and ready to bind, but it is not yet wired to authenticated user roles or to a subscription tier.

### Platform shell

**Status: Live (built).** Project switching and creation via a wizard, dashboard hub, per-project overview, topbar (project and version controls, case switcher, last-saved badge, Edit / Save, Export, Guide, RBAC indicator, dark mode, sign out), and a sidebar driven by the dynamic module registry (admin-reorderable, with hidden modules excluded and non-routable).

### White-label and branding

**Status: Built as global admin configuration; not per-tenant or plan-gated at runtime.** A `branding_config` table (scope `global` or per-user UUID) and a `useBrandingStore` plus `BrandingThemeApplier` drive platform name, logo (emoji or image), and primary and secondary colors via the admin Header Settings surface. The schema supports per-user scope, but the runtime today applies a single global brand and does not enforce a white-label entitlement. A `white_label` and `pdf_whitelabel` feature key exist in the pricing label set but are not enforced in code.

### AI features

**Status: Stubbed (placeholders only).** Two agent routes exist, `app/api/agents/market-rates/route.ts` and `app/api/agents/research/route.ts`, and both are placeholders returning `{ status: 'ok' }`. Feature keys `ai_contextual` and `ai_research` exist only as labels for the pricing UI. There is no market-rates feed, no research agent, and no assumption-suggestion engine wired into the modeling platform. Module 9 (Market Data) is the intended home and is itself a stub.

**Do not represent AI features as sellable.**

### Collaboration and API

Covered as Modules 10 and 11 above. Both are stubs.

---

## Pricing-relevant capabilities (appendix)

This appendix lists, in one place, every capability that is gateable, meterable, or limitable, with its current status, so tiers can be designed from it. "Gateable" means it can be turned on or off per tier. "Meterable" means it can be counted and billed by usage. "Limitable" means a numeric cap can be applied.

### A. Hardcoded limits and quotas (limitable)

| Capability | Current state | Where | Status |
|---|---|---|---|
| REFM projects per user | **No quota enforced.** Creating a REFM project (`/api/refm/projects` POST) inserts with no count or limit check. | `app/api/refm/projects/route.ts` | Unlimited today; **needs a cap to be limitable** |
| Assets per project | No cap | state / wizard | Unlimited today |
| Sub-units per asset | No cap | state | Unlimited today |
| Cost lines per asset | No cap | state | Unlimited today |
| Phases per project | No cap | state | Unlimited today |
| Financing tranches | No cap | state | Unlimited today |
| Equity partners | No cap | returns / partners | Unlimited today |
| Scenario cases | No cap (seeds Management plus two scenarios) | cases engine | Unlimited today |
| Saved versions per project | Fetch safety cap of 50,000 (page size 1,000); this is a read-pagination guard, not a sellable quota | `lib/persistence/server.ts` (`VERSION_HARD_CAP`, `VERSION_PAGE_SIZE`) | Safety cap only |
| Seats / users per org | No concept of an org or seats in the REFM workspace | n/a | Not built |

Separately, a generic non-REFM projects API (`/api/projects`, a different `projects` table from `refm_projects`) does enforce a per-user `projects_limit` (default 3 set at registration). This is **not** the REFM modeling hub and does not limit REFM project creation. Founder should confirm whether this generic limit is intended to apply to REFM at all.

**Takeaway for pricing:** the only limit-style enforcement that exists is on a separate, non-REFM projects table. To make projects, assets, scenarios, versions, or seats limitable in REFM, caps must be added; none exist today.

### B. Module access (gateable)

| Module | Plan flag in registry | Sidebar state | Build reality |
|---|---|---|---|
| 1 Setup | free | enabled | Live |
| 2 Revenue | free | enabled | Live |
| 3 OpEx | free | enabled | Live |
| 4 Financials | free | enabled | Live |
| 5 Returns | free | enabled | Live |
| 6 Scenarios | free | enabled | Live |
| 7 Reports | free | disabled (Coming soon) | Stubbed |
| 8 Portfolio | free | disabled (Coming soon) | Stubbed |
| 9 Market Data | free | disabled (Coming soon) | Stubbed |
| 10 Collaborate | professional | disabled (PRO) | Stubbed |
| 11 API Access | enterprise | disabled (ENT) | Stubbed |

**Gating reality:** the workspace gate `canAccess(featureKey)` currently returns true only when the module's `requiredPlan` is `free`, and ignores the user's actual subscription. So today every paid module reads as locked for everyone, and the free modules are open to everyone. There is no live binding between a module and a paid tier. The `requiredPlan` flags on modules 10 and 11 are intent markers, not enforced entitlements, and both modules are unbuilt anyway.

### C. Tier and feature infrastructure (gateable, infrastructure only)

| Item | State | Notes |
|---|---|---|
| `pricing_plans` table | **Dropped** (migration 145) | The older plan rows (for example the $699 / $999 figures in migration 076) are stale and no longer the source of truth. Do not cite them as current pricing. |
| `platform_pricing` table | Exists | Powers the public pricing page (`app/pricing/page.tsx`) and admin pricing editor (`app/api/admin/pricing/platform`). |
| `platform_features` + `plan_feature_access` tables | Exist | Map features to plans. Consumed by the public pricing page and admin editor, but **not** read by the REFM workspace to enforce entitlements. |
| `UpgradePrompt` feature labels | Built (labels only) | Human-readable labels for keys such as `pdf_whitelabel`, `excel_static`, `excel_formula`, `ai_contextual`, `ai_research`, `white_label`. These are display strings, not enforcement. |

**Takeaway:** the pricing display and admin surfaces are built, but plan-based feature enforcement in the product is not wired. Tiers can be designed and shown, but turning a tier into an actual entitlement requires wiring the workspace to read subscription status against `plan_feature_access` at the gate points (module entry, export, save, branding).

### D. Save, version, export, and import (gateable via RBAC, today)

| Capability | Gate that exists | Status |
|---|---|---|
| Save / create version | `canSave` permission (role-based, UI-enforced) | Built (role gate), not plan-gated |
| Manage version history | `canManageVersions` | Built (role gate) |
| Export PDF and Excel | `canExport` | Built (role gate); no plan-based restriction on PDF or Excel today |
| Import project snapshot | `canImport` | Built (role gate) |
| Add comments | `canAddComments` | Permission flag exists; no comment feature behind it |

**Takeaway:** save / version / export / import are all gateable today by role, and could be made plan-gateable. PDF and Excel export are fully built and currently available to any role with `canExport`.

### E. White-label and branding (gateable)

| Capability | State | Status |
|---|---|---|
| Platform name, logo, primary and secondary colors | Editable by admin via Header Settings; `branding_config` supports global or per-user scope | Built as global admin config |
| White-label entitlement (`white_label`, `pdf_whitelabel`) | Feature keys exist as labels; no runtime enforcement | Not enforced |
| Per-tenant or per-customer branding | Schema supports per-user scope, but runtime applies one global brand | Not wired for multi-tenant |

**Takeaway:** branding is configurable centrally and is a natural enterprise gate, but it is not currently tenant-scoped at runtime nor enforced by plan.

### F. AI features (gateable / meterable when built)

| Capability | State | Status |
|---|---|---|
| Market rates agent | Placeholder route returning `{ status: 'ok' }` | Stubbed |
| Research agent | Placeholder route returning `{ status: 'ok' }` | Stubbed |
| Assumption suggestions / contextual help | Not implemented; label only | Stubbed |

**Takeaway:** AI is a strong future meterable line (per-query or per-month), but nothing is built. Do not sell it yet.

### G. Summary: what is sellable today vs not

**Built and demonstrably working (safe to describe in a plan, subject to wiring the actual gate):**
- Modules 1 to 6 (full modeling: setup, revenue, opex, financial statements, returns and RE metrics, scenario analysis).
- PDF export (full and executive summary) and Excel export (hardcoded mirror).
- Scenario analysis and two-way sensitivity.
- Versioning and auto-save with named versions and history.
- In-app guide.
- Role-based access control (4 roles) at the UI layer.
- Central branding configuration (admin).

**Not built; must not be represented as sellable:**
- Module 7 Reports (in-app dashboards and charts).
- Module 8 Portfolio.
- Module 9 Market Data.
- Module 10 Collaborate (no sharing, no comments storage, no activity log).
- Module 11 API Access (no public API, keys, or webhooks).
- AI features (market rates, research, assumption suggestions).
- Runtime plan-based entitlement enforcement (the gate ignores subscription today).
- Per-tenant white-label enforcement and seat or org concepts.

**Limits to add before they can be metered or capped (none exist today in REFM):**
- Projects, assets, sub-units, cost lines, phases, tranches, partners, scenario cases, versions, seats.

---

## Verification

**Every module slot in the code is represented above.** The registry (`modules-config.ts`) defines exactly 11 module slots (`module1` through `module11`); all 11 have a section. The component directory contains implementations only for modules 1 through 6 (Module1 through Module6 components); modules 7 through 11 have empty placeholder files, consistent with their stubbed status.

### Needs founder confirmation

1. **WIP badge vs build reality on Modules 2 to 5.** These modules are functionally complete and operational in code (engines, outputs, verifiers), yet the registry assigns them a `wip` status that renders a "WIP" sidebar badge. Confirm whether they should be promoted to `done` (DONE badge) for go-to-market, or whether the WIP badge is intentional.

2. **The 3-project limit on the generic `/api/projects` table.** A non-REFM projects API enforces `projects_limit` (default 3, set at registration on the `users` table). REFM project creation (`/api/refm/projects`) enforces nothing. Confirm whether the generic limit is meant to apply to REFM, whether the two project systems should converge, and what the intended REFM project quota per tier should be.

3. **Subscription-to-entitlement wiring.** `platform_features` and `plan_feature_access` exist and the public pricing page reads them, but the REFM workspace gate (`canAccess`) ignores subscription entirely and only checks the static `requiredPlan === 'free'`. Confirm the intended enforcement points (module entry, export, save, branding, AI) so the entitlement layer can be specified.

4. **RBAC binding.** Roles and permissions are modeled and UI-enforced but default to Admin and are not bound to authenticated user roles, nor enforced in the API. Confirm whether RBAC tiers (for example Reviewer / Viewer seats) are themselves a pricing axis, and whether API-layer enforcement is in scope before launch.

5. **Module 5 visibility for Analyst.** `MODULE_VISIBILITY` grants Analyst modules 1 to 4 and 6 but omits module 5 (Returns). Confirm whether excluding Returns from the Analyst role is intentional.

6. **Excel export variants.** The wired export is the hardcoded-snapshot mirror. A separate live-formula Excel implementation (`liveModel.ts` and legacy `export-excel-*.ts`) exists in the repo but is not the wired path. Confirm whether live-formula Excel is a planned premium tier feature distinct from the snapshot export.

7. **Stale pricing figures.** Migration 076 contains historical plan prices (for example $699 and $999) but `pricing_plans` was dropped (migration 145). Confirm the current canonical pricing source so this document and the pricing page agree.
