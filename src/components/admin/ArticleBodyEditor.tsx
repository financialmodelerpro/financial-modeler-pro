'use client';

/**
 * ArticleBodyEditor.tsx (admin, client)
 *
 * The article body input, shared by the new + edit article pages. Two modes:
 *   - Rich text: the existing TipTap StarterKit editor (bold / italic / H2 / H3 /
 *     lists / quote), for quick edits.
 *   - HTML source: a raw <textarea> whose value is written VERBATIM to the article
 *     body, bypassing TipTap. This preserves pasted pre-formatted HTML (inline
 *     styles, classes, custom tags, <img>, pull-quotes, CTA boxes), which is the
 *     whole point of the paste-and-publish workflow. The public page renders the
 *     body with dangerouslySetInnerHTML, so raw HTML survives end to end.
 *
 * The parent owns the `body` string (via onChange) and saves it; this component
 * never talks to the save API. An "Upload image" control reuses the existing
 * admin media endpoint (/api/admin/media -> cms-assets bucket) and, in HTML mode,
 * inserts an <img> tag at the cursor; in rich mode it copies the URL (StarterKit
 * has no image node). Admin-gated by the media route itself.
 *
 * No em dashes in this file.
 */

import { useRef, useState } from 'react';
import { useEditor, EditorContent } from '@tiptap/react';
import StarterKit from '@tiptap/starter-kit';

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
  const [mode, setMode] = useState<'rich' | 'html'>('rich');
  const [htmlSource, setHtmlSource] = useState<string>(initialHtml);
  const [uploading, setUploading] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);
  const taRef = useRef<HTMLTextAreaElement>(null);

  const editor = useEditor({
    extensions: [StarterKit],
    content: initialHtml || '<p></p>',
    onUpdate: ({ editor }) => {
      // Fires only on rich-text edits; emit the rich HTML as the body.
      const html = editor.getHTML();
      onChange(html);
      onWordCount?.(editor.getText().split(/\s+/).filter(Boolean).length);
    },
  });

  const switchMode = (next: 'rich' | 'html'): void => {
    if (next === mode || !editor) return;
    if (next === 'html') {
      // Capture the current rich content as the starting HTML source.
      const html = editor.getHTML();
      setHtmlSource(html);
      onChange(html);
    } else {
      // Load the raw HTML back into TipTap. NOTE: StarterKit will simplify custom
      // HTML / drop inline styles, so warn; the saved body then follows rich edits.
      editor.commands.setContent(htmlSource || '<p></p>');
      onChange(editor.getHTML());
      notify?.('Rich-text mode simplifies custom HTML and can drop inline styles. Stay in HTML source to keep pasted formatting.', 'error');
    }
    setMode(next);
  };

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
      const tag = `<img src="${url}" alt="" style="max-width:100%;height:auto;" />`;
      if (mode === 'html') {
        insertAtCursor(tag);
        notify?.('Image uploaded and inserted into the HTML.', 'success');
      } else {
        try { await navigator.clipboard.writeText(url); } catch { /* clipboard may be unavailable */ }
        notify?.('Image uploaded, URL copied. Switch to HTML source to place it, or paste it as the cover.', 'success');
      }
    } catch (e) {
      notify?.(e instanceof Error ? e.message : 'Upload failed', 'error');
    } finally {
      setUploading(false);
    }
  };

  const RICH_BUTTONS: Array<{ label: string; cmd: () => void; active: () => boolean | undefined }> = [
    { label: 'B', cmd: () => editor?.chain().focus().toggleBold().run(), active: () => editor?.isActive('bold') },
    { label: 'I', cmd: () => editor?.chain().focus().toggleItalic().run(), active: () => editor?.isActive('italic') },
    { label: 'H2', cmd: () => editor?.chain().focus().toggleHeading({ level: 2 }).run(), active: () => editor?.isActive('heading', { level: 2 }) },
    { label: 'H3', cmd: () => editor?.chain().focus().toggleHeading({ level: 3 }).run(), active: () => editor?.isActive('heading', { level: 3 }) },
    { label: '• List', cmd: () => editor?.chain().focus().toggleBulletList().run(), active: () => editor?.isActive('bulletList') },
    { label: '1. List', cmd: () => editor?.chain().focus().toggleOrderedList().run(), active: () => editor?.isActive('orderedList') },
    { label: 'Quote', cmd: () => editor?.chain().focus().toggleBlockquote().run(), active: () => editor?.isActive('blockquote') },
  ];

  return (
    <div style={{ background: '#fff', border: '1px solid #E8F0FB', borderRadius: 12, padding: 28 }}>
      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center', marginBottom: 12, borderBottom: '1px solid #E8F0FB', paddingBottom: 10 }}>
        {/* Mode toggle */}
        <div style={{ display: 'inline-flex', border: '1px solid #D1D5DB', borderRadius: 6, overflow: 'hidden' }} data-testid="article-mode-toggle">
          {(['rich', 'html'] as const).map((m) => (
            <button key={m} type="button" onClick={() => switchMode(m)} style={{ padding: '4px 12px', fontSize: 12, fontWeight: mode === m ? 700 : 500, border: 'none', cursor: 'pointer', background: mode === m ? '#1B4F8A' : '#fff', color: mode === m ? '#fff' : '#374151' }}>
              {m === 'rich' ? 'Rich text' : 'HTML source'}
            </button>
          ))}
        </div>

        {mode === 'rich'
          ? RICH_BUTTONS.map((btn) => (
              <button key={btn.label} type="button" onClick={btn.cmd} style={{ ...TB_BTN, fontWeight: btn.active() ? 700 : 500, background: btn.active() ? '#1B4F8A' : '#fff', color: btn.active() ? '#fff' : '#374151' }}>{btn.label}</button>
            ))
          : <span style={{ fontSize: 11, color: '#6B7280' }}>Paste pre-formatted HTML, inline styles and custom tags are preserved verbatim.</span>}

        <div style={{ flex: 1 }} />
        <button type="button" onClick={() => fileRef.current?.click()} disabled={uploading} style={{ ...TB_BTN, opacity: uploading ? 0.6 : 1 }} data-testid="article-upload-image">
          {uploading ? 'Uploading…' : '📷 Upload image'}
        </button>
        <input ref={fileRef} type="file" accept="image/*" style={{ display: 'none' }} onChange={(e) => { const f = e.target.files?.[0]; if (f) void doUpload(f); e.target.value = ''; }} />
      </div>

      {mode === 'rich'
        ? <EditorContent editor={editor} style={{ minHeight: 300, fontSize: 14, lineHeight: 1.7, color: '#374151', outline: 'none' }} />
        : <textarea
            ref={taRef}
            value={htmlSource}
            onChange={(e) => onHtmlChange(e.target.value)}
            spellCheck={false}
            data-testid="article-html-source"
            placeholder="Paste your pre-formatted HTML here (inline styles, <img>, pull-quotes, CTA boxes are kept verbatim)…"
            style={{ width: '100%', minHeight: 380, fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace', fontSize: 12.5, lineHeight: 1.6, color: '#1F2937', border: '1px solid #E5E7EB', borderRadius: 8, padding: 12, boxSizing: 'border-box', resize: 'vertical', background: '#FBFCFE' }}
          />}
    </div>
  );
}
