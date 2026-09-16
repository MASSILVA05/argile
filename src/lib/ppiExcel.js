import ExcelJS from 'exceljs'
import { saveAs } from 'file-saver'
import {
  DATA_ROW_HEIGHT,
  AMOUNT_ROW_FILL,
  todayISO,
  styleHeaderRow,
  styleDataRow,
  styleTotalsRow,
} from './excelHelpers'
import { formatDateTime } from './dateFormat'

function toBlob(buffer) {
  return new Blob([buffer], {
    type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  })
}

export async function downloadPpiImportsExcel(rows, { filename } = {}) {
  const workbook = new ExcelJS.Workbook()
  const sheet = workbook.addWorksheet('Importations PPI')
  sheet.columns = [
    { header: 'Date', key: 'entry_date', width: 12 },
    { header: 'Heure', key: 'entry_time', width: 9 },
    { header: 'Saisie le', key: 'created_at', width: 17 },
    { header: 'Pays', key: 'country_name_fr', width: 14 },
    { header: 'Produit', key: 'product_designation', width: 30 },
    { header: 'Qté', key: 'quantite', width: 10 },
    { header: 'Prix U. (€)', key: 'prix_unitaire', width: 13 },
    { header: 'Montant (€)', key: 'montant', width: 14 },
    { header: 'N° Facture', key: 'numero_facture', width: 16 },
    { header: 'Fournisseur', key: 'fournisseur', width: 22 },
    { header: 'Observations', key: 'observations', width: 26 },
    { header: 'Saisi par', key: 'entered_by_user', width: 14 },
  ]
  styleHeaderRow(sheet.getRow(1))
  sheet.getRow(1).height = DATA_ROW_HEIGHT
  sheet.views = [{ state: 'frozen', ySplit: 1 }]

  for (const r of rows) {
    const row = sheet.addRow({
      entry_date: r.entry_date,
      entry_time: r.entry_time ? r.entry_time.slice(0, 5) : '',
      created_at: formatDateTime(r.created_at),
      country_name_fr: r.country_name_fr ?? '',
      product_designation: r.product_designation ?? '',
      quantite: Number(r.quantite) || 0,
      prix_unitaire: Number(r.prix_unitaire) || 0,
      montant: Number(r.montant) || 0,
      numero_facture: r.numero_facture ?? '',
      fournisseur: r.fournisseur ?? '',
      observations: r.observations ?? '',
      entered_by_user: r.entered_by_user ?? '',
    })
    styleDataRow(row)
    row.height = DATA_ROW_HEIGHT
  }

  const totalQty = rows.reduce((s, r) => s + (Number(r.quantite) || 0), 0)
  const totalMontant = rows.reduce((s, r) => s + (Number(r.montant) || 0), 0)
  const totalsRow = sheet.addRow({ entry_date: 'TOTAUX', quantite: totalQty, montant: totalMontant })
  styleTotalsRow(totalsRow, AMOUNT_ROW_FILL)
  totalsRow.height = DATA_ROW_HEIGHT

  const buffer = await workbook.xlsx.writeBuffer()
  saveAs(toBlob(buffer), filename || `PPI_Importations_${todayISO()}.xlsx`)
}
