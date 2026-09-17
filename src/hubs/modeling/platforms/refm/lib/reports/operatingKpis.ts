/**
 * operatingKpis.ts (2026-09-17)
 *
 * THE RE METRICS OPERATING KPIs, COMPUTED ONCE. The RE Metrics tab computed the
 * hospitality, residential and lease blocks inline, so the Excel workbook had no
 * way to print the same figures without restating the arithmetic. The screen and
 * the workbook both read this builder now; each formats the numbers its own way.
 *
 * Every block is blended over the hold and is null when the project carries no
 * asset of that kind, which is the screen's "render only when present" rule.
 *
 * Pure. No em dashes in this file.
 */
import type { ProjectFinancialsSnapshot } from '../financials-resolvers';
import type { Asset } from '../state/module1-types';

export interface HospitalityKpis {
  occupancy: number | null;
  adr: number | null;
  revpar: number | null;
  roomsRevenue: number;
  fbRevenue: number;
  otherRevenue: number;
  totalRevenue: number;
  availableRoomNights: number;
}

export interface ResidentialKpis {
  saleValue: number;
  unitsSold: number;
  pricePerUnit: number | null;
  pricePerSqm: number | null;
  preSalesPct: number | null;
  velocity: number | null;
}

export interface LeaseKpis {
  gla: number;
  avgOccupancy: number | null;
  rentPerSqm: number | null;
  totalRevenue: number;
}

export interface OperatingKpis {
  hospitality: HospitalityKpis | null;
  residential: ResidentialKpis | null;
  lease: LeaseKpis | null;
}

const sumArr = (a: readonly number[] | undefined): number => (a ?? []).reduce((s, v) => s + (v ?? 0), 0);

export function buildOperatingKpis(
  snap: Pick<ProjectFinancialsSnapshot, 'revenue'>,
  assets: readonly Pick<Asset, 'id' | 'sellableBuaSqm' | 'buaSqm'>[],
): OperatingKpis {
  // ── Hospitality ──
  let avail = 0, occRn = 0, rooms = 0, fb = 0, other = 0, totalHosp = 0;
  for (const h of snap.revenue.byHospitalityAsset.values()) {
    avail += sumArr(h.availableRoomNightsPerPeriod);
    occRn += sumArr(h.occupiedRoomNightsPerPeriod);
    rooms += sumArr(h.roomsRevenuePerPeriod);
    fb += sumArr(h.fbRevenuePerPeriod);
    other += sumArr(h.otherRevenuePerPeriod);
    totalHosp += sumArr(h.totalRevenuePerPeriod);
  }
  const hospitality: HospitalityKpis | null = avail <= 0 ? null : {
    occupancy: avail > 0 ? occRn / avail : null,
    adr: occRn > 0 ? rooms / occRn : null,
    revpar: avail > 0 ? rooms / avail : null,
    roomsRevenue: rooms, fbRevenue: fb, otherRevenue: other, totalRevenue: totalHosp,
    availableRoomNights: avail,
  };

  // ── Residential (for-sale) ──
  const areaOf = new Map<string, number>();
  for (const a of assets) areaOf.set(a.id, a.sellableBuaSqm || a.buaSqm || 0);
  let units = 0, preSale = 0, postSale = 0, area = 0;
  const activeYears = new Set<number>();
  for (const [id, s] of snap.revenue.bySellAsset.entries()) {
    const preU = sumArr(s.presalesUnitsPerPeriod);
    const postU = sumArr(s.postSalesUnitsPerPeriod);
    units += preU + postU;
    preSale += sumArr(s.presalesRevenuePerPeriod);
    postSale += sumArr(s.postSalesRevenuePerPeriod);
    if (preU + postU > 0) area += areaOf.get(id) ?? 0;
    s.presalesUnitsPerPeriod.forEach((v, t) => {
      if ((v ?? 0) + (s.postSalesUnitsPerPeriod[t] ?? 0) > 0) activeYears.add(t);
    });
  }
  const saleValue = preSale + postSale;
  const residential: ResidentialKpis | null = saleValue <= 0 && units <= 0 ? null : {
    saleValue,
    unitsSold: units,
    pricePerUnit: units > 0 ? saleValue / units : null,
    pricePerSqm: area > 0 ? saleValue / area : null,
    preSalesPct: saleValue > 0 ? preSale / saleValue : null,
    velocity: activeYears.size > 0 ? units / activeYears.size : null,
  };

  // ── Lease ──
  let gla = 0, revenue = 0, occupiedArea = 0, glaYears = 0;
  for (const l of snap.revenue.byLeaseAsset.values()) {
    const assetGla = Object.values(l.perSubUnit).reduce((s, su) => s + (su.gla ?? 0), 0);
    gla += assetGla;
    revenue += sumArr(l.totalRevenuePerPeriod);
    occupiedArea += sumArr(l.occupiedAreaPerPeriod);
    const activePeriods = l.occupiedAreaPerPeriod.filter((v) => (v ?? 0) > 0).length;
    glaYears += assetGla * activePeriods;
  }
  const lease: LeaseKpis | null = gla <= 0 && revenue <= 0 ? null : {
    gla,
    avgOccupancy: glaYears > 0 ? occupiedArea / glaYears : null,
    rentPerSqm: occupiedArea > 0 ? revenue / occupiedArea : null,
    totalRevenue: revenue,
  };

  return { hospitality, residential, lease };
}
