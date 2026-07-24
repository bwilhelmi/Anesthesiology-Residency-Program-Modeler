/**
 * Typed access to the per-hospital Medicare GME reference dataset.
 *
 * The data is built by scripts/build-gme-dataset.mjs from CMS's HCRIS cost
 * reports (Form CMS-2552-10, FY2022) and the Hospital Provider Cost Report
 * Public Use File. See data/gme/README.md for provenance and the worksheet
 * cell map. Every figure is a hospital's own reported cost-report value; a
 * `null` means the hospital did not report that figure — nothing is imputed.
 */

import raw from "../data/gmeHospitals.json";
import medicaidAZ from "../data/medicaidGmeAZ.json";
import medicaidFL from "../data/medicaidGmeFL.json";
import medicaidNJ from "../data/medicaidGmeNJ.json";
import medicaidUT from "../data/medicaidGmeUT.json";
import medicaidMN from "../data/medicaidGmeMN.json";
import stateProfiles from "../data/medicaidStateProfiles.json";

export interface GmeHospital {
  /** CMS Certification Number (Medicare provider number), zero-padded to 6. */
  ccn: string;
  name: string;
  city: string;
  state: string;
  /** Number of beds (from the PUF), or null if not reported. */
  beds: number | null;
  /** HCRIS fiscal-year file the selected report came from. */
  reportYear: number;
  fiscalYearBegin: string;
  fiscalYearEnd: string;
  reportStatus: string;
  /** True when the selected report is settled (with or without audit). */
  settled: boolean;
  /** Unweighted Medicare direct-GME/IME resident FTE cap (Wksht E-4, line 6). */
  capFte: number | null;
  /** Actual unweighted resident FTE in the cost-report year (Wksht E-4, line 5). */
  actualFte: number | null;
  /** capFte - actualFte when both are known; the unused cap "space". */
  headroomFte: number | null;
  /** Total Medicare Direct GME payment for the year (Wksht E-4, line 48). */
  dgmePayment: number | null;
  /** Total Medicare IME payment for the year (Wksht E Part A, line 29). */
  imePayment: number | null;
  /** Per-Resident Amount, primary-care (Wksht E-4, line 18, col 1). */
  praPrimaryCare: number | null;
  /** Per-Resident Amount, non-primary (Wksht E-4, line 18, col 2). */
  praNonPrimary: number | null;
  /** State Medicaid Direct GME payment for the academic year, or null. */
  medicaidDgme: number | null;
  /** State Medicaid Indirect GME payment for the academic year, or null. */
  medicaidIme: number | null;
  /** State Medicaid total GME payment (split sum, or a combined published figure), or null. */
  medicaidTotal: number | null;
  /** Academic year of the Medicaid figures, or null. */
  medicaidYear: number | null;
  /** State Medicaid program name (e.g. "AHCCCS (Arizona Medicaid)"), or null. */
  medicaidProgram: string | null;
  /** What the Medicaid figure represents (e.g. combined, or direct-only), or null. */
  medicaidNote: string | null;
  /** Link to the state's per-hospital Medicaid GME source, or null. */
  medicaidSourceUrl: string | null;
}

export interface GmeDatasetMeta {
  source: string;
  yearsConsidered: number[];
  selection: string;
  note: string;
  hospitalCount: number;
  settledCount: number;
}

const dataset = raw as { meta: GmeDatasetMeta; hospitals: GmeHospital[] };

/**
 * State Medicaid GME sources, keyed by CCN. Each entry attaches state Medicaid GME
 * payments onto the matching Medicare hospital record. States differ in what they
 * publish: AZ splits direct/indirect, FL publishes its direct (SMRP) program only,
 * NJ publishes a single combined total. A per-hospital entry may therefore carry
 * any of medicaidDgme / medicaidIme / medicaidTotal; the total is derived when a
 * source gives only a split. Add a state by importing its `medicaidGme<ST>.json`
 * and pushing it here.
 */
type MedicaidEntry = { medicaidDgme?: number; medicaidIme?: number; medicaidTotal?: number };
type MedicaidFile = {
  meta: { program: string; academicYear: number; note?: string; sourceUrl?: string };
  byCcn: Record<string, MedicaidEntry>;
};
const MEDICAID_SOURCES: MedicaidFile[] = [
  medicaidAZ as MedicaidFile,
  medicaidFL as MedicaidFile,
  medicaidNJ as MedicaidFile,
  medicaidUT as MedicaidFile,
  medicaidMN as MedicaidFile,
];

type MergedMedicaid = {
  medicaidDgme: number | null;
  medicaidIme: number | null;
  medicaidTotal: number;
  medicaidYear: number;
  medicaidProgram: string;
  medicaidNote: string | null;
  medicaidSourceUrl: string | null;
};
const medicaidByCcn = new Map<string, MergedMedicaid>();
for (const src of MEDICAID_SOURCES) {
  for (const [ccn, v] of Object.entries(src.byCcn)) {
    const total = v.medicaidTotal ?? (v.medicaidDgme ?? 0) + (v.medicaidIme ?? 0);
    medicaidByCcn.set(ccn, {
      medicaidDgme: v.medicaidDgme ?? null,
      medicaidIme: v.medicaidIme ?? null,
      medicaidTotal: total,
      medicaidYear: src.meta.academicYear,
      medicaidProgram: src.meta.program,
      medicaidNote: src.meta.note ?? null,
      medicaidSourceUrl: src.meta.sourceUrl ?? null,
    });
  }
}

export const GME_META: GmeDatasetMeta = dataset.meta;
export const GME_HOSPITALS: GmeHospital[] = dataset.hospitals.map((h) => {
  const m = medicaidByCcn.get(h.ccn);
  return {
    ...h,
    medicaidDgme: m?.medicaidDgme ?? null,
    medicaidIme: m?.medicaidIme ?? null,
    medicaidTotal: m?.medicaidTotal ?? null,
    medicaidYear: m?.medicaidYear ?? null,
    medicaidProgram: m?.medicaidProgram ?? null,
    medicaidNote: m?.medicaidNote ?? null,
    medicaidSourceUrl: m?.medicaidSourceUrl ?? null,
  };
});

/** Distinct two-letter state codes present, sorted. */
export const GME_STATES: string[] = Array.from(
  new Set(GME_HOSPITALS.map((h) => h.state).filter(Boolean)),
).sort();

/** Hospitals in a given state (or all when state is ""), sorted by name. */
export function hospitalsInState(state: string): GmeHospital[] {
  const list = state ? GME_HOSPITALS.filter((h) => h.state === state) : GME_HOSPITALS;
  return [...list].sort((a, b) => a.name.localeCompare(b.name));
}

export function hospitalByCcn(ccn: string): GmeHospital | undefined {
  return GME_HOSPITALS.find((h) => h.ccn === ccn);
}

/**
 * A state's Medicaid GME funding profile — shown when a hospital has no
 * per-hospital Medicaid figure, so a program director still gets the state's
 * mechanism, what public data exists, any state-level total, and a source link.
 */
export interface MedicaidStateProfile {
  state: string;
  stateName: string;
  /** Whether the state Medicaid program pays GME; null when not established (e.g. territories). */
  paysMedicaidGme: boolean | null;
  recognizesDirect: boolean | null;
  recognizesIndirect: boolean | null;
  mechanism: string;
  perHospitalDataAvailable: boolean;
  perHospitalDataUrl: string | null;
  aggregateAnnualGmeUsd: number | null;
  aggregateYear: number | null;
  summary: string;
  sourceName: string;
  sourceUrl: string;
}

const STATE_PROFILES = (stateProfiles as { profiles: Record<string, MedicaidStateProfile> })
  .profiles;

/** The Medicaid GME funding profile for a two-letter state code, if we have one. */
export function medicaidStateProfile(state: string): MedicaidStateProfile | undefined {
  return STATE_PROFILES[state];
}
