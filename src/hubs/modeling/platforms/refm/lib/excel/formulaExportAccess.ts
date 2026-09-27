/**
 * formulaExportAccess.ts (2026-09-27), SERVER ONLY.
 *
 * WHO MAY EXPORT THE FORMULA-LINKED WORKBOOK WHILE IT IS BEING BUILT.
 *
 * The founder's decision: while the live workbook is built in stages, only the
 * founder's own account sees the option or can obtain the file. The rule is
 * enforced HERE, on the server, by the route that builds the file (the
 * workbook is built server side for exactly this reason, so its code never
 * reaches another user's browser); the Export dialog only asks this route
 * whether to show the option, and a request from anyone else is refused even
 * if they find the URL.
 *
 * The account is matched on the LIVE users row's email, never on the session
 * token, so a stale or forged claim cannot pass it.
 *
 * WHEN IT IS OPENED UP (the founder will say so), this becomes a plan
 * entitlement like the other exports: `featureAllowed(gate, 'excel_formula')`
 * (the feature key already exists and is `included: false` on every plan),
 * and the preview list below is deleted, not extended.
 *
 * No em dashes in this file.
 */
import { getServerClient } from '@/src/core/db/supabase';

/** The accounts that may use the preview, by email. Compared case-insensitively. */
export const FORMULA_EXPORT_PREVIEW_EMAILS: readonly string[] = ['meetahmadch@gmail.com'];

/** The pure decision, so a verifier can run it without a database. */
export function formulaExportAllowedFor(email: string | null | undefined): boolean {
  if (!email) return false;
  const e = email.trim().toLowerCase();
  return FORMULA_EXPORT_PREVIEW_EMAILS.some((x) => x.toLowerCase() === e);
}

/** Reads the caller's email from the live users row. Any failure REFUSES. */
export async function formulaExportAllowed(userId: string | null | undefined): Promise<boolean> {
  if (!userId) return false;
  try {
    const { data, error } = await getServerClient().from('users').select('email').eq('id', userId).maybeSingle();
    if (error || !data) return false;
    return formulaExportAllowedFor((data as { email?: string | null }).email);
  } catch {
    return false;
  }
}
