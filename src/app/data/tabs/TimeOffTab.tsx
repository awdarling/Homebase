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

interface TORequest {
  id: string
  employee_id: string
  start_date: string
  end_date: string
  reason: string | null
  status: 'pending' | 'approved' | 'denied'
  requested_at: string
  decided_at: string | null
  employee: { name: string; primary_role: string } | null
}

function formatDate(d: string) {
  return new Date(d).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
}

export default function TimeOffTab() {
  const [requests, setRequests] = useState<TORequest[]>([])
  const [loading, setLoading] = useState(true)
  const [filter, setFilter] = useState<'all' | 'pending' | 'approved' | 'denied'>('all')
  const [showForm, setShowForm] = useState(false)
  const [employees, setEmployees] = useState<{ id: string; name: string }[]>([])
  const [form, setForm] = useState({ employee_id: '', start_date: '', end_date: '', reason: '' })
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')

  const supabase = createClient()

  useEffect(() => { fetchData() }, [])

  async function fetchData() {
    setLoading(true)
    const [toRes, empRes] = await Promise.all([
      supabase
        .from('time_off_requests')
        .select('*, employee:employees(name, primary_role)')
        .eq('company_id', COMPANY_ID)
        .order('requested_at', { ascending: false }),
      supabase
        .from('employees')
        .select('id, name')
        .eq('company_id', COMPANY_ID)
        .eq('active', true)
        .order('name'),
    ])
    if (toRes.data) setRequests(toRes.data as TORequest[])
    if (empRes.data) setEmployees(empRes.data)
    setLoading(false)
  }

  async function handleDecision(id: string, decision: 'approved' | 'denied') {
    await supabase
      .from('time_off_requests')
      .update({ status: decision, decided_at: new Date().toISOString() })
      .eq('id', id)
    fetchData()
  }

  async function handleDelete(id: string) {
    await supabase.from('time_off_requests').delete().eq('id', id)
    fetchData()
  }

  async function handleAdd() {
    if (!form.employee_id || !form.start_date || !form.end_date) {
      setError('Employee and dates are required.')
      return
    }
    setSaving(true)
    await supabase.from('time_off_requests').insert({
      company_id: COMPANY_ID,
      employee_id: form.employee_id,
      start_date: form.start_date,
      end_date: form.end_date,
      reason: form.reason || null,
      status: 'pending',
    })
    setSaving(false)
    setShowForm(false)
    setForm({ employee_id: '', start_date: '', end_date: '', reason: '' })
    fetchData()
  }

  const filtered = requests.filter((r) => filter === 'all' || r.status === filter)

  const counts = {
    pending:  requests.filter((r) => r.status === 'pending').length,
    approved: requests.filter((r) => r.status === 'approved').length,
    denied:   requests.filter((r) => r.status === 'denied').length,
  }

  if (loading) return (
    <div style={{ padding: '48px 0', textAlign: 'center', color: 'var(--text-muted)', fontSize: 13 }}>
      Loading time-off requests...
    </div>
  )

  return (
    <div>
      <div style={{ display: 'flex', gap: 8, marginBottom: 16, alignItems: 'center' }}>
        {(['all', 'pending', 'approved', 'denied'] as const).map((f) => (
          <button
            key={f}
            onClick={() => setFilter(f)}
            style={{
              padding: '5px 14px',
              borderRadius: 'var(--radius-pill)',
              border: '1px solid',
              fontSize: 12,
              fontFamily: 'var(--font-body)',
              cursor: 'pointer',
              background: filter === f ? 'var(--accent-dim)' : 'transparent',
              borderColor: filter === f ? 'var(--accent-border)' : 'var(--border-default)',
              color: filter === f ? 'var(--accent)' : 'var(--text-muted)',
            }}
          >
            {f.charAt(0).toUpperCase() + f.slice(1)}
            {f !== 'all' && counts[f] > 0 && (
              <span style={{ marginLeft: 5, fontWeight: 600 }}>{counts[f]}</span>
            )}
          </button>
        ))}
        <div style={{ marginLeft: 'auto' }}>
          <button className="btn btn-primary btn-sm" onClick={() => { setError(''); setShowForm(true) }}>
            + Log Request
          </button>
        </div>
      </div>

      <div style={{
        background: 'var(--bg-surface-1)',
        border: '1px solid var(--border-default)',
        borderRadius: 'var(--radius-lg)',
        overflow: 'hidden',
      }}>
        {filtered.length === 0 ? (
          <div className="empty-state">
            <div className="empty-state-title">No requests</div>
            <div className="empty-state-desc">No time-off requests match this filter.</div>
          </div>
        ) : (
          filtered.map((req, i) => (
            <div key={req.id} style={{
              display: 'flex',
              alignItems: 'center',
              gap: 16,
              padding: '14px 16px',
              borderBottom: i < filtered.length - 1 ? '1px solid var(--border-subtle)' : 'none',
            }}>
              <div style={{ flex: 1 }}>
                <div style={{ fontSize: 13, color: 'var(--text-primary)', fontWeight: 500 }}>
                  {req.employee?.name ?? 'Unknown'}
                </div>
                <div style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 2 }}>
                  {req.employee?.primary_role} · Requested {formatDate(req.requested_at)}
                </div>
              </div>
              <div style={{ fontSize: 12, color: 'var(--text-secondary)', minWidth: 160 }}>
                {formatDate(req.start_date)} – {formatDate(req.end_date)}
              </div>
              <div style={{ fontSize: 12, color: 'var(--text-muted)', flex: 1 }}>
                {req.reason ?? '—'}
              </div>
              <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
                {req.status === 'pending' ? (
                  <>
                    <button
                      className="btn btn-sm"
                      onClick={() => handleDecision(req.id, 'approved')}
                      style={{
                        background: 'var(--status-ready-bg)',
                        color: 'var(--status-ready-text)',
                        border: '1px solid var(--status-ready-border)',
                      }}
                    >
                      Approve
                    </button>
                    <button
                      className="btn btn-sm"
                      onClick={() => handleDecision(req.id, 'denied')}
                      style={{
                        background: 'var(--status-blocked-bg)',
                        color: 'var(--status-blocked-text)',
                        border: '1px solid var(--status-blocked-border)',
                      }}
                    >
                      Deny
                    </button>
                  </>
                ) : (
                  <span className={`badge ${req.status === 'approved' ? 'badge-ready' : 'badge-blocked'}`}>
                    {req.status.charAt(0).toUpperCase() + req.status.slice(1)}
                  </span>
                )}
                <button
                  onClick={() => handleDelete(req.id)}
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
                  title="Delete request"
                >
                  <TrashIcon />
                </button>
              </div>
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
              Log Time-Off Request
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
              <div className="form-group">
                <label className="form-label">Employee</label>
                <select className="form-select" value={form.employee_id} onChange={(e) => setForm((f) => ({ ...f, employee_id: e.target.value }))}>
                  <option value="">Select employee...</option>
                  {employees.map((e) => <option key={e.id} value={e.id}>{e.name}</option>)}
                </select>
              </div>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
                <div className="form-group">
                  <label className="form-label">Start Date</label>
                  <input className="form-input" type="date" value={form.start_date} onChange={(e) => setForm((f) => ({ ...f, start_date: e.target.value }))} />
                </div>
                <div className="form-group">
                  <label className="form-label">End Date</label>
                  <input className="form-input" type="date" value={form.end_date} onChange={(e) => setForm((f) => ({ ...f, end_date: e.target.value }))} />
                </div>
              </div>
              <div className="form-group">
                <label className="form-label">Reason (optional)</label>
                <input className="form-input" value={form.reason} onChange={(e) => setForm((f) => ({ ...f, reason: e.target.value }))} placeholder="Personal, medical, vacation..." />
              </div>
            </div>
            {error && <div style={{ fontSize: 12, color: 'var(--status-blocked-text)', marginTop: 12 }}>{error}</div>}
            <div style={{ display: 'flex', gap: 8, marginTop: 20, justifyContent: 'flex-end' }}>
              <button className="btn btn-secondary btn-sm" onClick={() => setShowForm(false)}>Cancel</button>
              <button className="btn btn-primary btn-sm" onClick={handleAdd} disabled={saving}>
                {saving ? 'Saving...' : 'Log Request'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}