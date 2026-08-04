import { describe, it, expect } from "vitest";
import { DEFAULT_BLOCK_SCHEDULE, DEFAULT_INPUTS } from "./constants";
import { CREIGHTON_PHOENIX, EXAMPLE_PROGRAMS } from "./examples";
import {
  ACGME_ANESTHESIOLOGY_REQUIREMENTS,
  BLOCKS_PER_YEAR,
  DEFAULT_SITES,
  ROTATIONS,
  accreditationWarnings,
  allianceProviders,
  applyScheduleToClinical,
  blk,
  checkAccreditation,
  deriveSchedule,
  deriveYear,
  rotation,
  scheduleWarnings,
  site,
} from "./schedule";
import { runModel } from "./model";
import { RESIDENCY_YEARS } from "./types";

describe("The shipped schedule is generic", () => {
  it("has 13 blocks in every training year", () => {
    for (const year of RESIDENCY_YEARS) {
      expect(DEFAULT_BLOCK_SCHEDULE[year]).toHaveLength(BLOCKS_PER_YEAR);
    }
    expect(scheduleWarnings(DEFAULT_BLOCK_SCHEDULE, DEFAULT_SITES)).toEqual([]);
  });

  it("names no real hospital, so it fits any program", () => {
    // The generic sites describe ROLES — sponsor, satellite, alliance partner,
    // outside participant — not institutions. A real diagram is loaded as an
    // example and edited; baking one in would quietly make everyone else wrong.
    for (const s of DEFAULT_SITES) {
      expect(s.ccn).toBeNull();
      expect(s.label).not.toMatch(/valleywise|joseph|barrow|phoenix|creighton/i);
    }
    for (const year of RESIDENCY_YEARS) {
      for (const block of DEFAULT_BLOCK_SCHEDULE[year]) {
        expect(site(block.siteId, DEFAULT_SITES), block.siteId).toBeDefined();
        expect(rotation(block.rotationId), block.rotationId).toBeDefined();
      }
    }
  });

  it("satisfies the accreditation minimums it ships with", () => {
    // A default that could not be accredited would be a strange thing to hand
    // someone as a starting point.
    for (const status of checkAccreditation(DEFAULT_BLOCK_SCHEDULE)) {
      expect(
        status.met,
        `${status.label}: ${status.scheduledBlocks}/${status.minBlocks}`
      ).toBe(true);
    }
    expect(accreditationWarnings(DEFAULT_BLOCK_SCHEDULE)).toEqual([]);
  });

  it("puts the pediatric requirement outside the group, as most programs must", () => {
    // The commonest real source of unavoidable leakage: a sponsor without the
    // paediatric case mix to teach it.
    const pedsAway = RESIDENCY_YEARS.flatMap((y) =>
      DEFAULT_BLOCK_SCHEDULE[y].filter(
        (b) => b.rotationId === "ped_anes" && b.siteId === "participating"
      )
    );
    expect(pedsAway.length).toBeGreaterThanOrEqual(2);
    expect(
      deriveSchedule(DEFAULT_BLOCK_SCHEDULE, DEFAULT_SITES).PGY3.sponsorSiteShare
    ).toBeLessThan(1);
  });
});

describe("Accreditation requirements", () => {
  it("counts a requirement met wherever it is served", () => {
    const away = {
      PGY1: [],
      PGY2: [],
      PGY3: Array.from({ length: 2 }, () => blk("ped_anes", "participating", 0.3)),
      PGY4: [],
    };
    const peds = checkAccreditation(away).find((r) => r.id === "pediatric")!;
    // It earns the sponsoring group nothing and is still required and satisfied.
    expect(peds.scheduledBlocks).toBe(2);
    expect(peds.met).toBe(true);
    expect(deriveYear(away.PGY3, DEFAULT_SITES).sponsorBlocks).toBe(0);
  });

  it("reports a shortfall with the count, not just a flag", () => {
    const thin = {
      PGY1: [],
      PGY2: [],
      PGY3: [blk("ob_anes", "sponsor", 0.02)],
      PGY4: [],
    };
    const ob = checkAccreditation(thin).find((r) => r.id === "obstetric")!;
    expect(ob.scheduledBlocks).toBe(1);
    expect(ob.met).toBe(false);
    const warning = accreditationWarnings(thin).find((w) => w.includes("Obstetric"));
    expect(warning).toContain("1 of 2");
    // …and says what it is not.
    expect(warning).toContain("not a compliance determination");
  });

  it("routes every requirement to rotations that exist", () => {
    const ids = new Set(ROTATIONS.map((r) => r.id));
    for (const req of ACGME_ANESTHESIOLOGY_REQUIREMENTS) {
      expect(req.satisfiedBy.length).toBeGreaterThan(0);
      for (const id of req.satisfiedBy) {
        expect(ids.has(id), `${req.id} -> ${id}`).toBe(true);
      }
      expect(req.minBlocks).toBeGreaterThan(0);
    }
  });

  it("surfaces a shortfall through the model's warnings", () => {
    const thin = {
      ...DEFAULT_INPUTS,
      blockSchedule: {
        ...DEFAULT_BLOCK_SCHEDULE,
        PGY3: Array.from({ length: BLOCKS_PER_YEAR }, () => blk("anes", "sponsor", 0.3)),
      },
    };
    expect(runModel(thin).warnings.some((w) => /^Accreditation:/.test(w))).toBe(true);
  });
});

describe("Deriving the clinical fractions", () => {
  it("splits a part-research block rather than counting it whole", () => {
    const nora = deriveYear([blk("nora_rs", "sponsor", 0.9, 0.5)], DEFAULT_SITES);
    expect(nora.sponsorAnesthesiaBlocks).toBeCloseTo(0.5, 10);
    expect(nora.nonProductive[0].blocks).toBeCloseTo(0.5, 10);
  });

  it("credits nothing for a research block", () => {
    const research = deriveYear([blk("research", "sponsor", 0, 1)], DEFAULT_SITES);
    expect(research.sponsorAnesthesiaBlocks).toBe(0);
    expect(research.imeCountableShare).toBe(0);
    expect(research.nonProductive[0].reason).toBe("not patient care");
  });

  it("credits nothing for anesthesia at a provider outside the group", () => {
    const away = deriveYear([blk("ped_anes", "participating", 0.35)], DEFAULT_SITES);
    expect(away.sponsorBlocks).toBe(0);
    expect(away.nonProductive[0].reason).toBe("anesthesia at another provider");
  });

  it("derives zero rather than NaN from an empty year", () => {
    const empty = deriveYear([], DEFAULT_SITES);
    expect(empty.sponsorSiteShare).toBe(0);
    expect(empty.fractionOnAnesthesia).toBe(0);
    expect(empty.imeCountableShare).toBe(0);
  });

  it("replaces the stored clinical fractions, idempotently", () => {
    const once = applyScheduleToClinical(DEFAULT_INPUTS);
    const derived = deriveSchedule(DEFAULT_INPUTS.blockSchedule, DEFAULT_INPUTS.sites);
    for (const year of RESIDENCY_YEARS) {
      expect(once.clinical[year].sponsorSiteShare).toBeCloseTo(
        derived[year].sponsorSiteShare,
        10
      );
      expect(once.clinical[year].dutyHoursPerWeek).toBe(
        DEFAULT_INPUTS.clinical[year].dutyHoursPerWeek
      );
    }
    expect(applyScheduleToClinical(once).clinical).toEqual(once.clinical);
  });
});

describe("Example programs", () => {
  it("ships real diagrams as examples, never as the default", () => {
    expect(EXAMPLE_PROGRAMS.length).toBeGreaterThan(0);
    for (const ex of EXAMPLE_PROGRAMS) {
      for (const year of RESIDENCY_YEARS) {
        expect(ex.blockSchedule[year], `${ex.id} ${year}`).toHaveLength(BLOCKS_PER_YEAR);
      }
      expect(scheduleWarnings(ex.blockSchedule, ex.sites)).toEqual([]);
    }
    expect(DEFAULT_INPUTS.blockSchedule).not.toEqual(CREIGHTON_PHOENIX.blockSchedule);
  });

  it("distinguishes providers by CCN and membership by the alliance", () => {
    const { sites } = CREIGHTON_PHOENIX;
    // Two different questions. The satellite shares the sponsor's CCN, so it is
    // the SAME provider; the partner has its own CCN but is inside the group.
    expect(site("site1", sites)!.ccn).toBe(site("site1p", sites)!.ccn);
    expect(site("site2", sites)!.ccn).not.toBe(site("site1", sites)!.ccn);
    expect(site("site2", sites)!.inAlliance).toBe(true);
    expect(site("site3", sites)!.inAlliance).toBe(false);
  });

  it("reads very differently against one hospital than against the group", () => {
    const { sites, blockSchedule } = CREIGHTON_PHOENIX;
    const asGroup = deriveSchedule(blockSchedule, sites);
    const asOneHospital = deriveSchedule(
      blockSchedule,
      sites.map((s) =>
        s.ccn === "030253" ? s : { ...s, sponsorShare: 0, inAlliance: false }
      )
    );
    // The same schedule, the same senior year: >0.8 to the group, <0.3 to the
    // sponsor alone. Which is right depends entirely on who is asking.
    expect(asGroup.PGY3.sponsorSiteShare).toBeGreaterThan(0.8);
    expect(asOneHospital.PGY3.sponsorSiteShare).toBeLessThan(0.3);
  });

  it("names the member providers a schedule actually uses", () => {
    expect(
      allianceProviders(CREIGHTON_PHOENIX.blockSchedule, CREIGHTON_PHOENIX.sites)
    ).toEqual(["030253", "039598"]);
    // The generic default has no CCNs entered, so it claims no providers.
    expect(allianceProviders(DEFAULT_BLOCK_SCHEDULE, DEFAULT_SITES)).toEqual([]);
  });

  it("warns that a multi-provider group's figures are not one member's", () => {
    const loaded = {
      ...DEFAULT_INPUTS,
      sites: CREIGHTON_PHOENIX.sites,
      blockSchedule: CREIGHTON_PHOENIX.blockSchedule,
    };
    const warning = runModel(loaded).warnings.find((w) => /affiliated group/.test(w));
    expect(warning).toBeDefined();
    expect(warning).toContain("030253");
    expect(warning).toContain("039598");
    // A single-provider program says nothing of the kind.
    expect(
      runModel(DEFAULT_INPUTS).warnings.some((w) => /affiliated group/.test(w))
    ).toBe(false);
  });
});
