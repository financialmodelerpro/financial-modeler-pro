import { getServerClient } from './supabase';

export interface ModelingComingSoonState {
  enabled: boolean;
  launchDate: string | null;
}

export async function getModelingComingSoonState(): Promise<ModelingComingSoonState> {
  try {
    const sb = getServerClient();
    const { data } = await sb
      .from('training_settings')
      .select('key,value')
      .in('key', ['modeling_hub_coming_soon', 'modeling_hub_launch_date']);
    const map = new Map((data ?? []).map((r: { key: string; value: string }) => [r.key, r.value]));
    const raw = map.get('modeling_hub_launch_date') ?? '';
    return {
      enabled: map.get('modeling_hub_coming_soon') === 'true',
      launchDate: raw && raw.trim() ? raw : null,
    };
  } catch {
    return { enabled: false, launchDate: null };
  }
}

export async function isModelingComingSoon(): Promise<boolean> {
  const s = await getModelingComingSoonState();
  return s.enabled;
}
