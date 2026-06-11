import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'
import { createClient as createServerSupabase } from '@/lib/supabase/server'
import type { Schedule, ScheduleTemplate } from '@/lib/types'
import { buildScheduleGrid, type ShiftMeta, type EventRow } from '@/lib/schedule/buildScheduleGrid'
import { buildDefault } from '@/lib/schedule/buildDefaultTemplate'
import { renderScheduleGridXlsx } from '@/lib/schedule/renderScheduleGridXlsx'

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
)

export async function POST(req: NextRequest) {
  const body = await req.json() as { scheduleId?: string; companyId?: string }
  const { scheduleId, companyId } = body
  if (!scheduleId || !companyId) {
    return NextResponse.json({ error: 'Missing scheduleId or companyId' }, { status: 400 })
  }

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

  const { data: scheduleRow, error: scheduleErr } = await supabase
    .from('schedules')
    .select('*')
    .eq('id', scheduleId)
    .eq('company_id', companyId)
    .is('deleted_at', null)
    .single()
  if (scheduleErr || !scheduleRow) {
    return NextResponse.json({ error: 'Schedule not found' }, { status: 404 })
  }
  const schedule = scheduleRow as Schedule

  const [companyRes, templateRes, shiftsRes, eventsRes] = await Promise.all([
    supabase.from('companies').select('name').eq('id', companyId).single(),
    supabase.from('schedule_templates').select('*').eq('company_id', companyId).maybeSingle(),
    supabase.from('shift_types').select('name, start_time, end_time, days_active').eq('company_id', companyId).eq('active', true),
    supabase.from('events').select('date, title').eq('company_id', companyId).gte('date', schedule.week_start).lte('date', schedule.week_end),
  ])
  const companyName = (companyRes.data as { name?: string } | null)?.name ?? 'Schedule'
  const template: ScheduleTemplate = (templateRes.data as ScheduleTemplate | null)
    ?? (await buildDefault(companyId, supabase))
  const shifts = (shiftsRes.data ?? []) as ShiftMeta[]
  const events = (eventsRes.data ?? []) as EventRow[]

  try {
    const grid = buildScheduleGrid({ schedule, template, companyName, shifts, events })
    const buffer = await renderScheduleGridXlsx(grid)
    const filename = `Schedule_${schedule.week_start}.xlsx`

    return new NextResponse(new Uint8Array(buffer), {
      status: 200,
      headers: {
        'Content-Type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
        'Content-Disposition': `attachment; filename="${filename}"`,
        'Content-Length': String(buffer.length),
      },
    })
  } catch (err) {
    // Surface the real cause in the logs instead of a blind 500.
    console.error('[download-error] Excel schedule download failed:', err instanceof Error ? err.stack : err)
    return NextResponse.json({ error: 'Failed to generate the schedule download.' }, { status: 500 })
  }
}
