import { useEffect, useMemo, useState } from 'react'
import { supabase } from '../lib/supabase'
import { useAuth } from '../lib/auth'
import { isLocked, LOCK_MESSAGE } from '../lib/lock'
import { buildExportFilename } from '../lib/exportFilters'
import { downloadPpiImportsExcel } from '../lib/ppiExcel'
import { formatEUR, formatQty, buildPpiFournisseurSheet } from '../lib/ppi'
import RowActions from './RowActions'
import AdminCodeModal from './AdminCodeModal'
import PrintSelectionModal from './PrintSelectionModal'
import EntitySheetModal from './EntitySheetModal'

const fmtTime = (v) => (v ? v.slice(0, 5) : '—')

export default function PPIRegistry() {
  const { isAdmin } = useAuth()
  const [all, setAll] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [countryFilter, setCountryFilter] = useState('')
  const [productFilter, setProductFilter] = useState('')
  const [dateFilter, setDateFilter] = useState('')
  const [printOpen, setPrintOpen] = useState(false)
  const [exporting, setExporting] = useState(false)
  const [sheetOpen, setSheetOpen] = useState(false)
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
        .from('ppi_imports')
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
      .channel('ppi-imports-registry')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'ppi_imports' }, (payload) => {
        setAll((current) => applyRealtime(current, payload))
      })
      .subscribe()
    return () => {
      active = false
      supabase.removeChannel(channel)
    }
  }, [])

  const countryOptions = useMemo(
    () => [...new Set(all.map((r) => r.country_name_fr).filter(Boolean))].sort(),
    [all]
  )
  const productOptions = useMemo(
    () => [...new Set(all.map((r) => r.product_designation).filter(Boolean))].sort(),
    [all]
  )
  const fournisseurOptions = useMemo(
    () => [...new Set(all.map((r) => r.fournisseur).filter(Boolean))].sort(),
    [all]
  )

  const filtered = useMemo(() => {
    return all.filter((r) => {
      if (countryFilter && r.country_name_fr !== countryFilter) return false
      if (productFilter && r.product_designation !== productFilter) return false
      if (dateFilter && r.entry_date !== dateFilter) return false
      return true
    })
  }, [all, countryFilter, productFilter, dateFilter])

  const totalsByCountry = useMemo(() => {
    const map = new Map()
    for (const r of filtered) {
      const key = r.country_name_fr ?? '—'
      const cur = map.get(key) ?? { country: key, qte: 0, montant: 0 }
      cur.qte += Number(r.quantite) || 0
      cur.montant += Number(r.montant) || 0
      map.set(key, cur)
    }
    return [...map.values()].sort((a, b) => a.country.localeCompare(b.country))
  }, [filtered])

  const totalGeneral = useMemo(
    () => filtered.reduce((s, r) => s + (Number(r.montant) || 0), 0),
    [filtered]
  )

  function buildPrintConfig() {
    const filterParts = []
    if (countryFilter) filterParts.push(`Pays : ${countryFilter}`)
    if (productFilter) filterParts.push(`Produit : ${productFilter}`)
    if (dateFilter) filterParts.push(`Date : ${dateFilter}`)

    return {
      subtitle: 'PPI — Registre des importations',
      orientation: 'landscape',
      filters: filterParts.join(' — '),
      columns: [
        { key: 'entry_date', label: 'Date' },
        { key: 'country_name_fr', label: 'Pays' },
        { key: 'product_designation', label: 'Produit' },
        { key: 'position_tarifaire', label: 'Position tarifaire' },
        { key: 'quantite', label: 'Qté', align: 'right', format: (v) => formatQty(v) },
        { key: 'prix_unitaire', label: 'P.U. (€)', align: 'right', format: (v) => formatEUR(v) },
        { key: 'montant', label: 'Montant (€)', align: 'right', format: (v) => formatEUR(v) },
        { key: 'numero_facture', label: 'Facture' },
        { key: 'fournisseur', label: 'Fournisseur' },
        { key: 'entered_by_user', label: 'Saisi par' },
      ],
      rows: filtered,
      totals: [{ entry_date: 'TOTAUX', quantite: filtered.reduce((s, r) => s + (Number(r.quantite) || 0), 0), montant: totalGeneral }],
    }
  }

  async function handleExport() {
    setExporting(true)
    try {
      await downloadPpiImportsExcel(filtered, {
        filename: buildExportFilename('PPI_Importations', dateFilter || '', dateFilter || ''),
      })
    } catch (err) {
      setError(`Erreur export : ${err.message}`)
    } finally {
      setExporting(false)
    }
  }

  // --- édition (uniquement date / n° facture / fournisseur / observations
  // -- quantité/prix/produit/pays déjà appliqués au budget et au stock) -----
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
    const patch = {
      entry_date: editDraft.entry_date,
      numero_facture: editDraft.numero_facture?.trim() || null,
      fournisseur: editDraft.fournisseur?.trim() || null,
      observations: editDraft.observations?.trim() || null,
    }

    const { data, error: updateError } = usingAdminCode
      ? await supabase.rpc('admin_update_ppi_import', { p_id: editingId, p_admin_code: editAdminCode, p: patch })
      : await supabase.from('ppi_imports').update(patch).eq('id', editingId).select().single()

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
    const { error: rpcError } = await supabase.rpc('admin_delete_ppi_import', {
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
    if (!window.confirm(`Supprimer cette importation (${r.product_designation} — ${r.country_name_fr}) ?\n\nLe budget du pays et le stock du produit seront restaurés.`)) return
    const { error: deleteError } = await supabase.from('ppi_imports').delete().eq('id', r.id)
    if (deleteError) {
      setError(`Erreur de suppression : ${deleteError.message}`)
      return
    }
    setAll((current) => current.filter((x) => x.id !== r.id))
  }

  return (
    <div className="flex flex-col gap-4">
      <div className="no-print flex flex-col gap-3">
        <div className="flex flex-col gap-3 sm:flex-row sm:flex-wrap">
          <select value={countryFilter} onChange={(e) => setCountryFilter(e.target.value)} className={filterClass}>
            <option value="">Tous les pays</option>
            {countryOptions.map((c) => <option key={c} value={c}>{c}</option>)}
          </select>
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
          <button type="button" onClick={() => setSheetOpen(true)} className="min-h-11 rounded-lg border border-ocre px-4 py-2 font-display text-ocre hover:bg-ocre/10">
            Fiche fournisseur
          </button>
        </div>
      </div>

      {error && <p className="no-print rounded-lg border border-terracotta/50 bg-terracotta/10 px-4 py-3 text-sm text-terracotta">{error}</p>}

      {loading ? (
        <p className="text-ink-muted">Chargement…</p>
      ) : filtered.length === 0 ? (
        <p className="text-ink-muted">Aucune importation.</p>
      ) : (
        <>
          <div className="mb-1 flex flex-wrap gap-4 rounded-lg border border-border bg-bg-soft px-4 py-3">
            {totalsByCountry.map((t) => (
              <div key={t.country}>
                <p className="text-xs text-ink-muted">{t.country}</p>
                <p className="font-display text-lg text-ocre">{formatEUR(t.montant)} €</p>
              </div>
            ))}
            <div>
              <p className="text-xs text-ink-muted">Total général</p>
              <p className="font-display text-lg text-ink">{formatEUR(totalGeneral)} €</p>
            </div>
          </div>

          <div className="overflow-x-auto rounded-lg border border-border">
            <table className="w-full min-w-[1200px] border-collapse text-[11px] sm:text-sm">
              <thead>
                <tr className="border-b border-border bg-bg-soft text-left text-ink-muted">
                  <Th>Date</Th>
                  <Th>Heure</Th>
                  <Th>Pays</Th>
                  <Th>Produit</Th>
                  <Th>Position tarifaire</Th>
                  <Th>Qté</Th>
                  <Th>Prix U. (€)</Th>
                  <Th>Montant (€)</Th>
                  <Th>Facture</Th>
                  <Th>Fournisseur</Th>
                  <Th>Saisi par</Th>
                  <Th className="no-print">Actions</Th>
                </tr>
              </thead>
              <tbody>
                {filtered.map((r) =>
                  editingId === r.id ? (
                    <EditRow key={r.id} draft={editDraft} onChange={setEditDraft} onSave={saveEdit} onCancel={cancelEdit} />
                  ) : (
                    <tr key={r.id} className="border-b border-border last:border-0">
                      <Td>{r.entry_date}</Td>
                      <Td>{fmtTime(r.entry_time)}</Td>
                      <Td>{r.country_name_fr}</Td>
                      <Td className="max-w-[220px] truncate" title={r.product_designation}>{r.product_designation}</Td>
                      <Td>{r.position_tarifaire ?? '—'}</Td>
                      <Td className="text-right">{formatQty(r.quantite)}</Td>
                      <Td className="text-right">{formatEUR(r.prix_unitaire)}</Td>
                      <Td className="text-right font-medium text-ocre">{formatEUR(r.montant)}</Td>
                      <Td>{r.numero_facture ?? '—'}</Td>
                      <Td>{r.fournisseur ?? '—'}</Td>
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

      <PrintSelectionModal open={printOpen} onClose={() => setPrintOpen(false)} {...buildPrintConfig()} />

      <EntitySheetModal
        open={sheetOpen}
        onClose={() => setSheetOpen(false)}
        modalTitle="Fiche fournisseur — PPI"
        nameLabel="Fournisseur"
        nameOptions={() => fournisseurOptions}
        onGenerate={(_typeId, name, startDate, endDate) => buildPpiFournisseurSheet(all, name, startDate, endDate)}
        excelSheetName="Fiche fournisseur PPI"
      />
    </div>
  )
}

function EditRow({ draft, onChange, onSave, onCancel }) {
  function set(field, value) {
    onChange({ ...draft, [field]: value })
  }
  return (
    <tr className="border-b border-border bg-bg-soft last:border-0">
      <Td>
        <input type="date" value={draft.entry_date} onChange={(e) => set('entry_date', e.target.value)} className={editInputClass} />
      </Td>
      <Td>{fmtTime(draft.entry_time)}</Td>
      <Td>{draft.country_name_fr}</Td>
      <Td className="max-w-[200px] truncate" title={draft.product_designation}>{draft.product_designation}</Td>
      <Td>{draft.position_tarifaire ?? '—'}</Td>
      <Td className="text-right">{formatQty(draft.quantite)}</Td>
      <Td className="text-right">{formatEUR(draft.prix_unitaire)}</Td>
      <Td className="text-right font-medium text-ocre">{formatEUR(draft.montant)}</Td>
      <Td>
        <input type="text" value={draft.numero_facture ?? ''} onChange={(e) => set('numero_facture', e.target.value)} className={editInputClass} />
      </Td>
      <Td>
        <input type="text" value={draft.fournisseur ?? ''} onChange={(e) => set('fournisseur', e.target.value)} className={editInputClass} />
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
    return [payload.new, ...current].sort((a, b) =>
      a.entry_date < b.entry_date ? 1 : a.entry_date > b.entry_date ? -1 : a.created_at < b.created_at ? 1 : -1
    )
  }
  if (payload.eventType === 'UPDATE') return current.map((r) => (r.id === payload.new.id ? payload.new : r))
  if (payload.eventType === 'DELETE') return current.filter((r) => r.id !== payload.old.id)
  return current
}

const filterClass =
  'min-h-11 rounded-lg border border-border bg-bg-soft px-3 py-2 text-ink outline-none focus:border-terracotta'
const editInputClass =
  'min-w-24 rounded border border-border bg-bg px-2 py-1 text-ink outline-none focus:border-terracotta'
