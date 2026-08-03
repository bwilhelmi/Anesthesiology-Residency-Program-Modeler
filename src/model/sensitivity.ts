/**
 * One-at-a-time sensitivity analysis: which assumption actually decides the
 * answer?
 *
 * A single NPV invites false precision. A tornado chart does the opposite — it
 * shows that two or three inputs dominate everything else, and that the rest of
 * the argument is noise. For a program built on a permanent, one-shot PRA
 * determination and a cap fixed for its lifetime, that is the honest way to
 * present the case.
 *
 * Every variable below knows how to patch ModelInputs immutably, and the bars
 * carry METRIC VALUES rather than deltas, so the UI can draw them around the
 * base case rather than around zero.
 */

import { runModel } from "./model";
import type { ModelInputs, ModelResult, ResidencyYear } from "./types";
import { RESIDENCY_YEARS } from "./types";

export interface TornadoBar {
  key: string;
  label: string;
  /** Metric value at the low end of this variable's swing. */
  low: number;
  /** Metric value at the high end. */
  high: number;
}

/** Default swing applied to variables that move proportionally: ±20%. */
export const DEFAULT_SWING = 0.2;

/** Absolute swing on the discount rate, in percentage points. */
export const DISCOUNT_RATE_SWING = 0.02;

type Patch = (inputs: ModelInputs) => ModelInputs;

interface Variable {
  key: string;
  label: string;
  low: Patch;
  high: Patch;
}

/** Scale every level's per-hour productivity by one multiplier. */
function scaleCoverage(inputs: ModelInputs, factor: number): ModelInputs {
  const clinical = {} as ModelInputs["clinical"];
  for (const year of RESIDENCY_YEARS as ResidencyYear[]) {
    clinical[year] = {
      ...inputs.clinical[year],
      anesthesiaProductivityPerHour:
        inputs.clinical[year].anesthesiaProductivityPerHour * factor,
    };
  }
  return { ...inputs, clinical };
}

const gmePatch = (p: Partial<ModelInputs["gme"]>): Patch => (i) => ({
  ...i,
  gme: { ...i.gme, ...p },
});

/**
 * The fixed variable list. It is deliberately fixed rather than derived: these
 * are the twelve numbers a hospital argues about, and a stable list keeps two
 * runs of the tool comparable.
 */
export function tornadoVariables(inputs: ModelInputs, swing: number): Variable[] {
  const lo = 1 - swing;
  const hi = 1 + swing;
  const isNewHospital = inputs.gme.scenario === "newTeachingHospital";
  const capKey = inputs.gme.scenario === "atCap" ? "awardedNewSlots" : "capHeadroomFte";

  return [
    {
      key: "pra",
      label: isNewHospital ? "Effective PRA (new-hospital determination)" : "Per-Resident Amount (PRA)",
      // For a new teaching hospital the effective PRA is the lesser of two
      // inputs, so both have to move together for the swing to bite.
      low: isNewHospital
        ? gmePatch({
            newHospitalProjectedCostPerFte: inputs.gme.newHospitalProjectedCostPerFte * lo,
            localityWeightedMeanPra: inputs.gme.localityWeightedMeanPra * lo,
          })
        : gmePatch({ directGmePerResidentAmount: inputs.gme.directGmePerResidentAmount * lo }),
      high: isNewHospital
        ? gmePatch({
            newHospitalProjectedCostPerFte: inputs.gme.newHospitalProjectedCostPerFte * hi,
            localityWeightedMeanPra: inputs.gme.localityWeightedMeanPra * hi,
          })
        : gmePatch({ directGmePerResidentAmount: inputs.gme.directGmePerResidentAmount * hi }),
    },
    {
      key: "cap",
      label:
        inputs.gme.scenario === "atCap" ? "Awarded new cap slots" : "Cap headroom (FTE)",
      low: gmePatch({ [capKey]: inputs.gme[capKey] * lo } as Partial<ModelInputs["gme"]>),
      high: gmePatch({ [capKey]: inputs.gme[capKey] * hi } as Partial<ModelInputs["gme"]>),
    },
    {
      key: "medicareshare",
      label: "Medicare share of inpatient days",
      low: gmePatch({ medicareInpatientShare: inputs.gme.medicareInpatientShare * lo }),
      high: gmePatch({ medicareInpatientShare: inputs.gme.medicareInpatientShare * hi }),
    },
    {
      key: "imebase",
      label: "Medicare operating payments (IME base)",
      low: gmePatch({
        medicareInpatientOperatingPayments:
          inputs.gme.medicareInpatientOperatingPayments * lo,
      }),
      high: gmePatch({
        medicareInpatientOperatingPayments:
          inputs.gme.medicareInpatientOperatingPayments * hi,
      }),
    },
    {
      key: "crna",
      label: "CRNA salary",
      low: (i) => ({ ...i, salaries: { ...i.salaries, crnaSalary: i.salaries.crnaSalary * lo } }),
      high: (i) => ({ ...i, salaries: { ...i.salaries, crnaSalary: i.salaries.crnaSalary * hi } }),
    },
    {
      key: "anesthesiologist",
      label: "Anesthesiologist salary",
      low: (i) => ({
        ...i,
        salaries: { ...i.salaries, anesthesiologistSalary: i.salaries.anesthesiologistSalary * lo },
      }),
      high: (i) => ({
        ...i,
        salaries: { ...i.salaries, anesthesiologistSalary: i.salaries.anesthesiologistSalary * hi },
      }),
    },
    {
      // Absolute, not relative: the plausible band is stated in constants.ts,
      // and this is the input the code itself tells the user to replace with
      // payroll data — so the bar should show what that replacement is worth.
      key: "crnaPremium",
      label: "CRNA premium pay load (OT/holiday/weekend)",
      low: (i) => ({
        ...i,
        salaries: { ...i.salaries, crnaPremiumPayLoad: 0.05 },
      }),
      high: (i) => ({
        ...i,
        salaries: { ...i.salaries, crnaPremiumPayLoad: 0.2 },
      }),
    },
    {
      // Also absolute. Note the inversion: FEWER worked hours per paid FTE means
      // more paid FTEs per delivered coverage-FTE, so the low input produces the
      // HIGH metric. That falls out of the patch functions — the sort must not
      // special-case it.
      key: "crnaWorkedHours",
      label: "CRNA worked hours per paid FTE",
      low: (i) => ({
        ...i,
        salaries: { ...i.salaries, crnaWorkedHoursPerPaidFte: 1_780 },
      }),
      high: (i) => ({
        ...i,
        salaries: { ...i.salaries, crnaWorkedHoursPerPaidFte: 1_940 },
      }),
    },
    {
      key: "coverage",
      label: "Resident productivity per duty hour (all levels)",
      low: (i) => scaleCoverage(i, lo),
      high: (i) => scaleCoverage(i, hi),
    },
    {
      key: "throughput",
      label: "Case throughput loss",
      low: (i) => ({
        ...i,
        efficiency: { ...i.efficiency, caseThroughputLoss: i.efficiency.caseThroughputLoss * lo },
      }),
      high: (i) => ({
        ...i,
        efficiency: { ...i.efficiency, caseThroughputLoss: i.efficiency.caseThroughputLoss * hi },
      }),
    },
    {
      key: "supervisionratio",
      // Not a percentage swing: the ratio is an integer with only two defensible
      // values — one room at a time, or the teaching-rule maximum of two.
      label: "Resident supervision ratio (1 vs 2 rooms)",
      low: (i) => ({
        ...i,
        supervision: { ...i.supervision, maxResidentSupervisionRatio: 1 },
      }),
      high: (i) => ({
        ...i,
        supervision: { ...i.supervision, maxResidentSupervisionRatio: 2 },
      }),
    },
    {
      key: "retention",
      label: "Graduate retention rate",
      low: (i) => ({ ...i, retention: { ...i.retention, retentionRate: i.retention.retentionRate * lo } }),
      high: (i) => ({ ...i, retention: { ...i.retention, retentionRate: i.retention.retentionRate * hi } }),
    },
    {
      key: "discount",
      // Absolute, not relative: a hurdle rate moves in points, not percentages.
      label: "Discount rate (±2 points)",
      low: (i) => ({
        ...i,
        projection: {
          ...i.projection,
          discountRate: Math.max(0, i.projection.discountRate - DISCOUNT_RATE_SWING),
        },
      }),
      high: (i) => ({
        ...i,
        projection: {
          ...i.projection,
          discountRate: i.projection.discountRate + DISCOUNT_RATE_SWING,
        },
      }),
    },
    {
      key: "classsize",
      label: "Residents per class (±1)",
      low: (i) => ({ ...i, residentsPerClass: Math.max(0, i.residentsPerClass - 1) }),
      high: (i) => ({ ...i, residentsPerClass: i.residentsPerClass + 1 }),
    },
  ];
}

/**
 * One-at-a-time sensitivity of `metric` to each variable, sorted by the width
 * of its swing — the widest bar is the assumption the decision actually rests on.
 */
export function tornado(
  inputs: ModelInputs,
  metric: (r: ModelResult) => number = (r) => r.summary.npv,
  swing: number = DEFAULT_SWING
): TornadoBar[] {
  return tornadoVariables(inputs, swing)
    .map((v) => ({
      key: v.key,
      label: v.label,
      low: metric(runModel(v.low(inputs))),
      high: metric(runModel(v.high(inputs))),
    }))
    .sort((a, b) => Math.abs(b.high - b.low) - Math.abs(a.high - a.low));
}
