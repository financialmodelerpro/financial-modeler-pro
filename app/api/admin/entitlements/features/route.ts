import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/src/shared/auth/nextauth';
import { getServerClient } from '@/src/core/db/supabase';

// Per-feature DISPLAY-only writes to features_registry. Two fields:
//   - visible (mig 164): customer-facing visibility for a NON-MODULE feature
//     (module visibility lives in the Modules tab, so module keys are rejected).
//   - description (mig 168): short blurb shown as the pricing info popover,
//     allowed for ALL rows (module + non-module) since modules have a blurb too.
// Neither touches gating/enforcement.

async function checkAdmin() {
  const session = await getServerSession(authOptions);
  return session?.user && (session.user as { role?: string }).role === 'admin';
}

const isModuleKey = (k: string): boolean => /^module_\d+$/.test(k);

export async function PATCH(req: NextRequest) {
  if (!await checkAdmin()) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  try {
    const { feature_key, visible, description } = await req.json() as { feature_key: string; visible?: boolean; description?: string | null };
    if (!feature_key) return NextResponse.json({ error: 'feature_key required' }, { status: 400 });

    const updates: Record<string, unknown> = { updated_at: new Date().toISOString() };

    if (visible !== undefined) {
      if (typeof visible !== 'boolean') return NextResponse.json({ error: 'visible must be boolean' }, { status: 400 });
      // Module rows are derived live from the registry; their visibility is the
      // Modules tab, not this column. Reject to avoid a second module control.
      if (isModuleKey(feature_key)) {
        return NextResponse.json({ error: 'Module visibility is controlled in the Modules tab, not here.' }, { status: 400 });
      }
      updates.visible = visible;
    }

    if (description !== undefined) {
      // Allowed for module + non-module keys. Empty/blank clears to null.
      const d = typeof description === 'string' ? description.trim() : '';
      updates.description = d === '' ? null : d;
    }

    if (Object.keys(updates).length === 1) {
      return NextResponse.json({ error: 'nothing to update' }, { status: 400 });
    }

    const sb = getServerClient();
    const { error } = await sb.from('features_registry').update(updates).eq('feature_key', feature_key);
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    return NextResponse.json({ ok: true, feature_key, ...('visible' in updates ? { visible: updates.visible } : {}), ...('description' in updates ? { description: updates.description } : {}) });
  } catch {
    return NextResponse.json({ error: 'Failed to update feature' }, { status: 500 });
  }
}
