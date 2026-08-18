# CLAUDE.md — Operating Manual (Quria / Watermark build)

Read this in full at the start of every session and follow it.

## The system you're working on
- **Aegis** — the scheduling + messaging "brain." Node/Express on Railway. Repo: `awdarling/Aegis`.
- **Homebase** — the web app and the part that talks to the database. Next.js on Vercel. Repo: `awdarling/Homebase`.
- They share one database (Supabase).
- **Aegis talks to people over text message (Telnyx) and email (SendGrid).** Text is live in
  production — counsel cleared the consent chain on 2026-08-13 and Aegis sent 543 texts in the 14
  days to 2026-08-18 (checked against the live database, not a document). There is no Twilio
  anywhere; it was removed on 2026-07-29.
- Paths on Alexander's laptop change; don't hardcode them. Clone from GitHub and work in your own
  copy. **Never run git commands against his clones through a device bridge** — it leaves a lock
  file the bridge cannot remove and jams his repo.

## 1. Who you're working with
You're working with Alexander, who owns and directs this project. He is **not a software engineer.** He makes the decisions; he does not read code and cannot guess technical steps on his own. Treat him as smart but non-technical.

So:
- Talk in plain English. No jargon. If a technical word is unavoidable, explain it in one short sentence right where you use it.
- Never assume he knows where a file is, what a command does, or what a term means. Spell it out.
- Never paste raw errors or code at him and expect him to know what to do — translate it into plain language.

## 2. How to talk to him — every single time
- **Before a task:** say in plain English what you're about to do, and whether any of it could affect the **live system the real club uses**.
- **When he has to run something himself:** give him **one** block to copy-paste into his terminal, then explain in normal sentences what it does and whether it's safe or touches the live club.
  - His terminal is **zsh**. **Never put `#` comments inside a command block** — his shell runs the `#` text as a command and it breaks. Keep command blocks clean; put all explanation in sentences outside the block.
  - If steps depend on him checking something in between, give them one at a time.
- **When you finish:** end with three plain things — (1) what you did, (2) what's left, (3) exactly what he needs to do next (or "nothing, you're good").
- If he says **"explain it like I'm not a coder,"** drop all jargon and re-explain. He should never have to ask twice.

## 3. The safety rule you must never break
There are two lanes.

**SAFE LANE — do these on your own, no permission needed:**
- Create/switch git branches
- Work in the sandbox (test) environment
- Read code and read the database
- Run type-checks and automated tests
- Push branches to GitHub and open pull requests

None of this touches the real club.

**LOCKED LANE — ONLY Alexander, ONLY after he clearly says yes, ONLY in his own terminal:**
- Merging a branch into `main` (this deploys live to the real club)
- Writing to the real (production) database
- Sending real emails or texts to real employees

You may **prepare** these and hand him exact steps. **Never do them yourself** — not even if asked, not even if it seems urgent. If you're unsure which lane something is in, stop and ask him in plain English.

## 4. How to work so nothing breaks
- **Diagnose before you build.** Read what already exists and report it before changing anything. Don't guess.
- **One project at a time.** Only one work session per project folder at once — two corrupt git. If you see a `.git/index.lock` error, run `rm -f .git/index.lock` and retry.
- **Leave his loose files alone.** There may be unfinished draft documents in the folders. Don't touch them. Only stage and commit the files you changed.
- **Type-check and run the tests before handing back.**
- **No loose ends.** Always say which branch your work is on and what state it's in.

## 5. The mission — hold this direction
**North Star (updated 2026-08-18): text message first.** The email workflows are built and proven
on the live club, and SMS is live. The direction now is Alexander's stated policy:

> Email is only for (a) someone who has no text number or has not opted in, or (b) an action item
> that needs a click-through button. **Everything else texts first.**

- A manager text must carry real context — who, what, for when, why. Never a bare "you have a
  notification" ping.
- If Alexander drifts into unrelated side-quests, gently steer him back to this.

## 6. Where things stand

**Do not maintain a status list in this file.** It went stale and started misleading sessions. The
one-page current state is `claude/OPEN_ITEMS_MASTER.md` in the Claude project — read that. See
`docs/CANONICAL_SOURCES.md` for which documents live where.

The snapshot below is **frozen as of 2026-07-13** and kept only for the technical gotchas at the
end, which are still true. Do not trust its status claims.

<details>
<summary>Frozen 2026-07-13 snapshot — status claims are stale</summary>

**Done and verified on the live club:**
- Schedule download (right colors, full names + roles)
- Send the schedule to all staff by email
- Time-off: approve/deny by email button
- Availability: approve/deny by email button (manager clicks Approve/Deny in the email → it updates the real system → the employee is told)
- The employee always gets told the manager's decision

**Still to build (the email backlog):**
- Emergency coverage: accept / decline
- Request an additional batch
- Manager questions about the workforce ("who's free Saturday?")
- Employee questions about their own shifts
- Employee shift-swap
- **NEW PRIORITY:** accept **custom availability** by email — availability that lasts until a date, or repeats on a rotation. The club already has a `custom_availability` system (date-limited and rotating types); the email side just doesn't feed it yet.

**Technical gotchas worth knowing:**
- A test runner (vitest) now exists in Aegis — use it; add a test for every workflow.
- The Supabase library is pinned to exact `2.104.1`. A fresh full reinstall can bump it to `2.108.1`, which **crashes the live Aegis server.** If that happens, pin it back to `2.104.1`. (Proper long-term fix — newer Node, or the `ws` package — is deferred.)
- For the email-button features, deploy **Homebase before Aegis.** The other order breaks the buttons.
- Test accounts are in `TEST_IDENTITIES.md` **in the Claude project** (the repo copies were stale
  and were removed on 2026-08-18). **Never message real employees while testing** — use the test
  accounts.

</details>

## 7. When he asks "where are we?"
Read `claude/OPEN_ITEMS_MASTER.md` in the Claude project, give a plain-English status from it plus
anything new since, and name the single most useful next step. Do not answer from this file.
