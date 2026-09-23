/**
 * probe-change-log-live.ts
 *
 * PROVES THE THREE ACTIVITY-LOG DEFECTS ARE CLOSED ON ROWS THE NEW CODE
 * ACTUALLY WROTE, not on what the differ says it would write.
 *
 * The founder's instruction was exact: "confirm the three defects are closed by
 * saving on Marina Gate and reading the rows the new code writes, rather than
 * asserting it from the differ". So this runs the save route's OWN chain,
 *
 *     diffSnapshots(stored, incoming) -> rowsForSave(...) -> appendChanges(...)
 *
 * against the REAL stored snapshot of FMP - MARINA GATE, then reads the rows
 * back OUT OF THE TABLE and checks the three things on what the database holds.
 *
 * THE WRITES ARE A PROOF, NOT DATA, AND THEY ARE UNDONE. They are deleted by
 * their own save_id at the end, and each deletion re-proves the row is this
 * probe's before removing it. Writing a fictional edit into a real project's
 * append-only audit log is the exact defect cleaned up this morning
 * (scripts/cleanup-probe-rows-245-246.ts), and it is not acceptable as the
 * price of proving a display fix.
 *
 * The three defects, each checked on a STORED row:
 *   1. a scalar field update carries a LABEL in words, not the raw path;
 *   2. a key REORDER inside an otherwise identical object writes NO ROW;
 *   3. a value CLEARED on a record that still exists is action 'clear',
 *      never 'remove'.
 *
 * Run: npx tsx --env-file=.env.local scripts/probe-change-log-live.ts
 *
 * No em dashes in this file.
 */
import { diffSnapshots } from '../src/hubs/modeling/platforms/refm/lib/persistence/snapshot-diff';
import { rowsForSave, appendChanges } from '../src/hubs/modeling/platforms/refm/lib/persistence/changeLog';

interface PgRow { [k: string]: unknown }
interface PgClient {
  connect(): Promise<void>;
  query(text: string, values?: unknown[]): Promise<{ rows: PgRow[]; rowCount: number | null }>;
  end(): Promise<void>;
}
type PgClientCtor = new (cfg: Record<string, unknown>) => PgClient;
// eslint-disable-next-line @typescript-eslint/no-require-imports
const { Client } = require('pg') as { Client: PgClientCtor };

const PROJECT = 'c417fc6a-4514-4438-857c-a72dc7472f65'; // FMP - MARINA GATE

let pass = 0, fail = 0;
const check = (name: string, cond: boolean, detail = ''): void => {
  if (cond) { pass++; console.log(`  [PASS] ${name}`); }
  else { fail++; console.log(`  [FAIL] ${name}${detail ? ` :: ${detail}` : ''}`); }
};

type Obj = Record<string, unknown>;
const clone = <T,>(v: T): T => JSON.parse(JSON.stringify(v)) as T;

(async () => {
  const url = process.env.DATABASE_URL;
  if (!url) { console.error('FAIL: DATABASE_URL is not set.'); process.exit(1); }
  const c = new Client({ connectionString: url, ssl: { rejectUnauthorized: false } });
  await c.connect();

  let saveId: string | null = null;
  try {
    // ---- the REAL stored snapshot, and the version it belongs to ----
    const v = await c.query(
      `select id, snapshot from public.refm_project_versions
        where project_id = $1 order by created_at desc limit 1`, [PROJECT],
    );
    if (v.rows.length === 0) { console.error('FAIL: no version on the project.'); process.exit(1); }
    const versionId = v.rows[0].id as string;
    const stored = v.rows[0].snapshot as Obj;
    console.log(`=== FMP - MARINA GATE, latest version ${versionId} ===\n`);

    const before = clone(stored);
    const after = clone(stored);

    // ---- DEFECT 1: a scalar leaf on a real element ----
    const assets = (after.assets ?? []) as Obj[];
    const asset = assets.find((a) => typeof a.buaSqm === 'number' && (a.buaSqm as number) > 0);
    if (!asset) { console.error('FAIL: no asset with a buaSqm to nudge.'); process.exit(1); }
    const assetId = asset.id as string;
    const oldBua = asset.buaSqm as number;
    asset.buaSqm = oldBua + 1;

    // ---- DEFECT 2: the SAME values with the keys written in a different
    // order. This is what a client re-serialising an object does, and it is
    // what put 49 "[15 items, unchanged] -> [15 items, unchanged]" rows in the
    // log. It must produce NO row at all.
    //
    // Found by WALKING the real snapshot rather than by naming a section:
    // the first run looked only under fundTerms, found no multi-key object on
    // this project, and D2a then passed having tested nothing. A vacuous pass
    // is the failure mode this whole session has been about.
    const reorderedKeys: string[] = [];
    const flipKeys = (o: Obj): Obj => {
      const flipped: Obj = {};
      for (const k of Object.keys(o).reverse()) flipped[k] = o[k];
      return flipped;
    };
    const walk = (node: unknown, path: string, depth: number): void => {
      if (reorderedKeys.length >= 3 || depth > 4 || !node || typeof node !== 'object') return;
      if (Array.isArray(node)) {
        node.forEach((el, i) => {
          if (el && typeof el === 'object' && !Array.isArray(el) && Object.keys(el as Obj).length > 1) {
            // An ELEMENT's keys re-ordered. Its id is unchanged, so the differ
            // must still pair it with the same element and find nothing.
            const id = (el as Obj).id;
            node[i] = flipKeys(el as Obj);
            reorderedKeys.push(id ? `${path}[id=${String(id)}]` : `${path}[${i}]`);
          }
        });
        return;
      }
      for (const k of Object.keys(node as Obj)) {
        const val = (node as Obj)[k];
        if (val && typeof val === 'object' && !Array.isArray(val) && Object.keys(val as Obj).length > 1) {
          (node as Obj)[k] = flipKeys(val as Obj);
          reorderedKeys.push(`${path}.${k}`);
          if (reorderedKeys.length >= 3) return;
        } else {
          walk(val, `${path}.${k}`, depth + 1);
        }
      }
    };
    // Deliberately NOT the two assets edited above, whose rows must survive.
    for (const section of ['fundTerms', 'financing', 'phases', 'parcels', 'assetTypeValues']) {
      if (reorderedKeys.length >= 3) break;
      if (after[section] !== undefined) walk(after[section], `project.${section}`, 0);
    }
    const reorderedKey: string | null = reorderedKeys[0] ?? null;
    check('objects were found to re-order (the probe can TEST defect 2, not assume it)',
      reorderedKeys.length > 0, 'nothing multi-key found to flip');
    if (reorderedKeys.length > 0) console.log(`  re-ordered the keys of: ${reorderedKeys.join(', ')}`);

    // ---- DEFECT 3: a value CLEARED on a record that still exists. The
    // platform stores a blank as an ABSENT KEY, which is why this looked
    // identical to an element being removed.
    const clearTarget = assets.find((a) => a.id !== assetId && typeof a.buaSqm === 'number');
    let clearedPath: string | null = null;
    if (clearTarget) {
      delete clearTarget.buaSqm;
      clearedPath = `assets[id=${clearTarget.id as string}].buaSqm`;
    }
    check('a second asset was found to clear a value on (the probe can test defect 3)',
      clearedPath !== null);

    // ---- the save route's own chain, verbatim ----
    const delta = diffSnapshots(before as never, after as never);
    const rows = rowsForSave(PROJECT, versionId, null, delta);
    saveId = rows[0]?.saveId ?? null;
    console.log(`the differ produced ${delta.length} entries; save_id ${saveId}\n`);
    const { written } = await appendChanges(rows);
    check('the rows were WRITTEN to the table (a silent no-op proves nothing)',
      written === rows.length && written > 0, `${written} of ${rows.length}`);

    // ================= EVERYTHING BELOW READS THE DATABASE =================
    const stored2 = await c.query(
      `select action, path, label, before, after
         from public.refm_project_changes where save_id = $1 order by path`, [saveId],
    );
    const got = stored2.rows;
    console.log(`\n--- ${got.length} rows read back out of refm_project_changes ---`);
    for (const r of got) {
      console.log(`  ${String(r.action).padEnd(7)} | ${String(r.label ?? '(no label)')}`);
      console.log(`          path: ${String(r.path)}`);
      console.log(`          ${JSON.stringify(r.before)} -> ${JSON.stringify(r.after)}`);
    }
    console.log('');

    console.log('=== DEFECT 1: a scalar update is labelled in words ===');
    {
      const row = got.find((r) => r.path === `assets[id=${assetId}].buaSqm`);
      check('D1a the scalar edit is in the table at all', !!row, `save ${saveId}`);
      check('D1b it carries a LABEL rather than null',
        !!row && typeof row.label === 'string' && (row.label as string).length > 0,
        JSON.stringify(row?.label));
      check('D1c the label is not just the path echoed back',
        !!row && row.label !== row.path, String(row?.label));
      check('D1d it names the FIELD in words, not camelCase',
        !!row && /BUA|Bua/.test(String(row.label)) && !/buaSqm/.test(String(row.label)),
        String(row?.label));
      check('D1e and it names the ELEMENT, so a reader knows which asset moved',
        !!row && String(row.label).includes(':') && !String(row.label).startsWith(':'),
        String(row?.label));
      check('D1f EVERY row of this save carries a label',
        got.length > 0 && got.every((r) => typeof r.label === 'string' && (r.label as string).length > 0),
        got.filter((r) => !r.label).map((r) => String(r.path)).join(', '));
    }

    console.log('\n=== DEFECT 2: a key reorder is not a change ===');
    {
      const noise = got.filter((r) => reorderedKeys.some((k) => String(r.path).startsWith(k)));
      check('D2a the re-ordered objects produced NO row', noise.length === 0,
        noise.map((r) => String(r.path)).join(', '));
      check('D2a2 and the probe really did re-order something', reorderedKey !== null);
      const identical = got.filter((r) => JSON.stringify(r.before) === JSON.stringify(r.after));
      check('D2b no row in this save has a before byte-identical to its after',
        identical.length === 0, identical.map((r) => String(r.path)).join(', '));
    }

    console.log('\n=== DEFECT 3: a cleared value is CLEAR, not REMOVE ===');
    {
      const row = got.find((r) => r.path === clearedPath);
      check('D3a the cleared field is in the table', !!row, String(clearedPath));
      check('D3b its action is "clear"', row?.action === 'clear', String(row?.action));
      check('D3c it is NOT filed as "remove" (the element still exists)',
        row?.action !== 'remove', String(row?.action));
      check('D3d the value it lost is recorded, so the row says what went',
        !!row && row.before !== null && row.after === null,
        `${JSON.stringify(row?.before)} -> ${JSON.stringify(row?.after)}`);
    }
  } finally {
    // ---- UNDO. The writes above were a proof, not data. ----
    if (saveId) {
      const before = await c.query('select count(*)::int n from public.refm_project_changes where project_id = $1', [PROJECT]);
      // Re-proved at deletion time: only rows carrying THIS probe's save_id go.
      const del = await c.query(
        'delete from public.refm_project_changes where save_id = $1 and project_id = $2 returning id',
        [saveId, PROJECT],
      );
      const after = await c.query('select count(*)::int n from public.refm_project_changes where project_id = $1', [PROJECT]);
      const left = await c.query('select count(*)::int n from public.refm_project_changes where save_id = $1', [saveId]);
      console.log(`\n=== UNDO: ${del.rows.length} probe rows removed; project log ${before.rows[0].n} -> ${after.rows[0].n}; rows left on this save_id: ${left.rows[0].n} ===`);
      check('U1 every probe row was removed, so the audit log holds no fiction',
        left.rows[0].n === 0 && (after.rows[0].n as number) === (before.rows[0].n as number) - del.rows.length);
    }
    await c.end();
  }

  console.log(`\n=== Result: ${pass} passed, ${fail} failed ===`);
  if (fail) process.exit(1);
})();
