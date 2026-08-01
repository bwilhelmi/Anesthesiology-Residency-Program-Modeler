import { describe, it, expect } from "vitest";
import { REFERENCES } from "./components/References";
import appSource from "./App.tsx?raw";
import hospitalPickerSource from "./components/HospitalPicker.tsx?raw";
import regionPickerSource from "./components/RegionPicker.tsx?raw";

/**
 * Guards on the bibliography: every reference is uniquely numbered and carries a
 * real URL, and every number cited in the UI resolves to an entry. Numbers are
 * anchor targets (#ref-N), so new sources are appended, never renumbered — this
 * test is what makes that rule enforceable.
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
    // Scanned rather than listed by hand, so a <Cite> added to a new field
    // cannot quietly point at a reference that does not exist.
    const known = new Set(REFERENCES.map((r) => r.n));
    const sources = [appSource, hospitalPickerSource, regionPickerSource];

    const cited = new Set<number>();
    for (const src of sources) {
      for (const m of src.matchAll(/(?:ns|cite)=\{\[([\d,\s]+)\]\}/g)) {
        for (const n of m[1].split(",")) cited.add(Number(n.trim()));
      }
    }

    expect(cited.size).toBeGreaterThan(0);
    for (const n of cited) expect(known.has(n)).toBe(true);
  });

  it("cites the regulatory and accreditation sources the v2 model relies on", () => {
    const byUrl = new Map(REFERENCES.map((r) => [r.url, r]));
    for (const section of [
      "section-413.79",
      "section-413.77",
      "section-412.105",
      "section-412.322",
      "section-415.110",
      "section-415.178",
    ]) {
      expect([...byUrl.keys()].some((u) => u.includes(section))).toBe(true);
    }
    expect([...byUrl.keys()].some((u) => u.includes("acgme.org"))).toBe(true);
    expect([...byUrl.keys()].some((u) => u.includes("aamc.org/data-reports"))).toBe(true);
  });
});
