import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/src/lib/shared/auth';
import { getServerClient } from '@/src/lib/shared/supabase';

export const dynamic = 'force-dynamic';

/**
 * GET /api/admin/certificates/by-date?date=YYYY-MM-DD
 *
 * Admin-only — returns every cert with cert_status='Issued' whose issued_at
 * falls within the given calendar day (UTC day boundaries). Used by the
 * Daily Certifications Roundup admin page to assemble a one-post cohort
 * celebration.
 */
export async function GET(req: NextRequest) {
  const session = await getServerSession(authOptions);
  if ((session?.user as { role?: string })?.role !== 'admin') {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }

  const date = req.nextUrl.searchParams.get('date');
  if (!date || !/^\d{4}-\d{2}-\d{2}$/.test(date)) {
    return NextResponse.json({ error: 'date query param required (YYYY-MM-DD)' }, { status: 400 });
  }

  // UTC day window — inclusive start, exclusive end. issued_at is stored as
  // timestamptz so this matches any timezone the admin happens to be in,
  // as long as they pick the UTC calendar date they want.
  const dayStart = `${date}T00:00:00Z`;
  const nextDay  = new Date(`${date}T00:00:00Z`);
  nextDay.setUTCDate(nextDay.getUTCDate() + 1);
  const dayEnd = nextDay.toISOString();

  const sb = getServerClient();
  const { data, error } = await sb
    .from('student_certificates')
    .select('certificate_id, full_name, email, course, course_code, verification_url, issued_at, grade')
    .eq('cert_status', 'Issued')
    .gte('issued_at', dayStart)
    .lt('issued_at', dayEnd)
    .order('issued_at', { ascending: true });

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({
    date,
    count: (data ?? []).length,
    certificates: data ?? [],
  });
}
