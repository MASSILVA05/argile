import { FIXED_WEIGHT_TYPE, rateFor } from './unloadingTypes'

const HEADERS = [
  'N° Bon',
  'Date',
  'Matricule',
  'Nom du chauffeur',
  'DPR AXXAM Location (T)',
  'Akbou (T)',
  'DPR AXXAM 22T (T)',
  'N° Ticket de pesée',
  'Observations',
]

function escapeCsvField(value) {
  const str = value == null ? '' : String(value)
  if (/[",;\n]/.test(str)) {
    return `"${str.replace(/"/g, '""')}"`
  }
  return str
}

function weightByType(entry, type) {
  return entry.unloading_type === type && entry.weight_tons != null ? Number(entry.weight_tons) : ''
}

function entryToRow(entry) {
  return [
    entry.bon_number,
    entry.entry_date,
    entry.truck_plate,
    entry.driver_name,
    weightByType(entry, 'DPR AXXAM Location'),
    weightByType(entry, 'Akbou'),
    weightByType(entry, FIXED_WEIGHT_TYPE),
    entry.ticket_number,
    entry.observations,
  ]
}

function sumByType(entries, type) {
  return entries
    .filter((e) => e.unloading_type === type)
    .reduce((sum, e) => sum + (Number(e.weight_tons) || 0), 0)
}

export function entriesToCsv(entries) {
  const headerRow = HEADERS.map(escapeCsvField).join(';')
  const rows = entries.map((entry) => entryToRow(entry).map(escapeCsvField).join(';'))

  const locationTotal = sumByType(entries, 'DPR AXXAM Location')
  const akbouTotal = sumByType(entries, 'Akbou')
  const fixedTotal = sumByType(entries, FIXED_WEIGHT_TYPE)

  const totalsRow = [
    'TOTAL',
    '',
    '',
    '',
    locationTotal.toFixed(2),
    akbouTotal.toFixed(2),
    fixedTotal.toFixed(2),
    '',
    '',
  ]
    .map(escapeCsvField)
    .join(';')

  const amountsRow = [
    'MONTANT (DA)',
    '',
    '',
    '',
    Math.round(locationTotal * rateFor('DPR AXXAM Location')),
    Math.round(akbouTotal * rateFor('Akbou')),
    '',
    '',
    '',
  ]
    .map(escapeCsvField)
    .join(';')

  return [headerRow, ...rows, totalsRow, amountsRow].join('\r\n')
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
