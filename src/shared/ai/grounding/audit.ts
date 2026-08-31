/**
 * shared/ai/grounding/audit.ts
 *
 * The half of the no-fabrication rule that has teeth.
 *
 * render.ts ASKS the model not to invent figures. This module CHECKS whether it
 * did: every numeric literal in the generated text is extracted and matched
 * against the facts that were actually supplied. A figure with no match is
 * reported, with its position, so a caller can reject the draft, flag it for
 * review, or annotate it.
 *
 * The lesson this encodes: a constraint that is merely present is not a
 * constraint that fires. A prompt rule is present. This is the part that fires.
 *
 * THREE OUTCOMES, not two, because "supported vs not" is too blunt:
 *   supported   - the figure matches a supplied fact exactly.
 *   rounded     - it matches only after rounding to the precision the text used
 *                 ("12%" against a supplied 11.9%). Usually legitimate
 *                 restatement, occasionally sloppiness. Reported separately so
 *                 the caller decides, and never silently accepted.
 *   unsupported - no supplied fact matches. This is the one that matters.
 *
 * WHAT THIS DELIBERATELY CANNOT DO, so nobody trusts it further than it goes:
 *   - It cannot catch a fabricated claim carrying no number ("the market is
 *     strong", "this is above market"). Only figures are checkable here.
 *   - It flags DERIVED figures as unsupported (a correct sum of two supplied
 *     numbers has no matching fact). That is on purpose. The rules forbid
 *     deriving, and the safe direction is to surface an unverified number
 *     rather than to let arithmetic nobody checked pass as fact.
 *   - It flags a digit used in ordinary prose ("3 things to watch"). Also on
 *     purpose: whitelisting small integers would let an invented "5 assets"
 *     through on a three-asset project. A reviewable false positive costs less
 *     than a missed fabrication.
 *   - It still cannot tell WHICH fact a figure meant. It matches on magnitude
 *     within a spelling, so a draft that reports the equity IRR as the project
 *     IRR passes: both numbers were supplied. Attribution is a reviewer's job.
 *     What it will no longer do is match ACROSS spellings (2026-08-31): a
 *     percent must be answered by a percent.
 *
 * THE FOURTH OUTCOME, external claims (2026-08-31). Figure auditing alone
 * cannot catch "Comparable Riyadh assets trade at a 7.5% cap rate" on a project
 * with no market data, and no amount of tightening will make it: the audit
 * found a supplied percent that rounds to 7.5 at the one decimal the sentence
 * used, so 7.5% is an entirely ordinary ROUNDED restatement by every numeric
 * test available. With a hundred-odd supplied percentages, some value lies
 * within half a display unit of almost any rate a model might invent, so
 * density defeats magnitude matching on its own.
 *
 * What is checkable is the CLAIM. The sentence asserts something about the
 * external market, and no document of type 'external' was supplied, so no fact
 * in the bundle could support it whatever its magnitude. That is now reported,
 * and it fails the audit. It is deliberately narrow: a short list of
 * unambiguously market-facing phrases, not the word "market", and it fires only
 * when external grounding is genuinely absent.
 *
 * Pure: no I/O, no clock. Callable from a verifier with no API key.
 *
 * No em dashes in this file.
 */

import { allFacts } from './facts';
import type { GroundingBundle, GroundingDocument, GroundingFact } from './types';

/** One numeric literal found in generated text. */
export interface AuditFigure {
  /** Exactly as written, e.g. '(1,234.5)', '11.9%', '2.40x'. */
  raw: string;
  /** Parsed magnitude, sign applied. */
  value: number;
  /** How it was spelled, which decides which supported spellings can match. */
  form: 'plain' | 'percent' | 'multiple';
  /** Character offset in the audited text, so a caller can highlight it. */
  index: number;
  /** Decimal places used, which sets the rounding comparison. */
  decimals: number;
}

/** A sentence fragment asserting external-market fact, with where it sits. */
export interface AuditClaim {
  /** The phrase that triggered it, as written. */
  phrase: string;
  /** Character offset in the audited text. */
  index: number;
}

export interface GroundingAudit {
  /** True when no unsupported figure and no ungrounded external claim was
   *  found. Rounded matches do not fail by default; pass strictRounding to
   *  change that. */
  ok: boolean;
  /** How many numeric literals were examined. */
  checked: number;
  supported: AuditFigure[];
  rounded: AuditFigure[];
  unsupported: AuditFigure[];
  /** Market assertions made with no 'external' document supplied. Always a
   *  failure: nothing in the bundle can support them at any magnitude. */
  externalClaims: AuditClaim[];
}

/**
 * Phrases that assert a fact about the world OUTSIDE the model.
 *
 * Deliberately specific. "market" alone is not here: a narrative may honestly
 * call an asset "the prime market segment" while claiming nothing about
 * comparables. Each entry below asserts an external DATUM, which only an
 * 'external' grounding document could supply.
 */
const EXTERNAL_CLAIM_PHRASES: readonly string[] = [
  'comparable', 'comparables', 'trade at', 'trades at', 'trading at',
  'market rate', 'market rates', 'market average', 'market cap rate',
  'market data', 'market benchmark', 'benchmarked against',
  'industry average', 'industry standard', 'peer group', 'peers trade',
  'prevailing rate', 'prevailing rates', 'above market', 'below market',
  'versus the market', 'against the market',
];

/**
 * External-market assertions in generated text.
 *
 * Exported so a caller (or a verifier) can ask the question without running a
 * full audit, and so the phrase list has exactly one home.
 */
export function externalClaims(text: string): AuditClaim[] {
  const out: AuditClaim[] = [];
  const hay = text.toLowerCase();
  for (const phrase of EXTERNAL_CLAIM_PHRASES) {
    let from = 0;
    for (;;) {
      const at = hay.indexOf(phrase, from);
      if (at < 0) break;
      // Whole words only, so "comparable" does not fire inside "incomparable".
      const before = at === 0 ? ' ' : hay[at - 1];
      const after = hay[at + phrase.length] ?? ' ';
      if (!/[a-z0-9]/.test(before) && !/[a-z0-9]/.test(after)) {
        out.push({ phrase: text.slice(at, at + phrase.length), index: at });
      }
      from = at + phrase.length;
    }
  }
  return out.sort((a, b) => a.index - b.index);
}

export interface AuditOptions {
  /** Treat a rounded restatement as a violation. Default false. */
  strictRounding?: boolean;
}

/**
 * Numeric literals, with their spelling.
 *
 * Markdown scaffolding is stripped first (ordered-list markers, heading hashes)
 * because "1." opening a bullet is structure, not a claim, and flagging it would
 * bury the real findings in noise.
 */
export function extractFigures(text: string): AuditFigure[] {
  const cleaned = text
    .replace(/^[ \t]*#{1,6}[ \t]+/gm, '')
    .replace(/^[ \t]*\d+[.)][ \t]+/gm, '');

  const out: AuditFigure[] = [];
  // Optional open paren (accounting negative), optional currency symbol, digits
  // with optional grouping and decimals, optional close paren, optional % or x.
  const re = /(\()?\s*(-)?\s*[$£€]?\s*(\d[\d,]*(?:\.\d+)?)\s*(\))?\s*(%|x\b)?/gi;

  for (let m = re.exec(cleaned); m !== null; m = re.exec(cleaned)) {
    const [raw, open, minus, digits, close, suffix] = m;
    const bare = digits.replace(/,/g, '');
    const magnitude = Number(bare);
    if (!Number.isFinite(magnitude)) continue;

    const negative = !!minus || (!!open && !!close);
    const dot = bare.indexOf('.');
    const decimals = dot === -1 ? 0 : bare.length - dot - 1;
    const s = (suffix ?? '').toLowerCase();

    out.push({
      raw: raw.trim(),
      value: negative ? -magnitude : magnitude,
      form: s === '%' ? 'percent' : s === 'x' ? 'multiple' : 'plain',
      index: m.index,
      decimals,
    });
  }
  return out;
}

/** The spelling a figure wears. A supported value carries the set it may
 *  legitimately appear in; a figure only matches inside its own set. */
export type FigureForm = AuditFigure['form'];

/** A value the supplied facts support, and the spellings it supports it IN. */
export interface SupportedValue {
  value: number;
  forms: ReadonlySet<FigureForm>;
}

const FORM_PLAIN: ReadonlySet<FigureForm> = new Set<FigureForm>(['plain']);
const FORM_PERCENT: ReadonlySet<FigureForm> = new Set<FigureForm>(['percent']);
const FORM_MULTIPLE: ReadonlySet<FigureForm> = new Set<FigureForm>(['multiple']);

/** Numbers parsed out of a formatted reading, so a rounded display spelling
 *  ('2.40x' for a stored 2.404) counts as supported.
 *
 *  THE READING'S OWN PUNCTUATION DECIDES THE FORM. '11.9%' supports a percent
 *  spelling of 11.9 and nothing else; 'SAR 7.5m' supports a plain 7.5 and NOT
 *  '7.5%'. Parsing the digits out and discarding the % or the x is what let a
 *  cap rate match a headcount. */
function numbersInFormatted(formatted: string): SupportedValue[] {
  const forms: ReadonlySet<FigureForm> = /%/.test(formatted)
    ? FORM_PERCENT
    : /\d\s*x\b/i.test(formatted) ? FORM_MULTIPLE : FORM_PLAIN;
  const out: SupportedValue[] = [];
  const re = /-?\d[\d,]*(?:\.\d+)?/g;
  for (let m = re.exec(formatted); m !== null; m = re.exec(formatted)) {
    const n = Number(m[0].replace(/,/g, ''));
    if (Number.isFinite(n)) out.push({ value: n, forms });
  }
  return out;
}

/**
 * Every numeric spelling a supplied fact legitimately supports, WITH the
 * spellings it supports it in.
 *
 * A percent fact supports BOTH its stored fraction and its percent reading
 * (0.119 and 11.9), because the model is shown 11.9% and will write 11.9%,
 * while the engine holds 0.119. Missing that would flag every correct percent
 * in the draft.
 *
 * WHY THE FORM IS CARRIED (2026-08-31). This returned a flat list of bare
 * numbers, so a figure matched if ANY supplied fact happened to hold the same
 * magnitude, in any unit, at any scale. The audit then passed
 * "Comparable Riyadh assets trade at a 7.5% cap rate" on a project with no
 * market data at all, because some unrelated model figure was 7.5. That is the
 * exact failure this module exists to prevent: an invented MARKET claim, which
 * no supplied fact could ever support, waved through by a coincidence of
 * magnitude. `AuditFigure.form` had been extracted since the module was
 * written and never consulted.
 *
 * The rule now: a percent spelling matches only a value some fact supports AS
 * A PERCENT, a multiple only a multiple, a plain number only a plain reading.
 * Cross-form coincidence stops being a match.
 */
export function supportedValues(facts: GroundingFact[]): SupportedValue[] {
  const vals: SupportedValue[] = [];
  const push = (n: unknown, forms: ReadonlySet<FigureForm>) => {
    if (typeof n === 'number' && Number.isFinite(n)) vals.push({ value: n, forms }, { value: -n, forms });
  };
  // The stored value's own spelling. A percent is held as a fraction, so 0.119
  // is the PLAIN reading of it and 11.9 is the percent one; a multiple is held
  // as the multiple itself.
  const storedForms = (kind: GroundingFact['kind']): ReadonlySet<FigureForm> =>
    kind === 'multiple' ? FORM_MULTIPLE : FORM_PLAIN;

  for (const f of facts) {
    if (typeof f.value === 'number') {
      push(f.value, storedForms(f.kind));
      if (f.kind === 'percent') push(f.value * 100, FORM_PERCENT);
    } else if (Array.isArray(f.value)) {
      for (const v of f.value) {
        push(v, storedForms(f.kind));
        if (f.kind === 'percent') push(v * 100, FORM_PERCENT);
      }
    }
    // The formatted reading is what the model was actually shown, and it
    // carries its own punctuation, so it decides its own form.
    for (const sv of numbersInFormatted(f.formatted)) push(sv.value, sv.forms);
  }
  return vals;
}

const EPS = 1e-9;
const roundTo = (n: number, d: number): number => {
  const f = 10 ** d;
  return Math.round(n * f) / f;
};

/**
 * Audit generated text against the facts that were supplied to produce it.
 *
 * Accepts a bundle or a raw document list, so a caller can audit against
 * exactly what it sent without reassembling anything.
 */
export function auditGroundedText(
  text: string,
  source: GroundingBundle | GroundingDocument[],
  opts: AuditOptions = {},
): GroundingAudit {
  const docs = Array.isArray(source) ? source : source.documents;
  // Only AVAILABLE documents supply facts. An unavailable one contributes
  // nothing, which is the point: a figure attributed to absent market data must
  // come back unsupported.
  const facts = allFacts(docs.filter((d) => d.available));
  const supported = supportedValues(facts);

  const figures = extractFigures(text);
  const audit: GroundingAudit = { ok: true, checked: figures.length, supported: [], rounded: [], unsupported: [], externalClaims: [] };

  // An assertion about the outside world with no outside data supplied. Checked
  // BEFORE the figures, because it does not depend on any of them: with no
  // available 'external' document there is no magnitude that could make the
  // claim grounded.
  const hasExternal = docs.some((d) => d.available && d.type === 'external');
  if (!hasExternal) audit.externalClaims = externalClaims(text);

  for (const fig of figures) {
    // ONLY values supplied in THIS figure's own spelling may match it. A '%'
    // in the draft must be answered by something a fact supports as a percent.
    const eligible = supported.filter((s) => s.forms.has(fig.form));

    const exact = eligible.some((s) => Math.abs(s.value - fig.value) <= EPS + Math.abs(s.value) * 1e-9);
    if (exact) { audit.supported.push(fig); continue; }

    const near = eligible.some((s) => Math.abs(roundTo(s.value, fig.decimals) - roundTo(fig.value, fig.decimals)) <= EPS);
    if (near) { audit.rounded.push(fig); continue; }

    audit.unsupported.push(fig);
  }

  audit.ok = audit.unsupported.length === 0
    && audit.externalClaims.length === 0
    && (!opts.strictRounding || audit.rounded.length === 0);
  return audit;
}

/** One line for a log or an admin surface. Never throws on an empty audit. */
export function auditSummary(a: GroundingAudit): string {
  const claims = a.externalClaims ?? [];
  return `${a.checked} figures checked: ${a.supported.length} supported, ${a.rounded.length} rounded, ${a.unsupported.length} unsupported${
    a.unsupported.length ? ` (${a.unsupported.map((f) => f.raw).join(', ')})` : ''
  }${
    claims.length ? `; ${claims.length} ungrounded external claim${claims.length === 1 ? '' : 's'} (${claims.map((c) => c.phrase).join(', ')})` : ''
  }`;
}
