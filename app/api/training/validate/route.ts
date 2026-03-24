import { NextRequest, NextResponse } from 'next/server';
import { validateStudent } from '@/src/lib/sheets';
import { cookies } from 'next/headers';

export async function POST(req: NextRequest) {
  try {
    const body = await req.json() as { email?: string; registrationId?: string };
    const { email, registrationId } = body;

    if (!email || !registrationId) {
      return NextResponse.json(
        { success: false, error: 'email and registrationId are required' },
        { status: 400 },
      );
    }

    const result = await validateStudent(
      email.trim().toLowerCase(),
      registrationId.trim(),
    );

    if (!result.success) {
      return NextResponse.json(
        { success: false, error: 'Invalid email or Registration ID.' },
        { status: 401 },
      );
    }

    // Set an httpOnly cookie so the dashboard can read session server-side
    const cookieStore = await cookies();
    cookieStore.set('training_session', JSON.stringify({ email: email.trim().toLowerCase(), registrationId: registrationId.trim() }), {
      httpOnly: true,
      sameSite: 'lax',
      path: '/',
      maxAge: 60 * 60 * 24, // 24 hours
    });

    return NextResponse.json({ success: true, data: result.data });
  } catch {
    return NextResponse.json(
      { success: false, error: 'An unexpected error occurred.' },
      { status: 500 },
    );
  }
}
