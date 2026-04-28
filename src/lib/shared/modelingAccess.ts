import { getServerClient } from '@/src/core/db/supabase';
import {
  getModelingSigninComingSoonState,
  getModelingRegisterComingSoonState,
} from './modelingComingSoon';

/**
 * Modeling Hub access gate (migration 136).
 *
 * Training Hub uses a comma-separated settings string + NextAuth admin role
 * to bypass its Coming Soon gate. Modeling Hub splits the two toggles and
 * uses a real `modeling_access_whitelist` table so admins can manage entries
 * with a proper UI, per-row notes, and audit timestamps.
 *
 * Gate semantics:
 *   - Toggle OFF (CS disabled)   -> anyone can access (hub is live)
 *   - Toggle ON  (CS enabled)    -> only admins + whitelisted emails allowed
 *
 * All checks are email-based because register + confirm-email happen before
 * the user has a session. Admin role is resolved by querying `users.role`
 * for that email; a whitelist hit is independent of whether a user row even
 * exists yet (so admins can invite friends who haven't signed up).
 */

export interface ModelingAccessCheck {
  allowed: boolean;
  reason:  'hub_open' | 'admin' | 'whitelisted' | 'gated';
}

const LIST_TABLE = 'modeling_access_whitelist';

export async function isEmailWhitelisted(email: string | null | undefined): Promise<boolean> {
  if (!email) return false;
  const needle = email.trim().toLowerCase();
  if (!needle) return false;
  try {
    const sb = getServerClient();
    const { data } = await sb
      .from(LIST_TABLE)
      .select('id')
      .ilike('email', needle)
      .maybeSingle();
    return !!data;
  } catch {
    return false;
  }
}

export async function isEmailAdmin(email: string | null | undefined): Promise<boolean> {
  if (!email) return false;
  const needle = email.trim().toLowerCase();
  if (!needle) return false;
  try {
    const sb = getServerClient();
    const { data } = await sb
      .from('users')
      .select('role')
      .eq('email', needle)
      .maybeSingle();
    return (data?.role === 'admin');
  } catch {
    return false;
  }
}

export async function canEmailSigninModeling(email: string | null | undefined): Promise<ModelingAccessCheck> {
  const cs = await getModelingSigninComingSoonState();
  if (!cs.enabled) return { allowed: true, reason: 'hub_open' };
  if (await isEmailAdmin(email))        return { allowed: true, reason: 'admin' };
  if (await isEmailWhitelisted(email))  return { allowed: true, reason: 'whitelisted' };
  return { allowed: false, reason: 'gated' };
}

export async function canEmailRegisterModeling(email: string | null | undefined): Promise<ModelingAccessCheck> {
  const cs = await getModelingRegisterComingSoonState();
  if (!cs.enabled) return { allowed: true, reason: 'hub_open' };
  if (await isEmailAdmin(email))        return { allowed: true, reason: 'admin' };
  if (await isEmailWhitelisted(email))  return { allowed: true, reason: 'whitelisted' };
  return { allowed: false, reason: 'gated' };
}

export interface WhitelistEntry {
  id:       string;
  email:    string;
  note:     string | null;
  added_by: string | null;
  added_at: string;
}

export async function listWhitelist(): Promise<WhitelistEntry[]> {
  try {
    const sb = getServerClient();
    const { data } = await sb
      .from(LIST_TABLE)
      .select('id, email, note, added_by, added_at')
      .order('added_at', { ascending: false });
    return (data ?? []) as WhitelistEntry[];
  } catch {
    return [];
  }
}
