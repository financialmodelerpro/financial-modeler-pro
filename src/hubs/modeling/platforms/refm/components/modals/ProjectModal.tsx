'use client';

import React from 'react';

interface ProjectModalProps {
  mode: 'new' | 'edit';
  initialName: string;
  initialLocation: string;
  pmInputVal: string;
  setPmInputVal: (v: string) => void;
  pmLocationVal: string;
  setPmLocationVal: (v: string) => void;
  onConfirm: (name: string, location: string) => void;
  onClose: () => void;
}

export default function ProjectModal({
  mode, initialName, initialLocation,
  pmInputVal, setPmInputVal,
  pmLocationVal, setPmLocationVal,
  onConfirm, onClose,
}: ProjectModalProps) {
  // Initialize values from props on first render
  const [name, setName] = React.useState(pmInputVal || initialName);
  const [location, setLocation] = React.useState(pmLocationVal || initialLocation);

  const handleConfirm = () => {
    if (!name.trim()) return;
    onConfirm(name.trim(), location.trim());
    setPmInputVal('');
    setPmLocationVal('');
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter') handleConfirm();
    if (e.key === 'Escape') onClose();
  };

  return (
    <div className="pm-modal-overlay" onClick={onClose}>
      <div className="pm-modal" onClick={e => e.stopPropagation()}>
        <div className="pm-modal-header">
          <div>
            <div style={{ fontSize: '15px', fontWeight: 700 }}>
              {mode === 'new' ? '🏗️ Create New Project' : '✏️ Edit Project'}
            </div>
            <div style={{ fontSize: '11px', color: 'rgba(255,255,255,0.5)', marginTop: '2px' }}>
              {mode === 'new' ? 'Define the project name and location' : 'Update project details'}
            </div>
          </div>
          <button
            onClick={onClose}
            style={{
              background: 'rgba(255,255,255,0.1)', border: 'none', borderRadius: '6px',
              width: '28px', height: '28px', cursor: 'pointer', color: 'white', fontSize: '14px',
              display: 'flex', alignItems: 'center', justifyContent: 'center',
            }}
          >
            ✕
          </button>
        </div>

        <div className="pm-modal-body">
          <div style={{ marginBottom: 'var(--sp-2)' }}>
            <label style={{
              display: 'block', fontSize: 'var(--font-meta)', fontWeight: 'var(--fw-semibold)',
              color: 'var(--color-body)', marginBottom: '6px',
              textTransform: 'uppercase', letterSpacing: '0.05em',
            }}>
              Project Name *
            </label>
            <input
              autoFocus
              type="text"
              value={name}
              onChange={e => setName(e.target.value)}
              onKeyDown={handleKeyDown}
              placeholder="e.g. Skyline Towers, Marina Residences..."
              style={{
                width: '100%', boxSizing: 'border-box',
                padding: '10px 12px',
                border: '1px solid var(--color-border)',
                borderRadius: 'var(--radius-sm)',
                fontSize: 'var(--font-body)',
                fontFamily: 'Inter, sans-serif',
              }}
            />
          </div>

          <div style={{ marginBottom: 'var(--sp-2)' }}>
            <label style={{
              display: 'block', fontSize: 'var(--font-meta)', fontWeight: 'var(--fw-semibold)',
              color: 'var(--color-body)', marginBottom: '6px',
              textTransform: 'uppercase', letterSpacing: '0.05em',
            }}>
              Location / City
            </label>
            <input
              type="text"
              value={location}
              onChange={e => setLocation(e.target.value)}
              onKeyDown={handleKeyDown}
              placeholder="e.g. Riyadh, Dubai, Cairo..."
              style={{
                width: '100%', boxSizing: 'border-box',
                padding: '10px 12px',
                border: '1px solid var(--color-border)',
                borderRadius: 'var(--radius-sm)',
                fontSize: 'var(--font-body)',
                fontFamily: 'Inter, sans-serif',
              }}
            />
          </div>

          <div style={{
            background: 'var(--color-navy-light)',
            border: '1px solid rgba(30,58,138,0.12)',
            borderRadius: 'var(--radius-sm)',
            padding: '10px 12px',
            fontSize: '12px', color: 'var(--color-meta)',
          }}>
            💡 A new project will be created with Draft status. You can save versions of the model to track changes over time.
          </div>
        </div>

        <div className="pm-modal-footer">
          <button
            className="btn-secondary"
            onClick={onClose}
          >
            Cancel
          </button>
          <button
            className="btn-primary"
            onClick={handleConfirm}
            disabled={!name.trim()}
          >
            {mode === 'new' ? '+ Create Project' : '✓ Save Changes'}
          </button>
        </div>
      </div>
    </div>
  );
}
