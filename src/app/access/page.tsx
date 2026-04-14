'use client'

import { useEffect, useState } from 'react'
import { createClient } from '@/lib/supabase/client'
import { useRouter } from 'next/navigation'

const COMPANY_ID = 'a1b2c3d4-e5f6-7890-abcd-ef1234567890'

interface UserRecord {
  id: string
  name: string
  email: string
  role: string
  avatar_url: string | null
  created_at: string
}

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

const ROLE_STYLES: Record<string, { color: string; bg: string; border: string }> = {
  quria:   { color: '#f97316', bg: 'rgba(249,115,22,0.1)',   border: 'rgba(249,115,22,0.25)' },
  owner:   { color: '#a78bfa', bg: 'rgba(167,139,250,0.1)', border: 'rgba(167,139,250,0.25)' },
  manager: { color: '#60a5fa', bg: 'rgba(96,165,250,0.1)',  border: 'rgba(96,165,250,0.25)' },
}

export default function AccessPage() {
  const [users, setUsers] = useState<UserRecord[]>([])
  const [currentUser, setCurrentUser] = useState<UserRecord | null>(null)
  const [loading, setLoading] = useState(true)
  const [showForm, setShowForm] = useState(false)
  const [form, setForm] = useState({ email: '', name: '', role: 'manager' })
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const [confirmRevokeId, setConfirmRevokeId] = useState<string | null>(null)

  const supabase = createClient()
  const router = useRouter()

  useEffect(() => { fetchData() }, [])

  async function fetchData() {
    setLoading(true)
    const { data: { user: authUser } } = await supabase.auth.getUser()
    if (!authUser) { router.push('/login'); return }

    const { data: currentUserData } = await supabase
      .from('users')
      .select('*')
      .eq('id', authUser.id)
      .single()

    if (!currentUserData || !['quria', 'owner'].includes(currentUserData.role)) {
      router.push('/')
      return
    }

    setCurrentUser(currentUserData)

    // Quria sees all users across all companies, owners see only their company
    let query = supabase.from('users').select('*').order('created_at')
    if (currentUserData.role === 'owner') {
      query = query.eq('company_id', COMPANY_ID)
    }

    const { data } = await query
    if (data) setUsers(data)
    setLoading(false)
  }

  async function handleAdd() {
    if (!form.email.trim() || !form.name.trim()) {
      setError('Name and email are required.')
      return
    }
    setSaving(true)
    setError('')

    // Create auth user via Supabase admin
    const { data: authData, error: authError } = await supabase.auth.admin.createUser({
      email: form.email.trim(),
      email_confirm: true,
      user_metadata: { name: form.name.trim() },
    })

    if (authError || !authData.user) {
      setError('Failed to create user. Email may already exist.')
      setSaving(false)
      return
    }

    await supabase.from('users').insert({
      id: authData.user.id,
      company_id: COMPANY_ID,
      email: form.email.trim(),
      name: form.name.trim(),
      role: form.role,
    })

    setSaving(false)
    setShowForm(false)
    setForm({ email: '', name: '', role: 'manager' })
    fetchData()
  }

  async function handleRevoke(userId: string) {
    await supabase.from('users').delete().eq('id', userId)
    setConfirmRevokeId(null)
    fetchData()
  }

  async function handleRoleChange(userId: string, newRole: string) {
    await supabase.from('users').update({ role: newRole }).eq('id', userId)
    fetchData()
  }

  const canEditRole = (targetRole: string) => {
    if (currentUser?.role === 'quria') return true
    if (currentUser?.role === 'owner' && targetRole === 'manager') return true
    return false
  }

  const canRevoke = (target: UserRecord) => {
    if (target.id === currentUser?.id) return false
    if (currentUser?.role === 'quria') return true
    if (currentUser?.role === 'owner' && target.role === 'manager') return true
    return false
  }

  const availableRoles = currentUser?.role === 'quria'
    ? ['quria', 'owner', 'manager']
    : ['owner', 'manager']

  if (loading) return (
    <div style={{ padding: '48px 0', textAlign: 'center', color: 'var(--text-muted)', fontSize: 13 }}>
      Loading access management...
    </div>
  )

  return (
    <div className="page-content">
      <div className="page-header">
        <div className="page-title">Access Management</div>
        <div className="page-subtitle">
          Manage who has access to Homebase and Aegis
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
        <span style={{ color: 'var(--accent)', fontWeight: 600 }}>Revoking access takes effect immediately.</span>
        {' '}Removed users are locked out instantly regardless of any password changes they make.
      </div>

      <div style={{ display: 'flex', justifyContent: 'flex-end', marginBottom: 16 }}>
        <button className="btn btn-primary btn-sm" onClick={() => { setError(''); setShowForm(true) }}>
          + Add User
        </button>
      </div>

      <div style={{
        background: 'var(--bg-surface-1)',
        border: '1px solid var(--border-default)',
        borderRadius: 'var(--radius-lg)',
        overflow: 'hidden',
      }}>
        {users.length === 0 ? (
          <div className="empty-state">
            <div className="empty-state-title">No users yet</div>
            <div className="empty-state-desc">Add users to give them access to Homebase.</div>
          </div>
        ) : (
          users.map((user, i) => {
            const roleStyle = ROLE_STYLES[user.role] ?? ROLE_STYLES.manager
            const isMe = user.id === currentUser?.id

            return (
              <div key={user.id} style={{
                display: 'flex',
                alignItems: 'center',
                gap: 16,
                padding: '14px 20px',
                borderBottom: i < users.length - 1 ? '1px solid var(--border-subtle)' : 'none',
              }}>
                {/* Avatar */}
                <div style={{
                  width: 36,
                  height: 36,
                  borderRadius: '50%',
                  background: user.avatar_url ? 'transparent' : roleStyle.bg,
                  border: `1px solid ${roleStyle.border}`,
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  overflow: 'hidden',
                  flexShrink: 0,
                }}>
                  {user.avatar_url ? (
                    <img src={user.avatar_url} alt="avatar" style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
                  ) : (
                    <span style={{ fontSize: 12, fontWeight: 700, color: roleStyle.color, fontFamily: 'var(--font-display)' }}>
                      {user.name.split(' ').map((w) => w[0]).join('').slice(0, 2).toUpperCase()}
                    </span>
                  )}
                </div>

                {/* Info */}
                <div style={{ flex: 1 }}>
                  <div style={{ fontSize: 13, color: 'var(--text-primary)', fontWeight: 500 }}>
                    {user.name} {isMe && <span style={{ fontSize: 10, color: 'var(--text-muted)' }}>(you)</span>}
                  </div>
                  <div style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 2 }}>
                    {user.email}
                  </div>
                </div>

                {/* Role */}
                <div>
                  {canEditRole(user.role) && !isMe ? (
                    <select
                      value={user.role}
                      onChange={(e) => handleRoleChange(user.id, e.target.value)}
                      style={{
                        background: roleStyle.bg,
                        color: roleStyle.color,
                        border: `1px solid ${roleStyle.border}`,
                        borderRadius: 'var(--radius-pill)',
                        padding: '3px 10px',
                        fontSize: 11,
                        fontFamily: 'var(--font-body)',
                        fontWeight: 500,
                        cursor: 'pointer',
                        outline: 'none',
                      }}
                    >
                      {availableRoles.map((r) => (
                        <option key={r} value={r}>{r.charAt(0).toUpperCase() + r.slice(1)}</option>
                      ))}
                    </select>
                  ) : (
                    <span style={{
                      padding: '3px 10px',
                      borderRadius: 'var(--radius-pill)',
                      fontSize: 11,
                      fontWeight: 500,
                      background: roleStyle.bg,
                      color: roleStyle.color,
                      border: `1px solid ${roleStyle.border}`,
                    }}>
                      {user.role.charAt(0).toUpperCase() + user.role.slice(1)}
                    </span>
                  )}
                </div>

                {/* Revoke */}
                {canRevoke(user) && (
                  <button
                    onClick={() => setConfirmRevokeId(user.id)}
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
                    title="Revoke access"
                  >
                    <TrashIcon />
                  </button>
                )}
              </div>
            )
          })
        )}
      </div>

      {/* Confirm revoke modal */}
      {confirmRevokeId && (
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
              Revoke Access
            </div>
            <div style={{ fontSize: 13, color: 'var(--text-muted)', marginBottom: 20, lineHeight: 1.6 }}>
              This user will be immediately locked out of Homebase and Aegis. This cannot be undone — they would need to be re-added to regain access.
            </div>
            <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
              <button className="btn btn-secondary btn-sm" onClick={() => setConfirmRevokeId(null)}>Cancel</button>
              <button
                className="btn btn-sm"
                onClick={() => handleRevoke(confirmRevokeId)}
                style={{
                  background: 'var(--status-blocked-bg)',
                  color: 'var(--status-blocked-text)',
                  border: '1px solid var(--status-blocked-border)',
                }}
              >
                Revoke Access
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Add user form */}
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
              Add User
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
              <div className="form-group">
                <label className="form-label">Full Name</label>
                <input
                  className="form-input"
                  value={form.name}
                  onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))}
                  placeholder="e.g. Sarah Johnson"
                />
              </div>
              <div className="form-group">
                <label className="form-label">Email Address</label>
                <input
                  className="form-input"
                  type="email"
                  value={form.email}
                  onChange={(e) => setForm((f) => ({ ...f, email: e.target.value }))}
                  placeholder="sarah@example.com"
                />
              </div>
              <div className="form-group">
                <label className="form-label">Role</label>
                <select
                  className="form-select"
                  value={form.role}
                  onChange={(e) => setForm((f) => ({ ...f, role: e.target.value }))}
                >
                  {availableRoles.map((r) => (
                    <option key={r} value={r}>{r.charAt(0).toUpperCase() + r.slice(1)}</option>
                  ))}
                </select>
              </div>
            </div>
            <div style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 12, lineHeight: 1.6 }}>
              A password reset email will be sent so they can set their own password.
            </div>
            {error && <div style={{ fontSize: 12, color: 'var(--status-blocked-text)', marginTop: 12 }}>{error}</div>}
            <div style={{ display: 'flex', gap: 8, marginTop: 20, justifyContent: 'flex-end' }}>
              <button className="btn btn-secondary btn-sm" onClick={() => setShowForm(false)}>Cancel</button>
              <button className="btn btn-primary btn-sm" onClick={handleAdd} disabled={saving}>
                {saving ? 'Adding...' : 'Add User'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}