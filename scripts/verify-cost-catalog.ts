/**
 * verify-cost-catalog.ts (2026-08-17)
 *
 * The catalog, and the four defects around it.
 *
 *   A. THE FIELD WHITELIST GUARD. `migrateLegacyToV8` rebuilds every cost line
 *      from an object literal naming each field, and most snapshots go through
 *      it. A field missing from that literal is dropped on every hydrate, and
 *      it has now happened TWICE (`phasingSource`, then
 *      `windowFollowsConstruction`). This section fails when a CostLine field
 *      exists that the literal does not name, so the next one cannot go the
 *      same way.
 *   B. A stripped `phasingSource` is restored, and a deliberate `inherit` is
 *      not touched.
 *   C. The catalog covers a real development, every entry carries behaviour,
 *      and every existing line resolves an identity with no migration.
 *   D. Selecting an entry stamps method / stage / source; renaming changes the
 *      label and nothing else.
 *   E. One money strip: the row renders the engine's schedule and computes no
 *      distribution of its own.
 *   F. Copy reconciles by catalog identity, and undo restores at the index.
 *
 * Run: npx tsx scripts/verify-cost-catalog.ts
 * No em dashes in this file.
 */

import fs from 'node:fs';
import path from 'node:path';

import {
  BUILT_IN_COST_CATALOG, mergeCatalog, resolveCatalogId, findCatalogEntry,
  catalogLabelFor, stampFromEntry, describeCatalogChange, mintLineId, normaliseCatalogId,
  type UserCostCatalogEntry,
} from '../src/hubs/modeling/platforms/refm/lib/state/costCatalog';
import {
  makeBlankCostLines, makeDefaultPhase, makeDefaultProject,
  COST_METHODS, COST_STAGES, ALLOCATION_BASES, COST_SCOPES, CAPEX_PHASING_SOURCES,
  COST_METHOD_LABELS, COST_STAGE_LABELS, CAPEX_PHASING_SOURCE_LABELS,
  type CostLine,
} from '../src/hubs/modeling/platforms/refm/lib/state/module1-types';
import {
  restoreStrippedPhasingSource, hydrationFromAnySnapshotChecked,
} from '../src/hubs/modeling/platforms/refm/lib/state/module1-migrate';
import { planCostCopy } from '../src/hubs/modeling/platforms/refm/lib/state/costCopyPlan';
import type { HydrateSnapshot } from '../src/hubs/modeling/platforms/refm/lib/state/module1-store';

let passed = 0;
const failures: string[] = [];
const check = (name: string, ok: boolean, detail = ''): void => {
  if (ok) { passed += 1; return; }
  failures.push(`${name}${detail ? `  [${detail}]` : ''}`);
};
const section = (t: string): void => console.log(`\n-- ${t} ${'-'.repeat(Math.max(0, 62 - t.length))}`);

const ROOT = path.resolve(__dirname, '..');
const read = (rel: string): string =>
  fs.readFileSync(path.join(ROOT, rel), 'utf8').replace(/\r\n/g, '\n');
const REFM = 'src/hubs/modeling/platforms/refm';
const SRC_TYPES = read(`${REFM}/lib/state/module1-types.ts`);
const SRC_MIGRATE = read(`${REFM}/lib/state/module1-migrate.ts`);
const SRC_COSTS_UI = read(`${REFM}/components/modules/Module1Costs.tsx`);
const SRC_COPY_PLAN = read(REFM + '/lib/state/costCopyPlan.ts');
const SRC_STORE = read(`${REFM}/lib/state/module1-store.ts`);
const SRC_ROUTE = read('app/api/refm/cost-catalog/route.ts');
const MIGRATION_214 = read('supabase/migrations/214_refm_cost_catalog.sql');

/** Strip line and block comments so a name mentioned in prose is never mistaken
 *  for a name in code. */
const base = (id: string): string => id.split('__')[0];
const stripComments = (src: string): string =>
  src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');

// ════════════════════════════════════════════════════════════════════════════
section('A. The field whitelist cannot silently drop a CostLine field');

{
  // The interface, from `export interface CostLine {` to the first line that is
  // a bare closing brace at column 0.
  const ifaceStart = SRC_TYPES.indexOf('export interface CostLine {');
  check('the CostLine interface is found', ifaceStart >= 0);
  const ifaceBody = SRC_TYPES.slice(ifaceStart).split(/\n\}/)[0];
  const declaredFields = Array.from(stripComments(ifaceBody).matchAll(/^\s{2}(\w+)\??\s*:/gm)).map((m) => m[1]);
  check('the interface yields a plausible field list', declaredFields.length >= 15, `${declaredFields.length} fields`);
  check('it includes the two that were dropped before',
    declaredFields.includes('phasingSource') && declaredFields.includes('windowFollowsConstruction'));

  // The rebuild literal inside migrateLegacyToV8.
  const mapStart = SRC_MIGRATE.indexOf('let costLines: CostLine[] = rawCostLines.map(');
  check('the loose-path rebuild is found', mapStart >= 0);
  const literalStart = SRC_MIGRATE.indexOf('return {', mapStart);
  const literalEnd = SRC_MIGRATE.indexOf('\n    };', literalStart);
  const literal = SRC_MIGRATE.slice(literalStart, literalEnd);
  const namedFields = Array.from(stripComments(literal).matchAll(/^\s+(\w+):/gm)).map((m) => m[1]);
  check('the literal yields a plausible key list', namedFields.length >= 15, `${namedFields.length} keys`);

  const missing = declaredFields.filter((f) => !namedFields.includes(f));
  check(
    'EVERY CostLine field is named in the loose-path rebuild',
    missing.length === 0,
    missing.length > 0
      ? `add to migrateLegacyToV8's literal or it is dropped on every hydrate: ${missing.join(', ')}`
      : '',
  );

  // The guard must be able to FAIL: prove the two lists are really compared by
  // checking a field the literal does not name is detected.
  const pretendDeclared = [...declaredFields, 'someFutureField'];
  const pretendMissing = pretendDeclared.filter((f) => !namedFields.includes(f));
  check('the guard detects an unnamed field', pretendMissing.includes('someFutureField'));
}

// ════════════════════════════════════════════════════════════════════════════
section('B. A stripped phasing source is restored, a chosen one is not');

{
  const mk = (over: Partial<CostLine>): CostLine => ({
    id: 'commission__phase_1', phaseId: 'phase_1', name: 'Commission',
    method: 'percent_of_selected', value: 0, stage: 'soft', scope: 'indirect',
    allocationBasis: 'per_asset', startPeriod: 1, endPeriod: 4, phasing: 'even', ...over,
  });
  const snapOf = (lines: CostLine[]): HydrateSnapshot => ({
    project: makeDefaultProject(),
    phases: [{ ...makeDefaultPhase('phase_1'), constructionPeriods: 4 }],
    parcels: [], assets: [], subUnits: [], costLines: lines, costOverrides: [],
    financingTranches: [], equityContributions: [], landAllocationMode: 'sqm',
  } as unknown as HydrateSnapshot);

  const stripped = restoreStrippedPhasingSource(snapOf([mk({ phasingSource: undefined })]));
  check('an absent source on a commission line is restored to collections',
    stripped.costLines[0].phasingSource === 'collections', String(stripped.costLines[0].phasingSource));

  const marketing = restoreStrippedPhasingSource(snapOf([mk({ id: 'marketing__phase_1', phasingSource: undefined })]));
  check('marketing is restored to collections', marketing.costLines[0].phasingSource === 'collections');
  const rett = restoreStrippedPhasingSource(snapOf([mk({ id: 'rett__phase_1', phasingSource: undefined })]));
  check('rett is restored to the land cash outflow', rett.costLines[0].phasingSource === 'land_cash');

  // THE ONE THAT MATTERS: a deliberate choice is a PRESENT value.
  const chosen = restoreStrippedPhasingSource(snapOf([mk({ phasingSource: 'inherit' })]));
  check('a deliberate inherit is left alone', chosen.costLines[0].phasingSource === 'inherit');
  const own = restoreStrippedPhasingSource(snapOf([mk({ phasingSource: 'own' })]));
  check('a deliberate own is left alone', own.costLines[0].phasingSource === 'own');

  // A construction line's catalog entry names no source, so nothing is invented.
  const bua = restoreStrippedPhasingSource(snapOf([mk({ id: 'construction-bua__phase_1', phasingSource: undefined })]));
  check('a line whose entry names no source is untouched', bua.costLines[0].phasingSource === undefined);
  const custom = restoreStrippedPhasingSource(snapOf([mk({ id: 'custom-1__phase_1', phasingSource: undefined })]));
  check('a custom line is untouched', custom.costLines[0].phasingSource === undefined);
  check('the restore is idempotent',
    JSON.stringify(restoreStrippedPhasingSource(stripped)) === JSON.stringify(stripped));

  // End to end: it survives a full hydration, which is where it was being lost.
  const hydrated = hydrationFromAnySnapshotChecked({
    ...snapOf([mk({ phasingSource: undefined })]),
  } as unknown);
  const line = hydrated.snapshot.costLines.find((c) => c.id === 'commission__phase_1');
  check('and it survives a full hydration', line?.phasingSource === 'collections', String(line?.phasingSource));
}

// ════════════════════════════════════════════════════════════════════════════
section('C. The catalog covers a real development and carries behaviour');

{
  const required = [
    'superstructure', 'parking', 'landscape', 'infrastructure', 'engineering supervision',
    'design consultancy', 'permits and approvals', 'project management', 'pre-operating',
    'developer fee', 'contingency', 'transfer tax', 'marketing', 'commission',
  ];
  const labels = BUILT_IN_COST_CATALOG.map((e) => e.label.toLowerCase());
  for (const want of required) {
    check(`the catalog covers "${want}"`, labels.some((l) => l.includes(want)), labels.join(' | '));
  }
  check('professional fee is kept alongside the more specific pair',
    labels.some((l) => l.includes('professional fee'))
    && labels.some((l) => l.includes('project management'))
    && labels.some((l) => l.includes('design consultancy')));

  for (const e of BUILT_IN_COST_CATALOG) {
    check(`${e.id} carries a valid method`, (COST_METHODS as readonly string[]).includes(e.method), e.method);
    check(`${e.id} carries a valid stage`, (COST_STAGES as readonly string[]).includes(e.stage), e.stage);
    check(`${e.id} carries a valid basis`, (ALLOCATION_BASES as readonly string[]).includes(e.allocationBasis));
    check(`${e.id} carries a valid scope`, (COST_SCOPES as readonly string[]).includes(e.scope));
    if (e.phasingSource) {
      check(`${e.id} carries a valid source`, (CAPEX_PHASING_SOURCES as readonly string[]).includes(e.phasingSource));
    }
    check(`${e.id} is safe inside a composed line id`, /^[a-z0-9-]{1,48}$/.test(e.id), e.id);
  }
  const selling = ['marketing', 'commission'];
  for (const id of selling) {
    check(`${id} follows collections`, findCatalogEntry(id)?.phasingSource === 'collections');
  }
  check('rett follows the land cash outflow', findCatalogEntry('rett')?.phasingSource === 'land_cash');
  check('the two land rows are never offered',
    findCatalogEntry('land-cash')?.selectable === false && findCatalogEntry('land-inkind')?.selectable === false);

  // EVERY EXISTING LINE RESOLVES AN IDENTITY WITH NO MIGRATION.
  const seeded = makeBlankCostLines('phase_1', 4);
  for (const l of seeded) {
    check(`seeded ${l.id.split('__')[0]} resolves an identity`, resolveCatalogId(l) !== undefined, l.id);
  }
  const renamed: CostLine = { ...seeded.find((l) => l.id.startsWith('commission'))!, name: 'Permits and approvals' };
  check('a RENAMED line still declares what it is',
    catalogLabelFor(renamed) === 'Commission', catalogLabelFor(renamed));
  check('a genuine one-off says so',
    catalogLabelFor({ id: 'custom-123__phase_1' }) === 'Custom line');

  // THE SEED IS UNCHANGED: the four new entries are selectable, not seeded.
  const seededIds = new Set(seeded.map((l) => l.id.split('__')[0]));
  for (const id of ['engineering-supervision', 'design-consultancy', 'permits-approvals', 'project-management']) {
    check(`${id} is selectable but NOT seeded`,
      BUILT_IN_COST_CATALOG.some((e) => e.id === id) && !seededIds.has(id));
  }
  check('the seed is still thirteen lines', seeded.length === 13, String(seeded.length));
}

// ════════════════════════════════════════════════════════════════════════════
section('D. Selecting stamps behaviour; renaming changes only the label');

{
  const marketing = findCatalogEntry('marketing')!;
  const stamp = stampFromEntry(marketing);
  check('the stamp carries the method', stamp.method === 'percent_of_revenue_sale');
  check('the stamp carries the stage', stamp.stage === 'marketing');
  check('the stamp writes stageOverride too, so the id map cannot outrank it',
    stamp.stageOverride === 'marketing');
  check('the stamp carries the phasing source', stamp.phasingSource === 'collections');
  check('the stamp records the catalog id', stamp.catalogId === 'marketing');
  check('the stamp does NOT touch the name, value or window',
    !('name' in stamp) && !('value' in stamp) && !('startPeriod' in stamp) && !('selectedLineIds' in stamp));

  const commissionLine: CostLine = {
    id: 'commission__phase_1', phaseId: 'phase_1', name: 'Permits and approvals',
    method: 'percent_of_selected', value: 2, stage: 'soft', scope: 'indirect',
    allocationBasis: 'per_asset', startPeriod: 1, endPeriod: 4, phasing: 'even',
    phasingSource: 'collections',
  };
  const changes = describeCatalogChange(commissionLine, findCatalogEntry('permits-approvals')!, {
    method: COST_METHOD_LABELS as unknown as Record<string, string>,
    stage: COST_STAGE_LABELS as unknown as Record<string, string>,
    source: CAPEX_PHASING_SOURCE_LABELS as unknown as Record<string, string>,
  });
  check('a reassignment states what it will change', changes.length >= 2, JSON.stringify(changes));
  check('including the method', changes.some((c) => c.field === 'Method'));
  check('including the phasing source', changes.some((c) => c.field === 'Phasing source'));
  const noChange = describeCatalogChange(
    { ...commissionLine, method: 'percent_of_selected', stage: 'soft', phasingSource: 'collections' },
    findCatalogEntry('commission')!,
    {
      method: COST_METHOD_LABELS as unknown as Record<string, string>,
      stage: COST_STAGE_LABELS as unknown as Record<string, string>,
      source: CAPEX_PHASING_SOURCE_LABELS as unknown as Record<string, string>,
    },
  );
  check('and says nothing when nothing changes', noChange.length === 0, JSON.stringify(noChange));
  check('the row asks before reassigning', SRC_COSTS_UI.includes('describeCatalogChange('));
  check('the row shows its catalog identity', SRC_COSTS_UI.includes('-catalog'));
  check('and flags a row whose label claims to be a different entry', SRC_COSTS_UI.includes('catalog-renamed'));
  // The flag must not fire on a seeded row whose name is a SYNONYM of its
  // entry, or the signal is noise where it has to be trusted.
  check('the flag compares against OTHER entries, not this one',
    SRC_COSTS_UI.includes('nameClaimsAnotherEntry')
    && /e\.id !== currentCatalogId && e\.label\.trim\(\)\.toLowerCase\(\) === line\.name/.test(SRC_COSTS_UI));
  const synonyms: Array<[string, string]> = [
    ['construction-bua', 'Construction (BUA)'],
    ['landscaping', 'Landscaping'],
    ['rett', 'Real Estate Transfer Tax'],
  ];
  for (const [id, seededName] of synonyms) {
    const entry = findCatalogEntry(id)!;
    const claimsOther = BUILT_IN_COST_CATALOG.some(
      (e) => e.id !== id && e.label.trim().toLowerCase() === seededName.trim().toLowerCase(),
    );
    check(`the seeded name "${seededName}" does not claim another entry`, !claimsOther, entry.label);
  }
  const mislabelled = BUILT_IN_COST_CATALOG.some(
    (e) => e.id !== 'professional-fee' && e.label.trim().toLowerCase() === 'project management',
  );
  check('but "Project management" on a Professional fee line does', mislabelled);

  // Ids minted from an entry survive deriveLineBaseId.
  check('a minted id composes cleanly', mintLineId('marketing', 'phase_1', []) === 'marketing__phase_1');
  check('a second one does not collide',
    mintLineId('marketing', 'phase_1', ['marketing__phase_1']) === 'marketing-2__phase_1');
  check('a user label normalises to a safe id', normaliseCatalogId('Utility Connections!') === 'utility-connections');

  // A user entry layers on top and never shadows a built-in.
  const userEntry: UserCostCatalogEntry = {
    id: 'utility-connections', label: 'Utility connections', method: 'fixed', stage: 'hard',
    allocationBasis: 'per_asset', scope: 'direct',
  };
  const merged = mergeCatalog([userEntry, { ...userEntry, id: 'marketing', label: 'Hijack' }]);
  check('a user entry joins the list', merged.some((e) => e.id === 'utility-connections'));
  check('and cannot shadow a built-in',
    merged.filter((e) => e.id === 'marketing').length === 1
    && merged.find((e) => e.id === 'marketing')?.label === 'Marketing');
}

// ════════════════════════════════════════════════════════════════════════════
section('E. One money strip, rendered from the engine');

{
  // Scoped to the CostRow body and comment-stripped, so the assertion is
  // "this function never distributes money", not "one particular spelling of
  // one particular line is absent". A sabotage that renamed the variable
  // slipped past the narrower form.
  const rowStart = SRC_COSTS_UI.indexOf('function CostRow({');
  const rowBody = stripComments(SRC_COSTS_UI.slice(rowStart).split(/\n\}\n/)[0]);
  check('the CostRow body is found', rowStart >= 0 && rowBody.length > 2000, `${rowBody.length} chars`);
  check('the row never calls distributeItemCost',
    !rowBody.includes('distributeItemCost('),
    'the row must render the engine schedule, not compute one');
  check('and never re-derives money from weights',
    !/\*\s*pct\s*\)\s*\/\s*sumDenom/.test(rowBody));
  check('it renders the engine schedule', SRC_COSTS_UI.includes('resolvedSchedule={breakdown.perLinePerPeriod[line.id]}'));
  check('the duplicate money chip block is gone', !SRC_COSTS_UI.includes('manual-money-chips'));
  check('exactly one chip strip remains',
    (SRC_COSTS_UI.match(/-chip-strip/g) ?? []).length >= 1
    && (SRC_COSTS_UI.match(/data-testid=\{`cost-row-\$\{asset\.id\}-\$\{line\.id\}-chip-strip`\}/g) ?? []).length === 1);
  check('the manual block keeps its weight inputs', SRC_COSTS_UI.includes('-manual-row'));
}

// ════════════════════════════════════════════════════════════════════════════
section('F. Copy reconciles by identity; undo restores at the index');

{
  // ── THE PLAN IS PURE AND TESTED AGAINST A REAL SHAPE (2026-08-17) ───────
  //
  // This used to be asserted by grepping the click handler for source strings,
  // which is how "copy reproduces the line set" could pass while a live project
  // still did not do it. The plan is now a function, so the check runs it.
  //
  // The fixture is the live project's shape: phase 1 carries renamed catalog
  // lines and custom lines with a catalogId; phase 2 carries the seeded set
  // PLUS a country-gated `rett__phase_2` that the user cannot see.
  const p1 = [
    ...makeBlankCostLines('phase_1', 4).filter((l) => base(l.id) !== 'rett'),
    { ...makeBlankCostLines('phase_1', 4).find((l) => base(l.id) === 'pre-operating')!, name: 'Design and consultants' },
    { id: 'custom-11__phase_1', phaseId: 'phase_1', name: 'Permits & Approvals', method: 'percent_of_selected', value: 1, stage: 'soft', scope: 'indirect', allocationBasis: 'bua_share', startPeriod: 1, endPeriod: 4, phasing: 'even', catalogId: 'permits-approvals' },
    { id: 'custom-12__phase_1', phaseId: 'phase_1', name: 'Real Estate Transfer Tax (RETT)', method: 'percent_of_cash_land', value: 5, stage: 'land', scope: 'direct', allocationBasis: 'land_share', startPeriod: 0, endPeriod: 0, phasing: 'even', catalogId: 'rett' },
  ] as CostLine[];
  const p2 = makeBlankCostLines('phase_2', 3).map((l) => (
    base(l.id) === 'rett' ? { ...l, value: 5 } : l
  ));
  const project = [...p1, ...p2];

  const plan = planCostCopy({
    costLines: project,
    sourcePhaseId: 'phase_1',
    sourceAssetId: 'a1',
    targetPhaseIds: ['phase_2'],
    country: '',
    removeExtra: false,
  });
  const phase2Plan = plan.phases[0];
  check('the gated line is not offered by the source', !plan.sourceLines.some((l) => base(l.id) === 'rett'));
  check('EVERY source line reaches a counterpart', plan.unmatched === 0, `${plan.unmatched} unmatched`);
  check('the user\'s own RETT is CREATED in the target phase',
    phase2Plan.toCreate.some((l) => l.catalogId === 'rett'),
    phase2Plan.toCreate.map((l) => l.name).join(', '));
  check('and it does NOT map onto the hidden country-gated row',
    plan.phases[0].mapping.get('custom-12__phase_1') !== 'rett__phase_2',
    String(plan.phases[0].mapping.get('custom-12__phase_1')));
  check('the custom permits line is created too',
    phase2Plan.toCreate.some((l) => l.catalogId === 'permits-approvals'));
  check('a line that already exists is matched, not duplicated',
    !phase2Plan.toCreate.some((l) => base(l.id) === 'construction-bua')
    && plan.phases[0].mapping.get('construction-bua__phase_1') === 'construction-bua__phase_2');
  check('the created lines land in the target phase', phase2Plan.toCreate.every(() => true)
    && plan.nextCostLines.filter((c) => c.phaseId === 'phase_2').length === p2.length + phase2Plan.toCreate.length);
  check('nothing is removed unless asked', plan.removed === 0);
  check('and the source phase is untouched',
    JSON.stringify(plan.nextCostLines.filter((c) => c.phaseId === 'phase_1')) === JSON.stringify(p1));

  const removing = planCostCopy({
    costLines: project, sourcePhaseId: 'phase_1', sourceAssetId: 'a1',
    targetPhaseIds: ['phase_2'], country: '', removeExtra: true,
  });
  check('removing extras drops what the source does not have', removing.removed > 0);
  check('but never the parcel-driven land rows',
    removing.nextCostLines.some((c) => c.id === 'land-cash__phase_2')
    && removing.nextCostLines.some((c) => c.id === 'land-inkind__phase_2'));

  // Two lines sharing one entry map one for one, not both onto the first.
  const twoMarketing = [
    ...p1,
    { id: 'custom-13__phase_1', phaseId: 'phase_1', name: 'Launch campaign', method: 'percent_of_revenue_sale', value: 1, stage: 'marketing', scope: 'indirect', allocationBasis: 'per_asset', startPeriod: 1, endPeriod: 4, phasing: 'even', catalogId: 'marketing' } as CostLine,
    ...p2,
  ];
  const dup = planCostCopy({
    costLines: twoMarketing, sourcePhaseId: 'phase_1', sourceAssetId: 'a1',
    targetPhaseIds: ['phase_2'], country: '', removeExtra: false,
  });
  const marketingSources = dup.sourceLines.filter((l) => resolveCatalogId(l) === 'marketing');
  check('two lines sharing an entry are both mapped', marketingSources.length === 2
    && new Set(marketingSources.map((l) => dup.phases[0].mapping.get(l.id))).size === 2,
    marketingSources.map((l) => `${l.name}->${dup.phases[0].mapping.get(l.id)}`).join(', '));

  check('copy matches by catalog identity, not display name',
    !SRC_COSTS_UI.includes('c.name.trim().toLowerCase() === line.name.trim().toLowerCase()'));
  check('the plan is a module, not a click handler',
    SRC_COSTS_UI.includes('planCostCopy({') && !SRC_COSTS_UI.includes('const withOccurrence ='));
  check('a missing line is created rather than skipped', SRC_COPY_PLAN.includes('mintLineId('));
  check('both sides use the same visibility rule',
    (SRC_COPY_PLAN.match(/assetVisibleLines\(/g) ?? []).length >= 2);
  check('selections are remapped into the target phase', SRC_COPY_PLAN.includes('remapped.length > 0'));
  check('removing extra lines is opt-in', SRC_COSTS_UI.includes('costs-copy-panel-remove-extra'));
  check('the result is reported', SRC_COSTS_UI.includes('costs-copy-panel-result'));
  check('and the dialog says the change is phase-wide',
    SRC_COSTS_UI.includes('every asset in them'));

  check('the store can restore a line', SRC_STORE.includes('restoreCostLine:'));
  check('at its index', SRC_STORE.includes('next.splice(Math.max(0, Math.min(index, next.length)), 0, line)'));
  check('with its overrides', SRC_STORE.includes('restoredOverrides'));
  check('the tab offers undo', SRC_COSTS_UI.includes('costs-undo-banner') && SRC_COSTS_UI.includes('costs-undo-restore'));
  check('and no longer asks for a confirm on delete',
    !SRC_COSTS_UI.includes("window.confirm(`Remove '"));
}

// ════════════════════════════════════════════════════════════════════════════
section('G. Storage: shared per user, and never on a calculation path');

{
  check('migration 214 creates the table', MIGRATION_214.includes('CREATE TABLE IF NOT EXISTS refm_cost_catalog'));
  check('scoped to a user', MIGRATION_214.includes('user_id      UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE'));
  check('one row per entry per user', MIGRATION_214.includes('UNIQUE (user_id, entry_id)'));
  check('the id shape is enforced by the database', MIGRATION_214.includes("entry_id ~ '^[a-z0-9-]{1,48}$'"));
  check('RLS is on', MIGRATION_214.includes('ENABLE ROW LEVEL SECURITY'));

  check('the route scopes every read to the caller', SRC_ROUTE.includes(".eq('user_id', userId)"));
  check('it validates method and stage against the live unions',
    SRC_ROUTE.includes('COST_METHODS as readonly string[]') && SRC_ROUTE.includes('COST_STAGES as readonly string[]'));
  check('a user entry cannot shadow a built-in', SRC_ROUTE.includes('BUILT_IN_COST_CATALOG.some('));
  check('an unreachable table fails SOFT', SRC_ROUTE.includes('available: false'));
  check('the client falls back to the built-ins', SRC_COSTS_UI.includes('mergeCatalog(userCatalog)'));
}

// ── Report ─────────────────────────────────────────────────────────────────
console.log(`\n${'='.repeat(70)}`);
console.log(`verify-cost-catalog: ${passed} passed, ${failures.length} failed`);
if (failures.length > 0) {
  for (const f of failures) console.log(`  FAIL  ${f}`);
  process.exit(1);
}
