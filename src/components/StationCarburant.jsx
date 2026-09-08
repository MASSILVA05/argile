import StationSaleTab from './StationSaleTab'
import { CARBURANT_PRODUCTS } from '../lib/station'
import { downloadStationCarburantExcel } from '../lib/stationExcel'
import { notifyStationCarburant } from '../lib/ntfy'

const CONFIG = {
  table: 'station_carburant',
  productMode: 'select',
  productOptions: CARBURANT_PRODUCTS,
  quantityLabel: 'Quantité (litres)',
  quantityStep: '0.01',
  quantityInteger: false,
  hasUnit: false,
  hasConsigne: false,
  excel: downloadStationCarburantExcel,
  notify: notifyStationCarburant,
  filePrefix: 'Ventes_Carburant_Station',
  printSubtitle: 'Registre carburant — Station',
  adminUpdateRpc: 'admin_update_station_carburant',
  adminDeleteRpc: 'admin_delete_station_carburant',
}

export default function StationCarburant() {
  return <StationSaleTab config={CONFIG} />
}
