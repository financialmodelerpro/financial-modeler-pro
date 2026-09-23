/**
 * audit-path-screen-map.ts
 *
 * WRITE-VERIFICATION FOR THE PATH-TO-SCREEN MAP (Module 10 item 11, step 0).
 *
 * The map claims "this field is edited on that screen", and a misfiled badge is
 * a quiet lie: it sends a reader to a tab where the field is not, and nothing
 * on the screen contradicts it. So the map's rules are verified MECHANICALLY,
 * against the only evidence that settles the question: a WRITE. A screen READS
 * far more than it writes, so "the path appears in this file" over-reports
 * about three to one and is not evidence of anything.
 *
 * Three mechanical facts are joined, and nothing here rests on my reading:
 *
 *   A. THE SHAPES THE MAP MUST COVER: every overridable leaf on the live
 *      project, via enumerateOverridableFields, reduced to its shape.
 *   B. WHICH FILES A TAB CAN REACH: the import graph from each tab component,
 *      transitively, inside the REFM component tree. A row editor under
 *      _shared/ belongs to every tab that renders it, which is the honest
 *      answer and is often more than one.
 *   C. WHAT EACH FILE WRITES, AND INTO WHICH ROOT: every store write verb,
 *      with the object-literal keys written. THE ROOT COMES FROM THE VERB
 *      (updatePhase writes phases[], updateFinancingTranche writes
 *      financingTranches[]), because a bare key name collides across roots:
 *      `name` is written by four different screens onto four different things,
 *      and a key-only join reported a tranche rename as a phase edit. That was
 *      this script's first answer, and it was fiction.
 *
 * Verdict per rule:
 *   CONFIRMED  every tab that writes it is the tab the rule names
 *   TWO HOMES  more than one tab writes it, so the map must name them all
 *   WRONG      the writing tab is not the one the rule names
 *   NO WRITE   nothing writes it from a reachable component, so the rule has
 *              no mechanical evidence and must be justified by hand
 *
 * Run: npx tsx scripts/audit-path-screen-map.ts
 *
 * Read-only. No em dashes in this file.
 */
import { readFileSync, readdirSync, statSync, existsSync } from 'node:fs';
import { createClient } from '@supabase/supabase-js';
import { loadStoredModel } from '../src/hubs/modeling/platforms/refm/lib/state/loadStoredModel';
import { modelFromSnapshot } from '../src/hubs/modeling/platforms/refm/lib/state/module1-store';
import { enumerateOverridableFields } from '../src/hubs/modeling/platforms/refm/lib/cases/applyOverrides';
import { LIVE_PROJECT_ID } from './fixtures/liveProject';

const ROOT = process.cwd().replace(/\\/g, '/');
const COMPONENTS = `${ROOT}/src/hubs/modeling/platforms/refm/components`;
const SHELL = `${COMPONENTS}/RealEstatePlatform.tsx`;

for (const f of ['.env.local', '.env']) {
  try {
    for (const l of readFileSync(f, 'utf8').split('\n')) {
      const m = /^([A-Z0-9_]+)\s*=\s*(.*)$/.exec(l.trim());
      if (m && !process.env[m[1]]) process.env[m[1]] = m[2].replace(/^["']|["']$/g, '');
    }
  } catch { /* optional */ }
}

// ══════════ B. tab -> every file it can reach ══════════════════════════════
const shell = readFileSync(SHELL, 'utf8');
/** component name -> tab key, from the shell's own render conditions. */
const tabOfComponent = new Map<string, string>();
for (const m of shell.matchAll(/=== '([a-z0-9-]+)'\s*&&\s*<([A-Za-z0-9_]+)/g)) {
  if (!tabOfComponent.has(m[2])) tabOfComponent.set(m[2], m[1]);
}

const resolveImport = (fromFile: string, spec: string): string | null => {
  let base: string;
  if (spec.startsWith('.')) {
    const dir = fromFile.slice(0, fromFile.lastIndexOf('/'));
    base = `${dir}/${spec}`.replace(/\/\.\//g, '/');
    while (/\/[^/]+\/\.\.\//.test(base)) base = base.replace(/\/[^/]+\/\.\.\//, '/');
  } else if (spec.startsWith('@/src/hubs/modeling/platforms/refm/components')) {
    base = `${ROOT}/${spec.slice(2)}`;
  } else return null;
  for (const ext of ['.tsx', '.ts', '/index.tsx', '/index.ts']) {
    if (existsSync(base + ext)) return base + ext;
  }
  return existsSync(base) && statSync(base).isFile() ? base : null;
};

/** file -> the set of tabs that can reach it. */
const tabsOfFile = new Map<string, Set<string>>();
for (const [comp, tab] of tabOfComponent) {
  const entry = resolveImport(SHELL, `./modules/${comp}`);
  if (!entry) continue;
  const seen = new Set<string>();
  const stack = [entry];
  while (stack.length) {
    const f = stack.pop()!;
    if (seen.has(f)) continue;
    seen.add(f);
    if (!tabsOfFile.has(f)) tabsOfFile.set(f, new Set());
    tabsOfFile.get(f)!.add(tab);
    let src = '';
    try { src = readFileSync(f, 'utf8'); } catch { continue; }
    for (const m of src.matchAll(/from\s+['"]([^'"]+)['"]/g)) {
      // Only inside the component tree: a lib helper is not a screen.
      const r = resolveImport(f, m[1]);
      if (r && r.startsWith(COMPONENTS)) stack.push(r);
    }
  }
}

// ══════════ C. what each file writes, and into which ROOT ══════════════════
/**
 * THE VERB CARRIES THE ROOT. This is the whole correction: `name` means four
 * different fields depending on which verb wrote it, and joining on the bare
 * key made every screen that renames anything look like an editor of every
 * named thing on the platform.
 *
 * `onUpdate` (the generic row callback) carries no root ITSELF, and dropping it
 * made twelve rules read NO WRITE when Module 1 writes almost everything
 * through it: `onUpdate({ constructionPeriods })` is how a phase is edited.
 * Its root IS recoverable, from the JSX that binds it:
 *
 *     <PhaseRow onUpdate={(patch) => updatePhase(phase.id, patch)} />
 *
 * so PhaseRow's own `onUpdate(` calls write into phases[]. That binding is
 * resolved below (ROOT_OF_COMPONENT), including one level of pass-through
 * (`onUpdate={onUpdate}`). A component bound to more than one root keeps BOTH,
 * reported as such, because guessing which is exactly the misfiling this audit
 * exists to prevent.
 */
const VERB_ROOT: Record<string, string> = {
  updateAsset: 'assets[].', onUpdateAsset: 'assets[].', setAssets: 'assets[].',
  updateSubUnit: 'subUnits[].', setSubUnits: 'subUnits[].',
  updatePhase: 'phases[].', setPhases: 'phases[].',
  updateParcel: 'parcels[].', setParcels: 'parcels[].',
  updateCostLine: 'costLines[].', setCostLines: 'costLines[].',
  setCostOverride: 'costOverrides[].',
  updateFinancingTranche: 'financingTranches[].', setFinancingTranches: 'financingTranches[].',
  updateEquityContribution: 'equityContributions[].', setEquityContributions: 'equityContributions[].',
  setProject: 'project.',
  setAssetTypes: 'project.assetTypes[].',
  setAssetTypeValue: 'project.assetTypeValues',
  setCostStandardRows: 'project.costStandardRows[].',
  setLandAllocationMode: 'landAllocationMode',
};

function keysAfter(src: string, at: number): string[] {
  const open = src.indexOf('{', at);
  if (open < 0 || open - at > 120) return [];
  let depth = 0, end = -1;
  for (let i = open; i < src.length && i < open + 4000; i++) {
    if (src[i] === '{') depth++;
    else if (src[i] === '}') { depth--; if (depth === 0) { end = i; break; } }
  }
  if (end < 0) return [];
  const keys: string[] = [];
  let d = 0;
  for (const part of src.slice(open + 1, end).split(/,(?![^(]*\))/)) {
    const seg = part.trim();
    d += (seg.match(/\{/g) ?? []).length - (seg.match(/\}/g) ?? []).length;
    const k = /^([A-Za-z_][A-Za-z0-9_]*)\s*[:}]?/.exec(seg);
    if (k && d <= 0) keys.push(k[1]);
    if (d < 0) d = 0;
  }
  return [...new Set(keys)];
}
const NOISE = new Set(['Math', 'const', 'if', 'return', 'let', 'var', 'await', 'new', 'typeof',
  'void', 'JSON', 'Object', 'Number', 'String', 'Array', 'Boolean', 'TOGETHER', 'true', 'false', 'null']);

const allFiles: string[] = [];
const walkDir = (d: string): void => {
  for (const e of readdirSync(d)) {
    const p = `${d}/${e}`;
    if (statSync(p).isDirectory()) walkDir(p);
    else if (/\.tsx?$/.test(p)) allFiles.push(p);
  }
};
walkDir(COMPONENTS);

// ── the onUpdate binding: which root does a given component write into? ──
/** component name -> roots its `onUpdate` prop writes into. */
const rootsOfComponent = new Map<string, Set<string>>();
/** components whose onUpdate is a pass-through of their OWN onUpdate prop. */
const passThrough: Array<{ parent: string; child: string }> = [];
const reachable = allFiles.filter((f) => (tabsOfFile.get(f)?.size ?? 0) > 0);

/** The [start, end) span of every top-level component declaration in a file. */
function componentSpans(src: string): Array<{ name: string; start: number; end: number }> {
  const out: Array<{ name: string; start: number; end: number }> = [];
  const decl = /(?:^|\n)\s*(?:export\s+)?(?:default\s+)?(?:function\s+([A-Z][A-Za-z0-9_]*)|const\s+([A-Z][A-Za-z0-9_]*)\s*[:=])/g;
  for (const m of src.matchAll(decl)) {
    const name = m[1] ?? m[2];
    // THE BODY BRACE, NOT THE PARAMETER BRACE. `function PhaseRow({ phase }:
    // Props) {` opens a brace inside its own parameter list, and taking that
    // one gave every component a span a few characters long, so no call site
    // was ever inside one and this whole branch silently contributed nothing.
    // The body is the first `{` whose preceding text has BALANCED parens.
    //
    // AND A BRACE BODY, NOT AN EXPRESSION ONE. `const FieldLabel = (p) => (`
    // returns JSX from a parenthesised expression, so the balanced-paren scan
    // ran on past it and gave that four-line helper a span covering the rest
    // of the file, stealing every tranche write in Module1Financing from the
    // card that actually makes them. An expression-bodied component is skipped.
    let open = -1;
    const window = src.slice(m.index!, m.index! + 4000);
    const body = /\)\s*(?::[^={;]*?)?(?:=>\s*)?\{/.exec(window);
    if (body) {
      const at = m.index! + body.index + body[0].length - 1;
      const head = src.slice(m.index!, at);
      if (((head.match(/\(/g) ?? []).length) === ((head.match(/\)/g) ?? []).length)) open = at;
    }
    if (open < 0) continue;
    let depth = 0, end = src.length;
    for (let i = open; i < src.length; i++) {
      if (src[i] === '{') depth++;
      else if (src[i] === '}') { depth--; if (depth === 0) { end = i; break; } }
    }
    out.push({ name, start: m.index!, end });
  }
  return out;
}

const spansOf = new Map<string, Array<{ name: string; start: number; end: number }>>();
/** The component a character offset sits inside: the SMALLEST span holding it. */
const ownerAt = (f: string, at: number): string | null => {
  const s = (spansOf.get(f) ?? []).filter((x) => at >= x.start && at < x.end);
  if (!s.length) return null;
  return s.sort((a, b) => (b.end - b.start) - (a.end - a.start)).pop()!.name;
};

for (const f of reachable) {
  const src = readFileSync(f, 'utf8');
  spansOf.set(f, componentSpans(src));
  // ANY `on...` PROP, not just `onUpdate`. The capex screen hands its rows
  // `onUpdateLine`, so a scan hard-coded to one prop name saw nothing and all
  // 19 costLines[] shapes read NO WRITE while that tab is where they are
  // typed. The prop name is part of the key, so two props on one component
  // stay apart.
  for (const m of src.matchAll(/\b(on[A-Z][A-Za-z0-9_]*)=\{([^}]*(?:\{[^}]*\}[^}]*)*)\}/g)) {
    const prop = m[1];
    const expr = m[2];
    // The JSX element this prop belongs to: the nearest `<Name` before it.
    const open = [...src.slice(0, m.index!).matchAll(/<([A-Z][A-Za-z0-9_]*)/g)].pop();
    if (!open) continue;
    const child = `${open[1]}::${prop}`;
    const verb = Object.keys(VERB_ROOT).find((v) => new RegExp(`\\b${v}\\b`).test(expr));
    if (verb) {
      if (!rootsOfComponent.has(child)) rootsOfComponent.set(child, new Set());
      rootsOfComponent.get(child)!.add(VERB_ROOT[verb]);
    } else if (/\bon[A-Z][A-Za-z0-9_]*\b/.test(expr)) {
      // A RE-WRAP IS ALSO A HOP. The capex screen does not pass its callback
      // down untouched, it adapts the signature:
      //     <CostRow onUpdateLine={(patch) => onUpdateLine(line.id, patch)} />
      // which is neither a store verb nor a bare pass-through, so a scan
      // looking only for those two shapes dropped the chain here and all 19
      // costLines[] shapes read NO WRITE.
      const via = /\b(on[A-Z][A-Za-z0-9_]*)\b/.exec(expr)![1];
      // THE PARENT IS THE ENCLOSING COMPONENT, NOT THE FILE. Module 1's
      // financing screen hands the verb to a list, which hands its own prop
      // down to each card, and keying the hop on the file name left every
      // tranche field unrooted.
      const parent = ownerAt(f, m.index!);
      if (parent) passThrough.push({ parent: `${parent}::${via}`, child });
    }
  }
}
// Iterated to a fixed point, so a list -> card -> row chain still resolves.
for (let i = 0; i < 5; i++) {
  for (const { parent, child } of passThrough) {
    const inherited = rootsOfComponent.get(parent);
    if (!inherited) continue;
    if (!rootsOfComponent.has(child)) rootsOfComponent.set(child, new Set());
    for (const r of inherited) rootsOfComponent.get(child)!.add(r);
  }
}

/** "root::key" -> { tabs, files } */
interface Write { tabs: Set<string>; files: Set<string> }
const writes = new Map<string, Write>();
const record = (root: string, key: string, tabs: Set<string>, file: string): void => {
  if (NOISE.has(key)) return;
  const id = `${root}::${key}`;
  if (!writes.has(id)) writes.set(id, { tabs: new Set(), files: new Set() });
  for (const t of tabs) writes.get(id)!.tabs.add(t);
  writes.get(id)!.files.add(file.slice(COMPONENTS.length + 1));
};

/**
 * LOCAL WRAPPERS ARE VERBS TOO. A screen rarely calls the store directly: it
 * declares `const updateSellInline = (patch) => updateAsset(id, { revenue: ...
 * })` and calls THAT forty times. Scanning only for the store verbs found one
 * write where there are forty, which is how `assets[].revenue.` read NO WRITE
 * while Module 2 is nothing but writes to it.
 *
 * A local function whose body reaches exactly one root becomes a verb with
 * that root, file-scoped. Reaching more than one root leaves it out: a
 * wrapper that writes two roots cannot say which key went where, and guessing
 * is the misfiling this audit exists to catch.
 *
 * The SUB-PATH matters as well as the root: `updateSellInline({ x })` writes
 * `assets[].revenue.sell.x`, not `assets[].x`, so the wrapper carries the
 * container keys its own body names.
 */
const localVerbs = new Map<string, Map<string, string>>(); // file -> fn -> root
for (const f of reachable) {
  const src = readFileSync(f, 'utf8');
  const fns = new Map<string, string>();
  const declRe = /(?:^|\n)\s*(?:export\s+)?(?:const\s+([a-zA-Z][A-Za-z0-9_]*)\s*[:=]|function\s+([a-zA-Z][A-Za-z0-9_]*)\s*\()/g;
  const decls = [...src.matchAll(declRe)]
    .map((m) => ({ name: m[1] ?? m[2], at: m.index!, body: src.slice(m.index!, Math.min(src.length, m.index! + 3000)) }))
    .filter((d) => !VERB_ROOT[d.name]);
  /**
   * RESOLVED TO A FIXED POINT, because the wrappers are stacked: Module 2's
   * `updateSellInline` calls `writeForm('sell', next)`, which calls
   * `updateAsset`. A single pass saw only the inner one, so all 28
   * assets[].revenue.* shapes read NO WRITE on the one tab that writes them.
   *
   * A STRING-LITERAL FIRST ARGUMENT IS A CONTAINER: `writeForm('sell', ...)`
   * writes assets[].revenue.sell, and without that the whole of Module 2's
   * three strategy forms would collapse onto one path.
   */
  for (let pass = 0; pass < 4; pass++) {
    for (const d of decls) {
      if (fns.has(d.name)) continue;
      const roots = new Set<string>();
      for (const [verb, root] of Object.entries(VERB_ROOT)) {
        if (new RegExp(`\\b${verb}\\s*\\(`).test(d.body)) roots.add(root);
      }
      // A string-literal first argument (`writeForm('sell', ...)`) NAMES the
      // sub-object, and treating it as a container segment was tried and
      // REVERTED: it resolved nothing new and made a wrapper on the fund tab
      // claim project.dividendPolicy, which the financing tab owns. A scanner
      // that invents one home to find another is worse than one that says it
      // cannot see, so the shapes it cannot reach are listed as unresolved and
      // settled by direct inspection instead.
      for (const [fn, root] of fns) {
        if (new RegExp(`\\b${fn}\\s*\\(`).test(d.body)) roots.add(root);
      }
      if (roots.size !== 1) continue;
      const root = [...roots][0];
      // The container key the wrapper itself names, when it nests inline.
      const inner = /\{\s*([a-zA-Z][A-Za-z0-9_]*)\s*:\s*\{[\s\S]{0,80}?\.\.\./.exec(d.body);
      fns.set(d.name, root + (inner ? `${inner[1]}.` : ''));
    }
  }
  if (fns.size) localVerbs.set(f, fns);
}

let rootedOnUpdate = 0;
const unrootedOnUpdate: string[] = [];
for (const f of reachable) {
  const tabs = tabsOfFile.get(f)!;
  const src = readFileSync(f, 'utf8');
  // a. the verbs, which state their own root
  for (const [verb, root] of Object.entries(VERB_ROOT)) {
    for (const m of src.matchAll(new RegExp(`\\b${verb}\\s*(?:\\?\\.)?\\s*\\(`, 'g'))) {
      for (const k of keysAfter(src, m.index! + m[0].length)) record(root, k, tabs, f);
    }
  }
  // a2. the file's own wrappers around those verbs
  for (const [fn, root] of localVerbs.get(f) ?? []) {
    for (const m of src.matchAll(new RegExp(`\\b${fn}\\s*(?:\\?\\.)?\\s*\\(`, 'g'))) {
      for (const k of keysAfter(src, m.index! + m[0].length)) record(root, k, tabs, f);
    }
  }
  // b. the generic row callback, rooted by the component it was bound to
  for (const m of src.matchAll(/\b(on[A-Z][A-Za-z0-9_]*)\s*(?:\?\.)?\s*\(/g)) {
    const at = m.index!;
    const owner = ownerAt(f, at);
    const roots = owner ? rootsOfComponent.get(`${owner}::${m[1]}`) : undefined;
    const keys = keysAfter(src, at + m[0].length).filter((k) => !NOISE.has(k));
    if (!roots) { if (keys.length) unrootedOnUpdate.push(`${f.slice(COMPONENTS.length + 1)}:${owner ?? "?"} -> ${keys.join(', ')}`); continue; }
    rootedOnUpdate += keys.length;
    for (const k of keys) for (const root of roots) record(root, k, tabs, f);
  }
}

// ══════════ the 26 rules ═══════════════════════════════════════════════════
const RULES: Array<{ prefix: string; screen: string }> = [
  { prefix: 'assets[].revenue.', screen: 'm2-inputs' },
  { prefix: 'assets[].opex.', screen: 'm3-inputs' },
  { prefix: 'assets[].capexPhasing.', screen: 'costs' },
  { prefix: 'assets[].', screen: 'assets' },
  { prefix: 'project.assetTypeValues', screen: 'asset-standards' },
  { prefix: 'project.assetTypes[]', screen: 'asset-standards' },
  { prefix: 'project.costStandardRows[]', screen: 'asset-standards' },
  { prefix: 'project.parkingAreaPerSlotSqm', screen: 'asset-standards' },
  { prefix: 'project.retailAreaPerSlotSqm', screen: 'asset-standards' },
  { prefix: 'project.fundTerms', screen: 'fund-terms' },
  { prefix: 'project.financing', screen: 'financing' },
  { prefix: 'project.dividendPolicy', screen: 'financing' },
  { prefix: 'project.returns', screen: 'm5-returns' },
  { prefix: 'project.covenants', screen: 'm5-metrics' },
  { prefix: 'project.escrow', screen: 'm2-escrow' },
  { prefix: 'project.hqOpex', screen: 'm3-inputs' },
  { prefix: 'project.subUnits', screen: 'assets' },
  { prefix: 'project.tax', screen: 'project-phases' },
  { prefix: 'project.costEscalationPct', screen: 'costs' },
  { prefix: 'phases[].', screen: 'project-phases' },
  { prefix: 'parcels[].', screen: 'assets' },
  { prefix: 'subUnits[].', screen: 'assets' },
  { prefix: 'costLines[].', screen: 'costs' },
  { prefix: 'costOverrides[].', screen: 'costs' },
  { prefix: 'financingTranches[].', screen: 'financing' },
  { prefix: 'landAllocationMode', screen: 'assets' },
];

const ALL_ROOTS = new Set<string>([...Object.values(VERB_ROOT), ...[...writes.keys()].map((k) => k.split("::")[0])]);

(async () => {
  const sb = createClient(process.env.SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!, { auth: { persistSession: false } });
  const { data } = await sb.from('refm_project_versions').select('snapshot')
    .eq('project_id', LIVE_PROJECT_ID).order('created_at', { ascending: false }).limit(1);
  const snap = loadStoredModel((data as unknown as { snapshot: unknown }[])[0].snapshot).snapshot;
  const fields = enumerateOverridableFields(modelFromSnapshot(snap) as never);
  const shapeOf = (p: string): string => p.replace(/\[[^\]]*\]/g, '[]');
  const shapes = [...new Set(fields.map((f) => shapeOf(f.path)))].sort();

  /**
   * The tabs that write a shape, WITHIN ITS OWN ROOT. A nested field is
   * written as its container key (`updateAsset(id, { revenue: {...} })`), so
   * the walk goes from the deepest segment outwards and stops at the first
   * segment anything actually writes.
   */
  const evidenceFor = (shape: string): { tabs: string[]; via: string; files: string[] } | null => {
    // The root is the longest VERB_ROOT prefix this shape starts with.
    let root: string | null = null;
    // EVERY root that anything actually wrote, not just the store verbs': a
    // wrapper contributes `assets[].revenue.sell.`, and looking up only the
    // verb roots left every one of those writes recorded and unreadable.
    for (const r of ALL_ROOTS) {
      if (shape === r || shape.startsWith(r)) { if (!root || r.length > root.length) root = r; }
    }
    if (!root) return null;
    const rest = shape === root ? '' : shape.slice(root.length);
    const segs = rest.replace(/\[\]/g, '').split('.').filter(Boolean);
    // `landAllocationMode` and friends are the root itself.
    if (segs.length === 0) {
      const w = writes.get(`${root}::${root.replace(/[.[\]]/g, '')}`) ?? writes.get(`${root}::`);
      return w ? { tabs: [...w.tabs].sort(), via: root, files: [...w.files] } : null;
    }
    // THE FIRST SEGMENT ONLY. A patch names a TOP-LEVEL field of its own root
    // (`setProject({ dividendPolicy: {...} })`), so `project.dividendPolicy.
    // enabled` is evidenced by a write of `dividendPolicy` and by nothing
    // else. Walking inward to the deepest segment matched a bare `enabled`
    // written elsewhere under the same root and reported the fund tab as the
    // editor of the dividend policy: the same root collision as `name`, one
    // level down. Anything deeper is reached through a wrapper root, which
    // already carries its own prefix.
    const w = writes.get(`${root}::${segs[0]}`);
    return w ? { tabs: [...w.tabs].sort(), via: segs[0], files: [...w.files] } : null;
  };

  console.log(`shapes on the live project : ${shapes.length}`);
  console.log(`files reachable from a tab : ${tabsOfFile.size}`);
  console.log(`root-keyed write families  : ${writes.size}`);
  console.log(`onUpdate keys rooted       : ${rootedOnUpdate}   unrooted: ${unrootedOnUpdate.length}`);
  for (const u of unrootedOnUpdate) console.log(`    UNROOTED  ${u}`);
  console.log('');
  console.log('=== THE 26 RULES, VERIFIED AGAINST WHAT ACTUALLY WRITES THEM ===\n');

  let confirmed = 0, twoHomes = 0, wrong = 0, noWrite = 0;
  const decisions: string[] = [];

  for (const r of RULES) {
    const covered = shapes.filter((s) => s === r.prefix.replace(/\.$/, '') || s.startsWith(r.prefix));
    const tabSet = new Map<string, string[]>();
    let unresolved = 0;
    for (const s of covered) {
      const e = evidenceFor(s);
      if (!e) { unresolved++; continue; }
      for (const tab of e.tabs) {
        if (!tabSet.has(tab)) tabSet.set(tab, []);
        const v = tabSet.get(tab)!;
        if (v.length < 4 && !v.includes(e.via)) v.push(e.via);
      }
    }
    const tabs = [...tabSet.keys()].sort();
    let verdict: string;
    if (tabs.length === 0) { verdict = 'NO WRITE '; noWrite++; }
    else if (tabs.length === 1 && tabs[0] === r.screen) { verdict = 'CONFIRMED'; confirmed++; }
    else if (tabs.length === 1) { verdict = 'WRONG    '; wrong++; }
    else if (tabs.includes(r.screen)) { verdict = 'TWO HOMES'; twoHomes++; }
    else { verdict = 'WRONG    '; wrong++; }

    console.log(`[${verdict}] ${r.prefix.padEnd(32)} rule says: ${r.screen}`);
    console.log(`            ${covered.length} shapes${unresolved ? `, ${unresolved} with no write found` : ''}`);
    for (const t of tabs) console.log(`            writes: ${t.padEnd(16)} via ${tabSet.get(t)!.join(', ')}`);
    if (!tabs.length) console.log('            writes: nothing reachable from a tab');
    if (verdict.trim() !== 'CONFIRMED') decisions.push(`${r.prefix.padEnd(32)} rule ${r.screen.padEnd(15)} actual: ${tabs.join(' + ') || 'none'}`);
    console.log('');
  }

  console.log('=== SUMMARY ===');
  console.log(`  CONFIRMED : ${confirmed} of ${RULES.length}`);
  console.log(`  TWO HOMES : ${twoHomes}`);
  console.log(`  WRONG     : ${wrong}`);
  console.log(`  NO WRITE  : ${noWrite}`);
  console.log('\n=== NEEDS A DECISION ===');
  for (const d of decisions) console.log(`  ${d}`);

  const orphan = shapes.filter((s) => !RULES.some((r) => s === r.prefix.replace(/\.$/, '') || s.startsWith(r.prefix)));
  console.log(`\n=== ${orphan.length} SHAPES NO RULE CLAIMS ===`);
  for (const s of orphan) {
    const e = evidenceFor(s);
    console.log(`  ${s.padEnd(44)} ${e ? `${e.tabs.join(' + ')} (via ${e.via})` : 'no write found'}`);
  }
})();
