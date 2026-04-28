/**
 * POST /api/auth/reset-password
 * Verifies the reset token and sets a new password.
 */
import { NextRequest, NextResponse } from 'next/server';
import { createHash } from 'crypto';
import { getServerClient } from '@/src/core/db/supabase';
import { hashPassword } from '@/src/shared/auth/password';

export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => ({})) as { token?: string; newPassword?: string };

  if (!body.token || !body.newPassword) {
    return NextResponse.json({ error: 'token and newPassword are required' }, { status: 400 });
  }
  if (body.newPassword.length < 8) {
    return NextResponse.json({ error: 'Password must be at least 8 characters' }, { status: 400 });
  }

  const db = getServerClient();
  const tokenHash = createHash('sha256').update(body.token).digest('hex');

  // Look up the token
  const { data: row } = await db
    .from('password_reset_tokens')
    .select('id, user_id, expires_at, used_at')
    .eq('token_hash', tokenHash)
    .maybeSingle();

  if (!row)              return NextResponse.json({ error: 'Invalid or expired reset link' }, { status: 400 });
  if (row.used_at)       return NextResponse.json({ error: 'This reset link has already been used' }, { status: 400 });
  if (new Date(row.expires_at) < new Date()) {
    return NextResponse.json({ error: 'This reset link has expired. Please request a new one.' }, { status: 400 });
  }

  // Update password + mark token used
  const newHash = await hashPassword(body.newPassword);
  await Promise.all([
    db.from('users').update({ password_hash: newHash }).eq('id', row.user_id),
    db.from('password_reset_tokens').update({ used_at: new Date().toISOString() }).eq('id', row.id),
  ]);

  return NextResponse.json({ ok: true });
}
