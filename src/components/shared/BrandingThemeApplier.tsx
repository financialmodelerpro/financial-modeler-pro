'use client';

import { useEffect } from 'react';
import { useBrandingStore } from '@/src/core/core-state';
import { loadBranding } from '@/src/core/branding';
import { DARKEN_DARK, DARKEN_DEEP, DARKEN_NAVY } from '@/src/constants/app';

/**
 * Two responsibilities:
 * 1. Hydrates the branding store from localStorage on first mount
 *    (the store initialises with DEFAULT_BRANDING to avoid SSR/client mismatch).
 * 2. Injects branding colours into CSS custom properties on :root
 *    whenever the store changes, so every component picks them up instantly.
 */
export default function BrandingThemeApplier() {
  const branding    = useBrandingStore((s) => s.branding);
  const setBranding = useBrandingStore((s) => s.setBranding);

  // On first client render, load from localStorage and push into the store.
  // This runs only once (empty dep array) and is safe — no SSR involvement.
  useEffect(() => {
    const saved = loadBranding();
    setBranding(saved);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Apply colour tokens whenever branding changes.
  useEffect(() => {
    const root = document.documentElement;
    const wl   = branding.whiteLabel;

    const primary   = (wl.enabled && wl.clientPrimaryColor) ? wl.clientPrimaryColor : branding.primaryColor;
    const secondary = branding.secondaryColor;

    // Guard: if primary isn't a valid hex, fall back to the default navy
    const safePrimary = isValidHex(primary) ? primary : '#1E3A8A';

    root.style.setProperty('--color-primary',      safePrimary);
    root.style.setProperty('--color-primary-dark',  darken(safePrimary, DARKEN_DARK));
    root.style.setProperty('--color-primary-deep',  darken(safePrimary, DARKEN_DEEP));
    root.style.setProperty('--color-primary-navy',  darken(safePrimary, DARKEN_NAVY));
    root.style.setProperty('--color-secondary',     isValidHex(secondary) ? secondary : '#3B82F6');
  }, [branding]);

  return null;
}

/** Returns true if the string is a valid 3- or 6-digit hex colour. */
function isValidHex(hex: string): boolean {
  return /^#([0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/.test(hex ?? '');
}

/** Darken a hex colour by a fractional amount (0–1). */
function darken(hex: string, amount: number): string {
  // Expand shorthand #RGB → #RRGGBB
  const full = hex.length === 4
    ? `#${hex[1]}${hex[1]}${hex[2]}${hex[2]}${hex[3]}${hex[3]}`
    : hex;
  const n = parseInt(full.replace('#', ''), 16);
  const r = Math.max(0, Math.round(((n >> 16) & 255) * (1 - amount)));
  const g = Math.max(0, Math.round(((n >>  8) & 255) * (1 - amount)));
  const b = Math.max(0, Math.round(( n        & 255) * (1 - amount)));
  return `#${[r, g, b].map((v) => v.toString(16).padStart(2, '0')).join('')}`;
}
