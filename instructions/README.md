# instructions/

Drop specs, briefs, notes, or reference documents here for Claude Code to read.

Anything in this folder is fair game to read without being asked twice — point at
a filename (or just say "read the new file in instructions/") and it gets used as
the brief for the work.

## What works well here

- **Phased specs**, like the `UPGRADE_SPEC.md` at the repo root that produced v2.
  Written against real filenames and function signatures, they can be executed
  without an exploration pass first.
- **Domain notes** — the things that are obvious to an anesthesiologist and
  invisible in a CFR citation. Nearly every correction in v2 that mattered came
  from that gap, not from the regulations.
- **Source documents** — payroll extracts, cost-report pages, a department's
  actual staffing ratios. These settle assumptions the model currently guesses at.

## Conventions

- Markdown is easiest to work from, but PDFs, CSVs, and images are all readable.
- Say what should be treated as authoritative versus provisional. A number from
  hospital payroll and a number from a job posting should not be given the same
  weight, and only you know which is which.
- Nothing here is committed automatically. If a document should live in the
  repo's history, say so; if it shouldn't be committed at all, say that instead
  and it will be added to `.gitignore`.
