/**
 * scripts/ai-ic-narrative-live-test.ts
 *
 * Manual end-to-end trigger for IC narrative generation (AI Unit 7), against
 * PRODUCTION. The Generate buttons are Unit 8; this is how to exercise the loop
 * before they exist.
 *
 * WHAT IT DOES, and why it is shaped this way:
 *
 *   1. Reads the project's latest saved snapshot from Supabase (service role).
 *   2. Runs the REAL engine LOCALLY (computeFinancialsSnapshot ->
 *      computeReturnsSnapshot -> buildICReportModel). No API key is needed for
 *      this part, and it is exactly what the browser does before posting, which
 *      is why the route can accept the model without recomputing.
 *   3. POSTs that model to the LIVE route with your browser session cookie, so
 *      the production key, the production registry, and the production metering
 *      are the ones under test. Nothing here is faked.
 *   4. Reads report-inputs BEFORE and AFTER and diffs them, which is the proof
 *      that a draft is not auto-saved.
 *
 * IT SPENDS REAL CREDIT. Each successful run is one generation counted against
 * your plan's cap for this month.
 *
 * USAGE:
 *   1. Sign in at https://app.financialmodelerpro.com in your browser.
 *   2. DevTools > Application > Cookies > pick the value of
 *      `__Secure-next-auth.session-token` (or `next-auth.session-token`).
 *   3. set FMP_SESSION=<that value>   (PowerShell: $env:FMP_SESSION="...")
 *   4. npx tsx scripts/ai-ic-narrative-live-test.ts [field] [projectId]
 *
 *      field defaults to executiveSummary. Any of:
 *        executiveSummary recommendation risks returnsCommentary
 *        exitCommentary scenarioTakeaway
 *
 * No em dashes in this file.
 */

/* eslint-disable @typescript-eslint/no-explicit-any */
import { createClient } from '@supabase/supabase-js';
import { readFileSync } from 'node:fs';

import { computeFinancialsSnapshot } from '../src/hubs/modeling/platforms/refm/lib/financials-resolvers';
import { computeReturnsSnapshot } from '../src/hubs/modeling/platforms/refm/lib/returns-resolvers';
import { buildICReportModel } from '../src/hubs/modeling/platforms/refm/lib/reports/icReport';

for (const f of ['.env.local', '.env']) {
  try {
    for (const l of readFileSync(f, 'utf8').split('\n')) {
      const m = /^([A-Z0-9_]+)\s*=\s*(.*)$/.exec(l.trim());
      if (m && !process.env[m[1]]) process.env[m[1]] = m[2].replace(/^["']|["']$/g, '');
    }
  } catch { /* optional */ }
}

const BASE = process.env.FMP_BASE ?? 'https://app.financialmodelerpro.com';
const SESSION = process.env.FMP_SESSION ?? '';
const FIELD = process.argv[2] ?? 'executiveSummary';
const PROJECT_ID = process.argv[3] ?? '1daa9217-d2b8-4b22-acbf-18fed79adeff';

if (!SESSION) {
  console.error('Set FMP_SESSION to your next-auth session cookie value. See the header of this file.');
  process.exit(2);
}

const sb = createClient(process.env.SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!, { auth: { persistSession: false } });

// Both cookie names are sent: the __Secure- prefix is used over https, the bare
// name locally, and sending both costs nothing.
const cookie = `__Secure-next-auth.session-token=${SESSION}; next-auth.session-token=${SESSION}`;

async function api(path: string, init?: RequestInit): Promise<{ status: number; body: any }> {
  const res = await fetch(`${BASE}${path}`, {
    ...init,
    headers: { 'Content-Type': 'application/json', cookie, ...(init?.headers ?? {}) },
    redirect: 'manual',
  });
  const text = await res.text();
  let body: any = text;
  try { body = JSON.parse(text); } catch { /* keep raw */ }
  return { status: res.status, body };
}

async function main() {
  console.log(`Base     : ${BASE}`);
  console.log(`Project  : ${PROJECT_ID}`);
  console.log(`Field    : ${FIELD}\n`);

  // ── 1. The saved snapshot, straight from the database ─────────────────────
  const { data: version, error: vErr } = await sb
    .from('refm_project_versions')
    .select('id, version_number, snapshot')
    .eq('project_id', PROJECT_ID)
    .order('version_number', { ascending: false })
    .limit(1)
    .maybeSingle();
  if (vErr || !version) { console.error('Could not read a version snapshot:', vErr?.message); process.exit(1); }
  const snapshot = (version as { snapshot: any }).snapshot;
  console.log(`Snapshot : version ${(version as { version_number: number }).version_number}`);

  // ── 2. The real engine, locally. Same calls the browser makes. ────────────
  const snap = computeFinancialsSnapshot(snapshot);
  const rs = computeReturnsSnapshot(snap, snapshot.project);
  const model = buildICReportModel({
    project: snapshot.project,
    phases: snapshot.phases,
    assets: snapshot.assets,
    subUnits: snapshot.subUnits ?? [],
    rs,
    snap,
    parties: [],
    asOf: new Date().toISOString().slice(0, 10),
  });
  console.log(`Model    : ${model.overview.name}, project IRR ${model.headline.projectIrr === null ? 'n/a' : (model.headline.projectIrr * 100).toFixed(1) + '%'}, GDV ${(model.devEconomics.gdv / 1e6).toFixed(1)}m\n`);

  // ── 3. Report inputs BEFORE ───────────────────────────────────────────────
  const before = await api(`/api/refm/projects/${PROJECT_ID}/report-inputs`);
  if (before.status !== 200) {
    console.error(`report-inputs GET returned ${before.status}. Is the session cookie valid?`);
    console.error(JSON.stringify(before.body).slice(0, 300));
    process.exit(1);
  }
  const beforeVal = JSON.stringify(before.body?.inputs?.[FIELD] ?? before.body?.[FIELD] ?? null);

  // ── 4. Generate ───────────────────────────────────────────────────────────
  const started = Date.now();
  const gen = await api(`/api/refm/projects/${PROJECT_ID}/ai/ic-narrative`, {
    method: 'POST',
    body: JSON.stringify({ field: FIELD, model, scale: 'millions', currency: snapshot.project?.currency ?? 'SAR' }),
  });
  const ms = Date.now() - started;

  console.log('='.repeat(72));
  console.log(`HTTP ${gen.status}   (${ms} ms)`);
  console.log('='.repeat(72));

  if (gen.status !== 200) {
    console.log('BLOCKED / FAILED, which may be exactly what you are testing:');
    console.log(JSON.stringify(gen.body, null, 2));
    console.log('\nReading:');
    console.log('  404 + reason "disabled"      -> the feature is OFF in /admin/ai-features. Toggle enforced.');
    console.log('  402 + reason "cap_reached"   -> the monthly cap is spent. Cap enforced.');
    console.log('  503 + reason "no_cap"        -> no cap row for your plan. Set one in the panel.');
    console.log('  409 + reason "not_applicable"-> this field needs data this model does not have. No credit spent.');
    console.log('  403                          -> read-only grace or lapsed plan.');
    process.exit(0);
  }

  const b = gen.body;
  console.log(`\nFIELD    : ${b.field}  ->  ReportInputs.${b.targetField}`);
  console.log(`APPLIED  : ${b.applied}   (false means nothing was saved)`);
  console.log(`METER    : used ${b.meter.used} of ${b.meter.cap} on plan "${b.meter.planKey}", ${b.meter.remaining} left this period (${b.meter.periodStart})`);
  console.log(`MODEL    : ${b.model}   tokens in ${b.usage.inputTokens} / out ${b.usage.outputTokens}`);
  console.log(`AUDIT    : ${b.audit.summary}`);
  if (!b.audit.ok) {
    console.log('           UNSUPPORTED FIGURES (each of these appears in the draft but not in the supplied facts):');
    for (const f of b.audit.unsupported) console.log(`             ${f.raw}  at character ${f.index}`);
  }
  console.log(`\n${'-'.repeat(72)}\nDRAFT\n${'-'.repeat(72)}`);
  console.log(b.draft);
  if (b.risks) {
    console.log(`\n${'-'.repeat(72)}\nSTRUCTURED RISK ROWS (${b.risks.length})\n${'-'.repeat(72)}`);
    for (const r of b.risks) console.log(`  RISK     : ${r.risk}\n  MITIGANT : ${r.mitigant}\n`);
  }

  // ── 5. Report inputs AFTER. The no-auto-save proof. ───────────────────────
  const after = await api(`/api/refm/projects/${PROJECT_ID}/report-inputs`);
  const afterVal = JSON.stringify(after.body?.inputs?.[FIELD] ?? after.body?.[FIELD] ?? null);
  console.log('\n' + '='.repeat(72));
  console.log(`NOT AUTO-SAVED: stored "${FIELD}" ${beforeVal === afterVal ? 'is UNCHANGED' : 'CHANGED, which is a BUG'}`);
  console.log(`  before: ${beforeVal.slice(0, 90)}`);
  console.log(`  after : ${afterVal.slice(0, 90)}`);
  console.log('='.repeat(72));

  // Em dash check on the delivered draft, since the house rule is enforced on
  // output rather than only asked for in the prompt.
  const em = (b.draft.match(/[\u2014\u2015]/g) ?? []).length;
  console.log(`HOUSE STYLE: ${em === 0 ? 'no em dashes in the draft' : `${em} EM DASHES FOUND, which is a bug`}`);
}

void main().catch((e) => { console.error('FATAL', e); process.exit(1); });
