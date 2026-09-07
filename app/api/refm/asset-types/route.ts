/**
 * /api/refm/asset-types (2026-09-07, land planning step 1, mig 242)
 *
 *   GET    -> the calling user's ACCOUNT asset type registry (in the firm's
 *             own order) plus the account-wide parking area per slot.
 *   POST   -> add or update ONE entry, or seed MANY ({ entries: [...] }, the
 *             "start from the standard list" button). ANY member may write:
 *             this is the firm's vocabulary, the same rule as the cost catalog.
 *   PUT    -> reorder ({ order: [entryId, ...] }), a whole-list dense write.
 *   PATCH  -> set the account-wide parking area per slot.
 *   DELETE -> remove one registry entry (?entryId=...). Assets that stamped
 *             from it keep their stamp; the registry is never read back.
 *
 * Since mig 243 an entry also carries the CONSTRUCTION COST per sqm and a
 * REVENUE RATE whose UNIT names its basis (per sqm / per unit / per sqm per
 * year / ADR per key per night), and a sort_order. The rates stamp onto the
 * asset exactly like the area standards and are read by nothing else: capex
 * and revenue still take their rates where they always did.
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
  PARKING_RATIO_BASES,
  REVENUE_RATE_UNITS,
  normaliseAssetTypeId,
  sortAssetTypes,
  type AssetTypeStandard,
  type ParkingRatioBasis,
  type RevenueRateUnit,
} from '@/src/hubs/modeling/platforms/refm/lib/state/assetTypeStandards';
import { resolveAccountId } from '@/src/shared/admin/accountBoundary';

const TYPES_TABLE = 'refm_asset_types';
const STANDARDS_TABLE = 'refm_account_standards';

function unauthorized(): NextResponse { return NextResponse.json({ error: 'Unauthorized' }, { status: 401 }); }
function badRequest(msg: string): NextResponse { return NextResponse.json({ error: msg }, { status: 400 }); }

interface Row {
  entry_id: string;
  label: string;
  category: string | null;
  avg_unit_size: number | string | null;
  parking_ratio: number | string | null;
  parking_ratio_basis: string;
  construction_cost_per_sqm?: number | string | null;
  revenue_rate?: number | string | null;
  revenue_rate_unit?: string | null;
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
  ...(dbNum(r.avg_unit_size) !== undefined ? { avgUnitSizeSqm: dbNum(r.avg_unit_size) } : {}),
  ...(dbNum(r.parking_ratio) !== undefined ? { parkingRatio: dbNum(r.parking_ratio) } : {}),
  parkingRatioBasis: (PARKING_RATIO_BASES as readonly string[]).includes(r.parking_ratio_basis)
    ? (r.parking_ratio_basis as ParkingRatioBasis)
    : 'slots_per_unit',
  ...(dbNum(r.construction_cost_per_sqm) !== undefined
    ? { constructionCostPerSqm: dbNum(r.construction_cost_per_sqm) } : {}),
  ...(dbNum(r.revenue_rate) !== undefined && r.revenue_rate_unit
    && (REVENUE_RATE_UNITS as readonly string[]).includes(r.revenue_rate_unit)
    ? { revenueRate: dbNum(r.revenue_rate), revenueRateUnit: r.revenue_rate_unit as RevenueRateUnit } : {}),
  ...(dbNum(r.sort_order) !== undefined ? { sortOrder: dbNum(r.sort_order) } : {}),
  createdAt: r.created_at,
});

/** The columns a pre-243 database does not have. Selected separately so a
 *  deploy landing before migration 243 degrades to the 242 shape (a shorter
 *  row) instead of failing the whole read: the same fail-soft posture the
 *  absent-table branch takes, one migration finer. */
const RATE_COLS = ', construction_cost_per_sqm, revenue_rate, revenue_rate_unit, sort_order';

/** Parse an optional non-negative standards number from the request body.
 *  Absent, null and '' all mean BLANK (stored NULL). A number must be a real
 *  finite non-negative number; anything else is rejected rather than coerced. */
function standardsNum(v: unknown): { ok: true; value: number | null } | { ok: false } {
  if (v === undefined || v === null || v === '') return { ok: true, value: null };
  if (typeof v !== 'number' || !Number.isFinite(v) || v < 0) return { ok: false };
  return { ok: true, value: v };
}

const BASE_COLS = 'entry_id, label, category, avg_unit_size, parking_ratio, parking_ratio_basis, created_at';
const ENTRY_COLS = BASE_COLS + RATE_COLS;

/** One validated registry row from a request body. Shared by the single POST
 *  and the bulk seed, so both admit exactly the same values. */
function parseEntry(body: Record<string, unknown>, accountId: string, userId: string):
  { ok: true; row: Record<string, unknown> } | { ok: false; error: string } {
  const label = String(body.label ?? '').trim();
  if (!label) return { ok: false, error: 'A name is required.' };
  if (label.length > 80) return { ok: false, error: 'Name is too long.' };

  const category = String(body.category ?? '').trim();
  if (category.length > 40) return { ok: false, error: 'Category is too long.' };

  const avgUnitSize = standardsNum(body.avgUnitSize);
  if (!avgUnitSize.ok) return { ok: false, error: 'Average unit size must be blank, zero or a positive number.' };
  const parkingRatio = standardsNum(body.parkingRatio);
  if (!parkingRatio.ok) return { ok: false, error: 'Parking ratio must be blank, zero or a positive number.' };
  const buildCost = standardsNum(body.constructionCostPerSqm);
  if (!buildCost.ok) return { ok: false, error: 'Construction cost must be blank, zero or a positive number.' };
  const revenueRate = standardsNum(body.revenueRate);
  if (!revenueRate.ok) return { ok: false, error: 'Revenue rate must be blank, zero or a positive number.' };

  const basis = String(body.parkingRatioBasis ?? 'slots_per_unit');
  if (!(PARKING_RATIO_BASES as readonly string[]).includes(basis)) return { ok: false, error: 'Unknown parking ratio basis.' };

  // A rate with no unit names no basis, so the unit is REQUIRED with a rate
  // and stored NULL without one. Never defaulted: a guessed basis would be a
  // claim nobody made.
  let revenueRateUnit: string | null = null;
  if (revenueRate.value !== null) {
    const unit = String(body.revenueRateUnit ?? '');
    if (!(REVENUE_RATE_UNITS as readonly string[]).includes(unit)) {
      return { ok: false, error: 'Pick what the revenue rate is per.' };
    }
    revenueRateUnit = unit;
  }

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
      avg_unit_size: avgUnitSize.value,
      parking_ratio: parkingRatio.value,
      parking_ratio_basis: basis,
      construction_cost_per_sqm: buildCost.value,
      revenue_rate: revenueRate.value,
      revenue_rate_unit: revenueRateUnit,
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
      return NextResponse.json({ entries: [], parkingAreaPerSlot: null, available: false, reason: 'no account' });
    }
    const full = await sb
      .from(TYPES_TABLE)
      .select(ENTRY_COLS)
      .eq('account_id', accountId)
      .order('label', { ascending: true });
    let rows = (full.data ?? []) as unknown as Row[];
    if (full.error) {
      // A deploy landing before migration 243: retry on the 242 shape rather
      // than reporting the whole registry unreachable over four columns.
      const retry = await sb
        .from(TYPES_TABLE)
        .select(BASE_COLS)
        .eq('account_id', accountId)
        .order('label', { ascending: true });
      if (retry.error) {
        return NextResponse.json({ entries: [], parkingAreaPerSlot: null, available: false, reason: full.error.message });
      }
      rows = (retry.data ?? []) as unknown as Row[];
    }
    let parkingAreaPerSlot: number | null = null;
    const std = await sb
      .from(STANDARDS_TABLE)
      .select('parking_area_per_slot')
      .eq('account_id', accountId)
      .maybeSingle();
    if (!std.error && std.data) {
      parkingAreaPerSlot = dbNum((std.data as { parking_area_per_slot: number | string | null }).parking_area_per_slot) ?? null;
    }
    return NextResponse.json({
      // Served in the FIRM'S order (explicit positions first, then never
      // reordered alphabetically), through the one shared rule.
      entries: sortAssetTypes(rows.map(toEntry)),
      parkingAreaPerSlot,
      available: true,
    });
  } catch (e) {
    return NextResponse.json({ entries: [], parkingAreaPerSlot: null, available: false, reason: String(e) });
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
// and "first" (0) never blur, and a partial write cannot leave two rows
// claiming the same seat. An id that is not on the account is refused rather
// than skipped: a silent skip would report success for an order the user
// cannot see the result of.
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
      .select('entry_id')
      .eq('account_id', accountId);
    if (readErr) return NextResponse.json({ error: readErr.message }, { status: 503 });
    const owned = new Set((existing ?? []).map((r) => (r as { entry_id: string }).entry_id));
    const stranger = order.find((id) => !owned.has(id));
    if (stranger) return badRequest('That order names an entry that is not in your list.');

    for (let i = 0; i < order.length; i += 1) {
      const { error } = await sb
        .from(TYPES_TABLE)
        .update({ sort_order: i, updated_at: new Date().toISOString() })
        .eq('account_id', accountId)
        .eq('entry_id', order[i]);
      if (error) return NextResponse.json({ error: error.message }, { status: 503 });
    }
    return NextResponse.json({ ok: true, ordered: order.length });
  } catch (e) {
    return NextResponse.json({ error: String(e) }, { status: 503 });
  }
}

// ── PATCH ───────────────────────────────────────────────────────────────────
// Body: { parkingAreaPerSlot: number | null }. Null clears back to blank.
export async function PATCH(req: NextRequest): Promise<NextResponse> {
  const userId = await getRefmUserId();
  if (!userId) return unauthorized();

  let body: Record<string, unknown>;
  try { body = await req.json() as Record<string, unknown>; }
  catch { return badRequest('Invalid JSON body.'); }

  const parsed = standardsNum(body.parkingAreaPerSlot);
  if (!parsed.ok) return badRequest('Parking area per slot must be blank, zero or a positive number.');

  try {
    const sb = getServerClient();
    const accountId = await resolveAccountId(sb, userId);
    if (!accountId) {
      return NextResponse.json({ error: 'Your account could not be resolved; nothing was saved.' }, { status: 503 });
    }
    const { error } = await sb
      .from(STANDARDS_TABLE)
      .upsert({
        account_id: accountId,
        user_id: userId,
        parking_area_per_slot: parsed.value,
        updated_at: new Date().toISOString(),
      }, { onConflict: 'account_id' });
    if (error) {
      return NextResponse.json({ error: error.message }, { status: 503 });
    }
    return NextResponse.json({ ok: true, parkingAreaPerSlot: parsed.value });
  } catch (e) {
    return NextResponse.json({ error: String(e) }, { status: 503 });
  }
}

// ── DELETE ──────────────────────────────────────────────────────────────────
// ?entryId=... Removes one registry entry from the caller's account. Assets
// that stamped from it are untouched: the stamp carries everything.
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
