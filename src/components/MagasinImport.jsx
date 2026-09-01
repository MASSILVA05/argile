import { useState } from 'react'
import { supabase } from '../lib/supabase'
import { formatDA, formatQty } from '../lib/magasin'
import { parseMagasinStockFile, parseMagasinCreditsFile } from '../lib/magasinImportParser'

const CHUNK = 300

function chunk(arr, size) {
  const out = []
  for (let i = 0; i < arr.length; i += size) out.push(arr.slice(i, i + size))
  return out
}

export default function MagasinImport() {
  return (
    <div className="flex flex-col gap-8">
      <ImportSection
        title="Importer le stock"
        accept=".xlsx,.xls"
        hint="Format « magasin quatre chemin » : Reference, Designation, Marque, Quantite, Prix Achat, Prix Gros, Prix Detail, Prix Euro, Stock Min, Rayonnage, Code Barre."
        parse={parseMagasinStockFile}
        keyOf={(r, i) => `${r.reference || ''}|${r.designation}|${i}`}
        columns={[
          { key: 'reference', label: 'Référence' },
          { key: 'designation', label: 'Désignation' },
          { key: 'marque', label: 'Marque' },
          { key: 'quantite', label: 'Qté', format: formatQty },
          { key: 'stock_min', label: 'Stock min', format: formatQty },
          { key: 'prix_achat', label: 'P. achat', format: formatDA },
          { key: 'prix_detail', label: 'P. détail', format: formatDA },
          { key: 'rayonnage', label: 'Rayonnage' },
        ]}
        importRows={importStockRows}
      />

      <ImportSection
        title="Importer les crédits clients"
        accept=".xls,.xlsx"
        hint="Format « credclie2 » : N°, Nom Client, N° Telephone, Chiffre Affaires, Seuil Credit, Dern Operation, Credit. Un solde négatif = le client nous doit."
        parse={parseMagasinCreditsFile}
        keyOf={(r, i) => `${r.name}|${i}`}
        columns={[
          { key: 'name', label: 'Nom client' },
          { key: 'phone', label: 'Téléphone' },
          { key: 'chiffre_affaires', label: 'CA', format: formatDA },
          { key: 'seuil_credit', label: 'Seuil', format: formatDA },
          { key: 'credit', label: 'Crédit', format: formatDA },
          { key: 'last_operation_date', label: 'Dern. opé.' },
        ]}
        importRows={importClientRows}
      />
    </div>
  )
}

async function importStockRows(rows) {
  const { data: existing } = await supabase.from('magasin_stock').select('id, reference, designation')
  const refMap = new Map()
  const desMap = new Map()
  for (const e of existing ?? []) {
    if (e.reference) refMap.set(e.reference, e.id)
    desMap.set(e.designation.trim().toLowerCase(), e.id)
  }

  const toUpsert = []
  const toInsert = []
  for (const r of rows) {
    const fields = {
      reference: r.reference || null,
      designation: r.designation,
      marque: r.marque || null,
      quantite: r.quantite,
      prix_achat: r.prix_achat,
      prix_gros: r.prix_gros,
      prix_detail: r.prix_detail,
      prix_euro: r.prix_euro,
      stock_min: r.stock_min,
      rayonnage: r.rayonnage || null,
      code_barre: r.code_barre || null,
    }
    const id =
      (r.reference && refMap.get(r.reference)) || desMap.get(r.designation.trim().toLowerCase()) || null
    if (id) toUpsert.push({ id, ...fields })
    else toInsert.push(fields)
  }

  let done = 0
  const errors = []
  for (const part of chunk(toUpsert, CHUNK)) {
    const { error } = await supabase.from('magasin_stock').upsert(part)
    if (error) errors.push(error.message)
    else done += part.length
  }
  for (const part of chunk(toInsert, CHUNK)) {
    const { error } = await supabase.from('magasin_stock').insert(part)
    if (error) errors.push(error.message)
    else done += part.length
  }
  return { done, total: rows.length, errors }
}

async function importClientRows(rows) {
  const payload = rows.map((r) => ({
    name: r.name,
    phone: r.phone || null,
    chiffre_affaires: r.chiffre_affaires,
    seuil_credit: r.seuil_credit,
    credit: r.credit,
    last_operation_date: r.last_operation_date,
  }))

  let done = 0
  const errors = []
  for (const part of chunk(payload, CHUNK)) {
    const { error } = await supabase.from('magasin_clients').upsert(part, { onConflict: 'name' })
    if (error) errors.push(error.message)
    else done += part.length
  }
  return { done, total: rows.length, errors }
}

function ImportSection({ title, accept, hint, parse, keyOf, columns, importRows }) {
  const [fileName, setFileName] = useState('')
  const [rows, setRows] = useState([])
  const [parseError, setParseError] = useState('')
  const [importing, setImporting] = useState(false)
  const [summary, setSummary] = useState(null)

  const selectedCount = rows.filter((r) => r.selected).length

  async function handleFile(e) {
    const file = e.target.files?.[0]
    if (!file) return
    setSummary(null)
    setParseError('')
    setFileName(file.name)
    try {
      const parsed = parse(await file.arrayBuffer())
      if (parsed.length === 0) setParseError('Aucune ligne détectée dans le fichier.')
      setRows(parsed.map((r, i) => ({ ...r, __key: keyOf(r, i), selected: true })))
    } catch (err) {
      setRows([])
      setParseError(`Erreur de lecture : ${err.message}`)
    }
  }

  function toggle(key) {
    setRows((cur) => cur.map((r) => (r.__key === key ? { ...r, selected: !r.selected } : r)))
  }

  function toggleAll(checked) {
    setRows((cur) => cur.map((r) => ({ ...r, selected: checked })))
  }

  async function runImport() {
    const selected = rows.filter((r) => r.selected)
    if (selected.length === 0) return
    setImporting(true)
    setSummary(null)
    const result = await importRows(selected)
    setImporting(false)
    setSummary(result)
  }

  return (
    <section className="flex flex-col gap-3">
      <h2 className="font-display text-lg text-ink">{title}</h2>
      <p className="text-xs text-ink-muted">{hint}</p>

      <label className="inline-flex min-h-11 w-fit cursor-pointer items-center rounded-lg border border-ocre px-4 py-2 font-display text-ocre transition-colors hover:bg-ocre/10">
        Choisir un fichier
        <input type="file" accept={accept} onChange={handleFile} className="hidden" />
      </label>
      {fileName && <p className="text-sm text-ink-muted">Fichier : {fileName}</p>}

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
                className="h-4 w-4 accent-terracotta"
              />
              Tout sélectionner
            </label>
            <p className="text-sm text-ink-muted">
              {rows.length} ligne(s), {selectedCount} sélectionnée(s)
            </p>
          </div>

          <div className="max-h-[420px] overflow-auto rounded-lg border border-border">
            <table className="w-full min-w-[800px] border-collapse text-[11px] sm:text-sm">
              <thead className="sticky top-0 bg-bg-soft">
                <tr className="border-b border-border text-left text-ink-muted">
                  <th className="px-2 py-2"></th>
                  {columns.map((c) => (
                    <th key={c.key} className="px-2 py-2 font-display font-medium whitespace-nowrap">
                      {c.label}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => (
                  <tr key={r.__key} className="border-b border-border last:border-0">
                    <td className="px-2 py-1">
                      <input
                        type="checkbox"
                        checked={r.selected}
                        onChange={() => toggle(r.__key)}
                        className="h-4 w-4 accent-terracotta"
                      />
                    </td>
                    {columns.map((c) => (
                      <td key={c.key} className="px-2 py-1 whitespace-nowrap">
                        {c.format ? c.format(r[c.key]) : r[c.key] || '—'}
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {summary && (
            <div className="rounded-lg border border-ocre/50 bg-ocre/10 px-4 py-3 text-sm text-ocre">
              <p>
                {summary.done} / {summary.total} ligne(s) importée(s).
              </p>
              {summary.errors.length > 0 && (
                <ul className="mt-2 list-disc pl-5 text-terracotta">
                  {summary.errors.map((e, i) => (
                    <li key={i}>{e}</li>
                  ))}
                </ul>
              )}
            </div>
          )}

          <button
            type="button"
            onClick={runImport}
            disabled={importing || selectedCount === 0}
            className="min-h-12 rounded-lg bg-terracotta px-4 py-3 font-display text-lg font-medium tracking-wide text-ink transition-colors hover:bg-terracotta-hover disabled:opacity-50"
          >
            {importing ? 'Import en cours…' : `Importer (${selectedCount})`}
          </button>
        </>
      )}
    </section>
  )
}
