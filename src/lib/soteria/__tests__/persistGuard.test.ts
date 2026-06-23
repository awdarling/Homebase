// Runtime test harness for the persistence guard (pillar 3).
// Homebase has no test runner yet, so this mirrors the SOTERIA-CHECK-1 pattern:
// a plain Node script with assertions, run via ts-node --transpile-only.
//
// What it locks down: the executor's previously-silent writes (delete_employee,
// update_profile, delete_policy, update_availability's replace-all wipe, and
// set_custom_availability's deactivate step) must now THROW when their database
// write fails, so the route returns a non-success the chat UI surfaces — instead
// of telling the manager a change was "saved" when nothing persisted.
//
// The guard itself is unit-tested directly. Each fixed action is exercised by
// replaying its exact guarded write sequence against a fake Supabase client
// whose calls resolve to a scripted queue of { data, error } results.
//
// Run:  npx ts-node --transpile-only --project tsconfig.scripts.json \
//         src/lib/soteria/__tests__/persistGuard.test.ts

import { throwOnWriteError, PersistError } from '../persistGuard'

let failures = 0
function expect(cond: boolean, msg: string): void {
  if (cond) {
    console.log(`✓ ${msg}`)
  } else {
    console.error(`✗ ${msg}`)
    failures++
  }
}

/** Did running `fn` throw a PersistError whose message mentions `needle`? */
async function throwsPersist(fn: () => Promise<unknown>, needle: string): Promise<boolean> {
  try {
    await fn()
    return false
  } catch (e) {
    return e instanceof PersistError && e.message.toLowerCase().includes(needle.toLowerCase())
  }
}
async function resolves(fn: () => Promise<unknown>): Promise<boolean> {
  try {
    await fn()
    return true
  } catch {
    return false
  }
}

type Result = { data?: unknown; error?: { message?: string; code?: string } | null }

// Minimal chainable Supabase stub. Every builder method returns the builder;
// the builder is thenable and `.maybeSingle()`/`.single()` resolve to the next
// scripted result, so each awaited statement consumes exactly one queue entry.
function makeFakeSupabase(results: Result[]) {
  let i = 0
  const next = (): Result => results[i++] ?? { data: null, error: null }
  const builder: Record<string, unknown> = {}
  const passthrough = ['from', 'select', 'insert', 'update', 'delete', 'eq', 'order', 'limit', 'contains', 'in']
  for (const m of passthrough) builder[m] = () => builder
  builder.maybeSingle = () => Promise.resolve(next())
  builder.single = () => Promise.resolve(next())
  builder.then = (resolve: (v: Result) => unknown, reject: (e: unknown) => unknown) =>
    Promise.resolve(next()).then(resolve, reject)
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return builder as any
}

const COMPANY = 'company-1'
const OK: Result = { error: null }
const FAIL = (message: string): Result => ({ error: { message, code: '23503' } })

// ── Replays of the exact guarded write sequences from execute/route.ts ───────

// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function runDeleteEmployee(supabase: any, d: { id: string; name: string }) {
  const { error: availErr } = await supabase.from('availability').delete().eq('employee_id', d.id).eq('company_id', COMPANY)
  throwOnWriteError(availErr, `remove ${d.name}'s availability`)
  const { error: empErr } = await supabase.from('employees').delete().eq('id', d.id).eq('company_id', COMPANY)
  throwOnWriteError(empErr, `delete employee ${d.name}`)
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function runUpdateProfile(supabase: any) {
  const existing = await supabase.from('company_profiles').select('id').eq('company_id', COMPANY).maybeSingle()
  throwOnWriteError(existing.error, 'read the company profile')
  if (existing.data) {
    const { error: updErr } = await supabase.from('company_profiles').update({}).eq('company_id', COMPANY)
    throwOnWriteError(updErr, 'update the company profile')
  } else {
    const { error: insErr } = await supabase.from('company_profiles').insert({})
    throwOnWriteError(insErr, 'save the company profile')
  }
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function runDeletePolicy(supabase: any, d: { id: string; policy_key: string }) {
  const { error: delErr } = await supabase.from('policies').delete().eq('id', d.id).eq('company_id', COMPANY)
  throwOnWriteError(delErr, `delete policy ${d.policy_key}`)
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function runReplaceAvailability(supabase: any, d: { employee_id: string; employee_name: string }) {
  const { error: delErr } = await supabase.from('availability').delete().eq('employee_id', d.employee_id).eq('company_id', COMPANY)
  throwOnWriteError(delErr, `clear ${d.employee_name}'s existing availability`)
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function runSetCustomAvailability(supabase: any, d: { employee_id: string; employee_name: string }) {
  const { error: deactivateErr } = await supabase.from('custom_availability').update({ active: false }).eq('employee_id', d.employee_id).eq('company_id', COMPANY)
  throwOnWriteError(deactivateErr, `clear ${d.employee_name}'s previous custom availability`)
}

async function main() {
  // 1. Guard unit behaviour
  expect(await resolves(async () => throwOnWriteError(null, 'x')), 'guard does not throw on null error')
  expect(await resolves(async () => throwOnWriteError(undefined, 'x')), 'guard does not throw on undefined error')
  expect(await throwsPersist(async () => throwOnWriteError({ message: 'boom' }, 'delete employee Maria'), 'delete employee Maria'),
    'guard throws PersistError tagged with the write context')
  {
    let code: string | undefined
    try { throwOnWriteError({ message: 'fk', code: '23503' }, 'x') } catch (e) { code = (e as PersistError).code }
    expect(code === '23503', 'guard preserves the database error code')
  }

  const emp = { id: 'e1', name: 'Maria' }

  // 2. delete_employee
  expect(await resolves(() => runDeleteEmployee(makeFakeSupabase([OK, OK]), emp)),
    'delete_employee succeeds when both deletes succeed')
  expect(await throwsPersist(() => runDeleteEmployee(makeFakeSupabase([OK, FAIL('fk violation')]), emp), 'delete employee Maria'),
    'delete_employee throws when the employee delete fails (was silent before)')
  expect(await throwsPersist(() => runDeleteEmployee(makeFakeSupabase([FAIL('locked'), OK]), emp), "remove Maria's availability"),
    'delete_employee throws when the availability delete fails (was silent before)')

  // 3. update_profile — existing (update) and new (insert) branches
  expect(await resolves(() => runUpdateProfile(makeFakeSupabase([{ data: { id: 'p1' } }, OK]))),
    'update_profile succeeds on the update branch')
  expect(await throwsPersist(() => runUpdateProfile(makeFakeSupabase([{ data: { id: 'p1' } }, FAIL('denied')]), ), 'update the company profile'),
    'update_profile throws when the update fails (was silent before)')
  expect(await resolves(() => runUpdateProfile(makeFakeSupabase([{ data: null }, OK]))),
    'update_profile succeeds on the insert branch')
  expect(await throwsPersist(() => runUpdateProfile(makeFakeSupabase([{ data: null }, FAIL('denied')])), 'save the company profile'),
    'update_profile throws when the insert fails (was silent before)')

  // 4. delete_policy
  const pol = { id: 'pol1', policy_key: 'gender_requirement' }
  expect(await resolves(() => runDeletePolicy(makeFakeSupabase([OK]), pol)),
    'delete_policy succeeds when the delete succeeds')
  expect(await throwsPersist(() => runDeletePolicy(makeFakeSupabase([FAIL('nope')]), pol), 'delete policy gender_requirement'),
    'delete_policy throws when the delete fails (was silent before)')

  // 5. update_availability — the replace_all wipe
  const av = { employee_id: 'e1', employee_name: 'Maria' }
  expect(await resolves(() => runReplaceAvailability(makeFakeSupabase([OK]), av)),
    'update_availability wipe succeeds when the delete succeeds')
  expect(await throwsPersist(() => runReplaceAvailability(makeFakeSupabase([FAIL('boom')]), av), "clear Maria's existing availability"),
    'update_availability throws when the replace-all wipe fails (was silent before)')

  // 6. set_custom_availability — the deactivate step
  expect(await resolves(() => runSetCustomAvailability(makeFakeSupabase([OK]), av)),
    'set_custom_availability deactivate succeeds when the update succeeds')
  expect(await throwsPersist(() => runSetCustomAvailability(makeFakeSupabase([FAIL('boom')]), av), "clear Maria's previous custom availability"),
    'set_custom_availability throws when the deactivate fails (was silent before)')

  if (failures > 0) {
    console.error(`\n${failures} check(s) failed.`)
    process.exit(1)
  } else {
    console.log('\nAll persistGuard checks passed.')
  }
}

main()
