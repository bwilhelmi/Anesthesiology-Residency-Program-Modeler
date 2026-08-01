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
 *     coverageFte = fractionOnAnesthesia x anesthesiaCoverageFte
 *
 * This is pure staffing equivalence. Teaching slowdown is NOT netted out here:
 * it is charged exactly once, in the model, as lost margin on the covered
 * locations (see EfficiencyInputs.caseThroughputLoss).
 *
 * The covered locations are valued at the cost of the CRNA labor they offset
 * (a fully-loaded CRNA FTE). We separately credit intern-year service value to
 * host departments (off-service rotations).
 *
 * Supervision limits cut the other way and are a real cost: residents let a
 * teaching anesthesiologist cover only `maxResidentSupervisionRatio` concurrent
 * cases at full payment (2 under 42 CFR 415.178), against
 * `maxCrnaSupervisionRatio` medically directed CRNA rooms (4 under 42 CFR
 * 415.110). See incrementalSupervisionCostPerLocation().
 */

import { PAID_HOURS_PER_FTE_YEAR } from "./constants";
import type {
  ModelInputs,
  ResidencyYear,
  ResidentYearClinicalParams,
  SalaryInputs,
  SupervisionInputs,
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
 * Anesthetist-equivalent coverage FTE delivered to the SPONSOR hospital by one
 * resident at a given level:
 *
 *     coverage = sponsorSiteShare × fractionOnAnesthesia × anesthesiaCoverageFte
 *
 * The three factors answer three different questions — is the resident at this
 * hospital, are they on anesthesia while here, and how much of an anesthetist
 * are they while on anesthesia. Coverage delivered at a participating site is
 * real work, but it is not the sponsor's benefit.
 *
 * This is pure staffing equivalence, with no throughput discount applied.
 * Slower individual case conduct is already reflected in the per-level
 * `anesthesiaCoverageFte` ramp (a CA-1 is booked as a fraction of an anesthetist
 * precisely because they are slower); the remaining economic effect of teaching
 * on the hospital's case volume is charged once as margin loss in the model.
 */
export function coverageFteForYear(params: ResidentYearClinicalParams): number {
  return Math.max(
    0,
    clamp01(params.sponsorSiteShare) *
      params.fractionOnAnesthesia *
      params.anesthesiaCoverageFte
  );
}

/**
 * What one FTE of DELIVERED CRNA coverage actually costs the hospital for a
 * year: base salary, plus the premium pay that scheduled coverage earns
 * (overtime on late-running rooms, weekend and holiday differentials), plus the
 * fringe load — and then grossed up for paid-versus-worked hours.
 *
 * Two distinct asymmetries against a resident are priced here.
 *
 * The first is rate: a resident's stipend does not move when the room runs
 * until seven, or when the day is Thanksgiving. A CRNA's pay does.
 *
 * The second is hours, and it is the one that hides. A base salary buys 2,080
 * PAID hours, but only about 1,860 WORKED ones once vacation, CME, sick time,
 * and paid holidays come out. Covering a location for a full coverage-FTE-year
 * therefore takes roughly 1.12 paid CRNA FTEs — or the shortfall bought as
 * overtime. The resident side needs no mirror of this: `fractionOnAnesthesia`
 * is already net of resident vacation and didactics, so comparing a paid-FTE
 * cost against a delivered-coverage figure would understate the CRNA side.
 *
 * Simplification: the fringe load is applied to premium dollars as well as
 * base. Payroll taxes and retirement match do scale with overtime earnings;
 * health premiums do not, so this slightly overstates the fringe on the premium
 * portion — a second-order effect next to leaving premium pay out entirely.
 */
export function crnaCostOfCoverage(salaries: SalaryInputs): number {
  const wages = salaries.crnaSalary * (1 + Math.max(0, salaries.crnaPremiumPayLoad));
  // A non-finite worked-hours value (a corrupted saved payload, say) falls back
  // to the full paid year rather than propagating NaN through every dollar in
  // the model. The fallback is the conservative one: no backfill priced.
  const workedHours = Number.isFinite(salaries.crnaWorkedHoursPerPaidFte)
    ? salaries.crnaWorkedHoursPerPaidFte
    : PAID_HOURS_PER_FTE_YEAR;
  const paidFtePerCoverageFte =
    PAID_HOURS_PER_FTE_YEAR /
    Math.max(1, Math.min(PAID_HOURS_PER_FTE_YEAR, workedHours));
  return loaded(wages, salaries.benefitLoadRate) * paidFtePerCoverageFte;
}

/** Labor value (CRNA cost offset) of one resident-year at a given level. */
export function laborSubstitutionValue(
  params: ResidentYearClinicalParams,
  salaries: SalaryInputs
): number {
  return coverageFteForYear(params) * crnaCostOfCoverage(salaries);
}

/**
 * Incremental attending supervision cost per resident-covered location:
 * attendings cover fewer concurrent rooms with residents (1:2 under the
 * Medicare teaching rule, 42 CFR 415.178) than with CRNAs under medical
 * direction (1:4, 42 CFR 415.110). Professional-fee revenue per room is
 * treated as approximately neutral between the two staffing modes; the
 * economic delta is on the supervision-cost side.
 */
export function incrementalSupervisionCostPerLocation(
  salaries: SalaryInputs,
  supervision: SupervisionInputs
): number {
  const attendingLoaded = loaded(salaries.anesthesiologistSalary, salaries.benefitLoadRate);
  const perRoomWithResidents = 1 / Math.max(1, supervision.maxResidentSupervisionRatio);
  const perRoomWithCrnas = 1 / Math.max(1, supervision.maxCrnaSupervisionRatio);
  return Math.max(0, attendingLoaded * (perRoomWithResidents - perRoomWithCrnas));
}

/**
 * Intern / off-service service value delivered to host departments AT THE
 * SPONSOR HOSPITAL. Off-service months spent at a participating site benefit
 * that institution, not this one, so only sponsor-site off-service time earns
 * the credit.
 */
export function offServiceValue(params: ResidentYearClinicalParams): number {
  const sponsorTimeOffService =
    clamp01(params.sponsorSiteShare) * Math.max(0, 1 - params.fractionOnAnesthesia);
  return (
    sponsorTimeOffService *
    params.offServiceCoverageFte *
    params.offServiceProviderAnnualCost
  );
}

/**
 * Medicare-countable FTE contributed by one resident-year at the sponsor
 * hospital. DGME counts sponsor-site time at the full IRP weight; IME counts
 * only the patient-care portion of it (42 CFR 412.105(f)).
 */
export function countableFteForResident(params: ResidentYearClinicalParams): {
  dgme: number;
  ime: number;
} {
  const dgme = clamp01(params.sponsorSiteShare);
  return { dgme, ime: dgme * clamp01(params.imeCountableShare) };
}

/** Aggregate coverage FTE across a set of residents (by level and count). */
export function totalCoverageFte(
  residentsByYear: Record<ResidencyYear, number>,
  inputs: ModelInputs
): number {
  return RESIDENCY_YEARS.reduce((sum, year) => {
    const n = residentsByYear[year] ?? 0;
    return sum + n * coverageFteForYear(inputs.clinical[year]);
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
