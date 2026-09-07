/**
 * /api/refm/asset-types (2026-09-07, land planning step 1, mig 242)
 *
 *   GET    -> the calling user's ACCOUNT asset type registry plus the
 *             account-wide standards scalar (parking area per slot).
 *   POST   -> add or update one registry entry. ANY member may write: this is
 *             the firm's vocabulary, the same rule as the cost catalog.
 *   PATCH  -> set the account-wide parking area per slot.
 *   DELETE -> remove one registry entry (?entryId=...). Assets that stamped
 *             from it keep their stamp; the registry is never read back.
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
  normaliseAssetTypeId,
  type AssetTypeStandard,
  type ParkingRatioBasis,
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
  created_at: string;
}

/** NUMERIC comes back from PostgREST as a number or a string depending on the
 *  column; NULL must stay NULL. Never Number(null). */
function dbNum(v: number | string | null): number | undefined {
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
  createdAt: r.created_at,
});

/** Parse an optional non-negative standards number from the request body.
 *  Absent, null and '' all mean BLANK (stored NULL). A number must be a real
 *  finite non-negative number; anything else is rejected rather than coerced. */
function standardsNum(v: unknown): { ok: true; value: number | null } | { ok: false } {
  if (v === undefined || v === null || v === '') return { ok: true, value: null };
  if (typeof v !== 'number' || !Number.isFinite(v) || v < 0) return { ok: false };
  return { ok: true, value: v };
}

const ENTRY_COLS = 'entry_id, label, category, avg_unit_size, parking_ratio, parking_ratio_basis, created_at';

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
    const { data, error } = await sb
      .from(TYPES_TABLE)
      .select(ENTRY_COLS)
      .eq('account_id', accountId)
      .order('label', { ascending: true });
    if (error) {
      return NextResponse.json({ entries: [], parkingAreaPerSlot: null, available: false, reason: error.message });
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
      entries: (data ?? []).map((r) => toEntry(r as Row)),
      parkingAreaPerSlot,
      available: true,
    });
  } catch (e) {
    return NextResponse.json({ entries: [], parkingAreaPerSlot: null, available: false, reason: String(e) });
  }
}

// ── POST ────────────────────────────────────────────────────────────────────
// Body: { label, category?, avgUnitSize?: number|null, parkingRatio?: number|null,
//         parkingRatioBasis?, entryId? (update in place under its existing id) }
export async function POST(req: NextRequest): Promise<NextResponse> {
  const userId = await getRefmUserId();
  if (!userId) return unauthorized();

  let body: Record<string, unknown>;
  try { body = await req.json() as Record<string, unknown>; }
  catch { return badRequest('Invalid JSON body.'); }

  const label = String(body.label ?? '').trim();
  if (!label) return badRequest('A name is required.');
  if (label.length > 80) return badRequest('Name is too long.');

  const category = String(body.category ?? '').trim();
  if (category.length > 40) return badRequest('Category is too long.');

  const avgUnitSize = standardsNum(body.avgUnitSize);
  if (!avgUnitSize.ok) return badRequest('Average unit size must be blank, zero or a positive number.');
  const parkingRatio = standardsNum(body.parkingRatio);
  if (!parkingRatio.ok) return badRequest('Parking ratio must be blank, zero or a positive number.');

  const basis = String(body.parkingRatioBasis ?? 'slots_per_unit');
  if (!(PARKING_RATIO_BASES as readonly string[]).includes(basis)) return badRequest('Unknown parking ratio basis.');

  // An explicit entryId keeps the id stable across a rename; a new entry
  // derives its id from the label.
  const rawEntryId = typeof body.entryId === 'string' && body.entryId ? body.entryId : normaliseAssetTypeId(label);
  if (!rawEntryId || !/^[a-z0-9-]{1,48}$/.test(rawEntryId)) {
    return badRequest('That name has no letters or digits to build an id from.');
  }

  try {
    const sb = getServerClient();
    const accountId = await resolveAccountId(sb, userId);
    if (!accountId) {
      return NextResponse.json({ error: 'Your account could not be resolved; the entry was not saved.' }, { status: 503 });
    }
    const { data, error } = await sb
      .from(TYPES_TABLE)
      .upsert({
        account_id: accountId,
        user_id: userId,
        entry_id: rawEntryId,
        label,
        category: category || null,
        avg_unit_size: avgUnitSize.value,
        parking_ratio: parkingRatio.value,
        parking_ratio_basis: basis,
        updated_at: new Date().toISOString(),
      }, { onConflict: 'account_id,entry_id' })
      .select(ENTRY_COLS)
      .maybeSingle();
    if (error || !data) {
      return NextResponse.json({ error: error?.message ?? 'Could not save the entry.' }, { status: 503 });
    }
    return NextResponse.json({ entry: toEntry(data as Row) });
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
