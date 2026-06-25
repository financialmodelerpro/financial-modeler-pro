/**
 * payments/paddleEnv.ts
 *
 * ONE pure, dependency-free helper shared by the server adapter and the browser
 * checkout opener. It detects a Paddle environment mismatch: Paddle client-side
 * tokens are environment-specific, sandbox tokens start with `test_` and live
 * tokens start with `live_`. When the token's environment does not match the
 * sandbox flag, Paddle.js opens the overlay and then fails with a generic
 * "Something went wrong", so we catch it up front with an actionable message.
 *
 * Kept free of any Node-only imports (no crypto) so it is safe in the client
 * bundle. No em dashes in this file.
 */

/**
 * Returns an actionable error message when the client token's environment does
 * not match the sandbox flag, or null when they are consistent (or no token /
 * an unrecognised token prefix, which this helper does not judge).
 */
export function paddleEnvMismatch(clientToken: string | null | undefined, sandbox: boolean): string | null {
  if (!clientToken) return null;
  if (sandbox && clientToken.startsWith('live_')) {
    return 'Paddle is in SANDBOX mode but a LIVE client-side token (live_...) is configured. '
      + 'Paste the sandbox client-side token (test_...) from sandbox-vendors.paddle.com in Admin > Payments, '
      + 'or turn sandbox off to go live with this token.';
  }
  if (!sandbox && clientToken.startsWith('test_')) {
    return 'Paddle is in LIVE mode but a SANDBOX client-side token (test_...) is configured. '
      + 'Paste the live client-side token (live_...) in Admin > Payments, or turn sandbox on to test.';
  }
  return null;
}
