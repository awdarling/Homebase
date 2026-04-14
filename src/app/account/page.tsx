'use client'

import { useEffect, useRef, useState } from 'react'
import { createClient } from '@/lib/supabase/client'
import { useRouter } from 'next/navigation'

const COMPANY_ID = 'a1b2c3d4-e5f6-7890-abcd-ef1234567890'

interface UserProfile {
  id: string
  name: string
  email: string
  role: string
  avatar_url: string | null
  company_id: string
}

export default function AccountPage() {
  const [profile, setProfile] = useState<UserProfile | null>(null)
  const [loading, setLoading] = useState(true)
  const [name, setName] = useState('')
  const [saving, setSaving] = useState(false)
  const [saved, setSaved] = useState(false)
  const [avatarUploading, setAvatarUploading] = useState(false)
  const [showPasswordForm, setShowPasswordForm] = useState(false)
  const [newPassword, setNewPassword] = useState('')
  const [confirmPassword, setConfirmPassword] = useState('')
  const [passwordError, setPasswordError] = useState('')
  const [passwordSaved, setPasswordSaved] = useState(false)
  const fileInputRef = useRef<HTMLInputElement>(null)

  const supabase = createClient()
  const router = useRouter()

  useEffect(() => { fetchProfile() }, [])

  async function fetchProfile() {
    setLoading(true)
    const { data: { user: authUser } } = await supabase.auth.getUser()
    if (!authUser) { router.push('/login'); return }
    const { data } = await supabase
      .from('users')
      .select('*')
      .eq('id', authUser.id)
      .single()
    if (data) {
      setProfile(data)
      setName(data.name)
    }
    setLoading(false)
  }

  async function handleSaveName() {
    if (!profile || !name.trim()) return
    setSaving(true)
    await supabase.from('users').update({ name: name.trim() }).eq('id', profile.id)
    setSaving(false)
    setSaved(true)
    setTimeout(() => setSaved(false), 3000)
    fetchProfile()
  }

  async function handleAvatarUpload(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    if (!file || !profile) return

    setAvatarUploading(true)
    const ext = file.name.split('.').pop()
    const path = `${profile.id}/avatar.${ext}`

    const { error: uploadError } = await supabase.storage
      .from('avatars')
      .upload(path, file, { upsert: true })

    if (!uploadError) {
      const { data: { publicUrl } } = supabase.storage
        .from('avatars')
        .getPublicUrl(path)

      await supabase.from('users').update({ avatar_url: publicUrl }).eq('id', profile.id)
      fetchProfile()
    }
    setAvatarUploading(false)
  }

  async function handlePasswordChange() {
    setPasswordError('')
    if (!newPassword || !confirmPassword) {
      setPasswordError('Both fields are required.')
      return
    }
    if (newPassword !== confirmPassword) {
      setPasswordError('Passwords do not match.')
      return
    }
    if (newPassword.length < 8) {
      setPasswordError('Password must be at least 8 characters.')
      return
    }
    const { error } = await supabase.auth.updateUser({ password: newPassword })
    if (error) {
      setPasswordError('Failed to update password. Try again.')
      return
    }
    setPasswordSaved(true)
    setNewPassword('')
    setConfirmPassword('')
    setShowPasswordForm(false)
    setTimeout(() => setPasswordSaved(false), 3000)
  }

  if (loading) return (
    <div style={{ padding: '48px 0', textAlign: 'center', color: 'var(--text-muted)', fontSize: 13 }}>
      Loading account...
    </div>
  )

  if (!profile) return null

  const initials = profile.name.split(' ').map((w) => w[0]).join('').slice(0, 2).toUpperCase()

  return (
    <div className="page-content">
      <div className="page-header">
        <div className="page-title">Account Settings</div>
        <div className="page-subtitle">Manage your profile and access credentials</div>
      </div>

      <div style={{ display: 'flex', flexDirection: 'column', gap: 16, maxWidth: 560 }}>

        {/* Avatar + Name */}
        <div style={{
          background: 'var(--bg-surface-1)',
          border: '1px solid var(--border-default)',
          borderRadius: 'var(--radius-lg)',
          padding: '24px',
        }}>
          <div style={{ fontFamily: 'var(--font-display)', fontSize: 12, fontWeight: 700, color: 'var(--text-muted)', letterSpacing: '0.15em', textTransform: 'uppercase', marginBottom: 20 }}>
            Profile
          </div>

          {/* Avatar */}
          <div style={{ display: 'flex', alignItems: 'center', gap: 16, marginBottom: 20 }}>
            <div style={{
              width: 64,
              height: 64,
              borderRadius: '50%',
              background: profile.avatar_url ? 'transparent' : 'var(--accent-dim)',
              border: '2px solid var(--accent-border)',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              overflow: 'hidden',
              flexShrink: 0,
            }}>
              {profile.avatar_url ? (
                <img src={profile.avatar_url} alt="avatar" style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
              ) : (
                <span style={{ fontSize: 20, fontWeight: 700, color: 'var(--accent)', fontFamily: 'var(--font-display)' }}>
                  {initials}
                </span>
              )}
            </div>
            <div>
              <button
                className="btn btn-secondary btn-sm"
                onClick={() => fileInputRef.current?.click()}
                disabled={avatarUploading}
              >
                {avatarUploading ? 'Uploading...' : 'Upload Photo'}
              </button>
              <div style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 6 }}>
                JPG or PNG. Max 2MB.
              </div>
              <input
                ref={fileInputRef}
                type="file"
                accept="image/jpeg,image/png"
                style={{ display: 'none' }}
                onChange={handleAvatarUpload}
              />
            </div>
          </div>

          {/* Name */}
          <div className="form-group">
            <label className="form-label">Display Name</label>
            <input
              className="form-input"
              value={name}
              onChange={(e) => setName(e.target.value)}
            />
          </div>

          {/* Email (read only) */}
          <div className="form-group" style={{ marginTop: 12 }}>
            <label className="form-label">Email</label>
            <input
              className="form-input"
              value={profile.email}
              disabled
              style={{ opacity: 0.5, cursor: 'not-allowed' }}
            />
          </div>

          {/* Role (read only) */}
          <div className="form-group" style={{ marginTop: 12 }}>
            <label className="form-label">Role</label>
            <input
              className="form-input"
              value={profile.role}
              disabled
              style={{ opacity: 0.5, cursor: 'not-allowed' }}
            />
          </div>

          <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginTop: 20 }}>
            <button
              className="btn btn-primary btn-sm"
              onClick={handleSaveName}
              disabled={saving}
            >
              {saving ? 'Saving...' : 'Save Changes'}
            </button>
            {saved && (
              <span style={{ fontSize: 12, color: 'var(--status-ready-text)' }}>Saved</span>
            )}
          </div>
        </div>

        {/* Password */}
        <div style={{
          background: 'var(--bg-surface-1)',
          border: '1px solid var(--border-default)',
          borderRadius: 'var(--radius-lg)',
          padding: '24px',
        }}>
          <div style={{ fontFamily: 'var(--font-display)', fontSize: 12, fontWeight: 700, color: 'var(--text-muted)', letterSpacing: '0.15em', textTransform: 'uppercase', marginBottom: 20 }}>
            Password
          </div>

          {!showPasswordForm ? (
            <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
              <button
                className="btn btn-secondary btn-sm"
                onClick={() => setShowPasswordForm(true)}
              >
                Change Password
              </button>
              {passwordSaved && (
                <span style={{ fontSize: 12, color: 'var(--status-ready-text)' }}>Password updated</span>
              )}
            </div>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
              <div className="form-group">
                <label className="form-label">New Password</label>
                <input
                  className="form-input"
                  type="password"
                  value={newPassword}
                  onChange={(e) => setNewPassword(e.target.value)}
                  placeholder="Minimum 8 characters"
                />
              </div>
              <div className="form-group">
                <label className="form-label">Confirm New Password</label>
                <input
                  className="form-input"
                  type="password"
                  value={confirmPassword}
                  onChange={(e) => setConfirmPassword(e.target.value)}
                  placeholder="Repeat new password"
                />
              </div>
              {passwordError && (
                <div style={{ fontSize: 12, color: 'var(--status-blocked-text)' }}>{passwordError}</div>
              )}
              <div style={{ display: 'flex', gap: 8 }}>
                <button className="btn btn-primary btn-sm" onClick={handlePasswordChange}>
                  Update Password
                </button>
                <button className="btn btn-secondary btn-sm" onClick={() => { setShowPasswordForm(false); setPasswordError('') }}>
                  Cancel
                </button>
              </div>
            </div>
          )}
        </div>

        {/* Account info */}
        <div style={{
          background: 'var(--bg-surface-1)',
          border: '1px solid var(--border-default)',
          borderRadius: 'var(--radius-lg)',
          padding: '24px',
        }}>
          <div style={{ fontFamily: 'var(--font-display)', fontSize: 12, fontWeight: 700, color: 'var(--text-muted)', letterSpacing: '0.15em', textTransform: 'uppercase', marginBottom: 16 }}>
            Workspace
          </div>
          <div style={{ fontSize: 13, color: 'var(--text-secondary)', lineHeight: 1.8 }}>
            <div>Access is managed by your Quria Solutions administrator.</div>
            <div style={{ marginTop: 4, fontSize: 11, color: 'var(--text-muted)' }}>
              To request access changes, contact your administrator directly.
            </div>
          </div>
        </div>

      </div>
    </div>
  )
}