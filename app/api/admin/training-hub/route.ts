import { NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/src/lib/shared/auth';
import { getStudentRoster } from '@/src/lib/training/studentRoster';
import { getServerClient } from '@/src/lib/shared/supabase';

export const revalidate = 0;

export async function GET() {
  const session = await getServerSession(authOptions);
  if (!session?.user || (session.user as { role?: string }).role !== 'admin') {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }

  const sb = getServerClient();
  const [allStudents, certsRes] = await Promise.all([
    getStudentRoster(),
    sb.from('student_certificates')
      .select('certificate_id, course_code, cert_status, email, issued_at')
      .eq('cert_status', 'Issued'),
  ]);

  interface CertRow { certificate_id: string; course_code: string; email: string; issued_at: string | null }
  const allCerts = (certsRes.data ?? []) as CertRow[];
  const dataAvailable = true;

  // "course" on StudentSummary is now a comma-joined list of enrolled
  // course codes - ADaptt the legacy single-string filter into membership.
  const sfmStudents = allStudents.filter(s => s.course.split(',').map(c => c.trim()).includes('3SFM'));
  const bvmStudents = allStudents.filter(s => s.course.split(',').map(c => c.trim()).includes('BVM'));
  const sfmCerts    = allCerts.filter(c => (c.course_code ?? '').toUpperCase() === '3SFM');
  const bvmCerts    = allCerts.filter(c => (c.course_code ?? '').toUpperCase() === 'BVM');

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
    appsScriptConfigured: true,
  });
}
