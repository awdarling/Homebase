'use client'

import { useEffect, useRef, useState } from 'react'
import { createClient } from '@/lib/supabase/client'
import type { ScheduleAssignment, ScheduleTemplate } from '@/lib/types'

interface AddShiftPanelProps {
  companyId: string
  weekStart: string  // ISO yyyy-mm-dd
  weekEnd: string
  template: ScheduleTemplate
  onClose: () => void
  onAdd: (assignment: ScheduleAssignment) => void
}

interface EmployeeRow {
  id: string
  name: string
  primary_role: string
  qualified_roles: string[]
}

interface ShiftTypeRow {
  id: string
  name: string
  start_time: string
  end_time: string
  days_active: number[]
}

interface RoleRow {
  name: string
}

function getWeekDates(weekStart: string): string[] {
  return Array.from({ length: 7 }, (_, i) => {
    const d = new Date(weekStart)
    d.setDate(d.getDate() + i)
    return d.toISOString().split('T')[0]
  })
}

function formatDateLong(d: string) {
  const [y, m, day] = d.split('-').map(Number)
  return new Date(y, m - 1, day).toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' })
}

function timeToHours(start: string, end: string): number {
  const [sh, sm] = start.split(':').map(Number)
  const [eh, em] = end.split(':').map(Number)
  return Math.max(0, ((eh * 60 + em) - (sh * 60 + sm)) / 60)
}

export default function AddShiftPanel({
  companyId,
  weekStart,
  weekEnd,
  template,
  onClose,
  onAdd,
}: AddShiftPanelProps) {
  const supabase = createClient()

  const [employees, setEmployees] = useState<EmployeeRow[]>([])
  const [shiftTypes, setShiftTypes] = useState<ShiftTypeRow[]>([])
  const [roles, setRoles] = useState<string[]>([])
  const [loading, setLoading] = useState(true)

  const [search, setSearch] = useState('')
  const [employee, setEmployee] = useState<EmployeeRow | null>(null)
  const [showDropdown, setShowDropdown] = useState(false)
  const searchRef = useRef<HTMLDivElement>(null)

  const dates = getWeekDates(weekStart)
  const [date, setDate] = useState<string>(dates[0])
  const [shiftName, setShiftName] = useState<string>('')
  const [role, setRole] = useState<string>('')
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    async function load() {
      setLoading(true)
      const [empRes, stRes, rolesRes] = await Promise.all([
        supabase.from('employees')
          .select('id, name, primary_role, qualified_roles')
          .eq('company_id', companyId)
          .eq('active', true)
          .order('name'),
        supabase.from('shift_types')
          .select('id, name, start_time, end_time, days_active')
          .eq('company_id', companyId)
          .eq('active', true),
        supabase.from('roles')
          .select('name')
          .eq('company_id', companyId)
          .order('name'),
      ])
      setEmployees((empRes.data ?? []) as EmployeeRow[])
      setShiftTypes((stRes.data ?? []) as ShiftTypeRow[])
      setRoles(((rolesRes.data ?? []) as RoleRow[]).map(r => r.name))
      const firstShift = (stRes.data ?? [])[0] as ShiftTypeRow | undefined
      if (firstShift) setShiftName(firstShift.name)
      setLoading(false)
    }
    load()
  }, [companyId, supabase])

  useEffect(() => {
    function handleClick(e: MouseEvent) {
      if (searchRef.current && !searchRef.current.contains(e.target as Node)) {
        setShowDropdown(false)
      }
    }
    document.addEventListener('mousedown', handleClick)
    return () => document.removeEventListener('mousedown', handleClick)
  }, [])

  // When the employee changes, default the role to their primary
  useEffect(() => {
    if (employee && !role) setRole(employee.primary_role)
  }, [employee, role])

  const filtered = search.trim()
    ? employees.filter(e => e.name.toLowerCase().includes(search.toLowerCase())).slice(0, 8)
    : []

  const selectedShift = shiftTypes.find(s => s.name === shiftName) ?? null

  function handleSubmit() {
    setError(null)
    if (!employee) { setError('Pick an employee.'); return }
    if (!shiftName) { setError('Pick a shift.'); return }
    if (!role) { setError('Pick a role.'); return }
    if (!selectedShift) { setError('Selected shift not found.'); return }

    const dayOfWeek = new Date(date).getDay()
    if (!selectedShift.days_active.includes(dayOfWeek)) {
      setError(`The ${shiftName} shift does not run on ${new Date(date).toLocaleDateString('en-US', { weekday: 'long' })}.`)
      return
    }

    setSubmitting(true)
    const assignment: ScheduleAssignment = {
      date,
      employee_id: employee.id,
      employee_name: employee.name,
      shift_name: shiftName,
      role,
      start_time: selectedShift.start_time,
      end_time: selectedShift.end_time,
      hours: timeToHours(selectedShift.start_time, selectedShift.end_time),
    }
    onAdd(assignment)
    setSubmitting(false)
    onClose()
  }

  // Use template row IDs so the assignment lands in a visible row
  const shiftOptions = template.row_config
    .filter(r => r.visible)
    .map(r => r.id)

  // If template has shifts not in shift_types, still let user pick (best-effort)
  const allShiftNames = Array.from(new Set([...shiftOptions, ...shiftTypes.map(s => s.name)]))

  return (
    <>
      <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.4)', zIndex: 900 }} onClick={onClose} />

      <div style={{
        position: 'fixed', top: 0, right: 0, bottom: 0,
        width: 500, maxWidth: '100vw',
        background: 'var(--bg-surface-1)',
        borderLeft: '1px solid var(--border-default)',
        zIndex: 901,
        display: 'flex', flexDirection: 'column', overflow: 'hidden',
        boxShadow: '-8px 0 32px rgba(0,0,0,0.2)',
      }}>

        <div style={{ padding: '20px 24px', borderBottom: '1px solid var(--border-default)', flexShrink: 0 }}>
          <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between' }}>
            <div>
              <div style={{ fontFamily: 'var(--font-display)', fontSize: 16, fontWeight: 700, color: 'var(--text-primary)' }}>
                Add Shift
              </div>
              <div style={{ fontSize: 12, color: 'var(--text-muted)', marginTop: 3 }}>
                Add an employee to any shift this week
              </div>
            </div>
            <button onClick={onClose} style={{ background: 'transparent', border: 'none', cursor: 'pointer', color: 'var(--text-muted)', fontSize: 22, lineHeight: 1, padding: '0 4px' }}>×</button>
          </div>
        </div>

        <div style={{ flex: 1, overflowY: 'auto', padding: '20px 24px' }}>
          {loading ? (
            <div style={{ padding: '32px 0', textAlign: 'center', color: 'var(--text-muted)', fontSize: 13 }}>
              Loading...
            </div>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>

              <div ref={searchRef} style={{ position: 'relative' }}>
                <div className="form-group" style={{ marginBottom: 0 }}>
                  <label className="form-label">Employee</label>
                  <input
                    className="form-input"
                    placeholder="Search by name..."
                    value={employee ? employee.name : search}
                    onChange={e => {
                      setSearch(e.target.value)
                      setEmployee(null)
                      setShowDropdown(true)
                    }}
                    onFocus={() => setShowDropdown(true)}
                  />
                </div>
                {showDropdown && filtered.length > 0 && !employee && (
                  <div style={{
                    position: 'absolute', top: '100%', left: 0, right: 0, zIndex: 10,
                    background: 'var(--bg-surface-1)', border: '1px solid var(--border-default)',
                    borderRadius: 'var(--radius-md)', boxShadow: '0 4px 16px rgba(0,0,0,0.2)',
                    maxHeight: 220, overflowY: 'auto',
                  }}>
                    {filtered.map(e => (
                      <div
                        key={e.id}
                        onClick={() => {
                          setEmployee(e)
                          setRole(e.primary_role)
                          setSearch('')
                          setShowDropdown(false)
                        }}
                        style={{ padding: '10px 14px', fontSize: 13, color: 'var(--text-primary)', cursor: 'pointer', borderBottom: '1px solid var(--border-subtle)' }}
                        onMouseEnter={ev => (ev.currentTarget.style.background = 'var(--bg-surface-2)')}
                        onMouseLeave={ev => (ev.currentTarget.style.background = 'transparent')}
                      >
                        <div>{e.name}</div>
                        <div style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 1 }}>{e.primary_role}</div>
                      </div>
                    ))}
                  </div>
                )}
              </div>

              <div className="form-group" style={{ marginBottom: 0 }}>
                <label className="form-label">Date</label>
                <select className="form-select" value={date} onChange={e => setDate(e.target.value)}>
                  {dates.map(d => (
                    <option key={d} value={d}>{formatDateLong(d)}</option>
                  ))}
                </select>
                <div style={{ fontSize: 10, color: 'var(--text-muted)', marginTop: 4 }}>
                  This week: {formatDateLong(weekStart)} – {formatDateLong(weekEnd)}
                </div>
              </div>

              <div className="form-group" style={{ marginBottom: 0 }}>
                <label className="form-label">Shift</label>
                <select className="form-select" value={shiftName} onChange={e => setShiftName(e.target.value)}>
                  {allShiftNames.length === 0 && <option value="">(no shifts configured)</option>}
                  {allShiftNames.map(s => (
                    <option key={s} value={s}>{s}</option>
                  ))}
                </select>
                {selectedShift && (
                  <div style={{ fontSize: 10, color: 'var(--text-muted)', marginTop: 4 }}>
                    {selectedShift.start_time} – {selectedShift.end_time} · {timeToHours(selectedShift.start_time, selectedShift.end_time)}h
                  </div>
                )}
              </div>

              <div className="form-group" style={{ marginBottom: 0 }}>
                <label className="form-label">Role</label>
                <select className="form-select" value={role} onChange={e => setRole(e.target.value)}>
                  {(roles.length > 0 ? roles : (employee ? [employee.primary_role] : [])).map(r => (
                    <option key={r} value={r}>{r}</option>
                  ))}
                </select>
                {employee && (
                  <div style={{ fontSize: 10, color: 'var(--text-muted)', marginTop: 4 }}>
                    {employee.name}&apos;s primary role: {employee.primary_role}
                    {employee.qualified_roles.length > 0 ? ` · qualified: ${employee.qualified_roles.join(', ')}` : ''}
                  </div>
                )}
              </div>

              {error && (
                <div style={{
                  padding: '10px 12px',
                  background: 'rgba(239,68,68,0.06)',
                  border: '1px solid rgba(239,68,68,0.25)',
                  borderRadius: 'var(--radius-md)',
                  fontSize: 12,
                  color: '#ef4444',
                }}>
                  {error}
                </div>
              )}

              <div style={{ fontSize: 11, color: 'var(--text-muted)', lineHeight: 1.6 }}>
                The new assignment will be added to your pending changes. Soteria will validate it
                along with the rest of your edits when you click Review Changes.
              </div>
            </div>
          )}
        </div>

        <div style={{
          padding: '16px 24px',
          borderTop: '1px solid var(--border-default)',
          display: 'flex',
          gap: 8,
          justifyContent: 'flex-end',
          flexShrink: 0,
          background: 'var(--bg-surface-1)',
        }}>
          <button className="btn btn-secondary btn-sm" onClick={onClose} disabled={submitting}>
            Cancel
          </button>
          <button
            className="btn btn-primary btn-sm"
            disabled={!employee || !shiftName || !role || submitting}
            onClick={handleSubmit}
          >
            Add to Pending
          </button>
        </div>
      </div>
    </>
  )
}
