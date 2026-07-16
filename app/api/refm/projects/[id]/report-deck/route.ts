/**
 * /api/refm/projects/[id]/report-deck (Module 7, IC Presentation Builder, migration 199)
 *
 *   GET    -> { deck, canSave }. deck is null when the project has none saved yet;
 *             the client then seeds one from the slide templates. canSave is false
 *             when migration 199 is outstanding, so the tab can show a clear
 *             banner instead of failing a save with a raw Postgres error.
 *   PUT    -> upsert the deck document. The body is re-validated through
 *             coerceDeck, never trusted as jsonb.
 *   DELETE -> drop the deck, which resets the project to a freshly seeded one.
 *
 * Auth: NextAuth session required. Ownership is enforced by loading the project
 * via getProject(userId, id) first; a non-owner sees 404.
 *
 * Writes are additionally gated on the entitlement read-only grace state: a
 * lapsed-into-grace user may VIEW their deck but not save edits, matching every
 * other REFM write choke point.
 *
 * Presentation only. The model engine never reads this table, and the deck holds
 * binding keys rather than computed figures.
 *
 * No em dashes in this file.
 */

import { NextRequest, NextResponse } from 'next/server';
import { getProject } from '@/src/hubs/modeling/platforms/refm/lib/persistence/server';
import { getDeck, upsertDeck, deleteDeck, coerceDeck } from '@/src/hubs/modeling/platforms/refm/lib/persistence/deck-server';
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

/**
 * Lapse gate for deck writes, mirroring the versions (save) choke point. A
 * read-only GRACE user and a LAPSED user can VIEW their deck but not save edits.
 * Enforced server-side so it cannot be bypassed by posting directly; admin
 * bypasses (writeBlockReason returns null on fullAccess). Returns a 403 response
 * to short-circuit on, or null when the write is allowed.
 */
async function assertDeckWriteAllowed(): Promise<NextResponse | null> {
  const { userId, isAdmin } = await getRefmUserContext();
  if (!userId) return unauthorized();
  const gate = await resolveUserGate(userId, { sessionIsAdmin: isAdmin });
  const block = writeBlockReason(gate);
  if (!block) return null;
  return NextResponse.json(
    {
      error: block === 'LAPSED'
        ? 'Your subscription has lapsed. Renew your plan to save presentation changes.'
        : 'Your subscription has expired. Access is read-only during the grace period, renew to save presentation changes.',
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

  const { deck, error, canSave } = await getDeck(id, today());
  if (error) return serverError(error);
  return NextResponse.json({ deck, canSave });
}

export async function PUT(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  const blocked = await assertDeckWriteAllowed();
  if (blocked) return blocked;
  const owned = await requireOwnedProject(id);
  if (owned instanceof NextResponse) return owned;

  const body = await req.json().catch(() => null) as { deck?: unknown } | null;
  const deck = coerceDeck(body?.deck, id, today());
  if (!deck) return NextResponse.json({ error: 'A deck with at least one slide is required.' }, { status: 400 });

  const { error } = await upsertDeck(id, deck);
  if (error) return serverError(error);
  return NextResponse.json({ ok: true });
}

export async function DELETE(_req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  const blocked = await assertDeckWriteAllowed();
  if (blocked) return blocked;
  const owned = await requireOwnedProject(id);
  if (owned instanceof NextResponse) return owned;

  const { error } = await deleteDeck(id);
  if (error) return serverError(error);
  return NextResponse.json({ ok: true });
}
