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

const COLUMNS = [
  { header: 'N° Bon', key: 'bon_number', width: 12 },
  { header: 'Date', key: 'entry_date', width: 14 },
  { header: 'Heure', key: 'entry_time', width: 10 },
  { header: 'Fournisseur', key: 'supplier_name', width: 22 },
  { header: 'Transporteur', key: 'transporter_name', width: 20 },
  { header: 'Matricule', key: 'truck_plate', width: 18 },
  { header: 'Chauffeur', key: 'driver_name', width: 22 },
  { header: 'Quantité (T)', key: 'quantity_tons', width: 14 },
  { header: 'Prix unitaire (DA/T)', key: 'unit_price', width: 16 },
  { header: 'Total sable (DA)', key: 'sand_total', width: 16 },
  { header: 'Transport (DA)', key: 'transport_price', width: 16 },
  { header: 'Total général (DA)', key: 'total', width: 18 },
  { header: 'Statut paiement fourn.', key: 'supplier_paid', width: 16 },
  { header: 'Mode paiement fourn.', key: 'supplier_payment_mode', width: 16 },
  { header: 'N° chèque fourn.', key: 'supplier_cheque_number', width: 16 },
  { header: 'Banque fourn.', key: 'supplier_cheque_bank', width: 16 },
  { header: 'Date paiement fourn.', key: 'supplier_payment_date', width: 16 },
  { header: 'Montant payé fourn. (DA)', key: 'supplier_amount_paid', width: 18 },
  { header: 'Statut paiement transp.', key: 'transporter_paid', width: 16 },
  { header: 'Mode paiement transp.', key: 'transporter_payment_mode', width: 16 },
  { header: 'N° chèque transp.', key: 'transporter_cheque_number', width: 16 },
  { header: 'Banque transp.', key: 'transporter_cheque_bank', width: 16 },
  { header: 'Date paiement transp.', key: 'transporter_payment_date', width: 16 },
  { header: 'Montant payé transp. (DA)', key: 'transporter_amount_paid', width: 18 },
  { header: 'Photo', key: 'photo', width: 20 },
  { header: 'Saisi par', key: 'entered_by_user', width: 18 },
  { header: 'Observations', key: 'observations', width: 30 },
]

const PHOTO_COL_INDEX = COLUMNS.findIndex((c) => c.key === 'photo') + 1

function total(entry) {
  return Number(entry.sand_total || 0) + Number(entry.transport_price || 0)
}

export async function downloadSandExcel(entries, { onProgress, includePhotos = true, filename } = {}) {
  const workbook = new ExcelJS.Workbook()
  const sheet = workbook.addWorksheet('Sable')
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
      supplier_name: entry.supplier_name,
      transporter_name: entry.transporter_name ?? '',
      truck_plate: entry.truck_plate ?? '',
      driver_name: entry.driver_name ?? '',
      quantity_tons: entry.quantity_tons,
      unit_price: entry.unit_price,
      sand_total: entry.sand_total,
      transport_price: entry.transport_price,
      total: total(entry),
      supplier_paid: entry.supplier_paid ?? '',
      supplier_payment_mode: entry.supplier_payment_mode ?? '',
      supplier_cheque_number: entry.supplier_cheque_number ?? '',
      supplier_cheque_bank: entry.supplier_cheque_bank ?? '',
      supplier_payment_date: entry.supplier_payment_date ?? '',
      supplier_amount_paid: entry.supplier_amount_paid ?? '',
      transporter_paid: entry.transporter_paid ?? '',
      transporter_payment_mode: entry.transporter_payment_mode ?? '',
      transporter_cheque_number: entry.transporter_cheque_number ?? '',
      transporter_cheque_bank: entry.transporter_cheque_bank ?? '',
      transporter_payment_date: entry.transporter_payment_date ?? '',
      transporter_amount_paid: entry.transporter_amount_paid ?? '',
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

  const quantityTotal = entries.reduce((sum, e) => sum + (Number(e.quantity_tons) || 0), 0)
  const sandTotalSum = entries.reduce((sum, e) => sum + (Number(e.sand_total) || 0), 0)
  const transportTotal = entries.reduce((sum, e) => sum + (Number(e.transport_price) || 0), 0)
  const supplierDue = entries
    .filter((e) => e.supplier_paid !== 'Payé')
    .reduce((sum, e) => sum + (Number(e.sand_total) || 0), 0)
  const transporterDue = entries
    .filter((e) => e.transporter_paid !== 'Payé')
    .reduce((sum, e) => sum + (Number(e.transport_price) || 0), 0)

  const totalsRow = sheet.addRow({
    bon_number: 'TOTAL',
    quantity_tons: quantityTotal.toFixed(2),
    sand_total: sandTotalSum,
    transport_price: transportTotal,
    total: sandTotalSum + transportTotal,
  })
  styleTotalsRow(totalsRow, null)
  totalsRow.height = DATA_ROW_HEIGHT

  const supplierDueRow = sheet.addRow({
    bon_number: 'RESTE À PAYER FOURNISSEURS',
    sand_total: supplierDue,
  })
  styleTotalsRow(supplierDueRow, AMOUNT_ROW_FILL)
  supplierDueRow.height = DATA_ROW_HEIGHT

  const transporterDueRow = sheet.addRow({
    bon_number: 'RESTE À PAYER TRANSPORTEURS',
    transport_price: transporterDue,
  })
  styleTotalsRow(transporterDueRow, AMOUNT_ROW_FILL)
  transporterDueRow.height = DATA_ROW_HEIGHT

  const buffer = await workbook.xlsx.writeBuffer()
  const blob = new Blob([buffer], {
    type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  })
  saveAs(blob, filename || `Registre_Sable_${todayISO()}.xlsx`)
}
