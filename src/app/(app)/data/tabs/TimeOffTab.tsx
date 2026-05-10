'use client'
import { useCompany } from '@/lib/hooks/useCompany'

import { useEffect, useState } from 'react'
import { createClient } from '@/lib/supabase/client'

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
  aegis_recommendation: 'approve' | 'deny' | 'neutral' | null
  aegis_reasoning: string | null
  employee: { name: string; primary_role: string } | null
}

function formatDate(d: string) {
  return new Date(d).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
}

function AegisBadge({ rec }: { rec: 'approve' | 'deny' | 'neutral' }) {
  const styles: Record<string, { bg: string; border: string; text: string; label: string }> = {
    approve: { bg: 'rgba(22,163,74,0.1)', border: 'rgba(22,163,74,0.25)', text: '#16a34a', label: 'Aegis: Approve' },
    deny:    { bg: 'rgba(239,68,68,0.1)', border: 'rgba(239,68,68,0.25)', text: '#ef4444', label: 'Aegis: Deny' },
    neutral: { bg: 'rgba(107,114,128,0.1)', border: 'rgba(107,114,128,0.25)', text: '#6b7280', label: 'Aegis: Neutral' },
  }
  const s = styles[rec]
  return (
    <span style={{
      padding: '2px 8px',
      background: s.bg,
      border: `1px solid ${s.border}`,
      borderRadius: 'var(--radius-pill)',
      fontSize: 10,
      fontWeight: 700,
      color: s.text,
      letterSpacing: '0.04em',
      whiteSpace: 'nowrap',
    }}>
      {s.label}
    </span>
  )
}

export default function TimeOffTab() {
  const { company } = useCompany()
  const COMPANY_ID = company?.id ?? ''
  const [requests, setRequests] = useState<TORequest[]>([])
  const [loading, setLoading] = useState(true)
  const [filter, setFilter] = useState<'all' | 'pending' | 'approved' | 'denied'>('all')
  const [showForm, setShowForm] = useState(false)
  const [employees, setEmployees] = useState<{ id: string; name: string }[]>([])
  const [form, setForm] = useState({ employee_id: '', start_date: '', end_date: '', reason: '' })
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')

  const supabase = createClient()

  useEffect(() => { if (COMPANY_ID) fetchData() }, [COMPANY_ID])

  async function fetchData() {
    if (!COMPANY_ID) return
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

  async function logActivity(action: string, summary: string, entityId?: string) {
    await supabase.from('activity_log').insert({
      company_id: COMPANY_ID,
      actor: 'manager',
      action,
      entity_type: 'time_off_request',
      entity_id: entityId ?? null,
      summary,
    })
  }

  async function handleDecision(req: TORequest, decision: 'approved' | 'denied') {
    await supabase
      .from('time_off_requests')
      .update({ status: decision, decided_at: new Date().toISOString() })
      .eq('id', req.id)
    await logActivity(
      `time_off_${decision}`,
      `${decision.charAt(0).toUpperCase() + decision.slice(1)} time-off for ${req.employee?.name ?? 'employee'}: ${formatDate(req.start_date)} – ${formatDate(req.end_date)}`,
      req.id
    )
    fetchData()
  }

  async function handleDelete(req: TORequest) {
    await supabase.from('time_off_requests').delete().eq('id', req.id)
    await logActivity(
      'time_off_deleted',
      `Deleted time-off request for ${req.employee?.name ?? 'employee'}: ${formatDate(req.start_date)} – ${formatDate(req.end_date)}`,
      req.id
    )
    fetchData()
  }

  async function handleAdd() {
    if (!form.employee_id || !form.start_date || !form.end_date) {
      setError('Employee and dates are required.')
      return
    }
    setSaving(true)
    const { data } = await supabase.from('time_off_requests').insert({
      company_id: COMPANY_ID,
      employee_id: form.employee_id,
      start_date: form.start_date,
      end_date: form.end_date,
      reason: form.reason || null,
      status: 'pending',
    }).select().single()
    const emp = employees.find((e) => e.id === form.employee_id)
    if (data) await logActivity(
      'time_off_created',
      `Logged time-off request for ${emp?.name ?? 'employee'}: ${formatDate(form.start_date)} – ${formatDate(form.end_date)}`,
      data.id
    )
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
              padding: '14px 16px',
              borderBottom: i < filtered.length - 1 ? '1px solid var(--border-subtle)' : 'none',
            }}>
              {/* Main row */}
              <div style={{ display: 'flex', alignItems: 'flex-start', gap: 16 }}>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontSize: 13, color: 'var(--text-primary)', fontWeight: 500 }}>
                    {req.employee?.name ?? 'Unknown'}
                  </div>
                  <div style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 2 }}>
                    {req.employee?.primary_role} · Requested {formatDate(req.requested_at)}
                  </div>
                </div>
                <div style={{ fontSize: 12, color: 'var(--text-secondary)', minWidth: 160, flexShrink: 0 }}>
                  {formatDate(req.start_date)} – {formatDate(req.end_date)}
                </div>
                <div style={{ fontSize: 12, color: 'var(--text-muted)', flex: 1, minWidth: 0 }}>
                  {req.reason ?? '—'}
                </div>
                <div style={{ display: 'flex', gap: 6, alignItems: 'center', flexShrink: 0, flexWrap: 'wrap', justifyContent: 'flex-end' }}>
                  {req.aegis_recommendation && <AegisBadge rec={req.aegis_recommendation} />}
                  {req.status === 'pending' ? (
                    <>
                      <button
                        className="btn btn-sm"
                        onClick={() => handleDecision(req, 'approved')}
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
                        onClick={() => handleDecision(req, 'denied')}
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
                    onClick={() => handleDelete(req)}
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

              {/* Aegis reasoning block */}
              {req.aegis_reasoning && (
                <div style={{
                  marginTop: 10,
                  paddingLeft: 12,
                  borderLeft: '2px solid rgba(99,102,241,0.3)',
                }}>
                  <div style={{
                    fontSize: 10,
                    color: 'var(--text-muted)',
                    textTransform: 'uppercase',
                    letterSpacing: '0.08em',
                    fontWeight: 700,
                    marginBottom: 3,
                  }}>
                    Aegis Assessment
                  </div>
                  <div style={{
                    fontSize: 11,
                    color: 'var(--text-muted)',
                    fontStyle: 'italic',
                    lineHeight: 1.55,
                  }}>
                    {req.aegis_reasoning}
                  </div>
                </div>
              )}
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
                <label className="form-label">Reason <span style={{ color: 'var(--text-muted)', fontWeight: 400 }}>(optional)</span></label>
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
