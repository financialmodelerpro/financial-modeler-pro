-- ============================================================
--  169_features_registry_seed_descriptions.sql
--  Seed a short, factual description for every module and non-module feature in
--  features_registry, so the pricing comparison popovers (public + in-app) are
--  populated. DISPLAY only: never affects gating, coverage, or enforcement.
--
--  FILL-ONLY: each UPDATE is guarded by `description IS NULL OR description = ''`
--  so an admin's edit in the Plan Builder is NEVER overwritten on a re-run.
--
--  Honesty: modules 1 to 6 are Live (present tense). Modules 7 to 11 and the
--  not-yet-built non-module features (white-label PDF, seats, RBAC, branding,
--  AI) are marked "Coming soon:" so nothing is claimed to exist today. Module
--  descriptions key off feature_key (module_N) and match the LIVE platform_modules
--  registry: 7 Reports, 8 Portfolio, 9 Market Data, 10 Collaborate, 11 API Access.
--
--  Apply manually via the Supabase dashboard. Idempotent. No em dashes.
-- ============================================================

UPDATE features_registry SET description = 'Define project structure, land allocation, costs, and financing on a foundation built for institutional real estate financial modeling.'
  WHERE feature_key = 'module_1' AND (description IS NULL OR description = '');
UPDATE features_registry SET description = 'Per-asset revenue and matching cost of sales by strategy: cohort sales collection, hospitality room revenue, retail NOI, and Sell-plus-Manage fees.'
  WHERE feature_key = 'module_2' AND (description IS NULL OR description = '');
UPDATE features_registry SET description = 'Operating expenses, payroll, marketing, and fixed-cost schedules, with per-line inflation, driving cash flow across the operations window.'
  WHERE feature_key = 'module_3' AND (description IS NULL OR description = '');
UPDATE features_registry SET description = 'A full three-statement model: P&L, cash flow, and balance sheet that balances by construction, following the Module 1 accounting rules.'
  WHERE feature_key = 'module_4' AND (description IS NULL OR description = '');
UPDATE features_registry SET description = 'Investment returns and real estate metrics: IRR, NPV, MoIC, DSCR, equity multiples, stabilised yield, and a two-way sensitivity grid.'
  WHERE feature_key = 'module_5' AND (description IS NULL OR description = '');
UPDATE features_registry SET description = 'A what-if workbench: override any input per case on the base model and compare headline KPIs side by side across scenarios.'
  WHERE feature_key = 'module_6' AND (description IS NULL OR description = '');
UPDATE features_registry SET description = 'Coming soon: investment committee decks, lender packages, and configurable dashboards and charts built from the live model.'
  WHERE feature_key = 'module_7' AND (description IS NULL OR description = '');
UPDATE features_registry SET description = 'Coming soon: a roll-up across multiple projects with consolidated returns, cash flows, and a combined waterfall.'
  WHERE feature_key = 'module_8' AND (description IS NULL OR description = '');
UPDATE features_registry SET description = 'Coming soon: market comparables, benchmark cap rates and rents, and construction cost indices to support assumptions.'
  WHERE feature_key = 'module_9' AND (description IS NULL OR description = '');
UPDATE features_registry SET description = 'Coming soon: multi-user editing, comments, and approval workflows for investment committee and lender review.'
  WHERE feature_key = 'module_10' AND (description IS NULL OR description = '');
UPDATE features_registry SET description = 'Coming soon: programmatic API access to your models for portfolio dashboards and downstream BI integration.'
  WHERE feature_key = 'module_11' AND (description IS NULL OR description = '');

UPDATE features_registry SET description = 'Export the full project as a formatted, investor-ready PDF report across every built module.'
  WHERE feature_key = 'pdf_export' AND (description IS NULL OR description = '');
UPDATE features_registry SET description = 'Download the model as an Excel workbook with current values captured as a point-in-time snapshot.'
  WHERE feature_key = 'excel_snapshot' AND (description IS NULL OR description = '');
UPDATE features_registry SET description = 'Export an Excel workbook whose cells are formula-linked, so figures recalculate when you change inputs.'
  WHERE feature_key = 'excel_formula' AND (description IS NULL OR description = '');
UPDATE features_registry SET description = 'Coming soon: export PDF reports under your own brand, with your logo and colours in place of the platform default.'
  WHERE feature_key = 'white_label_pdf' AND (description IS NULL OR description = '');
UPDATE features_registry SET description = 'One- and two-way sensitivity tables showing how returns move when key assumptions change.'
  WHERE feature_key = 'sensitivity' AND (description IS NULL OR description = '');
UPDATE features_registry SET description = 'Save named versions of a project and review, compare, or roll back changes over time.'
  WHERE feature_key = 'versioning' AND (description IS NULL OR description = '');
UPDATE features_registry SET description = 'The number of active (non-archived) projects you can keep in your workspace at once.'
  WHERE feature_key = 'projects' AND (description IS NULL OR description = '');
UPDATE features_registry SET description = 'Coming soon: the number of team members who can share access to your workspace.'
  WHERE feature_key = 'seats' AND (description IS NULL OR description = '');
UPDATE features_registry SET description = 'Coming soon: assign team members roles so each person can only see and edit what their role allows.'
  WHERE feature_key = 'rbac' AND (description IS NULL OR description = '');
UPDATE features_registry SET description = 'Coming soon: apply your firm logo and colours across the app and exported reports.'
  WHERE feature_key = 'branding' AND (description IS NULL OR description = '');
UPDATE features_registry SET description = 'Coming soon: an in-app assistant that answers questions and guides you through each module as you build.'
  WHERE feature_key = 'ai_contextual' AND (description IS NULL OR description = '');
UPDATE features_registry SET description = 'Coming soon: an agent that gathers market data and suggests assumptions for your model.'
  WHERE feature_key = 'ai_research' AND (description IS NULL OR description = '');
