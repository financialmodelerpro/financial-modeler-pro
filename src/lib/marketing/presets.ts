import type { TemplatePreset, CanvasElement, CanvasBackground, BrandKit } from './types';
import { uid } from './canvasDefaults';

// ── YouTube Thumbnail 1280×720 ────────────────────────────────────────────────
const youtubePreset: TemplatePreset = {
  id: 'youtube-thumbnail',
  name: 'YouTube Thumbnail',
  description: 'Bold 1280×720 thumbnail — logo, big title, founder photo, accent bar.',
  category: 'youtube',
  dimensions: { width: 1280, height: 720 },
  aspectRatio: '16:9',
  buildPreset: (kit) => {
    const background: CanvasBackground = {
      type: 'gradient',
      gradient: { from: '#0A1F3D', to: kit.primary_color, direction: 'to bottom right' },
    };
    const elements: CanvasElement[] = [
      // Logo top-left
      kit.logo_url ? {
        id: uid(), type: 'image', x: 64, y: 56, width: 160, height: 56, zIndex: 5,
        image: { src: kit.logo_url, objectFit: 'contain', borderRadius: 0, opacity: 100, filter: 'none', brightness: 100 },
      } : null,
      // Category badge top-right
      {
        id: uid(), type: 'shape', x: 1016, y: 56, width: 200, height: 56, zIndex: 5,
        shape: { backgroundColor: kit.accent_color, borderRadius: 28, borderColor: 'transparent', borderWidth: 0, opacity: 100 },
      },
      {
        id: uid(), type: 'text', x: 1016, y: 56, width: 200, height: 56, zIndex: 6,
        text: { content: 'TUTORIAL', fontSize: 22, fontWeight: 800, color: '#FFFFFF', fontFamily: kit.font_family, textAlign: 'center', lineHeight: 2.5, letterSpacing: 2 },
      },
      // Accent bar
      {
        id: uid(), type: 'shape', x: 64, y: 220, width: 120, height: 10, zIndex: 4,
        shape: { backgroundColor: kit.accent_color, borderRadius: 5, borderColor: 'transparent', borderWidth: 0, opacity: 100 },
      },
      // Main headline
      {
        id: uid(), type: 'text', x: 64, y: 260, width: 900, height: 220, zIndex: 6,
        text: { content: 'DCF Valuation\nEXPLAINED', fontSize: 100, fontWeight: 800, color: '#FFFFFF', fontFamily: kit.font_family, textAlign: 'left', lineHeight: 1.02, letterSpacing: -2 },
      },
      // Subtitle
      {
        id: uid(), type: 'text', x: 64, y: 500, width: 900, height: 60, zIndex: 6,
        text: { content: 'Step-by-step Excel walkthrough', fontSize: 32, fontWeight: 500, color: 'rgba(255,255,255,0.75)', fontFamily: kit.font_family, textAlign: 'left', lineHeight: 1.3, letterSpacing: 0 },
      },
      // Episode line
      {
        id: uid(), type: 'text', x: 64, y: 620, width: 700, height: 40, zIndex: 6,
        text: { content: 'Financial Modeling · Episode 4', fontSize: 22, fontWeight: 600, color: 'rgba(255,255,255,0.6)', fontFamily: kit.font_family, textAlign: 'left', lineHeight: 1.3, letterSpacing: 0 },
      },
      // Founder photo bottom-right
      kit.founder_photo_url ? {
        id: uid(), type: 'image', x: 1096, y: 552, width: 120, height: 120, zIndex: 5,
        image: { src: kit.founder_photo_url, objectFit: 'cover', borderRadius: 50, opacity: 100, filter: 'none', brightness: 100 },
      } : null,
    ].filter(Boolean) as CanvasElement[];

    return { background, elements };
  },
};

// ── LinkedIn Post 1200×627 ────────────────────────────────────────────────────
const linkedinPreset: TemplatePreset = {
  id: 'linkedin-post',
  name: 'LinkedIn Post',
  description: 'Professional 1200×627 share image — eyebrow, headline, body, author.',
  category: 'linkedin',
  dimensions: { width: 1200, height: 627 },
  aspectRatio: '1.91:1',
  buildPreset: (kit) => {
    const background: CanvasBackground = {
      type: 'gradient',
      gradient: { from: '#0A1F3D', to: kit.primary_color, direction: 'to bottom right' },
    };
    const elements: CanvasElement[] = [
      // Logo top-left
      kit.logo_url ? {
        id: uid(), type: 'image', x: 64, y: 48, width: 140, height: 48, zIndex: 5,
        image: { src: kit.logo_url, objectFit: 'contain', borderRadius: 0, opacity: 100, filter: 'none', brightness: 100 },
      } : null,
      // Eyebrow top-right
      {
        id: uid(), type: 'text', x: 860, y: 56, width: 280, height: 36, zIndex: 6,
        text: { content: 'FINANCIAL MODELING TIP', fontSize: 14, fontWeight: 700, color: kit.secondary_color, fontFamily: kit.font_family, textAlign: 'right', lineHeight: 2.5, letterSpacing: 4 },
      },
      // Headline
      {
        id: uid(), type: 'text', x: 64, y: 180, width: 1070, height: 200, zIndex: 6,
        text: { content: '3 DCF mistakes that kill valuations', fontSize: 60, fontWeight: 800, color: '#FFFFFF', fontFamily: kit.font_family, textAlign: 'left', lineHeight: 1.08, letterSpacing: -1 },
      },
      // Body
      {
        id: uid(), type: 'text', x: 64, y: 400, width: 1070, height: 100, zIndex: 6,
        text: { content: 'A short insight that makes people stop scrolling — then teaches them something useful.', fontSize: 24, fontWeight: 500, color: 'rgba(255,255,255,0.78)', fontFamily: kit.font_family, textAlign: 'left', lineHeight: 1.4, letterSpacing: 0 },
      },
      // Author photo + name bottom-left
      kit.founder_photo_url ? {
        id: uid(), type: 'image', x: 64, y: 540, width: 54, height: 54, zIndex: 5,
        image: { src: kit.founder_photo_url, objectFit: 'cover', borderRadius: 50, opacity: 100, filter: 'none', brightness: 100 },
      } : null,
      {
        id: uid(), type: 'text', x: kit.founder_photo_url ? 130 : 64, y: 552, width: 400, height: 32, zIndex: 6,
        text: { content: 'Ahmad Din · Financial Modeler Pro', fontSize: 18, fontWeight: 500, color: 'rgba(255,255,255,0.78)', fontFamily: kit.font_family, textAlign: 'left', lineHeight: 1.4, letterSpacing: 0 },
      },
      // URL bottom-right
      {
        id: uid(), type: 'text', x: 800, y: 558, width: 340, height: 24, zIndex: 6,
        text: { content: 'financialmodelerpro.com', fontSize: 16, fontWeight: 500, color: 'rgba(255,255,255,0.6)', fontFamily: kit.font_family, textAlign: 'right', lineHeight: 1.4, letterSpacing: 0 },
      },
      // Accent bar
      {
        id: uid(), type: 'shape', x: 940, y: 619, width: 200, height: 8, zIndex: 5,
        shape: { backgroundColor: kit.accent_color, borderRadius: 4, borderColor: 'transparent', borderWidth: 0, opacity: 100 },
      },
    ].filter(Boolean) as CanvasElement[];

    return { background, elements };
  },
};

// ── Instagram Post 1080×1080 ──────────────────────────────────────────────────
const instagramPreset: TemplatePreset = {
  id: 'instagram-post',
  name: 'Instagram Post',
  description: 'Square 1080×1080 — large headline, subtitle, hashtag line.',
  category: 'instagram',
  dimensions: { width: 1080, height: 1080 },
  aspectRatio: '1:1',
  buildPreset: (kit) => {
    const background: CanvasBackground = {
      type: 'gradient',
      gradient: { from: kit.primary_color, to: kit.secondary_color, direction: 'to bottom right' },
    };
    const elements: CanvasElement[] = [
      // Logo top-left
      kit.logo_url ? {
        id: uid(), type: 'image', x: 72, y: 72, width: 140, height: 50, zIndex: 5,
        image: { src: kit.logo_url, objectFit: 'contain', borderRadius: 0, opacity: 100, filter: 'none', brightness: 100 },
      } : null,
      // Founder photo top-right
      kit.founder_photo_url ? {
        id: uid(), type: 'image', x: 936, y: 72, width: 72, height: 72, zIndex: 5,
        image: { src: kit.founder_photo_url, objectFit: 'cover', borderRadius: 50, opacity: 100, filter: 'none', brightness: 100 },
      } : null,
      // Accent bar
      {
        id: uid(), type: 'shape', x: 72, y: 340, width: 80, height: 10, zIndex: 4,
        shape: { backgroundColor: kit.accent_color, borderRadius: 5, borderColor: 'transparent', borderWidth: 0, opacity: 100 },
      },
      // Main headline
      {
        id: uid(), type: 'text', x: 72, y: 380, width: 936, height: 200, zIndex: 6,
        text: { content: 'NPV vs IRR', fontSize: 140, fontWeight: 800, color: '#FFFFFF', fontFamily: kit.font_family, textAlign: 'left', lineHeight: 1.0, letterSpacing: -3 },
      },
      // Subtitle
      {
        id: uid(), type: 'text', x: 72, y: 600, width: 936, height: 80, zIndex: 6,
        text: { content: 'Which one actually matters?', fontSize: 36, fontWeight: 500, color: 'rgba(255,255,255,0.82)', fontFamily: kit.font_family, textAlign: 'left', lineHeight: 1.25, letterSpacing: 0 },
      },
      // Body
      {
        id: uid(), type: 'text', x: 72, y: 720, width: 936, height: 140, zIndex: 6,
        text: { content: 'Most analysts default to IRR — here is why NPV wins in almost every serious decision.', fontSize: 24, fontWeight: 500, color: 'rgba(255,255,255,0.82)', fontFamily: kit.font_family, textAlign: 'left', lineHeight: 1.45, letterSpacing: 0 },
      },
      // Hashtag line
      {
        id: uid(), type: 'text', x: 72, y: 920, width: 936, height: 36, zIndex: 6,
        text: { content: '#FinancialModeling #Valuation #Finance', fontSize: 22, fontWeight: 600, color: kit.accent_color, fontFamily: kit.font_family, textAlign: 'left', lineHeight: 1.3, letterSpacing: 0 },
      },
      // URL bottom
      {
        id: uid(), type: 'text', x: 72, y: 972, width: 936, height: 28, zIndex: 6,
        text: { content: 'financialmodelerpro.com', fontSize: 20, fontWeight: 500, color: 'rgba(255,255,255,0.7)', fontFamily: kit.font_family, textAlign: 'left', lineHeight: 1.3, letterSpacing: 0 },
      },
    ].filter(Boolean) as CanvasElement[];

    return { background, elements };
  },
};

// ── Blank Custom ──────────────────────────────────────────────────────────────
const blankPreset: TemplatePreset = {
  id: 'blank-custom',
  name: 'Blank Custom',
  description: 'Empty canvas — bring your own dimensions and elements.',
  category: 'custom',
  dimensions: { width: 1200, height: 1200 },
  aspectRatio: '1:1',
  buildPreset: (_kit) => ({
    background: { type: 'color', color: '#0D2E5A' },
    elements: [],
  }),
};

// Instagram Story 1080×1920 — extra convenience preset
const storyPreset: TemplatePreset = {
  id: 'instagram-story',
  name: 'Instagram Story',
  description: 'Vertical 1080×1920 for IG/TikTok stories.',
  category: 'instagram',
  dimensions: { width: 1080, height: 1920 },
  aspectRatio: '9:16',
  buildPreset: (kit) => ({
    background: {
      type: 'gradient',
      gradient: { from: '#0A1F3D', to: kit.primary_color, direction: 'to bottom' },
    },
    elements: [
      kit.logo_url ? {
        id: uid(), type: 'image', x: 80, y: 120, width: 160, height: 56, zIndex: 5,
        image: { src: kit.logo_url, objectFit: 'contain', borderRadius: 0, opacity: 100, filter: 'none', brightness: 100 },
      } : null,
      {
        id: uid(), type: 'text', x: 80, y: 680, width: 920, height: 400, zIndex: 6,
        text: { content: 'Master\nFinancial\nModeling', fontSize: 130, fontWeight: 800, color: '#FFFFFF', fontFamily: kit.font_family, textAlign: 'left', lineHeight: 1.02, letterSpacing: -2 },
      },
      {
        id: uid(), type: 'text', x: 80, y: 1120, width: 920, height: 120, zIndex: 6,
        text: { content: 'Free certification. Real practitioner training.', fontSize: 40, fontWeight: 500, color: 'rgba(255,255,255,0.78)', fontFamily: kit.font_family, textAlign: 'left', lineHeight: 1.3, letterSpacing: 0 },
      },
    ].filter(Boolean) as CanvasElement[],
  }),
};

export const PRESETS: TemplatePreset[] = [youtubePreset, linkedinPreset, instagramPreset, storyPreset, blankPreset];

export function getPreset(id: string): TemplatePreset | null {
  return PRESETS.find(p => p.id === id) ?? null;
}
