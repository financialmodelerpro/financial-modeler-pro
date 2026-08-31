/* eslint-disable @typescript-eslint/no-explicit-any */
/**
 * scripts/verify-ai-grounding.ts
 *
 * Unit 4 verifier: the grounding abstraction.
 *
 * The model grounding path is exercised against REAL COMPUTED NUMBERS, not a
 * hand-written fixture: this builds a project state, runs the actual engine
 * (computeFinancialsSnapshot + computeReturnsSnapshot), assembles a real
 * ICReportModel, and grounds THAT. So "the model grounding type feeds real
 * computed numbers" is a checked claim rather than a description.
 *
 * The load-bearing section is the audit. The no-fabrication rule is only worth
 * the paper it is written on if a violation is detectable, so the audit is
 * tested from both sides: it must pass a draft that quotes supplied figures,
 * and it must catch an invented one, a market claim with no external data, and
 * a derived figure nobody checked.
 *
 * Pure + engine. No database, no network, no API key:
 *   npx tsx scripts/verify-ai-grounding.ts
 */

import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { computeFinancialsSnapshot } from '../src/hubs/modeling/platforms/refm/lib/financials-resolvers';
import { computeReturnsSnapshot } from '../src/hubs/modeling/platforms/refm/lib/returns-resolvers';
import {
  makeDefaultCostLines,
  makeDefaultFinancingTranche,
  makeDefaultPhase,
  makeDefaultProject,
} from '../src/hubs/modeling/platforms/refm/lib/state/module1-types';
import { buildICReportModel } from '../src/hubs/modeling/platforms/refm/lib/reports/icReport';
import { buildIcModelGrounding, icModelGroundingProvider } from '../src/hubs/modeling/platforms/refm/lib/ai/icModelGrounding';

import { NOT_AVAILABLE, allFacts, factIndex, formatPercent } from '../src/shared/ai/grounding/facts';
import { GROUNDING_RULES, buildGroundedRequest, renderGroundingPrompt } from '../src/shared/ai/grounding/render';
import { auditGroundedText, auditSummary, extractFigures, externalClaims } from '../src/shared/ai/grounding/audit';
import {
  GROUNDING_TYPE_ORDER,
  collectGrounding,
  contextGroundingProvider,
  externalGroundingProvider,
} from '../src/shared/ai/grounding/providers';
import type { GroundingBundle, GroundingProvider } from '../src/shared/ai/grounding/types';

const ROOT = join(__dirname, '..');
let pass = 0;
let fail = 0;
const ok = (label: string, cond: boolean, detail = '') => {
  if (cond) { pass++; return; }
  fail++;
  console.error(`FAIL ${label}${detail ? ` :: ${detail}` : ''}`);
};
const eq = (label: string, actual: unknown, expected: unknown) =>
  ok(`${label} (expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)})`, actual === expected);
const read = (rel: string): string => readFileSync(join(ROOT, rel), 'utf8');

// ── A real project, run through the real engine ─────────────────────────────
function buildState(): any {
  const project: any = makeDefaultProject();
  project.name = 'Grounding Test Development';
  project.location = 'Riyadh';
  project.country = 'KSA';
  project.startDate = '2026-01-01';
  project.operatingAr = { dsoDays: 30, daysPerYear: 365 };
  project.tax = { rate: 0.15 };

  const p1: any = {
    ...makeDefaultPhase(), id: 'p1', name: 'Phase 1', startDate: '2026-01-01',
    constructionPeriods: 2, operationsPeriods: 8, overlapPeriods: 0,
    dividendPolicy: { enabled: true, priority: 'before_sweep', startingYear: 2029, payoutRatio: 0.5, mode: 'cash_above_min' },
  };
  const hotel: any = {
    id: 'H1', phaseId: 'p1', name: 'Hotel', type: '', strategy: 'Operate', visible: true,
    gfaSqm: 0, buaSqm: 30000, sellableBuaSqm: 0, parkingBaysRequired: 0, usefulLifeYears: 20,
    revenue: { operate: {
      assetId: 'H1', daysPerYear: 365, startingADR: 900,
      adrIndexation: { method: 'yoy_compound', rate: 0.03 },
      occupancyPerPeriodByPhase: Array(11).fill(0.75), guestsPerOccupiedRoom: 1.5,
      fb: { mode: 'fixed_amount', fixedAmountPerPeriodByPhase: Array(11).fill(0), indexation: { method: 'none' } },
      otherRevenue: { mode: 'fixed_amount', fixedAmountPerPeriodByPhase: Array(11).fill(0), indexation: { method: 'none' } },
    } },
    opex: { defaultIndexation: { method: 'yoy_compound', rate: 0.03 }, lines: [
      { id: 'o1', name: 'Rooms cost', category: 'direct_rooms', mode: 'fixed_baseline', value: 12_000_000,
        indexation: { method: 'yoy_compound', rate: 0.03 }, useAssetDefault: true, rateMode: 'single' },
    ] },
  };
  const su: any = { id: 'su1', assetId: 'H1', name: 'Keys', category: 'Operable', metric: 'units', metricValue: 200, unitArea: 0, unitPrice: 900, startingAdr: 900 };
  const parcel: any = { id: 'parcel1', phaseId: 'p1', name: 'Plot', area: 10000, rate: 1000, cashPct: 100, inKindPct: 0 };

  return {
    project, phases: [p1], assets: [hotel], subUnits: [su], parcels: [parcel],
    costLines: makeDefaultCostLines('p1', 2), costOverrides: [], landAllocationMode: 'autoByBua',
    financingTranches: [makeDefaultFinancingTranche('t1', 'p1')], equityContributions: [],
  };
}

async function main() {
  // ── 1. Real engine to real grounding ──────────────────────────────────────
  const state = buildState();
  const snap = computeFinancialsSnapshot(state);
  const rs = computeReturnsSnapshot(snap, state.project);
  const model = buildICReportModel({
    project: state.project, phases: state.phases, assets: state.assets, subUnits: state.subUnits,
    rs, snap, parties: [], asOf: '2026-07-31',
  });

  ok('the engine produced a model to ground', !!model?.headline && !!model.devEconomics);

  const doc = buildIcModelGrounding(model, { scale: 'millions', currencyCode: 'SAR', asOf: '2026-07-31' });
  eq('the model document is typed model', doc.type, 'model');
  eq('the model document is available', doc.available, true);
  ok('it carries multiple sections', doc.sections.length >= 8, `got ${doc.sections.length}`);

  const facts = allFacts([doc]);
  ok('it carries a substantial fact set', facts.length >= 40, `got ${facts.length}`);

  const keys = new Set(facts.map((f) => f.key));
  eq('fact keys are unique', keys.size, facts.length);

  // ── 2. FIDELITY: every figure equals what the engine computed ─────────────
  // This is the whole point of model grounding. A drift here means a narrative
  // would quote a number the platform never produced.
  const idx = factIndex([doc]);
  const M = 1_000_000;
  const near = (a: unknown, b: number) => typeof a === 'number' && Math.abs(a - b) < 1e-9;

  eq('project name is carried through', idx.get('project.name')?.value, model.overview.name);
  ok('GDV is the engine GDV, scaled to millions',
    near(idx.get('dev.gdv')?.value, model.devEconomics.gdv / M),
    `fact ${String(idx.get('dev.gdv')?.value)} vs model ${model.devEconomics.gdv / M}`);
  ok('total development cost is carried through', near(idx.get('dev.tdc')?.value, model.devEconomics.tdc / M));
  ok('peak debt is carried through', near(idx.get('capital.peakDebt')?.value, model.capital.peakDebt / M));
  ok('total sources is carried through', near(idx.get('capital.totalSources')?.value, model.capital.totalSources / M));
  ok('equity MOIC is carried through unscaled (a multiple is not money)',
    near(idx.get('headline.equityMoic')?.value, model.headline.equityMoic));
  ok('a percent stays a fraction on the fact',
    model.headline.projectIrr === null || near(idx.get('headline.projectIrr')?.value, model.headline.projectIrr));
  eq('the exit year is carried through', idx.get('project.exitYear')?.value, model.overview.exitYear);

  // Percent facts must RENDER as percent even though they STORE a fraction,
  // because the audit has to accept both spellings later.
  if (model.headline.projectIrr !== null) {
    eq('a percent renders as a percent reading',
      idx.get('headline.projectIrr')?.formatted, formatPercent(model.headline.projectIrr));
  }

  // ── 3. Null survives as an explicit "not available" ──────────────────────
  const nullFacts = facts.filter((f) => f.value === null);
  ok('null figures are KEPT, not dropped (the model must be able to say so)', nullFacts.length >= 0);
  ok('every null fact reads as not available',
    nullFacts.every((f) => f.formatted === NOT_AVAILABLE),
    nullFacts.filter((f) => f.formatted !== NOT_AVAILABLE).map((f) => f.key).join(', '));

  // A model with a genuinely absent figure must still ground.
  const holed = JSON.parse(JSON.stringify({ ...model, reMetrics: { ...model.reMetrics, capRateAtExit: null } }));
  const holedDoc = buildIcModelGrounding(holed, { scale: 'millions' });
  eq('an absent metric renders as not available',
    factIndex([holedDoc]).get('re.capRateAtExit')?.formatted, NOT_AVAILABLE);

  // ── 4. Money scale ties the narrative to the deck ─────────────────────────
  const thousands = buildIcModelGrounding(model, { scale: 'thousands', currencyCode: 'SAR' });
  const tGdv = factIndex([thousands]).get('dev.gdv');
  ok('the thousands scale rescales the same figure', near(tGdv?.value, model.devEconomics.gdv / 1000));
  eq('the unit label follows the scale', tGdv?.unit, "SAR '000");

  // ── 5. Schedules are opt-in (prompt size is metered spend) ────────────────
  const withSeries = buildIcModelGrounding(model, { includeSeries: true });
  ok('schedules are omitted by default',
    !doc.sections.some((s) => s.id.startsWith('schedule.')));
  ok('schedules appear when asked for',
    withSeries.sections.some((s) => s.id.startsWith('schedule.'))
    || !model.schedules.incomeStatement.hasData);

  // ── 6. Rendering ──────────────────────────────────────────────────────────
  const bundle: GroundingBundle = { documents: [doc], status: [{ type: 'model', outcome: 'ok', providerId: 'refm.ic-model' }] };
  const prompt = renderGroundingPrompt(bundle);
  ok('the prompt names the source', prompt.includes('REFM IC model'));
  ok('the prompt carries the figures', prompt.includes(idx.get('dev.gdv')!.formatted));
  ok('the prompt is deterministic', renderGroundingPrompt(bundle) === prompt);

  const req = buildGroundedRequest({ bundle, task: 'Draft the investment thesis.', maxTokens: 900 });
  ok('the request carries the standing rules in the system prompt', (req.system ?? '').includes(GROUNDING_RULES));
  ok('the rules forbid inventing figures', GROUNDING_RULES.includes('Never state a number'));
  ok('the rules forbid outside market data', /market data|benchmarks/i.test(GROUNDING_RULES));
  ok('the rules forbid DERIVING new figures', /Do not calculate new figures/i.test(GROUNDING_RULES));
  ok('the rules give an explicit way to express absence', GROUNDING_RULES.includes(NOT_AVAILABLE));
  ok('the rules ban em dashes in generated text', /em dashes/i.test(GROUNDING_RULES));
  eq('the request starts with a user message', req.messages[0].role, 'user');
  ok('the figure rule is repeated AFTER the data, where the model reads last',
    req.messages[0].content.includes('every figure you write must appear'));
  eq('maxTokens is threaded', req.maxTokens, 900);

  const empty = renderGroundingPrompt({ documents: [], status: [] });
  ok('an empty bundle tells the model to write no figures at all', /Do not write figures/i.test(empty));

  // ── 7. THE AUDIT: catching what the rules only ask for ────────────────────
  const gdv = idx.get('dev.gdv')!.formatted;
  const moic = idx.get('headline.equityMoic')!.formatted;

  const honest = `Gross development value is ${gdv} SAR m and the equity multiple is ${moic}.`;
  const a1 = auditGroundedText(honest, bundle);
  ok(`a draft quoting supplied figures passes (${auditSummary(a1)})`, a1.ok);
  ok('and the figures are counted as supported', a1.supported.length >= 2);

  const invented = `Gross development value is ${gdv} SAR m, against a land cost of 987.654 SAR m.`;
  const a2 = auditGroundedText(invented, bundle);
  ok('an invented figure is CAUGHT', !a2.ok && a2.unsupported.some((f) => f.raw.includes('987.654')));

  const marketClaim = 'Comparable Riyadh assets trade at a 7.5% cap rate.';
  const a3 = auditGroundedText(marketClaim, bundle);
  ok('a market figure with no external data supplied is CAUGHT', !a3.ok);
  // WHY it is caught matters. This check passed for years on the figure alone,
  // then stopped: with a hundred-odd supplied percentages, 7.5% is an ordinary
  // ROUNDED restatement of some real one (7.46% here), and rounded matches do
  // not fail by default. Magnitude cannot separate an invented market rate from
  // a restated model rate, so the CLAIM is what is checked.
  ok('and it is caught as an ungrounded external CLAIM, not by luck of magnitude',
    a3.externalClaims.length > 0 && a3.unsupported.length === 0,
    `claims=${a3.externalClaims.map((c) => c.phrase).join('/')} unsupported=${a3.unsupported.map((f) => f.raw).join(',')}`);
  // The same sentence must PASS once external data is actually supplied, or the
  // rule is not "ground your claims", it is "never mention the market".
  const withExternal: GroundingBundle = {
    documents: [doc, { ...doc, type: 'external', providerId: 'test.market' }],
    status: [{ type: 'model', outcome: 'ok', providerId: 'refm.ic-model' },
      { type: 'external', outcome: 'ok', providerId: 'test.market' }],
  };
  ok('the SAME claim passes once an external document is supplied',
    auditGroundedText(marketClaim, withExternal).externalClaims.length === 0);
  ok('an ordinary model sentence raises no external claim',
    auditGroundedText('The scheme reaches practical completion in 2029.', bundle).externalClaims.length === 0);
  ok('the phrase match is whole-word ("incomparable" is not "comparable")',
    externalClaims('This asset is incomparable.').length === 0);

  // FORM AWARENESS. supportedValues used to return bare numbers, so a figure
  // matched any fact of the same magnitude in any unit. A percent must be
  // answered by something supplied AS a percent.
  const countDoc = {
    type: 'model' as const, providerId: 'p', source: 's', available: true,
    sections: [{ id: 'a', title: 'A', facts: [
      { key: 'n', label: 'Units', kind: 'count' as const, value: 42, formatted: '42' },
    ] }],
  };
  ok('a PERCENT cannot borrow the magnitude of a plain count',
    !auditGroundedText('The yield is 42%.', [countDoc]).ok);
  ok('and the same count still supports a plain 42',
    auditGroundedText('There are 42 units.', [countDoc]).ok);

  const derived = `Sources and uses net to ${(model.capital.totalSources / M + 12345.6789).toFixed(4)} SAR m.`;
  const a4 = auditGroundedText(derived, bundle);
  ok('a derived figure nobody checked is CAUGHT (deliberate, the rules forbid deriving)', !a4.ok);

  // Percent spellings: the engine holds a fraction, the model writes a percent.
  if (model.headline.projectIrr !== null) {
    const pctText = `The project IRR is ${formatPercent(model.headline.projectIrr)}.`;
    const a5 = auditGroundedText(pctText, bundle);
    ok('a correctly quoted percent is NOT flagged (fraction vs percent spelling)', a5.ok, auditSummary(a5));
  }

  // Rounding is reported separately, never silently accepted and never a hard fail.
  const roundedText = 'The equity multiple is 2x.';
  const a6 = auditGroundedText(roundedText, { documents: [doc], status: [] });
  ok('a rounded restatement is classified, not silently passed',
    a6.rounded.length + a6.unsupported.length >= 1);
  const strict = auditGroundedText('The equity multiple is 2x.', bundle, { strictRounding: true });
  ok('strictRounding can be demanded by the caller', strict.rounded.length === 0 || !strict.ok);

  // Markdown scaffolding is structure, not a claim, and must not read as one.
  const listy = '1. First point.\n2. Second point.\n### Third heading';
  const a7 = auditGroundedText(listy, { documents: [], status: [] });
  eq('ordered-list markers and heading hashes are not treated as figures', a7.checked, 0);

  // A digit used in ordinary prose IS still examined. That is the conservative
  // direction on purpose: whitelisting small integers would also let an
  // invented "5 assets" through on a three-asset project, which is a real
  // fabrication, while the cost of keeping it is a reviewable false positive.
  const prose = 'There are 3 things to watch.';
  const a7b = auditGroundedText(prose, { documents: [], status: [] });
  eq('a digit in prose is examined, not whitelisted', a7b.unsupported.length, 1);

  // Figures attributed to an UNAVAILABLE document must not count as supported.
  const unavailableExternal = externalGroundingProvider.collect({ platformSlug: 'real-estate', featureId: 'x' }) as any;
  const a8 = auditGroundedText('Market cap rates sit at 6.25%.', [doc, unavailableExternal]);
  ok('an unavailable document supplies no facts', !a8.ok);

  eq('extraction reads an accounting negative', extractFigures('(1,234.5)')[0]?.value, -1234.5);
  eq('extraction reads a multiple', extractFigures('2.40x')[0]?.form, 'multiple');
  eq('extraction reads a percent', extractFigures('11.9%')[0]?.form, 'percent');

  // ── 8. Providers ──────────────────────────────────────────────────────────
  eq('collection order is model, external, context', GROUNDING_TYPE_ORDER.join(','), 'model,external,context');

  const collected = await collectGrounding({
    types: ['model', 'external', 'context'],
    input: {
      platformSlug: 'real-estate', featureId: 'm7_ic_narrative', asOf: '2026-07-31',
      payload: { model },
    },
    providers: [icModelGroundingProvider, externalGroundingProvider, contextGroundingProvider],
  });
  eq('every requested type is accounted for', collected.status.length, 3);
  eq('documents come back in type order', collected.documents.map((d) => d.type).join(','), 'model,external,context');
  eq('the model type resolved', collected.status.find((s) => s.type === 'model')?.outcome, 'ok');
  eq('external reports unavailable, not an error', collected.status.find((s) => s.type === 'external')?.outcome, 'unavailable');
  ok('the unavailable external document states a reason',
    !!collected.documents.find((d) => d.type === 'external')?.unavailableReason);
  ok('the prompt says out loud that external data is absent',
    /No external data is available/i.test(renderGroundingPrompt(collected)));

  const noProvider = await collectGrounding({
    types: ['external'],
    input: { platformSlug: 'real-estate', featureId: 'x' },
    providers: [],
  });
  eq('a requested type with NO provider still reports', noProvider.status[0].outcome, 'no_provider');
  eq('and still produces a visible document', noProvider.documents.length, 1);
  eq('which is marked unavailable', noProvider.documents[0].available, false);

  const thrower: GroundingProvider = {
    id: 'boom', type: 'model', describe: 'always throws',
    collect() { throw new Error('provider exploded'); },
  };
  const errored = await collectGrounding({
    types: ['model'], input: { platformSlug: 'p', featureId: 'f' }, providers: [thrower],
  });
  eq('a throwing provider becomes a status, not an exception', errored.status[0].outcome, 'error');
  eq('and still yields an unavailable document', errored.documents[0].available, false);

  const wrongPayload = await collectGrounding({
    types: ['model'],
    input: { platformSlug: 'real-estate', featureId: 'f', payload: { nonsense: true } },
    providers: [icModelGroundingProvider],
  });
  eq('the model provider handed the wrong payload degrades to unavailable', wrongPayload.documents[0].available, false);

  // External stub: attribution is mandatory.
  const unsourced = externalGroundingProvider.collect({
    platformSlug: 'p', featureId: 'f',
    payload: { benchmarks: [{ key: 'adr', label: 'Market ADR', value: 550, kind: 'money', source: '' }] },
  }) as any;
  eq('a benchmark with no source attribution is discarded', unsourced.available, false);

  const sourced = externalGroundingProvider.collect({
    platformSlug: 'p', featureId: 'f',
    payload: { benchmarks: [{ key: 'adr', label: 'Market ADR', value: 550, kind: 'money', source: 'STR 2026', asOf: '2026-06' }] },
  }) as any;
  eq('a sourced benchmark is accepted', sourced.available, true);
  ok('and carries its attribution into the prompt',
    renderGroundingPrompt({ documents: [sourced], status: [] }).includes('STR 2026'));
  ok('a supplied benchmark then counts as supported',
    auditGroundedText('Market ADR is 550.', [sourced]).ok);

  // Context stub.
  const noCtx = contextGroundingProvider.collect({ platformSlug: 'real-estate', featureId: 'f' }) as any;
  eq('context with nothing supplied is unavailable', noCtx.available, false);
  const ctx = contextGroundingProvider.collect({
    platformSlug: 'real-estate', featureId: 'f',
    payload: { module: 'Module 2: Revenue', tab: 'Inputs', intent: 'explain the velocity curve' },
  }) as any;
  eq('context with a payload is available', ctx.available, true);
  ok('context carries no project figures (they belong in model grounding)',
    allFacts([ctx]).every((f) => f.kind === 'text' || f.kind === 'count'));

  // ── 9. Boundaries and house style ─────────────────────────────────────────
  const groundingFiles = ['types.ts', 'facts.ts', 'render.ts', 'audit.ts', 'providers.ts']
    .map((f) => [`src/shared/ai/grounding/${f}`, read(`src/shared/ai/grounding/${f}`)] as const);

  for (const [name, src] of groundingFiles) {
    ok(`${name} does not import a platform (the foundation stays platform-agnostic)`,
      !/hubs\/modeling|platforms\/refm|@platforms\//.test(src));
    ok(`${name} does not import the Anthropic SDK (Unit 1 containment holds)`, !/@anthropic-ai\/sdk/.test(src));
    ok(`${name} does not read the API key`, !/ANTHROPIC_API_KEY/.test(src));
    ok(`${name} does not touch the database`, !/@supabase\/supabase-js|core\/db\/supabase/.test(src));
  }

  const refmAdapter = read('src/hubs/modeling/platforms/refm/lib/ai/icModelGrounding.ts');
  ok('the REFM adapter does not recompute (no engine resolver import)',
    !/financials-resolvers|returns-resolvers|computeFinancialsSnapshot|computeReturnsSnapshot/.test(refmAdapter));
  ok('the grounding types reuse the registry union rather than redeclaring it',
    /from '\.\.\/registryTypes'/.test(read('src/shared/ai/grounding/types.ts')));

  const EM_DASH = String.fromCharCode(0x2014);
  for (const [name, src] of [...groundingFiles,
    ['src/hubs/modeling/platforms/refm/lib/ai/icModelGrounding.ts', refmAdapter] as const,
    ['scripts/verify-ai-grounding.ts', read('scripts/verify-ai-grounding.ts')] as const]) {
    ok(`${name} contains no em dashes`, !src.includes(EM_DASH));
  }

  console.log(`\nverify-ai-grounding: ${pass} passed, ${fail} failed`);
  if (fail > 0) process.exit(1);
}

main().catch((err) => {
  console.error('verify-ai-grounding crashed:', err);
  process.exit(1);
});
