// revenue.types.ts — Module 2: Revenue & Sales Projections
// Placeholder — will be populated when Module 2 is built

export type SalesPhasing = 'even' | 'front-loaded' | 'back-loaded' | 'manual';

export interface UnitType {
  id: number;
  name: string;
  count: number;
  avgSizeSqm: number;
  pricePerSqm: number;
  totalRevenue: number;
}

export interface RevenuePeriod {
  period: number;
  units: number;
  revenue: number;
  cumulativeRevenue: number;
}

export interface Module2State {
  unitTypes: UnitType[];
  salesPhasing: SalesPhasing;
  escalationRate: number; // % per year
  launchPeriod: number;
}

export interface Module2Exports {
  totalRevenue: number;
  revenueByPeriod: RevenuePeriod[];
  averageSalesPrice: number;
}
