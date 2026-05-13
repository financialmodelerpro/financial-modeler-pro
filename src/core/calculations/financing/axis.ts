import type { Project, Phase } from '@/src/hubs/modeling/platforms/refm/lib/state/module1-types';
import type { ProjectAxis } from './types';

/**
 * Project period axis (2026-05-14 convention).
 *
 * arr[0] = project's FIRST active year (e.g., Dec 25 when startDate
 * is 2025-01-01). No prior column. Engine arrays length =
 * `totalPeriods` (not totalPeriods + 1).
 *
 * `totalPeriods = max(phaseOffset + phaseLen)` across phases, where
 * `phaseLen = constructionPeriods + operationsPeriods - overlapPeriods`.
 * Each phase's first active period sits at `phaseOffset` (0 for
 * constructionStart = 1).
 */
export function buildProjectAxis(_project: Project, phases: Phase[]): ProjectAxis {
  const phaseOffsets = new Map<string, number>();
  let maxEnd = 0;
  for (const p of phases) {
    const offset = Math.max(0, (p.constructionStart ?? 1) - 1);
    phaseOffsets.set(p.id, offset);
    const phaseLen = p.constructionPeriods + p.operationsPeriods - p.overlapPeriods;
    const end = offset + Math.max(0, phaseLen);
    if (end > maxEnd) maxEnd = end;
  }
  return { totalPeriods: Math.max(0, maxEnd), phaseOffsets };
}
