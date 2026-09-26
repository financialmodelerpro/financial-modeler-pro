/**
 * POST /api/training/set-password
 * Sets (or resets) a Training Hub student's password, once the 6-digit code
 * emailed to them is verified.
 *
 * Body: { email: string, code: string, password: string, registrationId?: string }
 *
 * Rebuilt 2026-09-26. Before, the code was checked against the EMAIL but the
 * password was set for whatever Registration ID the request named, and the
 * route then re-pointed that registration's email at the requester: anyone who
 * could receive a code at their own address could take over another
 * student's account. Now:
 *   - the student is resolved through the ONE lookup rule (studentLookup.ts);
 *   - the code must be the live one for the email ON FILE for that student;
 *   - the password is set for that student's own Registration ID only, and no
 *     email is ever re-pointed;
 *   - wrong codes are capped per student (the code is then withdrawn, and a
 *     new one must be requested), so six digits cannot be guessed.
 */

import { NextRequest, NextResponse } from 'next/server';
import { getServerClient } from '@/src/core/db/supabase';
import { rateLimited } from '@/src/shared/api/rateLimit';
import { lookupStudent, LOOKUP_MESSAGES } from '@/src/hubs/training/lib/auth/studentLookup';
import bcrypt from 'bcryptjs';

const MAX_WRONG_CODES = 5;

export async function POST(req: NextRequest) {
  let body: { registrationId?: string; email?: string; code?: string; password?: string };
  try { body = await req.json(); } catch { return NextResponse.json({ success: false, error: 'Invalid request.' }, { status: 400 }); }

  const code     = typeof body.code === 'string' ? body.code.trim() : '';
  const password = typeof body.password === 'string' ? body.password : '';
  if (!code) return NextResponse.json({ success: false, error: 'Enter the 6-digit code from the email.' }, { status: 400 });
  if (password.length < 8) return NextResponse.json({ success: false, error: 'Password must be at least 8 characters.' }, { status: 400 });

  try {
    const sb = getServerClient();
    const found = await lookupStudent(sb, body);
    if (!found.ok) {
      console.warn(`[set-password] refused: ${found.reason}`);
      return NextResponse.json({ success: false, reason: found.reason, error: LOOKUP_MESSAGES[found.reason] }, { status: 400 });
    }
    const email = found.student.email.trim().toLowerCase();
    const regId = found.student.registration_id;

    const { data: otp, error: otpErr } = await sb
      .from('training_email_otps')
      .select('id, code, expires_at')
      .eq('email', email)
      .eq('used', false)
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle();
    if (otpErr) throw new Error(otpErr.message);

    if (!otp) {
      console.warn(`[set-password] refused: no live code (student ${regId})`);
      return NextResponse.json({ success: false, reason: 'no_code', error: 'This code is no longer active. Please request a new one.' }, { status: 400 });
    }
    if (new Date(otp.expires_at) < new Date()) {
      console.warn(`[set-password] refused: code expired (student ${regId})`);
      return NextResponse.json({ success: false, reason: 'expired', error: 'This code has expired. Please request a new one.' }, { status: 400 });
    }
    if (otp.code !== code) {
      // Counted per student; the window outlives the code, so waiting it out
      // does not reset the count on a live code.
      if (rateLimited('training-reset-wrong-code', regId, MAX_WRONG_CODES - 1, 15 * 60_000)) {
        await sb.from('training_email_otps').update({ used: true }).eq('id', otp.id);
        console.warn(`[set-password] code withdrawn after ${MAX_WRONG_CODES} wrong attempts (student ${regId})`);
        return NextResponse.json({ success: false, reason: 'too_many_attempts', error: 'Too many incorrect codes. For your security that code has been cancelled; please request a new one.' }, { status: 429 });
      }
      console.warn(`[set-password] refused: wrong code (student ${regId})`);
      return NextResponse.json({ success: false, reason: 'wrong_code', error: 'That code is not correct. Check the latest email and try again.' }, { status: 400 });
    }

    // Consume the code ATOMICALLY: only the request that flips it wins.
    const { data: claimed, error: claimErr } = await sb
      .from('training_email_otps').update({ used: true }).eq('id', otp.id).eq('used', false).select('id');
    if (claimErr) throw new Error(claimErr.message);
    if (!claimed || claimed.length === 0) {
      return NextResponse.json({ success: false, reason: 'no_code', error: 'This code has already been used. Please request a new one.' }, { status: 400 });
    }

    const hash = await bcrypt.hash(password, 10);
    const { error: pwErr } = await sb.from('training_passwords')
      .upsert({ registration_id: regId, password_hash: hash }, { onConflict: 'registration_id' });
    if (pwErr) throw new Error(pwErr.message);

    console.info(`[set-password] password set (student ${regId})`);
    return NextResponse.json({ success: true, registrationId: regId });
  } catch (e) {
    console.error('[set-password] unexpected:', e);
    return NextResponse.json({ success: false, error: 'An unexpected error occurred. Please try again.' }, { status: 500 });
  }
}
