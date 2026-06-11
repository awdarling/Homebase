import type { SupabaseClient } from '@supabase/supabase-js'
import type { TokenRow } from './tokens'
import { postToAegisInternal, AegisInternalConfigError } from '@/lib/aegis-internal'
import { decideTimeOffRequest } from '@/lib/time-off/decide'

export type DispatchResult = { ok: boolean; message: string }

// ── Aegis response shapes ────────────────────────────────────────────────────
// These mirror what the Aegis /internal/* endpoints return. Kept narrow on
// purpose — any extra fields the Aegis side adds are ignored.

type DistributeScheduleResponse = {
  sent?: number
  errors?: string[]
}

// ── Date helpers ─────────────────────────────────────────────────────────────

function formatDateRange(start: string | null, end: string | null): string {
  if (!start) return 'unknown range'
  if (!end || end === start) return formatDate(start)
  return `${formatDate(start)} – ${formatDate(end)}`
}

function formatDate(d: string): string {
  // YYYY-MM-DD — parse in local time per Doc 5 §6.1.
  const [y, m, day] = d.split('-').map(Number)
  if (!y || !m || !day) return d
  return new Date(y, m - 1, day).toLocaleDateString('en-US', {
    month: 'short', day: 'numeric',
  })
}

function strOrNull(v: unknown): string | null {
  return typeof v === 'string' && v.length > 0 ? v : null
}

function numOrNull(v: unknown): number | null {
  return typeof v === 'number' && Number.isFinite(v) ? v : null
}

// ── Activity-log helper ──────────────────────────────────────────────────────

async function logDecision(
  supabase: SupabaseClient,
  args: {
    company_id: string | null
    action: string
    entity_type: string
    entity_id: string
    summary: string
    metadata: Record<string, unknown>
  },
) {
  if (!args.company_id) return  // activity_log requires company_id
  await supabase.from('activity_log').insert({
    company_id: args.company_id,
    actor: 'manager',
    action: args.action,
    entity_type: args.entity_type,
    entity_id: args.entity_id,
    summary: args.summary,
    metadata: args.metadata,
  })
}

async function logAegisDeliveryFailure(
  supabase: SupabaseClient,
  args: {
    company_id: string | null
    entity_type: string
    entity_id: string
    aegis_endpoint: string
    error: string
    issued_to_user_id: string | null
    issued_to_email: string | null
  },
) {
  if (!args.company_id) return
  await supabase.from('activity_log').insert({
    company_id: args.company_id,
    actor: 'manager',
    action: 'notification_delivery_failed',
    entity_type: args.entity_type,
    entity_id: args.entity_id,
    summary: `Decision recorded, but downstream Aegis call ${args.aegis_endpoint} failed`,
    metadata: {
      aegis_endpoint: args.aegis_endpoint,
      error: args.error,
      decided_by: args.issued_to_user_id,
      decided_by_email: args.issued_to_email,
      source: 'magic_link',
    },
  })
}

// ── Time-off (approve / deny) ────────────────────────────────────────────────

async function handleTimeOffDecision(
  decision: 'approved' | 'denied',
  row: TokenRow,
  supabase: SupabaseClient,
): Promise<DispatchResult> {
  const payload = row.payload
  const time_off_request_id = strOrNull(payload.time_off_request_id)
  const employee_name = strOrNull(payload.employee_name) ?? 'employee'
  const start_date = strOrNull(payload.start_date)
  const end_date = strOrNull(payload.end_date)

  if (!time_off_request_id) {
    return { ok: false, message: 'This link is missing the time-off request id. Approve from Homebase instead.' }
  }

  // Delegate to the shared helper so the magic-link path and the in-tab
  // Homebase path record decisions identically (guarded update + decided_by,
  // activity log, fire-and-tolerate employee notification, manager message).
  const result = await decideTimeOffRequest({
    supabase,
    timeOffRequestId: time_off_request_id,
    decision,
    companyId: row.company_id,
    decidedBy: { userId: row.issued_to_user_id, email: row.issued_to_email },
    source: 'magic_link',
    employeeName: employee_name,
    startDate: start_date,
    endDate: end_date,
  })
  return { ok: result.ok, message: result.message }
}

// ── Schedule distribution ────────────────────────────────────────────────────

async function handleConfirmDistribution(
  row: TokenRow,
  supabase: SupabaseClient,
): Promise<DispatchResult> {
  const payload = row.payload
  const schedule_id = strOrNull(payload.schedule_id)
  const company_name = strOrNull(payload.company_name) ?? 'the team'
  const week_start = strOrNull(payload.week_start)
  const week_end = strOrNull(payload.week_end)
  const weekLabel = week_start && week_end ? formatDateRange(week_start, week_end) : null

  if (!schedule_id) {
    return { ok: false, message: 'This link is missing the schedule id. Distribute from Homebase instead.' }
  }

  // Guarded update: only distribute a draft or published schedule. A schedule
  // already 'distributed' or 'approved'-then-distributed should not get sent
  // again silently.
  const { data: updated, error: updateErr } = await supabase
    .from('schedules')
    .update({
      status: 'distributed',
      distributed_at: new Date().toISOString(),
    })
    .eq('id', schedule_id)
    .is('deleted_at', null)
    .in('status', ['draft', 'published'])
    .select('id, status')
    .maybeSingle()

  if (updateErr) {
    return { ok: false, message: `Could not record distribution: ${updateErr.message}` }
  }

  if (!updated) {
    const { data: existing } = await supabase
      .from('schedules')
      .select('status')
      .eq('id', schedule_id)
      .is('deleted_at', null)
      .maybeSingle()
    if (!existing) {
      return { ok: false, message: 'Schedule not found. It may have been deleted.' }
    }
    const status = (existing as { status: string }).status
    return {
      ok: false,
      message: status === 'distributed'
        ? 'This schedule has already been distributed — no change made.'
        : `This schedule is in status "${status}" and cannot be distributed via email. Open Homebase to take action.`,
    }
  }

  const summarySuffix = weekLabel ? ` (week of ${weekLabel})` : ''
  await logDecision(supabase, {
    company_id: row.company_id,
    action: 'schedule_distributed_via_email',
    entity_type: 'schedule',
    entity_id: schedule_id,
    summary: `Distributed schedule for ${company_name}${summarySuffix}`,
    metadata: {
      decided_by: row.issued_to_user_id,
      decided_by_email: row.issued_to_email,
      source: 'magic_link',
      week_start,
      week_end,
    },
  })

  try {
    const resp = await postToAegisInternal<DistributeScheduleResponse>(
      '/internal/distribute-schedule',
      { schedule_id },
    )
    const sent = numOrNull(resp.sent)
    const errorCount = Array.isArray(resp.errors) ? resp.errors.length : 0
    const recipientLabel = sent === null
      ? 'employees'
      : `${sent} employee${sent === 1 ? '' : 's'}`
    const tail = errorCount > 0
      ? ` (${errorCount} delivery issue${errorCount === 1 ? '' : 's'} — see the Homebase activity log).`
      : '.'
    return {
      ok: true,
      message: `Schedule distributed to ${recipientLabel}${tail}`,
    }
  } catch (err) {
    const errMsg = err instanceof Error ? err.message : String(err)
    await logAegisDeliveryFailure(supabase, {
      company_id: row.company_id,
      entity_type: 'schedule',
      entity_id: schedule_id,
      aegis_endpoint: '/internal/distribute-schedule',
      error: errMsg,
      issued_to_user_id: row.issued_to_user_id,
      issued_to_email: row.issued_to_email,
    })
    if (err instanceof AegisInternalConfigError) {
      return {
        ok: true,
        message: 'Schedule marked as distributed in Homebase. Notification delivery is not configured yet — please send a manual heads-up to your team.',
      }
    }
    return {
      ok: true,
      message: 'Schedule marked as distributed in Homebase. Could not deliver notifications — please verify in the activity log.',
    }
  }
}

// ── Public entry point ───────────────────────────────────────────────────────

export async function dispatchAction(
  row: TokenRow,
  supabase: SupabaseClient,
): Promise<DispatchResult> {
  switch (row.action_type) {
    case 'approve_to':
      return handleTimeOffDecision('approved', row, supabase)
    case 'deny_to':
      return handleTimeOffDecision('denied', row, supabase)
    case 'confirm_distribution':
      return handleConfirmDistribution(row, supabase)

    // The remaining action types are still pending real handlers — they
    // continue to stub-dispatch so the token consume + audit flow keeps
    // working end-to-end while the Aegis side ships those workflows.
    case 'approve_availability':
    case 'deny_availability':
    case 'accept_emergency_coverage':
    case 'decline_emergency_coverage':
    case 'request_additional_batch':
      console.log(`[aegis-action] ${row.action_type} received for payload`, row.payload)
      return { ok: true, message: 'Action recorded. We\'ll wire the full handler shortly.' }

    default:
      return { ok: false, message: 'Unknown action type' }
  }
}
