/* eslint-disable @typescript-eslint/no-explicit-any */
/**
 * verify-strategy-switch.ts (M1 Assets, 2026-08-11)
 *
 * Changing an asset's strategy must make the MODEL behave accordingly:
 * the new strategy's assumptions activate, the old ones deactivate and stop
 * feeding the model, nothing is deleted, and switching back restores what was
 * there. This file proves that against the REAL project where possible and the
 * shared fixture otherwise.
 *
 * The checks are about five things and nothing else:
 *
 *   1. NOTHING IS LOST. Every round trip (A -> B -> A) restores the model
 *      byte for byte. This is the check the old code could not pass: leaving
 *      Sell + Manage hard-deleted the companion asset, its sub-units, its cost
 *      lines and its cost overrides.
 *
 *   2. THE NEW STRATEGY ACTIVATES. After a switch the asset owns sub-units in
 *      the incoming strategy's category, seeded with the outgoing counts and
 *      areas, so the model is not silently zero.
 *
 *   3. THE OLD STRATEGY DEACTIVATES. No sub-unit in the outgoing category is
 *      left on the live arrays, so nothing stale can reach the engine.
 *
 *   4. THE USER IS TOLD. The report names what activated, what was retained and
 *      what is still empty, and the rate is deliberately NOT carried across (a
 *      sale price is not an ADR).
 *
 *   5. IT IS A NO-OP WHEN IT SHOULD BE. Same strategy in, same state out; a
 *      companion asset cannot be switched directly.
 *
 * Run: npx tsx --env-file=.env.local scripts/verify-strategy-switch.ts
 *
 * No em dashes in this file.
 */
import { readFileSync } from 'fs';
import { join } from 'path';
import { createClient } from '@supabase/supabase-js';
import { computeFinancialsSnapshot } from '../src/hubs/modeling/platforms/refm/lib/financials-resolvers';
import {
  applyStrategySwitch, CATEGORY_BY_STRATEGY, REVENUE_KEY_BY_STRATEGY,
  type StrategySwitchState,
} from '../src/hubs/modeling/platforms/refm/lib/state/strategySwitch';
import {
  useModule1Store,
  DEFAULT_MODULE1_STATE,
} from '../src/hubs/modeling/platforms/refm/lib/state/module1-store';
import { buildExcelSampleState } from './excelSampleState';

let pass = 0, fail = 0;
const failures: string[] = [];
const check = (name: string, cond: boolean, detail = ''): void => {
  if (cond) { pass++; console.log(`  [PASS] ${name}`); }
  else { fail++; failures.push(name); console.log(`  [FAIL] ${name}${detail ? ' :: ' + detail : ''}`); }
};

const PID = '1daa9217-d2b8-4b22-acbf-18fed79adeff';
const STRATEGIES = ['Sell', 'Sell + Manage', 'Operate', 'Lease'] as const;
const M = (v: number): string => (v / 1e6).toFixed(2) + 'm';
const sum = (a: readonly number[] = []): number => a.reduce((s, v) => s + (v ?? 0), 0);
const clone = <T,>(v: T): T => JSON.parse(JSON.stringify(v)) as T;

/**
 * Deterministic serialisation of the LIVE MODEL, with array order normalised
 * (a restored companion legitimately lands at the end of the list).
 *
 * `retainedByStrategy` and `strategyReview` are excluded ON PURPOSE. They are
 * retention state, not model state: after Operate -> Sell -> Operate the asset
 * correctly carries a parked Sell set, so that a SECOND visit to Sell restores
 * rather than re-seeds. Including them would assert that a round trip forgets
 * where it has been, which is the opposite of the feature. The bank is checked
 * separately, so this exclusion hides nothing.
 */
const canon = (s: StrategySwitchState): string => JSON.stringify({
  assets: [...s.assets].map((a) => ({ ...a, strategyReview: undefined, retainedByStrategy: undefined })).sort((x, y) => x.id.localeCompare(y.id)),
  subUnits: [...s.subUnits].sort((x, y) => x.id.localeCompare(y.id)),
  costLines: [...s.costLines].sort((x, y) => String(x.id).localeCompare(String(y.id))),
  costOverrides: [...s.costOverrides].sort((x, y) => `${x.assetId}|${x.lineId}`.localeCompare(`${y.assetId}|${y.lineId}`)),
});

const slice = (st: any): StrategySwitchState => ({
  assets: clone(st.assets), subUnits: clone(st.subUnits),
  costLines: clone(st.costLines ?? []), costOverrides: clone(st.costOverrides ?? []),
});

/** Fold a switch result back into a full model state, so the engine can run. */
const merge = (st: any, r: StrategySwitchState): any =>
  ({ ...clone(st), assets: r.assets, subUnits: r.subUnits, costLines: r.costLines, costOverrides: r.costOverrides });

async function loadState(): Promise<{ st: any; src: string }> {
  const url = process.env.SUPABASE_URL, key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) return { st: buildExcelSampleState(), src: 'FIXTURE (no database credentials)' };
  try {
    const sb = createClient(url, key, { auth: { persistSession: false } });
    const { data, error } = await sb.from('refm_project_versions')
      .select('snapshot,version_label').eq('project_id', PID)
      .order('created_at', { ascending: false }).limit(1);
    if (error || !data?.length) return { st: buildExcelSampleState(), src: `FIXTURE (${error?.message ?? 'no versions'})` };
    return { st: (data[0] as any).snapshot, src: `FMP RE HUB, saved version ${(data[0] as any).version_label}` };
  } catch (e) {
    return { st: buildExcelSampleState(), src: `FIXTURE (${(e as Error).message})` };
  }
}

async function main(): Promise<void> {
  const { st, src } = await loadState();
  console.log('=== Strategy switch: assumptions activate, deactivate and are retained ===');
  console.log(`Data source: ${src}\n`);
  const base = slice(st);
  const targets = base.assets.filter((a) => a.isCompanion !== true);
  console.log(`Assets: ${targets.length} (plus ${base.assets.length - targets.length} companion)\n`);

  // ══ 1. ROUND TRIP LOSES NOTHING ═══════════════════════════════════════════
  console.log('-- 1. A -> B -> A restores the model exactly --');
  let roundTripFails = 0;
  for (const a of targets) {
    for (const to of STRATEGIES) {
      if (to === a.strategy) continue;
      const out = applyStrategySwitch(base, a.id, to);
      const backReport = applyStrategySwitch(out, a.id, a.strategy);
      if (canon(backReport) !== canon(base)) {
        roundTripFails++;
        if (roundTripFails <= 3) console.log(`      first divergence: ${a.name} ${a.strategy} -> ${to} -> ${a.strategy}`);
      }
    }
  }
  check('every asset survives every round trip byte for byte', roundTripFails === 0, `${roundTripFails} failures`);
  // The bank is EXCLUDED from that identity, so prove separately that it is
  // really there and really used. Without this the exclusion above would let a
  // build that simply threw the retained sets away pass.
  {
    const a = targets[0];
    const to = STRATEGIES.find((s) => s !== a.strategy)!;
    const out = applyStrategySwitch(base, a.id, to);
    const there = out.assets.find((x) => x.id === a.id)!;
    check('the outgoing strategy is parked in the bank while away',
      !!there.retainedByStrategy?.[a.strategy], Object.keys(there.retainedByStrategy ?? {}).join(','));
    check('the strategy now ACTIVE is not also sitting in the bank (no stale duplicate)',
      !there.retainedByStrategy?.[to]);
    const home = applyStrategySwitch(out, a.id, a.strategy).assets.find((x) => x.id === a.id)!;
    check('after coming home the visited strategy is parked instead',
      !!home.retainedByStrategy?.[to] && !home.retainedByStrategy?.[a.strategy],
      Object.keys(home.retainedByStrategy ?? {}).join(','));
  }

  // The specific case the old code could not do: Sell + Manage owns a whole
  // companion asset, which used to be deleted with its sub-units, cost lines
  // and cost overrides on the way out.
  const sm = targets.find((a) => a.strategy === 'Sell + Manage');
  check('the fixture exercises Sell + Manage (a companion exists to lose)', !!sm, sm?.name ?? 'none');
  if (sm) {
    const companionIds = base.assets.filter((a) => a.parentAssetId === sm.id).map((a) => a.id);
    check('Sell + Manage owns a companion asset', companionIds.length === 1, companionIds.join(','));
    const away = applyStrategySwitch(base, sm.id, 'Sell');
    check('leaving Sell + Manage removes the companion from the LIVE assets',
      !away.assets.some((a) => companionIds.includes(a.id)));
    check('leaving Sell + Manage removes its sub-units from the LIVE arrays',
      !away.subUnits.some((u) => companionIds.includes(u.assetId)));
    const parked = away.assets.find((a) => a.id === sm.id)?.retainedByStrategy?.['Sell + Manage'];
    check('the companion is RETAINED, not deleted', !!parked?.companion, parked ? 'retained' : 'MISSING');
    check('the retained companion keeps its sub-units', (parked?.companion?.subUnits.length ?? 0) > 0);
    const back = applyStrategySwitch(away, sm.id, 'Sell + Manage');
    check('switching back restores the SAME companion (not a fresh default)',
      back.assets.some((a) => companionIds.includes(a.id)));
    check('switching back restores its sub-units with their ADRs intact',
      canon(back) === canon(base));
    check('the report says the companion was retained',
      away.report.retained.some((t) => /companion/i.test(t)), away.report.retained.join(' | '));
  }

  // ══ 2. THE NEW STRATEGY ACTIVATES ═════════════════════════════════════════
  console.log('\n-- 2. The incoming strategy activates, seeded from the outgoing set --');
  for (const a of targets.slice(0, 4)) {
    for (const to of STRATEGIES) {
      if (to === a.strategy) continue;
      const out = applyStrategySwitch(base, a.id, to);
      const own = out.subUnits.filter((u) => u.assetId === a.id);
      const wanted = own.filter((u) => u.category === CATEGORY_BY_STRATEGY[to]);
      const hadBefore = base.subUnits.filter((u) => u.assetId === a.id && u.category === CATEGORY_BY_STRATEGY[a.strategy]);
      // Only assert activation when there was something to seed FROM.
      if (hadBefore.length === 0) continue;
      check(`${a.name}: ${a.strategy} -> ${to} activates ${CATEGORY_BY_STRATEGY[to]} sub-units`,
        wanted.length === hadBefore.length, `${wanted.length} vs ${hadBefore.length}`);
      check(`${a.name}: ${a.strategy} -> ${to} carries counts and areas across`,
        wanted.every((u, i) => u.metricValue === hadBefore[i].metricValue && (u.unitArea ?? 0) === (hadBefore[i].unitArea ?? 0)));
      // The RATE must NOT carry: a sale price is not an ADR and not a lease rate.
      check(`${a.name}: ${a.strategy} -> ${to} does NOT carry the rate across`,
        wanted.every((u) => (u.unitPrice ?? 0) === 0 && (u.startingAdr ?? 0) === 0));
    }
  }

  // ══ 3. THE OLD STRATEGY DEACTIVATES ═══════════════════════════════════════
  console.log('\n-- 3. The outgoing strategy stops feeding the model --');
  let staleRows = 0, supportLost = 0;
  for (const a of targets) {
    const supportBefore = base.subUnits.filter((u) => u.assetId === a.id && u.category === 'Support').length;
    for (const to of STRATEGIES) {
      if (to === a.strategy) continue;
      const out = applyStrategySwitch(base, a.id, to);
      const own = out.subUnits.filter((u) => u.assetId === a.id);
      // Nothing in the OUTGOING category may remain live, unless the two
      // strategies share one (Sell and Sell + Manage are both Sellable).
      if (CATEGORY_BY_STRATEGY[to] !== CATEGORY_BY_STRATEGY[a.strategy]) {
        staleRows += own.filter((u) => u.category === CATEGORY_BY_STRATEGY[a.strategy]).length;
      }
      if (own.filter((u) => u.category === 'Support').length !== supportBefore) supportLost++;
    }
  }
  check('no sub-unit from the outgoing strategy is left on the live arrays', staleRows === 0, `${staleRows} stale rows`);
  check('Support sub-units are never moved (they belong to no strategy)', supportLost === 0, `${supportLost} losses`);

  // The engine is the real test: the outgoing strategy's revenue must be gone
  // and the model must still compute.
  {
    const a = targets.find((x) => x.strategy === 'Sell' && base.subUnits.some((u) => u.assetId === x.id));
    check('the fixture has a Sell asset to move', !!a, a?.name ?? 'none');
    if (a) {
      const before = computeFinancialsSnapshot(st);
      const out = applyStrategySwitch(base, a.id, 'Operate');
      const after = computeFinancialsSnapshot(merge(st, out));
      check('the model still computes after a strategy change',
        Number.isFinite(sum(after.pl.totalRevenuePerPeriod)));
      check('project revenue MOVES (the old strategy stopped feeding the model)',
        Math.abs(sum(after.pl.totalRevenuePerPeriod) - sum(before.pl.totalRevenuePerPeriod)) > 1,
        `${M(sum(before.pl.totalRevenuePerPeriod))} -> ${M(sum(after.pl.totalRevenuePerPeriod))}`);
      // And the retained set is still there for the trip back.
      const parked = out.assets.find((x) => x.id === a.id)?.retainedByStrategy?.Sell?.subUnits ?? [];
      check('the outgoing Sell sub-units are parked on the asset', parked.length > 0, `${parked.length}`);
      const back = computeFinancialsSnapshot(merge(st, applyStrategySwitch(out, a.id, 'Sell')));
      check('switching back reproduces the ORIGINAL project revenue exactly',
        Math.abs(sum(back.pl.totalRevenuePerPeriod) - sum(before.pl.totalRevenuePerPeriod)) < 1e-6,
        `${M(sum(back.pl.totalRevenuePerPeriod))} vs ${M(sum(before.pl.totalRevenuePerPeriod))}`);
      check('switching back reproduces the ORIGINAL PAT exactly',
        Math.abs(sum(back.pl.patPerPeriod) - sum(before.pl.patPerPeriod)) < 1e-6);
    }
  }

  // ══ 4. THE USER IS TOLD ═══════════════════════════════════════════════════
  console.log('\n-- 4. The report names what activated and what is still empty --');
  {
    const a = targets.find((x) => x.strategy === 'Sell')!;
    const r = applyStrategySwitch(base, a.id, 'Operate').report;
    check('the report names the asset and both strategies',
      r.assetName === a.name && r.from === 'Sell' && r.to === 'Operate');
    check('the report lists something to review', r.needsReview.length > 0, r.needsReview.join(' | '));
    check('the report flags the missing Operate revenue configuration',
      r.needsReview.some((t) => /Operate revenue configuration/.test(t)));
    check('the report flags the blank ADR', r.needsReview.some((t) => /ADR/.test(t)));
    check('the report says what was retained', r.retained.length > 0, r.retained.join(' | '));
    check('the report says what was seeded', r.seeded.length > 0, r.seeded.join(' | '));
    // Second visit: restored, not seeded again.
    const there = applyStrategySwitch(base, a.id, 'Operate');
    const backAgain = applyStrategySwitch(there, a.id, 'Sell');
    const second = applyStrategySwitch(backAgain, a.id, 'Operate').report;
    check('a SECOND visit restores rather than re-seeds',
      second.restored.length > 0 && second.seeded.length === 0,
      `restored=${second.restored.length} seeded=${second.seeded.length}`);
  }

  // ══ 5. NO-OPS ═════════════════════════════════════════════════════════════
  console.log('\n-- 5. No-ops --');
  {
    const a = targets[0];
    const same = applyStrategySwitch(base, a.id, a.strategy);
    check('switching to the SAME strategy changes nothing', canon(same) === canon(base));
    check('switching to the same strategy reports nothing',
      same.report.retained.length === 0 && same.report.seeded.length === 0 && same.report.needsReview.length === 0);
    check('an unknown asset id is a no-op', canon(applyStrategySwitch(base, 'nope', 'Lease')) === canon(base));
    const comp = base.assets.find((x) => x.isCompanion === true);
    if (comp) check('a COMPANION asset cannot be switched directly',
      canon(applyStrategySwitch(base, comp.id, 'Lease')) === canon(base));
  }

  // ══ 6. WIRING ═════════════════════════════════════════════════════════════
  console.log('\n-- 6. Wiring --');
  const root = join(__dirname, '..');
  const store = readFileSync(join(root, 'src/hubs/modeling/platforms/refm/lib/state/module1-store.ts'), 'utf8');
  const ui = readFileSync(join(root, 'src/hubs/modeling/platforms/refm/components/modules/Module1Assets.tsx'), 'utf8');
  const notice = readFileSync(join(root, 'src/hubs/modeling/platforms/refm/components/modules/_shared/StrategyChangeNotice.tsx'), 'utf8');
  check('the store delegates a strategy change to the shared pure function',
    /applyStrategySwitch\(/.test(store));
  check('the store no longer deletes the companion on leaving Sell + Manage',
    !/leavesSellManage/.test(store));
  // 2026-08-15: this was a grep for the literal `strategyReview: { ...res.report`,
  // which broke the moment the assignment became conditional even though the
  // behaviour was intact. It is now behavioural, and asserts BOTH halves of the
  // rule: the banner is recorded on a real change, and is NOT recorded on the
  // first strategy pick for a new asset (which was firing a four-item review on
  // an asset with nothing on it, because a new asset is created as 'Sell' and
  // needsReview means "active but empty").
  {
    const phaseId = DEFAULT_MODULE1_STATE.phases[0].id;
    const newAsset = (id: string): any => ({
      id, phaseId, name: id, type: '', strategy: 'Sell', visible: true,
      gfaSqm: 0, buaSqm: 0, sellableBuaSqm: 0, parkingBaysRequired: 0, status: 'planned',
    });
    const st = useModule1Store.getState();

    st.hydrate({ ...DEFAULT_MODULE1_STATE, assets: [], subUnits: [] });
    st.addAsset(newAsset('fresh'));
    useModule1Store.getState().updateAsset('fresh', { strategy: 'Operate' });
    const fresh = useModule1Store.getState().assets.find((a) => a.id === 'fresh');
    check('the store raises NO review banner on a first strategy pick',
      fresh?.strategyReview === undefined,
      JSON.stringify(fresh?.strategyReview?.needsReview));
    check('...and the strategy still changed', fresh?.strategy === 'Operate');

    st.hydrate({ ...DEFAULT_MODULE1_STATE, assets: [], subUnits: [] });
    st.addAsset(newAsset('built'));
    useModule1Store.getState().addSubUnit({
      id: 'su_built', assetId: 'built', name: 'Apartments', category: 'Sellable',
      metric: 'units', metricValue: 40, unitArea: 100, unitPrice: 900_000,
    } as any);
    useModule1Store.getState().updateAsset('built', { strategy: 'Operate' });
    const built = useModule1Store.getState().assets.find((a) => a.id === 'built');
    check('the store records the report as a review banner on a REAL change',
      built?.strategyReview !== undefined
      && (built?.strategyReview?.needsReview.length ?? 0) > 0);
  }
  check('the dropdown previews instead of writing straight through',
    /onChange=\{\(e\) => onStrategyPick\(/.test(ui) && !/onChange=\{\(e\) => onUpdate\(\{ strategy:/.test(ui));
  check('the preview is a DRY RUN of the same pure function', /applyStrategySwitch\(/.test(ui));
  check('the confirm dialog is rendered', /<StrategyChangeConfirm/.test(ui));
  check('the review banner is rendered and is dismissible', /<StrategyReviewBanner/.test(ui) && /dismissStrategyReview\(/.test(ui));
  check('the confirm and the banner share ONE report body (they cannot disagree)',
    /function ReportBody/.test(notice)
    && (notice.match(/<ReportBody /g) ?? []).length === 2);
  check('every strategy maps to a sub-unit category', STRATEGIES.every((s) => !!CATEGORY_BY_STRATEGY[s]));
  check('every strategy maps to a revenue sub-config', STRATEGIES.every((s) => !!REVENUE_KEY_BY_STRATEGY[s]));
  check('Sell and Sell + Manage share the Sell revenue config',
    REVENUE_KEY_BY_STRATEGY['Sell'] === 'sell' && REVENUE_KEY_BY_STRATEGY['Sell + Manage'] === 'sell');

  // House style. The needle is BUILT rather than written, because a literal
  // em dash in this file would make the check fail on its own source.
  const EM_DASH = String.fromCharCode(0x2014);
  for (const [name, text] of [
    ['strategySwitch.ts', readFileSync(join(root, 'src/hubs/modeling/platforms/refm/lib/state/strategySwitch.ts'), 'utf8')],
    ['StrategyChangeNotice.tsx', notice],
    ['verify-strategy-switch.ts', readFileSync(__filename, 'utf8')],
  ] as Array<[string, string]>) {
    check(`no em dash in ${name}`, !text.includes(EM_DASH));
  }

  console.log(`\n=== Result: ${pass} passed, ${fail} failed ===`);
  if (fail) { console.log('Failures:\n' + failures.map((f) => `  - ${f}`).join('\n')); process.exit(1); }
}
main().catch((e) => { console.error(e); process.exit(1); });
