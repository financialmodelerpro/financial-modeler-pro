import { getServerClient } from '@/src/core/db/supabase';

export interface ModelingComingSoonState {
  enabled:              boolean;
  launchDate:           string | null;
  /** When true + launchDate <= now, the auto-launch cron will flip `enabled` off. */
  autoLaunch:           boolean;
  /** ISO timestamp of the last time the cron auto-flipped this hub. Empty until the first firing. */
  lastAutoLaunchedAt:   string | null;
}

const KEYS = [
  'modeling_hub_coming_soon',
  'modeling_hub_launch_date',
  'modeling_hub_auto_launch',
  'modeling_hub_last_auto_launched_at',
] as const;

export async function getModelingComingSoonState(): Promise<ModelingComingSoonState> {
  try {
    const sb = getServerClient();
    const { data } = await sb
      .from('training_settings')
      .select('key,value')
      .in('key', KEYS as unknown as string[]);
    const map = new Map((data ?? []).map((r: { key: string; value: string }) => [r.key, r.value]));
    const rawDate = (map.get('modeling_hub_launch_date') ?? '').trim();
    const rawAuto = (map.get('modeling_hub_last_auto_launched_at') ?? '').trim();
    return {
      enabled:              map.get('modeling_hub_coming_soon') === 'true',
      launchDate:           rawDate || null,
      autoLaunch:           map.get('modeling_hub_auto_launch') === 'true',
      lastAutoLaunchedAt:   rawAuto || null,
    };
  } catch {
    return { enabled: false, launchDate: null, autoLaunch: false, lastAutoLaunchedAt: null };
  }
}

export async function isModelingComingSoon(): Promise<boolean> {
  const s = await getModelingComingSoonState();
  return s.enabled;
}

/**
 * Split signin + register Coming Soon toggles (migration 136). Admins can
 * gate the two pages independently so pre-launch can be "signin open for
 * early-whitelisted users, register closed to everyone" or vice versa.
 * The legacy single-toggle state above is retained for backward compat
 * with anything still reading `modeling_hub_coming_soon`; the signin and
 * register pages themselves plus `auth.ts` now read the split keys.
 */
export interface ModelingSigninComingSoonState {
  enabled:    boolean;
  launchDate: string | null;
}

const SIGNIN_KEYS = [
  'modeling_hub_signin_coming_soon',
  'modeling_hub_signin_launch_date',
] as const;

export async function getModelingSigninComingSoonState(): Promise<ModelingSigninComingSoonState> {
  try {
    const sb = getServerClient();
    const { data } = await sb
      .from('training_settings')
      .select('key,value')
      .in('key', SIGNIN_KEYS as unknown as string[]);
    const map = new Map((data ?? []).map((r: { key: string; value: string }) => [r.key, r.value]));
    const rawDate = (map.get('modeling_hub_signin_launch_date') ?? '').trim();
    return {
      enabled:    map.get('modeling_hub_signin_coming_soon') === 'true',
      launchDate: rawDate || null,
    };
  } catch {
    return { enabled: false, launchDate: null };
  }
}

export interface ModelingRegisterComingSoonState {
  enabled:    boolean;
  launchDate: string | null;
}

const REGISTER_KEYS = [
  'modeling_hub_register_coming_soon',
  'modeling_hub_register_launch_date',
] as const;

export async function getModelingRegisterComingSoonState(): Promise<ModelingRegisterComingSoonState> {
  try {
    const sb = getServerClient();
    const { data } = await sb
      .from('training_settings')
      .select('key,value')
      .in('key', REGISTER_KEYS as unknown as string[]);
    const map = new Map((data ?? []).map((r: { key: string; value: string }) => [r.key, r.value]));
    const rawDate = (map.get('modeling_hub_register_launch_date') ?? '').trim();
    return {
      enabled:    map.get('modeling_hub_register_coming_soon') === 'true',
      launchDate: rawDate || null,
    };
  } catch {
    return { enabled: false, launchDate: null };
  }
}
