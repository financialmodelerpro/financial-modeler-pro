import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/src/shared/auth/nextauth';
import { getServerClient } from '@/src/core/db/supabase';

// Bulk write the feature-by-plan matrix to plan_permissions. included drives
// gate features; limit_value drives limit features. One upsert per changed cell
// on conflict (plan_key, feature_key). No prices, no marketing tables.

async function checkAdmin() {
  const session = await getServerSession(authOptions);
  return session?.user && (session.user as { role?: string }).role === 'admin';
}

interface CellRow {
  plan_key: string;
  feature_key: string;
  included: boolean;
  limit_value: number | null;
}

export async function PATCH(req: NextRequest) {
  if (!await checkAdmin()) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  try {
    const { rows } = await req.json() as { rows: CellRow[] };
    if (!Array.isArray(rows)) return NextResponse.json({ error: 'rows[] required' }, { status: 400 });
    const sb = getServerClient();

    const payload = rows.map((r) => ({
      plan_key: r.plan_key,
      feature_key: r.feature_key,
      included: !!r.included,
      limit_value: r.limit_value === null || r.limit_value === undefined || Number.isNaN(r.limit_value)
        ? null
        : Number(r.limit_value),
      updated_at: new Date().toISOString(),
    }));

    const { error } = await sb.from('plan_permissions').upsert(payload, { onConflict: 'plan_key,feature_key' });
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    return NextResponse.json({ ok: true, count: payload.length });
  } catch {
    return NextResponse.json({ error: 'Failed to save permissions' }, { status: 500 });
  }
}
