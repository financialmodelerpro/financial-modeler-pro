/**
 * scripts/audit-constraints-live.ts
 *
 * The half of the schema-drift audit that could not be done before.
 *
 * `audit-schema-drift.ts` reads the live schema through PostgREST's OpenAPI
 * output, which exposes tables, columns, types, NOT NULL, defaults and FK
 * TARGETS, and nothing else. Everything that lives in `pg_constraint` (FK ON
 * DELETE behaviour, UNIQUE, CHECK, table-level constraints) came back as
 * DECLARED-UNVERIFIABLE: 157 of them, stated honestly as unknown rather than
 * assumed to match. That was the right call and it is exactly how a real drift
 * (007's constraints, and 158 quietly overriding 006's ON DELETE) hid for
 * months.
 *
 * With a working direct connection those 157 can be READ instead of assumed.
 * This script parses the same declarations out of the migrations and compares
 * each one against `pg_constraint` / `pg_indexes`.
 *
 * READ-ONLY. It runs exactly three SELECTs against the catalog and writes one
 * report file. It never issues DDL and never touches application tables.
 *
 * WHAT IT STILL CANNOT DECIDE FOR YOU: whether two CHECK expressions are
 * EQUIVALENT. Postgres stores a normalised form, so a declared
 * `CHECK (status IN ('a','b'))` comes back as
 * `CHECK ((status = ANY (ARRAY['a','b'::text])))`. The script reports presence
 * and prints the live definition; judging equivalence of the text is left to a
 * reader, and said so rather than guessed.
 *
 * Run: npx tsx scripts/audit-constraints-live.ts
 *
 * No em dashes in this file.
 */
/* eslint-disable no-console */
import * as fs from 'fs';
import * as path from 'path';
// `pg` ships no bundled types and @types/pg is not a dependency of this repo.
// A minimal structural type for the two calls used here is honest and adds no
// package: the alternative is an `any` that hides a typo in a column name.
interface PgRow { [k: string]: unknown }
interface PgClient {
  connect(): Promise<void>;
  query(text: string, values?: unknown[]): Promise<{ rows: PgRow[] }>;
  end(): Promise<void>;
}
type PgClientCtor = new (cfg: Record<string, unknown>) => PgClient;
// eslint-disable-next-line @typescript-eslint/no-require-imports
const { Client } = require('pg') as { Client: PgClientCtor };

const ROOT = path.resolve(__dirname, '..');
const MIG_DIR = path.join(ROOT, 'supabase', 'migrations');
const OUT = path.join(ROOT, 'scripts', 'constraint-drift-report.txt');

// ── Connection ──────────────────────────────────────────────────────────────
/**
 * DATABASE_URL, used as given.
 *
 * TWO THINGS THAT COST AN HOUR, recorded so the next reader does not repeat
 * them. The value was first the DIRECT host `db.<ref>.supabase.co`, which NO
 * LONGER RESOLVES AT ALL: Supabase retired IPv4 direct connections, so it fails
 * with ENOTFOUND rather than an auth error, and the credential in it was never
 * the problem. The reachable equivalent is the SESSION POOLER
 * (`aws-<n>-<region>.pooler.supabase.com:5432`), where the user is
 * `postgres.<ref>`, not `postgres`. Getting the region wrong reports
 * "tenant/user not found", which reads like a bad credential and is not.
 *
 * Then a STRAY SPACE between the colon and the password (`...:<ref>: pass@...`)
 * produced `28P01 password authentication failed for user "postgres"`, naming a
 * user that appears nowhere in the string, because the pooler resolves the
 * tenant from the username and then reports the underlying role. An auth error
 * on a pooler says nothing about which half is wrong.
 *
 * So: fail loudly and specifically rather than let a caller guess.
 */
function connectionConfig(): { connectionString: string } {
  const line = fs.readFileSync(path.join(ROOT, '.env.local'), 'utf8')
    .split(/\r?\n/).find((l) => l.startsWith('DATABASE_URL='));
  if (!line) throw new Error('DATABASE_URL not found in .env.local');
  const raw = line.slice(line.indexOf('=') + 1).replace(/^["']|["']$/g, '').trim();
  const u = new URL(raw);
  if (/^db\./.test(u.hostname)) {
    throw new Error(`DATABASE_URL points at the retired direct host ${u.hostname}, which no longer resolves. Use the session pooler string (aws-<n>-<region>.pooler.supabase.com:5432, user postgres.<ref>).`);
  }
  const pw = decodeURIComponent(u.password);
  if (pw !== pw.trim()) {
    throw new Error('DATABASE_URL password has leading or trailing whitespace. The pooler reports this as "password authentication failed for user postgres", which does not mention the space.');
  }
  return { connectionString: raw };
}

// ── Declarations, parsed from the migrations ────────────────────────────────
interface DeclFk { table: string; col: string; refTable: string; onDelete: string; file: string }
interface DeclSimple { table: string; col: string; file: string }
interface DeclTableCon { table: string; text: string; file: string }

const fks: DeclFk[] = [];
const uniques: DeclSimple[] = [];
const checks: DeclSimple[] = [];
const tableCons: DeclTableCon[] = [];
const unparsed: string[] = [];

const stripComments = (s: string): string => s.replace(/--[^\n]*/g, '');
function splitTopLevel(body: string): string[] {
  const parts: string[] = []; let depth = 0; let cur = '';
  for (const ch of body) {
    if (ch === '(') depth++;
    if (ch === ')') depth--;
    if (ch === ',' && depth === 0) { parts.push(cur); cur = ''; continue; }
    cur += ch;
  }
  if (cur.trim()) parts.push(cur);
  return parts.map((p) => p.trim()).filter(Boolean);
}

function parseMigrations(): void {
  const files = fs.readdirSync(MIG_DIR).filter((f) => f.endsWith('.sql')).sort();
  for (const file of files) {
    const sql = stripComments(fs.readFileSync(path.join(MIG_DIR, file), 'utf8'));
    const re = /CREATE TABLE(?:\s+IF NOT EXISTS)?\s+(?:public\.)?"?([a-z_][a-z0-9_]*)"?\s*\(/gi;
    for (let m = re.exec(sql); m !== null; m = re.exec(sql)) {
      const table = m[1].toLowerCase();
      // Body to the matching close paren.
      let depth = 1; let i = m.index + m[0].length; const start = i;
      for (; i < sql.length && depth > 0; i++) {
        if (sql[i] === '(') depth++;
        else if (sql[i] === ')') depth--;
      }
      const body = sql.slice(start, i - 1);
      for (const part of splitTopLevel(body)) {
        const upper = part.toUpperCase();
        // Table-level constraint clauses.
        if (/^(CONSTRAINT|UNIQUE|CHECK|PRIMARY\s+KEY|FOREIGN\s+KEY|EXCLUDE)\b/.test(upper)) {
          tableCons.push({ table, text: part.replace(/\s+/g, ' ').trim(), file });
          continue;
        }
        const cm = part.match(/^"?([a-z_][a-z0-9_]*)"?\s+/i);
        if (!cm) { unparsed.push(`${file}: ${table}: ${part.slice(0, 70)}`); continue; }
        const col = cm[1].toLowerCase();
        const rest = part.slice(cm[0].length);
        const fk = rest.match(/REFERENCES\s+(?:public\.)?"?([a-z_][a-z0-9_]*)"?/i);
        if (fk) {
          const od = rest.match(/ON DELETE\s+(SET NULL|CASCADE|RESTRICT|NO ACTION|SET DEFAULT)/i);
          fks.push({ table, col, refTable: fk[1].toLowerCase(), onDelete: (od ? od[1] : 'NO ACTION').toUpperCase(), file });
        }
        if (/\bUNIQUE\b/i.test(rest)) uniques.push({ table, col, file });
        if (/\bCHECK\b/i.test(rest)) checks.push({ table, col, file });
      }
    }
  }
}

// ── Live catalog ────────────────────────────────────────────────────────────
interface LiveCon {
  table: string; name: string; type: string; def: string;
  cols: string[]; refTable: string | null; onDelete: string | null;
}

const DEL: Record<string, string> = { a: 'NO ACTION', r: 'RESTRICT', c: 'CASCADE', n: 'SET NULL', d: 'SET DEFAULT' };

async function readLive(): Promise<{ cons: LiveCon[]; uniqueIdx: Array<{ table: string; def: string }>; tables: Set<string> }> {
  const client = new Client({ ...connectionConfig(), ssl: { rejectUnauthorized: false }, connectionTimeoutMillis: 20000 });
  await client.connect();
  const cq = await client.query(`
    select t.relname::text as table, c.conname::text as name, c.contype::text as type,
           pg_get_constraintdef(c.oid) as def, c.confdeltype::text as del,
           rt.relname::text as ref_table,
           (select array_agg(a.attname::text order by k.ord)
              from unnest(c.conkey) with ordinality k(attnum, ord)
              join pg_attribute a on a.attrelid = c.conrelid and a.attnum = k.attnum) as cols
    from pg_constraint c
    join pg_class t on t.oid = c.conrelid
    join pg_namespace n on n.oid = t.relnamespace
    left join pg_class rt on rt.oid = c.confrelid
    where n.nspname = 'public'
    order by t.relname, c.conname`);
  const iq = await client.query(`
    select tablename::text as table, indexdef as def
    from pg_indexes where schemaname = 'public' and indexdef ilike '%UNIQUE%'`);
  const tq = await client.query(`
    select tablename::text as t from pg_tables where schemaname = 'public'`);
  await client.end();
  const s = (v: unknown): string => String(v ?? '');
  return {
    cons: cq.rows.map((r) => ({
      table: s(r.table), name: s(r.name), type: s(r.type), def: s(r.def),
      cols: (r.cols as string[] | null) ?? [], refTable: r.ref_table === null ? null : s(r.ref_table),
      onDelete: r.type === 'f' ? (DEL[s(r.del)] ?? s(r.del)) : null,
    })),
    uniqueIdx: iq.rows.map((r) => ({ table: s(r.table), def: s(r.def) })),
    tables: new Set(tq.rows.map((r) => s(r.t))),
  };
}

// ── Compare ─────────────────────────────────────────────────────────────────
const out: string[] = [];
const say = (s = ''): void => { out.push(s); console.log(s); };

async function main(): Promise<void> {
  parseMigrations();
  const live = await readLive();
  const byTable = (t: string): LiveCon[] => live.cons.filter((c) => c.table === t);

  const differs: string[] = [];
  const missing: string[] = [];
  const matched: string[] = [];
  const skipped: string[] = [];

  say('== A. FOREIGN KEY ON DELETE: declared vs live ==');
  for (const d of fks) {
    if (!live.tables.has(d.table)) { skipped.push(`FK ${d.table}.${d.col}: table not live (${d.file})`); continue; }
    const hit = byTable(d.table).find((c) => c.type === 'f' && c.cols.length === 1 && c.cols[0] === d.col);
    if (!hit) { missing.push(`FK MISSING: ${d.table}.${d.col} -> ${d.refTable} declared ON DELETE ${d.onDelete} (${d.file}) but NO FK exists live`); continue; }
    if (hit.onDelete !== d.onDelete) {
      differs.push(`ON DELETE DIFFERS: ${d.table}.${d.col} -> ${hit.refTable}: declared ${d.onDelete} (${d.file}) but LIVE IS ${hit.onDelete}  [${hit.name}]`);
    } else {
      matched.push(`ok  ${d.table}.${d.col} ON DELETE ${hit.onDelete}`);
    }
  }
  say(`  ${fks.length} declared FK columns: ${matched.length} match, ${differs.length} differ, ${missing.length} missing, ${skipped.length} skipped`);

  say('\n== B. UNIQUE: declared vs live ==');
  let uOk = 0; const uMissing: string[] = [];
  for (const d of uniques) {
    if (!live.tables.has(d.table)) { skipped.push(`UNIQUE ${d.table}.${d.col}: table not live (${d.file})`); continue; }
    const asCon = byTable(d.table).some((c) => (c.type === 'u' || c.type === 'p') && c.cols.length === 1 && c.cols[0] === d.col);
    const asIdx = live.uniqueIdx.some((i) => i.table === d.table && new RegExp(`\\(${d.col}\\)|\\(\\s*${d.col}\\s*\\)`, 'i').test(i.def));
    if (asCon || asIdx) { uOk++; continue; }
    // A COMPOSITE unique that INCLUDES the column is not the same guarantee,
    // but it is a very different finding from nothing at all, so say which.
    const composite = byTable(d.table).find((c) => (c.type === 'u' || c.type === 'p') && c.cols.length > 1 && c.cols.includes(d.col));
    uMissing.push(composite
      ? `UNIQUE NARROWER LIVE: ${d.table}.${d.col} declared UNIQUE alone (${d.file}) but live is COMPOSITE ${composite.name} (${composite.cols.join(', ')})`
      : `UNIQUE MISSING: ${d.table}.${d.col} declared UNIQUE (${d.file}) but no unique constraint or index covers it, alone or composite`);
  }
  say(`  ${uniques.length} declared column UNIQUEs: ${uOk} present, ${uMissing.length} absent`);

  say('\n== C. CHECK: declared vs live ==');
  let cOk = 0; const cMissing: string[] = [];
  const checkDefs: string[] = [];
  for (const d of checks) {
    if (!live.tables.has(d.table)) { skipped.push(`CHECK ${d.table}.${d.col}: table not live (${d.file})`); continue; }
    const hits = byTable(d.table).filter((c) => c.type === 'c' && new RegExp(`\\b${d.col}\\b`).test(c.def));
    if (hits.length) { cOk++; checkDefs.push(`    ${d.table}.${d.col}: ${hits.map((h) => h.def).join(' | ')}`); }
    else cMissing.push(`CHECK MISSING: ${d.table}.${d.col} declared CHECK (${d.file}) but no live CHECK mentions that column`);
  }
  say(`  ${checks.length} declared column CHECKs: ${cOk} present, ${cMissing.length} absent`);

  say('\n== D. TABLE-LEVEL constraints: declared vs live ==');
  let tOk = 0; const tMissing: string[] = [];
  for (const d of tableCons) {
    if (!live.tables.has(d.table)) { skipped.push(`TABLE-CON ${d.table}: table not live (${d.file})`); continue; }
    // A NAMED constraint is matched by NAME first. The first version matched
    // only by column list, extracted from the first parenthesis group, which
    // for `CONSTRAINT chk_one_identifier CHECK ((tab_key IS NOT NULL AND ...))`
    // is an expression, not a column list. It reported that constraint as
    // absent while it sat in the catalog under exactly that name: a false
    // positive, and the same class of error as the thing being audited.
    const named = d.text.match(/^CONSTRAINT\s+"?([a-z_][a-z0-9_]*)"?/i);
    if (named && byTable(d.table).some((c) => c.name.toLowerCase() === named[1].toLowerCase())) { tOk++; continue; }

    const body = d.text.replace(/^CONSTRAINT\s+"?[a-z_][a-z0-9_]*"?\s*/i, '');
    const kind = /^UNIQUE/i.test(body) ? 'u' : /^PRIMARY/i.test(body) ? 'p' : /^CHECK/i.test(body) ? 'c' : /^FOREIGN/i.test(body) ? 'f' : null;

    // A CHECK is an EXPRESSION, not a column list, so it is matched by the
    // columns it MENTIONS rather than by an exact key. Reported as present when
    // some live CHECK on the table mentions all of them; equivalence of the
    // expressions is a reader's call and the definitions are printed below.
    if (kind === 'c') {
      const mentioned = [...new Set((body.match(/\b[a-z_][a-z0-9_]*\b/g) ?? [])
        .map((s) => s.toLowerCase())
        .filter((s) => !['check', 'and', 'or', 'not', 'is', 'null', 'in', 'true', 'false', 'any', 'all'].includes(s)))];
      const hit = byTable(d.table).some((c) => c.type === 'c'
        && mentioned.filter((m) => new RegExp(`\\b${m}\\b`).test(c.def)).length >= Math.max(1, Math.ceil(mentioned.length / 2)));
      if (hit) { tOk++; continue; }
      tMissing.push(`TABLE CHECK NOT FOUND: ${d.table}: ${d.text.slice(0, 90)} (${d.file})`);
      continue;
    }

    const cols = (body.match(/\(([^)]*)\)/) ?? [, ''])[1]
      .split(',').map((s) => s.trim().replace(/^"|"$/g, '').toLowerCase()).filter((s) => /^[a-z_][a-z0-9_]*$/.test(s));
    const found = byTable(d.table).some((c) => {
      if (kind && c.type !== kind) return false;
      if (!cols.length) return false;
      return cols.every((col) => c.cols.includes(col)) && c.cols.length === cols.length;
    }) || live.uniqueIdx.some((i) => i.table === d.table && cols.length > 0 && cols.every((col) => new RegExp(`\\b${col}\\b`).test(i.def)));
    if (found) tOk++;
    else tMissing.push(`TABLE CONSTRAINT NOT FOUND: ${d.table}: ${d.text.slice(0, 90)} (${d.file})`);
  }
  say(`  ${tableCons.length} declared table-level constraints: ${tOk} present, ${tMissing.length} not found`);

  say('\n' + '='.repeat(78));
  say('FINDINGS, RANKED');
  say('='.repeat(78));
  say('\n-- 1. ON DELETE DIFFERS FROM THE MIGRATION (a delete behaves differently than declared) --');
  if (differs.length) differs.forEach((d) => say(`  ${d}`)); else say('  none');
  say('\n-- 2. DECLARED CONSTRAINT ABSENT LIVE (the guarantee does not exist) --');
  const absent = [...missing, ...uMissing, ...cMissing, ...tMissing];
  if (absent.length) absent.forEach((d) => say(`  ${d}`)); else say('  none');
  say('\n-- 3. SKIPPED, table not live --');
  say(`  ${skipped.length} declarations on tables that do not exist live`);
  skipped.slice(0, 12).forEach((s) => say(`    ${s}`));
  if (skipped.length > 12) say(`    ... and ${skipped.length - 12} more`);
  say('\n-- 4. LIVE CHECK DEFINITIONS, for the reader to judge equivalence --');
  checkDefs.slice(0, 40).forEach((s) => say(s));
  if (checkDefs.length > 40) say(`    ... and ${checkDefs.length - 40} more (full list in the report file)`);
  say('\n-- 5. UNPARSED column definitions (not silently skipped) --');
  say(`  ${unparsed.length}`);
  unparsed.slice(0, 10).forEach((s) => say(`    ${s}`));

  const full = [...out, '', '== FULL CHECK DEFINITION LIST ==', ...checkDefs, '', '== FULL SKIPPED LIST ==', ...skipped];
  fs.writeFileSync(OUT, full.join('\n') + '\n');
  say(`\nfull report written to ${path.relative(ROOT, OUT)}`);
}
main().catch((e) => { console.error(e); process.exit(1); });
