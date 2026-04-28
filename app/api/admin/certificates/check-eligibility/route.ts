import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/src/shared/auth/nextauth';
import { checkEligibility } from '@/src/hubs/training/lib/certificates/certificateEligibility';

export const dynamic = 'force-dynamic';

/**
 * POST /api/admin/certificates/check-eligibility
 *
 * Returns a detailed Supabase-native eligibility report for an (email,
 * courseCode) pair — admin UI surfaces missing sessions + watch-threshold
 * failures before letting the admin click Force Issue.
 *
 * Body: { email: string; courseCode: string }
 */
export async function POST(req: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session?.user || (session.user as { role?: string }).role !== 'admin') {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  try {
    const body = await req.json() as { email?: string; courseCode?: string };
    const email = (body.email ?? '').toLowerCase().trim();
    const code = (body.courseCode ?? '').toUpperCase().trim();
    if (!email || !code) {
      return NextResponse.json({ error: 'email and courseCode required' }, { status: 400 });
    }
    const result = await checkEligibility(email, code.toLowerCase());
    return NextResponse.json(result);
  } catch (e) {
    return NextResponse.json({ error: String(e) }, { status: 500 });
  }
}
