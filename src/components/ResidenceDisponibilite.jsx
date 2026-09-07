import { useEffect, useMemo, useState } from 'react'
import { supabase } from '../lib/supabase'
import {
  RESIDENCES,
  ACTIVE_RESERVATION_STATUTS,
  STATUT_STYLES,
  formatDA,
  effectiveStatut,
  reservationOnDate,
} from '../lib/residence'
import ResidenceReservationForm from './ResidenceReservationForm'

const todayISO = () => new Date().toISOString().slice(0, 10)

export default function ResidenceDisponibilite() {
  const [residence, setResidence] = useState(RESIDENCES[0])
  const [date, setDate] = useState(todayISO())
  const [mode, setMode] = useState('grid') // 'grid' | 'calendar'
  const [units, setUnits] = useState([])
  const [reservations, setReservations] = useState([])
  const [loading, setLoading] = useState(true)
  const [selected, setSelected] = useState(null) // unit

  useEffect(() => {
    let active = true
    async function load() {
      setLoading(true)
      const [{ data: u }, { data: r }] = await Promise.all([
        supabase.from('residence_units').select('*').order('code'),
        supabase.from('residence_reservations').select('*'),
      ])
      if (!active) return
      setUnits(u ?? [])
      setReservations(r ?? [])
      setLoading(false)
    }
    load()
    const channel = supabase
      .channel('residence-dispo')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'residence_units' }, load)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'residence_reservations' }, load)
      .subscribe()
    return () => {
      active = false
      supabase.removeChannel(channel)
    }
  }, [])

  const residenceUnits = useMemo(
    () => units.filter((u) => u.residence === residence),
    [units, residence]
  )

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-col gap-3 sm:flex-row sm:flex-wrap sm:items-end">
        <label className="flex flex-col gap-1.5">
          <span className="text-sm text-ink-muted">Résidence</span>
          <select value={residence} onChange={(e) => setResidence(e.target.value)} className={inputClass}>
            {RESIDENCES.map((r) => <option key={r} value={r}>{r}</option>)}
          </select>
        </label>
        <label className="flex flex-col gap-1.5">
          <span className="text-sm text-ink-muted">Disponibilité au</span>
          <input type="date" value={date} onChange={(e) => setDate(e.target.value)} className={inputClass} />
        </label>
        <div className="flex gap-2">
          <button
            type="button"
            onClick={() => setMode('grid')}
            className={`min-h-11 rounded-lg border px-4 py-2 font-display ${mode === 'grid' ? 'border-terracotta bg-terracotta text-ink' : 'border-border bg-bg-soft text-ink-muted'}`}
          >
            Grille
          </button>
          <button
            type="button"
            onClick={() => setMode('calendar')}
            className={`min-h-11 rounded-lg border px-4 py-2 font-display ${mode === 'calendar' ? 'border-terracotta bg-terracotta text-ink' : 'border-border bg-bg-soft text-ink-muted'}`}
          >
            Vue mensuelle
          </button>
        </div>
      </div>

      <Legend />

      {loading ? (
        <p className="text-ink-muted">Chargement…</p>
      ) : mode === 'grid' ? (
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {residenceUnits.map((u) => {
            const statut = effectiveStatut(u, reservations, date)
            const resa = reservationOnDate(reservations, u.id, date)
            const style = STATUT_STYLES[statut] ?? STATUT_STYLES.Disponible
            return (
              <button
                key={u.id}
                type="button"
                onClick={() => setSelected(u)}
                className={`flex flex-col gap-1 rounded-lg border p-4 text-left transition-colors hover:border-terracotta ${style.card}`}
              >
                <div className="flex items-center justify-between gap-2">
                  <span className="font-display text-lg text-ink">{u.nom}</span>
                  <span className={`h-2.5 w-2.5 shrink-0 rounded-full ${style.dot}`} />
                </div>
                <span className="text-xs text-ink-muted">
                  {u.code} · {u.type} · {u.capacite} pers.{u.capacite_note ? ` · ${u.capacite_note}` : ''}
                </span>
                <span className={`text-sm ${style.text}`}>{statut}</span>
                {resa && (
                  <span className="text-xs text-ink-muted">
                    {resa.client_name} · {resa.date_arrivee} → {resa.date_depart}
                  </span>
                )}
                {u.prix_nuit > 0 && (
                  <span className="text-xs text-ink-muted">{formatDA(u.prix_nuit)} DA / nuit</span>
                )}
              </button>
            )
          })}
        </div>
      ) : (
        <MonthCalendar units={residenceUnits} reservations={reservations} anchorDate={date} />
      )}

      {selected && (
        <UnitModal
          unit={selected}
          date={date}
          reservation={reservationOnDate(reservations, selected.id, date)}
          onClose={() => setSelected(null)}
        />
      )}
    </div>
  )
}

function Legend() {
  const items = [
    ['Disponible', 'bg-green-500'],
    ['Occupé', 'bg-terracotta'],
    ['En attente', 'bg-ocre'],
    ['Maintenance / Hors service', 'bg-ink-muted'],
  ]
  return (
    <div className="flex flex-wrap gap-4 text-xs text-ink-muted">
      {items.map(([label, dot]) => (
        <span key={label} className="flex items-center gap-1.5">
          <span className={`h-2.5 w-2.5 rounded-full ${dot}`} />
          {label}
        </span>
      ))}
    </div>
  )
}

function MonthCalendar({ units, reservations, anchorDate }) {
  const base = new Date(anchorDate)
  const year = base.getFullYear()
  const month = base.getMonth()
  const daysInMonth = new Date(year, month + 1, 0).getDate()
  const days = Array.from({ length: daysInMonth }, (_, i) => i + 1)
  const iso = (d) => `${year}-${String(month + 1).padStart(2, '0')}-${String(d).padStart(2, '0')}`

  return (
    <div className="overflow-x-auto rounded-lg border border-border">
      <table className="border-collapse text-[10px] sm:text-xs">
        <thead>
          <tr className="bg-bg-soft text-ink-muted">
            <th className="sticky left-0 z-10 bg-bg-soft px-2 py-1 text-left font-display">Logement</th>
            {days.map((d) => (
              <th key={d} className="min-w-6 px-1 py-1 font-display">{d}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {units.map((u) => (
            <tr key={u.id} className="border-t border-border">
              <td className="sticky left-0 z-10 bg-bg-card px-2 py-1 whitespace-nowrap text-ink">{u.nom}</td>
              {days.map((d) => {
                const dayISO = iso(d)
                const resa = (reservations ?? []).find(
                  (r) =>
                    r.unit_id === u.id &&
                    ACTIVE_RESERVATION_STATUTS.includes(r.statut) &&
                    r.date_arrivee <= dayISO &&
                    r.date_depart > dayISO
                )
                const cls = !resa
                  ? ''
                  : resa.statut === 'En attente'
                    ? 'bg-ocre/60'
                    : 'bg-terracotta/70'
                return <td key={d} className={`h-6 border-l border-border/60 ${cls}`} title={resa ? `${resa.client_name} (${resa.statut})` : ''} />
              })}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

function UnitModal({ unit, date, reservation, onClose }) {
  const [showForm, setShowForm] = useState(false)
  return (
    <div className="fixed inset-0 z-50 overflow-y-auto bg-black/70 p-0 sm:flex sm:items-center sm:justify-center sm:p-4" onClick={onClose}>
      <div
        className="min-h-full w-full bg-bg-card p-5 sm:my-8 sm:min-h-0 sm:max-w-2xl sm:rounded-xl sm:border sm:border-border"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="mb-4 flex items-center justify-between">
          <h2 className="font-display text-lg text-ink">
            {unit.nom} — {unit.residence}
          </h2>
          <button type="button" onClick={onClose} className="text-sm text-ink-muted hover:text-ink">Fermer ✕</button>
        </div>

        <div className="mb-4 grid grid-cols-2 gap-2 text-sm text-ink-muted">
          <span>Code : <span className="text-ink">{unit.code}</span></span>
          <span>Type : <span className="text-ink">{unit.type}</span></span>
          <span>Capacité : <span className="text-ink">{unit.capacite} pers.{unit.capacite_note ? ` (${unit.capacite_note})` : ''}</span></span>
          <span>Prix / nuit : <span className="text-ink">{formatDA(unit.prix_nuit)} DA</span></span>
          <span>Statut : <span className="text-ink">{unit.statut}</span></span>
          {unit.observations && <span className="col-span-2">Obs : <span className="text-ink">{unit.observations}</span></span>}
        </div>

        {reservation && !showForm && (
          <div className="mb-4 rounded-lg border border-terracotta/40 bg-terracotta/5 p-4 text-sm">
            <p className="mb-2 font-display text-ink">Réservation en cours au {date}</p>
            <div className="grid grid-cols-2 gap-1.5 text-ink-muted">
              <span>Client : <span className="text-ink">{reservation.client_name}</span></span>
              <span>Tél : <span className="text-ink">{reservation.client_phone ?? '—'}</span></span>
              <span>Arrivée : <span className="text-ink">{reservation.date_arrivee}</span></span>
              <span>Départ : <span className="text-ink">{reservation.date_depart}</span></span>
              <span>Personnes : <span className="text-ink">{reservation.nb_personnes}</span></span>
              <span>Nuits : <span className="text-ink">{reservation.nb_nuits}</span></span>
              <span>Montant : <span className="text-ink">{formatDA(reservation.montant_total)} DA</span></span>
              <span>Reste : <span className="text-ink">{formatDA(reservation.reste_a_payer)} DA</span></span>
              <span>Statut : <span className="text-ink">{reservation.statut}</span></span>
            </div>
          </div>
        )}

        {showForm ? (
          <ResidenceReservationForm
            defaults={{ residence: unit.residence, unitId: unit.id, dateArrivee: date }}
            onSaved={onClose}
            embedded
          />
        ) : (
          <button
            type="button"
            onClick={() => setShowForm(true)}
            className="min-h-11 w-full rounded-lg bg-terracotta px-4 py-2 font-display text-ink hover:bg-terracotta-hover"
          >
            Nouvelle réservation pour ce logement
          </button>
        )}
      </div>
    </div>
  )
}

const inputClass =
  'min-h-11 rounded-lg border border-border bg-bg-soft px-3 py-2 text-ink outline-none focus:border-terracotta'
