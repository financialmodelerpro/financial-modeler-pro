/**
 * probe-change-log-readability.ts (2026-09-24)
 *
 * HOW MUCH OF A PROJECT'S STORED ACTIVITY LOG READS AS WORDS.
 *
 * READ ONLY: it selects rows and a snapshot, and writes nothing.
 *
 * Runs the Activity panel's OWN presentation (`presentChanges`, the function
 * the panel calls) over every stored row of the project, with the latest
 * stored snapshot standing in for the model the panel reads from the store,
 * plus the records the log itself carries. Reports:
 *
 *   - rows that record no change (counted, not listed on screen);
 *   - rows shown, and how many read as a sentence with no raw path token;
 *   - how many name something "no longer in the project";
 *   - stored removes the panel shows as clears.
 *
 * A bulk row (path null) renders "N fields changed in one save" and counts as
 * a sentence.
 *
 * Run: npx tsx --env-file=.env.local scripts/probe-change-log-readability.ts [projectId]
 *
 * No em dashes in this file.
 */
import { namingContext, recordsFromChanges, presentChanges } from '../src/hubs/modeling/platforms/refm/lib/persistence/changeLabel';
import { sameValue } from '../src/hubs/modeling/platforms/refm/lib/persistence/snapshot-diff';

interface PgRow { [k: string]: unknown }
interface PgClient {
  connect(): Promise<void>;
  query(text: string, values?: unknown[]): Promise<{ rows: PgRow[] }>;
  end(): Promise<void>;
}
type PgClientCtor = new (cfg: Record<string, unknown>) => PgClient;
// eslint-disable-next-line @typescript-eslint/no-require-imports
const { Client } = require('pg') as { Client: PgClientCtor };

const PROJECT = process.argv[2] ?? 'c417fc6a-4514-4438-857c-a72dc7472f65'; // FMP - MARINA GATE

const RAW = /\[|=|::|\b(asset|subunit|parcel|phase|case|retail)_[\w-]+|custom-\d|[a-z][A-Z]/;

(async () => {
  const url = process.env.DATABASE_URL;
  if (!url) { console.error('FAIL: DATABASE_URL is not set.'); process.exit(1); }
  const c = new Client({ connectionString: url, ssl: { rejectUnauthorized: false } });
  await c.connect();
  try {
    const log = await c.query(
      `select id, action, path, label, before, after, created_at
         from public.refm_project_changes where project_id = $1 order by created_at desc`, [PROJECT]);
    const ver = await c.query(
      `select snapshot from public.refm_project_versions where project_id = $1 order by created_at desc limit 1`, [PROJECT]);
    type Row = { action: string; path: string | null; label: string | null; before: unknown; after: unknown };
    const rows = log.rows as unknown as Row[];
    const ctx = namingContext(ver.rows[0]?.snapshot as Record<string, unknown> | undefined, recordsFromChanges(rows));
    const { rows: shown, noChange } = presentChanges(rows, ctx, sameValue);

    const sentence = (r: Row): boolean => r.path === null ? r.action === 'bulk-change' : !!r.label && !RAW.test(r.label);
    const readable = shown.filter(sentence).length;
    const storedLabel = rows.filter((r) => !!r.label).length;
    const gone = shown.filter((r) => /no longer in the project/.test(r.label ?? '')).length;
    const cleared = shown.filter((r) => r.action === 'clear').length;
    const storedClear = rows.filter((r) => r.action === 'clear').length;
    const pct = (n: number, d: number): string => d === 0 ? 'n/a' : `${((100 * n) / d).toFixed(1)}%`;

    console.log(`project ${PROJECT}`);
    console.log(`  stored rows                 ${rows.length}  (with a stored label: ${storedLabel})`);
    console.log(`  record no change (hidden)   ${noChange}`);
    console.log(`  shown                       ${shown.length}`);
    console.log(`  shown as a sentence         ${readable}  (${pct(readable, shown.length)} of shown)`);
    console.log(`  names something deleted     ${gone}`);
    console.log(`  stored remove, shown clear  ${cleared - storedClear}`);
    for (const r of shown.filter((x) => !sentence(x)).slice(0, 20)) console.log(`  NOT A SENTENCE: ${r.path} => ${r.label}`);
    process.exit(readable === shown.length ? 0 : 1);
  } finally {
    await c.end();
  }
})();
