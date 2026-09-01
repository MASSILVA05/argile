import ExcelJS from 'exceljs'
import { saveAs } from 'file-saver'
import { DATA_ROW_HEIGHT, todayISO, styleHeaderRow, styleDataRow } from './excelHelpers'

const COLUMNS = [
  { header: 'Référence', key: 'reference', width: 18 },
  { header: 'Désignation', key: 'designation', width: 36 },
  { header: 'Marque', key: 'marque', width: 14 },
  { header: 'Quantité', key: 'quantite', width: 12 },
  { header: 'Stock min', key: 'stock_min', width: 12 },
  { header: 'Prix achat', key: 'prix_achat', width: 14 },
  { header: 'Prix gros', key: 'prix_gros', width: 14 },
  { header: 'Prix détail', key: 'prix_detail', width: 14 },
  { header: 'Prix euro', key: 'prix_euro', width: 12 },
  { header: 'Rayonnage', key: 'rayonnage', width: 14 },
  { header: 'Code barre', key: 'code_barre', width: 18 },
]

export async function downloadMagasinStockExcel(rows, { filename } = {}) {
  const workbook = new ExcelJS.Workbook()
  const sheet = workbook.addWorksheet('Stock magasin')
  sheet.columns = COLUMNS

  styleHeaderRow(sheet.getRow(1))
  sheet.getRow(1).height = DATA_ROW_HEIGHT
  sheet.views = [{ state: 'frozen', ySplit: 1 }]

  for (const r of rows) {
    const row = sheet.addRow({
      reference: r.reference ?? '',
      designation: r.designation ?? '',
      marque: r.marque ?? '',
      quantite: Number(r.quantite) || 0,
      stock_min: Number(r.stock_min) || 0,
      prix_achat: Number(r.prix_achat) || 0,
      prix_gros: Number(r.prix_gros) || 0,
      prix_detail: Number(r.prix_detail) || 0,
      prix_euro: Number(r.prix_euro) || 0,
      rayonnage: r.rayonnage ?? '',
      code_barre: r.code_barre ?? '',
    })
    styleDataRow(row)
    row.height = DATA_ROW_HEIGHT
  }

  const buffer = await workbook.xlsx.writeBuffer()
  const blob = new Blob([buffer], {
    type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  })
  saveAs(blob, filename || `Stock_Magasin_${todayISO()}.xlsx`)
}
