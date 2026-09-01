import { useEffect, useMemo, useState } from 'react'
import { supabase } from '../lib/supabase'
import { getSession, useAuth } from '../lib/auth'
import { notifyMagasinVente } from '../lib/ntfy'
import { formatDA, buildMagasinClientSheet } from '../lib/magasin'
import { downloadMagasinClientsExcel } from '../lib/magasinClientsExcel'
import EntitySheetModal from './EntitySheetModal'

const todayISO = () => new Date().toISOString().slice(0, 10)
const formatHHMM = (date) => date.toTimeString().slice(0, 5)
const PAYMENT_MODES = ['Espèces', 'Chèque', 'Versement']

export default function MagasinCredits() {
  const { isAdmin } = useAuth()
  const [clients, setClients] = useState([])
  const [ventes, setVentes] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [query, setQuery] = useState('')
  const [payFor, setPayFor] = useState(null)
  const [addOpen, setAddOpen] = useState(false)
  const [sheetOpen, setSheetOpen] = useState(false)
  const [exporting, setExporting] = useState(false)

  useEffect(() => {
    let active = true

    async function load() {
      setLoading(true)
      const [{ data: clientRows, error: cErr }, { data: venteRows }] = await Promise.all([
        supabase.from('magasin_clients').select('*').order('name'),
        supabase.from('magasin_ventes').select('*').order('created_at', { ascending: false }),
      ])
      if (!active) return
      if (cErr) setError(`Erreur de chargement : ${cErr.message}`)
      else {
        setClients(clientRows ?? [])
        setVentes(venteRows ?? [])
        setError('')
      }
      setLoading(false)
    }

    load()

    const channel = supabase
      .channel('magasin-credits')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'magasin_clients' }, load)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'magasin_ventes' }, load)
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

  async function handleDeleteClient(c) {
    if (!window.confirm(`Supprimer le client « ${c.name} » ? (son historique de ventes est conservé)`)) return
    const { error: rpcError } = isAdmin
      ? await supabase.rpc('admin_delete_magasin_client', {
          p_id: c.id,
          p_admin_code: window.prompt('Code administrateur :') ?? '',
        })
      : await supabase.from('magasin_clients').delete().eq('id', c.id)
    if (rpcError) {
      setError(`Erreur : ${rpcError.message}`)
      return
    }
    setClients((current) => current.filter((x) => x.id !== c.id))
  }

  async function handleExport() {
    setExporting(true)
    try {
      await downloadMagasinClientsExcel(filtered)
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
        <button
          type="button"
          onClick={() => setAddOpen(true)}
          className="min-h-11 rounded-lg border border-terracotta px-4 py-2 font-display text-terracotta transition-colors hover:bg-terracotta/10"
        >
          Ajouter un client
        </button>
        <button
          type="button"
          onClick={() => setSheetOpen(true)}
          className="min-h-11 rounded-lg border border-ocre px-4 py-2 font-display text-ocre transition-colors hover:bg-ocre/10"
        >
          Fiche client
        </button>
        <button
          type="button"
          onClick={handleExport}
          disabled={exporting}
          className="min-h-11 rounded-lg border border-ocre px-4 py-2 font-display text-ocre transition-colors hover:bg-ocre/10 disabled:opacity-50"
        >
          {exporting ? 'Génération…' : 'Exporter Excel'}
        </button>
      </div>

      {error && (
        <p className="rounded-lg border border-terracotta/50 bg-terracotta/10 px-4 py-3 text-sm text-terracotta">{error}</p>
      )}

      {loading ? (
        <p className="text-ink-muted">Chargement…</p>
      ) : filtered.length === 0 ? (
        <p className="text-ink-muted">Aucun client.</p>
      ) : (
        <div className="overflow-x-auto rounded-lg border border-border">
          <table className="w-full min-w-[900px] border-collapse text-[11px] sm:text-sm">
            <thead>
              <tr className="border-b border-border bg-bg-soft text-left text-ink-muted">
                <Th>Nom</Th>
                <Th>Téléphone</Th>
                <Th>Chiffre affaires</Th>
                <Th>Seuil crédit</Th>
                <Th>Crédit (solde)</Th>
                <Th>Dernière opé.</Th>
                <Th>Actions</Th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((c) => {
                const credit = Number(c.credit) || 0
                return (
                  <tr key={c.id} className="border-b border-border last:border-0">
                    <Td className="font-medium text-ink">{c.name}</Td>
                    <Td>{c.phone || '—'}</Td>
                    <Td className="text-right">{formatDA(c.chiffre_affaires)}</Td>
                    <Td className="text-right">{formatDA(c.seuil_credit)}</Td>
                    <Td
                      className={`text-right font-medium ${
                        credit < 0 ? 'text-terracotta' : credit > 0 ? 'text-green-500' : 'text-ink-muted'
                      }`}
                    >
                      {formatDA(credit)}
                    </Td>
                    <Td>{c.last_operation_date || '—'}</Td>
                    <Td>
                      <div className="flex gap-1">
                        <button
                          type="button"
                          onClick={() => setPayFor(c)}
                          className="rounded border border-ocre px-2 py-1 text-ocre hover:bg-ocre/10"
                        >
                          Paiement
                        </button>
                        <button
                          type="button"
                          onClick={() => handleDeleteClient(c)}
                          className="rounded border border-terracotta/50 px-2 py-1 text-terracotta hover:bg-terracotta/10"
                        >
                          Suppr.
                        </button>
                      </div>
                    </Td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      )}

      {payFor && (
        <PaymentModal
          client={payFor}
          onClose={() => setPayFor(null)}
          onDone={(row) => {
            setPayFor(null)
            notifyMagasinVente(row)
          }}
        />
      )}

      {addOpen && <AddClientModal onClose={() => setAddOpen(false)} onAdded={(c) => setClients((cur) => [...cur, c].sort((a, b) => a.name.localeCompare(b.name)))} />}

      <EntitySheetModal
        open={sheetOpen}
        onClose={() => setSheetOpen(false)}
        modalTitle="Fiche client — Magasin"
        nameLabel="Client"
        nameOptions={() => clients.map((c) => c.name)}
        onGenerate={(_typeId, name, startDate, endDate) => buildMagasinClientSheet(ventes, name, startDate, endDate)}
        excelSheetName="Fiche client magasin"
      />
    </div>
  )
}

function PaymentModal({ client, onClose, onDone }) {
  const [amount, setAmount] = useState('')
  const [entryDate, setEntryDate] = useState(todayISO())
  const [paymentMode, setPaymentMode] = useState('Espèces')
  const [chequeNumber, setChequeNumber] = useState('')
  const [chequeBank, setChequeBank] = useState('')
  const [observations, setObservations] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')

  const credit = Number(client.credit) || 0

  async function submit() {
    const value = Number(String(amount).replace(',', '.'))
    if (!Number.isFinite(value) || value <= 0) {
      setError('Montant invalide.')
      return
    }
    if (paymentMode === 'Chèque' && (!chequeNumber.trim() || !chequeBank.trim())) {
      setError('N° de chèque et banque obligatoires.')
      return
    }
    setBusy(true)
    setError('')

    const { data: bonRow } = await supabase
      .from('magasin_ventes')
      .select('bon_number')
      .order('bon_number', { ascending: false })
      .limit(1)
    const bonNumber = bonRow?.[0]?.bon_number ? bonRow[0].bon_number + 1 : 1

    const payload = {
      bon_number: bonNumber,
      entry_date: entryDate,
      entry_time: formatHHMM(new Date()),
      client_name: client.name,
      items: [],
      total_ht: value,
      remise: 0,
      total: value,
      payment_mode: paymentMode,
      cheque_number: paymentMode === 'Chèque' ? chequeNumber.trim() : null,
      cheque_bank: paymentMode === 'Chèque' ? chequeBank.trim() : null,
      observations: observations.trim() || null,
      is_payment: true,
      entered_by_user: getSession()?.username ?? null,
    }

    const { data, error: rpcError } = await supabase.rpc('magasin_record_vente', { p: payload })
    setBusy(false)
    if (rpcError) {
      setError(`Erreur : ${rpcError.message}`)
      return
    }
    onDone(data)
  }

  return (
    <div className="fixed inset-0 z-50 bg-black/70 sm:flex sm:items-center sm:justify-center sm:p-4" onClick={onClose}>
      <div
        className="flex h-full w-full flex-col gap-3 overflow-y-auto bg-bg-card p-5 sm:h-auto sm:w-full sm:max-w-sm sm:rounded-xl sm:border sm:border-border"
        onClick={(e) => e.stopPropagation()}
      >
        <h2 className="font-display text-lg text-ink">Règlement — {client.name}</h2>
        <p className="text-sm text-ink-muted">
          Solde actuel :{' '}
          <span className={credit < 0 ? 'text-terracotta' : 'text-green-500'}>{formatDA(credit)} DA</span>
          {credit < 0 && ` (le client nous doit ${formatDA(Math.abs(credit))} DA)`}
        </p>

        <label className="flex flex-col gap-1.5">
          <span className="text-sm text-ink-muted">Montant payé (DA) *</span>
          <input type="number" inputMode="decimal" step="0.01" min="0" value={amount} onChange={(e) => setAmount(e.target.value)} className={inputClass} autoFocus />
        </label>
        <label className="flex flex-col gap-1.5">
          <span className="text-sm text-ink-muted">Date</span>
          <input type="date" value={entryDate} onChange={(e) => setEntryDate(e.target.value)} className={inputClass} />
        </label>
        <label className="flex flex-col gap-1.5">
          <span className="text-sm text-ink-muted">Mode de paiement</span>
          <select value={paymentMode} onChange={(e) => setPaymentMode(e.target.value)} className={inputClass}>
            {PAYMENT_MODES.map((m) => (
              <option key={m} value={m}>
                {m}
              </option>
            ))}
          </select>
        </label>
        {paymentMode === 'Chèque' && (
          <div className="grid grid-cols-2 gap-2">
            <input type="text" placeholder="N° chèque" value={chequeNumber} onChange={(e) => setChequeNumber(e.target.value)} className={inputClass} />
            <input type="text" placeholder="Banque" value={chequeBank} onChange={(e) => setChequeBank(e.target.value)} className={inputClass} />
          </div>
        )}
        <label className="flex flex-col gap-1.5">
          <span className="text-sm text-ink-muted">Observations</span>
          <input type="text" value={observations} onChange={(e) => setObservations(e.target.value)} className={inputClass} />
        </label>

        {error && <p className="text-sm text-terracotta">{error}</p>}

        <div className="mt-auto flex justify-end gap-2 pt-2">
          <button type="button" onClick={onClose} className="min-h-11 rounded-lg border border-border px-3 py-2 text-sm text-ink-muted">
            Annuler
          </button>
          <button
            type="button"
            onClick={submit}
            disabled={busy}
            className="min-h-11 rounded-lg bg-terracotta px-3 py-2 text-sm font-display text-ink hover:bg-terracotta-hover disabled:opacity-50"
          >
            {busy ? 'Enregistrement…' : 'Enregistrer le paiement'}
          </button>
        </div>
      </div>
    </div>
  )
}

function AddClientModal({ onClose, onAdded }) {
  const [name, setName] = useState('')
  const [phone, setPhone] = useState('')
  const [seuil, setSeuil] = useState('')
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
      .from('magasin_clients')
      .insert({
        name: name.trim(),
        phone: phone.trim() || null,
        seuil_credit: seuil === '' ? 0 : Number(seuil),
      })
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
      <div
        className="flex h-full w-full flex-col gap-3 overflow-y-auto bg-bg-card p-5 sm:h-auto sm:w-full sm:max-w-sm sm:rounded-xl sm:border sm:border-border"
        onClick={(e) => e.stopPropagation()}
      >
        <h2 className="font-display text-lg text-ink">Ajouter un client</h2>
        <label className="flex flex-col gap-1.5">
          <span className="text-sm text-ink-muted">Nom *</span>
          <input type="text" value={name} onChange={(e) => setName(e.target.value)} className={inputClass} autoFocus />
        </label>
        <label className="flex flex-col gap-1.5">
          <span className="text-sm text-ink-muted">Téléphone</span>
          <input type="text" value={phone} onChange={(e) => setPhone(e.target.value)} className={inputClass} />
        </label>
        <label className="flex flex-col gap-1.5">
          <span className="text-sm text-ink-muted">Seuil de crédit (DA)</span>
          <input type="number" step="0.01" value={seuil} onChange={(e) => setSeuil(e.target.value)} className={inputClass} />
        </label>
        {error && <p className="text-sm text-terracotta">{error}</p>}
        <div className="mt-auto flex justify-end gap-2 pt-2">
          <button type="button" onClick={onClose} className="min-h-11 rounded-lg border border-border px-3 py-2 text-sm text-ink-muted">
            Annuler
          </button>
          <button
            type="button"
            onClick={submit}
            disabled={busy}
            className="min-h-11 rounded-lg bg-terracotta px-3 py-2 text-sm font-display text-ink hover:bg-terracotta-hover disabled:opacity-50"
          >
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
