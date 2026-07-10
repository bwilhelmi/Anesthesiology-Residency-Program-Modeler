/**
 * Clinical value of residents: labor substitution and throughput effects.
 *
 * The dominant operational benefit of an anesthesiology residency is that
 * residents help staff anesthetizing locations under anesthesiologist
 * supervision, substituting for more expensive CRNA / locum coverage — subject
 * to Medicare teaching and medical-direction ratios.
 *
 * For each PGY level we estimate an "anesthetist-equivalent coverage FTE":
 *
 *     coverageFte = fractionOnAnesthesia
 *                 x anesthesiaCoverageFte
 *                 x (1 - teachingThroughputLoss weighted by juniority)
 *
 * The covered locations are valued at the cost of the CRNA labor they offset
 * (a fully-loaded CRNA FTE). We separately credit intern-year service value to
 * host departments (off-service rotations), and separately debit the teaching
 * throughput/efficiency loss on the margin per staffed location.
 *
 * Supervision limits: residents let a teaching anesthesiologist cover up to
 * `maxResidentSupervisionRatio` concurrent cases at 100% billing, which is what
 * makes resident coverage economically attractive relative to hiring CRNAs (who
 * also require an anesthesiologist for medical direction, up to a ratio of 4).
 */

import type {
  EfficiencyInputs,
  ModelInputs,
  ResidencyYear,
  ResidentYearClinicalParams,
  SalaryInputs,
} from "./types";
import { RESIDENCY_YEARS } from "./types";

/** Fully-loaded annual cost of a role given base salary and benefit load. */
export function loaded(baseSalary: number, benefitLoadRate: number): number {
  return baseSalary * (1 + benefitLoadRate);
}

/**
 * Juniority weight in [0,1] applied to the teaching throughput loss: junior
 * residents (CA-1) slow cases more than senior residents (CA-3). PGY1 carries
 * the full loss on its (small) anesthesia exposure.
 */
export function juniorityWeight(year: ResidencyYear): number {
  switch (year) {
    case "PGY1":
      return 1.0;
    case "PGY2":
      return 1.0;
    case "PGY3":
      return 0.6;
    case "PGY4":
      return 0.3;
  }
}

/**
 * Anesthetist-equivalent coverage FTE delivered by one resident at a given
 * level, net of teaching slowdown.
 */
export function coverageFteForYear(
  year: ResidencyYear,
  params: ResidentYearClinicalParams,
  efficiency: EfficiencyInputs
): number {
  const gross = params.fractionOnAnesthesia * params.anesthesiaCoverageFte;
  const lossFactor = 1 - efficiency.teachingThroughputLoss * juniorityWeight(year);
  return Math.max(0, gross * lossFactor);
}

/** Labor value (CRNA cost offset) of one resident-year at a given level. */
export function laborSubstitutionValue(
  year: ResidencyYear,
  params: ResidentYearClinicalParams,
  salaries: SalaryInputs,
  efficiency: EfficiencyInputs
): number {
  const crnaLoaded = loaded(salaries.crnaSalary, salaries.benefitLoadRate);
  return coverageFteForYear(year, params, efficiency) * crnaLoaded;
}

/** Intern / off-service service value delivered to host departments. */
export function offServiceValue(
  params: ResidentYearClinicalParams
): number {
  const timeOffService = Math.max(0, 1 - params.fractionOnAnesthesia);
  return (
    timeOffService * params.offServiceCoverageFte * params.offServiceProviderAnnualCost
  );
}

/** Aggregate coverage FTE across a set of residents (by level and count). */
export function totalCoverageFte(
  residentsByYear: Record<ResidencyYear, number>,
  inputs: ModelInputs
): number {
  return RESIDENCY_YEARS.reduce((sum, year) => {
    const n = residentsByYear[year] ?? 0;
    return sum + n * coverageFteForYear(year, inputs.clinical[year], inputs.efficiency);
  }, 0);
}

/**
 * The number of staffed anesthetizing locations the hospital needs to cover on
 * an average day. Uses an explicit value if provided, otherwise derives it from
 * the physical location counts and a utilization rate.
 */
export function staffedLocationDemand(inputs: ModelInputs): number {
  const loc = inputs.locations;
  if (loc.averageConcurrentStaffedLocations > 0) {
    return loc.averageConcurrentStaffedLocations;
  }
  const physical =
    loc.operatingRooms + loc.noraSites + loc.laborDeliveryORs + loc.outpatientSites;
  return physical * clamp01(loc.utilizationRate);
}

function clamp01(x: number): number {
  return Math.max(0, Math.min(1, x));
}
