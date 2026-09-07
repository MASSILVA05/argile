import ExcelJS from 'exceljs'
import { saveAs } from 'file-saver'
import { ALL_BORDERS, DATA_ROW_HEIGHT, writeCompanyHeader } from './excelHelpers'

const GRAY_FILL = 'FFD9D9D9'
const NUMBER_FORMAT = '#,##0.00'

const MONTHS_FR = [
  'Janvier',
  'Février',
  'Mars',
  'Avril',
  'Mai',
  'Juin',
  'Juillet',
  'Août',
  'Septembre',
  'Octobre',
  'Novembre',
  'Décembre',
]

function formatDateFR(iso) {
  const [y, m, d] = iso.split('-')
  return `${d}/${m}/${y}`
}

// Reproduit exactement le format du fichier source "Etat Relevé Facture de
// Ventes" : mêmes 11 colonnes, même bloc titre/période, même ligne de
// totaux "Nombre de lignes :".
const COLUMNS = [
  { header: 'Numéro', key: 'invoice_number', width: 16 },
  { header: 'Entité', key: 'entity', width: 14 },
  { header: 'Du', key: 'entry_date', width: 12 },
  { header: 'Client', key: 'client_name', width: 34 },
  { header: 'Total HT', key: 'total_ht', width: 16 },
  { header: 'Remise', key: 'discount_amount', width: 12 },
  { header: 'Total TVA', key: 'total_tva', width: 16 },
  { header: 'Total TTC', key: 'total_ttc', width: 16 },
  { header: 'Timbre', key: 'stamp_duty', width: 12 },
  { header: 'Total net', key: 'total_net', width: 16 },
  { header: 'Réf. Commande', key: 'ref_commande', width: 22 },
  { header: 'Réf. Livraison', key: 'ref_livraison', width: 22 },
]

const NUMERIC_KEYS = ['total_ht', 'discount_amount', 'total_tva', 'total_ttc', 'stamp_duty', 'total_net']

export async function downloadTvaPayerExcel(entries, { startDate, endDate } = {}) {
  const workbook = new ExcelJS.Workbook()
  const sheet = workbook.addWorksheet('TVA à payer')
  const colCount = COLUMNS.length

  sheet.columns = COLUMNS.map(({ key, width }) => ({ key, width }))

  let r = writeCompanyHeader(sheet, colCount, 1)

  sheet.mergeCells(r, 1, r, colCount)
  const subtitleCell = sheet.getCell(r, 1)
  subtitleCell.value = 'Relevé des Factures de Ventes'
  subtitleCell.font = { bold: true, size: 12 }
  subtitleCell.alignment = { horizontal: 'center' }
  r += 1

  sheet.mergeCells(r, 1, r, colCount)
  const periodCell = sheet.getCell(r, 1)
  periodCell.value = `Période du ${formatDateFR(startDate)} Au ${formatDateFR(endDate)}`
  periodCell.font = { size: 11 }
  periodCell.alignment = { horizontal: 'center' }
  r += 1

  const headerRow = sheet.getRow(r)
  headerRow.values = COLUMNS.map((c) => c.header)
  headerRow.eachCell({ includeEmpty: true }, (cell) => {
    cell.font = { bold: true }
    cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: GRAY_FILL } }
    cell.border = ALL_BORDERS
    cell.alignment = { vertical: 'middle', horizontal: 'center' }
  })
  headerRow.height = DATA_ROW_HEIGHT

  for (const entry of entries) {
    const row = sheet.addRow({
      invoice_number: entry.invoice_number,
      entity: entry.entity ?? '',
      entry_date: formatDateFR(entry.entry_date),
      client_name: entry.client_name,
      total_ht: Number(entry.total_ht) || 0,
      discount_amount: Number(entry.discount_amount) || 0,
      total_tva: Number(entry.total_tva) || 0,
      total_ttc: Number(entry.total_ttc) || 0,
      stamp_duty: Number(entry.stamp_duty) || 0,
      total_net: Number(entry.total_net) || 0,
      ref_commande: entry.ref_commande ?? '',
      ref_livraison: entry.ref_livraison ?? '',
    })
    row.eachCell({ includeEmpty: true }, (cell, colNumber) => {
      cell.border = ALL_BORDERS
      if (NUMERIC_KEYS.includes(COLUMNS[colNumber - 1].key)) {
        cell.numFmt = NUMBER_FORMAT
        cell.alignment = { horizontal: 'right' }
      }
    })
    row.height = DATA_ROW_HEIGHT
  }

  const sum = (key) => entries.reduce((acc, e) => acc + (Number(e[key]) || 0), 0)
  const totalsRow = sheet.addRow({
    invoice_number: 'Nombre de lignes :',
    entry_date: entries.length,
    total_ht: sum('total_ht'),
    discount_amount: sum('discount_amount'),
    total_tva: sum('total_tva'),
    total_ttc: sum('total_ttc'),
    stamp_duty: sum('stamp_duty'),
    total_net: sum('total_net'),
  })
  totalsRow.eachCell({ includeEmpty: true }, (cell, colNumber) => {
    cell.font = { bold: true }
    cell.border = ALL_BORDERS
    if (NUMERIC_KEYS.includes(COLUMNS[colNumber - 1].key)) {
      cell.numFmt = NUMBER_FORMAT
      cell.alignment = { horizontal: 'right' }
    }
  })
  totalsRow.height = DATA_ROW_HEIGHT

  const buffer = await workbook.xlsx.writeBuffer()
  const blob = new Blob([buffer], {
    type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  })
  const [year, month] = startDate.split('-')
  saveAs(blob, `Etat_Releve_Facture_Vente_${MONTHS_FR[Number(month) - 1]}_${year}.xlsx`)
}
