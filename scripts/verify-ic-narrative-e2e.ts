/* eslint-disable @typescript-eslint/no-explicit-any */
/**
 * scripts/verify-ic-narrative-e2e.ts
 *
 * Unit 9: the end-to-end check on the whole IC narrative feature.
 *
 * The per-unit verifiers each prove their own layer. This one exists for the
 * SEAMS BETWEEN them, which is where a feature assembled over nine units
 * actually breaks: the toggle that is honoured by the panel but not the server,
 * the cap that the UI displays but nothing enforces, the draft that is called
 * editable in one layer and auto-applied in another.
 *
 * Every guardrail below is asserted by EXECUTION where execution is possible
 * (injected fakes that count calls, the real engine, real prompt assembly, real
 * audit), and structurally only where it cannot be (source-level contracts).
 *
 * It runs the whole chain against a model the real engine produced:
 *
 *   toggle -> metering -> grounding -> generation -> audit -> draft -> review
 *
 * Pure + engine + fakes. No database, no network, no API key:
 *   npx tsx scripts/verify-ic-narrative-e2e.ts
 */

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import React from 'react';
import { renderToString } from 'react-dom/server';

import { computeFinancialsSnapshot } from '../src/hubs/modeling/platforms/refm/lib/financials-resolvers';
import { computeReturnsSnapshot } from '../src/hubs/modeling/platforms/refm/lib/returns-resolvers';
import {
  makeDefaultCostLines,
  makeDefaultFinancingTranche,
  makeDefaultPhase,
  makeDefaultProject,
} from '../src/hubs/modeling/platforms/refm/lib/state/module1-types';
import { buildICReportModel, type ICReportModel } from '../src/hubs/modeling/platforms/refm/lib/reports/icReport';
import { seedDeck } from '../src/hubs/modeling/platforms/refm/lib/reports/deck/templates';
import { findNarrativeTargets } from '../src/hubs/modeling/platforms/refm/lib/reports/deck/narrativeTargets';
import { generateIcNarrative } from '../src/hubs/modeling/platforms/refm/lib/ai/icNarrativeService';
import {
  BANNED_MARKETING_WORDS,
  IC_NARRATIVE_FIELDS,
  IC_NARRATIVE_FIELD_KEYS,
  IC_NARRATIVE_VOICE,
  narrativeTaskFor,
} from '../src/hubs/modeling/platforms/refm/lib/ai/icNarrative';
import { IC_NARRATIVE_FEATURE } from '../src/hubs/modeling/platforms/refm/lib/ai/refmAiFeatures';
import { buildIcModelGrounding } from '../src/hubs/modeling/platforms/refm/lib/ai/icModelGrounding';
import { auditGroundedText } from '../src/shared/ai/grounding/audit';
import { allFacts } from '../src/shared/ai/grounding/facts';
import { NarrativeAiPanel, NarrativeReviewModal } from '../src/hubs/modeling/platforms/refm/components/modules/deck/NarrativeAi';

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
const code = (rel: string): string =>
  read(rel).replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/.*$/gm, '$1');

function buildState(): any {
  const project: any = makeDefaultProject();
  project.name = 'End To End Development';
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

interface Calls { meter: number; run: number; ensure: number; refund: number }
function deps(o: { calls: Calls; allow?: boolean; reason?: any; text?: string; configured?: boolean; aiKind?: string }) {
  return {
    configured: () => o.configured !== false,
    refund: async () => { o.calls.refund++; return { refunded: true as const, used: 0 }; },
    ensure: async () => { o.calls.ensure++; return true; },
    meter: async () => {
      o.calls.meter++;
      return o.allow === false
        ? { allowed: false as const, reason: o.reason ?? 'cap_reached', message: 'Monthly AI limit reached.', cap: 5, planKey: 'trial' }
        : { allowed: true as const, used: 1, cap: 100, remaining: 99, planKey: 'pro', periodStart: '2026-08-01' };
    },
    run: async () => {
      o.calls.run++;
      if (o.aiKind) {
        return { ok: false as const, kind: o.aiKind as any, status: 400, message: 'x', retryable: false, elapsedMs: 1 };
      }
      return {
        ok: true as const, text: o.text ?? 'A grounded paragraph.', model: 'claude-sonnet-4-6',
        stopReason: 'end_turn', usage: { inputTokens: 10, outputTokens: 10 }, elapsedMs: 5,
      };
    },
  };
}

async function main() {
  const state = buildState();
  const snap = computeFinancialsSnapshot(state);
  const rs = computeReturnsSnapshot(snap, state.project);
  const model: ICReportModel = buildICReportModel({
    project: state.project, phases: state.phases, assets: state.assets, subUnits: state.subUnits,
    rs, snap, parties: [], asOf: '2026-08-01',
  });
  ok('the engine produced a model for the end-to-end run', !!model?.headline);

  // ══ GUARDRAIL 1: the feature toggle gates generation, server-side ═════════
  {
    const calls: Calls = { meter: 0, run: 0, ensure: 0, refund: 0 };
    const res: any = await generateIcNarrative({
      userId: 'u', field: 'executiveSummary', model,
      deps: deps({ calls, allow: false, reason: 'disabled' }) as any,
    });
    eq('a disabled feature refuses', res.ok, false);
    eq('and it is the metering layer that refuses, not the UI', res.stage, 'metering');
    eq('and NO ai call is made', calls.run, 0);
    eq('and it maps to 404', res.status, 404);
  }
  ok('the feature registers DISABLED, so it cannot spend unattended',
    IC_NARRATIVE_FEATURE.enabledOnCreate !== true);
  ok('the panel hides itself when the server says the feature is off',
    /!status\.enabled\) return null/.test(code('src/hubs/modeling/platforms/refm/components/modules/deck/NarrativeAi.tsx')));

  // ══ GUARDRAIL 2: metering counts and the cap hard-stops, server-side ══════
  {
    const calls: Calls = { meter: 0, run: 0, ensure: 0, refund: 0 };
    const res: any = await generateIcNarrative({
      userId: 'u', field: 'executiveSummary', model, deps: deps({ calls, allow: false, reason: 'cap_reached' }) as any,
    });
    eq('at the cap the generation refuses', res.ok, false);
    eq('NO ai call fires past the cap', calls.run, 0);
    eq('and it maps to 402, the upgrade signal', res.status, 402);
  }
  {
    const calls: Calls = { meter: 0, run: 0, ensure: 0, refund: 0 };
    const res: any = await generateIcNarrative({ userId: 'u', field: 'executiveSummary', model, deps: deps({ calls }) as any });
    eq('an allowed generation proceeds', res.ok, true);
    eq('exactly one credit was claimed', calls.meter, 1);
    eq('for exactly one ai call', calls.run, 1);
    eq('and the server meter reading is returned to the UI', res.meter.remaining, 99);
  }
  const metering = code('src/shared/ai/metering.ts');
  ok('the cap is read from the database, never hardcoded', !/\bcap\s*=\s*\d+/.test(metering));
  ok('metering fails closed on an unreadable store', /unavailable/.test(metering));
  ok('there is no admin bypass on spend', !/isAdmin|sessionIsAdmin/.test(metering));

  // ══ GUARDRAIL 3: only real model numbers reach the prompt ════════════════
  {
    const calls: Calls = { meter: 0, run: 0, ensure: 0, refund: 0 };
    let captured: any = null;
    const d: any = deps({ calls });
    const inner = d.run;
    d.run = async (req: any) => { captured = req; return inner(); };
    await generateIcNarrative({ userId: 'u', field: 'returnsCommentary', model, deps: d });

    const content = String(captured?.messages?.[0]?.content ?? '');
    ok('the prompt carries the supplied data block', content.includes('## SUPPLIED DATA'));
    ok('it carries this project\'s real name', content.includes('End To End Development'));
    ok('the no-fabrication rules bracket the payload',
      String(captured?.system).includes('ABSOLUTE RULES ON FIGURES') && /every figure you write must appear verbatim/i.test(content));
    ok('no external market data is offered', !/benchmark|comparable/i.test(content) || /No external data is available/i.test(content));

    // The figures in the prompt must BE the engine's figures.
    const doc = buildIcModelGrounding(model, { scale: 'millions', currencyCode: 'SAR' });
    const facts = allFacts([doc]);
    const gdv = facts.find((f) => f.key === 'dev.gdv');
    ok('the grounding carries the engine\'s GDV', !!gdv);
    ok('and the same reading appears in the prompt', content.includes(String(gdv?.formatted)));
  }

  // ══ GUARDRAIL 4: the audit catches an invented figure, and does not block ══
  {
    const doc = buildIcModelGrounding(model, { scale: 'millions', currencyCode: 'SAR' });
    const invented = auditGroundedText('Comparable schemes trade at 8,750 per sqm.', [doc]);
    eq('an invented figure is caught', invented.ok, false);

    const calls: Calls = { meter: 0, run: 0, ensure: 0, refund: 0 };
    const res: any = await generateIcNarrative({
      userId: 'u', field: 'executiveSummary', model,
      deps: deps({ calls, text: 'The scheme benchmarks at 9,412 per sqm against its peers.' }) as any,
    });
    // THE SETTLED DECISION (Unit 9): show it, do not block it.
    eq('a flagged draft is still RETURNED', res.ok, true);
    eq('the audit reports the failure', res.audit.ok, false);
    ok('the offending figure travels with the draft', res.audit.unsupported.length > 0);
    ok('the draft text is intact and usable', typeof res.draft === 'string' && res.draft.length > 10);
  }

  // ══ GUARDRAIL 5: the flagged draft warns in the review, and stays usable ══
  {
    const deck: any = seedDeck('p', model, { inputs: null } as any, { asOf: '2026-08-01' });
    const target = findNarrativeTargets(deck)[0];
    ok('a narrative target exists to review into', !!target);

    const flagged = [{
      field: target.field, label: 'Executive summary', target,
      draft: 'A draft that quotes 9,412 per sqm.',
      audit: { ok: false, checked: 1, supported: 0, rounded: 0, unsupported: [{ raw: '9,412', index: 20 }], summary: '1 unsupported' },
    }];
    const html = renderToString(React.createElement(NarrativeReviewModal, {
      drafts: flagged, onApply: () => {}, onClose: () => {},
    } as any));

    ok('the review WARNS on a flagged draft', html.includes(`ai-audit-flag-${target.field}`));
    ok('the warning names the unmatched figure', html.includes('9,412'));
    ok('and says what to do about it', /could not be matched to a figure/.test(html));
    ok('the draft is still EDITABLE', html.includes(`ai-draft-text-${target.field}`) && html.includes('<textarea'));
    ok('Apply is still offered', html.includes(`ai-apply-${target.field}`));
    ok('Discard is still offered', html.includes(`ai-discard-${target.field}`));
    // Nothing in the flagged path may disable the controls.
    const applyIdx = html.indexOf(`ai-apply-${target.field}`);
    const applyTag = html.slice(Math.max(0, applyIdx - 400), applyIdx + 60);
    ok('Apply is NOT disabled on a flagged draft', !/disabled=""/.test(applyTag), applyTag.slice(-160));

    const clean = renderToString(React.createElement(NarrativeReviewModal, {
      drafts: [{ ...flagged[0], audit: { ok: true, checked: 2, supported: 2, rounded: 0, unsupported: [], summary: 'ok' } }],
      onApply: () => {}, onClose: () => {},
    } as any));
    ok('a clean draft says so instead', clean.includes(`ai-audit-ok-${target.field}`));
    ok('and carries no warning', !clean.includes(`ai-audit-flag-${target.field}`));
  }

  // ══ GUARDRAIL 6: the draft is never auto-saved ═══════════════════════════
  {
    const svc = code('src/hubs/modeling/platforms/refm/lib/ai/icNarrativeService.ts');
    const route = code('app/api/refm/projects/[id]/ai/ic-narrative/route.ts');
    const ui = code('src/hubs/modeling/platforms/refm/components/modules/deck/NarrativeAi.tsx');
    const shell = code('src/hubs/modeling/platforms/refm/components/modules/Module7Deck.tsx');

    for (const [name, src] of [['service', svc], ['route', route], ['ui', ui]] as const) {
      ok(`the ${name} imports no persistence writer`,
        !/saveReportInputs|saveReportDeck|insertVersion|updateVersion/.test(src));
    }
    ok('the route states the draft is not applied', /applied:\s*false/.test(route));
    ok('the panel hands drafts up rather than applying them', !/buildNarrativePatch/.test(ui));
    ok('only the review modal\'s Apply reaches the deck', /onApply=\{applyNarrativeDrafts\}/.test(shell));
    ok('an applied draft is undoable and still needs Save',
      /applyNarrativeDrafts[\s\S]{0,500}commit\(/.test(shell));
    ok('nothing applies a draft as it arrives', !/onDrafts=\{\(d\) => applyNarrativeDrafts/.test(shell));
  }

  // ══ GUARDRAIL 7: the quota UI mirrors the server and hard-stops ══════════
  {
    const panel = (status: any) => renderToString(React.createElement(NarrativeAiPanel, {
      projectId: 'p', deck: seedDeck('p', model, { inputs: null } as any, { asOf: '2026-08-01' }),
      model, currency: 'SAR', status, selectedObjectId: null,
      onStatusRefresh: () => {}, onDrafts: () => {}, onNotice: () => {},
    } as any));

    const on = panel({ available: true, blockedReason: null, enabled: true, configured: true, cap: 100, used: 12, remaining: 88, planKey: 'pro', periodStart: '2026-08-01' });
    ok('the allowance is shown', on.includes('AI generations left this month'));
    ok('Generate all is offered', on.includes('ai-generate-all'));
    ok('every field has a Generate button', IC_NARRATIVE_FIELD_KEYS.filter((k) => on.includes(`ai-generate-${k}`)).length >= 4);

    const spent = panel({ available: false, blockedReason: 'used all', enabled: true, configured: true, cap: 100, used: 100, remaining: 0, planKey: 'pro', periodStart: '2026-08-01' });
    ok('at the cap the hard stop shows', spent.includes('ai-cap-reached'));
    ok('it names the monthly limit', spent.includes('Monthly AI limit reached'));
    ok('it offers the upgrade route', spent.includes('ai-upgrade-link') && spent.includes('/pricing'));
    ok('and Generate all is disabled', /ai-generate-all[^>]*disabled|disabled[^>]*ai-generate-all/.test(spent));

    const unknown = panel({ available: false, blockedReason: 'no cap', enabled: true, configured: true, cap: null, used: null, remaining: null, planKey: 'pro', periodStart: '2026-08-01' });
    ok('an unknown allowance says so', unknown.includes('allowance not available'));
    ok('and never renders as a zero', !unknown.includes('0 of 0'));

    const off = panel({ available: false, blockedReason: 'off', enabled: false, configured: true, cap: 100, used: 0, remaining: 100, planKey: 'pro', periodStart: '2026-08-01' });
    eq('with the feature off the section renders nothing', off, '');

    const ui = code('src/hubs/modeling/platforms/refm/components/modules/deck/NarrativeAi.tsx');
    ok('the displayed count comes from the server response', /res\.data\.meter\.remaining/.test(ui));
    ok('and is never decremented locally', !/remaining\s*-\s*1|remaining--/.test(ui));
  }

  // ══ GUARDRAIL 8: the Presentation tab survives the AI section ════════════
  {
    const shell = code('src/hubs/modeling/platforms/refm/components/modules/Module7Deck.tsx');
    ok('the AI section is inside an error boundary', /<NarrativeAiBoundary>/.test(read('src/hubs/modeling/platforms/refm/components/modules/Module7Deck.tsx')));
    ok('the status fetch fails soft', /try \{[\s\S]{0,400}getIcNarrativeStatus[\s\S]{0,400}\} catch/.test(shell));
    // The regression from Unit 8: a hook after an early return crashed the tab.
    const start = shell.indexOf('export default function Module7Deck');
    const body = shell.slice(start);
    const guard = body.search(/\n {2}if \(![A-Za-z]+\) return </);
    const hooksAfter = [...body.slice(guard).matchAll(/\b(useState|useEffect|useMemo|useCallback|useRef)\s*\(/g)];
    eq('no hook is called after an early return', hooksAfter.length, 0);
  }

  // ══ GUARDRAIL 9: a deployment failure does not silently cost a credit ════
  {
    const calls: Calls = { meter: 0, run: 0, ensure: 0, refund: 0 };
    const res: any = await generateIcNarrative({
      userId: 'u', field: 'executiveSummary', model, deps: deps({ calls, configured: false }) as any,
    });
    eq('with no API key the generation refuses', res.ok, false);
    eq('and NO credit is claimed', calls.meter, 0);
    eq('and no ai call is attempted', calls.run, 0);
    ok('and the message says the allowance was not used', /no ai allowance was used/i.test(res.message));
  }
  {
    const calls: Calls = { meter: 0, run: 0, ensure: 0, refund: 0 };
    const res: any = await generateIcNarrative({
      userId: 'u', field: 'executiveSummary', model, deps: deps({ calls, aiKind: 'insufficient_credit' }) as any,
    });
    eq('an out-of-credit account is reported', res.ok, false);
    ok('as a BILLING problem, not a model or plan problem',
      /billing/i.test(res.message) && !/model/i.test(res.message), res.message);
    ok('and it does not blame the user\'s plan', !/your plan/i.test(res.message.replace(/not a problem with your project or your plan/i, '')));
  }
  {
    const client = code('src/shared/ai/client.ts');
    ok('the client classifies an out-of-credit 400 distinctly', /insufficient_credit/.test(client));
    ok('and still falls back to bad_request if the wording changes',
      client.indexOf('insufficient_credit') < client.indexOf("kind: 'bad_request'"));
  }

  // ══ GUARDRAIL 9b: a failed generation does not cost quota (migration 206) ══
  //
  // The credit is consumed before the call for concurrency reasons, so the
  // other half is giving it back whenever the call produced nothing. Every
  // failure mode is exercised: an out-of-credit account, a rate limit, a
  // timeout, a network drop, and a 200 that carried no usable text.
  {
    for (const kind of ['insufficient_credit', 'rate_limit', 'network', 'server', 'unknown', 'refusal']) {
      const calls: Calls = { meter: 0, run: 0, ensure: 0, refund: 0 };
      const res: any = await generateIcNarrative({
        userId: 'u', field: 'executiveSummary', model, deps: deps({ calls, aiKind: kind }) as any,
      });
      eq(`a ${kind} failure refuses`, res.ok, false);
      eq(`a ${kind} failure consumed one credit`, calls.meter, 1);
      eq(`and refunded it`, calls.refund, 1);
      eq(`and reports the refund to the caller`, res.refund?.refunded, true);
    }

    // A 200 with nothing usable in it is still a failure for the user.
    {
      const calls: Calls = { meter: 0, run: 0, ensure: 0, refund: 0 };
      const res: any = await generateIcNarrative({
        userId: 'u', field: 'executiveSummary', model, deps: deps({ calls, text: '   ' }) as any,
      });
      eq('an empty draft refuses', res.stage, 'empty');
      eq('and the credit is refunded', calls.refund, 1);
      ok('and the message says the allowance was not used', /allowance has not been used/i.test(res.message));
    }

    // A SUCCESS keeps its count. This is the other half of the rule and the one
    // that would quietly make the cap meaningless if it broke.
    {
      const calls: Calls = { meter: 0, run: 0, ensure: 0, refund: 0 };
      const res: any = await generateIcNarrative({
        userId: 'u', field: 'executiveSummary', model, deps: deps({ calls, text: 'A clean grounded paragraph.' }) as any,
      });
      eq('a successful generation succeeds', res.ok, true);
      eq('and does NOT refund', calls.refund, 0);
    }

    // A FLAGGED draft is a success: the user has usable text, so it is charged.
    {
      const calls: Calls = { meter: 0, run: 0, ensure: 0, refund: 0 };
      const res: any = await generateIcNarrative({
        userId: 'u', field: 'executiveSummary', model,
        deps: deps({ calls, text: 'The scheme benchmarks at 9,412 per sqm.' }) as any,
      });
      eq('a flagged draft is still a success', res.ok, true);
      eq('its audit failed', res.audit.ok, false);
      eq('and it is NOT refunded, because the user received a draft', calls.refund, 0);
    }

    // The failure path must not be blocked by a refund that itself fails.
    {
      const calls: Calls = { meter: 0, run: 0, ensure: 0, refund: 0 };
      const d: any = deps({ calls, aiKind: 'rate_limit' });
      d.refund = async () => ({ refunded: false as const, reason: 'not_installed' as const });
      const res: any = await generateIcNarrative({ userId: 'u', field: 'executiveSummary', model, deps: d });
      eq('a refund that cannot run still returns the original failure', res.stage, 'ai');
      eq('and reports that nothing was given back', res.refund?.refunded, false);
      eq('naming the reason', res.refund?.reason, 'not_installed');
    }

    // The UI must resync its allowance after a failure rather than leaving a
    // consumed-but-refunded number on screen.
    const ui = code('src/hubs/modeling/platforms/refm/components/modules/deck/NarrativeAi.tsx');
    ok('the panel re-reads the allowance after a failed generation',
      /res\.error \|\| !res\.data[\s\S]{0,600}getIcNarrativeStatus\(projectId\)/.test(ui));
    ok('and pushes the refreshed numbers up',
      /fresh\.data[\s\S]{0,200}onStatusRefresh\(\{[\s\S]{0,120}remaining: fresh\.data\.remaining/.test(ui));
  }

  // ══ GUARDRAIL 10: the voice ══════════════════════════════════════════════
  {
    ok('the voice sets the practitioner-teaching stance',
      /practitioner/i.test(IC_NARRATIVE_VOICE) && /TEACH THE MECHANISM/.test(IC_NARRATIVE_VOICE));
    ok('constructive, not critical, is stated', /CONSTRUCTIVE, NOT CRITICAL/.test(IC_NARRATIVE_VOICE));
    ok('the IC register is set', /investment committee/i.test(IC_NARRATIVE_VOICE));
    ok('first person is banned', /Do not write "we", "I", "our", or "you"/.test(IC_NARRATIVE_VOICE));
    ok('em dashes are banned in the voice', /Never use an em dash/.test(IC_NARRATIVE_VOICE));
    for (const w of BANNED_MARKETING_WORDS) {
      ok(`the voice names "${w}" as banned`, IC_NARRATIVE_VOICE.toLowerCase().includes(w));
    }
    // The rule that keeps the audit quiet: describe relationships, do not compute them.
    ok('the voice forbids computing comparisons', /COMPARE IN WORDS, NOT IN ARITHMETIC/.test(IC_NARRATIVE_VOICE));
    ok('and explains why, so it is not read as style', /nobody checked/.test(IC_NARRATIVE_VOICE));
    ok('absent figures have a stated handling', /WHEN A FIGURE IS NOT AVAILABLE/.test(IC_NARRATIVE_VOICE));

    for (const k of IC_NARRATIVE_FIELD_KEYS) {
      const spec = IC_NARRATIVE_FIELDS[k];
      ok(`${k} states what it must READ AS`, /READS AS:/.test(spec.shape));
      ok(`${k} states what it must NOT become`, /NOT AS:/.test(spec.shape));
      const full = narrativeTaskFor(spec);
      ok(`${k} composes task then shape`, full.includes(spec.task) && full.endsWith(spec.shape));
      ok(`${k} carries no em dash`, !/[\u2014\u2015]/.test(full));
      for (const w of BANNED_MARKETING_WORDS) {
        // The prompt may NAME a banned word only in the voice block, never use it.
        ok(`${k} does not itself use "${w}"`, !full.toLowerCase().includes(w));
      }
    }
    eq('the thesis reads as a thesis', /investment thesis/i.test(IC_NARRATIVE_FIELDS.executiveSummary.shape), true);
    eq('risks read as a debatable register', /risk register/i.test(IC_NARRATIVE_FIELDS.risks.shape), true);
    eq('the recommendation reads as an ask', /ask/i.test(IC_NARRATIVE_FIELDS.recommendation.shape), true);
    eq('risks are structured rows, not prose', IC_NARRATIVE_FIELDS.risks.format, 'risks');
  }

  console.log(`\nverify-ic-narrative-e2e: ${pass} passed, ${fail} failed`);
  if (fail > 0) process.exit(1);
}

void main();
