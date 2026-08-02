/**
 * /api/refm/projects/[id]/report-deck/versions (Module 7, migration 207)
 *
 *   GET  -> { versions, currentVersionId, available }. Metadata only, never the
 *           deck payloads, so listing stays cheap however large a deck grows.
 *           `available: false` means migration 207 is outstanding; the client
 *           hides the version UI rather than showing broken controls.
 *   POST -> save the posted deck as a NEW named version and point the working
 *           deck at it. Body: { deck, label, comment? }.
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
import { getProject } from '@/src/hubs/modeling/platforms/refm/lib/persistence/server';
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
  const owned = await requireOwnedProject(id);
  if (owned instanceof NextResponse) return owned;

  const body = await req.json().catch(() => null) as { deck?: unknown; label?: unknown; comment?: unknown } | null;

  // A version must be named: the whole point is telling saved presentations
  // apart in the list.
  const label = typeof body?.label === 'string' ? body.label.trim() : '';
  if (!label) return NextResponse.json({ error: 'A version name is required.' }, { status: 400 });

  // The posted deck is re-validated, never trusted as jsonb.
  const deck = coerceDeck(body?.deck, id, today());
  if (!deck) return NextResponse.json({ error: 'A deck with at least one slide is required.' }, { status: 400 });

  const comment = typeof body?.comment === 'string' ? body.comment : null;
  const { version, error } = await saveDeckVersion(id, deck, label, comment);
  if (error) return serverError(error);
  return NextResponse.json({ version });
}
