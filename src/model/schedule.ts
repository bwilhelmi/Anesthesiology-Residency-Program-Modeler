/**
 * The block schedule: what the residents are actually doing, block by block.
 *
 * Every version of this model until now took three fractions on faith —
 * `sponsorSiteShare`, `fractionOnAnesthesia`, `imeCountableShare` — each a
 * single number standing in for a year of rotations. That is the same mistake
 * the coverage figure made before hours were pulled out of it: a composite
 * nobody can audit, because "0.85" hides which blocks, at which hospital,
 * doing what.
 *
 * A program does not have a fraction. It has a block diagram: 13 blocks of 4
 * weeks, each a named rotation at a named site, with a known split of inpatient
 * and outpatient work and a known research share. Given that, the fractions are
 * DERIVED, and the blocks that produce no billable anesthesia care are flagged
 * rather than averaged into invisibility.
 *
 * Three things decide what a block is worth to the sponsoring hospital:
 *
 *   WHERE — Medicare FTE counts at the provider where the training occurs, and
 *   so does the coverage value. Sites are matched by CCN, not by name: a
 *   satellite sharing the sponsor's CCN is the same provider, and a hospital
 *   across town is not, however close the affiliation.
 *
 *   WHAT — anesthesia care in a staffed location displaces an anesthetist.
 *   Other patient care (critical care, pain clinic, the intern year's medicine
 *   months) delivers value to a host department. Research does neither.
 *
 *   INPATIENT OR OUT — research that is not patient care is outside
 *   IME-countable activity (42 CFR 412.105(f)). Outpatient time is treated
 *   here as reducing IME countability too, behind an explicit input, because
 *   the IME count turns on where in the provider the resident is working —
 *   see IME_OUTPATIENT_COUNTABILITY.
 */

import type { ResidencyYear } from "./types";
import { RESIDENCY_YEARS } from "./types";

/** Blocks in a training year, and weeks in a block. 13 × 4 = 52. */
export const BLOCKS_PER_YEAR = 13;
export const WEEKS_PER_BLOCK = 4;

/* --------------------------------- Sites ---------------------------------- */

export interface TrainingSite {
  id: string;
  label: string;
  /** CMS Certification Number. Sites sharing a CCN are ONE Medicare provider. */
  ccn: string | null;
  /**
   * Share of this site's time that accrues to the sponsoring hospital. 1 for
   * the sponsor's own CCN, 0 for another provider. An "anywhere" elective is a
   * genuine unknown and carries a localizable placeholder.
   */
  sponsorShare: number;
  note?: string;
}

/**
 * Training sites, from the program's block diagram. Valleywise Health Medical
 * Center is the sponsor; its Peoria comprehensive health center shares the same
 * CCN and is therefore the same Medicare provider, not an away rotation.
 */
export const SITES: TrainingSite[] = [
  {
    id: "site1",
    label: "Site 1 — Valleywise Health Medical Center",
    ccn: "030253",
    sponsorShare: 1,
  },
  {
    id: "site1p",
    label: "Site 1P — Valleywise Comprehensive Health Center, Peoria",
    ccn: "030253",
    sponsorShare: 1,
    note: "Shares the sponsor's CCN, so it is the same Medicare provider — but it is an outpatient center, which is what limits its IME countability.",
  },
  {
    id: "site2",
    label: "Site 2 — St. Joseph's Hospital & Medical Center",
    ccn: "039598",
    sponsorShare: 0,
  },
  {
    id: "site2b",
    label: "Site 2B — Barrow Neurological Institute at St. Joseph's",
    ccn: "039598",
    sponsorShare: 0,
    note: "Same CCN as Site 2 — one provider, and not the sponsor.",
  },
  {
    id: "site3",
    label: "Site 3 — Phoenix Children's Hospital",
    ccn: "038015",
    sponsorShare: 0,
  },
  {
    id: "elective",
    label: "Elective — any approved site",
    ccn: null,
    sponsorShare: 0.2,
    note: "An elective may be taken at any of the five sites or internationally. 0.2 is a placeholder — one site in five. Set it to the share your residents actually take at the sponsor.",
  },
];

const SITES_BY_ID = new Map(SITES.map((s) => [s.id, s]));
export function site(id: string): TrainingSite | undefined {
  return SITES_BY_ID.get(id);
}

/* ------------------------------- Rotations -------------------------------- */

/**
 * What kind of work a rotation is, economically.
 *
 *  - `anesthesia`      staffing an anesthetizing location; displaces an anesthetist
 *  - `patientCare`     other clinical work; host-department value, IME-countable
 *  - `nonPatientCare`  research, practice management; neither
 */
export type BlockKind = "anesthesia" | "patientCare" | "nonPatientCare";

export interface RotationDefinition {
  id: string;
  label: string;
  kind: BlockKind;
  note?: string;
}

/** The rotation menu, taken from the program's own block diagram key. */
export const ROTATIONS: RotationDefinition[] = [
  { id: "anes", label: "ANES — Anesthesia", kind: "anesthesia" },
  { id: "amb_anes", label: "AMB ANES — Ambulatory anesthesia", kind: "anesthesia" },
  { id: "ob_anes", label: "OB ANES — Obstetric anesthesiology", kind: "anesthesia" },
  { id: "peds_gs_anes", label: "PEDS/GS ANES — Pediatric / general surgery anesthesia", kind: "anesthesia" },
  { id: "ped_anes", label: "PED ANES — Pediatric anesthesia", kind: "anesthesia" },
  { id: "neuro_anes", label: "NEURO ANES — Neuroanesthesiology", kind: "anesthesia" },
  { id: "ct_anes", label: "CT ANES — Cardiothoracic anesthesia", kind: "anesthesia" },
  { id: "ct_vasc", label: "CT/VASC — Cardiothoracic / vascular anesthesia", kind: "anesthesia" },
  { id: "nora_vasc", label: "NORA/VASC — Non-OR anesthesia / vascular", kind: "anesthesia" },
  { id: "nora_rs", label: "NORA/RS — Non-OR anesthesia / research", kind: "anesthesia" },
  { id: "burn_tr", label: "BURN/TR — Burn / trauma", kind: "anesthesia" },
  { id: "transpl", label: "TRANSPL — Transplant anesthesia", kind: "anesthesia" },
  { id: "acute_pain_ra", label: "ACUTE PAIN/RA — Acute pain / regional anesthesia", kind: "anesthesia" },

  { id: "preop_pacu", label: "PREOP/PACU — Preoperative clinic / PACU", kind: "patientCare" },
  { id: "chronic_pain", label: "CHRONIC PAIN — Chronic pain medicine", kind: "patientCare" },
  { id: "ccm_sicu", label: "CCM/SICU — Critical care medicine / surgical ICU", kind: "patientCare" },
  { id: "pocus_tee", label: "POCUS/TEE — Point-of-care ultrasound / TEE", kind: "patientCare" },
  { id: "echo", label: "ECHO — Echocardiography", kind: "patientCare" },
  { id: "em", label: "EM — Emergency medicine", kind: "patientCare" },
  { id: "im", label: "IM — Internal medicine", kind: "patientCare" },
  { id: "gen_surg", label: "GEN SURG — General surgery", kind: "patientCare" },
  { id: "cardio", label: "CARDIO — Cardiology", kind: "patientCare" },
  { id: "peds", label: "PEDS — Pediatrics", kind: "patientCare" },

  {
    id: "research",
    label: "RESEARCH — Research",
    kind: "nonPatientCare",
    note: "No anesthesia coverage, and non-patient-care research is outside IME-countable activity (42 CFR 412.105(f)). It still counts toward DGME.",
  },
  {
    id: "pract_mgt",
    label: "PRACT MGT — Practice management",
    kind: "nonPatientCare",
    note: "Produces no billable clinical work.",
  },
  {
    id: "elect_pto",
    label: "ELECT/PTO — Elective / paid time off",
    kind: "anesthesia",
    note: "Elective clinical time, most often anesthesia. Paid time off is accounted separately, as weeks off across the whole year rather than as a block.",
  },
];

const ROTATIONS_BY_ID = new Map(ROTATIONS.map((r) => [r.id, r]));
export function rotation(id: string): RotationDefinition | undefined {
  return ROTATIONS_BY_ID.get(id);
}

/* -------------------------------- Blocks ---------------------------------- */

/** One four-week block. */
export interface Block {
  rotationId: string;
  siteId: string;
  /** Share of the block spent in outpatient settings, from the block diagram. */
  outpatientShare: number;
  /** Share of the block spent on research, from the block diagram. */
  researchShare: number;
}

export type BlockSchedule = Record<ResidencyYear, Block[]>;

/** Build a block: `blk("anes", "site1", 0.35)`. */
export function blk(
  rotationId: string,
  siteId: string,
  outpatientShare = 0,
  researchShare = 0
): Block {
  return { rotationId, siteId, outpatientShare, researchShare };
}

/**
 * How much of a resident's OUTPATIENT time at the sponsoring provider counts
 * toward the IME resident FTE.
 *
 * The IME count turns on where in the provider the resident is working, and
 * outpatient departments are treated differently from inpatient areas. The
 * model exposes this as a single fraction rather than asserting a rule:
 * 0 excludes outpatient time from IME entirely, 1 counts it in full.
 *
 * Defaults to 1 — counting outpatient time in full — deliberately, because
 * excluding it would be a large cut resting on a rule this model has not
 * verified. Set it to 0 to model the stricter reading.
 *
 * // TODO(source) — confirm the treatment of provider-based outpatient
 * // departments against 42 CFR 412.105(f) and the current IPPS rule. DGME
 * // countability of this time is not affected either way.
 */
export const IME_OUTPATIENT_COUNTABILITY = 1;

/* ------------------------------- Derivation ------------------------------- */

export interface DerivedYearParams {
  sponsorSiteShare: number;
  fractionOnAnesthesia: number;
  imeCountableShare: number;
}

export interface ScheduleBreakdown extends DerivedYearParams {
  totalBlocks: number;
  /** Block-equivalents at the sponsoring provider, after site sponsor shares. */
  sponsorBlocks: number;
  /** Sponsor block-equivalents delivering anesthesia care, net of research. */
  sponsorAnesthesiaBlocks: number;
  /** Blocks earning the sponsor no billable anesthesia care, and why. */
  nonProductive: { label: string; blocks: number; reason: string }[];
}

/**
 * Derive a year's clinical fractions from its blocks.
 *
 * Blocks are weighted rather than counted: a site contributes its sponsorShare,
 * and a block's research share is removed from the clinical work it would
 * otherwise represent. NORA/RS at 50% research is half a research block, and
 * counting it whole either way would be wrong.
 */
export function deriveYear(
  yearBlocks: Block[],
  imeOutpatientCountability: number = IME_OUTPATIENT_COUNTABILITY
): ScheduleBreakdown {
  let sponsorBlocks = 0;
  let sponsorAnesthesia = 0;
  let sponsorImeCountable = 0;
  const nonProductive = new Map<string, { blocks: number; reason: string }>();

  for (const block of yearBlocks) {
    const def = rotation(block.rotationId);
    const s = site(block.siteId);
    const sponsorShare = clamp01(s?.sponsorShare ?? 0);
    const research = clamp01(block.researchShare);
    const outpatient = clamp01(block.outpatientShare);
    const kind = def?.kind ?? "nonPatientCare";

    const atSponsor = sponsorShare;
    sponsorBlocks += atSponsor;

    // Clinical share of the block: whatever is not research.
    const clinical = 1 - research;
    if (kind === "anesthesia") sponsorAnesthesia += atSponsor * clinical;

    // IME wants patient care, and (per the input above) inpatient work.
    if (kind !== "nonPatientCare") {
      const inpatientWeight = 1 - outpatient * (1 - clamp01(imeOutpatientCountability));
      sponsorImeCountable += atSponsor * clinical * inpatientWeight;
    }

    // Anything that is not sponsor-site anesthesia care gets named.
    const productive = kind === "anesthesia" ? atSponsor * clinical : 0;
    const lost = 1 - productive;
    if (lost > 1e-9) {
      const label = def?.label ?? block.rotationId;
      const reason =
        kind === "nonPatientCare"
          ? "not patient care"
          : sponsorShare < 1 && kind === "anesthesia"
            ? "anesthesia at another provider"
            : sponsorShare < 1
              ? "off service at another provider"
              : research > 0
                ? "part research"
                : "off service";
      const prev = nonProductive.get(label);
      nonProductive.set(label, { blocks: (prev?.blocks ?? 0) + lost, reason: prev?.reason ?? reason });
    }
  }

  const total = yearBlocks.length;
  return {
    totalBlocks: total,
    sponsorBlocks,
    sponsorAnesthesiaBlocks: sponsorAnesthesia,
    nonProductive: [...nonProductive.entries()]
      .map(([label, v]) => ({ label, blocks: v.blocks, reason: v.reason }))
      .sort((a, b) => b.blocks - a.blocks || a.label.localeCompare(b.label)),
    sponsorSiteShare: total ? sponsorBlocks / total : 0,
    fractionOnAnesthesia: sponsorBlocks ? sponsorAnesthesia / sponsorBlocks : 0,
    imeCountableShare: sponsorBlocks ? sponsorImeCountable / sponsorBlocks : 0,
  };
}

/** Derive every training level at once. */
export function deriveSchedule(
  schedule: BlockSchedule,
  imeOutpatientCountability?: number
): Record<ResidencyYear, ScheduleBreakdown> {
  const out = {} as Record<ResidencyYear, ScheduleBreakdown>;
  for (const year of RESIDENCY_YEARS) {
    out[year] = deriveYear(schedule[year] ?? [], imeOutpatientCountability);
  }
  return out;
}

/** Schedule problems worth surfacing: short years, unknown rotations or sites. */
export function scheduleWarnings(schedule: BlockSchedule): string[] {
  const warnings: string[] = [];
  for (const year of RESIDENCY_YEARS) {
    const yearBlocks = schedule[year] ?? [];
    if (yearBlocks.length !== BLOCKS_PER_YEAR) {
      warnings.push(
        `${year} has ${yearBlocks.length} blocks scheduled rather than ${BLOCKS_PER_YEAR}. ` +
          `The derived shares are fractions of what is scheduled, so a short year does ` +
          `not under-count — but a block is probably missing.`
      );
    }
    const unknownRotation = yearBlocks.filter((b) => !rotation(b.rotationId)).length;
    const unknownSite = yearBlocks.filter((b) => !site(b.siteId)).length;
    if (unknownRotation) {
      warnings.push(
        `${year} has ${unknownRotation} block(s) with an unrecognised rotation; they are ` +
          `treated as non-patient-care, which is the conservative reading.`
      );
    }
    if (unknownSite) {
      warnings.push(
        `${year} has ${unknownSite} block(s) at an unrecognised site; they are treated as ` +
          `away from the sponsor, which is the conservative reading.`
      );
    }
  }
  return warnings;
}

function clamp01(x: number): number {
  return Number.isFinite(x) ? Math.max(0, Math.min(1, x)) : 0;
}

/* --------------------------- Applying a schedule -------------------------- */

/**
 * Return the inputs with each level's clinical fractions replaced by what the
 * block schedule actually implies.
 *
 * The stored fractions are kept in the type as a fallback for callers with no
 * schedule, but whenever a schedule is present it wins — a program's diagram is
 * evidence, and a fraction typed beside it is only an opinion.
 */
export function applyScheduleToClinical<
  T extends {
    clinical: Record<ResidencyYear, C>;
    blockSchedule?: BlockSchedule;
  },
  C extends DerivedYearParams,
>(inputs: T): T {
  if (!inputs.blockSchedule) return inputs;
  const derived = deriveSchedule(inputs.blockSchedule);
  const clinical = {} as Record<ResidencyYear, C>;
  for (const year of RESIDENCY_YEARS) {
    const d = derived[year];
    clinical[year] = {
      ...inputs.clinical[year],
      sponsorSiteShare: d.sponsorSiteShare,
      fractionOnAnesthesia: d.fractionOnAnesthesia,
      imeCountableShare: d.imeCountableShare,
    };
  }
  return { ...inputs, clinical };
}
