/**
 * shared/ai/grounding/providers.ts
 *
 * The provider registry and the collector.
 *
 * A feature declares WHICH grounding types it needs (that declaration lives in
 * the AI feature registry, Unit 2, as ai_features.grounding). This module turns
 * that declaration into an assembled bundle by running the providers registered
 * for those types.
 *
 * Design rules that keep this from needing a redesign when categories 2 to 4
 * arrive:
 *
 *   - A provider adapts data it is GIVEN. It never recomputes and never reaches
 *     into the engine. That is what keeps the AI path off the calculation path.
 *   - collect() never throws. A provider that fails, or is handed a payload it
 *     does not recognise, yields a document marked unavailable with a reason,
 *     and the prompt says so out loud. Silence is the failure mode that lets a
 *     model invent a replacement.
 *   - A requested type with no provider still produces a visible "not
 *     available" document, for the same reason.
 *   - Documents are ordered model, then external, then context: the project's
 *     own numbers lead, outside data follows, situational context last.
 *
 * The external and context providers here are working pass-through adapters
 * over caller-supplied data, not placeholders that throw. A real market-data
 * feed later registers as another provider of type 'external' and nothing else
 * changes.
 *
 * Platform-agnostic: nothing here knows about REFM. The REFM model adapter
 * registers itself from the platform folder.
 *
 * No em dashes in this file.
 */

import { countFact, document, moneyFact, percentFact, section, textFact, unavailableDocument } from './facts';
import type {
  GroundingBundle,
  GroundingDocument,
  GroundingInput,
  GroundingProvider,
  GroundingStatus,
  GroundingType,
} from './types';

/** Render and collection order. Not alphabetical: it is the order a reader
 *  should weigh the sources in. */
export const GROUNDING_TYPE_ORDER: readonly GroundingType[] = ['model', 'external', 'context'];

const registry = new Map<string, GroundingProvider>();

/**
 * Register a provider. Idempotent by id: re-registering the same id replaces
 * the definition rather than duplicating it, so a module that registers at
 * import time is safe to load more than once.
 */
export function registerGroundingProvider(provider: GroundingProvider): void {
  if (!provider?.id || !provider.type || typeof provider.collect !== 'function') {
    console.error('[ai-grounding] ignored an invalid provider registration', { id: provider?.id, type: provider?.type });
    return;
  }
  registry.set(provider.id, provider);
}

/** Registered providers, optionally filtered by type, in registration order. */
export function getGroundingProviders(type?: GroundingType): GroundingProvider[] {
  const all = Array.from(registry.values());
  return type ? all.filter((p) => p.type === type) : all;
}

/** Drop a registration. Exists for tests and for a provider that becomes
 *  unavailable at runtime; not part of normal feature wiring. */
export function unregisterGroundingProvider(id: string): void {
  registry.delete(id);
}

export interface CollectOptions {
  /** Types the feature declared, from its registry row. */
  types: readonly GroundingType[];
  input: GroundingInput;
  /** Explicit provider list, bypassing the global registry. Used by tests and
   *  by any caller that wants a deterministic set rather than whatever has been
   *  imported. */
  providers?: GroundingProvider[];
}

/**
 * Run the providers for the requested types and assemble a bundle.
 *
 * Never throws. Every type the feature asked for gets a status entry and a
 * document, so nothing a feature declared can disappear without a trace.
 */
export async function collectGrounding(opts: CollectOptions): Promise<GroundingBundle> {
  const pool = opts.providers ?? getGroundingProviders();
  const wanted = GROUNDING_TYPE_ORDER.filter((t) => opts.types.includes(t));

  const documents: GroundingDocument[] = [];
  const status: GroundingStatus[] = [];

  for (const type of wanted) {
    const providers = pool.filter((p) => p.type === type);

    if (providers.length === 0) {
      documents.push(unavailableDocument(type, 'none', `no ${type} provider`, `No ${type} data source is wired up.`));
      status.push({ type, outcome: 'no_provider', providerId: null });
      continue;
    }

    for (const p of providers) {
      let doc: GroundingDocument;
      try {
        doc = await p.collect(opts.input);
      } catch (err) {
        const detail = err instanceof Error ? err.message : String(err);
        console.error('[ai-grounding] provider threw, treating as unavailable', { providerId: p.id, type, detail });
        doc = unavailableDocument(type, p.id, p.describe, `The ${type} source failed: ${detail}`);
        documents.push(doc);
        status.push({ type, outcome: 'error', providerId: p.id, detail });
        continue;
      }
      documents.push(doc);
      status.push({
        type,
        outcome: doc.available ? 'ok' : 'unavailable',
        providerId: p.id,
        ...(doc.available ? {} : { detail: doc.unavailableReason }),
      });
    }
  }

  return { documents, status };
}

// ---------------------------------------------------------------------------
//  External grounding (category 2: assumption validation against market data)
// ---------------------------------------------------------------------------

/**
 * One outside benchmark. The shape a real market-data source will produce, so
 * wiring one later is a new provider, not a new contract.
 *
 * `source` is required and unlabelled data is rejected: an external figure with
 * no attribution is indistinguishable from an invented one, which is exactly
 * what this whole layer exists to prevent.
 */
export interface ExternalBenchmark {
  key: string;
  label: string;
  value: number | null;
  kind: 'money' | 'percent' | 'count';
  unit?: string;
  /** Where the number came from. Required. */
  source: string;
  asOf?: string;
}

export interface ExternalGroundingPayload {
  benchmarks?: ExternalBenchmark[];
}

/**
 * External provider.
 *
 * NO market-data feed is wired yet: that source decision is deliberately open
 * (own benchmark dataset vs a market-data API) and belongs to the unit that
 * builds category 2. Until then this passes through benchmarks the CALLER
 * supplies and otherwise reports unavailable. It never invents a benchmark, and
 * it drops any benchmark with no source attribution.
 */
export const externalGroundingProvider: GroundingProvider = {
  id: 'external.supplied',
  type: 'external',
  describe: 'Caller-supplied external benchmarks. No market-data feed is connected yet.',
  collect(input: GroundingInput): GroundingDocument {
    const payload = (input.payload ?? {}) as ExternalGroundingPayload;
    const rows = Array.isArray(payload.benchmarks) ? payload.benchmarks : [];
    const usable = rows.filter((b) => b && b.key && b.label && typeof b.source === 'string' && b.source.trim().length > 0);

    if (usable.length === 0) {
      return unavailableDocument(
        'external',
        'external.supplied',
        'external benchmarks',
        rows.length > 0
          ? 'Every supplied benchmark was missing a source attribution and was discarded.'
          : 'No market or benchmark data is connected, and none was supplied with this request.',
      );
    }

    const facts = usable.map((b) => {
      const opts = { unit: b.unit, note: `source: ${b.source}${b.asOf ? `, as of ${b.asOf}` : ''}` };
      if (b.kind === 'percent') return percentFact(b.key, b.label, b.value, opts);
      if (b.kind === 'count') return countFact(b.key, b.label, b.value, opts);
      return moneyFact(b.key, b.label, b.value, opts);
    });

    return document('external', 'external.supplied', 'external benchmarks', [
      section('benchmarks', 'Benchmarks', facts,
        'These are outside reference points. Each carries its own source. Do not treat them as the project\'s own figures.'),
    ], input.asOf);
  },
};

// ---------------------------------------------------------------------------
//  Context grounding (category 3: where the user is and what they are doing)
// ---------------------------------------------------------------------------

export interface ContextGroundingPayload {
  /** Platform-level area the user is in, e.g. 'Module 2: Revenue'. */
  module?: string;
  /** Tab or sub-view within it. */
  tab?: string;
  /** What the user is trying to do, in their own words or the feature's. */
  intent?: string;
  /** Anything else worth stating. Prose only. Figures belong in model data. */
  notes?: string[];
  /** Count of items the user is looking at, when that is meaningful. */
  itemCount?: number;
}

/**
 * Context provider: passes through caller-supplied situational context.
 *
 * Prose only by design. If a feature wants the user's current NUMBERS in the
 * prompt they belong in model grounding, where they are auditable as facts; a
 * figure smuggled in as "context" would bypass the audit entirely.
 */
export const contextGroundingProvider: GroundingProvider = {
  id: 'context.supplied',
  type: 'context',
  describe: 'Caller-supplied application context: module, tab, intent, notes.',
  collect(input: GroundingInput): GroundingDocument {
    const p = (input.payload ?? {}) as ContextGroundingPayload;
    const notes = Array.isArray(p.notes) ? p.notes.filter((n) => typeof n === 'string' && n.trim()) : [];

    const facts = [
      textFact('context.platform', 'Platform', input.platformSlug),
      textFact('context.module', 'Current module', p.module),
      textFact('context.tab', 'Current tab', p.tab),
      textFact('context.intent', 'What the user is doing', p.intent),
      typeof p.itemCount === 'number' ? countFact('context.itemCount', 'Items in view', p.itemCount) : null,
      ...notes.map((n, i) => textFact(`context.note${i + 1}`, `Note ${i + 1}`, n)),
    ].filter((f) => f !== null && f.value !== null);

    // Platform alone is not context worth stating; it is always present.
    if (facts.length <= 1) {
      return unavailableDocument('context', 'context.supplied', 'application context',
        'No application context was supplied with this request.');
    }

    return document('context', 'context.supplied', 'application context', [
      section('context', 'Where this request came from', facts,
        'This describes the user\'s situation. It contains no project figures.'),
    ], input.asOf);
  },
};

/** Register the built-in pass-through providers. Idempotent, so calling it from
 *  more than one entry point is safe. The model provider is NOT registered here:
 *  it is platform-specific and registers from its own platform folder. */
export function registerBuiltInGroundingProviders(): void {
  registerGroundingProvider(externalGroundingProvider);
  registerGroundingProvider(contextGroundingProvider);
}
