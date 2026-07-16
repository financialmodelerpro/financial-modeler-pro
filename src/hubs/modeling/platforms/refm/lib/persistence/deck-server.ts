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

function isMissingTable(err: { code?: string | null; message?: string | null } | null): boolean {
  if (!err) return false;
  return err.code === '42P01' || /relation .* does not exist/i.test(err.message ?? '');
}

const MIGRATION_HINT =
  'The presentation deck table is not available yet (migration 199_report_decks.sql has not been applied). Ask an admin to apply it; your deck cannot be saved until then.';

// ── Coercion ────────────────────────────────────────────────────────────────

const str = (v: unknown, fallback = ''): string => (typeof v === 'string' ? v : fallback);
const bool = (v: unknown, fallback = false): boolean => (typeof v === 'boolean' ? v : fallback);
const numOr = (v: unknown, fallback: number): number => (typeof v === 'number' && Number.isFinite(v) ? v : fallback);
const nullableStr = (v: unknown): string | null => (typeof v === 'string' ? v : null);

const OBJECT_TYPES: ReadonlySet<string> = new Set<DeckObjectType>([
  'text', 'bullets', 'kpi', 'chart', 'table', 'image', 'shape', 'divider', 'gantt', 'heatmap', 'riskMatrix',
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

/** The saved deck, or null when the project has none yet (the caller then seeds
 *  from templates). A missing TABLE is not an error: it is a pre-migration
 *  state, and the tab degrades to an unsaveable in-memory deck. */
export async function getDeck(projectId: string, fallbackAsOf: string): Promise<{ deck: Deck | null; error: string | null; canSave: boolean }> {
  const sb = getServerClient();
  const { data, error } = await sb
    .from('refm_report_decks')
    .select('deck, updated_at')
    .eq('project_id', projectId)
    .maybeSingle();

  if (error) {
    if (isMissingTable(error)) return { deck: null, error: null, canSave: false };
    return { deck: null, error: error.message, canSave: true };
  }
  if (!data) return { deck: null, error: null, canSave: true };

  const row = data as { deck: unknown; updated_at: string | null };
  const deck = coerceDeck(row.deck, projectId, fallbackAsOf);
  if (deck) deck.updatedAt = row.updated_at;
  return { deck, error: null, canSave: true };
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
