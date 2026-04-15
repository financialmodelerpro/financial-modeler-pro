'use client';

import { useState, useEffect, useRef } from 'react';

interface StudentNotesProps {
  sessionId: string;
  studentEmail: string;
}

export function StudentNotes({ sessionId, studentEmail }: StudentNotesProps) {
  const [notes, setNotes] = useState('');
  const [status, setStatus] = useState<'idle' | 'saving' | 'saved'>('idle');
  const [loaded, setLoaded] = useState(false);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  // Load existing notes
  useEffect(() => {
    fetch(`/api/training/session-notes?sessionId=${sessionId}&email=${encodeURIComponent(studentEmail)}`)
      .then(r => r.json())
      .then(d => setNotes(d.notes ?? ''))
      .catch(() => {})
      .finally(() => setLoaded(true));
  }, [sessionId, studentEmail]);

  async function save() {
    setStatus('saving');
    try {
      await fetch('/api/training/session-notes', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ session_id: sessionId, student_email: studentEmail, notes }),
      });
      setStatus('saved');
      setTimeout(() => setStatus('idle'), 2000);
    } catch {
      setStatus('idle');
    }
  }

  function wrapBold() {
    const ta = textareaRef.current;
    if (!ta) return;
    const start = ta.selectionStart;
    const end = ta.selectionEnd;
    const selected = notes.substring(start, end);
    if (selected) {
      const before = notes.substring(0, start);
      const after = notes.substring(end);
      setNotes(before + '**' + selected + '**' + after);
    }
  }

  function addBullet() {
    const ta = textareaRef.current;
    if (!ta) return;
    const pos = ta.selectionStart;
    const lineStart = notes.lastIndexOf('\n', pos - 1) + 1;
    const before = notes.substring(0, lineStart);
    const after = notes.substring(lineStart);
    setNotes(before + '• ' + after);
  }

  if (!loaded) return null;

  const toolBtn: React.CSSProperties = {
    padding: '4px 10px', fontSize: 13, fontWeight: 700,
    background: '#f3f4f6', border: '1px solid #e5e7eb',
    borderRadius: 4, cursor: 'pointer', color: '#374151',
  };

  return (
    <div style={{ marginTop: 24, background: '#fff', borderRadius: 10, border: '1px solid #e5e7eb', padding: 20 }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 10 }}>
        <h3 style={{ fontSize: 14, fontWeight: 700, color: '#111827', margin: 0 }}>Your Notes</h3>
        <span style={{ fontSize: 12, color: status === 'saved' ? '#16a34a' : '#9ca3af' }}>
          {status === 'saving' ? 'Saving...' : status === 'saved' ? 'Saved ✓' : ''}
        </span>
      </div>

      {/* Toolbar */}
      <div style={{ display: 'flex', gap: 4, marginBottom: 8 }}>
        <button onClick={wrapBold} style={toolBtn} title="Bold selected text">B</button>
        <button onClick={addBullet} style={toolBtn} title="Add bullet point">•</button>
      </div>

      <textarea
        ref={textareaRef}
        value={notes}
        onChange={e => setNotes(e.target.value)}
        onBlur={save}
        rows={6}
        placeholder="Type your notes here..."
        style={{
          width: '100%', padding: '10px 12px', fontSize: 14,
          border: '1px solid #e5e7eb', borderRadius: 8,
          resize: 'vertical', lineHeight: 1.6, color: '#374151',
          background: '#fafafa', outline: 'none',
          boxSizing: 'border-box',
        }}
      />
      <div style={{ fontSize: 11, color: '#9ca3af', marginTop: 6 }}>
        Your private notes — only visible to you
      </div>
    </div>
  );
}
