/**
 * /api/user/profile
 * GET  - current user's profile + project count
 * PATCH - update name or email (email requires current password)
 */
import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/src/shared/auth/nextauth';
import { getServerClient } from '@/src/core/db/supabase';
import { verifyPassword } from '@/src/shared/auth/password';

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

  // Schema-tolerant select: company/job_title (mig 172) may not exist on every
  // deployment yet. Attempt the full column set, and if the column is unknown,
  // fall back to the always-present core columns.
  const FULL_COLS = 'id, name, email, company, job_title, phone, city, avatar_url';
  let userResult = await db.from('users').select(FULL_COLS).eq('id', userId).single();
  if (userResult.error && /column|does not exist|company|job_title|phone|city|avatar_url/i.test(userResult.error.message)) {
    userResult = await db.from('users').select('id, name, email').eq('id', userId).single();
  }
  const countResult = await db
    .from('projects').select('id', { count: 'exact', head: true })
    .eq('user_id', userId).eq('is_archived', false);

  if (userResult.error) return NextResponse.json({ error: userResult.error.message }, { status: 500 });

  const u = userResult.data as Record<string, unknown>;
  return NextResponse.json({
    name:          u.name ?? null,
    email:         u.email,
    company:       u.company ?? null,
    job_title:     u.job_title ?? null,
    phone:         u.phone ?? null,
    city:          u.city ?? null,
    avatar_url:    u.avatar_url ?? null,
    projectsCount: countResult.count ?? 0,
  });
}

// ── PATCH ─────────────────────────────────────────────────────────────────────
export async function PATCH(req: NextRequest) {
  const { error, status, session } = await getSession();
  if (error || !session) return NextResponse.json({ error }, { status });

  const body = await req.json() as {
    action: 'name' | 'email' | 'profile';
    name?: string;
    email?: string;
    company?: string;
    job_title?: string;
    phone?: string;
    city?: string;
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

  // ── Update company details (company + title required; phone + city optional) ─
  if (body.action === 'profile') {
    const company   = (body.company ?? '').trim();
    const jobTitle  = (body.job_title ?? '').trim();
    if (!company)  return NextResponse.json({ error: 'Company is required' }, { status: 400 });
    if (!jobTitle) return NextResponse.json({ error: 'Job title is required' }, { status: 400 });

    const updates: Record<string, string | null> = {
      company,
      job_title: jobTitle,
      phone: (body.phone ?? '').trim() || null,
      city:  (body.city ?? '').trim() || null,
    };

    // Schema-tolerant: drop any column the deployment does not have yet and retry.
    let dbErr = (await db.from('users').update(updates).eq('id', userId)).error;
    if (dbErr && /column|does not exist|company|job_title|phone|city/i.test(dbErr.message)) {
      for (const col of ['phone', 'city', 'company', 'job_title']) {
        if (dbErr && dbErr.message.toLowerCase().includes(col)) delete updates[col];
      }
      if (Object.keys(updates).length > 0) {
        dbErr = (await db.from('users').update(updates).eq('id', userId)).error;
      } else {
        dbErr = null;
      }
    }
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
