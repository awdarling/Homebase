'use client'
import { useCompany } from '@/lib/hooks/useCompany'
import { useQuria } from '@/lib/hooks/useQuria'

import { useEffect, useState } from 'react'
import { createClient } from '@/lib/supabase/client'
import { logActivity as logActivityFn } from '@/lib/activity'
import type { Employee } from '@/lib/types'

const DAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']

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
  start_time: '09:00',
  end_time: '17:00',
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

function VeteranBadge() {
  return (
    <span style={{
      display: 'inline-block',
      padding: '1px 7px',
      borderRadius: 'var(--radius-pill)',
      fontSize: 9,
      fontWeight: 700,
      letterSpacing: '0.08em',
      textTransform: 'uppercase',
      background: 'rgba(220, 38, 38, 0.1)',
      border: '1px solid rgba(220, 38, 38, 0.25)',
      color: '#dc2626',
    }}>
      Veteran
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
  })
  const [availForm, setAvailForm] = useState<AvailabilityRow[]>(DEFAULT_AVAILABILITY)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null)

  const supabase = createClient()

  useEffect(() => { if (COMPANY_ID) fetchData() }, [COMPANY_ID])

  async function fetchData() {
    if (!COMPANY_ID) return
    setLoading(true)
    const [empRes, avRes, rolesRes] = await Promise.all([
      supabase.from('employees').select('*').eq('company_id', COMPANY_ID).order('primary_role').order('name'),
      supabase.from('availability').select('*').eq('company_id', COMPANY_ID),
      supabase.from('roles').select('*').eq('company_id', COMPANY_ID).order('name'),
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

    // Save flow always writes active: true, so this branch only fires when an
    // inactive employee is being reactivated through the edit form.
    if (oldEmp.active === false) {
      parts.push('reactivated')
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
        start_time: found ? found.start.slice(0, 5) : '09:00',
        end_time: found ? found.end.slice(0, 5) : '17:00',
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
      active: true,
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
      const { data } = await supabase.from('employees').insert(payload).select().single()
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

  async function handleToggleActive(emp: Employee) {
    await supabase.from('employees').update({ active: !emp.active }).eq('id', emp.id)
    await logActivity(
      emp.active ? 'employee_deactivated' : 'employee_activated',
      `${emp.active ? 'Deactivated' : 'Activated'} employee: ${emp.name}`,
      emp.id
    )
    fetchData()
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
      }}>
        <table className="data-table" style={{ tableLayout: 'fixed', width: '100%' }}>
          <colgroup>
            <col style={{ width: '16%' }} />
            <col style={{ width: '7%' }} />
            <col style={{ width: '10%' }} />
            <col style={{ width: '12%' }} />
            <col style={{ width: '14%' }} />
            <col style={{ width: '13%' }} />
            <col style={{ width: '13%' }} />
            <col style={{ width: '8%' }} />
            <col style={{ width: '7%' }} />
          </colgroup>
          <thead>
            <tr>
              <th>Employee</th>
              <th>Veteran</th>
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
                        <div style={{ color: 'var(--text-primary)', fontSize: 13 }}>{emp.name}</div>
                        <div style={{ fontSize: 10, color: emp.active ? 'var(--status-ready-text)' : 'var(--text-disabled)', marginTop: 1 }}>
                          {emp.active ? 'Active' : 'Inactive'}
                        </div>
                      </div>
                    </div>
                  </td>
                  <td style={{ textAlign: 'center' }}>
                    {emp.is_veteran && <VeteranBadge />}
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
                    background: form.is_veteran ? '#dc2626' : 'var(--bg-surface-3)',
                    border: `1px solid ${form.is_veteran ? 'rgba(220,38,38,0.5)' : 'var(--border-default)'}`,
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

            <div style={{ display: 'flex', gap: 8, marginTop: 20, justifyContent: 'flex-end' }}>
              <button className="btn btn-secondary btn-sm" onClick={() => setShowForm(false)}>Cancel</button>
              <button className="btn btn-primary btn-sm" onClick={handleSave} disabled={saving}>
                {saving ? 'Saving...' : 'Save Employee'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}