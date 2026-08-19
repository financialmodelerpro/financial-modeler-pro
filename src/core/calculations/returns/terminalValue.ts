/**
 * M5 Returns engine, terminal (exit) value.
 *
 * The methods the user picks between:
 *   exit_multiple -> Terminal EV = exit metric (stabilised EBITDA / NOI) x multiple
 *   cap_rate      -> Terminal EV = exit metric / cap rate
 *   perpetuity    -> Gordon growth: Terminal EV = exit FCF x (1 + g) / (r - g)
 *   none          -> 0, no terminal value booked
 *
 * ── THE GROWTH STEP IS NOW EXPLICIT (2026-08-19) ────────────────────────────
 *
 * A capitalisation is conventionally applied to FORWARD income, so the exit
 * metric is grown by one year before dividing. That step used to be buried
 * inside the perpetuity branch as a literal `(1 + g)`, invisible and
 * unavailable to the other methods. It is now ONE step at the top, driven by
 * `applyGrowth`.
 *
 * The caller resolves `applyGrowth`, and its default is the METHOD'S OWN
 * CONVENTION, which is what keeps every existing project unchanged: Gordon
 * carries `(1 + g)` in its formula so it defaults true, and exit-multiple
 * defaults false. Nothing here guesses.
 *
 * Note `cap_rate` and `perpetuity` are the same arithmetic when the cap rate is
 * the derived `r - g`: capitalising forward income at the spread IS Gordon. They
 * are separate methods because a user typing an observed market cap rate is
 * making a different statement from a user asserting a growth rate, and the two
 * inputs should not masquerade as each other.
 */
import type { TerminalValueInput } from './types';

/** Enterprise (firm-level) terminal value at the exit year. */
export function terminalEnterpriseValue(input: TerminalValueInput): number {
  const g = input.perpetuityGrowth ?? 0;
  const base = input.exitMetric ?? 0;
  // ONE growth step, for every method that capitalises.
  //
  // ABSENT MEANS THE METHOD'S OWN CONVENTION, and that default lives HERE rather
  // than only in the caller. Making it `=== true` instead silently stopped
  // Gordon being Gordon for any direct caller that did not pass the new flag:
  // `terminalEnterpriseValue({ method: 'perpetuity', ... })` went from
  // metric x (1 + g) / (r - g) to metric / (r - g). The engine verifier caught
  // it. A function that needs a new argument to keep computing what its own name
  // says is a trap for the next caller.
  const applyGrowth = input.applyGrowth ?? (input.method === 'perpetuity');
  const metric = applyGrowth ? base * (1 + g) : base;

  if (input.method === 'exit_multiple') {
    return Math.max(0, metric) * Math.max(0, input.exitMultiple ?? 0);
  }
  if (input.method === 'cap_rate') {
    const rate = input.capRate ?? 0;
    // A zero or negative cap rate is not a valuation, it is a division by
    // nothing. Guarded to 0 rather than allowed to produce an infinity that
    // would propagate silently into an IRR.
    if (rate <= 1e-9) return 0;
    return Math.max(0, metric / rate);
  }
  if (input.method === 'perpetuity') {
    const r = input.discountRate ?? 0;
    const spread = r - g;
    if (spread <= 1e-9) return 0; // undefined / non-convergent; guard to 0
    return Math.max(0, metric / spread);
  }
  return 0;
}

/**
 * THE CAP RATE THE MODEL WILL USE, and where it came from.
 *
 * Derived as `r - g` unless the user has typed one. That spread is exactly what
 * the Gordon perpetuity divides by, so the derived cap rate and the perpetuity
 * agree by construction rather than by coincidence.
 */
export function resolveCapRate(args: {
  discountRate: number;
  perpetuityGrowth: number;
  stored?: number;
  override?: boolean;
}): { rate: number; derived: number; source: 'manual' | 'derived' } {
  const derived = Math.max(0, (args.discountRate ?? 0) - (args.perpetuityGrowth ?? 0));
  if (args.override === true) {
    return { rate: Math.max(0, args.stored ?? 0), derived, source: 'manual' };
  }
  return { rate: derived, derived, source: 'derived' };
}

/** Whether the terminal metric is grown before capitalising. Absent means the
 *  method's own convention, which is what leaves existing projects unmoved. */
export function resolveApplyGrowth(method: TerminalValueInput['method'], stored?: boolean): boolean {
  if (typeof stored === 'boolean') return stored;
  return method === 'perpetuity';
}

/**
 * Equity terminal value = Enterprise terminal value − debt outstanding at
 * exit + free cash on the balance sheet at exit. Floored at 0 (equity
 * cannot be worth less than nothing to the holder at exit).
 */
export function terminalEquityValue(
  enterpriseValue: number,
  debtOutstandingAtExit: number,
  cashAtExit: number,
): number {
  return Math.max(0, enterpriseValue - Math.max(0, debtOutstandingAtExit) + Math.max(0, cashAtExit));
}
