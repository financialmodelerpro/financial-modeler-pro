/**
 * deck-server.ts (REFM Module 7, IC Presentation Builder: server persistence)
 *
 * Load and save the per-project deck document. One row per project, the whole
 * Deck as jsonb.
 *
 * Schema tolerance, per the platform convention: prod lags the repo, so a read
 * against a table that does not exist yet returns { deck: null, error: null }
 * rather than throwing. The tab then seeds an in-memory deck from the templates
 * and stays fully usable for viewing and exporting; only Save reports that
 * migration 199 is outstanding. That keeps a deploy-before-migrate window safe
 * instead of a hard 500 on the Reports tab.
 *
 * Validation is deliberate rather than trusting the client blob: coerceDeck
 * rebuilds the document field by field, so a hand-edited PUT cannot inject
 * arbitrary jsonb, and an object missing geometry cannot land on the canvas as
 * NaN. Unknown object types are dropped, not rendered.
 *
 * No em dashes in this file.
 */

import { getServerClient } from '@/src/core/db/supabase';
import {
  DECK_SCHEMA_VERSION, SLIDE_W, SLIDE_H,
  type Deck, type DeckBranding, type DeckObject, type DeckObjectType, type DeckSettings, type Slide,
} from '../reports/deck/types';
import { DEFAULT_BRANDING } from '../reports/deck/theme';
import { autoDeckVersionName } from '../reports/deck/versionNaming';

function isMissingTable(err: { code?: string | null; message?: string | null } | null): boolean {
  if (!err) return false;
  return err.code === '42P01' || /relation .* does not exist/i.test(err.message ?? '');
}

function isMissingColumn(err: { code?: string | null; message?: string | null } | null): boolean {
  if (!err) return false;
  return err.code === '42703' || /column .* does not exist/i.test(err.message ?? '');
}

const VERSION_MIGRATION_HINT =
  'Saved presentation versions are not available yet (migration 207_refm_report_deck_versions.sql has not been applied). Your presentation still saves normally.';

const MIGRATION_HINT =
  'The presentation deck table is not available yet (migration 199_report_decks.sql has not been applied). Ask an admin to apply it; your deck cannot be saved until then.';

// ── Coercion ────────────────────────────────────────────────────────────────

const str = (v: unknown, fallback = ''): string => (typeof v === 'string' ? v : fallback);
const bool = (v: unknown, fallback = false): boolean => (typeof v === 'boolean' ? v : fallback);
const numOr = (v: unknown, fallback: number): number => (typeof v === 'number' && Number.isFinite(v) ? v : fallback);
const nullableStr = (v: unknown): string | null => (typeof v === 'string' ? v : null);

const OBJECT_TYPES: ReadonlySet<string> = new Set<DeckObjectType>([
  'text', 'bullets', 'kpi', 'chart', 'table', 'image', 'shape', 'divider', 'gantt', 'heatmap', 'riskMatrix', 'toc',
]);

/** Rebuild one object, preserving its type-specific payload but pinning the
 *  geometry every renderer depends on. Returns null for an unknown type. */
function coerceObject(raw: unknown): DeckObject | null {
  if (!raw || typeof raw !== 'object') return null;
  const o = raw as Record<string, unknown>;
  const type = str(o.type);
  if (!OBJECT_TYPES.has(type)) return null;
  if (!str(o.id)) return null;

  // Geometry is load-bearing: a NaN here paints an invisible object the user
  // cannot select or find. Clamp rather than trust.
  const geom = {
    x: numOr(o.x, 0),
    y: numOr(o.y, 0),
    w: Math.max(8, Math.min(numOr(o.w, 100), SLIDE_W * 2)),
    h: Math.max(8, Math.min(numOr(o.h, 40), SLIDE_H * 2)),
    rot: numOr(o.rot, 0) % 360,
  };

  // The type-specific payload rides through as-is: it is authored by our own
  // templates and property panel, and the binding keys are re-validated at
  // render time by the registry (an unknown key renders the unlinked state).
  const rest = { ...o };
  delete rest.x; delete rest.y; delete rest.w; delete rest.h; delete rest.rot;

  return { ...(rest as object), ...geom } as DeckObject;
}

function coerceSlide(raw: unknown): Slide | null {
  if (!raw || typeof raw !== 'object') return null;
  const s = raw as Record<string, unknown>;
  const id = str(s.id);
  if (!id) return null;
  const chrome = str(s.chrome, 'content');
  return {
    id,
    title: str(s.title, 'Slide'),
    chrome: (['content', 'cover', 'section', 'blank'].includes(chrome) ? chrome : 'content') as Slide['chrome'],
    finding: str(s.finding),
    background: nullableStr(s.background),
    hidden: bool(s.hidden),
    locked: bool(s.locked),
    notes: str(s.notes),
    templateId: nullableStr(s.templateId),
    objects: Array.isArray(s.objects) ? s.objects.map(coerceObject).filter((o): o is DeckObject => o !== null) : [],
  };
}

function coerceBranding(raw: unknown): DeckBranding {
  const b = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>;
  return {
    logoUrl: nullableStr(b.logoUrl),
    companyName: str(b.companyName, DEFAULT_BRANDING.companyName),
    confidentialLabel: str(b.confidentialLabel, DEFAULT_BRANDING.confidentialLabel),
    headerText: str(b.headerText, DEFAULT_BRANDING.headerText),
    footerText: str(b.footerText, DEFAULT_BRANDING.footerText),
    primary: nullableStr(b.primary),
    secondary: nullableStr(b.secondary),
    fontHeading: str(b.fontHeading, DEFAULT_BRANDING.fontHeading),
    fontBody: str(b.fontBody, DEFAULT_BRANDING.fontBody),
    showSlideNumbers: bool(b.showSlideNumbers, true),
    whiteLabel: bool(b.whiteLabel, false),
  };
}

function coerceSettings(raw: unknown, fallbackAsOf: string): DeckSettings {
  const s = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>;
  return {
    deckCase: s.deckCase === 'active' ? 'active' : 'management',
    moneyScale: s.moneyScale === 'thousands' ? 'thousands' : 'millions',
    asOf: str(s.asOf, fallbackAsOf),
  };
}

/** Rebuild a Deck from untrusted jsonb. Exported so the PUT route and the loader
 *  validate through exactly the same path. */
export function coerceDeck(raw: unknown, projectId: string, fallbackAsOf: string): Deck | null {
  if (!raw || typeof raw !== 'object') return null;
  const d = raw as Record<string, unknown>;
  const slides = Array.isArray(d.slides) ? d.slides.map(coerceSlide).filter((s): s is Slide => s !== null) : [];
  if (!slides.length) return null;
  return {
    schemaVersion: numOr(d.schemaVersion, DECK_SCHEMA_VERSION),
    projectId,
    title: str(d.title, 'Investment Committee'),
    slides,
    branding: coerceBranding(d.branding),
    settings: coerceSettings(d.settings, fallbackAsOf),
    updatedAt: nullableStr(d.updatedAt),
  };
}

// ── Read / write ────────────────────────────────────────────────────────────

/**
 * The saved deck, or null when the project has none yet (the caller then seeds
 * from templates). A missing TABLE is not an error: it is a pre-migration
 * state, and the tab degrades to an unsaveable in-memory deck.
 *
 * Opening a project now opens the LAST SAVED VERSION rather than an unnamed
 * working document. `resolveOpenDeck` below decides which of the two rows that
 * is; this function stays the single read the Presentation tab makes.
 */
export async function getDeck(projectId: string, fallbackAsOf: string): Promise<{
  deck: Deck | null; error: string | null; canSave: boolean;
  openedVersion: DeckVersionListItem | null; versionsAvailable: boolean;
}> {
  const sb = getServerClient();
  const { data, error } = await sb
    .from('refm_report_decks')
    .select('deck, updated_at, current_version_id')
    .eq('project_id', projectId)
    .maybeSingle();

  if (error) {
    // A missing COLUMN means 207 is half-applied: retry without the pointer so
    // the deck still loads (199-only databases keep working).
    if (isMissingColumn(error)) {
      const retry = await sb.from('refm_report_decks').select('deck, updated_at').eq('project_id', projectId).maybeSingle();
      if (retry.error || !retry.data) {
        if (retry.error && isMissingTable(retry.error)) return { deck: null, error: null, canSave: false, openedVersion: null, versionsAvailable: false };
        return { deck: null, error: retry.error?.message ?? null, canSave: true, openedVersion: null, versionsAvailable: false };
      }
      const r = retry.data as { deck: unknown; updated_at: string | null };
      const d = coerceDeck(r.deck, projectId, fallbackAsOf);
      if (d) d.updatedAt = r.updated_at;
      return { deck: d, error: null, canSave: true, openedVersion: null, versionsAvailable: false };
    }
    if (isMissingTable(error)) return { deck: null, error: null, canSave: false, openedVersion: null, versionsAvailable: false };
    return { deck: null, error: error.message, canSave: true, openedVersion: null, versionsAvailable: false };
  }

  const row = (data ?? null) as { deck: unknown; updated_at: string | null; current_version_id: string | null } | null;
  const working = row ? coerceDeck(row.deck, projectId, fallbackAsOf) : null;
  if (working) working.updatedAt = row?.updated_at ?? null;

  const resolved = await resolveOpenDeck(projectId, working, row?.updated_at ?? null, row?.current_version_id ?? null, fallbackAsOf);
  return {
    deck: resolved.deck, error: null, canSave: true,
    openedVersion: resolved.openedVersion, versionsAvailable: resolved.versionsAvailable,
  };
}

/**
 * Which document a fresh open should show, and which saved version it is.
 *
 * The rule is "whatever was saved last", which is what a user means by the
 * presentation they left open:
 *
 *   * Normally the newest version row wins. Every save path writes a version
 *     (in place, or a new auto-named one), so this is the document the user
 *     last pressed Save on.
 *   * The working row wins when its `updated_at` is strictly NEWER than that
 *     version's `created_at`. Two cases reach this: a deck saved before this
 *     change, when a plain working save left no version behind, and an
 *     in-place version update, whose row keeps its original `created_at` while
 *     the working row is rewritten. Both hold the same or newer content, so
 *     preferring the working row here can never show stale slides.
 *   * When the working row wins, the version it is LINKED to (if any) is still
 *     reported, so the editor can name what is open.
 *
 * Version identity is metadata only: the deck document itself is unchanged, so
 * nothing downstream (render, export, bindings) can behave differently.
 */
/**
 * The open rule, as a pure decision so it can be tested without a database.
 *
 * True = show the newest saved VERSION. False = show the working row.
 *
 * The version wins by default, including when either timestamp is unreadable:
 * the whole point of the change is that a project opens on its last saved
 * version, so an unparseable date must not silently fall back to the old
 * behaviour. Only a working row that is demonstrably NEWER (a deck saved before
 * versioning existed, or an in-place update, which rewrites the working row but
 * leaves the version's created_at alone) keeps its place.
 */
export function shouldOpenVersion(args: {
  hasWorkingDeck: boolean; workingUpdatedAt: string | null; versionCreatedAt: string | null;
}): boolean {
  if (!args.hasWorkingDeck) return true;
  const workingMs = args.workingUpdatedAt ? Date.parse(args.workingUpdatedAt) : NaN;
  const versionMs = args.versionCreatedAt ? Date.parse(args.versionCreatedAt) : NaN;
  if (!Number.isFinite(workingMs) || !Number.isFinite(versionMs)) return true;
  return !(workingMs > versionMs);
}

async function resolveOpenDeck(
  projectId: string,
  working: Deck | null,
  workingUpdatedAt: string | null,
  currentVersionId: string | null,
  fallbackAsOf: string,
): Promise<{ deck: Deck | null; openedVersion: DeckVersionListItem | null; versionsAvailable: boolean }> {
  const sb = getServerClient();
  const { data, error } = await sb
    .from('refm_report_deck_versions')
    .select('id, version_number, label, comment, created_at, deck')
    .eq('project_id', projectId)
    .order('version_number', { ascending: false })
    .limit(1)
    .maybeSingle();

  // No version history reachable (207 outstanding, or none saved yet): the
  // working deck is all there is, exactly as before this change.
  //
  // `versionsAvailable` separates those two cases for the caller. It is what
  // tells the editor whether a Save can create a version at all: on a database
  // without 207 the deck falls back to the single working row it has always
  // had, rather than reporting a failed version save.
  if (error) return { deck: working, openedVersion: null, versionsAvailable: !isMissingTable(error) };
  if (!data) return { deck: working, openedVersion: null, versionsAvailable: true };

  const v = data as {
    id: string; version_number: number; label: string | null; comment: string | null;
    created_at: string | null; deck: unknown;
  };
  const meta: DeckVersionListItem = {
    id: v.id, versionNumber: v.version_number, label: v.label, comment: v.comment, createdAt: v.created_at,
  };

  if (!shouldOpenVersion({ hasWorkingDeck: !!working, workingUpdatedAt, versionCreatedAt: v.created_at })) {
    // Report the linked version when there is one, so an in-place save still
    // opens under its own name rather than looking unversioned.
    const linked = currentVersionId === v.id ? meta : currentVersionId ? await getDeckVersionMeta(projectId, currentVersionId) : null;
    return { deck: working, openedVersion: linked, versionsAvailable: true };
  }

  const versionDeck = coerceDeck(v.deck, projectId, fallbackAsOf);
  if (!versionDeck) return { deck: working, openedVersion: null, versionsAvailable: true };
  versionDeck.updatedAt = v.created_at;
  return { deck: versionDeck, openedVersion: meta, versionsAvailable: true };
}

/** One version's metadata (no payload). Tolerant: a missing table or row is
 *  simply "no version", never an error the tab has to render. */
async function getDeckVersionMeta(projectId: string, versionId: string): Promise<DeckVersionListItem | null> {
  const sb = getServerClient();
  const { data, error } = await sb
    .from('refm_report_deck_versions')
    .select('id, version_number, label, comment, created_at')
    .eq('project_id', projectId)
    .eq('id', versionId)
    .maybeSingle();
  if (error || !data) return null;
  const r = data as { id: string; version_number: number; label: string | null; comment: string | null; created_at: string | null };
  return { id: r.id, versionNumber: r.version_number, label: r.label, comment: r.comment, createdAt: r.created_at };
}

export async function upsertDeck(projectId: string, deck: Deck): Promise<{ error: string | null }> {
  const sb = getServerClient();
  const { error } = await sb
    .from('refm_report_decks')
    .upsert(
      {
        project_id: projectId,
        deck: { ...deck, projectId, updatedAt: null },
        schema_version: deck.schemaVersion ?? DECK_SCHEMA_VERSION,
        updated_at: new Date().toISOString(),
      },
      { onConflict: 'project_id' },
    );

  if (error) {
    if (isMissingTable(error)) return { error: MIGRATION_HINT };
    return { error: error.message };
  }
  return { error: null };
}

export async function deleteDeck(projectId: string): Promise<{ error: string | null }> {
  const sb = getServerClient();
  const { error } = await sb.from('refm_report_decks').delete().eq('project_id', projectId);
  if (error && !isMissingTable(error)) return { error: error.message };
  return { error: null };
}

// ── Named deck versions (migration 207) ─────────────────────────────────────
//
// Mirrors the project version store in server.ts: append-only rows, a monotonic
// per-project version_number computed MAX+1 in this layer (the unique index is
// what actually enforces it under concurrency), and a pointer column on the
// working row saying which version it corresponds to.
//
// refm_report_decks stays the LIVE working deck. Saving a version copies the
// working deck into a new row; loading one copies that row's jsonb back over
// the working deck. A load therefore never consumes the history it came from.
//
// Every read is tolerant of migration 207 being absent, so the Presentation tab
// keeps working (without versioning) on a database that predates it.

export interface DeckVersionListItem {
  id: string;
  versionNumber: number;
  label: string | null;
  comment: string | null;
  createdAt: string | null;
}

/** Whether the deck-version table is reachable. `available: false` means
 *  migration 207 has not been applied; the caller hides the version UI. */
export async function listDeckVersions(projectId: string): Promise<{
  versions: DeckVersionListItem[]; currentVersionId: string | null; available: boolean; error: string | null;
}> {
  const sb = getServerClient();
  const { data, error } = await sb
    .from('refm_report_deck_versions')
    .select('id, version_number, label, comment, created_at')
    .eq('project_id', projectId)
    .order('version_number', { ascending: false });

  if (error) {
    if (isMissingTable(error)) return { versions: [], currentVersionId: null, available: false, error: null };
    return { versions: [], currentVersionId: null, available: true, error: error.message };
  }

  // The pointer lives on the working row and is read separately so a missing
  // COLUMN (207 partially applied) degrades to "no current version" rather than
  // failing the whole list.
  let currentVersionId: string | null = null;
  const cur = await sb.from('refm_report_decks').select('current_version_id').eq('project_id', projectId).maybeSingle();
  if (!cur.error) currentVersionId = (cur.data as { current_version_id: string | null } | null)?.current_version_id ?? null;

  const rows = (data ?? []) as Array<{ id: string; version_number: number; label: string | null; comment: string | null; created_at: string | null }>;
  return {
    versions: rows.map((r) => ({
      id: r.id, versionNumber: r.version_number, label: r.label, comment: r.comment, createdAt: r.created_at,
    })),
    currentVersionId,
    available: true,
    error: null,
  };
}

/**
 * MAX(version_number) + 1 for this project, plus the existing names the
 * auto-namer needs.
 *
 * One query serves both: the integer is what the unique index enforces, while
 * the labels carry the human X.Y sequence (the model versions store their
 * label inside the name the same way, so the two schemes roll over
 * identically). Rows are read newest-first and the labels are handed on with
 * their dates, because `nextDeckVersionLabel` advances from the LATEST version
 * by date rather than the maximum, so deleting a version does not refill its
 * number.
 */
async function nextDeckVersionNumber(projectId: string): Promise<{
  next: number; existing: Array<{ label: string | null; createdAt: string | null }>; error: string | null; available: boolean;
}> {
  const sb = getServerClient();
  const { data, error } = await sb
    .from('refm_report_deck_versions')
    .select('version_number, label, created_at')
    .eq('project_id', projectId)
    .order('version_number', { ascending: false });
  if (error) {
    if (isMissingTable(error)) return { next: 1, existing: [], error: null, available: false };
    return { next: 1, existing: [], error: error.message, available: true };
  }
  const rows = (data ?? []) as Array<{ version_number: number; label: string | null; created_at: string | null }>;
  const maxNumber = rows.reduce((m, r) => Math.max(m, r.version_number ?? 0), 0);
  return {
    next: maxNumber + 1,
    existing: rows.map((r) => ({ label: r.label, createdAt: r.created_at })),
    error: null,
    available: true,
  };
}

/** The project's name, for the auto-generated version name. Never fatal: an
 *  unreadable name degrades to the generic "Project" prefix rather than
 *  failing a save. */
async function projectDisplayName(projectId: string): Promise<string | null> {
  const sb = getServerClient();
  const { data, error } = await sb.from('refm_projects').select('name').eq('id', projectId).maybeSingle();
  if (error || !data) return null;
  return (data as { name: string | null }).name ?? null;
}

/**
 * Save the given deck as a NEW version, and point the working deck at it.
 *
 * The working row is upserted with the same deck in the same call, so "save as
 * a version" also saves the user's current work: the two can never disagree
 * about what the named version contains.
 *
 * `label` is OPTIONAL. Left empty, the version is auto-named here rather than
 * in the UI, on the same pattern the model versions use
 * ({Project}_Presentation_v1.3_08032026). Naming on the server is deliberate:
 * every path that reaches this function (the Save button, the versions modal,
 * a direct POST) gets a real name, so the history cannot acquire an unnamed
 * row through a path that forgot to generate one. A caller that DOES supply a
 * name still wins, so a user can name a version deliberately.
 */
export async function saveDeckVersion(projectId: string, deck: Deck, label: string | null, comment: string | null): Promise<{
  version: DeckVersionListItem | null; error: string | null;
}> {
  const { next, existing, error: numErr, available } = await nextDeckVersionNumber(projectId);
  if (!available) return { version: null, error: VERSION_MIGRATION_HINT };
  if (numErr) return { version: null, error: numErr };

  const chosen = (label ?? '').trim();
  const finalLabel = chosen || autoDeckVersionName(await projectDisplayName(projectId), existing);

  const sb = getServerClient();
  const payload = { ...deck, projectId, updatedAt: null };
  const { data, error } = await sb
    .from('refm_report_deck_versions')
    .insert({
      project_id: projectId,
      version_number: next,
      schema_version: deck.schemaVersion ?? DECK_SCHEMA_VERSION,
      deck: payload,
      label: finalLabel,
      comment: comment?.trim() || null,
    })
    .select('id, version_number, label, comment, created_at')
    .maybeSingle();

  if (error) {
    if (isMissingTable(error)) return { version: null, error: VERSION_MIGRATION_HINT };
    return { version: null, error: error.message };
  }
  const row = data as { id: string; version_number: number; label: string | null; comment: string | null; created_at: string | null } | null;
  if (!row) return { version: null, error: 'The version could not be saved.' };

  // Keep the working deck in step, then point it at the version just written.
  const up = await upsertDeck(projectId, deck);
  if (up.error) return { version: null, error: up.error };
  await setDeckCurrentVersion(projectId, row.id);

  return {
    version: { id: row.id, versionNumber: row.version_number, label: row.label, comment: row.comment, createdAt: row.created_at },
    error: null,
  };
}

/** Read one saved version's deck document, validated through `coerceDeck`. */
export async function getDeckVersion(projectId: string, versionId: string, fallbackAsOf: string): Promise<{ deck: Deck | null; error: string | null }> {
  const sb = getServerClient();
  const { data, error } = await sb
    .from('refm_report_deck_versions')
    .select('deck')
    .eq('project_id', projectId)   // scoped by project: a version id alone must not reach across projects
    .eq('id', versionId)
    .maybeSingle();
  if (error) {
    if (isMissingTable(error)) return { deck: null, error: VERSION_MIGRATION_HINT };
    return { deck: null, error: error.message };
  }
  if (!data) return { deck: null, error: null };
  return { deck: coerceDeck((data as { deck: unknown }).deck, projectId, fallbackAsOf), error: null };
}

/** Point the working deck at a saved version (or at none). Best-effort: the
 *  pointer is a convenience, never a correctness requirement. */
export async function setDeckCurrentVersion(projectId: string, versionId: string | null): Promise<{ error: string | null }> {
  const sb = getServerClient();
  const { error } = await sb.from('refm_report_decks').update({ current_version_id: versionId }).eq('project_id', projectId);
  if (error && !isMissingTable(error) && !isMissingColumn(error)) return { error: error.message };
  return { error: null };
}

/**
 * Overwrite a saved version's document in place, and keep the working deck in
 * step, which is the deck equivalent of the platform's "edit this version in
 * place" choice.
 *
 * Migration 207 describes this table as append-only, and every OTHER path here
 * honours that: save-as-new inserts, load copies out, delete removes. This is
 * the one deliberate exception, and it mirrors the project versions table,
 * whose migration carries the same append-only wording while
 * `PATCH /versions/[versionId]` has always overwritten a row's snapshot. A
 * named version the user is actively working in has to be correctable, or
 * every fix spawns a new version and the names stop meaning anything.
 *
 * `version_number` and `created_at` are deliberately NOT touched: this is the
 * same version, revised, not a new one. The label is only changed when a new
 * one is supplied, so an in-place save never silently renames.
 */
export async function updateDeckVersion(
  projectId: string, versionId: string, deck: Deck, label?: string | null,
): Promise<{ version: DeckVersionListItem | null; error: string | null }> {
  const sb = getServerClient();
  const patch: Record<string, unknown> = { deck: { ...deck, projectId, updatedAt: null }, schema_version: deck.schemaVersion ?? DECK_SCHEMA_VERSION };
  if (typeof label === 'string' && label.trim()) patch.label = label.trim();

  const { data, error } = await sb
    .from('refm_report_deck_versions')
    .update(patch)
    .eq('project_id', projectId)   // scoped by project: a version id alone must not reach across projects
    .eq('id', versionId)
    .select('id, version_number, label, comment, created_at')
    .maybeSingle();

  if (error) {
    if (isMissingTable(error)) return { version: null, error: VERSION_MIGRATION_HINT };
    return { version: null, error: error.message };
  }
  if (!data) return { version: null, error: 'That saved version no longer exists.' };

  // The working deck is the document the user is looking at, so it is saved
  // too. Without this an in-place version update would leave the working row
  // stale and the next load would silently discard the edit.
  const up = await upsertDeck(projectId, deck);
  if (up.error) return { version: null, error: up.error };
  await setDeckCurrentVersion(projectId, versionId);

  const row = data as { id: string; version_number: number; label: string | null; comment: string | null; created_at: string | null };
  return {
    version: { id: row.id, versionNumber: row.version_number, label: row.label, comment: row.comment, createdAt: row.created_at },
    error: null,
  };
}

export async function deleteDeckVersion(projectId: string, versionId: string): Promise<{ error: string | null }> {
  const sb = getServerClient();
  const { error } = await sb.from('refm_report_deck_versions').delete().eq('project_id', projectId).eq('id', versionId);
  if (error) {
    if (isMissingTable(error)) return { error: VERSION_MIGRATION_HINT };
    return { error: error.message };
  }
  return { error: null };
}
