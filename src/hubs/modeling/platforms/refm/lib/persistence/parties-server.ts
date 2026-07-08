/**
 * parties-server.ts (REFM Module 1, migration 190)
 *
 * Server-side CRUD for `refm_parties` via the service-role client. Ownership is
 * enforced at the route boundary (each route first calls getProject(userId, id)),
 * matching the REFM convention that the application layer is the access boundary;
 * these helpers query strictly by project_id. Reads tolerate the table being
 * absent (pre-migration) by returning an empty list so the tab never crashes.
 *
 * No em dashes in this file.
 */

import { getServerClient } from '@/src/core/db/supabase';
import type { Party } from '../parties';

const COLS = 'id, project_id, name, identifier, roles, display_order';

function isMissingTable(err: { code?: string | null; message?: string | null } | null): boolean {
  if (!err) return false;
  return err.code === '42P01' || /relation .*refm_parties.* does not exist/i.test(err.message ?? '');
}

export async function listParties(projectId: string): Promise<{ rows: Party[]; error: string | null }> {
  const sb = getServerClient();
  const { data, error } = await sb
    .from('refm_parties')
    .select(COLS)
    .eq('project_id', projectId)
    .order('display_order', { ascending: true })
    .order('created_at', { ascending: true });
  if (error) {
    if (isMissingTable(error)) return { rows: [], error: null }; // pre-migration: empty tab, no crash
    return { rows: [], error: error.message };
  }
  return { rows: (data ?? []) as unknown as Party[], error: null };
}

export async function insertParty(projectId: string, party: {
  name: string; identifier: string | null; roles: string[]; display_order: number;
}): Promise<{ row: Party | null; error: string | null }> {
  const sb = getServerClient();
  const { data, error } = await sb
    .from('refm_parties')
    .insert({ project_id: projectId, ...party })
    .select(COLS)
    .single();
  if (error) return { row: null, error: error.message };
  return { row: data as unknown as Party, error: null };
}

export async function updateParty(projectId: string, partyId: string, patch: {
  name?: string; identifier?: string | null; roles?: string[]; display_order?: number;
}): Promise<{ row: Party | null; error: string | null }> {
  const sb = getServerClient();
  const { data, error } = await sb
    .from('refm_parties')
    .update({ ...patch, updated_at: new Date().toISOString() })
    .eq('project_id', projectId)
    .eq('id', partyId)
    .select(COLS)
    .maybeSingle();
  if (error) return { row: null, error: error.message };
  return { row: (data ?? null) as unknown as Party | null, error: null };
}

export async function deleteParty(projectId: string, partyId: string): Promise<{ error: string | null }> {
  const sb = getServerClient();
  const { error } = await sb
    .from('refm_parties')
    .delete()
    .eq('project_id', projectId)
    .eq('id', partyId);
  return { error: error?.message ?? null };
}
