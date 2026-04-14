'use client'

import { useEffect, useState } from 'react'
import { createClient } from '@/lib/supabase/client'
import type { ShiftRequirement } from '@/lib/types'

const DAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']
const COMPANY_ID = 'a1b2c3d4-e5f6-7890-abcd-ef1234567890'

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

export default function ShiftRequirementsTab() {
  const [shifts, setShifts] = useState<ShiftRequirement[]>([])
  const [loading, setLoading] = useState(true)
  const [showForm, setShowForm] = useState(false)
  const [editing, setEditing] = useState<ShiftRequirement | null>(null)
  const [form, setForm] = useState({
    shift_name: '',
    role: '',
    required_count: '1',
    start_time: '',
    end_time: '',
    days_active: [] as number[],
  })
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')

  const supabase = createClient()

  useEffect(() => { fetchData() }, [])

  async function fetchData() {
    setLoading(true)
    const { data } = await supabase
      .from('shift_requirements')
      .select('*')
      .eq('company_id', COMPANY_ID)
      .order('shift_name')
      .order('role')
    if (data) setShifts(data)
    setLoading(false)
  }

  function openAdd() {
    setEditing(null)
    setForm({ shift_name: '', role: '', required_count: '1', start_time: '', end_time: '', days_active: [] })
    setError('')
    setShowForm(true)
  }

  function openEdit(s: ShiftRequirement) {
    setEditing(s)
    setForm({
      shift_name: s.shift_name,
      role: s.role,
      required_count: String(s.required_count),
      start_time: s.start_time,
      end_time: s.end_time,
      days_active: s.days_active,
    })
    setError('')
    setShowForm(true)
  }

  function toggleDay(day: number) {
    setForm((f) => ({
      ...f,
      days_active: f.days_active.includes(day)
        ? f.days_active.filter((d) => d !== day)
        : [...f.days_active, day].sort(),
    }))
  }

  async function handleSave() {
    if (!form.shift_name || !form.role || !form.start_time || !form.end_time) {
      setError('All fields are required.')
      return
    }
    if (form.days_active.length === 0) {
      setError('Select at least one day.')
      return
    }
    setSaving(true)
    const payload = {
      company_id: COMPANY_ID,
      shift_name: form.shift_name.trim(),
      role: form.role.trim(),
      required_count: parseInt(form.required_count) || 1,
      start_time: form.start_time,
      end_time: form.end_time,
      days_active: form.days_active,
    }
    if (editing) {
      await supabase.from('shift_requirements').update(payload).eq('id', editing.id)
    } else {
      await supabase.from('shift_requirements').insert(payload)
    }
    setSaving(false)
    setShowForm(false)
    fetchData()
  }

  async function handleDeleteOne(id: string) {
    await supabase.from('shift_requirements').delete().eq('id', id)
    fetchData()
  }

  async function handleDeleteGroup(shiftName: string) {
    await supabase
      .from('shift_requirements')
      .delete()
      .eq('company_id', COMPANY_ID)
      .eq('shift_name', shiftName)
    fetchData()
  }

  const grouped = shifts.reduce((acc, s) => {
    if (!acc[s.shift_name]) acc[s.shift_name] = []
    acc[s.shift_name].push(s)
    return acc
  }, {} as Record<string, ShiftRequirement[]>)

  if (loading) return (
    <div style={{ padding: '48px 0', textAlign: 'center', color: 'var(--text-muted)', fontSize: 13 }}>
      Loading shift requirements...
    </div>
  )

  return (
    <div>
      <div style={{ display: 'flex', justifyContent: 'flex-end', marginBottom: 16 }}>
        <button className="btn btn-primary btn-sm" onClick={openAdd}>+ Add Shift</button>
      </div>

      <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
        {Object.entries(grouped).map(([shiftName, shiftRows]) => (
          <div key={shiftName} style={{
            background: 'var(--bg-surface-1)',
            border: '1px solid var(--border-default)',
            borderRadius: 'var(--radius-lg)',
            overflow: 'hidden',
          }}>
            <div style={{
              padding: '12px 16px',
              borderBottom: '1px solid var(--border-subtle)',
              display: 'flex',
              alignItems: 'center',
              gap: 10,
            }}>
              <div style={{ fontFamily: 'var(--font-display)', fontSize: 13, fontWeight: 700, color: 'var(--text-primary)', letterSpacing: '0.05em' }}>
                {shiftName} Shift
              </div>
              <div style={{ fontSize: 11, color: 'var(--text-muted)' }}>
                {shiftRows[0].start_time} – {shiftRows[0].end_time}
              </div>
              <div style={{ display: 'flex', gap: 3, marginLeft: 8 }}>
                {DAYS.map((d, i) => (
                  <span key={d} style={{
                    fontSize: 10,
                    padding: '2px 5px',
                    borderRadius: 3,
                    background: shiftRows[0].days_active.includes(i) ? 'var(--accent-dim)' : 'var(--bg-surface-3)',
                    color: shiftRows[0].days_active.includes(i) ? 'var(--accent)' : 'var(--text-disabled)',
                  }}>
                    {d}
                  </span>
                ))}
              </div>
              <div style={{ marginLeft: 'auto' }}>
                <button
                  onClick={() => handleDeleteGroup(shiftName)}
                  style={{
                    background: 'transparent',
                    border: '1px solid var(--status-blocked-border)',
                    borderRadius: 'var(--radius-sm)',
                    cursor: 'pointer',
                    color: 'var(--status-blocked-text)',
                    padding: '4px 8px',
                    display: 'flex',
                    alignItems: 'center',
                    gap: 5,
                    fontSize: 11,
                    fontFamily: 'var(--font-body)',
                  }}
                  title="Delete entire shift"
                >
                  <TrashIcon /> Delete Shift
                </button>
              </div>
            </div>

            <table className="data-table">
              <thead>
                <tr>
                  <th>Role</th>
                  <th>Slots Required</th>
                  <th>Start</th>
                  <th>End</th>
                  <th></th>
                </tr>
              </thead>
              <tbody>
                {shiftRows.map((s) => (
                  <tr key={s.id} onClick={() => openEdit(s)} style={{ cursor: 'pointer' }}>
                    <td style={{ color: 'var(--text-primary)' }}>{s.role}</td>
                    <td>
                      <span style={{ fontFamily: 'var(--font-display)', fontSize: 16, fontWeight: 700, color: 'var(--accent)' }}>
                        {s.required_count}
                      </span>
                    </td>
                    <td>{s.start_time}</td>
                    <td>{s.end_time}</td>
                    <td>
                      <button
                        onClick={(e) => { e.stopPropagation(); handleDeleteOne(s.id) }}
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
                        title="Remove role from shift"
                      >
                        <TrashIcon />
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ))}
      </div>

      {showForm && (
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
            maxWidth: 480,
          }}>
            <div style={{ fontFamily: 'var(--font-display)', fontSize: 18, fontWeight: 700, color: 'var(--text-primary)', marginBottom: 20 }}>
              {editing ? 'Edit Shift Requirement' : 'Add Shift Requirement'}
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
                <div className="form-group">
                  <label className="form-label">Shift Name</label>
                  <input className="form-input" value={form.shift_name} onChange={(e) => setForm((f) => ({ ...f, shift_name: e.target.value }))} placeholder="AM, PM, Flex..." />
                </div>
                <div className="form-group">
                  <label className="form-label">Role</label>
                  <input className="form-input" value={form.role} onChange={(e) => setForm((f) => ({ ...f, role: e.target.value }))} placeholder="Lifeguard..." />
                </div>
              </div>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 12 }}>
                <div className="form-group">
                  <label className="form-label">Slots</label>
                  <input className="form-input" type="number" min="1" value={form.required_count} onChange={(e) => setForm((f) => ({ ...f, required_count: e.target.value }))} />
                </div>
                <div className="form-group">
                  <label className="form-label">Start Time</label>
                  <input className="form-input" type="time" value={form.start_time} onChange={(e) => setForm((f) => ({ ...f, start_time: e.target.value }))} />
                </div>
                <div className="form-group">
                  <label className="form-label">End Time</label>
                  <input className="form-input" type="time" value={form.end_time} onChange={(e) => setForm((f) => ({ ...f, end_time: e.target.value }))} />
                </div>
              </div>
              <div className="form-group">
                <label className="form-label">Active Days</label>
                <div style={{ display: 'flex', gap: 6, marginTop: 4 }}>
                  {DAYS.map((d, i) => (
                    <button
                      key={d}
                      type="button"
                      onClick={() => toggleDay(i)}
                      style={{
                        padding: '5px 10px',
                        borderRadius: 'var(--radius-sm)',
                        border: '1px solid',
                        fontSize: 12,
                        fontFamily: 'var(--font-body)',
                        cursor: 'pointer',
                        background: form.days_active.includes(i) ? 'var(--accent-dim)' : 'var(--bg-surface-3)',
                        borderColor: form.days_active.includes(i) ? 'var(--accent-border)' : 'var(--border-default)',
                        color: form.days_active.includes(i) ? 'var(--accent)' : 'var(--text-muted)',
                      }}
                    >
                      {d}
                    </button>
                  ))}
                </div>
              </div>
            </div>
            {error && <div style={{ fontSize: 12, color: 'var(--status-blocked-text)', marginTop: 12 }}>{error}</div>}
            <div style={{ display: 'flex', gap: 8, marginTop: 20, justifyContent: 'flex-end' }}>
              <button className="btn btn-secondary btn-sm" onClick={() => setShowForm(false)}>Cancel</button>
              <button className="btn btn-primary btn-sm" onClick={handleSave} disabled={saving}>
                {saving ? 'Saving...' : 'Save Shift'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}