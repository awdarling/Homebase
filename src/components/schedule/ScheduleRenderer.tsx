'use client'

import { useState, useEffect, useRef } from 'react'
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
import { resolveCellAppearance, hexWithAlpha } from '@/lib/schedule/resolveCellAppearance'
import { layoutLabel } from '@/lib/schedule/templateLayouts'
import { buildEmployeeRowModel, buildRoleRowModel, applyAltMove } from '@/lib/schedule/layoutGrids'
import { compareByRoleThenName } from '@/lib/schedule/cellOrder'
import { VetBadge } from '@/components/common/VetBadge'

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
  /** Employee ids flagged as veterans — drives the "VET" name badge. */
  veteranIds?: Set<string>
  /** Shift NAME → short veteran-rule label (e.g. "Veterans only", "≥2 veterans"). Whole-week rules only. */
  shiftRuleLabels?: Record<string, string>
  /** Shift NAME → plain-English notes for day-scoped rules (e.g. "Veterans only on Saturdays & Sundays"), shown behind an expandable marker. */
  shiftRuleNotes?: Record<string, string[]>
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

function assignmentDragId(a: ScheduleAssignment): string {
  return `${a.employee_id}||${a.shift_name}||${a.date}`
}

function cellDropId(shiftName: string, date: string): string {
  return `cell::${shiftName}||${date}`
}

// ── Veteran indicators ────────────────────────────────────────────────────────
// VetBadge is the shared component (src/components/common/VetBadge.tsx) so the
// schedule grid and the employees/data tab show the exact same orange badge.

function ShiftRuleTag({ label }: { label: string }) {
  return (
    <span style={{
      display: 'inline-flex',
      alignItems: 'center',
      padding: '1px 6px',
      borderRadius: 'var(--radius-pill)',
      background: 'var(--accent-dim)',
      border: '1px solid var(--accent-border)',
      color: 'var(--accent)',
      fontSize: 9,
      fontWeight: 700,
      letterSpacing: '0.04em',
      lineHeight: 1.3,
      whiteSpace: 'nowrap',
    }}>
      {label}
    </span>
  )
}

// A compact "Rules ▾" marker shown on a shift row that has day-scoped veteran
// rules (e.g. Afternoon = veterans only on Sat & Sun). Clicking it expands a
// small plain-English note, so the row itself is never badged as if the rule
// ran all week. Whole-week rules use ShiftRuleTag instead.
function ShiftRuleNoteMarker({ notes }: { notes: string[] }) {
  const [open, setOpen] = useState(false)
  const ref = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!open) return
    function onDocClick(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false)
    }
    document.addEventListener('mousedown', onDocClick)
    return () => document.removeEventListener('mousedown', onDocClick)
  }, [open])

  return (
    <div ref={ref} style={{ position: 'relative', display: 'inline-flex' }}>
      <button
        type="button"
        onClick={(e) => { e.stopPropagation(); setOpen(o => !o) }}
        aria-label="View veteran rules for this shift"
        title="View veteran rules for this shift"
        style={{
          display: 'inline-flex', alignItems: 'center', gap: 3,
          padding: '1px 6px',
          borderRadius: 'var(--radius-pill)',
          background: 'var(--accent-dim)',
          border: '1px solid var(--accent-border)',
          color: 'var(--accent)',
          fontSize: 9, fontWeight: 800, letterSpacing: '0.04em',
          lineHeight: 1.3, whiteSpace: 'nowrap', cursor: 'pointer',
          textTransform: 'uppercase',
        }}
      >
        Rules
        <span style={{ fontSize: 8 }}>{open ? '▴' : '▾'}</span>
      </button>
      {open && (
        <div
          role="tooltip"
          style={{
            position: 'absolute',
            left: '100%', top: 0, marginLeft: 6,
            zIndex: 30,
            width: 188,
            padding: '8px 10px',
            background: 'var(--bg-surface-3)',
            border: '1px solid var(--accent-border)',
            borderRadius: 'var(--radius-md)',
            boxShadow: '0 6px 20px rgba(0,0,0,0.35)',
            textAlign: 'left',
            writingMode: 'horizontal-tb',
          }}
        >
          <div style={{
            fontSize: 9, fontWeight: 800, letterSpacing: '0.06em',
            textTransform: 'uppercase', color: 'var(--accent)', marginBottom: 4,
          }}>
            Veteran rule{notes.length === 1 ? '' : 's'}
          </div>
          {notes.map((n, i) => (
            <div key={i} style={{
              fontSize: 11, lineHeight: 1.45, color: 'var(--text-secondary)',
              marginTop: i === 0 ? 0 : 4,
            }}>
              {n}
            </div>
          ))}
        </div>
      )}
    </div>
  )
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
  isVeteran,
}: {
  assignment: ScheduleAssignment
  color: string
  fontSize: { name: number; meta: number }
  showRole: boolean
  showHours: boolean
  showStartEnd: boolean
  removeMode?: boolean
  isVeteran?: boolean
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
        display: 'flex',
        alignItems: 'center',
        gap: 5,
        lineHeight: 1.3,
        paddingRight: removeMode ? 16 : 0,
      }}>
        <span style={{
          fontSize: fontSize.name,
          fontWeight: 500,
          color: 'var(--text-primary)',
          whiteSpace: 'nowrap',
          overflow: 'hidden',
          textOverflow: 'ellipsis',
        }}>
          {assignment.employee_name}
        </span>
        {isVeteran && <VetBadge />}
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
  isVeteran,
}: {
  assignment: ScheduleAssignment
  color: string
  fontSize: { name: number; meta: number }
  showRole: boolean
  showHours: boolean
  showStartEnd: boolean
  removeMode: boolean
  onRemove: () => void
  isVeteran?: boolean
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
        isVeteran={isVeteran}
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
  isVeteran?: boolean
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
  veteranIds,
  shiftRuleLabels,
  shiftRuleNotes,
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
  veteranIds?: Set<string>
  shiftRuleLabels?: Record<string, string>
  shiftRuleNotes?: Record<string, string[]>
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
  // #9: order each cell by role then name, matching the download + emailed grid.
  for (const list of Array.from(assignmentMap.values())) list.sort(compareByRoleThenName)

  // gap lookup: shiftName+date -> unfilled count (only meaningful for the original schedule)
  const gapMap = new Map<string, number>()
  if (!editing) {
    for (const g of gaps) {
      const key = `${g.shift_name}||${g.date}`
      const unfilled = g.required_count - g.filled_count
      if (unfilled > 0) gapMap.set(key, (gapMap.get(key) ?? 0) + unfilled)
    }
  }

  // Special-event shifts (item 6): one-off shifts the engine added for a date
  // (e.g. a Swim Meet) live in the assignments/gaps but are NOT template rows —
  // so without this they're invisible on the grid. Surface every shift name that
  // appears in the schedule but has no template row as its own row, so the
  // manager sees exactly what's scheduled (and what staff get on distribution).
  const templateRowIds = new Set(row_config.map(r => r.id))
  const eventRowNames: string[] = []
  const seenEventRow = new Set<string>()
  for (const a of assignments) {
    if (!templateRowIds.has(a.shift_name) && !seenEventRow.has(a.shift_name)) {
      seenEventRow.add(a.shift_name); eventRowNames.push(a.shift_name)
    }
  }
  for (const g of gaps) {
    if (!templateRowIds.has(g.shift_name) && !seenEventRow.has(g.shift_name)) {
      seenEventRow.add(g.shift_name); eventRowNames.push(g.shift_name)
    }
  }
  const eventRows: RowConfig[] = eventRowNames.map((name, i) => ({
    id: name, label: name, height: 80, visible: true, order: 100000 + i,
  }))
  const allRows = [...visibleRows, ...eventRows]

  const orderedDates = visibleCols
    .map(col => weekDates.find(d => parseYMD(d).getDay() === col.day))
    .filter((d): d is string => d !== undefined)

  const LABEL_COL_WIDTH = 110
  const MIN_ROW_HEIGHT = 80
  const MIN_COL_WIDTH = 120

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

        {/* Data rows (template rows + any special-event shift rows) */}
        {allRows.map(row => {
          const rowHeight = Math.max(row.height, MIN_ROW_HEIGHT)

          return [
            // Sticky row label
            <div key={`label-${row.id}`} style={{
              position: 'sticky', left: 0, zIndex: 5,
              background: 'var(--bg-surface-2)',
              borderBottom: '1px solid var(--border-subtle)',
              borderRight: '1px solid var(--border-default)',
              padding: '10px 12px',
              display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 6,
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
              {shiftRuleLabels?.[row.id] && (
                <ShiftRuleTag label={shiftRuleLabels[row.id]} />
              )}
              {shiftRuleNotes?.[row.id]?.length ? (
                <ShiftRuleNoteMarker notes={shiftRuleNotes[row.id]} />
              ) : null}
            </div>,

            // Data cells
            ...orderedDates.map(date => {
              const col = colByDate.get(date)!
              const cellKey = `${row.id}||${date}`
              const cellAssignments = assignmentMap.get(cellKey) ?? []
              const gapCount = gapMap.get(cellKey) ?? 0
              const isEmpty = cellAssignments.length === 0 && gapCount === 0
              // Shared resolver — same color logic the download renderers use.
              // Closed background is owned by DroppableCell below (unchanged), so
              // we classify only empty vs. non-empty here; the resolved color and
              // tinted background match the previous inline output exactly.
              const appearance = resolveCellAppearance({
                colorConfig: color_config,
                columnColor: col.color,
                rowId: row.id,
                kind: isEmpty ? 'empty' : 'filled',
              })
              const color = appearance.color
              const baseBackground = appearance.background
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
                          isVeteran={veteranIds?.has(a.employee_id) ?? false}
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
                          isVeteran={veteranIds?.has(a.employee_id) ?? false}
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
              isVeteran={veteranIds?.has(activeAssignment.employee_id) ?? false}
            />
          </div>
        )}
      </DragOverlay>
    </DndContext>
  )
}

// ── Alternate layouts: employee-rows + role-rows ──────────────────────────────
// Re-pivot the same assignments via the pure layoutGrids model. These render in
// BOTH view and edit, so a manager edits in exactly the layout that goes out.
// Drag/drop reuses the same DroppableCell + onAssignmentChange flow as the
// shift-rows grid, so save + Soteria validation are identical.

// Chip for the employee-rows layout — headlines the SHIFT (the row is already
// the person), mirroring AssignmentCardContent's styling.
function AltShiftChip({
  assignment, color, fontSize, showRole, showHours, showStartEnd,
}: {
  assignment: ScheduleAssignment
  color: string
  fontSize: { name: number; meta: number }
  showRole: boolean
  showHours: boolean
  showStartEnd: boolean
}) {
  return (
    <div style={{ background: 'rgba(255,255,255,0.08)', borderRadius: 4, padding: '5px 7px', userSelect: 'none' }}>
      <div style={{
        fontSize: fontSize.name, fontWeight: 500, color: 'var(--text-primary)',
        whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', lineHeight: 1.3,
      }}>
        {assignment.shift_name}
      </div>
      {showRole && (
        <div style={{ fontSize: fontSize.meta, color, lineHeight: 1.2, marginTop: 2, fontWeight: 500, opacity: 0.85 }}>
          {assignment.role}
        </div>
      )}
      {(showHours || showStartEnd) && (
        <div style={{ fontSize: fontSize.meta, color: 'var(--text-muted)', lineHeight: 1.2, marginTop: 1 }}>
          {showStartEnd ? `${assignment.start_time}–${assignment.end_time}` : `${assignment.hours}h`}
        </div>
      )}
    </div>
  )
}

// Draggable wrapper for the alternate layouts (edit mode). Headlines the shift
// for employee-rows, the person for role-rows; click-to-remove in remove mode.
function DraggableAltCard({
  assignment, rowKind, color, fontSize, display, removeMode, onRemove, isVeteran,
}: {
  assignment: ScheduleAssignment
  rowKind: 'employee' | 'role'
  color: string
  fontSize: { name: number; meta: number }
  display: ScheduleTemplate['display_options']
  removeMode: boolean
  onRemove: () => void
  isVeteran?: boolean
}) {
  const id = assignmentDragId(assignment)
  const { attributes, listeners, setNodeRef, isDragging } = useDraggable({ id, data: { assignment }, disabled: removeMode })
  return (
    <div
      ref={setNodeRef}
      onClick={() => { if (removeMode) onRemove() }}
      style={{
        cursor: removeMode ? 'pointer' : 'grab', opacity: isDragging ? 0.3 : 1, touchAction: 'none',
        borderRadius: 4, border: removeMode ? '1px solid rgba(239,68,68,0.4)' : undefined,
      }}
      {...listeners}
      {...attributes}
    >
      {rowKind === 'role' ? (
        <AssignmentCardContent assignment={assignment} color={color} fontSize={fontSize} showRole={false} showHours={display.show_hours} showStartEnd={display.show_start_end} removeMode={removeMode} isVeteran={isVeteran} />
      ) : (
        <AltShiftChip assignment={assignment} color={color} fontSize={fontSize} showRole={display.show_role} showHours={display.show_hours} showStartEnd={display.show_start_end} />
      )}
    </div>
  )
}

function AltLayoutGrid({
  schedule, template, rowKind, closedDates, veteranIds,
  mode, removeMode = false, pendingAssignments, onAssignmentChange,
}: {
  schedule: Schedule
  template: ScheduleTemplate
  rowKind: 'employee' | 'role'
  closedDates: string[]
  veteranIds?: Set<string>
  mode: 'view' | 'edit'
  removeMode?: boolean
  pendingAssignments?: ScheduleAssignment[]
  onAssignmentChange?: (assignments: ScheduleAssignment[]) => void
}) {
  const editing = mode === 'edit'
  const { display_options, column_config, color_config } = template
  const fontSize = FONT_SIZES[display_options.font_size]
  const closedDateSet = new Set(closedDates)
  const assignments = editing
    ? (pendingAssignments ?? schedule.data?.assignments ?? [])
    : (schedule.data?.assignments ?? [])
  const weekDates = getWeekDates(schedule.week_start)

  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 4 } }))
  const [activeAssignment, setActiveAssignment] = useState<ScheduleAssignment | null>(null)

  const visibleCols = [...column_config].filter(c => c.visible).sort((a, b) => a.order - b.order)
  const colByDate = new Map<string, ColumnConfig>()
  weekDates.forEach(date => {
    const dow = parseYMD(date).getDay()
    const col = visibleCols.find(c => c.day === dow)
    if (col) colByDate.set(date, col)
  })
  const orderedDates = visibleCols
    .map(col => weekDates.find(d => parseYMD(d).getDay() === col.day))
    .filter((d): d is string => d !== undefined)

  const rows = rowKind === 'employee' ? buildEmployeeRowModel(assignments) : buildRoleRowModel(assignments)
  const nameById = new Map<string, string>()
  for (const a of assignments) if (a.employee_id && !nameById.has(a.employee_id)) nameById.set(a.employee_id, a.employee_name)

  const LABEL_COL_WIDTH = 140
  const MIN_ROW_HEIGHT = 64
  const MIN_COL_WIDTH = 120

  function removeAssignment(target: ScheduleAssignment) {
    if (!onAssignmentChange) return
    let removed = false
    const next = assignments.filter(a => {
      if (!removed && a.employee_id === target.employee_id && a.shift_name === target.shift_name && a.date === target.date && a.role === target.role) {
        removed = true; return false
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
    // DroppableCell carries the row identity in `shift_name` (= row.id here).
    const over = e.over?.data.current as { shift_name?: string; date?: string } | undefined
    if (!source || !over?.shift_name || !over?.date || !onAssignmentChange) return
    onAssignmentChange(applyAltMove(assignments, source, over.shift_name, over.date, rowKind, nameById))
  }

  if (rows.length === 0) {
    return (
      <div style={{ padding: '48px 24px', textAlign: 'center', fontSize: 13, color: 'var(--text-muted)' }}>
        No shifts scheduled yet.
      </div>
    )
  }

  const grid = (
    <div style={{ overflowX: 'auto', width: '100%' }}>
      <div style={{
        display: 'grid',
        gridTemplateColumns: `${LABEL_COL_WIDTH}px ${orderedDates.map(d => `${Math.max(colByDate.get(d)?.width ?? 180, MIN_COL_WIDTH)}px`).join(' ')}`,
        minWidth: LABEL_COL_WIDTH + orderedDates.length * MIN_COL_WIDTH,
      }}>
        <div style={{
          position: 'sticky', left: 0, zIndex: 10, background: 'var(--bg-surface-2)',
          borderBottom: '1px solid var(--border-default)', borderRight: '1px solid var(--border-default)',
        }} />

        {orderedDates.map(date => {
          const col = colByDate.get(date)!
          return <DayHeader key={date} date={date} label={col.label} color={col.color} closed={closedDateSet.has(date)} />
        })}

        {rows.map(row => ([
          <div key={`label-${row.id}`} style={{
            position: 'sticky', left: 0, zIndex: 5, background: 'var(--bg-surface-2)',
            borderBottom: '1px solid var(--border-subtle)', borderRight: '1px solid var(--border-default)',
            padding: '10px 12px', display: 'flex', alignItems: 'center', minHeight: MIN_ROW_HEIGHT,
          }}>
            <span style={{ fontFamily: 'var(--font-display)', fontSize: 12, fontWeight: 700, color: 'var(--text-secondary)' }}>
              {row.label}
            </span>
          </div>,
          ...orderedDates.map(date => {
            const col = colByDate.get(date)!
            const cellAssignments = row.cellsByDate[date] ?? []
            const isEmpty = cellAssignments.length === 0
            const closed = closedDateSet.has(date)
            const appearance = resolveCellAppearance({
              colorConfig: color_config, columnColor: col.color, rowId: row.id,
              kind: closed ? 'closed' : (isEmpty ? 'empty' : 'filled'),
            })
            const cards = isEmpty
              ? <div style={{ flex: 1, border: '1px dashed var(--border-subtle)', borderRadius: 4, minHeight: 28 }} />
              : cellAssignments.map((asg, j) => editing ? (
                  <DraggableAltCard
                    key={`${asg.employee_id}-${asg.shift_name}-${j}`}
                    assignment={asg} rowKind={rowKind} color={appearance.color} fontSize={fontSize}
                    display={display_options} removeMode={removeMode}
                    onRemove={() => removeAssignment(asg)}
                    isVeteran={veteranIds?.has(asg.employee_id) ?? false}
                  />
                ) : rowKind === 'role' ? (
                  <StaticAssignmentCard
                    key={`${asg.employee_id}-${j}`}
                    assignment={asg} color={appearance.color} fontSize={fontSize}
                    showRole={false} showHours={display_options.show_hours} showStartEnd={display_options.show_start_end}
                    isVeteran={veteranIds?.has(asg.employee_id) ?? false}
                  />
                ) : (
                  <AltShiftChip
                    key={`${asg.shift_name}-${j}`}
                    assignment={asg} color={appearance.color} fontSize={fontSize}
                    showRole={display_options.show_role} showHours={display_options.show_hours} showStartEnd={display_options.show_start_end}
                  />
                ))
            return editing ? (
              <DroppableCell
                key={`cell-${row.id}-${date}`}
                shiftName={row.id}
                date={date}
                rowHeight={MIN_ROW_HEIGHT}
                baseBackground={appearance.background}
                enabled={editing && !removeMode && !closed}
                editing={editing}
                closed={closed}
              >
                {cards}
              </DroppableCell>
            ) : (
              <div key={`cell-${row.id}-${date}`} style={{
                borderBottom: '1px solid var(--border-subtle)', borderRight: '1px solid var(--border-subtle)',
                padding: 6, minHeight: MIN_ROW_HEIGHT, display: 'flex', flexDirection: 'column', gap: 4,
                background: closed ? 'var(--bg-surface-3)' : appearance.background,
              }}>
                {cards}
              </div>
            )
          }),
        ]))}
      </div>
    </div>
  )

  if (!editing) return grid

  return (
    <DndContext sensors={sensors} onDragStart={handleDragStart} onDragEnd={handleDragEnd}>
      {grid}
      <DragOverlay dropAnimation={null}>
        {activeAssignment && (
          <div style={{ opacity: 0.85, borderRadius: 4, background: hexWithAlpha('#60a5fa', 0.18), border: '1px solid rgba(96,165,250,0.5)' }}>
            {rowKind === 'role' ? (
              <AssignmentCardContent assignment={activeAssignment} color="#60a5fa" fontSize={fontSize} showRole={false} showHours={display_options.show_hours} showStartEnd={display_options.show_start_end} />
            ) : (
              <AltShiftChip assignment={activeAssignment} color="#60a5fa" fontSize={fontSize} showRole={display_options.show_role} showHours={display_options.show_hours} showStartEnd={display_options.show_start_end} />
            )}
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
  veteranIds,
  shiftRuleLabels,
  shiftRuleNotes,
}: ScheduleRendererProps) {
  const containerStyle: React.CSSProperties = {
    background: 'var(--bg-surface-1)',
    border: '1px solid var(--border-default)',
    borderRadius: 'var(--radius-lg)',
    overflow: 'hidden',
  }

  const resolvedClosedDates = closedDates ?? schedule.data?.closed_dates ?? []

  // Each layout renders in BOTH view and edit, so managers edit in exactly the
  // layout that goes out. Shift-rows keeps its full-featured grid; the alternate
  // layouts share the same drag/drop + save flow via AltLayoutGrid.
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
          veteranIds={veteranIds}
          shiftRuleLabels={shiftRuleLabels}
          shiftRuleNotes={shiftRuleNotes}
        />
      </div>
    )
  }

  if (template.layout_type === 'employee-rows-day-columns' || template.layout_type === 'role-rows-day-columns') {
    return (
      <div style={containerStyle}>
        <AltLayoutGrid
          schedule={schedule}
          template={template}
          rowKind={template.layout_type === 'employee-rows-day-columns' ? 'employee' : 'role'}
          closedDates={resolvedClosedDates}
          veteranIds={veteranIds}
          mode={mode}
          removeMode={removeMode}
          pendingAssignments={pendingAssignments}
          onAssignmentChange={onAssignmentChange}
        />
      </div>
    )
  }

  return (
    <div style={{ ...containerStyle, padding: '48px 24px', textAlign: 'center' }}>
      <div style={{ fontSize: 13, color: 'var(--text-muted)' }}>
        The “{layoutLabel(template.layout_type)}” layout is coming soon. Your schedule is still using the Shifts × Days layout.
      </div>
    </div>
  )
}
