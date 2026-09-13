/**
 * revenueSeeds.ts (2026-09-13, Module 2 restructure step 4)
 *
 * EVERY ASSET CARRIES THE REVENUE BLOCK ITS STRATEGY READS, SEEDED IN THE
 * PERSISTENCE LAYER, NOT ON A TAB.
 *
 * The block was created lazily, by the Revenue tab, on the first edit of any
 * field. So a rate typed on Table 5 reached nothing until someone opened the
 * tab on that line and touched something: on the live project five of eight
 * assets had no block and read 0.00 (14,000 and 1,400 a sqm a year on the
 * commercial lines, 16,000 a sqm on a villa plot, 850 a night on the hotel),
 * and a Lease or Operate asset arrived at by a strategy switch had none at
 * all (measured 2026-09-12: 1,400 a sqm gave 0.00 with no block, 75,600,000
 * once one existed). Docs/TRAPS.md 7.38 is the same shape: a model is only as
 * complete as the last tab someone visited.
 *
 * THE SEED IS THE TAB'S OWN DEFAULT, nothing invented: point-in-time
 * recognition at handover, no indexation, no velocity, occupancy zeros, ADR
 * and rent 0. A seeded block therefore EARNS NOTHING on its own and the
 * engine is byte-identical the moment it exists; what it changes is that the
 * next input a user types on Table 5 or the Revenue tab lands in a block that
 * is already there, and a row seeded with a rate is one edit from earning.
 *
 * IT SETTLES: the input object comes back when nothing is missing, so a
 * project that already carries every block hydrates to the object it always
 * did and opening it cannot mark it dirty. Called from `hydrate` and
 * `extractPersistSnapshot`, the same two doors as the cost bases.
 *
 * No em dashes in this file.
 */

import type { Asset } from './module1-types';
import { REVENUE_KEY_BY_STRATEGY } from './strategySwitch';

type Revenue = NonNullable<Asset['revenue']>;

export function seedSellBlock(assetId: string): NonNullable<Revenue['sell']> {
  return {
    assetId,
    subUnits: [],
    cashPaymentProfile: { percentages: [], profileMode: 'absolute_with_catchup' },
    recognitionProfile: { method: 'point_in_time', pointInTimeYear: 'handover' },
    indexation: { method: 'none' },
  };
}

export function seedOperateBlock(assetId: string): NonNullable<Revenue['operate']> {
  return {
    assetId,
    daysPerYear: 365,
    startingADR: 0,
    adrIndexation: { method: 'none' },
    occupancyPerPeriod: [],
    guestsPerOccupiedRoom: 1.5,
    fb: { mode: 'percent_of_rooms', percentOfRooms: 0 },
    otherRevenue: { mode: 'percent_of_rooms', percentOfRooms: 0 },
    dso: 30,
  };
}

export function seedLeaseBlock(assetId: string): NonNullable<Revenue['lease']> {
  return {
    assetId,
    baseRate: 0,
    rentIndexation: { method: 'none' },
    occupancyPerPeriod: [],
    arDays: 30,
  };
}

export interface RevenueSeedReport {
  assets: Asset[];
  changed: boolean;
  seeded: Array<{ assetId: string; form: 'sell' | 'operate' | 'lease' }>;
}

/** The block an asset's strategy reads is present, or it is added. A hidden
 *  asset is left alone (it reaches no engine loop). Returns the INPUT ARRAY
 *  when nothing was missing. */
export function seedRevenueBlocks(assets: readonly Asset[]): RevenueSeedReport {
  const seeded: RevenueSeedReport['seeded'] = [];
  const next = assets.map((a) => {
    if (a.visible === false) return a;
    const form = REVENUE_KEY_BY_STRATEGY[a.strategy];
    if (!form) return a;
    if (a.revenue?.[form]) return a;
    seeded.push({ assetId: a.id, form });
    const block = form === 'sell' ? seedSellBlock(a.id) : form === 'operate' ? seedOperateBlock(a.id) : seedLeaseBlock(a.id);
    return { ...a, revenue: { ...(a.revenue ?? {}), [form]: block } };
  });
  if (seeded.length === 0) return { assets: assets as Asset[], changed: false, seeded };
  return { assets: next, changed: true, seeded };
}
