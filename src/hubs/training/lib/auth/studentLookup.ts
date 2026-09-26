/**
 * studentLookup.ts (2026-09-26)
 *
 * The ONE rule for "which Training Hub student is this?" when someone has
 * forgotten something, used by the password reset (send the code, set the
 * password) and by "forgot my Registration ID".
 *
 * Why it exists. Measured 2026-09-26 over seven days: of 13 reset and
 * forgot-ID requests, 11 were refused BEFORE any email was sent (send-
 * verification 2 of 3 answered 401, resend-id 9 of 10 answered 400). Students
 * reported "I never get the email"; there was no email. The reset form
 * required the Registration ID AND the email and compared them exactly, so a
 * student who had forgotten their password and typed their ID in lowercase,
 * or did not remember it, got nothing; and an email on two accounts read as
 * "not found".
 *
 * THE RULES:
 *   - Input is normalised: email trimmed and lowercased, Registration ID
 *     trimmed and uppercased (stored data is already in that form, measured).
 *   - The email ALONE identifies a student when it is on exactly one account.
 *     On more than one, the Registration ID picks which; without it the
 *     answer is "ambiguous", and the page asks for the ID.
 *   - A Registration ID with an email must belong to that email.
 *   - Whatever is typed, anything sent goes to the email ON FILE, and a
 *     password is set only for the account that email belongs to.
 *
 * No em dashes in this file.
 */
import type { SupabaseClient } from '@supabase/supabase-js';

export interface StudentRow { registration_id: string; email: string; name?: string | null }

export type StudentLookup =
  | { ok: true; student: StudentRow; accounts: number }
  | { ok: false; reason: 'missing_input' | 'not_found' | 'ambiguous' | 'mismatch'; accounts: number };

export const normEmail = (s: unknown): string => (typeof s === 'string' ? s.trim().toLowerCase() : '');
export const normRegId = (s: unknown): string => (typeof s === 'string' ? s.trim().toUpperCase() : '');

/** Pure: decide from the rows that match the email or the Registration ID. */
export function resolveStudent(rows: StudentRow[], input: { email?: unknown; registrationId?: unknown }): StudentLookup {
  const email = normEmail(input.email);
  const regId = normRegId(input.registrationId);
  if (!email && !regId) return { ok: false, reason: 'missing_input', accounts: 0 };
  const forEmail = email ? rows.filter((r) => normEmail(r.email) === email) : [];
  if (regId) {
    const row = rows.find((r) => normRegId(r.registration_id) === regId);
    if (!row) return { ok: false, reason: 'not_found', accounts: forEmail.length };
    if (email && normEmail(row.email) !== email) return { ok: false, reason: 'mismatch', accounts: forEmail.length };
    return { ok: true, student: row, accounts: Math.max(1, forEmail.length) };
  }
  if (forEmail.length === 0) return { ok: false, reason: 'not_found', accounts: 0 };
  if (forEmail.length > 1) return { ok: false, reason: 'ambiguous', accounts: forEmail.length };
  return { ok: true, student: forEmail[0], accounts: 1 };
}

/** Every account on one email (for "forgot my Registration ID"). */
export async function accountsForEmail(sb: SupabaseClient, email: string): Promise<StudentRow[]> {
  const { data, error } = await sb
    .from('training_registrations_meta')
    .select('registration_id, email, name')
    .eq('email', normEmail(email))
    .order('created_at', { ascending: true });
  if (error) throw new Error(error.message);
  return (data ?? []) as StudentRow[];
}

/** Read the candidate rows, then decide with resolveStudent. */
export async function lookupStudent(sb: SupabaseClient, input: { email?: unknown; registrationId?: unknown }): Promise<StudentLookup> {
  const email = normEmail(input.email);
  const regId = normRegId(input.registrationId);
  const rows: StudentRow[] = [];
  if (email) rows.push(...await accountsForEmail(sb, email));
  if (regId && !rows.some((r) => r.registration_id === regId)) {
    const { data, error } = await sb.from('training_registrations_meta')
      .select('registration_id, email, name').eq('registration_id', regId).maybeSingle();
    if (error) throw new Error(error.message);
    if (data) rows.push(data as StudentRow);
  }
  return resolveStudent(rows, { email, registrationId: regId });
}

/** "a***@gmail.com": enough for a student to recognise, not enough to harvest. */
export function maskEmail(email: string): string {
  const [local, domain] = normEmail(email).split('@');
  if (!local || !domain) return 'your registered email';
  return `${local.slice(0, Math.min(2, local.length))}***@${domain}`;
}

/** The words a student sees for each refusal: what to do next, never a dead end. */
export const LOOKUP_MESSAGES: Record<Exclude<StudentLookup, { ok: true }>['reason'], string> = {
  missing_input: 'Enter the email address you registered with.',
  not_found: 'We could not find a Training Hub account with those details. Use the email address you registered with, or contact support@financialmodelerpro.com.',
  ambiguous: 'This email has more than one Training Hub account. Enter the Registration ID of the account you want (it is in your registration email, or use "Forgot my Registration ID").',
  // Deliberately the same words as not_found: saying "that ID belongs to another
  // email" would confirm the ID exists to whoever typed it.
  mismatch: 'We could not find a Training Hub account with those details. Use the email address you registered with, or contact support@financialmodelerpro.com.',
};
