import { NextRequest, NextResponse } from 'next/server';
import { getServerClient } from '@/src/lib/shared/supabase';

/**
 * GET /api/training/certificate-image
 * Returns internal certificate data from student_certificates table.
 * Accepts: ?email=...  OR  ?certId=...
 * Legacy ?uuid= param still handled (looked up by certifier_uuid).
 */
export async function GET(req: NextRequest) {
  const email  = req.nextUrl.searchParams.get('email');
  const certId = req.nextUrl.searchParams.get('certId');
  const uuid   = req.nextUrl.searchParams.get('uuid'); // legacy

  if (!email && !certId && !uuid) {
    return NextResponse.json({ cert: null }, { status: 400 });
  }

  const sb = getServerClient();
  let query = sb.from('student_certificates').select(
    'certificate_id, cert_pdf_url, badge_url, transcript_url, verification_url, grade, issued_at, cert_status, course'
  );

  if (certId) {
    query = query.eq('certificate_id', certId) as typeof query;
  } else if (email) {
    query = query.eq('email', email.toLowerCase()) as typeof query;
  } else if (uuid) {
    query = query.eq('certifier_uuid', uuid) as typeof query;
  }

  const { data } = await query.order('issued_at', { ascending: false }).limit(1).maybeSingle();

  if (!data) {
    return NextResponse.json({ cert: null }, { status: 200 });
  }

  return NextResponse.json(
    { cert: data },
    { status: 200, headers: { 'Cache-Control': 'private, max-age=60' } },
  );
}
