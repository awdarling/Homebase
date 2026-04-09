'use client'

import { useEffect, useState } from 'react'
import { createClient } from '@/lib/supabase/client'

const COMPANY_ID = 'a1b2c3d4-e5f6-7890-abcd-ef1234567890'

interface ActivityEntry {
  id: string
  actor: 'aegis' | 'manager' | 'soteria' | 'system'
  action: string
  entity_type: string | null
  summary: string
  created_at: string
}

function formatDate(dateString: string) {
  const date = new Date(dateString)
  const today = new Date()
  const yesterday = new Date()
  yesterday.setDate(today.getDate() - 1)

  if (date.toDateString() === today.toDateString()) return 'Today'
  if (date.toDateString() === yesterday.toDateString()) return 'Yesterday'
  return date.toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric' })
}

function formatTime(dateString: string) {
  return new Date(dateString).toLocaleTimeString('en-US', {
    hour: 'numeric',
    minute: '2-digit',
    hour12: true,
  })
}

function timeAgo(dateString: string) {
  const diff = Date.now() - new Date(dateString).getTime()
  const minutes = Math.floor(diff / 60000)
  const hours = Math.floor(diff / 3600000)
  const days = Math.floor(diff / 86400000)
  if (minutes < 60) return `${minutes}m ago`
  if (hours < 24) return `${hours}h ago`
  return `${days}d ago`
}

const ACTOR_STYLES: Record<string, { label: string; color: string; bg: string; border: string }> = {
  aegis:   { label: 'Aegis',   color: 'var(--accent)',              bg: 'var(--accent-dim)',       border: 'var(--accent-border)' },
  manager: { label: 'Manager', color: '#60a5fa',                    bg: 'rgba(96,165,250,0.1)',    border: 'rgba(96,165,250,0.25)' },
  soteria: { label: 'Soteria', color: '#a78bfa',                    bg: 'rgba(167,139,250,0.1)',   border: 'rgba(167,139,250,0.25)' },
  system:  { label: 'System',  color: 'var(--text-muted)',          bg: 'var(--bg-surface-3)',     border: 'var(--border-default)' },
}

export default function ActivityPage() {
  const [entries, setEntries] = useState<ActivityEntry[]>([])
  const [loading, setLoading] = useState(true)
  const [filter, setFilter] = useState<'all' | 'aegis' | 'manager' | 'system'>('all')

  const supabase = createClient()

  useEffect(() => { fetchData() }, [])

  async function fetchData() {
    setLoading(true)
    const { data } = await supabase
      .from('activity_log')
      .select('*')
      .eq('company_id', COMPANY_ID)
      .order('created_at', { ascending: false })
      .limit(200)
    if (data) setEntries(data)
    setLoading(false)
  }

  const filtered = entries.filter((e) => filter === 'all' || e.actor === filter)

  const grouped = filtered.reduce((acc, entry) => {
    const dateKey = new Date(entry.created_at).toDateString()
    if (!acc[dateKey]) acc[dateKey] = []
    acc[dateKey].push(entry)
    return acc
  }, {} as Record<string, ActivityEntry[]>)

  if (loading) return (
    <div style={{ padding: '48px 0', textAlign: 'center', color: 'var(--text-muted)', fontSize: 13 }}>
      Loading activity...
    </div>
  )

  return (
    <div className="page-content">
      <div className="page-header">
        <div className="page-title">Activity</div>
        <div className="page-subtitle">
          Full audit trail of everything Aegis has done and every change made
        </div>
      </div>

      <div style={{ display: 'flex', gap: 8, marginBottom: 28 }}>
        {(['all', 'aegis', 'manager', 'system'] as const).map((f) => (
          <button
            key={f}
            onClick={() => setFilter(f)}
            style={{
              padding: '5px 14px',
              borderRadius: 'var(--radius-pill)',
              border: '1px solid',
              fontSize: 12,
              fontFamily: 'var(--font-body)',
              cursor: 'pointer',
              background: filter === f ? 'var(--accent-dim)' : 'transparent',
              borderColor: filter === f ? 'var(--accent-border)' : 'var(--border-default)',
              color: filter === f ? 'var(--accent)' : 'var(--text-muted)',
            }}
          >
            {f.charAt(0).toUpperCase() + f.slice(1)}
          </button>
        ))}
        <div style={{ marginLeft: 'auto', fontSize: 11, color: 'var(--text-muted)', alignSelf: 'center' }}>
          {filtered.length} entries
        </div>
      </div>

      {filtered.length === 0 && (
        <div style={{
          background: 'var(--bg-surface-1)',
          border: '1px solid var(--border-default)',
          borderRadius: 'var(--radius-lg)',
        }}>
          <div className="empty-state">
            <div className="empty-state-title">No activity yet</div>
            <div className="empty-state-desc">
              Once Aegis starts operating, every action will appear here.
            </div>
          </div>
        </div>
      )}

      <div style={{ display: 'flex', flexDirection: 'column', gap: 28 }}>
        {Object.entries(grouped).map(([dateKey, dayEntries]) => (
          <div key={dateKey}>
            <div style={{
              fontSize: 11,
              fontFamily: 'var(--font-display)',
              fontWeight: 700,
              letterSpacing: '0.15em',
              textTransform: 'uppercase',
              color: 'var(--text-muted)',
              marginBottom: 10,
              display: 'flex',
              alignItems: 'center',
              gap: 10,
            }}>
              {formatDate(dayEntries[0].created_at)}
              <div style={{ flex: 1, height: 1, background: 'var(--border-subtle)' }} />
            </div>

            <div style={{
              background: 'var(--bg-surface-1)',
              border: '1px solid var(--border-default)',
              borderRadius: 'var(--radius-lg)',
              overflow: 'hidden',
            }}>
              {dayEntries.map((entry, i) => {
                const style = ACTOR_STYLES[entry.actor] ?? ACTOR_STYLES.system
                return (
                  <div key={entry.id} style={{
                    display: 'flex',
                    gap: 14,
                    padding: '14px 16px',
                    borderBottom: i < dayEntries.length - 1 ? '1px solid var(--border-subtle)' : 'none',
                    alignItems: 'flex-start',
                  }}>
                    <div style={{
                      width: 30,
                      height: 30,
                      borderRadius: 'var(--radius-sm)',
                      background: style.bg,
                      border: `1px solid ${style.border}`,
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                      fontSize: 11,
                      fontWeight: 700,
                      fontFamily: 'var(--font-display)',
                      color: style.color,
                      flexShrink: 0,
                      marginTop: 1,
                    }}>
                      {style.label[0]}
                    </div>
                    <div style={{ flex: 1 }}>
                      <div style={{ fontSize: 13, color: 'var(--text-secondary)', lineHeight: 1.5 }}>
                        {entry.summary}
                      </div>
                      <div style={{
                        fontSize: 10,
                        color: 'var(--text-muted)',
                        marginTop: 4,
                        display: 'flex',
                        gap: 6,
                        alignItems: 'center',
                      }}>
                        <span style={{ color: style.color, textTransform: 'uppercase', letterSpacing: '0.1em', fontWeight: 500 }}>
                          {style.label}
                        </span>
                        <span>·</span>
                        <span>{formatTime(entry.created_at)}</span>
                        <span>·</span>
                        <span>{timeAgo(entry.created_at)}</span>
                        {entry.entity_type && (
                          <>
                            <span>·</span>
                            <span style={{ color: 'var(--text-disabled)' }}>{entry.entity_type}</span>
                          </>
                        )}
                      </div>
                    </div>
                  </div>
                )
              })}
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}