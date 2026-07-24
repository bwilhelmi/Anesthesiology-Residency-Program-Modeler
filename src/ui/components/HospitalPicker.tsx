import React from "react";
import {
  GME_META,
  GME_STATES,
  hospitalByCcn,
  hospitalsInState,
  type GmeHospital,
} from "../gmeHospitals";
import { currency, number } from "../format";

/**
 * Lets the user find their hospital and see its real Medicare GME position —
 * resident FTE cap (and unused "cap space"), Direct GME (DGME) payment, and
 * Indirect Medical Education (IME) payment — drawn from that hospital's own
 * Medicare cost report. Optionally applies those figures to the model's GME
 * inputs so the benefit projection reflects the hospital's actual cap headroom,
 * Per-Resident Amount, beds, and existing resident complement.
 */
export function HospitalPicker({
  onApply,
}: {
  onApply: (apply: {
    capHeadroomFte: number;
    atMedicareCap: boolean;
    directGmePerResidentAmount: number;
    availableBeds: number;
    existingResidentFte: number;
  }) => void;
}) {
  const [state, setState] = React.useState<string>("");
  const [ccn, setCcn] = React.useState<string>("");

  const list = React.useMemo(() => hospitalsInState(state), [state]);
  const selected = ccn ? hospitalByCcn(ccn) : undefined;

  // Reset the hospital selection when the state filter changes it out of range.
  React.useEffect(() => {
    if (ccn && !list.some((h) => h.ccn === ccn)) setCcn("");
  }, [list, ccn]);

  return (
    <div className="region">
      <div className="hp-selectors">
        <label className="field region-select">
          <span className="field-label">State</span>
          <span className="field-input">
            <select value={state} onChange={(e) => setState(e.target.value)}>
              <option value="">All states</option>
              {GME_STATES.map((s) => (
                <option key={s} value={s}>
                  {s}
                </option>
              ))}
            </select>
          </span>
        </label>
        <label className="field region-select hp-hospital-select">
          <span className="field-label">Teaching hospital</span>
          <span className="field-input">
            <select value={ccn} onChange={(e) => setCcn(e.target.value)}>
              <option value="">
                {`Select a hospital (${list.length.toLocaleString("en-US")})`}
              </option>
              {list.map((h) => (
                <option key={h.ccn} value={h.ccn}>
                  {h.name}
                  {!state && h.state ? ` — ${h.state}` : ""}
                </option>
              ))}
            </select>
          </span>
        </label>
      </div>

      {selected ? (
        <HospitalDetail hospital={selected} onApply={onApply} />
      ) : (
        <div className="region-preview region-empty">
          Pick a hospital to see its Medicare resident cap, Direct GME, and IME funding.
        </div>
      )}

      <p className="region-source">
        Source: {GME_META.source}. Built from HCRIS FY
        {Math.min(...GME_META.yearsConsidered)}–FY{Math.max(...GME_META.yearsConsidered)};
        each hospital shows its most authoritative report (settled preferred, then most
        recent), and {GME_META.settledCount.toLocaleString("en-US")} of{" "}
        {GME_META.hospitalCount.toLocaleString("en-US")} are from a settled report. Figures
        are each hospital&rsquo;s own cost-report values, shown for modeling only — not an
        official CMS payment determination. A blank means the hospital did not report that
        figure; nothing is estimated.
      </p>
    </div>
  );
}

function HospitalDetail({
  hospital: h,
  onApply,
}: {
  hospital: GmeHospital;
  onApply: (apply: {
    capHeadroomFte: number;
    atMedicareCap: boolean;
    directGmePerResidentAmount: number;
    availableBeds: number;
    existingResidentFte: number;
  }) => void;
}) {
  const atCap = h.headroomFte != null && h.headroomFte <= 0;
  const canApply =
    h.capFte != null || h.actualFte != null || h.praPrimaryCare != null || h.beds != null;

  const apply = () =>
    onApply({
      capHeadroomFte: h.headroomFte != null ? Math.max(0, h.headroomFte) : 0,
      atMedicareCap: atCap,
      // Weighted-average PRA when both cols exist; otherwise whichever is present.
      directGmePerResidentAmount:
        h.praPrimaryCare != null && h.praNonPrimary != null
          ? Math.round((h.praPrimaryCare + h.praNonPrimary) / 2)
          : (h.praPrimaryCare ?? h.praNonPrimary ?? 0),
      availableBeds: h.beds ?? 0,
      existingResidentFte: h.actualFte ?? 0,
    });

  return (
    <div className="hp-detail">
      <div className="hp-detail-head">
        <div>
          <div className="hp-name">{h.name}</div>
          <div className="hp-sub">
            {[h.city, h.state].filter(Boolean).join(", ")} · CCN {h.ccn}
          </div>
        </div>
        <div className="hp-period">
          Cost report FY{h.reportYear} ({h.fiscalYearBegin}–{h.fiscalYearEnd})
          <br />
          <span className={h.settled ? "hp-badge hp-badge-settled" : "hp-badge hp-badge-prov"}>
            {h.settled ? `Settled — ${h.reportStatus}` : `Provisional — ${h.reportStatus}`}
          </span>
        </div>
      </div>

      <div className="hp-headline">
        <HeadlineFigure
          label="Resident cap space"
          value={
            h.capFte != null
              ? `${number(h.capFte, 1)} FTE`
              : "Not reported"
          }
          sub={
            h.headroomFte != null
              ? atCap
                ? `At or over cap (${number(h.actualFte ?? 0, 1)} in training)`
                : `${number(h.headroomFte, 1)} FTE unused of the cap`
              : h.actualFte != null
                ? `${number(h.actualFte, 1)} FTE currently in training`
                : undefined
          }
        />
        <HeadlineFigure
          label="Direct GME (DGME)"
          value={h.dgmePayment != null ? currency(h.dgmePayment) : "Not reported"}
          sub="Medicare direct training payment / yr"
        />
        <HeadlineFigure
          label="Indirect ME (IME)"
          value={h.imePayment != null ? currency(h.imePayment) : "Not reported"}
          sub="Medicare IME add-on / yr"
        />
      </div>

      <div className="hp-secondary">
        {h.praPrimaryCare != null && (
          <span>
            PRA:{" "}
            <strong>
              {currency(h.praPrimaryCare)}
              {h.praNonPrimary != null && h.praNonPrimary !== h.praPrimaryCare
                ? ` / ${currency(h.praNonPrimary)}`
                : ""}
            </strong>
          </span>
        )}
        {h.actualFte != null && (
          <span>
            Residents in training: <strong>{number(h.actualFte, 1)} FTE</strong>
          </span>
        )}
        {h.beds != null && (
          <span>
            Beds: <strong>{number(h.beds)}</strong>
          </span>
        )}
      </div>

      {canApply && (
        <button type="button" className="region-apply hp-apply" onClick={apply}>
          Apply to model inputs
        </button>
      )}
    </div>
  );
}

function HeadlineFigure({
  label,
  value,
  sub,
}: {
  label: string;
  value: string;
  sub?: string;
}) {
  return (
    <div className="hp-figure">
      <span className="hp-figure-label">{label}</span>
      <span className="hp-figure-value">{value}</span>
      {sub ? <span className="hp-figure-sub">{sub}</span> : null}
    </div>
  );
}
