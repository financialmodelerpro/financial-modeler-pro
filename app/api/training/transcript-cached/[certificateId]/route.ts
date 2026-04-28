import { NextRequest, NextResponse } from 'next/server';
import { getServerClient } from '@/src/core/db/supabase';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

/**
 * GET /api/training/transcript-cached/[certificateId]
 *
 * Cached-first transcript access. First click generates the transcript PDF
 * via the existing `/api/training/transcript` pipeline (untouched — still the
 * single source of truth for layout + QR), uploads it to Supabase Storage,
 * saves the public URL on `student_certificates.transcript_url`, then
 * 302-redirects to the stored URL. Subsequent clicks short-circuit to the
 * cached URL without re-rendering the React-PDF tree.
 *
 * Verify page + dashboard cert card point students here so they never have
 * to regenerate. Backfills transcripts for existing certs on first access.
 */
export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ certificateId: string }> },
) {
  const { certificateId } = await params;
  if (!certificateId) {
    return NextResponse.json({ error: 'certificateId required' }, { status: 400 });
  }

  const sb = getServerClient();
  const { data: cert, error: certErr } = await sb
    .from('student_certificates')
    .select('certificate_id, registration_id, email, course, course_code, transcript_url, cert_status')
    .eq('certificate_id', certificateId)
    .maybeSingle();

  if (certErr) {
    console.error('[transcript-cached] cert lookup failed:', certErr);
    return NextResponse.json({ error: 'Lookup failed' }, { status: 500 });
  }
  if (!cert || cert.cert_status !== 'Issued') {
    return NextResponse.json({ error: 'Certificate not found' }, { status: 404 });
  }

  // Cache hit — short-circuit to stored URL.
  if (cert.transcript_url) {
    return NextResponse.redirect(cert.transcript_url, 302);
  }

  // Cache miss — generate once, upload, save URL, redirect.
  const course = (cert.course_code as string | null) ?? (cert.course as string | null) ?? '3SFM';
  const courseSlug = course.toLowerCase().includes('bvm') ? 'bvm' : '3sfm';

  const origin = req.nextUrl.origin;
  const genUrl = new URL(`${origin}/api/training/transcript`);
  genUrl.searchParams.set('regId', (cert.registration_id as string) ?? '');
  genUrl.searchParams.set('email', (cert.email as string) ?? '');
  genUrl.searchParams.set('course', courseSlug);

  let pdfBuffer: Buffer;
  try {
    const res = await fetch(genUrl.toString(), { cache: 'no-store' });
    if (!res.ok) {
      const body = await res.text().catch(() => '');
      console.error('[transcript-cached] generator returned', res.status, body.slice(0, 200));
      return NextResponse.json({ error: `Generator failed: ${res.status}` }, { status: 500 });
    }
    pdfBuffer = Buffer.from(await res.arrayBuffer());
  } catch (e) {
    console.error('[transcript-cached] generator fetch threw:', e);
    return NextResponse.json({ error: String(e) }, { status: 500 });
  }

  if (!pdfBuffer || pdfBuffer.length < 100) {
    return NextResponse.json({ error: 'Generated PDF is empty' }, { status: 500 });
  }

  const safeEmail = (cert.email as string).replace(/[^a-zA-Z0-9@._-]/g, '_');
  const path = `transcripts/${safeEmail}/${certificateId}.pdf`;

  const { error: upErr } = await sb.storage
    .from('certificates')
    .upload(path, pdfBuffer, { contentType: 'application/pdf', upsert: true });
  if (upErr) {
    console.error('[transcript-cached] storage upload failed:', upErr);
    return NextResponse.json({ error: `Upload failed: ${upErr.message}` }, { status: 500 });
  }

  const { data: { publicUrl } } = sb.storage.from('certificates').getPublicUrl(path);

  const { error: updErr } = await sb
    .from('student_certificates')
    .update({ transcript_url: publicUrl })
    .eq('certificate_id', certificateId);
  if (updErr) {
    console.warn('[transcript-cached] save URL failed (still serving PDF):', updErr);
  } else {
    console.log('[transcript-cached] cached transcript for', certificateId, '→', path);
  }

  return NextResponse.redirect(publicUrl, 302);
}
