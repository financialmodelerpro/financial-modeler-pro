import { getServerClient } from './supabase';

export interface TrainingComingSoonState {
  enabled:              boolean;
  launchDate:           string | null;
  /** When true + launchDate <= now, the auto-launch cron will flip `enabled` off. */
  autoLaunch:           boolean;
  /** ISO timestamp of the last time the cron auto-flipped this hub. Empty until the first firing. */
  lastAutoLaunchedAt:   string | null;
}

const KEYS = [
  'training_hub_coming_soon',
  'training_hub_launch_date',
  'training_hub_auto_launch',
  'training_hub_last_auto_launched_at',
] as const;

export async function getTrainingComingSoonState(): Promise<TrainingComingSoonState> {
  try {
    const sb = getServerClient();
    const { data } = await sb
      .from('training_settings')
      .select('key,value')
      .in('key', KEYS as unknown as string[]);
    const map = new Map((data ?? []).map((r: { key: string; value: string }) => [r.key, r.value]));
    const rawDate = (map.get('training_hub_launch_date') ?? '').trim();
    const rawAuto = (map.get('training_hub_last_auto_launched_at') ?? '').trim();
    return {
      enabled:              map.get('training_hub_coming_soon') === 'true',
      launchDate:           rawDate || null,
      autoLaunch:           map.get('training_hub_auto_launch') === 'true',
      lastAutoLaunchedAt:   rawAuto || null,
    };
  } catch {
    return { enabled: false, launchDate: null, autoLaunch: false, lastAutoLaunchedAt: null };
  }
}

export async function isTrainingComingSoon(): Promise<boolean> {
  const s = await getTrainingComingSoonState();
  return s.enabled;
}

/**
 * Separate Coming Soon state for /training/register (migration 135).
 * Independent from the signin toggle above so pre-launch can be
 * "signin open for existing students, register closed to new signups"
 * without conflating the two pages. Bypass list still applies on both.
 */
export interface TrainingRegisterComingSoonState {
  enabled:    boolean;
  launchDate: string | null;
}

const REGISTER_KEYS = [
  'training_hub_register_coming_soon',
  'training_hub_register_launch_date',
] as const;

export async function getTrainingRegisterComingSoonState(): Promise<TrainingRegisterComingSoonState> {
  try {
    const sb = getServerClient();
    const { data } = await sb
      .from('training_settings')
      .select('key,value')
      .in('key', REGISTER_KEYS as unknown as string[]);
    const map = new Map((data ?? []).map((r: { key: string; value: string }) => [r.key, r.value]));
    const rawDate = (map.get('training_hub_register_launch_date') ?? '').trim();
    return {
      enabled:    map.get('training_hub_register_coming_soon') === 'true',
      launchDate: rawDate || null,
    };
  } catch {
    return { enabled: false, launchDate: null };
  }
}
