import { useEffect, useMemo, useState } from 'react'
import { supabase } from '../lib/supabase'
import { formatEUR, formatQty, budgetPct, budgetColor, productQtyRestante } from '../lib/ppi'

const BAR_COLOR = {
  green: 'bg-green-500',
  ocre: 'bg-ocre',
  terracotta: 'bg-terracotta',
}
const TEXT_COLOR = {
  green: 'text-green-500',
  ocre: 'text-ocre',
  terracotta: 'text-terracotta',
}

export default function PPIBudget() {
  const [countries, setCountries] = useState([])
  const [products, setProducts] = useState([])
  const [loading, setLoading] = useState(true)
  const [expanded, setExpanded] = useState(null)

  useEffect(() => {
    let active = true
    async function load() {
      setLoading(true)
      const [{ data: countryRows }, { data: productRows }] = await Promise.all([
        supabase.from('ppi_countries').select('*').order('name_fr'),
        supabase.from('ppi_products').select('*').order('designation'),
      ])
      if (!active) return
      setCountries(countryRows ?? [])
      setProducts(productRows ?? [])
      setLoading(false)
    }
    load()

    const channel = supabase
      .channel('ppi-budget')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'ppi_countries' }, load)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'ppi_products' }, load)
      .subscribe()

    return () => {
      active = false
      supabase.removeChannel(channel)
    }
  }, [])

  const productsByCountry = useMemo(() => {
    const map = new Map()
    for (const p of products) {
      const list = map.get(p.country_id) ?? []
      list.push(p)
      map.set(p.country_id, list)
    }
    return map
  }, [products])

  const totalAutorise = countries.reduce((s, c) => s + (Number(c.budget_autorise) || 0), 0)
  const totalConsomme = countries.reduce((s, c) => s + (Number(c.budget_consomme) || 0), 0)
  const totalRestant = totalAutorise - totalConsomme
  const totalPct = totalAutorise > 0 ? Math.min(100, (totalConsomme / totalAutorise) * 100) : 0
  const totalColor = budgetColor(totalPct)

  if (loading) return <p className="text-ink-muted">Chargement…</p>

  return (
    <div className="flex flex-col gap-4">
      <div className="rounded-lg border border-border bg-bg-soft p-4">
        <div className="mb-2 flex flex-wrap items-baseline justify-between gap-2">
          <p className="font-display text-lg text-ink">Total général</p>
          <p className="text-sm text-ink-muted">
            Autorisé : <span className="text-ink">{formatEUR(totalAutorise)} €</span> · Consommé :{' '}
            <span className="text-ink">{formatEUR(totalConsomme)} €</span> · Restant :{' '}
            <span className={`font-medium ${TEXT_COLOR[totalColor]}`}>{formatEUR(totalRestant)} €</span>
          </p>
        </div>
        <ProgressBar pct={totalPct} color={totalColor} />
      </div>

      {countries.map((c) => {
        const pct = budgetPct(c)
        const color = budgetColor(pct)
        const countryProducts = productsByCountry.get(c.id) ?? []
        const isOpen = expanded === c.id
        return (
          <div key={c.id} className="rounded-lg border border-border bg-bg-soft p-4">
            <div className="mb-2 flex flex-wrap items-baseline justify-between gap-2">
              <p className="font-display text-lg text-ink">
                {c.name_fr} <span className="text-sm text-ink-muted">({c.name_ar})</span>
              </p>
              <p className="text-sm text-ink-muted">{pct.toFixed(1)}% consommé</p>
            </div>
            <ProgressBar pct={pct} color={color} />
            <div className="mt-3 grid grid-cols-1 gap-3 text-sm sm:grid-cols-3">
              <Stat label="Budget autorisé" value={`${formatEUR(c.budget_autorise)} €`} />
              <Stat label="Budget consommé" value={`${formatEUR(c.budget_consomme)} €`} className={TEXT_COLOR[color]} />
              <Stat label="Budget restant" value={`${formatEUR(c.budget_restant)} €`} className="text-ink" />
            </div>

            <button
              type="button"
              onClick={() => setExpanded((cur) => (cur === c.id ? null : c.id))}
              className="mt-3 rounded border border-border px-3 py-1.5 text-sm text-ink-muted hover:border-ocre hover:text-ocre"
            >
              {countryProducts.length} produit(s) — {isOpen ? 'masquer' : 'voir le détail'}
            </button>

            {isOpen && (
              <div className="mt-3 overflow-x-auto rounded-lg border border-border">
                <table className="w-full min-w-[640px] border-collapse text-[11px] sm:text-sm">
                  <thead>
                    <tr className="border-b border-border bg-bg text-left text-ink-muted">
                      <th className="px-2 py-1.5">Désignation</th>
                      <th className="px-2 py-1.5">Position tarifaire</th>
                      <th className="px-2 py-1.5 text-right">Qté autorisée</th>
                      <th className="px-2 py-1.5 text-right">Déjà importé</th>
                      <th className="px-2 py-1.5 text-right">Reste</th>
                    </tr>
                  </thead>
                  <tbody>
                    {countryProducts.length === 0 ? (
                      <tr><td colSpan={5} className="px-2 py-3 text-center text-ink-muted">Aucun produit importé pour ce pays.</td></tr>
                    ) : (
                      countryProducts.map((p) => {
                        const reste = productQtyRestante(p)
                        return (
                          <tr key={p.id} className="border-b border-border last:border-0">
                            <td className="max-w-[220px] truncate px-2 py-1.5" title={p.designation}>{p.designation}</td>
                            <td className="px-2 py-1.5">{p.position_tarifaire}</td>
                            <td className="px-2 py-1.5 text-right">{formatQty(p.quantite_autorisee)}</td>
                            <td className="px-2 py-1.5 text-right">{formatQty(p.stock_actuel)}</td>
                            <td className={`px-2 py-1.5 text-right ${reste < 0 ? 'font-medium text-terracotta' : ''}`}>{formatQty(reste)}</td>
                          </tr>
                        )
                      })
                    )}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        )
      })}
    </div>
  )
}

function ProgressBar({ pct, color }) {
  return (
    <div className="h-3 w-full overflow-hidden rounded-full bg-border/40">
      <div
        className={`h-full rounded-full transition-all ${BAR_COLOR[color]}`}
        style={{ width: `${Math.max(2, Math.min(100, pct))}%` }}
      />
    </div>
  )
}

function Stat({ label, value, className = '' }) {
  return (
    <div>
      <p className="text-xs text-ink-muted">{label}</p>
      <p className={`font-display text-base ${className}`}>{value}</p>
    </div>
  )
}
