'use client'

import type { Schedule, ScheduleTemplate, ScheduleAssignment, ColumnConfig, RowConfig } from '@/lib/types'

interface ScheduleRendererProps {
  schedule: Schedule
  template: ScheduleTemplate
  mode: 'view' | 'edit'
  onAssignmentChange?: (assignments: ScheduleAssignment[]) => void
}

const FONT_SIZES = {
  sm: { name: 12, meta: 10 },
  md: { name: 13, meta: 11 },
  lg: { name: 15, meta: 12 },
}

function getWeekDates(weekStart: string): string[] {
  return Array.from({ length: 7 }, (_, i) => {
    const d = new Date(weekStart)
    d.setDate(d.getDate() + i)
    return d.toISOString().split('T')[0]
  })
}

function hexWithAlpha(hex: string, alpha: number): string {
  const a = Math.round(alpha * 255).toString(16).padStart(2, '0')
  return `${hex}${a}`
}

function AssignmentCard({
  assignment,
  color,
  fontSize,
  showRole,
  showHours,
  showStartEnd,
}: {
  assignment: ScheduleAssignment
  color: string
  fontSize: { name: number; meta: number }
  showRole: boolean
  showHours: boolean
  showStartEnd: boolean
}) {
  return (
    <div style={{
      background: 'rgba(255,255,255,0.08)',
      borderRadius: 4,
      padding: '5px 7px',
      userSelect: 'none',
    }}>
      <div style={{
        fontSize: fontSize.name,
        fontWeight: 500,
        color: 'var(--text-primary)',
        lineHeight: 1.3,
        whiteSpace: 'nowrap',
        overflow: 'hidden',
        textOverflow: 'ellipsis',
      }}>
        {assignment.employee_name}
      </div>
      {showRole && (
        <div style={{
          fontSize: fontSize.meta,
          color: color,
          lineHeight: 1.2,
          marginTop: 2,
          fontWeight: 500,
          opacity: 0.85,
        }}>
          {assignment.role}
        </div>
      )}
      {(showHours || showStartEnd) && (
        <div style={{
          fontSize: fontSize.meta,
          color: 'var(--text-muted)',
          lineHeight: 1.2,
          marginTop: 1,
        }}>
          {showStartEnd
            ? `${assignment.start_time}–${assignment.end_time}`
            : `${assignment.hours}h`}
        </div>
      )}
    </div>
  )
}

function GapPill({ count }: { count: number }) {
  return (
    <div style={{
      display: 'inline-flex',
      alignItems: 'center',
      padding: '2px 8px',
      background: 'rgba(239,68,68,0.12)',
      border: '1px solid rgba(239,68,68,0.25)',
      borderRadius: 20,
      fontSize: 10,
      fontWeight: 600,
      color: '#ef4444',
      letterSpacing: '0.02em',
    }}>
      {count === 1 ? '1 gap' : `${count} gaps`}
    </div>
  )
}

function ShiftRowsDayColumns({
  schedule,
  template,
  mode,
}: {
  schedule: Schedule
  template: ScheduleTemplate
  mode: 'view' | 'edit'
}) {
  const { display_options, row_config, column_config, color_config } = template
  const fontSize = FONT_SIZES[display_options.font_size]

  const weekDates = getWeekDates(schedule.week_start)

  const visibleRows = [...row_config]
    .filter(r => r.visible)
    .sort((a, b) => a.order - b.order)

  const visibleCols = [...column_config]
    .filter(c => c.visible)
    .sort((a, b) => a.order - b.order)

  const colByDate = new Map<string, ColumnConfig>()
  weekDates.forEach(date => {
    const dayOfWeek = new Date(date).getDay()
    const col = visibleCols.find(c => c.day === dayOfWeek)
    if (col) colByDate.set(date, col)
  })

  const assignments = schedule.data?.assignments ?? []
  const gaps = schedule.data?.gaps ?? []

  const assignmentMap = new Map<string, ScheduleAssignment[]>()
  for (const a of assignments) {
    const key = `${a.shift_name}||${a.date}`
    if (!assignmentMap.has(key)) assignmentMap.set(key, [])
    assignmentMap.get(key)!.push(a)
  }

  // gap lookup: shiftName+date -> unfilled count (summed across roles if multiple)
  const gapMap = new Map<string, number>()
  for (const g of gaps) {
    const key = `${g.shift_name}||${g.date}`
    const unfilled = g.required_count - g.filled_count
    if (unfilled > 0) gapMap.set(key, (gapMap.get(key) ?? 0) + unfilled)
  }

  const orderedDates = visibleCols
    .map(col => weekDates.find(d => new Date(d).getDay() === col.day))
    .filter((d): d is string => d !== undefined)

  const LABEL_COL_WIDTH = 110
  const MIN_ROW_HEIGHT = 80
  const MIN_COL_WIDTH = 120

  const getColor = (col: ColumnConfig, row: RowConfig): string => {
    if (color_config.by === 'day') return col.color
    if (color_config.by === 'shift') return color_config.map[row.id] ?? col.color
    return col.color
  }

  return (
    <div style={{ overflowX: 'auto', width: '100%' }}>
      <div style={{
        display: 'grid',
        gridTemplateColumns: `${LABEL_COL_WIDTH}px ${orderedDates.map(d => {
          const col = colByDate.get(d)
          return `${Math.max(col?.width ?? 180, MIN_COL_WIDTH)}px`
        }).join(' ')}`,
        minWidth: LABEL_COL_WIDTH + orderedDates.length * MIN_COL_WIDTH,
      }}>

        {/* Top-left corner */}
        <div style={{
          position: 'sticky', left: 0, zIndex: 10,
          background: 'var(--bg-surface-2)',
          borderBottom: '1px solid var(--border-default)',
          borderRight: '1px solid var(--border-default)',
        }} />

        {/* Day headers */}
        {orderedDates.map(date => {
          const col = colByDate.get(date)!
          return (
            <div key={date} style={{
              background: col.color,
              borderBottom: '1px solid var(--border-default)',
              borderRight: '1px solid var(--border-subtle)',
              padding: '10px 12px',
              textAlign: 'center',
            }}>
              <div style={{
                fontFamily: 'var(--font-display)',
                fontSize: 11, fontWeight: 800,
                letterSpacing: '0.12em',
                color: 'rgba(255,255,255,0.75)',
                textTransform: 'uppercase', lineHeight: 1,
              }}>
                {col.label.slice(0, 3).toUpperCase()}
              </div>
              <div style={{
                fontFamily: 'var(--font-display)',
                fontSize: 15, fontWeight: 800,
                color: '#ffffff', lineHeight: 1, marginTop: 3,
              }}>
                {new Date(date).getDate()}
              </div>
            </div>
          )
        })}

        {/* Data rows */}
        {visibleRows.map(row => {
          const rowHeight = Math.max(row.height, MIN_ROW_HEIGHT)

          return [
            // Sticky row label
            <div key={`label-${row.id}`} style={{
              position: 'sticky', left: 0, zIndex: 5,
              background: 'var(--bg-surface-2)',
              borderBottom: '1px solid var(--border-subtle)',
              borderRight: '1px solid var(--border-default)',
              padding: '10px 12px',
              display: 'flex', alignItems: 'flex-start',
              minHeight: rowHeight,
            }}>
              <span style={{
                fontFamily: 'var(--font-display)',
                fontSize: 11, fontWeight: 700,
                color: 'var(--text-secondary)',
                letterSpacing: '0.08em',
                writingMode: 'vertical-rl',
                textOrientation: 'mixed',
                transform: 'rotate(180deg)',
                whiteSpace: 'nowrap',
              }}>
                {row.label}
              </span>
            </div>,

            // Data cells
            ...orderedDates.map(date => {
              const col = colByDate.get(date)!
              const cellKey = `${row.id}||${date}`
              const cellAssignments = assignmentMap.get(cellKey) ?? []
              const gapCount = gapMap.get(cellKey) ?? 0
              const color = getColor(col, row)
              const isEmpty = cellAssignments.length === 0 && gapCount === 0

              return (
                <div key={`cell-${row.id}-${date}`} style={{
                  borderBottom: '1px solid var(--border-subtle)',
                  borderRight: '1px solid var(--border-subtle)',
                  padding: 8,
                  minHeight: rowHeight,
                  overflowY: 'auto',
                  background: isEmpty ? 'var(--bg-base)' : hexWithAlpha(color, 0.06),
                  outline: mode === 'edit' ? '1px solid rgba(99,102,241,0.25)' : undefined,
                  display: 'flex',
                  flexDirection: 'column',
                  gap: 4,
                }}>
                  {isEmpty ? (
                    <div style={{
                      flex: 1,
                      border: '1px dashed var(--border-subtle)',
                      borderRadius: 4,
                      minHeight: 32,
                    }} />
                  ) : (
                    <>
                      {cellAssignments.map((a, j) => (
                        <AssignmentCard
                          key={`${a.employee_id}-${j}`}
                          assignment={a}
                          color={color}
                          fontSize={fontSize}
                          showRole={display_options.show_role}
                          showHours={display_options.show_hours}
                          showStartEnd={display_options.show_start_end}
                        />
                      ))}
                      {gapCount > 0 && <GapPill count={gapCount} />}
                    </>
                  )}
                </div>
              )
            }),
          ]
        })}
      </div>
    </div>
  )
}

export default function ScheduleRenderer({ schedule, template, mode, onAssignmentChange }: ScheduleRendererProps) {
  void onAssignmentChange

  const containerStyle: React.CSSProperties = {
    background: 'var(--bg-surface-1)',
    border: '1px solid var(--border-default)',
    borderRadius: 'var(--radius-lg)',
    overflow: 'hidden',
  }

  if (template.layout_type === 'shift-rows-day-columns') {
    return (
      <div style={containerStyle}>
        <ShiftRowsDayColumns schedule={schedule} template={template} mode={mode} />
      </div>
    )
  }

  return (
    <div style={{ ...containerStyle, padding: '48px 24px', textAlign: 'center' }}>
      <div style={{ fontSize: 13, color: 'var(--text-muted)' }}>
        Layout type <code>{template.layout_type}</code> is not yet supported.
      </div>
    </div>
  )
}
