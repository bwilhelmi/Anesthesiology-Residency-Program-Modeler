# Per-hospital Medicare GME dataset

This directory builds `src/data/gmeHospitals.json` — the per-hospital resident
FTE cap, Direct GME (DGME) payment, Indirect Medical Education (IME) payment,
and Per-Resident Amount (PRA) that back the app's hospital picker.

Every figure is a hospital's own value from its Medicare cost report. Nothing is
estimated or imputed; a missing figure is stored as `null` and shown as
"Not reported". These are modeling references, **not** official CMS payment
determinations.

## Multi-year, settled-preferring selection

Cost reports settle years after they are filed, so any single fiscal-year file
mixes audited/settled reports with provisional "as submitted" ones. The build
reads **several HCRIS years (FY2019–FY2024)** and, for each hospital, picks its
most authoritative report:

1. by settlement status — settled w/ audit > settled w/o audit > reopened >
   amended > as submitted;
2. then most recent fiscal year end;
3. then longest reporting period.

All three headline figures (cap, DGME, IME) come from that one report, so they
stay internally consistent. Each hospital records the `reportYear` and `settled`
flag, so a "settled but older" figure is distinguishable from a "recent but
provisional" one — the picker shows a Settled/Provisional badge and the year.
As of the last build, ~80% of hospitals resolve to a settled report.

## Sources (all pulled directly from CMS)

| File | What it provides | Host |
|---|---|---|
| `edu_<year>.csv` | Worksheet E-4 + E Part A numeric cells (cap, DGME, IME, PRA) | derived from raw HCRIS, Form CMS-2552-10 |
| `HOSP10_<year>_rpt.csv` | Report metadata: report record → CCN, fiscal period, status | same HCRIS zip |
| `CostReport_<year>_Final.csv` | Hospital identity: name, city, state, beds | `data.cms.gov` Hospital Provider Cost Report Public Use File |

The raw HCRIS zips are `HOSP10FY<year>.zip`
(`https://downloads.cms.gov/Files/hcris/HOSP10FY<year>.zip`, ~130 MB each); each
unzips to a 676 MB numeric file and a report file. `scripts/fetch-hcris-years.sh`
streams the numeric file through a filter and keeps only the two GME worksheets
as `edu_<year>.csv`, so the 676 MB file is never stored. The PUF CSVs are at
`data.cms.gov/sites/default/files/.../CostReport_<year>_Final.csv`.

The PUF is used only for hospital identity, joined on CCN (newest year wins).

> Sources for the CMS data portal and cost-report methodology:
> [Hospital Provider Cost Report (data.cms.gov)](https://data.cms.gov/provider-compliance/cost-report/hospital-provider-cost-report),
> [Hospital Cost Report methodology (PDF)](https://data.cms.gov/sites/default/files/2022-09/d9c8e500-2e65-4949-afc2-d965482ce27b/Hospital%20Cost%20Report_Methodology.pdf),
> [CMS HCRIS program](https://www.cms.gov/data-research/statistics-trends-reports/cost-reports/hospital-2010-form).

## Worksheet cell map (CMS-2552-10)

Verified empirically against the data — `Line 7 == min(Line 5, Line 6)` and
`Line 48 == Line 49 + Line 50` hold with zero violations across all reporting
hospitals, and `E Part A Line 29 col 1` matches the PUF "Total IME Payment" for
Mass General and hundreds of others.

| Figure | Worksheet | Line | Col |
|---|---|---|---|
| Actual unweighted resident FTE (current yr) | E-4 (`E40A180`) | 5 | 1 |
| **Unweighted FTE resident cap** | E-4 | 6 | 1 |
| Fundable FTE = min(actual, cap) | E-4 | 7 | 1 |
| Per-Resident Amount (PRA) primary / non-primary | E-4 | 18 | 1 / 2 |
| **Total Medicare Direct GME payment** | E-4 | 48 | 1 |
| **Total Medicare IME payment** | E Part A (`E00A18A`) | 29 | 1 |

## Rebuilding

The raw files under `raw/` are large and **gitignored**. To rebuild the JSON
(e.g. to add a newly released fiscal year):

1. Fetch the HCRIS years (downloads each zip, keeps only the GME worksheets):

   ```bash
   scripts/fetch-hcris-years.sh 2019 2020 2021 2022 2023 2024
   ```

2. Download the PUF identity CSV(s) into `raw/` — the `CostReport_<year>_Final.csv`
   download URLs are in the CMS data catalog (`data.cms.gov/data.json`, dataset
   "Hospital Provider Cost Report").
3. If you added a year, list it in `YEARS` (and `PUF_YEARS`) at the top of
   `scripts/build-gme-dataset.mjs`, then run:

   ```bash
   node scripts/build-gme-dataset.mjs
   ```

   It prints the hospital count, how many are settled, the per-figure coverage,
   and the report-year distribution, and writes `src/data/gmeHospitals.json`.
   Re-run the test suite (`npm test`) — the dataset test pins settled anchor
   values so a bad worksheet-cell change fails loudly.
