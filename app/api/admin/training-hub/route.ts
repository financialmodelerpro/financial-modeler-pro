import { NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/src/lib/shared/auth';
import { listAllStudents, listAllCertificates } from '@/src/lib/training/sheets';

export const revalidate = 0;

export async function GET() {
  const session = await getServerSession(authOptions);
  if (!session?.user || (session.user as any).role !== 'admin') {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }

  const [studentsRes, certsRes] = await Promise.all([
    listAllStudents(),
    listAllCertificates(),
  ]);

  const allStudents = studentsRes.data ?? [];
  const allCerts    = certsRes.data ?? [];
  const dataAvailable = studentsRes.success && studentsRes.error !== 'APPS_SCRIPT_URL not configured';

  const sfmStudents = allStudents.filter(s => s.course === '3SFM');
  const bvmStudents = allStudents.filter(s => s.course === 'BVM');
  const sfmCerts    = allCerts.filter(c => c.course === '3SFM');
  const bvmCerts    = allCerts.filter(c => c.course === 'BVM');

  // 3SFM stats
  const sfmWithFinal   = sfmStudents.filter(s => s.finalPassed !== undefined);
  const sfmFinalPassed = sfmStudents.filter(s => s.finalPassed).length;
  const sfmPassRate    = sfmWithFinal.length ? Math.round((sfmFinalPassed / sfmWithFinal.length) * 100) : null;

  // BVM stats
  const bvmWithFinal   = bvmStudents.filter(s => s.finalPassed !== undefined);
  const bvmFinalPassed = bvmStudents.filter(s => s.finalPassed).length;
  const bvmPassRate    = bvmWithFinal.length ? Math.round((bvmFinalPassed / bvmWithFinal.length) * 100) : null;

  // Recent 10 registrations
  const recentRegistrations = [...allStudents]
    .sort((a, b) => new Date(b.registeredAt || 0).getTime() - new Date(a.registeredAt || 0).getTime())
    .slice(0, 10);

  const n = (v: number) => dataAvailable ? v : null;

  return NextResponse.json({
    totalStudents:    n(allStudents.length),
    sfmEnrolled:      n(sfmStudents.length),
    bvmEnrolled:      n(bvmStudents.length),
    totalCertificates: n(allCerts.length),
    sfmCertificates:  n(sfmCerts.length),
    bvmCertificates:  n(bvmCerts.length),
    sfmFinalPassRate: dataAvailable ? sfmPassRate : null,
    bvmFinalPassRate: dataAvailable ? bvmPassRate : null,
    sfmCertsIssued:   n(sfmCerts.length),
    bvmCertsIssued:   n(bvmCerts.length),
    recentRegistrations,
    dataAvailable,
    appsScriptConfigured: studentsRes.error !== 'APPS_SCRIPT_URL not configured',
  });
}
