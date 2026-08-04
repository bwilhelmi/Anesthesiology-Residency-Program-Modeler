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
   * Share of this site's time that accrues to the SPONSORING GROUP — which is
   * not necessarily one hospital. 1 for a member provider, 0 for an outside
   * one. An "anywhere" elective is a genuine unknown and carries a placeholder.
   */
  sponsorShare: number;
  /**
   * Whether this provider is inside the sponsoring group: a Medicare GME
   * affiliated group pooling FTE cap room across its members and sharing the
   * program's costs between them (42 CFR 413.79(f)).
   */
  inAlliance: boolean;
  note?: string;
}

/**
 * A generic starting set of sites, meant to be renamed rather than used as-is.
 * Sites are DATA on the model inputs, not a fixed list in code, because the
 * only universal thing about them is the question they answer: does this block
 * accrue to whoever is paying for the program?
 *
 * Two distinctions carry all the weight and are easy to conflate:
 *
 *   CCN — which Medicare provider the block belongs to. Two sites sharing a CCN
 *   (a hospital and its provider-based outpatient center) are ONE provider with
 *   one cap, one per-resident amount, one bed count.
 *
 *   ALLIANCE — whether that provider is inside the sponsoring group. Under a
 *   Medicare GME affiliated group (42 CFR 413.79(f)), separate hospitals pool
 *   FTE cap room and divide the program's costs, so a block at a partner is not
 *   lost to a stranger even though it is a different provider.
 */
export const DEFAULT_SITES: TrainingSite[] = [
  {
    id: "sponsor",
    label: "Sponsor hospital",
    ccn: null,
    sponsorShare: 1,
    inAlliance: true,
  },
  {
    id: "sponsor_outpatient",
    label: "Sponsor outpatient center (same CCN)",
    ccn: null,
    sponsorShare: 1,
    inAlliance: true,
    note: "A provider-based clinic sharing the sponsor's CCN — the same Medicare provider, not an away rotation.",
  },
  {
    id: "alliance_partner",
    label: "Alliance partner hospital (own CCN)",
    ccn: null,
    sponsorShare: 1,
    inAlliance: true,
    note: "A separate Medicare provider inside the sponsoring group: its own cap and per-resident amount, but it shares the program's costs.",
  },
  {
    id: "participating",
    label: "Participating site outside the group",
    ccn: null,
    sponsorShare: 0,
    inAlliance: false,
    note: "Coverage and Medicare FTE here accrue to that hospital, not to the sponsoring group.",
  },
  {
    id: "elective",
    label: "Elective — any approved site",
    ccn: null,
    sponsorShare: 0.5,
    inAlliance: true,
    note: "An elective may be taken anywhere approved. Set the share your residents actually take inside the sponsoring group.",
  },
];

/** Look a site up in a program's own site list. */
export function site(id: string, sites: TrainingSite[] = DEFAULT_SITES): TrainingSite | undefined {
  return sites.find((s) => s.id === id);
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
  { id: "or_nora", label: "NORA — Non-operating-room anesthesia", kind: "anesthesia" },
  { id: "or_night", label: "Night float / in-house call", kind: "anesthesia" },
  { id: "or_ambulatory", label: "Ambulatory / outpatient anesthesia", kind: "anesthesia" },
  { id: "or_trauma", label: "Trauma / vascular anesthesia", kind: "anesthesia" },

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
  sites: TrainingSite[] = DEFAULT_SITES,
  imeOutpatientCountability: number = IME_OUTPATIENT_COUNTABILITY
): ScheduleBreakdown {
  let sponsorBlocks = 0;
  let sponsorAnesthesia = 0;
  let sponsorImeCountable = 0;
  const nonProductive = new Map<string, { blocks: number; reason: string }>();

  for (const block of yearBlocks) {
    const def = rotation(block.rotationId);
    const s = site(block.siteId, sites);
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
  sites: TrainingSite[] = DEFAULT_SITES,
  imeOutpatientCountability?: number
): Record<ResidencyYear, ScheduleBreakdown> {
  const out = {} as Record<ResidencyYear, ScheduleBreakdown>;
  for (const year of RESIDENCY_YEARS) {
    out[year] = deriveYear(schedule[year] ?? [], sites, imeOutpatientCountability);
  }
  return out;
}

/** Schedule problems worth surfacing: short years, unknown rotations or sites. */
export function scheduleWarnings(
  schedule: BlockSchedule,
  sites: TrainingSite[] = DEFAULT_SITES
): string[] {
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
    const unknownSite = yearBlocks.filter((b) => !site(b.siteId, sites)).length;
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
    sites?: TrainingSite[];
  },
  C extends DerivedYearParams,
>(inputs: T): T {
  if (!inputs.blockSchedule) return inputs;
  const derived = deriveSchedule(inputs.blockSchedule, inputs.sites ?? DEFAULT_SITES);
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

/* ---------------------------- Alliance membership ------------------------- */

/**
 * The distinct Medicare providers inside the sponsoring group that this
 * schedule actually uses, by CCN.
 *
 * More than one means the model is pricing an AFFILIATED GROUP rather than a
 * hospital, and every Medicare input it holds — cap, per-resident amount, bed
 * count, IME base — is a single-provider field standing in for several.
 */
export function allianceProviders(
  schedule: BlockSchedule,
  sites: TrainingSite[] = DEFAULT_SITES
): string[] {
  const ccns = new Set<string>();
  for (const year of RESIDENCY_YEARS) {
    for (const block of schedule[year] ?? []) {
      const s = site(block.siteId, sites);
      if (s?.inAlliance && s.ccn) ccns.add(s.ccn);
    }
  }
  return [...ccns].sort();
}

/* ------------------------ ACGME clinical requirements --------------------- */

/**
 * Minimum clinical experiences an anesthesiology program must provide to be
 * accredited.
 *
 * This exists because a block schedule is not only an economic document. Blocks
 * that earn the sponsoring hospital nothing are often blocks the program CANNOT
 * DROP: the pediatric months at a children's hospital leak coverage precisely
 * because the sponsor has no pediatric case mix, and removing them would cost
 * the program its accreditation. A model that flags them as waste without
 * saying they are required invites exactly the wrong conclusion.
 *
 * SOURCE AND CAVEAT. The categories below follow the ACGME Program Requirements
 * for Graduate Medical Education in Anesthesiology (see the bibliography entry).
 * The minimums are expressed in 4-week blocks across the whole program and are
 * a STARTING POINT TO VERIFY, not a compliance determination — the requirements
 * are revised, several are stated as case minimums rather than durations, and
 * some programs satisfy them through longitudinal experience rather than whole
 * blocks. Check the current document, and edit these to match it.
 *
 * // TODO(source) — reconcile each minimum against the current Program
 * // Requirements revision before presenting any of this as a compliance check.
 */
export interface AccreditationRequirement {
  id: string;
  label: string;
  /** Rotation ids that count toward this requirement. */
  satisfiedBy: string[];
  /** Minimum 4-week blocks across the whole program. */
  minBlocks: number;
  note?: string;
}

export const ACGME_ANESTHESIOLOGY_REQUIREMENTS: AccreditationRequirement[] = [
  {
    id: "obstetric",
    label: "Obstetric anesthesia",
    satisfiedBy: ["ob_anes"],
    minBlocks: 2,
  },
  {
    id: "pediatric",
    label: "Pediatric anesthesia",
    satisfiedBy: ["ped_anes", "peds_gs_anes"],
    minBlocks: 2,
    note: "Frequently served at a children's hospital outside the sponsoring group, which is why it shows up as leakage that cannot be removed.",
  },
  {
    id: "cardiac",
    label: "Cardiothoracic anesthesia",
    satisfiedBy: ["ct_anes", "ct_vasc"],
    minBlocks: 2,
  },
  {
    id: "neuro",
    label: "Neuroanesthesia",
    satisfiedBy: ["neuro_anes"],
    minBlocks: 2,
  },
  {
    id: "criticalcare",
    label: "Critical care medicine",
    satisfiedBy: ["ccm_sicu"],
    minBlocks: 4,
    note: "Delivers value to the host ICU rather than anesthesia coverage, so it reads as non-productive in the block flags while being required.",
  },
  {
    id: "pain_acute",
    label: "Acute pain / regional anesthesia",
    satisfiedBy: ["acute_pain_ra"],
    minBlocks: 3,
  },
  {
    id: "pain_chronic",
    label: "Chronic pain medicine",
    satisfiedBy: ["chronic_pain"],
    minBlocks: 1,
  },
  {
    id: "preanesthesia",
    label: "Preanesthesia evaluation / PACU",
    satisfiedBy: ["preop_pacu"],
    minBlocks: 1,
  },
];

export interface RequirementStatus extends AccreditationRequirement {
  /** Blocks scheduled across all four years, wherever they are served. */
  scheduledBlocks: number;
  met: boolean;
}

/**
 * Check a schedule against the accreditation minimums. Blocks count wherever
 * they are served: a requirement met at a participating site is still met, even
 * though it earns the sponsoring group no coverage.
 */
export function checkAccreditation(
  schedule: BlockSchedule,
  requirements: AccreditationRequirement[] = ACGME_ANESTHESIOLOGY_REQUIREMENTS
): RequirementStatus[] {
  const counts = new Map<string, number>();
  for (const year of RESIDENCY_YEARS) {
    for (const block of schedule[year] ?? []) {
      counts.set(block.rotationId, (counts.get(block.rotationId) ?? 0) + 1);
    }
  }
  return requirements.map((req) => {
    const scheduledBlocks = req.satisfiedBy.reduce(
      (sum, id) => sum + (counts.get(id) ?? 0),
      0
    );
    return { ...req, scheduledBlocks, met: scheduledBlocks >= req.minBlocks };
  });
}

/** One warning per unmet requirement, naming the shortfall. */
export function accreditationWarnings(
  schedule: BlockSchedule,
  requirements?: AccreditationRequirement[]
): string[] {
  return checkAccreditation(schedule, requirements)
    .filter((r) => !r.met)
    .map(
      (r) =>
        `Accreditation: ${r.label} has ${r.scheduledBlocks} of ${r.minBlocks} required ` +
        `blocks scheduled across the four years. Verify against the current ACGME ` +
        `Program Requirements — this model's minimums are a starting point, not a ` +
        `compliance determination.`
    );
}
