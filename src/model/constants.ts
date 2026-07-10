/**
 * Default model inputs and CMS constants.
 *
 * The defaults are national ballpark figures intended to give a reasonable
 * starting point. They are NOT authoritative for any specific hospital and
 * should be localized. Sources / rationale are noted inline. Where a figure
 * moves every year (salaries, CMS rates), treat it as an estimate to update.
 */

import type { ModelInputs, ResidencyYear, ResidentYearClinicalParams } from "./types";

/* --------------------------- CMS / IME constants -------------------------- */

/**
 * Statutory IME multiplier ("c"). The IME operating add-on percentage is
 *   IME% = c * [ (1 + r)^0.405 - 1 ]
 * where r is the resident-to-bed ratio. Since the Balanced Budget Act era the
 * multiplier has been set at 1.35 in statute/regulation for the operating add-on.
 */
export const IME_MULTIPLIER = 1.35;

/** Exponent applied to the resident-to-bed ratio in the IME formula. */
export const IME_EXPONENT = 0.405;

/**
 * Direct-GME FTE weighting during a resident's initial residency period (IRP).
 * Anesthesiology's IRP (4 years) equals the program length, so residents are
 * weighted at 1.0 throughout. (Residents past their IRP are weighted 0.5.)
 */
export const DGME_FTE_WEIGHT = 1.0;

/* ----------------------------- Default salaries --------------------------- */

export const DEFAULT_SALARIES = {
  anesthesiologistSalary: 400_000,
  crnaSalary: 220_000,
  residentSalary: 68_000,
  benefitLoadRate: 0.25,
};

/* ------------------- Default per-year clinical parameters ----------------- */

/**
 * Clinical productivity ramp across training. The intern (PGY-1) spends most
 * of the year on required off-service rotations and provides little direct
 * anesthesia coverage, but delivers meaningful service value to host
 * departments. CA-1 through CA-3 progressively cover more anesthetizing
 * locations with less oversight.
 */
export const DEFAULT_CLINICAL: Record<ResidencyYear, ResidentYearClinicalParams> = {
  PGY1: {
    // Per ACGME, the clinical base year is mostly non-anesthesia rotations,
    // with roughly 1-3 months of anesthesia exposure.
    fractionOnAnesthesia: 0.15,
    anesthesiaCoverageFte: 0.35,
    offServiceCoverageFte: 0.55,
    offServiceProviderAnnualCost: 150_000,
  },
  PGY2: {
    // CA-1: on anesthesia nearly all year, but ramping and closely supervised.
    fractionOnAnesthesia: 0.82,
    anesthesiaCoverageFte: 0.55,
    offServiceCoverageFte: 0.4,
    offServiceProviderAnnualCost: 150_000,
  },
  PGY3: {
    // CA-2: subspecialty rotations, growing independence.
    fractionOnAnesthesia: 0.85,
    anesthesiaCoverageFte: 0.75,
    offServiceCoverageFte: 0.4,
    offServiceProviderAnnualCost: 150_000,
  },
  PGY4: {
    // CA-3: near-independent under supervision, takes senior call.
    fractionOnAnesthesia: 0.85,
    anesthesiaCoverageFte: 0.9,
    offServiceCoverageFte: 0.4,
    offServiceProviderAnnualCost: 150_000,
  },
};

/* ------------------------------- Full default ----------------------------- */

export const DEFAULT_INPUTS: ModelInputs = {
  residentsPerClass: 6,
  salaries: { ...DEFAULT_SALARIES },
  locations: {
    operatingRooms: 20,
    noraSites: 6,
    laborDeliveryORs: 2,
    outpatientSites: 4,
    averageConcurrentStaffedLocations: 0, // 0 => derive from utilization
    utilizationRate: 0.7,
  },
  gme: {
    atMedicareCap: false,
    capHeadroomFte: 24,
    directGmePerResidentAmount: 110_000,
    medicareInpatientShare: 0.4,
    medicareInpatientOperatingPayments: 60_000_000,
    availableBeds: 350,
    existingResidentFte: 0,
    medicaidGmePerResident: 0,
  },
  supervision: {
    maxCrnaSupervisionRatio: 4,
    maxResidentSupervisionRatio: 2,
  },
  program: {
    programDirectorFte: 0.5,
    associateProgramDirectorFte: 0.25,
    programCoordinatorCost: 90_000,
    facultyTeachingFtePerResident: 0.04,
    fixedAnnualProgramOverhead: 250_000,
    startupCost: 750_000,
  },
  efficiency: {
    annualMarginPerStaffedLocation: 350_000,
    teachingThroughputLoss: 0.1,
  },
  clinical: DEFAULT_CLINICAL,
};
