'use client'

import { useLayoutEffect, useRef, useState } from 'react'
import type { Schedule, ScheduleTemplate } from '@/lib/types'
import ScheduleRenderer from './ScheduleRenderer'

// ── Mock schedule for preview when no current schedule exists ────────────────

const MOCK_SCHEDULE: Schedule = {
  id: '__preview__',
  company_id: '',
  week_start: '2026-05-03',
  week_end: '2026-05-09',
  status: 'draft',
  generated_by: 'preview',
  generated_at: new Date().toISOString(),
  approved_at: null,
  distributed_at: null,
  deleted_at: null,
  data: {
    assignments: [
      { date: '2026-05-04', employee_id: 'e1', employee_name: 'Alice J.',  shift_name: 'AMWeekday', role: 'Server', start_time: '07:00', end_time: '15:00', hours: 8 },
      { date: '2026-05-04', employee_id: 'e2', employee_name: 'Bob S.',    shift_name: 'AMWeekday', role: 'Cook',   start_time: '07:00', end_time: '15:00', hours: 8 },
      { date: '2026-05-05', employee_id: 'e3', employee_name: 'Carol D.',  shift_name: 'AMWeekday', role: 'Host',   start_time: '07:00', end_time: '15:00', hours: 8 },
      { date: '2026-05-05', employee_id: 'e1', employee_name: 'Alice J.',  shift_name: 'PM',        role: 'Server', start_time: '15:00', end_time: '23:00', hours: 8 },
      { date: '2026-05-06', employee_id: 'e2', employee_name: 'Bob S.',    shift_name: 'PM',        role: 'Cook',   start_time: '15:00', end_time: '23:00', hours: 8 },
      { date: '2026-05-07', employee_id: 'e3', employee_name: 'Carol D.',  shift_name: 'AMWeekday', role: 'Host',   start_time: '07:00', end_time: '15:00', hours: 8 },
      { date: '2026-05-08', employee_id: 'e1', employee_name: 'Alice J.',  shift_name: 'PM',        role: 'Server', start_time: '15:00', end_time: '23:00', hours: 8 },
      { date: '2026-05-03', employee_id: 'e2', employee_name: 'Bob S.',    shift_name: 'AMWeekend', role: 'Cook',   start_time: '08:00', end_time: '16:00', hours: 8 },
      { date: '2026-05-09', employee_id: 'e3', employee_name: 'Carol D.',  shift_name: 'AMWeekend', role: 'Host',   start_time: '08:00', end_time: '16:00', hours: 8 },
    ],
    gaps: [
      { date: '2026-05-06', shift_name: 'AMWeekday', role: 'Server', required_count: 2, filled_count: 0, reason: 'No staff available' },
    ],
    summary: 'Preview',
  },
  staffing_report: null,
}

// ── PreviewScaler ─────────────────────────────────────────────────────────────

function PreviewScaler({ children, scale = 0.6 }: { children: React.ReactNode; scale?: number }) {
  const innerRef = useRef<HTMLDivElement>(null)
  const [outerHeight, setOuterHeight] = useState<number | undefined>(undefined)

  useLayoutEffect(() => {
    if (innerRef.current) {
      setOuterHeight(Math.round(innerRef.current.scrollHeight * scale))
    }
  })

  return (
    <div style={{ height: outerHeight ?? 'auto', overflow: 'hidden', width: '100%' }}>
      <div
        ref={innerRef}
        style={{
          transform: `scale(${scale})`,
          transformOrigin: 'top left',
          width: `${(100 / scale).toFixed(2)}%`,
          pointerEvents: 'none',
        }}
      >
        {children}
      </div>
    </div>
  )
}

// ── Section wrapper ───────────────────────────────────────────────────────────

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div>
      <div style={{
        fontSize: 11,
        fontWeight: 700,
        textTransform: 'uppercase',
        letterSpacing: '0.1em',
        color: 'var(--text-muted)',
        marginBottom: 14,
      }}>
        {title}
      </div>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
        {children}
      </div>
    </div>
  )
}

function Toggle({
  label, checked, onChange,
}: { label: string; checked: boolean; onChange: (v: boolean) => void }) {
  return (
    <label style={{ display: 'flex', alignItems: 'center', gap: 10, cursor: 'pointer', userSelect: 'none' }}>
      <div
        onClick={() => onChange(!checked)}
        style={{
          width: 36,
          height: 20,
          borderRadius: 10,
          background: checked ? 'var(--accent)' : 'var(--border-default)',
          position: 'relative',
          transition: 'background 0.15s',
          flexShrink: 0,
          cursor: 'pointer',
        }}
      >
        <div style={{
          position: 'absolute',
          top: 2,
          left: checked ? 18 : 2,
          width: 16,
          height: 16,
          borderRadius: '50%',
          background: '#ffffff',
          transition: 'left 0.15s',
          boxShadow: '0 1px 3px rgba(0,0,0,0.2)',
        }} />
      </div>
      <span style={{ fontSize: 12, color: 'var(--text-secondary)' }}>{label}</span>
    </label>
  )
}

// ── TemplateEditorPanel ───────────────────────────────────────────────────────

interface TemplateEditorPanelProps {
  template: ScheduleTemplate
  currentSchedule: Schedule | null
  saveTemplate: (t: ScheduleTemplate) => Promise<void>
  onClose: () => void
}

const DAY_LABELS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday']

const LAYOUT_OPTIONS: { value: ScheduleTemplate['layout_type']; label: string }[] = [
  { value: 'shift-rows-day-columns',    label: 'Shifts × Days' },
  { value: 'employee-rows-day-columns', label: 'Employees × Days' },
  { value: 'role-rows-day-columns',     label: 'Roles × Days' },
]

export default function TemplateEditorPanel({
  template, currentSchedule, saveTemplate, onClose,
}: TemplateEditorPanelProps) {
  const [local, setLocal] = useState<ScheduleTemplate>(() => ({
    ...template,
    row_config: template.row_config.map(r => ({ ...r })),
    column_config: template.column_config.map(c => ({ ...c })),
    display_options: { ...template.display_options },
    color_config: { ...template.color_config, map: { ...template.color_config.map } },
  }))
  const [rowHeight, setRowHeightState] = useState(template.row_config[0]?.height ?? 120)
  const [colWidth, setColWidthState] = useState(template.column_config[0]?.width ?? 180)
  const [saving, setSaving] = useState(false)

  const previewSchedule = currentSchedule ?? MOCK_SCHEDULE

  function setLayout(value: ScheduleTemplate['layout_type']) {
    setLocal(t => ({ ...t, layout_type: value }))
  }

  function setDayColor(day: number, color: string) {
    setLocal(t => ({
      ...t,
      column_config: t.column_config.map(c => c.day === day ? { ...c, color } : c),
      color_config: { ...t.color_config, map: { ...t.color_config.map, [String(day)]: color } },
    }))
  }

  function setDisplayOption<K extends keyof ScheduleTemplate['display_options']>(
    key: K, value: ScheduleTemplate['display_options'][K]
  ) {
    setLocal(t => ({ ...t, display_options: { ...t.display_options, [key]: value } }))
  }

  function setRowHeight(h: number) {
    setRowHeightState(h)
    setLocal(t => ({ ...t, row_config: t.row_config.map(r => ({ ...r, height: h })) }))
  }

  function setColWidth(w: number) {
    setColWidthState(w)
    setLocal(t => ({ ...t, column_config: t.column_config.map(c => ({ ...c, width: w })) }))
  }

  async function handleSave() {
    setSaving(true)
    await saveTemplate(local)
    setSaving(false)
    onClose()
  }

  return (
    <div style={{ position: 'fixed', inset: 0, zIndex: 1000, display: 'flex' }}>
      {/* Clickable backdrop on the left side */}
      <div
        style={{ flex: 1, background: 'rgba(0,0,0,0.5)', cursor: 'pointer' }}
        onClick={onClose}
      />

      {/* Main panel */}
      <div style={{
        width: 'min(82vw, 1200px)',
        background: 'var(--bg-base)',
        display: 'flex',
        flexDirection: 'column',
        height: '100vh',
        boxShadow: '-8px 0 48px rgba(0,0,0,0.35)',
      }}>

        {/* Panel header */}
        <div style={{
          padding: '18px 28px',
          borderBottom: '1px solid var(--border-default)',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          flexShrink: 0,
          background: 'var(--bg-surface-1)',
        }}>
          <div>
            <div style={{ fontFamily: 'var(--font-display)', fontSize: 18, fontWeight: 700, color: 'var(--text-primary)' }}>
              Edit Template
            </div>
            <div style={{ fontSize: 12, color: 'var(--text-muted)', marginTop: 2 }}>
              Customize how your schedule grid looks
            </div>
          </div>
          <button
            onClick={onClose}
            style={{ background: 'transparent', border: 'none', cursor: 'pointer', color: 'var(--text-muted)', fontSize: 24, lineHeight: 1, padding: '0 4px' }}
          >
            ×
          </button>
        </div>

        {/* Panel body */}
        <div style={{ flex: 1, overflow: 'hidden', display: 'flex' }}>

          {/* Left: controls */}
          <div style={{
            width: '40%',
            minWidth: 280,
            borderRight: '1px solid var(--border-default)',
            overflowY: 'auto',
            padding: '28px 28px',
            display: 'flex',
            flexDirection: 'column',
            gap: 32,
            background: 'var(--bg-surface-1)',
          }}>

            {/* Section 1: Layout */}
            <Section title="Layout">
              <div className="form-group" style={{ marginBottom: 0 }}>
                <label className="form-label">Layout Type</label>
                <select
                  className="form-select"
                  value={local.layout_type}
                  onChange={e => setLayout(e.target.value as ScheduleTemplate['layout_type'])}
                >
                  {LAYOUT_OPTIONS.map(o => (
                    <option key={o.value} value={o.value}>{o.label}</option>
                  ))}
                </select>
              </div>
            </Section>

            {/* Section 2: Day Colors */}
            <Section title="Day Colors">
              {DAY_LABELS.map((label, day) => {
                const col = local.column_config.find(c => c.day === day)
                const color = col?.color ?? '#888888'
                return (
                  <div key={day} style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
                    <div style={{
                      width: 10, height: 10, borderRadius: '50%',
                      background: color, flexShrink: 0,
                      border: '1px solid rgba(0,0,0,0.15)',
                    }} />
                    <span style={{ fontSize: 12, color: 'var(--text-secondary)', flex: 1 }}>{label}</span>
                    <input
                      type="color"
                      value={color}
                      onChange={e => setDayColor(day, e.target.value)}
                      style={{
                        width: 36,
                        height: 28,
                        border: '1px solid var(--border-default)',
                        borderRadius: 'var(--radius-sm)',
                        padding: 2,
                        cursor: 'pointer',
                        background: 'var(--bg-surface-2)',
                      }}
                    />
                  </div>
                )
              })}
            </Section>

            {/* Section 3: Display Options */}
            <Section title="Display Options">
              <Toggle
                label="Show employee photos"
                checked={local.display_options.show_photos}
                onChange={v => setDisplayOption('show_photos', v)}
              />
              <Toggle
                label="Show hours per shift"
                checked={local.display_options.show_hours}
                onChange={v => setDisplayOption('show_hours', v)}
              />
              <Toggle
                label="Show role label"
                checked={local.display_options.show_role}
                onChange={v => setDisplayOption('show_role', v)}
              />
              <Toggle
                label="Show start/end times"
                checked={local.display_options.show_start_end}
                onChange={v => setDisplayOption('show_start_end', v)}
              />
              <Toggle
                label="Compact mode"
                checked={local.display_options.compact}
                onChange={v => setDisplayOption('compact', v)}
              />

              {/* Font size */}
              <div style={{ marginTop: 4 }}>
                <div style={{ fontSize: 12, color: 'var(--text-secondary)', marginBottom: 8 }}>Font Size</div>
                <div style={{ display: 'flex', gap: 6 }}>
                  {(['sm', 'md', 'lg'] as const).map(sz => (
                    <button
                      key={sz}
                      onClick={() => setDisplayOption('font_size', sz)}
                      style={{
                        flex: 1,
                        padding: '6px 0',
                        borderRadius: 'var(--radius-md)',
                        border: '1px solid',
                        fontSize: 12,
                        cursor: 'pointer',
                        fontFamily: 'var(--font-body)',
                        background: local.display_options.font_size === sz ? 'var(--accent-dim)' : 'transparent',
                        borderColor: local.display_options.font_size === sz ? 'var(--accent-border)' : 'var(--border-default)',
                        color: local.display_options.font_size === sz ? 'var(--accent)' : 'var(--text-muted)',
                      }}
                    >
                      {sz === 'sm' ? 'Small' : sz === 'md' ? 'Medium' : 'Large'}
                    </button>
                  ))}
                </div>
              </div>
            </Section>

            {/* Section 4: Cell Sizing */}
            <Section title="Cell Sizing">
              <div>
                <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 8 }}>
                  <label style={{ fontSize: 12, color: 'var(--text-secondary)' }}>Row Height</label>
                  <span style={{ fontSize: 12, color: 'var(--accent)', fontWeight: 600, fontFamily: 'var(--font-display)' }}>
                    {rowHeight}px
                  </span>
                </div>
                <input
                  type="range"
                  min={80}
                  max={240}
                  step={8}
                  value={rowHeight}
                  onChange={e => setRowHeight(Number(e.target.value))}
                  style={{ width: '100%', accentColor: 'var(--accent)' }}
                />
                <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: 3 }}>
                  <span style={{ fontSize: 10, color: 'var(--text-muted)' }}>80px</span>
                  <span style={{ fontSize: 10, color: 'var(--text-muted)' }}>240px</span>
                </div>
              </div>

              <div>
                <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 8 }}>
                  <label style={{ fontSize: 12, color: 'var(--text-secondary)' }}>Column Width</label>
                  <span style={{ fontSize: 12, color: 'var(--accent)', fontWeight: 600, fontFamily: 'var(--font-display)' }}>
                    {colWidth}px
                  </span>
                </div>
                <input
                  type="range"
                  min={120}
                  max={320}
                  step={10}
                  value={colWidth}
                  onChange={e => setColWidth(Number(e.target.value))}
                  style={{ width: '100%', accentColor: 'var(--accent)' }}
                />
                <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: 3 }}>
                  <span style={{ fontSize: 10, color: 'var(--text-muted)' }}>120px</span>
                  <span style={{ fontSize: 10, color: 'var(--text-muted)' }}>320px</span>
                </div>
              </div>
            </Section>

          </div>

          {/* Right: live preview */}
          <div style={{
            flex: 1,
            overflowY: 'auto',
            padding: '28px 28px',
            background: 'var(--bg-base)',
          }}>
            <div style={{
              fontSize: 11,
              fontWeight: 700,
              textTransform: 'uppercase',
              letterSpacing: '0.1em',
              color: 'var(--text-muted)',
              marginBottom: 16,
            }}>
              Live Preview
            </div>
            <PreviewScaler scale={0.62}>
              <ScheduleRenderer schedule={previewSchedule} template={local} mode="view" />
            </PreviewScaler>
          </div>
        </div>

        {/* Footer */}
        <div style={{
          padding: '16px 28px',
          borderTop: '1px solid var(--border-default)',
          display: 'flex',
          gap: 8,
          justifyContent: 'flex-end',
          flexShrink: 0,
          background: 'var(--bg-surface-1)',
        }}>
          <button className="btn btn-secondary btn-sm" onClick={onClose} disabled={saving}>
            Cancel
          </button>
          <button className="btn btn-primary btn-sm" onClick={handleSave} disabled={saving}>
            {saving ? 'Saving...' : 'Save Template'}
          </button>
        </div>
      </div>
    </div>
  )
}
