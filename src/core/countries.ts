/**
 * countries.ts (2026-08-17)
 *
 * A COUNTRY IS A SELECTED VALUE, NOT FREE TEXT A GATE GUESSES AT.
 *
 * `Project.country` drives two real behaviours: the `requiresCountry` gate that
 * decides whether a country-specific cost line is charged (the standard
 * catalog's real estate transfer tax), and the default financial-statement
 * terminology (Zakat). Both were comparing free text with `===`.
 *
 * WHAT WAS ACTUALLY WRONG, measured on a live project 2026-08-17: the field had
 * NO EDITOR ANYWHERE. Project & Phases offers `location` ("free-text city /
 * country / region, display only"), which is where the user had typed
 * "Jeddah, Saudi Arabia", while `project.country` sat at its default `''`. So
 * the gate could never match on any project created in the app: it was reading
 * a field no screen could write. A second string in the comparison would not
 * have fixed anything.
 *
 * SO THE RULE IS: the screen writes a CODE from this list, and every comparison
 * goes through `countryMatches`, which resolves BOTH sides. That keeps three
 * things true at once:
 *
 *   - a saved line carrying `requiresCountry: 'Saudi Arabia'` still matches a
 *     project carrying 'SA', so nothing needs migrating on either side;
 *   - a project carrying the old free-text 'Saudi Arabia' keeps working;
 *   - an unrecognised string on either side still compares as text, so a value
 *     this list does not know is never silently treated as "no country".
 *
 * `guessFromLocation` exists ONLY to offer a suggestion the user confirms in
 * one click. Nothing in this file infers a country for the model.
 *
 * Pure, no imports, no em dashes.
 */

/** ISO 3166-1: alpha-2 code and the common English name, `CODE:Name`. */
const RAW = [
  'AF:Afghanistan', 'AX:Aland Islands', 'AL:Albania', 'DZ:Algeria', 'AS:American Samoa',
  'AD:Andorra', 'AO:Angola', 'AI:Anguilla', 'AQ:Antarctica', 'AG:Antigua and Barbuda',
  'AR:Argentina', 'AM:Armenia', 'AW:Aruba', 'AU:Australia', 'AT:Austria', 'AZ:Azerbaijan',
  'BS:Bahamas', 'BH:Bahrain', 'BD:Bangladesh', 'BB:Barbados', 'BY:Belarus', 'BE:Belgium',
  'BZ:Belize', 'BJ:Benin', 'BM:Bermuda', 'BT:Bhutan', 'BO:Bolivia', 'BA:Bosnia and Herzegovina',
  'BW:Botswana', 'BR:Brazil', 'IO:British Indian Ocean Territory', 'BN:Brunei', 'BG:Bulgaria',
  'BF:Burkina Faso', 'BI:Burundi', 'CV:Cabo Verde', 'KH:Cambodia', 'CM:Cameroon', 'CA:Canada',
  'KY:Cayman Islands', 'CF:Central African Republic', 'TD:Chad', 'CL:Chile', 'CN:China',
  'CX:Christmas Island', 'CC:Cocos (Keeling) Islands', 'CO:Colombia', 'KM:Comoros', 'CG:Congo',
  'CD:Congo (Democratic Republic)', 'CK:Cook Islands', 'CR:Costa Rica', 'CI:Cote d Ivoire',
  'HR:Croatia', 'CU:Cuba', 'CW:Curacao', 'CY:Cyprus', 'CZ:Czechia', 'DK:Denmark', 'DJ:Djibouti',
  'DM:Dominica', 'DO:Dominican Republic', 'EC:Ecuador', 'EG:Egypt', 'SV:El Salvador',
  'GQ:Equatorial Guinea', 'ER:Eritrea', 'EE:Estonia', 'SZ:Eswatini', 'ET:Ethiopia',
  'FK:Falkland Islands', 'FO:Faroe Islands', 'FJ:Fiji', 'FI:Finland', 'FR:France',
  'GF:French Guiana', 'PF:French Polynesia', 'GA:Gabon', 'GM:Gambia', 'GE:Georgia',
  'DE:Germany', 'GH:Ghana', 'GI:Gibraltar', 'GR:Greece', 'GL:Greenland', 'GD:Grenada',
  'GP:Guadeloupe', 'GU:Guam', 'GT:Guatemala', 'GG:Guernsey', 'GN:Guinea', 'GW:Guinea-Bissau',
  'GY:Guyana', 'HT:Haiti', 'HN:Honduras', 'HK:Hong Kong', 'HU:Hungary', 'IS:Iceland',
  'IN:India', 'ID:Indonesia', 'IR:Iran', 'IQ:Iraq', 'IE:Ireland', 'IM:Isle of Man',
  'IL:Israel', 'IT:Italy', 'JM:Jamaica', 'JP:Japan', 'JE:Jersey', 'JO:Jordan', 'KZ:Kazakhstan',
  'KE:Kenya', 'KI:Kiribati', 'KW:Kuwait', 'KG:Kyrgyzstan', 'LA:Laos', 'LV:Latvia', 'LB:Lebanon',
  'LS:Lesotho', 'LR:Liberia', 'LY:Libya', 'LI:Liechtenstein', 'LT:Lithuania', 'LU:Luxembourg',
  'MO:Macao', 'MG:Madagascar', 'MW:Malawi', 'MY:Malaysia', 'MV:Maldives', 'ML:Mali', 'MT:Malta',
  'MH:Marshall Islands', 'MQ:Martinique', 'MR:Mauritania', 'MU:Mauritius', 'MX:Mexico',
  'FM:Micronesia', 'MD:Moldova', 'MC:Monaco', 'MN:Mongolia', 'ME:Montenegro', 'MS:Montserrat',
  'MA:Morocco', 'MZ:Mozambique', 'MM:Myanmar', 'NA:Namibia', 'NR:Nauru', 'NP:Nepal',
  'NL:Netherlands', 'NC:New Caledonia', 'NZ:New Zealand', 'NI:Nicaragua', 'NE:Niger',
  'NG:Nigeria', 'NU:Niue', 'NF:Norfolk Island', 'KP:North Korea', 'MK:North Macedonia',
  'MP:Northern Mariana Islands', 'NO:Norway', 'OM:Oman', 'PK:Pakistan', 'PW:Palau',
  'PS:Palestine', 'PA:Panama', 'PG:Papua New Guinea', 'PY:Paraguay', 'PE:Peru',
  'PH:Philippines', 'PL:Poland', 'PT:Portugal', 'PR:Puerto Rico', 'QA:Qatar', 'RE:Reunion',
  'RO:Romania', 'RU:Russia', 'RW:Rwanda', 'BL:Saint Barthelemy', 'KN:Saint Kitts and Nevis',
  'LC:Saint Lucia', 'MF:Saint Martin', 'VC:Saint Vincent and the Grenadines', 'WS:Samoa',
  'SM:San Marino', 'ST:Sao Tome and Principe', 'SA:Saudi Arabia', 'SN:Senegal', 'RS:Serbia',
  'SC:Seychelles', 'SL:Sierra Leone', 'SG:Singapore', 'SX:Sint Maarten', 'SK:Slovakia',
  'SI:Slovenia', 'SB:Solomon Islands', 'SO:Somalia', 'ZA:South Africa', 'KR:South Korea',
  'SS:South Sudan', 'ES:Spain', 'LK:Sri Lanka', 'SD:Sudan', 'SR:Suriname', 'SE:Sweden',
  'CH:Switzerland', 'SY:Syria', 'TW:Taiwan', 'TJ:Tajikistan', 'TZ:Tanzania', 'TH:Thailand',
  'TL:Timor-Leste', 'TG:Togo', 'TO:Tonga', 'TT:Trinidad and Tobago', 'TN:Tunisia',
  'TR:Turkiye', 'TM:Turkmenistan', 'TC:Turks and Caicos Islands', 'TV:Tuvalu', 'UG:Uganda',
  'UA:Ukraine', 'AE:United Arab Emirates', 'GB:United Kingdom', 'US:United States',
  'UY:Uruguay', 'UZ:Uzbekistan', 'VU:Vanuatu', 'VA:Vatican City', 'VE:Venezuela',
  'VN:Vietnam', 'VG:Virgin Islands (British)', 'VI:Virgin Islands (US)', 'YE:Yemen',
  'ZM:Zambia', 'ZW:Zimbabwe',
];

export interface CountryOption {
  code: string;
  name: string;
}

export const COUNTRIES: CountryOption[] = RAW.map((r) => {
  const i = r.indexOf(':');
  return { code: r.slice(0, i), name: r.slice(i + 1) };
});

/** Names a user might reasonably type or have stored, mapped to the code. */
const ALIASES: Record<string, string> = {
  'ksa': 'SA',
  'kingdom of saudi arabia': 'SA',
  'saudi': 'SA',
  'uae': 'AE',
  'u.a.e.': 'AE',
  'emirates': 'AE',
  'united arab emirate': 'AE',
  'uk': 'GB',
  'u.k.': 'GB',
  'great britain': 'GB',
  'england': 'GB',
  'scotland': 'GB',
  'wales': 'GB',
  'northern ireland': 'GB',
  'usa': 'US',
  'u.s.': 'US',
  'u.s.a.': 'US',
  'united states of america': 'US',
  'america': 'US',
  'holland': 'NL',
  'the netherlands': 'NL',
  'south korea': 'KR',
  'republic of korea': 'KR',
  'north korea': 'KP',
  'ivory coast': 'CI',
  "cote d'ivoire": 'CI',
  'czech republic': 'CZ',
  'turkey': 'TR',
  'burma': 'MM',
  'swaziland': 'SZ',
  'cape verde': 'CV',
  'macedonia': 'MK',
  'east timor': 'TL',
  'vatican': 'VA',
  'hong kong sar': 'HK',
  'drc': 'CD',
  'democratic republic of the congo': 'CD',
  'republic of the congo': 'CG',
};

const norm = (s: string): string => s.trim().toLowerCase().replace(/\s+/g, ' ');

const BY_NAME = new Map<string, string>();
const BY_CODE = new Map<string, CountryOption>();
for (const c of COUNTRIES) {
  BY_CODE.set(c.code, c);
  BY_NAME.set(norm(c.name), c.code);
}

/**
 * A stored value (code, canonical name or common alias) resolved to a code.
 * Returns undefined for anything this list does not know, INCLUDING the empty
 * string, so "not set" and "not recognised" are both falsy and neither is
 * silently turned into a country.
 */
export function resolveCountryCode(value: string | undefined | null): string | undefined {
  if (!value) return undefined;
  const raw = value.trim();
  if (raw.length === 0) return undefined;
  const upper = raw.toUpperCase();
  if (BY_CODE.has(upper)) return upper;
  const n = norm(raw);
  return BY_NAME.get(n) ?? ALIASES[n];
}

/** The display name for a stored value, or the value itself when unknown. */
export function countryLabel(value: string | undefined | null): string {
  const code = resolveCountryCode(value);
  if (code) return BY_CODE.get(code)?.name ?? code;
  return (value ?? '').trim();
}

/**
 * THE ONE COMPARISON. Both sides are resolved, so a line saying
 * 'Saudi Arabia' and a project saying 'SA' are the same country, and neither
 * side has to be migrated. Two values this list does not recognise still
 * compare as text (trimmed, case insensitive), which is exactly what the
 * previous `===` did, so nothing that matched before stops matching.
 */
export function countryMatches(
  required: string | undefined | null,
  projectCountry: string | undefined | null,
): boolean {
  if (!required) return true;               // not gated
  const a = resolveCountryCode(required);
  const b = resolveCountryCode(projectCountry);
  if (a && b) return a === b;
  return norm(required ?? '') === norm(projectCountry ?? '') && norm(required ?? '').length > 0;
}

/**
 * A SUGGESTION ONLY. Reads a free-text location ("Jeddah, Saudi Arabia") and
 * returns the country it names, so the screen can offer a one-click fill. It is
 * never called by the engine and never writes anything: the whole point of this
 * file is that the model reads a value the user chose.
 *
 * Matches on comma-separated parts and on a whole-string match, never on a
 * substring, so "Nigerien Street, France" cannot resolve to Niger.
 */
export function guessCountryFromLocation(location: string | undefined | null): string | undefined {
  if (!location) return undefined;
  const parts = location.split(',').map((p) => p.trim()).filter((p) => p.length > 0);
  // Last part first: "City, Country" is the common order.
  for (let i = parts.length - 1; i >= 0; i -= 1) {
    const hit = resolveCountryCode(parts[i]);
    if (hit) return hit;
  }
  return resolveCountryCode(location);
}
