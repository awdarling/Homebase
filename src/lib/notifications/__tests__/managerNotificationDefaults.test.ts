// Manager notification defaults — 2026-08-22.
// Run:  npx ts-node --transpile-only -r tsconfig-paths/register \
//         --project tsconfig.scripts.json \
//         src/lib/notifications/__tests__/managerNotificationDefaults.test.ts
//
// WHY THIS FILE EXISTS. This rule has to hold in two repos at once: Homebase
// draws the checkbox, Aegis decides whether to send. If they disagree, a manager
// sees an unticked box for a message Aegis is cheerfully texting them — and
// there is no error, no log, nothing to notice. Rule 0 says what the manager
// sees IS the truth, so the two have to be kept in step by hand.
//
// The twin is Aegis/src/messaging/manager-directory.ts — OWNER_MUTED_BY_DEFAULT
// and wantsCategory. Change one, change the other.

import { readFileSync } from 'fs'
import { resolve } from 'path'
import {
  wantsCategory,
  defaultForRole,
  defaultNote,
  OWNER_MUTED_BY_DEFAULT,
} from '../managerNotificationDefaults'
import type { NotifyCategory } from '@/lib/types'

let failures = 0
function expect(cond: unknown, msg: string): void {
  if (cond) { console.log(`✓ ${msg}`) } else { console.error(`✗ ${msg}`); failures++ }
}

const ALL: NotifyCategory[] = ['approvals', 'trades', 'schedule_posts', 'reports']

// ── The correction that prompted this file ───────────────────────────────────
// An owner used to default OFF for everything. At Watermark that is half the
// management team, and it would have silently stopped them hearing about time
// off from the day it shipped.
expect(defaultForRole('owner', 'approvals') === true,
  'an owner hears about approvals by default — the thing that needs them')
expect(defaultForRole('owner', 'reports') === true,
  'an owner gets reports by default')
expect(defaultForRole('owner', 'trades') === false,
  'an owner is quiet on trades by default — the chatter they hired managers for')
expect(defaultForRole('owner', 'schedule_posts') === false,
  'an owner is quiet on schedule posts by default')

for (const c of ALL) {
  expect(defaultForRole('manager', c) === true, `a manager defaults ON for '${c}'`)
}

// ── An explicit choice always wins, in both directions ───────────────────────
expect(wantsCategory('owner', { approvals: false }, 'approvals') === false,
  'an owner CAN switch approvals off — we just never do it for them')
expect(wantsCategory('owner', { trades: true }, 'trades') === true,
  'an owner can switch a muted category on')
expect(wantsCategory('manager', { trades: false }, 'trades') === false,
  'a working manager can switch a category off')
expect(wantsCategory('manager', null, 'approvals') === true,
  'no preferences at all falls back to the role default, not to off')
expect(wantsCategory('owner', { approvals: 'yes' as never }, 'approvals') === true,
  'junk in the column is not a preference — the role default applies')

// ── The note under an untouched checkbox must describe what will happen ──────
expect(defaultNote('owner', 'approvals') === ' · on by default',
  'the owner approvals note says ON, because it is on')
expect(defaultNote('owner', 'trades') === ' · off for owners by default',
  'the owner trades note says off')
expect(defaultNote('manager', 'trades') === ' · on by default',
  'a manager sees on-by-default everywhere')

// ── The muted set is exactly the high-volume pair ────────────────────────────
expect(
  [...OWNER_MUTED_BY_DEFAULT].sort().join(',') === 'schedule_posts,trades',
  'only the two high-volume categories are muted for owners',
)

// ── The page must not restate the rule instead of asking for it ──────────────
// This is the drift that actually happens: someone edits the checkbox inline and
// the UI quietly starts lying about what Aegis does.
const page = readFileSync(
  resolve(__dirname, '../../../app/(app)/access/page.tsx'), 'utf8')
expect(/from '@\/lib\/notifications\/managerNotificationDefaults'/.test(page),
  'the Access page imports the shared rule')
expect(!/:\s*!isOwner/.test(page),
  'the page no longer computes the default inline')

if (failures > 0) { console.error(`\n${failures} notification-default check(s) FAILED.`); process.exit(1) }
console.log('\nAll notification-default checks passed.')
