export function applyExportFilters(
  entries,
  { startDate, endDate, categoricalField, categoricalValues, textValues, dateField = 'entry_date' }
) {
  return entries.filter((e) => {
    const dateValue = e[dateField]
    if (startDate && dateValue < startDate) return false
    if (endDate && dateValue > endDate) return false
    if (categoricalField && categoricalValues && !categoricalValues.includes(e[categoricalField])) return false
    if (textValues) {
      for (const [field, value] of Object.entries(textValues)) {
        if (value && !String(e[field] ?? '').toLowerCase().includes(value.trim().toLowerCase())) return false
      }
    }
    return true
  })
}

export function buildExportFilename(prefix, startDate, endDate) {
  const period = !startDate && !endDate ? 'Toutes_dates' : `${startDate || 'debut'}_au_${endDate || 'fin'}`
  return `${prefix}_${period}.xlsx`
}
