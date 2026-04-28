/**
 * scripts/backup_apps_script_students.ts
 *
 * Pre-migration backup + backfill from the Apps Script Google Sheet into
 * Supabase. Run ONCE before flipping registration/progress/admin routes to
 * the Supabase-native code paths.
 *
 * What it does:
 *   1. Calls listAllStudents() via the existing sheets.ts helper
 *   2. Calls getAllCertificates() so we have a frozen cert snapshot
 *   3. Writes both raw responses to supabase/backups/ as date-stamped JSON
 *      (version-controlled audit trail - "this was the state the day we
 *      cut over").
 *   4. Upserts each student into Supabase:
 *        - training_registrations_meta: sets `name` if blank. Other
 *          identity columns (email, registration_id, phone, city, country,
 *          email_confirmed, confirmed_at) are left alone because migration
 *          128 + 129 already created rows for the students we've seen.
 *        - training_enrollments: one row per course the student is in.
 *          Parses "3SFM", "BVM", "Both", "3SFM,BVM", "3SFM + BVM", etc.
 *          ON CONFLICT DO NOTHING so re-runs are idempotent.
 *   5. Reports a summary of what changed.
 *
 * Repeatable and idempotent. Safe to run multiple times.
 *
 * Requires .env.local with:
 *   APPS_SCRIPT_URL (or training_settings.apps_script_url row seeded)
 *   SUPABASE_URL
 *   SUPABASE_SERVICE_ROLE_KEY
 *
 * Usage:
 *   npx tsx --env-file=.env.local scripts/backup_apps_script_students.ts
 *
 * Env loading uses Node/tsx's native --env-file flag so no `dotenv`
 * package is required. Node 20.6+ / tsx 4.8+.
 */

import { promises as fs } from 'fs';
import path from 'path';
import { listAllStudents, getAllCertificates, type StudentSummary, type CertRow } from '../src/hubs/training/lib/appsScript/sheets';
import { getServerClient } from '../src/core/db/supabase';

const BACKUP_DIR = path.join(process.cwd(), 'supabase', 'backups');

function today(): string {
  return new Date().toISOString().split('T')[0];
}

/**
 * Parse the Apps Script `course` field into the canonical set of course
 * codes. Accepts mixed separators + casing.
 */
function parseCourses(courseField: string): string[] {
  if (!courseField) return [];
  const raw = courseField.toUpperCase();
  if (raw === 'BOTH' || raw.includes('3SFM') && raw.includes('BVM')) {
    return ['3SFM', 'BVM'];
  }
  const out: string[] = [];
  if (raw.includes('3SFM')) out.push('3SFM');
  if (raw.includes('BVM'))  out.push('BVM');
  return out;
}

async function writeBackup(fileName: string, payload: unknown): Promise<string> {
  await fs.mkdir(BACKUP_DIR, { recursive: true });
  const full = path.join(BACKUP_DIR, fileName);
  await fs.writeFile(full, JSON.stringify(payload, null, 2), 'utf8');
  return full;
}

async function main() {
  console.log('[backup] Starting Apps Script student roster + certificate snapshot');

  // ── Snapshot students from Apps Script ─────────────────────────────────────
  const studentsRes = await listAllStudents();
  if (!studentsRes.success) {
    console.error('[backup] listAllStudents failed:', studentsRes.error);
    process.exit(1);
  }
  const students: StudentSummary[] = studentsRes.data ?? [];
  console.log(`[backup] Got ${students.length} students from Apps Script`);

  const studentsPath = await writeBackup(`apps_script_students_${today()}.json`, students);
  console.log(`[backup] Wrote students snapshot: ${studentsPath}`);

  // ── Snapshot certificates ─────────────────────────────────────────────────
  const certsRes = await getAllCertificates();
  const certs: CertRow[] = certsRes.data ?? [];
  const certsPath = await writeBackup(`apps_script_certificates_${today()}.json`, certs);
  console.log(`[backup] Wrote certificates snapshot: ${certsPath} (${certs.length} rows)`);

  // ── Backfill Supabase ─────────────────────────────────────────────────────
  const sb = getServerClient();

  let nameUpdates = 0;
  let nameSkipped = 0;
  let enrollmentsInserted = 0;
  let enrollmentsSkipped = 0;
  const failures: Array<{ regId: string; step: string; error: string }> = [];

  for (const s of students) {
    const regId = s.registrationId;
    if (!regId) {
      failures.push({ regId: '', step: 'skip_no_regid', error: 'No registration_id in Apps Script row' });
      continue;
    }

    // Confirm the meta row exists; if not, we can't safely backfill since
    // migration 128's backfill only covered known RegIDs. Log and skip.
    const { data: meta } = await sb
      .from('training_registrations_meta')
      .select('registration_id, name')
      .eq('registration_id', regId)
      .maybeSingle();

    if (!meta) {
      failures.push({ regId, step: 'meta_missing', error: `No meta row for ${regId}; run migration 128 or add manually` });
      continue;
    }

    // 1. Fill name if blank. Don't overwrite an existing non-blank name.
    if (!meta.name && s.name) {
      const { error } = await sb
        .from('training_registrations_meta')
        .update({ name: s.name })
        .eq('registration_id', regId);
      if (error) {
        failures.push({ regId, step: 'name_update', error: error.message });
      } else {
        nameUpdates++;
      }
    } else {
      nameSkipped++;
    }

    // 2. Insert enrollment rows. ON CONFLICT DO NOTHING via pre-check.
    const courses = parseCourses(s.course);
    if (courses.length === 0) {
      console.warn(`[backup] ${regId}: no parseable course from "${s.course}"; skipping enrollment`);
    }
    for (const courseCode of courses) {
      const { data: existing } = await sb
        .from('training_enrollments')
        .select('id')
        .eq('registration_id', regId)
        .eq('course_code', courseCode)
        .maybeSingle();
      if (existing) {
        enrollmentsSkipped++;
        continue;
      }
      const { error } = await sb
        .from('training_enrollments')
        .insert({
          registration_id: regId,
          course_code:     courseCode,
          enrolled_at:     s.registeredAt ? new Date(s.registeredAt).toISOString() : new Date().toISOString(),
        });
      if (error) {
        failures.push({ regId, step: `enroll_${courseCode}`, error: error.message });
      } else {
        enrollmentsInserted++;
      }
    }
  }

  console.log('[backup] Summary:', {
    total_students:      students.length,
    names_updated:       nameUpdates,
    names_already_set:   nameSkipped,
    enrollments_added:   enrollmentsInserted,
    enrollments_existed: enrollmentsSkipped,
    failures:            failures.length,
  });
  if (failures.length > 0) {
    console.warn('[backup] Failures:', failures);
    process.exit(1);
  }

  console.log('[backup] Done. Snapshots committed under supabase/backups/.');
}

main().catch(err => {
  console.error('[backup] Fatal error:', err);
  process.exit(1);
});
