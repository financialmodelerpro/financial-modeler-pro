/**
 * changeLabel.ts (2026-09-24)
 *
 * THE ONE RULE FOR WHAT A CHANGE IS CALLED, BUILT FROM ITS PATH.
 *
 * A change log entry carries a snapshot path (`assets[id=x].buaSqm`) and, since
 * mig 245, a stored human sentence. Every row written before that label fix
 * has no sentence, and the log is append only, so those rows can never be
 * given one. They can be READ with one, because everything the sentence needs
 * is either in the path or in the project.
 *
 * So the sentence is a function of (path, kind, before, after, naming context),
 * and BOTH ends call it:
 *
 *   - the differ (`snapshot-diff.ts`) labels every entry it emits through
 *     `labelForChange`, with a context built from the two snapshots it holds;
 *   - the Activity panel labels a row that has NO stored label through the same
 *     function, with a context built from the loaded model plus the records the
 *     log itself carries (a removed asset's row holds the asset).
 *
 * The stored label still wins where there is one: it names things as they were
 * called at the time. A render-time label names them as they are called NOW,
 * which is the only name available for a row nobody labelled.
 *
 * WHERE THE CONTEXT CANNOT NAME SOMETHING (an element deleted before this log
 * recorded its removal), the sentence says so in words ("Asset no longer in the
 * project") rather than printing its id. The path stays on hover.
 *
 * Pure: no store, no React, no I/O. No em dashes in this file.
 */
import { assetLabel } from '@/src/core/calculations/assetName';

type Rec = Record<string, unknown>;

export type ChangeKind = 'add' | 'remove' | 'update' | 'clear';

/** What the labeller needs to NAME the records a path points at. Every list is
 *  optional; a missing one only means those records fall back to a noun. */
export interface NamingContext {
  phases?: readonly Rec[];
  parcels?: readonly Rec[];
  assets?: readonly Rec[];
  subUnits?: readonly Rec[];
  costLines?: readonly Rec[];
  financingTranches?: readonly Rec[];
  equityContributions?: readonly Rec[];
  assetTypes?: readonly Rec[];
  costStandardRows?: readonly Rec[];
  cases?: readonly Rec[];
}

type ListKey = keyof NamingContext;

/** A snapshot-like object: the store, a stored snapshot, anything with the
 *  same top-level lists. */
export interface NamingSource {
  phases?: unknown; parcels?: unknown; assets?: unknown; subUnits?: unknown;
  costLines?: unknown; financingTranches?: unknown; equityContributions?: unknown;
  cases?: unknown;
  project?: unknown;
}

const asList = (v: unknown): Rec[] => (Array.isArray(v) ? (v as Rec[]).filter((r) => r && typeof r === 'object') : []);

/**
 * Merge several sources into one context, by id, the FIRST source winning.
 * The differ passes (after, before), so an element present on both sides is
 * named as it now reads; the panel passes (model, records from the log).
 */
export function namingContext(...sources: ReadonlyArray<NamingSource | NamingContext | null | undefined>): NamingContext {
  const lists: Record<ListKey, Map<string, Rec>> = {
    phases: new Map(), parcels: new Map(), assets: new Map(), subUnits: new Map(),
    costLines: new Map(), financingTranches: new Map(), equityContributions: new Map(),
    assetTypes: new Map(), costStandardRows: new Map(), cases: new Map(),
  };
  const add = (key: ListKey, recs: unknown): void => {
    for (const r of asList(recs)) {
      const id = r.id;
      if (typeof id === 'string' && !lists[key].has(id)) lists[key].set(id, r);
    }
  };
  for (const s of sources) {
    if (!s) continue;
    const src = s as NamingSource & NamingContext;
    for (const k of ['phases', 'parcels', 'assets', 'subUnits', 'costLines', 'financingTranches', 'equityContributions', 'cases'] as const) {
      add(k, src[k]);
    }
    const project = (src.project ?? null) as Rec | null;
    add('assetTypes', src.assetTypes ?? project?.assetTypes);
    add('costStandardRows', src.costStandardRows ?? project?.costStandardRows);
  }
  const out: NamingContext = {};
  for (const k of Object.keys(lists) as ListKey[]) out[k] = [...lists[k].values()];
  return out;
}

/**
 * The records a LOG carries about itself: an element-level add holds the
 * element in `after`, a removal holds it in `before`. Fed to `namingContext`
 * AFTER the live model, this names a plot or an asset that has since been
 * deleted, by the log's own account of it.
 */
export function recordsFromChanges(
  changes: ReadonlyArray<{ path: string | null; before: unknown; after: unknown }>,
): NamingContext {
  const acc: Record<string, Rec[]> = {};
  for (const c of changes) {
    const m = /^(?:project\.)?([A-Za-z]+)\[id=([^\]]*)\]$/.exec(c.path ?? '');
    if (!m) continue;
    const key = m[1] as ListKey;
    if (!(key in ELEMENT_NOUN)) continue;
    for (const side of [c.before, c.after]) {
      if (side && typeof side === 'object' && !Array.isArray(side) && (side as Rec).id === m[2]) {
        (acc[key] ??= []).push(side as Rec);
      }
    }
  }
  return acc as NamingContext;
}

/* ─────────────────────────── field names in words ─────────────────────────── */

/**
 * A FIELD NAME IN WORDS (2026-09-23, moved here from snapshot-diff 2026-09-24).
 * A dictionary only where the mechanical answer is wrong or ugly (initialisms
 * and units), and a humaniser for everything else, so a field added tomorrow
 * reads sensibly without anyone maintaining a list.
 */
const FIELD_WORDS: Record<string, string> = {
  buaSqm: 'BUA (sqm)', gfaSqm: 'GFA (sqm)', nsaSqm: 'NSA (sqm)',
  sellableBuaSqm: 'Sellable BUA (sqm)', landAreaSqm: 'Land area (sqm)',
  ltvPct: 'LTV %', dsoDays: 'DSO (days)', arDays: 'AR (days)', dso: 'DSO',
  idcCapitalize: 'Capitalise IDC', assetTypeId: 'Asset type',
  startingADR: 'Starting ADR', startingAdr: 'Starting ADR', adrIndexation: 'ADR indexation',
  farRatio: 'FAR', hqOpex: 'HQ opex', fb: 'F&B', projectNdaEnabled: 'Project NDA enabled',
  totalGfaSqm: 'Total GFA (sqm)', mainAssetGfaSqm: 'Main asset GFA (sqm)',
  retailGfaSqm: 'Retail GFA (sqm)', lobbyGfaSqm: 'Lobby GFA (sqm)',
  nsaSharePct: 'NSA share %',
};

export function humaniseField(seg: string): string {
  const known = FIELD_WORDS[seg];
  if (known) return known;
  // SENTENCE case, not title case: "Fund terms: Hurdle rate %".
  const words = seg.replace(/([a-z0-9])([A-Z])/g, '$1 $2').replace(/[-_]+/g, ' ').split(/\s+/).filter(Boolean);
  return words
    .map((w, i, all) => {
      if (/^sqm$/i.test(w)) return i > 0 && /^per$/i.test(all[i - 1]) ? 'sqm' : '(sqm)';
      if (/^pct$/i.test(w)) return '%';
      const lower = w.toLowerCase();
      return i === 0 ? lower.charAt(0).toUpperCase() + lower.slice(1) : lower;
    })
    .join(' ')
    .replace(/\s+%/, ' %');
}

/** A path segment used as a QUALIFIER inside a sentence ("revenue lease"),
 *  so lower case throughout. */
const qualifier = (seg: string): string => FIELD_WORDS[seg] ?? humaniseField(seg).toLowerCase();

/* ─────────────────────────── naming one element ─────────────────────────── */

/** What each kind of element is called when nothing names it. */
const ELEMENT_NOUN: Record<ListKey | 'parcelFunding', string> = {
  phases: 'Phase', parcels: 'Plot', assets: 'Asset', subUnits: 'Sub-unit',
  costLines: 'Cost line', financingTranches: 'Debt tranche',
  equityContributions: 'Equity contribution', assetTypes: 'Asset type',
  costStandardRows: 'Cost standard', cases: 'Case', parcelFunding: 'Plot funding',
};

const typedName = (rec: Rec | undefined): string => {
  for (const k of ['name', 'label', 'partyName']) {
    const v = rec?.[k];
    if (typeof v === 'string' && v.trim()) return v.trim().replace(/\s+/g, ' ');
  }
  return '';
};

const find = (ctx: NamingContext, key: ListKey, id: string): Rec | undefined =>
  ctx[key]?.find((r) => r.id === id);

const gone = (key: ListKey | 'parcelFunding'): string => `${ELEMENT_NOUN[key]} no longer in the project`;

function nameAsset(rec: Rec | undefined, ctx: NamingContext): string | undefined {
  if (!rec) return undefined;
  try {
    const l = assetLabel(rec as Parameters<typeof assetLabel>[0], {
      parcels: (ctx.parcels ?? []) as unknown as { id: string; name?: string }[],
      phases: (ctx.phases ?? []) as unknown as { id: string; name?: string }[],
    });
    return l.trim() || undefined;
  } catch { return undefined; }
}

/**
 * A cost line the context no longer holds, named from its ID. A standard line's
 * id is `<catalog base>__<phaseId>` (composeLineId), so the base reads as words;
 * a custom line's base is a timestamp, which names nothing, and says so.
 */
function nameGoneCostLine(id: string, ctx: NamingContext, withPhase: boolean): string {
  const sep = id.lastIndexOf('__');
  const base = sep < 0 ? id : id.slice(0, sep);
  const phaseId = sep < 0 ? '' : id.slice(sep + 2);
  const phase = withPhase && phaseId && (ctx.phases?.length ?? 0) > 1 ? typedName(find(ctx, 'phases', phaseId)) : '';
  const what = /^custom-/.test(base) ? 'Custom cost line' : humaniseField(base);
  return `${phase ? `${what}, ${phase}` : what} (no longer in the project)`;
}

/** One element of a top-level or per-element list, by its id. `own` is the
 *  record the entry itself carries, used when the context has no copy. */
function nameElement(key: ListKey | 'parcelFunding', id: string, ctx: NamingContext, own?: Rec, withPhase = true): string {
  if (key === 'parcelFunding') {
    const plot = typedName(find(ctx, 'parcels', id));
    return plot ? `Plot funding, ${plot}` : gone('parcelFunding');
  }
  const rec = find(ctx, key, id) ?? (own && own.id === id ? own : undefined);
  if (!rec) return key === 'costLines' ? nameGoneCostLine(id, ctx, withPhase) : gone(key);
  if (key === 'assets') return nameAsset(rec, ctx) ?? gone(key);
  const name = typedName(rec);
  if (key === 'subUnits') {
    // A sub-unit is named on its asset: "2 BR" is ambiguous across a project.
    const parent = typeof rec.assetId === 'string' ? nameAsset(find(ctx, 'assets', rec.assetId), ctx) : undefined;
    const own2 = name || ELEMENT_NOUN.subUnits;
    return parent ? `${parent}, ${own2}` : own2;
  }
  if (key === 'costLines') {
    // Cost lines repeat by name in every phase, so the phase separates them.
    const phaseId = typeof rec.phaseId === 'string' ? rec.phaseId : undefined;
    const phase = withPhase && phaseId && (ctx.phases?.length ?? 0) > 1 ? typedName(find(ctx, 'phases', phaseId)) : '';
    const base = name || ELEMENT_NOUN.costLines;
    return phase ? `${base}, ${phase}` : base;
  }
  if (key === 'assetTypes') return `Asset type ${name || id}`;
  // A cost standard row is labelled by its type or catalog entry, which would
  // otherwise read exactly like an asset type or a cost line.
  if (key === 'costStandardRows') return `Cost standard ${name || id}`;
  return name || gone(key);
}

/** A cost override is keyed by `assetId::lineId` and has no name of its own. */
function nameCostOverride(key: string, ctx: NamingContext): string {
  const [assetId = '', lineId = ''] = key.split('::');
  const asset = nameAsset(find(ctx, 'assets', assetId), ctx) ?? gone('assets').toLowerCase();
  // The asset already names the phase, so the line does not repeat it.
  const line = nameElement('costLines', lineId, ctx, undefined, false);
  return `${line} override for ${asset}`;
}

function caseName(id: string, ctx: NamingContext, carried?: unknown): string {
  if (typeof carried === 'string' && carried.trim()) return carried.trim();
  const n = typedName(find(ctx, 'cases', id));
  if (n) return n;
  return humaniseField(id.replace(/^case_/, '')) || 'Case';
}

/* ─────────────────────────────── the path ─────────────────────────────── */

interface Seg { name: string; sel?: string }

/** `a.b[id=x].c` -> [{a}, {b, sel 'id=x'}, {c}]. Selectors may hold anything
 *  but `]`, so ids with dots or dashes survive. */
export function parsePath(path: string): Seg[] | null {
  const out: Seg[] = [];
  let i = 0;
  while (i < path.length) {
    let name = '';
    while (i < path.length && path[i] !== '.' && path[i] !== '[') name += path[i++];
    let sel: string | undefined;
    if (path[i] === '[') {
      const end = path.indexOf(']', i);
      if (end < 0) return null;
      sel = path.slice(i + 1, end);
      i = end + 1;
    }
    if (!name && sel === undefined) return null;
    out.push(sel === undefined ? { name } : { name, sel });
    if (i < path.length) {
      if (path[i] !== '.') return null;
      i++;
    }
  }
  return out;
}

const selId = (sel: string): string => { const eq = sel.indexOf('='); return eq < 0 ? sel : sel.slice(eq + 1); };

const TOP_LISTS = new Set<string>(['phases', 'parcels', 'assets', 'subUnits', 'costLines', 'financingTranches', 'equityContributions']);
const NESTED_LISTS = new Set<string>(['assetTypes', 'costStandardRows', 'parcelFunding']);

export interface LabelInput {
  path: string | null;
  kind: string;
  before?: unknown;
  after?: unknown;
}

/**
 * The sentence for one change. Never throws and never returns the raw path
 * for a path it can parse; an unparseable path is returned as it came, which
 * is the pre-label behaviour and the most honest thing left to show.
 */
export function labelForChange(entry: LabelInput, ctx: NamingContext): string {
  const path = entry.path ?? '';
  const kind = entry.kind;
  if (path === '<root>') return kind === 'remove' ? 'Empty snapshot' : 'Initial version';
  if (path === 'landAllocationMode') return 'Land allocation mode';

  // Scenario cases: the case itself, its name, or one override inside it,
  // whose own path is labelled by this same function.
  const cm = /^cases\[([^\]]*)\](?:\.(.*))?$/.exec(path);
  if (cm) {
    const id = cm[1];
    const rest = cm[2];
    if (rest === undefined) {
      const carried = kind === 'remove' ? entry.before : entry.after;
      return kind === 'remove' ? `Case "${caseName(id, ctx, carried)}" removed` : `Case "${caseName(id, ctx, carried)}" added`;
    }
    if (rest === 'name') return `Case renamed to "${caseName(id, ctx, entry.after)}"`;
    return `${caseName(id, ctx)}: ${labelForChange({ path: rest, kind, before: entry.before, after: entry.after }, ctx)}`;
  }

  const segs = parsePath(path);
  if (!segs || segs.length === 0) return path;

  // The record the entry carries whole (an element add or remove).
  const own = (kind === 'remove' ? entry.before : entry.after) as Rec | undefined;
  const ownRec = own && typeof own === 'object' && !Array.isArray(own) ? own : undefined;

  // Walk the path, remembering the DEEPEST element it passes through and the
  // plain segments after it.
  let element: string | undefined;
  let after: Seg[] = [];
  let endsAtElement = false;
  for (let i = 0; i < segs.length; i++) {
    const s = segs[i];
    const last = i === segs.length - 1;
    let named: string | undefined;
    if (s.sel !== undefined && i === 0 && TOP_LISTS.has(s.name)) {
      named = nameElement(s.name as ListKey, selId(s.sel), ctx, last ? ownRec : undefined);
    } else if (s.sel !== undefined && i === 0 && s.name === 'costOverrides') {
      named = nameCostOverride(s.sel, ctx);
    } else if (s.sel !== undefined && NESTED_LISTS.has(s.name)) {
      named = nameElement(s.name as ListKey | 'parcelFunding', selId(s.sel), ctx, last ? ownRec : undefined);
    } else if (i > 0 && segs[i - 1].name === 'assetTypeValues' && segs[i - 1].sel === undefined) {
      // `project.assetTypeValues.<typeId>`: an object keyed by a type id.
      named = nameElement('assetTypes', s.name, ctx);
    }
    if (named !== undefined) {
      element = named;
      after = [];
      endsAtElement = last;
      continue;
    }
    after.push(s);
  }

  if (endsAtElement && element !== undefined) {
    if (kind === 'add') return `Added ${element}`;
    if (kind === 'remove') return `Removed ${element}`;
    return element;
  }

  const leaf = after[after.length - 1] ?? segs[segs.length - 1];
  const field = humaniseField(leaf.name);
  const middle = after.slice(0, -1);
  if (element !== undefined) {
    const sub = middle.map((s) => qualifier(s.name)).join(' ');
    return sub ? `${element}, ${sub}: ${field}` : `${element}: ${field}`;
  }
  // No element: a project section. Named by the segment above the field, as
  // the differ always did ("Fund terms: Hurdle rate %", "Project: Partners").
  const section = segs.length > 1 ? humaniseField(segs[segs.length - 2].name) : 'Project';
  return `${section}: ${field}`;
}

/**
 * THE STORED CLASSIFICATION THAT IS KNOWN TO BE WRONG, corrected at render.
 *
 * Before 2026-09-22 the differ wrote 'remove' whenever a key went absent, so a
 * value CLEARED on a record that still exists read as something REMOVED. The
 * differ's own rule since then: only an ELEMENT goes away (the path ends at a
 * `[...]` selector, or is a whole case); everything else that goes absent is a
 * value cleared. Applying that same rule to a stored row can only change a row
 * the old differ got wrong, since the new one already writes it this way.
 */
export function effectiveKind(action: string, path: string | null): string {
  if (action !== 'remove' || !path) return action;
  if (path === '<root>') return action;
  if (/^cases\[[^\]]*\]\./.test(path)) return 'clear';
  if (path.endsWith(']')) return action;
  // `project.assetTypeValues.<typeId>` is a whole type's values object, which
  // the differ reached through diffObject, so it too is a clear.
  return 'clear';
}

/* ─────────────────────── reading STORED rows (the panel) ─────────────────────── */

/** The fields of a stored log row this file reads. */
export interface StoredChangeLike {
  action: string;
  path: string | null;
  label: string | null;
  before: unknown;
  after: unknown;
}

/**
 * A ROW THAT RECORDS NO CHANGE. Before 2026-09-23 the differ compared objects
 * by insertion-ordered JSON, so the same values with keys in a different order
 * were logged as an update; Postgres then stored both sides key-sorted, and the
 * row reads "[15 items, unchanged] -> [15 items, unchanged]". The log is append
 * only, so the row cannot be unwritten; it can be recognised, by the same
 * order-blind comparison the differ now uses (passed in, so there is one).
 */
export function recordsNoChange(c: StoredChangeLike, same: (a: unknown, b: unknown) => boolean): boolean {
  return c.action === 'update' && same(c.before, c.after);
}

/**
 * What the Activity panel SHOWS for the stored rows: every row that records a
 * change, each carrying a sentence (the stored one where there is one, else
 * the one `labelForChange` builds from its path) and the classification the
 * differ's own rule gives it. Rows that record no change are counted, not
 * shown. Returns copies; the stored rows are never touched.
 */
export function presentChanges<T extends StoredChangeLike>(
  changes: readonly T[],
  ctx: NamingContext,
  same: (a: unknown, b: unknown) => boolean,
): { rows: T[]; noChange: number } {
  const rows: T[] = [];
  let noChange = 0;
  for (const c of changes) {
    if (recordsNoChange(c, same)) { noChange++; continue; }
    const action = effectiveKind(c.action, c.path);
    const label = c.label ?? (c.path ? labelForChange({ path: c.path, kind: action, before: c.before, after: c.after }, ctx) : null);
    rows.push(action === c.action && label === c.label ? c : { ...c, action, label });
  }
  return { rows, noChange };
}
