import * as dotenv from 'dotenv'
import * as path from 'path'
dotenv.config({ path: path.resolve(process.cwd(), '.env.local') })

import { createClient } from '@supabase/supabase-js'

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
)

// ── Helpers ───────────────────────────────────────────────────────────────────

function addDays(d: Date, n: number): Date {
  const r = new Date(d)
  r.setDate(r.getDate() + n)
  return r
}

function isoDate(d: Date): string {
  return d.toISOString().split('T')[0]
}

function weekStart(d: Date = new Date()): Date {
  const r = new Date(d)
  r.setDate(r.getDate() - r.getDay())
  r.setHours(0, 0, 0, 0)
  return r
}

function must<T>(
  label: string,
  result: { data: T | null; error: { message: string } | null },
): T {
  if (result.error) {
    console.error(`  ❌ ${label}: ${result.error.message}`)
    process.exit(1)
  }
  return result.data as T
}

async function clear(table: string, companyId: string) {
  const { error } = await supabase.from(table).delete().eq('company_id', companyId)
  if (error) console.warn(`  ⚠  ${table}: ${error.message}`)
  else console.log(`  cleared ${table}`)
}

// ── Main ──────────────────────────────────────────────────────────────────────

async function main() {
  const now = new Date()
  console.log('🌱  Seeding Watermark Country Club…\n')

  // ── Step 1: Find company ─────────────────────────────────────────────────
  console.log('Step 1 — Finding Watermark company…')
  const { data: companies, error: compErr } = await supabase
    .from('companies').select('id, name').ilike('name', '%watermark%').limit(1)
  if (compErr || !companies?.length) {
    console.error('❌  Watermark company not found. Create it in the app first.')
    process.exit(1)
  }
  const cid = companies[0].id
  console.log(`  ✅  ${companies[0].name} — ${cid}\n`)

  // ── Step 2: Clear existing data ──────────────────────────────────────────
  console.log('Step 2 — Clearing existing data…')
  for (const t of [
    'activity_log', 'swap_requests', 'time_off_requests',
    'availability', 'employee_conflicts', 'shift_requirements',
    'shift_types', 'employees', 'roles', 'policies', 'wage_rates',
    'events', 'schedules',
  ]) await clear(t, cid)

  // ── Step 3: Roles ────────────────────────────────────────────────────────
  console.log('\nStep 3 — Inserting roles…')
  const rolesInserted = must('roles', await supabase.from('roles').insert([
    { company_id: cid, name: 'Lifeguard',         color: '#10b981' },
    { company_id: cid, name: 'Headguard',         color: '#f97316' },
    { company_id: cid, name: 'Greeter',           color: '#3b82f6' },
    { company_id: cid, name: 'Assistant Manager', color: '#8b5cf6' },
    { company_id: cid, name: 'Manager',           color: '#ef4444' },
  ]).select())
  console.log(`  ✅  ${rolesInserted.length} roles`)

  // ── Step 4: Wage rates ───────────────────────────────────────────────────
  console.log('\nStep 4 — Inserting wage rates…')
  const wagesInserted = must('wage_rates', await supabase.from('wage_rates').insert([
    { company_id: cid, role: 'Lifeguard',         hourly_rate: 14.00 },
    { company_id: cid, role: 'Headguard',         hourly_rate: 17.00 },
    { company_id: cid, role: 'Greeter',           hourly_rate: 13.00 },
    { company_id: cid, role: 'Assistant Manager', hourly_rate: 19.00 },
    { company_id: cid, role: 'Manager',           hourly_rate: 24.00 },
  ]).select())
  console.log(`  ✅  ${wagesInserted.length} wage rates`)

  // ── Step 5: Employees ────────────────────────────────────────────────────
  console.log('\nStep 5 — Inserting employees…')
  const empRows = must('employees', await supabase.from('employees').insert([
    // Managers
    { company_id: cid, name: 'Sarah Mitchell',  primary_role: 'Manager',           qualified_roles: ['Manager'],                    max_weekly_hours: 40, contact_email: 'sarah.mitchell@watermarkcc.com',  contact_phone: '+16165550101', active: true },
    { company_id: cid, name: 'James Kowalski',  primary_role: 'Manager',           qualified_roles: ['Manager'],                    max_weekly_hours: 40, contact_email: 'james.kowalski@watermarkcc.com',  contact_phone: '+16165550102', active: true },
    // Assistant Managers
    { company_id: cid, name: 'Rachel Torres',   primary_role: 'Assistant Manager', qualified_roles: ['Assistant Manager'],          max_weekly_hours: 40, contact_email: 'rachel.torres@watermarkcc.com',   contact_phone: '+16165550103', active: true, individual_wage: 20.50 },
    { company_id: cid, name: 'Derek Huang',     primary_role: 'Assistant Manager', qualified_roles: ['Assistant Manager'],          max_weekly_hours: 32, contact_email: 'derek.huang@watermarkcc.com',     contact_phone: '+16165550104', active: true },
    // Headguards
    { company_id: cid, name: 'Marcus Webb',     primary_role: 'Headguard',         qualified_roles: ['Headguard', 'Lifeguard'],     max_weekly_hours: 40, contact_email: 'marcus.webb@watermarkcc.com',     contact_phone: '+16165550105', active: true },
    { company_id: cid, name: 'Priya Nair',      primary_role: 'Headguard',         qualified_roles: ['Headguard', 'Lifeguard'],     max_weekly_hours: 32, contact_email: 'priya.nair@watermarkcc.com',      contact_phone: '+16165550106', active: true },
    { company_id: cid, name: 'Tyler Brooks',    primary_role: 'Headguard',         qualified_roles: ['Headguard', 'Lifeguard'],     max_weekly_hours: 40, contact_email: 'tyler.brooks@watermarkcc.com',    contact_phone: '+16165550107', active: true, individual_wage: 18.00 },
    // Lifeguards
    { company_id: cid, name: 'Jordan Casey',    primary_role: 'Lifeguard',         qualified_roles: ['Lifeguard'],                  max_weekly_hours: 40, contact_email: 'jordan.casey@watermarkcc.com',    contact_phone: '+16165550108', active: true },
    { company_id: cid, name: 'Aisha Johnson',   primary_role: 'Lifeguard',         qualified_roles: ['Lifeguard'],                  max_weekly_hours: 32, contact_email: 'aisha.johnson@watermarkcc.com',   contact_phone: '+16165550109', active: true },
    { company_id: cid, name: 'Connor Reid',     primary_role: 'Lifeguard',         qualified_roles: ['Lifeguard'],                  max_weekly_hours: 24, contact_email: 'connor.reid@watermarkcc.com',     contact_phone: '+16165550110', active: true },
    { company_id: cid, name: 'Zoe Patel',       primary_role: 'Lifeguard',         qualified_roles: ['Lifeguard'],                  max_weekly_hours: 40, contact_email: 'zoe.patel@watermarkcc.com',       contact_phone: '+16165550111', active: true },
    { company_id: cid, name: 'Noah Kim',        primary_role: 'Lifeguard',         qualified_roles: ['Lifeguard'],                  max_weekly_hours: 20, contact_email: 'noah.kim@watermarkcc.com',         contact_phone: '+16165550112', active: true },
    { company_id: cid, name: 'Lily Sanchez',    primary_role: 'Lifeguard',         qualified_roles: ['Lifeguard'],                  max_weekly_hours: 32, contact_email: 'lily.sanchez@watermarkcc.com',    contact_phone: '+16165550113', active: true },
    { company_id: cid, name: 'Ethan Moore',     primary_role: 'Lifeguard',         qualified_roles: ['Lifeguard'],                  max_weekly_hours: 40, contact_email: 'ethan.moore@watermarkcc.com',     contact_phone: '+16165550114', active: true },
    { company_id: cid, name: 'Maya Robinson',   primary_role: 'Lifeguard',         qualified_roles: ['Lifeguard'],                  max_weekly_hours: 24, contact_email: 'maya.robinson@watermarkcc.com',   contact_phone: '+16165550115', active: true, individual_wage: 14.75 },
    // Greeters
    { company_id: cid, name: 'Olivia Grant',    primary_role: 'Greeter',           qualified_roles: ['Greeter'],                    max_weekly_hours: 20, contact_email: 'olivia.grant@watermarkcc.com',    contact_phone: '+16165550116', active: true },
    { company_id: cid, name: 'Sam Fletcher',    primary_role: 'Greeter',           qualified_roles: ['Greeter'],                    max_weekly_hours: 24, contact_email: 'sam.fletcher@watermarkcc.com',    contact_phone: '+16165550117', active: true },
    { company_id: cid, name: 'Chloe Park',      primary_role: 'Greeter',           qualified_roles: ['Greeter'],                    max_weekly_hours: 20, contact_email: 'chloe.park@watermarkcc.com',      contact_phone: '+16165550118', active: true },
  ]).select())
  console.log(`  ✅  ${empRows.length} employees`)

  const byName = (n: string) => empRows.find((e: { name: string; id: string }) => e.name === n)!.id
  const E = {
    sarah:  byName('Sarah Mitchell'),
    james:  byName('James Kowalski'),
    rachel: byName('Rachel Torres'),
    derek:  byName('Derek Huang'),
    marcus: byName('Marcus Webb'),
    priya:  byName('Priya Nair'),
    tyler:  byName('Tyler Brooks'),
    jordan: byName('Jordan Casey'),
    aisha:  byName('Aisha Johnson'),
    connor: byName('Connor Reid'),
    zoe:    byName('Zoe Patel'),
    noah:   byName('Noah Kim'),
    lily:   byName('Lily Sanchez'),
    ethan:  byName('Ethan Moore'),
    maya:   byName('Maya Robinson'),
    olivia: byName('Olivia Grant'),
    sam:    byName('Sam Fletcher'),
    chloe:  byName('Chloe Park'),
  }

  // ── Step 6: Availability ─────────────────────────────────────────────────
  console.log('\nStep 6 — Inserting availability…')
  function avail(employee_id: string, days: number[], start: string, end: string) {
    return days.map(day_of_week => ({ company_id: cid, employee_id, day_of_week, start_time: start, end_time: end }))
  }
  const ALL = [0,1,2,3,4,5,6]
  const availRows = [
    ...avail(E.sarah,  ALL,          '09:00:00', '21:30:00'),
    ...avail(E.james,  ALL,          '09:00:00', '21:30:00'),
    ...avail(E.rachel, [1,2,3,4,5],  '09:00:00', '21:30:00'),
    ...avail(E.rachel, [6],          '09:00:00', '18:00:00'),
    ...avail(E.derek,  [1,3,5],      '10:00:00', '21:30:00'),
    ...avail(E.derek,  [0,6],        '09:00:00', '21:30:00'),
    ...avail(E.marcus, ALL,          '09:00:00', '21:30:00'),
    ...avail(E.priya,  [0,2,4,6],    '09:00:00', '21:30:00'),
    ...avail(E.tyler,  [1,2,3,5,6],  '09:00:00', '21:30:00'),
    ...avail(E.jordan, ALL,          '11:00:00', '21:30:00'),
    ...avail(E.aisha,  [0,1,3,5,6],  '11:00:00', '21:30:00'),
    ...avail(E.connor, [0,6],        '09:00:00', '21:30:00'),
    ...avail(E.zoe,    ALL,          '11:00:00', '21:30:00'),
    ...avail(E.noah,   [0,5,6],      '12:00:00', '21:30:00'),
    ...avail(E.lily,   [1,2,4,6],    '11:00:00', '21:30:00'),
    ...avail(E.ethan,  ALL,          '09:00:00', '21:30:00'),
    ...avail(E.maya,   [0,3,4,5,6],  '11:00:00', '21:30:00'),
    ...avail(E.olivia, [1,3,5],      '12:00:00', '18:00:00'),
    ...avail(E.sam,    [0,2,4,6],    '11:00:00', '18:30:00'),
    ...avail(E.chloe,  [0,6],        '09:00:00', '18:00:00'),
  ]
  const availInserted = must('availability', await supabase.from('availability').insert(availRows).select())
  console.log(`  ✅  ${availInserted.length} availability rows`)

  // ── Step 7: Employee conflicts ───────────────────────────────────────────
  console.log('\nStep 7 — Inserting employee conflicts…')
  const conflictsInserted = must('employee_conflicts', await supabase.from('employee_conflicts').insert([
    { company_id: cid, employee_id_1: E.marcus, employee_id_2: E.jordan, severity: 'never', reason: 'Recurring interpersonal conflict' },
    { company_id: cid, employee_id_1: E.noah,   employee_id_2: E.connor, severity: 'avoid', reason: 'Work better apart for focus' },
    { company_id: cid, employee_id_1: E.tyler,  employee_id_2: E.priya,  severity: 'avoid', reason: 'Scheduling preference' },
  ]).select())
  console.log(`  ✅  ${conflictsInserted.length} conflicts`)

  // ── Step 8: Shift types ──────────────────────────────────────────────────
  console.log('\nStep 8 — Inserting shift types…')
  const stRows = must('shift_types', await supabase.from('shift_types').insert([
    { company_id: cid, name: 'AM',         start_time: '11:30', end_time: '15:30', days_active: [1,2,3,4,5],       active: true },
    { company_id: cid, name: 'AM Weekend', start_time: '09:30', end_time: '15:30', days_active: [0,6],             active: true },
    { company_id: cid, name: 'PM',         start_time: '15:00', end_time: '21:00', days_active: [0,1,2,3,4,5,6],  active: true },
    { company_id: cid, name: 'Flex',       start_time: '13:00', end_time: '21:00', days_active: [0,1,2,3,4,5,6],  active: true },
    { company_id: cid, name: 'Day',        start_time: '12:00', end_time: '18:00', days_active: [0,1,2,3,4,5,6],  active: true },
  ]).select())
  console.log(`  ✅  ${stRows.length} shift types`)
  const stId = (n: string) => stRows.find((r: { name: string; id: string }) => r.name === n)!.id

  // ── Step 9: Shift requirements ───────────────────────────────────────────
  console.log('\nStep 9 — Inserting shift requirements…')
  const reqInserted = must('shift_requirements', await supabase.from('shift_requirements').insert([
    // AM (weekday)
    { company_id: cid, shift_type_id: stId('AM'), shift_name: 'AM', role: 'Lifeguard', required_count: 2, start_time: '11:30', end_time: '15:30', days_active: [1,2,3,4,5] },
    { company_id: cid, shift_type_id: stId('AM'), shift_name: 'AM', role: 'Headguard', required_count: 1, start_time: '11:30', end_time: '15:30', days_active: [1,2,3,4,5] },
    { company_id: cid, shift_type_id: stId('AM'), shift_name: 'AM', role: 'Greeter',   required_count: 1, start_time: '11:30', end_time: '15:30', days_active: [1,2,3,4,5] },
    // AM Weekend
    { company_id: cid, shift_type_id: stId('AM Weekend'), shift_name: 'AM Weekend', role: 'Lifeguard', required_count: 3, start_time: '09:30', end_time: '15:30', days_active: [0,6] },
    { company_id: cid, shift_type_id: stId('AM Weekend'), shift_name: 'AM Weekend', role: 'Headguard', required_count: 1, start_time: '09:30', end_time: '15:30', days_active: [0,6] },
    { company_id: cid, shift_type_id: stId('AM Weekend'), shift_name: 'AM Weekend', role: 'Greeter',   required_count: 1, start_time: '09:30', end_time: '15:30', days_active: [0,6] },
    // PM
    { company_id: cid, shift_type_id: stId('PM'), shift_name: 'PM', role: 'Lifeguard', required_count: 2, start_time: '15:00', end_time: '21:00', days_active: [0,1,2,3,4,5,6] },
    { company_id: cid, shift_type_id: stId('PM'), shift_name: 'PM', role: 'Headguard', required_count: 1, start_time: '15:00', end_time: '21:00', days_active: [0,1,2,3,4,5,6] },
    { company_id: cid, shift_type_id: stId('PM'), shift_name: 'PM', role: 'Greeter',   required_count: 1, start_time: '15:00', end_time: '21:00', days_active: [0,1,2,3,4,5,6] },
    // Flex
    { company_id: cid, shift_type_id: stId('Flex'), shift_name: 'Flex', role: 'Lifeguard', required_count: 1, start_time: '13:00', end_time: '21:00', days_active: [0,1,2,3,4,5,6] },
    { company_id: cid, shift_type_id: stId('Flex'), shift_name: 'Flex', role: 'Headguard', required_count: 1, start_time: '13:00', end_time: '21:00', days_active: [0,1,2,3,4,5,6] },
    // Day
    { company_id: cid, shift_type_id: stId('Day'), shift_name: 'Day', role: 'Lifeguard', required_count: 2, start_time: '12:00', end_time: '18:00', days_active: [0,1,2,3,4,5,6] },
    { company_id: cid, shift_type_id: stId('Day'), shift_name: 'Day', role: 'Greeter',   required_count: 1, start_time: '12:00', end_time: '18:00', days_active: [0,1,2,3,4,5,6] },
  ]).select())
  console.log(`  ✅  ${reqInserted.length} shift requirements`)

  // ── Step 10: Policies ────────────────────────────────────────────────────
  console.log('\nStep 10 — Inserting policies…')
  const policiesInserted = must('policies', await supabase.from('policies').insert([
    { company_id: cid, policy_key: 'min_notice_period_days',    policy_value: '3',    policy_type: 'time_off',   description: 'Employees must request time off at least 3 days in advance', version: 1 },
    { company_id: cid, policy_key: 'max_consecutive_days_off',  policy_value: '5',    policy_type: 'time_off',   description: 'No more than 5 consecutive days off approved', version: 1 },
    { company_id: cid, policy_key: 'max_staff_off_percent',     policy_value: '25',   policy_type: 'time_off',   description: 'No more than 25% of staff approved off on any single day', version: 1 },
    { company_id: cid, policy_key: 'no_to_prime_weekends',      policy_value: 'true', policy_type: 'time_off',   description: 'Time off not approved for holiday weekends without manager override', version: 1 },
    { company_id: cid, policy_key: 'headguard_overlap_needed',  policy_value: 'true', policy_type: 'coverage',   description: 'At least one headguard must be present at all times during operating hours', version: 1 },
    { company_id: cid, policy_key: 'always_one_manager_on_duty',policy_value: 'true', policy_type: 'scheduling', description: 'A manager or assistant manager must be scheduled on every shift', version: 1 },
  ]).select())
  console.log(`  ✅  ${policiesInserted.length} policies`)

  // ── Step 11: Time off requests ───────────────────────────────────────────
  console.log('\nStep 11 — Inserting time off requests…')
  const nextWeekMon  = addDays(now, 7 - now.getDay() + 1)
  const twoWeeks     = addDays(now, 14)
  const threeWeeks   = addDays(now, 21)
  const fourWeeks    = addDays(now, 28)

  const torInserted = must('time_off_requests', await supabase.from('time_off_requests').insert([
    { company_id: cid, employee_id: E.jordan, start_date: isoDate(nextWeekMon), end_date: isoDate(addDays(nextWeekMon, 2)), reason: 'Family vacation',    status: 'pending',  requested_at: now.toISOString(), decided_at: null,               decided_by: null, aegis_recommendation: null,      aegis_reasoning: null },
    { company_id: cid, employee_id: E.aisha,  start_date: isoDate(twoWeeks),    end_date: isoDate(twoWeeks),               reason: 'Medical appointment', status: 'approved', requested_at: now.toISOString(), decided_at: now.toISOString(),  decided_by: null, aegis_recommendation: 'approve', aegis_reasoning: 'Coverage looks healthy on this date. Two other lifeguards are available and no other time off is approved. Recommend approval.' },
    { company_id: cid, employee_id: E.noah,   start_date: isoDate(threeWeeks),  end_date: isoDate(addDays(threeWeeks, 1)), reason: 'Out of town',         status: 'approved', requested_at: now.toISOString(), decided_at: now.toISOString(),  decided_by: null, aegis_recommendation: null,      aegis_reasoning: null },
    { company_id: cid, employee_id: E.lily,   start_date: isoDate(nextWeekMon), end_date: isoDate(nextWeekMon),            reason: 'Personal day',        status: 'denied',   requested_at: now.toISOString(), decided_at: now.toISOString(),  decided_by: null, aegis_recommendation: 'deny',    aegis_reasoning: 'This date falls during a high traffic period with limited lifeguard availability. Approving would leave only one qualified lifeguard on the AM shift. Recommend denial.' },
    { company_id: cid, employee_id: E.zoe,    start_date: isoDate(fourWeeks),   end_date: isoDate(addDays(fourWeeks, 3)),  reason: 'Summer trip',         status: 'pending',  requested_at: now.toISOString(), decided_at: null,               decided_by: null, aegis_recommendation: null,      aegis_reasoning: null },
    { company_id: cid, employee_id: E.connor, start_date: isoDate(twoWeeks),    end_date: isoDate(addDays(twoWeeks, 1)),   reason: 'Family event',        status: 'approved', requested_at: now.toISOString(), decided_at: now.toISOString(),  decided_by: null, aegis_recommendation: 'approve', aegis_reasoning: 'Weekend request with sufficient coverage. No staffing conflicts identified.' },
  ]).select())
  console.log(`  ✅  ${torInserted.length} time off requests`)

  // ── Step 12: Swap requests ───────────────────────────────────────────────
  console.log('\nStep 12 — Inserting swap requests…')
  const ws = weekStart(now)
  const thisSat   = addDays(ws, 6)
  const nextMon   = addDays(ws, 8)
  const nextWed   = addDays(ws, 10)

  const swapInserted = must('swap_requests', await supabase.from('swap_requests').insert([
    { company_id: cid, requesting_employee_id: E.jordan, receiving_employee_id: E.marcus, shift_date: isoDate(thisSat), shift_name: 'PM', role: 'Lifeguard', status: 'pending_manager',  initiated_by: 'employee', created_at: now.toISOString(), updated_at: now.toISOString() },
    { company_id: cid, requesting_employee_id: E.ethan,  receiving_employee_id: E.tyler,  shift_date: isoDate(nextMon), shift_name: 'AM', role: 'Lifeguard', status: 'approved',         initiated_by: 'employee', created_at: now.toISOString(), updated_at: now.toISOString() },
    { company_id: cid, requesting_employee_id: E.maya,   receiving_employee_id: null,     shift_date: isoDate(nextWed), shift_name: 'PM', role: 'Lifeguard', status: 'pending_employee', initiated_by: 'aegis',    created_at: now.toISOString(), updated_at: now.toISOString() },
  ]).select())
  console.log(`  ✅  ${swapInserted.length} swap requests`)

  // ── Step 13: Events ──────────────────────────────────────────────────────
  console.log('\nStep 13 — Inserting events…')
  const yr = now.getFullYear()
  const july4 = new Date(yr, 6, 4) < now ? new Date(yr + 1, 6, 4) : new Date(yr, 6, 4)

  const eventsInserted = must('events', await supabase.from('events').insert([
    {
      company_id: cid,
      title: 'Fourth of July Weekend',
      date: isoDate(july4),
      end_date: isoDate(addDays(july4, 2)),
      staffing_notes: 'Expect 40% higher attendance. Add extra lifeguard coverage to all PM shifts. No time off approved.',
      shift_overrides: { PM: { Lifeguard: 3 } },
    },
    {
      company_id: cid,
      title: 'Pool Deck Maintenance',
      date: isoDate(addDays(now, 10)),
      end_date: isoDate(addDays(now, 11)),
      staffing_notes: 'Pool deck closed. Reduced capacity. AM shift may need only 1 lifeguard.',
      shift_overrides: { AM: { Lifeguard: 1 } },
    },
  ]).select())
  console.log(`  ✅  ${eventsInserted.length} events`)

  // ── Step 14: Schedule ────────────────────────────────────────────────────
  console.log('\nStep 14 — Building and inserting schedule…')

  // Week date strings: days[0]=Sun … days[6]=Sat
  const days = Array.from({ length: 7 }, (_, i) => isoDate(addDays(ws, i)))

  // hours per shift name
  const SH: Record<string, number> = { 'AM': 4, 'AM Weekend': 6, 'PM': 6, 'Flex': 8, 'Day': 6 }

  // employee name lookup
  const ename = (id: string) =>
    empRows.find((e: { id: string; name: string }) => e.id === id)!.name

  // build one assignment row
  function a(date: string, shift_name: string, role: string, id: string, st: string, et: string) {
    return { date, shift_name, role, employee_id: id, employee_name: ename(id), start_time: st, end_time: et, hours: SH[shift_name] ?? 0 }
  }

  const assignments = [
    // ── SUNDAY ────────────────────────────────────────────────────────────
    // AM Weekend: 3 LG + 1 HG + 1 Greeter (Connor available Sun)
    a(days[0], 'AM Weekend', 'Headguard', E.priya,  '09:30', '15:30'),
    a(days[0], 'AM Weekend', 'Lifeguard', E.aisha,  '09:30', '15:30'),
    a(days[0], 'AM Weekend', 'Lifeguard', E.connor, '09:30', '15:30'),
    a(days[0], 'AM Weekend', 'Lifeguard', E.ethan,  '09:30', '15:30'),
    a(days[0], 'AM Weekend', 'Greeter',   E.sam,    '09:30', '15:30'),
    // PM: 2 LG + 1 HG + 1 Greeter + assistant manager on duty
    // Marcus OK — Jordan not in same shift (conflict rule: never together)
    a(days[0], 'PM', 'Headguard',         E.marcus, '15:00', '21:00'),
    a(days[0], 'PM', 'Lifeguard',         E.maya,   '15:00', '21:00'),
    a(days[0], 'PM', 'Lifeguard',         E.zoe,    '15:00', '21:00'),
    a(days[0], 'PM', 'Greeter',           E.chloe,  '15:00', '21:00'),
    a(days[0], 'PM', 'Assistant Manager', E.derek,  '15:00', '21:00'),
    // Day: 2 LG  [GAP: 1 Greeter — Sam in AM Weekend, Chloe in PM, Olivia not available Sundays]
    a(days[0], 'Day', 'Lifeguard', E.noah,   '12:00', '18:00'),
    a(days[0], 'Day', 'Lifeguard', E.jordan, '12:00', '18:00'),

    // ── MONDAY ────────────────────────────────────────────────────────────
    // AM: 2 LG + 1 HG + 1 Greeter + manager on duty
    a(days[1], 'AM', 'Headguard', E.tyler,  '11:30', '15:30'),
    a(days[1], 'AM', 'Lifeguard', E.lily,   '11:30', '15:30'),
    a(days[1], 'AM', 'Lifeguard', E.aisha,  '11:30', '15:30'),
    a(days[1], 'AM', 'Greeter',   E.olivia, '11:30', '15:30'),
    a(days[1], 'AM', 'Manager',   E.sarah,  '11:30', '15:30'),
    // PM: 2 LG + 1 HG + 1 Greeter (Sam available Mon)
    a(days[1], 'PM', 'Headguard', E.marcus, '15:00', '21:00'),
    a(days[1], 'PM', 'Lifeguard', E.ethan,  '15:00', '21:00'),
    a(days[1], 'PM', 'Lifeguard', E.jordan, '15:00', '21:00'),
    a(days[1], 'PM', 'Greeter',   E.sam,    '15:00', '21:00'),

    // ── TUESDAY ───────────────────────────────────────────────────────────
    // AM: 2 LG + 1 HG + 1 Greeter (Sam available Tue)
    a(days[2], 'AM', 'Headguard', E.tyler, '11:30', '15:30'),
    a(days[2], 'AM', 'Lifeguard', E.lily,  '11:30', '15:30'),
    a(days[2], 'AM', 'Lifeguard', E.zoe,   '11:30', '15:30'),
    a(days[2], 'AM', 'Greeter',   E.sam,   '11:30', '15:30'),
    // PM: 2 LG + 1 HG + 1 Greeter (Olivia not available Tue; Chloe not available Tue; no greeter)
    a(days[2], 'PM', 'Headguard', E.priya, '15:00', '21:00'),
    a(days[2], 'PM', 'Lifeguard', E.ethan, '15:00', '21:00'),
    a(days[2], 'PM', 'Lifeguard', E.maya,  '15:00', '21:00'),

    // ── WEDNESDAY ─────────────────────────────────────────────────────────
    // AM: 2 LG + 1 HG + 1 Greeter + assistant manager on duty
    a(days[3], 'AM', 'Headguard',         E.tyler,  '11:30', '15:30'),
    a(days[3], 'AM', 'Lifeguard',         E.zoe,    '11:30', '15:30'),
    a(days[3], 'AM', 'Lifeguard',         E.aisha,  '11:30', '15:30'),
    a(days[3], 'AM', 'Greeter',           E.olivia, '11:30', '15:30'),
    a(days[3], 'AM', 'Assistant Manager', E.rachel, '11:30', '15:30'),
    // PM: 1 LG + 1 HG  [GAP: 2nd Lifeguard — limited Wed availability after AM shift draws]
    // Note: Jordan excluded (conflict with Marcus); Ethan, Zoe, Aisha in AM; Maya available
    // Maya available Wed (day 3) ✓ → fills slot 1; Lily not available Wed → gap slot 2
    a(days[3], 'PM', 'Headguard', E.marcus, '15:00', '21:00'),
    a(days[3], 'PM', 'Lifeguard', E.maya,   '15:00', '21:00'),

    // ── THURSDAY ──────────────────────────────────────────────────────────
    // AM: 2 LG + 1 HG + 1 Greeter (Olivia available Thu)
    a(days[4], 'AM', 'Headguard', E.priya,  '11:30', '15:30'),
    a(days[4], 'AM', 'Lifeguard', E.lily,   '11:30', '15:30'),
    a(days[4], 'AM', 'Lifeguard', E.zoe,    '11:30', '15:30'),
    a(days[4], 'AM', 'Greeter',   E.olivia, '11:30', '15:30'),
    // PM: 2 LG + 1 HG + 1 Greeter (Sam available Thu)
    a(days[4], 'PM', 'Headguard', E.marcus, '15:00', '21:00'),
    a(days[4], 'PM', 'Lifeguard', E.ethan,  '15:00', '21:00'),
    a(days[4], 'PM', 'Lifeguard', E.jordan, '15:00', '21:00'),
    a(days[4], 'PM', 'Greeter',   E.sam,    '15:00', '21:00'),

    // ── FRIDAY ────────────────────────────────────────────────────────────
    // AM: 2 LG + 1 HG + 1 Greeter (Olivia available Fri)
    a(days[5], 'AM', 'Headguard', E.tyler,  '11:30', '15:30'),
    a(days[5], 'AM', 'Lifeguard', E.aisha,  '11:30', '15:30'),
    a(days[5], 'AM', 'Lifeguard', E.lily,   '11:30', '15:30'),
    a(days[5], 'AM', 'Greeter',   E.olivia, '11:30', '15:30'),
    // PM: 2 LG + 1 HG (no greeter available Fri PM — Olivia in AM, Sam/Chloe not Fri)
    a(days[5], 'PM', 'Headguard', E.marcus, '15:00', '21:00'),
    a(days[5], 'PM', 'Lifeguard', E.noah,   '15:00', '21:00'),
    a(days[5], 'PM', 'Lifeguard', E.maya,   '15:00', '21:00'),

    // ── SATURDAY ──────────────────────────────────────────────────────────
    // AM Weekend: 3 LG + 1 HG + 1 Greeter + manager on duty
    a(days[6], 'AM Weekend', 'Headguard', E.tyler,  '09:30', '15:30'),
    a(days[6], 'AM Weekend', 'Lifeguard', E.jordan, '09:30', '15:30'),
    a(days[6], 'AM Weekend', 'Lifeguard', E.connor, '09:30', '15:30'),
    a(days[6], 'AM Weekend', 'Lifeguard', E.aisha,  '09:30', '15:30'),
    a(days[6], 'AM Weekend', 'Greeter',   E.sam,    '09:30', '15:30'),
    a(days[6], 'AM Weekend', 'Manager',   E.james,  '09:30', '15:30'),
    // PM: 2 LG + 1 HG + 1 Greeter
    a(days[6], 'PM', 'Headguard', E.priya, '15:00', '21:00'),
    a(days[6], 'PM', 'Lifeguard', E.lily,  '15:00', '21:00'),
    a(days[6], 'PM', 'Lifeguard', E.ethan, '15:00', '21:00'),
    a(days[6], 'PM', 'Greeter',   E.chloe, '15:00', '21:00'),
  ]

  // Sanity log — verify shift_name strings match the canonical names used by
  // shift_types and the schedule template (otherwise rows render empty).
  console.log('  first 5 assignments:')
  for (const row of assignments.slice(0, 5)) {
    console.log(`    ${row.date}  ${row.shift_name.padEnd(10)} ${row.role.padEnd(18)} ${row.employee_name}`)
  }
  const distinctShifts = Array.from(new Set(assignments.map(r => r.shift_name)))
  console.log(`  distinct shift_names: ${JSON.stringify(distinctShifts)}`)

  // Exactly 2 intentional gaps (as required)
  const gaps = [
    {
      date: days[0],
      shift_name: 'Day',
      role: 'Greeter',
      required_count: 1,
      filled_count: 0,
      reason: 'No greeter available Sunday',
    },
    {
      date: days[3],
      shift_name: 'PM',
      role: 'Lifeguard',
      required_count: 2,
      filled_count: 1,
      reason: 'Lifeguard availability limited Wednesday',
    },
  ]

  // Compute hours per employee from assignments
  const hrs: Record<string, number> = {}
  for (const row of assignments) {
    hrs[row.employee_id] = (hrs[row.employee_id] ?? 0) + row.hours
  }

  // Hourly rates (individual_wage takes precedence)
  const baseRate: Record<string, number> = {
    'Manager': 24, 'Assistant Manager': 19, 'Headguard': 17, 'Lifeguard': 14, 'Greeter': 13,
  }
  const individualWage: Record<string, number> = {
    [E.rachel]: 20.50, [E.tyler]: 18.00, [E.maya]: 14.75,
  }
  const empRole: Record<string, string> = {}
  for (const e of empRows) empRole[e.id] = e.primary_role

  function rate(id: string): number {
    return individualWage[id] ?? baseRate[empRole[id]] ?? 14
  }

  // Build wages breakdown
  const byEmployee = Object.entries(hrs).map(([employee_id, h]) => ({
    employee_id,
    employee_name: ename(employee_id),
    hours: h,
    hourly_rate: rate(employee_id),
    estimated_pay: parseFloat((h * rate(employee_id)).toFixed(2)),
  })).sort((a, b) => b.hours - a.hours)

  const totalEstimated = parseFloat(byEmployee.reduce((s, e) => s + e.estimated_pay, 0).toFixed(2))

  // Top contributors
  const topContributors = [...byEmployee]
    .sort((a, b) => b.hours - a.hours)
    .slice(0, 5)
    .map(({ employee_id, employee_name, hours }) => ({ employee_id, name: employee_name, hours }))

  // Bottom contributors — fewest hours, including any active employee with zero
  const allActiveByHours = empRows.map((e: { id: string; name: string }) => ({
    employee_id: e.id,
    name: e.name,
    hours: hrs[e.id] ?? 0,
  }))
  const bottomContributors = [...allActiveByHours]
    .sort((a, b) => a.hours - b.hours)
    .slice(0, 3)

  // Overtime risk (employees scheduled > 36h relative to their max)
  const overtimeRisk = byEmployee
    .filter(e => e.hours > 36)
    .map(e => {
      const emp = empRows.find((r: { id: string }) => r.id === e.employee_id)
      return { employee_id: e.employee_id, name: e.employee_name, hours: e.hours, max_hours: emp?.max_weekly_hours ?? 40 }
    })

  const staffingReport = {
    coverage_rate: 90,
    top_contributors: topContributors,
    bottom_contributors: bottomContributors,
    overtime_risk: overtimeRisk,
    gap_summary: '2 gaps this week: Sunday Day shift missing 1 Greeter; Wednesday PM shift missing 2nd Lifeguard due to limited Wednesday availability.',
    special_notes_applied: [],
    aegis_notes: 'Schedule built respecting all availability windows and the Marcus Webb / Jordan Casey conflict (never-together rule). Sunday Day greeter gap is structural — no greeters are available. Wednesday PM lifeguard gap due to AM shift drawing down available pool.',
    estimated_wages: {
      total_estimated: totalEstimated,
      by_employee: byEmployee,
    },
  }

  const scheduleInserted = must('schedules', await supabase.from('schedules').insert({
    company_id: cid,
    week_start: days[0],
    week_end: days[6],
    status: 'published',
    generated_by: 'aegis',
    generated_at: now.toISOString(),
    approved_at: now.toISOString(),
    distributed_at: null,
    data: { assignments, gaps, summary: `Schedule built for ${days[0]} – ${days[6]}. ${assignments.length} assignments across 7 days, 87.5% coverage, 2 greeter gaps. Jordan Casey at 38h — approaching overtime threshold.` },
    staffing_report: staffingReport,
  }).select())
  console.log(`  ✅  Schedule (${assignments.length} assignments, ${gaps.length} gaps, $${totalEstimated.toLocaleString()} estimated wages)`)

  // ── Step 15: Activity log ────────────────────────────────────────────────
  console.log('\nStep 15 — Inserting activity log…')
  const aishaTorDate = isoDate(twoWeeks)
  const logInserted = must('activity_log', await supabase.from('activity_log').insert([
    { company_id: cid, actor: 'aegis',   action: 'schedule_built',                entity_type: 'schedule', entity_id: scheduleInserted[0].id, summary: `Schedule built for current week: 87.5% coverage, 2 gaps`, metadata: { week_start: days[0], coverage_rate: 87.5, gap_count: 2 }, created_at: now.toISOString() },
    { company_id: cid, actor: 'aegis',   action: 'time_off_approved',              entity_type: 'employee', entity_id: E.aisha,  summary: `Aisha Johnson time off approved for ${aishaTorDate}`, metadata: { employee_id: E.aisha, date: aishaTorDate }, created_at: addDays(now, -1).toISOString() },
    { company_id: cid, actor: 'manager', action: 'time_off_denied',               entity_type: 'employee', entity_id: E.lily,   summary: 'Lily Sanchez time off request denied', metadata: { employee_id: E.lily }, created_at: addDays(now, -1).toISOString() },
    { company_id: cid, actor: 'aegis',   action: 'emergency_coverage_requested',  entity_type: 'employee', entity_id: E.jordan, summary: 'Coverage needed: Jordan Casey called out sick', metadata: { employee_id: E.jordan, shift: 'PM' }, created_at: addDays(now, -2).toISOString() },
    { company_id: cid, actor: 'aegis',   action: 'swap_approved',                 entity_type: 'employee', entity_id: E.ethan,  summary: 'Swap approved: Ethan Moore and Tyler Brooks Monday AM', metadata: { requester_id: E.ethan, target_id: E.tyler }, created_at: addDays(now, -2).toISOString() },
    { company_id: cid, actor: 'aegis',   action: 'schedule_distributed',          entity_type: 'schedule', entity_id: scheduleInserted[0].id, summary: 'Schedule distributed to 18 employees', metadata: { employee_count: 18 }, created_at: addDays(now, -3).toISOString() },
    { company_id: cid, actor: 'system',  action: 'onboarding_complete',           entity_type: 'employee', entity_id: E.marcus, summary: 'Marcus Webb completed onboarding', metadata: { employee_id: E.marcus }, created_at: addDays(now, -5).toISOString() },
    { company_id: cid, actor: 'manager', action: 'employee_updated',              entity_type: 'employee', entity_id: E.rachel, summary: 'Rachel Torres wage updated to $20.50/hr', metadata: { employee_id: E.rachel, field: 'individual_wage', value: 20.50 }, created_at: addDays(now, -6).toISOString() },
    { company_id: cid, actor: 'aegis',   action: 'payroll_check_clean',           entity_type: null,       entity_id: null,     summary: 'Payroll check complete — all 18 employees clean', metadata: { employee_count: 18, issue_count: 0, clean_count: 18 }, created_at: addDays(now, -7).toISOString() },
    { company_id: cid, actor: 'aegis',   action: 'swap_pending_manager',          entity_type: 'employee', entity_id: E.jordan, summary: 'Jordan Casey and Marcus Webb swap pending manager approval', metadata: { requester_id: E.jordan, target_id: E.marcus }, created_at: addDays(now, -1).toISOString() },
  ]).select())
  console.log(`  ✅  ${logInserted.length} activity log entries`)

  // ── Summary ──────────────────────────────────────────────────────────────
  console.log(`
╔══════════════════════════════════════════════════════╗
║          Watermark Seed Complete ✅                  ║
╠══════════════════════════════════════════════════════╣
║  Roles              ${String(rolesInserted.length).padEnd(32)}║
║  Wage rates         ${String(wagesInserted.length).padEnd(32)}║
║  Employees          ${String(empRows.length).padEnd(32)}║
║  Availability rows  ${String(availInserted.length).padEnd(32)}║
║  Conflicts          ${String(conflictsInserted.length).padEnd(32)}║
║  Shift types        ${String(stRows.length).padEnd(32)}║
║  Shift requirements ${String(reqInserted.length).padEnd(32)}║
║  Policies           ${String(policiesInserted.length).padEnd(32)}║
║  Time off requests  ${String(torInserted.length).padEnd(32)}║
║  Swap requests      ${String(swapInserted.length).padEnd(32)}║
║  Events             ${String(eventsInserted.length).padEnd(32)}║
║  Schedule           1 (${assignments.length} assignments, ${gaps.length} gaps)${' '.repeat(Math.max(0, 17 - String(assignments.length).length - String(gaps.length).length))}║
║  Activity log       ${String(logInserted.length).padEnd(32)}║
╚══════════════════════════════════════════════════════╝
`)
}

main().catch(err => {
  console.error('Fatal:', err)
  process.exit(1)
})
