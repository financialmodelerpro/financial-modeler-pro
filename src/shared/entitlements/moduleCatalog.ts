/**
 * moduleCatalog.ts
 *
 * Single source for turning live platform_modules rows into entitlement
 * (Plan Builder) module rows. Pure, isomorphic (no client/server-only imports),
 * so the admin API, the sidebar hook, and verify scripts all share it.
 *
 * The module's stable identity is its SLUG (the immutable anchor across every
 * migration). The DB `number` is mutable (seed had reports=6/scenarios=7;
 * migration 157 swaps them, and 154/157 temp-park numbers to dodge the UNIQUE
 * constraint), so the entitlement feature_key is derived from the slug, never
 * from `number`. This keeps plan_permissions assignments (keyed by feature_key)
 * stable even as admins reorder or renumber modules.
 *
 * No em dashes in this file.
 */

export const SLUG_TO_COMPONENT_NUMBER: Readonly<Record<string, number>> = {
  'project-setup': 1,
  revenue: 2,
  opex: 3,
  financials: 4,
  returns: 5,
  scenarios: 6,
  reports: 7,
  portfolio: 8,
  'market-data': 9,
  collaborate: 10,
  'api-access': 11,
};

/** Stable component number for a module row (slug first, number fallback). */
export function moduleComponentNumber(slug: string, number: number): number {
  return SLUG_TO_COMPONENT_NUMBER[slug] ?? number;
}

/** Entitlement feature_key for a module row, matching the gate + plan_permissions. */
export function moduleFeatureKey(slug: string, number: number): string {
  return `module_${moduleComponentNumber(slug, number)}`;
}

export type LiveModuleStatus = 'live' | 'coming_soon' | 'hidden' | 'pro' | 'enterprise';

/** Minimal shape of a platform_modules row this module needs. */
export interface LiveModuleInput {
  slug: string;
  number: number;
  name: string;
  short_name: string;
  status: LiveModuleStatus;
  display_order: number;
}

/** A Plan Builder feature row derived from a live module (matrix-compatible). */
export interface ModuleFeatureRow {
  feature_key: string;
  label: string;
  category: 'module';
  feature_type: 'gate';
  /** Carried for type-compatibility with catalog features; not shown for
   *  modules (moduleStatus drives the tag instead). */
  build_status: 'live';
  /** Live status from the registry, drives the on-row tag. */
  moduleStatus: Exclude<LiveModuleStatus, 'hidden'>;
  display_order: number;
  active: true;
}

/** A live module paired with the number the UI should DISPLAY for it. */
export interface OrderedModule<T> {
  module: T;
  /** 1-based position in display_order. THIS is the number users see. */
  position: number;
}

/**
 * THE single source of truth for module display numbering.
 *
 * `platform_modules.number` is a stable ROUTING id (see SLUG_TO_COMPONENT_NUMBER
 * above), not a display number: it never renumbers when an admin reorders or
 * hides a module, which is exactly what makes it safe for routing and wrong for
 * display. Every user-facing surface instead numbers modules by their 1-based
 * position in display_order, so admin reordering renumbers everything cleanly.
 *
 * The admin panel (/admin/platform-modules renders `i + 1`), the workspace
 * sidebar (toSidebarNavList) and Plan Builder (deriveModuleFeatureRows) all
 * follow this rule. The public marketing page used to render the raw `number`
 * instead, which is why it showed "Module 10: Collaborate" while admin and the
 * platform both showed "Module 8, Collaborate". Route every surface through
 * this helper so they cannot disagree again.
 *
 * Hidden modules are dropped before numbering, so positions are contiguous on
 * every public surface.
 */
export function orderModulesForDisplay<T extends LiveModuleInput>(
  modules: readonly T[],
): OrderedModule<T>[] {
  return modules
    .filter((m) => m.status !== 'hidden')
    .slice()
    .sort((a, b) => (a.display_order - b.display_order) || (a.number - b.number))
    .map((module, i) => ({ module, position: i + 1 }));
}

/**
 * Derive Plan Builder module rows from the live registry. Hidden modules are
 * dropped entirely (defence in depth: getPlatformModules already excludes them).
 * Order follows display_order (admin-reorderable), number is the stable tiebreak.
 * The displayed module number is the 1-based position; the feature_key is the
 * stable slug-derived identity, so assignments survive reorder.
 */
export function deriveModuleFeatureRows(modules: readonly LiveModuleInput[]): ModuleFeatureRow[] {
  return orderModulesForDisplay(modules).map(({ module: m, position }) => ({
    feature_key: moduleFeatureKey(m.slug, m.number),
    label: `Module ${position}: ${m.short_name || m.name}`,
    category: 'module' as const,
    feature_type: 'gate' as const,
    build_status: 'live' as const,
    moduleStatus: m.status as Exclude<LiveModuleStatus, 'hidden'>,
    display_order: position,
    active: true as const,
  }));
}

/** Format a limit cap for display: -1 renders as "Unlimited". */
export function formatLimit(value: number | null): string {
  if (value === null || value === undefined) return '';
  if (value === -1) return 'Unlimited';
  return String(value);
}
