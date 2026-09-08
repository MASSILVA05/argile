import { useState } from 'react'
import { supabase } from '../lib/supabase'
import { getSession } from '../lib/auth'
import { formatDA, formatQty } from '../lib/station'
import { parseStationFile, COUNTER_CLIENT } from '../lib/stationImportParser'

const CHUNK = 300

function chunk(arr, size) {
  const out = []
  for (let i = 0; i < arr.length; i += size) out.push(arr.slice(i, i + size))
  return out
}

const SECTIONS = [
  {
    key: 'carburant',
    label: 'Carburant',
    table: 'station_carburant',
    columns: [
      { key: 'entry_date', label: 'Date' },
      { key: 'client_name', label: 'Client' },
      { key: 'product', label: 'Produit' },
      { key: 'quantity', label: 'Qté (L)', format: formatQty },
      { key: 'unit_price', label: 'P.U.', format: formatDA },
      { key: 'payment_status', label: 'Paiement' },
    ],
    toRow: (r, user) => ({
      entry_date: r.entry_date || undefined,
      client_name: r.client_name,
      product: r.product,
      quantity: Number(r.quantity) || 0,
      unit_price: Number(r.unit_price) || 0,
      payment_status: r.payment_status || 'Non payé',
      observations: r.observations || undefined,
      entered_by_user: user,
    }),
  },
  {
    key: 'lubrifiants',
    label: 'Lubrifiants',
    table: 'station_lubrifiants',
    columns: [
      { key: 'entry_date', label: 'Date' },
      { key: 'client_name', label: 'Client' },
      { key: 'product', label: 'Désignation' },
      { key: 'quantity', label: 'Qté', format: formatQty },
      { key: 'unit', label: 'Unité' },
      { key: 'unit_price', label: 'P.U.', format: formatDA },
      { key: 'payment_status', label: 'Paiement' },
    ],
    toRow: (r, user) => ({
      entry_date: r.entry_date || undefined,
      client_name: r.client_name,
      product: r.product,
      quantity: Number(r.quantity) || 0,
      unit: r.unit || 'L',
      unit_price: Number(r.unit_price) || 0,
      payment_status: r.payment_status || 'Non payé',
      observations: r.observations || undefined,
      entered_by_user: user,
    }),
  },
  {
    key: 'gaz',
    label: 'Gaz',
    table: 'station_gaz',
    columns: [
      { key: 'entry_date', label: 'Date' },
      { key: 'client_name', label: 'Client' },
      { key: 'product', label: 'Produit' },
      { key: 'quantity', label: 'Qté', format: formatQty },
      { key: 'unit_price', label: 'P.U.', format: formatDA },
      { key: 'consigne', label: 'Consigne', format: formatDA },
      { key: 'payment_status', label: 'Paiement' },
    ],
    toRow: (r, user) => ({
      entry_date: r.entry_date || undefined,
      client_name: r.client_name,
      product: r.product,
      quantity: Math.round(Number(r.quantity) || 0),
      unit_price: Number(r.unit_price) || 0,
      consigne: Number(r.consigne) || 0,
      payment_status: r.payment_status || 'Non payé',
      observations: r.observations || undefined,
      entered_by_user: user,
    }),
  },
]

export default function StationImport() {
  const [fileName, setFileName] = useState('')
  const [parseError, setParseError] = useState('')
  const [buckets, setBuckets] = useState(null) // { carburant: [{...,selected,__key}], ... }
  const [importing, setImporting] = useState(false)
  const [summary, setSummary] = useState(null)

  async function handleFile(e) {
    const file = e.target.files?.[0]
    if (!file) return
    setFileName(file.name)
    setParseError('')
    setSummary(null)
    try {
      const parsed = parseStationFile(await file.arrayBuffer())
      const next = {}
      let anyRows = false
      for (const s of SECTIONS) {
        const rows = parsed[s.key] ?? []
        if (rows.length) anyRows = true
        next[s.key] = rows.map((r, i) => ({ ...r, __key: `${s.key}-${i}`, selected: true }))
      }
      setBuckets(next)
      if (!anyRows) {
        setParseError(
          "Aucun onglet exploitable. Formats acceptés : (1) état des ventes mensuel (onglets avec en-tête DATTE / SANS PLOMB / GASOIL / GAZ BUTAN) ; (2) onglets par client nommés CARBURANT / LUBRIFIANT / GAZ."
        )
      }
    } catch (err) {
      setBuckets(null)
      setParseError(`Erreur de lecture : ${err.message}`)
    }
  }

  function toggle(sectionKey, rowKey) {
    setBuckets((cur) => ({
      ...cur,
      [sectionKey]: cur[sectionKey].map((r) => (r.__key === rowKey ? { ...r, selected: !r.selected } : r)),
    }))
  }

  function toggleAll(sectionKey, checked) {
    setBuckets((cur) => ({
      ...cur,
      [sectionKey]: cur[sectionKey].map((r) => ({ ...r, selected: checked })),
    }))
  }

  async function runImport() {
    setImporting(true)
    setSummary(null)
    const user = getSession()?.username ?? null
    const result = { done: 0, total: 0, errors: [] }
    for (const s of SECTIONS) {
      const selected = (buckets[s.key] ?? []).filter((r) => r.selected)
      result.total += selected.length
      const payload = selected.map((r) => s.toRow(r, user))
      for (const part of chunk(payload, CHUNK)) {
        const { error } = await supabase.from(s.table).insert(part)
        if (error) result.errors.push(`${s.label} : ${error.message}`)
        else result.done += part.length
      }
    }
    setImporting(false)
    setSummary(result)
  }

  const totalSelected = buckets
    ? SECTIONS.reduce((n, s) => n + (buckets[s.key] ?? []).filter((r) => r.selected).length, 0)
    : 0

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-col gap-2">
        <p className="text-xs text-ink-muted">
          Deux formats reconnus automatiquement :
        </p>
        <ul className="ml-4 list-disc text-xs text-ink-muted">
          <li>
            <strong>État des ventes mensuel</strong> (fichier « ETAT DES VENTE SARL STATION ») : un onglet par mois,
            en-tête <em>DATTE / SANS PLOMB / GASOIL / GAZ BUTAN / TOTAL</em>. Chaque jour devient une vente comptoir
            (client <strong>{COUNTER_CLIENT}</strong>, quantité 1, prix unitaire = recette du jour). SANS PLOMB → Essence,
            GASOIL → Gasoil, GAZ BUTAN → onglet Gaz. L'onglet trésorerie (versements) est ignoré.
          </li>
          <li>
            <strong>Onglets par client</strong> nommés CARBURANT / LUBRIFIANT / GAZ (colonnes Date, Client, Qté, P.U,
            Total, Consigne, Payé… détectées par mots-clés).
          </li>
        </ul>
        <p className="text-xs text-ink-muted">
          Les lignes sont <strong>ajoutées</strong> (pas de dédoublonnage) : n'importez qu'une seule fois.
        </p>
        <label className="inline-flex min-h-11 w-fit cursor-pointer items-center rounded-lg border border-ocre px-4 py-2 font-display text-ocre transition-colors hover:bg-ocre/10">
          Importer fichier Station
          <input type="file" accept=".xlsx,.xls" onChange={handleFile} className="hidden" />
        </label>
        {fileName && <p className="text-sm text-ink-muted">Fichier : {fileName}</p>}
      </div>

      {parseError && (
        <p className="rounded-lg border border-terracotta/50 bg-terracotta/10 px-4 py-3 text-sm text-terracotta">{parseError}</p>
      )}

      {buckets &&
        SECTIONS.map((s) => {
          const rows = buckets[s.key] ?? []
          if (rows.length === 0) return null
          const selectedCount = rows.filter((r) => r.selected).length
          return (
            <section key={s.key} className="flex flex-col gap-3">
              <h2 className="font-display text-lg text-ink">
                {s.label} — {rows.length} ligne(s)
              </h2>
              <label className="flex items-center gap-2 text-sm">
                <input
                  type="checkbox"
                  checked={selectedCount === rows.length}
                  onChange={(e) => toggleAll(s.key, e.target.checked)}
                  className="h-4 w-4 accent-terracotta"
                />
                Tout sélectionner ({selectedCount}/{rows.length})
              </label>
              <div className="max-h-[360px] overflow-auto rounded-lg border border-border">
                <table className="w-full min-w-[720px] border-collapse text-[11px] sm:text-sm">
                  <thead className="sticky top-0 bg-bg-soft">
                    <tr className="border-b border-border text-left text-ink-muted">
                      <th className="px-2 py-2"></th>
                      {s.columns.map((c) => (
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
                            onChange={() => toggle(s.key, r.__key)}
                            className="h-4 w-4 accent-terracotta"
                          />
                        </td>
                        {s.columns.map((c) => (
                          <td key={c.key} className="px-2 py-1 whitespace-nowrap">
                            {c.format ? c.format(r[c.key]) : r[c.key] || '—'}
                          </td>
                        ))}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </section>
          )
        })}

      {summary && (
        <div className="rounded-lg border border-ocre/50 bg-ocre/10 px-4 py-3 text-sm text-ocre">
          <p>{summary.done} / {summary.total} ligne(s) importée(s).</p>
          {summary.errors.length > 0 && (
            <ul className="mt-2 list-disc pl-5 text-terracotta">
              {summary.errors.map((e, i) => (
                <li key={i}>{e}</li>
              ))}
            </ul>
          )}
        </div>
      )}

      {buckets && totalSelected > 0 && (
        <button
          type="button"
          onClick={runImport}
          disabled={importing}
          className="min-h-12 rounded-lg bg-terracotta px-4 py-3 font-display text-lg font-medium tracking-wide text-ink transition-colors hover:bg-terracotta-hover disabled:opacity-50"
        >
          {importing ? 'Import en cours…' : `Importer (${totalSelected})`}
        </button>
      )}
    </div>
  )
}
