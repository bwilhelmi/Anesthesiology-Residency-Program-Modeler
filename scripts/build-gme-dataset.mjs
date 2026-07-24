/**
 * build-gme-dataset.mjs — assemble the per-hospital GME reference dataset.
 *
 * WHAT THIS PRODUCES
 *   src/data/gmeHospitals.json — one record per teaching hospital with its
 *   Medicare direct-GME / IME resident FTE cap, Direct GME (DGME) payment,
 *   Indirect Medical Education (IME) payment, and Per-Resident Amount (PRA),
 *   keyed and displayed by hospital name for the program's hospital picker.
 *
 * MULTI-YEAR, SETTLED-PREFERRING SELECTION
 *   Cost reports settle years after they are filed, so a single fiscal-year
 *   snapshot mixes audited/settled reports with provisional "as submitted" ones.
 *   This build reads SEVERAL HCRIS years and, for each hospital, picks its
 *   most authoritative report:
 *       1. by settlement status  (settled w/ audit > settled w/o audit
 *                                  > reopened > amended > as submitted)
 *       2. then by most recent fiscal year end
 *       3. then by longest reporting period
 *   Each hospital records the year and status behind its figures, so a "settled
 *   but older" report is distinguishable from a "recent but provisional" one.
 *   All three headline figures (cap, DGME, IME) come from the SAME selected
 *   report, so they stay internally consistent.
 *
 * SOURCES (all pulled directly from CMS — see data/gme/README.md)
 *   Raw HCRIS cost reports, CMS Form 2552-10 (fetch with scripts/fetch-hcris-years.sh):
 *       data/gme/raw/edu_<year>.csv          (E-4 + E Part A numeric cells)
 *       data/gme/raw/HOSP10_<year>_rpt.csv   (report metadata -> CCN, period, status)
 *   Hospital Provider Cost Report Public Use File (identity only, joined on CCN):
 *       data/gme/raw/CostReport_<year>_Final.csv
 *
 * WORKSHEET CELL MAP (CMS-2552-10), verified empirically against the data
 * (Line 7 == min(Line 5, Line 6) and Line 48 == Line 49 + Line 50 with zero
 * violations; E Part A Line 29 col 1 == PUF "Total IME Payment" for Mass General
 * and hundreds of others):
 *
 *   Worksheet E-4  (code E40A180) — Direct GME:
 *     Line 05 col 1  actual unweighted resident FTE (current year)
 *     Line 06 col 1  UNWEIGHTED FTE RESIDENT CAP           <- "cap space"
 *     Line 18 col 1  Per-Resident Amount (PRA), primary care
 *     Line 18 col 2  Per-Resident Amount (PRA), non-primary
 *     Line 48 col 1  TOTAL MEDICARE DIRECT GME PAYMENT     <- "DGME money"
 *   Worksheet E Part A (code E00A18A):
 *     Line 29 col 1  TOTAL IME PAYMENT                     <- "IME money"
 *
 * The raw files under data/gme/raw/ are large and gitignored; the committed
 * artifact is the JSON this writes.
 *
 *   node scripts/build-gme-dataset.mjs
 */

import { createReadStream, existsSync, readFileSync, writeFileSync } from "node:fs";
import { createInterface } from "node:readline";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const RAW = join(ROOT, "data", "gme", "raw");
const OUT = join(ROOT, "src", "data", "gmeHospitals.json");

// HCRIS years to consider, oldest first. A hospital's best report is chosen
// across all of these. Add a year here after fetching it.
const YEARS = [2019, 2020, 2021, 2022, 2023, 2024];
// PUF identity files, most-preferred first (newest names/beds win).
const PUF_YEARS = [2023, 2022];

/* ---- tiny CSV helpers (these CMS files are simple, quoted-field CSV) ---- */
function splitCsv(line) {
  const out = [];
  let cur = "";
  let q = false;
  for (let i = 0; i < line.length; i++) {
    const c = line[i];
    if (q) {
      if (c === '"') {
        if (line[i + 1] === '"') { cur += '"'; i++; }
        else q = false;
      } else cur += c;
    } else if (c === '"') q = true;
    else if (c === ",") { out.push(cur); cur = ""; }
    else cur += c;
  }
  out.push(cur);
  return out;
}
const num = (s) => {
  const v = parseFloat(String(s).replace(/[^0-9.\-]/g, ""));
  return Number.isFinite(v) ? v : null;
};

/* ---- 1. report metadata across all years: key `${year}:${rec}` -> meta ---- */
// rpt columns: 0 rpt_rec_num, 2 provider CCN, 4 status, 5 FY begin, 6 FY end
const RPT_STATUS = { 1: "As submitted", 2: "Settled w/o audit", 3: "Settled w/ audit", 4: "Reopened", 5: "Amended" };
const STATUS_RANK = { "3": 4, "2": 3, "4": 2, "5": 1, "1": 0 };
const SETTLED = new Set(["2", "3"]);
const meta = new Map();
for (const y of YEARS) {
  const f = join(RAW, `HOSP10_${y}_rpt.csv`);
  if (!existsSync(f)) { console.warn(`  (skip) missing ${f}`); continue; }
  for (const line of readFileSync(f, "utf8").split(/\r?\n/)) {
    if (!line) continue;
    const c = splitCsv(line);
    if (c.length < 7) continue;
    meta.set(`${y}:${c[0]}`, { year: y, ccn: c[2].padStart(6, "0"), begin: c[5], end: c[6], status: c[4] });
  }
}

/* ---- 2. hospital identity from the PUF: ccn -> { name, city, state, beds } ---- */
const puf = new Map();
for (const y of PUF_YEARS) {
  const f = join(RAW, `CostReport_${y}_Final.csv`);
  if (!existsSync(f)) continue;
  const lines = readFileSync(f, "utf8").split(/\r?\n/);
  const hdr = splitCsv(lines[0]);
  const col = (n) => hdr.indexOf(n);
  const cCcn = col("Provider CCN"), cName = col("Hospital Name"), cCity = col("City"),
    cState = col("State Code"), cBeds = col("Number of Beds");
  for (let i = 1; i < lines.length; i++) {
    if (!lines[i]) continue;
    const c = splitCsv(lines[i]);
    if (c.length <= cState) continue;
    const ccn = c[cCcn].padStart(6, "0");
    if (puf.has(ccn)) continue; // newest year wins
    puf.set(ccn, {
      name: c[cName].trim(),
      city: (c[cCity] || "").trim(),
      state: (c[cState] || "").trim(),
      beds: num(c[cBeds]),
    });
  }
}

/* ---- 3. GME worksheet cells across all years: key `${year}:${rec}` -> cells --- */
const want = new Map([
  ["E40A180|00500|00100", "actualFte"],
  ["E40A180|00600|00100", "capFte"],
  ["E40A180|04800|00100", "dgme"],
  ["E40A180|01800|00100", "praPrimary"],
  ["E40A180|01800|00200", "praOther"],
  ["E00A18A|02900|00100", "ime"],
]);
const cells = new Map();
for (const y of YEARS) {
  const f = join(RAW, `edu_${y}.csv`);
  if (!existsSync(f)) { console.warn(`  (skip) missing ${f}`); continue; }
  await new Promise((resolve, reject) => {
    const rl = createInterface({ input: createReadStream(f), crlfDelay: Infinity });
    rl.on("line", (line) => {
      const c = splitCsv(line);
      if (c.length < 5) return;
      const field = want.get(`${c[1]}|${c[2]}|${c[3]}`);
      if (!field) return;
      const key = `${y}:${c[0]}`;
      let o = cells.get(key);
      if (!o) { o = {}; cells.set(key, o); }
      o[field] = num(c[4]);
    });
    rl.on("close", resolve);
    rl.on("error", reject);
  });
}

/* ---- 4. choose the most authoritative report per hospital (CCN) ----------- */
// Priority: settlement status, then most recent fiscal end, then longest period.
function days(begin, end) {
  const p = (s) => { const [m, d, y] = (s || "").split("/").map(Number); return m ? Date.UTC(y, m - 1, d) : null; };
  const a = p(begin), b = p(end);
  return a && b ? Math.round((b - a) / 86400000) : 0;
}
function endKey(s) { const [m, d, y] = (s || "").split("/").map(Number); return m ? y * 10000 + m * 100 + d : 0; }

const best = new Map(); // ccn -> candidate
for (const [key, data] of cells) {
  const m = meta.get(key);
  if (!m) continue;
  if (data.capFte == null && data.dgme == null && data.ime == null) continue;
  const cand = {
    m, data,
    rank: STATUS_RANK[m.status] ?? 0,
    end: endKey(m.end),
    span: days(m.begin, m.end),
  };
  const cur = best.get(m.ccn);
  const better =
    !cur ||
    cand.rank > cur.rank ||
    (cand.rank === cur.rank && cand.end > cur.end) ||
    (cand.rank === cur.rank && cand.end === cur.end && cand.span > cur.span);
  if (better) best.set(m.ccn, cand);
}

/* ---- 5. assemble output --------------------------------------------------- */
const records = [];
for (const [ccn, { m, data }] of best) {
  const id = puf.get(ccn);
  const capFte = data.capFte ?? null;
  const actualFte = data.actualFte ?? null;
  const headroomFte =
    capFte != null && actualFte != null ? Math.round((capFte - actualFte) * 100) / 100 : null;
  records.push({
    ccn,
    name: id?.name || `CCN ${ccn}`,
    city: id?.city ?? "",
    state: id?.state ?? "",
    beds: id?.beds ?? null,
    reportYear: m.year,
    fiscalYearBegin: m.begin,
    fiscalYearEnd: m.end,
    reportStatus: RPT_STATUS[m.status] ?? "Unknown",
    settled: SETTLED.has(m.status),
    capFte,
    actualFte,
    headroomFte,
    dgmePayment: data.dgme ?? null,
    imePayment: data.ime ?? null,
    praPrimaryCare: data.praPrimary ?? null,
    praNonPrimary: data.praOther ?? null,
  });
}
records.sort((a, b) => a.name.localeCompare(b.name));

const settledCount = records.filter((r) => r.settled).length;
const dataset = {
  meta: {
    source: "CMS Healthcare Cost Report Information System (HCRIS), Form CMS-2552-10; identity fields from the Hospital Provider Cost Report Public Use File",
    yearsConsidered: YEARS,
    selection:
      "Per hospital, the most authoritative report across the years above: highest settlement status, then most recent fiscal year, then longest reporting period. Each hospital records the year and status behind its figures.",
    note:
      "Figures are drawn from each hospital's Medicare cost report and are provided for modeling only — they are not an official CMS payment determination. A blank value means the figure was not reported on the selected cost report; no values are estimated or imputed.",
    hospitalCount: records.length,
    settledCount,
  },
  hospitals: records,
};

writeFileSync(OUT, JSON.stringify(dataset, null, 2) + "\n");

const withCap = records.filter((r) => r.capFte != null).length;
const withDgme = records.filter((r) => r.dgmePayment != null).length;
const withIme = records.filter((r) => r.imePayment != null).length;
console.log(`Wrote ${records.length} hospitals -> ${OUT}`);
console.log(`  settled: ${settledCount}/${records.length}  |  with cap: ${withCap} | DGME: ${withDgme} | IME: ${withIme}`);
const byYear = {};
for (const r of records) byYear[r.reportYear] = (byYear[r.reportYear] || 0) + 1;
console.log(`  report year distribution: ${JSON.stringify(byYear)}`);
