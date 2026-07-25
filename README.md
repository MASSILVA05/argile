# DPR Chargement

Suivi des sorties de camions — SARL DPR AXXAM. PWA React + Vite + Tailwind, Supabase (BDD + realtime) et notifications ntfy.sh.

## Démarrage

1. Installer les dépendances :
   ```
   npm install
   ```
2. Créer un projet [Supabase](https://supabase.com), puis exécuter `schema.sql` dans l'éditeur SQL du projet (Database > SQL Editor).
3. Copier `.env.example` vers `.env` et renseigner :
   - `VITE_SUPABASE_URL` et `VITE_SUPABASE_ANON_KEY` (Project Settings > API)
   - `VITE_NTFY_TOPIC` : un identifiant de topic unique sur [ntfy.sh](https://ntfy.sh) (ex : `dpr-axxam-chargement-4f8x`). S'abonner à ce topic depuis l'app mobile ntfy pour recevoir les notifications.
4. Lancer le serveur de développement :
   ```
   npm run dev
   ```

## Build de production

```
npm run build
```

Le contenu généré dans `dist/` peut être déployé sur n'importe quel hébergeur statique (Vercel, Netlify, Cloudflare Pages…). Le service worker (`public/sw.js`) et le manifest PWA (`public/manifest.json`) permettent l'installation sur mobile et le fonctionnement hors-ligne du formulaire de saisie.

## Structure

- `src/components/EntryForm.jsx` — formulaire de saisie
- `src/components/Registry.jsx` — registre, recherche, édition, suppression, export CSV
- `src/lib/supabase.js` — client Supabase
- `src/lib/ntfy.js` — notifications push
- `src/lib/offlineQueue.js` — file d'attente hors-ligne (synchronisation automatique au retour réseau)
- `schema.sql` — DDL Supabase (table `entries`, index, RLS, realtime)
