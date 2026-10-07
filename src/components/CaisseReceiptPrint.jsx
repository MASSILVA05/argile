import { printCaisseReceipt } from '../lib/printRegistry'

// Bouton « Imprimer reçu » d'une ligne caisse (Briqueterie / Magasin /
// Résidence) : impression directe du reçu A5, sans modale de sélection.
export function ReceiptPrintButton({ entry }) {
  return (
    <button
      type="button"
      onClick={() => printCaisseReceipt(entry)}
      title="Imprimer reçu"
      aria-label="Imprimer reçu"
      className="rounded border border-border p-1.5 text-ink-muted hover:border-ocre hover:text-ocre"
    >
      <svg viewBox="0 0 24 24" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
        <path d="M6 9V2h12v7" />
        <path d="M6 18H4a2 2 0 0 1-2-2v-5a2 2 0 0 1 2-2h16a2 2 0 0 1 2 2v5a2 2 0 0 1-2 2h-2" />
        <rect x="6" y="14" width="12" height="8" />
      </svg>
    </button>
  )
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
