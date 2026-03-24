/**
 * /api/user/profile
 * GET  — current user's profile + project count
 * PATCH — update name or email (email requires current password)
 */
import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/src/lib/auth';
import { getServerClient } from '@/src/lib/supabase';
import { verifyPassword } from '@/src/lib/password';

async function getSession() {
  const session = await getServerSession(authOptions);
  if (!session?.user) return { error: 'Unauthorized', status: 401, session: null };
  return { error: null, status: 200, session };
}

// ── GET ───────────────────────────────────────────────────────────────────────
export async function GET() {
  const { error, status, session } = await getSession();
  if (error || !session) return NextResponse.json({ error }, { status });

  const db = getServerClient();
  const userId = session.user.id;

  const [userResult, countResult] = await Promise.all([
    db.from('users').select('id, name, email').eq('id', userId).single(),
    db.from('projects').select('id', { count: 'exact', head: true }).eq('user_id', userId).eq('is_archived', false),
  ]);

  if (userResult.error) return NextResponse.json({ error: userResult.error.message }, { status: 500 });

  return NextResponse.json({
    name:          userResult.data.name,
    email:         userResult.data.email,
    projectsCount: countResult.count ?? 0,
  });
}

// ── PATCH ─────────────────────────────────────────────────────────────────────
export async function PATCH(req: NextRequest) {
  const { error, status, session } = await getSession();
  if (error || !session) return NextResponse.json({ error }, { status });

  const body = await req.json() as {
    action: 'name' | 'email';
    name?: string;
    email?: string;
    currentPassword?: string;
  };

  const db = getServerClient();
  const userId = session.user.id;

  // ── Update name ────────────────────────────────────────────────────────────
  if (body.action === 'name') {
    const name = (body.name ?? '').trim();
    if (!name) return NextResponse.json({ error: 'Name cannot be empty' }, { status: 400 });

    const { error: dbErr } = await db.from('users').update({ name }).eq('id', userId);
    if (dbErr) return NextResponse.json({ error: dbErr.message }, { status: 500 });
    return NextResponse.json({ ok: true });
  }

  // ── Update email ───────────────────────────────────────────────────────────
  if (body.action === 'email') {
    const newEmail = (body.email ?? '').toLowerCase().trim();
    if (!newEmail || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(newEmail)) {
      return NextResponse.json({ error: 'Invalid email address' }, { status: 400 });
    }
    if (!body.currentPassword) {
      return NextResponse.json({ error: 'Current password is required to change email' }, { status: 400 });
    }

    // Verify current password
    const { data: user } = await db
      .from('users').select('password_hash').eq('id', userId).single();
    if (!user?.password_hash) return NextResponse.json({ error: 'Cannot verify password' }, { status: 400 });

    const valid = await verifyPassword(body.currentPassword, user.password_hash);
    if (!valid) return NextResponse.json({ error: 'Incorrect password' }, { status: 403 });

    // Check email not already taken
    const { data: existing } = await db
      .from('users').select('id').eq('email', newEmail).maybeSingle();
    if (existing) return NextResponse.json({ error: 'That email is already in use' }, { status: 409 });

    const { error: dbErr } = await db.from('users').update({ email: newEmail }).eq('id', userId);
    if (dbErr) return NextResponse.json({ error: dbErr.message }, { status: 500 });
    return NextResponse.json({ ok: true });
  }

  return NextResponse.json({ error: 'Invalid action' }, { status: 400 });
}
