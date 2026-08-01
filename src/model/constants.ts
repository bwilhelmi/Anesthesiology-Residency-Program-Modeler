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
 * Capital IME takes an exponential form rather than the operating power form:
 *   capitalIME% = e^(0.2822 * r) - 1
 * 42 CFR 412.322 (indirect medical education adjustment factor, capital PPS).
 */
export const CAPITAL_IME_EXPONENT = 0.2822;

/**
 * Anesthesiology's minimum accredited length (ACGME), which also equals its
 * initial residency period for DGME weighting. A new teaching hospital's
 * permanent FTE cap is the highest single program year's FTE count multiplied
 * by this figure — 42 CFR 413.79(e)(1).
 */
export const PROGRAM_LENGTH_YEARS = 4;

/**
 * The new-program growth window: program years 1 through 5. During it a new
 * teaching hospital has no cap yet (42 CFR 413.79(e)(1)), FTEs in a new program
 * are excluded from the three-year rolling average (42 CFR 413.79(d)(5)), and
 * the IME resident-to-bed ratio is not clipped to the prior year
 * (42 CFR 412.105(f)(1)(v)). The rolling-average and ratio exceptions apply to
 * new PROGRAMS, so they hold at established teaching hospitals too.
 */
export const CAP_BUILDING_WINDOW_YEARS = 5;

/**
 * The first program year in which the permanent cap, the rolling average, and
 * the IME ratio cap all bind — i.e. the first year that shows mature-program
 * economics rather than growth-window economics.
 */
export const MATURE_PROGRAM_YEAR = CAP_BUILDING_WINDOW_YEARS + 1;

/**
 * Direct-GME FTE weighting during a resident's initial residency period (IRP).
 * Anesthesiology's IRP (4 years) equals the program length, so residents are
 * weighted at 1.0 throughout. (Residents past their IRP are weighted 0.5.)
 */
export const DGME_FTE_WEIGHT = 1.0;

/* ------------------ Supervision / concurrency limits (CMS) ---------------- */

/**
 * Maximum concurrent anesthetizing locations one anesthesiologist may medically
 * direct with CRNAs/AAs at full payment. 42 CFR 415.110 (medical direction of
 * up to four concurrent procedures).
 */
export const MEDICAL_DIRECTION_CONCURRENCY_LIMIT = 4;

/**
 * Maximum concurrent resident cases a teaching anesthesiologist may be involved
 * in while the service is still paid at the full base-unit amount.
 * 42 CFR 415.178 (anesthesia services furnished in teaching settings — two
 * concurrent cases involving residents).
 */
export const TEACHING_ANESTHESIA_CONCURRENCY_LIMIT = 2;

/* ----------------------------- Default salaries --------------------------- */

export const DEFAULT_SALARIES = {
  anesthesiologistSalary: 400_000,
  crnaSalary: 220_000,
  residentSalary: 68_000,
  benefitLoadRate: 0.25,
  // Absolute dollars, not a percentage: health/dental premiums, retirement,
  // payroll taxes, professional liability, licensure, meal/parking allowances.
  // AAMC stipend-and-benefits survey territory ($25k-$30k all-in) — roughly 40%
  // of the stipend, which is why the percentage load is not used for residents.
  residentBenefitAnnual: 28_000,
};

/* ------------------- Default per-year clinical parameters ----------------- */

/**
 * Clinical productivity ramp across training. The intern (PGY-1) spends most
 * of the year on required off-service rotations and provides little direct
 * anesthesia coverage, but delivers meaningful service value to host
 * departments. CA-1 through CA-3 progressively cover more anesthetizing
 * locations with less oversight.
 *
 * `anesthesiaCoverageFte` values are NET-OF-SLOWDOWN staffing equivalences: the
 * anesthetist-FTE a resident at that level actually displaces, already
 * reflecting that they work more slowly than an experienced CRNA. The separate
 * `caseThroughputLoss` input values the hospital's lost case margin and is not
 * applied here — see EfficiencyInputs.
 */
export const DEFAULT_CLINICAL: Record<ResidencyYear, ResidentYearClinicalParams> = {
  PGY1: {
    // The clinical base year scatters across participating sites (county,
    // VA, community medicine/ICU months), so only about half of it lands at
    // the sponsor hospital.
    sponsorSiteShare: 0.5,
    imeCountableShare: 0.95,
    // Conditional on being at the sponsor site. Composite anesthesia exposure
    // is 0.5 × 0.3 = 0.15 — the same year-level exposure the model used before
    // site allocation existed.
    fractionOnAnesthesia: 0.3,
    anesthesiaCoverageFte: 0.3,
    offServiceCoverageFte: 0.55,
    offServiceProviderAnnualCost: 150_000,
  },
  PGY2: {
    // CA-1: on anesthesia nearly all year, but ramping and closely supervised.
    // Away time is subspecialty months the sponsor cannot staff itself.
    sponsorSiteShare: 0.85,
    imeCountableShare: 0.95,
    fractionOnAnesthesia: 0.92, // composite 0.78
    anesthesiaCoverageFte: 0.5,
    offServiceCoverageFte: 0.4,
    offServiceProviderAnnualCost: 150_000,
  },
  PGY3: {
    // CA-2: subspecialty rotations, growing independence.
    sponsorSiteShare: 0.85,
    imeCountableShare: 0.95,
    fractionOnAnesthesia: 0.95, // composite 0.81
    anesthesiaCoverageFte: 0.7,
    offServiceCoverageFte: 0.4,
    offServiceProviderAnnualCost: 150_000,
  },
  PGY4: {
    // CA-3: near-independent under supervision, takes senior call, and is the
    // class the sponsor keeps closest to home.
    sponsorSiteShare: 0.9,
    imeCountableShare: 0.95,
    fractionOnAnesthesia: 0.95, // composite 0.855
    anesthesiaCoverageFte: 0.85,
    offServiceCoverageFte: 0.4,
    offServiceProviderAnnualCost: 150_000,
  },
};

/* ------------------------------- Full default ----------------------------- */

export const DEFAULT_INPUTS: ModelInputs = {
  residentsPerClass: 6,
  // Anesthesiology attrition is low but not zero; national transfer/withdrawal
  // rates sit in the low single digits per year.
  annualAttritionRate: 0.02,
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
    // Most hospitals asking this question have never trained residents.
    scenario: "newTeachingHospital",
    capHeadroomFte: 24,
    awardedNewSlots: 0,
    directGmePerResidentAmount: 110_000,
    // A new hospital's PRA is min(its own projected cost per FTE, the locality
    // weighted mean PRA) — 42 CFR 413.77(e). Both defaults are national
    // ballparks and are the single highest-leverage numbers in the model.
    newHospitalProjectedCostPerFte: 145_000,
    localityWeightedMeanPra: 120_000,
    medicareInpatientShare: 0.4,
    medicareInpatientOperatingPayments: 60_000_000,
    // Off by default so adding the capital IME line never silently changes an
    // existing estimate; set it to the hospital's capital PPS payments to model.
    medicareCapitalPayments: 0,
    availableBeds: 350,
    existingResidentFte: 0,
    applyImeRatioCap: true,
    applyRollingAverage: true,
    medicaid: {
      mode: "perResident",
      perResidentAmount: 0,
      annualAppropriationTotal: 0,
      requiresLocalMatch: false,
    },
  },
  supervision: {
    maxCrnaSupervisionRatio: MEDICAL_DIRECTION_CONCURRENCY_LIMIT,
    maxResidentSupervisionRatio: TEACHING_ANESTHESIA_CONCURRENCY_LIMIT,
  },
  program: {
    programDirectorFte: 0.5,
    associateProgramDirectorFte: 0.25,
    programCoordinatorCost: 90_000,
    facultyTeachingFtePerResident: 0.04,
    fixedAnnualProgramOverhead: 250_000,
    startupCost: 750_000,
    // Net of affiliation agreements in both directions; zero until the sponsor
    // knows what its participating sites will charge or pay.
    participatingSiteSupportAnnual: 0,
  },
  projection: {
    // Ten program years shows the mature program well past cap-building.
    horizonYears: 10,
    // ACGME application, review, and one Match cycle before the first class.
    preRevenueYears: 2,
    discountRate: 0.06, // hospital hurdle rate / WACC proxy
    salaryInflation: 0.03,
    praUpdateRate: 0.025, // CPI-U proxy; CMS updates the PRA annually
    paymentBaseGrowth: 0.025,
  },
  efficiency: {
    annualMarginPerStaffedLocation: 350_000,
    // Charged once, as margin loss on covered locations. Lower than the old
    // 0.10 because that figure was doing double duty (it also shrank the
    // coverage FTE); the coverage ramp above now carries the staffing half.
    caseThroughputLoss: 0.08,
  },
  clinical: DEFAULT_CLINICAL,
};
