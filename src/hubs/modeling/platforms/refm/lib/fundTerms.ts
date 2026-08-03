/**
 * fundTerms.ts (REFM fund layer, Step 1: the toggle, and only the toggle)
 *
 * The fund layer adds management fee, preferred return, carry, and gross
 * versus net returns on top of a single development project. All of it is
 * gated on ONE project-level toggle that defaults OFF, so every project that
 * exists today keeps behaving exactly as it does today. See
 * docs/FUND_LAYER_GUIDELINE.md for the scope and the build sequence.
 *
 * This module is the read side of that toggle and nothing more. It is PURE:
 * no I/O, no state, no engine import, and at Step 1 it has no consumers at
 * all. It exists now so that the regression guard
 * (scripts/verify-fund-layer-guard.ts) can prove the toggle is inert BEFORE
 * any feature code is written, which is the whole point of doing Step 1 first.
 *
 * Deliberately NOT here yet: fee percentage, fee base, hurdle rate, carry
 * percentage, committed capital, fee share by party role. Those arrive with
 * the M1 Fund Terms tab at Step 2. Adding them here now would be feature code
 * hiding inside scaffolding.
 *
 * The default is OFF by OMISSION: `Project.fundTerms` is optional and no
 * project stamps it, so "absent" is the normal state rather than a value that
 * had to be written correctly. A malformed or partially-hydrated value also
 * resolves to off, because the only way this layer can be dangerous is by
 * switching itself on when nobody asked.
 *
 * No em dashes in this file.
 */

import type { Project } from './state/module1-types';

/** The toggle, resolved. Deliberately a record rather than a bare boolean:
 *  Step 2 adds fee and waterfall terms alongside `enabled`, and every caller
 *  written against this shape keeps compiling. */
export interface FundTerms {
  /** True only when the project explicitly turned the fund layer on. */
  enabled: boolean;
}

/** What a project with no fund terms means. Standalone, which is today. */
export const DEFAULT_FUND_TERMS: FundTerms = { enabled: false };

/**
 * Resolve a project's fund terms.
 *
 * Anything other than a literal `true` resolves to off: absent, undefined,
 * null, a non-object, or a non-boolean `enabled`. A snapshot written by an
 * older build, or a hand-edited jsonb, therefore cannot switch the fund layer
 * on by accident. Turning it ON has to be deliberate.
 */
export function resolveFundTerms(project: Pick<Project, 'fundTerms'> | null | undefined): FundTerms {
  const raw = project?.fundTerms;
  if (!raw || typeof raw !== 'object') return { ...DEFAULT_FUND_TERMS };
  return { enabled: raw.enabled === true };
}

/**
 * The one question every future fee, hurdle, carry and net-returns code path
 * must ask before it does anything. Kept as a named helper so the guard can
 * pin the default, and so no caller ever hand-rolls a truthiness check that
 * treats a stray string as on.
 */
export function isFundLayerActive(project: Pick<Project, 'fundTerms'> | null | undefined): boolean {
  return resolveFundTerms(project).enabled;
}
