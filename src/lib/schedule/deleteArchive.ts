// W-3 (Jack's audit, "also seen") — what deleting a schedule must WRITE.
//
// Aug 23: Jack deleted the published Aug 24–30 schedule and rebuilt. The
// deleted row kept `published_at` set and `archived_at` null — it still LOOKED
// like the live published schedule to any reader that forgets to filter
// `deleted_at` (10 of Aegis's 31 schedule readers don't). The republish path's
// archive step (migration 016 `publish_schedule_swap`) was bypassed entirely.
//
// Rule: a deleted schedule that had been published is ALSO archived, exactly
// the way republish archives — `archived_at` set, `published_at` cleared —
// so nothing can ever mistake it for live. (The kickoff said to also write
// `status='archived'`; the live CHECK constraint only permits
// draft|published|distributed, so the repo's real archive shape — timestamps,
// not a status string — is what we follow. Logged in DRIFT_REGISTER.)
//
// Pure: the route applies whatever this returns.

export function deleteSchedulePatch(
  schedule: { published_at?: string | null },
  nowIso: string,
): Record<string, string | null> {
  const patch: Record<string, string | null> = { deleted_at: nowIso }
  if (schedule.published_at) {
    patch.archived_at = nowIso
    patch.published_at = null
  }
  return patch
}
