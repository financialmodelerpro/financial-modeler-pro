/**
 * /api/refm/projects/[id]/report-deck/versions/[versionId] (Module 7, migration 207)
 *
 *   GET    -> { deck } for one saved version, validated through coerceDeck. The
 *             client loads it over the working deck as an ordinary undoable
 *             edit, so a load is recoverable with Ctrl+Z and still needs Save.
 *   DELETE -> remove one saved version. The working deck is untouched: the FK
 *             is ON DELETE SET NULL, so only the pointer clears.
 *
 * Both are scoped by project_id as well as version id, so a version id from
 * another project cannot be read or deleted through this route even if guessed.
 *
 * No em dashes in this file.
 */

import { NextRequest, NextResponse } from 'next/server';
import { getProject, getProjectForWrite } from '@/src/hubs/modeling/platforms/refm/lib/persistence/server';
import { getDeckVersion, deleteDeckVersion, updateDeckVersion, coerceDeck } from '@/src/hubs/modeling/platforms/refm/lib/persistence/deck-server';
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
async function requireWritableProject(id: string): Promise<{ userId: string } | NextResponse> {
  const userId = await getRefmUserId();
  if (!userId) return unauthorized();
  const { row, error } = await getProjectForWrite(userId, id);
  if (error) return serverError(error);
  if (!row) return notFound();
  return { userId };
}

const today = (): string => new Date().toISOString().slice(0, 10);

export async function GET(_req: NextRequest, ctx: { params: Promise<{ id: string; versionId: string }> }) {
  const { id, versionId } = await ctx.params;
  const owned = await requireOwnedProject(id);
  if (owned instanceof NextResponse) return owned;

  const { deck, error } = await getDeckVersion(id, versionId, today());
  if (error) return serverError(error);
  if (!deck) return notFound();
  return NextResponse.json({ deck });
}

/**
 * PATCH -> overwrite this saved version's document with the posted deck, the
 * deck equivalent of the platform's "edit this version in place". The working
 * deck is saved in the same call so the two cannot diverge. version_number and
 * created_at are preserved: this is the same version, revised.
 */
export async function PATCH(req: NextRequest, ctx: { params: Promise<{ id: string; versionId: string }> }) {
  const { id, versionId } = await ctx.params;

  const { userId, isAdmin } = await getRefmUserContext();
  if (!userId) return unauthorized();
  const gate = await resolveUserGate(userId, { sessionIsAdmin: isAdmin });
  const block = writeBlockReason(gate);
  if (block) {
    return NextResponse.json(
      {
        error: block === 'LAPSED'
          ? 'Your subscription has lapsed. Renew your plan to save presentation changes.'
          : 'Your subscription has expired. Access is read-only during the grace period, renew to save presentation changes.',
        code: block,
      },
      { status: 403 },
    );
  }

  const owned = await requireWritableProject(id);
  if (owned instanceof NextResponse) return owned;

  const body = await req.json().catch(() => null) as { deck?: unknown; label?: unknown } | null;
  const deck = coerceDeck(body?.deck, id, today());
  if (!deck) return NextResponse.json({ error: 'A deck with at least one slide is required.' }, { status: 400 });
  const label = typeof body?.label === 'string' ? body.label : null;

  const { version, error } = await updateDeckVersion(id, versionId, deck, label);
  if (error) return serverError(error);
  if (!version) return notFound();
  return NextResponse.json({ version });
}

export async function DELETE(_req: NextRequest, ctx: { params: Promise<{ id: string; versionId: string }> }) {
  const { id, versionId } = await ctx.params;

  const { userId, isAdmin } = await getRefmUserContext();
  if (!userId) return unauthorized();
  const gate = await resolveUserGate(userId, { sessionIsAdmin: isAdmin });
  const block = writeBlockReason(gate);
  if (block) {
    return NextResponse.json(
      { error: 'Your access is read-only. Renew your plan to delete presentation versions.', code: block },
      { status: 403 },
    );
  }

  const owned = await requireWritableProject(id);
  if (owned instanceof NextResponse) return owned;

  const { error } = await deleteDeckVersion(id, versionId);
  if (error) return serverError(error);
  return NextResponse.json({ ok: true });
}
