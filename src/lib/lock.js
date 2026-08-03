export const EDIT_LOCK_HOURS = 72
export const LOCK_MESSAGE = 'Modification impossible après 72h'

export function isLocked(entry) {
  const ageMs = Date.now() - new Date(entry.created_at).getTime()
  return ageMs > EDIT_LOCK_HOURS * 3600 * 1000
}
