import { useEffect, useState } from 'react'
import { supabase } from '../lib/supabase'

function formatDA(value) {
  return Number(value || 0).toLocaleString('fr-FR', { maximumFractionDigits: 2 })
}

// Petite fiche de consultation (lecture seule) d'une facture ou d'un chèque
// lié, ouverte depuis la colonne "Facture"/"Chèque" des registres Factures /
// Chèques / Caisse (voir liaison Factures ↔ Chèques ↔ Caisse).
export default function LinkedRecordModal({ type, id, onClose }) {
  const [row, setRow] = useState(null)
  const [error, setError] = useState('')

  useEffect(() => {
    if (!id) return
    let active = true
    const table = type === 'invoice' ? 'invoices' : 'cheques'
    supabase
      .from(table)
      .select('*')
      .eq('id', id)
      .maybeSingle()
      .then(({ data, error: fetchError }) => {
        if (!active) return
        if (fetchError) setError(fetchError.message)
        else if (!data) setError('Introuvable (peut-être supprimé).')
        else setRow(data)
      })
    return () => {
      active = false
    }
  }, [type, id])

  if (!id) return null

  return (
    <div className="fixed inset-0 z-50 bg-black/70 sm:flex sm:items-center sm:justify-center sm:p-4" onClick={onClose}>
      <div
        className="flex h-full w-full flex-col overflow-y-auto bg-bg-card p-5 sm:h-auto sm:max-h-[85vh] sm:w-full sm:max-w-md sm:rounded-xl sm:border sm:border-border"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="mb-3 flex items-start justify-between gap-3">
          <h2 className="font-display text-lg text-ink">{type === 'invoice' ? 'Facture liée' : 'Chèque lié'}</h2>
          <button type="button" onClick={onClose} className="text-sm text-ink-muted hover:text-ink">Fermer ✕</button>
        </div>

        {error && <p className="rounded-lg border border-terracotta/50 bg-terracotta/10 px-4 py-3 text-sm text-terracotta">{error}</p>}

        {!row && !error && <p className="text-ink-muted">Chargement…</p>}

        {row && type === 'invoice' && (
          <dl className="flex flex-col gap-2 text-sm">
            <Row label="N° Facture" value={row.invoice_number} />
            <Row label="Entité" value={row.entity} />
            <Row label="Date" value={row.entry_date} />
            <Row label="Client" value={row.client_name} />
            <Row label="Total Net" value={`${formatDA(row.total_net)} DA`} />
            <Row label="Montant payé" value={`${formatDA(row.montant_paye)} DA`} />
            <Row label="Reste à payer" value={`${formatDA(Number(row.total_net) - Number(row.montant_paye))} DA`} />
            <Row label="Statut" value={row.payment_status} />
            <Row label="Observations" value={row.observations || '—'} />
          </dl>
        )}

        {row && type === 'cheque' && (
          <dl className="flex flex-col gap-2 text-sm">
            <Row label="N° Chèque" value={row.cheque_number} />
            <Row label="Entité" value={row.entity} />
            <Row label="Type" value={row.type} />
            <Row label="Date chèque" value={row.cheque_date} />
            <Row label="Bénéficiaire / Émetteur" value={row.beneficiary} />
            <Row label="Montant" value={`${formatDA(row.amount)} DA`} />
            <Row label="Banque" value={row.bank} />
            <Row label="Statut" value={row.statut} />
            <Row label="Observations" value={row.observations || '—'} />
          </dl>
        )}
      </div>
    </div>
  )
}

function Row({ label, value }) {
  return (
    <div className="flex justify-between gap-3 border-b border-border pb-1.5">
      <span className="text-ink-muted">{label}</span>
      <span className="text-right text-ink">{value ?? '—'}</span>
    </div>
  )
}
