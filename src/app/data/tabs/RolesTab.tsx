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

const PRESET_COLORS = [
  '#ef4444', '#f97316', '#f59e0b', '#10b981',
  '#3b82f6', '#8b5cf6', '#ec4899', '#6b7280',
  '#14b8a6', '#84cc16',
]

interface Role {
  id: string
  company_id: string
  name: string
  description: string | null
  color: string
  created_at: string
}

export default function RolesTab() {
  const { company } = useCompany()
  const COMPANY_ID = company?.id ?? ''
  const supabase = createClient()

  const [roles, setRoles] = useState<Role[]>([])
  const [loading, setLoading] = useState(true)
  const [showForm, setShowForm] = useState(false)
  const [editing, setEditing] = useState<Role | null>(null)
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')

  const [form, setForm] = useState({
    name: '',
    description: '',
    color: '#6b7280',
  })

  useEffect(() => { if (COMPANY_ID) fetchData() }, [COMPANY_ID])

  async function fetchData() {
    setLoading(true)
    const { data } = await supabase
      .from('roles')
      .select('*')
      .eq('company_id', COMPANY_ID)
      .order('name')
    if (data) setRoles(data)
    setLoading(false)
  }

  async function logActivity(action: string, summary: string, entityId?: string) {
    await supabase.from('activity_log').insert({
      company_id: COMPANY_ID,
      actor: 'manager',
      action,
      entity_type: 'role',
      entity_id: entityId ?? null,
      summary,
    })
  }

  function openAdd() {
    setEditing(null)
    setForm({ name: '', description: '', color: '#6b7280' })
    setError('')
    setShowForm(true)
  }

  function openEdit(role: Role) {
    setEditing(role)
    setForm({ name: role.name, description: role.description ?? '', color: role.color })
    setError('')
    setShowForm(true)
  }

  async function handleSave() {
    if (!form.name.trim()) { setError('Role name is required.'); return }
    setSaving(true)
    setError('')

    const payload = {
      company_id: COMPANY_ID,
      name: form.name.trim(),
      description: form.description.trim() || null,
      color: form.color,
    }

    if (editing) {
      await supabase.from('roles').update(payload).eq('id', editing.id)
      await logActivity('role_updated', `Updated role: ${form.name}`, editing.id)
    } else {
      const { data } = await supabase.from('roles').insert(payload).select().single()
      if (data) await logActivity('role_created', `Created role: ${form.name}`, data.id)
    }

    setSaving(false)
    setShowForm(false)
    fetchData()
  }

  async function handleDelete(id: string) {
    const role = roles.find((r) => r.id === id)
    await supabase.from('roles').delete().eq('id', id)
    await logActivity('role_deleted', `Deleted role: ${role?.name ?? id}`, id)
    setConfirmDeleteId(null)
    fetchData()
  }

  if (loading) {
    return (
      <div style={{ padding: '48px 0', textAlign: 'center', color: 'var(--text-muted)', fontSize: 13 }}>
        Loading roles...
      </div>
    )
  }

  return (
    <div>
      <div style={{ display: 'flex', alignItems: 'center', marginBottom: 16 }}>
        <div style={{ fontSize: 12, color: 'var(--text-muted)' }}>
          Define the roles in your organization. Aegis uses these when building schedules and processing requests.
        </div>
        <div style={{ marginLeft: 'auto' }}>
          <button className="btn btn-primary btn-sm" onClick={openAdd}>
            + Add Role
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
            <col style={{ width: '6%' }} />
            <col style={{ width: '22%' }} />
            <col style={{ width: '56%' }} />
            <col style={{ width: '16%' }} />
          </colgroup>
          <thead>
            <tr>
              <th></th>
              <th>Role</th>
              <th>Description</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {roles.map((role) => (
              <tr key={role.id} onClick={() => openEdit(role)} style={{ cursor: 'pointer' }}>
                <td>
                  <div style={{
                    width: 20,
                    height: 20,
                    borderRadius: '50%',
                    background: role.color,
                    flexShrink: 0,
                  }} />
                </td>
                <td>
                  <span style={{
                    display: 'inline-block',
                    padding: '2px 10px',
                    borderRadius: 'var(--radius-pill)',
                    fontSize: 12,
                    fontWeight: 500,
                    background: role.color + '22',
                    color: role.color,
                    border: `1px solid ${role.color}44`,
                  }}>
                    {role.name}
                  </span>
                </td>
                <td style={{ color: 'var(--text-muted)', fontSize: 12 }}>
                  {role.description ?? '—'}
                </td>
                <td>
                  <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
                    <button
                      onClick={(e) => { e.stopPropagation(); setConfirmDeleteId(role.id) }}
                      style={{
                        background: 'transparent',
                        border: 'none',
                        cursor: 'pointer',
                        color: 'var(--text-muted)',
                        padding: '4px',
                        borderRadius: 'var(--radius-sm)',
                        display: 'flex',
                        alignItems: 'center',
                      }}
                    >
                      <TrashIcon />
                    </button>
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>

        {roles.length === 0 && (
          <div className="empty-state">
            <div className="empty-state-title">No roles defined</div>
            <div className="empty-state-desc">
              Add your organization's roles here before adding employees.
            </div>
          </div>
        )}
      </div>

      {/* Confirm delete */}
      {confirmDeleteId && (
        <div style={{ position: 'fixed', inset: 0, zIndex: 200, background: 'rgba(0,0,0,0.7)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
          <div style={{ background: 'var(--bg-surface-1)', border: '1px solid var(--border-default)', borderRadius: 'var(--radius-xl)', padding: 28, width: '100%', maxWidth: 380 }}>
            <div style={{ fontFamily: 'var(--font-display)', fontSize: 18, fontWeight: 700, color: 'var(--text-primary)', marginBottom: 10 }}>
              Delete Role
            </div>
            <div style={{ fontSize: 13, color: 'var(--text-muted)', marginBottom: 20, lineHeight: 1.6 }}>
              This will permanently delete this role. Employees assigned to it will need to be updated.
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
          <div style={{ background: 'var(--bg-surface-1)', border: '1px solid var(--border-default)', borderRadius: 'var(--radius-xl)', padding: 28, width: '100%', maxWidth: 440 }}>
            <div style={{ fontFamily: 'var(--font-display)', fontSize: 18, fontWeight: 700, color: 'var(--text-primary)', marginBottom: 20 }}>
              {editing ? 'Edit Role' : 'Add Role'}
            </div>

            <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
              <div className="form-group">
                <label className="form-label">Role Name</label>
                <input
                  className="form-input"
                  value={form.name}
                  onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))}
                  placeholder="e.g. Lifeguard, Greeter, Manager"
                />
              </div>
              <div className="form-group">
                <label className="form-label">Description <span style={{ color: 'var(--text-muted)', fontWeight: 400 }}>(optional)</span></label>
                <textarea
                  className="form-input"
                  rows={2}
                  value={form.description}
                  onChange={(e) => setForm((f) => ({ ...f, description: e.target.value }))}
                  placeholder="Brief description of what this role does"
                  style={{ resize: 'vertical' }}
                />
              </div>
              <div className="form-group">
                <label className="form-label">Color</label>
                <div style={{ display: 'flex', gap: 8, marginTop: 4, flexWrap: 'wrap', alignItems: 'center' }}>
                  {PRESET_COLORS.map((c) => (
                    <button
                      key={c}
                      type="button"
                      onClick={() => setForm((f) => ({ ...f, color: c }))}
                      style={{
                        width: 28,
                        height: 28,
                        borderRadius: '50%',
                        background: c,
                        border: form.color === c ? '3px solid var(--text-primary)' : '2px solid transparent',
                        cursor: 'pointer',
                        padding: 0,
                        outline: form.color === c ? '2px solid var(--bg-surface-1)' : 'none',
                        outlineOffset: '-4px',
                      }}
                    />
                  ))}
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginLeft: 4 }}>
                    <input
                      type="color"
                      value={form.color}
                      onChange={(e) => setForm((f) => ({ ...f, color: e.target.value }))}
                      style={{ width: 28, height: 28, borderRadius: '50%', border: 'none', cursor: 'pointer', padding: 0, background: 'none' }}
                    />
                    <span style={{ fontSize: 11, color: 'var(--text-muted)' }}>Custom</span>
                  </div>
                </div>
                <div style={{ marginTop: 10, display: 'flex', alignItems: 'center', gap: 8 }}>
                  <span style={{
                    display: 'inline-block',
                    padding: '3px 12px',
                    borderRadius: 'var(--radius-pill)',
                    fontSize: 12,
                    fontWeight: 500,
                    background: form.color + '22',
                    color: form.color,
                    border: `1px solid ${form.color}44`,
                  }}>
                    {form.name || 'Preview'}
                  </span>
                  <span style={{ fontSize: 11, color: 'var(--text-muted)' }}>Preview</span>
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
                {saving ? 'Saving...' : 'Save Role'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}