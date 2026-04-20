import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/src/lib/shared/auth';
import { getServerClient } from '@/src/lib/shared/supabase';
import { sendEmail, FROM } from '@/src/lib/email/sendEmail';
import { certificateIssuedTemplate } from '@/src/lib/email/templates/certificateIssued';

export const dynamic = 'force-dynamic';

/**
 * POST /api/admin/certificates/resend-email
 *
 * Resends the certificate issuance email for a row whose `email_sent_at` is
 * null (the safety-net "Resend Email" button). On success the timestamp is
 * stamped so the button disappears from the list without a manual refresh.
 */
export async function POST(req: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session?.user || (session.user as { role?: string }).role !== 'admin') {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  try {
    const body = await req.json() as { certificateId?: string };
    const certificateId = (body.certificateId ?? '').trim();
    if (!certificateId) {
      return NextResponse.json({ error: 'certificateId required' }, { status: 400 });
    }

    const sb = getServerClient();
    const { data: cert, error: certErr } = await sb
      .from('student_certificates')
      .select('certificate_id, full_name, email, course, cert_pdf_url, badge_url, verification_url, grade')
      .eq('certificate_id', certificateId)
      .maybeSingle();

    if (certErr || !cert) {
      return NextResponse.json({ error: `Certificate not found: ${certificateId}` }, { status: 404 });
    }

    const { subject, html } = await certificateIssuedTemplate({
      studentName:     (cert.full_name as string) ?? '',
      courseName:      (cert.course as string) ?? '',
      certPdfUrl:      (cert.cert_pdf_url as string) ?? '',
      badgeUrl:        (cert.badge_url as string) ?? '',
      verificationUrl: (cert.verification_url as string) ?? '',
      certificateId:   cert.certificate_id as string,
      grade:           (cert.grade as string) ?? '',
    });
    await sendEmail({ to: cert.email as string, subject, html, from: FROM.training });

    const sentAt = new Date().toISOString();
    await sb
      .from('student_certificates')
      .update({ email_sent_at: sentAt })
      .eq('certificate_id', certificateId);

    return NextResponse.json({ success: true, email_sent_at: sentAt });
  } catch (e) {
    return NextResponse.json({ error: String(e) }, { status: 500 });
  }
}
