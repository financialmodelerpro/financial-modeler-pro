/**
 * /api/refm/projects/[id]/fund-terms (fund layer Step 2, migration 208)
 *
 *   GET -> { terms, saved, available, extended }. `saved:false` means the
 *          project has no row yet and the caller gets standalone defaults.
 *          `available:false` means migration 208 is outstanding, and the tab
 *          says so rather than failing. `extended:false` means migration 209
 *          is outstanding, so the extended fee set and the distribution matrix
 *          could not be read from or written to the table; they still ride in
 *          the version snapshot, which is what the engine reads.
 *   PUT -> { terms } upsert. Body is re-validated through `resolveFundTerms`,
 *          never trusted: an out-of-range fee or an unrecognised fee base is
 *          coerced, not stored.
 *
 * INPUTS ONLY at this step. Nothing here changes a number anywhere: the fee
 * lands in M4 at Step 3 and the waterfall in M5 at Step 4.
 *
 * Auth: NextAuth session required, ownership enforced via getProject(userId, id)
 * before any fund-terms query, so a non-owner sees 404. Writes additionally
 * pass the read-only grace/lapse gate, matching every other REFM write choke
 * point: these are model inputs, unlike the Parties route which carries
 * identity data only.
 *
 * No em dashes in this file.
 */

import { NextRequest, NextResponse } from 'next/server';
import { getProject, getProjectForWrite } from '@/src/hubs/modeling/platforms/refm/lib/persistence/server';
import { getFundTerms, upsertFundTerms } from '@/src/hubs/modeling/platforms/refm/lib/persistence/fundTerms-server';
import { getRefmUserId, getRefmUserContext } from '@/src/hubs/modeling/platforms/refm/lib/persistence/auth';
import { resolveFundTerms } from '@/src/hubs/modeling/platforms/refm/lib/fundTerms';
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

async function assertWriteAllowed(): Promise<NextResponse | null> {
  const { userId, isAdmin } = await getRefmUserContext();
  if (!userId) return unauthorized();
  const gate = await resolveUserGate(userId, { sessionIsAdmin: isAdmin });
  const block = writeBlockReason(gate);
  if (!block) return null;
  return NextResponse.json(
    {
      error: block === 'LAPSED'
        ? 'Your subscription has lapsed. Renew your plan to save fund terms.'
        : 'Your subscription has expired. Access is read-only during the grace period, renew to save fund terms.',
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

  const { terms, saved, available, extended, error } = await getFundTerms(id);
  if (error) return serverError(error);
  // `extended:false` means migration 209 is outstanding, so the extended fee
  // fields could not be read from the table. They still ride in the version
  // snapshot, which is what the engine reads, and the tab says so.
  return NextResponse.json({ terms, saved, available, extended });
}

export async function PUT(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  const blocked = await assertWriteAllowed();
  if (blocked) return blocked;
  const owned = await requireWritableProject(id);
  if (owned instanceof NextResponse) return owned;

  const body = await req.json().catch(() => null) as { terms?: unknown } | null;
  // Through the SAME resolver the tab and the engine use, so a hand-rolled PUT
  // cannot store a 300% carry, a NaN fee, an unknown party role, or the
  // deferred circular 'fund_size' fee base.
  const terms = resolveFundTerms({ fundTerms: body?.terms } as never);

  const { error, available, extended } = await upsertFundTerms(id, terms);
  if (error) return NextResponse.json({ error, available, extended }, { status: available ? 500 : 409 });
  return NextResponse.json({ terms, saved: true, available: true, extended });
}
