/**
 * shared/ai/types.ts
 *
 * Types for the central AI client. Pure, no SDK import, so any layer (including
 * a future client component or a verifier) can describe an AI call without
 * pulling in the Anthropic SDK.
 *
 * The client NEVER throws: every outcome is a typed result. Callers branch on
 * `ok` and, on failure, on `kind`, which is what makes retry/upgrade/alert
 * decisions possible without string-matching an error message.
 *
 * No em dashes in this file.
 */

/**
 * Why an AI call failed, in the terms a caller actually acts on.
 *
 * `retryable` on the result says whether trying again could plausibly work;
 * `kind` says what to tell the user or the log.
 */
export type AiErrorKind =
  /** No ANTHROPIC_API_KEY configured. A deployment problem, not a user one. */
  | 'not_configured'
  /** Key rejected (401). Wrong, revoked, or from another org. */
  | 'auth'
  /** Key lacks permission for the model or feature (403). */
  | 'permission'
  /** Model id not found (404). Usually a stale or retired model string. */
  | 'model_not_found'
  /** Malformed request (400): bad params for this model. */
  | 'bad_request'
  /**
   * The Anthropic account has no credit. Arrives as a 400, like a malformed
   * request, but it is an ACCOUNT problem and the fix is a payment, not a code
   * change. Kept distinct so the message can say so: reported as a generic bad
   * request it reads as "the model is wrong", which sends whoever is on call
   * hunting through model ids instead of opening the billing page.
   */
  | 'insufficient_credit'
  /** Rate limited (429). Retryable after a wait. */
  | 'rate_limit'
  /** Anthropic-side failure (500 / 529). Retryable. */
  | 'server'
  /** Network failure or the request exceeded the timeout. Retryable. */
  | 'network'
  /** The model declined the request on safety grounds (stop_reason refusal). */
  | 'refusal'
  /** Anything unclassified. */
  | 'unknown';

/** One message in a call. The client is text-only by design: features that need
 *  images or tools should extend this deliberately rather than by accident. */
export interface AiMessage {
  role: 'user' | 'assistant';
  content: string;
}

/** A single AI call. Feature-agnostic: this layer knows nothing about M7,
 *  narratives, grounding, or metering, all of which sit above it. */
export interface AiRequest {
  /** Model id. Defaults to DEFAULT_AI_MODEL when omitted. */
  model?: string;
  /** Output cap. Defaults to DEFAULT_MAX_TOKENS. */
  maxTokens?: number;
  /**
   * Sampling temperature. Sent ONLY to models that still accept sampling
   * parameters; silently omitted for models that reject them (see
   * modelAcceptsTemperature). Omitting is always safe, sending to a model that
   * rejects it is a hard 400, so the safe direction is the default.
   */
  temperature?: number;
  /** System prompt. */
  system?: string;
  /** Conversation. Must start with a user message and be non-empty. */
  messages: AiMessage[];
  /** Per-call timeout in MILLISECONDS (the TS SDK's unit). Defaults to
   *  DEFAULT_TIMEOUT_MS. */
  timeoutMs?: number;
  /** Retries for transient failures. Defaults to DEFAULT_MAX_RETRIES. */
  maxRetries?: number;
}

export interface AiUsage {
  inputTokens: number | null;
  outputTokens: number | null;
}

export type AiResult =
  | {
      ok: true;
      /** Concatenated text of every text block in the response. */
      text: string;
      /** The model that actually served the response. */
      model: string;
      stopReason: string | null;
      usage: AiUsage;
      /** Wall-clock milliseconds for the call, for cost/latency logging. */
      elapsedMs: number;
    }
  | {
      ok: false;
      kind: AiErrorKind;
      /** HTTP status when there was one, else null (no-key, network, refusal). */
      status: number | null;
      /** Safe to log. Never contains the API key. */
      message: string;
      /** Whether retrying the same call could plausibly succeed. */
      retryable: boolean;
      elapsedMs: number;
    };
