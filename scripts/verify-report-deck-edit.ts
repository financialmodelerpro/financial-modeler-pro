/**
 * verify-report-deck-edit.ts (REFM Module 7, IC Presentation Builder: Phase 2)
 *
 * Pins the editing layer's PURE core: the deck mutations (move / update / add /
 * remove / duplicate / z-order / nudge / slide ops) and the snap + alignment
 * engine. These are the pieces the interactive EditLayer drives; verifying them
 * headlessly means a drag or a delete cannot silently corrupt the document.
 *
 * The invariants that matter:
 *   - every mutation is PURE: the input deck is never mutated (undo history is a
 *     stack of these snapshots, so aliasing would break undo),
 *   - id / type are immutable through a patch (a bound KPI can never be patched
 *     into a chart),
 *   - z-order is array order, and the operations move the right block,
 *   - duplicated objects get fresh, collision-free ids,
 *   - a deck can never be emptied of slides,
 *   - snapping aligns to edges / centres / margins within threshold and falls
 *     back to the grid, emitting a guide only when it actually aligned,
 *   - resize keeps the anchored edge fixed and enforces a minimum size.
 *
 * No em dashes in this file.
 */
/* eslint-disable @typescript-eslint/no-explicit-any */
import {
  updateObject, updateObjects, addObject, removeObjects, duplicateObjects,
  reorderObjects, nudgeObjects, duplicateSlide, addBlankSlide, removeSlide, moveSlide, updateSlide, freshId,
} from '../src/hubs/modeling/platforms/refm/lib/reports/deck/mutations';
import { snapMove, snapResize, boundingBox, SNAP_THRESHOLD } from '../src/hubs/modeling/platforms/refm/lib/reports/deck/snapping';
import { MARGIN, SLIDE_W, type Deck, type DeckObject } from '../src/hubs/modeling/platforms/refm/lib/reports/deck/types';

let pass = 0, fail = 0;
const check = (name: string, cond: boolean): void => { if (cond) { pass++; console.log(`  [PASS] ${name}`); } else { fail++; console.log(`  [FAIL] ${name}`); } };
const near = (a: number, b: number, eps = 1e-6): boolean => Math.abs(a - b) < eps;

const obj = (id: string, type: string, x: number, y: number, w = 100, h = 40, extra: any = {}): DeckObject =>
  ({ id, type, x, y, w, h, rot: 0, ...extra } as DeckObject);

const makeDeck = (): Deck => ({
  schemaVersion: 1, projectId: 'p', title: 'T',
  slides: [
    { id: 's1', title: 'One', chrome: 'content', objects: [
      obj('a', 'text', 100, 100, 200, 40, { text: 'A', style: { fontRole: 'body', size: 13, color: '#000', align: 'left', valign: 'top' } }),
      obj('b', 'kpi', 400, 100, 160, 90, { metric: 'headline.projectIrr', variant: 'pale' }),
      obj('c', 'chart', 100, 300, 300, 200, { chart: 'chart.costStack' }),
    ] },
    { id: 's2', title: 'Two', chrome: 'cover', objects: [] },
  ],
  branding: { logoUrl: null, companyName: 'X', confidentialLabel: '', headerText: '', footerText: '', primary: null, secondary: null, fontHeading: 'Cambria', fontBody: 'Calibri', showSlideNumbers: true, whiteLabel: false },
  settings: { deckCase: 'management', moneyScale: 'millions', asOf: '2026-07-16' },
});

// ── Purity ──────────────────────────────────────────────────────────────────
console.log('\n== purity (undo depends on it) ==');
const d0 = makeDeck();
const snapshot = JSON.stringify(d0);
const d1 = updateObject(d0, 's1', 'a', { x: 999 });
check('updateObject does not mutate the input deck', JSON.stringify(d0) === snapshot);
check('updateObject returns a changed copy', (d1.slides[0].objects[0] as any).x === 999);
check('updateObject shares untouched slides by value equality of content', d1.slides[1] === d0.slides[1]);

// ── id / type immutability ──────────────────────────────────────────────────
console.log('\n== id / type are immutable through a patch ==');
const dHack = updateObject(d0, 's1', 'b', { id: 'zzz', type: 'chart', variant: 'navy' } as any);
const bAfter = dHack.slides[0].objects[1] as any;
check('patch cannot change an object id', bAfter.id === 'b');
check('patch cannot change an object type', bAfter.type === 'kpi');
check('patch still applies the legitimate field', bAfter.variant === 'navy');

// ── add / remove ────────────────────────────────────────────────────────────
console.log('\n== add / remove ==');
const dAdd = addObject(d0, 's1', obj('d', 'divider', 0, 0, 50, 2, { color: '#000', thickness: 2 }));
check('addObject appends on top (end of array = front)', dAdd.slides[0].objects[3].id === 'd');
const dRem = removeObjects(d0, 's1', ['a', 'c']);
check('removeObjects drops the named ids', dRem.slides[0].objects.length === 1 && dRem.slides[0].objects[0].id === 'b');

// ── duplicate ───────────────────────────────────────────────────────────────
console.log('\n== duplicate ==');
const dup = duplicateObjects(d0, 's1', ['a']);
check('duplicate adds one object', dup.deck.slides[0].objects.length === 4);
check('duplicate returns the new id', dup.newIds.length === 1);
check('duplicate id differs from the original', dup.newIds[0] !== 'a');
const copy = dup.deck.slides[0].objects.find((o) => o.id === dup.newIds[0]) as any;
check('duplicate offsets the copy so it is visible', copy.x === 116 && copy.y === 116);
check('two freshIds never collide', freshId('t') !== freshId('t'));

// ── z-order ─────────────────────────────────────────────────────────────────
console.log('\n== z-order (array order) ==');
const order = (dk: Deck) => dk.slides[0].objects.map((o) => o.id).join('');
check('front moves to end', order(reorderObjects(d0, 's1', ['a'], 'front')) === 'bca');
check('back moves to start', order(reorderObjects(d0, 's1', ['c'], 'back')) === 'cab');
check('forward moves up one', order(reorderObjects(d0, 's1', ['a'], 'forward')) === 'bac');
check('backward moves down one', order(reorderObjects(d0, 's1', ['c'], 'backward')) === 'acb');
check('multi-select keeps the block contiguous', order(reorderObjects(d0, 's1', ['a', 'b'], 'front')) === 'cab');

// ── nudge ───────────────────────────────────────────────────────────────────
console.log('\n== nudge ==');
const nud = nudgeObjects(d0, 's1', ['a'], 8, -8);
check('nudge moves by delta, snapped to grid', (nud.slides[0].objects[0] as any).x === 108 && (nud.slides[0].objects[0] as any).y === 92);
const locked = updateObject(d0, 's1', 'a', { locked: true });
check('nudge skips a locked object', (nudgeObjects(locked, 's1', ['a'], 8, 8).slides[0].objects[0] as any).x === 100);

// ── slide ops ───────────────────────────────────────────────────────────────
console.log('\n== slide operations ==');
const ds = duplicateSlide(d0, 's1');
check('duplicateSlide inserts right after the source', ds.deck.slides[1].id === ds.newId);
check('duplicated slide re-ids its objects', ds.deck.slides[1].objects.every((o) => !['a', 'b', 'c'].includes(o.id)));
check('duplicated slide keeps object count', ds.deck.slides[1].objects.length === 3);
const dblank = addBlankSlide(d0, 's1');
check('addBlankSlide inserts after the anchor', dblank.deck.slides[1].id === dblank.newId && dblank.deck.slides[1].objects.length === 0);
check('moveSlide reorders', moveSlide(d0, 0, 1).slides.map((s) => s.id).join('') === 's2s1');
check('removeSlide drops a slide', removeSlide(d0, 's2').slides.length === 1);
const one = { ...d0, slides: [d0.slides[0]] };
check('removeSlide never empties the deck', removeSlide(one, 's1').slides.length === 1);
check('updateSlide patches title, keeps id', updateSlide(d0, 's1', { title: 'New' } as any).slides[0].title === 'New' && updateSlide(d0, 's1', { id: 'x' } as any).slides[0].id === 's1');

// ── snapping: move ──────────────────────────────────────────────────────────
console.log('\n== snapping: move ==');
// Left margin is MARGIN (48). A box whose left is 3px inside threshold snaps to it.
const mv1 = snapMove({ x: MARGIN + 3, y: 200, w: 100, h: 40 }, []);
check('move snaps left edge to the content margin', near(mv1.box.x, MARGIN));
check('move emits an x guide at the margin', mv1.guides.some((g) => g.axis === 'x' && near(g.pos, MARGIN)));
// Slide horizontal centre: box centre near SLIDE_W/2.
const cx = SLIDE_W / 2;
const mv2 = snapMove({ x: cx - 50 + 2, y: 200, w: 100, h: 40 }, []);
check('move snaps box centre to the slide centre', near(mv2.box.x + 50, cx));
// Aligns to another object's left edge.
const other = { x: 500, y: 0, w: 100, h: 40 };
const mv3 = snapMove({ x: 500 + 4, y: 200, w: 80, h: 40 }, [other]);
check('move aligns to another objects left edge', near(mv3.box.x, 500));
// No target within threshold: falls back to grid, no guide.
const mv4 = snapMove({ x: 733, y: 201, w: 100, h: 40 }, []);
check('move with no alignment falls back to the grid', mv4.box.x % 8 === 0 && mv4.box.y % 8 === 0);
check('grid fallback emits no guide', mv4.guides.length === 0);
check('threshold constant is a sane small number', SNAP_THRESHOLD > 0 && SNAP_THRESHOLD <= 12);

// ── snapping: resize ────────────────────────────────────────────────────────
console.log('\n== snapping: resize ==');
const start = { x: 200, y: 200, w: 200, h: 100 };
// Drag the east handle right by 40: right edge moves, left edge fixed.
const rz = snapResize(start, 'e', 40, 0, []);
check('resize east keeps left edge fixed', near(rz.box.x, 200));
check('resize east grows width', rz.box.w > 200);
// Drag west handle: left moves, right edge (400) fixed.
const rzW = snapResize(start, 'w', -40, 0, []);
check('resize west keeps right edge fixed', near(rzW.box.x + rzW.box.w, 400));
// Snap the moving edge to a neighbour.
const rzSnap = snapResize(start, 'e', 4, 0, [{ x: 404, y: 0, w: 10, h: 10 }]);
check('resize snaps the moving edge to a neighbour', near(rzSnap.box.x + rzSnap.box.w, 404));
// Minimum size: collapse attempt is clamped.
const rzMin = snapResize(start, 'e', -1000, 0, []);
check('resize enforces a minimum width', rzMin.box.w >= 16);

// ── bounding box ────────────────────────────────────────────────────────────
console.log('\n== bounding box (group drag) ==');
const bb = boundingBox([{ x: 100, y: 100, w: 50, h: 50 }, { x: 200, y: 180, w: 40, h: 40 }]);
check('bounding box spans all boxes', bb.x === 100 && bb.y === 100 && bb.w === 140 && bb.h === 120);

// ── Result ──────────────────────────────────────────────────────────────────
console.log(`\n=== Result: ${pass} passed, ${fail} failed ===`);
process.exit(fail === 0 ? 0 : 1);
