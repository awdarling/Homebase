import type { SupabaseClient } from '@supabase/supabase-js'
import {
  postToAegisInternal,
  AegisInternalError,
  AegisInternalConfigError,
} from '@/lib/aegis-internal'

export type TimeOffDecision = 'approved' | 'denied'

export interface DecideTimeOffInput {
  /** Service-role client — the guarded write must bypass RLS. */
  supabase: SupabaseClient
  timeOffRequestId: string
  decision: TimeOffDecision
  /** activity_log requires a company_id; null skips logging. */
  companyId: string | null
  /** Who acted. userId lands in time_off_requests.decided_by. */
  decidedBy: { userId: string | null; email: string | null }
  /** Where the decision originated — recorded in activity metadata. */
  source: 'magic_link' | 'in_tab'
  /** Display context for the manager-facing message + activity summary. */
  employeeName?: string
  startDate?: string | null
  endDate?: string | null
  /** Optional actor identity for a richer activity-feed entry. */
  actorName?: string | null
  actorAvatarUrl?: string | null
}

export interface DecideTimeOffResult {
  ok: boolean
  message: string
  /** true when the row was already decided (no change made). */
  alreadyDecided?: boolean
}

type NotifyToDecisionResponse = {
  channel?: 'sms' | 'email' | 'none'
  sent_to?: string | null
}

// YYYY-MM-DD parsed in LOCAL time (Doc 5 §6.1 — never new Date('YYYY-MM-DD'),
// which shifts the day back at UTC midnight).
function formatDate(d: string | null | undefined): string {
  if (!d) return 'unknown'
  const [y, m, day] = d.split('-').map(Number)
  if (!y || !m || !day) return d
  return new Date(y, m - 1, day).toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
  })
}

function formatDateRange(start: string | null | undefined, end: string | null | undefined): string {
  if (!start) return 'unknown range'
  if (!end || end === start) return formatDate(start)
  return `${formatDate(start)} – ${formatDate(end)}`
}

/**
 * Single source of truth for recording a time-off approve/deny decision.
 *
 * Both the email magic-link dispatcher and the in-tab Homebase route call this,
 * so the two paths stay identical: a guarded (pending-only) update that sets
 * decided_by, an activity-log entry, a fire-and-tolerate employee notification
 * via Aegis, and a "feels like a person" manager-facing message. A downstream
 * Aegis failure never rolls back the decision that was already persisted.
 */
export async function decideTimeOffRequest(
  input: DecideTimeOffInput,
): Promise<DecideTimeOffResult> {
  const { supabase, timeOffRequestId, decision, companyId, decidedBy, source } = input
  const employeeName = input.employeeName ?? 'the employee'
  const dateRange = formatDateRange(input.startDate, input.endDate)
  const verb = decision === 'approved' ? 'approved' : 'denied'

  // Guarded update: only flips a still-pending row, so we never clobber a prior
  // decision (manager double-acts, or a magic-link + in-tab race).
  const { data: updated, error: updateErr } = await supabase
    .from('time_off_requests')
    .update({
      status: decision,
      decided_at: new Date().toISOString(),
      decided_by: decidedBy.userId,
    })
    .eq('id', timeOffRequestId)
    .eq('status', 'pending')
    .select('id, status')
    .maybeSingle()

  if (updateErr) {
    return { ok: false, message: `Couldn't record that decision: ${updateErr.message}` }
  }

  if (!updated) {
    // Row is gone or was already decided — re-read to tell the manager which,
    // and (the definitive click-guard) by whom and when.
    const { data: existing } = await supabase
      .from('time_off_requests')
      .select('status, decided_at, decided_by')
      .eq('id', timeOffRequestId)
      .maybeSingle()
    if (!existing) {
      return { ok: false, message: 'That request no longer exists — it may have been deleted.' }
    }
    const ex = existing as { status: string; decided_at: string | null; decided_by: string | null }

    // Resolve who decided it, for a clear "already approved by X on <date>" note.
    let byPhrase = ''
    if (ex.decided_by) {
      const { data: decider } = await supabase
        .from('users').select('name').eq('id', ex.decided_by).maybeSingle()
      const name = (decider as { name: string | null } | null)?.name
      if (name) byPhrase = ` by ${name}`
    }
    let onPhrase = ''
    if (ex.decided_at) {
      const d = new Date(ex.decided_at)
      if (!Number.isNaN(d.getTime())) {
        onPhrase = ` on ${d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}`
      }
    }

    return {
      ok: false,
      alreadyDecided: true,
      message: `This request was already ${ex.status}${byPhrase}${onPhrase} — nothing changed.`,
    }
  }

  // Activity log (best-effort; never blocks the decision).
  if (companyId) {
    await supabase.from('activity_log').insert({
      company_id: companyId,
      actor: 'manager',
      actor_name: input.actorName ?? null,
      actor_avatar_url: input.actorAvatarUrl ?? null,
      action: `time_off_${decision}`,
      entity_type: 'time_off_request',
      entity_id: timeOffRequestId,
      summary: `${verb.charAt(0).toUpperCase() + verb.slice(1)} time-off for ${employeeName}: ${dateRange}`,
      metadata: {
        decided_by: decidedBy.userId,
        decided_by_email: decidedBy.email,
        source,
        decision,
        start_date: input.startDate ?? null,
        end_date: input.endDate ?? null,
      },
    })
  }

  // Notify the employee through Aegis. Fire-and-tolerate: the decision is
  // already saved, so a notification failure becomes a partial-success message
  // plus a delivery-failed activity entry — it does not undo the decision.
  try {
    const resp = await postToAegisInternal<NotifyToDecisionResponse>(
      '/internal/notify-to-decision',
      { time_off_request_id: timeOffRequestId, decision },
    )
    const channel = resp.channel && resp.channel !== 'none' ? resp.channel : null
    const message = channel
      ? `Done — ${employeeName}'s time-off is ${verb}, and they've been notified by ${channel}.`
      : `Done — ${employeeName}'s time-off is ${verb}. There was no contact method on file, so they'll see it in Homebase.`
    return { ok: true, message }
  } catch (err) {
    const errMsg = err instanceof Error ? err.message : String(err)
    if (companyId) {
      await supabase.from('activity_log').insert({
        company_id: companyId,
        actor: 'manager',
        action: 'notification_delivery_failed',
        entity_type: 'time_off_request',
        entity_id: timeOffRequestId,
        summary: `Decision recorded, but the employee notification (/internal/notify-to-decision) didn't go through`,
        metadata: {
          aegis_endpoint: '/internal/notify-to-decision',
          error: errMsg,
          decided_by: decidedBy.userId,
          decided_by_email: decidedBy.email,
          source,
        },
      })
    }
    if (err instanceof AegisInternalConfigError) {
      return {
        ok: true,
        message: `${employeeName}'s time-off is ${verb}. Notifications aren't configured yet, so please let them know directly.`,
      }
    }
    if (err instanceof AegisInternalError) {
      return {
        ok: true,
        message: `${employeeName}'s time-off is ${verb}, but the notification didn't send — worth a quick heads-up to them directly.`,
      }
    }
    return {
      ok: true,
      message: `${employeeName}'s time-off is ${verb}. The notification may not have sent — worth verifying.`,
    }
  }
}
