import type { SupabaseClient } from '@supabase/supabase-js'

export async function logActivity({
  supabase,
  company_id,
  action,
  entity_type,
  entity_id,
  summary,
  metadata,
  isQuria,
  actorName,
  actorAvatarUrl,
}: {
  supabase: SupabaseClient
  company_id: string
  action: string
  entity_type?: string
  entity_id?: string
  summary: string
  metadata?: Record<string, unknown>
  isQuria?: boolean
  actorName?: string
  actorAvatarUrl?: string | null
}) {
  let avatarUrl = actorAvatarUrl ?? null
  if (avatarUrl === undefined || avatarUrl === null) {
    const { data: { user } } = await supabase.auth.getUser()
    const metaAvatar = (user?.user_metadata as { avatar_url?: string } | undefined)?.avatar_url
    if (metaAvatar) {
      avatarUrl = metaAvatar
    } else if (user?.id) {
      const { data: row } = await supabase
        .from('users')
        .select('avatar_url')
        .eq('id', user.id)
        .maybeSingle()
      avatarUrl = (row as { avatar_url: string | null } | null)?.avatar_url ?? null
    }
  }

  await supabase.from('activity_log').insert({
    company_id,
    actor: isQuria ? 'quria_admin' : 'manager',
    actor_name: actorName ?? null,
    actor_avatar_url: avatarUrl,
    action,
    entity_type: entity_type ?? null,
    entity_id: entity_id ?? null,
    summary,
    metadata: metadata ?? null,
  })
}
