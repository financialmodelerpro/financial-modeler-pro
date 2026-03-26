import { NextRequest, NextResponse } from 'next/server';
import { cookies } from 'next/headers';
import { getStudentProgress } from '@/src/lib/sheets';

export async function GET(req: NextRequest) {
  try {
    let email = '';
    let registrationId = '';

    // Primary: read from httpOnly cookie
    try {
      const cookieStore = await cookies();
      const raw = cookieStore.get('training_session')?.value;
      if (raw) {
        const parsed = JSON.parse(raw) as { email?: string; registrationId?: string };
        email = parsed.email ?? '';
        registrationId = parsed.registrationId ?? '';
      }
    } catch { /* ignore cookie parse errors */ }

    // Fallback: accept credentials from query params (client has them in localStorage)
    if (!email || !registrationId) {
      email = req.nextUrl.searchParams.get('email') ?? '';
      registrationId = req.nextUrl.searchParams.get('registrationId') ?? '';
    }

    if (!email || !registrationId) {
      return NextResponse.json(
        { success: false, error: 'Not authenticated.' },
        { status: 401 },
      );
    }

    const result = await getStudentProgress(
      email.trim().toLowerCase(),
      registrationId.trim(),
    );

    if (!result.success) {
      return NextResponse.json(
        { success: false, error: result.error ?? 'Failed to fetch progress.' },
        { status: 400 },
      );
    }

    return NextResponse.json({ success: true, data: result.data });
  } catch {
    return NextResponse.json(
      { success: false, error: 'An unexpected error occurred.' },
      { status: 500 },
    );
  }
}
