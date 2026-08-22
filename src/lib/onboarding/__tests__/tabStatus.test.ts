// L5 regression suite — the Onboarding tab must never render a timeout as a
// completion.
//
// Run: npx tsx src/lib/onboarding/__tests__/tabStatus.test.ts

import {
  statusFromTerminalAction,
  completedAtFor,
  ONBOARDING_TERMINAL_ACTIONS,
  TIMELINE_ONLY_ACTIONS,
  LAST_EVENT_LABELS,
} from '../tabStatus'

let failures = 0
function expect(cond: boolean, msg: string): void {
  if (cond) console.log(`✓ ${msg}`)
  else { console.error(`✗ ${msg}`); failures++ }
}

// Bennet Nieukoop's real row, from the live activity_log on 2026-08-16.
const BENNET_TIMEOUT_AT = '2026-08-16T16:13:55.834088Z'

// ── THE BUG ──────────────────────────────────────────────────────────────────
{
  // This is exactly what Alexander saw: Status "Timed Out" next to
  // Completed "Aug 16, 4:13 PM" — the same timestamp, on the same row.
  expect(
    completedAtFor('onboarding_timeout', BENNET_TIMEOUT_AT) === null,
    'THE BUG: a timeout does NOT populate the Completed column',
  )
  expect(
    statusFromTerminalAction('onboarding_timeout') === 'timed_out',
    'a timeout is still reported as timed out — the event is not hidden, just not miscalled',
  )
}
{
  const completedAt = '2026-08-13T21:57:04.422112Z'
  expect(
    completedAtFor('onboarding_complete', completedAt) === completedAt,
    'a real completion DOES populate the Completed column',
  )
  expect(statusFromTerminalAction('onboarding_complete') === 'complete', 'and shows as complete')
}
{
  expect(
    completedAtFor('onboarding_skipped_no_contact', BENNET_TIMEOUT_AT) === null,
    'a skip does not populate the Completed column either',
  )
}

// ── The action-name drift ────────────────────────────────────────────────────
{
  // Aegis writes '..._no_contact'; the tab only listed '..._no_phone', so the
  // 'skipped' branch was unreachable dead code.
  expect(
    statusFromTerminalAction('onboarding_skipped_no_contact') === 'skipped',
    "the name Aegis actually writes ('_no_contact') maps to skipped",
  )
  expect(
    statusFromTerminalAction('onboarding_skipped_no_phone') === 'skipped',
    "the legacy name ('_no_phone') still maps to skipped, for historical rows",
  )
  expect(
    ONBOARDING_TERMINAL_ACTIONS.includes('onboarding_skipped_no_contact'),
    'and it is actually FETCHED — being unlisted is why the branch was dead',
  )
}
{
  expect(
    statusFromTerminalAction('something_else') === 'not_started',
    'an unrecognised action degrades to not_started rather than throwing',
  )
}

// ── Timeline events must not become the status ───────────────────────────────
{
  // If a non-terminal event were added to the terminal list it would become the
  // "latest log" for that employee and mislabel the row — e.g. a 24h warning
  // would read as 'not_started' and wipe a real completion off the display.
  for (const a of TIMELINE_ONLY_ACTIONS) {
    expect(
      !ONBOARDING_TERMINAL_ACTIONS.includes(a),
      `'${a}' is timeline-only and must never drive the status pill`,
    )
  }
  expect(
    TIMELINE_ONLY_ACTIONS.includes('onboarding_started'),
    'a re-onboard IS surfaced in the timeline (it was invisible, which hid the restart)',
  )
  expect(
    TIMELINE_ONLY_ACTIONS.includes('onboarding_24h_warning_sent'),
    'the 24h warnings are surfaced too',
  )
}

// ── Labels ───────────────────────────────────────────────────────────────────
{
  expect(LAST_EVENT_LABELS['onboarding_timeout'] === 'timed out', 'the Last Event column names a timeout in plain English')
  expect(
    LAST_EVENT_LABELS['onboarding_complete'] === undefined,
    'a completion needs no Last Event label — the Completed column already says it',
  )
}

if (failures > 0) {
  console.error(`\n${failures} check(s) failed.`)
  process.exit(1)
}
console.log('\nAll Onboarding-tab status checks passed.')
