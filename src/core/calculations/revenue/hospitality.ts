/**
 * M2 Pass 8a (2026-05-18): Hospitality (Operate-strategy) revenue engine.
 *
 * Pure function. No store coupling. Caller resolves keys + occupancy
 * ramp + ADR + F&B / Other configs from M1 sub-units + asset.revenue
 * .operate and hands them to computeHospitalityAsset.
 *
 * The engine respects three flexibility axes the user asked for:
 *   1. ADR + indexation (per Sell-style IndexationConfig).
 *   2. F&B mode = 'percent_of_rooms' | 'per_guest' | 'fixed_amount'.
 *   3. Other revenue mode = same union as F&B (independent toggle).
 *
 * Math per project-axis period y:
 *   ARN[y]  = keys × daysPerYear
 *   ORN[y]  = ARN[y] × clamp(occupancy[y], 0..1)
 *   ADR[y]  = applyIndexation(startingADR, y, adrIndexation)
 *   Rooms[y]   = ORN[y] × ADR[y]
 *   Guests[y]  = ORN[y] × guestsPerOccupiedRoom
 *   F&B[y]     = ancillary(fb,    Rooms[y], Guests[y], y)
 *   Other[y]   = ancillary(other, Rooms[y], Guests[y], y)
 *   Total[y]   = Rooms + F&B + Other
 *
 * Outside [opsStartIdx, opsEndIdx] (inclusive) every output is 0.
 *
 * Convention: under operating-sales (matching Sell's SDO since Pass 7r),
 * revenue = recognition = cash in the same period. AR is a separate
 * DSO-driven roll-forward in Pass 8d.
 */

import { applyIndexation } from './indexation';
import type {
  AncillaryRevenueConfig,
  HospitalityAssetResult,
  HospitalityConfig,
} from './types';

export interface ComputeHospitalityInputs {
  config: HospitalityConfig;
  axisLength: number;
}

const DEFAULT_DAYS_PER_YEAR = 365;
const DEFAULT_GUESTS_PER_OCCUPIED_ROOM = 1.5;

function pickScalarOrArray(
  value: number | number[] | undefined,
  yr: number,
  fallback: number,
): number {
  if (value == null) return fallback;
  if (typeof value === 'number') return value;
  const v = value[yr];
  return Number.isFinite(v) ? v : fallback;
}

function computeAncillary(
  cfg: AncillaryRevenueConfig,
  rooms: number,
  guests: number,
  yr: number,
): number {
  if (cfg.mode === 'percent_of_rooms') {
    const pct = pickScalarOrArray(cfg.percentOfRooms, yr, 0);
    return Math.max(0, rooms) * Math.max(0, pct);
  }
  if (cfg.mode === 'per_guest') {
    const baseRate = pickScalarOrArray(cfg.ratePerGuest, yr, 0);
    const rate = cfg.indexation
      ? applyIndexation(baseRate, yr, cfg.indexation)
      : baseRate;
    return Math.max(0, guests) * Math.max(0, rate);
  }
  // fixed_amount
  const baseAmt = pickScalarOrArray(cfg.fixedAmountPerPeriod, yr, 0);
  const amt = cfg.indexation
    ? applyIndexation(baseAmt, yr, cfg.indexation)
    : baseAmt;
  return Math.max(0, amt);
}

export function computeHospitalityAsset(
  inputs: ComputeHospitalityInputs,
): HospitalityAssetResult {
  const { config, axisLength } = inputs;
  const N = Math.max(0, axisLength);

  const arn = new Array<number>(N).fill(0);
  const orn = new Array<number>(N).fill(0);
  const occ = new Array<number>(N).fill(0);
  const adr = new Array<number>(N).fill(0);
  const guests = new Array<number>(N).fill(0);
  const rooms = new Array<number>(N).fill(0);
  const fb = new Array<number>(N).fill(0);
  const other = new Array<number>(N).fill(0);
  const total = new Array<number>(N).fill(0);

  const keys = Math.max(0, config.keys);
  const daysPerYear = config.daysPerYear ?? DEFAULT_DAYS_PER_YEAR;
  const guestsPerOR = config.guestsPerOccupiedRoom ?? DEFAULT_GUESTS_PER_OCCUPIED_ROOM;
  const startIdx = Math.max(0, Math.min(N - 1, config.opsStartIdx));
  const endIdx = Math.max(startIdx, Math.min(N - 1, config.opsEndIdx));
  const annualARN = keys * daysPerYear;

  for (let y = startIdx; y <= endIdx; y++) {
    const rawOcc = config.occupancyPerPeriod[y] ?? 0;
    const occClamped = Math.max(0, Math.min(1, rawOcc));
    const ornY = annualARN * occClamped;
    const adrY = applyIndexation(Math.max(0, config.startingADR), y, config.adrIndexation);
    const guestsY = ornY * Math.max(0, guestsPerOR);
    const roomsY = ornY * adrY;
    const fbY = computeAncillary(config.fb, roomsY, guestsY, y);
    const otherY = computeAncillary(config.otherRevenue, roomsY, guestsY, y);

    arn[y] = annualARN;
    orn[y] = ornY;
    occ[y] = occClamped;
    adr[y] = adrY;
    guests[y] = guestsY;
    rooms[y] = roomsY;
    fb[y] = fbY;
    other[y] = otherY;
    total[y] = roomsY + fbY + otherY;
  }

  return {
    assetId: config.assetId,
    axisLength: N,
    availableRoomNightsPerPeriod: arn,
    occupiedRoomNightsPerPeriod: orn,
    occupancyPerPeriod: occ,
    adrPerPeriod: adr,
    guestsPerPeriod: guests,
    roomsRevenuePerPeriod: rooms,
    fbRevenuePerPeriod: fb,
    otherRevenuePerPeriod: other,
    totalRevenuePerPeriod: total,
  };
}
