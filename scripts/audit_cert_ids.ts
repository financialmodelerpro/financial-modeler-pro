/**
 * scripts/audit_cert_ids.ts
 *
 * Read-only audit of `student_certificates.certificate_id` format.
 *
 * Background: `generateCertificateId(courseCode)` in
 * src/hubs/training/lib/certificates/certificateEngine.ts assigns
 * cert IDs as a per-course sequential counter. The intended format
 * mirrors the registration_id with the course code inserted, so a
 * student with `registration_id = FMP-2026-0016` should receive
 * `certificate_id = FMP-3SFM-2026-0016`, not whatever sequence number
 * the counter happens to be at when they pass the final exam.
 *
 * This audit walks every Issued cert, computes the expected ID from
 * the row's `registration_id`, and reports mismatches.
 *
 * Read-only. Issues no writes. Outputs:
 *   - human-readable summary to stdout
 *   - structured JSON to supabase/backups/cert_id_audit_<date>.json
 *
 * Usage:
 *   npx tsx --env-file=.env.local scripts/audit_cert_ids.ts
 *
 * Required env: SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY.
 */

import { promises as fs } from 'fs';
import path from 'path';
import { getServerClient } from '../src/core/db/supabase';

const BACKUP_DIR = path.join(process.cwd(), 'supabase', 'backups');
const OUT_FILE = path.join(BACKUP_DIR, `cert_id_audit_${new Date().toISOString().split('T')[0]}.json`);

// Reg ID format: FMP-YYYY-NNNN. Validator mirrors regIdAllocator.ts.
const REG_ID_RE = /^FMP-(\d{4})-(\d{4})$/;

interface CertRow {
  certificate_id:  string | null;
  registration_id: string | null;
  email:           string | null;
  full_name:       string | null;
  course_code:     string | null;
  course:          string | null;
  cert_status:     string | null;
  issued_at:       string | null;
  issued_via:      string | null;
  verification_url:string | null;
}

interface AuditResult {
  certificate_id:    string;
  registration_id:   string;
  email:             string;
  full_name:         string;
  course_code:       string;
  course:            string | null;
  issued_at:         string | null;
  issued_via:        string | null;
  expected_cert_id:  string | null;
  mismatch:          boolean;
  reason:            'match' | 'mismatch' | 'unparseable_reg_id' | 'missing_course_code' | 'missing_reg_id';
}

function deriveExpectedCertId(courseCode: string | null, registrationId: string | null): {
  expected: string | null;
  reason: AuditResult['reason'];
} {
  if (!registrationId) return { expected: null, reason: 'missing_reg_id' };
  if (!courseCode)     return { expected: null, reason: 'missing_course_code' };

  const m = REG_ID_RE.exec(registrationId.trim().toUpperCase());
  if (!m) return { expected: null, reason: 'unparseable_reg_id' };

  const code = courseCode.toUpperCase().replace(/[^A-Z0-9]/g, '');
  const [, year, seq] = m;
  return { expected: `FMP-${code}-${year}-${seq}`, reason: 'match' };
}

async function main() {
  await fs.mkdir(BACKUP_DIR, { recursive: true });
  const sb = getServerClient();

  console.log('Auditing student_certificates.certificate_id format...\n');

  const { data, error } = await sb
    .from('student_certificates')
    .select(
      'certificate_id, registration_id, email, full_name, course_code, course, cert_status, issued_at, issued_via, verification_url',
    )
    .eq('cert_status', 'Issued')
    .order('issued_at', { ascending: true });

  if (error) {
    console.error('SELECT failed:', error);
    process.exit(1);
  }

  const rows: CertRow[] = (data ?? []) as CertRow[];
  if (rows.length === 0) {
    console.log('No Issued certs found. Audit complete.');
    return;
  }

  const results: AuditResult[] = rows.map((r) => {
    const certId = r.certificate_id ?? '';
    const regId  = r.registration_id ?? '';
    const { expected, reason } = deriveExpectedCertId(r.course_code, r.registration_id);

    let auditReason: AuditResult['reason'];
    let mismatch = false;
    if (reason !== 'match') {
      auditReason = reason;
      mismatch = false; // edge case; flag separately, not a true format mismatch
    } else if (expected && certId !== expected) {
      auditReason = 'mismatch';
      mismatch = true;
    } else {
      auditReason = 'match';
      mismatch = false;
    }

    return {
      certificate_id:   certId,
      registration_id:  regId,
      email:            (r.email ?? '').toLowerCase(),
      full_name:        r.full_name ?? '',
      course_code:      r.course_code ?? '',
      course:           r.course,
      issued_at:        r.issued_at,
      issued_via:       r.issued_via,
      expected_cert_id: expected,
      mismatch,
      reason:           auditReason,
    };
  });

  const total       = results.length;
  const matches     = results.filter((r) => r.reason === 'match').length;
  const mismatches  = results.filter((r) => r.mismatch).length;
  const edgeCases   = results.filter((r) => r.reason !== 'match' && r.reason !== 'mismatch');

  // ── Per-course breakdown ────────────────────────────────────────────────
  const byCourse: Record<string, { total: number; mismatches: AuditResult[] }> = {};
  for (const r of results) {
    const code = r.course_code || '(none)';
    if (!byCourse[code]) byCourse[code] = { total: 0, mismatches: [] };
    byCourse[code].total++;
    if (r.mismatch) byCourse[code].mismatches.push(r);
  }

  // ── Console summary ─────────────────────────────────────────────────────
  console.log('=== TOTALS ===');
  console.log(`  Total Issued certs:           ${String(total).padStart(4)}`);
  console.log(`  Format-correct (match):       ${String(matches).padStart(4)}`);
  console.log(`  Format-incorrect (mismatch):  ${String(mismatches).padStart(4)}`);
  console.log(`  Edge cases (skip):            ${String(edgeCases.length).padStart(4)}\n`);

  console.log('=== BY COURSE ===');
  for (const code of Object.keys(byCourse).sort()) {
    const b = byCourse[code];
    console.log(`  ${code.padEnd(8)}  total=${String(b.total).padStart(3)}   mismatches=${String(b.mismatches.length).padStart(3)}`);
  }
  console.log('');

  if (mismatches > 0) {
    console.log('=== MISMATCHES (current -> expected) ===');
    for (const r of results.filter((x) => x.mismatch)) {
      console.log(
        `  ${r.registration_id.padEnd(15)}  ${r.email.padEnd(35)}  ${r.course_code.padEnd(5)}  ` +
        `${r.certificate_id.padEnd(22)}  ->  ${r.expected_cert_id}`,
      );
    }
    console.log('');
  }

  if (edgeCases.length > 0) {
    console.log('=== EDGE CASES (excluded from mismatch count) ===');
    for (const r of edgeCases) {
      console.log(
        `  ${(r.registration_id || '(null)').padEnd(15)}  ${r.email.padEnd(35)}  ${r.course_code.padEnd(5)}  ` +
        `${r.certificate_id.padEnd(22)}  reason=${r.reason}`,
      );
    }
    console.log('');
  }

  // ── JSON dump ───────────────────────────────────────────────────────────
  const dump = {
    generated_at: new Date().toISOString(),
    summary: {
      total_issued: total,
      matches,
      mismatches,
      edge_cases: edgeCases.length,
      by_course: Object.fromEntries(
        Object.entries(byCourse).map(([code, b]) => [
          code,
          { total: b.total, mismatches: b.mismatches.length },
        ]),
      ),
    },
    rows: results,
  };

  await fs.writeFile(OUT_FILE, JSON.stringify(dump, null, 2));
  console.log(`Wrote audit dump to: ${OUT_FILE}`);
}

main().catch((e) => {
  console.error('Audit failed:', e);
  process.exit(1);
});
