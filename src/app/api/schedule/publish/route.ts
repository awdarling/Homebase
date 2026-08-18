import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'
import { createClient as createServerSupabase } from '@/lib/supabase/server'
import { postToAegisInternal, AegisInternalError, AegisInternalConfigError } from '@/lib/aegis-internal'

// Service-role client — bypasses RLS. Mirrors SEC-1 (create-user/route.ts) and
// the schedule/delete route. All authz is enforced in code BEFORE any mutation.
const adminSupabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
)

const DEFAULT_TZ = 'America/Detroit'

function todayInTimezone(timeZone: string): string {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(new Date())
}

interface ScheduleRow {
  id: string
  company_id: string
  week_start: string
  week_end: string
  status: string
  published_at: string | null
  distributed_at: string | null
  archived_at: string | null
  deleted_at: string | null
}

/**
 * Publish a schedule (DEV_ROADMAP items 9 + 12).
 *
 * Source of truth = `published_at` timestamp (NOT the ambiguous status enum).
 *
 * - FIRST PUBLISH (no other live published schedule for the week): set
 *   published_at + status='published', then distribute to all staff via Aegis.
 * - REPUBLISH (a different schedule for the same week is already published):
 *   atomically unpublish+archive the old row and publish this one
 *   (publish_schedule_swap RPC), then notify ONLY the employees whose shifts
 *   changed. The old row is kept (archived, superseded_by) and only its saved
 *   wage/hours estimate is cleared so reports follow the new schedule.
 *
 * Body: { scheduleId: string }
 */
export async function POST(req: NextRequest) {
  const { scheduleId } = (await req.json()) as { scheduleId?: string }
  if (!scheduleId) {
    return NextResponse.json({ error: 'scheduleId is required.' }, { status: 400 })
  }

  // ── Authz gate (all checks BEFORE any mutation; never trust the client) ──
  const ssr = await createServerSupabase()
  const { data: { user } } = await ssr.auth.getUser()
  if (!user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

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

  // Load the target schedule with the service role so we evaluate tenancy.
  const { data: targetData, error: targetErr } = await adminSupabase
    .from('schedules')
    .select('id, company_id, week_start, week_end, status, published_at, distributed_at, archived_at, deleted_at')
    .eq('id', scheduleId)
    .maybeSingle()
  if (targetErr) {
    return NextResponse.json({ error: 'Failed to load schedule.' }, { status: 500 })
  }
  if (!targetData) {
    return NextResponse.json({ error: 'Schedule not found' }, { status: 404 })
  }
  const target = targetData as ScheduleRow
  if (target.deleted_at) {
    return NextResponse.json({ error: 'Schedule not found' }, { status: 404 })
  }
  if (target.archived_at) {
    return NextResponse.json({ error: 'This schedule was superseded by a newer one and cannot be published.' }, { status: 409 })
  }

  // Tenant binding: manager/owner must match the schedule's company; quria may
  // act cross-company.
  if (!isQuria && target.company_id !== caller.company_id) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  // Temporal + role gate (mirrors schedule/delete): managers may act on
  // current+upcoming; owners/quria may also act on past weeks.
  const { data: companyRow } = await adminSupabase
    .from('companies')
    .select('timezone')
    .eq('id', target.company_id)
    .maybeSingle()
  const timeZone = (companyRow as { timezone: string | null } | null)?.timezone || DEFAULT_TZ
  const today = todayInTimezone(timeZone)
  const isPast = target.week_end < today
  const allowedRoles = isPast ? ['owner', 'quria'] : ['manager', 'owner', 'quria']
  if (!allowedRoles.includes(caller.role)) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  // ── Is there already a DIFFERENT live published schedule for this week? ──
  const { data: priorData, error: priorErr } = await adminSupabase
    .from('schedules')
    .select('id, company_id, week_start, week_end, status, published_at, distributed_at, archived_at, deleted_at')
    .eq('company_id', target.company_id)
    .eq('week_start', target.week_start)
    .not('published_at', 'is', null)
    .is('archived_at', null)
    .is('deleted_at', null)
    .neq('id', target.id)
    .maybeSingle()
  if (priorErr) {
    return NextResponse.json({ error: 'Failed to check for an existing published schedule.' }, { status: 500 })
  }
  const prior = priorData as ScheduleRow | null

  const actor = isQuria ? 'quria_admin' : 'manager'

  // ════════════════════════════════════════════════════════════════════════
  // REPUBLISH — a different schedule is already published for this week.
  // ════════════════════════════════════════════════════════════════════════
  if (prior) {
    // Atomic swap: archive+unpublish old, publish new, clear old's wage estimate.
    const { error: swapErr } = await adminSupabase.rpc('publish_schedule_swap', {
      p_new_id: target.id,
      p_old_id: prior.id,
    })
    if (swapErr) {
      return NextResponse.json({ error: `Failed to swap schedules: ${swapErr.message}` }, { status: 500 })
    }

    await adminSupabase.from('activity_log').insert([
      {
        company_id: target.company_id,
        actor,
        action: 'schedule_republished',
        entity_type: 'schedule',
        entity_id: target.id,
        summary: 'Republished the schedule for this week — replaced the previously published version',
        metadata: { superseded_schedule_id: prior.id, week_start: target.week_start },
      },
      {
        company_id: target.company_id,
        actor,
        action: 'schedule_superseded',
        entity_type: 'schedule',
        entity_id: prior.id,
        summary: 'Schedule archived — superseded by a newly published schedule for the same week',
        metadata: { superseded_by: target.id, week_start: target.week_start },
      },
    ])

    // Notify ONLY the employees whose shifts changed. A downstream Aegis failure
    // must NOT roll back the swap (the DB is already correct) — surface a partial
    // success instead, mirroring the dispatcher pattern.
    try {
      const notify = await postToAegisInternal<{
        ok: boolean
        notified?: number
        changed_employees?: string[]
        no_contact?: string[]
      }>('/internal/notify-schedule-changes', {
        new_schedule_id: target.id,
        previous_schedule_id: prior.id,
      })
      return NextResponse.json({
        success: true,
        mode: 'republished',
        notified: notify.notified ?? 0,
        changed_employees: notify.changed_employees ?? [],
        no_contact: notify.no_contact ?? [],
      })
    } catch (err) {
      const detail = err instanceof AegisInternalConfigError || err instanceof AegisInternalError
        ? err.message
        : err instanceof Error ? err.message : 'unknown error'
      return NextResponse.json({
        success: true,
        mode: 'republished',
        warning: `The schedule was republished, but change notifications could not be sent: ${detail}. Verify in the activity log and notify affected staff manually if needed.`,
      })
    }
  }

  // ════════════════════════════════════════════════════════════════════════
  // FIRST PUBLISH — no other live published schedule for this week.
  // ════════════════════════════════════════════════════════════════════════
  const { error: pubErr } = await adminSupabase
    .from('schedules')
    .update({ published_at: new Date().toISOString(), status: 'published' })
    .eq('id', target.id)
  if (pubErr) {
    return NextResponse.json({ error: `Failed to publish: ${pubErr.message}` }, { status: 500 })
  }

  await adminSupabase.from('activity_log').insert({
    company_id: target.company_id,
    actor,
    action: 'schedule_published',
    entity_type: 'schedule',
    entity_id: target.id,
    summary: 'Published the schedule for this week and distributed it to staff',
    metadata: { week_start: target.week_start },
  })

  // Distribute to all staff. The Aegis re-distribution guard keys on
  // distributed_at, so re-clicking Publish on an already-sent schedule is a
  // safe no-op (returns already_distributed). force not needed on first send.
  try {
    const dist = await postToAegisInternal<{
      ok: boolean
      sent?: number
      total_employees?: number
      already_distributed?: boolean
    }>('/internal/distribute-schedule', {
      schedule_id: target.id,
    })
    return NextResponse.json({
      success: true,
      mode: 'published',
      sent: dist.sent ?? 0,
      total_employees: dist.total_employees ?? 0,
      already_distributed: dist.already_distributed ?? false,
    })
  } catch (err) {
    const detail = err instanceof AegisInternalConfigError || err instanceof AegisInternalError
      ? err.message
      : err instanceof Error ? err.message : 'unknown error'
    return NextResponse.json({
      success: true,
      mode: 'published',
      warning: `The schedule was marked published, but distribution to staff could not be completed: ${detail}. Verify in the activity log.`,
    })
  }
}
