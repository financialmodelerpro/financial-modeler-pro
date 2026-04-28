/**
 * scripts/fix_cert_id_FMP-2026-0016.ts
 *
 * One-shot backfill for the single certificate that received a
 * mismatched ID under the pre-fix sequential-counter logic.
 *
 * Target: registration_id=FMP-2026-0016 (email ah157138@gmail.com),
 * course_code=3SFM. Current cert_id=FMP-3SFM-2026-0002. Expected
 * cert_id=FMP-3SFM-2026-0016.
 *
 * Steps:
 *   1. Read current student_certificates row.
 *   2. Snapshot the row to supabase/backups/cert_FMP-3SFM-2026-0002_backup.json.
 *   3. Regenerate the cert PDF + badge with the new ID via
 *      generateCertificatePdf / generateBadgePng (existing exports).
 *   4. Update the DB row: certificate_id, verification_url,
 *      cert_pdf_url, badge_url. Stamp issued_via=admin_override-style
 *      via a new admin_audit_log row (action='cert_id_format_correction').
 *   5. Old PDF/badge objects in storage are LEFT IN PLACE (orphaned).
 *      Note: storage paths use the cert ID as the filename, so the
 *      regenerated objects upload to NEW paths
 *      (issued/FMP-3SFM-2026-0016.pdf, issued/FMP-3SFM-2026-0016-badge.png).
 *      The old objects (issued/FMP-3SFM-2026-0002.pdf,
 *      issued/FMP-3SFM-2026-0002-badge.png) remain in the bucket as
 *      orphaned data; cleanup is deferred until the rollback window
 *      is closed.
 *
 * Idempotent: if the cert_id is already FMP-3SFM-2026-0016 (i.e. the
 * script has already run successfully), exits early with a no-op log.
 *
 * NO STUDENT EMAIL is sent. Student dashboard and verify page render
 * dynamically from the DB row, so they reflect the new cert ID and
 * the new PDF/badge as soon as this script's writes commit.
 *
 * NO REDIRECT for the old verify URL is configured. The old URL
 * (/verify/FMP-3SFM-2026-0002) becomes 404; this is acceptable
 * because the student dashboard download surfaces the new PDF and
 * the new QR encodes the new URL.
 *
 * Usage:
 *   npx tsx --env-file=.env.local scripts/fix_cert_id_FMP-2026-0016.ts
 *
 * Required env: SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY,
 *   NEXT_PUBLIC_LEARN_URL.
 */

import { promises as fs } from 'fs';
import path from 'path';
import { getServerClient } from '../src/core/db/supabase';
import {
  generateCertificatePdf,
  generateBadgePng,
} from '../src/hubs/training/lib/certificates/certificateEngine';

const TARGET_EMAIL    = 'ah157138@gmail.com';
const TARGET_REG_ID   = 'FMP-2026-0016';
const TARGET_COURSE   = '3SFM';
const OLD_CERT_ID     = 'FMP-3SFM-2026-0002';
const NEW_CERT_ID     = 'FMP-3SFM-2026-0016';

// Hard-coded production LEARN URL. The local .env.local sets
// NEXT_PUBLIC_LEARN_URL=http://localhost:3000 for dev convenience, which is
// fine for normal `next dev` work but wrong for a one-shot backfill that
// stamps a permanent verification_url + embeds a QR code into a PDF that
// students will share publicly. Hard-coding here avoids that footgun.
// Override with FORCE_LEARN_URL env if a non-prod cutover is needed.
const LEARN_URL = process.env.FORCE_LEARN_URL ?? 'https://learn.financialmodelerpro.com';

const BACKUP_DIR  = path.join(process.cwd(), 'supabase', 'backups');
const BACKUP_FILE = path.join(BACKUP_DIR, `cert_${OLD_CERT_ID}_backup.json`);

async function lookupAdminId(): Promise<{ id: string; email: string }> {
  const sb = getServerClient();
  const { data } = await sb
    .from('users')
    .select('id, email')
    .eq('role', 'admin')
    .order('created_at', { ascending: true })
    .limit(1)
    .maybeSingle();
  if (!data) {
    throw new Error('No admin user found. Cannot proceed without admin_id for audit log.');
  }
  return { id: String(data.id), email: String(data.email ?? '') };
}

async function main() {
  await fs.mkdir(BACKUP_DIR, { recursive: true });
  const sb = getServerClient();

  console.log(`Backfilling cert ID for ${TARGET_REG_ID} / ${TARGET_COURSE}...\n`);

  const admin = await lookupAdminId();
  console.log(`Admin user: ${admin.email}  (id=${admin.id.slice(0, 8)}...)\n`);

  // 1. Read current row.
  const { data: row, error: selErr } = await sb
    .from('student_certificates')
    .select('*')
    .ilike('email', TARGET_EMAIL)
    .eq('course_code', TARGET_COURSE)
    .maybeSingle();

  if (selErr || !row) {
    throw new Error(`Cert row not found for ${TARGET_EMAIL} / ${TARGET_COURSE}: ${selErr?.message ?? 'no row'}`);
  }

  const expectedVerifyUrl = `${LEARN_URL}/verify/${NEW_CERT_ID}`;

  // Idempotency: already-fixed row with correct verify URL is a no-op.
  // If the ID is right but the URL is wrong (e.g. an earlier run used a
  // localhost env), continue so we re-render the PDF + badge with the
  // production URL embedded in the QR code.
  if (row.certificate_id === NEW_CERT_ID && row.verification_url === expectedVerifyUrl) {
    console.log(`Cert already has new ID ${NEW_CERT_ID} and correct verify URL. No-op.`);
    return;
  }

  if (row.certificate_id !== OLD_CERT_ID && row.certificate_id !== NEW_CERT_ID) {
    throw new Error(
      `Sanity check failed: expected current cert_id=${OLD_CERT_ID} or ${NEW_CERT_ID}, found ${row.certificate_id}. Aborting.`,
    );
  }

  // 2. Snapshot the row to backups/.
  await fs.writeFile(BACKUP_FILE, JSON.stringify(row, null, 2));
  console.log(`Snapshot: ${BACKUP_FILE}`);

  // 3. Regenerate PDF + badge with new ID.
  const verificationUrl = `${LEARN_URL}/verify/${NEW_CERT_ID}`;
  const issueDate       = String(row.issued_at ?? new Date().toISOString());
  const grade           = String(row.grade ?? 'Pass');
  const studentName     = String(row.full_name ?? '');
  const courseCode      = String(row.course_code ?? TARGET_COURSE);

  console.log('Regenerating PDF...');
  const newCertPdfUrl = await generateCertificatePdf({
    certificateId: NEW_CERT_ID,
    studentName,
    issueDate,
    grade,
    verificationUrl,
    courseCode,
  });
  console.log(`  ${newCertPdfUrl}`);

  console.log('Regenerating badge...');
  const newBadgeUrl = await generateBadgePng({
    certificateId: NEW_CERT_ID,
    issueDate,
    courseCode,
  });
  console.log(`  ${newBadgeUrl || '(no badge template; skipped)'}`);

  // 4. Update the DB row.
  const updates: Record<string, unknown> = {
    certificate_id:   NEW_CERT_ID,
    verification_url: verificationUrl,
    cert_pdf_url:     newCertPdfUrl,
  };
  if (newBadgeUrl) updates.badge_url = newBadgeUrl;

  console.log('Updating student_certificates row...');
  const { error: updErr } = await sb
    .from('student_certificates')
    .update(updates)
    .eq('id', row.id);
  if (updErr) {
    throw new Error(`DB update failed: ${updErr.message}`);
  }

  // 5. Audit trail.
  const before = {
    certificate_id:   row.certificate_id,
    verification_url: row.verification_url,
    cert_pdf_url:     row.cert_pdf_url,
    badge_url:        row.badge_url,
  };
  const after = {
    certificate_id:   NEW_CERT_ID,
    verification_url: verificationUrl,
    cert_pdf_url:     newCertPdfUrl,
    badge_url:        newBadgeUrl || row.badge_url,
  };

  const { error: auditErr } = await sb.from('admin_audit_log').insert({
    admin_id:    admin.id,
    action:      'cert_id_format_correction',
    before_value: before,
    after_value: {
      ...after,
      student_email:   TARGET_EMAIL,
      registration_id: TARGET_REG_ID,
      course_code:     TARGET_COURSE,
      orphaned_storage_objects: [
        `certificates/issued/${OLD_CERT_ID}.pdf`,
        `badges/issued/${OLD_CERT_ID}-badge.png`,
      ],
      via: 'fix_cert_id_FMP-2026-0016_script',
    },
    reason: 'Restoring registration-mirrored cert ID format. The pre-fix `generateCertificateId` used a per-course sequential counter that decoupled cert-ID order from registration order. New derivation: deriveCertificateId(courseCode, registrationId) -> FMP-{COURSE}-{YEAR}-{SEQ} parsed from reg ID.',
  });
  if (auditErr) {
    console.warn(`audit insert failed: ${auditErr.message}`);
  } else {
    console.log('Audit log row written (action=cert_id_format_correction).');
  }

  console.log(`\nDone.`);
  console.log(`  ${OLD_CERT_ID}  ->  ${NEW_CERT_ID}`);
  console.log(`  Old verify URL (now 404): ${LEARN_URL}/verify/${OLD_CERT_ID}`);
  console.log(`  New verify URL:            ${verificationUrl}`);
  console.log(`  Orphaned in storage (kept for rollback safety):`);
  console.log(`    certificates/issued/${OLD_CERT_ID}.pdf`);
  console.log(`    badges/issued/${OLD_CERT_ID}-badge.png`);
}

main().catch((e) => {
  console.error('Backfill failed:', e);
  process.exit(1);
});
