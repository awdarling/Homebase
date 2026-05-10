'use client'
import { useCompany } from '@/lib/hooks/useCompany'

import { useEffect, useState } from 'react'
import { createClient } from '@/lib/supabase/client'



type ActorKey = 'aegis' | 'manager' | 'soteria' | 'system' | 'quria_admin'

interface ActivityEntry {
  id: string
  actor: ActorKey
  actor_name: string | null
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

function nameInitials(name: string) {
  const parts = name.trim().split(/\s+/).filter(Boolean)
  if (parts.length === 0) return '??'
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase()
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase()
}

interface ActorPresentation {
  label: string
  initials: string
  color: string
  bg: string
  border: string
  iconUrl?: string
  filterKey: 'aegis' | 'soteria' | 'manager' | 'quria'
}

function presentActor(entry: ActivityEntry, fallbackManagerName: string | null): ActorPresentation {
  const actor = entry.actor

  // Soteria — internal setup/system assistant. System events are also Soteria.
  if (actor === 'soteria' || actor === 'system') {
    return {
      label: 'Soteria',
      initials: 'S',
      color: '#a78bfa',
      bg: 'rgba(167,139,250,0.1)',
      border: 'rgba(167,139,250,0.25)',
      iconUrl: '/soteria-icon.png',
      filterKey: 'soteria',
    }
  }

  // Aegis — external operational AI. Distinct identity from Soteria.
  if (actor === 'aegis') {
    return {
      label: 'Aegis',
      initials: 'AG',
      color: '#60a5fa',
      bg: 'rgba(96,165,250,0.1)',
      border: 'rgba(96,165,250,0.25)',
      filterKey: 'aegis',
    }
  }

  if (actor === 'quria_admin') {
    const display = entry.actor_name || 'Quria'
    return {
      label: display,
      initials: 'Q',
      color: '#f97316',
      bg: 'rgba(249,115,22,0.1)',
      border: 'rgba(249,115,22,0.25)',
      filterKey: 'quria',
    }
  }

  // manager
  const name = entry.actor_name || fallbackManagerName || 'Manager'
  return {
    label: name,
    initials: name === 'Manager' ? 'MG' : nameInitials(name),
    color: '#9ca3af',
    bg: 'rgba(156,163,175,0.1)',
    border: 'rgba(156,163,175,0.25)',
    filterKey: 'manager',
  }
}

export default function ActivityPage() {
  const { company } = useCompany()
  const COMPANY_ID = company?.id ?? ''
  const [entries, setEntries] = useState<ActivityEntry[]>([])
  const [fallbackManagerName, setFallbackManagerName] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)
  const [filter, setFilter] = useState<'all' | 'aegis' | 'soteria' | 'manager' | 'quria'>('all')

  const supabase = createClient()

 useEffect(() => { if (COMPANY_ID) fetchData() }, [COMPANY_ID])

  async function fetchData() {
    if (!COMPANY_ID) return
    setLoading(true)

    const [{ data: activityData }, { data: managerData }] = await Promise.all([
      supabase
        .from('activity_log')
        .select('*')
        .eq('company_id', COMPANY_ID)
        .order('created_at', { ascending: false })
        .limit(200),
      supabase
        .from('users')
        .select('name, role, created_at')
        .eq('company_id', COMPANY_ID)
        .in('role', ['manager', 'owner'])
        .order('created_at', { ascending: false })
        .limit(1),
    ])

    if (activityData) setEntries(activityData as ActivityEntry[])
    setFallbackManagerName(managerData?.[0]?.name ?? null)
    setLoading(false)
  }

  const filtered = entries.filter((e) => {
    if (filter === 'all') return true
    const key = presentActor(e, fallbackManagerName).filterKey
    return key === filter
  })

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
        {(['all', 'aegis', 'soteria', 'manager', 'quria'] as const).map((f) => (
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
                const p = presentActor(entry, fallbackManagerName)
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
                      borderRadius: '50%',
                      background: p.iconUrl ? 'transparent' : p.bg,
                      border: `1px solid ${p.border}`,
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                      fontSize: 11,
                      fontWeight: 700,
                      fontFamily: 'var(--font-display)',
                      color: p.color,
                      flexShrink: 0,
                      marginTop: 1,
                      overflow: 'hidden',
                    }}>
                      {p.iconUrl ? (
                        <img
                          src={p.iconUrl}
                          alt={p.label}
                          style={{ width: '100%', height: '100%', objectFit: 'cover' }}
                        />
                      ) : (
                        p.initials
                      )}
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
                        <span style={{ color: p.color, textTransform: 'uppercase', letterSpacing: '0.1em', fontWeight: 500 }}>
                          {p.label}
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
