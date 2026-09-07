/**
 * /api/refm/asset-types (2026-09-07, land planning step 1, mig 242)
 *
 *   GET    -> the calling user's ACCOUNT asset type vocabulary, in the firm's
 *             own order.
 *   POST   -> add or update ONE entry, or seed MANY ({ entries: [...] }, the
 *             "start from the standard list" button). ANY member may write:
 *             this is the firm's vocabulary, the same rule as the cost catalog.
 *   PUT    -> reorder ({ order: [entryId, ...] }), ONE batched write.
 *   DELETE -> remove one entry (?entryId=...). A project's VALUES for that
 *             type are deliberately left alone: an account-level edit must not
 *             delete a project's numbers, and the standards tab shows them as
 *             belonging to a type no longer listed.
 *
 * NAMES ONLY, SINCE MIG 244. The values (unit size, parking ratio and its
 * basis, build cost, revenue rate and its unit) moved into the project
 * snapshot, where they version, diff and change-log like any other input, so
 * this route no longer carries or validates them and nothing is stamped onto
 * an asset. The account-wide parking-area-per-slot PATCH went with them.
 *
 * A BLANK AND A TYPED ZERO ARE DIFFERENT ANSWERS. Standards arrive as
 * `number | null` in JSON: null (or an absent key) stores NULL, 0 stores 0.
 * The parser never coerces (no Number(null) collapse, docs/TRAPS.md 2.4),
 * and the GET response maps NULL back to an ABSENT field so client stamps
 * omit blanks.
 *
 * Auth: NextAuth session required; every query is filtered by the caller's
 * account (resolveAccountId) even though SERVICE_ROLE bypasses RLS. The
 * application layer is the access boundary, as everywhere else in REFM.
 *
 * FAILS SOFT ON GET, like the cost catalog: nothing here is on a calculation
 * path (selecting a type stamps values onto the ASSET and any consumer reads
 * the asset), so an absent table or failed read returns an empty registry
 * with `available: false` rather than an error.
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

// ── GET ─────────────────────────────────────────────────────────────────────
export async function GET(): Promise<NextResponse> {
  const userId = await getRefmUserId();
  if (!userId) return unauthorized();
  try {
    const sb = getServerClient();
    const accountId = await resolveAccountId(sb, userId);
    if (!accountId) {
      return NextResponse.json({ entries: [], available: false, reason: 'no account' });
    }
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
    const accountId = await resolveAccountId(sb, userId);
    if (!accountId) {
      return NextResponse.json({ error: 'Your account could not be resolved; nothing was saved.' }, { status: 503 });
    }

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
    const accountId = await resolveAccountId(sb, userId);
    if (!accountId) {
      return NextResponse.json({ error: 'Your account could not be resolved; nothing was saved.' }, { status: 503 });
    }
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
    const accountId = await resolveAccountId(sb, userId);
    if (!accountId) {
      return NextResponse.json({ error: 'Your account could not be resolved; nothing was deleted.' }, { status: 503 });
    }
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
