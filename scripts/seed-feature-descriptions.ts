/* eslint-disable no-console */
/**
 * seed-feature-descriptions.ts
 *
 * Idempotent, FILL-ONLY data seed (mirrors migration 169) that writes a short,
 * factual description for every features_registry row that is still empty, and
 * fixes the modeling landing bottom CTA to the single-source token form
 * ("Start {trialDays}-Day Free Trial") linking to /pricing. Never overwrites a
 * description an admin has already set. Display-only: no gating change.
 *
 * Run: npx tsx scripts/seed-feature-descriptions.ts
 */
import { createClient } from '@supabase/supabase-js';
import fs from 'fs';
import path from 'path';
for (const line of fs.readFileSync(path.join(process.cwd(), '.env.local'), 'utf8').split(/\r?\n/)) {
  const m = line.match(/^([A-Z0-9_]+)=(.*)$/);
  if (m && !process.env[m[1]]) process.env[m[1]] = m[2].replace(/^["']|["']$/g, '');
}
const sb = createClient(process.env.SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!, { auth: { persistSession: false } });

// feature_key -> short description (identical text to migration 169).
const DESCRIPTIONS: Record<string, string> = {
  module_1: 'Define project structure, land allocation, costs, and financing on a foundation built for institutional real estate financial modeling.',
  module_2: 'Per-asset revenue and matching cost of sales by strategy: cohort sales collection, hospitality room revenue, retail NOI, and Sell-plus-Manage fees.',
  module_3: 'Operating expenses, payroll, marketing, and fixed-cost schedules, with per-line inflation, driving cash flow across the operations window.',
  module_4: 'A full three-statement model: P&L, cash flow, and balance sheet that balances by construction, following the Module 1 accounting rules.',
  module_5: 'Investment returns and real estate metrics: IRR, NPV, MoIC, DSCR, equity multiples, stabilised yield, and a two-way sensitivity grid.',
  module_6: 'A what-if workbench: override any input per case on the base model and compare headline KPIs side by side across scenarios.',
  module_7: 'Coming soon: investment committee decks, lender packages, and configurable dashboards and charts built from the live model.',
  module_8: 'Coming soon: a roll-up across multiple projects with consolidated returns, cash flows, and a combined waterfall.',
  module_9: 'Coming soon: market comparables, benchmark cap rates and rents, and construction cost indices to support assumptions.',
  module_10: 'Coming soon: multi-user editing, comments, and approval workflows for investment committee and lender review.',
  module_11: 'Coming soon: programmatic API access to your models for portfolio dashboards and downstream BI integration.',
  pdf_export: 'Export the full project as a formatted, investor-ready PDF report across every built module.',
  excel_snapshot: 'Download the model as an Excel workbook with current values captured as a point-in-time snapshot.',
  excel_formula: 'Export an Excel workbook whose cells are formula-linked, so figures recalculate when you change inputs.',
  white_label_pdf: 'Coming soon: export PDF reports under your own brand, with your logo and colours in place of the platform default.',
  sensitivity: 'One- and two-way sensitivity tables showing how returns move when key assumptions change.',
  versioning: 'Save named versions of a project and review, compare, or roll back changes over time.',
  projects: 'The number of active (non-archived) projects you can keep in your workspace at once.',
  seats: 'Coming soon: the number of team members who can share access to your workspace.',
  rbac: 'Coming soon: assign team members roles so each person can only see and edit what their role allows.',
  branding: 'Coming soon: apply your firm logo and colours across the app and exported reports.',
  ai_contextual: 'Coming soon: an in-app assistant that answers questions and guides you through each module as you build.',
  ai_research: 'Coming soon: an agent that gathers market data and suggests assumptions for your model.',
};

async function seedDescriptions() {
  const { data, error } = await sb.from('features_registry').select('feature_key, description');
  if (error) { console.error('[FAIL] read features_registry:', error.message); process.exit(1); }
  const byKey = new Map((data ?? []).map((r: { feature_key: string; description: string | null }) => [r.feature_key, r.description]));
  let filled = 0, skipped = 0, missing = 0;
  for (const [key, desc] of Object.entries(DESCRIPTIONS)) {
    if (!byKey.has(key)) { console.log(`  [skip] ${key} not in registry`); missing++; continue; }
    const current = byKey.get(key);
    if (current && current.trim() !== '') { skipped++; continue; } // never overwrite
    const upd = await sb.from('features_registry').update({ description: desc, updated_at: new Date().toISOString() }).eq('feature_key', key);
    if (upd.error) { console.error(`  [FAIL] ${key}:`, upd.error.message); process.exit(1); }
    console.log(`  [fill] ${key}`);
    filled++;
  }
  console.log(`Descriptions: filled ${filled}, kept ${skipped} existing, ${missing} not present.`);
}

async function fixModelingCta() {
  const { data, error } = await sb.from('page_sections').select('id, content, display_order').eq('page_slug', 'modeling').eq('section_type', 'cta').order('display_order');
  if (error) { console.error('[FAIL] read modeling cta:', error.message); return; }
  // The conversion CTA is the highest display_order cta (the bottom CTA).
  const bottom = (data ?? []).slice(-1)[0] as { id: string; content: Record<string, unknown> } | undefined;
  if (!bottom) { console.log('No modeling cta section found.'); return; }
  const content = { ...(bottom.content ?? {}) };
  content.buttonText = 'Start {trialDays}-Day Free Trial';
  content.buttonUrl = '/pricing';
  const upd = await sb.from('page_sections').update({ content }).eq('id', bottom.id);
  if (upd.error) { console.error('[FAIL] update cta:', upd.error.message); return; }
  console.log('Modeling bottom CTA set to "Start {trialDays}-Day Free Trial" -> /pricing.');
}

async function main() {
  await seedDescriptions();
  await fixModelingCta();
  console.log('Done.');
}
main().catch((e) => { console.error(e); process.exit(1); });
