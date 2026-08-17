import ExcelJS from 'exceljs'
import { saveAs } from 'file-saver'
import { DATA_ROW_HEIGHT, todayISO, styleHeaderRow, styleDataRow, styleTotalsRow } from './excelHelpers'
import { formatDateTime } from './dateFormat'
import { recoveryLabel } from './tvaPayment'

const COLUMNS = [
  { header: 'N° Facture', key: 'invoice_number', width: 16 },
  { header: 'Entité', key: 'entity', width: 14 },
  { header: 'N° Pièce', key: 'piece_number', width: 14 },
  { header: 'Date', key: 'entry_date', width: 14 },
  { header: 'Saisie le', key: 'created_at', width: 18 },
  { header: 'Mois récup.', key: 'recovery', width: 16 },
  { header: 'Fournisseur', key: 'supplier_name', width: 26 },
  { header: 'Adresse', key: 'supplier_address', width: 22 },
  { header: 'NIF', key: 'nif', width: 18 },
  { header: 'NIS', key: 'nis', width: 18 },
  { header: 'Article', key: 'article', width: 16 },
  { header: 'N° RC', key: 'rc_number', width: 16 },
  { header: 'Téléphone', key: 'phone', width: 16 },
  { header: 'Total HT (DA)', key: 'total_ht', width: 16 },
  { header: 'Remise (DA)', key: 'discount_amount', width: 14 },
  { header: 'HT Net (DA)', key: 'ht_net', width: 16 },
  { header: 'TVA (DA)', key: 'tva_amount', width: 14 },
  { header: 'DD (DA)', key: 'dd_amount', width: 12 },
  { header: 'TTC (DA)', key: 'total_ttc', width: 14 },
  { header: 'Timbre (DA)', key: 'stamp_duty', width: 12 },
  { header: 'Total Net (DA)', key: 'total_net', width: 16 },
  { header: 'Paiement', key: 'payment_mode', width: 14 },
  { header: 'Pièce de règlement', key: 'payment_piece', width: 18 },
  { header: 'Photo', key: 'photo_url', width: 24 },
  { header: 'Observations', key: 'observations', width: 28 },
  { header: 'Saisi par', key: 'entered_by_user', width: 18 },
]

export async function downloadTvaExcel(entries, { filename } = {}) {
  const workbook = new ExcelJS.Workbook()
  const sheet = workbook.addWorksheet('Récupération TVA')
  sheet.columns = COLUMNS

  styleHeaderRow(sheet.getRow(1))
  sheet.getRow(1).height = DATA_ROW_HEIGHT
  sheet.views = [{ state: 'frozen', ySplit: 1 }]

  for (const entry of entries) {
    const row = sheet.addRow({
      invoice_number: entry.invoice_number,
      entity: entry.entity ?? '',
      piece_number: entry.piece_number ?? '',
      entry_date: entry.entry_date,
      created_at: formatDateTime(entry.created_at),
      recovery: recoveryLabel(entry.recovery_month, entry.recovery_year),
      supplier_name: entry.supplier_name,
      supplier_address: entry.supplier_address ?? '',
      nif: entry.nif ?? '',
      nis: entry.nis ?? '',
      article: entry.article ?? '',
      rc_number: entry.rc_number ?? '',
      phone: entry.phone ?? '',
      total_ht: entry.total_ht ?? 0,
      discount_amount: entry.discount_amount ?? 0,
      ht_net: entry.ht_net ?? 0,
      tva_amount: entry.tva_amount ?? 0,
      dd_amount: entry.dd_amount ?? 0,
      total_ttc: entry.total_ttc ?? 0,
      stamp_duty: entry.stamp_duty ?? 0,
      total_net: entry.total_net ?? 0,
      payment_mode: entry.payment_mode ?? 'Non payé',
      payment_piece: entry.payment_piece ?? '',
      photo_url: entry.photo_url ?? '',
      observations: entry.observations ?? '',
      entered_by_user: entry.entered_by_user ?? '',
    })
    styleDataRow(row)
    row.height = DATA_ROW_HEIGHT
  }

  const sum = (field) => entries.reduce((acc, e) => acc + (Number(e[field]) || 0), 0)

  const totalsRow = sheet.addRow({
    invoice_number: 'TOTAL',
    total_ht: sum('total_ht'),
    discount_amount: sum('discount_amount'),
    ht_net: sum('ht_net'),
    tva_amount: sum('tva_amount'),
    dd_amount: sum('dd_amount'),
    total_ttc: sum('total_ttc'),
    stamp_duty: sum('stamp_duty'),
    total_net: sum('total_net'),
  })
  styleTotalsRow(totalsRow, null)
  totalsRow.height = DATA_ROW_HEIGHT

  const buffer = await workbook.xlsx.writeBuffer()
  const blob = new Blob([buffer], {
    type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  })
  saveAs(blob, filename || `Registre_TVA_${todayISO()}.xlsx`)
}
