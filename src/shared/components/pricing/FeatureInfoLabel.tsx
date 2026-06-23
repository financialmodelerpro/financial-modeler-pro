'use client';

/**
 * FeatureInfoLabel.tsx
 *
 * Shared, accessible feature label for the pricing comparison tables (public
 * marketing + in-app). When a feature has a description, the label becomes a
 * button that toggles a short popover; with no description it renders as plain
 * text with NO info affordance. Used by both surfaces so they surface short
 * detail identically.
 *
 * Accessibility + behavior:
 *   - real <button> trigger with aria-expanded + aria-controls;
 *   - opens on click (works on mobile tap, not hover-only);
 *   - closes on Escape, outside click, scroll, or resize;
 *   - the popover renders in a portal to document.body with fixed positioning,
 *     so the comparison container's overflow/scroll never clips it.
 *
 * No em dashes in this file.
 */
import { useState, useRef, useEffect, useId, type ReactNode } from 'react';
import { createPortal } from 'react-dom';

const NAVY = '#0D2E5A';

export function FeatureInfoLabel({
  label, description, tag, color = '#334155', testidPrefix,
}: {
  label: string;
  description?: string | null;
  tag?: ReactNode;
  color?: string;
  testidPrefix?: string;
}) {
  const [open, setOpen] = useState(false);
  const [coords, setCoords] = useState<{ top: number; left: number } | null>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const id = useId();
  const has = !!(description && description.trim());

  const place = () => {
    const r = triggerRef.current?.getBoundingClientRect();
    if (!r) return;
    const W = 260;
    let left = r.left;
    if (left + W > window.innerWidth - 12) left = window.innerWidth - 12 - W;
    if (left < 12) left = 12;
    setCoords({ top: r.bottom + 6, left });
  };
  const toggle = () => { if (!open) place(); setOpen((o) => !o); };

  useEffect(() => {
    if (!open) return;
    const close = () => setOpen(false);
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setOpen(false); };
    const onDoc = (e: MouseEvent) => { if (triggerRef.current && !triggerRef.current.contains(e.target as Node)) setOpen(false); };
    window.addEventListener('scroll', close, true);
    window.addEventListener('resize', close);
    document.addEventListener('keydown', onKey);
    document.addEventListener('mousedown', onDoc);
    return () => {
      window.removeEventListener('scroll', close, true);
      window.removeEventListener('resize', close);
      document.removeEventListener('keydown', onKey);
      document.removeEventListener('mousedown', onDoc);
    };
  }, [open]);

  return (
    <span style={{ display: 'inline-flex', alignItems: 'center', gap: 8, minWidth: 0 }}>
      {has ? (
        <button ref={triggerRef} type="button" onClick={toggle}
          aria-expanded={open} aria-controls={`${id}-pop`}
          data-testid={testidPrefix ? `${testidPrefix}-trigger` : undefined}
          style={{ display: 'inline-flex', alignItems: 'center', gap: 6, background: 'none', border: 'none', padding: 0, margin: 0, font: 'inherit', color, fontWeight: 500, cursor: 'pointer', whiteSpace: 'nowrap' }}>
          <span style={{ borderBottom: '1px dotted #9aa6b6' }}>{label}</span>
          <span aria-hidden style={{ width: 14, height: 14, borderRadius: '50%', border: '1px solid #b6c0cf', color: '#64748b', fontSize: 9, fontWeight: 800, fontStyle: 'italic', display: 'inline-flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0, lineHeight: 1 }}>i</span>
        </button>
      ) : (
        <span style={{ color, fontWeight: 500, whiteSpace: 'nowrap' }}>{label}</span>
      )}
      {tag}
      {has && open && coords && typeof document !== 'undefined' && createPortal(
        <div id={`${id}-pop`} role="tooltip"
          data-testid={testidPrefix ? `${testidPrefix}-popover` : undefined}
          style={{ position: 'fixed', top: coords.top, left: coords.left, zIndex: 9999, width: 260, maxWidth: '88vw', background: NAVY, color: '#fff', fontSize: 12.5, fontWeight: 500, lineHeight: 1.55, padding: '10px 12px', borderRadius: 10, boxShadow: '0 12px 32px rgba(13,46,90,0.4)' }}>
          {description}
        </div>,
        document.body,
      )}
    </span>
  );
}
