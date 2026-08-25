// Helpers de période partagés par les modales "Fiche" (EntitySheetModal) --
// même logique que les boutons rapides déjà présents dans ExportFilterModal,
// centralisée ici pour être réutilisée sans duplication, avec en plus
// trimestre/année demandés pour les fiches.

export function todayISO() {
  return new Date().toISOString().slice(0, 10)
}

export function startOfWeekISO() {
  const d = new Date()
  const day = (d.getDay() + 6) % 7 // 0 = lundi
  d.setDate(d.getDate() - day)
  return d.toISOString().slice(0, 10)
}

export function endOfWeekISO() {
  const d = new Date()
  const day = (d.getDay() + 6) % 7
  d.setDate(d.getDate() + (6 - day))
  return d.toISOString().slice(0, 10)
}

export function startOfMonthISO() {
  const d = new Date()
  return new Date(d.getFullYear(), d.getMonth(), 1).toISOString().slice(0, 10)
}

export function endOfMonthISO() {
  const d = new Date()
  return new Date(d.getFullYear(), d.getMonth() + 1, 0).toISOString().slice(0, 10)
}

export function startOfQuarterISO() {
  const d = new Date()
  const quarterMonth = Math.floor(d.getMonth() / 3) * 3
  return new Date(d.getFullYear(), quarterMonth, 1).toISOString().slice(0, 10)
}

export function endOfQuarterISO() {
  const d = new Date()
  const quarterMonth = Math.floor(d.getMonth() / 3) * 3
  return new Date(d.getFullYear(), quarterMonth + 3, 0).toISOString().slice(0, 10)
}

export function startOfYearISO() {
  const d = new Date()
  return new Date(d.getFullYear(), 0, 1).toISOString().slice(0, 10)
}

export function endOfYearISO() {
  const d = new Date()
  return new Date(d.getFullYear(), 11, 31).toISOString().slice(0, 10)
}

export const QUICK_PERIODS = [
  { id: 'today', label: "Aujourd'hui", range: () => [todayISO(), todayISO()] },
  { id: 'week', label: 'Cette semaine', range: () => [startOfWeekISO(), endOfWeekISO()] },
  { id: 'month', label: 'Ce mois', range: () => [startOfMonthISO(), endOfMonthISO()] },
  { id: 'quarter', label: 'Ce trimestre', range: () => [startOfQuarterISO(), endOfQuarterISO()] },
  { id: 'year', label: 'Cette année', range: () => [startOfYearISO(), endOfYearISO()] },
  { id: 'all', label: 'Tout', range: () => ['', ''] },
]

export function defaultPeriod() {
  return { startDate: startOfMonthISO(), endDate: endOfMonthISO() }
}

export function formatDateFR(iso) {
  if (!iso) return ''
  const [y, m, d] = iso.split('-')
  return `${d}/${m}/${y}`
}

export function periodLabel(startDate, endDate) {
  if (!startDate && !endDate) return 'Toute la période'
  if (startDate && endDate) return `Période du ${formatDateFR(startDate)} au ${formatDateFR(endDate)}`
  if (startDate) return `À partir du ${formatDateFR(startDate)}`
  return `Jusqu'au ${formatDateFR(endDate)}`
}
