'use client'

import { useEffect, useState } from 'react'
import { createClient } from '@/lib/supabase/client'

const COMPANY_ID = 'a1b2c3d4-e5f6-7890-abcd-ef1234567890'

interface Policy {
  id: string
  policy_key: string
  policy_value: string
  policy_type: string
  description: string | null
  version: number
  created_at: string
}

const POLICY_META: Record<string, { label: string; inputType: 'number' | 'boolean' | 'text'; unit?: string }> = {
  max_consecutive_days_off:   { label: 'Max Consecutive Days Off',     inputType: 'number',  unit: 'days' },
  min_notice_period_days:     { label: 'Minimum Notice Period',        inputType: 'number',  unit: 'days' },
  max_staff_off_percent:      { label: 'Max Staff Off Per Day',        inputType: 'number',  unit: '%' },
  lifeguard_coverage_floor:   { label: 'Lifeguard Coverage Floor',     inputType: 'number',  unit: 'people' },
  headguard_overlap_needed:   { label: 'Headguard Overlap Required',   inputType: 'boolean' },
  no_to_prime_weekends:       { label: 'No Time-Off on Prime Weekends',inputType: 'boolean' },
  always_one_manager_on_duty: { label: 'Always One Manager On Duty',   inputType: 'boolean' },
}

const TYPE_LABELS: Record<string, string> = {
  hours:       'Hours & Limits',
  fairness:    'Fairness',
  eligibility: 'Coverage Requirements',
  overtime:    'Scheduling Restrictions',
  custom:      'Custom Rules',
}

export default function RulesPage() {
  const [policies, setPolicies] = useState<Policy[]>([])
  const [loading, setLoading] = useState(true)
  const [editingId, setEditingId] = useState<string | null>(null)
  const [editValue, setEditValue] = useState('')
  const [saving, setSaving] = useState(false)
  const [showAddForm, setShowAddForm] = useState(false)
  const [newForm, setNewForm] = useState({ policy_key: '', policy_value: '', description: '' })
  const [addSaving, setAddSaving] = useState(false)
  const [addError, setAddError] = useState('')

  const supabase = createClient()

  useEffect(() => { fetchData() }, [])

  async function fetchData() {
    setLoading(true)
    const { data } = await supabase
      .from('policies')
      .select('*')
      .eq('company_id', COMPANY_ID)
      .order('policy_type')
      .order('policy_key')
    if (data) setPolicies(data)
    setLoading(false)
  }

  function startEdit(policy: Policy) {
    setEditingId(policy.id)
    setEditValue(policy.policy_value)
  }

  function cancelEdit() {
    setEditingId(null)
    setEditValue('')
  }

  async function saveEdit(policy: Policy) {
    setSaving(true)
    await supabase
      .from('policies')
      .update({
        policy_value: editValue,
        version: policy.version + 1,
      })
      .eq('id', policy.id)
    setSaving(false)
    setEditingId(null)
    fetchData()
  }

  async function handleDelete(id: string) {
    await supabase.from('policies').delete().eq('id', id)
    fetchData()
  }

  async function handleAdd() {
    if (!newForm.policy_key.trim() || !newForm.policy_value.trim()) {
      setAddError('Name and value are required.')
      return
    }
    setAddSaving(true)
    await supabase.from('policies').insert({
      company_id: COMPANY_ID,
      policy_key: newForm.policy_key.trim().toLowerCase().replace(/\s+/g, '_'),
      policy_value: newForm.policy_value.trim(),
      policy_type: 'custom',
      description: newForm.description.trim() || null,
      version: 1,
    })
    setAddSaving(false)
    setShowAddForm(false)
    setNewForm({ policy_key: '', policy_value: '', description: '' })
    setAddError('')
    fetchData()
  }

  const grouped = policies.reduce((acc, p) => {
    const type = p.policy_type
    if (!acc[type]) acc[type] = []
    acc[type].push(p)
    return acc
  }, {} as Record<string, Policy[]>)

  if (loading) return (
    <div style={{ padding: '48px 0', textAlign: 'center', color: 'var(--text-muted)', fontSize: 13 }}>
      Loading rules...
    </div>
  )

  return (
    <div className="page-content">
      <div className="page-header">
        <div className="page-title">Rules</div>
        <div className="page-subtitle">
          Company logic and operating constraints Aegis follows
        </div>
      </div>

      <div style={{
        background: 'var(--accent-dim)',
        border: '1px solid var(--accent-border)',
        borderRadius: 'var(--radius-lg)',
        padding: '12px 16px',
        fontSize: 12,
        color: 'var(--text-secondary)',
        marginBottom: 28,
        lineHeight: 1.6,
      }}>
        <span style={{ color: 'var(--accent)', fontWeight: 600 }}>Aegis reads every rule on this page.</span>
        {' '}Changes take effect immediately on the next request Aegis processes. Be precise — Aegis will follow these exactly.
      </div>

      <div style={{ display: 'flex', flexDirection: 'column', gap: 24 }}>
        {Object.entries(grouped).map(([type, typePolicies]) => (
          <div key={type}>
            <div className="section-label">{TYPE_LABELS[type] ?? type}</div>
            <div style={{
              background: 'var(--bg-surface-1)',
              border: '1px solid var(--border-default)',
              borderRadius: 'var(--radius-lg)',
              overflow: 'hidden',
            }}>
              {typePolicies.map((policy, i) => {
                const meta = POLICY_META[policy.policy_key]
                const isEditing = editingId === policy.id
                const isBoolean = meta?.inputType === 'boolean'

                return (
                  <div key={policy.id} style={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: 16,
                    padding: '16px 20px',
                    borderBottom: i < typePolicies.length - 1 ? '1px solid var(--border-subtle)' : 'none',
                  }}>
                    <div style={{ flex: 1 }}>
                      <div style={{ fontSize: 13, color: 'var(--text-primary)', fontWeight: 500, marginBottom: 3 }}>
                        {meta?.label ?? policy.policy_key.replace(/_/g, ' ')}
                      </div>
                      {policy.description && (
                        <div style={{ fontSize: 11, color: 'var(--text-muted)', lineHeight: 1.5 }}>
                          {policy.description}
                        </div>
                      )}
                      {policy.version > 1 && (
                        <div style={{ fontSize: 10, color: 'var(--text-disabled)', marginTop: 3 }}>
                          v{policy.version}
                        </div>
                      )}
                    </div>

                    <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                      {isEditing ? (
                        <>
                          {isBoolean ? (
                            <select
                              className="form-select"
                              style={{ width: 100 }}
                              value={editValue}
                              onChange={(e) => setEditValue(e.target.value)}
                            >
                              <option value="true">Yes</option>
                              <option value="false">No</option>
                            </select>
                          ) : (
                            <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                              <input
                                className="form-input"
                                style={{ width: 80, textAlign: 'center' }}
                                value={editValue}
                                onChange={(e) => setEditValue(e.target.value)}
                                autoFocus
                              />
                              {meta?.unit && (
                                <span style={{ fontSize: 12, color: 'var(--text-muted)' }}>{meta.unit}</span>
                              )}
                            </div>
                          )}
                          <button
                            className="btn btn-primary btn-sm"
                            onClick={() => saveEdit(policy)}
                            disabled={saving}
                          >
                            {saving ? '...' : 'Save'}
                          </button>
                          <button className="btn btn-secondary btn-sm" onClick={cancelEdit}>
                            Cancel
                          </button>
                        </>
                      ) : (
                        <>
                          <div style={{
                            fontFamily: 'var(--font-display)',
                            fontSize: 15,
                            fontWeight: 700,
                            color: 'var(--accent)',
                            minWidth: 60,
                            textAlign: 'right',
                          }}>
                            {isBoolean
                              ? (policy.policy_value === 'true' ? 'Yes' : 'No')
                              : `${policy.policy_value}${meta?.unit ? ' ' + meta.unit : ''}`
                            }
                          </div>
                          <button
                            className="btn btn-secondary btn-sm"
                            onClick={() => startEdit(policy)}
                          >
                            Edit
                          </button>
                          {policy.policy_type === 'custom' && (
                            <button
                              className="btn btn-danger btn-sm"
                              onClick={() => handleDelete(policy.id)}
                            >
                              Remove
                            </button>
                          )}
                        </>
                      )}
                    </div>
                  </div>
                )
              })}
            </div>
          </div>
        ))}
      </div>

      <div style={{ marginTop: 28, display: 'flex', justifyContent: 'flex-end' }}>
        <button className="btn btn-primary btn-sm" onClick={() => { setAddError(''); setShowAddForm(true) }}>
          + Add Custom Rule
        </button>
      </div>

      {showAddForm && (
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
              Add Custom Rule
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
              <div className="form-group">
                <label className="form-label">Rule Name</label>
                <input
                  className="form-input"
                  value={newForm.policy_key}
                  onChange={(e) => setNewForm((f) => ({ ...f, policy_key: e.target.value }))}
                  placeholder="e.g. No back-to-back closing shifts"
                />
              </div>
              <div className="form-group">
                <label className="form-label">Value</label>
                <input
                  className="form-input"
                  value={newForm.policy_value}
                  onChange={(e) => setNewForm((f) => ({ ...f, policy_value: e.target.value }))}
                  placeholder="e.g. true, 2, never"
                />
              </div>
              <div className="form-group">
                <label className="form-label">Description (optional)</label>
                <textarea
                  className="form-textarea"
                  value={newForm.description}
                  onChange={(e) => setNewForm((f) => ({ ...f, description: e.target.value }))}
                  placeholder="Explain what this rule means and when it applies..."
                />
              </div>
            </div>
            {addError && <div style={{ fontSize: 12, color: 'var(--status-blocked-text)', marginTop: 12 }}>{addError}</div>}
            <div style={{ display: 'flex', gap: 8, marginTop: 20, justifyContent: 'flex-end' }}>
              <button className="btn btn-secondary btn-sm" onClick={() => setShowAddForm(false)}>Cancel</button>
              <button className="btn btn-primary btn-sm" onClick={handleAdd} disabled={addSaving}>
                {addSaving ? 'Saving...' : 'Add Rule'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}