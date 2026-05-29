import { parseYMD, toYMD, formatYMD } from '../src/lib/utils/dates'

function expect(cond: boolean, msg: string) {
  if (!cond) { console.error('✗ ' + msg); process.exit(1) }
  else console.log('✓ ' + msg)
}

const d = parseYMD('2026-06-01')
expect(d.getFullYear() === 2026, 'parseYMD year is 2026')
expect(d.getMonth() === 5, 'parseYMD month is June (0-indexed: 5)')
expect(d.getDate() === 1, 'parseYMD day is 1, not 31')
expect(d.getDay() === 1, 'parseYMD day-of-week is Monday (1), not Sunday (0)')

expect(toYMD(d) === '2026-06-01', 'toYMD round-trips to 2026-06-01')
expect(toYMD(parseYMD('2026-12-31')) === '2026-12-31', 'toYMD handles end of year')
expect(toYMD(parseYMD('2026-01-01')) === '2026-01-01', 'toYMD handles start of year')

expect(formatYMD('2026-06-01', { weekday: 'short' }) === 'Mon', 'formatYMD weekday for Mon')
expect(formatYMD('2026-06-07', { weekday: 'short' }) === 'Sun', 'formatYMD weekday for Sun')

console.log('\nAll date parse smoke checks passed.')
