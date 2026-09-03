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
import { mcCategoryLabel, mcSignedAmount } from './magasinCaisse'

const COLUMNS = [
  { header: 'N° Bon', key: 'bon_number', width: 12 },
  { header: 'Date', key: 'entry_date', width: 14 },
  { header: 'Heure', key: 'entry_time', width: 10 },
  { header: 'Saisie le', key: 'created_at', width: 18 },
  { header: "Type d'opération", key: 'operation_type', width: 16 },
  { header: 'Motif / Libellé', key: 'description', width: 30 },
  { header: 'Montant (DA)', key: 'amount', width: 16 },
  { header: 'Fournisseur / Bénéficiaire', key: 'beneficiary', width: 24 },
  { header: 'Client', key: 'client_name', width: 22 },
  { header: 'Mode de paiement', key: 'payment_mode', width: 16 },
  { header: 'N° chèque', key: 'cheque_number', width: 14 },
  { header: 'Banque', key: 'cheque_bank', width: 16 },
  { header: 'N° Pièce justificative', key: 'piece_number', width: 18 },
  { header: 'Catégorie', key: 'category', width: 16 },
  { header: 'Photo', key: 'photo', width: 20 },
  { header: 'Saisi par', key: 'entered_by_user', width: 16 },
  { header: 'Observations', key: 'observations', width: 30 },
]

const PHOTO_COL_INDEX = COLUMNS.findIndex((c) => c.key === 'photo') + 1

export async function downloadMagasinCaisseExcel(entries, { onProgress, includePhotos = true, filename } = {}) {
  const workbook = new ExcelJS.Workbook()
  const sheet = workbook.addWorksheet('Caisse magasin')
  sheet.columns = COLUMNS

  styleHeaderRow(sheet.getRow(1))
  sheet.getRow(1).height = DATA_ROW_HEIGHT
  sheet.views = [{ state: 'frozen', ySplit: 1 }]

  const withPhoto = includePhotos ? entries.filter((e) => e.photo_url) : []
  const totalPhotos = withPhoto.length
  let processedPhotos = 0

  for (const entry of entries) {
    const row = sheet.addRow({
      bon_number: entry.bon_number,
      entry_date: entry.entry_date,
      entry_time: entry.entry_time ? entry.entry_time.slice(0, 5) : '',
      created_at: formatDateTime(entry.created_at),
      operation_type: entry.operation_type,
      description: entry.description,
      amount: mcSignedAmount(entry),
      beneficiary: entry.beneficiary ?? '',
      client_name: entry.client_name ?? '',
      payment_mode: entry.payment_mode ?? '',
      cheque_number: entry.cheque_number ?? '',
      cheque_bank: entry.cheque_bank ?? '',
      piece_number: entry.piece_number ?? '',
      category: mcCategoryLabel(entry),
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
          tl: { col: PHOTO_COL_INDEX - 1, row: row.number - 1 },
          ext: { width: PHOTO_WIDTH, height: PHOTO_HEIGHT },
        })
        row.height = PHOTO_ROW_HEIGHT
      } catch {
        row.getCell(PHOTO_COL_INDEX).value = 'Photo non disponible'
      }
      processedPhotos += 1
      onProgress?.(processedPhotos, totalPhotos)
    }
  }

  const sumBy = (type) =>
    entries.filter((e) => e.operation_type === type).reduce((s, e) => s + (Number(e.amount) || 0), 0)
  const encaissements = sumBy('Encaissement')
  const decaissements = sumBy('Décaissement')
  const depenses = sumBy('Dépense')
  const solde = encaissements - decaissements - depenses

  const addTotal = (label, value, fill) => {
    const r = sheet.addRow({ bon_number: label, amount: value })
    styleTotalsRow(r, fill)
    r.height = DATA_ROW_HEIGHT
  }

  addTotal('TOTAL ENCAISSEMENTS', encaissements, null)
  addTotal('TOTAL DÉCAISSEMENTS', decaissements, null)
  addTotal('TOTAL DÉPENSES', depenses, null)
  addTotal('SOLDE', solde, AMOUNT_ROW_FILL)

  const buffer = await workbook.xlsx.writeBuffer()
  const blob = new Blob([buffer], {
    type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  })
  saveAs(blob, filename || `Caisse_Magasin_${todayISO()}.xlsx`)
}
