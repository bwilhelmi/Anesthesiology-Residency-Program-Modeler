/**
 * Domain types for the ACGME anesthesiology residency program cost/benefit model.
 *
 * MONEY CONVENTION: every monetary input is in YEAR-1 DOLLARS AS TYPED. The
 * user never enters an inflated figure; escalation happens inside the
 * projection (see ProjectionInputs), where each stream grows at its own rate
 * and the whole frame is discounted back for NPV.
 *
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
  /** Median BASE salary for a CRNA (Certified Registered Nurse Anesthetist). */
  crnaSalary: number;
  /**
   * Premium pay a CRNA earns above base, as a fraction of base salary:
   * overtime on rooms that run past the scheduled day, holiday pay, and
   * weekend/call differentials.
   *
   * This exists because the substitution is NOT symmetric. A resident is paid a
   * fixed stipend no matter how late the room runs or which holiday it falls
   * on; a CRNA is paid more for both. Valuing resident coverage against a CRNA
   * BASE salary therefore understates what that coverage is actually worth to
   * the hospital, and it is the only place in the model where the asymmetry can
   * be stated.
   *
   * Applies solely to the labor-substitution credit — it is a property of the
   * coverage being displaced, not of anyone's employment terms.
   */
  crnaPremiumPayLoad: number;
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

/**
 * Which Medicare GME world the hospital lives in. This is the single largest
 * real-world lever in the model and cannot be expressed as a boolean: a hospital
 * that has never trained residents BUILDS a cap out of this program, while an
 * established teaching hospital inherits one fixed decades ago.
 */
export type HospitalGmeScenario =
  /** No existing FTE cap or PRA; the cap is built by this program (42 CFR 413.79(e)). */
  | "newTeachingHospital"
  /** An established teaching hospital with unused room under its cap. */
  | "existingUnderCap"
  /** Cap fully used; only awarded slots create funded FTE. */
  | "atCap";

/** How a state Medicaid program pays GME, if at all. */
export type MedicaidGmeMode = "none" | "perResident" | "appropriation";

/** State Medicaid GME support — mechanism differs materially by state. */
export interface MedicaidGmeInputs {
  mode: MedicaidGmeMode;
  /** perResident mode: dollars per resident FTE per year. */
  perResidentAmount: number;
  /**
   * appropriation mode: a fixed annual pool directed to this hospital,
   * independent of how many residents it trains.
   */
  annualAppropriationTotal: number;
  /**
   * appropriation mode: the payment depends on a funded non-federal share
   * (e.g. an Arizona AHCCCS intergovernmental agreement). Without a committed
   * IGA sponsor the money is not real.
   */
  requiresLocalMatch: boolean;
}

/** Medicare / Medicaid graduate medical education (GME) funding inputs. */
export interface GmeFundingInputs {
  scenario: HospitalGmeScenario;
  /**
   * existingUnderCap only: resident FTE slots still available under the cap.
   * New residents above this count generate no new Medicare GME.
   */
  capHeadroomFte: number;
  /**
   * New cap slots awarded to the hospital under CAA 2021 §126 (1,000 slots
   * phased FY2023–FY2027) or CAA 2023 §4122 (200 slots, FY2026, at least 100
   * psychiatry-directed), via the CMS application process. Additional headroom
   * under existingUnderCap; the ONLY source of funded FTE at cap.
   */
  awardedNewSlots: number;
  /**
   * Medicare Direct GME Per-Resident Amount (PRA) for the hospital. This is
   * hospital-specific, set historically and trended forward by CMS. Used for
   * the two established-hospital scenarios; a new teaching hospital's PRA is
   * derived from the two fields below instead.
   */
  directGmePerResidentAmount: number;
  /**
   * newTeachingHospital only: the hospital's own projected allowable GME cost
   * per FTE in the base period.
   */
  newHospitalProjectedCostPerFte: number;
  /**
   * newTeachingHospital only: the locality-adjusted weighted mean PRA of
   * nearby teaching hospitals, which caps the new hospital's PRA.
   */
  localityWeightedMeanPra: number;
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
  /**
   * Annual Medicare inpatient CAPITAL PPS payments to the hospital, the base
   * for the capital IME add-on (42 CFR 412.322). Leave at 0 to disable the
   * capital IME line.
   */
  medicareCapitalPayments: number;
  /** Available beds (denominator of the resident-to-bed ratio for IME). */
  availableBeds: number;
  /**
   * Existing approved resident FTEs already training at the hospital (across
   * all specialties). New anesthesia residents are added on top of this for
   * the marginal IME calculation, since IME is nonlinear in the ratio.
   */
  existingResidentFte: number;
  /**
   * Apply the IME resident-to-bed ratio cap (42 CFR 412.105(a)(1)): the ratio
   * used in a year may not exceed the prior year's, except for new programs in
   * their growth window. Realistic; leave on.
   */
  applyImeRatioCap: boolean;
  /**
   * Apply the three-year rolling average FTE count (42 CFR 413.79(d)), with
   * the new-program exclusion during the growth window. Realistic; leave on.
   */
  applyRollingAverage: boolean;
  /** State Medicaid GME support. */
  medicaid: MedicaidGmeInputs;
}

/**
 * Clinical value parameters for one resident year. Captures how much billable
 * anesthesia coverage a resident at this level provides and how much of the
 * year they actually spend delivering anesthesia (vs. required off-service
 * rotations), plus service value delivered to host departments while away.
 */
export interface ResidentYearClinicalParams {
  /**
   * Fraction of the training year spent at the SPONSOR hospital, as opposed to
   * participating sites (county hospital, VA, children's, private practice
   * electives). Medicare FTEs count where the training occurs, and clinical
   * value accrues where the resident is standing: a PGY-1 on required
   * off-service months at a participating site generates neither sponsor
   * Medicare FTE nor sponsor coverage for those months.
   */
  sponsorSiteShare: number;
  /**
   * Fraction of sponsor-site time that is countable for IME — patient-care
   * activities. Non-patient-care research time is excluded.
   * 42 CFR 412.105(f) — patient care activities; didactics and other approved
   * activities per the current rule text; research excluded.
   */
  imeCountableShare: number;
  /**
   * Fraction of SPONSOR-SITE time the resident spends staffing anesthetizing
   * locations (vs. off-service rotations, vacation, didactics). Conditional on
   * being at the sponsor hospital: composite anesthesia exposure over the year
   * is sponsorSiteShare × fractionOnAnesthesia. Intern year is low; CA years
   * are high.
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
  /**
   * Professional liability per resident per year — the institutional policy
   * allocation for a trainee.
   */
  residentLiabilityAnnual: number;
  /**
   * GME institutional overhead allocated per resident: the DIO's time, the
   * GMEC, and the GME office that the ACGME Institutional Requirements oblige
   * a sponsoring institution to maintain. Real money, routinely left out of
   * program-level pro formas because it sits in a different cost center.
   */
  gmeInstitutionalOverheadPerResident: number;
  /**
   * Per-resident fees: ERAS/NRMP share, the in-training exam, ABA BASIC and
   * board fees, training licenses, ACLS/PALS certification.
   */
  perResidentFeesAnnual: number;
  /**
   * Net annual payment under affiliation agreements with participating sites.
   * Positive = the sponsor pays out (the usual direction when residents rotate
   * away and the sponsor keeps paying their stipends); negative = the sponsor
   * receives support for residents rotating in.
   */
  participatingSiteSupportAnnual: number;
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

/**
 * The workforce-pipeline benefit: residents who stay on as attendings.
 *
 * This is an AVOIDED COST, not revenue — recruitment fees, signing bonuses, and
 * the locum bridge a vacancy would otherwise need. Stated that way it survives
 * a CFO's scrutiny; stated as "revenue from retained physicians" it does not.
 */
export interface RetentionInputs {
  enabled: boolean;
  /** Share of graduates hired by the hospital or its anesthesia group. */
  retentionRate: number;
  /** Recruiting + signing + locum-bridge cost avoided per retained hire. */
  avoidedCostPerRetainedHire: number;
  /** Years over which the avoided cost is recognized, starting at graduation. */
  benefitRecognitionYears: number;
}

/**
 * Overnight in-house coverage residents provide. OFF by default because it
 * double-counts for most users: if the coverage FTEs already include call, this
 * value is already in the labor-substitution line.
 */
export interface CallCoverageInputs {
  enabled: boolean;
  nightsPerYearCovered: number;
  /** CRNA call stipend / overtime / locum night the coverage avoids. */
  avoidedCostPerNight: number;
}

/**
 * The frame the money is projected in: how long, how early the spending starts,
 * what it is discounted at, and how each stream grows.
 */
export interface ProjectionInputs {
  /** Program years 1..N reported after the pre-revenue period. */
  horizonYears: number;
  /**
   * Years of spending BEFORE the first class arrives — accreditation, program
   * director recruitment, the first Match cycle. Modeled as program years 0
   * and −1, with no residents and no revenue.
   */
  preRevenueYears: number;
  /** Discount rate for NPV — a hospital hurdle rate / WACC proxy. */
  discountRate: number;
  /** Annual growth in wages and benefits. */
  salaryInflation: number;
  /** Annual update to the Per-Resident Amount (CPI-U proxy, per 42 CFR 413.77). */
  praUpdateRate: number;
  /**
   * Annual growth in payment bases: the Medicare IME/capital base, the margin
   * per staffed location, and the off-service provider's cost. State Medicaid
   * GME is deliberately NOT escalated — appropriations and per-resident rates
   * routinely sit flat for years, and assuming growth there flatters the case.
   */
  paymentBaseGrowth: number;
}

/** The full set of model inputs. */
export interface ModelInputs {
  /** Residents recruited per class (per PGY cohort). Steady state = 4 classes. */
  residentsPerClass: number;
  /**
   * Annual attrition rate. A class of n entering residents is n × (1 − rate)^k
   * strong after k years in the program. FTEs stay fractional — rounding a
   * cohort to whole people would misstate both cost and Medicare FTE.
   */
  annualAttritionRate: number;
  salaries: SalaryInputs;
  locations: AnesthetizingLocations;
  gme: GmeFundingInputs;
  supervision: SupervisionInputs;
  program: ProgramCostInputs;
  efficiency: EfficiencyInputs;
  projection: ProjectionInputs;
  retention: RetentionInputs;
  callCoverage: CallCoverageInputs;
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
  /**
   * Program calendar year. Year 1 is when the first class arrives; years 0 and
   * below are the pre-revenue build-up before it.
   */
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

/** Headline figures for the whole projection. */
export interface ModelSummary {
  /** Sum of net value over every modeled year, undiscounted. */
  nominalCumulativeNet: number;
  /** Net present value at the discount rate, over the same frame. */
  npv: number;
  /**
   * First program year in which cumulative discounted net turns non-negative,
   * or null if it never does inside the horizon.
   */
  breakevenYear: number | null;
  /** Undiscounted net value of the mature steady-state year. */
  steadyStateAnnualNet: number;
}

/** Full model output. */
export interface ModelResult {
  /** Every modeled year, pre-revenue years first. */
  years: YearResult[];
  /** Per-year results for the phased build-out (classes accumulate to full). */
  rampYears: YearResult[];
  /** The mature steady-state year. */
  steadyState: YearResult;
  summary: ModelSummary;
  /**
   * @deprecated Use `summary` instead. Nominal sum of program years 1–5; kept
   * so external links and saved comparisons do not break silently. It excludes
   * the pre-revenue years, which now carry the startup cost.
   */
  fiveYearCumulativeNet: number;
  /** Steady-state benefits and costs, itemized. */
  steadyStateBenefits: LineItem[];
  steadyStateCosts: LineItem[];
  /** De-duplicated union of every year's warnings, in first-seen order. */
  warnings: string[];
}
