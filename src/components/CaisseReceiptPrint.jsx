import { printCaisseReceipt } from '../lib/printRegistry'
import PrintIconButton from './PrintIconButton'

// Bouton « Imprimer reçu » d'une ligne caisse (Briqueterie / Magasin /
// Résidence) : impression directe du reçu A5, sans modale de sélection.
export function ReceiptPrintButton({ entry }) {
  return <PrintIconButton onClick={() => printCaisseReceipt(entry)} title="Imprimer reçu" />
}

// Config PrintSelectionModal pour imprimer plusieurs reçus (un par page).
// rows : lignes caisse déjà enrichies (category_label, linked_invoice_number).
export function receiptSelectionConfig(rows, formatAmount) {
  return {
    subtitle: 'Reçus de caisse',
    columns: [
      { key: 'bon_number', label: 'N° Reçu' },
      { key: 'entry_date', label: 'Date' },
      { key: 'operation_type', label: 'Type' },
      { key: 'description', label: 'Motif' },
      { key: 'beneficiary', label: 'Bénéficiaire' },
      { key: 'amount', label: 'Montant (DA)', align: 'right', format: formatAmount },
    ],
    rows: rows.map((r) => ({ ...r, beneficiary: r.beneficiary || r.client_name })),
    onPrint: (selected) => printCaisseReceipt(selected),
  }
}
