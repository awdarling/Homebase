import Anthropic from '@anthropic-ai/sdk'
import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'
import { createClient as createServerSupabase } from '@/lib/supabase/server'
import * as XLSX from 'xlsx'
import mammoth from 'mammoth'

const anthropic = new Anthropic({
  apiKey: process.env.ANTHROPIC_API_KEY!,
})

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
)

async function getCompanyContext(companyId: string) {
  const [
    { data: company },
    { data: profile },
    { data: employees },
    { data: shiftTypes },
    { data: shifts },
    { data: policies },
    { data: timeoff },
    { data: conflicts },
    { data: memory },
  ] = await Promise.all([
    supabase.from('companies').select('*').eq('id', companyId).single(),
    supabase.from('company_profiles').select('*').eq('company_id', companyId).maybeSingle(),
    supabase.from('employees').select('*').eq('company_id', companyId).eq('active', true),
    supabase.from('shift_types').select('*').eq('company_id', companyId).order('name'),
    supabase.from('shift_requirements').select('*').eq('company_id', companyId),
    supabase.from('policies').select('*').eq('company_id', companyId),
    supabase.from('time_off_requests').select('*').eq('company_id', companyId).eq('status', 'pending'),
    supabase.from('employee_conflicts').select('*').eq('company_id', companyId),
    supabase.from('soteria_memory').select('*').eq('company_id', companyId).order('created_at', { ascending: false }).limit(50),
  ])

  const employeeCount = employees?.length ?? 0
  const isNewCompany = employeeCount === 0 && !profile?.description

  return {
    company,
    profile,
    employees,
    shiftTypes,
    shifts,
    policies,
    timeoff,
    conflicts,
    memory,
    isNewCompany,
    summary: {
      employeeCount,
      shiftTypeCount: shiftTypes?.length ?? 0,
      shiftCount: shifts?.length ?? 0,
      policyCount: policies?.length ?? 0,
      pendingTimeOff: timeoff?.length ?? 0,
      conflictCount: conflicts?.length ?? 0,
    }
  }
}

function buildSystemPrompt(context: Awaited<ReturnType<typeof getCompanyContext>>) {
  const { company, profile, employees, shiftTypes, shifts, policies, conflicts, memory, isNewCompany, summary } = context
  const today = new Date().toISOString().slice(0, 10)
  const currentYear = today.slice(0, 4)

  const conflictWarnings = () => {
    if (!conflicts || conflicts.length === 0) return ''
    const neverPairs = conflicts.filter((c: { severity: string }) => c.severity === 'never')
    if (neverPairs.length >= 3) {
      return `\nWARNING: There are ${neverPairs.length} NEVER conflict pairs. This may make scheduling difficult or impossible. Flag this proactively.`
    }
    return ''
  }

  const memorySection = () => {
    if (!memory || memory.length === 0) return ''
    return `
MEMORY FROM PREVIOUS CONVERSATIONS:
${memory.map((m: { memory_type: string; content: string }) => `- [${m.memory_type}] ${m.content}`).join('\n')}

Use this memory to personalize your responses. Reference past decisions and preferences naturally.`
  }

  return `Today's date is ${today}. Always use ${currentYear} as the year when interpreting dates unless a different year is explicitly stated.

You are Soteria, an operational setup and advisory assistant built into Homebase by Quria Solutions.

Your role is to help managers set up their business data, refine their rules, and improve their operational structure. You are knowledgeable, warm, direct, and proactive. You think like an experienced operational consultant who has seen hundreds of businesses.

CRITICAL BEHAVIOR RULES:
- You NEVER write data to the database yourself. Instead, you propose actions as structured JSON inside <action> tags that the UI will present as confirmation cards.
- The manager must confirm every proposed change before anything is written.
- You proactively flag problems — staffing gaps, impossible scheduling constraints, rule conflicts — before they cause issues.
- You have full read access to the company's current data. Use it. Reference specific employees, shifts, and rules by name.
- Keep responses concise and actionable. No fluff.
- When you learn something important about the manager's preferences or decisions, store it silently by emitting a <memory> tag in your response (see the PROPOSING ACTIONS section below). Memory writes do not require manager confirmation. There is no save_memory action.

RESPONSE LENGTH RULES:
- Opening message: 1-2 sentences maximum. Warm, brief, human.
- All other responses: concise and focused. Never more than 3-4 short paragraphs.
- Ask one question at a time. Never stack multiple questions.

COMPANY: ${company?.name ?? 'Unknown'}
ONBOARDING NEEDED: ${isNewCompany ? 'YES — this company has no data yet' : 'NO — data exists'}

CURRENT DATA SUMMARY:
- Employees: ${summary.employeeCount}
- Shift types: ${summary.shiftTypeCount}
- Role requirements: ${summary.shiftCount}
- Policies: ${summary.policyCount}
- Pending time-off: ${summary.pendingTimeOff}
- Conflict pairs: ${summary.conflictCount}
${conflictWarnings()}

${profile ? `
BUSINESS PROFILE:
- Type: ${profile.business_type ?? 'Not set'}
- Description: ${profile.description ?? 'Not set'}
- Operating hours: ${profile.operating_hours ?? 'Not set'}
- Peak periods: ${profile.peak_periods ?? 'Not set'}
- Manager priorities: ${profile.manager_priorities ?? 'Not set'}
- Special context: ${profile.special_context ?? 'Not set'}
` : 'BUSINESS PROFILE: Not yet completed'}

${employees && employees.length > 0 ? `
EMPLOYEES (${employees.length}):
${employees.map((e: { id: string; name: string; primary_role: string; qualified_roles?: string[]; max_weekly_hours: number }) => `- ${e.name} (id: ${e.id}) | ${e.primary_role} | Qualifies: ${e.qualified_roles?.join(', ')} | Max: ${e.max_weekly_hours}h/week`).join('\n')}
` : 'EMPLOYEES: None added yet'}

${shiftTypes && shiftTypes.length > 0 ? `
SHIFT TYPES (the umbrella shifts — use these IDs when adding role requirements):
${shiftTypes.map((st: { id: string; name: string; start_time: string; end_time: string; days_active: number[]; active: boolean }) => {
  const dayLabels = ['Sun','Mon','Tue','Wed','Thu','Fri','Sat']
  const days = Array.isArray(st.days_active) ? st.days_active.map((d: number) => dayLabels[d] ?? d).join(',') : '?'
  const reqsForType = (shifts ?? []).filter((s: { shift_type_id?: string | null }) => s.shift_type_id === st.id)
  const reqLines = reqsForType.length === 0
    ? '    (no role requirements yet)'
    : reqsForType.map((r: { id: string; accepted_roles?: string[]; role?: string; required_count: number }) => {
        const roles = (Array.isArray(r.accepted_roles) && r.accepted_roles.length > 0)
          ? r.accepted_roles.join(' or ')
          : (r.role ?? '?')
        return `    • ${r.required_count}× ${roles}  (requirement id: ${r.id})`
      }).join('\n')
  return `- ${st.name} (id: ${st.id}) | ${st.start_time}–${st.end_time} | days: ${days}${st.active ? '' : ' | INACTIVE'}\n${reqLines}`
}).join('\n')}
` : 'SHIFT TYPES: None defined yet'}

${(() => {
  const orphans = (shifts ?? []).filter((s: { shift_type_id?: string | null }) => !s.shift_type_id)
  if (orphans.length === 0) return ''
  return `\nORPHAN SHIFT REQUIREMENTS (no shift_type_id — legacy rows, do not add new ones like this):\n${orphans.map((s: { id: string; shift_name?: string; role?: string; accepted_roles?: string[]; required_count: number }) => {
    const roles = (Array.isArray(s.accepted_roles) && s.accepted_roles.length > 0) ? s.accepted_roles.join(' or ') : (s.role ?? '?')
    return `- ${s.shift_name ?? '?'} | ${roles} | ${s.required_count} needed | id: ${s.id}`
  }).join('\n')}\n`
})()}

${policies && policies.length > 0 ? `
POLICIES:
${policies.map((p: { policy_key: string; policy_value: string; policy_type: string }) => `- ${p.policy_key}: ${p.policy_value} (${p.policy_type})`).join('\n')}
` : 'POLICIES: None added yet'}

${memorySection()}

PROPOSING ACTIONS:
When you want to write data, output a JSON block inside <action> tags.

CRITICAL: Emit ONLY ONE <action> block per response. Never include more than one <action> tag in a single message. After the user confirms or rejects an action, send your next response with the next action block. Process actions sequentially, one confirmation at a time.

For database changes:
<action>
{
  "type": "add_employee",
  "description": "Add John Smith as a Lifeguard",
  "data": {
    "name": "John Smith",
    "primary_role": "Lifeguard",
    "qualified_roles": ["Lifeguard"],
    "max_weekly_hours": 40
  }
}
</action>

For saving memory (no confirmation needed — do this silently when you learn something important):
<memory>
{
  "memory_type": "preference",
  "content": "Manager prefers to avoid scheduling overtime even if it means gaps",
  "source": "conversation"
}
</memory>

Action types:
- add_employee — data: { name, primary_role, qualified_roles, max_weekly_hours, contact_phone?, contact_email? }
- update_employee — data: { employee_id, updates: { name?, primary_role?, qualified_roles?, max_weekly_hours?, contact_email?, contact_phone?, individual_wage?, is_veteran?, active? } }
- delete_employee — data: { id, name }
- import_employees — data: { employees: [{ name, primary_role, qualified_roles, contact_email?, contact_phone?, max_weekly_hours?, is_veteran? }, ...] }
- update_profile — data: { business_type?, description?, operating_hours?, peak_periods?, manager_priorities?, special_context? }
- add_shift_type — data: { name, start_time, end_time, days_active: number[] } — Creates a new shift template (an umbrella shift). Use this when the manager describes a NEW shift that doesn't exist yet. Times are HH:MM. days_active is REQUIRED and must be a non-empty array of integers 0–6 (0=Sunday … 6=Saturday). After creating, follow up by asking what roles should be inside it.
- add_role_requirement — data: { shift_type_id, accepted_roles: string[], required_count } — Adds a role slot to an existing shift_type. accepted_roles is ordered by preference: the FIRST role is the preferred role; later roles are fallbacks. A single-role slot is just a one-element array. required_count defaults to 1 if omitted.
- update_shift_type — data: { id, name?, start_time?, end_time?, days_active? } — Edits an existing shift type. Only the provided fields are updated.
- update_role_requirement — data: { id, accepted_roles?: string[], required_count? } — Edits an existing role requirement. Only the provided fields are updated. accepted_roles, if provided, must be a non-empty array.
- delete_shift_type — data: { id, name } — Deletes a shift type. If role requirements still exist under it, the executor will refuse — ask the manager to delete the role requirements first, or confirm they want all of them removed.
- delete_role_requirement — data: { id } — Deletes a single role requirement (one row in shift_requirements).
- update_policy — data: { policy_key, policy_value, policy_type?, description? }
- delete_policy — data: { id, policy_key }
- add_conflict — data: { employee_id_1, employee_id_2, reason?, severity?: 'avoid' | 'never' } — 'avoid' is a soft conflict (engine deprioritizes co-scheduling but allows it); 'never' is a hard conflict (engine refuses to co-schedule under any circumstances). Defaults to 'avoid' if omitted. Do not emit any other value.
- trigger_schedule_build — data: { target_week: "this" | "next", veteran_preference? }
- batch_create_time_off — data: { requests: [{ employee_id, employee_name, start_date, end_date, time_off_type: "full_day" | "partial", reason?, partial_days?: [{ date, type: "shift_off" | "custom_hours", shift_id?, shift_name?, start_time?, end_time? }] }] } — use this whenever logging time-off for one or more employees; group all TO from a notes block into a single batch.
- update_availability — data: { employee_id, employee_name, slots: [{ day_of_week, start_time, end_time }], replace_all: boolean } — permanent recurring availability change. replace_all=true wipes existing and inserts new; replace_all=false merges (adds slots for days not already covered).
- set_custom_availability — data: { employee_id, employee_name, type: "date_limited" | "rotating", end_date, patterns?: [{ day_of_week, start_time, end_time }], cycle_weeks?, cycle_start_date?, weekly_patterns?: [{ week, days: [{ day_of_week, start_time, end_time }] }] } — temporary override of normal availability until end_date. Use patterns for date_limited; use cycle_weeks + cycle_start_date + weekly_patterns for rotating.

Memory types: preference, decision, context, feedback

SHIFT ARCHITECTURE:
A shift has TWO levels. A shift_type is the umbrella — it owns the name, the days the shift runs, and the start/end times. Inside a shift_type are role requirements (which roles need to be filled and how many of each). When the manager asks to "add a shift" or "create a new shift", first determine whether they mean a brand-new umbrella (use add_shift_type, then add_role_requirement for each role they list) or adding a role to an existing shift (use add_role_requirement only). If it is unclear, ASK before emitting any action. The list of existing shift types in this company is provided in the SHIFT TYPES section above — use it to disambiguate. Never create a role requirement without a valid shift_type_id from that list. A single role slot is a one-element accepted_roles array; a multi-role slot (e.g. "either a Lifeguard or a Headguard can fill this slot") is a multi-element array ordered by preference, with the preferred role first.

AVAILABILITY NOTES PROCESSING:
When a manager pastes availability notes for multiple employees, analyze all notes and determine the correct action(s) for each employee:

- Specific dates off = batch_create_time_off (group all employees into one batch request)
- Partial day TO (e.g. 'no mornings', 'after 5pm') = batch_create_time_off with partial time_off_type and custom_hours details
- 'No mornings until X date' or 'school until X' = set_custom_availability with date_limited type, patterns showing only afternoon hours (e.g. 13:00-21:00 on the days they ARE available)
- Rotating schedule (alternating weekly pattern) = set_custom_availability with rotating type and weekly_patterns
- Regular recurring change ('no Tuesday nights' permanently) = update_availability with the adjusted slots

Match employee names fuzzy — 'Ally B' matches 'Ally Becker', 'Lucas W' matches 'Lucas Witham', etc. Always confirm matches with the manager.

When processing a block of notes, emit ONE confirm card per action type grouping:
1. First card: all TO requests as one batch_create_time_off
2. Additional cards: one per employee needing custom or regular availability changes

Always show the manager a clear summary of what you interpreted before showing confirm cards. List each employee and what you extracted for them. Ask the manager to confirm your interpretation is correct before proceeding.

PARTIAL DAY TIME FORMAT RULES:
- Times must always be HH:MM format (not HH:MM:SS). Use 15:30 not 15:30:00.
- Every partial_days entry MUST have both start_time AND end_time. Never omit either.
- 'No work after X time' means:
    start_time: X, end_time: '23:59'
  (the time off period starts at X)
- 'No work before X time' means:
    start_time: '00:00', end_time: X
  (the time off period ends at X)
- 'No work between X and Y' means:
    start_time: X, end_time: Y

When a manager uploads an employee roster (Excel, CSV, or similar), extract all employee data and emit a single import_employees action with all employees in the array. Ask the manager to confirm before importing. Map columns intelligently — names like 'Head Lifeguard' should map to the closest matching role in the company's role list.

When a manager asks you to build a schedule, emit a trigger_schedule_build action with the appropriate target_week. Always confirm before triggering. Mention that the manager will receive a text confirmation when it's done.

If this is a new company with no data, introduce yourself briefly:
"Hi, I'm Soteria. I'm here to help get your operation set up. What kind of business do you run?"

If data already exists, open with a brief status acknowledgment:
"Hi, I'm Soteria. I can see your team is already set up in Homebase. What can I help you with today?"
`
}

type ImageBlock = {
  type: 'image'
  source: { type: 'base64'; media_type: string; data: string }
}
type DocumentBlock = {
  type: 'document'
  source: { type: 'base64'; media_type: 'application/pdf'; data: string }
}
type TextBlock = { type: 'text'; text: string }
type ContentBlock = ImageBlock | DocumentBlock | TextBlock

export async function POST(request: NextRequest) {
  try {
    const body = await request.json()
    const { messages, companyId, imageData, fileName, fileType } = body as {
      messages: { role: 'user' | 'assistant'; content: string }[]
      companyId: string
      imageData: { data: string; mediaType: string } | null
      fileName: string | null
      fileType: 'image' | 'pdf' | 'csv' | 'spreadsheet' | 'document' | null
    }

    // ── Auth check ──────────────────────────────────────────────────────────
    const ssr = await createServerSupabase()
    const { data: { user } } = await ssr.auth.getUser()
    if (!user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }
    const { data: userRow } = await ssr
      .from('users')
      .select('company_id')
      .eq('id', user.id)
      .single()
    if (!userRow || (userRow as { company_id: string }).company_id !== companyId) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
    }

    const context = await getCompanyContext(companyId)
    const systemPrompt = buildSystemPrompt(context)

    // ── Server-side file processing ─────────────────────────────────────────
    // Excel/Word are parsed here and inlined as text in the last user message.
    // PDFs are sent as Anthropic document blocks. Images stay as image blocks.
    let extractedText: string | null = null
    let pdfBase64: string | null = null
    let imageBlock: { data: string; mediaType: string } | null = null

    if (imageData && fileType) {
      if (fileType === 'image') {
        imageBlock = imageData
      } else if (fileType === 'pdf') {
        pdfBase64 = imageData.data
      } else if (fileType === 'spreadsheet') {
        try {
          const buf = Buffer.from(imageData.data, 'base64')
          const wb = XLSX.read(buf, { type: 'buffer' })
          const firstSheetName = wb.SheetNames[0]
          const csv = firstSheetName ? XLSX.utils.sheet_to_csv(wb.Sheets[firstSheetName]) : ''
          extractedText = `[File: ${fileName ?? 'spreadsheet'}]\n${csv}`
        } catch (e) {
          console.error('xlsx parse error:', e)
          extractedText = `[File: ${fileName ?? 'spreadsheet'}]\n(Could not parse spreadsheet contents.)`
        }
      } else if (fileType === 'document') {
        try {
          const buf = Buffer.from(imageData.data, 'base64')
          const result = await mammoth.extractRawText({ buffer: buf })
          extractedText = `[File: ${fileName ?? 'document'}]\n${result.value}`
        } catch (e) {
          console.error('mammoth parse error:', e)
          extractedText = `[File: ${fileName ?? 'document'}]\n(Could not extract document text. Legacy .doc files are not supported — please re-save as .docx.)`
        }
      }
    }

    const formattedMessages = messages.map((msg, index) => {
      const isLast = index === messages.length - 1
      if (!isLast || msg.role !== 'user') {
        return { role: msg.role, content: msg.content }
      }

      const content: ContentBlock[] = []
      if (imageBlock) {
        content.push({
          type: 'image',
          source: {
            type: 'base64',
            media_type: imageBlock.mediaType,
            data: imageBlock.data,
          },
        })
      }
      if (pdfBase64) {
        content.push({
          type: 'document',
          source: {
            type: 'base64',
            media_type: 'application/pdf',
            data: pdfBase64,
          },
        })
      }
      const textBody = extractedText
        ? `${msg.content}\n\n${extractedText}`
        : msg.content
      content.push({ type: 'text', text: textBody })

      if (content.length === 1 && content[0].type === 'text') {
        return { role: 'user' as const, content: textBody }
      }
      return { role: 'user' as const, content }
    })

    const response = await anthropic.messages.create({
      model: 'claude-sonnet-4-6',
      max_tokens: 8192,
      system: systemPrompt,
      messages: formattedMessages as Parameters<typeof anthropic.messages.create>[0]['messages'],
    })

    const content = response.content[0].type === 'text' ? response.content[0].text : ''
    const stopReason = response.stop_reason
    if (stopReason === 'max_tokens') {
      console.warn('Soteria response truncated by max_tokens; action JSON may be incomplete')
    }

    const stripJsonFence = (s: string): string =>
      s.replace(/^\s*```(?:json)?\s*/i, '').replace(/```\s*$/i, '').trim()

    let action = null
    let cleanContent = content
    const actionMatch = content.match(/<action>([\s\S]*?)<\/action>/)
    if (actionMatch) {
      cleanContent = cleanContent.replace(/<action>[\s\S]*?<\/action>/g, '').trim()
      try {
        action = JSON.parse(stripJsonFence(actionMatch[1]))
      } catch (e) {
        const raw = actionMatch[1]
        console.error(
          `Soteria action JSON parse failed (len=${raw.length}, stop=${stopReason}):`,
          e,
          'preview:', raw.slice(0, 200),
        )
      }
    }

    const memoryMatch = cleanContent.match(/<memory>([\s\S]*?)<\/memory>/)
    if (memoryMatch) {
      cleanContent = cleanContent.replace(/<memory>[\s\S]*?<\/memory>/g, '').trim()
      try {
        const memoryData = JSON.parse(stripJsonFence(memoryMatch[1]))
        await supabase.from('soteria_memory').insert({
          company_id: companyId,
          memory_type: memoryData.memory_type,
          content: memoryData.content,
          source: memoryData.source ?? 'conversation',
        })
      } catch (e) {
        console.error('Failed to save memory:', e)
      }
    }

    return NextResponse.json({
      message: cleanContent,
      action,
      context: context.summary,
    })

  } catch (error) {
    console.error('Soteria error:', error)
    const message = error instanceof Error ? error.message : 'Unknown error'
    return NextResponse.json({ error: message }, { status: 500 })
  }
}
