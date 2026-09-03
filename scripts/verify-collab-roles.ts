/**
 * verify-collab-roles.ts
 *
 * Pins Module 10 Collaboration step 0: the role vocabulary, its single home,
 * and the two name clashes it was created to settle.
 *
 * What it holds:
 *   A. Four roles, Owner / Editor / Reviewer / Viewer, defined ONCE.
 *   B. OWNER IS NOT ADMIN. No collaboration role may be named 'admin', because
 *      `users.role === 'admin'` is the platform administrator and is compared
 *      as a bare string across the auth layer. One word, one meaning.
 *   C. The permission matrix survived the rename UNCHANGED. Step 0 was a
 *      rename; a behaviour change hidden inside one is the thing to catch.
 *   D. Module visibility is PER PLATFORM, not in the shared role table.
 *   E. Denial is the default for an unknown role.
 *   F. Collaborate is module 10, not module 8.
 *
 * Run: npx tsx scripts/verify-collab-roles.ts
 *
 * No em dashes in this file.
 */
import { readFileSync } from 'node:fs';
import {
  PROJECT_ROLES, PROJECT_ROLE_META, PROJECT_ROLE_PERMISSIONS, DEFAULT_PROJECT_ROLE,
  roleRank, roleCan, isProjectRole, type ProjectRole,
} from '../src/core/collab/projectRoles';
import { REFM_MODULE_VISIBILITY, refmRoleSeesModule } from '../src/hubs/modeling/platforms/refm/lib/moduleVisibility';

let passed = 0, failed = 0; const fails: string[] = [];
function check(label: string, ok: boolean, detail = ''): void {
  if (ok) { passed++; console.log(`  [PASS] ${label}`); }
  else { failed++; fails.push(label); console.log(`  [FAIL] ${label}${detail ? ` :: ${detail}` : ''}`); }
}
const src = (p: string): string => { try { return readFileSync(p, 'utf8'); } catch { return ''; } };
const strip = (s: string): string => s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');

console.log('=== A. Four roles, one definition ===');
{
  check('A1 the four roles, in privilege order',
    PROJECT_ROLES.join(',') === 'owner,editor,reviewer,viewer', PROJECT_ROLES.join(', '));
  check('A2 every role has metadata and a permission row',
    PROJECT_ROLES.every((r) => !!PROJECT_ROLE_META[r] && !!PROJECT_ROLE_PERMISSIONS[r]));
  check('A3 the default role is owner', DEFAULT_PROJECT_ROLE === 'owner');
  // The matrix is a literal of permission KEYS, so the crisp test for a second
  // copy is whether any permission key appears in the file at all. The first
  // version tested /PERMISSIONS[^=]*=\s*{/, whose [^=]* ran greedily across the
  // re-export block and matched "export const ROLES = {" several lines below:
  // a check that failed for a reason it did not name.
  const MATRIX_KEY = /canCreateProject|canEditInputs|canChangeBranding/;
  check('A4 core/state re-exports rather than declaring a second copy',
    /from '@\/src\/core\/collab\/projectRoles'/.test(src('src/core/state/index.ts'))
    && !MATRIX_KEY.test(strip(src('src/core/state/index.ts'))));
  check('A5 settings.types re-exports rather than declaring a second copy',
    /from '@\/src\/core\/collab\/projectRoles'/.test(src('src/core/types/settings.types.ts'))
    && !/export type Role =/.test(strip(src('src/core/types/settings.types.ts')))
    && !MATRIX_KEY.test(strip(src('src/core/types/settings.types.ts'))));
  // The vocabulary must live in core: the boundaries rule lets core import
  // only from core, and two core files re-export it.
  check('A6 the vocabulary lives in core/, so core does not import shared/',
    src('src/core/collab/projectRoles.ts').length > 0
    && !/@\/src\/shared\//.test(src('src/core/collab/projectRoles.ts')));
}

console.log('\n=== B. Owner is not admin ===');
{
  check('B1 no collaboration role is called admin',
    !(PROJECT_ROLES as readonly string[]).includes('admin'));
  check('B2 nor analyst (the old editor name)',
    !(PROJECT_ROLES as readonly string[]).includes('analyst'));
  check('B3 isProjectRole rejects the retired names',
    !isProjectRole('admin') && !isProjectRole('analyst') && isProjectRole('owner'));
  // The auth role is a different concept and must stay a bare string check on
  // users.role. If the collaboration type ever types it, the two have merged.
  const authFiles = [
    'src/hubs/modeling/platforms/refm/lib/persistence/auth.ts',
    'src/shared/account/deleteUserAccount.ts',
  ];
  for (const f of authFiles) {
    const s = src(f);
    check(`B4 ${f.split('/').pop()} still checks users.role as a plain string, not a ProjectRole`,
      /role === 'admin'/.test(s) && !/ProjectRole/.test(s));
  }
  check('B5 the reason is written down where the vocabulary lives',
    /OWNER IS NOT ADMIN/i.test(src('src/core/collab/projectRoles.ts')));
}

console.log('\n=== C. The matrix survived the rename unchanged ===');
{
  // The pre-rename table, transcribed from git history. owner == old admin,
  // editor == old analyst. If any boolean moved during a rename, this fails.
  const BEFORE: Record<ProjectRole, Record<string, boolean>> = {
    owner:    { canCreateProject: true,  canEditProject: true,  canDeleteProject: true,  canManageVersions: true,  canEditInputs: true,  canSave: true,  canChangeBranding: true,  canViewReports: true, canAddComments: true,  canExport: true,  canImport: true },
    editor:   { canCreateProject: true,  canEditProject: true,  canDeleteProject: false, canManageVersions: true,  canEditInputs: true,  canSave: true,  canChangeBranding: false, canViewReports: true, canAddComments: true,  canExport: true,  canImport: true },
    reviewer: { canCreateProject: false, canEditProject: false, canDeleteProject: false, canManageVersions: false, canEditInputs: false, canSave: false, canChangeBranding: false, canViewReports: true, canAddComments: true,  canExport: true,  canImport: false },
    viewer:   { canCreateProject: false, canEditProject: false, canDeleteProject: false, canManageVersions: false, canEditInputs: false, canSave: false, canChangeBranding: false, canViewReports: true, canAddComments: false, canExport: false, canImport: false },
  };
  let drift = '';
  for (const r of PROJECT_ROLES) {
    for (const [k, v] of Object.entries(BEFORE[r])) {
      const now = (PROJECT_ROLE_PERMISSIONS[r] as unknown as Record<string, boolean>)[k];
      if (now !== v) drift += ` ${r}.${k}: ${v} -> ${now};`;
    }
  }
  check('C1 not one permission moved during the rename', drift === '', drift);
  // Sanity that the matrix is actually meaningful, not all-true.
  check('C2 the matrix genuinely differentiates roles',
    roleCan('owner', 'canDeleteProject') && !roleCan('editor', 'canDeleteProject')
    && roleCan('reviewer', 'canAddComments') && !roleCan('viewer', 'canAddComments')
    && !roleCan('reviewer', 'canEditInputs'));
}

console.log('\n=== D. Module visibility is per platform ===');
{
  const coreState = strip(src('src/core/state/index.ts'));
  check('D1 MODULE_VISIBILITY no longer lives in the shared role table',
    !/MODULE_VISIBILITY/.test(coreState));
  check('D2 the REFM map lives with REFM and covers every role',
    PROJECT_ROLES.every((r) => Array.isArray(REFM_MODULE_VISIBILITY[r])));
  // The AGREED map. Identical to the pre-move lists except for TWO deliberate
  // changes: the editor regained module5 in step 4 (a renumbering omission),
  // and the reviewer gained every module in step 7, because a reviewer who
  // cannot open the module a comment points at cannot review it. The reviewer
  // stays read-only through the MATRIX, not through this map.
  const EXPECT: Record<ProjectRole, string> = {
    owner:    'dashboard,projects,overview,module1,module2,module3,module4,module5,module6,module7',
    editor:   'dashboard,projects,overview,module1,module2,module3,module4,module5,module6,module7',
    reviewer: 'dashboard,projects,overview,module1,module2,module3,module4,module5,module6,module7',
    viewer:   'dashboard,module6,module7',
  };
  let moved = '';
  for (const r of PROJECT_ROLES) {
    if (REFM_MODULE_VISIBILITY[r].join(',') !== EXPECT[r]) moved += ` ${r};`;
  }
  check('D3 every visibility list matches the agreed map', moved === '', moved);
  // THE FIX, pinned so it cannot be undone by a later carry-over. The editor
  // was excluded from module5 by a RENUMBERING, not a decision: the original
  // map's own legend granted the analyst "Module 4 (Returns)", and Returns
  // later became module5 while the positional list kept excluding it. An
  // editor who can change costs must be able to see the effect on returns.
  check('D4 the editor can see Returns (module5), the renumbering omission is fixed',
    REFM_MODULE_VISIBILITY.editor.includes('module5'));
  check('D4b the history of that omission is recorded, not just the fix',
    /OMISSION/i.test(src('src/hubs/modeling/platforms/refm/lib/moduleVisibility.ts'))
    && /renumber/i.test(src('src/hubs/modeling/platforms/refm/lib/moduleVisibility.ts')));
  // Step 7. A reviewer is asked to comment on fields that live in Modules 1
  // to 5, so hiding those screens made the role incoherent. WHAT KEEPS THEM
  // READ-ONLY IS THE MATRIX, and that is asserted here beside the visibility
  // so the two can never be confused for one another again.
  check('D5 a reviewer can see every module an editor can',
    REFM_MODULE_VISIBILITY.editor.every((m) => REFM_MODULE_VISIBILITY.reviewer.includes(m)));
  check('D5b a reviewer is read-only through the MATRIX, not through visibility',
    !roleCan('reviewer', 'canEditInputs') && !roleCan('reviewer', 'canSave')
    && !roleCan('reviewer', 'canManageVersions') && roleCan('reviewer', 'canViewReports'));
  check('D5c the viewer is UNCHANGED and still narrower than the reviewer',
    REFM_MODULE_VISIBILITY.viewer.join(',') === 'dashboard,module6,module7'
    && REFM_MODULE_VISIBILITY.viewer.length < REFM_MODULE_VISIBILITY.reviewer.length);
}

console.log('\n=== E. Unknown roles are denied ===');
{
  check('E1 an unknown role carries no permission',
    !roleCan('superuser', 'canViewReports') && !roleCan(null, 'canViewReports')
    && !roleCan(undefined, 'canEditInputs') && !roleCan('', 'canExport'));
  check('E2 an unknown role ranks LAST, never first',
    roleRank('superuser') > roleRank('viewer') && roleRank('owner') === 0);
  check('E3 an unknown role sees no REFM module',
    !refmRoleSeesModule('superuser', 'module1') && !refmRoleSeesModule(null, 'dashboard'));
  // A tab this map has no opinion about stays visible: hiding everything
  // unlisted would blank most of the shell.
  check('E4 a governed module hides, an ungoverned tab does not',
    !refmRoleSeesModule('viewer', 'module1') && refmRoleSeesModule('viewer', 'some-other-tab'));
}

console.log('\n=== F. Collaborate is module 10 ===');
{
  // Two independent tables say so, and module_8 is Portfolio, which is already
  // shipped and sold. Naming collaboration "module 8" would collide with it.
  const claude = src('CLAUDE.md');
  check('F1 the docs do not call collaboration module 8',
    !/Module 8[^0-9]{0,20}Collaborat/i.test(claude), 'CLAUDE.md');
  check('F2 the docs record the number',
    /module\s*10/i.test(claude) || /Module 10/.test(src('CLAUDE-TODO.md')));
}

console.log(`\n=== Result: ${passed} passed, ${failed} failed ===`);
if (failed) { console.log('Failures: ' + fails.join(' | ')); process.exit(1); }
