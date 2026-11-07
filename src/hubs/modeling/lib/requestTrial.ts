/**
 * Modeling Hub signup is called "Request a trial", on every surface that links
 * to it. The Modeling Hub and platform page CTAs take their text from the CMS,
 * so a CTA that points at the signup page is relabelled here rather than
 * trusting whatever the CMS row says ("Register Free", "Launch Platform Free").
 *
 * Signup is linked ONLY from the Modeling Hub pages, the platform pages and
 * Pricing. Students are sent to Training Hub signup instead (header "Join
 * free", and the routing question at the top of the signup page).
 */
export const REQUEST_TRIAL_LABEL = 'Request a trial';

/** True when a CTA url points at the Modeling Hub signup page. */
export function isModelingSignupUrl(url: string | null | undefined): boolean {
  if (!url) return false;
  return /(^|\/)(modeling\/)?register(\/|\?|#|$)/.test(url.replace(/^https?:\/\/[^/]+/, ''));
}

/** The label to print for a CTA: "Request a trial" when it leads to signup. */
export function signupAwareCtaLabel(url: string | null | undefined, label: string): string {
  return isModelingSignupUrl(url) ? `${REQUEST_TRIAL_LABEL} →` : label;
}
