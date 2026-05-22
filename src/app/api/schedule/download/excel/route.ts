import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'
import { createClient as createServerSupabase } from '@/lib/supabase/server'
import * as XLSX from 'xlsx'
import type { Schedule, ScheduleAssignment, ScheduleGap } from '@/lib/types'

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
)

function eachDateInRange(start: string, end: string): string[] {
  const dates: string[] = []
  const [sy, sm, sd] = start.split('-').map(Number)
  const [ey, em, ed] = end.split('-').map(Number)
  const cur = new Date(sy, sm - 1, sd)
  const stop = new Date(ey, em - 1, ed)
  while (cur <= stop) {
    const yy = cur.getFullYear()
    const mm = String(cur.getMonth() + 1).padStart(2, '0')
    const dd = String(cur.getDate()).padStart(2, '0')
    dates.push(`${yy}-${mm}-${dd}`)
    cur.setDate(cur.getDate() + 1)
  }
  return dates
}

function dayName(d: string): string {
  const [y, m, day] = d.split('-').map(Number)
  return new Date(y, m - 1, day).toLocaleDateString('en-US', { weekday: 'long' })
}

function shortDate(d: string): string {
  const [y, m, day] = d.split('-').map(Number)
  return new Date(y, m - 1, day).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
}

function longDate(d: string): string {
  const [y, m, day] = d.split('-').map(Number)
  return new Date(y, m - 1, day).toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' })
}

type Cell = { v: string; s?: Record<string, unknown> }

const HEADER_STYLE = {
  fill: { patternType: 'solid', fgColor: { rgb: '1A1A2E' } },
  font: { color: { rgb: 'FFFFFF' }, bold: true, sz: 12 },
  alignment: { vertical: 'center', horizontal: 'center' },
}

const COLUMN_HEADER_STYLE = {
  fill: { patternType: 'solid', fgColor: { rgb: '1A1A2E' } },
  font: { color: { rgb: 'FFFFFF' }, bold: true, sz: 11 },
  alignment: { vertical: 'center', horizontal: 'left' },
}

const DAY_HEADER_STYLE = {
  fill: { patternType: 'solid', fgColor: { rgb: '2A2A4E' } },
  font: { color: { rgb: 'FFFFFF' }, bold: true, sz: 11 },
  alignment: { vertical: 'center', horizontal: 'left' },
}

const FILLED_STYLE_A = {
  fill: { patternType: 'solid', fgColor: { rgb: 'F4F4F8' } },
  font: { color: { rgb: '1A1A2E' }, sz: 10 },
  alignment: { vertical: 'center', horizontal: 'left' },
}

const FILLED_STYLE_B = {
  fill: { patternType: 'solid', fgColor: { rgb: 'EAEAF0' } },
  font: { color: { rgb: '1A1A2E' }, sz: 10 },
  alignment: { vertical: 'center', horizontal: 'left' },
}

const GAP_STYLE = {
  fill: { patternType: 'solid', fgColor: { rgb: 'FDECEC' } },
  font: { color: { rgb: 'B91C1C' }, bold: true, sz: 10 },
  alignment: { vertical: 'center', horizontal: 'left' },
}

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
    .single()
  if (scheduleErr || !scheduleRow) {
    return NextResponse.json({ error: 'Schedule not found' }, { status: 404 })
  }
  const schedule = scheduleRow as Schedule

  const { data: companyRow } = await supabase
    .from('companies')
    .select('name')
    .eq('id', companyId)
    .single()
  const companyName = (companyRow as { name?: string } | null)?.name ?? 'Schedule'

  const assignments: ScheduleAssignment[] = schedule.data?.assignments ?? []
  const gaps: ScheduleGap[] = schedule.data?.gaps ?? []
  const dates = eachDateInRange(schedule.week_start, schedule.week_end)

  const COLS = ['Day', 'Date', 'Shift', 'Start', 'End', 'Employee', 'Role', 'Status']

  const rows: Cell[][] = []

  rows.push([
    { v: `${companyName} — ${longDate(schedule.week_start)} to ${longDate(schedule.week_end)}`, s: HEADER_STYLE },
    { v: '', s: HEADER_STYLE },
    { v: '', s: HEADER_STYLE },
    { v: '', s: HEADER_STYLE },
    { v: '', s: HEADER_STYLE },
    { v: '', s: HEADER_STYLE },
    { v: '', s: HEADER_STYLE },
    { v: '', s: HEADER_STYLE },
  ])

  rows.push(COLS.map(() => ({ v: '' })))

  rows.push(COLS.map(c => ({ v: c, s: COLUMN_HEADER_STYLE })))

  let alt = false
  for (const date of dates) {
    const dayLabel = `${dayName(date)} — ${shortDate(date)}`
    rows.push([
      { v: dayLabel, s: DAY_HEADER_STYLE },
      { v: '', s: DAY_HEADER_STYLE },
      { v: '', s: DAY_HEADER_STYLE },
      { v: '', s: DAY_HEADER_STYLE },
      { v: '', s: DAY_HEADER_STYLE },
      { v: '', s: DAY_HEADER_STYLE },
      { v: '', s: DAY_HEADER_STYLE },
      { v: '', s: DAY_HEADER_STYLE },
    ])

    const dayAssignments = assignments
      .filter(a => a.date === date)
      .sort((a, b) => a.shift_name.localeCompare(b.shift_name) || a.employee_name.localeCompare(b.employee_name))

    for (const a of dayAssignments) {
      const style = alt ? FILLED_STYLE_B : FILLED_STYLE_A
      alt = !alt
      rows.push([
        { v: dayName(date), s: style },
        { v: shortDate(date), s: style },
        { v: a.shift_name, s: style },
        { v: a.start_time, s: style },
        { v: a.end_time, s: style },
        { v: a.employee_name, s: style },
        { v: a.role, s: style },
        { v: 'Filled', s: style },
      ])
    }

    const dayGaps = gaps
      .filter(g => g.date === date && g.required_count > g.filled_count)
      .sort((a, b) => a.shift_name.localeCompare(b.shift_name))

    for (const g of dayGaps) {
      const unfilled = g.required_count - g.filled_count
      rows.push([
        { v: dayName(date), s: GAP_STYLE },
        { v: shortDate(date), s: GAP_STYLE },
        { v: g.shift_name, s: GAP_STYLE },
        { v: '', s: GAP_STYLE },
        { v: '', s: GAP_STYLE },
        { v: `— Unfilled (${unfilled}) —`, s: GAP_STYLE },
        { v: g.role, s: GAP_STYLE },
        { v: 'Gap', s: GAP_STYLE },
      ])
    }
  }

  const aoa = rows.map(r => r.map(c => c.v))
  const ws = XLSX.utils.aoa_to_sheet(aoa)

  rows.forEach((row, rIdx) => {
    row.forEach((cell, cIdx) => {
      if (!cell.s) return
      const addr = XLSX.utils.encode_cell({ r: rIdx, c: cIdx })
      const existing = ws[addr] ?? { t: 's', v: cell.v }
      ws[addr] = { ...existing, t: 's', v: cell.v, s: cell.s }
    })
  })

  ws['!cols'] = [
    { wch: 12 },
    { wch: 14 },
    { wch: 18 },
    { wch: 10 },
    { wch: 10 },
    { wch: 22 },
    { wch: 16 },
    { wch: 10 },
  ]

  ws['!merges'] = [{ s: { r: 0, c: 0 }, e: { r: 0, c: 7 } }]

  ws['!rows'] = [{ hpt: 26 }, { hpt: 8 }, { hpt: 22 }]

  const wb = XLSX.utils.book_new()
  XLSX.utils.book_append_sheet(wb, ws, 'Schedule')

  const buffer = XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' }) as Buffer

  const filename = `Schedule_${schedule.week_start}.xlsx`

  return new NextResponse(new Uint8Array(buffer), {
    status: 200,
    headers: {
      'Content-Type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      'Content-Disposition': `attachment; filename="${filename}"`,
      'Content-Length': String(buffer.length),
    },
  })
}
