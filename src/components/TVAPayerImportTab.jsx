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

const CHUNK = 200

function chunk(arr, size) {
  const out = []
  for (let i = 0; i < arr.length; i += size) out.push(arr.slice(i, i + size))
  return out
}

export default function TVAPayerImportTab({ entityFilter }) {
  const [fileName, setFileName] = useState('')
  const [rows, setRows] = useState([])
  const [parseError, setParseError] = useState('')
  const [checking, setChecking] = useState(false)
  const [importing, setImporting] = useState(false)
  const [progress, setProgress] = useState(null)
  const [summary, setSummary] = useState(null)

  const selectedCount = rows.filter((r) => r.selected).length
  const missingEntityCount = rows.filter((r) => r.selected && !(r.entity || entityFilter)).length

  async function handleFileChange(e) {
    const file = e.target.files?.[0]
    if (!file) return
    setSummary(null)
    setParseError('')
    setFileName(file.name)
    setRows([])
    try {
      const arrayBuffer = await file.arrayBuffer()
      const parsed = parseTvaPayerImportFile(arrayBuffer)
      if (parsed.length === 0) {
        setParseError('Aucune ligne de facture détectée dans le fichier.')
        return
      }

      // Pré-vérification : quelles factures existent déjà (par n°) -> statut
      // 🆕 Nouvelle / 🔄 Mise à jour, détermine ensuite INSERT vs UPDATE.
      setChecking(true)
      const invoiceNumbers = parsed.map((r) => r.invoice_number)
      const existing = new Set()
      for (const part of chunk(invoiceNumbers, CHUNK)) {
        const { data } = await supabase.from('tva_payer_entries').select('invoice_number').in('invoice_number', part)
        for (const row of data ?? []) existing.add(row.invoice_number)
      }
      setChecking(false)

      setRows(parsed.map((r) => ({ ...r, selected: true, exists: existing.has(r.invoice_number) })))
    } catch (err) {
      setChecking(false)
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
    const toImport = rows.filter((r) => r.selected && (r.entity || entityFilter))
    if (toImport.length === 0) return
    setImporting(true)
    setSummary(null)
    setProgress({ done: 0, total: toImport.length })

    const username = getSession()?.username ?? null
    let created = 0
    let updated = 0
    let errors = 0
    const errorDetails = []

    for (let i = 0; i < toImport.length; i++) {
      const row = toImport[i]
      try {
        // Champs "métier" -- toujours importables, en création comme en
        // mise à jour.
        const baseFields = {
          entity: row.entity || entityFilter,
          entry_date: row.entry_date,
          client_name: row.client_name,
          total_ht: row.total_ht,
          discount_amount: row.discount_amount,
          stamp_duty: row.stamp_duty,
          ref_commande: row.ref_commande,
          ref_livraison: row.ref_livraison,
        }
        // Pas de colonne Observations dans ce format -- on ne touche jamais
        // une note déjà saisie manuellement sur une facture existante. Pour
        // une nouvelle facture, on pose un repère.
        if (!row.exists) baseFields.observations = 'Importé depuis fichier Excel'

        if (row.exists) {
          // Mise à jour : ne touche JAMAIS payment_mode / cheque_number /
          // cheque_bank (paiement déjà enregistré), ni l'id ni le n° de
          // facture (clé de correspondance, utilisée uniquement dans le
          // .eq() ci-dessous).
          const { error: updateError } = await supabase
            .from('tva_payer_entries')
            .update(baseFields)
            .eq('invoice_number', row.invoice_number)
          if (updateError) throw updateError
          updated += 1
        } else {
          const { error: insertError } = await supabase.from('tva_payer_entries').insert({
            invoice_number: row.invoice_number,
            ...baseFields,
            payment_mode: 'Non payé',
            entered_by_user: username,
          })
          if (insertError) throw insertError
          created += 1
        }
      } catch (err) {
        errors += 1
        errorDetails.push(`${row.invoice_number} : ${err.message}`)
      }
      setProgress({ done: i + 1, total: toImport.length })
    }

    setSummary({ created, updated, errors, errorDetails })
    setImporting(false)
    setProgress(null)
  }

  return (
    <div className="flex flex-col gap-4">
      {!entityFilter && (
        <p className="rounded-lg border border-ocre/50 bg-ocre/10 px-4 py-3 text-sm text-ocre">
          Choisissez une entité précise (Briqueterie ou AVADOU) dans le sélecteur en haut de la page, ou assurez-vous
          que le fichier contient une colonne "Entité" — l'import est bloqué pour les lignes sans entité connue.
        </p>
      )}

      <div className="flex flex-col gap-2">
        <label className="min-h-11 inline-flex w-fit cursor-pointer items-center rounded-lg border border-ocre px-4 py-2 font-display text-ocre transition-colors hover:bg-ocre/10">
          Importer des factures
          <input type="file" accept=".xls,.xlsx" onChange={handleFileChange} className="hidden" />
        </label>
        {fileName && <p className="text-sm text-ink-muted">Fichier : {fileName}</p>}
        <p className="text-xs text-ink-muted">
          Même format que l'export Excel du registre (Numéro, Entité, Du, Client, Total HT, Remise, Timbre, Réf.
          Commande, Réf. Livraison) ou fichier "Etat Relevé Facture de Ventes" — colonnes détectées par en-tête,
          insensible à la casse/accents. Le n° de facture sert de clé : une facture déjà existante est mise à jour
          (jamais dupliquée), une nouvelle est créée. Le mode de paiement n'est jamais modifié par l'import.
          {entityFilter && ` Entité par défaut : ${entityFilter} (utilisée si le fichier n'a pas de colonne Entité).`}
        </p>
      </div>

      {checking && <p className="text-sm text-ink-muted">Vérification des factures existantes…</p>}

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
              {' — '}
              {rows.filter((r) => r.exists).length} mise{rows.filter((r) => r.exists).length > 1 ? 's' : ''} à jour,{' '}
              {rows.filter((r) => !r.exists).length} nouvelle{rows.filter((r) => !r.exists).length > 1 ? 's' : ''}
            </p>
          </div>

          {missingEntityCount > 0 && (
            <p className="rounded-lg border border-terracotta/50 bg-terracotta/10 px-4 py-3 text-sm text-terracotta">
              {missingEntityCount} ligne(s) sélectionnée(s) sans entité connue — elles seront ignorées à l'import.
            </p>
          )}

          <div className="overflow-x-auto rounded-lg border border-border">
            <table className="w-full min-w-[1300px] border-collapse text-[11px] sm:text-sm">
              <thead>
                <tr className="border-b border-border bg-bg-soft text-left text-ink-muted">
                  <Th></Th>
                  <Th>Statut</Th>
                  <Th>Numéro</Th>
                  <Th>Entité</Th>
                  <Th>Du</Th>
                  <Th>Client</Th>
                  <Th>Total HT</Th>
                  <Th>Remise</Th>
                  <Th>Timbre</Th>
                  <Th>Réf. Commande</Th>
                  <Th>Réf. Livraison</Th>
                </tr>
              </thead>
              <tbody>
                {rows.map((row) => (
                  <tr
                    key={row.invoice_number}
                    className={`border-b border-border last:border-0 ${row.exists ? 'bg-yellow-500/10' : ''}`}
                  >
                    <Td>
                      <input type="checkbox" checked={row.selected} onChange={() => toggleRow(row.invoice_number)} />
                    </Td>
                    <Td>{row.exists ? '🔄 Mise à jour' : '🆕 Nouvelle'}</Td>
                    <Td>{row.invoice_number}</Td>
                    <Td className={!(row.entity || entityFilter) ? 'font-medium text-terracotta' : ''}>
                      {row.entity || entityFilter || 'manquante'}
                    </Td>
                    <Td>{formatDateFR(row.entry_date)}</Td>
                    <Td>{row.client_name}</Td>
                    <Td>{formatDA(row.total_ht)}</Td>
                    <Td>{formatDA(row.discount_amount)}</Td>
                    <Td>{formatDA(row.stamp_duty)}</Td>
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
                {summary.created} créée{summary.created > 1 ? 's' : ''}, {summary.updated} mise
                {summary.updated > 1 ? 's' : ''} à jour, {summary.errors} erreur{summary.errors > 1 ? 's' : ''}
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
            {importing ? 'Import en cours…' : `Importer ${selectedCount} facture${selectedCount > 1 ? 's' : ''}`}
          </button>
        </>
      )}
    </div>
  )
}

function Th({ children }) {
  return <th className="px-1 py-1 font-display font-medium whitespace-nowrap sm:px-3 sm:py-2">{children}</th>
}

function Td({ children, className = '' }) {
  return <td className={`px-1 py-1 whitespace-nowrap sm:px-3 sm:py-2 ${className}`}>{children}</td>
}
