/** Formatting helpers for the UI. */

export function currency(
  n: number,
  opts: { compact?: boolean; accounting?: boolean } = {},
): string {
  const abs = Math.abs(n);
  let body: string;
  if (opts.compact && abs >= 1_000_000) {
    body = `$${(abs / 1_000_000).toFixed(2)}M`;
  } else if (opts.compact && abs >= 1_000) {
    body = `$${(abs / 1_000).toFixed(0)}K`;
  } else {
    body = `$${Math.round(abs).toLocaleString("en-US")}`;
  }
  if (n >= 0) return body;
  // Accounting style parenthesises negatives so the sign survives grayscale
  // print and screenshots, where a hue difference would not.
  return opts.accounting ? `(${body})` : `-${body}`;
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
