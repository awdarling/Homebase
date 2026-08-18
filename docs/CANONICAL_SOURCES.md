# Where the truth lives

**Decided 2026-08-18.** One model, no duplicates. Same model as the Aegis repo.

| Kind of document | Canonical home | Why |
|---|---|---|
| **Running state** — open items, drift logs, roadmap, test identities, session handoffs, delivery notes | **The Claude project** ("Quria Solutions - SMS Development Folder") | It is what every session reads first, and an agent can update it the moment something changes. A repo copy can only change through a PR that a human has to merge, so it is stale by design. |
| **Code-adjacent docs** — `CLAUDE.md`, `docs/*`, `SECURITY_AUDIT_API.md`, migration notes | **This repo** | They describe code, they change with code, and they belong in the same diff as the code. |

**Nothing lives in both places.**

Start every session with `claude/OPEN_ITEMS_MASTER.md` in the Claude project.

## Verdicts recorded 2026-08-18

- **`SECURITY_AUDIT_API.md` — KEPT in this repo.** It is a per-route audit of this repo's code, it
  has open findings, and it has no copy in the Claude project. A dated status banner was added to
  it because four of its five flags had been resolved in code since it was written and the document
  did not say so.
- **`PATH_TO_SELLABLE.md` — does not exist in this repo.** The only copy was in the Aegis repo and
  it was archived there on 2026-08-18 (superseded by `claude/OPEN_ITEMS_MASTER.md`).
- **No stale duplicated state docs were found in this repo.** Unlike Aegis, this repo never carried
  its own copies of the drift logs.
