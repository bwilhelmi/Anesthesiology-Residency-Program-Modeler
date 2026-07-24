#!/usr/bin/env bash
# Download HCRIS HOSP10 (Form CMS-2552-10) yearly files and extract ONLY the two
# GME worksheets we need (E-4 = E40A180, E Part A = E00A18A) plus the report
# metadata. The 676 MB numeric file is streamed through grep and never stored.
#
#   scripts/fetch-hcris-years.sh 2019 2020 2021 2023 2024
#
# Produces, per year, under data/gme/raw/:
#   edu_<year>.csv           (E-4 + E Part A numeric cells)
#   HOSP10_<year>_rpt.csv    (report metadata)
set -euo pipefail
cd "$(dirname "$0")/.."
RAW="data/gme/raw"
mkdir -p "$RAW"
UA="Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 Chrome/120 Safari/537.36"

for y in "$@"; do
  echo "[$y] downloading zip..."
  zip="$RAW/HOSP10FY${y}.zip"
  curl -s --max-time 600 -A "$UA" "https://downloads.cms.gov/Files/hcris/HOSP10FY${y}.zip" -o "$zip"
  echo "[$y] extracting report metadata..."
  unzip -o -q "$zip" "HOSP10_${y}_rpt.csv" -d "$RAW"
  echo "[$y] streaming numeric file -> GME worksheets only..."
  unzip -p "$zip" "HOSP10_${y}_nmrc.csv" | grep -E ',E40A180,|,E00A18A,' > "$RAW/edu_${y}.csv"
  echo "[$y] edu rows: $(wc -l < "$RAW/edu_${y}.csv")  | removing zip"
  rm -f "$zip"
done
echo "done: $*"
