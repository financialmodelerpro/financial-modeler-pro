'use client';

import { useEditor, EditorContent } from '@tiptap/react';
import StarterKit from '@tiptap/starter-kit';
import { useEffect } from 'react';

interface Props {
  value: string;
  onChange: (html: string) => void;
}

export function RichTextEditor({ value, onChange }: Props) {
  const editor = useEditor({
    extensions: [StarterKit],
    content: value || '<p></p>',
    onUpdate: ({ editor }) => {
      onChange(editor.getHTML());
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

  const btn = (label: string, cmd: () => void, active: boolean) => (
    <button
      key={label}
      type="button"
      onMouseDown={e => { e.preventDefault(); cmd(); }}
      style={{
        padding: '4px 10px', borderRadius: 5,
        border: `1px solid ${active ? '#1B4F8A' : '#D1D5DB'}`,
        background: active ? '#1B4F8A' : '#fff',
        color: active ? '#fff' : '#374151',
        fontSize: 12, fontWeight: 600, cursor: 'pointer', lineHeight: 1.4,
      }}
    >
      {label}
    </button>
  );

  return (
    <div style={{ border: '1px solid #D1D5DB', borderRadius: 7, overflow: 'hidden' }}>
      {/* Toolbar */}
      <div style={{ display: 'flex', gap: 5, flexWrap: 'wrap', padding: '8px 10px', background: '#F9FAFB', borderBottom: '1px solid #E5E7EB' }}>
        {btn('B',       () => editor.chain().focus().toggleBold().run(),          editor.isActive('bold'))}
        {btn('I',       () => editor.chain().focus().toggleItalic().run(),         editor.isActive('italic'))}
        {btn('• List',  () => editor.chain().focus().toggleBulletList().run(),     editor.isActive('bulletList'))}
        {btn('1. List', () => editor.chain().focus().toggleOrderedList().run(),    editor.isActive('orderedList'))}
        <div style={{ width: 1, background: '#E5E7EB', margin: '0 2px' }} />
        {btn('¶ Para',  () => editor.chain().focus().setParagraph().run(),         editor.isActive('paragraph'))}
      </div>

      {/* Editable area */}
      <div style={{ padding: '10px 12px', background: '#FFFBEB', minHeight: 120 }}>
        <style>{`
          .fmp-rte .ProseMirror { outline: none; font-size: 13px; line-height: 1.65; color: #374151; font-family: Inter, sans-serif; }
          .fmp-rte .ProseMirror p { margin: 0 0 0.65rem; }
          .fmp-rte .ProseMirror p:last-child { margin-bottom: 0; }
          .fmp-rte .ProseMirror ul, .fmp-rte .ProseMirror ol { padding-left: 1.4rem; margin-bottom: 0.65rem; }
          .fmp-rte .ProseMirror li { margin-bottom: 0.2rem; }
          .fmp-rte .ProseMirror strong { font-weight: 700; }
          .fmp-rte .ProseMirror em { font-style: italic; }
        `}</style>
        <div className="fmp-rte">
          <EditorContent editor={editor} />
        </div>
      </div>
    </div>
  );
}
