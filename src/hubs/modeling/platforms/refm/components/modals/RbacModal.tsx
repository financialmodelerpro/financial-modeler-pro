'use client';

/**
 * RbacModal.tsx (M2.0b restored brand-styled role switcher)
 *
 * Phase M2.0b (2026-05-06): brings back the FMP brand role-card
 * grid (rbac-modal-overlay + rbac-modal + rbac-role-card) showing
 * each role's icon + label + description + per-permission ✓/✗
 * pills.
 */

import React from 'react';
import { createPortal } from 'react-dom';
import { ROLES, ROLE_META, PERMISSIONS } from '@/src/core/state';
import type { Role } from '@/src/core/types/settings.types';

interface RbacModalProps {
  open: boolean;
  onClose: () => void;
  currentRole: Role;
  selectedRole: Role;
  onSelectRole: (r: Role) => void;
  onApply: (role: Role) => void;
}

const PERM_LABELS: Record<string, string> = {
  canCreateProject: 'Create Projects',
  canEditProject: 'Edit Projects',
  canDeleteProject: 'Delete Projects',
  canManageVersions: 'Manage Versions',
  canEditInputs: 'Edit Inputs',
  canSave: 'Save',
  canChangeBranding: 'Branding',
  canViewReports: 'View Reports',
  canAddComments: 'Add Comments',
  canExport: 'Export',
  canImport: 'Import',
};

export default function RbacModal({
  open,
  onClose,
  currentRole,
  selectedRole,
  onSelectRole,
  onApply,
}: RbacModalProps): React.JSX.Element | null {
  if (!open) return null;
  if (typeof document === 'undefined') return null;
  void currentRole; // surfaced via SELECTED pill below; reserved for future audit log
  const roles = Object.values(ROLES) as Role[];

  const content = (
    <div className="rbac-modal-overlay" onClick={onClose} data-testid="rbac-modal">
      <div className="rbac-modal" onClick={(e) => e.stopPropagation()}>
        <div className="rbac-modal-header">
          <div>
            <h2>Role Switcher</h2>
            <p>Select a role to simulate access permissions</p>
          </div>
          <button
            className="rbac-modal-close"
            onClick={onClose}
            title="Close"
            data-testid="rbac-modal-close"
          >
            ✕
          </button>
        </div>

        <div className="rbac-modal-body">
          {roles.map((role) => {
            const meta = ROLE_META[role];
            const perms = PERMISSIONS[role];
            const isSelected = selectedRole === role;

            return (
              <div
                key={role}
                className={`rbac-role-card${isSelected ? ' selected' : ''}`}
                onClick={() => onSelectRole(role)}
                data-testid={`rbac-role-${role}`}
              >
                <div className="rbac-role-icon" style={{ background: meta.bg }}>
                  {meta.icon}
                </div>
                <div className="rbac-role-card-content">
                  <div className="rbac-role-name">
                    <span style={{ color: meta.color }}>{meta.label}</span>
                    {isSelected && (
                      <span
                        style={{
                          fontSize: '9px',
                          fontWeight: 700,
                          padding: '1px 7px',
                          borderRadius: '20px',
                          background: 'color-mix(in srgb, var(--color-primary) 20%, transparent)',
                          color:
                            'color-mix(in srgb, var(--color-on-primary-navy) 60%, var(--color-navy))',
                          border: '1px solid color-mix(in srgb, var(--color-primary) 30%, transparent)',
                        }}
                      >
                        SELECTED
                      </span>
                    )}
                  </div>
                  <div className="rbac-role-desc">{meta.desc}</div>
                  <div className="rbac-role-perms">
                    {Object.entries(perms).map(([perm, allowed]) => (
                      <span
                        key={perm}
                        className={`rbac-perm-tag ${allowed ? 'rbac-perm-allow' : 'rbac-perm-deny'}`}
                      >
                        {allowed ? '✓' : '✗'} {PERM_LABELS[perm] ?? perm}
                      </span>
                    ))}
                  </div>
                </div>
              </div>
            );
          })}
        </div>

        <div className="rbac-modal-footer">
          <button className="rbac-cancel-btn" onClick={onClose} data-testid="rbac-cancel">
            Cancel
          </button>
          <button
            className="rbac-apply-btn"
            onClick={() => onApply(selectedRole)}
            data-testid="rbac-apply"
          >
            Apply Role, {ROLE_META[selectedRole]?.label}
          </button>
        </div>
      </div>
    </div>
  );

  return createPortal(content, document.body);
}
