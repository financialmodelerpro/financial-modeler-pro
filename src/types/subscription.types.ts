// ── Feature keys - single source of truth ────────────────────────────────────
export type FeatureKey =
  // Individual module access
  | 'module_1' | 'module_2' | 'module_3' | 'module_4'  | 'module_5'
  | 'module_6' | 'module_7' | 'module_8' | 'module_9'  | 'module_10' | 'module_11'
  // Module quality tiers
  | 'module_8_full' | 'module_9_full'
  // AI
  | 'ai_contextual' | 'ai_research'
  // Export
  | 'pdf_basic' | 'pdf_full' | 'pdf_whitelabel'
  | 'excel_static' | 'excel_formula'
  // Admin & branding
  | 'white_label' | 'admin_panel'
  // Limits
  | 'projects_10' | 'projects_unlimited';

export type SubscriptionPlan   = 'free' | 'professional' | 'enterprise';
export type SubscriptionStatus = 'active' | 'trial' | 'expired' | 'cancelled';

// ── Legacy shape (kept for compatibility) ─────────────────────────────────────
export interface UserSubscription {
  userId: string;
  plan: string;
  platforms: string[];
}

// ── Permission cache shape ────────────────────────────────────────────────────
export type PermissionCache = Partial<Record<FeatureKey, boolean>>;

// ── Feature registry row (from DB) ───────────────────────────────────────────
export interface FeatureRegistryRow {
  feature_key: FeatureKey;
  display_name: string;
  description: string | null;
  category: string;
}

// ── Plan permission row (from DB) ─────────────────────────────────────────────
export interface PlanPermissionRow {
  plan: SubscriptionPlan;
  feature_key: FeatureKey;
  enabled: boolean;
}

// ── User permission override row (from DB) ────────────────────────────────────
export interface UserPermissionRow {
  user_id: string;
  feature_key: FeatureKey;
  override_value: boolean;
  reason?: string | null;
}

// ── API response from /api/permissions ───────────────────────────────────────
export interface PermissionsApiResponse {
  plan: SubscriptionPlan;
  status: SubscriptionStatus;
  permissions: PermissionCache;
}

// ── What the admin matrix API returns ────────────────────────────────────────
export interface PermissionsMatrixResponse {
  features: FeatureRegistryRow[];
  matrix: Record<SubscriptionPlan, Record<string, boolean>>;
}
