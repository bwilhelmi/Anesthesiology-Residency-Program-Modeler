# Anesthesiology Residency Program Modeler

A browser-based tool to estimate the **costs and benefits of establishing an
ACGME-accredited anesthesiology residency program** at a hospital. It combines
Medicare/Medicaid graduate medical education (GME) funding, the clinical labor
value of residents across their training, and the operating costs of running an
accredited program into a year-by-year and steady-state financial picture.

Everything runs locally in the browser — no server, no data leaves the device.

```bash
npm install
npm run dev       # start the dev server
npm test          # run the model unit tests
npm run build     # production build into dist/
```

---

## What the model captures

Establishing a residency changes a hospital's economics in several directions at
once. This tool makes each of them an explicit, adjustable input so you can see
the trade-offs rather than a single black-box number.

Money is entered in **year-1 dollars**. Escalation, discounting, and the
pre-revenue build-up happen inside the projection, not in your head.

### Benefits

| Benefit | How it's modeled |
| --- | --- |
| **Medicare Direct GME (DGME)** | `PRA × payment FTE × Medicare share of inpatient days`. The payment FTE is what survives the cap and the three-year rolling average, not headcount. |
| **Medicare Indirect Medical Education (IME)** | `IME% = 1.35 × [(1 + r)^0.405 − 1]` on Medicare inpatient operating payments, credited *marginally* because IME is nonlinear in the resident-to-bed ratio `r`, and clipped by the ratio cap. |
| **Medicare capital IME** *(optional, off by default)* | `e^(0.2822 × r) − 1` on Medicare capital PPS payments. |
| **Medicaid GME** | Per resident FTE, or a fixed annual appropriation that does **not** scale with program size — states differ in kind, not just amount. |
| **Clinical labor substitution** | Residents help staff anesthetizing locations, offsetting CRNA/locum coverage. Valued at the **all-in** cost of that coverage — base salary, premium pay, and fringe — for the coverage each level provides *at the sponsor hospital*, capped at the locations the hospital actually runs. |
| **Off-service / intern service value** | Value delivered to host departments during required non-anesthesia rotations — credited only for months spent at the sponsor hospital. |
| **Retention pipeline** | Graduates hired by the hospital or its group, valued at the recruiting, signing, and locum-bridge cost their hire **avoids**. This is an avoided cost, never revenue. |
| **Overnight call coverage** *(optional, off by default)* | In-house nights that would otherwise be CRNA call stipends, overtime, or locum coverage. Leave it off if your coverage FTEs already include call. |

### Costs

| Cost | How it's modeled |
| --- | --- |
| **Resident stipends + benefits** | Headcount × (stipend + benefits **in absolute dollars**). Health premiums and payroll-adjacent costs do not scale with a trainee's salary, so a percentage load understates them badly. |
| **Incremental attending supervision** | The teaching staffing model ties an attending to **1:2** resident rooms (42 CFR 415.178) where medical direction covers **1:4** CRNA rooms (42 CFR 415.110). That extra attending time is a real cost of teaching, and it is the single largest line most pro formas omit. |
| **Program leadership & administration** | Program Director and Associate PD protected time at the anesthesiologist rate, coordinator salary, and non-billable faculty teaching effort. |
| **Per-resident program costs** | Professional liability, the DIO/GMEC/GME-office allocation the ACGME Institutional Requirements oblige, and the fee stack (ERAS/NRMP, ITE, ABA, licenses, certifications). |
| **Fixed program overhead** | Accreditation fees, recruitment, simulation, resident education funds. |
| **Teaching efficiency loss** | Lost clinical margin from slower teaching cases, weighted toward junior residents — charged **once**, on the covered locations. |
| **Startup & accreditation** | Spread across the pre-revenue years, where it is actually spent. |
| **Participating-site support** | Net affiliation-agreement payments, in either direction. |

---

## Medicare mechanics

None of the Medicare money is a single-year calculation, and the rules that make
it time-dependent are the difference between a plausible pro forma and a fantasy.

### The three hospital scenarios

The largest single lever in the model, and one that cannot be expressed as a
boolean:

- **New teaching hospital** — no cap and no Per-Resident Amount yet. It *builds*
  both out of this program.
- **Existing teaching hospital, under cap** — funds residents up to the remaining
  headroom, plus any awarded slots.
- **At cap** — only awarded slots create funded FTE. Everything else trains at
  full cost, and the case rests on clinical labor, Medicaid, retention, and
  mission.

### Cap building — 42 CFR 413.79(e)(1)

A new teaching hospital has **no cap during program years 1–5**. The permanent
cap is then fixed from the year-5 complement: the highest number of countable
FTE in any single program year × the program's accredited length (4 years for
anesthesiology). With attrition and multi-site training this is meaningfully
below `residents per class × 4`, and the model computes it from the actual
surviving, sponsor-site FTE.

### The three-year rolling average — 42 CFR 413.79(d)

Payment FTE is the average of the current and two prior years — **except** that
residents in a new program are excluded during the growth window
(413.79(d)(5)). Without that exception a ramping program would be paid on an
average it never catches up to. From year 6 the average binds, so a program
still changing size is paid on a figure trailing up to two years behind.

### The IME resident-to-bed ratio cap — 42 CFR 412.105

This year's ratio may not exceed last year's (412.105(a)(1)), with the same
new-program exception (412.105(f)(1)(v)) — which is what lets a ramping program's
ratio climb year over year before it holds. Only patient-care time is countable
(412.105(f)), so research time is excluded from IME but not from DGME.

### Capital IME — 42 CFR 412.322

A smaller, exponential add-on on capital PPS payments. Off unless you supply the
hospital's capital payments, so no existing estimate changes silently.

### The PRA for a new teaching hospital — 42 CFR 413.77(e)

`PRA = min(your projected allowable cost per FTE, the locality weighted mean PRA)`.

Two things about this number deserve a board's attention. It is a **one-shot,
permanent** determination made from the program's early cost-report years and
merely trended forward afterwards, which makes it the highest-leverage figure in
the entire model. And a hospital stuck with a very low or zero historical PRA, or
a de-minimis cap, may qualify to have it **reset under CAA 2021 §131** — worth
checking before accepting an inherited number as fixed.

### Slot awards

`CAA 2021 §126` (1,000 slots phased FY2023–FY2027) and `CAA 2023 §4122` (200
slots, FY2026, at least 100 psychiatry-directed) are distributed through a CMS
application process. They add headroom under cap and are the only funded FTE at
cap.

---

## The intern year vs. the CA years

Per the ACGME anesthesiology program requirements, the training years differ
sharply in where the resident's value lands:

- **PGY-1 (Clinical Base / intern year):** mostly required off-service rotations
  (critical care, medicine, surgery, emergency medicine), often at participating
  sites. Modeled as low anesthesia coverage but meaningful service value to
  whichever department hosts them.
- **PGY-2 → PGY-4 (CA-1 → CA-3):** nearly the whole year delivering anesthesia
  under supervision, with coverage capability ramping from a fraction of a CRNA
  toward near-independent senior coverage.

Where a resident *is* matters as much as what they do. Coverage composes as:

```
coverage = sponsorSiteShare × fractionOnAnesthesia × anesthesiaCoverageFte
```

Medicare FTE counts at the hospital where the training occurs, and clinical value
accrues where the resident is standing — so months at a county hospital or VA
generate neither sponsor FTE nor sponsor coverage. Every one of these parameters
is editable per PGY level.

---

## The premium-pay asymmetry

Resident coverage is not simply "a cheaper CRNA." The two are paid on different
terms:

- A **CRNA** earns overtime when the room runs past the scheduled day, premium
  pay on holidays, and weekend/call differentials.
- A **resident** earns a fixed stipend regardless — bounded, but not repriced, by
  the ACGME's 80-hour ceiling.

So the coverage a resident displaces costs more than a base salary implies, and
`crnaPremiumPayLoad` is where that is stated. It applies **only** to the
labor-substitution credit; no cost line moves with it.

The 12% default is a placeholder, not a survey figure — no public dataset
isolates CRNA overtime as a share of base. Your payroll knows the real number
exactly, which makes this one of the few assumptions in the model that can be
*settled* rather than argued. It is worth doing: at the shipped defaults, moving
it from 0% to 12% is the difference between a program that never repays its
build-out and one that breaks even in year 9.

---

## Supervision & billing ratios

Resident coverage cuts both ways. A teaching anesthesiologist may be involved in
**2 concurrent resident cases** at full payment (42 CFR 415.178), against **4
concurrent medically directed CRNA cases** (42 CFR 415.110). Residents therefore
substitute for CRNA labor *and* consume more attending time per room than the
CRNAs they replace. The model charges both sides; earlier versions collected only
the benefit.

---

## Reading the output

- **NPV** over the whole frame, discounted from the first pre-launch year, so the
  build-out is counted at full weight rather than discounted away.
- **Breakeven year** — the first program year in which cumulative discounted net
  turns non-negative, or none.
- **Steady-state annual net** — the mature year (program year 6), once the cap,
  the rolling average, and the ratio cap all bind.
- **The tornado chart** — each assumption moved on its own. A single NPV invites
  false precision; the tornado shows that two or three assumptions decide the
  answer and the rest is noise. Argue about those.
- **Scenario presets** — conservative, base, and favorable, applied as patches so
  anything you have localized survives.
- **Warnings** — coverage exceeding the rooms you run, supervision ratios beyond
  Medicare limits, cap headroom shortfalls, and appropriation-mode Medicaid
  without a committed non-federal share.

---

## What this model deliberately excludes

Each of these is real. None is quantifiable in a way a CFO should accept from a
planning tool, so the model leaves them out rather than inventing a number:

- **Research and scholarly output** — value depends entirely on what the faculty
  actually produce, and grant capture is not a function of resident count.
- **Quality and outcome effects** — the literature is mixed on direction, let
  alone magnitude, and any figure here would be a guess wearing a citation.
- **Downstream referral capture** — hospital- and market-specific; modeling it
  generically would flatter every program equally, which is the same as modeling
  nothing.
- **Brand, reputation, and mission value** — real enough to motivate the whole
  project, and not something to put a dollar sign on.
- **Payer-mix shifts** — teaching status can change a hospital's case mix over a
  decade, in a direction that depends on the local market rather than on the
  program.

If these matter to your case, argue them on their merits alongside the model —
not by inflating a number inside it.

## Known simplifications

- **Annual FTE counting**, not per-pay-period. Real cost reports count FTE by
  time period; the model works in whole training years.
- **Professional-fee neutrality** between 1:2 teaching and 1:4 medical direction.
  The model prices the supervision *cost* difference and assumes per-room
  professional revenue is approximately the same in both modes.
- **Single sponsor-hospital P&L.** Value delivered at participating sites, and
  the finances of the anesthesia group as distinct from the hospital, are out of
  frame.
- **State Medicaid GME is not escalated.** Appropriations and per-resident rates
  routinely sit flat for years; growing them would flatter the case.
- **No state income or B&O tax effects.**
- **Expected values, not distributions.** Cohorts stay fractional after
  attrition; the tornado is the substitute for a Monte Carlo.

---

## Regional salary data (BLS OEWS)

The **Community salaries** section includes a region picker that fills the
anesthesiologist and CRNA salary fields from real regional data.

- **Source:** U.S. Bureau of Labor Statistics, Occupational Employment and Wage
  Statistics (OEWS) — annual mean wages by state for Anesthesiologists
  (SOC 29‑1211) and Nurse Anesthetists / CRNAs (29‑1151). This is official,
  public-domain data, unlike scraped job-board listings.
- **Market premium:** BLS reports *employed* wages, which typically run below
  the aggressive offers seen on job boards such as gaswork.com. The premium
  slider scales the BLS baseline upward so you can reflect local market offers
  without scraping anyone's site.
- **How it stays current:** `scripts/fetch-bls.mjs` pulls the data from the BLS
  public API and writes `src/data/salaries.json`. The
  `.github/workflows/update-salary-data.yml` workflow runs it yearly (BLS OEWS
  refreshes each spring) and commits any changes. Add a free
  [BLS API key](https://data.bls.gov/registrationEngine/) as the repo secret
  `BLS_API_KEY` to raise the rate limits (it also works without one).

> Note on gaswork.com: it is a job board, not a salary dataset — pay lives in
> free-text postings, it blocks automated access, and republishing its listings
> would raise terms-of-use concerns. BLS OEWS is the right source for regional
> averages; use gaswork as a manual spot-check to set the market premium.

## Project structure

```
src/
  model/            # Pure, tested financial model (no UI dependencies)
    types.ts        # All input/output types
    constants.ts    # CMS constants + national ballpark defaults
    gme.ts          # Medicare DGME/IME, cap building, rolling average, Medicaid
    clinical.ts     # Coverage FTE, labor substitution, supervision cost
    program.ts      # Program leadership, overhead, per-resident costs
    workforce.ts    # Retention pipeline and call coverage (avoided costs)
    sensitivity.ts  # Tornado analysis over a fixed variable list
    model.ts        # Projection frame: escalation, pre-revenue years, NPV
    model.test.ts       # Vitest unit tests
    sensitivity.test.ts
    regression.test.ts  # Frozen defaults + property tests
  ui/               # React interface (inputs → live results)
    App.tsx
    components/
    styles.css
```

The `model/` layer is deliberately independent of the UI — it can be imported
into a spreadsheet exporter, an API, or a test harness without React.

---

## Important caveats

- **These are directional planning estimates, not accounting or legal advice.**
  The default assumptions are national ballpark figures and *must* be localized
  (salaries, the hospital's specific Per-Resident Amount, IME base payments, cap
  status, Medicaid program) before any number is relied upon.
- GME reimbursement rules are intricate and change; consult your GME office and
  a reimbursement specialist for authoritative figures.
- The model deliberately omits several real but unquantifiable effects — see
  *What this model deliberately excludes* above. They generally strengthen the
  case beyond what the dollars alone show.
- **A negative NPV at the defaults is not a verdict on your hospital.** The
  shipped defaults describe a generic community hospital becoming a teaching
  hospital for the first time; the PRA determination, the cap, and the local
  CRNA market move the answer by millions. Localize before concluding anything.

---

*Built for anesthesiology program planning. Contributions and refinements to the
assumptions are welcome.*
