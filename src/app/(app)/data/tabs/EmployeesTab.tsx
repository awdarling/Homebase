'use client'
import { useCompany } from '@/lib/hooks/useCompany'
import { useQuria } from '@/lib/hooks/useQuria'

import { useEffect, useState } from 'react'
import { createClient } from '@/lib/supabase/client'
import { logActivity as logActivityFn } from '@/lib/activity'
import { VetBadge } from '@/components/common/VetBadge'
import {
  activeStateAction,
  activeStateLabel,
  activeStateLogAction,
  activeStatePatch,
  activeStateSummary,
  needsActiveStateConfirm,
} from '@/lib/employees/active-state'
import type {
  Employee,
  CustomAvailability,
  CustomAvailabilityPattern,
  CustomAvailabilityWeek,
} from '@/lib/types'
// O11 (2026-08-30): this tab used to hand-roll its own "is this override still
// in force" check (active + end_date >= the browser's local today), which
// could disagree with Rule 0b's one real answer — especially since it used the
// manager's browser date instead of the company's own timezone. Import the
// shared decider (also used by Soteria's context and the schedule week strip)
// instead of re-deriving it here.
import { isCustomAvailabilityCurrent, todayInTimezone } from '@/lib/soteria/validateScheduleEdit'

const DAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']

function formatShortDate(d: string): string {
  const [y, m, day] = d.split('-').map(Number)
  return new Date(y, m - 1, day).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
}

function emptyWeekRows(): AvailabilityRow[] {
  return DAYS.map((_, i) => ({ day: i, active: false, start_time: '00:01', end_time: '23:59' }))
}

function patternsToWeekRows(patterns: CustomAvailabilityPattern[]): AvailabilityRow[] {
  return DAYS.map((_, i) => {
    const p = patterns.find(pp => pp.day_of_week === i)
    return p
      ? { day: i, active: true, start_time: p.start_time.slice(0, 5), end_time: p.end_time.slice(0, 5) }
      : { day: i, active: false, start_time: '00:01', end_time: '23:59' }
  })
}

function weekRowsToPatterns(rows: AvailabilityRow[]): CustomAvailabilityPattern[] {
  return rows
    .filter(r => r.active)
    .map(r => ({ day_of_week: r.day, start_time: r.start_time, end_time: r.end_time }))
}

interface CustomAvailFormState {
  type: 'date_limited' | 'rotating'
  end_date: string
  cycle_weeks: number
  cycle_start_date: string
  weeks: AvailabilityRow[][]
}

interface Role {
  id: string
  name: string
  color: string
  description: string | null
}

interface AvailabilityRow {
  day: number
  active: boolean
  start_time: string
  end_time: string
}

const DEFAULT_AVAILABILITY: AvailabilityRow[] = DAYS.map((_, i) => ({
  day: i,
  active: false,
  start_time: '00:01',
  end_time: '23:59',
}))

function TrashIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <polyline points="3 6 5 6 21 6" />
      <path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6" />
      <path d="M10 11v6" />
      <path d="M14 11v6" />
      <path d="M9 6V4a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2" />
    </svg>
  )
}

const SEX_LABELS: Record<string, string> = {
  male: 'Male',
  female: 'Female',
}

function SexBadge({ value }: { value: string }) {
  const label = SEX_LABELS[value] ?? value
  return (
    <span style={{
      display: 'inline-block',
      padding: '1px 7px',
      borderRadius: 'var(--radius-pill)',
      fontSize: 9,
      fontWeight: 700,
      letterSpacing: '0.08em',
      textTransform: 'uppercase',
      background: 'rgba(100, 100, 100, 0.1)',
      border: '1px solid rgba(100, 100, 100, 0.2)',
      color: 'var(--text-secondary)',
      whiteSpace: 'nowrap',
    }}>
      {label}
    </span>
  )
}

function RoleBadge({ role, roles }: { role: string; roles: Role[] }) {
  const match = roles.find((r) => r.name === role)
  const color = match?.color ?? '#6b7280'
  return (
    <span style={{
      display: 'inline-block',
      padding: '2px 8px',
      borderRadius: 'var(--radius-pill)',
      fontSize: 11,
      fontWeight: 500,
      background: color + '22',
      color: color,
      border: `1px solid ${color}44`,
    }}>
      {role}
    </span>
  )
}

function InitialsAvatar({ name, role, roles }: { name: string; role: string; roles: Role[] }) {
  const initials = name.split(' ').map((w) => w[0]).join('').slice(0, 2).toUpperCase()
  const match = roles.find((r) => r.name === role)
  const color = match?.color ?? '#6b7280'
  return (
    <div style={{
      width: 32,
      height: 32,
      borderRadius: 'var(--radius-sm)',
      background: color + '22',
      border: `1px solid ${color}44`,
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center',
      fontSize: 11,
      fontWeight: 700,
      color: color,
      fontFamily: 'var(--font-display)',
      flexShrink: 0,
    }}>
      {initials}
    </div>
  )
}

export default function EmployeesTab() {
  const { company, user } = useCompany()
  const { isQuria } = useQuria()
  const COMPANY_ID = company?.id ?? ''
  const [employees, setEmployees] = useState<Employee[]>([])
  const [roles, setRoles] = useState<Role[]>([])
  const [availability, setAvailability] = useState<Record<string, { day: number; start: string; end: string }[]>>({})
  const [loading, setLoading] = useState(true)
  const [search, setSearch] = useState('')
  const [roleFilter, setRoleFilter] = useState('all')
  const [veteransOnly, setVeteransOnly] = useState(false)
  const [showForm, setShowForm] = useState(false)
  const [editingEmployee, setEditingEmployee] = useState<Employee | null>(null)
  const [form, setForm] = useState({
    name: '',
    primary_role: '',
    qualified_roles: [] as string[],
    max_weekly_hours: '40',
    contact_phone: '',
    contact_email: '',
    individual_wage: '',
    is_veteran: false,
    sex: '',
    last_day: '',
  })
  const [availForm, setAvailForm] = useState<AvailabilityRow[]>(DEFAULT_AVAILABILITY)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null)
  // The active/inactive control lives inside the employee's panel, not on the
  // roster row — reaching it takes deliberately opening one person's profile.
  const [confirmActiveState, setConfirmActiveState] = useState<Employee | null>(null)
  const [activeStateBusy, setActiveStateBusy] = useState(false)

  // Custom availability state
  const [customAvailability, setCustomAvailability] = useState<Record<string, CustomAvailability | null>>({})
  const [customAvailTarget, setCustomAvailTarget] = useState<Employee | null>(null)
  const [customAvailForm, setCustomAvailForm] = useState<CustomAvailFormState | null>(null)
  const [editingCustomAvail, setEditingCustomAvail] = useState<CustomAvailability | null>(null)
  const [savingCustomAvail, setSavingCustomAvail] = useState(false)
  const [removingCustomAvail, setRemovingCustomAvail] = useState(false)
  const [customAvailError, setCustomAvailError] = useState('')

  const supabase = createClient()

  useEffect(() => { if (COMPANY_ID) fetchData() }, [COMPANY_ID])

  async function fetchData() {
    if (!COMPANY_ID) return
    setLoading(true)
    const [empRes, avRes, rolesRes, caRes] = await Promise.all([
      supabase.from('employees').select('*').eq('company_id', COMPANY_ID).order('primary_role').order('name'),
      supabase.from('availability').select('*').eq('company_id', COMPANY_ID),
      supabase.from('roles').select('*').eq('company_id', COMPANY_ID).order('name'),
      supabase.from('custom_availability').select('*').eq('company_id', COMPANY_ID).eq('active', true),
    ])
    if (empRes.data) setEmployees(empRes.data)
    if (rolesRes.data) setRoles(rolesRes.data)
    if (avRes.data) {
      const map: Record<string, { day: number; start: string; end: string }[]> = {}
      avRes.data.forEach((a: any) => {
        if (!map[a.employee_id]) map[a.employee_id] = []
        map[a.employee_id].push({ day: a.day_of_week, start: a.start_time, end: a.end_time })
      })
      setAvailability(map)
    }
    const caMap: Record<string, CustomAvailability | null> = {}
    if (caRes.data) {
      for (const ca of caRes.data as CustomAvailability[]) {
        caMap[ca.employee_id] = ca
      }
    }
    setCustomAvailability(caMap)
    setLoading(false)
  }

  async function logActivity(action: string, summary: string, entityId?: string) {
    await logActivityFn({
      supabase,
      company_id: COMPANY_ID,
      action,
      entity_type: 'employee',
      entity_id: entityId,
      summary,
      isQuria,
      actorName: user?.name,
      actorAvatarUrl: user?.avatar_url,
    })
  }

  function buildEmployeeDiff(oldEmp: Employee, formState: typeof form): string | null {
    const parts: string[] = []

    if (oldEmp.primary_role !== formState.primary_role) {
      parts.push(`primary role: ${oldEmp.primary_role} → ${formState.primary_role}`)
    }

    const newMax = parseInt(formState.max_weekly_hours) || 40
    if (oldEmp.max_weekly_hours !== newMax) {
      parts.push(`max hours: ${oldEmp.max_weekly_hours} → ${newMax}`)
    }

    const newEmail = formState.contact_email.trim() || null
    if ((oldEmp.contact_email ?? null) !== newEmail) {
      parts.push('email updated')
    }

    const newPhone = formState.contact_phone.trim() || null
    if ((oldEmp.contact_phone ?? null) !== newPhone) {
      parts.push('phone updated')
    }

    const newWage = formState.individual_wage !== '' ? parseFloat(formState.individual_wage) : null
    const oldWage = oldEmp.individual_wage ?? null
    if (oldWage !== newWage) {
      const fmt = (v: number | null) => v == null ? 'not set' : `$${v.toFixed(2)}`
      parts.push(`wage: ${fmt(oldWage)} → ${fmt(newWage)}/hr`)
    }

    // NOT diffed: `active`. Save no longer writes it at all — only the
    // Deactivate/Activate control does, and that control logs its own row.
    // (This used to push 'reactivated' whenever an inactive employee was saved,
    // which was true only because the save payload silently reactivated them.)

    const newSex = formState.sex || null
    const oldSex = oldEmp.sex ?? null
    if (oldSex !== newSex) {
      const sexLabels: Record<string, string> = {
        male: 'Male',
        female: 'Female',
      }
      const fmtSex = (v: string | null): string => v ? (sexLabels[v] ?? v) : 'not set'
      parts.push(`sex: ${fmtSex(oldSex)} → ${fmtSex(newSex)}`)
    }

    if (parts.length === 0) return null
    return `${formState.name.trim()} — ${parts.join(', ')}`
  }

  const roleNames = ['all', ...roles.map((r) => r.name)]

  const veteranCount = employees.filter((e) => e.is_veteran).length

  const filtered = employees.filter((e) => {
    const matchSearch = e.name.toLowerCase().includes(search.toLowerCase())
    const matchRole = roleFilter === 'all' || e.primary_role === roleFilter
    const matchVeteran = !veteransOnly || e.is_veteran
    return matchSearch && matchRole && matchVeteran
  })

  function buildAvailForm(empId: string): AvailabilityRow[] {
    const existing = availability[empId] ?? []
    return DAYS.map((_, i) => {
      const found = existing.find((x) => x.day === i)
      return {
        day: i,
        active: !!found,
        start_time: found ? found.start.slice(0, 5) : '00:01',
        end_time: found ? found.end.slice(0, 5) : '23:59',
      }
    })
  }

  function openAdd() {
    setEditingEmployee(null)
    setForm({
      name: '',
      primary_role: roles[0]?.name ?? '',
      qualified_roles: [],
      max_weekly_hours: '40',
      contact_phone: '',
      contact_email: '',
      individual_wage: '',
      is_veteran: false,
      sex: '',
      last_day: '',
    })
    setAvailForm(DEFAULT_AVAILABILITY)
    setError('')
    setShowForm(true)
  }

  function openEdit(emp: Employee) {
    setEditingEmployee(emp)
    setForm({
      name: emp.name,
      primary_role: emp.primary_role,
      qualified_roles: emp.qualified_roles ?? [],
      max_weekly_hours: String(emp.max_weekly_hours),
      contact_phone: emp.contact_phone ?? '',
      contact_email: emp.contact_email ?? '',
      individual_wage: emp.individual_wage != null ? String(emp.individual_wage) : '',
      is_veteran: !!emp.is_veteran,
      sex: emp.sex ?? '',
      last_day: emp.last_day ?? '',
    })
    setAvailForm(buildAvailForm(emp.id))
    setError('')
    setShowForm(true)
  }

  function toggleDay(day: number) {
    setAvailForm((prev) => prev.map((r) => r.day === day ? { ...r, active: !r.active } : r))
  }

  function updateAvailTime(day: number, field: 'start_time' | 'end_time', value: string) {
    setAvailForm((prev) => prev.map((r) => r.day === day ? { ...r, [field]: value } : r))
  }

  function toggleQualifiedRole(roleName: string) {
    setForm((f) => ({
      ...f,
      qualified_roles: f.qualified_roles.includes(roleName)
        ? f.qualified_roles.filter((r) => r !== roleName)
        : [...f.qualified_roles, roleName],
    }))
  }

  async function handleSave() {
    if (!form.name.trim() || !form.primary_role.trim()) {
      setError('Name and role are required.')
      return
    }
    if (!form.contact_email.trim()) {
      setError('Email is required — Aegis needs this to distribute schedules.')
      return
    }
    if (!form.contact_phone.trim()) {
      setError('Phone is required — Aegis needs this to send SMS notifications.')
      return
    }
    setSaving(true)
    setError('')

    const qualifiedRoles = form.qualified_roles.includes(form.primary_role)
      ? form.qualified_roles
      : [form.primary_role, ...form.qualified_roles]

    const payload = {
      company_id: COMPANY_ID,
      name: form.name.trim(),
      primary_role: form.primary_role,
      qualified_roles: qualifiedRoles,
      max_weekly_hours: parseInt(form.max_weekly_hours) || 40,
      contact_phone: form.contact_phone.trim() || null,
      contact_email: form.contact_email.trim() || null,
      individual_wage: form.individual_wage !== '' ? parseFloat(form.individual_wage) : null,
      is_veteran: form.is_veteran,
      sex: form.sex || null,
      // Feature B: acknowledged last working day (or null to clear). The employee
      // works until the day passes; a daily Aegis job deactivates them after it.
      //
      // `active` is deliberately NOT here. Save preserves whatever the active
      // state already is: opening a deactivated employee to fix their phone
      // number must not silently put them back on the schedule. The ONLY things
      // that change `active` are the Deactivate/Activate control in this panel
      // and Soteria — both through @/lib/employees/active-state.
      last_day: form.last_day.trim() || null,
    }

    let empId = editingEmployee?.id

    if (editingEmployee) {
      const veteranChanged = !!editingEmployee.is_veteran !== form.is_veteran

      // Detect non-tracked changes (name, qualified roles, availability) so the
      // fallback "contact info updated" log fires for those even when no tracked
      // field changed. If only the veteran flag toggled, skip the generic log
      // entirely — the veteranChanged branch below handles it.
      const nameChanged = editingEmployee.name !== form.name.trim()
      const oldQualified = [...(editingEmployee.qualified_roles ?? [])].sort()
      const newQualified = [...qualifiedRoles].sort()
      const qualifiedChanged =
        oldQualified.length !== newQualified.length ||
        oldQualified.some((r, i) => r !== newQualified[i])

      const oldAvail = (availability[editingEmployee.id] ?? [])
        .map(a => `${a.day}|${a.start.slice(0, 5)}|${a.end.slice(0, 5)}`)
        .sort()
      const newAvail = availForm
        .filter(r => r.active)
        .map(r => `${r.day}|${r.start_time}|${r.end_time}`)
        .sort()
      const availabilityEdited =
        oldAvail.length !== newAvail.length ||
        oldAvail.some((v, i) => v !== newAvail[i])

      await supabase.from('employees').update(payload).eq('id', editingEmployee.id)

      const diffSummary = buildEmployeeDiff(editingEmployee, form)
      if (diffSummary) {
        await logActivity('employee_updated', diffSummary, editingEmployee.id)
      } else if (nameChanged || qualifiedChanged || availabilityEdited) {
        await logActivity(
          'employee_updated',
          `${form.name.trim()} — contact info updated`,
          editingEmployee.id,
        )
      }

      if (veteranChanged) {
        await logActivity(
          'employee_updated',
          form.is_veteran
            ? `Marked ${form.name.trim()} as a veteran`
            : `Removed veteran status from ${form.name.trim()}`,
          editingEmployee.id,
        )
      }
    } else {
      // A newly added employee starts active — the only place `active` is
      // written outside the Deactivate/Activate control.
      const { data } = await supabase.from('employees').insert({ ...payload, active: true }).select().single()
      empId = data?.id
      if (empId) await logActivity('employee_created', `Added employee: ${form.name}`, empId)
    }

    if (empId) {
      await supabase.from('availability').delete().eq('employee_id', empId)
      const activeDays = availForm.filter((r) => r.active)
      if (activeDays.length > 0) {
        await supabase.from('availability').insert(
          activeDays.map((r) => ({
            employee_id: empId,
            company_id: COMPANY_ID,
            day_of_week: r.day,
            start_time: r.start_time,
            end_time: r.end_time,
          }))
        )
      }
    }

    setSaving(false)
    setShowForm(false)
    fetchData()
  }

  async function handleDelete(id: string) {
    const emp = employees.find((e) => e.id === id)
    await supabase.from('availability').delete().eq('employee_id', id)
    await supabase.from('employees').delete().eq('id', id)
    await logActivity('employee_deleted', `Deleted employee: ${emp?.name ?? id}`, id)
    setConfirmDeleteId(null)
    fetchData()
  }

  // ── Deactivate / Activate ──────────────────────────────────────────────────
  //
  // One control, two directions, reached only by opening an employee's panel.
  // Replaces the old `handleToggleActive`, which had no call site anywhere in
  // the repo AND was unsafe: it flipped `active` without clearing `last_day`, so
  // Aegis's daily offboarding sweep would have switched a reactivated employee
  // straight back off within 24 hours. Both directions are defined once, in
  // @/lib/employees/active-state, so Soteria cannot drift from this.
  function startActiveStateChange(emp: Employee) {
    if (needsActiveStateConfirm(emp)) {
      setConfirmActiveState(emp)
      return
    }
    void applyActiveStateChange(emp)
  }

  async function applyActiveStateChange(emp: Employee) {
    const action = activeStateAction(emp)
    setActiveStateBusy(true)
    setError('')
    const { error: updErr } = await supabase
      .from('employees')
      .update(activeStatePatch(emp))
      .eq('id', emp.id)
      .eq('company_id', COMPANY_ID)
    setConfirmActiveState(null)
    if (updErr) {
      setActiveStateBusy(false)
      setError(`Could not ${action} ${emp.name}: ${updErr.message}`)
      return
    }
    await logActivity(
      activeStateLogAction(action),
      activeStateSummary(action, emp.name, emp.last_day),
      emp.id
    )
    // Keep the panel open on the employee's NEW state, so the control flips in
    // place and any unsaved edits in the form survive.
    const updated: Employee = action === 'activate'
      ? { ...emp, active: true, last_day: null }
      : { ...emp, active: false }
    setEditingEmployee(updated)
    if (action === 'activate') setForm((f) => ({ ...f, last_day: '' }))
    await fetchData()
    setActiveStateBusy(false)
  }

  function openCustomAvailModal(emp: Employee) {
    const existing = customAvailability[emp.id]
    if (existing && isCustomAvailabilityCurrent(existing, todayInTimezone(company?.timezone))) {
      let weekArrays: AvailabilityRow[][]
      if (existing.type === 'date_limited') {
        const patterns = (existing.patterns ?? []) as CustomAvailabilityPattern[]
        weekArrays = [patternsToWeekRows(patterns)]
      } else {
        const weeks = ([...((existing.patterns ?? []) as CustomAvailabilityWeek[])])
          .sort((a, b) => a.week - b.week)
        weekArrays = weeks.map(w => patternsToWeekRows(w.days ?? []))
        const targetLen = Math.max(existing.cycle_weeks ?? 1, weekArrays.length, 1)
        while (weekArrays.length < targetLen) weekArrays.push(emptyWeekRows())
      }
      setCustomAvailForm({
        type: existing.type,
        end_date: existing.end_date ?? '',
        cycle_weeks: existing.cycle_weeks ?? 2,
        cycle_start_date: existing.cycle_start_date ?? '',
        weeks: weekArrays,
      })
      setEditingCustomAvail(existing)
    } else {
      setCustomAvailForm({
        type: 'date_limited',
        end_date: '',
        cycle_weeks: 2,
        cycle_start_date: '',
        weeks: [emptyWeekRows()],
      })
      setEditingCustomAvail(null)
    }
    setCustomAvailTarget(emp)
    setCustomAvailError('')
  }

  function closeCustomAvailModal() {
    if (savingCustomAvail || removingCustomAvail) return
    setCustomAvailTarget(null)
    setCustomAvailForm(null)
    setEditingCustomAvail(null)
    setCustomAvailError('')
  }

  function setCustomAvailType(next: 'date_limited' | 'rotating') {
    setCustomAvailForm(prev => {
      if (!prev) return prev
      if (next === prev.type) return prev
      if (next === 'date_limited') {
        return { ...prev, type: 'date_limited', weeks: [prev.weeks[0] ?? emptyWeekRows()] }
      }
      const targetLen = Math.max(prev.cycle_weeks, 1)
      const weeks = prev.weeks.slice(0, targetLen)
      while (weeks.length < targetLen) weeks.push(emptyWeekRows())
      return { ...prev, type: 'rotating', weeks }
    })
  }

  function setCycleWeeks(next: number) {
    setCustomAvailForm(prev => {
      if (!prev) return prev
      const clamped = Math.min(8, Math.max(1, Math.floor(next)))
      const weeks = prev.weeks.slice(0, clamped)
      while (weeks.length < clamped) weeks.push(emptyWeekRows())
      return { ...prev, cycle_weeks: clamped, weeks }
    })
  }

  function toggleCustomDay(weekIdx: number, day: number) {
    setCustomAvailForm(prev => {
      if (!prev) return prev
      const weeks = prev.weeks.map((week, i) =>
        i === weekIdx
          ? week.map(r => r.day === day ? { ...r, active: !r.active } : r)
          : week,
      )
      return { ...prev, weeks }
    })
  }

  function updateCustomDayTime(weekIdx: number, day: number, field: 'start_time' | 'end_time', value: string) {
    setCustomAvailForm(prev => {
      if (!prev) return prev
      const weeks = prev.weeks.map((week, i) =>
        i === weekIdx
          ? week.map(r => r.day === day ? { ...r, [field]: value } : r)
          : week,
      )
      return { ...prev, weeks }
    })
  }

  async function saveCustomAvail() {
    if (!customAvailTarget || !customAvailForm) return
    if (!customAvailForm.end_date) {
      setCustomAvailError('Active-until date is required.')
      return
    }
    if (customAvailForm.type === 'rotating') {
      if (!customAvailForm.cycle_start_date) {
        setCustomAvailError('Cycle start date is required for rotating availability.')
        return
      }
      if (customAvailForm.cycle_weeks < 1 || customAvailForm.cycle_weeks > 8) {
        setCustomAvailError('Cycle must be between 1 and 8 weeks.')
        return
      }
    }

    setSavingCustomAvail(true)
    setCustomAvailError('')

    let patterns: CustomAvailabilityPattern[] | CustomAvailabilityWeek[]
    if (customAvailForm.type === 'date_limited') {
      patterns = weekRowsToPatterns(customAvailForm.weeks[0] ?? emptyWeekRows())
    } else {
      patterns = customAvailForm.weeks
        .slice(0, customAvailForm.cycle_weeks)
        .map((rows, i) => ({ week: i + 1, days: weekRowsToPatterns(rows) }))
    }

    const payload = {
      company_id: COMPANY_ID,
      employee_id: customAvailTarget.id,
      type: customAvailForm.type,
      end_date: customAvailForm.end_date,
      cycle_weeks: customAvailForm.type === 'rotating' ? customAvailForm.cycle_weeks : null,
      cycle_start_date: customAvailForm.type === 'rotating' ? customAvailForm.cycle_start_date : null,
      patterns,
      active: true,
    }

    if (editingCustomAvail) {
      await supabase.from('custom_availability').update(payload).eq('id', editingCustomAvail.id)
    } else {
      await supabase.from('custom_availability').insert(payload)
    }

    const typeLabel = customAvailForm.type === 'rotating' ? 'rotating' : 'date-limited'
    await logActivity(
      'custom_availability_set',
      `${customAvailTarget.name} — custom availability set (${typeLabel}, until ${formatShortDate(customAvailForm.end_date)})`,
      customAvailTarget.id,
    )

    setSavingCustomAvail(false)
    setCustomAvailTarget(null)
    setCustomAvailForm(null)
    setEditingCustomAvail(null)
    await fetchData()
  }

  async function removeCustomAvail() {
    if (!editingCustomAvail || !customAvailTarget) return
    setRemovingCustomAvail(true)
    await supabase.from('custom_availability').update({ active: false }).eq('id', editingCustomAvail.id)
    await logActivity(
      'custom_availability_removed',
      `${customAvailTarget.name} — custom availability removed, reverting to normal`,
      customAvailTarget.id,
    )
    setRemovingCustomAvail(false)
    setCustomAvailTarget(null)
    setCustomAvailForm(null)
    setEditingCustomAvail(null)
    await fetchData()
  }

  if (loading) {
    return (
      <div style={{ padding: '48px 0', textAlign: 'center', color: 'var(--text-muted)', fontSize: 13 }}>
        Loading employees...
      </div>
    )
  }

  return (
    <div>
      <div style={{ display: 'flex', gap: 10, marginBottom: 16, alignItems: 'center' }}>
        <input
          className="form-input"
          style={{ maxWidth: 240 }}
          placeholder="Search employees..."
          value={search}
          onChange={(e) => setSearch(e.target.value)}
        />
        <select
          className="form-select"
          style={{ maxWidth: 180 }}
          value={roleFilter}
          onChange={(e) => setRoleFilter(e.target.value)}
        >
          {roleNames.map((r) => (
            <option key={r} value={r}>{r === 'all' ? 'All roles' : r}</option>
          ))}
        </select>
        <button
          type="button"
          onClick={() => setVeteransOnly((v) => !v)}
          style={{
            padding: '5px 12px',
            borderRadius: 'var(--radius-pill)',
            border: '1px solid',
            fontSize: 12,
            fontFamily: 'var(--font-body)',
            fontWeight: 500,
            cursor: 'pointer',
            background: veteransOnly ? 'var(--accent-dim)' : 'var(--bg-surface-3)',
            borderColor: veteransOnly ? 'var(--accent-border)' : 'var(--border-default)',
            color: veteransOnly ? 'var(--accent)' : 'var(--text-muted)',
          }}
        >
          Veterans ({veteranCount})
        </button>
        <div style={{ marginLeft: 'auto' }}>
          <button className="btn btn-primary btn-sm" onClick={openAdd}>
            + Add Employee
          </button>
        </div>
      </div>

      <div style={{ fontSize: 11, color: 'var(--text-muted)', marginBottom: 12 }}>
        {filtered.length} employee{filtered.length !== 1 ? 's' : ''}
        {roleFilter !== 'all' ? ` · ${roleFilter}` : ''}
      </div>

      <div style={{
        background: 'var(--bg-surface-1)',
        border: '1px solid var(--border-default)',
        borderRadius: 'var(--radius-lg)',
        overflow: 'hidden',
        overflowX: 'auto',
      }}>
        <table className="data-table" style={{ tableLayout: 'fixed', width: '100%', minWidth: 1100 }}>
          <colgroup>
            <col style={{ width: '16%' }} />
            <col style={{ width: '6%' }} />
            <col style={{ width: '8%' }} />
            <col style={{ width: '5%' }} />
            <col style={{ width: '8%' }} />
            <col style={{ width: '10%' }} />
            <col style={{ width: '11%' }} />
            <col style={{ width: '9%' }} />
            <col style={{ width: '9%' }} />
            <col style={{ width: '5%' }} />
            <col style={{ width: '4%' }} />
          </colgroup>
          <thead>
            <tr>
              <th>Employee</th>
              <th>Veteran</th>
              <th>Custom Availability</th>
              <th>Sex</th>
              <th>Role</th>
              <th>Also Qualifies</th>
              <th>Availability</th>
              <th>Email</th>
              <th>Phone</th>
              <th>Wage</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {filtered.map((emp) => {
              const avail = availability[emp.id] ?? []
              return (
                <tr key={emp.id} onClick={() => openEdit(emp)} style={{ cursor: 'pointer' }}>
                  <td>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                      <InitialsAvatar name={emp.name} role={emp.primary_role} roles={roles} />
                      <div>
                        <div style={{ color: emp.active ? 'var(--text-primary)' : 'var(--text-muted)', fontSize: 13 }}>{emp.name}</div>
                        <div style={{ fontSize: 10, color: emp.active ? 'var(--status-ready-text)' : 'var(--text-disabled)', marginTop: 1 }}>
                          {emp.active ? 'Active' : 'Inactive'}
                          {emp.last_day && (
                            <span
                              title={`Last day ${emp.last_day} — auto-deactivates after this date`}
                              style={{ color: 'var(--status-blocked-text)', marginLeft: 6 }}
                            >
                              · Leaving {new Date(emp.last_day + 'T00:00:00').toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}
                            </span>
                          )}
                        </div>
                      </div>
                    </div>
                  </td>
                  <td style={{ textAlign: 'center' }}>
                    {emp.is_veteran && <VetBadge />}
                  </td>
                  <td style={{ textAlign: 'center' }}>
                    {isCustomAvailabilityCurrent(customAvailability[emp.id], todayInTimezone(company?.timezone)) && (
                      <span
                        onClick={(e) => { e.stopPropagation(); openCustomAvailModal(emp) }}
                        title="Custom availability active — click to view"
                        style={{
                          color: 'var(--accent)',
                          fontSize: 14,
                          cursor: 'pointer',
                          fontWeight: 700,
                          display: 'inline-block',
                          lineHeight: 1,
                        }}
                      >
                        ✓
                      </span>
                    )}
                  </td>
                  <td style={{ textAlign: 'center' }}>
                    {emp.sex && <SexBadge value={emp.sex} />}
                  </td>
                  <td><RoleBadge role={emp.primary_role} roles={roles} /></td>
                  <td>
                    <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap' }}>
                      {(emp.qualified_roles ?? []).filter((r) => r !== emp.primary_role).map((r) => (
                        <RoleBadge key={r} role={r} roles={roles} />
                      ))}
                    </div>
                  </td>
                  <td>
                    <div style={{ display: 'flex', gap: 3, flexWrap: 'wrap' }}>
                      {DAYS.map((d, i) => {
                        const a = avail.find((x) => x.day === i)
                        return (
                          <span key={d} style={{
                            fontSize: 10,
                            padding: '2px 5px',
                            borderRadius: 3,
                            background: a ? 'var(--accent-dim)' : 'var(--bg-surface-3)',
                            color: a ? 'var(--accent)' : 'var(--text-disabled)',
                          }}>
                            {d}
                          </span>
                        )
                      })}
                    </div>
                  </td>
                  <td style={{ fontSize: 12, color: 'var(--text-secondary)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                    {emp.contact_email ?? <span style={{ color: 'var(--text-disabled)' }}>—</span>}
                  </td>
                  <td style={{ fontSize: 12, color: 'var(--text-secondary)' }}>
                    {emp.contact_phone ?? <span style={{ color: 'var(--text-disabled)' }}>—</span>}
                  </td>
                  <td style={{ color: 'var(--text-secondary)', fontSize: 13 }}>
                    {emp.individual_wage != null
                      ? <span style={{ color: 'var(--accent)', fontWeight: 500 }}>${Number(emp.individual_wage).toFixed(2)}</span>
                      : <span style={{ color: 'var(--text-disabled)' }}>role rate</span>
                    }
                  </td>
                  <td>
                    <button
                      onClick={(e) => { e.stopPropagation(); setConfirmDeleteId(emp.id) }}
                      style={{
                        background: 'transparent',
                        border: 'none',
                        cursor: 'pointer',
                        color: 'var(--text-muted)',
                        padding: '4px',
                        borderRadius: 'var(--radius-sm)',
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                      }}
                    >
                      <TrashIcon />
                    </button>
                  </td>
                </tr>
              )
            })}
          </tbody>
        </table>

        {filtered.length === 0 && (
          <div className="empty-state">
            <div className="empty-state-title">No employees found</div>
            <div className="empty-state-desc">Try adjusting your search or filter.</div>
          </div>
        )}
      </div>

      {/* Confirm delete modal */}
      {confirmDeleteId && (
        <div style={{ position: 'fixed', inset: 0, zIndex: 200, background: 'rgba(0,0,0,0.7)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
          <div style={{ background: 'var(--bg-surface-1)', border: '1px solid var(--border-default)', borderRadius: 'var(--radius-xl)', padding: 28, width: '100%', maxWidth: 380 }}>
            <div style={{ fontFamily: 'var(--font-display)', fontSize: 18, fontWeight: 700, color: 'var(--text-primary)', marginBottom: 10 }}>
              Delete Employee
            </div>
            <div style={{ fontSize: 13, color: 'var(--text-muted)', marginBottom: 20, lineHeight: 1.6 }}>
              This will permanently delete the employee and all their availability data. This cannot be undone.
            </div>
            <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
              <button className="btn btn-secondary btn-sm" onClick={() => setConfirmDeleteId(null)}>Cancel</button>
              <button
                className="btn btn-sm"
                onClick={() => handleDelete(confirmDeleteId)}
                style={{ background: 'var(--status-blocked-bg)', color: 'var(--status-blocked-text)', border: '1px solid var(--status-blocked-border)' }}
              >
                Delete Permanently
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Confirm the active-state change. Always shown for a deactivation; for an
          activation, only when a recorded departure date would be erased. */}
      {confirmActiveState && (
        <div style={{ position: 'fixed', inset: 0, zIndex: 400, background: 'rgba(0,0,0,0.7)', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 20 }}>
          <div style={{ background: 'var(--bg-surface-1)', border: '1px solid var(--border-default)', borderRadius: 'var(--radius-xl)', padding: 28, width: '100%', maxWidth: 440 }}>
            <div style={{ fontFamily: 'var(--font-display)', fontSize: 18, fontWeight: 700, color: 'var(--text-primary)', marginBottom: 10 }}>
              {confirmActiveState.active
                ? `Deactivate ${confirmActiveState.name}?`
                : `Bring ${confirmActiveState.name} back?`}
            </div>
            <div style={{ fontSize: 13, color: 'var(--text-muted)', marginBottom: 20, lineHeight: 1.6 }}>
              {confirmActiveState.active ? (
                <>
                  They&apos;ll be left out of every future schedule build, and Aegis will stop
                  texting and emailing them — it won&apos;t recognise them if they text in either.
                  {' '}
                  <strong style={{ color: 'var(--text-secondary)' }}>
                    Schedules you&apos;ve already published don&apos;t change
                  </strong>
                  , so if they&apos;re on this week&apos;s, they stay on it. Nothing is deleted:
                  their availability, contact details and history are all kept, and Activate brings
                  them back whole.
                </>
              ) : (
                <>
                  Their last day of {formatShortDate(confirmActiveState.last_day as string)} will be
                  cleared, and they&apos;ll go back on the schedule and start hearing from Aegis
                  again.
                </>
              )}
            </div>
            <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
              <button
                className="btn btn-secondary btn-sm"
                onClick={() => setConfirmActiveState(null)}
                disabled={activeStateBusy}
              >
                Cancel
              </button>
              <button
                className="btn btn-sm"
                onClick={() => applyActiveStateChange(confirmActiveState)}
                disabled={activeStateBusy}
                style={confirmActiveState.active
                  ? { background: 'var(--status-blocked-bg)', color: 'var(--status-blocked-text)', border: '1px solid var(--status-blocked-border)' }
                  : { background: 'var(--accent)', color: '#fff', border: '1px solid var(--accent)' }}
              >
                {activeStateBusy
                  ? 'Working…'
                  : (confirmActiveState.active ? 'Deactivate' : 'Activate')}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Add/Edit Form Modal */}
      {showForm && (
        <div style={{ position: 'fixed', inset: 0, zIndex: 200, background: 'rgba(0,0,0,0.7)', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '20px' }}>
          <div style={{ background: 'var(--bg-surface-1)', border: '1px solid var(--border-default)', borderRadius: 'var(--radius-xl)', padding: 28, width: '100%', maxWidth: 560, maxHeight: '90vh', overflowY: 'auto' }}>
            <div style={{ fontFamily: 'var(--font-display)', fontSize: 18, fontWeight: 700, color: 'var(--text-primary)', marginBottom: 20 }}>
              {editingEmployee ? 'Edit Employee' : 'Add Employee'}
            </div>

            <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
              <div className="form-group">
                <label className="form-label">Name</label>
                <input className="form-input" value={form.name} onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))} placeholder="e.g. Lifeguard #21" />
              </div>

              <div className="form-group">
                <label className="form-label">Primary Role</label>
                <select
                  className="form-select"
                  value={form.primary_role}
                  onChange={(e) => setForm((f) => ({ ...f, primary_role: e.target.value }))}
                >
                  <option value="">Select a role...</option>
                  {roles.map((r) => (
                    <option key={r.id} value={r.name}>{r.name}</option>
                  ))}
                </select>
              </div>

              <div className="form-group">
                <label className="form-label">Also Qualifies For <span style={{ color: 'var(--text-muted)', fontWeight: 400 }}>(select all that apply)</span></label>
                <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginTop: 4 }}>
                  {roles.filter((r) => r.name !== form.primary_role).map((r) => {
                    const selected = form.qualified_roles.includes(r.name)
                    return (
                      <button
                        key={r.id}
                        type="button"
                        onClick={() => toggleQualifiedRole(r.name)}
                        style={{
                          padding: '4px 12px',
                          borderRadius: 'var(--radius-pill)',
                          fontSize: 12,
                          fontWeight: 500,
                          border: `1px solid ${selected ? r.color + '88' : 'var(--border-default)'}`,
                          background: selected ? r.color + '22' : 'var(--bg-surface-3)',
                          color: selected ? r.color : 'var(--text-muted)',
                          cursor: 'pointer',
                        }}
                      >
                        {r.name}
                      </button>
                    )
                  })}
                  {roles.filter((r) => r.name !== form.primary_role).length === 0 && (
                    <span style={{ fontSize: 12, color: 'var(--text-disabled)' }}>Select a primary role first</span>
                  )}
                </div>
              </div>

              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
                <div className="form-group">
                  <label className="form-label">Max Weekly Hours</label>
                  <input className="form-input" type="number" value={form.max_weekly_hours} onChange={(e) => setForm((f) => ({ ...f, max_weekly_hours: e.target.value }))} />
                </div>
                <div className="form-group">
                  <label className="form-label">Individual Wage <span style={{ color: 'var(--text-muted)', fontWeight: 400 }}>($/hr)</span></label>
                  <input
                    className="form-input"
                    type="number"
                    step="0.01"
                    min="0"
                    placeholder="Leave blank to use role rate"
                    value={form.individual_wage}
                    onChange={(e) => setForm((f) => ({ ...f, individual_wage: e.target.value }))}
                  />
                </div>
              </div>

              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
                <div className="form-group">
                  <label className="form-label">Email <span style={{ color: 'var(--status-blocked-text)', fontWeight: 400 }}>*</span></label>
                  <input className="form-input" value={form.contact_email} onChange={(e) => setForm((f) => ({ ...f, contact_email: e.target.value }))} placeholder="Required" />
                </div>
                <div className="form-group">
                  <label className="form-label">Phone <span style={{ color: 'var(--status-blocked-text)', fontWeight: 400 }}>*</span></label>
                  <input className="form-input" value={form.contact_phone} onChange={(e) => setForm((f) => ({ ...f, contact_phone: e.target.value }))} placeholder="Required" />
                </div>
              </div>

              <div className="form-group">
                <label className="form-label">Last day <span style={{ color: 'var(--text-muted)', fontWeight: 400 }}>(offboarding)</span></label>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                  <input
                    className="form-input"
                    type="date"
                    value={form.last_day}
                    onChange={(e) => setForm((f) => ({ ...f, last_day: e.target.value }))}
                    style={{ flex: 1 }}
                  />
                  {form.last_day && (
                    <button
                      type="button"
                      className="btn-secondary"
                      onClick={() => setForm((f) => ({ ...f, last_day: '' }))}
                    >
                      Clear
                    </button>
                  )}
                </div>
                <div style={{ fontSize: 11, color: 'var(--text-muted)', lineHeight: 1.55, marginTop: 4 }}>
                  The employee&apos;s final working day. Setting it acknowledges a departure — they&apos;re automatically deactivated and dropped from future schedules after this date. Leave blank (or Clear) for an active employee.
                </div>
              </div>

              <div style={{
                borderTop: '1px solid var(--border-subtle)',
                paddingTop: 16,
                marginTop: 4,
                display: 'flex',
                alignItems: 'flex-start',
                gap: 16,
              }}>
                <div style={{ flex: 1 }}>
                  <div className="form-label" style={{ marginBottom: 4 }}>Veteran</div>
                  <div style={{ fontSize: 11, color: 'var(--text-muted)', lineHeight: 1.55 }}>
                    This employee is a veteran. Managers can use this to prioritize veterans for specific shifts or holidays.
                  </div>
                </div>
                <button
                  type="button"
                  role="switch"
                  aria-checked={form.is_veteran}
                  onClick={() => setForm((f) => ({ ...f, is_veteran: !f.is_veteran }))}
                  style={{
                    position: 'relative',
                    width: 38,
                    height: 22,
                    borderRadius: 11,
                    background: form.is_veteran ? 'var(--accent)' : 'var(--bg-surface-3)',
                    border: `1px solid ${form.is_veteran ? 'var(--accent-border)' : 'var(--border-default)'}`,
                    cursor: 'pointer',
                    padding: 0,
                    flexShrink: 0,
                    marginTop: 2,
                    transition: 'background 150ms, border-color 150ms',
                  }}
                >
                  <span style={{
                    position: 'absolute',
                    top: 2,
                    left: form.is_veteran ? 18 : 2,
                    width: 16,
                    height: 16,
                    borderRadius: '50%',
                    background: 'white',
                    transition: 'left 150ms',
                    boxShadow: '0 1px 2px rgba(0,0,0,0.25)',
                  }} />
                </button>
              </div>

              <div className="form-group">
                <label className="form-label">Sex</label>
                <select
                  className="form-select"
                  value={form.sex}
                  onChange={(e) => setForm((f) => ({ ...f, sex: e.target.value }))}
                >
                  <option value="">Not specified</option>
                  <option value="male">Male</option>
                  <option value="female">Female</option>
                </select>
              </div>

              {editingEmployee && (() => {
                const ca = customAvailability[editingEmployee.id]
                if (isCustomAvailabilityCurrent(ca, todayInTimezone(company?.timezone))) {
                  return (
                    <div style={{
                      background: 'var(--accent-dim)',
                      border: '1px solid var(--accent-border)',
                      borderRadius: 'var(--radius-md)',
                      padding: '10px 12px',
                      display: 'flex',
                      alignItems: 'center',
                      gap: 10,
                      flexWrap: 'wrap',
                    }}>
                      <div style={{ fontSize: 12, color: 'var(--accent)', fontWeight: 500, flex: 1, minWidth: 0 }}>
                        ⚡ Custom availability active until {ca!.end_date ? formatShortDate(ca!.end_date) : '—'}. Normal availability is overridden.
                      </div>
                      <button
                        type="button"
                        onClick={() => editingEmployee && openCustomAvailModal(editingEmployee)}
                        style={{
                          background: 'transparent',
                          border: 'none',
                          color: 'var(--accent)',
                          fontSize: 12,
                          fontWeight: 500,
                          cursor: 'pointer',
                          padding: 0,
                          textDecoration: 'underline',
                          fontFamily: 'var(--font-body)',
                        }}
                      >
                        Edit custom availability
                      </button>
                    </div>
                  )
                }
                return (
                  <button
                    type="button"
                    onClick={() => editingEmployee && openCustomAvailModal(editingEmployee)}
                    style={{
                      alignSelf: 'flex-start',
                      background: 'transparent',
                      border: '1px dashed var(--border-default)',
                      borderRadius: 'var(--radius-md)',
                      padding: '8px 12px',
                      fontSize: 12,
                      color: 'var(--text-muted)',
                      cursor: 'pointer',
                      fontFamily: 'var(--font-body)',
                      fontWeight: 500,
                    }}
                  >
                    + Add Custom Availability
                  </button>
                )
              })()}

              <div style={{ borderTop: '1px solid var(--border-subtle)', paddingTop: 16, marginTop: 4 }}>
                <div className="form-label" style={{ marginBottom: 12 }}>Availability</div>
                <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                  {availForm.map((row) => (
                    <div key={row.day} style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                      <button
                        type="button"
                        onClick={() => toggleDay(row.day)}
                        style={{
                          width: 44,
                          padding: '4px 0',
                          borderRadius: 'var(--radius-sm)',
                          border: '1px solid',
                          fontSize: 11,
                          fontFamily: 'var(--font-body)',
                          fontWeight: 500,
                          cursor: 'pointer',
                          background: row.active ? 'var(--accent-dim)' : 'var(--bg-surface-3)',
                          borderColor: row.active ? 'var(--accent-border)' : 'var(--border-default)',
                          color: row.active ? 'var(--accent)' : 'var(--text-muted)',
                          textAlign: 'center',
                        }}
                      >
                        {DAYS[row.day]}
                      </button>
                      {row.active ? (
                        <>
                          <input type="time" className="form-input" style={{ width: 120 }} value={row.start_time} onChange={(e) => updateAvailTime(row.day, 'start_time', e.target.value)} />
                          <span style={{ color: 'var(--text-muted)', fontSize: 12 }}>to</span>
                          <input type="time" className="form-input" style={{ width: 120 }} value={row.end_time} onChange={(e) => updateAvailTime(row.day, 'end_time', e.target.value)} />
                        </>
                      ) : (
                        <span style={{ fontSize: 12, color: 'var(--text-disabled)' }}>Off</span>
                      )}
                    </div>
                  ))}
                </div>
              </div>
            </div>

            {error && (
              <div style={{ fontSize: 12, color: 'var(--status-blocked-text)', marginTop: 12 }}>
                {error}
              </div>
            )}

            <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 20, flexWrap: 'wrap' }}>
              {editingEmployee && (
                <button
                  className="btn btn-secondary btn-sm"
                  onClick={() => startActiveStateChange(editingEmployee)}
                  disabled={activeStateBusy || saving}
                  style={editingEmployee.active
                    ? { color: 'var(--status-blocked-text)', borderColor: 'var(--status-blocked-border)' }
                    : undefined}
                >
                  {activeStateBusy ? 'Working…' : activeStateLabel(editingEmployee)}
                </button>
              )}
              <div style={{ marginLeft: 'auto', display: 'flex', gap: 8 }}>
                <button className="btn btn-secondary btn-sm" onClick={() => setShowForm(false)}>Cancel</button>
                <button className="btn btn-primary btn-sm" onClick={handleSave} disabled={saving || activeStateBusy}>
                  {saving ? 'Saving...' : 'Save Employee'}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Custom Availability Modal */}
      {customAvailTarget && customAvailForm && (
        <div
          onClick={closeCustomAvailModal}
          style={{
            position: 'fixed', inset: 0, zIndex: 300,
            background: 'rgba(0,0,0,0.7)',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            padding: 20,
          }}
        >
          <div
            onClick={e => e.stopPropagation()}
            style={{
              background: 'var(--bg-surface-1)',
              border: '1px solid var(--border-default)',
              borderRadius: 'var(--radius-xl)',
              padding: 28,
              width: '100%',
              maxWidth: 640,
              maxHeight: '90vh',
              overflowY: 'auto',
            }}
          >
            <div style={{ fontFamily: 'var(--font-display)', fontSize: 18, fontWeight: 700, color: 'var(--text-primary)', marginBottom: 6 }}>
              {editingCustomAvail ? 'Custom Availability' : 'Set Custom Availability'} — {customAvailTarget.name}
            </div>
            <div style={{ fontSize: 11, color: 'var(--text-muted)', marginBottom: 20, lineHeight: 1.5 }}>
              Override an employee&rsquo;s standard weekly availability for a defined period.
            </div>

            <div style={{ display: 'flex', flexDirection: 'column', gap: 18 }}>

              {/* Type selector */}
              <div style={{ display: 'flex', gap: 8 }}>
                {(['date_limited', 'rotating'] as const).map(t => {
                  const active = customAvailForm.type === t
                  return (
                    <button
                      key={t}
                      type="button"
                      onClick={() => setCustomAvailType(t)}
                      style={{
                        flex: 1,
                        textAlign: 'left',
                        padding: '12px 14px',
                        borderRadius: 'var(--radius-md)',
                        border: '1px solid',
                        background: active ? 'var(--accent-dim)' : 'var(--bg-surface-2)',
                        borderColor: active ? 'var(--accent-border)' : 'var(--border-default)',
                        color: active ? 'var(--accent)' : 'var(--text-secondary)',
                        cursor: 'pointer',
                        fontFamily: 'var(--font-body)',
                      }}
                    >
                      <div style={{ fontSize: 12, fontWeight: 700, marginBottom: 4 }}>
                        {t === 'date_limited' ? 'Date-Limited' : 'Rotating'}
                      </div>
                      <div style={{ fontSize: 10, color: 'var(--text-muted)', lineHeight: 1.45, fontWeight: 400 }}>
                        {t === 'date_limited'
                          ? 'Employee has specific availability until a set date, then reverts to normal.'
                          : 'Employee follows a repeating weekly pattern until a set date.'}
                      </div>
                    </button>
                  )
                })}
              </div>

              {/* End date */}
              <div className="form-group">
                <label className="form-label">Active until</label>
                <input
                  className="form-input"
                  type="date"
                  value={customAvailForm.end_date}
                  onChange={(e) => setCustomAvailForm(prev => prev ? { ...prev, end_date: e.target.value } : prev)}
                />
                <div style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 4 }}>
                  Normal availability resumes automatically after this date.
                </div>
              </div>

              {/* Rotating: cycle settings */}
              {customAvailForm.type === 'rotating' && (
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
                  <div className="form-group">
                    <label className="form-label">How many weeks in the cycle?</label>
                    <input
                      className="form-input"
                      type="number"
                      min={1}
                      max={8}
                      value={customAvailForm.cycle_weeks}
                      onChange={(e) => setCycleWeeks(parseInt(e.target.value) || 1)}
                    />
                  </div>
                  <div className="form-group">
                    <label className="form-label">Cycle start date</label>
                    <input
                      className="form-input"
                      type="date"
                      value={customAvailForm.cycle_start_date}
                      onChange={(e) => setCustomAvailForm(prev => prev ? { ...prev, cycle_start_date: e.target.value } : prev)}
                    />
                  </div>
                </div>
              )}

              {/* Week blocks */}
              <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
                {customAvailForm.weeks.map((week, weekIdx) => (
                  <div
                    key={weekIdx}
                    style={{
                      border: '1px solid var(--border-subtle)',
                      borderRadius: 'var(--radius-md)',
                      padding: 14,
                      background: 'var(--bg-surface-2)',
                    }}
                  >
                    <div className="form-label" style={{ marginBottom: 10 }}>
                      {customAvailForm.type === 'date_limited' ? 'Availability during this period' : `Week ${weekIdx + 1}`}
                    </div>
                    <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                      {week.map(row => (
                        <div key={row.day} style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                          <button
                            type="button"
                            onClick={() => toggleCustomDay(weekIdx, row.day)}
                            style={{
                              width: 44,
                              padding: '4px 0',
                              borderRadius: 'var(--radius-sm)',
                              border: '1px solid',
                              fontSize: 11,
                              fontFamily: 'var(--font-body)',
                              fontWeight: 500,
                              cursor: 'pointer',
                              background: row.active ? 'var(--accent-dim)' : 'var(--bg-surface-3)',
                              borderColor: row.active ? 'var(--accent-border)' : 'var(--border-default)',
                              color: row.active ? 'var(--accent)' : 'var(--text-muted)',
                              textAlign: 'center',
                            }}
                          >
                            {DAYS[row.day]}
                          </button>
                          {row.active ? (
                            <>
                              <input
                                type="time"
                                className="form-input"
                                style={{ width: 120 }}
                                value={row.start_time}
                                onChange={(e) => updateCustomDayTime(weekIdx, row.day, 'start_time', e.target.value)}
                              />
                              <span style={{ color: 'var(--text-muted)', fontSize: 12 }}>to</span>
                              <input
                                type="time"
                                className="form-input"
                                style={{ width: 120 }}
                                value={row.end_time}
                                onChange={(e) => updateCustomDayTime(weekIdx, row.day, 'end_time', e.target.value)}
                              />
                            </>
                          ) : (
                            <span style={{ fontSize: 12, color: 'var(--text-disabled)' }}>Off</span>
                          )}
                        </div>
                      ))}
                    </div>
                  </div>
                ))}
              </div>
            </div>

            {customAvailError && (
              <div style={{ fontSize: 12, color: 'var(--status-blocked-text)', marginTop: 14 }}>
                {customAvailError}
              </div>
            )}

            <div style={{ display: 'flex', alignItems: 'center', marginTop: 22, gap: 8, flexWrap: 'wrap' }}>
              {editingCustomAvail && (
                <button
                  type="button"
                  onClick={removeCustomAvail}
                  disabled={removingCustomAvail || savingCustomAvail}
                  style={{
                    background: 'transparent',
                    border: 'none',
                    color: '#ef4444',
                    fontSize: 12,
                    fontWeight: 500,
                    cursor: removingCustomAvail || savingCustomAvail ? 'default' : 'pointer',
                    padding: 0,
                    fontFamily: 'var(--font-body)',
                    opacity: removingCustomAvail || savingCustomAvail ? 0.6 : 1,
                  }}
                >
                  {removingCustomAvail ? 'Removing…' : 'Remove Custom Availability'}
                </button>
              )}
              <div style={{ marginLeft: 'auto', display: 'flex', gap: 8 }}>
                <button
                  className="btn btn-secondary btn-sm"
                  onClick={closeCustomAvailModal}
                  disabled={savingCustomAvail || removingCustomAvail}
                >
                  Cancel
                </button>
                <button
                  className="btn btn-primary btn-sm"
                  onClick={saveCustomAvail}
                  disabled={savingCustomAvail || removingCustomAvail}
                >
                  {savingCustomAvail ? 'Saving…' : (editingCustomAvail ? 'Save Changes' : 'Save Custom Availability')}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}