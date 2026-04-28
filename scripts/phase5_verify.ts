/**
 * scripts/phase5_verify.ts
 *
 * Read-only verification that the Phase 5 recovery sweep landed
 * cleanly. Re-queries each target's watch row + the matching
 * admin_audit_log entries and prints a pass/fail line per check.
 *
 * Run:
 *   npx tsx --env-file=.env.local scripts/phase5_verify.ts
 */

import { getServerClient } from '../src/core/db/supabase';

const TARGETS: Array<{ email: string; tab_key?: string }> = [
  { email: 'muhammadtayyabmadni07@gmail.com' },
  { email: 'yusra.tufail@yahoo.com' },
  { email: 'daniyal1012@yahoo.com' },
  { email: 'fakhrizanul@gmail.com', tab_key: '3SFM_S2' },
];

async function main() {
  const sb = getServerClient();
  let pass = 0, fail = 0;

  for (const t of TARGETS) {
    console.log(`\n--- ${t.email}${t.tab_key ? ` / ${t.tab_key}` : ''} ---`);

    let q = sb
      .from('certification_watch_history')
      .select('tab_key, status, watch_percentage, completed_via, completed_at, updated_at')
      .eq('student_email', t.email);
    if (t.tab_key) q = q.eq('tab_key', t.tab_key);
    const { data: rows } = await q;

    const targetRows = (rows ?? []).filter(r => !t.tab_key || r.tab_key === t.tab_key);
    const stuckRow = targetRows.find(r => r.completed_via === 'admin_override');

    if (stuckRow && stuckRow.status === 'completed') {
      console.log(`  ROW       status=${stuckRow.status} pct=${stuckRow.watch_percentage}% via=${stuckRow.completed_via} at=${stuckRow.completed_at}`);
      pass++;
    } else if (targetRows.find(r => r.status === 'completed')) {
      console.log(`  ROW       status=completed but completed_via != admin_override (existing row?)`);
      pass++;
    } else {
      console.log(`  ROW       MISSING expected admin_override row`);
      fail++;
    }

    // Audit log lookup. Match on action + tab_key + email to catch
    // exactly the rows our script wrote.
    const { data: audits } = await sb
      .from('admin_audit_log')
      .select('id, action, after_value, created_at')
      .eq('action', 'watch_force_complete')
      .order('created_at', { ascending: false })
      .limit(20);
    const audit = (audits ?? []).find(a => {
      const v = a.after_value as { tab_key?: string; email?: string; via?: string } | null;
      return v?.email === t.email && (!t.tab_key || v?.tab_key === t.tab_key) && v?.via === 'phase5_recovery_script';
    });
    if (audit) {
      console.log(`  AUDIT     id=${String(audit.id).slice(0, 8)} created_at=${audit.created_at}`);
      pass++;
    } else {
      console.log(`  AUDIT     NOT FOUND`);
      fail++;
    }
  }

  console.log(`\n=== RESULT === ${pass} pass, ${fail} fail`);
  if (fail > 0) process.exit(1);
}

main().catch(e => { console.error(e); process.exit(1); });
