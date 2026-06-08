# CLAUDE.md — Homebase

Homebase is Quria Solutions' manager-facing control platform: Next.js 14 (App Router) on Vercel, TypeScript, Supabase. It's where managers structure data, set rules, review AI output, and keep oversight; the **Soteria** assistant is embedded. **Aegis** (separate repo, `~/Desktop/Aegis`) is the external AI manager. Live client: Watermark Country Club (launched June 5, 2026).

## Read before you act
@~/Desktop/Aegis/DEV_ROADMAP.md
- The roadmap is the single shared sprint/progress doc (it lives in the Aegis repo; imported here by absolute path so both repos see the same live state — you'll approve the cross-repo import once). Treat its Current Sprint as the priority.
- Deep reference — single source of truth lives in the Aegis repo (read the relevant one before working in that area): `~/Desktop/Aegis/docs/03_Homebase_Reference.md`, `~/Desktop/Aegis/docs/02_Database_Schema.md`, `~/Desktop/Aegis/docs/06_Supplemental_Reference.md`.
- Live trackers (in the Aegis repo): `~/Desktop/Aegis/EMAIL_WORKFLOWS_TRACKER.md`, `~/Desktop/Aegis/SCHEMA_DRIFT_LOG.md`, `~/Desktop/Aegis/TEST_IDENTITIES.md`.

## Hard rules (do not violate)
- **Diagnose before fixing.** Explain the plan in plain English BEFORE editing. No blind fixes.
- **Supabase:** anon key client-side (respects RLS), service-role server-side. **RLS gotcha:** a missing `public.users` row, or `users.id` not matching `auth.users.id`, returns empty everywhere → infinite loading.
- **Verify column names against `information_schema` before writes.** `src/db/types.ts` is INCOMPLETE (omits `employees.sex`, `shift_requirements.accepted_roles`). Log new findings in `SCHEMA_DRIFT_LOG.md`.
- **Dates:** NEVER `new Date('YYYY-MM-DD')` for display (UTC-midnight shifts the day back). Use `split('-')` + `new Date(y, m-1, d)`.
- **Soteria:** exactly ONE `<action>` per response; keep `max_tokens` 8192 (truncation silently breaks the parser). `add_conflict` severity is `'avoid'`/`'never'`; `add_shift` must set `accepted_roles` (NOT NULL, mirror `role`).
- **No orphan outputs:** every AI or manual change lands as valid, visible Homebase state within the constraints.
- `AEGIS_URL` must be the Railway prod URL; outbound links point to `homebase-nine-phi.vercel.app` (NEVER the dead `homebase-liart`).
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

## When you finish — follow the Logging Protocol
Work is not done until the project's memory is updated. Follow the **Logging Protocol** at the top of `~/Desktop/Aegis/DEV_ROADMAP.md`: update the roadmap status + append a Session Log entry, mirror bug changes into the trackers, append any schema finding to `SCHEMA_DRIFT_LOG.md`, and update the relevant reference doc when the change alters how the system works. Never end a session without it — the next agent self-briefs from these files.
