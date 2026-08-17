/**
 * diagnose-gated-lines.ts (2026-08-17c)
 *
 * READ ONLY. Every cost line carrying `requiresCountry` in a saved project,
 * with what it charges TODAY, so the retirement of the country gate can be
 * shown to move no number.
 *
 * Run: npx tsx scripts/diagnose-gated-lines.ts
 */
import { createClient } from '@supabase/supabase-js';
import { readFileSync } from 'node:fs';
import { hydrationFromAnySnapshot, retireCountryGatedLines } from '@/src/hubs/modeling/platforms/refm/lib/state/module1-migrate';
import { computeAssetCost } from '@/src/core/calculations';
import { countryMatches } from '@/src/core/countries';
import type { CostLine } from '@/src/hubs/modeling/platforms/refm/lib/state/module1-types';

for (const f of ['.env.local', '.env']) {
  try {
    for (const l of readFileSync(f, 'utf8').split('\n')) {
      const m = /^([A-Z0-9_]+)\s*=\s*(.*)$/.exec(l.trim());
      if (m && !process.env[m[1]]) process.env[m[1]] = m[2].replace(/^["']|["']$/g, '');
    }
  } catch { /* optional */ }
}

async function main(): Promise<void> {
  const sb = createClient(process.env.SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!, { auth: { persistSession: false } });
  const { data: projects } = await sb.from('refm_projects').select('id, name').limit(50);
  for (const p of projects ?? []) {
    const { data: vers } = await sb.from('refm_project_versions')
      .select('version_number, snapshot').eq('project_id', p.id)
      .order('version_number', { ascending: false }).limit(1);
    if (!vers?.length) continue;
    const s = hydrationFromAnySnapshot(JSON.parse(JSON.stringify(vers[0].snapshot)));
    const gated = (s.costLines as CostLine[]).filter((c) => !!c.requiresCountry);
    console.log(`\n=== ${p.name} (v${vers[0].version_number}) country=${JSON.stringify(s.project.country)} ===`);
    if (gated.length === 0) { console.log('  no country-gated lines'); continue; }
    for (const c of gated) {
      const chargeable = countryMatches(c.requiresCountry, s.project.country);
      // What it charges today, across every asset in its phase.
      let charged = 0;
      for (const a of s.assets.filter((x) => x.phaseId === c.phaseId && x.isCompanion !== true && x.visible !== false)) {
        const phase = s.phases.find((ph) => ph.id === a.phaseId);
        if (!phase) continue;
        const bd = computeAssetCost({
          asset: a, project: s.project, phase, parcels: s.parcels, assets: s.assets,
          subUnits: s.subUnits, costLines: s.costLines, costOverrides: s.costOverrides,
          landAllocationMode: s.landAllocationMode,
        });
        charged += bd.byLineId[c.id] ?? 0;
      }
      console.log(`  ${c.id} "${c.name}" needs ${JSON.stringify(c.requiresCountry)} rate=${c.value}`);
      console.log(`     chargeable today: ${chargeable ? 'YES' : 'no'} | charges: ${Math.round(charged).toLocaleString('en-US')}`);
      console.log(`     -> ${chargeable ? 'KEEP, gate stripped (stays charged, no change)' : 'REMOVE (invisible and charging nothing today)'}`);
    }

    // THE PROOF THE USER ASKED FOR: the whole project's capex, with the gated
    // rows as saved and after the retirement.
    const totalWith = (lines: typeof s.costLines): number => {
      let t = 0;
      for (const a of s.assets.filter((x) => x.isCompanion !== true && x.visible !== false)) {
        const phase = s.phases.find((ph) => ph.id === a.phaseId);
        if (!phase) continue;
        t += computeAssetCost({
          asset: a, project: s.project, phase, parcels: s.parcels, assets: s.assets,
          subUnits: s.subUnits, costLines: lines, costOverrides: s.costOverrides,
          landAllocationMode: s.landAllocationMode,
        }).total;
      }
      return t;
    };
    const before = totalWith(s.costLines);
    const after = totalWith(retireCountryGatedLines(s).costLines);
    console.log(`  PROJECT CAPEX  as saved: ${Math.round(before).toLocaleString('en-US')}  after retirement: ${Math.round(after).toLocaleString('en-US')}  delta: ${Math.round(after - before).toLocaleString('en-US')}`);
  }
}

main().catch((e) => { console.error(e); process.exit(1); });
