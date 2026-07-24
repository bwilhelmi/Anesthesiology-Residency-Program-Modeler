import { describe, it, expect } from "vitest";
import { MARKET_PREMIUM_DEFAULTS, regionSalaries, SALARY_DATA } from "./regions";

/**
 * Locks the citation-backed default market premiums to their national anchors, so
 * a change to the BLS baseline or the defaults is a deliberate, reviewed change.
 * Anchors: Merritt Hawkins / AMN nonacademic anesthesiology starting base ~$450k;
 * BLS CRNA mean already near market (smaller premium).
 */
describe("market premium calibration", () => {
  it("anesthesiologist default lands near the Merritt Hawkins ~$450k base", () => {
    const nat = regionSalaries("", MARKET_PREMIUM_DEFAULTS.anesthesiologist, MARKET_PREMIUM_DEFAULTS.crna);
    expect(nat).not.toBeNull();
    // BLS mean 360,570 * 1.25 = 450,713 — within a few % of the $450k benchmark.
    expect(nat!.anesthesiologist).toBeGreaterThan(430_000);
    expect(nat!.anesthesiologist).toBeLessThan(470_000);
  });

  it("keeps the CRNA premium modest (BLS CRNA mean is near market)", () => {
    expect(MARKET_PREMIUM_DEFAULTS.crna).toBeLessThanOrEqual(0.15);
    const nat = regionSalaries("", MARKET_PREMIUM_DEFAULTS.anesthesiologist, MARKET_PREMIUM_DEFAULTS.crna);
    // Should stay well under the anesthesiologist figure and near the BLS CRNA mean.
    expect(nat!.crna).toBeLessThan(nat!.anesthesiologist);
    expect(nat!.crna).toBeGreaterThan(SALARY_DATA.national.crna!);
  });

  it("applies role-specific premiums independently", () => {
    const a = regionSalaries("", 0.4, 0);
    const b = regionSalaries("", 0, 0.4);
    // A high anesthesiologist premium must not move the CRNA figure, and vice versa.
    expect(a!.crna).toBe(SALARY_DATA.national.crna);
    expect(b!.anesthesiologist).toBe(SALARY_DATA.national.anesthesiologist);
  });
});
