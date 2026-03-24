'use client';

import React, { useCallback, useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { signOut } from 'next-auth/react';
import type { Role } from '@/src/types/settings.types';
import type { PermissionMap } from '@/src/types/settings.types';
import { ROLE_META } from '@/src/core/core-state';
import { useWhiteLabel } from '@/src/hooks/useWhiteLabel';
import { useBrandingStore } from '@/src/core/core-state';
import OfficeColorPicker from '@/src/components/OfficeColorPicker';
import type { StorageProject } from './RealEstatePlatform';

interface TopbarProps {
  projectName: string;
  activeProjectData: StorageProject | null;
  activeVersionData: { name: string; createdAt: string; data: unknown } | null;
  hasUnsaved: boolean;
  lastSavedAt: string | null;
  currentUserRole: Role;
  can: (permission: keyof PermissionMap) => boolean;
  onSave: () => void;
  onOpenProjects: () => void;
  onOpenVersions: () => void;
  onOpenRbac: () => void;
  onExportClick?: () => void;
}

// ── Quick Colour Panel ────────────────────────────────────────────────────────
function QuickColorPanel({
  pos, onClose,
}: { pos: { top: number; left: number }; onClose: () => void }) {
  const branding    = useBrandingStore((s) => s.branding);
  const updateField = useBrandingStore((s) => s.updateField);
  const ref         = useRef<HTMLDivElement>(null);

  // Close on outside click
  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) onClose();
    };
    setTimeout(() => document.addEventListener('mousedown', handler), 0);
    return () => document.removeEventListener('mousedown', handler);
  }, [onClose]);

  // Keep panel on screen
  const panelW = 300;
  const left   = Math.min(pos.left, window.innerWidth - panelW - 8);
  const top    = pos.top + 6;

  return (
    <div
      ref={ref}
      style={{
        position: 'fixed', zIndex: 999999,
        top, left, width: panelW,
        background: 'var(--color-grey-white)',
        border: '1px solid #D0D0D0',
        borderRadius: 8,
        boxShadow: '0 8px 32px rgba(0,0,0,0.22)',
        padding: '12px 14px 14px',
        fontFamily: 'Inter, sans-serif',
      }}
    >
      <div style={{ fontSize: 11, fontWeight: 700, color: 'var(--color-grey-dark)', marginBottom: 12, textTransform: 'uppercase', letterSpacing: '0.07em' }}>
        🎨 Platform Colours
      </div>

      <div style={{ marginBottom: 12 }}>
        <OfficeColorPicker
          label="Primary Colour"
          desc="Buttons, active states, sidebar accents"
          value={branding.primaryColor || '#1B4F8A'}
          onChange={(hex) => {
            if (hex) updateField('primaryColor', hex);
          }}
        />
      </div>

      <OfficeColorPicker
        label="Secondary / Accent"
        desc="Charts, highlights, badges"
        value={branding.secondaryColor || '#2EAA4A'}
        onChange={(hex) => {
          if (hex) updateField('secondaryColor', hex);
        }}
      />

      <div style={{ marginTop: 12, paddingTop: 10, borderTop: '1px solid #F0F0F0', fontSize: 10, color: 'var(--color-muted)' }}>
        Changes apply instantly across the platform.
      </div>
    </div>
  );
}

// ── Topbar ────────────────────────────────────────────────────────────────────
export default function Topbar({
  projectName,
  activeProjectData, activeVersionData,
  hasUnsaved, lastSavedAt,
  currentUserRole, can,
  onSave, onOpenProjects, onOpenVersions, onOpenRbac,
  onExportClick,
}: TopbarProps) {
  const roleMeta = ROLE_META[currentUserRole];
  const { displayName, displayLogo, displayLogoEmoji } = useWhiteLabel();
  const [colorPanelOpen, setColorPanelOpen] = useState(false);
  const [colorPanelPos,  setColorPanelPos]  = useState({ top: 0, left: 0 });
  const colorBtnRef = useRef<HTMLButtonElement>(null);

  const handleColorBtn = useCallback(() => {
    if (colorPanelOpen) { setColorPanelOpen(false); return; }
    const rect = colorBtnRef.current?.getBoundingClientRect();
    if (rect) setColorPanelPos({ top: rect.bottom, left: rect.left });
    setColorPanelOpen(true);
  }, [colorPanelOpen]);

  const closeColorPanel = useCallback(() => setColorPanelOpen(false), []);

  return (
    <div className="pm-toolbar">
      {/* Brand */}
      <span className="pm-brand" style={{ display: 'flex', alignItems: 'center', gap: '7px', flexShrink: 0 }}>
        {displayLogo ? (
          <img src={displayLogo} style={{ width: 18, height: 18, objectFit: 'contain' }} alt="logo" />
        ) : (
          <span style={{ fontSize: '16px' }}>{displayLogoEmoji}</span>
        )}
        <span style={{ letterSpacing: '0.06em', textTransform: 'uppercase', fontSize: '11px', fontWeight: 700 }}>
          {displayName}
        </span>
      </span>

      <div className="pm-divider" />

      {/* Project context button */}
      <button
        className="pm-btn ctx"
        onClick={onOpenProjects}
        title="Switch project"
      >
        <span className="ctx-eyebrow">Project</span>
        <span style={{ display: 'flex', alignItems: 'center', gap: '4px', width: '100%' }}>
          <span className="ctx-name">
            {activeProjectData?.name ?? projectName ?? 'No project'}
          </span>
          <span className="ctx-arrow">▼</span>
        </span>
      </button>

      {/* Version context button */}
      <button
        className="pm-btn ctx"
        onClick={onOpenVersions}
        title="Version management"
      >
        <span className="ctx-eyebrow">Version</span>
        <span style={{ display: 'flex', alignItems: 'center', gap: '4px', width: '100%' }}>
          <span className="ctx-name">
            {activeVersionData?.name ?? 'Unsaved draft'}
          </span>
          <span className="ctx-arrow">▼</span>
        </span>
      </button>

      {/* Unsaved indicator */}
      {hasUnsaved && (
        <span style={{
          width: '7px', height: '7px', borderRadius: '50%',
          background: '#f59e0b', flexShrink: 0,
          boxShadow: '0 0 6px rgba(245,158,11,0.7)',
        }} title="Unsaved changes" />
      )}
      {lastSavedAt && !hasUnsaved && (
        <span style={{ fontSize: '10px', color: 'rgba(255,255,255,0.4)', flexShrink: 0 }}>
          Saved {lastSavedAt}
        </span>
      )}

      <div style={{ flex: 1 }} />

      {/* Action buttons */}
      {can('canSave') && (
        <button className="pm-btn save" onClick={onSave} title="Save version">
          💾 Save
          {hasUnsaved && (
            <span style={{
              width: '6px', height: '6px', borderRadius: '50%',
              background: '#fbbf24', marginLeft: '4px', display: 'inline-block',
            }} />
          )}
        </button>
      )}

      {can('canExport') && (
        <button
          className="pm-btn export-excel"
          title="Export"
          onClick={onExportClick}
        >
          📤 Export
        </button>
      )}

      {can('canChangeBranding') && (
        <>
          <button
            ref={colorBtnRef}
            className="pm-btn"
            onClick={handleColorBtn}
            title="Platform colour picker"
            style={{
              border: colorPanelOpen ? '1.5px solid #0078D4' : '1.5px solid rgba(255,255,255,0.15)',
              background: colorPanelOpen ? 'rgba(0,120,212,0.15)' : 'transparent',
              padding: '4px 9px',
              transition: 'border-color 0.15s, background 0.15s',
            }}
          >
            🎨
          </button>
          {colorPanelOpen && (
            <QuickColorPanel pos={colorPanelPos} onClose={closeColorPanel} />
          )}
        </>
      )}

      <div className="pm-divider" />

      {/* Role badge */}
      <button
        className={`rbac-badge role-${currentUserRole}`}
        onClick={onOpenRbac}
        title={`Current role: ${roleMeta?.label}. Click to switch.`}
      >
        <span>{roleMeta?.icon}</span>
        <span>{roleMeta?.label}</span>
      </button>

      <div className="pm-divider" />

      {/* Settings link */}
      <Link href="/settings" className="portal-back-btn" title="Settings">
        ⚙️
      </Link>

      {/* Portal link */}
      <Link href="/portal" className="portal-back-btn" title="Back to portal">
        ← Portal
      </Link>

      {/* Sign out */}
      <button
        onClick={() => signOut({ callbackUrl: '/' })}
        className="portal-back-btn"
        title="Sign out"
        style={{ border: '1px solid rgba(239,68,68,0.4)', color: '#fca5a5' }}
      >
        Sign Out
      </button>
    </div>
  );
}
