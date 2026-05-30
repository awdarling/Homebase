import * as dotenv from 'dotenv'
import * as path from 'path'
dotenv.config({ path: path.resolve(process.cwd(), '.env.local') })

import { randomBytes } from 'node:crypto'
import { createClient } from '@supabase/supabase-js'
import {
  hashToken,
  verifyToken,
  consumeToken,
  type ActionType,
} from '../src/lib/aegis-actions/tokens'

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
)

const WATERMARK_ID = 'a1b2c3d4-e5f6-7890-abcd-ef1234567890'

function expect(cond: boolean, msg: string) {
  if (!cond) { console.error('✗ ' + msg); process.exit(1) }
  else console.log('✓ ' + msg)
}

function newRawToken(): string {
  return randomBytes(32).toString('hex')
}

type InsertedRow = { id: string; rawToken: string }

async function insertToken(opts: {
  action_type: ActionType
  payload: Record<string, unknown>
  expiresInMs: number
}): Promise<InsertedRow> {
  const rawToken = newRawToken()
  const tokenHash = hashToken(rawToken)
  const expires_at = new Date(Date.now() + opts.expiresInMs).toISOString()

  const { data, error } = await supabase
    .from('aegis_action_tokens')
    .insert({
      token_hash: tokenHash,
      action_type: opts.action_type,
      payload: opts.payload,
      company_id: WATERMARK_ID,
      expires_at,
    })
    .select('id')
    .single()

  if (error || !data) {
    console.error('Failed to insert test token:', error?.message ?? '(no row returned)')
    process.exit(1)
  }
  return { id: (data as { id: string }).id, rawToken }
}

async function cleanup(ids: string[]) {
  if (ids.length === 0) return
  await supabase.from('aegis_action_tokens').delete().in('id', ids)
}

async function main() {
  const insertedIds: string[] = []

  try {
    // ── 1. Valid live token: verify → ok ───────────────────────────────────
    const live = await insertToken({
      action_type: 'approve_to',
      payload: { time_off_request_id: 'smoke-test-xyz' },
      expiresInMs: 5 * 60 * 1000,
    })
    insertedIds.push(live.id)

    const v1 = await verifyToken(live.rawToken, supabase)
    expect(v1.ok === true, 'verifyToken on fresh token returns ok: true')
    if (v1.ok) {
      expect(v1.row.action_type === 'approve_to', 'verifyToken row.action_type matches')
      expect(
        (v1.row.payload as { time_off_request_id?: string }).time_off_request_id === 'smoke-test-xyz',
        'verifyToken row.payload matches',
      )
    }

    // ── 2. Consume the live token: ok ──────────────────────────────────────
    const c1 = await consumeToken(live.rawToken, supabase)
    expect(c1.ok === true, 'consumeToken on fresh token returns ok: true')
    if (c1.ok) {
      expect(c1.row.consumed_at !== null, 'consumed row has consumed_at set')
    }

    // ── 3. Verify the same token again → consumed ──────────────────────────
    const v2 = await verifyToken(live.rawToken, supabase)
    expect(v2.ok === false, 'verifyToken on already-consumed token returns ok: false')
    if (!v2.ok) {
      expect(v2.error === 'consumed', `verifyToken error is 'consumed' (got '${v2.error}')`)
    }

    // ── 4. Second consume attempt → consumed (race-protection) ─────────────
    const c2 = await consumeToken(live.rawToken, supabase)
    expect(c2.ok === false, 'second consumeToken on same token returns ok: false')
    if (!c2.ok) {
      expect(c2.error === 'consumed', `second consume error is 'consumed' (got '${c2.error}')`)
    }

    // ── 5. Invalid token → invalid ─────────────────────────────────────────
    const bogus = newRawToken()
    const v3 = await verifyToken(bogus, supabase)
    expect(v3.ok === false, 'verifyToken on bogus token returns ok: false')
    if (!v3.ok) {
      expect(v3.error === 'invalid', `bogus-token error is 'invalid' (got '${v3.error}')`)
    }
    const c3 = await consumeToken(bogus, supabase)
    expect(c3.ok === false, 'consumeToken on bogus token returns ok: false')
    if (!c3.ok) {
      expect(c3.error === 'invalid', `bogus-token consume error is 'invalid' (got '${c3.error}')`)
    }

    // ── 6. Expired token → expired ─────────────────────────────────────────
    const expired = await insertToken({
      action_type: 'deny_to',
      payload: { time_off_request_id: 'smoke-test-expired' },
      expiresInMs: -60 * 1000, // 1 min in the past
    })
    insertedIds.push(expired.id)

    const v4 = await verifyToken(expired.rawToken, supabase)
    expect(v4.ok === false, 'verifyToken on expired token returns ok: false')
    if (!v4.ok) {
      expect(v4.error === 'expired', `expired-token error is 'expired' (got '${v4.error}')`)
    }
    const c4 = await consumeToken(expired.rawToken, supabase)
    expect(c4.ok === false, 'consumeToken on expired token returns ok: false')
    if (!c4.ok) {
      expect(c4.error === 'expired', `expired-token consume error is 'expired' (got '${c4.error}')`)
    }
  } finally {
    await cleanup(insertedIds)
  }

  console.log('\n✓ All smoke-action-endpoint assertions passed')
}

main().catch(e => { console.error(e); process.exit(1) })
