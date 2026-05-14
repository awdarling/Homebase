'use client'

import { useEffect, useState } from 'react'
import { createClient } from '@/lib/supabase/client'
import { useCompany } from '@/lib/hooks/useCompany'
import { useQuria } from '@/lib/hooks/useQuria'
import { logActivity as logActivityFn } from '@/lib/activity'

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

const NOTE_TYPES = [
  { value: 'event',          label: 'Event' },
  { value: 'holiday',        label: 'Holiday' },
  { value: 'schedule',       label: 'Scheduling' },
  { value: 'time_off',       label: 'Time Off' },
  { value: 'staffing',       label: 'Staffing' },
  { value: 'manager_pref',   label: 'Manager Preference' },
  { value: 'custom',         label: 'General' },
]

const NOTE_TYPE_COLORS: Record<string, string> = {
  event:        '#8b5cf6',
  holiday:      '#3b82f6',
  schedule:     '#10b981',
  time_off:     '#f97316',
  staffing:     '#ec4899',
  manager_pref: '#14b8a6',
  custom:       '#6b7280',
}

interface SpecialNote {
  id: string
  company_id: string
  title: string
  date: string | null
  end_date: string | null
  description: string | null
  event_type: string
  staffing_notes: string | null
  shift_overrides: Record<string, unknown> | null
  created_by: string
  created_at: string
  updated_at: string
}

function formatDate(d: string) {
  return new Date(d).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
}

function timeAgo(d: string) {
  const diff = Date.now() - new Date(d).getTime()
  const days = Math.floor(diff / 86400000)
  if (days === 0) return 'Today'
  if (days === 1) return 'Yesterday'
  if (days < 30) return `${days}d ago`
  if (days < 365) return `${Math.floor(days / 30)}mo ago`
  return `${Math.floor(days / 365)}y ago`
}

export default function SpecialNotesTab() {
  const { company, user } = useCompany()
  const { isQuria } = useQuria()
  const COMPANY_ID = company?.id ?? ''
  const supabase = createClient()

  const [notes, setNotes] = useState<SpecialNote[]>([])
  const [loading, setLoading] = useState(true)
  const [showForm, setShowForm] = useState(false)
  const [editing, setEditing] = useState<SpecialNote | null>(null)
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const [typeFilter, setTypeFilter] = useState('all')

  const [form, setForm] = useState({
    title: '',
    date: '',
    end_date: '',
    description: '',
    event_type: 'custom',
    staffing_notes: '',
  })

  useEffect(() => { if (COMPANY_ID) fetchData() }, [COMPANY_ID])

  async function fetchData() {
    setLoading(true)
    const { data } = await supabase
      .from('events')
      .select('*')
      .eq('company_id', COMPANY_ID)
      .order('created_at', { ascending: false })
    if (data) setNotes(data)
    setLoading(false)
  }

  async function logActivity(action: string, summary: string, entityId?: string) {
    await logActivityFn({
      supabase,
      company_id: COMPANY_ID,
      action,
      entity_type: 'special_note',
      entity_id: entityId,
      summary,
      isQuria,
      actorName: user?.name,
      actorAvatarUrl: user?.avatar_url,
    })
  }

  function openAdd() {
    setEditing(null)
    setForm({ title: '', date: '', end_date: '', description: '', event_type: 'custom', staffing_notes: '' })
    setError('')
    setShowForm(true)
  }

  function openEdit(note: SpecialNote) {
    setEditing(note)
    setForm({
      title: note.title,
      date: note.date ?? '',
      end_date: note.end_date ?? '',
      description: note.description ?? '',
      event_type: note.event_type,
      staffing_notes: note.staffing_notes ?? '',
    })
    setError('')
    setShowForm(true)
  }

  async function handleSave() {
    if (!form.title.trim()) { setError('Title is required.'); return }
    setSaving(true)
    setError('')

    const payload = {
      company_id: COMPANY_ID,
      title: form.title.trim(),
      date: form.date || null,
      end_date: form.end_date || null,
      description: form.description.trim() || null,
      event_type: form.event_type,
      staffing_notes: form.staffing_notes.trim() || null,
      created_by: 'manager',
      updated_at: new Date().toISOString(),
    }

    if (editing) {
      await supabase.from('events').update(payload).eq('id', editing.id)
      await logActivity('note_updated', `Updated special note: "${form.title}"`, editing.id)
    } else {
      const { data } = await supabase.from('events').insert(payload).select().single()
      if (data) await logActivity('note_created', `Created special note: "${form.title}"`, data.id)
    }

    setSaving(false)
    setShowForm(false)
    fetchData()
  }

  async function handleDelete(id: string) {
    const note = notes.find((n) => n.id === id)
    await supabase.from('events').delete().eq('id', id)
    await logActivity('note_deleted', `Deleted special note: "${note?.title ?? id}"`, id)
    setConfirmDeleteId(null)
    fetchData()
  }

  const filtered = typeFilter === 'all'
    ? notes
    : notes.filter((n) => n.event_type === typeFilter)

  if (loading) {
    return (
      <div style={{ padding: '48px 0', textAlign: 'center', color: 'var(--text-muted)', fontSize: 13 }}>
        Loading special notes...
      </div>
    )
  }

  return (
    <div>
      <div style={{ display: 'flex', alignItems: 'center', marginBottom: 16, gap: 10 }}>
        <div style={{ fontSize: 12, color: 'var(--text-muted)' }}>
          Anything outside normal operations that Aegis should know and remember — events, preferences, one-off rules, context.
        </div>
        <div style={{ marginLeft: 'auto', display: 'flex', gap: 8 }}>
          <select
            className="form-select"
            style={{ maxWidth: 160 }}
            value={typeFilter}
            onChange={(e) => setTypeFilter(e.target.value)}
          >
            <option value="all">All Types</option>
            {NOTE_TYPES.map((t) => (
              <option key={t.value} value={t.value}>{t.label}</option>
            ))}
          </select>
          <button className="btn btn-primary btn-sm" onClick={openAdd}>
            + Add Note
          </button>
        </div>
      </div>

      <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
        {filtered.map((note) => {
          const color = NOTE_TYPE_COLORS[note.event_type] ?? '#666'
          const typeLabel = NOTE_TYPES.find((t) => t.value === note.event_type)?.label ?? note.event_type
          return (
            <div
              key={note.id}
              onClick={() => openEdit(note)}
              style={{
                background: 'var(--bg-surface-1)',
                border: '1px solid var(--border-default)',
                borderLeft: `3px solid ${color}`,
                borderRadius: 'var(--radius-lg)',
                padding: '14px 18px',
                cursor: 'pointer',
                display: 'flex',
                gap: 16,
                alignItems: 'flex-start',
                transition: 'border-color 0.15s',
              }}
            >
              {/* Left: type badge + dates */}
              <div style={{ minWidth: 100, flexShrink: 0 }}>
                <span style={{
                  display: 'inline-block',
                  padding: '2px 8px',
                  borderRadius: 'var(--radius-pill)',
                  fontSize: 11,
                  fontWeight: 500,
                  background: color + '22',
                  color,
                  border: `1px solid ${color}44`,
                  marginBottom: 6,
                }}>
                  {typeLabel}
                </span>
                {note.date && (
                  <div style={{ fontSize: 11, color: 'var(--text-muted)' }}>
                    {formatDate(note.date)}
                    {note.end_date && (
                      <span> – {formatDate(note.end_date)}</span>
                    )}
                  </div>
                )}
              </div>

              {/* Center: title + content */}
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--text-primary)', marginBottom: 4 }}>
                  {note.title}
                </div>
                {note.description && (
                  <div style={{ fontSize: 12, color: 'var(--text-secondary)', marginBottom: 4, lineHeight: 1.5 }}>
                    {note.description}
                  </div>
                )}
                {note.staffing_notes && (
                  <div style={{
                    fontSize: 11,
                    color: 'var(--text-muted)',
                    background: 'var(--bg-surface-2)',
                    borderRadius: 'var(--radius-sm)',
                    padding: '6px 10px',
                    marginTop: 6,
                    lineHeight: 1.5,
                  }}>
                    <span style={{ fontWeight: 600, color: 'var(--text-secondary)' }}>Staffing: </span>
                    {note.staffing_notes}
                  </div>
                )}
              </div>

              {/* Right: meta + delete */}
              <div style={{ flexShrink: 0, display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: 8 }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                  <span style={{
                    fontSize: 10,
                    padding: '2px 6px',
                    borderRadius: 'var(--radius-pill)',
                    background: note.created_by === 'aegis' ? 'var(--accent-dim)' : 'var(--bg-surface-3)',
                    color: note.created_by === 'aegis' ? 'var(--accent)' : 'var(--text-muted)',
                    border: `1px solid ${note.created_by === 'aegis' ? 'var(--accent-border)' : 'var(--border-default)'}`,
                    fontWeight: 500,
                  }}>
                    {note.created_by}
                  </span>
                  <button
                    onClick={(e) => { e.stopPropagation(); setConfirmDeleteId(note.id) }}
                    style={{
                      background: 'transparent',
                      border: 'none',
                      cursor: 'pointer',
                      color: 'var(--text-muted)',
                      padding: '4px',
                      borderRadius: 'var(--radius-sm)',
                      display: 'flex',
                      alignItems: 'center',
                    }}
                  >
                    <TrashIcon />
                  </button>
                </div>
                <div style={{ fontSize: 10, color: 'var(--text-disabled)' }}>
                  {timeAgo(note.created_at)}
                </div>
              </div>
            </div>
          )
        })}

        {filtered.length === 0 && (
          <div style={{
            background: 'var(--bg-surface-1)',
            border: '1px solid var(--border-default)',
            borderRadius: 'var(--radius-lg)',
          }}>
            <div className="empty-state">
              <div className="empty-state-title">No special notes</div>
              <div className="empty-state-desc">
                Add anything Aegis should know that doesn't fit elsewhere — upcoming events, manager preferences, one-off staffing rules, or context about your operation.
              </div>
            </div>
          </div>
        )}
      </div>

      {/* Confirm delete */}
      {confirmDeleteId && (
        <div style={{ position: 'fixed', inset: 0, zIndex: 200, background: 'rgba(0,0,0,0.7)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
          <div style={{ background: 'var(--bg-surface-1)', border: '1px solid var(--border-default)', borderRadius: 'var(--radius-xl)', padding: 28, width: '100%', maxWidth: 380 }}>
            <div style={{ fontFamily: 'var(--font-display)', fontSize: 18, fontWeight: 700, color: 'var(--text-primary)', marginBottom: 10 }}>
              Delete Note
            </div>
            <div style={{ fontSize: 13, color: 'var(--text-muted)', marginBottom: 20, lineHeight: 1.6 }}>
              This will permanently delete this note. Aegis will no longer have access to it.
            </div>
            <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
              <button className="btn btn-secondary btn-sm" onClick={() => setConfirmDeleteId(null)}>Cancel</button>
              <button
                className="btn btn-sm"
                onClick={() => handleDelete(confirmDeleteId)}
                style={{ background: 'var(--status-blocked-bg)', color: 'var(--status-blocked-text)', border: '1px solid var(--status-blocked-border)' }}
              >
                Delete Permanently
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Add/Edit modal */}
      {showForm && (
        <div style={{ position: 'fixed', inset: 0, zIndex: 200, background: 'rgba(0,0,0,0.7)', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 20 }}>
          <div style={{ background: 'var(--bg-surface-1)', border: '1px solid var(--border-default)', borderRadius: 'var(--radius-xl)', padding: 28, width: '100%', maxWidth: 520, maxHeight: '90vh', overflowY: 'auto' }}>
            <div style={{ fontFamily: 'var(--font-display)', fontSize: 18, fontWeight: 700, color: 'var(--text-primary)', marginBottom: 20 }}>
              {editing ? 'Edit Note' : 'Add Special Note'}
            </div>

            <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
              <div className="form-group">
                <label className="form-label">Title</label>
                <input
                  className="form-input"
                  value={form.title}
                  onChange={(e) => setForm((f) => ({ ...f, title: e.target.value }))}
                  placeholder="e.g. Fourth of July Pool Party, Manager prefers no split shifts, etc."
                />
              </div>

              <div className="form-group">
                <label className="form-label">Type</label>
                <select
                  className="form-select"
                  value={form.event_type}
                  onChange={(e) => setForm((f) => ({ ...f, event_type: e.target.value }))}
                >
                  {NOTE_TYPES.map((t) => (
                    <option key={t.value} value={t.value}>{t.label}</option>
                  ))}
                </select>
              </div>

              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
                <div className="form-group">
                  <label className="form-label">Date <span style={{ color: 'var(--text-muted)', fontWeight: 400 }}>(optional)</span></label>
                  <input
                    className="form-input"
                    type="date"
                    value={form.date}
                    onChange={(e) => setForm((f) => ({ ...f, date: e.target.value }))}
                  />
                </div>
                <div className="form-group">
                  <label className="form-label">End Date <span style={{ color: 'var(--text-muted)', fontWeight: 400 }}>(optional)</span></label>
                  <input
                    className="form-input"
                    type="date"
                    value={form.end_date}
                    onChange={(e) => setForm((f) => ({ ...f, end_date: e.target.value }))}
                  />
                </div>
              </div>

              <div className="form-group">
                <label className="form-label">Description <span style={{ color: 'var(--text-muted)', fontWeight: 400 }}>(optional)</span></label>
                <textarea
                  className="form-input"
                  rows={2}
                  value={form.description}
                  onChange={(e) => setForm((f) => ({ ...f, description: e.target.value }))}
                  placeholder="Context or background for this note"
                  style={{ resize: 'vertical' }}
                />
              </div>

              <div className="form-group">
                <label className="form-label">Staffing / Operational Notes</label>
                <textarea
                  className="form-input"
                  rows={3}
                  value={form.staffing_notes}
                  onChange={(e) => setForm((f) => ({ ...f, staffing_notes: e.target.value }))}
                  placeholder="What should Aegis know or do differently because of this? e.g. Double lifeguards, AM shift starts at 8am, no split shifts this week"
                  style={{ resize: 'vertical' }}
                />
                <div style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 4 }}>
                  Aegis reads this across all functions — scheduling, coverage, time-off, and more.
                </div>
              </div>
            </div>

            {error && (
              <div style={{ fontSize: 12, color: 'var(--status-blocked-text)', marginTop: 12 }}>
                {error}
              </div>
            )}

            <div style={{ display: 'flex', gap: 8, marginTop: 20, justifyContent: 'flex-end' }}>
              <button className="btn btn-secondary btn-sm" onClick={() => setShowForm(false)}>Cancel</button>
              <button className="btn btn-primary btn-sm" onClick={handleSave} disabled={saving}>
                {saving ? 'Saving...' : 'Save Note'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}