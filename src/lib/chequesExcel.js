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
import { isEmis } from './cheques'

const COLUMNS = [
  { header: 'N° Chèque', key: 'cheque_number', width: 16 },
  { header: 'Date chèque', key: 'cheque_date', width: 14 },
  { header: 'Date saisie', key: 'entry_date', width: 14 },
  { header: 'Saisie le', key: 'created_at', width: 18 },
  { header: 'Type', key: 'type', width: 10 },
  { header: 'Bénéficiaire / Émetteur', key: 'beneficiary', width: 24 },
  { header: 'Montant (DA)', key: 'amount', width: 16 },
  { header: 'Banque', key: 'bank', width: 12 },
  { header: 'N° Compte', key: 'bank_account', width: 18 },
  { header: 'Motif', key: 'motif', width: 20 },
  { header: 'Statut', key: 'statut', width: 16 },
  { header: 'Date remise', key: 'date_remise', width: 14 },
  { header: 'Date encaissement', key: 'date_encaissement', width: 16 },
  { header: 'Motif rejet', key: 'motif_rejet', width: 20 },
  { header: 'Photo', key: 'photo', width: 20 },
  { header: 'Saisi par', key: 'entered_by_user', width: 14 },
  { header: 'Observations', key: 'observations', width: 28 },
]

const PHOTO_COL_INDEX = COLUMNS.findIndex((c) => c.key === 'photo') + 1

export async function downloadChequesExcel(rows, { onProgress, includePhotos = true, filename } = {}) {
  const workbook = new ExcelJS.Workbook()
  const sheet = workbook.addWorksheet('Chèques')
  sheet.columns = COLUMNS

  styleHeaderRow(sheet.getRow(1))
  sheet.getRow(1).height = DATA_ROW_HEIGHT
  sheet.views = [{ state: 'frozen', ySplit: 1 }]

  const withPhoto = includePhotos ? rows.filter((r) => r.photo_url) : []
  const totalPhotos = withPhoto.length
  let processedPhotos = 0

  for (const r of rows) {
    const row = sheet.addRow({
      cheque_number: r.cheque_number,
      cheque_date: r.cheque_date,
      entry_date: r.entry_date,
      created_at: formatDateTime(r.created_at),
      type: r.type,
      beneficiary: r.beneficiary,
      amount: Number(r.amount) || 0,
      bank: r.bank,
      bank_account: r.bank_account ?? '',
      motif: r.motif ?? '',
      statut: r.statut,
      date_remise: r.date_remise ?? '',
      date_encaissement: r.date_encaissement ?? '',
      motif_rejet: r.motif_rejet ?? '',
      photo: includePhotos ? '' : r.photo_url ? 'Oui' : 'Non',
      entered_by_user: r.entered_by_user ?? '',
      observations: r.observations ?? '',
    })
    styleDataRow(row)
    row.height = DATA_ROW_HEIGHT

    if (includePhotos && r.photo_url) {
      try {
        const { base64, extension } = await fetchPhotoAsBase64(r.photo_url)
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

  const totalEmis = rows.filter((r) => isEmis(r.type)).reduce((s, r) => s + (Number(r.amount) || 0), 0)
  const totalRecu = rows.filter((r) => !isEmis(r.type)).reduce((s, r) => s + (Number(r.amount) || 0), 0)

  const addTotal = (label, value, fill) => {
    const r = sheet.addRow({ cheque_number: label, amount: value })
    styleTotalsRow(r, fill)
    r.height = DATA_ROW_HEIGHT
  }
  addTotal('TOTAL ÉMIS', totalEmis, null)
  addTotal('TOTAL REÇU', totalRecu, null)
  addTotal('SOLDE (Reçu - Émis)', totalRecu - totalEmis, AMOUNT_ROW_FILL)

  const buffer = await workbook.xlsx.writeBuffer()
  const blob = new Blob([buffer], {
    type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  })
  saveAs(blob, filename || `Cheques_${todayISO()}.xlsx`)
}
