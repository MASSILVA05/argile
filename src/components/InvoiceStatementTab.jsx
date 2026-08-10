import { useMemo, useState } from 'react'
import { supabase } from '../lib/supabase'
import { downloadInvoiceStatementExcel } from '../lib/invoiceStatementExcel'

function startOfMonthISO() {
  const d = new Date()
  return new Date(d.getFullYear(), d.getMonth(), 1).toISOString().slice(0, 10)
}

function endOfMonthISO() {
  const d = new Date()
  return new Date(d.getFullYear(), d.getMonth() + 1, 0).toISOString().slice(0, 10)
}

function formatDateFR(iso) {
  const [y, m, d] = iso.split('-')
  return `${d}/${m}/${y}`
}

function formatDA(value) {
  return Number(value || 0).toLocaleString('fr-FR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
}

export default function InvoiceStatementTab() {
  const [startDate, setStartDate] = useState(startOfMonthISO())
  const [endDate, setEndDate] = useState(endOfMonthISO())
  const [entries, setEntries] = useState([])
  const [generated, setGenerated] = useState(false)
  const [generatedRange, setGeneratedRange] = useState({ startDate, endDate })
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [exporting, setExporting] = useState(false)

  const totals = useMemo(
    () =>
      entries.reduce(
        (acc, e) => ({
          count: acc.count + 1,
          amount: acc.amount + Number(e.amount || 0),
          discount: acc.discount + Number(e.discount_amount || 0),
          totalTva: acc.totalTva + Number(e.total_tva || 0),
          totalTtc: acc.totalTtc + Number(e.total_ttc || 0),
          stampDuty: acc.stampDuty + Number(e.stamp_duty || 0),
          totalNet: acc.totalNet + Number(e.total_net || 0),
        }),
        { count: 0, amount: 0, discount: 0, totalTva: 0, totalTtc: 0, stampDuty: 0, totalNet: 0 }
      ),
    [entries]
  )

  async function handleGenerate() {
    setLoading(true)
    setError('')
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
    setEntries(data ?? [])
    setGeneratedRange({ startDate, endDate })
    setGenerated(true)
  }

  async function handleExport() {
    setExporting(true)
    try {
      await downloadInvoiceStatementExcel(entries, generatedRange)
    } catch (err) {
      setError(`Erreur lors de la génération du fichier Excel : ${err.message}`)
    } finally {
      setExporting(false)
    }
  }

  return (
    <div className="flex flex-col gap-4">
      <div className="no-print flex flex-col gap-3 sm:flex-row sm:flex-wrap sm:items-end">
        <label className="flex flex-col gap-1">
          <span className="text-sm text-ink-muted">Du</span>
          <input
            type="date"
            value={startDate}
            onChange={(e) => setStartDate(e.target.value)}
            className="min-h-11 rounded-lg border border-border bg-bg-soft px-3 py-2 text-ink outline-none focus:border-terracotta"
          />
        </label>
        <label className="flex flex-col gap-1">
          <span className="text-sm text-ink-muted">Au</span>
          <input
            type="date"
            value={endDate}
            onChange={(e) => setEndDate(e.target.value)}
            className="min-h-11 rounded-lg border border-border bg-bg-soft px-3 py-2 text-ink outline-none focus:border-terracotta"
          />
        </label>
        <button
          type="button"
          onClick={handleGenerate}
          disabled={loading}
          className="min-h-11 rounded-lg bg-terracotta px-4 py-2 font-display text-ink transition-colors hover:bg-terracotta-hover disabled:opacity-50"
        >
          {loading ? 'Génération…' : 'Générer'}
        </button>
        {generated && (
          <div className="flex gap-2 sm:ml-auto">
            <button
              type="button"
              onClick={() => window.print()}
              className="min-h-11 rounded-lg border border-border px-4 py-2 font-display text-ink-muted transition-colors hover:border-ink-muted"
            >
              Imprimer
            </button>
            <button
              type="button"
              onClick={handleExport}
              disabled={exporting}
              className="min-h-11 rounded-lg border border-ocre px-4 py-2 font-display text-ocre transition-colors hover:bg-ocre/10 disabled:cursor-not-allowed disabled:opacity-50"
            >
              {exporting ? 'Génération en cours…' : 'Exporter Excel'}
            </button>
          </div>
        )}
      </div>

      {error && (
        <p className="no-print rounded-lg border border-terracotta/50 bg-terracotta/10 px-4 py-3 text-sm text-terracotta">
          {error}
        </p>
      )}

      {generated && (
        <div className="print-area">
          <div className="mb-4 text-center">
            <p className="font-display text-lg font-semibold text-ink">SARL DPR AXXAM</p>
            <p className="font-display text-base text-ink">Relevé des Factures de Ventes</p>
            <p className="text-sm text-ink-muted">
              Période du {formatDateFR(generatedRange.startDate)} Au {formatDateFR(generatedRange.endDate)}
            </p>
          </div>

          {entries.length === 0 ? (
            <p className="text-ink-muted">Aucune facture sur cette période.</p>
          ) : (
            <div className="overflow-x-auto rounded-lg border border-border">
              <table className="w-full min-w-[1400px] border-collapse text-[11px] sm:text-sm">
                <thead>
                  <tr className="border-b border-border bg-bg-soft text-left text-ink-muted">
                    <Th>Numéro</Th>
                    <Th>Du</Th>
                    <Th>Client</Th>
                    <Th align="right">Total HT</Th>
                    <Th align="right">Remise</Th>
                    <Th align="right">Total TVA</Th>
                    <Th align="right">Total TTC</Th>
                    <Th align="right">Timbre</Th>
                    <Th align="right">Total net</Th>
                    <Th>Réf. Commande</Th>
                    <Th>Réf. Livraison</Th>
                  </tr>
                </thead>
                <tbody>
                  {entries.map((e) => (
                    <tr key={e.id} className="border-b border-border last:border-0">
                      <Td>{e.invoice_number}</Td>
                      <Td>{formatDateFR(e.entry_date)}</Td>
                      <Td>{e.client_name}</Td>
                      <Td align="right">{formatDA(e.amount)}</Td>
                      <Td align="right">{formatDA(e.discount_amount)}</Td>
                      <Td align="right">{formatDA(e.total_tva)}</Td>
                      <Td align="right">{formatDA(e.total_ttc)}</Td>
                      <Td align="right">{formatDA(e.stamp_duty)}</Td>
                      <Td align="right">{formatDA(e.total_net)}</Td>
                      <Td>{e.ref_commande ?? ''}</Td>
                      <Td>{e.ref_livraison ?? ''}</Td>
                    </tr>
                  ))}
                </tbody>
                <tfoot>
                  <tr className="border-t-2 border-border font-display font-semibold text-ink">
                    <Td>Nombre de lignes :</Td>
                    <Td>{totals.count}</Td>
                    <Td></Td>
                    <Td align="right">{formatDA(totals.amount)}</Td>
                    <Td align="right">{formatDA(totals.discount)}</Td>
                    <Td align="right">{formatDA(totals.totalTva)}</Td>
                    <Td align="right">{formatDA(totals.totalTtc)}</Td>
                    <Td align="right">{formatDA(totals.stampDuty)}</Td>
                    <Td align="right">{formatDA(totals.totalNet)}</Td>
                    <Td></Td>
                    <Td></Td>
                  </tr>
                </tfoot>
              </table>
            </div>
          )}
        </div>
      )}
    </div>
  )
}

function Th({ children, align }) {
  return (
    <th
      className={`px-1 py-1 font-display font-medium whitespace-nowrap sm:px-3 sm:py-2 ${align === 'right' ? 'text-right' : 'text-left'}`}
    >
      {children}
    </th>
  )
}

function Td({ children, align }) {
  return (
    <td className={`px-1 py-1 whitespace-nowrap sm:px-3 sm:py-2 ${align === 'right' ? 'text-right' : 'text-left'}`}>
      {children}
    </td>
  )
}
