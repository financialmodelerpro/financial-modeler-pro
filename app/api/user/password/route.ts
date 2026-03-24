/**
 * PATCH /api/user/password — change password (requires current password)
 */
import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/src/lib/auth';
import { getServerClient } from '@/src/lib/supabase';
import { verifyPassword, hashPassword } from '@/src/lib/password';

export async function PATCH(req: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session?.user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const body = await req.json() as {
    currentPassword: string;
    newPassword:     string;
  };

  if (!body.currentPassword || !body.newPassword) {
    return NextResponse.json({ error: 'currentPassword and newPassword are required' }, { status: 400 });
  }
  if (body.newPassword.length < 8) {
    return NextResponse.json({ error: 'New password must be at least 8 characters' }, { status: 400 });
  }

  const db = getServerClient();
  const userId = session.user.id;

  const { data: user } = await db
    .from('users').select('password_hash').eq('id', userId).single();
  if (!user?.password_hash) return NextResponse.json({ error: 'Cannot verify password' }, { status: 400 });

  const valid = await verifyPassword(body.currentPassword, user.password_hash);
  if (!valid) return NextResponse.json({ error: 'Current password is incorrect' }, { status: 403 });

  const newHash = await hashPassword(body.newPassword);
  const { error: dbErr } = await db.from('users').update({ password_hash: newHash }).eq('id', userId);
  if (dbErr) return NextResponse.json({ error: dbErr.message }, { status: 500 });

  return NextResponse.json({ ok: true });
}
