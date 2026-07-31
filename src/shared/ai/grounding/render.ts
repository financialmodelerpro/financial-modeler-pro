/**
 * shared/ai/grounding/render.ts
 *
 * Turns a grounding bundle into the prompt the central AI client sends.
 *
 * Two jobs, kept in one place so every feature inherits both:
 *
 *   1. GROUNDING_RULES, the standing no-fabrication contract. Every grounded
 *      feature sends it, so the rule cannot be softened per feature by someone
 *      writing a friendlier prompt.
 *   2. Deterministic rendering of facts. Same bundle in, same string out, no
 *      clock and no map iteration order, so a prompt is reproducible and the
 *      audit can be run against exactly what was sent.
 *
 * A rule in a prompt is a request, not a guarantee. audit.ts is the half with
 * teeth: it checks the OUTPUT against the supplied facts. Both are needed, and
 * neither replaces the other.
 *
 * Pure: no I/O, no clock, no SDK import. Produces an AiRequest that runAi
 * consumes like any other call.
 *
 * No em dashes in this file.
 */

import type { AiRequest } from '../types';
import { NOT_AVAILABLE } from './facts';
import type { GroundingBundle, GroundingDocument, GroundingFact } from './types';

/**
 * The hard rule, stated to the model.
 *
 * Written as prohibitions with an explicit escape hatch ("say it is not
 * available"), because a model with no permitted way to express absence will
 * fill the gap. Also bans DERIVING new figures: a plausible sum of two supplied
 * numbers is still a number nobody checked, and it would sit in an IC pack
 * looking exactly as authoritative as a real one.
 */
export const GROUNDING_RULES = [
  'You are drafting commentary for a professional finance document.',
  '',
  'ABSOLUTE RULES ON FIGURES:',
  '1. Use ONLY the figures given in the SUPPLIED DATA below. They are the complete set of facts you have.',
  '2. Never state a number, rate, percentage, multiple, date, or amount that does not appear in the supplied data.',
  '3. Never introduce market data, benchmarks, comparables, industry averages, or any outside fact. You have no market data unless it appears below under external data.',
  `4. If something you would normally mention is not in the supplied data, say it is ${NOT_AVAILABLE} or leave it out. Do not estimate, approximate, extrapolate, or infer it.`,
  '5. Do not calculate new figures from the supplied ones. Do not sum, net, average, annualise, or convert. Quote the figures as given.',
  '6. Quote a figure in the same form it is given, including its unit.',
  '',
  'WHAT YOU ARE FOR:',
  'You interpret the numbers. You explain what they mean, what drives them, what a reader should watch, and where the risk sits. That reading is your contribution. The figures themselves are not yours to create.',
  '',
  'STYLE:',
  'Write in a practitioner voice: direct, specific, and useful to a professional reader. Be constructive rather than critical. No marketing language. Never use em dashes; use a comma, a colon, parentheses, or a new sentence instead.',
].join('\n');

/** One fact as a prompt line. Unit is appended only when it adds information
 *  (a percent already carries its sign, a multiple its x). */
function renderFact(f: GroundingFact): string {
  const unit = f.unit && f.formatted !== NOT_AVAILABLE ? ` ${f.unit}` : '';
  const note = f.note ? `  (${f.note})` : '';
  return `- ${f.label}: ${f.formatted}${unit}${note}`;
}

function renderDocument(doc: GroundingDocument): string {
  const head = `### ${doc.type.toUpperCase()} DATA, source: ${doc.source}${doc.asOf ? `, as of ${doc.asOf}` : ''}`;
  if (!doc.available) {
    return [head, `No ${doc.type} data is available: ${doc.unavailableReason ?? 'no reason given'}.`,
      `Do not substitute your own ${doc.type} data. Write as if this information does not exist.`].join('\n');
  }
  const body = doc.sections.map((s) => {
    const lines = [`#### ${s.title}`];
    if (s.preamble) lines.push(s.preamble);
    lines.push(...s.facts.map(renderFact));
    return lines.join('\n');
  });
  return [head, ...body].join('\n\n');
}

/**
 * The SUPPLIED DATA block. Documents render in bundle order, which the
 * collector fixes as model, then external, then context: the project's own
 * numbers lead, outside data follows, situational context last.
 */
export function renderGroundingPrompt(bundle: GroundingBundle): string {
  if (bundle.documents.length === 0) {
    return ['## SUPPLIED DATA', '',
      'No data was supplied. Do not write figures of any kind. Say that the underlying data is not available.'].join('\n');
  }
  return ['## SUPPLIED DATA', '', ...bundle.documents.map(renderDocument)].join('\n\n');
}

export interface GroundedRequestOptions {
  bundle: GroundingBundle;
  /** What to write. The feature's own instruction, e.g. "Draft the investment
   *  thesis in 3 short paragraphs." */
  task: string;
  /** Optional feature-specific voice or format guidance, appended to the
   *  standing rules. It can ADD constraints; it cannot remove the figure rules,
   *  which are emitted first and last. */
  voice?: string;
  maxTokens?: number;
  model?: string;
}

/**
 * Assemble the AiRequest for a grounded generation.
 *
 * The figure rules are restated as the FINAL instruction as well as the system
 * prompt. That is deliberate: the supplied data sits between the two, and the
 * last thing a model reads carries disproportionate weight, so the rule brackets
 * the payload rather than sitting only above it.
 */
export function buildGroundedRequest(opts: GroundedRequestOptions): AiRequest {
  const system = opts.voice ? `${GROUNDING_RULES}\n\nADDITIONAL GUIDANCE:\n${opts.voice}` : GROUNDING_RULES;

  const content = [
    renderGroundingPrompt(opts.bundle),
    '',
    '## TASK',
    opts.task.trim(),
    '',
    'Reminder: every figure you write must appear verbatim in the supplied data above. If you cannot support a statement with the supplied data, do not make it.',
  ].join('\n');

  const req: AiRequest = { system, messages: [{ role: 'user', content }] };
  if (opts.maxTokens !== undefined) req.maxTokens = opts.maxTokens;
  if (opts.model !== undefined) req.model = opts.model;
  return req;
}
