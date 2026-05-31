import * as dotenv from 'dotenv'
import * as path from 'path'
dotenv.config({ path: path.resolve(process.cwd(), '.env.local') })

// Force the dispatcher to point at the in-process Aegis stub. Set BEFORE the
// dispatcher module is imported so its closure-resolved env reads pick this up.
process.env.AEGIS_URL = 'https://aegis-stub.smoke.local'
process.env.AEGIS_INTERNAL_SECRET = 'smoke-bearer-secret'

import { randomUUID } from 'node:crypto'
import { createClient } from '@supabase/supabase-js'
import { dispatchAction } from '../src/lib/aegis-actions/dispatcher'
import type { TokenRow } from '../src/lib/aegis-actions/tokens'

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
)

const WATERMARK_ID = 'a1b2c3d4-e5f6-7890-abcd-ef1234567890'

function expect(cond: boolean, msg: string) {
  if (!cond) { console.error('✗ ' + msg); process.exit(1) }
  else console.log('✓ ' + msg)
}

// ── fetch mocking ────────────────────────────────────────────────────────────
//
// dispatcher.ts calls postToAegisInternal which calls global fetch with a
// Bearer auth header. We swap globalThis.fetch with a recorder for the test,
// then restore it. This is the same pattern node-fetch tests use; no extra
// deps required.

type FetchCall = {
  url: string
  method: string
  body: Record<string, unknown>
  authHeader: string | null
}

type FetchHandler = (input: { url: string; body: Record<string, unknown> }) => {
  status: number
  body: Record<string, unknown> | string
} | Promise<{ status: number; body: Record<string, unknown> | string }>

const fetchCalls: FetchCall[] = []
let activeHandler: FetchHandler = () => ({ status: 200, body: {} })

const origFetch = globalThis.fetch
// Only intercept calls bound for the Aegis stub URL — everything else
// (Supabase, etc.) must pass through to the real fetch or the smoke can't
// hit the DB.
const AEGIS_STUB_HOST = 'aegis-stub.smoke.local'
globalThis.fetch = (async (input: unknown, init?: { method?: string; body?: string; headers?: Record<string, string> }) => {
  const url = typeof input === 'string' ? input : String((input as { url: string }).url)
  if (!url.includes(AEGIS_STUB_HOST)) {
    return origFetch(input as RequestInfo, init as RequestInit)
  }
  const method = init?.method ?? 'GET'
  let parsed: Record<string, unknown> = {}
  if (init?.body && typeof init.body === 'string') {
    try { parsed = JSON.parse(init.body) } catch { parsed = { _raw: init.body } }
  }
  const headers = init?.headers ?? {}
  const authHeader = headers['Authorization'] ?? headers['authorization'] ?? null
  fetchCalls.push({ url, method, body: parsed, authHeader })
  const result = await activeHandler({ url, body: parsed })
  const bodyStr = typeof result.body === 'string' ? result.body : JSON.stringify(result.body)
  return {
    ok: result.status >= 200 && result.status < 300,
    status: result.status,
    text: async () => bodyStr,
  } as Response
}) as typeof fetch

// ── Test infra ───────────────────────────────────────────────────────────────

const SMOKE_RUN_ID = randomUUID()
const createdEmployeeIds: string[] = []
const createdToRequestIds: string[] = []
const createdScheduleIds: string[] = []
const createdActivityLogIds: string[] = []

async function cleanup() {
  if (createdActivityLogIds.length > 0) {
    await supabase.from('activity_log').delete().in('id', createdActivityLogIds)
  }
  // Also catch any activity_log rows tagged with our smoke run id.
  await supabase.from('activity_log').delete().contains('metadata', { smoke_run_id: SMOKE_RUN_ID })
  if (createdToRequestIds.length > 0) {
    await supabase.from('time_off_requests').delete().in('id', createdToRequestIds)
  }
  if (createdScheduleIds.length > 0) {
    await supabase.from('schedules').delete().in('id', createdScheduleIds)
  }
  if (createdEmployeeIds.length > 0) {
    await supabase.from('employees').delete().in('id', createdEmployeeIds)
  }
  globalThis.fetch = origFetch
}

async function fetchActivityLogIds(action: string, entity_id: string): Promise<string[]> {
  const { data } = await supabase
    .from('activity_log')
    .select('id, metadata')
    .eq('company_id', WATERMARK_ID)
    .eq('action', action)
    .eq('entity_id', entity_id)
  return ((data ?? []) as Array<{ id: string }>).map(r => r.id)
}

async function trackNewActivityRows(action: string, entity_id: string) {
  const ids = await fetchActivityLogIds(action, entity_id)
  ids.forEach(id => { if (!createdActivityLogIds.includes(id)) createdActivityLogIds.push(id) })
}

function makeTokenRow(overrides: Partial<TokenRow> = {}): TokenRow {
  return {
    id: randomUUID(),
    company_id: WATERMARK_ID,
    token_hash: 'smoke-' + randomUUID(),
    action_type: 'approve_to',
    payload: {},
    issued_to_email: 'smoke.manager@example.com',
    issued_to_employee_id: null,
    issued_to_user_id: null,
    issued_at: new Date().toISOString(),
    expires_at: new Date(Date.now() + 60 * 60 * 1000).toISOString(),
    consumed_at: new Date().toISOString(),
    ...overrides,
  }
}

async function seedEmployee(name: string): Promise<string> {
  const { data, error } = await supabase
    .from('employees')
    .insert({
      company_id: WATERMARK_ID,
      name,
      primary_role: 'Lifeguard',
      qualified_roles: ['Lifeguard'],
      active: false,
      max_weekly_hours: 40,
    })
    .select('id')
    .single()
  if (error || !data) { console.error('seedEmployee failed:', error?.message); process.exit(1) }
  const id = (data as { id: string }).id
  createdEmployeeIds.push(id)
  return id
}

async function seedTimeOffRequest(args: {
  employee_id: string
  status?: 'pending' | 'approved' | 'denied'
  start_date?: string
  end_date?: string
}): Promise<string> {
  const { data, error } = await supabase
    .from('time_off_requests')
    .insert({
      employee_id: args.employee_id,
      company_id: WATERMARK_ID,
      start_date: args.start_date ?? '2026-07-04',
      end_date: args.end_date ?? '2026-07-06',
      reason: 'smoke test',
      status: args.status ?? 'pending',
    })
    .select('id')
    .single()
  if (error || !data) { console.error('seedTimeOffRequest failed:', error?.message); process.exit(1) }
  const id = (data as { id: string }).id
  createdToRequestIds.push(id)
  return id
}

async function seedSchedule(): Promise<string> {
  const { data, error } = await supabase
    .from('schedules')
    .insert({
      company_id: WATERMARK_ID,
      week_start: '2026-07-06',
      week_end: '2026-07-12',
      status: 'draft',
      generated_by: 'manager',
      data: { assignments: [], gaps: [], summary: '' },
    })
    .select('id')
    .single()
  if (error || !data) { console.error('seedSchedule failed:', error?.message); process.exit(1) }
  const id = (data as { id: string }).id
  createdScheduleIds.push(id)
  return id
}

// ── Test cases ───────────────────────────────────────────────────────────────

async function probeDistributedStatusAllowed(): Promise<boolean> {
  // Insert a dummy schedule + try the distributed-status write; revert
  // immediately. Returns true if migration 013 has been applied to the live
  // DB, false if the CHECK constraint still only allows draft/published.
  const { data, error: insErr } = await supabase.from('schedules').insert({
    company_id: WATERMARK_ID,
    week_start: '2026-01-01', week_end: '2026-01-07',
    status: 'draft', generated_by: 'manager',
    data: { assignments: [], gaps: [], summary: '' },
  }).select('id').single()
  if (insErr || !data) return false
  const id = (data as { id: string }).id
  const { error: updErr } = await supabase
    .from('schedules')
    .update({ status: 'distributed' })
    .eq('id', id)
  await supabase.from('schedules').delete().eq('id', id)
  return !updErr
}

async function main() {
  const distributedAllowed = await probeDistributedStatusAllowed()
  if (!distributedAllowed) {
    console.log('ℹ migrations/013_schedules_status_distributed.sql has not been applied to the live DB yet.')
    console.log('  Schedule-write assertions will be skipped. Apply the migration in the Supabase')
    console.log('  SQL editor, then re-run this smoke to exercise the confirm_distribution path.')
  }

  // time_off_requests.decided_by is a FK to users.id. Look up a real manager
  // for Watermark so the smoke can exercise the actual FK + activity_log path.
  // We do NOT mutate this users row — only reference it as the issuing manager.
  const { data: managerRow } = await supabase
    .from('users')
    .select('id, email')
    .eq('company_id', WATERMARK_ID)
    .eq('role', 'manager')
    .limit(1)
    .maybeSingle()
  if (!managerRow) {
    console.error('✗ Could not find a Watermark manager users row for the smoke. Seed one or adjust the script.')
    process.exit(1)
  }
  const issuedToUserId = (managerRow as { id: string }).id

  // ── 1. approve_to happy path ─────────────────────────────────────────────
  {
    fetchCalls.length = 0
    activeHandler = () => ({ status: 200, body: { channel: 'email', sent_to: 'employee@example.com' } })

    const empId = await seedEmployee('Smoke Employee A')
    const toId = await seedTimeOffRequest({ employee_id: empId })

    const row = makeTokenRow({
      action_type: 'approve_to',
      payload: {
        time_off_request_id: toId,
        employee_name: 'Smoke A',
        start_date: '2026-07-04',
        end_date: '2026-07-06',
      },
      issued_to_user_id: issuedToUserId,
      issued_to_email: 'manager@watermark.example',
    })

    const result = await dispatchAction(row, supabase)
    expect(result.ok === true, '[approve_to] dispatch returns ok=true')
    expect(result.message.includes('Smoke A'), `[approve_to] message contains employee name (got "${result.message}")`)
    expect(result.message.includes('email'), `[approve_to] message mentions notification channel "email"`)

    const { data: toRow } = await supabase.from('time_off_requests').select('status, decided_at, decided_by').eq('id', toId).single()
    const r = toRow as { status: string; decided_at: string | null; decided_by: string | null }
    expect(r.status === 'approved', `[approve_to] DB status='approved' (got '${r.status}')`)
    expect(r.decided_at !== null, '[approve_to] decided_at is set')
    expect(r.decided_by === issuedToUserId, `[approve_to] decided_by matches issued_to_user_id`)

    expect(fetchCalls.length === 1, `[approve_to] fetch was called exactly once (got ${fetchCalls.length})`)
    expect(fetchCalls[0].url.endsWith('/internal/notify-to-decision'), `[approve_to] Aegis URL is /internal/notify-to-decision`)
    expect(fetchCalls[0].authHeader === 'Bearer smoke-bearer-secret', `[approve_to] Bearer auth header present`)
    expect(fetchCalls[0].body.time_off_request_id === toId, `[approve_to] Aegis payload carries time_off_request_id`)
    expect(fetchCalls[0].body.decision === 'approved', `[approve_to] Aegis payload carries decision='approved'`)

    await trackNewActivityRows('time_off_approved', toId)
    const ids = await fetchActivityLogIds('time_off_approved', toId)
    expect(ids.length >= 1, `[approve_to] activity_log has a time_off_approved entry`)
  }

  // ── 2. deny_to happy path ────────────────────────────────────────────────
  {
    fetchCalls.length = 0
    activeHandler = () => ({ status: 200, body: { channel: 'sms', sent_to: '+15551234567' } })

    const empId = await seedEmployee('Smoke Employee B')
    const toId = await seedTimeOffRequest({ employee_id: empId, start_date: '2026-08-01', end_date: '2026-08-01' })

    const row = makeTokenRow({
      action_type: 'deny_to',
      payload: {
        time_off_request_id: toId,
        employee_name: 'Smoke B',
        start_date: '2026-08-01',
        end_date: '2026-08-01',
      },
      issued_to_user_id: issuedToUserId,
      issued_to_email: 'manager@watermark.example',
    })

    const result = await dispatchAction(row, supabase)
    expect(result.ok === true, '[deny_to] dispatch returns ok=true')
    expect(result.message.includes('Smoke B'), `[deny_to] message contains employee name`)
    expect(result.message.toLowerCase().includes('denied'), `[deny_to] message mentions 'denied' (got "${result.message}")`)
    expect(result.message.includes('sms'), `[deny_to] message mentions notification channel "sms"`)

    const { data: toRow } = await supabase.from('time_off_requests').select('status, decided_by').eq('id', toId).single()
    const r = toRow as { status: string; decided_by: string | null }
    expect(r.status === 'denied', `[deny_to] DB status='denied'`)
    expect(r.decided_by === issuedToUserId, `[deny_to] decided_by matches issued_to_user_id`)

    expect(fetchCalls[0].body.decision === 'denied', `[deny_to] Aegis payload carries decision='denied'`)

    await trackNewActivityRows('time_off_denied', toId)
  }

  // ── 3. confirm_distribution happy path ───────────────────────────────────
  if (distributedAllowed) {
    fetchCalls.length = 0
    activeHandler = () => ({ status: 200, body: { sent: 12, errors: [] } })

    const scheduleId = await seedSchedule()

    const row = makeTokenRow({
      action_type: 'confirm_distribution',
      payload: {
        schedule_id: scheduleId,
        company_name: 'Watermark Country Club',
        week_start: '2026-07-06',
        week_end: '2026-07-12',
      },
      issued_to_user_id: issuedToUserId,
      issued_to_email: 'manager@watermark.example',
    })

    const result = await dispatchAction(row, supabase)
    expect(result.ok === true, '[confirm_distribution] dispatch returns ok=true')
    expect(/\b12 employees\b/.test(result.message), `[confirm_distribution] message mentions '12 employees' (got "${result.message}")`)
    expect(!result.message.includes('delivery issue'), `[confirm_distribution] no error suffix when errors=[]`)

    const { data: schedRow } = await supabase.from('schedules').select('status, distributed_at').eq('id', scheduleId).single()
    const s = schedRow as { status: string; distributed_at: string | null }
    expect(s.status === 'distributed', `[confirm_distribution] schedule.status='distributed' (got '${s.status}')`)
    expect(s.distributed_at !== null, `[confirm_distribution] distributed_at is set`)

    expect(fetchCalls.length === 1, `[confirm_distribution] fetch called once`)
    expect(fetchCalls[0].url.endsWith('/internal/distribute-schedule'), `[confirm_distribution] Aegis URL`)
    expect(fetchCalls[0].body.schedule_id === scheduleId, `[confirm_distribution] payload carries schedule_id`)

    await trackNewActivityRows('schedule_distributed_via_email', scheduleId)
  }

  // ── 4. confirm_distribution with delivery errors surfaces them ───────────
  if (distributedAllowed) {
    fetchCalls.length = 0
    activeHandler = () => ({ status: 200, body: { sent: 8, errors: ['employee X had no contact info', 'employee Y delivery bounced'] } })

    const scheduleId = await seedSchedule()
    const row = makeTokenRow({
      action_type: 'confirm_distribution',
      payload: { schedule_id: scheduleId, company_name: 'Watermark', week_start: '2026-07-13', week_end: '2026-07-19' },
      issued_to_user_id: issuedToUserId,
    })
    const result = await dispatchAction(row, supabase)
    expect(result.ok === true, '[confirm_distribution + errors] ok=true (decision stands)')
    expect(result.message.includes('2 delivery issues'), `[confirm_distribution + errors] message mentions '2 delivery issues' (got "${result.message}")`)

    await trackNewActivityRows('schedule_distributed_via_email', scheduleId)
  }

  // ── 5. Already-decided guard: try to approve an approved request ─────────
  {
    fetchCalls.length = 0
    activeHandler = () => ({ status: 200, body: { channel: 'email', sent_to: 'x@example.com' } })

    const empId = await seedEmployee('Smoke Employee C')
    const toId = await seedTimeOffRequest({ employee_id: empId, status: 'approved' })

    const row = makeTokenRow({
      action_type: 'approve_to',
      payload: { time_off_request_id: toId, employee_name: 'Smoke C', start_date: '2026-07-04', end_date: '2026-07-06' },
      issued_to_user_id: issuedToUserId,
    })
    const result = await dispatchAction(row, supabase)
    expect(result.ok === false, '[already-decided] dispatch returns ok=false')
    expect(/already approved/i.test(result.message), `[already-decided] message says 'already approved' (got "${result.message}")`)
    expect(fetchCalls.length === 0, '[already-decided] no Aegis fetch fires')
  }

  // ── 6. Aegis-down failure path: DB update happens, partial-success returned ──
  {
    fetchCalls.length = 0
    activeHandler = () => { throw new Error('connection refused') }

    const empId = await seedEmployee('Smoke Employee D')
    const toId = await seedTimeOffRequest({ employee_id: empId, start_date: '2026-09-01', end_date: '2026-09-02' })

    const row = makeTokenRow({
      action_type: 'approve_to',
      payload: { time_off_request_id: toId, employee_name: 'Smoke D', start_date: '2026-09-01', end_date: '2026-09-02' },
      issued_to_user_id: issuedToUserId,
      issued_to_email: 'manager@watermark.example',
    })
    const result = await dispatchAction(row, supabase)
    expect(result.ok === true, '[aegis-down] dispatch still returns ok=true (DB succeeded)')
    expect(/Could not deliver notification/i.test(result.message), `[aegis-down] message mentions delivery failure (got "${result.message}")`)
    expect(result.message.includes('Smoke D'), `[aegis-down] message still names the employee`)

    const { data: toRow } = await supabase.from('time_off_requests').select('status').eq('id', toId).single()
    expect((toRow as { status: string }).status === 'approved', '[aegis-down] DB status=approved regardless of Aegis failure')

    // A delivery-failure activity log entry was written.
    await trackNewActivityRows('time_off_approved', toId)
    await trackNewActivityRows('notification_delivery_failed', toId)
    const failureIds = await fetchActivityLogIds('notification_delivery_failed', toId)
    expect(failureIds.length >= 1, '[aegis-down] notification_delivery_failed activity_log entry exists')
  }

  console.log('\n✓ All smoke-real-dispatchers assertions passed')
}

main()
  .then(async () => { await cleanup() })
  .catch(async e => { console.error(e); await cleanup(); process.exit(1) })
