import { useMemo, useState } from 'react'
import { supabase } from '../lib/supabase'
import { downloadGeneratedG50Excel } from '../lib/g50GenerateExcel'
import PrintHeader from './PrintHeader'

const MONTHS = [
  'Janvier', 'Février', 'Mars', 'Avril', 'Mai', 'Juin',
  'Juillet', 'Août', 'Septembre', 'Octobre', 'Novembre', 'Décembre',
]

function formatDA(value) {
  return Number(value || 0).toLocaleString('fr-FR', { maximumFractionDigits: 2 })
}

function yearOptions() {
  const current = new Date().getFullYear()
  const years = []
  for (let y = current - 5; y <= current + 1; y++) years.push(y)
  return years
}

export default function GenerateG50Tab() {
  const now = new Date()
  const [month, setMonth] = useState(now.getMonth() + 1)
  const [year, setYear] = useState(now.getFullYear())
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [exporting, setExporting] = useState(false)
  const [invoiceRows, setInvoiceRows] = useState(null)
  const [tvaDeductible, setTvaDeductible] = useState('0')
  const [irg, setIrg] = useState('0')

  const periodLabel = `${MONTHS[month - 1]} ${year}`

  async function handleCalculate() {
    setLoading(true)
    setError('')
    const startDate = `${year}-${String(month).padStart(2, '0')}-01`
    const lastDay = new Date(year, month, 0).getDate()
    const endDate = `${year}-${String(month).padStart(2, '0')}-${String(lastDay).padStart(2, '0')}`

    const { data, error: fetchError } = await supabase
      .from('invoices')
      .select('*')
      .gte('entry_date', startDate)
      .lte('entry_date', endDate)
      .order('entry_date', { ascending: true })
      .order('invoice_number', { ascending: true })

    setLoading(false)
    if (fetchError) {
      setError(`Erreur de chargement : ${fetchError.message}`)
      return
    }
    setInvoiceRows(data ?? [])
  }

  const recap = useMemo(() => {
    if (!invoiceRows) return null
    const caBrut = invoiceRows.reduce((s, e) => s + (Number(e.amount) || 0), 0)
    const totalRemises = invoiceRows.reduce((s, e) => s + (Number(e.discount_amount) || 0), 0)
    const caImposable = caBrut - totalRemises
    const tapDue = caImposable * 0.01
    const tvaCollectee = invoiceRows.reduce((s, e) => s + (Number(e.total_tva) || 0), 0)
    const tvaDeductibleNum = Number(tvaDeductible) || 0
    const tvaAPayer = tvaCollectee - tvaDeductibleNum
    const totalTimbre = invoiceRows.reduce((s, e) => s + (Number(e.stamp_duty) || 0), 0)
    const irgNum = Number(irg) || 0
    const totalAPayer = tapDue + tvaAPayer + totalTimbre + irgNum
    return {
      caBrut,
      totalRemises,
      caImposable,
      tapDue,
      tvaCollectee,
      tvaDeductible: tvaDeductibleNum,
      tvaAPayer,
      totalTimbre,
      irg: irgNum,
      totalAPayer,
    }
  }, [invoiceRows, tvaDeductible, irg])

  const chequeRows = useMemo(() => (invoiceRows ?? []).filter((e) => e.payment_status === 'Chèque'), [invoiceRows])
  const especeRows = useMemo(() => (invoiceRows ?? []).filter((e) => e.payment_status === 'Espèces'), [invoiceRows])

  async function handleExport() {
    if (!invoiceRows || !recap) return
    setExporting(true)
    try {
      await downloadGeneratedG50Excel({ periodLabel, invoiceRows, recap })
    } catch (err) {
      setError(`Erreur lors de la génération du fichier Excel : ${err.message}`)
    } finally {
      setExporting(false)
    }
  }

  return (
    <div className="flex flex-col gap-4">
      <div className="no-print flex flex-col gap-3 rounded-lg border border-border bg-bg-soft px-4 py-3 sm:flex-row sm:items-end sm:gap-4">
        <label className="flex flex-col gap-1.5">
          <span className="text-sm text-ink-muted">Mois</span>
          <select
            value={month}
            onChange={(e) => setMonth(Number(e.target.value))}
            className="min-h-11 rounded-lg border border-border bg-bg px-3 py-2 text-ink outline-none focus:border-terracotta"
          >
            {MONTHS.map((m, i) => (
              <option key={m} value={i + 1}>
                {m}
              </option>
            ))}
          </select>
        </label>
        <label className="flex flex-col gap-1.5">
          <span className="text-sm text-ink-muted">Année</span>
          <select
            value={year}
            onChange={(e) => setYear(Number(e.target.value))}
            className="min-h-11 rounded-lg border border-border bg-bg px-3 py-2 text-ink outline-none focus:border-terracotta"
          >
            {yearOptions().map((y) => (
              <option key={y} value={y}>
                {y}
              </option>
            ))}
          </select>
        </label>
        <button
          type="button"
          onClick={handleCalculate}
          disabled={loading}
          className="min-h-11 rounded-lg bg-terracotta px-4 py-2 font-display font-medium text-ink transition-colors hover:bg-terracotta-hover disabled:opacity-50"
        >
          {loading ? 'Calcul en cours…' : 'Calculer'}
        </button>
      </div>

      {error && (
        <p className="no-print rounded-lg border border-terracotta/50 bg-terracotta/10 px-4 py-3 text-sm text-terracotta">
          {error}
        </p>
      )}

      {invoiceRows && recap && (
        <div className="print-area flex flex-col gap-6">
          <PrintHeader title={`Déclaration G50 — ${periodLabel}`} />

          <div className="overflow-hidden rounded-lg border border-border">
            <table className="w-full border-collapse text-sm">
              <tbody>
                <SectionHeader label="TAP" />
                <RecapRow label="CA brut" value={recap.caBrut} />
                <RecapRow label="Total remises" value={recap.totalRemises} />
                <RecapRow label="CA imposable" value={recap.caImposable} />
                <RecapRow label="TAP due (1%)" value={recap.tapDue} highlight />

                <SectionHeader label="TVA" />
                <RecapRow label="TVA collectée" value={recap.tvaCollectee} />
                <RecapRow
                  label="TVA déductible"
                  value={tvaDeductible}
                  editable
                  onChange={setTvaDeductible}
                />
                <RecapRow label="TVA à payer" value={recap.tvaAPayer} highlight />

                <SectionHeader label="Timbre" />
                <RecapRow label="Total timbre" value={recap.totalTimbre} highlight />

                <SectionHeader label="IRG" />
                <RecapRow label="IRG" value={irg} editable onChange={setIrg} />

                <SectionHeader label="Récapitulatif" />
                <tr className="bg-ocre/20">
                  <td className="px-4 py-3 font-display text-lg text-ink">TOTAL À PAYER</td>
                  <td className="px-4 py-3 text-right font-display text-lg font-bold text-ocre">
                    {formatDA(recap.totalAPayer)} DA
                  </td>
                </tr>
              </tbody>
            </table>
          </div>

          <div className="no-print flex flex-wrap gap-2">
            <button
              type="button"
              onClick={() => window.print()}
              className="min-h-11 rounded-lg border border-border px-4 py-2 font-display text-ink-muted transition-colors hover:border-ink-muted"
            >
              Imprimer le G50
            </button>
            <button
              type="button"
              onClick={handleExport}
              disabled={exporting}
              className="min-h-11 rounded-lg border border-ocre px-4 py-2 font-display text-ocre transition-colors hover:bg-ocre/10 disabled:cursor-not-allowed disabled:opacity-50"
            >
              {exporting ? 'Génération…' : 'Exporter Excel'}
            </button>
          </div>

          <div>
            <h3 className="mb-2 font-display text-lg text-ink">Relevé des Factures de Ventes — {periodLabel}</h3>
            <InvoiceDetailTable rows={invoiceRows} />
          </div>

          <div>
            <h3 className="mb-2 font-display text-lg text-ink">Banque / Chèque</h3>
            <ChequeTable rows={chequeRows} />
          </div>

          <div>
            <h3 className="mb-2 font-display text-lg text-ink">Espèces</h3>
            <EspeceTable rows={especeRows} />
          </div>
        </div>
      )}
    </div>
  )
}

function SectionHeader({ label }) {
  return (
    <tr>
      <td colSpan={2} className="bg-terracotta px-4 py-2 font-display font-semibold tracking-wide text-ink">
        {label}
      </td>
    </tr>
  )
}

function RecapRow({ label, value, editable, onChange, highlight }) {
  return (
    <tr className={highlight ? 'bg-bg-card' : 'bg-bg-soft'}>
      <td className="px-4 py-2 text-ink-muted">{label}</td>
      <td className="px-4 py-2 text-right">
        {editable ? (
          <input
            type="number"
            step="0.01"
            value={value}
            onChange={(e) => onChange(e.target.value)}
            className="no-print min-h-9 w-40 rounded border border-border bg-bg px-2 py-1 text-right text-ink outline-none focus:border-terracotta"
          />
        ) : (
          <span className={`font-display font-bold ${highlight ? 'text-ocre' : 'text-ink'}`}>{formatDA(value)} DA</span>
        )}
        {editable && <span className="hidden print:inline font-display font-bold text-ink">{formatDA(value)} DA</span>}
      </td>
    </tr>
  )
}

function InvoiceDetailTable({ rows }) {
  if (rows.length === 0) return <p className="text-ink-muted">Aucune facture sur cette période.</p>
  const totals = rows.reduce(
    (acc, e) => ({
      total_ht: acc.total_ht + (Number(e.amount) || 0),
      discount_amount: acc.discount_amount + (Number(e.discount_amount) || 0),
      total_tva: acc.total_tva + (Number(e.total_tva) || 0),
      total_ttc: acc.total_ttc + (Number(e.total_ttc) || 0),
      stamp_duty: acc.stamp_duty + (Number(e.stamp_duty) || 0),
      total_net: acc.total_net + (Number(e.total_net) || 0),
    }),
    { total_ht: 0, discount_amount: 0, total_tva: 0, total_ttc: 0, stamp_duty: 0, total_net: 0 }
  )
  return (
    <div className="overflow-x-auto rounded-lg border border-border">
      <table className="w-full min-w-[900px] border-collapse text-[11px] sm:text-sm">
        <thead>
          <tr className="border-b border-border bg-bg-soft text-left text-ink-muted">
            <Th>N° Facture</Th>
            <Th>Date</Th>
            <Th>Client</Th>
            <Th>Total HT</Th>
            <Th>Remise</Th>
            <Th>TVA</Th>
            <Th>TTC</Th>
            <Th>Timbre</Th>
            <Th>Total Net</Th>
          </tr>
        </thead>
        <tbody>
          {rows.map((e) => (
            <tr key={e.id} className="border-b border-border last:border-0">
              <Td>{e.invoice_number}</Td>
              <Td>{e.entry_date}</Td>
              <Td>{e.client_name}</Td>
              <Td>{formatDA(e.amount)}</Td>
              <Td>{formatDA(e.discount_amount)}</Td>
              <Td>{formatDA(e.total_tva)}</Td>
              <Td>{formatDA(e.total_ttc)}</Td>
              <Td>{formatDA(e.stamp_duty)}</Td>
              <Td>{formatDA(e.total_net)}</Td>
            </tr>
          ))}
          <tr className="bg-ocre/10 font-display font-bold">
            <Td>TOTAL</Td>
            <Td></Td>
            <Td></Td>
            <Td>{formatDA(totals.total_ht)}</Td>
            <Td>{formatDA(totals.discount_amount)}</Td>
            <Td>{formatDA(totals.total_tva)}</Td>
            <Td>{formatDA(totals.total_ttc)}</Td>
            <Td>{formatDA(totals.stamp_duty)}</Td>
            <Td>{formatDA(totals.total_net)}</Td>
          </tr>
        </tbody>
      </table>
    </div>
  )
}

function ChequeTable({ rows }) {
  if (rows.length === 0) return <p className="text-ink-muted">Aucun règlement par chèque sur cette période.</p>
  const total = rows.reduce((s, e) => s + (Number(e.settlement) || 0), 0)
  return (
    <div className="overflow-x-auto rounded-lg border border-border">
      <table className="w-full min-w-[700px] border-collapse text-[11px] sm:text-sm">
        <thead>
          <tr className="border-b border-border bg-bg-soft text-left text-ink-muted">
            <Th>N° Facture</Th>
            <Th>Client</Th>
            <Th>Date</Th>
            <Th>N° Chèque</Th>
            <Th>Banque</Th>
            <Th>Montant réglé</Th>
          </tr>
        </thead>
        <tbody>
          {rows.map((e) => (
            <tr key={e.id} className="border-b border-border last:border-0">
              <Td>{e.invoice_number}</Td>
              <Td>{e.client_name}</Td>
              <Td>{e.entry_date}</Td>
              <Td>{e.cheque_number ?? '—'}</Td>
              <Td>{e.cheque_bank ?? '—'}</Td>
              <Td>{formatDA(e.settlement)}</Td>
            </tr>
          ))}
          <tr className="bg-ocre/10 font-display font-bold">
            <Td>TOTAL</Td>
            <Td></Td>
            <Td></Td>
            <Td></Td>
            <Td></Td>
            <Td>{formatDA(total)}</Td>
          </tr>
        </tbody>
      </table>
    </div>
  )
}

function EspeceTable({ rows }) {
  if (rows.length === 0) return <p className="text-ink-muted">Aucun règlement en espèces sur cette période.</p>
  const total = rows.reduce((s, e) => s + (Number(e.settlement) || 0), 0)
  return (
    <div className="overflow-x-auto rounded-lg border border-border">
      <table className="w-full min-w-[500px] border-collapse text-[11px] sm:text-sm">
        <thead>
          <tr className="border-b border-border bg-bg-soft text-left text-ink-muted">
            <Th>N° Facture</Th>
            <Th>Client</Th>
            <Th>Date</Th>
            <Th>Montant réglé</Th>
          </tr>
        </thead>
        <tbody>
          {rows.map((e) => (
            <tr key={e.id} className="border-b border-border last:border-0">
              <Td>{e.invoice_number}</Td>
              <Td>{e.client_name}</Td>
              <Td>{e.entry_date}</Td>
              <Td>{formatDA(e.settlement)}</Td>
            </tr>
          ))}
          <tr className="bg-ocre/10 font-display font-bold">
            <Td>TOTAL</Td>
            <Td></Td>
            <Td></Td>
            <Td>{formatDA(total)}</Td>
          </tr>
        </tbody>
      </table>
    </div>
  )
}

function Th({ children }) {
  return <th className="px-1 py-1 font-display font-medium whitespace-nowrap sm:px-3 sm:py-2">{children}</th>
}

function Td({ children }) {
  return <td className="px-1 py-1 whitespace-nowrap sm:px-3 sm:py-2">{children}</td>
}
