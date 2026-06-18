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

/**
 * Derive Plan Builder module rows from the live registry. Hidden modules are
 * dropped entirely (defence in depth: getPlatformModules already excludes them).
 * Order follows display_order (admin-reorderable), number is the stable tiebreak.
 * The displayed module number is the 1-based position; the feature_key is the
 * stable slug-derived identity, so assignments survive reorder.
 */
export function deriveModuleFeatureRows(modules: readonly LiveModuleInput[]): ModuleFeatureRow[] {
  return modules
    .filter((m) => m.status !== 'hidden')
    .slice()
    .sort((a, b) => (a.display_order - b.display_order) || (a.number - b.number))
    .map((m, i) => ({
      feature_key: moduleFeatureKey(m.slug, m.number),
      label: `Module ${i + 1}: ${m.short_name || m.name}`,
      category: 'module' as const,
      feature_type: 'gate' as const,
      build_status: 'live' as const,
      moduleStatus: m.status as Exclude<LiveModuleStatus, 'hidden'>,
      display_order: i + 1,
      active: true as const,
    }));
}

/** Format a limit cap for display: -1 renders as "Unlimited". */
export function formatLimit(value: number | null): string {
  if (value === null || value === undefined) return '';
  if (value === -1) return 'Unlimited';
  return String(value);
}
