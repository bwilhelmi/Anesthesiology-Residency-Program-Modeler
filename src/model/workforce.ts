/**
 * Workforce benefits a program delivers beyond day-to-day room coverage.
 *
 * Both lines here are AVOIDED COSTS. That distinction is not pedantry: a board
 * will accept "we stop paying a recruiter and a locum" where it will not accept
 * "residents generate revenue", and only the first is actually true.
 *
 *   - Retention pipeline: graduates hired by the hospital or its group, valued
 *     at the recruitment, signing, and locum-bridge cost their hire avoids.
 *   - Call coverage: overnight in-house presence that would otherwise be bought
 *     as CRNA call stipends, overtime, or locum nights. OFF by default because
 *     it overlaps the labor-substitution line whenever the coverage FTEs
 *     already include call.
 */

import { PROGRAM_LENGTH_YEARS, RESIDENCY_YEARS_TO_CA2 } from "./constants";
import type { CallCoverageInputs, ModelInputs } from "./types";

/**
 * The first program year in which a class graduates: a four-year program that
 * starts in year 1 graduates its first class at the end of year 4, so the
 * hiring benefit lands in year 5.
 */
export const FIRST_GRADUATION_BENEFIT_YEAR = PROGRAM_LENGTH_YEARS + 1;

/**
 * Residents who completed the program at the end of the prior year — the
 * PGY-4 cohort of year `programYear - 1`, post-attrition.
 */
export function graduatesInYear(
  residentsInProgramYear: (programYear: number) => { PGY4: number },
  programYear: number
): number {
  if (programYear < FIRST_GRADUATION_BENEFIT_YEAR) return 0;
  return Math.max(0, residentsInProgramYear(programYear - 1).PGY4);
}

/**
 * Avoided recruitment cost recognized in a program year.
 *
 * Each graduating class's avoided cost is spread evenly over
 * `benefitRecognitionYears` beginning in its graduation year; at the default of
 * one year that is simply the graduating class itself.
 */
export function retentionBenefit(
  inputs: ModelInputs,
  residentsInProgramYear: (programYear: number) => { PGY4: number },
  programYear: number
): number {
  const r = inputs.retention;
  if (!r.enabled) return 0;
  const spread = Math.max(1, Math.round(r.benefitRecognitionYears));

  let graduates = 0;
  for (let k = 0; k < spread; k++) {
    graduates += graduatesInYear(residentsInProgramYear, programYear - k);
  }
  return (
    (graduates / spread) *
    clamp01(r.retentionRate) *
    Math.max(0, r.avoidedCostPerRetainedHire)
  );
}

/**
 * Value of overnight in-house resident coverage, flat from the first year the
 * program has CA-2s (program year 3) — the point at which residents can
 * credibly hold the house overnight.
 */
export function callCoverageBenefit(
  call: CallCoverageInputs,
  programYear: number
): number {
  if (!call.enabled) return 0;
  if (programYear < RESIDENCY_YEARS_TO_CA2) return 0;
  return Math.max(0, call.nightsPerYearCovered) * Math.max(0, call.avoidedCostPerNight);
}

function clamp01(x: number): number {
  return Math.max(0, Math.min(1, x));
}
