/**
 * build-medicaid-fl.mjs — Florida Medicaid GME per-hospital (SMRP).
 *
 * SOURCE: Florida AHCA — Statewide Medicaid Residency Program (SMRP) SFY2023-24
 * Reconciliation Calculation (per-hospital PDF).
 *   data/gme/fl-source/SMRP_SFY23-24_Reconciliation.pdf
 *   https://ahca.myflorida.com/file/medicaid/SFY%2023-24%20SMRP%20Reconciliation%20Calculation.pdf
 *
 * SMRP is Florida's DIRECT, resident-FTE-based Medicaid GME program. Each hospital
 * carries its Final Reconciled Distribution as `medicaidDgme`. The extracted column
 * is validated by requiring the matched+unmatched sum to equal the published SMRP
 * total ($190,301,308). Florida's separate Medicaid IME program is NOT included
 * here (no per-hospital file ingested), so `medicaidIme` is null and the note says so.
 *
 * The worksheet is wide; per row the Final Reconciled Distribution is the 10th
 * numeric token (index 9) after the hospital name, present only on rows that carry
 * the percentage allocation columns. Startup rows without a baseline (Final
 * Reconciled Distribution = $0) are left without a figure.
 *
 *   node scripts/build-medicaid-fl.mjs   (requires pdftotext on PATH)
 */

import { execFileSync } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const PDF = join(ROOT, "data", "gme", "fl-source", "SMRP_SFY23-24_Reconciliation.pdf");
const OUT = join(ROOT, "src", "data", "medicaidGmeFL.json");
const SOURCE_URL =
  "https://ahca.myflorida.com/file/medicaid/SFY%2023-24%20SMRP%20Reconciliation%20Calculation.pdf";
const PUBLISHED_TOTAL = 190301308;

function norm(s) {
  return s
    .toUpperCase()
    .replace(/\(.*?\)/g, "")
    .replace(/&/g, " AND ")
    .replace(/[^A-Z0-9 ]/g, " ")
    .replace(/MEDICAL CENTER|MED CENTER|MED CTR/g, "MC")
    .replace(/HOSPITAL/g, "HOSP")
    .replace(/UNIVERSITY|UNIV/g, "U")
    .replace(/REGIONAL|REGL/g, "REG")
    .replace(/GENERAL/g, "GEN")
    .replace(/\b(THE|INC|LLC|DBA|AND|OF|CAMPUS|SYSTEM|HEALTH|CARE|FLORIDA|FL)\b/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

const OVERRIDE = {
  "Ascension St. Vincent's Riverside": "100040",
  "Ascension-Sacred Heart Health System": "100025",
  "Bethesda Hospital East": "100002",
  "Cleveland Clinic Hospital-Weston": "100289",
  "Community Health of South Florida": null, // FQHC, not in the acute-teaching set
  "Florida Department of Health": null, // not a hospital ($0)
  "Halifax Hospital Medical Center": "100017",
  "HCA Florida JFK Hopsital": "100080",
  "HCA Florida Memorial Hospital": "100179",
  "HCA Florida Osceola Hospital": "100110",
  "HCA Florida St Petersburg Hospital": "100180",
  "HCA Florida Trinity Hospital": "100191",
  "HCA Florida West Hospital": "100231",
  "Jackson Health System": "100022",
  "Johns Hopkins All Childrens Hospital": "103300",
  "Larkin Community Hospital Palm Springs Campus LLC": "100050",
  "Mount Sinai Medical Center": "100034",
  "Nemours Children's Hospital": "103304",
  "Nicklaus Children's Hospital": "103301",
  "Shands Jacksonville Medical Center DBA UF Health Jacksonville": "100001",
  "St. Joseph's Hospital": "100075",
  "St. Mary's Medical Center": "100288",
  "Tallahassee Memorial Healthcare": "100135",
};

const med = JSON.parse(readFileSync(join(ROOT, "src", "data", "gmeHospitals.json"), "utf8"));
const normMap = new Map();
for (const h of med.hospitals) if (h.state === "FL") normMap.set(norm(h.name), h.ccn);
const overrideNorm = new Map(Object.entries(OVERRIDE).map(([k, v]) => [norm(k), v]));

const text = execFileSync("pdftotext", ["-layout", PDF, "-"]).toString("utf8");
const rows = [];
for (const line of text.split(/\r?\n/)) {
  if (!/^\d+\s/.test(line)) continue;
  const idm = /\b(\d{9})\b/.exec(line);
  if (!idm) continue;
  const after = line.slice(idm.index + idm[0].length);
  const toks = after.match(/\$[\d,]+\.?\d*|\d+\.\d+%|\d+\.\d+/g) || [];
  const first = /\$[\d,]|\d+\.\d+/.exec(after);
  const name = (first ? after.slice(0, first.index) : after).trim();
  const hasPct = toks.some((t) => t.includes("%"));
  let dgme = null;
  if (hasPct && toks.length >= 10 && toks[9].startsWith("$")) {
    dgme = Number(toks[9].slice(1).replace(/,/g, "").split(".")[0]);
  }
  rows.push({ name, dgme });
}

const byCcn = {};
const unmatched = [];
let dropped = 0;
for (const r of rows) {
  if (r.dgme == null || r.dgme === 0) { dropped++; continue; } // startup / no baseline
  const key = norm(r.name);
  const ccn = overrideNorm.has(key) ? overrideNorm.get(key) : normMap.get(key) ?? null;
  if (!ccn) { unmatched.push({ name: r.name, amount: r.dgme }); continue; }
  byCcn[ccn] = { name: r.name, medicaidDgme: r.dgme };
}

const matchedSum = Object.values(byCcn).reduce((a, b) => a + b.medicaidDgme, 0);
const unmatchedSum = unmatched.reduce((a, b) => a + b.amount, 0);
const total = matchedSum + unmatchedSum;
if (total !== PUBLISHED_TOTAL) {
  console.warn(`WARNING: extracted total $${total.toLocaleString()} != published $${PUBLISHED_TOTAL.toLocaleString()} — column mapping may be off.`);
}

const dataset = {
  meta: {
    state: "FL",
    program: "Florida Medicaid (Statewide Medicaid Residency Program, SMRP)",
    academicYear: 2024,
    split: false,
    directOnly: true,
    note: "SMRP is Florida's direct, resident-FTE-based Medicaid GME program (Final Reconciled Distribution, SFY2023-24). Florida's separate Medicaid Indirect Medical Education (IME) program is not included here, so the indirect figure is not shown.",
    source: "Florida AHCA — SFY2023-24 Statewide Medicaid Residency Program Reconciliation",
    sourceUrl: SOURCE_URL,
    hospitalCount: Object.keys(byCcn).length,
  },
  byCcn,
  unmatched: unmatched.map((u) => u.name).sort(),
};

writeFileSync(OUT, JSON.stringify(dataset, null, 2) + "\n");
console.log(`Wrote ${Object.keys(byCcn).length} FL hospitals -> ${OUT}`);
console.log(`  matched $${matchedSum.toLocaleString()} + unmatched $${unmatchedSum.toLocaleString()} = $${total.toLocaleString()} (published $${PUBLISHED_TOTAL.toLocaleString()})`);
console.log(`  startup/no-baseline rows skipped: ${dropped}`);
if (unmatched.length) console.log(`  unmatched: ${unmatched.map((u) => u.name).join(", ")}`);
