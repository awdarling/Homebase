'use client'

import { useEffect, useState } from 'react'
import { createClient } from '@/lib/supabase/client'

const COMPANY_ID = 'a1b2c3d4-e5f6-7890-abcd-ef1234567890'

interface CompanyProfile {
  id?: string
  company_id: string
  business_type: string | null
  description: string | null
  operating_hours: string | null
  peak_periods: string | null
  manager_priorities: string | null
  special_context: string | null
}

const EMPTY_PROFILE: CompanyProfile = {
  company_id: COMPANY_ID,
  business_type: '',
  description: '',
  operating_hours: '',
  peak_periods: '',
  manager_priorities: '',
  special_context: '',
}

export default function ProfilePage() {
  const [profile, setProfile] = useState<CompanyProfile>(EMPTY_PROFILE)
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [saved, setSaved] = useState(false)

  const supabase = createClient()

  useEffect(() => { fetchData() }, [])

  async function fetchData() {
    setLoading(true)
    const { data } = await supabase
      .from('company_profiles')
      .select('*')
      .eq('company_id', COMPANY_ID)
      .maybeSingle()
    if (data) setProfile(data)
    setLoading(false)
  }

  async function handleSave() {
    setSaving(true)
    setSaved(false)

    const payload = {
      company_id: COMPANY_ID,
      business_type: profile.business_type?.trim() || null,
      description: profile.description?.trim() || null,
      operating_hours: profile.operating_hours?.trim() || null,
      peak_periods: profile.peak_periods?.trim() || null,
      manager_priorities: profile.manager_priorities?.trim() || null,
      special_context: profile.special_context?.trim() || null,
      updated_at: new Date().toISOString(),
    }

    if (profile.id) {
      await supabase.from('company_profiles').update(payload).eq('id', profile.id)
    } else {
      const { data } = await supabase.from('company_profiles').insert(payload).select().single()
      if (data) setProfile(data)
    }

    setSaving(false)
    setSaved(true)
    setTimeout(() => setSaved(false), 3000)
  }

  if (loading) return (
    <div style={{ padding: '48px 0', textAlign: 'center', color: 'var(--text-muted)', fontSize: 13 }}>
      Loading profile...
    </div>
  )

  return (
    <div className="page-content">
      <div className="page-header">
        <div className="page-title">Company Profile</div>
        <div className="page-subtitle">
          Context Aegis uses to understand your business and operate effectively
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
        <span style={{ color: 'var(--accent)', fontWeight: 600 }}>Aegis reads this profile on every request.</span>
        {' '}The more accurate and detailed this is, the sharper and more relevant Aegis's responses will be. Think of it as briefing a new employee on your operation.
      </div>

      <div style={{ display: 'flex', flexDirection: 'column', gap: 20, maxWidth: 720 }}>

        {/* Business Type */}
        <div style={{
          background: 'var(--bg-surface-1)',
          border: '1px solid var(--border-default)',
          borderRadius: 'var(--radius-lg)',
          padding: '20px 24px',
        }}>
          <div style={{ fontFamily: 'var(--font-display)', fontSize: 13, fontWeight: 700, color: 'var(--text-primary)', letterSpacing: '0.05em', marginBottom: 16 }}>
            BUSINESS IDENTITY
          </div>
          <div className="form-group">
            <label className="form-label">Type of Business</label>
            <input
              className="form-input"
              value={profile.business_type ?? ''}
              onChange={(e) => setProfile((p) => ({ ...p, business_type: e.target.value }))}
              placeholder="e.g. Country Club, Hotel, Restaurant, Aquatic Center..."
            />
          </div>
          <div className="form-group" style={{ marginTop: 14 }}>
            <label className="form-label">Operation Description</label>
            <textarea
              className="form-textarea"
              style={{ minHeight: 100 }}
              value={profile.description ?? ''}
              onChange={(e) => setProfile((p) => ({ ...p, description: e.target.value }))}
              placeholder="Describe your business in plain language. What does it do? Who does it serve? What makes it unique? e.g. Watermark Country Club is a private members club with a seasonal outdoor pool facility operating May through September. We serve families and adults with amenities including swimming, dining, and events."
            />
          </div>
        </div>

        {/* Operations */}
        <div style={{
          background: 'var(--bg-surface-1)',
          border: '1px solid var(--border-default)',
          borderRadius: 'var(--radius-lg)',
          padding: '20px 24px',
        }}>
          <div style={{ fontFamily: 'var(--font-display)', fontSize: 13, fontWeight: 700, color: 'var(--text-primary)', letterSpacing: '0.05em', marginBottom: 16 }}>
            OPERATIONS
          </div>
          <div className="form-group">
            <label className="form-label">Operating Hours</label>
            <input
              className="form-input"
              value={profile.operating_hours ?? ''}
              onChange={(e) => setProfile((p) => ({ ...p, operating_hours: e.target.value }))}
              placeholder="e.g. Monday–Friday 11am–9pm, Saturday–Sunday 9:30am–9pm"
            />
          </div>
          <div className="form-group" style={{ marginTop: 14 }}>
            <label className="form-label">Peak Periods</label>
            <textarea
              className="form-textarea"
              value={profile.peak_periods ?? ''}
              onChange={(e) => setProfile((p) => ({ ...p, peak_periods: e.target.value }))}
              placeholder="When is your business busiest? e.g. Weekends in July and August are peak season. July 4th weekend is our single busiest period. School holidays significantly increase pool attendance."
            />
          </div>
        </div>

        {/* Manager Context */}
        <div style={{
          background: 'var(--bg-surface-1)',
          border: '1px solid var(--border-default)',
          borderRadius: 'var(--radius-lg)',
          padding: '20px 24px',
        }}>
          <div style={{ fontFamily: 'var(--font-display)', fontSize: 13, fontWeight: 700, color: 'var(--text-primary)', letterSpacing: '0.05em', marginBottom: 16 }}>
            MANAGER CONTEXT
          </div>
          <div className="form-group">
            <label className="form-label">Priorities</label>
            <textarea
              className="form-textarea"
              value={profile.manager_priorities ?? ''}
              onChange={(e) => setProfile((p) => ({ ...p, manager_priorities: e.target.value }))}
              placeholder="What matters most to you as a manager? e.g. Safety coverage is the top priority — we must never be short a lifeguard. I prefer to avoid overtime when possible. Fair hour distribution matters to staff morale."
            />
          </div>
          <div className="form-group" style={{ marginTop: 14 }}>
            <label className="form-label">Special Context for Aegis</label>
            <textarea
              className="form-textarea"
              value={profile.special_context ?? ''}
              onChange={(e) => setProfile((p) => ({ ...p, special_context: e.target.value }))}
              placeholder="Anything else Aegis should always know about your operation. e.g. Some staff are high school students with school schedule constraints. We have a strict member-facing dress code that affects who can be client-facing. The pool director has final say on all safety decisions."
            />
          </div>
        </div>

      </div>

      <div style={{ marginTop: 24, display: 'flex', alignItems: 'center', gap: 12 }}>
        <button
          className="btn btn-primary"
          onClick={handleSave}
          disabled={saving}
        >
          {saving ? 'Saving...' : 'Save Profile'}
        </button>
        {saved && (
          <span style={{ fontSize: 12, color: 'var(--status-ready-text)' }}>
            Profile saved — Aegis will use this on the next request.
          </span>
        )}
      </div>
    </div>
  )
}