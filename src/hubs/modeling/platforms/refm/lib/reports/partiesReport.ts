/**
 * partiesReport.ts (2026-09-17)
 *
 * THE PARTIES TABLE, ONE BUILDER for the Excel workbook and the PDF report, so
 * both print Module 1 tab 2 the way the screen lists it: the name, the optional
 * identifier and the roles in the canonical PARTY_ROLES order.
 *
 * Parties live outside the version snapshot (their own table, loaded through
 * /api/refm/projects/[id]/parties), so an export receives them from the caller
 * rather than from the model. The engine never reads them.
 *
 * Pure. No em dashes in this file.
 */
import { PARTY_ROLES, type Party } from '../parties';

export interface PartiesTable {
  columns: string[];
  rows: string[][];
}

export const PARTIES_TITLE = 'Parties';
export const PARTIES_EMPTY_TEXT = 'No parties entered.';

export function buildPartiesTable(parties: readonly Party[] | null | undefined): PartiesTable {
  const list = [...(parties ?? [])].sort((a, b) => (a.display_order ?? 0) - (b.display_order ?? 0));
  return {
    columns: ['Party', 'Identifier', 'Roles'],
    rows: list.map((p) => [
      p.name,
      p.identifier ?? '',
      PARTY_ROLES.filter((r) => (p.roles ?? []).includes(r)).join(', '),
    ]),
  };
}
