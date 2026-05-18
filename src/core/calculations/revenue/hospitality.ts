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
  const adrFactor = new Array<number>(N).fill(0);
  const guests = new Array<number>(N).fill(0);
  const rooms = new Array<number>(N).fill(0);
  const fb = new Array<number>(N).fill(0);
  const other = new Array<number>(N).fill(0);
  const total = new Array<number>(N).fill(0);

  const daysPerYear = config.daysPerYear ?? DEFAULT_DAYS_PER_YEAR;
  const guestsPerOR = config.guestsPerOccupiedRoom ?? DEFAULT_GUESTS_PER_OCCUPIED_ROOM;
  const startIdx = Math.max(0, Math.min(N - 1, config.opsStartIdx));
  const endIdx = Math.max(startIdx, Math.min(N - 1, config.opsEndIdx));

  // Pass 9c (2026-05-18): per-sub-unit loop. Empty subUnits collapses
  // to a single virtual sub-unit using the asset-level keys + ADR
  // (legacy single-room-type path). Each sub-unit carries its own
  // startingADR + (optional) indexation override.
  const subUnits = config.subUnits.length > 0
    ? config.subUnits
    : [{
        id: '__asset__',
        keys: Math.max(0, config.keys),
        startingADR: Math.max(0, config.startingADR),
        adrIndexation: config.adrIndexation,
      }];

  const perSubUnit: HospitalityAssetResult['perSubUnit'] = {};
  for (const su of subUnits) {
    perSubUnit[su.id] = {
      keys: Math.max(0, su.keys),
      adrPerPeriod: new Array<number>(N).fill(0),
      adrIndexationFactorPerPeriod: new Array<number>(N).fill(0),
      availableRoomNightsPerPeriod: new Array<number>(N).fill(0),
      occupiedRoomNightsPerPeriod: new Array<number>(N).fill(0),
      roomsRevenuePerPeriod: new Array<number>(N).fill(0),
    };
  }

  const totalKeys = subUnits.reduce((s, u) => s + Math.max(0, u.keys), 0);

  for (let y = startIdx; y <= endIdx; y++) {
    const rawOcc = config.occupancyPerPeriod[y] ?? 0;
    const occClamped = Math.max(0, Math.min(1, rawOcc));

    let totalArnY = 0;
    let totalOrnY = 0;
    let totalRoomsY = 0;
    let weightedAdrSum = 0;     // sum(keys_i × ADR_i)
    let weightedFactorSum = 0;  // sum(keys_i × factor_i)

    for (const su of subUnits) {
      const suKeys = Math.max(0, su.keys);
      const suARN = suKeys * daysPerYear;
      const suORN = suARN * occClamped;
      const idx = su.adrIndexation ?? config.adrIndexation;
      const suFactor = applyIndexation(1, y, idx);
      const suADR = Math.max(0, su.startingADR) * suFactor;
      const suRooms = suORN * suADR;

      totalArnY += suARN;
      totalOrnY += suORN;
      totalRoomsY += suRooms;
      weightedAdrSum += suKeys * suADR;
      weightedFactorSum += suKeys * suFactor;

      const sub = perSubUnit[su.id];
      sub.adrPerPeriod[y] = suADR;
      sub.adrIndexationFactorPerPeriod[y] = suFactor;
      sub.availableRoomNightsPerPeriod[y] = suARN;
      sub.occupiedRoomNightsPerPeriod[y] = suORN;
      sub.roomsRevenuePerPeriod[y] = suRooms;
    }

    const guestsY = totalOrnY * Math.max(0, guestsPerOR);
    const fbY = computeAncillary(config.fb, totalRoomsY, guestsY, y);
    const otherY = computeAncillary(config.otherRevenue, totalRoomsY, guestsY, y);

    arn[y] = totalArnY;
    orn[y] = totalOrnY;
    occ[y] = occClamped;
    // Keys-weighted average ADR + factor. When totalKeys=0 (degenerate
    // empty asset) both default to 0 — no rooms revenue anyway.
    adr[y] = totalKeys > 0 ? weightedAdrSum / totalKeys : 0;
    adrFactor[y] = totalKeys > 0 ? weightedFactorSum / totalKeys : 0;
    guests[y] = guestsY;
    rooms[y] = totalRoomsY;
    fb[y] = fbY;
    other[y] = otherY;
    total[y] = totalRoomsY + fbY + otherY;
  }

  return {
    assetId: config.assetId,
    axisLength: N,
    availableRoomNightsPerPeriod: arn,
    occupiedRoomNightsPerPeriod: orn,
    occupancyPerPeriod: occ,
    adrPerPeriod: adr,
    adrIndexationFactorPerPeriod: adrFactor,
    guestsPerPeriod: guests,
    roomsRevenuePerPeriod: rooms,
    fbRevenuePerPeriod: fb,
    otherRevenuePerPeriod: other,
    totalRevenuePerPeriod: total,
    perSubUnit,
  };
}
