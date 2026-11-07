/**
 * liveWorkbookAvailability.ts (2026-11-07)
 *
 * WHEN THE LIVE WORKBOOK IS NOT OFFERED, AND WHAT THE USER IS TOLD.
 *
 * The live workbook refuses a configuration it cannot express sheet by sheet
 * (that sheet stays platform values and says why). The financing loop is the
 * spine: when it refuses, every statement after it (P&L, Cash Flow, Balance
 * Sheet, Returns, Checks) stays values too, and what is left is not a live
 * model. So a build whose Financing sheet is values is REFUSED as a whole: the
 * route answers with a plain message and the Export dialog offers the values
 * workbook instead. Never an error page and never a half-live file.
 *
 * Pure: the route and the census probe both call it on the build's statuses.
 *
 * No em dashes in this file.
 */

export interface LiveWorkbookRefusal {
  /** What the user reads, in full. */
  message: string;
  /** The reasons, in the user's words, for the probe and the logs. */
  reasons: string[];
}

/** The financing layer's own sentence starts with this. */
const FIN_PREFIX = 'The financing could not be made live for this model: ';

/**
 * A layer's refusal, in the words a user would recognise. A reason that names
 * the workbook's own plumbing (a row or cell that is not live) is a consequence
 * of an earlier refusal, not something the user set, so it is summarised.
 */
export function plainReason(raw: string): string | null {
  const r = raw.trim();
  if (/^the .+ (row is not live|cell is not on Inputs)$/.test(r)) return null;
  if (/are not on Inputs and Financing$|is not on Inputs$|is not on the Inputs sheet$|does not state as a number$|Timeline shows no exit year|terminal value basis is not on Inputs|sweep settings are not on Inputs/.test(r)) return null;
  if (r === 'no facility') return 'the project has no debt facility';
  if (/existing operations|existing loan raised before the model starts/.test(r)) return 'the project starts with existing operations (an opening balance, existing equity or a loan raised before the model starts)';
  if (r === 'an operational phase or a phase overlap') return 'a phase is already operational at the start, or two phases overlap';
  if (r === 'monthly periods') return 'the model runs in monthly periods';
  if (/^funding method /.test(r)) return 'the funding method states fixed debt and equity amounts';
  if (/^repayment method /.test(r)) return `a facility repays by ${r.replace(/^repayment method /, '').replace(/_/g, ' ')}`;
  if (/plot paid on a deferred schedule/.test(r)) return 'a plot is paid on a deferred schedule';
  if (/fund fee charged on/.test(r)) return 'a fund fee is charged on NAV or on a facility limit';
  if (/capitalised interest allocated by GFA/.test(r)) return 'capitalised interest is allocated by floor area';
  if (/per-phase dividend policy/.test(r)) return 'dividends are set per phase rather than for the project';
  if (/two facilities with the same name/.test(r)) return 'two facilities share a name';
  if (/state different land funding splits/.test(r)) return r.replace(/'s plots state/, ' has plots with');
  if (/terminal value/i.test(r)) return r;
  return r;
}

const VALUES_OFFER = 'Download the values workbook instead: it has every figure and statement, as calculated by the platform.';

/** The model has nothing to build: no asset on any plot. Checked before the build. */
export function emptyProjectRefusal(visibleAssetCount: number): LiveWorkbookRefusal | null {
  if (visibleAssetCount > 0) return null;
  return {
    reasons: ['the project has no assets yet'],
    message: `The live workbook is not available for this project yet: it has no assets, so there is nothing for the workbook to calculate. Add an asset on the Assets tab and save, or ${VALUES_OFFER.charAt(0).toLowerCase()}${VALUES_OFFER.slice(1)}`,
  };
}

/** The build itself failed one of its own checks (a defect, not a set-up): told plainly, logged in full by the caller. */
export const LIVE_BUILD_FAILED_MESSAGE = `The live workbook could not be built for this version. ${VALUES_OFFER}`;

export function liveWorkbookRefusal(status: Map<string, { status: string; note: string }>): LiveWorkbookRefusal | null {
  const fin = status.get('Financing');
  if (!fin || fin.status !== 'values') return null;
  const note = fin.note ?? '';
  const at = note.indexOf(FIN_PREFIX);
  const raw = at >= 0 ? note.slice(at + FIN_PREFIX.length).replace(/\.\s*$/, '').split(/;\s*/) : [];
  const reasons = [...new Set(raw.map(plainReason).filter((x): x is string => !!x))];
  const why = reasons.length
    ? `This project uses a set-up the live workbook does not support yet: ${reasons.join('; ')}.`
    : 'This project uses a set-up the live workbook does not support yet.';
  return {
    reasons,
    message: `The live workbook is not available for this project. ${why} ${VALUES_OFFER}`,
  };
}
