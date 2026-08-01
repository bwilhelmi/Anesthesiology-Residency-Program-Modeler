/**
 * Top-level cost/benefit model: combines GME funding, clinical labor value, and
 * program costs into per-year and steady-state results.
 *
 * A residency program is built out one class at a time: in program year 1 only
 * the PGY-1 class is present; by year 4 all four classes (PGY-1..PGY-4) are
 * present. Full complement is not the same as mature economics, though — the
 * Medicare cap, the three-year rolling average, and the IME ratio cap only all
 * bind from program year 6 — so the reported steady state is that mature year.
 * We report each ramp year plus steady state so the user can see the cash-flow
 * trajectory, not just the mature program.
 */

import {
  countableFteForResident,
  coverageFteForYear,
  incrementalSupervisionCostPerLocation,
  juniorityWeight,
  laborSubstitutionValue,
  loaded,
  offServiceValue,
  staffedLocationDemand,
  totalCoverageFte,
} from "./clinical";
import {
  EARLY_PRE_REVENUE_RAMP_FACTOR,
  MATURE_PROGRAM_YEAR,
  MEDICAL_DIRECTION_CONCURRENCY_LIMIT,
  PREMIUM_LOAD_CALL_OVERLAP_THRESHOLD,
  RESIDENCY_YEARS_TO_CA2,
  TEACHING_ANESTHESIA_CONCURRENCY_LIMIT,
} from "./constants";
import { gmeFundingTimeline, medicaidGme } from "./gme";
import type { GmeYearFte, GmeYearFunding } from "./gme";
import {
  annualProgramSupportCost,
  loadedResidentCost,
  perResidentProgramCost,
  residentSalaryCost,
} from "./program";
import {
  FIRST_GRADUATION_BENEFIT_YEAR,
  callCoverageBenefit,
  retentionBenefit,
} from "./workforce";
import type {
  LineItem,
  ModelInputs,
  ModelResult,
  ModelSummary,
  ProjectionInputs,
  ResidencyYear,
  YearResult,
} from "./types";
import { RESIDENCY_YEARS, YEAR_LABELS } from "./types";

/**
 * Residents present in a given program year (1-based), as classes accumulate
 * and attrition thins the senior cohorts.
 *
 * Headcounts stay fractional on purpose: a cohort of 9.8 is the right expected
 * value for cost and Medicare FTE alike, and rounding it to people would
 * misstate both.
 */
export function residentsInProgramYear(
  inputs: ModelInputs,
  programYear: number
): Record<ResidencyYear, number> {
  const perClass = Math.max(0, inputs.residentsPerClass);
  const survival = 1 - clamp01(inputs.annualAttritionRate);
  const out: Record<ResidencyYear, number> = {
    PGY1: 0,
    PGY2: 0,
    PGY3: 0,
    PGY4: 0,
  };
  // In program year Y, classes that have started are PGY1..PGY(min(Y,4)).
  const classesPresent = Math.min(programYear, RESIDENCY_YEARS.length);
  for (let i = 0; i < classesPresent; i++) {
    // i years already completed in the program.
    out[RESIDENCY_YEARS[i]] = perClass * Math.pow(survival, i);
  }
  return out;
}

/**
 * Medicare-countable resident FTE for one program year.
 *
 * Headcount is not FTE: residents count at the hospital where the training
 * occurs, so a cohort's contribution is scaled by the share of the year spent
 * at the sponsor site, and IME additionally by the patient-care share of that
 * time (42 CFR 412.105(f)).
 */
export function countableFteForYear(
  inputs: ModelInputs,
  programYear: number,
  residentsByYear: Record<ResidencyYear, number>
): GmeYearFte {
  const byLevel: Record<ResidencyYear, number> = {
    PGY1: 0,
    PGY2: 0,
    PGY3: 0,
    PGY4: 0,
  };
  let imeFte = 0;
  for (const year of RESIDENCY_YEARS) {
    const n = residentsByYear[year] ?? 0;
    const countable = countableFteForResident(inputs.clinical[year]);
    byLevel[year] = n * countable.dgme;
    imeFte += n * countable.ime;
  }
  const dgmeFte = RESIDENCY_YEARS.reduce((s, y) => s + byLevel[y], 0);
  return { programYear, byLevel, dgmeFte, imeFte };
}

/**
 * Compute benefits and costs for a specific resident cohort composition.
 *
 * `funding` carries the year's Medicare determination (cap, rolling average,
 * ratio cap), which is inherently a function of the program's history. When it
 * is omitted the year is priced in isolation, as if no prior years existed —
 * fine for a single-year inspection, but runModel() always supplies it.
 */
export function computeYear(
  inputs: ModelInputs,
  programYear: number,
  residentsByYear: Record<ResidencyYear, number>,
  funding?: GmeYearFunding
): YearResult {
  const totalResidents = RESIDENCY_YEARS.reduce(
    (s, y) => s + (residentsByYear[y] ?? 0),
    0
  );
  const totalFte = totalResidents; // one clinical FTE headcount per resident
  const warnings: string[] = [];

  /* ----------------------------- Benefits ------------------------------- */

  const gmeFunding =
    funding ??
    gmeFundingTimeline(inputs.gme, [
      countableFteForYear(inputs, programYear, residentsByYear),
    ])[0];
  warnings.push(...gmeFunding.warnings);

  const dgme = gmeFunding.dgme;
  const ime = gmeFunding.ime;
  const medicaid = medicaidGme(totalFte, inputs.gme.medicaid);
  if (
    inputs.gme.medicaid.mode === "appropriation" &&
    inputs.gme.medicaid.requiresLocalMatch &&
    inputs.gme.medicaid.annualAppropriationTotal > 0
  ) {
    warnings.push(
      "Appropriation/IGA-based Medicaid GME (e.g. Arizona AHCCCS) requires a funded " +
        "intergovernmental agreement for the non-federal share — treat it as $0 until an " +
        "IGA sponsor is committed."
    );
  }

  /*
   * Coverage, labor value, and the teaching margin loss all move together, so
   * they are accumulated raw and then scaled by a single demand cap factor: a
   * hospital cannot harvest coverage value for rooms it does not run.
   */
  let rawCoverage = 0;
  let rawLaborValue = 0;
  let rawThroughputLoss = 0;
  let offService = 0;
  for (const year of RESIDENCY_YEARS) {
    const n = residentsByYear[year] ?? 0;
    if (n === 0) continue;
    const params = inputs.clinical[year];
    const coveredLocations = n * coverageFteForYear(params);
    rawCoverage += coveredLocations;
    rawLaborValue += n * laborSubstitutionValue(params, inputs.salaries);
    // Teaching slowdown, charged once here as lost margin on the covered
    // locations and weighted toward junior residents.
    rawThroughputLoss +=
      coveredLocations *
      inputs.efficiency.annualMarginPerStaffedLocation *
      inputs.efficiency.caseThroughputLoss *
      juniorityWeight(year);
    offService += n * offServiceValue(params);
  }

  const demand = staffedLocationDemand(inputs);
  const demandCapFactor = rawCoverage > demand && rawCoverage > 0 ? demand / rawCoverage : 1;
  if (demandCapFactor < 1) {
    // Deliberately free of year-specific numbers: this warning is emitted by
    // every year past the cap, and the result-level union de-duplicates on the
    // exact string. The per-year figures live in the labor line-item detail.
    warnings.push(
      `Modeled resident coverage exceeds the ${round1(demand)} staffed anesthetizing ` +
        `locations the hospital runs on an average day. Coverage value, supervision ` +
        `cost, and throughput loss are capped at demand: residents beyond that point ` +
        `add cost but no additional coverage value.`
    );
  }
  const coveredLocations = rawCoverage * demandCapFactor;
  const laborValue = rawLaborValue * demandCapFactor;

  if (inputs.supervision.maxResidentSupervisionRatio > TEACHING_ANESTHESIA_CONCURRENCY_LIMIT) {
    warnings.push(
      `Max resident cases per teaching anesthesiologist ` +
        `(${inputs.supervision.maxResidentSupervisionRatio}) exceeds the Medicare ` +
        `teaching-rule concurrency of ${TEACHING_ANESTHESIA_CONCURRENCY_LIMIT} in ` +
        `42 CFR 415.178; cases beyond it are not paid at the full base-unit amount.`
    );
  }
  if (inputs.supervision.maxCrnaSupervisionRatio > MEDICAL_DIRECTION_CONCURRENCY_LIMIT) {
    warnings.push(
      `Max CRNA cases per anesthesiologist ` +
        `(${inputs.supervision.maxCrnaSupervisionRatio}) exceeds the medical-direction ` +
        `limit of ${MEDICAL_DIRECTION_CONCURRENCY_LIMIT} in 42 CFR 415.110; beyond it ` +
        `the service is medically supervised, not medically directed.`
    );
  }

  const benefits: LineItem[] = [
    {
      key: "dgme",
      label: "Medicare Direct GME (DGME)",
      amount: dgme,
      detail:
        `PRA × ${round1(gmeFunding.paymentDgmeFte)} payment FTE × Medicare inpatient share. ` +
        describeCap(gmeFunding),
    },
    {
      key: "ime",
      label: "Medicare Indirect Medical Education (IME)",
      amount: ime,
      detail: `Marginal IME add-on on Medicare inpatient operating payments (nonlinear in the resident-to-bed ratio, here ${gmeFunding.imeRatio.toFixed(3)}).`,
    },
    {
      key: "medicaid",
      label: "Medicaid GME support",
      amount: medicaid,
      detail:
        inputs.gme.medicaid.mode === "appropriation"
          ? "State Medicaid GME appropriation directed to this hospital — a fixed pool, independent of resident count."
          : "State Medicaid per-resident support (not subject to the Medicare cap).",
    },
    {
      key: "labor",
      label: "Clinical labor substitution (CRNA coverage offset)",
      amount: laborValue,
      detail:
        demandCapFactor < 1
          ? `Anesthetist-equivalent coverage residents provide, valued at fully-loaded CRNA cost. This year's ${round1(rawCoverage)} FTE of coverage is capped at the ${round1(demand)} staffed locations the hospital runs.`
          : "Anesthetist-equivalent coverage residents provide, valued at fully-loaded CRNA cost.",
    },
    {
      key: "offservice",
      label: "Off-service / intern service value to host departments",
      amount: offService,
      detail: "Value residents deliver on required non-anesthesia rotations (mainly the intern year).",
    },
  ];

  // Workforce pipeline: graduates the hospital hires instead of recruiting.
  const retention = retentionBenefit(
    inputs,
    (y) => residentsInProgramYear(inputs, y),
    programYear
  );
  if (inputs.retention.enabled) {
    benefits.push({
      key: "retention",
      label: "Retention pipeline (avoided recruitment cost)",
      amount: retention,
      detail:
        programYear < FIRST_GRADUATION_BENEFIT_YEAR
          ? `No class has graduated yet; the first hiring benefit lands in program year ${FIRST_GRADUATION_BENEFIT_YEAR}.`
          : `Graduates hired × ${percentText(inputs.retention.retentionRate)} retention × the recruiting, signing, and locum-bridge cost their hire avoids. This is avoided cost, not revenue.`,
    });
  }

  const callCoverage = callCoverageBenefit(inputs.callCoverage, programYear);
  if (
    inputs.callCoverage.enabled &&
    inputs.salaries.crnaPremiumPayLoad > PREMIUM_LOAD_CALL_OVERLAP_THRESHOLD
  ) {
    warnings.push(
      "Call-coverage benefit is on while the CRNA premium load is high — confirm " +
        "call pay is not counted in both places. A premium load taken straight from " +
        "payroll already contains overnight call pay; the load should cover " +
        "scheduled-day premium only."
    );
  }
  if (inputs.callCoverage.enabled) {
    benefits.push({
      key: "call",
      label: "Overnight in-house call coverage (avoided cost)",
      amount: callCoverage,
      detail:
        programYear < RESIDENCY_YEARS_TO_CA2
          ? "Flat from the first year the program has CA-2s (program year 3)."
          : `${inputs.callCoverage.nightsPerYearCovered} nights × the CRNA call stipend, overtime, or locum night avoided. Do not enable this if your coverage FTEs already include call.`,
    });
  }

  // Capital IME is off unless the hospital's capital PPS payments are supplied,
  // so an estimate never gains a line the user did not ask for.
  if (gmeFunding.capitalIme > 0) {
    benefits.splice(2, 0, {
      key: "capitalime",
      label: "Medicare capital IME add-on",
      amount: gmeFunding.capitalIme,
      detail:
        "Marginal capital IME on Medicare capital PPS payments: e^(0.2822 × resident-to-bed ratio) − 1 (42 CFR 412.322).",
    });
  }

  /* ------------------------------- Costs -------------------------------- */

  const residentCost = residentSalaryCost(inputs.salaries, totalResidents);
  const supportCost = annualProgramSupportCost(inputs, totalResidents);
  const perResidentAnnual = perResidentProgramCost(inputs.program);
  const perResidentCost = perResidentAnnual * totalResidents;

  // Teaching efficiency loss: net margin lost on the resident-covered locations
  // due to teaching slowdown, valued at the margin per staffed location. Charged
  // exactly once (it is no longer also netted out of the coverage FTE).
  const efficiencyLoss = rawThroughputLoss * demandCapFactor;

  // Incremental attending supervision: resident rooms tie up more attending time
  // per room (1:2, 42 CFR 415.178) than medically directed CRNA rooms (1:4,
  // 42 CFR 415.110). That extra attending time is a real cost of the teaching
  // staffing model and scales with the covered locations.
  const supervisionCost =
    coveredLocations *
    incrementalSupervisionCostPerLocation(inputs.salaries, inputs.supervision);

  const costs: LineItem[] = [
    {
      key: "residentsalary",
      label: "Resident stipends + benefits",
      amount: residentCost,
      detail: `${totalResidents} resident(s) at ${fmt(
        loadedResidentCost(inputs.salaries)
      )} fully loaded (stipend + ${fmt(inputs.salaries.residentBenefitAnnual)} benefits).`,
    },
    {
      key: "support",
      label: "Program leadership, coordination & overhead",
      amount: supportCost,
      detail: "PD/APD protected time, coordinator(s), non-billable faculty teaching, fixed overhead.",
    },
    {
      key: "perresident",
      label: "Per-resident program costs (liability, GME office, fees)",
      amount: perResidentCost,
      detail: `${round1(totalResidents)} resident(s) × ${fmt(perResidentAnnual)}: professional liability, the DIO/GMEC/GME-office allocation the ACGME Institutional Requirements oblige, and ERAS/NRMP, ITE, ABA and licensure fees.`,
    },
    {
      key: "efficiency",
      label: "Teaching efficiency / throughput loss",
      amount: efficiencyLoss,
      detail: "Lost clinical margin from slower teaching cases, weighted toward junior residents.",
    },
    {
      key: "supervision",
      label: "Incremental attending supervision (1:2 teaching vs 1:4 direction)",
      amount: supervisionCost,
      detail: `${round1(coveredLocations)} resident-covered location(s) × the extra attending time a teaching room consumes at 1:${round1(inputs.supervision.maxResidentSupervisionRatio)} (42 CFR 415.178) versus a medically directed CRNA room at 1:${round1(inputs.supervision.maxCrnaSupervisionRatio)} (42 CFR 415.110).`,
    },
  ];

  // Affiliation agreements with participating sites, net and in either
  // direction. Omitted from the breakdown entirely when the user has not set it.
  if (inputs.program.participatingSiteSupportAnnual !== 0 && totalResidents > 0) {
    costs.push({
      key: "sitesupport",
      label: "Participating-site support (affiliation agreements)",
      amount: inputs.program.participatingSiteSupportAnnual,
      detail:
        inputs.program.participatingSiteSupportAnnual > 0
          ? "Net annual payment the sponsor makes to participating sites where residents rotate."
          : "Net annual support the sponsor receives from participating sites (shown as a negative cost).",
    });
  }

  const totalBenefits = sum(benefits.map((b) => b.amount));
  const totalCosts = sum(costs.map((c) => c.amount));

  return {
    programYear,
    residentsByYear,
    totalResidents,
    benefits,
    costs,
    totalBenefits,
    totalCosts,
    netValue: totalBenefits - totalCosts,
    warnings,
  };
}

/* ------------------------- Escalation over the frame ---------------------- */

/**
 * Growth factors applied to a program year's dollars. Inputs are typed in
 * year-1 dollars, so program year 1 escalates by nothing and the pre-revenue
 * years (0, −1) sit slightly BELOW the typed figures — the same money, earlier.
 */
export function escalationFactors(
  projection: ProjectionInputs,
  programYear: number
): { wage: number; pra: number; base: number } {
  const t = programYear - 1;
  return {
    wage: Math.pow(1 + projection.salaryInflation, t),
    pra: Math.pow(1 + projection.praUpdateRate, t),
    base: Math.pow(1 + projection.paymentBaseGrowth, t),
  };
}

/**
 * A copy of the inputs with each dollar figure grown to the given program year.
 * Escalating the inputs (rather than the outputs) keeps every downstream
 * calculation — supervision cost, margin loss, per-resident costs — automatically
 * consistent with the year it is priced in.
 */
function escalateInputs(inputs: ModelInputs, programYear: number): ModelInputs {
  const f = escalationFactors(inputs.projection, programYear);
  if (f.wage === 1 && f.pra === 1 && f.base === 1) return inputs;

  const clinical = {} as ModelInputs["clinical"];
  for (const year of RESIDENCY_YEARS) {
    clinical[year] = {
      ...inputs.clinical[year],
      offServiceProviderAnnualCost:
        inputs.clinical[year].offServiceProviderAnnualCost * f.base,
    };
  }

  return {
    ...inputs,
    salaries: {
      ...inputs.salaries,
      anesthesiologistSalary: inputs.salaries.anesthesiologistSalary * f.wage,
      crnaSalary: inputs.salaries.crnaSalary * f.wage,
      residentSalary: inputs.salaries.residentSalary * f.wage,
      residentBenefitAnnual: inputs.salaries.residentBenefitAnnual * f.wage,
    },
    program: {
      ...inputs.program,
      programCoordinatorCost: inputs.program.programCoordinatorCost * f.wage,
      fixedAnnualProgramOverhead: inputs.program.fixedAnnualProgramOverhead * f.wage,
      participatingSiteSupportAnnual:
        inputs.program.participatingSiteSupportAnnual * f.wage,
      startupCost: inputs.program.startupCost * f.wage,
      residentLiabilityAnnual: inputs.program.residentLiabilityAnnual * f.wage,
      gmeInstitutionalOverheadPerResident:
        inputs.program.gmeInstitutionalOverheadPerResident * f.wage,
      perResidentFeesAnnual: inputs.program.perResidentFeesAnnual * f.wage,
    },
    retention: {
      ...inputs.retention,
      avoidedCostPerRetainedHire: inputs.retention.avoidedCostPerRetainedHire * f.wage,
    },
    callCoverage: {
      ...inputs.callCoverage,
      avoidedCostPerNight: inputs.callCoverage.avoidedCostPerNight * f.wage,
    },
    efficiency: {
      ...inputs.efficiency,
      annualMarginPerStaffedLocation:
        inputs.efficiency.annualMarginPerStaffedLocation * f.base,
    },
    clinical,
  };
}

/** Grow a year's Medicare dollars; the FTE determinations behind them do not move. */
function escalateFunding(
  funding: GmeYearFunding,
  inputs: ModelInputs,
  programYear: number
): GmeYearFunding {
  const f = escalationFactors(inputs.projection, programYear);
  return {
    ...funding,
    dgme: funding.dgme * f.pra,
    ime: funding.ime * f.base,
    capitalIme: funding.capitalIme * f.base,
  };
}

/* ------------------------------ Pre-revenue ------------------------------- */

/**
 * A year of spending before the first class arrives: accreditation work, the
 * program director's protected time, a coordinator, and the first Match cycle.
 * No residents, so no benefits of any kind — this is the hole the program has
 * to climb out of, and leaving it out is how pro formas end up optimistic.
 *
 * The final pre-revenue year (program year 0) is a full ramp-up year; earlier
 * ones are modeled at half the director's time and half the fixed overhead,
 * with the coordinator on board throughout.
 */
export function computePreRevenueYear(
  inputs: ModelInputs,
  programYear: number
): YearResult {
  const escalated = escalateInputs(inputs, programYear);
  const attendingLoaded = loaded(
    escalated.salaries.anesthesiologistSalary,
    escalated.salaries.benefitLoadRate
  );
  const isFinalPreRevenueYear = programYear === 0;
  const rampFactor = isFinalPreRevenueYear ? 1 : EARLY_PRE_REVENUE_RAMP_FACTOR;
  const preRevenueYears = Math.max(1, Math.round(inputs.projection.preRevenueYears));

  const pdFte = escalated.program.programDirectorFte * rampFactor;
  const costs: LineItem[] = [
    {
      key: "startup",
      label: "Startup & accreditation",
      amount: escalated.program.startupCost / preRevenueYears,
      detail: `One-time startup cost spread evenly across the ${preRevenueYears} pre-revenue year(s): ACGME application, consultants, initial build-out.`,
    },
    {
      key: "support",
      label: "Program leadership, coordination & overhead",
      amount: pdFte * attendingLoaded + escalated.program.programCoordinatorCost +
        escalated.program.fixedAnnualProgramOverhead * rampFactor,
      detail: `Assumption: the Program Director is hired early at ${(pdFte * 100).toFixed(0)}% protected time, the coordinator is on board from the first pre-revenue year, and ${rampFactor === 1 ? "full" : "half"} fixed overhead runs (recruitment, accreditation fees). No Associate PD and no faculty teaching effort until residents arrive.`,
    },
  ];

  const totalCosts = sum(costs.map((c) => c.amount));
  return {
    programYear,
    residentsByYear: { PGY1: 0, PGY2: 0, PGY3: 0, PGY4: 0 },
    totalResidents: 0,
    benefits: [],
    costs,
    totalBenefits: 0,
    totalCosts,
    netValue: -totalCosts,
    warnings: [],
  };
}

/* -------------------------------- Run it ---------------------------------- */

/**
 * Run the full model over the projection frame.
 *
 * Medicare funding depends on the program's history — a cap built in year 5, a
 * three-year rolling average, a ratio that cannot outrun last year's — so the
 * years are computed as one sequence rather than independently. The reported
 * "steady state" is the first MATURE year (program year 6), where the cap, the
 * rolling average, and the ratio cap all bind; years 1–4 are the ramp.
 */
export function runModel(inputs: ModelInputs): ModelResult {
  const horizon = Math.max(1, Math.round(inputs.projection.horizonYears));
  const preRevenueYears = Math.max(0, Math.round(inputs.projection.preRevenueYears));

  // Pre-revenue years run 0, −1, … and are reported oldest first.
  const preRevenue: YearResult[] = [];
  for (let y = 1 - preRevenueYears; y <= 0; y++) {
    preRevenue.push(computePreRevenueYear(inputs, y));
  }

  const cohorts: Record<ResidencyYear, number>[] = [];
  const fteByYear: GmeYearFte[] = [];
  for (let y = 1; y <= horizon; y++) {
    const cohort = residentsInProgramYear(inputs, y);
    cohorts.push(cohort);
    fteByYear.push(countableFteForYear(inputs, y, cohort));
  }

  const funding = gmeFundingTimeline(inputs.gme, fteByYear);
  const programYears = cohorts.map((cohort, i) => {
    const programYear = i + 1;
    return computeYear(
      escalateInputs(inputs, programYear),
      programYear,
      cohort,
      escalateFunding(funding[i], inputs, programYear)
    );
  });

  const years = [...preRevenue, ...programYears];
  const rampYears = programYears.slice(0, RESIDENCY_YEARS.length);
  const steadyState =
    programYears[Math.min(MATURE_PROGRAM_YEAR, horizon) - 1] ??
    programYears[programYears.length - 1];

  return {
    years,
    rampYears,
    steadyState,
    summary: summarize(years, inputs.projection),
    fiveYearCumulativeNet: sum(
      programYears.filter((y) => y.programYear <= 5).map((y) => y.netValue)
    ),
    steadyStateBenefits: steadyState.benefits,
    steadyStateCosts: steadyState.costs,
    warnings: dedupe(years.flatMap((y) => y.warnings)),
  };
}

/**
 * Headline figures over the whole frame. Discounting starts at period 0 in the
 * first modeled year — the earliest pre-revenue year — so the startup hole is
 * counted at full weight rather than discounted away.
 */
export function summarize(
  years: YearResult[],
  projection: ProjectionInputs
): ModelSummary {
  const preRevenueYears = Math.max(0, Math.round(projection.preRevenueYears));
  let npv = 0;
  let nominalCumulativeNet = 0;
  let cumulativeDiscounted = 0;
  let breakevenYear: number | null = null;

  for (const y of years) {
    const period = y.programYear + preRevenueYears - 1;
    const discounted = y.netValue / Math.pow(1 + projection.discountRate, period);
    npv += discounted;
    nominalCumulativeNet += y.netValue;
    cumulativeDiscounted += discounted;
    if (breakevenYear === null && y.programYear >= 1 && cumulativeDiscounted >= 0) {
      breakevenYear = y.programYear;
    }
  }

  const mature =
    years.find((y) => y.programYear === MATURE_PROGRAM_YEAR) ?? years[years.length - 1];

  return {
    nominalCumulativeNet,
    npv,
    breakevenYear,
    steadyStateAnnualNet: mature ? mature.netValue : 0,
  };
}

/** Convenience: total anesthetist-equivalent coverage at steady state. */
export function steadyStateCoverageFte(inputs: ModelInputs): number {
  return totalCoverageFte(
    residentsInProgramYear(inputs, RESIDENCY_YEARS.length),
    inputs
  );
}

/* --------------------------------- utils ---------------------------------- */

function sum(xs: number[]): number {
  return xs.reduce((a, b) => a + b, 0);
}

/** De-duplicate strings, preserving first-seen order. */
function dedupe(xs: string[]): string[] {
  return Array.from(new Set(xs));
}

function round1(x: number): string {
  return x.toFixed(1);
}

function clamp01(x: number): number {
  return Math.max(0, Math.min(1, x));
}

function percentText(fraction: number): string {
  return `${(fraction * 100).toFixed(0)}%`;
}

/** Plain-language note on what the FTE cap did to this year's DGME. */
function describeCap(funding: GmeYearFunding): string {
  if (funding.cap === null) {
    return "No FTE cap applies yet — the program is inside its cap-building window (42 CFR 413.79(e)(1)).";
  }
  const rolling =
    Math.abs(funding.paymentDgmeFte - funding.fundableDgmeFte) > 1e-9
      ? ` Paid on the three-year rolling average (42 CFR 413.79(d)), not this year's ${round1(funding.fundableDgmeFte)} fundable FTE.`
      : "";
  return `Fundable FTE capped at ${round1(funding.cap)}.${rolling}`;
}

function fmt(x: number): string {
  return `$${Math.round(x).toLocaleString("en-US")}`;
}

export { YEAR_LABELS };
