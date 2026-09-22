import { z } from 'zod';
import { dateSchema } from './primitives';

export function nextDate(date: string): string {
  const value = new Date(date + 'T00:00:00Z');
  value.setUTCDate(value.getUTCDate() + 1);
  return value.toISOString().slice(0, 10);
}

// Actual declared boundaries also cover 52/53-week and changed fiscal calendars.
export const fiscalCalendarSchema = z.strictObject({
  fiscalYear: z.int().min(1).max(9999), startDate: dateSchema, endDate: dateSchema,
  quarterEnds: z.tuple([dateSchema, dateSchema, dateSchema, dateSchema]),
}).superRefine((calendar, ctx) => {
  const ends = calendar.quarterEnds;
  if (calendar.startDate >= ends[0] || ends.some((end, i) => i > 0 && end <= ends[i - 1]) || ends[3] !== calendar.endDate) {
    ctx.addIssue({ code: 'custom', path: ['quarterEnds'], message: 'Quarter boundaries must increase within the fiscal year and end at year end' });
  }
});

const coverageSchema = z.discriminatedUnion('kind', [
  z.strictObject({ kind: z.literal('annual') }),
  z.strictObject({ kind: z.literal('quarterly'), quarter: z.int().min(1).max(4) }),
  z.strictObject({ kind: z.literal('interim'), span: z.enum(['H1', 'H2', '9M', 'custom']), basis: z.enum(['standalone', 'cumulative']) }),
]);

export const reportingPeriodSchema = z.discriminatedUnion('kind', [
  z.strictObject({ kind: z.literal('instant'), date: dateSchema, calendar: fiscalCalendarSchema }),
  z.strictObject({ kind: z.literal('duration'), startDate: dateSchema, endDate: dateSchema, calendar: fiscalCalendarSchema, coverage: coverageSchema }),
]).superRefine((period, ctx) => {
  const calendar = period.calendar;
  // Refinements may also run after child validation issues; never throw on bad input.
  if (!fiscalCalendarSchema.safeParse(calendar).success) return;
  if (period.kind === 'duration' && !coverageSchema.safeParse(period.coverage).success) return;
  const start = period.kind === 'instant' ? period.date : period.startDate;
  const end = period.kind === 'instant' ? period.date : period.endDate;
  if (start > end || start < calendar.startDate || end > calendar.endDate) {
    ctx.addIssue({ code: 'custom', message: 'Period must be ordered and inside its declared fiscal calendar' });
  }
  if (period.kind === 'instant') return;
  const coverage = period.coverage;
  let expectedStart: string | undefined;
  let expectedEnd: string | undefined;
  if (coverage.kind === 'annual') {
    expectedStart = calendar.startDate; expectedEnd = calendar.endDate;
  } else if (coverage.kind === 'quarterly') {
    expectedStart = coverage.quarter === 1 ? calendar.startDate : nextDate(calendar.quarterEnds[coverage.quarter - 2]);
    expectedEnd = calendar.quarterEnds[coverage.quarter - 1];
  } else {
    if (coverage.basis === 'cumulative') expectedStart = calendar.startDate;
    if (coverage.span === 'H1' || coverage.span === '9M') {
      expectedStart = calendar.startDate;
      expectedEnd = calendar.quarterEnds[coverage.span === 'H1' ? 1 : 2];
      if (coverage.basis !== 'cumulative') ctx.addIssue({ code: 'custom', message: 'H1 and 9M are fiscal year-to-date spans' });
    }
    if (coverage.span === 'H2') {
      expectedStart = nextDate(calendar.quarterEnds[1]); expectedEnd = calendar.endDate;
      if (coverage.basis !== 'standalone') ctx.addIssue({ code: 'custom', message: 'H2 is a standalone half-year' });
    }
  }
  if ((expectedStart && start !== expectedStart) || (expectedEnd && end !== expectedEnd)) {
    ctx.addIssue({ code: 'custom', message: 'Dates disagree with the declared fiscal coverage' });
  }
});

export type FiscalCalendar = z.infer<typeof fiscalCalendarSchema>;
export type ReportingPeriod = z.infer<typeof reportingPeriodSchema>;

// Measurement identity uses actual dates, not display labels or object key order.
export function periodKey(period: ReportingPeriod): string {
  return period.kind === 'instant' ? JSON.stringify(['instant', period.date])
    : JSON.stringify(['duration', period.startDate, period.endDate]);
}
