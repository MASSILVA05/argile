import { useCallback, useEffect, useMemo, useState } from 'react'
import { supabase } from '../lib/supabase'
import { useAuth, getSession } from '../lib/auth'
import { CHEQUE_BANKS } from '../lib/cheques'
import { printRegistry } from '../lib/printRegistry'
import {
  MONTHS_FR,
  EXCLUDED_CHEQUE_STATUTS,
  BANK_CAISSE_MODES,
  monthBounds,
  periodLabelOf,
  buildBrouillard,
  reconciliationSummary,
  downloadBrouillardExcel,
  formatDA,
} from '../lib/bankBrouillard'

const PAGE = 1000

// Supabase plafonne chaque requête à 1000 lignes : lecture par pages.
async function fetchAll(buildQuery) {
  const out = []
  for (let from = 0; ; from += PAGE) {
    const { data, error } = await buildQuery().range(from, from + PAGE - 1)
    if (error) throw error
    out.push(...(data ?? []))
    if (!data || data.length < PAGE) return out
  }
}

function recKey(source, id) {
  return `${source}:${id}`
}

export default function BrouillardBanque({ entityFilter }) {
  const { isAdmin, isViewer } = useAuth()
  const now = new Date()
  const [banks, setBanks] = useState(CHEQUE_BANKS)
  const [bank, setBank] = useState('')
  const [year, setYear] = useState(now.getFullYear())
  const [month, setMonth] = useState(now.getMonth() + 1)
  const [cheques, setCheques] = useState([])
  const [caisseEntries, setCaisseEntries] = useState([])
  const [recByKey, setRecByKey] = useState(new Map())
  const [monthRow, setMonthRow] = useState(null)
  const [statementInput, setStatementInput] = useState('')
  const [loading, setLoading] = useState(false)
  const [busyKey, setBusyKey] = useState(null)
  const [error, setError] = useState('')
  const [exporting, setExporting] = useState(false)

  // Clé d'entité du verrouillage / solde relevé ('Tout' = vue globale admin).
  const entityKey = entityFilter ?? 'Tout'
  const locked = Boolean(monthRow?.locked)
  const readOnly = locked || isViewer

  // Banques connues : liste standard + banques réellement saisies.
  useEffect(() => {
    let query = supabase.from('cheques').select('bank').limit(5000)
    if (entityFilter) query = query.eq('entity', entityFilter)
    query.then(({ data }) => {
      const used = (data ?? []).map((r) => r.bank?.trim()).filter(Boolean)
      const list = [...new Set([...used, ...CHEQUE_BANKS])].sort()
      setBanks(list)
      setBank((b) => b || used[0] || list[0] || '')
    })
  }, [entityFilter])

  const load = useCallback(async () => {
    if (!bank) return
    setLoading(true)
    setError('')
    const { end } = monthBounds(year, month)
    try {
      const [chequeRows, caisseRows, recRows, { data: monthData, error: monthError }] = await Promise.all([
        fetchAll(() => {
          let q = supabase
            .from('cheques')
            .select('id, type, cheque_number, cheque_date, beneficiary, amount, bank, motif, statut, entity')
            .eq('bank', bank)
            .lte('cheque_date', end)
            .not('statut', 'in', `(${EXCLUDED_CHEQUE_STATUTS.map((s) => `"${s}"`).join(',')})`)
            .order('cheque_date')
          if (entityFilter) q = q.eq('entity', entityFilter)
          return q
        }),
        fetchAll(() => {
          let q = supabase
            .from('caisse_entries')
            .select('id, bon_number, entry_date, operation_type, description, amount, beneficiary, client_name, payment_mode, cheque_number, cheque_bank, piece_number, entity')
            .eq('cheque_bank', bank)
            .in('payment_mode', BANK_CAISSE_MODES)
            .is('linked_cheque_id', null)
            .lte('entry_date', end)
            .order('entry_date')
          if (entityFilter) q = q.eq('entity', entityFilter)
          return q
        }),
        fetchAll(() => supabase.from('bank_reconciliation').select('*').eq('bank', bank).order('created_at')),
        supabase
          .from('bank_reconciliation_months')
          .select('*')
          .eq('entity', entityKey)
          .eq('bank', bank)
          .eq('year', year)
          .eq('month', month)
          .maybeSingle(),
      ])
      if (monthError) throw monthError
      setCheques(chequeRows)
      setCaisseEntries(caisseRows)
      setRecByKey(
        new Map(recRows.map((r) => [r.cheque_id ? recKey('cheque', r.cheque_id) : recKey('caisse', r.caisse_entry_id), r]))
      )
      setMonthRow(monthData ?? null)
      setStatementInput(monthData?.statement_balance != null ? String(monthData.statement_balance) : '')
    } catch (err) {
      setError(`Erreur de chargement : ${err.message}`)
    } finally {
      setLoading(false)
    }
  }, [bank, year, month, entityFilter, entityKey])

  useEffect(() => {
    load()
  }, [load])

  const data = useMemo(
    () => buildBrouillard({ cheques, caisseEntries, recByKey, year, month }),
    [cheques, caisseEntries, recByKey, year, month]
  )
  const summary = reconciliationSummary(data, statementInput)

  async function toggleReconciled(op) {
    if (readOnly) return
    setBusyKey(op.key)
    setError('')
    const reconciled = !op.reconciled
    const conflictColumn = op.source === 'cheque' ? 'cheque_id' : 'caisse_entry_id'
    const { data: saved, error: saveError } = await supabase
      .from('bank_reconciliation')
      .upsert(
        {
          [conflictColumn]: op.sourceId,
          bank,
          year,
          month,
          reconciled,
          reconciled_date: reconciled ? new Date().toISOString().slice(0, 10) : null,
        },
        { onConflict: conflictColumn }
      )
      .select()
      .single()
    setBusyKey(null)
    if (saveError) {
      setError(`Erreur de pointage : ${saveError.message}`)
      return
    }
    setRecByKey((m) => new Map(m).set(op.key, saved))
  }

  async function saveMonth(changes) {
    const { data: saved, error: saveError } = await supabase
      .from('bank_reconciliation_months')
      .upsert({ entity: entityKey, bank, year, month, ...changes }, { onConflict: 'entity,bank,year,month' })
      .select()
      .single()
    if (saveError) {
      setError(`Erreur : ${saveError.message}`)
      return false
    }
    setMonthRow(saved)
    return true
  }

  async function saveStatementBalance() {
    if (readOnly) return
    const value = statementInput === '' ? null : Number(statementInput)
    if (value != null && Number.isNaN(value)) return
    if ((monthRow?.statement_balance ?? null) === value) return
    await saveMonth({ statement_balance: value })
  }

  async function lockMonth() {
    const pendingCount = data.rows.filter((r) => !r.reconciled).length + data.carriedPending.length
    const msg =
      `Verrouiller le brouillard ${bank} — ${periodLabelOf(year, month)} ?\n` +
      `${pendingCount} opération(s) en suspens.` +
      (summary && Math.abs(summary.gap) > 0.005 ? `\nAttention : écart de rapprochement de ${formatDA(summary.gap)} DA.` : '') +
      '\nAprès verrouillage, le pointage de ce mois ne sera plus modifiable.'
    if (!window.confirm(msg)) return
    await saveMonth({
      statement_balance: statementInput === '' ? null : Number(statementInput),
      locked: true,
      locked_at: new Date().toISOString(),
      locked_by: getSession()?.username ?? null,
    })
  }

  async function unlockMonth() {
    if (!window.confirm(`Déverrouiller le brouillard ${bank} — ${periodLabelOf(year, month)} ?`)) return
    await saveMonth({ locked: false, locked_at: null, locked_by: null })
  }

  function handlePrint() {
    const fmt = (v) => (v ? formatDA(v) : '')
    const rows = [
      ...data.rows.map((r) => ({ ...r, reconciledLabel: r.reconciled ? '✓' : '' })),
      ...data.carriedPending.map((r) => ({ ...r, label: `[Suspens] ${r.label}`, balance: null, reconciledLabel: '' })),
    ]
    printRegistry({
      subtitle: `BROUILLARD BANQUE — ${bank} — ${periodLabelOf(year, month)}${entityFilter ? ` — ${entityFilter}` : ''}`,
      orientation: 'portrait',
      filters: [
        `Report début de mois : ${formatDA(data.openingBalance)} DA`,
        `Débits en suspens : ${formatDA(data.pendingDebit)} DA`,
        `Crédits en suspens : ${formatDA(data.pendingCredit)} DA`,
        ...(summary
          ? [
              `Solde relevé : ${formatDA(statementInput)} DA`,
              `Solde rapproché : ${formatDA(summary.reconciledBalance)} DA`,
              `Écart : ${formatDA(summary.gap)} DA`,
            ]
          : []),
        locked ? 'MOIS VERROUILLÉ' : '',
      ]
        .filter(Boolean)
        .join(' — '),
      columns: [
        { key: 'date', label: 'Date' },
        { key: 'piece', label: 'N° pièce' },
        { key: 'label', label: 'Libellé' },
        { key: 'debit', label: 'Débit (DA)', align: 'right', format: fmt },
        { key: 'credit', label: 'Crédit (DA)', align: 'right', format: fmt },
        { key: 'balance', label: 'Solde (DA)', align: 'right', format: (v) => formatDA(v) },
        { key: 'reconciledLabel', label: 'Rappr.' },
      ],
      rows,
      totals: [
        { cells: { label: 'TOTAUX DU MOIS', debit: data.totalDebit, credit: data.totalCredit, balance: data.closingBalance }, highlight: true },
      ],
    })
  }

  async function handleExport() {
    setExporting(true)
    try {
      await downloadBrouillardExcel(data, { bank, year, month, entity: entityFilter, statementBalance: statementInput })
    } catch (err) {
      setError(`Erreur lors de la génération du fichier Excel : ${err.message}`)
    } finally {
      setExporting(false)
    }
  }

  const years = Array.from({ length: 6 }, (_, i) => now.getFullYear() - 4 + i)

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-col gap-3 sm:flex-row sm:flex-wrap sm:items-end">
        <label className="flex flex-col gap-1.5">
          <span className="text-sm text-ink-muted">Banque</span>
          <select value={bank} onChange={(e) => setBank(e.target.value)} className={inputClass}>
            {banks.map((b) => (
              <option key={b} value={b}>{b}</option>
            ))}
          </select>
        </label>
        <label className="flex flex-col gap-1.5">
          <span className="text-sm text-ink-muted">Mois</span>
          <select value={month} onChange={(e) => setMonth(Number(e.target.value))} className={inputClass}>
            {MONTHS_FR.map((m, i) => (
              <option key={m} value={i + 1}>{m}</option>
            ))}
          </select>
        </label>
        <label className="flex flex-col gap-1.5">
          <span className="text-sm text-ink-muted">Année</span>
          <select value={year} onChange={(e) => setYear(Number(e.target.value))} className={inputClass}>
            {years.map((y) => (
              <option key={y} value={y}>{y}</option>
            ))}
          </select>
        </label>
        <div className="flex flex-wrap gap-3 sm:ml-auto">
          <button type="button" onClick={handlePrint} disabled={loading} className="min-h-11 rounded-lg border border-border px-4 py-2 font-display text-ink-muted hover:border-ink-muted disabled:opacity-50">
            Imprimer
          </button>
          {!isViewer && (
            <button type="button" onClick={handleExport} disabled={loading || exporting} className="min-h-11 rounded-lg border border-ocre px-4 py-2 font-display text-ocre hover:bg-ocre/10 disabled:opacity-50">
              {exporting ? 'Génération…' : 'Exporter Excel'}
            </button>
          )}
        </div>
      </div>

      {locked && (
        <p className="rounded-lg border border-success/50 bg-success-bg px-4 py-3 text-sm text-success">
          Mois verrouillé{monthRow.locked_by ? ` par ${monthRow.locked_by}` : ''}
          {monthRow.locked_at ? ` le ${new Date(monthRow.locked_at).toLocaleDateString('fr-FR')}` : ''} — pointage non modifiable.
        </p>
      )}

      {error && <p className="rounded-lg border border-terracotta/50 bg-terracotta/10 px-4 py-3 text-sm text-terracotta">{error}</p>}

      <div className="flex flex-wrap gap-4 rounded-lg border border-border bg-bg-soft px-4 py-3">
        <Stat label="Report début de mois" value={data.openingBalance} />
        <Stat label="Total débit" value={data.totalDebit} className="text-terracotta" />
        <Stat label="Total crédit" value={data.totalCredit} className="text-success" />
        <Stat label="Solde fin de mois" value={data.closingBalance} className="text-ocre" />
      </div>

      {loading ? (
        <p className="text-ink-muted">Chargement…</p>
      ) : (
        <div className="overflow-x-auto rounded-lg border border-border">
          <table className="w-full min-w-[900px] border-collapse text-sm">
            <thead>
              <tr className="border-b border-border text-left">
                <Th>Date opération</Th>
                <Th>N° pièce</Th>
                <Th>Libellé</Th>
                <Th className="text-right">Débit (DA)</Th>
                <Th className="text-right">Crédit (DA)</Th>
                <Th className="text-right">Solde cumulé</Th>
                <Th className="text-center">Rapproché</Th>
              </tr>
            </thead>
            <tbody>
              <tr className="border-b border-border font-display">
                <Td />
                <Td />
                <Td>Report solde début de mois</Td>
                <Td />
                <Td />
                <Td className="text-right">{formatDA(data.openingBalance)}</Td>
                <Td />
              </tr>
              {data.rows.length === 0 && (
                <tr>
                  <Td />
                  <Td />
                  <Td className="text-ink-muted">Aucune opération ce mois.</Td>
                  <Td />
                  <Td />
                  <Td />
                  <Td />
                </tr>
              )}
              {data.rows.map((op) => (
                <OperationRow key={op.key} op={op} readOnly={readOnly} busy={busyKey === op.key} onToggle={toggleReconciled} />
              ))}
              <tr className="border-t-2 border-border font-display">
                <Td />
                <Td />
                <Td>TOTAUX DU MOIS</Td>
                <Td className="text-right text-terracotta">{formatDA(data.totalDebit)}</Td>
                <Td className="text-right text-success">{formatDA(data.totalCredit)}</Td>
                <Td className="text-right text-ocre">{formatDA(data.closingBalance)}</Td>
                <Td />
              </tr>
              {data.carriedPending.length > 0 && (
                <>
                  <tr>
                    <Td />
                    <Td />
                    <Td className="font-display text-warning">Opérations en suspens des mois précédents</Td>
                    <Td />
                    <Td />
                    <Td />
                    <Td />
                  </tr>
                  {data.carriedPending.map((op) => (
                    <OperationRow key={op.key} op={op} readOnly={readOnly} busy={busyKey === op.key} onToggle={toggleReconciled} carried />
                  ))}
                </>
              )}
            </tbody>
          </table>
        </div>
      )}

      <section className="flex flex-col gap-3 rounded-lg border border-border bg-bg-soft px-4 py-4">
        <h3 className="font-display text-base text-ink">Rapprochement bancaire</h3>
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <label className="flex flex-col gap-1.5">
            <span className="text-sm text-ink-muted">Solde du relevé bancaire au {monthBounds(year, month).end.split('-').reverse().join('/')} (DA)</span>
            <input
              type="number"
              inputMode="decimal"
              step="0.01"
              value={statementInput}
              onChange={(e) => setStatementInput(e.target.value)}
              onBlur={saveStatementBalance}
              disabled={readOnly}
              className={`${inputClass} disabled:opacity-60`}
            />
          </label>
          <div className="flex flex-col gap-1 text-sm">
            <p>Débits en suspens : <span className="font-display text-terracotta">{formatDA(data.pendingDebit)} DA</span></p>
            <p>Crédits en suspens : <span className="font-display text-success">{formatDA(data.pendingCredit)} DA</span></p>
            {summary ? (
              <>
                <p>
                  Solde rapproché (relevé + crédits − débits en suspens) :{' '}
                  <span className="font-display text-ocre">{formatDA(summary.reconciledBalance)} DA</span>
                </p>
                <p className={Math.abs(summary.gap) < 0.005 ? 'text-success' : 'text-error'}>
                  {Math.abs(summary.gap) < 0.005
                    ? '✓ Rapprochement équilibré'
                    : `Écart avec le brouillard : ${formatDA(summary.gap)} DA`}
                </p>
              </>
            ) : (
              <p className="text-ink-muted">Saisir le solde du relevé pour calculer le solde rapproché.</p>
            )}
          </div>
        </div>
        {!isViewer && (
          <div className="flex flex-wrap gap-3">
            {!locked && (
              <button type="button" onClick={lockMonth} disabled={loading || !bank} className="min-h-12 rounded-lg bg-terracotta px-5 py-3 font-display text-ink hover:bg-terracotta-hover disabled:opacity-50">
                Verrouiller le mois
              </button>
            )}
            {locked && isAdmin && (
              <button type="button" onClick={unlockMonth} className="min-h-12 rounded-lg border border-terracotta px-5 py-3 font-display text-terracotta hover:bg-terracotta/10">
                Déverrouiller (admin)
              </button>
            )}
          </div>
        )}
      </section>
    </div>
  )
}

function OperationRow({ op, readOnly, busy, onToggle, carried }) {
  return (
    <tr className={`border-b border-border ${!op.reconciled ? '' : 'opacity-80'}`}>
      <Td>{op.date?.split('-').reverse().join('/')}</Td>
      <Td className="font-mono">{op.piece}</Td>
      <Td className="max-w-[380px] truncate" title={op.label}>
        {op.label}
        {op.statut && <span className="ml-2 text-xs text-ink-muted">{op.statut}</span>}
      </Td>
      <Td className="text-right text-terracotta">{op.debit ? formatDA(op.debit) : ''}</Td>
      <Td className="text-right text-success">{op.credit ? formatDA(op.credit) : ''}</Td>
      <Td className="text-right">{carried ? '' : formatDA(op.balance)}</Td>
      <Td className="text-center">
        <input
          type="checkbox"
          checked={op.reconciled}
          disabled={readOnly || busy}
          onChange={() => onToggle(op)}
          className="h-5 w-5 cursor-pointer accent-[var(--color-success)] disabled:cursor-not-allowed pointer-coarse:h-7 pointer-coarse:w-7"
          aria-label="Rapproché"
        />
      </Td>
    </tr>
  )
}

function Stat({ label, value, className = 'text-ink' }) {
  return (
    <div>
      <p className="text-xs text-ink-muted">{label}</p>
      <p className={`font-display text-xl ${className}`}>{formatDA(value)}</p>
    </div>
  )
}

function Th({ children, className = '' }) {
  return <th className={`px-3 py-2 font-display font-medium whitespace-nowrap ${className}`}>{children}</th>
}

function Td({ children, className = '', title }) {
  return (
    <td className={`px-3 py-2 whitespace-nowrap ${className}`} title={title}>
      {children}
    </td>
  )
}

const inputClass =
  'min-h-11 rounded-lg border border-border bg-bg-soft px-3 py-2 text-ink outline-none focus:border-terracotta'
