import { useEffect, useMemo, useState } from 'react'
import { supabase } from '../lib/supabase'
import { getSession, useAuth } from '../lib/auth'
import { isLocked, LOCK_MESSAGE } from '../lib/lock'
import { formatDateTime } from '../lib/dateFormat'
import { buildExportFilename } from '../lib/exportFilters'
import {
  STATION_PAYMENT_STATUS,
  STATION_PAYMENT_MODES,
  LUB_UNITS,
  STATION_PUMPS,
  formatDA,
  formatQty,
  lineTotalHt,
  gazTotalWithConsigne,
  paymentLabel,
  buildStationClientSheet,
} from '../lib/station'
import RowActions from './RowActions'
import AdminCodeModal from './AdminCodeModal'
import PrintSelectionModal from './PrintSelectionModal'
import ExportFilterModal from './ExportFilterModal'
import EntitySheetModal from './EntitySheetModal'

const todayISO = () => new Date().toISOString().slice(0, 10)
const formatHHMM = (date) => date.toTimeString().slice(0, 5)
const formatTime = (v) => (v ? v.slice(0, 5) : '—')

const TABS = [
  { id: 'form', label: 'Nouvelle vente' },
  { id: 'registry', label: 'Registre' },
]

// Charge les 3 tables de vente (pour la fiche client combinée).
async function loadAllSales() {
  const [{ data: carburant }, { data: lubrifiants }, { data: gaz }] = await Promise.all([
    supabase.from('station_carburant').select('*'),
    supabase.from('station_lubrifiants').select('*'),
    supabase.from('station_gaz').select('*'),
  ])
  return { carburant: carburant ?? [], lubrifiants: lubrifiants ?? [], gaz: gaz ?? [] }
}

export default function StationSaleTab({ config }) {
  const [view, setView] = useState('form')

  return (
    <div className="flex flex-col gap-4">
      <nav className="flex gap-2">
        {TABS.map((t) => (
          <button
            key={t.id}
            type="button"
            onClick={() => setView(t.id)}
            className={`min-h-11 flex-1 rounded-full border px-4 py-2 font-display transition-colors sm:flex-none ${
              view === t.id
                ? 'border-terracotta bg-terracotta text-ink'
                : 'border-border bg-bg-soft text-ink-muted hover:border-terracotta/60'
            }`}
          >
            {t.label}
          </button>
        ))}
      </nav>

      {view === 'form' ? <SaleForm config={config} /> : <SaleRegistry config={config} />}
    </div>
  )
}

// ============================================================
// Formulaire de saisie
// ============================================================
function SaleForm({ config }) {
  const emptyDraft = {
    entry_date: todayISO(),
    client_name: '',
    product: config.productMode === 'select' ? config.productOptions[0] : '',
    pompe: config.hasPompe ? STATION_PUMPS[0] : '',
    quantity: '',
    unit: 'L',
    unit_price: '',
    consigne: '',
    payment_status: 'Non payé',
    payment_mode: '',
    cheque_number: '',
    cheque_bank: '',
    observations: '',
  }

  const [draft, setDraft] = useState(emptyDraft)
  const [clients, setClients] = useState([])
  const [productSuggestions, setProductSuggestions] = useState([])
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
      const [{ data: clientRows }, { data: productRows }] = await Promise.all([
        supabase.from('station_clients').select('name').order('name'),
        config.productMode === 'autocomplete'
          ? supabase.from(config.table).select('product')
          : Promise.resolve({ data: [] }),
      ])
      setClients((clientRows ?? []).map((c) => c.name))
      setProductSuggestions([...new Set((productRows ?? []).map((r) => r.product).filter(Boolean))].sort())
    }
    load()
  }, [config.table, config.productMode])

  function update(field, value) {
    setDraft((d) => ({ ...d, [field]: value }))
  }

  const qty = Number(draft.quantity) || 0
  const pu = Number(draft.unit_price) || 0
  const consigne = Number(draft.consigne) || 0
  const totalHt = lineTotalHt(qty, pu)
  const totalWithConsigne = gazTotalWithConsigne(qty, pu, consigne)
  const isCheque = draft.payment_mode === 'Chèque'

  function validate() {
    if (!draft.entry_date) return 'La date est obligatoire.'
    if (!draft.client_name.trim()) return 'Le client est obligatoire.'
    if (!draft.product.trim()) return 'Le produit est obligatoire.'
    if (!(qty > 0)) return 'La quantité doit être supérieure à 0.'
    if (!(pu >= 0) || draft.unit_price === '') return 'Le prix unitaire est obligatoire.'
    if (isCheque && (!draft.cheque_number.trim() || !draft.cheque_bank.trim())) {
      return 'N° de chèque et banque obligatoires pour un paiement par chèque.'
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
      client_name: draft.client_name.trim(),
      product: draft.product.trim(),
      quantity: config.quantityInteger ? Math.round(qty) : qty,
      unit_price: pu,
      payment_status: draft.payment_status,
      payment_mode: draft.payment_mode || null,
      cheque_number: isCheque ? draft.cheque_number.trim() : null,
      cheque_bank: isCheque ? draft.cheque_bank.trim() : null,
      observations: draft.observations.trim() || null,
      entered_by_user: getSession()?.username ?? null,
    }
    if (config.hasUnit) payload.unit = draft.unit || 'L'
    if (config.hasConsigne) payload.consigne = consigne
    if (config.hasPompe) payload.pompe = draft.pompe || null

    const { data, error: insertError } = await supabase
      .from(config.table)
      .insert(payload)
      .select()
      .single()
    setLoading(false)

    if (insertError) {
      setError(`Erreur d'enregistrement : ${insertError.message}`)
      return
    }

    config.notify(data)
    setSuccess('Vente enregistrée.')
    setDraft({ ...emptyDraft, entry_date: draft.entry_date, payment_status: draft.payment_status })
    const { data: clientRows } = await supabase.from('station_clients').select('name').order('name')
    setClients((clientRows ?? []).map((c) => c.name))
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
        <Field label="Statut paiement" required>
          <select value={draft.payment_status} onChange={(e) => update('payment_status', e.target.value)} className={inputClass}>
            {STATION_PAYMENT_STATUS.map((s) => (
              <option key={s} value={s}>{s}</option>
            ))}
          </select>
        </Field>
      </div>

      <Field label="Client" required>
        <input
          type="text"
          list="station-clients-list"
          value={draft.client_name}
          onChange={(e) => update('client_name', e.target.value)}
          className={inputClass}
          autoComplete="off"
          placeholder="nom du client"
          required
        />
        <datalist id="station-clients-list">
          {clients.map((c) => (
            <option key={c} value={c} />
          ))}
        </datalist>
      </Field>

      {config.hasPompe && (
        <Field label="Pompe" required>
          <select value={draft.pompe} onChange={(e) => update('pompe', e.target.value)} className={inputClass}>
            {STATION_PUMPS.map((p) => (
              <option key={p} value={p}>{p}</option>
            ))}
          </select>
        </Field>
      )}

      <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
        <Field label="Produit" required>
          {config.productMode === 'select' ? (
            <select value={draft.product} onChange={(e) => update('product', e.target.value)} className={inputClass}>
              {config.productOptions.map((p) => (
                <option key={p} value={p}>{p}</option>
              ))}
            </select>
          ) : (
            <>
              <input
                type="text"
                list="station-product-list"
                value={draft.product}
                onChange={(e) => update('product', e.target.value)}
                className={inputClass}
                autoComplete="off"
                placeholder="ex : HIDRA 46"
                required
              />
              <datalist id="station-product-list">
                {[...new Set([...config.productOptions, ...productSuggestions])].map((p) => (
                  <option key={p} value={p} />
                ))}
              </datalist>
            </>
          )}
        </Field>
        <Field label={config.quantityLabel} required>
          <input
            type="number"
            inputMode="decimal"
            step={config.quantityStep}
            min="0"
            value={draft.quantity}
            onChange={(e) => update('quantity', e.target.value)}
            className={inputClass}
            required
          />
        </Field>
        {config.hasUnit ? (
          <Field label="Unité">
            <select value={draft.unit} onChange={(e) => update('unit', e.target.value)} className={inputClass}>
              {LUB_UNITS.map((u) => (
                <option key={u} value={u}>{u}</option>
              ))}
            </select>
          </Field>
        ) : (
          <Field label="Prix unitaire (DA)" required>
            <input
              type="number"
              inputMode="decimal"
              step="0.01"
              min="0"
              value={draft.unit_price}
              onChange={(e) => update('unit_price', e.target.value)}
              className={inputClass}
              required
            />
          </Field>
        )}
      </div>

      <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
        {config.hasUnit && (
          <Field label="Prix unitaire (DA)" required>
            <input
              type="number"
              inputMode="decimal"
              step="0.01"
              min="0"
              value={draft.unit_price}
              onChange={(e) => update('unit_price', e.target.value)}
              className={inputClass}
              required
            />
          </Field>
        )}
        {config.hasConsigne && (
          <Field label="Consigne (DA)">
            <input
              type="number"
              inputMode="decimal"
              step="0.01"
              min="0"
              value={draft.consigne}
              onChange={(e) => update('consigne', e.target.value)}
              className={inputClass}
            />
          </Field>
        )}
        <Field label="Total HT">
          <input type="text" value={`${formatDA(totalHt)} DA`} readOnly disabled className={`${inputClass} cursor-not-allowed font-display text-ocre opacity-100`} />
        </Field>
        {config.hasConsigne && (
          <Field label="Total avec consigne">
            <input type="text" value={`${formatDA(totalWithConsigne)} DA`} readOnly disabled className={`${inputClass} cursor-not-allowed font-display text-ocre opacity-100`} />
          </Field>
        )}
      </div>

      <Field label="Mode de paiement">
        <select value={draft.payment_mode} onChange={(e) => update('payment_mode', e.target.value)} className={inputClass}>
          <option value="">— (non précisé)</option>
          {STATION_PAYMENT_MODES.map((m) => (
            <option key={m} value={m}>{m}</option>
          ))}
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
        {loading ? 'Enregistrement…' : 'Enregistrer la vente'}
      </button>
    </form>
  )
}

// ============================================================
// Registre
// ============================================================
function SaleRegistry({ config }) {
  const { isAdmin } = useAuth()
  const totalKey = config.hasConsigne ? 'total_with_consigne' : 'total_ht'

  const [all, setAll] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [query, setQuery] = useState('')
  const [dateFilter, setDateFilter] = useState('')
  const [productFilter, setProductFilter] = useState('')
  const [paymentFilter, setPaymentFilter] = useState('')
  const [printOpen, setPrintOpen] = useState(false)
  const [exportOpen, setExportOpen] = useState(false)
  const [exportError, setExportError] = useState('')
  const [exporting, setExporting] = useState(false)
  const [sheetOpen, setSheetOpen] = useState(false)
  const [sheetData, setSheetData] = useState(null)
  const [editingId, setEditingId] = useState(null)
  const [editDraft, setEditDraft] = useState(null)
  const [editAdminCode, setEditAdminCode] = useState(null)
  const [adminPrompt, setAdminPrompt] = useState(null)
  const [adminCodeValue, setAdminCodeValue] = useState('')
  const [adminError, setAdminError] = useState('')
  const [adminBusy, setAdminBusy] = useState(false)

  useEffect(() => {
    let active = true
    async function load() {
      setLoading(true)
      const { data, error: fetchError } = await supabase
        .from(config.table)
        .select('*')
        .order('created_at', { ascending: false })
      if (!active) return
      if (fetchError) setError(`Erreur de chargement : ${fetchError.message}`)
      else {
        setAll(data ?? [])
        setError('')
      }
      setLoading(false)
    }
    load()

    const channel = supabase
      .channel(`${config.table}-registry`)
      .on('postgres_changes', { event: '*', schema: 'public', table: config.table }, (payload) => {
        setAll((current) => applyRealtime(current, payload))
      })
      .subscribe()

    return () => {
      active = false
      supabase.removeChannel(channel)
    }
  }, [config.table])

  const productValues = useMemo(
    () => [...new Set(all.map((r) => r.product).filter(Boolean))].sort(),
    [all]
  )

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase()
    return all.filter((r) => {
      if (dateFilter && r.entry_date !== dateFilter) return false
      if (productFilter && r.product !== productFilter) return false
      if (paymentFilter && (r.payment_status ?? 'Non payé') !== paymentFilter) return false
      if (!q) return true
      return [r.client_name, r.product, r.observations].some((f) =>
        String(f ?? '').toLowerCase().includes(q)
      )
    })
  }, [all, query, dateFilter, productFilter, paymentFilter])

  const totals = useMemo(() => {
    const quantity = filtered.reduce((s, r) => s + (Number(r.quantity) || 0), 0)
    const total = filtered.reduce((s, r) => s + (Number(r[totalKey]) || 0), 0)
    const reste = filtered
      .filter((r) => (r.payment_status ?? 'Non payé') === 'Non payé')
      .reduce((s, r) => s + (Number(r.total_ht) || 0), 0)
    return { quantity, total, reste }
  }, [filtered, totalKey])

  function buildPrintConfig() {
    const filterParts = []
    if (query.trim()) filterParts.push(`Recherche : "${query.trim()}"`)
    if (dateFilter) filterParts.push(`Date : ${dateFilter}`)
    if (productFilter) filterParts.push(`Produit : ${productFilter}`)
    if (paymentFilter) filterParts.push(`Paiement : ${paymentFilter}`)

    const columns = [
      { key: 'entry_date', label: 'Date' },
      { key: 'entry_time', label: 'Heure', format: (v) => formatTime(v) },
      { key: 'client_name', label: 'Client' },
      { key: 'product', label: 'Produit' },
    ]
    if (config.hasPompe) columns.push({ key: 'pompe', label: 'Pompe' })
    columns.push({ key: 'quantity', label: 'Qté', align: 'right', format: (v) => formatQty(v) })
    if (config.hasUnit) columns.push({ key: 'unit', label: 'Unité' })
    columns.push({ key: 'unit_price', label: 'P.U. (DA)', align: 'right', format: (v) => formatDA(v) })
    columns.push({ key: 'total_ht', label: 'Total HT (DA)', align: 'right', format: (v) => formatDA(v) })
    if (config.hasConsigne) {
      columns.push({ key: 'consigne', label: 'Consigne (DA)', align: 'right', format: (v) => formatDA(v) })
      columns.push({ key: 'total_with_consigne', label: 'Total + consigne (DA)', align: 'right', format: (v) => formatDA(v) })
    }
    columns.push({ key: 'payment', label: 'Paiement' })
    columns.push({ key: 'observations', label: 'Observations' })

    return {
      subtitle: config.printSubtitle,
      orientation: 'landscape',
      filters: filterParts.join(' — '),
      columns,
      rows: filtered.map((r) => ({ ...r, payment: paymentLabel(r) })),
      totals: [
        {
          entry_date: 'TOTAUX',
          quantity: totals.quantity,
          total_ht: filtered.reduce((s, r) => s + (Number(r.total_ht) || 0), 0),
          total_with_consigne: totals.total,
        },
      ],
    }
  }

  async function openSheet() {
    setSheetData(await loadAllSales())
    setSheetOpen(true)
  }

  function sheetNameOptions() {
    return [...new Set(all.map((r) => r.client_name).filter(Boolean))].sort()
  }

  // --- édition -----------------------------------------------------------
  function startEdit(r) {
    setEditingId(r.id)
    setEditDraft({ ...r })
  }
  function cancelEdit() {
    setEditingId(null)
    setEditDraft(null)
    setEditAdminCode(null)
  }
  async function saveEdit() {
    const usingAdminCode = editAdminCode != null
    if (!usingAdminCode && isLocked(editDraft)) {
      setError(LOCK_MESSAGE)
      cancelEdit()
      return
    }
    const isCheque = editDraft.payment_mode === 'Chèque'
    const patch = {
      entry_date: editDraft.entry_date,
      client_name: editDraft.client_name?.trim() || null,
      product: editDraft.product?.trim() || null,
      quantity: config.quantityInteger ? Math.round(Number(editDraft.quantity) || 0) : Number(editDraft.quantity) || 0,
      unit_price: Number(editDraft.unit_price) || 0,
      payment_status: editDraft.payment_status || 'Non payé',
      payment_mode: editDraft.payment_mode || null,
      cheque_number: isCheque ? editDraft.cheque_number?.trim() || null : null,
      cheque_bank: isCheque ? editDraft.cheque_bank?.trim() || null : null,
      observations: editDraft.observations?.trim() || null,
    }
    if (config.hasUnit) patch.unit = editDraft.unit || 'L'
    if (config.hasConsigne) patch.consigne = Number(editDraft.consigne) || 0
    if (config.hasPompe) patch.pompe = editDraft.pompe || null

    const { data, error: updateError } = usingAdminCode
      ? await supabase.rpc(config.adminUpdateRpc, { p_id: editingId, p_admin_code: editAdminCode, p: patch })
      : await supabase.from(config.table).update(patch).eq('id', editingId).select().single()

    if (updateError) {
      setError(`Erreur de mise à jour : ${updateError.message}`)
      return
    }
    setAll((current) => current.map((r) => (r.id === data.id ? data : r)))
    cancelEdit()
    setError('')
  }

  function openAdminPrompt(action, entry) {
    if (!isAdmin) {
      setError(LOCK_MESSAGE)
      return
    }
    setAdminPrompt({ action, entry })
    setAdminCodeValue('')
    setAdminError('')
  }
  function closeAdminPrompt() {
    setAdminPrompt(null)
    setAdminCodeValue('')
    setAdminError('')
  }
  async function confirmAdminCode() {
    if (adminPrompt.action === 'edit') {
      const entry = adminPrompt.entry
      closeAdminPrompt()
      startEdit(entry)
      setEditAdminCode(adminCodeValue)
      return
    }
    setAdminBusy(true)
    const { error: rpcError } = await supabase.rpc(config.adminDeleteRpc, {
      p_id: adminPrompt.entry.id,
      p_admin_code: adminCodeValue,
    })
    setAdminBusy(false)
    if (rpcError) {
      setAdminError(`Erreur : ${rpcError.message}`)
      return
    }
    setAll((current) => current.filter((r) => r.id !== adminPrompt.entry.id))
    closeAdminPrompt()
  }

  async function handleDelete(r) {
    if (isLocked(r)) {
      setError(LOCK_MESSAGE)
      return
    }
    if (!window.confirm(`Supprimer cette vente (${r.client_name} — ${r.product}) ?`)) return
    const { error: deleteError } = await supabase.from(config.table).delete().eq('id', r.id)
    if (deleteError) {
      setError(`Erreur de suppression : ${deleteError.message}`)
      return
    }
    setAll((current) => current.filter((x) => x.id !== r.id))
  }

  async function handleExport(filters) {
    const { startDate, endDate } = filters
    const toExport = all.filter((r) => {
      if (startDate && r.entry_date < startDate) return false
      if (endDate && r.entry_date > endDate) return false
      if (filters.categoricalValues && !filters.categoricalValues.includes(r.payment_status ?? 'Non payé')) return false
      const clientQ = filters.textValues?.client_name
      if (clientQ && !String(r.client_name ?? '').toLowerCase().includes(clientQ.trim().toLowerCase())) return false
      return true
    })
    if (toExport.length === 0) {
      setExportError('Aucune donnée pour ces critères')
      return
    }
    setExportError('')
    setExportOpen(false)
    setExporting(true)
    try {
      await config.excel(toExport, { filename: buildExportFilename(config.filePrefix, startDate, endDate) })
    } catch (err) {
      setError(`Erreur export : ${err.message}`)
    } finally {
      setExporting(false)
    }
  }

  return (
    <div className="flex flex-col gap-4">
      <div className="no-print flex flex-col gap-3">
        <div className="flex flex-col gap-3 sm:flex-row sm:flex-wrap">
          <input
            type="text"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Rechercher : client, produit…"
            className="min-h-11 rounded-lg border border-border bg-bg-soft px-3 py-2 text-ink placeholder:text-ink-muted/60 outline-none focus:border-terracotta sm:flex-1"
          />
          <select value={productFilter} onChange={(e) => setProductFilter(e.target.value)} className="min-h-11 rounded-lg border border-border bg-bg-soft px-3 py-2 text-ink outline-none focus:border-terracotta">
            <option value="">Tous produits</option>
            {productValues.map((p) => (
              <option key={p} value={p}>{p}</option>
            ))}
          </select>
          <select value={paymentFilter} onChange={(e) => setPaymentFilter(e.target.value)} className="min-h-11 rounded-lg border border-border bg-bg-soft px-3 py-2 text-ink outline-none focus:border-terracotta">
            <option value="">Tous paiements</option>
            {STATION_PAYMENT_STATUS.map((s) => (
              <option key={s} value={s}>{s}</option>
            ))}
          </select>
          <input type="date" value={dateFilter} onChange={(e) => setDateFilter(e.target.value)} className="min-h-11 rounded-lg border border-border bg-bg-soft px-3 py-2 text-ink outline-none focus:border-terracotta" />
        </div>

        <div className="flex flex-wrap gap-2">
          <button type="button" onClick={() => setPrintOpen(true)} className="min-h-11 rounded-lg border border-border px-4 py-2 font-display text-ink-muted transition-colors hover:border-ink-muted">
            Imprimer
          </button>
          <PrintSelectionModal open={printOpen} onClose={() => setPrintOpen(false)} {...buildPrintConfig()} />
          <button type="button" onClick={() => { setExportError(''); setExportOpen(true) }} disabled={exporting} className="min-h-11 rounded-lg border border-ocre px-4 py-2 font-display text-ocre transition-colors hover:bg-ocre/10 disabled:opacity-50">
            {exporting ? 'Génération…' : 'Exporter Excel'}
          </button>
          <button type="button" onClick={openSheet} className="min-h-11 rounded-lg border border-ocre px-4 py-2 font-display text-ocre transition-colors hover:bg-ocre/10">
            Fiche client
          </button>
        </div>
      </div>

      {error && <p className="no-print rounded-lg border border-terracotta/50 bg-terracotta/10 px-4 py-3 text-sm text-terracotta">{error}</p>}

      {loading ? (
        <p className="text-ink-muted">Chargement…</p>
      ) : filtered.length === 0 ? (
        <p className="text-ink-muted">Aucune vente.</p>
      ) : (
        <>
          <div className="mb-1 flex flex-wrap gap-4 rounded-lg border border-border bg-bg-soft px-4 py-3">
            <Total label="Quantité" value={totals.quantity} da={false} />
            <Total label={config.hasConsigne ? 'Total + consigne' : 'Total HT'} value={totals.total} className="text-ocre" />
            <Total label="Reste à payer" value={totals.reste} className="text-terracotta" />
          </div>

          <div className="overflow-x-auto rounded-lg border border-border">
            <table className="w-full min-w-[1180px] border-collapse text-[11px] sm:text-sm">
              <thead>
                <tr className="border-b border-border bg-bg-soft text-left text-ink-muted">
                  <Th>Date</Th>
                  <Th>Heure</Th>
                  <Th>Saisie le</Th>
                  <Th>Client</Th>
                  <Th>Produit</Th>
                  {config.hasPompe && <Th>Pompe</Th>}
                  {config.hasUnit && <Th>Unité</Th>}
                  <Th>Qté</Th>
                  <Th>P.U.</Th>
                  <Th>Total HT</Th>
                  {config.hasConsigne && <Th>Consigne</Th>}
                  {config.hasConsigne && <Th>Total + consigne</Th>}
                  <Th>Paiement</Th>
                  <Th>Saisi par</Th>
                  <Th className="no-print">Actions</Th>
                </tr>
              </thead>
              <tbody>
                {filtered.map((r) =>
                  editingId === r.id ? (
                    <EditRow key={r.id} config={config} draft={editDraft} onChange={setEditDraft} onSave={saveEdit} onCancel={cancelEdit} />
                  ) : (
                    <tr key={r.id} className="border-b border-border last:border-0">
                      <Td>{r.entry_date}</Td>
                      <Td>{formatTime(r.entry_time)}</Td>
                      <Td>{formatDateTime(r.created_at)}</Td>
                      <Td>{r.client_name}</Td>
                      <Td>{r.product}</Td>
                      {config.hasPompe && <Td>{r.pompe ?? '—'}</Td>}
                      {config.hasUnit && <Td>{r.unit ?? '—'}</Td>}
                      <Td className="text-right">{formatQty(r.quantity)}</Td>
                      <Td className="text-right">{formatDA(r.unit_price)}</Td>
                      <Td className="text-right">{formatDA(r.total_ht)}</Td>
                      {config.hasConsigne && <Td className="text-right">{formatDA(r.consigne)}</Td>}
                      {config.hasConsigne && <Td className="text-right font-medium text-ocre">{formatDA(r.total_with_consigne)}</Td>}
                      <Td>
                        <span className={(r.payment_status ?? 'Non payé') === 'Payé' ? 'text-green-500' : 'text-terracotta'}>
                          {paymentLabel(r)}
                        </span>
                      </Td>
                      <Td>{r.entered_by_user ?? '—'}</Td>
                      <Td className="no-print">
                        <RowActions
                          entry={r}
                          onEdit={() => startEdit(r)}
                          onDelete={() => handleDelete(r)}
                          onLockedAttempt={(action) => openAdminPrompt(action, r)}
                        />
                      </Td>
                    </tr>
                  )
                )}
              </tbody>
            </table>
          </div>
        </>
      )}

      <AdminCodeModal
        prompt={adminPrompt}
        codeValue={adminCodeValue}
        onCodeChange={setAdminCodeValue}
        error={adminError}
        busy={adminBusy}
        onConfirm={confirmAdminCode}
        onCancel={closeAdminPrompt}
      />

      <ExportFilterModal
        open={exportOpen}
        categorical={{ field: 'payment_status', label: 'Statut de paiement', options: STATION_PAYMENT_STATUS }}
        textFilters={[
          { field: 'client_name', label: 'Client', suggestions: [...new Set(all.map((r) => r.client_name).filter(Boolean))] },
        ]}
        hasPhotos={false}
        error={exportError}
        onExport={handleExport}
        onCancel={() => setExportOpen(false)}
      />

      <EntitySheetModal
        open={sheetOpen}
        onClose={() => setSheetOpen(false)}
        modalTitle="Fiche client — Station"
        nameLabel="Client"
        nameOptions={sheetNameOptions}
        onGenerate={(_typeId, name, startDate, endDate) =>
          buildStationClientSheet(sheetData ?? { carburant: [], lubrifiants: [], gaz: [] }, name, startDate, endDate)
        }
        excelSheetName="Fiche client station"
      />
    </div>
  )
}

function Total({ label, value, className = 'text-ink', da = true }) {
  return (
    <div>
      <p className="text-xs text-ink-muted">{label}</p>
      <p className={`font-display text-lg ${className}`}>
        {da ? `${formatDA(value)} DA` : formatQty(value)}
      </p>
    </div>
  )
}

function EditRow({ config, draft, onChange, onSave, onCancel }) {
  function set(field, value) {
    onChange({ ...draft, [field]: value })
  }
  const isCheque = draft.payment_mode === 'Chèque'
  const totalHt = lineTotalHt(draft.quantity, draft.unit_price)
  return (
    <tr className="border-b border-border bg-bg-soft last:border-0">
      <Td>
        <input type="date" value={draft.entry_date} onChange={(e) => set('entry_date', e.target.value)} className={editInputClass} />
      </Td>
      <Td>{formatTime(draft.entry_time)}</Td>
      <Td>{formatDateTime(draft.created_at)}</Td>
      <Td>
        <input type="text" value={draft.client_name ?? ''} onChange={(e) => set('client_name', e.target.value)} className={editInputClass} />
      </Td>
      <Td>
        {config.productMode === 'select' ? (
          <select value={draft.product} onChange={(e) => set('product', e.target.value)} className={editInputClass}>
            {config.productOptions.map((p) => (
              <option key={p} value={p}>{p}</option>
            ))}
          </select>
        ) : (
          <input type="text" value={draft.product ?? ''} onChange={(e) => set('product', e.target.value)} className={editInputClass} />
        )}
      </Td>
      {config.hasPompe && (
        <Td>
          <select value={draft.pompe ?? ''} onChange={(e) => set('pompe', e.target.value)} className={editInputClass}>
            {STATION_PUMPS.map((p) => (
              <option key={p} value={p}>{p}</option>
            ))}
          </select>
        </Td>
      )}
      {config.hasUnit && (
        <Td>
          <select value={draft.unit ?? 'L'} onChange={(e) => set('unit', e.target.value)} className={editInputClass}>
            {LUB_UNITS.map((u) => (
              <option key={u} value={u}>{u}</option>
            ))}
          </select>
        </Td>
      )}
      <Td>
        <input type="number" step={config.quantityStep} value={draft.quantity ?? ''} onChange={(e) => set('quantity', e.target.value)} className={editInputClass} />
      </Td>
      <Td>
        <input type="number" step="0.01" value={draft.unit_price ?? ''} onChange={(e) => set('unit_price', e.target.value)} className={editInputClass} />
      </Td>
      <Td className="text-right">{formatDA(totalHt)}</Td>
      {config.hasConsigne && (
        <Td>
          <input type="number" step="0.01" value={draft.consigne ?? 0} onChange={(e) => set('consigne', e.target.value)} className={editInputClass} />
        </Td>
      )}
      {config.hasConsigne && (
        <Td className="text-right text-ocre">
          {formatDA(gazTotalWithConsigne(draft.quantity, draft.unit_price, draft.consigne))}
        </Td>
      )}
      <Td>
        <div className="flex min-w-40 flex-col gap-1">
          <select value={draft.payment_status ?? 'Non payé'} onChange={(e) => set('payment_status', e.target.value)} className={editInputClass}>
            {STATION_PAYMENT_STATUS.map((s) => (
              <option key={s} value={s}>{s}</option>
            ))}
          </select>
          <select value={draft.payment_mode ?? ''} onChange={(e) => set('payment_mode', e.target.value)} className={editInputClass}>
            <option value="">— mode</option>
            {STATION_PAYMENT_MODES.map((m) => (
              <option key={m} value={m}>{m}</option>
            ))}
          </select>
          {isCheque && (
            <>
              <input type="text" placeholder="N° chèque" value={draft.cheque_number ?? ''} onChange={(e) => set('cheque_number', e.target.value)} className={editInputClass} />
              <input type="text" placeholder="Banque" value={draft.cheque_bank ?? ''} onChange={(e) => set('cheque_bank', e.target.value)} className={editInputClass} />
            </>
          )}
        </div>
      </Td>
      <Td>{draft.entered_by_user ?? '—'}</Td>
      <Td className="no-print">
        <div className="flex gap-2">
          <button type="button" onClick={onSave} className="rounded border border-ocre px-2 py-1 text-ocre hover:bg-ocre/10">
            Enregistrer
          </button>
          <button type="button" onClick={onCancel} className="rounded border border-border px-2 py-1 text-ink-muted hover:border-ink-muted">
            Annuler
          </button>
        </div>
      </Td>
    </tr>
  )
}

function Th({ children, className = '' }) {
  return <th className={`px-1 py-1 font-display font-medium whitespace-nowrap sm:px-3 sm:py-2 ${className}`}>{children}</th>
}

function Td({ children, className = '' }) {
  return <td className={`px-1 py-1 whitespace-nowrap sm:px-3 sm:py-2 ${className}`}>{children}</td>
}

function applyRealtime(current, payload) {
  if (payload.eventType === 'INSERT') {
    if (current.some((r) => r.id === payload.new.id)) return current
    return [payload.new, ...current].sort((a, b) => (a.created_at < b.created_at ? 1 : -1))
  }
  if (payload.eventType === 'UPDATE') return current.map((r) => (r.id === payload.new.id ? payload.new : r))
  if (payload.eventType === 'DELETE') return current.filter((r) => r.id !== payload.old.id)
  return current
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
const editInputClass =
  'min-w-24 rounded border border-border bg-bg px-2 py-1 text-ink outline-none focus:border-terracotta'
