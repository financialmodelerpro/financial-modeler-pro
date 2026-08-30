/**
 * /api/admin/users/[id] - admin-side account deletion.
 *
 *   GET    -> deletion preview: the user's identity, what a deletion would
 *             remove (projects / versions / requests / subscription rows) and
 *             any live Paddle subscription that would be cancelled first.
 *   DELETE -> permanently delete the user. Body: { confirm: true, message? }.
 *             The optional message is emailed to the user with the deletion
 *             notice. A live Paddle subscription is cancelled at Paddle
 *             immediately before the delete; a cancel failure aborts.
 *             The deletion is AUDITED in account_deletions (mig 219): who
 *             deleted, when, the message, and what was removed. An admin
 *             deletion that cannot be audited does not proceed.
 *
 * Removal/retention semantics live in ONE place,
 * src/shared/account/deleteUserAccount.ts, shared with the self-service route.
 *
 * No em dashes in this file.
 */
import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/src/shared/auth/nextauth';
import { getServerClient } from '@/src/core/db/supabase';
import { previewAccountDeletion, deleteUserAccount } from '@/src/shared/account/deleteUserAccount';

async function requireAdmin() {
  const session = await getServerSession(authOptions);
  if (!session?.user) return { error: 'Unauthorized', status: 401, adminId: null };
  if ((session.user as { role?: string }).role !== 'admin') {
    return { error: 'Forbidden', status: 403, adminId: null };
  }
  return { error: null, status: 200, adminId: session.user.id as string };
}

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { error, status } = await requireAdmin();
  if (error) return NextResponse.json({ error }, { status });
  const { id } = await params;
  const preview = await previewAccountDeletion(getServerClient(), id);
  if (!preview) return NextResponse.json({ error: 'User not found' }, { status: 404 });
  return NextResponse.json({ preview });
}

export async function DELETE(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { error, status, adminId } = await requireAdmin();
  if (error || !adminId) return NextResponse.json({ error }, { status });
  const { id } = await params;

  const body = await req.json().catch(() => ({})) as { confirm?: boolean; message?: string };
  if (body.confirm !== true) {
    return NextResponse.json({ error: 'confirm: true required' }, { status: 400 });
  }
  if (id === adminId) {
    // Also refused by the helper (admin accounts are never deletable), but the
    // self-targeting case deserves its own message.
    return NextResponse.json({ error: 'You cannot delete your own account from the admin panel.' }, { status: 400 });
  }

  const result = await deleteUserAccount(getServerClient(), {
    userId: id,
    source: 'admin',
    deletedBy: adminId,
    message: typeof body.message === 'string' ? body.message : null,
    // The admin confirmation dialog states that an active subscription will be
    // cancelled; confirm: true carries that acknowledgment.
    cancelPaddle: true,
  });

  if (!result.ok) {
    const httpStatus =
      result.code === 'not_found' ? 404 :
      result.code === 'admin_account' ? 403 :
      result.code === 'audit_unavailable' ? 503 : 500;
    return NextResponse.json({ error: result.error, code: result.code }, { status: httpStatus });
  }
  return NextResponse.json({ ok: true, removed: result.removed, messageEmailed: result.messageEmailed, audited: result.audited });
}
