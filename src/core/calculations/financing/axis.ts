import type { Project, Phase } from '@/src/hubs/modeling/platforms/refm/lib/state/module1-types';
import type { ProjectAxis } from './types';

/**
 * Project period axis (2026-05-14 convention).
 *
 * arr[0] = project's FIRST active year (e.g., Dec 25 when startDate
 * is 2025-01-01). No prior column. Engine arrays length =
 * `totalPeriods` (not totalPeriods + 1).
 *
 * Phase offset = (phase.startDate calendar year) - (project.startDate
 * calendar year), matching the Costs tab's mapping rule. Falls back
 * to `(constructionStart - 1)` when phase.startDate is missing on
 * legacy snapshots. This guarantees Tab 4's Capex Breakdown lines
 * up column-for-column with the Costs tab's Capex schedule.
 *
 * `totalPeriods = max(phaseOffset + phaseLen)` across phases, where
 * `phaseLen = constructionPeriods + operationsPeriods - overlapPeriods`.
 */
export function buildProjectAxis(project: Project, phases: Phase[]): ProjectAxis {
  const phaseOffsets = new Map<string, number>();
  const projectStartYear = new Date(project.startDate).getUTCFullYear();
  let maxEnd = 0;
  for (const p of phases) {
    let offset: number;
    if (p.startDate && p.startDate.length === 10) {
      const phaseStartYear = new Date(p.startDate).getUTCFullYear();
      offset = Number.isFinite(phaseStartYear - projectStartYear)
        ? Math.max(0, phaseStartYear - projectStartYear)
        : 0;
    } else {
      offset = Math.max(0, (p.constructionStart ?? 1) - 1);
    }
    phaseOffsets.set(p.id, offset);
    const phaseLen = p.constructionPeriods + p.operationsPeriods - p.overlapPeriods;
    const end = offset + Math.max(0, phaseLen);
    if (end > maxEnd) maxEnd = end;
  }
  return { totalPeriods: Math.max(0, maxEnd), phaseOffsets };
}
