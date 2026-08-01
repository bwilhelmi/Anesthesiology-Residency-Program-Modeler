import React from "react";
import type { LineItem, ModelResult, TornadoBar, YearResult } from "../../model";
import { RESIDENCY_YEARS, YEAR_LABELS } from "../../model";
import { currency, number } from "../format";

/** How many tornado bars are shown before the reader asks for the rest. */
const TORNADO_VISIBLE = 8;

function Bar({ items, total }: { items: LineItem[]; total: number }) {
  if (items.length === 0) {
    return (
      <p className="results-note">
        Nothing here yet — no residents have arrived, so the program has costs and no
        offsetting value.
      </p>
    );
  }
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
              <div
                className="breakdown-fill"
                style={{ width: `${Math.max(0, Math.min(100, pct))}%` }}
              />
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

/** A program year's label: pre-revenue years are named, not numbered. */
function yearLabel(programYear: number): string {
  if (programYear > 0) return `Year ${programYear}`;
  return programYear === 0 ? "Pre-launch" : `Pre-launch −${Math.abs(programYear)}`;
}

/**
 * Modeling caveats raised by the current inputs. Deliberately not colored: the
 * interface carries no meaning by hue, so this reads as a bordered, labeled
 * block in print and in the grayscale proof.
 */
function Warnings({ warnings }: { warnings: string[] }) {
  if (warnings.length === 0) return null;
  return (
    <section className="warnings" role="status" aria-label="Modeling warnings">
      <h3 className="warnings-h">Check these assumptions ({warnings.length})</h3>
      <ul className="warnings-list">
        {warnings.map((w) => (
          <li key={w}>{w}</li>
        ))}
      </ul>
    </section>
  );
}

/**
 * A tornado chart in plain divs. Each bar spans the metric values at the two
 * ends of that variable's swing, drawn against a shared scale with the base
 * case marked — so the eye reads "this one assumption moves the answer by this
 * much", which is the only honest way to present a single NPV.
 */
function Tornado({ bars, base }: { bars: TornadoBar[]; base: number }) {
  const [showAll, setShowAll] = React.useState(false);
  if (bars.length === 0) return null;

  const values = bars.flatMap((b) => [b.low, b.high]).concat(base);
  const min = Math.min(...values);
  const max = Math.max(...values);
  const span = max - min || 1;
  const pos = (v: number) => ((v - min) / span) * 100;

  const shown = showAll ? bars : bars.slice(0, TORNADO_VISIBLE);

  return (
    <section className="tornado" aria-label="Sensitivity of NPV to each assumption">
      <div className="tornado-head">
        <h3 className="results-h">What actually decides the answer</h3>
        {bars.length > TORNADO_VISIBLE && (
          <button type="button" className="link-btn" onClick={() => setShowAll((s) => !s)}>
            {showAll ? "Show top 8" : `Show all ${bars.length}`}
          </button>
        )}
      </div>
      <p className="results-note">
        Each assumption moved on its own, ±20% unless noted, against a base case of{" "}
        <strong>{currency(base, { compact: true })}</strong> NPV.
      </p>
      <ul className="tornado-list">
        {shown.map((b) => {
          const lo = Math.min(b.low, b.high);
          const hi = Math.max(b.low, b.high);
          return (
            <li key={b.key} className="tornado-row">
              <span className="tornado-label">{b.label}</span>
              <span className="tornado-track">
                <span
                  className="tornado-axis"
                  style={{ left: `${pos(base)}%` }}
                  aria-hidden
                />
                <span
                  className="tornado-bar"
                  style={{ left: `${pos(lo)}%`, width: `${Math.max(0.4, pos(hi) - pos(lo))}%` }}
                />
              </span>
              <span className="tornado-values">
                {currency(b.low, { compact: true })} → {currency(b.high, { compact: true })}
              </span>
            </li>
          );
        })}
      </ul>
    </section>
  );
}

export function Results({
  result,
  tornadoBars = [],
}: {
  result: ModelResult;
  tornadoBars?: TornadoBar[];
}) {
  const [selectedYear, setSelectedYear] = React.useState<number | null>(null);
  const selected =
    result.years.find((y) => y.programYear === selectedYear) ?? result.steadyState;
  const s = result.summary;

  return (
    <div className="results">
      <Warnings warnings={result.warnings} />

      <div className="headline">
        <div className="headline-card">
          <span className="headline-label">Net present value</span>
          <span className={`headline-value ${netClass(s.npv)}`}>{fig(s.npv)}</span>
          <span className="headline-sub">
            Whole frame, discounted from the first pre-launch year
          </span>
        </div>
        <div className="headline-card">
          <span className="headline-label">Breakeven</span>
          <span className="headline-value">
            {s.breakevenYear === null ? "—" : `Year ${s.breakevenYear}`}
          </span>
          <span className="headline-sub">
            {s.breakevenYear === null
              ? "Cumulative discounted net stays negative through the horizon"
              : "First program year with cumulative discounted net ≥ 0"}
          </span>
        </div>
        <div className="headline-card">
          <span className="headline-label">Steady-state annual net</span>
          <span className={`headline-value ${netClass(s.steadyStateAnnualNet)}`}>
            {fig(s.steadyStateAnnualNet)}
          </span>
          <span className="headline-sub">
            Program year {result.steadyState.programYear}, once the cap and rolling average
            bind
          </span>
        </div>
        <div className="headline-card">
          <span className="headline-label">Nominal cumulative net</span>
          <span className={`headline-value ${netClass(s.nominalCumulativeNet)}`}>
            {fig(s.nominalCumulativeNet)}
          </span>
          <span className="headline-sub">Undiscounted, including the pre-launch years</span>
        </div>
      </div>

      <Tornado bars={tornadoBars} base={s.npv} />

      <h3 className="results-h">Year-by-year</h3>
      <YearTable
        years={result.years}
        matureYear={result.steadyState.programYear}
        selectedYear={selected.programYear}
        onSelect={setSelectedYear}
      />

      <div className="results-grid">
        <div className="results-col">
          <h3 className="results-h">
            Benefits — {yearLabel(selected.programYear)}
          </h3>
          <div className="results-total pos">{currency(selected.totalBenefits)}</div>
          <Bar items={selected.benefits} total={selected.totalBenefits} />
        </div>
        <div className="results-col">
          <h3 className="results-h">Costs — {yearLabel(selected.programYear)}</h3>
          <div className="results-total neg">{currency(selected.totalCosts)}</div>
          <Bar items={selected.costs} total={selected.totalCosts} />
        </div>
      </div>

      <p className="results-note">
        Figures are directional estimates from user-supplied assumptions. Localize
        salaries, the hospital's Per-Resident Amount, IME inputs, and cap status for a
        defensible result. This tool is for planning, not accounting or legal advice.
      </p>
    </div>
  );
}

function YearTable({
  years,
  matureYear,
  selectedYear,
  onSelect,
}: {
  years: YearResult[];
  matureYear: number;
  selectedYear: number;
  onSelect: (programYear: number) => void;
}) {
  return (
    <div className="table-wrap">
      <table className="ramp">
        <caption className="table-caption">
          Select a year to see its breakdown below. Shaded rows are pre-launch years, with
          spending and no residents; the ruled row is the mature year, where the Medicare
          cap, the rolling average, and the IME ratio cap all bind.
        </caption>
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
          {years.map((r) => (
            <tr
              key={r.programYear}
              className={[
                r.programYear <= 0 ? "prelaunch" : "",
                r.programYear === matureYear ? "mature" : "",
                r.programYear === selectedYear ? "selected" : "",
              ]
                .filter(Boolean)
                .join(" ")}
              onClick={() => onSelect(r.programYear)}
              aria-selected={r.programYear === selectedYear}
            >
              <td>
                <button
                  type="button"
                  className="link-btn"
                  onClick={(e) => {
                    e.stopPropagation();
                    onSelect(r.programYear);
                  }}
                >
                  {yearLabel(r.programYear)}
                </button>
              </td>
              <td>{number(r.totalResidents, r.totalResidents % 1 === 0 ? 0 : 1)}</td>
              {RESIDENCY_YEARS.map((y) => (
                <td key={y}>
                  {number(
                    r.residentsByYear[y],
                    r.residentsByYear[y] % 1 === 0 ? 0 : 1
                  )}
                </td>
              ))}
              <td>{fig(r.totalBenefits, { compact: true })}</td>
              <td>{fig(r.totalCosts, { compact: true })}</td>
              <td className={netClass(r.netValue)}>{fig(r.netValue, { compact: true })}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
