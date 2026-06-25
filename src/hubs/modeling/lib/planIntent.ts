/**
 * planIntent.ts (client-safe)
 *
 * Carries a "chosen plan" across the auth journey so a LOGGED-OUT pricing click
 * is never a dead end. The public marketing page hands the intent to the app's
 * /register URL (cross-origin); from there register -> confirm -> signin ->
 * app are all same-origin on the app subdomain, so we persist it to localStorage
 * and resume the action (checkout or trial) once the user is in.
 *
 * intent: 'checkout' (paid plan -> Paddle) or 'trial' (Start free trial).
 *
 * No em dashes in this file.
 */
export type PlanIntentAction = 'checkout' | 'trial';
export interface PlanIntent {
  plan: string;
  interval: 'monthly' | 'annual';
  intent: PlanIntentAction;
}

const KEY = 'fmp_plan_intent';

/** Build the query string used on /register and /pricing URLs. */
export function planIntentQuery(i: PlanIntent): string {
  return `plan=${encodeURIComponent(i.plan)}&interval=${i.interval}&intent=${i.intent}`;
}

/** Parse a plan intent from URL params (null when absent/invalid). */
export function parsePlanIntent(params: URLSearchParams): PlanIntent | null {
  const plan = (params.get('plan') ?? '').trim().toLowerCase();
  if (!plan) return null;
  const interval = params.get('interval') === 'annual' ? 'annual' : 'monthly';
  const intent: PlanIntentAction = params.get('intent') === 'trial' ? 'trial' : 'checkout';
  return { plan, interval, intent };
}

/** Persist the intent (best effort; localStorage may be unavailable). */
export function savePlanIntent(i: PlanIntent): void {
  try { if (typeof window !== 'undefined') window.localStorage.setItem(KEY, JSON.stringify(i)); } catch { /* ignore */ }
}

/** Read a persisted intent (null when absent/invalid). */
export function readPlanIntent(): PlanIntent | null {
  try {
    if (typeof window === 'undefined') return null;
    const raw = window.localStorage.getItem(KEY);
    if (!raw) return null;
    const o = JSON.parse(raw) as Partial<PlanIntent>;
    if (!o.plan) return null;
    return { plan: String(o.plan).toLowerCase(), interval: o.interval === 'annual' ? 'annual' : 'monthly', intent: o.intent === 'trial' ? 'trial' : 'checkout' };
  } catch {
    return null;
  }
}

/** Clear the persisted intent after it has been resumed. */
export function clearPlanIntent(): void {
  try { if (typeof window !== 'undefined') window.localStorage.removeItem(KEY); } catch { /* ignore */ }
}
