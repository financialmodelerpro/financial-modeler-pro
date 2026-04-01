/**
 * POST /api/training/verify-email
 * Validates the 6-digit OTP for an email address.
 */

import { NextRequest, NextResponse } from 'next/server';
import { getServerClient } from '@/src/lib/supabase';

export async function POST(req: NextRequest) {
  try {
    const body = await req.json() as { email?: string; code?: string };
    const email = body.email?.trim().toLowerCase();
    const code  = body.code?.trim();

    if (!email || !code) {
      return NextResponse.json({ success: false, error: 'email and code are required' }, { status: 400 });
    }

    const sb = getServerClient();

    const { data } = await sb
      .from('training_email_otps')
      .select('id, code, expires_at, used')
      .eq('email', email)
      .eq('used', false)
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle();

    if (!data) {
      return NextResponse.json({ success: false, error: 'No verification code found. Request a new one.' }, { status: 400 });
    }

    if (new Date(data.expires_at) < new Date()) {
      return NextResponse.json({ success: false, error: 'Code expired. Request a new one.' }, { status: 400 });
    }

    if (data.code !== code) {
      return NextResponse.json({ success: false, error: 'Incorrect code. Please try again.' }, { status: 400 });
    }

    // Mark as used
    await sb.from('training_email_otps').update({ used: true }).eq('id', data.id);

    return NextResponse.json({ success: true });
  } catch (e) {
    return NextResponse.json({ success: false, error: String(e) }, { status: 500 });
  }
}
