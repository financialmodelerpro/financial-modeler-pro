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

      {/* Pass 39 (2026-05-14): every topbar control now carries a
          multi-line title tooltip explaining what it does. The biggest
          source of confusion was Save vs Version - clarified that
          clicking Save creates a NEW timestamped snapshot under the
          currently selected project, and the Version dropdown is the
          history browser for jumping between those snapshots. */}

      <button
        className="pm-btn ctx"
        onClick={onOpenProjects}
        title={'PROJECT\n\nThe workspace you are editing. Each project carries its own assets, phases, costs and financing.\n\nClick to switch to another project, create a new one, or rename / delete the current one.'}
        data-testid="topbar-open-project"
      >
        <span className="ctx-eyebrow">Project</span>
        <span style={{ display: 'flex', alignItems: 'center', gap: '4px', width: '100%' }}>
          <span className="ctx-name">{activeProjectData?.name ?? projectName ?? 'No project'}</span>
          <span className="ctx-arrow">▼</span>
        </span>
      </button>

      {/* Pass 39 (2026-05-14): every topbar control now carries a
          multi-line title tooltip explaining what it does.
          Pass 40 (2026-05-14): visual differentiation - Version goes
          amber when on Unsaved draft, Save glows + pulses when dirty
          and shows a check when clean, and the right-edge cluster
          (Settings / Dark / Hub / Sign Out) is now compact icon
          buttons with descriptive hover tooltips, freeing horizontal
          space and reducing visual noise. */}

      <button
        className="pm-btn ctx"
        onClick={onOpenVersions}
        title={'VERSION\n\nA named snapshot of the project at a moment in time. Switching versions reloads the model from that snapshot - useful for comparing scenarios or recovering an older state.\n\n"Unsaved draft" means you are editing on top of the active version but have not saved a new snapshot yet. Hit Save to create one.'}
        data-testid="topbar-open-version"
        style={{
          background: !activeVersionData
            ? 'color-mix(in srgb, var(--color-warning, #92400e) 28%, transparent)'
            : undefined,
          borderColor: !activeVersionData
            ? 'color-mix(in srgb, var(--color-warning, #92400e) 65%, transparent)'
            : undefined,
        }}
      >
        <span className="ctx-eyebrow" style={{ display: 'flex', alignItems: 'center', gap: 3 }}>
          {!activeVersionData && <span style={{ fontSize: 10 }}>⚠</span>}
          Version
        </span>
        <span style={{ display: 'flex', alignItems: 'center', gap: '4px', width: '100%' }}>
          <span className="ctx-name">{activeVersionData?.name ?? 'Unsaved draft'}</span>
          <span className="ctx-arrow">▼</span>
        </span>
      </button>

      {lastSavedAt && !hasUnsaved && (
        <span
          style={{
            fontSize: '10px',
            fontWeight: 600,
            color: 'color-mix(in srgb, var(--color-success, #166534) 90%, white)',
            background: 'color-mix(in srgb, var(--color-success, #166534) 22%, transparent)',
            border: '1px solid color-mix(in srgb, var(--color-success, #166534) 45%, transparent)',
            padding: '2px 8px',
            borderRadius: 12,
            flexShrink: 0,
            display: 'inline-flex',
            alignItems: 'center',
            gap: 4,
            lineHeight: 1,
          }}
          title={`Last saved at ${lastSavedAt}. The current draft matches the active version on the server.`}
          data-testid="topbar-saved-stamp"
        >
          <span>✓</span> Saved {lastSavedAt}
        </span>
      )}

      <div style={{ flex: 1 }} />

      {can('canSave') && (
        <button
          className="pm-btn save"
          onClick={onSave}
          title={'SAVE\n\nCreates a new version snapshot of the current state, named with the current time (e.g. "Save 14:32:08"). Use the Version dropdown to view, name, or jump back between snapshots.\n\nTip: Save often. Snapshots are cheap and let you compare scenarios.'}
          data-testid="topbar-save"
          style={{
            position: 'relative',
            boxShadow: hasUnsaved
              ? '0 0 0 2px color-mix(in srgb, var(--color-success, #166534) 35%, transparent), 0 2px 8px color-mix(in srgb, var(--color-success, #166534) 50%, transparent)'
              : undefined,
            animation: hasUnsaved ? 'topbar-save-pulse 2s ease-in-out infinite' : undefined,
            opacity: hasUnsaved ? 1 : 0.85,
            paddingRight: hasUnsaved ? 16 : undefined,
          }}
        >
          {hasUnsaved ? (
            <>
              Save
              <span
                style={{
                  position: 'absolute',
                  top: -3,
                  right: -3,
                  width: 8,
                  height: 8,
                  borderRadius: '50%',
                  background: 'var(--color-warning, #f59e0b)',
                  border: '1.5px solid var(--color-primary-deep)',
                  boxShadow: '0 0 6px color-mix(in srgb, var(--color-warning, #f59e0b) 70%, transparent)',
                }}
                aria-label="unsaved changes"
              />
            </>
          ) : (
            <>
              <span style={{ fontSize: 11, marginRight: 2 }}>✓</span>
              Saved
            </>
          )}
        </button>
      )}

      {can('canExport') && (
        <button
          className="pm-btn export-excel"
          title={'EXPORT\n\nDownload the current model as Excel or PDF. Uses the active version data; save first if you want the export to match a specific snapshot.'}
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
            title={'COLOURS (admin)\n\nChange the platform Primary and Secondary colours. Affects buttons, charts, badges and accents across every workspace - this is a global brand setting, not per-project.'}
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
        title={`ROLE: ${roleMeta?.label}\n\nYour current role determines which actions you can take (save, export, change branding, edit assumptions). Click to open the role / permissions panel.`}
        data-testid="topbar-open-rbac"
      >
        <span>{roleMeta?.icon}</span>
        <span>{roleMeta?.label}</span>
      </button>

      <div className="pm-divider" />

      {/* Compact icon cluster: Settings, Dark, Hub, Sign Out */}
      <Link
        href="/settings"
        className="topbar-icon-btn"
        title={'SETTINGS\n\nAccount preferences (display name, currency defaults, notification settings). Opens the user settings page in the same tab.'}
        data-testid="topbar-settings"
        aria-label="Settings"
      >
        ⚙
      </Link>

      <button
        type="button"
        onClick={onToggleDark}
        className="topbar-icon-btn"
        title={darkMode
          ? 'Switch to LIGHT mode\n\nUI theme. Stored locally in your browser; does not affect other users.'
          : 'Switch to DARK mode\n\nUI theme. Stored locally in your browser; does not affect other users.'}
        aria-label={darkMode ? 'Switch to light mode' : 'Switch to dark mode'}
        data-testid="topbar-toggle-dark"
      >
        {darkMode ? '☀' : '🌙'}
      </button>

      <Link
        href="/modeling/dashboard"
        className="topbar-icon-btn"
        title={'HUB\n\nReturn to the Modeling Hub home page where you can pick a different platform (Real Estate, Business Valuation, etc.). Your current draft stays loaded - you can come back via the project list.'}
        data-testid="topbar-hub"
        aria-label="Modeling Hub"
      >
        ⌂
      </Link>

      <button
        onClick={() => signOut({ callbackUrl: '/' })}
        className="topbar-icon-btn"
        title={'SIGN OUT\n\nEnd your session and return to the public site. Unsaved draft changes are kept on the server so you can resume after signing back in.'}
        style={{
          color: 'var(--color-negative, #b91c1c)',
          borderColor: 'color-mix(in srgb, var(--color-negative, #b91c1c) 50%, transparent)',
        }}
        data-testid="topbar-signout"
        aria-label="Sign out"
      >
        ⏻
      </button>
    </div>
  );
}
