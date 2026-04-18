'use client';

/**
 * RichTextarea — universal rich text input used across the Page Builder.
 *
 * Phase 2A rewrite: backed by Tiptap. Preserves the original visual style
 * (padding/border/background/minHeight) and the selection-based floating
 * toolbar UX from the prior contentEditable version.
 *
 * Enter = new <p>. Shift+Enter = <br>. Output is HTML with real <p> tags so
 * the frontend .fmp-rich-text CSS handles paragraph spacing automatically.
 */

import { useEditor, EditorContent } from '@tiptap/react';
import StarterKit from '@tiptap/starter-kit';
import Underline from '@tiptap/extension-underline';
import Link from '@tiptap/extension-link';
import { Color } from '@tiptap/extension-color';
import { TextStyle } from '@tiptap/extension-text-style';
import { useEffect, useRef, useState, useCallback } from 'react';

// ── Custom mark: TextStyle + fontSize attribute ──────────────────────────────
const TextStyleWithFontSize = TextStyle.extend({
  addAttributes() {
    return {
      ...this.parent?.(),
      fontSize: {
        default: null as string | null,
        parseHTML: (el: HTMLElement) => el.style.fontSize || null,
        renderHTML: (attrs: { fontSize?: string }) => {
          if (!attrs.fontSize) return {};
          return { style: `font-size: ${attrs.fontSize}` };
        },
      },
    };
  },
});

const BRAND_COLORS: { label: string; value: string }[] = [
  { label: 'Black', value: '#000000' },
  { label: 'White', value: '#ffffff' },
  { label: 'Navy',  value: '#1B4F72' },
  { label: 'Teal',  value: '#2DD4BF' },
  { label: 'Green', value: '#27AE60' },
  { label: 'Gold',  value: '#F59E0B' },
  { label: 'Red',   value: '#EF4444' },
  { label: 'Gray',  value: '#6B7280' },
];

const SIZES = ['12px', '14px', '16px', '18px', '20px', '24px', '28px', '32px', '36px'];

interface Props {
  value: string;
  onChange: (html: string) => void;
  minHeight?: number;
  placeholder?: string;
}

export function RichTextarea({ value, onChange, minHeight = 60, placeholder }: Props) {
  const wrapRef = useRef<HTMLDivElement>(null);
  const [showToolbar, setShowToolbar] = useState(false);
  const [toolbarPos, setToolbarPos] = useState({ top: 0, left: 0 });
  const [showColors, setShowColors] = useState(false);

  const editor = useEditor({
    extensions: [
      StarterKit.configure({
        heading: false,             // headings not relevant for compact body fields
        codeBlock: false,
        horizontalRule: false,
      }),
      Underline,
      Link.configure({ openOnClick: false, autolink: true, HTMLAttributes: { rel: 'noopener noreferrer' } }),
      TextStyleWithFontSize,
      Color,
    ],
    content: normalizeContent(value),
    immediatelyRender: false,
    onUpdate: ({ editor: ed }) => {
      const html = ed.getHTML();
      onChange(html === '<p></p>' ? '' : html);
    },
  });

  // Sync external value → editor (parent re-render, load from API, etc.)
  useEffect(() => {
    if (!editor) return;
    const current = editor.getHTML();
    const next = normalizeContent(value);
    if (current !== next) {
      editor.commands.setContent(next, false);
    }
  }, [value, editor]);

  // Selection-based floating toolbar
  const updateToolbar = useCallback(() => {
    if (!editor || !wrapRef.current) return;
    const { from, to, empty } = editor.state.selection;
    const hasFocus = editor.isFocused;
    if (empty || !hasFocus || from === to) { setShowToolbar(false); setShowColors(false); return; }

    // Position toolbar above the current selection
    const sel = window.getSelection();
    if (!sel || !sel.rangeCount) { setShowToolbar(false); return; }
    const range = sel.getRangeAt(0);
    const rect  = range.getBoundingClientRect();
    const wrap  = wrapRef.current.getBoundingClientRect();
    if (!rect || rect.width === 0) { setShowToolbar(false); return; }
    setToolbarPos({
      top:  rect.top  - wrap.top - 42,
      left: Math.max(0, rect.left - wrap.left + rect.width / 2 - 180),
    });
    setShowToolbar(true);
  }, [editor]);

  useEffect(() => {
    if (!editor) return;
    editor.on('selectionUpdate', updateToolbar);
    editor.on('blur', () => setTimeout(() => { setShowToolbar(false); setShowColors(false); }, 150));
    return () => {
      editor.off('selectionUpdate', updateToolbar);
    };
  }, [editor, updateToolbar]);

  if (!editor) return null;

  const applyColor = (color: string) => {
    editor.chain().focus().setColor(color).run();
    setShowColors(false);
  };

  const applyFontSize = (size: string) => {
    if (!size) {
      // remove fontSize attribute while keeping other textStyle attrs
      editor.chain().focus().setMark('textStyle', { fontSize: null }).run();
    } else {
      editor.chain().focus().setMark('textStyle', { fontSize: size }).run();
    }
  };

  const openLink = () => {
    const prev = (editor.getAttributes('link').href as string) || '';
    const url = prompt('Link URL:', prev || 'https://');
    if (url === null) return;
    if (!url) {
      editor.chain().focus().extendMarkRange('link').unsetLink().run();
    } else {
      editor.chain().focus().extendMarkRange('link').setLink({ href: url }).run();
    }
  };

  const clearFormatting = () => {
    editor.chain().focus().unsetAllMarks().run();
  };

  const tbtn = (label: string, onClick: () => void, active: boolean, title: string) => (
    <button
      key={title}
      type="button"
      title={title}
      onMouseDown={e => { e.preventDefault(); onClick(); }}
      style={{
        minWidth: 24, height: 24, padding: '0 4px', borderRadius: 4,
        border: `1px solid ${active ? '#1B4F8A' : '#D1D5DB'}`,
        background: active ? '#1B4F8A' : '#fff',
        color: active ? '#fff' : '#374151',
        fontSize: 11, fontWeight: 700, cursor: 'pointer',
        display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
      }}
    >
      {label}
    </button>
  );

  const currentSize = (editor.getAttributes('textStyle').fontSize as string) || '';
  const currentColor = (editor.getAttributes('textStyle').color as string) || '';

  return (
    <div ref={wrapRef} style={{ position: 'relative' }}>
      {/* Floating selection toolbar */}
      {showToolbar && (
        <div
          style={{
            position: 'absolute',
            top: toolbarPos.top, left: toolbarPos.left, zIndex: 100,
            display: 'flex', gap: 3, padding: '4px 6px',
            background: '#fff', borderRadius: 6,
            border: '1px solid #D1D5DB', boxShadow: '0 4px 12px rgba(0,0,0,0.12)',
            alignItems: 'center',
          }}
          onMouseDown={e => e.preventDefault()}
        >
          {tbtn('B', () => editor.chain().focus().toggleBold().run(),      editor.isActive('bold'),      'Bold')}
          {tbtn('I', () => editor.chain().focus().toggleItalic().run(),    editor.isActive('italic'),    'Italic')}
          {tbtn('U', () => editor.chain().focus().toggleUnderline().run(), editor.isActive('underline'), 'Underline')}
          {tbtn('S', () => editor.chain().focus().toggleStrike().run(),    editor.isActive('strike'),    'Strikethrough')}
          <div style={{ width: 1, height: 18, background: '#E5E7EB', margin: '0 2px' }} />

          {/* Font size */}
          <select
            title="Font Size"
            value={currentSize}
            onChange={e => applyFontSize(e.target.value)}
            style={{ width: 50, height: 24, fontSize: 10, border: '1px solid #D1D5DB', borderRadius: 4, padding: '0 2px', cursor: 'pointer', background: '#fff' }}
          >
            <option value="">Size</option>
            {SIZES.map(s => <option key={s} value={s}>{s.replace('px','')}</option>)}
          </select>

          {/* Color */}
          <div style={{ position: 'relative' }}>
            <button
              type="button"
              title="Font Color"
              onMouseDown={e => { e.preventDefault(); setShowColors(v => !v); }}
              style={{
                width: 26, height: 24, borderRadius: 4, border: '1px solid #D1D5DB',
                background: '#fff', cursor: 'pointer',
                display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
                fontSize: 11, fontWeight: 700, color: currentColor || '#374151',
                position: 'relative',
              }}
            >
              A
              {currentColor && (
                <span style={{ position: 'absolute', bottom: 2, left: 4, right: 4, height: 3, background: currentColor, borderRadius: 1 }} />
              )}
            </button>
            {showColors && (
              <div style={{
                position: 'absolute', top: 28, left: -40, background: '#fff',
                border: '1px solid #D1D5DB', borderRadius: 6, padding: 6,
                display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 4,
                boxShadow: '0 4px 12px rgba(0,0,0,0.1)', zIndex: 101, width: 130,
              }}>
                {BRAND_COLORS.map(c => (
                  <button
                    key={c.value}
                    type="button"
                    title={c.label}
                    onMouseDown={e => { e.preventDefault(); applyColor(c.value); }}
                    style={{ width: 24, height: 24, borderRadius: 4, background: c.value, border: `1px solid ${c.value.toLowerCase() === '#ffffff' ? '#D1D5DB' : c.value}`, cursor: 'pointer' }}
                  />
                ))}
                <input
                  type="color"
                  title="Custom Color"
                  value={currentColor || '#000000'}
                  onChange={e => applyColor(e.target.value)}
                  onMouseDown={e => e.stopPropagation()}
                  style={{ gridColumn: '1 / -1', width: '100%', height: 24, marginTop: 4, padding: 1, border: '1px solid #D1D5DB', borderRadius: 4, cursor: 'pointer', background: '#fff' }}
                />
              </div>
            )}
          </div>

          <div style={{ width: 1, height: 18, background: '#E5E7EB', margin: '0 2px' }} />

          {/* Lists */}
          {tbtn('• UL', () => editor.chain().focus().toggleBulletList().run(),  editor.isActive('bulletList'),  'Bullet List')}
          {tbtn('1. OL', () => editor.chain().focus().toggleOrderedList().run(), editor.isActive('orderedList'), 'Numbered List')}

          <div style={{ width: 1, height: 18, background: '#E5E7EB', margin: '0 2px' }} />

          {/* Link */}
          {tbtn('🔗', openLink, editor.isActive('link'), 'Link')}

          {/* Clear */}
          {tbtn('✕', clearFormatting, false, 'Clear formatting')}
        </div>
      )}

      {/* Editor area — visually matches the old RichTextarea */}
      <div
        className="fmp-rta"
        data-empty={editor.isEmpty ? 'true' : 'false'}
        data-placeholder={placeholder}
        style={{
          width: '100%', padding: '7px 10px', fontSize: 13, borderRadius: 6,
          border: '1px solid #D1D5DB', background: '#F9FAFB',
          boxSizing: 'border-box', minHeight, fontFamily: 'inherit',
          lineHeight: 1.5, color: '#374151', overflowY: 'auto',
        }}
      >
        <EditorContent editor={editor} />
      </div>

      <style>{`
        .fmp-rta .ProseMirror { outline: none; min-height: inherit; }
        .fmp-rta .ProseMirror p { margin: 0 0 0.55rem; }
        .fmp-rta .ProseMirror p:last-child { margin-bottom: 0; }
        .fmp-rta .ProseMirror ul { list-style-type: disc; padding-left: 1.5rem; margin: 0 0 0.55rem; }
        .fmp-rta .ProseMirror ol { list-style-type: decimal; padding-left: 1.5rem; margin: 0 0 0.55rem; }
        .fmp-rta .ProseMirror li { margin-bottom: 0.2rem; }
        .fmp-rta .ProseMirror li > p { margin: 0; }
        .fmp-rta .ProseMirror strong { font-weight: 700; }
        .fmp-rta .ProseMirror em { font-style: italic; }
        .fmp-rta .ProseMirror u { text-decoration: underline; }
        .fmp-rta .ProseMirror s { text-decoration: line-through; }
        .fmp-rta .ProseMirror a { color: #1B4F8A; text-decoration: underline; cursor: pointer; }
        .fmp-rta .ProseMirror blockquote { border-left: 3px solid #2DD4BF; padding-left: 12px; margin: 0 0 0.55rem; color: #6B7280; font-style: italic; }
        .fmp-rta[data-empty="true"] .ProseMirror p:first-child::before {
          content: attr(data-placeholder);
          color: #9CA3AF;
          pointer-events: none;
          float: left;
          height: 0;
        }
      `}</style>
    </div>
  );
}

/** Tiptap wants at least `<p></p>` when content is empty. */
function normalizeContent(raw: string): string {
  if (!raw || !raw.trim()) return '<p></p>';
  // Content without any HTML tag — wrap in <p> so Tiptap parses it cleanly
  if (!/<[a-z][\s\S]*?>/i.test(raw)) {
    // preserve blank-line paragraph splits
    const paras = raw.split(/\n\n+/).map(s => s.trim()).filter(Boolean);
    if (paras.length === 0) return '<p></p>';
    return paras.map(p => `<p>${p.replace(/\n/g, '<br />')}</p>`).join('');
  }
  return raw;
}
