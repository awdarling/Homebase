// Deactivating and reactivating an employee — the behaviour that actually matters.
// Run:  npx ts-node --transpile-only -r tsconfig-paths/register --project tsconfig.scripts.json \
//         src/lib/employees/__tests__/active-state.test.ts
//
// What this pins, and why each one would hurt if it broke:
//   1. Saving an inactive employee leaves them inactive. Before this work the
//      save payload hardcoded `active: true`, so a manager fixing a phone number
//      silently put the person back on the schedule and was never told.
//   2. Deactivate never writes `last_day`. `active=false` means "not here right
//      now"; `last_day` means "leaving, here's their final shift". Conflating
//      them would make every leave of absence read as a resignation.
//   3. Activate clears `last_day`. Otherwise Aegis's daily offboarding sweep
//      switches the employee straight back off within 24 hours.
//   4. The control's label follows the employee's state — one control, two
//      directions, never two controls.
//   5. The disclaimer appears before deactivating. Always.
//   6. The button and Soteria write the same thing (Rule 0b).

import { readFileSync } from 'fs'
import { join } from 'path'
import {
  activationPatch,
  activeStateAction,
  activeStateLabel,
  activeStateLogAction,
  activeStatePatch,
  activeStateSummary,
  applyActiveStateRule,
  deactivationPatch,
  needsActiveStateConfirm,
} from '../active-state'

let failures = 0
function expect(cond: unknown, msg: string): void {
  if (cond) { console.log(`✓ ${msg}`) } else { console.error(`✗ ${msg}`); failures++ }
}

const REPO_ROOT = join(__dirname, '..', '..', '..', '..')
const read = (rel: string) => readFileSync(join(REPO_ROOT, rel), 'utf8')

const TAB = 'src/app/(app)/data/tabs/EmployeesTab.tsx'
const SOTERIA = 'src/app/api/soteria/execute/route.ts'

const active = { active: true, last_day: null }
const activeLeaving = { active: true, last_day: '2026-09-01' }
const inactive = { active: false, last_day: null }
const inactiveDeparted = { active: false, last_day: '2026-08-16' }

// ── 1. Saving must never change the active state ─────────────────────────────
{
  const tab = read(TAB)
  const payloadStart = tab.indexOf('const payload = {')
  const payload = tab.slice(payloadStart, tab.indexOf('}', tab.indexOf('last_day:', payloadStart)))
  expect(payloadStart > 0, 'the save payload was located')
  expect(!/\bactive:/.test(payload), 'the save payload does NOT write `active` — saving an inactive employee leaves them inactive')
  expect(/last_day:/.test(payload), 'the save payload still writes last_day (that field is the manager’s to edit)')
  // A brand-new employee must still start active.
  expect(tab.includes('.insert({ ...payload, active: true })'), 'a newly ADDED employee still starts active')
  expect(!tab.includes("parts.push('reactivated')"), 'the activity diff no longer claims a save reactivated anyone')
}

// ── 2. Deactivate: active off, last_day untouched ────────────────────────────
{
  const patch = deactivationPatch()
  expect(patch.active === false, 'deactivation sets active = false')
  expect(!('last_day' in patch), 'deactivation does NOT write last_day — a leave of absence is not a resignation')
  expect(Object.keys(patch).join(',') === 'active', 'deactivation writes exactly one field')

  const departing = activeStatePatch(activeLeaving)
  expect(!('last_day' in departing), 'deactivating someone who already has a departure date leaves that date alone')
}

// ── 3. Activate: active on, departure date cleared ───────────────────────────
{
  const patch = activationPatch()
  expect(patch.active === true, 'activation sets active = true')
  expect(patch.last_day === null, 'activation clears last_day (or Aegis re-deactivates within 24h)')
  expect(Object.keys(patch).sort().join(',') === 'active,last_day', 'activation writes exactly those two fields')
}

// ── 4. One control, label follows the state ──────────────────────────────────
{
  expect(activeStateAction(active) === 'deactivate', 'an active employee’s control deactivates')
  expect(activeStateAction(inactiveDeparted) === 'activate', 'an inactive employee’s control activates')
  expect(activeStateLabel(active) === 'Deactivate', 'an active employee’s control reads "Deactivate"')
  expect(activeStateLabel(inactive) === 'Activate', 'an inactive employee’s control reads "Activate"')
  expect(activeStatePatch(active).active === false, 'the control on an active employee writes active = false')
  expect(activeStatePatch(inactive).active === true, 'the control on an inactive employee writes active = true')
  expect(activeStateLogAction('activate') === 'employee_activated', 'activation logs employee_activated')
  expect(activeStateLogAction('deactivate') === 'employee_deactivated', 'deactivation logs employee_deactivated')
}

// ── 5. The disclaimer, and only where it belongs ─────────────────────────────
{
  expect(needsActiveStateConfirm(active) === true, 'deactivating ALWAYS asks first')
  expect(needsActiveStateConfirm(activeLeaving) === true, 'deactivating someone with a departure date also asks first')
  expect(needsActiveStateConfirm(inactiveDeparted) === true, 'activating asks first when a departure date would be erased')
  expect(needsActiveStateConfirm(inactive) === false, 'activating with no departure date does not nag — that is a plain undo')

  // The disclaimer has to be true, not just present.
  const tab = read(TAB)
  const modalStart = tab.indexOf('{confirmActiveState && (')
  const modal = tab.slice(modalStart, tab.indexOf('{/* Add/Edit Form Modal */}'))
  expect(modalStart > 0, 'the confirmation modal was located')
  expect(/future schedule build/.test(modal), 'the disclaimer says they leave future schedule builds')
  expect(/recognise them if they text in/.test(modal), 'the disclaimer says Aegis stops recognising them')
  expect(/already published don&apos;t change/.test(modal), 'the disclaimer says already-published schedules are unaffected')
  expect(/Nothing is deleted/.test(modal), 'the disclaimer says nothing is deleted')
}

// ── 6. Soteria writes what the button writes (Rule 0b) ───────────────────────
{
  const viaSoteria = applyActiveStateRule({ active: true })
  expect(viaSoteria.last_day === null, 'Soteria setting active:true also clears last_day')
  expect(JSON.stringify(viaSoteria) === JSON.stringify(activationPatch()), 'Soteria and the button produce an identical activation')

  const off = applyActiveStateRule({ active: false })
  expect(!('last_day' in off), 'Soteria setting active:false never writes last_day')
  expect(JSON.stringify(off) === JSON.stringify(deactivationPatch()), 'Soteria and the button produce an identical deactivation')

  const settingDeparture = applyActiveStateRule({ active: true, last_day: '2026-09-01' })
  expect(settingDeparture.last_day === '2026-09-01', 'an explicitly supplied last_day is never overwritten')
  expect(settingDeparture.active === true, 'and active is still set alongside it')

  const unrelated = applyActiveStateRule({ contact_email: 'a@b.com' })
  expect(!('last_day' in unrelated), 'an edit that does not touch `active` never clears last_day')
}

// ── 7. The activity feed tells the truth ─────────────────────────────────────
{
  expect(activeStateSummary('activate', 'Ally Becker', '2026-08-16').includes('2026-08-16'), 'activation names the last day that was cleared')
  expect(!activeStateSummary('activate', 'Nick Jovanovic', null).includes('cleared'), 'with no last day, activation does not claim one was cleared')
  expect(activeStateSummary('deactivate', 'Ally Becker', '2026-08-16').includes('not be scheduled'), 'deactivation says what it means for the employee')
  expect(!activeStateSummary('deactivate', 'Ally Becker', '2026-08-16').includes('cleared'), 'deactivation never claims to have cleared a date')
  expect(activeStateSummary('activate', 'Ally', null, 'soteria').startsWith('Soteria'), 'Soteria’s activation wording names Soteria')
  expect(activeStateSummary('deactivate', 'Ally', null, 'soteria').startsWith('Soteria'), 'Soteria’s deactivation wording names Soteria')
}

// ── 8. The surfaces actually route through the rule ──────────────────────────
{
  const tab = read(TAB)
  expect(tab.includes('.update(activeStatePatch(emp))'), 'the panel writes activeStatePatch(), not a hand-rolled patch')
  expect(tab.includes('needsActiveStateConfirm(emp)'), 'the confirm is gated on needsActiveStateConfirm')
  expect(!/function\s+handleToggleActive/.test(tab), 'the old unsafe toggle function is gone')
  expect(
    !/from\('employees'\)[\s\S]{0,80}\.update\(\{[\s\S]{0,60}active/.test(tab),
    'the tab never writes an inline { active: ... } patch to employees',
  )
  // The control belongs to the panel, not the roster row.
  expect(tab.includes('startActiveStateChange(editingEmployee)'), 'the control is driven by the open panel’s employee')
  expect(!/startActiveStateChange\(emp\)\s*\}\}/.test(tab), 'no roster-row control — reaching it means opening a profile')
  // An inactive employee's NAME greys out, not just the status label.
  expect(
    tab.includes("color: emp.active ? 'var(--text-primary)' : 'var(--text-muted)'"),
    'an inactive employee’s name is greyed on the roster',
  )

  const soteria = read(SOTERIA)
  const updateEmployeeCase = soteria.slice(
    soteria.indexOf("case 'update_employee'"),
    soteria.indexOf("case 'delete_employee'"),
  )
  expect(updateEmployeeCase.length > 0, 'the update_employee handler was located')
  expect(updateEmployeeCase.includes('applyActiveStateRule(updates)'), 'Soteria routes update_employee through the shared rule')
  expect(!updateEmployeeCase.includes('.update(updates)'), 'Soteria no longer writes the raw updates object for employees')
}

if (failures > 0) { console.error(`\n${failures} check(s) FAILED.`); process.exit(1) }
console.log('\nAll active-state checks passed.')
