'use client';

import React, { createElement, useCallback, useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';

// ── Edit-mode pub/sub (localStorage + custom event) ───────────────────────────
export const EDIT_MODE_KEY   = 'fmp_edit_mode';
export const EDIT_MODE_EVENT = 'fmp:editmode';

export function getEditMode(): boolean {
  if (typeof window === 'undefined') return true;
  return localStorage.getItem(EDIT_MODE_KEY) !== '0';
}
export function broadcastEditMode(active: boolean): void {
  if (typeof window === 'undefined') return;
  localStorage.setItem(EDIT_MODE_KEY, active ? '1' : '0');
  window.dispatchEvent(new CustomEvent(EDIT_MODE_EVENT, { detail: { active } }));
}

// ── Types ─────────────────────────────────────────────────────────────────────
type Tag = 'h1' | 'h2' | 'h3' | 'h4' | 'p' | 'span' | 'div';

interface Props {
  value:     string;
  section:   string;
  fieldKey:  string;
  tag?:      Tag;
  isAdmin:   boolean;
  style?:    React.CSSProperties;
  className?: string;
  darkBg?:   boolean; // hint: element sits on dark/navy background
}

// ── Component ─────────────────────────────────────────────────────────────────
export function InlineEdit({
  value, section, fieldKey, tag = 'span',
  isAdmin, style, className, darkBg,
}: Props) {
  const [editMode, setEditModeState] = useState(true);
  const [editing,  setEditing]       = useState(false);
  const [saving,   setSaving]        = useState(false);
  const [status,   setStatus]        = useState<'idle' | 'saved' | 'error'>('idle');
  const [hovered,  setHovered]       = useState(false);
  const [current,  setCurrent]       = useState(value);
  const [toolbarRect, setToolbarRect] = useState<DOMRect | null>(null);

  const contentRef  = useRef<HTMLElement>(null);
  const originalRef = useRef(value);
  const isBlock     = ['h1', 'h2', 'h3', 'h4', 'p', 'div'].includes(tag);

  // Sync edit-mode state
  useEffect(() => {
    setEditModeState(getEditMode());
    const handler = (e: Event) =>
      setEditModeState((e as CustomEvent<{ active: boolean }>).detail.active);
    window.addEventListener(EDIT_MODE_EVENT, handler);
    return () => window.removeEventListener(EDIT_MODE_EVENT, handler);
  }, []);

  // ── Editing actions ─────────────────────────────────────────────────────────
  const startEdit = useCallback(() => {
    if (!editMode) return;
    originalRef.current = current;
    setEditing(true);
    requestAnimationFrame(() => {
      const el = contentRef.current;
      if (!el) return;
      // Record position for portal toolbar
      setToolbarRect(el.getBoundingClientRect());
      el.focus();
      const range = document.createRange();
      const sel   = window.getSelection();
      range.selectNodeContents(el);
      range.collapse(false);
      sel?.removeAllRanges();
      sel?.addRange(range);
    });
  }, [editMode, current]);

  const cancel = useCallback(() => {
    if (contentRef.current) contentRef.current.innerText = originalRef.current;
    setEditing(false);
    setStatus('idle');
  }, []);

  const save = useCallback(async () => {
    const el = contentRef.current;
    if (!el) return;
    const newValue = el.innerText.trim();
    if (newValue === originalRef.current) { setEditing(false); return; }
    setSaving(true);
    try {
      const res = await fetch('/api/admin/content', {
        method:  'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({ section, key: fieldKey, value: newValue }),
      });
      if (res.ok) {
        setCurrent(newValue);
        originalRef.current = newValue;
        setEditing(false);
        setStatus('saved');
        setTimeout(() => setStatus('idle'), 2500);
      } else {
        setStatus('error');
        setTimeout(() => setStatus('idle'), 3500);
      }
    } catch {
      setStatus('error');
      setTimeout(() => setStatus('idle'), 3500);
    }
    setSaving(false);
  }, [section, fieldKey]);

  const onKeyDown = useCallback((e: React.KeyboardEvent) => {
    if (e.key === 'Escape') { e.preventDefault(); cancel(); }
    if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') { e.preventDefault(); save(); }
  }, [cancel, save]);

  // Update toolbar position on scroll while editing
  useEffect(() => {
    if (!editing) return;
    const update = () => setToolbarRect(contentRef.current?.getBoundingClientRect() ?? null);
    window.addEventListener('scroll', update, { passive: true });
    window.addEventListener('resize', update);
    return () => { window.removeEventListener('scroll', update); window.removeEventListener('resize', update); };
  }, [editing]);

  // ── Non-admin: plain element ────────────────────────────────────────────────
  if (!isAdmin) return createElement(tag, { style, className }, current);

  // ── Build element styles ────────────────────────────────────────────────────
  const borderColor = darkBg ? 'rgba(255,255,255,0.65)' : '#1B4F8A';

  const hoverOverlay: React.CSSProperties = editMode && hovered && !editing ? {
    outline:       `2px dashed ${borderColor}`,
    outlineOffset: 4,
    borderRadius:  4,
    cursor:        'text',
  } : {};

  const editingOverlay: React.CSSProperties = editing ? {
    outline:       `2px solid ${borderColor}`,
    outlineOffset: 4,
    borderRadius:  4,
    background:    darkBg ? 'rgba(255,255,255,0.07)' : 'rgba(27,79,138,0.04)',
    cursor:        'text',
  } : {};

  const elementStyle: React.CSSProperties = { ...style, ...hoverOverlay, ...editingOverlay };

  // ── Portal toolbar ──────────────────────────────────────────────────────────
  const toolbar = editing && toolbarRect && typeof document !== 'undefined'
    ? createPortal(
        <div
          style={{
            position: 'fixed',
            top:  toolbarRect.bottom + window.scrollY + 6 - window.scrollY,
            left: toolbarRect.left,
            zIndex: 9998,
            background: '#fff',
            border: '1px solid #E5E7EB',
            borderRadius: 8,
            boxShadow: '0 4px 24px rgba(0,0,0,0.15)',
            padding: '6px 8px',
            display: 'flex', alignItems: 'center', gap: 6,
            fontFamily: 'Inter, sans-serif',
          }}
          onMouseDown={(e) => e.preventDefault()} // prevent blur on click
        >
          <button
            onClick={save} disabled={saving}
            style={{ fontSize: 11, fontWeight: 700, padding: '5px 14px', borderRadius: 5, background: saving ? '#9CA3AF' : '#1A7A30', color: '#fff', border: 'none', cursor: saving ? 'default' : 'pointer', fontFamily: 'inherit' }}
          >
            {saving ? '…' : '✓ Save'}
          </button>
          <button
            onClick={cancel}
            style={{ fontSize: 11, fontWeight: 600, padding: '5px 10px', borderRadius: 5, background: '#F3F4F6', color: '#374151', border: '1px solid #E5E7EB', cursor: 'pointer', fontFamily: 'inherit' }}
          >
            ✕ Cancel
          </button>
          <span style={{ fontSize: 10, color: '#9CA3AF' }}>Ctrl+Enter · Esc</span>
        </div>,
        document.body,
      )
    : null;

  // ── Hover tooltip ───────────────────────────────────────────────────────────
  const tooltip = editMode && hovered && !editing ? (
    <div style={{
      position: 'absolute', top: -26, left: '50%', transform: 'translateX(-50%)',
      background: '#1B3A6B', color: '#fff',
      fontSize: 10, fontWeight: 600, padding: '3px 10px', borderRadius: 4,
      whiteSpace: 'nowrap', pointerEvents: 'none', zIndex: 300,
      boxShadow: '0 2px 8px rgba(0,0,0,0.25)',
    }}>
      ✏️ Click to edit
    </div>
  ) : null;

  // ── Status badge ────────────────────────────────────────────────────────────
  const badge = status !== 'idle' ? (
    <div style={{
      position: 'absolute', top: -10, right: 0,
      background: status === 'saved' ? '#1A7A30' : '#DC2626',
      color: '#fff', fontSize: 10, fontWeight: 700,
      padding: '2px 10px', borderRadius: 10,
      zIndex: 300, pointerEvents: 'none', whiteSpace: 'nowrap',
    }}>
      {status === 'saved' ? '✓ Saved' : '✗ Failed — try again'}
    </div>
  ) : null;

  // ── Render ──────────────────────────────────────────────────────────────────
  return (
    <div
      style={{ position: 'relative', display: isBlock ? 'block' : 'inline-block', margin: 0, padding: 0 }}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
    >
      {createElement(tag, {
        ref:                              contentRef,
        style:                            elementStyle,
        className,
        contentEditable:                  editing ? 'true' : undefined,
        suppressContentEditableWarning:   true,
        onClick:                          !editing && editMode ? startEdit : undefined,
        onKeyDown:                        editing ? onKeyDown : undefined,
        'data-fmp-editable':              'true',
      }, editing ? undefined : current)}
      {tooltip}
      {badge}
      {toolbar}
    </div>
  );
}
