export type LogoType = 'emoji' | 'image';

// ── Platform card entry (used in PLATFORM_REGISTRY and branding overrides) ────
export interface PlatformEntry {
  id: string;
  name: string;
  shortName: string;
  description: string;
  icon: string;
  accentColor: string;
  iconBg: string;
  status: 'active' | 'coming_soon';
  version: string | null;
}

// ── Per-platform override (editable name/description/status) ─────────────────
export interface PlatformOverride {
  id: string;
  name: string;
  description: string;
  status: 'active' | 'coming_soon';
}

// ── Central branding configuration ────────────────────────────────────────────
export interface BrandingConfig {
  // ── Platform identity (Topbar) ──
  platformName: string;
  platformLogoType: LogoType;
  platformLogoEmoji: string;
  platformLogoImage: string | null; // data-URL or remote URL

  // ── Colours (the only fields admins edit) ──
  primaryColor: string;    // hex, e.g. '#1E3A8A'
  secondaryColor: string;  // hex, e.g. '#3B82F6'

  // ── Platform cards (array of overrides shown on portal) ──
  platforms: PlatformOverride[] | null;

  // ── Per-platform deep overrides (future use) ──
  platformOverrides: Record<string, Partial<BrandingConfig>>;
}
