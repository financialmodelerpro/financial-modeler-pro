/**
 * /api/refm/projects/[id]/parties (Module 1 Parties, migration 190)
 *
 *   GET    -> list the project's parties (identity data only).
 *   POST   -> create a party { name, identifier?, roles[] }.
 *   PATCH  -> update a party { partyId, name?, identifier?, roles? }.
 *   DELETE -> remove a party (?partyId=).
 *
 * Auth: NextAuth session required. Ownership is enforced by first loading the
 * project via getProject(userId, id); a non-owner sees 404. Identity only,
 * the model engine never reads this table.
 *
 * No em dashes in this file.
 */

import { NextRequest, NextResponse } from 'next/server';
import { getProject } from '@/src/hubs/modeling/platforms/refm/lib/persistence/server';
import { listParties, insertParty, updateParty, deleteParty } from '@/src/hubs/modeling/platforms/refm/lib/persistence/parties-server';
import { getRefmUserId } from '@/src/hubs/modeling/platforms/refm/lib/persistence/auth';
import { sanitizeRoles } from '@/src/hubs/modeling/platforms/refm/lib/parties';

function unauthorized() { return NextResponse.json({ error: 'Unauthorized' }, { status: 401 }); }
function badRequest(msg: string) { return NextResponse.json({ error: msg }, { status: 400 }); }
function notFound() { return NextResponse.json({ error: 'Not found' }, { status: 404 }); }
function serverError(msg: string) { return NextResponse.json({ error: msg }, { status: 500 }); }

/** Verify the caller owns the project; returns userId on success or a response to return. */
async function requireOwnedProject(id: string): Promise<{ userId: string } | NextResponse> {
  const userId = await getRefmUserId();
  if (!userId) return unauthorized();
  const { row, error } = await getProject(userId, id);
  if (error) return serverError(error);
  if (!row) return notFound();
  return { userId };
}

export async function GET(_req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  const owned = await requireOwnedProject(id);
  if (owned instanceof NextResponse) return owned;
  const { rows, error } = await listParties(id);
  if (error) return serverError(error);
  return NextResponse.json({ parties: rows });
}

export async function POST(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  const owned = await requireOwnedProject(id);
  if (owned instanceof NextResponse) return owned;
  const body = await req.json().catch(() => ({}));
  const name = typeof body.name === 'string' ? body.name.trim() : '';
  if (!name) return badRequest('name is required');
  const identifier = typeof body.identifier === 'string' && body.identifier.trim() ? body.identifier.trim() : null;
  const roles = sanitizeRoles(body.roles);
  const display_order = Number.isFinite(body.display_order) ? Number(body.display_order) : 0;
  const { row, error } = await insertParty(id, { name, identifier, roles, display_order });
  if (error) return serverError(error);
  return NextResponse.json({ party: row });
}

export async function PATCH(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  const owned = await requireOwnedProject(id);
  if (owned instanceof NextResponse) return owned;
  const body = await req.json().catch(() => ({}));
  const partyId = typeof body.partyId === 'string' ? body.partyId : '';
  if (!partyId) return badRequest('partyId is required');
  const patch: { name?: string; identifier?: string | null; roles?: string[]; display_order?: number } = {};
  if (body.name !== undefined) {
    const n = String(body.name).trim();
    if (!n) return badRequest('name cannot be empty');
    patch.name = n;
  }
  if (body.identifier !== undefined) patch.identifier = String(body.identifier).trim() || null;
  if (body.roles !== undefined) patch.roles = sanitizeRoles(body.roles);
  if (body.display_order !== undefined && Number.isFinite(body.display_order)) patch.display_order = Number(body.display_order);
  const { row, error } = await updateParty(id, partyId, patch);
  if (error) return serverError(error);
  if (!row) return notFound();
  return NextResponse.json({ party: row });
}

export async function DELETE(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  const owned = await requireOwnedProject(id);
  if (owned instanceof NextResponse) return owned;
  const partyId = req.nextUrl.searchParams.get('partyId');
  if (!partyId) return badRequest('partyId is required');
  const { error } = await deleteParty(id, partyId);
  if (error) return serverError(error);
  return NextResponse.json({ ok: true });
}
