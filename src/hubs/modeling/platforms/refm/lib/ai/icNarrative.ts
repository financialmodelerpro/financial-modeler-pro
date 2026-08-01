/**
 * refm/lib/ai/icNarrative.ts
 *
 * The PURE half of IC narrative generation (AI foundation Unit 7): which fields
 * can be drafted, what each one asks the model for, whether the model has enough
 * data to be worth spending a metered call on, and how the returned text is
 * shaped before anyone sees it.
 *
 * No I/O, no SDK, no Supabase, no clock. That is deliberate: the prompts are the
 * part a reviewer most needs to read, and keeping them in a pure module means a
 * verifier can assert their content, their voice, and their absence of em dashes
 * without an API key or a database.
 *
 * WHAT THE FIELDS ARE. They are not new storage. Each one targets a field that
 * already exists on ReportInputs and already feeds the IC deck, so a generated
 * draft lands exactly where a hand-typed one would. Five are prose; `risks` is
 * a structured list of risk and mitigant pairs, which is why output shaping is
 * part of this module rather than an afterthought at the call site.
 *
 * AVAILABILITY IS CHECKED BEFORE SPENDING. A scenario takeaway on a single-case
 * model, or exit commentary on a model with no exit rows, can only produce a
 * paragraph of "not available". The generation service refuses those BEFORE the
 * metering call, so a user is never charged a generation for an answer the data
 * cannot support. This mirrors the deck templates, which gate themselves on
 * available(model) rather than rendering an empty slide.
 *
 * WHAT THIS MODULE DOES NOT DO. It never writes. Generated text is an editable
 * draft; persisting it stays the user-confirmed PUT on report-inputs. Nothing
 * here imports a persistence path, and the verifier asserts that.
 *
 * No em dashes in this file, and none in any prompt string it holds.
 */

import type { ReportInputs, RiskItem } from '../reportInputs';
import type { ICReportModel } from '../reports/icReport';

/** The narrative fields a generation can draft. */
export type IcNarrativeFieldKey =
  | 'executiveSummary'
  | 'recommendation'
  | 'risks'
  | 'returnsCommentary'
  | 'exitCommentary'
  | 'scenarioTakeaway';

/** Prose lands in a string field; `risks` lands in a structured row list. */
export type IcNarrativeFormat = 'prose' | 'risks';

export type IcAvailability = { ok: true } | { ok: false; reason: string };

export interface IcNarrativeFieldSpec {
  key: IcNarrativeFieldKey;
  /** Label for a button or a heading. */
  label: string;
  /** The ReportInputs field this draft targets. Typed against ReportInputs so a
   *  rename over there breaks the build here instead of silently orphaning a
   *  generated draft. */
  targetField: keyof ReportInputs;
  /** The IC section it appears in. Given to the model so it writes to the right
   *  place in the pack rather than repeating the executive summary six times. */
  section: string;
  format: IcNarrativeFormat;
  /** Output ceiling. Sized per field: an IC summary is three paragraphs, not an
   *  essay, and a smaller ceiling is also a smaller bill. */
  maxTokens: number;
  /** What to write. Static strings, so every prompt in the product is reviewable
   *  in one file rather than assembled at runtime from fragments. */
  task: string;
  /**
   * What the finished text must READ AS, and what it must not become.
   *
   * Separate from `task` because they fail differently. A task that is followed
   * to the letter can still produce the wrong KIND of text: an executive summary
   * that is really a list of model outputs, a recommendation that is really a
   * second thesis, a risk register that is really reassurance. This line is the
   * shape check, stated last in the prompt where it carries most weight, and the
   * verifier asserts every field has one.
   */
  shape: string;
  /** Whether the supplied model can support this field at all. */
  available(model: ICReportModel): IcAvailability;
}

/**
 * The voice, appended to the standing grounding rules for every field.
 *
 * It can ADD constraints but cannot remove the figure rules: buildGroundedRequest
 * emits GROUNDING_RULES first and repeats the figure reminder last, with this in
 * between. So a friendlier voice can never soften "do not invent numbers".
 *
 * The em dash ban is restated here even though the shared rules already carry
 * it, because this is the house style rule most likely to be violated by a model
 * writing polished prose, and it is cheap to say twice. It is also enforced
 * after the fact in sanitizeNarrativeText, since a prompt is a request.
 */
export const IC_NARRATIVE_VOICE = [
  'VOICE AND FORM:',
  'Write as an experienced development finance practitioner presenting to an investment committee.',
  '',
  'TEACH THE MECHANISM. When you quote a figure, say briefly what drives it, so the reader learns how to READ the number and not merely what it is. The interpretation is your contribution; the figure is already in the table beside your text.',
  'CONSTRUCTIVE, NOT CRITICAL. Where the numbers are weak, say what would have to change for them to work. Do not characterise the project, the sponsor, or the assumptions as bad, poor, or unattractive.',
  'SPECIFIC, NOT GENERIC. Prefer a sentence that names a driver in THIS project over one that could be pasted into any deck.',
  'COMPARE IN WORDS, NOT IN ARITHMETIC. When two supplied figures relate to each other, describe the relationship ("the levered return sits well above the unlevered one, so debt is contributing materially") rather than stating a difference, sum, ratio, or percentage change that you worked out yourself. A figure you calculated is a figure nobody checked, and it will be flagged.',
  'WHEN A FIGURE IS NOT AVAILABLE, say so in a short clause and move on. Do not estimate it, and do not build a paragraph around its absence.',
  '',
  'REGISTER:',
  'Complete sentences, plain professional English, third person throughout. Do not write "we", "I", "our", or "you".',
  'No marketing language. Do not use: compelling, attractive, robust, strong, exciting, significant upside, well positioned, best in class, world class, unlock, or leverage as a verb.',
  'No hedging filler ("it should be noted that", "it is worth mentioning"), no rhetorical questions, and no closing sentence that summarises what you just wrote.',
  'Do not restate the task, and do not open with a heading or the field name. Return only the text that belongs in the field.',
  'Do not use bullet points or markdown formatting unless the task explicitly asks for a structured list.',
  'Never use an em dash. Use a comma, a colon, parentheses, or a new sentence instead.',
].join('\n');

/**
 * Words that mark the register slipping from practitioner to brochure.
 *
 * Exported so the verifier can assert the voice block actually names them: a
 * model follows "do not write compelling" far more reliably than it follows
 * "avoid marketing language", and the difference is worth pinning.
 */
export const BANNED_MARKETING_WORDS = [
  'compelling', 'attractive', 'robust', 'exciting', 'well positioned',
  'best in class', 'world class', 'significant upside',
] as const;

/** Shared framing so each field knows where it sits in the pack. */
const IC_CONTEXT =
  'This text will appear in an investment committee pack for a real estate development project. The reader is a committee member deciding whether to approve capital.';

export const IC_NARRATIVE_FIELDS: Record<IcNarrativeFieldKey, IcNarrativeFieldSpec> = {
  executiveSummary: {
    key: 'executiveSummary',
    label: 'Executive summary and investment thesis',
    targetField: 'executiveSummary',
    section: 'Executive Summary',
    format: 'prose',
    maxTokens: 900,
    task: [
      IC_CONTEXT,
      '',
      'Draft the executive summary and investment thesis in three short paragraphs:',
      '1. What the project is: the asset mix, the location, the phasing, and the scale, using the supplied figures.',
      '2. Why the economics stand up: lead with the headline returns and the development margin, and say what produces them.',
      '3. What has to hold true for the case to deliver, drawn only from what the supplied figures show (for example the reliance on debt, the exit assumption, or the concentration in one phase).',
      '',
      'Do not include a recommendation or the size of the ask; those belong in their own field.',
    ].join('\n'),
    shape: 'READS AS: an investment thesis a committee member could repeat back in three sentences. NOT AS: a list of the model outputs, and not as a recommendation.',
    available: (m) => (m?.overview?.name
      ? { ok: true }
      : { ok: false, reason: 'The report model has no project overview to summarise.' }),
  },

  recommendation: {
    key: 'recommendation',
    label: 'Recommendation and the ask',
    targetField: 'recommendation',
    section: 'Recommendation and Approvals',
    format: 'prose',
    maxTokens: 700,
    task: [
      IC_CONTEXT,
      '',
      'Draft the recommendation and the ask in two short paragraphs:',
      '1. What the committee is being asked to approve, stated in terms of the equity commitment and the debt in the structure, quoting the supplied amounts.',
      '2. What the approval turns on: the conditions or evidence a member should reasonably want satisfied before capital is committed, expressed as things to confirm rather than as a warning.',
      '',
      'State the ask plainly. Do not repeat the full investment thesis and do not list the risks in detail; both have their own field.',
    ].join('\n'),
    shape: 'READS AS: a clear ask with the conditions attached to it. NOT AS: a second executive summary, and not as a risk register.',
    available: (m) => (m?.ask
      ? { ok: true }
      : { ok: false, reason: 'The report model carries no funding ask.' }),
  },

  risks: {
    key: 'risks',
    label: 'Key risks and mitigants',
    targetField: 'risks',
    section: 'Risk Assessment',
    format: 'risks',
    maxTokens: 1200,
    task: [
      IC_CONTEXT,
      '',
      'Identify the five to seven most material risks that the SUPPLIED FIGURES THEMSELVES point to, and pair each with a mitigant.',
      'Ground every risk in something visible in the data: leverage and the debt paydown profile, the exit assumption, cost to value, the margin, phasing concentration, coverage ratios, reliance on customer funding, or the spread between cases.',
      'Do not raise generic development risks that the supplied figures say nothing about (construction inflation, planning delay, market softening) unless a supplied figure actually speaks to them.',
      'A mitigant is an action or a structural feature, not a reassurance. Say what would be done or what already protects the position.',
      '',
      'Return ONLY a JSON array, no prose before or after it, in exactly this shape:',
      '[{"risk": "one sentence naming the risk and the figure that shows it", "mitigant": "one sentence naming the action or structural protection"}]',
    ].join('\n'),
    shape: 'READS AS: a risk register a committee would actually debate, each row naming what could go wrong and what answers it. NOT AS: generic development risks, and not as reassurance dressed up as a mitigant.',
    available: (m) => (m?.headline && m?.devEconomics
      ? { ok: true }
      : { ok: false, reason: 'The report model carries no returns or development economics to assess risk against.' }),
  },

  returnsCommentary: {
    key: 'returnsCommentary',
    label: 'Reading the returns',
    targetField: 'returnsCommentary',
    section: 'Returns Analysis',
    format: 'prose',
    maxTokens: 800,
    task: [
      IC_CONTEXT,
      '',
      'Draft the commentary that teaches a committee member how to read this project\'s returns, in two or three short paragraphs.',
      'Explain the relationship between the unlevered and the levered return and what the gap between them says about the role debt is playing.',
      'Cover what the multiple adds that the rate of return does not, and what the coverage or cash on cash figures say about the shape of the cash flows over time.',
      'Where a supplied figure is not available, say so plainly and move on.',
      '',
      'The reader can see the numbers in the table beside this text. Your job is the interpretation, not a restatement of every line.',
    ].join('\n'),
    shape: 'READS AS: a practitioner teaching the committee how to read this return profile. NOT AS: a restatement of the returns table in sentences.',
    available: (m) => {
      const h = m?.headline;
      if (!h) return { ok: false, reason: 'The report model carries no headline returns.' };
      const anyReturn = h.projectIrr !== null || h.equityIrr !== null || h.distributedEquityIrr !== null
        || Number.isFinite(h.projectMoic) || Number.isFinite(h.equityMoic);
      return anyReturn
        ? { ok: true }
        : { ok: false, reason: 'No return measure resolved on this model, so there is nothing to interpret.' };
    },
  },

  exitCommentary: {
    key: 'exitCommentary',
    label: 'Exit optionality',
    targetField: 'exitCommentary',
    section: 'Exit-Year Optionality',
    format: 'prose',
    maxTokens: 700,
    task: [
      IC_CONTEXT,
      '',
      'Draft the exit commentary in two short paragraphs.',
      'Explain what the selected exit year delivers, and how the alternative exit years compare on the supplied measures.',
      'Say what the shape of that comparison implies for timing flexibility: whether holding longer is rewarded, whether an earlier exit costs much, and what a committee member should watch as the decision approaches.',
      'Quote only the exit figures supplied. Do not speculate about market conditions at any future date.',
    ].join('\n'),
    shape: 'READS AS: a view on timing flexibility and what it is worth. NOT AS: a forecast of future market conditions.',
    available: (m) => ((m?.exitYears?.length ?? 0) > 0
      ? { ok: true }
      : { ok: false, reason: 'The report model carries no exit-year analysis, so there is no optionality to comment on.' }),
  },

  scenarioTakeaway: {
    key: 'scenarioTakeaway',
    label: 'Scenario takeaway',
    targetField: 'scenarioTakeaway',
    section: 'Scenario Economics',
    format: 'prose',
    maxTokens: 700,
    task: [
      IC_CONTEXT,
      '',
      'Draft the scenario takeaway in two short paragraphs.',
      'Say what the comparison between the cases actually shows: which case is the base, how far the others move the headline measures, and which input driver is doing that work, using the drivers listed with each case.',
      'Then say what that sensitivity means for the decision: which outcomes hold across the range tested, and which assumption most deserves scrutiny before approval.',
      'Compare only the cases supplied. Do not invent a case, a probability, or a weighting that is not in the data.',
    ].join('\n'),
    shape: 'READS AS: what the spread between cases means for the approval decision. NOT AS: a description of the comparison table.',
    available: (m) => {
      const cols = m?.scenarios?.columns?.length ?? 0;
      return cols >= 2
        ? { ok: true }
        : { ok: false, reason: 'This project has fewer than two cases, so there is no scenario comparison to summarise.' };
    },
  },
};

export const IC_NARRATIVE_FIELD_KEYS = Object.keys(IC_NARRATIVE_FIELDS) as IcNarrativeFieldKey[];

/**
 * The full instruction for a field: what to write, then what it must read as.
 *
 * The shape line goes LAST on purpose. The supplied data and the task sit above
 * it, and the last thing a model reads carries disproportionate weight, so the
 * kind-of-text check is the instruction closest to the point of writing. Same
 * reasoning the shared render layer uses when it repeats the figure rules after
 * the payload.
 */
export function narrativeTaskFor(spec: IcNarrativeFieldSpec): string {
  return [spec.task, '', spec.shape].join('\n');
}

/**
 * Narrow an untrusted string from a request body to a known field key.
 *
 * OWN properties only. `'toString' in IC_NARRATIVE_FIELDS` is true through the
 * prototype chain, so an `in` test would accept {"field":"toString"}, hand the
 * caller a Function where a spec was expected, and crash on spec.available.
 * Checking the key list is the version that cannot be walked into.
 */
export function coerceNarrativeFieldKey(v: unknown): IcNarrativeFieldKey | null {
  return typeof v === 'string' && Object.prototype.hasOwnProperty.call(IC_NARRATIVE_FIELDS, v)
    ? v as IcNarrativeFieldKey
    : null;
}

// ---------------------------------------------------------------------------
//  Output shaping
// ---------------------------------------------------------------------------

/**
 * U+2014 em dash, U+2015 horizontal bar. Both read as em dashes in prose.
 *
 * Written as escapes, not as the literal characters, so this file contains no
 * em dash at all. The alternative was to exempt the one file that hunts for
 * them from the check that hunts for them, and an exemption is how a rule stops
 * being enforced.
 */
const EM_DASH = /[\u2014\u2015]/g;
const EM_DASH_SPACED = /\s*[\u2014\u2015]\s*/g;

/**
 * House style, enforced on the OUTPUT rather than only requested in the prompt.
 *
 * The prompt asks for no em dashes twice. This is what makes it true. A dash
 * with spaces around it is a clause break and becomes a comma; a dash tight
 * between two words is doing the same job with no space, so it becomes a comma
 * plus a space. Nothing else about the sentence is touched.
 *
 * Also strips the wrappers a model adds unbidden: a markdown code fence around
 * the whole answer, and matched quotes around a single paragraph. Both are
 * formatting artefacts that would land verbatim in an IC pack.
 */
export function sanitizeNarrativeText(raw: string): string {
  if (typeof raw !== 'string') return '';
  let t = raw.trim();

  // ```lang\n ... \n``` wrapping the entire answer.
  const fence = /^```[a-z]*\s*\n([\s\S]*?)\n?```$/i.exec(t);
  if (fence) t = fence[1].trim();

  t = t.replace(EM_DASH_SPACED, ', ').replace(EM_DASH, ', ');

  // Matched quotes around the whole answer, only when they do not appear inside.
  if (t.length > 1 && ((t.startsWith('"') && t.endsWith('"')) || (t.startsWith('“') && t.endsWith('”')))) {
    const inner = t.slice(1, -1);
    if (!/["“”]/.test(inner)) t = inner.trim();
  }

  // Normalise runaway blank lines; keep paragraph breaks.
  return t.replace(/\r\n/g, '\n').replace(/\n{3,}/g, '\n\n').trim();
}

/** True when a string still carries an em dash. Used by the verifier and by any
 *  caller that wants to assert the house rule held. */
export function hasEmDash(s: string): boolean {
  return EM_DASH.test(s);
}

const cleanRow = (s: unknown): string => (typeof s === 'string' ? sanitizeNarrativeText(s).replace(/\s+/g, ' ').trim() : '');

/**
 * Parse the risks field into rows.
 *
 * The prompt asks for a JSON array, and models mostly comply, but "mostly" is
 * not a contract: a stray sentence before the array, or a fenced block, is
 * common enough that a strict JSON.parse of the whole response would throw away
 * a perfectly good answer the user already paid for. So parsing is tolerant in
 * a specific order:
 *
 *   1. JSON array found anywhere in the text (first '[' to last ']').
 *   2. Failing that, labelled lines: "Risk: ... Mitigant: ...".
 *   3. Failing that, no rows, and the caller falls back to the prose field.
 *
 * A row with no risk text is dropped. A row with a risk and no mitigant is KEPT
 * with an empty mitigant rather than discarded, because dropping it would hide
 * a risk the model did identify, and an empty mitigant cell is visibly
 * incomplete to the person reviewing the draft.
 */
export function parseRiskRows(raw: string): RiskItem[] {
  const text = sanitizeNarrativeText(raw);
  if (!text) return [];

  const open = text.indexOf('[');
  const close = text.lastIndexOf(']');
  if (open !== -1 && close > open) {
    try {
      const parsed = JSON.parse(text.slice(open, close + 1)) as unknown;
      if (Array.isArray(parsed)) {
        const rows = parsed
          .map((r) => {
            const o = (r ?? {}) as Record<string, unknown>;
            return { risk: cleanRow(o.risk), mitigant: cleanRow(o.mitigant) };
          })
          .filter((r) => r.risk.length > 0);
        if (rows.length > 0) return rows;
      }
    } catch { /* fall through to the line parser */ }
  }

  const rows: RiskItem[] = [];
  let current: RiskItem | null = null;
  for (const lineRaw of text.split('\n')) {
    const line = lineRaw.replace(/^\s*(?:[-*•]|\d+[.)])\s*/, '').trim();
    if (!line) continue;
    const riskMatch = /^risk\s*[:\-]\s*(.+)$/i.exec(line);
    const mitMatch = /^mitigant(?:s)?\s*[:\-]\s*(.+)$/i.exec(line);
    const pair = /^(.*?)\s*\|\s*mitigant\s*[:\-]?\s*(.+)$/i.exec(line);

    if (pair) {
      if (current) rows.push(current);
      current = { risk: cleanRow(pair[1].replace(/^risk\s*[:\-]\s*/i, '')), mitigant: cleanRow(pair[2]) };
      rows.push(current); current = null;
      continue;
    }
    if (riskMatch) {
      if (current) rows.push(current);
      current = { risk: cleanRow(riskMatch[1]), mitigant: '' };
      continue;
    }
    if (mitMatch && current) {
      current.mitigant = cleanRow(mitMatch[1]);
      rows.push(current);
      current = null;
      continue;
    }
  }
  if (current) rows.push(current);
  return rows.filter((r) => r.risk.length > 0);
}

/** Rows rendered back to readable text, so a caller that only has a text field
 *  (or a user who wants to paste it) still gets something legible. */
export function riskRowsToText(rows: RiskItem[]): string {
  return rows.map((r) => `Risk: ${r.risk}\nMitigant: ${r.mitigant || 'not stated'}`).join('\n\n');
}

export interface ShapedNarrative {
  /** Always present: the draft as text, ready for a textarea. */
  text: string;
  /** Present only for the structured risks field. */
  risks?: RiskItem[];
}

/** Turn a raw model response into the shape the target field expects. */
export function shapeNarrativeOutput(spec: IcNarrativeFieldSpec, raw: string): ShapedNarrative {
  if (spec.format === 'risks') {
    const rows = parseRiskRows(raw);
    return rows.length > 0
      ? { text: riskRowsToText(rows), risks: rows }
      : { text: sanitizeNarrativeText(raw), risks: [] };
  }
  return { text: sanitizeNarrativeText(raw) };
}
