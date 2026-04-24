/**
 * Marketing Studio (Training Hub) - shared types.
 *
 * The studio is template-driven: each asset type has 1-3 fixed templates;
 * admins fill in editable fields, the server renders to PNG via next/og.
 * No persisted canvas state - what you see is the deterministic output of
 * (template id, content fields, brand pack).
 */

export type AssetType = 'linkedin-banner' | 'live-session' | 'youtube-thumbnail' | 'article-banner';

export interface Instructor {
  id: string;
  name: string;
  title: string;
  photoUrl: string;
  credentials: string;
}

export interface BrandPack {
  /** Resolved logo URL (from CMS header_settings.logo_url). Empty string if missing. */
  logoUrl: string;
  /** Primary corporate color (from email_branding.primary_color). Hex. */
  primaryColor: string;
  /** Default trainer (from instructors WHERE is_default=true). Used when no instructorIds set. */
  trainer: Instructor;
}

/**
 * Per-zone position override in PDF-point space (canvas pixels for satori).
 * Optional - missing fields fall back to the template's LAYOUT_DEFAULTS.
 */
export interface ZoneRect { x: number; y: number; w?: number; h?: number }
export type LayoutOverrides = Record<string, ZoneRect>;

/** Common fields on every banner content type. */
interface BannerBase {
  /** Optional uploaded background URL. Empty = use template's gradient default. */
  backgroundUrl?: string;
  /**
   * Instructor IDs to render. Empty array = use default instructor from brand pack.
   * Length 1 = single big trainer card. Length >= 2 = horizontal row of cards.
   */
  instructorIds?: string[];
  /** Per-zone position overrides keyed by template-defined zone names. */
  layout?: LayoutOverrides;
}

/** LinkedIn banner: 3 templates (profile-wide / post-square / quote-card) + content. */
export interface LinkedInBannerContent extends BannerBase {
  template: 'profile-1584' | 'post-1200' | 'quote-1200';
  title: string;
  subtitle: string;
  cta: string;
}

/** Live session announcement banner. Auto-filled from live_sessions row. */
export interface LiveSessionBannerContent extends BannerBase {
  template: 'live-1200';
  badge: string;        // e.g. "LIVE SESSION", "NEW RECORDING"
  title: string;
  scheduledAtISO: string; // ISO datetime
  timezone: string;     // e.g. "Asia/Karachi"
  durationMinutes: number;
  cta: string;
}

/** YouTube thumbnail: 1280x720, single template. */
export interface YouTubeThumbnailContent extends BannerBase {
  template: 'thumb-1280';
  badge: string;        // e.g. "NEW", "PART 3"
  title: string;
  subtitle: string;
}

/** Article banner: per-topic template, auto-fills from articles row. */
export interface ArticleBannerContent extends BannerBase {
  template: 'article-1200';
  category: string;
  title: string;
  /** Author display name. Empty = first picked instructor's name. */
  author: string;
}

export type RenderRequest =
  | { type: 'linkedin-banner';   content: LinkedInBannerContent }
  | { type: 'live-session';      content: LiveSessionBannerContent }
  | { type: 'youtube-thumbnail'; content: YouTubeThumbnailContent }
  | { type: 'article-banner';    content: ArticleBannerContent };

export interface RenderDimensions { width: number; height: number }

export const DIMENSIONS: Record<string, RenderDimensions> = {
  'profile-1584':  { width: 1584, height: 396 },
  'post-1200':     { width: 1200, height: 627 },
  'quote-1200':    { width: 1200, height: 627 },
  'live-1200':     { width: 1200, height: 627 },
  'thumb-1280':    { width: 1280, height: 720 },
  'article-1200':  { width: 1200, height: 630 },
};

export interface UploadedAsset {
  id: string;
  name: string;
  url: string;
  mimeType: string;
  fileSize: number;
  width: number | null;
  height: number | null;
  createdAt: string;
}

/**
 * Resolve the instructors to display on a banner. If `instructorIds` is set
 * and matches at least one row, those win; otherwise fall back to the default
 * trainer from the brand pack.
 */
export function resolveInstructors(brand: BrandPack, picked: Instructor[]): Instructor[] {
  return picked.length > 0 ? picked : [brand.trainer];
}
