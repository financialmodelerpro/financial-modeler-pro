'use client';

import { useBrandingStore } from '@/src/core/core-state';
import { getPlatformLogo } from '@/src/core/branding';
import type { BrandingConfig } from '@/src/types/branding.types';

export interface WhiteLabelResult {
  isWhiteLabel: boolean;
  displayName: string;      // clientName or platformName
  displayLogo: string | null; // image URL if available, null = use emoji
  displayLogoEmoji: string;   // emoji fallback
  footerText: string;         // client footer or standard footer
  primaryColor: string;       // client or platform primary colour
  effective: BrandingConfig;  // merged config (base + platform overrides)
}

/**
 * Single source of truth for white-label display values.
 * All UI components must import from this hook - never read
 * whiteLabel config directly in components.
 */
export function useWhiteLabel(): WhiteLabelResult {
  const { branding, currentPlatform } = useBrandingStore();

  // Apply per-platform overrides when inside a specific platform
  const overrides = currentPlatform
    ? (branding.platformOverrides[currentPlatform] ?? {})
    : {};
  const effective: BrandingConfig = { ...branding, ...overrides };

  const wl = effective.whiteLabel;
  const isWhiteLabel = wl.enabled && !!wl.clientName;

  // Name
  const displayName = isWhiteLabel ? wl.clientName : effective.platformName;

  // Logo
  const platformLogoResult = getPlatformLogo(effective);
  const displayLogo: string | null = isWhiteLabel && wl.clientLogo
    ? wl.clientLogo
    : platformLogoResult.type === 'image'
      ? platformLogoResult.value
      : null;

  const displayLogoEmoji: string = isWhiteLabel && wl.clientLogo
    ? ''
    : platformLogoResult.type === 'emoji'
      ? platformLogoResult.value
      : (effective.platformLogoEmoji || '🏗️');

  // Footer
  const footerText = isWhiteLabel
    ? `© ${wl.clientName} - Powered by Financial Modeler Pro`
    : effective.footerText;

  // Colour
  const primaryColor = isWhiteLabel && wl.clientPrimaryColor
    ? wl.clientPrimaryColor
    : effective.primaryColor;

  return {
    isWhiteLabel,
    displayName,
    displayLogo,
    displayLogoEmoji,
    footerText,
    primaryColor,
    effective,
  };
}
