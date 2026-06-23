// TEMPLATE-EDIT-2: make a template save honest.
//
// The old saveTemplate returned void and only updated state on success
// (`if (!error && data)`), so an RLS rejection or any other write failure
// vanished silently and the editor closed as if it had saved. This pure helper
// turns a Supabase upsert result into an explicit pass/fail the UI must handle,
// with a plain-English message for the manager. Pure → unit-tested under
// ts-node, matching the persistGuard pattern.

import type { ScheduleTemplate } from '@/lib/types'

export type SaveTemplateResult =
  | { ok: true; template: ScheduleTemplate }
  | { ok: false; error: string }

interface UpsertOutcome {
  data: unknown
  error: { message?: string; code?: string } | null
}

export function toSaveTemplateResult(outcome: UpsertOutcome): SaveTemplateResult {
  if (outcome.error) {
    // 42501 = insufficient_privilege (the usual shape of an RLS denial).
    if (outcome.error.code === '42501') {
      return { ok: false, error: "You don't have permission to save this template. Ask an owner to check the schedule-template access settings." }
    }
    return { ok: false, error: outcome.error.message?.trim() || 'The template could not be saved. Please try again.' }
  }
  if (!outcome.data) {
    // No error but no row back — also how a silently-blocked write can look.
    return { ok: false, error: 'The template did not save. Please try again, and let support know if it keeps happening.' }
  }
  return { ok: true, template: outcome.data as ScheduleTemplate }
}
