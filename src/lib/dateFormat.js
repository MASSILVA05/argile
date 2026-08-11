// Formate un timestamp Supabase (created_at, timestamptz) en heure locale,
// pour distinguer la date du bon (entry_date, choisie par l'employé) de la
// date/heure réelle de saisie -- colonne "Saisie le" des registres.
export function formatDateTime(isoString) {
  if (!isoString) return '—'
  const d = new Date(isoString)
  if (Number.isNaN(d.getTime())) return '—'
  const pad = (n) => String(n).padStart(2, '0')
  return `${pad(d.getDate())}/${pad(d.getMonth() + 1)}/${d.getFullYear()} ${pad(d.getHours())}:${pad(d.getMinutes())}`
}
