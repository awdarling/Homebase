// Runtime test for W-3's delete-also-archives rule (Jack's Aug 23 delete-and-
// rebuild left a deleted schedule still LOOKING published).
// Run:  npx ts-node --transpile-only -r tsconfig-paths/register --project tsconfig.scripts.json \
//         src/lib/schedule/__tests__/w3DeleteArchive.test.ts

import { deleteSchedulePatch } from '../deleteArchive'

let failures = 0
function expect(cond: unknown, msg: string): void {
  if (cond) { console.log(`✓ ${msg}`) } else { console.error(`✗ ${msg}`); failures++ }
}

const NOW = '2026-08-27T12:00:00.000Z'

// ── a PUBLISHED schedule is archived on delete, republish-style ─────────────
{
  const patch = deleteSchedulePatch({ published_at: '2026-08-22T10:00:00Z' }, NOW)
  expect(patch.deleted_at === NOW, 'deleted_at is set')
  expect(patch.archived_at === NOW, 'archived_at is set (the step Jack\'s delete used to skip)')
  expect(patch.published_at === null, 'published_at is CLEARED — nothing can mistake it for the live schedule')
}

// ── a draft stays a plain soft delete ───────────────────────────────────────
{
  const patch = deleteSchedulePatch({ published_at: null }, NOW)
  expect(patch.deleted_at === NOW, 'draft delete sets deleted_at')
  expect(!('archived_at' in patch) && !('published_at' in patch), 'draft delete touches nothing else')
}

if (failures > 0) { console.error(`\n${failures} check(s) failed.`); process.exit(1) }
console.log('\nAll w3DeleteArchive checks passed.')
