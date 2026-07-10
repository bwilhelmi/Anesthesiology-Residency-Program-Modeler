import React from "react";
import {
  IS_PLACEHOLDER,
  regionSalaries,
  SALARY_DATA,
  US_STATES,
} from "../regions";
import { currency, percent } from "../format";
import { SliderField } from "./Field";

/**
 * Lets the user pick a state and pull BLS OEWS anesthesiologist / CRNA mean
 * wages into the model's salary fields, scaled by a "market premium" that
 * reflects job-board (e.g. gaswork.com) offers running above employed means.
 */
export function RegionPicker({
  onApply,
}: {
  onApply: (anesthesiologist: number, crna: number) => void;
}) {
  const [region, setRegion] = React.useState<string>("");
  const [premium, setPremium] = React.useState<number>(0.1);

  const preview = regionSalaries(region, premium);

  return (
    <div className="region">
      <div className="region-row">
        <label className="field region-select">
          <span className="field-label">Region (U.S. state)</span>
          <span className="field-input">
            <select value={region} onChange={(e) => setRegion(e.target.value)}>
              <option value="">National (all states)</option>
              {US_STATES.map((s) => (
                <option key={s} value={s}>
                  {s}
                </option>
              ))}
            </select>
          </span>
        </label>
      </div>

      <SliderField
        label="Market premium over BLS baseline"
        help="BLS reports employed-wage means; job-board offers (e.g. gaswork.com) often run higher. Nudge this to reflect local market offers."
        value={premium}
        onChange={setPremium}
        max={0.5}
        format={(v) => `+${percent(v)}`}
      />

      {preview ? (
        <div className="region-preview">
          <div className="region-figure">
            <span className="region-figure-label">Anesthesiologist</span>
            <span className="region-figure-value">
              {currency(preview.anesthesiologist)}
              {preview.anesthesiologistEstimated && (
                <span className="region-est" title="State value unavailable; using the national figure.">
                  {" "}national*
                </span>
              )}
            </span>
          </div>
          <div className="region-figure">
            <span className="region-figure-label">CRNA</span>
            <span className="region-figure-value">
              {currency(preview.crna)}
              {preview.crnaEstimated && (
                <span className="region-est" title="State value unavailable; using the national figure.">
                  {" "}national*
                </span>
              )}
            </span>
          </div>
          <button
            type="button"
            className="region-apply"
            onClick={() => onApply(preview.anesthesiologist, preview.crna)}
          >
            Use these figures
          </button>
        </div>
      ) : (
        <div className="region-preview region-empty">
          Salary data not yet available for this region.
        </div>
      )}

      <p className="region-source">
        {IS_PLACEHOLDER ? (
          <>
            Showing placeholder figures — live BLS data loads after the first
            automated data refresh.
          </>
        ) : (
          <>
            Source: {SALARY_DATA.source}, {SALARY_DATA.measure.toLowerCase()},{" "}
            {SALARY_DATA.asOf}.
          </>
        )}
      </p>
    </div>
  );
}
