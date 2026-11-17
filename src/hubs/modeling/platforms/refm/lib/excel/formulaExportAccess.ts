/**
 * formulaExportAccess.ts (2026-09-27; opened as a Beta 2026-11-17), SERVER ONLY.
 *
 * WHO MAY EXPORT THE FORMULA-LINKED (LIVE) WORKBOOK.
 *
 * 2026-11-17, founder: "The live workbook download is gated by featureAllowed('excel_formula'): Pro and Firm only,
 * Trial excluded." The one-account preview list is deleted, as this file said it would be when the workbook was
 * opened up: the decision is the plan entitlement, read through the same live gate every other export uses
 * (`resolveUserGate`, which reads the live users row, never the session token). An admin passes through the gate's
 * full access, as everywhere else. Which plans carry `excel_formula` is data (`plan_permissions`, migration 257,
 * and the admin Plan Builder), not code.
 *
 * The rule is enforced HERE, on the server, by the route that builds the live file; the Export dialog only asks the
 * route whether to show the option, and a request from anyone else is refused even if they find the URL.
 *
 * No em dashes in this file.
 */
import { resolveUserGate } from '@/src/shared/entitlements/resolveUser';
import { featureAllowed } from '@/src/shared/entitlements/gate';

/** The entitlement that opens the live workbook. */
export const FORMULA_EXPORT_FEATURE = 'excel_formula';

/** Whether the caller's plan opens the live workbook. Any failure REFUSES. */
export async function formulaExportAllowed(userId: string | null | undefined, sessionIsAdmin = false): Promise<boolean> {
  if (!userId) return false;
  try {
    const gate = await resolveUserGate(userId, { sessionIsAdmin });
    return featureAllowed(gate, FORMULA_EXPORT_FEATURE);
  } catch {
    return false;
  }
}
