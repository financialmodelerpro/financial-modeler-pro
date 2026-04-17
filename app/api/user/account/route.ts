/**
 * DELETE /api/user/account - permanently delete the authenticated user's account.
 * Requires { confirmText: 'DELETE' } in the request body.
 */
import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/src/lib/shared/auth';
import { getServerClient } from '@/src/lib/shared/supabase';

export async function DELETE(req: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session?.user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const body = await req.json() as { confirmText?: string };
  if (body.confirmText !== 'DELETE') {
    return NextResponse.json({ error: 'You must type DELETE to confirm account deletion' }, { status: 400 });
  }

  const db = getServerClient();
  const userId = session.user.id;

  // Delete user - cascade will handle related rows (projects, permissions, etc.)
  const { error: dbErr } = await db.from('users').delete().eq('id', userId);
  if (dbErr) return NextResponse.json({ error: dbErr.message }, { status: 500 });

  return NextResponse.json({ ok: true });
}
