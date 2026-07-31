import type { LineItem, ModelResult, YearResult } from "../../model";
import { RESIDENCY_YEARS, YEAR_LABELS } from "../../model";
import { currency } from "../format";

function Bar({ items, total }: { items: LineItem[]; total: number }) {
  return (
    <ul className="breakdown">
      {items.map((it) => {
        const pct = total > 0 ? (it.amount / total) * 100 : 0;
        return (
          <li key={it.key} className="breakdown-row">
            <div className="breakdown-top">
              <span className="breakdown-label" title={it.detail}>
                {it.label}
              </span>
              <span className="breakdown-amount">{currency(it.amount, { compact: true })}</span>
            </div>
            <div className="breakdown-track">
              <div className="breakdown-fill" style={{ width: `${Math.max(0, pct)}%` }} />
            </div>
          </li>
        );
      })}
    </ul>
  );
}

function netClass(n: number): string {
  return n >= 0 ? "pos" : "neg";
}

/** A table/card figure: parenthesised when negative, an em dash at true zero. */
function fig(n: number, opts: { compact?: boolean } = {}): string {
  if (n === 0) return "—";
  return currency(n, { ...opts, accounting: true });
}

export function Results({ result }: { result: ModelResult }) {
  const ss = result.steadyState;
  return (
    <div className="results">
      <div className="headline">
        <div className="headline-card">
          <span className="headline-label">Steady-state annual net value</span>
          <span className={`headline-value ${netClass(ss.netValue)}`}>
            {fig(ss.netValue)}
          </span>
          <span className="headline-sub">
            {currency(ss.totalBenefits, { compact: true })} benefits −{" "}
            {currency(ss.totalCosts, { compact: true })} costs · {ss.totalResidents}{" "}
            residents
          </span>
        </div>
        <div className="headline-card">
          <span className="headline-label">5-year cumulative net (incl. startup)</span>
          <span className={`headline-value ${netClass(result.fiveYearCumulativeNet)}`}>
            {fig(result.fiveYearCumulativeNet)}
          </span>
          <span className="headline-sub">
            4 ramp years + 1 steady-state year, less one-time startup cost
          </span>
        </div>
      </div>

      <div className="results-grid">
        <div className="results-col">
          <h3 className="results-h">Annual benefits (steady state)</h3>
          <div className="results-total pos">
            {currency(ss.totalBenefits)}
          </div>
          <Bar items={ss.benefits} total={ss.totalBenefits} />
        </div>
        <div className="results-col">
          <h3 className="results-h">Annual costs (steady state)</h3>
          <div className="results-total neg">{currency(ss.totalCosts)}</div>
          <Bar items={ss.costs} total={ss.totalCosts} />
        </div>
      </div>

      <h3 className="results-h">Year-by-year build-out</h3>
      <RampTable rampYears={result.rampYears} steadyState={ss} />
      <p className="results-note">
        Figures are directional estimates from user-supplied assumptions. Localize
        salaries, the hospital's Per-Resident Amount, IME inputs, and cap status for a
        defensible result. This tool is for planning, not accounting or legal advice.
      </p>
    </div>
  );
}

function RampTable({
  rampYears,
  steadyState,
}: {
  rampYears: YearResult[];
  steadyState: YearResult;
}) {
  return (
    <div className="table-wrap">
      <table className="ramp">
        <thead>
          <tr>
            <th>Program year</th>
            <th>Residents</th>
            {RESIDENCY_YEARS.map((y) => (
              <th key={y} title={YEAR_LABELS[y]}>
                {y}
              </th>
            ))}
            <th>Benefits</th>
            <th>Costs</th>
            <th>Net</th>
          </tr>
        </thead>
        <tbody>
          {rampYears.map((r) => (
            <tr key={r.programYear}>
              <td>Year {r.programYear}</td>
              <td>{r.totalResidents}</td>
              {RESIDENCY_YEARS.map((y) => (
                <td key={y}>{r.residentsByYear[y]}</td>
              ))}
              <td>{fig(r.totalBenefits, { compact: true })}</td>
              <td>{fig(r.totalCosts, { compact: true })}</td>
              <td className={netClass(r.netValue)}>
                {fig(r.netValue, { compact: true })}
              </td>
            </tr>
          ))}
          <tr className="steady">
            <td>Steady state</td>
            <td>{steadyState.totalResidents}</td>
            {RESIDENCY_YEARS.map((y) => (
              <td key={y}>{steadyState.residentsByYear[y]}</td>
            ))}
            <td>{fig(steadyState.totalBenefits, { compact: true })}</td>
            <td>{fig(steadyState.totalCosts, { compact: true })}</td>
            <td className={netClass(steadyState.netValue)}>
              {fig(steadyState.netValue, { compact: true })}
            </td>
          </tr>
        </tbody>
      </table>
    </div>
  );
}
