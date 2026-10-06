/**
 * receivableDays.ts (2026-10-05, export review group 4, founder's decision)
 *
 * THE RECEIVABLE DAYS A HOTEL OR LEASE LINE IS COLLECTED ON, ONCE. An Operate
 * line's `revenue.operate.dso` and a Lease line's `revenue.lease.arDays` are
 * typed on Module 2 and were read by nothing: the receivable ran on the
 * project DSO alone. They are working-capital levers, so a line's own days now
 * win where it states a POSITIVE figure, and the project DSO applies otherwise.
 *
 * ZERO IS UNSET, NOT CASH BASIS (2026-10-06, founder): the blocks were seeded
 * and saved with 0 on every line, so reading 0 as "collect on the day" let five
 * stored zeros silently override the project DSO. A line that wants cash on the
 * day leaves the project DSO at 0 or types 1. The engine, the Schedules feed, the phase cash flow and
 * every surface that prints the days read this.
 *
 * No em dashes in this file.
 */
export interface ReceivableDaysAsset {
  strategy?: string;
  revenue?: { operate?: { dso?: number }; lease?: { arDays?: number } };
}

/** The line's own days, or undefined where it states none (absent, 0 or negative). */
export function statedLineReceivableDays(asset: ReceivableDaysAsset): number | undefined {
  const own = asset.strategy === 'Operate' ? asset.revenue?.operate?.dso : asset.strategy === 'Lease' ? asset.revenue?.lease?.arDays : undefined;
  return typeof own === 'number' && Number.isFinite(own) && own > 0 ? own : undefined;
}

/** The days the engine collects this line on: its own where stated, else the project DSO. */
export function lineReceivableDays(asset: ReceivableDaysAsset, project: { operatingAr?: { dsoDays?: number } }): number {
  return statedLineReceivableDays(asset) ?? Math.max(0, project.operatingAr?.dsoDays ?? 0);
}

/** How a surface prints the days: the figure and where it comes from. */
export function receivableDaysText(asset: ReceivableDaysAsset, project: { operatingAr?: { dsoDays?: number } }): string {
  const own = statedLineReceivableDays(asset);
  return own !== undefined ? `${own} days (this line's own)` : `${lineReceivableDays(asset, project)} days (the project DSO; this line states none)`;
}
