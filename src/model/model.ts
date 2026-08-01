/**
 * Top-level cost/benefit model: combines GME funding, clinical labor value, and
 * program costs into per-year and steady-state results.
 *
 * A residency program is built out one class at a time: in program year 1 only
 * the PGY-1 class is present; by year 4 all four classes (PGY-1..PGY-4) are
 * present ("steady state"). We report each ramp year plus steady state so the
 * user can see the cash-flow trajectory, not just the mature program.
 */

import {
  coverageFteForYear,
  incrementalSupervisionCostPerLocation,
  juniorityWeight,
  laborSubstitutionValue,
  offServiceValue,
  staffedLocationDemand,
  totalCoverageFte,
} from "./clinical";
import {
  MEDICAL_DIRECTION_CONCURRENCY_LIMIT,
  TEACHING_ANESTHESIA_CONCURRENCY_LIMIT,
} from "./constants";
import { directGme, marginalIme, medicaidGme } from "./gme";
import { annualProgramSupportCost, loadedResidentCost, residentSalaryCost } from "./program";
import type {
  LineItem,
  ModelInputs,
  ModelResult,
  ResidencyYear,
  YearResult,
} from "./types";
import { RESIDENCY_YEARS, YEAR_LABELS } from "./types";

/** Residents present in a given program year (1-based), as classes accumulate. */
export function residentsInProgramYear(
  inputs: ModelInputs,
  programYear: number
): Record<ResidencyYear, number> {
  const perClass = Math.max(0, inputs.residentsPerClass);
  const out: Record<ResidencyYear, number> = {
    PGY1: 0,
    PGY2: 0,
    PGY3: 0,
    PGY4: 0,
  };
  // In program year Y, classes that have started are PGY1..PGY(min(Y,4)).
  const classesPresent = Math.min(programYear, RESIDENCY_YEARS.length);
  for (let i = 0; i < classesPresent; i++) {
    out[RESIDENCY_YEARS[i]] = perClass;
  }
  return out;
}

/** Compute benefits and costs for a specific resident cohort composition. */
export function computeYear(
  inputs: ModelInputs,
  programYear: number,
  residentsByYear: Record<ResidencyYear, number>
): YearResult {
  const totalResidents = RESIDENCY_YEARS.reduce(
    (s, y) => s + (residentsByYear[y] ?? 0),
    0
  );
  const totalFte = totalResidents; // one clinical FTE headcount per resident
  const warnings: string[] = [];

  /* ----------------------------- Benefits ------------------------------- */

  const dgme = directGme(totalFte, inputs.gme);
  const ime = marginalIme(totalFte, inputs.gme);
  const medicaid = medicaidGme(totalFte, inputs.gme);

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
    warnings.push(
      `Modeled resident coverage (${round1(rawCoverage)} anesthetist-equivalent FTE) ` +
        `exceeds the ${round1(demand)} staffed anesthetizing locations the hospital runs ` +
        `on an average day. Coverage value, supervision cost, and throughput loss are ` +
        `capped at demand: residents beyond that point add cost but no additional ` +
        `coverage value.`
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
        "PRA × fundable resident FTE × Medicare inpatient share (capped by FTE headroom).",
    },
    {
      key: "ime",
      label: "Medicare Indirect Medical Education (IME)",
      amount: ime,
      detail: "Marginal IME add-on on Medicare inpatient PPS payments (nonlinear in resident-to-bed ratio).",
    },
    {
      key: "medicaid",
      label: "Medicaid GME support",
      amount: medicaid,
      detail: "State Medicaid per-resident support (not subject to the Medicare cap).",
    },
    {
      key: "labor",
      label: "Clinical labor substitution (CRNA coverage offset)",
      amount: laborValue,
      detail:
        demandCapFactor < 1
          ? `Anesthetist-equivalent coverage residents provide, valued at fully-loaded CRNA cost — capped at the ${round1(demand)} staffed locations the hospital runs.`
          : "Anesthetist-equivalent coverage residents provide, valued at fully-loaded CRNA cost.",
    },
    {
      key: "offservice",
      label: "Off-service / intern service value to host departments",
      amount: offService,
      detail: "Value residents deliver on required non-anesthesia rotations (mainly the intern year).",
    },
  ];

  /* ------------------------------- Costs -------------------------------- */

  const residentCost = residentSalaryCost(inputs.salaries, totalResidents);
  const supportCost = annualProgramSupportCost(inputs, totalResidents);

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
      key: "efficiency",
      label: "Teaching efficiency / throughput loss",
      amount: efficiencyLoss,
      detail: "Lost clinical margin from slower teaching cases, weighted toward junior residents.",
    },
    {
      key: "supervision",
      label: "Incremental attending supervision (1:2 teaching vs 1:4 direction)",
      amount: supervisionCost,
      detail: `${round1(coveredLocations)} resident-covered location(s) × the extra attending time a teaching room consumes at 1:${inputs.supervision.maxResidentSupervisionRatio} (42 CFR 415.178) versus a medically directed CRNA room at 1:${inputs.supervision.maxCrnaSupervisionRatio} (42 CFR 415.110).`,
    },
  ];

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

/** Run the full model: ramp years 1..4 plus the steady-state year. */
export function runModel(inputs: ModelInputs): ModelResult {
  const rampYears: YearResult[] = [];
  for (let y = 1; y <= RESIDENCY_YEARS.length; y++) {
    rampYears.push(computeYear(inputs, y, residentsInProgramYear(inputs, y)));
  }

  const steadyState = computeYear(
    inputs,
    RESIDENCY_YEARS.length,
    residentsInProgramYear(inputs, RESIDENCY_YEARS.length)
  );

  // Cumulative net across the four ramp years, less one-time startup cost.
  const rampNet = sum(rampYears.map((r) => r.netValue));
  const fiveYearCumulativeNet =
    rampNet + steadyState.netValue - inputs.program.startupCost;

  return {
    rampYears,
    steadyState,
    fiveYearCumulativeNet,
    steadyStateBenefits: steadyState.benefits,
    steadyStateCosts: steadyState.costs,
    warnings: dedupe([...rampYears, steadyState].flatMap((y) => y.warnings)),
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

function fmt(x: number): string {
  return `$${Math.round(x).toLocaleString("en-US")}`;
}

export { YEAR_LABELS };
