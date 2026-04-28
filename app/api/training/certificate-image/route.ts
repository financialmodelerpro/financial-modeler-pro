import { NextRequest, NextResponse } from 'next/server';
import { getServerClient } from '@/src/core/db/supabase';

/**
 * GET /api/training/certificate-image
 * Returns internal certificate data from student_certificates table.
 * Accepts: ?email=...  OR  ?certId=...
 * Legacy ?uuid= param still handled (looked up by certifier_uuid).
 */
export async function GET(req: NextRequest) {
  const email      = req.nextUrl.searchParams.get('email');
  const certId     = req.nextUrl.searchParams.get('certId');
  const courseCode = req.nextUrl.searchParams.get('courseCode'); // narrows email lookups
  const uuid       = req.nextUrl.searchParams.get('uuid'); // legacy

  if (!email && !certId && !uuid) {
    return NextResponse.json({ cert: null }, { status: 400 });
  }

  const sb = getServerClient();
  let query = sb.from('student_certificates').select(
    'certificate_id, cert_pdf_url, badge_url, transcript_url, verification_url, grade, issued_at, cert_status, course, course_code'
  );

  if (certId) {
    // certId is globally unique, so no further narrowing required.
    query = query.eq('certificate_id', certId) as typeof query;
  } else if (email) {
    query = query.eq('email', email.toLowerCase()) as typeof query;
    // Previously the email path returned the newest cert for that email
    // via order-by-issued-at + limit(1), which meant a student with
    // both 3SFM + BVM certs saw BVM on every card regardless of which
    // cert was rendered. Accepting an optional courseCode scopes the
    // lookup so email-only callers can still get the right row.
    if (courseCode) {
      query = query.ilike('course_code', courseCode) as typeof query;
    }
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
