import emailjs from '@emailjs/browser'
import { computeAmount, formatDA } from './unloadingTypes'

emailjs.init('J-MtomjHeZX6EwSeF')

export async function sendEmailNotification(entry) {
  try {
    const amount = computeAmount(entry)
    const result = await emailjs.send('service_ndslg4h', 'template_jjwwov9', {
      bon_number: entry.bon_number,
      entry_date: entry.entry_date,
      entry_time: entry.entry_time ? entry.entry_time.slice(0, 5) : 'N/A',
      truck_plate: entry.truck_plate,
      driver_name: entry.driver_name,
      unloading_type: entry.unloading_type,
      ticket_number: entry.ticket_number || 'N/A',
      weight_tons: entry.weight_tons ?? 'N/A',
      amount: amount != null ? formatDA(amount) : 'N/A',
      observations: entry.observations || 'Aucune',
    })
    console.log('Email envoyé:', result.status)
  } catch (err) {
    console.error('Email erreur:', err)
  }
}
