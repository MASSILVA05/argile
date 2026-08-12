import { useState } from 'react'
import { supabase } from '../lib/supabase'
import { getSession } from '../lib/auth'
import { parseTvaPayerImportFile } from '../lib/tvaPayerImportParser'

function formatDA(value) {
  return Number(value || 0).toLocaleString('fr-FR', { maximumFractionDigits: 2 })
}

function formatDateFR(iso) {
  const [y, m, d] = iso.split('-')
  return `${d}/${m}/${y}`
}

export default function TVAPayerImportTab() {
  const [fileName, setFileName] = useState('')
  const [rows, setRows] = useState([])
  const [parseError, setParseError] = useState('')
  const [importing, setImporting] = useState(false)
  const [progress, setProgress] = useState(null)
  const [summary, setSummary] = useState(null)

  const selectedCount = rows.filter((r) => r.selected).length

  async function handleFileChange(e) {
    const file = e.target.files?.[0]
    if (!file) return
    setSummary(null)
    setParseError('')
    setFileName(file.name)
    try {
      const arrayBuffer = await file.arrayBuffer()
      const parsed = parseTvaPayerImportFile(arrayBuffer)
      if (parsed.length === 0) {
        setParseError("Aucune ligne de facture détectée dans le fichier.")
      }
      setRows(parsed.map((r) => ({ ...r, selected: true })))
    } catch (err) {
      setRows([])
      setParseError(`Erreur de lecture du fichier : ${err.message}`)
    }
  }

  function toggleRow(invoiceNumber) {
    setRows((current) =>
      current.map((r) => (r.invoice_number === invoiceNumber ? { ...r, selected: !r.selected } : r))
    )
  }

  function toggleAll(checked) {
    setRows((current) => current.map((r) => ({ ...r, selected: checked })))
  }

  async function handleImport() {
    const toImport = rows.filter((r) => r.selected)
    if (toImport.length === 0) return
    setImporting(true)
    setSummary(null)
    setProgress({ done: 0, total: toImport.length })

    const username = getSession()?.username ?? null
    let imported = 0
    let errors = 0
    const errorDetails = []

    for (let i = 0; i < toImport.length; i++) {
      const row = toImport[i]
      try {
        const payload = {
          invoice_number: row.invoice_number,
          entry_date: row.entry_date,
          client_name: row.client_name,
          total_ht: row.total_ht,
          discount_amount: row.discount_amount,
          stamp_duty: row.stamp_duty,
          payment_mode: row.payment_mode,
          ref_commande: row.ref_commande,
          ref_livraison: row.ref_livraison,
          observations: 'Importé depuis fichier Excel',
          entered_by_user: username,
        }

        const { error: upsertError } = await supabase
          .from('tva_payer_entries')
          .upsert(payload, { onConflict: 'invoice_number' })

        if (upsertError) throw upsertError

        imported += 1
      } catch (err) {
        errors += 1
        errorDetails.push(`${row.invoice_number} : ${err.message}`)
      }
      setProgress({ done: i + 1, total: toImport.length })
    }

    setSummary({ imported, errors, errorDetails })
    setImporting(false)
    setProgress(null)
  }

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-col gap-2">
        <label className="min-h-11 inline-flex w-fit cursor-pointer items-center rounded-lg border border-ocre px-4 py-2 font-display text-ocre transition-colors hover:bg-ocre/10">
          Choisir un fichier .xls/.xlsx
          <input type="file" accept=".xls,.xlsx" onChange={handleFileChange} className="hidden" />
        </label>
        {fileName && <p className="text-sm text-ink-muted">Fichier : {fileName}</p>}
        <p className="text-xs text-ink-muted">
          Format attendu : "Etat Relevé Facture de Ventes" (Numéro, Du, Client, Total HT, Remise, Timbre, Réf.
          Commande, Réf. Livraison). TVA/TTC/Total net sont recalculés automatiquement à l'import.
        </p>
      </div>

      {parseError && (
        <p className="rounded-lg border border-terracotta/50 bg-terracotta/10 px-4 py-3 text-sm text-terracotta">
          {parseError}
        </p>
      )}

      {rows.length > 0 && (
        <>
          <div className="flex flex-wrap items-center gap-4 rounded-lg border border-border bg-bg-soft px-4 py-3">
            <label className="flex items-center gap-2 text-sm">
              <input
                type="checkbox"
                checked={selectedCount === rows.length}
                onChange={(e) => toggleAll(e.target.checked)}
              />
              Tout sélectionner
            </label>
            <p className="text-sm text-ink-muted">
              {rows.length} facture{rows.length > 1 ? 's' : ''} détectée{rows.length > 1 ? 's' : ''}, {selectedCount}{' '}
              sélectionnée{selectedCount > 1 ? 's' : ''}
            </p>
          </div>

          <div className="overflow-x-auto rounded-lg border border-border">
            <table className="w-full min-w-[1200px] border-collapse text-[11px] sm:text-sm">
              <thead>
                <tr className="border-b border-border bg-bg-soft text-left text-ink-muted">
                  <Th></Th>
                  <Th>Numéro</Th>
                  <Th>Du</Th>
                  <Th>Client</Th>
                  <Th>Total HT</Th>
                  <Th>Remise</Th>
                  <Th>Timbre</Th>
                  <Th>Paiement</Th>
                  <Th>Réf. Commande</Th>
                  <Th>Réf. Livraison</Th>
                </tr>
              </thead>
              <tbody>
                {rows.map((row) => (
                  <tr key={row.invoice_number} className="border-b border-border last:border-0">
                    <Td>
                      <input type="checkbox" checked={row.selected} onChange={() => toggleRow(row.invoice_number)} />
                    </Td>
                    <Td>{row.invoice_number}</Td>
                    <Td>{formatDateFR(row.entry_date)}</Td>
                    <Td>{row.client_name}</Td>
                    <Td>{formatDA(row.total_ht)}</Td>
                    <Td>{formatDA(row.discount_amount)}</Td>
                    <Td>{formatDA(row.stamp_duty)}</Td>
                    <Td>{row.payment_mode}</Td>
                    <Td>{row.ref_commande ?? ''}</Td>
                    <Td>{row.ref_livraison ?? ''}</Td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {progress && (
            <div className="flex flex-col gap-1">
              <div className="h-2 w-full overflow-hidden rounded-full bg-bg-soft">
                <div
                  className="h-full bg-terracotta transition-all"
                  style={{ width: `${(progress.done / progress.total) * 100}%` }}
                />
              </div>
              <p className="text-xs text-ink-muted">
                {progress.done} / {progress.total}
              </p>
            </div>
          )}

          {summary && (
            <div className="rounded-lg border border-ocre/50 bg-ocre/10 px-4 py-3 text-sm text-ocre">
              <p>
                {summary.imported} facture{summary.imported > 1 ? 's' : ''} importée{summary.imported > 1 ? 's' : ''},{' '}
                {summary.errors} erreur{summary.errors > 1 ? 's' : ''}
              </p>
              {summary.errorDetails.length > 0 && (
                <ul className="mt-2 list-disc pl-5 text-terracotta">
                  {summary.errorDetails.map((d) => (
                    <li key={d}>{d}</li>
                  ))}
                </ul>
              )}
            </div>
          )}

          <button
            type="button"
            onClick={handleImport}
            disabled={importing || selectedCount === 0}
            className="min-h-12 rounded-lg bg-terracotta px-4 py-3 font-display text-lg font-medium tracking-wide text-ink transition-colors hover:bg-terracotta-hover disabled:opacity-50"
          >
            {importing ? 'Import en cours…' : `Importer les lignes sélectionnées (${selectedCount})`}
          </button>
        </>
      )}
    </div>
  )
}

function Th({ children }) {
  return <th className="px-1 py-1 font-display font-medium whitespace-nowrap sm:px-3 sm:py-2">{children}</th>
}

function Td({ children }) {
  return <td className="px-1 py-1 whitespace-nowrap sm:px-3 sm:py-2">{children}</td>
}
