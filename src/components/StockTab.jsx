import { useEffect, useMemo, useState } from 'react'
import { supabase } from '../lib/supabase'
import { getSession } from '../lib/auth'

const todayISO = () => new Date().toISOString().slice(0, 10)
const formatHHMM = (date) => date.toTimeString().slice(0, 5)

const PRODUCTS = ['B8', 'B12']
const MOVEMENT_TYPES = ['Production', 'Ajustement']

function formatQty(value) {
  return Number(value || 0).toLocaleString('fr-FR', { maximumFractionDigits: 2 })
}

const emptyDraft = {
  product_name: 'B8',
  movement_type: 'Production',
  quantity: '',
  wagons: '',
  paquets: '',
  observations: '',
}

export default function StockTab() {
  const [stocks, setStocks] = useState([])
  const [movements, setMovements] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [draft, setDraft] = useState(emptyDraft)
  const [submitting, setSubmitting] = useState(false)
  const [success, setSuccess] = useState('')

  useEffect(() => {
    let active = true

    async function load() {
      setLoading(true)
      const [{ data: stockRows, error: stockError }, { data: movementRows, error: movementError }] = await Promise.all([
        supabase.from('product_stock').select('*').order('product_name'),
        supabase.from('stock_movements').select('*').order('created_at', { ascending: false }).limit(500),
      ])
      if (!active) return
      if (stockError || movementError) {
        setError(`Erreur de chargement : ${(stockError || movementError).message}`)
      } else {
        setStocks(stockRows ?? [])
        setMovements(movementRows ?? [])
        setError('')
      }
      setLoading(false)
    }

    load()

    const stockChannel = supabase
      .channel('product-stock')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'product_stock' }, (payload) => {
        setStocks((current) => current.map((s) => (s.id === payload.new.id ? payload.new : s)))
      })
      .subscribe()

    const movementChannel = supabase
      .channel('stock-movements')
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'stock_movements' }, (payload) => {
        setMovements((current) => [payload.new, ...current])
      })
      .subscribe()

    return () => {
      active = false
      supabase.removeChannel(stockChannel)
      supabase.removeChannel(movementChannel)
    }
  }, [])

  function update(field, value) {
    setDraft((d) => ({ ...d, [field]: value }))
  }

  function validate() {
    if (draft.quantity === '' || Number(draft.quantity) === 0) return 'La quantité est obligatoire.'
    if (draft.movement_type === 'Production' && Number(draft.quantity) < 0) {
      return 'La quantité de production doit être positive (utilisez "Ajustement" pour une correction négative).'
    }
    return ''
  }

  async function handleSubmit(e) {
    e.preventDefault()
    setSuccess('')
    const validationError = validate()
    if (validationError) {
      setError(validationError)
      return
    }
    setError('')
    setSubmitting(true)

    const notes = []
    if (draft.movement_type === 'Production') {
      if (draft.wagons !== '') notes.push(`${draft.wagons} wagon(s)`)
      if (draft.paquets !== '') notes.push(`${draft.paquets} paquet(s)`)
    }
    if (draft.observations.trim()) notes.push(draft.observations.trim())

    const payload = {
      entry_date: todayISO(),
      entry_time: formatHHMM(new Date()),
      product_name: draft.product_name,
      movement_type: draft.movement_type,
      quantity: Number(draft.quantity),
      stock_after: 0, // recalculé par le trigger stock_movements_before_insert
      observations: notes.length > 0 ? notes.join(' — ') : null,
      entered_by_user: getSession()?.username ?? null,
    }

    const { error: insertError } = await supabase.from('stock_movements').insert(payload).select().single()

    if (insertError) {
      setSubmitting(false)
      setError(`Erreur d'enregistrement : ${insertError.message}`)
      return
    }

    setDraft(emptyDraft)
    setSuccess(`Mouvement ${draft.movement_type} enregistré pour ${draft.product_name}.`)
    setSubmitting(false)
  }

  const dailySummary = useMemo(() => buildDailySummary(movements), [movements])

  return (
    <div className="flex flex-col gap-6">
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        {PRODUCTS.map((product) => (
          <StockGauge key={product} stock={stocks.find((s) => s.product_name === product)} product={product} />
        ))}
      </div>

      <form onSubmit={handleSubmit} className="flex flex-col gap-4 rounded-xl border border-border bg-bg-card p-4">
        <h2 className="font-display text-lg text-ink">Saisie manuelle (production / ajustement)</h2>

        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <Field label="Produit" required>
            <select value={draft.product_name} onChange={(e) => update('product_name', e.target.value)} className={inputClass}>
              {PRODUCTS.map((p) => (
                <option key={p} value={p}>
                  {p}
                </option>
              ))}
            </select>
          </Field>
          <Field label="Type" required>
            <select value={draft.movement_type} onChange={(e) => update('movement_type', e.target.value)} className={inputClass}>
              {MOVEMENT_TYPES.map((t) => (
                <option key={t} value={t}>
                  {t}
                </option>
              ))}
            </select>
          </Field>
        </div>

        <Field label="Quantité" required>
          <input
            type="number"
            inputMode="decimal"
            step="0.01"
            value={draft.quantity}
            onChange={(e) => update('quantity', e.target.value)}
            className={inputClass}
            placeholder={draft.movement_type === 'Ajustement' ? 'positif ou négatif' : 'obligatoire'}
            required
          />
        </Field>

        {draft.movement_type === 'Production' && (
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <Field label="Nombre WAGON">
              <input
                type="number"
                inputMode="numeric"
                step="1"
                min="0"
                value={draft.wagons}
                onChange={(e) => update('wagons', e.target.value)}
                className={inputClass}
                placeholder="optionnel"
              />
            </Field>
            <Field label="Nombre PAQUET">
              <input
                type="number"
                inputMode="numeric"
                step="1"
                min="0"
                value={draft.paquets}
                onChange={(e) => update('paquets', e.target.value)}
                className={inputClass}
                placeholder="optionnel"
              />
            </Field>
          </div>
        )}

        <Field label="Observations">
          <textarea
            value={draft.observations}
            onChange={(e) => update('observations', e.target.value)}
            className={`${inputClass} min-h-16 resize-y`}
            placeholder="optionnel"
          />
        </Field>

        {error && (
          <p className="rounded-lg border border-terracotta/50 bg-terracotta/10 px-4 py-3 text-sm text-terracotta">
            {error}
          </p>
        )}
        {success && (
          <p className="rounded-lg border border-ocre/50 bg-ocre/10 px-4 py-3 text-sm text-ocre">{success}</p>
        )}

        <button
          type="submit"
          disabled={submitting}
          className="min-h-12 rounded-lg bg-terracotta px-4 py-3 font-display text-lg font-medium tracking-wide text-ink transition-colors hover:bg-terracotta-hover disabled:opacity-50"
        >
          {submitting ? 'Enregistrement…' : 'Enregistrer le mouvement'}
        </button>
      </form>

      <div className="flex flex-col gap-3">
        <h2 className="font-display text-lg text-ink">Résumé journalier</h2>
        {dailySummary.length === 0 ? (
          <p className="text-ink-muted">Aucun mouvement.</p>
        ) : (
          <div className="overflow-x-auto rounded-lg border border-border">
            <table className="w-full min-w-[700px] border-collapse text-sm">
              <thead>
                <tr className="border-b border-border bg-bg-soft text-left text-ink-muted">
                  <Th>Date</Th>
                  <Th>Produit</Th>
                  <Th>Report</Th>
                  <Th>Production</Th>
                  <Th>Commercial (ventes)</Th>
                  <Th>Stock fin de journée</Th>
                </tr>
              </thead>
              <tbody>
                {dailySummary.map((row) => (
                  <tr key={`${row.product}-${row.date}`} className="border-b border-border last:border-0">
                    <Td>{row.date}</Td>
                    <Td>{row.product}</Td>
                    <Td>{row.report != null ? formatQty(row.report) : '—'}</Td>
                    <Td>{formatQty(row.production)}</Td>
                    <Td>{formatQty(row.ventes)}</Td>
                    <Td className="font-display text-ocre">{formatQty(row.finJournee)}</Td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      <div className="flex flex-col gap-3">
        <h2 className="font-display text-lg text-ink">Mouvements récents</h2>
        {loading ? (
          <p className="text-ink-muted">Chargement…</p>
        ) : movements.length === 0 ? (
          <p className="text-ink-muted">Aucun mouvement.</p>
        ) : (
          <div className="overflow-x-auto rounded-lg border border-border">
            <table className="w-full min-w-[900px] border-collapse text-sm">
              <thead>
                <tr className="border-b border-border bg-bg-soft text-left text-ink-muted">
                  <Th>Date</Th>
                  <Th>Heure</Th>
                  <Th>Produit</Th>
                  <Th>Type</Th>
                  <Th>Quantité</Th>
                  <Th>Stock après</Th>
                  <Th>Référence</Th>
                  <Th>Observations</Th>
                  <Th>Saisi par</Th>
                </tr>
              </thead>
              <tbody>
                {movements.slice(0, 100).map((m) => (
                  <tr key={m.id} className="border-b border-border last:border-0">
                    <Td>{m.entry_date}</Td>
                    <Td>{m.entry_time ? m.entry_time.slice(0, 5) : '—'}</Td>
                    <Td>{m.product_name}</Td>
                    <Td>
                      <MovementBadge type={m.movement_type} />
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
        )}
      </div>
    </div>
  )
}

// Reconstruit, pour chaque (produit, jour) présent dans les mouvements
// chargés, le Report (stock juste avant le 1er mouvement du jour), la
// Production et le Commercial (ventes, en valeur positive) du jour, et le
// Stock fin de journée (stock_after du dernier mouvement du jour) -- ce
// dernier vient directement de la colonne stock_after, donc toujours exact
// même si d'autres mouvements (Ajustement) ont eu lieu le même jour.
function buildDailySummary(movements) {
  const groups = new Map()
  for (const m of movements) {
    const key = `${m.product_name}|${m.entry_date}`
    if (!groups.has(key)) {
      groups.set(key, { product: m.product_name, date: m.entry_date, production: 0, ventes: 0, items: [] })
    }
    const group = groups.get(key)
    if (m.movement_type === 'Production') group.production += Number(m.quantity)
    if (m.movement_type === 'Vente') group.ventes += Math.max(0, -Number(m.quantity))
    group.items.push(m)
  }

  const rows = []
  for (const group of groups.values()) {
    const sorted = [...group.items].sort((a, b) => (a.created_at < b.created_at ? -1 : 1))
    const first = sorted[0]
    const last = sorted[sorted.length - 1]
    rows.push({
      product: group.product,
      date: group.date,
      report: first ? Number(first.stock_after) - Number(first.quantity) : null,
      production: group.production,
      ventes: group.ventes,
      finJournee: last ? Number(last.stock_after) : 0,
    })
  }

  return rows.sort((a, b) => (a.date < b.date ? 1 : a.date > b.date ? -1 : a.product.localeCompare(b.product)))
}

function StockGauge({ stock, product }) {
  if (!stock) {
    return (
      <div className="rounded-lg border border-border bg-bg-soft p-4">
        <p className="text-sm text-ink-muted">Stock {product} : indisponible</p>
      </div>
    )
  }

  const percent = Math.max(0, Math.min(100, (stock.current_stock / stock.max_capacity) * 100))
  const isLow = percent < 10

  return (
    <div className="rounded-lg border border-border bg-bg-soft p-4">
      <div className="mb-2 flex items-center justify-between">
        <p className="text-sm text-ink-muted">Stock {product}</p>
        <p className={`font-display text-lg ${isLow ? 'text-terracotta' : 'text-ocre'}`}>
          {formatQty(stock.current_stock)} / {formatQty(stock.max_capacity)}
        </p>
      </div>
      <div className="h-3 w-full overflow-hidden rounded-full bg-bg">
        <div
          className={`h-full rounded-full transition-all ${isLow ? 'bg-terracotta' : 'bg-ocre'}`}
          style={{ width: `${percent}%` }}
        />
      </div>
      {isLow && <p className="mt-2 text-sm text-terracotta">⚠ Stock bas (moins de 10%)</p>}
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

function Field({ label, required, children }) {
  return (
    <label className="flex flex-col gap-1.5">
      <span className="text-sm text-ink-muted">
        {label}
        {required && <span className="text-terracotta"> *</span>}
      </span>
      {children}
    </label>
  )
}

function Th({ children }) {
  return <th className="px-3 py-2 font-display font-medium whitespace-nowrap">{children}</th>
}

function Td({ children, className = '', title }) {
  return (
    <td className={`px-3 py-2 whitespace-nowrap ${className}`} title={title}>
      {children}
    </td>
  )
}

const inputClass =
  'min-h-11 rounded-lg border border-border bg-bg-soft px-3 py-2 text-ink placeholder:text-ink-muted/60 outline-none focus:border-terracotta'
