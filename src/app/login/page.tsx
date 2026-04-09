'use client'

import { useState } from 'react'
import { createClient } from '@/lib/supabase/client'
import { useRouter } from 'next/navigation'

export default function LoginPage() {
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)

  const supabase = createClient()
  const router = useRouter()

  async function handleLogin() {
    if (!email || !password) {
      setError('Email and password are required.')
      return
    }
    setLoading(true)
    setError('')

    const { error } = await supabase.auth.signInWithPassword({ email, password })

    if (error) {
      setError('Invalid email or password.')
      setLoading(false)
      return
    }

    router.push('/')
    router.refresh()
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

        {/* Brand */}
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
            Sign in to your workspace
          </div>
        </div>

        {/* Form */}
        <div style={{
          background: 'var(--bg-surface-1)',
          border: '1px solid var(--border-default)',
          borderRadius: 'var(--radius-xl)',
          padding: 28,
        }}>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
            <div className="form-group">
              <label className="form-label">Email</label>
              <input
                className="form-input"
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="you@example.com"
                onKeyDown={(e) => e.key === 'Enter' && handleLogin()}
              />
            </div>
            <div className="form-group">
              <label className="form-label">Password</label>
              <input
                className="form-input"
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder="••••••••"
                onKeyDown={(e) => e.key === 'Enter' && handleLogin()}
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
            onClick={handleLogin}
            disabled={loading}
            style={{ width: '100%', marginTop: 20, justifyContent: 'center' }}
          >
            {loading ? 'Signing in...' : 'Sign In'}
          </button>
        </div>

        <div style={{ textAlign: 'center', marginTop: 20, fontSize: 11, color: 'var(--text-muted)' }}>
          Access is managed by your Quria Solutions administrator.
        </div>
      </div>
    </div>
  )
}