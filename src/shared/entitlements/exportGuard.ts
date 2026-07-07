/**
 * exportGuard.ts (server)
 *
 * Shared server-side lapse guard for the export API routes (/api/export/pdf,
 * /api/export/excel). It denies export to a read-only GRACE user (plan expired,
 * within the 1-month grace) and a LAPSED user (grace elapsed), so export cannot
 * be obtained by calling the export endpoints directly. Admin and active plans
 * pass.
 *
 * NOTE on enforcement layers: the live app generates the PDF / Excel ENTIRELY
 * client-side (dynamic import of the builders in the browser) and gates there
 * via the resolved entitlement state, so this route guard is defense in depth
 * for the HTTP endpoints (which the fixture scripts call the builder directly,
 * not over HTTP). It never throws: an unauthenticated / errored resolution
 * simply does not block here (the routes are not the live export path), and the
 * gate itself fails closed elsewhere.
 *
 * No em dashes in this file.
 */
import { NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/src/shared/auth/nextauth';
import { resolveUserGate } from './resolveUser';
import { writeBlockReason } from './gate';

/**
 * Returns a 403 NextResponse when the signed-in user is in a read-only grace or
 * lapsed state, or null when export is allowed (admin, active plan, or no
 * session to resolve). The caller short-circuits on a non-null result.
 */
export async function assertExportAllowed(): Promise<NextResponse | null> {
  try {
    const session = await getServerSession(authOptions);
    const u = session?.user as { id?: string; role?: string } | undefined;
    const userId = u?.id;
    if (!userId) return null; // no session to resolve; not the live export path

    const gate = await resolveUserGate(userId, { sessionIsAdmin: u?.role === 'admin' });
    const block = writeBlockReason(gate);
    if (!block) return null;

    return NextResponse.json(
      {
        error: block === 'LAPSED'
          ? 'Your subscription has lapsed. Renew your plan to export.'
          : 'Your subscription has expired. Access is read-only during the grace period, renew to export.',
        code: block,
        accessExpiresAt: gate.accessExpiresAt,
        graceEndsAt: gate.graceEndsAt,
        planKey: gate.planKey,
      },
      { status: 403 },
    );
  } catch {
    // Never block on an unexpected error here; the live client gate is authoritative.
    return null;
  }
}

/**
 * Whether an export payload carries an active project. A "no project open" export
 * would render the empty / default state into a numberless file, so the routes
 * reject when this is false. Pure + defensive: any payload without a non-blank
 * projectName is treated as having no active project.
 */
export function payloadHasActiveProject(payload: unknown): boolean {
  const p = payload as { projectName?: unknown } | null;
  return !!p && typeof p.projectName === 'string' && p.projectName.trim() !== '';
}
