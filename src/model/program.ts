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
import type { ModelInputs, ProgramCostInputs, SalaryInputs } from "./types";

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

/**
 * Fully-loaded annual cost of one resident: stipend plus benefits in absolute
 * dollars. Residents deliberately do NOT use the percentage benefit load —
 * health premiums and payroll-adjacent costs are largely flat per head, so a
 * percentage of a trainee stipend understates them badly (see
 * SalaryInputs.residentBenefitAnnual).
 */
export function loadedResidentCost(salaries: SalaryInputs): number {
  return salaries.residentSalary + salaries.residentBenefitAnnual;
}

/** Total resident stipend + benefits cost for a headcount of residents. */
export function residentSalaryCost(salaries: SalaryInputs, totalResidents: number): number {
  return loadedResidentCost(salaries) * totalResidents;
}

/**
 * Recurring cost that scales strictly with headcount, per resident per year:
 * professional liability, the GME institutional overhead allocation the ACGME
 * Institutional Requirements oblige a sponsoring institution to carry, and the
 * per-resident fee stack (ERAS/NRMP, ITE, ABA, licensure, certifications).
 */
export function perResidentProgramCost(program: ProgramCostInputs): number {
  return (
    Math.max(0, program.residentLiabilityAnnual) +
    Math.max(0, program.gmeInstitutionalOverheadPerResident) +
    Math.max(0, program.perResidentFeesAnnual)
  );
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
