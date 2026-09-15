/**
 * verify-management-model.ts (2026-09-15)
 *
 * THE MANAGEMENT MODEL IS ONE MODEL ON EVERY SURFACE.
 *
 * The store kept its base copy (`baseSnapshot`) as the base AS STORED, before
 * the load-time settles, while the screen showed the base AFTER them. The IC
 * deck read that copy as its Management case (equity IRR 22.36% against 21.07%
 * on screen on the live project, with nobody having saved a scenario), the
 * comparison showed it as the Management column whenever a scenario was open,
 * and a save with a scenario active wrote every settle difference into the
 * scenario as an override, pinning it against later Types and Standards edits.
 *
 * A. Source: hydrate keeps the SETTLED base; the deck reads `managementModelOf`.
 * B. Live, every project version with a scenario, opened on the base: the deck's
 *    Management model is the screen, and so is the comparison's Management column.
 * C. Opened with a scenario active: the base copy equals the base as opened on the
 *    base, and the comparison's Management column reads the same equity IRR.
 * D. A save with a scenario that holds no overrides writes none, and writes the
 *    same top level as a save on the base.
 * E. A Types and Standards rate edited on the base reaches the scenario, after a
 *    save and reopen with the scenario active.
 *
 * Run: npx tsx --env-file=.env.local scripts/verify-management-model.ts
 * No em dashes in this file.
 */
/* eslint-disable no-console, @typescript-eslint/no-explicit-any */
import { readFileSync } from 'node:fs';
import { hydrationFromAnySnapshotChecked } from '../src/hubs/modeling/platforms/refm/lib/state/module1-migrate';
import { createModule1Store, pickModel } from '../src/hubs/modeling/platforms/refm/lib/state/module1-store';
import { computeFinancialsSnapshot } from '../src/hubs/modeling/platforms/refm/lib/financials-resolvers';
import { computeReturnsSnapshot } from '../src/hubs/modeling/platforms/refm/lib/returns-resolvers';
import { buildCaseComparisonReport } from '../src/hubs/modeling/platforms/refm/lib/reports/caseComparisonReport';
import { managementModelOf } from '../src/hubs/modeling/platforms/refm/lib/cases/managementModel';

let pass = 0; let fail = 0;
const check = (name: string, ok: boolean, detail = ''): void => {
  if (ok) { pass++; console.log(`  [PASS] ${name}`); } else { fail++; console.log(`  [FAIL] ${name}${detail ? `: ${detail}` : ''}`); }
};
const quiet = <T>(fn: () => T): T => { const w = console.warn, l = console.log; console.warn = () => {}; console.log = () => {}; try { return fn(); } finally { console.warn = w; console.log = l; } };
const live = (s: any): any => pickModel(s as Record<string, unknown>);
const open = (raw: any): any => { const st = createModule1Store(); quiet(() => st.getState().hydrate(hydrationFromAnySnapshotChecked(raw).snapshot)); return st; };
const irr = (m: any): number | null => quiet(() => { const s: any = computeFinancialsSnapshot(m); return (computeReturnsSnapshot(s, m.project) as any).result.fcfe.irr; });
const same = (a: number | null, b: number | null): boolean => (a == null && b == null) || (a != null && b != null && Math.abs(a - b) < 1e-9);
const pct = (x: number | null): string => (x == null ? 'n/a' : `${(x * 100).toFixed(4)}%`);
const cmpManagement = (s: any): number | null => {
  const baseId = s.cases.find((c: any) => c.role === 'base').id;
  const r: any = quiet(() => buildCaseComparisonReport({ baseModel: managementModelOf(s, live(s)), cases: s.cases, activeCaseId: s.activeCaseId, liveActiveModel: live(s) } as any));
  return r.columns.find((c: any) => c.id === baseId || c.role === 'base' || c.name === s.cases.find((x: any) => x.id === baseId).name)?.values['Equity IRR (FCFE)'] ?? null;
};

async function main(): Promise<void> {
  console.log('A. Source');
  const store = readFileSync('src/hubs/modeling/platforms/refm/lib/state/module1-store.ts', 'utf8');
  check('A1 hydrate keeps the settled base as the copy', /baseSnapshot: settledBase\.model/.test(store) && !/baseSnapshot: baseModel,/.test(store));
  check('A2 a scenario is applied over the settled base', /settleOnLoad\(applyOverrides\(settledBase\.model, active\.overrides\)\)/.test(store));
  const deck = readFileSync('src/hubs/modeling/platforms/refm/components/modules/Module7Deck.tsx', 'utf8');
  check('A3 the deck reads its Management case through managementModelOf', /managementModelOf\(/.test(deck) && !/s\.baseSnapshot \?\? liveModel\) as HydrateSnapshot, \[s\.baseSnapshot, liveModel\]/.test(deck));

  const URL = process.env.SUPABASE_URL, KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!URL || !KEY) { check('live sections need credentials (run with --env-file=.env.local)', false); return; }
  const h = { apikey: KEY, Authorization: `Bearer ${KEY}` };
  const get = async (p: string): Promise<any[]> => { const r = await fetch(`${URL}/rest/v1/${p}`, { headers: h }); if (!r.ok) throw new Error(await r.text()); return r.json(); };
  const ps = await get('refm_projects?select=id,name,current_version_id&deleted_at=is.null&order=name');
  let covered = 0; let editCovered = 0;
  for (const p of ps) {
    if (!p.current_version_id) continue;
    const [v] = await get(`refm_project_versions?id=eq.${p.current_version_id}&select=snapshot`);
    const raw = v?.snapshot;
    if (!raw || !(raw.assets ?? []).length) continue;
    const baseCase = (raw.cases ?? []).find((c: any) => c.role === 'base');
    const scen = (raw.cases ?? []).find((c: any) => c.role === 'scenario' && Object.keys(c.overrides ?? {}).length === 0);
    if (!baseCase || !scen) continue;
    covered++;
    console.log(`\n${p.name}`);
    const b = open(raw).getState();
    const screen = irr(live(b));
    check('B1 opened on the base: the deck Management IRR is the screen', same(irr(managementModelOf(b, live(b))), screen), `${pct(irr(managementModelOf(b, live(b))))} vs ${pct(screen)}`);
    check('B2 opened on the base: the comparison Management column is the screen', same(cmpManagement(b), screen), `${pct(cmpManagement(b))} vs ${pct(screen)}`);
    const sc = open({ ...raw, activeCaseId: scen.id }).getState();
    check('C1 opened on a scenario: the base copy is the base as opened on the base', same(irr(sc.baseSnapshot), screen), `${pct(irr(sc.baseSnapshot))} vs ${pct(screen)}`);
    check('C2 opened on a scenario: the deck Management IRR is the base', same(irr(managementModelOf(sc, live(sc))), screen));
    check('C3 opened on a scenario: the comparison Management column is the base', same(cmpManagement(sc), screen), `${pct(cmpManagement(sc))} vs ${pct(screen)}`);
    const savedScen: any = quiet(() => sc.extractPersistSnapshot());
    const savedBase: any = quiet(() => b.extractPersistSnapshot());
    const n = Object.keys(savedScen.cases.find((c: any) => c.id === scen.id).overrides).length;
    check('D1 a save with an empty scenario active writes no overrides into it', n === 0, `${n} written`);
    const top = (x: any): string => { const { cases: _c, activeCaseId: _a, ...t } = x; return JSON.stringify(t); };
    check('D2 and writes the same top level as a save on the base', top(savedScen) === top(savedBase));
    const su = (b.subUnits as any[]).find((u) => u.category === 'Sellable' && Number(u.unitPrice) > 0);
    if (su) {
      const path = `subUnits[id=${su.id}].unitPrice`;
      const target = Math.round(su.unitPrice * 1.1);
      const withLever = { ...raw, activeCaseId: scen.id, cases: raw.cases.map((c: any) => (c.id === scen.id ? { ...c, overrides: { [path]: target } } : c)) };
      const lv = open(withLever).getState();
      check('F1 a Module 6 unit price lever survives the load settle', Number(lv.subUnits.find((u: any) => u.id === su.id)?.unitPrice) === target, `${lv.subUnits.find((u: any) => u.id === su.id)?.unitPrice} vs ${target}`);
      const out: any = quiet(() => lv.extractPersistSnapshot());
      check('F2 and a save keeps it as the case override', Number(out.cases.find((c: any) => c.id === scen.id).overrides[path]) === target);
    }
    const rows = (b.project.costStandardRows ?? []) as any[];
    const row = rows.find((r) => typeof r.rate === 'number' && r.rate > 0 && r.assetTypeId);
    if (!row) continue;
    editCovered++;
    const st = open({ ...savedScen, activeCaseId: baseCase.id });
    quiet(() => st.getState().setCostStandardRows((st.getState().project.costStandardRows as any[]).map((r) => (r.id === row.id ? { ...r, rate: r.rate + 1000 } : r))));
    const baseOv = JSON.stringify(st.getState().costOverrides.filter((o: any) => o.origin === 'standard'));
    const baseIrr = irr(live(st.getState()));
    quiet(() => st.getState().setActiveCase(scen.id));
    const scenOv = JSON.stringify(st.getState().costOverrides.filter((o: any) => o.origin === 'standard'));
    check('E1 a Types and Standards rate edited on the base reaches the scenario (standard overrides identical)', baseOv === scenOv);
    check('E2 and the scenario prices it (equity IRR equal to the edited base)', same(irr(live(st.getState())), baseIrr), `${pct(irr(live(st.getState())))} vs ${pct(baseIrr)}`);
  }
  check('\nlive coverage: at least one project with an empty scenario', covered > 0, String(covered));
  check('live coverage: at least one Types and Standards edit', editCovered > 0, String(editCovered));
}

main().then(() => { console.log(`\n=== ${pass} passed, ${fail} failed ===`); process.exit(fail ? 1 : 0); })
  .catch((e) => { console.error(e); process.exit(1); });
