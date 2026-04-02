import { NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/src/lib/auth';
import { getAllCertificates, type CertRow } from '@/src/lib/sheets';
import { getServerClient } from '@/src/lib/supabase';

export const revalidate = 0;

function extractUuid(row: CertRow): string {
  // Try certifierUuid field first
  if (row.certifierUuid && row.certifierUuid !== 'mock-cert-uuid-dev-001') {
    return row.certifierUuid;
  }
  // Extract last segment from certificateUrl
  if (row.certificateUrl) {
    const parts = row.certificateUrl.replace(/\/$/, '').split('/');
    const last = parts[parts.length - 1];
    if (last && last.length > 4) return last;
  }
  return row.certifierUuid ?? '';
}

// POST — sync from Apps Script → Supabase
export async function POST() {
  const session = await getServerSession(authOptions);
  if (!session?.user || (session.user as { role?: string }).role !== 'admin') {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }

  const certsRes = await getAllCertificates();
  if (!certsRes.success) {
    return NextResponse.json({ error: 'Failed to fetch certificates from Apps Script' }, { status: 500 });
  }

  const rows = certsRes.data ?? [];
  const sb = getServerClient();

  let synced = 0;
  let skipped = 0;

  for (const row of rows) {
    const uuid = extractUuid(row);
    const isMock = uuid === 'mock-cert-uuid-dev-001' ||
                   (row.certificateUrl ?? '').includes('mock');

    // Skip rows that aren't Issued (unless mock for dev)
    if (row.certStatus !== 'Issued' && !isMock) {
      skipped++;
      continue;
    }
    // Skip rows with no UUID
    if (!uuid) {
      skipped++;
      continue;
    }

    const { error } = await sb
      .from('student_certificates')
      .upsert(
        {
          certifier_uuid:    uuid,
          registration_id:   row.registrationId,
          full_name:         row.fullName,
          email:             row.email,
          course:            row.course,
          completion_date:   row.completionDate || null,
          final_exam_score:  row.finalExamScore || null,
          avg_session_score: row.avgSessionScore || null,
          cert_status:       row.certStatus,
          certificate_url:   row.certificateUrl || null,
          issued_date:       row.issuedDate || null,
          synced_at:         new Date().toISOString(),
        },
        { onConflict: 'certifier_uuid' },
      );

    if (error) {
      console.error('[cert-sync] upsert error', error);
      skipped++;
    } else {
      synced++;
    }
  }

  // Update last-synced timestamp
  await sb
    .from('training_settings')
    .upsert({ key: 'cert_last_synced', value: new Date().toISOString() }, { onConflict: 'key' });

  return NextResponse.json({ ok: true, synced, skipped });
}

// GET — return list of certificates from Supabase
export async function GET() {
  const session = await getServerSession(authOptions);
  if (!session?.user || (session.user as { role?: string }).role !== 'admin') {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }

  const sb = getServerClient();

  const [certsRes, settingRes] = await Promise.all([
    sb.from('student_certificates').select('*').order('issued_date', { ascending: false }),
    sb.from('training_settings').select('value').eq('key', 'cert_last_synced').single(),
  ]);

  return NextResponse.json({
    certs: certsRes.data ?? [],
    lastSynced: settingRes.data?.value ?? null,
  });
}
