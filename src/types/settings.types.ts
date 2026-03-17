export type Role = 'admin' | 'analyst' | 'reviewer' | 'viewer';

export interface RoleMeta {
  label: string;
  icon: string;
  color: string;
  bg: string;
  dotColor: string;
  desc: string;
}

export type Permission =
  | 'canCreateProject' | 'canEditProject' | 'canDeleteProject'
  | 'canManageVersions' | 'canEditInputs' | 'canSave'
  | 'canChangeBranding' | 'canViewReports' | 'canAddComments'
  | 'canExport' | 'canImport';

export type PermissionMap = Record<Permission, boolean>;

export type ModuleKey =
  | 'dashboard' | 'projects' | 'overview'
  | 'module1' | 'module2' | 'module3'
  | 'module4' | 'module5' | 'module6';
