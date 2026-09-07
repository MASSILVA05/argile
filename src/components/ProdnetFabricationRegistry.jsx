import { useEffect, useMemo, useState } from 'react'
import { supabase } from '../lib/supabase'
import { useAuth } from '../lib/auth'
import { isLocked, LOCK_MESSAGE } from '../lib/lock'
import { formatDateTime } from '../lib/dateFormat'
import { buildExportFilename } from '../lib/exportFilters'
import { downloadProdnetFabricationsExcel } from '../lib/prodnetExcel'
import { printFabrications } from '../lib/printRegistry'
import { formatDA, formatQty, matieresSummary, toNum, ligneTotal, computeCoutTotal, computeCoutUnitaire } from '../lib/prodnet'
import RowActions from './RowActions'
import AdminCodeModal from './AdminCodeModal'
import PrintSelectionModal from './PrintSelectionModal'
import MatieresPicker from './MatieresPicker'

const fmtTime = (v) => (v ? v.slice(0, 5) : '—')

// 'YYYY-MM-DD' -> 'DD/MM/YY' (compact pour la liste de sélection)
function dateCourt(iso) {
  const [y, m, d] = String(iso ?? '').split('-')
  return d && m && y ? `${d}/${m}/${y.slice(2)}` : (iso ?? '')
}

export default function ProdnetFabricationRegistry() {
  const { isAdmin } = useAuth()
  const [all, setAll] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [productFilter, setProductFilter] = useState('')
  const [dateFilter, setDateFilter] = useState('')
  const [expandedId, setExpandedId] = useState(null)
  const [editEntry, setEditEntry] = useState(null)
  const [editAdminCode, setEditAdminCode] = useState(null)
  const [adminPrompt, setAdminPrompt] = useState(null)
  const [adminCodeValue, setAdminCodeValue] = useState('')
  const [adminError, setAdminError] = useState('')
  const [adminBusy, setAdminBusy] = useState(false)
  const [exporting, setExporting] = useState(false)
  const [printOpen, setPrintOpen] = useState(false)

  useEffect(() => {
    let active = true
    async function load() {
      setLoading(true)
      const { data, error: fetchError } = await supabase
        .from('prodnet_fabrications')
        .select('*')
        .order('entry_date', { ascending: false })
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
      .channel('prodnet-fabrications-registry')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'prodnet_fabrications' }, (payload) => {
        setAll((current) => applyRealtime(current, payload))
      })
      .subscribe()
    return () => {
      active = false
      supabase.removeChannel(channel)
    }
  }, [])

  const productOptions = useMemo(
    () => [...new Set(all.map((f) => f.product_designation).filter(Boolean))].sort(),
    [all]
  )

  const filtered = useMemo(() => {
    return all.filter((f) => {
      if (productFilter && f.product_designation !== productFilter) return false
      if (dateFilter && f.entry_date !== dateFilter) return false
      return true
    })
  }, [all, productFilter, dateFilter])

  const totals = useMemo(() => {
    const coutTotal = filtered.reduce((s, f) => s + (Number(f.cout_total) || 0), 0)
    const qte = filtered.reduce((s, f) => s + (Number(f.quantite_produite) || 0), 0)
    return { coutTotal, qte }
  }, [filtered])

  // Le registre de fabrication n'utilise PAS le tableau standard : chaque
  // fabrication est imprimée comme une fiche (en-tête + tableau des matières).
  // On fournit ici seulement les colonnes/lignes pour la LISTE DE SÉLECTION
  // de PrintSelectionModal, et `onPrint` qui reçoit les fabrications cochées.
  function buildPrintConfig() {
    return {
      title: 'SARL DPR AXXAM',
      subtitle: 'Fiches de Fabrication',
      columns: [
        { key: 'date_court', label: 'Date' },
        { key: 'product_reference', label: 'Réf.' },
        { key: 'product_designation', label: 'Produit fini' },
        { key: 'quantite_produite', label: 'Qté', align: 'right', format: (v) => formatQty(v) },
        { key: 'matieres', label: 'Nb matières', align: 'right', format: (v) => (Array.isArray(v) ? v.length : 0) },
        { key: 'cout_total', label: 'Coût total (DA)', align: 'right', format: (v) => formatDA(v) },
      ],
      rows: filtered.map((f) => ({ ...f, date_court: dateCourt(f.entry_date) })),
      onPrint: (fabs) => printFabrications(fabs),
    }
  }

  async function handleExport() {
    setExporting(true)
    try {
      await downloadProdnetFabricationsExcel(filtered, {
        filename: buildExportFilename('Prodnet_Fabrications', dateFilter || '', dateFilter || ''),
      })
    } catch (err) {
      setError(`Erreur export : ${err.message}`)
    } finally {
      setExporting(false)
    }
  }

  // Édition d'une fabrication : date + observations + MATIÈRES (avec
  // réajustement atomique du stock via la RPC prodnet_update_fabrication_matieres).
  // Renvoie un message d'erreur (affiché dans la modale) ou null si succès.
  async function saveEdit({ entry_date, observations, matieres }) {
    const { data, error: updateError } = await supabase.rpc('prodnet_update_fabrication_matieres', {
      p_id: editEntry.id,
      p_admin_code: editAdminCode ?? '',
      p_matieres: matieres,
      p_entry_date: entry_date,
      p_observations: observations,
    })
    if (updateError) return updateError.message
    const row = Array.isArray(data) ? data[0] : data
    setAll((current) => current.map((f) => (f.id === row.id ? row : f)))
    setEditEntry(null)
    setEditAdminCode(null)
    setError('')
    return null
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
      const code = adminCodeValue
      closeAdminPrompt()
      setEditEntry(entry)
      setEditAdminCode(code)
      return
    }
    setAdminBusy(true)
    const { error: rpcError } = await supabase.rpc('admin_delete_prodnet_fabrication', {
      p_id: adminPrompt.entry.id,
      p_admin_code: adminCodeValue,
    })
    setAdminBusy(false)
    if (rpcError) {
      setAdminError(`Erreur : ${rpcError.message}`)
      return
    }
    setAll((current) => current.filter((f) => f.id !== adminPrompt.entry.id))
    closeAdminPrompt()
  }

  async function handleDelete(entry) {
    if (isLocked(entry)) {
      setError(LOCK_MESSAGE)
      return
    }
    if (!window.confirm(
      `Supprimer la fabrication du ${entry.entry_date} (${entry.product_designation}) ?\n\nAttention : les stocks de matières / produit ne sont PAS restaurés automatiquement.`
    )) return
    const { error: deleteError } = await supabase.from('prodnet_fabrications').delete().eq('id', entry.id)
    if (deleteError) {
      setError(`Erreur de suppression : ${deleteError.message}`)
      return
    }
    setAll((current) => current.filter((f) => f.id !== entry.id))
  }

  return (
    <div className="flex flex-col gap-4">
      <div className="no-print flex flex-col gap-3">
        <div className="flex flex-col gap-3 sm:flex-row sm:flex-wrap">
          <select value={productFilter} onChange={(e) => setProductFilter(e.target.value)} className={filterClass}>
            <option value="">Tous les produits</option>
            {productOptions.map((p) => <option key={p} value={p}>{p}</option>)}
          </select>
          <input type="date" value={dateFilter} onChange={(e) => setDateFilter(e.target.value)} className={filterClass} />
        </div>
        <div className="flex flex-wrap gap-2">
          <button type="button" onClick={() => setPrintOpen(true)} className="min-h-11 rounded-lg border border-border px-4 py-2 font-display text-ink-muted hover:border-ink-muted">
            Imprimer
          </button>
          <button type="button" onClick={handleExport} disabled={exporting} className="min-h-11 rounded-lg border border-ocre px-4 py-2 font-display text-ocre hover:bg-ocre/10 disabled:opacity-50">
            {exporting ? 'Génération…' : 'Exporter Excel'}
          </button>
        </div>
      </div>

      {error && <p className="no-print rounded-lg border border-terracotta/50 bg-terracotta/10 px-4 py-3 text-sm text-terracotta">{error}</p>}

      {loading ? (
        <p className="text-ink-muted">Chargement…</p>
      ) : filtered.length === 0 ? (
        <p className="text-ink-muted">Aucune fabrication.</p>
      ) : (
        <>
          <div className="mb-1 flex flex-wrap gap-4 rounded-lg border border-border bg-bg-soft px-4 py-3">
            <div>
              <p className="text-xs text-ink-muted">Quantité produite (total)</p>
              <p className="font-display text-lg text-ink">{formatQty(totals.qte)}</p>
            </div>
            <div>
              <p className="text-xs text-ink-muted">Coût total fabrications</p>
              <p className="font-display text-lg text-ocre">{formatDA(totals.coutTotal)} DA</p>
            </div>
          </div>

          <div className="overflow-x-auto rounded-lg border border-border">
            <table className="w-full min-w-[1000px] border-collapse text-[11px] sm:text-sm">
              <thead>
                <tr className="border-b border-border bg-bg-soft text-left text-ink-muted">
                  <Th>Date</Th>
                  <Th>Heure</Th>
                  <Th>Saisie le</Th>
                  <Th>Produit fini</Th>
                  <Th>Qté produite</Th>
                  <Th>Matières</Th>
                  <Th>Coût total</Th>
                  <Th>Coût unitaire</Th>
                  <Th>Saisi par</Th>
                  <Th className="no-print">Actions</Th>
                </tr>
              </thead>
              <tbody>
                {filtered.map((f) => (
                  <FabRow
                    key={f.id}
                    fab={f}
                    expanded={expandedId === f.id}
                    onToggle={() => setExpandedId((id) => (id === f.id ? null : f.id))}
                    onEdit={() => { setEditEntry(f); setEditAdminCode(null) }}
                    onDelete={() => handleDelete(f)}
                    onLockedAttempt={(action) => openAdminPrompt(action, f)}
                  />
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}

      {editEntry && (
        <EditModal
          entry={editEntry}
          adminMode={editAdminCode != null}
          onSave={saveEdit}
          onCancel={() => { setEditEntry(null); setEditAdminCode(null) }}
        />
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

      <PrintSelectionModal open={printOpen} onClose={() => setPrintOpen(false)} {...buildPrintConfig()} />
    </div>
  )
}

function FabRow({ fab, expanded, onToggle, onEdit, onDelete, onLockedAttempt }) {
  const matieres = Array.isArray(fab.matieres) ? fab.matieres : []
  return (
    <>
      <tr className="border-b border-border last:border-0">
        <Td>{fab.entry_date}</Td>
        <Td>{fmtTime(fab.entry_time)}</Td>
        <Td>{formatDateTime(fab.created_at)}</Td>
        <Td className="max-w-[280px] truncate" title={fab.product_designation}>
          {fab.product_reference ? `${fab.product_designation} [${fab.product_reference}]` : fab.product_designation}
        </Td>
        <Td className="text-right">{formatQty(fab.quantite_produite)}</Td>
        <Td>
          <button type="button" onClick={onToggle} className="rounded border border-border px-2 py-1 text-ink-muted hover:border-ocre hover:text-ocre">
            {matieresSummary(fab.matieres)} · {expanded ? 'masquer' : 'détail'}
          </button>
        </Td>
        <Td className="text-right font-medium text-ocre">{formatDA(fab.cout_total)}</Td>
        <Td className="text-right">{formatDA(fab.cout_unitaire)}</Td>
        <Td>{fab.entered_by_user ?? '—'}</Td>
        <Td className="no-print">
          <RowActions entry={fab} onEdit={onEdit} onDelete={onDelete} onLockedAttempt={onLockedAttempt} />
        </Td>
      </tr>
      {expanded && (
        <tr className="border-b border-border bg-bg-soft last:border-0">
          <td colSpan={10} className="px-3 py-3">
            <p className="mb-2 font-display text-ink">Matières premières consommées</p>
            <table className="w-full border-collapse text-[11px] sm:text-sm">
              <thead>
                <tr className="text-left text-ink-muted">
                  <th className="py-1 pr-4">Désignation</th>
                  <th className="py-1 pr-4 text-right">Quantité</th>
                  <th className="py-1 pr-4 text-right">Prix unitaire</th>
                  <th className="py-1 text-right">Total</th>
                </tr>
              </thead>
              <tbody>
                {matieres.map((m, i) => (
                  <tr key={i}>
                    <td className="py-1 pr-4">{m.designation}</td>
                    <td className="py-1 pr-4 text-right">{formatQty(m.quantite_utilisee)}</td>
                    <td className="py-1 pr-4 text-right">{formatDA(m.prix_unitaire)}</td>
                    <td className="py-1 text-right">{formatDA(m.total)}</td>
                  </tr>
                ))}
              </tbody>
              <tfoot>
                <tr className="font-medium">
                  <td className="py-1 pr-4">TOTAL</td>
                  <td></td>
                  <td></td>
                  <td className="py-1 text-right text-ocre">{formatDA(fab.cout_total)}</td>
                </tr>
              </tfoot>
            </table>
            {fab.observations && <p className="mt-2 text-sm text-ink-muted">Obs : {fab.observations}</p>}
          </td>
        </tr>
      )}
    </>
  )
}

let editLineSeq = 0

function EditModal({ entry, adminMode, onSave, onCancel }) {
  const [entryDate, setEntryDate] = useState(entry.entry_date)
  const [observations, setObservations] = useState(entry.observations ?? '')
  const [lines, setLines] = useState(() =>
    (Array.isArray(entry.matieres) ? entry.matieres : []).map((m) => ({
      key: `e${++editLineSeq}`,
      matiere_id: m.matiere_id ?? null,
      designation: m.designation ?? '',
      quantite_utilisee: String(m.quantite_utilisee ?? ''),
      prix_unitaire: toNum(m.prix_unitaire),
      original_qte: toNum(m.quantite_utilisee),
    }))
  )
  const [catalogue, setCatalogue] = useState([])
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')

  useEffect(() => {
    let active = true
    supabase
      .from('prodnet_matieres')
      .select('id, designation, quantite, prix_moyen, unite')
      .order('designation')
      .then(({ data }) => {
        if (active) setCatalogue(data ?? [])
      })
    return () => {
      active = false
    }
  }, [])

  const catalogueById = useMemo(() => {
    const map = new Map()
    for (const m of catalogue) map.set(m.id, m)
    return map
  }, [catalogue])

  // Stock « disponible » pour l'édition d'une ligne = stock actuel + ce que
  // CETTE fabrication consommait déjà pour cette matière (car à la sauvegarde
  // la RPC reverse l'ancien puis ré-applique le nouveau).
  function stockBase(line) {
    const cat = line.matiere_id ? catalogueById.get(line.matiere_id) : null
    if (!cat) return null
    return toNum(cat.quantite) + toNum(line.original_qte)
  }

  const rows = lines.map((l) => {
    const base = stockBase(l)
    const qte = toNum(l.quantite_utilisee)
    const total = ligneTotal(l.quantite_utilisee, l.prix_unitaire)
    return { ...l, base, qte, total, insufficient: base != null && qte > base }
  })

  const validItems = rows.filter((r) => r.qte > 0)
  const coutTotal = computeCoutTotal(validItems.map((r) => ({ total: r.total })))
  const coutUnitaire = computeCoutUnitaire(coutTotal, entry.quantite_produite)
  const hasInsufficient = rows.some((r) => r.insufficient)

  function setQte(key, value) {
    setLines((cur) => cur.map((l) => (l.key === key ? { ...l, quantite_utilisee: value } : l)))
  }

  function removeLine(key) {
    setLines((cur) => cur.filter((l) => l.key !== key))
  }

  function toggleMatiere(id, checked) {
    if (checked) {
      const m = catalogueById.get(id)
      if (!m) return
      setLines((cur) =>
        cur.some((l) => l.matiere_id === id)
          ? cur
          : [
              ...cur,
              {
                key: `e${++editLineSeq}`,
                matiere_id: m.id,
                designation: m.designation,
                quantite_utilisee: '',
                prix_unitaire: toNum(m.prix_moyen),
                original_qte: 0,
              },
            ]
      )
    } else {
      setLines((cur) => cur.filter((l) => l.matiere_id !== id))
    }
  }

  async function submit() {
    setError('')
    if (validItems.length === 0) {
      setError('Renseignez une quantité pour au moins une matière première.')
      return
    }
    if (hasInsufficient) {
      const r = rows.find((x) => x.insufficient)
      setError(`Stock insuffisant pour « ${r.designation} » (disponible : ${formatQty(r.base)}).`)
      return
    }
    setBusy(true)
    const matieres = validItems.map((r) => ({
      matiere_id: r.matiere_id,
      designation: r.designation,
      quantite_utilisee: r.qte,
      prix_unitaire: toNum(r.prix_unitaire),
      total: r.total,
    }))
    const msg = await onSave({
      entry_date: entryDate,
      observations: observations.trim() || null,
      matieres,
    })
    setBusy(false)
    if (msg) setError(msg)
  }

  return (
    <div className="fixed inset-0 z-50 bg-black/70 sm:flex sm:items-center sm:justify-center sm:p-4" onClick={onCancel}>
      <div
        className="flex h-full w-full flex-col overflow-y-auto bg-bg-card p-5 sm:h-auto sm:max-h-[92vh] sm:w-full sm:max-w-3xl sm:rounded-xl sm:border sm:border-border"
        onClick={(e) => e.stopPropagation()}
      >
        <h2 className="mb-1 font-display text-lg text-ink">
          Modifier la fabrication {adminMode && <span className="ml-2 text-sm text-ocre">(code admin)</span>}
        </h2>
        <p className="mb-3 text-sm text-ink-muted">
          Produit : <span className="text-ink">{entry.product_reference ? `${entry.product_designation} [${entry.product_reference}]` : entry.product_designation}</span>
          {' — '}Quantité produite : <span className="text-ink">{formatQty(entry.quantite_produite)}</span> (non modifiable)
        </p>

        <div className="mb-3 grid grid-cols-1 gap-3 sm:grid-cols-2">
          <label className="flex flex-col gap-1.5">
            <span className="text-sm text-ink-muted">Date</span>
            <input type="date" value={entryDate} onChange={(e) => setEntryDate(e.target.value)} className={ic} />
          </label>
        </div>

        <p className="mb-1 text-sm text-ink-muted">Matières premières consommées</p>
        <div className="overflow-x-auto rounded-lg border border-border">
          <table className="w-full min-w-[560px] border-collapse text-[11px] sm:text-sm">
            <thead>
              <tr className="border-b border-border bg-bg-soft text-left text-ink-muted">
                <th className="px-2 py-1.5">Désignation</th>
                <th className="px-2 py-1.5">Qté utilisée</th>
                <th className="px-2 py-1.5 text-right">Prix unitaire</th>
                <th className="px-2 py-1.5 text-right">Total</th>
                <th className="px-2 py-1.5" />
              </tr>
            </thead>
            <tbody>
              {rows.length === 0 ? (
                <tr><td colSpan={5} className="px-2 py-3 text-center text-ink-muted">Aucune matière. Ajoutez-en ci-dessous.</td></tr>
              ) : (
                rows.map((r) => (
                  <tr key={r.key} className="border-b border-border last:border-0">
                    <td className="px-2 py-1.5">{r.designation}</td>
                    <td className="px-2 py-1.5">
                      <input
                        type="number"
                        inputMode="decimal"
                        step="0.001"
                        min="0"
                        value={r.quantite_utilisee}
                        onChange={(e) => setQte(r.key, e.target.value)}
                        className={`w-24 rounded border bg-bg px-2 py-1 text-ink outline-none focus:border-terracotta ${
                          r.insufficient ? 'border-terracotta bg-terracotta/10 text-terracotta' : 'border-border'
                        }`}
                      />
                      {r.base != null && (
                        <span className={`ml-2 text-xs ${r.insufficient ? 'text-terracotta' : 'text-ink-muted'}`}>
                          dispo {formatQty(r.base)}
                        </span>
                      )}
                    </td>
                    <td className="px-2 py-1.5 text-right">{formatDA(r.prix_unitaire)}</td>
                    <td className="px-2 py-1.5 text-right font-medium">{formatDA(r.total)}</td>
                    <td className="px-2 py-1.5">
                      <button type="button" onClick={() => removeLine(r.key)} className="rounded border border-terracotta/50 px-2 py-1 text-terracotta hover:bg-terracotta/10">
                        Retirer
                      </button>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>

        <p className="mt-3 mb-1 text-sm text-ink-muted">Ajouter / retirer des matières</p>
        <MatieresPicker
          catalogue={catalogue}
          isSelected={(id) => lines.some((l) => l.matiere_id === id)}
          onToggle={toggleMatiere}
          stockOf={(m) => toNum(m.quantite) + toNum(lines.find((l) => l.matiere_id === m.id)?.original_qte)}
        />

        <div className="mt-3 grid grid-cols-2 gap-3">
          <div className="rounded-lg border border-ocre/50 bg-ocre/10 px-3 py-2">
            <p className="text-xs text-ink-muted">Coût total (recalculé)</p>
            <p className="font-display text-lg text-ocre">{formatDA(coutTotal)} DA</p>
          </div>
          <div className="rounded-lg border border-ocre/50 bg-ocre/10 px-3 py-2">
            <p className="text-xs text-ink-muted">Coût unitaire (recalculé)</p>
            <p className="font-display text-lg text-ocre">{formatDA(coutUnitaire)} DA</p>
          </div>
        </div>

        <label className="mt-3 flex flex-col gap-1.5">
          <span className="text-sm text-ink-muted">Observations</span>
          <textarea value={observations} onChange={(e) => setObservations(e.target.value)} className={`${ic} min-h-16 resize-y`} />
        </label>

        {hasInsufficient && (
          <p className="mt-3 rounded-lg border border-terracotta/50 bg-terracotta/10 px-3 py-2 text-sm font-medium text-terracotta">
            ⚠ Stock insuffisant sur une matière — corrigez les quantités.
          </p>
        )}
        {error && <p className="mt-3 rounded-lg border border-terracotta/50 bg-terracotta/10 px-3 py-2 text-sm text-terracotta">{error}</p>}

        <div className="mt-4 flex justify-end gap-2">
          <button type="button" onClick={onCancel} className="min-h-11 rounded-lg border border-border px-3 py-2 text-sm text-ink-muted">Annuler</button>
          <button
            type="button"
            onClick={submit}
            disabled={busy || hasInsufficient}
            className="min-h-11 rounded-lg bg-terracotta px-3 py-2 text-sm font-display text-ink hover:bg-terracotta-hover disabled:opacity-50"
          >
            {busy ? 'Enregistrement…' : 'Enregistrer'}
          </button>
        </div>
      </div>
    </div>
  )
}

function Th({ children, className = '' }) {
  return <th className={`px-1 py-1 font-display font-medium whitespace-nowrap sm:px-3 sm:py-2 ${className}`}>{children}</th>
}

function Td({ children, className = '', title }) {
  return (
    <td className={`px-1 py-1 whitespace-nowrap sm:px-3 sm:py-2 ${className}`} title={title}>
      {children}
    </td>
  )
}

function applyRealtime(current, payload) {
  if (payload.eventType === 'INSERT') {
    if (current.some((f) => f.id === payload.new.id)) return current
    return [payload.new, ...current].sort((a, b) =>
      a.entry_date < b.entry_date ? 1 : a.entry_date > b.entry_date ? -1 : a.created_at < b.created_at ? 1 : -1
    )
  }
  if (payload.eventType === 'UPDATE') return current.map((f) => (f.id === payload.new.id ? payload.new : f))
  if (payload.eventType === 'DELETE') return current.filter((f) => f.id !== payload.old.id)
  return current
}

const filterClass =
  'min-h-11 rounded-lg border border-border bg-bg-soft px-3 py-2 text-ink outline-none focus:border-terracotta'
const ic =
  'min-h-11 w-full rounded-lg border border-border bg-bg-soft px-3 py-2 text-ink outline-none focus:border-terracotta'
