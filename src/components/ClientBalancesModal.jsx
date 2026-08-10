import { useEffect, useMemo, useState } from 'react'
import { supabase } from '../lib/supabase'
import { downloadClientBalancesExcel } from '../lib/clientBalancesExcel'

function formatDA(value) {
  return Number(value || 0).toLocaleString('fr-FR', { maximumFractionDigits: 2 })
}

export default function ClientBalancesModal({ open, onClose }) {
  const [clients, setClients] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [query, setQuery] = useState('')
  const [exporting, setExporting] = useState(false)

  useEffect(() => {
    if (!open) return
    let active = true
    setLoading(true)
    setQuery('')
    supabase
      .from('clients')
      .select('id, name, client_code, total_invoiced, total_paid, balance, source')
      .order('balance', { ascending: false })
      .then(({ data, error: fetchError }) => {
        if (!active) return
        if (fetchError) {
          setError(`Erreur de chargement : ${fetchError.message}`)
        } else {
          setClients(data ?? [])
          setError('')
        }
        setLoading(false)
      })
    return () => {
      active = false
    }
  }, [open])

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase()
    if (!q) return clients
    return clients.filter(
      (c) => c.name.toLowerCase().includes(q) || (c.client_code ?? '').toLowerCase().includes(q)
    )
  }, [clients, query])

  async function handleExport() {
    setExporting(true)
    try {
      await downloadClientBalancesExcel(filtered)
    } catch (err) {
      setError(`Erreur lors de la génération du fichier Excel : ${err.message}`)
    } finally {
      setExporting(false)
    }
  }

  if (!open) return null

  return (
    <div className="fixed inset-0 z-50 overflow-y-auto bg-black/70 sm:flex sm:items-center sm:justify-center sm:p-4" onClick={onClose}>
      <div
        className="min-h-full w-full bg-bg-card p-5 sm:my-8 sm:min-h-0 sm:max-w-3xl sm:rounded-xl sm:border sm:border-border"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="mb-4 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <h2 className="font-display text-lg text-ink">Soldes clients</h2>
          <div className="flex gap-2">
            <input
              type="text"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Rechercher un client…"
              className="min-h-11 rounded-lg border border-border bg-bg-soft px-3 py-2 text-ink placeholder:text-ink-muted/60 outline-none focus:border-terracotta"
            />
            <button
              type="button"
              onClick={handleExport}
              disabled={exporting || filtered.length === 0}
              className="min-h-11 shrink-0 rounded-lg border border-ocre px-4 py-2 font-display text-ocre transition-colors hover:bg-ocre/10 disabled:cursor-not-allowed disabled:opacity-50"
            >
              {exporting ? 'Génération…' : 'Exporter Excel'}
            </button>
          </div>
        </div>

        {error && (
          <p className="mb-3 rounded-lg border border-terracotta/50 bg-terracotta/10 px-4 py-3 text-sm text-terracotta">
            {error}
          </p>
        )}

        {loading ? (
          <p className="text-ink-muted">Chargement…</p>
        ) : filtered.length === 0 ? (
          <p className="text-ink-muted">Aucun client.</p>
        ) : (
          <div className="max-h-[60vh] overflow-y-auto overflow-x-auto rounded-lg border border-border">
            <table className="w-full min-w-[600px] border-collapse text-[11px] sm:text-sm">
              <thead className="sticky top-0 bg-bg-soft">
                <tr className="border-b border-border text-left text-ink-muted">
                  <th className="px-1 py-1 font-display font-medium sm:px-3 sm:py-2">Client</th>
                  <th className="px-1 py-1 font-display font-medium whitespace-nowrap sm:px-3 sm:py-2">Code</th>
                  <th className="px-1 py-1 font-display font-medium whitespace-nowrap sm:px-3 sm:py-2">Total facturé</th>
                  <th className="px-1 py-1 font-display font-medium whitespace-nowrap sm:px-3 sm:py-2">Total réglé</th>
                  <th className="px-1 py-1 font-display font-medium whitespace-nowrap sm:px-3 sm:py-2">Solde dû</th>
                </tr>
              </thead>
              <tbody>
                {filtered.map((c) => (
                  <tr key={c.id} className="border-b border-border last:border-0">
                    <td className="px-1 py-1 sm:px-3 sm:py-2">{c.name}</td>
                    <td className="px-1 py-1 whitespace-nowrap sm:px-3 sm:py-2">{c.client_code ?? '—'}</td>
                    <td className="px-1 py-1 whitespace-nowrap sm:px-3 sm:py-2">{formatDA(c.total_invoiced)}</td>
                    <td className="px-1 py-1 whitespace-nowrap sm:px-3 sm:py-2">{formatDA(c.total_paid)}</td>
                    <td className="px-1 py-1 whitespace-nowrap sm:px-3 sm:py-2">
                      <span
                        className={`inline-block rounded-full border px-2 py-0.5 text-xs ${
                          Number(c.balance) > 0
                            ? 'border-terracotta/50 bg-terracotta/10 text-terracotta'
                            : 'border-green-500/50 bg-green-500/10 text-green-500'
                        }`}
                      >
                        {formatDA(c.balance)} DA
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        <button type="button" onClick={onClose} className="mt-4 w-full text-center text-sm text-ink-muted">
          Fermer
        </button>
      </div>
    </div>
  )
}
