/**
 * Regional salary lookup, backed by BLS OEWS data bundled at build time
 * (see scripts/fetch-bls.mjs and src/data/salaries.json).
 *
 * BLS reports *employed* mean wages, which tend to sit below the aggressive
 * offers seen on job boards like gaswork.com. The "market premium" lets the
 * user scale the BLS baseline upward to reflect current local market offers.
 */

import salaryData from "../data/salaries.json";

export interface RegionRoleWages {
  anesthesiologist: number | null;
  crna: number | null;
}

export interface SalaryDataset {
  source: string;
  sourceUrl: string;
  measure: string;
  dataYear: number | null;
  asOf: string;
  generatedAt: string;
  national: RegionRoleWages;
  states: Record<string, RegionRoleWages>;
}

export const SALARY_DATA = salaryData as unknown as SalaryDataset;

/** Whether the bundled dataset is still the placeholder seed (no CI pull yet). */
export const IS_PLACEHOLDER = SALARY_DATA.generatedAt === "seed";

/**
 * Default "market premium" over the BLS OEWS employed-wage mean, by role, used to
 * seed the region picker. These are calibrated to national recruiting/compensation
 * benchmarks, NOT invented:
 *
 *   Anesthesiologist (+25%): the BLS OEWS mean ($360,570) sits well below market
 *   because many anesthesiologists earn above the survey's top code. Merritt
 *   Hawkins / AMN report a nonacademic starting BASE near $450,000 (≈ +25% over
 *   the BLS mean); Doximity's 2025 report puts anesthesiology *total* compensation
 *   at $523,277 (≈ +45%, but that includes bonus/production the model loads
 *   separately). +25% anchors the base salary to the Merritt Hawkins figure, with
 *   Doximity as the upper bound.  [refs 5, 11, 12]
 *
 *   CRNA (+10%): the BLS OEWS CRNA mean ($248,320) is already close to market, so
 *   the gap is far smaller than for physicians; +10% reflects recruiting/locum
 *   rates running modestly above the employed mean. The physician anchors above do
 *   not apply to CRNAs.
 */
export const MARKET_PREMIUM_DEFAULTS = {
  anesthesiologist: 0.25,
  crna: 0.1,
} as const;

/** The 50 states + DC, in display order. Always shown, even if data is sparse. */
export const US_STATES: string[] = [
  "Alabama", "Alaska", "Arizona", "Arkansas", "California", "Colorado",
  "Connecticut", "Delaware", "District of Columbia", "Florida", "Georgia",
  "Hawaii", "Idaho", "Illinois", "Indiana", "Iowa", "Kansas", "Kentucky",
  "Louisiana", "Maine", "Maryland", "Massachusetts", "Michigan", "Minnesota",
  "Mississippi", "Missouri", "Montana", "Nebraska", "Nevada", "New Hampshire",
  "New Jersey", "New Mexico", "New York", "North Carolina", "North Dakota",
  "Ohio", "Oklahoma", "Oregon", "Pennsylvania", "Rhode Island",
  "South Carolina", "South Dakota", "Tennessee", "Texas", "Utah", "Vermont",
  "Virginia", "Washington", "West Virginia", "Wisconsin", "Wyoming",
];

export interface RegionSalaries {
  anesthesiologist: number;
  crna: number;
  /** True when a value fell back to the national figure (state data missing). */
  anesthesiologistEstimated: boolean;
  crnaEstimated: boolean;
}

/**
 * Resolve baseline wages for a region, falling back to the national figure when a
 * state's value is missing, then applying role-specific market premiums. Premiums
 * are per-role because the BLS-vs-market gap differs sharply by role (see
 * MARKET_PREMIUM_DEFAULTS).
 *
 * @param state         one of US_STATES, or "" / "National" for the national figure
 * @param anesthPremium fraction added to the anesthesiologist BLS baseline
 * @param crnaPremium   fraction added to the CRNA BLS baseline
 */
export function regionSalaries(
  state: string,
  anesthPremium: number,
  crnaPremium: number,
): RegionSalaries | null {
  const nat = SALARY_DATA.national;
  const st = SALARY_DATA.states[state];

  const anesthBase = st?.anesthesiologist ?? nat.anesthesiologist;
  const crnaBase = st?.crna ?? nat.crna;
  if (anesthBase == null || crnaBase == null) return null;

  return {
    anesthesiologist: Math.round(anesthBase * (1 + Math.max(-0.5, anesthPremium))),
    crna: Math.round(crnaBase * (1 + Math.max(-0.5, crnaPremium))),
    anesthesiologistEstimated: st?.anesthesiologist == null,
    crnaEstimated: st?.crna == null,
  };
}
