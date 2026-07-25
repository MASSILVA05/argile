const HEADERS = [
  ['bon_number', 'N° Bon'],
  ['entry_date', "Date d'entrée"],
  ['truck_plate', 'Matricule'],
  ['driver_name', 'Chauffeur'],
  ['unloading_location', 'Lieu de déchargement'],
  ['weight_tons', 'Poids (T)'],
  ['observations', 'Observations'],
]

function escapeCsvField(value) {
  const str = value == null ? '' : String(value)
  if (/[",;\n]/.test(str)) {
    return `"${str.replace(/"/g, '""')}"`
  }
  return str
}

export function entriesToCsv(entries) {
  const headerRow = HEADERS.map(([, label]) => escapeCsvField(label)).join(';')
  const rows = entries.map((entry) =>
    HEADERS.map(([key]) => escapeCsvField(entry[key])).join(';')
  )
  return [headerRow, ...rows].join('\r\n')
}

export function downloadCsv(entries, filename = 'registre-chargement.csv') {
  const csv = entriesToCsv(entries)
  const blob = new Blob(['﻿' + csv], { type: 'text/csv;charset=utf-8;' })
  const url = URL.createObjectURL(blob)
  const link = document.createElement('a')
  link.href = url
  link.download = filename
  document.body.appendChild(link)
  link.click()
  document.body.removeChild(link)
  URL.revokeObjectURL(url)
}
