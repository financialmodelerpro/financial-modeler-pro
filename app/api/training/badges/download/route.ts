import { NextRequest, NextResponse } from 'next/server';
import { getServerClient } from '@/src/lib/shared/supabase';

export const dynamic = 'force-dynamic';

/**
 * GET /api/training/badges/download?certId=FMP-3SFM-2026-0001
 * Fetches badge URL from student_certificates and redirects to the badge image.
 */
export async function GET(req: NextRequest) {
  const certId = req.nextUrl.searchParams.get('certId');
  if (!certId) {
    return NextResponse.json({ error: 'certId is required' }, { status: 400 });
  }

  try {
    const sb = getServerClient();
    const { data } = await sb
      .from('student_certificates')
      .select('badge_url')
      .eq('certificate_id', certId)
      .single();

    if (!data?.badge_url) {
      return NextResponse.json(
        { error: 'Badge not yet generated. Badges are created automatically after certificate issuance.' },
        { status: 404 },
      );
    }

    return NextResponse.redirect(data.badge_url);
  } catch {
    return NextResponse.json({ error: 'Failed to fetch badge.' }, { status: 500 });
  }
}
