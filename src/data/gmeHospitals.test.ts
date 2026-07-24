import { describe, it, expect } from "vitest";
import {
  GME_HOSPITALS,
  GME_META,
  GME_STATES,
  hospitalByCcn,
  hospitalsInState,
} from "../ui/gmeHospitals";

/**
 * Guards on the CMS-derived GME dataset. These pin a few values verified by hand
 * against the raw HCRIS cost reports (see scripts/build-gme-dataset.mjs) and
 * assert the invariants the UI relies on. If a rebuild from a new fiscal year
 * changes the anchors, update them deliberately — a silent change means the
 * worksheet cell map drifted.
 */
describe("GME hospital dataset", () => {
  it("has a populated hospital list and matching count metadata", () => {
    expect(GME_HOSPITALS.length).toBeGreaterThan(1000);
    expect(GME_META.hospitalCount).toBe(GME_HOSPITALS.length);
    expect(GME_META.settledCount).toBe(GME_HOSPITALS.filter((h) => h.settled).length);
    // most hospitals should resolve to a settled report across the year window
    expect(GME_META.settledCount).toBeGreaterThan(GME_HOSPITALS.length / 2);
  });

  it("pins Cleveland Clinic's settled FY2021 figures (final, won't change on rebuild)", () => {
    const cc = hospitalByCcn("360180");
    expect(cc?.name).toContain("CLEVELAND CLINIC");
    expect(cc?.settled).toBe(true);
    expect(cc?.reportYear).toBe(2021);
    expect(cc?.capFte).toBeCloseTo(881.95, 2);
    expect(cc?.dgmePayment).toBe(32598633);
    expect(cc?.imePayment).toBe(56134392);
  });

  it("prefers a settled report and records its year and status", () => {
    const sparrow = hospitalByCcn("230230"); // Sparrow, MI — settled FY2020
    expect(sparrow?.settled).toBe(true);
    expect(sparrow?.reportYear).toBe(2020);
    expect(sparrow?.dgmePayment).toBe(9159711);
    expect(sparrow?.imePayment).toBe(8986062);
    // every hospital carries a plausible report year from the considered window
    for (const h of GME_HOSPITALS) {
      expect(GME_META.yearsConsidered).toContain(h.reportYear);
    }
  });

  it("computes headroom as cap minus actual FTE", () => {
    for (const h of GME_HOSPITALS) {
      if (h.capFte != null && h.actualFte != null) {
        expect(h.headroomFte).toBeCloseTo(h.capFte - h.actualFte, 2);
      } else {
        expect(h.headroomFte).toBeNull();
      }
    }
  });

  it("never imputes: money and FTE figures are non-negative or null", () => {
    for (const h of GME_HOSPITALS) {
      for (const v of [h.capFte, h.actualFte, h.dgmePayment, h.imePayment, h.beds]) {
        if (v != null) expect(v).toBeGreaterThanOrEqual(0);
      }
    }
  });

  it("has unique CCNs and non-empty names", () => {
    const seen = new Set<string>();
    for (const h of GME_HOSPITALS) {
      expect(h.name.length).toBeGreaterThan(0);
      expect(seen.has(h.ccn)).toBe(false);
      seen.add(h.ccn);
    }
  });

  it("merges Arizona Medicaid (AHCCCS) direct and indirect GME by CCN", () => {
    // Banner – UMC Tucson, AHCCCS academic year 2024: DME 23,095,849 + IME 66,921,477.
    const tucson = hospitalByCcn("030064");
    expect(tucson?.name).toContain("BANNER UNIVERSITY MED CENTER TUCSON");
    expect(tucson?.medicaidProgram).toContain("AHCCCS");
    expect(tucson?.medicaidYear).toBe(2024);
    expect(tucson?.medicaidDgme).toBe(23095849);
    expect(tucson?.medicaidIme).toBe(66921477);
  });

  it("leaves Medicaid figures null where no state data maps (e.g. out of state)", () => {
    const mgh = hospitalByCcn("220071"); // Massachusetts — no AZ Medicaid data
    expect(mgh?.medicaidDgme).toBeNull();
    expect(mgh?.medicaidIme).toBeNull();
    expect(mgh?.medicaidProgram).toBeNull();
  });

  it("filters by state consistently with the state list", () => {
    expect(GME_STATES).toContain("AZ");
    const az = hospitalsInState("AZ");
    expect(az.length).toBeGreaterThan(0);
    expect(az.every((h) => h.state === "AZ")).toBe(true);
    // sorted by name
    const names = az.map((h) => h.name);
    expect([...names].sort((a, b) => a.localeCompare(b))).toEqual(names);
  });
});
