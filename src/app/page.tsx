import { createClient } from '@/lib/supabase/server'

// Placeholder data until real data exists
const PLACEHOLDER_ACTIVITY = [
  {
    id: '1',
    actor: 'aegis',
    summary: 'Built schedule for week of Jul 14. 2 gaps detected in Saturday PM shifts.',
    created_at: new Date(Date.now() - 1000 * 60 * 32).toISOString(),
  },
  {
    id: '2',
    actor: 'manager',
    summary: 'Approved time-off request for Sofia Rivera (Jul 18–20).',
    created_at: new Date(Date.now() - 1000 * 60 * 55).toISOString(),
  },
  {
    id: '3',
    actor: 'aegis',
    summary: 'Emergency coverage: 3 candidates identified for Lifeguard #2 callout.',
    created_at: new Date(Date.now() - 1000 * 60 * 60 * 18).toISOString(),
  },
  {
    id: '4',
    actor: 'aegis',
    summary: 'Processed time-off request from Tyler Knox. Sent recommendation to manager.',
    created_at: new Date(Date.now() - 1000 * 60 * 60 * 26).toISOString(),
  },
]

function timeAgo(dateString: string): string {
  const now = Date.now()
  const then = new Date(dateString).getTime()
  const diff = now - then
  const minutes = Math.floor(diff / 60000)
  const hours = Math.floor(diff / 3600000)
  const days = Math.floor(diff / 86400000)

  if (minutes < 60) return `${minutes}m ago`
  if (hours < 24) return `${hours}h ago`
  return `${days}d ago`
}

export default async function HomePage() {
  return (
    <div className="page-content">

      {/* Page header */}
      <div className="page-header">
        <div className="page-title">Operations Home</div>
        <div className="page-subtitle">
          Current system state and recent Aegis activity
        </div>
      </div>

      {/* System status strip */}
      <div style={{
        background: 'var(--bg-surface-1)',
        border: '1px solid var(--border-default)',
        borderLeft: '3px solid var(--accent)',
        borderRadius: 'var(--radius-lg)',
        padding: '16px 20px',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        marginBottom: 24,
      }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
          <div style={{
            width: 8,
            height: 8,
            borderRadius: '50%',
            background: 'var(--status-action-text)',
          }} />
          <div>
            <div style={{
              fontFamily: 'var(--font-display)',
              fontSize: 13,
              fontWeight: 700,
              color: 'var(--text-primary)',
              letterSpacing: '0.05em',
            }}>
              ACTION REQUIRED
            </div>
            <div style={{ fontSize: 12, color: 'var(--text-muted)', marginTop: 2 }}>
              1 pending time-off request awaiting your decision
            </div>
          </div>
        </div>
        <div style={{ fontSize: 11, color: 'var(--text-muted)' }}>
          Watermark Country Club
        </div>
      </div>

      {/* Stats row */}
      <div style={{
        display: 'grid',
        gridTemplateColumns: 'repeat(4, 1fr)',
        gap: 12,
        marginBottom: 32,
      }}>
        {[
          { label: 'Active Employees', value: '24', sub: '22 scheduled this week' },
          { label: 'Current Schedule', value: 'Jul 14', sub: 'Published by Aegis' },
          { label: 'Pending Time-Off', value: '1', sub: 'Awaiting decision', accent: true },
          { label: 'Open Gaps', value: '2', sub: 'Saturday PM shifts', accent: true },
        ].map((stat) => (
          <div key={stat.label} style={{
            background: 'var(--bg-surface-1)',
            border: '1px solid var(--border-subtle)',
            borderRadius: 'var(--radius-lg)',
            padding: '16px 18px',
          }}>
            <div style={{
              fontFamily: 'var(--font-body)',
              fontSize: 10,
              fontWeight: 500,
              letterSpacing: '0.15em',
              textTransform: 'uppercase',
              color: 'var(--text-muted)',
              marginBottom: 8,
            }}>
              {stat.label}
            </div>
            <div style={{
              fontFamily: 'var(--font-display)',
              fontSize: 28,
              fontWeight: 800,
              color: stat.accent ? 'var(--accent)' : 'var(--text-primary)',
              lineHeight: 1,
              marginBottom: 6,
            }}>
              {stat.value}
            </div>
            <div style={{ fontSize: 11, color: 'var(--text-muted)' }}>
              {stat.sub}
            </div>
          </div>
        ))}
      </div>

      {/* Main content: Outstanding + Activity */}
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 2fr', gap: 16 }}>

        {/* Outstanding items */}
        <div>
          <div className="section-label">Outstanding</div>
          <div style={{
            background: 'var(--bg-surface-1)',
            border: '1px solid var(--border-default)',
            borderRadius: 'var(--radius-lg)',
            overflow: 'hidden',
          }}>
            {/* Pending TO */}
            <div style={{
              padding: '14px 16px',
              borderBottom: '1px solid var(--border-subtle)',
              display: 'flex',
              alignItems: 'flex-start',
              gap: 10,
            }}>
              <div style={{
                width: 6,
                height: 6,
                borderRadius: '50%',
                background: 'var(--status-action-text)',
                marginTop: 5,
                flexShrink: 0,
              }} />
              <div>
                <div style={{ fontSize: 12, color: 'var(--text-primary)', fontWeight: 500 }}>
                  Time-off request pending
                </div>
                <div style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 3 }}>
                  Tyler Knox · Jul 22–24
                </div>
                <div style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 2 }}>
                  Aegis recommendation: Approve
                </div>
              </div>
            </div>

            {/* Schedule gap */}
            <div style={{
              padding: '14px 16px',
              display: 'flex',
              alignItems: 'flex-start',
              gap: 10,
            }}>
              <div style={{
                width: 6,
                height: 6,
                borderRadius: '50%',
                background: 'var(--status-review-text)',
                marginTop: 5,
                flexShrink: 0,
              }} />
              <div>
                <div style={{ fontSize: 12, color: 'var(--text-primary)', fontWeight: 500 }}>
                  2 shift gaps this week
                </div>
                <div style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 3 }}>
                  Saturday PM · Lifeguard role
                </div>
                <div style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 2 }}>
                  No qualified staff available
                </div>
              </div>
            </div>
          </div>
        </div>

        {/* Recent activity */}
        <div>
          <div className="section-label">Recent Activity</div>
          <div style={{
            background: 'var(--bg-surface-1)',
            border: '1px solid var(--border-default)',
            borderRadius: 'var(--radius-lg)',
            overflow: 'hidden',
          }}>
            {PLACEHOLDER_ACTIVITY.map((item, i) => (
              <div key={item.id} style={{
                display: 'flex',
                gap: 12,
                padding: '14px 16px',
                borderBottom: i < PLACEHOLDER_ACTIVITY.length - 1
                  ? '1px solid var(--border-subtle)'
                  : 'none',
                alignItems: 'flex-start',
              }}>

                {/* Actor icon */}
                <div style={{
                  width: 28,
                  height: 28,
                  borderRadius: 'var(--radius-sm)',
                  background: item.actor === 'aegis'
                    ? 'var(--accent-dim)'
                    : 'var(--bg-surface-3)',
                  border: `1px solid ${item.actor === 'aegis'
                    ? 'var(--accent-border)'
                    : 'var(--border-subtle)'}`,
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  fontSize: 11,
                  fontWeight: 700,
                  fontFamily: 'var(--font-display)',
                  color: item.actor === 'aegis'
                    ? 'var(--accent)'
                    : 'var(--text-muted)',
                  flexShrink: 0,
                }}>
                  {item.actor === 'aegis' ? 'A' : 'M'}
                </div>

                {/* Content */}
                <div style={{ flex: 1 }}>
                  <div style={{ fontSize: 12, color: 'var(--text-secondary)', lineHeight: 1.5 }}>
                    {item.summary}
                  </div>
                  <div style={{
                    fontSize: 10,
                    color: 'var(--text-muted)',
                    marginTop: 4,
                    display: 'flex',
                    gap: 6,
                    alignItems: 'center',
                  }}>
                    <span style={{
                      textTransform: 'uppercase',
                      letterSpacing: '0.1em',
                      color: item.actor === 'aegis' ? 'var(--accent)' : 'var(--text-muted)',
                    }}>
                      {item.actor === 'aegis' ? 'Aegis' : 'Manager'}
                    </span>
                    <span>·</span>
                    <span>{timeAgo(item.created_at)}</span>
                  </div>
                </div>

              </div>
            ))}
          </div>
        </div>

      </div>
    </div>
  )
}
