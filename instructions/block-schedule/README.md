# block-schedule/

Drop your block diagram here — PDF, Excel, screenshot of a spreadsheet, or a
photo of the whiteboard. It will be read and encoded as the model's four-year
block schedule, replacing the placeholder built from a generic ACGME structure.

## What to include, if you have it

- **All four years**, PGY-1 through CA-3, at 13 blocks each.
- **Which site each rotation runs at** — sponsor hospital versus VA, county,
  children's, or a private practice elective. This is the single most valuable
  thing on the diagram: Medicare FTE counts where the training happens, and so
  does the coverage value.
- **Anything that varies by resident**, e.g. a research block only some take, or
  a track that splits after CA-1. Say how many residents follow each variant.

## What the model does with it

Each block is classified along two axes — where it happens, and whether it is
revenue-productive anesthesia care — and the three fractions the model used to
take on faith are derived from the schedule instead of asserted:

| derived | from |
| --- | --- |
| `sponsorSiteShare` | blocks at the sponsor hospital ÷ blocks on duty |
| `fractionOnAnesthesia` | sponsor anesthesia blocks ÷ sponsor blocks |
| `imeCountableShare` | sponsor patient-care blocks ÷ sponsor blocks |
| `dutyWeeksPerYear` | (13 − leave blocks) × 4 |

Non-revenue-productive blocks are flagged rather than silently averaged away.
Research is the clearest case: it produces no anesthesia coverage, and
non-patient-care research time is not IME-countable (42 CFR 412.105(f)).
