/**
 * /api/refm/asset-types (2026-09-07, mig 242; the TEMPLATE since 2026-09-10)
 *
 * THIS IS A TEMPLATE, NOT THE LIST A PROJECT USES. The list moved into the
 * project snapshot on 2026-09-10: a firm's projects come from different land
 * owners and developers, each names its types as its own scheme requires, and
 * an edit inside one project must never reach another. What survives here is
 * the firm's STARTING POINT, seeded FROM on demand and pushed BACK explicitly,
 * and it is read by nothing that computes anything.
 *
 *   GET    -> a template. WITHOUT `projectId`, the caller's own account's.
 *             WITH one, the account that OWNS that project, which is the half
 *             of docs/TRAPS.md 7.35 that survived the move: a platform admin
 *             seeding inside a client's project must seed the CLIENT's names,
 *             not their own. The caller must be able to reach the project.
 *   POST   -> add or update ONE entry, or MANY ({ entries: [...] }), which is
 *             what the tab's push writes. `projectId` scopes it the same way
 *             the GET is scoped, deliberately: a seed that reads one account
 *             and a push that writes another would be two firms behind one
 *             word. Gated on `canEditInputs` when a project is named.
 *   PUT    -> reorder ({ order: [entryId, ...] }), ONE batched write.
 *   DELETE -> remove one entry (?entryId=...). Nothing else is touched: a
 *             project holds its own copy, so a template edit cannot reach a
 *             project's numbers at all any more.
 *
 * NAMES ONLY, SINCE MIG 244. The values (unit size, parking ratio and its
 * basis, build cost, revenue rate and its unit) live in the project snapshot.
 *
 * Auth: NextAuth session required. Without `projectId` every query is filtered
 * by the caller's own account (resolveAccountId); with one, the project's
 * membership is the access check and the OWNER's account is the scope. The
 * application layer is the access boundary, as everywhere else in REFM.
 *
 * FAILS SOFT ON GET: nothing here is on a calculation path, so an absent table
 * or failed read returns an empty template with `available: false`.
 *
 * No em dashes in this file.
 */

import { NextRequest, NextResponse } from 'next/server';
import { getServerClient } from '@/src/core/db/supabase';
import { getRefmUserId } from '@/src/hubs/modeling/platforms/refm/lib/persistence/auth';
import {
  normaliseAssetTypeId,
  sortAssetTypes,
  type AssetTypeStandard,
} from '@/src/hubs/modeling/platforms/refm/lib/state/assetTypeStandards';
import { resolveAccountId } from '@/src/shared/admin/accountBoundary';
import { getProject, getProjectForAction } from '@/src/hubs/modeling/platforms/refm/lib/persistence/server';

const TYPES_TABLE = 'refm_asset_types';

function unauthorized(): NextResponse { return NextResponse.json({ error: 'Unauthorized' }, { status: 401 }); }
function badRequest(msg: string): NextResponse { return NextResponse.json({ error: msg }, { status: 400 }); }

interface Row {
  entry_id: string;
  label: string;
  category: string | null;
  sort_order?: number | string | null;
  created_at: string;
}

/** NUMERIC comes back from PostgREST as a number or a string depending on the
 *  column; NULL must stay NULL. Never Number(null). */
function dbNum(v: number | string | null | undefined): number | undefined {
  if (v === null || v === undefined) return undefined;
  const n = typeof v === 'number' ? v : parseFloat(v);
  return Number.isFinite(n) ? n : undefined;
}

const toEntry = (r: Row): AssetTypeStandard => ({
  id: r.entry_id,
  label: r.label,
  ...(r.category ? { category: r.category } : {}),
  ...(dbNum(r.sort_order) !== undefined ? { sortOrder: dbNum(r.sort_order) } : {}),
  createdAt: r.created_at,
});

const ENTRY_COLS = 'entry_id, label, category, sort_order, created_at';

/** One validated vocabulary row from a request body. Shared by the single POST
 *  and the bulk seed, so both admit exactly the same values. */
function parseEntry(body: Record<string, unknown>, accountId: string, userId: string):
  { ok: true; row: Record<string, unknown> } | { ok: false; error: string } {
  const label = String(body.label ?? '').trim();
  if (!label) return { ok: false, error: 'A name is required.' };
  if (label.length > 80) return { ok: false, error: 'Name is too long.' };

  const category = String(body.category ?? '').trim();
  if (category.length > 40) return { ok: false, error: 'Category is too long.' };

  const sortOrder = body.sortOrder;
  if (sortOrder !== undefined && sortOrder !== null
    && (typeof sortOrder !== 'number' || !Number.isInteger(sortOrder) || sortOrder < 0)) {
    return { ok: false, error: 'Order must be a whole number.' };
  }

  const entryId = typeof body.entryId === 'string' && body.entryId ? body.entryId : normaliseAssetTypeId(label);
  if (!entryId || !/^[a-z0-9-]{1,48}$/.test(entryId)) {
    return { ok: false, error: 'That name has no letters or digits to build an id from.' };
  }

  return {
    ok: true,
    row: {
      account_id: accountId,
      user_id: userId,
      entry_id: entryId,
      label,
      category: category || null,
      ...(typeof sortOrder === 'number' ? { sort_order: sortOrder } : {}),
      updated_at: new Date().toISOString(),
    },
  };
}

/**
 * WHOSE TEMPLATE THIS CALL MEANS.
 *
 * ONE resolver for all four verbs, so a read and a write can never disagree
 * about which firm is being talked about. `projectId` names a project: the
 * scope is its OWNER's account and the caller must be able to reach it (a
 * write additionally needs `canEditInputs`, since pushing to a firm's template
 * is a deliberate act and a Viewer does not make them). No `projectId` means
 * the caller's own account, which is what every call meant before 2026-09-10.
 *
 * A project that cannot be reached returns null with a 404-shaped reason
 * rather than falling back to the caller's account: falling back is how an
 * admin ends up seeding their own vocabulary into a client's project without
 * anything on screen saying so.
 */
type Scope =
  | { ok: true; accountId: string }
  | { ok: false; status: number; error: string };

async function resolveTemplateScope(
  sb: ReturnType<typeof getServerClient>,
  userId: string,
  projectId: string | null,
  write: boolean,
): Promise<Scope> {
  if (projectId !== null && projectId !== '') {
    const r = write
      ? await getProjectForAction(userId, projectId, 'canEditInputs')
      : await getProject(userId, projectId);
    if (r.error) return { ok: false, status: 503, error: r.error };
    if (!r.row) return { ok: false, status: 404, error: 'That project is not available to you.' };
    const owned = await resolveAccountId(sb, r.row.user_id);
    if (!owned) return { ok: false, status: 503, error: 'The account owning that project could not be resolved.' };
    return { ok: true, accountId: owned };
  }
  const mine = await resolveAccountId(sb, userId);
  if (!mine) return { ok: false, status: 503, error: 'Your account could not be resolved.' };
  return { ok: true, accountId: mine };
}

const projectIdOf = (req: NextRequest): string | null =>
  new URL(req.url).searchParams.get('projectId');

// ── GET ─────────────────────────────────────────────────────────────────────
export async function GET(req: NextRequest): Promise<NextResponse> {
  const userId = await getRefmUserId();
  if (!userId) return unauthorized();
  try {
    const sb = getServerClient();
    const scope = await resolveTemplateScope(sb, userId, projectIdOf(req), false);
    if (!scope.ok) {
      return NextResponse.json({ entries: [], available: false, reason: scope.error });
    }
    const accountId = scope.accountId;
    const { data, error } = await sb
      .from(TYPES_TABLE)
      .select(ENTRY_COLS)
      .eq('account_id', accountId)
      .order('label', { ascending: true });
    if (error) {
      return NextResponse.json({ entries: [], available: false, reason: error.message });
    }
    return NextResponse.json({
      // Served in the FIRM'S order (explicit positions first, then never
      // reordered alphabetically), through the one shared rule.
      entries: sortAssetTypes((data ?? []).map((r) => toEntry(r as unknown as Row))),
      available: true,
    });
  } catch (e) {
    return NextResponse.json({ entries: [], available: false, reason: String(e) });
  }
}

// ── POST ────────────────────────────────────────────────────────────────────
// One entry:  { label, category?, avgUnitSize?, parkingRatio?, parkingRatioBasis?,
//               constructionCostPerSqm?, revenueRate?, revenueRateUnit?, sortOrder?,
//               entryId? (update in place under its existing id, so a RENAME
//               keeps the id an asset stamped from) }
// Bulk seed:  { entries: [ ...the same shape... ] }, up to 50, for the
//             "start from the standard list" button. Validated identically
//             through parseEntry, so a seeded row can hold nothing a typed
//             row could not.
export async function POST(req: NextRequest): Promise<NextResponse> {
  const userId = await getRefmUserId();
  if (!userId) return unauthorized();

  let body: Record<string, unknown>;
  try { body = await req.json() as Record<string, unknown>; }
  catch { return badRequest('Invalid JSON body.'); }

  const bulk = Array.isArray(body.entries) ? body.entries as Record<string, unknown>[] : null;
  if (bulk && bulk.length === 0) return badRequest('No entries to add.');
  if (bulk && bulk.length > 50) return badRequest('Too many entries at once.');

  try {
    const sb = getServerClient();
    const scope = await resolveTemplateScope(sb, userId, projectIdOf(req), true);
    if (!scope.ok) return NextResponse.json({ error: scope.error }, { status: scope.status });
    const accountId = scope.accountId;

    const rows: Record<string, unknown>[] = [];
    for (const one of bulk ?? [body]) {
      const parsed = parseEntry(one, accountId, userId);
      if (!parsed.ok) return badRequest(parsed.error);
      rows.push(parsed.row);
    }

    const { data, error } = await sb
      .from(TYPES_TABLE)
      .upsert(rows, { onConflict: 'account_id,entry_id' })
      .select(ENTRY_COLS);
    if (error || !data) {
      return NextResponse.json({ error: error?.message ?? 'Could not save.' }, { status: 503 });
    }
    const entries = (data as unknown as Row[]).map(toEntry);
    return NextResponse.json(bulk ? { entries } : { entry: entries[0] });
  } catch (e) {
    return NextResponse.json({ error: String(e) }, { status: 503 });
  }
}

// ── PUT ─────────────────────────────────────────────────────────────────────
// Reorder: { order: string[] } of entry ids, first to last.
//
// A WHOLE-LIST DENSE WRITE (the mig 229 reordering rule): every id in the
// caller's account is given its index, so "unset" (NULL, never reordered)
// and "first" (0) never blur. An id that is not on the account is refused
// rather than skipped: a silent skip would report success for an order the
// user cannot see the result of.
//
// ONE BATCHED WRITE, not one per row (2026-09-07). Writing the rows in a loop
// took ten sequential round trips, about four seconds on the live list, and
// worse, it was not atomic: a failure halfway left half the list reordered
// with no way to tell from the response. The upsert carries each row's LABEL
// (read back in the same breath as the ownership check) because label is NOT
// NULL, so a conflicting row updates rather than inserts a half-built one.
export async function PUT(req: NextRequest): Promise<NextResponse> {
  const userId = await getRefmUserId();
  if (!userId) return unauthorized();

  let body: Record<string, unknown>;
  try { body = await req.json() as Record<string, unknown>; }
  catch { return badRequest('Invalid JSON body.'); }

  const order = Array.isArray(body.order) ? body.order.map((x) => String(x)) : null;
  if (!order || order.length === 0) return badRequest('Send the order as a list of entry ids.');
  if (order.length > 200) return badRequest('Too many entries to reorder.');
  if (new Set(order).size !== order.length) return badRequest('That order lists the same entry twice.');
  if (!order.every((id) => /^[a-z0-9-]{1,48}$/.test(id))) return badRequest('That order names an entry that cannot exist.');

  try {
    const sb = getServerClient();
    const scope = await resolveTemplateScope(sb, userId, projectIdOf(req), true);
    if (!scope.ok) return NextResponse.json({ error: scope.error }, { status: scope.status });
    const accountId = scope.accountId;
    const { data: existing, error: readErr } = await sb
      .from(TYPES_TABLE)
      .select('entry_id, label')
      .eq('account_id', accountId);
    if (readErr) return NextResponse.json({ error: readErr.message }, { status: 503 });
    const labelOf = new Map((existing ?? []).map((r) => {
      const row = r as { entry_id: string; label: string };
      return [row.entry_id, row.label] as const;
    }));
    const stranger = order.find((id) => !labelOf.has(id));
    if (stranger) return badRequest('That order names an entry that is not in your list.');

    const now = new Date().toISOString();
    const { error } = await sb
      .from(TYPES_TABLE)
      .upsert(
        order.map((id, i) => ({
          account_id: accountId,
          entry_id: id,
          label: labelOf.get(id) as string,
          sort_order: i,
          updated_at: now,
        })),
        { onConflict: 'account_id,entry_id' },
      );
    if (error) return NextResponse.json({ error: error.message }, { status: 503 });
    return NextResponse.json({ ok: true, ordered: order.length });
  } catch (e) {
    return NextResponse.json({ error: String(e) }, { status: 503 });
  }
}

// ── DELETE ──────────────────────────────────────────────────────────────────
// ?entryId=... Removes one entry from the caller's account VOCABULARY.
//
// A project's VALUES for that type are deliberately NOT touched. Deleting a
// name from the firm's list must not delete a project's numbers as a side
// effect (the same instinct as an entry outliving its author), and an asset
// still names its type, so the standards tab surfaces the values as belonging
// to a type that is no longer listed.
//
// There is no PATCH any more: the account-wide parking area per slot moved
// into the project snapshot with mig 244.
export async function DELETE(req: NextRequest): Promise<NextResponse> {
  const userId = await getRefmUserId();
  if (!userId) return unauthorized();

  const entryId = new URL(req.url).searchParams.get('entryId') ?? '';
  if (!/^[a-z0-9-]{1,48}$/.test(entryId)) return badRequest('Unknown entry.');

  try {
    const sb = getServerClient();
    const scope = await resolveTemplateScope(sb, userId, projectIdOf(req), true);
    if (!scope.ok) return NextResponse.json({ error: scope.error }, { status: scope.status });
    const accountId = scope.accountId;
    const { error } = await sb
      .from(TYPES_TABLE)
      .delete()
      .eq('account_id', accountId)
      .eq('entry_id', entryId);
    if (error) {
      return NextResponse.json({ error: error.message }, { status: 503 });
    }
    return NextResponse.json({ ok: true });
  } catch (e) {
    return NextResponse.json({ error: String(e) }, { status: 503 });
  }
}
