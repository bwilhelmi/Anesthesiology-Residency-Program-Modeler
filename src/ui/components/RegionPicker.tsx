import React from "react";
import {
  IS_PLACEHOLDER,
  MARKET_PREMIUM_DEFAULTS,
  regionSalaries,
  SALARY_DATA,
  US_STATES,
} from "../regions";
import { currency, percent } from "../format";
import { SliderField } from "./Field";
import { Cite } from "./References";

/**
 * Lets the user pick a state and pull BLS OEWS anesthesiologist / CRNA mean wages
 * into the model's salary fields, scaled by role-specific "market premiums" whose
 * defaults are calibrated to national recruiting/compensation benchmarks
 * (Merritt Hawkins / AMN and Doximity) — see MARKET_PREMIUM_DEFAULTS.
 */
export function RegionPicker({
  onApply,
}: {
  onApply: (anesthesiologist: number, crna: number) => void;
}) {
  const [region, setRegion] = React.useState<string>("");
  const [anesthPremium, setAnesthPremium] = React.useState<number>(
    MARKET_PREMIUM_DEFAULTS.anesthesiologist,
  );
  const [crnaPremium, setCrnaPremium] = React.useState<number>(MARKET_PREMIUM_DEFAULTS.crna);

  const preview = regionSalaries(region, anesthPremium, crnaPremium);

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
        label="Anesthesiologist market premium"
        help="Default +25% reflects that the BLS employed-wage mean sits below market: Merritt Hawkins / AMN put nonacademic starting base near $450K (~+25%), Doximity puts total compensation at $523K (~+45%, including bonus/production loaded separately)."
        value={anesthPremium}
        onChange={setAnesthPremium}
        max={0.6}
        format={(v) => `+${percent(v)}`}
      />
      <SliderField
        label="CRNA market premium"
        help="Default +3%. The BLS CRNA mean is already essentially at market: the AANA 2024 survey puts median CRNA salary at $251K and average total compensation near $256K, only a few percent above BLS. Raise this if staffing with locums."
        value={crnaPremium}
        onChange={setCrnaPremium}
        max={0.4}
        format={(v) => `+${percent(v)}`}
      />
      <p className="region-source">
        Premium defaults calibrated to national benchmarks<Cite ns={[5, 11, 12, 13]} />: BLS OEWS
        employed means, Merritt Hawkins / AMN recruiting incentives, Doximity compensation, and
        the AANA CRNA compensation survey.
      </p>

      {preview ? (
        <div className="region-preview">
          <div className="region-figure">
            <span className="region-figure-label">
              Anesthesiologist
              <Cite ns={[5]} />
            </span>
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
            <span className="region-figure-label">
              CRNA
              <Cite ns={[5]} />
            </span>
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
