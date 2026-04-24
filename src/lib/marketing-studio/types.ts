/**
 * Marketing Studio (Training Hub) - shared types.
 *
 * The studio is template-driven: each asset type has 1-3 fixed templates;
 * admins fill in editable fields, the server renders to PNG via next/og.
 * No persisted canvas state - what you see is the deterministic output of
 * (template id, content fields, brand pack).
 */

export type AssetType = 'linkedin-banner' | 'live-session' | 'youtube-thumbnail' | 'article-banner';

export interface BrandPack {
  /** Resolved logo URL (from CMS header_settings.logo_url). Empty string if missing. */
  logoUrl: string;
  /** Primary corporate color (from email_branding.primary_color). Hex. */
  primaryColor: string;
  /** Default trainer (from instructors WHERE is_default=true). */
  trainer: {
    name: string;
    title: string;
    photoUrl: string;
    credentials: string;
  };
}

/** LinkedIn banner: 2 templates (profile-wide / post-square) + content. */
export interface LinkedInBannerContent {
  template: 'profile-1584' | 'post-1200' | 'quote-1200';
  title: string;
  subtitle: string;
  cta: string;
  /** Optional uploaded background URL. Empty = use template's gradient default. */
  backgroundUrl?: string;
}

/** Live session announcement banner. Auto-filled from live_sessions row. */
export interface LiveSessionBannerContent {
  template: 'live-1200';
  badge: string;        // e.g. "LIVE SESSION", "NEW RECORDING"
  title: string;
  scheduledAtISO: string; // ISO datetime
  timezone: string;     // e.g. "Asia/Karachi"
  durationMinutes: number;
  instructorName: string;
  instructorTitle: string;
  cta: string;
  backgroundUrl?: string;
}

/** YouTube thumbnail: 1280x720, single template. */
export interface YouTubeThumbnailContent {
  template: 'thumb-1280';
  badge: string;        // e.g. "NEW", "PART 3"
  title: string;
  subtitle: string;
  backgroundUrl?: string;
}

/** Article banner: per-topic template, auto-fills from articles row. */
export interface ArticleBannerContent {
  template: 'article-1200';
  category: string;
  title: string;
  author: string;
  backgroundUrl?: string;
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
