/**
 * Medicare / Medicaid graduate-medical-education (GME) funding calculations.
 *
 * Two Medicare streams matter for a new residency program:
 *
 *   1. Direct GME (DGME) — reimburses direct training costs (resident stipends,
 *      supervising-physician time, overhead). Paid as:
 *          DGME = PRA x weightedResidentFTE x MedicareInpatientShare
 *      where PRA is the hospital's Per-Resident Amount.
 *
 *   2. Indirect Medical Education (IME) — an add-on percentage applied to
 *      Medicare inpatient PPS operating payments to reflect the higher costs of
 *      teaching hospitals:
 *          IME% = c x [ (1 + r)^0.405 - 1 ],  c = 1.35
 *      where r = residentFTE / availableBeds. IME is NONLINEAR in r, so the
 *      marginal value of new residents is computed as the difference between
 *      IME dollars with and without the new residents. A parallel, smaller
 *      add-on applies to capital PPS payments (42 CFR 412.322).
 *
 * None of this is a single-year calculation. Three time-dependent rules decide
 * what a program is actually paid, and they are the difference between a
 * plausible pro forma and a fantasy:
 *
 *   - The FTE CAP. A hospital that has never trained residents has no cap; it
 *     BUILDS one from its own complement in program year 5 and is bound by it
 *     from year 6 (42 CFR 413.79(e)(1)). An established hospital inherits a cap
 *     fixed decades ago and can only grow through awarded slots.
 *   - The THREE-YEAR ROLLING AVERAGE of FTE counts (42 CFR 413.79(d)), which
 *     excludes residents in a new program during its growth window
 *     (42 CFR 413.79(d)(5)) — otherwise a ramping program would be paid on a
 *     trailing average that never catches up.
 *   - The IME RESIDENT-TO-BED RATIO CAP (42 CFR 412.105(a)(1)): this year's
 *     ratio may not exceed last year's, again excepting a new program's growth
 *     window (42 CFR 412.105(f)(1)(v)).
 *
 * gmeFundingTimeline() applies all three across a program's whole life; the
 * per-year helpers below are exported for testing and single-year use.
 *
 * Medicaid GME is state-specific: some states pay per resident, some direct a
 * fixed appropriation to a hospital regardless of resident count.
 */

import {
  CAPITAL_IME_EXPONENT,
  CAP_BUILDING_WINDOW_YEARS,
  DGME_FTE_WEIGHT,
  IME_EXPONENT,
  IME_MULTIPLIER,
  PROGRAM_LENGTH_YEARS,
  ROLLING_AVERAGE_YEARS,
} from "./constants";
import type { GmeFundingInputs, MedicaidGmeInputs, ResidencyYear } from "./types";
import { RESIDENCY_YEARS } from "./types";

/* ----------------------------- Per-resident amount ------------------------ */

/**
 * The PRA actually used for DGME.
 *
 * For a new teaching hospital the PRA is the LESSER of the hospital's own
 * projected allowable cost per FTE and the locality-adjusted weighted mean PRA
 * of nearby teaching hospitals — 42 CFR 413.77(e).
 *
 * Two things about this number deserve a board's attention:
 *  (a) it is a ONE-SHOT, PERMANENT determination made from the program's early
 *      cost-report years and then merely trended forward, which makes it the
 *      highest-leverage figure in this entire model; and
 *  (b) hospitals saddled with a very low or zero historical PRA, or a
 *      de-minimis cap, may qualify to have it reset under CAA 2021 §131 — worth
 *      checking before accepting an inherited number as fixed.
 */
export function effectivePra(gme: GmeFundingInputs): number {
  if (gme.scenario === "newTeachingHospital") {
    return clampNonNeg(
      Math.min(gme.newHospitalProjectedCostPerFte, gme.localityWeightedMeanPra)
    );
  }
  return clampNonNeg(gme.directGmePerResidentAmount);
}

/* --------------------------------- The cap -------------------------------- */

/** True while a program is inside its new-program growth window (years 1–5). */
export function inGrowthWindow(programYear: number): boolean {
  return programYear <= CAP_BUILDING_WINDOW_YEARS;
}

/**
 * The permanent FTE cap a new teaching hospital builds: the highest number of
 * Medicare-countable FTE residents in any single program year, measured in
 * program year 5, multiplied by the program's accredited length.
 * 42 CFR 413.79(e)(1).
 *
 * With even class sizes and no attrition this is simply residentsPerClass × 4,
 * but it is computed generally so attrition and site allocation flow through.
 */
export function buildPermanentCap(byLevelInYear5: Record<ResidencyYear, number>): number {
  const highestSingleProgramYear = Math.max(
    0,
    ...RESIDENCY_YEARS.map((level) => byLevelInYear5[level] ?? 0)
  );
  return highestSingleProgramYear * PROGRAM_LENGTH_YEARS;
}

/**
 * The cap binding in a given program year, or null when none applies yet.
 * `permanentCap` is the figure from buildPermanentCap(), if the program has
 * reached year 5.
 */
export function capForYear(
  gme: GmeFundingInputs,
  programYear: number,
  permanentCap: number | null
): number | null {
  switch (gme.scenario) {
    case "newTeachingHospital":
      // No cap exists until the cap-building window closes.
      return inGrowthWindow(programYear) ? null : permanentCap;
    case "existingUnderCap":
      // Awarded slots enlarge the room available to the new program.
      return clampNonNeg(gme.capHeadroomFte) + clampNonNeg(gme.awardedNewSlots);
    case "atCap":
      // The cap is fully used, so awarded slots are the only funded FTE.
      return clampNonNeg(gme.awardedNewSlots);
  }
}

/**
 * Medicare-countable FTE that actually falls under the applicable cap and is
 * therefore eligible to generate DGME/IME.
 */
export function fundableFte(
  countableFte: number,
  gme: GmeFundingInputs,
  ctx: { programYear: number; permanentCap?: number | null }
): number {
  const cap = capForYear(gme, ctx.programYear, ctx.permanentCap ?? null);
  const fte = clampNonNeg(countableFte);
  return cap === null ? fte : Math.min(fte, clampNonNeg(cap));
}

/* ------------------------------- Direct GME ------------------------------- */

/** Annual Direct GME revenue for a given payment FTE count. */
export function directGme(paymentFte: number, gme: GmeFundingInputs): number {
  return (
    effectivePra(gme) *
    DGME_FTE_WEIGHT *
    clampNonNeg(paymentFte) *
    clamp01(gme.medicareInpatientShare)
  );
}

/* ----------------------------------- IME ---------------------------------- */

/** The IME operating add-on percentage for a resident-to-bed ratio. */
export function imePercentageForRatio(ratio: number): number {
  return IME_MULTIPLIER * (Math.pow(1 + clampNonNeg(ratio), IME_EXPONENT) - 1);
}

/** The IME operating add-on percentage for a given FTE count and bed count. */
export function imePercentage(residentFte: number, availableBeds: number): number {
  if (availableBeds <= 0) return 0;
  return imePercentageForRatio(residentFte / availableBeds);
}

/** The capital IME add-on percentage for a resident-to-bed ratio (42 CFR 412.322). */
export function capitalImePercentageForRatio(ratio: number): number {
  return Math.exp(CAPITAL_IME_EXPONENT * clampNonNeg(ratio)) - 1;
}

/**
 * The resident-to-bed ratio actually usable in a program year.
 *
 * 42 CFR 412.105(a)(1) caps the ratio at the prior cost-reporting year's, so a
 * hospital cannot spike IME by adding residents late in a year. New programs
 * are excepted during their growth window (42 CFR 412.105(f)(1)(v)), which is
 * what lets a ramping program's ratio climb year over year.
 */
export function effectiveImeRatio(
  actualRatio: number,
  gme: GmeFundingInputs,
  ctx: { programYear: number; priorRatio: number | null }
): number {
  if (!gme.applyImeRatioCap) return actualRatio;
  if (inGrowthWindow(ctx.programYear)) return actualRatio;
  if (ctx.priorRatio == null) return actualRatio;
  return Math.min(actualRatio, ctx.priorRatio);
}

/**
 * Marginal annual IME operating revenue attributable to the new residents,
 * computed as IME(existing + new) − IME(existing) because IME is nonlinear in
 * the resident-to-bed ratio.
 */
export function marginalIme(
  countableNewFte: number,
  gme: GmeFundingInputs,
  ctx: { programYear: number; priorRatio: number | null }
): number {
  const { baseRatio, withRatio } = imeRatios(countableNewFte, gme, ctx);
  return (
    gme.medicareInpatientOperatingPayments *
    (imePercentageForRatio(withRatio) - imePercentageForRatio(baseRatio))
  );
}

/**
 * Marginal annual CAPITAL IME revenue (42 CFR 412.322), same countable-FTE and
 * ratio-cap treatment as the operating add-on. Zero unless the hospital's
 * capital PPS payments are supplied.
 */
export function marginalCapitalIme(
  countableNewFte: number,
  gme: GmeFundingInputs,
  ctx: { programYear: number; priorRatio: number | null }
): number {
  if (gme.medicareCapitalPayments <= 0) return 0;
  const { baseRatio, withRatio } = imeRatios(countableNewFte, gme, ctx);
  return (
    gme.medicareCapitalPayments *
    (capitalImePercentageForRatio(withRatio) - capitalImePercentageForRatio(baseRatio))
  );
}

/** The before/after resident-to-bed ratios used by both IME add-ons. */
function imeRatios(
  countableNewFte: number,
  gme: GmeFundingInputs,
  ctx: { programYear: number; priorRatio: number | null }
): { baseRatio: number; withRatio: number } {
  if (gme.availableBeds <= 0) return { baseRatio: 0, withRatio: 0 };
  const baseRatio = clampNonNeg(gme.existingResidentFte) / gme.availableBeds;
  const actualRatio =
    (clampNonNeg(gme.existingResidentFte) + clampNonNeg(countableNewFte)) /
    gme.availableBeds;
  const withRatio = Math.max(
    baseRatio,
    effectiveImeRatio(actualRatio, gme, ctx)
  );
  return { baseRatio, withRatio };
}

/* -------------------------------- Medicaid -------------------------------- */

/**
 * State Medicaid GME support. Not subject to the Medicare cap in either mode.
 *
 * `perResident` states pay per resident FTE. `appropriation` states direct a
 * fixed pool to a hospital regardless of how many residents it trains, so the
 * figure must NOT scale with program size.
 */
export function medicaidGme(totalFte: number, medicaid: MedicaidGmeInputs): number {
  switch (medicaid.mode) {
    case "none":
      return 0;
    case "perResident":
      return clampNonNeg(medicaid.perResidentAmount) * clampNonNeg(totalFte);
    case "appropriation":
      return clampNonNeg(medicaid.annualAppropriationTotal);
  }
}

/* ---------------------------- The funding timeline ------------------------ */

/** Medicare-countable FTE for one program year, by training level and stream. */
export interface GmeYearFte {
  programYear: number;
  /** Countable DGME FTE by training level — used to build a new hospital's cap. */
  byLevel: Record<ResidencyYear, number>;
  /** Total Medicare-countable DGME FTE this year. */
  dgmeFte: number;
  /** Total Medicare-countable IME FTE this year (patient-care activities only). */
  imeFte: number;
}

/** What Medicare actually pays for one program year, and why. */
export interface GmeYearFunding {
  programYear: number;
  /** The cap binding this year, or null when none applies yet. */
  cap: number | null;
  fundableDgmeFte: number;
  fundableImeFte: number;
  /** Fundable FTE after the three-year rolling average, if it applies. */
  paymentDgmeFte: number;
  paymentImeFte: number;
  /** The resident-to-bed ratio actually used, after any ratio cap. */
  imeRatio: number;
  dgme: number;
  ime: number;
  capitalIme: number;
  warnings: string[];
}

/**
 * Run the cap, rolling-average, and ratio-cap machinery across a program's
 * life. `years` must be in ascending program-year order and contiguous.
 */
export function gmeFundingTimeline(
  gme: GmeFundingInputs,
  years: GmeYearFte[]
): GmeYearFunding[] {
  // A new teaching hospital's permanent cap is fixed by its year-5 complement.
  const year5 = years.find((y) => y.programYear === CAP_BUILDING_WINDOW_YEARS);
  const permanentCap =
    gme.scenario === "newTeachingHospital" && year5 ? buildPermanentCap(year5.byLevel) : null;

  const fundableDgmeHistory: number[] = [];
  const fundableImeHistory: number[] = [];
  const out: GmeYearFunding[] = [];
  let priorRatio: number | null = null;

  for (const y of years) {
    const warnings: string[] = [];
    const cap = capForYear(gme, y.programYear, permanentCap);

    const fundableDgmeFte = fundableFte(y.dgmeFte, gme, {
      programYear: y.programYear,
      permanentCap,
    });
    const fundableImeFte = fundableFte(y.imeFte, gme, {
      programYear: y.programYear,
      permanentCap,
    });
    fundableDgmeHistory.push(fundableDgmeFte);
    fundableImeHistory.push(fundableImeFte);

    // 42 CFR 413.79(d): payment counts on a three-year rolling average, except
    // that FTEs in a new program are excluded during the growth window — which
    // is why a ramping program is paid on its actual count in years 1–5.
    const useAverage = gme.applyRollingAverage && !inGrowthWindow(y.programYear);
    const paymentDgmeFte = useAverage
      ? rollingAverage(fundableDgmeHistory)
      : fundableDgmeFte;
    const paymentImeFte = useAverage ? rollingAverage(fundableImeHistory) : fundableImeFte;

    const ratioCtx = { programYear: y.programYear, priorRatio };
    const actualRatio =
      gme.availableBeds > 0
        ? (clampNonNeg(gme.existingResidentFte) + paymentImeFte) / gme.availableBeds
        : 0;
    const imeRatio = effectiveImeRatio(actualRatio, gme, ratioCtx);

    if (gme.scenario === "existingUnderCap" && cap !== null && y.dgmeFte > cap) {
      warnings.push(
        `Medicare-countable FTE in program year ${y.programYear} ` +
          `(${y.dgmeFte.toFixed(1)}) exceeds the hospital's cap headroom ` +
          `(${cap.toFixed(1)} FTE, including any awarded slots). The excess trains at ` +
          `full cost with no DGME or IME behind it.`
      );
    }
    if (gme.scenario === "atCap" && clampNonNeg(gme.awardedNewSlots) === 0 && y.dgmeFte > 0) {
      warnings.push(
        "The hospital is at its Medicare FTE cap with no awarded slots, so this program " +
          "generates no DGME or IME at all. Its case rests on clinical labor value, " +
          "Medicaid support, retention, and mission — check CAA 2021 §126 / CAA 2023 " +
          "§4122 slot eligibility before assuming that."
      );
    }

    out.push({
      programYear: y.programYear,
      cap,
      fundableDgmeFte,
      fundableImeFte,
      paymentDgmeFte,
      paymentImeFte,
      imeRatio,
      dgme: directGme(paymentDgmeFte, gme),
      ime: marginalIme(paymentImeFte, gme, ratioCtx),
      capitalIme: marginalCapitalIme(paymentImeFte, gme, ratioCtx),
      warnings,
    });

    priorRatio = actualRatio;
  }

  return out;
}

/**
 * Average of the last ROLLING_AVERAGE_YEARS entries (or fewer, early in the
 * series) — 42 CFR 413.79(d)(1).
 */
function rollingAverage(history: number[]): number {
  const window = history.slice(-ROLLING_AVERAGE_YEARS);
  return window.reduce((a, b) => a + b, 0) / window.length;
}

function clamp01(x: number): number {
  return Math.max(0, Math.min(1, x));
}

function clampNonNeg(x: number): number {
  return Math.max(0, x);
}
