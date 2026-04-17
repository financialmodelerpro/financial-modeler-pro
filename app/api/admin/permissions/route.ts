/**
 * Admin Permissions API
 *
 * GET    /api/admin/permissions          - full feature × plan matrix + user overrides for a user
 * PATCH  /api/admin/permissions/plan     - update a plan permission toggle
 * PATCH  /api/admin/permissions/user     - set/delete a user-level override
 */

import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/src/lib/shared/auth';
import {
  loadPermissionsMatrix,
  setPlanPermission,
  setUserPermissionOverride,
} from '@/src/lib/shared/permissions';
import { getServerClient } from '@/src/lib/shared/supabase';
import { writeAuditLog } from '@/src/lib/shared/audit';

// ── Admin guard helper ────────────────────────────────────────────────────────
async function requireAdmin() {
  const session = await getServerSession(authOptions);
  if (!session?.user)               return { error: 'Unauthorized',  status: 401, session: null };
  if (session.user.role !== 'admin') return { error: 'Forbidden',     status: 403, session: null };
  return { error: null, status: 200, session };
}

// ── GET: full matrix + optional user overrides ────────────────────────────────
export async function GET(req: NextRequest) {
  const { error, status, session } = await requireAdmin();
  if (error || !session) return NextResponse.json({ error }, { status });

  const { searchParams } = new URL(req.url);
  const userId = searchParams.get('userId');

  const matrixData = await loadPermissionsMatrix();

  // If userId is provided, also return their overrides
  let userOverrides: Record<string, boolean> = {};
  if (userId) {
    const db = getServerClient();
    const { data } = await db
      .from('user_permissions')
      .select('feature_key, override_value')
      .eq('user_id', userId);
    for (const row of (data ?? []) as Array<{ feature_key: string; override_value: boolean }>) {
      userOverrides[row.feature_key] = row.override_value;
    }
  }

  return NextResponse.json({ ...matrixData, userOverrides });
}

// ── PATCH: update plan permission OR user override ────────────────────────────
export async function PATCH(req: NextRequest) {
  const { error, status, session } = await requireAdmin();
  if (error || !session) return NextResponse.json({ error }, { status });

  const body = await req.json() as {
    type: 'plan' | 'user';
    // plan update
    plan?: string;
    feature_key?: string;
    enabled?: boolean;
    // user override
    user_id?: string;
    override_value?: boolean | null;
    reason?: string | null;
  };

  const adminId = session.user.id;

  if (body.type === 'plan') {
    if (!body.plan || !body.feature_key || body.enabled === undefined) {
      return NextResponse.json({ error: 'Missing plan, feature_key, or enabled' }, { status: 400 });
    }
    await setPlanPermission(body.plan, body.feature_key, body.enabled, adminId);
    await writeAuditLog({
      adminId,
      action:      'plan_permission_change',
      beforeValue: { plan: body.plan, feature_key: body.feature_key, enabled: !body.enabled },
      afterValue:  { plan: body.plan, feature_key: body.feature_key, enabled: body.enabled },
      reason:      body.reason ?? null,
    });
    return NextResponse.json({ ok: true });
  }

  if (body.type === 'user') {
    if (!body.user_id || !body.feature_key) {
      return NextResponse.json({ error: 'Missing user_id or feature_key' }, { status: 400 });
    }

    // Fetch the current override value before changing it
    const db = getServerClient();
    const { data: existing } = await db
      .from('user_permissions')
      .select('override_value')
      .eq('user_id', body.user_id)
      .eq('feature_key', body.feature_key)
      .maybeSingle();

    const oldOverride = (existing as { override_value: boolean | null } | null)?.override_value ?? null;

    await setUserPermissionOverride(
      body.user_id,
      body.feature_key,
      body.override_value ?? null,
      body.reason ?? null,
      adminId,
    );

    await writeAuditLog({
      adminId,
      action:        'user_permission_override',
      targetUserId:  body.user_id,
      beforeValue:   { feature_key: body.feature_key, override_value: oldOverride },
      afterValue:    { feature_key: body.feature_key, override_value: body.override_value ?? null },
      reason:        body.reason ?? null,
    });

    return NextResponse.json({ ok: true });
  }

  return NextResponse.json({ error: 'Invalid type - use plan or user' }, { status: 400 });
}
