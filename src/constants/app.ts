/**
 * Application-wide constants.
 * Single source of truth - update here, picks up everywhere.
 */

// ── Contact ────────────────────────────────────────────────────────────────────
export const CONTACT_SALES_EMAIL = 'sales@refm.pro';
export const CONTACT_SUPPORT_EMAIL = 'support@refm.pro';

// ── Layout ─────────────────────────────────────────────────────────────────────
export const SIDEBAR_WIDTH_EXPANDED  = 240;
export const SIDEBAR_WIDTH_COLLAPSED = 52;
export const TOPBAR_HEIGHT           = 52;
export const PORTAL_HEADER_HEIGHT    = 112;

// ── Branding theme darken amounts ──────────────────────────────────────────────
export const DARKEN_DARK  = 0.12;   // --color-primary-dark
export const DARKEN_DEEP  = 0.28;   // --color-primary-deep
export const DARKEN_NAVY  = 0.42;   // --color-primary-navy

// ── Permissions ────────────────────────────────────────────────────────────────
export const PERMISSIONS_LOAD_TIMEOUT_MS = 8_000;

// ── Project auto-save ──────────────────────────────────────────────────────────
export const AUTO_SAVE_INTERVAL_MS = 30_000;

// ── Plans ──────────────────────────────────────────────────────────────────────
export const PLAN_META = {
  free:         { label: 'Free',         color: '#6b7280', bg: '#f3f4f6', limit: 3  },
  professional: { label: 'Professional', color: '#2563eb', bg: '#dbeafe', limit: 20 },
  enterprise:   { label: 'Enterprise',   color: '#7c3aed', bg: '#ede9fe', limit: -1 },
} as const;

export const STATUS_META = {
  active:    { label: 'Active',    color: '#166534', bg: '#dcfce7' },
  trial:     { label: 'Trial',     color: '#92400e', bg: '#fef3c7' },
  expired:   { label: 'Expired',   color: '#991b1b', bg: '#fee2e2' },
  cancelled: { label: 'Cancelled', color: '#374151', bg: '#f3f4f6' },
} as const;
