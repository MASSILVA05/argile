import StationSaleTab from './StationSaleTab'
import { downloadStationLubrifiantsExcel } from '../lib/stationExcel'
import { notifyStationLubrifiant } from '../lib/ntfy'

const CONFIG = {
  table: 'station_lubrifiants',
  productMode: 'autocomplete',
  productOptions: ['HIDRA 46', 'SUPER 3 30W40', 'NAPHTA 10W40'],
  quantityLabel: 'Quantité',
  quantityStep: '0.01',
  quantityInteger: false,
  hasUnit: true,
  hasConsigne: false,
  excel: downloadStationLubrifiantsExcel,
  notify: notifyStationLubrifiant,
  filePrefix: 'Ventes_Lubrifiants_Station',
  printSubtitle: 'Registre lubrifiants — Station',
  adminUpdateRpc: 'admin_update_station_lubrifiants',
  adminDeleteRpc: 'admin_delete_station_lubrifiants',
}

export default function StationLubrifiants() {
  return <StationSaleTab config={CONFIG} />
}
