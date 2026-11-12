/**
 * PATCH /api/user/password - change password (requires current password)
 */
import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/src/shared/auth/nextauth';
import { getServerClient } from '@/src/core/db/supabase';
import { verifyPassword, hashPassword } from '@/src/shared/auth/password';
import { revokeTrustedDevices, clearTrustCookieHeaders } from '@/src/shared/auth/deviceTrust';

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
    .from('users').select('password_hash, email').eq('id', userId).single();
  if (!user?.password_hash) return NextResponse.json({ error: 'Cannot verify password' }, { status: 400 });

  const valid = await verifyPassword(body.currentPassword, user.password_hash);
  if (!valid) return NextResponse.json({ error: 'Current password is incorrect' }, { status: 403 });

  const newHash = await hashPassword(body.newPassword);
  const { error: dbErr } = await db.from('users').update({ password_hash: newHash }).eq('id', userId);
  if (dbErr) return NextResponse.json({ error: dbErr.message }, { status: 500 });

  // A password change revokes EVERY trusted device for this email, this one
  // included (deviceTrust.ts rule 5): each device asks for a code once more.
  const response = NextResponse.json({ ok: true });
  try {
    await revokeTrustedDevices(user.email ?? session.user.email ?? '');
  } catch (e) {
    console.error('[user/password] trusted device revoke failed:', e);
  }
  for (const c of clearTrustCookieHeaders(req.headers.get('host'), process.env.NODE_ENV === 'production')) {
    response.headers.append('Set-Cookie', c);
  }
  return response;
}
