'use client';

import { useRef, useState, useEffect, useCallback } from 'react';

const BRAND_COLORS = [
  { label: 'Black', value: '#000000' },
  { label: 'White', value: '#ffffff' },
  { label: 'Navy', value: '#1B4F72' },
  { label: 'Teal', value: '#2DD4BF' },
  { label: 'Green', value: '#27AE60' },
  { label: 'Gold', value: '#F59E0B' },
  { label: 'Red', value: '#EF4444' },
  { label: 'Gray', value: '#6B7280' },
];

const SIZES = ['12', '14', '16', '18', '20', '24', '28', '32', '36'];

interface Props {
  value: string;
  onChange: (html: string) => void;
  minHeight?: number;
  placeholder?: string;
}

export function RichTextarea({ value, onChange, minHeight = 60, placeholder }: Props) {
  const editorRef = useRef<HTMLDivElement>(null);
  const [showToolbar, setShowToolbar] = useState(false);
  const [toolbarPos, setToolbarPos] = useState({ top: 0, left: 0 });
  const [showColors, setShowColors] = useState(false);
  const skipUpdate = useRef(false);

  // Sync external value
  useEffect(() => {
    if (!editorRef.current || skipUpdate.current) { skipUpdate.current = false; return; }
    if (editorRef.current.innerHTML !== value) {
      editorRef.current.innerHTML = value || '';
    }
  }, [value]);

  const handleInput = useCallback(() => {
    if (!editorRef.current) return;
    skipUpdate.current = true;
    onChange(editorRef.current.innerHTML);
  }, [onChange]);

  const handleSelect = useCallback(() => {
    const sel = window.getSelection();
    if (!sel || sel.isCollapsed || !sel.rangeCount || !editorRef.current?.contains(sel.anchorNode)) {
      setShowToolbar(false);
      return;
    }
    const range = sel.getRangeAt(0);
    const rect = range.getBoundingClientRect();
    const edRect = editorRef.current.getBoundingClientRect();
    setToolbarPos({
      top: rect.top - edRect.top - 38,
      left: Math.max(0, rect.left - edRect.left + rect.width / 2 - 120),
    });
    setShowToolbar(true);
    setShowColors(false);
  }, []);

  useEffect(() => {
    document.addEventListener('selectionchange', handleSelect);
    return () => document.removeEventListener('selectionchange', handleSelect);
  }, [handleSelect]);

  function exec(cmd: string, val?: string) {
    document.execCommand(cmd, false, val);
    editorRef.current?.focus();
    handleInput();
  }

  const tbtn = (label: string, cmd: string, title: string) => (
    <button
      key={cmd}
      type="button"
      title={title}
      onMouseDown={e => { e.preventDefault(); exec(cmd); }}
      style={{ width: 26, height: 26, borderRadius: 4, border: '1px solid #D1D5DB', background: '#fff', color: '#374151', fontSize: 12, fontWeight: 700, cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center' }}
    >
      {label}
    </button>
  );

  return (
    <div style={{ position: 'relative' }}>
      {/* Selection toolbar */}
      {showToolbar && (
        <div
          style={{
            position: 'absolute', top: toolbarPos.top, left: toolbarPos.left, zIndex: 100,
            display: 'flex', gap: 3, padding: '4px 6px', background: '#fff', borderRadius: 6,
            border: '1px solid #D1D5DB', boxShadow: '0 4px 12px rgba(0,0,0,0.12)',
            alignItems: 'center',
          }}
          onMouseDown={e => e.preventDefault()}
        >
          {tbtn('B', 'bold', 'Bold')}
          {tbtn('I', 'italic', 'Italic')}
          {tbtn('U', 'underline', 'Underline')}
          <div style={{ width: 1, height: 18, background: '#E5E7EB', margin: '0 2px' }} />
          <select
            title="Font Size"
            onChange={e => { if (e.target.value) exec('fontSize', '7'); /* placeholder, then override */ const sel = window.getSelection(); if (sel?.rangeCount) { const span = sel.anchorNode?.parentElement; if (span?.tagName === 'FONT') { span.removeAttribute('size'); (span as HTMLElement).style.fontSize = e.target.value + 'px'; } } handleInput(); e.target.value = ''; }}
            style={{ width: 42, height: 26, fontSize: 10, border: '1px solid #D1D5DB', borderRadius: 4, padding: '0 2px', cursor: 'pointer' }}
          >
            <option value="">Sz</option>
            {SIZES.map(s => <option key={s} value={s}>{s}</option>)}
          </select>
          <div style={{ position: 'relative' }}>
            <button
              type="button"
              title="Font Color"
              onMouseDown={e => { e.preventDefault(); setShowColors(!showColors); }}
              style={{ width: 26, height: 26, borderRadius: 4, border: '1px solid #D1D5DB', background: '#fff', fontSize: 10, cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center' }}
            >
              A
            </button>
            {showColors && (
              <div style={{ position: 'absolute', top: 30, left: -20, background: '#fff', border: '1px solid #D1D5DB', borderRadius: 6, padding: 6, display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 3, boxShadow: '0 4px 12px rgba(0,0,0,0.1)', zIndex: 101 }}>
                {BRAND_COLORS.map(c => (
                  <button
                    key={c.value}
                    type="button"
                    title={c.label}
                    onMouseDown={e => { e.preventDefault(); exec('foreColor', c.value); setShowColors(false); }}
                    style={{ width: 22, height: 22, borderRadius: 4, background: c.value, border: `1px solid ${c.value === '#ffffff' ? '#D1D5DB' : c.value}`, cursor: 'pointer' }}
                  />
                ))}
              </div>
            )}
          </div>
        </div>
      )}

      {/* Editable div (looks like textarea) */}
      <div
        ref={editorRef}
        contentEditable
        suppressContentEditableWarning
        onInput={handleInput}
        onBlur={() => setTimeout(() => setShowToolbar(false), 200)}
        data-placeholder={placeholder}
        style={{
          width: '100%', padding: '7px 10px', fontSize: 13, borderRadius: 6,
          border: '1px solid #D1D5DB', background: '#F9FAFB', outline: 'none',
          boxSizing: 'border-box', minHeight, fontFamily: 'inherit',
          lineHeight: 1.5, overflowY: 'auto', whiteSpace: 'pre-wrap',
          color: '#374151',
        }}
      />
      <style>{`
        [data-placeholder]:empty::before {
          content: attr(data-placeholder);
          color: #9CA3AF;
          pointer-events: none;
        }
      `}</style>
    </div>
  );
}
