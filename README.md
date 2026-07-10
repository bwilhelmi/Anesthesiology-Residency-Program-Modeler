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

### Benefits

| Benefit | How it's modeled |
| --- | --- |
| **Medicare Direct GME (DGME)** | `PRA × fundable resident FTE × Medicare inpatient share`. Reimburses direct training costs. |
| **Medicare Indirect Medical Education (IME)** | An add-on percentage on Medicare inpatient PPS payments: `IME% = 1.35 × [(1 + r)^0.405 − 1]`, where `r` is the resident-to-bed ratio. Because IME is nonlinear, the tool credits the *marginal* IME from adding the new residents on top of any existing ones. |
| **Medicaid GME** | Flat per-resident state support (0 in states without a program). Not subject to the Medicare cap. |
| **Clinical labor substitution** | Residents help staff anesthetizing locations under supervision, offsetting more expensive CRNA/locum coverage. Valued at the fully-loaded CRNA cost of the anesthetist-equivalent coverage each resident level provides. |
| **Off-service / intern service value** | During required non-anesthesia rotations (mainly the intern year), residents deliver service value to host departments (ICU, medicine, surgery, pain), valued against a mid-level provider. |

### Costs

| Cost | How it's modeled |
| --- | --- |
| **Resident stipends + benefits** | Headcount × fully-loaded stipend. |
| **Program leadership & administration** | Program Director and Associate PD protected (non-clinical) time valued at the anesthesiologist rate, program coordinator salary, and non-billable faculty teaching effort. |
| **Fixed program overhead** | ACGME/accreditation fees, recruitment, simulation, resident education funds. |
| **Teaching efficiency loss** | Lost clinical margin from slower teaching cases, weighted toward junior residents. |
| **One-time startup cost** | Application, consultants, and initial build-out — amortized into the multi-year view. |

---

## The Medicare resident cap

The single most important switch in the model is whether the hospital is **at
its Medicare resident FTE cap**. Caps were largely fixed from a mid-1990s base
year. Consequences:

- **Under cap:** new anesthesia residents (up to the remaining headroom) generate
  new DGME and IME revenue — often the difference between a program that pays for
  itself and one that doesn't.
- **At cap:** residents above the headroom generate **no additional** Medicare
  DGME or IME. Their financial case rests entirely on clinical labor value,
  Medicaid support, and mission value.

The tool honors this by only counting *fundable* FTE (those within the headroom)
toward Medicare revenue, while clinical value accrues for every resident.

---

## The intern year vs. the CA years

Per the ACGME anesthesiology program requirements, the training years differ
sharply in where the resident's value lands:

- **PGY-1 (Clinical Base / intern year):** mostly required off-service rotations
  (critical care, medicine, surgery, emergency medicine, etc.) with limited
  anesthesia exposure. Modeled as low anesthesia coverage but meaningful
  service value to host departments.
- **PGY-2 → PGY-4 (CA-1 → CA-3):** the resident spends nearly the whole year
  delivering anesthesia under supervision, with coverage capability that ramps
  from a fraction of a CRNA (junior, closely supervised, slower cases) toward
  near-independent senior coverage.

Each level's parameters — fraction of the year on anesthesia, CRNA-equivalent
coverage, off-service coverage — are editable in the **Resident clinical value by
year** section.

---

## Supervision & billing ratios

Resident coverage is economically attractive because of Medicare's teaching
rules: a teaching anesthesiologist can supervise up to **2 concurrent resident
cases** and bill 100% of the base units, versus medically directing up to **4
concurrent CRNA cases**. These ratios are exposed as inputs so you can reflect
your own staffing model and local interpretation.

---

## Project structure

```
src/
  model/            # Pure, tested financial model (no UI dependencies)
    types.ts        # All input/output types
    constants.ts    # CMS constants + national ballpark defaults
    gme.ts          # Medicare DGME, IME, Medicaid, cap logic
    clinical.ts     # Resident labor substitution & coverage FTE
    program.ts      # Program leadership / overhead costs
    model.ts        # Top-level orchestration (ramp years + steady state)
    model.test.ts   # Vitest unit tests
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
- The model omits harder-to-quantify strategic value (recruitment pipeline,
  quality, reputation, faculty retention) — these typically strengthen the case
  beyond what the dollars alone show.

---

*Built for anesthesiology program planning. Contributions and refinements to the
assumptions are welcome.*
