/**
 * Program operating costs (everything that is NOT resident stipends).
 *
 * ACGME accreditation requires dedicated program leadership and administrative
 * infrastructure: a Program Director with protected (non-clinical) time, an
 * Associate Program Director, program coordinator(s), faculty teaching effort
 * that is not separately billable, and fixed overhead (accreditation fees,
 * recruitment, simulation, resident education funds).
 */

import { loaded } from "./clinical";
import type { ModelInputs, SalaryInputs } from "./types";

/** Cost of leadership protected time (PD + APD), valued at anesthesiologist rate. */
export function leadershipCost(inputs: ModelInputs): number {
  const attendingLoaded = loaded(
    inputs.salaries.anesthesiologistSalary,
    inputs.salaries.benefitLoadRate
  );
  const fte =
    inputs.program.programDirectorFte + inputs.program.associateProgramDirectorFte;
  return fte * attendingLoaded;
}

/** Faculty teaching / precepting effort that displaces billable clinical time. */
export function facultyTeachingCost(inputs: ModelInputs, totalResidents: number): number {
  const attendingLoaded = loaded(
    inputs.salaries.anesthesiologistSalary,
    inputs.salaries.benefitLoadRate
  );
  return (
    inputs.program.facultyTeachingFtePerResident * totalResidents * attendingLoaded
  );
}

/** Total resident stipend + benefits cost for a headcount of residents. */
export function residentSalaryCost(salaries: SalaryInputs, totalResidents: number): number {
  return loaded(salaries.residentSalary, salaries.benefitLoadRate) * totalResidents;
}

/**
 * Total recurring (annual) program cost excluding resident stipends, for a
 * given resident headcount.
 */
export function annualProgramSupportCost(
  inputs: ModelInputs,
  totalResidents: number
): number {
  return (
    leadershipCost(inputs) +
    facultyTeachingCost(inputs, totalResidents) +
    inputs.program.programCoordinatorCost +
    inputs.program.fixedAnnualProgramOverhead
  );
}
