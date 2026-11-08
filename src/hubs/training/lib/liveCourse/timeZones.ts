/**
 * The time zone table for live sessions. Pure.
 *
 * Every figure is computed from the session's STORED instant (UTC) with IANA
 * zones, so daylight saving and a reschedule update with no edit. The day mark
 * compares each region's calendar date with the date in the session's own zone
 * (KSA by default): "+1 day" / "-1 day" when they differ.
 */
import { KSA_TZ } from './time';

export interface Region { tz: string; label: string }

/** Founder's default list (2026-11-08), in display order. */
export const DEFAULT_TIME_ZONES: Region[] = [
  { tz: 'Asia/Riyadh',         label: 'Saudi Arabia (Riyadh)' },
  { tz: 'Asia/Dubai',          label: 'UAE (Dubai)' },
  { tz: 'Asia/Karachi',        label: 'Pakistan (Karachi)' },
  { tz: 'Asia/Kolkata',        label: 'India (Kolkata)' },
  { tz: 'Africa/Cairo',        label: 'Egypt (Cairo)' },
  { tz: 'Europe/London',       label: 'UK (London)' },
  { tz: 'Europe/Paris',        label: 'Central Europe (Paris)' },
  { tz: 'America/New_York',    label: 'US Eastern (New York)' },
  { tz: 'America/Los_Angeles', label: 'US Pacific (Los Angeles)' },
  { tz: 'America/Toronto',     label: 'Canada (Toronto)' },
  { tz: 'America/Vancouver',   label: 'Canada (Vancouver)' },
  { tz: 'Australia/Perth',     label: 'Australia (Perth)' },
  { tz: 'Australia/Sydney',    label: 'Australia (Sydney)' },
];

const LABEL_BY_TZ = new Map(DEFAULT_TIME_ZONES.map((r) => [r.tz, r.label]));

/** A readable label for any IANA zone ("Asia/Kuala_Lumpur" -> "Kuala Lumpur"). */
export function regionLabel(tz: string): string {
  return LABEL_BY_TZ.get(tz) ?? (tz.split('/').pop() ?? tz).replace(/_/g, ' ');
}

export function isValidTimeZone(tz: string): boolean {
  try { new Intl.DateTimeFormat('en-US', { timeZone: tz }); return true; } catch { return false; }
}

/** The course's regions: its own list (valid zones only), else the default. */
export function regionsFor(zones: string[] | null | undefined): Region[] {
  const own = (zones ?? []).filter(isValidTimeZone);
  return own.length ? own.map((tz) => ({ tz, label: regionLabel(tz) })) : DEFAULT_TIME_ZONES;
}

export interface ZoneTime {
  tz: string;
  label: string;
  /** "4:00 PM" */
  time: string;
  /** "Tue" */
  weekday: string;
  /** "1 Dec" */
  date: string;
  /** Calendar days from the session's own date: 0, +1, -1. */
  dayOffset: number;
  /** "", "+1 day", "-1 day" */
  dayMark: string;
}

function parts(at: Date, tz: string) {
  return Object.fromEntries(
    new Intl.DateTimeFormat('en-US', {
      timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit', weekday: 'short',
      hour: 'numeric', minute: '2-digit', hour12: true,
    }).formatToParts(at).map((p) => [p.type, p.value]),
  ) as Record<string, string>;
}

function dayNumber(at: Date, tz: string): number {
  const p = parts(at, tz);
  return Date.UTC(+p.year, +p.month - 1, +p.day) / 86_400_000;
}

/** One row per region for a session instant. */
export function zoneTimes(iso: string, regions: Region[], baseTz: string = KSA_TZ): ZoneTime[] {
  const at = new Date(iso);
  if (Number.isNaN(at.getTime())) return [];
  const base = dayNumber(at, baseTz);
  return regions.map(({ tz, label }) => {
    const p = parts(at, tz);
    const off = dayNumber(at, tz) - base;
    const dateLabel = at.toLocaleDateString('en-GB', { timeZone: tz, day: 'numeric', month: 'short' });
    return {
      tz, label,
      time: `${p.hour}:${p.minute} ${p.dayPeriod}`,
      weekday: p.weekday,
      date: dateLabel,
      dayOffset: off,
      dayMark: off === 0 ? '' : `${off > 0 ? '+' : ''}${off} day${Math.abs(off) === 1 ? '' : 's'}`,
    };
  });
}
