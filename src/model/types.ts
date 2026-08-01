/**
 * Domain types for the ACGME anesthesiology residency program cost/benefit model.
 *
 * All monetary values are in current-year US dollars unless otherwise noted.
 * All rates/fractions are expressed as decimals in [0, 1] unless noted.
 *
 * The model is intentionally transparent: every assumption is an explicit,
 * user-overridable input. Defaults (see constants.ts) are national ballpark
 * figures and MUST be localized for a specific hospital and community to
 * produce a defensible estimate.
 */

/** The four post-graduate years of a US anesthesiology residency. */
export type ResidencyYear = "PGY1" | "PGY2" | "PGY3" | "PGY4";

/** Human-friendly clinical-anesthesia labels for each PGY. */
export const YEAR_LABELS: Record<ResidencyYear, string> = {
  PGY1: "PGY-1 (Clinical Base / Intern year)",
  PGY2: "PGY-2 (CA-1)",
  PGY3: "PGY-3 (CA-2)",
  PGY4: "PGY-4 (CA-3)",
};

export const RESIDENCY_YEARS: ResidencyYear[] = ["PGY1", "PGY2", "PGY3", "PGY4"];

/* ------------------------------------------------------------------ */
/* Inputs                                                             */
/* ------------------------------------------------------------------ */

/** Community / market salary assumptions (fully-loaded handled separately). */
export interface SalaryInputs {
  /** Median W-2 salary for an anesthesiologist in the community. */
  anesthesiologistSalary: number;
  /** Median salary for a CRNA (Certified Registered Nurse Anesthetist). */
  crnaSalary: number;
  /** Annual resident stipend (roughly constant across PGY levels). */
  residentSalary: number;
  /**
   * Fringe-benefit load applied on top of base salary (health, retirement,
   * payroll taxes, malpractice, etc.), as a fraction of base salary. Applies to
   * attendings and CRNAs; residents use the absolute figure below instead.
   */
  benefitLoadRate: number;
  /**
   * Resident benefits in absolute annual dollars, NOT as a percentage of the
   * stipend. Health/dental premiums, retirement, payroll taxes, professional
   * liability, licensure and meal/parking allowances do not scale with a
   * trainee's (low) salary, so a percentage load materially understates them:
   * all-in resident benefits typically run $25,000-$30,000 — roughly 40% of a
   * $68,000 stipend, not 25%. Source: AAMC Survey of Resident/Fellow Stipends
   * and Benefits.
   */
  residentBenefitAnnual: number;
}

/** Physical anesthetizing-location counts at the hospital. */
export interface AnesthetizingLocations {
  operatingRooms: number;
  /** Non-operating-room anesthesia sites (endoscopy, IR, cath lab, MRI, etc.). */
  noraSites: number;
  /** Labor & delivery operating rooms / dedicated OB anesthesia sites. */
  laborDeliveryORs: number;
  /** Ambulatory / outpatient anesthetizing locations. */
  outpatientSites: number;
  /**
   * Average number of these locations that are actually staffed and running
   * concurrently on a typical weekday. Drives care-team staffing demand.
   * If left at 0 the model derives a default from utilization (see below).
   */
  averageConcurrentStaffedLocations: number;
  /**
   * Fraction of physical locations staffed concurrently on an average day,
   * used only when averageConcurrentStaffedLocations is 0.
   */
  utilizationRate: number;
}

/** Medicare / Medicaid graduate medical education (GME) funding inputs. */
export interface GmeFundingInputs {
  /**
   * Is the hospital already at (or above) its Medicare direct-GME / IME
   * resident FTE cap? If true, incremental residents generate NO new Medicare
   * GME revenue. A hospital with only partial room should leave this false and
   * express the remaining slots via capHeadroomFte instead.
   */
  atMedicareCap: boolean;
  /**
   * Number of resident FTE slots still available under the cap (used only when
   * atMedicareCap is false). Incremental residents above this count generate no
   * new Medicare GME.
   */
  capHeadroomFte: number;
  /**
   * Medicare Direct GME Per-Resident Amount (PRA) for the hospital. This is
   * hospital-specific, set historically and trended forward by CMS.
   */
  directGmePerResidentAmount: number;
  /**
   * Medicare share of inpatient days (FFS + Medicare Advantage) — the Medicare
   * utilization ratio used to apportion Direct GME to the Medicare program.
   * Medicare Advantage days belong in this ratio (42 CFR 413.76 et seq.); the
   * MA-related portion of DGME is paid through the associated add-on stream
   * rather than the FFS DRG stream.
   */
  medicareInpatientShare: number;
  /**
   * Medicare inpatient operating base payments subject to the IME add-on:
   * FFS DRG payments EXCLUDING the IME and DSH add-ons themselves. Include the
   * MA-related IME base as well if you are modeling Medicare Advantage IME.
   * This is a different base from the utilization ratio above — one apportions
   * DGME, this one is multiplied by the IME percentage.
   */
  medicareInpatientOperatingPayments: number;
  /** Available beds (denominator of the resident-to-bed ratio for IME). */
  availableBeds: number;
  /**
   * Existing approved resident FTEs already training at the hospital (across
   * all specialties). New anesthesia residents are added on top of this for
   * the marginal IME calculation, since IME is nonlinear in the ratio.
   */
  existingResidentFte: number;
  /**
   * State Medicaid GME support per resident FTE per year. Highly state-
   * dependent; 0 in states without a Medicaid GME program.
   */
  medicaidGmePerResident: number;
}

/**
 * Clinical value parameters for one resident year. Captures how much billable
 * anesthesia coverage a resident at this level provides and how much of the
 * year they actually spend delivering anesthesia (vs. required off-service
 * rotations), plus service value delivered to host departments while away.
 */
export interface ResidentYearClinicalParams {
  /**
   * Fraction of the training year the resident spends staffing anesthetizing
   * locations at THIS hospital (vs. required off-service rotations, vacation,
   * didactics, away electives). Intern year is low; CA years are high.
   */
  fractionOnAnesthesia: number;
  /**
   * While delivering anesthesia, the resident's coverage capability expressed
   * as a fraction of one CRNA/anesthetist FTE's staffed-location coverage.
   * Ramps with training level (a CA-1 is slower and needs more oversight than
   * a CA-3). Values above 1 are unusual but permitted.
   */
  anesthesiaCoverageFte: number;
  /**
   * Service value delivered to host departments (ICU, medicine, surgery, pain,
   * etc.) during required off-service rotations, as a fraction of a mid-level
   * provider (e.g., hospitalist/PA) FTE. Mostly relevant for the intern year.
   */
  offServiceCoverageFte: number;
  /**
   * Fully-loaded annual cost of the mid-level provider whose work the resident
   * offsets while on off-service rotations (used with offServiceCoverageFte).
   */
  offServiceProviderAnnualCost: number;
}

/** Supervision / Medicare teaching-rule ratios for the care team. */
export interface SupervisionInputs {
  /**
   * Maximum concurrent anesthetizing locations one anesthesiologist may
   * medically direct with CRNAs/AAs (Medicare medical-direction limit is 4).
   */
  maxCrnaSupervisionRatio: number;
  /**
   * Maximum concurrent resident cases a teaching anesthesiologist may
   * supervise while still billing 100% of the base units (Medicare allows
   * up to 2 concurrent cases involving residents).
   */
  maxResidentSupervisionRatio: number;
}

/** Costs specific to running the residency program (non-salary of residents). */
export interface ProgramCostInputs {
  /**
   * Program Director protected (non-clinical) time as a fraction of one
   * anesthesiologist FTE (ACGME requires substantial protected time).
   */
  programDirectorFte: number;
  /** Associate Program Director protected time (fraction of an FTE). */
  associateProgramDirectorFte: number;
  /** Program coordinator(s) fully-loaded annual cost (administrative staff). */
  programCoordinatorCost: number;
  /**
   * Aggregate faculty time spent teaching, precepting, and on committees that
   * is NOT separately billable, expressed as anesthesiologist FTEs consumed
   * per resident in the program.
   */
  facultyTeachingFtePerResident: number;
  /**
   * Fixed annual program overhead: ACGME/accreditation fees, recruitment,
   * simulation, resident travel/education funds, licensing, etc.
   */
  fixedAnnualProgramOverhead: number;
  /**
   * One-time startup / accreditation cost to establish the program
   * (application, consultants, initial buildout). Amortized in reporting.
   */
  startupCost: number;
}

/** Efficiency effects of teaching on clinical throughput / revenue. */
export interface EfficiencyInputs {
  /**
   * Average net annual professional-fee (or contribution) margin generated per
   * staffed anesthetizing location per year, used to value throughput changes.
   */
  annualMarginPerStaffedLocation: number;
  /**
   * Reduction in case throughput when a case is staffed by a resident vs. an
   * experienced anesthetist, as a fraction. Represents teaching slowdown
   * (longer turnovers, teaching in the room) and is charged EXACTLY ONCE, as
   * lost margin on the resident-covered locations, weighted toward junior
   * residents by juniorityWeight(). It is deliberately NOT also netted out of
   * the coverage FTE — that would charge one parameter through two channels.
   */
  caseThroughputLoss: number;
}

/** The full set of model inputs. */
export interface ModelInputs {
  /** Residents recruited per class (per PGY cohort). Steady state = 4 classes. */
  residentsPerClass: number;
  salaries: SalaryInputs;
  locations: AnesthetizingLocations;
  gme: GmeFundingInputs;
  supervision: SupervisionInputs;
  program: ProgramCostInputs;
  efficiency: EfficiencyInputs;
  /** Per-year clinical parameters keyed by PGY level. */
  clinical: Record<ResidencyYear, ResidentYearClinicalParams>;
}

/* ------------------------------------------------------------------ */
/* Outputs                                                            */
/* ------------------------------------------------------------------ */

/** A labeled dollar figure used in benefit/cost breakdowns. */
export interface LineItem {
  key: string;
  label: string;
  amount: number;
  /** Optional explanation of how the amount was derived. */
  detail?: string;
}

/** Result for a single program year (during ramp-up or at steady state). */
export interface YearResult {
  /** 1-based program calendar year (year 1 = first class arrives). */
  programYear: number;
  /** Residents present that year, by PGY level. */
  residentsByYear: Record<ResidencyYear, number>;
  totalResidents: number;
  benefits: LineItem[];
  costs: LineItem[];
  totalBenefits: number;
  totalCosts: number;
  netValue: number;
  /**
   * Modeling caveats raised by this year's inputs (coverage capped at demand,
   * supervision ratios beyond Medicare limits, cap headroom exceeded, …).
   * Advisory only — nothing here blocks a calculation.
   */
  warnings: string[];
}

/** Full model output. */
export interface ModelResult {
  /** Per-year results for the phased build-out (classes accumulate to full). */
  rampYears: YearResult[];
  /** Steady-state year (all four classes present). */
  steadyState: YearResult;
  /** Cumulative net value across the ramp plus one steady-state year. */
  fiveYearCumulativeNet: number;
  /** Steady-state benefits and costs, itemized. */
  steadyStateBenefits: LineItem[];
  steadyStateCosts: LineItem[];
  /** De-duplicated union of every year's warnings, in first-seen order. */
  warnings: string[];
}
