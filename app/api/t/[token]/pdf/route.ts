import { NextRequest, NextResponse } from 'next/server';
import { getServerClient } from '@/src/lib/supabase';

/**
 * GET /api/t/[token]/pdf
 * Public endpoint — validates the share token then proxies to the transcript PDF generator.
 */
export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ token: string }> },
) {
  const { token } = await params;

  try {
    const sb = getServerClient();
    const { data } = await sb
      .from('transcript_links')
      .select('registration_id, email, course_id')
      .eq('token', token)
      .eq('is_active', true)
      .maybeSingle();

    if (!data) {
      return NextResponse.json({ error: 'Link not found or expired' }, { status: 404 });
    }

    // Build the internal transcript URL and fetch it server-side
    const host  = req.headers.get('host') ?? 'localhost:3000';
    const proto = req.headers.get('x-forwarded-proto') ?? 'http';
    const base  = `${proto}://${host}`;

    const qs = new URLSearchParams({
      regId:  data.registration_id,
      email:  data.email,
      course: data.course_id,
    });

    const pdfRes = await fetch(`${base}/api/training/transcript?${qs}`);

    if (!pdfRes.ok) {
      return NextResponse.json({ error: 'Could not generate transcript' }, { status: 502 });
    }

    const pdfBuffer = await pdfRes.arrayBuffer();
    const filename  = `FMP-Transcript-${data.registration_id}-${data.course_id.toUpperCase()}.pdf`;

    return new NextResponse(pdfBuffer as unknown as BodyInit, {
      status: 200,
      headers: {
        'Content-Type':        'application/pdf',
        'Content-Disposition': `attachment; filename="${filename}"`,
        'Cache-Control':       'no-store',
      },
    });
  } catch (e) {
    return NextResponse.json({ error: String(e) }, { status: 500 });
  }
}
