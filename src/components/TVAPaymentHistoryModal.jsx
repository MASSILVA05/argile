import { useEffect, useState } from 'react'
import { supabase } from '../lib/supabase'

function formatDA(value) {
  return Number(value || 0).toLocaleString('fr-FR', { maximumFractionDigits: 2 })
}

// Modal "Historique paiements" -- liste des paiements partiels déjà
// enregistrés (tva_payments) pour une facture TVA donnée.
export default function TVAPaymentHistoryModal({ entry, onClose }) {
  const [payments, setPayments] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')

  useEffect(() => {
    let active = true
    async function load() {
      setLoading(true)
      const { data, error: fetchError } = await supabase
        .from('tva_payments')
        .select('*')
        .eq('tva_entry_id', entry.id)
        .order('entry_date', { ascending: false })
        .order('created_at', { ascending: false })
      if (!active) return
      if (fetchError) setError(`Erreur de chargement : ${fetchError.message}`)
      else setPayments(data ?? [])
      setLoading(false)
    }
    load()
    return () => {
      active = false
    }
  }, [entry.id])

  const total = payments.reduce((s, p) => s + (Number(p.amount) || 0), 0)

  return (
    <div className="fixed inset-0 z-50 bg-black/70 sm:flex sm:items-center sm:justify-center sm:p-4" onClick={onClose}>
      <div
        className="flex h-full w-full flex-col overflow-y-auto bg-bg-card p-5 sm:h-auto sm:max-h-[85vh] sm:w-full sm:max-w-2xl sm:rounded-xl sm:border sm:border-border"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="mb-1 flex items-center justify-between">
          <h2 className="font-display text-lg text-ink">Historique des paiements</h2>
          <button type="button" onClick={onClose} className="text-sm text-ink-muted hover:text-ink">Fermer ✕</button>
        </div>
        <p className="mb-4 text-sm text-ink-muted">
          Facture n° {entry.invoice_number} — Fournisseur : {entry.supplier_name}
        </p>

        {error && <p className="mb-3 rounded-lg border border-terracotta/50 bg-terracotta/10 px-3 py-2 text-sm text-terracotta">{error}</p>}

        {loading ? (
          <p className="text-ink-muted">Chargement…</p>
        ) : payments.length === 0 ? (
          <p className="text-ink-muted">Aucun paiement enregistré.</p>
        ) : (
          <div className="overflow-x-auto rounded-lg border border-border">
            <table className="w-full min-w-[520px] border-collapse text-sm">
              <thead>
                <tr className="border-b border-border bg-bg-soft text-left text-ink-muted">
                  <th className="px-3 py-2 font-display font-medium">Date</th>
                  <th className="px-3 py-2 text-right font-display font-medium">Montant (DA)</th>
                  <th className="px-3 py-2 font-display font-medium">Mode</th>
                  <th className="px-3 py-2 font-display font-medium">Observations</th>
                </tr>
              </thead>
              <tbody>
                {payments.map((p) => (
                  <tr key={p.id} className="border-b border-border last:border-0">
                    <td className="px-3 py-2">{p.entry_date}</td>
                    <td className="px-3 py-2 text-right font-medium text-ocre">{formatDA(p.amount)}</td>
                    <td className="px-3 py-2">
                      {p.payment_mode}
                      {p.payment_mode === 'Chèque' && p.cheque_number && (
                        <span className="text-ink-muted"> — n° {p.cheque_number}{p.cheque_bank ? ` (${p.cheque_bank})` : ''}</span>
                      )}
                    </td>
                    <td className="px-3 py-2 text-ink-muted">{p.observations ?? '—'}</td>
                  </tr>
                ))}
              </tbody>
              <tfoot>
                <tr className="bg-bg-soft font-medium">
                  <td className="px-3 py-2">TOTAL PAYÉ</td>
                  <td className="px-3 py-2 text-right text-ocre">{formatDA(total)}</td>
                  <td colSpan={2}></td>
                </tr>
              </tfoot>
            </table>
          </div>
        )}
      </div>
    </div>
  )
}
