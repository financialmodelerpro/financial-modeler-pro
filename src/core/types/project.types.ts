// Project types extracted from refm-platform.js Module 1

export type ModelType = 'monthly' | 'annual';
export type ProjectType = 'residential' | 'hospitality' | 'mixed-use';
export type CostInputMode = 'same-for-all' | 'separate';
export type FinancingMode = 'fixed' | 'line';
export type RepaymentMethod = 'fixed' | 'cashsweep';
export type CostMethod =
  | 'fixed'
  | 'rate_total_allocated'
  | 'rate_net_developable'
  | 'rate_roads'
  | 'rate_gfa'
  | 'rate_bua'
  | 'percent_base'
  | 'percent_total_land'
  | 'percent_cash_land'
  | 'percent_inkind_land';

export interface PhasingConfig {
  type: 'even' | 'manual';
  values?: number[];
}

export type Phasing = string | PhasingConfig;

export interface LandParcel {
  id: number;
  name: string;
  area: number;
  rate: number;
  cashPct: number;
  inKindPct: number;
}

export interface CostItem {
  id: number;
  name: string;
  method: CostMethod;
  value: number;
  baseType: string;
  selectedIds?: number[];
  startPeriod: number;
  endPeriod: number;
  phasing: Phasing;
  canDelete: boolean;
}

export interface AreaMetrics {
  totalAllocated: number;
  netDevelopable: number;
  roadsArea: number;
  gfa: number;
  bua: number;
  nsa: number;
  landValue: number;
  cashLandValue: number;
  inKindLandValue: number;
}

export interface Module1State {
  // Timeline
  projectName: string;
  projectType: ProjectType;
  country: string;
  currency: string;
  modelType: ModelType;
  projectStart: string;
  constructionPeriods: number;
  operationsPeriods: number;
  overlapPeriods: number;
  // Land & Area
  landParcels: LandParcel[];
  projectRoadsPct: number;
  projectFAR: number;
  projectNonEnclosedPct: number;
  residentialPercent: number;
  hospitalityPercent: number;
  retailPercent: number;
  residentialDeductPct: number;
  residentialEfficiency: number;
  hospitalityDeductPct: number;
  hospitalityEfficiency: number;
  retailDeductPct: number;
  retailEfficiency: number;
  // Development Costs
  residentialCosts: CostItem[];
  hospitalityCosts: CostItem[];
  retailCosts: CostItem[];
  costInputMode: CostInputMode;
  nextCostId: number;
  // Financing
  interestRate: number;
  financingMode: FinancingMode;
  globalDebtPct: number;
  capitalizeInterest: boolean;
  repaymentPeriods: number;
  repaymentMethod: RepaymentMethod;
  lineRatios: Record<string, number>;
}

export interface CapexResult {
  items: Array<{ name: string; total: number; distribution: number[] }>;
  totals: number[];
}

export interface FinancingResult {
  lineItems: Array<{ name: string; total: number; debtAmt: number; equityAmt: number; debtPct: number }>;
  lineDistributions: Array<{ name: string; dist: number[] }>;
  debtAdd: number[];
  debtOpen: number[];
  debtRep: number[];
  debtClose: number[];
  equityAdd: number[];
  eqOpen: number[];
  eqClose: number[];
  interest: number[];
  totalDebt: number;
  totalEquity: number;
  totalInterest: number;
  periodicRate: number;
  totalPeriods: number;
}

export interface LandAggregates {
  totalLandArea: number;
  landValuePerSqm: number;
  totalLandValue: number;
  cashValue: number;
  inKindValue: number;
  cashPercent: number;
  inKindPercent: number;
}
