import { describe, it, expect } from "vitest";
import { DEFAULT_INPUTS, IME_EXPONENT, IME_MULTIPLIER } from "./constants";
import {
  directGme,
  fundableFte,
  imePercentage,
  marginalIme,
  medicaidGme,
} from "./gme";
import {
  coverageFteForYear,
  laborSubstitutionValue,
  loaded,
  offServiceValue,
} from "./clinical";
import {
  computeYear,
  residentsInProgramYear,
  runModel,
} from "./model";
import type { GmeFundingInputs, ModelInputs } from "./types";

const gme = (over: Partial<GmeFundingInputs> = {}): GmeFundingInputs => ({
  ...DEFAULT_INPUTS.gme,
  ...over,
});

describe("GME: cap logic", () => {
  it("funds all FTE when under cap with ample headroom", () => {
    expect(fundableFte(10, gme({ atMedicareCap: false, capHeadroomFte: 24 }))).toBe(10);
  });

  it("funds only headroom when request exceeds it", () => {
    expect(fundableFte(30, gme({ capHeadroomFte: 24 }))).toBe(24);
  });

  it("funds nothing when at cap with no headroom", () => {
    expect(fundableFte(10, gme({ atMedicareCap: true, capHeadroomFte: 0 }))).toBe(0);
  });

  it("funds nothing when at cap even if a stale headroom value remains", () => {
    // The 'at cap' flag is authoritative and ignores the headroom field.
    expect(fundableFte(10, gme({ atMedicareCap: true, capHeadroomFte: 24 }))).toBe(0);
  });
});

describe("GME: Direct GME", () => {
  it("computes PRA x FTE x Medicare share", () => {
    const g = gme({
      directGmePerResidentAmount: 100_000,
      medicareInpatientShare: 0.4,
      capHeadroomFte: 100,
    });
    // 100k * 10 FTE * 0.4 = 400k
    expect(directGme(10, g)).toBeCloseTo(400_000, 5);
  });

  it("is zero at cap with no headroom", () => {
    const g = gme({ atMedicareCap: true, capHeadroomFte: 0 });
    expect(directGme(10, g)).toBe(0);
  });
});

describe("GME: IME", () => {
  it("matches the CMS formula for a known ratio", () => {
    const beds = 200;
    const fte = 50;
    const r = fte / beds; // 0.25
    const expected = IME_MULTIPLIER * (Math.pow(1 + r, IME_EXPONENT) - 1);
    expect(imePercentage(fte, beds)).toBeCloseTo(expected, 10);
  });

  it("is zero with no beds", () => {
    expect(imePercentage(10, 0)).toBe(0);
  });

  it("marginal IME is positive and nonlinear (diminishing) in resident count", () => {
    const g = gme({
      existingResidentFte: 0,
      availableBeds: 300,
      medicareInpatientOperatingPayments: 50_000_000,
      capHeadroomFte: 1000,
    });
    const im10 = marginalIme(10, g);
    const im20 = marginalIme(20, g);
    expect(im10).toBeGreaterThan(0);
    expect(im20).toBeGreaterThan(im10);
    // Diminishing returns: doubling residents less than doubles IME.
    expect(im20).toBeLessThan(2 * im10);
  });

  it("respects the cap in the marginal calc", () => {
    const capped = gme({ atMedicareCap: true, capHeadroomFte: 0 });
    expect(marginalIme(10, capped)).toBe(0);
  });
});

describe("GME: Medicaid", () => {
  it("is a flat per-resident amount, not capped by Medicare", () => {
    const g = gme({ medicaidGmePerResident: 50_000 });
    expect(medicaidGme(24, g)).toBe(1_200_000);
  });
});

describe("Clinical value", () => {
  it("loaded cost applies benefit rate", () => {
    expect(loaded(100_000, 0.25)).toBe(125_000);
  });

  it("intern coverage FTE is small; CA-3 coverage is much larger", () => {
    const eff = DEFAULT_INPUTS.efficiency;
    const intern = coverageFteForYear("PGY1", DEFAULT_INPUTS.clinical.PGY1, eff);
    const ca3 = coverageFteForYear("PGY4", DEFAULT_INPUTS.clinical.PGY4, eff);
    expect(intern).toBeGreaterThan(0);
    expect(ca3).toBeGreaterThan(intern);
  });

  it("labor substitution value scales with loaded CRNA cost", () => {
    const val = laborSubstitutionValue(
      "PGY4",
      DEFAULT_INPUTS.clinical.PGY4,
      DEFAULT_INPUTS.salaries,
      DEFAULT_INPUTS.efficiency
    );
    expect(val).toBeGreaterThan(0);
    expect(val).toBeLessThan(
      loaded(DEFAULT_INPUTS.salaries.crnaSalary, DEFAULT_INPUTS.salaries.benefitLoadRate)
    );
  });

  it("intern delivers meaningful off-service value", () => {
    const v = offServiceValue(DEFAULT_INPUTS.clinical.PGY1);
    expect(v).toBeGreaterThan(0);
  });
});

describe("Program ramp", () => {
  it("adds one class per year up to four", () => {
    expect(residentsInProgramYear(DEFAULT_INPUTS, 1)).toMatchObject({
      PGY1: 6,
      PGY2: 0,
      PGY3: 0,
      PGY4: 0,
    });
    expect(residentsInProgramYear(DEFAULT_INPUTS, 4)).toMatchObject({
      PGY1: 6,
      PGY2: 6,
      PGY3: 6,
      PGY4: 6,
    });
  });

  it("does not exceed four classes", () => {
    expect(residentsInProgramYear(DEFAULT_INPUTS, 8)).toMatchObject({
      PGY1: 6,
      PGY2: 6,
      PGY3: 6,
      PGY4: 6,
    });
  });
});

describe("Full model", () => {
  it("produces four ramp years and a steady state", () => {
    const r = runModel(DEFAULT_INPUTS);
    expect(r.rampYears).toHaveLength(4);
    expect(r.steadyState.totalResidents).toBe(24);
  });

  it("benefits and costs both grow as classes accumulate", () => {
    const r = runModel(DEFAULT_INPUTS);
    const y1 = r.rampYears[0];
    const y4 = r.rampYears[3];
    expect(y4.totalCosts).toBeGreaterThan(y1.totalCosts);
    expect(y4.totalBenefits).toBeGreaterThan(y1.totalBenefits);
  });

  it("at-cap program loses Medicare GME benefits (lower net than under-cap)", () => {
    const underCap = runModel(DEFAULT_INPUTS);
    const atCap: ModelInputs = {
      ...DEFAULT_INPUTS,
      gme: { ...DEFAULT_INPUTS.gme, atMedicareCap: true, capHeadroomFte: 0 },
    };
    const capped = runModel(atCap);
    expect(capped.steadyState.totalBenefits).toBeLessThan(
      underCap.steadyState.totalBenefits
    );
  });

  it("steady-state line items sum to the reported totals", () => {
    const r = runModel(DEFAULT_INPUTS);
    const b = r.steadyState.benefits.reduce((s, x) => s + x.amount, 0);
    const c = r.steadyState.costs.reduce((s, x) => s + x.amount, 0);
    expect(r.steadyState.totalBenefits).toBeCloseTo(b, 5);
    expect(r.steadyState.totalCosts).toBeCloseTo(c, 5);
    expect(r.steadyState.netValue).toBeCloseTo(b - c, 5);
  });

  it("computeYear is deterministic for a fixed cohort", () => {
    const cohort = residentsInProgramYear(DEFAULT_INPUTS, 4);
    const a = computeYear(DEFAULT_INPUTS, 4, cohort);
    const b = computeYear(DEFAULT_INPUTS, 4, cohort);
    expect(a.netValue).toBe(b.netValue);
  });
});
