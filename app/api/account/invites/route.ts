/**
 * /api/account/invites
 *
 *   GET    -> the caller's team state: seat usage, limit, open invites
 *   POST   -> invite a team member by email (seat reserved here)
 *   DELETE -> revoke an open invite (?id=)
 *
 * HOLDER-FACING, account model step 5: the first account surface a CLIENT
 * uses themselves. Every rule lives in `src/shared/account/invites.ts`; this
 * route only authenticates and maps results to HTTP. A MEMBER calling any of
 * these is refused by the engine (only the holder spends seats).
 *
 * No em dashes in this file.
 */
import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/src/shared/auth/nextauth';
import { getServerClient } from '@/src/core/db/supabase';
import { resolveAccountHolder } from '@/src/shared/admin/accountBoundary';
import {
  createAccountInvite, revokeAccountInvite, listOpenInvites, inviteSeatState,
} from '@/src/shared/account/invites';
import { seatsAllow } from '@/src/shared/admin/seats';

const APP_URL = process.env.NEXT_PUBLIC_APP_URL ?? 'https://app.financialmodelerpro.com';

async function requireUser(): Promise<{ res: NextResponse | null; userId: string | null }> {
  try {
    const session = await getServerSession(authOptions);
    const id = (session?.user as { id?: string } | undefined)?.id ?? null;
    if (!id) return { res: NextResponse.json({ error: 'Unauthorized' }, { status: 401 }), userId: null };
    return { res: null, userId: id };
  } catch {
    return { res: NextResponse.json({ error: 'Unauthorized' }, { status: 401 }), userId: null };
  }
}

export async function GET() {
  const { res, userId } = await requireUser();
  if (res || !userId) return res!;
  const sb = getServerClient();
  try {
    const { holderUserId, isMember } = await resolveAccountHolder(sb, userId);
    if (isMember) {
      // A member has no team of their own to manage; the card renders nothing.
      return NextResponse.json({ eligible: false, reason: 'member' });
    }
    const { data: acct } = await sb.from('accounts')
      .select('id, name').eq('owner_user_id', holderUserId).maybeSingle();
    if (!acct) return NextResponse.json({ eligible: false, reason: 'no_account' });
    const accountId = (acct as { id: string }).id;
    const [seats, invites] = await Promise.all([
      inviteSeatState(sb, holderUserId, accountId),
      listOpenInvites(sb, accountId),
    ]);
    // EVERY holder is eligible to see their team surface (the Team tab shows
    // for Pro too); only a member is not. Whether they can INVITE is the seat
    // arithmetic, computed here with the SAME rule the create enforces, so
    // the upgrade prompt and the 409 can never disagree.
    const canInvite = seats.isPlatformAdmin
      || seatsAllow(seats.used + seats.reserved + 1, seats.limit);
    return NextResponse.json({
      eligible: true,
      canInvite,
      accountName: (acct as { name: string }).name,
      seats: { used: seats.used, reserved: seats.reserved, limit: seats.limit },
      invites,
    });
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 500 });
  }
}

export async function POST(req: NextRequest) {
  const { res, userId } = await requireUser();
  if (res || !userId) return res!;
  let body: { email?: string };
  try { body = await req.json(); } catch { return NextResponse.json({ error: 'Body must be valid JSON.' }, { status: 400 }); }
  const sb = getServerClient();
  const result = await createAccountInvite(sb, userId, body.email ?? '', APP_URL);
  if (!result.ok) {
    const status =
      result.code === 'not_holder' ? 403 :
      result.code === 'seat_limit' ? 409 :
      result.code === 'existing_user' ? 409 :
      result.code === 'bad_email' ? 400 : 500;
    return NextResponse.json({ error: result.error, code: result.code }, { status });
  }
  return NextResponse.json({ ok: true, email: result.email, expiresAt: result.expiresAt });
}

export async function DELETE(req: NextRequest) {
  const { res, userId } = await requireUser();
  if (res || !userId) return res!;
  const id = new URL(req.url).searchParams.get('id');
  if (!id) return NextResponse.json({ error: 'id is required.' }, { status: 400 });
  const sb = getServerClient();
  const result = await revokeAccountInvite(sb, userId, id);
  if (!result.ok) return NextResponse.json({ error: result.error }, { status: 400 });
  return NextResponse.json({ ok: true });
}
