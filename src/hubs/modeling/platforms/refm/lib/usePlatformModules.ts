/**
 * usePlatformModules.ts (P-Sync, 2026-05-07)
 *
 * Fetches the per-platform module list from /api/platforms/[platformSlug]/modules
 * and converts each row into the SidebarNavItem shape the existing Sidebar
 * component already understands. Falls back to the static MODULES list while
 * the request is in flight or when the request errors so the sidebar never
 * renders empty.
 *
 * The dynamic source is the platform_modules Supabase table (added by the
 * p_sync_platform_modules.sql migration). Admins update it from
 * /admin/platform-modules; the workspace sidebar picks up the new shape on
 * next mount.
 */
'use client';

import { useEffect, useState } from 'react';
import { MODULES, type ModuleConfig } from './modules-config';

/**
 * The platform slug the REFM workspace reads its modules under. This is the
 * LEGACY `modules.slug` ('real-estate'), which is ALSO what the admin panel
 * writes to (admin's activePlatformSlug) and what the migration seeds. The
 * earlier P-Sync code read 'refm' here, which has no rows, so the fetch came
 * back empty and the sidebar silently fell back to the hardcoded static list,
 * ignoring admin order + visibility. Read and write MUST use the same slug.
 * verify-psync asserts this equals the migration seed slug.
 */
export const REFM_PLATFORM_SLUG = 'real-estate';

export interface SidebarNavItem {
  key: string;
  icon: string;
  label: string;
  featureKey: string | null;
  requiredPlan: 'free' | 'professional' | 'enterprise' | null;
  badge: string | null;
  badgeClass: string;
  disabled?: boolean;
  disabledReason?: string;
}

export interface FetchedModule {
  slug: string;
  number: number;
  name: string;
  short_name: string;
  description: string;
  icon_emoji: string | null;
  status: 'live' | 'coming_soon' | 'hidden' | 'pro' | 'enterprise';
  gating_tier: 'free' | 'pro' | 'enterprise';
  display_order: number;
}

const STATIC_NAV: readonly SidebarNavItem[] = [
  // Projects tab removed (2026-06-16): the Dashboard hub (project cards + New
  // Project) fully replaces it.
  { key: 'dashboard', icon: '📊', label: 'Dashboard', featureKey: null, requiredPlan: null, badge: null, badgeClass: '' },
  { key: 'overview', icon: '📋', label: 'Overview', featureKey: null, requiredPlan: null, badge: null, badgeClass: '', disabledReason: 'Select a project first' },
];

function staticModuleToNav(m: ModuleConfig): SidebarNavItem {
  return {
    key: m.key,
    icon: m.icon,
    label: `Module ${m.num}: ${m.shortLabel}`,
    featureKey: m.featureKey,
    requiredPlan: m.requiredPlan,
    badge: m.status === 'done' ? '✓' : m.status === 'soon' ? 'SOON' : null,
    badgeClass: m.status === 'done' ? 'badge-done' : m.status === 'soon' ? 'badge-soon' : '',
    disabled: m.disabled,
    disabledReason: m.disabledReason,
  };
}

function fetchedToNav(m: FetchedModule, position: number): SidebarNavItem {
  // Reuse the legacy `module1`..`moduleN` key shape so existing routing keeps
  // working (RealEstatePlatform switches the active view by this string). The
  // key is derived from the STABLE `number` (the module's component identity),
  // so admin reordering never re-points a row at a different component. The
  // DISPLAYED number is the 1-based position in display_order, so reordering
  // renumbers the sidebar cleanly without changing routing.
  const key = `module${m.number}`;
  const badge =
    m.status === 'live' ? '✓' :
    m.status === 'coming_soon' ? 'SOON' :
    m.status === 'pro' ? 'PRO' :
    m.status === 'enterprise' ? 'ENT' : null;
  const badgeClass =
    m.status === 'live' ? 'badge-done' :
    m.status === 'coming_soon' ? 'badge-soon' :
    m.status === 'pro' ? 'badge-pro' :
    m.status === 'enterprise' ? 'badge-enterprise' : '';
  const requiredPlan: SidebarNavItem['requiredPlan'] =
    m.gating_tier === 'free' ? 'free' :
    m.gating_tier === 'pro' ? 'professional' : 'enterprise';

  return {
    key,
    icon: m.icon_emoji ?? '·',
    label: `Module ${position}, ${m.short_name}`,
    featureKey: `module_${m.number}`,
    requiredPlan,
    badge,
    badgeClass,
    disabled: m.status !== 'live',
    disabledReason:
      m.status === 'pro' ? 'Requires Professional plan' :
      m.status === 'enterprise' ? 'Requires Enterprise plan' :
      m.status === 'coming_soon' ? 'Coming soon' :
      undefined,
  };
}

/** Static fallback: STATIC_NAV + the legacy MODULES list shaped as nav items. */
export const STATIC_SIDEBAR_MODULES: readonly SidebarNavItem[] = [
  ...STATIC_NAV,
  ...MODULES.map(staticModuleToNav),
];

/**
 * Pure transform: DB module rows -> ordered sidebar nav items. The single source
 * of truth for HOW admin data renders on the platform, so it can be unit-tested
 * (verify-psync) without the network. Hidden modules are dropped (defence in
 * depth: the public API already excludes them, but a hidden module must NEVER
 * reach the sidebar even if the API shape changes). Order follows display_order
 * (admin-reorderable), number is the stable tiebreak; the 1-based position drives
 * the displayed module number.
 */
export function toSidebarNavList(fetched: readonly FetchedModule[]): SidebarNavItem[] {
  return fetched
    .filter((m) => m.status !== 'hidden')
    .slice()
    .sort((a, b) => (a.display_order - b.display_order) || (a.number - b.number))
    .map((m, i) => fetchedToNav(m, i + 1));
}

/**
 * Returns the live sidebar module list for a given platform slug, with the
 * static MODULES list as a synchronous initial render so the sidebar never
 * blanks. On fetch success, dynamic data replaces it.
 */
export function usePlatformModules(platformSlug: string): {
  modules: readonly SidebarNavItem[];
  loaded: boolean;
} {
  const [modules, setModules] = useState<readonly SidebarNavItem[]>(STATIC_SIDEBAR_MODULES);
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    let cancelled = false;
    // no-store: admin reorder / hide changes must reflect on next mount, not
    // after the shared 5-minute CDN cache on the public GET expires.
    fetch(`/api/platforms/${platformSlug}/modules`, { cache: 'no-store' })
      .then((r) => (r.ok ? r.json() : null))
      .then((j) => {
        if (cancelled || !j || !Array.isArray(j.modules) || j.modules.length === 0) {
          setLoaded(true);
          return;
        }
        setModules([...STATIC_NAV, ...toSidebarNavList(j.modules as FetchedModule[])]);
        setLoaded(true);
      })
      .catch(() => {
        // Network / parse failure: keep static fallback.
        if (!cancelled) setLoaded(true);
      });
    return () => {
      cancelled = true;
    };
  }, [platformSlug]);

  return { modules, loaded };
}
