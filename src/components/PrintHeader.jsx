// Visible uniquement à l'impression (voir .print-area / @media print dans
// index.css) : reproduit un en-tête simple au-dessus du tableau imprimé.
export default function PrintHeader({ title }) {
  return (
    <div className="mb-3 hidden print:block">
      <p className="text-lg font-bold">SARL DPR AXXAM — {title}</p>
      <p className="text-sm">Date d'impression : {new Date().toLocaleDateString('fr-FR')}</p>
    </div>
  )
}
