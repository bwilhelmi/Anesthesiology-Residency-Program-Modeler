/**
 * build-medicaid-nj.mjs — New Jersey Medicaid GME per-hospital subsidy.
 *
 * SOURCE: NJ Department of Health, Health Care Subsidy Fund — SFY Graduate
 * Medical Education (GME) Subsidy Allocations (per-hospital PDF).
 *   data/gme/nj-source/SFY2025_GME_Subsidy_Allocation.pdf
 *   https://www.nj.gov/health/hcf/documents/charitycare/SFY2025_GME_Subsidy_Allocation.pdf
 *
 * NJ publishes ONE combined GME subsidy amount per hospital (it is not split into
 * direct vs indirect), so each hospital carries a `medicaidTotal` only. Amounts
 * are joined to CMS CCNs by hospital name (exact normalized match + an explicit
 * override map); consolidated/absent hospitals are reported, not guessed.
 *
 *   node scripts/build-medicaid-nj.mjs   (requires pdftotext on PATH)
 */

import { execFileSync } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const PDF = join(ROOT, "data", "gme", "nj-source", "SFY2025_GME_Subsidy_Allocation.pdf");
const OUT = join(ROOT, "src", "data", "medicaidGmeNJ.json");
const SOURCE_URL =
  "https://www.nj.gov/health/hcf/documents/charitycare/SFY2025_GME_Subsidy_Allocation.pdf";

/** Normalize a hospital name for matching (drop punctuation, unify abbreviations). */
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
    .replace(/\b(THE|INC|LLC|DBA|AND|OF|CAMPUS|SYSTEM|HEALTH|CARE)\b/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

// Explicit source-name -> CCN overrides (null = intentionally unmatched).
const OVERRIDE = {
  "Capital Health Regional Medical Center": "310092",
  "CarePoint Health - Bayonne Medical Center": "310025",
  "CarePoint Health - Christ Hospital": "310016",
  "CarePoint Health - Hoboken University Medical Center": "310040",
  "Cooper Hospital/University MC": "310014",
  "Hackensack UMC- Palisades": "310003",
  "Hackensack University MC - Mountainside": "310054",
  "Inspira Medical Center - Elmer": null, // not in the acute-teaching set
  "Jefferson Hospitals": null, // consolidated multi-campus entry; no single CCN
  "JFK Medical Center/A M Yelencsics": "310108",
  "New Bridge Medical Center": "310058",
  "Ocean Medical Center": "310052",
  "Penn Medicine Princeton Medical Center": "310010",
  "Robert Wood Johnson University Hospital": "310038",
  "RWJ University Hospital - Somerset": "310048",
  "St. Barnabas Medical Center": "310076",
  "St. Clare's Hospital - Denville": "310050",
  "St. Joseph's University Medical Center": "310019",
  "St. Luke's Warren Hospital": "310060",
  "St. Mary's General Hospital": "310006",
  "St. Michael's Medical Center": "310096",
  "St. Peter's University Hospital": "310070",
  "Trinitas Regional Medical Center": "310027",
  "University Hospital": "310119",
  "Virtua - West Jersey Health System": "310022",
  "Virtua-Mem. Hospital of Burlington County": "310057",
};

// CCN -> Medicare hospital name, for NJ, from the committed dataset.
const med = JSON.parse(readFileSync(join(ROOT, "src", "data", "gmeHospitals.json"), "utf8"));
const normMap = new Map();
for (const h of med.hospitals) if (h.state === "NJ") normMap.set(norm(h.name), h.ccn);
const overrideNorm = new Map(Object.entries(OVERRIDE).map(([k, v]) => [norm(k), v]));

// Parse the PDF: "<row> <hospital name> $<amount>" per line.
const text = execFileSync("pdftotext", ["-layout", PDF, "-"]).toString("utf8");
const rows = [];
for (const line of text.split(/\r?\n/)) {
  const m = /^\s*\d+\s+(.+?)\s+\$([\d,]+)\s*$/.exec(line);
  if (m && !/TOTAL/i.test(line)) rows.push({ name: m[1].trim(), amount: Number(m[2].replace(/,/g, "")) });
}

const byCcn = {};
const unmatched = [];
for (const r of rows) {
  const key = norm(r.name);
  const ccn = overrideNorm.has(key) ? overrideNorm.get(key) : normMap.get(key) ?? null;
  if (!ccn) { unmatched.push({ name: r.name, amount: r.amount }); continue; }
  byCcn[ccn] = { name: r.name, medicaidTotal: r.amount };
}

const matchedSum = Object.values(byCcn).reduce((a, b) => a + b.medicaidTotal, 0);
const unmatchedSum = unmatched.reduce((a, b) => a + b.amount, 0);

const dataset = {
  meta: {
    state: "NJ",
    program: "NJ DOH Health Care Subsidy Fund (GME Subsidy)",
    academicYear: 2025,
    split: false,
    note: "Single combined GME subsidy per hospital (not separately reported as direct vs indirect). Financed through the state Health Care Subsidy Fund and paid via Medicaid managed care.",
    source: "NJ Department of Health — SFY2025 Graduate Medical Education (GME) Subsidy Allocations",
    sourceUrl: SOURCE_URL,
    hospitalCount: Object.keys(byCcn).length,
  },
  byCcn,
  unmatched: unmatched.map((u) => u.name).sort(),
};

writeFileSync(OUT, JSON.stringify(dataset, null, 2) + "\n");
console.log(`Wrote ${Object.keys(byCcn).length} NJ hospitals -> ${OUT}`);
console.log(`  matched $${matchedSum.toLocaleString()} + unmatched $${unmatchedSum.toLocaleString()} = $${(matchedSum + unmatchedSum).toLocaleString()} (published total $218,000,000)`);
if (unmatched.length) console.log(`  unmatched: ${unmatched.map((u) => u.name).join(", ")}`);
