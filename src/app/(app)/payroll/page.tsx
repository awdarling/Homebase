// Payroll — "coming soon" placeholder.
//
// 2026-08-18: the full payroll page was removed. It rendered check history,
// discrepancy cards, and credential forms for a time-clock and a payroll
// provider — all against a workflow that was never built (the provider adapters
// were stubs that returned nothing). Keeping a page that looks finished for a
// feature that cannot run is worse than an honest placeholder.
//
// NOTHING about wages was removed. The estimated labour cost on a schedule, the
// wage breakdown panel, the per-role rate table under Data, and the "Est. Labor"
// tile on the dashboard are all untouched and still live.

'use client'

export default function PayrollPage() {
  return (
    <div style={{
      display: 'flex',
      flexDirection: 'column',
      alignItems: 'center',
      justifyContent: 'center',
      minHeight: '60vh',
      textAlign: 'center',
      padding: '48px 24px',
    }}>
      <div style={{
        maxWidth: 520,
        background: 'var(--bg-surface-1)',
        border: '1px solid var(--border-default)',
        borderRadius: 'var(--radius-lg)',
        padding: '40px 36px',
      }}>
        <div style={{
          display: 'inline-block',
          padding: '5px 14px',
          borderRadius: 'var(--radius-pill)',
          border: '1px solid var(--accent-border)',
          background: 'var(--accent-dim)',
          color: 'var(--accent)',
          fontSize: 11,
          letterSpacing: '0.06em',
          textTransform: 'uppercase',
          marginBottom: 20,
        }}>
          Coming soon
        </div>

        <h1 style={{
          fontFamily: 'var(--font-display)',
          fontSize: 26,
          margin: '0 0 14px',
          color: 'var(--text-primary)',
        }}>
          Payroll
        </h1>

        <p style={{
          fontSize: 14,
          lineHeight: 1.65,
          color: 'var(--text-secondary)',
          margin: '0 0 18px',
        }}>
          Payroll isn&rsquo;t built yet. When it is, this is where you&rsquo;ll reconcile the hours
          your team actually worked against the hours they were scheduled, and catch the
          differences before they reach a paycheque.
        </p>

        <p style={{
          fontSize: 13,
          lineHeight: 1.65,
          color: 'var(--text-muted)',
          margin: 0,
        }}>
          Wages haven&rsquo;t gone anywhere. Estimated labour cost still appears on every schedule
          you build, the wage breakdown is on the Schedule page, and pay rates are under
          Data &rarr; Wage Rates.
        </p>
      </div>
    </div>
  )
}
