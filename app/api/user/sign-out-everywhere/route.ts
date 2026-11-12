/**
 * POST /api/user/sign-out-everywhere
 *
 * The explicit "sign out everywhere" (deviceTrust.ts rule 5): deletes EVERY
 * trusted device for the signed-in user's email, on every hub, and clears this
 * device's trust cookie (the shared-domain one and any old host-only one).
 *
 * What it cannot do: end a session already open on another device. Sign-in
 * sessions are signed JWT cookies with nothing stored server-side, renewed
 * while in use, so there is no server record to delete. Those devices must
 * enter a new emailed code at their next sign-in. The caller's own session
 * stays open.
 */
import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/src/shared/auth/nextauth';
import { getServerClient } from '@/src/core/db/supabase';
import { revokeTrustedDevices, clearTrustCookieHeaders } from '@/src/shared/auth/deviceTrust';

export async function POST(req: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session?.user?.id) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  // The email ON FILE, never one from the request body.
  const { data: user } = await getServerClient()
    .from('users').select('email').eq('id', session.user.id).maybeSingle();
  const email = user?.email ?? session.user.email;
  if (!email) return NextResponse.json({ error: 'No email on file' }, { status: 400 });

  let removed: number;
  try {
    removed = await revokeTrustedDevices(email);
  } catch (e) {
    console.error('[user/sign-out-everywhere]', e);
    return NextResponse.json({ error: 'Could not sign out your devices. Please try again.' }, { status: 503 });
  }

  const response = NextResponse.json({ ok: true, removed });
  for (const c of clearTrustCookieHeaders(req.headers.get('host'), process.env.NODE_ENV === 'production')) {
    response.headers.append('Set-Cookie', c);
  }
  return response;
}
