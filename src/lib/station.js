// Constantes et helpers partagés par la page Station (station-service) :
// carburant, lubrifiants, gaz, récapitulatif, import. Centralisés ici pour
// éviter la duplication entre les composants Station* et stationExcel.

import { periodLabel } from './period'
import { todayISO } from './excelHelpers'

export const CARBURANT_PRODUCTS = ['Gasoil', 'Essence']
export const GAZ_PRODUCTS = ['B13', 'B06', 'B03', 'Autre']
export const LUB_UNITS = ['L', 'KG', 'Bidon', 'Fût']

export const STATION_PAYMENT_STATUS = ['Payé', 'Non payé']
// Mode de paiement facultatif ; "Versement" = acompte comptant.
export const STATION_PAYMENT_MODES = ['Espèces', 'Chèque', 'Virement', 'Versement']

export function formatDA(value) {
  return Number(value || 0).toLocaleString('fr-FR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
}

export function formatQty(value) {
  return Number(value || 0).toLocaleString('fr-FR', { maximumFractionDigits: 2 })
}

// Total HT d'une ligne (produit seul) et total encaissable (gaz : + consigne).
export function lineTotalHt(quantity, unitPrice) {
  return (Number(quantity) || 0) * (Number(unitPrice) || 0)
}

export function gazTotalWithConsigne(quantity, unitPrice, consigne) {
  return lineTotalHt(quantity, unitPrice) + (Number(consigne) || 0)
}

export function isUnpaid(row) {
  return (row.payment_status ?? 'Non payé') === 'Non payé'
}

export function paymentLabel(row) {
  const status = row.payment_status ?? 'Non payé'
  if (!row.payment_mode) return status
  if (row.payment_mode === 'Chèque' && row.cheque_number) {
    return `${status} — Chèque n° ${row.cheque_number}${row.cheque_bank ? ` (${row.cheque_bank})` : ''}`
  }
  return `${status} — ${row.payment_mode}`
}

// --- Fiche client : relevé combiné carburant + lubrifiants + gaz -----------
// `data` = { carburant: [...], lubrifiants: [...], gaz: [...] } (lignes déjà
// chargées). Réutilisé par EntitySheetModal (impression + export Excel).
export function buildStationClientSheet(data, name, startDate, endDate) {
  const nameU = name.trim().toUpperCase()
  const inRange = (d) => (!startDate || d >= startDate) && (!endDate || d <= endDate)
  const match = (r) => String(r.client_name ?? '').trim().toUpperCase() === nameU && inRange(r.entry_date)

  const rows = []
  for (const r of data.carburant ?? []) {
    if (!match(r)) continue
    rows.push({
      entry_date: r.entry_date,
      famille: 'Carburant',
      designation: r.product,
      quantite: Number(r.quantity) || 0,
      unit_price: Number(r.unit_price) || 0,
      total: Number(r.total_ht) || 0,
      paiement: r.payment_status ?? 'Non payé',
    })
  }
  for (const r of data.lubrifiants ?? []) {
    if (!match(r)) continue
    rows.push({
      entry_date: r.entry_date,
      famille: 'Lubrifiant',
      designation: `${r.product}${r.unit ? ` (${r.unit})` : ''}`,
      quantite: Number(r.quantity) || 0,
      unit_price: Number(r.unit_price) || 0,
      total: Number(r.total_ht) || 0,
      paiement: r.payment_status ?? 'Non payé',
    })
  }
  for (const r of data.gaz ?? []) {
    if (!match(r)) continue
    rows.push({
      entry_date: r.entry_date,
      famille: 'Gaz',
      designation: r.product,
      quantite: Number(r.quantity) || 0,
      unit_price: Number(r.unit_price) || 0,
      total: Number(r.total_with_consigne) || Number(r.total_ht) || 0,
      paiement: r.payment_status ?? 'Non payé',
    })
  }

  if (rows.length === 0) {
    return { error: `Aucune opération trouvée pour « ${name} » sur cette période.` }
  }

  rows.sort((a, b) => (a.entry_date < b.entry_date ? -1 : a.entry_date > b.entry_date ? 1 : 0))

  const columns = [
    { key: 'entry_date', header: 'Date' },
    { key: 'famille', header: 'Famille' },
    { key: 'designation', header: 'Désignation' },
    { key: 'quantite', header: 'Qté', align: 'right', format: (v) => formatQty(v) },
    { key: 'unit_price', header: 'P.U. (DA)', align: 'right', format: (v) => formatDA(v) },
    { key: 'total', header: 'Total (DA)', align: 'right', format: (v) => formatDA(v) },
    { key: 'paiement', header: 'Paiement' },
  ]

  const totalGeneral = rows.reduce((s, r) => s + r.total, 0)
  const paye = rows.filter((r) => r.paiement === 'Payé').reduce((s, r) => s + r.total, 0)
  const reste = totalGeneral - paye

  return {
    title: `Relevé client station — ${name}`,
    periodLabel: periodLabel(startDate, endDate),
    columns,
    rows,
    totalRows: [
      { cells: { entry_date: `${rows.length} opération(s)`, total: totalGeneral }, highlight: true },
      { cells: { entry_date: 'PAYÉ', total: paye } },
      { cells: { entry_date: 'RESTE À PAYER', total: reste }, highlight: true },
    ],
    excelFilename: `Fiche_Station_${name.replace(/\s+/g, '_')}_${todayISO()}.xlsx`,
  }
}

// --- Récapitulatif par client (sur une période) --------------------------
// Agrège les 3 tables. Renvoie une ligne par client ayant au moins une
// opération sur la période, triée par nom.
export function buildStationRecap({ carburant, lubrifiants, gaz }, startDate, endDate) {
  const inRange = (d) => (!startDate || d >= startDate) && (!endDate || d <= endDate)
  const map = new Map()
  const get = (name) => {
    const key = String(name ?? '').trim().toUpperCase()
    if (!key) return null
    if (!map.has(key)) {
      map.set(key, {
        client: key,
        total_carburant: 0,
        total_lubrifiants: 0,
        total_gaz: 0,
        total_general: 0,
        paye: 0,
        reste: 0,
      })
    }
    return map.get(key)
  }

  const add = (rows, field) => {
    for (const r of rows ?? []) {
      if (!inRange(r.entry_date)) continue
      const row = get(r.client_name)
      if (!row) continue
      const ht = Number(r.total_ht) || 0
      row[field] += ht
      row.total_general += ht
      if ((r.payment_status ?? 'Non payé') === 'Payé') row.paye += ht
      else row.reste += ht
    }
  }

  add(carburant, 'total_carburant')
  add(lubrifiants, 'total_lubrifiants')
  add(gaz, 'total_gaz')

  return [...map.values()].sort((a, b) => a.client.localeCompare(b.client))
}

export const RECAP_COLUMNS = [
  { key: 'client', header: 'Client', label: 'Client' },
  { key: 'total_carburant', header: 'Carburant HT', label: 'Carburant HT', align: 'right', format: (v) => formatDA(v) },
  { key: 'total_lubrifiants', header: 'Lubrifiants HT', label: 'Lubrifiants HT', align: 'right', format: (v) => formatDA(v) },
  { key: 'total_gaz', header: 'Gaz HT', label: 'Gaz HT', align: 'right', format: (v) => formatDA(v) },
  { key: 'total_general', header: 'Total général HT', label: 'Total général HT', align: 'right', format: (v) => formatDA(v) },
  { key: 'paye', header: 'Payé', label: 'Payé', align: 'right', format: (v) => formatDA(v) },
  { key: 'reste', header: 'Reste à payer', label: 'Reste à payer', align: 'right', format: (v) => formatDA(v) },
]
