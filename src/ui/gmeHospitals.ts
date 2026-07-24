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

export const GME_META: GmeDatasetMeta = dataset.meta;
export const GME_HOSPITALS: GmeHospital[] = dataset.hospitals;

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
