import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/src/shared/auth/nextauth';
import { getServerClient } from '@/src/core/db/supabase';

/**
 * Admin CRUD for the Modeling Hub whitelist (migration 136).
 *
 *   GET   -> list all entries (newest first)
 *   POST  -> add a new entry { email, note? }
 *
 * Per-entry delete lives under /api/admin/modeling-access/[id].
 *
 * All routes are admin-gated via NextAuth role. Emails are lowercased +
 * trimmed before write so lookups from canEmailSignin/RegisterModeling stay
 * case-insensitive.
 */

async function requireAdmin() {
  const session = await getServerSession(authOptions);
  if (!session?.user || (session.user as { role?: string }).role !== 'admin') {
    return null;
  }
  return session;
}

export async function GET() {
  const session = await requireAdmin();
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  try {
    const sb = getServerClient();
    const { data, error } = await sb
      .from('modeling_access_whitelist')
      .select('id, email, note, added_by, added_at')
      .order('added_at', { ascending: false });
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    return NextResponse.json({ entries: data ?? [] });
  } catch {
    return NextResponse.json({ error: 'Failed to load whitelist' }, { status: 500 });
  }
}

export async function POST(req: NextRequest) {
  const session = await requireAdmin();
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  let body: { email?: string; note?: string } = {};
  try {
    body = await req.json() as { email?: string; note?: string };
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 });
  }

  const email = (body.email ?? '').trim().toLowerCase();
  if (!email || !email.includes('@')) {
    return NextResponse.json({ error: 'A valid email is required' }, { status: 400 });
  }

  const adminEmail = (session.user as { email?: string }).email ?? 'admin';

  try {
    const sb = getServerClient();
    const { data, error } = await sb
      .from('modeling_access_whitelist')
      .insert({
        email,
        note:     body.note?.trim() || null,
        added_by: adminEmail,
      })
      .select('id, email, note, added_by, added_at')
      .single();

    if (error) {
      if (error.message.toLowerCase().includes('duplicate')) {
        return NextResponse.json({ error: 'That email is already on the whitelist' }, { status: 409 });
      }
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    return NextResponse.json({ ok: true, entry: data }, { status: 201 });
  } catch (err) {
    console.error('[modeling-access POST] insert failed:', err);
    return NextResponse.json({ error: 'Failed to add entry' }, { status: 500 });
  }
}
