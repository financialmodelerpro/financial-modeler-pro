// scenario.types.ts — Scenario analysis types

export type ScenarioType = 'base' | 'upside' | 'downside' | 'stress';

export interface ScenarioOverride {
  field: string;
  baseValue: number;
  scenarioValue: number;
  delta: number;
  deltaPercent: number;
}

export interface Scenario {
  id: string;
  name: string;
  type: ScenarioType;
  description: string;
  overrides: ScenarioOverride[];
  createdAt: string;
}

export interface ScenarioComparison {
  scenarios: Scenario[];
  metric: string;
  values: Record<string, number>;
}
