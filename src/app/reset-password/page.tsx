'use client'

import { useState, useEffect } from 'react'
import { createClient } from '@/lib/supabase/client'
import { useRouter } from 'next/navigation'

export default function ResetPasswordPage() {
  const [password, setPassword] = useState('')
  const [confirmPassword, setConfirmPassword] = useState('')
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)
  const [done, setDone] = useState(false)

  const supabase = createClient()
  const router = useRouter()

  async function handleReset() {
    setError('')
    if (!password || !confirmPassword) {
      setError('Both fields are required.')
      return
    }
    if (password !== confirmPassword) {
      setError('Passwords do not match.')
      return
    }
    if (password.length < 8) {
      setError('Password must be at least 8 characters.')
      return
    }
    setLoading(true)
    const { error } = await supabase.auth.updateUser({ password })
    if (error) {
      setError('Failed to reset password. Your link may have expired.')
      setLoading(false)
      return
    }
    setDone(true)
    setTimeout(() => router.push('/'), 3000)
  }

  return (
    <div style={{
      minHeight: '100vh',
      background: 'var(--bg-base)',
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center',
      padding: 24,
    }}>
      <div style={{ width: '100%', maxWidth: 400 }}>

        <div style={{ textAlign: 'center', marginBottom: 40 }}>
          <div style={{
            fontFamily: 'var(--font-display)',
            fontSize: 13,
            fontWeight: 800,
            letterSpacing: '0.12em',
            color: 'var(--text-primary)',
            marginBottom: 6,
          }}>
            QURIA <span style={{ color: 'var(--accent)' }}>SOLUTIONS</span>
          </div>
          <div style={{
            fontFamily: 'var(--font-display)',
            fontSize: 28,
            fontWeight: 800,
            color: 'var(--text-primary)',
            lineHeight: 1,
            marginBottom: 8,
          }}>
            Homebase
          </div>
          <div style={{ fontSize: 13, color: 'var(--text-muted)' }}>
            Set a new password
          </div>
        </div>

        <div style={{
          background: 'var(--bg-surface-1)',
          border: '1px solid var(--border-default)',
          borderRadius: 'var(--radius-xl)',
          padding: 28,
        }}>
          {done ? (
            <div style={{ textAlign: 'center', padding: '12px 0' }}>
              <div style={{ fontSize: 14, color: 'var(--status-ready-text)', fontWeight: 500, marginBottom: 8 }}>
                Password updated
              </div>
              <div style={{ fontSize: 12, color: 'var(--text-muted)', lineHeight: 1.6 }}>
                Redirecting you to Homebase...
              </div>
            </div>
          ) : (
            <>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
                <div className="form-group">
                  <label className="form-label">New Password</label>
                  <input
                    className="form-input"
                    type="password"
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    placeholder="Minimum 8 characters"
                    onKeyDown={(e) => e.key === 'Enter' && handleReset()}
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
                    onKeyDown={(e) => e.key === 'Enter' && handleReset()}
                  />
                </div>
              </div>

              {error && (
                <div style={{
                  fontSize: 12,
                  color: 'var(--status-blocked-text)',
                  marginTop: 12,
                  padding: '8px 12px',
                  background: 'var(--status-blocked-bg)',
                  border: '1px solid var(--status-blocked-border)',
                  borderRadius: 'var(--radius-md)',
                }}>
                  {error}
                </div>
              )}

              <button
                className="btn btn-primary"
                onClick={handleReset}
                disabled={loading}
                style={{ width: '100%', marginTop: 20, justifyContent: 'center' }}
              >
                {loading ? 'Updating...' : 'Set New Password'}
              </button>
            </>
          )}
        </div>
      </div>
    </div>
  )
}