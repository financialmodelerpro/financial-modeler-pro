/**
 * /api/refm/projects/reorder
 *
 *   POST -> persist a MANUAL card order for one status group.
 *
 * Body: { order: Array<{ id: string; sortOrder: number }> }
 *
 * WHY THIS IS ITS OWN ROUTE, and not a field on PATCH /projects/[id].
 *
 * A manual order is a property of a GROUP, not of a card. Patching one card's
 * position would leave every other position to be re-derived, identically, on
 * both the client and the server, and the moment those two derivations
 * disagree the user's page silently reorders itself. So the client sends the
 * whole group's dense 0..n-1 assignment, which is exactly what it is
 * displaying, and the server stores it verbatim.
 *
 * Reordering is WITHIN A GROUP ONLY. This route never touches `status`, so a
 * drag cannot reclassify a project: status is changed from the card's dropdown,
 * deliberately and one card at a time.
 *
 * Ownership is enforced PER ROW inside `reorderProjects` (every update carries
 * an equality on user_id), so a payload naming another user's project id
 * updates nothing. The count of rows actually updated comes back to the caller
 * rather than being discarded, so a partially applied batch is visible instead
 * of reported as success.
 *
 * Auth: NextAuth session required, and the same read-only lapse gate every
 * other write choke point applies.
 *
 * No em dashes in this file.
 */

import { NextRequest, NextResponse } from 'next/server';
import { reorderProjects } from '@/src/hubs/modeling/platforms/refm/lib/persistence/server';
import { getRefmUserContext } from '@/src/hubs/modeling/platforms/refm/lib/persistence/auth';
import { resolveUserGate } from '@/src/shared/entitlements/resolveUser';
import { writeBlockReason } from '@/src/shared/entitlements/gate';

function unauthorized() { return NextResponse.json({ error: 'Unauthorized' }, { status: 401 }); }
function badRequest(msg: string) { return NextResponse.json({ error: msg }, { status: 400 }); }
function serverError(msg: string) { return NextResponse.json({ error: msg }, { status: 500 }); }

/** A group is a handful of cards. The cap is a sanity bound on a client
 *  payload, not a product limit: it is far above any real group and stops an
 *  arbitrarily large body turning into an arbitrarily long write loop. */
const MAX_ORDER_ENTRIES = 500;

export async function POST(req: NextRequest) {
  const { userId, isAdmin } = await getRefmUserContext();
  if (!userId) return unauthorized();

  let body: { order?: Array<{ id?: unknown; sortOrder?: unknown }> };
  try { body = await req.json(); }
  catch { return badRequest('Body must be valid JSON.'); }

  const raw = body.order;
  if (!Array.isArray(raw)) return badRequest('order must be an array of { id, sortOrder }.');
  if (raw.length > MAX_ORDER_ENTRIES) return badRequest(`order may not exceed ${MAX_ORDER_ENTRIES} entries.`);

  // Validate every entry before writing any of them: a batch that is half
  // applied and then rejected leaves an order the user never asked for.
  const order: Array<{ id: string; sortOrder: number }> = [];
  const seen = new Set<string>();
  for (const e of raw) {
    if (typeof e?.id !== 'string' || !e.id) return badRequest('every order entry needs a string id.');
    if (typeof e.sortOrder !== 'number' || !Number.isInteger(e.sortOrder) || e.sortOrder < 0) {
      return badRequest('every order entry needs a non-negative integer sortOrder.');
    }
    // A duplicated id would make the final position depend on write order,
    // which is not something the caller can predict or the user can see.
    if (seen.has(e.id)) return badRequest(`duplicate project id in order: ${e.id}`);
    seen.add(e.id);
    order.push({ id: e.id, sortOrder: e.sortOrder });
  }

  // Read-only grace and lapsed users can VIEW but not WRITE. Enforced here so
  // it cannot be bypassed by calling the API directly; admin bypasses.
  const gate = await resolveUserGate(userId, { sessionIsAdmin: isAdmin });
  const writeBlock = writeBlockReason(gate);
  if (writeBlock) {
    return NextResponse.json(
      {
        error: writeBlock === 'LAPSED'
          ? 'Your subscription has lapsed. Renew your plan to reorder projects.'
          : 'Your plan has expired and your projects are read-only. Renew to reorder them.',
        code: writeBlock,
        planKey: gate.planKey,
      },
      { status: 403 },
    );
  }

  const { updated, error } = await reorderProjects(userId, order);
  if (error) return serverError(error);
  // `updated` is reported, not asserted: an id the user does not own, or one
  // deleted between render and drop, updates nothing, and the client can tell.
  return NextResponse.json({ updated, requested: order.length });
}
