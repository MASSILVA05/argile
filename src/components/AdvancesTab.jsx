import { useEffect, useMemo, useState } from 'react'
import { supabase } from '../lib/supabase'
import { notifyClientAdvance } from '../lib/ntfy'
import { sendClientAdvanceEmail } from '../lib/email'
import { getSession, useAuth } from '../lib/auth'
import { isLocked, LOCK_MESSAGE } from '../lib/lock'
import { ADVANCE_PAYMENT_MODES } from '../lib/invoicePayment'
import RowActions from './RowActions'
import AdminCodeModal from './AdminCodeModal'

const todayISO = () => new Date().toISOString().slice(0, 10)

// Badge "vert" tant qu'il reste plus de 2 bons (ou plus de 20% du lot
// initial), "rouge" quand l'avance est proche de l'épuisement.
function isLowRemaining(advance) {
  const threshold = Math.max(2, Math.ceil(advance.bons_purchased * 0.2))
  return advance.bons_remaining <= threshold
}

const emptyDraft = {
  client_name: '',
  advance_date: todayISO(),
  amount_paid: '',
  bons_purchased: '',
  payment_mode: '',
  cheque_number: '',
  cheque_bank: '',
  observations: '',
}

function formatDA(value) {
  return Number(value || 0).toLocaleString('fr-FR', { maximumFractionDigits: 2 })
}

export default function AdvancesTab() {
  const { isAdmin } = useAuth()
  const [advances, setAdvances] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [clients, setClients] = useState([])
  const [banks, setBanks] = useState([])
  const [draft, setDraft] = useState(emptyDraft)
  const [submitting, setSubmitting] = useState(false)
  const [success, setSuccess] = useState('')
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
        .from('client_advances')
        .select('*')
        .gt('bons_remaining', 0)
        .order('created_at', { ascending: false })
      if (!active) return
      if (fetchError) {
        setError(`Erreur de chargement : ${fetchError.message}`)
      } else {
        setAdvances(data ?? [])
        setError('')
      }
      setLoading(false)
    }

    load()

    const channel = supabase
      .channel('client-advances')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'client_advances' }, (payload) => {
        setAdvances((current) => applyRealtimeChange(current, payload))
      })
      .subscribe()

    return () => {
      active = false
      supabase.removeChannel(channel)
    }
  }, [])

  useEffect(() => {
    async function loadSuggestions() {
      const [{ data: clientRows }, { data: advanceRows }] = await Promise.all([
        supabase.from('clients').select('name').order('name'),
        supabase.from('client_advances').select('cheque_bank').order('created_at', { ascending: false }).limit(200),
      ])
      setClients([...new Set((clientRows ?? []).map((r) => r.name).filter(Boolean))])
      setBanks([...new Set((advanceRows ?? []).map((r) => r.cheque_bank).filter(Boolean))])
    }
    loadSuggestions()
  }, [])

  const dedupedBanks = useMemo(() => banks, [banks])

  function update(field, value) {
    setDraft((d) => ({ ...d, [field]: value }))
  }

  function validate() {
    if (!draft.client_name.trim()) return 'Le client est obligatoire.'
    if (draft.amount_paid === '' || Number(draft.amount_paid) <= 0) return 'Le montant payé est obligatoire.'
    if (draft.bons_purchased === '' || Number(draft.bons_purchased) <= 0) {
      return 'Le nombre de bons est obligatoire.'
    }
    if (draft.payment_mode === 'Chèque' && !draft.cheque_number.trim()) {
      return 'Le n° de chèque est obligatoire.'
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
    setSubmitting(true)

    const isCheque = draft.payment_mode === 'Chèque'
    const bonsPurchased = Number(draft.bons_purchased)

    const payload = {
      client_name: draft.client_name.trim().toUpperCase(),
      advance_date: draft.advance_date,
      amount_paid: Number(draft.amount_paid),
      bons_purchased: bonsPurchased,
      bons_remaining: bonsPurchased,
      payment_mode: draft.payment_mode || null,
      cheque_number: isCheque ? draft.cheque_number.trim() : null,
      cheque_bank: isCheque ? draft.cheque_bank.trim() || null : null,
      observations: draft.observations.trim() || null,
      entered_by_user: getSession()?.username ?? null,
    }

    const { data, error: insertError } = await supabase.from('client_advances').insert(payload).select().single()

    if (insertError) {
      setSubmitting(false)
      setError(`Erreur d'enregistrement : ${insertError.message}`)
      return
    }

    notifyClientAdvance(data)
    sendClientAdvanceEmail(data)

    setDraft({ ...emptyDraft, advance_date: draft.advance_date })
    setSuccess(`Avance enregistrée pour ${payload.client_name}.`)
    setSubmitting(false)
  }

  function startEdit(advance) {
    setEditingId(advance.id)
    setEditDraft({ ...advance })
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
    const payload = {
      client_name: editDraft.client_name.trim().toUpperCase(),
      advance_date: editDraft.advance_date,
      amount_paid: Number(editDraft.amount_paid),
      bons_purchased: Number(editDraft.bons_purchased),
      bons_remaining: Number(editDraft.bons_remaining),
      payment_mode: editDraft.payment_mode || null,
      cheque_number: isCheque ? (editDraft.cheque_number || '').trim() : null,
      cheque_bank: isCheque ? (editDraft.cheque_bank || '').trim() || null : null,
      observations: editDraft.observations?.trim() || null,
    }

    const { data, error: updateError } = usingAdminCode
      ? await supabase.rpc('admin_update_client_advance', {
          p_id: editingId,
          p_admin_code: editAdminCode,
          p_client_name: payload.client_name,
          p_advance_date: payload.advance_date,
          p_amount_paid: payload.amount_paid,
          p_bons_purchased: payload.bons_purchased,
          p_bons_remaining: payload.bons_remaining,
          p_payment_mode: payload.payment_mode,
          p_cheque_number: payload.cheque_number,
          p_cheque_bank: payload.cheque_bank,
          p_observations: payload.observations,
        })
      : await supabase.from('client_advances').update(payload).eq('id', editingId).select().single()

    if (updateError) {
      setError(`Erreur de mise à jour : ${updateError.message}`)
      return
    }
    setAdvances((current) => current.map((a) => (a.id === data.id ? data : a)).filter((a) => a.bons_remaining > 0))
    cancelEdit()
  }

  function openAdminPrompt(action, advance) {
    if (!isAdmin) {
      setError(LOCK_MESSAGE)
      return
    }
    setAdminPrompt({ action, entry: advance })
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
      const advance = adminPrompt.entry
      closeAdminPrompt()
      startEdit(advance)
      setEditAdminCode(adminCodeValue)
      return
    }

    setAdminBusy(true)
    const { error: rpcError } = await supabase.rpc('admin_delete_client_advance', {
      p_id: adminPrompt.entry.id,
      p_admin_code: adminCodeValue,
    })
    setAdminBusy(false)
    if (rpcError) {
      setAdminError(`Erreur : ${rpcError.message}`)
      return
    }
    setAdvances((current) => current.filter((a) => a.id !== adminPrompt.entry.id))
    closeAdminPrompt()
  }

  async function handleDelete(advance) {
    if (isLocked(advance)) {
      setError(LOCK_MESSAGE)
      return
    }
    const ok = window.confirm(`Supprimer l'avance de ${advance.client_name} (${advance.bons_remaining} bons restants) ?`)
    if (!ok) return
    const { error: deleteError } = await supabase.from('client_advances').delete().eq('id', advance.id)
    if (deleteError) {
      setError(`Erreur de suppression : ${deleteError.message}`)
      return
    }
    setAdvances((current) => current.filter((a) => a.id !== advance.id))
  }

  return (
    <div className="flex flex-col gap-6">
      <form onSubmit={handleSubmit} className="flex flex-col gap-4 rounded-xl border border-border bg-bg-card p-4">
        <h2 className="font-display text-lg text-ink">Nouvelle avance</h2>

        <Field label="Client" required>
          <input
            type="text"
            list="advance-clients-list"
            value={draft.client_name}
            onChange={(e) => update('client_name', e.target.value)}
            className={inputClass}
            autoComplete="off"
            required
          />
          <datalist id="advance-clients-list">
            {clients.map((c) => (
              <option key={c} value={c} />
            ))}
          </datalist>
        </Field>

        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <Field label="Date" required>
            <input
              type="date"
              value={draft.advance_date}
              onChange={(e) => update('advance_date', e.target.value)}
              className={inputClass}
              required
            />
          </Field>
          <Field label="Montant payé (DA)" required>
            <input
              type="number"
              inputMode="decimal"
              step="0.01"
              min="0"
              value={draft.amount_paid}
              onChange={(e) => update('amount_paid', e.target.value)}
              className={inputClass}
              required
            />
          </Field>
        </div>

        <Field label="Nombre de bons" required>
          <input
            type="number"
            inputMode="numeric"
            step="1"
            min="1"
            value={draft.bons_purchased}
            onChange={(e) => update('bons_purchased', e.target.value)}
            className={inputClass}
            required
          />
        </Field>

        <Field label="Mode de paiement">
          <select value={draft.payment_mode} onChange={(e) => update('payment_mode', e.target.value)} className={inputClass}>
            <option value="">—</option>
            {ADVANCE_PAYMENT_MODES.map((m) => (
              <option key={m} value={m}>
                {m}
              </option>
            ))}
          </select>
        </Field>

        {draft.payment_mode === 'Chèque' && (
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <Field label="N° de chèque" required>
              <input
                type="text"
                value={draft.cheque_number}
                onChange={(e) => update('cheque_number', e.target.value)}
                className={inputClass}
                required
              />
            </Field>
            <Field label="Banque">
              <input
                type="text"
                list="advance-banks-list"
                value={draft.cheque_bank}
                onChange={(e) => update('cheque_bank', e.target.value)}
                className={inputClass}
                autoComplete="off"
              />
              <datalist id="advance-banks-list">
                {dedupedBanks.map((b) => (
                  <option key={b} value={b} />
                ))}
              </datalist>
            </Field>
          </div>
        )}

        <Field label="Observations">
          <textarea
            value={draft.observations}
            onChange={(e) => update('observations', e.target.value)}
            className={`${inputClass} min-h-16 resize-y`}
            placeholder="optionnel"
          />
        </Field>

        {error && (
          <p className="rounded-lg border border-terracotta/50 bg-terracotta/10 px-4 py-3 text-sm text-terracotta">
            {error}
          </p>
        )}
        {success && (
          <p className="rounded-lg border border-ocre/50 bg-ocre/10 px-4 py-3 text-sm text-ocre">{success}</p>
        )}

        <button
          type="submit"
          disabled={submitting}
          className="min-h-12 rounded-lg bg-terracotta px-4 py-3 font-display text-lg font-medium tracking-wide text-ink transition-colors hover:bg-terracotta-hover disabled:opacity-50"
        >
          {submitting ? 'Enregistrement…' : "Enregistrer l'avance"}
        </button>
      </form>

      <div className="flex flex-col gap-3">
        <h2 className="font-display text-lg text-ink">Avances actives</h2>

        {loading ? (
          <p className="text-ink-muted">Chargement…</p>
        ) : advances.length === 0 ? (
          <p className="text-ink-muted">Aucune avance active.</p>
        ) : (
          <div className="flex flex-col gap-3">
            {advances.map((advance) =>
              editingId === advance.id ? (
                <AdvanceEditCard
                  key={advance.id}
                  draft={editDraft}
                  onChange={setEditDraft}
                  onSave={saveEdit}
                  onCancel={cancelEdit}
                  bankSuggestions={dedupedBanks}
                />
              ) : (
                <div key={advance.id} className="rounded-xl border border-border bg-bg-card p-4">
                  <div className="flex flex-wrap items-start justify-between gap-3">
                    <div>
                      <p className="font-display text-ink">{advance.client_name}</p>
                      <p className="text-xs text-ink-muted">{advance.advance_date}</p>
                    </div>
                    <span
                      className={`inline-block rounded-full border px-2 py-0.5 text-xs whitespace-nowrap ${
                        isLowRemaining(advance)
                          ? 'border-terracotta/50 bg-terracotta/10 text-terracotta'
                          : 'border-green-500/50 bg-green-500/10 text-green-500'
                      }`}
                    >
                      {advance.bons_remaining} / {advance.bons_purchased} bons restants
                    </span>
                  </div>
                  <div className="mt-2 flex flex-wrap gap-x-6 gap-y-1 text-sm text-ink-muted">
                    <span>Montant payé : {formatDA(advance.amount_paid)} DA</span>
                    {advance.payment_mode && <span>Mode : {advance.payment_mode}</span>}
                    {advance.observations && <span>Obs : {advance.observations}</span>}
                    {advance.entered_by_user && <span>Saisi par : {advance.entered_by_user}</span>}
                  </div>
                  <div className="mt-3">
                    <RowActions
                      entry={advance}
                      onEdit={() => startEdit(advance)}
                      onDelete={() => handleDelete(advance)}
                      onLockedAttempt={(action) => openAdminPrompt(action, advance)}
                    />
                  </div>
                </div>
              )
            )}
          </div>
        )}
      </div>

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

function AdvanceEditCard({ draft, onChange, onSave, onCancel, bankSuggestions }) {
  function set(field, value) {
    onChange({ ...draft, [field]: value })
  }

  return (
    <div className="flex flex-col gap-3 rounded-xl border border-ocre/50 bg-bg-card p-4">
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <Field label="Client">
          <input type="text" value={draft.client_name} onChange={(e) => set('client_name', e.target.value)} className={inputClass} />
        </Field>
        <Field label="Date">
          <input type="date" value={draft.advance_date} onChange={(e) => set('advance_date', e.target.value)} className={inputClass} />
        </Field>
      </div>
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
        <Field label="Montant payé (DA)">
          <input type="number" step="0.01" value={draft.amount_paid} onChange={(e) => set('amount_paid', e.target.value)} className={inputClass} />
        </Field>
        <Field label="Bons achetés">
          <input type="number" step="1" value={draft.bons_purchased} onChange={(e) => set('bons_purchased', e.target.value)} className={inputClass} />
        </Field>
        <Field label="Bons restants">
          <input type="number" step="1" value={draft.bons_remaining} onChange={(e) => set('bons_remaining', e.target.value)} className={inputClass} />
        </Field>
      </div>
      <Field label="Mode de paiement">
        <select value={draft.payment_mode ?? ''} onChange={(e) => set('payment_mode', e.target.value)} className={inputClass}>
          <option value="">—</option>
          {ADVANCE_PAYMENT_MODES.map((m) => (
            <option key={m} value={m}>
              {m}
            </option>
          ))}
        </select>
      </Field>
      {draft.payment_mode === 'Chèque' && (
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <Field label="N° de chèque">
            <input type="text" value={draft.cheque_number ?? ''} onChange={(e) => set('cheque_number', e.target.value)} className={inputClass} />
          </Field>
          <Field label="Banque">
            <input
              type="text"
              list="advance-edit-banks-list"
              value={draft.cheque_bank ?? ''}
              onChange={(e) => set('cheque_bank', e.target.value)}
              className={inputClass}
            />
            <datalist id="advance-edit-banks-list">
              {bankSuggestions.map((b) => (
                <option key={b} value={b} />
              ))}
            </datalist>
          </Field>
        </div>
      )}
      <Field label="Observations">
        <input type="text" value={draft.observations ?? ''} onChange={(e) => set('observations', e.target.value)} className={inputClass} />
      </Field>
      <div className="flex gap-2">
        <button type="button" onClick={onSave} className="rounded border border-ocre px-3 py-1.5 text-ocre hover:bg-ocre/10">
          Enregistrer
        </button>
        <button type="button" onClick={onCancel} className="rounded border border-border px-3 py-1.5 text-ink-muted hover:border-ink-muted">
          Annuler
        </button>
      </div>
    </div>
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

const inputClass =
  'min-h-11 rounded-lg border border-border bg-bg-soft px-3 py-2 text-ink placeholder:text-ink-muted/60 outline-none focus:border-terracotta'

function applyRealtimeChange(current, payload) {
  if (payload.eventType === 'INSERT') {
    if (payload.new.bons_remaining <= 0) return current
    if (current.some((a) => a.id === payload.new.id)) return current
    return [payload.new, ...current]
  }
  if (payload.eventType === 'UPDATE') {
    if (payload.new.bons_remaining <= 0) return current.filter((a) => a.id !== payload.new.id)
    return current.map((a) => (a.id === payload.new.id ? payload.new : a))
  }
  if (payload.eventType === 'DELETE') {
    return current.filter((a) => a.id !== payload.old.id)
  }
  return current
}
