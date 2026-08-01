import React from "react";
import { percent } from "../format";
import { Cite } from "./References";

type BaseProps = {
  label: string;
  help?: string;
  /** Bibliography entry numbers backing this figure, shown as a superscript. */
  cite?: number[];
  /**
   * Soft bounds, applied ON BLUR only. Typing is never blocked or rewritten
   * mid-keystroke — a field that fights the keyboard is worse than a field that
   * briefly holds a nonsense number.
   */
  clamp?: { min?: number; max?: number };
};

/** Apply soft bounds to a settled value. */
function applyClamp(v: number, clamp?: { min?: number; max?: number }): number {
  if (!clamp) return v;
  let out = v;
  if (clamp.min !== undefined) out = Math.max(clamp.min, out);
  if (clamp.max !== undefined) out = Math.min(clamp.max, out);
  return out;
}

/** A field label with its optional source footnote. */
function Label({ label, cite }: { label: string; cite?: number[] }) {
  return (
    <>
      {label}
      {cite && cite.length > 0 ? <Cite ns={cite} /> : null}
    </>
  );
}

/** A labeled numeric input with an optional unit prefix/suffix. */
export function NumberField({
  label,
  help,
  cite,
  clamp,
  value,
  onChange,
  min,
  max,
  step = 1,
  prefix,
  suffix,
  disabled = false,
}: BaseProps & {
  value: number;
  onChange: (v: number) => void;
  min?: number;
  max?: number;
  step?: number;
  prefix?: string;
  suffix?: string;
  disabled?: boolean;
}) {
  return (
    <label className={`field ${disabled ? "disabled" : ""}`}>
      <span className="field-label">
        <Label label={label} cite={cite} />
      </span>
      <span className="field-input">
        {prefix && <span className="affix">{prefix}</span>}
        <input
          type="number"
          value={Number.isFinite(value) ? value : ""}
          min={min}
          max={max}
          step={step}
          disabled={disabled}
          onChange={(e) => {
            const v = e.target.valueAsNumber;
            onChange(Number.isNaN(v) ? 0 : v);
          }}
          onBlur={() => {
            const settled = applyClamp(value, clamp);
            if (settled !== value) onChange(settled);
          }}
        />
        {suffix && <span className="affix">{suffix}</span>}
      </span>
      {help && <span className="field-help">{help}</span>}
    </label>
  );
}

/** A percentage input backed by a [0,1] fraction (displayed as 0-100). */
export function PercentField({
  label,
  help,
  cite,
  clamp,
  value,
  onChange,
  max = 100,
}: BaseProps & {
  value: number;
  onChange: (fraction: number) => void;
  max?: number;
}) {
  return (
    <label className="field">
      <span className="field-label">
        <Label label={label} cite={cite} />
      </span>
      <span className="field-input">
        <input
          type="number"
          value={Math.round(value * 1000) / 10}
          min={0}
          max={max}
          step={1}
          onChange={(e) => {
            const v = e.target.valueAsNumber;
            onChange(Number.isNaN(v) ? 0 : v / 100);
          }}
          onBlur={() => {
            const settled = applyClamp(value, clamp);
            if (settled !== value) onChange(settled);
          }}
        />
        <span className="affix">%</span>
      </span>
      {help && <span className="field-help">{help}</span>}
    </label>
  );
}

/**
 * A slider + readout. Defaults to a [0,1] fraction in 1% steps; `min` and `step`
 * open it up to ranges that are not fractions — a supervision ratio, say, where
 * the meaningful span is 2 to 4 and the meaningful grain is a tenth.
 */
export function SliderField({
  label,
  help,
  cite,
  value,
  onChange,
  min = 0,
  max = 1,
  step,
  format = (v: number) => percent(v),
}: BaseProps & {
  value: number;
  onChange: (v: number) => void;
  min?: number;
  max?: number;
  step?: number;
  format?: (v: number) => string;
}) {
  return (
    <label className="field">
      <span className="field-label">
        <Label label={label} cite={cite} />
        <span className="field-readout">{format(value)}</span>
      </span>
      <input
        className="slider"
        type="range"
        min={min}
        max={max}
        step={step ?? (max - min) / 100}
        value={value}
        onChange={(e) => onChange(e.target.valueAsNumber)}
      />
      {help && <span className="field-help">{help}</span>}
    </label>
  );
}

/** A yes/no toggle. */
export function ToggleField({
  label,
  help,
  cite,
  value,
  onChange,
}: BaseProps & {
  value: boolean;
  onChange: (v: boolean) => void;
}) {
  return (
    <label className="field field-toggle">
      <span className="field-label">
        <Label label={label} cite={cite} />
      </span>
      <button
        type="button"
        role="switch"
        aria-checked={value}
        className={`toggle ${value ? "on" : "off"}`}
        onClick={() => onChange(!value)}
      >
        <span className="toggle-knob" />
        <span className="toggle-text">{value ? "Yes" : "No"}</span>
      </button>
      {help && <span className="field-help">{help}</span>}
    </label>
  );
}

/**
 * A small set of mutually exclusive choices, rendered as a radio group rather
 * than a select: the options carry consequences the user should be able to read
 * without opening a menu.
 */
export function ChoiceField<T extends string>({
  label,
  help,
  cite,
  value,
  options,
  onChange,
}: BaseProps & {
  value: T;
  options: ReadonlyArray<{ value: T; label: string; help?: string }>;
  onChange: (v: T) => void;
}) {
  const name = React.useId();
  return (
    <fieldset className="field field-choice">
      <legend className="field-label">
        <Label label={label} cite={cite} />
      </legend>
      <div className="choice-options">
        {options.map((o) => (
          <label
            key={o.value}
            className={`choice-option ${value === o.value ? "selected" : ""}`}
          >
            <input
              type="radio"
              name={name}
              value={o.value}
              checked={value === o.value}
              onChange={() => onChange(o.value)}
            />
            <span className="choice-body">
              <span className="choice-label">{o.label}</span>
              {o.help && <span className="choice-help">{o.help}</span>}
            </span>
          </label>
        ))}
      </div>
      {help && <span className="field-help">{help}</span>}
    </fieldset>
  );
}

/** A collapsible titled group of fields. */
export function Section({
  title,
  subtitle,
  children,
  defaultOpen = true,
}: {
  title: string;
  subtitle?: string;
  children: React.ReactNode;
  defaultOpen?: boolean;
}) {
  const [open, setOpen] = React.useState(defaultOpen);
  return (
    <section className={`panel ${open ? "open" : "closed"}`}>
      <button
        type="button"
        className="panel-header"
        onClick={() => setOpen((o) => !o)}
        aria-expanded={open}
      >
        <span>
          <span className="panel-title">{title}</span>
          {subtitle && <span className="panel-subtitle">{subtitle}</span>}
        </span>
        {/* One glyph; the stylesheet rotates it when the section is closed. */}
        <span className="chev" aria-hidden>
          ▾
        </span>
      </button>
      {open && <div className="panel-body">{children}</div>}
    </section>
  );
}
