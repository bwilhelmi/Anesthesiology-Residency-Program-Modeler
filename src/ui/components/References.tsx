import React from "react";

/**
 * Central bibliography for every sourced number shown in the tool. Figures in the
 * hospital picker and salary picker carry a superscript <Cite> that links to the
 * matching numbered entry rendered by <Bibliography> at the bottom of the page.
 *
 * Keep the numbers stable — they are anchor targets (#ref-N). Add new sources at
 * the end rather than renumbering.
 */
export interface Reference {
  n: number;
  label: string;
  note?: string;
  url: string;
}

export const REFERENCES: Reference[] = [
  {
    n: 1,
    label:
      "CMS Healthcare Cost Report Information System (HCRIS) — Hospital Cost Report, Form CMS-2552-10 (FY2019–2024)",
    note: "Medicare resident FTE cap, Direct GME payment, Indirect Medical Education payment, Per-Resident Amount, and resident FTE counts, from Worksheets E-4 and E Part A. Each hospital uses its most authoritative report (settled preferred, then most recent).",
    url: "https://www.cms.gov/data-research/statistics-trends-reports/cost-reports/hospital-2010-form",
  },
  {
    n: 2,
    label: "CMS Hospital Provider Cost Report Public Use File",
    note: "Hospital name, city, state, and bed count, joined to the HCRIS figures by CMS Certification Number.",
    url: "https://data.cms.gov/provider-compliance/cost-report/hospital-provider-cost-report",
  },
  {
    n: 3,
    label: "AHCCCS (Arizona Medicaid) — Graduate Medical Education Payments",
    note: "Arizona per-hospital Direct (DME) and Indirect (IME) Medicaid GME payments by academic year (actual distributed payments).",
    url: "https://www.azahcccs.gov/PlansProviders/RatesAndBilling/GMEpayments.html",
  },
  {
    n: 4,
    label:
      "AAMC — Medicaid Graduate Medical Education Payments: Results From the 2022 50-State Survey",
    note: "State-level Medicaid GME totals, direct/indirect recognition, and payment mechanism used in the state funding profiles. Each state profile additionally cites its specific state Medicaid agency source inline.",
    url: "https://store.aamc.org/medicaid-graduate-medical-education-payments-results-from-the-2022-50-state-survey.html",
  },
  {
    n: 5,
    label: "U.S. Bureau of Labor Statistics — Occupational Employment and Wage Statistics (OEWS)",
    note: "Default anesthesiologist and CRNA wage figures used by the region salary picker.",
    url: "https://www.bls.gov/oes/",
  },
  {
    n: 6,
    label:
      "CMS — Indirect Medical Education (IME) and Direct GME payment methodology (42 CFR 412.105; 42 CFR 413.75–413.83)",
    note: "The federal formulas the model uses to estimate marginal Medicare IME and DGME revenue from added residents.",
    url: "https://www.cms.gov/medicare/payment/prospective-payment-systems/acute-inpatient-pps/indirect-medical-education-ime",
  },
  {
    n: 7,
    label:
      "Florida AHCA — Statewide Medicaid Residency Program (SMRP) SFY2023-24 Reconciliation",
    note: "Florida per-hospital direct (resident-based) Medicaid GME allocations. Florida's separate Medicaid IME program is not included.",
    url: "https://ahca.myflorida.com/file/medicaid/SFY%2023-24%20SMRP%20Reconciliation%20Calculation.pdf",
  },
  {
    n: 8,
    label: "New Jersey Department of Health — SFY2025 Graduate Medical Education (GME) Subsidy Allocations",
    note: "New Jersey per-hospital Medicaid GME subsidy (a single combined amount, not split into direct/indirect).",
    url: "https://www.nj.gov/health/hcf/documents/charitycare/SFY2025_GME_Subsidy_Allocation.pdf",
  },
  {
    n: 9,
    label: "Utah DHHS — Medicaid Inpatient Hospital GME Calculation (SFY2024)",
    note: "Utah per-hospital direct GME supplemental payments.",
    url: "https://medicaid.utah.gov/stplan/inpatientgme/",
  },
  {
    n: 10,
    label: "Minnesota Department of Health — MERC Distribution Annual Report 2025",
    note: "Minnesota per-hospital MERC (Medical Education & Research Costs) awards; combined, not split into direct/indirect.",
    url: "https://www.health.state.mn.us/facilities/ruralhealth/merc/docs/distribution25.pdf",
  },
  {
    n: 11,
    label: "Merritt Hawkins / AMN Healthcare — Review of Physician and Advanced Practitioner Recruiting Incentives (2024)",
    note: "National recruiting benchmark used to calibrate the default anesthesiologist market premium (nonacademic starting base near $450,000).",
    url: "https://www.amnhealthcare.com/siteassets/amn-insights/physician/incentive-review-2024-final.pdf",
  },
  {
    n: 12,
    label: "Doximity — 2025 Physician Compensation Report",
    note: "National compensation benchmark used as the upper bound for the anesthesiologist market premium (anesthesiology total compensation $523,277).",
    url: "https://www.doximity.com/reports/physician-compensation-report/2025",
  },
  {
    n: 13,
    label: "AANA — Compensation and Benefits Survey (2024)",
    note: "CRNA-specific benchmark used to calibrate the default CRNA market premium: median salary $251,000, average total compensation ~$256,000 — only a few percent above the BLS CRNA mean. It reports base and total compensation but does NOT isolate premium pay, which is why the model's premium-pay load has to come from hospital payroll rather than from any published survey. See also https://www.aana.com/membership/member-benefits/compensation-benefits-survey/",
    url: "https://www.aana.com/professional-development/compensation-and-benefits-survey/",
  },
  {
    n: 14,
    label:
      "42 CFR 413.79 — Direct GME resident FTE caps, the three-year rolling average, and new-program cap building",
    note: "The cap a new teaching hospital builds from its year-5 complement (413.79(e)(1)), and the rolling-average exclusion for residents in a new program during its growth window (413.79(d)(5)).",
    url: "https://www.ecfr.gov/current/title-42/chapter-IV/subchapter-B/part-413/subpart-F/section-413.79",
  },
  {
    n: 15,
    label:
      "42 CFR 413.77 — Per-resident amounts, including the determination for new teaching hospitals",
    note: "A new teaching hospital's PRA is the lesser of its own projected allowable cost per FTE and the locality-adjusted weighted mean PRA (413.77(e)) — a one-shot, permanent determination.",
    url: "https://www.ecfr.gov/current/title-42/chapter-IV/subchapter-B/part-413/subpart-F/section-413.77",
  },
  {
    n: 16,
    label: "42 CFR 412.105 — IME adjustment (operating) and the resident-to-bed ratio",
    note: "The IME formula, the ratio cap at the prior year's level (412.105(a)(1)), the new-program FTE treatment (412.105(f)(1)(v)), and the patient-care activity requirement for countable time.",
    url: "https://www.ecfr.gov/current/title-42/chapter-IV/subchapter-B/part-412/subpart-G/section-412.105",
  },
  {
    n: 17,
    label: "42 CFR 412.322 — IME adjustment (capital)",
    note: "The capital IME add-on, e^(0.2822 × resident-to-bed ratio) − 1, applied to Medicare capital PPS payments.",
    url: "https://www.ecfr.gov/current/title-42/chapter-IV/subchapter-B/part-412/subpart-M/section-412.322",
  },
  {
    n: 18,
    label: "42 CFR 415.110 — Medically directed anesthesia services (up to four concurrent procedures)",
    note: "The 1:4 medical-direction limit that sets the comparison for resident supervision cost.",
    url: "https://www.ecfr.gov/current/title-42/chapter-IV/subchapter-B/part-415/subpart-C/section-415.110",
  },
  {
    n: 19,
    label:
      "42 CFR 415.178 — Anesthesia services furnished in teaching settings (two concurrent resident cases)",
    note: "The teaching-rule concurrency limit: an attending covering resident rooms is tied to two, not four, which is the incremental supervision cost the model charges.",
    url: "https://www.ecfr.gov/current/title-42/chapter-IV/subchapter-B/part-415/subpart-D/section-415.178",
  },
  {
    n: 20,
    label:
      "CMS — Direct Graduate Medical Education (DGME) and new residency slot distributions (CAA 2021 §126 and §131; CAA 2023 §4122)",
    note: "The slot-award process behind the awarded-slots input, and the §131 PRA/cap reset available to hospitals with very low or de-minimis historical amounts.",
    url: "https://www.cms.gov/medicare/payment/prospective-payment-systems/acute-inpatient-pps/direct-graduate-medical-education-dgme",
  },
  {
    n: 21,
    label: "ACGME — Accreditation (Institutional Requirements: DIO, GMEC, and GME office obligations)",
    // The specific institutional-review page 404s; per house rule the label
    // stays and the parent index is cited rather than dropping the source.
    note: "The institutional infrastructure a sponsoring institution must maintain, which the per-resident GME overhead line prices.",
    url: "https://www.acgme.org/what-we-do/accreditation/",
  },
  {
    n: 22,
    label: "ACGME — Program Requirements for Graduate Medical Education in Anesthesiology",
    note: "PGY structure, the four-year accredited length used for the cap and IRP weighting, and Program Director protected-time requirements.",
    url: "https://www.acgme.org/specialties/anesthesiology/program-requirements-and-faqs-and-applications/",
  },
  {
    n: 23,
    label: "AAMC — Survey of Resident/Fellow Stipends and Benefits",
    note: "Stipend and benefit defaults, including the absolute resident benefit figure the model uses in place of a percentage load.",
    url: "https://www.aamc.org/data-reports/students-residents/report/aamc-survey-resident/fellow-stipends-and-benefits",
  },
];

/** Superscript footnote marker(s) linking to the bibliography, e.g. <Cite ns={[1,2]} />. */
export function Cite({ ns }: { ns: number[] }) {
  return (
    <sup className="cite">
      {ns.map((n, i) => (
        <React.Fragment key={n}>
          {i > 0 ? "," : null}
          <a href={`#ref-${n}`} aria-label={`Reference ${n}`}>
            {n}
          </a>
        </React.Fragment>
      ))}
    </sup>
  );
}

/** The numbered bibliography rendered at the bottom of the page. */
export function Bibliography() {
  return (
    <section className="references" id="references" aria-label="References and data sources">
      <h2>References &amp; data sources</h2>
      <ol className="ref-list">
        {REFERENCES.map((r) => (
          <li key={r.n} id={`ref-${r.n}`}>
            <span className="ref-label">{r.label}.</span>{" "}
            {r.note ? <span className="ref-note">{r.note} </span> : null}
            <a className="ref-url" href={r.url} target="_blank" rel="noreferrer">
              {r.url}
            </a>
          </li>
        ))}
      </ol>
      <p className="ref-foot">
        Figures are drawn from the sources above for modeling and discussion; they are not
        official CMS, AHCCCS, or state Medicaid determinations. Where a number was not
        publicly available it is shown as &ldquo;Not reported&rdquo; and never estimated.
      </p>
    </section>
  );
}
