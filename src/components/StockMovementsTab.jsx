import { useEffect, useMemo, useState } from 'react'
import { supabase } from '../lib/supabase'
import { downloadStockExcel } from '../lib/stockExcel'
import { formatDateTime } from '../lib/dateFormat'
import PrintHeader from './PrintHeader'
import { printRegistry } from '../lib/printRegistry'

const PRODUCTS = ['B8', 'B12']
const MOVEMENT_TYPES = ['Production', 'Vente', 'Ajustement']

function formatQty(value) {
  return Number(value || 0).toLocaleString('fr-FR', { maximumFractionDigits: 2 })
}

export default function StockMovementsTab() {
  const [movements, setMovements] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [query, setQuery] = useState('')
  const [productFilter, setProductFilter] = useState('')
  const [typeFilter, setTypeFilter] = useState('')
  const [startDate, setStartDate] = useState('')
  const [endDate, setEndDate] = useState('')
  const [exporting, setExporting] = useState(false)

  useEffect(() => {
    let active = true

    async function load() {
      setLoading(true)
      const { data, error: fetchError } = await supabase
        .from('stock_movements')
        .select('*')
        .order('created_at', { ascending: false })
        .limit(1000)
      if (!active) return
      if (fetchError) {
        setError(`Erreur de chargement : ${fetchError.message}`)
      } else {
        setMovements(data ?? [])
        setError('')
      }
      setLoading(false)
    }

    load()

    const channel = supabase
      .channel('stock-movements-registry')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'stock_movements' }, (payload) => {
        setMovements((current) => applyRealtimeChange(current, payload))
      })
      .subscribe()

    return () => {
      active = false
      supabase.removeChannel(channel)
    }
  }, [])

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase()
    return movements.filter((m) => {
      if (productFilter && m.product_name !== productFilter) return false
      if (typeFilter && m.movement_type !== typeFilter) return false
      if (startDate && m.entry_date < startDate) return false
      if (endDate && m.entry_date > endDate) return false
      if (!q) return true
      return [m.reference, m.observations, m.entered_by_user].some((field) =>
        String(field ?? '').toLowerCase().includes(q)
      )
    })
  }, [movements, query, productFilter, typeFilter, startDate, endDate])

  async function handleExport() {
    setExporting(true)
    try {
      await downloadStockExcel(filtered)
    } catch (err) {
      setError(`Erreur lors de la génération du fichier Excel : ${err.message}`)
    } finally {
      setExporting(false)
    }
  }

  function handlePrint() {
    const filterParts = []
    if (query.trim()) filterParts.push(`Recherche : "${query.trim()}"`)
    if (productFilter) filterParts.push(`Produit : ${productFilter}`)
    if (typeFilter) filterParts.push(`Type : ${typeFilter}`)
    if (startDate) filterParts.push(`Du ${startDate}`)
    if (endDate) filterParts.push(`Au ${endDate}`)

    printRegistry({
      subtitle: 'Mouvements de stock',
      orientation: 'landscape',
      filters: filterParts.join(' — '),
      columns: [
        { key: 'entry_date', label: 'Date' },
        { key: 'created_at', label: 'Saisie le', format: (v) => formatDateTime(v) },
        { key: 'entry_time', label: 'Heure', format: (v) => (v ? v.slice(0, 5) : '—') },
        { key: 'product_name', label: 'Produit' },
        { key: 'movement_type', label: 'Type' },
        { key: 'cadence_theorique', label: 'Cadence théo.', align: 'right' },
        { key: 'feuillard', label: 'Feuillard', align: 'right' },
        { key: 'report', label: 'Report', align: 'right' },
        { key: 'cadence_reelle', label: 'Cadence réelle', align: 'right' },
        { key: 'consommation', label: 'Consommation', align: 'right' },
        { key: 'stock_final', label: 'Stock final', align: 'right' },
        { key: 'nb_wagon', label: 'Nb WAGON', align: 'right' },
        { key: 'nb_paquet', label: 'Nb PAQUET', align: 'right' },
        { key: 'total_wagon', label: 'Total WAGON', align: 'right' },
        { key: 'total_paquets', label: 'Total PAQUETS', align: 'right' },
        { key: 'nb_briques', label: 'Nb briques', align: 'right' },
        { key: 'commercial', label: 'Commercial', align: 'right' },
        { key: 'stocks_fin_journee', label: 'Stock fin journée', align: 'right' },
        { key: 'quantity_display', label: 'Quantité', align: 'right' },
        { key: 'stock_after', label: 'Stock après', align: 'right', format: (v) => formatQty(v) },
        { key: 'reference', label: 'Référence' },
        { key: 'observations', label: 'Observations' },
        { key: 'entered_by_user', label: 'Saisi par' },
      ],
      rows: filtered.map((m) => {
        const isProduction = m.movement_type === 'Production'
        return {
          ...m,
          report: isProduction ? formatQty(m.stock_start) : '—',
          stock_final: isProduction ? formatQty(m.stock_final) : '—',
          commercial: isProduction ? formatQty(m.commercial) : '—',
          stocks_fin_journee: isProduction ? formatQty(m.stocks_fin_journee) : '—',
          quantity_display: `${Number(m.quantity) > 0 ? '+' : ''}${formatQty(m.quantity)}`,
        }
      }),
    })
  }

  return (
    <div className="flex flex-col gap-4">
      <div className="no-print flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex flex-1 flex-col gap-3 sm:flex-row sm:flex-wrap">
          <input
            type="text"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Rechercher : référence, observations, saisi par…"
            className="min-h-11 rounded-lg border border-border bg-bg-soft px-3 py-2 text-ink placeholder:text-ink-muted/60 outline-none focus:border-terracotta sm:flex-1"
          />
          <select
            value={productFilter}
            onChange={(e) => setProductFilter(e.target.value)}
            className="min-h-11 rounded-lg border border-border bg-bg-soft px-3 py-2 text-ink outline-none focus:border-terracotta"
          >
            <option value="">Produit : tous</option>
            {PRODUCTS.map((p) => (
              <option key={p} value={p}>
                {p}
              </option>
            ))}
          </select>
          <select
            value={typeFilter}
            onChange={(e) => setTypeFilter(e.target.value)}
            className="min-h-11 rounded-lg border border-border bg-bg-soft px-3 py-2 text-ink outline-none focus:border-terracotta"
          >
            <option value="">Type : tous</option>
            {MOVEMENT_TYPES.map((t) => (
              <option key={t} value={t}>
                {t}
              </option>
            ))}
          </select>
          <input
            type="date"
            value={startDate}
            onChange={(e) => setStartDate(e.target.value)}
            className="min-h-11 rounded-lg border border-border bg-bg-soft px-3 py-2 text-ink outline-none focus:border-terracotta"
            aria-label="Du"
          />
          <input
            type="date"
            value={endDate}
            onChange={(e) => setEndDate(e.target.value)}
            className="min-h-11 rounded-lg border border-border bg-bg-soft px-3 py-2 text-ink outline-none focus:border-terracotta"
            aria-label="Au"
          />
        </div>
        <div className="flex shrink-0 gap-2">
          <button
            type="button"
            onClick={handlePrint}
            className="min-h-11 rounded-lg border border-border px-4 py-2 font-display text-ink-muted transition-colors hover:border-ink-muted"
          >
            Imprimer
          </button>
          <button
            type="button"
            onClick={handleExport}
            disabled={exporting || filtered.length === 0}
            className="min-h-11 rounded-lg border border-ocre px-4 py-2 font-display text-ocre transition-colors hover:bg-ocre/10 disabled:cursor-not-allowed disabled:opacity-50"
          >
            {exporting ? 'Génération…' : 'Exporter Excel'}
          </button>
        </div>
      </div>

      {error && (
        <p className="no-print rounded-lg border border-terracotta/50 bg-terracotta/10 px-4 py-3 text-sm text-terracotta">
          {error}
        </p>
      )}

      {loading ? (
        <p className="text-ink-muted">Chargement…</p>
      ) : filtered.length === 0 ? (
        <p className="text-ink-muted">Aucun mouvement.</p>
      ) : (
        <div className="print-area">
          <PrintHeader title="Mouvements de stock" />
          <div className="overflow-x-auto rounded-lg border border-border">
            <table className="w-full min-w-[2600px] border-collapse text-[11px] sm:text-sm">
              <thead>
                <tr className="border-b border-border bg-bg-soft text-left text-ink-muted">
                  <Th sticky>Date</Th>
                  <Th>Saisie le</Th>
                  <Th>Heure</Th>
                  <Th>Produit</Th>
                  <Th>Type</Th>
                  <Th>Cadence théo.</Th>
                  <Th>Feuillard</Th>
                  <Th>Report</Th>
                  <Th>Cadence réelle</Th>
                  <Th>Consommation</Th>
                  <Th>Stock final</Th>
                  <Th>Nb WAGON</Th>
                  <Th>Nb PAQUET</Th>
                  <Th>Total WAGON</Th>
                  <Th>Total PAQUETS</Th>
                  <Th>Nb briques</Th>
                  <Th>Commercial</Th>
                  <Th>Stock fin journée</Th>
                  <Th>Quantité</Th>
                  <Th>Stock après</Th>
                  <Th>Référence</Th>
                  <Th>Observations</Th>
                  <Th>Saisi par</Th>
                </tr>
              </thead>
              <tbody>
                {filtered.map((m) => (
                  <tr key={m.id} className="border-b border-border last:border-0">
                    <Td sticky>{m.entry_date}</Td>
                    <Td>{formatDateTime(m.created_at)}</Td>
                    <Td>{m.entry_time ? m.entry_time.slice(0, 5) : '—'}</Td>
                    <Td>{m.product_name}</Td>
                    <Td>
                      <MovementBadge type={m.movement_type} />
                    </Td>
                    <Td>{m.cadence_theorique ?? '—'}</Td>
                    <Td>{m.feuillard ?? '—'}</Td>
                    <Td>{m.movement_type === 'Production' ? formatQty(m.stock_start) : '—'}</Td>
                    <Td>{m.cadence_reelle ?? '—'}</Td>
                    <Td>{m.consommation ?? '—'}</Td>
                    <Td>{m.movement_type === 'Production' ? formatQty(m.stock_final) : '—'}</Td>
                    <Td>{m.nb_wagon ?? '—'}</Td>
                    <Td>{m.nb_paquet ?? '—'}</Td>
                    <Td>{m.total_wagon ?? '—'}</Td>
                    <Td>{m.total_paquets ?? '—'}</Td>
                    <Td>{m.nb_briques ?? '—'}</Td>
                    <Td>{m.movement_type === 'Production' ? formatQty(m.commercial) : '—'}</Td>
                    <Td className={m.movement_type === 'Production' ? 'font-display text-ocre' : ''}>
                      {m.movement_type === 'Production' ? formatQty(m.stocks_fin_journee) : '—'}
                    </Td>
                    <Td className={Number(m.quantity) < 0 ? 'text-terracotta' : 'text-green-500'}>
                      {Number(m.quantity) > 0 ? '+' : ''}
                      {formatQty(m.quantity)}
                    </Td>
                    <Td>{formatQty(m.stock_after)}</Td>
                    <Td>{m.reference ?? '—'}</Td>
                    <Td className="max-w-[240px] truncate" title={m.observations ?? ''}>
                      {m.observations ?? '—'}
                    </Td>
                    <Td>{m.entered_by_user ?? '—'}</Td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  )
}

function MovementBadge({ type }) {
  const styles = {
    Production: 'border-green-500/50 bg-green-500/10 text-green-500',
    Vente: 'border-terracotta/50 bg-terracotta/10 text-terracotta',
    Ajustement: 'border-ocre/50 bg-ocre/10 text-ocre',
  }
  return (
    <span className={`inline-block rounded-full border px-2 py-0.5 text-xs whitespace-nowrap ${styles[type] ?? ''}`}>
      {type}
    </span>
  )
}

function Th({ children, sticky }) {
  return (
    <th
      className={`px-1 py-1 font-display font-medium whitespace-nowrap sm:px-3 sm:py-2 ${
        sticky ? 'sticky left-0 z-20 bg-bg-soft' : ''
      }`}
    >
      {children}
    </th>
  )
}

function Td({ children, className = '', title, sticky }) {
  const stickyClass = sticky ? `sticky left-0 z-10 ${sticky === true ? 'bg-bg-card' : sticky}` : ''
  return (
    <td className={`px-1 py-1 whitespace-nowrap sm:px-3 sm:py-2 ${stickyClass} ${className}`} title={title}>
      {children}
    </td>
  )
}

function applyRealtimeChange(current, payload) {
  if (payload.eventType === 'INSERT') {
    if (current.some((m) => m.id === payload.new.id)) return current
    return [payload.new, ...current]
  }
  if (payload.eventType === 'UPDATE') {
    return current.map((m) => (m.id === payload.new.id ? payload.new : m))
  }
  if (payload.eventType === 'DELETE') {
    return current.filter((m) => m.id !== payload.old.id)
  }
  return current
}
