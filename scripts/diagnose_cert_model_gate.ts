/**
 * scripts/diagnose_cert_model_gate.ts
 *
 * READ-ONLY. Answers: does a REJECTED model submission actually block
 * certificate issuance today?
 *
 * The gate in certificateEngine.issueCertificateForPending is:
 *     if (modelStatus.required && !modelStatus.hasApproved) -> hold
 * so it is entirely conditional on the per-course training_settings flag
 * `model_submission_required_<course>`. This prints that flag's live value,
 * then cross-references every student's model-submission state against their
 * issued certificate.
 *
 * SELECTs only. Nothing written.
 *
 * Usage: npx tsx --env-file=.env.local scripts/diagnose_cert_model_gate.ts
 */

import { getServerClient } from '../src/core/db/supabase';

async function main() {
  const sb = getServerClient();

  // ── 1. The flags the gate depends on ──────────────────────────────────────
  const keys = [
    'model_submission_required_3sfm',
    'model_submission_required_bvm',
    'model_submission_announcement_only',
    'model_submission_max_attempts',
  ];
  const { data: settings, error: sErr } = await sb
    .from('training_settings').select('key, value').in('key', keys);
  if (sErr) { console.error('settings read failed:', sErr.message); process.exit(1); }
  const map = new Map((settings ?? []).map((r: { key: string; value: string }) => [r.key, r.value]));

  console.log('=== training_settings: the gate flags ===');
  for (const k of keys) {
    const v = map.get(k);
    console.log(`  ${k.padEnd(38)} ${v === undefined ? '(NOT SET)' : `"${v}"`}`);
  }
  const req3 = map.get('model_submission_required_3sfm') === 'true';
  const reqB = map.get('model_submission_required_bvm') === 'true';
  console.log(`\n  gate ACTIVE for 3SFM : ${req3}`);
  console.log(`  gate ACTIVE for BVM  : ${reqB}`);
  if (!req3 && !reqB) {
    console.log('  => required=false for both, so `required && !hasApproved` is FALSE');
    console.log('     and issueCertificateForPending never holds on model state.');
  }

  // ── 2. Model submissions by status ────────────────────────────────────────
  const { data: subs, error: mErr } = await sb
    .from('model_submissions')
    .select('email, course_code, status, submitted_at, reviewed_at')
    .order('submitted_at', { ascending: false });
  if (mErr) { console.error('model_submissions read failed:', mErr.message); }
  const all = (subs ?? []) as { email: string; course_code: string; status: string; submitted_at: string }[];
  const byStatus = new Map<string, number>();
  for (const r of all) byStatus.set(r.status, (byStatus.get(r.status) ?? 0) + 1);
  console.log(`\n=== model_submissions: ${all.length} row(s) ===`);
  for (const [s, n] of byStatus) console.log(`  ${s.padEnd(12)} ${n}`);

  // Latest + hasApproved per (email, course), mirroring getModelSubmissionStatus.
  const latest = new Map<string, { status: string; hasApproved: boolean; attempts: number }>();
  for (const r of all) {
    const key = `${r.email.toLowerCase()}|${r.course_code.toUpperCase()}`;
    const cur = latest.get(key);
    if (!cur) latest.set(key, { status: r.status, hasApproved: r.status === 'approved', attempts: 1 });
    else latest.set(key, { status: cur.status, hasApproved: cur.hasApproved || r.status === 'approved', attempts: cur.attempts + 1 });
  }

  // ── 3. Issued certificates vs model state ────────────────────────────────
  const { data: certs, error: cErr } = await sb
    .from('student_certificates')
    .select('email, course_code, cert_status, issued_via, issued_at, certificate_id, full_name');
  if (cErr) { console.error('student_certificates read failed:', cErr.message); }
  const issued = (certs ?? []) as { email: string; course_code: string; cert_status: string; issued_via: string | null; issued_at: string | null; certificate_id: string; full_name: string }[];

  console.log(`\n=== student_certificates: ${issued.length} row(s) ===`);
  let conflict = 0;
  for (const c of issued) {
    const key = `${c.email.toLowerCase()}|${c.course_code.toUpperCase()}`;
    const m = latest.get(key);
    const modelDesc = m ? `latest=${m.status} hasApproved=${m.hasApproved} attempts=${m.attempts}` : 'NO model submission';
    const bad = !!m && !m.hasApproved;   // cert exists while never approved
    if (bad) conflict++;
    console.log(`  ${bad ? '[!]' : '   '} ${String(c.full_name).padEnd(22)} ${c.course_code.padEnd(5)} cert=${c.cert_status} via=${c.issued_via ?? '-'}  model: ${modelDesc}`);
  }
  console.log(`\n  certificates issued to students with NO approved model: ${conflict}`);

  // ── 4. Students with a rejected-and-never-approved model ─────────────────
  console.log('\n=== students whose model is rejected / pending and never approved ===');
  let n = 0;
  for (const [key, m] of latest) {
    if (m.hasApproved) continue;
    const [email, course] = key.split('|');
    const hasCert = issued.some(c => c.email.toLowerCase() === email && c.course_code.toUpperCase() === course && c.cert_status === 'Issued');
    n++;
    console.log(`  ${email.padEnd(34)} ${course.padEnd(5)} latest=${m.status.padEnd(10)} certificate=${hasCert ? 'ISSUED  <-- would be blocked only if the flag were on' : 'none'}`);
  }
  if (n === 0) console.log('  (none)');
}

main().catch((e) => { console.error('FATAL', e); process.exit(1); });
