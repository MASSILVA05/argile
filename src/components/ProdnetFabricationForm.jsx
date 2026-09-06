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
  const [products, setProducts] = useState([])
  const [matieres, setMatieres] = useState([])
  // { [matiere_id]: quantiteUtiliséeString }
  const [selected, setSelected] = useState({})
  const [search, setSearch] = useState('')
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

  const selectedProduct = products.find((p) => p.id === draft.product_id) ?? null

  function update(field, value) {
    setDraft((d) => ({ ...d, [field]: value }))
  }

  function handleProductSearch(value) {
    const match = productByLabel.get(value)
    setDraft((d) => ({ ...d, product_search: value, product_id: match ? match.id : '' }))
  }

  function toggleMatiere(id, checked) {
    setSelected((cur) => {
      const next = { ...cur }
      if (checked) next[id] = next[id] ?? ''
      else delete next[id]
      return next
    })
  }

  function setQuantite(id, value) {
    setSelected((cur) => ({ ...cur, [id]: value }))
  }

  const filteredMatieres = useMemo(() => {
    const q = search.trim().toLowerCase()
    if (!q) return matieres
    return matieres.filter((m) => m.designation.toLowerCase().includes(q))
  }, [matieres, search])

  // Lignes de fabrication (matières cochées, dans l'ordre du catalogue).
  const selectedRows = useMemo(() => {
    return matieres
      .filter((m) => selected[m.id] !== undefined)
      .map((m) => {
        const qte = selected[m.id]
        const stock = toNum(m.quantite)
        const prix = toNum(m.prix_moyen)
        const qteNum = toNum(qte)
        return {
          id: m.id,
          designation: m.designation,
          unite: m.unite ?? '',
          stock,
          prix,
          qte,
          qteNum,
          total: ligneTotal(qte, prix),
          insufficient: qteNum > stock,
          ok: qteNum > 0 && qteNum <= stock,
        }
      })
  }, [matieres, selected])

  const matieresPayload = selectedRows
    .filter((r) => r.qteNum > 0)
    .map((r) => ({
      matiere_id: r.id,
      designation: r.designation,
      quantite_utilisee: r.qteNum,
      prix_unitaire: r.prix,
      total: r.total,
    }))

  const coutTotal = computeCoutTotal(matieresPayload)
  const coutUnitaire = computeCoutUnitaire(coutTotal, draft.quantite_produite)
  const hasInsufficient = selectedRows.some((r) => r.insufficient)

  function validate() {
    if (!draft.entry_date) return 'La date est obligatoire.'
    if (!draft.product_id) return 'Sélectionnez un produit fini existant.'
    if (toNum(draft.quantite_produite) <= 0) return 'La quantité produite doit être supérieure à 0.'
    if (selectedRows.length === 0) return 'Cochez au moins une matière première consommée.'
    if (matieresPayload.length === 0) return 'Renseignez une quantité à utiliser pour au moins une matière.'
    if (hasInsufficient) {
      const r = selectedRows.find((x) => x.insufficient)
      return `Stock insuffisant pour « ${r.designation} » (disponible : ${formatQty(r.stock)}).`
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
    setSelected({})
    setSearch('')
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

      {/* Sélection des matières : recherche + liste à cocher */}
      <div className="flex flex-col gap-2">
        <span className="text-sm text-ink-muted">Matières premières à consommer</span>
        <input
          type="text"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className={inputClass}
          placeholder="Rechercher une matière…"
        />
        <div className="max-h-64 overflow-y-auto rounded-lg border border-border bg-bg-soft">
          {filteredMatieres.length === 0 ? (
            <p className="px-3 py-3 text-sm text-ink-muted">Aucune matière première ne correspond.</p>
          ) : (
            filteredMatieres.map((m) => {
              const checked = selected[m.id] !== undefined
              return (
                <label
                  key={m.id}
                  className={`flex cursor-pointer items-center gap-3 border-b border-border px-3 py-2 last:border-0 hover:bg-bg ${
                    checked ? 'bg-terracotta/10' : ''
                  }`}
                >
                  <input
                    type="checkbox"
                    checked={checked}
                    onChange={(e) => toggleMatiere(m.id, e.target.checked)}
                    className="h-4 w-4 shrink-0 accent-terracotta"
                  />
                  <span className="min-w-0 flex-1 truncate text-sm text-ink" title={m.designation}>
                    {m.designation}
                  </span>
                  <span className="shrink-0 text-xs text-ink-muted">
                    stock {formatQty(m.quantite)} {m.unite || ''} · {formatDA(m.prix_moyen)} DA
                  </span>
                </label>
              )
            })
          )}
        </div>
      </div>

      {/* Tableau de fabrication : matières cochées (visible même en recherche) */}
      {selectedRows.length > 0 && (
        <div className="overflow-x-auto rounded-lg border border-border">
          <table className="w-full min-w-[720px] border-collapse text-[11px] sm:text-sm">
            <thead>
              <tr className="border-b border-border bg-bg-soft text-left text-ink-muted">
                <Th>Matière</Th>
                <Th>Stock dispo</Th>
                <Th>Quantité à utiliser</Th>
                <Th>Prix unitaire</Th>
                <Th>Total ligne</Th>
                <Th />
              </tr>
            </thead>
            <tbody>
              {selectedRows.map((r) => (
                <tr key={r.id} className="border-b border-border last:border-0">
                  <Td className="max-w-[220px] truncate" title={r.designation}>{r.designation}</Td>
                  <Td>{formatQty(r.stock)} {r.unite}</Td>
                  <Td>
                    <input
                      type="number"
                      inputMode="decimal"
                      step="0.001"
                      min="0"
                      value={r.qte}
                      onChange={(e) => setQuantite(r.id, e.target.value)}
                      className={`w-28 rounded border bg-bg px-2 py-1 text-ink outline-none focus:border-terracotta ${
                        r.insufficient ? 'border-terracotta bg-terracotta/10 text-terracotta' : 'border-border'
                      }`}
                    />
                    {r.insufficient ? (
                      <p className="mt-1 text-xs font-medium text-terracotta">
                        Stock insuffisant ! Dispo : {formatQty(r.stock)}
                      </p>
                    ) : r.ok ? (
                      <p className="mt-1 text-xs font-medium text-green-500">Stock OK (dispo : {formatQty(r.stock)})</p>
                    ) : null}
                  </Td>
                  <Td className="text-right">{formatDA(r.prix)}</Td>
                  <Td className="text-right font-medium">{formatDA(r.total)}</Td>
                  <Td>
                    <button
                      type="button"
                      onClick={() => toggleMatiere(r.id, false)}
                      className="rounded border border-terracotta/50 px-2 py-1 text-terracotta hover:bg-terracotta/10"
                      title="Retirer cette matière"
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
          <p className="text-xs text-ink-muted">Matières sélectionnées</p>
          <p className="font-display text-xl text-ink">{selectedRows.length}</p>
        </div>
        <div className="rounded-lg border border-ocre/50 bg-ocre/10 px-4 py-3">
          <p className="text-xs text-ink-muted">Coût total de fabrication</p>
          <p className="font-display text-xl text-ocre">{formatDA(coutTotal)} DA</p>
        </div>
        <div className="rounded-lg border border-ocre/50 bg-ocre/10 px-4 py-3">
          <p className="text-xs text-ink-muted">Coût unitaire (÷ {formatQty(draft.quantite_produite || 0)})</p>
          <p className="font-display text-xl text-ocre">{formatDA(coutUnitaire)} DA</p>
        </div>
      </div>

      {hasInsufficient && (
        <p className="rounded-lg border border-terracotta/50 bg-terracotta/10 px-4 py-3 text-sm font-medium text-terracotta">
          ⚠ Au moins une matière est en stock insuffisant — corrigez les quantités pour pouvoir enregistrer.
        </p>
      )}

      <Field label="Observations">
        <textarea value={draft.observations} onChange={(e) => update('observations', e.target.value)} className={`${inputClass} min-h-20 resize-y`} placeholder="optionnel" />
      </Field>

      {error && <p className="rounded-lg border border-terracotta/50 bg-terracotta/10 px-4 py-3 text-sm text-terracotta">{error}</p>}
      {success && <p className="rounded-lg border border-ocre/50 bg-ocre/10 px-4 py-3 text-sm text-ocre">{success}</p>}

      <button
        type="submit"
        disabled={loading || hasInsufficient}
        className="min-h-12 rounded-lg bg-terracotta px-4 py-3 font-display text-lg font-medium tracking-wide text-ink transition-colors hover:bg-terracotta-hover disabled:opacity-50"
      >
        {loading ? 'Enregistrement…' : hasInsufficient ? 'Stock insuffisant' : 'Enregistrer la fabrication'}
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
