'use client';

import { useEditor, EditorContent } from '@tiptap/react';
import StarterKit from '@tiptap/starter-kit';
import Image from '@tiptap/extension-image';
import TextAlign from '@tiptap/extension-text-align';
import Link from '@tiptap/extension-link';
import { Color } from '@tiptap/extension-color';
import { TextStyle } from '@tiptap/extension-text-style';
import { useEffect, useRef } from 'react';

interface Props {
  value: string;
  onChange: (html: string) => void;
  /** Compact mode - smaller min-height, no heading buttons */
  compact?: boolean;
}

export function RichTextEditor({ value, onChange, compact }: Props) {
  const fileRef = useRef<HTMLInputElement>(null);

  const editor = useEditor({
    extensions: [
      StarterKit.configure({
        heading: { levels: [1, 2, 3] },
      }),
      Image.configure({ inline: false, allowBase64: true }),
      TextAlign.configure({ types: ['heading', 'paragraph'] }),
      Link.configure({ openOnClick: false, HTMLAttributes: { class: 'fmp-link' } }),
      TextStyle,
      Color,
    ],
    content: value || '<p></p>',
    onUpdate: ({ editor: ed }) => {
      onChange(ed.getHTML());
    },
  });

  // Sync external value (e.g. when CMS data loads from API)
  useEffect(() => {
    if (!editor) return;
    if (value !== editor.getHTML()) {
      editor.commands.setContent(value || '<p></p>', false);
    }
  }, [value, editor]);

  if (!editor) return null;

  function addImage() {
    const url = prompt('Image URL:');
    if (url) editor!.chain().focus().setImage({ src: url }).run();
  }

  function addLink() {
    const url = prompt('Link URL:', 'https://');
    if (url) {
      editor!.chain().focus().extendMarkRange('link').setLink({ href: url }).run();
    }
  }

  function removeLink() {
    editor!.chain().focus().unsetLink().run();
  }

  async function uploadImage(file: File) {
    try {
      const fd = new FormData();
      fd.append('file', file);
      fd.append('bucket', 'cms-assets');
      const res = await fetch('/api/admin/media', { method: 'POST', body: fd });
      const j = await res.json() as { url?: string };
      if (j.url) editor!.chain().focus().setImage({ src: j.url }).run();
    } catch { /* ignore */ }
  }

  const btn = (label: string, cmd: () => void, active: boolean, title?: string) => (
    <button
      key={label}
      type="button"
      title={title ?? label}
      onMouseDown={e => { e.preventDefault(); cmd(); }}
      style={{
        padding: '3px 8px', borderRadius: 4,
        border: `1px solid ${active ? '#1B4F8A' : '#D1D5DB'}`,
        background: active ? '#1B4F8A' : '#fff',
        color: active ? '#fff' : '#374151',
        fontSize: 12, fontWeight: 600, cursor: 'pointer', lineHeight: 1.4,
      }}
    >
      {label}
    </button>
  );

  const sep = <div key={Math.random()} style={{ width: 1, background: '#E5E7EB', margin: '0 2px', alignSelf: 'stretch' }} />;

  return (
    <div style={{ border: '1px solid #D1D5DB', borderRadius: 7, overflow: 'hidden' }}>
      {/* Toolbar */}
      <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap', padding: '6px 8px', background: '#F9FAFB', borderBottom: '1px solid #E5E7EB', alignItems: 'center' }}>
        {/* Text format */}
        {btn('B', () => editor.chain().focus().toggleBold().run(), editor.isActive('bold'), 'Bold')}
        {btn('I', () => editor.chain().focus().toggleItalic().run(), editor.isActive('italic'), 'Italic')}
        {btn('S', () => editor.chain().focus().toggleStrike().run(), editor.isActive('strike'), 'Strikethrough')}
        <input type="color" title="Text Color"
          value={editor.getAttributes('textStyle').color || '#000000'}
          onInput={e => editor.chain().focus().setColor((e.target as HTMLInputElement).value).run()}
          style={{ width: 28, height: 28, padding: 2, cursor: 'pointer', border: '1px solid #D1D5DB', borderRadius: 4, background: '#fff' }} />
        <select title="Font Size"
          value=""
          onChange={e => {
            const sz = e.target.value;
            if (sz) editor.chain().focus().setMark('textStyle', { fontSize: sz }).run();
            else editor.chain().focus().unsetMark('textStyle').run();
            e.target.value = '';
          }}
          style={{ fontSize: 11, height: 28, border: '1px solid #D1D5DB', borderRadius: 4, padding: '0 4px', cursor: 'pointer', color: '#374151' }}>
          <option value="">Size</option>
          <option value="9px">9</option>
          <option value="10px">10</option>
          <option value="11px">11</option>
          <option value="12px">12</option>
          <option value="14px">14</option>
          <option value="16px">16</option>
          <option value="18px">18</option>
          <option value="20px">20</option>
          <option value="24px">24</option>
          <option value="28px">28</option>
          <option value="32px">32</option>
        </select>
        {sep}

        {/* Headings */}
        {!compact && (
          <>
            {btn('H1', () => editor.chain().focus().toggleHeading({ level: 1 }).run(), editor.isActive('heading', { level: 1 }), 'Heading 1')}
            {btn('H2', () => editor.chain().focus().toggleHeading({ level: 2 }).run(), editor.isActive('heading', { level: 2 }), 'Heading 2')}
            {btn('H3', () => editor.chain().focus().toggleHeading({ level: 3 }).run(), editor.isActive('heading', { level: 3 }), 'Heading 3')}
            {btn('P', () => editor.chain().focus().setParagraph().run(), editor.isActive('paragraph'), 'Paragraph')}
            {sep}
          </>
        )}

        {/* Lists */}
        {btn('UL', () => editor.chain().focus().toggleBulletList().run(), editor.isActive('bulletList'), 'Bullet List')}
        {btn('OL', () => editor.chain().focus().toggleOrderedList().run(), editor.isActive('orderedList'), 'Numbered List')}
        {sep}

        {/* Alignment */}
        {btn('Left', () => editor.chain().focus().setTextAlign('left').run(), editor.isActive({ textAlign: 'left' }), 'Align Left')}
        {btn('Center', () => editor.chain().focus().setTextAlign('center').run(), editor.isActive({ textAlign: 'center' }), 'Align Center')}
        {btn('Right', () => editor.chain().focus().setTextAlign('right').run(), editor.isActive({ textAlign: 'right' }), 'Align Right')}
        {sep}

        {/* Links */}
        {btn('Link', addLink, editor.isActive('link'), 'Add Link')}
        {editor.isActive('link') && btn('Unlink', removeLink, false, 'Remove Link')}
        {sep}

        {/* Images */}
        {btn('IMG', addImage, false, 'Add Image (URL)')}
        {btn('Upload', () => fileRef.current?.click(), false, 'Upload Image')}
        <input ref={fileRef} type="file" accept="image/*" style={{ display: 'none' }}
          onChange={e => { if (e.target.files?.[0]) uploadImage(e.target.files[0]); e.target.value = ''; }} />

        {sep}
        {/* Block elements */}
        {btn('HR', () => editor.chain().focus().setHorizontalRule().run(), false, 'Horizontal Rule')}
        {btn('Quote', () => editor.chain().focus().toggleBlockquote().run(), editor.isActive('blockquote'), 'Blockquote')}
        {btn('Code', () => editor.chain().focus().toggleCodeBlock().run(), editor.isActive('codeBlock'), 'Code Block')}
      </div>

      {/* Editable area */}
      <div style={{ padding: '10px 12px', background: '#FFFBEB', minHeight: compact ? 80 : 160 }}>
        <style>{`
          .fmp-rte .ProseMirror { outline: none; font-size: 13px; line-height: 1.65; color: #374151; font-family: Inter, sans-serif; }
          .fmp-rte .ProseMirror p { margin: 0 0 0.65rem; }
          .fmp-rte .ProseMirror p:last-child { margin-bottom: 0; }
          .fmp-rte .ProseMirror h1 { font-size: 24px; font-weight: 800; color: #0D2E5A; margin: 0 0 0.5rem; line-height: 1.3; }
          .fmp-rte .ProseMirror h2 { font-size: 20px; font-weight: 800; color: #0D2E5A; margin: 0 0 0.5rem; line-height: 1.3; }
          .fmp-rte .ProseMirror h3 { font-size: 16px; font-weight: 700; color: #0D2E5A; margin: 0 0 0.5rem; line-height: 1.3; }
          .fmp-rte .ProseMirror ul, .fmp-rte .ProseMirror ol { padding-left: 1.4rem; margin-bottom: 0.65rem; }
          .fmp-rte .ProseMirror li { margin-bottom: 0.2rem; }
          .fmp-rte .ProseMirror strong { font-weight: 700; }
          .fmp-rte .ProseMirror em { font-style: italic; }
          .fmp-rte .ProseMirror img { max-width: 100%; height: auto; border-radius: 8px; margin: 8px 0; display: block; }
          .fmp-rte .ProseMirror blockquote { border-left: 3px solid #1B4F8A; padding-left: 12px; margin: 0 0 0.65rem; color: #6B7280; font-style: italic; }
          .fmp-rte .ProseMirror a, .fmp-rte .ProseMirror .fmp-link { color: #1B4F8A; text-decoration: underline; cursor: pointer; }
          .fmp-rte .ProseMirror pre { background: #1E293B; color: #E2E8F0; padding: 12px; border-radius: 6px; font-family: monospace; font-size: 12px; overflow-x: auto; margin: 0 0 0.65rem; }
          .fmp-rte .ProseMirror hr { border: none; border-top: 2px solid #E5E7EB; margin: 1rem 0; }
          .fmp-rte .ProseMirror [style*="text-align: center"] { text-align: center; }
          .fmp-rte .ProseMirror [style*="text-align: right"] { text-align: right; }
        `}</style>
        <div className="fmp-rte">
          <EditorContent editor={editor} />
        </div>
      </div>
    </div>
  );
}
