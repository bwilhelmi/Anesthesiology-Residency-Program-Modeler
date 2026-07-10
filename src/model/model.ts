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
  laborSubstitutionValue,
  loaded,
  offServiceValue,
  totalCoverageFte,
} from "./clinical";
import { directGme, marginalIme, medicaidGme } from "./gme";
import { annualProgramSupportCost, residentSalaryCost } from "./program";
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

  /* ----------------------------- Benefits ------------------------------- */

  const dgme = directGme(totalFte, inputs.gme);
  const ime = marginalIme(totalFte, inputs.gme);
  const medicaid = medicaidGme(totalFte, inputs.gme);

  // Clinical labor substitution + off-service service value, summed by level.
  let laborValue = 0;
  let offService = 0;
  for (const year of RESIDENCY_YEARS) {
    const n = residentsByYear[year] ?? 0;
    if (n === 0) continue;
    laborValue +=
      n *
      laborSubstitutionValue(
        year,
        inputs.clinical[year],
        inputs.salaries,
        inputs.efficiency
      );
    offService += n * offServiceValue(inputs.clinical[year]);
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
      detail: "Anesthetist-equivalent coverage residents provide, valued at fully-loaded CRNA cost.",
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
  // due to teaching slowdown, valued at the margin per staffed location.
  let efficiencyLoss = 0;
  for (const year of RESIDENCY_YEARS) {
    const n = residentsByYear[year] ?? 0;
    if (n === 0) continue;
    const coveredLocations =
      n * coverageFteForYear(year, inputs.clinical[year], inputs.efficiency);
    // The throughput loss is embedded in coverageFte; here we value the
    // remaining slowdown as lost margin on covered locations.
    efficiencyLoss +=
      coveredLocations *
      inputs.efficiency.annualMarginPerStaffedLocation *
      inputs.efficiency.teachingThroughputLoss;
  }

  const costs: LineItem[] = [
    {
      key: "residentsalary",
      label: "Resident stipends + benefits",
      amount: residentCost,
      detail: `${totalResidents} resident(s) at ${fmt(
        loaded(inputs.salaries.residentSalary, inputs.salaries.benefitLoadRate)
      )} fully loaded.`,
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

function fmt(x: number): string {
  return `$${Math.round(x).toLocaleString("en-US")}`;
}

export { YEAR_LABELS };
