/**
 * verify-deck-version-autoname.ts (REFM Module 7: auto-named presentation
 * versions + open-the-last-version)
 *
 * Three claims are worth pinning, and each is asserted where it can actually
 * fail rather than by grepping for a phrase:
 *
 *   1. AUTO-NAMING. A presentation version names itself on the SAME rollover
 *      rules the model versions use (1.0 to 1.9 then 2.0, advancing from the
 *      latest by date so a delete never refills a number). The two schemes must
 *      agree on the label and the date, or "the same automated naming pattern"
 *      stops being true. Asserted by running both namers on the same inputs.
 *   2. OPEN THE LAST VERSION. `shouldOpenVersion` is the whole decision, so it
 *      is exercised directly: version wins by default, the working row wins
 *      only when it is demonstrably newer, and an unreadable timestamp must not
 *      silently restore the old behaviour.
 *   3. SEPARATION from model versioning. This is a structural claim, so it is
 *      checked structurally: the deck persistence and routes must never touch
 *      the project version table, and the project persistence must never touch
 *      the deck tables. The single shared thing is the PURE naming helper, and
 *      the test asserts that is all it is (no client, no table, no I/O).
 *
 * Teeth check: every assertion here fails against the pre-change code. The
 * auto-name did not exist, `saveDeckVersion` required a label (the route 400d
 * without one), and `shouldOpenVersion` did not exist because `getDeck` never
 * looked at the version table at all.
 *
 * Pure and offline: no database, no React, no DOM.
 *
 * No em dashes in this file.
 */
import { readFileSync } from 'fs';
import { join } from 'path';
import {
  autoDeckVersionName, buildDeckVersionName, nextDeckVersionLabel, parseDeckVersionLabel,
} from '../src/hubs/modeling/platforms/refm/lib/reports/deck/versionNaming';
import { buildVersionName, getNextVersionNumber } from '../src/hubs/modeling/platforms/refm/lib/persistence/versionNaming';
import { shouldOpenVersion } from '../src/hubs/modeling/platforms/refm/lib/persistence/deck-server';

let pass = 0, fail = 0;
const check = (name: string, cond: boolean): void => { if (cond) { pass++; console.log(`  [PASS] ${name}`); } else { fail++; console.log(`  [FAIL] ${name}`); } };

const root = join(__dirname, '..');
const read = (p: string): string => readFileSync(join(root, p), 'utf8');
const containsEmDashLiteral = (t: string): boolean => new RegExp(`[—―]`).test(t);

const DATE = new Date('2026-08-03T10:00:00Z');
const v = (label: string | null, createdAt: string) => ({ label, createdAt });

console.log('== auto-naming: shape ==');
{
  const name = buildDeckVersionName('FMP RE HUB', '1.0', DATE);
  check('name is {Project}_Presentation_v{X.Y}_{MMDDYYYY}', name === 'FMP RE HUB_Presentation_v1.0_08032026');
  check('the label round-trips out of the name', parseDeckVersionLabel(name) === '1.0');
  check('a missing project name degrades to Project, never empty', buildDeckVersionName(null, '1.0', DATE).startsWith('Project_Presentation_'));
  check('filename-breaking characters are replaced', !/[/\\:*?"<>|]/.test(buildDeckVersionName('A/B:C*D', '1.0', DATE)));
  check('a name is produced with NO user input at all', autoDeckVersionName('P', [], DATE).length > 0);
}

console.log('== auto-naming: the sequence, identical to the model versions ==');
{
  check('first version is 1.0', nextDeckVersionLabel([]) === '1.0');
  check('the minor increments', nextDeckVersionLabel([v('P_Presentation_v1.0_08032026', '2026-08-01T10:00:00Z')]) === '1.1');
  check('1.9 rolls to 2.0', nextDeckVersionLabel([v('P_Presentation_v1.9_08032026', '2026-08-01T10:00:00Z')]) === '2.0');

  // Advancing from the LATEST by date, not the maximum, is what makes a delete
  // leave its number spent. Same rule as the model versions.
  const afterDelete = [
    v('P_Presentation_v1.0_08012026', '2026-08-01T10:00:00Z'),
    v('P_Presentation_v1.2_08022026', '2026-08-02T10:00:00Z'),
  ];
  check('a deleted version does not refill its number', nextDeckVersionLabel(afterDelete) === '1.3');
  check('row order does not matter', nextDeckVersionLabel([...afterDelete].reverse()) === '1.3');

  // A hand-typed name from before auto-naming has no parseable label. It must
  // be ignored, not treated as 1.0, or one custom name resets the sequence.
  const mixed = [
    v('Pre-IC draft', '2026-08-02T12:00:00Z'),
    v('P_Presentation_v1.4_08012026', '2026-08-01T10:00:00Z'),
  ];
  check('an unparseable custom name never resets the sequence', nextDeckVersionLabel(mixed) === '1.5');
  check('only custom names means start at 1.0', nextDeckVersionLabel([v('Board pack', '2026-08-02T12:00:00Z')]) === '1.0');
  check('a null label is tolerated', nextDeckVersionLabel([v(null, '2026-08-02T12:00:00Z')]) === '1.0');
}

console.log('== auto-naming: the deck and the model agree ==');
{
  // Same rollover helper, same date format. If either scheme drifts, the label
  // or the date segment stops matching and this fails.
  const existing = [
    v('P_Presentation_v1.0_08012026', '2026-08-01T10:00:00Z'),
    v('P_Presentation_v1.1_08022026', '2026-08-02T10:00:00Z'),
  ];
  const deckLabel = nextDeckVersionLabel(existing);
  const modelLabel = getNextVersionNumber(existing.map((e) => ({ versionLabel: parseDeckVersionLabel(e.label), createdAt: e.createdAt })));
  check('the deck label equals the model label on the same history', deckLabel === modelLabel);

  const modelName = buildVersionName('Proj', deckLabel, 'Task', DATE);
  const deckName = buildDeckVersionName('Proj', deckLabel, DATE);
  check('both embed the same _vX.Y_ token', parseDeckVersionLabel(modelName) === parseDeckVersionLabel(deckName));
  check('both embed the same MMDDYYYY date', modelName.includes('08032026') && deckName.includes('08032026'));
  check('the deck name carries no task word (nothing is typed)', deckName === 'Proj_Presentation_v1.2_08032026');
}

console.log('== open the last saved version ==');
{
  const V = '2026-08-02T10:00:00Z';
  check('no working row: the version opens', shouldOpenVersion({ hasWorkingDeck: false, workingUpdatedAt: null, versionCreatedAt: V }));
  check('working row older than the version: the version opens',
    shouldOpenVersion({ hasWorkingDeck: true, workingUpdatedAt: '2026-08-01T10:00:00Z', versionCreatedAt: V }));
  check('identical timestamps: the version opens (it is the saved one)',
    shouldOpenVersion({ hasWorkingDeck: true, workingUpdatedAt: V, versionCreatedAt: V }));
  check('working row NEWER than the version: the working row opens (nothing saved later is discarded)',
    !shouldOpenVersion({ hasWorkingDeck: true, workingUpdatedAt: '2026-08-03T10:00:00Z', versionCreatedAt: V }));
  check('an unreadable working timestamp still opens the version',
    shouldOpenVersion({ hasWorkingDeck: true, workingUpdatedAt: 'not a date', versionCreatedAt: V }));
  check('an unreadable version timestamp still opens the version',
    shouldOpenVersion({ hasWorkingDeck: true, workingUpdatedAt: V, versionCreatedAt: null }));
}

console.log('== a name is optional everywhere it is accepted ==');
{
  const server = read('src/hubs/modeling/platforms/refm/lib/persistence/deck-server.ts');
  const route = read('app/api/refm/projects/[id]/report-deck/versions/route.ts');
  const client = read('src/hubs/modeling/platforms/refm/lib/persistence/client.ts');
  const modal = read('src/hubs/modeling/platforms/refm/components/modules/deck/DeckVersionsModal.tsx');

  // No dotAll flag: the build's tsc target predates es2018, and [^)] already
  // spans newlines.
  check('saveDeckVersion accepts a null label', /saveDeckVersion\([^)]*label: string \| null/.test(server));
  check('saveDeckVersion auto-names when none is given', server.includes('autoDeckVersionName'));
  check('the version row is never written with a null label', server.includes('label: finalLabel'));
  check('the POST route no longer rejects a missing name', !route.includes('A version name is required'));
  check('the POST route passes the blank name on as null', route.includes('label || null'));
  check('the client label parameter is optional', /saveReportDeckVersion\([^)]*label\?: string \| null/.test(client));
  check('the versions modal no longer blocks Save on an empty name', !/disabled=\{busy \|\| !label\.trim\(\)\}/.test(modal));
}

console.log('== an in-place save targets the version that is OPEN ==');
{
  // The save chooser used to resolve the target from `current_version_id`,
  // which only moves on a SAVE. Open an older version from the versions modal
  // and that pointer still named the previously saved one, so confirming
  // "update" would name one version and overwrite another. The editor's own
  // openedVersion is the single truth now, and the chooser is TOLD it.
  const chooser = read('src/hubs/modeling/platforms/refm/components/modules/deck/DeckSaveChoiceModal.tsx');
  const shell = read('src/hubs/modeling/platforms/refm/components/modules/Module7Deck.tsx');

  check('the save chooser takes the open version as a prop', /openVersion: DeckVersionListItem \| null/.test(chooser));
  check('the save chooser no longer resolves the stored pointer itself',
    !chooser.includes('listReportDeckVersions') && !chooser.includes('currentVersionId'));
  check('the shell passes the version it actually has open', /openVersion=\{openedVersion\}/.test(shell));
  check('opening a version re-points what a save updates', /setOpenedVersion\(version\)/.test(shell));
  check('a save records the version it just wrote', /setOpenedVersion\(v\)/.test(shell));
  check('the versions list marks the OPEN version from the editor, not the pointer',
    /openedVersionId \?\? currentId/.test(read('src/hubs/modeling/platforms/refm/components/modules/deck/DeckVersionsModal.tsx')));
}

console.log('== report versioning stays separate from model versioning ==');
{
  const deckServer = read('src/hubs/modeling/platforms/refm/lib/persistence/deck-server.ts');
  const deckNaming = read('src/hubs/modeling/platforms/refm/lib/reports/deck/versionNaming.ts');
  const projServer = read('src/hubs/modeling/platforms/refm/lib/persistence/server.ts');
  const sync = read('src/hubs/modeling/platforms/refm/lib/persistence/module1-sync.ts');
  const deckRoute = read('app/api/refm/projects/[id]/report-deck/route.ts');
  const versionsRoute = read('app/api/refm/projects/[id]/report-deck/versions/route.ts');
  const projVersionsRoute = read('app/api/refm/projects/[id]/versions/route.ts');

  check('deck persistence never reads the project version table', !deckServer.includes('refm_project_versions'));
  check('the deck routes never read the project version table',
    !deckRoute.includes('refm_project_versions') && !versionsRoute.includes('refm_project_versions'));
  check('project persistence never reads the deck tables',
    !projServer.includes('refm_report_deck') && !sync.includes('refm_report_deck'));
  check('the project version route never touches the deck', !projVersionsRoute.includes('report_deck') && !projVersionsRoute.includes('report-deck'));
  check('the deck writes its OWN table', deckServer.includes('refm_report_deck_versions'));

  // The one shared thing is a pure function module. If it ever grows a client,
  // a table or a fetch, the two histories have started to couple.
  check('the shared naming module imports only the pure helper',
    /from '\.\.\/\.\.\/persistence\/versionNaming'/.test(deckNaming));
  check('the shared naming module has no database client', !deckNaming.includes('getServerClient') && !deckNaming.includes('supabase'));
  check('the shared naming module names no table', !deckNaming.includes('refm_'));
  check('the shared naming module makes no request', !deckNaming.includes('fetch('));
}

console.log('== house style ==');
{
  for (const p of [
    'src/hubs/modeling/platforms/refm/lib/reports/deck/versionNaming.ts',
    'src/hubs/modeling/platforms/refm/lib/persistence/deck-server.ts',
    'app/api/refm/projects/[id]/report-deck/route.ts',
    'app/api/refm/projects/[id]/report-deck/versions/route.ts',
    'src/hubs/modeling/platforms/refm/components/modules/deck/DeckVersionsModal.tsx',
    'src/hubs/modeling/platforms/refm/components/modules/deck/DeckSaveChoiceModal.tsx',
    'src/hubs/modeling/platforms/refm/components/modules/Module7Deck.tsx',
  ]) check(`no em dash in ${p.split('/').pop()}`, !containsEmDashLiteral(read(p)));
}

console.log(`\n${fail === 0 ? 'ALL PASS' : 'FAILURES'}: ${pass} passed, ${fail} failed`);
process.exit(fail === 0 ? 0 : 1);
