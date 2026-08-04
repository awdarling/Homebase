'use client'

import { useEffect, useState } from 'react'
import { createClient } from '@/lib/supabase/client'
import { useCompany } from '@/lib/hooks/useCompany'

interface AvailSlot {
  day_of_week: number
  start_time: string
  end_time: string
}
interface RotationWeek {
  week: number
  days: AvailSlot[]
}
interface AvailSnapshot {
  employee_id: string
  employee_name: string
  proposed_availability: AvailSlot[]
  current_availability: AvailSlot[]
  availability_raw?: string
  custom_end_date?: string | null
  rotation?: { cycle_weeks: number; cycle_start_date: string; end_date?: string | null; weeks: RotationWeek[] } | null
}
interface AvailChangeRequest {
  id: string
  company_id: string
  employee_id: string
  status: 'pending' | 'approved' | 'denied' | 'withdrawn'
  change_kind: 'permanent' | 'date_limited' | 'rotating'
  proposed_change: AvailSnapshot
  prior_snapshot: AvailSlot[] | null
  aegis_summary: string | null
  raw_request: string | null
  requested_at: string
  decided_at: string | null
  decided_by: string | null
}

const DOW = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']

const STATUS_CONFIG: Record<string, { label: string; color: string; bg: string; border: string }> = {
  pending:   { label: 'Awaiting Approval', color: 'var(--accent)', bg: 'var(--accent-dim)', border: 'var(--accent-border)' },
  approved:  { label: 'Approved', color: 'var(--status-ready-text)', bg: 'var(--status-ready-bg)', border: 'var(--status-ready-border)' },
  denied:    { label: 'Denied', color: 'var(--status-blocked-text)', bg: 'var(--status-blocked-bg)', border: 'var(--status-blocked-border)' },
  withdrawn: { label: 'Superseded', color: 'var(--text-muted)', bg: 'var(--bg-surface-3)', border: 'var(--border-default)' },
}

const KIND_LABEL: Record<string, string> = {
  permanent: 'Permanent',
  date_limited: 'Temporary',
  rotating: 'Rotating',
}

function hhmm(t: string): string {
  if (!t) return ''
  const [h, m] = t.split(':')
  return `${h}:${m ?? '00'}`
}

function fmtDate(d: string | null | undefined): string {
  if (!d) return ''
  if (/^\d{4}-\d{2}-\d{2}$/.test(d)) {
    const [y, m, day] = d.split('-').map(Number)
    return new Date(y, m - 1, day).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
  }
  return new Date(d).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
}

function timeAgo(d: string) {
  const diff = Date.now() - new Date(d).getTime()
  const days = Math.floor(diff / 86400000)
  if (days === 0) return 'Today'
  if (days === 1) return 'Yesterday'
  if (days < 30) return `${days}d ago`
  if (days < 365) return `${Math.floor(days / 30)}mo ago`
  return `${Math.floor(days / 365)}y ago`
}

function DayPills({ slots }: { slots: AvailSlot[] }) {
  if (!slots || slots.length === 0) {
    return <span style={{ fontSize: 11, color: 'var(--text-muted)', fontStyle: 'italic' }}>None</span>
  }
  const sorted = [...slots].sort((a, b) => a.day_of_week - b.day_of_week || a.start_time.localeCompare(b.start_time))
  return (
    <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4 }}>
      {sorted.map((s, i) => (
        <span key={i} style={{
          display: 'inline-block',
          padding: '2px 7px',
          borderRadius: 'var(--radius-pill)',
          fontSize: 10.5,
          background: 'var(--bg-surface-2)',
          border: '1px solid var(--border-subtle)',
          color: 'var(--text-secondary)',
          whiteSpace: 'nowrap',
        }}>
          <strong style={{ color: 'var(--text-primary)' }}>{DOW[s.day_of_week] ?? '?'}</strong>{' '}
          {hhmm(s.start_time)}–{hhmm(s.end_time)}
        </span>
      ))}
    </div>
  )
}

export default function AvailabilityTab() {
  const { company } = useCompany()
  const COMPANY_ID = company?.id ?? ''
  const supabase = createClient()

  const [rows, setRows] = useState<AvailChangeRequest[]>([])
  const [names, setNames] = useState<Record<string, string>>({})
  const [loading, setLoading] = useState(true)
  const [statusFilter, setStatusFilter] = useState('all')
  const [acting, setActing] = useState<string | null>(null)
  const [actionError, setActionError] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)

  useEffect(() => { if (COMPANY_ID) fetchData() }, [COMPANY_ID])

  async function fetchData() {
    setLoading(true)
    const [reqRes, empRes] = await Promise.all([
      supabase
        .from('availability_change_requests')
        .select('*')
        .eq('company_id', COMPANY_ID)
        .order('requested_at', { ascending: false }),
      supabase
        .from('employees')
        .select('id, name')
        .eq('company_id', COMPANY_ID),
    ])
    if (reqRes.data) setRows(reqRes.data as AvailChangeRequest[])
    if (empRes.data) {
      const map: Record<string, string> = {}
      for (const e of empRes.data as { id: string; name: string }[]) map[e.id] = e.name
      setNames(map)
    }
    setLoading(false)
  }

  // Aegis is authoritative for the apply + status write + employee notification:
  // the tab POSTs the manager's decision to /api/availability-decision (which auths
  // + calls Aegis) and reflects the real outcome, surfacing anything that didn't land.
  async function decide(row: AvailChangeRequest, decision: 'approved' | 'denied') {
    setActing(row.id)
    setActionError(null)
    setNotice(null)
    try {
      const res = await fetch('/api/availability-decision', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ availabilityChangeRequestId: row.id, decision }),
      })
      const result = (await res.json().catch(() => null)) as { ok?: boolean; message?: string } | null
      if (!res.ok || !result?.ok) {
        setActionError(result?.message ?? 'That change could not be processed. Nothing changed — please try again.')
      } else if (result?.message) {
        setNotice(result.message)
      }
    } catch {
      setActionError('Could not reach the server to process that change. Nothing changed — please try again.')
    } finally {
      setActing(null)
      fetchData()
    }
  }

  async function remove(row: AvailChangeRequest) {
    if (!confirm('Delete this availability request from the list? This does not undo an applied change.')) return
    setActing(row.id)
    await supabase.from('availability_change_requests').delete().eq('id', row.id).eq('company_id', COMPANY_ID)
    setActing(null)
    fetchData()
  }

  const filtered = statusFilter === 'all' ? rows : rows.filter((r) => r.status === statusFilter)
  const pendingCount = rows.filter((r) => r.status === 'pending').length

  if (loading) {
    return (
      <div style={{ padding: '48px 0', textAlign: 'center', color: 'var(--text-muted)', fontSize: 13 }}>
        Loading availability changes...
      </div>
    )
  }

  return (
    <div>
      {actionError && (
        <div style={{ marginBottom: 12, padding: '10px 12px', borderRadius: 8, fontSize: 13, color: 'var(--status-blocked-text)', background: 'var(--status-blocked-bg)', border: '1px solid var(--status-blocked-border)' }}>
          {actionError}
        </div>
      )}
      {notice && (
        <div style={{ marginBottom: 12, padding: '10px 12px', borderRadius: 8, fontSize: 13, color: 'var(--status-ready-text)', background: 'var(--status-ready-bg)', border: '1px solid var(--status-ready-border)' }}>
          {notice}
        </div>
      )}

      <div style={{ display: 'flex', alignItems: 'center', marginBottom: 16, gap: 10 }}>
        <div style={{ fontSize: 12, color: 'var(--text-muted)' }}>
          Availability changes employees submitted to Aegis, pending your approval.
          {pendingCount > 0 && (
            <span style={{ marginLeft: 8, color: 'var(--accent)', fontWeight: 500 }}>
              {pendingCount} awaiting your approval.
            </span>
          )}
        </div>
        <div style={{ marginLeft: 'auto' }}>
          <select className="form-select" style={{ maxWidth: 180 }} value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)}>
            <option value="all">All Statuses</option>
            <option value="pending">Awaiting Approval</option>
            <option value="approved">Approved</option>
            <option value="denied">Denied</option>
            <option value="withdrawn">Superseded</option>
          </select>
        </div>
      </div>

      <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
        {filtered.map((row) => {
          const config = STATUS_CONFIG[row.status] ?? STATUS_CONFIG.pending
          const isPending = row.status === 'pending'
          const isActing = acting === row.id
          const snap = row.proposed_change ?? ({} as AvailSnapshot)
          const employeeName = names[row.employee_id] ?? snap.employee_name ?? 'Unknown'
          const before = row.prior_snapshot ?? snap.current_availability ?? []
          const after = snap.proposed_availability ?? []

          return (
            <div key={row.id} style={{
              background: 'var(--bg-surface-1)',
              border: '1px solid var(--border-default)',
              borderLeft: isPending ? '3px solid var(--accent)' : '3px solid var(--border-subtle)',
              borderRadius: 'var(--radius-lg)',
              padding: '14px 18px',
              display: 'flex',
              gap: 16,
              alignItems: 'flex-start',
            }}>
              {/* Left: status + kind + time */}
              <div style={{ minWidth: 130, flexShrink: 0 }}>
                <span style={{
                  display: 'inline-block', padding: '2px 8px', borderRadius: 'var(--radius-pill)',
                  fontSize: 11, fontWeight: 500, background: config.bg, color: config.color,
                  border: `1px solid ${config.border}`, marginBottom: 6,
                }}>
                  {config.label}
                </span>
                <div style={{ fontSize: 11, color: 'var(--text-secondary)', fontWeight: 500 }}>
                  {KIND_LABEL[row.change_kind] ?? row.change_kind}
                </div>
                <div style={{ fontSize: 10, color: 'var(--text-disabled)', marginTop: 2 }}>
                  {timeAgo(row.requested_at)}
                </div>
              </div>

              {/* Center: who + before/after */}
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--text-primary)', marginBottom: 8 }}>
                  {employeeName}
                  {row.change_kind === 'date_limited' && snap.custom_end_date && (
                    <span style={{ fontWeight: 400, fontSize: 11, color: 'var(--text-muted)', marginLeft: 8 }}>
                      through {fmtDate(snap.custom_end_date)}, then back to normal
                    </span>
                  )}
                  {row.change_kind === 'rotating' && snap.rotation && (
                    <span style={{ fontWeight: 400, fontSize: 11, color: 'var(--text-muted)', marginLeft: 8 }}>
                      {snap.rotation.cycle_weeks}-week cycle from {fmtDate(snap.rotation.cycle_start_date)}
                    </span>
                  )}
                </div>

                {row.change_kind === 'rotating' && snap.rotation ? (
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                    {snap.rotation.weeks?.map((w) => (
                      <div key={w.week}>
                        <div style={{ fontSize: 10, color: 'var(--text-muted)', marginBottom: 3 }}>Week {w.week}</div>
                        <DayPills slots={w.days} />
                      </div>
                    ))}
                  </div>
                ) : (
                  <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
                    <div>
                      <div style={{ fontSize: 10, color: 'var(--text-muted)', marginBottom: 3 }}>Current</div>
                      <DayPills slots={before} />
                    </div>
                    <div>
                      <div style={{ fontSize: 10, color: 'var(--accent)', marginBottom: 3 }}>
                        {row.change_kind === 'date_limited' ? 'During override' : 'Proposed'}
                      </div>
                      <DayPills slots={after} />
                    </div>
                  </div>
                )}

                {row.raw_request && (
                  <div style={{
                    fontSize: 11, color: 'var(--text-muted)', marginTop: 8,
                    background: 'var(--bg-surface-2)', borderRadius: 'var(--radius-sm)',
                    padding: '6px 10px', lineHeight: 1.5,
                  }}>
                    “{row.raw_request}”
                  </div>
                )}
              </div>

              {/* Right: actions */}
              {isPending ? (
                <div style={{ flexShrink: 0, display: 'flex', gap: 8, alignItems: 'center' }}>
                  <button onClick={() => decide(row, 'denied')} disabled={isActing} className="btn btn-sm btn-secondary"
                    style={{ borderColor: 'var(--status-blocked-border)', color: 'var(--status-blocked-text)' }}>
                    {isActing ? '...' : 'Deny'}
                  </button>
                  <button onClick={() => decide(row, 'approved')} disabled={isActing} className="btn btn-sm btn-primary">
                    {isActing ? '...' : 'Approve'}
                  </button>
                </div>
              ) : (
                <div style={{ flexShrink: 0, display: 'flex', gap: 10, alignItems: 'center' }}>
                  {row.decided_at && (
                    <span style={{ fontSize: 11, color: 'var(--text-disabled)' }}>
                      {row.status === 'approved' ? 'Approved' : row.status === 'denied' ? 'Denied' : 'Superseded'} {timeAgo(row.decided_at)}
                    </span>
                  )}
                  <button onClick={() => remove(row)} disabled={isActing} className="btn btn-sm btn-secondary"
                    title="Remove from list" style={{ color: 'var(--text-muted)' }}>
                    ✕
                  </button>
                </div>
              )}
            </div>
          )
        })}

        {filtered.length === 0 && (
          <div style={{ background: 'var(--bg-surface-1)', border: '1px solid var(--border-default)', borderRadius: 'var(--radius-lg)' }}>
            <div className="empty-state">
              <div className="empty-state-title">No availability changes</div>
              <div className="empty-state-desc">
                When employees submit availability changes to Aegis, they will appear here for approval — just like Time Off and Swaps.
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
