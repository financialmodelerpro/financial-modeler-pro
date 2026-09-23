/**
 * migrationProbe.ts
 *
 * THE ONE WAY A MIGRATION APPLIER IS ALLOWED TO WRITE (2026-09-23).
 *
 * An applier proves a migration by DOING the thing that must work and the
 * thing that must fail. Both need writes. Those writes are a PROOF, not data,
 * and they must never reach the committed database.
 *
 * ── WHY A SAVEPOINT AND NOT A TIDY-UP DELETE ──────────────────────────────
 *
 * Every applier before 245 deleted its probe rows explicitly at the end, and
 * that convention held until it did not: 245 and 246 were written without the
 * delete, ran with `--apply`, and committed three fictional rows into a real
 * project's APPEND-ONLY audit log plus a future-dated row into the unread
 * marker table, which actively broke that feature for one person.
 *
 * A trailing delete is the wrong shape for three reasons. It is easy to
 * forget; it is skipped by every early return and every throw between the
 * insert and the delete; and its correctness depends on the author enumerating
 * what they wrote, which is the same mirrored-list problem that has bitten
 * this repo elsewhere. A SAVEPOINT cannot be forgotten on an error path,
 * needs no list, and undoes writes the author did not realise they made.
 *
 * ── WHAT SURVIVES ─────────────────────────────────────────────────────────
 *
 * The DDL runs OUTSIDE this helper and commits normally. Only what happens
 * inside the callback is rolled back. So the migration lands and the proof
 * evaporates, which is the correct division.
 *
 * No em dashes in this file.
 */

export interface ProbeClient {
  query(text: string, values?: unknown[]): Promise<{ rows: Array<Record<string, unknown>>; rowCount: number | null }>;
}

let probeDepth = 0;

/**
 * Run probe writes and ALWAYS undo them.
 *
 * The rollback is in a `finally`, so a throw inside the callback still leaves
 * the database as it was found. Nested calls get distinct savepoint names, so
 * an applier may group its probes without the inner one releasing the outer.
 */
export async function withProbes<T>(c: ProbeClient, fn: () => Promise<T>): Promise<T> {
  const name = `fmp_probe_${++probeDepth}`;
  await c.query(`savepoint ${name}`);
  try {
    return await fn();
  } finally {
    // ROLLBACK, never RELEASE. Releasing would keep the writes, which is
    // exactly the bug this exists to make impossible.
    await c.query(`rollback to savepoint ${name}`);
    probeDepth -= 1;
  }
}

/**
 * Attempt a statement that MUST be refused, and report whether it was.
 *
 * Its own savepoint, because a raised exception aborts the whole transaction
 * in Postgres: without one, the first refusal poisons every later check and
 * they read as failures that are not real (TRAPS 3.21).
 */
export async function expectRefusal(c: ProbeClient, sql: string, params: unknown[] = []): Promise<boolean> {
  const name = `fmp_refusal_${++probeDepth}`;
  await c.query(`savepoint ${name}`);
  try {
    await c.query(sql, params);
    await c.query(`rollback to savepoint ${name}`);
    return false; // it was ALLOWED, which is the failure
  } catch {
    await c.query(`rollback to savepoint ${name}`);
    return true;
  } finally {
    probeDepth -= 1;
  }
}
