/** Formatting helpers for the UI. */

export function currency(n: number, opts: { compact?: boolean } = {}): string {
  const abs = Math.abs(n);
  if (opts.compact && abs >= 1_000_000) {
    return `${n < 0 ? "-" : ""}$${(abs / 1_000_000).toFixed(2)}M`;
  }
  if (opts.compact && abs >= 1_000) {
    return `${n < 0 ? "-" : ""}$${(abs / 1_000).toFixed(0)}K`;
  }
  return `${n < 0 ? "-" : ""}$${Math.round(abs).toLocaleString("en-US")}`;
}

export function percent(fraction: number, digits = 0): string {
  return `${(fraction * 100).toFixed(digits)}%`;
}

export function number(n: number, digits = 0): string {
  return n.toLocaleString("en-US", {
    minimumFractionDigits: digits,
    maximumFractionDigits: digits,
  });
}
