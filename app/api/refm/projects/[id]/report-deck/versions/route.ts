/**
 * /api/refm/projects/[id]/report-deck/versions (Module 7, migration 207)
 *
 *   GET  -> { versions, currentVersionId, available }. Metadata only, never the
 *           deck payloads, so listing stays cheap however large a deck grows.
 *           `available: false` means migration 207 is outstanding; the client
 *           hides the version UI rather than showing broken controls.
 *   POST -> save the posted deck as a NEW version and point the working deck at
 *           it. Body: { deck, label?, comment? }. `label` is optional: left out,
 *           the version is auto-named server-side
 *           ({Project}_Presentation_v1.3_08032026), mirroring the model version
 *           naming so saving a presentation never stops to ask for a name.
 *
 * This mirrors /api/refm/projects/[id]/versions (the project snapshot history):
 * append-only rows, a monotonic per-project number assigned server-side, and a
 * current-version pointer bumped on save.
 *
 * Auth + ownership + the read-only grace gate are identical to the report-deck
 * route: a lapsed or grace user may LIST versions but not create one.
 *
 * Presentation only. The deck holds binding keys, so a saved version records
 * layout and narrative, not figures; loading an old version still resolves its
 * numbers against the current model.
 *
 * No em dashes in this file.
 */

import { NextRequest, NextResponse } from 'next/server';
import { getProject, getProjectForWrite } from '@/src/hubs/modeling/platforms/refm/lib/persistence/server';
import type { Permission } from '@/src/core/collab/projectRoles';
import { listDeckVersions, saveDeckVersion, coerceDeck } from '@/src/hubs/modeling/platforms/refm/lib/persistence/deck-server';
import { getRefmUserId, getRefmUserContext } from '@/src/hubs/modeling/platforms/refm/lib/persistence/auth';
import { resolveUserGate } from '@/src/shared/entitlements/resolveUser';
import { writeBlockReason } from '@/src/shared/entitlements/gate';

function unauthorized() { return NextResponse.json({ error: 'Unauthorized' }, { status: 401 }); }
function notFound() { return NextResponse.json({ error: 'Not found' }, { status: 404 }); }
function serverError(msg: string) { return NextResponse.json({ error: msg }, { status: 500 }); }

async function requireOwnedProject(id: string): Promise<{ userId: string } | NextResponse> {
  const userId = await getRefmUserId();
  if (!userId) return unauthorized();
  const { row, error } = await getProject(userId, id);
  if (error) return serverError(error);
  if (!row) return notFound();
  return { userId };
}

/**
 * The WRITE variant (Module 10 step 2). Same shape, but resolved through
 * `getProjectForWrite`, which returns nothing to a member who may only read,
 * so a Reviewer gets the same 404 a stranger would.
 *
 * A SEPARATE helper rather than a flag on the one above, because both verbs
 * share that one: narrowing it in place would have stopped a Reviewer reading
 * a project they are legitimately a member of. Reads keep the old helper.
 */
/** `need` is passed IN rather than hardcoded, so a handler declares the
 *  permission it requires and the matrix answers. A blanket helper would
 *  give every verb in the file the same rights, which is how a delete ends
 *  up gated as an edit. */
async function requireWritableProject(id: string, need: Permission): Promise<{ userId: string } | NextResponse> {
  const userId = await getRefmUserId();
  if (!userId) return unauthorized();
  const { row, error } = await getProjectForWrite(userId, id, need);
  if (error) return serverError(error);
  if (!row) return notFound();
  return { userId };
}

const today = (): string => new Date().toISOString().slice(0, 10);

async function assertDeckWriteAllowed(): Promise<NextResponse | null> {
  const { userId, isAdmin } = await getRefmUserContext();
  if (!userId) return unauthorized();
  const gate = await resolveUserGate(userId, { sessionIsAdmin: isAdmin });
  const block = writeBlockReason(gate);
  if (!block) return null;
  return NextResponse.json(
    {
      error: block === 'LAPSED'
        ? 'Your subscription has lapsed. Renew your plan to save presentation versions.'
        : 'Your subscription has expired. Access is read-only during the grace period, renew to save presentation versions.',
      code: block,
      accessExpiresAt: gate.accessExpiresAt,
      graceEndsAt: gate.graceEndsAt,
      planKey: gate.planKey,
    },
    { status: 403 },
  );
}

export async function GET(_req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  const owned = await requireOwnedProject(id);
  if (owned instanceof NextResponse) return owned;

  const { versions, currentVersionId, available, error } = await listDeckVersions(id);
  if (error) return serverError(error);
  return NextResponse.json({ versions, currentVersionId, available });
}

export async function POST(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  const blocked = await assertDeckWriteAllowed();
  if (blocked) return blocked;
  const owned = await requireWritableProject(id, 'canManageVersions');
  if (owned instanceof NextResponse) return owned;

  const body = await req.json().catch(() => null) as { deck?: unknown; label?: unknown; comment?: unknown } | null;

  // A name is OPTIONAL. An omitted one is generated in saveDeckVersion, on the
  // same pattern the model versions use, so a save never has to stop and ask.
  // Naming there rather than here keeps one namer for every caller.
  const label = typeof body?.label === 'string' ? body.label.trim() : '';

  // The posted deck is re-validated, never trusted as jsonb.
  const deck = coerceDeck(body?.deck, id, today());
  if (!deck) return NextResponse.json({ error: 'A deck with at least one slide is required.' }, { status: 400 });

  const comment = typeof body?.comment === 'string' ? body.comment : null;
  const { version, error } = await saveDeckVersion(id, deck, label || null, comment);
  if (error) return serverError(error);
  return NextResponse.json({ version });
}
