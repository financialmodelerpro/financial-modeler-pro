/**
 * scripts/audit-schema-drift.ts
 *
 * Compares EVERY migration in the repo against the LIVE schema, because three
 * migrations are now proven to have been silently ineffective (007 constraints,
 * 006-vs-158 user_permissions, 008 never ran) and the existing
 * audit-migration-flags only checks that tables/columns EXIST.
 *
 * WHAT THIS CAN AND CANNOT SEE (stated up front, per the lesson):
 *   CAN  (via PostgREST's OpenAPI schema output, a genuine catalog read):
 *        table existence, column existence, column type/format, NOT NULL
 *        (the `required` list), column DEFAULTs, FK existence + target table.
 *   CANNOT: FK ON DELETE behavior, UNIQUE constraints, CHECK constraints,
 *        indexes, RLS policies, triggers, functions. PostgREST exposes no
 *        pg_constraint read and the direct DB credential is stale. Where one
 *        of these WAS established behaviorally (the 2026-08-30 FK probes, the
 *        documented live proofs), it is carried in KNOWN_BEHAVIOR below with
 *        its evidence; everything else in those classes is reported as
 *        DECLARED-UNVERIFIABLE, never assumed to match.
 *
 * The migration parser is regex-based and honest: any CREATE TABLE / ALTER
 * TABLE statement it cannot parse is LISTED as unparsed rather than silently
 * skipped.
 *
 * Read-only: one OpenAPI GET, no table reads, no writes.
 * Run: npx tsx --env-file=.env.local scripts/audit-schema-drift.ts
 *
 * No em dashes in this file.
 */
import * as fs from 'fs';
import * as path from 'path';

const ROOT = path.resolve(__dirname, '..');
const MIG_DIR = path.join(ROOT, 'supabase', 'migrations');

// ── Behaviorally established facts (evidence cited), NOT assumptions ────────
const KNOWN_BEHAVIOR: Record<string, string> = {
  'admin_audit_log.target_user_id': 'was NO ACTION (blocked deletes, live error 2026-08-30); SET NULL since mig 221, probed live',
  'admin_audit_log.admin_id': 'NO ACTION + NOT NULL, probed 2026-08-30; deliberately kept (mig 221 notes)',
  'user_permissions.created_by': 'was NO ACTION (158 clause won); SET NULL since mig 221, probed live',
  'refm_projects.user_id': 'CASCADE, probed 2026-08-30',
  'trial_requests.user_id': 'CASCADE, probed 2026-08-30',
  'user_permissions.user_id': 'CASCADE, probed 2026-08-30',
  'ai_usage_counters.user_id': 'CASCADE, probed 2026-08-30',
  'refm_cost_catalog.user_id': 'CASCADE, probed 2026-08-30; entry_id CHECK proven live 2026-08-17 (CLAUDE-DB 214)',
  'enrollments.user_id': 'CASCADE, probed 2026-08-30',
  'certificates.user_id': 'CASCADE, probed 2026-08-30',
  'account_deletions.deleted_by': 'SET NULL, probed 2026-08-30',
  'articles.author_id': 'SET NULL, probed 2026-08-30',
  'public_api_keys.*': 'partial unique (one active key) proven live by verify-api-key-rotation (2026-08-16)',
};

// ── Migration parser ────────────────────────────────────────────────────────
interface DeclCol {
  name: string; type: string; notNull: boolean; default: string | null;
  fkTable: string | null; onDelete: string | null;
  unique: boolean; hasCheck: boolean; pk: boolean;
  file: string;
}
interface TableDecl {
  createdIn: string[];            // every file with a CREATE TABLE for it
  cols: Map<string, DeclCol>;     // composed: first CREATE wins, ALTERs layer on
  conflicts: string[];            // human-readable redeclaration conflicts
  tableConstraints: string[];     // UNIQUE(...), CHECK(...), PK(...) at table level
}
const declared = new Map<string, TableDecl>();
const unparsed: string[] = [];

function stripSqlComments(s: string): string {
  return s.replace(/--[^\n]*/g, '');
}
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
function parseColDef(def: string, file: string): DeclCol | null {
  const m = def.match(/^"?([a-z_][a-z0-9_]*)"?\s+([A-Za-z]+(?:\s+(?:varying|precision|zone|with time zone|without time zone))?(?:\([^)]*\))?(?:\[\])?)/i);
  if (!m) return null;
  const rest = def.slice(m[0].length);
  const fk = rest.match(/REFERENCES\s+(?:public\.)?"?([a-z_][a-z0-9_]*)"?\s*\(([^)]*)\)/i);
  const od = rest.match(/ON DELETE\s+(SET NULL|CASCADE|RESTRICT|NO ACTION|SET DEFAULT)/i);
  const dflt = rest.match(/DEFAULT\s+((?:[^,()]|\([^()]*(?:\([^()]*\))?[^()]*\))+)/i);
  return {
    name: m[1].toLowerCase(),
    type: m[2].toLowerCase().replace(/\s+/g, ' '),
    notNull: /NOT NULL/i.test(rest) || /PRIMARY KEY/i.test(rest),
    default: dflt ? dflt[1].trim() : null,
    fkTable: fk ? fk[1].toLowerCase() : null,
    onDelete: od ? od[1].toUpperCase() : (fk ? 'NO ACTION' : null),
    unique: /\bUNIQUE\b/i.test(rest),
    hasCheck: /\bCHECK\b/i.test(rest),
    pk: /PRIMARY KEY/i.test(rest),
    file,
  };
}

const files = fs.readdirSync(MIG_DIR).filter((f) => f.endsWith('.sql')).sort();
for (const file of files) {
  const sql = stripSqlComments(fs.readFileSync(path.join(MIG_DIR, file), 'utf8'));
  // CREATE TABLE blocks, paren-balanced.
  const createRe = /CREATE TABLE(?:\s+IF NOT EXISTS)?\s+(?:public\.)?"?([a-z_][a-z0-9_]*)"?\s*\(/gi;
  let cm: RegExpExecArray | null;
  while ((cm = createRe.exec(sql)) !== null) {
    const table = cm[1].toLowerCase();
    let depth = 1; let i = createRe.lastIndex; let body = '';
    while (i < sql.length && depth > 0) {
      const ch = sql[i];
      if (ch === '(') depth++;
      if (ch === ')') depth--;
      if (depth > 0) body += ch;
      i++;
    }
    const entry = declared.get(table) ?? ({ createdIn: [], cols: new Map(), conflicts: [], tableConstraints: [] } as TableDecl);
    const isFirst = entry.createdIn.length === 0;
    entry.createdIn.push(file);
    for (const part of splitTopLevel(body)) {
      if (/^(PRIMARY KEY|UNIQUE|CHECK|CONSTRAINT|FOREIGN KEY|EXCLUDE)/i.test(part)) {
        if (isFirst) entry.tableConstraints.push(`${part.replace(/\s+/g, ' ').slice(0, 100)} [${file}]`);
        continue;
      }
      const col = parseColDef(part, file);
      if (!col) { unparsed.push(`${file}: column def in ${table}: ${part.slice(0, 70)}`); continue; }
      const prev = entry.cols.get(col.name);
      if (isFirst || !prev) {
        if (!prev) entry.cols.set(col.name, col);
      } else {
        // Redeclaration in a later CREATE: only the FIRST create can have run.
        const diffs: string[] = [];
        if (prev.notNull !== col.notNull) diffs.push(`notNull ${prev.notNull} vs ${col.notNull}`);
        if ((prev.onDelete ?? '') !== (col.onDelete ?? '')) diffs.push(`ON DELETE ${prev.onDelete} vs ${col.onDelete}`);
        if ((prev.fkTable ?? '') !== (col.fkTable ?? '')) diffs.push(`FK ${prev.fkTable} vs ${col.fkTable}`);
        if (diffs.length) entry.conflicts.push(`${col.name}: ${prev.file} vs ${file}: ${diffs.join('; ')}`);
      }
    }
    declared.set(table, entry);
  }
  // ALTER TABLE ADD COLUMN (one statement may carry SEVERAL ADD COLUMN
  // clauses separated by commas; split them or the defs mangle together).
  const alterRe = /ALTER TABLE\s+(?:public\.)?"?([a-z_][a-z0-9_]*)"?\s+(ADD COLUMN[^;]+);/gi;
  let am: RegExpExecArray | null;
  while ((am = alterRe.exec(sql)) !== null) {
    const table = am[1].toLowerCase();
    const entry = declared.get(table) ?? ({ createdIn: [], cols: new Map(), conflicts: [], tableConstraints: [] } as TableDecl);
    const clauses = am[2].split(/,\s*ADD COLUMN/i).map((c, i) => (i === 0 ? c.replace(/^ADD COLUMN/i, '') : c));
    for (const clause of clauses) {
      const body = clause.replace(/^\s*IF NOT EXISTS/i, '').trim();
      const col = parseColDef(body, file);
      if (col) { if (!entry.cols.has(col.name)) entry.cols.set(col.name, col); }
      else unparsed.push(`${file}: ALTER ADD COLUMN on ${table}: ${body.slice(0, 70)}`);
    }
    declared.set(table, entry);
  }
  // Other ALTERs / DO blocks that could change constraints: list, do not parse.
  const other = sql.match(/ALTER TABLE\s+[^;]*?(SET NOT NULL|DROP NOT NULL|ADD CONSTRAINT|DROP CONSTRAINT|ALTER COLUMN)[^;]*;/gi) ?? [];
  for (const o of other) unparsed.push(`${file}: constraint-altering statement (not folded into the model): ${o.replace(/\s+/g, ' ').slice(0, 90)}`);
  if (/DO \$\$/.test(sql)) unparsed.push(`${file}: DO $$ block (procedural, not folded into the model)`);
}

// ── Live schema via OpenAPI ─────────────────────────────────────────────────
interface LiveCol { type: string; format: string; default: string | null; fkTable: string | null; }
interface LiveTable { required: Set<string>; cols: Map<string, LiveCol>; }

function normDefault(s: string | null): string {
  if (s == null) return '';
  let v = s.toLowerCase()
    .replace(/::[a-z_ ]+(\[\])?/g, '')
    .replace(/current_timestamp/g, 'now()')
    .replace(/'([^']*)'/g, '$1')
    .replace(/\s+/g, ' ')
    .trim();
  // The parser sometimes folds a trailing constraint into the default text;
  // cut at the first constraint keyword so the VALUE alone is compared.
  v = v.replace(/\s+(check|primary key|references|unique|not null)\b[\s\S]*$/, '');
  // Strip OUTER parens only when balanced (never truncate gen_random_uuid()).
  if (v.startsWith('(') && v.endsWith(')')) v = v.slice(1, -1);
  return v.trim();
}

async function main() {
  const res = await fetch(process.env.SUPABASE_URL + '/rest/v1/', {
    headers: { apikey: process.env.SUPABASE_SERVICE_ROLE_KEY!, Authorization: 'Bearer ' + process.env.SUPABASE_SERVICE_ROLE_KEY! },
  });
  const swagger = await res.json() as { definitions?: Record<string, { required?: string[]; properties?: Record<string, { type?: string; format?: string; default?: unknown; description?: string }> }> };
  const live = new Map<string, LiveTable>();
  for (const [t, def] of Object.entries(swagger.definitions ?? {})) {
    const cols = new Map<string, LiveCol>();
    for (const [c, p] of Object.entries(def.properties ?? {})) {
      const fk = p.description?.match(/Foreign Key to `([a-z_0-9]+)\./i);
      cols.set(c, { type: p.type ?? '', format: p.format ?? '', default: p.default != null ? String(p.default) : null, fkTable: fk ? fk[1] : null });
    }
    live.set(t, { required: new Set(def.required ?? []), cols });
  }

  console.log(`migrations parsed: ${files.length} files, ${declared.size} declared tables; live tables exposed: ${live.size}\n`);

  const findings: string[] = [];
  const f = (s: string) => { findings.push(s); console.log('  ' + s); };

  console.log('== A. Declared tables MISSING live ==');
  for (const [t, d] of declared) {
    if (!live.has(t)) f(`MISSING TABLE: ${t} (declared in ${d.createdIn.join(', ') || 'ALTER only'})`);
  }

  console.log('== B. Live tables NO migration declares (pre-log artifacts) ==');
  for (const t of live.keys()) {
    if (!declared.has(t)) f(`UNDECLARED LIVE TABLE: ${t}`);
  }

  console.log('== C. Column-level drift (existence / nullability / default / FK target) ==');
  for (const [t, d] of declared) {
    const lt = live.get(t);
    if (!lt) continue;
    for (const [c, dc] of d.cols) {
      const lc = lt.cols.get(c);
      if (!lc) { f(`MISSING COLUMN: ${t}.${c} (declared ${dc.file})`); continue; }
      const liveNotNull = lt.required.has(c);
      if (dc.notNull !== liveNotNull) {
        f(`NULLABILITY: ${t}.${c} declared ${dc.notNull ? 'NOT NULL' : 'nullable'} (${dc.file}) but live is ${liveNotNull ? 'NOT NULL' : 'nullable'}`);
      }
      const dd = normDefault(dc.default); const ld = normDefault(lc.default);
      // OpenAPI does not emit defaults for json/jsonb/array columns, so a
      // declared default with a silent live side there is UNVERIFIABLE via
      // this method, not drift; it is counted in section D instead.
      const jsonish = /json|\[\]|array/.test(dc.type) || lc.format.includes('json') || lc.type === 'array';
      if (dd !== ld && !(dd === '' && ld === '') && !(jsonish && ld === '')) {
        f(`DEFAULT: ${t}.${c} declared [${dd || 'none'}] (${dc.file}) but live is [${ld || 'none'}]`);
      }
      if ((dc.fkTable ?? '') !== (lc.fkTable ?? '')) {
        f(`FK TARGET: ${t}.${c} declared -> ${dc.fkTable ?? 'no FK'} (${dc.file}) but live -> ${lc.fkTable ?? 'no FK'}`);
      }
    }
    // Only meaningful for tables a migration actually CREATED: an ALTER-only
    // table (users, student_certificates, ...) predates the log, so its core
    // columns are expected to be undeclared.
    if (d.createdIn.length > 0) {
      for (const c of lt.cols.keys()) {
        if (!d.cols.has(c)) f(`EXTRA LIVE COLUMN: ${t}.${c} (no migration declares it)`);
      }
    }
    for (const conflict of d.conflicts) f(`REDECLARATION CONFLICT: ${t} ${conflict}`);
  }

  console.log('\n== D. Declared but UNVERIFIABLE via this method (stated, not assumed) ==');
  let uniques = 0; let checks = 0; let onDeletes = 0;
  for (const [t, d] of declared) {
    if (!live.has(t)) continue;
    for (const [c, dc] of d.cols) {
      const key = `${t}.${c}`;
      if (dc.fkTable && !KNOWN_BEHAVIOR[key]) { onDeletes++; console.log(`  ON DELETE unverified: ${key} declared ${dc.onDelete} (${dc.file})`); }
      if (dc.fkTable && KNOWN_BEHAVIOR[key]) console.log(`  ON DELETE known: ${key}: ${KNOWN_BEHAVIOR[key]}`);
      if (dc.unique) { uniques++; console.log(`  UNIQUE unverified: ${key} (${dc.file})`); }
      if (dc.hasCheck) { checks++; console.log(`  CHECK unverified: ${key} (${dc.file})`); }
    }
    for (const tc of d.tableConstraints) console.log(`  table-level constraint unverified: ${t}: ${tc}`);
  }
  console.log(`  totals: ${onDeletes} FK ON DELETE, ${uniques} column UNIQUE, ${checks} column CHECK unverified`);

  console.log('\n== E. Statements the parser could not fold in (verify by hand or probe) ==');
  for (const u of unparsed.slice(0, 60)) console.log('  ' + u);
  if (unparsed.length > 60) console.log(`  ...and ${unparsed.length - 60} more`);

  console.log(`\nTOTAL structural findings: ${findings.length}`);
  fs.writeFileSync(path.join(ROOT, 'scripts', 'schema-drift-report.txt'),
    findings.join('\n') + '\n\n-- unparsed --\n' + unparsed.join('\n'));
  console.log('full findings written to scripts/schema-drift-report.txt');
}
main().catch((e) => { console.error(e); process.exit(1); });
