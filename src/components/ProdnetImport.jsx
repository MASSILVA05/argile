import { useState } from 'react'
import { supabase } from '../lib/supabase'
import { formatDA, formatQty } from '../lib/prodnet'
import { parseProdnetProductsFile, readProdnetMatieresWorkbook } from '../lib/prodnetImportParser'

const CHUNK = 300

function chunk(arr, size) {
  const out = []
  for (let i = 0; i < arr.length; i += size) out.push(arr.slice(i, i + size))
  return out
}

export default function ProdnetImport() {
  return (
    <div className="flex flex-col gap-8">
      <ProductsImport />
      <MatieresImport />
    </div>
  )
}

// ---------------- Produits finis ----------------
function ProductsImport() {
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
      const parsed = parseProdnetProductsFile(await file.arrayBuffer())
      if (parsed.length === 0) setParseError('Aucune ligne détectée dans le fichier.')
      setRows(parsed.map((r, i) => ({ ...r, __key: `${r.reference || ''}|${r.designation}|${i}`, selected: true })))
    } catch (err) {
      setRows([])
      setParseError(`Erreur de lecture : ${err.message}`)
    }
  }

  async function runImport() {
    const selected = rows.filter((r) => r.selected)
    if (selected.length === 0) return
    setImporting(true)
    setSummary(null)

    const { data: existing } = await supabase.from('prodnet_products').select('id, reference, designation')
    const refMap = new Map()
    const desMap = new Map()
    for (const p of existing ?? []) {
      if (p.reference) refMap.set(p.reference, p.id)
      desMap.set(p.designation.trim().toLowerCase(), p.id)
    }

    const toUpsert = []
    const toInsert = []
    for (const r of selected) {
      const fields = {
        reference: r.reference || null,
        designation: r.designation,
        quantite: r.quantite,
        prix_moyen_ht: r.prix_moyen_ht,
        montant_ht: r.montant_ht,
      }
      const id = (r.reference && refMap.get(r.reference)) || desMap.get(r.designation.trim().toLowerCase()) || null
      if (id) toUpsert.push({ id, ...fields })
      else toInsert.push(fields)
    }

    let done = 0
    const errors = []
    for (const part of chunk(toUpsert, CHUNK)) {
      const { error } = await supabase.from('prodnet_products').upsert(part)
      if (error) errors.push(error.message)
      else done += part.length
    }
    for (const part of chunk(toInsert, CHUNK)) {
      const { error } = await supabase.from('prodnet_products').insert(part)
      if (error) errors.push(error.message)
      else done += part.length
    }
    setImporting(false)
    setSummary({ done, total: selected.length, errors })
  }

  return (
    <section className="flex flex-col gap-3">
      <h2 className="font-display text-lg text-ink">Importer les produits finis</h2>
      <p className="text-xs text-ink-muted">
        Fichier LISTE_DES_PRODUITS_FINI.xlsx : Reference, Famille de produits, Quantité, Prix moyen HT, Montant HT.
        Rapprochement par référence puis par désignation.
      </p>

      <label className="inline-flex min-h-11 w-fit cursor-pointer items-center rounded-lg border border-ocre px-4 py-2 font-display text-ocre hover:bg-ocre/10">
        Choisir un fichier
        <input type="file" accept=".xlsx,.xls" onChange={handleFile} className="hidden" />
      </label>
      {fileName && <p className="text-sm text-ink-muted">Fichier : {fileName}</p>}
      {parseError && <p className="rounded-lg border border-terracotta/50 bg-terracotta/10 px-4 py-3 text-sm text-terracotta">{parseError}</p>}

      {rows.length > 0 && (
        <Preview
          rows={rows}
          setRows={setRows}
          columns={[
            { key: 'reference', label: 'Référence' },
            { key: 'designation', label: 'Désignation' },
            { key: 'quantite', label: 'Qté', format: formatQty },
            { key: 'prix_moyen_ht', label: 'Prix moyen HT', format: formatDA },
            { key: 'montant_ht', label: 'Montant HT', format: formatDA },
          ]}
          summary={summary}
          importing={importing}
          selectedCount={selectedCount}
          onImport={runImport}
        />
      )}
    </section>
  )
}

// ---------------- Matières premières ----------------
function MatieresImport() {
  const [fileName, setFileName] = useState('')
  const [workbook, setWorkbook] = useState(null)
  const [sheetName, setSheetName] = useState('')
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
    setRows([])
    setFileName(file.name)
    setSheetName('')
    try {
      const wb = readProdnetMatieresWorkbook(await file.arrayBuffer())
      setWorkbook(wb)
    } catch (err) {
      setWorkbook(null)
      setParseError(`Erreur de lecture : ${err.message}`)
    }
  }

  function chooseSheet(name) {
    setSheetName(name)
    setSummary(null)
    setParseError('')
    if (!name || !workbook) {
      setRows([])
      return
    }
    try {
      const parsed = workbook.parseSheet(name)
      if (parsed.length === 0) setParseError(`Aucune ligne détectée dans l'onglet « ${name} ».`)
      setRows(parsed.map((r, i) => ({ ...r, __key: `${r.designation}|${i}`, selected: true })))
    } catch (err) {
      setRows([])
      setParseError(err.message)
    }
  }

  async function runImport() {
    const selected = rows.filter((r) => r.selected)
    if (selected.length === 0) return
    setImporting(true)
    setSummary(null)

    const { data: existing } = await supabase.from('prodnet_matieres').select('id, designation')
    const desMap = new Map()
    for (const m of existing ?? []) desMap.set(m.designation.trim().toLowerCase(), m.id)

    const toUpdate = []
    const toInsert = []
    for (const r of selected) {
      const fields = {
        designation: r.designation,
        position_tarifaire: r.position_tarifaire || null,
        unite: r.unite || 'U',
        quantite: r.quantite,
        prix_moyen: r.prix_moyen,
        valeur_totale: r.valeur_totale,
      }
      const id = desMap.get(r.designation.trim().toLowerCase())
      if (id) toUpdate.push({ id, ...fields })
      else toInsert.push(fields)
    }

    let done = 0
    const errors = []
    for (const part of chunk(toInsert, CHUNK)) {
      const { error } = await supabase.from('prodnet_matieres').insert(part)
      if (error) errors.push(error.message)
      else done += part.length
    }
    for (const item of toUpdate) {
      const { id, ...fields } = item
      const { error } = await supabase.from('prodnet_matieres').update(fields).eq('id', id)
      if (error) errors.push(error.message)
      else done += 1
    }
    setImporting(false)
    setSummary({ done, total: selected.length, errors })
  }

  return (
    <section className="flex flex-col gap-3">
      <h2 className="font-display text-lg text-ink">Importer les matières premières</h2>
      <p className="text-xs text-ink-muted">
        Fichier STOCK_AU_31122025.xlsx. Choisissez l'onglet à importer :
        « STOCK AU 31122025 » (Désignation, Quantité totale, Unité, Prix moyen pondéré, Valeur totale)
        ou « MATIERE PREMIERE AU 30062026 » (Désignation, Position Tarifaire, Quantité Totale, Prix Unitaire Pondéré, Valeur Totale).
        Rapprochement par désignation.
      </p>

      <label className="inline-flex min-h-11 w-fit cursor-pointer items-center rounded-lg border border-ocre px-4 py-2 font-display text-ocre hover:bg-ocre/10">
        Choisir un fichier
        <input type="file" accept=".xlsx,.xls" onChange={handleFile} className="hidden" />
      </label>
      {fileName && <p className="text-sm text-ink-muted">Fichier : {fileName}</p>}

      {workbook && (
        <label className="flex flex-col gap-1.5">
          <span className="text-sm text-ink-muted">Onglet à importer</span>
          <select value={sheetName} onChange={(e) => chooseSheet(e.target.value)} className="min-h-11 w-full max-w-md rounded-lg border border-border bg-bg-soft px-3 py-2 text-ink outline-none focus:border-terracotta">
            <option value="">— choisir un onglet —</option>
            {workbook.sheetNames.map((n) => <option key={n} value={n}>{n}</option>)}
          </select>
        </label>
      )}

      {parseError && <p className="rounded-lg border border-terracotta/50 bg-terracotta/10 px-4 py-3 text-sm text-terracotta">{parseError}</p>}

      {rows.length > 0 && (
        <Preview
          rows={rows}
          setRows={setRows}
          columns={[
            { key: 'designation', label: 'Désignation' },
            { key: 'position_tarifaire', label: 'Position tarifaire' },
            { key: 'unite', label: 'Unité' },
            { key: 'quantite', label: 'Qté', format: formatQty },
            { key: 'prix_moyen', label: 'Prix moyen', format: formatDA },
            { key: 'valeur_totale', label: 'Valeur totale', format: formatDA },
          ]}
          summary={summary}
          importing={importing}
          selectedCount={selectedCount}
          onImport={runImport}
        />
      )}
    </section>
  )
}

function Preview({ rows, setRows, columns, summary, importing, selectedCount, onImport }) {
  function toggle(key) {
    setRows((cur) => cur.map((r) => (r.__key === key ? { ...r, selected: !r.selected } : r)))
  }
  function toggleAll(checked) {
    setRows((cur) => cur.map((r) => ({ ...r, selected: checked })))
  }
  return (
    <>
      <div className="flex flex-wrap items-center gap-4 rounded-lg border border-border bg-bg-soft px-4 py-3">
        <label className="flex items-center gap-2 text-sm">
          <input type="checkbox" checked={selectedCount === rows.length} onChange={(e) => toggleAll(e.target.checked)} className="h-4 w-4 accent-terracotta" />
          Tout sélectionner
        </label>
        <p className="text-sm text-ink-muted">{rows.length} ligne(s), {selectedCount} sélectionnée(s)</p>
      </div>

      <div className="max-h-[420px] overflow-auto rounded-lg border border-border">
        <table className="w-full min-w-[800px] border-collapse text-[11px] sm:text-sm">
          <thead className="sticky top-0 bg-bg-soft">
            <tr className="border-b border-border text-left text-ink-muted">
              <th className="px-2 py-2"></th>
              {columns.map((c) => (
                <th key={c.key} className="px-2 py-2 font-display font-medium whitespace-nowrap">{c.label}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.__key} className="border-b border-border last:border-0">
                <td className="px-2 py-1">
                  <input type="checkbox" checked={r.selected} onChange={() => toggle(r.__key)} className="h-4 w-4 accent-terracotta" />
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
          <p>{summary.done} / {summary.total} ligne(s) importée(s).</p>
          {summary.errors.length > 0 && (
            <ul className="mt-2 list-disc pl-5 text-terracotta">
              {summary.errors.map((e, i) => <li key={i}>{e}</li>)}
            </ul>
          )}
        </div>
      )}

      <button
        type="button"
        onClick={onImport}
        disabled={importing || selectedCount === 0}
        className="min-h-12 rounded-lg bg-terracotta px-4 py-3 font-display text-lg font-medium tracking-wide text-ink transition-colors hover:bg-terracotta-hover disabled:opacity-50"
      >
        {importing ? 'Import en cours…' : `Importer (${selectedCount})`}
      </button>
    </>
  )
}
