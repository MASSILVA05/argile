import { useEffect, useMemo, useState } from 'react'
import { supabase } from '../lib/supabase'
import { getSession } from '../lib/auth'
import { notifyPpiBatchImport } from '../lib/ntfy'
import { formatEUR, formatQty, productQtyRestante, todayISO } from '../lib/ppi'
import PPIProductsPicker from './PPIProductsPicker'

const formatHHMM = (date) => date.toTimeString().slice(0, 5)

const emptyDraft = {
  entry_date: todayISO(),
  country_id: '',
  numero_facture: '',
  fournisseur: '',
  observations: '',
}

export default function PPIForm() {
  const [draft, setDraft] = useState(emptyDraft)
  const [countries, setCountries] = useState([])
  const [products, setProducts] = useState([])
  const [fournisseurs, setFournisseurs] = useState([])
  // { [product_id]: { quantite, prix_unitaire } }
  const [selected, setSelected] = useState({})
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

  function update(field, value) {
    setDraft((d) => ({ ...d, [field]: value }))
  }

  function handleCountryChange(countryId) {
    setDraft((d) => ({ ...d, country_id: countryId }))
    setSelected({})
  }

  function toggleProduct(id, checked) {
    setSelected((cur) => {
      const next = { ...cur }
      if (checked) {
        const product = products.find((p) => p.id === id)
        next[id] = { quantite: '', prix_unitaire: String(product?.prix_unitaire ?? '') }
      } else {
        delete next[id]
      }
      return next
    })
  }

  function setRowField(id, field, value) {
    setSelected((cur) => ({ ...cur, [id]: { ...cur[id], [field]: value } }))
  }

  // Lignes du tableau (produits cochés, dans l'ordre du catalogue du pays).
  const selectedRows = useMemo(() => {
    return countryProducts
      .filter((p) => selected[p.id] !== undefined)
      .map((p) => {
        const row = selected[p.id]
        const qte = Number(row.quantite) || 0
        const pu = Number(row.prix_unitaire) || 0
        const qtyRestante = productQtyRestante(p)
        return {
          id: p.id,
          designation: p.designation,
          position_tarifaire: p.position_tarifaire,
          quantite_autorisee: p.quantite_autorisee,
          stock_actuel: p.stock_actuel,
          qtyRestante,
          quantite: row.quantite,
          qte,
          prix_unitaire: row.prix_unitaire,
          pu,
          sousTotal: qte * pu,
          quotaDepasse: qte > 0 && qte > qtyRestante,
        }
      })
  }, [countryProducts, selected])

  const totalImportation = selectedRows.reduce((s, r) => s + r.sousTotal, 0)
  const budgetRestant = Number(selectedCountry?.budget_restant) || 0
  const budgetRestantApres = budgetRestant - totalImportation
  const budgetDepasse = selectedCountry != null && totalImportation > budgetRestant
  const hasQuotaDepasse = selectedRows.some((r) => r.quotaDepasse)
  const hasMissingQty = selectedRows.some((r) => !(r.qte > 0))

  function validate() {
    if (!draft.entry_date) return "La date est obligatoire."
    if (!draft.country_id) return 'Sélectionnez un pays.'
    if (selectedRows.length === 0) return 'Cochez au moins un produit.'
    if (hasMissingQty) return "Renseignez une quantité à importer pour chaque produit sélectionné."
    if (budgetDepasse) return `Budget dépassé ! Restant : ${formatEUR(budgetRestant)} €, total demandé : ${formatEUR(totalImportation)} €.`
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
      numero_facture: draft.numero_facture.trim() || null,
      fournisseur: draft.fournisseur.trim() || null,
      observations: draft.observations.trim() || null,
      entered_by_user: getSession()?.username ?? null,
      produits: selectedRows.map((r) => ({
        product_id: r.id,
        quantite: Math.trunc(r.qte),
        prix_unitaire: r.pu,
      })),
    }

    const { data, error: rpcError } = await supabase.rpc('ppi_record_batch_import', { p: payload })
    setLoading(false)

    if (rpcError) {
      setError(`Erreur d'enregistrement : ${rpcError.message}`)
      return
    }

    const rows = data ?? []
    notifyPpiBatchImport(rows)
    setSuccess(
      `Importation enregistrée : ${rows.length} produit(s) (${selectedCountry?.name_fr}) — total ${formatEUR(totalImportation)} €.`
    )
    setDraft({ ...emptyDraft, entry_date: draft.entry_date, country_id: draft.country_id })
    setSelected({})
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

      {/* Sélection des produits : liste complète à cocher (recherche = filtre) */}
      <div className="flex flex-col gap-2">
        <span className="text-sm text-ink-muted">Produits à importer</span>
        {!draft.country_id ? (
          <p className="rounded-lg border border-border bg-bg-soft px-4 py-3 text-sm text-ink-muted">Choisissez un pays d'abord.</p>
        ) : countryProducts.length === 0 ? (
          <p className="rounded-lg border border-border bg-bg-soft px-4 py-3 text-sm text-ink-muted">
            Aucun produit importé pour ce pays — voir le sous-onglet Import.
          </p>
        ) : (
          <PPIProductsPicker catalogue={countryProducts} isSelected={(id) => selected[id] !== undefined} onToggle={toggleProduct} />
        )}
      </div>

      {/* Tableau des produits cochés (visible même en recherche) */}
      {selectedRows.length > 0 && (
        <div className="overflow-x-auto rounded-lg border border-border">
          <table className="w-full min-w-[920px] border-collapse text-[11px] sm:text-sm">
            <thead>
              <tr className="border-b border-border bg-bg-soft text-left text-ink-muted">
                <Th>Désignation</Th>
                <Th>Position tarifaire</Th>
                <Th>Prix unitaire (€)</Th>
                <Th>Qté autorisée</Th>
                <Th>Stock actuel</Th>
                <Th>Quantité à importer</Th>
                <Th>Sous-total (€)</Th>
                <Th />
              </tr>
            </thead>
            <tbody>
              {selectedRows.map((r) => (
                <tr key={r.id} className="border-b border-border last:border-0">
                  <Td className="max-w-[220px] truncate" title={r.designation}>{r.designation}</Td>
                  <Td>{r.position_tarifaire}</Td>
                  <Td>
                    <input
                      type="number"
                      inputMode="decimal"
                      step="0.01"
                      min="0"
                      value={r.prix_unitaire}
                      onChange={(e) => setRowField(r.id, 'prix_unitaire', e.target.value)}
                      className="w-24 rounded border border-border bg-bg px-2 py-1 text-ink outline-none focus:border-terracotta"
                    />
                  </Td>
                  <Td>{formatQty(r.quantite_autorisee)}</Td>
                  <Td>{formatQty(r.stock_actuel)}</Td>
                  <Td>
                    <input
                      type="number"
                      inputMode="numeric"
                      min="1"
                      step="1"
                      value={r.quantite}
                      onChange={(e) => setRowField(r.id, 'quantite', e.target.value)}
                      className={`w-24 rounded border bg-bg px-2 py-1 text-ink outline-none focus:border-terracotta ${
                        r.quotaDepasse ? 'border-ocre bg-ocre/10' : 'border-border'
                      }`}
                    />
                    {r.quotaDepasse && (
                      <p className="mt-1 text-xs font-medium text-ocre">⚠ dépasse le quota (reste {formatQty(r.qtyRestante)})</p>
                    )}
                  </Td>
                  <Td className="text-right font-medium">{formatEUR(r.sousTotal)}</Td>
                  <Td>
                    <button
                      type="button"
                      onClick={() => toggleProduct(r.id, false)}
                      className="rounded border border-terracotta/50 px-2 py-1 text-terracotta hover:bg-terracotta/10"
                      title="Retirer ce produit"
                    >
                      Retirer
                    </button>
                  </Td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* Résumé */}
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
        <div className="rounded-lg border border-border bg-bg-soft px-4 py-3">
          <p className="text-xs text-ink-muted">Produits sélectionnés</p>
          <p className="font-display text-xl text-ink">{selectedRows.length}</p>
        </div>
        <div className="rounded-lg border border-ocre/50 bg-ocre/10 px-4 py-3">
          <p className="text-xs text-ink-muted">Total de l'importation</p>
          <p className="font-display text-xl text-ocre">{formatEUR(totalImportation)} €</p>
        </div>
        <div className={`rounded-lg border px-4 py-3 ${budgetDepasse ? 'border-terracotta/50 bg-terracotta/10' : 'border-ocre/50 bg-ocre/10'}`}>
          <p className="text-xs text-ink-muted">Budget restant après importation</p>
          <p className={`font-display text-xl ${budgetDepasse ? 'text-terracotta' : 'text-ocre'}`}>{formatEUR(budgetRestantApres)} €</p>
        </div>
      </div>

      {budgetDepasse && (
        <p className="rounded-lg border border-terracotta/50 bg-terracotta/10 px-4 py-3 text-sm font-medium text-terracotta">
          BUDGET DÉPASSÉ ! Restant : {formatEUR(budgetRestant)} €, total demandé : {formatEUR(totalImportation)} €.
        </p>
      )}
      {!budgetDepasse && hasQuotaDepasse && (
        <p className="rounded-lg border border-ocre/50 bg-ocre/10 px-4 py-3 text-sm font-medium text-ocre">
          ⚠ Au moins une quantité dépasse le quota autorisé du produit.
        </p>
      )}

      <Field label="Observations">
        <textarea value={draft.observations} onChange={(e) => update('observations', e.target.value)} className={`${inputClass} min-h-20 resize-y`} placeholder="optionnel" />
      </Field>

      {error && <p className="rounded-lg border border-terracotta/50 bg-terracotta/10 px-4 py-3 text-sm text-terracotta">{error}</p>}
      {success && <p className="rounded-lg border border-ocre/50 bg-ocre/10 px-4 py-3 text-sm text-ocre">{success}</p>}

      <button
        type="submit"
        disabled={loading || budgetDepasse || selectedRows.length === 0}
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

function Th({ children }) {
  return <th className="px-1 py-1 font-display font-medium whitespace-nowrap sm:px-3 sm:py-2">{children}</th>
}

function Td({ children, className = '', title }) {
  return (
    <td className={`px-1 py-1 align-top whitespace-nowrap sm:px-3 sm:py-2 ${className}`} title={title}>
      {children}
    </td>
  )
}

const inputClass =
  'min-h-11 w-full rounded-lg border border-border bg-bg-soft px-3 py-2 text-ink placeholder:text-ink-muted/60 outline-none focus:border-terracotta'
