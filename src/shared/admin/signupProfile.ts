/**
 * signupProfile.ts (2026-08-20)
 *
 * ONE definition of how a registrant's signup details are presented to an
 * admin. Two screens show the same person: the pending trial request card on
 * /admin/plans, where the decision is made, and the user record on
 * /admin/users/[id], where it is looked up afterwards. They must agree, and
 * the way they stay agreeing is that neither of them formats anything itself.
 *
 * Nothing here reads the database or decides access. It is presentation of
 * values the routes already return.
 *
 * No em dashes in this file.
 */
import { countryLabel } from '@/src/core/countries';

/**
 * A timestamp an admin can act on.
 *
 * UTC and explicitly labelled, for the same reason the signup alert email is:
 * this is read from more than one country, and a bare local time is a time
 * nobody can compare. Returns '' for an absent or unparseable value, so the
 * caller renders its own "not given" marker rather than printing 'Invalid
 * Date' into the card.
 */
export function formatAdminStamp(iso: string | null | undefined): string {
  const raw = (iso ?? '').trim();
  if (raw === '') return '';
  const t = Date.parse(raw);
  if (Number.isNaN(t)) return raw;
  return `${new Date(t).toISOString().replace('T', ' ').slice(0, 16)} UTC`;
}

/** The shape both admin surfaces read a registrant from. Every field is
 *  optional because a row can predate the column that holds it. */
export interface SignupProfileInput {
  name?: string | null;
  email?: string | null;
  phone?: string | null;
  city?: string | null;
  country?: string | null;
  company?: string | null;
  jobTitle?: string | null;
  /** null / undefined means the question was never asked, which is every
   *  account created before the qualification section existed. That is NOT
   *  the same as answering no, and the two must never render alike. */
  worksInRealEstate?: boolean | null;
  roleNote?: string | null;
  registeredAt?: string | null;
}

export interface SignupProfileField {
  label: string;
  /** '' means there is no value; the caller renders the absent marker. */
  value: string;
}

/**
 * The contact block, in one order, for both screens.
 *
 * Country goes through countryLabel so a row storing 'SA' and a row storing
 * 'Saudi Arabia' both read as Saudi Arabia. That is the same shared resolver
 * the project country field uses; there is no second country rule here.
 */
export function signupContactFields(p: SignupProfileInput): SignupProfileField[] {
  const t = (v: string | null | undefined): string => (v ?? '').trim();
  return [
    { label: 'Email', value: t(p.email) },
    { label: 'Phone', value: t(p.phone) },
    { label: 'City', value: t(p.city) },
    { label: 'Country', value: countryLabel(p.country) },
    { label: 'Company', value: t(p.company) },
    { label: 'Job title', value: t(p.jobTitle) },
    { label: 'Registered', value: formatAdminStamp(p.registeredAt) },
  ];
}

export type QualificationTone = 'yes' | 'no' | 'unasked';

/** Three states, never two. See worksInRealEstate above. */
export function qualificationTone(v: boolean | null | undefined): QualificationTone {
  if (v === true) return 'yes';
  if (v === false) return 'no';
  return 'unasked';
}

export function qualificationLabel(v: boolean | null | undefined): string {
  const tone = qualificationTone(v);
  // Broadened 2026-08-30 to real estate OR hospitality. The stored field is
  // still works_in_real_estate; only its MEANING and every label widened.
  return tone === 'yes' ? 'IN RE / HOSPITALITY' : tone === 'no' ? 'NOT IN RE / HOSPITALITY' : 'NOT ASKED';
}
