import { describe, it, expect } from "vitest";
import {
  CAP_BUILDING_WINDOW_YEARS,
  DEFAULT_INPUTS,
  IME_EXPONENT,
  IME_MULTIPLIER,
  MATURE_PROGRAM_YEAR,
} from "./constants";
import {
  buildPermanentCap,
  capForYear,
  directGme,
  effectivePra,
  fundableFte,
  gmeFundingTimeline,
  imePercentage,
  marginalCapitalIme,
  marginalIme,
  medicaidGme,
  type GmeYearFte,
} from "./gme";
import {
  coverageFteForYear,
  crnaCostOfCoverage,
  residentAnnualDutyHours,
  sponsorAnesthesiaHours,
  incrementalSupervisionCostPerLocation,
  juniorityWeight,
  laborSubstitutionValue,
  loaded,
  offServiceValue,
  staffedLocationDemand,
} from "./clinical";
import {
  loadedResidentCost,
  perResidentProgramCost,
  residentSalaryCost,
} from "./program";
import { FIRST_GRADUATION_BENEFIT_YEAR } from "./workforce";
import {
  computeYear,
  countableFteForYear,
  escalationFactors,
  residentsInProgramYear,
  runModel,
  steadyStateCoverageFte,
  summarize,
} from "./model";
import type {
  GmeFundingInputs,
  ModelInputs,
  ResidencyYear,
  YearResult,
} from "./types";
import { RESIDENCY_YEARS } from "./types";

/** A bare YearResult carrying only a net value — enough to test the summary. */
const toyYear = (programYear: number, netValue: number): YearResult => ({
  programYear,
  residentsByYear: { PGY1: 0, PGY2: 0, PGY3: 0, PGY4: 0 },
  totalResidents: 0,
  benefits: [],
  costs: [],
  totalBenefits: Math.max(0, netValue),
  totalCosts: Math.max(0, -netValue),
  netValue,
  warnings: [],
});

/** Total of one line-item key across a set of years. */
const sumAmounts = (years: YearResult[], key: string): number =>
  years.reduce(
    (s, y) =>
      s + [...y.benefits, ...y.costs].filter((x) => x.key === key).reduce((a, b) => a + b.amount, 0),
    0
  );

const gme = (over: Partial<GmeFundingInputs> = {}): GmeFundingInputs => ({
  ...DEFAULT_INPUTS.gme,
  ...over,
});

/** A mature-year context: past the growth window, no prior-year ratio recorded. */
const matureCtx = { programYear: MATURE_PROGRAM_YEAR, priorRatio: null };

/** Countable FTE for a program year with `perClass` residents in `classes` levels. */
const fteYear = (programYear: number, perClass: number, classes: number): GmeYearFte => {
  const byLevel = { PGY1: 0, PGY2: 0, PGY3: 0, PGY4: 0 } as Record<ResidencyYear, number>;
  for (let i = 0; i < Math.min(classes, RESIDENCY_YEARS.length); i++) {
    byLevel[RESIDENCY_YEARS[i]] = perClass;
  }
  const total = RESIDENCY_YEARS.reduce((s, y) => s + byLevel[y], 0);
  return { programYear, byLevel, dgmeFte: total, imeFte: total };
};

/** Program years 1..n for an evenly-sized program with no attrition. */
const rampFte = (n: number, perClass: number): GmeYearFte[] =>
  Array.from({ length: n }, (_, i) => fteYear(i + 1, perClass, i + 1));

describe("GME: cap logic (P1.2)", () => {
  it("applies no cap to a new teaching hospital inside its cap-building window", () => {
    const g = gme({ scenario: "newTeachingHospital" });
    expect(capForYear(g, 1, null)).toBeNull();
    expect(capForYear(g, CAP_BUILDING_WINDOW_YEARS, 24)).toBeNull();
    expect(fundableFte(18, g, { programYear: 3 })).toBe(18);
  });

  it("builds the permanent cap from the highest single program year × program length", () => {
    // 6 per class, all four levels present in program year 5.
    expect(buildPermanentCap(fteYear(5, 6, 4).byLevel)).toBe(24);
    // Uneven classes: the LARGEST single training year sets the cap.
    expect(buildPermanentCap({ PGY1: 8, PGY2: 6, PGY3: 6, PGY4: 6 })).toBe(32);
  });

  it("binds the built cap from program year 6 onward", () => {
    const g = gme({ scenario: "newTeachingHospital" });
    expect(capForYear(g, MATURE_PROGRAM_YEAR, 24)).toBe(24);
    expect(fundableFte(30, g, { programYear: MATURE_PROGRAM_YEAR, permanentCap: 24 })).toBe(24);
  });

  it("funds only headroom plus awarded slots at an existing under-cap hospital", () => {
    const g = gme({ scenario: "existingUnderCap", capHeadroomFte: 10, awardedNewSlots: 0 });
    expect(fundableFte(24, g, { programYear: 1 })).toBe(10);
    expect(fundableFte(6, g, { programYear: 1 })).toBe(6);
    const withSlots = gme({
      scenario: "existingUnderCap",
      capHeadroomFte: 10,
      awardedNewSlots: 5,
    });
    expect(fundableFte(24, withSlots, { programYear: 1 })).toBe(15);
  });

  it("funds only awarded slots at cap (P1.7)", () => {
    const g = gme({ scenario: "atCap", capHeadroomFte: 24, awardedNewSlots: 5 });
    // A stale headroom value is ignored: at cap, awarded slots are the only source.
    expect(fundableFte(24, g, { programYear: 1 })).toBe(5);
    expect(fundableFte(24, gme({ scenario: "atCap", awardedNewSlots: 0 }), { programYear: 1 }))
      .toBe(0);
  });
});

describe("GME: per-resident amount (P1.6)", () => {
  it("uses the lesser of projected cost and locality mean PRA for a new hospital", () => {
    const g = gme({
      scenario: "newTeachingHospital",
      newHospitalProjectedCostPerFte: 120_000,
      localityWeightedMeanPra: 105_000,
      directGmePerResidentAmount: 999_999,
    });
    expect(effectivePra(g)).toBe(105_000);
    expect(directGme(10, { ...g, medicareInpatientShare: 0.4 })).toBeCloseTo(420_000, 5);
  });

  it("uses the hospital's own PRA in the established scenarios", () => {
    const g = gme({ scenario: "existingUnderCap", directGmePerResidentAmount: 110_000 });
    expect(effectivePra(g)).toBe(110_000);
  });
});

describe("GME: Direct GME", () => {
  it("computes PRA x FTE x Medicare share", () => {
    const g = gme({
      scenario: "existingUnderCap",
      directGmePerResidentAmount: 100_000,
      medicareInpatientShare: 0.4,
    });
    // 100k * 10 FTE * 0.4 = 400k
    expect(directGme(10, g)).toBeCloseTo(400_000, 5);
  });

  it("is zero on zero payment FTE", () => {
    expect(directGme(0, gme())).toBe(0);
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
    });
    const im10 = marginalIme(10, g, matureCtx);
    const im20 = marginalIme(20, g, matureCtx);
    expect(im10).toBeGreaterThan(0);
    expect(im20).toBeGreaterThan(im10);
    // Diminishing returns: doubling residents less than doubles IME.
    expect(im20).toBeLessThan(2 * im10);
  });

  it("is zero on zero funded FTE", () => {
    expect(marginalIme(0, gme(), matureCtx)).toBe(0);
  });

  it("clips the ratio to the prior year outside the growth window (P1.4)", () => {
    const g = gme({ availableBeds: 350, existingResidentFte: 0 });
    const priorRatio = 12 / 350;
    const clipped = marginalIme(24, g, {
      programYear: MATURE_PROGRAM_YEAR,
      priorRatio,
    });
    expect(clipped).toBeCloseTo(marginalIme(12, g, matureCtx), 6);
    // Inside the growth window the same jump is not clipped.
    expect(marginalIme(24, g, { programYear: 3, priorRatio })).toBeGreaterThan(clipped);
    // And the cap can be switched off entirely.
    expect(
      marginalIme(24, { ...g, applyImeRatioCap: false }, {
        programYear: MATURE_PROGRAM_YEAR,
        priorRatio,
      })
    ).toBeGreaterThan(clipped);
  });

  it("prices capital IME on the exponential form when capital payments exist (P1.5)", () => {
    const g = gme({ availableBeds: 350, existingResidentFte: 0, medicareCapitalPayments: 8_000_000 });
    const r = 24 / 350;
    const expected = 8_000_000 * (Math.exp(0.2822 * r) - 1);
    expect(marginalCapitalIme(24, g, matureCtx)).toBeCloseTo(expected, 6);
  });

  it("leaves capital IME off by default", () => {
    expect(marginalCapitalIme(24, gme(), matureCtx)).toBe(0);
    expect(DEFAULT_INPUTS.gme.medicareCapitalPayments).toBe(0);
  });
});

describe("GME: funding timeline (P1.3, P1.8)", () => {
  it("pays a new hospital on actual FTE through the ramp, then caps at 24", () => {
    const g = gme({ scenario: "newTeachingHospital" });
    const timeline = gmeFundingTimeline(g, rampFte(MATURE_PROGRAM_YEAR, 6));
    expect(timeline.map((t) => t.fundableDgmeFte)).toEqual([6, 12, 18, 24, 24, 24]);
    expect(timeline[MATURE_PROGRAM_YEAR - 1].cap).toBe(24);
    expect(timeline.slice(0, CAP_BUILDING_WINDOW_YEARS).every((t) => t.cap === null)).toBe(true);
  });

  it("excludes the growth window from the rolling average, then averages (P1.3)", () => {
    const timeline = gmeFundingTimeline(
      gme({ scenario: "newTeachingHospital" }),
      rampFte(MATURE_PROGRAM_YEAR, 6)
    );
    // Years 1-5 pay on the actual count: a ramping program is not dragged down
    // by a trailing average it never catches up to.
    expect(timeline.slice(0, 5).map((t) => t.paymentDgmeFte)).toEqual([6, 12, 18, 24, 24]);
    // Year 6 averages years 4-6, which have all stabilised at 24.
    expect(timeline[5].paymentDgmeFte).toBeCloseTo(24, 10);
  });

  it("makes the rolling average trail when headcount is still changing", () => {
    const years = [...rampFte(MATURE_PROGRAM_YEAR, 6)];
    // A larger class arrives in year 6: 6,12,18,24,24, then 30.
    years[5] = { ...years[5], dgmeFte: 30, imeFte: 30 };
    const timeline = gmeFundingTimeline(
      gme({ scenario: "newTeachingHospital" }),
      years
    );
    // Capped at 24 first, so the average of 24,24,24 is still 24 — the cap binds
    // before the average does.
    expect(timeline[5].paymentDgmeFte).toBeCloseTo(24, 10);

    const uncapped = gmeFundingTimeline(
      gme({ scenario: "existingUnderCap", capHeadroomFte: 100 }),
      years
    );
    // 24, 24, 30 -> 26, a two-year trail behind the actual 30.
    expect(uncapped[5].paymentDgmeFte).toBeCloseTo(26, 10);
  });

  it("warns and funds only the headroom at an existing under-cap hospital (P1.8)", () => {
    const timeline = gmeFundingTimeline(
      gme({ scenario: "existingUnderCap", capHeadroomFte: 10, awardedNewSlots: 0 }),
      rampFte(MATURE_PROGRAM_YEAR, 6)
    );
    expect(timeline[MATURE_PROGRAM_YEAR - 1].fundableDgmeFte).toBe(10);
    expect(timeline.flatMap((t) => t.warnings).some((w) => /exceeds the hospital's cap headroom/.test(w)))
      .toBe(true);
  });

  it("funds exactly the awarded slots at cap", () => {
    const timeline = gmeFundingTimeline(
      gme({ scenario: "atCap", awardedNewSlots: 5 }),
      rampFte(MATURE_PROGRAM_YEAR, 6)
    );
    expect(timeline[MATURE_PROGRAM_YEAR - 1].fundableDgmeFte).toBe(5);
  });

  it("lets a new program's ratio grow through the ramp, then holds it", () => {
    const timeline = gmeFundingTimeline(
      gme({ scenario: "newTeachingHospital", availableBeds: 350, existingResidentFte: 0 }),
      rampFte(MATURE_PROGRAM_YEAR, 6)
    );
    const ratios = timeline.map((t) => t.imeRatio);
    for (let i = 1; i < CAP_BUILDING_WINDOW_YEARS - 1; i++) {
      expect(ratios[i]).toBeGreaterThan(ratios[i - 1]);
    }
    expect(ratios[MATURE_PROGRAM_YEAR - 1]).toBeCloseTo(24 / 350, 10);
  });
});

describe("GME: Medicaid", () => {
  it("is a flat per-resident amount, not capped by Medicare", () => {
    expect(
      medicaidGme(24, { ...DEFAULT_INPUTS.gme.medicaid, mode: "perResident", perResidentAmount: 50_000 })
    ).toBe(1_200_000);
  });

  it("pays nothing in states without a program", () => {
    expect(
      medicaidGme(24, { ...DEFAULT_INPUTS.gme.medicaid, mode: "none", perResidentAmount: 50_000 })
    ).toBe(0);
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
    const hours = p.dutyHoursPerWeek * p.dutyWeeksPerYear * p.sponsorSiteShare * p.fractionOnAnesthesia;
    expect(coverageFteForYear(p)).toBeCloseTo(
      (hours * p.anesthesiaProductivityPerHour) / 2080,
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

describe("Resident hours (explicit)", () => {
  it("counts duty hours net of vacation, from the two stated inputs", () => {
    const p = DEFAULT_INPUTS.clinical.PGY4;
    expect(residentAnnualDutyHours(p)).toBe(60 * 48);
    // Vacation lives in weeks and nowhere else — fractionOnAnesthesia divides
    // worked time only, so it must not discount for vacation a second time.
    expect(residentAnnualDutyHours({ ...p, dutyWeeksPerYear: 52 })).toBe(60 * 52);
  });

  it("narrows duty hours to sponsor-site anesthesia hours", () => {
    const p = DEFAULT_INPUTS.clinical.PGY4;
    expect(sponsorAnesthesiaHours(p)).toBeCloseTo(
      60 * 48 * p.sponsorSiteShare * p.fractionOnAnesthesia,
      10
    );
  });

  it("scales coverage linearly with duty hours", () => {
    const p = DEFAULT_INPUTS.clinical.PGY4;
    const base = coverageFteForYear(p);
    expect(coverageFteForYear({ ...p, dutyHoursPerWeek: 30 })).toBeCloseTo(base / 2, 10);
    expect(coverageFteForYear({ ...p, dutyHoursPerWeek: 0 })).toBe(0);
  });

  it("credits a resident working CRNA hours at CRNA productivity as one FTE", () => {
    // The sanity anchor for the whole re-expression: same hours, same rate, all
    // time on anesthesia at the sponsor site => exactly one coverage FTE.
    const params = {
      ...DEFAULT_INPUTS.clinical.PGY4,
      dutyHoursPerWeek: 40,
      dutyWeeksPerYear: 52,
      sponsorSiteShare: 1,
      fractionOnAnesthesia: 1,
      anesthesiaProductivityPerHour: 1,
    };
    expect(coverageFteForYear(params)).toBeCloseTo(1, 10);
  });

  it("is value-neutral against the blended figures it replaced", () => {
    // The per-hour defaults were derived from the old blended coverage values
    // at 60 duty hours a week, so each level should land within rounding of
    // where it was. This test is what makes "re-expression, not re-valuation"
    // an enforceable claim rather than an assertion in a commit message.
    const previouslyImplied: Record<string, number> = {
      PGY1: 0.045,
      PGY2: 0.391,
      PGY3: 0.56525,
      PGY4: 0.72675,
    };
    for (const year of RESIDENCY_YEARS) {
      const now = coverageFteForYear(DEFAULT_INPUTS.clinical[year]);
      const before = previouslyImplied[year];
      expect(Math.abs(now / before - 1)).toBeLessThan(0.02);
    }
  });

  it("shows a duty week materially longer than a CRNA's", () => {
    // The asymmetry the blended figure hid: a resident is in the building far
    // more than a CRNA, and is individually less productive per hour. Both are
    // now stated rather than netted against each other invisibly.
    const p = DEFAULT_INPUTS.clinical.PGY4;
    expect(residentAnnualDutyHours(p)).toBeGreaterThan(
      DEFAULT_INPUTS.salaries.crnaWorkedHoursPerPaidFte
    );
    expect(p.anesthesiaProductivityPerHour).toBeLessThan(1);
  });
});

describe("CRNA cost of coverage", () => {
  /** Rate-only inputs: worked hours pinned at 2,080 so no backfill applies. */
  const rateOnly = (over: Partial<typeof DEFAULT_INPUTS.salaries> = {}) => ({
    ...DEFAULT_INPUTS.salaries,
    crnaWorkedHoursPerPaidFte: 2080,
    ...over,
  });

  it("values coverage at base + premium + fringe", () => {
    // 200,000 × 1.10 = 220,000 of wages, × 1.25 fringe = 275,000.
    expect(
      crnaCostOfCoverage(
        rateOnly({ crnaSalary: 200_000, crnaPremiumPayLoad: 0.1, benefitLoadRate: 0.25 })
      )
    ).toBeCloseTo(275_000, 6);
  });

  it("reduces to plain loaded salary when there is no premium", () => {
    const salaries = rateOnly({ crnaPremiumPayLoad: 0 });
    expect(crnaCostOfCoverage(salaries)).toBeCloseTo(
      loaded(salaries.crnaSalary, salaries.benefitLoadRate),
      6
    );
  });

  it("ignores a negative premium rather than crediting one", () => {
    const salaries = rateOnly({ crnaPremiumPayLoad: -0.5 });
    expect(crnaCostOfCoverage(salaries)).toBeCloseTo(
      loaded(salaries.crnaSalary, salaries.benefitLoadRate),
      6
    );
  });

  it("grosses up for paid-versus-worked hours at the defaults (B1)", () => {
    // 220,000 × 1.12 × 1.25 × (2080/1860).
    expect(crnaCostOfCoverage(DEFAULT_INPUTS.salaries)).toBeCloseTo(344_430, -1);
  });

  it("reproduces the un-backfilled figure at 2,080 worked hours (mode (b) anchor)", () => {
    expect(
      crnaCostOfCoverage({ ...DEFAULT_INPUTS.salaries, crnaWorkedHoursPerPaidFte: 2080 })
    ).toBeCloseTo(308_000, 6);
  });

  it("costs more per delivered coverage FTE as worked hours fall", () => {
    const at = (crnaWorkedHoursPerPaidFte: number) =>
      crnaCostOfCoverage({ ...DEFAULT_INPUTS.salaries, crnaWorkedHoursPerPaidFte });
    expect(at(1_780)).toBeGreaterThan(at(1_860));
    expect(at(1_860)).toBeGreaterThan(at(1_940));
  });

  it("clamps nonsense worked-hours values instead of producing NaN or Infinity", () => {
    for (const crnaWorkedHoursPerPaidFte of [0, -500, 1e9, Number.NaN]) {
      const cost = crnaCostOfCoverage({
        ...DEFAULT_INPUTS.salaries,
        crnaWorkedHoursPerPaidFte,
      });
      if (Number.isNaN(crnaWorkedHoursPerPaidFte)) {
        // NaN survives the min/max comparison chain; guard that it cannot make
        // the model silently produce NaN dollars everywhere downstream.
        expect(Number.isFinite(cost)).toBe(true);
      } else {
        expect(Number.isFinite(cost)).toBe(true);
        expect(cost).toBeGreaterThan(0);
      }
    }
    // Above 2,080 there is no backfill to price, so it floors at the rate cost.
    expect(
      crnaCostOfCoverage({ ...DEFAULT_INPUTS.salaries, crnaWorkedHoursPerPaidFte: 4000 })
    ).toBeCloseTo(308_000, 6);
    // Below 1 hour it is capped rather than exploding.
    expect(
      crnaCostOfCoverage({ ...DEFAULT_INPUTS.salaries, crnaWorkedHoursPerPaidFte: 0 })
    ).toBeCloseTo(308_000 * 2080, 6);
  });

  it("raises the labor benefit without touching any cost line", () => {
    const withPremium = runModel(DEFAULT_INPUTS).steadyState;
    const withoutPremium = runModel({
      ...DEFAULT_INPUTS,
      salaries: { ...DEFAULT_INPUTS.salaries, crnaPremiumPayLoad: 0 },
    }).steadyState;

    const labor = (y: typeof withPremium) =>
      y.benefits.find((b) => b.key === "labor")!.amount;
    expect(labor(withPremium)).toBeCloseTo(labor(withoutPremium) * 1.12, 6);

    // The asymmetry is the whole point: a resident's stipend does not move, and
    // neither does the attending time their room consumes.
    for (const key of ["residentsalary", "supervision", "efficiency"]) {
      expect(withPremium.costs.find((c) => c.key === key)!.amount).toBeCloseTo(
        withoutPremium.costs.find((c) => c.key === key)!.amount,
        6
      );
    }
  });
});

describe("Call-pay double-count guardrail (B3)", () => {
  const withCall = (crnaPremiumPayLoad: number, enabled = true): ModelInputs => ({
    ...DEFAULT_INPUTS,
    salaries: { ...DEFAULT_INPUTS.salaries, crnaPremiumPayLoad },
    callCoverage: { ...DEFAULT_INPUTS.callCoverage, enabled },
  });
  const fires = (inputs: ModelInputs) =>
    runModel(inputs).warnings.some((w) => /counted in both places/.test(w));

  it("warns when call coverage is on and the premium load is high", () => {
    expect(fires(withCall(0.16))).toBe(true);
  });

  it("stays silent at a scheduled-day-only premium load", () => {
    expect(fires(withCall(0.12))).toBe(false);
  });

  it("stays silent when call coverage is off, however high the load", () => {
    expect(fires(withCall(0.4, false))).toBe(false);
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

  it("handles fine-grained direction ratios between 1:2 and 1:4", () => {
    const salaries = {
      ...DEFAULT_INPUTS.salaries,
      anesthesiologistSalary: 400_000,
      benefitLoadRate: 0.25,
    };
    const at = (maxCrnaSupervisionRatio: number) =>
      incrementalSupervisionCostPerLocation(salaries, {
        maxResidentSupervisionRatio: 2,
        maxCrnaSupervisionRatio,
      });

    // $500,000 loaded × (1/2 − 1/N).
    expect(at(4)).toBeCloseTo(125_000, 6);
    expect(at(3.5)).toBeCloseTo(500_000 * (0.5 - 1 / 3.5), 6);
    expect(at(3)).toBeCloseTo(500_000 * (0.5 - 1 / 3), 6);
    expect(at(2.5)).toBeCloseTo(500_000 * (0.5 - 1 / 2.5), 6);
    // At 1:2 the resident room costs no more attending time than a CRNA room.
    expect(at(2)).toBe(0);

    // Monotonic across the slider's whole range, in tenths.
    let previous = -1;
    for (let ratio = 2; ratio <= 4.0001; ratio += 0.1) {
      const cost = at(Math.round(ratio * 10) / 10);
      expect(cost).toBeGreaterThanOrEqual(previous);
      previous = cost;
    }
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
    const crnaLoaded = crnaCostOfCoverage(inputs.salaries);
    const expected = RESIDENCY_YEARS.reduce((s, y) => {
      const p = inputs.clinical[y];
      const hours =
        p.dutyHoursPerWeek * p.dutyWeeksPerYear * p.sponsorSiteShare * p.fractionOnAnesthesia;
      return s + cohort[y] * ((hours * p.anesthesiaProductivityPerHour) / 2080) * crnaLoaded;
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

    // The capped labor value is exactly demand-worth of all-in CRNA coverage.
    const crnaLoaded = crnaCostOfCoverage(DEFAULT_INPUTS.salaries);
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
    const capped = r.warnings.filter((w) =>
      /exceeds the .* staffed anesthetizing locations/.test(w)
    );
    expect(capped).toHaveLength(1);
    // Every year past the cap raises it, and the result-level union collapses
    // them to one — which only works because the text carries no year-specific
    // figure. Those live in the labor line-item detail instead.
    expect(r.years.filter((y) => y.warnings.length > 0).length).toBeGreaterThan(1);
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

describe("Site allocation and countable FTE (P2.1)", () => {
  it("counts only sponsor-site time as Medicare DGME FTE", () => {
    const inputs: ModelInputs = { ...DEFAULT_INPUTS, annualAttritionRate: 0 };
    // A 6-intern class at a 0.5 sponsor-site share is 3.0 sponsor DGME FTE.
    const y1 = countableFteForYear(inputs, 1, residentsInProgramYear(inputs, 1));
    expect(inputs.clinical.PGY1.sponsorSiteShare).toBe(0.5);
    expect(y1.dgmeFte).toBeCloseTo(3.0, 10);
    expect(y1.byLevel.PGY1).toBeCloseTo(3.0, 10);
  });

  it("counts only the patient-care share of sponsor time for IME", () => {
    const inputs: ModelInputs = { ...DEFAULT_INPUTS, annualAttritionRate: 0 };
    const y1 = countableFteForYear(inputs, 1, residentsInProgramYear(inputs, 1));
    expect(y1.imeFte).toBeCloseTo(3.0 * 0.95, 10);
    expect(y1.imeFte).toBeLessThan(y1.dgmeFte);
  });

  it("composes coverage from hours × site × on-anesthesia × per-hour productivity", () => {
    const params = {
      ...DEFAULT_INPUTS.clinical.PGY2,
      dutyHoursPerWeek: 40,
      dutyWeeksPerYear: 52, // exactly one 2,080-hour year, for legibility
      sponsorSiteShare: 0.85,
      fractionOnAnesthesia: 0.82,
      anesthesiaProductivityPerHour: 0.5,
    };
    // A resident working a CRNA's hours at half a CRNA's rate delivers exactly
    // half of the sponsor-site on-anesthesia share.
    expect(coverageFteForYear(params)).toBeCloseTo(0.85 * 0.82 * 0.5, 10);
  });

  it("credits off-service value only for sponsor-site off-service time", () => {
    const params = {
      ...DEFAULT_INPUTS.clinical.PGY1,
      sponsorSiteShare: 0.5,
      fractionOnAnesthesia: 0.3,
      offServiceCoverageFte: 0.55,
      offServiceProviderAnnualCost: 150_000,
    };
    // 0.5 sponsor × 0.7 off-service × 0.55 FTE × $150k.
    expect(offServiceValue(params)).toBeCloseTo(0.5 * 0.7 * 0.55 * 150_000, 6);
    // Send the resident entirely away and the sponsor's credit disappears.
    expect(offServiceValue({ ...params, sponsorSiteShare: 0 })).toBe(0);
  });

  it("carries participating-site support as a cost line only when set", () => {
    const base = runModel(DEFAULT_INPUTS);
    expect(base.steadyState.costs.some((c) => c.key === "sitesupport")).toBe(false);

    const paying: ModelInputs = {
      ...DEFAULT_INPUTS,
      program: { ...DEFAULT_INPUTS.program, participatingSiteSupportAnnual: 250_000 },
    };
    const withSupport = runModel(paying);
    // Steady state is program year 6, so the year-1 dollars have escalated.
    const escalated =
      250_000 *
      escalationFactors(DEFAULT_INPUTS.projection, withSupport.steadyState.programYear).wage;
    expect(withSupport.steadyState.costs.find((c) => c.key === "sitesupport")!.amount)
      .toBeCloseTo(escalated, 6);
    expect(withSupport.steadyState.totalCosts).toBeCloseTo(
      base.steadyState.totalCosts + escalated,
      6
    );
  });
});

describe("Attrition (P2.2)", () => {
  it("thins each cohort by the annual rate, without rounding to whole people", () => {
    const inputs: ModelInputs = {
      ...DEFAULT_INPUTS,
      residentsPerClass: 10,
      annualAttritionRate: 0.1,
    };
    const steady = residentsInProgramYear(inputs, 4);
    expect(steady.PGY1).toBeCloseTo(10, 10);
    expect(steady.PGY2).toBeCloseTo(9, 10);
    expect(steady.PGY3).toBeCloseTo(8.1, 10);
    expect(steady.PGY4).toBeCloseTo(7.29, 10);
  });

  it("applies symmetrically to costs and benefits", () => {
    const withAttrition: ModelInputs = { ...DEFAULT_INPUTS, annualAttritionRate: 0.1 };
    const without: ModelInputs = { ...DEFAULT_INPUTS, annualAttritionRate: 0 };
    const a = runModel(withAttrition).steadyState;
    const b = runModel(without).steadyState;
    expect(a.totalResidents).toBeLessThan(b.totalResidents);
    expect(a.costs.find((c) => c.key === "residentsalary")!.amount).toBeLessThan(
      b.costs.find((c) => c.key === "residentsalary")!.amount
    );
    expect(a.benefits.find((x) => x.key === "labor")!.amount).toBeLessThan(
      b.benefits.find((x) => x.key === "labor")!.amount
    );
  });

  it("shrinks the cap a new teaching hospital builds", () => {
    const lossy: ModelInputs = {
      ...DEFAULT_INPUTS,
      residentsPerClass: 10,
      annualAttritionRate: 0.1,
    };
    // Countable FTE by level in year 5, after attrition and site share:
    //   PGY1 10 × 0.50 = 5.00   PGY2 9 × 0.85 = 7.65
    //   PGY3 8.1 × 0.85 = 6.885 PGY4 7.29 × 0.90 = 6.561
    // The CA-1 cohort is the largest single program year, so the cap it builds
    // is 7.65 × 4 = 30.6 — not the 40 a naive headcount × 4 would suggest.
    const y5 = countableFteForYear(lossy, 5, residentsInProgramYear(lossy, 5));
    expect(buildPermanentCap(y5.byLevel)).toBeCloseTo(30.6, 10);
  });
});

describe("Per-resident program costs (P4.1)", () => {
  it("sums liability, GME office overhead, and the fee stack", () => {
    expect(perResidentProgramCost(DEFAULT_INPUTS.program)).toBe(7_500 + 15_000 + 4_000);
  });

  it("charges them per head and escalates with salary inflation", () => {
    const r = runModel({ ...DEFAULT_INPUTS, annualAttritionRate: 0 });
    const y1 = r.years.find((y) => y.programYear === 1)!;
    const line = y1.costs.find((c) => c.key === "perresident")!;
    expect(line.amount).toBeCloseTo(6 * 26_500, 6);

    const y3 = r.years.find((y) => y.programYear === 3)!;
    const perHead3 =
      y3.costs.find((c) => c.key === "perresident")!.amount / y3.totalResidents;
    expect(perHead3).toBeCloseTo(26_500 * Math.pow(1.03, 2), 6);
  });
});

describe("Retention pipeline (P4.2)", () => {
  const noAttrition: ModelInputs = { ...DEFAULT_INPUTS, annualAttritionRate: 0 };

  it("credits nothing before the first class graduates", () => {
    const r = runModel(noAttrition);
    const beforeGraduation = r.years.filter(
      (x) => x.programYear >= 1 && x.programYear < FIRST_GRADUATION_BENEFIT_YEAR
    );
    expect(beforeGraduation).not.toHaveLength(0);
    for (const y of beforeGraduation) {
      expect(y.benefits.find((b) => b.key === "retention")!.amount).toBe(0);
    }
  });

  it("credits graduates × retention rate × avoided cost from program year 5", () => {
    const r = runModel(noAttrition);
    const y5 = r.years.find((y) => y.programYear === 5)!;
    const expected =
      6 * 0.3 * 400_000 * escalationFactors(DEFAULT_INPUTS.projection, 5).wage;
    expect(y5.benefits.find((b) => b.key === "retention")!.amount).toBeCloseTo(expected, 6);
  });

  it("scales with the surviving PGY-4 cohort, not the entering class", () => {
    const lossy: ModelInputs = { ...DEFAULT_INPUTS, annualAttritionRate: 0.1 };
    const y5 = runModel(lossy).years.find((y) => y.programYear === 5)!;
    const expected =
      6 * Math.pow(0.9, 3) * 0.3 * 400_000 *
      escalationFactors(DEFAULT_INPUTS.projection, 5).wage;
    expect(y5.benefits.find((b) => b.key === "retention")!.amount).toBeCloseTo(expected, 6);
  });

  it("disappears entirely when switched off", () => {
    const off: ModelInputs = {
      ...DEFAULT_INPUTS,
      retention: { ...DEFAULT_INPUTS.retention, enabled: false },
    };
    const r = runModel(off);
    expect(r.years.every((y) => !y.benefits.some((b) => b.key === "retention"))).toBe(true);
  });

  it("spreads the avoided cost when recognized over multiple years", () => {
    const spread: ModelInputs = {
      ...noAttrition,
      retention: { ...DEFAULT_INPUTS.retention, benefitRecognitionYears: 2 },
    };
    const r = runModel(spread);
    const y5 = r.years.find((y) => y.programYear === 5)!;
    const y6 = r.years.find((y) => y.programYear === 6)!;
    // Year 5 recognizes half of one class; year 6 has two classes in flight.
    expect(y5.benefits.find((b) => b.key === "retention")!.amount).toBeCloseTo(
      (6 * 0.3 * 400_000 * escalationFactors(DEFAULT_INPUTS.projection, 5).wage) / 2,
      6
    );
    expect(y6.benefits.find((b) => b.key === "retention")!.amount).toBeCloseTo(
      6 * 0.3 * 400_000 * escalationFactors(DEFAULT_INPUTS.projection, 6).wage,
      6
    );
  });
});

describe("Call coverage (P4.3)", () => {
  const on: ModelInputs = {
    ...DEFAULT_INPUTS,
    callCoverage: { enabled: true, nightsPerYearCovered: 365, avoidedCostPerNight: 2_000 },
  };

  it("is off by default and adds no line", () => {
    expect(DEFAULT_INPUTS.callCoverage.enabled).toBe(false);
    expect(
      runModel(DEFAULT_INPUTS).years.every((y) => !y.benefits.some((b) => b.key === "call"))
    ).toBe(true);
  });

  it("starts flat in the first year with CA-2s", () => {
    const r = runModel(on);
    expect(r.years.find((y) => y.programYear === 2)!.benefits.find((b) => b.key === "call")!.amount)
      .toBe(0);
    const y3 = r.years.find((y) => y.programYear === 3)!;
    expect(y3.benefits.find((b) => b.key === "call")!.amount).toBeCloseTo(
      365 * 2_000 * escalationFactors(DEFAULT_INPUTS.projection, 3).wage,
      6
    );
  });
});

describe("Medicaid GME modes (P4.4)", () => {
  const appropriation = (over = {}): ModelInputs => ({
    ...DEFAULT_INPUTS,
    gme: {
      ...DEFAULT_INPUTS.gme,
      medicaid: {
        mode: "appropriation",
        perResidentAmount: 0,
        annualAppropriationTotal: 2_000_000,
        requiresLocalMatch: true,
        ...over,
      },
    },
  });

  it("ignores resident count in appropriation mode", () => {
    const small = runModel(appropriation());
    const large = runModel({ ...appropriation(), residentsPerClass: 20 });
    const line = (r: ReturnType<typeof runModel>) =>
      r.steadyState.benefits.find((b) => b.key === "medicaid")!.amount;
    expect(line(small)).toBe(2_000_000);
    expect(line(large)).toBe(2_000_000);
  });

  it("warns when the non-federal share is not yet committed", () => {
    expect(
      runModel(appropriation()).warnings.some((w) => /intergovernmental agreement/.test(w))
    ).toBe(true);
  });

  it("stays quiet when no local match is required", () => {
    expect(
      runModel(appropriation({ requiresLocalMatch: false })).warnings.some((w) =>
        /intergovernmental agreement/.test(w)
      )
    ).toBe(false);
  });

  it("scales with resident count in per-resident mode", () => {
    const perResident: ModelInputs = {
      ...DEFAULT_INPUTS,
      annualAttritionRate: 0,
      gme: {
        ...DEFAULT_INPUTS.gme,
        medicaid: { ...DEFAULT_INPUTS.gme.medicaid, mode: "perResident", perResidentAmount: 50_000 },
      },
    };
    expect(
      runModel(perResident).steadyState.benefits.find((b) => b.key === "medicaid")!.amount
    ).toBeCloseTo(24 * 50_000, 6);
  });
});

describe("Projection frame (P3.1)", () => {
  it("models pre-revenue years with spending and no residents", () => {
    const r = runModel(DEFAULT_INPUTS);
    const pre = r.years.filter((y) => y.programYear <= 0);
    expect(pre.map((y) => y.programYear)).toEqual([-1, 0]);
    for (const y of pre) {
      expect(y.totalResidents).toBe(0);
      expect(y.totalBenefits).toBe(0);
      expect(y.netValue).toBeLessThan(0);
    }
    // The startup cost lands in the pre-revenue years, split evenly.
    const startupCharged = sumAmounts(pre, "startup");
    expect(startupCharged).toBeGreaterThan(0);
    expect(pre[0].costs.find((c) => c.key === "startup")!.amount).toBeCloseTo(
      (DEFAULT_INPUTS.program.startupCost *
        escalationFactors(DEFAULT_INPUTS.projection, -1).wage) /
        2,
      6
    );
    // The final pre-revenue year carries more program cost than the first.
    expect(pre[1].costs.find((c) => c.key === "support")!.amount).toBeGreaterThan(
      pre[0].costs.find((c) => c.key === "support")!.amount
    );
  });

  it("runs the full horizon and no longer double-charges startup in year 1", () => {
    const r = runModel(DEFAULT_INPUTS);
    expect(r.years).toHaveLength(DEFAULT_INPUTS.projection.horizonYears + 2);
    expect(r.years[r.years.length - 1].programYear).toBe(
      DEFAULT_INPUTS.projection.horizonYears
    );
    expect(r.rampYears.map((y) => y.programYear)).toEqual([1, 2, 3, 4]);
    for (const y of r.years.filter((x) => x.programYear >= 1)) {
      expect(y.costs.some((c) => c.key === "startup")).toBe(false);
    }
  });

  it("escalates each stream at its own rate, from year 1 = 1.0", () => {
    const f1 = escalationFactors(DEFAULT_INPUTS.projection, 1);
    expect(f1).toEqual({ wage: 1, pra: 1, base: 1 });
    const f3 = escalationFactors(DEFAULT_INPUTS.projection, 3);
    expect(f3.wage).toBeCloseTo(Math.pow(1.03, 2), 10);
    expect(f3.pra).toBeCloseTo(Math.pow(1.025, 2), 10);
    // Pre-revenue years sit below the typed year-1 dollars.
    expect(escalationFactors(DEFAULT_INPUTS.projection, -1).wage).toBeLessThan(1);

    const r = runModel(DEFAULT_INPUTS);
    const y1 = r.years.find((y) => y.programYear === 1)!;
    const y2 = r.years.find((y) => y.programYear === 2)!;
    const stipend = (y: (typeof r.years)[number]) =>
      y.costs.find((c) => c.key === "residentsalary")!.amount / y.totalResidents;
    expect(stipend(y2) / stipend(y1)).toBeCloseTo(1.03, 10);
  });
});

describe("Summary metrics (P3.2)", () => {
  /** A three-year toy frame: one pre-revenue year and two program years. */
  const toy: YearResult[] = [
    toyYear(0, -100),
    toyYear(1, -50),
    toyYear(2, 300),
  ];
  const projection = {
    ...DEFAULT_INPUTS.projection,
    preRevenueYears: 1,
    discountRate: 0.1,
  };

  it("discounts from period zero in the first modeled year", () => {
    const s = summarize(toy, projection);
    // -100/1.1^0 + -50/1.1^1 + 300/1.1^2 = -100 - 45.4545… + 247.9338…
    expect(s.npv).toBeCloseTo(-100 + -50 / 1.1 + 300 / 1.21, 8);
    expect(s.nominalCumulativeNet).toBe(150);
  });

  it("equals the nominal sum at a zero discount rate", () => {
    const s = summarize(toy, { ...projection, discountRate: 0 });
    expect(s.npv).toBeCloseTo(s.nominalCumulativeNet, 10);
  });

  it("reports the first program year where cumulative discounted net turns positive", () => {
    expect(summarize(toy, projection).breakevenYear).toBe(2);
  });

  it("reports null breakeven when the program never recovers", () => {
    const losing = [toyYear(0, -100), toyYear(1, -50), toyYear(2, -10)];
    expect(summarize(losing, projection).breakevenYear).toBeNull();
  });

  it("keeps the deprecated five-year figure as a nominal sum of years 1-5", () => {
    const r = runModel(DEFAULT_INPUTS);
    const expected = r.years
      .filter((y) => y.programYear >= 1 && y.programYear <= 5)
      .reduce((s, y) => s + y.netValue, 0);
    expect(r.fiveYearCumulativeNet).toBeCloseTo(expected, 6);
  });

  it("summarises the default program end to end", () => {
    const r = runModel(DEFAULT_INPUTS);
    expect(r.summary.steadyStateAnnualNet).toBeCloseTo(r.steadyState.netValue, 10);
    expect(r.summary.nominalCumulativeNet).toBeCloseTo(
      r.years.reduce((s, y) => s + y.netValue, 0),
      6
    );
    // A positive-NPV default program should break even inside the horizon.
    if (r.summary.npv > 0) expect(r.summary.breakevenYear).not.toBeNull();
  });

});

describe("Program ramp", () => {
  /** Attrition off, so cohort arithmetic is legible. */
  const even: ModelInputs = { ...DEFAULT_INPUTS, annualAttritionRate: 0 };

  it("adds one class per year up to four", () => {
    expect(residentsInProgramYear(even, 1)).toMatchObject({
      PGY1: 6,
      PGY2: 0,
      PGY3: 0,
      PGY4: 0,
    });
    expect(residentsInProgramYear(even, 4)).toMatchObject({
      PGY1: 6,
      PGY2: 6,
      PGY3: 6,
      PGY4: 6,
    });
  });

  it("does not exceed four classes", () => {
    expect(residentsInProgramYear(even, 8)).toMatchObject({
      PGY1: 6,
      PGY2: 6,
      PGY3: 6,
      PGY4: 6,
    });
  });
});

describe("Full model", () => {
  it("produces four ramp years and a steady state", () => {
    const r = runModel({ ...DEFAULT_INPUTS, annualAttritionRate: 0 });
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

  it("at-cap program loses Medicare GME benefits (lower net than a new teaching hospital)", () => {
    const newHospital = runModel(DEFAULT_INPUTS);
    const atCap: ModelInputs = {
      ...DEFAULT_INPUTS,
      gme: { ...DEFAULT_INPUTS.gme, scenario: "atCap", awardedNewSlots: 0 },
    };
    const capped = runModel(atCap);
    expect(capped.steadyState.totalBenefits).toBeLessThan(
      newHospital.steadyState.totalBenefits
    );
    expect(capped.steadyState.benefits.find((b) => b.key === "dgme")!.amount).toBe(0);
    expect(capped.steadyState.benefits.find((b) => b.key === "ime")!.amount).toBe(0);
    expect(capped.warnings.some((w) => w.includes("CAA 2021 §126"))).toBe(true);
  });

  it("reports the mature year (post cap-building) as steady state", () => {
    const r = runModel({ ...DEFAULT_INPUTS, annualAttritionRate: 0 });
    expect(r.steadyState.programYear).toBe(MATURE_PROGRAM_YEAR);
    expect(r.steadyState.totalResidents).toBe(24);
    // The cap a new teaching hospital builds for itself is exactly its complement.
    expect(r.steadyState.benefits.find((b) => b.key === "dgme")!.amount).toBeGreaterThan(0);
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
