'use client'

import { useEffect, useState } from 'react'
import { createClient } from '@/lib/supabase/client'
import { useCompany } from '@/lib/hooks/useCompany'
import type { ShiftType, ShiftRequirement } from '@/lib/types'

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

function EditIcon() {
  return (
    <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7" />
      <path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z" />
    </svg>
  )
}

type ShiftTypeModal =
  | { mode: 'add' }
  | { mode: 'edit'; shiftType: ShiftType }

type RequirementModal =
  | { mode: 'add'; shiftTypeId: string }
  | { mode: 'edit'; requirement: ShiftRequirement }

export default function ShiftRequirementsTab() {
  const { company } = useCompany()
  const COMPANY_ID = company?.id ?? ''
  const supabase = createClient()

  const [shiftTypes, setShiftTypes] = useState<ShiftType[]>([])
  const [requirements, setRequirements] = useState<ShiftRequirement[]>([])
  const [loading, setLoading] = useState(true)

  // Shift type modal state
  const [stModal, setStModal] = useState<ShiftTypeModal | null>(null)
  const [stForm, setStForm] = useState({ name: '', start_time: '', end_time: '', days_active: [] as number[], active: true })
  const [stSaving, setStSaving] = useState(false)
  const [stError, setStError] = useState('')

  // Requirement modal state
  const [reqModal, setReqModal] = useState<RequirementModal | null>(null)
  const [reqForm, setReqForm] = useState({ role: '', required_count: '1' })
  const [reqSaving, setReqSaving] = useState(false)
  const [reqError, setReqError] = useState('')

  // Delete confirmations
  const [confirmDeleteStId, setConfirmDeleteStId] = useState<string | null>(null)
  const [confirmDeleteReqId, setConfirmDeleteReqId] = useState<string | null>(null)

  useEffect(() => { if (COMPANY_ID) fetchData() }, [COMPANY_ID])

  async function fetchData() {
    setLoading(true)
    const [stRes, reqRes] = await Promise.all([
      supabase.from('shift_types').select('*').eq('company_id', COMPANY_ID).order('name'),
      supabase.from('shift_requirements').select('*').eq('company_id', COMPANY_ID).order('role'),
    ])
    if (stRes.data) setShiftTypes(stRes.data)
    if (reqRes.data) setRequirements(reqRes.data)
    setLoading(false)
  }

  // ── Shift Type handlers ──────────────────────────────────────────────────

  function openAddShiftType() {
    setStForm({ name: '', start_time: '', end_time: '', days_active: [], active: true })
    setStError('')
    setStModal({ mode: 'add' })
  }

  function openEditShiftType(st: ShiftType) {
    setStForm({ name: st.name, start_time: st.start_time, end_time: st.end_time, days_active: st.days_active, active: st.active })
    setStError('')
    setStModal({ mode: 'edit', shiftType: st })
  }

  function toggleStDay(day: number) {
    setStForm((f) => ({
      ...f,
      days_active: f.days_active.includes(day)
        ? f.days_active.filter((d) => d !== day)
        : [...f.days_active, day].sort(),
    }))
  }

  async function handleSaveShiftType() {
    if (!stForm.name.trim()) { setStError('Shift name is required.'); return }
    if (!stForm.start_time || !stForm.end_time) { setStError('Start and end time are required.'); return }
    if (stForm.days_active.length === 0) { setStError('Select at least one active day.'); return }
    setStSaving(true)
    setStError('')

    const payload = {
      company_id: COMPANY_ID,
      name: stForm.name.trim(),
      start_time: stForm.start_time,
      end_time: stForm.end_time,
      days_active: stForm.days_active,
      active: stForm.active,
    }

    if (stModal?.mode === 'edit') {
      await supabase.from('shift_types').update(payload).eq('id', stModal.shiftType.id)
    } else {
      await supabase.from('shift_types').insert(payload)
    }

    setStSaving(false)
    setStModal(null)
    fetchData()
  }

  async function handleDeleteShiftType(id: string) {
    // Also remove all requirements for this shift type
    await supabase.from('shift_requirements').delete().eq('shift_type_id', id)
    await supabase.from('shift_types').delete().eq('id', id)
    setConfirmDeleteStId(null)
    fetchData()
  }

  async function handleToggleShiftTypeActive(st: ShiftType) {
    await supabase.from('shift_types').update({ active: !st.active }).eq('id', st.id)
    fetchData()
  }

  // ── Requirement handlers ─────────────────────────────────────────────────

  function openAddRequirement(shiftTypeId: string) {
    setReqForm({ role: '', required_count: '1' })
    setReqError('')
    setReqModal({ mode: 'add', shiftTypeId })
  }

  function openEditRequirement(req: ShiftRequirement) {
    setReqForm({ role: req.role, required_count: String(req.required_count) })
    setReqError('')
    setReqModal({ mode: 'edit', requirement: req })
  }

  async function handleSaveRequirement() {
    if (!reqForm.role.trim()) { setReqError('Role is required.'); return }
    const count = parseInt(reqForm.required_count)
    if (isNaN(count) || count < 1) { setReqError('Slots must be at least 1.'); return }
    setReqSaving(true)
    setReqError('')

    if (reqModal?.mode === 'add') {
      await supabase.from('shift_requirements').insert({
        company_id: COMPANY_ID,
        shift_type_id: reqModal.shiftTypeId,
        // Keep shift_name in sync for legacy Aegis compatibility
        shift_name: shiftTypes.find((s) => s.id === reqModal.shiftTypeId)?.name ?? '',
        role: reqForm.role.trim(),
        required_count: count,
        start_time: shiftTypes.find((s) => s.id === reqModal.shiftTypeId)?.start_time ?? '00:00',
        end_time: shiftTypes.find((s) => s.id === reqModal.shiftTypeId)?.end_time ?? '00:00',
        days_active: shiftTypes.find((s) => s.id === reqModal.shiftTypeId)?.days_active ?? [],
      })
    } else if (reqModal?.mode === 'edit') {
      await supabase.from('shift_requirements').update({
        role: reqForm.role.trim(),
        required_count: count,
      }).eq('id', reqModal.requirement.id)
    }

    setReqSaving(false)
    setReqModal(null)
    fetchData()
  }

  async function handleDeleteRequirement(id: string) {
    await supabase.from('shift_requirements').delete().eq('id', id)
    setConfirmDeleteReqId(null)
    fetchData()
  }

  // ── Render ───────────────────────────────────────────────────────────────

  if (loading) {
    return (
      <div style={{ padding: '48px 0', textAlign: 'center', color: 'var(--text-muted)', fontSize: 13 }}>
        Loading shifts...
      </div>
    )
  }

  return (
    <div>
      <div style={{ display: 'flex', alignItems: 'center', marginBottom: 16 }}>
        <div style={{ fontSize: 12, color: 'var(--text-muted)' }}>
          Define shift types, then set how many of each role are required per shift.
        </div>
        <div style={{ marginLeft: 'auto' }}>
          <button className="btn btn-primary btn-sm" onClick={openAddShiftType}>
            + Add Shift Type
          </button>
        </div>
      </div>

      {shiftTypes.length === 0 && (
        <div className="empty-state">
          <div className="empty-state-title">No shift types defined</div>
          <div className="empty-state-desc">Add your first shift type to get started.</div>
        </div>
      )}

      <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
        {shiftTypes.map((st) => {
          const reqs = requirements.filter((r) => r.shift_type_id === st.id)
          return (
            <div key={st.id} style={{
              background: 'var(--bg-surface-1)',
              border: '1px solid var(--border-default)',
              borderRadius: 'var(--radius-lg)',
              overflow: 'hidden',
            }}>
              {/* Shift type header */}
              <div style={{
                padding: '12px 16px',
                borderBottom: '1px solid var(--border-subtle)',
                display: 'flex',
                alignItems: 'center',
                gap: 12,
              }}>
                <div style={{ fontFamily: 'var(--font-display)', fontSize: 13, fontWeight: 700, color: 'var(--text-primary)', letterSpacing: '0.05em' }}>
                  {st.name}
                </div>
                <div style={{ fontSize: 11, color: 'var(--text-muted)' }}>
                  {st.start_time} – {st.end_time}
                </div>
                <div style={{ display: 'flex', gap: 3 }}>
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
                <span
                  className={`badge ${st.active ? 'badge-ready' : 'badge-blocked'}`}
                  onClick={() => handleToggleShiftTypeActive(st)}
                  style={{ cursor: 'pointer' }}
                >
                  {st.active ? 'Active' : 'Inactive'}
                </span>
                <div style={{ marginLeft: 'auto', display: 'flex', gap: 8 }}>
                  <button
                    onClick={() => openEditShiftType(st)}
                    style={{
                      background: 'transparent',
                      border: '1px solid var(--border-default)',
                      borderRadius: 'var(--radius-sm)',
                      cursor: 'pointer',
                      color: 'var(--text-muted)',
                      padding: '4px 8px',
                      display: 'flex',
                      alignItems: 'center',
                      gap: 5,
                      fontSize: 11,
                      fontFamily: 'var(--font-body)',
                    }}
                  >
                    <EditIcon /> Edit
                  </button>
                  <button
                    onClick={() => setConfirmDeleteStId(st.id)}
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
                  >
                    <TrashIcon /> Delete
                  </button>
                </div>
              </div>

              {/* Role requirements */}
              <table className="data-table">
                <thead>
                  <tr>
                    <th>Role</th>
                    <th>Slots Required</th>
                    <th></th>
                  </tr>
                </thead>
                <tbody>
                  {reqs.map((req) => (
                    <tr key={req.id} onClick={() => openEditRequirement(req)} style={{ cursor: 'pointer' }}>
                      <td style={{ color: 'var(--text-primary)', fontSize: 13 }}>{req.role}</td>
                      <td>
                        <span style={{ fontFamily: 'var(--font-display)', fontSize: 16, fontWeight: 700, color: 'var(--accent)' }}>
                          {req.required_count}
                        </span>
                      </td>
                      <td>
                        <button
                          onClick={(e) => { e.stopPropagation(); setConfirmDeleteReqId(req.id) }}
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
                  ))}
                  {reqs.length === 0 && (
                    <tr>
                      <td colSpan={3} style={{ color: 'var(--text-disabled)', fontSize: 12, fontStyle: 'italic' }}>
                        No role requirements yet
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>

              {/* Add role button */}
              <div style={{ padding: '10px 16px', borderTop: '1px solid var(--border-subtle)' }}>
                <button
                  className="btn btn-secondary btn-sm"
                  onClick={() => openAddRequirement(st.id)}
                >
                  + Add Role Requirement
                </button>
              </div>
            </div>
          )
        })}
      </div>

      {/* ── Shift Type Modal ── */}
      {stModal && (
        <div style={{ position: 'fixed', inset: 0, zIndex: 200, background: 'rgba(0,0,0,0.7)', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 20 }}>
          <div style={{ background: 'var(--bg-surface-1)', border: '1px solid var(--border-default)', borderRadius: 'var(--radius-xl)', padding: 28, width: '100%', maxWidth: 480 }}>
            <div style={{ fontFamily: 'var(--font-display)', fontSize: 18, fontWeight: 700, color: 'var(--text-primary)', marginBottom: 20 }}>
              {stModal.mode === 'edit' ? 'Edit Shift Type' : 'Add Shift Type'}
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
              <div className="form-group">
                <label className="form-label">Shift Name</label>
                <input className="form-input" value={stForm.name} onChange={(e) => setStForm((f) => ({ ...f, name: e.target.value }))} placeholder="e.g. AM, PM, Flex, Day" />
              </div>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
                <div className="form-group">
                  <label className="form-label">Start Time</label>
                  <input className="form-input" type="time" value={stForm.start_time} onChange={(e) => setStForm((f) => ({ ...f, start_time: e.target.value }))} />
                </div>
                <div className="form-group">
                  <label className="form-label">End Time</label>
                  <input className="form-input" type="time" value={stForm.end_time} onChange={(e) => setStForm((f) => ({ ...f, end_time: e.target.value }))} />
                </div>
              </div>
              <div className="form-group">
                <label className="form-label">Active Days</label>
                <div style={{ display: 'flex', gap: 6, marginTop: 4, flexWrap: 'wrap' }}>
                  {DAYS.map((d, i) => (
                    <button key={d} type="button" onClick={() => toggleStDay(i)} style={{
                      padding: '5px 10px', borderRadius: 'var(--radius-sm)', border: '1px solid', fontSize: 12,
                      fontFamily: 'var(--font-body)', cursor: 'pointer',
                      background: stForm.days_active.includes(i) ? 'var(--accent-dim)' : 'var(--bg-surface-3)',
                      borderColor: stForm.days_active.includes(i) ? 'var(--accent-border)' : 'var(--border-default)',
                      color: stForm.days_active.includes(i) ? 'var(--accent)' : 'var(--text-muted)',
                    }}>
                      {d}
                    </button>
                  ))}
                </div>
              </div>
              <div className="form-group">
                <label className="form-label">Status</label>
                <div style={{ display: 'flex', gap: 8, marginTop: 4 }}>
                  {(['Active', 'Inactive'] as const).map((s) => (
                    <button key={s} type="button" onClick={() => setStForm((f) => ({ ...f, active: s === 'Active' }))} style={{
                      padding: '5px 16px', borderRadius: 'var(--radius-sm)', border: '1px solid', fontSize: 12,
                      fontFamily: 'var(--font-body)', cursor: 'pointer',
                      background: (s === 'Active') === stForm.active ? 'var(--accent-dim)' : 'var(--bg-surface-3)',
                      borderColor: (s === 'Active') === stForm.active ? 'var(--accent-border)' : 'var(--border-default)',
                      color: (s === 'Active') === stForm.active ? 'var(--accent)' : 'var(--text-muted)',
                    }}>
                      {s}
                    </button>
                  ))}
                </div>
              </div>
            </div>
            {stError && <div style={{ fontSize: 12, color: 'var(--status-blocked-text)', marginTop: 12 }}>{stError}</div>}
            <div style={{ display: 'flex', gap: 8, marginTop: 20, justifyContent: 'flex-end' }}>
              <button className="btn btn-secondary btn-sm" onClick={() => setStModal(null)}>Cancel</button>
              <button className="btn btn-primary btn-sm" onClick={handleSaveShiftType} disabled={stSaving}>
                {stSaving ? 'Saving...' : 'Save Shift Type'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ── Requirement Modal ── */}
      {reqModal && (
        <div style={{ position: 'fixed', inset: 0, zIndex: 200, background: 'rgba(0,0,0,0.7)', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 20 }}>
          <div style={{ background: 'var(--bg-surface-1)', border: '1px solid var(--border-default)', borderRadius: 'var(--radius-xl)', padding: 28, width: '100%', maxWidth: 380 }}>
            <div style={{ fontFamily: 'var(--font-display)', fontSize: 18, fontWeight: 700, color: 'var(--text-primary)', marginBottom: 20 }}>
              {reqModal.mode === 'edit' ? 'Edit Role Requirement' : 'Add Role Requirement'}
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
              <div className="form-group">
                <label className="form-label">Role</label>
                <input className="form-input" value={reqForm.role} onChange={(e) => setReqForm((f) => ({ ...f, role: e.target.value }))} placeholder="e.g. Lifeguard" />
              </div>
              <div className="form-group">
                <label className="form-label">Slots Required</label>
                <input className="form-input" type="number" min="1" value={reqForm.required_count} onChange={(e) => setReqForm((f) => ({ ...f, required_count: e.target.value }))} />
              </div>
            </div>
            {reqError && <div style={{ fontSize: 12, color: 'var(--status-blocked-text)', marginTop: 12 }}>{reqError}</div>}
            <div style={{ display: 'flex', gap: 8, marginTop: 20, justifyContent: 'flex-end' }}>
              <button className="btn btn-secondary btn-sm" onClick={() => setReqModal(null)}>Cancel</button>
              <button className="btn btn-primary btn-sm" onClick={handleSaveRequirement} disabled={reqSaving}>
                {reqSaving ? 'Saving...' : 'Save'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ── Delete Shift Type Confirmation ── */}
      {confirmDeleteStId && (
        <div style={{ position: 'fixed', inset: 0, zIndex: 200, background: 'rgba(0,0,0,0.7)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
          <div style={{ background: 'var(--bg-surface-1)', border: '1px solid var(--border-default)', borderRadius: 'var(--radius-xl)', padding: 28, width: '100%', maxWidth: 380 }}>
            <div style={{ fontFamily: 'var(--font-display)', fontSize: 18, fontWeight: 700, color: 'var(--text-primary)', marginBottom: 10 }}>Delete Shift Type</div>
            <div style={{ fontSize: 13, color: 'var(--text-muted)', marginBottom: 20, lineHeight: 1.6 }}>
              This will permanently delete the shift type and all its role requirements. This cannot be undone.
            </div>
            <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
              <button className="btn btn-secondary btn-sm" onClick={() => setConfirmDeleteStId(null)}>Cancel</button>
              <button className="btn btn-sm" onClick={() => handleDeleteShiftType(confirmDeleteStId)} style={{ background: 'var(--status-blocked-bg)', color: 'var(--status-blocked-text)', border: '1px solid var(--status-blocked-border)' }}>
                Delete Permanently
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ── Delete Requirement Confirmation ── */}
      {confirmDeleteReqId && (
        <div style={{ position: 'fixed', inset: 0, zIndex: 200, background: 'rgba(0,0,0,0.7)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
          <div style={{ background: 'var(--bg-surface-1)', border: '1px solid var(--border-default)', borderRadius: 'var(--radius-xl)', padding: 28, width: '100%', maxWidth: 380 }}>
            <div style={{ fontFamily: 'var(--font-display)', fontSize: 18, fontWeight: 700, color: 'var(--text-primary)', marginBottom: 10 }}>Remove Role Requirement</div>
            <div style={{ fontSize: 13, color: 'var(--text-muted)', marginBottom: 20, lineHeight: 1.6 }}>
              This will remove this role requirement from the shift. This cannot be undone.
            </div>
            <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
              <button className="btn btn-secondary btn-sm" onClick={() => setConfirmDeleteReqId(null)}>Cancel</button>
              <button className="btn btn-sm" onClick={() => handleDeleteRequirement(confirmDeleteReqId)} style={{ background: 'var(--status-blocked-bg)', color: 'var(--status-blocked-text)', border: '1px solid var(--status-blocked-border)' }}>
                Remove
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}