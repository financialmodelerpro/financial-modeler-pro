'use client';

/**
 * PlatformGuideModal.tsx (rebuilt 2026-08-20)
 *
 * Full-screen in-platform viewer for the walkthrough guide. The user opens it,
 * reads, and closes back to exactly where they were: it is an overlay over the
 * live platform, not a route, so no navigation state is lost.
 *
 * Replaces the previous 760px centred dialog, which rendered ~40 sections as
 * one long scroll with no navigation and no search: finding Module 5 meant
 * scrolling past everything above it, which is what "not readable" was.
 *
 * Presentation only. Every sentence comes from the GuideDoc built by
 * platformGuide.ts out of guideContent.ts (the one content source shared with
 * the guided tour), and the Markdown + PDF downloads serialise the same doc,
 * so the four surfaces cannot diverge.
 *
 * Palette: design-system tokens only (var(--color-*)), which is the locked
 * palette. No literal colours in this file.
 *
 * No em dashes in this file.
 */
import React, { useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import type { GuideDoc, GuideSection } from '../../lib/guide/platformGuide';
import { guideToMarkdown } from '../../lib/guide/platformGuide';

function download(filename: string, data: BlobPart, type: string): void {
  const blob = new Blob([data], { type });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

/** DOM id for a section anchor. Section ids carry '/' (module1/costs). */
const domId = (id: string): string => `guide-sec-${id.replace(/[^a-zA-Z0-9-]/g, '_')}`;

/** Every string a section carries, for search. */
function sectionText(s: GuideSection): string {
  return [s.title, ...s.paragraphs, ...(s.steps ?? []), ...(s.bullets ?? [])].join(' ').toLowerCase();
}

/** A section matches when its own text matches, or any descendant does (so a
 *  match stays reachable through its parents). */
function matches(s: GuideSection, q: string): boolean {
  if (sectionText(s).includes(q)) return true;
  return (s.children ?? []).some((c) => matches(c, q));
}

function Section({ s, depth, q }: { s: GuideSection; depth: number; q: string }): React.JSX.Element | null {
  if (q && !matches(s, q)) return null;
  const isTop = depth <= 2;
  const isModule = depth === 3;
  return (
    <section id={domId(s.id)} style={{ marginTop: isTop ? 34 : isModule ? 26 : 18, scrollMarginTop: 12 }}>
      <h3 style={{
        fontSize: isTop ? 21 : isModule ? 17 : 14,
        fontWeight: 800,
        color: 'var(--color-heading)',
        margin: '0 0 8px',
        display: 'flex',
        alignItems: 'center',
        gap: 10,
        paddingBottom: isTop || isModule ? 6 : 0,
        borderBottom: isTop ? '2px solid var(--color-navy)' : isModule ? '1px solid var(--color-border)' : 'none',
      }}>
        {isTop && <span style={{ display: 'inline-block', width: 26, height: 4, background: 'var(--color-navy)', borderRadius: 2 }} />}
        {s.title}
      </h3>
      {s.paragraphs.map((p, i) => (
        <p key={i} style={{ fontSize: 13.5, lineHeight: 1.65, color: 'var(--color-text)', margin: '0 0 9px', maxWidth: 760 }}>{p}</p>
      ))}
      {!!s.steps?.length && (
        <ol style={{ margin: '0 0 10px', paddingLeft: 22, maxWidth: 760 }}>
          {s.steps.map((st, i) => (
            <li key={i} style={{ fontSize: 13, lineHeight: 1.6, color: 'var(--color-text)', marginBottom: 5 }}>{st}</li>
          ))}
        </ol>
      )}
      {!!s.bullets?.length && (
        <ul style={{ margin: '0 0 10px', paddingLeft: 22, maxWidth: 760 }}>
          {s.bullets.map((b, i) => (
            <li key={i} style={{ fontSize: 13, lineHeight: 1.6, color: 'var(--color-text)', marginBottom: 4 }}>{b}</li>
          ))}
        </ul>
      )}
      {s.children?.map((c) => <Section key={c.id} s={c} depth={depth + 1} q={q} />)}
    </section>
  );
}

export default function PlatformGuideModal({
  open,
  onClose,
  doc,
  dateLabel,
  onStartTour,
  onShowWelcome,
}: {
  open: boolean;
  onClose: () => void;
  doc: GuideDoc;
  dateLabel?: string;
  /** When provided, the guide offers to (re)start the guided tour. Closing the
   *  guide first is the caller's job inside this callback. */
  onStartTour?: () => void;
  /** Re-shows the first-run welcome prompt, so a one-click dismissal is a
   *  choice and not a dead end. Lives here because this is also where the
   *  tour restarts: one place for both re-entries. */
  onShowWelcome?: () => void;
}): React.JSX.Element | null {
  const [busy, setBusy] = useState(false);
  const [query, setQuery] = useState('');
  const bodyRef = useRef<HTMLDivElement | null>(null);
  const q = query.trim().toLowerCase();

  // The nav lists the top sections, and under "The modules" every module with
  // its tabs, so a reader can jump straight to a module or a single tab.
  const nav = useMemo(() => doc.sections.map((s) => ({
    id: s.id, title: s.title,
    children: s.id === 'modules'
      ? (s.children ?? []).map((m) => ({ id: m.id, title: m.title, children: (m.children ?? []).map((t) => ({ id: t.id, title: t.title })) }))
      : [],
  })), [doc]);

  if (!open || typeof document === 'undefined') return null;

  const jump = (id: string): void => {
    document.getElementById(domId(id))?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  };

  const downloadMarkdown = (): void => {
    download('Platform-Guide.md', guideToMarkdown(doc, dateLabel), 'text/markdown');
  };
  const downloadPdf = async (): Promise<void> => {
    setBusy(true);
    try {
      const { generateGuidePdf } = await import('../../lib/guide/guidePdf');
      const bytes = await generateGuidePdf(doc, dateLabel);
      download('Platform-Guide.pdf', bytes as BlobPart, 'application/pdf');
    } finally {
      setBusy(false);
    }
  };

  const btn = (primary: boolean): React.CSSProperties => ({
    fontSize: 12, fontWeight: 700, padding: '7px 14px', borderRadius: 8, cursor: busy ? 'default' : 'pointer',
    border: primary ? 'none' : '1px solid var(--color-border)',
    background: primary ? 'var(--color-primary)' : 'var(--color-surface)',
    color: primary ? 'var(--color-on-primary-navy)' : 'var(--color-heading)',
    opacity: busy ? 0.7 : 1,
  });
  const navBtn = (level: number): React.CSSProperties => ({
    display: 'block', width: '100%', textAlign: 'left', background: 'none', border: 'none', cursor: 'pointer',
    fontSize: level === 0 ? 12.5 : level === 1 ? 12 : 11.5,
    fontWeight: level === 0 ? 800 : level === 1 ? 700 : 400,
    color: level === 2 ? 'var(--color-meta)' : 'var(--color-heading)',
    padding: level === 0 ? '7px 10px 3px' : level === 1 ? '4px 10px 4px 18px' : '2px 10px 2px 30px',
    lineHeight: 1.35,
  });

  const content = (
    // FULL SCREEN, by requirement. No backdrop click-to-close: with the
    // overlay covering everything, a stray click must not throw the reader
    // out; Escape and the close button do that deliberately.
    <div
      style={{ position: 'fixed', inset: 0, zIndex: 2000, background: 'var(--color-surface)', display: 'flex', flexDirection: 'column', fontFamily: 'Inter, sans-serif' }}
      role="dialog"
      aria-modal="true"
      data-testid="platform-guide-modal"
      onKeyDown={(e) => { if (e.key === 'Escape') onClose(); }}
    >
      <div style={{ display: 'flex', alignItems: 'center', gap: 14, padding: '14px 22px', borderBottom: '2px solid var(--color-navy)', flexWrap: 'wrap' }}>
        <div style={{ minWidth: 220 }}>
          <div style={{ fontSize: 16, fontWeight: 800, color: 'var(--color-heading)' }}>{doc.title}</div>
          <div style={{ fontSize: 11.5, color: 'var(--color-meta)', marginTop: 1 }}>{doc.subtitle}{dateLabel ? ` · Updated ${dateLabel}` : ''}</div>
        </div>
        <input
          type="search"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Search the guide..."
          data-testid="guide-search"
          data-view-editable="true"
          style={{
            flex: 1, minWidth: 180, maxWidth: 360, fontSize: 12.5, padding: '7px 11px',
            border: '1px solid var(--color-border)', borderRadius: 8,
            background: 'var(--color-surface)', color: 'var(--color-text)',
          }}
        />
        <div style={{ display: 'flex', gap: 8, alignItems: 'center', marginLeft: 'auto' }}>
          {onShowWelcome && (
            <button type="button" style={btn(false)} onClick={onShowWelcome} data-testid="guide-show-welcome">Welcome tips</button>
          )}
          {onStartTour && (
            <button type="button" style={btn(false)} onClick={onStartTour} data-testid="guide-start-tour">Start guided tour</button>
          )}
          <button type="button" style={btn(false)} onClick={downloadMarkdown} data-testid="guide-download-md">Download .md</button>
          <button type="button" style={btn(true)} onClick={() => void downloadPdf()} disabled={busy} data-testid="guide-download-pdf">{busy ? 'Generating…' : 'Download PDF'}</button>
          <button type="button" onClick={onClose} data-testid="platform-guide-close" title="Close the guide (Esc)" style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--color-muted)', fontSize: 22, lineHeight: 1, padding: 4 }}>✕</button>
        </div>
      </div>

      <div style={{ display: 'flex', flex: 1, minHeight: 0 }}>
        <nav
          data-testid="guide-nav"
          style={{ width: 250, flexShrink: 0, overflowY: 'auto', borderRight: '1px solid var(--color-border)', padding: '10px 6px 24px', background: 'var(--color-surface)' }}
        >
          {nav.map((s) => (
            <div key={s.id}>
              <button type="button" style={navBtn(0)} onClick={() => jump(s.id)} data-testid={`guide-jump-${s.id}`}>{s.title}</button>
              {s.children.map((m) => (
                <div key={m.id}>
                  <button type="button" style={navBtn(1)} onClick={() => jump(m.id)} data-testid={`guide-jump-${m.id.replace(/\//g, '_')}`}>{m.title}</button>
                  {m.children.map((t) => (
                    <button key={t.id} type="button" style={navBtn(2)} onClick={() => jump(t.id)} data-testid={`guide-jump-${t.id.replace(/\//g, '_')}`}>{t.title}</button>
                  ))}
                </div>
              ))}
            </div>
          ))}
        </nav>

        <div ref={bodyRef} style={{ flex: 1, overflowY: 'auto', padding: '4px 34px 60px' }}>
          <p style={{ fontSize: 11.5, color: 'var(--color-meta)', fontStyle: 'italic', margin: '12px 0 0', maxWidth: 760 }}>{doc.generatedNote}</p>
          {q && !doc.sections.some((s) => matches(s, q)) && (
            <p data-testid="guide-search-empty" style={{ fontSize: 13, color: 'var(--color-meta)', marginTop: 20 }}>
              Nothing in the guide matches &quot;{query}&quot;. Clear the search to see every section.
            </p>
          )}
          {doc.sections.map((s) => <Section key={s.id} s={s} depth={2} q={q} />)}
        </div>
      </div>
    </div>
  );

  return createPortal(content, document.body);
}
