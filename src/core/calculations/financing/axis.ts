import type { Project, Phase } from '@/src/hubs/modeling/platforms/refm/lib/state/module1-types';
import type { ProjectAxis } from './types';

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
