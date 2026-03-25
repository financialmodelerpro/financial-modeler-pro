import { NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/src/lib/auth';
import { listAllCertificates } from '@/src/lib/sheets';
import { getServerClient } from '@/src/lib/supabase';

export const revalidate = 0;

export async function GET() {
  const session = await getServerSession(authOptions);
  if (!session?.user || (session.user as any).role !== 'admin') {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }

  const [certsRes, sb] = [await listAllCertificates(), getServerClient()];

  const { data: revocations } = await sb
    .from('training_admin_actions')
    .select('id, registration_id, course')
    .eq('action_type', 'revoke_certificate')
    .eq('is_active', true);

  // Key: `${registrationId}::${course}`
  const revokeMap = new Map(
    (revocations ?? []).map(r => [`${r.registration_id}::${r.course ?? ''}`, r.id as string]),
  );

  const allCerts = certsRes.data ?? [];
  const certificates = allCerts.map(c => {
    const key = `${(c as any).registrationId ?? ''}::${c.course}`;
    return {
      ...c,
      isRevoked:      revokeMap.has(key),
      revokeActionId: revokeMap.get(key) ?? null,
    };
  });

  const revoked = certificates.filter(c => c.isRevoked).length;

  return NextResponse.json({
    certificates,
    totalCerts:  allCerts.length,
    sfmCerts:    allCerts.filter(c => c.course === '3SFM').length,
    bvmCerts:    allCerts.filter(c => c.course === 'BVM').length,
    revokedCerts: revoked,
    dataAvailable: certsRes.success,
    appsScriptConfigured: certsRes.error !== 'APPS_SCRIPT_URL not configured',
    error: certsRes.success ? null : certsRes.error,
  });
}
