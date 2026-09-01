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
 * ── CARRIED OVER VERBATIM, INCLUDING ONE ODDITY ───────────────────────────
 *
 * Not one entry was changed in the move, because step 0 is a rename and a
 * relocation and must not smuggle a behaviour change in beside them. One entry
 * looks wrong and is deliberately LEFT wrong until step 4:
 *
 *   EDITOR CANNOT SEE MODULE 5 (Returns). Every other module is visible to an
 *   editor, and an editor who can change construction costs but cannot see
 *   what they did to the IRR is not a coherent role. It reads like an
 *   omission rather than a decision.
 *
 * It changes nothing today: `currentUserRole` is pinned to the top role, so
 * this map is not consulted for any real user, and correcting it now would be
 * an unreviewable change hidden inside a rename. Decide it in step 4, when a
 * role is actually resolved from the server and the answer is visible.
 *
 * No em dashes in this file.
 */
import type { ProjectRole } from '@/src/core/collab/projectRoles';
import type { ModuleKey } from '@/src/core/types/settings.types';

export const REFM_MODULE_VISIBILITY: Record<ProjectRole, ModuleKey[]> = {
  owner:    ['dashboard', 'projects', 'overview', 'module1', 'module2', 'module3', 'module4', 'module5', 'module6', 'module7'],
  // module5 (Returns) is absent. See the note above: preserved, not endorsed.
  editor:   ['dashboard', 'projects', 'overview', 'module1', 'module2', 'module3', 'module4', 'module6', 'module7'],
  reviewer: ['dashboard', 'projects', 'module6', 'module7'],
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
