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

async function purge(table: string, companyId: string, deletions: Record<string, number>) {
  const { count, error } = await supabase
    .from(table).delete({ count: 'exact' }).eq('company_id', companyId)
  if (error) {
    console.warn(`  ⚠  ${table}: ${error.message}`)
    deletions[table] = -1
    return
  }
  const removed = count ?? 0
  deletions[table] = removed
  console.log(`  cleared ${table}  (${removed} rows)`)
}

// ── Main ──────────────────────────────────────────────────────────────────────

async function main() {
  const now = new Date()
  console.log('🔄  Resetting Watermark Country Club placeholder data…\n')

  // ── Find company ─────────────────────────────────────────────────────────
  console.log('Finding Watermark company…')
  const { data: companies, error: compErr } = await supabase
    .from('companies').select('id, name').ilike('name', '%watermark%').limit(1)
  if (compErr || !companies?.length) {
    console.error('❌  Watermark company not found.')
    process.exit(1)
  }
  const cid = companies[0].id
  console.log(`  ✅  ${companies[0].name} — ${cid}\n`)

  // ╔══════════════════════════════════════════════════════════════════════╗
  // ║                         PART 1: CLEAN                                ║
  // ╚══════════════════════════════════════════════════════════════════════╝
  console.log('PART 1 — Removing placeholder data (FK-safe order)…')
  const deletions: Record<string, number> = {}
  for (const t of [
    'activity_log',
    'swap_requests',
    'time_off_requests',
    'availability',
    'employee_conflicts',
    'schedules',
    'events',
    'aegis_memory',
    'employees',
  ]) {
    await purge(t, cid, deletions)
  }

  // ╔══════════════════════════════════════════════════════════════════════╗
  // ║                    PART 2: SEED 20 EMPLOYEES                         ║
  // ╚══════════════════════════════════════════════════════════════════════╝
  console.log('\nPART 2 — Inserting 20 employees…')

  type EmpInsert = {
    company_id: string
    name: string
    primary_role: string
    qualified_roles: string[]
    max_weekly_hours: number
    contact_email: string
    contact_phone: string
    individual_wage?: number
    active: boolean
  }

  const employees: EmpInsert[] = [
    // Managers (2)
    { company_id: cid, name: 'Brennan Schaefer',   primary_role: 'Manager',           qualified_roles: ['Manager'],                                max_weekly_hours: 40, contact_email: 'brennan.schaefer@watermarkcc.com',   contact_phone: '+16165550200', active: true },
    { company_id: cid, name: 'Madison Whitmore',   primary_role: 'Manager',           qualified_roles: ['Manager'],                                max_weekly_hours: 40, contact_email: 'madison.whitmore@watermarkcc.com',   contact_phone: '+16165550201', active: true },
    // Assistant Managers (2)
    { company_id: cid, name: 'Jackson Pierce',     primary_role: 'Assistant Manager', qualified_roles: ['Assistant Manager'],                      max_weekly_hours: 40, contact_email: 'jackson.pierce@watermarkcc.com',     contact_phone: '+16165550202', active: true, individual_wage: 21.00 },
    { company_id: cid, name: 'Reese Donovan',      primary_role: 'Assistant Manager', qualified_roles: ['Assistant Manager'],                      max_weekly_hours: 32, contact_email: 'reese.donovan@watermarkcc.com',      contact_phone: '+16165550203', active: true },
    // Headguards (4)
    { company_id: cid, name: 'Cole Anderson',      primary_role: 'Headguard',         qualified_roles: ['Headguard', 'Lifeguard'],                 max_weekly_hours: 40, contact_email: 'cole.anderson@watermarkcc.com',      contact_phone: '+16165550204', active: true },
    { company_id: cid, name: 'Brooklyn Hayes',     primary_role: 'Headguard',         qualified_roles: ['Headguard', 'Lifeguard'],                 max_weekly_hours: 32, contact_email: 'brooklyn.hayes@watermarkcc.com',     contact_phone: '+16165550205', active: true },
    { company_id: cid, name: 'Carter Lindstrom',   primary_role: 'Headguard',         qualified_roles: ['Headguard', 'Lifeguard'],                 max_weekly_hours: 40, contact_email: 'carter.lindstrom@watermarkcc.com',   contact_phone: '+16165550206', active: true, individual_wage: 18.25 },
    { company_id: cid, name: 'Jasmine Reilly',     primary_role: 'Headguard',         qualified_roles: ['Headguard', 'Lifeguard'],                 max_weekly_hours: 24, contact_email: 'jasmine.reilly@watermarkcc.com',     contact_phone: '+16165550207', active: true },
    // Lifeguards (9)
    { company_id: cid, name: 'Logan VanDyke',      primary_role: 'Lifeguard',         qualified_roles: ['Lifeguard'],                              max_weekly_hours: 40, contact_email: 'logan.vandyke@watermarkcc.com',      contact_phone: '+16165550208', active: true },
    { company_id: cid, name: 'Ava Bouwman',        primary_role: 'Lifeguard',         qualified_roles: ['Lifeguard', 'Greeter'],                   max_weekly_hours: 32, contact_email: 'ava.bouwman@watermarkcc.com',        contact_phone: '+16165550209', active: true },
    { company_id: cid, name: 'Mason Ekkens',       primary_role: 'Lifeguard',         qualified_roles: ['Lifeguard'],                              max_weekly_hours: 24, contact_email: 'mason.ekkens@watermarkcc.com',       contact_phone: '+16165550210', active: true },
    { company_id: cid, name: 'Sophia DeYoung',     primary_role: 'Lifeguard',         qualified_roles: ['Lifeguard'],                              max_weekly_hours: 40, contact_email: 'sophia.deyoung@watermarkcc.com',     contact_phone: '+16165550211', active: true },
    { company_id: cid, name: 'Owen Vanderveen',    primary_role: 'Lifeguard',         qualified_roles: ['Lifeguard', 'Greeter'],                   max_weekly_hours: 20, contact_email: 'owen.vanderveen@watermarkcc.com',    contact_phone: '+16165550212', active: true },
    { company_id: cid, name: 'Harper Mulder',      primary_role: 'Lifeguard',         qualified_roles: ['Lifeguard'],                              max_weekly_hours: 32, contact_email: 'harper.mulder@watermarkcc.com',      contact_phone: '+16165550213', active: true },
    { company_id: cid, name: 'Caleb Stoutmeyer',   primary_role: 'Lifeguard',         qualified_roles: ['Lifeguard'],                              max_weekly_hours: 24, contact_email: 'caleb.stoutmeyer@watermarkcc.com',   contact_phone: '+16165550214', active: true, individual_wage: 15.00 },
    { company_id: cid, name: 'Isabella Romanelli', primary_role: 'Lifeguard',         qualified_roles: ['Lifeguard'],                              max_weekly_hours: 40, contact_email: 'isabella.romanelli@watermarkcc.com', contact_phone: '+16165550215', active: true, individual_wage: 14.75 },
    { company_id: cid, name: 'Wyatt Krueger',      primary_role: 'Lifeguard',         qualified_roles: ['Lifeguard'],                              max_weekly_hours: 20, contact_email: 'wyatt.krueger@watermarkcc.com',      contact_phone: '+16165550216', active: true },
    // Greeters (3)
    { company_id: cid, name: 'Mia Schipper',       primary_role: 'Greeter',           qualified_roles: ['Greeter'],                                max_weekly_hours: 24, contact_email: 'mia.schipper@watermarkcc.com',       contact_phone: '+16165550217', active: true },
    { company_id: cid, name: 'Lucas Brennan',      primary_role: 'Greeter',           qualified_roles: ['Greeter'],                                max_weekly_hours: 20, contact_email: 'lucas.brennan@watermarkcc.com',      contact_phone: '+16165550218', active: true },
    { company_id: cid, name: 'Emma Holwerda',      primary_role: 'Greeter',           qualified_roles: ['Greeter'],                                max_weekly_hours: 20, contact_email: 'emma.holwerda@watermarkcc.com',      contact_phone: '+16165550219', active: true, individual_wage: 13.50 },
  ]

  const empRows = must('employees', await supabase.from('employees').insert(employees).select())
  console.log(`  ✅  ${empRows.length} employees`)

  const byName = (n: string) => empRows.find((e: { name: string; id: string }) => e.name === n)!.id
  const E = {
    brennan:   byName('Brennan Schaefer'),
    madison:   byName('Madison Whitmore'),
    jackson:   byName('Jackson Pierce'),
    reese:     byName('Reese Donovan'),
    cole:      byName('Cole Anderson'),
    brooklyn:  byName('Brooklyn Hayes'),
    carter:    byName('Carter Lindstrom'),
    jasmine:   byName('Jasmine Reilly'),
    logan:     byName('Logan VanDyke'),
    ava:       byName('Ava Bouwman'),
    mason:     byName('Mason Ekkens'),
    sophia:    byName('Sophia DeYoung'),
    owen:      byName('Owen Vanderveen'),
    harper:    byName('Harper Mulder'),
    caleb:     byName('Caleb Stoutmeyer'),
    isabella:  byName('Isabella Romanelli'),
    wyatt:     byName('Wyatt Krueger'),
    mia:       byName('Mia Schipper'),
    lucas:     byName('Lucas Brennan'),
    emma:      byName('Emma Holwerda'),
  }

  // ╔══════════════════════════════════════════════════════════════════════╗
  // ║                    PART 3: SEED AVAILABILITY                         ║
  // ╚══════════════════════════════════════════════════════════════════════╝
  console.log('\nPART 3 — Inserting availability…')

  function avail(employee_id: string, days: number[], start: string, end: string) {
    return days.map(day_of_week => ({
      company_id: cid, employee_id, day_of_week, start_time: start, end_time: end,
    }))
  }
  const ALL = [0, 1, 2, 3, 4, 5, 6]
  const WEEKDAYS = [1, 2, 3, 4, 5]
  const WEEKEND = [0, 6]

  const availRows = [
    // Managers — full availability
    ...avail(E.brennan,  ALL,                '09:00:00', '21:30:00'),
    ...avail(E.madison,  ALL,                '09:00:00', '21:30:00'),
    // Assistant managers
    ...avail(E.jackson,  WEEKDAYS,           '09:00:00', '21:30:00'),
    ...avail(E.jackson,  [6],                '09:00:00', '18:00:00'),
    ...avail(E.reese,    [1, 3, 5],          '10:00:00', '21:30:00'),
    ...avail(E.reese,    WEEKEND,            '09:00:00', '21:30:00'),
    // Headguards
    ...avail(E.cole,     ALL,                '09:00:00', '21:30:00'),
    ...avail(E.brooklyn, [0, 2, 4, 6],       '09:00:00', '21:30:00'),
    ...avail(E.carter,   [1, 2, 3, 5, 6],    '09:00:00', '21:30:00'),
    ...avail(E.jasmine,  WEEKEND,            '09:00:00', '21:30:00'),
    // Lifeguards
    ...avail(E.logan,    ALL,                '11:00:00', '21:30:00'),
    ...avail(E.ava,      [0, 1, 3, 5, 6],    '11:00:00', '21:30:00'),
    ...avail(E.mason,    [0, 6],             '09:00:00', '21:30:00'),
    ...avail(E.sophia,   ALL,                '11:00:00', '21:30:00'),
    ...avail(E.owen,     [0, 5, 6],          '14:00:00', '21:30:00'),  // after 2pm
    ...avail(E.harper,   [1, 2, 4, 6],       '11:00:00', '21:30:00'),
    ...avail(E.caleb,    ALL,                '09:00:00', '21:30:00'),
    ...avail(E.isabella, [0, 3, 4, 5, 6],    '11:00:00', '21:30:00'),
    ...avail(E.wyatt,    [2, 4, 5],          '14:00:00', '21:30:00'),  // after 2pm
    // Greeters
    ...avail(E.mia,      [1, 3, 5],          '11:00:00', '18:00:00'),
    ...avail(E.lucas,    [0, 2, 4, 6],       '11:00:00', '18:30:00'),
    ...avail(E.emma,     WEEKEND,            '09:00:00', '18:00:00'),
  ]
  const availInserted = must('availability', await supabase.from('availability').insert(availRows).select())
  console.log(`  ✅  ${availInserted.length} availability rows`)

  // ╔══════════════════════════════════════════════════════════════════════╗
  // ║                    PART 4: EMPLOYEE CONFLICTS                        ║
  // ╚══════════════════════════════════════════════════════════════════════╝
  console.log('\nPART 4 — Inserting employee conflicts…')
  const conflictsInserted = must('employee_conflicts', await supabase.from('employee_conflicts').insert([
    { company_id: cid, employee_id_1: E.cole,   employee_id_2: E.logan, severity: 'never', reason: 'Recurring interpersonal tension — separate on every shift' },
    { company_id: cid, employee_id_1: E.harper, employee_id_2: E.ava,   severity: 'avoid', reason: 'Schedule both only when no other pairing works' },
    { company_id: cid, employee_id_1: E.caleb,  employee_id_2: E.mason, severity: 'avoid', reason: 'Off-task together — keep on separate shifts when possible' },
  ]).select())
  console.log(`  ✅  ${conflictsInserted.length} conflicts`)

  // ╔══════════════════════════════════════════════════════════════════════╗
  // ║                  PART 5: MANAGER EMPLOYEE RECORD                     ║
  // ╚══════════════════════════════════════════════════════════════════════╝
  console.log('\nPART 5 — Inserting manager employee record (Alexander Darling)…')
  const managerInserted = must('employees', await supabase.from('employees').insert({
    company_id: cid,
    name: 'Alexander Darling',
    primary_role: 'Manager',
    qualified_roles: ['Manager'],
    max_weekly_hours: 40,
    contact_email: 'xander.w.darling@gmail.com',
    contact_phone: '+16163280114',
    active: true,
    aegis_access: 'manager',
  }).select())
  console.log(`  ✅  Alexander Darling employee record (${managerInserted[0].id})`)

  // ╔══════════════════════════════════════════════════════════════════════╗
  // ║                  PART 6: PUBLISHED SCHEDULE                          ║
  // ╚══════════════════════════════════════════════════════════════════════╝
  console.log('\nPART 6 — Building and inserting published schedule…')

  const ws = weekStart(now)
  const days = Array.from({ length: 7 }, (_, i) => isoDate(addDays(ws, i)))

  const SH: Record<string, number> = { 'AM': 4, 'AM Weekend': 6, 'PM': 6, 'Flex': 8, 'Day': 6 }

  const ename = (id: string) =>
    empRows.find((e: { id: string; name: string }) => e.id === id)!.name

  function a(date: string, shift_name: string, role: string, id: string, st: string, et: string) {
    return {
      date,
      shift_name,
      role,
      employee_id: id,
      employee_name: ename(id),
      start_time: st,
      end_time: et,
      hours: SH[shift_name] ?? 0,
    }
  }

  const assignments = [
    // ── SUNDAY ────────────────────────────────────────────────────────────
    // AM Weekend: 3 LG + 1 HG + 1 Greeter + manager on duty
    a(days[0], 'AM Weekend', 'Headguard', E.jasmine,  '09:30', '15:30'),
    a(days[0], 'AM Weekend', 'Lifeguard', E.mason,    '09:30', '15:30'),
    a(days[0], 'AM Weekend', 'Lifeguard', E.sophia,   '09:30', '15:30'),
    a(days[0], 'AM Weekend', 'Lifeguard', E.caleb,    '09:30', '15:30'),
    a(days[0], 'AM Weekend', 'Greeter',   E.emma,     '09:30', '15:30'),
    a(days[0], 'AM Weekend', 'Manager',   E.madison,  '09:30', '15:30'),
    // PM: 2 LG + 1 HG + 1 Greeter + assistant manager
    // Cole/Logan conflict — only Cole here (Logan elsewhere on Day shift)
    a(days[0], 'PM', 'Headguard',         E.cole,      '15:00', '21:00'),
    a(days[0], 'PM', 'Lifeguard',         E.ava,       '15:00', '21:00'),
    a(days[0], 'PM', 'Lifeguard',         E.isabella,  '15:00', '21:00'),
    a(days[0], 'PM', 'Greeter',           E.lucas,     '15:00', '21:00'),
    a(days[0], 'PM', 'Assistant Manager', E.reese,     '15:00', '21:00'),
    // Day: 2 LG  [GAP: Greeter slot — no greeter available Sunday afternoon]
    a(days[0], 'Day', 'Lifeguard', E.logan, '12:00', '18:00'),
    a(days[0], 'Day', 'Lifeguard', E.owen,  '14:00', '20:00'),

    // ── MONDAY ────────────────────────────────────────────────────────────
    // AM: 2 LG + 1 HG + 1 Greeter + manager
    a(days[1], 'AM', 'Headguard', E.cole,    '11:30', '15:30'),
    a(days[1], 'AM', 'Lifeguard', E.sophia,  '11:30', '15:30'),
    a(days[1], 'AM', 'Lifeguard', E.harper,  '11:30', '15:30'),
    a(days[1], 'AM', 'Greeter',   E.mia,     '11:30', '15:30'),
    a(days[1], 'AM', 'Manager',   E.brennan, '11:30', '15:30'),
    // PM: 2 LG + 1 HG + 1 Greeter
    a(days[1], 'PM', 'Headguard', E.carter, '15:00', '21:00'),
    a(days[1], 'PM', 'Lifeguard', E.logan,  '15:00', '21:00'),
    a(days[1], 'PM', 'Lifeguard', E.ava,    '15:00', '21:00'),
    a(days[1], 'PM', 'Greeter',   E.lucas,  '15:00', '21:00'),

    // ── TUESDAY ───────────────────────────────────────────────────────────
    // AM: 2 LG + 1 HG + 1 Greeter (Lucas avail Tue)
    a(days[2], 'AM', 'Headguard', E.brooklyn, '11:30', '15:30'),
    a(days[2], 'AM', 'Lifeguard', E.sophia,   '11:30', '15:30'),
    a(days[2], 'AM', 'Lifeguard', E.harper,   '11:30', '15:30'),
    a(days[2], 'AM', 'Greeter',   E.lucas,    '11:30', '15:30'),
    // PM: 2 LG + 1 HG + 1 Greeter
    a(days[2], 'PM', 'Headguard', E.carter,   '15:00', '21:00'),
    a(days[2], 'PM', 'Lifeguard', E.logan,    '15:00', '21:00'),
    a(days[2], 'PM', 'Lifeguard', E.caleb,    '15:00', '21:00'),
    a(days[2], 'PM', 'Greeter',   E.ava,      '15:00', '21:00'),  // Ava is qualified greeter

    // ── WEDNESDAY ─────────────────────────────────────────────────────────
    // AM: 2 LG + 1 HG + 1 Greeter + assistant mgr
    a(days[3], 'AM', 'Headguard',         E.cole,     '11:30', '15:30'),
    a(days[3], 'AM', 'Lifeguard',         E.isabella, '11:30', '15:30'),
    a(days[3], 'AM', 'Lifeguard',         E.sophia,   '11:30', '15:30'),
    a(days[3], 'AM', 'Greeter',           E.mia,      '11:30', '15:30'),
    a(days[3], 'AM', 'Assistant Manager', E.jackson,  '11:30', '15:30'),
    // PM: 1 LG + 1 HG  [GAP: 2nd Lifeguard — limited Wed PM availability]
    // Logan (conflict w/ Cole AM — same day OK since shifts don't overlap), Ava avail Wed
    a(days[3], 'PM', 'Headguard', E.carter,   '15:00', '21:00'),
    a(days[3], 'PM', 'Lifeguard', E.ava,      '15:00', '21:00'),

    // ── THURSDAY ──────────────────────────────────────────────────────────
    // AM: 2 LG + 1 HG + 1 Greeter
    a(days[4], 'AM', 'Headguard', E.brooklyn, '11:30', '15:30'),
    a(days[4], 'AM', 'Lifeguard', E.sophia,   '11:30', '15:30'),
    a(days[4], 'AM', 'Lifeguard', E.harper,   '11:30', '15:30'),
    a(days[4], 'AM', 'Greeter',   E.lucas,    '11:30', '15:30'),
    // PM: 2 LG + 1 HG + 1 Greeter
    a(days[4], 'PM', 'Headguard', E.carter,   '15:00', '21:00'),
    a(days[4], 'PM', 'Lifeguard', E.isabella, '15:00', '21:00'),
    a(days[4], 'PM', 'Lifeguard', E.caleb,    '15:00', '21:00'),
    a(days[4], 'PM', 'Greeter',   E.owen,     '15:00', '21:00'),  // Owen qualified greeter

    // ── FRIDAY ────────────────────────────────────────────────────────────
    // AM: 2 LG + 1 HG + 1 Greeter
    a(days[5], 'AM', 'Headguard', E.cole,    '11:30', '15:30'),
    a(days[5], 'AM', 'Lifeguard', E.sophia,  '11:30', '15:30'),
    a(days[5], 'AM', 'Lifeguard', E.caleb,   '11:30', '15:30'),
    a(days[5], 'AM', 'Greeter',   E.mia,     '11:30', '15:30'),
    // PM: 2 LG + 1 HG + 1 Greeter
    a(days[5], 'PM', 'Headguard', E.carter,  '15:00', '21:00'),
    a(days[5], 'PM', 'Lifeguard', E.logan,   '15:00', '21:00'),
    a(days[5], 'PM', 'Lifeguard', E.ava,     '15:00', '21:00'),
    a(days[5], 'PM', 'Greeter',   E.owen,    '15:00', '21:00'),

    // ── SATURDAY ──────────────────────────────────────────────────────────
    // AM Weekend: 3 LG + 1 HG + 1 Greeter + manager
    a(days[6], 'AM Weekend', 'Headguard', E.brooklyn, '09:30', '15:30'),
    a(days[6], 'AM Weekend', 'Lifeguard', E.harper,   '09:30', '15:30'),
    a(days[6], 'AM Weekend', 'Lifeguard', E.caleb,    '09:30', '15:30'),
    a(days[6], 'AM Weekend', 'Lifeguard', E.isabella, '09:30', '15:30'),
    a(days[6], 'AM Weekend', 'Greeter',   E.emma,     '09:30', '15:30'),
    a(days[6], 'AM Weekend', 'Manager',   E.brennan,  '09:30', '15:30'),
    // PM: 2 LG + 1 HG + 1 Greeter
    a(days[6], 'PM', 'Headguard', E.jasmine, '15:00', '21:00'),
    a(days[6], 'PM', 'Lifeguard', E.logan,   '15:00', '21:00'),
    a(days[6], 'PM', 'Lifeguard', E.mason,   '15:00', '21:00'),
    a(days[6], 'PM', 'Greeter',   E.lucas,   '15:00', '21:00'),
  ]

  const gaps = [
    {
      date: days[0],
      shift_name: 'Day',
      role: 'Greeter',
      required_count: 1,
      filled_count: 0,
      reason: 'No greeter available for Sunday afternoon Day shift — Emma covering AM Weekend, Lucas in PM',
    },
    {
      date: days[3],
      shift_name: 'PM',
      role: 'Lifeguard',
      required_count: 2,
      filled_count: 1,
      reason: 'Wednesday PM lifeguard pool drawn down — Cole/Logan conflict + AM shift draws',
    },
  ]

  // Hours + wages
  const hrs: Record<string, number> = {}
  for (const row of assignments) {
    hrs[row.employee_id] = (hrs[row.employee_id] ?? 0) + row.hours
  }

  const baseRate: Record<string, number> = {
    'Manager': 24, 'Assistant Manager': 19, 'Headguard': 17, 'Lifeguard': 14, 'Greeter': 13,
  }
  const individualWage: Record<string, number> = {
    [E.jackson]: 21.00,
    [E.carter]: 18.25,
    [E.caleb]: 15.00,
    [E.isabella]: 14.75,
    [E.emma]: 13.50,
  }
  const empRole: Record<string, string> = {}
  for (const e of empRows) empRole[e.id] = e.primary_role
  function rate(id: string): number {
    return individualWage[id] ?? baseRate[empRole[id]] ?? 14
  }

  const byEmployee = Object.entries(hrs).map(([employee_id, h]) => ({
    employee_id,
    employee_name: ename(employee_id),
    hours: h,
    hourly_rate: rate(employee_id),
    estimated_pay: parseFloat((h * rate(employee_id)).toFixed(2)),
  })).sort((a, b) => b.hours - a.hours)

  const totalEstimated = parseFloat(byEmployee.reduce((s, e) => s + e.estimated_pay, 0).toFixed(2))

  const topContributors = [...byEmployee]
    .sort((a, b) => b.hours - a.hours)
    .slice(0, 5)
    .map(({ employee_id, employee_name, hours }) => ({ employee_id, name: employee_name, hours }))

  const allActiveByHours = empRows.map((e: { id: string; name: string }) => ({
    employee_id: e.id,
    name: e.name,
    hours: hrs[e.id] ?? 0,
  }))
  const bottomContributors = [...allActiveByHours]
    .sort((a, b) => a.hours - b.hours)
    .slice(0, 3)

  const overtimeRisk = byEmployee
    .filter(e => e.hours > 36)
    .map(e => {
      const emp = empRows.find((r: { id: string; max_weekly_hours: number }) => r.id === e.employee_id)
      return {
        employee_id: e.employee_id,
        name: e.employee_name,
        hours: e.hours,
        max_hours: emp?.max_weekly_hours ?? 40,
      }
    })

  // Coverage rate: filled slots / required slots
  const totalRequired = assignments.length + gaps.reduce((s, g) => s + (g.required_count - g.filled_count), 0)
  const totalFilled = assignments.length
  const coverageRate = parseFloat(((totalFilled / totalRequired) * 100).toFixed(1))

  const staffingReport = {
    coverage_rate: coverageRate,
    top_contributors: topContributors,
    bottom_contributors: bottomContributors,
    overtime_risk: overtimeRisk,
    gap_summary: `${gaps.length} gaps this week: Sunday Day Greeter (no availability); Wednesday PM Lifeguard (-1 from required 2).`,
    special_notes_applied: [],
    aegis_notes: 'Schedule built respecting all availability windows and the Cole Anderson / Logan VanDyke conflict (never-together). Sunday Day greeter is a structural gap — no greeter coverage on Sunday afternoons. Wednesday PM lifeguard gap due to limited mid-week PM availability.',
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
    data: {
      assignments,
      gaps,
      summary: `Schedule built for ${days[0]} – ${days[6]}. ${assignments.length} assignments, ${gaps.length} gaps, ${coverageRate}% coverage. Estimated wages $${totalEstimated.toLocaleString()}.`,
    },
    staffing_report: staffingReport,
  }).select())
  console.log(`  ✅  Schedule — ${assignments.length} assignments, ${gaps.length} gaps, ${coverageRate}% coverage, $${totalEstimated.toLocaleString()} est. wages`)

  // ╔══════════════════════════════════════════════════════════════════════╗
  // ║              PART 7: PENDING TIME OFF REQUESTS                       ║
  // ╚══════════════════════════════════════════════════════════════════════╝
  console.log('\nPART 7 — Inserting pending time off requests…')
  const dPlus3  = addDays(now, 3)
  const dPlus6  = addDays(now, 6)
  const dPlus9  = addDays(now, 9)
  const dPlus13 = addDays(now, 13)

  const torInserted = must('time_off_requests', await supabase.from('time_off_requests').insert([
    {
      company_id: cid, employee_id: E.harper,
      start_date: isoDate(dPlus3),  end_date: isoDate(dPlus3),
      reason: 'Doctor appointment', status: 'pending',
      requested_at: now.toISOString(), decided_at: null, decided_by: null,
      aegis_recommendation: null, aegis_reasoning: null,
    },
    {
      company_id: cid, employee_id: E.sophia,
      start_date: isoDate(dPlus6),  end_date: isoDate(addDays(dPlus6, 2)),
      reason: 'Family wedding out of state', status: 'pending',
      requested_at: now.toISOString(), decided_at: null, decided_by: null,
      aegis_recommendation: null, aegis_reasoning: null,
    },
    {
      company_id: cid, employee_id: E.lucas,
      start_date: isoDate(dPlus9),  end_date: isoDate(dPlus9),
      reason: 'College move-in day', status: 'pending',
      requested_at: now.toISOString(), decided_at: null, decided_by: null,
      aegis_recommendation: null, aegis_reasoning: null,
    },
    {
      company_id: cid, employee_id: E.carter,
      start_date: isoDate(dPlus13), end_date: isoDate(addDays(dPlus13, 1)),
      reason: 'Weekend trip — already discussed with manager', status: 'pending',
      requested_at: now.toISOString(), decided_at: null, decided_by: null,
      aegis_recommendation: null, aegis_reasoning: null,
    },
  ]).select())
  console.log(`  ✅  ${torInserted.length} pending time off requests`)

  // ╔══════════════════════════════════════════════════════════════════════╗
  // ║                  PART 8: COMPLETION SUMMARY                          ║
  // ╚══════════════════════════════════════════════════════════════════════╝
  console.log(`
╔════════════════════════════════════════════════════════════╗
║              Watermark Reset Complete ✅                   ║
╠════════════════════════════════════════════════════════════╣
║  Company ID:  ${cid.padEnd(45)}║
╚════════════════════════════════════════════════════════════╝

DELETED (per table):`)
  for (const [t, n] of Object.entries(deletions)) {
    const display = n < 0 ? 'skipped (table missing)' : `${n} rows`
    console.log(`  • ${t.padEnd(22)} ${display}`)
  }

  console.log(`\nCREATED — Employees (${empRows.length} fake + 1 manager record):`)
  for (const e of empRows) {
    console.log(`  • ${e.name.padEnd(22)} ${e.primary_role}`)
  }
  console.log(`  • Alexander Darling      Manager  (matches users table)`)

  console.log(`\nCREATED — Schedule:`)
  console.log(`  • Week:           ${days[0]} → ${days[6]}`)
  console.log(`  • Assignments:    ${assignments.length}`)
  console.log(`  • Gaps:           ${gaps.length}`)
  console.log(`  • Coverage rate:  ${coverageRate}%`)
  console.log(`  • Est. wages:     $${totalEstimated.toLocaleString()}`)

  console.log(`\nCREATED — Other:`)
  console.log(`  • Availability rows:        ${availInserted.length}`)
  console.log(`  • Employee conflicts:       ${conflictsInserted.length}`)
  console.log(`  • Pending time off requests: ${torInserted.length}`)
  console.log(`\nScheduleID: ${scheduleInserted[0].id}\n`)
}

main().catch(err => {
  console.error('Fatal:', err)
  process.exit(1)
})
