import { useEffect, useMemo, useState } from 'react'
import { supabase } from '../lib/supabase'
import { useAuth } from '../lib/auth'
import { isLocked, LOCK_MESSAGE } from '../lib/lock'
import { formatDateTime } from '../lib/dateFormat'
import { applyExportFilters, buildExportFilename } from '../lib/exportFilters'
import {
  RESIDENCES,
  RESERVATION_STATUTS,
  RESA_PAYMENT_MODES,
  formatDA,
  buildResidenceClientSheet,
} from '../lib/residence'
import { downloadResidenceReservationsExcel } from '../lib/residenceExcel'
import RowActions from './RowActions'
import AdminCodeModal from './AdminCodeModal'
import ExportFilterModal from './ExportFilterModal'
import EntitySheetModal from './EntitySheetModal'
import PrintSelectionModal from './PrintSelectionModal'

const STATUT_BADGE = {
  'En attente': 'border-ocre/60 bg-ocre/10 text-ocre',
  Confirmée: 'border-green-500/50 bg-green-500/10 text-green-500',
  'En cours': 'border-terracotta/60 bg-terracotta/10 text-terracotta',
  Terminée: 'border-border bg-bg-soft text-ink-muted',
  Annulée: 'border-border bg-bg-soft text-ink-muted line-through',
}

function applyRealtime(current, payload) {
  if (payload.eventType === 'INSERT') {
    if (current.some((e) => e.id === payload.new.id)) return current
    return [payload.new, ...current].sort((a, b) => (a.created_at < b.created_at ? 1 : -1))
  }
  if (payload.eventType === 'UPDATE') return current.map((e) => (e.id === payload.new.id ? payload.new : e))
  if (payload.eventType === 'DELETE') return current.filter((e) => e.id !== payload.old.id)
  return current
}

export default function ResidenceReservationsRegistry() {
  const { isAdmin } = useAuth()
  const [rows, setRows] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [query, setQuery] = useState('')
  const [residenceFilter, setResidenceFilter] = useState('')
  const [statutFilter, setStatutFilter] = useState('')
  const [dateFilter, setDateFilter] = useState('')
  const [editingId, setEditingId] = useState(null)
  const [editDraft, setEditDraft] = useState(null)
  const [editAdminCode, setEditAdminCode] = useState(null)
  const [adminPrompt, setAdminPrompt] = useState(null)
  const [adminCodeValue, setAdminCodeValue] = useState('')
  const [adminError, setAdminError] = useState('')
  const [adminBusy, setAdminBusy] = useState(false)
  const [lightboxUrl, setLightboxUrl] = useState(null)
  const [printOpen, setPrintOpen] = useState(false)
  const [exportModalOpen, setExportModalOpen] = useState(false)
  const [exportError, setExportError] = useState('')
  const [exportProgress, setExportProgress] = useState(null)
  const [sheetOpen, setSheetOpen] = useState(false)

  useEffect(() => {
    let active = true
    async function load() {
      setLoading(true)
      const { data, error: fetchError } = await supabase
        .from('residence_reservations')
        .select('*')
        .order('created_at', { ascending: false })
      if (!active) return
      if (fetchError) setError(`Erreur de chargement : ${fetchError.message}`)
      else {
        setRows(data ?? [])
        setError('')
      }
      setLoading(false)
    }
    load()
    const channel = supabase
      .channel('residence-reservations-registry')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'residence_reservations' }, (payload) => {
        setRows((current) => applyRealtime(current, payload))
      })
      .subscribe()
    return () => {
      active = false
      supabase.removeChannel(channel)
    }
  }, [])

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase()
    return rows.filter((r) => {
      if (residenceFilter && r.residence !== residenceFilter) return false
      if (statutFilter && r.statut !== statutFilter) return false
      if (dateFilter && !(r.date_arrivee <= dateFilter && r.date_depart > dateFilter)) return false
      if (!q) return true
      return [r.unit_nom, r.unit_code, r.client_name, r.client_phone].some((f) =>
        String(f ?? '').toLowerCase().includes(q)
      )
    })
  }, [rows, query, residenceFilter, statutFilter, dateFilter])

  const totals = useMemo(() => {
    const active = filtered.filter((r) => r.statut !== 'Annulée')
    return {
      montant: active.reduce((s, r) => s + (Number(r.montant_total) || 0), 0),
      arrhes: active.reduce((s, r) => s + (Number(r.arrhes) || 0), 0),
      reste: active.reduce((s, r) => s + (Number(r.reste_a_payer) || 0), 0),
    }
  }, [filtered])

  function buildPrintConfig() {
    const parts = []
    if (query.trim()) parts.push(`Recherche : "${query.trim()}"`)
    if (residenceFilter) parts.push(`Résidence : ${residenceFilter}`)
    if (statutFilter) parts.push(`Statut : ${statutFilter}`)
    if (dateFilter) parts.push(`Date : ${dateFilter}`)
    return {
      subtitle: 'Registre des réservations — Résidence',
      orientation: 'landscape',
      filters: parts.join(' — '),
      columns: [
        { key: 'unit_nom', label: 'Logement' },
        { key: 'residence', label: 'Résidence' },
        { key: 'client_name', label: 'Client' },
        { key: 'client_phone', label: 'Tél' },
        { key: 'nb_personnes', label: 'Pers.', align: 'right' },
        { key: 'date_arrivee', label: 'Arrivée' },
        { key: 'date_depart', label: 'Départ' },
        { key: 'nb_nuits', label: 'Nuits', align: 'right' },
        { key: 'prix_nuit', label: 'Prix/nuit', align: 'right', format: (v) => formatDA(v) },
        { key: 'montant_total', label: 'Total (DA)', align: 'right', format: (v) => formatDA(v) },
        { key: 'arrhes', label: 'Arrhes (DA)', align: 'right', format: (v) => formatDA(v) },
        { key: 'reste_a_payer', label: 'Reste (DA)', align: 'right', format: (v) => formatDA(v) },
        { key: 'payment_mode', label: 'Paiement' },
        { key: 'statut', label: 'Statut' },
        { key: 'entered_by_user', label: 'Saisi par' },
      ],
      rows: filtered,
      totals: [
        { unit_nom: 'TOTAUX', montant_total: totals.montant, arrhes: totals.arrhes, reste_a_payer: totals.reste },
      ],
    }
  }

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
    const payload = {
      unit_code: editDraft.unit_code,
      unit_nom: editDraft.unit_nom,
      residence: editDraft.residence,
      client_name: editDraft.client_name?.trim() || '',
      client_phone: editDraft.client_phone?.trim() || null,
      nb_personnes: Number(editDraft.nb_personnes),
      date_arrivee: editDraft.date_arrivee,
      date_depart: editDraft.date_depart,
      prix_nuit: Number(editDraft.prix_nuit),
      arrhes: Number(editDraft.arrhes) || 0,
      payment_mode: editDraft.payment_mode,
      statut: editDraft.statut,
      observations: editDraft.observations?.trim() || null,
    }
    const { data, error: updateError } = usingAdminCode
      ? await supabase.rpc('admin_update_residence_reservation', { p_id: editingId, p_admin_code: editAdminCode, p: payload })
      : await supabase.from('residence_reservations').update(payload).eq('id', editingId).select().single()
    if (updateError) {
      setError(`Erreur de mise à jour : ${updateError.message}`)
      return
    }
    const row = Array.isArray(data) ? data[0] : data
    setRows((current) => current.map((e) => (e.id === row.id ? row : e)))
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
    const { error: rpcError } = await supabase.rpc('admin_delete_residence_reservation', {
      p_id: adminPrompt.entry.id,
      p_admin_code: adminCodeValue,
    })
    setAdminBusy(false)
    if (rpcError) {
      setAdminError(`Erreur : ${rpcError.message}`)
      return
    }
    setRows((current) => current.filter((e) => e.id !== adminPrompt.entry.id))
    closeAdminPrompt()
  }

  async function handleDelete(entry) {
    if (isLocked(entry)) {
      setError(LOCK_MESSAGE)
      return
    }
    if (!window.confirm(`Supprimer la réservation « ${entry.unit_nom} » de ${entry.client_name} ?`)) return
    const { error: deleteError } = await supabase.from('residence_reservations').delete().eq('id', entry.id)
    if (deleteError) {
      setError(`Erreur de suppression : ${deleteError.message}`)
      return
    }
    setRows((current) => current.filter((e) => e.id !== entry.id))
  }

  async function handleExport(filters) {
    const toExport = applyExportFilters(rows, {
      ...filters,
      dateField: 'date_arrivee',
      categoricalField: 'statut',
    })
    if (toExport.length === 0) {
      setExportError('Aucune donnée pour ces critères')
      return
    }
    setExportError('')
    setExportModalOpen(false)
    setExportProgress({ current: 0, total: 0 })
    try {
      await downloadResidenceReservationsExcel(toExport, {
        includePhotos: false,
        filename: buildExportFilename('Reservations_Residence', filters.startDate, filters.endDate),
        onProgress: (current, total) => setExportProgress({ current, total }),
      })
    } catch (err) {
      setError(`Erreur lors de la génération du fichier Excel : ${err.message}`)
    } finally {
      setExportProgress(null)
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
            placeholder="Rechercher : logement, client, téléphone…"
            className="min-h-11 rounded-lg border border-border bg-bg-soft px-3 py-2 text-ink placeholder:text-ink-muted/60 outline-none focus:border-terracotta sm:flex-1"
          />
          <select value={residenceFilter} onChange={(e) => setResidenceFilter(e.target.value)} className={filterClass}>
            <option value="">Toutes résidences</option>
            {RESIDENCES.map((r) => <option key={r} value={r}>{r}</option>)}
          </select>
          <select value={statutFilter} onChange={(e) => setStatutFilter(e.target.value)} className={filterClass}>
            <option value="">Tous statuts</option>
            {RESERVATION_STATUTS.map((s) => <option key={s} value={s}>{s}</option>)}
          </select>
          <input type="date" value={dateFilter} onChange={(e) => setDateFilter(e.target.value)} className={filterClass} title="Réservations couvrant cette date" />
        </div>

        <div className="flex flex-wrap gap-2">
          <button type="button" onClick={() => setPrintOpen(true)} className="min-h-11 rounded-lg border border-border px-4 py-2 font-display text-ink-muted hover:border-ink-muted">
            Imprimer
          </button>
          <PrintSelectionModal open={printOpen} onClose={() => setPrintOpen(false)} {...buildPrintConfig()} />
          <button
            type="button"
            onClick={() => { setExportError(''); setExportModalOpen(true) }}
            disabled={exportProgress != null}
            className="min-h-11 rounded-lg border border-ocre px-4 py-2 font-display text-ocre hover:bg-ocre/10 disabled:opacity-50"
          >
            {exportProgress != null ? 'Génération…' : 'Exporter Excel'}
          </button>
          <button type="button" onClick={() => setSheetOpen(true)} className="min-h-11 rounded-lg border border-ocre px-4 py-2 font-display text-ocre hover:bg-ocre/10">
            Fiche client
          </button>
        </div>
      </div>

      {error && <p className="no-print rounded-lg border border-terracotta/50 bg-terracotta/10 px-4 py-3 text-sm text-terracotta">{error}</p>}

      {loading ? (
        <p className="text-ink-muted">Chargement…</p>
      ) : filtered.length === 0 ? (
        <p className="text-ink-muted">Aucune réservation.</p>
      ) : (
        <>
          <div className="mb-1 flex flex-wrap gap-4 rounded-lg border border-border bg-bg-soft px-4 py-3">
            <Total label="Total réservations" value={totals.montant} />
            <Total label="Total arrhes" value={totals.arrhes} className="text-green-500" />
            <Total label="Reste à encaisser" value={totals.reste} className={totals.reste > 0 ? 'text-terracotta' : 'text-green-500'} />
          </div>

          <div className="overflow-x-auto rounded-lg border border-border">
            <table className="w-full min-w-[1400px] border-collapse text-[11px] sm:text-sm">
              <thead>
                <tr className="border-b border-border bg-bg-soft text-left text-ink-muted">
                  <Th>Logement</Th>
                  <Th>Résidence</Th>
                  <Th>Client</Th>
                  <Th>Tél</Th>
                  <Th>Pers.</Th>
                  <Th>Arrivée</Th>
                  <Th>Départ</Th>
                  <Th>Nuits</Th>
                  <Th>Prix/nuit</Th>
                  <Th>Total (DA)</Th>
                  <Th>Arrhes</Th>
                  <Th>Reste</Th>
                  <Th>Paiement</Th>
                  <Th>Statut</Th>
                  <Th className="no-print">Photo</Th>
                  <Th>Saisi par</Th>
                  <Th>Saisie le</Th>
                  <Th className="no-print">Actions</Th>
                </tr>
              </thead>
              <tbody>
                {filtered.map((r) =>
                  editingId === r.id ? (
                    <EditRow key={r.id} draft={editDraft} onChange={setEditDraft} onSave={saveEdit} onCancel={cancelEdit} />
                  ) : (
                    <tr key={r.id} className="border-b border-border last:border-0">
                      <Td className="font-medium text-ink">{r.unit_nom}</Td>
                      <Td>{r.residence}</Td>
                      <Td>{r.client_name}</Td>
                      <Td>{r.client_phone ?? '—'}</Td>
                      <Td className="text-right">{r.nb_personnes}</Td>
                      <Td>{r.date_arrivee}</Td>
                      <Td>{r.date_depart}</Td>
                      <Td className="text-right">{r.nb_nuits}</Td>
                      <Td className="text-right">{formatDA(r.prix_nuit)}</Td>
                      <Td className="text-right font-medium">{formatDA(r.montant_total)}</Td>
                      <Td className="text-right text-green-500">{formatDA(r.arrhes)}</Td>
                      <Td className={`text-right ${Number(r.reste_a_payer) > 0 ? 'text-terracotta' : 'text-ink-muted'}`}>{formatDA(r.reste_a_payer)}</Td>
                      <Td>{r.payment_mode}</Td>
                      <Td>
                        <span className={`inline-block rounded-full border px-2 py-0.5 text-xs ${STATUT_BADGE[r.statut] ?? ''}`}>
                          {r.statut}
                        </span>
                      </Td>
                      <Td className="no-print">
                        {r.photo_url ? (
                          <button type="button" onClick={() => setLightboxUrl(r.photo_url)} className="block">
                            <img src={r.photo_url} alt={r.unit_nom} className="h-10 w-10 rounded object-cover" />
                          </button>
                        ) : '—'}
                      </Td>
                      <Td>{r.entered_by_user ?? '—'}</Td>
                      <Td>{formatDateTime(r.created_at)}</Td>
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

      {lightboxUrl && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 p-4" onClick={() => setLightboxUrl(null)}>
          <img src={lightboxUrl} alt="Bon de réservation" className="max-h-full max-w-full rounded-lg" />
        </div>
      )}

      <ExportFilterModal
        open={exportModalOpen}
        categorical={{ field: 'statut', label: 'Statut', options: RESERVATION_STATUTS }}
        textFilters={[
          { field: 'client_name', label: 'Client', suggestions: [...new Set(rows.map((r) => r.client_name).filter(Boolean))] },
          { field: 'residence', label: 'Résidence', suggestions: RESIDENCES },
        ]}
        hasPhotos={false}
        error={exportError}
        onExport={handleExport}
        onCancel={() => setExportModalOpen(false)}
      />

      <AdminCodeModal
        prompt={adminPrompt}
        codeValue={adminCodeValue}
        onCodeChange={setAdminCodeValue}
        error={adminError}
        busy={adminBusy}
        onConfirm={confirmAdminCode}
        onCancel={closeAdminPrompt}
      />

      <EntitySheetModal
        open={sheetOpen}
        onClose={() => setSheetOpen(false)}
        modalTitle="Fiche client — Résidence"
        nameLabel="Client"
        nameOptions={() => [...new Set(rows.map((r) => r.client_name).filter(Boolean))].sort()}
        onGenerate={(_typeId, name, startDate, endDate) => buildResidenceClientSheet(rows, name, startDate, endDate)}
        excelSheetName="Fiche client résidence"
      />
    </div>
  )
}

function Total({ label, value, className = 'text-ink' }) {
  return (
    <div>
      <p className="text-xs text-ink-muted">{label}</p>
      <p className={`font-display text-lg ${className}`}>{formatDA(value)} DA</p>
    </div>
  )
}

function EditRow({ draft, onChange, onSave, onCancel }) {
  function set(field, value) {
    onChange({ ...draft, [field]: value })
  }
  return (
    <tr className="border-b border-border bg-bg-soft last:border-0">
      <Td><input type="text" value={draft.unit_nom ?? ''} onChange={(e) => set('unit_nom', e.target.value)} className={editInputClass} /></Td>
      <Td>
        <select value={draft.residence} onChange={(e) => set('residence', e.target.value)} className={editInputClass}>
          {RESIDENCES.map((r) => <option key={r} value={r}>{r}</option>)}
        </select>
      </Td>
      <Td><input type="text" value={draft.client_name ?? ''} onChange={(e) => set('client_name', e.target.value)} className={editInputClass} /></Td>
      <Td><input type="text" value={draft.client_phone ?? ''} onChange={(e) => set('client_phone', e.target.value)} className={editInputClass} /></Td>
      <Td><input type="number" value={draft.nb_personnes ?? ''} onChange={(e) => set('nb_personnes', e.target.value)} className={editInputClass} /></Td>
      <Td><input type="date" value={draft.date_arrivee ?? ''} onChange={(e) => set('date_arrivee', e.target.value)} className={editInputClass} /></Td>
      <Td><input type="date" value={draft.date_depart ?? ''} onChange={(e) => set('date_depart', e.target.value)} className={editInputClass} /></Td>
      <Td className="text-right text-ink-muted">—</Td>
      <Td><input type="number" step="0.01" value={draft.prix_nuit ?? ''} onChange={(e) => set('prix_nuit', e.target.value)} className={editInputClass} /></Td>
      <Td className="text-right text-ink-muted">—</Td>
      <Td><input type="number" step="0.01" value={draft.arrhes ?? ''} onChange={(e) => set('arrhes', e.target.value)} className={editInputClass} /></Td>
      <Td className="text-right text-ink-muted">—</Td>
      <Td>
        <select value={draft.payment_mode} onChange={(e) => set('payment_mode', e.target.value)} className={editInputClass}>
          {RESA_PAYMENT_MODES.map((m) => <option key={m} value={m}>{m}</option>)}
        </select>
      </Td>
      <Td>
        <select value={draft.statut} onChange={(e) => set('statut', e.target.value)} className={editInputClass}>
          {RESERVATION_STATUTS.map((s) => <option key={s} value={s}>{s}</option>)}
        </select>
      </Td>
      <Td className="no-print">—</Td>
      <Td>{draft.entered_by_user ?? '—'}</Td>
      <Td>{formatDateTime(draft.created_at)}</Td>
      <Td className="no-print">
        <div className="flex gap-2">
          <button type="button" onClick={onSave} className="rounded border border-ocre px-2 py-1 text-ocre hover:bg-ocre/10">Enregistrer</button>
          <button type="button" onClick={onCancel} className="rounded border border-border px-2 py-1 text-ink-muted hover:border-ink-muted">Annuler</button>
        </div>
      </Td>
    </tr>
  )
}

function Th({ children, className = '' }) {
  return <th className={`px-1 py-1 font-display font-medium whitespace-nowrap sm:px-3 sm:py-2 ${className}`}>{children}</th>
}
function Td({ children, className = '', title }) {
  return <td className={`px-1 py-1 whitespace-nowrap sm:px-3 sm:py-2 ${className}`} title={title}>{children}</td>
}

const filterClass =
  'min-h-11 rounded-lg border border-border bg-bg-soft px-3 py-2 text-ink outline-none focus:border-terracotta'
const editInputClass =
  'min-w-24 rounded border border-border bg-bg px-2 py-1 text-ink outline-none focus:border-terracotta'
