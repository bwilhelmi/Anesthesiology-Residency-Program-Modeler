# SPEC_ADDENDUM_CRNA_HOURS.md — CRNA paid-hours vs. delivered-coverage-hours

**Audience:** Claude Code, working against current `main` (the branch that already
contains `crnaPremiumPayLoad`, `crnaCostOfCoverage()` in `src/model/clinical.ts`,
`src/model/sensitivity.ts`, `src/model/workforce.ts`, and `regression.test.ts`).
**Scope:** one economic fix, two guardrails. Same ground rules as `UPGRADE_SPEC.md`
(model purity, no new deps, typecheck + tests green before commit). Single commit:
`ADD-B: CRNA worked-hours backfill + premium-pay guardrails`.

---

## B1 — Worked-hours backfill in `crnaCostOfCoverage()`

**Problem.** `crnaPremiumPayLoad` captures that extra hours cost *more*; it does not
capture that a paid CRNA FTE delivers *fewer* than 2,080 coverage hours. A base salary
buys 2,080 **paid** hours, of which only ~1,860 are **worked** after vacation, CME,
sick, and paid holidays. Delivering one coverage-FTE-year (2,080 location-hours)
therefore costs ~1.12 paid CRNA FTEs — or the equivalent purchased as additional
overtime. Meanwhile resident coverage is already net of resident vacation/didactics via
`fractionOnAnesthesia`, so the current comparison is asymmetric against the CRNA cost.

**Change.**
1. Add to `SalaryInputs` (types.ts), directly after `crnaPremiumPayLoad`:

```ts
/**
 * Hours a paid CRNA FTE actually works per year after vacation, CME, sick,
 * and paid holidays, out of 2,080 paid hours. Covering a location for a full
 * coverage-FTE-year therefore requires 2080 / this many paid FTEs (or the
 * shortfall purchased as overtime). Typical range 1,780–1,940.
 *
 * PARAMETERIZATION TRAP — read before pulling numbers from payroll. There are
 * two internally consistent ways to set this and crnaPremiumPayLoad, and
 * mixing them double-counts PTO-backfill overtime:
 *   (a) Structural: crnaPremiumPayLoad = differentials and late-room/holiday
 *       OT only (exclude OT worked to cover colleagues' PTO), and
 *       crnaWorkedHoursPerPaidFte = ~1,860 so the model prices the backfill.
 *   (b) Payroll-derived: crnaPremiumPayLoad = ALL premium dollars ÷ base from
 *       actual payroll (which already includes PTO-backfill OT), and
 *       crnaWorkedHoursPerPaidFte = 2,080 so the model does not price it twice.
 * Default is mode (a).
 */
crnaWorkedHoursPerPaidFte: number;
```

2. `constants.ts` → `DEFAULT_SALARIES`: `crnaWorkedHoursPerPaidFte: 1_860,` with a
   short comment: `// 2,080 paid − ~4 wks vacation − 1 wk CME − holidays/sick. Mode (a); see types.ts.`
3. `clinical.ts` → `crnaCostOfCoverage()` becomes:

```ts
export function crnaCostOfCoverage(salaries: SalaryInputs): number {
  const wages = salaries.crnaSalary * (1 + Math.max(0, salaries.crnaPremiumPayLoad));
  const paidFtePerCoverageFte =
    2080 / Math.max(1, Math.min(2080, salaries.crnaWorkedHoursPerPaidFte));
  return loaded(wages, salaries.benefitLoadRate) * paidFtePerCoverageFte;
}
```

   Extend the existing function doc comment with one sentence: the backfill factor
   converts paid-FTE cost into delivered-coverage-hour cost, and the resident side
   needs no mirror because `fractionOnAnesthesia` is already net of resident time off.
4. **Tests** (`model.test.ts` or a new `crna.test.ts`):
   - Defaults: `220_000 × 1.12 × 1.25 × (2080/1860)` → `toBeCloseTo(344_430, -1)`.
   - `crnaWorkedHoursPerPaidFte: 2080` reproduces the prior value `308_000` exactly
     (mode (b) regression anchor).
   - Values `< 1` or `> 2080` are clamped, no NaN/Infinity.

## B2 — Tornado coverage for the two payroll-settleable inputs

**Problem.** `sensitivity.ts` swings `crnaSalary` but not `crnaPremiumPayLoad` — the
one input the code itself instructs the user to replace with payroll data — nor the new
worked-hours input. These are the assumptions a CFO's analyst will attack first; the
tornado should show what they're worth.

**Change.** Add two bars to the fixed variable list in `sensitivity.ts`:
- `key: "crnaPremium"`, label `"CRNA premium pay load (OT/holiday/weekend)"` —
  **absolute** swing, low `0.05` / high `0.20` (not ±20% relative; the plausible range
  is stated in the constants.ts comment).
- `key: "crnaWorkedHours"`, label `"CRNA worked hours per paid FTE"` — absolute swing,
  low `1_780` / high `1_940` (note: low hours ⇒ higher cost ⇒ higher labor benefit, so
  the low input maps to the high metric; implement via the patch functions, do not
  special-case the sort).
- **Test:** both bars appear, nonzero width at defaults, ordering stays deterministic.

## B3 — Double-count guardrail vs. the call-coverage module

**Problem.** The `crnaPremiumPayLoad` doc mentions "call differentials" while
`workforce.ts` (call coverage benefit, default OFF) values avoided call nights. If a
user sets a payroll-derived premium load *and* enables call coverage, overnight call pay
is counted twice.

**Change.**
1. Partition the language:
   - `crnaPremiumPayLoad` comment (types.ts + constants.ts): scope it to **scheduled-day
     premium** — late-running-room OT, weekend and holiday differentials for scheduled
     coverage. Delete the word "call" from its examples.
   - `workforce.ts` call-coverage doc + UI help: scope it to **overnight in-house call**
     (stipends, call-back pay, or locum nights), and add: "Do not enable if your
     crnaPremiumPayLoad was derived from total payroll premium dollars — that figure
     already contains call pay."
2. Emit a warning (existing warnings channel) when call coverage is enabled **and**
   `crnaPremiumPayLoad > 0.15`: "Call-coverage benefit is on while the CRNA premium
   load is high — confirm call pay is not counted in both places."
3. **Test:** warning fires at `enabled: true, crnaPremiumPayLoad: 0.16`; silent at
   `0.12` or when disabled.

## B4 — Bookkeeping

- `regression.test.ts`: update the frozen snapshot **once**, with a comment block:
  labor-substitution line rises ~11.8% (backfill factor 2080/1860) vs. the prior
  snapshot; nothing else moves at defaults except downstream totals/NPV.
- `README.md`: in the labor-substitution row, replace any "loaded CRNA cost" phrasing
  with "delivered-coverage cost of a CRNA: base + scheduled-day premium pay + fringe,
  grossed up for paid-vs-worked hours (a paid FTE delivers ~1,860 of 2,080 hours)."
- `References.tsx`: append (do not renumber) an entry for the AANA Compensation and
  Benefits Survey — note it reports base and total comp but does not isolate premium
  pay, which is why the premium load must come from hospital payroll —
  `https://www.aana.com/membership/member-benefits/compensation-benefits-survey/`.
- UI (`App.tsx`): expose `crnaWorkedHoursPerPaidFte` beside the premium-load field with
  help text summarizing modes (a)/(b) in one sentence each.

## Definition of done

- [ ] `npm run typecheck && npm test && npm run build` green.
- [ ] Defaults produce `crnaCostOfCoverage ≈ $344,430`; mode (b) inputs reproduce
      `$308,000`.
- [ ] Tornado shows the two new bars; regression snapshot updated with the explanatory
      comment.
- [ ] No remaining text implies call pay lives in both `crnaPremiumPayLoad` and the
      call-coverage module.
