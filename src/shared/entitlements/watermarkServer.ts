/**
 * watermarkServer.ts (2026-08-20, server)
 *
 * Loads the stored watermark settings. Kept apart from exportWatermark.ts so
 * the admin client component and the PDF builders can import the pure rules
 * without pulling a Supabase client into the browser bundle, which is the same
 * split pricingPageSettings / pricingCatalog already uses.
 *
 * FAILS TOWARDS THE WATERMARK. Every other settings loader in this codebase
 * falls back to its default on an error, and so does this one, but here the
 * default is `enabled: true` for trial. That direction is deliberate: an
 * unreadable settings row must not be a way to obtain an unmarked trial
 * export. The cost of the other direction is a spurious mark on a paid export
 * during a database outage; the cost of this direction is nothing, because a
 * paid plan is not in the default list.
 *
 * No em dashes in this file.
 */
import type { SupabaseClient } from '@supabase/supabase-js';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/src/shared/auth/nextauth';
import { getServerClient } from '@/src/core/db/supabase';
import { resolveUserGate } from './resolveUser';
import {
  DEFAULT_WATERMARK_SETTINGS,
  WATERMARK_SECTION,
  WATERMARK_KEY,
  parseWatermarkSettings,
  resolveWatermarkSpec,
  type WatermarkSettings,
  type WatermarkSpec,
} from './exportWatermark';

export async function loadWatermarkSettings(sb: SupabaseClient): Promise<WatermarkSettings> {
  try {
    const { data } = await sb
      .from('cms_content')
      .select('value')
      .eq('section', WATERMARK_SECTION)
      .eq('key', WATERMARK_KEY)
      .maybeSingle();
    const raw = (data as { value: string | null } | null)?.value ?? null;
    if (raw === null || raw.trim() === '') return DEFAULT_WATERMARK_SETTINGS;
    // Stored as a JSON string in the shared cms_content `value` column, so the
    // existing admin content route can write it with no new table and no new
    // migration. A row that is not valid JSON is treated as no row.
    try {
      return parseWatermarkSettings(JSON.parse(raw));
    } catch {
      return DEFAULT_WATERMARK_SETTINGS;
    }
  } catch {
    return DEFAULT_WATERMARK_SETTINGS;
  }
}

/**
 * The resolved spec for an already-resolved gate.
 *
 * Separate from the session form below because a caller that has already paid
 * for a `resolveUserGate` (the deck route, which needs it for the module
 * check) must not pay for a second one, and because passing the gate makes it
 * impossible for the two answers to come from different resolutions.
 */
export async function resolveWatermarkForGate(
  gate: { planKey: string },
): Promise<WatermarkSpec | null> {
  const settings = await loadWatermarkSettings(getServerClient());
  return resolveWatermarkSpec(gate.planKey, settings);
}

/**
 * The resolved spec for the current session, resolving the gate itself.
 *
 * Returns null when there is no session to resolve. That is not a hole: every
 * route calling this has already established a session and ownership of its
 * own, so a null here means "no plan to be on", not "unauthenticated caller
 * slipping through".
 */
export async function resolveWatermarkForSession(): Promise<WatermarkSpec | null> {
  try {
    const session = await getServerSession(authOptions);
    const u = session?.user as { id?: string; role?: string } | undefined;
    if (!u?.id) return null;
    const gate = await resolveUserGate(u.id, { sessionIsAdmin: u.role === 'admin' });
    return resolveWatermarkForGate(gate);
  } catch {
    return null;
  }
}
