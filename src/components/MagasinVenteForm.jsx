import { useEffect, useMemo, useState } from 'react'
import { supabase } from '../lib/supabase'
import { getSession } from '../lib/auth'
import { notifyMagasinVente } from '../lib/ntfy'
import { PAYMENT_MODES, formatDA, formatQty, computeVenteTotals, itemLineTotal } from '../lib/magasin'

const todayISO = () => new Date().toISOString().slice(0, 10)
const formatHHMM = (date) => date.toTimeString().slice(0, 5)

let lineSeq = 0
const newLine = () => ({
  key: `l${++lineSeq}`,
  search: '',
  stock_id: null,
  reference: '',
  designation: '',
  quantite: '',
  prix_unitaire: '',
  stock_qty: null,
})

const emptyDraft = {
  bon_number: '',
  entry_date: todayISO(),
  client_name: '',
  remise: '',
  payment_mode: 'Espèces',
  cheque_number: '',
  cheque_bank: '',
  observations: '',
}

function stockLabel(item) {
  return item.reference ? `${item.designation} [${item.reference}]` : item.designation
}

export default function MagasinVenteForm() {
  const [draft, setDraft] = useState(emptyDraft)
  const [lines, setLines] = useState([newLine()])
  const [stock, setStock] = useState([])
  const [clients, setClients] = useState([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [success, setSuccess] = useState('')
  const [clock, setClock] = useState(() => formatHHMM(new Date()))

  useEffect(() => {
    const id = setInterval(() => setClock(formatHHMM(new Date())), 30_000)
    return () => clearInterval(id)
  }, [])

  useEffect(() => {
    async function load() {
      const [{ data: bonRow }, { data: stockRows }, { data: clientRows }] = await Promise.all([
        supabase.from('magasin_ventes').select('bon_number').order('bon_number', { ascending: false }).limit(1),
        supabase.from('magasin_stock').select('id, reference, designation, prix_detail, prix_gros, quantite'),
        supabase.from('magasin_clients').select('name').order('name'),
      ])
      setDraft((d) => ({ ...d, bon_number: bonRow?.[0]?.bon_number ? bonRow[0].bon_number + 1 : 1 }))
      setStock(stockRows ?? [])
      setClients((clientRows ?? []).map((c) => c.name))
    }
    load()
  }, [])

  const stockByLabel = useMemo(() => {
    const map = new Map()
    for (const item of stock) map.set(stockLabel(item), item)
    return map
  }, [stock])

  function update(field, value) {
    setDraft((d) => ({ ...d, [field]: value }))
  }

  function setLine(key, patch) {
    setLines((current) => current.map((l) => (l.key === key ? { ...l, ...patch } : l)))
  }

  function handleArticleSearch(key, value) {
    const match = stockByLabel.get(value)
    if (match) {
      setLine(key, {
        search: value,
        stock_id: match.id,
        reference: match.reference ?? '',
        designation: match.designation,
        prix_unitaire: match.prix_detail ? String(match.prix_detail) : '',
        stock_qty: Number(match.quantite) || 0,
      })
    } else {
      setLine(key, { search: value, stock_id: null, designation: value, reference: '', stock_qty: null })
    }
  }

  function addLine() {
    setLines((current) => [...current, newLine()])
  }

  function removeLine(key) {
    setLines((current) => (current.length === 1 ? [newLine()] : current.filter((l) => l.key !== key)))
  }

  const validLines = lines.filter(
    (l) => l.designation.trim() && Number(l.quantite) > 0 && l.prix_unitaire !== '' && Number(l.prix_unitaire) >= 0
  )

  const items = validLines.map((l) => ({
    stock_id: l.stock_id,
    reference: l.reference.trim() || null,
    designation: l.designation.trim(),
    quantite: Number(l.quantite),
    prix_unitaire: Number(l.prix_unitaire),
    total: itemLineTotal(l.quantite, l.prix_unitaire),
  }))

  const { totalHt, total } = computeVenteTotals(items, draft.remise)

  const shortLines = validLines.filter((l) => l.stock_qty != null && Number(l.quantite) > l.stock_qty)

  const isCheque = draft.payment_mode === 'Chèque'
  const isCredit = draft.payment_mode === 'Crédit'

  function validate() {
    if (!draft.bon_number) return 'Le n° de bon est obligatoire.'
    if (!draft.entry_date) return 'La date est obligatoire.'
    if (items.length === 0) return 'Ajoutez au moins un article (désignation, quantité et prix).'
    if (isCredit && !draft.client_name.trim()) return 'Le client est obligatoire pour une vente à crédit.'
    if (isCheque) {
      if (!draft.cheque_number.trim()) return 'Le n° de chèque est obligatoire.'
      if (!draft.cheque_bank.trim()) return 'La banque du chèque est obligatoire.'
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
    setLoading(true)

    const bonNumber = Number(draft.bon_number)

    const { data: existing } = await supabase
      .from('magasin_ventes')
      .select('id')
      .eq('bon_number', bonNumber)
      .maybeSingle()
    if (existing) {
      setLoading(false)
      setError('Ce n° de bon existe déjà.')
      return
    }

    const payload = {
      bon_number: bonNumber,
      entry_date: draft.entry_date,
      entry_time: formatHHMM(new Date()),
      client_name: draft.client_name.trim() || null,
      items,
      total_ht: totalHt,
      remise: Number(draft.remise) || 0,
      total,
      payment_mode: draft.payment_mode,
      cheque_number: isCheque ? draft.cheque_number.trim() : null,
      cheque_bank: isCheque ? draft.cheque_bank.trim() : null,
      observations: draft.observations.trim() || null,
      is_payment: false,
      entered_by_user: getSession()?.username ?? null,
    }

    const { data, error: rpcError } = await supabase.rpc('magasin_record_vente', { p: payload })
    setLoading(false)

    if (rpcError) {
      setError(
        rpcError.code === '23505'
          ? 'Ce n° de bon existe déjà.'
          : `Erreur d'enregistrement : ${rpcError.message}`
      )
      return
    }

    notifyMagasinVente(data)

    const warn = shortLines.length
      ? ` (stock insuffisant sur ${shortLines.length} article(s), stock ajusté quand même)`
      : ''
    setSuccess(`Bon de vente n° ${bonNumber} enregistré${warn}.`)
    setDraft({ ...emptyDraft, bon_number: bonNumber + 1, entry_date: draft.entry_date })
    setLines([newLine()])
    // Recharge stock (quantités à jour) et clients (client éventuellement créé).
    const [{ data: stockRows }, { data: clientRows }] = await Promise.all([
      supabase.from('magasin_stock').select('id, reference, designation, prix_detail, prix_gros, quantite'),
      supabase.from('magasin_clients').select('name').order('name'),
    ])
    setStock(stockRows ?? [])
    setClients((clientRows ?? []).map((c) => c.name))
  }

  return (
    <form onSubmit={handleSubmit} className="flex flex-col gap-4">
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
        <Field label="N° de bon" required>
          <input
            type="number"
            inputMode="numeric"
            value={draft.bon_number}
            onChange={(e) => update('bon_number', e.target.value)}
            className={inputClass}
            required
          />
        </Field>
        <Field label="Date" required>
          <input
            type="date"
            value={draft.entry_date}
            onChange={(e) => update('entry_date', e.target.value)}
            className={inputClass}
            required
          />
        </Field>
        <Field label="Heure">
          <input type="text" value={clock} readOnly disabled className={`${inputClass} cursor-not-allowed opacity-60`} />
        </Field>
      </div>

      <Field label="Client">
        <input
          type="text"
          list="magasin-clients-list"
          value={draft.client_name}
          onChange={(e) => update('client_name', e.target.value)}
          className={inputClass}
          autoComplete="off"
          placeholder="nom du client (obligatoire si crédit)"
        />
        <datalist id="magasin-clients-list">
          {clients.map((c) => (
            <option key={c} value={c} />
          ))}
        </datalist>
      </Field>

      <div className="flex flex-col gap-2">
        <span className="text-sm text-ink-muted">Articles</span>
        <datalist id="magasin-stock-list">
          {stock.map((item) => (
            <option key={item.id} value={stockLabel(item)} />
          ))}
        </datalist>

        <div className="flex flex-col gap-2">
          {lines.map((line) => {
            const lineTotal = itemLineTotal(line.quantite, line.prix_unitaire)
            const short = line.stock_qty != null && Number(line.quantite) > line.stock_qty
            return (
              <div key={line.key} className="rounded-lg border border-border bg-bg-soft p-3">
                <div className="grid grid-cols-1 gap-2 sm:grid-cols-12">
                  <div className="sm:col-span-5">
                    <input
                      type="text"
                      list="magasin-stock-list"
                      value={line.search}
                      onChange={(e) => handleArticleSearch(line.key, e.target.value)}
                      className={inputClass}
                      autoComplete="off"
                      placeholder="Rechercher un article (référence ou désignation)"
                    />
                    {line.stock_qty != null && (
                      <p className="mt-1 text-xs text-ink-muted">
                        En stock : {formatQty(line.stock_qty)}
                        {line.stock_id && ' · prix détail pré-rempli'}
                      </p>
                    )}
                  </div>
                  <div className="sm:col-span-2">
                    <input
                      type="number"
                      inputMode="decimal"
                      step="0.01"
                      min="0"
                      value={line.quantite}
                      onChange={(e) => setLine(line.key, { quantite: e.target.value })}
                      className={`${inputClass} ${short ? 'border-terracotta' : ''}`}
                      placeholder="Qté"
                    />
                  </div>
                  <div className="sm:col-span-2">
                    <input
                      type="number"
                      inputMode="decimal"
                      step="0.01"
                      min="0"
                      value={line.prix_unitaire}
                      onChange={(e) => setLine(line.key, { prix_unitaire: e.target.value })}
                      className={inputClass}
                      placeholder="P.U."
                    />
                  </div>
                  <div className="flex items-center justify-between gap-2 sm:col-span-3">
                    <span className="font-display text-ink">{formatDA(lineTotal)} DA</span>
                    <div className="flex gap-1">
                      <button
                        type="button"
                        onClick={addLine}
                        className="rounded border border-ocre px-2 py-1 text-ocre hover:bg-ocre/10"
                        title="Ajouter une ligne"
                      >
                        +
                      </button>
                      <button
                        type="button"
                        onClick={() => removeLine(line.key)}
                        className="rounded border border-terracotta/50 px-2 py-1 text-terracotta hover:bg-terracotta/10"
                        title="Supprimer la ligne"
                      >
                        −
                      </button>
                    </div>
                  </div>
                </div>
                {short && (
                  <p className="mt-2 text-xs text-terracotta">
                    ⚠ Quantité demandée ({formatQty(line.quantite)}) supérieure au stock ({formatQty(line.stock_qty)}).
                  </p>
                )}
              </div>
            )
          })}
        </div>
      </div>

      <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
        <Field label="Total HT">
          <input type="text" value={`${formatDA(totalHt)} DA`} readOnly disabled className={`${inputClass} cursor-not-allowed opacity-70`} />
        </Field>
        <Field label="Remise (DA)">
          <input
            type="number"
            inputMode="decimal"
            step="0.01"
            min="0"
            value={draft.remise}
            onChange={(e) => update('remise', e.target.value)}
            className={inputClass}
          />
        </Field>
        <Field label="Total">
          <input
            type="text"
            value={`${formatDA(total)} DA`}
            readOnly
            disabled
            className={`${inputClass} cursor-not-allowed font-display text-ocre opacity-100`}
          />
        </Field>
      </div>

      <Field label="Mode de paiement" required>
        <select value={draft.payment_mode} onChange={(e) => update('payment_mode', e.target.value)} className={inputClass}>
          {PAYMENT_MODES.map((m) => (
            <option key={m} value={m}>
              {m}
            </option>
          ))}
        </select>
      </Field>

      {isCredit && (
        <p className="rounded-lg border border-ocre/50 bg-ocre/10 px-4 py-2 text-sm text-ocre">
          Le total ({formatDA(total)} DA) sera ajouté à la dette du client.
        </p>
      )}

      {isCheque && (
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <Field label="N° de chèque" required>
            <input type="text" value={draft.cheque_number} onChange={(e) => update('cheque_number', e.target.value)} className={inputClass} required />
          </Field>
          <Field label="Banque" required>
            <input type="text" value={draft.cheque_bank} onChange={(e) => update('cheque_bank', e.target.value)} className={inputClass} required />
          </Field>
        </div>
      )}

      <Field label="Observations">
        <textarea
          value={draft.observations}
          onChange={(e) => update('observations', e.target.value)}
          className={`${inputClass} min-h-20 resize-y`}
          placeholder="optionnel"
        />
      </Field>

      {error && (
        <p className="rounded-lg border border-terracotta/50 bg-terracotta/10 px-4 py-3 text-sm text-terracotta">{error}</p>
      )}
      {success && <p className="rounded-lg border border-ocre/50 bg-ocre/10 px-4 py-3 text-sm text-ocre">{success}</p>}

      <button
        type="submit"
        disabled={loading}
        className="min-h-12 rounded-lg bg-terracotta px-4 py-3 font-display text-lg font-medium tracking-wide text-ink transition-colors hover:bg-terracotta-hover disabled:opacity-50"
      >
        {loading ? 'Enregistrement…' : 'Enregistrer la vente'}
      </button>
    </form>
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
  'min-h-11 w-full rounded-lg border border-border bg-bg-soft px-3 py-2 text-ink placeholder:text-ink-muted/60 outline-none focus:border-terracotta'
