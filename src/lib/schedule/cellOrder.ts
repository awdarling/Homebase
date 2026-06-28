// #9 — schedule ordering + download/preview parity.
//
// Within a single cell (a shift on a day), people were ordered alphabetically
// by NAME in the download and email, and in raw engine order on screen — so the
// three never matched. This orders cell members by ROLE first (grouping the same
// roles together), then by name. Used by the download grid, the emailed grid,
// and the on-screen renderer so all three read identically.

export function compareByRoleThenName(
  a: { role?: string; employee_name?: string },
  b: { role?: string; employee_name?: string },
): number {
  return (a.role ?? '').localeCompare(b.role ?? '')
    || (a.employee_name ?? '').localeCompare(b.employee_name ?? '')
}

export function sortByRoleThenName<T extends { role?: string; employee_name?: string }>(list: T[]): T[] {
  return [...list].sort(compareByRoleThenName)
}
