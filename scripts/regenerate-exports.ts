/**
 * regenerate-exports.ts
 *
 * Regenerate the four review exports for a live project into `exports/`:
 * the full-project PDF, the Excel model, and the IC deck as both .pptx and
 * .pdf. Written 2026-09-22, after a session that moved Equity IRR, the DSCR
 * covenant status and the P&L, because the files on disk were generated the
 * day before and no longer matched the model.
 *
 * WHY A COMMITTED SCRIPT. The previous set was produced by an ad-hoc script
 * that was deleted, so "regenerate the exports" started with rediscovering
 * four entry points and their option shapes. This is the same work, kept.
 *
 * It reads the project's LATEST SAVED VERSION through `loadStoredModel`, the
 * one saved-version door, so the files mirror what the app would export
 * rather than a second assembly of the same state.
 *
 * `exports/` is gitignored: these carry real project data and are never
 * committed.
 *
 * Usage: npx tsx --env-file=.env.local scripts/regenerate-exports.ts
 *
 * No em dashes in this file.
 */
import { createClient } from '@supabase/supabase-js';
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { loadStoredModel } from '../src/hubs/modeling/platforms/refm/lib/state/loadStoredModel';
import { modelFromSnapshot, pickModel } from '../src/hubs/modeling/platforms/refm/lib/state/module1-store';
import { baseCaseId, normaliseCases } from '../src/hubs/modeling/platforms/refm/lib/cases/applyOverrides';
import { seedDeck } from '../src/hubs/modeling/platforms/refm/lib/reports/deck/templates';
import { defaultReportInputs } from '../src/hubs/modeling/platforms/refm/lib/reportInputs';
import { computeFinancialsSnapshot } from '../src/hubs/modeling/platforms/refm/lib/financials-resolvers';
import { computeReturnsSnapshot } from '../src/hubs/modeling/platforms/refm/lib/returns-resolvers';
import { generateProjectPdf } from '../src/hubs/modeling/platforms/refm/lib/pdf/generateProjectPdf';
import { buildModelWorkbook } from '../src/hubs/modeling/platforms/refm/lib/excel/buildModelWorkbook';
import { buildICReportModel } from '../src/hubs/modeling/platforms/refm/lib/reports/icReport';
import { buildDeckPptx } from '../src/hubs/modeling/platforms/refm/lib/reports/deck/deckPptx';
import { buildDeckPdf } from '../src/hubs/modeling/platforms/refm/lib/reports/deck/deckPdf';
import { makeDeckFmt } from '../src/hubs/modeling/platforms/refm/lib/reports/deck/bindings';
import { icMoneyScaleSpec } from '../src/hubs/modeling/platforms/refm/lib/reportInputs';
import { coerceDeck } from '../src/hubs/modeling/platforms/refm/lib/persistence/deck-server';
import { LIVE_PROJECT_ID } from './fixtures/liveProject';

for (const f of ['.env.local']) {
  try {
    for (const l of readFileSync(f, 'utf8').split('\n')) {
      const m = /^([A-Z0-9_]+)\s*=\s*(.*)$/.exec(l.trim());
      if (m && !process.env[m[1]]) process.env[m[1]] = m[2].replace(/^["']|["']$/g, '');
    }
  } catch { /* optional */ }
}

const OUT = 'exports';
const today = new Date().toISOString().slice(0, 10);
const dateLabel = new Date().toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric' });

(async () => {
  const url = process.env.SUPABASE_URL, key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) { console.error('FAIL: no credentials. Run with --env-file=.env.local'); process.exit(1); }
  const sb = createClient(url, key, { auth: { persistSession: false } });

  const { data: projRows, error: projErr } = await sb
    .from('refm_projects').select('id, name').eq('id', LIVE_PROJECT_ID).limit(1);
  if (projErr) { console.error('FAIL: project read:', projErr.message); process.exit(1); }
  if (!projRows?.length) { console.error('FAIL: project not found (deleted or purged?)'); process.exit(1); }
  const projectName: string = (projRows[0] as { name: string }).name;

  const { data: verRows, error: verErr } = await sb
    .from('refm_project_versions').select('snapshot, label, comment')
    .eq('project_id', LIVE_PROJECT_ID).order('created_at', { ascending: false }).limit(1);
  if (verErr) { console.error('FAIL: version read:', verErr.message); process.exit(1); }
  if (!verRows?.length) { console.error('FAIL: no saved version'); process.exit(1); }
  const v = verRows[0] as { snapshot: unknown; label: string | null; comment: string | null };

  // MIRRORS THE EXPORT MODAL'S SAVED-VERSION PATH exactly: load through the
  // store, take the settled base, keep the version's own active case, and hand
  // the comparison bundle to both exports. Without the bundle the Scenarios
  // tab is an 18-row "no scenarios" stub, which is how the first run of this
  // script produced a workbook a sixth of the previous size.
  const migrated = loadStoredModel(v.snapshot).snapshot;
  const state = modelFromSnapshot(migrated) as Parameters<typeof computeFinancialsSnapshot>[0];
  const cases = normaliseCases(migrated.cases);
  const activeCaseId = migrated.activeCaseId && cases.some((c) => c.id === migrated.activeCaseId)
    ? migrated.activeCaseId : baseCaseId(cases);
  const caseComparison = {
    baseModel: pickModel(migrated as unknown as Record<string, unknown>),
    cases, activeCaseId,
  };
  const snap = computeFinancialsSnapshot(state);
  const rs = computeReturnsSnapshot(snap, state.project);

  // Parties live in their own table (refm_parties), never on the project, so
  // both exports take them from the caller exactly as the Export modal does.
  const { data: partyRows } = await sb
    .from('refm_parties').select('*').eq('project_id', LIVE_PROJECT_ID);
  const parties = (partyRows ?? []) as Parameters<typeof buildICReportModel>[0]['parties'];

  mkdirSync(OUT, { recursive: true });
  const wrote: string[] = [];
  const write = (name: string, bytes: Uint8Array): void => {
    const p = `${OUT}/${name}`;
    writeFileSync(p, bytes);
    wrote.push(`${p}  ${(bytes.length / 1024).toFixed(0)} KB`);
  };

  // ── 1. Full project PDF ────────────────────────────────────────────────
  const pdf = await generateProjectPdf({
    state,
    projectName,
    versionLabel: v.label ?? null,
    versionComment: v.comment ?? null,
    dateLabel,
    selectedModuleKeys: ['module1', 'module2', 'module3', 'module4', 'module5', 'module6'],
    caseComparison,
  });
  write(`${projectName} - Full Report.pdf`, pdf);

  // ── 2. Excel model ─────────────────────────────────────────────────────
  // includeSensitivity is the LIVE entitlement in the app and defaults to false
  // so a forgetful caller cannot leak the grid. This script runs for the
  // founder's own review on their own project, so it is on deliberately.
  const wb = buildModelWorkbook({ state, projectName, dateLabel, caseComparison, parties, includeSensitivity: true });
  const xlsx = new Uint8Array(await wb.xlsx.writeBuffer() as ArrayBuffer);
  write(`${projectName} - Model.xlsx`, xlsx);

  // ── 3 + 4. IC deck, .pptx and .pdf ─────────────────────────────────────
  const model = buildICReportModel({
    project: state.project, phases: state.phases, parcels: state.parcels,
    assets: state.assets, subUnits: state.subUnits,
    landAllocationMode: state.landAllocationMode,
    rs, snap, parties, asOf: today, cases,
  });
  // THE SAVED DECK IF THERE IS ONE, else a freshly seeded one, which is what
  // the editor shows a project that has never opened Module 7. Marina Gate has
  // no saved deck (refm_report_decks and its versions table are both empty for
  // it), so the deck exported for review is the seeded layout. A stored deck
  // goes through the same `coerceDeck` the export route uses, so one that would
  // be rejected in the app is rejected here rather than silently rendered.
  const { data: deckRows } = await sb
    .from('refm_report_decks').select('deck').eq('project_id', LIVE_PROJECT_ID).limit(1);
  const stored = deckRows?.length ? coerceDeck((deckRows[0] as { deck: unknown }).deck, LIVE_PROJECT_ID, today) : null;
  const deck = stored ?? seedDeck(LIVE_PROJECT_ID, model, { inputs: defaultReportInputs() }, { asOf: today });
  console.log(`\nIC deck: ${stored ? 'the project\'s SAVED deck' : 'SEEDED (no deck saved for this project)'}, ${deck.slides.length} slides.`);
  const fmt = makeDeckFmt(icMoneyScaleSpec('millions', state.project.currency ?? 'SAR'));
  const pptx = buildDeckPptx({ deck, model, fmt });
  const buf = await pptx.write({ outputType: 'nodebuffer' }) as Buffer;
  write(`${projectName} - IC Deck.pptx`, new Uint8Array(buf));
  write(`${projectName} - IC Deck.pdf`, await buildDeckPdf({ deck, model, fmt, watermark: null }));

  // The headline figures the files should now carry, printed so the run is
  // self-checking rather than "four files appeared".
  const pct = (x: number | null): string => (x == null ? 'n/a' : `${(x * 100).toFixed(2)}%`);
  console.log(`\nRegenerated from ${projectName}, version ${v.label ?? '(unlabelled)'}:`);
  for (const w of wrote) console.log(`  ${w}`);
  console.log('\nHeadline figures now in these files:');
  console.log(`  project IRR (FCFF)   ${pct(rs.result.fcff.irr)}`);
  console.log(`  equity IRR (FCFE)    ${pct(rs.result.fcfe.irr)}`);
  console.log(`  distributed IRR net  ${pct(rs.resultNetDividends.irr)}`);
  console.log(`  min DSCR             ${rs.result.realEstate.dscrMin == null ? 'n/a' : `${rs.result.realEstate.dscrMin.toFixed(2)}x`}`);
  console.log(`  scheduled amortisation present: ${rs.hasScheduledAmortisation}`);
  const S = (a: readonly number[] = []): number => a.reduce((t, x) => t + (x ?? 0), 0);
  console.log(`  PAT                  ${(S(snap.pl.patPerPeriod) / 1e6).toFixed(2)}m`);
  console.log(`  interest expensed    ${(S(snap.pl.interestExpensePerPeriod) / 1e6).toFixed(2)}m`);
  console.log(`  cost of sales        ${(S(snap.pl.cosPerPeriod) / 1e6).toFixed(2)}m`);
})();
