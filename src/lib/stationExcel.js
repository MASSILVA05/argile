import ExcelJS from 'exceljs'
import { saveAs } from 'file-saver'
import {
  DATA_ROW_HEIGHT,
  PHOTO_ROW_HEIGHT,
  PHOTO_WIDTH,
  PHOTO_HEIGHT,
  AMOUNT_ROW_FILL,
  todayISO,
  fetchPhotoAsBase64,
  styleHeaderRow,
  styleDataRow,
  styleTotalsRow,
} from './excelHelpers'
import { formatDateTime } from './dateFormat'
import { RECAP_COLUMNS, formatMonth, hourlyRate } from './station'

function toBlob(buffer) {
  return new Blob([buffer], {
    type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  })
}

const BASE_COLUMNS = [
  { header: 'Date', key: 'entry_date', width: 12 },
  { header: 'Heure', key: 'entry_time', width: 9 },
  { header: 'Saisie le', key: 'created_at', width: 17 },
  { header: 'Client', key: 'client_name', width: 24 },
  { header: 'Produit', key: 'product', width: 16 },
]

const TAIL_COLUMNS = [
  { header: 'Statut paiement', key: 'payment_status', width: 14 },
  { header: 'Mode de paiement', key: 'payment_mode', width: 16 },
  { header: 'N° chèque', key: 'cheque_number', width: 14 },
  { header: 'Banque', key: 'cheque_bank', width: 16 },
  { header: 'Observations', key: 'observations', width: 28 },
  { header: 'Saisi par', key: 'entered_by_user', width: 14 },
]

function baseRow(r) {
  return {
    entry_date: r.entry_date,
    entry_time: r.entry_time ? r.entry_time.slice(0, 5) : '',
    created_at: formatDateTime(r.created_at),
    client_name: r.client_name ?? '',
    product: r.product ?? '',
    payment_status: r.payment_status ?? '',
    payment_mode: r.payment_mode ?? '',
    cheque_number: r.cheque_number ?? '',
    cheque_bank: r.cheque_bank ?? '',
    observations: r.observations ?? '',
    entered_by_user: r.entered_by_user ?? '',
  }
}

async function writeSheet(sheetName, columns, rows, totalRows, filename) {
  const workbook = new ExcelJS.Workbook()
  const sheet = workbook.addWorksheet(sheetName)
  sheet.columns = columns
  styleHeaderRow(sheet.getRow(1))
  sheet.getRow(1).height = DATA_ROW_HEIGHT
  sheet.views = [{ state: 'frozen', ySplit: 1 }]

  for (const data of rows) {
    const row = sheet.addRow(data)
    styleDataRow(row)
    row.height = DATA_ROW_HEIGHT
  }
  for (const { data, fill } of totalRows) {
    const row = sheet.addRow(data)
    styleTotalsRow(row, fill)
    row.height = DATA_ROW_HEIGHT
  }

  const buffer = await workbook.xlsx.writeBuffer()
  saveAs(toBlob(buffer), filename)
}

export async function downloadStationCarburantExcel(rows, { filename } = {}) {
  const columns = [
    ...BASE_COLUMNS,
    { header: 'Pompe', key: 'pompe', width: 10 },
    { header: 'Quantité (L)', key: 'quantity', width: 13 },
    { header: 'Prix U. (DA)', key: 'unit_price', width: 13 },
    { header: 'Total HT (DA)', key: 'total_ht', width: 15 },
    ...TAIL_COLUMNS,
  ]
  const data = rows.map((r) => ({
    ...baseRow(r),
    pompe: r.pompe ?? '',
    quantity: Number(r.quantity) || 0,
    unit_price: Number(r.unit_price) || 0,
    total_ht: Number(r.total_ht) || 0,
  }))
  const totalQty = data.reduce((s, r) => s + r.quantity, 0)
  const totalHt = data.reduce((s, r) => s + r.total_ht, 0)
  const reste = rows
    .filter((r) => (r.payment_status ?? 'Non payé') === 'Non payé')
    .reduce((s, r) => s + (Number(r.total_ht) || 0), 0)
  await writeSheet(
    'Carburant',
    columns,
    data,
    [
      { data: { entry_date: 'TOTAUX', quantity: totalQty, total_ht: totalHt }, fill: null },
      { data: { entry_date: 'RESTE À PAYER', total_ht: reste }, fill: AMOUNT_ROW_FILL },
    ],
    filename || `Ventes_Carburant_Station_${todayISO()}.xlsx`
  )
}

export async function downloadStationLubrifiantsExcel(rows, { filename } = {}) {
  const columns = [
    ...BASE_COLUMNS,
    { header: 'Quantité', key: 'quantity', width: 12 },
    { header: 'Unité', key: 'unit', width: 9 },
    { header: 'Prix U. (DA)', key: 'unit_price', width: 13 },
    { header: 'Total HT (DA)', key: 'total_ht', width: 15 },
    ...TAIL_COLUMNS,
  ]
  const data = rows.map((r) => ({
    ...baseRow(r),
    quantity: Number(r.quantity) || 0,
    unit: r.unit ?? '',
    unit_price: Number(r.unit_price) || 0,
    total_ht: Number(r.total_ht) || 0,
  }))
  const totalHt = data.reduce((s, r) => s + r.total_ht, 0)
  const reste = rows
    .filter((r) => (r.payment_status ?? 'Non payé') === 'Non payé')
    .reduce((s, r) => s + (Number(r.total_ht) || 0), 0)
  await writeSheet(
    'Lubrifiants',
    columns,
    data,
    [
      { data: { entry_date: 'TOTAUX', total_ht: totalHt }, fill: null },
      { data: { entry_date: 'RESTE À PAYER', total_ht: reste }, fill: AMOUNT_ROW_FILL },
    ],
    filename || `Ventes_Lubrifiants_Station_${todayISO()}.xlsx`
  )
}

export async function downloadStationGazExcel(rows, { filename } = {}) {
  const columns = [
    ...BASE_COLUMNS,
    { header: 'Quantité', key: 'quantity', width: 11 },
    { header: 'Prix U. (DA)', key: 'unit_price', width: 13 },
    { header: 'Total HT (DA)', key: 'total_ht', width: 15 },
    { header: 'Consigne (DA)', key: 'consigne', width: 13 },
    { header: 'Total + consigne (DA)', key: 'total_with_consigne', width: 18 },
    ...TAIL_COLUMNS,
  ]
  const data = rows.map((r) => ({
    ...baseRow(r),
    quantity: Number(r.quantity) || 0,
    unit_price: Number(r.unit_price) || 0,
    total_ht: Number(r.total_ht) || 0,
    consigne: Number(r.consigne) || 0,
    total_with_consigne: Number(r.total_with_consigne) || 0,
  }))
  const totalQty = data.reduce((s, r) => s + r.quantity, 0)
  const totalHt = data.reduce((s, r) => s + r.total_ht, 0)
  const totalConsigne = data.reduce((s, r) => s + r.consigne, 0)
  const reste = rows
    .filter((r) => (r.payment_status ?? 'Non payé') === 'Non payé')
    .reduce((s, r) => s + (Number(r.total_ht) || 0), 0)
  await writeSheet(
    'Gaz',
    columns,
    data,
    [
      {
        data: { entry_date: 'TOTAUX', quantity: totalQty, total_ht: totalHt, consigne: totalConsigne },
        fill: null,
      },
      { data: { entry_date: 'RESTE À PAYER', total_ht: reste }, fill: AMOUNT_ROW_FILL },
    ],
    filename || `Ventes_Gaz_Station_${todayISO()}.xlsx`
  )
}

// --- Salaires ----------------------------------------------------------
export async function downloadStationSalairesExcel(rows, { filename } = {}) {
  const columns = [
    { header: 'Mois', key: 'mois', width: 16 },
    { header: 'Employé', key: 'employee_name', width: 26 },
    { header: "Nbr d'heures", key: 'hours', width: 13 },
    { header: 'Salaire net (DA)', key: 'net_salary', width: 16 },
    { header: 'Taux horaire (DA)', key: 'hourly_rate', width: 15 },
    { header: 'IRG (DA)', key: 'irg_amount', width: 12 },
    { header: 'Observations', key: 'observations', width: 28 },
    { header: 'Saisi par', key: 'entered_by_user', width: 14 },
    { header: 'Saisie le', key: 'created_at', width: 17 },
  ]
  const sorted = [...rows].sort((a, b) =>
    a.period < b.period ? -1 : a.period > b.period ? 1 : String(a.employee_name).localeCompare(b.employee_name)
  )
  const data = sorted.map((r) => ({
    mois: formatMonth(r.period),
    employee_name: r.employee_name ?? '',
    hours: Number(r.hours) || 0,
    net_salary: Number(r.net_salary) || 0,
    hourly_rate: Number(r.hourly_rate) || hourlyRate(r.hours, r.net_salary),
    irg_amount: r.irg_amount == null ? '' : Number(r.irg_amount),
    observations: r.observations ?? '',
    entered_by_user: r.entered_by_user ?? '',
    created_at: formatDateTime(r.created_at),
  }))
  const totalHeures = data.reduce((s, r) => s + r.hours, 0)
  const totalNet = data.reduce((s, r) => s + r.net_salary, 0)
  const totalIrg = data.reduce((s, r) => s + (Number(r.irg_amount) || 0), 0)
  await writeSheet(
    'Salaires',
    columns,
    data,
    [
      {
        data: { mois: 'TOTAUX', hours: totalHeures, net_salary: totalNet, irg_amount: totalIrg || '' },
        fill: AMOUNT_ROW_FILL,
      },
    ],
    filename || `Salaires_Station_${todayISO()}.xlsx`
  )
}

// --- Récapitulatif par client ------------------------------------------
export async function downloadStationRecapExcel(recapRows, { filename } = {}) {
  const columns = RECAP_COLUMNS.map((c) => ({ header: c.header, key: c.key, width: 18 }))
  const data = recapRows.map((r) => ({ ...r }))
  const sum = (key) => data.reduce((s, r) => s + (Number(r[key]) || 0), 0)
  await writeSheet(
    'Récapitulatif',
    columns,
    data,
    [
      {
        data: {
          client: 'TOTAUX',
          total_carburant: sum('total_carburant'),
          total_lubrifiants: sum('total_lubrifiants'),
          total_gaz: sum('total_gaz'),
          total_general: sum('total_general'),
          paye: sum('paye'),
          reste: sum('reste'),
        },
        fill: AMOUNT_ROW_FILL,
      },
    ],
    filename || `Recap_Station_${todayISO()}.xlsx`
  )
}

// --- Compteurs de pompe --------------------------------------------------
const COMPTEURS_COLUMNS = [
  { header: 'Date', key: 'entry_date', width: 12 },
  { header: 'Heure', key: 'entry_time', width: 9 },
  { header: 'Saisie le', key: 'created_at', width: 17 },
  { header: 'Pompe', key: 'pompe', width: 10 },
  { header: 'Type de relevé', key: 'type_releve', width: 16 },
  { header: 'Index compteur', key: 'index_compteur', width: 15 },
  { header: 'Photo', key: 'photo', width: 20 },
  { header: 'Opérateur', key: 'operateur', width: 20 },
  { header: 'Observations', key: 'observations', width: 28 },
  { header: 'Saisi par', key: 'entered_by_user', width: 14 },
]
const COMPTEURS_PHOTO_COL_INDEX = COMPTEURS_COLUMNS.findIndex((c) => c.key === 'photo') + 1

export async function downloadStationCompteursExcel(rows, { onProgress, includePhotos = true, filename } = {}) {
  const workbook = new ExcelJS.Workbook()
  const sheet = workbook.addWorksheet('Compteurs')
  sheet.columns = COMPTEURS_COLUMNS
  styleHeaderRow(sheet.getRow(1))
  sheet.getRow(1).height = DATA_ROW_HEIGHT
  sheet.views = [{ state: 'frozen', ySplit: 1 }]

  const withPhoto = includePhotos ? rows.filter((r) => r.photo_url) : []
  const totalPhotos = withPhoto.length
  let processedPhotos = 0

  for (const r of rows) {
    const row = sheet.addRow({
      entry_date: r.entry_date,
      entry_time: r.entry_time ? r.entry_time.slice(0, 5) : '',
      created_at: formatDateTime(r.created_at),
      pompe: r.pompe,
      type_releve: r.type_releve,
      index_compteur: Number(r.index_compteur) || 0,
      photo: includePhotos ? '' : r.photo_url ? 'Oui' : 'Non',
      operateur: r.operateur ?? '',
      observations: r.observations ?? '',
      entered_by_user: r.entered_by_user ?? '',
    })
    styleDataRow(row)
    row.height = DATA_ROW_HEIGHT

    if (includePhotos && r.photo_url) {
      try {
        const { base64, extension } = await fetchPhotoAsBase64(r.photo_url)
        const imageId = workbook.addImage({ base64, extension })
        sheet.addImage(imageId, {
          tl: { col: COMPTEURS_PHOTO_COL_INDEX - 1, row: row.number - 1 },
          ext: { width: PHOTO_WIDTH, height: PHOTO_HEIGHT },
        })
        row.height = PHOTO_ROW_HEIGHT
      } catch {
        row.getCell(COMPTEURS_PHOTO_COL_INDEX).value = 'Photo non disponible'
      }
      processedPhotos += 1
      onProgress?.(processedPhotos, totalPhotos)
    }
  }

  const buffer = await workbook.xlsx.writeBuffer()
  saveAs(toBlob(buffer), filename || `Compteurs_Station_${todayISO()}.xlsx`)
}
