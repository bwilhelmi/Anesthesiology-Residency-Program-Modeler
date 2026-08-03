/**
 * Restoring saved inputs without poisoning the model.
 *
 * The naive restore — `{...DEFAULT_INPUTS, ...JSON.parse(raw)}` — is a SHALLOW
 * merge, so a saved payload replaces whole nested objects (`salaries`,
 * `clinical.PGY4`) wholesale. Any field added since that payload was written is
 * then simply absent, and its default never applies. Arithmetic on `undefined`
 * produces NaN, and because every figure in the model descends from those
 * inputs, one missing field renders the entire interface as "$NaN" with no
 * error and no way for a user to recover short of clearing site data.
 *
 * That was handled for a while by bumping a version key on every schema change,
 * which works exactly as long as nobody forgets — and it was forgotten once
 * already. This module removes the need for the discipline: defaults are merged
 * UNDERNEATH saved values at every depth, and any value whose type does not
 * match the default is discarded rather than trusted.
 *
 * The result is that saved inputs survive a schema change instead of being
 * retired by it, and a corrupted payload degrades to defaults rather than to
 * NaN.
 */

/** True for plain objects — the things worth recursing into. */
function isPlainObject(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

/**
 * Merge `saved` over `defaults`, recursively, keeping a saved value only when
 * it is usable: same type as the default, and finite if numeric. Unknown keys
 * in `saved` (fields since renamed or removed) are dropped.
 */
export function mergeSaved<T>(defaults: T, saved: unknown): T {
  if (!isPlainObject(defaults) || !isPlainObject(saved)) return defaults;

  const out: Record<string, unknown> = { ...defaults };
  for (const [key, fallback] of Object.entries(defaults)) {
    if (!(key in saved)) continue;
    const value = saved[key];

    if (isPlainObject(fallback)) {
      out[key] = mergeSaved(fallback, value);
      continue;
    }
    if (typeof value !== typeof fallback) continue;
    // NaN and Infinity are the specific poisons this module exists to stop.
    if (typeof value === "number" && !Number.isFinite(value)) continue;
    out[key] = value;
  }
  return out as T;
}

/**
 * Restore inputs from a raw localStorage string, falling back to defaults on
 * anything unparseable. Never throws.
 */
export function restoreInputs<T>(defaults: T, raw: string | null): T {
  if (!raw) return defaults;
  try {
    return mergeSaved(defaults, JSON.parse(raw));
  } catch {
    return defaults;
  }
}
