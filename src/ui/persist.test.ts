import { describe, it, expect } from "vitest";
import { DEFAULT_INPUTS, runModel } from "../model";
import { mergeSaved, restoreInputs } from "./persist";

/** A payload from before resident hours existed — the shape that produced NaN. */
const preHoursSave = () => {
  const clinical = {} as Record<string, Record<string, unknown>>;
  for (const [year, params] of Object.entries(DEFAULT_INPUTS.clinical)) {
    const { ...rest } = params as unknown as Record<string, unknown>;
    delete rest.dutyHoursPerWeek;
    delete rest.dutyWeeksPerYear;
    delete rest.anesthesiaProductivityPerHour;
    clinical[year] = { ...rest, anesthesiaCoverageFte: 0.85 };
  }
  return { ...DEFAULT_INPUTS, clinical };
};

describe("Restoring saved inputs", () => {
  it("keeps what the user localized", () => {
    const saved = {
      ...DEFAULT_INPUTS,
      residentsPerClass: 12,
      salaries: { ...DEFAULT_INPUTS.salaries, crnaSalary: 347_648 },
    };
    const restored = mergeSaved(DEFAULT_INPUTS, saved);
    expect(restored.residentsPerClass).toBe(12);
    expect(restored.salaries.crnaSalary).toBe(347_648);
  });

  it("fills fields a stale payload never had, instead of dropping to undefined", () => {
    const restored = mergeSaved(DEFAULT_INPUTS, preHoursSave());
    expect(restored.clinical.PGY4.dutyHoursPerWeek).toBe(
      DEFAULT_INPUTS.clinical.PGY4.dutyHoursPerWeek
    );
    expect(restored.clinical.PGY4.anesthesiaProductivityPerHour).toBe(
      DEFAULT_INPUTS.clinical.PGY4.anesthesiaProductivityPerHour
    );
  });

  it("produces a finite model from a stale payload — the actual bug", () => {
    const restored = mergeSaved(DEFAULT_INPUTS, preHoursSave());
    const r = runModel(restored);
    expect(Number.isFinite(r.summary.npv)).toBe(true);
    expect(Number.isFinite(r.summary.steadyStateAnnualNet)).toBe(true);
    for (const y of r.years) {
      expect(Number.isFinite(y.netValue)).toBe(true);
      for (const item of [...y.benefits, ...y.costs]) {
        expect(Number.isFinite(item.amount)).toBe(true);
      }
    }
  });

  it("drops a renamed field rather than carrying it forward", () => {
    const restored = mergeSaved(DEFAULT_INPUTS, preHoursSave()) as unknown as Record<
      string,
      unknown
    >;
    const pgy4 = (restored.clinical as Record<string, Record<string, unknown>>).PGY4;
    expect("anesthesiaCoverageFte" in pgy4).toBe(false);
  });

  it("refuses non-finite and wrongly-typed values", () => {
    const restored = mergeSaved(DEFAULT_INPUTS, {
      residentsPerClass: Number.NaN,
      annualAttritionRate: "0.5",
      salaries: { crnaSalary: Number.POSITIVE_INFINITY, residentSalary: 71_000 },
      gme: { scenario: "atCap", applyImeRatioCap: "yes" },
    });
    expect(restored.residentsPerClass).toBe(DEFAULT_INPUTS.residentsPerClass);
    expect(restored.annualAttritionRate).toBe(DEFAULT_INPUTS.annualAttritionRate);
    expect(restored.salaries.crnaSalary).toBe(DEFAULT_INPUTS.salaries.crnaSalary);
    // …while still keeping the good values sitting beside the bad ones.
    expect(restored.salaries.residentSalary).toBe(71_000);
    expect(restored.gme.scenario).toBe("atCap");
    expect(restored.gme.applyImeRatioCap).toBe(DEFAULT_INPUTS.gme.applyImeRatioCap);
  });

  it("survives absent, empty, and malformed storage", () => {
    for (const raw of [null, "", "{", "null", "[]", '"a string"', "42"]) {
      expect(restoreInputs(DEFAULT_INPUTS, raw)).toEqual(DEFAULT_INPUTS);
    }
  });

  it("round-trips the defaults unchanged", () => {
    expect(restoreInputs(DEFAULT_INPUTS, JSON.stringify(DEFAULT_INPUTS))).toEqual(
      DEFAULT_INPUTS
    );
  });
});
