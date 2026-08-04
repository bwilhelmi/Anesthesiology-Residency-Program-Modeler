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

  it("distinguishes providers by CCN, and membership by the alliance", () => {
    // Two questions, two answers. Valleywise Peoria shares Valleywise's CCN, so
    // it is the SAME PROVIDER. St. Joseph's is a different provider entirely —
    // its own CCN, cap, and per-resident amount — but it is inside the
    // sponsoring alliance, so its blocks are not lost to a stranger.
    expect(site("site1")!.ccn).toBe(site("site1p")!.ccn);
    expect(site("site2")!.ccn).not.toBe(site("site1")!.ccn);
    expect(site("site2")!.ccn).toBe(site("site2b")!.ccn);

    for (const id of ["site1", "site1p", "site2", "site2b"]) {
      expect(site(id)!.inAlliance, id).toBe(true);
      expect(site(id)!.sponsorShare, id).toBe(1);
    }
    // Phoenix Children's is outside it, and time there does leak.
    expect(site("site3")!.inAlliance).toBe(false);
    expect(site("site3")!.sponsorShare).toBe(0);
  });
});

describe("Deriving the clinical fractions", () => {
  const derived = deriveSchedule(DEFAULT_BLOCK_SCHEDULE);

  it("keeps the senior years mostly inside the alliance", () => {
    // Read against a single hospital this schedule looks alarming — a CA-2 is
    // at Valleywise for only 3 of 13 blocks. Read against the sponsoring group
    // that actually pays for the program, most of it stays home: what leaves is
    // the pediatric time at Phoenix Children's.
    for (const year of RESIDENCY_YEARS) {
      expect(derived[year].sponsorSiteShare).toBeGreaterThan(0.8);
    }
    // The CA-2 and CA-3 pediatric blocks are the real leakage, two each.
    expect(derived.PGY3.sponsorBlocks).toBeCloseTo(11, 6);
    expect(derived.PGY4.sponsorBlocks).toBeGreaterThan(10);
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
    // The intern year is almost entirely non-productive even inside the
    // alliance: it is a clinical base year, and only two of its blocks are
    // anesthesia at all.
    expect(derived.PGY1.sponsorAnesthesiaBlocks).toBeLessThan(2.5);
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

    expect(ifTheyStayedHome).toBeGreaterThan(asScheduled);
    // Not a suggestion that they should — the rotations are accreditation
    // requirements. It is the size of what the sponsor is funding and not
    // receiving, which is the question the block diagram exists to answer.
  });
});
