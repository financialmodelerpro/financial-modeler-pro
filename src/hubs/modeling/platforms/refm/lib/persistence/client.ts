/**
 * REFM persistence: browser-side fetch wrappers (Phase M1.6/4).
 *
 * Thin typed-fetch around the /api/refm/projects/* routes. Used by the
 * Module 1 store auto-save subscriber and by RealEstatePlatform.tsx
 * for project-list / load / save / duplicate flows.
 *
 * Each function returns either { data, error: null } or
 * { data: null, error }. Errors are surfaced to the caller; the layer
 * above decides whether to toast / retry / fall back to cache.
 *
 * No hard dependency on a specific UI, the store subscriber consumes
 * these directly and bubbles failures through its own state.
 */

import type {
  ProjectStatus,
  RefmProjectListItem,
  RefmProjectVersionRow,
  RefmProjectVersionListItem,
  ProjectChangeDTO,
} from './types';
import type { HydrateSnapshot } from '../state/module1-store';
import type { Party } from '../parties';
import type { FundTerms } from '../fundTerms';
import type { ReportInputs } from '../reportInputs';
import type { Deck } from '../reports/deck/types';

// Project metadata returned by the API. Same as RefmProjectListItem
// but kept as its own alias so consumers don't need to know the
// internal shape.
export type RefmProjectSummary = RefmProjectListItem;
// Re-exported so a consumer holding a version list does not have to reach past
// the client into ./types for its element shape.
export type { RefmProjectVersionListItem };

/**
 * A version-list row as the VERSIONS ROUTE returns it: the stored row plus the
 * author's resolved display NAME.
 *
 * `author` is decorated by the route, not stored, because `created_by` holds a
 * uuid and a uuid is not something a reader can use. Null means the author is
 * unknown, which covers all three ways that happens and deliberately does not
 * distinguish them: the row predates migration 230, the author deleted their
 * account (the FK nulls it), or the name could not be resolved. In every case
 * the honest answer to "who saved this" is "we do not know", never the project
 * owner.
 */
export type RefmVersionListRow = RefmProjectVersionListItem & { author?: string | null };

export interface FetchResult<T> {
  data:  T | null;
  error: string | null;
  /** Machine-readable error code from the route's JSON body when it sends one
   *  (ARCHIVE_NOT_ALLOWED, CAP_REACHED, PROJECT_ARCHIVED, READ_ONLY_GRACE...).
   *  Additive and optional: callers that only read `error` are unaffected, but
   *  a caller no longer has to pattern-match a human sentence to tell "your
   *  plan does not include this" from "you are at your limit". */
  code?: string;
}

// ── Internal helpers ────────────────────────────────────────────────────────
async function readError(res: Response): Promise<{ error: string; code?: string }> {
  try {
    const body = await res.json();
    const code = body && typeof body.code === 'string' ? body.code : undefined;
    if (body && typeof body.error === 'string') return { error: body.error, code };
    if (code) return { error: `${res.status} ${res.statusText}`, code };
  } catch { /* empty / non-json body */ }
  return { error: `${res.status} ${res.statusText}` };
}

async function callJson<T>(
  url: string,
  init?: RequestInit,
): Promise<FetchResult<T>> {
  let res: Response;
  try {
    res = await fetch(url, {
      credentials: 'same-origin',
      ...init,
      headers: {
        'Content-Type': 'application/json',
        ...(init?.headers ?? {}),
      },
    });
  } catch (e) {
    return { data: null, error: e instanceof Error ? e.message : 'Network error' };
  }
  if (!res.ok) {
    const { error, code } = await readError(res);
    return { data: null, error, code };
  }
  try {
    const body = (await res.json()) as T;
    return { data: body, error: null };
  } catch (e) {
    return { data: null, error: e instanceof Error ? e.message : 'Invalid JSON response' };
  }
}

// ── Project list / create ───────────────────────────────────────────────────
export function listProjects(): Promise<FetchResult<{ projects: RefmProjectSummary[] }>> {
  return callJson('/api/refm/projects', { method: 'GET' });
}

export interface CreateProjectInput {
  name:      string;
  snapshot:  HydrateSnapshot;
  location?: string | null;
  status?:   ProjectStatus;
  assetMix?: string[];
}

export function createProject(
  input: CreateProjectInput,
): Promise<FetchResult<{ project: RefmProjectSummary; version: RefmProjectVersionRow }>> {
  return callJson('/api/refm/projects', {
    method: 'POST',
    body:   JSON.stringify(input),
  });
}

// ── Single project: load / patch / delete / duplicate ──────────────────────
export function loadProject(
  projectId: string,
): Promise<FetchResult<{ project: RefmProjectSummary; version: RefmProjectVersionRow | null }>> {
  return callJson(`/api/refm/projects/${encodeURIComponent(projectId)}`, { method: 'GET' });
}

export interface PatchProjectInput {
  name?:     string;
  location?: string | null;
  status?:   ProjectStatus;
  assetMix?: string[];
  archived?: boolean;
  /** The urgent flag. A metadata edit, so the route rejects it on an archived
   *  project like any other. */
  priority?: boolean;
}

// NOTE: there is deliberately no sortOrder here. Manual order is a property of
// a whole status GROUP, not of one card, so it goes through reorderProjects
// below. Offering it as a single-card patch would let a card be given a
// position that contradicts its neighbours.

export function patchProject(
  projectId: string,
  patch: PatchProjectInput,
): Promise<FetchResult<{ project: RefmProjectSummary }>> {
  return callJson(`/api/refm/projects/${encodeURIComponent(projectId)}`, {
    method: 'PATCH',
    body:   JSON.stringify(patch),
  });
}

/**
 * Persist a manual card order for ONE status group.
 *
 * Sends the whole group's dense 0..n-1 assignment, which is what the grid is
 * displaying, rather than the single moved card. The server stores it verbatim,
 * so there is no second derivation of the order that could disagree with the
 * first. `updated` comes back so a partially applied batch is visible.
 */
export function reorderProjects(
  order: ReadonlyArray<{ id: string; sortOrder: number }>,
): Promise<FetchResult<{ updated: number; requested: number }>> {
  return callJson('/api/refm/projects/reorder', {
    method: 'POST',
    body:   JSON.stringify({ order }),
  });
}

export function deleteProject(
  projectId: string,
): Promise<FetchResult<{ ok: true }>> {
  return callJson(`/api/refm/projects/${encodeURIComponent(projectId)}`, { method: 'DELETE' });
}

export function duplicateProject(
  projectId: string,
): Promise<FetchResult<{ project: RefmProjectSummary; version: RefmProjectVersionRow }>> {
  return callJson(`/api/refm/projects/${encodeURIComponent(projectId)}/duplicate`, {
    method: 'POST',
  });
}

// ── Version history ─────────────────────────────────────────────────────────
export function listVersions(
  projectId: string,
): Promise<FetchResult<{ versions: RefmProjectVersionListItem[] }>> {
  return callJson(`/api/refm/projects/${encodeURIComponent(projectId)}/versions`, { method: 'GET' });
}

// ── Change log (append-only, migration 234) ─────────────────────────────────
// Read only. There is no write helper on purpose: rows are appended by the
// save path on the server, and a log a client can write into is not an audit
// trail.
export function listChanges(
  projectId: string,
  limit?: number,
): Promise<FetchResult<{ available: boolean; changes: ProjectChangeDTO[]; limit: number; truncated: boolean }>> {
  const q = limit ? `?limit=${encodeURIComponent(String(limit))}` : '';
  return callJson(`/api/refm/projects/${encodeURIComponent(projectId)}/changes${q}`, { method: 'GET' });
}

export interface SaveVersionInput {
  snapshot:       HydrateSnapshot;
  label?:         string | null;
  assetMix?:      string[];
  // 2026-06-01 (auto-naming + required comment). versionLabel is the X.Y
  // string, taskName the user task label, comment the required change note.
  versionLabel?:  string | null;
  taskName?:      string | null;
  comment?:       string | null;
  // 2026-05-31 (Phase M-Versioning): when provided, the server loads
  // this version's snapshot and pre-computes change_log against it
  // so the version-history UI can render the diff without a second
  // round-trip. Passing `null` is the explicit "first version, no
  // base" case.
  baseVersionId?: string | null;
}

export function saveVersion(
  projectId: string,
  input: SaveVersionInput,
): Promise<FetchResult<{ project: RefmProjectSummary; version: RefmProjectVersionRow }>> {
  return callJson(`/api/refm/projects/${encodeURIComponent(projectId)}/versions`, {
    method: 'POST',
    body:   JSON.stringify(input),
  });
}

// 2026-05-31 (Phase M-Versioning). In-place version update. Used by
// the session-based auto-save: once the user has named the version
// they're editing, every keystroke PATCHes the same row instead of
// inserting a new one. Server re-computes change_log against the
// row's existing base_version_id on every patch.
export interface PatchVersionInput {
  snapshot?: HydrateSnapshot;
  label?:    string | null;
  assetMix?: string[];
  // 2026-06-03: let an in-place PATCH also apply the auto-naming metadata,
  // so an auto-started session (default "Edits ..." label) can be promoted
  // to a properly named + commented version without inserting a new row.
  versionLabel?: string | null;
  taskName?:     string | null;
  comment?:      string | null;
}

export function patchVersion(
  projectId: string,
  versionId: string,
  input: PatchVersionInput,
): Promise<FetchResult<{ version: RefmProjectVersionRow }>> {
  return callJson(
    `/api/refm/projects/${encodeURIComponent(projectId)}/versions/${encodeURIComponent(versionId)}`,
    {
      method: 'PATCH',
      body:   JSON.stringify(input),
    },
  );
}

export function loadVersion(
  projectId: string,
  versionId: string,
): Promise<FetchResult<{ version: RefmProjectVersionRow }>> {
  return callJson(
    `/api/refm/projects/${encodeURIComponent(projectId)}/versions/${encodeURIComponent(versionId)}`,
    { method: 'GET' },
  );
}

// ── Parties (Module 1, migration 190) ────────────────────────────────────────
// Identity-only per-project parties. Independent of the version snapshot, so
// these do not touch the model engine or the save/version flow.

export function listParties(projectId: string): Promise<FetchResult<{ parties: Party[] }>> {
  return callJson(`/api/refm/projects/${encodeURIComponent(projectId)}/parties`, { method: 'GET' });
}

// ── Fund terms (fund layer Step 2, migration 208) ───────────────────────────
// The durable per-project store behind the M1 Fund Terms tab. The ENGINE reads
// the mirrored copy in the version snapshot (Project.fundTerms), not this, so a
// saved version reproduces the terms it was computed with. `available:false`
// means migration 208 is outstanding and the tab says so rather than failing.

export function getFundTerms(projectId: string): Promise<FetchResult<{
  terms: FundTerms; saved: boolean; available: boolean; extended?: boolean;
}>> {
  return callJson(`/api/refm/projects/${encodeURIComponent(projectId)}/fund-terms`, { method: 'GET' });
}

export function saveFundTerms(projectId: string, terms: FundTerms): Promise<FetchResult<{
  terms: FundTerms; saved: boolean; available: boolean; extended?: boolean;
}>> {
  return callJson(`/api/refm/projects/${encodeURIComponent(projectId)}/fund-terms`, {
    method: 'PUT',
    body:   JSON.stringify({ terms }),
  });
}

export function createParty(
  projectId: string,
  input: { name: string; identifier?: string | null; roles: string[] },
): Promise<FetchResult<{ party: Party }>> {
  return callJson(`/api/refm/projects/${encodeURIComponent(projectId)}/parties`, {
    method: 'POST',
    body:   JSON.stringify(input),
  });
}

export function updateParty(
  projectId: string,
  input: { partyId: string; name?: string; identifier?: string | null; roles?: string[] },
): Promise<FetchResult<{ party: Party }>> {
  return callJson(`/api/refm/projects/${encodeURIComponent(projectId)}/parties`, {
    method: 'PATCH',
    body:   JSON.stringify(input),
  });
}

export function deleteParty(projectId: string, partyId: string): Promise<FetchResult<{ ok: true }>> {
  return callJson(
    `/api/refm/projects/${encodeURIComponent(projectId)}/parties?partyId=${encodeURIComponent(partyId)}`,
    { method: 'DELETE' },
  );
}

// ── Report inputs (Module 7 Reports, migration 191) ──────────────────────────
// Per-project presentation / narrative config for the report builder. The engine
// never reads it; financials are pulled live from the snapshot at render time.
// `inputs` is null when none are saved yet (the tab then uses defaults).

export function getReportInputs(projectId: string): Promise<FetchResult<{ inputs: ReportInputs | null }>> {
  return callJson(`/api/refm/projects/${encodeURIComponent(projectId)}/report-inputs`, { method: 'GET' });
}

export function saveReportInputs(projectId: string, inputs: ReportInputs): Promise<FetchResult<{ inputs: ReportInputs }>> {
  return callJson(`/api/refm/projects/${encodeURIComponent(projectId)}/report-inputs`, {
    method: 'PUT',
    body:   JSON.stringify(inputs),
  });
}

// ── Report deck (Module 7 IC Presentation Builder, migration 199) ────────────
// The slide document. `deck` is null when the project has none saved yet and the
// builder seeds one from the templates. `canSave` is false when migration 199 is
// outstanding, so the tab can say so plainly rather than failing a save with a
// raw Postgres error.

export function getReportDeck(projectId: string): Promise<FetchResult<{
  deck: Deck | null; canSave: boolean;
  /** The saved version the returned deck IS (the last one saved), or null when
   *  the project has no version history yet. */
  openedVersion?: DeckVersionListItem | null;
  /** False when migration 207 is outstanding, so a Save keeps to the single
   *  working deck instead of trying to create a version. */
  versionsAvailable?: boolean;
}>> {
  return callJson(`/api/refm/projects/${encodeURIComponent(projectId)}/report-deck`, { method: 'GET' });
}

export function saveReportDeck(projectId: string, deck: Deck): Promise<FetchResult<{ ok: true }>> {
  return callJson(`/api/refm/projects/${encodeURIComponent(projectId)}/report-deck`, {
    method: 'PUT',
    body:   JSON.stringify({ deck }),
  });
}

/** Drop the saved deck. The next load reseeds from the templates. */
export function resetReportDeck(projectId: string): Promise<FetchResult<{ ok: true }>> {
  return callJson(`/api/refm/projects/${encodeURIComponent(projectId)}/report-deck`, { method: 'DELETE' });
}

// ── Named deck versions (migration 207) ─────────────────────────────────────
// The deck equivalent of project versioning: several named presentations saved
// separately per project. `available` is false when 207 is outstanding, and the
// builder then hides the version controls instead of failing.

export interface DeckVersionListItem {
  id: string;
  versionNumber: number;
  label: string | null;
  comment: string | null;
  createdAt: string | null;
}

export function listReportDeckVersions(projectId: string): Promise<FetchResult<{
  versions: DeckVersionListItem[]; currentVersionId: string | null; available: boolean;
}>> {
  return callJson(`/api/refm/projects/${encodeURIComponent(projectId)}/report-deck/versions`, { method: 'GET' });
}

/** Save the deck as a NEW version (this also saves the working deck).
 *  `label` is optional: omitted or blank, the server auto-names the version
 *  ({Project}_Presentation_v1.3_08032026), so an ordinary Save never has to
 *  stop and ask the user for a name. */
export function saveReportDeckVersion(
  projectId: string, deck: Deck, label?: string | null, comment?: string | null,
): Promise<FetchResult<{ version: DeckVersionListItem }>> {
  return callJson(`/api/refm/projects/${encodeURIComponent(projectId)}/report-deck/versions`, {
    method: 'POST',
    body:   JSON.stringify({ deck, label: label ?? null, comment: comment ?? null }),
  });
}

/** Load one saved version's deck document. */
export function getReportDeckVersion(projectId: string, versionId: string): Promise<FetchResult<{ deck: Deck }>> {
  return callJson(
    `/api/refm/projects/${encodeURIComponent(projectId)}/report-deck/versions/${encodeURIComponent(versionId)}`,
    { method: 'GET' },
  );
}

/** Overwrite a saved version in place (the deck's "update this version"). Saves
 *  the working deck in the same call; version number and date are preserved. */
export function updateReportDeckVersion(
  projectId: string, versionId: string, deck: Deck, label?: string | null,
): Promise<FetchResult<{ version: DeckVersionListItem }>> {
  return callJson(
    `/api/refm/projects/${encodeURIComponent(projectId)}/report-deck/versions/${encodeURIComponent(versionId)}`,
    { method: 'PATCH', body: JSON.stringify({ deck, label: label ?? null }) },
  );
}

export function deleteReportDeckVersion(projectId: string, versionId: string): Promise<FetchResult<{ ok: true }>> {
  return callJson(
    `/api/refm/projects/${encodeURIComponent(projectId)}/report-deck/versions/${encodeURIComponent(versionId)}`,
    { method: 'DELETE' },
  );
}

/** Render the deck to an editable .pptx or a shareable .pdf, SERVER-SIDE. The
 *  builders import node-only libs, so the client posts the deck + the already
 *  resolved ICReportModel (no recompute) and gets a binary Blob back. `model` is
 *  the ICReportModel the canvas rendered; scale/currency rebuild the formatter. */
export async function exportReportDeck(
  projectId: string,
  args: { deck: Deck; model: unknown; scale: 'millions' | 'thousands'; currency: string; format: 'pptx' | 'pdf'; fileName?: string },
): Promise<FetchResult<Blob>> {
  let res: Response;
  try {
    res = await fetch(`/api/refm/projects/${encodeURIComponent(projectId)}/report-deck/export`, {
      method: 'POST',
      credentials: 'same-origin',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(args),
    });
  } catch (e) {
    return { data: null, error: e instanceof Error ? e.message : 'Network error' };
  }
  if (!res.ok) {
    const { error, code } = await readError(res);
    return { data: null, error, code };
  }
  try {
    return { data: await res.blob(), error: null };
  } catch (e) {
    return { data: null, error: e instanceof Error ? e.message : 'Could not read the exported file' };
  }
}

/**
 * Draft ONE IC narrative field from the project's computed figures (AI Unit 7).
 *
 * Minimal trigger. The Generate buttons, the quota display, and the
 * apply-or-discard confirmation are Unit 8; this is the wire they call.
 *
 * `model` is the ICReportModel the deck already assembled, posted as-is so the
 * server never recomputes. The response is a DRAFT: it carries `applied: false`
 * and nothing has been saved. Applying it is a separate, user-confirmed write
 * through saveReportInputs.
 */
export function generateIcNarrative(
  projectId: string,
  args: {
    field: 'executiveSummary' | 'recommendation' | 'risks' | 'returnsCommentary' | 'exitCommentary' | 'scenarioTakeaway';
    model: unknown;
    scale?: 'millions' | 'thousands';
    currency?: string;
    includeSeries?: boolean;
  },
): Promise<FetchResult<{
  applied: false;
  field: string;
  label: string;
  targetField: string;
  draft: string;
  risks?: Array<{ risk: string; mitigant: string }>;
  audit: { ok: boolean; checked: number; supported: number; rounded: number; unsupported: Array<{ raw: string; index: number }>; summary: string };
  meter: { used: number; cap: number; remaining: number; planKey: string; periodStart: string };
  usage: { inputTokens: number | null; outputTokens: number | null };
  model: string;
  elapsedMs: number;
}>> {
  return callJson(`/api/refm/projects/${encodeURIComponent(projectId)}/ai/ic-narrative`, {
    method: 'POST',
    body: JSON.stringify(args),
  });
}

/**
 * Draft ANY block from a free instruction.
 *
 * Same endpoint, same metered feature, same allowance: the free-form mode is a
 * different way to ask, not a second product. It is opted into by `mode`, so a
 * caller that knows nothing about it is unaffected.
 *
 * A REFUSAL comes back 200 with `refused: true` and an EMPTY draft. That is a
 * real answer (the figures cannot support the instruction), not an error, and
 * the empty draft is what stops the UI presenting it as text to apply.
 */
export function generateIcFreeform(
  projectId: string,
  args: {
    instruction: string;
    block: { kind: string; slideTitle: string; current: string; name?: string };
    model: unknown;
    scale?: 'millions' | 'thousands';
    currency?: string;
    includeSeries?: boolean;
  },
): Promise<FetchResult<{
  applied: false;
  kind: 'freeform';
  label: string;
  instruction: string;
  draft: string;
  refused: boolean;
  refusalReason?: string;
  audit: { ok: boolean; checked: number; supported: number; rounded: number; unsupported: Array<{ raw: string; index: number }>; summary: string };
  meter: { used: number; cap: number; remaining: number; planKey: string; periodStart: string };
  usage: { inputTokens: number | null; outputTokens: number | null };
  model: string;
  elapsedMs: number;
}>> {
  return callJson(`/api/refm/projects/${encodeURIComponent(projectId)}/ai/ic-narrative`, {
    method: 'POST',
    body: JSON.stringify({ ...args, mode: 'freeform' }),
  });
}

/** IC narrative availability + this month's remaining allowance (AI Unit 8).
 *  Read-only and free: no credit is spent, so the UI can render button state
 *  without anyone paying to find out. The server re-decides on generate. */
export function getIcNarrativeStatus(projectId: string): Promise<FetchResult<{
  available: boolean;
  blockedReason: string | null;
  enabled: boolean;
  configured: boolean;
  readOnly: string | null;
  planKey: string | null;
  cap: number | null;
  used: number | null;
  remaining: number | null;
  periodStart: string;
  fields: Array<{ field: string; label: string; section: string; targetField: string }>;
}>> {
  return callJson(`/api/refm/projects/${encodeURIComponent(projectId)}/ai/ic-narrative`, { method: 'GET' });
}
