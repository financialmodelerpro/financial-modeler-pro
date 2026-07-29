/**
 * shared/ai/models.ts
 *
 * Model configuration for the AI foundation. ONE place that knows which model
 * string we call and which request parameters that model will accept, so a
 * model change is a one-line edit here rather than a hunt through call sites.
 *
 * Pure: no SDK import, no env read beyond the model override, so it is
 * unit-testable.
 *
 * No em dashes in this file.
 */

/**
 * Default model for AI features.
 *
 * Overridable at deploy time with ANTHROPIC_MODEL, so the model can be changed
 * without a code change. The API KEY is deliberately NOT read here: it is read
 * in exactly one place (client.ts).
 */
export const DEFAULT_AI_MODEL = process.env.ANTHROPIC_MODEL?.trim() || 'claude-sonnet-4-6';

/** Output cap. Deliberately generous: hitting the cap truncates mid-sentence,
 *  which for narrative generation reads as a bug rather than a limit. */
export const DEFAULT_MAX_TOKENS = 4096;

/**
 * Per-call timeout in MILLISECONDS. The TypeScript SDK measures timeouts in ms
 * (Python and Ruby use seconds), and this is a common source of off-by-1000
 * bugs, hence the unit in the name.
 *
 * 60s comfortably covers a narrative-length generation while still failing
 * inside a serverless function's own budget.
 */
export const DEFAULT_TIMEOUT_MS = 60_000;

/**
 * Retries for transient failures (429 / 5xx / connection errors). The SDK
 * retries these itself with backoff.
 *
 * NOTE: timeouts are retried too, so worst-case wall clock is
 * timeoutMs * (maxRetries + 1). With the defaults that is 120s, which must stay
 * inside the calling route's own limit.
 */
export const DEFAULT_MAX_RETRIES = 1;

/**
 * Whether a model still accepts sampling parameters (temperature / top_p /
 * top_k).
 *
 * Newer models REMOVED them: sending `temperature` to Opus 4.7+, Opus 5,
 * Sonnet 5, or Fable 5 is a hard 400, not a warning. Older models accept them.
 *
 * This is an ALLOW-list on purpose. An unknown model returns false, so we omit
 * the parameter: omitting is always valid, sending is sometimes fatal. The safe
 * default therefore has to be "do not send".
 */
export function modelAcceptsTemperature(model: string): boolean {
  const m = model.trim().toLowerCase();
  if (!m) return false;
  const acceptsSampling = [
    'claude-sonnet-4-6',
    'claude-sonnet-4-5',
    'claude-sonnet-4-0',
    'claude-sonnet-4-2025',
    'claude-opus-4-6',
    'claude-opus-4-5',
    'claude-opus-4-1',
    'claude-opus-4-0',
    'claude-haiku-4-5',
    'claude-3',
  ];
  return acceptsSampling.some((prefix) => m.startsWith(prefix));
}
