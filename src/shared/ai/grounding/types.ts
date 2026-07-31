/**
 * shared/ai/grounding/types.ts
 *
 * The grounding contract (AI foundation Unit 4). Pure types, no SDK import, no
 * Supabase import, no platform import, so any layer can describe grounded data
 * without pulling in a dependency.
 *
 * WHY THIS SHAPE
 *
 * A grounded feature could simply hand the model a JSON blob of computed
 * output. That is less code and it is what most integrations do. It is rejected
 * here for one reason: the standing rule is that the AI drafts INTERPRETATION
 * only and never invents a figure. With a JSON blob, "did this number come from
 * the model or did the AI make it up" is unanswerable after the fact. With a
 * flat, labelled fact set it is a lookup (see audit.ts).
 *
 * So the unit of grounding is the FACT: one labelled value, with its unit and
 * the exact string a human would read. Facts group into sections, sections into
 * a document, documents into a bundle.
 *
 * The three grounding types come from the AI feature registry (Unit 2) and are
 * imported rather than redeclared. They are matched by a CHECK constraint on
 * ai_features.grounding in migration 203, so a second definition here would let
 * the code and the database drift apart silently.
 *
 * No em dashes in this file.
 */

import type { AiGrounding } from '../registryTypes';

/** model | external | context. One definition, shared with the registry. */
export type GroundingType = AiGrounding;

/**
 * How a fact's value should be read. Drives rendering AND the numeric audit,
 * because "11.9%" and "0.119" are the same fact and both spellings must count
 * as supported when they appear in generated text.
 */
export type FactKind =
  /** A currency amount, in the model's own units (unscaled). */
  | 'money'
  /** A ratio stored as a fraction: 0.119 renders as 11.9%. */
  | 'percent'
  /** A multiple: 2.404 renders as 2.40x. */
  | 'multiple'
  /** A count or a year. Rendered without decimals. */
  | 'count'
  /** Free text (a name, a strategy, a label). Never audited numerically. */
  | 'text'
  /** An ordered list of numbers (a series). Rendered inline, audited per item. */
  | 'series';

/**
 * One supplied figure.
 *
 * `value` is the RAW number as computed, never pre-scaled, so the audit can
 * compare against what the engine actually produced. `formatted` is what the
 * prompt shows a human-shaped reading of, and it is also audited, because the
 * model will naturally echo the formatted spelling back.
 *
 * `value: null` is meaningful and must survive to the prompt: it is how the
 * model learns to write "not available" instead of estimating.
 */
export interface GroundingFact {
  /** Stable dotted identifier, e.g. 'headline.projectIrr'. Unique per document. */
  key: string;
  /** Human label as it appears in the prompt. */
  label: string;
  kind: FactKind;
  value: number | string | number[] | null;
  /** Display unit ('SAR m', 'sqm', 'years'). Omitted for percent/multiple/text. */
  unit?: string;
  /** The exact reading shown in the prompt. Always present so rendering is pure. */
  formatted: string;
  /** Optional one-line clarification rendered beside the fact. */
  note?: string;
}

/** A titled group of facts. Sections give the prompt structure so the model can
 *  tell headline returns from financing terms. */
export interface GroundingSection {
  id: string;
  title: string;
  facts: GroundingFact[];
  /** Optional lead-in rendered above the facts. Prose only, never a figure. */
  preamble?: string;
}

/**
 * Everything one provider supplied, of one grounding type.
 *
 * `available: false` is a first-class outcome, not an error: an external
 * provider with no market data configured must render a visible "not available"
 * rather than nothing at all, for the same reason an unresolved deck binding
 * renders amber instead of a stale number.
 */
export interface GroundingDocument {
  type: GroundingType;
  /** Provider id that produced this document. */
  providerId: string;
  /** Human description of where the data came from, shown in the prompt. */
  source: string;
  available: boolean;
  /** Why the document is empty. Required when available is false. */
  unavailableReason?: string;
  sections: GroundingSection[];
  /** Stamped by the caller. Kept out of the pure builders so they stay testable. */
  asOf?: string;
}

/** The ordered set of documents assembled for one generation. */
export interface GroundingBundle {
  documents: GroundingDocument[];
  /** Per-type outcome, so a caller can tell "no external data" from "no external
   *  provider registered" without re-deriving it from the documents. */
  status: GroundingStatus[];
}

export interface GroundingStatus {
  type: GroundingType;
  outcome: 'ok' | 'unavailable' | 'no_provider' | 'error';
  providerId: string | null;
  detail?: string;
}

/**
 * What a provider is given. Deliberately open: a model provider wants an
 * already-computed report model, a context provider wants the current module
 * and route, an external provider wants the inputs to validate. Each provider
 * narrows `payload` itself and reports unavailable when it does not recognise
 * what it was handed, rather than throwing.
 */
export interface GroundingInput {
  /** Platform slug the feature belongs to, or 'all'. */
  platformSlug: string;
  /** Feature id requesting grounding, for logging and provider selection. */
  featureId: string;
  /** Provider-specific data supplied by the caller. NEVER recomputed here. */
  payload?: unknown;
  /** Caller-stamped ISO timestamp. */
  asOf?: string;
}

/**
 * A source of grounded data for exactly one type.
 *
 * collect() must NEVER throw and must NEVER recompute: it adapts data the
 * caller already has. That is what keeps the engine out of the AI path.
 */
export interface GroundingProvider {
  id: string;
  type: GroundingType;
  /** One line for admin/diagnostic surfaces. */
  describe: string;
  collect(input: GroundingInput): Promise<GroundingDocument> | GroundingDocument;
}
