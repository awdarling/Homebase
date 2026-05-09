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

interface Policy {
  id: string
  policy_key: string
  policy_value: string
  policy_type: string
  description: string | null
  version: number
  created_at: string
}

const CATEGORIES: { id: string; label: string; description: string }[] = [
  { id: 'time_off',   label: 'Time-Off',   description: 'Rules governing how Aegis handles time-off requests — notice periods, blackout dates, approval logic.' },
  { id: 'scheduling', label: 'Scheduling',  description: 'Rules about how Aegis builds schedules — fairness, rotation, manager requirements, consecutive days.' },
  { id: 'swaps',      label: 'Swaps',       description: 'Rules governing shift swaps — which require approval, notice periods, cross-role permissions.' },
  { id: 'coverage',   label: 'Coverage',    description: 'Rules about minimum staffing — fallback behavior, role overlap requirements, understaffing tolerance.' },
  { id: 'emergency',  label: 'Emergency',   description: 'Rules for last-minute callouts — how aggressively Aegis contacts alternates, overtime tolerance.' },
  { id: 'general',    label: 'General',     description: 'Any operational preference that doesn\'t fit the above categories.' },
]

export default function RulesPage() {
  const { company } = useCompany()
  const COMPANY_ID = company?.id ?? ''
  const [policies, setPolicies] = useState<Policy[]>([])
  const [loading, setLoading] = useState(true)
  const [showForm, setShowForm] = useState(false)
  const [editingPolicy, setEditingPolicy] = useState<Policy | null>(null)
  const [form, setForm] = useState({ policy_type: 'time_off', policy_key: '', policy_value: '', description: '' })
  const [formSaving, setFormSaving] = useState(false)
  const [formError, setFormError] = useState('')
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null)

  const supabase = createClient()

  useEffect(() => { if (COMPANY_ID) fetchData() }, [COMPANY_ID])

  async function fetchData() {
    if (!COMPANY_ID) return
    setLoading(true)
    const { data } = await supabase
      .from('policies')
      .select('*')
      .eq('company_id', COMPANY_ID)
      .order('policy_type')
      .order('created_at')
    if (data) setPolicies(data)
    setLoading(false)
  }

  async function logActivity(action: string, summary: string, entityId?: string) {
    await supabase.from('activity_log').insert({
      company_id: COMPANY_ID,
      actor: 'manager',
      action,
      entity_type: 'policy',
      entity_id: entityId ?? null,
      summary,
    })
  }

  function openAdd() {
    setEditingPolicy(null)
    setForm({ policy_type: 'time_off', policy_key: '', policy_value: '', description: '' })
    setFormError('')
    setShowForm(true)
  }

  function openEdit(policy: Policy) {
    setEditingPolicy(policy)
    setForm({
      policy_type: policy.policy_type,
      policy_key: policy.policy_key.replace(/_/g, ' '),
      policy_value: policy.policy_value,
      description: policy.description ?? '',
    })
    setFormError('')
    setShowForm(true)
  }

  async function handleSave() {
    if (!form.policy_key.trim()) { setFormError('Rule name is required.'); return }
    if (!form.policy_value.trim()) { setFormError('Rule value is required.'); return }
    if (!form.description.trim()) { setFormError('Description is required — Aegis uses this to understand the rule.'); return }
    setFormSaving(true)
    setFormError('')

    const payload = {
      company_id: COMPANY_ID,
      policy_key: form.policy_key.trim().toLowerCase().replace(/\s+/g, '_'),
      policy_value: form.policy_value.trim(),
      policy_type: form.policy_type,
      description: form.description.trim(),
    }

    if (editingPolicy) {
      await supabase.from('policies').update({
        ...payload,
        version: editingPolicy.version + 1,
      }).eq('id', editingPolicy.id)
      await logActivity(
        'policy_updated',
        `Updated rule "${form.policy_key}" in ${CATEGORIES.find(c => c.id === form.policy_type)?.label ?? form.policy_type}: ${form.policy_value} (v${editingPolicy.version + 1})`,
        editingPolicy.id
      )
    } else {
      const { data } = await supabase.from('policies').insert({
        ...payload,
        version: 1,
      }).select().single()
      if (data) await logActivity(
        'policy_created',
        `Added rule "${form.policy_key}" to ${CATEGORIES.find(c => c.id === form.policy_type)?.label ?? form.policy_type}: ${form.policy_value}`,
        data.id
      )
    }

    setFormSaving(false)
    setShowForm(false)
    fetchData()
  }

  async function handleDelete(id: string) {
    const policy = policies.find((p) => p.id === id)
    await supabase.from('policies').delete().eq('id', id)
    await logActivity('policy_deleted', `Deleted rule: "${policy?.policy_key?.replace(/_/g, ' ') ?? id}"`, id)
    setConfirmDeleteId(null)
    fetchData()
  }

  const grouped = CATEGORIES.reduce((acc, cat) => {
    acc[cat.id] = policies.filter((p) => p.policy_type === cat.id)
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
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
          <div>
            <div className="page-title">Rules</div>
            <div className="page-subtitle">Behavioral policies Aegis follows when making decisions</div>
          </div>
          <button className="btn btn-primary btn-sm" onClick={openAdd}>
            + Add Rule
          </button>
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
        {' '}Rules are organized by function so Aegis knows exactly which policies apply to each decision it makes. Be specific — Aegis follows these precisely.
      </div>

      <div style={{ display: 'flex', flexDirection: 'column', gap: 24 }}>
        {CATEGORIES.map((cat) => {
          const catPolicies = grouped[cat.id] ?? []
          return (
            <div key={cat.id}>
              <div style={{ display: 'flex', alignItems: 'baseline', gap: 10, marginBottom: 8 }}>
                <div className="section-label" style={{ margin: 0 }}>{cat.label}</div>
                <div style={{ fontSize: 11, color: 'var(--text-muted)' }}>{cat.description}</div>
              </div>
              <div style={{
                background: 'var(--bg-surface-1)',
                border: '1px solid var(--border-default)',
                borderRadius: 'var(--radius-lg)',
                overflow: 'hidden',
              }}>
                {catPolicies.length === 0 ? (
                  <div style={{ padding: '16px 20px' }}>
                    <div style={{ fontSize: 12, color: 'var(--text-disabled)', fontStyle: 'italic' }}>
                      No {cat.label.toLowerCase()} rules defined yet.
                    </div>
                  </div>
                ) : catPolicies.map((policy, i) => (
                  <div key={policy.id} style={{
                    display: 'flex',
                    alignItems: 'flex-start',
                    gap: 16,
                    padding: '16px 20px',
                    borderBottom: i < catPolicies.length - 1 ? '1px solid var(--border-subtle)' : 'none',
                  }}>
                    {/* Rule name + description */}
                    <div style={{ flex: 1 }}>
                      <div style={{ fontSize: 13, color: 'var(--text-primary)', fontWeight: 500, marginBottom: 3 }}>
                        {policy.policy_key.replace(/_/g, ' ')}
                      </div>
                      {policy.description && (
                        <div style={{ fontSize: 11, color: 'var(--text-muted)', lineHeight: 1.6 }}>
                          {policy.description}
                        </div>
                      )}
                      {policy.version > 1 && (
                        <div style={{ fontSize: 10, color: 'var(--text-disabled)', marginTop: 4 }}>
                          v{policy.version}
                        </div>
                      )}
                    </div>

                    {/* Value */}
                    <div style={{
                      fontFamily: 'var(--font-display)',
                      fontSize: 15,
                      fontWeight: 700,
                      color: 'var(--accent)',
                      minWidth: 80,
                      textAlign: 'right',
                      flexShrink: 0,
                      paddingTop: 2,
                    }}>
                      {policy.policy_value === 'true' ? 'Yes'
                        : policy.policy_value === 'false' ? 'No'
                        : policy.policy_value}
                    </div>

                    {/* Actions */}
                    <div style={{ display: 'flex', gap: 6, alignItems: 'center', flexShrink: 0 }}>
                      <button
                        className="btn btn-secondary btn-sm"
                        onClick={() => openEdit(policy)}
                      >
                        Edit
                      </button>
                      <button
                        onClick={() => setConfirmDeleteId(policy.id)}
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
                        title="Delete rule"
                      >
                        <TrashIcon />
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )
        })}
      </div>

      {/* Confirm delete modal */}
      {confirmDeleteId && (
        <div style={{ position: 'fixed', inset: 0, zIndex: 200, background: 'rgba(0,0,0,0.7)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
          <div style={{ background: 'var(--bg-surface-1)', border: '1px solid var(--border-default)', borderRadius: 'var(--radius-xl)', padding: 28, width: '100%', maxWidth: 380 }}>
            <div style={{ fontFamily: 'var(--font-display)', fontSize: 18, fontWeight: 700, color: 'var(--text-primary)', marginBottom: 10 }}>
              Delete Rule
            </div>
            <div style={{ fontSize: 13, color: 'var(--text-muted)', marginBottom: 20, lineHeight: 1.6 }}>
              This will permanently delete the rule. Aegis will no longer follow it.
            </div>
            <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
              <button className="btn btn-secondary btn-sm" onClick={() => setConfirmDeleteId(null)}>Cancel</button>
              <button
                className="btn btn-sm"
                onClick={() => handleDelete(confirmDeleteId)}
                style={{ background: 'var(--status-blocked-bg)', color: 'var(--status-blocked-text)', border: '1px solid var(--status-blocked-border)' }}
              >
                Delete Permanently
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Add/Edit modal */}
      {showForm && (
        <div style={{ position: 'fixed', inset: 0, zIndex: 200, background: 'rgba(0,0,0,0.7)', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 20 }}>
          <div style={{ background: 'var(--bg-surface-1)', border: '1px solid var(--border-default)', borderRadius: 'var(--radius-xl)', padding: 28, width: '100%', maxWidth: 500 }}>
            <div style={{ fontFamily: 'var(--font-display)', fontSize: 18, fontWeight: 700, color: 'var(--text-primary)', marginBottom: 20 }}>
              {editingPolicy ? 'Edit Rule' : 'Add Rule'}
            </div>

            <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
              <div className="form-group">
                <label className="form-label">Category</label>
                <select
                  className="form-select"
                  value={form.policy_type}
                  onChange={(e) => setForm((f) => ({ ...f, policy_type: e.target.value }))}
                >
                  {CATEGORIES.map((c) => (
                    <option key={c.id} value={c.id}>{c.label}</option>
                  ))}
                </select>
                <div style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 4 }}>
                  {CATEGORIES.find((c) => c.id === form.policy_type)?.description}
                </div>
              </div>

              <div className="form-group">
                <label className="form-label">Rule Name</label>
                <input
                  className="form-input"
                  value={form.policy_key}
                  onChange={(e) => setForm((f) => ({ ...f, policy_key: e.target.value }))}
                  placeholder="e.g. Minimum notice period for time-off requests"
                />
              </div>

              <div className="form-group">
                <label className="form-label">Value</label>
                <input
                  className="form-input"
                  value={form.policy_value}
                  onChange={(e) => setForm((f) => ({ ...f, policy_value: e.target.value }))}
                  placeholder="e.g. 7 days, true, never, required"
                />
                <div style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 4 }}>
                  Use plain language — true/false for yes/no rules, a number for quantities, or a word like "never" or "required" for behavioral rules.
                </div>
              </div>

              <div className="form-group">
                <label className="form-label">Description <span style={{ color: 'var(--status-blocked-text)', fontWeight: 400 }}>*</span></label>
                <textarea
                  className="form-input"
                  rows={3}
                  value={form.description}
                  onChange={(e) => setForm((f) => ({ ...f, description: e.target.value }))}
                  placeholder="Explain exactly what this rule means and when Aegis should apply it. Be specific."
                  style={{ resize: 'vertical' }}
                />
                <div style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 4 }}>
                  Required — Aegis reads the description to understand how to apply this rule. Vague descriptions produce vague behavior.
                </div>
              </div>
            </div>

            {formError && (
              <div style={{ fontSize: 12, color: 'var(--status-blocked-text)', marginTop: 12 }}>
                {formError}
              </div>
            )}

            <div style={{ display: 'flex', gap: 8, marginTop: 20, justifyContent: 'flex-end' }}>
              <button className="btn btn-secondary btn-sm" onClick={() => setShowForm(false)}>Cancel</button>
              <button className="btn btn-primary btn-sm" onClick={handleSave} disabled={formSaving}>
                {formSaving ? 'Saving...' : editingPolicy ? 'Save Changes' : 'Add Rule'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}