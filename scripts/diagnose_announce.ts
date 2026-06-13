/**
 * scripts/diagnose_announce.ts
 *
 * Read-only diagnosis of the live-session announcement dispatch path.
 * Answers: did the last announce actually attempt the test account, and
 * what did Brevo report per-recipient.
 *
 * Usage:
 *   npx tsx --env-file=.env.local scripts/diagnose_announce.ts [testEmail]
 *
 * Required env: SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY.
 */

import { getServerClient } from '../src/core/db/supabase';

const testEmail = (process.argv[2] ?? '').toLowerCase().trim();

async function main() {
  const sb = getServerClient();

  // 1. Most recent announcement dispatches
  const { data: logs, error: logErr } = await sb
    .from('announcement_send_log')
    .select('id, session_id, sent_at, sent_by_email, target, recipient_count, success_count, failure_count, was_preview, error_message')
    .order('sent_at', { ascending: false })
    .limit(5);

  if (logErr) { console.error('send_log query failed:', logErr.message); }
  console.log('\n=== Last 5 announcement_send_log rows ===');
  for (const l of logs ?? []) {
    console.log(`- ${l.sent_at} session=${l.session_id} target=${l.target} preview=${l.was_preview} count=${l.recipient_count} ok=${l.success_count} fail=${l.failure_count} err=${l.error_message ?? '-'}`);
  }

  // 2. Per-recipient detail for the latest non-preview dispatch
  const latest = (logs ?? []).find(l => !l.was_preview) ?? (logs ?? [])[0];
  if (latest) {
    const { data: rows } = await sb
      .from('announcement_recipient_log')
      .select('email, status, resend_message_id, error_message, sent_at')
      .eq('send_log_id', latest.id)
      .order('status', { ascending: true });
    console.log(`\n=== Recipient rows for latest dispatch ${latest.id} (${rows?.length ?? 0} rows) ===`);
    const byStatus: Record<string, number> = {};
    for (const r of rows ?? []) byStatus[r.status] = (byStatus[r.status] ?? 0) + 1;
    console.log('status counts:', byStatus);
    // show a sample + any failures
    for (const r of (rows ?? []).slice(0, 8)) {
      console.log(`  ${r.status.padEnd(8)} ${r.email.padEnd(38)} msgId=${r.resend_message_id ?? '-'} err=${r.error_message ?? '-'}`);
    }
    if (testEmail) {
      const hit = (rows ?? []).find(r => r.email.toLowerCase() === testEmail);
      console.log(`\n  >> test account "${testEmail}" in this dispatch:`, hit ? `YES status=${hit.status} msgId=${hit.resend_message_id ?? '-'} err=${hit.error_message ?? '-'}` : 'NO (was never queued)');
    }
  }

  // 3. Does the test account pass the announce recipient filter?
  if (testEmail) {
    const { data: meta } = await sb
      .from('training_registrations_meta')
      .select('email, name, registration_id, email_confirmed, training_enrollments(course_code)')
      .ilike('email', testEmail);
    console.log(`\n=== training_registrations_meta for "${testEmail}" ===`);
    if (!meta || meta.length === 0) {
      console.log('  NOT FOUND in training_registrations_meta -> announce roster (fetchRecipients) would EXCLUDE it.');
    } else {
      for (const m of meta) {
        const confirmed = m.email_confirmed;
        const passesFilter = confirmed === true || confirmed === null;
        console.log(`  email_confirmed=${confirmed} -> announce filter (eq.true OR is.null) ${passesFilter ? 'INCLUDES' : 'EXCLUDES'}; enrollments=${JSON.stringify((m as { training_enrollments?: { course_code: string }[] }).training_enrollments ?? [])}`);
      }
    }
  }

  // 4. Roster size the announce path would resolve right now
  const { data: all } = await sb
    .from('training_registrations_meta')
    .select('email, email_confirmed')
    .or('email_confirmed.eq.true,email_confirmed.is.null');
  const { count: totalMeta } = await sb
    .from('training_registrations_meta')
    .select('*', { count: 'exact', head: true });
  console.log(`\n=== Roster ===`);
  console.log(`  total training_registrations_meta rows: ${totalMeta ?? '?'}`);
  console.log(`  rows passing announce filter (confirmed or null): ${all?.length ?? 0}`);
}

main().then(() => process.exit(0)).catch(e => { console.error(e); process.exit(1); });
