/**
 * moduleVisibility.ts
 *
 * WHICH REFM MODULES EACH COLLABORATION ROLE CAN SEE.
 *
 * This map used to sit in `src/core/state/index.ts` beside the role table,
 * which put a REFM-only fact in the one file every platform is meant to share:
 * its keys are `module1`..`module7`, REFM's module list and nobody else's. ERM
 * and BVM will have different modules and a different count, so the map is
 * per-platform and the ROLES are not. Moved 2026-09-01 (Module 10 step 0).
 *
 * The vocabulary itself stays shared, in `src/core/collab/projectRoles.ts`.
 *
 * ── THE EDITOR / RETURNS EXCLUSION WAS AN OMISSION, AND IS FIXED ──────────
 *
 * Carried over verbatim through step 0, which was a rename and must not
 * smuggle a behaviour change in beside it, with one entry flagged as probably
 * wrong: the editor (then "analyst") got every module EXCEPT module 5,
 * Returns. An editor who can change construction costs but cannot see what
 * that did to the IRR is not a coherent role.
 *
 * SETTLED FROM THE HISTORY, 2026-09-02, and it was an OMISSION with a
 * traceable cause rather than a decision. The original map (js/settings.js,
 * March 2026) carried its own legend:
 *
 *   ANALYST -> Dashboard, Projects, Overview, Module 1 (Setup/Land/Costs/
 *              Financing), Module 2 (Revenue), Module 3 (OpEx),
 *              MODULE 4 (RETURNS), Module 6 (Reports)
 *
 * and its list granted the analyst a named `returns` screen outright. The
 * analyst was ALWAYS meant to see Returns.
 *
 * What happened is a collision between two numbering schemes. When the named
 * slugs were dropped and the modules renumbered, Returns moved from 4 to 5.
 * The analyst list was carried across POSITIONALLY, keeping `module1` to
 * `module4` and excluding `module5`. It still reads like "modules 1 through
 * 4", but the thing that exclusion was about moved out from under it, and
 * what it now excludes is precisely the screen the legend says the analyst
 * should have. The exclusion is not a judgement about Returns; it is a
 * judgement about a module that no longer bears that number.
 *
 * So `module5` is restored to the editor. This is the ONE behaviour change in
 * this map, made in the step where a role is finally resolved from the server
 * and the effect is visible, rather than hidden inside a rename.
 *
 * ── THE REVIEWER SEES EVERY MODULE (2026-09-03, Module 10 step 7) ─────────
 *
 * The reviewer's list was `dashboard, projects, module6, module7`: the
 * dashboard, the scenario comparison and the IC deck, and nothing else. That
 * hid Modules 1 to 5, which is every screen the model is actually built on.
 *
 * Comments (step 7) make that untenable rather than merely odd. A reviewer is
 * the role whose whole purpose is to read the model and say something about
 * it, and a comment anchors to a snapshot path such as
 * `assets[id=x].buaSqm`, which lives on the Capex tab inside Module 1. A
 * reviewer who cannot open Module 1 cannot see the field they are being asked
 * to review, and the role's own description in PROJECT_ROLE_META already
 * promises them "View the model and reports and leave comments for the
 * editor". This map was the half of that promise nothing kept.
 *
 * SO THE REVIEWER NOW SEES WHAT AN EDITOR SEES. What separates the two is the
 * PERMISSION MATRIX, not this map: `canEditInputs`, `canSave` and
 * `canManageVersions` are all false for a reviewer, enforced server-side by
 * `getProjectForWrite`, and the shell renders read-only through the same
 * view-lock path a locked model already uses. Visibility answers "may I look
 * at this screen"; it was never what stopped a reviewer writing, and leaning
 * on it as a second, weaker write gate hid where the real one lives.
 *
 * THE VIEWER IS UNCHANGED, deliberately. A viewer reads the dashboard and the
 * reports and does not comment (`canAddComments` is false), so there is no
 * field they need to reach and no promise to keep.
 *
 * A CONSEQUENCE, STATED: visibility no longer narrows monotonically down the
 * role order. Reviewer and editor see the same screens. That is the intended
 * shape rather than a gap, and `verify-role-enforcement` F4 now pins the new
 * rule instead of the old descending count.
 *
 * No em dashes in this file.
 */
import type { ProjectRole } from '@/src/core/collab/projectRoles';
import type { ModuleKey } from '@/src/core/types/settings.types';

export const REFM_MODULE_VISIBILITY: Record<ProjectRole, ModuleKey[]> = {
  owner:    ['dashboard', 'projects', 'overview', 'module1', 'module2', 'module3', 'module4', 'module5', 'module6', 'module7'],
  // module5 (Returns) RESTORED 2026-09-02. It was dropped by a renumbering,
  // not by a decision: see the header. An editor who can change costs must be
  // able to see what that did to the returns.
  editor:   ['dashboard', 'projects', 'overview', 'module1', 'module2', 'module3', 'module4', 'module5', 'module6', 'module7'],
  // FULL READ ACCESS as of 2026-09-03 (Module 10 step 7): a reviewer who
  // cannot open the module a comment points at cannot review it. The role is
  // read-only through the MATRIX (canEditInputs / canSave / canManageVersions
  // are all false) and the server enforces that in getProjectForWrite, never
  // here. See the header.
  reviewer: ['dashboard', 'projects', 'overview', 'module1', 'module2', 'module3', 'module4', 'module5', 'module6', 'module7'],
  // UNCHANGED. A viewer reads the dashboard and the reports, does not comment,
  // and so has no field to reach.
  viewer:   ['dashboard', 'module6', 'module7'],
};

/** Whether `role` may see REFM module `key`.
 *
 *  UNKNOWN KEYS ARE VISIBLE, which is the pre-existing behaviour and is
 *  deliberate: the caller passes arbitrary strings (tab ids, not just
 *  ModuleKeys), and hiding everything this map has no opinion about would
 *  blank most of the shell. Hiding is opt-in, per module.
 *
 *  UNKNOWN ROLES SEE NOTHING, which is the opposite default and is also
 *  deliberate: a role the build does not recognise is not evidence of
 *  entitlement. */
export function refmRoleSeesModule(role: ProjectRole | string | null | undefined, key: string): boolean {
  const list = REFM_MODULE_VISIBILITY[role as ProjectRole];
  if (!list) return false;
  return list.includes(key as ModuleKey) || !isRefmModuleKey(key);
}

const ALL_KEYS = new Set<string>(Object.values(REFM_MODULE_VISIBILITY).flat());

/** True when this map has an opinion about `key` (it appears in at least one
 *  role's list). Anything else is a tab the map does not govern. */
export function isRefmModuleKey(key: string): boolean {
  return ALL_KEYS.has(key);
}
