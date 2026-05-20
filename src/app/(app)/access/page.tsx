'use client'
import { useCompany } from '@/lib/hooks/useCompany'

import { useEffect, useState } from 'react'
import { createClient } from '@/lib/supabase/client'
import { useRouter } from 'next/navigation'
import type { Employee } from '@/lib/types'



interface UserRecord {
  id: string
  name: string
  email: string
  role: string
  avatar_url: string | null
  created_at: string
  last_sign_in_at?: string | null
}

interface QuriaStaffRecord {
  id: string
  email: string
  name: string
  active: boolean
}

type AegisAccess = 'manager' | 'employee' | 'blocked'

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

function nameInitials(name: string) {
  const parts = name.trim().split(/\s+/).filter(Boolean)
  if (parts.length === 0) return '??'
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase()
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase()
}

function formatRelative(dateString: string | null | undefined) {
  if (!dateString) return 'Never'
  const diff = Date.now() - new Date(dateString).getTime()
  const minutes = Math.floor(diff / 60000)
  const hours = Math.floor(diff / 3600000)
  const days = Math.floor(diff / 86400000)
  if (minutes < 1) return 'Just now'
  if (minutes < 60) return `${minutes}m ago`
  if (hours < 24) return `${hours}h ago`
  if (days < 30) return `${days}d ago`
  return new Date(dateString).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
}

const HOMEBASE_ROLE_STYLES: Record<string, { color: string; bg: string; border: string }> = {
  quria:   { color: '#f97316', bg: 'rgba(249,115,22,0.1)',   border: 'rgba(249,115,22,0.25)' },
  owner:   { color: '#a78bfa', bg: 'rgba(167,139,250,0.1)', border: 'rgba(167,139,250,0.25)' },
  manager: { color: '#60a5fa', bg: 'rgba(96,165,250,0.1)',  border: 'rgba(96,165,250,0.25)' },
}

const AEGIS_ACCESS_STYLES: Record<AegisAccess | 'quria', { label: string; color: string; bg: string; border: string }> = {
  manager:  { label: 'Manager',  color: '#60a5fa', bg: 'rgba(96,165,250,0.1)',  border: 'rgba(96,165,250,0.25)' },
  employee: { label: 'Employee', color: '#22c55e', bg: 'rgba(34,197,94,0.1)',   border: 'rgba(34,197,94,0.25)' },
  blocked:  { label: 'Blocked',  color: '#ef4444', bg: 'rgba(239,68,68,0.1)',   border: 'rgba(239,68,68,0.25)' },
  quria:    { label: 'Quria',    color: '#f97316', bg: 'rgba(249,115,22,0.1)',  border: 'rgba(249,115,22,0.25)' },
}

const HOMEBASE_LEVELS: Array<{ key: 'quria' | 'owner' | 'manager'; title: string; desc: string }> = [
  { key: 'quria',   title: 'Quria',   desc: 'Full platform access. Cannot be revoked by owners or managers. Platform administrator.' },
  { key: 'owner',   title: 'Owner',   desc: 'Full access. Can add/remove managers and revoke manager access. Cannot revoke Quria.' },
  { key: 'manager', title: 'Manager', desc: 'Operational access. Can view and edit all data. Cannot manage other users.' },
]

const AEGIS_LEVELS: Array<{ key: AegisAccess; title: string; desc: string }> = [
  { key: 'manager',  title: 'Manager',  desc: 'Full Aegis access. Can run all workflows, build schedules, approve requests, edit Homebase via conversation.' },
  { key: 'employee', title: 'Employee', desc: 'Limited access. Can submit time off, swap shifts, respond to outreach, update their own availability.' },
  { key: 'blocked',  title: 'Blocked',  desc: 'Cannot interact with Aegis at all.' },
]

// ─── Page ─────────────────────────────────────────────────────────────────────

export default function AccessPage() {
  const { company } = useCompany()
  const COMPANY_ID = company?.id ?? ''
  const supabase = createClient()
  const router = useRouter()

  const [currentUser, setCurrentUser] = useState<UserRecord | null>(null)
  const [users, setUsers] = useState<UserRecord[]>([])
  const [employees, setEmployees] = useState<Employee[]>([])
  const [quriaStaff, setQuriaStaff] = useState<QuriaStaffRecord[]>([])
  const [loading, setLoading] = useState(true)

  useEffect(() => { if (COMPANY_ID) fetchData() }, [COMPANY_ID])

  async function fetchData() {
    if (!COMPANY_ID) return
    setLoading(true)

    const { data: { user: authUser } } = await supabase.auth.getUser()
    if (!authUser) { router.push('/login'); return }

    const { data: currentUserData } = await supabase
      .from('users')
      .select('*')
      .eq('id', authUser.id)
      .single()

    if (!currentUserData || !['quria', 'owner', 'manager'].includes(currentUserData.role)) {
      router.push('/')
      return
    }
    setCurrentUser(currentUserData)

    let usersQuery = supabase.from('users').select('*').order('created_at')
    if (currentUserData.role === 'owner' || currentUserData.role === 'manager') {
      usersQuery = usersQuery.eq('company_id', COMPANY_ID)
    }
    const { data: usersData } = await usersQuery
    if (usersData) setUsers(usersData)

    const { data: employeesData } = await supabase
      .from('employees')
      .select('*')
      .eq('company_id', COMPANY_ID)
      .eq('active', true)
      .order('name')
    if (employeesData) setEmployees(employeesData)

    const { data: quriaData } = await supabase
      .from('quria_staff')
      .select('id, email, name, active')
      .eq('active', true)
    if (quriaData) setQuriaStaff(quriaData)

    setLoading(false)
  }

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

      <HomebaseSection
        users={users}
        currentUser={currentUser}
        companyId={COMPANY_ID}
        onChange={fetchData}
      />

      <div style={{ height: 40 }} />

      <AegisSection
        employees={employees}
        quriaStaff={quriaStaff}
        onChange={fetchData}
      />
    </div>
  )
}

// ─── Homebase Access Section ──────────────────────────────────────────────────

function HomebaseSection({
  users,
  currentUser,
  companyId,
  onChange,
}: {
  users: UserRecord[]
  currentUser: UserRecord | null
  companyId: string
  onChange: () => void
}) {
  const supabase = createClient()
  const [showForm, setShowForm] = useState(false)
  const [form, setForm] = useState({ email: '', name: '', role: 'manager' })
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const [confirmRevokeId, setConfirmRevokeId] = useState<string | null>(null)

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

  async function handleAdd() {
    if (!form.email.trim() || !form.name.trim()) {
      setError('Name and email are required.')
      return
    }
    setSaving(true)
    setError('')

    let result: { success?: boolean; error?: string }
    try {
      const res = await fetch('/api/create-user', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          email: form.email.trim(),
          name: form.name.trim(),
          role: form.role,
          company_id: companyId,
        }),
      })
      result = await res.json() as { success?: boolean; error?: string }
      if (!res.ok || !result.success) {
        setError(result.error ?? `Failed to create user (HTTP ${res.status}).`)
        setSaving(false)
        return
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to reach the server.')
      setSaving(false)
      return
    }

    setSaving(false)
    setShowForm(false)
    setForm({ email: '', name: '', role: 'manager' })
    onChange()
  }

  async function handleRevoke(userId: string) {
    await supabase.from('users').delete().eq('id', userId)
    setConfirmRevokeId(null)
    onChange()
  }

  async function handleRoleChange(userId: string, newRole: string) {
    await supabase.from('users').update({ role: newRole }).eq('id', userId)
    onChange()
  }

  return (
    <section>
      <SectionHeader
        title="Homebase Access"
        subtitle="Who can log into the manager platform"
      />

      <div style={{
        display: 'grid',
        gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))',
        gap: 12,
        marginBottom: 20,
      }}>
        {HOMEBASE_LEVELS.map((lvl) => {
          const s = HOMEBASE_ROLE_STYLES[lvl.key]
          return (
            <div key={lvl.key} style={{
              background: 'var(--bg-surface-1)',
              border: '1px solid var(--border-default)',
              borderRadius: 'var(--radius-lg)',
              padding: '14px 16px',
            }}>
              <span style={{
                display: 'inline-block',
                padding: '2px 10px',
                borderRadius: 'var(--radius-pill)',
                fontSize: 10,
                fontWeight: 700,
                letterSpacing: '0.08em',
                textTransform: 'uppercase',
                background: s.bg,
                color: s.color,
                border: `1px solid ${s.border}`,
                marginBottom: 8,
              }}>
                {lvl.title}
              </span>
              <div style={{ fontSize: 12, color: 'var(--text-muted)', lineHeight: 1.55 }}>
                {lvl.desc}
              </div>
            </div>
          )
        })}
      </div>

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
        <span style={{ color: 'var(--accent)', fontWeight: 600 }}>Revoking access takes effect immediately.</span>
        {' '}Removed users are locked out instantly regardless of any password changes they make.
      </div>

      {currentUser?.role !== 'manager' && (
        <div style={{ display: 'flex', justifyContent: 'flex-end', marginBottom: 12 }}>
          <button className="btn btn-primary btn-sm" onClick={() => { setError(''); setShowForm(true) }}>
            + Add User
          </button>
        </div>
      )}

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
            const roleStyle = HOMEBASE_ROLE_STYLES[user.role] ?? HOMEBASE_ROLE_STYLES.manager
            const isMe = user.id === currentUser?.id

            return (
              <div key={user.id} style={{
                display: 'flex',
                alignItems: 'center',
                gap: 16,
                padding: '14px 20px',
                borderBottom: i < users.length - 1 ? '1px solid var(--border-subtle)' : 'none',
              }}>
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
                      {nameInitials(user.name)}
                    </span>
                  )}
                </div>

                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontSize: 13, color: 'var(--text-primary)', fontWeight: 500 }}>
                    {user.name} {isMe && <span style={{ fontSize: 10, color: 'var(--text-muted)' }}>(you)</span>}
                  </div>
                  <div style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 2 }}>
                    {user.email}
                  </div>
                </div>

                <div style={{ fontSize: 11, color: 'var(--text-muted)', minWidth: 100, textAlign: 'right' }}>
                  {formatRelative(user.last_sign_in_at)}
                </div>

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
              This user will be immediately locked out of Homebase. This cannot be undone — they would need to be re-added to regain access.
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
    </section>
  )
}

// ─── Aegis Access Section ─────────────────────────────────────────────────────

function AegisSection({
  employees,
  quriaStaff,
  onChange,
}: {
  employees: Employee[]
  quriaStaff: QuriaStaffRecord[]
  onChange: () => void
}) {
  const supabase = createClient()
  const [editingId, setEditingId] = useState<string | null>(null)
  const [pendingValue, setPendingValue] = useState<AegisAccess>('employee')
  const [saving, setSaving] = useState(false)

  const quriaEmails = new Set(quriaStaff.map((q) => q.email.toLowerCase()))

  async function saveAccess(employeeId: string, value: AegisAccess) {
    setSaving(true)
    await supabase
      .from('employees')
      .update({ aegis_access: value })
      .eq('id', employeeId)
    setSaving(false)
    setEditingId(null)
    onChange()
  }

  const employeesWithQuriaFlag = employees.map((e) => ({
    employee: e,
    isQuria: !!(e.contact_email && quriaEmails.has(e.contact_email.toLowerCase())),
  }))

  return (
    <section>
      <SectionHeader
        title="Aegis Access"
        subtitle="Who can interact with Aegis and what they can do"
      />

      <div style={{
        display: 'grid',
        gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))',
        gap: 12,
        marginBottom: 20,
      }}>
        {AEGIS_LEVELS.map((lvl) => {
          const s = AEGIS_ACCESS_STYLES[lvl.key]
          return (
            <div key={lvl.key} style={{
              background: 'var(--bg-surface-1)',
              border: '1px solid var(--border-default)',
              borderRadius: 'var(--radius-lg)',
              padding: '14px 16px',
            }}>
              <span style={{
                display: 'inline-block',
                padding: '2px 10px',
                borderRadius: 'var(--radius-pill)',
                fontSize: 10,
                fontWeight: 700,
                letterSpacing: '0.08em',
                textTransform: 'uppercase',
                background: s.bg,
                color: s.color,
                border: `1px solid ${s.border}`,
                marginBottom: 8,
              }}>
                {lvl.title}
              </span>
              <div style={{ fontSize: 12, color: 'var(--text-muted)', lineHeight: 1.55 }}>
                {lvl.desc}
              </div>
            </div>
          )
        })}
      </div>

      <div style={{
        background: 'var(--bg-surface-1)',
        border: '1px solid var(--border-default)',
        borderRadius: 'var(--radius-lg)',
        overflow: 'hidden',
      }}>
        {employeesWithQuriaFlag.length === 0 ? (
          <div className="empty-state">
            <div className="empty-state-title">No employees</div>
            <div className="empty-state-desc">Add employees in Data → Employees to manage their Aegis access.</div>
          </div>
        ) : (
          employeesWithQuriaFlag.map(({ employee, isQuria }, i) => {
            const accessKey: AegisAccess = (employee.aegis_access ?? 'employee') as AegisAccess
            const styleKey = isQuria ? 'quria' : accessKey
            const accessStyle = AEGIS_ACCESS_STYLES[styleKey]
            const isEditing = editingId === employee.id

            return (
              <div key={employee.id} style={{
                display: 'flex',
                alignItems: 'center',
                gap: 14,
                padding: '14px 20px',
                borderBottom: i < employeesWithQuriaFlag.length - 1 ? '1px solid var(--border-subtle)' : 'none',
              }}>
                <div style={{
                  width: 36,
                  height: 36,
                  borderRadius: '50%',
                  background: accessStyle.bg,
                  border: `1px solid ${accessStyle.border}`,
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  flexShrink: 0,
                }}>
                  <span style={{ fontSize: 12, fontWeight: 700, color: accessStyle.color, fontFamily: 'var(--font-display)' }}>
                    {nameInitials(employee.name)}
                  </span>
                </div>

                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontSize: 13, color: 'var(--text-primary)', fontWeight: 500 }}>
                    {employee.name}
                  </div>
                  <div style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 2 }}>
                    {employee.primary_role}
                  </div>
                </div>

                <div style={{ minWidth: 160, fontSize: 11, color: 'var(--text-muted)' }}>
                  {employee.contact_phone || <span style={{ color: 'var(--text-disabled)' }}>—</span>}
                </div>

                <div style={{ minWidth: 200, fontSize: 11, color: 'var(--text-muted)' }}>
                  {employee.contact_email || <span style={{ color: 'var(--text-disabled)' }}>—</span>}
                </div>

                <div>
                  {isEditing && !isQuria ? (
                    <select
                      value={pendingValue}
                      autoFocus
                      onChange={(e) => setPendingValue(e.target.value as AegisAccess)}
                      onBlur={() => saveAccess(employee.id, pendingValue)}
                      disabled={saving}
                      style={{
                        background: accessStyle.bg,
                        color: accessStyle.color,
                        border: `1px solid ${accessStyle.border}`,
                        borderRadius: 'var(--radius-pill)',
                        padding: '3px 10px',
                        fontSize: 11,
                        fontFamily: 'var(--font-body)',
                        fontWeight: 500,
                        cursor: 'pointer',
                        outline: 'none',
                      }}
                    >
                      <option value="manager">Manager</option>
                      <option value="employee">Employee</option>
                      <option value="blocked">Blocked</option>
                    </select>
                  ) : (
                    <span style={{
                      padding: '3px 10px',
                      borderRadius: 'var(--radius-pill)',
                      fontSize: 11,
                      fontWeight: 500,
                      background: accessStyle.bg,
                      color: accessStyle.color,
                      border: `1px solid ${accessStyle.border}`,
                    }}>
                      {accessStyle.label}
                    </span>
                  )}
                </div>

                <div style={{ width: 60, display: 'flex', justifyContent: 'flex-end' }}>
                  {!isQuria && !isEditing && (
                    <button
                      onClick={() => {
                        setPendingValue(accessKey)
                        setEditingId(employee.id)
                      }}
                      className="btn btn-secondary btn-sm"
                      style={{ padding: '3px 10px', fontSize: 11 }}
                    >
                      Edit
                    </button>
                  )}
                </div>
              </div>
            )
          })
        )}
      </div>

      <div style={{
        marginTop: 12,
        fontSize: 11,
        color: 'var(--text-muted)',
        lineHeight: 1.55,
      }}>
        Quria staff always have full Aegis access regardless of this setting.
      </div>
    </section>
  )
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function SectionHeader({ title, subtitle }: { title: string; subtitle: string }) {
  return (
    <div style={{ marginBottom: 18 }}>
      <div style={{
        fontFamily: 'var(--font-display)',
        fontSize: 20,
        fontWeight: 700,
        color: 'var(--text-primary)',
        letterSpacing: '0.01em',
      }}>
        {title}
      </div>
      <div style={{ fontSize: 13, color: 'var(--text-muted)', marginTop: 4 }}>
        {subtitle}
      </div>
    </div>
  )
}
