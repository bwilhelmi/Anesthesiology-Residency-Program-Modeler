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
  incrementalSupervisionCostPerLocation,
  juniorityWeight,
  laborSubstitutionValue,
  loaded,
  offServiceValue,
  staffedLocationDemand,
} from "./clinical";
import { loadedResidentCost, residentSalaryCost } from "./program";
import {
  computeYear,
  residentsInProgramYear,
  runModel,
  steadyStateCoverageFte,
} from "./model";
import type { GmeFundingInputs, ModelInputs } from "./types";
import { RESIDENCY_YEARS } from "./types";

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
    const intern = coverageFteForYear(DEFAULT_INPUTS.clinical.PGY1);
    const ca3 = coverageFteForYear(DEFAULT_INPUTS.clinical.PGY4);
    expect(intern).toBeGreaterThan(0);
    expect(ca3).toBeGreaterThan(intern);
  });

  it("coverage FTE is pure staffing equivalence, with no throughput discount", () => {
    const p = DEFAULT_INPUTS.clinical.PGY2;
    expect(coverageFteForYear(p)).toBeCloseTo(
      p.fractionOnAnesthesia * p.anesthesiaCoverageFte,
      10
    );
  });

  it("labor substitution value scales with loaded CRNA cost", () => {
    const val = laborSubstitutionValue(
      DEFAULT_INPUTS.clinical.PGY4,
      DEFAULT_INPUTS.salaries
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

describe("Incremental attending supervision (P0.1)", () => {
  it("prices the extra attending time a 1:2 teaching room costs vs a 1:4 CRNA room", () => {
    // Attending loaded at $500,000 (400k base + 25% load), 1:2 vs 1:4.
    const perLocation = incrementalSupervisionCostPerLocation(
      { ...DEFAULT_INPUTS.salaries, anesthesiologistSalary: 400_000, benefitLoadRate: 0.25 },
      { maxResidentSupervisionRatio: 2, maxCrnaSupervisionRatio: 4 }
    );
    expect(10 * perLocation).toBeCloseTo(1_250_000, 6);
  });

  it("is zero when residents and CRNAs tie up the same attending time", () => {
    expect(
      incrementalSupervisionCostPerLocation(DEFAULT_INPUTS.salaries, {
        maxResidentSupervisionRatio: 4,
        maxCrnaSupervisionRatio: 4,
      })
    ).toBe(0);
  });

  it("appears as a cost line proportional to covered locations", () => {
    const cohort = residentsInProgramYear(DEFAULT_INPUTS, 4);
    const r = computeYear(DEFAULT_INPUTS, 4, cohort);
    const line = r.costs.find((c) => c.key === "supervision");
    const expected =
      steadyStateCoverageFte(DEFAULT_INPUTS) *
      incrementalSupervisionCostPerLocation(
        DEFAULT_INPUTS.salaries,
        DEFAULT_INPUTS.supervision
      );
    expect(line).toBeDefined();
    expect(line!.amount).toBeCloseTo(expected, 6);
    expect(line!.amount).toBeGreaterThan(0);
  });
});

describe("Throughput loss is charged once (P0.2)", () => {
  it("leaves the labor benefit undiscounted when the loss is zero", () => {
    const inputs: ModelInputs = {
      ...DEFAULT_INPUTS,
      // Keep coverage well under demand so the cap does not interfere.
      residentsPerClass: 4,
      efficiency: { ...DEFAULT_INPUTS.efficiency, caseThroughputLoss: 0 },
    };
    const cohort = residentsInProgramYear(inputs, 4);
    const r = computeYear(inputs, 4, cohort);
    const crnaLoaded = loaded(inputs.salaries.crnaSalary, inputs.salaries.benefitLoadRate);
    const expected = RESIDENCY_YEARS.reduce((s, y) => {
      const p = inputs.clinical[y];
      return s + cohort[y] * p.fractionOnAnesthesia * p.anesthesiaCoverageFte * crnaLoaded;
    }, 0);
    expect(r.benefits.find((b) => b.key === "labor")!.amount).toBeCloseTo(expected, 6);
    expect(r.costs.find((c) => c.key === "efficiency")!.amount).toBe(0);
  });

  it("charges the loss only through the margin line, weighted by juniority", () => {
    const inputs: ModelInputs = { ...DEFAULT_INPUTS, residentsPerClass: 4 };
    const cohort = residentsInProgramYear(inputs, 4);
    const r = computeYear(inputs, 4, cohort);
    const expected = RESIDENCY_YEARS.reduce((s, y) => {
      const p = inputs.clinical[y];
      return (
        s +
        cohort[y] *
          coverageFteForYear(p) *
          inputs.efficiency.annualMarginPerStaffedLocation *
          inputs.efficiency.caseThroughputLoss *
          juniorityWeight(y)
      );
    }, 0);
    expect(r.costs.find((c) => c.key === "efficiency")!.amount).toBeCloseTo(expected, 6);
  });
});

describe("Coverage cannot exceed staffed-location demand (P0.3)", () => {
  const oversized: ModelInputs = { ...DEFAULT_INPUTS, residentsPerClass: 20 };
  const doubled: ModelInputs = { ...DEFAULT_INPUTS, residentsPerClass: 40 };

  it("caps the labor benefit at demand while stipends keep scaling", () => {
    const a = computeYear(oversized, 4, residentsInProgramYear(oversized, 4));
    const b = computeYear(doubled, 4, residentsInProgramYear(doubled, 4));

    const laborA = a.benefits.find((x) => x.key === "labor")!.amount;
    const laborB = b.benefits.find((x) => x.key === "labor")!.amount;
    const stipendA = a.costs.find((x) => x.key === "residentsalary")!.amount;
    const stipendB = b.costs.find((x) => x.key === "residentsalary")!.amount;

    expect(laborB).toBeCloseTo(laborA, 6);
    expect(stipendB).toBeCloseTo(2 * stipendA, 6);

    // The capped labor value is exactly demand-worth of loaded CRNA coverage.
    const crnaLoaded = loaded(
      DEFAULT_INPUTS.salaries.crnaSalary,
      DEFAULT_INPUTS.salaries.benefitLoadRate
    );
    expect(laborA).toBeCloseTo(staffedLocationDemand(oversized) * crnaLoaded, 6);
  });

  it("caps supervision cost and throughput loss on the same factor", () => {
    const a = computeYear(oversized, 4, residentsInProgramYear(oversized, 4));
    const b = computeYear(doubled, 4, residentsInProgramYear(doubled, 4));
    for (const key of ["supervision", "efficiency"]) {
      expect(b.costs.find((x) => x.key === key)!.amount).toBeCloseTo(
        a.costs.find((x) => x.key === key)!.amount,
        6
      );
    }
  });

  it("warns that the excess residents add cost but no coverage value", () => {
    const r = runModel(oversized);
    expect(r.warnings.some((w) => /exceeds the .* staffed anesthetizing locations/.test(w)))
      .toBe(true);
    // Warnings are de-duplicated across years at the result level.
    expect(new Set(r.warnings).size).toBe(r.warnings.length);
  });

  it("stays silent when coverage fits inside demand", () => {
    expect(runModel(DEFAULT_INPUTS).warnings).toEqual([]);
  });
});

describe("Resident benefit load (P0.4)", () => {
  it("adds absolute benefit dollars rather than a percentage of the stipend", () => {
    expect(loadedResidentCost(DEFAULT_INPUTS.salaries)).toBe(68_000 + 28_000);
    expect(residentSalaryCost(DEFAULT_INPUTS.salaries, 24)).toBe(24 * 96_000);
  });

  it("does not move when the attending/CRNA fringe load changes", () => {
    const cheaper = { ...DEFAULT_INPUTS.salaries, benefitLoadRate: 0.1 };
    expect(loadedResidentCost(cheaper)).toBe(loadedResidentCost(DEFAULT_INPUTS.salaries));
  });
});

describe("Supervision-ratio warnings (P0.6)", () => {
  it("flags resident concurrency beyond the teaching rule", () => {
    const inputs: ModelInputs = {
      ...DEFAULT_INPUTS,
      supervision: { ...DEFAULT_INPUTS.supervision, maxResidentSupervisionRatio: 3 },
    };
    expect(runModel(inputs).warnings.some((w) => w.includes("42 CFR 415.178"))).toBe(true);
  });

  it("flags CRNA concurrency beyond the medical-direction limit", () => {
    const inputs: ModelInputs = {
      ...DEFAULT_INPUTS,
      supervision: { ...DEFAULT_INPUTS.supervision, maxCrnaSupervisionRatio: 6 },
    };
    expect(runModel(inputs).warnings.some((w) => w.includes("42 CFR 415.110"))).toBe(true);
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
