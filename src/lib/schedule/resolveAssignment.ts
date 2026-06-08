import type { ScheduleAssignment, ShiftType } from '@/lib/types'
import { computeHours } from './hours'

export function resolveAssignmentForSlot(
  source: ScheduleAssignment,
  targetShiftName: string,
  targetDate: string,
  siblingAssignments: ScheduleAssignment[],
  shiftTypes?: Pick<ShiftType, 'name' | 'start_time' | 'end_time'>[],
): ScheduleAssignment {
  const sibling = siblingAssignments.find(a =>
    a.shift_name === targetShiftName &&
    a.date === targetDate &&
    !(a.employee_id === source.employee_id && a.shift_name === source.shift_name && a.date === source.date),
  )

  let start_time: string
  let end_time: string

  if (sibling) {
    start_time = sibling.start_time
    end_time = sibling.end_time
  } else {
    const st = shiftTypes?.find(s => s.name === targetShiftName)
    if (st) {
      start_time = st.start_time
      end_time = st.end_time
    } else {
      console.warn(
        `[resolveAssignmentForSlot] could not resolve times for shift "${targetShiftName}" on ${targetDate} — keeping source times. The save-time backstop should normalize this.`,
      )
      start_time = source.start_time
      end_time = source.end_time
    }
  }

  return {
    date: targetDate,
    employee_id: source.employee_id,
    employee_name: source.employee_name,
    employee_photo: source.employee_photo,
    shift_name: targetShiftName,
    role: source.role,
    start_time,
    end_time,
    hours: computeHours(start_time, end_time),
  }
}
