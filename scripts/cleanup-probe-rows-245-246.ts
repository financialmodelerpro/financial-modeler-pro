/**
 * cleanup-probe-rows-245-246.ts
 *
 * REMOVES THE PROBE ROWS MY OWN APPLIERS COMMITTED (2026-09-23).
 *
 * `apply-migration-245.ts` and `apply-migration-246.ts` proved themselves by
 * WRITING rows and never undid those writes, so running them with `--apply`
 * committed fiction into a real project's append-only audit log and a
 * future-dated row into the unread-marker table. Every applier before them
 * deleted its probes explicitly; mine did not, and the dry run hid it because
 * a dry run rolls everything back.
 *
 * WHAT IS REMOVED, and why each is certainly a probe and not a user's work:
 *
 *   refm_project_changes, 3 rows dated 2026-09-22T14:15, all with
 *   `user_id IS NULL`, `before IS NULL` and `after IS NULL`, two of them
 *   naming a fictional asset `assets[id=a]` with hand-written labels. A real
 *   save always carries a user and a value on at least one side.
 *
 *   refm_project_last_seen, the row whose `seen_at` is IN THE FUTURE, written
 *   by 246's upsert test (`now() + interval '1 hour'`). It is not merely
 *   untrue, it BREAKS the feature for that person: nothing reads as new until
 *   the clock catches up.
 *
 * Deletion is permitted on the change log by design (the project cascade
 * depends on it); the append-only trigger guards UPDATE, not DELETE.
 *
 * Run: npx tsx scripts/cleanup-probe-rows-245-246.ts          (dry run)
 *      npx tsx scripts/cleanup-probe-rows-245-246.ts --apply
 *
 * No em dashes in this file.
 */
import { createClient } from '@supabase/supabase-js';
import { readFileSync } from 'node:fs';

for (const f of ['.env.local', '.env']) {
  try {
    for (const l of readFileSync(f, 'utf8').split('\n')) {
      const m = /^([A-Z0-9_]+)\s*=\s*(.*)$/.exec(l.trim());
      if (m && !process.env[m[1]]) process.env[m[1]] = m[2].replace(/^["']|["']$/g, '');
    }
  } catch { /* optional */ }
}

const APPLY = process.argv.includes('--apply');

/** The exact rows, by id. Named rather than matched by a pattern, so this
 *  script cannot widen its own blast radius if the data changes. */
const CHANGE_ROW_IDS = [
  '79838e52-3d41-4028-8402-8edee85c176e', // project.name, the "bare row" probe
  'd0aed816-3822-44ce-bbbd-fb224f2882f9', // assets[id=a].landAreaSqm
  '610f3c9e-5f16-4ae7-86bc-3298f0acd1b6', // assets[id=a].buaSqm
];

(async () => {
  const sb = createClient(process.env.SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!, { auth: { persistSession: false } });
  console.log(`=== probe cleanup (${APPLY ? 'APPLY' : 'DRY RUN'}) ===\n`);

  // ── 1. The change-log probes ────────────────────────────────────────────
  const { data: rows, error } = await sb
    .from('refm_project_changes')
    .select('id, user_id, action, path, label, before, after, created_at')
    .in('id', CHANGE_ROW_IDS);
  if (error) { console.error('read failed:', error.message); process.exit(1); }

  console.log(`change-log rows matched: ${(rows ?? []).length} of ${CHANGE_ROW_IDS.length}`);
  let safe = true;
  for (const r of (rows ?? []) as Array<Record<string, unknown>>) {
    // RE-PROVED AT DELETE TIME, not trusted from the diagnosis. A row that has
    // gained a user or a value since is NOT a probe and is left alone.
    const isProbe = r.user_id === null && r.before === null && r.after === null;
    console.log(`  ${isProbe ? 'PROBE ' : 'KEEP  '} ${r.created_at} ${r.action} ${r.path}`);
    if (!isProbe) { safe = false; console.log('     ^ has a user or a value: NOT deleting this one.'); }
  }
  if (!safe) { console.error('\nREFUSING: at least one row does not look like a probe.'); process.exit(1); }

  // ── 2. The future-dated last-seen marker ────────────────────────────────
  const { data: seen } = await sb
    .from('refm_project_last_seen')
    .select('user_id, project_id, seen_at');
  const now = Date.now();
  const future = ((seen ?? []) as Array<{ user_id: string; project_id: string; seen_at: string }>)
    .filter((r) => new Date(r.seen_at).getTime() > now);
  console.log(`\nlast-seen rows dated in the FUTURE: ${future.length}`);
  for (const r of future) console.log(`  ${r.seen_at}  user=${r.user_id.slice(0, 8)} project=${r.project_id.slice(0, 8)}`);

  if (!APPLY) {
    console.log('\nDRY RUN: nothing deleted. Re-run with --apply.');
    return;
  }

  const del1 = await sb.from('refm_project_changes').delete().in('id', CHANGE_ROW_IDS);
  if (del1.error) { console.error('change-log delete failed:', del1.error.message); process.exit(1); }
  for (const r of future) {
    const d = await sb.from('refm_project_last_seen').delete()
      .eq('user_id', r.user_id).eq('project_id', r.project_id);
    if (d.error) { console.error('last-seen delete failed:', d.error.message); process.exit(1); }
  }

  // ── 3. Prove it, rather than assume the delete worked ───────────────────
  const { data: left } = await sb.from('refm_project_changes').select('id').in('id', CHANGE_ROW_IDS);
  const { data: seenLeft } = await sb.from('refm_project_last_seen').select('seen_at');
  const stillFuture = ((seenLeft ?? []) as Array<{ seen_at: string }>)
    .filter((r) => new Date(r.seen_at).getTime() > Date.now()).length;
  console.log(`\nAFTER: change-log probes remaining ${(left ?? []).length} (want 0)`);
  console.log(`AFTER: future-dated markers remaining ${stillFuture} (want 0)`);
  if ((left ?? []).length === 0 && stillFuture === 0) console.log('\nCLEAN.');
  else { console.error('\nNOT CLEAN.'); process.exit(1); }
})();
