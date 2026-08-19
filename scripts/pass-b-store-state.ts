/**
 * pass-b-store-state.ts (2026-08-19).
 *
 * The fund terms live in TWO stores: the durable `refm_fund_terms` row (what the
 * Fund Terms tab saves, and what `attachToProject` seeds an empty snapshot from)
 * and `project.fundTerms` inside the version snapshot (what the ENGINE reads).
 * They are allowed to differ while a version is being viewed, but a project
 * whose two stores disagree about a SETTLED setting is a trap: the tab shows one
 * thing and the numbers come from the other.
 *
 * Reports both, field by field, and says whether they agree once each side is
 * resolved through `resolveFundTerms` (so an ABSENT field that defaults to the
 * same value is correctly reported as agreeing, not as a difference).
 *
 * READ ONLY by default. Pass --repair to write the DURABLE row so it matches the
 * snapshot on the fields that disagree. The snapshot is never written: it is
 * versioned history, and rewriting it would change what a saved version means.
 *
 * Run: npx tsx scripts/pass-b-store-state.ts
 *      npx tsx scripts/pass-b-store-state.ts --repair
 */
/* eslint-disable no-console */
import { createClient } from '@supabase/supabase-js';
import { readFileSync } from 'node:fs';
import { resolveFundTerms, toRow } from '@/src/hubs/modeling/platforms/refm/lib/fundTerms';

for (const file of ['.env.local', '.env']) {
  try {
    for (const line of readFileSync(file, 'utf8').split('\n')) {
      const m = /^([A-Z0-9_]+)\s*=\s*(.*)$/.exec(line.trim());
      if (m && !process.env[m[1]]) process.env[m[1]] = m[2].replace(/^["']|["']$/g, '');
    }
  } catch { /* optional */ }
}
const url = process.env.SUPABASE_URL ?? process.env.NEXT_PUBLIC_SUPABASE_URL ?? '';
const key = process.env.SUPABASE_SERVICE_ROLE_KEY ?? '';
if (!url || !key) { console.error('Missing creds'); process.exit(1); }
const sb = createClient(url, key, { auth: { persistSession: false } });
const REPAIR = process.argv.includes('--repair');

/** The settings a user chooses. Compared after resolution, so an absent field
 *  that defaults to the same value counts as agreeing. */
const COMPARED = ['enabled', 'managementFeeFunding'] as const;

async function main(): Promise<void> {
  const { data: projects } = await sb.from('refm_projects')
    .select('id, name, updated_at').order('updated_at', { ascending: false });

  for (const proj of projects ?? []) {
    const { data: vers } = await sb.from('refm_project_versions')
      .select('version_number, snapshot').eq('project_id', proj.id)
      .order('version_number', { ascending: false }).limit(1);
    const snap = vers?.[0]?.snapshot as Record<string, unknown> | null;
    if (!snap) continue;
    const { data: rows, error } = await sb.from('refm_fund_terms')
      .select('*').eq('project_id', proj.id).limit(1);
    if (error) { console.log(`${proj.name}: durable read error ${error.message}`); continue; }
    const row = rows?.[0];

    const projObj = (snap.project ?? {}) as Record<string, unknown>;
    const rawSnapTerms = projObj.fundTerms as Record<string, unknown> | undefined;
    const snapResolved = resolveFundTerms(projObj as never);

    console.log(`\n==================== ${proj.name} (v${vers?.[0]?.version_number}) ====================`);
    console.log(`  durable row present: ${row ? 'yes' : 'NO'}`);
    if (row) {
      console.log(`      fund_enabled            = ${JSON.stringify(row.fund_enabled)}`);
      console.log(`      management_fee_funding  = ${JSON.stringify(row.management_fee_funding)}`);
    }
    console.log(`  snapshot project.fundTerms: ${rawSnapTerms ? 'present' : 'ABSENT'}`);
    if (rawSnapTerms) {
      console.log(`      enabled                 = ${JSON.stringify(rawSnapTerms.enabled)}`);
      console.log(`      managementFeeFunding    = ${JSON.stringify(rawSnapTerms.managementFeeFunding)}`);
    }
    console.log(`  RESOLVED from the snapshot (what the ENGINE uses):`);
    console.log(`      enabled=${snapResolved.enabled}  managementFeeFunding=${snapResolved.managementFeeFunding}`);

    if (!row) { console.log('  -> no durable row to reconcile'); continue; }

    // Resolve the DURABLE side the same way, so absent-versus-default is not
    // reported as a difference.
    const durableResolved = {
      enabled: row.fund_enabled === true,
      managementFeeFunding: row.management_fee_funding === 'equity' ? 'equity' : 'deficit',
    };
    const diffs = COMPARED.filter((k) => durableResolved[k] !== snapResolved[k]);
    if (diffs.length === 0) {
      console.log('  -> AGREE on every compared setting');
      continue;
    }
    console.log(`  -> DISAGREE on: ${diffs.join(', ')}`);
    for (const k of diffs) {
      console.log(`        ${k}: durable ${JSON.stringify(durableResolved[k])} vs snapshot ${JSON.stringify(snapResolved[k])}`);
    }
    console.log('     The snapshot is what produces the numbers on screen, so the durable row is the stale side.');

    if (!REPAIR) { console.log('     (dry run: pass --repair to align the durable row to the snapshot)'); continue; }

    // Write the DURABLE row from the SNAPSHOT's resolved terms. This changes no
    // chosen setting: it makes the stale store say what the model already does.
    // The FULL resolved terms, so the durable row becomes a faithful copy of the
    // snapshot rather than a partial patch that leaves other fields stale.
    const payload = { project_id: proj.id, ...toRow(snapResolved) };
    const { error: wErr } = await sb.from('refm_fund_terms').upsert(payload, { onConflict: 'project_id' });
    if (wErr) { console.log(`     REPAIR FAILED: ${wErr.message}`); continue; }
    const { data: after } = await sb.from('refm_fund_terms')
      .select('fund_enabled, management_fee_funding').eq('project_id', proj.id).limit(1);
    console.log(`     REPAIRED. durable now fund_enabled=${JSON.stringify(after?.[0]?.fund_enabled)} management_fee_funding=${JSON.stringify(after?.[0]?.management_fee_funding)}`);
  }
}

main().catch((e: unknown) => { console.error(e); process.exit(1); });
