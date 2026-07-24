import { describe, it, expect } from "vitest";
import { REFERENCES } from "./components/References";

/**
 * Guards on the bibliography: every reference is uniquely numbered and carries a
 * real URL, and the numbers cited in the UI (1–6) all resolve to an entry. If a
 * <Cite ns={[n]} /> is added for a new source, add the reference here too.
 */
describe("bibliography references", () => {
  it("has unique, sequential reference numbers", () => {
    const ns = REFERENCES.map((r) => r.n);
    expect(new Set(ns).size).toBe(ns.length);
    expect(ns).toEqual([...ns].sort((a, b) => a - b));
  });

  it("every reference has a label and an http(s) URL", () => {
    for (const r of REFERENCES) {
      expect(r.label.length).toBeGreaterThan(0);
      expect(r.url).toMatch(/^https?:\/\//);
    }
  });

  it("every footnote number cited in the UI resolves to a reference", () => {
    // Numbers used by <Cite> across the pickers.
    const citedInUi = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12];
    const known = new Set(REFERENCES.map((r) => r.n));
    for (const n of citedInUi) expect(known.has(n)).toBe(true);
  });
});
