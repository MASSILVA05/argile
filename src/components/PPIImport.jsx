import { useState } from 'react'
import { supabase } from '../lib/supabase'
import { formatEUR, formatQty } from '../lib/ppi'
import { parsePpiFile } from '../lib/ppiImportParser'

const CHUNK = 300

function chunk(arr, size) {
  const out = []
  for (let i = 0; i < arr.length; i += size) out.push(arr.slice(i, i + size))
  return out
}

// Clé de rapprochement pour l'upsert : position_tarifaire seul N'EST PAS
// unique dans le fichier PPI ACORDER (plusieurs désignations peuvent
// partager le même code tarifaire) -- on associe donc (position_tarifaire +
// désignation), comme demandé, mais fiabilisé contre les doublons du fichier.
function matchKey(positionTarifaire, designation) {
  return `${positionTarifaire}|${designation.trim().toLowerCase()}`
}

export default function PPIImport() {
  const [fileName, setFileName] = useState('')
  const [rows, setRows] = useState([])
  const [parseError, setParseError] = useState('')
  const [importing, setImporting] = useState(false)
  const [summary, setSummary] = useState(null)

  const selectableRows = rows.filter((r) => r.country_name_fr)
  const selectedCount = selectableRows.filter((r) => r.selected).length
  const unmatchedCount = rows.length - selectableRows.length

  async function handleFile(e) {
    const file = e.target.files?.[0]
    if (!file) return
    setSummary(null)
    setParseError('')
    setFileName(file.name)
    try {
      const parsed = parsePpiFile(await file.arrayBuffer())
      if (parsed.length === 0) setParseError('Aucune ligne détectée dans le fichier.')
      setRows(
        parsed.map((r, i) => ({
          ...r,
          __key: `${r.position_tarifaire}|${r.designation}|${i}`,
          selected: !!r.country_name_fr,
        }))
      )
    } catch (err) {
      setRows([])
      setParseError(`Erreur de lecture : ${err.message}`)
    }
  }

  function toggle(key) {
    setRows((cur) => cur.map((r) => (r.__key === key ? { ...r, selected: !r.selected } : r)))
  }
  function toggleAll(checked) {
    setRows((cur) => cur.map((r) => (r.country_name_fr ? { ...r, selected: checked } : r)))
  }

  async function runImport() {
    const selected = rows.filter((r) => r.selected && r.country_name_fr)
    if (selected.length === 0) return
    setImporting(true)
    setSummary(null)

    const [{ data: countryRows }, { data: existingProducts }] = await Promise.all([
      supabase.from('ppi_countries').select('id, name_fr'),
      supabase.from('ppi_products').select('id, position_tarifaire, designation'),
    ])
    const countryIdByName = new Map((countryRows ?? []).map((c) => [c.name_fr, c.id]))
    const existingByKey = new Map(
      (existingProducts ?? []).map((p) => [matchKey(p.position_tarifaire ?? '', p.designation), p.id])
    )

    const toUpsert = []
    const toInsert = []
    const errors = []
    for (const r of selected) {
      const countryId = countryIdByName.get(r.country_name_fr)
      if (!countryId) {
        errors.push(`Pays « ${r.country_name_fr} » introuvable en base pour « ${r.designation} ».`)
        continue
      }
      const fields = {
        numero: r.numero,
        chapitre: r.chapitre || null,
        position_tarifaire: r.position_tarifaire,
        designation: r.designation,
        stock_actuel: r.stock_actuel,
        qte_en_cours: r.qte_en_cours,
        quantite_autorisee: r.quantite_autorisee,
        unite: r.unite || 'U',
        prix_unitaire: r.prix_unitaire,
        country_id: countryId,
        country_name_fr: r.country_name_fr,
      }
      const id = existingByKey.get(matchKey(r.position_tarifaire, r.designation))
      if (id) toUpsert.push({ id, ...fields })
      else toInsert.push(fields)
    }

    let done = 0
    for (const part of chunk(toUpsert, CHUNK)) {
      const { error } = await supabase.from('ppi_products').upsert(part)
      if (error) errors.push(error.message)
      else done += part.length
    }
    for (const part of chunk(toInsert, CHUNK)) {
      const { error } = await supabase.from('ppi_products').insert(part)
      if (error) errors.push(error.message)
      else done += part.length
    }
    setImporting(false)
    setSummary({ done, total: selected.length, errors })
  }

  return (
    <section className="flex flex-col gap-3">
      <h2 className="font-display text-lg text-ink">Importer le programme PPI</h2>
      <p className="text-xs text-ink-muted">
        Fichier « S2 PPI ACORDER.xlsx » : N°, Position tarifaire, Désignation, Stock, Qté en cours, Quantité,
        Unité, Prix U., Origine, Sous-total. Le pays est détecté depuis la colonne Origine (arabe → français).
        Rapprochement par (position tarifaire + désignation) — une même position tarifaire peut désigner
        plusieurs produits dans ce fichier.
      </p>

      <label className="inline-flex min-h-11 w-fit cursor-pointer items-center rounded-lg border border-ocre px-4 py-2 font-display text-ocre hover:bg-ocre/10">
        Choisir un fichier
        <input type="file" accept=".xlsx,.xls" onChange={handleFile} className="hidden" />
      </label>
      {fileName && <p className="text-sm text-ink-muted">Fichier : {fileName}</p>}
      {parseError && <p className="rounded-lg border border-terracotta/50 bg-terracotta/10 px-4 py-3 text-sm text-terracotta">{parseError}</p>}

      {rows.length > 0 && (
        <>
          <div className="flex flex-wrap items-center gap-4 rounded-lg border border-border bg-bg-soft px-4 py-3">
            <label className="flex items-center gap-2 text-sm">
              <input
                type="checkbox"
                checked={selectableRows.length > 0 && selectedCount === selectableRows.length}
                onChange={(e) => toggleAll(e.target.checked)}
                className="h-4 w-4 accent-terracotta"
              />
              Tout sélectionner
            </label>
            <p className="text-sm text-ink-muted">{rows.length} ligne(s), {selectedCount} sélectionnée(s)</p>
            {unmatchedCount > 0 && (
              <p className="text-sm text-terracotta">{unmatchedCount} ligne(s) sans pays reconnu (ignorée(s))</p>
            )}
          </div>

          <div className="max-h-[420px] overflow-auto rounded-lg border border-border">
            <table className="w-full min-w-[900px] border-collapse text-[11px] sm:text-sm">
              <thead className="sticky top-0 bg-bg-soft">
                <tr className="border-b border-border text-left text-ink-muted">
                  <th className="px-2 py-2"></th>
                  <th className="px-2 py-2 font-display font-medium whitespace-nowrap">Position tarifaire</th>
                  <th className="px-2 py-2 font-display font-medium whitespace-nowrap">Désignation</th>
                  <th className="px-2 py-2 font-display font-medium whitespace-nowrap">Pays</th>
                  <th className="px-2 py-2 font-display font-medium whitespace-nowrap">Qté autorisée</th>
                  <th className="px-2 py-2 font-display font-medium whitespace-nowrap">Prix U. (€)</th>
                  <th className="px-2 py-2 font-display font-medium whitespace-nowrap">Sous-total (€)</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => (
                  <tr key={r.__key} className={`border-b border-border last:border-0 ${!r.country_name_fr ? 'opacity-50' : ''}`}>
                    <td className="px-2 py-1">
                      <input
                        type="checkbox"
                        checked={r.selected}
                        disabled={!r.country_name_fr}
                        onChange={() => toggle(r.__key)}
                        className="h-4 w-4 accent-terracotta"
                      />
                    </td>
                    <td className="px-2 py-1 whitespace-nowrap">{r.position_tarifaire}</td>
                    <td className="px-2 py-1">{r.designation}</td>
                    <td className="px-2 py-1 whitespace-nowrap">{r.country_name_fr || `⚠ origine « ${r.origin_ar} » non reconnue`}</td>
                    <td className="px-2 py-1 whitespace-nowrap">{formatQty(r.quantite_autorisee)} {r.unite}</td>
                    <td className="px-2 py-1 whitespace-nowrap">{formatEUR(r.prix_unitaire)}</td>
                    <td className="px-2 py-1 whitespace-nowrap">{formatEUR(r.sous_total)}</td>
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
