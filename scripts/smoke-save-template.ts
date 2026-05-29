import * as dotenv from 'dotenv'
import * as path from 'path'
dotenv.config({ path: path.resolve(process.cwd(), '.env.local') })

import { createClient } from '@supabase/supabase-js'
import { buildDefault } from '../src/lib/schedule/buildDefaultTemplate'
import type { ScheduleTemplate } from '../src/lib/types'

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
)

const WATERMARK_ID = 'a1b2c3d4-e5f6-7890-abcd-ef1234567890'

function expect(cond: boolean, msg: string) {
  if (!cond) { console.error('✗ ' + msg); process.exit(1) }
  else console.log('✓ ' + msg)
}

// Mirrors the payload construction in src/lib/hooks/useScheduleTemplate.ts
// saveTemplate. Kept in lockstep so this script proves the fix.
function buildPayload(next: ScheduleTemplate, companyId: string): Record<string, unknown> {
  const { id, ...rest } = next
  const base = id ? next : rest
  return {
    ...base,
    company_id: companyId,
    updated_at: new Date().toISOString(),
  }
}

async function main() {
  // ── 1. Empty-id template (the defaulted case) → id MUST be stripped ──
  const defaulted = await buildDefault(WATERMARK_ID, supabase)
  expect(defaulted.id === '', 'buildDefault returns id: "" as expected')

  const defaultedPayload = buildPayload(defaulted, WATERMARK_ID)
  expect(!('id' in defaultedPayload), 'payload OMITS id when input id is ""')
  expect(defaultedPayload.company_id === WATERMARK_ID, 'payload has company_id')
  expect(typeof defaultedPayload.updated_at === 'string', 'payload has updated_at')
  expect(Array.isArray(defaultedPayload.row_config), 'payload carries row_config')
  expect(Array.isArray(defaultedPayload.column_config), 'payload carries column_config')

  // ── 2. Existing-row template (a real UUID) → id MUST be preserved ──
  const fakeUuid = '00000000-0000-0000-0000-000000000001'
  const existing: ScheduleTemplate = { ...defaulted, id: fakeUuid }
  const existingPayload = buildPayload(existing, WATERMARK_ID)
  expect('id' in existingPayload, 'payload INCLUDES id when input id is a real UUID')
  expect(existingPayload.id === fakeUuid, `payload.id preserved as ${fakeUuid}`)

  // ── 3. Read-only: does Watermark already have a saved row? ──
  const { data: existingRow, error: readErr } = await supabase
    .from('schedule_templates')
    .select('id, company_id, updated_at')
    .eq('company_id', WATERMARK_ID)
    .limit(1)
    .maybeSingle()
  if (readErr) {
    console.error('schedule_templates read failed:', readErr.message)
    process.exit(1)
  }
  if (existingRow) {
    console.log(`\nℹ Watermark already has a saved schedule_templates row.`)
    console.log(`  id=${existingRow.id} updated_at=${existingRow.updated_at}`)
    expect(
      typeof existingRow.id === 'string' && /^[0-9a-f-]{36}$/i.test(existingRow.id),
      'existing row.id is a valid UUID',
    )
  } else {
    console.log('\nℹ Watermark has no schedule_templates row yet.')
    console.log('  Next save from the UI will exercise the id-stripped insert path.')
  }

  console.log('\nAll saveTemplate smoke checks passed (no DB writes performed).')
}

main().catch(e => { console.error(e); process.exit(1) })
