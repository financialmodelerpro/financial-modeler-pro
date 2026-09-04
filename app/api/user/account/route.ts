/**
 * /api/user/account - the authenticated user's own account deletion.
 *
 *   GET    -> deletion preview: what a deletion would remove (project/version
 *             counts) and whether a live paid subscription stands in the way.
 *   DELETE -> permanently delete the account. Requires { confirmText: 'DELETE' }.
 *             When a LIVE Paddle subscription exists, the body must also carry
 *             { acknowledgeSubscriptionCancel: true }: the subscription is then
 *             cancelled at Paddle immediately BEFORE the delete, and a cancel
 *             failure aborts the whole deletion (409 active_subscription when
 *             the acknowledgment is missing). Never silently orphans billing.
 *
 * The actual removal/retention semantics live in ONE place,
 * src/shared/account/deleteUserAccount.ts, shared with the admin route.
 *
 * No em dashes in this file.
 */
import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/src/shared/auth/nextauth';
import { getServerClient } from '@/src/core/db/supabase';
import { previewAccountDeletion, deleteUserAccount } from '@/src/shared/account/deleteUserAccount';

export async function GET() {
  const session = await getServerSession(authOptions);
  if (!session?.user?.id) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  const preview = await previewAccountDeletion(getServerClient(), session.user.id);
  if (!preview) return NextResponse.json({ error: 'User not found' }, { status: 404 });
  return NextResponse.json({
    projects: preview.projects,
    versions: preview.versions,
    liveSubscriptions: preview.liveSubscriptions,
    isAdmin: preview.isAdmin,
  });
}

export async function DELETE(req: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session?.user?.id) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const body = await req.json().catch(() => ({})) as { confirmText?: string; acknowledgeSubscriptionCancel?: boolean };
  if (body.confirmText !== 'DELETE') {
    return NextResponse.json({ error: 'You must type DELETE to confirm account deletion' }, { status: 400 });
  }

  const result = await deleteUserAccount(getServerClient(), {
    userId: session.user.id,
    source: 'self',
    cancelPaddle: body.acknowledgeSubscriptionCancel === true,
  });

  if (!result.ok) {
    const status =
      result.code === 'active_subscription' ? 409 :
      result.code === 'account_has_members' ? 409 :
      result.code === 'admin_account' ? 403 :
      result.code === 'not_found' ? 404 : 500;
    return NextResponse.json({ error: result.error, code: result.code }, { status });
  }
  return NextResponse.json({ ok: true, removed: result.removed });
}
