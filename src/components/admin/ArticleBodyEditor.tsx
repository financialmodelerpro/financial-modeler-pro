'use client';

/**
 * ArticleBodyEditor.tsx (admin, client)
 *
 * The article body input, shared by the new + edit article pages. HTML-source ONLY:
 * a raw <textarea> whose value is stored VERBATIM as the article body. This is the
 * paste-and-go workflow, pasted pre-formatted HTML (inline styles, custom tags,
 * <figure>, <img>, pull-quotes, CTA boxes) survives end to end; the public page
 * renders it via dangerouslySetInnerHTML (sanitized at render).
 *
 * A prior rich-text (TipTap StarterKit) mode was REMOVED: StarterKit has no
 * figure/figcaption node, so switching to it silently flattened <figure>/<figcaption>
 * (dropping captions and repositioning images) which made figure edits fail to stick.
 * HTML source is now the single, lossless authoring surface.
 *
 * The parent owns the `body` string (via onChange) and saves it; this component
 * never talks to the save API. "Upload image" reuses /api/admin/media (cms-assets)
 * and inserts a clean captionable <figure> at the cursor. "+ Mid-image marker"
 * inserts {{MID_IMAGE}} at the cursor.
 *
 * No em dashes in this file.
 */

import { useRef, useState } from 'react';

/** Upload an image to the shared admin media endpoint; returns its public URL. */
export async function uploadMediaImage(file: File): Promise<string> {
  const fd = new FormData();
  fd.append('file', file);
  const res = await fetch('/api/admin/media', { method: 'POST', body: fd });
  if (!res.ok) {
    const j = await res.json().catch(() => ({}));
    throw new Error(j.error || 'Upload failed');
  }
  const j = await res.json();
  return j.url as string;
}

interface Props {
  /** Body HTML at mount (the loaded article, or '' for a new one). */
  initialHtml: string;
  /** Fired with the current body whenever it changes; the parent stores + saves it. */
  onChange: (html: string) => void;
  onWordCount?: (n: number) => void;
  notify?: (msg: string, type: 'success' | 'error') => void;
}

const TB_BTN: React.CSSProperties = { padding: '4px 10px', fontSize: 12, border: '1px solid #D1D5DB', borderRadius: 5, cursor: 'pointer', background: '#fff', color: '#374151' };

export function ArticleBodyEditor({ initialHtml, onChange, onWordCount, notify }: Props): React.JSX.Element {
  const [htmlSource, setHtmlSource] = useState<string>(initialHtml);
  const [uploading, setUploading] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);
  const taRef = useRef<HTMLTextAreaElement>(null);

  const onHtmlChange = (v: string): void => {
    setHtmlSource(v);
    onChange(v); // saved verbatim
    onWordCount?.(v.replace(/<[^>]+>/g, ' ').split(/\s+/).filter(Boolean).length);
  };

  const insertAtCursor = (text: string): void => {
    const ta = taRef.current;
    if (!ta) { onHtmlChange(htmlSource + text); return; }
    const start = ta.selectionStart ?? htmlSource.length;
    const end = ta.selectionEnd ?? start;
    onHtmlChange(htmlSource.slice(0, start) + text + htmlSource.slice(end));
  };

  const doUpload = async (file: File): Promise<void> => {
    setUploading(true);
    try {
      const url = await uploadMediaImage(file);
      // Insert a clean, captionable figure at the cursor. No inline styles: the public
      // page's .article-body figure/img/figcaption rules center it, size it responsively,
      // round it, and italicize the caption. The author edits the caption text (or
      // deletes the figcaption line to drop the caption).
      const figure = `\n<figure>\n  <img src="${url}" alt="" />\n  <figcaption>Add a caption…</figcaption>\n</figure>\n`;
      insertAtCursor(figure);
      notify?.('Image inserted as a figure. Edit the caption text (or remove the figcaption line).', 'success');
    } catch (e) {
      notify?.(e instanceof Error ? e.message : 'Upload failed', 'error');
    } finally {
      setUploading(false);
    }
  };

  return (
    <div style={{ background: '#fff', border: '1px solid #E8F0FB', borderRadius: 12, padding: 28 }}>
      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center', marginBottom: 12, borderBottom: '1px solid #E8F0FB', paddingBottom: 10 }}>
        <span style={{ fontSize: 11, fontWeight: 700, color: '#1B4F8A' }}>HTML source</span>
        <span style={{ fontSize: 11, color: '#6B7280' }}>Paste pre-formatted HTML; inline styles, figures and custom tags are kept verbatim.</span>

        <div style={{ flex: 1 }} />
        <button type="button" onClick={() => insertAtCursor('{{MID_IMAGE}}')} style={{ ...TB_BTN }} data-testid="article-insert-mid-marker" title="Insert the mid-image marker; the uploaded mid image renders here on the article page.">
          + Mid-image marker
        </button>
        <button type="button" onClick={() => fileRef.current?.click()} disabled={uploading} style={{ ...TB_BTN, opacity: uploading ? 0.6 : 1 }} data-testid="article-upload-image">
          {uploading ? 'Uploading…' : '📷 Upload image'}
        </button>
        <input ref={fileRef} type="file" accept="image/*" style={{ display: 'none' }} onChange={(e) => { const f = e.target.files?.[0]; if (f) void doUpload(f); e.target.value = ''; }} />
      </div>

      <textarea
        ref={taRef}
        value={htmlSource}
        onChange={(e) => onHtmlChange(e.target.value)}
        spellCheck={false}
        data-testid="article-html-source"
        placeholder="Paste your pre-formatted HTML here (inline styles, <figure>, <img>, pull-quotes, CTA boxes are kept verbatim)…"
        style={{ width: '100%', minHeight: 380, fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace', fontSize: 12.5, lineHeight: 1.6, color: '#1F2937', border: '1px solid #E5E7EB', borderRadius: 8, padding: 12, boxSizing: 'border-box', resize: 'vertical', background: '#FBFCFE' }}
      />
    </div>
  );
}
