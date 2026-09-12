import { useEffect, useMemo, useState } from 'react'
import { supabase } from '../lib/supabase'
import { useAuth } from '../lib/auth'
import { isLocked, LOCK_MESSAGE } from '../lib/lock'
import { notifyChequeStatut } from '../lib/ntfy'
import { formatDA, daysSince, CHEQUE_STALE_DAYS } from '../lib/cheques'
import AdminCodeModal from './AdminCodeModal'

const todayISO = () => new Date().toISOString().slice(0, 10)

const SECTIONS = [
  { statut: 'En attente', title: 'En attente', hint: 'chèques pas encore remis en banque', next: 'Remis en banque', nextLabel: 'Marquer « Remis en banque »' },
  { statut: 'Remis en banque', title: 'Remis en banque', hint: 'en cours de traitement', next: 'Encaissé', nextLabel: 'Marquer « Encaissé »' },
  { statut: 'Rejeté', title: 'Rejetés', hint: 'à traiter', next: null, nextLabel: null },
]

export default function ChequeSuivi() {
  const { isAdmin } = useAuth()
  const [rows, setRows] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [adminPrompt, setAdminPrompt] = useState(null)
  const [adminCodeValue, setAdminCodeValue] = useState('')
  const [adminError, setAdminError] = useState('')
  const [adminBusy, setAdminBusy] = useState(false)

  useEffect(() => {
    let active = true
    async function load() {
      setLoading(true)
      const { data, error: fetchError } = await supabase
        .from('cheques')
        .select('*')
        .in('statut', ['En attente', 'Remis en banque', 'Rejeté'])
        .order('cheque_date', { ascending: true })
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
      .channel('cheques-suivi')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'cheques' }, load)
      .subscribe()
    return () => {
      active = false
      supabase.removeChannel(channel)
    }
  }, [])

  const grouped = useMemo(() => {
    const map = { 'En attente': [], 'Remis en banque': [], Rejeté: [] }
    for (const r of rows) if (map[r.statut]) map[r.statut].push(r)
    return map
  }, [rows])

  async function applyStatusChange(cheque, nextStatut, adminCode) {
    const patch = { statut: nextStatut }
    if (nextStatut === 'Remis en banque') patch.date_remise = cheque.date_remise || todayISO()
    if (nextStatut === 'Encaissé') patch.date_encaissement = cheque.date_encaissement || todayISO()

    const { data, error: updateError } = adminCode
      ? await supabase.rpc('admin_update_cheque', { p_id: cheque.id, p_admin_code: adminCode, p: patch })
      : await supabase.from('cheques').update(patch).eq('id', cheque.id).select().single()

    if (updateError) {
      setError(`Erreur de mise à jour : ${updateError.message}`)
      return
    }
    setError('')
    notifyChequeStatut(data)
  }

  function handleAdvance(cheque, nextStatut) {
    if (isLocked(cheque)) {
      if (!isAdmin) {
        setError(LOCK_MESSAGE)
        return
      }
      setAdminPrompt({ cheque, nextStatut })
      setAdminCodeValue('')
      setAdminError('')
      return
    }
    applyStatusChange(cheque, nextStatut, null)
  }

  function closeAdminPrompt() {
    setAdminPrompt(null)
    setAdminCodeValue('')
    setAdminError('')
  }

  async function confirmAdminCode() {
    setAdminBusy(true)
    const { cheque, nextStatut } = adminPrompt
    const patch = { statut: nextStatut }
    if (nextStatut === 'Remis en banque') patch.date_remise = cheque.date_remise || todayISO()
    if (nextStatut === 'Encaissé') patch.date_encaissement = cheque.date_encaissement || todayISO()
    const { data, error: rpcError } = await supabase.rpc('admin_update_cheque', {
      p_id: cheque.id,
      p_admin_code: adminCodeValue,
      p: patch,
    })
    setAdminBusy(false)
    if (rpcError) {
      setAdminError(`Erreur : ${rpcError.message}`)
      return
    }
    notifyChequeStatut(data)
    closeAdminPrompt()
  }

  if (loading) return <p className="text-ink-muted">Chargement…</p>

  return (
    <div className="flex flex-col gap-6">
      {error && <p className="rounded-lg border border-terracotta/50 bg-terracotta/10 px-4 py-3 text-sm text-terracotta">{error}</p>}

      {SECTIONS.map((section) => (
        <SuiviSection
          key={section.statut}
          section={section}
          rows={grouped[section.statut]}
          onAdvance={handleAdvance}
        />
      ))}

      <AdminCodeModal
        prompt={adminPrompt ? { action: 'edit', entry: adminPrompt.cheque } : null}
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

function SuiviSection({ section, rows, onAdvance }) {
  const total = rows.reduce((s, r) => s + (Number(r.amount) || 0), 0)

  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h3 className="font-display text-lg text-ink">
          {section.title} <span className="text-sm font-normal text-ink-muted">— {section.hint}</span>
        </h3>
        <span className="text-sm text-ink-muted">
          {rows.length} chèque{rows.length > 1 ? 's' : ''} — <span className="font-medium text-ocre">{formatDA(total)} DA</span>
        </span>
      </div>

      {rows.length === 0 ? (
        <p className="text-sm text-ink-muted">Aucun chèque.</p>
      ) : (
        <div className="flex flex-col gap-2">
          {rows.map((r) => {
            const age = section.statut === 'En attente' ? daysSince(r.cheque_date) : 0
            const stale = section.statut === 'En attente' && age > CHEQUE_STALE_DAYS
            return (
              <div
                key={r.id}
                className="flex flex-col gap-2 rounded-lg border border-border bg-bg-soft p-3 sm:flex-row sm:items-center sm:justify-between"
              >
                <div className="flex flex-col gap-0.5">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="font-display text-ink">N° {r.cheque_number}</span>
                    <span className="text-sm text-ink-muted">{r.beneficiary}</span>
                    {stale && (
                      <span className="inline-block rounded-full border border-orange-500/60 bg-orange-500/10 px-2 py-0.5 text-xs whitespace-nowrap text-orange-500">
                        ⚠ {age} jours
                      </span>
                    )}
                  </div>
                  <span className="text-xs text-ink-muted">
                    {r.cheque_date} — {r.bank} — {r.type}
                    {section.statut === 'Rejeté' && r.motif_rejet ? ` — Motif : ${r.motif_rejet}` : ''}
                  </span>
                </div>
                <div className="flex items-center gap-3">
                  <span className="font-display text-lg text-ocre">{formatDA(r.amount)} DA</span>
                  {section.next && (
                    <button
                      type="button"
                      onClick={() => onAdvance(r, section.next)}
                      className="min-h-10 rounded-lg border border-ocre px-3 py-1.5 font-display text-sm text-ocre hover:bg-ocre/10"
                    >
                      {section.nextLabel}
                    </button>
                  )}
                </div>
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}
