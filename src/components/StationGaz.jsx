import StationSaleTab from './StationSaleTab'
import { GAZ_PRODUCTS } from '../lib/station'
import { downloadStationGazExcel } from '../lib/stationExcel'
import { notifyStationGaz } from '../lib/ntfy'

const CONFIG = {
  table: 'station_gaz',
  productMode: 'autocomplete',
  productOptions: GAZ_PRODUCTS,
  quantityLabel: 'Quantité (bouteilles)',
  quantityStep: '1',
  quantityInteger: true,
  hasUnit: false,
  hasConsigne: true,
  excel: downloadStationGazExcel,
  notify: notifyStationGaz,
  filePrefix: 'Ventes_Gaz_Station',
  printSubtitle: 'Registre gaz — Station',
  adminUpdateRpc: 'admin_update_station_gaz',
  adminDeleteRpc: 'admin_delete_station_gaz',
}

export default function StationGaz() {
  return <StationSaleTab config={CONFIG} />
}
