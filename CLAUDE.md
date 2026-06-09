# CLAUDE.md — Homebase

Homebase is Quria Solutions' manager-facing control platform: Next.js 14 (App Router) on Vercel, TypeScript, Supabase. It's where managers structure data, set rules, review AI output, and keep oversight; the **Soteria** assistant is embedded. **Aegis** (separate repo, `~/Desktop/Aegis`) is the external AI manager. Live client: Watermark Country Club (launched June 5, 2026).

## Session protocol (do this every session — non-negotiable)
1. **At session start, read first:** `~/Desktop/Aegis/DEV_ROADMAP.md` (live sprint + Logging Protocol) and the trackers — `~/Desktop/Aegis/EMAIL_WORKFLOWS_TRACKER.md`, `~/Desktop/Aegis/SCHEMA_DRIFT_LOG.md`, `~/Desktop/Aegis/TEST_IDENTITIES.md`. Self-brief from these before touching anything.
2. **Fix-now bias:** if a fix is in scope and safe — diagnosed, surgical, `tsc`-clean, and not a production write/push/deploy — do it this session. Don't log it for "later".
3. **Defer only with a logged reason:** when a fix is unsafe to do now (rippling/large change, needs Alexander's decision, or writes production / deploys), say why in plain English and log it in the right doc. Never silently drop it, and never sweep a large change blind.
4. **At session end, write it all back:** every finding, decision, new bug, and schema surprise goes into the right doc — roadmap status + Session Log entry, the trackers, `~/Desktop/Aegis/SCHEMA_DRIFT_LOG.md`, and the `~/Desktop/Aegis/docs/` reference when behavior changed. **If it wasn't logged, it isn't done.**

## Read before you act
@~/Desktop/Aegis/DEV_ROADMAP.md
- The roadmap is the single shared sprint/progress doc (it lives in the Aegis repo; imported here by absolute path so both repos see the same live state — you'll approve the cross-repo import once). Treat its Current Sprint as the priority.
- Deep reference — single source of truth lives in the Aegis repo (read the relevant one before working in that area): `~/Desktop/Aegis/docs/03_Homebase_Reference.md`, `~/Desktop/Aegis/docs/02_Database_Schema.md`, `~/Desktop/Aegis/docs/06_Supplemental_Reference.md`.
- Live trackers (in the Aegis repo): `~/Desktop/Aegis/EMAIL_WORKFLOWS_TRACKER.md`, `~/Desktop/Aegis/SCHEMA_DRIFT_LOG.md`, `~/Desktop/Aegis/TEST_IDENTITIES.md`.

## Hard rules (do not violate)
- **Diagnose before fixing.** Explain the plan in plain English BEFORE editing. No blind fixes.
- **Supabase:** anon key client-side (respects RLS), service-role server-side. **RLS gotcha:** a missing `public.users` row, or `users.id` not matching `auth.users.id`, returns empty everywhere → infinite loading.
- **Verify column names against `information_schema` before writes.** Homebase's types live in `src/lib/types.ts` (there is NO `src/db/types.ts` in this repo). Don't trust types as the schema of record — the Aegis engine's `src/db/types.ts` notably omits `employees.sex` and `shift_requirements.accepted_roles`. Log new findings in `SCHEMA_DRIFT_LOG.md`.
- **Dates:** NEVER `new Date('YYYY-MM-DD')` for display (UTC-midnight shifts the day back). Use `split('-')` + `new Date(y, m-1, d)`.
- **Soteria:** exactly ONE `<action>` per response; keep `max_tokens` 8192 (truncation silently breaks the parser). `add_conflict` severity is `'avoid'`/`'never'`; `add_shift` must set `accepted_roles` (NOT NULL, mirror `role`).
- **No orphan outputs:** every AI or manual change lands as valid, visible Homebase state within the constraints.
- **Configuration over code:** the engine/platform is generic and multi-tenant; client behavior is driven by their Supabase data + the constraint vocabulary, never by client-specific code. Accommodating a client is a data/config operation, not an engine change. Per-client rules are toggleable (e.g. sex_coverage on/off). If a client needs something the vocabulary can't express, that's a product conversation — never a quiet engine patch.
- `AEGIS_URL` must be the Railway prod URL; outbound links point to `homebase-nine-phi.vercel.app` (NEVER the dead `homebase-liart`).
- **No secrets or sensitive identifiers in committed files — reference docs included.** Names and architecture only. Real credential VALUES (API keys, auth tokens, Supabase/Stripe keys) AND sensitive identifiers (Twilio Account/Messaging-Service SIDs, project refs) never go in any tracked file. Use placeholders (`AC••• — see Vercel env / password manager`); real values live in env vars / the password manager. GitHub push-protection will block the push if you violate this (it happened in Aegis — see the 2026-06-09 Session Log in `~/Desktop/Aegis/DEV_ROADMAP.md`).
- Compile clean: `npx tsc --noEmit`, zero errors. **Show the full diff before any push.**

## Key paths
- Pages: `src/app/(app)/` (home, data, rules, schedule, activity, access, billing).
- **Schedule editor: `src/app/(app)/schedule/page.tsx`** — SCHED-EDIT-1 lives here (manual edits not persisting to `schedules.data.assignments`).
- Data tabs: `src/app/(app)/data/tabs/` (Employees, Time Off, Shifts, Conflicts, …). The in-tab TO approve path is the S3 sprint target.
- Soteria: `src/app/api/soteria/{route,execute,validate-schedule,validate-assignment}`.
- Stripe: `src/app/api/stripe/{route,webhook}` (amounts in cents; live vs test mode).
- Aegis bridge: `src/app/api/notify-day-closure`. Hooks: `src/lib/hooks/{useCompany,useQuria}.ts`.

## Deploy & danger zones
- Push to `main` → Vercel auto-deploys. After env-var changes, redeploy manually. Read the diff before pushing.
- **SCHED-EDIT-1 is OPEN:** a manually edited schedule must NOT be distributed (distribute reads stale hours).
- Schedule delete is quria_admin/owner only and permanent.
- Never print or commit secrets (Supabase, Stripe, Anthropic keys live in Vercel env vars).

## Cowork / autonomous operating model
- **SAFE LANE — an agent may do these unattended.** Reads of any kind (DB reads, dry-runs, the verify harness, build/deploy logs). Writes against the SANDBOX tenant only (`company_id = 00000000-0000-0000-0000-000000000001`). Code on a feature branch, `tsc`, open a PR. **Prefer the read-only DB role (`cowork_ro`) for reads when available** — least-privilege by default, not the service-role key.
- **HUMAN-GATED — never autonomous; queue for Alexander.** Merge/push to `main` (= deploy to live Watermark via Vercel). Any write to PRODUCTION / Watermark data. Production env-var or policy changes (incl. Supabase policy flips). Anything that messages a real employee (Aegis `distribute_schedule`, onboarding fan-out, real notifications). Any Stripe live-mode action.
- **Principle: autonomy and credential power trade off.** Unattended work runs read-only / sandbox-scoped. Privileged actions need a human. Safety comes from constraining the environment (branch-not-main, sandbox-not-prod, least-privilege creds), not from real-time watching.
- **Never exfiltrate data via MCP, Chrome, or network egress.** Reads stay in-repo / in-DB; output lands in the session, the PR, or the logged docs.
- **DONE-rule: committed ≠ done.** A change is `DONE` only when committed AND live-verified end-to-end. Committed-but-unpushed or pushed-but-unverified = `IN REVIEW`. Don't flip statuses on the strength of a clean `tsc` or a green PR alone.
- **Logging routing (additive to the Session protocol).** Apply enumerated status changes / decisions / findings exactly as the working note states — don't independently re-judge them. Route by topic: bugs / workflows → `~/Desktop/Aegis/EMAIL_WORKFLOWS_TRACKER.md`; schema surprises → `~/Desktop/Aegis/SCHEMA_DRIFT_LOG.md`; tenants / test identities → `~/Desktop/Aegis/TEST_IDENTITIES.md`. If it changed and wasn't logged, it isn't done.

## When you finish — follow the Logging Protocol
Work is not done until the project's memory is updated. Follow the **Logging Protocol** at the top of `~/Desktop/Aegis/DEV_ROADMAP.md`: update the roadmap status + append a Session Log entry, mirror bug changes into the trackers, append any schema finding to `SCHEMA_DRIFT_LOG.md`, and update the relevant reference doc when the change alters how the system works. Never end a session without it — the next agent self-briefs from these files.
