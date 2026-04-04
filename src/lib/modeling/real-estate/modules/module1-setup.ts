/**
 * module1-setup.ts
 * Module 1 — Project Setup & Financial Structure
 * Default cost data, factory helpers, and downstream-facing interface.
 */

import { CostItem, Module1State, CapexResult } from '@/src/types/project.types';
import { calculateItemTotal, distributeCost } from '@/src/core/core-calculations';
import { formatNumber, formatCurrency } from '@/src/core/core-formatters';

export type { CostItem, Module1State, CapexResult };
export { calculateItemTotal, distributeCost };
export { formatNumber, formatCurrency };

/**
 * Returns the 12 default cost items for any asset (residential / hospitality / retail).
 * The land value (id=1) is stored as 0 by default — callers must update it
 * from the land aggregates after initialization.
 */
export function getDefaultCosts(constructionPeriods: number): CostItem[] {
  return [
    {
      id: 1,
      name: 'Land (Cash Portion)',
      method: 'fixed',
      value: 0,
      baseType: '',
      selectedIds: [],
      startPeriod: 0,
      endPeriod: 0,
      phasing: '100',
      canDelete: false,
    },
    {
      id: 2,
      name: 'Construction Cost',
      method: 'rate_bua',
      value: 0,
      baseType: '',
      selectedIds: [],
      startPeriod: 7,
      endPeriod: constructionPeriods,
      phasing: 'even',
      canDelete: true,
    },
    {
      id: 3,
      name: 'Infrastructure Cost',
      method: 'rate_total_allocated',
      value: 0,
      baseType: '',
      selectedIds: [],
      startPeriod: 1,
      endPeriod: 6,
      phasing: '30,25,20,15,7,3',
      canDelete: true,
    },
    {
      id: 4,
      name: 'Landscaping Cost',
      method: 'rate_total_allocated',
      value: 0,
      baseType: '',
      selectedIds: [],
      startPeriod: 1,
      endPeriod: 6,
      phasing: '30,25,20,15,7,3',
      canDelete: true,
    },
    {
      id: 5,
      name: 'Pre-Operating Expenses',
      method: 'percent_base',
      value: 0,
      baseType: 'infra_construction',
      selectedIds: [],
      startPeriod: 1,
      endPeriod: constructionPeriods,
      phasing: 'even',
      canDelete: true,
    },
    {
      id: 6,
      name: 'Professional Fee',
      method: 'percent_base',
      value: 0,
      baseType: 'infra_construction',
      selectedIds: [],
      startPeriod: 1,
      endPeriod: constructionPeriods,
      phasing: 'even',
      canDelete: true,
    },
    {
      id: 7,
      name: 'Contingency Cost',
      method: 'percent_base',
      value: 0,
      baseType: 'infra_construction',
      selectedIds: [],
      startPeriod: 1,
      endPeriod: constructionPeriods,
      phasing: 'even',
      canDelete: true,
    },
    {
      id: 8,
      name: 'Developer Fee / Performance Fee',
      method: 'percent_base',
      value: 0,
      baseType: 'infra_construction',
      selectedIds: [],
      startPeriod: 1,
      endPeriod: constructionPeriods,
      phasing: 'even',
      canDelete: true,
    },
    {
      id: 9,
      name: 'Electricity Station',
      method: 'fixed',
      value: 0,
      baseType: '',
      selectedIds: [],
      startPeriod: 3,
      endPeriod: 8,
      phasing: 'even',
      canDelete: true,
    },
    {
      id: 10,
      name: 'Bridges',
      method: 'fixed',
      value: 0,
      baseType: '',
      selectedIds: [],
      startPeriod: 2,
      endPeriod: 6,
      phasing: 'even',
      canDelete: true,
    },
    {
      id: 11,
      name: 'Royal Commission Premium',
      method: 'percent_cash_land',
      value: 0,
      baseType: '',
      selectedIds: [],
      startPeriod: 0,
      endPeriod: 0,
      phasing: '100',
      canDelete: true,
    },
    {
      id: 12,
      name: 'RETT',
      method: 'percent_cash_land',
      value: 0,
      baseType: '',
      selectedIds: [],
      startPeriod: 0,
      endPeriod: 0,
      phasing: '100',
      canDelete: true,
    },
  ];
}

/**
 * Creates a blank user-added cost item with sensible defaults.
 */
export function createEmptyCostItem(id: number, constructionPeriods: number): CostItem {
  return {
    id,
    name: 'New Cost Item',
    method: 'fixed',
    value: 0,
    baseType: '',
    selectedIds: [],
    startPeriod: 1,
    endPeriod: constructionPeriods,
    phasing: 'even',
    canDelete: true,
  };
}

/**
 * Module1Exports — documents what Module 1 exposes for downstream modules
 * (Module 2 Revenue, Module 3 OpEx, Module 4 Returns, etc.)
 */
export interface Module1Exports {
  state: Module1State;
  totalLandArea: number;
  landValuePerSqm: number;
  totalProjectGFA: number;
  totalProjectBUA: number;
  residentialGFA: number;
  hospitalityGFA: number;
  retailGFA: number;
  residentialBUA: number;
  hospitalityBUA: number;
  retailBUA: number;
  residentialNetSaleable: number;
  hospitalityNetSaleable: number;
  retailNetSaleable: number;
  totalDevelopmentCost: number;
  constructionPeriods: number;
  operationsPeriods: number;
  currency: string;
}
