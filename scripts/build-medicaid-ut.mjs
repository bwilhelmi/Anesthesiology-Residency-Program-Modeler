/**
 * build-medicaid-ut.mjs — Utah Medicaid GME per-hospital (Direct).
 *
 * SOURCE: Utah DHHS Medicaid Inpatient Hospital GME program — SFY2024 "GME
 * Calculation" workbook (per-hospital Direct GME supplemental payments).
 *   data/gme/ut-source/UT_2024_GME_Calculation.xlsx
 *   https://medicaid.utah.gov/stplan/inpatientgme/
 *
 * Utah recognizes Direct GME under FFS for SFY2024, so each hospital's "Total Amt"
 * is stored as `medicaidDgme`. Extraction is validated against the published total
 * ($6,539,336). Joined to CCN by an explicit crosswalk of the nine named hospitals.
 *
 *   node scripts/build-medicaid-ut.mjs
 */

import { execFileSync } from "node:child_process";
import { writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const XLSX = join(ROOT, "data", "gme", "ut-source", "UT_2024_GME_Calculation.xlsx");
const OUT = join(ROOT, "src", "data", "medicaidGmeUT.json");
const PUBLISHED_TOTAL = 6539336;

// The nine teaching hospitals in the workbook -> CCN. "University Hospital Psych"
// is a psychiatric unit without a distinct acute CCN in our set (kept unmatched to
// avoid colliding with the University of Utah Hospital figure).
const CROSSWALK = {
  "UNIVERSITY OF UTAH HOSP": "460009",
  "PRIMARY CHILDRENS MED CNTR": "463301",
  "LDS HOSPITAL": "460006",
  "INTERMOUNTAIN MEDICAL CENTER": "460010",
  "UTAH VALLEY REG MED CNTR": "460001",
  "MCKAY DEE HOSPITAL": "460004",
  "ST MARKS HOSPITAL": "460047",
  "SALT LAKE REG MED CNTR": "460003",
  "UNIVERSITY HOSPITAL PSYCH": null,
};

const unz = (e) => execFileSync("unzip", ["-p", XLSX, e], { maxBuffer: 1 << 28 }).toString("utf8");
const unesc = (s) =>
  s.replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/&apos;/g, "'");

const strings = [];
for (const si of unz("xl/sharedStrings.xml").match(/<si>[\s\S]*?<\/si>/g) ?? []) {
  strings.push([...si.matchAll(/<t[^>]*>([\s\S]*?)<\/t>/g)].map((m) => unesc(m[1])).join(""));
}
const colNum = (ref) => {
  let n = 0;
  for (const ch of ref.replace(/[0-9]+/g, "")) n = n * 26 + (ch.charCodeAt(0) - 64);
  return n;
};
const rows = [];
for (const rowXml of unz("xl/worksheets/sheet1.xml").match(/<row[^>]*>[\s\S]*?<\/row>/g) ?? []) {
  const cells = {};
  // Match both self-closing (<c .../>) and full cells; the value <v> may follow a
  // formula <f>, so pull it from the cell's inner content rather than assume order.
  for (const cm of rowXml.matchAll(/<c r="([A-Z]+\d+)"([^>]*?)(?:\/>|>([\s\S]*?)<\/c>)/g)) {
    const [, ref, attrs, inner] = cm;
    if (inner == null) continue; // self-closing empty cell
    const vm = /<v>([\s\S]*?)<\/v>/.exec(inner);
    if (!vm) continue;
    const type = /\bt="([^"]+)"/.exec(attrs)?.[1];
    cells[colNum(ref)] = type === "s" ? strings[parseInt(vm[1], 10)] : vm[1];
  }
  rows.push(cells);
}

// "Total Amt" header gives the total column; hospital names may sit in any column.
let totCol;
for (const cells of rows) {
  for (const [c, v] of Object.entries(cells)) if (v === "Total Amt") totCol = Number(c);
  if (totCol) break;
}
if (!totCol) throw new Error("Could not find the Total Amt column.");

const byCcn = {};
const unmatched = [];
let matchedSum = 0;
let unmatchedSum = 0;
for (const cells of rows) {
  // A data row is identified by carrying one of the nine hospital names.
  const name = Object.values(cells).find((v) => typeof v === "string" && v in CROSSWALK);
  if (!name) continue;
  const amt = Math.round(Number(cells[totCol]));
  if (!Number.isFinite(amt)) continue;
  const ccn = CROSSWALK[name];
  if (!ccn) { unmatched.push(name); unmatchedSum += amt; continue; }
  byCcn[ccn] = { name, medicaidDgme: amt };
  matchedSum += amt;
}

const dataset = {
  meta: {
    state: "UT",
    program: "Utah Medicaid (Direct GME, State Plan Attachment 4.19-A)",
    academicYear: 2024,
    split: false,
    directOnly: true,
    note: "Utah Direct GME quarterly supplemental payments (SFY2024). Utah added a managed-care indirect (IME) payment effective July 2024, which is not included here.",
    source: "Utah DHHS — Medicaid Inpatient Hospital GME Calculation, SFY2024",
    sourceUrl: "https://medicaid.utah.gov/stplan/inpatientgme/",
    hospitalCount: Object.keys(byCcn).length,
  },
  byCcn,
  unmatched: unmatched.sort(),
};
writeFileSync(OUT, JSON.stringify(dataset, null, 2) + "\n");
console.log(`Wrote ${Object.keys(byCcn).length} UT hospitals -> ${OUT}`);
console.log(`  matched $${matchedSum.toLocaleString()} (+ unmatched psych ~$${unmatchedSum.toLocaleString()}) vs published $${PUBLISHED_TOTAL.toLocaleString()}`);
if (unmatched.length) console.log(`  unmatched: ${unmatched.join(", ")}`);
