import type { SupabaseClient } from '@supabase/supabase-js'
import { logActivity } from '@/lib/activity'
import type { Policy, PolicyCategory } from '@/lib/types'
import { CANONICAL_POLICY_KEY } from '@/lib/types'

interface SavePolicyArgs {
  supabase: SupabaseClient
  companyId: string
  category: Exclude<PolicyCategory, 'legacy'>
  existing: Policy | null
  policyValue: string
  policyValueJson: unknown
  summary: string
  user?: { name?: string; avatar_url?: string | null } | null
  isQuria?: boolean
  before?: unknown
  // Free-form note shown alongside the rule. When omitted (undefined),
  // savePolicy leaves the column untouched on update. When passed, an
  // empty/whitespace string is normalized to null.
  description?: string | null
}

// Upsert a structured policy and log an activity entry.
// When `existing` is non-null, updates that row and bumps version; the row's
// policy_key is preserved (even if it's an alias like 'fairness_weight').
// When `existing` is null, inserts a new row with the canonical key.
export async function savePolicy({
  supabase,
  companyId,
  category,
  existing,
  policyValue,
  policyValueJson,
  summary,
  user,
  isQuria,
  before,
  description,
}: SavePolicyArgs): Promise<{ id: string }> {
  const hasDescription = description !== undefined
  const normalizedDescription: string | null = hasDescription
    ? ((description ?? '').toString().trim() || null)
    : null

  if (existing) {
    const updates: Record<string, unknown> = {
      policy_value: policyValue,
      policy_value_json: policyValueJson,
      version: (existing.version ?? 1) + 1,
    }
    if (hasDescription) updates.description = normalizedDescription

    const { error } = await supabase
      .from('policies')
      .update(updates)
      .eq('id', existing.id)
      .eq('company_id', companyId)
    if (error) throw error

    const metadata: Record<string, unknown> = {
      policy_id: existing.id,
      policy_key: existing.policy_key,
      before,
      after: policyValueJson,
    }
    if (hasDescription) {
      metadata.description_before = existing.description ?? null
      metadata.description_after = normalizedDescription
    }

    await logActivity({
      supabase,
      company_id: companyId,
      action: 'policy_updated',
      entity_type: 'policy',
      entity_id: existing.id,
      summary,
      metadata,
      isQuria,
      actorName: user?.name,
      actorAvatarUrl: user?.avatar_url ?? null,
    })

    return { id: existing.id }
  }

  const policyKey = CANONICAL_POLICY_KEY[category]
  const { data, error } = await supabase
    .from('policies')
    .insert({
      company_id: companyId,
      policy_key: policyKey,
      policy_value: policyValue,
      policy_value_json: policyValueJson,
      policy_type: 'custom',
      description: hasDescription ? normalizedDescription : null,
      version: 1,
    })
    .select('id')
    .single()
  if (error) throw error

  const metadata: Record<string, unknown> = {
    policy_id: (data as { id: string }).id,
    policy_key: policyKey,
    after: policyValueJson,
  }
  if (hasDescription) {
    metadata.description_after = normalizedDescription
  }

  await logActivity({
    supabase,
    company_id: companyId,
    action: 'policy_added',
    entity_type: 'policy',
    entity_id: (data as { id: string }).id,
    summary,
    metadata,
    isQuria,
    actorName: user?.name,
    actorAvatarUrl: user?.avatar_url ?? null,
  })

  return { id: (data as { id: string }).id }
}

export async function removePolicy({
  supabase,
  companyId,
  policy,
  summary,
  user,
  isQuria,
}: {
  supabase: SupabaseClient
  companyId: string
  policy: Policy
  summary: string
  user?: { name?: string; avatar_url?: string | null } | null
  isQuria?: boolean
}): Promise<void> {
  const { error } = await supabase
    .from('policies')
    .delete()
    .eq('id', policy.id)
    .eq('company_id', companyId)
  if (error) throw error

  await logActivity({
    supabase,
    company_id: companyId,
    action: 'policy_removed',
    entity_type: 'policy',
    entity_id: policy.id,
    summary,
    metadata: {
      policy_id: policy.id,
      policy_key: policy.policy_key,
      before: policy.policy_value_json,
    },
    isQuria,
    actorName: user?.name,
    actorAvatarUrl: user?.avatar_url ?? null,
  })
}
