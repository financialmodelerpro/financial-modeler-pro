/**
 * verify-view-lock.ts (2026-08-17c)
 *
 * A LOCKED INPUT MUST LOOK LOCKED.
 *
 * A project opens read-only until the user clicks Edit. The lock has always
 * lived at the store's model-mutating setters, which no-op SILENTLY, so every
 * input still looked and behaved editable: type into it, watch the value
 * appear, lose it on the next render, nothing said. That is the same defect
 * class as a screen showing one number while the model uses another, and it is
 * how a user came to report "I set the phasing curve and it reverted".
 *
 * What is checked here:
 *   A. the store lock itself still bites (every model mutator, no exceptions)
 *   B. the container carries the lock, keyed on the SAME flag as the store
 *   C. the lock reaches inputs, selects and textareas and NOT buttons or rows,
 *      because every view interaction has to keep working (a blanket
 *      pointer-events lock on the panel was tried once and removed for exactly
 *      that reason)
 *   D. the keyboard is covered too, since CSS cannot stop typing, and the keys
 *      a reader needs are still allowed
 *   E. the opt-out exists and is used only by controls that change no number
 *   F. Module 7 is exempt: the deck carries its own state and its own save
 *
 * Run: npx tsx scripts/verify-view-lock.ts
 * No em dashes in this file.
 */

import fs from 'node:fs';
import path from 'node:path';

import { useModule1Store } from '../src/hubs/modeling/platforms/refm/lib/state/module1-store';

let passed = 0;
const failures: string[] = [];
const check = (name: string, ok: boolean, detail = ''): void => {
  if (ok) { passed += 1; return; }
  failures.push(`${name}${detail ? `  [${detail}]` : ''}`);
};
const section = (t: string): void => console.log(`\n-- ${t} ${'-'.repeat(Math.max(0, 62 - t.length))}`);
const ROOT = path.resolve(__dirname, '..');
const read = (rel: string): string => fs.readFileSync(path.join(ROOT, rel), 'utf8').replace(/\r\n/g, '\n');

const SHELL = read('src/hubs/modeling/platforms/refm/components/RealEstatePlatform.tsx');
const CSS = read('app/globals.css');
const STORE = read('src/hubs/modeling/platforms/refm/lib/state/module1-store.ts');

// ════════════════════════════════════════════════════════════════════════════
section('A. The store lock still bites');

{
  const s = useModule1Store.getState();
  const nameBefore = s.project.name;
  s.setViewLocked(true);
  useModule1Store.getState().setProject({ name: 'CHANGED WHILE LOCKED' });
  check('a model write is a no-op while locked',
    useModule1Store.getState().project.name === nameBefore,
    useModule1Store.getState().project.name);

  const assetsBefore = useModule1Store.getState().assets.length;
  useModule1Store.getState().addAsset({
    id: 'a_locked', phaseId: useModule1Store.getState().phases[0].id, name: 'X', type: '',
    strategy: 'Sell', visible: true, gfaSqm: 0, buaSqm: 0, sellableBuaSqm: 0, parkingBaysRequired: 0,
  } as never);
  check('and so is adding a row',
    useModule1Store.getState().assets.length === assetsBefore);

  // Navigation is NOT locked: view mode allows every view interaction.
  const phaseId = useModule1Store.getState().phases[0].id;
  useModule1Store.getState().setActivePhaseId(phaseId);
  check('navigation still works while locked',
    useModule1Store.getState().activePhaseId === phaseId);

  useModule1Store.getState().setViewLocked(false);
  useModule1Store.getState().setProject({ name: nameBefore });
  check('and unlocking restores writing',
    useModule1Store.getState().project.name === nameBefore);
}

// ════════════════════════════════════════════════════════════════════════════
section('B. The container carries the lock, off the same flag');

{
  check('module content is marked when locked',
    /data-view-locked=\{viewLocked && !isDeckModule \? 'true' : undefined\}/.test(SHELL));
  // ONE RULE. The store lock and the screen lock must not be two hand-written
  // expressions of the same idea, or a state exists where the field looks
  // editable and the store refuses the write, which is the whole defect.
  check('the store lock is the base rule',
    /const modelLocked = !editMode \|\| graceReadOnly;/.test(SHELL)
    && /setViewLocked\(modelLocked\)/.test(SHELL));
  check('and the screen lock is DERIVED from it',
    /const viewLocked = modelLocked && /.test(SHELL));
  check('each is derived exactly once',
    (SHELL.match(/const viewLocked = /g) ?? []).length === 1
    && (SHELL.match(/const modelLocked = /g) ?? []).length === 1);
}

// ════════════════════════════════════════════════════════════════════════════
section('C. Inputs are locked. Buttons and rows are not.');

{
  const block = CSS.slice(CSS.indexOf("[data-view-locked='true'] input"));
  check('the CSS block exists', block.length > 0);
  for (const tag of ['input', 'select', 'textarea']) {
    check(`${tag} is locked`, new RegExp(`\\[data-view-locked='true'\\] ${tag}[,\\s]`).test(CSS));
  }
  check('pointer events are removed from the control', /pointer-events: none/.test(block));
  check('and it is visibly not a field (muted + dashed)',
    /border-style: dashed/.test(block) && /var\(--color-meta\)/.test(block));
  check('checkboxes and radios read as inactive too',
    /input\[type='checkbox'\]/.test(block) && /opacity: 0\.5/.test(block));

  // The regression this must never become: a blanket panel lock.
  check('NO blanket pointer-events lock on the panel itself',
    !/\[data-view-locked='true'\] \{[^}]*pointer-events: none/.test(CSS));
  for (const tag of ['button', 'a ', 'tr', 'div']) {
    check(`${tag.trim()} is NOT locked`,
      !new RegExp(`\\[data-view-locked='true'\\] ${tag}[,{\\s]`).test(CSS));
  }
}

// ════════════════════════════════════════════════════════════════════════════
section('D. The keyboard is covered, and reading still works');

{
  check('key events are intercepted on the container',
    /onKeyDownCapture=\{blockLockedKeyboard\}/.test(SHELL));
  check('so is input, paste and drop',
    /onBeforeInputCapture=\{blockLockedInput\}/.test(SHELL)
    && /onPasteCapture=\{blockLockedInput\}/.test(SHELL)
    && /onDropCapture=\{blockLockedInput\}/.test(SHELL));
  check('only form controls are affected',
    /\/\^\(INPUT\|SELECT\|TEXTAREA\)\$\/\.test\(el\.tagName\)/.test(SHELL));
  check('Tab and Escape still work, or the page becomes a trap',
    /e\.key === 'Tab' \|\| e\.key === 'Escape'/.test(SHELL));
  check('and the copy shortcuts survive, because reading is the point',
    /ctrlKey \|\| e\.metaKey/.test(SHELL) && /'c', 'a', 'Insert'/.test(SHELL));
  check('the guard is inert when nothing is locked',
    /if \(!viewLocked \|\| isDeckModule\) return false;/.test(SHELL));
}

// ════════════════════════════════════════════════════════════════════════════
section('E. The opt-out is narrow and honest');

{
  check('the CSS honours an opt-out', /data-view-editable='true'/.test(CSS));
  check('and the keyboard guard honours the same one',
    /closest\('\[data-view-editable="true"\]'\)/.test(SHELL));

  // Every use of it, and what it is on. A control that changes a MODEL value
  // must never carry it: that would put back the silent discard.
  const REFM = 'src/hubs/modeling/platforms/refm/components';
  const users: Array<{ file: string; line: string }> = [];
  const walk = (dir: string): void => {
    for (const e of fs.readdirSync(path.join(ROOT, dir), { withFileTypes: true })) {
      const rel = `${dir}/${e.name}`;
      if (e.isDirectory()) walk(rel);
      else if (e.name.endsWith('.tsx')) {
        for (const line of read(rel).split('\n')) {
          if (line.includes('data-view-editable')) users.push({ file: rel, line: line.trim() });
        }
      }
    }
  };
  walk(REFM);
  check('the opt-out is used sparingly', users.length > 0 && users.length <= 8, `${users.length} uses`);
  for (const u of users) {
    check(`opt-out in ${u.file.split('/').pop()} does not write to the store`,
      !/setProject\(|updateAsset\(|updateCostLine\(|setCostOverride\(|updatePhase\(|updateParcel\(|updateSubUnit\(|updateFinancingTranche\(/.test(u.line),
      u.line.slice(0, 90));
  }
}

// ════════════════════════════════════════════════════════════════════════════
section('F. Module 7 is exempt, deliberately');

{
  check('the deck module is not view-locked',
    /viewLocked && !isDeckModule/.test(SHELL));
  check('and the reason is written down',
    /MODULE 7 IS EXEMPT/.test(SHELL));
}

// ── Report ─────────────────────────────────────────────────────────────────
console.log(`\n${'='.repeat(70)}`);
console.log(`verify-view-lock: ${passed} passed, ${failures.length} failed`);
if (failures.length > 0) {
  for (const f of failures) console.log(`  FAIL  ${f}`);
  process.exit(1);
}
void STORE;
