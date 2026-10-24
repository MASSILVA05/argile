# Sécurité — AXXAM ERP (Argile)

Ce document décrit les mesures de sécurité de l'application, l'ordre de déploiement
et les risques encore ouverts. **Aucun secret (mot de passe, code admin, clé) ne doit
figurer dans ce fichier ni dans aucun fichier commité.**

---

## Phase 1 — 2026-10-24

### Vue d'ensemble

| # | Mesure | Où | État |
|---|--------|----|------|
| 1 | Mots de passe stockés en bcrypt (pgcrypto) | `schema.sql` § S1, S4 | À exécuter dans Supabase |
| 2 | Code admin retiré du frontend | `.env`, `.env.example` | Fait |
| 3 | Sessions créées et vérifiées côté serveur, table `active_sessions` fermée | `schema.sql` § S3, `src/lib/auth.js`, `src/lib/supabase.js` | À exécuter + déployer |
| 4 | Code admin = code **+ session admin valide** | `schema.sql` § S5 | À exécuter |
| 5 | Rate limiting de la connexion (mot de passe et OTP) | `schema.sql` § S2, S4 | À exécuter |
| 6 | Deploy key SSH (repo privé) | VPS + GitHub | À faire à la main |
| 7 | En-têtes de sécurité Nginx | VPS | À faire à la main |
| 8 | Secrets hors git + rotation | `.gitignore`, Supabase | À faire à la main |

### Ordre de déploiement

1. **SQL** : exécuter dans l'éditeur SQL Supabase tout le bloc
   `SÉCURITÉ PHASE 1 (2026-10-24)` à la fin de `schema.sql` (sections S1 à S5).
   Il est idempotent : on peut le relancer sans risque.
2. **Front** : déployer la nouvelle version du site.
3. **Tout le monde se reconnecte une fois** : les sessions ouvertes avant la migration
   sont invalidées (voir § 3).
4. **Tests de recette** (§ « Vérifications »).
5. **Rotation des secrets** (§ 8).
6. **Nginx** (§ 7) et **deploy key** (§ 6).

L'ancien front reste compatible avec le nouveau SQL pendant la fenêtre de déploiement
(`p_device_info` est optionnel). Le nouveau front exige en revanche le nouveau SQL :
toujours exécuter le SQL **avant** de déployer.

---

### 1. Mots de passe en bcrypt

**Avant :** le client envoyait `sha256(mot de passe)` et la base stockait ce même
sha256. En cas de fuite de la table `app_users`, le hash suffisait à se connecter
(il est exactement ce que le client envoie), et un sha256 de mot de passe court se
casse en quelques secondes.

**Après :** la base stocke `bcrypt(sha256(mot de passe))` (pgcrypto, coût 10). La
vérification se fait par `crypt(p_password_hash, password_hash) = password_hash`
dans `request_login_code`.

**Pourquoi bcrypt sur le sha256, et pas directement sur le mot de passe :**

- **Aucun mot de passe en clair n'est nécessaire.** Les sha256 existants sont
  bcryptés tels quels, donc les mots de passe actuels restent valables et le
  changement est transparent pour les utilisateurs.
- **Ré-hasher avec une liste de mots de passe** (`crypt('motdepasse', …)`) aurait
  écrasé les mots de passe changés depuis via « Changer le mot de passe ». Cela
  aurait aussi mis des mots de passe en clair dans un fichier. Et ça n'aurait pas
  marché : le client envoie le sha256, pas le mot de passe.
- Le client ne change pas (`src/lib/hash.js` inchangé).

`confirm_password_change` bcrypte désormais le nouveau hash avant de l'enregistrer.
Il ferme aussi toutes les sessions ouvertes de l'utilisateur.

**Réinitialiser un mot de passe à la main** (dans l'éditeur SQL, sans jamais
commiter la valeur) :

```sql
update app_users
set password_hash = extensions.crypt(
  encode(extensions.digest('NOUVEAU_MDP', 'sha256'), 'hex'),
  extensions.gen_salt('bf', 10))
where username = 'Nom';
```

> ⚠️ Les anciens mots de passe figurent **en clair dans l'historique git** (anciennes
> sections de `schema.sql`). Si le dépôt a été public, même un instant, il faut les
> considérer comme connus : **changer les mots de passe de tous les comptes**. Le
> bcrypt ne protège pas un mot de passe déjà divulgué.

### 2. Code admin retiré du frontend

- `VITE_ADMIN_CODE` supprimé de `.env` et `.env.example`. Aucune variable `VITE_*`
  n'en tient lieu : tout ce qui est préfixé `VITE_` et référencé dans `src/` finit
  dans le JS public.
- Vérifié : **aucun composant ne compare le code côté client.** Les 28 composants
  qui demandent le code l'envoient en paramètre `p_admin_code` aux RPC
  `admin_update_*` / `admin_delete_*` (et prodnet, production, PPI…), qui le
  comparent à `app_settings.admin_code` en base.
- Le dernier build (`dist/`) ne contient plus la valeur.

> ⚠️ La valeur du code admin figure en clair dans `schema.sql` (donc dans
> l'historique git). **La changer** (valeur à ne pas commiter) :
>
> ```sql
> update app_settings set value = 'NOUVEAU_CODE' where key = 'admin_code';
> ```

### 3. Sessions côté serveur

**Avant :** la session était un objet JSON dans `localStorage` (`dpr-session`).
On pouvait le modifier à la main (par exemple `"role": "admin"`) pour afficher les
onglets d'un autre rôle.

**Après :**

- La session est **créée par la base** à la connexion, dans `request_login_code`
  (ou `verify_login_code` le samedi avec OTP). L'id de la ligne `active_sessions`
  sert de jeton. La base renvoie `session_id`, `role`, `entity`, `expires_at`
  (même règle qu'avant : 17h Algérie, ou 24h pour les comptes sans restriction
  d'horaire).
- Le front stocke `sessionId` dans `dpr-session`, et `src/lib/supabase.js` l'envoie
  dans l'en-tête **`x-session-token`** de chaque requête. En SQL, il se lit avec
  `current_session_token()`.
- **Heartbeat** toutes les 60 s et au retour au premier plan (`App.jsx`). La RPC
  `session_heartbeat` renvoie le username et le rôle **qui font foi côté serveur**.
  Le front déconnecte immédiatement si :
  - la session n'existe plus (révoquée par un admin, déconnexion, mot de passe changé) ;
  - elle a expiré ;
  - le rôle en base a changé (rôle modifié, compte `disabled`) ;
  - le username ou le rôle du `localStorage` ne correspond pas à celui du serveur
    (modification à la main).
- **Table `active_sessions` fermée** : RLS activée **sans aucune policy**, donc
  illisible et non modifiable avec la clé anon. Sans ça, n'importe qui aurait pu
  lire les jetons ou insérer une fausse session admin. Accès uniquement par les RPC
  `security definer` :

  | RPC | Rôle |
  |-----|------|
  | `session_heartbeat(p_session_id)` | heartbeat + rôle faisant foi |
  | `end_session(p_session_id)` | déconnexion |
  | `admin_list_sessions(p_session_id)` | modal « Sessions actives » (admin uniquement) ; marque `is_active = false` au-delà de 10 min, purge les sessions expirées |
  | `admin_revoke_session(p_session_id, p_target_id)` | bouton « Déconnecter » (admin uniquement) |
  | `validate_session(p_username, p_session_token)` | session existante, active, heartbeat < 30 min, rôle cohérent avec `app_users` |

- Les sessions créées avant la migration (id généré par le client) sont supprimées :
  **chacun se reconnecte une fois**.

**Limite importante :** les policies RLS des tables métier restent `USING (true)`.
Avec la clé anon (publique, présente dans le JS), on peut encore lire et écrire
directement dans les tables, sans passer par l'application. Les sessions serveur
empêchent l'escalade *dans l'application*, pas un accès direct à l'API. Voir
« Phase 2 ».

### 4. Code admin + session admin

Toutes les fonctions SQL qui vérifient `app_settings.admin_code` exigent désormais
**aussi** une session admin valide, via l'en-tête `x-session-token` :

- la session existe et n'est pas expirée ;
- son rôle vaut `admin` dans `app_users` ;
- le dernier heartbeat date de moins de 30 min.

Un code admin qui aurait fuité ne suffit donc plus.

**Mise en œuvre :** un bloc `DO` (§ S5) patche les définitions en place. Chaque
`if v_code is null or …` devient `if v_code is null or not app_session_is_admin() or …`.
C'est idempotent et ça couvre aussi les fonctions ajoutées dans d'anciennes sections,
sans les recopier.

**Test obligatoire après déploiement :** un admin débloque une ligne de plus de 72h
avec le code admin.

- Si ça échoue avec « code incorrect » alors que le code est bon, l'en-tête
  `x-session-token` n'arrive pas jusqu'à la base (CORS / passerelle).
- **Retour arrière :** relancer le bloc `DO` en inversant les deux chaînes du
  `replace()` et le filtre `not like` → `like` (commentaire dans `schema.sql`).

### 5. Rate limiting de la connexion

- Table `login_attempts` (RLS sans policy) : une ligne par tentative, avec
  `kind = 'password' | 'otp'` et `ip_hint` (premier `x-forwarded-for` transmis par
  Supabase, indicatif seulement).
- `request_login_code` et `verify_login_code` refusent avec
  **« Trop de tentatives. Réessayez dans 15 minutes. »** au-delà de **5 échecs en
  15 min**, comptés depuis le dernier succès.
- Purge automatique des tentatives de plus de 24h à chaque appel.
- Le code OTP du samedi (6 chiffres) est désormais protégé contre le brute-force.

**Effet de bord connu :** le blocage se fait par nom d'utilisateur. Quelqu'un peut
donc bloquer un compte pendant 15 min en tapant de faux mots de passe.
**Débloquer :**

```sql
delete from login_attempts where username = 'Nom';
```

### 6. Deploy key SSH (repo privé en permanence)

Le dépôt doit rester **privé**. Le VPS clone avec une clé en lecture seule propre au
dépôt, au lieu de rendre le repo public.

```bash
# Sur le VPS (root)
ssh-keygen -t ed25519 -C "argile-deploy-key" -f /root/.ssh/argile_deploy_key -N ""
cat /root/.ssh/argile_deploy_key.pub
```

1. GitHub → dépôt `argile` → **Settings → Deploy keys → Add deploy key** : coller
   la clé publique, **sans** cocher « Allow write access ».
2. Configurer SSH sur le VPS :

   ```bash
   cat >> /root/.ssh/config << 'EOF'
   Host github.com
     IdentityFile /root/.ssh/argile_deploy_key
     IdentitiesOnly yes
   EOF
   chmod 600 /root/.ssh/config /root/.ssh/argile_deploy_key
   ssh -T git@github.com   # doit répondre "successfully authenticated"
   ```

3. Cloner (ou basculer un clone existant) en SSH :

   ```bash
   git clone git@github.com:MASSILVA05/argile.git
   # ou, dans un clone existant :
   git remote set-url origin git@github.com:MASSILVA05/argile.git
   ```

4. Repasser le dépôt en **Private** s'il ne l'est pas : Settings → General →
   Danger Zone → Change visibility.

> Si d'autres dépôts doivent être clonés depuis le même VPS, une deploy key ne vaut
> que pour un seul dépôt. Utiliser un alias d'hôte (`Host github-argile`) plutôt que
> `Host github.com`.

### 7. En-têtes de sécurité Nginx

Dans le bloc `server { … }` HTTPS du site (par exemple
`/etc/nginx/sites-available/argile`) :

```nginx
server {
    listen 443 ssl http2;
    server_name VOTRE_DOMAINE;

    # ssl_certificate / ssl_certificate_key : inchangés (certbot)

    root /var/www/argile/dist;
    index index.html;

    # --- En-têtes de sécurité ---------------------------------------------
    add_header Strict-Transport-Security "max-age=31536000; includeSubDomains" always;
    add_header X-Content-Type-Options "nosniff" always;
    add_header X-Frame-Options "DENY" always;
    add_header X-XSS-Protection "0" always;
    add_header Referrer-Policy "strict-origin-when-cross-origin" always;
    add_header Permissions-Policy "camera=(self), microphone=(), geolocation=()" always;
    add_header Content-Security-Policy "default-src 'self'; script-src 'self' 'unsafe-inline' 'unsafe-eval'; style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; font-src 'self' https://fonts.gstatic.com; img-src 'self' data: blob: https://automecanica.dz https://deozusmbensjnhtlrfnm.supabase.co http://51.210.42.69:3333; connect-src 'self' https://deozusmbensjnhtlrfnm.supabase.co wss://deozusmbensjnhtlrfnm.supabase.co https://ntfy.sh https://api.emailjs.com http://51.210.42.69:3333; worker-src 'self'; manifest-src 'self'; frame-ancestors 'none'; base-uri 'self'; form-action 'self'" always;

    server_tokens off;

    # SPA : toutes les routes renvoient index.html
    location / {
        try_files $uri $uri/ /index.html;
    }

    # index.html et service worker jamais en cache (sinon nouvelles versions invisibles)
    location = /index.html {
        add_header Cache-Control "no-cache" always;
        # add_header dans un location remplace ceux du server : on les répète
        add_header Strict-Transport-Security "max-age=31536000; includeSubDomains" always;
        add_header X-Content-Type-Options "nosniff" always;
        add_header X-Frame-Options "DENY" always;
        add_header Referrer-Policy "strict-origin-when-cross-origin" always;
        add_header Content-Security-Policy "default-src 'self'; script-src 'self' 'unsafe-inline' 'unsafe-eval'; style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; font-src 'self' https://fonts.gstatic.com; img-src 'self' data: blob: https://automecanica.dz https://deozusmbensjnhtlrfnm.supabase.co http://51.210.42.69:3333; connect-src 'self' https://deozusmbensjnhtlrfnm.supabase.co wss://deozusmbensjnhtlrfnm.supabase.co https://ntfy.sh https://api.emailjs.com http://51.210.42.69:3333; worker-src 'self'; manifest-src 'self'; frame-ancestors 'none'; base-uri 'self'; form-action 'self'" always;
    }

    # Fichiers de build versionnés : cache long
    location /assets/ {
        expires 1y;
        add_header Cache-Control "public, immutable" always;
        add_header X-Content-Type-Options "nosniff" always;
    }
}

# Redirection HTTP -> HTTPS
server {
    listen 80;
    server_name VOTRE_DOMAINE;
    return 301 https://$host$request_uri;
}
```

Puis :

```bash
nginx -t && systemctl reload nginx
curl -sI https://VOTRE_DOMAINE | grep -iE "strict-transport|content-security|x-frame|x-content-type|referrer"
```

**Différences avec la CSP initialement prévue, et pourquoi :**

- `wss://deozusmbensjnhtlrfnm.supabase.co` ajouté à `connect-src` : sans lui, le
  **temps réel** (mises à jour des registres en direct) est bloqué.
- `http://51.210.42.69:3333` ajouté à `img-src` et `connect-src` : c'est le
  **serveur photos** (`VITE_PHOTO_SERVER_URL`, upload et affichage des
  justificatifs). Sans lui, les photos sont bloquées. **Mieux :** le servir en HTTPS
  derrière Nginx (par exemple `location /photo-api/ { proxy_pass http://127.0.0.1:3333/; }`),
  passer `VITE_PHOTO_SERVER_URL` à `https://VOTRE_DOMAINE/photo-api`, puis retirer
  `http://51.210.42.69:3333` de la CSP. Une page HTTPS qui charge du HTTP
  (« mixed content ») est de toute façon bloquée par les navigateurs pour les
  requêtes `fetch`.
- `X-XSS-Protection "0"` au lieu de `"1; mode=block"` : ce filtre est abandonné par
  les navigateurs et la valeur `1` a introduit des failles. La recommandation
  actuelle (OWASP) est `0`, la CSP le remplace.
- `frame-ancestors 'none'`, `base-uri`, `form-action`, `Permissions-Policy`
  (caméra autorisée pour les photos), `server_tokens off` : durcissements gratuits.
- `'unsafe-inline'` reste nécessaire pour les scripts : `index.html` contient un
  script inline (thème clair/sombre sans flash). `'unsafe-eval'` est conservé par
  prudence (ExcelJS) ; à retirer après test si tout fonctionne sans.

Après la mise en place, ouvrir l'application, faire le tour des pages (photos, temps
réel, export Excel, impression) et vérifier qu'aucune erreur
« Content Security Policy » n'apparaît dans la console du navigateur.

### 8. Secrets hors git et rotation

- `.env` est déjà dans `.gitignore` et **n'a jamais été commité** (vérifié avec
  `git log --all -- .env`). Rien à faire avec `git rm --cached`.
- Aucune clé Supabase (JWT `eyJ…`) dans l'historique git (vérifié).
- **Secrets présents dans l'historique git** (via `schema.sql` et `.env.example`), à
  considérer comme compromis si le dépôt a été public :

  | Secret | Action |
  |--------|--------|
  | Mots de passe des comptes | Faire changer **tous** les mots de passe (§ 1) |
  | Code admin (`app_settings.admin_code`) | Nouveau code (§ 2) |
  | Topic ntfy d'authentification (`app_settings.ntfy_auth_topic`) | Nouveau topic long et aléatoire (voir ci-dessous) |

- **Topic ntfy d'authentification** : sur ntfy.sh, un topic est public pour
  quiconque connaît son nom. Ce topic reçoit les **codes OTP** et les **nouveaux
  mots de passe en clair** (demandes de changement). Le remplacer par un nom
  imprévisible et mettre à jour l'abonnement sur le téléphone de l'admin :

  ```sql
  update app_settings set value = 'dpr-auth-' || encode(gen_random_bytes(16), 'hex')
  where key = 'ntfy_auth_topic';
  select value from app_settings where key = 'ntfy_auth_topic'; -- à saisir dans l'app ntfy
  ```

  Mieux encore : un serveur ntfy auto-hébergé avec authentification, ou un compte
  ntfy.sh avec topic réservé.

- **Si le dépôt a été public :** régénérer aussi la clé anon / service_role dans
  Supabase (Project Settings → API → Roll keys) par précaution, puis mettre à jour
  `.env` et le VPS. Une réécriture de l'historique (`git filter-repo`) n'efface pas
  les copies déjà clonées ou mises en cache : **la rotation est la seule vraie
  correction**.

### Vérifications (recette)

1. Connexion normale → OK. Le compte apparaît dans « Sessions actives » (icône 👥,
   admins).
2. Mauvais mot de passe 6 fois → « Trop de tentatives… ». Après
   `delete from login_attempts where username = '…'`, la connexion refonctionne.
3. Bilal (`disabled`) → « Compte désactivé ».
4. DevTools → Application → Local Storage → `dpr-session` : changer `"role"` en
   `"admin"` → déconnexion en moins de 60 s.
5. Admin → « Déconnecter » un utilisateur → il revient au login en moins de 60 s.
6. Admin → déblocage d'une ligne de plus de 72h avec le code admin → OK (sinon voir
   § 4, retour arrière).
7. Non-admin : appel direct de `admin_delete_entry` avec le bon code (console :
   `supabase.rpc(...)`) → refusé.
8. Avec la clé anon seule : `select` sur `active_sessions`, `login_attempts`,
   `app_users`, `app_settings` → aucune ligne.
9. Changement de mot de passe (flux habituel) → reconnexion avec le nouveau mot de
   passe OK, l'ancien refusé.

---

## Risques restants / Phase 2

1. **RLS `USING (true)` sur les tables métier** : la clé anon (publique) donne un
   accès complet en lecture et écriture à l'API REST. C'est le risque principal.
   - Correction complète : migrer vers **Supabase Auth**, avec des policies basées
     sur `auth.uid()` et le rôle.
   - Étape intermédiaire possible : des policies
     `using (app_session_role(current_session_token()) is not null)` table par
     table, grâce à l'en-tête `x-session-token`. Attention : le **temps réel**
     (`postgres_changes`) n'a pas accès aux en-têtes HTTP, donc ces tables ne
     recevraient plus d'événements. À traiter avec Supabase Auth.
2. **`request_password_change`** : n'importe qui peut lancer une demande pour
   n'importe quel compte (l'admin doit ensuite valider). Le nouveau mot de passe
   passe en clair par ntfy. Prévoir de faire saisir le mot de passe par
   l'utilisateur après validation, au lieu de l'envoyer à l'admin.
3. **Hash côté client** : le sha256 envoyé par le client fait office de mot de passe
   pour qui l'intercepterait. Ce n'est acceptable que derrière HTTPS (HSTS activé
   § 7).
4. **Serveur photos en HTTP sur IP publique** (`:3333`) : upload sans
   authentification. Le placer derrière Nginx en HTTPS, ajouter un jeton, et fermer
   le port 3333 au public (pare-feu).
5. **Énumération des comptes** : la liste des utilisateurs est en dur dans le front
   (`USERNAMES`). C'est sans impact tant que le rate limiting et des mots de passe
   forts sont en place.
