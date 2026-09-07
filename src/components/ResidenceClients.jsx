import { useEffect, useMemo, useState } from 'react'
import { supabase } from '../lib/supabase'
import { useAuth } from '../lib/auth'
import { formatDA, buildResidenceClientSheet } from '../lib/residence'
import { downloadResidenceClientsExcel } from '../lib/residenceExcel'
import EntitySheetModal from './EntitySheetModal'

export default function ResidenceClients() {
  const { isAdmin } = useAuth()
  const [clients, setClients] = useState([])
  const [reservations, setReservations] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [query, setQuery] = useState('')
  const [historyFor, setHistoryFor] = useState(null)
  const [sheetOpen, setSheetOpen] = useState(false)
  const [addOpen, setAddOpen] = useState(false)
  const [exporting, setExporting] = useState(false)

  useEffect(() => {
    let active = true
    async function load() {
      setLoading(true)
      const [{ data: c, error: cErr }, { data: r }] = await Promise.all([
        supabase.from('residence_clients').select('*').order('name'),
        supabase.from('residence_reservations').select('*').order('date_arrivee', { ascending: false }),
      ])
      if (!active) return
      if (cErr) setError(`Erreur de chargement : ${cErr.message}`)
      else {
        setClients(c ?? [])
        setReservations(r ?? [])
        setError('')
      }
      setLoading(false)
    }
    load()
    const channel = supabase
      .channel('residence-clients')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'residence_clients' }, load)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'residence_reservations' }, load)
      .subscribe()
    return () => {
      active = false
      supabase.removeChannel(channel)
    }
  }, [])

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase()
    if (!q) return clients
    return clients.filter((c) => `${c.name} ${c.phone ?? ''}`.toLowerCase().includes(q))
  }, [clients, query])

  async function handleDelete(c) {
    if (!window.confirm(`Supprimer le client « ${c.name} » ? (son historique de réservations est conservé)`)) return
    const { error: rpcError } = isAdmin
      ? await supabase.rpc('admin_delete_residence_client', {
          p_id: c.id,
          p_admin_code: window.prompt('Code administrateur :') ?? '',
        })
      : await supabase.from('residence_clients').delete().eq('id', c.id)
    if (rpcError) {
      setError(`Erreur : ${rpcError.message}`)
      return
    }
    setClients((cur) => cur.filter((x) => x.id !== c.id))
  }

  async function handleExport() {
    setExporting(true)
    try {
      await downloadResidenceClientsExcel(filtered)
    } catch (err) {
      setError(`Erreur export : ${err.message}`)
    } finally {
      setExporting(false)
    }
  }

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-col gap-3 sm:flex-row sm:flex-wrap sm:items-center">
        <input
          type="text"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Rechercher un client…"
          className="min-h-11 rounded-lg border border-border bg-bg-soft px-3 py-2 text-ink placeholder:text-ink-muted/60 outline-none focus:border-terracotta sm:flex-1"
        />
        <button type="button" onClick={() => setAddOpen(true)} className="min-h-11 rounded-lg border border-terracotta px-4 py-2 font-display text-terracotta hover:bg-terracotta/10">
          Ajouter un client
        </button>
        <button type="button" onClick={() => setSheetOpen(true)} className="min-h-11 rounded-lg border border-ocre px-4 py-2 font-display text-ocre hover:bg-ocre/10">
          Fiche client
        </button>
        <button type="button" onClick={handleExport} disabled={exporting} className="min-h-11 rounded-lg border border-ocre px-4 py-2 font-display text-ocre hover:bg-ocre/10 disabled:opacity-50">
          {exporting ? 'Génération…' : 'Exporter Excel'}
        </button>
      </div>

      {error && <p className="rounded-lg border border-terracotta/50 bg-terracotta/10 px-4 py-3 text-sm text-terracotta">{error}</p>}

      {loading ? (
        <p className="text-ink-muted">Chargement…</p>
      ) : filtered.length === 0 ? (
        <p className="text-ink-muted">Aucun client.</p>
      ) : (
        <div className="overflow-x-auto rounded-lg border border-border">
          <table className="w-full min-w-[700px] border-collapse text-[11px] sm:text-sm">
            <thead>
              <tr className="border-b border-border bg-bg-soft text-left text-ink-muted">
                <Th>Nom</Th>
                <Th>Téléphone</Th>
                <Th>Nb séjours</Th>
                <Th>Montant total</Th>
                <Th>Actions</Th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((c) => (
                <tr key={c.id} className="border-b border-border last:border-0">
                  <Td className="font-medium text-ink">
                    <button type="button" onClick={() => setHistoryFor(c)} className="hover:text-terracotta">
                      {c.name}
                    </button>
                  </Td>
                  <Td>{c.phone || '—'}</Td>
                  <Td className="text-right">{c.nb_sejours ?? 0}</Td>
                  <Td className="text-right">{formatDA(c.montant_total)} DA</Td>
                  <Td>
                    <div className="flex gap-1">
                      <button type="button" onClick={() => setHistoryFor(c)} className="rounded border border-ocre px-2 py-1 text-ocre hover:bg-ocre/10">
                        Historique
                      </button>
                      <button type="button" onClick={() => handleDelete(c)} className="rounded border border-terracotta/50 px-2 py-1 text-terracotta hover:bg-terracotta/10">
                        Suppr.
                      </button>
                    </div>
                  </Td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {historyFor && (
        <HistoryModal
          client={historyFor}
          reservations={reservations.filter(
            (r) => String(r.client_name ?? '').toLowerCase() === historyFor.name.toLowerCase()
          )}
          onClose={() => setHistoryFor(null)}
        />
      )}

      {addOpen && (
        <AddClientModal
          onClose={() => setAddOpen(false)}
          onAdded={(c) => setClients((cur) => [...cur, c].sort((a, b) => a.name.localeCompare(b.name)))}
        />
      )}

      <EntitySheetModal
        open={sheetOpen}
        onClose={() => setSheetOpen(false)}
        modalTitle="Fiche client — Résidence"
        nameLabel="Client"
        nameOptions={() => clients.map((c) => c.name)}
        onGenerate={(_typeId, name, startDate, endDate) => buildResidenceClientSheet(reservations, name, startDate, endDate)}
        excelSheetName="Fiche client résidence"
      />
    </div>
  )
}

function HistoryModal({ client, reservations, onClose }) {
  return (
    <div className="fixed inset-0 z-50 overflow-y-auto bg-black/70 p-0 sm:flex sm:items-center sm:justify-center sm:p-4" onClick={onClose}>
      <div className="min-h-full w-full bg-bg-card p-5 sm:my-8 sm:min-h-0 sm:max-w-3xl sm:rounded-xl sm:border sm:border-border" onClick={(e) => e.stopPropagation()}>
        <div className="mb-4 flex items-center justify-between">
          <h2 className="font-display text-lg text-ink">{client.name}</h2>
          <button type="button" onClick={onClose} className="text-sm text-ink-muted hover:text-ink">Fermer ✕</button>
        </div>
        <p className="mb-3 text-sm text-ink-muted">
          {client.phone || 'Sans téléphone'} · {client.nb_sejours ?? 0} séjour(s) · {formatDA(client.montant_total)} DA
        </p>
        {reservations.length === 0 ? (
          <p className="text-ink-muted">Aucune réservation.</p>
        ) : (
          <div className="overflow-x-auto rounded-lg border border-border">
            <table className="w-full min-w-[600px] border-collapse text-[11px] sm:text-sm">
              <thead>
                <tr className="border-b border-border bg-bg-soft text-left text-ink-muted">
                  <Th>Logement</Th>
                  <Th>Arrivée</Th>
                  <Th>Départ</Th>
                  <Th>Nuits</Th>
                  <Th>Montant</Th>
                  <Th>Reste</Th>
                  <Th>Statut</Th>
                </tr>
              </thead>
              <tbody>
                {reservations.map((r) => (
                  <tr key={r.id} className="border-b border-border last:border-0">
                    <Td>{r.unit_nom} <span className="text-ink-muted">({r.residence})</span></Td>
                    <Td>{r.date_arrivee}</Td>
                    <Td>{r.date_depart}</Td>
                    <Td className="text-right">{r.nb_nuits}</Td>
                    <Td className="text-right">{formatDA(r.montant_total)}</Td>
                    <Td className="text-right">{formatDA(r.reste_a_payer)}</Td>
                    <Td>{r.statut}</Td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  )
}

function AddClientModal({ onClose, onAdded }) {
  const [name, setName] = useState('')
  const [phone, setPhone] = useState('')
  const [observations, setObservations] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')

  async function submit() {
    if (!name.trim()) {
      setError('Le nom est obligatoire.')
      return
    }
    setBusy(true)
    setError('')
    const { data, error: insertError } = await supabase
      .from('residence_clients')
      .insert({ name: name.trim(), phone: phone.trim() || null, observations: observations.trim() || null })
      .select()
      .single()
    setBusy(false)
    if (insertError) {
      setError(insertError.code === '23505' ? 'Ce client existe déjà.' : `Erreur : ${insertError.message}`)
      return
    }
    onAdded(data)
    onClose()
  }

  return (
    <div className="fixed inset-0 z-50 bg-black/70 sm:flex sm:items-center sm:justify-center sm:p-4" onClick={onClose}>
      <div className="flex h-full w-full flex-col gap-3 overflow-y-auto bg-bg-card p-5 sm:h-auto sm:w-full sm:max-w-sm sm:rounded-xl sm:border sm:border-border" onClick={(e) => e.stopPropagation()}>
        <h2 className="font-display text-lg text-ink">Ajouter un client</h2>
        <label className="flex flex-col gap-1.5">
          <span className="text-sm text-ink-muted">Nom *</span>
          <input type="text" value={name} onChange={(e) => setName(e.target.value)} className={inputClass} autoFocus />
        </label>
        <label className="flex flex-col gap-1.5">
          <span className="text-sm text-ink-muted">Téléphone</span>
          <input type="tel" value={phone} onChange={(e) => setPhone(e.target.value)} className={inputClass} />
        </label>
        <label className="flex flex-col gap-1.5">
          <span className="text-sm text-ink-muted">Observations</span>
          <input type="text" value={observations} onChange={(e) => setObservations(e.target.value)} className={inputClass} />
        </label>
        {error && <p className="text-sm text-terracotta">{error}</p>}
        <div className="mt-auto flex justify-end gap-2 pt-2">
          <button type="button" onClick={onClose} className="min-h-11 rounded-lg border border-border px-3 py-2 text-sm text-ink-muted">Annuler</button>
          <button type="button" onClick={submit} disabled={busy} className="min-h-11 rounded-lg bg-terracotta px-3 py-2 text-sm font-display text-ink hover:bg-terracotta-hover disabled:opacity-50">
            {busy ? 'Ajout…' : 'Ajouter'}
          </button>
        </div>
      </div>
    </div>
  )
}

function Th({ children }) {
  return <th className="px-1 py-1 font-display font-medium whitespace-nowrap sm:px-3 sm:py-2">{children}</th>
}
function Td({ children, className = '' }) {
  return <td className={`px-1 py-1 whitespace-nowrap sm:px-3 sm:py-2 ${className}`}>{children}</td>
}

const inputClass =
  'min-h-11 w-full rounded-lg border border-border bg-bg-soft px-3 py-2 text-ink placeholder:text-ink-muted/60 outline-none focus:border-terracotta'
