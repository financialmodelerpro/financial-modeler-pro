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

export interface GroundingAudit {
  /** True when no unsupported figure was found. Rounded matches do not fail by
   *  default; pass strictRounding to change that. */
  ok: boolean;
  /** How many numeric literals were examined. */
  checked: number;
  supported: AuditFigure[];
  rounded: AuditFigure[];
  unsupported: AuditFigure[];
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

/** Numbers parsed out of a formatted reading, so a rounded display spelling
 *  ('2.40x' for a stored 2.404) counts as supported. */
function numbersInFormatted(formatted: string): number[] {
  const out: number[] = [];
  const re = /-?\d[\d,]*(?:\.\d+)?/g;
  for (let m = re.exec(formatted); m !== null; m = re.exec(formatted)) {
    const n = Number(m[0].replace(/,/g, ''));
    if (Number.isFinite(n)) out.push(n);
  }
  return out;
}

/**
 * Every numeric spelling a supplied fact legitimately supports.
 *
 * A percent fact supports BOTH its stored fraction and its percent reading
 * (0.119 and 11.9), because the model is shown 11.9% and will write 11.9%,
 * while the engine holds 0.119. Missing that would flag every correct percent
 * in the draft.
 */
export function supportedValues(facts: GroundingFact[]): number[] {
  const vals: number[] = [];
  const push = (n: unknown) => { if (typeof n === 'number' && Number.isFinite(n)) vals.push(n, -n); };

  for (const f of facts) {
    if (typeof f.value === 'number') {
      push(f.value);
      if (f.kind === 'percent') push(f.value * 100);
    } else if (Array.isArray(f.value)) {
      for (const v of f.value) {
        push(v);
        if (f.kind === 'percent') push(v * 100);
      }
    }
    // The formatted reading is what the model was actually shown.
    for (const n of numbersInFormatted(f.formatted)) push(n);
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
  const audit: GroundingAudit = { ok: true, checked: figures.length, supported: [], rounded: [], unsupported: [] };

  for (const fig of figures) {
    const exact = supported.some((s) => Math.abs(s - fig.value) <= EPS + Math.abs(s) * 1e-9);
    if (exact) { audit.supported.push(fig); continue; }

    const near = supported.some((s) => Math.abs(roundTo(s, fig.decimals) - roundTo(fig.value, fig.decimals)) <= EPS);
    if (near) { audit.rounded.push(fig); continue; }

    audit.unsupported.push(fig);
  }

  audit.ok = audit.unsupported.length === 0 && (!opts.strictRounding || audit.rounded.length === 0);
  return audit;
}

/** One line for a log or an admin surface. Never throws on an empty audit. */
export function auditSummary(a: GroundingAudit): string {
  return `${a.checked} figures checked: ${a.supported.length} supported, ${a.rounded.length} rounded, ${a.unsupported.length} unsupported${
    a.unsupported.length ? ` (${a.unsupported.map((f) => f.raw).join(', ')})` : ''
  }`;
}
