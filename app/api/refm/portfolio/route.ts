/**
 * GET /api/refm/portfolio
 *
 * Portfolio figures across the signed-in user's projects: the money the
 * dashboard shows instead of five counts (three of which were status labels
 * nothing ever set, so they read zero permanently).
 *
 * WHY SERVER-SIDE: producing these means running the real engine
 * (computeFinancialsSnapshot -> computeReturnsSnapshot, including the
 * iterative funding solver) once per project. In the browser that would block
 * the main thread for seconds on a real portfolio; here it is off the user's
 * thread and cacheable. The engine is already proven to run headless in node
 * (scripts/verify-fund-e2e.ts computes from a live snapshot).
 *
 * THE BASE CASE, DELIBERATELY: each project is hydrated with
 * hydrationFromAnySnapshot and used AS IS, which is the Management base model.
 * modelFromSnapshot would apply the project's active case, so a sensitivity
 * somebody left selected inside one project would silently move the whole
 * portfolio. The response says which basis it used.
 *
 * SCOPE: live projects only. Archived projects are excluded (they are shelved,
 * and no shelved total is shown), and soft-deleted ones are already invisible
 * to every read.
 *
 * Reads only. No number moves: this runs the engine and sums its output.
 *
 * No em dashes in this file.
 */
import { NextResponse } from 'next/server';
import { getRefmUserId } from '@/src/hubs/modeling/platforms/refm/lib/persistence/auth';
import { listProjects, getVersionById, getLatestVersion } from '@/src/hubs/modeling/platforms/refm/lib/persistence/server';
import { hydrationFromAnySnapshot } from '@/src/hubs/modeling/platforms/refm/lib/state/module1-migrate';
import {
  projectPortfolioMetrics, aggregatePortfolio, type ProjectPortfolioMetrics,
} from '@/src/hubs/modeling/platforms/refm/lib/portfolio/portfolioMetrics';
import type { FinancialsResolverState } from '@/src/hubs/modeling/platforms/refm/lib/financials-resolvers';

export const runtime = 'nodejs';
export const maxDuration = 60;

/** Per-instance cache. Serverless, so this is a warm-instance optimisation and
 *  never a correctness mechanism: the key carries every project's updated_at,
 *  so an edit to any project misses the cache, and a cold instance simply
 *  recomputes. */
const CACHE = new Map<string, { at: number; body: unknown }>();
const CACHE_TTL_MS = 60_000;

export async function GET() {
  const userId = await getRefmUserId();
  if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const { rows, error } = await listProjects(userId);
  if (error) return NextResponse.json({ error }, { status: 500 });

  // Archived projects are shelved, not part of the portfolio.
  const live = rows.filter((p) => !p.archived);
  const fingerprint = `${userId}|${live.map((p) => `${p.id}:${p.updated_at}`).sort().join(',')}`;
  const hit = CACHE.get(fingerprint);
  if (hit && Date.now() - hit.at < CACHE_TTL_MS) {
    return NextResponse.json({ ...(hit.body as object), cached: true });
  }

  const metrics: ProjectPortfolioMetrics[] = [];
  for (const p of live) {
    let raw: unknown = null;
    try {
      if (p.current_version_id) {
        const { row } = await getVersionById(p.id, p.current_version_id);
        raw = row?.snapshot ?? null;
      }
      if (!raw) {
        const { row } = await getLatestVersion(p.id);
        raw = row?.snapshot ?? null;
      }
    } catch {
      raw = null;
    }
    if (!raw) {
      // A project with no saved version is not modelled; it is not an error.
      metrics.push({
        projectId: p.id, name: p.name, currency: 'n/a', modelled: false,
        gdv: 0, totalDevelopmentCost: 0, totalFinancingCost: 0, fundingRequirement: 0,
        saleableAreaSqm: 0, saleableUnits: 0, equityInvested: 0, equityDistributions: 0,
        debtByYear: {}, fcfeByYear: {}, projectIrr: null, equityIrr: null,
      });
      continue;
    }
    // Hydrate through the SAME migration chain the store uses, then use the
    // model as saved: that is the base case, with no case overrides applied.
    const model = hydrationFromAnySnapshot(raw) as unknown as FinancialsResolverState;
    metrics.push(projectPortfolioMetrics(p.id, p.name, model));
  }

  const markets = new Set(live.map((p) => (p.location ?? '').trim()).filter(Boolean)).size;
  const body = {
    ...aggregatePortfolio(metrics, markets),
    basis: 'management-base-case' as const,
    archivedExcluded: rows.length - live.length,
  };
  CACHE.set(fingerprint, { at: Date.now(), body });
  // Keep the map small on a long-lived instance.
  if (CACHE.size > 50) {
    for (const [k, v] of CACHE) if (Date.now() - v.at > CACHE_TTL_MS) CACHE.delete(k);
  }
  return NextResponse.json(body);
}
