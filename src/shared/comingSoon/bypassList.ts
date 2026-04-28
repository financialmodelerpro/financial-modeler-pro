import { getServerClient } from '@/src/core/db/supabase';

/**
 * Training Hub Coming-Soon bypass list.
 *
 * Reads the `training_hub_bypass_list` row from `training_settings` —
 * a comma-separated list of identifiers (emails or registration IDs)
 * that can sign in while the hub is in Coming Soon mode. Match is
 * case-insensitive so regIDs can be stored in any case.
 *
 * Modeling Hub uses NextAuth's admin role for the same purpose; this
 * file is scoped to training only. Short TTL caching kept out on
 * purpose: calls are made at signin + on each server-gated layout
 * render, and settings rows are tiny.
 */

const BYPASS_KEY = 'training_hub_bypass_list';

export async function getTrainingBypassList(): Promise<string[]> {
  try {
    const sb = getServerClient();
    const { data } = await sb
      .from('training_settings')
      .select('value')
      .eq('key', BYPASS_KEY)
      .maybeSingle();
    const raw = (data?.value ?? '').trim();
    if (!raw) return [];
    return raw
      .split(',')
      .map((s: string) => s.trim().toLowerCase())
      .filter(Boolean);
  } catch {
    return [];
  }
}

/**
 * Returns true when the given identifier (email or regId) is on the
 * Training Hub bypass list. Never throws; a misconfigured or missing
 * settings row silently denies the bypass so the normal CS gate stays
 * in effect.
 */
export async function isTrainingIdentifierBypassed(identifier: string | null | undefined): Promise<boolean> {
  if (!identifier) return false;
  const needle = identifier.trim().toLowerCase();
  if (!needle) return false;
  const list = await getTrainingBypassList();
  return list.includes(needle);
}
