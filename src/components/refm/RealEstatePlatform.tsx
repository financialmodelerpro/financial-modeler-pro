'use client';

import React, { useState, useEffect, useCallback } from 'react';
import type {
  ModelType, ProjectType, CostInputMode, FinancingMode,
  RepaymentMethod, CostItem, LandParcel, AreaMetrics, FinancingResult,
} from '@/src/core/types/project.types';
import { ROLES, ROLE_META, MODULE_VISIBILITY, PERMISSIONS, useBrandingStore } from '@/src/core/state';
import type { Role, ModuleKey, PermissionMap } from '@/src/core/types/settings.types';

import Topbar from './Topbar';
import Sidebar from './Sidebar';
import Dashboard from './Dashboard';
import ProjectsScreen from './ProjectsScreen';
import OverviewScreen from './OverviewScreen';
import Module1Timeline from './modules/Module1Timeline';
import Module1Area from './modules/Module1Area';
import Module1Costs from './modules/Module1Costs';
import Module1Financing from './modules/Module1Financing';
import ProjectModal from './modals/ProjectModal';
import VersionModal from './modals/VersionModal';
import RbacModal from './modals/RbacModal';
import ExportModal from './modals/ExportModal';
import UpgradePrompt from '@/src/shared/components/UpgradePrompt';

// ── Storage helpers ──────────────────────────────────────────────────────────
export interface StorageProject {
  name: string;
  createdAt: string;
  lastModified: string;
  location: string;
  status: 'Draft' | 'Active' | 'IC Review' | 'Approved' | 'Archived';
  assetMix: string[];
  versions: Record<string, { name: string; createdAt: string; data: unknown }>;
}

export interface StorageShape {
  projects: Record<string, StorageProject>;
  activeProjectId: string | null;
  activeVersionId: string | null;
}

const loadStorage = (): StorageShape => {
  if (typeof window === 'undefined') return { projects: {}, activeProjectId: null, activeVersionId: null };
  try {
    const raw = localStorage.getItem('refm_v2');
    if (!raw) return { projects: {}, activeProjectId: null, activeVersionId: null };
    return JSON.parse(raw) as StorageShape;
  } catch { return { projects: {}, activeProjectId: null, activeVersionId: null }; }
};

const saveStorage = (data: StorageShape) => {
  if (typeof window !== 'undefined') localStorage.setItem('refm_v2', JSON.stringify(data));
};

// ── Default cost items ───────────────────────────────────────────────────────
const makeDefaultCosts = (startId: number): CostItem[] => [
  { id: startId + 0,  name: 'Site Preparation',        method: 'rate_total_allocated', value: 15,    baseType: '', startPeriod: 1, endPeriod: 2, phasing: 'even', canDelete: true },
  { id: startId + 1,  name: 'Infrastructure',          method: 'rate_net_developable',  value: 80,   baseType: '', startPeriod: 1, endPeriod: 3, phasing: 'even', canDelete: true },
  { id: startId + 2,  name: 'Structural Works',        method: 'rate_gfa',              value: 400,  baseType: '', startPeriod: 1, endPeriod: 4, phasing: 'even', canDelete: true },
  { id: startId + 3,  name: 'MEP Works',               method: 'rate_gfa',              value: 150,  baseType: '', startPeriod: 2, endPeriod: 4, phasing: 'even', canDelete: true },
  { id: startId + 4,  name: 'Finishing Works',         method: 'rate_bua',              value: 200,  baseType: '', startPeriod: 3, endPeriod: 4, phasing: 'even', canDelete: true },
  { id: startId + 5,  name: 'Professional Fees',       method: 'percent_base',          value: 8,    baseType: 'construction', startPeriod: 1, endPeriod: 4, phasing: 'even', canDelete: true },
  { id: startId + 6,  name: 'Contingency',             method: 'percent_base',          value: 5,    baseType: 'construction', startPeriod: 1, endPeriod: 4, phasing: 'even', canDelete: true },
  { id: startId + 7,  name: 'Marketing & Sales',       method: 'percent_total_land',    value: 2,    baseType: '', startPeriod: 2, endPeriod: 4, phasing: 'even', canDelete: true },
  { id: startId + 8,  name: 'Project Management',      method: 'percent_base',          value: 3,    baseType: 'construction', startPeriod: 1, endPeriod: 4, phasing: 'even', canDelete: true },
  { id: startId + 9,  name: 'Legal & Admin',           method: 'percent_total_land',    value: 1,    baseType: '', startPeriod: 1, endPeriod: 2, phasing: 'even', canDelete: true },
  { id: startId + 10, name: 'Landscaping & External',  method: 'rate_net_developable',  value: 30,   baseType: '', startPeriod: 3, endPeriod: 4, phasing: 'even', canDelete: true },
  { id: startId + 11, name: 'FF&E / Interior Design',  method: 'rate_bua',              value: 50,   baseType: '', startPeriod: 4, endPeriod: 4, phasing: 'even', canDelete: true },
];

// ── Country data ─────────────────────────────────────────────────────────────
export const COUNTRY_DATA = [
  { name: 'Saudi Arabia',      flag: '🇸🇦', currency: 'SAR' },
  { name: 'United Arab Emirates', flag: '🇦🇪', currency: 'AED' },
  { name: 'Qatar',             flag: '🇶🇦', currency: 'QAR' },
  { name: 'Kuwait',            flag: '🇰🇼', currency: 'KWD' },
  { name: 'Bahrain',           flag: '🇧🇭', currency: 'BHD' },
  { name: 'Oman',              flag: '🇴🇲', currency: 'OMR' },
  { name: 'Jordan',            flag: '🇯🇴', currency: 'JOD' },
  { name: 'Egypt',             flag: '🇪🇬', currency: 'EGP' },
  { name: 'Turkey',            flag: '🇹🇷', currency: 'TRY' },
  { name: 'Pakistan',          flag: '🇵🇰', currency: 'PKR' },
  { name: 'India',             flag: '🇮🇳', currency: 'INR' },
  { name: 'China',             flag: '🇨🇳', currency: 'CNY' },
  { name: 'Japan',             flag: '🇯🇵', currency: 'JPY' },
  { name: 'Singapore',         flag: '🇸🇬', currency: 'SGD' },
  { name: 'Australia',         flag: '🇦🇺', currency: 'AUD' },
  { name: 'United States',     flag: '🇺🇸', currency: 'USD' },
  { name: 'United Kingdom',    flag: '🇬🇧', currency: 'GBP' },
  { name: 'European Union',    flag: '🇪🇺', currency: 'EUR' },
  { name: 'Canada',            flag: '🇨🇦', currency: 'CAD' },
  { name: 'South Africa',      flag: '🇿🇦', currency: 'ZAR' },
];

// ── Sidebar modules ───────────────────────────────────────────────────────────
export const sidebarModules = [
  { key: 'dashboard', icon: '📊', label: 'Dashboard',                  featureKey: null,        requiredPlan: null,           badge: null,   badgeClass: '' },
  { key: 'projects',  icon: '🏗️', label: 'Projects',                   featureKey: null,        requiredPlan: null,           badge: null,   badgeClass: '' },
  { key: 'overview',  icon: '📋', label: 'Overview',                   featureKey: null,        requiredPlan: null,           badge: null,   badgeClass: '',       disabledReason: 'Select a project first' },
  { key: 'module1',   icon: '🧱', label: 'Module 1 - Setup',           featureKey: 'module_1',  requiredPlan: 'free',         badge: '✓',    badgeClass: 'badge-done' },
  { key: 'module2',   icon: '💰', label: 'Module 2 - Revenue',         featureKey: 'module_2',  requiredPlan: 'free',         badge: 'SOON', badgeClass: 'badge-soon', disabled: true, disabledReason: 'Coming soon' },
  { key: 'module3',   icon: '📉', label: 'Module 3 - OpEx',            featureKey: 'module_3',  requiredPlan: 'free',         badge: 'SOON', badgeClass: 'badge-soon', disabled: true, disabledReason: 'Coming soon' },
  { key: 'module4',   icon: '📈', label: 'Module 4 - Returns',         featureKey: 'module_4',  requiredPlan: 'free',         badge: 'SOON', badgeClass: 'badge-soon', disabled: true, disabledReason: 'Coming soon' },
  { key: 'module5',   icon: '📑', label: 'Module 5 - Financials',      featureKey: 'module_5',  requiredPlan: 'free',         badge: 'SOON', badgeClass: 'badge-soon', disabled: true, disabledReason: 'Coming soon' },
  { key: 'module6',   icon: '📊', label: 'Module 6 - Reports',         featureKey: 'module_6',  requiredPlan: 'free',         badge: 'SOON', badgeClass: 'badge-soon', disabled: true, disabledReason: 'Coming soon' },
  { key: 'module7',   icon: '🔀', label: 'Module 7 - Scenarios',       featureKey: 'module_7',  requiredPlan: 'free',         badge: 'SOON', badgeClass: 'badge-soon', disabled: true, disabledReason: 'Coming soon' },
  { key: 'module8',   icon: '🏙️', label: 'Module 8 - Portfolio',       featureKey: 'module_8',  requiredPlan: 'free',         badge: 'SOON', badgeClass: 'badge-soon', disabled: true, disabledReason: 'Coming soon' },
  { key: 'module9',   icon: '📡', label: 'Module 9 - Market Data',     featureKey: 'module_9',  requiredPlan: 'free',         badge: 'SOON', badgeClass: 'badge-soon', disabled: true, disabledReason: 'Coming soon' },
  { key: 'module10',  icon: '🤝', label: 'Module 10 - Collaborate',    featureKey: 'module_10', requiredPlan: 'professional', disabled: true,  badge: null, badgeClass: '', disabledReason: 'Requires Professional plan' },
  { key: 'module11',  icon: '🔌', label: 'Module 11 - API Access',     featureKey: 'module_11', requiredPlan: 'enterprise',   disabled: true,  badge: null, badgeClass: '', disabledReason: 'Requires Enterprise plan' },
] as const;

export const m1Tabs = [
  { key: 'timeline',  icon: '📅', label: 'Timeline' },
  { key: 'area',      icon: '🗺️', label: 'Land & Area' },
  { key: 'costs',     icon: '💸', label: 'Dev Costs' },
  { key: 'financing', icon: '🏦', label: 'Financing' },
];

// ── Main component ────────────────────────────────────────────────────────────
export default function RealEstatePlatform() {
  // ── Navigation ──
  const [activeModule, setActiveModule] = useState('dashboard');
  const [activeTab, setActiveTab] = useState('timeline');
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
  const [sidebarSubOpen, setSidebarSubOpen] = useState(true);

  // ── Subscription / plan gating ──
  // Pre-launch: lock all premium features. Permissions system removed in Phase 5
  // of the admin cleanup; restore real plan-based gating before charging users.
  const canAccess = (_featureKey: string) => false;
  const subLoaded = true;
  const [upgradePrompt, setUpgradePrompt] = useState<{ featureKey: string; requiredPlan: 'professional' | 'enterprise' } | null>(null);
  const [exportModalOpen, setExportModalOpen] = useState(false);

  // ── RBAC ──
  const [currentUserRole, setCurrentUserRole] = useState<Role>(ROLES.ADMIN);
  const [rbacModalOpen, setRbacModalOpen] = useState(false);
  const [rbacSelectedRole, setRbacSelectedRole] = useState<Role>(ROLES.ADMIN);

  // ── Timeline state ──
  const [projectName, setProjectName] = useState('Skyline');
  const [projectType, setProjectType] = useState<ProjectType>('mixed-use');
  const [country, setCountry] = useState('Saudi Arabia');
  const [currency, setCurrency] = useState('SAR');
  const [modelType, setModelType] = useState<ModelType>('annual');
  const [projectStart, setProjectStart] = useState('2025-01-01');
  const [constructionPeriods, setConstructionPeriods] = useState(4);
  const [operationsPeriods, setOperationsPeriods] = useState(5);
  const [overlapPeriods, setOverlapPeriods] = useState(0);

  // ── Land & Area ──
  const [landParcels, setLandParcels] = useState<LandParcel[]>([
    { id: 1, name: 'Land 1', area: 100000, rate: 500, cashPct: 60, inKindPct: 40 },
  ]);
  const [projectRoadsPct, setProjectRoadsPct] = useState(10);
  const [projectFAR, setProjectFAR] = useState(1.5);
  const [projectNonEnclosedPct, setProjectNonEnclosedPct] = useState(0);
  const [residentialPercent, setResidentialPercent] = useState(50);
  const [hospitalityPercent, setHospitalityPercent] = useState(30);
  const [retailPercent, setRetailPercent] = useState(20);
  const [residentialDeductPct, setResidentialDeductPct] = useState(10);
  const [residentialEfficiency, setResidentialEfficiency] = useState(85);
  const [hospitalityDeductPct, setHospitalityDeductPct] = useState(15);
  const [hospitalityEfficiency, setHospitalityEfficiency] = useState(80);
  const [retailDeductPct, setRetailDeductPct] = useState(5);
  const [retailEfficiency, setRetailEfficiency] = useState(90);

  // ── Dev Costs ──
  const [residentialCosts, setResidentialCosts] = useState<CostItem[]>([]);
  const [hospitalityCosts, setHospitalityCosts] = useState<CostItem[]>([]);
  const [retailCosts, setRetailCosts] = useState<CostItem[]>([]);
  const [nextCostId, setNextCostId] = useState(100);
  const [costInputMode, setCostInputMode] = useState<CostInputMode>('separate');

  // ── Financing ──
  const [interestRate, setInterestRate] = useState(7.5);
  const [financingMode, setFinancingMode] = useState<FinancingMode>('fixed');
  const [globalDebtPct, setGlobalDebtPct] = useState(60);
  const [capitalizeInterest, setCapitalizeInterest] = useState(false);
  const [repaymentPeriods, setRepaymentPeriods] = useState(5);
  const [repaymentMethod, setRepaymentMethod] = useState<RepaymentMethod>('fixed');
  const [lineRatios, setLineRatios] = useState<Record<string, number>>({});

  // ── Stage / scope / dev-fee state (V14) ──
  const [costStage,     setCostStage]     = useState<Record<number, number>>({});
  const [costScope,     setCostScope]     = useState<Record<number, string>>({});
  const [costDevFeeMode, setCostDevFeeMode] = useState<Record<number, string>>({});
  const [allocBasis,    setAllocBasis]    = useState<'direct_cost' | 'gfa'>('direct_cost');

  // ── Project Manager ──
  const [pmModal, setPmModal] = useState<string | null>(null);
  const [activeProjectId, setActiveProjectId] = useState<string | null>(null);
  const [activeVersionId, setActiveVersionId] = useState<string | null>(null);
  const [pmToast, setPmToast] = useState<{ msg: string; color: string } | null>(null);
  const [pmInputVal, setPmInputVal] = useState('');
  const [pmLocationVal, setPmLocationVal] = useState('');
  const [lastSavedAt, setLastSavedAt] = useState<string | null>(null);
  const [hasUnsaved, setHasUnsaved] = useState(false);
  const [storageData, setStorageData] = useState<StorageShape>({ projects: {}, activeProjectId: null, activeVersionId: null });
  const [exportingExcel, setExportingExcel] = useState(false);
  const [exportingPdf,   setExportingPdf]   = useState(false);

  // ── Register current platform for per-platform branding overrides ──
  const setCurrentPlatform = useBrandingStore((s) => s.setCurrentPlatform);
  useEffect(() => {
    setCurrentPlatform('refm');
    return () => setCurrentPlatform(null);
  }, [setCurrentPlatform]);

  // ── Init from localStorage ──
  useEffect(() => {
    const s = loadStorage();
    setStorageData(s);
    if (s.activeProjectId) setActiveProjectId(s.activeProjectId);
    if (s.activeVersionId) setActiveVersionId(s.activeVersionId);
  }, []);

  // ── Default costs init (Land Cash id:1 canDelete:false + default items) ──
  useEffect(() => {
    if (residentialCosts.length === 0) {
      const initLandValue = (totalLandArea * cashPercent / 100) * (residentialPercent / 100) * landValuePerSqm;
      setResidentialCosts([
        { id: 1, name: 'Land (Cash Portion)', method: 'fixed', value: initLandValue, baseType: '', selectedIds: [], startPeriod: 0, endPeriod: 0, phasing: 'even', canDelete: false },
        ...makeDefaultCosts(2),
      ]);
    }
    if (hospitalityCosts.length === 0) {
      const initLandValue = (totalLandArea * cashPercent / 100) * (hospitalityPercent / 100) * landValuePerSqm;
      setHospitalityCosts([
        { id: 1, name: 'Land (Cash Portion)', method: 'fixed', value: initLandValue, baseType: '', selectedIds: [], startPeriod: 0, endPeriod: 0, phasing: 'even', canDelete: false },
        ...makeDefaultCosts(2),
      ]);
    }
    if (retailCosts.length === 0) {
      const initLandValue = (totalLandArea * cashPercent / 100) * (retailPercent / 100) * landValuePerSqm;
      setRetailCosts([
        { id: 1, name: 'Land (Cash Portion)', method: 'fixed', value: initLandValue, baseType: '', selectedIds: [], startPeriod: 0, endPeriod: 0, phasing: 'even', canDelete: false },
        ...makeDefaultCosts(2),
      ]);
    }
  }, []);  // eslint-disable-line react-hooks/exhaustive-deps

  // ── Keep Land Cash value in sync when land inputs change ──
  useEffect(() => {
    const updateLandCash = (prev: CostItem[], assetPct: number) => {
      if (prev.length === 0) return prev;
      const v = costInputMode === 'same-for-all'
        ? (totalLandArea * cashPercent / 100) * landValuePerSqm
        : (totalLandArea * cashPercent / 100) * (assetPct / 100) * landValuePerSqm;
      return prev.map(c => c.canDelete === false ? { ...c, value: v } : c);
    };
    setResidentialCosts(prev => updateLandCash(prev, residentialPercent));
    setHospitalityCosts(prev => updateLandCash(prev, hospitalityPercent));
    setRetailCosts(prev => updateLandCash(prev, retailPercent));
  }, [landParcels, residentialPercent, hospitalityPercent, retailPercent, costInputMode]); // eslint-disable-line react-hooks/exhaustive-deps

  // ── Body class for overflow ──
  useEffect(() => {
    document.body.classList.add('refm-active');
    return () => document.body.classList.remove('refm-active');
  }, []);

  // ── Toast auto-dismiss ──
  useEffect(() => {
    if (pmToast) {
      const t = setTimeout(() => setPmToast(null), 3000);
      return () => clearTimeout(t);
    }
  }, [pmToast]);

  // ── Mark unsaved on state changes ──
  useEffect(() => { setHasUnsaved(true); }, [
    projectName, projectType, country, currency, modelType,
    projectStart, constructionPeriods, operationsPeriods, overlapPeriods,
    landParcels, projectRoadsPct, projectFAR, projectNonEnclosedPct,
    residentialPercent, hospitalityPercent, retailPercent,
    residentialDeductPct, residentialEfficiency,
    hospitalityDeductPct, hospitalityEfficiency,
    retailDeductPct, retailEfficiency,
    residentialCosts, hospitalityCosts, retailCosts, costInputMode,
    interestRate, financingMode, globalDebtPct, capitalizeInterest,
    repaymentPeriods, repaymentMethod, lineRatios,
  ]);

  // ── Permissions ──
  const can = useCallback(
    (permission: keyof PermissionMap) => !!(PERMISSIONS[currentUserRole]?.[permission]),
    [currentUserRole]
  );
  const canSeeModule = useCallback(
    (moduleKey: string) => (MODULE_VISIBILITY[currentUserRole] || []).includes(moduleKey as ModuleKey),
    [currentUserRole]
  );

  // ── Land aggregates ──
  const totalLandArea   = landParcels.reduce((s, p) => s + (p.area || 0), 0);
  const totalLandValue  = landParcels.reduce((s, p) => s + p.area * p.rate, 0);
  const landValuePerSqm = totalLandArea > 0 ? totalLandValue / totalLandArea : 0;
  const cashValue       = landParcels.reduce((s, p) => s + p.area * p.rate * p.cashPct / 100, 0);
  const inKindValue     = totalLandValue - cashValue;
  const cashPercent     = totalLandValue > 0 ? (cashValue / totalLandValue) * 100 : 0;
  const inKindPercent   = 100 - cashPercent;

  // ── Area hierarchy ──
  const showResidential  = projectType === 'residential' || projectType === 'mixed-use';
  const showHospitality  = projectType === 'hospitality' || projectType === 'mixed-use';
  const showRetail       = retailPercent > 0;
  const projectRoadsArea = totalLandArea * (projectRoadsPct / 100);
  const projectNDA       = totalLandArea - projectRoadsArea;
  const totalProjectGFA  = projectNDA * projectFAR;
  const residentialGFA   = showResidential ? totalProjectGFA * (residentialPercent / 100) : 0;
  const hospitalityGFA   = showHospitality ? totalProjectGFA * (hospitalityPercent / 100) : 0;
  const retailGFA        = showRetail ? totalProjectGFA * (retailPercent / 100) : 0;
  const residentialBUA          = residentialGFA * (1 - residentialDeductPct / 100);
  const residentialNetSaleable  = residentialBUA * (residentialEfficiency / 100);
  const hospitalityBUA          = hospitalityGFA * (1 - hospitalityDeductPct / 100);
  const hospitalityNetSaleable  = hospitalityBUA * (hospitalityEfficiency / 100);
  const retailBUA               = retailGFA * (1 - retailDeductPct / 100);
  const retailNetSaleable       = retailBUA * (retailEfficiency / 100);

  // ── Project end date ──
  const getProjectEndDate = useCallback((): string => {
    const startDate = new Date(projectStart);
    const effectivePeriods = constructionPeriods + operationsPeriods - overlapPeriods;
    const totalMonths = modelType === 'monthly' ? effectivePeriods : effectivePeriods * 12;
    const endDate = new Date(startDate);
    endDate.setMonth(endDate.getMonth() + totalMonths);
    endDate.setDate(0);
    return endDate.toISOString().split('T')[0];
  }, [projectStart, constructionPeriods, operationsPeriods, overlapPeriods, modelType]);

  // ── Area helper ──
  const getAreas = useCallback((assetType: string): AreaMetrics => {
    const pct = assetType === 'residential' ? residentialPercent / 100
      : assetType === 'hospitality' ? hospitalityPercent / 100
      : assetType === 'retail' ? retailPercent / 100 : 1;
    const gfa  = totalProjectGFA * pct;
    const deductPct = assetType === 'residential' ? residentialDeductPct
      : assetType === 'hospitality' ? hospitalityDeductPct
      : assetType === 'retail' ? retailDeductPct : 0;
    const effPct = assetType === 'residential' ? residentialEfficiency
      : assetType === 'hospitality' ? hospitalityEfficiency
      : assetType === 'retail' ? retailEfficiency : 100;
    const bua = gfa * (1 - deductPct / 100);
    const nsa = bua * (effPct / 100);
    const landVal = totalLandValue * pct;
    return {
      totalAllocated: totalLandArea * pct,
      netDevelopable: projectNDA * pct,
      roadsArea:      projectRoadsArea * pct,
      gfa, bua, nsa,
      landValue:      landVal,
      cashLandValue:  landVal * (cashPercent / 100),
      inKindLandValue: landVal * (inKindPercent / 100),
    };
  }, [
    residentialPercent, hospitalityPercent, retailPercent,
    totalProjectGFA, totalLandArea, projectNDA, projectRoadsArea,
    totalLandValue, cashPercent, inKindPercent,
    residentialDeductPct, hospitalityDeductPct, retailDeductPct,
    residentialEfficiency, hospitalityEfficiency, retailEfficiency,
  ]);

  // ── Cost calculation ──
  const calculateItemTotal = useCallback((cost: CostItem, assetType: string, costsArr?: CostItem[]): number => {
    const a = getAreas(assetType);
    // Fix 1: In same-for-all mode, fixed amounts are project-level totals and must be
    // proportioned by this asset's land allocation share (restores legacy getSameForAllFactor).
    const getSameForAllFactor = (): number => {
      if (costInputMode !== 'same-for-all' || cost.canDelete === false) return 1;
      const totalAlloc =
        (showResidential ? residentialPercent : 0) +
        (showHospitality ? hospitalityPercent : 0) +
        (showRetail      ? retailPercent      : 0);
      if (totalAlloc <= 0) return 0;
      const thisAlloc = assetType === 'residential' ? residentialPercent
        : assetType === 'hospitality' ? hospitalityPercent
        : retailPercent;
      return thisAlloc / totalAlloc;
    };
    switch (cost.method) {
      case 'fixed':                 return cost.value * getSameForAllFactor();
      case 'rate_total_allocated':  return cost.value * a.totalAllocated;
      case 'rate_net_developable':  return cost.value * a.netDevelopable;
      case 'rate_roads':            return cost.value * a.roadsArea;
      case 'rate_gfa':              return cost.value * a.gfa;
      case 'rate_bua':              return cost.value * a.bua;
      case 'percent_total_land':    return (cost.value / 100) * a.landValue;
      case 'percent_cash_land':     return (cost.value / 100) * a.cashLandValue;
      case 'percent_inkind_land':   return (cost.value / 100) * a.inKindLandValue;
      case 'percent_base': {
        // Fix 2: Restore selectedIds mechanism - base = only explicitly checked items.
        const base = (cost.selectedIds ?? [])
          .filter(sid => sid !== cost.id)
          .map(sid => (costsArr ?? []).find(c => c.id === sid))
          .filter((c): c is CostItem => c !== undefined)
          // eslint-disable-next-line -- self-referential useCallback (safe: closure resolves at call time)
          .reduce((s, c) => s + calculateItemTotal(c, assetType, costsArr), 0);
        return (cost.value / 100) * base;
      }
      default: return 0;
    }
  }, [getAreas, costInputMode, showResidential, showHospitality, showRetail,
      residentialPercent, hospitalityPercent, retailPercent]);

  const getPhasingValues = useCallback((cost: CostItem): number[] => {
    if (typeof cost.phasing === 'string') return [];
    if (cost.phasing.type === 'manual' && cost.phasing.values) return cost.phasing.values;
    return [];
  }, []);

  const getPhasingMode = useCallback((cost: CostItem): string => {
    if (typeof cost.phasing === 'string') return cost.phasing;
    return cost.phasing.type;
  }, []);

  const distributeCost = useCallback((cost: CostItem, assetType: string): number[] => {
    const total = calculateItemTotal(cost, assetType);
    // Fix 3: Array length = constructionPeriods + 1; index 0 = period 0, index n = period n.
    const distribution = new Array(constructionPeriods + 1).fill(0);
    // Explicit period-0 handler: Land Cash, RETT, Royal Commission Premium, etc.
    if (cost.startPeriod === 0 && cost.endPeriod === 0) {
      distribution[0] = total;
      return distribution;
    }
    const mode = getPhasingMode(cost);
    if (mode === 'even') {
      const cnt = cost.endPeriod - cost.startPeriod + 1;
      const amt = cnt > 0 ? total / cnt : 0;
      for (let i = cost.startPeriod; i <= cost.endPeriod && i <= constructionPeriods; i++) {
        distribution[i] = amt;
      }
    } else {
      // Manual phasing: values are percentages summing to 100
      const pcts = getPhasingValues(cost);
      pcts.forEach((pct, idx) => {
        const p = cost.startPeriod + idx;
        if (p <= constructionPeriods) distribution[p] = total * (pct / 100);
      });
    }
    return distribution;
  }, [calculateItemTotal, constructionPeriods, getPhasingMode, getPhasingValues]);

  // ── Per-asset land values ──
  const residentialLandValue = showResidential ? totalLandArea * (residentialPercent / 100) * landValuePerSqm : 0;
  const hospitalityLandValue = showHospitality ? totalLandArea * (hospitalityPercent / 100) * landValuePerSqm : 0;
  const retailLandValue      = showRetail      ? totalLandArea * (retailPercent      / 100) * landValuePerSqm : 0;

  // ── Line-level debt helpers ──
  const getLineDebtPct = useCallback((name: string): number => {
    if (financingMode === 'fixed') return globalDebtPct;
    return lineRatios[name] !== undefined ? lineRatios[name] : globalDebtPct;
  }, [financingMode, globalDebtPct, lineRatios]);

  const setLineDebtPct = useCallback((name: string, val: number) => {
    setLineRatios(prev => ({ ...prev, [name]: Math.min(100, Math.max(0, parseFloat(String(val)) || 0)) }));
  }, []);

  // ── calcSameForAllDisplayTotal ──
  const calcSameForAllDisplayTotal = useCallback((cost: CostItem): number => {
    if (cost.canDelete === false) {
      const firstAsset = showResidential ? 'residential' : showHospitality ? 'hospitality' : 'retail';
      return calculateItemTotal(cost, firstAsset);
    }
    const assets = [
      ...(showResidential ? ['residential'] : []),
      ...(showHospitality ? ['hospitality'] : []),
      ...(showRetail      ? ['retail']      : []),
    ];
    return assets.reduce((sum, a) => sum + calculateItemTotal(cost, a), 0);
  }, [showResidential, showHospitality, showRetail, calculateItemTotal]);

  // ── Fix 6: calcItemTotalV14 - developer fee circular reference formula ──
  // When devFeeMode='include' and method='percent_base': total = base * rate / (1 - rate)
  const calcItemTotalV14 = useCallback((cost: CostItem, assetType: string, costsArr?: CostItem[]): number => {
    if (cost.method === 'percent_base' && costDevFeeMode[cost.id] === 'include') {
      const rate = (parseFloat(String(cost.value)) || 0) / 100;
      if (rate >= 1) return 0;
      const arr = costsArr ?? (assetType === 'residential' ? residentialCosts : assetType === 'hospitality' ? hospitalityCosts : retailCosts);
      const selectedBase = (cost.selectedIds ?? [])
        .filter(sid => sid !== cost.id)
        .map(sid => arr.find(c => c.id === sid))
        .filter((c): c is CostItem => c !== undefined)
        .reduce((sum, c) => sum + calculateItemTotal(c, assetType, arr), 0);
      return (selectedBase * rate) / (1 - rate);
    }
    return calculateItemTotal(cost, assetType, costsArr);
  }, [calculateItemTotal, costDevFeeMode, residentialCosts, hospitalityCosts, retailCosts]);

  // ── Fix 7: allocateToAssets - proportion of project-scope cost for an asset ──
  const allocateToAssets = useCallback((cost: CostItem, assetType: string): number => {
    const scope = costScope[cost.id] ?? (cost.id <= 4 ? 'asset' : 'project');
    if (scope === 'asset') return 1;
    const totalGFAAll =
      (showResidential ? residentialGFA : 0) +
      (showHospitality ? hospitalityGFA : 0) +
      (showRetail      ? retailGFA      : 0);
    if (allocBasis === 'gfa') {
      const assetGFA = assetType === 'residential' ? residentialGFA
        : assetType === 'hospitality' ? hospitalityGFA : retailGFA;
      return totalGFAAll > 0 ? assetGFA / totalGFAAll : 0;
    }
    // direct_cost basis: allocate by each asset's Stage-1 direct cost
    const getDirectCost = (a: string, arr: CostItem[]) =>
      arr.filter(c => (costScope[c.id] ?? (c.id <= 4 ? 'asset' : 'project')) === 'asset')
         .reduce((s, c) => s + calculateItemTotal(c, a, arr), 0);
    const directByAsset: Record<string, number> = {
      residential: showResidential ? getDirectCost('residential', residentialCosts) : 0,
      hospitality: showHospitality ? getDirectCost('hospitality', hospitalityCosts) : 0,
      retail:      showRetail      ? getDirectCost('retail',      retailCosts)      : 0,
    };
    const totalDirect = directByAsset.residential + directByAsset.hospitality + directByAsset.retail;
    return totalDirect > 0 ? (directByAsset[assetType] || 0) / totalDirect : 0;
  }, [costScope, showResidential, showHospitality, showRetail, allocBasis,
      residentialGFA, hospitalityGFA, retailGFA,
      residentialCosts, hospitalityCosts, retailCosts, calculateItemTotal]);

  // ── Fix 7: getAssetDirectCost - total cost for an asset using calcItemTotalV14 ──
  const getAssetDirectCost = useCallback((assetType: string): number => {
    const costs = assetType === 'residential' ? residentialCosts
      : assetType === 'hospitality' ? hospitalityCosts : retailCosts;
    return costs.reduce((sum, cost) => sum + calcItemTotalV14(cost, assetType, costs), 0);
  }, [calcItemTotalV14, residentialCosts, hospitalityCosts, retailCosts]);

  // ── Sync same-for-all to all assets ──
  const syncSameForAllToAllAssets = useCallback((masterCosts: CostItem[]) => {
    const nonLand = masterCosts.filter(c => c.canDelete !== false);
    if (showHospitality) setHospitalityCosts(prev => {
      const landLine = prev.find(c => c.canDelete === false);
      return [...(landLine ? [landLine] : []), ...nonLand.map(c => ({ ...c }))];
    });
    if (showRetail) setRetailCosts(prev => {
      const landLine = prev.find(c => c.canDelete === false);
      return [...(landLine ? [landLine] : []), ...nonLand.map(c => ({ ...c }))];
    });
  }, [showHospitality, showRetail]);

  // ── handleCostInputModeChange ──
  const handleCostInputModeChange = useCallback((newMode: CostInputMode) => {
    if (newMode === 'same-for-all') syncSameForAllToAllAssets(residentialCosts);
    setCostInputMode(newMode);
  }, [syncSameForAllToAllAssets, residentialCosts]);

  // ── buildAssetFinancing ──
  const buildAssetFinancing = useCallback((assetType: string): FinancingResult => {
    const costs = assetType === 'residential' ? residentialCosts
      : assetType === 'hospitality' ? hospitalityCosts
      : retailCosts;

    const totalPeriods = constructionPeriods + operationsPeriods;
    const periodicRate = (interestRate / 100) / (modelType === 'monthly' ? 12 : 1);

    // Fix 7: Same-for-all proportioning for locked land rows (canDelete=false).
    // In same-for-all mode these store the full project value; apply asset-allocation factor.
    const bafAllocMap: Record<string, number> = {
      residential: residentialPercent,
      hospitality: hospitalityPercent,
      retail:      retailPercent,
    };
    const bafVisibleAssets = [
      ...(showResidential ? ['residential'] : []),
      ...(showHospitality ? ['hospitality'] : []),
      ...(showRetail      ? ['retail']      : []),
    ];
    const bafTotalAllocPct = bafVisibleAssets.reduce((s, a) => s + (bafAllocMap[a] || 0), 0);

    const getProportionedDist = (cost: CostItem): number[] => {
      if (costInputMode === 'same-for-all' && cost.canDelete === false) {
        const fullDist = distributeCost(cost, assetType);
        const factor = bafTotalAllocPct > 0 ? (bafAllocMap[assetType] || 0) / bafTotalAllocPct : 0;
        return fullDist.map(v => v * factor);
      }
      return distributeCost(cost, assetType);
    };

    const getProportionedTotal = (cost: CostItem): number => {
      if (costInputMode === 'same-for-all' && cost.canDelete === false) {
        const fullTotal = calculateItemTotal(cost, assetType, costs);
        const factor = bafTotalAllocPct > 0 ? (bafAllocMap[assetType] || 0) / bafTotalAllocPct : 0;
        return fullTotal * factor;
      }
      return calculateItemTotal(cost, assetType, costs);
    };

    // Fix 4: Include ALL costs (land cash, locked rows) - no canDelete filter.
    const lineItems = costs.map(c => {
      const total     = getProportionedTotal(c);
      const debtPct   = getLineDebtPct(c.name);
      const debtAmt   = total * (debtPct / 100);
      const equityAmt = total - debtAmt;
      return { name: c.name, total, debtAmt, equityAmt, debtPct };
    });

    // Per-line per-period distributions (construction periods only, P0..constructionPeriods)
    const lineDistributions = costs.map(c => ({
      name: c.name,
      dist: getProportionedDist(c).slice(0, constructionPeriods + 1),
    }));

    const totalDebtCalc   = lineItems.reduce((s, l) => s + l.debtAmt,   0);
    const totalEquityCalc = lineItems.reduce((s, l) => s + l.equityAmt, 0);

    // Build period arrays (length = totalPeriods + 1 for P0..totalPeriods)
    const debtAdd   = new Array(totalPeriods + 1).fill(0);
    const equityAdd = new Array(totalPeriods + 1).fill(0);

    // Fix 4 + Fix 3: dist[i] maps directly to debtAdd[i] - period 0 at index 0.
    // All costs included; same-for-all locked rows are proportioned above.
    costs.forEach(cost => {
      const d       = getProportionedDist(cost);
      const debtPct = getLineDebtPct(cost.name);
      d.forEach((v, i) => {
        if (i <= constructionPeriods) {
          debtAdd[i]   += v * (debtPct / 100);
          equityAdd[i] += v * (1 - debtPct / 100);
        }
      });
    });

    // Build running debt balance - two-phase approach:
    // Phase 1 (P0..constructionPeriods): accumulate drawdowns + capitalized interest → no repayment
    // Phase 2 (ops): repay based on the ACTUAL closing balance at end of construction
    //   (= initial debt + all capitalized interest, not just the initial drawn debt)
    const debtOpen  = new Array(totalPeriods + 1).fill(0);
    const debtRep   = new Array(totalPeriods + 1).fill(0);
    const debtClose = new Array(totalPeriods + 1).fill(0);
    const interest  = new Array(totalPeriods + 1).fill(0);

    // Phase 1 - construction (no repayment yet)
    let debtBal = 0;
    for (let p = 0; p <= constructionPeriods; p++) {
      debtOpen[p] = debtBal;
      const draw = debtAdd[p] || 0;
      const inConstruction = p >= 1 && p <= constructionPeriods;
      const intCharge = debtBal * periodicRate
        + (inConstruction && capitalizeInterest ? draw * periodicRate / 2 : 0);
      interest[p] = intCharge;
      debtRep[p]  = 0;
      debtBal += draw + (capitalizeInterest && inConstruction ? intCharge : 0);
      debtClose[p] = Math.max(0, debtBal);
    }

    // Repayment = closing balance at end of construction ÷ repayment periods
    // This correctly includes all capitalized interest rolled into the loan
    const repPerPeriod = repaymentPeriods > 0 ? debtClose[constructionPeriods] / repaymentPeriods : 0;

    // Phase 2 - operations (repay + charge interest on declining balance)
    for (let p = constructionPeriods + 1; p <= totalPeriods; p++) {
      debtOpen[p] = debtBal;
      const opIdx     = p - constructionPeriods;
      const intCharge = debtBal * periodicRate;
      interest[p] = intCharge;
      const repayment = opIdx <= repaymentPeriods ? repPerPeriod : 0;
      debtRep[p] = repayment;
      debtBal = Math.max(0, debtBal - repayment);
      debtClose[p] = debtBal;
    }

    // Build equity balance
    const eqOpen  = new Array(totalPeriods + 1).fill(0);
    const eqClose = new Array(totalPeriods + 1).fill(0);
    let eqBal = 0;
    for (let p = 0; p <= totalPeriods; p++) {
      eqOpen[p] = eqBal;
      eqBal += equityAdd[p] || 0;
      eqClose[p] = eqBal;
    }

    const totalInterest = interest.reduce((s, v) => s + v, 0);

    return {
      lineItems,
      lineDistributions,
      debtAdd, debtOpen, debtRep, debtClose,
      equityAdd, eqOpen, eqClose,
      interest,
      totalDebt: totalDebtCalc,
      totalEquity: totalEquityCalc,
      totalInterest,
      periodicRate,
      totalPeriods,
    };
  }, [
    residentialCosts, hospitalityCosts, retailCosts,
    constructionPeriods, operationsPeriods,
    interestRate, modelType, repaymentPeriods, capitalizeInterest,
    calculateItemTotal, distributeCost, getLineDebtPct,
    costInputMode, residentialPercent, hospitalityPercent, retailPercent,
    showResidential, showHospitality, showRetail,
  ]);

  const finRes  = showResidential ? buildAssetFinancing('residential') : null;
  const finHosp = showHospitality ? buildAssetFinancing('hospitality')  : null;
  const finRet  = showRetail      ? buildAssetFinancing('retail')       : null;

  // ── Snapshot ──
  const getSnapshot = useCallback(() => ({
    version: 2, savedAt: new Date().toISOString(),
    projectName, projectType, country, currency, modelType,
    projectStart, constructionPeriods, operationsPeriods, overlapPeriods,
    landParcels, projectRoadsPct, projectFAR, projectNonEnclosedPct,
    residentialPercent, hospitalityPercent, retailPercent,
    residentialDeductPct, residentialEfficiency,
    hospitalityDeductPct, hospitalityEfficiency,
    retailDeductPct, retailEfficiency,
    residentialCosts, hospitalityCosts, retailCosts,
    costInputMode, nextCostId,
    interestRate, financingMode, globalDebtPct, capitalizeInterest,
    repaymentPeriods, repaymentMethod, lineRatios,
  }), [
    projectName, projectType, country, currency, modelType,
    projectStart, constructionPeriods, operationsPeriods, overlapPeriods,
    landParcels, projectRoadsPct, projectFAR, projectNonEnclosedPct,
    residentialPercent, hospitalityPercent, retailPercent,
    residentialDeductPct, residentialEfficiency,
    hospitalityDeductPct, hospitalityEfficiency,
    retailDeductPct, retailEfficiency,
    residentialCosts, hospitalityCosts, retailCosts,
    costInputMode, nextCostId,
    interestRate, financingMode, globalDebtPct, capitalizeInterest,
    repaymentPeriods, repaymentMethod, lineRatios,
  ]);

  // ── Save version ──
  const handleSaveVersion = useCallback((versionName: string) => {
    if (!activeProjectId) {
      setPmToast({ msg: 'Select or create a project first', color: 'var(--color-negative)' });
      return;
    }
    const s = loadStorage();
    const versionId = `v_${Date.now()}`;
    if (!s.projects[activeProjectId]) return;
    s.projects[activeProjectId].versions = s.projects[activeProjectId].versions || {};
    s.projects[activeProjectId].versions[versionId] = {
      name: versionName || `Version ${Object.keys(s.projects[activeProjectId].versions).length + 1}`,
      createdAt: new Date().toISOString(),
      data: getSnapshot(),
    };
    s.projects[activeProjectId].lastModified = new Date().toISOString();
    s.activeProjectId = activeProjectId;
    s.activeVersionId = versionId;
    saveStorage(s);
    setStorageData(s);
    setActiveVersionId(versionId);
    setLastSavedAt(new Date().toLocaleTimeString());
    setHasUnsaved(false);
    setPmToast({ msg: '✓ Version saved', color: 'var(--color-green-dark)' });
  }, [activeProjectId, getSnapshot]);

  // ── Create project ──
  const handleCreateProject = useCallback((name: string, location: string) => {
    const s = loadStorage();
    const pid = `proj_${Date.now()}`;
    s.projects[pid] = {
      name,
      location,
      createdAt: new Date().toISOString(),
      lastModified: new Date().toISOString(),
      status: 'Draft',
      assetMix: [projectType],
      versions: {},
    };
    s.activeProjectId = pid;
    saveStorage(s);
    setStorageData(s);
    setActiveProjectId(pid);
    setActiveVersionId(null);
    setProjectName(name);
    setPmModal(null);
    setPmToast({ msg: `✓ Project "${name}" created`, color: 'var(--color-green-dark)' });
    setHasUnsaved(true);
  }, [projectType]);

  // ── Delete project ──
  const handleDeleteProject = useCallback((pid: string) => {
    const s = loadStorage();
    delete s.projects[pid];
    if (s.activeProjectId === pid) {
      s.activeProjectId = null;
      s.activeVersionId = null;
      setActiveProjectId(null);
      setActiveVersionId(null);
    }
    saveStorage(s);
    setStorageData(s);
    setPmToast({ msg: 'Project deleted', color: 'var(--color-negative)' });
  }, []);

  // ── Load version ──
  const handleLoadVersion = useCallback((pid: string, vid: string) => {
    const s = loadStorage();
    const ver = s.projects[pid]?.versions[vid];
    if (!ver?.data) return;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const d = ver.data as any;
    if (d.projectName   !== undefined) setProjectName(d.projectName);
    if (d.projectType   !== undefined) setProjectType(d.projectType);
    if (d.country       !== undefined) setCountry(d.country);
    if (d.currency      !== undefined) setCurrency(d.currency);
    if (d.modelType     !== undefined) setModelType(d.modelType);
    if (d.projectStart  !== undefined) setProjectStart(d.projectStart);
    if (d.constructionPeriods !== undefined) setConstructionPeriods(d.constructionPeriods);
    if (d.operationsPeriods   !== undefined) setOperationsPeriods(d.operationsPeriods);
    if (d.overlapPeriods      !== undefined) setOverlapPeriods(d.overlapPeriods);
    if (d.landParcels         !== undefined) setLandParcels(d.landParcels);
    if (d.projectRoadsPct     !== undefined) setProjectRoadsPct(d.projectRoadsPct);
    if (d.projectFAR          !== undefined) setProjectFAR(d.projectFAR);
    if (d.residentialPercent  !== undefined) setResidentialPercent(d.residentialPercent);
    if (d.hospitalityPercent  !== undefined) setHospitalityPercent(d.hospitalityPercent);
    if (d.retailPercent       !== undefined) setRetailPercent(d.retailPercent);
    if (d.residentialCosts    !== undefined) setResidentialCosts(d.residentialCosts);
    if (d.hospitalityCosts    !== undefined) setHospitalityCosts(d.hospitalityCosts);
    if (d.retailCosts         !== undefined) setRetailCosts(d.retailCosts);
    if (d.costInputMode       !== undefined) setCostInputMode(d.costInputMode);
    if (d.interestRate        !== undefined) setInterestRate(d.interestRate);
    if (d.financingMode       !== undefined) setFinancingMode(d.financingMode);
    if (d.globalDebtPct       !== undefined) setGlobalDebtPct(d.globalDebtPct);
    if (d.capitalizeInterest  !== undefined) setCapitalizeInterest(d.capitalizeInterest);
    if (d.repaymentPeriods    !== undefined) setRepaymentPeriods(d.repaymentPeriods);
    if (d.repaymentMethod     !== undefined) setRepaymentMethod(d.repaymentMethod);
    if (d.lineRatios          !== undefined) setLineRatios(d.lineRatios);
    s.activeProjectId = pid;
    s.activeVersionId = vid;
    saveStorage(s);
    setStorageData(s);
    setActiveProjectId(pid);
    setActiveVersionId(vid);
    setHasUnsaved(false);
    setPmToast({ msg: `✓ Loaded: ${ver.name}`, color: 'var(--color-navy)' });
  }, []);

  // ── Select project ──
  const handleSelectProject = useCallback((pid: string) => {
    const s = loadStorage();
    s.activeProjectId = pid;
    saveStorage(s);
    setStorageData(s);
    setActiveProjectId(pid);
    const proj = s.projects[pid];
    if (proj) setProjectName(proj.name);
    // load latest version if exists
    const vids = Object.keys(proj?.versions || {});
    if (vids.length > 0) {
      const latest = vids[vids.length - 1];
      handleLoadVersion(pid, latest);
    }
  }, [handleLoadVersion]);

  // ── Computed totals for financing - derived from finRes/finHosp/finRet lineItems ──
  const _allFins = [
    ...(showResidential && finRes  ? [finRes]  : []),
    ...(showHospitality && finHosp ? [finHosp] : []),
    ...(showRetail      && finRet  ? [finRet]  : []),
  ];
  const totalCapex  = _allFins.reduce((s, f) => s + f.lineItems.reduce((x, l) => x + l.total,    0), 0);
  const totalDebt   = _allFins.reduce((s, f) => s + f.totalDebt,   0);
  const totalEquity = _allFins.reduce((s, f) => s + f.totalEquity, 0);

  // ── Build export payload (declared after finRes/totalCapex are in scope) ──
  const buildExportPayload = useCallback(() => {
    const activeProject = activeProjectId ? storageData.projects[activeProjectId] : null;
    const activeVersion = activeProjectId && activeVersionId
      ? storageData.projects[activeProjectId]?.versions[activeVersionId]
      : null;
    return {
      projectName, projectType, country, currency, modelType,
      projectStart, constructionPeriods, operationsPeriods, overlapPeriods,
      projectEndDate: getProjectEndDate(),
      landParcels, projectRoadsPct, projectFAR, projectNonEnclosedPct,
      residentialPercent, hospitalityPercent, retailPercent,
      residentialDeductPct, residentialEfficiency,
      hospitalityDeductPct, hospitalityEfficiency,
      retailDeductPct, retailEfficiency,
      totalLandArea, totalLandValue, landValuePerSqm,
      cashValue, inKindValue, cashPercent, inKindPercent,
      projectRoadsArea, projectNDA, totalProjectGFA,
      residentialGFA, hospitalityGFA, retailGFA,
      residentialBUA, hospitalityBUA, retailBUA,
      residentialNetSaleable, hospitalityNetSaleable, retailNetSaleable,
      residentialLandValue: totalLandValue * residentialPercent / 100,
      hospitalityLandValue: totalLandValue * hospitalityPercent / 100,
      retailLandValue:      totalLandValue * retailPercent / 100,
      showResidential, showHospitality, showRetail,
      costInputMode,
      residentialCosts, hospitalityCosts, retailCosts,
      interestRate, financingMode, globalDebtPct, capitalizeInterest,
      repaymentPeriods, repaymentMethod, lineRatios,
      finRes, finHosp, finRet,
      totalCapex, totalDebt, totalEquity,
      projectLabel: activeProject?.name || projectName,
      versionLabel: activeVersion?.name || 'Base Case',
    };
  }, [
    activeProjectId, activeVersionId, storageData,
    projectName, projectType, country, currency, modelType,
    projectStart, constructionPeriods, operationsPeriods, overlapPeriods,
    getProjectEndDate, landParcels, projectRoadsPct, projectFAR, projectNonEnclosedPct,
    residentialPercent, hospitalityPercent, retailPercent,
    residentialDeductPct, residentialEfficiency, hospitalityDeductPct, hospitalityEfficiency,
    retailDeductPct, retailEfficiency,
    totalLandArea, totalLandValue, landValuePerSqm,
    cashValue, inKindValue, cashPercent, inKindPercent,
    projectRoadsArea, projectNDA, totalProjectGFA,
    residentialGFA, hospitalityGFA, retailGFA,
    residentialBUA, hospitalityBUA, retailBUA,
    residentialNetSaleable, hospitalityNetSaleable, retailNetSaleable,
    showResidential, showHospitality, showRetail,
    costInputMode, residentialCosts, hospitalityCosts, retailCosts,
    interestRate, financingMode, globalDebtPct, capitalizeInterest,
    repaymentPeriods, repaymentMethod, lineRatios,
    finRes, finHosp, finRet, totalCapex, totalDebt, totalEquity,
  ]);

  const handleExportExcel = useCallback(async () => {
    setExportingExcel(true);
    try {
      const payload = buildExportPayload();
      const res = await fetch('/api/export/excel', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
      if (!res.ok) throw new Error('Export failed');
      const blob = await res.blob();
      const url  = URL.createObjectURL(blob);
      const a    = document.createElement('a');
      a.href     = url;
      const safeName = (payload.projectLabel || 'REFM').replace(/[^a-zA-Z0-9_\- ]/g, '').trim().replace(/\s+/g, '_');
      a.download = `${safeName}__${payload.versionLabel.replace(/\s+/g, '_')}__REFM.xlsx`;
      a.click();
      URL.revokeObjectURL(url);
      setPmToast({ msg: '📊 Excel exported', color: 'var(--color-green-dark)' });
    } catch {
      setPmToast({ msg: '❌ Excel export failed', color: 'var(--color-negative)' });
    } finally {
      setExportingExcel(false);
    }
  }, [buildExportPayload]);

  const handleExportPdf = useCallback(async () => {
    setExportingPdf(true);
    try {
      const payload = buildExportPayload();
      const res = await fetch('/api/export/pdf', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
      if (!res.ok) throw new Error('Export failed');
      const blob = await res.blob();
      const url  = URL.createObjectURL(blob);
      const a    = document.createElement('a');
      a.href     = url;
      const safeName = (payload.projectLabel || 'REFM').replace(/[^a-zA-Z0-9_\- ]/g, '').trim().replace(/\s+/g, '_');
      a.download = `${safeName}__${payload.versionLabel.replace(/\s+/g, '_')}__REFM.pdf`;
      a.click();
      URL.revokeObjectURL(url);
      setPmToast({ msg: '📄 PDF exported', color: 'var(--color-green-dark)' });
    } catch {
      setPmToast({ msg: '❌ PDF export failed', color: 'var(--color-negative)' });
    } finally {
      setExportingPdf(false);
    }
  }, [buildExportPayload]);

  const readOnly = !can('canEditInputs');

  // ── Render module content ──
  const renderContent = () => {
    if (!canSeeModule(activeModule)) {
      return (
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: '100%' }}>
          <div style={{ textAlign: 'center', padding: '3rem' }}>
            <div style={{ fontSize: '3rem', marginBottom: '1rem' }}>🔒</div>
            <h2 style={{ color: 'var(--color-heading)', fontSize: 'var(--font-section)', fontWeight: 'var(--fw-bold)' }}>Access Restricted</h2>
            <p style={{ color: 'var(--color-meta)', marginTop: '0.5rem' }}>
              Your role ({ROLE_META[currentUserRole]?.label}) does not have access to this module.
            </p>
          </div>
        </div>
      );
    }

    switch (activeModule) {
      case 'dashboard':
        return (
          <Dashboard
            projectName={projectName}
            projectType={projectType}
            currency={currency}
            totalLandArea={totalLandArea}
            totalLandValue={totalLandValue}
            totalProjectGFA={totalProjectGFA}
            totalCapex={totalCapex}
            totalDebt={totalDebt}
            totalEquity={totalEquity}
            constructionPeriods={constructionPeriods}
            operationsPeriods={operationsPeriods}
            modelType={modelType}
            storageData={storageData}
            setActiveModule={setActiveModule}
          />
        );

      case 'projects':
        return (
          <ProjectsScreen
            storageData={storageData}
            activeProjectId={activeProjectId}
            onSelectProject={handleSelectProject}
            onCreateProject={() => setPmModal('new')}
            onDeleteProject={handleDeleteProject}
            setActiveModule={setActiveModule}
            can={can}
          />
        );

      case 'overview':
        return (
          <OverviewScreen
            storageData={storageData}
            activeProjectId={activeProjectId}
            activeVersionId={activeVersionId}
            projectName={projectName}
            projectType={projectType}
            currency={currency}
            totalLandValue={totalLandValue}
            totalProjectGFA={totalProjectGFA}
            totalCapex={totalCapex}
            onLoadVersion={handleLoadVersion}
            onSaveVersion={() => setPmModal('version')}
            setActiveModule={setActiveModule}
            setActiveTab={setActiveTab}
            can={can}
          />
        );

      case 'module1':
        return (
          <div className="module-view" data-rbac-readonly={readOnly ? 'true' : undefined}>
            {/* Sticky sub-nav */}
            <div className="sticky-nav" style={{ padding: '0 var(--sp-3)', display: 'flex', gap: '4px', alignItems: 'center' }}>
              {m1Tabs.map(tab => (
                <button
                  key={tab.key}
                  onClick={() => setActiveTab(tab.key)}
                  style={{
                    padding: '10px 16px',
                    border: 'none',
                    borderBottom: activeTab === tab.key ? '2px solid var(--color-primary)' : '2px solid transparent',
                    background: 'none',
                    cursor: 'pointer',
                    color: activeTab === tab.key ? 'var(--color-primary)' : 'var(--color-meta)',
                    fontWeight: activeTab === tab.key ? 'var(--fw-semibold)' : 'var(--fw-normal)',
                    fontSize: 'var(--font-body)',
                    display: 'flex', alignItems: 'center', gap: '6px',
                    fontFamily: 'Inter, sans-serif',
                    transition: 'all 0.15s ease',
                  }}
                >
                  <span>{tab.icon}</span>
                  <span>{tab.label}</span>
                </button>
              ))}
            </div>

            {/* Tab content */}
            <div className="tab-content" style={{ padding: 'var(--sp-3)' }}>
              {activeTab === 'timeline' && (
                <Module1Timeline
                  projectName={projectName} setProjectName={setProjectName}
                  projectType={projectType} setProjectType={setProjectType}
                  country={country} setCountry={setCountry}
                  currency={currency} setCurrency={setCurrency}
                  modelType={modelType} setModelType={setModelType}
                  projectStart={projectStart} setProjectStart={setProjectStart}
                  constructionPeriods={constructionPeriods} setConstructionPeriods={setConstructionPeriods}
                  operationsPeriods={operationsPeriods} setOperationsPeriods={setOperationsPeriods}
                  overlapPeriods={overlapPeriods} setOverlapPeriods={setOverlapPeriods}
                  getProjectEndDate={getProjectEndDate}
                  readOnly={readOnly}
                  showAiButtons={canAccess('ai_contextual')}
                />
              )}
              {activeTab === 'area' && (
                <Module1Area
                  landParcels={landParcels} setLandParcels={setLandParcels}
                  projectRoadsPct={projectRoadsPct} setProjectRoadsPct={setProjectRoadsPct}
                  projectFAR={projectFAR} setProjectFAR={setProjectFAR}
                  projectNonEnclosedPct={projectNonEnclosedPct} setProjectNonEnclosedPct={setProjectNonEnclosedPct}
                  residentialPercent={residentialPercent} setResidentialPercent={setResidentialPercent}
                  hospitalityPercent={hospitalityPercent} setHospitalityPercent={setHospitalityPercent}
                  retailPercent={retailPercent} setRetailPercent={setRetailPercent}
                  residentialDeductPct={residentialDeductPct} setResidentialDeductPct={setResidentialDeductPct}
                  residentialEfficiency={residentialEfficiency} setResidentialEfficiency={setResidentialEfficiency}
                  hospitalityDeductPct={hospitalityDeductPct} setHospitalityDeductPct={setHospitalityDeductPct}
                  hospitalityEfficiency={hospitalityEfficiency} setHospitalityEfficiency={setHospitalityEfficiency}
                  retailDeductPct={retailDeductPct} setRetailDeductPct={setRetailDeductPct}
                  retailEfficiency={retailEfficiency} setRetailEfficiency={setRetailEfficiency}
                  projectType={projectType}
                  currency={currency}
                  totalLandArea={totalLandArea}
                  totalLandValue={totalLandValue}
                  landValuePerSqm={landValuePerSqm}
                  cashValue={cashValue}
                  inKindValue={inKindValue}
                  cashPercent={cashPercent}
                  inKindPercent={inKindPercent}
                  showResidential={showResidential}
                  showHospitality={showHospitality}
                  showRetail={showRetail}
                  projectRoadsArea={projectRoadsArea}
                  projectNDA={projectNDA}
                  totalProjectGFA={totalProjectGFA}
                  residentialGFA={residentialGFA}
                  hospitalityGFA={hospitalityGFA}
                  retailGFA={retailGFA}
                  residentialBUA={residentialBUA}
                  residentialNetSaleable={residentialNetSaleable}
                  hospitalityBUA={hospitalityBUA}
                  hospitalityNetSaleable={hospitalityNetSaleable}
                  retailBUA={retailBUA}
                  retailNetSaleable={retailNetSaleable}
                  readOnly={readOnly}
                />
              )}
              {activeTab === 'costs' && (
                <Module1Costs
                  projectType={projectType}
                  costInputMode={costInputMode} setCostInputMode={setCostInputMode}
                  handleCostInputModeChange={handleCostInputModeChange}
                  residentialCosts={residentialCosts} setResidentialCosts={setResidentialCosts}
                  hospitalityCosts={hospitalityCosts} setHospitalityCosts={setHospitalityCosts}
                  retailCosts={retailCosts} setRetailCosts={setRetailCosts}
                  nextCostId={nextCostId} setNextCostId={setNextCostId}
                  constructionPeriods={constructionPeriods}
                  currency={currency}
                  modelType={modelType}
                  projectStart={projectStart}
                  calculateItemTotal={calculateItemTotal}
                  distributeCost={distributeCost}
                  getPhasingMode={getPhasingMode}
                  getPhasingValues={getPhasingValues}
                  calcSameForAllDisplayTotal={calcSameForAllDisplayTotal}
                  showResidential={showResidential}
                  showHospitality={showHospitality}
                  showRetail={showRetail}
                  readOnly={readOnly}
                  costStage={costStage} setCostStage={setCostStage}
                  getAreas={getAreas}
                  totalLandArea={totalLandArea}
                  landValuePerSqm={landValuePerSqm}
                  inKindPercent={inKindPercent}
                  cashPercent={cashPercent}
                  residentialPercent={residentialPercent}
                  hospitalityPercent={hospitalityPercent}
                  retailPercent={retailPercent}
                  residentialLandValue={residentialLandValue}
                  hospitalityLandValue={hospitalityLandValue}
                  retailLandValue={retailLandValue}
                  syncSameForAllToAllAssets={syncSameForAllToAllAssets}
                  costScope={costScope} setCostScope={setCostScope}
                  costDevFeeMode={costDevFeeMode} setCostDevFeeMode={setCostDevFeeMode}
                  allocBasis={allocBasis} setAllocBasis={setAllocBasis}
                  calcItemTotalV14={calcItemTotalV14}
                />
              )}
              {activeTab === 'financing' && (
                <Module1Financing
                  interestRate={interestRate} setInterestRate={setInterestRate}
                  financingMode={financingMode} setFinancingMode={setFinancingMode}
                  globalDebtPct={globalDebtPct} setGlobalDebtPct={setGlobalDebtPct}
                  capitalizeInterest={capitalizeInterest} setCapitalizeInterest={setCapitalizeInterest}
                  repaymentPeriods={repaymentPeriods} setRepaymentPeriods={setRepaymentPeriods}
                  repaymentMethod={repaymentMethod} setRepaymentMethod={setRepaymentMethod}
                  lineRatios={lineRatios} setLineRatios={setLineRatios}
                  currency={currency}
                  modelType={modelType}
                  constructionPeriods={constructionPeriods}
                  operationsPeriods={operationsPeriods}
                  totalCapex={totalCapex}
                  totalDebt={totalDebt}
                  totalEquity={totalEquity}
                  totalLandValue={totalLandValue}
                  residentialCosts={residentialCosts}
                  hospitalityCosts={hospitalityCosts}
                  retailCosts={retailCosts}
                  costInputMode={costInputMode}
                  calculateItemTotal={calculateItemTotal}
                  readOnly={readOnly}
                  finRes={finRes}
                  finHosp={finHosp}
                  finRet={finRet}
                  getLineDebtPct={getLineDebtPct}
                  setLineDebtPct={setLineDebtPct}
                  showResidential={showResidential}
                  showHospitality={showHospitality}
                  showRetail={showRetail}
                />
              )}
            </div>
          </div>
        );

      // ── Module 8 - Portfolio (partial access on Free) ──────────────────────
      case 'module8': {
        const hasFullM8 = canAccess('module_8_full');
        return (
          <div className="module-view" style={{ position: 'relative' }}>
            <div style={{ padding: 'var(--sp-3)', opacity: hasFullM8 ? 1 : 0.5 }}>
              <h2 style={{ fontSize: 'var(--font-section)', fontWeight: 700, color: 'var(--color-heading)', marginBottom: 8 }}>
                Module 8 - Portfolio Dashboard
              </h2>
              <p style={{ color: 'var(--color-meta)', fontSize: 13 }}>Coming soon.</p>
            </div>
            {!hasFullM8 && (
              <div style={{
                position: 'absolute', inset: 0, zIndex: 5,
                background: 'rgba(255,255,255,0.85)', backdropFilter: 'blur(3px)',
                display: 'flex', alignItems: 'center', justifyContent: 'center',
              }}>
                <div style={{ textAlign: 'center', padding: '24px 32px', maxWidth: 360 }}>
                  <div style={{ fontSize: 32, marginBottom: 10 }}>🔒</div>
                  <div style={{ fontSize: 14, fontWeight: 700, color: '#111827', marginBottom: 6 }}>
                    Upgrade to edit financials
                  </div>
                  <p style={{ fontSize: 12, color: '#6B7280', marginBottom: 16, lineHeight: 1.6 }}>
                    Upgrade to Professional to edit Portfolio financials. Outputs are visible in read-only mode.
                  </p>
                  <a href="/settings" style={{
                    display: 'inline-block', padding: '8px 20px', background: '#2563EB',
                    color: '#fff', borderRadius: 6, fontSize: 13, fontWeight: 700, textDecoration: 'none',
                  }}>
                    Upgrade to Professional →
                  </a>
                </div>
              </div>
            )}
          </div>
        );
      }

      // ── Module 9 - Market Data (basic KPIs only on Free) ────────────────────
      case 'module9': {
        const hasFullM9 = canAccess('module_9_full');
        return (
          <div className="module-view" style={{ padding: 'var(--sp-3)' }}>
            <h2 style={{ fontSize: 'var(--font-section)', fontWeight: 700, color: 'var(--color-heading)', marginBottom: 16 }}>
              Module 9 - Market Data
            </h2>
            {/* Basic KPIs - visible on all plans */}
            <div style={{ display: 'flex', gap: 16, flexWrap: 'wrap', marginBottom: 24 }}>
              {['GDV', 'Total Cost', 'Dev Margin'].map(k => (
                <div key={k} className="kpi-card" style={{ minWidth: 160 }}>
                  <div className="kpi-label">{k}</div>
                  <div className="kpi-value">-</div>
                  <div className="kpi-sub">Coming soon</div>
                </div>
              ))}
            </div>
            {/* Advanced metrics - locked for Free */}
            <div style={{ position: 'relative', borderRadius: 8, overflow: 'hidden' }}>
              <div style={{ display: 'flex', gap: 16, flexWrap: 'wrap', opacity: 0.35, pointerEvents: 'none' }}>
                {['Cap Rate', 'IRR', 'Equity Multiple', 'DSCR', 'NPV'].map(k => (
                  <div key={k} className="kpi-card" style={{ minWidth: 160 }}>
                    <div className="kpi-label">{k}</div>
                    <div className="kpi-value">-</div>
                  </div>
                ))}
              </div>
              {!hasFullM9 && (
                <UpgradePrompt
                  featureKey="module_9_full"
                  requiredPlan="professional"
                  variant="overlay"
                  message="Upgrade to Professional to access all market metrics and charts."
                />
              )}
            </div>
          </div>
        );
      }

      default:
        return (
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: '300px' }}>
            <div style={{ textAlign: 'center', color: 'var(--color-muted)' }}>
              <div style={{ fontSize: '2rem', marginBottom: '1rem' }}>🚧</div>
              <p>This module is coming soon.</p>
            </div>
          </div>
        );
    }
  };

  const activeProjectData = activeProjectId ? storageData.projects[activeProjectId] : null;
  const activeVersionData = activeProjectId && activeVersionId
    ? storageData.projects[activeProjectId]?.versions[activeVersionId]
    : null;

  return (
    <>
      <Topbar
        projectName={projectName}
        activeProjectData={activeProjectData}
        activeVersionData={activeVersionData}
        hasUnsaved={hasUnsaved}
        lastSavedAt={lastSavedAt}
        currentUserRole={currentUserRole}
        can={can}
        onSave={() => setPmModal('version')}
        onOpenProjects={() => { setActiveModule('projects'); }}
        onOpenVersions={() => setPmModal('version')}
        onOpenRbac={() => { setRbacSelectedRole(currentUserRole); setRbacModalOpen(true); }}
        onExportClick={() => setExportModalOpen(true)}
      />

      <div className="app-shell">
        <Sidebar
          activeModule={activeModule}
          setActiveModule={setActiveModule}
          activeTab={activeTab}
          setActiveTab={setActiveTab}
          sidebarCollapsed={sidebarCollapsed}
          setSidebarCollapsed={setSidebarCollapsed}
          sidebarSubOpen={sidebarSubOpen}
          setSidebarSubOpen={setSidebarSubOpen}
          currentUserRole={currentUserRole}
          activeProjectId={activeProjectId}
          activeProjectName={activeProjectData?.name ?? null}
          activeVersionName={activeVersionData?.name ?? null}
          canSeeModule={canSeeModule}
          canAccess={canAccess}
          subLoaded={subLoaded}
          onLockedModuleClick={(featureKey, requiredPlan) => setUpgradePrompt({ featureKey, requiredPlan })}
          onOpenProjects={() => { setActiveModule('projects'); }}
          onOpenRbac={() => { setRbacSelectedRole(currentUserRole); setRbacModalOpen(true); }}
        />

        <main
          className={`main-content${sidebarCollapsed ? ' sidebar-collapsed' : ''}`}
        >
          {renderContent()}
        </main>
      </div>

      {/* Modals */}
      {(pmModal === 'new' || pmModal === 'edit') && (
        <ProjectModal
          mode={pmModal}
          initialName={pmModal === 'edit' ? (activeProjectData?.name ?? '') : ''}
          initialLocation={pmModal === 'edit' ? (activeProjectData?.location ?? '') : ''}
          pmInputVal={pmInputVal}
          setPmInputVal={setPmInputVal}
          pmLocationVal={pmLocationVal}
          setPmLocationVal={setPmLocationVal}
          onConfirm={handleCreateProject}
          onClose={() => setPmModal(null)}
        />
      )}
      {pmModal === 'version' && (
        <VersionModal
          storageData={storageData}
          activeProjectId={activeProjectId}
          activeVersionId={activeVersionId}
          onSave={handleSaveVersion}
          onLoad={handleLoadVersion}
          onClose={() => setPmModal(null)}
        />
      )}
      {rbacModalOpen && (
        <RbacModal
          rbacSelectedRole={rbacSelectedRole}
          setRbacSelectedRole={setRbacSelectedRole}
          onApply={(role) => {
            setCurrentUserRole(role);
            setRbacModalOpen(false);
            setPmToast({ msg: `Role switched to ${ROLE_META[role]?.label}`, color: 'var(--color-navy)' });
          }}
          onClose={() => setRbacModalOpen(false)}
        />
      )}

      {/* Export modal */}
      {exportModalOpen && (
        <ExportModal
          canAccess={canAccess}
          onClose={() => setExportModalOpen(false)}
          onExportExcel={handleExportExcel}
          onExportPdf={handleExportPdf}
          exportingExcel={exportingExcel}
          exportingPdf={exportingPdf}
        />
      )}

      {/* Upgrade prompt overlay */}
      {upgradePrompt && (
        <div
          style={{
            position: 'fixed', inset: 0, zIndex: 1999,
            background: 'rgba(0,0,0,0.45)',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            padding: 16,
          }}
          onClick={() => setUpgradePrompt(null)}
        >
          <div onClick={e => e.stopPropagation()} style={{ maxWidth: 440, width: '100%' }}>
            <UpgradePrompt
              featureKey={upgradePrompt.featureKey}
              requiredPlan={upgradePrompt.requiredPlan}
              variant="card"
            />
          </div>
        </div>
      )}

      {/* Toast */}
      {pmToast && (
        <div className="pm-toast" style={{ background: pmToast.color }}>
          {pmToast.msg}
        </div>
      )}
    </>
  );
}
