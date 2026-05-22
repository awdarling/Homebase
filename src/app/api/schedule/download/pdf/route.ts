import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'
import { createClient as createServerSupabase } from '@/lib/supabase/server'
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

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')
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

  const dayBlocks = dates.map(date => {
    const dayAssignments = assignments
      .filter(a => a.date === date)
      .sort((a, b) => a.shift_name.localeCompare(b.shift_name) || a.employee_name.localeCompare(b.employee_name))
    const dayGaps = gaps
      .filter(g => g.date === date && g.required_count > g.filled_count)
      .sort((a, b) => a.shift_name.localeCompare(b.shift_name))

    const rows: string[] = []

    for (const a of dayAssignments) {
      rows.push(`
        <tr class="row-filled">
          <td>${escapeHtml(a.shift_name)}</td>
          <td>${escapeHtml(a.start_time)}</td>
          <td>${escapeHtml(a.end_time)}</td>
          <td>${escapeHtml(a.employee_name)}</td>
          <td>${escapeHtml(a.role)}</td>
          <td>Filled</td>
        </tr>
      `)
    }

    for (const g of dayGaps) {
      const unfilled = g.required_count - g.filled_count
      rows.push(`
        <tr class="row-gap">
          <td>${escapeHtml(g.shift_name)}</td>
          <td>—</td>
          <td>—</td>
          <td>— Unfilled (${unfilled}) —</td>
          <td>${escapeHtml(g.role)}</td>
          <td>Gap</td>
        </tr>
      `)
    }

    if (rows.length === 0) {
      rows.push(`
        <tr class="row-empty">
          <td colspan="6">No shifts scheduled</td>
        </tr>
      `)
    }

    return `
      <section class="day-block">
        <h2 class="day-header">${escapeHtml(dayName(date))} <span class="day-date">${escapeHtml(shortDate(date))}</span></h2>
        <table class="schedule-table">
          <thead>
            <tr>
              <th style="width: 22%">Shift</th>
              <th style="width: 10%">Start</th>
              <th style="width: 10%">End</th>
              <th style="width: 28%">Employee</th>
              <th style="width: 20%">Role</th>
              <th style="width: 10%">Status</th>
            </tr>
          </thead>
          <tbody>
            ${rows.join('')}
          </tbody>
        </table>
      </section>
    `
  }).join('')

  const title = `${companyName} — ${longDate(schedule.week_start)} to ${longDate(schedule.week_end)}`

  const html = `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8" />
<title>${escapeHtml(title)}</title>
<style>
  * { box-sizing: border-box; }
  html, body {
    margin: 0;
    padding: 0;
    background: #0e0e18;
    color: #f4f4f8;
    font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Helvetica, Arial, sans-serif;
    -webkit-font-smoothing: antialiased;
  }
  .page {
    max-width: 1100px;
    margin: 0 auto;
    padding: 32px 28px 80px;
  }
  .toolbar {
    display: flex;
    justify-content: space-between;
    align-items: center;
    gap: 16px;
    margin-bottom: 24px;
    padding: 14px 18px;
    background: #1a1a2e;
    border: 1px solid #2a2a4e;
    border-radius: 10px;
  }
  .toolbar-hint {
    font-size: 12px;
    color: #b8b8d0;
  }
  .print-btn {
    background: #4c4cff;
    color: #ffffff;
    border: none;
    padding: 9px 18px;
    border-radius: 6px;
    font-size: 13px;
    font-weight: 600;
    cursor: pointer;
    font-family: inherit;
  }
  .print-btn:hover { background: #6464ff; }
  .doc-header {
    border-bottom: 2px solid #2a2a4e;
    padding-bottom: 16px;
    margin-bottom: 22px;
  }
  .doc-company {
    font-size: 22px;
    font-weight: 700;
    color: #ffffff;
    margin: 0;
    letter-spacing: -0.01em;
  }
  .doc-range {
    font-size: 13px;
    color: #b8b8d0;
    margin-top: 4px;
  }
  .day-block {
    margin-bottom: 22px;
    page-break-inside: avoid;
  }
  .day-header {
    font-size: 15px;
    font-weight: 700;
    color: #ffffff;
    background: #2a2a4e;
    border-radius: 6px 6px 0 0;
    padding: 9px 14px;
    margin: 0;
    letter-spacing: 0.02em;
  }
  .day-date {
    font-weight: 500;
    color: #b8b8d0;
    margin-left: 6px;
  }
  .schedule-table {
    width: 100%;
    border-collapse: collapse;
    background: #14142a;
    border: 1px solid #2a2a4e;
    border-top: none;
    border-radius: 0 0 6px 6px;
    overflow: hidden;
  }
  .schedule-table th {
    text-align: left;
    font-size: 10px;
    text-transform: uppercase;
    letter-spacing: 0.08em;
    color: #8888a8;
    padding: 8px 12px;
    background: #1a1a2e;
    border-bottom: 1px solid #2a2a4e;
    font-weight: 600;
  }
  .schedule-table td {
    padding: 8px 12px;
    font-size: 12px;
    color: #e8e8f0;
    border-bottom: 1px solid #20203a;
  }
  .schedule-table tr:last-child td { border-bottom: none; }
  .row-filled:nth-child(odd) td { background: #16162e; }
  .row-gap td {
    background: rgba(239, 68, 68, 0.12);
    color: #ff6b6b;
    font-weight: 600;
  }
  .row-empty td {
    text-align: center;
    color: #6c6c8a;
    font-style: italic;
    padding: 14px 12px;
  }

  @media print {
    @page {
      size: landscape;
      margin: 1cm;
    }
    html, body {
      background: #ffffff !important;
      color: #1a1a2e !important;
    }
    .toolbar { display: none !important; }
    .page {
      max-width: 100%;
      padding: 0;
    }
    .doc-header { border-bottom: 2px solid #1a1a2e; }
    .doc-company { color: #1a1a2e !important; }
    .doc-range { color: #4c4c6a !important; }
    .day-block { page-break-inside: avoid; }
    .day-header {
      background: #1a1a2e !important;
      color: #ffffff !important;
      -webkit-print-color-adjust: exact;
      print-color-adjust: exact;
    }
    .schedule-table {
      background: #ffffff !important;
      border: 1px solid #cccccc !important;
    }
    .schedule-table th {
      background: #f0f0f4 !important;
      color: #4c4c6a !important;
      border-bottom: 1px solid #cccccc !important;
      -webkit-print-color-adjust: exact;
      print-color-adjust: exact;
    }
    .schedule-table td {
      color: #1a1a2e !important;
      border-bottom: 1px solid #e6e6ee !important;
    }
    .row-filled:nth-child(odd) td {
      background: #fafafd !important;
      -webkit-print-color-adjust: exact;
      print-color-adjust: exact;
    }
    .row-gap td {
      background: #fdecec !important;
      color: #b91c1c !important;
      -webkit-print-color-adjust: exact;
      print-color-adjust: exact;
    }
    .row-empty td { color: #888888 !important; }
  }
</style>
</head>
<body>
  <div class="page">
    <div class="toolbar">
      <div class="toolbar-hint">Use Cmd+P (Mac) or Ctrl+P (Windows) to save as PDF.</div>
      <button class="print-btn" onclick="window.print()">Print / Save as PDF</button>
    </div>

    <header class="doc-header">
      <h1 class="doc-company">${escapeHtml(companyName)}</h1>
      <div class="doc-range">${escapeHtml(longDate(schedule.week_start))} — ${escapeHtml(longDate(schedule.week_end))}</div>
    </header>

    ${dayBlocks}
  </div>
</body>
</html>`

  return new NextResponse(html, {
    status: 200,
    headers: {
      'Content-Type': 'text/html; charset=utf-8',
    },
  })
}
