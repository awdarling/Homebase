import Anthropic from '@anthropic-ai/sdk'
import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'

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
    { data: shifts },
    { data: policies },
    { data: timeoff },
    { data: conflicts },
    { data: memory },
  ] = await Promise.all([
    supabase.from('companies').select('*').eq('id', companyId).single(),
    supabase.from('company_profiles').select('*').eq('company_id', companyId).maybeSingle(),
    supabase.from('employees').select('*').eq('company_id', companyId).eq('active', true),
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
    shifts,
    policies,
    timeoff,
    conflicts,
    memory,
    isNewCompany,
    summary: {
      employeeCount,
      shiftCount: shifts?.length ?? 0,
      policyCount: policies?.length ?? 0,
      pendingTimeOff: timeoff?.length ?? 0,
      conflictCount: conflicts?.length ?? 0,
    }
  }
}

function buildSystemPrompt(context: Awaited<ReturnType<typeof getCompanyContext>>) {
  const { company, profile, employees, shifts, policies, conflicts, memory, isNewCompany, summary } = context

  const conflictWarnings = () => {
    if (!conflicts || conflicts.length === 0) return ''
    const neverPairs = conflicts.filter((c: any) => c.severity === 'never')
    if (neverPairs.length >= 3) {
      return `\nWARNING: There are ${neverPairs.length} NEVER conflict pairs. This may make scheduling difficult or impossible. Flag this proactively.`
    }
    return ''
  }

  const memorySection = () => {
    if (!memory || memory.length === 0) return ''
    return `
MEMORY FROM PREVIOUS CONVERSATIONS:
${memory.map((m: any) => `- [${m.memory_type}] ${m.content}`).join('\n')}

Use this memory to personalize your responses. Reference past decisions and preferences naturally.`
  }

  return `You are Soteria, an operational setup and advisory assistant built into Homebase by Quria Solutions.

Your role is to help managers set up their business data, refine their rules, and improve their operational structure. You are knowledgeable, warm, direct, and proactive. You think like an experienced operational consultant who has seen hundreds of businesses.

CRITICAL BEHAVIOR RULES:
- You NEVER write data to the database yourself. Instead, you propose actions as structured JSON inside <action> tags that the UI will present as confirmation cards.
- The manager must confirm every proposed change before anything is written.
- You proactively flag problems — staffing gaps, impossible scheduling constraints, rule conflicts — before they cause issues.
- You have full read access to the company's current data. Use it. Reference specific employees, shifts, and rules by name.
- Keep responses concise and actionable. No fluff.
- When you learn something important about the manager's preferences or decisions, store it using the save_memory action.

RESPONSE LENGTH RULES:
- Opening message: 1-2 sentences maximum. Warm, brief, human.
- All other responses: concise and focused. Never more than 3-4 short paragraphs.
- Ask one question at a time. Never stack multiple questions.

COMPANY: ${company?.name ?? 'Unknown'}
ONBOARDING NEEDED: ${isNewCompany ? 'YES — this company has no data yet' : 'NO — data exists'}

CURRENT DATA SUMMARY:
- Employees: ${summary.employeeCount}
- Shift requirements: ${summary.shiftCount}
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
${employees.map((e: any) => `- ${e.name} | ${e.primary_role} | Qualifies: ${e.qualified_roles?.join(', ')} | Max: ${e.max_weekly_hours}h/week`).join('\n')}
` : 'EMPLOYEES: None added yet'}

${shifts && shifts.length > 0 ? `
SHIFT REQUIREMENTS:
${shifts.map((s: any) => `- ${s.shift_name} | ${s.role} | ${s.required_count} needed | ${s.start_time}–${s.end_time}`).join('\n')}
` : 'SHIFT REQUIREMENTS: None added yet'}

${policies && policies.length > 0 ? `
POLICIES:
${policies.map((p: any) => `- ${p.policy_key}: ${p.policy_value} (${p.policy_type})`).join('\n')}
` : 'POLICIES: None added yet'}

${memorySection()}

PROPOSING ACTIONS:
When you want to write data, output a JSON block inside <action> tags.

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

Action types: add_employee, update_policy, add_shift, update_profile, add_conflict, delete_employee, delete_policy, delete_shift
Memory types: preference, decision, context, feedback

If this is a new company with no data, introduce yourself briefly:
"Hi, I'm Soteria. I'm here to help get your operation set up. What kind of business do you run?"

If data already exists, open with a brief status acknowledgment:
"Hi, I'm Soteria. I can see your team is already set up in Homebase. What can I help you with today?"
`
}

export async function POST(request: NextRequest) {
  try {
    const body = await request.json()
    const { messages, companyId, imageData } = body

    const context = await getCompanyContext(companyId)
    const systemPrompt = buildSystemPrompt(context)

    const formattedMessages = messages.map((msg: any, index: number) => {
      if (index === messages.length - 1 && imageData && msg.role === 'user') {
        return {
          role: 'user',
          content: [
            {
              type: 'image',
              source: {
                type: 'base64',
                media_type: imageData.mediaType,
                data: imageData.data,
              },
            },
            { type: 'text', text: msg.content },
          ],
        }
      }
      return { role: msg.role, content: msg.content }
    })

    const response = await anthropic.messages.create({
      model: 'claude-opus-4-5',
      max_tokens: 1024,
      system: systemPrompt,
      messages: formattedMessages,
    })

    const content = response.content[0].type === 'text' ? response.content[0].text : ''

    // Parse action blocks
    const actionMatch = content.match(/<action>([\s\S]*?)<\/action>/)
    let action = null
    let cleanContent = content

    if (actionMatch) {
      try {
        action = JSON.parse(actionMatch[1].trim())
        cleanContent = content.replace(/<action>[\s\S]*?<\/action>/, '').trim()
      } catch (e) {
        console.error('Failed to parse action:', e)
      }
    }

    // Parse and auto-save memory blocks
    const memoryMatch = cleanContent.match(/<memory>([\s\S]*?)<\/memory>/)
    if (memoryMatch) {
      try {
        const memoryData = JSON.parse(memoryMatch[1].trim())
        await supabase.from('soteria_memory').insert({
          company_id: companyId,
          memory_type: memoryData.memory_type,
          content: memoryData.content,
          source: memoryData.source ?? 'conversation',
        })
        cleanContent = cleanContent.replace(/<memory>[\s\S]*?<\/memory>/, '').trim()
      } catch (e) {
        console.error('Failed to save memory:', e)
      }
    }

    return NextResponse.json({
      message: cleanContent,
      action,
      context: context.summary,
    })

  } catch (error: any) {
    console.error('Soteria error:', error)
    return NextResponse.json({ error: error.message }, { status: 500 })
  }
}