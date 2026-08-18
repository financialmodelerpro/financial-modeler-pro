/**
 * streamReports.ts (2026-08-12)
 *
 * ONE definition of the sponsor cash-flow build-ups (FCFF, FCFE, Distributed
 * Equity), shared by every surface that prints them.
 *
 * WHY THIS FILE EXISTS. The row list lived in FOUR hand-maintained copies: the
 * M5 Returns screen, the Excel Returns tab, the IC report, and the full project
 * PDF. Three agreed. The PDF's copy started from FCFF and then added the
 * terminal EQUITY value, but FCFF already carries the terminal ENTERPRISE
 * value, so the printed column was short by exactly the terminal value in every
 * period it appeared and by 3,327.4m over the hold on a real project. Nothing
 * caught it, because each surface was verified against itself.
 *
 * THE IDENTITY THESE ROWS MUST SATISFY (see streamBuild.buildSponsorStreamsForExit):
 *   FCFF = (cfo + cfi), plus the terminal ENTERPRISE value at exit, with
 *          inception = -existingPreCapex.
 *   FCFE = (cfo + cfi) + debtDraw + principal + interest - inKind, plus the
 *          terminal EQUITY value at exit, with inception = -existingEquity
 *          (which is -existingPreCapex + existingDebtOpening).
 * FCFE is therefore NOT built from FCFF, and any build-up that starts there has
 * to back the enterprise terminal out again. Starting from the components is
 * simpler and is what the other three surfaces already did.
 *
 * Pure: reads the returns snapshot only. fmt-free, so each surface applies its
 * own formatter; STRUCTURE is what must not drift, presentation is per surface.
 *
 * No em dashes in this file.
 */
import type { M4Row } from '../../components/modules/_shared/m4Table';

/**
 * The build-up component series, index 0 = inception (see ReturnsSnapshot.buildup).
 *
 * `buildup` is OPTIONAL and every series inside it may be absent: the IC report
 * is built from a partial snapshot on a project with no returns yet, and it
 * guarded for that with optional chaining before this builder existed. A
 * missing series yields an empty row rather than a crash.
 */
export interface StreamBuildupSource {
  buildup?: Partial<{
    existingPreCapexPerPeriod: number[];
    existingEquityPerPeriod: number[];
    existingDebtOpeningPerPeriod: number[];
    cfoPerPeriod: number[];
    cfiPerPeriod: number[];
    inKindLandPerPeriod: number[];
    financeCostPerPeriod: number[];
    fcffSubtotalPerPeriod: number[];
    netDebtPerPeriod: number[];
    debtDrawPerPeriod: number[];
    idcDrawPerPeriod: number[];
    principalRepayPerPeriod: number[];
    interestPaidPerPeriod: number[];
    terminalEnterprisePerPeriod: number[];
    terminalEquityPerPeriod: number[];
    equityCashPerPeriod: number[];
    equityInKindPerPeriod: number[];
    dividendsDistributedPerPeriod: number[];
  }>;
  fcffPerPeriod?: number[];
  fcfePerPeriod?: number[];
  dividendStreamPerPeriod?: number[];
}

/** A key into the build-up component series. */
type BuildupKey = keyof NonNullable<StreamBuildupSource['buildup']>;
interface BuildupRowDef { label: string; pick: BuildupKey }

/** How a surface turns one labelled series into its own row type. */
export type StreamRowMaker<T> = (label: string, series: number[], opts: { indent?: number; isTotal?: boolean }) => T;

// FCFF IS UNLEVERED, so it carries NO INTEREST LINE OF ANY KIND, not even the
// IDC. 2026-08-18b removed the IDC row a few hours after adding it: the whole
// finance cost belongs in FCFE. In-kind land STAYS, on its own row, because it
// is a real resource the project consumed rather than a financing charge.
// `verify-returns-buildup` enforces the purity as a check on this list.
const FCFF_ROWS: readonly BuildupRowDef[] = [
  { label: '(-) Historical Development Investment', pick: 'existingPreCapexPerPeriod' },
  { label: '(+) Cash from Operations (pre-interest)', pick: 'cfoPerPeriod' },
  { label: '(-) Capex, cash (Cash from Investing)', pick: 'cfiPerPeriod' },
  { label: '(-) Land Contributed In-Kind (non-cash)', pick: 'inKindLandPerPeriod' },
  { label: '(+) Terminal Enterprise Value', pick: 'terminalEnterprisePerPeriod' },
];

// FCFE now builds VISIBLY FROM FCFF (2026-08-18). The first row is the FCFF
// subtotal itself, so a reader can follow one number into the next statement
// instead of re-reading a parallel column of the same components.
//
// Two rows exist purely to keep that honest. FCFF carries the terminal
// ENTERPRISE value inside it, so the chain backs that out and puts the levered
// terminal (value less closing debt) in its place; doing this implicitly is the
// exact mistake that once left the PDF short by a whole terminal value, so it
// is two visible rows that sum to the swap.
//
// NOTE what is NOT here: no in-kind row. It is inside FCFF already and
// repeating it would charge the equity holder twice.
//
// The finance cost IS here, in full, because FCFF is unlevered and carries
// none of it. Only part of that charge left the bank; the rest was funded by
// drawing debt, which is the row beneath it. The two net to the cash actually
// paid, and the capitalised slice comes back out later as principal.
// FOUR STEPS, matching the reference exactly: FCFF, plus net debt, less the
// finance cost, plus the terminal value. Its FCFF subtotal is PRE-TERMINAL,
// which is what lets this chain start cleanly instead of adding the enterprise
// terminal and then backing it out again; those two removal rows are gone.
//
// Net debt is ONE row, the total drawdown (capex plus IDC) less principal
// repaid, because that is what the reference sums into its "Net Debt" line. The
// capex-versus-IDC split lives in the financing schedule.
//
// No in-kind row here. FCFF charges the full land including in-kind and FCFE
// inherits it, exactly as the reference does (2026-08-18f, reverting a credit
// row that was never asked for).
const FCFE_ROWS: readonly BuildupRowDef[] = [
  { label: '(-) Existing Equity Investment (at inception)', pick: 'existingEquityPerPeriod' },
  { label: '(=) FCFF (unlevered, before terminal value)', pick: 'fcffSubtotalPerPeriod' },
  { label: '(+) Net Debt (total drawdown less principal repaid)', pick: 'netDebtPerPeriod' },
  { label: '(-) Finance Cost (full accrued charge, incl. IDC)', pick: 'financeCostPerPeriod' },
  { label: '(+) Terminal Value less Closing Debt', pick: 'terminalEquityPerPeriod' },
];

const DIVIDEND_ROWS: readonly BuildupRowDef[] = [
  { label: '(-) Existing Equity Investment (at inception)', pick: 'existingEquityPerPeriod' },
  { label: '(-) New Cash Equity Investment', pick: 'equityCashPerPeriod' },
  { label: '(-) In-Kind Equity Investment', pick: 'equityInKindPerPeriod' },
  { label: '(+) Dividends Distributed (cash-sweep waterfall)', pick: 'dividendsDistributedPerPeriod' },
  { label: '(+) Terminal Equity Value', pick: 'terminalEquityPerPeriod' },
];

/** Row labels, exported so a verifier can pin the ORDER without rendering. */
export const FCFF_BUILDUP_LABELS: readonly string[] = [...FCFF_ROWS.map((r) => r.label), '= FCFF (unlevered project)'];
export const FCFE_BUILDUP_LABELS: readonly string[] = [...FCFE_ROWS.map((r) => r.label), '= FCFE (levered equity)'];
export const DIVIDEND_BUILDUP_LABELS: readonly string[] = [...DIVIDEND_ROWS.map((r) => r.label), '= Net Equity Cash Flow (dividend basis)'];

/**
 * Per-surface label wording. The BUILDER owns which rows exist, in what order,
 * and which series each one carries; a surface may restyle the words (the IC
 * deck writes sentence case and "= FCFF, unlevered project"). An unmapped label
 * falls through unchanged, so adding a row here can never silently vanish from
 * a surface that has not been told about it.
 */
export type StreamLabelOverrides = Readonly<Record<string, string>>;

function build<T>(
  rs: StreamBuildupSource,
  defs: readonly BuildupRowDef[],
  totalLabel: string,
  totalSeries: number[],
  make: StreamRowMaker<T>,
  labels?: StreamLabelOverrides,
): T[] {
  const word = (l: string): string => labels?.[l] ?? l;
  return [
    ...defs.map((d) => make(word(d.label), rs.buildup?.[d.pick] ?? [], { indent: 1 })),
    make(word(totalLabel), totalSeries, { isTotal: true }),
  ];
}

export function buildFcffBuildup<T>(rs: StreamBuildupSource, make: StreamRowMaker<T>, labels?: StreamLabelOverrides): T[] {
  return build(rs, FCFF_ROWS, '= FCFF (unlevered project)', rs.fcffPerPeriod ?? [], make, labels);
}

export function buildFcfeBuildup<T>(rs: StreamBuildupSource, make: StreamRowMaker<T>, labels?: StreamLabelOverrides): T[] {
  return build(rs, FCFE_ROWS, '= FCFE (levered equity)', rs.fcfePerPeriod ?? [], make, labels);
}

export function buildDividendBuildup<T>(rs: StreamBuildupSource, make: StreamRowMaker<T>, labels?: StreamLabelOverrides): T[] {
  return build(rs, DIVIDEND_ROWS, '= Net Equity Cash Flow (dividend basis)', rs.dividendStreamPerPeriod ?? [], make, labels);
}

/** Convenience for surfaces that already speak M4Row (the screen and Excel). */
export const m4StreamRow: StreamRowMaker<M4Row> = (label, series, opts) => ({
  label, values: series, indent: opts.indent, isTotal: opts.isTotal,
});
