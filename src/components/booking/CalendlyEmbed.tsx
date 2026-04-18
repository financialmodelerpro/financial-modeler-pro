'use client';

/**
 * Inline Calendly booking widget.
 *
 * Loads https://assets.calendly.com/assets/external/widget.js on mount (once per
 * page load — guarded against duplicate injection). Renders the standard
 * `.calendly-inline-widget` div that Calendly's script hydrates in place.
 *
 * The `url` prop is the full Calendly event URL (e.g.
 * https://calendly.com/financialmodelerpro/60-minute-modeling-hub-advisory-meeting)
 * and comes from page_sections.team → content.booking_url in admin.
 *
 * If `url` is empty this renders nothing so callers can show a fallback CTA.
 */

import { useEffect } from 'react';

const CALENDLY_SCRIPT_SRC = 'https://assets.calendly.com/assets/external/widget.js';

interface CalendlyEmbedProps {
  url: string;
  /** Desktop minHeight in px. Mobile stretches via CSS clamp below. Default 700. */
  minHeight?: number;
}

export function CalendlyEmbed({ url, minHeight = 700 }: CalendlyEmbedProps) {
  useEffect(() => {
    if (typeof window === 'undefined') return;
    if (document.querySelector(`script[src="${CALENDLY_SCRIPT_SRC}"]`)) return;
    const script = document.createElement('script');
    script.src   = CALENDLY_SCRIPT_SRC;
    script.async = true;
    document.body.appendChild(script);
    // The Calendly script persists across client-side navigations; no cleanup.
  }, []);

  if (!url) return null;

  return (
    <div
      className="calendly-inline-widget"
      data-url={url}
      style={{
        minWidth: 320,
        width: '100%',
        // 700 on desktop, grows on narrow viewports where Calendly stacks steps.
        height: `clamp(${minHeight}px, 90vh, 1100px)`,
        background: '#fff',
        borderRadius: 12,
        overflow: 'hidden',
        boxShadow: '0 4px 24px rgba(0,0,0,0.06)',
      }}
    />
  );
}
