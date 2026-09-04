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

export interface AccountCandidate {
  id: string;
  name: string | null;
  email: string;
  role: string | null;
}

/**
 * Who may be OFFERED for a project owned by this holder: the SAME rule as the
 * check above, evaluated as a list, so the dropdown never offers a person the
 * write would refuse.
 *
 *   - owner is a platform admin -> everyone (the owner_admin exemption);
 *   - otherwise the owner's account plus every platform admin (the
 *     candidate_admin exemption);
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

  // account_id comes from the database row, never from user input, so the
  // PostgREST or() filter is built from trusted values only.
  const q = owner.account_id
    ? sb.from('users').select('id, name, email, role')
        .or(`account_id.eq.${owner.account_id},role.eq.admin`).order('email')
    : sb.from('users').select('id, name, email, role').eq('role', 'admin').order('email');
  const { data, error } = await q;
  if (error) throw new Error(`candidate listing failed: ${error.message}`);
  return { candidates: (data ?? []) as AccountCandidate[], scoped: true };
}
