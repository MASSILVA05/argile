import { useEffect, useMemo, useState } from 'react'
import { supabase } from '../lib/supabase'
import { getSession } from '../lib/auth'
import { notifyProdnetFabrication } from '../lib/ntfy'
import {
  formatDA,
  formatQty,
  toNum,
  ligneTotal,
  computeCoutTotal,
  computeCoutUnitaire,
  todayISO,
} from '../lib/prodnet'

const formatHHMM = (date) => date.toTimeString().slice(0, 5)

let lineSeq = 0
const newLine = () => ({
  key: `l${++lineSeq}`,
  search: '',
  matiere_id: null,
  designation: '',
  quantite_utilisee: '',
  prix_unitaire: 0,
  stock_dispo: null,
  unite: '',
})

const emptyDraft = {
  entry_date: todayISO(),
  product_id: '',
  product_search: '',
  quantite_produite: '1',
  observations: '',
}

function productLabel(p) {
  return p.reference ? `${p.designation} [${p.reference}]` : p.designation
}

export default function ProdnetFabricationForm() {
  const [draft, setDraft] = useState(emptyDraft)
  const [lines, setLines] = useState([newLine()])
  const [products, setProducts] = useState([])
  const [matieres, setMatieres] = useState([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [success, setSuccess] = useState('')
  const [clock, setClock] = useState(() => formatHHMM(new Date()))

  useEffect(() => {
    const id = setInterval(() => setClock(formatHHMM(new Date())), 30_000)
    return () => clearInterval(id)
  }, [])

  async function loadRefs() {
    const [{ data: prodRows }, { data: matRows }] = await Promise.all([
      supabase.from('prodnet_products').select('id, reference, designation, quantite, prix_moyen_ht, montant_ht').order('designation'),
      supabase.from('prodnet_matieres').select('id, designation, quantite, prix_moyen, unite').order('designation'),
    ])
    setProducts(prodRows ?? [])
    setMatieres(matRows ?? [])
  }

  useEffect(() => {
    loadRefs()
  }, [])

  const productByLabel = useMemo(() => {
    const map = new Map()
    for (const p of products) map.set(productLabel(p), p)
    return map
  }, [products])

  const matiereByDesignation = useMemo(() => {
    const map = new Map()
    for (const m of matieres) map.set(m.designation.toLowerCase(), m)
    return map
  }, [matieres])

  const selectedProduct = products.find((p) => p.id === draft.product_id) ?? null

  function update(field, value) {
    setDraft((d) => ({ ...d, [field]: value }))
  }

  function handleProductSearch(value) {
    const match = productByLabel.get(value)
    setDraft((d) => ({ ...d, product_search: value, product_id: match ? match.id : '' }))
  }

  function setLine(key, patch) {
    setLines((current) => current.map((l) => (l.key === key ? { ...l, ...patch } : l)))
  }

  function handleMatiereSearch(key, value) {
    const match = matiereByDesignation.get(value.trim().toLowerCase())
    if (match) {
      setLine(key, {
        search: value,
        matiere_id: match.id,
        designation: match.designation,
        prix_unitaire: toNum(match.prix_moyen),
        stock_dispo: toNum(match.quantite),
        unite: match.unite ?? '',
      })
    } else {
      setLine(key, { search: value, matiere_id: null, designation: value, prix_unitaire: 0, stock_dispo: null, unite: '' })
    }
  }

  function addLine() {
    setLines((current) => [...current, newLine()])
  }

  function removeLine(key) {
    setLines((current) => (current.length === 1 ? [newLine()] : current.filter((l) => l.key !== key)))
  }

  const validLines = lines.filter((l) => l.matiere_id && Number(l.quantite_utilisee) > 0)

  const matieresPayload = validLines.map((l) => ({
    matiere_id: l.matiere_id,
    designation: l.designation.trim(),
    quantite_utilisee: Number(l.quantite_utilisee),
    prix_unitaire: toNum(l.prix_unitaire),
    total: ligneTotal(l.quantite_utilisee, l.prix_unitaire),
  }))

  const coutTotal = computeCoutTotal(matieresPayload)
  const coutUnitaire = computeCoutUnitaire(coutTotal, draft.quantite_produite)

  const shortLines = validLines.filter((l) => l.stock_dispo != null && Number(l.quantite_utilisee) > l.stock_dispo)

  function validate() {
    if (!draft.entry_date) return 'La date est obligatoire.'
    if (!draft.product_id) return 'Sélectionnez un produit fini existant.'
    if (toNum(draft.quantite_produite) <= 0) return 'La quantité produite doit être supérieure à 0.'
    if (matieresPayload.length === 0) return 'Ajoutez au moins une matière première consommée.'
    const unknown = lines.find((l) => l.search.trim() && !l.matiere_id)
    if (unknown) return `Matière première inconnue : « ${unknown.search.trim()} ». Créez-la d'abord dans l'onglet Matières Premières.`
    if (shortLines.length > 0) {
      const l = shortLines[0]
      return `Stock insuffisant pour « ${l.designation} » (disponible : ${formatQty(l.stock_dispo)}).`
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

    const payload = {
      entry_date: draft.entry_date,
      entry_time: formatHHMM(new Date()),
      product_id: draft.product_id,
      product_reference: selectedProduct?.reference ?? null,
      product_designation: selectedProduct?.designation ?? null,
      quantite_produite: Number(draft.quantite_produite),
      matieres: matieresPayload,
      cout_total: coutTotal,
      cout_unitaire: coutUnitaire,
      observations: draft.observations.trim() || null,
      entered_by_user: getSession()?.username ?? null,
    }

    const { data, error: rpcError } = await supabase.rpc('prodnet_record_fabrication', { p: payload })
    setLoading(false)

    if (rpcError) {
      setError(`Erreur d'enregistrement : ${rpcError.message}`)
      return
    }

    notifyProdnetFabrication(data)
    setSuccess(
      `Fabrication enregistrée : ${payload.quantite_produite} × ${payload.product_designation} — coût total ${formatDA(coutTotal)} DA (${formatDA(coutUnitaire)} DA/u).`
    )
    setDraft({ ...emptyDraft, entry_date: draft.entry_date })
    setLines([newLine()])
    loadRefs()
  }

  return (
    <form onSubmit={handleSubmit} className="flex flex-col gap-4">
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
        <Field label="Date" required>
          <input type="date" value={draft.entry_date} onChange={(e) => update('entry_date', e.target.value)} className={inputClass} required />
        </Field>
        <Field label="Heure">
          <input type="text" value={clock} readOnly disabled className={`${inputClass} cursor-not-allowed opacity-60`} />
        </Field>
        <Field label="Quantité produite" required>
          <input type="number" inputMode="numeric" min="1" step="1" value={draft.quantite_produite} onChange={(e) => update('quantite_produite', e.target.value)} className={inputClass} required />
        </Field>
      </div>

      <Field label="Produit fini" required>
        <input
          type="text"
          list="prodnet-products-list"
          value={draft.product_search}
          onChange={(e) => handleProductSearch(e.target.value)}
          className={inputClass}
          autoComplete="off"
          placeholder="Rechercher un produit fini (référence ou désignation)"
          required
        />
        <datalist id="prodnet-products-list">
          {products.map((p) => <option key={p.id} value={productLabel(p)} />)}
        </datalist>
        {selectedProduct && (
          <p className="mt-1 text-xs text-ink-muted">
            Stock actuel : {formatQty(selectedProduct.quantite)} · prix moyen HT : {formatDA(selectedProduct.prix_moyen_ht)} DA
          </p>
        )}
      </Field>

      <div className="flex flex-col gap-2">
        <span className="text-sm text-ink-muted">Matières premières consommées</span>
        <datalist id="prodnet-matieres-list">
          {matieres.map((m) => <option key={m.id} value={m.designation} />)}
        </datalist>

        <div className="flex flex-col gap-2">
          {lines.map((line) => {
            const lineTot = ligneTotal(line.quantite_utilisee, line.prix_unitaire)
            const short = line.stock_dispo != null && Number(line.quantite_utilisee) > line.stock_dispo
            const unknown = line.search.trim() && !line.matiere_id
            return (
              <div key={line.key} className="rounded-lg border border-border bg-bg-soft p-3">
                <div className="grid grid-cols-1 gap-2 sm:grid-cols-12">
                  <div className="sm:col-span-6">
                    <input
                      type="text"
                      list="prodnet-matieres-list"
                      value={line.search}
                      onChange={(e) => handleMatiereSearch(line.key, e.target.value)}
                      className={`${inputClass} ${unknown ? 'border-terracotta' : ''}`}
                      autoComplete="off"
                      placeholder="Rechercher une matière première"
                    />
                    {line.matiere_id && (
                      <p className="mt-1 text-xs text-ink-muted">
                        Stock disponible : {formatQty(line.stock_dispo)} {line.unite} · prix moyen : {formatDA(line.prix_unitaire)} DA
                      </p>
                    )}
                    {unknown && <p className="mt-1 text-xs text-terracotta">Matière inconnue — créez-la dans l'onglet Matières Premières.</p>}
                  </div>
                  <div className="sm:col-span-3">
                    <input
                      type="number"
                      inputMode="decimal"
                      step="0.001"
                      min="0"
                      value={line.quantite_utilisee}
                      onChange={(e) => setLine(line.key, { quantite_utilisee: e.target.value })}
                      className={`${inputClass} ${short ? 'border-terracotta' : ''}`}
                      placeholder="Qté utilisée"
                    />
                  </div>
                  <div className="flex items-center justify-between gap-2 sm:col-span-3">
                    <span className="font-display text-ink">{formatDA(lineTot)} DA</span>
                    <div className="flex gap-1">
                      <button type="button" onClick={addLine} className="rounded border border-ocre px-2 py-1 text-ocre hover:bg-ocre/10" title="Ajouter une ligne">+</button>
                      <button type="button" onClick={() => removeLine(line.key)} className="rounded border border-terracotta/50 px-2 py-1 text-terracotta hover:bg-terracotta/10" title="Supprimer la ligne">−</button>
                    </div>
                  </div>
                </div>
                {short && (
                  <p className="mt-2 text-xs text-terracotta">
                    ⚠ Stock insuffisant (disponible : {formatQty(line.stock_dispo)}). L'enregistrement est bloqué.
                  </p>
                )}
              </div>
            )
          })}
        </div>
      </div>

      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <div className="rounded-lg border border-ocre/50 bg-ocre/10 px-4 py-3">
          <p className="text-xs text-ink-muted">Coût total de fabrication</p>
          <p className="font-display text-xl text-ocre">{formatDA(coutTotal)} DA</p>
        </div>
        <div className="rounded-lg border border-ocre/50 bg-ocre/10 px-4 py-3">
          <p className="text-xs text-ink-muted">Coût unitaire (÷ {formatQty(draft.quantite_produite || 0)})</p>
          <p className="font-display text-xl text-ocre">{formatDA(coutUnitaire)} DA</p>
        </div>
      </div>

      <Field label="Observations">
        <textarea value={draft.observations} onChange={(e) => update('observations', e.target.value)} className={`${inputClass} min-h-20 resize-y`} placeholder="optionnel" />
      </Field>

      {error && <p className="rounded-lg border border-terracotta/50 bg-terracotta/10 px-4 py-3 text-sm text-terracotta">{error}</p>}
      {success && <p className="rounded-lg border border-ocre/50 bg-ocre/10 px-4 py-3 text-sm text-ocre">{success}</p>}

      <button
        type="submit"
        disabled={loading}
        className="min-h-12 rounded-lg bg-terracotta px-4 py-3 font-display text-lg font-medium tracking-wide text-ink transition-colors hover:bg-terracotta-hover disabled:opacity-50"
      >
        {loading ? 'Enregistrement…' : 'Enregistrer la fabrication'}
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
