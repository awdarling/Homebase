import type { SupabaseClient } from '@supabase/supabase-js'
import type { ActionType } from './tokens'

export type DispatchResult = { ok: boolean; message: string }

const STUB_MESSAGE = 'Action recorded. [Real handler wires in next session]'

export async function dispatchAction(
  action_type: ActionType,
  payload: Record<string, unknown>,
  _supabase: SupabaseClient,
): Promise<DispatchResult> {
  switch (action_type) {
    case 'approve_to':
    case 'deny_to':
    case 'approve_availability':
    case 'deny_availability':
    case 'accept_emergency_coverage':
    case 'decline_emergency_coverage':
    case 'confirm_distribution':
    case 'request_additional_batch':
      console.log(`[aegis-action] ${action_type} received for payload`, payload)
      return { ok: true, message: STUB_MESSAGE }
    default:
      return { ok: false, message: 'Unknown action type' }
  }
}
