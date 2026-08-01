/**
 * shared/ai/client.ts (SERVER ONLY)
 *
 * The central Anthropic client. Every AI feature calls THIS; no feature
 * constructs its own SDK client or reads the API key.
 *
 * Why it exists:
 *   - ONE place reads ANTHROPIC_API_KEY (readApiKey below). Nothing else in the
 *     codebase should reference that variable.
 *   - ONE place owns the model string, timeout, and retry policy, so changing
 *     the model is a one-line edit in models.ts rather than a hunt through
 *     routes.
 *   - ONE place maps SDK exceptions to a typed result, so callers branch on a
 *     union instead of string-matching error messages.
 *   - ONE place knows which request parameters a given model will actually
 *     accept (newer models reject `temperature` with a 400).
 *
 * Deliberately FEATURE-AGNOSTIC. It knows nothing about Module 7, narratives,
 * grounding, metering, or entitlements. Those layers sit above it (Units 2-4)
 * and call runAi like any other feature.
 *
 * SERVER ONLY: the key is a secret. Importing this from a client component
 * would bundle a server-only path; every caller must be a route handler or
 * server module.
 *
 * This module makes NO entitlement or metering decision. Metering (Unit 3)
 * wraps it; it does not live inside it.
 *
 * No em dashes in this file.
 */

import Anthropic from '@anthropic-ai/sdk';
import type { AiErrorKind, AiRequest, AiResult } from './types';
import {
  DEFAULT_AI_MODEL,
  DEFAULT_MAX_RETRIES,
  DEFAULT_MAX_TOKENS,
  DEFAULT_TIMEOUT_MS,
  modelAcceptsTemperature,
} from './models';

/**
 * The ONLY read of ANTHROPIC_API_KEY in the codebase.
 *
 * Env, not the database: unlike the Paddle key (which admin edits at runtime in
 * payment_settings), this is a deploy-time secret with no admin surface, so an
 * env var is the simpler and safer home. Revisit only if per-tenant keys are
 * ever needed.
 */
function readApiKey(): string | null {
  const key = process.env.ANTHROPIC_API_KEY?.trim();
  return key ? key : null;
}

/** Whether AI features can run at all. Cheap: callers can gate a UI on it
 *  without paying for a request. */
export function aiConfigured(): boolean {
  return readApiKey() !== null;
}

/** Non-secret description of the active configuration, for admin/diagnostic
 *  surfaces. Never returns the key itself, only whether one is present. */
export function aiConfigSummary(): {
  configured: boolean;
  keyPrefix: string | null;
  model: string;
  timeoutMs: number;
  maxRetries: number;
} {
  const key = readApiKey();
  return {
    configured: key !== null,
    keyPrefix: key ? `${key.slice(0, 11)}...` : null,
    model: DEFAULT_AI_MODEL,
    timeoutMs: DEFAULT_TIMEOUT_MS,
    maxRetries: DEFAULT_MAX_RETRIES,
  };
}

/** Classify an SDK exception into a typed kind. Uses the SDK's typed error
 *  classes rather than message matching, so it does not break when Anthropic
 *  rewords an error string. */
function classify(err: unknown): { kind: AiErrorKind; status: number | null; retryable: boolean; message: string } {
  // Connection errors are checked BEFORE APIError: in the TypeScript SDK
  // APIConnectionError extends APIError, so the general case would swallow it.
  if (err instanceof Anthropic.APIConnectionError) {
    return { kind: 'network', status: null, retryable: true, message: 'Could not reach the Anthropic API (network or timeout).' };
  }
  if (err instanceof Anthropic.AuthenticationError) {
    return { kind: 'auth', status: 401, retryable: false, message: 'The Anthropic API key was rejected.' };
  }
  if (err instanceof Anthropic.PermissionDeniedError) {
    return { kind: 'permission', status: 403, retryable: false, message: 'The Anthropic API key lacks permission for this model or feature.' };
  }
  if (err instanceof Anthropic.NotFoundError) {
    return { kind: 'model_not_found', status: 404, retryable: false, message: 'The configured model was not found. It may have been retired.' };
  }
  if (err instanceof Anthropic.RateLimitError) {
    return { kind: 'rate_limit', status: 429, retryable: true, message: 'Rate limited by the Anthropic API. Try again shortly.' };
  }
  if (err instanceof Anthropic.BadRequestError) {
    // A spent account arrives here, as a 400 with an invalid_request_error type,
    // because the SDK has no distinct class for it. This is the ONE place the
    // module inspects a message rather than a typed class, and it is a
    // deliberate exception: it only REFINES a 400 into a more specific kind and
    // falls straight back to bad_request if Anthropic rewords the string, so
    // the worst case is the behaviour we had before. Worth the exception
    // because "invalid request for this model" sends the reader to the model
    // config when the actual fix is to top up the account.
    if (/credit balance|insufficient.{0,20}credit|billing|purchase credits/i.test(err.message ?? '')) {
      return {
        kind: 'insufficient_credit',
        status: 400,
        retryable: false,
        message: 'The Anthropic account has insufficient credit. Add credit to the account to enable AI generation. This is a billing problem, not a configuration or model problem.',
      };
    }
    return { kind: 'bad_request', status: 400, retryable: false, message: `Invalid request for this model: ${err.message}` };
  }
  if (err instanceof Anthropic.InternalServerError) {
    return { kind: 'server', status: err.status ?? 500, retryable: true, message: 'The Anthropic API had a server error. Try again shortly.' };
  }
  if (err instanceof Anthropic.APIError) {
    const status = typeof err.status === 'number' ? err.status : null;
    return {
      kind: 'unknown',
      status,
      retryable: status !== null && status >= 500,
      message: err.message || 'Anthropic API error.',
    };
  }
  return { kind: 'unknown', status: null, retryable: false, message: err instanceof Error ? err.message : String(err) };
}

/**
 * The single AI call path.
 *
 * Never throws: every outcome, including a missing key, is a typed AiResult.
 * That is what lets callers handle failure without a try/catch around every
 * feature.
 */
export async function runAi(req: AiRequest): Promise<AiResult> {
  const started = Date.now();
  const fail = (kind: AiErrorKind, status: number | null, message: string, retryable: boolean): AiResult => ({
    ok: false, kind, status, message, retryable, elapsedMs: Date.now() - started,
  });

  // Argument validation runs BEFORE the key check on purpose: a malformed call
  // is a programming error whether or not a key is present, and reporting it as
  // "not configured" would send the caller chasing the wrong problem. It also
  // keeps the client testable without a key.
  if (!req.messages?.length) {
    return fail('bad_request', null, 'At least one message is required.', false);
  }
  if (req.messages[0].role !== 'user') {
    return fail('bad_request', null, 'The first message must be from the user.', false);
  }

  const apiKey = readApiKey();
  if (!apiKey) {
    return fail('not_configured', null, 'AI is not configured: no API key is set.', false);
  }

  const model = (req.model ?? DEFAULT_AI_MODEL).trim();
  const timeoutMs = req.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const maxRetries = req.maxRetries ?? DEFAULT_MAX_RETRIES;

  // Timeout is in MILLISECONDS in the TypeScript SDK. maxRetries covers
  // transient failures; note the SDK retries timeouts too, so worst-case wall
  // clock is timeoutMs * (maxRetries + 1).
  const client = new Anthropic({ apiKey, timeout: timeoutMs, maxRetries });

  // Only send `temperature` to a model that accepts it. Newer models removed
  // sampling parameters and reject them with a 400, so a caller that sets a
  // temperature must not break the moment the model config is upgraded.
  const sampling = req.temperature !== undefined && modelAcceptsTemperature(model)
    ? { temperature: req.temperature }
    : {};

  try {
    const msg = await client.messages.create({
      model,
      max_tokens: req.maxTokens ?? DEFAULT_MAX_TOKENS,
      ...(req.system ? { system: req.system } : {}),
      ...sampling,
      messages: req.messages.map((m) => ({ role: m.role, content: m.content })),
    });

    // A safety refusal is a successful HTTP 200 with stop_reason 'refusal' and
    // (usually) empty content. Reading content[0] blindly would break here, so
    // it is surfaced as a typed failure instead.
    if (msg.stop_reason === 'refusal') {
      return fail('refusal', null, 'The model declined to answer this request.', false);
    }

    // content is a discriminated union; narrow before reading .text.
    const text = msg.content
      .filter((b): b is Extract<typeof b, { type: 'text' }> => b.type === 'text')
      .map((b) => b.text)
      .join('')
      .trim();

    return {
      ok: true,
      text,
      model: msg.model ?? model,
      stopReason: msg.stop_reason ?? null,
      usage: {
        inputTokens: msg.usage?.input_tokens ?? null,
        outputTokens: msg.usage?.output_tokens ?? null,
      },
      elapsedMs: Date.now() - started,
    };
  } catch (err) {
    const c = classify(err);
    // Logged server-side with the model for diagnosis. The key is never logged.
    console.error('[ai] call failed:', { kind: c.kind, status: c.status, model, message: c.message });
    return fail(c.kind, c.status, c.message, c.retryable);
  }
}
