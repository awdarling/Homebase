import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'
import { createClient as createServerSupabase } from '@/lib/supabase/server'

// Service-role client — bypasses RLS. Mirrors SEC-1 (create-user/route.ts).
const adminSupabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
)

const DEFAULT_TZ = 'America/Detroit'

// "today" as a YYYY-MM-DD string in the company timezone.
// NEVER new Date('YYYY-MM-DD') — that parses as UTC midnight and shifts the day.
function todayInTimezone(timeZone: string): string {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(new Date())
}

export async function POST(req: NextRequest) {
  const { scheduleId } = (await req.json()) as { scheduleId?: string }
  if (!scheduleId) {
    return NextResponse.json({ error: 'scheduleId is required.' }, { status: 400 })
  }

  // ── Authz gate (all checks BEFORE any mutation; never trust the client) ──
  // 1. Caller must be signed in.
  const ssr = await createServerSupabase()
  const { data: { user } } = await ssr.auth.getUser()
  if (!user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  // 2. Load the caller's own role + company from the users table (server-side,
  //    never from the request body).
  const { data: callerRow } = await ssr
    .from('users')
    .select('role, company_id')
    .eq('id', user.id)
    .single()
  const caller = callerRow as { role: string; company_id: string } | null
  if (!caller) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }
  const isQuria = caller.role === 'quria'

  // 3. Load the target schedule with the service role so we evaluate tenancy
  //    ourselves (a quria admin may act cross-company).
  const { data: schedRow, error: schedErr } = await adminSupabase
    .from('schedules')
    .select('id, company_id, week_end, distributed_at, deleted_at')
    .eq('id', scheduleId)
    .maybeSingle()
  if (schedErr) {
    return NextResponse.json({ error: 'Failed to load schedule.' }, { status: 500 })
  }
  if (!schedRow) {
    return NextResponse.json({ error: 'Schedule not found' }, { status: 404 })
  }
  const schedule = schedRow as {
    id: string
    company_id: string
    week_end: string
    distributed_at: string | null
    deleted_at: string | null
  }
  // Already soft-deleted → idempotent not-found.
  if (schedule.deleted_at) {
    return NextResponse.json({ error: 'Schedule not found' }, { status: 404 })
  }

  // 4. Tenant binding: manager/owner must match the schedule's company;
  //    quria may act cross-company.
  if (!isQuria && schedule.company_id !== caller.company_id) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  // 5. Temporal + role gate, computed server-side in the company timezone.
  //    isPast = week_end < today (company tz).
  //      isPast      → allow owner, quria
  //      not isPast  → allow manager, owner, quria
  const { data: companyRow } = await adminSupabase
    .from('companies')
    .select('timezone')
    .eq('id', schedule.company_id)
    .maybeSingle()
  const timeZone = (companyRow as { timezone: string | null } | null)?.timezone || DEFAULT_TZ
  const today = todayInTimezone(timeZone)
  const isPast = schedule.week_end < today
  const allowedRoles = isPast ? ['owner', 'quria'] : ['manager', 'owner', 'quria']
  if (!allowedRoles.includes(caller.role)) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  // ── Soft delete: set deleted_at via the service role. No hard DELETE. ────
  const { error: updErr } = await adminSupabase
    .from('schedules')
    .update({ deleted_at: new Date().toISOString() })
    .eq('id', scheduleId)
  if (updErr) {
    return NextResponse.json({ error: updErr.message }, { status: 400 })
  }

  // ── Audit ────────────────────────────────────────────────────────────────
  await adminSupabase.from('activity_log').insert({
    company_id: schedule.company_id,
    actor: isQuria ? 'quria_admin' : 'manager',
    action: 'schedule_deleted',
    entity_type: 'schedule',
    entity_id: scheduleId,
    summary: schedule.distributed_at
      ? 'Deleted a schedule that had already been distributed to employees'
      : 'Deleted a schedule',
  })

  return NextResponse.json({ success: true })
}
