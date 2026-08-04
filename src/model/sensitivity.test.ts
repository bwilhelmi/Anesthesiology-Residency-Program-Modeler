import { describe, it, expect } from "vitest";
import { DEFAULT_INPUTS, SCENARIOS } from "./constants";
import { runModel } from "./model";
import { DEFAULT_SWING, tornado, tornadoVariables } from "./sensitivity";
import type { ModelInputs } from "./types";

/** A fixture with attrition off, so the bars are reproducible by hand. */
const fixture: ModelInputs = { ...DEFAULT_INPUTS, annualAttritionRate: 0 };

const width = (b: { low: number; high: number }) => Math.abs(b.high - b.low);

describe("Tornado (P5.1)", () => {
  it("covers the fixed variable list exactly once", () => {
    const bars = tornado(fixture);
    const keys = bars.map((b) => b.key);
    expect(new Set(keys).size).toBe(keys.length);
    expect(keys).toHaveLength(tornadoVariables(fixture, DEFAULT_SWING).length);
    expect(new Set(keys)).toEqual(
      new Set([
        "pra",
        "cap",
        "medicareshare",
        "imebase",
        "crna",
        "crnaPremium",
        "crnaWorkedHours",
        "anesthesiologist",
        "coverage",
        "throughput",
        "supervisionratio",
        "retention",
        "discount",
        "classsize",
      ])
    );
  });

  it("returns metric values, not deltas, so the UI can draw around the base case", () => {
    const base = runModel(fixture).summary.npv;
    const bars = tornado(fixture);
    const pra = bars.find((b) => b.key === "pra")!;
    // More PRA is more money, and the base case sits between the two ends.
    expect(pra.high).toBeGreaterThan(pra.low);
    expect(base).toBeGreaterThan(pra.low);
    expect(base).toBeLessThan(pra.high);
  });

  it("sorts bars widest first and is deterministic", () => {
    const bars = tornado(fixture);
    for (let i = 1; i < bars.length; i++) {
      expect(width(bars[i - 1])).toBeGreaterThanOrEqual(width(bars[i]));
    }
    expect(tornado(fixture)).toEqual(bars);
  });

  it("gives a variable with no pathway to the metric a zero-width bar", () => {
    const noRetention: ModelInputs = {
      ...fixture,
      retention: { ...fixture.retention, enabled: false },
    };
    const bar = tornado(noRetention).find((b) => b.key === "retention")!;
    expect(width(bar)).toBe(0);
    // And it sorts to the bottom, where a reader will correctly ignore it.
    const sorted = tornado(noRetention);
    expect(sorted[sorted.length - 1].key).toBe("retention");
  });

  it("swings the discount rate in absolute points, not proportionally", () => {
    const bars = tornado(fixture);
    const bar = bars.find((b) => b.key === "discount")!;
    const low = runModel({
      ...fixture,
      projection: {
        ...fixture.projection,
        discountRate: fixture.projection.discountRate - 0.02,
      },
    }).summary.npv;
    expect(bar.low).toBeCloseTo(low, 6);

    // Direction depends on the cash-flow shape, not on the discount rate: for a
    // program that earns its way out, a higher rate is worth less; for one that
    // loses money every year, a higher rate discounts the losses and flatters
    // it. The fixture is the latter at the shipped block schedule.
    const earning = { ...fixture, residentsPerClass: 30 };
    const earningBar = tornado(earning).find((b) => b.key === "discount")!;
    expect(earningBar.high).toBeLessThan(earningBar.low);
    expect(bar.high).toBeGreaterThan(bar.low);
  });

  it("swings the supervision ratio between one and two rooms", () => {
    const bar = tornado(fixture).find((b) => b.key === "supervisionratio")!;
    const oneRoom = runModel({
      ...fixture,
      supervision: { ...fixture.supervision, maxResidentSupervisionRatio: 1 },
    }).summary.npv;
    expect(bar.low).toBeCloseTo(oneRoom, 6);
    // Supervising two rooms costs the department less attending time.
    expect(bar.high).toBeGreaterThan(bar.low);
  });

  it("accepts any metric and any swing", () => {
    const wide = tornado(fixture, (r) => r.summary.npv, 0.5);
    const narrow = tornado(fixture, (r) => r.summary.npv, 0.05);
    const key = "crna";
    expect(width(wide.find((b) => b.key === key)!)).toBeGreaterThan(
      width(narrow.find((b) => b.key === key)!)
    );

    const byNet = tornado(fixture, (r) => r.summary.steadyStateAnnualNet);
    expect(byNet.find((b) => b.key === "discount")!.low).toBeCloseTo(
      byNet.find((b) => b.key === "discount")!.high,
      6
    );
  });
});

describe("Payroll-settleable inputs on the tornado (B2)", () => {
  it("shows a bar for each, with real width at the defaults", () => {
    const bars = tornado(fixture);
    for (const key of ["crnaPremium", "crnaWorkedHours"]) {
      const bar = bars.find((b) => b.key === key);
      expect(bar).toBeDefined();
      expect(width(bar!)).toBeGreaterThan(0);
    }
  });

  it("maps fewer worked hours to the higher metric, not the higher input", () => {
    // Fewer worked hours per paid FTE means more paid FTEs per delivered
    // coverage FTE, so the CRNA coverage being displaced is worth more.
    const bar = tornado(fixture).find((b) => b.key === "crnaWorkedHours")!;
    expect(bar.low).toBeGreaterThan(bar.high);
  });

  it("swings the premium load absolutely, between 5% and 20%", () => {
    const bar = tornado(fixture).find((b) => b.key === "crnaPremium")!;
    const at = (crnaPremiumPayLoad: number) =>
      runModel({
        ...fixture,
        salaries: { ...fixture.salaries, crnaPremiumPayLoad },
      }).summary.npv;
    expect(bar.low).toBeCloseTo(at(0.05), 6);
    expect(bar.high).toBeCloseTo(at(0.2), 6);
  });

  it("keeps the ordering deterministic with the new bars in play", () => {
    const bars = tornado(fixture);
    expect(tornado(fixture)).toEqual(bars);
    for (let i = 1; i < bars.length; i++) {
      expect(width(bars[i - 1])).toBeGreaterThanOrEqual(width(bars[i]));
    }
  });
});

describe("Scenario presets (P5.2)", () => {
  it("orders conservative below base below favorable", () => {
    const npv = (name: keyof typeof SCENARIOS) =>
      runModel({ ...fixture, ...SCENARIOS[name] }).summary.npv;
    expect(npv("conservative")).toBeLessThan(npv("base"));
    expect(npv("base")).toBeLessThan(npv("favorable"));
  });

  it("leaves the base preset equal to the defaults", () => {
    expect(runModel({ ...DEFAULT_INPUTS, ...SCENARIOS.base }).summary.npv).toBeCloseTo(
      runModel(DEFAULT_INPUTS).summary.npv,
      6
    );
  });

  it("patches inputs without disturbing localized figures", () => {
    const localized: ModelInputs = {
      ...fixture,
      salaries: { ...fixture.salaries, crnaSalary: 260_000 },
      gme: { ...fixture.gme, availableBeds: 500 },
    };
    const patched = { ...localized, ...SCENARIOS.conservative };
    expect(patched.salaries.crnaSalary).toBe(260_000);
    expect(patched.gme.availableBeds).toBe(500);
    expect(patched.projection.discountRate).toBe(0.08);
    expect(patched.retention.retentionRate).toBe(0.15);
  });
});
