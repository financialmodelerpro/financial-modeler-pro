'use client';

import { useState } from 'react';

interface FeedbackModalProps {
  sessionTitle: string;
  onClose: () => void;
  onSubmit: (rating: number, comment: string) => void;
}

export function FeedbackModal({ sessionTitle, onClose, onSubmit }: FeedbackModalProps) {
  const [rating, setRating] = useState(5);
  const [comment, setComment] = useState('');
  return (
    <div onClick={e => { if (e.target === e.currentTarget) onClose(); }}
      style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.5)', zIndex: 650, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 24 }}>
      <div style={{ background: '#fff', borderRadius: 14, width: '100%', maxWidth: 420, padding: '24px 24px 20px', boxShadow: '0 16px 48px rgba(0,0,0,0.25)' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 14 }}>
          <div style={{ fontSize: 15, fontWeight: 800, color: '#0D2E5A' }}>⭐ Rate This Session</div>
          <button onClick={onClose} style={{ fontSize: 18, background: 'none', border: 'none', cursor: 'pointer', color: '#6B7280' }}>✕</button>
        </div>
        <div style={{ fontSize: 13, color: '#374151', marginBottom: 14, fontWeight: 600 }}>{sessionTitle}</div>
        <div style={{ display: 'flex', gap: 4, marginBottom: 14 }}>
          {[1,2,3,4,5].map(i => (
            <button key={i} onClick={() => setRating(i)}
              style={{ fontSize: 28, background: 'none', border: 'none', cursor: 'pointer', color: i <= rating ? '#F59E0B' : '#E5E7EB', padding: '0 2px' }}>
              ★
            </button>
          ))}
        </div>
        <textarea value={comment} onChange={e => setComment(e.target.value.slice(0, 300))} rows={3}
          placeholder="Optional comment (what did you learn? what can be improved?)"
          style={{ width: '100%', padding: '8px 10px', border: '1px solid #D1D5DB', borderRadius: 7, fontSize: 12, fontFamily: 'Inter,sans-serif', resize: 'none', boxSizing: 'border-box', color: '#374151', marginBottom: 14 }} />
        <div style={{ display: 'flex', gap: 8 }}>
          <button onClick={() => onSubmit(rating, comment)}
            style={{ flex: 1, padding: '10px', background: '#1B4F8A', color: '#fff', border: 'none', borderRadius: 7, fontSize: 13, fontWeight: 700, cursor: 'pointer' }}>
            Submit Feedback
          </button>
          <button onClick={onClose}
            style={{ padding: '10px 16px', background: '#F9FAFB', border: '1px solid #E5E7EB', borderRadius: 7, fontSize: 13, color: '#6B7280', cursor: 'pointer' }}>
            Skip
          </button>
        </div>
      </div>
    </div>
  );
}
