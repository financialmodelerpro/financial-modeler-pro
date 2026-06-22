import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/src/shared/auth/nextauth';
import { getServerClient } from '@/src/core/db/supabase';

// Per-feature CUSTOMER-FACING visibility toggle (mig 164). DISPLAY only: this
// writes features_registry.visible, which hides a NON-MODULE feature from the
// pricing pages + comparison table. It does NOT touch gating/enforcement, and
// it does NOT apply to module rows (module visibility = Modules tab).

async function checkAdmin() {
  const session = await getServerSession(authOptions);
  return session?.user && (session.user as { role?: string }).role === 'admin';
}

const isModuleKey = (k: string): boolean => /^module_\d+$/.test(k);

export async function PATCH(req: NextRequest) {
  if (!await checkAdmin()) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  try {
    const { feature_key, visible } = await req.json() as { feature_key: string; visible: boolean };
    if (!feature_key) return NextResponse.json({ error: 'feature_key required' }, { status: 400 });
    if (typeof visible !== 'boolean') return NextResponse.json({ error: 'visible must be boolean' }, { status: 400 });
    // Module rows are derived live from the registry; their visibility is the
    // Modules tab, not this column. Reject to avoid a second module control.
    if (isModuleKey(feature_key)) {
      return NextResponse.json({ error: 'Module visibility is controlled in the Modules tab, not here.' }, { status: 400 });
    }
    const sb = getServerClient();
    const { error } = await sb.from('features_registry').update({ visible, updated_at: new Date().toISOString() }).eq('feature_key', feature_key);
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    return NextResponse.json({ ok: true, feature_key, visible });
  } catch {
    return NextResponse.json({ error: 'Failed to update visibility' }, { status: 500 });
  }
}
