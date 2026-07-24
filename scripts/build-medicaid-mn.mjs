/**
 * build-medicaid-mn.mjs — Minnesota Medicaid GME per-hospital (MERC).
 *
 * SOURCE: Minnesota Dept. of Health — Medical Education and Research Costs (MERC)
 * Distribution Annual Report (per-recipient award amounts).
 *   data/gme/mn-source/MERC_distribution25.pdf
 *   https://www.health.state.mn.us/facilities/ruralhealth/merc/docs/distribution25.pdf
 *
 * MERC does not split direct vs indirect, so each hospital carries `medicaidTotal`
 * (its total MERC award). MERC also funds non-hospital sponsoring institutions
 * (universities, colleges, the U of M academic health center) — those are NOT
 * hospitals and are intentionally excluded via a hospital-only crosswalk, so they
 * are not misattributed to any hospital.
 *
 *   node scripts/build-medicaid-mn.mjs   (requires pdftotext on PATH)
 */

import { execFileSync } from "node:child_process";
import { writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const PDF = join(ROOT, "data", "gme", "mn-source", "MERC_distribution25.pdf");
const OUT = join(ROOT, "src", "data", "medicaidGmeMN.json");

// Hospital MERC recipients -> CCN. Non-hospital recipients (Augsburg University,
// Bethel University, the "University of MN Academic" health-center line, Allina
// Health, Twin Cities Orthopedics, etc.) are deliberately omitted. Essentia's
// St. Joseph's / St. Mary's lines are omitted as ambiguous (small amounts).
const CROSSWALK = {
  "abbott northwestern hospital": "240057",
  "children's minnesota": "243302",
  "hennepin county medical center": "240004",
  "mayo clinic": "240010",
  "mercy hospital": "240115",
  "north memorial medical center": "240001",
  "regions hospital": "240106",
  "st. cloud hospital": "240036",
  "st. luke's hospital": "240047",
  "united hospital": "240038",
  "university of minnesota medical": "240080",
};

const norm = (s) => s.replace(/\s+/g, " ").trim().toLowerCase();

const text = execFileSync("pdftotext", ["-layout", PDF, "-"]).toString("utf8");
const byCcn = {};
const skipped = [];
for (const line of text.split(/\r?\n/)) {
  // "<name>  $<pool1>  $<ffs>  $<total>" — capture name and the LAST dollar (total).
  const m = /^\s*([A-Za-z][^$]+?)\s+(\$[\d,]+\s+){1,}\$([\d,]+)\s*$/.exec(line);
  if (!m) continue;
  const name = norm(m[1]);
  if (name === "total") continue;
  const total = Number(m[3].replace(/,/g, ""));
  const ccn = CROSSWALK[name];
  if (!ccn) { skipped.push(m[1].trim()); continue; }
  byCcn[ccn] = { name: m[1].trim(), medicaidTotal: total };
}

const matchedSum = Object.values(byCcn).reduce((a, b) => a + b.medicaidTotal, 0);
const dataset = {
  meta: {
    state: "MN",
    program: "Minnesota MERC (Medical Education & Research Costs)",
    academicYear: 2025,
    split: false,
    note: "Total MERC award per hospital (SFY2025); MERC does not separate direct from indirect. Non-hospital MERC recipients (universities, the academic health center) are excluded.",
    source: "Minnesota Dept. of Health — MERC Distribution Annual Report 2025",
    sourceUrl: "https://www.health.state.mn.us/facilities/ruralhealth/merc/docs/distribution25.pdf",
    hospitalCount: Object.keys(byCcn).length,
  },
  byCcn,
  unmatched: [],
};
writeFileSync(OUT, JSON.stringify(dataset, null, 2) + "\n");
console.log(`Wrote ${Object.keys(byCcn).length} MN hospitals -> ${OUT}  (matched $${matchedSum.toLocaleString()})`);
console.log(`  non-hospital / unmatched MERC recipients skipped: ${skipped.length}`);
