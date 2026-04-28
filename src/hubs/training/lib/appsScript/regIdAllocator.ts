/**
 * Supabase-native RegID allocator.
 *
 * Replaces Apps Script's role in generating sequential `FMP-YYYY-NNNN`
 * registration IDs at confirm-email time. The underlying allocation is
 * done by the SQL function `next_training_reg_id(year)` (migration 133),
 * which takes a per-year advisory lock to serialize concurrent calls.
 * The UNIQUE index on `training_registrations_meta.registration_id`
 * (migration 129) is the hard guard; this helper retries a small number
 * of times if an INSERT somehow races past the lock.
 *
 * Usage from the confirm-email route:
 *
 *   import { allocateRegistrationId } from '@/src/hubs/training/lib/appsScript/regIdAllocator';
 *   const reg = await allocateRegistrationId(sb);   // "FMP-2026-0012"
 *   await sb.from('training_registrations_meta').insert({ registration_id: reg, ... });
 *
 * Note that this helper only ALLOCATES an ID; it doesn't write anything.
 * The caller is responsible for the subsequent INSERT and, if it fails on
 * UNIQUE (pre-existing registration_id), calling this helper again for a
 * fresh ID.
 */

import type { SupabaseClient } from '@supabase/supabase-js';

/** Year to key the RegID against. Defaults to the current UTC year. */
function currentYear(): number {
  return new Date().getUTCFullYear();
}

/**
 * Calls `next_training_reg_id(year)` as a Supabase RPC and returns the
 * allocated ID. Throws if the RPC returns an error.
 */
export async function allocateRegistrationId(
  sb:   SupabaseClient,
  year: number = currentYear(),
): Promise<string> {
  const { data, error } = await sb.rpc('next_training_reg_id', { p_year: year });
  if (error) {
    throw new Error(`allocateRegistrationId RPC failed: ${error.message}`);
  }
  const id = typeof data === 'string' ? data : String(data ?? '');
  if (!/^FMP-\d{4}-\d{4}$/.test(id)) {
    throw new Error(`allocateRegistrationId returned unexpected shape: ${JSON.stringify(data)}`);
  }
  return id;
}
