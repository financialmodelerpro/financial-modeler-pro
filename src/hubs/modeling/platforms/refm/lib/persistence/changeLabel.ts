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
 * THE FIELD IN THE USER'S WORDS (2026-09-24, founder: "use the label the
 * screen shows"). Keyed by WHERE the field sits (the element kind, then the
 * path below the element), because one stored name means different things in
 * different places: a plot's `rate` is its land rate, a cost standard's `rate`
 * is its rate. Every phrase is the label on the screen that WRITES the field
 * (audited 2026-09-24 against Module1Assets, Module1Costs,
 * Module1AssetStandards, Module2Revenue, Module1FundTerms, Module1Financing,
 * Module2Escrow, Module5Shared), in sentence case. A phrase REPLACES the
 * nested section names ("revenue operate adr indexation: Rate" reads "ADR
 * indexation rate %"). Anything not listed falls back to the humaniser, so a
 * field added tomorrow still reads as words.
 */
const SCREEN_WORDS: Record<string, Record<string, string>> = {
  assets: {
    'landChain.utilisationPct': 'Land utilisation %', 'landChain.coveragePct': 'Ground coverage %',
    'landChain.farRatio': 'FAR', 'landChain.maxFloors': 'Max floors',
    'landChain.retailPct': 'Retail % (ground floor)', 'landChain.servicePct': 'Service %',
    'landAllocation.sqm': 'Plot area (sqm)', 'landAllocation.parcelId': 'Plot',
    type: 'Type', assetTypeId: 'Type', strategy: 'Strategy', phaseId: 'Phase', subUnitMetric: 'Sells by',
    gfaSqm: 'GFA override (sqm)', supportArea: 'Support area (sqm)', parkingArea: 'Parking area (sqm)',
    buaSqm: 'Total GFA (sqm)', sellableBuaSqm: 'NSA or GLA (sqm)', parkingBaysRequired: 'Parking slots',
    'capexPhasing.distribution': 'Construction phasing weights', 'capexPhasing.phasing': 'Construction phasing curve',
    capexPhasing: 'Construction phasing', landChain: 'Land planning inputs',
    'opex.lines': 'Opex lines',
    'revenue.sell.velocityDefault': 'Sales velocity, all sub-units',
    'revenue.sell.subUnits': 'Sales velocity by sub-unit',
    'revenue.sell.downpaymentByPhase': 'Downpayment %',
    'revenue.sell.maxInstalmentYears': 'Max instalment years after sale',
    'revenue.sell.instalmentsStopAtHandover': 'Instalments',
    'revenue.sell.indexation.method': 'Price indexation', 'revenue.sell.indexation.rate': 'Price indexation rate %',
    'revenue.sell.indexation.startYear': 'Price indexation start year',
    'revenue.sell.recognitionProfile.percentages': 'Revenue recognition %',
    'revenue.lease.occupancyPerPeriod': 'Occupancy', 'revenue.lease.arDays': 'AR days',
    'revenue.lease.rentIndexation.method': 'Rent indexation', 'revenue.lease.rentIndexation.rate': 'Rent indexation rate %',
    'revenue.lease.rentIndexation.startYear': 'Rent indexation start year',
    'revenue.operate.occupancyPerPeriod': 'Occupancy', 'revenue.operate.dso': 'AR days',
    'revenue.operate.adrIndexation.method': 'ADR indexation', 'revenue.operate.adrIndexation.rate': 'ADR indexation rate %',
    'revenue.operate.adrIndexation.startYear': 'ADR indexation start year',
    'revenue.operate.fb.percentOfRooms': 'F&B %', 'revenue.operate.otherRevenue.percentOfRooms': 'Other revenue %',
  },
  subUnits: {
    nsaSharePct: 'NSA share %', unitArea: 'Average unit size (sqm)', unitPrice: 'Rate',
    pricePerSqm: 'Rate per sqm', pricePerUnit: 'Rate per unit', parkingRatio: 'Parking',
    metric: 'Sells by', name: 'Name',
  },
  parcels: { area: 'Area (sqm)', rate: 'Land rate per sqm', phaseId: 'Phase', name: 'Name' },
  costLines: {
    method: 'Method', value: 'Value', startPeriod: 'Start', endPeriod: 'End',
    selectedLineIds: 'Applies to (selected lines)', name: 'Name',
  },
  costOverrides: { value: 'Value', method: 'Method', startPeriod: 'Start', endPeriod: 'End' },
  costStandardRows: { rate: 'Rate', byPhase: 'Rate by phase' },
  assetTypes: { label: 'Name', sortOrder: 'Position in list' },
  assetTypeValues: {
    avgUnitSizeSqm: 'Avg unit size (sqm)', parkingRatio: 'Parking ratio', parkingRatioBasis: 'Ratio basis',
    utilisationPct: 'Utilisation %', coveragePct: 'Coverage %', farRatio: 'FAR', servicePct: 'Service %',
    pricePerUnit: 'Price per unit', pricePerSqm: 'Price per sqm', strategy: 'Strategy for new assets',
  },
  project: {
    'fundTerms.feeDistribution': 'Fund fee distribution', 'fundTerms.enabled': 'Fund structure',
    partners: 'Equity partners', 'financing.fundingMethod': 'Funding method',
    'returns.terminalMethod': 'Terminal value method', 'escrow.heldPct': 'Project held % (escrow)',
    parkingAreaPerSlotSqm: 'Parking area per slot (sqm)', assetTypes: 'Asset types',
    assetTypeValues: 'Asset type values', costStandardRows: 'Cost standards',
  },
};

/** `metricValue` is typed under "Area (sqm)" or "Units or keys", whichever the
 *  line sells by, and the ASSET's metric wins over the row's (TRAPS 7.32). */
function metricValueWords(subUnitId: string, ctx: NamingContext): string {
  const su = find(ctx, 'subUnits', subUnitId);
  const asset = typeof su?.assetId === 'string' ? find(ctx, 'assets', su.assetId) : undefined;
  const metric = (asset?.subUnitMetric ?? su?.metric) as string | undefined;
  return metric === 'units' ? 'Units or keys' : metric === 'area' ? 'Area (sqm)' : 'Area or units';
}

/** The field phrase for a leaf, in the screen's words where the screen names
 *  it. `kind` is the element kind ('project' when none), `rest` the segments
 *  below the element. */
function fieldPhrase(kind: string, rest: readonly string[], elementId: string, ctx: NamingContext): string | undefined {
  if (kind === 'subUnits' && rest.join('.') === 'metricValue') return metricValueWords(elementId, ctx);
  return SCREEN_WORDS[kind]?.[rest.join('.')];
}

/**
 * The sentence for one change. Never throws and never returns the raw path
 * for a path it can parse; an unparseable path is returned as it came, which
 * is the pre-label behaviour and the most honest thing left to show.
 *
 * THE VERB IS THE BADGE'S (2026-09-24). The row's badge already says Added,
 * Removed, Cleared or Updated, so the sentence names WHAT and never repeats
 * the verb ("Added Land 3" under an ADDED badge said it twice, while a field
 * row said it once).
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
      return `Case "${caseName(id, ctx, carried)}"`;
    }
    if (rest === 'name') return 'Case name';
    return `${caseName(id, ctx)} case: ${labelForChange({ path: rest, kind, before: entry.before, after: entry.after }, ctx)}`;
  }

  const segs = parsePath(path);
  if (!segs || segs.length === 0) return path;

  // The record the entry carries whole (an element add or remove).
  const own = (kind === 'remove' ? entry.before : entry.after) as Rec | undefined;
  const ownRec = own && typeof own === 'object' && !Array.isArray(own) ? own : undefined;

  // Walk the path, remembering the DEEPEST element it passes through, what
  // KIND of element it is, and the plain segments after it.
  let element: string | undefined;
  let elementKind = 'project';
  let elementId = '';
  let after: Seg[] = [];
  let endsAtElement = false;
  for (let i = 0; i < segs.length; i++) {
    const s = segs[i];
    const last = i === segs.length - 1;
    let named: string | undefined;
    let k = '';
    let id = '';
    if (s.sel !== undefined && i === 0 && TOP_LISTS.has(s.name)) {
      k = s.name; id = selId(s.sel);
      named = nameElement(s.name as ListKey, id, ctx, last ? ownRec : undefined);
    } else if (s.sel !== undefined && i === 0 && s.name === 'costOverrides') {
      k = 'costOverrides'; id = s.sel;
      named = nameCostOverride(s.sel, ctx);
    } else if (s.sel !== undefined && NESTED_LISTS.has(s.name)) {
      k = s.name; id = selId(s.sel);
      named = nameElement(s.name as ListKey | 'parcelFunding', id, ctx, last ? ownRec : undefined);
    } else if (i > 0 && segs[i - 1].name === 'assetTypeValues' && segs[i - 1].sel === undefined) {
      // `project.assetTypeValues.<typeId>`: an object keyed by a type id.
      k = 'assetTypeValues'; id = s.name;
      named = nameElement('assetTypes', s.name, ctx);
    }
    if (named !== undefined) {
      element = named;
      elementKind = k;
      elementId = id;
      after = [];
      endsAtElement = last;
      continue;
    }
    after.push(s);
  }

  if (endsAtElement && element !== undefined) return element;

  // Below an element, or below `project` itself.
  const rest = (element === undefined ? segs.slice(1) : after).map((s) => s.name);
  const phrase = fieldPhrase(elementKind, rest, elementId, ctx);
  if (phrase !== undefined) return element !== undefined ? `${element}: ${phrase}` : phrase;

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
 * A STORED sentence written before the verb moved to the badge ("Added
 * Land 3", 'Case "Upside" added', 'Case renamed to "Bear"'), read without the
 * verb, so old and new rows read alike.
 */
export function withoutVerb(label: string): string {
  if (/^Case renamed to "/.test(label)) return 'Case name';
  return label
    .replace(/^(Added|Removed) (cost override \()/, 'Cost override (')
    .replace(/^(Added|Removed) /, '')
    .replace(/^(Case "[^"]*") (added|removed)$/, '$1');
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

/** The fields of a stored log row this file reads. The grouping fields are
 *  optional so a caller with bare rows (a version's change list) still works. */
export interface StoredChangeLike {
  action: string;
  path: string | null;
  label: string | null;
  before: unknown;
  after: unknown;
  saveId?: string | null;
  userId?: string | null;
  versionId?: string | null;
  createdAt?: string;
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

/* ──────────────── who wrote it: a person, or the platform (2026-09-24) ──────────────── */

/**
 * WHOSE WRITE A FIELD IS. The founder's test: a row saying a user changed a
 * figure the platform computes is misleading, and a row naming an internal
 * marker tells a reviewer nothing. So every field has one of three roles:
 *
 *   edit        a person typed it on a screen;
 *   computed    the platform works it out (the Assets tab's derived areas, a
 *               retail strip's areas, a seeded block), so no person changed it;
 *   internal    a marker the platform keeps about a value (was this price
 *               typed or inherited, where did this override come from, when
 *               was the strategy reviewed), never shown on a screen.
 *
 * Measured against the screens on 2026-09-24: every `computed` and `internal`
 * field below has NO input on any screen (the audit named the writer of each:
 * settleModel, the store's retail-strip and revenue seeds, the strategy
 * switch, the per-phase occupancy mirror). Matched on the path's SHAPE (every
 * selector reduced to []), with a case's prefix removed, since a case
 * override of a computed figure is still the platform's figure.
 */
const COMPUTED: readonly RegExp[] = [
  /^assets\[\]\.derivedAreas(\.|$)/,
  /^assets\[\]\.(buaSqm|sellableBuaSqm|parkingBaysRequired)$/,
  /^assets\[\]\.(revenue|opex)$/,                  // a whole block, seeded on load and save
  /^assets\[\]\.revenue\.sell\.cashPaymentProfile(\.|$)/,
  /^project\.(assetTypes|assetTypeValues|costStandardRows)$/, // a whole list, backfilled or seeded
  /^project\.projectNdaEnabled$/,                 // written only by a migration; the card is retired
];
const INTERNAL: readonly RegExp[] = [
  /\.(priceStated|rateStated|selectionStated|origin|linked|stampedAt|changedAt|needsReview)$/,
  /^assets\[\]\.(strategyReview|retainedByStrategy|assetTypeStandards)(\.|$)/,
  /\.occupancyPerPeriodByPhase$/, /\.percentagesByPhase$/, /\.recognitionProfile\.profileMode$/,
  /^landAllocationMode$/,
];

const shapeOf = (path: string): string =>
  path.replace(/^cases\[[^\]]*\]\./, '').replace(/\[[^\]]*\]/g, '[]');

export type FieldRole = 'edit' | 'computed' | 'internal';

export function fieldRole(path: string | null, ctx: NamingContext): FieldRole {
  if (!path) return 'edit';
  const shape = shapeOf(path);
  if (INTERNAL.some((r) => r.test(shape))) return 'internal';
  if (COMPUTED.some((r) => r.test(shape))) return 'computed';
  // A sub-unit's AREA is computed when it follows a typed share: the store
  // re-derives it whenever the line's NSA moves. Its COUNT is typed.
  const m = /^(?:cases\[[^\]]*\]\.)?subUnits\[id=([^\]]*)\]\.metricValue$/.exec(path);
  if (m) {
    const su = find(ctx, 'subUnits', m[1]);
    const asset = typeof su?.assetId === 'string' ? find(ctx, 'assets', su.assetId) : undefined;
    const metric = asset?.subUnitMetric ?? su?.metric;
    if (metric !== 'units' && typeof su?.nsaSharePct === 'number') return 'computed';
  }
  return 'edit';
}

/* ─────────────────────────── one edit, one row ─────────────────────────── */

/**
 * WHICH ROWS ARE ONE SAVE. A row written since mig 245 carries its save's id,
 * which is exact. A row written before carries none, so its save is recovered
 * from how the appender wrote it: one save's rows are ONE insert, consecutive
 * in the log, by one person into one version. Measured on the live log
 * (2026-09-24, 808 rows): every gap inside a save is under 500 ms and every gap
 * between saves is at least 2 s (the autosave beat), with NOTHING in between,
 * so the boundary is 1 s. A save never holds the same path twice, so a
 * repeated path also starts a new group: a guess can split a save, never
 * merge two edits of one field.
 *
 * Used ONLY to fold a consequence into its edit. It is not shown as a save.
 */
export function groupIntoSaves<T extends StoredChangeLike>(rows: readonly T[]): T[][] {
  const out: T[][] = [];
  let cur: T[] = [];
  let paths = new Set<string>();
  const t = (r: T): number => (r.createdAt ? new Date(r.createdAt).getTime() : NaN);
  for (const r of rows) {
    const prev = cur[cur.length - 1];
    const sameSave = prev !== undefined && (
      r.saveId ? r.saveId === prev.saveId
        : !prev.saveId && r.userId === prev.userId && r.versionId === prev.versionId
          && Math.abs(t(prev) - t(r)) < 1000 && !paths.has(r.path ?? ''));
    if (!sameSave) { if (cur.length) out.push(cur); cur = []; paths = new Set(); }
    cur.push(r);
    paths.add(r.path ?? '');
  }
  if (cur.length) out.push(cur);
  return out;
}

const PRICE_FIELDS = ['pricePerSqm', 'pricePerUnit', 'unitPrice'] as const;

/**
 * WITHIN ONE SAVE, THE EDIT AND ITS CONSEQUENCES. Returns the rows to drop as
 * consequences. Two families, each measured on the live log:
 *
 *   A PRICE. Typing a rate on table 5 writes the active basis, the other
 *   basis, the legacy `unitPrice` and a marker: one edit, up to four rows.
 *   The row kept is the basis the line sells by (per sqm for area, per unit
 *   for units), else the first present.
 *
 *   "SELLS BY". Switching a line's metric rewrites every sub-unit's metric,
 *   area and unit size under it. The switch is the edit.
 */
function consequencesIn<T extends StoredChangeLike>(save: readonly T[], ctx: NamingContext): Set<T> {
  const drop = new Set<T>();
  const el = (p: string | null): { prefix: string; list: string; id: string; field: string } | undefined => {
    const m = /^((?:cases\[[^\]]*\]\.)?(subUnits|assets)\[id=([^\]]*)\])\.([A-Za-z0-9_]+)$/.exec(p ?? '');
    return m ? { prefix: m[1], list: m[2], id: m[3], field: m[4] } : undefined;
  };
  // A price: group by sub-unit.
  const prices = new Map<string, T[]>();
  for (const r of save) {
    const e = el(r.path);
    if (e?.list === 'subUnits' && (PRICE_FIELDS as readonly string[]).includes(e.field)) {
      const k = e.prefix;
      prices.set(k, [...(prices.get(k) ?? []), r]);
    }
  }
  for (const [, rows] of prices) {
    if (rows.length < 2) continue;
    const e = el(rows[0].path)!;
    const su = find(ctx, 'subUnits', e.id);
    const asset = typeof su?.assetId === 'string' ? find(ctx, 'assets', su.assetId) : undefined;
    const metric = asset?.subUnitMetric ?? su?.metric;
    const want = metric === 'units' ? 'pricePerUnit' : 'pricePerSqm';
    const keep = rows.find((r) => el(r.path)?.field === want)
      ?? PRICE_FIELDS.map((f) => rows.find((r) => el(r.path)?.field === f)).find(Boolean)!;
    for (const r of rows) if (r !== keep) drop.add(r);
  }
  // "Sells by": the asset's switch absorbs its sub-units' metric rewrites.
  const switched = new Set(save.map((r) => el(r.path)).filter((e) => e?.list === 'assets' && e.field === 'subUnitMetric').map((e) => e!.id));
  if (switched.size) {
    for (const r of save) {
      const e = el(r.path);
      if (e?.list !== 'subUnits' || !['metric', 'metricValue', 'unitArea'].includes(e.field)) continue;
      const su = find(ctx, 'subUnits', e.id);
      if (typeof su?.assetId === 'string' && switched.has(su.assetId)) drop.add(r);
    }
  }
  return drop;
}

/** What was left out, by reason, so the screen can SAY so. */
export interface LeftOut { noChange: number; computed: number; internal: number; consequence: number }

/**
 * What the Activity panel SHOWS for the stored rows: every row that records a
 * PERSON'S EDIT, each carrying a sentence (the stored one, read without its
 * verb, where there is one, else the one `labelForChange` builds from its
 * path) and the classification the differ's own rule gives it. Everything
 * else is COUNTED by reason, never dropped silently. Returns copies; the
 * stored rows are never touched. Applies to every row, old and new alike: the
 * appender still records every path (the log is a ledger), and this decides
 * what a reader is shown.
 */
export function presentChanges<T extends StoredChangeLike>(
  changes: readonly T[],
  ctx: NamingContext,
  same: (a: unknown, b: unknown) => boolean,
): { rows: T[]; noChange: number; leftOut: LeftOut } {
  const leftOut: LeftOut = { noChange: 0, computed: 0, internal: 0, consequence: 0 };
  const kept: T[] = [];
  for (const c of changes) {
    if (recordsNoChange(c, same)) { leftOut.noChange++; continue; }
    const role = fieldRole(c.path, ctx);
    if (role !== 'edit') { leftOut[role]++; continue; }
    kept.push(c);
  }
  const drop = new Set<T>();
  for (const save of groupIntoSaves(kept)) for (const r of consequencesIn(save, ctx)) drop.add(r);
  leftOut.consequence = drop.size;

  const rows: T[] = [];
  for (const c of kept) {
    if (drop.has(c)) continue;
    const action = effectiveKind(c.action, c.path);
    // A stored label still wins, read without the verb its badge now carries.
    const label = c.label !== null ? withoutVerb(c.label)
      : c.path ? labelForChange({ path: c.path, kind: action, before: c.before, after: c.after }, ctx) : null;
    rows.push(action === c.action && label === c.label ? c : { ...c, action, label });
  }
  return { rows, noChange: leftOut.noChange, leftOut };
}

/* ─────────────────────── a reference, by name (values) ─────────────────────── */

/** Which list a field that HOLDS an id points into. */
const REFERENCE_FIELDS: Record<string, ListKey> = {
  parcelId: 'parcels', phaseId: 'phases', assetId: 'assets', subUnitId: 'subUnits',
  assetTypeId: 'assetTypes', lineId: 'costLines', caseId: 'cases',
};

/**
 * The NAME of what a reference field points at, for a value chip: a plot's
 * name for `parcelId`, a type's label for `assetTypeId`. Undefined when the
 * field is not a reference; a reference to something the project no longer
 * holds says so, and never prints the id.
 */
export function nameReference(field: string, id: unknown, ctx: NamingContext): string | undefined {
  const key = REFERENCE_FIELDS[field];
  if (!key || typeof id !== 'string') return undefined;
  if (id.startsWith('__')) return undefined; // a sentinel is an answer, not a pointer
  const name = key === 'assetTypes'
    ? typedName(find(ctx, key, id))
    : nameElement(key, id, ctx, undefined, key !== 'costLines');
  return name || gone(key).toLowerCase();
}

/** The name of one element of a record LIST inside a value (an opex line, a
 *  sub-unit's sales row), from its own name or the id it references. */
export function nameListItem(rec: Record<string, unknown>, ctx: NamingContext): string | undefined {
  const own = typedName(rec);
  if (own) return own;
  for (const f of Object.keys(REFERENCE_FIELDS)) {
    if (typeof rec[f] === 'string') return nameReference(f, rec[f], ctx);
  }
  return undefined;
}

/* ─────────────────────── a bulk save, in words (2026-09-24) ─────────────────────── */

export interface BulkDescription {
  /** How many fields the save changed. */
  total: number;
  /** The PEOPLE's edits among the recorded paths, as sentences, once each. */
  edits: string[];
  /** Recorded paths the platform wrote (computed or internal). */
  platform: number;
  /** Changed fields the row never recorded by name. */
  unrecorded: number;
}

/**
 * WHAT A BULK SAVE CHANGED. A save past the per-save cap writes ONE row, and
 * that row said only a count. Since 2026-09-24 it records every path it
 * changed (`after.changes`); before that it kept a sample of ten
 * (`after.sample`). Both read here the same way: each recorded path through
 * the same role and sentence rules as an ordinary row, and whatever was never
 * recorded is counted rather than implied.
 */
export function describeBulk(after: unknown, ctx: NamingContext): BulkDescription | null {
  if (!after || typeof after !== 'object') return null;
  const a = after as { changedPaths?: unknown; changes?: unknown; sample?: unknown };
  if (typeof a.changedPaths !== 'number') return null;
  const recorded: Array<{ path: string; kind: string }> = Array.isArray(a.changes)
    ? (a.changes as Array<{ path?: unknown; kind?: unknown }>).filter((c) => typeof c?.path === 'string')
      .map((c) => ({ path: c.path as string, kind: typeof c.kind === 'string' ? c.kind : 'update' }))
    : Array.isArray(a.sample)
      ? (a.sample as unknown[]).filter((p): p is string => typeof p === 'string').map((path) => ({ path, kind: 'update' }))
      : [];
  const edits: string[] = [];
  let platform = 0;
  for (const c of recorded) {
    if (fieldRole(c.path, ctx) !== 'edit') { platform++; continue; }
    const s = labelForChange({ path: c.path, kind: effectiveKind(c.kind, c.path) }, ctx);
    if (!edits.includes(s)) edits.push(s);
  }
  return { total: a.changedPaths, edits, platform, unrecorded: Math.max(0, a.changedPaths - recorded.length) };
}
