'use client'

import { useEffect, useState } from 'react'
import { createClient } from '@/lib/supabase/client'
import type { Employee } from '@/lib/types'

const DAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']

const ROLE_COLORS: Record<string, string> = {
  Greeter: '#3b82f6',
  Lifeguard: '#10b981',
  Headguard: '#f97316',
  AsstManager: '#8b5cf6',
  Manager: '#ef4444',
}

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

function RoleBadge({ role }: { role: string }) {
  const color = ROLE_COLORS[role] ?? '#666'
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

function InitialsAvatar({ name, role }: { name: string; role: string }) {
  const initials = name.split(' ').map((w) => w[0]).join('').slice(0, 2).toUpperCase()
  const color = ROLE_COLORS[role] ?? '#666'
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

export default function EmployeesTab() {
  const [employees, setEmployees] = useState<Employee[]>([])
  const [availability, setAvailability] = useState<Record<string, { day: number; start: string; end: string }[]>>({})
  const [loading, setLoading] = useState(true)
  const [search, setSearch] = useState('')
  const [roleFilter, setRoleFilter] = useState('all')
  const [showForm, setShowForm] = useState(false)
  const [editingEmployee, setEditingEmployee] = useState<Employee | null>(null)
  const [form, setForm] = useState({
    name: '',
    primary_role: '',
    qualified_roles: '',
    max_weekly_hours: '40',
    contact_phone: '',
    contact_email: '',
  })
  const [availForm, setAvailForm] = useState<AvailabilityRow[]>(DEFAULT_AVAILABILITY)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null)

  const supabase = createClient()
  const COMPANY_ID = 'a1b2c3d4-e5f6-7890-abcd-ef1234567890'

  useEffect(() => { fetchData() }, [])

  async function fetchData() {
    setLoading(true)
    const [empRes, avRes] = await Promise.all([
      supabase.from('employees').select('*').eq('company_id', COMPANY_ID).order('primary_role').order('name'),
      supabase.from('availability').select('*').eq('company_id', COMPANY_ID),
    ])
    if (empRes.data) setEmployees(empRes.data)
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

  const roles = ['all', ...Array.from(new Set(employees.map((e) => e.primary_role)))]

  const filtered = employees.filter((e) => {
    const matchSearch = e.name.toLowerCase().includes(search.toLowerCase())
    const matchRole = roleFilter === 'all' || e.primary_role === roleFilter
    return matchSearch && matchRole
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
    setForm({ name: '', primary_role: '', qualified_roles: '', max_weekly_hours: '40', contact_phone: '', contact_email: '' })
    setAvailForm(DEFAULT_AVAILABILITY)
    setError('')
    setShowForm(true)
  }

  function openEdit(emp: Employee) {
    setEditingEmployee(emp)
    setForm({
      name: emp.name,
      primary_role: emp.primary_role,
      qualified_roles: emp.qualified_roles.join(', '),
      max_weekly_hours: String(emp.max_weekly_hours),
      contact_phone: emp.contact_phone ?? '',
      contact_email: emp.contact_email ?? '',
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

  async function handleSave() {
    if (!form.name.trim() || !form.primary_role.trim()) {
      setError('Name and role are required.')
      return
    }
    setSaving(true)
    setError('')

    const payload = {
      company_id: COMPANY_ID,
      name: form.name.trim(),
      primary_role: form.primary_role.trim(),
      qualified_roles: form.qualified_roles.split(',').map((r) => r.trim()).filter(Boolean),
      max_weekly_hours: parseInt(form.max_weekly_hours) || 40,
      contact_phone: form.contact_phone.trim() || null,
      contact_email: form.contact_email.trim() || null,
      active: true,
    }

    let empId = editingEmployee?.id

    if (editingEmployee) {
      await supabase.from('employees').update(payload).eq('id', editingEmployee.id)
    } else {
      const { data } = await supabase.from('employees').insert(payload).select().single()
      empId = data?.id
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
    await supabase.from('availability').delete().eq('employee_id', id)
    await supabase.from('employees').delete().eq('id', id)
    setConfirmDeleteId(null)
    fetchData()
  }

  async function handleToggleActive(emp: Employee) {
    await supabase.from('employees').update({ active: !emp.active }).eq('id', emp.id)
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
          {roles.map((r) => (
            <option key={r} value={r}>{r === 'all' ? 'All roles' : r}</option>
          ))}
        </select>
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
            <col style={{ width: '20%' }} />
            <col style={{ width: '12%' }} />
            <col style={{ width: '16%' }} />
            <col style={{ width: '28%' }} />
            <col style={{ width: '9%' }} />
            <col style={{ width: '9%' }} />
            <col style={{ width: '6%' }} />
          </colgroup>
          <thead>
            <tr>
              <th>Employee</th>
              <th>Role</th>
              <th>Also Qualifies</th>
              <th>Availability</th>
              <th>Max Hrs</th>
              <th>Status</th>
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
                      <InitialsAvatar name={emp.name} role={emp.primary_role} />
                      <span style={{ color: 'var(--text-primary)', fontSize: 13 }}>
                        {emp.name}
                      </span>
                    </div>
                  </td>
                  <td><RoleBadge role={emp.primary_role} /></td>
                  <td>
                    <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap' }}>
                      {emp.qualified_roles.filter((r) => r !== emp.primary_role).map((r) => (
                        <RoleBadge key={r} role={r} />
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
                  <td style={{ color: 'var(--text-secondary)', fontSize: 13 }}>
                    {emp.max_weekly_hours}h
                  </td>
                  <td>
                    <span
                      className={`badge ${emp.active ? 'badge-ready' : 'badge-blocked'}`}
                      onClick={(e) => { e.stopPropagation(); handleToggleActive(emp) }}
                      style={{ cursor: 'pointer' }}
                    >
                      {emp.active ? 'Active' : 'Inactive'}
                    </span>
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
                      title="Delete employee"
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
        <div style={{
          position: 'fixed', inset: 0, zIndex: 200,
          background: 'rgba(0,0,0,0.7)',
          display: 'flex', alignItems: 'center', justifyContent: 'center',
        }}>
          <div style={{
            background: 'var(--bg-surface-1)',
            border: '1px solid var(--border-default)',
            borderRadius: 'var(--radius-xl)',
            padding: 28,
            width: '100%',
            maxWidth: 380,
          }}>
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
                style={{
                  background: 'var(--status-blocked-bg)',
                  color: 'var(--status-blocked-text)',
                  border: '1px solid var(--status-blocked-border)',
                }}
              >
                Delete Permanently
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Add/Edit Form Modal */}
      {showForm && (
        <div style={{
          position: 'fixed', inset: 0, zIndex: 200,
          background: 'rgba(0,0,0,0.7)',
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          padding: '20px',
        }}>
          <div style={{
            background: 'var(--bg-surface-1)',
            border: '1px solid var(--border-default)',
            borderRadius: 'var(--radius-xl)',
            padding: 28,
            width: '100%',
            maxWidth: 560,
            maxHeight: '90vh',
            overflowY: 'auto',
          }}>
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
                <input className="form-input" value={form.primary_role} onChange={(e) => setForm((f) => ({ ...f, primary_role: e.target.value }))} placeholder="e.g. Lifeguard" />
              </div>
              <div className="form-group">
                <label className="form-label">Qualified Roles (comma separated)</label>
                <input className="form-input" value={form.qualified_roles} onChange={(e) => setForm((f) => ({ ...f, qualified_roles: e.target.value }))} placeholder="e.g. Lifeguard, Headguard" />
              </div>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
                <div className="form-group">
                  <label className="form-label">Max Weekly Hours</label>
                  <input className="form-input" type="number" value={form.max_weekly_hours} onChange={(e) => setForm((f) => ({ ...f, max_weekly_hours: e.target.value }))} />
                </div>
                <div className="form-group">
                  <label className="form-label">Phone</label>
                  <input className="form-input" value={form.contact_phone} onChange={(e) => setForm((f) => ({ ...f, contact_phone: e.target.value }))} placeholder="Optional" />
                </div>
              </div>
              <div className="form-group">
                <label className="form-label">Email</label>
                <input className="form-input" value={form.contact_email} onChange={(e) => setForm((f) => ({ ...f, contact_email: e.target.value }))} placeholder="Optional" />
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
                          <input
                            type="time"
                            className="form-input"
                            style={{ width: 120 }}
                            value={row.start_time}
                            onChange={(e) => updateAvailTime(row.day, 'start_time', e.target.value)}
                          />
                          <span style={{ color: 'var(--text-muted)', fontSize: 12 }}>to</span>
                          <input
                            type="time"
                            className="form-input"
                            style={{ width: 120 }}
                            value={row.end_time}
                            onChange={(e) => updateAvailTime(row.day, 'end_time', e.target.value)}
                          />
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