/**
 * /api/refm/cost-catalog (2026-08-17)
 *
 *   GET  -> the calling user's own catalog entries. Built-ins are NOT returned:
 *           they live in code so the picker works with no round trip.
 *   POST -> add (or update) one entry, shared across that user's projects.
 *
 * Auth: NextAuth session required, and every query is filtered by
 * `user_id = session.user.id` even though the SERVICE_ROLE client bypasses RLS.
 * The application layer is the access boundary, as everywhere else in REFM.
 *
 * FAILS SOFT, DELIBERATELY. Nothing here is on a calculation path: selecting an
 * entry stamps method / stage / phasing source onto the cost line, and the
 * engine reads the line. So when the table is absent (a deploy landing before
 * migration 214) or the read fails, GET returns an EMPTY list with `available:
 * false` rather than an error, and the caller falls back to the built-in
 * catalog. A cost table that will not render because a naming convenience is
 * unreachable would be a much worse failure than a shorter dropdown.
 *
 * No em dashes in this file.
 */

import { NextRequest, NextResponse } from 'next/server';
import { getServerClient } from '@/src/core/db/supabase';
import { getRefmUserId } from '@/src/hubs/modeling/platforms/refm/lib/persistence/auth';
import {
  COST_METHODS,
  COST_STAGES,
  ALLOCATION_BASES,
  COST_SCOPES,
  CAPEX_PHASING_SOURCES,
  type CostMethod,
  type CostStage,
  type AllocationBasis,
  type CostScope,
  type CapexPhasingSource,
} from '@/src/hubs/modeling/platforms/refm/lib/state/module1-types';
import {
  BUILT_IN_COST_CATALOG,
  normaliseCatalogId,
  type UserCostCatalogEntry,
} from '@/src/hubs/modeling/platforms/refm/lib/state/costCatalog';

const TABLE = 'refm_cost_catalog';

function unauthorized(): NextResponse { return NextResponse.json({ error: 'Unauthorized' }, { status: 401 }); }
function badRequest(msg: string): NextResponse { return NextResponse.json({ error: msg }, { status: 400 }); }

interface Row {
  entry_id: string;
  label: string;
  method: string;
  stage: string;
  phasing_source: string;
  allocation_basis: string;
  scope: string;
  hint: string | null;
  created_at: string;
}

const toEntry = (r: Row): UserCostCatalogEntry => ({
  id: r.entry_id,
  label: r.label,
  method: r.method as CostMethod,
  stage: r.stage as CostStage,
  phasingSource: r.phasing_source as CapexPhasingSource,
  allocationBasis: r.allocation_basis as AllocationBasis,
  scope: r.scope as CostScope,
  hint: r.hint ?? undefined,
  createdAt: r.created_at,
  builtIn: false,
});

// ── GET ─────────────────────────────────────────────────────────────────────
export async function GET(): Promise<NextResponse> {
  const userId = await getRefmUserId();
  if (!userId) return unauthorized();
  try {
    const sb = getServerClient();
    const { data, error } = await sb
      .from(TABLE)
      .select('entry_id, label, method, stage, phasing_source, allocation_basis, scope, hint, created_at')
      .eq('user_id', userId)
      .order('label', { ascending: true });
    if (error) {
      // Absent table or any read failure: the built-ins still work.
      return NextResponse.json({ entries: [], available: false, reason: error.message });
    }
    return NextResponse.json({ entries: (data ?? []).map((r) => toEntry(r as Row)), available: true });
  } catch (e) {
    return NextResponse.json({ entries: [], available: false, reason: String(e) });
  }
}

// ── POST ────────────────────────────────────────────────────────────────────
// Body: { label, method, stage, phasingSource?, allocationBasis?, scope?, hint? }
export async function POST(req: NextRequest): Promise<NextResponse> {
  const userId = await getRefmUserId();
  if (!userId) return unauthorized();

  let body: Record<string, unknown>;
  try { body = await req.json() as Record<string, unknown>; }
  catch { return badRequest('Invalid JSON body.'); }

  const label = String(body.label ?? '').trim();
  if (!label) return badRequest('A name is required.');
  if (label.length > 80) return badRequest('Name is too long.');

  // WHOEVER ADDS AN ENTRY SETS ITS BEHAVIOUR. A name with no behaviour is the
  // problem the catalog exists to solve, so method and stage are required and
  // are validated against the live unions rather than trusted.
  const method = String(body.method ?? '');
  const stage = String(body.stage ?? '');
  if (!(COST_METHODS as readonly string[]).includes(method)) return badRequest('Pick a method.');
  if (!(COST_STAGES as readonly string[]).includes(stage)) return badRequest('Pick a stage.');

  const phasingSource = String(body.phasingSource ?? 'inherit');
  if (!(CAPEX_PHASING_SOURCES as readonly string[]).includes(phasingSource)) return badRequest('Unknown phasing source.');
  const allocationBasis = String(body.allocationBasis ?? 'per_asset');
  if (!(ALLOCATION_BASES as readonly string[]).includes(allocationBasis)) return badRequest('Unknown allocation basis.');
  const scope = String(body.scope ?? 'indirect');
  if (!(COST_SCOPES as readonly string[]).includes(scope)) return badRequest('Unknown scope.');

  const entryId = normaliseCatalogId(label);
  if (!entryId) return badRequest('That name has no letters or digits to build an id from.');
  if (BUILT_IN_COST_CATALOG.some((e) => e.id === entryId)) {
    return badRequest('That entry already exists in the standard catalog.');
  }

  try {
    const sb = getServerClient();
    const { data, error } = await sb
      .from(TABLE)
      .upsert({
        user_id: userId,
        entry_id: entryId,
        label,
        method,
        stage,
        phasing_source: phasingSource,
        allocation_basis: allocationBasis,
        scope,
        hint: body.hint ? String(body.hint).slice(0, 200) : null,
        updated_at: new Date().toISOString(),
      }, { onConflict: 'user_id,entry_id' })
      .select('entry_id, label, method, stage, phasing_source, allocation_basis, scope, hint, created_at')
      .maybeSingle();
    if (error || !data) {
      return NextResponse.json({ error: error?.message ?? 'Could not save the entry.' }, { status: 503 });
    }
    return NextResponse.json({ entry: toEntry(data as Row) });
  } catch (e) {
    return NextResponse.json({ error: String(e) }, { status: 503 });
  }
}
