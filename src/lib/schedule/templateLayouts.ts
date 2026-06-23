// TEMPLATE-EDIT-2: single source of truth for which schedule layouts actually
// render.
//
// The editor offered three layouts but ScheduleRenderer only implements
// `shift-rows-day-columns`; the other two fall through to a "not supported"
// message. Before the save fix (slice 1) that was harmless because edits never
// persisted — but now that saves stick, a manager could pick an unbuilt layout
// and break their real schedule view AND downloads. This module is the one gate
// the picker (disable unbuilt options) and the renderer (graceful fallback)
// both read, so support flips on exactly when each layout lands. Pure →
// unit-tested under ts-node.

import type { ScheduleTemplate } from '@/lib/types'

export type LayoutType = ScheduleTemplate['layout_type']

export interface LayoutMeta {
  value: LayoutType
  label: string
  supported: boolean
}

// `supported` must match what ScheduleRenderer actually implements. Flip a flag
// to true the moment its layout component is built.
export const LAYOUT_META: LayoutMeta[] = [
  { value: 'shift-rows-day-columns', label: 'Shifts × Days', supported: true },
  { value: 'employee-rows-day-columns', label: 'Employees × Days', supported: false },
  { value: 'role-rows-day-columns', label: 'Roles × Days', supported: false },
]

const BY_VALUE = new Map<string, LayoutMeta>(LAYOUT_META.map((m) => [m.value, m]))

export function isLayoutSupported(value: string | null | undefined): boolean {
  return !!value && (BY_VALUE.get(value)?.supported ?? false)
}

export function layoutLabel(value: string | null | undefined): string {
  return (value && BY_VALUE.get(value)?.label) || 'this layout'
}
