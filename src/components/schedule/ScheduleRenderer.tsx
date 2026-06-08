'use client'

import { useState } from 'react'
import {
  DndContext,
  DragOverlay,
  PointerSensor,
  useSensor,
  useSensors,
  useDraggable,
  useDroppable,
  type DragEndEvent,
  type DragStartEvent,
} from '@dnd-kit/core'
import type { Schedule, ScheduleTemplate, ScheduleAssignment, ColumnConfig, RowConfig } from '@/lib/types'
import { parseYMD, toYMD } from '@/lib/utils/dates'
import { resolveAssignmentForSlot } from '@/lib/schedule/resolveAssignment'

interface ScheduleRendererProps {
  schedule: Schedule
  template: ScheduleTemplate
  mode: 'view' | 'edit'
  removeMode?: boolean
  pendingAssignments?: ScheduleAssignment[]
  onAssignmentChange?: (assignments: ScheduleAssignment[]) => void
  closedDates?: string[]
  onCloseDay?: (date: string) => void
  onReopenDay?: (date: string) => void
}

const FONT_SIZES = {
  sm: { name: 12, meta: 10 },
  md: { name: 13, meta: 11 },
  lg: { name: 15, meta: 12 },
}

function getWeekDates(weekStart: string): string[] {
  const start = parseYMD(weekStart)
  return Array.from({ length: 7 }, (_, i) => {
    const d = new Date(start.getFullYear(), start.getMonth(), start.getDate() + i)
    return toYMD(d)
  })
}

function hexWithAlpha(hex: string, alpha: number): string {
  const a = Math.round(alpha * 255).toString(16).padStart(2, '0')
  return `${hex}${a}`
}

function assignmentDragId(a: ScheduleAssignment): string {
  return `${a.employee_id}||${a.shift_name}||${a.date}`
}

function cellDropId(shiftName: string, date: string): string {
  return `cell::${shiftName}||${date}`
}

// ── AssignmentCard ────────────────────────────────────────────────────────────

function AssignmentCardContent({
  assignment,
  color,
  fontSize,
  showRole,
  showHours,
  showStartEnd,
  removeMode,
}: {
  assignment: ScheduleAssignment
  color: string
  fontSize: { name: number; meta: number }
  showRole: boolean
  showHours: boolean
  showStartEnd: boolean
  removeMode?: boolean
}) {
  return (
    <div style={{
      background: 'rgba(255,255,255,0.08)',
      borderRadius: 4,
      padding: '5px 7px',
      userSelect: 'none',
      position: 'relative',
      border: removeMode ? '1px solid rgba(239,68,68,0.4)' : undefined,
    }}>
      {removeMode && (
        <div style={{
          position: 'absolute',
          top: 3,
          right: 4,
          width: 14,
          height: 14,
          borderRadius: '50%',
          background: '#ef4444',
          color: '#fff',
          fontSize: 10,
          fontWeight: 700,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          lineHeight: 1,
        }}>
          ×
        </div>
      )}
      <div style={{
        fontSize: fontSize.name,
        fontWeight: 500,
        color: 'var(--text-primary)',
        lineHeight: 1.3,
        whiteSpace: 'nowrap',
        overflow: 'hidden',
        textOverflow: 'ellipsis',
        paddingRight: removeMode ? 16 : 0,
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

function DraggableAssignmentCard({
  assignment,
  color,
  fontSize,
  showRole,
  showHours,
  showStartEnd,
  removeMode,
  onRemove,
}: {
  assignment: ScheduleAssignment
  color: string
  fontSize: { name: number; meta: number }
  showRole: boolean
  showHours: boolean
  showStartEnd: boolean
  removeMode: boolean
  onRemove: () => void
}) {
  const id = assignmentDragId(assignment)
  const { attributes, listeners, setNodeRef, isDragging } = useDraggable({
    id,
    data: { assignment },
    disabled: removeMode,
  })

  const handleClick = () => {
    if (removeMode) onRemove()
  }

  return (
    <div
      ref={setNodeRef}
      onClick={handleClick}
      style={{
        cursor: removeMode ? 'pointer' : 'grab',
        opacity: isDragging ? 0.3 : 1,
        touchAction: 'none',
      }}
      {...listeners}
      {...attributes}
    >
      <AssignmentCardContent
        assignment={assignment}
        color={color}
        fontSize={fontSize}
        showRole={showRole}
        showHours={showHours}
        showStartEnd={showStartEnd}
        removeMode={removeMode}
      />
    </div>
  )
}

function StaticAssignmentCard(props: {
  assignment: ScheduleAssignment
  color: string
  fontSize: { name: number; meta: number }
  showRole: boolean
  showHours: boolean
  showStartEnd: boolean
}) {
  return <AssignmentCardContent {...props} />
}

// ── DroppableCell ─────────────────────────────────────────────────────────────

function DroppableCell({
  shiftName,
  date,
  rowHeight,
  baseBackground,
  enabled,
  editing,
  closed,
  children,
}: {
  shiftName: string
  date: string
  rowHeight: number
  baseBackground: string
  enabled: boolean
  editing: boolean
  closed: boolean
  children: React.ReactNode
}) {
  const { setNodeRef, isOver } = useDroppable({
    id: cellDropId(shiftName, date),
    data: { shift_name: shiftName, date },
    disabled: !enabled,
  })

  return (
    <div
      ref={setNodeRef}
      style={{
        borderBottom: '1px solid var(--border-subtle)',
        borderRight: '1px solid var(--border-subtle)',
        padding: 8,
        minHeight: rowHeight,
        overflowY: 'auto',
        background: closed ? 'rgba(107,114,128,0.08)' : baseBackground,
        outline: enabled && isOver
          ? '2px solid #60a5fa'
          : editing
            ? '1px solid rgba(99,102,241,0.25)'
            : undefined,
        outlineOffset: enabled && isOver ? -2 : 0,
        display: 'flex',
        flexDirection: 'column',
        gap: 4,
        transition: 'outline 0.15s, background 0.15s',
        position: 'relative',
      }}
    >
      {closed && (
        <div style={{
          position: 'absolute',
          inset: 0,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          pointerEvents: 'none',
          fontFamily: 'var(--font-display)',
          fontWeight: 800,
          fontSize: 16,
          letterSpacing: '0.25em',
          color: 'rgba(239,68,68,0.18)',
          textTransform: 'uppercase',
          zIndex: 0,
        }}>
          CLOSED
        </div>
      )}
      <div style={{
        position: 'relative',
        zIndex: 1,
        display: 'flex',
        flexDirection: 'column',
        gap: 4,
        flex: 1,
        opacity: closed ? 0.4 : 1,
        pointerEvents: closed ? 'none' : undefined,
      }}>
        {children}
      </div>
    </div>
  )
}

function DayHeader({
  date,
  label,
  color,
  closed,
  onCloseDay,
  onReopenDay,
}: {
  date: string
  label: string
  color: string
  closed: boolean
  onCloseDay?: (date: string) => void
  onReopenDay?: (date: string) => void
}) {
  const [hovered, setHovered] = useState(false)

  return (
    <div
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      style={{
        background: closed ? '#4b5563' : color,
        borderBottom: '1px solid var(--border-default)',
        borderRight: '1px solid var(--border-subtle)',
        padding: '10px 12px 8px',
        textAlign: 'center',
        minHeight: 78,
        position: 'relative',
      }}>
      <div style={{
        fontFamily: 'var(--font-display)',
        fontSize: 11, fontWeight: 800,
        letterSpacing: '0.12em',
        color: 'rgba(255,255,255,0.75)',
        textTransform: 'uppercase', lineHeight: 1,
      }}>
        {label.slice(0, 3).toUpperCase()}
      </div>
      <div style={{
        fontFamily: 'var(--font-display)',
        fontSize: 15, fontWeight: 800,
        color: '#ffffff', lineHeight: 1, marginTop: 3,
      }}>
        {parseYMD(date).getDate()}
      </div>
      {closed ? (
        <div style={{ marginTop: 6, display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 4 }}>
          <span style={{
            display: 'inline-block',
            padding: '1px 7px',
            borderRadius: 'var(--radius-pill)',
            fontSize: 9,
            fontWeight: 700,
            letterSpacing: '0.1em',
            textTransform: 'uppercase',
            background: 'rgba(239,68,68,0.18)',
            border: '1px solid rgba(239,68,68,0.5)',
            color: '#fecaca',
          }}>
            Closed
          </span>
          {onReopenDay && (
            <button
              type="button"
              onClick={() => onReopenDay(date)}
              style={{
                background: 'transparent',
                border: 'none',
                color: '#86efac',
                fontSize: 10,
                cursor: 'pointer',
                padding: 0,
                fontFamily: 'var(--font-body)',
                fontWeight: 500,
              }}
            >
              Reopen Day
            </button>
          )}
        </div>
      ) : (
        onCloseDay && (
          <div style={{ marginTop: 6, height: 12 }}>
            <button
              type="button"
              onClick={() => onCloseDay(date)}
              style={{
                background: 'transparent',
                border: 'none',
                color: '#fca5a5',
                fontSize: 10,
                cursor: 'pointer',
                padding: 0,
                fontFamily: 'var(--font-body)',
                fontWeight: 500,
                opacity: hovered ? 1 : 0,
                transition: 'opacity 150ms',
              }}
            >
              Close Day
            </button>
          </div>
        )
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

// ── ShiftRowsDayColumns ───────────────────────────────────────────────────────

function ShiftRowsDayColumns({
  schedule,
  template,
  mode,
  removeMode,
  pendingAssignments,
  onAssignmentChange,
  closedDates,
  onCloseDay,
  onReopenDay,
}: {
  schedule: Schedule
  template: ScheduleTemplate
  mode: 'view' | 'edit'
  removeMode: boolean
  pendingAssignments?: ScheduleAssignment[]
  onAssignmentChange?: (assignments: ScheduleAssignment[]) => void
  closedDates: string[]
  onCloseDay?: (date: string) => void
  onReopenDay?: (date: string) => void
}) {
  const closedDateSet = new Set(closedDates)
  const { display_options, row_config, column_config, color_config } = template
  const fontSize = FONT_SIZES[display_options.font_size]
  const editing = mode === 'edit'

  const assignments = editing
    ? (pendingAssignments ?? schedule.data?.assignments ?? [])
    : (schedule.data?.assignments ?? [])

  const [activeAssignment, setActiveAssignment] = useState<ScheduleAssignment | null>(null)

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 4 } }),
  )

  const weekDates = getWeekDates(schedule.week_start)

  const visibleRows = [...row_config]
    .filter(r => r.visible)
    .sort((a, b) => a.order - b.order)

  const visibleCols = [...column_config]
    .filter(c => c.visible)
    .sort((a, b) => a.order - b.order)

  const colByDate = new Map<string, ColumnConfig>()
  weekDates.forEach(date => {
    const dayOfWeek = parseYMD(date).getDay()
    const col = visibleCols.find(c => c.day === dayOfWeek)
    if (col) colByDate.set(date, col)
  })

  const gaps = schedule.data?.gaps ?? []

  const assignmentMap = new Map<string, ScheduleAssignment[]>()
  for (const a of assignments) {
    const key = `${a.shift_name}||${a.date}`
    if (!assignmentMap.has(key)) assignmentMap.set(key, [])
    assignmentMap.get(key)!.push(a)
  }

  // gap lookup: shiftName+date -> unfilled count (only meaningful for the original schedule)
  const gapMap = new Map<string, number>()
  if (!editing) {
    for (const g of gaps) {
      const key = `${g.shift_name}||${g.date}`
      const unfilled = g.required_count - g.filled_count
      if (unfilled > 0) gapMap.set(key, (gapMap.get(key) ?? 0) + unfilled)
    }
  }

  const orderedDates = visibleCols
    .map(col => weekDates.find(d => parseYMD(d).getDay() === col.day))
    .filter((d): d is string => d !== undefined)

  const LABEL_COL_WIDTH = 110
  const MIN_ROW_HEIGHT = 80
  const MIN_COL_WIDTH = 120

  const getColor = (col: ColumnConfig, row: RowConfig): string => {
    if (color_config.by === 'day') return col.color
    if (color_config.by === 'shift') return color_config.map[row.id] ?? col.color
    return col.color
  }

  function moveAssignment(source: ScheduleAssignment, targetShift: string, targetDate: string) {
    if (!onAssignmentChange) return
    if (source.shift_name === targetShift && source.date === targetDate) return

    let moved = false
    const next = assignments.map(a => {
      if (
        !moved &&
        a.employee_id === source.employee_id &&
        a.shift_name === source.shift_name &&
        a.date === source.date
      ) {
        moved = true
        return resolveAssignmentForSlot(a, targetShift, targetDate, assignments)
      }
      return a
    })
    if (moved) onAssignmentChange(next)
  }

  function removeAssignment(target: ScheduleAssignment) {
    if (!onAssignmentChange) return
    let removed = false
    const next = assignments.filter(a => {
      if (
        !removed &&
        a.employee_id === target.employee_id &&
        a.shift_name === target.shift_name &&
        a.date === target.date
      ) {
        removed = true
        return false
      }
      return true
    })
    if (removed) onAssignmentChange(next)
  }

  function handleDragStart(e: DragStartEvent) {
    const a = e.active.data.current?.assignment as ScheduleAssignment | undefined
    if (a) setActiveAssignment(a)
  }

  function handleDragEnd(e: DragEndEvent) {
    setActiveAssignment(null)
    const source = e.active.data.current?.assignment as ScheduleAssignment | undefined
    const over = e.over?.data.current as { shift_name?: string; date?: string } | undefined
    if (!source || !over?.shift_name || !over?.date) return
    moveAssignment(source, over.shift_name, over.date)
  }

  const grid = (
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
            <DayHeader
              key={date}
              date={date}
              label={col.label}
              color={col.color}
              closed={closedDateSet.has(date)}
              onCloseDay={onCloseDay}
              onReopenDay={onReopenDay}
            />
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
              const baseBackground = isEmpty ? 'var(--bg-base)' : hexWithAlpha(color, 0.06)
              const closed = closedDateSet.has(date)

              return (
                <DroppableCell
                  key={`cell-${row.id}-${date}`}
                  shiftName={row.id}
                  date={date}
                  rowHeight={rowHeight}
                  baseBackground={baseBackground}
                  enabled={editing && !removeMode && !closed}
                  editing={editing}
                  closed={closed}
                >
                  {isEmpty ? (
                    <div style={{
                      flex: 1,
                      border: '1px dashed var(--border-subtle)',
                      borderRadius: 4,
                      minHeight: 32,
                    }} />
                  ) : (
                    <>
                      {cellAssignments.map((a, j) => editing ? (
                        <DraggableAssignmentCard
                          key={`${assignmentDragId(a)}-${j}`}
                          assignment={a}
                          color={color}
                          fontSize={fontSize}
                          showRole={display_options.show_role}
                          showHours={display_options.show_hours}
                          showStartEnd={display_options.show_start_end}
                          removeMode={removeMode}
                          onRemove={() => removeAssignment(a)}
                        />
                      ) : (
                        <StaticAssignmentCard
                          key={`${assignmentDragId(a)}-${j}`}
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
                </DroppableCell>
              )
            }),
          ]
        })}
      </div>
    </div>
  )

  if (!editing) {
    return grid
  }

  return (
    <DndContext sensors={sensors} onDragStart={handleDragStart} onDragEnd={handleDragEnd}>
      {grid}
      <DragOverlay dropAnimation={null}>
        {activeAssignment && (
          <div style={{
            opacity: 0.85,
            transform: 'rotate(-1deg)',
            boxShadow: '0 8px 20px rgba(0,0,0,0.35)',
            borderRadius: 4,
            background: hexWithAlpha('#60a5fa', 0.18),
            border: '1px solid rgba(96,165,250,0.5)',
            padding: 0,
            pointerEvents: 'none',
          }}>
            <AssignmentCardContent
              assignment={activeAssignment}
              color="#60a5fa"
              fontSize={fontSize}
              showRole={display_options.show_role}
              showHours={display_options.show_hours}
              showStartEnd={display_options.show_start_end}
            />
          </div>
        )}
      </DragOverlay>
    </DndContext>
  )
}

export default function ScheduleRenderer({
  schedule,
  template,
  mode,
  removeMode = false,
  pendingAssignments,
  onAssignmentChange,
  closedDates,
  onCloseDay,
  onReopenDay,
}: ScheduleRendererProps) {
  const containerStyle: React.CSSProperties = {
    background: 'var(--bg-surface-1)',
    border: '1px solid var(--border-default)',
    borderRadius: 'var(--radius-lg)',
    overflow: 'hidden',
  }

  const resolvedClosedDates = closedDates ?? schedule.data?.closed_dates ?? []

  if (template.layout_type === 'shift-rows-day-columns') {
    return (
      <div style={containerStyle}>
        <ShiftRowsDayColumns
          schedule={schedule}
          template={template}
          mode={mode}
          removeMode={removeMode}
          pendingAssignments={pendingAssignments}
          onAssignmentChange={onAssignmentChange}
          closedDates={resolvedClosedDates}
          onCloseDay={onCloseDay}
          onReopenDay={onReopenDay}
        />
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
