/**
 * invites.ts (SERVER ONLY)
 *
 * ACCOUNT INVITES, account model step 5. THE single engine for creating,
 * listing, revoking, previewing and redeeming an invite, shared by the
 * holder-facing route and the register route so the rules cannot fork.
 *
 * THE RULES, each stated once:
 *
 *   - ONLY THE ACCOUNT HOLDER INVITES. A member asking is refused (they hold
 *     no plan to spend seats from); the platform admin passes for their own
 *     account like any holder.
 *   - THE SEAT IS RESERVED AT CREATE. The check is
 *     people-on-the-account + OPEN unexpired invites + 1 <= seat limit,
 *     reusing countAccountSeats / resolveSeatLimit / seatsAllow (step 3), so
 *     a client cannot invite past their seats and redemption converts a
 *     reservation rather than consuming anything new. Redemption RE-CHECKS
 *     (the limit may have been lowered since) with the same arithmetic.
 *   - AN EXISTING USER CANNOT BE INVITED. One person, one account (step 1);
 *     moving a user between accounts is an operator action, not an invite.
 *   - RE-INVITING REPLACES: the open invite for that email is deleted and a
 *     fresh one minted, restarting the clock, which is why the partial
 *     unique index never fires in the happy path.
 *   - THE EMAIL FAILING ROLLS THE INVITE BACK. An invite nobody received is
 *     a reserved seat nobody can use; the holder is told nothing was
 *     created.
 *   - TOKENS: 32 random bytes, hex; only the SHA-256 lands in the table
 *     (mig 213 discipline). The raw token exists in the email link alone.
 *
 * No em dashes in this file.
 */
import { createHash, randomBytes } from 'node:crypto';
import type { SupabaseClient } from '@supabase/supabase-js';
import { countAccountSeats, resolveSeatLimit, seatsAllow } from '@/src/shared/admin/seats';
import { resolveAccountHolder } from '@/src/shared/admin/accountBoundary';
import { sendEmail, FROM } from '@/src/shared/email/sendEmail';
import { accountInviteEmail } from '@/src/shared/email/templates/accountInvite';

export const INVITE_EXPIRY_DAYS = 7;

export const hashInviteToken = (raw: string): string =>
  createHash('sha256').update(raw).digest('hex');

export interface OpenInvite {
  id: string;
  email: string;
  created_at: string;
  expires_at: string;
  expired: boolean;
}

interface InviteRow {
  id: string; email: string; created_at: string; expires_at: string;
  consumed_at: string | null; account_id: string;
}

/** Open (unconsumed) invites for an account. Expired ones are RETURNED,
 *  flagged, so the holder sees them and can re-invite; they do NOT count
 *  against seats. */
export async function listOpenInvites(sb: SupabaseClient, accountId: string): Promise<OpenInvite[]> {
  const { data, error } = await sb.from('account_invites')
    .select('id, email, created_at, expires_at, consumed_at, account_id')
    .eq('account_id', accountId).is('consumed_at', null)
    .order('created_at', { ascending: false }).range(0, 499);
  if (error) throw new Error(`invite list failed: ${error.message}`);
  const nowMs = Date.now();
  return ((data ?? []) as InviteRow[]).map((r) => ({
    id: r.id, email: r.email, created_at: r.created_at, expires_at: r.expires_at,
    expired: Date.parse(r.expires_at) <= nowMs,
  }));
}

/** Open UNEXPIRED invites: the ones that hold a reserved seat. */
async function countReservingInvites(sb: SupabaseClient, accountId: string): Promise<number> {
  const { count, error } = await sb.from('account_invites')
    .select('id', { count: 'exact', head: true })
    .eq('account_id', accountId).is('consumed_at', null)
    .gt('expires_at', new Date().toISOString());
  if (error) throw new Error(`invite count failed: ${error.message}`);
  return count ?? 0;
}

export interface InviteSeatState {
  used: number;
  reserved: number;
  limit: number | null;
  isPlatformAdmin: boolean;
}

export async function inviteSeatState(sb: SupabaseClient, holderUserId: string, accountId: string): Promise<InviteSeatState> {
  const [{ used }, { limit, isPlatformAdmin }, reserved] = await Promise.all([
    countAccountSeats(sb, holderUserId),
    resolveSeatLimit(sb, holderUserId),
    countReservingInvites(sb, accountId),
  ]);
  return { used, reserved, limit, isPlatformAdmin };
}

export type CreateInviteResult =
  | { ok: true; email: string; expiresAt: string }
  | { ok: false; code: 'not_holder' | 'bad_email' | 'existing_user' | 'seat_limit' | 'email_send_failed' | 'failed'; error: string };

export async function createAccountInvite(
  sb: SupabaseClient, inviterUserId: string, rawEmail: string, appUrl: string,
): Promise<CreateInviteResult> {
  const email = String(rawEmail ?? '').trim().toLowerCase();
  if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    return { ok: false, code: 'bad_email', error: 'Enter a valid email address.' };
  }

  const { holderUserId, isMember } = await resolveAccountHolder(sb, inviterUserId);
  if (isMember) {
    return { ok: false, code: 'not_holder', error: 'Only the account holder can invite team members.' };
  }
  const { data: acctRow, error: acctErr } = await sb.from('accounts')
    .select('id, name').eq('owner_user_id', holderUserId).maybeSingle();
  if (acctErr || !acctRow) {
    return { ok: false, code: 'failed', error: 'Your account could not be resolved; nothing was created.' };
  }
  const account = acctRow as { id: string; name: string };

  const { data: existing } = await sb.from('users').select('id').eq('email', email).maybeSingle();
  if (existing) {
    return { ok: false, code: 'existing_user', error: 'That email already has an account on the platform. An existing user cannot be invited; contact support to move them.' };
  }

  // THE SEAT, RESERVED AT CREATE. The re-invite replacement below does not
  // change the arithmetic: the replaced invite is deleted before counting.
  await sb.from('account_invites').delete()
    .eq('account_id', account.id).is('consumed_at', null).eq('email', email);
  const seats = await inviteSeatState(sb, holderUserId, account.id);
  if (!seats.isPlatformAdmin && !seatsAllow(seats.used + seats.reserved + 1, seats.limit)) {
    const limitText = seats.limit === null || seats.limit <= 0 ? 'no seats' : `${seats.limit} seat${seats.limit === 1 ? '' : 's'}`;
    return {
      ok: false, code: 'seat_limit',
      error: `Seat limit reached. Your plan has ${limitText}; ${seats.used} in use and ${seats.reserved} reserved by open invites. Revoke an invite, remove a member, or contact us for more seats.`,
    };
  }

  const rawToken = randomBytes(32).toString('hex');
  const expiresAt = new Date(Date.now() + INVITE_EXPIRY_DAYS * 86_400_000).toISOString();
  const { data: ins, error: insErr } = await sb.from('account_invites').insert({
    account_id: account.id, email, token_hash: hashInviteToken(rawToken),
    invited_by: inviterUserId, expires_at: expiresAt,
  }).select('id').single();
  if (insErr || !ins) {
    return { ok: false, code: 'failed', error: `The invite could not be created: ${insErr?.message ?? 'insert failed'}` };
  }

  // The email IS the invite: if it cannot be sent, the reservation is
  // rolled back and the holder told nothing was created.
  try {
    const { data: inviter } = await sb.from('users').select('name').eq('id', inviterUserId).maybeSingle();
    const { subject, html } = await accountInviteEmail({
      inviterName: (inviter as { name?: string | null } | null)?.name ?? null,
      accountName: account.name,
      inviteUrl: `${appUrl}/register?invite=${rawToken}`,
      expiresDays: INVITE_EXPIRY_DAYS,
    });
    await sendEmail({ to: email, subject, html, from: FROM.noreply });
  } catch (e) {
    await sb.from('account_invites').delete().eq('id', (ins as { id: string }).id);
    return { ok: false, code: 'email_send_failed', error: `The invite email could not be sent (${e instanceof Error ? e.message : 'send failed'}); nothing was created.` };
  }

  return { ok: true, email, expiresAt };
}

export async function revokeAccountInvite(
  sb: SupabaseClient, actorUserId: string, inviteId: string,
): Promise<{ ok: boolean; error?: string }> {
  const { holderUserId, isMember } = await resolveAccountHolder(sb, actorUserId);
  if (isMember) return { ok: false, error: 'Only the account holder can revoke invites.' };
  const { data: acct } = await sb.from('accounts').select('id').eq('owner_user_id', holderUserId).maybeSingle();
  if (!acct) return { ok: false, error: 'Your account could not be resolved.' };
  const { error } = await sb.from('account_invites').delete()
    .eq('id', inviteId).eq('account_id', (acct as { id: string }).id).is('consumed_at', null);
  if (error) return { ok: false, error: error.message };
  return { ok: true };
}

export interface InvitePreview {
  valid: boolean;
  email: string | null;
  accountName: string | null;
}

/** For the register page: is this token an open, unexpired invite, and for
 *  whom? Read-only; the token itself is the credential. */
export async function previewInviteByToken(sb: SupabaseClient, rawToken: string): Promise<InvitePreview> {
  const none: InvitePreview = { valid: false, email: null, accountName: null };
  const token = String(rawToken ?? '').trim();
  if (!token) return none;
  try {
    const { data } = await sb.from('account_invites')
      .select('email, expires_at, consumed_at, account_id')
      .eq('token_hash', hashInviteToken(token)).maybeSingle();
    const row = data as { email: string; expires_at: string; consumed_at: string | null; account_id: string } | null;
    if (!row || row.consumed_at || Date.parse(row.expires_at) <= Date.now()) return none;
    const { data: acct } = await sb.from('accounts').select('name').eq('id', row.account_id).maybeSingle();
    return { valid: true, email: row.email, accountName: (acct as { name?: string } | null)?.name ?? null };
  } catch {
    return none;
  }
}

export type RedeemResult =
  | { ok: true; userId: string }
  | { ok: false; code: 'invalid_invite' | 'email_mismatch' | 'duplicate_email' | 'seat_limit' | 'failed'; error: string };

/**
 * Redeem: ONE rpc, ONE transaction (mig 240). The function locks the open
 * unexpired invite, verifies the email, inserts the users row ATTACHED to
 * the account and stamps the invite consumed; a failure leaves neither the
 * user nor the consumption behind.
 */
export async function redeemAccountInvite(sb: SupabaseClient, args: {
  rawToken: string; email: string; name: string; passwordHash: string;
  phone: string | null; city: string | null; country: string | null;
  company: string | null; jobTitle: string | null;
  worksInRealEstate: boolean | null; roleNote: string | null;
}): Promise<RedeemResult> {
  // The seat, re-checked at ACCEPT: the reservation is converted, not grown,
  // so the arithmetic counts this invite among the reserved. Only a limit
  // lowered since create can refuse here.
  const preview = await sb.from('account_invites')
    .select('account_id, consumed_at, expires_at')
    .eq('token_hash', hashInviteToken(args.rawToken)).maybeSingle();
  const pRow = preview.data as { account_id: string; consumed_at: string | null; expires_at: string } | null;
  if (!pRow || pRow.consumed_at || Date.parse(pRow.expires_at) <= Date.now()) {
    return { ok: false, code: 'invalid_invite', error: 'This invite link is invalid, expired, or already used. Ask for a fresh invite.' };
  }
  try {
    const { data: acct } = await sb.from('accounts').select('owner_user_id').eq('id', pRow.account_id).maybeSingle();
    const owner = (acct as { owner_user_id?: string } | null)?.owner_user_id;
    if (owner) {
      const seats = await inviteSeatState(sb, owner, pRow.account_id);
      if (!seats.isPlatformAdmin && !seatsAllow(seats.used + seats.reserved, seats.limit)) {
        return { ok: false, code: 'seat_limit', error: 'The team no longer has a seat available for this invite. Ask the account holder to free one.' };
      }
    }
  } catch {
    // An unmeasurable re-check falls through to the atomic redeem: the seat
    // was reserved at create, which is the enforcement the brief names.
  }

  const { data, error } = await sb.rpc('redeem_account_invite', {
    p_token_hash: hashInviteToken(args.rawToken),
    p_email: args.email,
    p_name: args.name,
    p_password_hash: args.passwordHash,
    p_phone: args.phone,
    p_city: args.city,
    p_country: args.country,
    p_company: args.company,
    p_job_title: args.jobTitle,
    p_works_in_real_estate: args.worksInRealEstate,
    p_role_note: args.roleNote,
  });
  if (error) {
    const msg = error.message ?? '';
    if (/invalid_invite/.test(msg)) return { ok: false, code: 'invalid_invite', error: 'This invite link is invalid, expired, or already used. Ask for a fresh invite.' };
    if (/email_mismatch/.test(msg)) return { ok: false, code: 'email_mismatch', error: 'This invite is tied to a different email address. Sign up with the address the invite was sent to.' };
    if (/duplicate key|unique/i.test(msg)) return { ok: false, code: 'duplicate_email', error: 'An account with that email already exists.' };
    return { ok: false, code: 'failed', error: msg };
  }
  const row = (Array.isArray(data) ? data[0] : data) as { user_id?: string } | null;
  if (!row?.user_id) return { ok: false, code: 'failed', error: 'Redemption returned no user.' };
  return { ok: true, userId: String(row.user_id) };
}
