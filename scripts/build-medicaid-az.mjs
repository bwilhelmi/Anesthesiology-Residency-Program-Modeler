/**
 * build-medicaid-az.mjs — extract Arizona (AHCCCS) Medicaid GME payments.
 *
 * WHAT THIS PRODUCES
 *   src/data/medicaidGmeAZ.json — per-hospital Arizona Medicaid Direct (DME) and
 *   Indirect (IME) graduate-medical-education payments, keyed by CMS CCN so they
 *   merge onto the Medicare GME dataset in the hospital picker.
 *
 * SOURCE
 *   data/gme/az-source/GMEpayments.xlsx — AHCCCS "Medicaid Graduate Medical
 *   Education Payments" payment-history workbook (Summary sheet: total Direct and
 *   Indirect ME per hospital by academic year, July 1–June 30, 2008–present).
 *   Download: https://www.azahcccs.gov/PlansProviders/Downloads/HospitalSupplements/GMEpayments.xlsx
 *
 * These are ACTUAL DISTRIBUTED Medicaid payments (not a formula estimate). The
 * Summary total includes both the state General Fund share and the IGT/IGA-funded
 * non-federal share, each matched with federal Medicaid dollars — i.e., "all
 * direct and indirect GME money from the Medicaid program or other state funds."
 * The GF-only and IGA-only breakdowns live on separate sheets of the same
 * workbook if a split is ever needed.
 *
 * The workbook keys hospitals by AHCCCS short name; we map each to a CMS CCN with
 * an explicit, hand-verified crosswalk so no dollars are mis-attributed. Any
 * AHCCCS hospital not in the crosswalk is reported, not silently dropped.
 *
 *   node scripts/build-medicaid-az.mjs
 */

import { execFileSync } from "node:child_process";
import { writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const XLSX = join(ROOT, "data", "gme", "az-source", "GMEpayments.xlsx");
const OUT = join(ROOT, "src", "data", "medicaidGmeAZ.json");
const SOURCE_URL =
  "https://www.azahcccs.gov/PlansProviders/Downloads/HospitalSupplements/GMEpayments.xlsx";

/* Explicit AHCCCS-name -> CMS CCN crosswalk (normalized keys). Verified against
 * the Medicare GME dataset's Arizona hospitals. Hospitals AHCCCS lists that are
 * not acute-care teaching hospitals in our set (Banner Payson, HonorHealth Rehab)
 * are intentionally absent and will be reported as unmatched. */
const CROSSWALK = {
  "abrazo arrowhead campus": "030094",
  "abrazo central campus": "030030",
  "abrazo west campus": "030110",
  "banner baywood": "030088",
  "banner behavioral health": "034004",
  "banner boswell": "030061",
  "banner casa grande": "030016",
  "banner del webb": "030093",
  "banner desert": "030065",
  "banner estrella": "030115",
  "banner gateway": "030122",
  "banner heart hospital": "030105",
  "banner thunderbird": "030089",
  "banner - umc phoenix": "030002",
  "banner - umc south": "030111",
  "banner - umc tucson": "030064",
  "canyon vista mc": "030043",
  "dignity chandler regional": "030036",
  "honorhealth deer valley mc": "030092",
  "john c lincoln": "030014",
  "kingman regional": "030055",
  "mayo hospital": "030103",
  "mercy gilbert": "030119",
  "mountain vista mc": "030121",
  "phoenix children's": "033302",
  "scottsdale hc osborn": "030038",
  "scottsdale hc shea": "030087",
  "scottsdale hc thompson peak": "030123",
  "st. joseph's phx": "030024",
  "tucson mc": "030006",
  "valleywise health mc": "030022",
  "verde valley mc": "030007",
  "yuma regional mc": "030013",
};

/** Normalize an AHCCCS hospital label: drop footnote markers, unify dashes. */
function norm(s) {
  return s
    .replace(/\s*\d+\/\s*$/, "") // trailing footnote like " 4/"
    .replace(/[–—]/g, "-") // en/em dash -> hyphen
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase();
}

/* ---- read the two xlsx parts we need via `unzip -p` (no dependency) -------- */
const unz = (entry) => execFileSync("unzip", ["-p", XLSX, entry], { maxBuffer: 1 << 28 }).toString("utf8");
const unescapeXml = (s) =>
  s.replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/&apos;/g, "'");

// shared strings, in order
const sharedXml = unz("xl/sharedStrings.xml");
const strings = [];
for (const si of sharedXml.match(/<si>[\s\S]*?<\/si>/g) ?? []) {
  const parts = [...si.matchAll(/<t[^>]*>([\s\S]*?)<\/t>/g)].map((m) => unescapeXml(m[1]));
  strings.push(parts.join(""));
}

// Summary sheet cells -> rows[rowIndex][colLetterNumber] = value
const sheetXml = unz("xl/worksheets/sheet1.xml");
const colNum = (ref) => {
  const c = ref.replace(/[0-9]+/g, "");
  let n = 0;
  for (const ch of c) n = n * 26 + (ch.charCodeAt(0) - 64);
  return n;
};
const rows = [];
for (const rowXml of sheetXml.match(/<row[^>]*>[\s\S]*?<\/row>/g) ?? []) {
  const cells = {};
  for (const cm of rowXml.matchAll(/<c r="([A-Z]+\d+)"(?:[^>]*?\st="([^"]+)")?[^>]*>(?:<v>([\s\S]*?)<\/v>)?<\/c>/g)) {
    const [, ref, type, raw] = cm;
    if (raw == null) continue;
    cells[colNum(ref)] = type === "s" ? strings[parseInt(raw, 10)] : raw;
  }
  rows.push(cells);
}

/* ---- locate the year columns and the DME / IME sections -------------------- */
let yearRow = null;
for (const cells of rows) {
  const yrs = Object.entries(cells).filter(([, v]) => /^(19|20)\d\d$/.test(String(v)));
  if (yrs.length >= 5) { yearRow = cells; break; }
}
if (!yearRow) throw new Error("Could not find the academic-year header row.");
const yearCols = Object.entries(yearRow)
  .filter(([, v]) => /^(19|20)\d\d$/.test(String(v)))
  .map(([col, v]) => ({ col: Number(col), year: Number(v) }))
  .sort((a, b) => a.year - b.year);
const latest = yearCols[yearCols.length - 1];

const num = (v) => {
  const n = parseFloat(String(v ?? "").replace(/[^0-9.\-]/g, ""));
  return Number.isFinite(n) ? n : 0;
};

// Walk rows, tracking the current section by its header text in column A (1).
const dme = {}; // normName -> value
const ime = {};
let section = null;
for (const cells of rows) {
  const header = String(cells[1] ?? "");
  // Test "indirect" BEFORE "direct" — "Indirect Medical Education" contains the
  // substring "direct medical education".
  if (/indirect medical education/i.test(header)) { section = "IME"; continue; }
  if (/direct medical education/i.test(header)) { section = "DME"; continue; }
  if (/total payments/i.test(header)) { section = "TOTAL"; continue; }
  const label = cells[2];
  if (!label || /subtotal|^total/i.test(String(label))) continue;
  if (section === "DME") dme[norm(label)] = num(cells[latest.col]);
  else if (section === "IME") ime[norm(label)] = num(cells[latest.col]);
}

/* ---- map to CCN and assemble --------------------------------------------- */
const byCcn = {};
const unmatched = [];
const allNames = new Set([...Object.keys(dme), ...Object.keys(ime)]);
for (const name of allNames) {
  const ccn = CROSSWALK[name];
  if (!ccn) { unmatched.push(name); continue; }
  byCcn[ccn] = {
    ahcccsName: name,
    // Whole dollars: the workbook carries sub-dollar cents; round for clean
    // display and consistency with the integer Medicare figures.
    medicaidDgme: Math.round(dme[name] ?? 0),
    medicaidIme: Math.round(ime[name] ?? 0),
  };
}

const dataset = {
  meta: {
    state: "AZ",
    program: "AHCCCS (Arizona Medicaid)",
    source: "AHCCCS Medicaid Graduate Medical Education Payments (payment-history workbook, Summary sheet)",
    sourceUrl: SOURCE_URL,
    academicYear: latest.year,
    basis: "Academic year, July 1 – June 30. Figures are actual distributed Medicaid GME payments (Direct and Indirect).",
    fundingNote:
      "Summary totals include both the state General Fund share and the IGT/IGA-funded non-federal share, each matched with federal Medicaid dollars. Not an official AHCCCS determination; provided for modeling.",
    hospitalCount: Object.keys(byCcn).length,
  },
  byCcn,
  unmatched: unmatched.sort(),
};

writeFileSync(OUT, JSON.stringify(dataset, null, 2) + "\n");
console.log(`Wrote ${Object.keys(byCcn).length} AZ hospitals (academic year ${latest.year}) -> ${OUT}`);
if (unmatched.length) console.log(`  unmatched AHCCCS hospitals (no CCN in crosswalk): ${unmatched.join(", ")}`);
