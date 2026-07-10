import React from "react";
import {
  DEFAULT_INPUTS,
  RESIDENCY_YEARS,
  YEAR_LABELS,
  runModel,
  staffedLocationDemand,
  steadyStateCoverageFte,
  type ModelInputs,
  type ResidencyYear,
} from "../model";
import {
  NumberField,
  PercentField,
  Section,
  SliderField,
  ToggleField,
} from "./components/Field";
import { Results } from "./components/Results";
import { currency, number } from "./format";

const STORAGE_KEY = "anesthesia-residency-model-inputs-v1";

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

  React.useEffect(() => {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(inputs));
    } catch {
      /* ignore */
    }
  }, [inputs]);

  const result = React.useMemo(() => runModel(inputs), [inputs]);
  const demand = staffedLocationDemand(inputs);
  const coverage = steadyStateCoverageFte(inputs);

  // Immutable nested update helpers.
  const patch = (p: Partial<ModelInputs>) => setInputs((i) => ({ ...i, ...p }));
  const patchSalaries = (p: Partial<ModelInputs["salaries"]>) =>
    setInputs((i) => ({ ...i, salaries: { ...i.salaries, ...p } }));
  const patchLoc = (p: Partial<ModelInputs["locations"]>) =>
    setInputs((i) => ({ ...i, locations: { ...i.locations, ...p } }));
  const patchGme = (p: Partial<ModelInputs["gme"]>) =>
    setInputs((i) => ({ ...i, gme: { ...i.gme, ...p } }));
  const patchSup = (p: Partial<ModelInputs["supervision"]>) =>
    setInputs((i) => ({ ...i, supervision: { ...i.supervision, ...p } }));
  const patchProg = (p: Partial<ModelInputs["program"]>) =>
    setInputs((i) => ({ ...i, program: { ...i.program, ...p } }));
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
    <div className="app">
      <header className="app-header">
        <div className="app-header-inner">
          <div>
            <h1>Anesthesiology Residency Program Modeler</h1>
            <p className="tagline">
              Estimate the costs and benefits of establishing an ACGME anesthesiology
              residency at your hospital.
            </p>
          </div>
          <button type="button" className="btn-reset" onClick={reset}>
            Reset to defaults
          </button>
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
            <div className="callout">
              Steady-state complement:{" "}
              <strong>{inputs.residentsPerClass * 4} residents</strong>. Anesthetist-
              equivalent coverage they provide:{" "}
              <strong>{number(coverage, 1)} FTE</strong> against a demand of{" "}
              <strong>{number(demand, 1)}</strong> staffed locations/day.
            </div>
          </Section>

          <Section title="Community salaries" subtitle="Local market compensation">
            <NumberField
              label="Anesthesiologist salary"
              value={inputs.salaries.anesthesiologistSalary}
              onChange={(v) => patchSalaries({ anesthesiologistSalary: v })}
              prefix="$"
              step={5000}
            />
            <NumberField
              label="CRNA salary"
              help="Drives the value of coverage that residents substitute for."
              value={inputs.salaries.crnaSalary}
              onChange={(v) => patchSalaries({ crnaSalary: v })}
              prefix="$"
              step={5000}
            />
            <NumberField
              label="Resident stipend"
              value={inputs.salaries.residentSalary}
              onChange={(v) => patchSalaries({ residentSalary: v })}
              prefix="$"
              step={1000}
            />
            <PercentField
              label="Benefit / fringe load"
              help="Added on top of base salary for benefits, taxes, malpractice."
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
            <ToggleField
              label="Hospital is at its Medicare resident cap"
              help="At cap, residents above the headroom generate no new Medicare DGME/IME."
              value={inputs.gme.atMedicareCap}
              onChange={(v) => patchGme({ atMedicareCap: v })}
            />
            <NumberField
              label="Cap headroom (fundable resident FTE)"
              help={
                inputs.gme.atMedicareCap
                  ? "Ignored while the hospital is at cap — no new residents are Medicare-funded."
                  : "Unused FTE slots under the cap. New residents beyond this earn no Medicare GME."
              }
              value={inputs.gme.capHeadroomFte}
              onChange={(v) => patchGme({ capHeadroomFte: Math.max(0, v) })}
              disabled={inputs.gme.atMedicareCap}
            />
            <NumberField
              label="Direct GME Per-Resident Amount (PRA)"
              help="Hospital-specific CMS figure."
              value={inputs.gme.directGmePerResidentAmount}
              onChange={(v) => patchGme({ directGmePerResidentAmount: v })}
              prefix="$"
              step={5000}
            />
            <PercentField
              label="Medicare inpatient share"
              help="Medicare share of inpatient days; apportions Direct GME."
              value={inputs.gme.medicareInpatientShare}
              onChange={(v) => patchGme({ medicareInpatientShare: v })}
            />
            <NumberField
              label="Medicare inpatient operating payments / yr"
              help="Base to which the IME percentage add-on applies."
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
              label="Medicaid GME support per resident / yr"
              help="State-dependent; 0 if none."
              value={inputs.gme.medicaidGmePerResident}
              onChange={(v) => patchGme({ medicaidGmePerResident: v })}
              prefix="$"
              step={5000}
            />
          </Section>

          <Section
            title="Supervision ratios"
            subtitle="Medicare teaching & medical-direction limits"
            defaultOpen={false}
          >
            <NumberField
              label="Max CRNA cases per anesthesiologist"
              help="Medicare medical-direction limit is 4 concurrent cases."
              value={inputs.supervision.maxCrnaSupervisionRatio}
              onChange={(v) => patchSup({ maxCrnaSupervisionRatio: v })}
              step={1}
            />
            <NumberField
              label="Max resident cases per teaching anesthesiologist"
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
              label="Teaching throughput loss"
              help="Case slowdown when staffed by a resident vs. an experienced anesthetist."
              value={inputs.efficiency.teachingThroughputLoss}
              onChange={(v) => patchEff({ teachingThroughputLoss: v })}
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
                  label="Fraction of year on anesthesia"
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
                  value={inputs.clinical[year].offServiceCoverageFte}
                  onChange={(v) => patchClinical(year, { offServiceCoverageFte: v })}
                />
              </div>
            ))}
          </Section>
        </div>

        <div className="output">
          <Results result={result} />
        </div>
      </main>

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
