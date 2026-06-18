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
