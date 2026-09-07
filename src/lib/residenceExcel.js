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
import { rcCategoryLabel, rcSignedAmount, nightsBetween } from './residence'

function toBlob(buffer) {
  return new Blob([buffer], {
    type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  })
}

// --- Réservations ----------------------------------------------------------
const RESA_COLUMNS = [
  { header: 'Logement', key: 'unit_nom', width: 18 },
  { header: 'Code', key: 'unit_code', width: 12 },
  { header: 'Résidence', key: 'residence', width: 14 },
  { header: 'Client', key: 'client_name', width: 24 },
  { header: 'Téléphone', key: 'client_phone', width: 16 },
  { header: 'Personnes', key: 'nb_personnes', width: 11 },
  { header: 'Arrivée', key: 'date_arrivee', width: 13 },
  { header: 'Départ', key: 'date_depart', width: 13 },
  { header: 'Nuits', key: 'nb_nuits', width: 8 },
  { header: 'Prix / nuit (DA)', key: 'prix_nuit', width: 15 },
  { header: 'Montant total (DA)', key: 'montant_total', width: 17 },
  { header: 'Arrhes (DA)', key: 'arrhes', width: 13 },
  { header: 'Reste à payer (DA)', key: 'reste_a_payer', width: 17 },
  { header: 'Mode de paiement', key: 'payment_mode', width: 16 },
  { header: 'Statut', key: 'statut', width: 13 },
  { header: 'Photo', key: 'photo', width: 20 },
  { header: 'Observations', key: 'observations', width: 28 },
  { header: 'Saisi par', key: 'entered_by_user', width: 14 },
  { header: 'Saisie le', key: 'created_at', width: 17 },
]

const RESA_PHOTO_COL = RESA_COLUMNS.findIndex((c) => c.key === 'photo') + 1

export async function downloadResidenceReservationsExcel(
  reservations,
  { onProgress, includePhotos = true, filename } = {}
) {
  const workbook = new ExcelJS.Workbook()
  const sheet = workbook.addWorksheet('Réservations')
  sheet.columns = RESA_COLUMNS
  styleHeaderRow(sheet.getRow(1))
  sheet.getRow(1).height = DATA_ROW_HEIGHT
  sheet.views = [{ state: 'frozen', ySplit: 1 }]

  const withPhoto = includePhotos ? reservations.filter((r) => r.photo_url) : []
  let processed = 0

  for (const r of reservations) {
    const row = sheet.addRow({
      unit_nom: r.unit_nom ?? '',
      unit_code: r.unit_code ?? '',
      residence: r.residence ?? '',
      client_name: r.client_name ?? '',
      client_phone: r.client_phone ?? '',
      nb_personnes: r.nb_personnes ?? '',
      date_arrivee: r.date_arrivee ?? '',
      date_depart: r.date_depart ?? '',
      nb_nuits: r.nb_nuits ?? nightsBetween(r.date_arrivee, r.date_depart),
      prix_nuit: Number(r.prix_nuit) || 0,
      montant_total: Number(r.montant_total) || 0,
      arrhes: Number(r.arrhes) || 0,
      reste_a_payer: Number(r.reste_a_payer) || 0,
      payment_mode: r.payment_mode ?? '',
      statut: r.statut ?? '',
      photo: includePhotos ? '' : r.photo_url ? 'Oui' : 'Non',
      observations: r.observations ?? '',
      entered_by_user: r.entered_by_user ?? '',
      created_at: formatDateTime(r.created_at),
    })
    styleDataRow(row)
    row.height = DATA_ROW_HEIGHT

    if (includePhotos && r.photo_url) {
      try {
        const { base64, extension } = await fetchPhotoAsBase64(r.photo_url)
        const imageId = workbook.addImage({ base64, extension })
        sheet.addImage(imageId, {
          tl: { col: RESA_PHOTO_COL - 1, row: row.number - 1 },
          ext: { width: PHOTO_WIDTH, height: PHOTO_HEIGHT },
        })
        row.height = PHOTO_ROW_HEIGHT
      } catch {
        row.getCell(RESA_PHOTO_COL).value = 'Photo non disponible'
      }
      processed += 1
      onProgress?.(processed, withPhoto.length)
    }
  }

  const sum = (key) => reservations.reduce((s, r) => s + (Number(r[key]) || 0), 0)
  const addTotal = (label, cells, fill) => {
    const r = sheet.addRow({ unit_nom: label, ...cells })
    styleTotalsRow(r, fill)
    r.height = DATA_ROW_HEIGHT
  }
  addTotal('TOTAUX', {
    montant_total: sum('montant_total'),
    arrhes: sum('arrhes'),
    reste_a_payer: sum('reste_a_payer'),
  }, AMOUNT_ROW_FILL)

  const buffer = await workbook.xlsx.writeBuffer()
  saveAs(toBlob(buffer), filename || `Reservations_Residence_${todayISO()}.xlsx`)
}

// --- Clients --------------------------------------------------------------
const CLIENT_COLUMNS = [
  { header: 'Nom client', key: 'name', width: 30 },
  { header: 'Téléphone', key: 'phone', width: 16 },
  { header: 'Nb séjours', key: 'nb_sejours', width: 12 },
  { header: 'Montant total (DA)', key: 'montant_total', width: 20 },
  { header: 'Observations', key: 'observations', width: 30 },
]

export async function downloadResidenceClientsExcel(clients, { filename } = {}) {
  const workbook = new ExcelJS.Workbook()
  const sheet = workbook.addWorksheet('Clients')
  sheet.columns = CLIENT_COLUMNS
  styleHeaderRow(sheet.getRow(1))
  sheet.getRow(1).height = DATA_ROW_HEIGHT
  sheet.views = [{ state: 'frozen', ySplit: 1 }]

  for (const c of clients) {
    const row = sheet.addRow({
      name: c.name ?? '',
      phone: c.phone ?? '',
      nb_sejours: Number(c.nb_sejours) || 0,
      montant_total: Number(c.montant_total) || 0,
      observations: c.observations ?? '',
    })
    styleDataRow(row)
    row.height = DATA_ROW_HEIGHT
  }

  const buffer = await workbook.xlsx.writeBuffer()
  saveAs(toBlob(buffer), filename || `Clients_Residence_${todayISO()}.xlsx`)
}

// --- Caisse résidence ---------------------------------------------------
const CAISSE_COLUMNS = [
  { header: 'N° Bon', key: 'bon_number', width: 10 },
  { header: 'Date', key: 'entry_date', width: 13 },
  { header: 'Heure', key: 'entry_time', width: 9 },
  { header: 'Saisie le', key: 'created_at', width: 17 },
  { header: "Type d'opération", key: 'operation_type', width: 16 },
  { header: 'Motif / Libellé', key: 'description', width: 30 },
  { header: 'Montant (DA)', key: 'amount', width: 16 },
  { header: 'Fournisseur / Bénéficiaire', key: 'beneficiary', width: 24 },
  { header: 'Client', key: 'client_name', width: 22 },
  { header: 'Mode de paiement', key: 'payment_mode', width: 16 },
  { header: 'N° chèque', key: 'cheque_number', width: 14 },
  { header: 'Banque', key: 'cheque_bank', width: 16 },
  { header: 'N° Pièce', key: 'piece_number', width: 14 },
  { header: 'Catégorie', key: 'category', width: 16 },
  { header: 'Photo', key: 'photo', width: 20 },
  { header: 'Saisi par', key: 'entered_by_user', width: 14 },
  { header: 'Observations', key: 'observations', width: 28 },
]

const CAISSE_PHOTO_COL = CAISSE_COLUMNS.findIndex((c) => c.key === 'photo') + 1

export async function downloadResidenceCaisseExcel(
  entries,
  { onProgress, includePhotos = true, filename } = {}
) {
  const workbook = new ExcelJS.Workbook()
  const sheet = workbook.addWorksheet('Caisse résidence')
  sheet.columns = CAISSE_COLUMNS
  styleHeaderRow(sheet.getRow(1))
  sheet.getRow(1).height = DATA_ROW_HEIGHT
  sheet.views = [{ state: 'frozen', ySplit: 1 }]

  const withPhoto = includePhotos ? entries.filter((e) => e.photo_url) : []
  let processed = 0

  for (const entry of entries) {
    const row = sheet.addRow({
      bon_number: entry.bon_number,
      entry_date: entry.entry_date,
      entry_time: entry.entry_time ? entry.entry_time.slice(0, 5) : '',
      created_at: formatDateTime(entry.created_at),
      operation_type: entry.operation_type,
      description: entry.description,
      amount: rcSignedAmount(entry),
      beneficiary: entry.beneficiary ?? '',
      client_name: entry.client_name ?? '',
      payment_mode: entry.payment_mode ?? '',
      cheque_number: entry.cheque_number ?? '',
      cheque_bank: entry.cheque_bank ?? '',
      piece_number: entry.piece_number ?? '',
      category: rcCategoryLabel(entry),
      photo: includePhotos ? '' : entry.photo_url ? 'Oui' : 'Non',
      entered_by_user: entry.entered_by_user ?? '',
      observations: entry.observations ?? '',
    })
    styleDataRow(row)
    row.height = DATA_ROW_HEIGHT

    if (includePhotos && entry.photo_url) {
      try {
        const { base64, extension } = await fetchPhotoAsBase64(entry.photo_url)
        const imageId = workbook.addImage({ base64, extension })
        sheet.addImage(imageId, {
          tl: { col: CAISSE_PHOTO_COL - 1, row: row.number - 1 },
          ext: { width: PHOTO_WIDTH, height: PHOTO_HEIGHT },
        })
        row.height = PHOTO_ROW_HEIGHT
      } catch {
        row.getCell(CAISSE_PHOTO_COL).value = 'Photo non disponible'
      }
      processed += 1
      onProgress?.(processed, withPhoto.length)
    }
  }

  const sumBy = (type) =>
    entries.filter((e) => e.operation_type === type).reduce((s, e) => s + (Number(e.amount) || 0), 0)
  const encaissements = sumBy('Encaissement')
  const decaissements = sumBy('Décaissement')
  const depenses = sumBy('Dépense')

  const addTotal = (label, value, fill) => {
    const r = sheet.addRow({ bon_number: label, amount: value })
    styleTotalsRow(r, fill)
    r.height = DATA_ROW_HEIGHT
  }
  addTotal('TOTAL ENCAISSEMENTS', encaissements, null)
  addTotal('TOTAL DÉCAISSEMENTS', decaissements, null)
  addTotal('TOTAL DÉPENSES', depenses, null)
  addTotal('SOLDE', encaissements - decaissements - depenses, AMOUNT_ROW_FILL)

  const buffer = await workbook.xlsx.writeBuffer()
  saveAs(toBlob(buffer), filename || `Caisse_Residence_${todayISO()}.xlsx`)
}
