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
 * Resolve baseline wages for a region, falling back to the national figure when
 * a state's value is missing, then applying the market premium multiplier.
 *
 * @param state         one of US_STATES, or "" / "National" for the national figure
 * @param marketPremium fraction added on top of the BLS baseline (e.g. 0.1 = +10%)
 */
export function regionSalaries(state: string, marketPremium: number): RegionSalaries | null {
  const nat = SALARY_DATA.national;
  const st = SALARY_DATA.states[state];
  const factor = 1 + Math.max(-0.5, marketPremium);

  const anesthBase = st?.anesthesiologist ?? nat.anesthesiologist;
  const crnaBase = st?.crna ?? nat.crna;
  if (anesthBase == null || crnaBase == null) return null;

  return {
    anesthesiologist: Math.round(anesthBase * factor),
    crna: Math.round(crnaBase * factor),
    anesthesiologistEstimated: st?.anesthesiologist == null,
    crnaEstimated: st?.crna == null,
  };
}
