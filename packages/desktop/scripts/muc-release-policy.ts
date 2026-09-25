import { compare, valid } from "semver"

/** Stable feeds are rolling pointers; allow a strictly newer release and reject duplicates/downgrades. */
export function canPublishMucRelease(current: string | undefined, candidate: string): boolean {
  if (!valid(candidate)) return false
  if (current === undefined) return true
  if (!valid(current)) return false
  return compare(candidate, current) > 0
}
