/**
 * verify-idc-participants: THE ASSETS THAT SHARE CAPITALISED INTEREST ARE ONE RULE'S.
 *
 * The split skipped every companion, written when "companion" meant only the Operate companion.
 * The retail strip became a companion with land, capex and depreciation on 2026-09-10 and took no
 * interest until 2026-09-29; on Marina Gate the other five lines carried its 4.09m instead, and the
 * total still footed, so nothing fired. `sharesCapitalisedInterest` (core) is now the one rule, and
 * the engine and the live workbook's copy of the split both call it; `verify-formula-workbook`
 * holds the workbook's arithmetic to the engine's in real Excel, cell by cell.
 *
 * P1 the rule's own cases. P2 on the live model the engine gives a share to exactly the assets the
 * rule admits, the retail strips included, and the total foots. P3 an Operate companion added to a
 * copy takes no share and moves no other asset's (the exclusion branch, proved to fire).
 *
 * Run: npx tsx --env-file=.env.local scripts/verify-idc-participants.ts
 */
import { loadLiveExportInputs } from './fixtures/liveExportInputs';
import { platformAfterEdit } from './fixtures/platformAfterEdit';
import { computeFinancialsSnapshot } from '../src/hubs/modeling/platforms/refm/lib/financials-resolvers';
import { sharesCapitalisedInterest } from '../src/core/calculations/capitalisedInterest';
import { isRetailCompanion } from '../src/core/calculations/retailCompanion';

let pass = 0, fail = 0;
const failures: string[] = [];
const check = (name: string, cond: boolean, detail = ''): void => {
  if (cond) { pass++; console.log(`  [PASS] ${name}`); }
  else { fail++; failures.push(name); console.log(`  [FAIL] ${name}${detail ? ` :: ${detail}` : ''}`); }
};
const quiet = <T,>(f: () => T): T => { const l = console.log, w = console.warn; console.log = () => {}; console.warn = () => {}; try { return f(); } finally { console.log = l; console.warn = w; } };
const sum = (a: number[] | undefined): number => (a ?? []).reduce((s, v) => s + (v ?? 0), 0);

(async () => {
  console.log('=== verify-idc-participants ===');
  check('P1a an ordinary asset shares', sharesCapitalisedInterest({}));
  check('P1b a retail strip shares (it carries its own capex)', sharesCapitalisedInterest({ isCompanion: true, companionType: 'retail' }));
  check('P1c an Operate companion does not (its cost sits on its parent)', !sharesCapitalisedInterest({ isCompanion: true }));
  check('P1d a hidden asset does not', !sharesCapitalisedInterest({ visible: false }));

  const input = await loadLiveExportInputs();
  const st: any = input.state;
  const snap: any = quiet(() => computeFinancialsSnapshot(st));
  const vis = st.assets.filter((a: any) => a.visible !== false);
  const admitted = new Set(vis.filter(sharesCapitalisedInterest).map((a: any) => a.id));
  const rowed = new Set([...snap.idc.byAsset.keys()]);
  const same = admitted.size === rowed.size && [...admitted].every((id) => rowed.has(id));
  check('P2a the engine gives a row to exactly the assets the rule admits', same, `rule ${admitted.size}, engine ${rowed.size}`);
  const strips = vis.filter(isRetailCompanion);
  check(`P2b every retail strip takes a share (${strips.length} on ${input.projectName})`, strips.length > 0 && strips.every((a: any) => sum(snap.idc.byAsset.get(a.id)?.idcPerPeriod) > 0),
    strips.map((a: any) => `${a.id} ${sum(snap.idc.byAsset.get(a.id)?.idcPerPeriod).toFixed(2)}`).join('; '));
  const allocated = [...snap.idc.byAsset.values()].reduce((s: number, r: any) => s + sum(r.idcPerPeriod), 0);
  check('P2c the shares foot to the capitalised interest', Math.abs(allocated - sum(snap.idc.totalIdcPerPeriod)) < 0.01, `${allocated.toFixed(2)} vs ${sum(snap.idc.totalIdcPerPeriod).toFixed(2)}`);

  // P3: an Operate companion beside the hotel (a Sell + Manage sibling), on a copy.
  const hotel = vis.find((a: any) => a.strategy === 'Operate' && a.isCompanion !== true);
  if (!hotel) { check('P3 needs an Operate asset to sit a companion beside', false); }
  else {
    const s = structuredClone(input.snapshot) as any;
    s.assets.push({ ...structuredClone(s.assets.find((a: any) => a.id === hotel.id)), id: 'verify_operate_companion', isCompanion: true, parentAssetId: hotel.id, companionType: undefined });
    const snap2: any = quiet(() => computeFinancialsSnapshot(platformAfterEdit(s) as any));
    check('P3a an Operate companion takes no share', !snap2.idc.byAsset.has('verify_operate_companion'));
    const moved = vis.filter((a: any) => Math.abs(sum(snap2.idc.byAsset.get(a.id)?.idcPerPeriod) - sum(snap.idc.byAsset.get(a.id)?.idcPerPeriod)) > 0.01).map((a: any) => a.id);
    check('P3b and moves no other asset\'s', moved.length === 0, moved.join(', '));
  }

  console.log(`\n${fail === 0 ? 'ALL PASS' : 'FAILURES'}: ${pass} passed, ${fail} failed`);
  for (const f of failures) console.log(`  - ${f}`);
  process.exit(fail === 0 ? 0 : 1);
})();
