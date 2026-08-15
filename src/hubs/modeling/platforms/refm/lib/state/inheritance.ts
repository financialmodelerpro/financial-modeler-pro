/**
 * inheritance.ts (REFM shared, 2026-08-15)
 *
 * ONE inherit-and-override mechanism, not three special cases.
 *
 * The pattern keeps recurring: a value is set once on a GROUP, every MEMBER
 * takes it, some members are DERIVED from another quantity entirely, and any
 * member can be broken out onto its own value. Capex phasing is the first
 * consumer (one curve per asset, RETT following the land cash outflow,
 * marketing and commission following collections, any line breakable out). The
 * consolidated input matrices will be the next, which is why this is a generic
 * primitive with no capex vocabulary in it.
 *
 * THE RESOLUTION ORDER, and why it is this way:
 *
 *   1. OWN. The member explicitly holds its own value. This is what "broken
 *      out" means, and it wins over everything so a user's explicit choice is
 *      never silently re-inherited.
 *   2. DERIVED. The member follows a named source (a curve computed from
 *      somewhere else in the model). A source that yields nothing FALLS
 *      THROUGH rather than resolving to empty, because a follower whose source
 *      has no data must not silently become zero: it degrades to the group
 *      value, then to the fallback, and SAYS SO in `reason`.
 *   3. GROUP. The value set once on the group.
 *   4. FALLBACK. What the member already had before any of this existed.
 *
 * Step 4 is the invariant that makes adoption safe: with nothing set anywhere,
 * every member resolves to its own stored value, so an existing project is
 * byte-identical until the user opts in.
 *
 * `Resolution` carries WHY as well as WHAT, because the UI has to show that a
 * member has stopped inheriting, and a badge derived from a second guess would
 * eventually disagree with the number.
 *
 * Pure. No React, no store, no I/O. No em dashes in this file.
 */

/** Where a member takes its value from. `own` and `inherit` are universal; any
 *  other string names a derived source the caller registered. */
export type InheritanceMode = 'inherit' | 'own' | (string & {});

/** How a resolved value was arrived at. */
export type ResolutionKind = 'own' | 'derived' | 'group' | 'fallback';

export interface Resolution<T> {
  value: T;
  kind: ResolutionKind;
  /** The derived source that supplied the value, when kind === 'derived'. */
  sourceId?: string;
  /** True when the member has stopped inheriting: it holds its own value, or
   *  follows a named source, rather than taking the group's. The UI shows this. */
  brokenOut: boolean;
  /** Plain sentence naming what happened, including the case where a requested
   *  source produced nothing and the resolution fell through. */
  reason: string;
  /** True when a named source was requested and yielded nothing, so the value
   *  came from further down the chain. Worth surfacing: it is the difference
   *  between "follows collections" and "follows collections, but there are
   *  none yet". */
  degraded: boolean;
}

export interface InheritanceRequest<T> {
  /** What the member asked for. Absent means `inherit`, which is what every
   *  pre-existing record carries and is why adoption is a no-op. */
  mode?: InheritanceMode;
  /** The member's own value, used when mode is `own`. */
  own?: T;
  /** The group's value, when the group has one. */
  group?: T;
  /** Named derived sources. A provider returns undefined when it has nothing,
   *  which makes the resolution fall through rather than resolve to empty. */
  derived?: Record<string, () => T | undefined>;
  /** What the member had before any of this existed. Always defined, so
   *  resolution can never fail. */
  fallback: T;
  /** Human label for the group, used in `reason` (e.g. "the asset curve"). */
  groupLabel?: string;
  /** Human labels for the derived sources, used in `reason`. */
  derivedLabels?: Record<string, string>;
}

/**
 * Resolve one member's value. Total: always returns a value, never throws.
 */
export function resolveInheritance<T>(req: InheritanceRequest<T>): Resolution<T> {
  const mode: InheritanceMode = req.mode ?? 'inherit';
  const groupLabel = req.groupLabel ?? 'the group value';

  // 1. OWN. An explicit break-out wins outright.
  if (mode === 'own') {
    if (req.own !== undefined) {
      return { value: req.own, kind: 'own', brokenOut: true, degraded: false,
        reason: 'Set on this row, so it does not follow anything.' };
    }
    // Declared own with nothing stored: the fallback IS its own value.
    return { value: req.fallback, kind: 'fallback', brokenOut: true, degraded: false,
      reason: 'Set on this row.' };
  }

  // 2. DERIVED. A named source, which may legitimately have nothing to give.
  if (mode !== 'inherit') {
    const label = req.derivedLabels?.[mode] ?? mode;
    const provider = req.derived?.[mode];
    const derivedValue = provider ? provider() : undefined;
    if (derivedValue !== undefined) {
      return { value: derivedValue, kind: 'derived', sourceId: mode, brokenOut: true, degraded: false,
        reason: `Follows ${label}.` };
    }
    // Fall through, but say so. A follower must not silently become empty.
    if (req.group !== undefined) {
      return { value: req.group, kind: 'group', sourceId: mode, brokenOut: true, degraded: true,
        reason: `Set to follow ${label}, but there is nothing to follow yet, so it uses ${groupLabel}.` };
    }
    return { value: req.fallback, kind: 'fallback', sourceId: mode, brokenOut: true, degraded: true,
      reason: `Set to follow ${label}, but there is nothing to follow yet, so it keeps its own setting.` };
  }

  // 3. GROUP.
  if (req.group !== undefined) {
    return { value: req.group, kind: 'group', brokenOut: false, degraded: false,
      reason: `Inherits ${groupLabel}.` };
  }

  // 4. FALLBACK. No group set: the member keeps exactly what it had, which is
  //    what makes this whole mechanism inert on an untouched project.
  return { value: req.fallback, kind: 'fallback', brokenOut: false, degraded: false,
    reason: `Uses its own setting (${groupLabel} is not set).` };
}

/** True when the resolution should be badged in the UI as no longer inheriting. */
export function isBrokenOut<T>(r: Resolution<T>): boolean { return r.brokenOut; }
