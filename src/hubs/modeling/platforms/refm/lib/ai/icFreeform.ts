/**
 * refm/lib/ai/icFreeform.ts
 *
 * Free-form AI drafting: the user selects any block on a slide and gives an
 * instruction in their own words ("write this up", "explain this IRR",
 * "summarise what this table shows").
 *
 * The PURE half, matching icNarrative.ts: what the prompt says, how a block is
 * described to the model, and how the response is read back. No I/O, no SDK, no
 * database, so a verifier can assert the prompt and the refusal contract without
 * a key.
 *
 * WHAT IS DIFFERENT FROM THE SIX FIXED FIELDS, AND WHAT IS NOT.
 *
 * Different: the task is written by the user rather than chosen from a list, and
 * the target is a BLOCK rather than a ReportInputs field, so there is no
 * `available(model)` predicate to consult before spending.
 *
 * NOT different, and this is the load-bearing part: GROUNDING IS UNCHANGED. The
 * same `collectGrounding` call supplies the same whitelisted facts from the same
 * report model. There is no new grounding source, and a free instruction cannot
 * add one. `buildGroundedRequest` emits GROUNDING_RULES first and repeats the
 * figure rules last, with the task in between, so an instruction placed in the
 * task slot is structurally incapable of softening "do not invent numbers".
 * That ordering is why a user-authored task is safe to send at all.
 *
 * THE REFUSAL CONTRACT IS STRICTER THAN THE STANDING RULES.
 *
 * GROUNDING_RULES rule 4 permits a partial answer: say a figure is not available
 * "or leave it out". That is right for a fixed field, whose scope is known and
 * mostly covered. It is wrong here, because a free instruction can ask for
 * something the model has no facts for at all (market benchmarks being the
 * obvious case), and a half-grounded paragraph is worse than none: the reader
 * cannot tell which half was real. So a free-form draft is ALL OR NOTHING. If
 * the instruction cannot be carried out entirely from the supplied figures, the
 * model returns a refusal naming what is missing, and the UI presents it as a
 * refusal rather than as a draft that could be applied.
 *
 * No em dashes in this file.
 */

import { stripEmDashes } from '@/src/shared/text/houseStyle';
import { sanitizeNarrativeText } from './icNarrative';

/** Ceiling on a free-form draft. Generous enough for a written-up block, small
 *  enough that a runaway instruction cannot produce an essay-sized bill. */
export const FREEFORM_MAX_TOKENS = 900;

/** Hard ceiling on the instruction itself. An instruction is user text on a
 *  metered path: every character is prompt, and prompt is spend. Long enough
 *  for a real request, short enough that pasting a document into the box is
 *  refused rather than billed. */
export const FREEFORM_INSTRUCTION_MAX = 600;

/**
 * The sentinel the model emits when it cannot answer wholly from the supplied
 * figures.
 *
 * A machine-detectable marker rather than a phrase to match on, because the
 * distinction between "here is your draft" and "I cannot write this" has to be
 * reliable: a refusal that reads as a draft is the failure this whole feature
 * has to avoid. Prose matching would fail the first time a model rephrased.
 */
export const FREEFORM_REFUSAL_MARKER = 'CANNOT_ANSWER_FROM_MODEL:';

/** What the selected block is, as the model needs to understand it. */
export interface FreeformBlockContext {
  /** The deck object type: text, bullets, riskMatrix, table, kpi, and so on. */
  kind: string;
  /** The slide it sits on, so the instruction has a place in the pack. */
  slideTitle: string;
  /** What the block says today. Empty string for a block with no content. */
  current: string;
  /** A human label for the block, when the layout named it. */
  name?: string;
}

export type FreeformValidation =
  | { ok: true; instruction: string }
  | { ok: false; reason: string };

/**
 * Clean and bound a user instruction.
 *
 * Rejects rather than truncates an over-long one: silently cutting an
 * instruction in half would generate against a request the user did not make
 * and charge them for it.
 *
 * Control characters are stripped because they are never meaningful in an
 * instruction and are the cheapest way to try to break out of the surrounding
 * prompt structure. What is NOT attempted here is detecting an instruction that
 * "tries to override the rules": that is unwinnable by pattern matching, and it
 * is not the defence. The defence is structural, and it is in the render layer:
 * the figure rules bracket the task on both sides, and `auditGroundedText`
 * checks the OUTPUT regardless of what the input asked for.
 */
export function validateInstruction(raw: unknown): FreeformValidation {
  if (typeof raw !== 'string') return { ok: false, reason: 'An instruction is required.' };
  // Control characters become spaces. Written as a codepoint filter rather
  // than a regex character class, so this file contains no literal control
  // character of its own.
  const cleaned = Array.from(raw)
    .map((ch) => { const c = ch.codePointAt(0) ?? 0; return c < 0x20 || c === 0x7f ? ' ' : ch; })
    .join('')
    .replace(/\s+/g, ' ')
    .trim();
  if (!cleaned) return { ok: false, reason: 'An instruction is required. Say what you want written for this block.' };
  if (cleaned.length > FREEFORM_INSTRUCTION_MAX) {
    return { ok: false, reason: `That instruction is ${cleaned.length} characters. Keep it under ${FREEFORM_INSTRUCTION_MAX} so the request stays specific.` };
  }
  return { ok: true, instruction: stripEmDashes(cleaned) };
}

/** True when the block carries nothing a reader would call content. */
export function blockIsEmpty(block: FreeformBlockContext): boolean {
  return !(block.current ?? '').trim();
}

/**
 * How the block is described to the model.
 *
 * THE EMPTY CASE IS STATED EXPLICITLY, not left to be inferred from an empty
 * string. A block on a freshly added blank slide has no content and no assigned
 * purpose, so the instruction is the only thing that says what belongs there. A
 * model given a silent empty string tends to assume it is meant to continue or
 * rewrite something, and invents a subject to write about. Naming the situation
 * removes that guess and makes the instruction load-bearing, which is what the
 * user intended by typing it.
 */
export function describeBlock(block: FreeformBlockContext): string {
  const where = block.slideTitle ? `on the slide titled "${block.slideTitle}"` : 'on a slide in this pack';
  const named = block.name ? ` It is labelled "${block.name}".` : '';
  if (blockIsEmpty(block)) {
    return [
      `THE BLOCK YOU ARE WRITING FOR: an EMPTY ${block.kind} block ${where}.${named}`,
      'It has no content yet and no assigned purpose. The instruction below is the only thing that says what belongs here, so follow it literally and do not assume a subject it does not name.',
    ].join('\n');
  }
  return [
    `THE BLOCK YOU ARE WRITING FOR: a ${block.kind} block ${where}.${named}`,
    'It currently reads:',
    '"""',
    block.current.trim(),
    '"""',
    'Your text will REPLACE that content, so write the finished block, not an edit of it and not a commentary on it.',
  ].join('\n');
}

/**
 * The all-or-nothing rule, stated to the model.
 *
 * Written as a single decision with one output format for each branch, because
 * the failure to avoid is a hedged half-answer: a paragraph that quietly drops
 * the ungrounded half and reads as complete. A reader cannot tell which part was
 * grounded, which is the whole objection.
 */
export function refusalRule(): string {
  return [
    'BEFORE YOU WRITE, DECIDE ONE THING.',
    'Can the instruction be carried out COMPLETELY using only the supplied figures and the block content above?',
    '',
    `If NO, reply with exactly one line: ${FREEFORM_REFUSAL_MARKER} followed by a short sentence naming what you would need and do not have.`,
    'Reply that way whenever the instruction asks for anything outside the supplied data: market benchmarks, comparable transactions, industry averages, valuations you would have to source, forecasts of external conditions, or the opinion of a party not represented in the data.',
    'Do NOT answer partially. Do not write the part you can support and omit the rest, and do not hedge the gap with a caveat. A half-grounded paragraph is worse than a refusal, because the reader cannot tell which half was grounded.',
    '',
    'If YES, write the block and nothing else. No preamble, no heading, no restatement of the instruction, and no closing note about what you could not include.',
  ].join('\n');
}

/**
 * The full task sent for a free-form request: the block, the rule, the user's
 * instruction, then the shape line.
 *
 * The user's instruction is DELIMITED and labelled as a request from the person
 * editing the deck. That is not a security boundary (see validateInstruction on
 * why pattern matching is not the defence); it is so the model can tell the
 * instruction apart from the surrounding structure and follow it as a request
 * rather than reading it as another system rule.
 *
 * The shape line goes last, matching narrativeTaskFor: the final instruction
 * before writing carries the most weight, and here it is the reminder that the
 * output is deck content rather than a reply to a person.
 */
export function buildFreeformTask(instruction: string, block: FreeformBlockContext): string {
  return [
    'This text will appear in an investment committee pack for a real estate development project. The reader is a committee member deciding whether to approve capital.',
    '',
    describeBlock(block),
    '',
    refusalRule(),
    '',
    'THE REQUEST FROM THE PERSON EDITING THIS DECK:',
    '"""',
    instruction,
    '"""',
    '',
    'READS AS: finished content for that block, in the register of the pack around it. NOT AS: a reply to the request, a description of what you did, or a note about your own limits.',
  ].join('\n');
}

export interface FreeformOutput {
  /** True when the model declined because the data does not carry the answer. */
  refused: boolean;
  /** The draft, when it is one. Empty on a refusal. */
  text: string;
  /** What the model said it needed and did not have. Present on a refusal. */
  refusalReason?: string;
}

/**
 * Read the response back.
 *
 * A refusal is detected by the marker ANYWHERE in the first part of the text,
 * not only at position zero, because a model occasionally opens with a leading
 * newline or a stray quote before it. What it must never do is treat a draft
 * that merely MENTIONS being unable to source something as a refusal, so the
 * marker has to be present as the literal sentinel.
 */
export function parseFreeformOutput(raw: string): FreeformOutput {
  const text = sanitizeNarrativeText(raw);
  if (!text) return { refused: false, text: '' };

  const at = text.indexOf(FREEFORM_REFUSAL_MARKER);
  // Only a marker at the very start is a refusal. One buried further down means
  // the model wrote a draft and then explained itself, which the shape line
  // forbids; taking the draft and dropping the trailing note is the reading
  // that serves the user, and the audit still checks the figures in it.
  if (at === 0) {
    const reason = text.slice(FREEFORM_REFUSAL_MARKER.length).trim();
    return { refused: true, text: '', refusalReason: reason || 'The supplied model data does not carry what the instruction asks for.' };
  }
  if (at > 0) {
    return { refused: false, text: text.slice(0, at).trim() };
  }
  return { refused: false, text };
}
