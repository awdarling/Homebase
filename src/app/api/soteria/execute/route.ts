import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'
import { createClient as createServerSupabase } from '@/lib/supabase/server'
import { capabilityRoleFor } from '@/lib/soteria/capabilities'
import { throwOnWriteError } from '@/lib/soteria/persistGuard'
import { planConfiguration, summarizePlan, type ConfigBundle, type ExistingConfig } from '@/lib/soteria/ingestionPlanner'
import { planRosterImport, type RosterRowInput } from '@/lib/soteria/rosterImport'
import { inferShiftStructureFromSchedule, type ScheduleRowInput } from '@/lib/soteria/scheduleInference'
import { postToAegisInternal, AegisInternalError, AegisInternalConfigError } from '@/lib/aegis-internal'

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
)

// The scheduling engine reads STRUCTURED rules ONLY from policies.policy_value_json
// (the plain-text policy_value is ignored by the constraint parser — see
// Aegis src/lib/constraints/parser.ts). If a structured rule is updated with only
// policy_value set, the Rules page shows the new text while the engine keeps
// enforcing the OLD json — the "changed the rule but it's still enforced" bug.
// So: for these keys we refuse a text-only write. The edit must carry
// policy_value_json (Soteria's prompt already instructs this), or it fails
// visibly instead of silently leaving stale json. Mirrors the parser's key set.
const STRUCTURED_POLICY_KEYS = new Set<string>([
  'attribute_mix', 'minimum_attribute_mix',
  'hours_fairness_weight',
  'partial_shifts_allowed', 'allow_partial_shifts',
  'veteran_preference_default', 'veteran_default',
  'doubles_policy',
  'conflict_resolution_preference', 'conflict_resolution',
  'week_start_day',
  'max_consecutive_days_worked', 'max_consecutive_days', 'max_consecutive_work_days',
])

/** True when a text-only policy write would leave a structured rule's json stale. */
function isStaleStructuredWrite(policyKey: string, hasJson: boolean): boolean {
  return STRUCTURED_POLICY_KEYS.has((policyKey ?? '').trim().toLowerCase()) && !hasJson
}

function formatEventDate(iso: string | null | undefined): string {
  if (!iso) return '(no date)'
  const [y, m, d] = iso.split('-').map(Number)
  if (!y || !m || !d) return iso
  return new Date(y, m - 1, d).toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric' })
}

// Validate the structured special-event staffing spec (item 6) before it's
// written to events.event_shifts and later read by the schedule engine. Drops
// anything malformed; returns null when there's nothing usable. Shape mirrors
// Aegis src/lib/engine/event-shifts.ts (mode add | stretch).
const EVENT_SHIFT_TIME_RE = /^\d{2}:\d{2}$/
function sanitizeEventShifts(input: unknown): Record<string, unknown>[] | null {
  if (!Array.isArray(input)) return null
  const out: Record<string, unknown>[] = []
  for (const raw of input) {
    if (!raw || typeof raw !== 'object') continue
    const s = raw as Record<string, unknown>
    if (s.mode !== 'add' && s.mode !== 'stretch') continue
    const shiftName = typeof s.shift_name === 'string' ? s.shift_name.trim() : ''
    if (!shiftName) continue
    const entry: Record<string, unknown> = { mode: s.mode, shift_name: shiftName }
    if (typeof s.start_time === 'string' && EVENT_SHIFT_TIME_RE.test(s.start_time)) entry.start_time = s.start_time
    if (typeof s.end_time === 'string' && EVENT_SHIFT_TIME_RE.test(s.end_time)) entry.end_time = s.end_time
    if (Array.isArray(s.roles)) {
      const roles = s.roles
        .filter((r): r is Record<string, unknown> =>
          !!r && typeof r === 'object' &&
          typeof (r as Record<string, unknown>).role === 'string' &&
          Number.isFinite(Number((r as Record<string, unknown>).count)) &&
          Number((r as Record<string, unknown>).count) > 0)
        .map((r) => ({ role: (r.role as string).trim(), count: Math.floor(Number(r.count)) }))
      if (roles.length > 0) entry.roles = roles
    }
    if (typeof s.replaces_shift_name === 'string' && s.replaces_shift_name.trim()) {
      entry.replaces_shift_name = s.replaces_shift_name.trim()
    }
    // An "add" is only useful with hours + at least one role; skip incomplete ones.
    if (s.mode === 'add' && (!entry.start_time || !entry.end_time || !entry.roles)) continue
    out.push(entry)
  }
  return out.length > 0 ? out : null
}

// NOTE (contract): `events.event_shifts` is the CANONICAL source of truth for a special
// event's staffing exceptions. The engine reads it post-canvas in
// Aegis src/lib/engine/event-shifts.ts (called from canvas.ts), and it is a strict
// SUPERSET of the legacy `events.shift_overrides` column: it supports per-role count
// overrides (`stretch` + roles[].count), time changes, AND brand-new one-off shifts
// (`mode: 'add'`) — none of which shift_overrides can express.
//
// Do NOT also write `shift_overrides` here. Dual-writing the same concept into two
// columns is exactly the drift that causes silent divergence (the legacy column applies
// PRE-canvas and can disagree with event_shifts). `shift_overrides` is legacy and should
// be retired, not mirrored.

export async function POST(request: NextRequest) {
  try {
    const body = await request.json()
    const { action, companyId } = body as {
      action: { type: string; description?: string; data: Record<string, unknown> }
      companyId: string
    }

    // ── Auth check ──────────────────────────────────────────────────────────
    const ssr = await createServerSupabase()
    const { data: { user } } = await ssr.auth.getUser()
    if (!user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }
    const { data: userRow } = await ssr
      .from('users')
      .select('company_id, role')
      .eq('id', user.id)
      .single()
    if (!userRow || (userRow as { company_id: string }).company_id !== companyId) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
    }

    // Scope guard: Soteria's write actions are manager/owner work. If an employee
    // somehow reaches the executor, refuse kindly instead of writing data.
    if (capabilityRoleFor((userRow as { role?: string }).role) === 'employee') {
      return NextResponse.json(
        { error: "That one's a manager action — a manager or owner can make that change. You can still ask me about time off, your availability, your shifts, and shift swaps." },
        { status: 403 }
      )
    }

    switch (action.type) {

      case 'add_employee': {
        const d = action.data as {
          name: string
          primary_role: string
          qualified_roles?: string[]
          max_weekly_hours?: number
          contact_phone?: string | null
          contact_email?: string | null
        }
        const { data, error } = await supabase.from('employees').insert({
          company_id: companyId,
          name: d.name,
          primary_role: d.primary_role,
          qualified_roles: d.qualified_roles ?? [d.primary_role],
          max_weekly_hours: d.max_weekly_hours ?? 40,
          contact_phone: d.contact_phone ?? null,
          contact_email: d.contact_email ?? null,
          active: true,
        }).select().single()
        if (error) throw error
        await supabase.from('activity_log').insert({
          company_id: companyId,
          actor: 'soteria',
          action: 'add_employee',
          entity_type: 'employee',
          entity_id: data.id,
          summary: `Soteria added employee: ${d.name} (${d.primary_role})`,
        })
        return NextResponse.json({ success: true, data })
      }

      case 'update_employee': {
        const d = action.data as {
          employee_id: string
          updates: {
            name?: string
            primary_role?: string
            qualified_roles?: string[]
            max_weekly_hours?: number
            contact_email?: string | null
            contact_phone?: string | null
            individual_wage?: number | null
            is_veteran?: boolean
            active?: boolean
          }
        }

        const allowed: (keyof typeof d.updates)[] = [
          'name', 'primary_role', 'qualified_roles', 'max_weekly_hours',
          'contact_email', 'contact_phone', 'individual_wage', 'is_veteran', 'active',
        ]
        const updates: Record<string, unknown> = {}
        for (const k of allowed) {
          if (d.updates[k] !== undefined) updates[k] = d.updates[k]
        }

        // ── D16 — primary_role MUST be inside qualified_roles ─────────────────
        //
        // The schedule engine matches candidates on `qualified_roles` (Rule 0b,
        // lib/qualification.ts). `primary_role` only breaks ranking ties. So an
        // employee whose primary_role is NOT in their qualified_roles is, to the
        // engine, **not qualified for their own job** — they will never be
        // scheduled for it, and the gap reason will say "not qualified" about the
        // very role written on their record. Silent, and baffling to a manager.
        //
        // Rather than reject the edit (a manager saying "make Jordan a Headguard"
        // plainly means they can work as one), we heal it: add the role.
        if (updates.primary_role !== undefined) {
          const newPrimary = String(updates.primary_role)

          // The qualified list after this edit: the one being set, or the one on file.
          let qualified: string[] = Array.isArray(updates.qualified_roles)
            ? (updates.qualified_roles as string[])
            : []

          if (!Array.isArray(updates.qualified_roles)) {
            const { data: current } = await supabase
              .from('employees')
              .select('qualified_roles')
              .eq('id', d.employee_id)
              .eq('company_id', companyId)
              .maybeSingle()
            qualified = (current as { qualified_roles: string[] } | null)?.qualified_roles ?? []
          }

          if (!qualified.includes(newPrimary)) {
            updates.qualified_roles = [newPrimary, ...qualified]
          }
        }

        const { data, error } = await supabase
          .from('employees')
          .update(updates)
          .eq('id', d.employee_id)
          .eq('company_id', companyId)
          .select('id, name')
          .single()
        if (error) throw error

        await supabase.from('activity_log').insert({
          company_id: companyId,
          actor: 'soteria',
          action: 'employee_updated',
          entity_type: 'employee',
          entity_id: d.employee_id,
          summary: `Soteria updated ${data?.name ?? 'an employee'}`,
        })
        return NextResponse.json({ success: true, data })
      }

      case 'delete_employee': {
        const d = action.data as { id: string; name: string }

        // ── D15 — delete every row that points at this employee, not just one ──
        //
        // This used to cascade to `availability` ONLY. Everything else that
        // referenced the employee was left behind, pointing at a person who no
        // longer exists:
        //   time_off_requests   — orphaned approved leave. lib/to-window.ts still
        //                         loads it, so a ghost employee could still block
        //                         coverage calculations.
        //   employee_conflicts  — a banned pair with a dead half. The engine reads
        //                         BOTH id columns, so it kept enforcing a rule
        //                         about someone who'd been deleted.
        //   custom_availability — a temporary override with no owner.
        //
        // Deleted in dependency order, employee LAST, so a failure part-way
        // through never leaves the employee gone but their rules still live.
        const { error: availErr } = await supabase
          .from('availability')
          .delete()
          .eq('employee_id', d.id)
          .eq('company_id', companyId)
        throwOnWriteError(availErr, `remove ${d.name}'s availability`)

        const { error: custAvailErr } = await supabase
          .from('custom_availability')
          .delete()
          .eq('employee_id', d.id)
          .eq('company_id', companyId)
        throwOnWriteError(custAvailErr, `remove ${d.name}'s temporary availability`)

        const { error: toErr } = await supabase
          .from('time_off_requests')
          .delete()
          .eq('employee_id', d.id)
          .eq('company_id', companyId)
        throwOnWriteError(toErr, `remove ${d.name}'s time-off requests`)

        // employee_conflicts references the employee in EITHER id column.
        const { error: conflictErr } = await supabase
          .from('employee_conflicts')
          .delete()
          .eq('company_id', companyId)
          .or(`employee_id_1.eq.${d.id},employee_id_2.eq.${d.id}`)
        throwOnWriteError(conflictErr, `remove ${d.name}'s scheduling conflicts`)

        const { error: empErr } = await supabase
          .from('employees')
          .delete()
          .eq('id', d.id)
          .eq('company_id', companyId)
        throwOnWriteError(empErr, `delete employee ${d.name}`)
        await supabase.from('activity_log').insert({
          company_id: companyId,
          actor: 'soteria',
          action: 'delete_employee',
          entity_type: 'employee',
          summary: `Soteria removed employee: ${d.name}`,
        })
        return NextResponse.json({ success: true })
      }

      case 'import_employees': {
        const d = action.data as { employees: RosterRowInput[] }

        // Normalize + de-dupe against the existing team and known roles before
        // writing, so a re-run doesn't duplicate people and role spellings line
        // up with the company's defined roles (the engine matches role by name).
        const [existingEmps, knownRoles] = await Promise.all([
          supabase.from('employees').select('name').eq('company_id', companyId),
          supabase.from('roles').select('name').eq('company_id', companyId),
        ])
        throwOnWriteError(existingEmps.error, 'read the existing team')
        throwOnWriteError(knownRoles.error, 'read the role list')

        const plan = planRosterImport(d.employees ?? [], {
          existingEmployeeNames: (existingEmps.data ?? []).map((e: { name: string }) => e.name),
          knownRoleNames: (knownRoles.data ?? []).map((r: { name: string }) => r.name),
        })

        let importedCount = 0
        if (plan.toInsert.length > 0) {
          const rows = plan.toInsert.map((e) => ({
            company_id: companyId,
            name: e.name,
            primary_role: e.primary_role,
            qualified_roles: e.qualified_roles,
            contact_email: e.contact_email,
            contact_phone: e.contact_phone,
            max_weekly_hours: e.max_weekly_hours,
            is_veteran: e.is_veteran,
            active: true,
          }))
          const { data, error } = await supabase.from('employees').insert(rows).select('id')
          throwOnWriteError(error, 'import the roster')
          importedCount = data?.length ?? 0
        }

        await supabase.from('activity_log').insert({
          company_id: companyId,
          actor: 'soteria',
          action: 'employees_imported',
          entity_type: 'employee',
          summary: `Soteria imported ${importedCount} employee${importedCount === 1 ? '' : 's'}${plan.skipped ? ` (skipped ${plan.skipped})` : ''}`,
          metadata: { imported: importedCount, skipped: plan.skipped, warnings: plan.warnings },
        })
        return NextResponse.json({ success: true, imported: importedCount, skipped: plan.skipped, warnings: plan.warnings })
      }

      case 'update_profile': {
        const existing = await supabase
          .from('company_profiles')
          .select('id')
          .eq('company_id', companyId)
          .maybeSingle()
        throwOnWriteError(existing.error, 'read the company profile')
        if (existing.data) {
          const { error: updErr } = await supabase.from('company_profiles').update({
            ...action.data,
            updated_at: new Date().toISOString(),
          }).eq('company_id', companyId)
          throwOnWriteError(updErr, 'update the company profile')
        } else {
          const { error: insErr } = await supabase.from('company_profiles').insert({
            company_id: companyId,
            ...action.data,
          })
          throwOnWriteError(insErr, 'save the company profile')
        }
        await supabase.from('activity_log').insert({
          company_id: companyId,
          actor: 'soteria',
          action: 'update_profile',
          entity_type: 'company_profile',
          summary: 'Soteria updated the company profile',
        })
        return NextResponse.json({ success: true })
      }

      case 'add_shift_type': {
        const d = action.data as {
          name?: string
          start_time?: string
          end_time?: string
          days_active?: number[]
        }
        const HHMM = /^([01]\d|2[0-3]):[0-5]\d$/
        if (!d.name || typeof d.name !== 'string' || !d.name.trim()) {
          return NextResponse.json(
            { error: 'I need a name for this shift.' },
            { status: 400 },
          )
        }
        if (!d.start_time || !HHMM.test(d.start_time)) {
          return NextResponse.json(
            { error: 'I need a start time in HH:MM format (for example 09:00).' },
            { status: 400 },
          )
        }
        if (!d.end_time || !HHMM.test(d.end_time)) {
          return NextResponse.json(
            { error: 'I need an end time in HH:MM format (for example 17:00).' },
            { status: 400 },
          )
        }
        if (
          !Array.isArray(d.days_active) ||
          d.days_active.length === 0 ||
          !d.days_active.every(n => Number.isInteger(n) && n >= 0 && n <= 6)
        ) {
          return NextResponse.json(
            { error: 'I need to know which days this shift runs (Sunday through Saturday).' },
            { status: 400 },
          )
        }
        const name = d.name.trim()
        const { data, error } = await supabase.from('shift_types').insert({
          company_id: companyId,
          name,
          start_time: d.start_time,
          end_time: d.end_time,
          days_active: d.days_active,
          active: true,
        }).select().single()
        if (error) throw error
        await supabase.from('activity_log').insert({
          company_id: companyId,
          actor: 'soteria',
          action: 'add_shift_type',
          entity_type: 'shift_type',
          entity_id: data.id,
          summary: `Soteria added shift type: ${name}`,
          metadata: { name, start_time: d.start_time, end_time: d.end_time, days_active: d.days_active },
        })
        return NextResponse.json({ success: true, data })
      }

      case 'add_role_requirement': {
        const d = action.data as {
          shift_type_id?: string
          accepted_roles?: string[]
          required_count?: number
        }
        if (!d.shift_type_id || typeof d.shift_type_id !== 'string' || !d.shift_type_id.trim()) {
          return NextResponse.json(
            { error: 'I need to know which shift this role goes inside. Tell me the shift name.' },
            { status: 400 },
          )
        }
        if (
          !Array.isArray(d.accepted_roles) ||
          d.accepted_roles.length === 0 ||
          !d.accepted_roles.every(r => typeof r === 'string' && r.trim().length > 0)
        ) {
          return NextResponse.json(
            { error: 'I need at least one role for this slot. The first role you list is the preferred one; any others are fallbacks.' },
            { status: 400 },
          )
        }
        const cleanedRoles = d.accepted_roles.map(r => r.trim())
        const requiredCount = d.required_count ?? 1
        if (!Number.isInteger(requiredCount) || requiredCount < 1) {
          return NextResponse.json(
            { error: 'The number of people needed for this role must be a whole number of 1 or more.' },
            { status: 400 },
          )
        }

        const { data: st, error: stErr } = await supabase
          .from('shift_types')
          .select('id, name, start_time, end_time, days_active')
          .eq('id', d.shift_type_id)
          .eq('company_id', companyId)
          .maybeSingle()
        if (stErr) throw stErr
        if (!st) {
          const { data: available } = await supabase
            .from('shift_types')
            .select('name')
            .eq('company_id', companyId)
            .order('name')
          const names = (available ?? []).map((s: { name: string }) => s.name).join(', ') || '(none yet)'
          return NextResponse.json(
            { error: `That shift wasn't found in this company. Existing shifts: ${names}.` },
            { status: 400 },
          )
        }
        const stRow = st as { id: string; name: string; start_time: string; end_time: string; days_active: number[] }

        // RULE 0 — a requirement stores ONLY what it owns: which shift it belongs
        // to (`shift_type_id`), which role, and how many. It no longer stamps a
        // COPY of the shift's name/hours/days onto itself. Those copies were
        // invisible to the manager, were never refreshed when the shift changed,
        // and drifted in production (D4). Everything now reads shift_types — the
        // one row the manager actually edits. The copied columns are removed by
        // Drop_Shift_Requirement_Mirrors.sql.
        const { data, error } = await supabase.from('shift_requirements').insert({
          company_id: companyId,
          shift_type_id: d.shift_type_id,
          role: cleanedRoles[0],
          accepted_roles: cleanedRoles,
          required_count: requiredCount,
        }).select().single()
        if (error) throw error

        const stName = stRow.name
        await supabase.from('activity_log').insert({
          company_id: companyId,
          actor: 'soteria',
          action: 'add_role_requirement',
          entity_type: 'shift_requirement',
          entity_id: data.id,
          summary: `Soteria added role requirement: ${requiredCount}× ${cleanedRoles.join(' or ')} to ${stName}`,
          metadata: {
            shift_type_id: d.shift_type_id,
            shift_type_name: stName,
            accepted_roles: cleanedRoles,
            required_count: requiredCount,
          },
        })
        return NextResponse.json({ success: true, data })
      }

      case 'update_shift_type': {
        const d = action.data as {
          id?: string
          name?: string
          start_time?: string
          end_time?: string
          days_active?: number[]
        }
        if (!d.id || typeof d.id !== 'string') {
          return NextResponse.json(
            { error: 'I need to know which shift to update.' },
            { status: 400 },
          )
        }
        const HHMM = /^([01]\d|2[0-3]):[0-5]\d$/
        const updates: Record<string, unknown> = {}
        if (d.name !== undefined) {
          if (typeof d.name !== 'string' || !d.name.trim()) {
            return NextResponse.json({ error: 'The new shift name needs to be non-empty.' }, { status: 400 })
          }
          updates.name = d.name.trim()
        }
        if (d.start_time !== undefined) {
          if (!HHMM.test(d.start_time)) {
            return NextResponse.json({ error: 'Start time must be in HH:MM format (for example 09:00).' }, { status: 400 })
          }
          updates.start_time = d.start_time
        }
        if (d.end_time !== undefined) {
          if (!HHMM.test(d.end_time)) {
            return NextResponse.json({ error: 'End time must be in HH:MM format (for example 17:00).' }, { status: 400 })
          }
          updates.end_time = d.end_time
        }
        if (d.days_active !== undefined) {
          if (
            !Array.isArray(d.days_active) ||
            d.days_active.length === 0 ||
            !d.days_active.every(n => Number.isInteger(n) && n >= 0 && n <= 6)
          ) {
            return NextResponse.json(
              { error: 'I need at least one day of the week (Sunday through Saturday) for this shift.' },
              { status: 400 },
            )
          }
          updates.days_active = d.days_active
        }
        if (Object.keys(updates).length === 0) {
          return NextResponse.json(
            { error: 'Tell me what to change on this shift — name, start time, end time, or days.' },
            { status: 400 },
          )
        }

        const { data: before } = await supabase
          .from('shift_types')
          .select('*')
          .eq('id', d.id)
          .eq('company_id', companyId)
          .maybeSingle()
        if (!before) {
          return NextResponse.json({ error: `That shift wasn't found in this company.` }, { status: 400 })
        }

        const { data, error } = await supabase
          .from('shift_types')
          .update(updates)
          .eq('id', d.id)
          .eq('company_id', companyId)
          .select()
          .single()
        if (error) throw error

        // RULE 0 — NO CASCADE NEEDED, AND NONE WANTED.
        //
        // An earlier fix (D4) cascaded this edit into COPIES of the shift's
        // name/hours/days stored on shift_requirements. That was the right patch
        // for a schema that shouldn't have existed: keeping a hidden duplicate
        // honest is still keeping a hidden duplicate.
        //
        // Those four columns are now gone (Drop_Shift_Requirement_Mirrors.sql).
        // `shift_types` — the row the manager edits in the shift box — is the one
        // and only place a shift's name, hours and days live. Every reader (the
        // Aegis engine and coverage simulator, the schedule builder, the gap
        // resolver, the time-off picker) joins to it. So editing the shift here
        // is, by construction, the whole edit. There is nothing left to sync.
        //
        // If you ever find yourself re-adding a cascade under this line, stop:
        // it means someone re-introduced a copy. Delete the copy instead.
        await supabase.from('activity_log').insert({
          company_id: companyId,
          actor: 'soteria',
          action: 'update_shift_type',
          entity_type: 'shift_type',
          entity_id: d.id,
          summary: `Soteria updated shift type: ${(data as { name: string }).name}`,
          metadata: { before, after: data, changed_fields: Object.keys(updates) },
        })
        return NextResponse.json({ success: true, data })
      }

      case 'update_role_requirement': {
        const d = action.data as {
          id?: string
          accepted_roles?: string[]
          required_count?: number
        }
        if (!d.id || typeof d.id !== 'string') {
          return NextResponse.json(
            { error: 'I need to know which role requirement to update.' },
            { status: 400 },
          )
        }
        const updates: Record<string, unknown> = {}
        if (d.accepted_roles !== undefined) {
          if (
            !Array.isArray(d.accepted_roles) ||
            d.accepted_roles.length === 0 ||
            !d.accepted_roles.every(r => typeof r === 'string' && r.trim().length > 0)
          ) {
            return NextResponse.json(
              { error: 'I need at least one role for this slot. The first role you list is the preferred one; any others are fallbacks.' },
              { status: 400 },
            )
          }
          const cleaned = d.accepted_roles.map(r => r.trim())
          updates.accepted_roles = cleaned
          updates.role = cleaned[0]
        }
        if (d.required_count !== undefined) {
          if (!Number.isInteger(d.required_count) || d.required_count < 1) {
            return NextResponse.json(
              { error: 'The number of people needed for this role must be a whole number of 1 or more.' },
              { status: 400 },
            )
          }
          updates.required_count = d.required_count
        }
        if (Object.keys(updates).length === 0) {
          return NextResponse.json(
            { error: 'Tell me what to change on this role requirement — which roles are accepted, or how many people are needed.' },
            { status: 400 },
          )
        }

        const { data: before } = await supabase
          .from('shift_requirements')
          .select('*')
          .eq('id', d.id)
          .eq('company_id', companyId)
          .maybeSingle()
        if (!before) {
          return NextResponse.json({ error: `That role requirement no longer exists in this company.` }, { status: 400 })
        }

        const { data, error } = await supabase
          .from('shift_requirements')
          .update(updates)
          .eq('id', d.id)
          .eq('company_id', companyId)
          .select()
          .single()
        if (error) throw error

        let stName = '(unknown shift)'
        const beforeRow = before as { shift_type_id: string | null }
        if (beforeRow.shift_type_id) {
          const { data: st } = await supabase
            .from('shift_types')
            .select('name')
            .eq('id', beforeRow.shift_type_id)
            .eq('company_id', companyId)
            .maybeSingle()
          if (st) stName = (st as { name: string }).name
        }
        const afterRow = data as { accepted_roles: string[] | null; role: string | null; required_count: number }
        const rolesText = (afterRow.accepted_roles && afterRow.accepted_roles.length > 0)
          ? afterRow.accepted_roles.join(' or ')
          : (afterRow.role ?? '?')

        await supabase.from('activity_log').insert({
          company_id: companyId,
          actor: 'soteria',
          action: 'update_role_requirement',
          entity_type: 'shift_requirement',
          entity_id: d.id,
          summary: `Soteria updated role requirement on ${stName}: now ${afterRow.required_count}× ${rolesText}`,
          metadata: { before, after: data, changed_fields: Object.keys(updates) },
        })
        return NextResponse.json({ success: true, data })
      }

      case 'delete_shift_type': {
        const d = action.data as { id?: string; name?: string }
        if (!d.id || typeof d.id !== 'string') {
          return NextResponse.json({ error: 'I need to know which shift to delete.' }, { status: 400 })
        }
        if (!d.name || typeof d.name !== 'string') {
          return NextResponse.json({ error: 'I need the shift name to record what was deleted.' }, { status: 400 })
        }
        const { data: existingReqs, error: reqErr } = await supabase
          .from('shift_requirements')
          .select('id')
          .eq('shift_type_id', d.id)
          .eq('company_id', companyId)
        if (reqErr) throw reqErr
        const reqCount = existingReqs?.length ?? 0
        if (reqCount > 0) {
          return NextResponse.json(
            { error: `I can't delete ${d.name} yet — it still has ${reqCount} role requirement${reqCount === 1 ? '' : 's'} inside it. Remove those first.` },
            { status: 400 },
          )
        }
        const { error } = await supabase
          .from('shift_types')
          .delete()
          .eq('id', d.id)
          .eq('company_id', companyId)
        if (error) throw error
        await supabase.from('activity_log').insert({
          company_id: companyId,
          actor: 'soteria',
          action: 'delete_shift_type',
          entity_type: 'shift_type',
          summary: `Soteria deleted shift type: ${d.name}`,
          metadata: { id: d.id, name: d.name },
        })
        return NextResponse.json({ success: true })
      }

      case 'delete_role_requirement': {
        const d = action.data as { id?: string }
        if (!d.id || typeof d.id !== 'string') {
          return NextResponse.json({ error: 'I need to know which role requirement to delete.' }, { status: 400 })
        }
        const { data: before } = await supabase
          .from('shift_requirements')
          .select('id, shift_type_id, accepted_roles, role, required_count')
          .eq('id', d.id)
          .eq('company_id', companyId)
          .maybeSingle()
        if (!before) {
          return NextResponse.json({ error: `That role requirement no longer exists in this company.` }, { status: 400 })
        }
        const beforeRow = before as { id: string; shift_type_id: string | null; accepted_roles: string[] | null; role: string | null; required_count: number }
        let shiftTypeName = '(unknown shift)'
        if (beforeRow.shift_type_id) {
          const { data: st } = await supabase
            .from('shift_types')
            .select('name')
            .eq('id', beforeRow.shift_type_id)
            .eq('company_id', companyId)
            .maybeSingle()
          if (st) shiftTypeName = (st as { name: string }).name
        }
        const rolesText = (beforeRow.accepted_roles && beforeRow.accepted_roles.length > 0)
          ? beforeRow.accepted_roles.join(' or ')
          : (beforeRow.role ?? '?')

        const { error } = await supabase
          .from('shift_requirements')
          .delete()
          .eq('id', d.id)
          .eq('company_id', companyId)
        if (error) throw error

        await supabase.from('activity_log').insert({
          company_id: companyId,
          actor: 'soteria',
          action: 'delete_role_requirement',
          entity_type: 'shift_requirement',
          summary: `Soteria removed role requirement: ${beforeRow.required_count}× ${rolesText} from ${shiftTypeName}`,
          metadata: { id: d.id, shift_type_id: beforeRow.shift_type_id, shift_type_name: shiftTypeName, accepted_roles: beforeRow.accepted_roles, required_count: beforeRow.required_count },
        })
        return NextResponse.json({ success: true })
      }

      case 'update_policy': {
        const d = action.data as {
          policy_key: string
          policy_value: string
          policy_value_json?: unknown
          policy_type?: string
          description?: string | null
        }

        const existing = await supabase
          .from('policies')
          .select('id, version, policy_value, policy_value_json')
          .eq('company_id', companyId)
          .eq('policy_key', d.policy_key)
          .maybeSingle()

        const humanKey = d.policy_key.replace(/_/g, ' ')
        const hasJson = Object.prototype.hasOwnProperty.call(action.data, 'policy_value_json')

        // Guard: never leave a structured rule's engine-read json stale (item 3 fix).
        if (isStaleStructuredWrite(d.policy_key, hasJson)) {
          return NextResponse.json({
            success: false,
            error: `Couldn't change "${humanKey}" — the scheduling engine reads its structured value (policy_value_json), and this update only changed the display text. Re-issue the change with the structured value so the engine actually picks it up.`,
          }, { status: 422 })
        }

        let entityId: string
        let beforeJson: unknown = null
        let beforeValue: string | null = null

        if (existing.data) {
          const row = existing.data as { id: string; version?: number; policy_value: string; policy_value_json: unknown }
          beforeJson = row.policy_value_json
          beforeValue = row.policy_value
          const updates: Record<string, unknown> = {
            policy_value: d.policy_value,
            version: (row.version ?? 1) + 1,
          }
          if (hasJson) updates.policy_value_json = d.policy_value_json ?? null
          if (d.description !== undefined) updates.description = d.description
          if (d.policy_type !== undefined) updates.policy_type = d.policy_type

          const { error: upErr } = await supabase
            .from('policies')
            .update(updates)
            .eq('id', row.id)
            .eq('company_id', companyId)
          if (upErr) throw upErr
          entityId = row.id
        } else {
          const { data: inserted, error: insErr } = await supabase
            .from('policies')
            .insert({
              company_id: companyId,
              policy_key: d.policy_key,
              policy_value: d.policy_value,
              policy_value_json: hasJson ? (d.policy_value_json ?? null) : null,
              policy_type: d.policy_type ?? 'custom',
              description: d.description ?? null,
              version: 1,
            })
            .select('id')
            .single()
          if (insErr) throw insErr
          entityId = (inserted as { id: string }).id
        }

        const summary = existing.data
          ? `Soteria changed ${humanKey} from ${beforeValue ?? '(unset)'} to ${d.policy_value}`
          : `Soteria set ${humanKey} to ${d.policy_value}`

        await supabase.from('activity_log').insert({
          company_id: companyId,
          actor: 'soteria',
          action: 'update_policy',
          entity_type: 'policy',
          entity_id: entityId,
          summary,
          metadata: {
            policy_key: d.policy_key,
            before: { policy_value: beforeValue, policy_value_json: beforeJson },
            after: { policy_value: d.policy_value, policy_value_json: hasJson ? (d.policy_value_json ?? null) : beforeJson },
          },
        })
        return NextResponse.json({ success: true })
      }

      case 'add_conflict': {
        const d = action.data as {
          employee_id_1: string
          employee_id_2: string
          reason?: string | null
          severity?: string
        }
        const ALLOWED_SEVERITIES = ['avoid', 'never'] as const
        const severity = d.severity ?? 'avoid'
        if (!ALLOWED_SEVERITIES.includes(severity as typeof ALLOWED_SEVERITIES[number])) {
          return NextResponse.json(
            { error: `Severity must be either "avoid" or "never".` },
            { status: 400 },
          )
        }
        const { data, error } = await supabase.from('employee_conflicts').insert({
          company_id: companyId,
          employee_id_1: d.employee_id_1,
          employee_id_2: d.employee_id_2,
          reason: d.reason ?? null,
          severity,
        }).select().single()
        if (error) throw error

        const { data: empPair } = await supabase
          .from('employees')
          .select('id, name')
          .eq('company_id', companyId)
          .in('id', [d.employee_id_1, d.employee_id_2])
        const nameById = new Map<string, string>(
          ((empPair ?? []) as { id: string; name: string }[]).map(e => [e.id, e.name])
        )
        const name1 = nameById.get(d.employee_id_1) ?? 'an employee'
        const name2 = nameById.get(d.employee_id_2) ?? 'an employee'

        await supabase.from('activity_log').insert({
          company_id: companyId,
          actor: 'soteria',
          action: 'add_conflict',
          entity_type: 'employee_conflict',
          entity_id: data.id,
          summary: `Soteria added ${severity} conflict between ${name1} and ${name2}`,
          metadata: { employee_id_1: d.employee_id_1, employee_id_2: d.employee_id_2, severity, reason: d.reason ?? null },
        })
        return NextResponse.json({ success: true, data })
      }

      case 'delete_policy': {
        const d = action.data as { id: string; policy_key: string }
        const { error: delErr } = await supabase.from('policies').delete().eq('id', d.id).eq('company_id', companyId)
        throwOnWriteError(delErr, `delete policy ${d.policy_key}`)
        await supabase.from('activity_log').insert({
          company_id: companyId,
          actor: 'soteria',
          action: 'delete_policy',
          entity_type: 'policy',
          summary: `Soteria removed policy: ${d.policy_key}`,
        })
        return NextResponse.json({ success: true })
      }

      case 'batch_create_time_off': {
        const d = action.data as {
          requests: {
            employee_id: string
            employee_name: string
            start_date: string
            end_date: string
            time_off_type: 'full_day' | 'partial'
            reason?: string | null
            partial_days?: {
              date: string
              type: 'shift_off' | 'custom_hours'
              shift_id?: string | null
              shift_name?: string | null
              start_time?: string | null
              end_time?: string | null
            }[] | null
          }[]
        }

        const nowIso = new Date().toISOString()
        const rows = (d.requests ?? []).map((r) => ({
          company_id: companyId,
          employee_id: r.employee_id,
          start_date: r.start_date,
          end_date: r.end_date,
          reason: r.reason ?? 'personal',
          status: 'pending',
          time_off_type: r.time_off_type,
          partial_days: r.partial_days ?? null,
          requested_at: nowIso,
        }))

        const { error } = await supabase.from('time_off_requests').insert(rows)
        if (error) throw error

        const names = (d.requests ?? []).map((r) => r.employee_name).join(', ')
        const count = rows.length
        await supabase.from('activity_log').insert({
          company_id: companyId,
          actor: 'soteria',
          action: 'time_off_batch_created',
          entity_type: 'time_off_request',
          summary: `Soteria logged time-off requests for ${count} employee${count === 1 ? '' : 's'}: ${names}`,
        })

        return NextResponse.json({ success: true, created: count })
      }

      case 'update_availability': {
        const d = action.data as {
          employee_id: string
          employee_name: string
          slots: { day_of_week: number; start_time: string; end_time: string }[]
          replace_all: boolean
        }

        const { data: emp, error: empErr } = await supabase
          .from('employees')
          .select('id')
          .eq('id', d.employee_id)
          .eq('company_id', companyId)
          .maybeSingle()
        if (empErr) throw empErr
        if (!emp) {
          return NextResponse.json(
            { error: `${d.employee_name || 'That employee'} wasn't found in this company.` },
            { status: 404 }
          )
        }

        let slotsToInsert = d.slots ?? []

        if (d.replace_all) {
          const { error: delErr } = await supabase
            .from('availability')
            .delete()
            .eq('employee_id', d.employee_id)
            .eq('company_id', companyId)
          throwOnWriteError(delErr, `clear ${d.employee_name}'s existing availability`)
        } else {
          const { data: existing } = await supabase
            .from('availability')
            .select('day_of_week')
            .eq('employee_id', d.employee_id)
            .eq('company_id', companyId)
          const covered = new Set(
            (existing ?? []).map((r: { day_of_week: number }) => r.day_of_week)
          )
          slotsToInsert = slotsToInsert.filter((s) => !covered.has(s.day_of_week))
        }

        if (slotsToInsert.length > 0) {
          const { error: insErr } = await supabase.from('availability').insert(
            slotsToInsert.map((s) => ({
              company_id: companyId,
              employee_id: d.employee_id,
              day_of_week: s.day_of_week,
              start_time: s.start_time,
              end_time: s.end_time,
            }))
          )
          if (insErr) throw insErr
        }

        const dayCount = slotsToInsert.length
        await supabase.from('activity_log').insert({
          company_id: companyId,
          actor: 'soteria',
          action: 'availability_updated',
          entity_type: 'availability',
          entity_id: d.employee_id,
          summary: `Soteria updated availability for ${d.employee_name}: ${dayCount} day${dayCount === 1 ? '' : 's'} set`,
        })

        return NextResponse.json({ success: true })
      }

      case 'set_custom_availability': {
        const d = action.data as {
          employee_id: string
          employee_name: string
          type: 'date_limited' | 'rotating'
          end_date: string
          patterns?: { day_of_week: number; start_time: string; end_time: string }[]
          cycle_weeks?: number
          cycle_start_date?: string
          weekly_patterns?: {
            week: number
            days: { day_of_week: number; start_time: string; end_time: string }[]
          }[]
        }

        const { error: deactivateErr } = await supabase
          .from('custom_availability')
          .update({ active: false })
          .eq('employee_id', d.employee_id)
          .eq('company_id', companyId)
        throwOnWriteError(deactivateErr, `clear ${d.employee_name}'s previous custom availability`)

        const patterns =
          d.type === 'date_limited' ? (d.patterns ?? []) : (d.weekly_patterns ?? [])

        const { error: insErr } = await supabase.from('custom_availability').insert({
          company_id: companyId,
          employee_id: d.employee_id,
          type: d.type,
          end_date: d.end_date,
          cycle_weeks: d.type === 'rotating' ? (d.cycle_weeks ?? null) : null,
          cycle_start_date: d.type === 'rotating' ? (d.cycle_start_date ?? null) : null,
          patterns,
          active: true,
        })
        if (insErr) throw insErr

        await supabase.from('activity_log').insert({
          company_id: companyId,
          actor: 'soteria',
          action: 'custom_availability_set',
          entity_type: 'custom_availability',
          entity_id: d.employee_id,
          summary: `Soteria set custom availability for ${d.employee_name} (${d.type}, until ${d.end_date})`,
        })

        return NextResponse.json({ success: true })
      }

      case 'trigger_schedule_build': {
        const d = action.data as {
          target_week: 'this' | 'next'
          veteran_preference?: string
        }

        const targetWeek: 'this' | 'next' = d.target_week === 'this' ? 'this' : 'next'

        // Use the SAME Bearer-auth'd internal endpoint the Homebase "Build" button uses.
        // The previous implementation FABRICATED an SMS to Aegis's /webhooks/sms using a
        // manager employee's phone number. That required an `employees` row with
        // primary_role='Manager' AND a phone on file (managers are `users`, so this often
        // didn't exist → hard 400), and it depended on the SMS webhook — which is inert in
        // email-only mode and returns 200 regardless, so the build could even report
        // SUCCESS while doing nothing. Net effect: the manager confirmed the action card
        // and the build silently never happened. This is the real, proven path.
        try {
          const result = await postToAegisInternal<{
            ok: boolean
            schedule_id?: string
            week_start?: string
            week_end?: string
            total_filled?: number
            total_required?: number
            gaps?: number
            reason?: string
            error?: string
          }>('/internal/build-schedule', {
            company_id: companyId,
            target_week: targetWeek,
            ...(d.veteran_preference ? { veteran_preference: d.veteran_preference } : {}),
          })

          if (!result.ok) {
            const msg = result.reason === 'no_shift_types'
              ? "There aren't any active shift types set up yet — add shift types and role requirements under Scheduling, then I can build."
              : `I couldn't save the build: ${result.error ?? 'unknown error'}.`
            await supabase.from('activity_log').insert({
              company_id: companyId,
              actor: 'soteria',
              action: 'schedule_build_failed',
              entity_type: 'schedule',
              summary: `Soteria's ${targetWeek}-week schedule build failed: ${result.reason ?? result.error ?? 'unknown'}`,
              metadata: { target_week: targetWeek },
            })
            return NextResponse.json({ error: msg }, { status: 422 })
          }

          await supabase.from('activity_log').insert({
            company_id: companyId,
            actor: 'soteria',
            action: 'schedule_build_triggered',
            entity_type: 'schedule',
            entity_id: result.schedule_id ?? null,
            summary: `Soteria built the ${targetWeek}-week schedule (${result.total_filled ?? 0}/${result.total_required ?? 0} slots filled, ${result.gaps ?? 0} gaps)`,
            metadata: {
              target_week: targetWeek,
              veteran_preference: d.veteran_preference ?? null,
              schedule_id: result.schedule_id ?? null,
              gaps: result.gaps ?? null,
            },
          })

          return NextResponse.json({
            success: true,
            target_week: targetWeek,
            schedule_id: result.schedule_id,
            week_start: result.week_start,
            week_end: result.week_end,
            total_filled: result.total_filled,
            total_required: result.total_required,
            gaps: result.gaps,
          })
        } catch (err) {
          const detail = err instanceof AegisInternalConfigError || err instanceof AegisInternalError
            ? err.message
            : err instanceof Error ? err.message : 'unknown error'
          await supabase.from('activity_log').insert({
            company_id: companyId,
            actor: 'soteria',
            action: 'schedule_build_failed',
            entity_type: 'schedule',
            summary: `Soteria's ${targetWeek}-week schedule build failed: ${detail}`,
            metadata: { target_week: targetWeek },
          })
          return NextResponse.json(
            { error: `I couldn't reach the scheduling engine: ${detail}` },
            { status: 502 }
          )
        }
      }

      // ── D7 — ask Aegis to SEND THE SCHEDULE TO THE TEAM ────────────────────
      //
      // This is the highest-consequence action Soteria can take: it emails EVERY
      // employee at the company (~30 at Watermark). It is deliberately a thin
      // pass-through to the SAME Aegis endpoint the Homebase "Distribute" button
      // already uses — no second implementation, no fabricated message, no
      // separate idea of what "distributed" means.
      //
      // Note the framing throughout: Soteria ASKS AEGIS. She does not send it
      // herself, and the copy she returns says so. Aegis is the one who talks to
      // employees; if Soteria quietly absorbs that, the manager stops using him
      // and the product loses its point (see soteria/capabilities.ts).
      //
      // Re-send protection lives in Aegis (`already_distributed`), so an
      // accidental second confirm cannot spam 30 people — Soteria reports back
      // that it was already sent and does nothing.
      case 'distribute_schedule': {
        const d = action.data as { schedule_id?: string; force?: boolean }
        if (!d.schedule_id || typeof d.schedule_id !== 'string') {
          return NextResponse.json(
            { error: "I need to know which schedule to send out. Build or publish one first, then tell me to send it." },
            { status: 400 },
          )
        }

        // Never take the LLM's word for which company a schedule belongs to.
        const { data: schedRow, error: schedErr } = await supabase
          .from('schedules')
          .select('id, company_id, status, week_start, week_end')
          .eq('id', d.schedule_id)
          .eq('company_id', companyId)
          .is('deleted_at', null)
          .maybeSingle()
        if (schedErr) throw schedErr
        if (!schedRow) {
          return NextResponse.json(
            { error: "I couldn't find that schedule in this company." },
            { status: 400 },
          )
        }
        const sched = schedRow as { id: string; status: string; week_start: string; week_end: string }

        try {
          const result = await postToAegisInternal<{
            ok: boolean
            sent?: number
            total_employees?: number
            errors?: unknown[]
            already_distributed?: boolean
            distributed_at?: string | null
          }>('/internal/distribute-schedule', {
            schedule_id: sched.id,
            ...(d.force === true ? { force: true } : {}),
          })

          if (result.already_distributed) {
            await supabase.from('activity_log').insert({
              company_id: companyId,
              actor: 'soteria',
              action: 'schedule_distribute_skipped',
              entity_type: 'schedule',
              entity_id: sched.id,
              summary: `Soteria asked Aegis to send the ${sched.week_start} schedule — already sent, so nothing was re-sent.`,
              metadata: { schedule_id: sched.id, distributed_at: result.distributed_at ?? null },
            })
            return NextResponse.json({
              success: true,
              already_distributed: true,
              distributed_at: result.distributed_at ?? null,
              message: 'That week has already gone out to the team, so Aegis left it alone. Tell me if you want him to deliberately re-send it.',
            })
          }

          await supabase.from('activity_log').insert({
            company_id: companyId,
            actor: 'soteria',
            action: 'schedule_distributed',
            entity_type: 'schedule',
            entity_id: sched.id,
            summary: `Soteria asked Aegis to send the ${sched.week_start} schedule to the team (${result.sent ?? 0}/${result.total_employees ?? 0} reached)`,
            metadata: {
              schedule_id: sched.id,
              sent: result.sent ?? 0,
              total_employees: result.total_employees ?? 0,
              forced: d.force === true,
            },
          })

          return NextResponse.json({
            success: true,
            schedule_id: sched.id,
            sent: result.sent ?? 0,
            total_employees: result.total_employees ?? 0,
            errors: result.errors ?? [],
          })
        } catch (err) {
          const detail = err instanceof AegisInternalConfigError || err instanceof AegisInternalError
            ? err.message
            : err instanceof Error ? err.message : 'unknown error'
          await supabase.from('activity_log').insert({
            company_id: companyId,
            actor: 'soteria',
            action: 'schedule_distribute_failed',
            entity_type: 'schedule',
            entity_id: sched.id,
            summary: `Soteria's request to Aegis to send the ${sched.week_start} schedule failed: ${detail}`,
            metadata: { schedule_id: sched.id },
          })
          // No orphan outputs: say it did NOT go out.
          return NextResponse.json(
            { error: `I couldn't get that to Aegis, so nothing was sent to the team: ${detail}` },
            { status: 502 },
          )
        }
      }


      case 'add_role': {
        const d = action.data as { name?: string; color?: string }
        const HEX = /^#[0-9A-Fa-f]{6}$/
        if (!d.name || typeof d.name !== 'string' || !d.name.trim()) {
          return NextResponse.json({ error: 'I need a name for this role.' }, { status: 400 })
        }
        const name = d.name.trim()
        let color = '#6b7280'
        if (d.color !== undefined && d.color !== null && d.color !== '') {
          if (typeof d.color !== 'string' || !HEX.test(d.color)) {
            return NextResponse.json({ error: 'Color must be a hex value like #10b981.' }, { status: 400 })
          }
          color = d.color
        }

        const { data: existing } = await supabase
          .from('roles')
          .select('id, name')
          .eq('company_id', companyId)
        const dup = (existing ?? []).find(
          (r: { name: string }) => r.name.toLowerCase() === name.toLowerCase(),
        )
        if (dup) {
          return NextResponse.json(
            { error: `A role named "${(dup as { name: string }).name}" already exists. Pick a different name or update the existing role.` },
            { status: 400 },
          )
        }

        const { data, error } = await supabase.from('roles').insert({
          company_id: companyId,
          name,
          color,
        }).select().single()
        if (error) throw error

        await supabase.from('activity_log').insert({
          company_id: companyId,
          actor: 'soteria',
          action: 'add_role',
          entity_type: 'role',
          entity_id: data.id,
          summary: `Soteria added role: ${name}`,
          metadata: { name, color },
        })
        return NextResponse.json({ success: true, data })
      }

      case 'update_role': {
        const d = action.data as { id?: string; name?: string; color?: string }
        const HEX = /^#[0-9A-Fa-f]{6}$/
        if (!d.id || typeof d.id !== 'string') {
          return NextResponse.json({ error: 'I need to know which role to update.' }, { status: 400 })
        }
        const updates: Record<string, unknown> = {}
        if (d.name !== undefined) {
          if (typeof d.name !== 'string' || !d.name.trim()) {
            return NextResponse.json({ error: 'The new role name needs to be non-empty.' }, { status: 400 })
          }
          updates.name = d.name.trim()
        }
        if (d.color !== undefined) {
          if (typeof d.color !== 'string' || !HEX.test(d.color)) {
            return NextResponse.json({ error: 'Color must be a hex value like #10b981.' }, { status: 400 })
          }
          updates.color = d.color
        }
        if (Object.keys(updates).length === 0) {
          return NextResponse.json(
            { error: 'Tell me what to change on this role — name or color.' },
            { status: 400 },
          )
        }

        const { data: before } = await supabase
          .from('roles')
          .select('id, name, color')
          .eq('id', d.id)
          .eq('company_id', companyId)
          .maybeSingle()
        if (!before) {
          return NextResponse.json({ error: `That role wasn't found in this company.` }, { status: 400 })
        }
        const beforeRow = before as { id: string; name: string; color: string }

        if (updates.name && (updates.name as string).toLowerCase() !== beforeRow.name.toLowerCase()) {
          const { data: others } = await supabase
            .from('roles')
            .select('id, name')
            .eq('company_id', companyId)
            .neq('id', d.id)
          const dup = (others ?? []).find(
            (r: { name: string }) => r.name.toLowerCase() === (updates.name as string).toLowerCase(),
          )
          if (dup) {
            return NextResponse.json(
              { error: `A role named "${(dup as { name: string }).name}" already exists. Pick a different name.` },
              { status: 400 },
            )
          }
        }

        const { data, error } = await supabase
          .from('roles')
          .update(updates)
          .eq('id', d.id)
          .eq('company_id', companyId)
          .select()
          .single()
        if (error) throw error
        const afterRow = data as { name: string; color: string }

        const cascadeCounts = {
          employees_primary_role: 0,
          employees_qualified_roles: 0,
          shift_req_accepted_roles: 0,
          shift_req_role_legacy: 0,
          // D5 — these two were MISSING. A role is a free-text string matched by
          // exact equality across five tables; the rename only updated three of
          // them, so renaming "Lifeguard" → "Guard" silently orphaned the
          // Lifeguard wage rate (wages fall back to nothing) and every veteran /
          // experience rule scoped to that role (they simply stop applying).
          // Nothing errors. The schedule just quietly gets worse.
          wage_rates: 0,
          shift_experience_rules: 0,
        }

        if (updates.name && beforeRow.name !== afterRow.name) {
          const oldName = beforeRow.name
          const newName = afterRow.name

          // 1. employees.primary_role — direct UPDATE WHERE
          const { data: empPrimary, error: errEP } = await supabase
            .from('employees')
            .update({ primary_role: newName })
            .eq('company_id', companyId)
            .eq('primary_role', oldName)
            .select('id')
          if (errEP) throw errEP
          cascadeCounts.employees_primary_role = empPrimary?.length ?? 0

          // 2. employees.qualified_roles — fetch + modify + per-row update
          const { data: empsWithRole, error: errEQ } = await supabase
            .from('employees')
            .select('id, qualified_roles')
            .eq('company_id', companyId)
            .contains('qualified_roles', [oldName])
          if (errEQ) throw errEQ
          for (const emp of (empsWithRole ?? []) as { id: string; qualified_roles: string[] }[]) {
            const newRoles = emp.qualified_roles.map(r => r === oldName ? newName : r)
            const { error: errU } = await supabase
              .from('employees')
              .update({ qualified_roles: newRoles })
              .eq('id', emp.id)
              .eq('company_id', companyId)
            if (errU) throw errU
            cascadeCounts.employees_qualified_roles++
          }

          // 3. shift_requirements.accepted_roles — fetch + modify + per-row update
          const { data: reqsWithRole, error: errSA } = await supabase
            .from('shift_requirements')
            .select('id, accepted_roles')
            .eq('company_id', companyId)
            .contains('accepted_roles', [oldName])
          if (errSA) throw errSA
          for (const req of (reqsWithRole ?? []) as { id: string; accepted_roles: string[] }[]) {
            const newAccepted = req.accepted_roles.map(r => r === oldName ? newName : r)
            const { error: errU } = await supabase
              .from('shift_requirements')
              .update({ accepted_roles: newAccepted })
              .eq('id', req.id)
              .eq('company_id', companyId)
            if (errU) throw errU
            cascadeCounts.shift_req_accepted_roles++
          }

          // 4. shift_requirements.role — direct UPDATE WHERE.
          // NOTE: despite the old "legacy column" label, `role` is the column the
          // schedule ENGINE actually matches on (eligibility compares
          // employees.qualified_roles against slot.role). `accepted_roles` above
          // is the one nothing reads yet (Role Groups unbuilt — drift D10).
          // Getting this backwards would break every build, so: role is load-bearing.
          const { data: reqLegacy, error: errSL } = await supabase
            .from('shift_requirements')
            .update({ role: newName })
            .eq('company_id', companyId)
            .eq('role', oldName)
            .select('id')
          if (errSL) throw errSL
          cascadeCounts.shift_req_role_legacy = reqLegacy?.length ?? 0

          // 5. D5 — wage_rates.role. Missed by the original cascade. A rename
          // orphaned the role's pay rate: wages then fall back to
          // employees.individual_wage or nothing at all, silently changing every
          // cost estimate. Read by Aegis lib/schedule-simulator.ts.
          const { data: wageRows, error: errWR } = await supabase
            .from('wage_rates')
            .update({ role: newName })
            .eq('company_id', companyId)
            .eq('role', oldName)
            .select('id')
          if (errWR) throw errWR
          cascadeCounts.wage_rates = wageRows?.length ?? 0

          // 6. D5 — shift_experience_rules.role. Also missed. These are the
          // veteran / experience staffing rules ("Saturday nights must be all
          // veterans"). Scoped by role string; after a rename they match nothing
          // and stop being enforced — with no error and no gap flagged.
          // Read by Aegis lib/engine/experience-rules.ts.
          const { data: expRows, error: errXR } = await supabase
            .from('shift_experience_rules')
            .update({ role: newName })
            .eq('company_id', companyId)
            .eq('role', oldName)
            .select('id')
          if (errXR) throw errXR
          cascadeCounts.shift_experience_rules = expRows?.length ?? 0
        }

        const totalCascade =
          cascadeCounts.employees_primary_role +
          cascadeCounts.employees_qualified_roles +
          cascadeCounts.shift_req_accepted_roles +
          cascadeCounts.shift_req_role_legacy +
          cascadeCounts.wage_rates +
          cascadeCounts.shift_experience_rules
        const renameSummary = updates.name
          ? (beforeRow.name === afterRow.name
              ? `Soteria updated role: ${afterRow.name}`
              : `Soteria renamed role: ${beforeRow.name} → ${afterRow.name}${totalCascade > 0 ? ` (updated ${totalCascade} reference${totalCascade === 1 ? '' : 's'})` : ''}`)
          : `Soteria updated role: ${afterRow.name}`

        await supabase.from('activity_log').insert({
          company_id: companyId,
          actor: 'soteria',
          action: 'update_role',
          entity_type: 'role',
          entity_id: d.id,
          summary: renameSummary,
          metadata: { before: beforeRow, after: afterRow, changed_fields: Object.keys(updates), cascade: cascadeCounts },
        })
        return NextResponse.json({ success: true, data })
      }

      case 'delete_role': {
        const d = action.data as { id?: string; name?: string }
        if (!d.id || typeof d.id !== 'string') {
          return NextResponse.json({ error: 'I need to know which role to delete.' }, { status: 400 })
        }
        if (!d.name || typeof d.name !== 'string') {
          return NextResponse.json({ error: 'I need the role name to record what was deleted.' }, { status: 400 })
        }
        const name = d.name

        const [
          { data: empsByPrimary, error: errEP },
          { data: empsByQualified, error: errEQ },
          { data: reqsByLegacy, error: errSL },
          { data: reqsByAccepted, error: errSA },
          // D5 — these two references were never checked, so a role could be
          // deleted out from under its own wage rate and its veteran rules,
          // leaving both pointing at a role that no longer exists.
          { data: wageRefs, error: errWR },
          { data: expRefs, error: errXR },
        ] = await Promise.all([
          supabase
            .from('employees')
            .select('id, name')
            .eq('company_id', companyId)
            .eq('active', true)
            .eq('primary_role', name),
          supabase
            .from('employees')
            .select('id, name')
            .eq('company_id', companyId)
            .eq('active', true)
            .contains('qualified_roles', [name]),
          supabase
            .from('shift_requirements')
            .select('id')
            .eq('company_id', companyId)
            .eq('role', name),
          supabase
            .from('shift_requirements')
            .select('id')
            .eq('company_id', companyId)
            .contains('accepted_roles', [name]),
          supabase
            .from('wage_rates')
            .select('id')
            .eq('company_id', companyId)
            .eq('role', name),
          supabase
            .from('shift_experience_rules')
            .select('id')
            .eq('company_id', companyId)
            .eq('role', name),
        ])
        if (errEP || errEQ || errSL || errSA || errWR || errXR) {
          throw errEP ?? errEQ ?? errSL ?? errSA ?? errWR ?? errXR
        }

        // Dedupe employees across the two checks
        const empMap = new Map<string, string>()
        for (const e of [...(empsByPrimary ?? []), ...(empsByQualified ?? [])] as { id: string; name: string }[]) {
          empMap.set(e.id, e.name)
        }
        const empNames = Array.from(empMap.values())

        // Combine requirement counts (dedupe by id)
        const reqIds = new Set<string>()
        for (const r of [...(reqsByLegacy ?? []), ...(reqsByAccepted ?? [])] as { id: string }[]) {
          reqIds.add(r.id)
        }
        const reqCount = reqIds.size
        const wageCount = (wageRefs ?? []).length
        const expCount = (expRefs ?? []).length

        if (empNames.length > 0 || reqCount > 0 || wageCount > 0 || expCount > 0) {
          const parts: string[] = []
          if (empNames.length > 0) {
            const sample = empNames.slice(0, 3).join(', ')
            const more = empNames.length > 3 ? ` and ${empNames.length - 3} more` : ''
            parts.push(`${empNames.length} employee${empNames.length === 1 ? ' is' : 's are'} assigned to ${name} (${sample}${more})`)
          }
          if (reqCount > 0) {
            parts.push(`${reqCount} shift role requirement${reqCount === 1 ? '' : 's'} still accept${reqCount === 1 ? 's' : ''} the ${name} role`)
          }
          if (wageCount > 0) {
            parts.push(`${wageCount} wage rate${wageCount === 1 ? ' is' : 's are'} still set for ${name}`)
          }
          if (expCount > 0) {
            parts.push(`${expCount} veteran/experience rule${expCount === 1 ? ' is' : 's are'} still scoped to ${name}`)
          }
          return NextResponse.json(
            { error: `I can't delete ${name} yet — ${parts.join(', and ')}. Update those first.` },
            { status: 400 },
          )
        }

        const { error } = await supabase
          .from('roles')
          .delete()
          .eq('id', d.id)
          .eq('company_id', companyId)
        if (error) throw error

        await supabase.from('activity_log').insert({
          company_id: companyId,
          actor: 'soteria',
          action: 'delete_role',
          entity_type: 'role',
          summary: `Soteria deleted role: ${name}`,
          metadata: { id: d.id, name },
        })
        return NextResponse.json({ success: true })
      }

      case 'add_wage_rate': {
        const d = action.data as { role?: string; hourly_rate?: number; rate?: number }
        if (!d.role || typeof d.role !== 'string' || !d.role.trim()) {
          return NextResponse.json({ error: 'I need to know which role this wage is for.' }, { status: 400 })
        }
        const rate = typeof d.hourly_rate === 'number' ? d.hourly_rate : d.rate
        if (typeof rate !== 'number' || !isFinite(rate) || rate <= 0) {
          return NextResponse.json({ error: 'The hourly rate must be a positive number.' }, { status: 400 })
        }
        const roleInput = d.role.trim()

        const { data: roles } = await supabase
          .from('roles')
          .select('name')
          .eq('company_id', companyId)
        const matched = (roles ?? []).find(
          (r: { name: string }) => r.name.toLowerCase() === roleInput.toLowerCase(),
        )
        if (!matched) {
          const names = (roles ?? []).map((r: { name: string }) => r.name).join(', ') || '(none defined yet)'
          return NextResponse.json(
            { error: `I don't see a "${roleInput}" role in this company. Existing roles: ${names}. Add the role first, then set its wage.` },
            { status: 400 },
          )
        }
        const roleName = (matched as { name: string }).name

        const { data: existingRates } = await supabase
          .from('wage_rates')
          .select('id, role')
          .eq('company_id', companyId)
        const dup = (existingRates ?? []).find(
          (w: { role: string }) => w.role.toLowerCase() === roleName.toLowerCase(),
        )
        if (dup) {
          return NextResponse.json(
            { error: `A wage rate for ${roleName} already exists. Update it instead of adding a new one.` },
            { status: 400 },
          )
        }

        const { data, error } = await supabase.from('wage_rates').insert({
          company_id: companyId,
          role: roleName,
          hourly_rate: rate,
        }).select().single()
        if (error) throw error

        await supabase.from('activity_log').insert({
          company_id: companyId,
          actor: 'soteria',
          action: 'add_wage_rate',
          entity_type: 'wage_rate',
          entity_id: data.id,
          summary: `Soteria set ${roleName} wage to $${rate.toFixed(2)}/hr`,
          metadata: { role: roleName, hourly_rate: rate },
        })
        return NextResponse.json({ success: true, data })
      }

      case 'update_wage_rate': {
        const d = action.data as { id?: string; hourly_rate?: number; rate?: number }
        if (!d.id || typeof d.id !== 'string') {
          return NextResponse.json({ error: 'I need to know which wage rate to update.' }, { status: 400 })
        }
        const rate = typeof d.hourly_rate === 'number' ? d.hourly_rate : d.rate
        if (typeof rate !== 'number' || !isFinite(rate) || rate <= 0) {
          return NextResponse.json({ error: 'The hourly rate must be a positive number.' }, { status: 400 })
        }

        const { data: before } = await supabase
          .from('wage_rates')
          .select('id, role, hourly_rate')
          .eq('id', d.id)
          .eq('company_id', companyId)
          .maybeSingle()
        if (!before) {
          return NextResponse.json({ error: `That wage rate wasn't found in this company.` }, { status: 400 })
        }
        const beforeRow = before as { id: string; role: string; hourly_rate: number }

        const { data, error } = await supabase
          .from('wage_rates')
          .update({ hourly_rate: rate })
          .eq('id', d.id)
          .eq('company_id', companyId)
          .select()
          .single()
        if (error) throw error

        await supabase.from('activity_log').insert({
          company_id: companyId,
          actor: 'soteria',
          action: 'update_wage_rate',
          entity_type: 'wage_rate',
          entity_id: d.id,
          summary: `Soteria changed ${beforeRow.role} wage from $${Number(beforeRow.hourly_rate).toFixed(2)} to $${rate.toFixed(2)}/hr`,
          metadata: { role: beforeRow.role, before: beforeRow.hourly_rate, after: rate },
        })
        return NextResponse.json({ success: true, data })
      }

      case 'delete_wage_rate': {
        const d = action.data as { id?: string }
        if (!d.id || typeof d.id !== 'string') {
          return NextResponse.json({ error: 'I need to know which wage rate to delete.' }, { status: 400 })
        }
        const { data: before } = await supabase
          .from('wage_rates')
          .select('id, role, hourly_rate')
          .eq('id', d.id)
          .eq('company_id', companyId)
          .maybeSingle()
        if (!before) {
          return NextResponse.json({ error: `That wage rate wasn't found in this company.` }, { status: 400 })
        }
        const beforeRow = before as { id: string; role: string; hourly_rate: number }

        const { error } = await supabase
          .from('wage_rates')
          .delete()
          .eq('id', d.id)
          .eq('company_id', companyId)
        if (error) throw error

        await supabase.from('activity_log').insert({
          company_id: companyId,
          actor: 'soteria',
          action: 'delete_wage_rate',
          entity_type: 'wage_rate',
          summary: `Soteria removed wage rate for ${beforeRow.role}`,
          metadata: { id: d.id, role: beforeRow.role, hourly_rate: beforeRow.hourly_rate },
        })
        return NextResponse.json({ success: true })
      }

      case 'add_event': {
        const d = action.data as {
          event_type?: string
          title?: string
          date?: string
          description?: string | null
          notes?: string | null
          event_shifts?: unknown
        }
        const ALLOWED_EVENT_TYPES = ['holiday', 'special_event', 'party', 'fundraiser', 'closure', 'custom'] as const
        const DATE_RE = /^\d{4}-\d{2}-\d{2}$/

        if (!d.event_type || !ALLOWED_EVENT_TYPES.includes(d.event_type as typeof ALLOWED_EVENT_TYPES[number])) {
          return NextResponse.json(
            { error: `Event type must be one of: ${ALLOWED_EVENT_TYPES.join(', ')}.` },
            { status: 400 },
          )
        }
        if (!d.title || typeof d.title !== 'string' || !d.title.trim()) {
          return NextResponse.json({ error: 'I need a title for this event.' }, { status: 400 })
        }
        if (!d.date || typeof d.date !== 'string' || !DATE_RE.test(d.date)) {
          return NextResponse.json({ error: 'I need a date in YYYY-MM-DD format (for example 2026-07-04).' }, { status: 400 })
        }
        const title = d.title.trim()
        const notes = d.notes?.toString().trim() || null
        const description = d.description ? (d.description.toString().trim() || null) : null

        const eventShifts = sanitizeEventShifts(d.event_shifts)

        const { data, error } = await supabase.from('events').insert({
          company_id: companyId,
          title,
          date: d.date,
          event_type: d.event_type,
          description,
          staffing_notes: notes,
          event_shifts: eventShifts,
          created_by: 'soteria',
        }).select().single()
        if (error) throw error

        await supabase.from('activity_log').insert({
          company_id: companyId,
          actor: 'soteria',
          action: 'add_event',
          entity_type: 'event',
          entity_id: data.id,
          summary: `Soteria added ${d.event_type}: ${title} on ${formatEventDate(d.date)}`,
          metadata: { event_type: d.event_type, title, date: d.date, description, notes },
        })
        return NextResponse.json({ success: true, data })
      }

      case 'update_event': {
        const d = action.data as {
          id?: string
          event_type?: string
          title?: string
          date?: string
          description?: string | null
          notes?: string | null
          event_shifts?: unknown
        }
        const ALLOWED_EVENT_TYPES = ['holiday', 'special_event', 'party', 'fundraiser', 'closure', 'custom'] as const
        const DATE_RE = /^\d{4}-\d{2}-\d{2}$/

        if (!d.id || typeof d.id !== 'string') {
          return NextResponse.json({ error: 'I need to know which event to update.' }, { status: 400 })
        }
        const updates: Record<string, unknown> = {}
        if (d.event_type !== undefined) {
          if (!ALLOWED_EVENT_TYPES.includes(d.event_type as typeof ALLOWED_EVENT_TYPES[number])) {
            return NextResponse.json(
              { error: `Event type must be one of: ${ALLOWED_EVENT_TYPES.join(', ')}.` },
              { status: 400 },
            )
          }
          updates.event_type = d.event_type
        }
        if (d.title !== undefined) {
          if (typeof d.title !== 'string' || !d.title.trim()) {
            return NextResponse.json({ error: 'The new event title needs to be non-empty.' }, { status: 400 })
          }
          updates.title = d.title.trim()
        }
        if (d.date !== undefined) {
          if (typeof d.date !== 'string' || !DATE_RE.test(d.date)) {
            return NextResponse.json({ error: 'Date must be in YYYY-MM-DD format (for example 2026-07-04).' }, { status: 400 })
          }
          updates.date = d.date
        }
        if (d.notes !== undefined) {
          updates.staffing_notes = d.notes === null ? null : d.notes.toString().trim() || null
        }
        if (d.description !== undefined) {
          updates.description = d.description === null ? null : d.description.toString().trim() || null
        }
        if (d.event_shifts !== undefined) {
          // null / empty clears the event's staffing exceptions back to "none".
          updates.event_shifts = d.event_shifts === null ? null : sanitizeEventShifts(d.event_shifts)
        }
        if (Object.keys(updates).length === 0) {
          return NextResponse.json(
            { error: 'Tell me what to change on this event — type, title, date, description, or notes.' },
            { status: 400 },
          )
        }
        updates.updated_at = new Date().toISOString()

        const { data: before } = await supabase
          .from('events')
          .select('id, event_type, title, date, staffing_notes')
          .eq('id', d.id)
          .eq('company_id', companyId)
          .maybeSingle()
        if (!before) {
          return NextResponse.json({ error: `That event wasn't found in this company.` }, { status: 400 })
        }
        const beforeRow = before as { id: string; event_type: string; title: string; date: string | null; staffing_notes: string | null }

        const { data, error } = await supabase
          .from('events')
          .update(updates)
          .eq('id', d.id)
          .eq('company_id', companyId)
          .select()
          .single()
        if (error) throw error
        const afterRow = data as { event_type: string; title: string; date: string | null }

        let summary: string
        if (updates.title && beforeRow.title !== afterRow.title) {
          summary = `Soteria updated event: ${beforeRow.title} → ${afterRow.title} (${formatEventDate(afterRow.date)})`
        } else {
          summary = `Soteria updated event: ${afterRow.title} (${formatEventDate(afterRow.date)})`
        }

        await supabase.from('activity_log').insert({
          company_id: companyId,
          actor: 'soteria',
          action: 'update_event',
          entity_type: 'event',
          entity_id: d.id,
          summary,
          metadata: { before: beforeRow, after: data, changed_fields: Object.keys(updates) },
        })
        return NextResponse.json({ success: true, data })
      }

      case 'delete_event': {
        const d = action.data as { id?: string }
        if (!d.id || typeof d.id !== 'string') {
          return NextResponse.json({ error: 'I need to know which event to delete.' }, { status: 400 })
        }
        const { data: before } = await supabase
          .from('events')
          .select('id, title, event_type, date')
          .eq('id', d.id)
          .eq('company_id', companyId)
          .maybeSingle()
        if (!before) {
          return NextResponse.json({ error: `That event wasn't found in this company.` }, { status: 400 })
        }
        const beforeRow = before as { id: string; title: string; event_type: string; date: string | null }

        const { error } = await supabase
          .from('events')
          .delete()
          .eq('id', d.id)
          .eq('company_id', companyId)
        if (error) throw error

        await supabase.from('activity_log').insert({
          company_id: companyId,
          actor: 'soteria',
          action: 'delete_event',
          entity_type: 'event',
          summary: `Soteria removed event: ${beforeRow.title}`,
          metadata: { id: d.id, title: beforeRow.title, event_type: beforeRow.event_type, date: beforeRow.date },
        })
        return NextResponse.json({ success: true })
      }

      case 'add_shift_experience_rule': {
        const d = action.data as {
          shift_type_id?: string | null
          days_of_week?: number[] | null
          role?: string | null
          mode?: string
          min_count?: number | null
          season_start?: string | null
          season_end?: string | null
        }
        const DATE_RE = /^\d{4}-\d{2}-\d{2}$/
        if (d.mode !== 'all_veterans' && d.mode !== 'min_veterans') {
          return NextResponse.json({ error: "Mode must be 'all_veterans' or 'min_veterans'." }, { status: 400 })
        }
        if (d.mode === 'min_veterans' && (typeof d.min_count !== 'number' || d.min_count < 1)) {
          return NextResponse.json({ error: 'For a minimum-veterans rule I need a min_count of at least 1.' }, { status: 400 })
        }
        for (const k of ['season_start', 'season_end'] as const) {
          const v = d[k]
          if (v != null && (typeof v !== 'string' || !DATE_RE.test(v))) {
            return NextResponse.json({ error: `${k} must be a date in YYYY-MM-DD format.` }, { status: 400 })
          }
        }
        const days = Array.isArray(d.days_of_week)
          ? d.days_of_week.filter(n => Number.isInteger(n) && n >= 0 && n <= 6)
          : null
        const { data, error } = await supabase.from('shift_experience_rules').insert({
          company_id: companyId,
          shift_type_id: d.shift_type_id ?? null,
          days_of_week: days && days.length ? days : null,
          role: d.role?.toString().trim() || null,
          mode: d.mode,
          min_count: d.mode === 'min_veterans' ? d.min_count : null,
          season_start: d.season_start ?? null,
          season_end: d.season_end ?? null,
          created_by: 'soteria',
        }).select().single()
        if (error) throw error
        await supabase.from('activity_log').insert({
          company_id: companyId,
          actor: 'soteria',
          action: 'add_shift_experience_rule',
          entity_type: 'shift_experience_rule',
          entity_id: data.id,
          summary: `Soteria added a veteran staffing rule (${d.mode === 'min_veterans' ? `min ${d.min_count}` : 'all veterans'})`,
          metadata: { ...d },
        })
        return NextResponse.json({ success: true, data })
      }

      case 'update_shift_experience_rule': {
        const d = action.data as { id?: string; mode?: string; min_count?: number | null; active?: boolean } & Record<string, unknown>
        if (!d.id || typeof d.id !== 'string') {
          return NextResponse.json({ error: 'I need the id of the rule to update.' }, { status: 400 })
        }
        const patch: Record<string, unknown> = {}
        if ('shift_type_id' in d) patch.shift_type_id = d.shift_type_id ?? null
        if ('days_of_week' in d) {
          patch.days_of_week = Array.isArray(d.days_of_week)
            ? (d.days_of_week as number[]).filter(n => Number.isInteger(n) && n >= 0 && n <= 6)
            : null
        }
        if ('role' in d) patch.role = (d.role as string | null)?.toString().trim() || null
        if ('mode' in d) {
          if (d.mode !== 'all_veterans' && d.mode !== 'min_veterans') {
            return NextResponse.json({ error: "Mode must be 'all_veterans' or 'min_veterans'." }, { status: 400 })
          }
          patch.mode = d.mode
        }
        if ('min_count' in d) patch.min_count = d.min_count ?? null
        if ('season_start' in d) patch.season_start = d.season_start ?? null
        if ('season_end' in d) patch.season_end = d.season_end ?? null
        if ('active' in d) patch.active = !!d.active
        const { data, error } = await supabase
          .from('shift_experience_rules')
          .update(patch)
          .eq('id', d.id)
          .eq('company_id', companyId)
          .select()
          .single()
        if (error) throw error
        await supabase.from('activity_log').insert({
          company_id: companyId,
          actor: 'soteria',
          action: 'update_shift_experience_rule',
          entity_type: 'shift_experience_rule',
          entity_id: d.id,
          summary: 'Soteria updated a veteran staffing rule',
          metadata: { ...d },
        })
        return NextResponse.json({ success: true, data })
      }

      case 'delete_shift_experience_rule': {
        const d = action.data as { id?: string }
        if (!d.id || typeof d.id !== 'string') {
          return NextResponse.json({ error: 'I need the id of the rule to remove.' }, { status: 400 })
        }
        const { error } = await supabase
          .from('shift_experience_rules')
          .delete()
          .eq('id', d.id)
          .eq('company_id', companyId)
        if (error) throw error
        await supabase.from('activity_log').insert({
          company_id: companyId,
          actor: 'soteria',
          action: 'delete_shift_experience_rule',
          entity_type: 'shift_experience_rule',
          entity_id: d.id,
          summary: 'Soteria removed a veteran staffing rule',
          metadata: { id: d.id },
        })
        return NextResponse.json({ success: true })
      }

      case 'update_conflict': {
        const d = action.data as { id?: string; severity?: string; reason?: string | null }
        const ALLOWED_SEVERITIES = ['avoid', 'never'] as const
        if (!d.id || typeof d.id !== 'string') {
          return NextResponse.json({ error: 'I need to know which conflict to update.' }, { status: 400 })
        }
        const updates: Record<string, unknown> = {}
        if (d.severity !== undefined) {
          if (!ALLOWED_SEVERITIES.includes(d.severity as typeof ALLOWED_SEVERITIES[number])) {
            return NextResponse.json({ error: `Severity must be either "avoid" or "never".` }, { status: 400 })
          }
          updates.severity = d.severity
        }
        if (d.reason !== undefined) {
          updates.reason = d.reason === null ? null : String(d.reason).trim() || null
        }
        if (Object.keys(updates).length === 0) {
          return NextResponse.json(
            { error: 'Tell me what to change on this conflict — severity or reason.' },
            { status: 400 },
          )
        }

        const { data: before } = await supabase
          .from('employee_conflicts')
          .select('id, employee_id_1, employee_id_2, severity, reason')
          .eq('id', d.id)
          .eq('company_id', companyId)
          .maybeSingle()
        if (!before) {
          return NextResponse.json({ error: `That conflict wasn't found in this company.` }, { status: 400 })
        }
        const beforeRow = before as { id: string; employee_id_1: string; employee_id_2: string; severity: string; reason: string | null }

        const { data: empPair } = await supabase
          .from('employees')
          .select('id, name')
          .eq('company_id', companyId)
          .in('id', [beforeRow.employee_id_1, beforeRow.employee_id_2])
        const nameById = new Map<string, string>(
          ((empPair ?? []) as { id: string; name: string }[]).map(e => [e.id, e.name])
        )
        const name1 = nameById.get(beforeRow.employee_id_1) ?? 'an employee'
        const name2 = nameById.get(beforeRow.employee_id_2) ?? 'an employee'

        const { data, error } = await supabase
          .from('employee_conflicts')
          .update(updates)
          .eq('id', d.id)
          .eq('company_id', companyId)
          .select()
          .single()
        if (error) throw error

        await supabase.from('activity_log').insert({
          company_id: companyId,
          actor: 'soteria',
          action: 'update_conflict',
          entity_type: 'employee_conflict',
          entity_id: d.id,
          summary: `Soteria updated conflict between ${name1} and ${name2}`,
          metadata: { before: beforeRow, after: data, changed_fields: Object.keys(updates) },
        })
        return NextResponse.json({ success: true, data })
      }

      case 'delete_conflict': {
        const d = action.data as { id?: string }
        if (!d.id || typeof d.id !== 'string') {
          return NextResponse.json({ error: 'I need to know which conflict to delete.' }, { status: 400 })
        }
        const { data: before } = await supabase
          .from('employee_conflicts')
          .select('id, employee_id_1, employee_id_2, severity, reason')
          .eq('id', d.id)
          .eq('company_id', companyId)
          .maybeSingle()
        if (!before) {
          return NextResponse.json({ error: `That conflict wasn't found in this company.` }, { status: 400 })
        }
        const beforeRow = before as { id: string; employee_id_1: string; employee_id_2: string; severity: string; reason: string | null }

        const { data: empPair } = await supabase
          .from('employees')
          .select('id, name')
          .eq('company_id', companyId)
          .in('id', [beforeRow.employee_id_1, beforeRow.employee_id_2])
        const nameById = new Map<string, string>(
          ((empPair ?? []) as { id: string; name: string }[]).map(e => [e.id, e.name])
        )
        const name1 = nameById.get(beforeRow.employee_id_1) ?? 'an employee'
        const name2 = nameById.get(beforeRow.employee_id_2) ?? 'an employee'

        const { error } = await supabase
          .from('employee_conflicts')
          .delete()
          .eq('id', d.id)
          .eq('company_id', companyId)
        if (error) throw error

        await supabase.from('activity_log').insert({
          company_id: companyId,
          actor: 'soteria',
          action: 'delete_conflict',
          entity_type: 'employee_conflict',
          summary: `Soteria removed conflict between ${name1} and ${name2}`,
          metadata: { id: d.id, employee_id_1: beforeRow.employee_id_1, employee_id_2: beforeRow.employee_id_2, severity: beforeRow.severity, reason: beforeRow.reason },
        })
        return NextResponse.json({ success: true })
      }

      case 'clear_custom_availability': {
        const d = action.data as { employee_id?: string; employee_name?: string }
        if (!d.employee_id || typeof d.employee_id !== 'string') {
          return NextResponse.json({ error: 'I need to know which employee to clear.' }, { status: 400 })
        }
        if (!d.employee_name || typeof d.employee_name !== 'string') {
          return NextResponse.json({ error: 'I need the employee name for the activity log.' }, { status: 400 })
        }
        const employeeName = d.employee_name

        const { data: emp } = await supabase
          .from('employees')
          .select('id')
          .eq('id', d.employee_id)
          .eq('company_id', companyId)
          .maybeSingle()
        if (!emp) {
          return NextResponse.json(
            { error: `${employeeName} wasn't found in this company.` },
            { status: 404 },
          )
        }

        const { data: activeRows } = await supabase
          .from('custom_availability')
          .select('id')
          .eq('employee_id', d.employee_id)
          .eq('company_id', companyId)
          .eq('active', true)
          .order('created_at', { ascending: false })
          .limit(1)
        const activeRow = (activeRows ?? [])[0] as { id: string } | undefined
        if (!activeRow) {
          return NextResponse.json(
            { error: `${employeeName} doesn't have an active custom availability override.` },
            { status: 400 },
          )
        }

        const { error } = await supabase
          .from('custom_availability')
          .update({ active: false })
          .eq('id', activeRow.id)
          .eq('company_id', companyId)
        if (error) throw error

        await supabase.from('activity_log').insert({
          company_id: companyId,
          actor: 'soteria',
          action: 'custom_availability_removed',
          entity_type: 'custom_availability',
          entity_id: d.employee_id,
          summary: `Soteria cleared custom availability for ${employeeName}`,
          metadata: { employee_id: d.employee_id, cleared_row_id: activeRow.id },
        })
        return NextResponse.json({ success: true })
      }

      case 'apply_setup_plan': {
        // Pillar 2: configure Homebase from a document in one reviewed step.
        // The planner (pure, tested) orders + validates the extracted bundle;
        // here we apply each step in dependency order, threading created IDs.
        const d = action.data as { bundle?: ConfigBundle }
        const bundle = d?.bundle
        if (!bundle || typeof bundle !== 'object') {
          return NextResponse.json({ error: 'I need a setup plan to apply.' }, { status: 400 })
        }

        const [rolesRes, shiftTypesRes, wagesRes, policiesRes] = await Promise.all([
          supabase.from('roles').select('id, name').eq('company_id', companyId),
          supabase.from('shift_types').select('id, name, start_time, end_time, days_active').eq('company_id', companyId),
          supabase.from('wage_rates').select('role').eq('company_id', companyId),
          supabase.from('policies').select('id, policy_key, version').eq('company_id', companyId),
        ])
        throwOnWriteError(rolesRes.error, 'read existing roles')
        throwOnWriteError(shiftTypesRes.error, 'read existing shifts')
        throwOnWriteError(wagesRes.error, 'read existing wage rates')
        throwOnWriteError(policiesRes.error, 'read existing rules')

        const existing: ExistingConfig = {
          roleNames: (rolesRes.data ?? []).map((r: { name: string }) => r.name),
          shiftTypeNames: (shiftTypesRes.data ?? []).map((s: { name: string }) => s.name),
          wageRoleNames: (wagesRes.data ?? []).map((w: { role: string }) => w.role),
          policyKeys: (policiesRes.data ?? []).map((p: { policy_key: string }) => p.policy_key),
        }

        const plan = planConfiguration(bundle, existing)

        type STRow = { id: string; name: string; start_time: string; end_time: string; days_active: number[] }
        const shiftTypeByName = new Map<string, STRow>()
        for (const s of (shiftTypesRes.data ?? []) as STRow[]) shiftTypeByName.set(s.name.trim().toLowerCase(), s)
        const policyByKey = new Map<string, { id: string; version?: number }>()
        for (const p of (policiesRes.data ?? []) as { id: string; policy_key: string; version?: number }[]) {
          policyByKey.set(p.policy_key.trim().toLowerCase(), { id: p.id, version: p.version })
        }

        const applied = { profile: 0, roles: 0, wage_rates: 0, shift_types: 0, role_requirements: 0, policies: 0, veteran_rules: 0 }

        for (const step of plan.steps) {
          if (step.kind === 'profile') {
            const existingProfile = await supabase.from('company_profiles').select('id').eq('company_id', companyId).maybeSingle()
            throwOnWriteError(existingProfile.error, 'read the company profile')
            if (existingProfile.data) {
              const { error } = await supabase.from('company_profiles').update({ ...step.data, updated_at: new Date().toISOString() }).eq('company_id', companyId)
              throwOnWriteError(error, 'update the company profile')
            } else {
              const { error } = await supabase.from('company_profiles').insert({ company_id: companyId, ...step.data })
              throwOnWriteError(error, 'save the company profile')
            }
            applied.profile++
          } else if (step.kind === 'role') {
            const { error } = await supabase.from('roles').insert({ company_id: companyId, name: step.data.name, color: step.data.color ?? '#6b7280' })
            throwOnWriteError(error, `add role ${step.data.name}`)
            applied.roles++
          } else if (step.kind === 'wage_rate') {
            const { error } = await supabase.from('wage_rates').insert({ company_id: companyId, role: step.data.role, hourly_rate: step.data.hourly_rate })
            throwOnWriteError(error, `set the ${step.data.role} wage`)
            applied.wage_rates++
          } else if (step.kind === 'shift_type') {
            const { data: stRow, error } = await supabase.from('shift_types').insert({
              company_id: companyId,
              name: step.data.name,
              start_time: step.data.start_time,
              end_time: step.data.end_time,
              days_active: step.data.days_active,
              active: true,
            }).select('id, name, start_time, end_time, days_active').single()
            throwOnWriteError(error, `add shift ${step.data.name}`)
            const created = stRow as STRow
            shiftTypeByName.set(created.name.trim().toLowerCase(), created)
            applied.shift_types++
            for (const req of step.requirements) {
              // RULE 0 — the requirement stores only what it owns (which shift,
              // which role, how many). The shift's name/hours/days live once, on
              // shift_types. No copies. See Drop_Shift_Requirement_Mirrors.sql.
              const { error: reqErr } = await supabase.from('shift_requirements').insert({
                company_id: companyId,
                shift_type_id: created.id,
                role: req.accepted_roles[0],
                accepted_roles: req.accepted_roles,
                required_count: req.required_count,
              })
              throwOnWriteError(reqErr, `add a role slot to ${created.name}`)
              applied.role_requirements++
            }
          } else if (step.kind === 'policy') {
            const key = step.data.policy_key
            const prior = policyByKey.get(key.trim().toLowerCase())
            const hasJson = Object.prototype.hasOwnProperty.call(step.data, 'policy_value_json')
            // Skip (don't half-write) a structured rule missing its engine-read json.
            if (isStaleStructuredWrite(key, hasJson)) {
              plan.warnings.push(`Skipped rule "${key.replace(/_/g, ' ')}" — it needs a structured value (policy_value_json) for the engine to enforce it, which wasn't provided.`)
              continue
            }
            if (prior) {
              const updates: Record<string, unknown> = { policy_value: step.data.policy_value, version: (prior.version ?? 1) + 1 }
              if (hasJson) updates.policy_value_json = step.data.policy_value_json ?? null
              if (step.data.policy_type !== undefined) updates.policy_type = step.data.policy_type
              if (step.data.description !== undefined) updates.description = step.data.description
              const { error } = await supabase.from('policies').update(updates).eq('id', prior.id).eq('company_id', companyId)
              throwOnWriteError(error, `update rule ${key}`)
            } else {
              const { data: ins, error } = await supabase.from('policies').insert({
                company_id: companyId,
                policy_key: key,
                policy_value: step.data.policy_value,
                policy_value_json: hasJson ? (step.data.policy_value_json ?? null) : null,
                policy_type: step.data.policy_type ?? 'custom',
                description: step.data.description ?? null,
                version: 1,
              }).select('id').single()
              throwOnWriteError(error, `save rule ${key}`)
              policyByKey.set(key.trim().toLowerCase(), { id: (ins as { id: string }).id, version: 1 })
            }
            applied.policies++
          } else if (step.kind === 'veteran_rule') {
            let shiftTypeId: string | null = null
            if (step.data.shift_name) {
              const row = shiftTypeByName.get(step.data.shift_name.trim().toLowerCase())
              if (!row) {
                plan.warnings.push(`Couldn't attach a veteran rule to "${step.data.shift_name}" — that shift wasn't found.`)
                continue
              }
              shiftTypeId = row.id
            }
            const { error } = await supabase.from('shift_experience_rules').insert({
              company_id: companyId,
              shift_type_id: shiftTypeId,
              days_of_week: step.data.days_of_week,
              role: step.data.role,
              mode: step.data.mode,
              min_count: step.data.mode === 'min_veterans' ? step.data.min_count : null,
              season_start: step.data.season_start,
              season_end: step.data.season_end,
              created_by: 'soteria',
            })
            throwOnWriteError(error, 'add a veteran staffing rule')
            applied.veteran_rules++
          }
        }

        await supabase.from('activity_log').insert({
          company_id: companyId,
          actor: 'soteria',
          action: 'apply_setup_plan',
          entity_type: 'company',
          summary: `Soteria configured from a document — ${summarizePlan(plan)}`,
          metadata: { applied, warnings: plan.warnings },
        })

        return NextResponse.json({ success: true, applied, warnings: plan.warnings, summary: summarizePlan(plan) })
      }

      case 'import_schedule_structure': {
        // Pillar 2: read an existing schedule and set up the shift structure it
        // implies. Inference (pure, tested) → the same ingestion planner →
        // apply only the role + shift-type steps it produces.
        const d = action.data as { rows?: ScheduleRowInput[] }
        if (!Array.isArray(d?.rows) || d.rows.length === 0) {
          return NextResponse.json({ error: 'I need the schedule rows to read the structure from.' }, { status: 400 })
        }

        const inference = inferShiftStructureFromSchedule(d.rows)

        const [rolesRes, shiftTypesRes] = await Promise.all([
          supabase.from('roles').select('name').eq('company_id', companyId),
          supabase.from('shift_types').select('name').eq('company_id', companyId),
        ])
        throwOnWriteError(rolesRes.error, 'read existing roles')
        throwOnWriteError(shiftTypesRes.error, 'read existing shifts')

        const existing: ExistingConfig = {
          roleNames: (rolesRes.data ?? []).map((r: { name: string }) => r.name),
          shiftTypeNames: (shiftTypesRes.data ?? []).map((s: { name: string }) => s.name),
          wageRoleNames: [],
          policyKeys: [],
        }

        const plan = planConfiguration(inference.bundle, existing)
        const applied = { roles: 0, shift_types: 0, role_requirements: 0 }

        for (const step of plan.steps) {
          if (step.kind === 'role') {
            const { error } = await supabase.from('roles').insert({ company_id: companyId, name: step.data.name, color: step.data.color ?? '#6b7280' })
            throwOnWriteError(error, `add role ${step.data.name}`)
            applied.roles++
          } else if (step.kind === 'shift_type') {
            const { data: stRow, error } = await supabase.from('shift_types').insert({
              company_id: companyId,
              name: step.data.name,
              start_time: step.data.start_time,
              end_time: step.data.end_time,
              days_active: step.data.days_active,
              active: true,
            }).select('id, name, start_time, end_time, days_active').single()
            throwOnWriteError(error, `add shift ${step.data.name}`)
            const created = stRow as { id: string; name: string; start_time: string; end_time: string; days_active: number[] }
            applied.shift_types++
            for (const req of step.requirements) {
              // RULE 0 — the requirement stores only what it owns (which shift,
              // which role, how many). The shift's name/hours/days live once, on
              // shift_types. No copies. See Drop_Shift_Requirement_Mirrors.sql.
              const { error: reqErr } = await supabase.from('shift_requirements').insert({
                company_id: companyId,
                shift_type_id: created.id,
                role: req.accepted_roles[0],
                accepted_roles: req.accepted_roles,
                required_count: req.required_count,
              })
              throwOnWriteError(reqErr, `add a role slot to ${created.name}`)
              applied.role_requirements++
            }
          }
        }

        const warnings = [...inference.warnings, ...plan.warnings]
        await supabase.from('activity_log').insert({
          company_id: companyId,
          actor: 'soteria',
          action: 'import_schedule_structure',
          entity_type: 'company',
          summary: `Soteria set up ${applied.shift_types} shift${applied.shift_types === 1 ? '' : 's'} and ${applied.roles} role${applied.roles === 1 ? '' : 's'} from an existing schedule`,
          metadata: { applied, warnings },
        })

        return NextResponse.json({ success: true, applied, warnings })
      }

      default:
        return NextResponse.json({ error: "I don't know how to do that action yet." }, { status: 400 })
    }

  } catch (error) {
    console.error('Soteria execute error:', error)
    return NextResponse.json(
      { error: "Something went wrong saving that change. Please try again, or rephrase what you need." },
      { status: 500 },
    )
  }
}
