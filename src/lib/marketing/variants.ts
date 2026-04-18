import type { BrandKit, CanvasBackground, CanvasDimensions, CanvasElement, TemplateVariant } from './types';
import { uid } from './canvasDefaults';

/**
 * Shared brand background — each variant uses the same lookup (brand library → gradient fallback)
 * so all variants stay on-brand regardless of dimensions.
 */
function brandBg(kit: BrandKit, overlay = 20): CanvasBackground {
  const brand = kit.background_library.find(b => b.type === 'brand' && b.url)
             ?? kit.background_library.find(b => b.url);
  if (brand?.url) return { type: 'image', image: brand.url, overlay: { color: '#000000', opacity: overlay } };
  return { type: 'gradient', gradient: { from: '#0A1F3C', to: kit.primary_color, direction: 'to bottom right' } };
}

type Orientation = 'landscape' | 'square' | 'portrait' | 'banner';
function orientation(dims: CanvasDimensions): Orientation {
  const r = dims.width / dims.height;
  if (r > 3.2) return 'banner';
  if (r > 1.3) return 'landscape';
  if (r > 0.85) return 'square';
  return 'portrait';
}

/** Absolute padding (px) scaled to the smaller dimension. */
function pad(dims: CanvasDimensions) {
  return Math.round(Math.min(dims.width, dims.height) * 0.055);
}

/** Scaled font size against min dimension. */
function fs(dims: CanvasDimensions, unit: number) {
  return Math.round(Math.min(dims.width, dims.height) * unit);
}

// ══════════════════════════════════════════════════════════════════════════════
// VARIANT 1 — SESSION ANNOUNCEMENT
// ══════════════════════════════════════════════════════════════════════════════
const sessionAnnouncement: TemplateVariant = {
  id: 'session-announcement',
  name: 'Session Announcement',
  description: '"NEW SESSION" badge + session number, big title, subtitle.',
  icon: '📢',
  build: (kit, dims) => {
    const W = dims.width, H = dims.height;
    const P = pad(dims);
    const o = orientation(dims);
    const logo = kit.logo_light_url ?? kit.logo_url;

    const elements: CanvasElement[] = [];

    // NEW SESSION badge (accent gold background, navy text)
    elements.push({
      id: uid(), type: 'shape', x: P, y: P, width: Math.round(W * 0.22), height: Math.round(H * 0.07), zIndex: 7,
      shape: { backgroundColor: kit.accent_color, borderRadius: 8, borderColor: 'transparent', borderWidth: 0, opacity: 100, lockAspectRatio: false },
    });
    elements.push({
      id: uid(), type: 'text', x: P, y: P, width: Math.round(W * 0.22), height: Math.round(H * 0.07), zIndex: 8,
      text: { content: 'NEW SESSION', fontSize: fs(dims, 0.022), fontWeight: 800, color: '#0A1F3C', fontFamily: kit.font_family, textAlign: 'center', lineHeight: 3.1, letterSpacing: 3, fontStyle: 'normal' },
    });

    // Logo top-right (or hidden on banner)
    if (logo && o !== 'banner') {
      elements.push({
        id: uid(), type: 'image', x: W - P - Math.round(W * 0.13), y: P, width: Math.round(W * 0.13), height: Math.round(H * 0.065), zIndex: 7,
        image: { src: logo, objectFit: 'contain', borderRadius: 0, opacity: 100, filter: 'none' as const, brightness: 100, lockAspectRatio: true, borderColor: 'transparent', borderWidth: 0 },
      });
    }

    // Session number
    elements.push({
      id: 'session-' + uid(), type: 'text', x: P, y: Math.round(H * 0.22), width: Math.round(W * 0.5), height: Math.round(H * 0.08), zIndex: 8,
      text: { content: 'Session 1 of 16', fontSize: fs(dims, 0.03), fontWeight: 700, color: kit.secondary_color, fontFamily: kit.font_family, textAlign: 'left', lineHeight: 1.2, letterSpacing: 1, fontStyle: 'normal' },
    });

    // Title
    elements.push({
      id: 'title-' + uid(), type: 'text', x: P, y: Math.round(H * 0.32), width: W - 2 * P, height: Math.round(H * 0.3), zIndex: 8,
      text: { content: '3-Statement Modeling', fontSize: fs(dims, o === 'banner' ? 0.13 : 0.085), fontWeight: 800, color: '#FFFFFF', fontFamily: kit.font_family, textAlign: o === 'portrait' ? 'center' : 'left', lineHeight: 1.05, letterSpacing: -2, fontStyle: 'normal' },
    });

    // Gold underline
    elements.push({
      id: uid(), type: 'shape',
      x: o === 'portrait' ? Math.round(W / 2 - W * 0.08) : P,
      y: Math.round(H * 0.66),
      width: Math.round(W * 0.15), height: Math.round(H * 0.008), zIndex: 7,
      shape: { backgroundColor: kit.accent_color, borderRadius: 4, borderColor: 'transparent', borderWidth: 0, opacity: 100, lockAspectRatio: false },
    });

    // Subtitle
    elements.push({
      id: 'subtitle-' + uid(), type: 'text', x: P, y: Math.round(H * 0.70), width: W - 2 * P, height: Math.round(H * 0.12), zIndex: 8,
      text: { content: 'Project Overview & Timeline', fontSize: fs(dims, 0.035), fontWeight: 500, color: 'rgba(255,255,255,0.85)', fontFamily: kit.font_family, textAlign: o === 'portrait' ? 'center' : 'left', lineHeight: 1.3, letterSpacing: 0, fontStyle: 'normal' },
    });

    // Founder photo bottom-right (skip on banner)
    if (kit.founder_photo_url && o !== 'banner') {
      const photoSize = Math.round(Math.min(W, H) * 0.14);
      elements.push({
        id: uid(), type: 'image', x: W - P - photoSize, y: H - P - photoSize, width: photoSize, height: photoSize, zIndex: 7,
        image: { src: kit.founder_photo_url, objectFit: 'cover', borderRadius: 50, opacity: 100, filter: 'none' as const, brightness: 100, lockAspectRatio: true, borderColor: kit.secondary_color, borderWidth: 3 },
      });
    }

    return { background: brandBg(kit, 20), elements };
  },
};

// ══════════════════════════════════════════════════════════════════════════════
// VARIANT 2 — QUOTE / INSIGHT
// ══════════════════════════════════════════════════════════════════════════════
const quoteInsight: TemplateVariant = {
  id: 'quote-insight',
  name: 'Quote / Insight',
  description: 'Large opening quote marks + centered insight + author attribution.',
  icon: '💬',
  build: (kit, dims) => {
    const W = dims.width, H = dims.height;
    const P = pad(dims);
    const o = orientation(dims);
    const logo = kit.logo_light_url ?? kit.logo_url;

    const elements: CanvasElement[] = [];

    if (logo && o !== 'banner') {
      elements.push({
        id: uid(), type: 'image', x: P, y: P, width: Math.round(W * 0.13), height: Math.round(H * 0.065), zIndex: 7,
        image: { src: logo, objectFit: 'contain', borderRadius: 0, opacity: 100, filter: 'none' as const, brightness: 100, lockAspectRatio: true, borderColor: 'transparent', borderWidth: 0 },
      });
    }

    // Giant opening quote mark — teal, typographic flourish
    elements.push({
      id: uid(), type: 'text', x: P, y: Math.round(H * 0.12), width: Math.round(W * 0.3), height: Math.round(H * 0.35), zIndex: 5,
      text: { content: '"', fontSize: fs(dims, o === 'banner' ? 0.35 : 0.32), fontWeight: 800, color: kit.secondary_color, fontFamily: 'Georgia', textAlign: 'left', lineHeight: 1.0, letterSpacing: 0, fontStyle: 'normal' },
    });

    // Quote text (centered for portrait/square, left for landscape)
    elements.push({
      id: 'title-' + uid(), type: 'text', x: P, y: Math.round(H * 0.28), width: W - 2 * P, height: Math.round(H * 0.4), zIndex: 8,
      text: { content: 'Good models are rarely elegant. They are loud, specific, and hard-won.', fontSize: fs(dims, o === 'banner' ? 0.11 : 0.055), fontWeight: 700, color: '#FFFFFF', fontFamily: kit.font_family, textAlign: o === 'portrait' ? 'center' : 'left', lineHeight: 1.2, letterSpacing: -1, fontStyle: 'italic' },
    });

    // Attribution line
    elements.push({
      id: 'subtitle-' + uid(), type: 'text', x: P, y: Math.round(H * 0.78), width: W - 2 * P, height: Math.round(H * 0.06), zIndex: 8,
      text: { content: '— Ahmad Din', fontSize: fs(dims, 0.028), fontWeight: 600, color: kit.accent_color, fontFamily: kit.font_family, textAlign: o === 'portrait' ? 'center' : 'left', lineHeight: 1.3, letterSpacing: 2, fontStyle: 'normal' },
    });

    // Founder photo (corner)
    if (kit.founder_photo_url && o !== 'banner') {
      const photoSize = Math.round(Math.min(W, H) * 0.11);
      elements.push({
        id: uid(), type: 'image', x: W - P - photoSize, y: H - P - photoSize, width: photoSize, height: photoSize, zIndex: 7,
        image: { src: kit.founder_photo_url, objectFit: 'cover', borderRadius: 50, opacity: 100, filter: 'none' as const, brightness: 100, lockAspectRatio: true, borderColor: kit.secondary_color, borderWidth: 3 },
      });
    }

    return { background: brandBg(kit, 30), elements };
  },
};

// ══════════════════════════════════════════════════════════════════════════════
// VARIANT 3 — PLATFORM LAUNCH
// ══════════════════════════════════════════════════════════════════════════════
const platformLaunch: TemplateVariant = {
  id: 'platform-launch',
  name: 'Platform Launch',
  description: '"LAUNCHING" tag + platform name + 3-bullet feature list + CTA.',
  icon: '🚀',
  build: (kit, dims) => {
    const W = dims.width, H = dims.height;
    const P = pad(dims);
    const o = orientation(dims);
    const logo = kit.logo_light_url ?? kit.logo_url;
    const elements: CanvasElement[] = [];

    if (logo && o !== 'banner') {
      elements.push({
        id: uid(), type: 'image', x: P, y: P, width: Math.round(W * 0.13), height: Math.round(H * 0.065), zIndex: 7,
        image: { src: logo, objectFit: 'contain', borderRadius: 0, opacity: 100, filter: 'none' as const, brightness: 100, lockAspectRatio: true, borderColor: 'transparent', borderWidth: 0 },
      });
    }

    // Launching tag (top-right-ish)
    elements.push({
      id: 'tag-' + uid(), type: 'text', x: P, y: Math.round(H * 0.16), width: W - 2 * P, height: Math.round(H * 0.05), zIndex: 8,
      text: { content: '🚀 NOW LAUNCHING', fontSize: fs(dims, 0.025), fontWeight: 800, color: kit.accent_color, fontFamily: kit.font_family, textAlign: o === 'portrait' ? 'center' : 'left', lineHeight: 1.2, letterSpacing: 4, fontStyle: 'normal' },
    });

    // Platform name (big headline)
    elements.push({
      id: 'title-' + uid(), type: 'text', x: P, y: Math.round(H * 0.24), width: W - 2 * P, height: Math.round(H * 0.15), zIndex: 8,
      text: { content: 'Real Estate Financial Modeling', fontSize: fs(dims, o === 'banner' ? 0.11 : 0.065), fontWeight: 800, color: '#FFFFFF', fontFamily: kit.font_family, textAlign: o === 'portrait' ? 'center' : 'left', lineHeight: 1.05, letterSpacing: -1, fontStyle: 'normal' },
    });

    // Subtitle
    elements.push({
      id: 'subtitle-' + uid(), type: 'text', x: P, y: Math.round(H * 0.40), width: W - 2 * P, height: Math.round(H * 0.08), zIndex: 8,
      text: { content: 'Build deal-ready models. Export to Excel. Share instantly.', fontSize: fs(dims, 0.03), fontWeight: 500, color: 'rgba(255,255,255,0.85)', fontFamily: kit.font_family, textAlign: o === 'portrait' ? 'center' : 'left', lineHeight: 1.35, letterSpacing: 0, fontStyle: 'normal' },
    });

    // 3 feature bullets
    const features = ['Interactive sensitivity analysis', 'One-click Excel & PDF export', 'Cloud-synced saved projects'];
    const bulletStart = 0.52;
    const bulletH = 0.06;
    features.forEach((feat, i) => {
      const y = Math.round(H * (bulletStart + i * bulletH));
      elements.push({
        id: uid(), type: 'shape', x: P, y: y + Math.round(H * 0.015), width: Math.round(Math.min(W, H) * 0.012), height: Math.round(Math.min(W, H) * 0.012), zIndex: 7,
        shape: { backgroundColor: kit.accent_color, borderRadius: 50, borderColor: 'transparent', borderWidth: 0, opacity: 100, lockAspectRatio: true },
      });
      elements.push({
        id: uid(), type: 'text', x: P + Math.round(Math.min(W, H) * 0.03), y, width: W - 2 * P, height: Math.round(H * bulletH), zIndex: 8,
        text: { content: feat, fontSize: fs(dims, 0.024), fontWeight: 500, color: '#FFFFFF', fontFamily: kit.font_family, textAlign: 'left', lineHeight: 1.4, letterSpacing: 0, fontStyle: 'normal' },
      });
    });

    // CTA button (centered below bullets)
    const ctaW = Math.round(W * (o === 'portrait' ? 0.55 : 0.3));
    const ctaH = Math.round(H * 0.08);
    const ctaX = Math.round((W - ctaW) / 2);
    const ctaY = Math.round(H * 0.8);
    elements.push({
      id: uid(), type: 'shape', x: ctaX, y: ctaY, width: ctaW, height: ctaH, zIndex: 8,
      shape: { backgroundColor: kit.accent_color, borderRadius: 14, borderColor: 'transparent', borderWidth: 0, opacity: 100, lockAspectRatio: false },
    });
    elements.push({
      id: 'series-' + uid(), type: 'text', x: ctaX, y: ctaY, width: ctaW, height: ctaH, zIndex: 9,
      text: { content: 'GET STARTED →', fontSize: fs(dims, 0.028), fontWeight: 800, color: '#0A1F3C', fontFamily: kit.font_family, textAlign: 'center', lineHeight: ctaH / fs(dims, 0.028), letterSpacing: 2, fontStyle: 'normal' },
    });

    return { background: brandBg(kit, 20), elements };
  },
};

// ══════════════════════════════════════════════════════════════════════════════
// VARIANT 4 — ACHIEVEMENT SPOTLIGHT
// ══════════════════════════════════════════════════════════════════════════════
const achievementSpotlight: TemplateVariant = {
  id: 'achievement-spotlight',
  name: 'Achievement Spotlight',
  description: 'Congrats banner + student name + score stat + certificate visual.',
  icon: '🏆',
  build: (kit, dims) => {
    const W = dims.width, H = dims.height;
    const P = pad(dims);
    const o = orientation(dims);
    const logo = kit.logo_light_url ?? kit.logo_url;
    const elements: CanvasElement[] = [];

    if (logo && o !== 'banner') {
      elements.push({
        id: uid(), type: 'image', x: P, y: P, width: Math.round(W * 0.13), height: Math.round(H * 0.065), zIndex: 7,
        image: { src: logo, objectFit: 'contain', borderRadius: 0, opacity: 100, filter: 'none' as const, brightness: 100, lockAspectRatio: true, borderColor: 'transparent', borderWidth: 0 },
      });
    }

    // Gold banner strip across the top-middle
    elements.push({
      id: uid(), type: 'shape', x: 0, y: Math.round(H * 0.17), width: W, height: Math.round(H * 0.07), zIndex: 6,
      shape: { backgroundColor: kit.accent_color, borderRadius: 0, borderColor: 'transparent', borderWidth: 0, opacity: 100, lockAspectRatio: false },
    });
    elements.push({
      id: 'tag-' + uid(), type: 'text', x: 0, y: Math.round(H * 0.17), width: W, height: Math.round(H * 0.07), zIndex: 8,
      text: { content: '🏆 CONGRATULATIONS', fontSize: fs(dims, 0.028), fontWeight: 800, color: '#0A1F3C', fontFamily: kit.font_family, textAlign: 'center', lineHeight: 2.4, letterSpacing: 5, fontStyle: 'normal' },
    });

    // Student name (big)
    elements.push({
      id: 'title-' + uid(), type: 'text', x: P, y: Math.round(H * 0.32), width: W - 2 * P, height: Math.round(H * 0.12), zIndex: 8,
      text: { content: 'Sarah Ahmed', fontSize: fs(dims, o === 'banner' ? 0.14 : 0.08), fontWeight: 800, color: '#FFFFFF', fontFamily: kit.font_family, textAlign: 'center', lineHeight: 1.05, letterSpacing: -1, fontStyle: 'normal' },
    });

    // Subtitle (what they completed)
    elements.push({
      id: 'subtitle-' + uid(), type: 'text', x: P, y: Math.round(H * 0.45), width: W - 2 * P, height: Math.round(H * 0.06), zIndex: 8,
      text: { content: 'Certified · 3-Statement Financial Modeling', fontSize: fs(dims, 0.028), fontWeight: 500, color: kit.secondary_color, fontFamily: kit.font_family, textAlign: 'center', lineHeight: 1.3, letterSpacing: 1, fontStyle: 'normal' },
    });

    // Score stat (large number + label)
    elements.push({
      id: uid(), type: 'text', x: 0, y: Math.round(H * 0.56), width: W, height: Math.round(H * 0.16), zIndex: 8,
      text: { content: '94%', fontSize: fs(dims, o === 'banner' ? 0.18 : 0.12), fontWeight: 800, color: kit.accent_color, fontFamily: kit.font_family, textAlign: 'center', lineHeight: 1.0, letterSpacing: -3, fontStyle: 'normal' },
    });
    elements.push({
      id: 'session-' + uid(), type: 'text', x: 0, y: Math.round(H * 0.73), width: W, height: Math.round(H * 0.05), zIndex: 8,
      text: { content: 'AVERAGE ASSESSMENT SCORE', fontSize: fs(dims, 0.018), fontWeight: 700, color: 'rgba(255,255,255,0.7)', fontFamily: kit.font_family, textAlign: 'center', lineHeight: 1.4, letterSpacing: 4, fontStyle: 'normal' },
    });

    // Footer: series label
    elements.push({
      id: 'series-' + uid(), type: 'text', x: P, y: H - P - Math.round(H * 0.04), width: W - 2 * P, height: Math.round(H * 0.04), zIndex: 8,
      text: { content: 'learn.financialmodelerpro.com', fontSize: fs(dims, 0.02), fontWeight: 500, color: 'rgba(255,255,255,0.5)', fontFamily: kit.font_family, textAlign: 'center', lineHeight: 1.3, letterSpacing: 1, fontStyle: 'normal' },
    });

    return { background: brandBg(kit, 20), elements };
  },
};

// ══════════════════════════════════════════════════════════════════════════════
// VARIANT 5 — ARTICLE PROMO
// ══════════════════════════════════════════════════════════════════════════════
const articlePromo: TemplateVariant = {
  id: 'article-promo',
  name: 'Article Promo',
  description: '"NEW ARTICLE" tag + headline + excerpt + author mini-card + READ MORE.',
  icon: '📰',
  build: (kit, dims) => {
    const W = dims.width, H = dims.height;
    const P = pad(dims);
    const o = orientation(dims);
    const logo = kit.logo_light_url ?? kit.logo_url;
    const elements: CanvasElement[] = [];

    if (logo && o !== 'banner') {
      elements.push({
        id: uid(), type: 'image', x: P, y: P, width: Math.round(W * 0.13), height: Math.round(H * 0.065), zIndex: 7,
        image: { src: logo, objectFit: 'contain', borderRadius: 0, opacity: 100, filter: 'none' as const, brightness: 100, lockAspectRatio: true, borderColor: 'transparent', borderWidth: 0 },
      });
    }

    // NEW ARTICLE tag
    elements.push({
      id: 'tag-' + uid(), type: 'text', x: P, y: Math.round(H * 0.18), width: W - 2 * P, height: Math.round(H * 0.05), zIndex: 8,
      text: { content: '📰 NEW ARTICLE', fontSize: fs(dims, 0.022), fontWeight: 800, color: kit.secondary_color, fontFamily: kit.font_family, textAlign: o === 'portrait' ? 'center' : 'left', lineHeight: 1.2, letterSpacing: 4, fontStyle: 'normal' },
    });

    // Headline
    elements.push({
      id: 'title-' + uid(), type: 'text', x: P, y: Math.round(H * 0.26), width: W - 2 * P, height: Math.round(H * 0.26), zIndex: 8,
      text: { content: 'How top analysts structure a DCF before touching Excel', fontSize: fs(dims, o === 'banner' ? 0.11 : 0.058), fontWeight: 800, color: '#FFFFFF', fontFamily: kit.font_family, textAlign: o === 'portrait' ? 'center' : 'left', lineHeight: 1.1, letterSpacing: -1, fontStyle: 'normal' },
    });

    // Gold divider
    elements.push({
      id: uid(), type: 'shape',
      x: o === 'portrait' ? Math.round(W / 2 - W * 0.075) : P,
      y: Math.round(H * 0.56),
      width: Math.round(W * 0.15), height: Math.round(H * 0.007), zIndex: 6,
      shape: { backgroundColor: kit.accent_color, borderRadius: 4, borderColor: 'transparent', borderWidth: 0, opacity: 100, lockAspectRatio: false },
    });

    // Excerpt
    elements.push({
      id: 'subtitle-' + uid(), type: 'text', x: P, y: Math.round(H * 0.59), width: W - 2 * P, height: Math.round(H * 0.16), zIndex: 8,
      text: { content: 'A practitioner framework for scoping, drafting, and pressure-testing valuation assumptions before you build a single cell.', fontSize: fs(dims, 0.028), fontWeight: 400, color: 'rgba(255,255,255,0.85)', fontFamily: kit.font_family, textAlign: o === 'portrait' ? 'center' : 'left', lineHeight: 1.4, letterSpacing: 0, fontStyle: 'normal' },
    });

    // Author mini-card bottom-left
    const photoSize = Math.round(Math.min(W, H) * 0.075);
    if (kit.founder_photo_url && o !== 'banner') {
      elements.push({
        id: uid(), type: 'image', x: P, y: H - P - photoSize, width: photoSize, height: photoSize, zIndex: 7,
        image: { src: kit.founder_photo_url, objectFit: 'cover', borderRadius: 50, opacity: 100, filter: 'none' as const, brightness: 100, lockAspectRatio: true, borderColor: kit.secondary_color, borderWidth: 2 },
      });
    }
    elements.push({
      id: uid(), type: 'text',
      x: kit.founder_photo_url && o !== 'banner' ? P + photoSize + Math.round(Math.min(W, H) * 0.015) : P,
      y: H - P - photoSize + Math.round(photoSize * 0.15),
      width: Math.round(W * 0.5), height: Math.round(photoSize * 0.7), zIndex: 8,
      text: { content: 'Ahmad Din · FMP', fontSize: fs(dims, 0.022), fontWeight: 700, color: '#FFFFFF', fontFamily: kit.font_family, textAlign: 'left', lineHeight: 1.3, letterSpacing: 0, fontStyle: 'normal' },
    });

    // READ MORE button bottom-right
    const btnW = Math.round(W * (o === 'portrait' ? 0.4 : 0.2));
    const btnH = Math.round(H * 0.07);
    elements.push({
      id: uid(), type: 'shape', x: W - P - btnW, y: H - P - btnH, width: btnW, height: btnH, zIndex: 7,
      shape: { backgroundColor: 'transparent', borderRadius: 10, borderColor: kit.secondary_color, borderWidth: 2, opacity: 100, lockAspectRatio: false },
    });
    elements.push({
      id: 'series-' + uid(), type: 'text', x: W - P - btnW, y: H - P - btnH, width: btnW, height: btnH, zIndex: 8,
      text: { content: 'READ MORE →', fontSize: fs(dims, 0.022), fontWeight: 700, color: kit.secondary_color, fontFamily: kit.font_family, textAlign: 'center', lineHeight: btnH / fs(dims, 0.022), letterSpacing: 2, fontStyle: 'normal' },
    });

    return { background: brandBg(kit, 25), elements };
  },
};

export const VARIANTS: TemplateVariant[] = [
  sessionAnnouncement,
  quoteInsight,
  platformLaunch,
  achievementSpotlight,
  articlePromo,
];

export function getVariant(id: string): TemplateVariant | null {
  return VARIANTS.find(v => v.id === id) ?? null;
}
