// ── Brand Kit ─────────────────────────────────────────────────────────────────

export interface ImageAsset { url: string; name: string }

export interface BackgroundLibraryItem {
  id: string;
  name: string;
  url: string;
  thumbnail?: string;
  type: 'brand' | 'custom';
}

export interface BrandKit {
  logo_url: string | null;
  logo_light_url: string | null;
  founder_photo_url: string | null;
  primary_color: string;
  secondary_color: string;
  accent_color: string;
  text_color_dark: string;
  text_color_light: string;
  font_family: string;
  additional_logos: ImageAsset[];
  additional_photos: ImageAsset[];
  uploaded_images: ImageAsset[];
  background_library: BackgroundLibraryItem[];
}

export const DEFAULT_BRAND_KIT: BrandKit = {
  logo_url: null,
  logo_light_url: null,
  founder_photo_url: null,
  primary_color: '#1B4F72',
  secondary_color: '#2DD4BF',
  accent_color: '#F59E0B',
  text_color_dark: '#1F2937',
  text_color_light: '#FFFFFF',
  font_family: 'Inter',
  additional_logos: [],
  additional_photos: [],
  uploaded_images: [],
  background_library: [],
};

// ── Canvas Elements ───────────────────────────────────────────────────────────

export type ElementType = 'text' | 'image' | 'shape';

export type ObjectFit = 'cover' | 'contain' | 'fill';
export type TextAlign = 'left' | 'center' | 'right';

export interface TextProps {
  content: string;
  fontSize: number;
  fontWeight: 400 | 500 | 600 | 700 | 800;
  color: string;
  fontFamily: string;
  textAlign: TextAlign;
  lineHeight: number;
  letterSpacing: number;
  fontStyle?: 'normal' | 'italic';
}

export interface ImageProps {
  src: string;
  objectFit: ObjectFit;
  borderRadius: number; // px or percentage (0-50 treated as %)
  opacity: number;      // 0-100
  filter: 'none' | 'grayscale' | 'blur';
  brightness: number;   // 0-200, 100 = normal
  /** Lock the W:H ratio when resizing (default true for images). */
  lockAspectRatio?: boolean;
  /** Optional frame around image (e.g. teal ring on founder photo). */
  borderColor?: string;
  borderWidth?: number;
}

export interface ShapeProps {
  backgroundColor: string;
  borderRadius: number;
  borderColor: string;
  borderWidth: number;
  opacity: number;
  lockAspectRatio?: boolean;
}

export interface CanvasElement {
  id: string;
  type: ElementType;
  x: number;
  y: number;
  width: number;
  height: number;
  zIndex: number;
  text?: TextProps;
  image?: ImageProps;
  shape?: ShapeProps;
}

// ── Canvas Background ─────────────────────────────────────────────────────────

export type BackgroundType = 'color' | 'gradient' | 'image';
export type GradientDirection =
  | 'to right' | 'to left' | 'to bottom' | 'to top'
  | 'to bottom right' | 'to bottom left' | 'to top right' | 'to top left'
  | 'radial';

export interface GradientBg {
  from: string;
  to: string;
  direction: GradientDirection;
}

export interface OverlayBg { color: string; opacity: number }

export interface CanvasBackground {
  type: BackgroundType;
  color?: string;
  gradient?: GradientBg;
  image?: string;
  overlay?: OverlayBg;
}

// ── Canvas Design ─────────────────────────────────────────────────────────────

export interface CanvasDimensions { width: number; height: number }

export interface Design {
  id: string;
  name: string;
  template_type: string; // 'youtube-thumbnail' | 'linkedin-post' | 'instagram-post' | 'custom' | ...
  dimensions: CanvasDimensions;
  background: CanvasBackground;
  elements: CanvasElement[];
  ai_captions: Record<string, string>;
}

// ── Template Preset ───────────────────────────────────────────────────────────

export interface TemplatePreset {
  id: string;
  name: string;
  description: string;
  category: 'youtube' | 'linkedin' | 'instagram' | 'custom';
  dimensions: CanvasDimensions;
  aspectRatio: string;
  /** Build initial elements + background using brand kit colors/assets. */
  buildPreset: (kit: BrandKit) => { background: CanvasBackground; elements: CanvasElement[] };
}

// ── Saved design (DB row) ─────────────────────────────────────────────────────

export interface MarketingDesign {
  id: string;
  name: string;
  template_type: string;
  /** Canvas data (primary) */
  dimensions: CanvasDimensions;
  background: CanvasBackground;
  elements: CanvasElement[];
  /** Legacy Phase 1 template content, preserved for backward compat only. */
  content?: Record<string, string>;
  ai_captions: Record<string, string>;
  preview_url: string | null;
  created_at: string;
  updated_at: string;
  created_by: string | null;
}
