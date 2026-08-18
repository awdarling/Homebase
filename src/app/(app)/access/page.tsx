'use client'
import { useCompany } from '@/lib/hooks/useCompany'

import { useEffect, useState } from 'react'
import { createClient } from '@/lib/supabase/client'
import { useRouter } from 'next/navigation'
import type { Employee, NotifyCategory } from '@/lib/types'



interface UserRecord {
  id: string
  name: string
  email: string
  role: string
  avatar_url: string | null
  created_at: string
  last_sign_in_at?: string | null
  /**
   * The PERSON this login belongs to (migration 025). Aegis reads a manager's
   * phone from that employee record. NULL means it falls back to matching on
   * email address — which silently fails the moment the two differ.
   */
  employee_id?: string | null
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

    let usersQuery = supabase
      .from('users')
      .select('*')
      .is('access_revoked_at', null) // hide revoked users from the active list
      .order('created_at')
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

      <ManagerContactSection
        users={users}
        employees={employees}
        onChange={fetchData}
      />

      <div style={{ height: 40 }} />

      <AegisSection
        employees={employees}
        quriaStaff={quriaStaff}
        onChange={fetchData}
      />

      {currentUser?.role === 'quria' && (
        <>
          <div style={{ height: 40 }} />
          <MonitoringSection companyId={COMPANY_ID} />
        </>
      )}
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
  const [revoking, setRevoking] = useState(false)
  const [revokeError, setRevokeError] = useState('')

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
    // Goes through the secure server route (service role), which actually marks
    // the account revoked + locks them out — unlike the old client-side delete,
    // which the database silently blocked (the "confirmed but still listed" bug).
    setRevoking(true)
    setRevokeError('')
    try {
      const res = await fetch('/api/revoke-user', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ user_id: userId }),
      })
      const result = (await res.json()) as { success?: boolean; error?: string }
      if (!res.ok || !result.success) {
        setRevokeError(result.error ?? `Couldn't revoke access (HTTP ${res.status}).`)
        setRevoking(false)
        return
      }
    } catch (err) {
      setRevokeError(err instanceof Error ? err.message : 'Failed to reach the server.')
      setRevoking(false)
      return
    }
    setRevoking(false)
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
              This user will be immediately locked out of Homebase, and they&rsquo;ll see a clear message at sign-in. To restore access later, an owner or Quria admin can re-add them.
            </div>
            {revokeError && (
              <div style={{
                fontSize: 12,
                color: 'var(--status-blocked-text)',
                marginBottom: 16,
                padding: '8px 12px',
                background: 'var(--status-blocked-bg)',
                border: '1px solid var(--status-blocked-border)',
                borderRadius: 'var(--radius-md)',
              }}>
                {revokeError}
              </div>
            )}
            <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
              <button className="btn btn-secondary btn-sm" onClick={() => { setConfirmRevokeId(null); setRevokeError('') }}>Cancel</button>
              <button
                className="btn btn-sm"
                onClick={() => handleRevoke(confirmRevokeId)}
                disabled={revoking}
                style={{
                  background: 'var(--status-blocked-bg)',
                  color: 'var(--status-blocked-text)',
                  border: '1px solid var(--status-blocked-border)',
                  opacity: revoking ? 0.6 : 1,
                }}
              >
                {revoking ? 'Revoking…' : 'Revoke Access'}
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
    // Routed through the server so the role gate + company binding are enforced,
    // and so setting someone to "blocked" fires the Aegis removal notice.
    setSaving(true)
    await fetch('/api/aegis-access', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ employee_id: employeeId, access: value }),
    })
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

// ─── Monitoring Inbox Section (QURIA ONLY) ────────────────────────────────────
// Per-client "watch" inbox: BCCs a copy of every email Aegis sends for this
// company to an audit address. Quria-only — owners/managers never see this.

interface MonitoringInbox {
  id: string
  email: string
  active: boolean
}

function MonitoringSection({ companyId }: { companyId: string }) {
  const [inboxes, setInboxes] = useState<MonitoringInbox[]>([])
  const [loading, setLoading] = useState(true)
  const [showForm, setShowForm] = useState(false)
  const [email, setEmail] = useState('')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const [busyId, setBusyId] = useState<string | null>(null)
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null)

  async function load() {
    if (!companyId) return
    setLoading(true)
    try {
      const res = await fetch(`/api/monitoring-inbox?company_id=${encodeURIComponent(companyId)}`)
      const data = (await res.json()) as { inboxes?: MonitoringInbox[]; error?: string }
      if (res.ok) setInboxes(data.inboxes ?? [])
    } finally {
      setLoading(false)
    }
  }
  useEffect(() => { load() }, [companyId]) // eslint-disable-line react-hooks/exhaustive-deps

  async function handleAdd() {
    if (!email.trim()) { setError('Enter an email address.'); return }
    setSaving(true); setError('')
    try {
      const res = await fetch('/api/monitoring-inbox', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ company_id: companyId, email: email.trim() }),
      })
      const data = (await res.json()) as { success?: boolean; error?: string }
      if (!res.ok || !data.success) { setError(data.error ?? `Failed to add (HTTP ${res.status}).`); setSaving(false); return }
    } catch {
      setError('Failed to reach the server.'); setSaving(false); return
    }
    setSaving(false); setShowForm(false); setEmail(''); load()
  }

  async function handleToggle(id: string, active: boolean) {
    setBusyId(id)
    try {
      await fetch('/api/monitoring-inbox', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id, active }),
      })
    } finally { setBusyId(null) }
    load()
  }

  async function handleDelete(id: string) {
    setBusyId(id)
    try {
      await fetch('/api/monitoring-inbox', {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id }),
      })
    } finally { setBusyId(null) }
    setConfirmDeleteId(null); load()
  }

  return (
    <section>
      <SectionHeader
        title="Monitoring Inbox (Quria only)"
        subtitle="BCC a private copy of every email Aegis sends for this client to an audit inbox"
      />

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
        <span style={{ color: 'var(--accent)', fontWeight: 600 }}>Quria-only control.</span>
        {' '}When on, a copy of every outbound Aegis email for this client is quietly sent to the address below — a clean audit trail with no effect on employees. Turn off to pause it.
      </div>

      {loading ? (
        <div style={{ fontSize: 13, color: 'var(--text-muted)', padding: '8px 0' }}>Loading…</div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8, marginBottom: 12 }}>
          {inboxes.length === 0 && (
            <div style={{ fontSize: 13, color: 'var(--text-muted)', padding: '8px 0' }}>
              No monitoring inbox for this client yet.
            </div>
          )}
          {inboxes.map((ib) => (
            <div key={ib.id} style={{
              display: 'flex', alignItems: 'center', gap: 12,
              background: 'var(--bg-surface-1)',
              border: '1px solid var(--border-default)',
              borderRadius: 'var(--radius-lg)',
              padding: '12px 16px',
            }}>
              <span style={{
                display: 'inline-block', padding: '2px 10px', borderRadius: 'var(--radius-pill)',
                fontSize: 10, fontWeight: 700, letterSpacing: '0.08em', textTransform: 'uppercase',
                background: ib.active ? 'rgba(34,197,94,0.1)' : 'rgba(239,68,68,0.1)',
                color: ib.active ? '#22c55e' : '#ef4444',
                border: `1px solid ${ib.active ? 'rgba(34,197,94,0.25)' : 'rgba(239,68,68,0.25)'}`,
              }}>
                {ib.active ? 'On' : 'Off'}
              </span>
              <span style={{ flex: 1, fontSize: 13, color: 'var(--text-primary)' }}>{ib.email}</span>

              <button
                onClick={() => handleToggle(ib.id, !ib.active)}
                disabled={busyId === ib.id}
                style={{
                  padding: '5px 12px', borderRadius: 'var(--radius-md)', fontSize: 12, fontWeight: 600,
                  cursor: busyId === ib.id ? 'default' : 'pointer',
                  background: 'transparent', color: 'var(--text-secondary)',
                  border: '1px solid var(--border-default)',
                }}
              >
                {ib.active ? 'Turn off' : 'Turn on'}
              </button>

              {confirmDeleteId === ib.id ? (
                <span style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                  <button onClick={() => handleDelete(ib.id)} disabled={busyId === ib.id}
                    style={{ padding: '5px 10px', borderRadius: 'var(--radius-md)', fontSize: 12, fontWeight: 600, cursor: 'pointer', background: 'rgba(239,68,68,0.12)', color: '#ef4444', border: '1px solid rgba(239,68,68,0.3)' }}>
                    Remove
                  </button>
                  <button onClick={() => setConfirmDeleteId(null)}
                    style={{ padding: '5px 10px', borderRadius: 'var(--radius-md)', fontSize: 12, cursor: 'pointer', background: 'transparent', color: 'var(--text-muted)', border: '1px solid var(--border-default)' }}>
                    Cancel
                  </button>
                </span>
              ) : (
                <button onClick={() => setConfirmDeleteId(ib.id)} title="Remove"
                  style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 6, borderRadius: 'var(--radius-md)', cursor: 'pointer', background: 'transparent', color: 'var(--text-muted)', border: '1px solid var(--border-default)' }}>
                  <TrashIcon />
                </button>
              )}
            </div>
          ))}
        </div>
      )}

      {showForm ? (
        <div style={{
          background: 'var(--bg-surface-1)', border: '1px solid var(--border-default)',
          borderRadius: 'var(--radius-lg)', padding: 16, display: 'flex', flexDirection: 'column', gap: 10,
        }}>
          <input
            type="email" value={email} placeholder="audit-inbox@quriasolutions.com"
            onChange={(e) => setEmail(e.target.value)}
            style={{
              padding: '9px 12px', borderRadius: 'var(--radius-md)', fontSize: 13,
              background: 'var(--bg-surface-2)', color: 'var(--text-primary)',
              border: '1px solid var(--border-default)',
            }}
          />
          {error && <div style={{ fontSize: 12, color: '#ef4444' }}>{error}</div>}
          <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
            <button onClick={() => { setShowForm(false); setError(''); setEmail('') }}
              style={{ padding: '7px 14px', borderRadius: 'var(--radius-md)', fontSize: 12, cursor: 'pointer', background: 'transparent', color: 'var(--text-muted)', border: '1px solid var(--border-default)' }}>
              Cancel
            </button>
            <button onClick={handleAdd} disabled={saving}
              style={{ padding: '7px 14px', borderRadius: 'var(--radius-md)', fontSize: 12, fontWeight: 600, cursor: saving ? 'default' : 'pointer', background: 'var(--accent)', color: '#fff', border: 'none' }}>
              {saving ? 'Adding…' : 'Add inbox'}
            </button>
          </div>
        </div>
      ) : (
        <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
          <button onClick={() => setShowForm(true)}
            style={{ padding: '7px 14px', borderRadius: 'var(--radius-md)', fontSize: 12, fontWeight: 600, cursor: 'pointer', background: 'transparent', color: 'var(--accent)', border: '1px solid var(--accent-border)' }}>
            + Add monitoring inbox
          </button>
        </div>
      )}
    </section>
  )
}

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

// ─── Manager Contact Section ──────────────────────────────────────────────────
//
// The fix for "Aegis can't text a manager" (migration 025).
//
// A login is not a person. The PERSON is the employee record — that is where a
// phone number lives. This section is where you say which person a login
// belongs to. Until you do, Aegis falls back to matching on email address, which
// breaks the moment someone signs in with a different address from the one on
// their employee record — and it used to break SILENTLY.

const CATEGORY_LABELS: { key: NotifyCategory; label: string; hint: string }[] = [
  { key: 'approvals',      label: 'Approvals',        hint: 'Time off, swaps, availability changes waiting on a decision' },
  { key: 'trades',         label: 'Trades',           hint: 'Shift swaps and pickups between staff' },
  { key: 'schedule_posts', label: 'Schedule posted',  hint: 'When a schedule is published and sent out' },
  { key: 'reports',        label: 'Reports',          hint: 'Onboarding summaries and end-of-day reports' },
]

function ManagerContactSection({
  users,
  employees,
  onChange,
}: {
  users: UserRecord[]
  employees: Employee[]
  onChange: () => void
}) {
  const supabase = createClient()
  const [busyId, setBusyId] = useState<string | null>(null)
  const [error, setError] = useState('')

  // Only people who can actually receive operational messages. A quria platform
  // admin holds a login for cross-company access, not to receive one club's
  // time-off approvals — their own contact details live in quria_staff.
  const managerLogins = users.filter((u) => u.role === 'manager' || u.role === 'owner')

  const personById = new Map(employees.map((e) => [e.id, e]))
  const takenBy = new Map<string, string>()
  for (const u of managerLogins) {
    if (u.employee_id) takenBy.set(u.employee_id, u.name)
  }

  async function linkPerson(userId: string, employeeId: string | null) {
    setBusyId(userId)
    setError('')
    const { error: e } = await supabase
      .from('users')
      .update({ employee_id: employeeId })
      .eq('id', userId)
    setBusyId(null)
    if (e) { setError(e.message); return }
    onChange()
  }

  async function setPref(employeeId: string, key: NotifyCategory, value: boolean) {
    const person = personById.get(employeeId)
    if (!person) return
    setBusyId(employeeId)
    setError('')
    const next = { ...(person.notification_prefs ?? {}), [key]: value }
    const { error: e } = await supabase
      .from('employees')
      .update({ notification_prefs: next })
      .eq('id', employeeId)
    setBusyId(null)
    if (e) { setError(e.message); return }
    onChange()
  }

  async function setSchedulable(employeeId: string, value: boolean) {
    setBusyId(employeeId)
    setError('')
    const { error: e } = await supabase
      .from('employees')
      .update({ schedulable: value })
      .eq('id', employeeId)
    setBusyId(null)
    if (e) { setError(e.message); return }
    onChange()
  }

  const unlinked = managerLogins.filter((u) => !u.employee_id)

  return (
    <section>
      <SectionHeader
        title="Manager Contact"
        subtitle="Which person each login belongs to, and what Aegis sends them"
      />

      {unlinked.length > 0 && (
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
          <span style={{ color: 'var(--accent)', fontWeight: 600 }}>
            {unlinked.length === 1
              ? '1 login is not linked to a person yet.'
              : `${unlinked.length} logins are not linked to a person yet.`}
          </span>
          {' '}Aegis is guessing who they are by matching their sign-in email to an
          employee record. That works until the two addresses differ — then it stops
          texting them, with no warning. Link them below.
        </div>
      )}

      {error && (
        <div style={{ fontSize: 12, color: 'var(--danger, #e5484d)', marginBottom: 12 }}>{error}</div>
      )}

      <div style={{
        background: 'var(--bg-surface-1)',
        border: '1px solid var(--border-default)',
        borderRadius: 'var(--radius-lg)',
        overflow: 'hidden',
      }}>
        {managerLogins.length === 0 ? (
          <div className="empty-state">
            <div className="empty-state-title">No managers yet</div>
            <div className="empty-state-desc">Add a manager or owner above and they will appear here.</div>
          </div>
        ) : managerLogins.map((user, i) => {
          const person = user.employee_id ? personById.get(user.employee_id) ?? null : null
          const phone = person?.contact_phone ?? null
          const isOwner = user.role === 'owner'
          const busy = busyId === user.id || (person ? busyId === person.id : false)

          const reach = !person
            ? { text: 'Not linked — email only', tone: 'var(--accent)' }
            : !phone
              ? { text: 'Linked, but no phone on file — email only', tone: 'var(--accent)' }
              : { text: `Texts go to ${phone}`, tone: 'var(--text-muted)' }

          return (
            <div key={user.id} style={{
              padding: '16px 20px',
              borderBottom: i < managerLogins.length - 1 ? '1px solid var(--border-subtle)' : 'none',
              opacity: busy ? 0.6 : 1,
            }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 16, flexWrap: 'wrap' }}>
                <div style={{ flex: 1, minWidth: 180 }}>
                  <div style={{ fontSize: 13, color: 'var(--text-primary)', fontWeight: 500 }}>
                    {user.name}
                  </div>
                  <div style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 2 }}>
                    {user.email}
                  </div>
                </div>

                <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                  <label style={{ fontSize: 10, color: 'var(--text-muted)', letterSpacing: '0.06em', textTransform: 'uppercase' }}>
                    Is this person
                  </label>
                  <select
                    value={user.employee_id ?? ''}
                    disabled={busy}
                    onChange={(e) => linkPerson(user.id, e.target.value || null)}
                    style={{
                      background: 'var(--bg-surface-2, var(--bg-surface-1))',
                      color: 'var(--text-primary)',
                      border: `1px solid ${user.employee_id ? 'var(--border-default)' : 'var(--accent-border)'}`,
                      borderRadius: 'var(--radius-sm)',
                      padding: '5px 10px',
                      fontSize: 12,
                      fontFamily: 'var(--font-body)',
                      minWidth: 200,
                      cursor: busy ? 'wait' : 'pointer',
                      outline: 'none',
                    }}
                  >
                    <option value="">Not linked</option>
                    {employees.map((e) => {
                      const claimedBy = takenBy.get(e.id)
                      const claimedByElse = claimedBy && claimedBy !== user.name
                      return (
                        <option key={e.id} value={e.id} disabled={!!claimedByElse}>
                          {e.name}{claimedByElse ? ` — already ${claimedBy}` : ''}
                        </option>
                      )
                    })}
                  </select>
                </div>
              </div>

              <div style={{ fontSize: 11, color: reach.tone, marginTop: 10 }}>
                {reach.text}
              </div>

              {person && (
                <div style={{ marginTop: 12, display: 'flex', flexDirection: 'column', gap: 10 }}>
                  <label style={{ display: 'flex', alignItems: 'flex-start', gap: 8, fontSize: 12, color: 'var(--text-secondary)', cursor: busy ? 'wait' : 'pointer' }}>
                    <input
                      type="checkbox"
                      checked={person.schedulable !== false}
                      disabled={busy}
                      onChange={(e) => setSchedulable(person.id, e.target.checked)}
                      style={{ marginTop: 2 }}
                    />
                    <span>
                      Can be put on a schedule
                      <span style={{ display: 'block', fontSize: 11, color: 'var(--text-muted)', marginTop: 2 }}>
                        Uncheck for someone who works here and needs to hear from Aegis but never
                        takes a shift — an owner, a bookkeeper. Different from marking them
                        inactive, which means they are away and should not be contacted at all.
                      </span>
                    </span>
                  </label>

                  <div>
                    <div style={{ fontSize: 10, color: 'var(--text-muted)', letterSpacing: '0.06em', textTransform: 'uppercase', marginBottom: 6 }}>
                      Send them
                    </div>
                    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(230px, 1fr))', gap: 8 }}>
                      {CATEGORY_LABELS.map(({ key, label, hint }) => {
                        const explicit = person.notification_prefs?.[key]
                        const on = typeof explicit === 'boolean' ? explicit : !isOwner
                        return (
                          <label key={key} style={{ display: 'flex', alignItems: 'flex-start', gap: 8, fontSize: 12, color: 'var(--text-secondary)', cursor: busy ? 'wait' : 'pointer' }}>
                            <input
                              type="checkbox"
                              checked={on}
                              disabled={busy}
                              onChange={(e) => setPref(person.id, key, e.target.checked)}
                              style={{ marginTop: 2 }}
                            />
                            <span>
                              {label}
                              {typeof explicit !== 'boolean' && (
                                <span style={{ fontSize: 10, color: 'var(--text-muted)' }}>
                                  {isOwner ? ' · off for owners by default' : ' · on by default'}
                                </span>
                              )}
                              <span style={{ display: 'block', fontSize: 11, color: 'var(--text-muted)', marginTop: 2 }}>
                                {hint}
                              </span>
                            </span>
                          </label>
                        )
                      })}
                    </div>
                    {isOwner && (
                      <div style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 8, lineHeight: 1.55 }}>
                        Owners hear nothing by default. Switch a category on to see what Aegis
                        feels like from a manager&rsquo;s side, then switch it off again.
                        Anything that genuinely needs a decision still reaches you if there is
                        nobody else to send it to.
                      </div>
                    )}
                  </div>
                </div>
              )}
            </div>
          )
        })}
      </div>
    </section>
  )
}
