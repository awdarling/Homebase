import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
)

export async function POST(request: NextRequest) {
  try {
    const body = await request.json()
    const { action, companyId } = body

    switch (action.type) {

      case 'add_employee': {
        const { data, error } = await supabase.from('employees').insert({
          company_id: companyId,
          name: action.data.name,
          primary_role: action.data.primary_role,
          qualified_roles: action.data.qualified_roles ?? [action.data.primary_role],
          max_weekly_hours: action.data.max_weekly_hours ?? 40,
          contact_phone: action.data.contact_phone ?? null,
          contact_email: action.data.contact_email ?? null,
          active: true,
        }).select().single()
        if (error) throw error

        await supabase.from('activity_log').insert({
          company_id: companyId,
          actor: 'soteria',
          action: 'add_employee',
          entity_type: 'employee',
          entity_id: data.id,
          summary: `Soteria added employee: ${action.data.name} (${action.data.primary_role})`,
        })
        return NextResponse.json({ success: true, data })
      }

      case 'delete_employee': {
        await supabase.from('availability').delete().eq('employee_id', action.data.id)
        await supabase.from('employees').delete().eq('id', action.data.id)
        await supabase.from('activity_log').insert({
          company_id: companyId,
          actor: 'soteria',
          action: 'delete_employee',
          entity_type: 'employee',
          summary: `Soteria removed employee: ${action.data.name}`,
        })
        return NextResponse.json({ success: true })
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
        const { data, error } = await supabase.from('shift_requirements').insert({
          company_id: companyId,
          shift_name: action.data.shift_name,
          role: action.data.role,
          required_count: action.data.required_count ?? 1,
          start_time: action.data.start_time,
          end_time: action.data.end_time,
          days_active: action.data.days_active ?? [0, 1, 2, 3, 4, 5, 6],
        }).select().single()
        if (error) throw error
        await supabase.from('activity_log').insert({
          company_id: companyId,
          actor: 'soteria',
          action: 'add_shift',
          entity_type: 'shift_requirement',
          entity_id: data.id,
          summary: `Soteria added shift: ${action.data.shift_name} — ${action.data.role}`,
        })
        return NextResponse.json({ success: true, data })
      }

      case 'delete_shift': {
        await supabase.from('shift_requirements').delete().eq('id', action.data.id)
        await supabase.from('activity_log').insert({
          company_id: companyId,
          actor: 'soteria',
          action: 'delete_shift',
          entity_type: 'shift_requirement',
          summary: `Soteria removed shift: ${action.data.shift_name}`,
        })
        return NextResponse.json({ success: true })
      }

      case 'update_policy': {
        const existing = await supabase
          .from('policies')
          .select('id, version')
          .eq('company_id', companyId)
          .eq('policy_key', action.data.policy_key)
          .maybeSingle()

        if (existing.data) {
          await supabase.from('policies').update({
            policy_value: action.data.policy_value,
            version: (existing.data.version ?? 1) + 1,
          }).eq('id', existing.data.id)
        } else {
          await supabase.from('policies').insert({
            company_id: companyId,
            policy_key: action.data.policy_key,
            policy_value: action.data.policy_value,
            policy_type: action.data.policy_type ?? 'custom',
            description: action.data.description ?? null,
            version: 1,
          })
        }
        await supabase.from('activity_log').insert({
          company_id: companyId,
          actor: 'soteria',
          action: 'update_policy',
          entity_type: 'policy',
          summary: `Soteria updated policy: ${action.data.policy_key} = ${action.data.policy_value}`,
        })
        return NextResponse.json({ success: true })
      }

      case 'add_conflict': {
        const { data, error } = await supabase.from('employee_conflicts').insert({
          company_id: companyId,
          employee_id_1: action.data.employee_id_1,
          employee_id_2: action.data.employee_id_2,
          reason: action.data.reason ?? null,
          severity: action.data.severity ?? 'avoid',
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
        await supabase.from('policies').delete().eq('id', action.data.id)
        await supabase.from('activity_log').insert({
          company_id: companyId,
          actor: 'soteria',
          action: 'delete_policy',
          entity_type: 'policy',
          summary: `Soteria removed policy: ${action.data.policy_key}`,
        })
        return NextResponse.json({ success: true })
      }

      default:
        return NextResponse.json({ error: 'Unknown action type' }, { status: 400 })
    }

  } catch (error: any) {
    console.error('Soteria execute error:', error)
    return NextResponse.json({ error: error.message }, { status: 500 })
  }
}