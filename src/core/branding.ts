import { BrandingConfig, PlatformEntry, PlatformOverride } from '../types/branding.types';
import { UserSubscription } from '../types/subscription.types';

// ── Storage key (bump version to clear stale cached configs) ─────────────────
export const BRANDING_KEY = 'fmp_branding_v3';

// ── Default branding ──────────────────────────────────────────────────────────
export const DEFAULT_BRANDING: BrandingConfig = {
  platformName:       'Financial Modeler Pro',
  portalTitle:        'Welcome to Financial Modeler Pro',
  portalSubtitle:     'FINANCIAL MODELING HUB',
  portalDescription:  'A professional suite of financial modeling and planning tools — built for real estate developers, corporate finance teams, and FP&A professionals. Select a platform below to begin.',
  footerText:         'Powered by Financial Modeler Pro — PaceMakers Advisory',

  portalLogoType:     'emoji',
  portalLogoEmoji:    '💼',
  portalLogoImage:    null,
  platformLogoType:   'emoji',
  platformLogoEmoji:  '🏗️',
  platformLogoImage:  null,

  primaryColor:   '#1E3A8A',
  secondaryColor: '#3B82F6',

  whiteLabel: {
    enabled:          false,
    clientName:       '',
    clientLogo:       null,
    clientPrimaryColor: null,
  },

  platforms:         null, // null → use PLATFORM_REGISTRY as-is
  platformOverrides: {},
  customDomain:      null,
};

// ── Platform registry ─────────────────────────────────────────────────────────
export const PLATFORM_REGISTRY: PlatformEntry[] = [
  {
    id:          'refm',
    name:        'Real Estate Financial Modeling',
    shortName:   'REFM Platform',
    description: 'Advanced real estate development and investment modeling platform. Full project lifecycle, financing structures, and financial schedules.',
    icon:        '🏗️',
    accentColor: '#1E3A8A',
    iconBg:      '#EFF6FF',
    status:      'active',
    version:     'v40',
  },
  {
    id:          'dcf',
    name:        '3 Statement & DCF Modeling',
    shortName:   'DCF Platform',
    description: 'Corporate financial modeling and valuation tools. Three-statement model, DCF valuation, and comparable company analysis.',
    icon:        '📊',
    accentColor: '#166534',
    iconBg:      '#F0FDF4',
    status:      'coming_soon',
    version:     null,
  },
  {
    id:          'fpa',
    name:        'FP&A Planning',
    shortName:   'FP&A Platform',
    description: 'Budgeting, forecasting, and financial planning tools. Driver-based models, rolling forecasts, and variance analysis.',
    icon:        '📈',
    accentColor: '#6D28D9',
    iconBg:      '#F5F3FF',
    status:      'coming_soon',
    version:     null,
  },
  {
    id:          'cashflow',
    name:        'Cash Flow Forecasting',
    shortName:   'Cash Flow Platform',
    description: 'Treasury and liquidity forecasting platform. 13-week cash flow, working capital management, and scenario planning.',
    icon:        '💧',
    accentColor: '#0369A1',
    iconBg:      '#F0F9FF',
    status:      'coming_soon',
    version:     null,
  },
];

// ── Subscription (stub — replace with real session lookup) ───────────────────
export const USER_SUBSCRIPTION: UserSubscription = {
  userId:    'user_001',
  plan:      'Professional',
  platforms: ['refm'],
};

// ── Load branding (sync: localStorage → DEFAULT) ─────────────────────────────
export function loadBranding(): BrandingConfig {
  if (typeof window === 'undefined') return { ...DEFAULT_BRANDING };
  try {
    const raw = localStorage.getItem(BRANDING_KEY);
    if (raw) {
      const parsed = JSON.parse(raw) as Partial<BrandingConfig>;
      // Deep-merge whiteLabel so partial saves don't lose subfields
      return {
        ...DEFAULT_BRANDING,
        ...parsed,
        whiteLabel: { ...DEFAULT_BRANDING.whiteLabel, ...(parsed.whiteLabel ?? {}) },
        platformOverrides: parsed.platformOverrides ?? {},
      };
    }
  } catch (_e) { /* ignore */ }
  return { ...DEFAULT_BRANDING };
}

// ── Fetch branding from Supabase (async — for enterprise/remote config) ───────
export async function fetchRemoteBranding(): Promise<BrandingConfig | null> {
  if (typeof window === 'undefined') return null;
  try {
    const url  = process.env.NEXT_PUBLIC_SUPABASE_URL;
    const key  = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
    if (!url || !key) return null;

    const res = await fetch(
      `${url}/rest/v1/branding_config?scope=eq.global&select=config&limit=1`,
      { headers: { apikey: key, Authorization: `Bearer ${key}` } },
    );
    if (!res.ok) return null;
    const rows = await res.json() as Array<{ config: Partial<BrandingConfig> }>;
    if (!rows.length || !rows[0].config) return null;

    const remote = rows[0].config;
    return {
      ...DEFAULT_BRANDING,
      ...remote,
      whiteLabel: { ...DEFAULT_BRANDING.whiteLabel, ...(remote.whiteLabel ?? {}) },
      platformOverrides: remote.platformOverrides ?? {},
    };
  } catch (_e) {
    return null;
  }
}

// ── Save branding (localStorage + Supabase if admin) ─────────────────────────
export function saveBranding(config: BrandingConfig): void {
  if (typeof window === 'undefined') return;
  try {
    localStorage.setItem(BRANDING_KEY, JSON.stringify(config));
  } catch (_e) { /* ignore quota errors */ }

  // Fire-and-forget Supabase save (enterprise tier / admin only)
  _pushToSupabase(config).catch(() => { /* non-fatal */ });
}

async function _pushToSupabase(config: BrandingConfig): Promise<void> {
  // Route through the API so the server can enforce the enterprise gate
  // on white-label fields and use the service-role key securely.
  await fetch('/api/branding', {
    method:  'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body:    JSON.stringify({ config, scope: 'global' }),
  });
}

// ── Derived display helpers ───────────────────────────────────────────────────

/** Returns the display logo for the portal header: image URL, emoji, or fallback '💼'. */
export function getPortalLogo(b: BrandingConfig): { type: 'image' | 'emoji'; value: string } {
  if (b.portalLogoType === 'image' && b.portalLogoImage) {
    return { type: 'image', value: b.portalLogoImage };
  }
  return { type: 'emoji', value: b.portalLogoEmoji || '💼' };
}

/** Returns the display logo for the platform toolbar: image URL, emoji, or fallback '🏗️'. */
export function getPlatformLogo(b: BrandingConfig): { type: 'image' | 'emoji'; value: string } {
  if (b.platformLogoType === 'image' && b.platformLogoImage) {
    return { type: 'image', value: b.platformLogoImage };
  }
  return { type: 'emoji', value: b.platformLogoEmoji || '🏗️' };
}

// ── Access control ────────────────────────────────────────────────────────────
export function hasAccess(platformId: string): boolean {
  return USER_SUBSCRIPTION.platforms.includes(platformId);
}

/** Feature-level access gate — enterprise-only features return false for lower plans. */
export function canAccessFeature(feature: 'white_label', plan: string): boolean {
  const enterpriseOnly: string[] = ['white_label'];
  if (enterpriseOnly.includes(feature)) return plan === 'enterprise';
  return true;
}

// ── Effective platforms for portal grid ──────────────────────────────────────
export function getEffectivePlatforms(branding: BrandingConfig): PlatformEntry[] {
  const overrides: PlatformOverride[] | null = branding.platforms;
  if (!overrides || !Array.isArray(overrides) || overrides.length === 0) {
    return PLATFORM_REGISTRY;
  }
  return PLATFORM_REGISTRY.map(reg => {
    const ov = overrides.find(p => p.id === reg.id);
    if (!ov) return reg;
    return {
      ...reg,
      name:        ov.name        ?? reg.name,
      description: ov.description ?? reg.description,
      status:      ov.status      ?? reg.status,
    };
  });
}
