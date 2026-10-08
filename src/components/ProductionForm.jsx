import { useEffect, useMemo, useState } from 'react'
import { supabase } from '../lib/supabase'
import { getSession } from '../lib/auth'
import { notifyProductionEntry } from '../lib/ntfy'
import {
  EQUIPES,
  POSTES,
  PRODUITS,
  SECTIONS,
  COMBUSTIBLES,
  EMBALLAGE_TYPES,
  DEFAULT_ETAGES_CHARIOT,
  defaultPiecesEtage,
  computePresseTotal,
  computeTauxCasse,
  computeTauxPremierChoix,
  formatInt,
  formatPercent,
  toNum,
  todayISO,
} from '../lib/production'

const formatHHMM = (date) => date.toTimeString().slice(0, 5)

// Champs numériques du formulaire (convertis en Number à l'envoi ; '' -> 0).
const NUMERIC_FIELDS = [
  'presse_chariots', 'presse_pression', 'presse_pieces_etage', 'presse_etages_chariot', 'presse_rebutes',
  'presse_qte_rangee', 'presse_temps_cycle',
  'sechoir_entres', 'sechoir_sortis', 'sechoir_temperature', 'sechoir_humidite', 'sechoir_duree', 'sechoir_rebutes',
  'sechoir_humidite_entree', 'sechoir_humidite_sortie', 'sechoir_temp_zone1', 'sechoir_temp_zone2',
  'four_enfournes', 'four_defournes', 'four_temperature', 'four_duree', 'four_gaz',
  'four_temp_prechauffe', 'four_temp_cuisson', 'four_temp_refroid', 'four_pression',
  'defourn_chariots', 'defourn_conformes', 'defourn_cassees', 'defourn_fissurees',
  'defourn_premier_choix', 'defourn_deuxieme_choix', 'defourn_rebut',
  'emballage_paquets', 'emballage_pieces_paquet', 'emballage_palettes', 'emballage_stock_final',
  'emballage_poids_palette',
]

// Champs texte (trim, '' -> null).
const TEXT_FIELDS = [
  'presse_numeros', 'presse_moule', 'presse_arrets', 'presse_remarques',
  'sechoir_remarques', 'four_remarques', 'defourn_remarques',
  'emballage_destination', 'emballage_remarques',
]

const DEFAULT_DESTINATIONS = ['Stock']

function emptyDraft() {
  return {
    entry_date: todayISO(),
    equipe: 'A',
    poste: '1',
    operateur: '',
    produit: 'B8',
    presse_chariots: '',
    presse_numeros: '',
    presse_pression: '',
    presse_pieces_etage: String(defaultPiecesEtage('B8')),
    presse_etages_chariot: String(DEFAULT_ETAGES_CHARIOT),
    presse_rebutes: '',
    presse_moule: '',
    presse_qte_rangee: '',
    presse_temps_cycle: '',
    presse_arrets: '',
    presse_remarques: '',
    sechoir_entres: '',
    sechoir_sortis: '',
    sechoir_temperature: '',
    sechoir_humidite: '',
    sechoir_humidite_entree: '',
    sechoir_humidite_sortie: '',
    sechoir_temp_zone1: '',
    sechoir_temp_zone2: '',
    sechoir_duree: '',
    sechoir_rebutes: '',
    sechoir_remarques: '',
    four_enfournes: '',
    four_defournes: '',
    four_combustible: COMBUSTIBLES[0],
    four_temperature: '',
    four_temp_prechauffe: '',
    four_temp_cuisson: '',
    four_temp_refroid: '',
    four_pression: '',
    four_duree: '',
    four_gaz: '',
    four_remarques: '',
    defourn_chariots: '',
    defourn_conformes: '',
    defourn_cassees: '',
    defourn_fissurees: '',
    defourn_premier_choix: '',
    defourn_deuxieme_choix: '',
    defourn_rebut: '',
    defourn_remarques: '',
    emballage_paquets: '',
    emballage_pieces_paquet: '',
    emballage_palettes: '',
    emballage_stock_final: '',
    emballage_type: EMBALLAGE_TYPES[0],
    emballage_destination: '',
    emballage_poids_palette: '',
    emballage_remarques: '',
  }
}

export default function ProductionForm() {
  const [draft, setDraft] = useState(emptyDraft)
  const [section, setSection] = useState('presse')
  const [operateurs, setOperateurs] = useState([])
  const [destinations, setDestinations] = useState(DEFAULT_DESTINATIONS)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [success, setSuccess] = useState('')
  const [clock, setClock] = useState(() => formatHHMM(new Date()))
  // true dès que l'utilisateur touche manuellement au champ pièces/étage :
  // on arrête alors de le forcer au défaut lors d'un changement de produit.
  const [piecesTouched, setPiecesTouched] = useState(false)

  useEffect(() => {
    const id = setInterval(() => setClock(formatHHMM(new Date())), 30_000)
    return () => clearInterval(id)
  }, [])

  useEffect(() => {
    async function load() {
      const { data } = await supabase
        .from('production_entries')
        .select('operateur, emballage_destination')
        .order('created_at', { ascending: false })
        .limit(500)
      setOperateurs([...new Set((data ?? []).map((r) => r.operateur).filter(Boolean))])
      setDestinations([
        ...new Set([...DEFAULT_DESTINATIONS, ...(data ?? []).map((r) => r.emballage_destination).filter(Boolean)]),
      ])
    }
    load()
  }, [])

  function update(field, value) {
    setDraft((d) => ({ ...d, [field]: value }))
  }

  function updateProduit(value) {
    setDraft((d) => ({
      ...d,
      produit: value,
      presse_pieces_etage: piecesTouched ? d.presse_pieces_etage : String(defaultPiecesEtage(value)),
    }))
  }

  const presseTotal = useMemo(
    () => computePresseTotal(draft.presse_chariots, draft.presse_etages_chariot, draft.presse_pieces_etage),
    [draft.presse_chariots, draft.presse_etages_chariot, draft.presse_pieces_etage]
  )

  const tauxCasse = useMemo(
    () => computeTauxCasse(draft.defourn_conformes, draft.defourn_cassees, draft.defourn_fissurees),
    [draft.defourn_conformes, draft.defourn_cassees, draft.defourn_fissurees]
  )

  const tauxPremierChoix = useMemo(
    () => computeTauxPremierChoix(draft.defourn_premier_choix, draft.defourn_deuxieme_choix, draft.defourn_rebut),
    [draft.defourn_premier_choix, draft.defourn_deuxieme_choix, draft.defourn_rebut]
  )

  async function handleSubmit(e) {
    e.preventDefault()
    setSuccess('')
    if (!draft.entry_date) {
      setError('La date de production est obligatoire.')
      return
    }
    setError('')
    setLoading(true)

    const payload = {
      entry_date: draft.entry_date,
      entry_time: formatHHMM(new Date()),
      equipe: draft.equipe,
      poste: draft.poste,
      operateur: draft.operateur.trim() || null,
      produit: draft.produit,
      four_combustible: draft.four_combustible,
      emballage_type: draft.emballage_type,
      entered_by_user: getSession()?.username ?? null,
    }
    for (const f of TEXT_FIELDS) payload[f] = draft[f].trim() || null
    for (const f of NUMERIC_FIELDS) payload[f] = toNum(draft[f])

    const { data, error: insertError } = await supabase
      .from('production_entries')
      .insert(payload)
      .select()
      .single()

    setLoading(false)

    if (insertError) {
      setError(`Erreur d'enregistrement : ${insertError.message}`)
      return
    }

    notifyProductionEntry(data)
    setSuccess(
      `Saisie enregistrée — ${data.produit}, équipe ${data.equipe}, poste ${data.poste} (${formatInt(data.presse_total_pieces)} pièces pressées).`
    )
    setDraft((d) => {
      const fresh = emptyDraft()
      return { ...fresh, entry_date: d.entry_date, equipe: d.equipe, poste: d.poste, produit: d.produit,
        presse_pieces_etage: String(defaultPiecesEtage(d.produit)),
        presse_moule: d.presse_moule, four_combustible: d.four_combustible, emballage_type: d.emballage_type }
    })
    setPiecesTouched(false)
    setSection('presse')
    if (payload.operateur) setOperateurs((p) => [...new Set([payload.operateur, ...p])])
    if (payload.emballage_destination) setDestinations((p) => [...new Set([...p, payload.emballage_destination])])
  }

  return (
    <form onSubmit={handleSubmit} className="flex flex-col gap-4">
      {/* En-tête */}
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
        <Field label="Date de production" required>
          <input type="date" value={draft.entry_date} onChange={(e) => update('entry_date', e.target.value)} className={inputClass} required />
        </Field>
        <Field label="Heure">
          <input type="text" value={clock} readOnly disabled className={`${inputClass} cursor-not-allowed opacity-60`} />
        </Field>
        <Field label="Équipe" required>
          <select value={draft.equipe} onChange={(e) => update('equipe', e.target.value)} className={inputClass}>
            {EQUIPES.map((x) => <option key={x} value={x}>{x}</option>)}
          </select>
        </Field>
        <Field label="Poste" required>
          <select value={draft.poste} onChange={(e) => update('poste', e.target.value)} className={inputClass}>
            {POSTES.map((p) => <option key={p.value} value={p.value}>{p.label}</option>)}
          </select>
        </Field>
        <Field label="Opérateur">
          <input
            type="text"
            list="production-operateurs-list"
            value={draft.operateur}
            onChange={(e) => update('operateur', e.target.value)}
            className={inputClass}
            autoComplete="off"
            placeholder="nom de l'opérateur"
          />
          <datalist id="production-operateurs-list">
            {operateurs.map((o) => <option key={o} value={o} />)}
          </datalist>
        </Field>
        <Field label="Produit" required>
          <select value={draft.produit} onChange={(e) => updateProduit(e.target.value)} className={inputClass}>
            {PRODUITS.map((x) => <option key={x} value={x}>{x}</option>)}
          </select>
        </Field>
      </div>

      {/* Onglets de section */}
      <nav className="flex gap-2 overflow-x-auto">
        {SECTIONS.map((s) => (
          <button
            key={s.id}
            type="button"
            onClick={() => setSection(s.id)}
            className={`min-h-10 shrink-0 rounded-lg border px-3 py-2 text-sm font-display transition-colors ${
              section === s.id
                ? 'border-terracotta bg-terracotta text-ink'
                : 'border-border bg-bg-soft text-ink-muted hover:border-terracotta/60'
            }`}
          >
            {s.label}
          </button>
        ))}
      </nav>

      {section === 'presse' && (
        <Section>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
            <Counter label="Chariots produits" value={draft.presse_chariots} onChange={(v) => update('presse_chariots', v)} />
            <Field label="N° des chariots">
              <input type="text" value={draft.presse_numeros} onChange={(e) => update('presse_numeros', e.target.value)} className={inputClass} placeholder="ex : 12-51 ou 12,13,14" />
            </Field>
            <Field label="Pression mouleuse (bar)">
              <input type="number" inputMode="decimal" step="0.01" value={draft.presse_pression} onChange={(e) => update('presse_pression', e.target.value)} className={inputClass} />
            </Field>
            <Field label="Pièces par étage">
              <input
                type="number" inputMode="numeric" min="0"
                value={draft.presse_pieces_etage}
                onChange={(e) => { setPiecesTouched(true); update('presse_pieces_etage', e.target.value) }}
                className={inputClass}
              />
            </Field>
            <Field label="Étages par chariot">
              <input type="number" inputMode="numeric" min="0" value={draft.presse_etages_chariot} onChange={(e) => update('presse_etages_chariot', e.target.value)} className={inputClass} />
            </Field>
            <Counter label="Chariots rebutés" value={draft.presse_rebutes} onChange={(v) => update('presse_rebutes', v)} />
            <Field label="N° moule">
              <input type="text" value={draft.presse_moule} onChange={(e) => update('presse_moule', e.target.value)} className={inputClass} placeholder="ex : M-12" />
            </Field>
            <NumberField label="Quantité par rangée" value={draft.presse_qte_rangee} onChange={(v) => update('presse_qte_rangee', v)} integer />
            <NumberField label="Temps de cycle (secondes)" value={draft.presse_temps_cycle} onChange={(v) => update('presse_temps_cycle', v)} />
          </div>
          <Computed
            label="Calcul automatique"
            value={`${formatInt(draft.presse_chariots)} chariots × ${formatInt(draft.presse_etages_chariot)} étages × ${formatInt(draft.presse_pieces_etage)} pièces = ${formatInt(presseTotal)} pièces`}
          />
          <Field label="Remarques arrêts">
            <textarea
              value={draft.presse_arrets}
              onChange={(e) => update('presse_arrets', e.target.value)}
              className={`${inputClass} min-h-16 resize-y`}
              placeholder="ex : Arrêt 30min — bourrage ; Arrêt 1h — panne moteur"
            />
          </Field>
          <Remarks value={draft.presse_remarques} onChange={(v) => update('presse_remarques', v)} />
        </Section>
      )}

      {section === 'sechoir' && (
        <Section>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
            <Counter label="Chariots entrés au séchoir" value={draft.sechoir_entres} onChange={(v) => update('sechoir_entres', v)} />
            <Counter label="Chariots sortis du séchoir" value={draft.sechoir_sortis} onChange={(v) => update('sechoir_sortis', v)} />
            <Counter label="Chariots rebutés séchoir" value={draft.sechoir_rebutes} onChange={(v) => update('sechoir_rebutes', v)} />
            <NumberField label="Température séchoir (°C)" value={draft.sechoir_temperature} onChange={(v) => update('sechoir_temperature', v)} />
            <NumberField label="Humidité (%)" value={draft.sechoir_humidite} onChange={(v) => update('sechoir_humidite', v)} />
            <NumberField label="Humidité entrée (%)" value={draft.sechoir_humidite_entree} onChange={(v) => update('sechoir_humidite_entree', v)} />
            <NumberField label="Humidité sortie (%)" value={draft.sechoir_humidite_sortie} onChange={(v) => update('sechoir_humidite_sortie', v)} />
            <NumberField label="Température zone 1 (°C)" value={draft.sechoir_temp_zone1} onChange={(v) => update('sechoir_temp_zone1', v)} />
            <NumberField label="Température zone 2 (°C)" value={draft.sechoir_temp_zone2} onChange={(v) => update('sechoir_temp_zone2', v)} />
            <NumberField label="Temps de séchage total (heures)" value={draft.sechoir_duree} onChange={(v) => update('sechoir_duree', v)} />
          </div>
          <Remarks value={draft.sechoir_remarques} onChange={(v) => update('sechoir_remarques', v)} />
        </Section>
      )}

      {section === 'four' && (
        <Section>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
            <Counter label="Chariots enfournés" value={draft.four_enfournes} onChange={(v) => update('four_enfournes', v)} />
            <Counter label="Chariots défournés" value={draft.four_defournes} onChange={(v) => update('four_defournes', v)} />
            <Field label="Type de combustible">
              <select value={draft.four_combustible} onChange={(e) => update('four_combustible', e.target.value)} className={inputClass}>
                {COMBUSTIBLES.map((x) => <option key={x} value={x}>{x}</option>)}
              </select>
            </Field>
            <NumberField label="Température four (°C)" value={draft.four_temperature} onChange={(v) => update('four_temperature', v)} />
            <NumberField label="Temp. zone préchauffage (°C)" value={draft.four_temp_prechauffe} onChange={(v) => update('four_temp_prechauffe', v)} />
            <NumberField label="Temp. zone cuisson (°C)" value={draft.four_temp_cuisson} onChange={(v) => update('four_temp_cuisson', v)} />
            <NumberField label="Temp. zone refroidissement (°C)" value={draft.four_temp_refroid} onChange={(v) => update('four_temp_refroid', v)} />
            <NumberField label="Pression four (mbar)" value={draft.four_pression} onChange={(v) => update('four_pression', v)} />
            <NumberField label="Durée cuisson (heures)" value={draft.four_duree} onChange={(v) => update('four_duree', v)} />
            <NumberField label="Consommation gaz (m³)" value={draft.four_gaz} onChange={(v) => update('four_gaz', v)} />
          </div>
          <Remarks value={draft.four_remarques} onChange={(v) => update('four_remarques', v)} />
        </Section>
      )}

      {section === 'defourn' && (
        <Section>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
            <Counter label="Chariots défournés" value={draft.defourn_chariots} onChange={(v) => update('defourn_chariots', v)} />
            <Counter label="Pièces conformes" value={draft.defourn_conformes} onChange={(v) => update('defourn_conformes', v)} step={10} />
            <Counter label="Pièces cassées" value={draft.defourn_cassees} onChange={(v) => update('defourn_cassees', v)} />
            <Counter label="Pièces fissurées" value={draft.defourn_fissurees} onChange={(v) => update('defourn_fissurees', v)} />
          </div>
          <Computed label="Taux de casse" value={formatPercent(tauxCasse)} danger={tauxCasse >= 5} />
          <p className="font-display text-sm text-ink">Classement qualité</p>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
            <Counter label="1er choix (conformes premium)" value={draft.defourn_premier_choix} onChange={(v) => update('defourn_premier_choix', v)} step={10} />
            <Counter label="2ème choix (défauts mineurs)" value={draft.defourn_deuxieme_choix} onChange={(v) => update('defourn_deuxieme_choix', v)} />
            <Counter label="Rebut (cassées / inutilisables)" value={draft.defourn_rebut} onChange={(v) => update('defourn_rebut', v)} />
          </div>
          <Computed label="Taux de 1er choix" value={formatPercent(tauxPremierChoix)} />
          <Remarks value={draft.defourn_remarques} onChange={(v) => update('defourn_remarques', v)} />
        </Section>
      )}

      {section === 'emballage' && (
        <Section>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
            <Counter label="Paquets produits" value={draft.emballage_paquets} onChange={(v) => update('emballage_paquets', v)} />
            <Counter label="Pièces par paquet" value={draft.emballage_pieces_paquet} onChange={(v) => update('emballage_pieces_paquet', v)} />
            <Counter label="Palettes produites" value={draft.emballage_palettes} onChange={(v) => update('emballage_palettes', v)} />
            <NumberField label="Stock final produit (pièces)" value={draft.emballage_stock_final} onChange={(v) => update('emballage_stock_final', v)} integer />
            <Field label="Type d'emballage">
              <select value={draft.emballage_type} onChange={(e) => update('emballage_type', e.target.value)} className={inputClass}>
                {EMBALLAGE_TYPES.map((x) => <option key={x} value={x}>{x}</option>)}
              </select>
            </Field>
            <Field label="Destination">
              <input
                type="text"
                list="production-destinations-list"
                value={draft.emballage_destination}
                onChange={(e) => update('emballage_destination', e.target.value)}
                className={inputClass}
                autoComplete="off"
                placeholder="ex : Stock, Chantier X, Client Y"
              />
              <datalist id="production-destinations-list">
                {destinations.map((o) => <option key={o} value={o} />)}
              </datalist>
            </Field>
            <NumberField label="Poids palette (kg)" value={draft.emballage_poids_palette} onChange={(v) => update('emballage_poids_palette', v)} />
          </div>
          <Remarks value={draft.emballage_remarques} onChange={(v) => update('emballage_remarques', v)} />
        </Section>
      )}

      {error && <p className="rounded-lg border border-terracotta/50 bg-terracotta/10 px-4 py-3 text-sm text-terracotta">{error}</p>}
      {success && <p className="rounded-lg border border-ocre/50 bg-ocre/10 px-4 py-3 text-sm text-ocre">{success}</p>}

      <button
        type="submit"
        disabled={loading}
        className="min-h-12 rounded-lg bg-terracotta px-4 py-3 font-display text-lg font-medium tracking-wide text-ink transition-colors hover:bg-terracotta-hover disabled:opacity-50"
      >
        {loading ? 'Enregistrement…' : 'Enregistrer la saisie'}
      </button>
    </form>
  )
}

function Section({ children }) {
  return <div className="flex flex-col gap-4 rounded-lg border border-border bg-bg-soft p-4">{children}</div>
}

function Field({ label, required, children }) {
  return (
    <label className="flex flex-col gap-1.5">
      <span className="text-sm text-ink-muted">
        {label}
        {required && <span className="text-terracotta"> *</span>}
      </span>
      {children}
    </label>
  )
}

function NumberField({ label, value, onChange, integer }) {
  return (
    <Field label={label}>
      <input
        type="number"
        inputMode={integer ? 'numeric' : 'decimal'}
        step={integer ? '1' : '0.01'}
        min="0"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className={inputClass}
      />
    </Field>
  )
}

function Counter({ label, value, onChange, step = 1 }) {
  const n = toNum(value)
  return (
    <Field label={label}>
      <div className="flex items-stretch gap-2">
        <button
          type="button"
          onClick={() => onChange(String(Math.max(0, n - step)))}
          className="min-h-11 w-11 shrink-0 rounded-lg border border-border bg-bg text-lg text-ink-muted hover:border-terracotta"
        >
          −
        </button>
        <input
          type="number"
          inputMode="numeric"
          min="0"
          value={value}
          onChange={(e) => onChange(e.target.value)}
          className={`${inputClass} text-center`}
        />
        <button
          type="button"
          onClick={() => onChange(String(n + step))}
          className="min-h-11 w-11 shrink-0 rounded-lg border border-ocre bg-bg text-lg text-ocre hover:bg-ocre/10"
        >
          +
        </button>
      </div>
    </Field>
  )
}

function Computed({ label, value, danger }) {
  return (
    <div className={`rounded-lg border px-4 py-3 ${danger ? 'border-terracotta/60 bg-terracotta/10' : 'border-ocre/50 bg-ocre/10'}`}>
      <p className="text-xs text-ink-muted">{label}</p>
      <p className={`font-display text-lg ${danger ? 'text-terracotta' : 'text-ocre'}`}>{value}</p>
    </div>
  )
}

function Remarks({ value, onChange }) {
  return (
    <Field label="Remarques">
      <textarea value={value} onChange={(e) => onChange(e.target.value)} className={`${inputClass} min-h-16 resize-y`} placeholder="optionnel" />
    </Field>
  )
}

const inputClass =
  'min-h-11 w-full rounded-lg border border-border bg-bg-soft px-3 py-2 text-ink placeholder:text-ink-muted/60 outline-none focus:border-terracotta'
