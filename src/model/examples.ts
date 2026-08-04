/**
 * Real block schedules, shipped as examples rather than as defaults.
 *
 * The model's own defaults are deliberately generic. A program's block diagram
 * is the most program-specific thing in the whole tool, and baking one in would
 * quietly make every other user's answer wrong. These are here to be LOADED and
 * then edited, and to show what a real one looks like — including the parts a
 * generic schedule never shows: satellites sharing a CCN, an affiliated group
 * splitting a program between two health systems, and required rotations that
 * necessarily leave the sponsoring group.
 */

import { blk, type BlockSchedule, type TrainingSite } from "./schedule";

export interface ExampleProgram {
  id: string;
  label: string;
  description: string;
  sites: TrainingSite[];
  blockSchedule: BlockSchedule;
}

/**
 * Creighton University SOM Phoenix / Valleywise Health, ACGME block diagram v2
 * (15 Aug 2024), transcribed verbatim including the diagram's own "% Outpatient"
 * and "% Research" rows.
 *
 * Worth loading for what it demonstrates rather than for its numbers:
 *
 *  - Valleywise and its Peoria comprehensive health center share CCN 030253, so
 *    Peoria is the SAME Medicare provider, not an away rotation. Only the CCNs
 *    reveal that; the site names suggest the opposite.
 *  - Valleywise and CommonSpirit St. Joseph's pool cap room and divide costs
 *    through the Creighton Health Alliance — a Medicare GME affiliated group
 *    (42 CFR 413.79(f)). Read against either hospital alone the senior years
 *    look catastrophic; read against the group they are unremarkable.
 *  - The pediatric blocks at Phoenix Children's genuinely do leave the group,
 *    and are required for accreditation. That combination — necessary and
 *    unrecoverable — is the honest shape of the problem.
 *
 * Elective blocks are entered where the diagram says "Site 1/1P/2/2B/3" and
 * "0-100%": a range, not a figure, taken at its midpoint. Those are guesses.
 */
export const CREIGHTON_PHOENIX: ExampleProgram = {
  id: "creighton_phoenix",
  label: "Creighton Phoenix / Valleywise Health",
  description:
    "A two-health-system affiliated group with a satellite sharing the sponsor's CCN, and required pediatric training outside the group.",
  sites: [
    {
      id: "site1",
      label: "Site 1 — Valleywise Health Medical Center",
      ccn: "030253",
      sponsorShare: 1,
      inAlliance: true,
    },
    {
      id: "site1p",
      label: "Site 1P — Valleywise Comprehensive Health Center, Peoria",
      ccn: "030253",
      sponsorShare: 1,
      inAlliance: true,
      note: "Shares Valleywise's CCN — the same Medicare provider, though an outpatient setting.",
    },
    {
      id: "site2",
      label: "Site 2 — St. Joseph's Hospital & Medical Center (CommonSpirit)",
      ccn: "039598",
      sponsorShare: 1,
      inAlliance: true,
      note: "An alliance member: its own CCN and cap, but it contributes cap room and shares costs.",
    },
    {
      id: "site2b",
      label: "Site 2B — Barrow Neurological Institute at St. Joseph's",
      ccn: "039598",
      sponsorShare: 1,
      inAlliance: true,
      note: "Same CCN as Site 2 — one provider, inside the alliance.",
    },
    {
      id: "site3",
      label: "Site 3 — Phoenix Children's Hospital",
      ccn: "038015",
      sponsorShare: 0,
      inAlliance: false,
      note: "Outside the alliance: coverage and Medicare FTE here accrue to Phoenix Children's.",
    },
    {
      id: "elective",
      label: "Elective — any approved site",
      ccn: null,
      sponsorShare: 0.8,
      inAlliance: true,
      note: "Four of the five approved sites are alliance members. 0.8 is a placeholder.",
    },
  ],
  blockSchedule: {
    PGY1: [
      blk("ccm_sicu", "site1", 0.0),
      blk("ccm_sicu", "site1", 0.0),
      blk("em", "site1", 1.0),
      blk("em", "site1", 1.0),
      blk("im", "site1", 0.0),
      blk("gen_surg", "site1", 0.35),
      blk("anes", "site1", 0.35),
      blk("cardio", "site1", 0.0),
      blk("peds", "site1", 0.25),
      blk("im", "site2", 0.0),
      blk("gen_surg", "site2", 0.2),
      blk("neuro_anes", "site2b", 0.9),
      blk("research", "elective", 0.0, 1.0),
    ],
    PGY2: [
      blk("preop_pacu", "site1", 0.35),
      blk("anes", "site1", 0.35),
      blk("anes", "site1", 0.35),
      blk("acute_pain_ra", "site1", 0.4),
      blk("peds_gs_anes", "site1", 0.35),
      blk("peds_gs_anes", "site1", 0.35),
      blk("ob_anes", "site1", 0.02),
      blk("pocus_tee", "site1", 0.2),
      blk("ccm_sicu", "site2", 0.0),
      blk("ccm_sicu", "site2", 0.0),
      blk("neuro_anes", "site2b", 0.05),
      blk("elect_pto", "elective", 0.5, 0.5),
      blk("elect_pto", "elective", 0.5, 0.5),
    ],
    PGY3: [
      blk("nora_rs", "site1", 0.9, 0.5),
      blk("burn_tr", "site1", 0.2),
      blk("chronic_pain", "site1p", 1.0),
      blk("ob_anes", "site2", 0.02),
      blk("ct_anes", "site2", 0.1),
      blk("ct_vasc", "site2", 0.1),
      blk("acute_pain_ra", "site2", 0.4),
      blk("ccm_sicu", "site2", 0.0),
      blk("ccm_sicu", "site2", 0.0),
      blk("transpl", "site2", 0.0),
      blk("neuro_anes", "site2b", 0.05),
      blk("ped_anes", "site3", 0.35),
      blk("ped_anes", "site3", 0.35),
    ],
    PGY4: [
      blk("pract_mgt", "site1", 0.35),
      blk("amb_anes", "site1p", 1.0),
      blk("chronic_pain", "site1p", 1.0),
      blk("burn_tr", "site2", 0.2),
      blk("nora_vasc", "site2", 0.9),
      blk("ct_anes", "site2", 0.1),
      blk("echo", "site2", 0.0),
      blk("ob_anes", "site2", 0.02),
      blk("neuro_anes", "site2b", 0.05),
      blk("ped_anes", "site3", 0.35),
      blk("ped_anes", "site3", 0.35),
      blk("elect_pto", "elective", 0.5, 0.5),
      blk("elect_pto", "elective", 0.5, 0.5),
    ],
  },
};

export const EXAMPLE_PROGRAMS: ExampleProgram[] = [CREIGHTON_PHOENIX];
