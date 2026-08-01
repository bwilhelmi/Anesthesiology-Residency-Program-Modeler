import React from "react";
import {
  DEFAULT_INPUTS,
  RESIDENCY_YEARS,
  SCENARIOS,
  SCENARIO_LABELS,
  YEAR_LABELS,
  crnaCostOfCoverage,
  effectivePra,
  runModel,
  staffedLocationDemand,
  steadyStateCoverageFte,
  tornado,
  type ModelInputs,
  type ResidencyYear,
} from "../model";
import {
  ChoiceField,
  NumberField,
  PercentField,
  Section,
  SliderField,
  ToggleField,
} from "./components/Field";
import { Results } from "./components/Results";
import { RegionPicker } from "./components/RegionPicker";
import { HospitalPicker } from "./components/HospitalPicker";
import { Bibliography } from "./components/References";
import { currency, number, percent } from "./format";

/**
 * Bumped whenever the input shape changes incompatibly. The restore below is a
 * shallow merge, so a v1 payload would reinstate an entire stale `gme` object
 * (with the old cap boolean and no Medicaid mode) and break the model — a new
 * key retires those saves instead of half-restoring them.
 */
const STORAGE_KEY = "anesthesia-residency-model-inputs-v3";

function loadInitial(): ModelInputs {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) return { ...DEFAULT_INPUTS, ...JSON.parse(raw) };
  } catch {
    /* ignore */
  }
  return DEFAULT_INPUTS;
}

export function App() {
  const [inputs, setInputs] = React.useState<ModelInputs>(loadInitial);
  // Grayscale proof: no meaning in this interface may be carried by hue alone,
  // and screens end up printed in board decks. This makes that checkable.
  const [proof, setProof] = React.useState(false);

  React.useEffect(() => {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(inputs));
    } catch {
      /* ignore */
    }
  }, [inputs]);

  const result = React.useMemo(() => runModel(inputs), [inputs]);
  // One model run per variable end — cheap, but not free, so memoize it.
  const tornadoBars = React.useMemo(() => tornado(inputs), [inputs]);
  const demand = staffedLocationDemand(inputs);
  const coverage = steadyStateCoverageFte(inputs);
  // The presets patch the current inputs rather than replacing them, so a
  // localized salary or bed count survives. The chip says when that has left
  // the shipped defaults behind.
  const modifiedFromBase = React.useMemo(
    () => JSON.stringify(inputs) !== JSON.stringify(DEFAULT_INPUTS),
    [inputs]
  );

  // Immutable nested update helpers.
  const patch = (p: Partial<ModelInputs>) => setInputs((i) => ({ ...i, ...p }));
  const patchSalaries = (p: Partial<ModelInputs["salaries"]>) =>
    setInputs((i) => ({ ...i, salaries: { ...i.salaries, ...p } }));
  const patchLoc = (p: Partial<ModelInputs["locations"]>) =>
    setInputs((i) => ({ ...i, locations: { ...i.locations, ...p } }));
  const patchGme = (p: Partial<ModelInputs["gme"]>) =>
    setInputs((i) => ({ ...i, gme: { ...i.gme, ...p } }));
  const patchMedicaid = (p: Partial<ModelInputs["gme"]["medicaid"]>) =>
    setInputs((i) => ({
      ...i,
      gme: { ...i.gme, medicaid: { ...i.gme.medicaid, ...p } },
    }));
  const patchSup = (p: Partial<ModelInputs["supervision"]>) =>
    setInputs((i) => ({ ...i, supervision: { ...i.supervision, ...p } }));
  const patchProg = (p: Partial<ModelInputs["program"]>) =>
    setInputs((i) => ({ ...i, program: { ...i.program, ...p } }));
  const patchRetention = (p: Partial<ModelInputs["retention"]>) =>
    setInputs((i) => ({ ...i, retention: { ...i.retention, ...p } }));
  const patchCall = (p: Partial<ModelInputs["callCoverage"]>) =>
    setInputs((i) => ({ ...i, callCoverage: { ...i.callCoverage, ...p } }));
  const patchProjection = (p: Partial<ModelInputs["projection"]>) =>
    setInputs((i) => ({ ...i, projection: { ...i.projection, ...p } }));
  const patchEff = (p: Partial<ModelInputs["efficiency"]>) =>
    setInputs((i) => ({ ...i, efficiency: { ...i.efficiency, ...p } }));
  const patchClinical = (
    year: ResidencyYear,
    p: Partial<ModelInputs["clinical"][ResidencyYear]>
  ) =>
    setInputs((i) => ({
      ...i,
      clinical: { ...i.clinical, [year]: { ...i.clinical[year], ...p } },
    }));

  const reset = () => setInputs(DEFAULT_INPUTS);

  return (
    <div className={`app ${proof ? "proof" : ""}`}>
      <header className="app-header">
        <div className="app-header-inner">
          <div>
            <h1>Anesthesiology Residency Program Modeler</h1>
            <p className="tagline">
              Estimate the costs and benefits of establishing an ACGME anesthesiology
              residency at your hospital.
            </p>
          </div>
          <div className="header-actions">
            <div className="scenario-picker" role="group" aria-label="Scenario presets">
              {(Object.keys(SCENARIOS) as Array<keyof typeof SCENARIOS>).map((name) => (
                <button
                  key={name}
                  type="button"
                  className="scenario-btn"
                  onClick={() => patch(SCENARIOS[name])}
                  title={`Apply the ${SCENARIO_LABELS[name].toLowerCase()} assumptions to the current inputs`}
                >
                  {SCENARIO_LABELS[name]}
                </button>
              ))}
              {modifiedFromBase && (
                <span className="chip" title="These inputs differ from the shipped defaults">
                  modified from base
                </span>
              )}
            </div>
            <button
              type="button"
              className="proof-toggle"
              aria-pressed={proof}
              onClick={() => setProof((p) => !p)}
              title="Preview the page in grayscale to check it survives a printed board deck"
            >
              Grayscale proof
            </button>
            <button type="button" className="btn-reset" onClick={reset}>
              Reset to defaults
            </button>
          </div>
        </div>
      </header>

      <main className="layout">
        <div className="inputs">
          <Section
            title="Program size"
            subtitle="How many residents you plan to train"
          >
            <NumberField
              label="Residents per class"
              help="Recruited each year. Steady state has four classes (PGY-1 through PGY-4)."
              value={inputs.residentsPerClass}
              onChange={(v) => patch({ residentsPerClass: Math.max(0, Math.round(v)) })}
              min={0}
              max={40}
            />
            <SliderField
              label="Annual attrition"
              help="Transfers and withdrawals. A class is (1 − rate)^years strong after that many years; cohorts stay fractional because rounding to whole people misstates both cost and Medicare FTE."
              value={inputs.annualAttritionRate}
              onChange={(v) => patch({ annualAttritionRate: v })}
              max={0.15}
            />
            <div className="callout">
              Steady-state complement:{" "}
              <strong>{number(result.steadyState.totalResidents, 1)} residents</strong>{" "}
              after attrition. Anesthetist-equivalent coverage they provide at the sponsor
              hospital: <strong>{number(coverage, 1)} FTE</strong> against a demand of{" "}
              <strong>{number(demand, 1)}</strong> staffed locations/day.
            </div>
          </Section>

          <Section title="Community salaries" subtitle="Local market compensation">
            <RegionPicker
              onApply={(anesthesiologist, crna) =>
                patchSalaries({ anesthesiologistSalary: anesthesiologist, crnaSalary: crna })
              }
            />
            <NumberField
              label="Anesthesiologist salary"
              value={inputs.salaries.anesthesiologistSalary}
              onChange={(v) => patchSalaries({ anesthesiologistSalary: v })}
              prefix="$"
              step={5000}
            />
            <NumberField
              label="CRNA base salary"
              help="Base only. Premium pay is the separate field below, so the two assumptions can be argued separately."
              value={inputs.salaries.crnaSalary}
              onChange={(v) => patchSalaries({ crnaSalary: v })}
              prefix="$"
              step={5000}
            />
            <PercentField
              label="CRNA premium pay (overtime, holidays, differentials)"
              help="Above base. Residents earn a fixed stipend however late the room runs or whichever holiday it falls on — a CRNA does not, so this is part of what resident coverage displaces. 12% is a placeholder: your payroll knows the real figure exactly."
              cite={[13]}
              clamp={{ min: 0, max: 1 }}
              value={inputs.salaries.crnaPremiumPayLoad}
              onChange={(v) => patchSalaries({ crnaPremiumPayLoad: v })}
            />
            <div className="callout">
              One FTE of CRNA coverage costs{" "}
              <strong>{currency(crnaCostOfCoverage(inputs.salaries))}</strong> all in —
              base, premium pay, and fringe. That is the figure resident coverage is
              credited against.
            </div>
            <NumberField
              label="Resident stipend"
              value={inputs.salaries.residentSalary}
              onChange={(v) => patchSalaries({ residentSalary: v })}
              prefix="$"
              step={1000}
            />
            <NumberField
              label="Resident benefits / yr"
              cite={[23]}
              help="Absolute dollars, not a percentage: health premiums, retirement, payroll taxes, liability, licensure. These do not scale with a trainee stipend, so a percentage load understates them (typical all-in: $25k–$30k)."
              value={inputs.salaries.residentBenefitAnnual}
              onChange={(v) => patchSalaries({ residentBenefitAnnual: Math.max(0, v) })}
              prefix="$"
              step={1000}
            />
            <PercentField
              label="Benefit / fringe load (attendings & CRNAs)"
              clamp={{ min: 0, max: 1 }}
              help="Added on top of base salary for benefits, taxes, malpractice. Residents use the absolute figure above instead."
              value={inputs.salaries.benefitLoadRate}
              onChange={(v) => patchSalaries({ benefitLoadRate: v })}
            />
          </Section>

          <Section
            title="Anesthetizing locations"
            subtitle="Where anesthesia is delivered"
          >
            <div className="grid-2">
              <NumberField
                label="Operating rooms"
                value={inputs.locations.operatingRooms}
                onChange={(v) => patchLoc({ operatingRooms: v })}
              />
              <NumberField
                label="Non-OR anesthesia (NORA) sites"
                value={inputs.locations.noraSites}
                onChange={(v) => patchLoc({ noraSites: v })}
              />
              <NumberField
                label="Labor & delivery ORs"
                value={inputs.locations.laborDeliveryORs}
                onChange={(v) => patchLoc({ laborDeliveryORs: v })}
              />
              <NumberField
                label="Outpatient sites"
                value={inputs.locations.outpatientSites}
                onChange={(v) => patchLoc({ outpatientSites: v })}
              />
            </div>
            <SliderField
              label="Average utilization (if concurrent count not set)"
              help="Fraction of physical locations staffed concurrently on a typical day."
              value={inputs.locations.utilizationRate}
              onChange={(v) => patchLoc({ utilizationRate: v })}
            />
            <NumberField
              label="Average concurrent staffed locations (override)"
              help="Set to 0 to derive from utilization above."
              value={inputs.locations.averageConcurrentStaffedLocations}
              onChange={(v) =>
                patchLoc({ averageConcurrentStaffedLocations: Math.max(0, v) })
              }
              step={1}
            />
          </Section>

          <Section
            title="Medicare & Medicaid GME funding"
            subtitle="Cap status and reimbursement inputs"
          >
            <HospitalPicker
              onApply={(a) =>
                patchGme({
                  capHeadroomFte: a.capHeadroomFte,
                  // A hospital in the CMS cost-report data is by definition an
                  // existing teaching hospital; only its headroom is in question.
                  scenario: a.atMedicareCap ? "atCap" : "existingUnderCap",
                  directGmePerResidentAmount: a.directGmePerResidentAmount,
                  availableBeds: a.availableBeds,
                  existingResidentFte: a.existingResidentFte,
                })
              }
            />
            <ChoiceField
              label="Hospital GME scenario"
              cite={[14, 20]}
              help="The largest single lever in this model. A hospital that has never trained residents builds its own cap out of this program; an established one inherits a cap fixed decades ago."
              value={inputs.gme.scenario}
              onChange={(v) => patchGme({ scenario: v })}
              options={[
                {
                  value: "newTeachingHospital",
                  label: "New teaching hospital — no cap or PRA yet",
                  help: "No cap applies during program years 1–5; the permanent cap is built from the year-5 complement (42 CFR 413.79(e)(1)).",
                },
                {
                  value: "existingUnderCap",
                  label: "Existing teaching hospital, room under the cap",
                  help: "Funds residents up to the remaining headroom plus any awarded slots.",
                },
                {
                  value: "atCap",
                  label: "At cap — cap fully used",
                  help: "Only awarded slots create funded FTE. Everything else trains at full cost.",
                },
              ]}
            />
            {inputs.gme.scenario === "newTeachingHospital" ? (
              <>
                <NumberField
                  label="Projected allowable GME cost per FTE (year 1)"
                  cite={[15]}
                  help="Your own projected cost per resident FTE in the base period. The PRA is set as the LESSER of this and the locality mean below (42 CFR 413.77(e)) — a one-shot, permanent determination made from your early cost reports, and the highest-leverage number in this model."
                  value={inputs.gme.newHospitalProjectedCostPerFte}
                  onChange={(v) => patchGme({ newHospitalProjectedCostPerFte: Math.max(0, v) })}
                  prefix="$"
                  step={5000}
                />
                <NumberField
                  label="Locality weighted mean PRA"
                  cite={[15]}
                  help="Weighted mean PRA of teaching hospitals in your locality — the ceiling on your new PRA."
                  value={inputs.gme.localityWeightedMeanPra}
                  onChange={(v) => patchGme({ localityWeightedMeanPra: Math.max(0, v) })}
                  prefix="$"
                  step={5000}
                />
                <div className="callout">
                  Effective PRA: <strong>{currency(effectivePra(inputs.gme))}</strong>. If a
                  hospital is stuck with a very low or zero historical PRA, or a de-minimis
                  cap, check whether it qualifies for a reset under CAA 2021 §131 before
                  accepting the inherited figure.
                </div>
              </>
            ) : (
              <NumberField
                label="Direct GME Per-Resident Amount (PRA)"
                help="Hospital-specific CMS figure, set historically and trended forward."
                value={inputs.gme.directGmePerResidentAmount}
                onChange={(v) => patchGme({ directGmePerResidentAmount: v })}
                prefix="$"
                step={5000}
              />
            )}
            {inputs.gme.scenario === "existingUnderCap" && (
              <NumberField
                label="Cap headroom (fundable resident FTE)"
                cite={[1, 14]}
                help="Unused FTE slots under the cap. New residents beyond this earn no Medicare GME."
                value={inputs.gme.capHeadroomFte}
                onChange={(v) => patchGme({ capHeadroomFte: Math.max(0, v) })}
              />
            )}
            {inputs.gme.scenario !== "newTeachingHospital" && (
              <NumberField
                label="Awarded new cap slots"
                cite={[20]}
                help="Slots awarded under CAA 2021 §126 (1,000 slots phased FY2023–FY2027) or CAA 2023 §4122 (200 slots, FY2026, at least 100 psychiatry-directed) via the CMS application process."
                value={inputs.gme.awardedNewSlots}
                onChange={(v) => patchGme({ awardedNewSlots: Math.max(0, v) })}
              />
            )}
            <PercentField
              label="Medicare share of inpatient days (FFS + Medicare Advantage)"
              cite={[6]}
              clamp={{ min: 0, max: 1 }}
              help="The Medicare utilization ratio that apportions Direct GME. Medicare Advantage days belong in it (42 CFR 413.76 et seq.); the MA-related DGME is paid through the associated add-on stream."
              value={inputs.gme.medicareInpatientShare}
              onChange={(v) => patchGme({ medicareInpatientShare: v })}
            />
            <NumberField
              label="Medicare inpatient operating base payments subject to the IME add-on / yr"
              cite={[16]}
              help="FFS DRG payments excluding the IME and DSH add-ons themselves. Include the MA-related IME base if you are modeling Medicare Advantage IME."
              value={inputs.gme.medicareInpatientOperatingPayments}
              onChange={(v) => patchGme({ medicareInpatientOperatingPayments: v })}
              prefix="$"
              step={1_000_000}
            />
            <div className="grid-2">
              <NumberField
                label="Available beds"
                help="Denominator of the IME resident-to-bed ratio."
                value={inputs.gme.availableBeds}
                onChange={(v) => patchGme({ availableBeds: v })}
              />
              <NumberField
                label="Existing resident FTE"
                help="Current residents (all specialties) already counted for IME."
                value={inputs.gme.existingResidentFte}
                onChange={(v) => patchGme({ existingResidentFte: Math.max(0, v) })}
              />
            </div>
            <NumberField
              label="Medicare inpatient capital PPS payments / yr"
              cite={[17]}
              help="Base for the capital IME add-on, e^(0.2822 × resident-to-bed ratio) − 1 (42 CFR 412.322). Leave at 0 to omit the line."
              value={inputs.gme.medicareCapitalPayments}
              onChange={(v) => patchGme({ medicareCapitalPayments: Math.max(0, v) })}
              prefix="$"
              step={500_000}
            />
            <ToggleField
              label="Apply the three-year rolling average"
              cite={[14]}
              help="42 CFR 413.79(d): payment FTE is the average of this year and the prior two, except for a new program during its growth window (years 1–5). Realistic; leave on."
              value={inputs.gme.applyRollingAverage}
              onChange={(v) => patchGme({ applyRollingAverage: v })}
            />
            <ToggleField
              label="Apply the IME resident-to-bed ratio cap"
              cite={[16]}
              help="42 CFR 412.105(a)(1): this year's ratio may not exceed last year's, again excepting a new program's growth window. Realistic; leave on."
              value={inputs.gme.applyImeRatioCap}
              onChange={(v) => patchGme({ applyImeRatioCap: v })}
            />
            <ChoiceField
              label="State Medicaid GME mechanism"
              cite={[3, 4]}
              help="States differ in kind, not just amount: some pay per resident, some direct a fixed appropriation to a hospital regardless of how many residents it trains."
              value={inputs.gme.medicaid.mode}
              onChange={(v) => patchMedicaid({ mode: v })}
              options={[
                {
                  value: "perResident",
                  label: "Per resident FTE",
                  help: "A rate paid for each resident trained. Not subject to the Medicare cap.",
                },
                {
                  value: "appropriation",
                  label: "Fixed appropriation / IGA pool",
                  help: "A set annual amount directed to this hospital — it does not grow with the program.",
                },
                { value: "none", label: "No Medicaid GME", help: "The state has no program." },
              ]}
            />
            {inputs.gme.medicaid.mode === "perResident" && (
              <NumberField
                label="Medicaid GME support per resident / yr"
                help="State-dependent; 0 if none."
                value={inputs.gme.medicaid.perResidentAmount}
                onChange={(v) => patchMedicaid({ perResidentAmount: Math.max(0, v) })}
                prefix="$"
                step={5000}
              />
            )}
            {inputs.gme.medicaid.mode === "appropriation" && (
              <>
                <NumberField
                  label="Annual Medicaid GME appropriation to this hospital"
                  help="A fixed pool, independent of resident count."
                  cite={[3]}
                  value={inputs.gme.medicaid.annualAppropriationTotal}
                  onChange={(v) =>
                    patchMedicaid({ annualAppropriationTotal: Math.max(0, v) })
                  }
                  prefix="$"
                  step={100_000}
                />
                <ToggleField
                  label="Requires a local (non-federal) match"
                  help="e.g. an Arizona AHCCCS intergovernmental agreement. Without a committed IGA sponsor for the non-federal share, treat the appropriation as $0."
                  value={inputs.gme.medicaid.requiresLocalMatch}
                  onChange={(v) => patchMedicaid({ requiresLocalMatch: v })}
                />
              </>
            )}
          </Section>

          <Section
            title="Supervision ratios"
            subtitle="Medicare teaching & medical-direction limits"
            defaultOpen={false}
          >
            <NumberField
              label="Max CRNA cases per anesthesiologist"
              cite={[18]}
              clamp={{ min: 1 }}
              help="Medicare medical-direction limit is 4 concurrent cases."
              value={inputs.supervision.maxCrnaSupervisionRatio}
              onChange={(v) => patchSup({ maxCrnaSupervisionRatio: v })}
              step={1}
            />
            <NumberField
              label="Max resident cases per teaching anesthesiologist"
              cite={[19]}
              clamp={{ min: 1 }}
              help="Medicare allows up to 2 concurrent resident cases at 100% billing."
              value={inputs.supervision.maxResidentSupervisionRatio}
              onChange={(v) => patchSup({ maxResidentSupervisionRatio: v })}
              step={1}
            />
          </Section>

          <Section
            title="Program costs"
            subtitle="Leadership, coordination & overhead"
            defaultOpen={false}
          >
            <SliderField
              label="Program Director protected time"
              cite={[22]}
              value={inputs.program.programDirectorFte}
              onChange={(v) => patchProg({ programDirectorFte: v })}
              format={(v) => `${Math.round(v * 100)}% FTE`}
            />
            <SliderField
              label="Associate Program Director protected time"
              value={inputs.program.associateProgramDirectorFte}
              onChange={(v) => patchProg({ associateProgramDirectorFte: v })}
              format={(v) => `${Math.round(v * 100)}% FTE`}
            />
            <NumberField
              label="Program coordinator cost / yr"
              value={inputs.program.programCoordinatorCost}
              onChange={(v) => patchProg({ programCoordinatorCost: v })}
              prefix="$"
              step={5000}
            />
            <NumberField
              label="Fixed program overhead / yr"
              help="Accreditation, recruitment, simulation, education funds."
              value={inputs.program.fixedAnnualProgramOverhead}
              onChange={(v) => patchProg({ fixedAnnualProgramOverhead: v })}
              prefix="$"
              step={10000}
            />
            <div className="grid-2">
              <NumberField
                label="Resident liability / yr"
                help="Institutional professional-liability allocation per resident."
                value={inputs.program.residentLiabilityAnnual}
                onChange={(v) => patchProg({ residentLiabilityAnnual: Math.max(0, v) })}
                prefix="$"
                step={500}
              />
              <NumberField
                label="GME office overhead / resident / yr"
                cite={[21]}
                help="DIO, GMEC, and GME-office allocation required by the ACGME Institutional Requirements."
                value={inputs.program.gmeInstitutionalOverheadPerResident}
                onChange={(v) =>
                  patchProg({ gmeInstitutionalOverheadPerResident: Math.max(0, v) })
                }
                prefix="$"
                step={1000}
              />
            </div>
            <NumberField
              label="Per-resident fees / yr"
              help="ERAS/NRMP share, in-training exam, ABA BASIC and board fees, training licenses, ACLS/PALS."
              value={inputs.program.perResidentFeesAnnual}
              onChange={(v) => patchProg({ perResidentFeesAnnual: Math.max(0, v) })}
              prefix="$"
              step={500}
            />
            <NumberField
              label="Participating-site support / yr (net)"
              help="Net affiliation-agreement payments. Positive = the sponsor pays participating sites; negative = the sponsor is paid for residents rotating in."
              value={inputs.program.participatingSiteSupportAnnual}
              onChange={(v) => patchProg({ participatingSiteSupportAnnual: v })}
              prefix="$"
              step={25000}
            />
            <NumberField
              label="One-time startup cost"
              help="Application, consultants, initial buildout (amortized in reporting)."
              value={inputs.program.startupCost}
              onChange={(v) => patchProg({ startupCost: v })}
              prefix="$"
              step={50000}
            />
            <SliderField
              label="Non-billable faculty teaching per resident"
              help="Anesthesiologist FTE consumed teaching, per resident."
              value={inputs.program.facultyTeachingFtePerResident}
              onChange={(v) => patchProg({ facultyTeachingFtePerResident: v })}
              max={0.2}
              format={(v) => `${(v * 100).toFixed(1)}% FTE`}
            />
          </Section>

          <Section
            title="Workforce pipeline & call"
            subtitle="Avoided costs, not revenue"
            defaultOpen={false}
          >
            <ToggleField
              label="Count the retention pipeline"
              help="Graduates hired by the hospital or its group. Valued as the recruiting, signing, and locum-bridge cost their hire avoids — an avoided cost, never revenue."
              value={inputs.retention.enabled}
              onChange={(v) => patchRetention({ enabled: v })}
            />
            {inputs.retention.enabled && (
              <>
                <SliderField
                  label="Share of graduates retained"
                  help="Localize this. A program built to feed its own department typically claims a third; one that trains for the region claims less."
                  value={inputs.retention.retentionRate}
                  onChange={(v) => patchRetention({ retentionRate: v })}
                />
                <NumberField
                  label="Avoided cost per retained hire"
                  help="Recruiter fee, signing bonus, and the locum bridge a vacancy would otherwise need."
                  cite={[11]}
                  value={inputs.retention.avoidedCostPerRetainedHire}
                  onChange={(v) =>
                    patchRetention({ avoidedCostPerRetainedHire: Math.max(0, v) })
                  }
                  prefix="$"
                  step={25_000}
                />
                <NumberField
                  label="Years to recognize the avoided cost"
                  help="Spread across this many years starting at graduation. 1 = the graduation year only."
                  value={inputs.retention.benefitRecognitionYears}
                  onChange={(v) =>
                    patchRetention({ benefitRecognitionYears: Math.max(1, Math.round(v)) })
                  }
                  min={1}
                  max={5}
                />
              </>
            )}
            <ToggleField
              label="Count overnight in-house call coverage"
              help="Value of overnight coverage that would otherwise be CRNA call stipends/OT or locum nights. Do NOT enable this if your coverage FTEs already include call — it would count the same nights twice."
              value={inputs.callCoverage.enabled}
              onChange={(v) => patchCall({ enabled: v })}
            />
            {inputs.callCoverage.enabled && (
              <div className="grid-2">
                <NumberField
                  label="Nights covered / yr"
                  value={inputs.callCoverage.nightsPerYearCovered}
                  onChange={(v) => patchCall({ nightsPerYearCovered: Math.max(0, v) })}
                />
                <NumberField
                  label="Avoided cost per night"
                  value={inputs.callCoverage.avoidedCostPerNight}
                  onChange={(v) => patchCall({ avoidedCostPerNight: Math.max(0, v) })}
                  prefix="$"
                  step={250}
                />
              </div>
            )}
          </Section>

          <Section
            title="Projection & discounting"
            subtitle="Horizon, escalation, cost of capital"
            defaultOpen={false}
          >
            <div className="callout">
              Every dollar you type is in <strong>year-1 dollars</strong>. Escalation
              happens inside the projection, and the pre-revenue years are discounted at
              full weight — they are the hole the program climbs out of.
            </div>
            <NumberField
              label="Horizon (program years)"
              help="Program years reported after the pre-revenue period."
              value={inputs.projection.horizonYears}
              onChange={(v) => patchProjection({ horizonYears: Math.max(1, Math.round(v)) })}
              min={1}
              max={30}
            />
            <NumberField
              label="Pre-revenue years"
              help="Years of spending before the first class arrives: accreditation, PD recruitment, the first Match cycle."
              value={inputs.projection.preRevenueYears}
              onChange={(v) =>
                patchProjection({ preRevenueYears: Math.max(0, Math.round(v)) })
              }
              min={0}
              max={5}
            />
            <PercentField
              label="Discount rate"
              clamp={{ min: 0, max: 1 }}
              help="Hospital hurdle rate / WACC proxy, used for NPV and breakeven."
              value={inputs.projection.discountRate}
              onChange={(v) => patchProjection({ discountRate: v })}
            />
            <PercentField
              label="Salary inflation"
              clamp={{ min: 0, max: 1 }}
              help="Applied to all wages and benefits, including resident stipends."
              value={inputs.projection.salaryInflation}
              onChange={(v) => patchProjection({ salaryInflation: v })}
            />
            <PercentField
              label="PRA update rate"
              clamp={{ min: 0, max: 1 }}
              help="Annual CMS update to the Per-Resident Amount (CPI-U proxy, 42 CFR 413.77)."
              value={inputs.projection.praUpdateRate}
              onChange={(v) => patchProjection({ praUpdateRate: v })}
            />
            <PercentField
              label="Payment base growth"
              clamp={{ min: 0, max: 1 }}
              help="Applied to the Medicare IME base, the margin per staffed location, and off-service provider cost. State Medicaid GME is deliberately not escalated."
              value={inputs.projection.paymentBaseGrowth}
              onChange={(v) => patchProjection({ paymentBaseGrowth: v })}
            />
          </Section>

          <Section
            title="Clinical efficiency"
            subtitle="Teaching throughput effects"
            defaultOpen={false}
          >
            <NumberField
              label="Net margin per staffed location / yr"
              help="Professional-fee / contribution margin generated per staffed location."
              value={inputs.efficiency.annualMarginPerStaffedLocation}
              onChange={(v) => patchEff({ annualMarginPerStaffedLocation: v })}
              prefix="$"
              step={25000}
            />
            <SliderField
              label="Case throughput loss"
              help="Lost case margin from teaching slowdown. Charged once, on the locations residents cover, weighted toward junior residents — the coverage capability sliders below already carry the staffing side."
              value={inputs.efficiency.caseThroughputLoss}
              onChange={(v) => patchEff({ caseThroughputLoss: v })}
              max={0.5}
            />
          </Section>

          <Section
            title="Resident clinical value by year"
            subtitle="How much anesthesia coverage each level provides"
            defaultOpen={false}
          >
            {RESIDENCY_YEARS.map((year) => (
              <div key={year} className="clinical-year">
                <h4>{YEAR_LABELS[year]}</h4>
                <SliderField
                  label="Share of the year at the sponsor hospital"
                  help="Time at participating sites (county, VA, children's) generates neither sponsor Medicare FTE nor sponsor coverage."
                  value={inputs.clinical[year].sponsorSiteShare}
                  onChange={(v) => patchClinical(year, { sponsorSiteShare: v })}
                />
                <SliderField
                  label="Fraction of sponsor-site time on anesthesia"
                  help={`Conditional on being here. Composite anesthesia exposure over the year: ${percent(
                    inputs.clinical[year].sponsorSiteShare *
                      inputs.clinical[year].fractionOnAnesthesia
                  )}.`}
                  value={inputs.clinical[year].fractionOnAnesthesia}
                  onChange={(v) => patchClinical(year, { fractionOnAnesthesia: v })}
                />
                <SliderField
                  label="Coverage capability (CRNA-equivalent)"
                  value={inputs.clinical[year].anesthesiaCoverageFte}
                  onChange={(v) => patchClinical(year, { anesthesiaCoverageFte: v })}
                  max={1.2}
                />
                <SliderField
                  label="Off-service coverage (mid-level equivalent)"
                  help="Credited only for off-service time spent at the sponsor hospital."
                  value={inputs.clinical[year].offServiceCoverageFte}
                  onChange={(v) => patchClinical(year, { offServiceCoverageFte: v })}
                />
                <NumberField
                  label="Off-service provider cost / yr"
                  help="Fully-loaded cost of the mid-level provider whose work the resident offsets while off service."
                  value={inputs.clinical[year].offServiceProviderAnnualCost}
                  onChange={(v) =>
                    patchClinical(year, { offServiceProviderAnnualCost: Math.max(0, v) })
                  }
                  prefix="$"
                  step={5000}
                />
                <SliderField
                  label="IME-countable share of sponsor time"
                  help="Patient-care activities are IME-countable; non-patient-care research time is not (42 CFR 412.105(f))."
                  value={inputs.clinical[year].imeCountableShare}
                  onChange={(v) => patchClinical(year, { imeCountableShare: v })}
                />
              </div>
            ))}
          </Section>
        </div>

        <div className="output">
          <Results result={result} tornadoBars={tornadoBars} />
        </div>
      </main>

      <Bibliography />

      <footer className="app-footer">
        <p>
          Open-source planning model. All calculations run locally in your browser; your
          inputs are saved only to this device.{" "}
          <span className="muted">
            Assumptions default to national ballpark figures — localize them before
            relying on any number. See the README for methodology and sources.
          </span>
        </p>
        <p className="muted small">
          Steady-state net today ({currency(result.steadyState.netValue, { compact: true })})
          reflects your current assumptions.
        </p>
      </footer>
    </div>
  );
}
