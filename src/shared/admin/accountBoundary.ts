/**
 * accountBoundary.ts
 *
 * THE ACCOUNT BOUNDARY, step 2 of the account model (2026-09-04).
 *
 * ONE RULE, STATED ONCE: a person may be attached to a project only when they
 * are on the SAME ACCOUNT as the project's owner. Two exemptions, each
 * deliberate:
 *
 *   - THE CANDIDATE IS A PLATFORM ADMIN. This is the future FMP-advisor shape:
 *     someone from the internal account attached to a client project, never
 *     consuming a client seat. Refusing it would make the operator unable to
 *     open a client's project beside them.
 *   - THE OWNER IS A PLATFORM ADMIN. The standing "admin is never blocked"
 *     rule, applied exactly the way seats.ts applies it: the operator's own
 *     workspace is not rationed. The ACTOR is deliberately NOT tested, because
 *     only admins can reach the member route today and an actor exemption
 *     would make the whole check dead (the same reasoning as the seat limit).
 *
 * What this stops: one client's user reaching another client's project. That
 * was possible until today because POST /api/admin/project-members validated
 * only that the candidate EXISTS, and the only scope was the dropdown, which
 * is not a scope.
 *
 * ── IT LIVES IN shared/admin, BESIDE seats.ts ─────────────────────────────
 *
 * The route enforces it on the write; the candidates listing below uses the
 * SAME rule to say who is offerable, so the dropdown and the refusal can
 * never disagree. A platform gains both by using the shared route, exactly as
 * with seats.
 *
 * ── SCHEMA TOLERANCE (the standing rule: prod may lag the repo) ───────────
 *
 * On a pre-239 database there is no users.account_id and the read errors
 * naming the column: the check then ALLOWS with reason 'pre_migration', which
 * is exactly pre-239 behaviour (no boundary existed). Any OTHER read failure
 * THROWS, and the caller must refuse the write: a boundary that cannot be
 * measured must not become an accidental grant.
 *
 * No em dashes in this file.
 */
import type { SupabaseClient } from '@supabase/supabase-js';

export interface AccountBoundaryDecision {
  allowed: boolean;
  reason: 'same_account' | 'candidate_admin' | 'owner_admin' | 'pre_migration' | 'cross_account';
  ownerAccountId: string | null;
  candidateAccountId: string | null;
}

interface UserRow { id: string; account_id: string | null; role: string | null }

/** True when a PostgREST error means migration 239 is not applied. */
function isPre239(message: string | undefined): boolean {
  return /account_id/i.test(String(message ?? ''));
}

/**
 * May this candidate be attached to a project owned by this account holder?
 *
 * Reads both users rows in one query. A missing row throws rather than
 * guessing: the route has already verified both exist, so a miss here is a
 * race or a data fault, and refusing loudly beats deciding on half the facts.
 */
export async function checkAccountBoundary(
  sb: SupabaseClient, ownerId: string, candidateUserId: string,
): Promise<AccountBoundaryDecision> {
  const { data, error } = await sb.from('users')
    .select('id, account_id, role')
    .in('id', [ownerId, candidateUserId]);
  if (error) {
    if (isPre239(error.message)) {
      return { allowed: true, reason: 'pre_migration', ownerAccountId: null, candidateAccountId: null };
    }
    throw new Error(`account boundary read failed: ${error.message}`);
  }
  const rows = (data ?? []) as UserRow[];
  const owner = rows.find((r) => r.id === ownerId);
  const candidate = rows.find((r) => r.id === candidateUserId);
  if (!owner || !candidate) {
    throw new Error('account boundary read returned incomplete rows');
  }

  const ownerAccountId = owner.account_id ?? null;
  const candidateAccountId = candidate.account_id ?? null;
  const base = { ownerAccountId, candidateAccountId };

  if (candidate.role === 'admin') return { ...base, allowed: true, reason: 'candidate_admin' };
  if (owner.role === 'admin') return { ...base, allowed: true, reason: 'owner_admin' };
  // A NULL on either side post-239 means the invariant broke; the safe answer
  // is the refusing one, and verify-accounts will name the broken row.
  if (ownerAccountId !== null && ownerAccountId === candidateAccountId) {
    return { ...base, allowed: true, reason: 'same_account' };
  }
  return { ...base, allowed: false, reason: 'cross_account' };
}

/** The refusal, in words, for the OPERATOR (the only caller today). */
export function accountBoundaryMessage(
  candidateEmail: string | null, ownerEmail: string | null,
): string {
  const cand = candidateEmail ?? 'This user';
  const owner = ownerEmail ?? "the project owner's";
  return (
    `Different account. ${cand} is not on ${owner === "the project owner's" ? owner : `${owner}'s`} account, ` +
    `and one client's people are never attached to another client's project. ` +
    `A platform admin can be added to any project; anyone else must be on the owning account first.`
  );
}

/**
 * THE one place that answers "whose plan pays for this person" (account model
 * step 4). A MEMBER is a user whose account belongs to someone else: they
 * inherit the HOLDER's plan, lapse and grace, and hold no project allowance
 * of their own. Every surface that needs the billing identity goes through
 * `resolveUserGate`, which calls THIS; no call site resolves the member
 * instead of the holder, because that is the failure that shows a paying
 * client's colleague the request-access storefront.
 *
 * Fails toward SELF: on a pre-239 database, a missing account row, or any
 * read error, the person is their own billing identity, which is exactly
 * pre-239 behaviour and denies rather than grants (a member misread as self
 * has plan 'none').
 */
export async function resolveAccountHolder(
  sb: SupabaseClient, userId: string,
): Promise<{ holderUserId: string; isMember: boolean }> {
  const self = { holderUserId: userId, isMember: false };
  const { data: u, error: uErr } = await sb.from('users')
    .select('account_id').eq('id', userId).maybeSingle();
  if (uErr || !u) return self;
  const accountId = (u as { account_id?: string | null }).account_id ?? null;
  if (!accountId) return self;
  const { data: acct, error: aErr } = await sb.from('accounts')
    .select('owner_user_id').eq('id', accountId).maybeSingle();
  if (aErr || !acct) return self;
  const holder = (acct as { owner_user_id: string }).owner_user_id;
  return { holderUserId: holder, isMember: holder !== userId };
}

/**
 * The ACCOUNT this user is on (their own, or the one they were invited
 * into). NULL only on a pre-239 database or a broken row; callers treat
 * that as "no account scope" and fail soft. Account-scoped surfaces (the
 * cost catalog) read the id through THIS helper so users.account_id keeps
 * exactly one reading path per rule.
 */
export async function resolveAccountId(sb: SupabaseClient, userId: string): Promise<string | null> {
  try {
    const { data } = await sb.from('users').select('account_id').eq('id', userId).maybeSingle();
    return ((data as { account_id?: string | null } | null)?.account_id) ?? null;
  } catch {
    return null;
  }
}

/**
 * Of these users, the ones who are MEMBERS of someone else's account: the
 * bulk form of the rule above, for email audiences. A member has no plan BY
 * DESIGN and must never be chased to request access or buy one.
 *
 * Fails toward EMPTY (nobody excluded), which is pre-239 behaviour; the cost
 * of that direction is one unnecessary email, never a lost one.
 */
export async function accountMemberIds(
  sb: SupabaseClient, userIds: string[],
): Promise<Set<string>> {
  const members = new Set<string>();
  if (userIds.length === 0) return members;
  const { data, error } = await sb.from('users')
    .select('id, account_id').in('id', userIds).range(0, 4999);
  if (error) return members;
  const rows = (data ?? []) as Array<{ id: string; account_id: string | null }>;
  const accountIds = [...new Set(rows.map((r) => r.account_id).filter((a): a is string => !!a))];
  if (accountIds.length === 0) return members;
  const { data: accts, error: aErr } = await sb.from('accounts')
    .select('id, owner_user_id').in('id', accountIds).range(0, 4999);
  if (aErr) return members;
  const ownerByAccount = new Map((accts ?? []).map((a) => [
    (a as { id: string }).id, (a as { owner_user_id: string }).owner_user_id,
  ]));
  for (const r of rows) {
    if (!r.account_id) continue;
    const owner = ownerByAccount.get(r.account_id);
    if (owner && owner !== r.id) members.add(r.id);
  }
  return members;
}

export interface AccountCandidate {
  id: string;
  name: string | null;
  email: string;
  role: string | null;
}

/**
 * Who may be OFFERED for a project owned by this holder. Deliberately
 * NARROWER than the check above: the write allows more than the dropdown
 * offers, never the reverse.
 *
 *   - owner is a platform admin -> everyone (the owner_admin exemption;
 *     the operator's own workspace);
 *   - otherwise the owner's account ONLY. Platform admins are NOT offered,
 *     even though the write would accept one (the candidate_admin
 *     exemption): attaching FMP staff to a client project is a deliberate
 *     future service (the advisor), not a standing dropdown option, so the
 *     exemption stays server-side and the list does not advertise it;
 *   - pre-239 database -> everyone, flagged `scoped: false`, which is exactly
 *     the pre-239 dropdown.
 */
export async function listAccountCandidates(
  sb: SupabaseClient, ownerId: string,
): Promise<{ candidates: AccountCandidate[]; scoped: boolean }> {
  const all = () => sb.from('users').select('id, name, email, role').order('email');

  const { data: ownerRow, error: ownerErr } = await sb.from('users')
    .select('id, account_id, role').eq('id', ownerId).maybeSingle();
  if (ownerErr) {
    if (isPre239(ownerErr.message)) {
      const { data, error } = await all();
      if (error) throw new Error(`candidate listing failed: ${error.message}`);
      return { candidates: (data ?? []) as AccountCandidate[], scoped: false };
    }
    throw new Error(`candidate listing failed: ${ownerErr.message}`);
  }
  if (!ownerRow) throw new Error('candidate listing: no such owner');
  const owner = ownerRow as UserRow;

  if (owner.role === 'admin') {
    const { data, error } = await all();
    if (error) throw new Error(`candidate listing failed: ${error.message}`);
    return { candidates: (data ?? []) as AccountCandidate[], scoped: true };
  }

  // A client owner with a NULL account (a broken invariant) is offered
  // nobody, matching the boundary check, which refuses NULL rather than
  // matching NULL to NULL.
  if (!owner.account_id) return { candidates: [], scoped: true };
  const { data, error } = await sb.from('users').select('id, name, email, role')
    .eq('account_id', owner.account_id).order('email');
  if (error) throw new Error(`candidate listing failed: ${error.message}`);
  return { candidates: (data ?? []) as AccountCandidate[], scoped: true };
}
