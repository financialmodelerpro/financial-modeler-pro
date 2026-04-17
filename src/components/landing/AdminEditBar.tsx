'use client';

import Link from 'next/link';
import { useEffect, useState } from 'react';
import { broadcastEditMode, EDIT_MODE_EVENT, getEditMode } from '@/src/components/landing/InlineEdit';

export function AdminEditBar() {
  const [editMode, setEditModeState] = useState(true);

  useEffect(() => {
    setEditModeState(getEditMode());
    const handler = (e: Event) =>
      setEditModeState((e as CustomEvent<{ active: boolean }>).detail.active);
    window.addEventListener(EDIT_MODE_EVENT, handler);
    return () => window.removeEventListener(EDIT_MODE_EVENT, handler);
  }, []);

  const toggle = () => broadcastEditMode(!editMode);

  return (
    <div style={{
      position: 'fixed', top: 0, left: 0, right: 0, width: '100%', zIndex: 9999,
      background: editMode ? '#1B4F8A' : '#374151',
      color: '#fff', padding: '9px 24px',
      display: 'flex', alignItems: 'center', gap: 12,
      fontSize: 12, fontFamily: 'Inter, sans-serif',
      borderBottom: '1px solid rgba(255,255,255,0.12)',
      boxShadow: '0 2px 12px rgba(0,0,0,0.25)',
      transition: 'background 0.2s',
    }}>
      <span style={{ fontSize: 14 }}>{editMode ? '✏️' : '👁️'}</span>
      <span style={{ fontWeight: 700 }}>
        {editMode ? 'Edit Mode - hover any text to see editable fields, click to edit' : 'View Mode - editing paused'}
      </span>
      <div style={{ flex: 1 }} />
      <Link
        href="/admin/cms"
        target="_blank"
        style={{
          fontSize: 11, fontWeight: 700, padding: '5px 14px', borderRadius: 6,
          border: '1px solid rgba(255,255,255,0.4)', color: '#fff',
          textDecoration: 'none',
        }}
      >
        Admin Dashboard →
      </Link>
      <button
        onClick={toggle}
        style={{
          fontSize: 11, fontWeight: 700, padding: '5px 16px', borderRadius: 6,
          background: editMode ? 'rgba(255,255,255,0.15)' : '#1A7A30',
          color: '#fff', border: '1px solid rgba(255,255,255,0.3)',
          cursor: 'pointer', fontFamily: 'Inter, sans-serif',
          transition: 'background 0.15s',
        }}
      >
        {editMode ? 'Exit Edit Mode' : '✏️ Enter Edit Mode'}
      </button>
    </div>
  );
}
