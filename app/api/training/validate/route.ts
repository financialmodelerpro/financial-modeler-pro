import { NextRequest, NextResponse } from 'next/server';
import { validateStudent } from '@/src/lib/sheets';
import { getServerClient } from '@/src/lib/supabase';
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

    // Check if student is blocked by admin
    try {
      const sb = getServerClient();
      const { data: blockRecord } = await sb
        .from('training_admin_actions')
        .select('id')
        .eq('registration_id', registrationId.trim())
        .eq('action_type', 'block')
        .eq('is_active', true)
        .maybeSingle();
      if (blockRecord) {
        return NextResponse.json(
          { success: false, error: 'Your account has been suspended. Please contact support@financialmodelerpro.com' },
          { status: 403 },
        );
      }
    } catch {
      // If block check fails, allow login (fail open — don't lock out students due to DB issues)
    }

    // Set an httpOnly cookie so the server-side progress API can read the session
    const response = NextResponse.json({ success: true, data: result.data });
    response.cookies.set('training_session', JSON.stringify({ email: email.trim().toLowerCase(), registrationId: registrationId.trim() }), {
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      sameSite: 'lax',
      path: '/',
      maxAge: 60 * 60 * 24, // 24 hours
    });
    return response;
  } catch {
    return NextResponse.json(
      { success: false, error: 'An unexpected error occurred.' },
      { status: 500 },
    );
  }
}
