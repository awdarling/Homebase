// Single source of truth for "what can Soteria / Aegis do for you?" on the
// Homebase side. Mirrors the Aegis capabilities module (Aegis/src/router/
// capabilities.ts) in wording and structure so the in-app assistant (Soteria)
// and the email/text assistant (Aegis) describe the same thing in the same
// plain language. Drives BOTH the help answer and the out-of-scope redirect.
//
// Homebase user roles are: 'quria' | 'owner' | 'manager' | 'employee'.
// Owners, managers, and Quria admins all get the full manager capability set;
// employees get the personal set.

export type CapabilityRole = 'employee' | 'manager'

// Map a Homebase users.role value onto a capability tier.
export function capabilityRoleFor(dbRole: string | null | undefined): CapabilityRole {
  return dbRole === 'employee' ? 'employee' : 'manager'
}

// What anyone can ask for about their own work life.
const EMPLOYEE_ACTIONS = [
  'Request time off, or check where a request stands',
  'Change your availability — including just until a date, or on a repeating schedule',
  'Ask about your own shifts',
  'Swap a shift with a coworker, or accept/decline a swap someone asks you about',
]

// What managers/owners can do (on top of the personal actions above) — the full
// Soteria + Aegis manager surface, in plain English.
const MANAGER_ACTIONS = [
  'Build a schedule and send it out to the team',
  'Approve or deny time-off and availability requests',
  "Arrange emergency coverage when someone can't make a shift",
  'Set up your team — add or edit employees, roles, wages, and shifts',
  'Set staffing rules — like requiring veterans on a shift, who can\'t work together, or sharing hours fairly',
  'Ask about staffing, coverage, and your current setup',
]

// ── D6 — WHO ACTUALLY DOES WHAT ──────────────────────────────────────────────
//
// The lists above describe the PRODUCT (Soteria + Aegis together). They are
// correct as an answer to "what can this thing do for me?" — and that is the
// only thing they should ever be used for.
//
// They were ALSO being injected into Soteria's system prompt under the heading
// "WHAT YOU CAN DO FOR THIS USER". So the model read "Approve or deny time-off",
// "Arrange emergency coverage" and "Swap a shift" as things SHE could do.
// She has no executor for ANY of the three. A manager who asked hit a dead end,
// or watched her improvise a confirmation for something that never happened.
//
// The fix is not to build those actions. It is to stop claiming them.
//
// PRODUCT DECISION (Alexander, 2026-07-13):
//   "Realistically she probably shouldn't be able to approve time off, arrange
//    coverage, or swap shifts. Those are all real Aegis features, and we want
//    managers using Aegis for the correct things — not just using Soteria all
//    the time, because that defeats the purpose of having an AI assistant who
//    works outside of a website they have to learn. Soteria is just for back-end
//    stuff and configuring information inside Homebase so Aegis works correctly.
//    But being able to tell Aegis to distribute the schedule, or publish it, or
//    create it, is important. And the language in the chats should make it
//    explicitly clear that she can ASK AEGIS to do those things — not that she
//    does them for you."
//
// So: Soteria configures. Aegis converses. Soteria may ASK Aegis to run the
// schedule pipeline. Anything else that belongs to Aegis, she hands off — she
// does not pretend, and she does not dead-end.

/** Things Soteria performs herself, in Homebase. She has a real executor for each. */
const SOTERIA_DOES = [
  'Add, edit, or remove employees, roles, wages, and shifts',
  'Set the staffing rules the schedule engine follows — veteran requirements, who should not work together, fair-hours weighting, doubles, week start',
  'Set up special events and their staffing changes',
  'Answer questions about staffing, coverage, and the current setup',
  'Configure the business from an uploaded handbook or policy document',
]

/** Things ONLY Aegis does — over email (and SMS once A2P clears). Soteria has NO executor for these. */
const AEGIS_DOES = [
  'Approving or denying time-off and availability requests',
  "Arranging emergency coverage when someone can't make a shift",
  'Shift swaps between employees',
  'Onboarding new employees and collecting their availability',
  'Talking to employees directly',
]

/** The schedule pipeline: Soteria does not do these herself — she ASKS AEGIS to. */
const SOTERIA_CAN_ASK_AEGIS_TO = [
  'Build the schedule for a week',
  'Publish a schedule',
  'Send the schedule out to the team',
]

/**
 * Injected into Soteria's system prompt. This is the guardrail that stops her
 * claiming Aegis's job as her own. It is deliberately blunt: an LLM will happily
 * improvise around a soft hint, so the boundary is stated as a rule, with the
 * exact words to use when she hands off.
 */
export function soteriaScopeSection(): string {
  return `WHO DOES WHAT — THIS IS A HARD BOUNDARY, NOT A PREFERENCE.

You are Soteria. You are the manager's back-office assistant INSIDE Homebase. You configure
the business so that Aegis — the assistant who talks to employees over email — works correctly.

WHAT YOU DO YOURSELF (you have real actions for these):
${SOTERIA_DOES.map((i) => `- ${i}`).join('\n')}

WHAT YOU CAN ASK AEGIS TO DO (you raise an action card; Aegis performs it):
${SOTERIA_CAN_ASK_AEGIS_TO.map((i) => `- ${i}`).join('\n')}
When you do one of these, SAY SO PLAINLY: "I'll ask Aegis to build next week's schedule."
NOT "I'll build it." You are asking him. Aegis does the work.

WHAT YOU CANNOT DO — THESE BELONG TO AEGIS:
${AEGIS_DOES.map((i) => `- ${i}`).join('\n')}
You have NO action for any of these. Never claim to have done one. Never say "done",
"approved", "I've arranged that", or "I've let them know" about any of them.

IF A MANAGER ASKS YOU FOR ONE OF AEGIS'S JOBS:
Do not dead-end, and do not pretend. Say plainly that Aegis handles it, and tell them how to
reach him — they just email Aegis, the same way they'd message a person. Example:
  "That one's Aegis's job, not mine — he's the one who actually talks to the team. Email him
   and say 'approve Jordan's time off for the 14th' and he'll take it from there. What I CAN
   do is make sure the rules he's working from are right."
Then offer something you genuinely can do.

WHY THIS BOUNDARY EXISTS: the whole point of Aegis is that a manager never has to learn a
website. If you quietly absorb his job, the manager ends up living in Homebase and the product
loses its reason to exist. Keep them talking to Aegis.`
}

export function capabilityGroups(role: CapabilityRole): { heading: string; items: string[] }[] {
  const groups: { heading: string; items: string[] }[] = [
    { heading: role === 'manager' ? 'For your own schedule' : 'Here to help with', items: EMPLOYEE_ACTIONS },
  ]
  if (role === 'manager') groups.push({ heading: 'As a manager', items: MANAGER_ACTIONS })
  return groups
}

// A compact, prompt-ready block describing the user's capabilities, injected
// into Soteria's system prompt so it answers "what can you do?" / "help" from
// this canonical list and redirects out-of-scope asks back to it.
export function capabilitySection(role: CapabilityRole): string {
  const groups = capabilityGroups(role)
  const body = groups
    .map((g) => `${g.heading}:\n${g.items.map((i) => `- ${i}`).join('\n')}`)
    .join('\n\n')
  return body
}
