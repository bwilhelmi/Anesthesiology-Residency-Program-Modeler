import {
  BLOCKS_PER_YEAR,
  ROTATIONS,
  YEAR_LABELS,
  deriveYear,
  rotation,
  site,
  type Block,
  type ResidencyYear,
  type TrainingSite,
} from "../../model";
import { percent } from "../format";

/**
 * The block schedule editor: 13 blocks a year, each a rotation at a site.
 *
 * This panel is the model's evidence base rather than another set of dials. The
 * three clinical fractions underneath every coverage figure are derived from
 * what is entered here, and the blocks that earn the sponsoring hospital no
 * anesthesia care are named individually instead of being averaged away.
 */
export function BlockScheduleEditor({
  year,
  blocks,
  sites,
  onChange,
}: {
  year: ResidencyYear;
  blocks: Block[];
  sites: TrainingSite[];
  onChange: (blocks: Block[]) => void;
}) {
  const derived = deriveYear(blocks, sites);

  const patch = (index: number, change: Partial<Block>) =>
    onChange(blocks.map((b, i) => (i === index ? { ...b, ...change } : b)));

  return (
    <div className="blocks">
      <div className="blocks-summary callout">
        <strong>{derived.sponsorBlocks.toFixed(1)}</strong> of {derived.totalBlocks} blocks
        at the sponsor hospital, of which{" "}
        <strong>{derived.sponsorAnesthesiaBlocks.toFixed(1)}</strong> deliver anesthesia
        care. Derived: {percent(derived.sponsorSiteShare)} sponsor-site,{" "}
        {percent(derived.fractionOnAnesthesia)} on anesthesia,{" "}
        {percent(derived.imeCountableShare)} IME-countable.
      </div>

      <ol className="block-list">
        {blocks.map((block, i) => {
          const def = rotation(block.rotationId);
          const s = site(block.siteId, sites);
          const productive = def?.kind === "anesthesia" && (s?.sponsorShare ?? 0) > 0;
          return (
            <li key={i} className={`block-row ${productive ? "" : "unproductive"}`}>
              <span className="block-n" aria-label={`Block ${i + 1}`}>
                {i + 1}
              </span>
              <select
                className="block-select"
                aria-label={`${YEAR_LABELS[year]} block ${i + 1} rotation`}
                value={block.rotationId}
                onChange={(e) => patch(i, { rotationId: e.target.value })}
              >
                {ROTATIONS.map((r) => (
                  <option key={r.id} value={r.id}>
                    {r.label}
                  </option>
                ))}
              </select>
              <select
                className="block-select block-site"
                aria-label={`${YEAR_LABELS[year]} block ${i + 1} site`}
                value={block.siteId}
                onChange={(e) => patch(i, { siteId: e.target.value })}
              >
                {sites.map((x: TrainingSite) => (
                  <option key={x.id} value={x.id}>
                    {x.label}
                  </option>
                ))}
              </select>
              {!productive && (
                <span className="block-flag" title="Earns the sponsor no anesthesia care">
                  no OR revenue
                </span>
              )}
            </li>
          );
        })}
      </ol>

      {blocks.length !== BLOCKS_PER_YEAR && (
        <p className="results-note">
          {blocks.length} blocks scheduled rather than {BLOCKS_PER_YEAR}.
        </p>
      )}

      {derived.nonProductive.length > 0 && (
        <div className="callout">
          <strong>Not earning the sponsor anesthesia care:</strong>{" "}
          {derived.nonProductive
            .map((n) => `${n.label.split(" — ")[0]} ${n.blocks.toFixed(1)} (${n.reason})`)
            .join("; ")}
          .
        </div>
      )}
    </div>
  );
}
