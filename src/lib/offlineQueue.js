import { supabase } from './supabase'
import { notifyNewEntry } from './ntfy'

const QUEUE_KEY = 'dpr-offline-queue'
const listeners = new Set()

function readQueue() {
  try {
    return JSON.parse(localStorage.getItem(QUEUE_KEY)) ?? []
  } catch {
    return []
  }
}

function writeQueue(queue) {
  localStorage.setItem(QUEUE_KEY, JSON.stringify(queue))
  listeners.forEach((fn) => fn(queue))
}

export function getQueue() {
  return readQueue()
}

export function onQueueChange(fn) {
  listeners.add(fn)
  return () => listeners.delete(fn)
}

export function enqueueEntry(payload) {
  const queue = readQueue()
  queue.push({ ...payload, _queuedAt: Date.now() })
  writeQueue(queue)
}

let flushing = false

export async function flushQueue() {
  if (flushing) return
  if (!navigator.onLine) return
  flushing = true
  try {
    let queue = readQueue()
    while (queue.length > 0) {
      const [item, ...rest] = queue
      const { _queuedAt, ...payload } = item
      const { data, error } = await supabase.from('entries').insert(payload).select().single()

      if (!error) {
        notifyNewEntry(data)
        queue = rest
        writeQueue(queue)
        continue
      }

      if (error.code === '23505') {
        // Bon déjà synchronisé ou conflit : on retire pour ne pas bloquer la file indéfiniment.
        console.error('Entrée hors-ligne abandonnée (bon en conflit) :', payload.bon_number, error.message)
        queue = rest
        writeQueue(queue)
        continue
      }

      // Erreur réseau probable : on arrête et on réessaiera au prochain retour en ligne.
      break
    }
  } finally {
    flushing = false
  }
}

window.addEventListener('online', flushQueue)
