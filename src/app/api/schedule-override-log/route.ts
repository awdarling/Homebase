import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'
import { createClient as createServerSupabase } from '@/lib/supabase/server'

// Records a manager's deliberate override of Soteria's blocking checks when
// saving a schedule edit. The schedule save itself happens client-side; this
// route exists purely to write an auditable activity_log entry with the reason,
// the overridden issues, and who did it — server-side (service role) so the log
// can't be skipped or spoofed by the client.
const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
)

interface OverrideIssue { severity: string; employee_name: string; description: string }

export async function POST(req: NextRequest) {
  try {
    const body = (await req.json()) as {
      company_id: string
      schedule_id: string
      reason: string
      issues: OverrideIssue[]
    }

    const ssr = await createServerSupabase()
    const { data: { user } } = await ssr.auth.getUser()
    if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    const { data: userRow } = await ssr
      .from('users')
      .select('company_id, name')
      .eq('id', user.id)
      .single()
    if (!userRow || (userRow as { company_id: string }).company_id !== body.company_id) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
    }
    const reason = (body.reason ?? '').trim()
    if (!reason) return NextResponse.json({ error: 'A reason is required to override.' }, { status: 422 })

    const managerName = (userRow as { name?: string }).name ?? null
    const issues = Array.isArray(body.issues) ? body.issues : []
    const count = issues.length

    await supabase.from('activity_log').insert({
      company_id: body.company_id,
      actor: 'manager',
      actor_name: managerName,
      action: 'schedule_edit_override',
      entity_type: 'schedule',
      entity_id: body.schedule_id,
      summary: `${managerName ?? 'A manager'} overrode ${count} blocking Soteria issue${count === 1 ? '' : 's'} to save the schedule.`,
      metadata: {
        user_id: user.id,
        reason,
        overridden_issues: issues.map(i => ({ severity: i.severity, employee_name: i.employee_name, description: i.description })),
      },
    })

    return NextResponse.json({ ok: true })
  } catch (e) {
    console.error('[schedule-override-log] error:', e)
    return NextResponse.json({ error: 'Failed to log override' }, { status: 500 })
  }
}
