import { useEffect, useState } from 'react'
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
  entry_date: todayISO(),
  product_name: 'B8',
  movement_type: 'Production',
  cadence_theorique: '',
  feuillard: '',
  stock_start: '0',
  cadence_reelle: '',
  consommation: '',
  stock_final: '0',
  nb_wagon: '',
  nb_paquet: '',
  nb_briques: '',
  quantity: '',
  observations: '',
}

export default function StockTab() {
  const [stocks, setStocks] = useState([])
  const [error, setError] = useState('')
  const [draft, setDraft] = useState(emptyDraft)
  const [stockFinalTouched, setStockFinalTouched] = useState(false)
  const [commercial, setCommercial] = useState(0)
  const [lastProduction, setLastProduction] = useState({})
  const [submitting, setSubmitting] = useState(false)
  const [success, setSuccess] = useState('')

  useEffect(() => {
    let active = true

    async function load() {
      const { data: stockRows, error: stockError } = await supabase.from('product_stock').select('*').order('product_name')
      if (!active) return
      if (stockError) {
        setError(`Erreur de chargement : ${stockError.message}`)
      } else {
        setStocks(stockRows ?? [])
        setError('')
      }
    }

    load()
    loadLastProduction()

    const stockChannel = supabase
      .channel('product-stock')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'product_stock' }, (payload) => {
        setStocks((current) => current.map((s) => (s.id === payload.new.id ? payload.new : s)))
      })
      .subscribe()

    return () => {
      active = false
      supabase.removeChannel(stockChannel)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // Dernier mouvement de type Production par produit, pour cumuler
  // Total WAGON / Total PAQUETS (report + saisie du jour).
  async function loadLastProduction() {
    const results = {}
    for (const product of PRODUCTS) {
      const { data } = await supabase
        .from('stock_movements')
        .select('total_wagon, total_paquets')
        .eq('product_name', product)
        .eq('movement_type', 'Production')
        .order('created_at', { ascending: false })
        .limit(1)
        .maybeSingle()
      results[product] = data ?? { total_wagon: 0, total_paquets: 0 }
    }
    setLastProduction(results)
  }

  // Ne réinitialise "Stock final modifié à la main" que sur un vrai
  // changement de produit -- pas à chaque rafraîchissement temps réel de
  // `stocks` (ex: une vente en cours ailleurs), pour ne pas effacer une
  // correction manuelle en cours de saisie.
  useEffect(() => {
    if (draft.movement_type !== 'Production') return
    setStockFinalTouched(false)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [draft.product_name, draft.movement_type])

  // Report = stock actuel du produit (toujours égal au stock_after de la
  // dernière saisie, quel que soit son type, grâce au trigger stock_movements_apply).
  useEffect(() => {
    if (draft.movement_type !== 'Production') return
    const stock = stocks.find((s) => s.product_name === draft.product_name)
    setDraft((d) => ({ ...d, stock_start: stock ? String(stock.current_stock) : '0' }))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [draft.product_name, draft.movement_type, stocks])

  // Commercial = quantité vendue ce jour pour ce produit, depuis invoices.
  useEffect(() => {
    if (draft.movement_type !== 'Production') return
    let cancelled = false
    async function loadCommercial() {
      const column = draft.product_name === 'B8' ? 'qty_b8' : 'qty_b12'
      const { data } = await supabase.from('invoices').select(column).eq('entry_date', draft.entry_date)
      if (cancelled) return
      const sum = (data ?? []).reduce((s, r) => s + (Number(r[column]) || 0), 0)
      setCommercial(sum)
    }
    loadCommercial()
    return () => {
      cancelled = true
    }
  }, [draft.product_name, draft.entry_date, draft.movement_type])

  const stockStart = Number(draft.stock_start) || 0
  const nbBriques = Number(draft.nb_briques) || 0
  const nbWagon = Number(draft.nb_wagon) || 0
  const nbPaquet = Number(draft.nb_paquet) || 0
  const computedStockFinal = stockStart + nbBriques
  const stocksFinJournee = stockStart + nbBriques - commercial
  const prevTotals = lastProduction[draft.product_name] ?? { total_wagon: 0, total_paquets: 0 }
  const totalWagon = (Number(prevTotals.total_wagon) || 0) + nbWagon
  const totalPaquets = (Number(prevTotals.total_paquets) || 0) + nbPaquet

  // Stock final = calculé par défaut (Report + Production), mais reste
  // modifiable à la main ("calculé ou saisi") -- on arrête de le recalculer
  // dès que l'utilisateur y touche directement.
  useEffect(() => {
    if (draft.movement_type !== 'Production' || stockFinalTouched) return
    setDraft((d) => ({ ...d, stock_final: String(computedStockFinal) }))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [stockStart, nbBriques, stockFinalTouched, draft.movement_type])

  function update(field, value) {
    setDraft((d) => ({ ...d, [field]: value }))
  }

  function validate() {
    if (draft.movement_type === 'Ajustement') {
      if (draft.quantity === '' || Number(draft.quantity) === 0) return 'La quantité est obligatoire.'
      return ''
    }
    if (draft.nb_briques === '' || Number(draft.nb_briques) < 0) {
      return 'Le nombre de briques est obligatoire.'
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

    const isProduction = draft.movement_type === 'Production'

    const payload = isProduction
      ? {
          entry_date: draft.entry_date,
          entry_time: formatHHMM(new Date()),
          product_name: draft.product_name,
          movement_type: 'Production',
          quantity: nbBriques,
          stock_after: 0, // recalculé par le trigger stock_movements_before_insert
          cadence_theorique: draft.cadence_theorique === '' ? null : Number(draft.cadence_theorique),
          feuillard: draft.feuillard === '' ? null : Number(draft.feuillard),
          stock_start: stockStart,
          cadence_reelle: draft.cadence_reelle === '' ? null : Number(draft.cadence_reelle),
          consommation: draft.consommation === '' ? null : Number(draft.consommation),
          stock_final: Number(draft.stock_final) || 0,
          nb_wagon: nbWagon,
          nb_paquet: nbPaquet,
          total_wagon: totalWagon,
          total_paquets: totalPaquets,
          nb_briques: nbBriques,
          commercial,
          stocks_fin_journee: stocksFinJournee,
          observations: draft.observations.trim() || null,
          entered_by_user: getSession()?.username ?? null,
        }
      : {
          entry_date: draft.entry_date,
          entry_time: formatHHMM(new Date()),
          product_name: draft.product_name,
          movement_type: 'Ajustement',
          quantity: Number(draft.quantity),
          stock_after: 0,
          observations: draft.observations.trim() || null,
          entered_by_user: getSession()?.username ?? null,
        }

    const { error: insertError } = await supabase.from('stock_movements').insert(payload).select().single()

    if (insertError) {
      setSubmitting(false)
      setError(`Erreur d'enregistrement : ${insertError.message}`)
      return
    }

    setDraft({ ...emptyDraft, entry_date: draft.entry_date, product_name: draft.product_name })
    setStockFinalTouched(false)
    setSuccess(`Mouvement ${draft.movement_type} enregistré pour ${draft.product_name}.`)
    setSubmitting(false)
    loadLastProduction()
  }

  return (
    <div className="flex flex-col gap-6">
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        {PRODUCTS.map((product) => (
          <StockGauge key={product} stock={stocks.find((s) => s.product_name === product)} product={product} />
        ))}
      </div>

      <form onSubmit={handleSubmit} className="flex flex-col gap-4 rounded-xl border border-border bg-bg-card p-4">
        <h2 className="font-display text-lg text-ink">Fiche de stocks produits finis</h2>

        <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
          <Field label="Date" required>
            <input
              type="date"
              value={draft.entry_date}
              onChange={(e) => update('entry_date', e.target.value)}
              className={inputClass}
              required
            />
          </Field>
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

        {draft.movement_type === 'Ajustement' ? (
          <Field label="Quantité (+ ou -)" required>
            <input
              type="number"
              inputMode="decimal"
              step="0.01"
              value={draft.quantity}
              onChange={(e) => update('quantity', e.target.value)}
              className={inputClass}
              placeholder="positif ou négatif"
              required
            />
          </Field>
        ) : (
          <>
            <p className="font-display text-sm text-ocre">Production</p>

            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              <Field label="Cadence théorique">
                <input
                  type="number"
                  step="0.01"
                  value={draft.cadence_theorique}
                  onChange={(e) => update('cadence_theorique', e.target.value)}
                  className={inputClass}
                  placeholder="optionnel"
                />
              </Field>
              <Field label="Feuillard">
                <input
                  type="number"
                  step="0.01"
                  value={draft.feuillard}
                  onChange={(e) => update('feuillard', e.target.value)}
                  className={inputClass}
                  placeholder="optionnel"
                />
              </Field>
            </div>

            <Field label="Stock (début de journée / report)">
              <input
                type="text"
                value={formatQty(draft.stock_start)}
                readOnly
                disabled
                className={`${inputClass} cursor-not-allowed opacity-60`}
              />
            </Field>

            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              <Field label="Cadence réelle">
                <input
                  type="number"
                  step="0.01"
                  value={draft.cadence_reelle}
                  onChange={(e) => update('cadence_reelle', e.target.value)}
                  className={inputClass}
                  placeholder="optionnel"
                />
              </Field>
              <Field label="Consommation">
                <input
                  type="number"
                  step="0.01"
                  value={draft.consommation}
                  onChange={(e) => update('consommation', e.target.value)}
                  className={inputClass}
                  placeholder="optionnel"
                />
              </Field>
            </div>

            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              <Field label="Nombre WAGON">
                <input
                  type="number"
                  inputMode="numeric"
                  step="1"
                  min="0"
                  value={draft.nb_wagon}
                  onChange={(e) => update('nb_wagon', e.target.value)}
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
                  value={draft.nb_paquet}
                  onChange={(e) => update('nb_paquet', e.target.value)}
                  className={inputClass}
                  placeholder="optionnel"
                />
              </Field>
            </div>

            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              <Field label="Total WAGON (cumulé)">
                <input
                  type="text"
                  value={totalWagon}
                  readOnly
                  disabled
                  className={`${inputClass} cursor-not-allowed opacity-60`}
                />
              </Field>
              <Field label="Total PAQUETS (cumulé)">
                <input
                  type="text"
                  value={totalPaquets}
                  readOnly
                  disabled
                  className={`${inputClass} cursor-not-allowed opacity-60`}
                />
              </Field>
            </div>

            <Field label="Nombre de briques" required>
              <input
                type="number"
                inputMode="numeric"
                step="1"
                min="0"
                value={draft.nb_briques}
                onChange={(e) => update('nb_briques', e.target.value)}
                className={inputClass}
                required
              />
            </Field>

            <Field label="Stock final">
              <input
                type="number"
                step="0.01"
                value={draft.stock_final}
                onChange={(e) => {
                  setStockFinalTouched(true)
                  update('stock_final', e.target.value)
                }}
                className={inputClass}
              />
              <span className="text-xs text-ink-muted">Calculé automatiquement (Report + Production), modifiable si besoin.</span>
            </Field>

            <p className="font-display text-sm text-ocre">Commercial</p>

            <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
              <Field label="Report">
                <input
                  type="text"
                  value={formatQty(stockStart)}
                  readOnly
                  disabled
                  className={`${inputClass} cursor-not-allowed opacity-60`}
                />
              </Field>
              <Field label="Commercial (vendu ce jour)">
                <input
                  type="text"
                  value={formatQty(commercial)}
                  readOnly
                  disabled
                  className={`${inputClass} cursor-not-allowed opacity-60`}
                />
              </Field>
              <Field label="Stocks fin journée">
                <input
                  type="text"
                  value={formatQty(stocksFinJournee)}
                  readOnly
                  disabled
                  className={`${inputClass} cursor-not-allowed font-display text-ocre`}
                />
              </Field>
            </div>
          </>
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
    </div>
  )
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

const inputClass =
  'min-h-11 rounded-lg border border-border bg-bg-soft px-3 py-2 text-ink placeholder:text-ink-muted/60 outline-none focus:border-terracotta'
