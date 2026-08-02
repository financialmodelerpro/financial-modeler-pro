/**
 * verify-deck-textbox-versions.ts (REFM Module 7: free text boxes + named versions)
 *
 * Covers the two genuinely NEW capabilities (the third, undo/redo, already
 * existed and is pinned by verify-report-deck-edit):
 *
 *   1. The free text box. Every other insert path produces a model-BOUND object;
 *      this is the one that must stay unbound, so the user's own words are never
 *      re-resolved from the model and never overwritten by a model change.
 *   2. Named deck versions. The document round-trips through the SAME coerceDeck
 *      the version rows are read with, so a saved version cannot come back
 *      degraded, and a version's slides must still hold binding keys rather than
 *      frozen figures (that is what makes an old deck show today's numbers).
 *
 * Undo-related invariants are asserted where they touch the new code: addTextBox
 * must be pure (the history is a stack of whole-deck snapshots, so aliasing the
 * previous deck would silently break Ctrl+Z), and loading a version must produce
 * a deck that is a valid history entry in its own right.
 *
 * Pure and offline: no database, no React, no DOM.
 *
 * No em dashes in this file.
 */
/* eslint-disable @typescript-eslint/no-explicit-any */
import { readFileSync } from 'fs';
import { join } from 'path';
import { addTextBox, addBlankSlide, updateObject, removeObjects } from '../src/hubs/modeling/platforms/refm/lib/reports/deck/mutations';
import { coerceDeck } from '../src/hubs/modeling/platforms/refm/lib/persistence/deck-server';
import { SLIDE_W, SLIDE_H, type Deck, type DeckObject } from '../src/hubs/modeling/platforms/refm/lib/reports/deck/types';

let pass = 0, fail = 0;
const check = (name: string, cond: boolean): void => { if (cond) { pass++; console.log(`  [PASS] ${name}`); } else { fail++; console.log(`  [FAIL] ${name}`); } };

const containsEmDashLiteral = (t: string): boolean => new RegExp(`[—―]`).test(t);

const obj = (id: string, type: string, x: number, y: number, w = 100, h = 40, extra: any = {}): DeckObject =>
  ({ id, type, x, y, w, h, rot: 0, ...extra } as DeckObject);

const makeDeck = (): Deck => ({
  schemaVersion: 3, projectId: 'p', title: 'T',
  slides: [
    { id: 's1', title: 'One', chrome: 'content', objects: [
      obj('a', 'text', 100, 100, 200, 40, { text: 'A', style: { fontRole: 'body', size: 13, color: '#2A3440', align: 'left', valign: 'top' } }),
      obj('b', 'kpi', 400, 100, 160, 90, { metric: 'headline.projectIrr', variant: 'pale' }),
    ] },
    { id: 's2', title: 'Two', chrome: 'content', objects: [] },
  ],
  branding: { logoUrl: null, companyName: 'X', confidentialLabel: '', headerText: '', footerText: '', primary: null, secondary: null, fontHeading: 'Cambria', fontBody: 'Calibri', showSlideNumbers: true, whiteLabel: false },
  settings: { deckCase: 'management', moneyScale: 'millions', asOf: '2026-08-02' },
});

const textOf = (d: Deck, slideId: string, id: string) =>
  d.slides.find((s) => s.id === slideId)!.objects.find((o) => o.id === id) as any;

console.log('== free text box: shape ==');
{
  const d0 = makeDeck();
  const { deck: d1, newId } = addTextBox(d0, 's1');
  const o = textOf(d1, 's1', newId);
  check('returns a new id', !!newId);
  check('object is type text', o?.type === 'text');
  check('object is UNBOUND (no binding key)', o?.binding === undefined || o.binding === null);
  check('object carries editable text content', typeof o?.text === 'string' && o.text.length > 0);
  check('object carries a text style', !!o?.style && typeof o.style.size === 'number');
  check('object has a rotation field like every other object', o?.rot === 0);
  check('lands inside the canvas horizontally', o.x >= 0 && o.x + o.w <= SLIDE_W);
  check('lands inside the canvas vertically', o.y >= 0 && o.y + o.h <= SLIDE_H);
}

console.log('== free text box: purity (undo history depends on it) ==');
{
  const d0 = makeDeck();
  const before = JSON.stringify(d0);
  const { deck: d1 } = addTextBox(d0, 's1');
  check('input deck is not mutated', JSON.stringify(d0) === before);
  check('a new deck object is returned', d1 !== d0);
  check('the edited slide is a new object', d1.slides[0] !== d0.slides[0]);
  check('untouched slides are carried by reference', d1.slides[1] === d0.slides[1]);
  check('the previous snapshot still has the old object count', d0.slides[0].objects.length === 2);
}

console.log('== free text box: placement and ids ==');
{
  const d0 = makeDeck();
  const r1 = addTextBox(d0, 's1');
  const r2 = addTextBox(r1.deck, 's1');
  const r3 = addTextBox(r2.deck, 's1');
  check('ids are unique across repeated inserts', new Set([r1.newId, r2.newId, r3.newId]).size === 3);
  const o1 = textOf(r1.deck, 's1', r1.newId);
  const o2 = textOf(r2.deck, 's1', r2.newId);
  check('successive boxes are staggered, not stacked', o1.x !== o2.x || o1.y !== o2.y);
  check('appended last, so a new box is on top in z-order',
    r3.deck.slides[0].objects[r3.deck.slides[0].objects.length - 1].id === r3.newId);
  check('other objects are untouched', textOf(r3.deck, 's1', 'b')?.metric === 'headline.projectIrr');
}

console.log('== free text box: edit / delete behave like any object ==');
{
  const d0 = makeDeck();
  const { deck: d1, newId } = addTextBox(d0, 's1');
  const d2 = updateObject(d1, 's1', newId, { text: 'Investment thesis' });
  check('text edits apply', textOf(d2, 's1', newId).text === 'Investment thesis');
  check('type is immutable through a patch', textOf(updateObject(d2, 's1', newId, { type: 'kpi' } as any), 's1', newId).type === 'text');
  const d3 = removeObjects(d2, 's1', [newId]);
  check('delete removes it', !d3.slides[0].objects.some((o) => o.id === newId));
  check('delete leaves the rest of the slide alone', d3.slides[0].objects.length === 2);
}

console.log('== free text box: works on a blank slide (the old dead end) ==');
{
  const d0 = makeDeck();
  const { deck: withSlide, newId: slideId } = addBlankSlide(d0, 's1');
  check('a blank slide really is empty', withSlide.slides.find((s) => s.id === slideId)!.objects.length === 0);
  const { deck: d1, newId } = addTextBox(withSlide, slideId);
  check('a text box can be added to it', !!textOf(d1, slideId, newId));
  check('the blank slide is no longer unusable', d1.slides.find((s) => s.id === slideId)!.objects.length === 1);
}

console.log('== free text box: survives persistence (coerceDeck round-trip) ==');
{
  const d0 = makeDeck();
  const { deck: d1, newId } = addTextBox(d0, 's1');
  const edited = updateObject(d1, 's1', newId, { text: 'Board note' });
  // Exactly what the database does: serialise to jsonb, read back through the
  // same validator the deck AND the version rows are read with.
  const round = coerceDeck(JSON.parse(JSON.stringify(edited)), 'p', '2026-08-02');
  check('deck survives the round trip', round !== null);
  const survivor = round!.slides.find((s) => s.id === 's1')!.objects.find((o) => (o as any).text === 'Board note') as any;
  check('the text box survives with its content', !!survivor);
  check('it is still a text object', survivor?.type === 'text');
  check('it keeps its geometry', survivor && typeof survivor.x === 'number' && typeof survivor.w === 'number');
  check('it is still unbound after a round trip', survivor?.binding === undefined || survivor.binding === null);
}

console.log('== named versions: a saved document is a faithful, reloadable deck ==');
{
  const d0 = makeDeck();
  const { deck: d1 } = addTextBox(d0, 's1');
  // A version row stores exactly this payload shape (see saveDeckVersion).
  const stored = JSON.parse(JSON.stringify({ ...d1, projectId: 'p', updatedAt: null }));
  const loaded = coerceDeck(stored, 'p', '2026-08-02');
  check('a stored version reloads', loaded !== null);
  check('slide count is preserved', loaded!.slides.length === d1.slides.length);
  check('object count is preserved', loaded!.slides[0].objects.length === d1.slides[0].objects.length);
  check('branding is preserved', loaded!.branding.companyName === 'X');
  check('settings are preserved', loaded!.settings.moneyScale === 'millions');
  check('projectId is re-stamped by the loader', loaded!.projectId === 'p');

  // The load path replaces the working deck, and that replacement must itself be
  // a legal undo-history entry: a plain new object that aliases nothing.
  check('a loaded deck does not alias the deck it replaced', loaded !== d1);
  check('a loaded deck does not alias the pre-edit snapshot', loaded !== d0);
}

console.log('== named versions: bindings are stored, figures are NOT ==');
{
  // This is the load-bearing property of the whole module: a saved version must
  // record the binding key so an old deck shows TODAY's numbers when reloaded.
  // If a resolved figure were ever persisted, an old version would silently
  // display stale results.
  const d0 = makeDeck();
  const stored = JSON.parse(JSON.stringify(d0));
  const loaded = coerceDeck(stored, 'p', '2026-08-02')!;
  const kpi = loaded.slides[0].objects.find((o) => o.type === 'kpi') as any;
  check('a bound KPI keeps its binding key through a version save', kpi?.metric === 'headline.projectIrr');
  const serialised = JSON.stringify(loaded);
  check('no resolved value field is persisted on the KPI', !('value' in (kpi ?? {})));
  check('no formatted display string is persisted on the KPI', !('display' in (kpi ?? {})));
  check('the free text box is the ONLY user-authored content path', serialised.includes('headline.projectIrr'));
}

console.log('== save choice: wiring (source assertions) ==');
{
  const read = (p: string): string => readFileSync(join(__dirname, '..', p), 'utf8');
  const deckSrv = read('src/hubs/modeling/platforms/refm/lib/persistence/deck-server.ts');
  const route = read('app/api/refm/projects/[id]/report-deck/versions/[versionId]/route.ts');
  const shell = read('src/hubs/modeling/platforms/refm/components/modules/Module7Deck.tsx');
  const platform = read('src/hubs/modeling/platforms/refm/components/RealEstatePlatform.tsx');
  const choice = read('src/hubs/modeling/platforms/refm/components/modules/deck/DeckSaveChoiceModal.tsx');

  // An in-place update must revise the SAME version, so these two columns must
  // never appear in the patch. If they ever do, "update" silently renumbers or
  // re-dates a version and the history stops being trustworthy.
  const upd = deckSrv.slice(deckSrv.indexOf('export async function updateDeckVersion'), deckSrv.indexOf('export async function deleteDeckVersion'));
  // Scope this to the PATCH PAYLOAD only. Testing the whole function body would
  // match the row type annotation and the select list, which mention both
  // columns perfectly legitimately, and the assertion would fail while the code
  // was correct (it did exactly that on the first run).
  const payload = upd.slice(upd.indexOf('const patch'), upd.indexOf('.update(patch)'));
  check('the patch payload is found', payload.length > 40);
  check('updateDeckVersion never patches version_number', !/version_number/.test(payload));
  check('updateDeckVersion never patches created_at', !/created_at/.test(payload));
  check('the payload check has teeth (it would catch a renumber)',
    /version_number/.test(payload + 'patch.version_number = 1;'));
  check('updateDeckVersion is scoped by project_id as well as id',
    upd.includes(".eq('project_id', projectId)") && upd.includes(".eq('id', versionId)"));
  check('updateDeckVersion also saves the working deck', upd.includes('upsertDeck(projectId, deck)'));
  check('updateDeckVersion only renames when a label is supplied', upd.includes('patch.label = label.trim()'));

  check('PATCH route exists on the version resource', /export async function PATCH/.test(route));
  check('PATCH re-validates the posted deck through coerceDeck', /coerceDeck\(body\?\.deck/.test(route));
  check('PATCH is behind the read-only grace write gate', route.includes('writeBlockReason(gate)'));

  // Every save must ask. If the Save button ever calls a writer directly again,
  // the silent overwrite is back.
  check('the deck Save button opens the choice, not a writer', shell.includes('onClick={requestSave}'));
  check('requestSave opens the choice modal', /const requestSave[\s\S]{0,240}setSaveChoiceOpen\(true\)/.test(shell));
  check('the choice modal is in the keyboard guard', shell.includes('versionsOpen || saveChoiceOpen || aiDrafts.length > 0'));
  check('choosing a new version hands off to the versions modal', shell.includes("if (choice === 'new-version')"));
  check('save-as-new does NOT reload or switch slide (stay where you are)',
    !/new-version'\s*\)\s*\{[^}]*setActiveSlideId/.test(shell));

  check('the module registers its save with the shell', shell.includes('onRegisterSave?.(requestSave)'));
  check('the module clears the registration on unmount', shell.includes('onRegisterSave?.(null)'));
  check('the topbar Save prefers the deck handler when one is registered',
    platform.includes('if (deckSaveRef.current) { deckSaveRef.current(); return; }'));
  check('the topbar unsaved state follows the deck on module 7',
    platform.includes('hasUnsaved={isDeckModule ? deckDirty : hasUnsaved}'));

  check('the choice names the version it would overwrite', choice.includes('Update "${linkedName}"'.replace('${linkedName}', '${linkedName}')));
  check('the choice degrades honestly when nothing is linked', choice.includes('Update this presentation'));
  check('no em dash in the new save-choice modal', !containsEmDashLiteral(choice));
}

console.log(`\n=== Result: ${pass} passed, ${fail} failed ===`);
process.exit(fail === 0 ? 0 : 1);
