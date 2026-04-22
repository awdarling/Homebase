'use client'

import { useEffect, useState } from 'react'
import { createClient } from '@/lib/supabase/client'
import { useCompany } from '@/lib/hooks/useCompany'

const DAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']

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

interface ShiftType {
  id: string
  company_id: string
  name: string
  start_time: string
  end_time: string
  days_active: number[]
  active: boolean
  created_at: string
}

export default function ShiftTypesTab() {
  const { company } = useCompany()
  const COMPANY_ID = company?.id ?? ''
  const supabase = createClient()

  const [shiftTypes, setShiftTypes] = useState<ShiftType[]>([])
  const [loading, setLoading] = useState(true)
  const [showForm, setShowForm] = useState(false)
  const [editing, setEditing] = useState<ShiftType | null>(null)
  const [form, setForm] = useState({
    name: '',
    start_time: '',
    end_time: '',
    days_active: [] as number[],
    active: true,
  })
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null)

  useEffect(() => { if (COMPANY_ID) fetchData() }, [COMPANY_ID])

  async function fetchData() {
    setLoading(true)
    const { data } = await supabase
      .from('shift_types')
      .select('*')
      .eq('company_id', COMPANY_ID)
      .order('name')
    if (data) setShiftTypes(data)
    setLoading(false)
  }

  function openAdd() {
    setEditing(null)
    setForm({ name: '', start_time: '', end_time: '', days_active: [], active: true })
    setError('')
    setShowForm(true)
  }

  function openEdit(st: ShiftType) {
    setEditing(st)
    setForm({
      name: st.name,
      start_time: st.start_time,
      end_time: st.end_time,
      days_active: st.days_active,
      active: st.active,
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
    if (!form.name.trim()) {
      setError('Shift type name is required.')
      return
    }
    if (!form.start_time || !form.end_time) {
      setError('Start and end time are required.')
      return
    }
    if (form.days_active.length === 0) {
      setError('Select at least one active day.')
      return
    }
    setSaving(true)
    setError('')

    const payload = {
      company_id: COMPANY_ID,
      name: form.name.trim(),
      start_time: form.start_time,
      end_time: form.end_time,
      days_active: form.days_active,
      active: form.active,
    }

    if (editing) {
      await supabase.from('shift_types').update(payload).eq('id', editing.id)
    } else {
      await supabase.from('shift_types').insert(payload)
    }

    setSaving(false)
    setShowForm(false)
    fetchData()
  }

  async function handleDelete(id: string) {
    await supabase.from('shift_types').delete().eq('id', id)
    setConfirmDeleteId(null)
    fetchData()
  }

  async function handleToggleActive(st: ShiftType) {
    await supabase.from('shift_types').update({ active: !st.active }).eq('id', st.id)
    fetchData()
  }

  if (loading) {
    return (
      <div style={{ padding: '48px 0', textAlign: 'center', color: 'var(--text-muted)', fontSize: 13 }}>
        Loading shift types...
      </div>
    )
  }

  return (
    <div>
      <div style={{ display: 'flex', alignItems: 'center', marginBottom: 16 }}>
        <div style={{ fontSize: 12, color: 'var(--text-muted)' }}>
          Define the shift types Aegis reads when building schedules. These are dynamic — nothing is hardcoded.
        </div>
        <div style={{ marginLeft: 'auto' }}>
          <button className="btn btn-primary btn-sm" onClick={openAdd}>
            + Add Shift Type
          </button>
        </div>
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
            <col style={{ width: '12%' }} />
            <col style={{ width: '36%' }} />
            <col style={{ width: '12%' }} />
            <col style={{ width: '8%' }} />
          </colgroup>
          <thead>
            <tr>
              <th>Name</th>
              <th>Start</th>
              <th>End</th>
              <th>Active Days</th>
              <th>Status</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {shiftTypes.map((st) => (
              <tr key={st.id} onClick={() => openEdit(st)} style={{ cursor: 'pointer' }}>
                <td style={{ color: 'var(--text-primary)', fontWeight: 500, fontSize: 13 }}>
                  {st.name}
                </td>
                <td style={{ color: 'var(--text-secondary)', fontSize: 13 }}>
                  {st.start_time}
                </td>
                <td style={{ color: 'var(--text-secondary)', fontSize: 13 }}>
                  {st.end_time}
                </td>
                <td>
                  <div style={{ display: 'flex', gap: 3, flexWrap: 'wrap' }}>
                    {DAYS.map((d, i) => (
                      <span key={d} style={{
                        fontSize: 10,
                        padding: '2px 5px',
                        borderRadius: 3,
                        background: st.days_active.includes(i) ? 'var(--accent-dim)' : 'var(--bg-surface-3)',
                        color: st.days_active.includes(i) ? 'var(--accent)' : 'var(--text-disabled)',
                      }}>
                        {d}
                      </span>
                    ))}
                  </div>
                </td>
                <td>
                  <span
                    className={`badge ${st.active ? 'badge-ready' : 'badge-blocked'}`}
                    onClick={(e) => { e.stopPropagation(); handleToggleActive(st) }}
                    style={{ cursor: 'pointer' }}
                  >
                    {st.active ? 'Active' : 'Inactive'}
                  </span>
                </td>
                <td>
                  <button
                    onClick={(e) => { e.stopPropagation(); setConfirmDeleteId(st.id) }}
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
                    title="Delete shift type"
                  >
                    <TrashIcon />
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>

        {shiftTypes.length === 0 && (
          <div className="empty-state">
            <div className="empty-state-title">No shift types defined</div>
            <div className="empty-state-desc">
              Add your shift types here. Aegis reads these dynamically when building schedules.
            </div>
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
              Delete Shift Type
            </div>
            <div style={{ fontSize: 13, color: 'var(--text-muted)', marginBottom: 20, lineHeight: 1.6 }}>
              This will permanently delete this shift type. Any shift requirements referencing it will need to be updated.
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

      {/* Add/Edit Modal */}
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
            maxWidth: 480,
          }}>
            <div style={{ fontFamily: 'var(--font-display)', fontSize: 18, fontWeight: 700, color: 'var(--text-primary)', marginBottom: 20 }}>
              {editing ? 'Edit Shift Type' : 'Add Shift Type'}
            </div>

            <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
              <div className="form-group">
                <label className="form-label">Shift Name</label>
                <input
                  className="form-input"
                  value={form.name}
                  onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))}
                  placeholder="e.g. AM, PM, Flex, Day"
                />
              </div>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
                <div className="form-group">
                  <label className="form-label">Start Time</label>
                  <input
                    className="form-input"
                    type="time"
                    value={form.start_time}
                    onChange={(e) => setForm((f) => ({ ...f, start_time: e.target.value }))}
                  />
                </div>
                <div className="form-group">
                  <label className="form-label">End Time</label>
                  <input
                    className="form-input"
                    type="time"
                    value={form.end_time}
                    onChange={(e) => setForm((f) => ({ ...f, end_time: e.target.value }))}
                  />
                </div>
              </div>
              <div className="form-group">
                <label className="form-label">Active Days</label>
                <div style={{ display: 'flex', gap: 6, marginTop: 4, flexWrap: 'wrap' }}>
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
              <div className="form-group">
                <label className="form-label">Status</label>
                <div style={{ display: 'flex', gap: 8, marginTop: 4 }}>
                  {['Active', 'Inactive'].map((s) => (
                    <button
                      key={s}
                      type="button"
                      onClick={() => setForm((f) => ({ ...f, active: s === 'Active' }))}
                      style={{
                        padding: '5px 16px',
                        borderRadius: 'var(--radius-sm)',
                        border: '1px solid',
                        fontSize: 12,
                        fontFamily: 'var(--font-body)',
                        cursor: 'pointer',
                        background: (s === 'Active') === form.active ? 'var(--accent-dim)' : 'var(--bg-surface-3)',
                        borderColor: (s === 'Active') === form.active ? 'var(--accent-border)' : 'var(--border-default)',
                        color: (s === 'Active') === form.active ? 'var(--accent)' : 'var(--text-muted)',
                      }}
                    >
                      {s}
                    </button>
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
                {saving ? 'Saving...' : 'Save Shift Type'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}