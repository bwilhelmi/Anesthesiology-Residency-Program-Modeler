import { describe, it, expect } from "vitest";
import { DEFAULT_BLOCK_SCHEDULE, DEFAULT_INPUTS } from "./constants";
import {
  BLOCKS_PER_YEAR,
  applyScheduleToClinical,
  blk,
  deriveSchedule,
  deriveYear,
  rotation,
  scheduleWarnings,
  site,
  ROTATIONS,
  SITES,
} from "./schedule";
import { runModel } from "./model";
import { RESIDENCY_YEARS } from "./types";

describe("Block schedule: the diagram as transcribed", () => {
  it("has 13 blocks in every training year", () => {
    for (const year of RESIDENCY_YEARS) {
      expect(DEFAULT_BLOCK_SCHEDULE[year]).toHaveLength(BLOCKS_PER_YEAR);
    }
  });

  it("uses only rotations and sites that are on the menu", () => {
    for (const year of RESIDENCY_YEARS) {
      for (const block of DEFAULT_BLOCK_SCHEDULE[year]) {
        expect(rotation(block.rotationId), `${year} ${block.rotationId}`).toBeDefined();
        expect(site(block.siteId), `${year} ${block.siteId}`).toBeDefined();
      }
    }
    expect(scheduleWarnings(DEFAULT_BLOCK_SCHEDULE)).toEqual([]);
  });

  it("treats sites sharing a CCN as one Medicare provider", () => {
    // Valleywise Peoria is the sponsor's own CCN, so it is NOT an away rotation.
    expect(site("site1")!.ccn).toBe(site("site1p")!.ccn);
    expect(site("site1p")!.sponsorShare).toBe(1);
    // Barrow is inside St. Joseph's, and neither is the sponsor.
    expect(site("site2")!.ccn).toBe(site("site2b")!.ccn);
    expect(site("site2b")!.sponsorShare).toBe(0);
    expect(site("site3")!.ccn).not.toBe(site("site1")!.ccn);
  });
});

describe("Deriving the clinical fractions", () => {
  const derived = deriveSchedule(DEFAULT_BLOCK_SCHEDULE);

  it("finds the senior years mostly away from the sponsor", () => {
    // The headline the diagram delivers and no asserted fraction did: a CA-2 is
    // at Valleywise for 3 of 13 blocks, a CA-3 for 3.4.
    expect(derived.PGY3.sponsorBlocks).toBeCloseTo(3, 6);
    expect(derived.PGY3.sponsorSiteShare).toBeCloseTo(3 / 13, 6);
    expect(derived.PGY4.sponsorSiteShare).toBeLessThan(0.3);
    // …against the 0.85 and 0.90 the model used to assert.
    expect(derived.PGY3.sponsorSiteShare).toBeLessThan(0.85);
    expect(derived.PGY4.sponsorSiteShare).toBeLessThan(0.9);
  });

  it("splits a part-research block rather than counting it whole", () => {
    // NORA/RS is 50% research: half an anesthesia block, half not.
    const nora = deriveYear([blk("nora_rs", "site1", 0.9, 0.5)]);
    expect(nora.sponsorAnesthesiaBlocks).toBeCloseTo(0.5, 10);
    expect(nora.nonProductive[0].blocks).toBeCloseTo(0.5, 10);
  });

  it("credits nothing for a research block", () => {
    const research = deriveYear([blk("research", "site1", 0, 1)]);
    expect(research.sponsorAnesthesiaBlocks).toBe(0);
    expect(research.fractionOnAnesthesia).toBe(0);
    expect(research.imeCountableShare).toBe(0);
    expect(research.nonProductive[0].reason).toBe("not patient care");
  });

  it("credits nothing to the sponsor for anesthesia at another provider", () => {
    const away = deriveYear([blk("ped_anes", "site3", 0.35)]);
    expect(away.sponsorBlocks).toBe(0);
    expect(away.sponsorAnesthesiaBlocks).toBe(0);
    expect(away.nonProductive[0].reason).toBe("anesthesia at another provider");
  });

  it("flags every block that earns the sponsor no anesthesia care", () => {
    for (const year of RESIDENCY_YEARS) {
      const flagged = derived[year].nonProductive;
      expect(flagged.length).toBeGreaterThan(0);
      for (const item of flagged) expect(item.reason).toBeTruthy();
    }
    // The intern year is almost entirely non-productive to the sponsor: one
    // anesthesia block out of thirteen.
    expect(derived.PGY1.sponsorAnesthesiaBlocks).toBeCloseTo(1, 6);
  });

  it("derives zero rather than NaN from an empty year", () => {
    const empty = deriveYear([]);
    expect(empty.sponsorSiteShare).toBe(0);
    expect(empty.fractionOnAnesthesia).toBe(0);
    expect(empty.imeCountableShare).toBe(0);
  });

  it("classifies every rotation and site on the menu", () => {
    for (const r of ROTATIONS) expect(r.label.length).toBeGreaterThan(0);
    for (const s of SITES) {
      expect(s.sponsorShare).toBeGreaterThanOrEqual(0);
      expect(s.sponsorShare).toBeLessThanOrEqual(1);
    }
  });
});

describe("The schedule overrides asserted fractions", () => {
  it("replaces the stored clinical fractions wherever a schedule exists", () => {
    const resolved = applyScheduleToClinical(DEFAULT_INPUTS);
    const derived = deriveSchedule(DEFAULT_INPUTS.blockSchedule);
    for (const year of RESIDENCY_YEARS) {
      expect(resolved.clinical[year].sponsorSiteShare).toBeCloseTo(
        derived[year].sponsorSiteShare,
        10
      );
      // …and leaves everything else alone.
      expect(resolved.clinical[year].dutyHoursPerWeek).toBe(
        DEFAULT_INPUTS.clinical[year].dutyHoursPerWeek
      );
    }
  });

  it("is idempotent, so resolving twice cannot compound", () => {
    const once = applyScheduleToClinical(DEFAULT_INPUTS);
    const twice = applyScheduleToClinical(once);
    expect(twice.clinical).toEqual(once.clinical);
  });

  it("drives the model: keeping residents home would transform the answer", () => {
    const asScheduled = runModel(DEFAULT_INPUTS).summary.npv;
    const ifTheyStayedHome = runModel({
      ...DEFAULT_INPUTS,
      blockSchedule: Object.fromEntries(
        RESIDENCY_YEARS.map((year) => [
          year,
          Array.from({ length: BLOCKS_PER_YEAR }, () => blk("anes", "site1", 0.2)),
        ])
      ) as typeof DEFAULT_INPUTS.blockSchedule,
    }).summary.npv;

    expect(asScheduled).toBeLessThan(0);
    expect(ifTheyStayedHome).toBeGreaterThan(asScheduled);
    // Not a suggestion that they should — the rotations are accreditation
    // requirements. It is the size of what the sponsor is funding and not
    // receiving, which is the question the block diagram exists to answer.
  });
});
