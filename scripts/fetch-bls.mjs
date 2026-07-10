/**
 * Fetch regional anesthesia-workforce wages from the U.S. Bureau of Labor
 * Statistics (BLS) Occupational Employment and Wage Statistics (OEWS) program
 * and write them to src/data/salaries.json.
 *
 * WHY BLS (and not gaswork.com):
 *   - BLS OEWS publishes official mean/median wages by state (and metro) for
 *     Anesthesiologists (SOC 29-1211) and Nurse Anesthetists / CRNAs (29-1151).
 *   - It is public-domain U.S. government data — legal to redistribute in a
 *     public app — unlike scraped job-board listings.
 *
 * This script is meant to run in CI (GitHub Actions), where outbound internet
 * is available. It uses the BLS public API. A registration key (free) raises
 * the rate limits and is read from the BLS_API_KEY environment variable if set;
 * without it the script falls back to the unregistered tier, which is enough
 * for an occasional refresh.
 *
 * OEWS BLS series-ID format (25 chars):
 *   OE | U | areatype | area(7) | industry(6) | occupation(6) | datatype(2)
 *   - "OE"  survey (Occupational Employment & Wage Statistics)
 *   - "U"   not seasonally adjusted
 *   - areatype: "N" national, "S" statewide
 *   - area: national "0000000"; state = 2-digit FIPS + "00000"
 *   - industry: "000000" (cross-industry total)
 *   - occupation: 6-digit SOC without hyphen
 *   - datatype: "04" = annual mean wage
 */

import { writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

const __dirname = dirname(fileURLToPath(import.meta.url));
const OUT_PATH = resolve(__dirname, "../src/data/salaries.json");

const OCCUPATIONS = {
  anesthesiologist: "291211",
  crna: "291151",
};
const ANNUAL_MEAN = "04";

// 2-digit state FIPS codes (50 states + DC).
const STATE_FIPS = {
  Alabama: "01", Alaska: "02", Arizona: "04", Arkansas: "05", California: "06",
  Colorado: "08", Connecticut: "09", Delaware: "10", "District of Columbia": "11",
  Florida: "12", Georgia: "13", Hawaii: "15", Idaho: "16", Illinois: "17",
  Indiana: "18", Iowa: "19", Kansas: "20", Kentucky: "21", Louisiana: "22",
  Maine: "23", Maryland: "24", Massachusetts: "25", Michigan: "26",
  Minnesota: "27", Mississippi: "28", Missouri: "29", Montana: "30",
  Nebraska: "31", Nevada: "32", "New Hampshire": "33", "New Jersey": "34",
  "New Mexico": "35", "New York": "36", "North Carolina": "37",
  "North Dakota": "38", Ohio: "39", Oklahoma: "40", Oregon: "41",
  Pennsylvania: "42", "Rhode Island": "44", "South Carolina": "45",
  "South Dakota": "46", Tennessee: "47", Texas: "48", Utah: "49",
  Vermont: "50", Virginia: "51", Washington: "53", "West Virginia": "54",
  Wisconsin: "55", Wyoming: "56",
};

function stateSeries(fips, occ) {
  return `OEUS${fips}00000${"000000"}${occ}${ANNUAL_MEAN}`;
}
function nationalSeries(occ) {
  return `OEUN0000000${"000000"}${occ}${ANNUAL_MEAN}`;
}

// Build the full series list and a reverse map from seriesId -> {scope, role}.
const seriesMeta = new Map();
const allSeries = [];
for (const [role, occ] of Object.entries(OCCUPATIONS)) {
  const nat = nationalSeries(occ);
  allSeries.push(nat);
  seriesMeta.set(nat, { scope: "national", key: "national", role });
  for (const [state, fips] of Object.entries(STATE_FIPS)) {
    const sid = stateSeries(fips, occ);
    allSeries.push(sid);
    seriesMeta.set(sid, { scope: "state", key: state, role });
  }
}

const API_KEY = process.env.BLS_API_KEY?.trim();
const API_URL = API_KEY
  ? "https://api.bls.gov/publicAPI/v2/timeseries/data/"
  : "https://api.bls.gov/publicAPI/v1/timeseries/data/";
const CHUNK = API_KEY ? 50 : 25; // per-request series limit by tier

function chunk(arr, n) {
  const out = [];
  for (let i = 0; i < arr.length; i += n) out.push(arr.slice(i, i + n));
  return out;
}

async function fetchChunk(ids) {
  const body = { seriesid: ids };
  if (API_KEY) body.registrationkey = API_KEY;
  const res = await fetch(API_URL, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    throw new Error(`BLS API HTTP ${res.status}: ${await res.text()}`);
  }
  const json = await res.json();
  if (json.status !== "REQUEST_SUCCEEDED") {
    throw new Error(`BLS API status ${json.status}: ${(json.message || []).join("; ")}`);
  }
  return json.Results?.series ?? [];
}

/** Latest numeric annual value from a BLS series' data array. */
function latestValue(series) {
  const data = series.data ?? [];
  let best = null;
  for (const d of data) {
    const year = parseInt(d.year, 10);
    const val = Number(String(d.value).replace(/[^0-9.]/g, ""));
    if (!Number.isFinite(val) || val <= 0) continue;
    if (!best || year > best.year) best = { year, val };
  }
  return best;
}

async function main() {
  console.log(`Fetching ${allSeries.length} BLS OEWS series ` +
    `(${API_KEY ? "registered" : "unregistered"} tier, ${CHUNK}/request)...`);

  const result = {
    anesthesiologist: { national: null, states: {} },
    crna: { national: null, states: {} },
  };
  let dataYear = null;
  let missing = 0;

  for (const ids of chunk(allSeries, CHUNK)) {
    const seriesList = await fetchChunk(ids);
    for (const series of seriesList) {
      const meta = seriesMeta.get(series.seriesID);
      if (!meta) continue;
      const latest = latestValue(series);
      if (!latest) {
        missing++;
        continue;
      }
      dataYear = Math.max(dataYear ?? 0, latest.year);
      if (meta.scope === "national") result[meta.role].national = latest.val;
      else result[meta.role].states[meta.key] = latest.val;
    }
  }

  if (!result.anesthesiologist.national && !result.crna.national) {
    throw new Error("No national wage data returned — aborting without overwriting.");
  }

  const out = {
    source: "U.S. Bureau of Labor Statistics, Occupational Employment and Wage Statistics (OEWS)",
    sourceUrl: "https://www.bls.gov/oes/",
    occupations: { anesthesiologist: "29-1211", crna: "29-1151 (Nurse Anesthetists)" },
    measure: "Annual mean wage",
    dataYear,
    asOf: `${dataYear} (May reference period)`,
    generatedAt: new Date().toISOString().slice(0, 10),
    national: {
      anesthesiologist: round(result.anesthesiologist.national),
      crna: round(result.crna.national),
    },
    states: {},
  };
  for (const state of Object.keys(STATE_FIPS)) {
    out.states[state] = {
      anesthesiologist: round(result.anesthesiologist.states[state]),
      crna: round(result.crna.states[state]),
    };
  }

  await writeFile(OUT_PATH, JSON.stringify(out, null, 2) + "\n");
  console.log(
    `Wrote ${OUT_PATH}\n` +
    `  data year: ${dataYear}\n` +
    `  national anesthesiologist mean: $${out.national.anesthesiologist?.toLocaleString()}\n` +
    `  national CRNA mean: $${out.national.crna?.toLocaleString()}\n` +
    `  states with data: ${Object.values(out.states).filter((s) => s.anesthesiologist).length}/${Object.keys(STATE_FIPS).length}\n` +
    `  series with no value: ${missing}`
  );
}

function round(v) {
  return v == null ? null : Math.round(v);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
