import { useEffect, useMemo, useState } from 'react'
import { supabase } from '../lib/supabase'
import { getSession } from '../lib/auth'
import { notifyMagasinAchat } from '../lib/ntfy'
import { uploadMagasinPhoto } from '../lib/storage'
import { compressImage } from '../lib/imageCompress'
import {
  ACHAT_PAYMENT_MODES,
  ACHAT_DESTINATIONS,
  formatDA,
  computeAchatTotal,
  itemLineTotal,
} from '../lib/magasin'

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
  prix_achat: '',
})

const emptyDraft = {
  bon_number: '',
  entry_date: todayISO(),
  fournisseur: '',
  destination: 'Stock',
  client_revente: '',
  prix_revente: '',
  payment_mode: 'Espèces',
  cheque_number: '',
  cheque_bank: '',
  observations: '',
  photo_file: null,
}

function stockLabel(item) {
  return item.reference ? `${item.designation} [${item.reference}]` : item.designation
}

export default function MagasinAchatForm() {
  const [draft, setDraft] = useState(emptyDraft)
  const [lines, setLines] = useState([newLine()])
  const [stock, setStock] = useState([])
  const [fournisseurs, setFournisseurs] = useState([])
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
      const [{ data: bonRow }, { data: stockRows }, { data: achatRows }] = await Promise.all([
        supabase.from('magasin_achats').select('bon_number').order('bon_number', { ascending: false }).limit(1),
        supabase.from('magasin_stock').select('id, reference, designation, prix_achat, quantite'),
        supabase.from('magasin_achats').select('fournisseur').order('created_at', { ascending: false }).limit(500),
      ])
      setDraft((d) => ({ ...d, bon_number: bonRow?.[0]?.bon_number ? bonRow[0].bon_number + 1 : 1 }))
      setStock(stockRows ?? [])
      setFournisseurs([...new Set((achatRows ?? []).map((r) => r.fournisseur).filter(Boolean))])
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
        prix_achat: match.prix_achat ? String(match.prix_achat) : '',
      })
    } else {
      setLine(key, { search: value, stock_id: null, designation: value, reference: '' })
    }
  }

  function addLine() {
    setLines((current) => [...current, newLine()])
  }

  function removeLine(key) {
    setLines((current) => (current.length === 1 ? [newLine()] : current.filter((l) => l.key !== key)))
  }

  const validLines = lines.filter(
    (l) => l.designation.trim() && Number(l.quantite) > 0 && l.prix_achat !== '' && Number(l.prix_achat) >= 0
  )

  const items = validLines.map((l) => ({
    stock_id: l.stock_id,
    reference: l.reference.trim() || null,
    designation: l.designation.trim(),
    quantite: Number(l.quantite),
    prix_achat: Number(l.prix_achat),
    total: itemLineTotal(l.quantite, l.prix_achat),
  }))

  const total = computeAchatTotal(items)
  const isRevente = draft.destination === 'Revente directe'
  const marge = isRevente && draft.prix_revente !== '' ? Number(draft.prix_revente) - total : null
  const isCheque = draft.payment_mode === 'Chèque'

  function validate() {
    if (!draft.bon_number) return 'Le n° de bon est obligatoire.'
    if (!draft.entry_date) return 'La date est obligatoire.'
    if (!draft.fournisseur.trim()) return 'Le fournisseur est obligatoire.'
    if (items.length === 0) return 'Ajoutez au moins un article (désignation, quantité et prix d\'achat).'
    if (isRevente) {
      if (!draft.client_revente.trim()) return 'Le client de la revente directe est obligatoire.'
      if (draft.prix_revente === '' || Number(draft.prix_revente) < 0) return 'Le prix de revente est obligatoire.'
    }
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
      .from('magasin_achats')
      .select('id')
      .eq('bon_number', bonNumber)
      .maybeSingle()
    if (existing) {
      setLoading(false)
      setError('Ce n° de bon existe déjà.')
      return
    }

    let photoUrl = null
    if (draft.photo_file) {
      try {
        const compressed = await compressImage(draft.photo_file)
        photoUrl = await uploadMagasinPhoto(compressed, `achat-${bonNumber}`)
      } catch (err) {
        setLoading(false)
        setError(`Erreur d'upload de la photo : ${err.message}`)
        return
      }
    }

    const payload = {
      bon_number: bonNumber,
      entry_date: draft.entry_date,
      entry_time: formatHHMM(new Date()),
      fournisseur: draft.fournisseur.trim(),
      items,
      total,
      payment_mode: draft.payment_mode,
      cheque_number: isCheque ? draft.cheque_number.trim() : null,
      cheque_bank: isCheque ? draft.cheque_bank.trim() : null,
      destination: draft.destination,
      client_revente: isRevente ? draft.client_revente.trim() : null,
      prix_revente: isRevente ? Number(draft.prix_revente) : null,
      marge: isRevente ? marge : null,
      photo_url: photoUrl,
      observations: draft.observations.trim() || null,
      entered_by_user: getSession()?.username ?? null,
    }

    const { data, error: rpcError } = await supabase.rpc('magasin_record_achat', { p: payload })
    setLoading(false)

    if (rpcError) {
      setError(
        rpcError.code === '23505' ? 'Ce n° de bon existe déjà.' : `Erreur d'enregistrement : ${rpcError.message}`
      )
      return
    }

    notifyMagasinAchat(data)
    setSuccess(
      `Bon d'achat n° ${bonNumber} enregistré${
        draft.destination === 'Stock' ? ' (marchandise ajoutée au stock)' : ' (revente directe)'
      }.`
    )
    setDraft({ ...emptyDraft, bon_number: bonNumber + 1, entry_date: draft.entry_date })
    setLines([newLine()])
    const [{ data: stockRows }] = await Promise.all([
      supabase.from('magasin_stock').select('id, reference, designation, prix_achat, quantite'),
    ])
    setStock(stockRows ?? [])
    if (payload.fournisseur) setFournisseurs((p) => [...new Set([payload.fournisseur, ...p])])
  }

  return (
    <form onSubmit={handleSubmit} className="flex flex-col gap-4">
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
        <Field label="N° de bon" required>
          <input type="number" inputMode="numeric" value={draft.bon_number} onChange={(e) => update('bon_number', e.target.value)} className={inputClass} required />
        </Field>
        <Field label="Date" required>
          <input type="date" value={draft.entry_date} onChange={(e) => update('entry_date', e.target.value)} className={inputClass} required />
        </Field>
        <Field label="Heure">
          <input type="text" value={clock} readOnly disabled className={`${inputClass} cursor-not-allowed opacity-60`} />
        </Field>
      </div>

      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <Field label="Fournisseur" required>
          <input
            type="text"
            list="magasin-fournisseurs-list"
            value={draft.fournisseur}
            onChange={(e) => update('fournisseur', e.target.value)}
            className={inputClass}
            autoComplete="off"
            required
          />
          <datalist id="magasin-fournisseurs-list">
            {fournisseurs.map((f) => <option key={f} value={f} />)}
          </datalist>
        </Field>
        <Field label="Destination" required>
          <select value={draft.destination} onChange={(e) => update('destination', e.target.value)} className={inputClass}>
            {ACHAT_DESTINATIONS.map((d) => <option key={d} value={d}>{d}</option>)}
          </select>
        </Field>
      </div>

      <p className="rounded-lg border border-ocre/40 bg-ocre/10 px-4 py-2 text-sm text-ocre">
        {draft.destination === 'Stock'
          ? 'Les articles achetés seront ajoutés au stock du magasin.'
          : 'Revente directe : aucun impact sur le stock, juste l\'enregistrement + client + prix de revente.'}
      </p>

      <div className="flex flex-col gap-2">
        <span className="text-sm text-ink-muted">Articles achetés</span>
        <datalist id="magasin-achat-stock-list">
          {stock.map((item) => <option key={item.id} value={stockLabel(item)} />)}
        </datalist>
        <div className="flex flex-col gap-2">
          {lines.map((line) => {
            const lineTotal = itemLineTotal(line.quantite, line.prix_achat)
            return (
              <div key={line.key} className="rounded-lg border border-border bg-bg-soft p-3">
                <div className="grid grid-cols-1 gap-2 sm:grid-cols-12">
                  <div className="sm:col-span-5">
                    <input
                      type="text"
                      list="magasin-achat-stock-list"
                      value={line.search}
                      onChange={(e) => handleArticleSearch(line.key, e.target.value)}
                      className={inputClass}
                      autoComplete="off"
                      placeholder="Article (référence ou désignation ; nouveau = ajouté au catalogue)"
                    />
                  </div>
                  <div className="sm:col-span-2">
                    <input type="number" inputMode="decimal" step="0.01" min="0" value={line.quantite} onChange={(e) => setLine(line.key, { quantite: e.target.value })} className={inputClass} placeholder="Qté" />
                  </div>
                  <div className="sm:col-span-2">
                    <input type="number" inputMode="decimal" step="0.01" min="0" value={line.prix_achat} onChange={(e) => setLine(line.key, { prix_achat: e.target.value })} className={inputClass} placeholder="P.A." />
                  </div>
                  <div className="flex items-center justify-between gap-2 sm:col-span-3">
                    <span className="font-display text-ink">{formatDA(lineTotal)} DA</span>
                    <div className="flex gap-1">
                      <button type="button" onClick={addLine} className="rounded border border-ocre px-2 py-1 text-ocre hover:bg-ocre/10" title="Ajouter une ligne">+</button>
                      <button type="button" onClick={() => removeLine(line.key)} className="rounded border border-terracotta/50 px-2 py-1 text-terracotta hover:bg-terracotta/10" title="Supprimer la ligne">−</button>
                    </div>
                  </div>
                </div>
              </div>
            )
          })}
        </div>
      </div>

      <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
        <Field label="Total achat">
          <input type="text" value={`${formatDA(total)} DA`} readOnly disabled className={`${inputClass} cursor-not-allowed font-display text-ocre`} />
        </Field>
        {isRevente && (
          <>
            <Field label="Prix de revente (DA)" required>
              <input type="number" inputMode="decimal" step="0.01" min="0" value={draft.prix_revente} onChange={(e) => update('prix_revente', e.target.value)} className={inputClass} required />
            </Field>
            <Field label="Marge">
              <input
                type="text"
                value={marge == null ? '—' : `${formatDA(marge)} DA`}
                readOnly
                disabled
                className={`${inputClass} cursor-not-allowed font-display ${marge != null && marge < 0 ? 'text-terracotta' : 'text-ocre'}`}
              />
            </Field>
          </>
        )}
      </div>

      {isRevente && (
        <Field label="Client (revente directe)" required>
          <input type="text" value={draft.client_revente} onChange={(e) => update('client_revente', e.target.value)} className={inputClass} required />
        </Field>
      )}

      <Field label="Mode de paiement" required>
        <select value={draft.payment_mode} onChange={(e) => update('payment_mode', e.target.value)} className={inputClass}>
          {ACHAT_PAYMENT_MODES.map((m) => <option key={m} value={m}>{m}</option>)}
        </select>
      </Field>

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

      <PhotoField label="Photo du bon d'achat" file={draft.photo_file} onChange={(f) => update('photo_file', f)} />

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
        {loading ? 'Enregistrement…' : "Enregistrer l'achat"}
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

function PhotoField({ label, file, onChange }) {
  return (
    <div className="flex flex-col gap-1.5">
      <span className="text-sm text-ink-muted">{label}</span>
      <div className="flex flex-col gap-2 sm:flex-row">
        <label className="flex min-h-11 flex-1 cursor-pointer items-center justify-center rounded-lg border border-border bg-bg-soft px-3 py-2 text-center text-ink-muted hover:border-terracotta">
          {file ? file.name : 'Choisir une photo'}
          <input type="file" accept="image/*" onChange={(e) => onChange(e.target.files?.[0] ?? null)} className="hidden" />
        </label>
        <label className="flex min-h-11 items-center justify-center gap-2 rounded-lg border border-ocre px-3 py-2 text-ocre hover:bg-ocre/10">
          Prendre une photo
          <input type="file" accept="image/*" capture="environment" onChange={(e) => onChange(e.target.files?.[0] ?? null)} className="hidden" />
        </label>
      </div>
    </div>
  )
}

const inputClass =
  'min-h-11 w-full rounded-lg border border-border bg-bg-soft px-3 py-2 text-ink placeholder:text-ink-muted/60 outline-none focus:border-terracotta'
