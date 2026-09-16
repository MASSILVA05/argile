import { useEffect, useMemo, useState } from 'react'
import { supabase } from '../lib/supabase'
import { getSession } from '../lib/auth'
import { notifyPpiImport } from '../lib/ntfy'
import { formatEUR, formatQty, productQtyRestante, todayISO } from '../lib/ppi'

const formatHHMM = (date) => date.toTimeString().slice(0, 5)

const emptyDraft = {
  entry_date: todayISO(),
  country_id: '',
  product_id: '',
  product_search: '',
  quantite: '',
  numero_facture: '',
  fournisseur: '',
  observations: '',
}

function productLabel(p) {
  return `${p.designation} [${p.position_tarifaire}]`
}

export default function PPIForm() {
  const [draft, setDraft] = useState(emptyDraft)
  const [countries, setCountries] = useState([])
  const [products, setProducts] = useState([])
  const [fournisseurs, setFournisseurs] = useState([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [success, setSuccess] = useState('')
  const [clock, setClock] = useState(() => formatHHMM(new Date()))

  useEffect(() => {
    const id = setInterval(() => setClock(formatHHMM(new Date())), 30_000)
    return () => clearInterval(id)
  }, [])

  async function loadRefs() {
    const [{ data: countryRows }, { data: productRows }, { data: importRows }] = await Promise.all([
      supabase.from('ppi_countries').select('*').order('name_fr'),
      supabase.from('ppi_products').select('*').order('designation'),
      supabase.from('ppi_imports').select('fournisseur').not('fournisseur', 'is', null),
    ])
    setCountries(countryRows ?? [])
    setProducts(productRows ?? [])
    setFournisseurs([...new Set((importRows ?? []).map((r) => r.fournisseur).filter(Boolean))].sort())
  }

  useEffect(() => {
    loadRefs()
  }, [])

  const selectedCountry = countries.find((c) => c.id === draft.country_id) ?? null
  const countryProducts = useMemo(
    () => products.filter((p) => p.country_id === draft.country_id),
    [products, draft.country_id]
  )
  const productByLabel = useMemo(() => {
    const map = new Map()
    for (const p of countryProducts) map.set(productLabel(p), p)
    return map
  }, [countryProducts])
  const selectedProduct = products.find((p) => p.id === draft.product_id) ?? null

  function update(field, value) {
    setDraft((d) => ({ ...d, [field]: value }))
  }

  function handleCountryChange(countryId) {
    setDraft((d) => ({ ...d, country_id: countryId, product_id: '', product_search: '' }))
  }

  function handleProductSearch(value) {
    const match = productByLabel.get(value)
    setDraft((d) => ({ ...d, product_search: value, product_id: match ? match.id : '' }))
  }

  const qte = Number(draft.quantite) || 0
  const pu = Number(selectedProduct?.prix_unitaire) || 0
  const montant = qte * pu
  const budgetRestant = Number(selectedCountry?.budget_restant) || 0
  const budgetDepasse = selectedCountry != null && qte > 0 && montant > budgetRestant
  const qtyRestante = selectedProduct ? productQtyRestante(selectedProduct) : null
  const quotaDepasse = selectedProduct != null && qte > 0 && qte > qtyRestante

  function validate() {
    if (!draft.entry_date) return "La date est obligatoire."
    if (!draft.country_id) return 'Sélectionnez un pays.'
    if (!draft.product_id) return 'Sélectionnez un produit.'
    if (!(qte > 0)) return "La quantité à importer doit être supérieure à 0."
    if (budgetDepasse) return `Budget dépassé ! Restant : ${formatEUR(budgetRestant)} €.`
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
      country_id: draft.country_id,
      product_id: draft.product_id,
      quantite: Math.trunc(qte),
      prix_unitaire: pu,
      numero_facture: draft.numero_facture.trim() || null,
      fournisseur: draft.fournisseur.trim() || null,
      observations: draft.observations.trim() || null,
      entered_by_user: getSession()?.username ?? null,
    }

    const { data, error: rpcError } = await supabase.rpc('ppi_record_import', { p: payload })
    setLoading(false)

    if (rpcError) {
      setError(`Erreur d'enregistrement : ${rpcError.message}`)
      return
    }

    notifyPpiImport(data)
    setSuccess(
      `Importation enregistrée : ${payload.quantite} × ${data.product_designation} (${data.country_name_fr}) — ${formatEUR(data.montant)} €.`
    )
    setDraft({ ...emptyDraft, entry_date: draft.entry_date, country_id: draft.country_id })
    loadRefs()
  }

  return (
    <form onSubmit={handleSubmit} className="flex flex-col gap-4">
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <Field label="Date" required>
          <input type="date" value={draft.entry_date} onChange={(e) => update('entry_date', e.target.value)} className={inputClass} required />
        </Field>
        <Field label="Heure">
          <input type="text" value={clock} readOnly disabled className={`${inputClass} cursor-not-allowed opacity-60`} />
        </Field>
      </div>

      <Field label="Pays" required>
        <select value={draft.country_id} onChange={(e) => handleCountryChange(e.target.value)} className={inputClass} required>
          <option value="">— choisir un pays —</option>
          {countries.map((c) => (
            <option key={c.id} value={c.id}>
              {c.name_fr} ({c.name_ar}) — restant {formatEUR(c.budget_restant)} €
            </option>
          ))}
        </select>
        {selectedCountry && (
          <p className="mt-1 text-xs text-ink-muted">
            Budget autorisé : {formatEUR(selectedCountry.budget_autorise)} € · Consommé : {formatEUR(selectedCountry.budget_consomme)} € ·{' '}
            <span className={budgetRestant <= 0 ? 'font-medium text-terracotta' : 'font-medium text-ocre'}>
              Restant : {formatEUR(selectedCountry.budget_restant)} €
            </span>
          </p>
        )}
      </Field>

      <Field label="Produit" required>
        <input
          type="text"
          list="ppi-products-list"
          value={draft.product_search}
          onChange={(e) => handleProductSearch(e.target.value)}
          className={inputClass}
          autoComplete="off"
          placeholder={draft.country_id ? 'Rechercher un produit (désignation ou position tarifaire)' : 'Choisissez un pays d’abord'}
          disabled={!draft.country_id}
          required
        />
        <datalist id="ppi-products-list">
          {countryProducts.map((p) => (
            <option key={p.id} value={productLabel(p)} />
          ))}
        </datalist>
        {draft.country_id && countryProducts.length === 0 && (
          <p className="mt-1 text-xs text-ink-muted">Aucun produit importé pour ce pays — voir le sous-onglet Import.</p>
        )}
        {selectedProduct && (
          <p className="mt-1 text-xs text-ink-muted">
            Position tarifaire : {selectedProduct.position_tarifaire} · Prix unitaire : {formatEUR(selectedProduct.prix_unitaire)} € ·{' '}
            Quantité autorisée : {formatQty(selectedProduct.quantite_autorisee)} · Déjà importé : {formatQty(selectedProduct.stock_actuel)} ·{' '}
            Reste : {formatQty(qtyRestante)}
          </p>
        )}
      </Field>

      <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
        <Field label="Quantité à importer" required>
          <input
            type="number"
            inputMode="numeric"
            min="1"
            step="1"
            value={draft.quantite}
            onChange={(e) => update('quantite', e.target.value)}
            className={`${inputClass} ${budgetDepasse ? 'border-terracotta bg-terracotta/10 text-terracotta' : quotaDepasse ? 'border-ocre bg-ocre/10' : ''}`}
            required
          />
        </Field>
        <Field label="Prix unitaire (€)">
          <input type="text" value={selectedProduct ? `${formatEUR(pu)} €` : '—'} readOnly disabled className={`${inputClass} cursor-not-allowed opacity-60`} />
        </Field>
        <Field label="Montant (€)">
          <input
            type="text"
            value={`${formatEUR(montant)} €`}
            readOnly
            disabled
            className={`${inputClass} cursor-not-allowed font-display opacity-100 ${budgetDepasse ? 'text-terracotta' : 'text-ocre'}`}
          />
        </Field>
      </div>

      {budgetDepasse && (
        <p className="rounded-lg border border-terracotta/50 bg-terracotta/10 px-4 py-3 text-sm font-medium text-terracotta">
          Budget dépassé ! Restant : {formatEUR(budgetRestant)} €.
        </p>
      )}
      {!budgetDepasse && quotaDepasse && (
        <p className="rounded-lg border border-ocre/50 bg-ocre/10 px-4 py-3 text-sm font-medium text-ocre">
          ⚠ Quantité dépasse le quota autorisé (reste {formatQty(qtyRestante)}).
        </p>
      )}

      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <Field label="N° Facture fournisseur">
          <input type="text" value={draft.numero_facture} onChange={(e) => update('numero_facture', e.target.value)} className={inputClass} placeholder="optionnel" />
        </Field>
        <Field label="Fournisseur">
          <input
            type="text"
            list="ppi-fournisseurs-list"
            value={draft.fournisseur}
            onChange={(e) => update('fournisseur', e.target.value)}
            className={inputClass}
            autoComplete="off"
            placeholder="optionnel"
          />
          <datalist id="ppi-fournisseurs-list">
            {fournisseurs.map((f) => <option key={f} value={f} />)}
          </datalist>
        </Field>
      </div>

      <Field label="Observations">
        <textarea value={draft.observations} onChange={(e) => update('observations', e.target.value)} className={`${inputClass} min-h-20 resize-y`} placeholder="optionnel" />
      </Field>

      {error && <p className="rounded-lg border border-terracotta/50 bg-terracotta/10 px-4 py-3 text-sm text-terracotta">{error}</p>}
      {success && <p className="rounded-lg border border-ocre/50 bg-ocre/10 px-4 py-3 text-sm text-ocre">{success}</p>}

      <button
        type="submit"
        disabled={loading || budgetDepasse}
        className="min-h-12 rounded-lg bg-terracotta px-4 py-3 font-display text-lg font-medium tracking-wide text-ink transition-colors hover:bg-terracotta-hover disabled:opacity-50"
      >
        {loading ? 'Enregistrement…' : budgetDepasse ? 'Budget dépassé' : "Enregistrer l'importation"}
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
