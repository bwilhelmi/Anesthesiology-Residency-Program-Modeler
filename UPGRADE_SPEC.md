# UPGRADE_SPEC.md — Anesthesiology Residency Program Modeler v2

**Audience:** Claude Code, working in the root of `Anesthesiology-Residency-Program-Modeler`.
**Goal:** Fix known analytic defects and extend the model to a defensible, CFO-grade
cost/benefit tool for establishing an ACGME anesthesiology residency.

---

## How to work

1. Execute phases **in order** (P0 → P7). Each phase must end with `npm run typecheck`
   and `npm test` passing before starting the next. Commit per phase with message
   `P<n>: <summary>`.
2. **Model purity:** everything under `src/model/` stays pure TypeScript (no React, no
   I/O). UI wiring happens only in `src/ui/`.
3. **No new runtime dependencies.** Vitest for tests, plain React + CSS for UI. Tornado
   chart is rendered with plain `<div>` bars, not a chart library.
4. Every new numeric assumption becomes an **explicit, user-overridable input** with a
   default in `constants.ts`, a doc comment stating the source/rationale, and (where a
   public source exists) an entry in `src/ui/components/References.tsx`. Never bury a
   constant inside a formula.
5. Every regulatory formula gets a code comment citing the CFR/statute section given in
   this spec. Do not invent citations; if this spec doesn't provide one, mark the
   comment `// TODO(source)`.
6. Preserve backward compatibility of exported function names where feasible; where a
   signature must change, update all call sites and tests in the same phase.
7. Update `README.md` at the end (P7) to match the final model, including the new
   benefit/cost tables and the Medicare-mechanics section.
8. Keep all monetary values in **year-1 dollars at input time**; escalation happens
   inside the projection (P3). Note this in the `types.ts` header comment.

## Repo map (current)

```
src/model/constants.ts   defaults + CMS constants
src/model/types.ts       all input/output types
src/model/gme.ts         DGME / IME / Medicaid calculations
src/model/clinical.ts    coverage FTE, labor substitution, off-service value
src/model/program.ts     leadership, faculty teaching, overhead costs
src/model/model.ts       runModel(): ramp years + steady state
src/model/model.test.ts  vitest suite
src/ui/App.tsx           input form, patch helpers
src/ui/components/…      Results, References, pickers
```

---

# P0 — Correctness fixes (these change today's answers)

### P0.1 Incremental attending supervision cost (largest known error)

**Problem.** `SupervisionInputs` (`maxCrnaSupervisionRatio`, `maxResidentSupervisionRatio`)
are collected in the UI but never consumed by the economics. The labor-substitution
benefit credits a full loaded CRNA per covered location while ignoring that resident
coverage drops the attending from 1:4 medical direction (42 CFR 415.110) to 1:2
teaching-rule concurrency (42 CFR 415.178). That extra attending time is a real cost the
model currently omits, overstating the labor benefit by roughly 40–45% at defaults.

**Change.**
- In `clinical.ts`, add:

```ts
/**
 * Incremental attending supervision cost per resident-covered location:
 * attendings cover fewer concurrent rooms with residents (1:2 under the
 * Medicare teaching rule, 42 CFR 415.178) than with CRNAs under medical
 * direction (1:4, 42 CFR 415.110). Professional-fee revenue per room is
 * treated as approximately neutral between the two staffing modes; the
 * economic delta is on the supervision-cost side.
 */
export function incrementalSupervisionCostPerLocation(
  salaries: SalaryInputs,
  supervision: SupervisionInputs
): number {
  const attendingLoaded = loaded(salaries.anesthesiologistSalary, salaries.benefitLoadRate);
  const perRoomWithResidents = 1 / Math.max(1, supervision.maxResidentSupervisionRatio);
  const perRoomWithCrnas = 1 / Math.max(1, supervision.maxCrnaSupervisionRatio);
  return Math.max(0, attendingLoaded * (perRoomWithResidents - perRoomWithCrnas));
}
```

- In `model.ts` `computeYear()`, add a **cost** `LineItem`:
  - `key: "supervision"`, `label: "Incremental attending supervision (1:2 teaching vs 1:4 direction)"`
  - `amount = totalCoveredLocations × incrementalSupervisionCostPerLocation(...)`
    where `totalCoveredLocations` is the same coverage-FTE total used for the labor
    benefit (post-P0.2 semantics, post-P0.4 demand cap).
- **Test:** 10 covered locations, attending loaded \$500,000, ratios 2 vs 4 →
  `10 × 500000 × (0.5 − 0.25) = 1,250,000`.

### P0.2 Un-double-count the teaching throughput loss

**Problem.** `teachingThroughputLoss` is applied twice: once inside
`coverageFteForYear()` (shrinking the labor credit) and again as lost margin per covered
location in `computeYear()`. One parameter is driving two distinct channels.

**Change.**
- `coverageFteForYear()` becomes pure staffing equivalence:
  `coverageFte = fractionOnAnesthesia × anesthesiaCoverageFte` (drop the loss factor;
  keep the non-negative clamp). Update its doc comment: slower individual case conduct
  is already reflected in the per-level `anesthesiaCoverageFte` ramp.
- Rename `EfficiencyInputs.teachingThroughputLoss` → `caseThroughputLoss` and charge it
  **once**, as today's margin-loss line, still weighted by `juniorityWeight()`.
- Recalibrate defaults so steady-state net at defaults moves < ~5% vs. the intended
  economics: set `caseThroughputLoss: 0.08` and lower `DEFAULT_CLINICAL`
  `anesthesiaCoverageFte` to `{PGY1: 0.30, PGY2: 0.50, PGY3: 0.70, PGY4: 0.85}` with a
  comment that these are net-of-slowdown staffing equivalences.
- **Test:** with `caseThroughputLoss = 0`, labor benefit equals
  `Σ n × fraction × coverage × crnaLoaded` exactly (no hidden discount).

### P0.3 Coverage cannot exceed staffed-location demand

**Problem.** Nothing stops modeled resident coverage from exceeding the rooms the
hospital actually runs; the labor benefit scales without bound in `residentsPerClass`.

**Change.**
- In `computeYear()`, compute `demand = staffedLocationDemand(inputs)` and
  `rawCoverage = Σ coverage`. If `rawCoverage > demand`, scale **labor benefit,
  supervision cost, and throughput loss** by `demand / rawCoverage` and push a warning
  (see P0.6) explaining that excess residents add cost but no additional coverage value.
- **Test:** doubling `residentsPerClass` beyond demand doubles stipend cost but leaves
  the labor line flat at the capped value; warning present.

### P0.4 Resident benefit load is not 25%

**Problem.** A uniform 25% load on a \$68k stipend understates real resident benefits
(health premiums don't scale with salary; typical all-in benefits run \$25–30k, ≈40%).

**Change.**
- Add `SalaryInputs.residentBenefitAnnual: number` (absolute dollars, default `28_000`)
  and use `residentSalary + residentBenefitAnnual` as the loaded resident cost in
  `residentSalaryCost()`. Attendings/CRNAs keep the percentage load.
- **Test:** loaded resident cost at defaults = `68_000 + 28_000 = 96_000`.

### P0.5 Clarify the two Medicare bases (labels + semantics only)

- Rename `gme.medicareInpatientShare` doc + UI label to **"Medicare share of inpatient
  days (FFS + Medicare Advantage)"** — DGME is apportioned on the Medicare utilization
  ratio including MA days (see 42 CFR 413.76 et seq.; MA-related DGME is paid via the
  associated add-on stream).
- Rename `gme.medicareInpatientOperatingPayments` label to **"Medicare inpatient
  operating base payments subject to the IME add-on (FFS DRG payments excluding the IME
  and DSH add-ons themselves; include the MA-related IME base if modeling MA IME)"**.
  Field name in code may stay; help text must change.
- No formula change in this task.

### P0.6 Warnings channel

- Add `warnings: string[]` to `YearResult` and `ModelResult` (result-level = de-duped
  union). Emit warnings for: coverage capped at demand (P0.3);
  `maxResidentSupervisionRatio > 2` ("exceeds the Medicare teaching-rule concurrency in
  42 CFR 415.178"); `maxCrnaSupervisionRatio > 4` ("exceeds medical-direction limit in
  42 CFR 415.110"); steady-state new FTE > cap headroom in `existingUnderCap` mode (P1).
- UI: render warnings in a visible banner above Results.

---

# P1 — Medicare GME mechanics done right

Replace the binary `atMedicareCap` toggle with an explicit **hospital scenario**. This
is the single largest real-world lever the current model cannot see.

### P1.1 New types

```ts
export type HospitalGmeScenario =
  | "newTeachingHospital"    // no existing cap or PRA; cap is BUILT by this program
  | "existingUnderCap"       // has a cap with headroom
  | "atCap";                 // cap fully used; only awarded slots create funded FTE

export interface GmeFundingInputs {
  scenario: HospitalGmeScenario;
  capHeadroomFte: number;            // existingUnderCap only
  awardedNewSlots: number;           // CAA 2021 §126 / CAA 2023 §4122 slot awards (default 0)
  directGmePerResidentAmount: number;        // PRA (existing hospitals)
  newHospitalProjectedCostPerFte: number;    // newTeachingHospital: projected allowable GME cost/FTE, year 1
  localityWeightedMeanPra: number;           // newTeachingHospital: comparator PRA
  medicareInpatientShare: number;
  medicareInpatientOperatingPayments: number;
  medicareCapitalPayments: number;           // 0 disables capital IME
  availableBeds: number;
  existingResidentFte: number;
  applyImeRatioCap: boolean;                 // default true
  applyRollingAverage: boolean;              // default true
  medicaid: MedicaidGmeInputs;               // see P4.4
}
```

Program-length constant: `export const PROGRAM_LENGTH_YEARS = 4;` (anesthesiology's
minimum accredited length; equals its initial residency period, so `DGME_FTE_WEIGHT`
stays 1.0 — keep the existing comment).

### P1.2 Cap building for `newTeachingHospital` — 42 CFR 413.79(e)(1)

- During program years 1–5 (the cap-building window), **fundable FTE = actual new FTE**
  (no cap yet).
- The permanent cap is set from year 6 onward:
  `cap = highestSingleProgramYearFte(year 5) × PROGRAM_LENGTH_YEARS`.
  With even classes this is `residentsPerClass × 4`. Implement generally: take
  `max(residentsByYear[...])` in program year 5 (post-attrition, post-siteShare —
  use the Medicare-countable FTE from P2).
- From year 6 onward: `fundable = min(countableFte, cap)`.
- Cite `42 CFR 413.79(e)(1)` in the code comment.

### P1.3 Rolling average — 42 CFR 413.79(d)

- When `applyRollingAverage` is true, DGME/IME payment FTE in year *t* uses the 3-year
  rolling average `avg(FTE_t, FTE_{t-1}, FTE_{t-2})`, **except** that FTE residents in a
  *new* program are excluded from the rolling average during the new-program growth
  window (implement as program years 1–5, aligned with the cap-building window; cite
  `42 CFR 413.79(d)(5)` and note in the comment that the exclusion applies to new
  programs at existing teaching hospitals as well).
- Practical effect to verify in tests: for a brand-new program the ramp years pay on
  actual FTE; from year 6 the average trails by up to two years if headcount is still
  changing.

### P1.4 IME ratio cap — 42 CFR 412.105(a)(1)

- When `applyImeRatioCap` is true, the resident-to-bed ratio used in year *t* is
  `min(actualRatio_t, priorYearRatio)`, with the new-program exception during the growth
  window (same years 1–5; cite `42 CFR 412.105(f)(1)(v)` for the new-program FTE
  treatment).
- `marginalIme()` becomes year-aware: it needs `programYear` and prior-year ratio.
  Refactor signature to `marginalIme(countableNewFte, gme, ctx: {programYear, priorRatio})`.

### P1.5 Capital IME (optional line)

- If `medicareCapitalPayments > 0`, add benefit line:
  `capitalIme = medicareCapitalPayments × [e^(0.2822 × r) − 1]` marginal vs. existing
  FTE, same countable-FTE and ratio-cap treatment. Cite `42 CFR 412.322`.
- Default `0` (off) so existing outputs don't silently change.

### P1.6 PRA for a new teaching hospital — 42 CFR 413.77(e)

- Effective PRA when `scenario === "newTeachingHospital"`:
  `pra = min(newHospitalProjectedCostPerFte, localityWeightedMeanPra)`.
- Doc comment must flag: (a) this is a **one-shot, permanent** determination made from
  the early cost-report years — the highest-leverage number in the whole model; (b)
  hospitals stuck with very low/zero historical PRAs or de-minimis caps may qualify for
  a reset under CAA 2021 §131 — surface this as a UI hint, not a calculation.

### P1.7 Awarded slots

- `awardedNewSlots` adds fundable headroom in `existingUnderCap` and is the **only**
  source of funded FTE in `atCap`. UI help text: "Slots awarded under CAA 2021 §126
  (1,000 slots phased FY2023–FY2027) or CAA 2023 §4122 (200 slots, FY2026, ≥100
  psychiatry-directed) via the CMS application process."

### P1.8 Tests (minimum set)

- New hospital, 6/class, no attrition: fundable FTE by year = 6, 12, 18, 24, 24; cap
  from year 6 = 24; year-6 payment FTE with rolling average = 24 (window ended, average
  of 24,24,24 once stabilized — assert the transition explicitly).
- Existing hospital, headroom 10, steady-state new FTE 24 → funded 10 + warning.
- `atCap` with `awardedNewSlots = 5` → funded 5.
- Ratio cap: bed count 350, existing 0, new program ratio grows each ramp year without
  being clipped (growth-window exception), then holds.
- PRA: `min(120k, 105k) = 105k` drives DGME when scenario is new hospital.

---

# P2 — FTE realism: site allocation, countable time, attrition

### P2.1 Multi-site FTE allocation

**Problem.** `totalFte = totalResidents` assumes every resident-hour lands at the
sponsor hospital. Medicare FTEs count at the hospital (or countable non-provider
setting) where the training occurs, and clinical value accrues where the resident is
standing. PGY-1s on required off-service rotations at participating sites (county
hospital, VA, etc.) generate neither sponsor Medicare FTE nor sponsor coverage for
those months.

**Change.**
- Add to `ResidentYearClinicalParams`:
  - `sponsorSiteShare: number` — fraction of the training year spent at the sponsor
    hospital (defaults: PGY1 `0.5`, PGY2 `0.85`, PGY3 `0.85`, PGY4 `0.9`).
  - `imeCountableShare: number` — fraction of sponsor-site time countable for IME
    (patient-care activities; pure research is not IME-countable). Default `0.95`
    for all years. Comment: `// 42 CFR 412.105(f) — patient care activities; didactics
    and approved activities per current rule text; research excluded.`
- Medicare countable FTE per resident-year:
  `dgmeFte = sponsorSiteShare` (×1.0 IRP weight);
  `imeFte = sponsorSiteShare × imeCountableShare`.
- Clinical labor, supervision cost, and throughput loss all scale by
  `sponsorSiteShare` (replacing nothing — `fractionOnAnesthesia` already handles the
  on-anesthesia split *within* sponsor time; document the composition:
  `coverage = sponsorSiteShare × fractionOnAnesthesia × anesthesiaCoverageFte`).
  **Re-express** the existing `fractionOnAnesthesia` defaults as *conditional on being
  at the sponsor site* and adjust defaults so PGY-1 composite exposure stays ≈ the
  current intent (e.g., PGY1 `fractionOnAnesthesia: 0.3` with `sponsorSiteShare: 0.5`).
- Off-service value: credit only the **sponsor-site** off-service time
  (`sponsorSiteShare × (1 − fractionOnAnesthesia)`); value delivered at other
  institutions is not the sponsor's benefit. Update the line-item detail string.
- Stipends: sponsor pays full stipends regardless of site (default). Add
  `ProgramCostInputs.participatingSiteSupportAnnual: number` (default `0`) as a
  catch-all for affiliation-agreement payments in either direction (positive = sponsor
  pays out).

### P2.2 Attrition

- Add `ModelInputs.annualAttritionRate` (default `0.02`). Headcount for class *c* in
  program year *t*: `residentsPerClass × (1 − rate)^(yearsInProgram)`. Do **not** round;
  FTEs are fractional. Applies to costs and benefits symmetrically.
- **Test:** rate `0.1`, 10/class → PGY-4 cohort at steady state = `10 × 0.9^3 = 7.29`.

### P2.3 Tests

- With `sponsorSiteShare` PGY1 = 0.5: sponsor DGME FTE for a 6-intern class = 3.0.
- Coverage composition test: one PGY-2, share 0.85, fraction 0.82, coverage 0.5 →
  covered locations `0.3485`.

---

# P3 — Money over time: horizon, escalation, discounting, pre-revenue period

### P3.1 Projection frame

- New `ProjectionInputs`:

```ts
export interface ProjectionInputs {
  horizonYears: number;        // default 10 (program years 1..10)
  preRevenueYears: number;     // default 2 (accreditation + recruitment before year 1)
  discountRate: number;        // default 0.06 (hospital hurdle/WACC proxy)
  salaryInflation: number;     // default 0.03 (applies to all wages/benefits)
  praUpdateRate: number;       // default 0.025 (CPI-U proxy per 42 CFR 413.77 updates)
  paymentBaseGrowth: number;   // default 0.025 (IME base + margins)
}
```

- `runModel()` returns `years: YearResult[]` for `t = −preRevenueYears … horizonYears`
  (model pre-revenue years as `programYear` 0 and −1 with zero residents).
- Pre-revenue years carry: `startupCost` split evenly across them, PD at
  `programDirectorFte × 0.5` protected time in year −1 (hired early), coordinator from
  year −1, plus `fixedAnnualProgramOverhead × 0.5` in year −1 only. Document each as an
  assumption in the line-item detail.
- Escalate in-year: wages/benefits by `salaryInflation^t`, PRA by `praUpdateRate^t`,
  IME base + `annualMarginPerStaffedLocation` + off-service provider cost by
  `paymentBaseGrowth^t` (t measured from year 1 = 1.0).

### P3.2 Summary metrics

- Replace `fiveYearCumulativeNet` with:

```ts
export interface ModelSummary {
  nominalCumulativeNet: number;   // Σ net_t over the full frame
  npv: number;                    // Σ net_t / (1 + d)^(t + preRevenueYears)
  breakevenYear: number | null;   // first program year with cumulative NPV ≥ 0
  steadyStateAnnualNet: number;   // undiscounted steady-state year net
}
```

- Keep a deprecated `fiveYearCumulativeNet` getter (nominal Σ years 1–5) so any external
  links/tests don't break silently; mark `@deprecated`.
- **Tests:** hand-computed 3-year toy fixture for NPV; breakeven `null` when never
  positive; discount rate 0 ⇒ `npv === nominalCumulativeNet`.

---

# P4 — Missing cost and benefit lines

### P4.1 New per-resident recurring costs (`ProgramCostInputs`)

| Field | Default | Note |
| --- | --- | --- |
| `residentLiabilityAnnual` | `7_500` | Professional liability per resident (institutional policy allocation). |
| `gmeInstitutionalOverheadPerResident` | `15_000` | DIO/GMEC/GME-office allocation required by ACGME Institutional Requirements. |
| `perResidentFeesAnnual` | `4_000` | ERAS/NRMP share, ITE, ABA BASIC/board fees, training licenses, ACLS/PALS. |

Add as one cost line: "Per-resident program costs (liability, GME office, fees)" =
`totalResidents × (sum of the three)`, escalated with `salaryInflation`.

### P4.2 Retention pipeline benefit (quantifiable, defensible)

- New `RetentionInputs`:

```ts
export interface RetentionInputs {
  enabled: boolean;              // default true
  retentionRate: number;         // default 0.30 — share of grads hired by the hospital/group
  avoidedCostPerRetainedHire: number; // default 400_000 — recruiting + signing + locum bridge avoided
  benefitRecognitionYears: number;    // default 1 — recognize in the graduation year only
}
```

- Benefit line from the first graduation year (program year 4 + 1 = 5) onward:
  `graduatesThatYear × retentionRate × avoidedCostPerRetainedHire`. Graduates = the
  PGY-4 cohort headcount (post-attrition).
- Detail string must call it what it is: avoided recruitment/locum/vacancy cost, not
  revenue.

### P4.3 Resident call coverage (default OFF)

- `CallCoverageInputs { enabled: boolean; nightsPerYearCovered: number; avoidedCostPerNight: number; }`
  defaults `{ enabled: false, nightsPerYearCovered: 365, avoidedCostPerNight: 2_000 }`.
- When enabled, benefit = product, flat from the first year with CA-2s (program year 3).
  Comment: this overlaps conceptually with daytime labor substitution only if the user
  double-counts; the help text must say "value of overnight in-house coverage that
  would otherwise be CRNA call stipends/OT or locum nights — do not enable if your
  coverage FTEs already include call."

### P4.4 Medicaid GME — mode-aware (`MedicaidGmeInputs`)

```ts
export type MedicaidGmeMode = "none" | "perResident" | "appropriation";
export interface MedicaidGmeInputs {
  mode: MedicaidGmeMode;          // default "perResident"
  perResidentAmount: number;      // used in perResident mode (default 0)
  annualAppropriationTotal: number; // used in appropriation mode: fixed pool $ to this hospital
  requiresLocalMatch: boolean;    // appropriation mode: e.g., AZ AHCCCS IGA non-federal share
}
```

- `perResident`: current behavior (not Medicare-capped).
- `appropriation`: flat `annualAppropriationTotal` per year **independent of FTE
  count**, with a warning when `requiresLocalMatch` is true and the amount > 0:
  "Appropriation/IGA-based Medicaid GME (e.g., Arizona AHCCCS) requires a funded
  intergovernmental agreement for the non-federal share — treat as \$0 until an IGA
  sponsor is committed." Keep References entry #3 (AHCCCS) attached to this input.

### P4.5 Tests

- Retention: 6/class, attrition 0, rate 0.3, \$400k → \$720,000/yr from program year 5.
- Medicaid appropriation mode ignores resident count; warning fires with match flag.

---

# P5 — Sensitivity analysis (tornado + scenarios)

### P5.1 Tornado module (`src/model/sensitivity.ts`)

- Pure function:

```ts
export interface TornadoBar { key: string; label: string; low: number; high: number; }
export function tornado(
  inputs: ModelInputs,
  metric: (r: ModelResult) => number,   // default: r => r.summary.npv
  swing?: number                         // default 0.20 (±20%)
): TornadoBar[];
```

- One-at-a-time perturbation of this fixed variable list (each entry knows how to
  patch `ModelInputs` immutably): PRA / effective PRA, `capHeadroomFte` (or awarded
  slots in `atCap`), `medicareInpatientShare`, `medicareInpatientOperatingPayments`,
  `crnaSalary`, `anesthesiologistSalary`, global multiplier on all
  `anesthesiaCoverageFte`, `caseThroughputLoss`, `maxResidentSupervisionRatio` (swing
  between 1 and 2, not ±20%), `retentionRate`, `discountRate` (absolute ±2 pts, not
  relative), `residentsPerClass` (±1 whole resident).
- Sort bars by `|high − low|` descending. Return the *metric values*, not deltas, so the
  UI can draw around the base case.
- **Tests:** deterministic ordering on a fixture; a variable with no pathway to the
  metric (e.g., retention disabled) produces a zero-width bar.

### P5.2 Scenario presets

- `export const SCENARIOS: Record<"conservative"|"base"|"favorable", Partial<ModelInputs>>`
  in `constants.ts`, documented per assumption. Conservative: coverage −20%, retention
  0.15, throughput loss 0.12, discount 0.08. Favorable: coverage +10%, retention 0.45,
  throughput loss 0.05, discount 0.05. UI: three buttons that patch the current inputs
  (non-destructive: show a "modified from base" chip).

### P5.3 Results UI

- Headline block: **NPV**, breakeven year, steady-state annual net, nominal cumulative —
  in that order.
- Tornado: horizontal div-bars around a base-case axis line, labeled with the low/high
  metric values, top 8 bars by default with a "show all" toggle.
- Year table now spans the full frame (pre-revenue years shaded), and keeps the
  per-line-item breakdown for the selected year.
- Warnings banner (P0.6) above everything.

---

# P6 — UI wiring for every new input

- Extend `App.tsx` patch helpers for the new input groups: scenario picker
  (`HospitalGmeScenario` radio with contextual fields), projection group, retention,
  call coverage, Medicaid mode, per-resident costs, `sponsorSiteShare` /
  `imeCountableShare` per PGY (place beside the existing per-year clinical fields),
  attrition.
- Every new field uses the existing `Field` component with a `help` string matching the
  doc comments above, and a `<Cite>` superscript where a References entry exists.
- Input validation (soft, via warnings — never block typing): shares/fractions clamped
  to [0,1] on blur; ratios ≥ 1.

---

# P7 — References, README, and regression net

### P7.1 `References.tsx` additions (append; do not renumber)

Add entries with these labels/URLs:

- 42 CFR 413.79 — Direct GME FTE caps, rolling average, new-program cap building —
  `https://www.ecfr.gov/current/title-42/chapter-IV/subchapter-B/part-413/subpart-F/section-413.79`
- 42 CFR 413.77 — Per-resident amounts (incl. new teaching hospitals) —
  `https://www.ecfr.gov/current/title-42/chapter-IV/subchapter-B/part-413/subpart-F/section-413.77`
- 42 CFR 412.105 — IME adjustment (operating), resident-to-bed ratio —
  `https://www.ecfr.gov/current/title-42/chapter-IV/subchapter-B/part-412/subpart-G/section-412.105`
- 42 CFR 412.322 — IME adjustment (capital) —
  `https://www.ecfr.gov/current/title-42/chapter-IV/subchapter-B/part-412/subpart-M/section-412.322`
- 42 CFR 415.110 — Medically directed anesthesia (1:4) —
  `https://www.ecfr.gov/current/title-42/chapter-IV/subchapter-B/part-415/subpart-C/section-415.110`
- 42 CFR 415.178 — Teaching-setting anesthesia (two concurrent resident cases) —
  `https://www.ecfr.gov/current/title-42/chapter-IV/subchapter-B/part-415/subpart-D/section-415.178`
- CMS — Direct GME & new residency slot distributions (CAA 2021 §126 / §131; CAA 2023
  §4122) — `https://www.cms.gov/medicare/payment/prospective-payment-systems/acute-inpatient-pps/direct-graduate-medical-education-dgme`
- ACGME Institutional Requirements (GME office/DIO/GMEC obligations) —
  `https://www.acgme.org/what-we-do/accreditation/institutional-review/`
- ACGME Program Requirements for GME in Anesthesiology (PGY structure, PD protected
  time) — `https://www.acgme.org/specialties/anesthesiology/program-requirements-and-faqs-and-applications/`
- AAMC Survey of Resident/Fellow Stipends and Benefits (stipend + benefit defaults) —
  `https://www.aamc.org/data-reports/students-residents/report/aamc-survey-resident/fellow-stipends-and-benefits`

If any URL 404s at build time, keep the label and cite the parent index page instead —
do not drop the reference.

### P7.2 README rewrite

- Update both tables (benefits/costs) to the final line-item set, add a "Medicare
  mechanics" section covering: the three hospital scenarios, cap building
  (413.79(e)), rolling average (413.79(d)), IME ratio cap (412.105), capital IME
  (412.322), PRA setting for new hospitals (413.77(e)) and the CAA §131 reset note,
  slot awards (§126/§4122).
- Add a "What this model deliberately excludes" section: research/scholarly output,
  quality/outcome effects, downstream referral capture, brand/mission value, payer-mix
  shifts — with one sentence each on why (unquantifiable or hospital-idiosyncratic).
- Add a "Known simplifications" section: annual (not per-pay-period) FTE counting;
  professional-fee neutrality assumption between 1:2 teaching and 1:4 direction; single
  sponsor hospital P&L perspective; no state income/B&O tax effects.

### P7.3 Regression net (final gate)

- Snapshot test: `runModel(DEFAULT_INPUTS)` summary values frozen (update once,
  intentionally, in this phase with a comment block explaining the delta vs. v1:
  supervision cost added, double-count removed, demand cap, benefits load, horizon/NPV).
- Property tests (plain vitest loops, no new deps):
  1. `residentsPerClass = 0` ⇒ every benefit and resident-driven cost is 0; only
     leadership/coordinator/overhead and startup remain.
  2. NPV is monotonically non-increasing in `discountRate` on the default inputs.
  3. Setting `scenario = "atCap"` with `awardedNewSlots = 0` zeroes DGME/IME but not
     Medicaid/labor lines.
  4. Doubling `availableBeds` strictly decreases marginal IME (fixed FTE > 0).
- `npm run typecheck && npm test && npm run build` must all pass. Fix any UI type
  breaks introduced by renamed fields.

---

## Definition of done

- [ ] All phases committed in order, tests green at each phase boundary.
- [ ] No formula contains an unlabeled numeric literal (CMS statutory constants live in
      `constants.ts` with citations).
- [ ] Every new input is visible and editable in the UI with help text.
- [ ] `README.md` matches the shipped model.
- [ ] Tornado renders and re-sorts live as inputs change.
- [ ] Warnings fire for: coverage > demand, ratios beyond Medicare limits, headroom
      shortfall, unmatched appropriation-mode Medicaid.

## Domain constants supplied by this spec (do not re-derive)

| Constant | Value | Source |
| --- | --- | --- |
| IME operating multiplier | 1.35 | 42 CFR 412.105(d) formula factor (post-BBA level) |
| IME operating exponent | 0.405 | 42 CFR 412.105 |
| Capital IME form | e^(0.2822·r) − 1 | 42 CFR 412.322 |
| Anesthesiology min accredited length / IRP | 4 years | ACGME anesthesiology requirements; 42 CFR 413.79 IRP rules |
| Medical direction concurrency limit | 4 | 42 CFR 415.110 |
| Teaching anesthesia concurrency at full payment | 2 resident cases | 42 CFR 415.178 |
| Cap-building window / new-program rolling-average exclusion | 5 program years | 42 CFR 413.79(e)(1), 413.79(d)(5) |

Anything not in this table that needs a regulatory value: stop and add
`// TODO(source)` rather than guessing.
