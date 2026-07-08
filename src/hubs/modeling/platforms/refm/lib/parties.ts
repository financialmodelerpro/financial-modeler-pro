/**
 * parties.ts (REFM Module 1)
 *
 * Shared constants + type for the per-project Parties feature (migration 190).
 * Identity data ONLY: the model engine never reads parties, and they live in a
 * dedicated `refm_parties` table outside the version snapshot. Imported by both
 * the client tab and the server API route, so it must stay free of client- or
 * server-only imports.
 *
 * No em dashes in this file.
 */

/** Fixed role set. A party carries one or more of these. */
export const PARTY_ROLES = [
  'Sponsor',
  'Developer',
  'Investor/Equity Partner',
  'Advisor',
  'Lender',
  'Prepared-by',
  'Contact',
  'Other',
] as const;

export type PartyRole = typeof PARTY_ROLES[number];

export interface Party {
  id: string;
  name: string;
  identifier: string | null;
  roles: string[];
  display_order: number;
}

/** Keep only recognized roles, deduped, in the canonical PARTY_ROLES order. */
export function sanitizeRoles(input: unknown): string[] {
  const arr = Array.isArray(input) ? input.map(String) : [];
  const set = new Set(arr);
  return PARTY_ROLES.filter((r) => set.has(r));
}
