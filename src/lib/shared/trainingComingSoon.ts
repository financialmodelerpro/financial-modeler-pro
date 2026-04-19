import { getServerClient } from './supabase';

export interface TrainingComingSoonState {
  enabled: boolean;
  launchDate: string | null;
}

export async function getTrainingComingSoonState(): Promise<TrainingComingSoonState> {
  try {
    const sb = getServerClient();
    const { data } = await sb
      .from('training_settings')
      .select('key,value')
      .in('key', ['training_hub_coming_soon', 'training_hub_launch_date']);
    const map = new Map((data ?? []).map((r: { key: string; value: string }) => [r.key, r.value]));
    const raw = map.get('training_hub_launch_date') ?? '';
    return {
      enabled: map.get('training_hub_coming_soon') === 'true',
      launchDate: raw && raw.trim() ? raw : null,
    };
  } catch {
    return { enabled: false, launchDate: null };
  }
}

export async function isTrainingComingSoon(): Promise<boolean> {
  const s = await getTrainingComingSoonState();
  return s.enabled;
}
