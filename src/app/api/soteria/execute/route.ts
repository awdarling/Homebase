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

      case 'add_shift': {
        const d = action.data as {
          shift_name: string
          role: string
          required_count?: number
          start_time: string
          end_time: string
          days_active?: number[]
        }
        const { data, error } = await supabase.from('shift_requirements').insert({
          company_id: companyId,
          shift_name: d.shift_name,
          role: d.role,
          required_count: d.required_count ?? 1,
          start_time: d.start_time,
          end_time: d.end_time,
          days_active: d.days_active ?? [0, 1, 2, 3, 4, 5, 6],
        }).select().single()
        if (error) throw error
        await supabase.from('activity_log').insert({
          company_id: companyId,
          actor: 'soteria',
          action: 'add_shift',
          entity_type: 'shift_requirement',
          entity_id: data.id,
          summary: `Soteria added shift: ${d.shift_name} — ${d.role}`,
        })
        return NextResponse.json({ success: true, data })
      }

      case 'delete_shift': {
        const d = action.data as { id: string; shift_name: string }
        await supabase.from('shift_requirements').delete().eq('id', d.id).eq('company_id', companyId)
        await supabase.from('activity_log').insert({
          company_id: companyId,
          actor: 'soteria',
          action: 'delete_shift',
          entity_type: 'shift_requirement',
          summary: `Soteria removed shift: ${d.shift_name}`,
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
        const { data, error } = await supabase.from('employee_conflicts').insert({
          company_id: companyId,
          employee_id_1: d.employee_id_1,
          employee_id_2: d.employee_id_2,
          reason: d.reason ?? null,
          severity: d.severity ?? 'avoid',
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
