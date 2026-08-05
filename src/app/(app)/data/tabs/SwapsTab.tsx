'use client'

import { useEffect, useState } from 'react'
import { createClient } from '@/lib/supabase/client'
import { useCompany } from '@/lib/hooks/useCompany'

interface SwapRequest {
  id: string
  company_id: string
  requesting_employee_id: string
  receiving_employee_id: string | null
  shift_date: string
  shift_name: string
  role: string
  status: 'pending_employee' | 'pending_manager' | 'approved' | 'denied' | 'cancelled'
  initiated_by: 'employee' | 'manager' | 'aegis'
  notes: string | null
  decided_by: string | null
  decided_at: string | null
  created_at: string
  updated_at: string
  requesting_employee?: { name: string }
  receiving_employee?: { name: string }
}

const STATUS_CONFIG: Record<string, { label: string; badge: string; color: string; bg: string; border: string }> = {
  pending_employee: {
    label: 'Awaiting Employee',
    badge: 'badge-review',
    color: 'var(--status-review-text)',
    bg: 'var(--status-review-bg)',
    border: 'var(--status-review-border)',
  },
  pending_manager: {
    label: 'Awaiting Approval',
    badge: 'badge-action',
    color: 'var(--accent)',
    bg: 'var(--accent-dim)',
    border: 'var(--accent-border)',
  },
  approved: {
    label: 'Approved',
    badge: 'badge-ready',
    color: 'var(--status-ready-text)',
    bg: 'var(--status-ready-bg)',
    border: 'var(--status-ready-border)',
  },
  denied: {
    label: 'Denied',
    badge: 'badge-blocked',
    color: 'var(--status-blocked-text)',
    bg: 'var(--status-blocked-bg)',
    border: 'var(--status-blocked-border)',
  },
  cancelled: {
    label: 'Cancelled',
    badge: 'badge-blocked',
    color: 'var(--text-muted)',
    bg: 'var(--bg-surface-3)',
    border: 'var(--border-default)',
  },
}

function formatDate(d: string) {
  const [y, m, day] = d.split('-').map(Number)
  return new Date(y, m - 1, day).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
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

export default function SwapsTab() {
  const { company } = useCompany()
  const COMPANY_ID = company?.id ?? ''
  const supabase = createClient()

  const [swaps, setSwaps] = useState<SwapRequest[]>([])
  const [loading, setLoading] = useState(true)
  const [statusFilter, setStatusFilter] = useState('all')
  const [acting, setActing] = useState<string | null>(null)
  const [actionError, setActionError] = useState<string | null>(null)

  useEffect(() => { if (COMPANY_ID) fetchData() }, [COMPANY_ID])

  async function fetchData() {
    setLoading(true)
    const { data } = await supabase
      .from('swap_requests')
      .select(`
        *,
        requesting_employee:employees!swap_requests_requesting_employee_fkey(name),
        receiving_employee:employees!swap_requests_receiving_employee_fkey(name)
      `)
      .eq('company_id', COMPANY_ID)
      .order('created_at', { ascending: false })
    if (data) setSwaps(data as SwapRequest[])
    setLoading(false)
  }

  // Aegis is authoritative for the swap_requests.status write + notifications:
  // it applies the schedule change first, then marks the row and notifies both
  // people. The tab no longer writes status client-side — it POSTs the manager's
  // decision to /api/swap-decision (which auths + calls Aegis) and reflects the
  // real outcome, surfacing anything that didn't land.
  async function decide(swap: SwapRequest, decision: 'approved' | 'denied') {
    setActing(swap.id)
    setActionError(null)
    try {
      const res = await fetch('/api/swap-decision', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ swapRequestId: swap.id, decision }),
      })
      const result = (await res.json().catch(() => null)) as { ok?: boolean; message?: string } | null
      if (!res.ok || !result?.ok) {
        setActionError(result?.message ?? 'That swap could not be processed. Nothing changed — please try again.')
      }
    } catch {
      setActionError('Could not reach the server to process that swap. Nothing changed — please try again.')
    } finally {
      setActing(null)
      fetchData()
    }
  }

  const handleApprove = (swap: SwapRequest) => decide(swap, 'approved')
  const handleDeny = (swap: SwapRequest) => decide(swap, 'denied')

  const filtered = statusFilter === 'all'
    ? swaps
    : swaps.filter((s) => s.status === statusFilter)

  const pendingCount = swaps.filter((s) => s.status === 'pending_manager').length

  if (loading) {
    return (
      <div style={{ padding: '48px 0', textAlign: 'center', color: 'var(--text-muted)', fontSize: 13 }}>
        Loading swaps...
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
      <div style={{ display: 'flex', alignItems: 'center', marginBottom: 16, gap: 10 }}>
        <div style={{ fontSize: 12, color: 'var(--text-muted)' }}>
          Shift swap requests initiated by employees or Aegis.
          {pendingCount > 0 && (
            <span style={{ marginLeft: 8, color: 'var(--accent)', fontWeight: 500 }}>
              {pendingCount} awaiting your approval.
            </span>
          )}
        </div>
        <div style={{ marginLeft: 'auto' }}>
          <select
            className="form-select"
            style={{ maxWidth: 180 }}
            value={statusFilter}
            onChange={(e) => setStatusFilter(e.target.value)}
          >
            <option value="all">All Statuses</option>
            <option value="pending_employee">Awaiting Employee</option>
            <option value="pending_manager">Awaiting Approval</option>
            <option value="approved">Approved</option>
            <option value="denied">Denied</option>
            <option value="cancelled">Cancelled</option>
          </select>
        </div>
      </div>

      <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
        {filtered.map((swap) => {
          const config = STATUS_CONFIG[swap.status]
          const isPendingManager = swap.status === 'pending_manager'
          const isActing = acting === swap.id

          return (
            <div
              key={swap.id}
              style={{
                background: 'var(--bg-surface-1)',
                border: '1px solid var(--border-default)',
                borderLeft: isPendingManager ? '3px solid var(--accent)' : '3px solid var(--border-subtle)',
                borderRadius: 'var(--radius-lg)',
                padding: '14px 18px',
                display: 'flex',
                gap: 16,
                alignItems: 'flex-start',
              }}
            >
              {/* Left: status + date */}
              <div style={{ minWidth: 120, flexShrink: 0 }}>
                <span style={{
                  display: 'inline-block',
                  padding: '2px 8px',
                  borderRadius: 'var(--radius-pill)',
                  fontSize: 11,
                  fontWeight: 500,
                  background: config.bg,
                  color: config.color,
                  border: `1px solid ${config.border}`,
                  marginBottom: 6,
                }}>
                  {config.label}
                </span>
                <div style={{ fontSize: 11, color: 'var(--text-muted)' }}>
                  {formatDate(swap.shift_date)}
                </div>
                <div style={{ fontSize: 10, color: 'var(--text-disabled)', marginTop: 2 }}>
                  {timeAgo(swap.created_at)}
                </div>
              </div>

              {/* Center: swap details */}
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 6 }}>
                  <span style={{ fontSize: 13, fontWeight: 600, color: 'var(--text-primary)' }}>
                    {swap.requesting_employee?.name ?? 'Unknown'}
                  </span>
                  <span style={{ fontSize: 12, color: 'var(--text-muted)' }}>↔</span>
                  <span style={{ fontSize: 13, fontWeight: 600, color: 'var(--text-primary)' }}>
                    {swap.receiving_employee?.name ?? (
                      <span style={{ color: 'var(--text-muted)', fontWeight: 400 }}>Finding coverage...</span>
                    )}
                  </span>
                </div>
                <div style={{ display: 'flex', gap: 12, fontSize: 12, color: 'var(--text-secondary)' }}>
                  <span>{swap.shift_name} shift</span>
                  <span>·</span>
                  <span>{swap.role}</span>
                  <span>·</span>
                  <span style={{ fontSize: 11, color: 'var(--text-muted)', textTransform: 'capitalize' }}>
                    via {swap.initiated_by}
                  </span>
                </div>
                {swap.notes && (
                  <div style={{
                    fontSize: 11,
                    color: 'var(--text-muted)',
                    marginTop: 8,
                    background: 'var(--bg-surface-2)',
                    borderRadius: 'var(--radius-sm)',
                    padding: '6px 10px',
                    lineHeight: 1.5,
                  }}>
                    {swap.notes}
                  </div>
                )}
              </div>

              {/* Right: actions */}
              {isPendingManager && (
                <div style={{ flexShrink: 0, display: 'flex', gap: 8, alignItems: 'center' }}>
                  <button
                    onClick={() => handleDeny(swap)}
                    disabled={isActing}
                    className="btn btn-sm btn-secondary"
                    style={{
                      borderColor: 'var(--status-blocked-border)',
                      color: 'var(--status-blocked-text)',
                    }}
                  >
                    {isActing ? '...' : 'Deny'}
                  </button>
                  <button
                    onClick={() => handleApprove(swap)}
                    disabled={isActing}
                    className="btn btn-sm btn-primary"
                  >
                    {isActing ? '...' : 'Approve'}
                  </button>
                </div>
              )}

              {swap.decided_at && (
                <div style={{ flexShrink: 0, fontSize: 11, color: 'var(--text-disabled)', alignSelf: 'center' }}>
                  {swap.status === 'approved' ? 'Approved' : 'Decided'} {timeAgo(swap.decided_at)}
                </div>
              )}
            </div>
          )
        })}

        {filtered.length === 0 && (
          <div style={{
            background: 'var(--bg-surface-1)',
            border: '1px solid var(--border-default)',
            borderRadius: 'var(--radius-lg)',
          }}>
            <div className="empty-state">
              <div className="empty-state-title">No swap requests</div>
              <div className="empty-state-desc">
                When employees or Aegis initiate shift swaps they will appear here for tracking and approval.
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}