/**
 * GET /api/permissions
 *
 * Returns the current user's merged permission map:
 *   plan defaults → overridden by user_permissions rows
 *
 * Response: { plan, status, permissions: Record<featureKey, boolean> }
 */

import { NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/src/lib/shared/auth';
import { loadUserPermissions } from '@/src/lib/shared/permissions';

export async function GET() {
  const session = await getServerSession(authOptions);
  if (!session?.user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const permissions = await loadUserPermissions(
    session.user.id,
    session.user.subscription_plan ?? 'free',
  );

  return NextResponse.json({
    plan:        session.user.subscription_plan   ?? 'free',
    status:      session.user.subscription_status ?? 'active',
    permissions,
  });
}
