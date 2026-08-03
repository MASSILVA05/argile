export default function ExportChoiceModal({ open, onChoose, onCancel }) {
  if (!open) return null

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4" onClick={onCancel}>
      <div
        className="w-full max-w-sm rounded-xl border border-border bg-bg-card p-5"
        onClick={(e) => e.stopPropagation()}
      >
        <h2 className="mb-1 font-display text-lg text-ink">Exporter le registre</h2>
        <p className="mb-4 text-sm text-ink-muted">
          Avec les photos, le fichier est plus complet mais plus lent à générer et plus volumineux.
        </p>
        <div className="flex flex-col gap-2 sm:flex-row">
          <button
            type="button"
            onClick={() => onChoose(true)}
            className="min-h-11 flex-1 rounded-lg bg-terracotta px-4 py-2 font-display text-ink hover:bg-terracotta-hover"
          >
            Avec photos
          </button>
          <button
            type="button"
            onClick={() => onChoose(false)}
            className="min-h-11 flex-1 rounded-lg border border-ocre px-4 py-2 font-display text-ocre hover:bg-ocre/10"
          >
            Sans photos
          </button>
        </div>
        <button type="button" onClick={onCancel} className="mt-3 w-full text-center text-sm text-ink-muted">
          Annuler
        </button>
      </div>
    </div>
  )
}
