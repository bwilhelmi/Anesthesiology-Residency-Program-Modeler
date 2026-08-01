/**
 * The regression net.
 *
 * Two kinds of guard live here. The first is a frozen snapshot of the default
 * program, so that any future change to a formula has to be an intentional
 * change to a published number. The second is a set of property tests — things
 * that must hold for ANY inputs, not just the defaults — because a model with
 * this many interacting rules can pass every worked example and still be wrong
 * in a direction nobody checked.
 */

import { describe, it, expect } from "vitest";
import { DEFAULT_INPUTS } from "./constants";
import { runModel } from "./model";
import { marginalIme } from "./gme";
import type { ModelInputs } from "./types";

const amount = (items: { key: string; amount: number }[], key: string): number =>
  items.find((i) => i.key === key)?.amount ?? 0;

/* --------------------------------------------------------------------------
 * Frozen defaults
 *
 * These numbers moved deliberately and substantially from v1. At the shipped
 * defaults (6 residents per class, 350 beds, new teaching hospital):
 *
 *   v1 steady-state net    +$3,203,756      v1 "5-year cumulative"  +$8,333,383
 *   v2 mature-year net       +$672,829      v2 NPV                  −$1,114,635
 *
 * Every part of that gap is a correction, not a recalibration:
 *
 *   - Incremental attending supervision (P0.1) is now charged at all: a
 *     resident room ties an attending to 1:2 under 42 CFR 415.178 where a
 *     medically directed CRNA room is 1:4. That is ~$1.44M a year the v1 model
 *     simply omitted while collecting the CRNA offset in full.
 *   - Teaching slowdown is charged once (P0.2) instead of twice, which raises
 *     the labor line and lowers the margin-loss line.
 *   - Resident benefits are real dollars, not 25% of a trainee stipend (P0.4),
 *     and per-resident liability, GME-office overhead, and fees are counted at
 *     all (P4.1).
 *   - Medicare FTE is sponsor-site FTE (P2.1) and cohorts shrink with attrition
 *     (P2.2), so DGME and IME fall below v1's headcount-based figures.
 *   - The startup cost now lands in two pre-revenue years, before any resident
 *     exists, and the whole frame is discounted (P3). That, not the annual
 *     economics, is why NPV is negative while the mature year is positive: at
 *     defaults the program earns ~$0.67M a year and never repays its build-out
 *     inside a ten-year horizon at a 6% hurdle rate.
 *
 * Update these numbers only alongside a deliberate model change, and say why in
 * the commit message.
 *
 * UPDATED ONCE SINCE: CRNA premium pay. Valuing resident coverage against a
 * CRNA BASE salary understated it, because the substitution is asymmetric — a
 * CRNA earns overtime when the room runs late and premium pay on holidays, and
 * a resident on a fixed stipend earns neither. Adding a 12% premium load to the
 * cost of the coverage residents displace (and to nothing else) moves the
 * default program from "never breaks even" to breakeven in year 9:
 *
 *   NPV            −$1,114,635  ->    +$849,528
 *   mature-year net   +$672,829  ->  +$1,052,724
 *
 * That one assumption is worth more than the entire Medicaid line at defaults,
 * which is why it is a visible, sourced input rather than a fattened salary.
 *
 * UPDATED AGAIN: the default medical-direction ratio moved from 1:4 to 1:3.
 * 1:4 is the regulatory ceiling (42 CFR 415.110), not an operating average —
 * the tertiary centers that sponsor anesthesiology residencies rarely sustain
 * it, because complex cases, campus-wide anesthetizing locations, and the
 * presence-for-induction-and-emergence requirement all cap effective
 * concurrency below the maximum. Since the CRNA room is the counterfactual a
 * resident room is charged against, crediting it with LESS attending time than
 * it really consumes overstated the incremental supervision cost:
 *
 *   supervision line  $1,438,999  ->    $959,333
 *   NPV                 +$849,528  ->  +$3,329,532
 *   breakeven             year 9   ->      year 7
 *
 * The ceiling still exists as MEDICAL_DIRECTION_CONCURRENCY_LIMIT, which is
 * what the "beyond medical direction" warning is measured against. Only the
 * default operating assumption moved.
 *
 * UPDATED AGAIN (ADD-B): worked-hours backfill. A CRNA base salary buys 2,080
 * PAID hours but only ~1,860 WORKED ones after vacation, CME, sick time, and
 * paid holidays, so delivering one coverage-FTE-year takes ~1.12 paid FTEs. The
 * resident side was already net of time off via fractionOnAnesthesia, so the
 * comparison had been asymmetric against the CRNA cost. The labor-substitution
 * line rises by the backfill factor 2080/1860 (+11.8%); nothing else moves at
 * defaults except the totals and NPV that follow from it:
 *
 *   labor line     $3,545,693  ->  $3,965,076   (+11.8%)
 *   NPV            +$3,329,532  ->  +$5,497,855
 *   breakeven          year 7   ->      year 6
 * ------------------------------------------------------------------------ */
describe("Frozen default program (P7.3)", () => {
  const r = runModel(DEFAULT_INPUTS);

  it("reports the frozen summary", () => {
    expect(r.summary.nominalCumulativeNet).toBeCloseTo(10_292_215.15, 1);
    expect(r.summary.npv).toBeCloseTo(5_497_855.49, 1);
    expect(r.summary.breakevenYear).toBe(6);
    expect(r.summary.steadyStateAnnualNet).toBeCloseTo(1_951_773.55, 1);
  });

  it("reports the frozen mature year", () => {
    expect(r.steadyState.programYear).toBe(6);
    expect(r.steadyState.totalResidents).toBeCloseTo(23.2896, 4);

    expect(amount(r.steadyState.benefits, "dgme")).toBeCloseTo(976_368, 0);
    expect(amount(r.steadyState.benefits, "ime")).toBeCloseTo(1_785_573, 0);
    expect(amount(r.steadyState.benefits, "labor")).toBeCloseTo(3_965_076, 0);
    expect(amount(r.steadyState.benefits, "offservice")).toBeCloseTo(257_035, 0);
    expect(amount(r.steadyState.benefits, "retention")).toBeCloseTo(785_592, 0);

    expect(amount(r.steadyState.costs, "residentsalary")).toBeCloseTo(2_591_901, 0);
    expect(amount(r.steadyState.costs, "support")).toBeCloseTo(1_368_860, 0);
    expect(amount(r.steadyState.costs, "perresident")).toBeCloseTo(715_473, 0);
    expect(amount(r.steadyState.costs, "efficiency")).toBeCloseTo(182_303, 0);
    expect(amount(r.steadyState.costs, "supervision")).toBeCloseTo(959_333, 0);
  });

  it("keeps line items summing to the reported totals in every year", () => {
    for (const y of r.years) {
      expect(y.totalBenefits).toBeCloseTo(
        y.benefits.reduce((s, b) => s + b.amount, 0),
        6
      );
      expect(y.totalCosts).toBeCloseTo(
        y.costs.reduce((s, c) => s + c.amount, 0),
        6
      );
      expect(y.netValue).toBeCloseTo(y.totalBenefits - y.totalCosts, 6);
    }
  });
});

/* ------------------------------- Properties ------------------------------- */

describe("Property: a program with no residents has no resident economics", () => {
  const empty: ModelInputs = { ...DEFAULT_INPUTS, residentsPerClass: 0 };
  const r = runModel(empty);

  it("zeroes every benefit", () => {
    for (const y of r.years) {
      for (const b of y.benefits) expect(b.amount).toBe(0);
      expect(y.totalBenefits).toBe(0);
    }
  });

  it("zeroes every resident-driven cost", () => {
    for (const y of r.years.filter((x) => x.programYear >= 1)) {
      for (const key of [
        "residentsalary",
        "perresident",
        "efficiency",
        "supervision",
      ]) {
        expect(amount(y.costs, key)).toBe(0);
      }
    }
  });

  it("leaves only leadership, coordination, overhead, and startup", () => {
    const programYear = r.years.find((y) => y.programYear === 1)!;
    expect(programYear.costs.filter((c) => c.amount !== 0).map((c) => c.key)).toEqual([
      "support",
    ]);
    const preLaunch = r.years.find((y) => y.programYear === 0)!;
    expect(new Set(preLaunch.costs.map((c) => c.key))).toEqual(
      new Set(["startup", "support"])
    );
  });
});

describe("Property: NPV is non-increasing in the discount rate", () => {
  const npvAt = (program: ModelInputs, discountRate: number) =>
    runModel({ ...program, projection: { ...program.projection, discountRate } })
      .summary.npv;

  it("holds for a conventional program: spend first, earn later", () => {
    const programs: ModelInputs[] = [
      DEFAULT_INPUTS,
      { ...DEFAULT_INPUTS, residentsPerClass: 12 },
    ];
    for (const program of programs) {
      // Guard the precondition rather than assuming it: the property below is a
      // fact about this cash-flow shape, not about NPV in general.
      const years = runModel(program).years;
      expect(years[0].netValue).toBeLessThan(0);
      expect(years[years.length - 1].netValue).toBeGreaterThan(0);

      let previous = Infinity;
      for (let rate = 0; rate <= 0.2; rate += 0.01) {
        const npv = npvAt(program, rate);
        expect(npv).toBeLessThanOrEqual(previous + 1e-6);
        previous = npv;
      }
    }
  });

  it("inverts for a program that never turns a profit — as it should", () => {
    // A hospital with 8 FTE of headroom training 24 residents loses money in
    // every single year. Discounting a stream of pure losses makes NPV LESS
    // negative, so a higher hurdle rate flatters it. That is arithmetic, not a
    // bug, and it is exactly why NPV alone is a poor way to read this model —
    // the breakeven year and the year table say what NPV cannot.
    const alwaysLosing: ModelInputs = {
      ...DEFAULT_INPUTS,
      gme: { ...DEFAULT_INPUTS.gme, scenario: "existingUnderCap", capHeadroomFte: 8 },
      retention: { ...DEFAULT_INPUTS.retention, enabled: false },
    };
    const years = runModel(alwaysLosing).years;
    expect(years.every((y) => y.netValue < 0)).toBe(true);
    expect(npvAt(alwaysLosing, 0.12)).toBeGreaterThan(npvAt(alwaysLosing, 0.02));
    expect(runModel(alwaysLosing).summary.breakevenYear).toBeNull();
  });
});

describe("Property: at cap with no awarded slots, Medicare pays nothing", () => {
  const atCap: ModelInputs = {
    ...DEFAULT_INPUTS,
    gme: {
      ...DEFAULT_INPUTS.gme,
      scenario: "atCap",
      awardedNewSlots: 0,
      medicareCapitalPayments: 10_000_000,
      medicaid: {
        ...DEFAULT_INPUTS.gme.medicaid,
        mode: "perResident",
        perResidentAmount: 40_000,
      },
    },
  };

  it("zeroes DGME, IME, and capital IME", () => {
    for (const y of runModel(atCap).years.filter((x) => x.programYear >= 1)) {
      expect(amount(y.benefits, "dgme")).toBe(0);
      expect(amount(y.benefits, "ime")).toBe(0);
      expect(amount(y.benefits, "capitalime")).toBe(0);
    }
  });

  it("leaves Medicaid and clinical labor untouched", () => {
    const capped = runModel(atCap).steadyState;
    const funded = runModel({ ...atCap, gme: { ...atCap.gme, awardedNewSlots: 24 } })
      .steadyState;
    expect(amount(capped.benefits, "medicaid")).toBeGreaterThan(0);
    expect(amount(capped.benefits, "medicaid")).toBeCloseTo(
      amount(funded.benefits, "medicaid"),
      6
    );
    expect(amount(capped.benefits, "labor")).toBeCloseTo(
      amount(funded.benefits, "labor"),
      6
    );
  });
});

describe("Property: IME dilutes as the hospital gets bigger", () => {
  it("strictly decreases when beds double at a fixed FTE", () => {
    const ctx = { programYear: 6, priorRatio: null };
    for (const beds of [100, 200, 350, 700]) {
      const small = marginalIme(24, { ...DEFAULT_INPUTS.gme, availableBeds: beds }, ctx);
      const large = marginalIme(
        24,
        { ...DEFAULT_INPUTS.gme, availableBeds: beds * 2 },
        ctx
      );
      expect(small).toBeGreaterThan(0);
      expect(large).toBeLessThan(small);
    }
  });

  it("shows the same dilution end to end through the model", () => {
    const ime = (availableBeds: number) =>
      amount(
        runModel({ ...DEFAULT_INPUTS, gme: { ...DEFAULT_INPUTS.gme, availableBeds } })
          .steadyState.benefits,
        "ime"
      );
    expect(ime(700)).toBeLessThan(ime(350));
  });
});
