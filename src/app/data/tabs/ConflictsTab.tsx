'use client'

import { useEffect, useState } from 'react'
import { createClient } from '@/lib/supabase/client'

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

interface Conflict {
  id: string
  employee_id_1: string
  employee_id_2: string
  reason: string | null
  severity: 'avoid' | 'never'
  created_at: string
  emp1: { name: string; primary_role: string } | null
  emp2: { name: string; primary_role: string } | null
}

export default function ConflictsTab() {
  const [conflicts, setConflicts] = useState<Conflict[]>([])
  const [employees, setEmployees] = useState<{ id: string; name: string; primary_role: string }[]>([])
  const [loading, setLoading] = useState(true)
  const [showForm, setShowForm] = useState(false)
  const [form, setForm] = useState({ employee_id_1: '', employee_id_2: '', reason: '', severity: 'avoid' as 'avoid' | 'never' })
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')

  const supabase = createClient()

  useEffect(() => { fetchData() }, [])

  async function fetchData() {
    setLoading(true)
    const [confRes, empRes] = await Promise.all([
      supabase
        .from('employee_conflicts')
        .select(`
          *,
          emp1:employees!employee_conflicts_employee_id_1_fkey(name, primary_role),
          emp2:employees!employee_conflicts_employee_id_2_fkey(name, primary_role)
        `)
        .eq('company_id', COMPANY_ID)
        .order('created_at', { ascending: false }),
      supabase
        .from('employees')
        .select('id, name, primary_role')
        .eq('company_id', COMPANY_ID)
        .eq('active', true)
        .order('name'),
    ])
    if (confRes.data) setConflicts(confRes.data as Conflict[])
    if (empRes.data) setEmployees(empRes.data)
    setLoading(false)
  }

  async function handleAdd() {
    if (!form.employee_id_1 || !form.employee_id_2) {
      setError('Select both employees.')
      return
    }
    if (form.employee_id_1 === form.employee_id_2) {
      setError('Cannot conflict an employee with themselves.')
      return
    }
    setSaving(true)
    await supabase.from('employee_conflicts').insert({
      company_id: COMPANY_ID,
      employee_id_1: form.employee_id_1,
      employee_id_2: form.employee_id_2,
      reason: form.reason || null,
      severity: form.severity,
    })
    setSaving(false)
    setShowForm(false)
    setForm({ employee_id_1: '', employee_id_2: '', reason: '', severity: 'avoid' })
    setError('')
    fetchData()
  }

  async function handleRemove(id: string) {
    await supabase.from('employee_conflicts').delete().eq('id', id)
    fetchData()
  }

  if (loading) return (
    <div style={{ padding: '48px 0', textAlign: 'center', color: 'var(--text-muted)', fontSize: 13 }}>
      Loading conflicts...
    </div>
  )

  return (
    <div>
      <div style={{
        background: 'var(--accent-dim)',
        border: '1px solid var(--accent-border)',
        borderRadius: 'var(--radius-lg)',
        padding: '12px 16px',
        fontSize: 12,
        color: 'var(--text-secondary)',
        marginBottom: 16,
        lineHeight: 1.6,
      }}>
        <span style={{ color: 'var(--accent)', fontWeight: 600 }}>Aegis reads this list.</span>
        {' '}When building schedules, Aegis will avoid placing conflicting employees on the same shift.
        <strong style={{ color: 'var(--text-primary)' }}> Avoid</strong> means Aegis tries not to schedule them together.
        <strong style={{ color: 'var(--status-blocked-text)' }}> Never</strong> means Aegis will never schedule them on the same shift.
      </div>

      <div style={{ display: 'flex', justifyContent: 'flex-end', marginBottom: 16 }}>
        <button className="btn btn-primary btn-sm" onClick={() => { setError(''); setShowForm(true) }}>
          + Add Conflict
        </button>
      </div>

      <div style={{
        background: 'var(--bg-surface-1)',
        border: '1px solid var(--border-default)',
        borderRadius: 'var(--radius-lg)',
        overflow: 'hidden',
      }}>
        {conflicts.length === 0 ? (
          <div className="empty-state">
            <div className="empty-state-title">No conflicts recorded</div>
            <div className="empty-state-desc">
              Add employee pairs that Aegis should avoid or never schedule together.
            </div>
          </div>
        ) : (
          conflicts.map((c, i) => (
            <div key={c.id} style={{
              display: 'flex',
              alignItems: 'center',
              gap: 16,
              padding: '14px 16px',
              borderBottom: i < conflicts.length - 1 ? '1px solid var(--border-subtle)' : 'none',
            }}>
              <div style={{ flex: 1, display: 'flex', alignItems: 'center', gap: 10 }}>
                <div>
                  <div style={{ fontSize: 13, color: 'var(--text-primary)', fontWeight: 500 }}>
                    {c.emp1?.name ?? 'Unknown'}
                  </div>
                  <div style={{ fontSize: 11, color: 'var(--text-muted)' }}>{c.emp1?.primary_role}</div>
                </div>
                <div style={{ color: 'var(--text-muted)', fontSize: 12, padding: '0 6px' }}>↔</div>
                <div>
                  <div style={{ fontSize: 13, color: 'var(--text-primary)', fontWeight: 500 }}>
                    {c.emp2?.name ?? 'Unknown'}
                  </div>
                  <div style={{ fontSize: 11, color: 'var(--text-muted)' }}>{c.emp2?.primary_role}</div>
                </div>
              </div>
              <div style={{ fontSize: 12, color: 'var(--text-muted)', flex: 1 }}>
                {c.reason ?? '—'}
              </div>
              <span style={{
                padding: '3px 10px',
                borderRadius: 'var(--radius-pill)',
                fontSize: 11,
                fontWeight: 500,
                background: c.severity === 'never' ? 'var(--status-blocked-bg)' : 'var(--status-action-bg)',
                color: c.severity === 'never' ? 'var(--status-blocked-text)' : 'var(--status-action-text)',
                border: `1px solid ${c.severity === 'never' ? 'var(--status-blocked-border)' : 'var(--status-action-border)'}`,
                minWidth: 52,
                textAlign: 'center' as const,
              }}>
                {c.severity === 'never' ? 'Never' : 'Avoid'}
              </span>
              <button
                onClick={() => handleRemove(c.id)}
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
                title="Remove conflict"
              >
                <TrashIcon />
              </button>
            </div>
          ))
        )}
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
            maxWidth: 440,
          }}>
            <div style={{ fontFamily: 'var(--font-display)', fontSize: 18, fontWeight: 700, color: 'var(--text-primary)', marginBottom: 20 }}>
              Add Conflict
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
              <div className="form-group">
                <label className="form-label">Employee 1</label>
                <select className="form-select" value={form.employee_id_1} onChange={(e) => setForm((f) => ({ ...f, employee_id_1: e.target.value }))}>
                  <option value="">Select employee...</option>
                  {employees.map((e) => <option key={e.id} value={e.id}>{e.name} ({e.primary_role})</option>)}
                </select>
              </div>
              <div className="form-group">
                <label className="form-label">Employee 2</label>
                <select className="form-select" value={form.employee_id_2} onChange={(e) => setForm((f) => ({ ...f, employee_id_2: e.target.value }))}>
                  <option value="">Select employee...</option>
                  {employees.map((e) => <option key={e.id} value={e.id}>{e.name} ({e.primary_role})</option>)}
                </select>
              </div>
              <div className="form-group">
                <label className="form-label">Severity</label>
                <select className="form-select" value={form.severity} onChange={(e) => setForm((f) => ({ ...f, severity: e.target.value as 'avoid' | 'never' }))}>
                  <option value="avoid">Avoid — schedule together only if necessary</option>
                  <option value="never">Never — do not schedule together under any circumstances</option>
                </select>
              </div>
              <div className="form-group">
                <label className="form-label">Reason (optional)</label>
                <input className="form-input" value={form.reason} onChange={(e) => setForm((f) => ({ ...f, reason: e.target.value }))} placeholder="Performance issue, personal conflict..." />
              </div>
            </div>
            {error && <div style={{ fontSize: 12, color: 'var(--status-blocked-text)', marginTop: 12 }}>{error}</div>}
            <div style={{ display: 'flex', gap: 8, marginTop: 20, justifyContent: 'flex-end' }}>
              <button className="btn btn-secondary btn-sm" onClick={() => setShowForm(false)}>Cancel</button>
              <button className="btn btn-primary btn-sm" onClick={handleAdd} disabled={saving}>
                {saving ? 'Saving...' : 'Add Conflict'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}