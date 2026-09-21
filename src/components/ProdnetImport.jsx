import { useState } from 'react'
import { supabase } from '../lib/supabase'
import { formatDA, formatQty, nextProductReferenceNumber, formatProductReference, findNearDuplicates } from '../lib/prodnet'
import { parseProdnetProductsFile, readProdnetMatieresWorkbook } from '../lib/prodnetImportParser'

const CHUNK = 300

function chunk(arr, size) {
  const out = []
  for (let i = 0; i < arr.length; i += size) out.push(arr.slice(i, i + size))
  return out
}

function normDes(value) {
  return String(value ?? '').trim().toLowerCase()
}

// Colonnes de l'aperçu produits finis : le fichier V2 (export ERP) expose
// bien plus de colonnes que le format V1 historique -- Prod Total (colonne
// sans en-tête du fichier, = Prod Quantité × Prod Valeur) est purement
// informative, jamais stockée en base (voir parseProductsV2).
function productColumns(format) {
  if (format === 'v2') {
    return [
      { key: 'designation', label: 'Produit Fini', wide: true },
      { key: 'unite', label: 'Unité' },
      { key: 'prod_quantite', label: 'Prod Quantité', format: formatQty, numeric: true },
      { key: 'prix_moyen_ht', label: 'Prod Valeur', format: formatDA, numeric: true },
      { key: 'prod_total', label: 'Prod Total', format: formatDA, numeric: true, informative: true },
      { key: 'quantite', label: 'Stock Quantité', format: formatQty, numeric: true },
      { key: 'montant_ht', label: 'Stock Valeur', format: formatDA, numeric: true },
      { key: 'site_production', label: 'Site Production' },
    ]
  }
  return [
    { key: 'designation', label: 'Désignation', wide: true },
    { key: 'quantite', label: 'Qté', format: formatQty, numeric: true },
    { key: 'prix_moyen_ht', label: 'Prix moyen HT', format: formatDA, numeric: true },
    { key: 'montant_ht', label: 'Montant HT', format: formatDA, numeric: true },
    { key: 'reference', label: 'Référence' },
  ]
}

// Colonnes de l'aperçu matières premières : le format V2 stocke désormais
// TOUTES ses colonnes en base (conso/stock Importé/Local, Site Production) --
// aucune n'est purement informative.
function matiereColumns(format) {
  if (format === 'v2') {
    return [
      { key: 'designation', label: 'Matière Première', wide: true },
      { key: 'unite', label: 'Unité' },
      { key: 'conso_importe_quantite', label: 'Conso Importé Qté', format: formatQty, numeric: true },
      { key: 'conso_importe_valeur', label: 'Conso Importé Valeur', format: formatDA, numeric: true },
      { key: 'conso_local_quantite', label: 'Conso Local Qté', format: formatQty, numeric: true },
      { key: 'conso_local_valeur', label: 'Conso Local Valeur', format: formatDA, numeric: true },
      { key: 'stock_importe_quantite', label: 'Stock Importé Qté', format: formatQty, numeric: true },
      { key: 'stock_importe_valeur', label: 'Stock Importé Valeur', format: formatDA, numeric: true },
      { key: 'stock_local_quantite', label: 'Stock Local Qté', format: formatQty, numeric: true },
      { key: 'stock_local_valeur', label: 'Stock Local Valeur', format: formatDA, numeric: true },
      { key: 'site_production', label: 'Site Production' },
    ]
  }
  return [
    { key: 'designation', label: 'Désignation', wide: true },
    { key: 'position_tarifaire', label: 'Position tarifaire' },
    { key: 'unite', label: 'Unité' },
    { key: 'quantite', label: 'Qté', format: formatQty, numeric: true },
    { key: 'prix_moyen', label: 'Prix moyen', format: formatDA, numeric: true },
    { key: 'valeur_totale', label: 'Valeur totale', format: formatDA, numeric: true },
  ]
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
  const [checking, setChecking] = useState(false)
  const [importing, setImporting] = useState(false)
  const [progress, setProgress] = useState(null)
  const [summary, setSummary] = useState(null)

  const selectedCount = rows.filter((r) => r.selected).length

  async function handleFile(e) {
    const file = e.target.files?.[0]
    if (!file) return
    setSummary(null)
    setParseError('')
    setFileName(file.name)
    setRows([])
    try {
      const parsed = parseProdnetProductsFile(await file.arrayBuffer())
      if (parsed.length === 0) {
        setParseError('Aucune ligne détectée dans le fichier.')
        return
      }

      // Pré-vérification : quelles désignations existent déjà (par
      // référence puis par désignation) -> statut 🆕/🔄 dans l'aperçu, et
      // repérage des quasi-doublons (fichier + base) avant import.
      setChecking(true)
      const { data: existing } = await supabase.from('prodnet_products').select('id, reference, designation')
      setChecking(false)

      const refMap = new Map()
      const desMap = new Map()
      for (const p of existing ?? []) {
        if (p.reference) refMap.set(p.reference, p)
        desMap.set(normDes(p.designation), p)
      }
      const duplicates = findNearDuplicates([
        ...parsed.map((r) => r.designation),
        ...(existing ?? []).map((p) => p.designation),
      ])

      setRows(
        parsed.map((r, i) => {
          const match = (r.reference && refMap.get(r.reference)) || desMap.get(normDes(r.designation))
          return {
            ...r,
            __key: `${r.reference || ''}|${r.designation}|${i}`,
            selected: true,
            exists: !!match,
            duplicateOf: duplicates.get(r.designation) ?? [],
          }
        })
      )
    } catch (err) {
      setChecking(false)
      setRows([])
      setParseError(`Erreur de lecture : ${err.message}`)
    }
  }

  async function runImport() {
    const selected = rows.filter((r) => r.selected)
    if (selected.length === 0) return
    setImporting(true)
    setSummary(null)
    setProgress({ done: 0, total: selected.length })

    // Refait la correspondance au moment de l'import (pas seulement à
    // l'aperçu) pour rester correct si la base a changé entre-temps.
    const { data: existing } = await supabase.from('prodnet_products').select('id, reference, designation')
    const refMap = new Map()
    const desMap = new Map()
    for (const p of existing ?? []) {
      if (p.reference) refMap.set(p.reference, p.id)
      desMap.set(normDes(p.designation), p.id)
    }
    let nextRefNum = nextProductReferenceNumber((existing ?? []).map((p) => p.reference))

    const toUpdate = []
    const toInsert = []
    for (const r of selected) {
      const id = (r.reference && refMap.get(r.reference)) || desMap.get(normDes(r.designation)) || null
      const commonFields = {
        designation: r.designation,
        quantite: r.quantite,
        prix_moyen_ht: r.prix_moyen_ht,
        montant_ht: r.montant_ht,
      }
      // Format V2 seulement : Unité / Prod Quantité / Site Production
      // n'existent pas dans le format V1 -- ne jamais les écraser avec du
      // vide quand on importe un fichier V1 sur des produits déjà enrichis.
      if (r.format === 'v2') {
        commonFields.unite = r.unite
        commonFields.prod_quantite = r.prod_quantite
        commonFields.site_production = r.site_production
      }
      if (id) {
        // Correspondance existante : jamais reference ni constitution.
        toUpdate.push({ id, ...commonFields })
      } else {
        // Nouveau produit : conserve la référence du fichier (format V1) ou
        // génère la prochaine DPR0### disponible (format V2, sans référence).
        const reference = r.reference || formatProductReference(nextRefNum++)
        toInsert.push({ reference, ...commonFields })
      }
    }

    let done = 0
    const errors = []
    for (const part of chunk(toInsert, CHUNK)) {
      const { error } = await supabase.from('prodnet_products').insert(part)
      if (error) errors.push(error.message)
      else done += part.length
      setProgress((p) => ({ done: (p?.done ?? 0) + part.length, total: selected.length }))
    }
    for (const item of toUpdate) {
      const { id, ...fields } = item
      const { error } = await supabase.from('prodnet_products').update(fields).eq('id', id)
      if (error) errors.push(error.message)
      else done += 1
      setProgress((p) => ({ done: (p?.done ?? 0) + 1, total: selected.length }))
    }
    setImporting(false)
    setProgress(null)
    setSummary({ done, total: selected.length, created: toInsert.length, updated: toUpdate.length, errors })
  }

  return (
    <section className="flex flex-col gap-3">
      <h2 className="font-display text-lg text-ink">Importer les produits finis</h2>
      <p className="text-xs text-ink-muted">
        Deux formats reconnus automatiquement : « LISTE DES PRODUITS FINI.xlsx » (Référence, Famille de produits,
        Quantité, Prix moyen HT, Montant HT) ou l'export « Produit Fini » (Unité, Prod Quantité, Prod Valeur, Stock
        Quantite, Stock Valeur, Site Production — sans référence ; seul « Prod Total », non fourni par en-tête, reste
        informatif et n'est pas stocké). Rapprochement par référence puis par désignation ; les nouveaux produits sans
        référence reçoivent automatiquement le prochain n° DPR0### disponible.
      </p>

      <label className="inline-flex min-h-11 w-fit cursor-pointer items-center rounded-lg border border-ocre px-4 py-2 font-display text-ocre hover:bg-ocre/10">
        Choisir un fichier
        <input type="file" accept=".xlsx,.xls" onChange={handleFile} className="hidden" />
      </label>
      {fileName && <p className="text-sm text-ink-muted">Fichier : {fileName}</p>}
      {checking && <p className="text-sm text-ink-muted">Vérification des produits existants…</p>}
      {parseError && <p className="rounded-lg border border-terracotta/50 bg-terracotta/10 px-4 py-3 text-sm text-terracotta">{parseError}</p>}

      {rows.length > 0 && (
        <Preview
          rows={rows}
          setRows={setRows}
          columns={productColumns(rows[0]?.format)}
          summary={summary}
          importing={importing}
          progress={progress}
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
  const [checking, setChecking] = useState(false)
  const [importing, setImporting] = useState(false)
  const [progress, setProgress] = useState(null)
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

  async function chooseSheet(name) {
    setSheetName(name)
    setSummary(null)
    setParseError('')
    if (!name || !workbook) {
      setRows([])
      return
    }
    try {
      const parsed = workbook.parseSheet(name)
      if (parsed.length === 0) {
        setParseError(`Aucune ligne détectée dans l'onglet « ${name} ».`)
        return
      }

      setChecking(true)
      const { data: existing } = await supabase.from('prodnet_matieres').select('id, designation, position_tarifaire')
      setChecking(false)

      const desMap = new Map((existing ?? []).map((m) => [normDes(m.designation), m]))
      const duplicates = findNearDuplicates([
        ...parsed.map((r) => r.designation),
        ...(existing ?? []).map((m) => m.designation),
      ])

      setRows(
        parsed.map((r, i) => ({
          ...r,
          __key: `${r.designation}|${i}`,
          selected: true,
          exists: desMap.has(normDes(r.designation)),
          duplicateOf: duplicates.get(r.designation) ?? [],
        }))
      )
    } catch (err) {
      setChecking(false)
      setRows([])
      setParseError(err.message)
    }
  }

  async function runImport() {
    const selected = rows.filter((r) => r.selected)
    if (selected.length === 0) return
    setImporting(true)
    setSummary(null)
    setProgress({ done: 0, total: selected.length })

    const { data: existing } = await supabase.from('prodnet_matieres').select('id, designation')
    const desMap = new Map()
    for (const m of existing ?? []) desMap.set(normDes(m.designation), m.id)

    const toUpdate = []
    const toInsert = []
    for (const r of selected) {
      const fields = {
        designation: r.designation,
        unite: r.unite || 'U',
        quantite: r.quantite,
        prix_moyen: r.prix_moyen,
        valeur_totale: r.valeur_totale,
      }
      // Format V2 : pas de position tarifaire dans le fichier -- ne jamais
      // écraser celle déjà en base. Format V1 : comportement historique
      // inchangé (le fichier fournit -- ou pas -- cette colonne).
      if (r.format !== 'v2') fields.position_tarifaire = r.position_tarifaire || null

      // Format V2 seulement : conso/stock Importé/Local + Site Production
      // n'existent pas dans le format V1 -- ne jamais les écraser avec du
      // vide quand on importe un fichier V1 sur des matières déjà enrichies.
      if (r.format === 'v2') {
        fields.conso_importe_quantite = r.conso_importe_quantite
        fields.conso_importe_valeur = r.conso_importe_valeur
        fields.conso_local_quantite = r.conso_local_quantite
        fields.conso_local_valeur = r.conso_local_valeur
        fields.stock_importe_quantite = r.stock_importe_quantite
        fields.stock_importe_valeur = r.stock_importe_valeur
        fields.stock_local_quantite = r.stock_local_quantite
        fields.stock_local_valeur = r.stock_local_valeur
        fields.site_production = r.site_production
      }

      const id = desMap.get(normDes(r.designation))
      if (id) toUpdate.push({ id, ...fields })
      else toInsert.push({ position_tarifaire: r.position_tarifaire || null, ...fields })
    }

    let done = 0
    const errors = []
    for (const part of chunk(toInsert, CHUNK)) {
      const { error } = await supabase.from('prodnet_matieres').insert(part)
      if (error) errors.push(error.message)
      else done += part.length
      setProgress((p) => ({ done: (p?.done ?? 0) + part.length, total: selected.length }))
    }
    for (const item of toUpdate) {
      const { id, ...fields } = item
      const { error } = await supabase.from('prodnet_matieres').update(fields).eq('id', id)
      if (error) errors.push(error.message)
      else done += 1
      setProgress((p) => ({ done: (p?.done ?? 0) + 1, total: selected.length }))
    }
    setImporting(false)
    setProgress(null)
    setSummary({ done, total: selected.length, created: toInsert.length, updated: toUpdate.length, errors })
  }

  return (
    <section className="flex flex-col gap-3">
      <h2 className="font-display text-lg text-ink">Importer les matières premières</h2>
      <p className="text-xs text-ink-muted">
        Trois formats reconnus automatiquement (par en-tête, une fois l'onglet choisi) :
        « STOCK AU 31122025 » (Désignation, Quantité totale, Unité, Prix moyen pondéré, Valeur totale),
        « MATIERE PREMIERE AU 30062026 » (+ Position Tarifaire),
        ou l'export « Matiere Premiere » (Conso et Stock Importé/Local détaillés + Site Production, sans position
        tarifaire — jamais écrasée sur les matières déjà en base). Rapprochement par désignation.
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

      {checking && <p className="text-sm text-ink-muted">Vérification des matières existantes…</p>}
      {parseError && <p className="rounded-lg border border-terracotta/50 bg-terracotta/10 px-4 py-3 text-sm text-terracotta">{parseError}</p>}

      {rows.length > 0 && (
        <Preview
          rows={rows}
          setRows={setRows}
          columns={matiereColumns(rows[0]?.format)}
          summary={summary}
          importing={importing}
          progress={progress}
          selectedCount={selectedCount}
          onImport={runImport}
        />
      )}
    </section>
  )
}

function Preview({ rows, setRows, columns, summary, importing, progress, selectedCount, onImport }) {
  function toggle(key) {
    setRows((cur) => cur.map((r) => (r.__key === key ? { ...r, selected: !r.selected } : r)))
  }
  function toggleAll(checked) {
    setRows((cur) => cur.map((r) => ({ ...r, selected: checked })))
  }
  const existingCount = rows.filter((r) => r.exists).length
  const newCount = rows.length - existingCount

  return (
    <>
      <div className="flex flex-wrap items-center gap-3 rounded-lg border border-border bg-bg-soft px-4 py-3">
        <button
          type="button"
          onClick={() => toggleAll(true)}
          className="min-h-9 rounded-lg border border-ocre px-3 py-1.5 text-sm font-display text-ocre hover:bg-ocre/10"
        >
          Tout cocher
        </button>
        <button
          type="button"
          onClick={() => toggleAll(false)}
          className="min-h-9 rounded-lg border border-border px-3 py-1.5 text-sm font-display text-ink-muted hover:bg-bg"
        >
          Tout décocher
        </button>
        <p className="text-sm text-ink-muted">
          {rows.length} ligne(s) — {newCount} nouvelle(s), {existingCount} mise(s) à jour
        </p>
      </div>

      <div className="max-h-[400px] overflow-auto rounded-lg border border-border">
        <table className="w-full border-collapse text-[11px] sm:text-sm">
          <thead className="sticky top-0 z-10 bg-bg-soft">
            <tr className="border-b border-border text-left text-ink-muted">
              <th className="min-w-[40px] px-2 py-2"></th>
              <th className="min-w-[50px] px-2 py-2 font-display font-medium whitespace-nowrap">Statut</th>
              <th className="min-w-[50px] px-2 py-2 font-display font-medium whitespace-nowrap" title="Quasi-doublon détecté">⚠</th>
              {columns.map((c) => (
                <th
                  key={c.key}
                  className={`px-2 py-2 font-display font-medium whitespace-nowrap ${c.numeric ? 'text-right' : 'text-left'} ${c.informative ? 'italic text-ink-muted/70' : ''}`}
                  style={{ minWidth: c.wide ? '200px' : '100px' }}
                  title={c.informative ? 'Non importé — informatif' : undefined}
                >
                  {c.label}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.__key} className={`border-b border-border last:border-0 ${r.exists ? 'bg-yellow-500/10' : ''}`}>
                <td className="min-w-[40px] px-2 py-1">
                  <input type="checkbox" checked={r.selected} onChange={() => toggle(r.__key)} className="h-4 w-4 accent-terracotta" />
                </td>
                <td className="min-w-[50px] px-2 py-1 whitespace-nowrap">{r.exists ? '🔄 Mise à jour' : '🆕 Nouvelle'}</td>
                <td className="min-w-[50px] px-2 py-1 whitespace-nowrap">
                  {r.duplicateOf?.length > 0 && (
                    <span
                      className="cursor-help text-terracotta"
                      title={`Quasi-identique à : ${r.duplicateOf.join(', ')} — vérifier avant import (décocher si doublon)`}
                    >
                      ⚠
                    </span>
                  )}
                </td>
                {columns.map((c) => (
                  <td
                    key={c.key}
                    className={`px-2 py-1 ${c.numeric ? 'text-right whitespace-nowrap' : c.wide ? 'text-left' : 'max-w-[150px] truncate text-left'} ${c.informative ? 'italic text-ink-muted/70' : ''}`}
                    style={{ minWidth: c.wide ? '200px' : '100px' }}
                    title={c.informative ? 'Non importé — informatif' : !c.wide && !c.numeric ? String(r[c.key] ?? '') : undefined}
                  >
                    {c.format ? c.format(r[c.key]) : r[c.key] || '—'}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {progress && (
        <div className="flex flex-col gap-1">
          <div className="h-2 w-full overflow-hidden rounded-full bg-bg-soft">
            <div className="h-full bg-terracotta transition-all" style={{ width: `${(progress.done / progress.total) * 100}%` }} />
          </div>
          <p className="text-xs text-ink-muted">{progress.done} / {progress.total}</p>
        </div>
      )}

      {summary && (
        <div className="rounded-lg border border-ocre/50 bg-ocre/10 px-4 py-3 text-sm text-ocre">
          <p>{summary.done} / {summary.total} ligne(s) importée(s) ({summary.created} créée(s), {summary.updated} mise(s) à jour).</p>
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
