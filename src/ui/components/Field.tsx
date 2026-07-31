import React from "react";
import { percent } from "../format";

type BaseProps = {
  label: string;
  help?: string;
};

/** A labeled numeric input with an optional unit prefix/suffix. */
export function NumberField({
  label,
  help,
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
      <span className="field-label">{label}</span>
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
      <span className="field-label">{label}</span>
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
        />
        <span className="affix">%</span>
      </span>
      {help && <span className="field-help">{help}</span>}
    </label>
  );
}

/** A slider + readout for a [0,1] fraction. */
export function SliderField({
  label,
  help,
  value,
  onChange,
  max = 1,
  format = (v: number) => percent(v),
}: BaseProps & {
  value: number;
  onChange: (v: number) => void;
  max?: number;
  format?: (v: number) => string;
}) {
  return (
    <label className="field">
      <span className="field-label">
        {label}
        <span className="field-readout">{format(value)}</span>
      </span>
      <input
        className="slider"
        type="range"
        min={0}
        max={max}
        step={max / 100}
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
  value,
  onChange,
}: BaseProps & {
  value: boolean;
  onChange: (v: boolean) => void;
}) {
  return (
    <label className="field field-toggle">
      <span className="field-label">{label}</span>
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
