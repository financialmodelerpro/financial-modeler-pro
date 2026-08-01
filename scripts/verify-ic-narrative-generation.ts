/* eslint-disable @typescript-eslint/no-explicit-any */
/**
 * scripts/verify-ic-narrative-generation.ts
 *
 * Unit 7 verifier: IC narrative generation.
 *
 * This is the first REFM feature that spends money, so the checks are weighted
 * towards the properties that cost something when they break:
 *
 *   1. NO CALL FIRES PAST THE GATE. A denied meter decision, a disabled
 *      feature, and an unavailable field must each result in ZERO calls to
 *      runAi. Asserted by counting calls on an injected fake, not by reading
 *      the code, because "meters before it calls" is a claim about execution
 *      order and only execution can prove it.
 *   2. AVAILABILITY IS FREE. An unavailable field must not even reach the
 *      meter, so a user is never charged for a known non-answer.
 *   3. THE DRAFT IS NEVER SAVED. Structural: neither the service nor the route
 *      may import a persistence writer, and the route must not write.
 *   4. GROUNDING IS REAL. The prompt is built from a model produced by the
 *      ACTUAL engine (computeFinancialsSnapshot + computeReturnsSnapshot ->
 *      buildICReportModel), and a draft quoting those figures must audit clean
 *      while an invented figure must be caught.
 *   5. HOUSE STYLE HOLDS ON THE OUTPUT. Every prompt is em-dash free, and a
 *      model response containing em dashes comes back without them, because a
 *      prompt rule is a request and only the output check is a guarantee.
 *
 * Pure + engine + fakes. No database, no network, no API key:
 *   npx tsx scripts/verify-ic-narrative-generation.ts
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
import { buildICReportModel, type ICReportModel } from '../src/hubs/modeling/platforms/refm/lib/reports/icReport';
import { buildIcModelGrounding } from '../src/hubs/modeling/platforms/refm/lib/ai/icModelGrounding';
import { defaultReportInputs } from '../src/hubs/modeling/platforms/refm/lib/reportInputs';

import {
  IC_NARRATIVE_FIELDS,
  IC_NARRATIVE_FIELD_KEYS,
  IC_NARRATIVE_VOICE,
  coerceNarrativeFieldKey,
  hasEmDash,
  parseRiskRows,
  sanitizeNarrativeText,
  shapeNarrativeOutput,
  type IcNarrativeFieldKey,
} from '../src/hubs/modeling/platforms/refm/lib/ai/icNarrative';
import {
  generateIcNarrative,
  icNarrativeAvailability,
} from '../src/hubs/modeling/platforms/refm/lib/ai/icNarrativeService';
import { IC_NARRATIVE_FEATURE, REFM_PLATFORM_SLUG } from '../src/hubs/modeling/platforms/refm/lib/ai/refmAiFeatures';
import { GROUNDING_RULES } from '../src/shared/ai/grounding/render';
import { auditGroundedText } from '../src/shared/ai/grounding/audit';
import { allFacts } from '../src/shared/ai/grounding/facts';

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

const SERVICE_REL = 'src/hubs/modeling/platforms/refm/lib/ai/icNarrativeService.ts';
const PURE_REL = 'src/hubs/modeling/platforms/refm/lib/ai/icNarrative.ts';
const ROUTE_REL = 'app/api/refm/projects/[id]/ai/ic-narrative/route.ts';

/** Comment-stripped source, so a rule about CODE is not satisfied or broken by
 *  prose in a header comment. */
function code(rel: string): string {
  return read(rel).replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/.*$/gm, '$1');
}

// ---------------------------------------------------------------------------
//  A real project, run through the real engine
// ---------------------------------------------------------------------------

function buildState(): any {
  const project: any = makeDefaultProject();
  project.name = 'Narrative Test Development';
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

// ---------------------------------------------------------------------------
//  Fakes. Counting is the point: they record whether they were called at all.
// ---------------------------------------------------------------------------

interface Calls { meter: number; run: number; collect: number; ensure: number }

function fakeDeps(opts: {
  allow?: boolean;
  denyReason?: any;
  responseText?: string;
  aiFails?: boolean;
  configured?: boolean;
  calls: Calls;
}) {
  const allow = opts.allow !== false;
  return {
    // Unit 9 added a pre-flight configuration check ahead of the meter, so the
    // fakes must answer it. Left to the real implementation it reads the local
    // (empty) key and refuses every generation before the interesting part.
    configured: () => opts.configured !== false,
    // Unit 9: a failed generation refunds the credit. The fake records it so the
    // Unit 7 checks keep working and the call is observable.
    refund: async () => ({ refunded: true as const, used: 0 }),
    ensure: async () => { opts.calls.ensure++; return true; },
    meter: async () => {
      opts.calls.meter++;
      return allow
        ? { allowed: true as const, used: 1, cap: 5, remaining: 4, planKey: 'trial', periodStart: '2026-08-01' }
        : { allowed: false as const, reason: opts.denyReason ?? 'cap_reached', message: 'Monthly AI limit reached.', cap: 5, planKey: 'trial' };
    },
    run: async () => {
      opts.calls.run++;
      if (opts.aiFails) {
        return { ok: false as const, kind: 'rate_limit' as const, status: 429, message: 'Rate limited.', retryable: true, elapsedMs: 5 };
      }
      return {
        ok: true as const,
        text: opts.responseText ?? 'A grounded paragraph with no figures at all.',
        model: 'claude-sonnet-4-6',
        stopReason: 'end_turn',
        usage: { inputTokens: 100, outputTokens: 50 },
        elapsedMs: 12,
      };
    },
  };
}

async function main() {
  // ── 1. The field catalog ──────────────────────────────────────────────────
  const REQUIRED: IcNarrativeFieldKey[] = [
    'executiveSummary', 'recommendation', 'risks', 'returnsCommentary', 'exitCommentary', 'scenarioTakeaway',
  ];
  eq('exactly the six requested narrative fields are registered', IC_NARRATIVE_FIELD_KEYS.length, 6);
  for (const k of REQUIRED) ok(`field "${k}" is registered`, IC_NARRATIVE_FIELD_KEYS.includes(k));

  // Every target must be a REAL ReportInputs key, or a generated draft would
  // have nowhere to land.
  const inputKeys = new Set(Object.keys(defaultReportInputs()));
  for (const k of IC_NARRATIVE_FIELD_KEYS) {
    const spec = IC_NARRATIVE_FIELDS[k];
    ok(`${k} targets a real ReportInputs field (${String(spec.targetField)})`, inputKeys.has(String(spec.targetField)));
    ok(`${k} has a non-trivial task prompt`, spec.task.length > 120, `len ${spec.task.length}`);
    ok(`${k} declares a token ceiling`, spec.maxTokens > 0 && spec.maxTokens <= 2000, `got ${spec.maxTokens}`);
    ok(`${k} names its IC section`, spec.section.length > 0);
  }
  eq('the risks field is the structured one', IC_NARRATIVE_FIELDS.risks.format, 'risks');
  eq('the risks field targets the structured rows, not the legacy free text',
    String(IC_NARRATIVE_FIELDS.risks.targetField), 'risks');
  for (const k of IC_NARRATIVE_FIELD_KEYS.filter((x) => x !== 'risks')) {
    eq(`${k} is prose`, IC_NARRATIVE_FIELDS[k].format, 'prose');
  }

  // ── 2. House style in every prompt string ─────────────────────────────────
  ok('the shared voice carries no em dash', !hasEmDash(IC_NARRATIVE_VOICE));
  ok('the voice bans em dashes explicitly', /never use an em dash/i.test(IC_NARRATIVE_VOICE));
  ok('the voice sets the practitioner-teaching stance',
    /practitioner/i.test(IC_NARRATIVE_VOICE) && /teach/i.test(IC_NARRATIVE_VOICE));
  // Phrasing was tightened in Unit 9 ("CONSTRUCTIVE, NOT CRITICAL"); the
  // assertion checks the rule is present, not one wording of it.
  ok('the voice asks for constructive rather than critical',
    /constructive[, ]+(rather than|not) critical/i.test(IC_NARRATIVE_VOICE));
  ok('the voice is IC-appropriate', /investment committee/i.test(IC_NARRATIVE_VOICE));
  for (const k of IC_NARRATIVE_FIELD_KEYS) {
    ok(`${k} prompt carries no em dash`, !hasEmDash(IC_NARRATIVE_FIELDS[k].task));
  }
  ok('the pure module source carries no em dash', !hasEmDash(read(PURE_REL)));
  ok('the service source carries no em dash', !hasEmDash(read(SERVICE_REL)));
  ok('the route source carries no em dash', !hasEmDash(read(ROUTE_REL)));

  // ── 3. Field key coercion ────────────────────────────────────────────────
  eq('a known field coerces', coerceNarrativeFieldKey('risks'), 'risks');
  eq('an unknown field is rejected', coerceNarrativeFieldKey('marketOutlook'), null);
  eq('a non-string field is rejected', coerceNarrativeFieldKey({ field: 'risks' }), null);
  eq('a prototype key is not a field', coerceNarrativeFieldKey('toString'), null);

  // ── 4. The real engine, the real model, the real grounding ───────────────
  const state = buildState();
  const snap = computeFinancialsSnapshot(state);
  const rs = computeReturnsSnapshot(snap, state.project);
  const model: ICReportModel = buildICReportModel({
    project: state.project, phases: state.phases, assets: state.assets, subUnits: state.subUnits,
    rs, snap, parties: [], asOf: '2026-08-01',
  });
  ok('the engine produced a model to narrate', !!model?.headline && !!model.devEconomics);

  // ── 5. Availability gating ───────────────────────────────────────────────
  const avail = icNarrativeAvailability(model);
  eq('availability reports every field', avail.length, 6);
  ok('executive summary is available on a real model', avail.find((a) => a.field === 'executiveSummary')?.available === true);
  const scen = avail.find((a) => a.field === 'scenarioTakeaway');
  eq('scenario takeaway is unavailable with no cases', scen?.available, false);
  ok('and it says why', !!scen?.reason && scen.reason.length > 10, scen?.reason);

  const twoCase = { ...model, scenarios: { columns: [{ name: 'Base' }, { name: 'Downside' }] } } as any;
  eq('scenario takeaway becomes available with two cases',
    IC_NARRATIVE_FIELDS.scenarioTakeaway.available(twoCase).ok, true);
  eq('exit commentary is gated on exit rows',
    IC_NARRATIVE_FIELDS.exitCommentary.available({ ...model, exitYears: [] } as any).ok, false);
  eq('returns commentary is gated on a resolved return',
    IC_NARRATIVE_FIELDS.returnsCommentary.available({
      ...model,
      headline: { projectIrr: null, equityIrr: null, distributedEquityIrr: null, projectMoic: NaN, equityMoic: NaN },
    } as any).ok, false);

  // ── 6. Sanitising: the house rule enforced on OUTPUT ─────────────────────
  // Built from an escape, not typed literally: proving the stripper works needs
  // an em dash in the INPUT, and a literal one here would make this file fail
  // the repo-wide sweep it exists to defend.
  const EM = '\u2014';
  const emDashed = `The margin is thin ${EM} the exit assumption carries the case ${EM} and debt amplifies it.`;
  const cleaned = sanitizeNarrativeText(emDashed);
  ok('em dashes are removed from generated text', !hasEmDash(cleaned), cleaned);
  ok('and the sentence survives', cleaned.includes('margin is thin') && cleaned.includes('debt amplifies it'));
  eq('a tight em dash becomes a comma and a space',
    sanitizeNarrativeText(`cost${EM}value`), 'cost, value');
  eq('a fenced answer is unwrapped',
    sanitizeNarrativeText('```\nPlain text.\n```'), 'Plain text.');
  eq('a quoted single paragraph is unquoted',
    sanitizeNarrativeText('"Just the paragraph."'), 'Just the paragraph.');
  ok('an internal quote is left alone',
    sanitizeNarrativeText('He said "yes" and left.').includes('"yes"'));
  eq('runaway blank lines collapse',
    sanitizeNarrativeText('a\n\n\n\n\nb'), 'a\n\nb');
  eq('a non-string is handled', sanitizeNarrativeText(undefined as any), '');

  // ── 7. Risk parsing ──────────────────────────────────────────────────────
  const jsonRisks = parseRiskRows('[{"risk":"Leverage is high","mitigant":"Cash sweep from first surplus"},{"risk":"Exit relies on one buyer","mitigant":"Test a phased sale"}]');
  eq('JSON risks parse', jsonRisks.length, 2);
  eq('the first risk survives', jsonRisks[0].risk, 'Leverage is high');
  eq('its mitigant survives', jsonRisks[0].mitigant, 'Cash sweep from first surplus');

  const noisy = parseRiskRows('Here are the risks:\n```json\n[{"risk":"Cost to value is tight","mitigant":"Value engineering review"}]\n```\nHope that helps.');
  eq('a JSON array wrapped in prose and a fence still parses', noisy.length, 1);
  eq('and the row is clean', noisy[0].risk, 'Cost to value is tight');

  const lines = parseRiskRows('1. Risk: Debt paydown is back-ended\n   Mitigant: Covenant headroom tested annually\n2. Risk: Single asset concentration\n   Mitigant: Phase the delivery');
  eq('labelled lines parse when JSON is absent', lines.length, 2);
  eq('the second line pair is read', lines[1].mitigant, 'Phase the delivery');

  const partial = parseRiskRows('[{"risk":"Only a risk, no mitigant"}]');
  eq('a risk with no mitigant is KEPT, not dropped', partial.length, 1);
  eq('and its mitigant is visibly empty', partial[0].mitigant, '');
  eq('an empty risk is dropped', parseRiskRows('[{"risk":"","mitigant":"x"}]').length, 0);
  eq('unparseable text yields no rows', parseRiskRows('There are several risks worth noting.').length, 0);
  ok('em dashes inside a parsed risk are cleaned',
    !hasEmDash(parseRiskRows(`[{"risk":"Leverage ${EM} high","mitigant":"Sweep"}]`)[0].risk));

  const shapedRisks = shapeNarrativeOutput(IC_NARRATIVE_FIELDS.risks, '[{"risk":"A","mitigant":"B"}]');
  eq('shaping the risks field returns rows', shapedRisks.risks?.length, 1);
  ok('and a readable text rendering', shapedRisks.text.includes('Risk: A') && shapedRisks.text.includes('Mitigant: B'));
  const shapedProse = shapeNarrativeOutput(IC_NARRATIVE_FIELDS.executiveSummary, 'A paragraph.');
  eq('shaping prose leaves no rows', shapedProse.risks, undefined);

  // ── 8. THE SPEND GATE. Counted, not read. ────────────────────────────────
  {
    const calls: Calls = { meter: 0, run: 0, collect: 0, ensure: 0 };
    const res = await generateIcNarrative({
      userId: 'u1', field: 'scenarioTakeaway', model, deps: fakeDeps({ calls }) as any,
    });
    eq('an unavailable field fails at availability', res.ok === false && res.stage, 'availability');
    eq('an unavailable field makes NO ai call', calls.run, 0);
    eq('an unavailable field does not even meter', calls.meter, 0);
  }

  {
    const calls: Calls = { meter: 0, run: 0, collect: 0, ensure: 0 };
    const res = await generateIcNarrative({
      userId: 'u1', field: 'executiveSummary', model, deps: fakeDeps({ allow: false, calls }) as any,
    });
    eq('a capped user is refused', res.ok, false);
    eq('and it is reported as a metering refusal', res.ok === false && res.stage, 'metering');
    eq('NO ai call fires past the cap', calls.run, 0);
    eq('the meter was consulted', calls.meter, 1);
    eq('a cap refusal maps to 402', res.ok === false && res.status, 402);
  }

  {
    const calls: Calls = { meter: 0, run: 0, collect: 0, ensure: 0 };
    const res = await generateIcNarrative({
      userId: 'u1', field: 'executiveSummary', model,
      deps: fakeDeps({ allow: false, denyReason: 'disabled', calls }) as any,
    });
    eq('a disabled feature is refused', res.ok, false);
    eq('a disabled feature makes NO ai call', calls.run, 0);
    eq('a disabled feature maps to 404', res.ok === false && res.status, 404);
  }

  {
    const calls: Calls = { meter: 0, run: 0, collect: 0, ensure: 0 };
    const res = await generateIcNarrative({
      userId: 'u1', field: 'executiveSummary', model: null as any, deps: fakeDeps({ calls }) as any,
    });
    eq('a missing model is refused before spending', res.ok, false);
    eq('and makes no ai call', calls.run, 0);
    eq('and does not meter', calls.meter, 0);
  }

  // ── 9. The happy path, end to end, with the real grounding ───────────────
  {
    const calls: Calls = { meter: 0, run: 0, collect: 0, ensure: 0 };
    const res: any = await generateIcNarrative({
      userId: 'u1', field: 'executiveSummary', model,
      deps: fakeDeps({ calls, responseText: 'The project is a single-phase hotel development in Riyadh. It is funded with equity and debt.' }) as any,
    });
    eq('an allowed generation succeeds', res.ok, true);
    eq('exactly one ai call was made', calls.run, 1);
    eq('the feature was registered first', calls.ensure, 1);
    eq('the draft is reported as NOT applied', res.targetField, 'executiveSummary');
    ok('the draft carries text', typeof res.draft === 'string' && res.draft.length > 10);
    ok('the meter reading is returned for the UI', res.meter?.cap === 5 && res.meter?.remaining === 4);
    ok('an audit accompanies every draft', !!res.audit && typeof res.audit.checked === 'number');
    ok('usage is reported for cost tracking', res.usage?.inputTokens === 100);
  }

  // The prompt the service actually builds must carry the standing rules AND
  // the real figures. Captured by intercepting the request.
  {
    const calls: Calls = { meter: 0, run: 0, collect: 0, ensure: 0 };
    let captured: any = null;
    const deps: any = fakeDeps({ calls });
    const innerRun = deps.run;
    deps.run = async (req: any) => { captured = req; return innerRun(); };

    await generateIcNarrative({ userId: 'u1', field: 'returnsCommentary', model, scale: 'millions', currency: 'SAR', deps });

    ok('the request carries the standing no-fabrication rules', String(captured?.system).includes(GROUNDING_RULES.slice(0, 60)));
    ok('the request carries the house voice', String(captured?.system).includes('Never use an em dash'));
    ok('the voice is ADDITIONAL guidance, so it cannot replace the figure rules',
      String(captured?.system).indexOf(GROUNDING_RULES.slice(0, 40)) === 0);
    const content = String(captured?.messages?.[0]?.content ?? '');
    ok('the prompt carries the supplied data block', content.includes('## SUPPLIED DATA'));
    ok('the prompt carries the project name from the real model', content.includes('Narrative Test Development'));
    ok('the prompt carries the field task', content.includes('Reading the returns') || content.includes('unlevered'));
    ok('the prompt ends with the figure reminder', /every figure you write must appear verbatim/i.test(content));
    eq('the field token ceiling is applied', captured?.maxTokens, IC_NARRATIVE_FIELDS.returnsCommentary.maxTokens);
    ok('no em dash reaches the model', !hasEmDash(String(captured?.system)) && !hasEmDash(content));
  }

  // ── 10. The audit has teeth against a REAL fact set ──────────────────────
  {
    const doc = buildIcModelGrounding(model, { scale: 'millions', currencyCode: 'SAR' });
    const facts = allFacts([doc]);
    const gdvFact = facts.find((f) => f.key === 'dev.gdv');
    ok('the real model supplied a GDV fact', !!gdvFact, JSON.stringify(gdvFact?.formatted));

    const honest = `Gross development value is ${gdvFact?.formatted} SAR m on the supplied figures.`;
    const cleanAudit = auditGroundedText(honest, [doc]);
    ok('a draft quoting a supplied figure audits clean', cleanAudit.ok, JSON.stringify(cleanAudit.unsupported));

    const invented = 'Comparable schemes in the district trade at 8,750 per sqm, so the exit looks conservative.';
    const dirtyAudit = auditGroundedText(invented, [doc]);
    eq('an invented market figure is caught', dirtyAudit.ok, false);
    ok('and it is named', dirtyAudit.unsupported.some((f) => f.raw.includes('8,750')));
  }

  // The service must ATTACH a failed audit rather than swallow it.
  {
    const calls: Calls = { meter: 0, run: 0, collect: 0, ensure: 0 };
    const res: any = await generateIcNarrative({
      userId: 'u1', field: 'executiveSummary', model,
      deps: fakeDeps({ calls, responseText: 'The scheme benchmarks against comparables at 9,412 per sqm.' }) as any,
    });
    eq('a draft with an unsupported figure is still returned', res.ok, true);
    eq('but the audit says it failed', res.audit.ok, false);
    ok('and the offending figure travels with it', res.audit.unsupported.length > 0);
    ok('and the summary is human readable', /unsupported/.test(res.audit.summary));
  }

  // ── 11. AI failure and empty responses are typed, not thrown ─────────────
  {
    const calls: Calls = { meter: 0, run: 0, collect: 0, ensure: 0 };
    const res: any = await generateIcNarrative({
      userId: 'u1', field: 'executiveSummary', model, deps: fakeDeps({ calls, aiFails: true }) as any,
    });
    eq('an AI failure is reported, not thrown', res.ok, false);
    eq('and staged as ai', res.stage, 'ai');
    eq('and carries the retryable flag', res.retryable, true);
  }
  {
    const calls: Calls = { meter: 0, run: 0, collect: 0, ensure: 0 };
    const res: any = await generateIcNarrative({
      userId: 'u1', field: 'executiveSummary', model, deps: fakeDeps({ calls, responseText: '   ' }) as any,
    });
    eq('an empty draft is refused rather than returned blank', res.ok, false);
    eq('and staged as empty', res.stage, 'empty');
  }

  // ── 12. Structural: never writes, always meters, right feature ───────────
  const serviceCode = code(SERVICE_REL);
  const routeCode = code(ROUTE_REL);

  for (const [rel, src] of [[SERVICE_REL, serviceCode], [ROUTE_REL, routeCode]] as const) {
    ok(`${rel} does not import a persistence writer`,
      !/saveReportInputs|updateProject|insertVersion|updateVersion|saveReportDeck|from '.*persistence\/client'/.test(src));
    ok(`${rel} never writes report inputs`, !/report_inputs|refm_report_inputs/.test(src));
  }
  ok('the route does not expose a PUT or PATCH', !/export async function (PUT|PATCH)/.test(routeCode));
  ok('the route runs on node so the key stays server-side', /runtime = 'nodejs'/.test(routeCode));
  ok('the route states the draft is not applied', /applied:\s*false/.test(routeCode));
  ok('the route blocks read-only and lapsed users', /writeBlockReason/.test(routeCode));
  ok('the route checks project ownership', /getProject\(/.test(routeCode));

  // Order is the property that matters: the meter call must appear before the
  // AI call in the source, and the service must not call runAi anywhere else.
  const meterAt = serviceCode.indexOf('deps.meter(');
  const runAt = serviceCode.indexOf('deps.run(');
  ok('the service meters before it generates', meterAt > 0 && runAt > meterAt, `meter@${meterAt} run@${runAt}`);
  eq('the service has exactly one AI call site', serviceCode.split('deps.run(').length - 1, 1);
  ok('the service hardcodes no cap', !/\bcap\s*[:=]\s*\d+/.test(serviceCode));
  ok('the service reads the feature id from the registration, not a literal',
    /IC_NARRATIVE_FEATURE\.featureId/.test(serviceCode) && !/'m7_ic_narrative'/.test(serviceCode));
  ok('the pure module imports no server dependency',
    !/supabase|runAi|checkAndConsume|@\/src\/shared\/ai\/client/.test(code(PURE_REL)));

  eq('the feature this unit spends against is the one Unit 6 registered',
    IC_NARRATIVE_FEATURE.featureId, 'm7_ic_narrative');
  eq('under the platform slug, not the shortName', IC_NARRATIVE_FEATURE.platformSlug, 'real-estate');
  eq('and REFM_PLATFORM_SLUG agrees', REFM_PLATFORM_SLUG, 'real-estate');
  ok('the feature is grounded in the model', IC_NARRATIVE_FEATURE.grounding.includes('model'));

  console.log(`\nverify-ic-narrative-generation: ${pass} passed, ${fail} failed`);
  if (fail > 0) process.exit(1);
}

void main();
