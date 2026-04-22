'use client'

import { useEffect, useState } from 'react'
import { createClient } from '@/lib/supabase/client'
import { useCompany } from '@/lib/hooks/useCompany'

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

interface WageRate {
  id: string
  company_id: string
  role: string
  hourly_rate: number
}

export default function WageRatesTab() {
  const { company } = useCompany()
  const COMPANY_ID = company?.id ?? ''
  const supabase = createClient()

  const [rates, setRates] = useState<WageRate[]>([])
  const [loading, setLoading] = useState(true)
  const [showForm, setShowForm] = useState(false)
  const [editingRate, setEditingRate] = useState<WageRate | null>(null)
  const [form, setForm] = useState({ role: '', hourly_rate: '' })
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null)

  useEffect(() => { if (COMPANY_ID) fetchRates() }, [COMPANY_ID])

  async function fetchRates() {
    setLoading(true)
    const { data } = await supabase
      .from('wage_rates')
      .select('*')
      .eq('company_id', COMPANY_ID)
      .order('role')
    if (data) setRates(data)
    setLoading(false)
  }

  function openAdd() {
    setEditingRate(null)
    setForm({ role: '', hourly_rate: '' })
    setError('')
    setShowForm(true)
  }

  function openEdit(rate: WageRate) {
    setEditingRate(rate)
    setForm({ role: rate.role, hourly_rate: String(rate.hourly_rate) })
    setError('')
    setShowForm(true)
  }

  async function handleSave() {
    if (!form.role.trim()) {
      setError('Role name is required.')
      return
    }
    const parsed = parseFloat(form.hourly_rate)
    if (isNaN(parsed) || parsed < 0) {
      setError('Enter a valid hourly rate.')
      return
    }
    setSaving(true)
    setError('')

    const payload = {
      company_id: COMPANY_ID,
      role: form.role.trim(),
      hourly_rate: parsed,
    }

    if (editingRate) {
      await supabase.from('wage_rates').update(payload).eq('id', editingRate.id)
    } else {
      await supabase.from('wage_rates').insert(payload)
    }

    setSaving(false)
    setShowForm(false)
    fetchRates()
  }

  async function handleDelete(id: string) {
    await supabase.from('wage_rates').delete().eq('id', id)
    setConfirmDeleteId(null)
    fetchRates()
  }

  if (loading) {
    return (
      <div style={{ padding: '48px 0', textAlign: 'center', color: 'var(--text-muted)', fontSize: 13 }}>
        Loading wage rates...
      </div>
    )
  }

  return (
    <div>
      <div style={{ display: 'flex', alignItems: 'center', marginBottom: 16 }}>
        <div style={{ fontSize: 12, color: 'var(--text-muted)' }}>
          Default hourly rates by role. Overridden by individual employee wages where set.
        </div>
        <div style={{ marginLeft: 'auto' }}>
          <button className="btn btn-primary btn-sm" onClick={openAdd}>
            + Add Role Rate
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
            <col style={{ width: '60%' }} />
            <col style={{ width: '32%' }} />
            <col style={{ width: '8%' }} />
          </colgroup>
          <thead>
            <tr>
              <th>Role</th>
              <th>Hourly Rate</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {rates.map((rate) => (
              <tr key={rate.id} onClick={() => openEdit(rate)} style={{ cursor: 'pointer' }}>
                <td style={{ color: 'var(--text-primary)', fontSize: 13 }}>
                  {rate.role}
                </td>
                <td style={{ color: 'var(--accent)', fontSize: 13, fontWeight: 500 }}>
                  ${Number(rate.hourly_rate).toFixed(2)}/hr
                </td>
                <td>
                  <button
                    onClick={(e) => { e.stopPropagation(); setConfirmDeleteId(rate.id) }}
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
                    title="Delete rate"
                  >
                    <TrashIcon />
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>

        {rates.length === 0 && (
          <div className="empty-state">
            <div className="empty-state-title">No wage rates defined</div>
            <div className="empty-state-desc">
              Add a rate for each role. Aegis uses these to calculate estimated wages.
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
              Delete Wage Rate
            </div>
            <div style={{ fontSize: 13, color: 'var(--text-muted)', marginBottom: 20, lineHeight: 1.6 }}>
              This will remove the rate for this role. Employees without an individual wage will be flagged as missing wage data.
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
                Delete Rate
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
            maxWidth: 400,
          }}>
            <div style={{ fontFamily: 'var(--font-display)', fontSize: 18, fontWeight: 700, color: 'var(--text-primary)', marginBottom: 20 }}>
              {editingRate ? 'Edit Wage Rate' : 'Add Wage Rate'}
            </div>

            <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
              <div className="form-group">
                <label className="form-label">Role Name</label>
                <input
                  className="form-input"
                  value={form.role}
                  onChange={(e) => setForm((f) => ({ ...f, role: e.target.value }))}
                  placeholder="e.g. Lifeguard"
                />
              </div>
              <div className="form-group">
                <label className="form-label">Hourly Rate ($)</label>
                <input
                  className="form-input"
                  type="number"
                  step="0.01"
                  min="0"
                  value={form.hourly_rate}
                  onChange={(e) => setForm((f) => ({ ...f, hourly_rate: e.target.value }))}
                  placeholder="e.g. 15.00"
                />
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
                {saving ? 'Saving...' : 'Save Rate'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}