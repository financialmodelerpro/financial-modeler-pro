import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/src/lib/shared/auth';
import { getServerClient } from '@/src/lib/shared/supabase';
import { writeAuditLog } from '@/src/lib/shared/audit';

// ── Admin guard ───────────────────────────────────────────────────────────────
async function requireAdmin() {
  const session = await getServerSession(authOptions);
  if (!session?.user) return { error: 'Unauthorized', status: 401, session: null };
  if ((session.user as { role?: string }).role !== 'admin') {
    return { error: 'Forbidden', status: 403, session: null };
  }
  return { error: null, status: 200, session };
}

// ── GET: paginated user list ──────────────────────────────────────────────────
export async function GET(req: NextRequest) {
  const { error, status, session } = await requireAdmin();
  if (error || !session) return NextResponse.json({ error }, { status });

  try {
    const { searchParams } = req.nextUrl;
    const page   = parseInt(searchParams.get('page') ?? '0');
    const size   = parseInt(searchParams.get('size') ?? '20');
    const search = searchParams.get('search') ?? '';
    const role   = searchParams.get('role')   ?? '';

    const sb = getServerClient();
    let q = sb
      .from('users')
      .select(
        'id, email, name, role, subscription_plan, subscription_status, created_at, projects(count)',
        { count: 'exact' },
      );

    if (search) q = q.ilike('email', `%${search}%`);
    if (role && role !== 'all') q = q.eq('role', role);
    q = q.order('created_at', { ascending: false }).range(page * size, (page + 1) * size - 1);

    const { data, count, error: dbError } = await q;
    if (dbError) return NextResponse.json({ error: dbError.message }, { status: 500 });

    return NextResponse.json({ users: data ?? [], total: count ?? 0 });
  } catch {
    return NextResponse.json({ error: 'Failed to fetch users' }, { status: 500 });
  }
}

// ── PATCH: update role, subscription_plan, and/or subscription_status ────────
export async function PATCH(req: NextRequest) {
  const { error, status, session } = await requireAdmin();
  if (error || !session) return NextResponse.json({ error }, { status });

  try {
    const body = await req.json() as {
      id:      string;
      role?:   string;
      plan?:   string;
      status?: string;
      reason?: string;
    };

    const { id, role, plan, status: newStatus, reason } = body;
    if (!id) return NextResponse.json({ error: 'Missing user id' }, { status: 400 });
    if (!role && !plan && !newStatus) {
      return NextResponse.json({ error: 'No fields to update' }, { status: 400 });
    }

    const adminId = (session.user as { id: string }).id;
    const sb = getServerClient();

    // Fetch current values so we can record before_value in audit log
    const { data: current, error: fetchError } = await sb
      .from('users')
      .select('role, subscription_plan, subscription_status')
      .eq('id', id)
      .single();

    if (fetchError || !current) {
      return NextResponse.json({ error: 'User not found' }, { status: 404 });
    }

    // Build update payload
    const updates: Record<string, string> = {};
    if (role)      updates.role                = role;
    if (plan)      updates.subscription_plan   = plan;
    if (newStatus) updates.subscription_status = newStatus;

    const { error: updateError } = await sb.from('users').update(updates).eq('id', id);
    if (updateError) return NextResponse.json({ error: updateError.message }, { status: 500 });

    // Write audit log entries — one per changed field
    const auditBase = { adminId, targetUserId: id, reason: reason ?? null };

    if (role) {
      await writeAuditLog({
        ...auditBase,
        action:      'role_change',
        beforeValue: { role: current.role },
        afterValue:  { role },
      });
    }

    if (plan) {
      await writeAuditLog({
        ...auditBase,
        action:      'plan_change',
        beforeValue: { plan: current.subscription_plan },
        afterValue:  { plan },
      });
    }

    if (newStatus) {
      await writeAuditLog({
        ...auditBase,
        action:      'status_change',
        beforeValue: { status: current.subscription_status },
        afterValue:  { status: newStatus },
      });
    }

    return NextResponse.json({ ok: true });
  } catch {
    return NextResponse.json({ error: 'Failed to update user' }, { status: 500 });
  }
}
