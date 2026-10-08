import { useState } from 'react'
import { supabase } from '../lib/supabase'
import { getSession } from '../lib/auth'
import { PRODUITS, formatInt, formatNum } from '../lib/production'
import { MOIS_LABELS, parseProductionHistoryHtml, recordToEntry } from '../lib/productionHistoryImport'

const CHUNK = 50

// Sous-onglet « Import » : historique mensuel de production depuis le fichier
// HTML (production-briqueterie.html). Une ligne = un mois × un produit,
// upsert sur import_key via la RPC production_import_history (code admin).
export default function ProductionImport() {
  const [fileName, setFileName] = useState('')
  const [html, setHtml] = useState('')
  const [rows, setRows] = useState([])
  const [warnings, setWarnings] = useState([])
  const [parseError, setParseError] = useState('')
  const [dateMode, setDateMode] = useState('last')
  const [defaultProduit, setDefaultProduit] = useState('B8')
  const [adminCode, setAdminCode] = useState('')
  const [importing, setImporting] = useState(false)
  const [summary, setSummary] = useState(null)

  const selectedCount = rows.filter((r) => r.selected).length

  async function analyse(text, produit) {
    setParseError('')
    setSummary(null)
    try {
      const { records, warnings: w } = parseProductionHistoryHtml(text, { defaultProduit: produit })
      if (records.length === 0) {
        setRows([])
        setWarnings(w)
        setParseError('Aucune donnée mensuelle reconnue dans ce fichier (mois en lignes ou en colonnes attendus).')
        return
      }
      const keys = records.map((r) => `histo-${r.key}`)
      const { data: existing } = await supabase.from('production_entries').select('import_key').in('import_key', keys)
      const existingKeys = new Set((existing ?? []).map((e) => e.import_key))
      setRows(records.map((r) => ({ ...r, selected: true, exists: existingKeys.has(`histo-${r.key}`) })))
      setWarnings(w)
    } catch (err) {
      setRows([])
      setParseError(`Erreur de lecture : ${err.message}`)
    }
  }

  async function handleFile(e) {
    const file = e.target.files?.[0]
    if (!file) return
    setFileName(file.name)
    const text = await file.text()
    setHtml(text)
    await analyse(text, defaultProduit)
  }

  async function changeDefaultProduit(value) {
    setDefaultProduit(value)
    if (html) await analyse(html, value)
  }

  function toggle(key) {
    setRows((cur) => cur.map((r) => (r.key === key ? { ...r, selected: !r.selected } : r)))
  }

  function toggleAll(value) {
    setRows((cur) => cur.map((r) => ({ ...r, selected: value })))
  }

  async function runImport() {
    const selected = rows.filter((r) => r.selected)
    if (selected.length === 0) return
    if (!adminCode.trim()) {
      setSummary({ done: 0, errors: ['Code administrateur requis.'] })
      return
    }
    setImporting(true)
    setSummary(null)
    const enteredBy = getSession()?.username ?? null
    const entries = selected.map((r) => recordToEntry(r, { dateMode, enteredBy }))
    let done = 0
    const errors = []
    for (let i = 0; i < entries.length; i += CHUNK) {
      const part = entries.slice(i, i + CHUNK)
      const { data, error } = await supabase.rpc('production_import_history', { p_admin_code: adminCode, p_rows: part })
      if (error) {
        errors.push(error.message)
        if (/code administrateur/i.test(error.message)) break
      } else done += Number(data) || 0
    }
    setImporting(false)
    setSummary({ done, total: entries.length, errors })
    if (done > 0) {
      const doneKeys = new Set(selected.map((r) => r.key))
      setRows((cur) => cur.map((r) => (doneKeys.has(r.key) ? { ...r, exists: true } : r)))
    }
  }

  return (
    <section className="flex flex-col gap-4">
      <div>
        <h2 className="font-display text-lg text-ink">Importer historique production</h2>
        <p className="mt-1 text-xs text-ink-muted">
          Fichier attendu : <span className="text-ink">production-briqueterie.html</span> (données mensuelles janvier → septembre 2026).
          Les mois peuvent être en lignes ou en colonnes ; les sections Presse / Séchoir / Four / Défournement / Emballage
          sont reconnues par les titres des tableaux. Une ligne est créée par mois et par produit ; réimporter le même
          fichier met à jour les lignes existantes (pas de doublon).
        </p>
      </div>

      <div className="flex flex-col gap-3 sm:flex-row sm:flex-wrap sm:items-end">
        <label className="inline-flex min-h-11 w-fit cursor-pointer items-center rounded-lg border border-ocre px-4 py-2 font-display text-ocre hover:bg-ocre/10">
          Choisir le fichier HTML
          <input type="file" accept=".html,.htm,text/html" onChange={handleFile} className="hidden" />
        </label>
        <label className="flex flex-col gap-1 text-sm text-ink-muted">
          Date de la ligne
          <select value={dateMode} onChange={(e) => setDateMode(e.target.value)} className={ic}>
            <option value="last">Dernier jour du mois</option>
            <option value="first">1er jour du mois</option>
          </select>
        </label>
        <label className="flex flex-col gap-1 text-sm text-ink-muted">
          Produit si non précisé
          <select value={defaultProduit} onChange={(e) => changeDefaultProduit(e.target.value)} className={ic}>
            {PRODUITS.map((p) => <option key={p} value={p}>{p}</option>)}
          </select>
        </label>
      </div>

      {fileName && <p className="text-sm text-ink-muted">Fichier : {fileName}</p>}
      {parseError && <p className="rounded-lg border border-terracotta/50 bg-terracotta/10 px-4 py-3 text-sm text-terracotta">{parseError}</p>}
      {warnings.map((w) => (
        <p key={w} className="rounded-lg border border-ocre/50 bg-ocre/10 px-4 py-2 text-xs text-ocre">{w}</p>
      ))}

      {rows.length > 0 && (
        <>
          <div className="flex flex-wrap items-center gap-3 text-sm">
            <span className="text-ink">{selectedCount} / {rows.length} lignes sélectionnées</span>
            <button type="button" onClick={() => toggleAll(true)} className="text-ocre underline">Tout cocher</button>
            <button type="button" onClick={() => toggleAll(false)} className="text-ink-muted underline">Tout décocher</button>
          </div>

          <div className="overflow-x-auto rounded-lg border border-border">
            <table className="w-full min-w-[900px] border-collapse text-sm">
              <thead>
                <tr className="border-b border-border bg-bg-soft text-left text-ink-muted">
                  <th className="px-3 py-2" />
                  <th className="px-3 py-2 font-display font-medium">Mois</th>
                  <th className="px-3 py-2 font-display font-medium">Produit</th>
                  <th className="px-3 py-2 text-right font-display font-medium">Presse chariots</th>
                  <th className="px-3 py-2 text-right font-display font-medium">Séchoir sortis</th>
                  <th className="px-3 py-2 text-right font-display font-medium">Four défournés</th>
                  <th className="px-3 py-2 text-right font-display font-medium">Gaz (m³)</th>
                  <th className="px-3 py-2 text-right font-display font-medium">Conformes / 1er choix</th>
                  <th className="px-3 py-2 text-right font-display font-medium">Paquets</th>
                  <th className="px-3 py-2 text-right font-display font-medium">Champs</th>
                  <th className="px-3 py-2 font-display font-medium">Statut</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => {
                  const f = r.fields
                  const v = (k, fmt = formatInt) => (f[k] == null ? '—' : fmt(f[k]))
                  return (
                    <tr key={r.key} className={`border-b border-border last:border-0 ${r.selected ? '' : 'opacity-50'}`}>
                      <td className="px-3 py-2">
                        <input type="checkbox" checked={r.selected} onChange={() => toggle(r.key)} className="h-4 w-4 accent-terracotta" />
                      </td>
                      <td className="px-3 py-2 text-ink">{MOIS_LABELS[r.month - 1]} {r.year}</td>
                      <td className="px-3 py-2 text-ink">{r.produit}</td>
                      <td className="px-3 py-2 text-right">{f.presse_chariots == null && f.__presse_total != null ? `≈ ${formatInt(f.__presse_total)} pcs` : v('presse_chariots')}</td>
                      <td className="px-3 py-2 text-right">{v('sechoir_sortis')}</td>
                      <td className="px-3 py-2 text-right">{v('four_defournes')}</td>
                      <td className="px-3 py-2 text-right">{v('four_gaz', formatNum)}</td>
                      <td className="px-3 py-2 text-right">{v('defourn_conformes')} / {v('defourn_premier_choix')}</td>
                      <td className="px-3 py-2 text-right">{v('emballage_paquets')}</td>
                      <td className="px-3 py-2 text-right" title={Object.keys(f).join(', ')}>{Object.keys(f).length}</td>
                      <td className="px-3 py-2">
                        {r.exists ? <span className="text-ocre">🔄 mise à jour</span> : <span className="text-ink">🆕 nouveau</span>}
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>

          <div className="flex flex-col gap-3 sm:flex-row sm:items-end">
            <label className="flex flex-col gap-1 text-sm text-ink-muted">
              Code administrateur
              <input
                type="password"
                value={adminCode}
                onChange={(e) => setAdminCode(e.target.value)}
                className={ic}
                autoComplete="off"
              />
            </label>
            <button
              type="button"
              onClick={runImport}
              disabled={importing || selectedCount === 0}
              className="min-h-11 rounded-lg bg-terracotta px-4 py-2 font-display text-ink hover:bg-terracotta-hover disabled:opacity-50"
            >
              {importing ? 'Import en cours…' : `Importer ${selectedCount} ligne${selectedCount > 1 ? 's' : ''}`}
            </button>
          </div>
        </>
      )}

      {summary && (
        <div className={`rounded-lg border px-4 py-3 text-sm ${summary.errors.length ? 'border-terracotta/50 bg-terracotta/10 text-terracotta' : 'border-ocre/50 bg-ocre/10 text-ocre'}`}>
          {summary.total != null && <p>{summary.done} / {summary.total} lignes importées ou mises à jour.</p>}
          {summary.errors.map((e) => <p key={e}>Erreur : {e}</p>)}
        </div>
      )}
    </section>
  )
}

const ic = 'min-h-11 rounded-lg border border-border bg-bg-soft px-3 py-2 text-ink outline-none focus:border-terracotta'
