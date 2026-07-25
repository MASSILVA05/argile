import emailjs from '@emailjs/browser'

const SERVICE_ID = import.meta.env.VITE_EMAILJS_SERVICE_ID
const TEMPLATE_ID = import.meta.env.VITE_EMAILJS_TEMPLATE_ID
const PUBLIC_KEY = import.meta.env.VITE_EMAILJS_PUBLIC_KEY

export async function sendEmailNotification(entry) {
  if (!SERVICE_ID || !TEMPLATE_ID || !PUBLIC_KEY) {
    console.warn('EmailJS non configuré')
    return
  }
  try {
    await emailjs.send(SERVICE_ID, TEMPLATE_ID, {
      bon_number: entry.bon_number,
      entry_date: entry.entry_date,
      truck_plate: entry.truck_plate,
      driver_name: entry.driver_name,
      unloading_location: entry.unloading_location || 'Akbou',
      weight_tons: entry.weight_tons ?? 'N/A',
      observations: entry.observations || 'Aucune',
    }, PUBLIC_KEY)
  } catch (err) {
    console.error('Email erreur:', err)
  }
}
