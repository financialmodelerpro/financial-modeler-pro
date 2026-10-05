/**
 * phaseProgramme.ts (2026-10-05, export review item 23)
 *
 * THE DEVELOPMENT PROGRAMME, YEAR BY YEAR, ONCE. The workbook's Timeline tab
 * draws it as a Gantt over the period columns; the PDF printed the dated phase
 * table and nothing that shows the programme across the years, because its
 * "Timeline" section was retired on 2026-09-21 (no screen has a Timeline tab)
 * and the programme went with it. Both now read this, so the grid in the PDF
 * and the bars in the workbook cannot disagree.
 *
 * The windows are `computePhaseTimeline`'s, the function the screens and the
 * engine use. Dates are read in UTC: the export runs in the browser, and a
 * local-time read of "2027-01-01" is December 2026 anywhere west of UTC.
 * Operations paint over construction in an overlap year, because that is the
 * year the asset starts earning.
 *
 * No em dashes in this file.
 */
import { computePhaseTimeline, computeProjectTimeline } from '@/src/core/calculations';

export type ProgrammeCell = 'construction' | 'operations' | '';

export interface ProgrammeRow {
  phaseId: string;
  name: string;
  /** One cell per year passed in, in the same order. */
  cells: ProgrammeCell[];
}

export interface PhaseProgramme {
  rows: ProgrammeRow[];
  /** The project's last operating year (the end marker). */
  endYear: number;
}

type TimelinePhase = Parameters<typeof computePhaseTimeline>[0];
type TimelineProject = Parameters<typeof computePhaseTimeline>[1];

function utcYearOf(iso: string | undefined, fallback: number): number {
  if (!iso) return fallback;
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? fallback : d.getUTCFullYear();
}

export function buildPhaseProgramme(
  phases: readonly TimelinePhase[],
  project: TimelineProject,
  years: readonly number[],
  fallbackYear: number,
): PhaseProgramme {
  const rows = phases.map((phase) => {
    const tl = computePhaseTimeline(phase, project);
    const cs = utcYearOf(tl.constructionStart, fallbackYear), ce = utcYearOf(tl.constructionEnd, fallbackYear);
    const os = utcYearOf(tl.operationsStart, fallbackYear), oe = utcYearOf(tl.operationsEnd, fallbackYear);
    const hasOps = (phase.operationsPeriods ?? 0) > 0;
    const hasBuild = (phase.constructionPeriods ?? 0) > 0;
    const cells = years.map((y): ProgrammeCell =>
      hasOps && y >= os && y <= oe ? 'operations'
        : hasBuild && y >= cs && y <= ce ? 'construction'
          : '');
    return { phaseId: phase.id, name: phase.name, cells };
  });
  return { rows, endYear: computeProjectTimeline(project, [...phases]).endYear };
}

/** The PDF cell text and its legend, in one place. */
export const PROGRAMME_CELL_TEXT: Record<ProgrammeCell, string> = { construction: 'Build', operations: 'Ops', '': '' };
export const PROGRAMME_TITLE = 'Development programme';
export const PROGRAMME_LEGEND = 'Build: the phase\'s construction years. Ops: its operating years, which paint over construction in an overlap year because that is when the asset starts earning. End: the project\'s last operating year. The same windows as the Phases table above.';
