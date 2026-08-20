import { resolveComingSoonFromDate, type ComingSoonSource } from '@/src/shared/comingSoon/resolveFromDate';
import { getServerClient } from '@/src/core/db/supabase';

export interface ModelingComingSoonState {
  enabled:              boolean;
  launchDate:           string | null;
  /**
   * @deprecated 2026-08-20. RETIRED, READ BY NOTHING.
   *
   * It used to authorise a nightly cron to flip `modeling_hub_coming_soon`
   * once the launch date passed. The date now decides `enabled` directly, so
   * there is no firing to authorise, and Modeling has been removed from that
   * cron. Kept on the shape and in the database rather than deleted, so no
   * stored value is destroyed and any straggling reader still compiles.
   */
  autoLaunch:           boolean;
  /** ISO timestamp of the last time the cron auto-flipped this hub. Empty until the first firing. */
  lastAutoLaunchedAt:   string | null;
  /** How `enabled` was decided: the stored flag, or a launch date pending or
   *  passed. The admin card prints this so the reason is never guessed at. */
  source:               ComingSoonSource;
  /** One sentence naming that reason, for the admin card. */
  reason:               string;
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
    // THE LAUNCH DATE IS THE SINGLE SOURCE (2026-08-20). It used to sit beside
    // the flag doing nothing unless `modeling_hub_auto_launch` let a nightly
    // cron flip it, so a date could pass while the hub stayed shut and the
    // public banner said "launched". The date now decides whenever one is set;
    // with no date the stored flag decides exactly as before. See
    // src/shared/comingSoon/resolveFromDate.ts.
    const resolved = resolveComingSoonFromDate({
      flag: map.get('modeling_hub_coming_soon') === 'true',
      launchDate: rawDate,
      nowMs: Date.now(),
    });
    return {
      enabled:              resolved.enabled,
      launchDate:           rawDate || null,
      // RETIRED (2026-08-20). Nothing reads it: the date decides directly, so
      // there is no cron to authorise. Kept on the shape and in the database so
      // no stored value is destroyed and any reader still compiles.
      autoLaunch:           map.get('modeling_hub_auto_launch') === 'true',
      lastAutoLaunchedAt:   rawAuto || null,
      source:               resolved.source,
      reason:               resolved.reason,
    };
  } catch {
    // A read failure must not gate a live hub: fall open, and say so.
    return { enabled: false, launchDate: null, autoLaunch: false, lastAutoLaunchedAt: null,
      source: 'flag', reason: 'Could not read the launch settings; treating the hub as live.' };
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
