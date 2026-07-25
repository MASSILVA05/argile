import emailjs from '@emailjs/browser'

emailjs.init('J-MtomjHeZX6EwSeF')

export async function sendEmailNotification(entry) {
  try {
    const result = await emailjs.send('service_ndslg4h', 'template_jjwwov9', {
      bon_number: entry.bon_number,
      entry_date: entry.entry_date,
      truck_plate: entry.truck_plate,
      driver_name: entry.driver_name,
      unloading_location: entry.unloading_location || 'Akbou',
      weight_tons: entry.weight_tons ?? 'N/A',
      observations: entry.observations || 'Aucune',
    })
    console.log('Email envoyé:', result.status)
  } catch (err) {
    console.error('Email erreur:', err)
  }
}
