import { useState } from 'react'
import { supabase } from '../lib/supabase'
import { getSession } from '../lib/auth'
import { parseTvaImportFile } from '../lib/tvaImportParser'
import { recoveryLabel } from '../lib/tvaPayment'

function formatDA(value) {
  return Number(value || 0).toLocaleString('fr-FR', { maximumFractionDigits: 2 })
}

function formatDANullable(value) {
  return value == null ? '—' : formatDA(value)
}

const CHUNK = 200

function chunk(arr, size) {
  const out = []
  for (let i = 0; i < arr.length; i += size) out.push(arr.slice(i, i + size))
  return out
}

export default function TVAImportTab({ entityFilter }) {
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
      const parsed = parseTvaImportFile(arrayBuffer)
      if (parsed.length === 0) {
        setParseError('Aucune ligne de facture détectée dans le fichier.')
        return
      }

      // Pré-vérification : quelles factures existent déjà (par n°) -> statut
      // 🆕 Nouvelle / 🔄 Mise à jour affiché dans l'aperçu, et détermine
      // ensuite si l'import fera un INSERT ou un UPDATE pour chaque ligne.
      setChecking(true)
      const invoiceNumbers = parsed.map((r) => r.invoice_number)
      const existing = new Set()
      for (const part of chunk(invoiceNumbers, CHUNK)) {
        const { data } = await supabase.from('tva_entries').select('invoice_number').in('invoice_number', part)
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
          piece_number: row.piece_number,
          entry_date: row.entry_date,
          recovery_month: row.recovery_month,
          recovery_year: row.recovery_year,
          supplier_name: row.supplier_name,
          supplier_address: row.supplier_address,
          nif: row.nif,
          nis: row.nis,
          article: row.article,
          rc_number: row.rc_number,
          phone: row.phone,
          total_ht: row.total_ht,
          discount_amount: row.discount_amount,
          tva_amount: row.tva_amount,
          dd_amount: row.dd_amount,
          stamp_duty: row.stamp_duty,
          payment_piece: row.payment_piece,
        }
        // Observations : seulement si le fichier en contient une (colonne
        // "Observations" de l'export) -- sinon on ne touche pas à une note
        // déjà saisie manuellement sur une facture existante. Pour une
        // nouvelle facture sans colonne Observations, on pose un repère.
        if (row.observations != null) baseFields.observations = row.observations
        else if (!row.exists) baseFields.observations = 'Importé depuis fichier Excel'

        if (row.exists) {
          // Mise à jour : ne touche JAMAIS payment_mode / montant_paye /
          // reste_a_payer (paiements déjà enregistrés), ni l'id ni le n° de
          // facture lui-même (clé de correspondance, utilisée uniquement
          // dans le .eq() ci-dessous).
          const { error: updateError } = await supabase
            .from('tva_entries')
            .update(baseFields)
            .eq('invoice_number', row.invoice_number)
          if (updateError) throw updateError
          updated += 1
        } else {
          const { error: insertError } = await supabase.from('tva_entries').insert({
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
          Même format que l'export Excel du registre (colonnes détectées par en-tête, insensible à la casse/accents).
          Le n° de facture sert de clé : une facture déjà existante est mise à jour (jamais dupliquée), une nouvelle
          est créée. Le statut de paiement (Paiement / Montant payé / Reste à payer) n'est jamais modifié par
          l'import — ces colonnes ne sont affichées ci-dessous qu'à titre indicatif.
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
            <table className="w-full min-w-[1600px] border-collapse text-[11px] sm:text-sm">
              <thead>
                <tr className="border-b border-border bg-bg-soft text-left text-ink-muted">
                  <Th></Th>
                  <Th>Statut</Th>
                  <Th>N° Facture</Th>
                  <Th>Entité</Th>
                  <Th>Date</Th>
                  <Th>Mois récup.</Th>
                  <Th>Fournisseur</Th>
                  <Th>Adresse</Th>
                  <Th>Total HT</Th>
                  <Th>Remise</Th>
                  <Th>TVA</Th>
                  <Th>DD</Th>
                  <Th>Timbre</Th>
                  <Th title="Informatif uniquement -- jamais modifié par l'import">Paiement (info)</Th>
                  <Th title="Informatif uniquement -- jamais modifié par l'import">Payé (info)</Th>
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
                    <Td>{row.entry_date}</Td>
                    <Td>{recoveryLabel(row.recovery_month, row.recovery_year)}</Td>
                    <Td>{row.supplier_name}</Td>
                    <Td>{row.supplier_address ?? '—'}</Td>
                    <Td>{formatDANullable(row.total_ht)}</Td>
                    <Td>{formatDA(row.discount_amount)}</Td>
                    <Td>{formatDA(row.tva_amount)}</Td>
                    <Td>{formatDA(row.dd_amount)}</Td>
                    <Td>{formatDA(row.stamp_duty)}</Td>
                    <Td className="text-ink-muted italic">{row.payment_mode_info ?? '—'}</Td>
                    <Td className="text-ink-muted italic">{formatDANullable(row.montant_paye_info)}</Td>
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

function Th({ children, title }) {
  return (
    <th className="px-1 py-1 font-display font-medium whitespace-nowrap sm:px-3 sm:py-2" title={title}>
      {children}
    </th>
  )
}

function Td({ children, className = '' }) {
  return <td className={`px-1 py-1 whitespace-nowrap sm:px-3 sm:py-2 ${className}`}>{children}</td>
}
