/**
 * POST /api/auth/forgot-password
 * Generates a password-reset token and (in production) sends a reset email.
 * Always returns 200 to prevent email enumeration.
 */
import { NextRequest, NextResponse } from 'next/server';
import { randomBytes, createHash } from 'crypto';
import { getServerClient } from '@/src/lib/shared/supabase';
import { sendEmail, FROM } from '@/src/lib/email/sendEmail';
import { passwordResetTemplate } from '@/src/lib/email/templates/passwordReset';

const TOKEN_TTL_MINUTES = 60;

export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => ({})) as { email?: string };
  const email = (body.email ?? '').toLowerCase().trim();

  if (!email) {
    return NextResponse.json({ error: 'Email is required' }, { status: 400 });
  }

  // Always return 200 even if the email doesn't exist (prevent enumeration)
  const db = getServerClient();

  const { data: user } = await db
    .from('users').select('id').eq('email', email).maybeSingle();

  if (user?.id) {
    // Generate a secure token
    const plainToken = randomBytes(32).toString('hex');
    const tokenHash  = createHash('sha256').update(plainToken).digest('hex');
    const expiresAt  = new Date(Date.now() + TOKEN_TTL_MINUTES * 60 * 1000).toISOString();

    // Store the hash (never store the plaintext token)
    await db.from('password_reset_tokens').insert({
      user_id:    user.id,
      token_hash: tokenHash,
      expires_at: expiresAt,
    });

    const resetUrl = `${process.env.NEXT_PUBLIC_APP_URL ?? 'http://localhost:3000'}/reset-password?token=${plainToken}`;

    if (process.env.NODE_ENV !== 'production') {
      console.log('[forgot-password] Reset URL:', resetUrl);
    }

    try {
      const { subject, html, text } = passwordResetTemplate({ resetUrl, expiresMinutes: TOKEN_TTL_MINUTES });
      await sendEmail({ to: email, subject, html, text, from: FROM.noreply });
    } catch (err) {
      console.error('[forgot-password] Email send failed:', err);
    }
  }

  return NextResponse.json({ ok: true });
}
