const ICON_PROPS = {
  viewBox: '0 0 24 24',
  fill: 'none',
  stroke: 'currentColor',
  strokeWidth: 1.8,
  strokeLinecap: 'round',
  strokeLinejoin: 'round',
}

function TruckIcon(props) {
  return (
    <svg {...ICON_PROPS} {...props}>
      <path d="M2 8h11v9H2z" />
      <path d="M13 11h4l4 3v3h-8z" />
      <circle cx="6.5" cy="18.5" r="1.6" />
      <circle cx="17.5" cy="18.5" r="1.6" />
    </svg>
  )
}

function ListIcon(props) {
  return (
    <svg {...ICON_PROPS} {...props}>
      <path d="M8 6h12" />
      <path d="M8 12h12" />
      <path d="M8 18h12" />
      <path d="M4 6h.01" />
      <path d="M4 12h.01" />
      <path d="M4 18h.01" />
    </svg>
  )
}

function WrenchIcon(props) {
  return (
    <svg {...ICON_PROPS} {...props}>
      <path d="M14.7 6.3a4 4 0 0 0-5.6 4.6L3 17l3 3 6.1-6.1a4 4 0 0 0 4.6-5.6l-2.5 2.5-2-2z" />
    </svg>
  )
}

function FuelIcon(props) {
  return (
    <svg {...ICON_PROPS} {...props}>
      <path d="M4 21V7a2 2 0 0 1 2-2h6a2 2 0 0 1 2 2v14" />
      <path d="M4 21h10" />
      <path d="M14 10h2l3 3v5a1.5 1.5 0 0 1-3 0v-1a1 1 0 0 0-1-1h-1" />
      <path d="M7 6v3h4V6" />
    </svg>
  )
}

const TABS = [
  { id: 'form', label: 'Saisie', Icon: TruckIcon },
  { id: 'registry', label: 'Registre', Icon: ListIcon },
  { id: 'maintenance', label: 'Maintenance', Icon: WrenchIcon },
  { id: 'fuel', label: 'Carburant', Icon: FuelIcon },
]

export default function BottomNav({ active, onChange }) {
  return (
    <nav className="fixed inset-x-0 bottom-0 z-40 border-t border-border bg-bg-card pb-[env(safe-area-inset-bottom)]">
      <div className="mx-auto flex max-w-4xl">
        {TABS.map(({ id, label, Icon }) => (
          <button
            key={id}
            type="button"
            onClick={() => onChange(id)}
            className={`flex min-h-14 flex-1 flex-col items-center justify-center gap-0.5 py-2 text-xs transition-colors ${
              active === id ? 'text-terracotta' : 'text-ink-muted hover:text-ink'
            }`}
          >
            <Icon className="h-5 w-5" />
            {label}
          </button>
        ))}
      </div>
    </nav>
  )
}
