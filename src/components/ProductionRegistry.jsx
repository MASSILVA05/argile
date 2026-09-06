import { useEffect, useMemo, useState } from 'react'
import { supabase } from '../lib/supabase'
import { useAuth } from '../lib/auth'
import { isLocked, LOCK_MESSAGE } from '../lib/lock'
import { formatDateTime } from '../lib/dateFormat'
import { buildExportFilename } from '../lib/exportFilters'
import PrintSelectionModal from './PrintSelectionModal'
import { downloadProductionExcel } from '../lib/productionExcel'
import {
  EQUIPES,
  POSTES,
  PRODUITS,
  EDIT_GROUPS,
  buildProductionPayload,
  computeTauxCasse,
  formatInt,
  formatNum,
  formatPercent,
  posteLabel,
} from '../lib/production'
import RowActions from './RowActions'
import AdminCodeModal from './AdminCodeModal'

const fmtTime = (v) => (v ? v.slice(0, 5) : '—')

export default function ProductionRegistry() {
  const { isAdmin } = useAuth()
  const [all, setAll] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [printOpen, setPrintOpen] = useState(false)
  const [dateFilter, setDateFilter] = useState('')
  const [equipeFilter, setEquipeFilter] = useState('')
  const [posteFilter, setPosteFilter] = useState('')
  const [produitFilter, setProduitFilter] = useState('')
  const [editEntry, setEditEntry] = useState(null)
  const [editAdminCode, setEditAdminCode] = useState(null)
  const [adminPrompt, setAdminPrompt] = useState(null)
  const [adminCodeValue, setAdminCodeValue] = useState('')
  const [adminError, setAdminError] = useState('')
  const [adminBusy, setAdminBusy] = useState(false)
  const [exporting, setExporting] = useState(false)

  useEffect(() => {
    let active = true
    async function load() {
      setLoading(true)
      const { data, error: fetchError } = await supabase
        .from('production_entries')
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
      .channel('production-registry')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'production_entries' }, (payload) => {
        setAll((current) => applyRealtime(current, payload))
      })
      .subscribe()
    return () => {
      active = false
      supabase.removeChannel(channel)
    }
  }, [])

  const filtered = useMemo(() => {
    return all.filter((e) => {
      if (dateFilter && e.entry_date !== dateFilter) return false
      if (equipeFilter && e.equipe !== equipeFilter) return false
      if (posteFilter && e.poste !== posteFilter) return false
      if (produitFilter && e.produit !== produitFilter) return false
      return true
    })
  }, [all, dateFilter, equipeFilter, posteFilter, produitFilter])

  const totals = useMemo(() => {
    const sum = (k) => filtered.reduce((s, e) => s + (Number(e[k]) || 0), 0)
    const conformes = sum('defourn_conformes')
    const cassees = sum('defourn_cassees')
    const fissurees = sum('defourn_fissurees')
    return {
      pieces: sum('presse_total_pieces'),
      conformes,
      rebuts: sum('presse_rebutes') + sum('sechoir_rebutes') + cassees + fissurees,
      gaz: sum('four_gaz'),
      taux: computeTauxCasse(conformes, cassees, fissurees),
    }
  }, [filtered])

  function buildPrintConfig() {
    const parts = []
    if (dateFilter) parts.push(`Date : ${dateFilter}`)
    if (equipeFilter) parts.push(`Équipe : ${equipeFilter}`)
    if (posteFilter) parts.push(`Poste : ${posteLabel(posteFilter)}`)
    if (produitFilter) parts.push(`Produit : ${produitFilter}`)
    return {
      subtitle: 'Registre de production — Briqueterie',
      orientation: 'landscape',
      filters: parts.join(' — '),
      columns: [
        { key: 'entry_date', label: 'Date' },
        { key: 'entry_time', label: 'Heure', format: fmtTime },
        { key: 'equipe', label: 'Équipe' },
        { key: 'poste', label: 'Poste', format: posteLabel },
        { key: 'operateur', label: 'Opérateur' },
        { key: 'produit', label: 'Produit' },
        { key: 'presse_chariots', label: 'Presse chariots', align: 'right', format: formatInt },
        { key: 'presse_total_pieces', label: 'Pièces pressées', align: 'right', format: formatInt },
        { key: 'sechoir_sortis', label: 'Séchoir sortis', align: 'right', format: formatInt },
        { key: 'four_defournes', label: 'Four défournés', align: 'right', format: formatInt },
        { key: 'defourn_conformes', label: 'Conformes', align: 'right', format: formatInt },
        { key: 'defourn_cassees', label: 'Cassées', align: 'right', format: formatInt },
        { key: 'defourn_fissurees', label: 'Fissurées', align: 'right', format: formatInt },
        { key: 'taux_casse', label: 'Taux casse', align: 'right' },
        { key: 'four_gaz', label: 'Gaz (m³)', align: 'right', format: formatNum },
        { key: 'emballage_paquets', label: 'Paquets', align: 'right', format: formatInt },
        { key: 'emballage_palettes', label: 'Palettes', align: 'right', format: formatInt },
        { key: 'emballage_stock_final', label: 'Stock final', align: 'right', format: formatInt },
      ],
      rows: filtered.map((e) => ({
        ...e,
        taux_casse: formatPercent(computeTauxCasse(e.defourn_conformes, e.defourn_cassees, e.defourn_fissurees)),
      })),
      totals: [
        {
          entry_date: 'TOTAUX',
          presse_total_pieces: totals.pieces,
          defourn_conformes: totals.conformes,
          four_gaz: totals.gaz,
          taux_casse: formatPercent(totals.taux),
        },
      ],
    }
  }

  async function handleExport() {
    setExporting(true)
    try {
      await downloadProductionExcel(filtered, {
        filename: buildExportFilename('Production', dateFilter || '', dateFilter || ''),
      })
    } catch (err) {
      setError(`Erreur export : ${err.message}`)
    } finally {
      setExporting(false)
    }
  }

  function openEdit(entry) {
    setEditEntry(entry)
    setEditAdminCode(null)
  }

  async function saveEdit(draft) {
    const payload = buildProductionPayload(draft)
    const usingAdmin = editAdminCode != null
    const { data, error: updateError } = usingAdmin
      ? await supabase.rpc('admin_update_production', {
          p_id: editEntry.id,
          p_admin_code: editAdminCode,
          p: payload,
        })
      : await supabase.from('production_entries').update(payload).eq('id', editEntry.id).select().single()
    if (updateError) {
      setError(`Erreur de mise à jour : ${updateError.message}`)
      return
    }
    const row = Array.isArray(data) ? data[0] : data
    setAll((current) => current.map((e) => (e.id === row.id ? row : e)))
    setEditEntry(null)
    setEditAdminCode(null)
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
      const code = adminCodeValue
      closeAdminPrompt()
      setEditEntry(entry)
      setEditAdminCode(code)
      return
    }
    setAdminBusy(true)
    const { error: rpcError } = await supabase.rpc('admin_delete_production', {
      p_id: adminPrompt.entry.id,
      p_admin_code: adminCodeValue,
    })
    setAdminBusy(false)
    if (rpcError) {
      setAdminError(`Erreur : ${rpcError.message}`)
      return
    }
    setAll((current) => current.filter((e) => e.id !== adminPrompt.entry.id))
    closeAdminPrompt()
  }

  async function handleDelete(entry) {
    if (isLocked(entry)) {
      setError(LOCK_MESSAGE)
      return
    }
    if (!window.confirm(`Supprimer la saisie du ${entry.entry_date} (équipe ${entry.equipe}, poste ${entry.poste}) ?`)) return
    const { error: deleteError } = await supabase.from('production_entries').delete().eq('id', entry.id)
    if (deleteError) {
      setError(`Erreur de suppression : ${deleteError.message}`)
      return
    }
    setAll((current) => current.filter((e) => e.id !== entry.id))
  }

  return (
    <div className="flex flex-col gap-4">
      <div className="no-print flex flex-col gap-3">
        <div className="flex flex-col gap-3 sm:flex-row sm:flex-wrap">
          <input type="date" value={dateFilter} onChange={(e) => setDateFilter(e.target.value)} className={filterClass} />
          <select value={equipeFilter} onChange={(e) => setEquipeFilter(e.target.value)} className={filterClass}>
            <option value="">Toutes équipes</option>
            {EQUIPES.map((x) => <option key={x} value={x}>Équipe {x}</option>)}
          </select>
          <select value={posteFilter} onChange={(e) => setPosteFilter(e.target.value)} className={filterClass}>
            <option value="">Tous postes</option>
            {POSTES.map((p) => <option key={p.value} value={p.value}>{p.label}</option>)}
          </select>
          <select value={produitFilter} onChange={(e) => setProduitFilter(e.target.value)} className={filterClass}>
            <option value="">Tous produits</option>
            {PRODUITS.map((x) => <option key={x} value={x}>{x}</option>)}
          </select>
        </div>
        <div className="flex flex-wrap gap-2">
          <button type="button" onClick={() => setPrintOpen(true)} className="min-h-11 rounded-lg border border-border px-4 py-2 font-display text-ink-muted hover:border-ink-muted">
            Imprimer
          </button>
          <PrintSelectionModal open={printOpen} onClose={() => setPrintOpen(false)} {...buildPrintConfig()} />
          <button type="button" onClick={handleExport} disabled={exporting} className="min-h-11 rounded-lg border border-ocre px-4 py-2 font-display text-ocre hover:bg-ocre/10 disabled:opacity-50">
            {exporting ? 'Génération…' : 'Exporter Excel'}
          </button>
        </div>
      </div>

      {error && <p className="no-print rounded-lg border border-terracotta/50 bg-terracotta/10 px-4 py-3 text-sm text-terracotta">{error}</p>}

      {loading ? (
        <p className="text-ink-muted">Chargement…</p>
      ) : filtered.length === 0 ? (
        <p className="text-ink-muted">Aucune saisie de production.</p>
      ) : (
        <>
          <div className="mb-1 flex flex-wrap gap-4 rounded-lg border border-border bg-bg-soft px-4 py-3">
            <Total label="Pièces pressées" value={formatInt(totals.pieces)} />
            <Total label="Pièces conformes" value={formatInt(totals.conformes)} />
            <Total label="Rebuts" value={formatInt(totals.rebuts)} className="text-terracotta" />
            <Total label="Taux de casse" value={formatPercent(totals.taux)} className={totals.taux >= 5 ? 'text-terracotta' : 'text-ocre'} />
            <Total label="Gaz (m³)" value={formatNum(totals.gaz)} />
          </div>

          <div className="overflow-x-auto rounded-lg border border-border">
            <table className="w-full min-w-[1400px] border-collapse text-[11px] sm:text-sm">
              <thead>
                <tr className="border-b border-border bg-bg-soft text-left text-ink-muted">
                  <Th>Date</Th>
                  <Th>Heure</Th>
                  <Th>Saisie le</Th>
                  <Th>Équipe</Th>
                  <Th>Poste</Th>
                  <Th>Opérateur</Th>
                  <Th>Produit</Th>
                  <Th>Presse chariots</Th>
                  <Th>Pièces pressées</Th>
                  <Th>Séchoir E/S</Th>
                  <Th>Four E/D</Th>
                  <Th>Conformes</Th>
                  <Th>Cassées</Th>
                  <Th>Fissurées</Th>
                  <Th>Taux casse</Th>
                  <Th>Gaz m³</Th>
                  <Th>Paquets</Th>
                  <Th>Palettes</Th>
                  <Th>Stock final</Th>
                  <Th>Saisi par</Th>
                  <Th className="no-print">Actions</Th>
                </tr>
              </thead>
              <tbody>
                {filtered.map((e) => {
                  const taux = computeTauxCasse(e.defourn_conformes, e.defourn_cassees, e.defourn_fissurees)
                  return (
                    <tr key={e.id} className="border-b border-border last:border-0">
                      <Td>{e.entry_date}</Td>
                      <Td>{fmtTime(e.entry_time)}</Td>
                      <Td>{formatDateTime(e.created_at)}</Td>
                      <Td>{e.equipe}</Td>
                      <Td>{posteLabel(e.poste)}</Td>
                      <Td>{e.operateur ?? '—'}</Td>
                      <Td>{e.produit}</Td>
                      <Td className="text-right">{formatInt(e.presse_chariots)}</Td>
                      <Td className="text-right font-medium text-ocre">{formatInt(e.presse_total_pieces)}</Td>
                      <Td className="text-right">{formatInt(e.sechoir_entres)}/{formatInt(e.sechoir_sortis)}</Td>
                      <Td className="text-right">{formatInt(e.four_enfournes)}/{formatInt(e.four_defournes)}</Td>
                      <Td className="text-right">{formatInt(e.defourn_conformes)}</Td>
                      <Td className="text-right">{formatInt(e.defourn_cassees)}</Td>
                      <Td className="text-right">{formatInt(e.defourn_fissurees)}</Td>
                      <Td className={`text-right ${taux >= 5 ? 'text-terracotta' : ''}`}>{formatPercent(taux)}</Td>
                      <Td className="text-right">{formatNum(e.four_gaz)}</Td>
                      <Td className="text-right">{formatInt(e.emballage_paquets)}</Td>
                      <Td className="text-right">{formatInt(e.emballage_palettes)}</Td>
                      <Td className="text-right">{formatInt(e.emballage_stock_final)}</Td>
                      <Td>{e.entered_by_user ?? '—'}</Td>
                      <Td className="no-print">
                        <RowActions
                          entry={e}
                          onEdit={() => openEdit(e)}
                          onDelete={() => handleDelete(e)}
                          onLockedAttempt={(action) => openAdminPrompt(action, e)}
                        />
                      </Td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        </>
      )}

      {editEntry && (
        <ProductionEditModal
          entry={editEntry}
          adminMode={editAdminCode != null}
          onSave={saveEdit}
          onCancel={() => {
            setEditEntry(null)
            setEditAdminCode(null)
          }}
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
    </div>
  )
}

function ProductionEditModal({ entry, adminMode, onSave, onCancel }) {
  const [draft, setDraft] = useState(() => {
    const d = { ...entry }
    for (const k of Object.keys(d)) if (d[k] == null) d[k] = ''
    return d
  })
  const [busy, setBusy] = useState(false)
  function set(key, value) {
    setDraft((d) => ({ ...d, [key]: value }))
  }
  async function submit() {
    setBusy(true)
    await onSave(draft)
    setBusy(false)
  }
  return (
    <div className="fixed inset-0 z-50 bg-black/70 sm:flex sm:items-center sm:justify-center sm:p-4" onClick={onCancel}>
      <div
        className="flex h-full w-full flex-col overflow-y-auto bg-bg-card p-5 sm:h-auto sm:max-h-[90vh] sm:w-full sm:max-w-3xl sm:rounded-xl sm:border sm:border-border"
        onClick={(ev) => ev.stopPropagation()}
      >
        <h2 className="mb-1 font-display text-lg text-ink">
          Modifier la saisie du {entry.entry_date}
          {adminMode && <span className="ml-2 text-sm text-ocre">(code admin)</span>}
        </h2>
        <div className="flex flex-col gap-4 py-3">
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
            <L label="Date"><input type="date" value={draft.entry_date} onChange={(e) => set('entry_date', e.target.value)} className={ic} /></L>
            <L label="Équipe">
              <select value={draft.equipe} onChange={(e) => set('equipe', e.target.value)} className={ic}>
                {EQUIPES.map((x) => <option key={x} value={x}>{x}</option>)}
              </select>
            </L>
            <L label="Poste">
              <select value={draft.poste} onChange={(e) => set('poste', e.target.value)} className={ic}>
                {POSTES.map((p) => <option key={p.value} value={p.value}>{p.label}</option>)}
              </select>
            </L>
            <L label="Opérateur"><input type="text" value={draft.operateur} onChange={(e) => set('operateur', e.target.value)} className={ic} /></L>
            <L label="Produit">
              <select value={draft.produit} onChange={(e) => set('produit', e.target.value)} className={ic}>
                {PRODUITS.map((x) => <option key={x} value={x}>{x}</option>)}
              </select>
            </L>
          </div>
          {EDIT_GROUPS.map((g) => (
            <fieldset key={g.id} className="rounded-lg border border-border p-3">
              <legend className="px-1 text-sm text-ink-muted">{g.label}</legend>
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
                {g.fields.map((f) => (
                  <L key={f.key} label={f.label}>
                    <input
                      type={f.type === 'text' ? 'text' : 'number'}
                      step={f.type === 'num' ? '0.01' : f.type === 'int' ? '1' : undefined}
                      value={draft[f.key]}
                      onChange={(e) => set(f.key, e.target.value)}
                      className={ic}
                    />
                  </L>
                ))}
              </div>
            </fieldset>
          ))}
        </div>
        <div className="mt-auto flex justify-end gap-2 pt-3">
          <button type="button" onClick={onCancel} className="min-h-11 rounded-lg border border-border px-3 py-2 text-sm text-ink-muted">
            Annuler
          </button>
          <button type="button" onClick={submit} disabled={busy} className="min-h-11 rounded-lg bg-terracotta px-3 py-2 text-sm font-display text-ink hover:bg-terracotta-hover disabled:opacity-50">
            {busy ? 'Enregistrement…' : 'Enregistrer'}
          </button>
        </div>
      </div>
    </div>
  )
}

function L({ label, children }) {
  return (
    <label className="flex flex-col gap-1.5">
      <span className="text-sm text-ink-muted">{label}</span>
      {children}
    </label>
  )
}

function Total({ label, value, className = 'text-ink' }) {
  return (
    <div>
      <p className="text-xs text-ink-muted">{label}</p>
      <p className={`font-display text-lg ${className}`}>{value}</p>
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
    if (current.some((e) => e.id === payload.new.id)) return current
    return [payload.new, ...current].sort((a, b) =>
      a.entry_date < b.entry_date ? 1 : a.entry_date > b.entry_date ? -1 : a.created_at < b.created_at ? 1 : -1
    )
  }
  if (payload.eventType === 'UPDATE') return current.map((e) => (e.id === payload.new.id ? payload.new : e))
  if (payload.eventType === 'DELETE') return current.filter((e) => e.id !== payload.old.id)
  return current
}

const filterClass =
  'min-h-11 rounded-lg border border-border bg-bg-soft px-3 py-2 text-ink outline-none focus:border-terracotta'
const ic =
  'min-h-11 w-full rounded-lg border border-border bg-bg-soft px-3 py-2 text-ink outline-none focus:border-terracotta'
