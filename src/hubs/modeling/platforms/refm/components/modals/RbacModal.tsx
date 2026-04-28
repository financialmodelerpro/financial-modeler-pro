'use client';

import React from 'react';
import type { Role } from '@/src/core/types/settings.types';
import { ROLES, ROLE_META, PERMISSIONS } from '@/src/core/state';

interface RbacModalProps {
  rbacSelectedRole: Role;
  setRbacSelectedRole: (r: Role) => void;
  onApply: (role: Role) => void;
  onClose: () => void;
}

const PERM_LABELS: Record<string, string> = {
  canCreateProject:  'Create Projects',
  canEditProject:    'Edit Projects',
  canDeleteProject:  'Delete Projects',
  canManageVersions: 'Manage Versions',
  canEditInputs:     'Edit Inputs',
  canSave:           'Save',
  canChangeBranding: 'Branding',
  canViewReports:    'View Reports',
  canAddComments:    'Add Comments',
  canExport:         'Export',
  canImport:         'Import',
};

export default function RbacModal({ rbacSelectedRole, setRbacSelectedRole, onApply, onClose }: RbacModalProps) {
  const roles = Object.values(ROLES) as Role[];

  return (
    <div className="rbac-modal-overlay" onClick={onClose}>
      <div className="rbac-modal" onClick={e => e.stopPropagation()}>
        <div className="rbac-modal-header">
          <div>
            <h2>Role Switcher</h2>
            <p>Select a role to simulate access permissions</p>
          </div>
          <button className="rbac-modal-close" onClick={onClose} title="Close">✕</button>
        </div>

        <div className="rbac-modal-body">
          {roles.map(role => {
            const meta = ROLE_META[role];
            const perms = PERMISSIONS[role];
            const isSelected = rbacSelectedRole === role;

            return (
              <div
                key={role}
                className={`rbac-role-card${isSelected ? ' selected' : ''}`}
                onClick={() => setRbacSelectedRole(role)}
              >
                <div
                  className="rbac-role-icon"
                  style={{ background: meta.bg }}
                >
                  {meta.icon}
                </div>
                <div className="rbac-role-card-content">
                  <div className="rbac-role-name">
                    <span style={{ color: meta.color }}>{meta.label}</span>
                    {isSelected && (
                      <span style={{
                        fontSize: '9px', fontWeight: 700, padding: '1px 7px',
                        borderRadius: '20px', background: 'rgba(59,130,246,0.2)',
                        color: '#93c5fd', border: '1px solid rgba(59,130,246,0.3)',
                      }}>
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
          <button className="rbac-cancel-btn" onClick={onClose}>Cancel</button>
          <button
            className="rbac-apply-btn"
            onClick={() => onApply(rbacSelectedRole)}
          >
            Apply Role - {ROLE_META[rbacSelectedRole]?.label}
          </button>
        </div>
      </div>
    </div>
  );
}
