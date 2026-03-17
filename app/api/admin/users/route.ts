import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/src/lib/auth';
import { serverClient } from '@/src/lib/supabase';

function unauthorized() {
  return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
}
function forbidden() {
  return NextResponse.json({ error: 'Forbidden — admin only' }, { status: 403 });
}

// ── GET /api/admin/users — list all users ─────────────────────────────────────
export async function GET() {
  const session = await getServerSession(authOptions);
  if (!session) return unauthorized();
  if (session.user.role !== 'admin') return forbidden();

  const { data, error } = await serverClient
    .from('users')
    .select('id, email, name, role, subscription_plan, subscription_status, projects_limit, admin_notes, last_login_at, trial_ends_at, created_at, updated_at')
    .order('created_at', { ascending: false });

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ users: data });
}

// ── PATCH /api/admin/users — update a user's role / plan / status ─────────────
export async function PATCH(req: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session) return unauthorized();
  if (session.user.role !== 'admin') return forbidden();

  const body = await req.json().catch(() => null);
  if (!body?.id) return NextResponse.json({ error: 'id is required' }, { status: 400 });

  const allowed = ['role', 'subscription_plan', 'subscription_status', 'projects_limit', 'name', 'admin_notes', 'trial_ends_at'];
  const updates: Record<string, unknown> = {};
  for (const key of allowed) {
    if (body[key] !== undefined) updates[key] = body[key];
  }

  if (Object.keys(updates).length === 0) {
    return NextResponse.json({ error: 'No updatable fields provided' }, { status: 400 });
  }

  // Write audit log entry before updating
  const { data: before } = await serverClient
    .from('users')
    .select('role, subscription_plan, subscription_status, projects_limit')
    .eq('id', body.id)
    .single();

  await serverClient.from('admin_audit_log').insert({
    admin_id:       session.user.id,
    action:         'update_user',
    target_user_id: body.id,
    before_value:   before ?? {},
    after_value:    updates,
    reason:         body.reason ?? null,
  });

  const { data, error } = await serverClient
    .from('users')
    .update(updates)
    .eq('id', body.id)
    .select('id, email, name, role, subscription_plan, subscription_status, projects_limit, admin_notes, last_login_at, trial_ends_at')
    .single();

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ user: data });
}
