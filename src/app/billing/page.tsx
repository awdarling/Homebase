'use client'

import { useEffect, useState } from 'react'
import { createClient } from '@/lib/supabase/client'
import { useRouter, useSearchParams } from 'next/navigation'

const COMPANY_ID = 'a1b2c3d4-e5f6-7890-abcd-ef1234567890'

interface BillingInfo {
  stripe_customer_id: string | null
  stripe_subscription_id: string | null
  subscription_status: string
  subscription_price: number
  subscription_notes: string | null
  billing_email: string | null
  name: string
}

interface SubscriptionDetails {
  status: string
  current_period_end: number | null
  cancel_at_period_end: boolean
}

function formatDate(timestamp: number) {
  return new Date(timestamp * 1000).toLocaleDateString('en-US', {
    month: 'long',
    day: 'numeric',
    year: 'numeric',
  })
}

function formatPrice(cents: number) {
  return `$${(cents / 100).toLocaleString('en-US', { minimumFractionDigits: 2 })}`
}

const STATUS_STYLES: Record<string, { label: string; color: string; bg: string; border: string }> = {
  active:   { label: 'Active',   color: 'var(--status-ready-text)',   bg: 'var(--status-ready-bg)',   border: 'var(--status-ready-border)' },
  inactive: { label: 'Inactive', color: 'var(--status-blocked-text)', bg: 'var(--status-blocked-bg)', border: 'var(--status-blocked-border)' },
  past_due: { label: 'Past Due', color: 'var(--status-action-text)',  bg: 'var(--status-action-bg)',  border: 'var(--status-action-border)' },
  trialing: { label: 'Trial',    color: 'var(--status-review-text)',  bg: 'var(--status-review-bg)',  border: 'var(--status-review-border)' },
  canceled: { label: 'Canceled', color: 'var(--status-blocked-text)', bg: 'var(--status-blocked-bg)', border: 'var(--status-blocked-border)' },
}

export default function BillingPage() {
  const [billing, setBilling] = useState<BillingInfo | null>(null)
  const [subscription, setSubscription] = useState<SubscriptionDetails | null>(null)
  const [currentUser, setCurrentUser] = useState<{ role: string } | null>(null)
  const [loading, setLoading] = useState(true)
  const [actionLoading, setActionLoading] = useState(false)

  // Quria admin fields
  const [editingNotes, setEditingNotes] = useState(false)
  const [notesValue, setNotesValue] = useState('')
  const [priceValue, setPriceValue] = useState('')
  const [billingEmailValue, setBillingEmailValue] = useState('')
  const [savingAdmin, setSavingAdmin] = useState(false)
  const [adminSaved, setAdminSaved] = useState(false)

  const supabase = createClient()
  const router = useRouter()
  const searchParams = useSearchParams()

  useEffect(() => { fetchData() }, [])

  async function fetchData() {
    setLoading(true)
    const { data: { user: authUser } } = await supabase.auth.getUser()
    if (!authUser) { router.push('/login'); return }

    const { data: userData } = await supabase
      .from('users')
      .select('role')
      .eq('id', authUser.id)
      .single()

    if (userData) setCurrentUser(userData)

    const { data: companyData } = await supabase
      .from('companies')
      .select('name, stripe_customer_id, stripe_subscription_id, subscription_status, subscription_price, subscription_notes, billing_email')
      .eq('id', COMPANY_ID)
      .single()

    if (companyData) {
      setBilling(companyData)
      setNotesValue(companyData.subscription_notes ?? '')
      setPriceValue(String(companyData.subscription_price ?? 0))
      setBillingEmailValue(companyData.billing_email ?? '')

      if (companyData.stripe_subscription_id) {
        const res = await fetch('/api/stripe', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            action: 'get_subscription',
            subscription_id: companyData.stripe_subscription_id,
          }),
        })
        const subData = await res.json()
        setSubscription(subData)
      }
    }

    setLoading(false)
  }

  async function handleStartSubscription() {
    if (!billing) return
    setActionLoading(true)

    let customerId = billing.stripe_customer_id

    if (!customerId) {
      const res = await fetch('/api/stripe', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'create_customer',
          email: billing.billing_email ?? '',
          name: billing.name,
          company_id: COMPANY_ID,
        }),
      })
      const data = await res.json()
      customerId = data.customer_id
      await supabase.from('companies').update({ stripe_customer_id: customerId }).eq('id', COMPANY_ID)
    }

    const res = await fetch('/api/stripe', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        action: 'create_checkout',
        customer_id: customerId,
        amount_cents: billing.subscription_price,
        plan_name: 'Homebase + Aegis',
        plan_description: `Monthly subscription — ${billing.name}`,
        origin: window.location.origin,
      }),
    })
    const data = await res.json()
    if (data.url) window.location.href = data.url
    setActionLoading(false)
  }

  async function handleManageBilling() {
    if (!billing?.stripe_customer_id) return
    setActionLoading(true)
    const res = await fetch('/api/stripe', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        action: 'create_portal',
        customer_id: billing.stripe_customer_id,
        origin: window.location.origin,
      }),
    })
    const data = await res.json()
    if (data.url) window.location.href = data.url
    setActionLoading(false)
  }

  async function handleSaveAdmin() {
    setSavingAdmin(true)
    await supabase.from('companies').update({
      subscription_price: parseInt(priceValue) || 0,
      subscription_notes: notesValue.trim() || null,
      billing_email: billingEmailValue.trim() || null,
    }).eq('id', COMPANY_ID)
    setSavingAdmin(false)
    setAdminSaved(true)
    setEditingNotes(false)
    setTimeout(() => setAdminSaved(false), 3000)
    fetchData()
  }

  const isQuria = currentUser?.role === 'quria'
  const statusInfo = STATUS_STYLES[billing?.subscription_status ?? 'inactive'] ?? STATUS_STYLES.inactive
  const success = searchParams.get('success')
  const cancelled = searchParams.get('cancelled')

  if (loading) return (
    <div style={{ padding: '48px 0', textAlign: 'center', color: 'var(--text-muted)', fontSize: 13 }}>
      Loading billing...
    </div>
  )

  return (
    <div className="page-content">
      <div className="page-header">
        <div className="page-title">Billing</div>
        <div className="page-subtitle">Subscription and payment management</div>
      </div>

      {/* Success / cancelled banners */}
      {success && (
        <div style={{
          background: 'var(--status-ready-bg)',
          border: '1px solid var(--status-ready-border)',
          borderRadius: 'var(--radius-lg)',
          padding: '12px 16px',
          fontSize: 13,
          color: 'var(--status-ready-text)',
          marginBottom: 24,
        }}>
          Payment successful. Your subscription is now active.
        </div>
      )}
      {cancelled && (
        <div style={{
          background: 'var(--status-action-bg)',
          border: '1px solid var(--status-action-border)',
          borderRadius: 'var(--radius-lg)',
          padding: '12px 16px',
          fontSize: 13,
          color: 'var(--status-action-text)',
          marginBottom: 24,
        }}>
          Checkout was cancelled. No payment was made.
        </div>
      )}

      <div style={{ display: 'flex', flexDirection: 'column', gap: 16, maxWidth: 640 }}>

        {/* Subscription status */}
        <div style={{
          background: 'var(--bg-surface-1)',
          border: '1px solid var(--border-default)',
          borderRadius: 'var(--radius-lg)',
          padding: '24px',
        }}>
          <div style={{ fontFamily: 'var(--font-display)', fontSize: 12, fontWeight: 700, color: 'var(--text-muted)', letterSpacing: '0.15em', textTransform: 'uppercase', marginBottom: 20 }}>
            Subscription
          </div>

          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 20 }}>
            <div>
              <div style={{ fontFamily: 'var(--font-display)', fontSize: 28, fontWeight: 800, color: 'var(--text-primary)', lineHeight: 1, marginBottom: 6 }}>
                {billing?.subscription_price ? formatPrice(billing.subscription_price) : '—'}
                <span style={{ fontSize: 13, fontWeight: 400, color: 'var(--text-muted)', marginLeft: 6 }}>/month</span>
              </div>
              <div style={{ fontSize: 12, color: 'var(--text-muted)' }}>
                Homebase + Aegis — {billing?.name}
              </div>
            </div>
            <span style={{
              padding: '4px 12px',
              borderRadius: 'var(--radius-pill)',
              fontSize: 12,
              fontWeight: 500,
              background: statusInfo.bg,
              color: statusInfo.color,
              border: `1px solid ${statusInfo.border}`,
            }}>
              {statusInfo.label}
            </span>
          </div>

          {subscription?.current_period_end && (
            <div style={{ fontSize: 12, color: 'var(--text-muted)', marginBottom: 20 }}>
              {subscription.cancel_at_period_end
                ? `Cancels on ${formatDate(subscription.current_period_end)}`
                : `Next billing date: ${formatDate(subscription.current_period_end)}`
              }
            </div>
          )}

          <div style={{ display: 'flex', gap: 8 }}>
            {billing?.subscription_status !== 'active' ? (
              <button
                className="btn btn-primary btn-sm"
                onClick={handleStartSubscription}
                disabled={actionLoading || !billing?.subscription_price}
              >
                {actionLoading ? 'Loading...' : 'Start Subscription'}
              </button>
            ) : (
              <button
                className="btn btn-secondary btn-sm"
                onClick={handleManageBilling}
                disabled={actionLoading}
              >
                {actionLoading ? 'Loading...' : 'Manage Billing'}
              </button>
            )}
          </div>

          {!billing?.subscription_price && billing?.subscription_status !== 'active' && (
            <div style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 10 }}>
              Subscription details are being configured by your Quria Solutions administrator.
            </div>
          )}
        </div>

        {/* Quria admin section */}
        {isQuria && (
          <div style={{
            background: 'var(--bg-surface-1)',
            border: '1px solid var(--accent-border)',
            borderRadius: 'var(--radius-lg)',
            padding: '24px',
          }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 20 }}>
              <div style={{ fontFamily: 'var(--font-display)', fontSize: 12, fontWeight: 700, color: 'var(--accent)', letterSpacing: '0.15em', textTransform: 'uppercase' }}>
                Quria Admin
              </div>
              <span style={{ fontSize: 10, color: 'var(--text-muted)' }}>— visible to you only</span>
            </div>

            <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
              <div className="form-group">
                <label className="form-label">Monthly Price (in cents)</label>
                <input
                  className="form-input"
                  type="number"
                  value={priceValue}
                  onChange={(e) => setPriceValue(e.target.value)}
                  placeholder="e.g. 50000 = $500.00"
                />
                <div style={{ fontSize: 10, color: 'var(--text-muted)', marginTop: 4 }}>
                  {parseInt(priceValue) > 0 ? `= ${formatPrice(parseInt(priceValue))}/month` : 'Enter amount in cents'}
                </div>
              </div>

              <div className="form-group">
                <label className="form-label">Billing Email</label>
                <input
                  className="form-input"
                  type="email"
                  value={billingEmailValue}
                  onChange={(e) => setBillingEmailValue(e.target.value)}
                  placeholder="client@example.com"
                />
              </div>

              <div className="form-group">
                <label className="form-label">Contract Notes</label>
                <textarea
                  className="form-textarea"
                  value={notesValue}
                  onChange={(e) => setNotesValue(e.target.value)}
                  placeholder="e.g. 3-month trial at $400, increases to $500 in October. Includes onboarding support."
                />
              </div>
            </div>

            <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginTop: 16 }}>
              <button
                className="btn btn-primary btn-sm"
                onClick={handleSaveAdmin}
                disabled={savingAdmin}
              >
                {savingAdmin ? 'Saving...' : 'Save'}
              </button>
              {adminSaved && (
                <span style={{ fontSize: 12, color: 'var(--status-ready-text)' }}>Saved</span>
              )}
            </div>

            {billing?.stripe_customer_id && (
              <div style={{ marginTop: 16, fontSize: 11, color: 'var(--text-muted)', fontFamily: 'var(--font-mono)' }}>
                Stripe Customer: {billing.stripe_customer_id}
              </div>
            )}
            {billing?.stripe_subscription_id && (
              <div style={{ fontSize: 11, color: 'var(--text-muted)', fontFamily: 'var(--font-mono)', marginTop: 4 }}>
                Subscription: {billing.stripe_subscription_id}
              </div>
            )}
          </div>
        )}

      </div>
    </div>
  )
}