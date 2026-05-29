import * as dotenv from 'dotenv'
import * as path from 'path'
dotenv.config({ path: path.resolve(process.cwd(), '.env.local') })

import { createClient } from '@supabase/supabase-js'
import { buildDefault } from '../src/lib/schedule/buildDefaultTemplate'

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
)

const WATERMARK_ID = 'a1b2c3d4-e5f6-7890-abcd-ef1234567890'

function expect(cond: boolean, msg: string) {
  if (!cond) { console.error('✗ ' + msg); process.exit(1) }
  else console.log('✓ ' + msg)
}

async function main() {
  const template = await buildDefault(WATERMARK_ID, supabase)

  console.log('\n── row_config ──')
  console.log(JSON.stringify(template.row_config, null, 2))
  console.log('\n── column_config ──')
  console.log(JSON.stringify(template.column_config, null, 2))

  expect(template.row_config.length > 0, 'row_config is non-empty')

  const { data: shifts } = await supabase
    .from('shift_types')
    .select('name')
    .eq('company_id', WATERMARK_ID)
    .eq('active', true)
  const shiftNames = new Set(((shifts ?? []) as Array<{ name: string }>).map(s => s.name))
  for (const row of template.row_config) {
    expect(shiftNames.has(row.id), `row.id "${row.id}" matches an active Watermark shift_type.name`)
  }

  const sortedCols = [...template.column_config].sort((a, b) => a.order - b.order)
  expect(sortedCols[0].day === 1, `first column (by order) has day=1 (Monday), got day=${sortedCols[0].day}`)

  console.log('\nAll template default smoke checks passed.')
}

main().catch(e => { console.error(e); process.exit(1) })
