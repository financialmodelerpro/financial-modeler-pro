/**
 * fetch-fmp-re-hub.ts (one-off)
 *
 * Pulls the LIVE "FMP RE HUB" project's latest-version snapshot from Supabase
 * and writes it to scripts/fmpReHubSnapshot.json so the Module 6 field audit
 * (verify-module6-field-audit.ts) runs against the real project, not a sample.
 *
 * Run: npx tsx scripts/fetch-fmp-re-hub.ts
 */
import { createClient } from '@supabase/supabase-js';
import { readFileSync, writeFileSync } from 'node:fs';

// Load .env.local manually (tsx does not auto-load it).
for (const file of ['.env.local', '.env']) {
  try {
    for (const line of readFileSync(file, 'utf8').split('\n')) {
      const m = /^([A-Z0-9_]+)\s*=\s*(.*)$/.exec(line.trim());
      if (m && !process.env[m[1]]) process.env[m[1]] = m[2].replace(/^["']|["']$/g, '');
    }
  } catch { /* file optional */ }
}

const url = process.env.SUPABASE_URL ?? process.env.NEXT_PUBLIC_SUPABASE_URL ?? '';
const key = process.env.SUPABASE_SERVICE_ROLE_KEY ?? '';
if (!url || !key) { console.error('Missing SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY'); process.exit(1); }

const sb = createClient(url, key, { auth: { persistSession: false } });

async function main(): Promise<void> {
  const { data: projects, error: pErr } = await sb
    .from('refm_projects')
    .select('id, name, updated_at')
    .ilike('name', '%RE HUB%')
    .order('updated_at', { ascending: false });
  if (pErr) { console.error('project query error:', pErr.message); process.exit(1); }
  console.log('Matched projects:', JSON.stringify(projects, null, 2));
  const proj = (projects ?? [])[0];
  if (!proj) { console.error('No project matching "RE HUB"'); process.exit(1); }

  const { data: ver, error: vErr } = await sb
    .from('refm_project_versions')
    .select('id, version_number, snapshot, label, created_at')
    .eq('project_id', proj.id)
    .order('version_number', { ascending: false })
    .limit(1)
    .maybeSingle();
  if (vErr) { console.error('version query error:', vErr.message); process.exit(1); }
  if (!ver?.snapshot) { console.error('No snapshot on latest version'); process.exit(1); }

  const out = {
    projectId: proj.id,
    projectName: proj.name,
    versionId: ver.id,
    versionNumber: ver.version_number,
    label: ver.label,
    snapshot: ver.snapshot,
  };
  writeFileSync('scripts/fmpReHubSnapshot.json', JSON.stringify(out, null, 2));
  const snap = ver.snapshot as Record<string, unknown>;
  console.log(`\nWrote scripts/fmpReHubSnapshot.json`);
  console.log(`Project: ${proj.name}  version ${ver.version_number}  (${ver.label ?? 'no label'})`);
  console.log(`Snapshot keys: ${Object.keys(snap).length}`);
  console.log(`  assets=${(snap.assets as unknown[] | undefined)?.length ?? 0}`
    + ` subUnits=${(snap.subUnits as unknown[] | undefined)?.length ?? 0}`
    + ` costLines=${(snap.costLines as unknown[] | undefined)?.length ?? 0}`
    + ` costOverrides=${(snap.costOverrides as unknown[] | undefined)?.length ?? 0}`
    + ` financingTranches=${(snap.financingTranches as unknown[] | undefined)?.length ?? 0}`
    + ` parcels=${(snap.parcels as unknown[] | undefined)?.length ?? 0}`);
}

void main();
