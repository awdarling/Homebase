import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'
import { createClient as createServerSupabase } from '@/lib/supabase/server'

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
)

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
      .select('company_id')
      .eq('id', user.id)
      .single()
    if (!userRow || (userRow as { company_id: string }).company_id !== companyId) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
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
        await supabase.from('availability').delete().eq('employee_id', d.id)
        await supabase.from('employees').delete().eq('id', d.id).eq('company_id', companyId)
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
        const d = action.data as {
          employees: {
            name: string
            primary_role: string
            qualified_roles?: string[]
            contact_email?: string | null
            contact_phone?: string | null
            max_weekly_hours?: number
            is_veteran?: boolean
          }[]
        }

        const rows = (d.employees ?? []).map((e) => ({
          company_id: companyId,
          name: e.name,
          primary_role: e.primary_role,
          qualified_roles: e.qualified_roles?.length ? e.qualified_roles : [e.primary_role],
          contact_email: e.contact_email ?? null,
          contact_phone: e.contact_phone ?? null,
          max_weekly_hours: e.max_weekly_hours ?? 40,
          is_veteran: e.is_veteran ?? false,
          active: true,
        }))

        const { data, error } = await supabase
          .from('employees')
          .insert(rows)
          .select('id')
        if (error) throw error

        const importedCount = data?.length ?? 0
        await supabase.from('activity_log').insert({
          company_id: companyId,
          actor: 'soteria',
          action: 'employees_imported',
          entity_type: 'employee',
          summary: `Soteria imported ${importedCount} employee${importedCount === 1 ? '' : 's'}`,
        })
        return NextResponse.json({ success: true, imported: importedCount })
      }

      case 'update_profile': {
        const existing = await supabase
          .from('company_profiles')
          .select('id')
          .eq('company_id', companyId)
          .maybeSingle()
        if (existing.data) {
          await supabase.from('company_profiles').update({
            ...action.data,
            updated_at: new Date().toISOString(),
          }).eq('company_id', companyId)
        } else {
          await supabase.from('company_profiles').insert({
            company_id: companyId,
            ...action.data,
          })
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
            { error: 'name is required and must be a non-empty string.' },
            { status: 400 },
          )
        }
        if (!d.start_time || !HHMM.test(d.start_time)) {
          return NextResponse.json(
            { error: 'start_time is required and must be HH:MM (24-hour, e.g. 09:00).' },
            { status: 400 },
          )
        }
        if (!d.end_time || !HHMM.test(d.end_time)) {
          return NextResponse.json(
            { error: 'end_time is required and must be HH:MM (24-hour, e.g. 17:00).' },
            { status: 400 },
          )
        }
        if (
          !Array.isArray(d.days_active) ||
          d.days_active.length === 0 ||
          !d.days_active.every(n => Number.isInteger(n) && n >= 0 && n <= 6)
        ) {
          return NextResponse.json(
            { error: 'days_active is required and must be a non-empty array of integers 0–6 (0=Sunday, 6=Saturday).' },
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
            { error: 'shift_type_id is required.' },
            { status: 400 },
          )
        }
        if (
          !Array.isArray(d.accepted_roles) ||
          d.accepted_roles.length === 0 ||
          !d.accepted_roles.every(r => typeof r === 'string' && r.trim().length > 0)
        ) {
          return NextResponse.json(
            { error: 'accepted_roles is required and must be a non-empty array of non-empty role names. The first entry is the preferred role; later entries are fallbacks.' },
            { status: 400 },
          )
        }
        const cleanedRoles = d.accepted_roles.map(r => r.trim())
        const requiredCount = d.required_count ?? 1
        if (!Number.isInteger(requiredCount) || requiredCount < 1) {
          return NextResponse.json(
            { error: 'required_count must be a positive integer (defaults to 1 if omitted).' },
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
          const names = (available ?? []).map((s: { name: string }) => s.name).join(', ') || '(none)'
          return NextResponse.json(
            { error: `Shift type ${d.shift_type_id} not found in this company. Available shift types: ${names}.` },
            { status: 400 },
          )
        }
        const stRow = st as { id: string; name: string; start_time: string; end_time: string; days_active: number[] }

        const { data, error } = await supabase.from('shift_requirements').insert({
          company_id: companyId,
          shift_type_id: d.shift_type_id,
          role: cleanedRoles[0],
          accepted_roles: cleanedRoles,
          required_count: requiredCount,
          shift_name: stRow.name,
          start_time: stRow.start_time,
          end_time: stRow.end_time,
          days_active: stRow.days_active,
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
            { error: 'id is required.' },
            { status: 400 },
          )
        }
        const HHMM = /^([01]\d|2[0-3]):[0-5]\d$/
        const updates: Record<string, unknown> = {}
        if (d.name !== undefined) {
          if (typeof d.name !== 'string' || !d.name.trim()) {
            return NextResponse.json({ error: 'name must be a non-empty string when provided.' }, { status: 400 })
          }
          updates.name = d.name.trim()
        }
        if (d.start_time !== undefined) {
          if (!HHMM.test(d.start_time)) {
            return NextResponse.json({ error: 'start_time must be HH:MM (24-hour).' }, { status: 400 })
          }
          updates.start_time = d.start_time
        }
        if (d.end_time !== undefined) {
          if (!HHMM.test(d.end_time)) {
            return NextResponse.json({ error: 'end_time must be HH:MM (24-hour).' }, { status: 400 })
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
              { error: 'days_active must be a non-empty array of integers 0–6 when provided.' },
              { status: 400 },
            )
          }
          updates.days_active = d.days_active
        }
        if (Object.keys(updates).length === 0) {
          return NextResponse.json(
            { error: 'At least one of name, start_time, end_time, days_active must be provided.' },
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
          return NextResponse.json({ error: `Shift type ${d.id} not found in this company.` }, { status: 400 })
        }

        const { data, error } = await supabase
          .from('shift_types')
          .update(updates)
          .eq('id', d.id)
          .eq('company_id', companyId)
          .select()
          .single()
        if (error) throw error

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
            { error: 'id is required.' },
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
              { error: 'accepted_roles must be a non-empty array of non-empty role names when provided.' },
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
              { error: 'required_count must be a positive integer when provided.' },
              { status: 400 },
            )
          }
          updates.required_count = d.required_count
        }
        if (Object.keys(updates).length === 0) {
          return NextResponse.json(
            { error: 'At least one of accepted_roles, required_count must be provided.' },
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
          return NextResponse.json({ error: `Role requirement ${d.id} not found in this company.` }, { status: 400 })
        }

        const { data, error } = await supabase
          .from('shift_requirements')
          .update(updates)
          .eq('id', d.id)
          .eq('company_id', companyId)
          .select()
          .single()
        if (error) throw error

        await supabase.from('activity_log').insert({
          company_id: companyId,
          actor: 'soteria',
          action: 'update_role_requirement',
          entity_type: 'shift_requirement',
          entity_id: d.id,
          summary: `Soteria updated role requirement ${d.id}`,
          metadata: { before, after: data, changed_fields: Object.keys(updates) },
        })
        return NextResponse.json({ success: true, data })
      }

      case 'delete_shift_type': {
        const d = action.data as { id?: string; name?: string }
        if (!d.id || typeof d.id !== 'string') {
          return NextResponse.json({ error: 'id is required.' }, { status: 400 })
        }
        if (!d.name || typeof d.name !== 'string') {
          return NextResponse.json({ error: 'name is required (used for the activity log entry).' }, { status: 400 })
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
            { error: `Cannot delete shift type — ${reqCount} role requirement${reqCount === 1 ? '' : 's'} still exist. Delete those first.` },
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
          return NextResponse.json({ error: 'id is required.' }, { status: 400 })
        }
        const { data: before } = await supabase
          .from('shift_requirements')
          .select('id, shift_type_id, accepted_roles, role, required_count')
          .eq('id', d.id)
          .eq('company_id', companyId)
          .maybeSingle()
        if (!before) {
          return NextResponse.json({ error: `Role requirement ${d.id} not found in this company.` }, { status: 400 })
        }
        const beforeRow = before as { id: string; shift_type_id: string | null; accepted_roles: string[] | null; role: string | null; required_count: number }
        let shiftTypeName = '(unknown shift type)'
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
          policy_type?: string
          description?: string | null
        }
        const existing = await supabase
          .from('policies')
          .select('id, version')
          .eq('company_id', companyId)
          .eq('policy_key', d.policy_key)
          .maybeSingle()
        if (existing.data) {
          await supabase.from('policies').update({
            policy_value: d.policy_value,
            version: ((existing.data as { version?: number }).version ?? 1) + 1,
          }).eq('id', (existing.data as { id: string }).id)
        } else {
          await supabase.from('policies').insert({
            company_id: companyId,
            policy_key: d.policy_key,
            policy_value: d.policy_value,
            policy_type: d.policy_type ?? 'custom',
            description: d.description ?? null,
            version: 1,
          })
        }
        await supabase.from('activity_log').insert({
          company_id: companyId,
          actor: 'soteria',
          action: 'update_policy',
          entity_type: 'policy',
          summary: `Soteria updated policy: ${d.policy_key} = ${d.policy_value}`,
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
            { error: `Invalid severity "${d.severity}". Must be 'avoid' or 'never'.` },
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
        await supabase.from('activity_log').insert({
          company_id: companyId,
          actor: 'soteria',
          action: 'add_conflict',
          entity_type: 'employee_conflict',
          entity_id: data.id,
          summary: `Soteria added conflict pair`,
        })
        return NextResponse.json({ success: true, data })
      }

      case 'delete_policy': {
        const d = action.data as { id: string; policy_key: string }
        await supabase.from('policies').delete().eq('id', d.id).eq('company_id', companyId)
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
            { error: 'Employee not found in this company' },
            { status: 404 }
          )
        }

        let slotsToInsert = d.slots ?? []

        if (d.replace_all) {
          await supabase
            .from('availability')
            .delete()
            .eq('employee_id', d.employee_id)
            .eq('company_id', companyId)
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

        await supabase
          .from('custom_availability')
          .update({ active: false })
          .eq('employee_id', d.employee_id)
          .eq('company_id', companyId)

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

        const aegisUrl = process.env.AEGIS_URL
        if (!aegisUrl) {
          return NextResponse.json(
            { error: 'Aegis URL not configured' },
            { status: 500 }
          )
        }

        const { data: manager } = await supabase
          .from('employees')
          .select('contact_phone')
          .eq('company_id', companyId)
          .eq('primary_role', 'Manager')
          .not('contact_phone', 'is', null)
          .limit(1)
          .maybeSingle()

        const fromPhone = (manager as { contact_phone?: string } | null)?.contact_phone
        if (!fromPhone) {
          return NextResponse.json(
            { error: 'No manager with a phone number on file — Aegis needs a manager phone to authenticate the request.' },
            { status: 400 }
          )
        }

        let bodyText = `Build ${d.target_week} week's schedule`
        if (d.veteran_preference) {
          bodyText += `. ${d.veteran_preference}`
        }

        const aegisRes = await fetch(`${aegisUrl}/webhooks/sms`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
          body: new URLSearchParams({ From: fromPhone, Body: bodyText }).toString(),
        })

        await supabase.from('activity_log').insert({
          company_id: companyId,
          actor: 'soteria',
          action: 'schedule_build_triggered',
          entity_type: 'schedule',
          summary: `Soteria triggered schedule build for ${d.target_week} week`,
          metadata: { target_week: d.target_week, veteran_preference: d.veteran_preference ?? null, aegis_status: aegisRes.status },
        })

        if (!aegisRes.ok) {
          return NextResponse.json(
            { error: `Aegis returned ${aegisRes.status}` },
            { status: 502 }
          )
        }

        return NextResponse.json({ success: true, target_week: d.target_week })
      }

      default:
        return NextResponse.json({ error: 'Unknown action type' }, { status: 400 })
    }

  } catch (error) {
    console.error('Soteria execute error:', error)
    const message = error instanceof Error ? error.message : 'Unknown error'
    return NextResponse.json({ error: message }, { status: 500 })
  }
}
