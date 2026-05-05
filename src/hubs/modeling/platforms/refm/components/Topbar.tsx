'use client';

/**
 * Topbar.tsx (M2.0b restored brand-styled toolbar)
 *
 * Phase M2.0b (2026-05-06): brings back the FMP brand identity that
 * the M2.0 slim shell stripped, navy gradient header, gold logo,
 * project/version dropdown context buttons, Save / Export pills,
 * RBAC badge, theme toggle, Hub link, Sign Out.
 *
 * Adapted to v5: project name + version metadata are passed in via
 * props from the v5-aware shell rather than read from the legacy
 * StorageProject blob.
 */

import React, { useCallback, useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { signOut } from 'next-auth/react';
import type { Role, PermissionMap } from '@/src/core/types/settings.types';
import { ROLE_META, useBrandingStore } from '@/src/core/state';
import { getPlatformLogo, DEFAULT_BRANDING } from '@/src/core/branding';
import OfficeColorPicker from '@/src/shared/components/ui/OfficeColorPicker';
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
  darkMode: boolean;
  onToggleDark: () => void;
}

// ── Quick Colour Panel (admin-only branding picker) ───────────────────────
function QuickColorPanel({
  pos,
  onClose,
}: {
  pos: { top: number; left: number };
  onClose: () => void;
}): React.JSX.Element {
  const branding = useBrandingStore((s) => s.branding);
  const updateField = useBrandingStore((s) => s.updateField);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const handler = (e: MouseEvent): void => {
      if (ref.current && !ref.current.contains(e.target as Node)) onClose();
    };
    setTimeout(() => document.addEventListener('mousedown', handler), 0);
    return () => document.removeEventListener('mousedown', handler);
  }, [onClose]);

  const panelW = 300;
  const left = Math.min(pos.left, window.innerWidth - panelW - 8);
  const top = pos.top + 6;

  return (
    <div
      ref={ref}
      style={{
        position: 'fixed',
        zIndex: 999999,
        top,
        left,
        width: panelW,
        background: 'var(--color-grey-white)',
        border: '1px solid var(--color-border)',
        borderRadius: 8,
        boxShadow: '0 8px 32px color-mix(in srgb, var(--color-heading) 22%, transparent)',
        padding: '12px 14px 14px',
        fontFamily: 'Inter, sans-serif',
      }}
      data-testid="quick-color-panel"
    >
      <div
        style={{
          fontSize: 11,
          fontWeight: 700,
          color: 'var(--color-grey-dark)',
          marginBottom: 12,
          textTransform: 'uppercase',
          letterSpacing: '0.07em',
        }}
      >
        Platform Colours
      </div>
      <div style={{ marginBottom: 12 }}>
        <OfficeColorPicker
          label="Primary Colour"
          desc="Buttons, active states, sidebar accents"
          value={branding.primaryColor || DEFAULT_BRANDING.primaryColor}
          onChange={(hex) => {
            if (hex) updateField('primaryColor', hex);
          }}
        />
      </div>
      <OfficeColorPicker
        label="Secondary / Accent"
        desc="Charts, highlights, badges"
        value={branding.secondaryColor || DEFAULT_BRANDING.secondaryColor}
        onChange={(hex) => {
          if (hex) updateField('secondaryColor', hex);
        }}
      />
      <div
        style={{
          marginTop: 12,
          paddingTop: 10,
          borderTop: '1px solid var(--color-border-light)',
          fontSize: 10,
          color: 'var(--color-muted)',
        }}
      >
        Changes apply instantly across the platform.
      </div>
    </div>
  );
}

// ── Topbar ────────────────────────────────────────────────────────────────
export default function Topbar({
  projectName,
  activeProjectData,
  activeVersionData,
  hasUnsaved,
  lastSavedAt,
  currentUserRole,
  can,
  onSave,
  onOpenProjects,
  onOpenVersions,
  onOpenRbac,
  onExportClick,
  darkMode,
  onToggleDark,
}: TopbarProps): React.JSX.Element {
  const roleMeta = ROLE_META[currentUserRole];
  const branding = useBrandingStore((s) => s.branding);
  const platformLogo = getPlatformLogo(branding);
  const displayName = branding.platformName;
  const displayLogo = platformLogo.type === 'image' ? platformLogo.value : null;
  const displayLogoEmoji = platformLogo.type === 'emoji' ? platformLogo.value : '🏗️';
  const [colorPanelOpen, setColorPanelOpen] = useState(false);
  const [colorPanelPos, setColorPanelPos] = useState({ top: 0, left: 0 });
  const colorBtnRef = useRef<HTMLButtonElement>(null);

  const handleColorBtn = useCallback((): void => {
    if (colorPanelOpen) {
      setColorPanelOpen(false);
      return;
    }
    const rect = colorBtnRef.current?.getBoundingClientRect();
    if (rect) setColorPanelPos({ top: rect.bottom, left: rect.left });
    setColorPanelOpen(true);
  }, [colorPanelOpen]);

  const closeColorPanel = useCallback((): void => setColorPanelOpen(false), []);

  return (
    <div className="pm-toolbar" data-testid="topbar">
      <span
        className="pm-brand"
        style={{ display: 'flex', alignItems: 'center', gap: '7px', flexShrink: 0 }}
      >
        {displayLogo ? (
          <img src={displayLogo} style={{ width: 18, height: 18, objectFit: 'contain' }} alt="logo" />
        ) : (
          <span style={{ fontSize: '16px' }}>{displayLogoEmoji}</span>
        )}
        <span
          style={{
            letterSpacing: '0.06em',
            textTransform: 'uppercase',
            fontSize: '11px',
            fontWeight: 700,
          }}
        >
          {displayName}
        </span>
      </span>

      <div className="pm-divider" />

      <button
        className="pm-btn ctx"
        onClick={onOpenProjects}
        title="Switch project"
        data-testid="topbar-open-project"
      >
        <span className="ctx-eyebrow">Project</span>
        <span style={{ display: 'flex', alignItems: 'center', gap: '4px', width: '100%' }}>
          <span className="ctx-name">{activeProjectData?.name ?? projectName ?? 'No project'}</span>
          <span className="ctx-arrow">▼</span>
        </span>
      </button>

      <button
        className="pm-btn ctx"
        onClick={onOpenVersions}
        title="Version management"
        data-testid="topbar-open-version"
      >
        <span className="ctx-eyebrow">Version</span>
        <span style={{ display: 'flex', alignItems: 'center', gap: '4px', width: '100%' }}>
          <span className="ctx-name">{activeVersionData?.name ?? 'Unsaved draft'}</span>
          <span className="ctx-arrow">▼</span>
        </span>
      </button>

      {hasUnsaved && (
        <span
          style={{
            width: '7px',
            height: '7px',
            borderRadius: '50%',
            background: 'var(--color-input-border)',
            flexShrink: 0,
            boxShadow: '0 0 6px color-mix(in srgb, var(--color-input-border) 70%, transparent)',
          }}
          title="Unsaved changes"
          data-testid="topbar-unsaved-dot"
        />
      )}
      {lastSavedAt && !hasUnsaved && (
        <span
          style={{
            fontSize: '10px',
            color: 'color-mix(in srgb, var(--color-on-primary-navy) 40%, transparent)',
            flexShrink: 0,
          }}
          data-testid="topbar-saved-stamp"
        >
          Saved {lastSavedAt}
        </span>
      )}

      <div style={{ flex: 1 }} />

      {can('canSave') && (
        <button
          className="pm-btn save"
          onClick={onSave}
          title="Save version"
          data-testid="topbar-save"
        >
          Save
          {hasUnsaved && (
            <span
              style={{
                width: '6px',
                height: '6px',
                borderRadius: '50%',
                background: 'var(--color-input-border)',
                marginLeft: '4px',
                display: 'inline-block',
              }}
            />
          )}
        </button>
      )}

      {can('canExport') && (
        <button
          className="pm-btn export-excel"
          title="Export"
          onClick={onExportClick}
          data-testid="topbar-open-export"
        >
          Export
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
              border: colorPanelOpen
                ? '1.5px solid var(--color-primary)'
                : '1.5px solid color-mix(in srgb, var(--color-on-primary-navy) 15%, transparent)',
              background: colorPanelOpen
                ? 'color-mix(in srgb, var(--color-primary) 15%, transparent)'
                : 'transparent',
              padding: '4px 9px',
              transition: 'border-color 0.15s, background 0.15s',
            }}
            data-testid="topbar-open-color-panel"
          >
            Colours
          </button>
          {colorPanelOpen && <QuickColorPanel pos={colorPanelPos} onClose={closeColorPanel} />}
        </>
      )}

      <div className="pm-divider" />

      <button
        className={`rbac-badge role-${currentUserRole}`}
        onClick={onOpenRbac}
        title={`Current role: ${roleMeta?.label}. Click to switch.`}
        data-testid="topbar-open-rbac"
      >
        <span>{roleMeta?.icon}</span>
        <span>{roleMeta?.label}</span>
      </button>

      <div className="pm-divider" />

      <Link href="/settings" className="portal-back-btn" title="Settings" data-testid="topbar-settings">
        Settings
      </Link>

      <button
        type="button"
        onClick={onToggleDark}
        className="portal-back-btn"
        title={darkMode ? 'Switch to light mode' : 'Switch to dark mode'}
        aria-label={darkMode ? 'Switch to light mode' : 'Switch to dark mode'}
        data-testid="topbar-toggle-dark"
      >
        {darkMode ? 'Light' : 'Dark'}
      </button>

      <Link
        href="/modeling/dashboard"
        className="portal-back-btn"
        title="Back to Modeling Hub"
        data-testid="topbar-hub"
      >
        Hub
      </Link>

      <button
        onClick={() => signOut({ callbackUrl: '/' })}
        className="portal-back-btn"
        title="Sign out"
        style={{
          border: '1px solid color-mix(in srgb, var(--color-negative) 40%, transparent)',
          color: 'var(--color-negative)',
        }}
        data-testid="topbar-signout"
      >
        Sign Out
      </button>
    </div>
  );
}
