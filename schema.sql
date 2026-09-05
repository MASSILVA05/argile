-- Schéma Supabase : SARL DPR AXXAM - Suivi de chargement
-- À exécuter dans l'éditeur SQL de Supabase (Database > SQL Editor)

create table if not exists entries (
  id uuid primary key default gen_random_uuid(),
  bon_number integer not null unique,
  entry_date date not null default current_date,
  entry_time time,
  truck_plate text not null,
  driver_name text not null,
  unloading_type text not null default 'Akbou'
    check (unloading_type in ('DPR AXXAM Location', 'Akbou', 'DPR AXXAM (22T)')),
  ticket_number text,
  weight_tons numeric(8, 2),
  photo_url text,
  observations text,
  created_at timestamptz not null default now()
);

comment on table entries is 'Registre des sorties de camions - site de chargement argile';
comment on column entries.bon_number is 'Numéro du bon de chargement, unique';
comment on column entries.weight_tons is 'Poids en tonnes, à la 2e décimale près';
comment on column entries.entry_time is 'Heure de saisie, capturée automatiquement au clic sur "Enregistrer"';

-- Index pour accélérer le tri par défaut (registre trié par création décroissante)
create index if not exists entries_created_at_idx on entries (created_at desc);

-- Index pour accélérer la recherche/filtre
create index if not exists entries_truck_plate_idx on entries (truck_plate);
create index if not exists entries_driver_name_idx on entries (driver_name);
create index if not exists entries_entry_date_idx on entries (entry_date);

-- Index pour le calcul rapide du prochain n° de bon (max + 1)
create index if not exists entries_bon_number_idx on entries (bon_number desc);

-- Row Level Security
-- L'application utilise la clé "anon" côté client (agents de terrain + gestionnaire).
-- Accès ouvert en lecture/écriture pour toute requête authentifiée avec la clé anon,
-- ce qui convient à un usage interne à petite équipe sans compte utilisateur individuel.
alter table entries enable row level security;

create policy "Lecture publique des entrées"
  on entries for select
  using (true);

create policy "Ajout d'entrées"
  on entries for insert
  with check (true);

-- Modification/suppression bloquées côté base au-delà de 72h après création,
-- en plus du verrouillage déjà appliqué côté interface (Registry.jsx).
create policy "Modification des entrées"
  on entries for update
  using (created_at > now() - interval '72 hours')
  with check (created_at > now() - interval '72 hours');

create policy "Suppression des entrées"
  on entries for delete
  using (created_at > now() - interval '72 hours');

-- Realtime : permet au registre de se mettre à jour en direct
alter publication supabase_realtime add table entries;

-- Storage : bucket public pour les photos des bons de chargement
insert into storage.buckets (id, name, public)
values ('bon-photos', 'bon-photos', true)
on conflict (id) do nothing;

create policy "Lecture publique des photos de bons"
  on storage.objects for select
  using (bucket_id = 'bon-photos');

create policy "Ajout de photos de bons"
  on storage.objects for insert
  with check (bucket_id = 'bon-photos');

create policy "Suppression des photos de bons"
  on storage.objects for delete
  using (bucket_id = 'bon-photos');

-- ============================================================
-- MIGRATION (à exécuter une seule fois sur une base existante
-- qui a encore la colonne unloading_location)
-- ============================================================

-- 1. Nouvelles colonnes (idempotent, sans effet si déjà appliquées précédemment)
alter table entries add column if not exists ticket_number text;
alter table entries add column if not exists photo_url text;
alter table entries add column if not exists unloading_type text;

-- 2. Bascule des anciennes valeurs de lieu vers les nouveaux types
--    'Briqueterie AXXAM' -> 'DPR AXXAM (22T)' (poids fixe, pas de pesée historique)
update entries
set unloading_type = case
  when unloading_location = 'Briqueterie AXXAM' then 'DPR AXXAM (22T)'
  else 'Akbou'
end
where unloading_type is null;

-- 3. Contraintes sur la nouvelle colonne
alter table entries alter column unloading_type set default 'Akbou';
alter table entries alter column unloading_type set not null;
alter table entries add constraint entries_unloading_type_check
  check (unloading_type in ('DPR AXXAM Location', 'Akbou', 'DPR AXXAM (22T)'));

-- 4. Suppression de l'ancienne colonne
alter table entries drop column if exists unloading_location;

-- 5. Heure de saisie automatique
alter table entries add column if not exists entry_time time;

-- 6. Verrouillage à 72h appliqué directement par les policies RLS
-- (en plus du verrouillage déjà présent côté interface)
alter policy "Modification des entrées" on entries
  using (created_at > now() - interval '72 hours')
  with check (created_at > now() - interval '72 hours');

alter policy "Suppression des entrées" on entries
  using (created_at > now() - interval '72 hours');

-- 7. Correction des anciennes entrées mal classées : un poids de 22T saisi
--    sous le type 'Akbou' correspond en réalité au type 'DPR AXXAM (22T)'.
--    Ne touche à rien d'autre (aucune autre valeur de unloading_type n'est modifiée).
update entries
set unloading_type = 'DPR AXXAM (22T)'
where unloading_type = 'Akbou'
  and weight_tons = 22;

-- ============================================================
-- CODE ADMIN : déblocage sécurisé des modifications après 72h
-- ============================================================
-- La RLS 72h (policies "Modification des entrées" / "Suppression des
-- entrées" plus haut) reste active pour tout le monde : elle protège
-- la base même si la clé "anon" est lue dans le code du site (elle
-- l'est forcément, c'est une clé publique côté client). Le code admin
-- ne passe donc PAS par un assouplissement de ces policies, mais par
-- les deux fonctions ci-dessous : elles vérifient le code côté serveur
-- puis agissent avec les privilèges du propriétaire de la table
-- (SECURITY DEFINER), ce qui contourne la RLS uniquement pour cet appel
-- précis, et seulement si le code fourni est correct.

create table if not exists app_settings (
  key text primary key,
  value text not null
);

alter table app_settings enable row level security;
-- Aucune policy créée ici volontairement : app_settings n'est accessible
-- ni en lecture ni en écriture via l'API (anon/authenticated), uniquement
-- depuis l'intérieur des fonctions SECURITY DEFINER ci-dessous.

insert into app_settings (key, value)
values ('admin_code', '2024DPR')
on conflict (key) do nothing;

-- Pour changer le code admin plus tard (à faire en même temps que
-- VITE_ADMIN_CODE dans .env et dans les variables d'environnement Vercel) :
--   update app_settings set value = 'NOUVEAU_CODE' where key = 'admin_code';

create or replace function admin_update_entry(
  p_id uuid,
  p_admin_code text,
  p_bon_number integer,
  p_entry_date date,
  p_truck_plate text,
  p_driver_name text,
  p_unloading_type text,
  p_ticket_number text,
  p_weight_tons numeric,
  p_observations text
)
returns entries
language plpgsql
security definer
set search_path = public
as $$
declare
  v_code text;
  v_result entries;
begin
  select value into v_code from app_settings where key = 'admin_code';
  if v_code is null or p_admin_code <> v_code then
    raise exception 'Code administrateur invalide';
  end if;

  update entries set
    bon_number = p_bon_number,
    entry_date = p_entry_date,
    truck_plate = p_truck_plate,
    driver_name = p_driver_name,
    unloading_type = p_unloading_type,
    ticket_number = p_ticket_number,
    weight_tons = p_weight_tons,
    observations = p_observations
  where id = p_id
  returning * into v_result;

  if v_result.id is null then
    raise exception 'Entrée introuvable';
  end if;

  return v_result;
end;
$$;

create or replace function admin_delete_entry(p_id uuid, p_admin_code text)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_code text;
begin
  select value into v_code from app_settings where key = 'admin_code';
  if v_code is null or p_admin_code <> v_code then
    raise exception 'Code administrateur invalide';
  end if;

  delete from entries where id = p_id;
end;
$$;

revoke all on function admin_update_entry(uuid, text, integer, date, text, text, text, text, numeric, text) from public;
revoke all on function admin_delete_entry(uuid, text) from public;
grant execute on function admin_update_entry(uuid, text, integer, date, text, text, text, text, numeric, text) to anon, authenticated;
grant execute on function admin_delete_entry(uuid, text) to anon, authenticated;

-- ============================================================
-- MAINTENANCE : suivi des réparations et achats de pièces
-- ============================================================

create table if not exists maintenance (
  id uuid primary key default gen_random_uuid(),
  fiche_number integer not null unique,
  entry_date date not null default current_date,
  entry_time time,
  machine_name text not null,
  problem_description text not null,
  machine_photo_url text,
  receipt_photo_url text,
  supplier_name text,
  purchased_by text,
  entered_by text,
  requested_by text,
  amount numeric(10, 2),
  is_paid text not null default 'Non' check (is_paid in ('Oui', 'Non', 'En attente')),
  observations text,
  created_at timestamptz not null default now()
);

comment on table maintenance is 'Fiches de maintenance : réparations et achats de pièces';
comment on column maintenance.fiche_number is 'Numéro de fiche, unique';

create index if not exists maintenance_created_at_idx on maintenance (created_at desc);
create index if not exists maintenance_machine_name_idx on maintenance (machine_name);
create index if not exists maintenance_supplier_name_idx on maintenance (supplier_name);
create index if not exists maintenance_fiche_number_idx on maintenance (fiche_number desc);

alter table maintenance enable row level security;

create policy "Lecture publique maintenance"
  on maintenance for select
  using (true);

create policy "Ajout maintenance"
  on maintenance for insert
  with check (true);

create policy "Modification maintenance"
  on maintenance for update
  using (created_at > now() - interval '72 hours')
  with check (created_at > now() - interval '72 hours');

create policy "Suppression maintenance"
  on maintenance for delete
  using (created_at > now() - interval '72 hours');

alter publication supabase_realtime add table maintenance;

-- Storage : bucket public pour les photos de maintenance (machine + bon d'achat)
insert into storage.buckets (id, name, public)
values ('maintenance-photos', 'maintenance-photos', true)
on conflict (id) do nothing;

create policy "Lecture publique photos maintenance"
  on storage.objects for select
  using (bucket_id = 'maintenance-photos');

create policy "Ajout photos maintenance"
  on storage.objects for insert
  with check (bucket_id = 'maintenance-photos');

create policy "Suppression photos maintenance"
  on storage.objects for delete
  using (bucket_id = 'maintenance-photos');

-- ============================================================
-- CARBURANT : citerne + opérations (remplissage / approvisionnement)
-- ============================================================

create table if not exists fuel_tank (
  id integer primary key default 1,
  current_volume numeric(10, 2) not null default 0,
  max_capacity numeric(10, 2) not null default 10000,
  check (id = 1)
);

comment on table fuel_tank is 'Ligne unique représentant l''état courant de la citerne de gazole';

insert into fuel_tank (id, current_volume, max_capacity)
values (1, 0, 10000)
on conflict (id) do nothing;

alter table fuel_tank enable row level security;

create policy "Lecture publique citerne"
  on fuel_tank for select
  using (true);

create policy "Mise à jour citerne"
  on fuel_tank for update
  using (true)
  with check (true);
-- Pas de policy insert/delete : la ligne unique (id=1) est créée une seule fois ci-dessus.
-- La mise à jour du volume n'a pas de verrou 72h : c'est un total courant, pas un
-- historique, et le déclencheur ci-dessous doit pouvoir l'ajuster à chaque opération.

alter publication supabase_realtime add table fuel_tank;

create table if not exists fuel_entries (
  id uuid primary key default gen_random_uuid(),
  bon_number integer not null unique,
  entry_date date not null default current_date,
  entry_time time,
  operation_type text not null check (operation_type in ('Remplissage', 'Approvisionnement')),
  truck_plate text,
  driver_name text,
  volume_liters numeric(8, 2) not null,
  supplier_name text,
  observations text,
  tank_volume_after numeric(10, 2) not null default 0,
  created_at timestamptz not null default now()
);

comment on table fuel_entries is 'Opérations sur la citerne de gazole : remplissage véhicule ou approvisionnement';
comment on column fuel_entries.tank_volume_after is 'Volume de la citerne juste après cette opération, calculé automatiquement (trigger)';

create index if not exists fuel_entries_created_at_idx on fuel_entries (created_at desc);
create index if not exists fuel_entries_truck_plate_idx on fuel_entries (truck_plate);
create index if not exists fuel_entries_entry_date_idx on fuel_entries (entry_date);
create index if not exists fuel_entries_bon_number_idx on fuel_entries (bon_number desc);

alter table fuel_entries enable row level security;

create policy "Lecture publique carburant"
  on fuel_entries for select
  using (true);

create policy "Ajout carburant"
  on fuel_entries for insert
  with check (true);

create policy "Modification carburant"
  on fuel_entries for update
  using (created_at > now() - interval '72 hours')
  with check (created_at > now() - interval '72 hours');

create policy "Suppression carburant"
  on fuel_entries for delete
  using (created_at > now() - interval '72 hours');

alter publication supabase_realtime add table fuel_entries;

-- Déclencheur : tient à jour fuel_tank.current_volume et fuel_entries.tank_volume_after
-- à chaque insertion, modification ou suppression d'une opération carburant — que ce
-- soit via le formulaire normal ou via les fonctions admin_update_fuel/admin_delete_fuel
-- (les triggers se déclenchent quel que soit le chemin emprunté pour la modification).
create or replace function fuel_apply_delta()
returns trigger
language plpgsql
as $$
declare
  v_current numeric(10, 2);
  v_delta numeric(10, 2);
begin
  select current_volume into v_current from fuel_tank where id = 1;

  if TG_OP = 'INSERT' then
    v_delta := case when NEW.operation_type = 'Approvisionnement' then NEW.volume_liters else -NEW.volume_liters end;
    v_current := v_current + v_delta;
    NEW.tank_volume_after := v_current;
    update fuel_tank set current_volume = v_current where id = 1;
    return NEW;

  elsif TG_OP = 'UPDATE' then
    v_delta := case when OLD.operation_type = 'Approvisionnement' then -OLD.volume_liters else OLD.volume_liters end;
    v_current := v_current + v_delta;
    v_delta := case when NEW.operation_type = 'Approvisionnement' then NEW.volume_liters else -NEW.volume_liters end;
    v_current := v_current + v_delta;
    NEW.tank_volume_after := v_current;
    update fuel_tank set current_volume = v_current where id = 1;
    return NEW;

  elsif TG_OP = 'DELETE' then
    v_delta := case when OLD.operation_type = 'Approvisionnement' then -OLD.volume_liters else OLD.volume_liters end;
    v_current := v_current + v_delta;
    update fuel_tank set current_volume = v_current where id = 1;
    return OLD;
  end if;

  return null;
end;
$$;

create trigger fuel_entries_before_insert
  before insert on fuel_entries
  for each row execute function fuel_apply_delta();

create trigger fuel_entries_before_update
  before update on fuel_entries
  for each row execute function fuel_apply_delta();

create trigger fuel_entries_after_delete
  after delete on fuel_entries
  for each row execute function fuel_apply_delta();

-- ============================================================
-- CODE ADMIN pour maintenance et fuel_entries (même principe
-- que admin_update_entry/admin_delete_entry plus haut)
-- ============================================================

create or replace function admin_update_maintenance(
  p_id uuid,
  p_admin_code text,
  p_fiche_number integer,
  p_entry_date date,
  p_machine_name text,
  p_problem_description text,
  p_supplier_name text,
  p_purchased_by text,
  p_entered_by text,
  p_requested_by text,
  p_amount numeric,
  p_is_paid text,
  p_observations text
)
returns maintenance
language plpgsql
security definer
set search_path = public
as $$
declare
  v_code text;
  v_result maintenance;
begin
  select value into v_code from app_settings where key = 'admin_code';
  if v_code is null or p_admin_code <> v_code then
    raise exception 'Code administrateur invalide';
  end if;

  update maintenance set
    fiche_number = p_fiche_number,
    entry_date = p_entry_date,
    machine_name = p_machine_name,
    problem_description = p_problem_description,
    supplier_name = p_supplier_name,
    purchased_by = p_purchased_by,
    entered_by = p_entered_by,
    requested_by = p_requested_by,
    amount = p_amount,
    is_paid = p_is_paid,
    observations = p_observations
  where id = p_id
  returning * into v_result;

  if v_result.id is null then
    raise exception 'Fiche introuvable';
  end if;

  return v_result;
end;
$$;

create or replace function admin_delete_maintenance(p_id uuid, p_admin_code text)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_code text;
begin
  select value into v_code from app_settings where key = 'admin_code';
  if v_code is null or p_admin_code <> v_code then
    raise exception 'Code administrateur invalide';
  end if;

  delete from maintenance where id = p_id;
end;
$$;

create or replace function admin_update_fuel(
  p_id uuid,
  p_admin_code text,
  p_bon_number integer,
  p_entry_date date,
  p_operation_type text,
  p_truck_plate text,
  p_driver_name text,
  p_volume_liters numeric,
  p_supplier_name text,
  p_observations text
)
returns fuel_entries
language plpgsql
security definer
set search_path = public
as $$
declare
  v_code text;
  v_result fuel_entries;
begin
  select value into v_code from app_settings where key = 'admin_code';
  if v_code is null or p_admin_code <> v_code then
    raise exception 'Code administrateur invalide';
  end if;

  update fuel_entries set
    bon_number = p_bon_number,
    entry_date = p_entry_date,
    operation_type = p_operation_type,
    truck_plate = p_truck_plate,
    driver_name = p_driver_name,
    volume_liters = p_volume_liters,
    supplier_name = p_supplier_name,
    observations = p_observations
  where id = p_id
  returning * into v_result;

  if v_result.id is null then
    raise exception 'Opération introuvable';
  end if;

  return v_result;
end;
$$;

create or replace function admin_delete_fuel(p_id uuid, p_admin_code text)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_code text;
begin
  select value into v_code from app_settings where key = 'admin_code';
  if v_code is null or p_admin_code <> v_code then
    raise exception 'Code administrateur invalide';
  end if;

  delete from fuel_entries where id = p_id;
end;
$$;

revoke all on function admin_update_maintenance(uuid, text, integer, date, text, text, text, text, text, text, numeric, text, text) from public;
revoke all on function admin_delete_maintenance(uuid, text) from public;
grant execute on function admin_update_maintenance(uuid, text, integer, date, text, text, text, text, text, text, numeric, text, text) to anon, authenticated;
grant execute on function admin_delete_maintenance(uuid, text) to anon, authenticated;

revoke all on function admin_update_fuel(uuid, text, integer, date, text, text, text, numeric, text, text) from public;
revoke all on function admin_delete_fuel(uuid, text) from public;
grant execute on function admin_update_fuel(uuid, text, integer, date, text, text, text, numeric, text, text) to anon, authenticated;
grant execute on function admin_delete_fuel(uuid, text) to anon, authenticated;

-- ============================================================
-- AUTHENTIFICATION : 5 utilisateurs, code de vérification à 2 étapes
-- pour Halim / Bureau / Bilal
-- ============================================================
-- pgcrypto : pour hasher les mots de passe par défaut ci-dessous (digest sha256).
-- pg_net   : pour envoyer la notification ntfy du code de vérification DEPUIS la
--            base, sans jamais renvoyer le code au navigateur qui le demande.
--            Si la création échoue ("permission denied"), active l'extension
--            "pg_net" via Database > Extensions dans le dashboard Supabase, puis
--            relance uniquement les blocs "create table"/"create function" plus bas.
create extension if not exists pgcrypto;
create extension if not exists pg_net;

create table if not exists app_users (
  id serial primary key,
  username text unique not null,
  password_hash text not null,
  requires_verification boolean not null default false,
  created_at timestamptz not null default now()
);

comment on table app_users is 'Comptes de connexion à l''application (5 utilisateurs internes)';
comment on column app_users.password_hash is 'SHA-256 hex du mot de passe (hashé côté client avant envoi, jamais transmis en clair)';

alter table app_users enable row level security;
-- Aucune policy créée volontairement : app_users n'est accessible ni en lecture ni
-- en écriture via l'API (anon/authenticated), uniquement depuis l'intérieur des
-- fonctions SECURITY DEFINER ci-dessous.

-- Mots de passe par défaut À CHANGER après la mise en service
-- (update app_users set password_hash = encode(digest('nouveau_mdp', 'sha256'), 'hex') where username = '...';)
insert into app_users (username, password_hash, requires_verification) values
  ('Ahcene', encode(digest('ahcene2024', 'sha256'), 'hex'), false),
  ('Massilva', encode(digest('massilva2024', 'sha256'), 'hex'), false),
  ('Halim', encode(digest('halim2024', 'sha256'), 'hex'), true),
  ('Bureau', encode(digest('bureau2024', 'sha256'), 'hex'), true),
  ('Bilal', encode(digest('bilal2024', 'sha256'), 'hex'), true)
on conflict (username) do nothing;

create table if not exists verification_codes (
  id uuid primary key default gen_random_uuid(),
  username text not null,
  code text not null,
  expires_at timestamptz not null,
  used boolean not null default false,
  created_at timestamptz not null default now()
);

comment on table verification_codes is 'Codes OTP à 6 chiffres (5 min) pour les comptes avec requires_verification';

create index if not exists verification_codes_username_idx on verification_codes (username, created_at desc);

alter table verification_codes enable row level security;
-- Aucune policy créée volontairement : accessible uniquement via
-- request_login_code / verify_login_code (SECURITY DEFINER).

-- Topic ntfy privé utilisé pour l'envoi côté serveur du code de connexion.
-- Doit correspondre exactement à VITE_NTFY_AUTH_TOPIC (.env + Vercel).
insert into app_settings (key, value)
values ('ntfy_auth_topic', 'DPR_Auth_Ahcene_Secret')
on conflict (key) do nothing;

-- Étape 1 : vérifie le mot de passe.
-- - Compte sans vérification -> { success: true, requires_verification: false }
-- - Compte avec vérification -> génère un code à 6 chiffres, le stocke (5 min),
--   l'envoie via ntfy DEPUIS la base (pg_net) et renvoie seulement
--   { success: true, requires_verification: true } : le code lui-même ne quitte
--   jamais la base de données autrement que par la notification ntfy.
create or replace function request_login_code(p_username text, p_password_hash text)
returns json
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user app_users%rowtype;
  v_code text;
  v_topic text;
begin
  select * into v_user from app_users where username = p_username;

  if v_user.id is null or v_user.password_hash <> p_password_hash then
    return json_build_object('success', false, 'requires_verification', false, 'message', 'Identifiants invalides');
  end if;

  if not v_user.requires_verification then
    return json_build_object('success', true, 'requires_verification', false, 'message', 'Connecté');
  end if;

  v_code := lpad(floor(random() * 1000000)::text, 6, '0');

  insert into verification_codes (username, code, expires_at)
  values (p_username, v_code, now() + interval '5 minutes');

  select value into v_topic from app_settings where key = 'ntfy_auth_topic';

  if v_topic is not null then
    perform net.http_post(
      url := 'https://ntfy.sh',
      body := jsonb_build_object(
        'topic', v_topic,
        'title', 'Code de connexion',
        'message', 'Code de connexion : ' || v_code || ' — Demandé par : ' || p_username,
        'tags', jsonb_build_array('closed_lock_with_key'),
        'priority', 5
      )
    );
  end if;

  return json_build_object('success', true, 'requires_verification', true, 'message', 'Code envoyé à l''administrateur');
end;
$$;

-- Étape 2 (comptes avec vérification uniquement) : valide le code à 6 chiffres.
create or replace function verify_login_code(p_username text, p_code text)
returns json
language plpgsql
security definer
set search_path = public
as $$
declare
  v_row verification_codes%rowtype;
begin
  select * into v_row
  from verification_codes
  where username = p_username and code = p_code and used = false and expires_at > now()
  order by created_at desc
  limit 1;

  if v_row.id is null then
    return json_build_object('success', false, 'message', 'Code incorrect ou expiré');
  end if;

  update verification_codes set used = true where id = v_row.id;

  return json_build_object('success', true, 'message', 'Connecté');
end;
$$;

revoke all on function request_login_code(text, text) from public;
revoke all on function verify_login_code(text, text) from public;
grant execute on function request_login_code(text, text) to anon, authenticated;
grant execute on function verify_login_code(text, text) to anon, authenticated;

-- Attribution : quel utilisateur a fait chaque saisie
alter table entries add column if not exists entered_by_user text;
alter table maintenance add column if not exists entered_by_user text;
alter table fuel_entries add column if not exists entered_by_user text;

-- ============================================================
-- RÔLES : admin (tout accès) / editor (saisie + consultation + export,
-- pas de code admin) / viewer (consultation seule, ni saisie ni export)
-- ============================================================
alter table app_users add column if not exists role text not null default 'editor';

update app_users set role = 'admin' where username in ('Ahcene', 'Massilva');
update app_users set role = 'viewer' where username = 'Bilal';
-- Halim et Bureau restent 'editor' (valeur par défaut de la colonne).

-- request_login_code renvoie désormais aussi le rôle : l'application en a
-- besoin dès la connexion pour afficher/masquer les bonnes fonctionnalités,
-- avant même que verify_login_code (comptes avec vérification) ne soit appelée.
create or replace function request_login_code(p_username text, p_password_hash text)
returns json
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user app_users%rowtype;
  v_code text;
  v_topic text;
begin
  select * into v_user from app_users where username = p_username;

  if v_user.id is null or v_user.password_hash <> p_password_hash then
    return json_build_object('success', false, 'requires_verification', false, 'message', 'Identifiants invalides');
  end if;

  if not v_user.requires_verification then
    return json_build_object('success', true, 'requires_verification', false, 'role', v_user.role, 'message', 'Connecté');
  end if;

  v_code := lpad(floor(random() * 1000000)::text, 6, '0');

  insert into verification_codes (username, code, expires_at)
  values (p_username, v_code, now() + interval '5 minutes');

  select value into v_topic from app_settings where key = 'ntfy_auth_topic';

  if v_topic is not null then
    perform net.http_post(
      url := 'https://ntfy.sh',
      body := jsonb_build_object(
        'topic', v_topic,
        'title', 'Code de connexion',
        'message', 'Code de connexion : ' || v_code || ' — Demandé par : ' || p_username,
        'tags', jsonb_build_array('closed_lock_with_key'),
        'priority', 5
      )
    );
  end if;

  return json_build_object('success', true, 'requires_verification', true, 'role', v_user.role, 'message', 'Code envoyé à l''administrateur');
end;
$$;
-- Le grant execute existant sur request_login_code(text, text) reste valide
-- (create or replace ne modifie pas les privilèges déjà accordés).

-- ============================================================
-- SABLE : suivi des achats de sable (fournisseur + transport séparés)
-- ============================================================

create table if not exists sand_entries (
  id uuid primary key default gen_random_uuid(),
  bon_number integer not null unique,
  entry_date date not null default current_date,
  entry_time time,
  supplier_name text not null,
  transporter_name text,
  truck_plate text,
  driver_name text,
  quantity_tons numeric(8, 2) not null,
  sand_price numeric(10, 2) not null,
  transport_price numeric(10, 2) not null,
  photo_url text,
  observations text,
  entered_by_user text,
  created_at timestamptz not null default now()
);

comment on table sand_entries is 'Livraisons de sable : fournisseur, transporteur, quantité et coûts';
comment on column sand_entries.sand_price is 'Prix total du sable pour cette livraison (DA)';
comment on column sand_entries.transport_price is 'Prix total du transport pour cette livraison (DA)';

create index if not exists sand_entries_created_at_idx on sand_entries (created_at desc);
create index if not exists sand_entries_supplier_name_idx on sand_entries (supplier_name);
create index if not exists sand_entries_transporter_name_idx on sand_entries (transporter_name);
create index if not exists sand_entries_truck_plate_idx on sand_entries (truck_plate);
create index if not exists sand_entries_bon_number_idx on sand_entries (bon_number desc);

alter table sand_entries enable row level security;

create policy "Lecture publique sable"
  on sand_entries for select
  using (true);

create policy "Ajout sable"
  on sand_entries for insert
  with check (true);

create policy "Modification sable"
  on sand_entries for update
  using (created_at > now() - interval '72 hours')
  with check (created_at > now() - interval '72 hours');

create policy "Suppression sable"
  on sand_entries for delete
  using (created_at > now() - interval '72 hours');

alter publication supabase_realtime add table sand_entries;

-- Storage : bucket public pour les photos des bons de sable
insert into storage.buckets (id, name, public)
values ('sable-photos', 'sable-photos', true)
on conflict (id) do nothing;

create policy "Lecture publique photos sable"
  on storage.objects for select
  using (bucket_id = 'sable-photos');

create policy "Ajout photos sable"
  on storage.objects for insert
  with check (bucket_id = 'sable-photos');

create policy "Suppression photos sable"
  on storage.objects for delete
  using (bucket_id = 'sable-photos');

-- Code admin (même principe que les autres domaines)
create or replace function admin_update_sand(
  p_id uuid,
  p_admin_code text,
  p_bon_number integer,
  p_entry_date date,
  p_supplier_name text,
  p_transporter_name text,
  p_truck_plate text,
  p_driver_name text,
  p_quantity_tons numeric,
  p_sand_price numeric,
  p_transport_price numeric,
  p_observations text
)
returns sand_entries
language plpgsql
security definer
set search_path = public
as $$
declare
  v_code text;
  v_result sand_entries%rowtype;
begin
  select value into v_code from app_settings where key = 'admin_code';
  if v_code is null or p_admin_code <> v_code then
    raise exception 'Code administrateur invalide';
  end if;

  update sand_entries set
    bon_number = p_bon_number,
    entry_date = p_entry_date,
    supplier_name = p_supplier_name,
    transporter_name = p_transporter_name,
    truck_plate = p_truck_plate,
    driver_name = p_driver_name,
    quantity_tons = p_quantity_tons,
    sand_price = p_sand_price,
    transport_price = p_transport_price,
    observations = p_observations
  where id = p_id
  returning * into v_result;

  if v_result.id is null then
    raise exception 'Livraison introuvable';
  end if;

  return v_result;
end;
$$;

create or replace function admin_delete_sand(p_id uuid, p_admin_code text)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_code text;
begin
  select value into v_code from app_settings where key = 'admin_code';
  if v_code is null or p_admin_code <> v_code then
    raise exception 'Code administrateur invalide';
  end if;

  delete from sand_entries where id = p_id;
end;
$$;

revoke all on function admin_update_sand(uuid, text, integer, date, text, text, text, text, numeric, numeric, numeric, text) from public;
revoke all on function admin_delete_sand(uuid, text) from public;
grant execute on function admin_update_sand(uuid, text, integer, date, text, text, text, text, numeric, numeric, numeric, text) to anon, authenticated;
grant execute on function admin_delete_sand(uuid, text) to anon, authenticated;

-- ============================================================
-- CODE HEBDOMADAIRE : pour les comptes avec requires_verification (Halim,
-- Bureau, Bilal), le code ntfy n'est demandé que le samedi (premier jour
-- ouvré de la semaine en Algérie). Dimanche à jeudi : mot de passe seul.
-- Vendredi : jour de repos, connexion refusée. Les comptes sans vérification
-- (admin : Ahcene, Massilva) se connectent toujours directement, sans
-- restriction de jour (les horaires 8h-17h sont gérés côté client, voir
-- LoginPage.jsx / lib/auth.js).
-- ============================================================
create or replace function request_login_code(p_username text, p_password_hash text)
returns json
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user app_users%rowtype;
  v_code text;
  v_topic text;
  v_dow int;
begin
  select * into v_user from app_users where username = p_username;

  if v_user.id is null or v_user.password_hash <> p_password_hash then
    return json_build_object('success', false, 'requires_verification', false, 'message', 'Identifiants invalides');
  end if;

  if not v_user.requires_verification then
    return json_build_object('success', true, 'requires_verification', false, 'role', v_user.role, 'message', 'Connecté');
  end if;

  -- Jour de la semaine en Algérie (0 = dimanche ... 5 = vendredi, 6 = samedi).
  v_dow := extract(dow from (now() at time zone 'Africa/Algiers'));

  if v_dow = 5 then
    return json_build_object('success', false, 'requires_verification', false, 'message', 'Jour de repos — accès indisponible');
  end if;

  if v_dow <> 6 then
    -- Dimanche à jeudi : mot de passe seul suffit, pas de code.
    return json_build_object('success', true, 'requires_verification', false, 'role', v_user.role, 'message', 'Connecté');
  end if;

  -- Samedi : code de vérification requis.
  v_code := lpad(floor(random() * 1000000)::text, 6, '0');

  insert into verification_codes (username, code, expires_at)
  values (p_username, v_code, now() + interval '5 minutes');

  select value into v_topic from app_settings where key = 'ntfy_auth_topic';

  if v_topic is not null then
    perform net.http_post(
      url := 'https://ntfy.sh',
      body := jsonb_build_object(
        'topic', v_topic,
        'title', 'Code de connexion',
        'message', 'Code de connexion : ' || v_code || ' — Demandé par : ' || p_username,
        'tags', jsonb_build_array('closed_lock_with_key'),
        'priority', 5
      )
    );
  end if;

  return json_build_object('success', true, 'requires_verification', true, 'role', v_user.role, 'message', 'Code envoyé à l''administrateur');
end;
$$;
-- Le grant execute existant sur request_login_code(text, text) reste valide
-- (create or replace ne modifie pas les privilèges déjà accordés).

-- ============================================================
-- SABLE : prix unitaire (remplace sand_price, qui était un montant total)
-- + suivi indépendant des paiements fournisseur / transporteur, réglables
-- plus tard (saisie initiale possible avec les deux statuts à "Non payé").
-- ============================================================

-- 1) Prix unitaire (DA/T). Rétro-calculé depuis l'ancien sand_price (montant
--    total) pour les lignes existantes, avant de devenir NOT NULL.
alter table sand_entries add column if not exists unit_price numeric(10, 2);

update sand_entries
set unit_price = round(sand_price / nullif(quantity_tons, 0), 2)
where unit_price is null;

update sand_entries set unit_price = 0 where unit_price is null;

alter table sand_entries alter column unit_price set not null;

-- 2) Total sable calculé automatiquement (remplace sand_price).
alter table sand_entries
  add column if not exists sand_total numeric(10, 2) generated always as (quantity_tons * unit_price) stored;

alter table sand_entries drop column if exists sand_price;

comment on column sand_entries.unit_price is 'Prix unitaire du sable (DA/T)';
comment on column sand_entries.sand_total is 'Total sable = quantity_tons * unit_price (calculé automatiquement)';

-- 3) Paiement fournisseur (sable) et transporteur, indépendants l'un de l'autre.
alter table sand_entries
  add column if not exists supplier_paid text not null default 'Non payé'
    check (supplier_paid in ('Non payé', 'Payé')),
  add column if not exists supplier_payment_mode text
    check (supplier_payment_mode in ('Espèces', 'Versement', 'Chèque')),
  add column if not exists supplier_cheque_number text,
  add column if not exists supplier_cheque_bank text,
  add column if not exists supplier_payment_date date,
  add column if not exists supplier_amount_paid numeric(10, 2),
  add column if not exists transporter_paid text not null default 'Non payé'
    check (transporter_paid in ('Non payé', 'Payé')),
  add column if not exists transporter_payment_mode text
    check (transporter_payment_mode in ('Espèces', 'Versement', 'Chèque')),
  add column if not exists transporter_cheque_number text,
  add column if not exists transporter_cheque_bank text,
  add column if not exists transporter_payment_date date,
  add column if not exists transporter_amount_paid numeric(10, 2);

-- 4) admin_update_sand : nouvelle signature (p_sand_price -> p_unit_price +
-- champs de paiement). L'ancienne fonction est supprimée explicitement car
-- changer la liste de paramètres crée une surcharge distincte plutôt que de
-- remplacer l'existante.
drop function if exists admin_update_sand(uuid, text, integer, date, text, text, text, text, numeric, numeric, numeric, text);

create or replace function admin_update_sand(
  p_id uuid,
  p_admin_code text,
  p_bon_number integer,
  p_entry_date date,
  p_supplier_name text,
  p_transporter_name text,
  p_truck_plate text,
  p_driver_name text,
  p_quantity_tons numeric,
  p_unit_price numeric,
  p_transport_price numeric,
  p_observations text,
  p_supplier_paid text,
  p_supplier_payment_mode text,
  p_supplier_cheque_number text,
  p_supplier_cheque_bank text,
  p_supplier_payment_date date,
  p_supplier_amount_paid numeric,
  p_transporter_paid text,
  p_transporter_payment_mode text,
  p_transporter_cheque_number text,
  p_transporter_cheque_bank text,
  p_transporter_payment_date date,
  p_transporter_amount_paid numeric
)
returns sand_entries
language plpgsql
security definer
set search_path = public
as $$
declare
  v_code text;
  v_result sand_entries%rowtype;
begin
  select value into v_code from app_settings where key = 'admin_code';
  if v_code is null or p_admin_code <> v_code then
    raise exception 'Code administrateur invalide';
  end if;

  update sand_entries set
    bon_number = p_bon_number,
    entry_date = p_entry_date,
    supplier_name = p_supplier_name,
    transporter_name = p_transporter_name,
    truck_plate = p_truck_plate,
    driver_name = p_driver_name,
    quantity_tons = p_quantity_tons,
    unit_price = p_unit_price,
    transport_price = p_transport_price,
    observations = p_observations,
    supplier_paid = p_supplier_paid,
    supplier_payment_mode = p_supplier_payment_mode,
    supplier_cheque_number = p_supplier_cheque_number,
    supplier_cheque_bank = p_supplier_cheque_bank,
    supplier_payment_date = p_supplier_payment_date,
    supplier_amount_paid = p_supplier_amount_paid,
    transporter_paid = p_transporter_paid,
    transporter_payment_mode = p_transporter_payment_mode,
    transporter_cheque_number = p_transporter_cheque_number,
    transporter_cheque_bank = p_transporter_cheque_bank,
    transporter_payment_date = p_transporter_payment_date,
    transporter_amount_paid = p_transporter_amount_paid
  where id = p_id
  returning * into v_result;

  if v_result.id is null then
    raise exception 'Livraison introuvable';
  end if;

  return v_result;
end;
$$;

revoke all on function admin_update_sand(uuid, text, integer, date, text, text, text, text, numeric, numeric, numeric, text, text, text, text, text, date, numeric, text, text, text, text, date, numeric) from public;
grant execute on function admin_update_sand(uuid, text, integer, date, text, text, text, text, numeric, numeric, numeric, text, text, text, text, text, date, numeric, text, text, text, text, date, numeric) to anon, authenticated;

-- ============================================================
-- FACTURES : registre général des factures de ventes (onglet "Factures")
-- ============================================================

create table if not exists invoices (
  id uuid primary key default gen_random_uuid(),
  invoice_number text not null unique,
  entry_date date not null default current_date,
  entry_time time,
  client_name text not null,
  total_ht numeric(12, 2) not null,
  discount_percent numeric(5, 2) default 0,
  total_tva numeric(12, 2) generated always as (total_ht * 0.19 * (1 - discount_percent / 100)) stored,
  total_ttc numeric(12, 2) generated always as (
    total_ht * (1 - discount_percent / 100) + total_ht * 0.19 * (1 - discount_percent / 100)
  ) stored,
  stamp_duty numeric(10, 2) default 0,
  total_net numeric(12, 2) generated always as (
    total_ht * (1 - discount_percent / 100) + total_ht * 0.19 * (1 - discount_percent / 100) + stamp_duty
  ) stored,
  payment_status text default 'Non payé' check (payment_status in ('Espèces', 'Chèque', 'Virement', 'Non payé')),
  cheque_number text,
  cheque_bank text,
  ref_commande text,
  ref_livraison text,
  observations text,
  entered_by_user text,
  created_at timestamptz not null default now()
);

comment on table invoices is 'Registre général des factures de ventes';
comment on column invoices.total_tva is 'TVA = total_ht * 0.19 * (1 - discount_percent/100), calculée automatiquement';
comment on column invoices.total_ttc is 'TTC = HT remisé + TVA, calculé automatiquement';
comment on column invoices.total_net is 'Net à payer = TTC + timbre, calculé automatiquement';

create index if not exists invoices_created_at_idx on invoices (created_at desc);
create index if not exists invoices_entry_date_idx on invoices (entry_date desc);
create index if not exists invoices_client_name_idx on invoices (client_name);
create index if not exists invoices_invoice_number_idx on invoices (invoice_number);
create index if not exists invoices_payment_status_idx on invoices (payment_status);

alter table invoices enable row level security;

create policy "Lecture publique factures"
  on invoices for select
  using (true);

create policy "Ajout factures"
  on invoices for insert
  with check (true);

create policy "Modification factures"
  on invoices for update
  using (created_at > now() - interval '72 hours')
  with check (created_at > now() - interval '72 hours');

create policy "Suppression factures"
  on invoices for delete
  using (created_at > now() - interval '72 hours');

alter publication supabase_realtime add table invoices;

-- Code admin (même principe que admin_update_entry/admin_delete_entry plus haut) :
-- permet de modifier/supprimer une facture après le verrou de 72h.
create or replace function admin_update_invoice(
  p_id uuid,
  p_admin_code text,
  p_invoice_number text,
  p_entry_date date,
  p_client_name text,
  p_total_ht numeric,
  p_discount_percent numeric,
  p_stamp_duty numeric,
  p_payment_status text,
  p_cheque_number text,
  p_cheque_bank text,
  p_ref_commande text,
  p_ref_livraison text,
  p_observations text
)
returns invoices
language plpgsql
security definer
set search_path = public
as $$
declare
  v_code text;
  v_result invoices;
begin
  select value into v_code from app_settings where key = 'admin_code';
  if v_code is null or p_admin_code <> v_code then
    raise exception 'Code administrateur invalide';
  end if;

  update invoices set
    invoice_number = p_invoice_number,
    entry_date = p_entry_date,
    client_name = p_client_name,
    total_ht = p_total_ht,
    discount_percent = p_discount_percent,
    stamp_duty = p_stamp_duty,
    payment_status = p_payment_status,
    cheque_number = p_cheque_number,
    cheque_bank = p_cheque_bank,
    ref_commande = p_ref_commande,
    ref_livraison = p_ref_livraison,
    observations = p_observations
  where id = p_id
  returning * into v_result;

  if v_result.id is null then
    raise exception 'Facture introuvable';
  end if;

  return v_result;
end;
$$;

create or replace function admin_delete_invoice(p_id uuid, p_admin_code text)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_code text;
begin
  select value into v_code from app_settings where key = 'admin_code';
  if v_code is null or p_admin_code <> v_code then
    raise exception 'Code administrateur invalide';
  end if;

  delete from invoices where id = p_id;
end;
$$;

revoke all on function admin_update_invoice(uuid, text, text, date, text, numeric, numeric, numeric, text, text, text, text, text, text) from public;
revoke all on function admin_delete_invoice(uuid, text) from public;
grant execute on function admin_update_invoice(uuid, text, text, date, text, numeric, numeric, numeric, text, text, text, text, text, text) to anon, authenticated;
grant execute on function admin_delete_invoice(uuid, text) to anon, authenticated;

-- ============================================================
-- CLIENTS : référentiel + solde de compte (import historique
-- depuis Situation_Globale.xlsx via scripts/import-situations.js,
-- puis tenu à jour automatiquement par l'activité native dans `invoices`).
-- ============================================================

create table if not exists clients (
  id uuid primary key default gen_random_uuid(),
  name text unique not null,
  total_invoiced numeric(14, 2) not null default 0,
  total_paid numeric(14, 2) not null default 0,
  balance numeric(14, 2) not null default 0,
  source text not null default 'manual',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

comment on table clients is 'Référentiel clients : solde de compte cumulant l''historique importé (Situation_Globale.xlsx) et l''activité native de la table invoices';
comment on column clients.balance is 'total_invoiced - total_paid ; positif = client débiteur';
comment on column clients.source is '''import_historique'' pour les lignes créées par scripts/import-situations.js, ''manual'' sinon';

create index if not exists clients_name_lower_idx on clients (lower(name));
create index if not exists clients_balance_idx on clients (balance desc);

alter table clients enable row level security;

create policy "Lecture publique clients"
  on clients for select
  using (true);

create policy "Ajout clients"
  on clients for insert
  with check (true);

create policy "Modification clients"
  on clients for update
  using (true)
  with check (true);
-- Pas de verrou 72h ici (contrairement aux autres tables) : balance/total_invoiced/
-- total_paid sont des totaux courants tenus à jour en continu par le trigger
-- ci-dessous à chaque écriture dans `invoices`, pas un historique figé.

alter publication supabase_realtime add table clients;

create table if not exists client_yearly_stats (
  id uuid primary key default gen_random_uuid(),
  client_id uuid not null references clients(id) on delete cascade,
  year integer not null,
  amount numeric(14, 2) not null,
  unique (client_id, year)
);

comment on table client_yearly_stats is 'Chiffre d''affaires annuel par client, importé depuis l''onglet Chiffre_Affaires_Clients de Situation_Globale.xlsx (année 2024 volontairement exclue : données sources incomplètes/suspectes)';

create index if not exists client_yearly_stats_client_id_idx on client_yearly_stats (client_id);

alter table client_yearly_stats enable row level security;

create policy "Lecture publique stats annuelles clients"
  on client_yearly_stats for select
  using (true);

create policy "Ajout stats annuelles clients"
  on client_yearly_stats for insert
  with check (true);

create policy "Modification stats annuelles clients"
  on client_yearly_stats for update
  using (true)
  with check (true);

alter publication supabase_realtime add table client_yearly_stats;

-- Tient à jour clients.total_invoiced / total_paid / balance à chaque écriture
-- sur `invoices` (insert direct, update -- y compris via admin_update_invoice --,
-- delete -- y compris via admin_delete_invoice), en ajoutant/retirant le
-- total_net de la facture sur le compte du client correspondant (recherche
-- insensible à la casse sur clients.name). N'agit que si le client existe déjà
-- dans `clients` (pas de création automatique) : voir le formulaire de saisie,
-- qui affiche "Nouveau client — pas d'historique" dans ce cas.
create or replace function sync_client_balance_from_invoice()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_old_client_id uuid;
  v_new_client_id uuid;
begin
  if TG_OP = 'UPDATE' or TG_OP = 'DELETE' then
    select id into v_old_client_id from clients where lower(name) = lower(OLD.client_name) limit 1;
    if v_old_client_id is not null then
      update clients set
        total_invoiced = total_invoiced - OLD.total_net,
        total_paid = total_paid - case when OLD.payment_status is distinct from 'Non payé' then OLD.total_net else 0 end,
        updated_at = now()
      where id = v_old_client_id;
    end if;
  end if;

  if TG_OP = 'INSERT' or TG_OP = 'UPDATE' then
    select id into v_new_client_id from clients where lower(name) = lower(NEW.client_name) limit 1;
    if v_new_client_id is not null then
      update clients set
        total_invoiced = total_invoiced + NEW.total_net,
        total_paid = total_paid + case when NEW.payment_status is distinct from 'Non payé' then NEW.total_net else 0 end,
        updated_at = now()
      where id = v_new_client_id;
    end if;
  end if;

  update clients set balance = total_invoiced - total_paid
  where id = v_old_client_id or id = v_new_client_id;

  return coalesce(NEW, OLD);
end;
$$;

drop trigger if exists invoices_sync_client_balance on invoices;

create trigger invoices_sync_client_balance
  after insert or update or delete on invoices
  for each row execute function sync_client_balance_from_invoice();

-- ============================================================
-- FACTURES : refonte du schéma pour coller au format réel du bon de
-- livraison (brique B8/B12/H, prix unitaire, remise en montant fixe,
-- règlement/décaissement, chauffeur/immat, type A TERME/COMPTANT/AVANCE)
-- au lieu du schéma HT/TVA/TTC/Timbre initial.
-- ============================================================

-- 1) Colonnes générées existantes : à supprimer avant de toucher aux
--    colonnes dont elles dépendent (total_ht, discount_percent, stamp_duty).
alter table invoices drop column if exists total_tva;
alter table invoices drop column if exists total_ttc;
alter table invoices drop column if exists total_net;

-- 2) Colonnes obsolètes.
alter table invoices drop column if exists total_ht;
alter table invoices drop column if exists discount_percent;
alter table invoices drop column if exists stamp_duty;

-- 3) Désignation du produit + n° de bon de livraison.
alter table invoices add column if not exists designation text not null default 'Brique B12';
alter table invoices add column if not exists designation_other text;
alter table invoices add column if not exists bl_number text;

comment on column invoices.designation is 'Brique B12 / Brique B8 / Autre (voir designation_other si Autre)';

-- 4) Quantités (T) par type de produit.
alter table invoices add column if not exists qty_b8 numeric(8, 2) not null default 0;
alter table invoices add column if not exists qty_b12 numeric(8, 2) not null default 0;
alter table invoices add column if not exists qty_h numeric(8, 2) not null default 0;

-- 5) Prix unitaire : nullable puis NOT NULL après backfill, au cas où des
--    lignes existent déjà sans valeur (même précaution que sand_entries.unit_price).
alter table invoices add column if not exists unit_price numeric(10, 2);
update invoices set unit_price = 0 where unit_price is null;
alter table invoices alter column unit_price set not null;

-- 6) Montant = (qty_b8 + qty_b12 + qty_h) * unit_price, calculé automatiquement.
alter table invoices add column if not exists amount numeric(12, 2)
  generated always as ((qty_b8 + qty_b12 + qty_h) * unit_price) stored;

-- 7) Remise en montant fixe (pas en %), puis Total = Montant - Remise.
alter table invoices add column if not exists discount_amount numeric(10, 2) not null default 0;
alter table invoices add column if not exists total numeric(12, 2)
  generated always as ((qty_b8 + qty_b12 + qty_h) * unit_price - discount_amount) stored;

-- 8) Règlement / décaissement, puis Solde = Total - Règlement.
alter table invoices add column if not exists settlement numeric(12, 2) not null default 0;
alter table invoices add column if not exists disbursement numeric(12, 2) not null default 0;
alter table invoices add column if not exists balance numeric(12, 2)
  generated always as ((qty_b8 + qty_b12 + qty_h) * unit_price - discount_amount - settlement) stored;

comment on column invoices.balance is 'Total - Règlement ; positif = client débiteur sur cette facture';

-- 9) Chauffeur / immatriculation / type de paiement (N/B).
alter table invoices add column if not exists driver_name text;
alter table invoices add column if not exists truck_plate text;
alter table invoices add column if not exists payment_type text not null default 'A TERME'
  check (payment_type in ('A TERME', 'COMPTANT', 'AVANCE'));

-- 10) 'Mode de paiement' (payment_status) : 'Virement' devient 'Versement'
--     pour rester cohérent avec le vocabulaire déjà utilisé sur la page Sable.
update invoices set payment_status = 'Versement' where payment_status = 'Virement';
alter table invoices drop constraint if exists invoices_payment_status_check;
alter table invoices add constraint invoices_payment_status_check
  check (payment_status in ('Espèces', 'Versement', 'Chèque', 'Non payé'));

-- 11) admin_update_invoice : nouvelle signature complète (l'ancienne est
--     supprimée explicitement car la liste de paramètres change entièrement).
drop function if exists admin_update_invoice(uuid, text, text, date, text, numeric, numeric, numeric, text, text, text, text, text, text);

create or replace function admin_update_invoice(
  p_id uuid,
  p_admin_code text,
  p_invoice_number text,
  p_entry_date date,
  p_client_name text,
  p_designation text,
  p_designation_other text,
  p_bl_number text,
  p_qty_b8 numeric,
  p_qty_b12 numeric,
  p_qty_h numeric,
  p_unit_price numeric,
  p_discount_amount numeric,
  p_settlement numeric,
  p_disbursement numeric,
  p_driver_name text,
  p_truck_plate text,
  p_payment_type text,
  p_payment_status text,
  p_cheque_number text,
  p_cheque_bank text,
  p_ref_commande text,
  p_ref_livraison text,
  p_observations text
)
returns invoices
language plpgsql
security definer
set search_path = public
as $$
declare
  v_code text;
  v_result invoices;
begin
  select value into v_code from app_settings where key = 'admin_code';
  if v_code is null or p_admin_code <> v_code then
    raise exception 'Code administrateur invalide';
  end if;

  update invoices set
    invoice_number = p_invoice_number,
    entry_date = p_entry_date,
    client_name = p_client_name,
    designation = p_designation,
    designation_other = p_designation_other,
    bl_number = p_bl_number,
    qty_b8 = p_qty_b8,
    qty_b12 = p_qty_b12,
    qty_h = p_qty_h,
    unit_price = p_unit_price,
    discount_amount = p_discount_amount,
    settlement = p_settlement,
    disbursement = p_disbursement,
    driver_name = p_driver_name,
    truck_plate = p_truck_plate,
    payment_type = p_payment_type,
    payment_status = p_payment_status,
    cheque_number = p_cheque_number,
    cheque_bank = p_cheque_bank,
    ref_commande = p_ref_commande,
    ref_livraison = p_ref_livraison,
    observations = p_observations
  where id = p_id
  returning * into v_result;

  if v_result.id is null then
    raise exception 'Facture introuvable';
  end if;

  return v_result;
end;
$$;

revoke all on function admin_update_invoice(uuid, text, text, date, text, text, text, text, numeric, numeric, numeric, numeric, numeric, numeric, numeric, text, text, text, text, text, text, text, text, text) from public;
grant execute on function admin_update_invoice(uuid, text, text, date, text, text, text, text, numeric, numeric, numeric, numeric, numeric, numeric, numeric, text, text, text, text, text, text, text, text, text) to anon, authenticated;

-- 12) Trigger de solde client : utilise désormais `total` (Montant - Remise)
--     au lieu de `total_net` (supprimé ci-dessus).
create or replace function sync_client_balance_from_invoice()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_old_client_id uuid;
  v_new_client_id uuid;
begin
  if TG_OP = 'UPDATE' or TG_OP = 'DELETE' then
    select id into v_old_client_id from clients where lower(name) = lower(OLD.client_name) limit 1;
    if v_old_client_id is not null then
      update clients set
        total_invoiced = total_invoiced - OLD.total,
        total_paid = total_paid - case when OLD.payment_status is distinct from 'Non payé' then OLD.total else 0 end,
        updated_at = now()
      where id = v_old_client_id;
    end if;
  end if;

  if TG_OP = 'INSERT' or TG_OP = 'UPDATE' then
    select id into v_new_client_id from clients where lower(name) = lower(NEW.client_name) limit 1;
    if v_new_client_id is not null then
      update clients set
        total_invoiced = total_invoiced + NEW.total,
        total_paid = total_paid + case when NEW.payment_status is distinct from 'Non payé' then NEW.total else 0 end,
        updated_at = now()
      where id = v_new_client_id;
    end if;
  end if;

  update clients set balance = total_invoiced - total_paid
  where id = v_old_client_id or id = v_new_client_id;

  return coalesce(NEW, OLD);
end;
$$;

-- ============================================================
-- AVANCES CLIENTS : paiement anticipé d'un lot de bons, décompté
-- automatiquement à chaque chargement (`entries`) rattaché au client.
-- ============================================================

create table if not exists client_advances (
  id uuid primary key default gen_random_uuid(),
  client_name text not null,
  advance_date date not null default current_date,
  amount_paid numeric(12, 2) not null,
  bons_purchased integer not null,
  bons_remaining integer not null,
  payment_mode text check (payment_mode in ('Espèces', 'Versement', 'Chèque')),
  cheque_number text,
  cheque_bank text,
  observations text,
  entered_by_user text,
  created_at timestamptz not null default now()
);

comment on table client_advances is 'Avances clients : paiement anticipé d''un lot de bons, décompté à chaque chargement (entries) du client concerné';

create index if not exists client_advances_client_name_idx on client_advances (lower(client_name));
create index if not exists client_advances_created_at_idx on client_advances (created_at desc);

alter table client_advances enable row level security;

create policy "Lecture publique avances"
  on client_advances for select
  using (true);

create policy "Ajout avances"
  on client_advances for insert
  with check (true);

create policy "Modification avances"
  on client_advances for update
  using (created_at > now() - interval '72 hours')
  with check (created_at > now() - interval '72 hours');

create policy "Suppression avances"
  on client_advances for delete
  using (created_at > now() - interval '72 hours');

alter publication supabase_realtime add table client_advances;

create or replace function admin_update_client_advance(
  p_id uuid,
  p_admin_code text,
  p_client_name text,
  p_advance_date date,
  p_amount_paid numeric,
  p_bons_purchased integer,
  p_bons_remaining integer,
  p_payment_mode text,
  p_cheque_number text,
  p_cheque_bank text,
  p_observations text
)
returns client_advances
language plpgsql
security definer
set search_path = public
as $$
declare
  v_code text;
  v_result client_advances;
begin
  select value into v_code from app_settings where key = 'admin_code';
  if v_code is null or p_admin_code <> v_code then
    raise exception 'Code administrateur invalide';
  end if;

  update client_advances set
    client_name = p_client_name,
    advance_date = p_advance_date,
    amount_paid = p_amount_paid,
    bons_purchased = p_bons_purchased,
    bons_remaining = p_bons_remaining,
    payment_mode = p_payment_mode,
    cheque_number = p_cheque_number,
    cheque_bank = p_cheque_bank,
    observations = p_observations
  where id = p_id
  returning * into v_result;

  if v_result.id is null then
    raise exception 'Avance introuvable';
  end if;

  return v_result;
end;
$$;

create or replace function admin_delete_client_advance(p_id uuid, p_admin_code text)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_code text;
begin
  select value into v_code from app_settings where key = 'admin_code';
  if v_code is null or p_admin_code <> v_code then
    raise exception 'Code administrateur invalide';
  end if;

  delete from client_advances where id = p_id;
end;
$$;

revoke all on function admin_update_client_advance(uuid, text, text, date, numeric, integer, integer, text, text, text, text) from public;
revoke all on function admin_delete_client_advance(uuid, text) from public;
grant execute on function admin_update_client_advance(uuid, text, text, date, numeric, integer, integer, text, text, text, text) to anon, authenticated;
grant execute on function admin_delete_client_advance(uuid, text) to anon, authenticated;

-- ============================================================
-- Décompte automatique des avances depuis le chargement (entries) : un
-- champ Client optionnel avec autocomplétion (EntryForm.jsx) permet de
-- rattacher un bon de chargement à un client ayant une avance active.
-- ============================================================

alter table entries add column if not exists client_name text;
create index if not exists entries_client_name_idx on entries (lower(client_name));

-- Réutilise le même topic ntfy que le reste de l'app (VITE_NTFY_TOPIC) pour
-- la notification serveur "avance épuisée", déclenchée depuis un trigger SQL
-- (comme ntfy_auth_topic pour le code de connexion hebdomadaire). À mettre à
-- jour pour correspondre exactement à VITE_NTFY_TOPIC (.env + Vercel) :
--   update app_settings set value = 'VOTRE_TOPIC_NTFY' where key = 'ntfy_topic';
insert into app_settings (key, value)
values ('ntfy_topic', 'dpr-axxam-chargement-xxxx')
on conflict (key) do nothing;

create or replace function decrement_client_advance_on_entry()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_advance_id uuid;
  v_remaining integer;
  v_topic text;
begin
  if NEW.client_name is null or trim(NEW.client_name) = '' then
    return NEW;
  end if;

  select id into v_advance_id
  from client_advances
  where lower(client_name) = lower(NEW.client_name) and bons_remaining > 0
  order by advance_date desc, created_at desc
  limit 1;

  if v_advance_id is null then
    return NEW;
  end if;

  update client_advances
  set bons_remaining = bons_remaining - 1
  where id = v_advance_id
  returning bons_remaining into v_remaining;

  if v_remaining = 0 then
    select value into v_topic from app_settings where key = 'ntfy_topic';
    if v_topic is not null then
      perform net.http_post(
        url := 'https://ntfy.sh',
        body := jsonb_build_object(
          'topic', v_topic,
          'title', 'Avance épuisée',
          'message', 'Avance épuisée pour le client ' || NEW.client_name,
          'tags', jsonb_build_array('warning'),
          'priority', 4
        )
      );
    end if;
  end if;

  return NEW;
end;
$$;

drop trigger if exists entries_decrement_client_advance on entries;

create trigger entries_decrement_client_advance
  after insert on entries
  for each row execute function decrement_client_advance_on_entry();

-- ============================================================
-- FACTURES : prix unitaires séparés par produit (B8 / B12 / Autre-H) au
-- lieu d'un seul prix unitaire partagé entre les trois.
-- ============================================================

-- 1) Colonnes générées à supprimer avant de toucher aux colonnes dont
--    elles dépendent (ordre inverse de dépendance : balance -> total -> amount).
alter table invoices drop column if exists balance;
alter table invoices drop column if exists total;
alter table invoices drop column if exists amount;

-- 2) unit_price devient price_b12 (prix unitaire des briques B12).
alter table invoices rename column unit_price to price_b12;

-- 3) Prix unitaires B8 et Autre (H), même précaution que les autres
--    colonnes numériques ajoutées sur cette table (NOT NULL DEFAULT 0 pour
--    ne jamais faire planter l'arithmétique des colonnes générées avec NULL).
alter table invoices add column if not exists price_b8 numeric(10, 2) not null default 0;
alter table invoices add column if not exists price_h numeric(10, 2) not null default 0;

-- 4) Recalcul des colonnes générées avec un prix par produit.
alter table invoices add column if not exists amount numeric(12, 2)
  generated always as (qty_b8 * price_b8 + qty_b12 * price_b12 + qty_h * price_h) stored;

alter table invoices add column if not exists total numeric(12, 2)
  generated always as (qty_b8 * price_b8 + qty_b12 * price_b12 + qty_h * price_h - discount_amount) stored;

alter table invoices add column if not exists balance numeric(12, 2)
  generated always as (qty_b8 * price_b8 + qty_b12 * price_b12 + qty_h * price_h - discount_amount - settlement) stored;

-- 5) admin_update_invoice : nouvelle signature (p_unit_price -> p_price_b8 /
--    p_price_b12 / p_price_h). L'ancienne fonction est supprimée explicitement
--    car la liste de paramètres change.
drop function if exists admin_update_invoice(uuid, text, text, date, text, text, text, text, numeric, numeric, numeric, numeric, numeric, numeric, numeric, text, text, text, text, text, text, text, text, text);

create or replace function admin_update_invoice(
  p_id uuid,
  p_admin_code text,
  p_invoice_number text,
  p_entry_date date,
  p_client_name text,
  p_designation text,
  p_designation_other text,
  p_bl_number text,
  p_qty_b8 numeric,
  p_qty_b12 numeric,
  p_qty_h numeric,
  p_price_b8 numeric,
  p_price_b12 numeric,
  p_price_h numeric,
  p_discount_amount numeric,
  p_settlement numeric,
  p_disbursement numeric,
  p_driver_name text,
  p_truck_plate text,
  p_payment_type text,
  p_payment_status text,
  p_cheque_number text,
  p_cheque_bank text,
  p_ref_commande text,
  p_ref_livraison text,
  p_observations text
)
returns invoices
language plpgsql
security definer
set search_path = public
as $$
declare
  v_code text;
  v_result invoices;
begin
  select value into v_code from app_settings where key = 'admin_code';
  if v_code is null or p_admin_code <> v_code then
    raise exception 'Code administrateur invalide';
  end if;

  update invoices set
    invoice_number = p_invoice_number,
    entry_date = p_entry_date,
    client_name = p_client_name,
    designation = p_designation,
    designation_other = p_designation_other,
    bl_number = p_bl_number,
    qty_b8 = p_qty_b8,
    qty_b12 = p_qty_b12,
    qty_h = p_qty_h,
    price_b8 = p_price_b8,
    price_b12 = p_price_b12,
    price_h = p_price_h,
    discount_amount = p_discount_amount,
    settlement = p_settlement,
    disbursement = p_disbursement,
    driver_name = p_driver_name,
    truck_plate = p_truck_plate,
    payment_type = p_payment_type,
    payment_status = p_payment_status,
    cheque_number = p_cheque_number,
    cheque_bank = p_cheque_bank,
    ref_commande = p_ref_commande,
    ref_livraison = p_ref_livraison,
    observations = p_observations
  where id = p_id
  returning * into v_result;

  if v_result.id is null then
    raise exception 'Facture introuvable';
  end if;

  return v_result;
end;
$$;

revoke all on function admin_update_invoice(uuid, text, text, date, text, text, text, text, numeric, numeric, numeric, numeric, numeric, numeric, numeric, numeric, numeric, text, text, text, text, text, text, text, text, text) from public;
grant execute on function admin_update_invoice(uuid, text, text, date, text, text, text, text, numeric, numeric, numeric, numeric, numeric, numeric, numeric, numeric, numeric, text, text, text, text, text, text, text, text, text) to anon, authenticated;

-- Note : le trigger invoices_sync_client_balance (sync_client_balance_from_invoice)
-- n'a pas besoin d'être modifié : il ne lit que NEW/OLD.total et .payment_status,
-- pas les colonnes de prix -- la nouvelle formule de `total` lui est transparente.

-- ============================================================
-- STOCK PRODUITS FINIS (B8 / B12) : la production augmente le stock, les
-- ventes (factures) le diminuent automatiquement.
-- ============================================================

create table if not exists product_stock (
  id serial primary key,
  product_name text unique not null,
  current_stock numeric(12, 2) not null default 0,
  -- max_capacity n'était pas dans la liste de colonnes demandée, mais est
  -- nécessaire pour la notification "stock bas (< 10% du max)" explicitement
  -- demandée plus bas -- mêmes valeurs par défaut à ajuster à la vraie
  -- capacité de stockage :
  --   update product_stock set max_capacity = 50000 where product_name = 'B8';
  max_capacity numeric(12, 2) not null default 100000,
  updated_at timestamptz default now()
);

comment on table product_stock is 'Stock courant des produits finis (une ligne par produit, comme fuel_tank)';

insert into product_stock (product_name, current_stock)
values ('B8', 0), ('B12', 0)
on conflict (product_name) do nothing;

alter table product_stock enable row level security;

create policy "Lecture publique stock produits"
  on product_stock for select
  using (true);

create policy "Mise à jour stock produits"
  on product_stock for update
  using (true)
  with check (true);
-- Pas de policy insert/delete : les 2 lignes (B8/B12) sont créées une seule
-- fois ci-dessus, comme fuel_tank.

alter publication supabase_realtime add table product_stock;

create table if not exists stock_movements (
  id uuid primary key default gen_random_uuid(),
  entry_date date not null default current_date,
  entry_time time,
  product_name text not null check (product_name in ('B8', 'B12')),
  movement_type text not null check (movement_type in ('Production', 'Vente', 'Ajustement')),
  quantity numeric(12, 2) not null,
  stock_after numeric(12, 2) not null,
  reference text,
  observations text,
  entered_by_user text,
  created_at timestamptz not null default now()
);

comment on table stock_movements is 'Journal des mouvements de stock produits finis : Production/Ajustement saisis manuellement, Vente générée automatiquement depuis invoices';
comment on column stock_movements.quantity is 'Signé : positif = entrée en stock (production, retour), négatif = sortie (vente)';

create index if not exists stock_movements_created_at_idx on stock_movements (created_at desc);
create index if not exists stock_movements_product_name_idx on stock_movements (product_name);
create index if not exists stock_movements_entry_date_idx on stock_movements (entry_date);

alter table stock_movements enable row level security;

create policy "Lecture publique mouvements stock"
  on stock_movements for select
  using (true);

create policy "Ajout mouvements stock"
  on stock_movements for insert
  with check (true);
-- Pas de policy update/delete volontairement : c'est un journal immuable.
-- Une correction se fait via un nouveau mouvement de type 'Ajustement'
-- (positif ou négatif), jamais en modifiant l'historique.

alter publication supabase_realtime add table stock_movements;

-- Seuil de notification "stock bas", configurable sans redéployer de code :
--   update app_settings set value = '15' where key = 'stock_low_threshold_percent';
insert into app_settings (key, value)
values ('stock_low_threshold_percent', '10')
on conflict (key) do nothing;

-- Applique atomiquement tout INSERT dans stock_movements à product_stock.current_stock
-- (calcule stock_after avant écriture), quelle que soit l'origine de la ligne
-- (saisie manuelle Production/Ajustement, ou Vente générée depuis invoices) --
-- même principe que fuel_apply_delta pour fuel_entries/fuel_tank. Envoie aussi
-- une notification ntfy au passage sous le seuil bas (pas à chaque écriture
-- tant qu'on reste sous le seuil, pour éviter le spam).
create or replace function stock_movements_apply()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_before numeric(12, 2);
  v_after numeric(12, 2);
  v_max numeric(12, 2);
  v_threshold_pct numeric;
  v_topic text;
begin
  select current_stock, max_capacity into v_before, v_max
  from product_stock
  where product_name = NEW.product_name
  for update;

  if v_before is null then
    raise exception 'Produit inconnu dans product_stock : %', NEW.product_name;
  end if;

  v_after := v_before + NEW.quantity;

  update product_stock
  set current_stock = v_after, updated_at = now()
  where product_name = NEW.product_name;

  NEW.stock_after := v_after;

  select value::numeric into v_threshold_pct from app_settings where key = 'stock_low_threshold_percent';
  v_threshold_pct := coalesce(v_threshold_pct, 10);

  if v_max is not null and v_max > 0
     and v_after < v_max * (v_threshold_pct / 100)
     and v_before >= v_max * (v_threshold_pct / 100)
  then
    select value into v_topic from app_settings where key = 'ntfy_topic';
    if v_topic is not null then
      perform net.http_post(
        url := 'https://ntfy.sh',
        body := jsonb_build_object(
          'topic', v_topic,
          'title', 'Stock bas',
          'message', 'Stock ' || NEW.product_name || ' bas : ' || v_after || ' (seuil ' || v_threshold_pct || '% de ' || v_max || ')',
          'tags', jsonb_build_array('warning'),
          'priority', 4
        )
      );
    end if;
  end if;

  return NEW;
end;
$$;

drop trigger if exists stock_movements_before_insert on stock_movements;

create trigger stock_movements_before_insert
  before insert on stock_movements
  for each row execute function stock_movements_apply();

-- Génère les mouvements 'Vente' depuis invoices : à l'insertion, à la
-- modification (seulement sur la variation de quantité vendue -- pas de
-- mouvement si la facture est modifiée sans toucher qty_b8/qty_b12) et à la
-- suppression (reversion complète), comme le trigger carburant.
create or replace function sync_stock_from_invoice()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_old_b8 numeric(12, 2) := 0;
  v_old_b12 numeric(12, 2) := 0;
  v_new_b8 numeric(12, 2) := 0;
  v_new_b12 numeric(12, 2) := 0;
  v_ref text;
  v_date date;
  v_time time;
begin
  if TG_OP = 'UPDATE' or TG_OP = 'DELETE' then
    v_old_b8 := OLD.qty_b8;
    v_old_b12 := OLD.qty_b12;
  end if;

  if TG_OP = 'INSERT' or TG_OP = 'UPDATE' then
    v_new_b8 := NEW.qty_b8;
    v_new_b12 := NEW.qty_b12;
    v_ref := NEW.invoice_number;
    v_date := NEW.entry_date;
    v_time := NEW.entry_time;
  else
    v_ref := OLD.invoice_number;
    v_date := OLD.entry_date;
    v_time := OLD.entry_time;
  end if;

  -- quantité en stock = ancienne quantité vendue - nouvelle quantité vendue
  -- (positif si on vend moins qu'avant ou si la facture est supprimée/annulée,
  -- négatif si on vend plus qu'avant ou lors d'une nouvelle facture).
  if v_old_b8 <> v_new_b8 then
    insert into stock_movements (entry_date, entry_time, product_name, movement_type, quantity, stock_after, reference)
    values (v_date, v_time, 'B8', 'Vente', v_old_b8 - v_new_b8, 0, v_ref);
  end if;

  if v_old_b12 <> v_new_b12 then
    insert into stock_movements (entry_date, entry_time, product_name, movement_type, quantity, stock_after, reference)
    values (v_date, v_time, 'B12', 'Vente', v_old_b12 - v_new_b12, 0, v_ref);
  end if;

  return coalesce(NEW, OLD);
end;
$$;

drop trigger if exists invoices_sync_stock on invoices;

create trigger invoices_sync_stock
  after insert or update or delete on invoices
  for each row execute function sync_stock_from_invoice();

-- ============================================================
-- STOCK : colonnes supplémentaires pour reproduire fidèlement la fiche
-- papier "FICHE DE STOCKS PRODUITS FINIS" sur les mouvements de type
-- Production (nulles/à 0 pour les mouvements Vente/Ajustement, qui n'ont
-- pas cette granularité).
-- ============================================================

alter table stock_movements add column if not exists cadence_theorique numeric(10, 2);
alter table stock_movements add column if not exists feuillard numeric(10, 2);
alter table stock_movements add column if not exists stock_start numeric(12, 2) default 0;
alter table stock_movements add column if not exists cadence_reelle numeric(10, 2);
alter table stock_movements add column if not exists consommation numeric(10, 2);
alter table stock_movements add column if not exists stock_final numeric(12, 2);
alter table stock_movements add column if not exists nb_wagon integer default 0;
alter table stock_movements add column if not exists nb_paquet integer default 0;
alter table stock_movements add column if not exists total_wagon integer default 0;
alter table stock_movements add column if not exists total_paquets integer default 0;
alter table stock_movements add column if not exists nb_briques integer default 0;
alter table stock_movements add column if not exists commercial numeric(12, 2) default 0;
alter table stock_movements add column if not exists stocks_fin_journee numeric(12, 2);

comment on column stock_movements.stock_start is 'Report : stock en début de journée (= stock_after de la dernière saisie du même produit)';
comment on column stock_movements.nb_briques is 'Production du jour en nombre de briques -- alimente `quantity` pour ce mouvement (pas de conversion wagon/paquet -> briques automatique)';
comment on column stock_movements.commercial is 'Quantité vendue ce jour pour ce produit, calculée depuis invoices.qty_b8/qty_b12 (entry_date = stock_movements.entry_date)';
comment on column stock_movements.stocks_fin_journee is 'Report + Production (nb_briques) - Commercial, snapshot du jour pour la fiche papier';

-- ============================================================
-- NOUVEAU RÔLE 'maintenance_only' + UTILISATEUR KARIM
-- ============================================================

insert into app_users (username, password_hash, requires_verification, role)
values ('Karim', encode(digest('karim2024', 'sha256'), 'hex'), true, 'maintenance_only')
on conflict (username) do nothing;

-- Note : request_login_code n'a besoin d'aucune modification pour gérer ce
-- nouveau rôle. La fonction ne contient aucune liste de rôles en dur : elle
-- lit et renvoie systématiquement v_user.role tel qu'il est stocké dans
-- app_users, quelle que soit sa valeur ('admin', 'editor', 'viewer',
-- 'maintenance_only', ...). Le contrôle d'accès par page (quels onglets un
-- rôle peut voir) est géré côté application (src/lib/auth.js), pas ici.
-- app_users.role n'a par ailleurs aucune contrainte CHECK limitant ses
-- valeurs possibles, donc 'maintenance_only' est déjà accepté tel quel.

-- ============================================================
-- NORMALISATION DES NOMS DE CLIENTS EN MAJUSCULES : évite les doublons
-- ("Kerdja Mourad" / "KERDJA MOURAD" / "kerdja mourad" doivent toujours
-- correspondre à la même entrée dans `clients`). Appliqué en BEFORE INSERT
-- OR UPDATE sur chaque table où un nom de client est saisi librement, donc
-- valable quel que soit le chemin d'écriture (formulaire, admin_update_*,
-- import, edition directe en base).
-- ============================================================

create or replace function normalize_clients_name()
returns trigger
language plpgsql
as $$
begin
  NEW.name := upper(trim(NEW.name));
  return NEW;
end;
$$;

drop trigger if exists clients_normalize_name on clients;
create trigger clients_normalize_name
  before insert or update on clients
  for each row execute function normalize_clients_name();

create or replace function normalize_invoices_client_name()
returns trigger
language plpgsql
as $$
begin
  if NEW.client_name is not null then
    NEW.client_name := upper(trim(NEW.client_name));
  end if;
  return NEW;
end;
$$;

drop trigger if exists invoices_normalize_client_name on invoices;
create trigger invoices_normalize_client_name
  before insert or update on invoices
  for each row execute function normalize_invoices_client_name();

create or replace function normalize_entries_client_name()
returns trigger
language plpgsql
as $$
begin
  if NEW.client_name is not null then
    NEW.client_name := upper(trim(NEW.client_name));
  end if;
  return NEW;
end;
$$;

drop trigger if exists entries_normalize_client_name on entries;
create trigger entries_normalize_client_name
  before insert or update on entries
  for each row execute function normalize_entries_client_name();

create or replace function normalize_client_advances_name()
returns trigger
language plpgsql
as $$
begin
  if NEW.client_name is not null then
    NEW.client_name := upper(trim(NEW.client_name));
  end if;
  return NEW;
end;
$$;

drop trigger if exists client_advances_normalize_name on client_advances;
create trigger client_advances_normalize_name
  before insert or update on client_advances
  for each row execute function normalize_client_advances_name();

-- Les triggers BEFORE ci-dessus s'exécutent avant invoices_sync_client_balance,
-- invoices_sync_stock et entries_decrement_client_advance (tous des triggers
-- AFTER) : ces derniers voient donc toujours un client_name déjà normalisé.

-- ============================================================
-- sync_stock_from_invoice : copie désormais entered_by_user de la facture
-- (NEW pour insert/update, OLD pour delete) vers le mouvement de stock
-- généré, pour savoir qui est à l'origine de la vente dans le registre
-- des mouvements de stock (jusqu'ici toujours vide sur les lignes 'Vente').
-- ============================================================
create or replace function sync_stock_from_invoice()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_old_b8 numeric(12, 2) := 0;
  v_old_b12 numeric(12, 2) := 0;
  v_new_b8 numeric(12, 2) := 0;
  v_new_b12 numeric(12, 2) := 0;
  v_ref text;
  v_date date;
  v_time time;
  v_user text;
begin
  if TG_OP = 'UPDATE' or TG_OP = 'DELETE' then
    v_old_b8 := OLD.qty_b8;
    v_old_b12 := OLD.qty_b12;
  end if;

  if TG_OP = 'INSERT' or TG_OP = 'UPDATE' then
    v_new_b8 := NEW.qty_b8;
    v_new_b12 := NEW.qty_b12;
    v_ref := NEW.invoice_number;
    v_date := NEW.entry_date;
    v_time := NEW.entry_time;
    v_user := NEW.entered_by_user;
  else
    v_ref := OLD.invoice_number;
    v_date := OLD.entry_date;
    v_time := OLD.entry_time;
    v_user := OLD.entered_by_user;
  end if;

  -- quantité en stock = ancienne quantité vendue - nouvelle quantité vendue
  -- (positif si on vend moins qu'avant ou si la facture est supprimée/annulée,
  -- négatif si on vend plus qu'avant ou lors d'une nouvelle facture).
  if v_old_b8 <> v_new_b8 then
    insert into stock_movements (entry_date, entry_time, product_name, movement_type, quantity, stock_after, reference, entered_by_user)
    values (v_date, v_time, 'B8', 'Vente', v_old_b8 - v_new_b8, 0, v_ref, v_user);
  end if;

  if v_old_b12 <> v_new_b12 then
    insert into stock_movements (entry_date, entry_time, product_name, movement_type, quantity, stock_after, reference, entered_by_user)
    values (v_date, v_time, 'B12', 'Vente', v_old_b12 - v_new_b12, 0, v_ref, v_user);
  end if;

  return coalesce(NEW, OLD);
end;
$$;
-- Le trigger invoices_sync_stock existant reste valide (create or replace
-- ne modifie pas le trigger déjà rattaché à la fonction).

-- ============================================================
-- FACTURES : colonnes fiscales (TVA/TTC/Timbre/Total net), nécessaires à
-- la déclaration G50 et à l'onglet d'import G50 (import du relevé mensuel
-- des factures + rapprochement des règlements BANQUE/ESPECE).
--
-- `amount_override` : les factures importées depuis G50 n'ont pas de
-- détail par produit (juste un Total HT global), donc qty_b8/qty_b12/qty_h
-- restent à 0 pour ne pas fausser le stock physique (trigger
-- sync_stock_from_invoice, qui ne réagit qu'aux variations de qty_b8/qty_b12).
-- `amount_override`, quand renseigné, remplace le calcul qty*price pour
-- `amount`/`total`/`balance`/`total_tva`/`total_ttc`/`total_net` -- NULL
-- pour la saisie normale (produit détaillé), qui garde le calcul qty*price
-- inchangé.
-- ============================================================

alter table invoices add column if not exists amount_override numeric(12, 2);
comment on column invoices.amount_override is 'Montant HT explicite (ex: import G50, sans détail produit) ; remplace qty*price pour amount/total/balance/total_tva/total_ttc/total_net quand renseigné. NULL pour la saisie normale.';

-- 1) Colonnes générées à supprimer avant de toucher à leur formule, dans
--    l'ordre inverse de dépendance (une colonne générée ne peut pas
--    référencer une autre colonne générée en Postgres -- la formule
--    complète qty*price est donc dupliquée dans chacune, comme déjà fait
--    plus haut pour amount/total/balance).
alter table invoices drop column if exists balance;
alter table invoices drop column if exists total;
alter table invoices drop column if exists amount;

alter table invoices add column if not exists amount numeric(12, 2)
  generated always as (
    coalesce(amount_override, qty_b8 * price_b8 + qty_b12 * price_b12 + qty_h * price_h)
  ) stored;

alter table invoices add column if not exists total numeric(12, 2)
  generated always as (
    coalesce(amount_override, qty_b8 * price_b8 + qty_b12 * price_b12 + qty_h * price_h) - discount_amount
  ) stored;

alter table invoices add column if not exists balance numeric(12, 2)
  generated always as (
    coalesce(amount_override, qty_b8 * price_b8 + qty_b12 * price_b12 + qty_h * price_h) - discount_amount - settlement
  ) stored;

comment on column invoices.balance is 'Total - Règlement ; positif = client débiteur sur cette facture';

-- 2) Timbre (saisissable, 0 par défaut) puis TVA/TTC/Total net (calculés).
alter table invoices add column if not exists stamp_duty numeric(10, 2) not null default 0;

alter table invoices add column if not exists total_tva numeric(12, 2)
  generated always as (
    (coalesce(amount_override, qty_b8 * price_b8 + qty_b12 * price_b12 + qty_h * price_h) - discount_amount) * 0.19
  ) stored;

alter table invoices add column if not exists total_ttc numeric(12, 2)
  generated always as (
    (coalesce(amount_override, qty_b8 * price_b8 + qty_b12 * price_b12 + qty_h * price_h) - discount_amount) * 1.19
  ) stored;

alter table invoices add column if not exists total_net numeric(12, 2)
  generated always as (
    (coalesce(amount_override, qty_b8 * price_b8 + qty_b12 * price_b12 + qty_h * price_h) - discount_amount) * 1.19
    + stamp_duty
  ) stored;

comment on column invoices.total_tva is 'TVA = (Total HT - Remise) * 0.19, calculée automatiquement (Total HT = amount_override si renseigné, sinon qty*price)';
comment on column invoices.total_ttc is 'TTC = (Total HT - Remise) * 1.19, calculé automatiquement';
comment on column invoices.total_net is 'Net à payer = TTC + Timbre, calculé automatiquement';

-- 3) admin_update_invoice : nouvelle signature (+ p_stamp_duty, +
--    p_amount_override). L'ancienne fonction est supprimée explicitement
--    car la liste de paramètres change.
drop function if exists admin_update_invoice(uuid, text, text, date, text, text, text, text, numeric, numeric, numeric, numeric, numeric, numeric, numeric, numeric, numeric, text, text, text, text, text, text, text, text, text);

create or replace function admin_update_invoice(
  p_id uuid,
  p_admin_code text,
  p_invoice_number text,
  p_entry_date date,
  p_client_name text,
  p_designation text,
  p_designation_other text,
  p_bl_number text,
  p_qty_b8 numeric,
  p_qty_b12 numeric,
  p_qty_h numeric,
  p_price_b8 numeric,
  p_price_b12 numeric,
  p_price_h numeric,
  p_amount_override numeric,
  p_discount_amount numeric,
  p_settlement numeric,
  p_disbursement numeric,
  p_stamp_duty numeric,
  p_driver_name text,
  p_truck_plate text,
  p_payment_type text,
  p_payment_status text,
  p_cheque_number text,
  p_cheque_bank text,
  p_ref_commande text,
  p_ref_livraison text,
  p_observations text
)
returns invoices
language plpgsql
security definer
set search_path = public
as $$
declare
  v_code text;
  v_result invoices;
begin
  select value into v_code from app_settings where key = 'admin_code';
  if v_code is null or p_admin_code <> v_code then
    raise exception 'Code administrateur invalide';
  end if;

  update invoices set
    invoice_number = p_invoice_number,
    entry_date = p_entry_date,
    client_name = p_client_name,
    designation = p_designation,
    designation_other = p_designation_other,
    bl_number = p_bl_number,
    qty_b8 = p_qty_b8,
    qty_b12 = p_qty_b12,
    qty_h = p_qty_h,
    price_b8 = p_price_b8,
    price_b12 = p_price_b12,
    price_h = p_price_h,
    amount_override = p_amount_override,
    discount_amount = p_discount_amount,
    settlement = p_settlement,
    disbursement = p_disbursement,
    stamp_duty = p_stamp_duty,
    driver_name = p_driver_name,
    truck_plate = p_truck_plate,
    payment_type = p_payment_type,
    payment_status = p_payment_status,
    cheque_number = p_cheque_number,
    cheque_bank = p_cheque_bank,
    ref_commande = p_ref_commande,
    ref_livraison = p_ref_livraison,
    observations = p_observations
  where id = p_id
  returning * into v_result;

  if v_result.id is null then
    raise exception 'Facture introuvable';
  end if;

  return v_result;
end;
$$;

revoke all on function admin_update_invoice(uuid, text, text, date, text, text, text, text, numeric, numeric, numeric, numeric, numeric, numeric, numeric, numeric, numeric, numeric, numeric, text, text, text, text, text, text, text, text, text) from public;
grant execute on function admin_update_invoice(uuid, text, text, date, text, text, text, text, numeric, numeric, numeric, numeric, numeric, numeric, numeric, numeric, numeric, numeric, numeric, text, text, text, text, text, text, text, text, text) to anon, authenticated;

-- 4) sync_client_balance_from_invoice : utilise désormais `total_net`
--    (TTC + Timbre) au lieu de `total` (HT - Remise, sans taxe) -- les
--    règlements réels (BANQUE/ESPECE du G50) correspondent exactement au
--    total_net de la facture, pas au total hors-taxe. Ce changement ne
--    s'applique qu'aux écritures FUTURES (insert/update/delete sur
--    invoices) : les soldes déjà accumulés avant cette migration ne sont
--    pas recalculés rétroactivement.
create or replace function sync_client_balance_from_invoice()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_old_client_id uuid;
  v_new_client_id uuid;
begin
  if TG_OP = 'UPDATE' or TG_OP = 'DELETE' then
    select id into v_old_client_id from clients where lower(name) = lower(OLD.client_name) limit 1;
    if v_old_client_id is not null then
      update clients set
        total_invoiced = total_invoiced - OLD.total_net,
        total_paid = total_paid - case when OLD.payment_status is distinct from 'Non payé' then OLD.total_net else 0 end,
        updated_at = now()
      where id = v_old_client_id;
    end if;
  end if;

  if TG_OP = 'INSERT' or TG_OP = 'UPDATE' then
    select id into v_new_client_id from clients where lower(name) = lower(NEW.client_name) limit 1;
    if v_new_client_id is not null then
      update clients set
        total_invoiced = total_invoiced + NEW.total_net,
        total_paid = total_paid + case when NEW.payment_status is distinct from 'Non payé' then NEW.total_net else 0 end,
        updated_at = now()
      where id = v_new_client_id;
    end if;
  end if;

  update clients set balance = total_invoiced - total_paid
  where id = v_old_client_id or id = v_new_client_id;

  return coalesce(NEW, OLD);
end;
$$;
-- Le trigger invoices_sync_client_balance existant reste valide (create or
-- replace ne modifie pas le trigger déjà rattaché à la fonction).

-- ============================================================
-- FACTURES : "Type de paiement (N/B)" (payment_type) devient un champ
-- libre avec autocomplétion côté interface (au lieu d'un select limité à
-- 'A TERME' / 'COMPTANT' / 'AVANCE') -- la contrainte CHECK qui limitait
-- les valeurs possibles en base est donc supprimée. La colonne reste NOT
-- NULL DEFAULT 'A TERME'.
-- ============================================================

alter table invoices drop constraint if exists invoices_payment_type_check;

-- ============================================================
-- CLIENTS : coordonnées + code client, importés depuis "fiche client.xls"
-- (onglet "A", 735 clients) via scripts/import-fiche-clients.js.
-- `client_code` est le code historique du client (ex: "470001"), unique,
-- utilisé pour la recherche client dans l'app en plus du nom.
-- ============================================================

alter table clients add column if not exists client_code text unique;
alter table clients add column if not exists phone text;
alter table clients add column if not exists fax text;
alter table clients add column if not exists mobile text;
alter table clients add column if not exists email text;
alter table clients add column if not exists city text;

comment on column clients.client_code is 'Code client historique (ex: "470001"), unique, importé depuis fiche client.xls';

-- ============================================================
-- RÉCUPÉRATION TVA : registre des factures fournisseurs/achats servant à la
-- récupération de TVA (déclaration G50), onglet "TVA" (Saisie / Registre /
-- Import). Reprend le format du fichier "TABLEAU DE RECUPERATION TVA
-- 2026.xlsx" (N° FACT, DATE, FOURNISSEUR, ADRESSE, NIF, NIS, ARTICLE, RC,
-- TEL, TOTAL HT, REMISE, HT NET, TVA, DD, TOTAL TTC, TIMBRE, TOTAL NET,
-- MODE DE PAIEMENT, PIECE DE REGLEMENT, PHOTO).
--
-- `tva_amount` n'est PAS une colonne générée : elle est pré-calculée côté
-- client (HT Net * 0.19) mais reste saisissable/modifiable (cas des
-- quittances douane, où la TVA ne suit pas ce taux). `total_ttc` et
-- `total_net` référencent directement total_ht/discount_amount/tva_amount/
-- stamp_duty (jamais une autre colonne générée), ce qui reste valide en
-- Postgres (seule la référence à une AUTRE colonne générée est interdite) :
-- elles se recalculent donc correctement dès que tva_amount est modifié à
-- la main. `dd_amount` (droits de douane) est purement informatif, exclu
-- du calcul du TTC.
-- ============================================================

create table if not exists tva_entries (
  id uuid primary key default gen_random_uuid(),
  invoice_number text not null unique,
  piece_number text,
  entry_date date not null default current_date,
  entry_time time,
  recovery_month integer not null check (recovery_month between 1 and 12),
  recovery_year integer not null,
  supplier_name text not null,
  supplier_address text,
  nif text,
  nis text,
  article text,
  rc_number text,
  phone text,
  total_ht numeric(12, 2) not null,
  discount_amount numeric(10, 2) not null default 0,
  ht_net numeric(12, 2) generated always as (total_ht - discount_amount) stored,
  tva_amount numeric(12, 2) not null default 0,
  dd_amount numeric(10, 2) not null default 0,
  total_ttc numeric(12, 2) generated always as (total_ht - discount_amount + tva_amount) stored,
  stamp_duty numeric(10, 2) not null default 0,
  total_net numeric(12, 2) generated always as (total_ht - discount_amount + tva_amount + stamp_duty) stored,
  payment_mode text not null default 'Non payé'
    check (payment_mode in ('Espèces', 'Chèque', 'Versement', 'Virement', 'Non payé')),
  cheque_number text,
  cheque_bank text,
  payment_piece text,
  photo_url text,
  observations text,
  entered_by_user text,
  created_at timestamptz not null default now()
);

comment on table tva_entries is 'Registre des factures fournisseurs pour la récupération de TVA (déclaration G50)';
comment on column tva_entries.dd_amount is 'Droits de douane, informatif, exclu du calcul du TTC';
comment on column tva_entries.tva_amount is 'Pré-calculé côté client (HT Net * 0.19), mais librement modifiable (ex: quittances douane)';
comment on column tva_entries.recovery_month is 'Mois de récupération TVA (déclaration G50), 1-12';

create index if not exists tva_entries_created_at_idx on tva_entries (created_at desc);
create index if not exists tva_entries_supplier_name_idx on tva_entries (supplier_name);
create index if not exists tva_entries_invoice_number_idx on tva_entries (invoice_number);
create index if not exists tva_entries_entry_date_idx on tva_entries (entry_date desc);
create index if not exists tva_entries_recovery_period_idx on tva_entries (recovery_year, recovery_month);

alter table tva_entries enable row level security;

create policy "Lecture publique TVA"
  on tva_entries for select
  using (true);

create policy "Ajout TVA"
  on tva_entries for insert
  with check (true);

create policy "Modification TVA"
  on tva_entries for update
  using (created_at > now() - interval '72 hours')
  with check (created_at > now() - interval '72 hours');

create policy "Suppression TVA"
  on tva_entries for delete
  using (created_at > now() - interval '72 hours');

alter publication supabase_realtime add table tva_entries;

-- Storage : bucket public pour les photos de factures TVA
insert into storage.buckets (id, name, public)
values ('tva-photos', 'tva-photos', true)
on conflict (id) do nothing;

create policy "Lecture publique photos TVA"
  on storage.objects for select
  using (bucket_id = 'tva-photos');

create policy "Ajout photos TVA"
  on storage.objects for insert
  with check (bucket_id = 'tva-photos');

create policy "Suppression photos TVA"
  on storage.objects for delete
  using (bucket_id = 'tva-photos');

-- Code admin (même principe que admin_update_invoice/admin_delete_invoice
-- plus haut) : permet de modifier/supprimer une entrée TVA après le
-- verrou de 72h.
create or replace function admin_update_tva(
  p_id uuid,
  p_admin_code text,
  p_invoice_number text,
  p_piece_number text,
  p_entry_date date,
  p_recovery_month integer,
  p_recovery_year integer,
  p_supplier_name text,
  p_supplier_address text,
  p_nif text,
  p_nis text,
  p_article text,
  p_rc_number text,
  p_phone text,
  p_total_ht numeric,
  p_discount_amount numeric,
  p_tva_amount numeric,
  p_dd_amount numeric,
  p_stamp_duty numeric,
  p_payment_mode text,
  p_cheque_number text,
  p_cheque_bank text,
  p_payment_piece text,
  p_observations text
)
returns tva_entries
language plpgsql
security definer
set search_path = public
as $$
declare
  v_code text;
  v_result tva_entries;
begin
  select value into v_code from app_settings where key = 'admin_code';
  if v_code is null or p_admin_code <> v_code then
    raise exception 'Code administrateur invalide';
  end if;

  update tva_entries set
    invoice_number = p_invoice_number,
    piece_number = p_piece_number,
    entry_date = p_entry_date,
    recovery_month = p_recovery_month,
    recovery_year = p_recovery_year,
    supplier_name = p_supplier_name,
    supplier_address = p_supplier_address,
    nif = p_nif,
    nis = p_nis,
    article = p_article,
    rc_number = p_rc_number,
    phone = p_phone,
    total_ht = p_total_ht,
    discount_amount = p_discount_amount,
    tva_amount = p_tva_amount,
    dd_amount = p_dd_amount,
    stamp_duty = p_stamp_duty,
    payment_mode = p_payment_mode,
    cheque_number = p_cheque_number,
    cheque_bank = p_cheque_bank,
    payment_piece = p_payment_piece,
    observations = p_observations
  where id = p_id
  returning * into v_result;

  if v_result.id is null then
    raise exception 'Entrée TVA introuvable';
  end if;

  return v_result;
end;
$$;

create or replace function admin_delete_tva(p_id uuid, p_admin_code text)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_code text;
begin
  select value into v_code from app_settings where key = 'admin_code';
  if v_code is null or p_admin_code <> v_code then
    raise exception 'Code administrateur invalide';
  end if;

  delete from tva_entries where id = p_id;
end;
$$;

revoke all on function admin_update_tva(uuid, text, text, text, date, integer, integer, text, text, text, text, text, text, text, numeric, numeric, numeric, numeric, numeric, text, text, text, text, text) from public;
revoke all on function admin_delete_tva(uuid, text) from public;
grant execute on function admin_update_tva(uuid, text, text, text, date, integer, integer, text, text, text, text, text, text, text, numeric, numeric, numeric, numeric, numeric, text, text, text, text, text) to anon, authenticated;
grant execute on function admin_delete_tva(uuid, text) to anon, authenticated;

-- ============================================================
-- RÉCUPÉRATION TVA : retour terrain -- Total HT et mois de récupération
-- peuvent rester vides (quittances douane sans montant HT ; saisie sans
-- déclaration G50 encore assignée, à compléter plus tard depuis le
-- registre). `ht_net`/`total_ttc`/`total_net` ne peuvent alors plus être
-- des colonnes GENERATED (leur formule doit traiter total_ht NULL comme 0
-- via COALESCE, ce qu'une expression générée ne fait pas naturellement
-- mieux qu'un trigger) : elles deviennent des colonnes normales, tenues à
-- jour par un trigger BEFORE INSERT/UPDATE (même principe que
-- fuel_apply_delta plus haut).
-- ============================================================

alter table tva_entries alter column recovery_month drop not null;
alter table tva_entries alter column recovery_year drop not null;
alter table tva_entries alter column total_ht drop not null;

alter table tva_entries drop column if exists ht_net;
alter table tva_entries drop column if exists total_ttc;
alter table tva_entries drop column if exists total_net;

alter table tva_entries add column if not exists ht_net numeric(12, 2);
alter table tva_entries add column if not exists total_ttc numeric(12, 2);
alter table tva_entries add column if not exists total_net numeric(12, 2);

comment on column tva_entries.total_ht is 'Total HT, NULL pour les quittances douane (pas de montant HT, seule la TVA douanière est saisie)';
comment on column tva_entries.recovery_month is 'Mois de récupération TVA (déclaration G50), optionnel -- peut être complété plus tard depuis le registre';
comment on column tva_entries.recovery_year is 'Année de récupération TVA, optionnel -- voir recovery_month';
comment on column tva_entries.ht_net is 'HT Net = COALESCE(Total HT, 0) - Remise, tenu à jour par le trigger tva_apply_calculations';
comment on column tva_entries.total_ttc is 'TTC = HT Net + TVA, tenu à jour par le trigger tva_apply_calculations';
comment on column tva_entries.total_net is 'Total Net = TTC + Timbre, tenu à jour par le trigger tva_apply_calculations';

create or replace function tva_apply_calculations()
returns trigger
language plpgsql
as $$
begin
  NEW.ht_net := coalesce(NEW.total_ht, 0) - coalesce(NEW.discount_amount, 0);
  NEW.total_ttc := NEW.ht_net + coalesce(NEW.tva_amount, 0);
  NEW.total_net := NEW.total_ttc + coalesce(NEW.stamp_duty, 0);
  return NEW;
end;
$$;

drop trigger if exists tva_entries_before_insert on tva_entries;
create trigger tva_entries_before_insert
  before insert on tva_entries
  for each row execute function tva_apply_calculations();

drop trigger if exists tva_entries_before_update on tva_entries;
create trigger tva_entries_before_update
  before update on tva_entries
  for each row execute function tva_apply_calculations();

-- Recalcule ht_net/total_ttc/total_net pour les lignes déjà saisies avant
-- cette migration (déclenche le trigger BEFORE UPDATE ci-dessus via une
-- modification sans effet sur entry_date).
update tva_entries set entry_date = entry_date;

-- ============================================================
-- CHANGEMENT DE MOT DE PASSE : demande + validation par l'admin (même
-- principe que request_login_code/verify_login_code, table
-- verification_codes réutilisée avec une colonne new_password_hash pour ne
-- pas dupliquer le mécanisme). Contrairement au code de connexion
-- hebdomadaire, la demande de changement de mot de passe déclenche
-- SYSTÉMATIQUEMENT une notification + un code, quel que soit le jour.
-- ============================================================

alter table verification_codes add column if not exists new_password_hash text;

comment on column verification_codes.new_password_hash is 'Renseigné uniquement pour une demande de changement de mot de passe (NULL pour un code de connexion) ; appliqué à app_users.password_hash par confirm_password_change une fois le code validé';

-- Étape 1 : génère un code, stocke le hash du nouveau mot de passe (jamais
-- appliqué tant que le code n'est pas validé) et envoie la notif à l'admin
-- avec le mot de passe EN CLAIR (p_new_password_plain, distinct du hash
-- p_new_password_hash) pour qu'il puisse le lire et le transmettre à
-- l'utilisateur -- ce mot de passe en clair ne quitte la base que par cette
-- notification, il n'est stocké nulle part (seul le hash l'est).
create or replace function request_password_change(
  p_username text,
  p_new_password_hash text,
  p_new_password_plain text
)
returns json
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user app_users%rowtype;
  v_code text;
  v_topic text;
begin
  select * into v_user from app_users where username = p_username;

  if v_user.id is null then
    return json_build_object('success', false, 'message', 'Utilisateur introuvable');
  end if;

  v_code := lpad(floor(random() * 1000000)::text, 6, '0');

  insert into verification_codes (username, code, expires_at, new_password_hash)
  values (p_username, v_code, now() + interval '5 minutes', p_new_password_hash);

  select value into v_topic from app_settings where key = 'ntfy_auth_topic';

  if v_topic is not null then
    perform net.http_post(
      url := 'https://ntfy.sh',
      body := jsonb_build_object(
        'topic', v_topic,
        'title', 'Demande de changement de mot de passe',
        'message',
          'Utilisateur : ' || p_username ||
          E'\nNouveau mot de passe : ' || p_new_password_plain ||
          E'\nCode de validation : ' || v_code,
        'tags', jsonb_build_array('closed_lock_with_key'),
        'priority', 5
      )
    );
  end if;

  return json_build_object('success', true, 'message', 'Code envoyé à l''administrateur');
end;
$$;

-- Étape 2 : valide le code et applique le nouveau mot de passe. Le filtre
-- `new_password_hash is not null` garantit qu'on ne peut jamais consommer
-- ici un code de CONNEXION (verify_login_code) par erreur -- les deux flux
-- partagent la même table mais restent étanches l'un à l'autre.
create or replace function confirm_password_change(p_username text, p_code text)
returns json
language plpgsql
security definer
set search_path = public
as $$
declare
  v_row verification_codes%rowtype;
begin
  select * into v_row
  from verification_codes
  where username = p_username
    and code = p_code
    and used = false
    and expires_at > now()
    and new_password_hash is not null
  order by created_at desc
  limit 1;

  if v_row.id is null then
    return json_build_object('success', false, 'message', 'Code incorrect ou expiré');
  end if;

  update verification_codes set used = true where id = v_row.id;

  update app_users set password_hash = v_row.new_password_hash where username = p_username;

  return json_build_object('success', true, 'message', 'Mot de passe mis à jour');
end;
$$;

-- verify_login_code : exclut désormais symétriquement les codes de
-- changement de mot de passe (new_password_hash is null), pour la même
-- raison d'étanchéité entre les deux flux.
create or replace function verify_login_code(p_username text, p_code text)
returns json
language plpgsql
security definer
set search_path = public
as $$
declare
  v_row verification_codes%rowtype;
begin
  select * into v_row
  from verification_codes
  where username = p_username
    and code = p_code
    and used = false
    and expires_at > now()
    and new_password_hash is null
  order by created_at desc
  limit 1;

  if v_row.id is null then
    return json_build_object('success', false, 'message', 'Code incorrect ou expiré');
  end if;

  update verification_codes set used = true where id = v_row.id;

  return json_build_object('success', true, 'message', 'Connecté');
end;
$$;

revoke all on function request_password_change(text, text, text) from public;
revoke all on function confirm_password_change(text, text) from public;
grant execute on function request_password_change(text, text, text) to anon, authenticated;
grant execute on function confirm_password_change(text, text) to anon, authenticated;

-- ============================================================
-- MOTS DE PASSE : renouvellement (comptes existants). Ahcene et Massilva
-- gardent leur code numérique existant (727805), les autres comptes
-- passent à un mot de passe au format Nom@DPR2024!.
-- ============================================================

update app_users set password_hash = encode(digest('Halim@DPR2024!', 'sha256'), 'hex') where username = 'Halim';
update app_users set password_hash = encode(digest('Bureau@DPR2024!', 'sha256'), 'hex') where username = 'Bureau';
update app_users set password_hash = encode(digest('Bilal@DPR2024!', 'sha256'), 'hex') where username = 'Bilal';
update app_users set password_hash = encode(digest('Karim@DPR2024!', 'sha256'), 'hex') where username = 'Karim';
update app_users set password_hash = encode(digest('727805', 'sha256'), 'hex') where username in ('Ahcene', 'Massilva');

-- ============================================================
-- NOUVEAUX UTILISATEURS TVA : AVADOU et Tahar, rôle 'tva_only' -- accès
-- exclusif aux pages TVA récupération + TVA à payer (voir ROLE_TABS dans
-- src/lib/auth.js), avec code de vérification ntfy comme Halim/Bureau/Bilal.
-- ============================================================

insert into app_users (username, password_hash, requires_verification, role) values
  ('AVADOU', encode(digest('Avadou@DPR2024!', 'sha256'), 'hex'), true, 'tva_only'),
  ('Tahar', encode(digest('Tahar@DPR2024!', 'sha256'), 'hex'), true, 'tva_only')
on conflict (username) do nothing;

-- ============================================================
-- TVA PAR ENTITÉ : "Briqueterie" (DPR AXXAM, gérée par Halim) et "AVADOU"
-- (gérée par AVADOU) ont chacune leur propre comptabilité TVA. Halim et
-- AVADOU sont cloisonnés sur leur entité ; Tahar et les admins voient/
-- saisissent pour les deux (sélecteur côté interface, voir TVAPage.jsx /
-- TVAPayerPage.jsx).
--
-- NOTE : `tva_payer_entries` n'a jamais été ajoutée à ce fichier schema.sql
-- (créée directement en base à un moment non documenté ici) -- seul l'ALTER
-- ci-dessous est donc fourni pour cette table, pas son CREATE TABLE.
-- ============================================================

alter table tva_entries add column if not exists entity text not null default 'Briqueterie'
  check (entity in ('Briqueterie', 'AVADOU'));
alter table tva_payer_entries add column if not exists entity text not null default 'Briqueterie'
  check (entity in ('Briqueterie', 'AVADOU'));

create index if not exists tva_entries_entity_idx on tva_entries (entity);
create index if not exists tva_payer_entries_entity_idx on tva_payer_entries (entity);

comment on column tva_entries.entity is 'Entité comptable TVA : Briqueterie (DPR AXXAM) ou AVADOU';
comment on column tva_payer_entries.entity is 'Entité comptable TVA : Briqueterie (DPR AXXAM) ou AVADOU';

-- request_login_code renvoie désormais aussi l'entité TVA par défaut de
-- l'utilisateur : 'Briqueterie' pour Halim, 'AVADOU' pour AVADOU, NULL pour
-- tous les autres (Tahar/admins : pas de restriction, choix libre côté
-- interface ; Bureau/Bilal/Karim : sans objet, ces rôles n'ont de toute
-- façon pas accès aux pages TVA -- voir ROLE_TABS dans src/lib/auth.js).
create or replace function request_login_code(p_username text, p_password_hash text)
returns json
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user app_users%rowtype;
  v_code text;
  v_topic text;
  v_dow int;
  v_entity text;
begin
  select * into v_user from app_users where username = p_username;

  if v_user.id is null or v_user.password_hash <> p_password_hash then
    return json_build_object('success', false, 'requires_verification', false, 'message', 'Identifiants invalides');
  end if;

  v_entity := case
    when p_username = 'Halim' then 'Briqueterie'
    when p_username = 'AVADOU' then 'AVADOU'
    else null
  end;

  if not v_user.requires_verification then
    return json_build_object('success', true, 'requires_verification', false, 'role', v_user.role, 'entity', v_entity, 'message', 'Connecté');
  end if;

  -- Jour de la semaine en Algérie (0 = dimanche ... 5 = vendredi, 6 = samedi).
  v_dow := extract(dow from (now() at time zone 'Africa/Algiers'));

  if v_dow = 5 then
    return json_build_object('success', false, 'requires_verification', false, 'message', 'Jour de repos — accès indisponible');
  end if;

  if v_dow <> 6 then
    -- Dimanche à jeudi : mot de passe seul suffit, pas de code.
    return json_build_object('success', true, 'requires_verification', false, 'role', v_user.role, 'entity', v_entity, 'message', 'Connecté');
  end if;

  -- Samedi : code de vérification requis.
  v_code := lpad(floor(random() * 1000000)::text, 6, '0');

  insert into verification_codes (username, code, expires_at)
  values (p_username, v_code, now() + interval '5 minutes');

  select value into v_topic from app_settings where key = 'ntfy_auth_topic';

  if v_topic is not null then
    perform net.http_post(
      url := 'https://ntfy.sh',
      body := jsonb_build_object(
        'topic', v_topic,
        'title', 'Code de connexion',
        'message', 'Code de connexion : ' || v_code || ' — Demandé par : ' || p_username,
        'tags', jsonb_build_array('closed_lock_with_key'),
        'priority', 5
      )
    );
  end if;

  return json_build_object('success', true, 'requires_verification', true, 'role', v_user.role, 'entity', v_entity, 'message', 'Code envoyé à l''administrateur');
end;
$$;
-- Le grant execute existant sur request_login_code(text, text) reste valide
-- (create or replace ne modifie pas les privilèges déjà accordés).


-- ============================================================
-- CAISSE : registre de caisse (encaissements / décaissements / dépenses)
-- + solde courant. Onglet "Caisse" (9e onglet), réservé aux rôles admin,
-- editor et youcef_role (voir ROLE_TABS dans src/lib/auth.js).
-- ============================================================

create table if not exists caisse_entries (
  id uuid primary key default gen_random_uuid(),
  bon_number integer not null unique,
  entry_date date not null default current_date,
  entry_time time,
  operation_type text not null
    check (operation_type in ('Encaissement', 'Décaissement', 'Dépense')),
  description text not null,
  amount numeric(12, 2) not null,
  beneficiary text,
  client_name text,
  payment_mode text default 'Espèces'
    check (payment_mode in ('Espèces', 'Chèque', 'Versement', 'Virement')),
  cheque_number text,
  cheque_bank text,
  piece_number text,
  photo_url text,
  category text default 'Autre'
    check (category in ('Fournisseur', 'Client', 'Salaire', 'Carburant', 'Maintenance', 'Frais généraux', 'Autre')),
  category_other text,
  observations text,
  entered_by_user text,
  created_at timestamptz not null default now()
);

comment on table caisse_entries is 'Registre de caisse : encaissements (entrée), décaissements et dépenses (sortie)';
comment on column caisse_entries.amount is 'Montant en valeur absolue (DA) ; le signe est déduit de operation_type côté application';
comment on column caisse_entries.beneficiary is 'Fournisseur / bénéficiaire : la personne qui reçoit ou donne l''argent';

create index if not exists caisse_entries_created_at_idx on caisse_entries (created_at desc);
create index if not exists caisse_entries_entry_date_idx on caisse_entries (entry_date desc);
create index if not exists caisse_entries_bon_number_idx on caisse_entries (bon_number desc);
create index if not exists caisse_entries_operation_type_idx on caisse_entries (operation_type);
create index if not exists caisse_entries_category_idx on caisse_entries (category);
create index if not exists caisse_entries_beneficiary_idx on caisse_entries (beneficiary);
create index if not exists caisse_entries_client_name_idx on caisse_entries (client_name);

alter table caisse_entries enable row level security;

create policy "Lecture publique caisse"
  on caisse_entries for select
  using (true);

create policy "Ajout caisse"
  on caisse_entries for insert
  with check (true);

create policy "Modification caisse"
  on caisse_entries for update
  using (created_at > now() - interval '72 hours')
  with check (created_at > now() - interval '72 hours');

create policy "Suppression caisse"
  on caisse_entries for delete
  using (created_at > now() - interval '72 hours');

-- Realtime : bandeau de solde + registre mis à jour en direct
alter publication supabase_realtime add table caisse_entries;

-- Storage : bucket public pour les photos des justificatifs de caisse
insert into storage.buckets (id, name, public)
values ('caisse-photos', 'caisse-photos', true)
on conflict (id) do nothing;

create policy "Lecture publique photos caisse"
  on storage.objects for select
  using (bucket_id = 'caisse-photos');

create policy "Ajout photos caisse"
  on storage.objects for insert
  with check (bucket_id = 'caisse-photos');

create policy "Suppression photos caisse"
  on storage.objects for delete
  using (bucket_id = 'caisse-photos');

-- Code admin (même principe que admin_update_fuel / admin_delete_fuel) :
-- déblocage sécurisé des modifications/suppressions après le verrou de 72h.
create or replace function admin_update_caisse(
  p_id uuid,
  p_admin_code text,
  p_bon_number integer,
  p_entry_date date,
  p_operation_type text,
  p_description text,
  p_amount numeric,
  p_beneficiary text,
  p_client_name text,
  p_payment_mode text,
  p_cheque_number text,
  p_cheque_bank text,
  p_piece_number text,
  p_category text,
  p_category_other text,
  p_observations text
)
returns caisse_entries
language plpgsql
security definer
set search_path = public
as $$
declare
  v_code text;
  v_result caisse_entries;
begin
  select value into v_code from app_settings where key = 'admin_code';
  if v_code is null or p_admin_code <> v_code then
    raise exception 'Code administrateur invalide';
  end if;

  update caisse_entries set
    bon_number = p_bon_number,
    entry_date = p_entry_date,
    operation_type = p_operation_type,
    description = p_description,
    amount = p_amount,
    beneficiary = p_beneficiary,
    client_name = p_client_name,
    payment_mode = p_payment_mode,
    cheque_number = p_cheque_number,
    cheque_bank = p_cheque_bank,
    piece_number = p_piece_number,
    category = p_category,
    category_other = p_category_other,
    observations = p_observations
  where id = p_id
  returning * into v_result;

  if v_result.id is null then
    raise exception 'Opération introuvable';
  end if;

  return v_result;
end;
$$;

create or replace function admin_delete_caisse(p_id uuid, p_admin_code text)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_code text;
begin
  select value into v_code from app_settings where key = 'admin_code';
  if v_code is null or p_admin_code <> v_code then
    raise exception 'Code administrateur invalide';
  end if;

  delete from caisse_entries where id = p_id;
end;
$$;

revoke all on function admin_update_caisse(uuid, text, integer, date, text, text, numeric, text, text, text, text, text, text, text, text, text) from public;
revoke all on function admin_delete_caisse(uuid, text) from public;
grant execute on function admin_update_caisse(uuid, text, integer, date, text, text, numeric, text, text, text, text, text, text, text, text, text) to anon, authenticated;
grant execute on function admin_delete_caisse(uuid, text) to anon, authenticated;


-- ============================================================
-- MAGASIN BEJAIA : stock pièces détachées + ventes + crédits clients
-- 10e onglet "Magasin". Accès : rôle 'admin' (Ahcene, Massilva) et rôle
-- 'magasin_only' (Aziz Amaouche). Aucun autre compte n'y a accès -- voir
-- ROLE_TABS dans src/lib/auth.js.
--
-- 3 tables :
--   magasin_stock   : catalogue / stock du magasin (une ligne par article)
--   magasin_clients : comptes clients (chiffre d'affaires, seuil, solde crédit)
--   magasin_ventes  : bons de vente (items en jsonb) + règlements clients
--                     (lignes is_payment = true, sans marchandise)
-- ============================================================

-- Utilisateur Aziz Amaouche (gérant du magasin). requires_verification = true
-- -> comme les autres comptes non-admin : code OTP le samedi uniquement,
-- envoyé à l'administrateur via ntfy (voir request_login_code plus haut ;
-- aucune modification nécessaire, la fonction lit v_user.role tel quel).
insert into app_users (username, password_hash, requires_verification, role)
values ('Aziz', encode(digest('Aziz@DPR2024!', 'sha256'), 'hex'), true, 'magasin_only')
on conflict (username) do nothing;

-- ------------------------------------------------------------
-- magasin_stock
-- ------------------------------------------------------------
create table if not exists magasin_stock (
  id uuid primary key default gen_random_uuid(),
  reference text,
  designation text not null,
  marque text,
  quantite numeric(10, 2) not null default 0,
  prix_achat numeric(10, 2) default 0,
  prix_gros numeric(10, 2) default 0,
  prix_detail numeric(10, 2) default 0,
  prix_euro numeric(10, 2) default 0,
  stock_min numeric(10, 2) default 0,
  rayonnage text,
  code_barre text,
  created_at timestamptz not null default now()
);

comment on table magasin_stock is 'Stock du magasin Bejaia (pièces détachées) — une ligne par article';
comment on column magasin_stock.quantite is 'Quantité en stock ; décrémentée automatiquement par magasin_record_vente à chaque vente';

create index if not exists magasin_stock_reference_idx on magasin_stock (reference);
create index if not exists magasin_stock_designation_idx on magasin_stock (lower(designation));
create index if not exists magasin_stock_marque_idx on magasin_stock (marque);

-- Référence unique uniquement quand elle est renseignée : permet l'upsert
-- à l'import (onConflict: 'reference') sans contraindre les nombreux
-- articles sans code (rapprochés par désignation côté application).
create unique index if not exists magasin_stock_reference_unique
  on magasin_stock (reference)
  where reference is not null and reference <> '';

alter table magasin_stock enable row level security;

create policy "Lecture publique magasin_stock" on magasin_stock for select using (true);
create policy "Ajout magasin_stock" on magasin_stock for insert with check (true);
create policy "Modification magasin_stock" on magasin_stock for update using (true) with check (true);
create policy "Suppression magasin_stock" on magasin_stock for delete using (true);

alter publication supabase_realtime add table magasin_stock;

-- ------------------------------------------------------------
-- magasin_clients
-- ------------------------------------------------------------
create table if not exists magasin_clients (
  id uuid primary key default gen_random_uuid(),
  name text unique not null,
  phone text,
  chiffre_affaires numeric(14, 2) default 0,
  seuil_credit numeric(12, 2) default 0,
  credit numeric(12, 2) default 0,
  last_operation_date date,
  created_at timestamptz not null default now()
);

comment on table magasin_clients is 'Comptes clients du magasin Bejaia';
comment on column magasin_clients.credit is 'Solde : négatif = le client nous doit, positif = nous lui devons. Maj automatique : vente à crédit -> credit -= total ; règlement -> credit += montant';
comment on column magasin_clients.chiffre_affaires is 'Cumul du chiffre d''affaires réalisé avec ce client (toutes ventes, hors règlements)';

-- Noms toujours normalisés en MAJUSCULES (comme la table `clients` du module
-- Factures) : évite les doublons "ahcene djennadi" / "AHCENE DJENNADI".
create or replace function magasin_clients_normalize_name()
returns trigger
language plpgsql
as $$
begin
  new.name := upper(trim(new.name));
  return new;
end;
$$;

drop trigger if exists magasin_clients_normalize_name_trg on magasin_clients;
create trigger magasin_clients_normalize_name_trg
  before insert or update on magasin_clients
  for each row execute function magasin_clients_normalize_name();

alter table magasin_clients enable row level security;

create policy "Lecture publique magasin_clients" on magasin_clients for select using (true);
create policy "Ajout magasin_clients" on magasin_clients for insert with check (true);
create policy "Modification magasin_clients" on magasin_clients for update using (true) with check (true);
create policy "Suppression magasin_clients" on magasin_clients for delete using (true);

alter publication supabase_realtime add table magasin_clients;

-- ------------------------------------------------------------
-- magasin_ventes
-- ------------------------------------------------------------
create table if not exists magasin_ventes (
  id uuid primary key default gen_random_uuid(),
  bon_number integer not null unique,
  entry_date date not null default current_date,
  entry_time time,
  client_name text,
  items jsonb not null default '[]'::jsonb,
  total_ht numeric(12, 2) not null default 0,
  remise numeric(10, 2) default 0,
  total numeric(12, 2) not null default 0,
  payment_mode text default 'Espèces'
    check (payment_mode in ('Espèces', 'Chèque', 'Crédit', 'Versement')),
  cheque_number text,
  cheque_bank text,
  observations text,
  is_payment boolean not null default false,
  entered_by_user text,
  created_at timestamptz not null default now()
);

comment on table magasin_ventes is 'Bons de vente du magasin Bejaia (items en jsonb) + règlements clients';
comment on column magasin_ventes.items is 'Tableau [{stock_id, reference, designation, quantite, prix_unitaire, total}] ; vide pour un règlement';
comment on column magasin_ventes.is_payment is 'true = règlement d''un client (diminue sa dette) ; items vide, stock non impacté';

create index if not exists magasin_ventes_created_at_idx on magasin_ventes (created_at desc);
create index if not exists magasin_ventes_entry_date_idx on magasin_ventes (entry_date desc);
create index if not exists magasin_ventes_bon_number_idx on magasin_ventes (bon_number desc);
create index if not exists magasin_ventes_client_name_idx on magasin_ventes (client_name);

alter table magasin_ventes enable row level security;

create policy "Lecture publique magasin_ventes" on magasin_ventes for select using (true);
create policy "Ajout magasin_ventes" on magasin_ventes for insert with check (true);
create policy "Modification magasin_ventes" on magasin_ventes for update
  using (created_at > now() - interval '72 hours')
  with check (created_at > now() - interval '72 hours');
create policy "Suppression magasin_ventes" on magasin_ventes for delete
  using (created_at > now() - interval '72 hours');

alter publication supabase_realtime add table magasin_ventes;

-- ------------------------------------------------------------
-- magasin_record_vente : enregistre atomiquement un bon de vente OU un
-- règlement client, applique la décrémentation du stock et met à jour le
-- compte client. Appelée par MagasinVenteForm et MagasinCredits.
--
--   - vente normale  : stock -= quantité vendue (par ligne), CA += total,
--                      et si payment_mode = 'Crédit' : credit -= total
--   - règlement (is_payment = true) : credit += total, stock intact
--
-- Le client est créé s'il n'existe pas encore (nom en MAJUSCULES).
-- Une quantité vendue supérieure au stock n'est PAS bloquée (le stock peut
-- passer négatif) : l'avertissement est affiché côté application.
-- ------------------------------------------------------------
create or replace function magasin_record_vente(p jsonb)
returns magasin_ventes
language plpgsql
security definer
set search_path = public
as $$
declare
  v_row magasin_ventes;
  v_item jsonb;
  v_client text := nullif(upper(trim(coalesce(p->>'client_name', ''))), '');
  v_is_payment boolean := coalesce((p->>'is_payment')::boolean, false);
  v_total numeric := coalesce((p->>'total')::numeric, 0);
  v_mode text := coalesce(p->>'payment_mode', 'Espèces');
begin
  insert into magasin_ventes (
    bon_number, entry_date, entry_time, client_name, items,
    total_ht, remise, total, payment_mode, cheque_number, cheque_bank,
    observations, is_payment, entered_by_user
  ) values (
    (p->>'bon_number')::int,
    coalesce((p->>'entry_date')::date, current_date),
    (p->>'entry_time')::time,
    v_client,
    coalesce(p->'items', '[]'::jsonb),
    coalesce((p->>'total_ht')::numeric, 0),
    coalesce((p->>'remise')::numeric, 0),
    v_total,
    v_mode,
    nullif(trim(coalesce(p->>'cheque_number', '')), ''),
    nullif(trim(coalesce(p->>'cheque_bank', '')), ''),
    nullif(trim(coalesce(p->>'observations', '')), ''),
    v_is_payment,
    nullif(trim(coalesce(p->>'entered_by_user', '')), '')
  )
  returning * into v_row;

  if not v_is_payment then
    for v_item in select * from jsonb_array_elements(coalesce(p->'items', '[]'::jsonb))
    loop
      if nullif(v_item->>'stock_id', '') is not null then
        update magasin_stock
          set quantite = quantite - coalesce((v_item->>'quantite')::numeric, 0)
          where id = (v_item->>'stock_id')::uuid;
      elsif nullif(trim(coalesce(v_item->>'reference', '')), '') is not null then
        update magasin_stock
          set quantite = quantite - coalesce((v_item->>'quantite')::numeric, 0)
          where reference = v_item->>'reference';
      end if;
    end loop;
  end if;

  if v_client is not null then
    insert into magasin_clients (name) values (v_client) on conflict (name) do nothing;

    if v_is_payment then
      update magasin_clients
        set credit = credit + v_total,
            last_operation_date = v_row.entry_date
        where name = v_client;
    else
      update magasin_clients
        set chiffre_affaires = chiffre_affaires + v_total,
            credit = credit - case when v_mode = 'Crédit' then v_total else 0 end,
            last_operation_date = v_row.entry_date
        where name = v_client;
    end if;
  end if;

  return v_row;
end;
$$;

revoke all on function magasin_record_vente(jsonb) from public;
grant execute on function magasin_record_vente(jsonb) to anon, authenticated;

-- ------------------------------------------------------------
-- Code admin : déblocage des modifications / suppressions après le verrou
-- de 72h (même principe que admin_update_caisse / admin_delete_caisse).
-- NOTE : admin_update_magasin_vente met à jour les champs du bon UNIQUEMENT
-- (pas de réajustement automatique du stock ni du solde client). Une
-- correction de stock/solde après coup se fait via une entrée de stock ou
-- un règlement dédié.
-- ------------------------------------------------------------
create or replace function admin_update_magasin_vente(
  p_id uuid,
  p_admin_code text,
  p_bon_number integer,
  p_entry_date date,
  p_client_name text,
  p_items jsonb,
  p_total_ht numeric,
  p_remise numeric,
  p_total numeric,
  p_payment_mode text,
  p_cheque_number text,
  p_cheque_bank text,
  p_observations text
)
returns magasin_ventes
language plpgsql
security definer
set search_path = public
as $$
declare
  v_code text;
  v_result magasin_ventes;
begin
  select value into v_code from app_settings where key = 'admin_code';
  if v_code is null or p_admin_code <> v_code then
    raise exception 'Code administrateur invalide';
  end if;

  update magasin_ventes set
    bon_number = p_bon_number,
    entry_date = p_entry_date,
    client_name = nullif(upper(trim(coalesce(p_client_name, ''))), ''),
    items = coalesce(p_items, '[]'::jsonb),
    total_ht = p_total_ht,
    remise = p_remise,
    total = p_total,
    payment_mode = p_payment_mode,
    cheque_number = nullif(trim(coalesce(p_cheque_number, '')), ''),
    cheque_bank = nullif(trim(coalesce(p_cheque_bank, '')), ''),
    observations = nullif(trim(coalesce(p_observations, '')), '')
  where id = p_id
  returning * into v_result;

  if v_result.id is null then
    raise exception 'Bon de vente introuvable';
  end if;

  return v_result;
end;
$$;

create or replace function admin_delete_magasin_vente(p_id uuid, p_admin_code text)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_code text;
begin
  select value into v_code from app_settings where key = 'admin_code';
  if v_code is null or p_admin_code <> v_code then
    raise exception 'Code administrateur invalide';
  end if;
  delete from magasin_ventes where id = p_id;
end;
$$;

create or replace function admin_delete_magasin_stock(p_id uuid, p_admin_code text)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_code text;
begin
  select value into v_code from app_settings where key = 'admin_code';
  if v_code is null or p_admin_code <> v_code then
    raise exception 'Code administrateur invalide';
  end if;
  delete from magasin_stock where id = p_id;
end;
$$;

create or replace function admin_delete_magasin_client(p_id uuid, p_admin_code text)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_code text;
begin
  select value into v_code from app_settings where key = 'admin_code';
  if v_code is null or p_admin_code <> v_code then
    raise exception 'Code administrateur invalide';
  end if;
  delete from magasin_clients where id = p_id;
end;
$$;

revoke all on function admin_update_magasin_vente(uuid, text, integer, date, text, jsonb, numeric, numeric, numeric, text, text, text, text) from public;
revoke all on function admin_delete_magasin_vente(uuid, text) from public;
revoke all on function admin_delete_magasin_stock(uuid, text) from public;
revoke all on function admin_delete_magasin_client(uuid, text) from public;
grant execute on function admin_update_magasin_vente(uuid, text, integer, date, text, jsonb, numeric, numeric, numeric, text, text, text, text) to anon, authenticated;
grant execute on function admin_delete_magasin_vente(uuid, text) to anon, authenticated;
grant execute on function admin_delete_magasin_stock(uuid, text) to anon, authenticated;
grant execute on function admin_delete_magasin_client(uuid, text) to anon, authenticated;


-- ============================================================
-- AJOUTS 2026-09-03 :
--   1. Photo sur les bons de vente magasin (magasin_ventes.photo_url)
--   2. Module PRODUCTION (briqueterie) : table production_entries
--   3. Magasin Bejaia — sous-onglet "Achats" : table magasin_achats
--   4. Utilisateur Sofiane (rôle maintenance_only, comme Karim)
-- ============================================================

-- ------------------------------------------------------------
-- 1. Photo des bons de vente magasin
--    Les photos sont hébergées par le serveur de photos
--    (VITE_PHOTO_SERVER_URL, bucket public "magasin-photos"), comme pour
--    les autres modules (caisse, sable, maintenance...).
-- ------------------------------------------------------------
alter table magasin_ventes add column if not exists photo_url text;
alter table magasin_ventes add column if not exists is_payment boolean not null default false;

-- magasin_record_vente : version mise à jour pour enregistrer photo_url.
create or replace function magasin_record_vente(p jsonb)
returns magasin_ventes
language plpgsql
security definer
set search_path = public
as $$
declare
  v_row magasin_ventes;
  v_item jsonb;
  v_client text := nullif(upper(trim(coalesce(p->>'client_name', ''))), '');
  v_is_payment boolean := coalesce((p->>'is_payment')::boolean, false);
  v_total numeric := coalesce((p->>'total')::numeric, 0);
  v_mode text := coalesce(p->>'payment_mode', 'Espèces');
begin
  insert into magasin_ventes (
    bon_number, entry_date, entry_time, client_name, items,
    total_ht, remise, total, payment_mode, cheque_number, cheque_bank,
    observations, photo_url, is_payment, entered_by_user
  ) values (
    (p->>'bon_number')::int,
    coalesce((p->>'entry_date')::date, current_date),
    (p->>'entry_time')::time,
    v_client,
    coalesce(p->'items', '[]'::jsonb),
    coalesce((p->>'total_ht')::numeric, 0),
    coalesce((p->>'remise')::numeric, 0),
    v_total,
    v_mode,
    nullif(trim(coalesce(p->>'cheque_number', '')), ''),
    nullif(trim(coalesce(p->>'cheque_bank', '')), ''),
    nullif(trim(coalesce(p->>'observations', '')), ''),
    nullif(trim(coalesce(p->>'photo_url', '')), ''),
    v_is_payment,
    nullif(trim(coalesce(p->>'entered_by_user', '')), '')
  )
  returning * into v_row;

  if not v_is_payment then
    for v_item in select * from jsonb_array_elements(coalesce(p->'items', '[]'::jsonb))
    loop
      if nullif(v_item->>'stock_id', '') is not null then
        update magasin_stock
          set quantite = quantite - coalesce((v_item->>'quantite')::numeric, 0)
          where id = (v_item->>'stock_id')::uuid;
      elsif nullif(trim(coalesce(v_item->>'reference', '')), '') is not null then
        update magasin_stock
          set quantite = quantite - coalesce((v_item->>'quantite')::numeric, 0)
          where reference = v_item->>'reference';
      end if;
    end loop;
  end if;

  if v_client is not null then
    insert into magasin_clients (name) values (v_client) on conflict (name) do nothing;

    if v_is_payment then
      update magasin_clients
        set credit = credit + v_total,
            last_operation_date = v_row.entry_date
        where name = v_client;
    else
      update magasin_clients
        set chiffre_affaires = chiffre_affaires + v_total,
            credit = credit - case when v_mode = 'Crédit' then v_total else 0 end,
            last_operation_date = v_row.entry_date
        where name = v_client;
    end if;
  end if;

  return v_row;
end;
$$;

revoke all on function magasin_record_vente(jsonb) from public;
grant execute on function magasin_record_vente(jsonb) to anon, authenticated;

-- admin_update_magasin_vente : version jsonb-agnostique conservée telle quelle
-- ci-dessus ; on ajoute juste la prise en charge de photo_url via une
-- fonction dédiée simple (le registre n'édite pas la photo, mais on garde la
-- valeur existante : rien à faire ici).


-- ------------------------------------------------------------
-- 4. Utilisateur Sofiane — rôle maintenance_only (identique à Karim) :
--    accès Maintenance + Production, 24h/24, code OTP le samedi, pas de
--    code admin. Voir ROLE_TABS / UNRESTRICTED_HOURS_USERS dans auth.js.
-- ------------------------------------------------------------
insert into app_users (username, password_hash, requires_verification, role)
values ('Sofiane', encode(digest('Sofiane@DPR2024!', 'sha256'), 'hex'), true, 'maintenance_only')
on conflict (username) do nothing;


-- ============================================================
-- 2. MODULE PRODUCTION (briqueterie)
--    Onglet "Production". Accès : rôle 'admin' (Ahcene, Massilva) et rôle
--    'maintenance_only' (Karim, Sofiane). Aucun autre compte.
--    Une ligne production_entries = un poste de production suivi de bout en
--    bout : Presse -> Séchoir -> Four -> Défournement -> Emballage.
-- ============================================================
create table if not exists production_entries (
  id uuid primary key default gen_random_uuid(),
  entry_date date not null default current_date,
  entry_time time,
  equipe text check (equipe in ('A', 'B', 'C')),
  poste text check (poste in ('1', '2', '3')),
  operateur text,
  produit text not null check (produit in ('B8', 'B12')),

  presse_chariots integer default 0,
  presse_numeros text,
  presse_pression numeric(6, 2),
  presse_pieces_etage integer default 72,
  presse_etages_chariot integer default 12,
  presse_rebutes integer default 0,
  presse_total_pieces integer generated always as
    (presse_chariots * presse_etages_chariot * presse_pieces_etage) stored,
  presse_remarques text,

  sechoir_entres integer default 0,
  sechoir_sortis integer default 0,
  sechoir_temperature numeric(6, 2),
  sechoir_humidite numeric(5, 2),
  sechoir_duree numeric(6, 2),
  sechoir_rebutes integer default 0,
  sechoir_remarques text,

  four_enfournes integer default 0,
  four_defournes integer default 0,
  four_temperature numeric(6, 2),
  four_duree numeric(6, 2),
  four_gaz numeric(8, 2),
  four_remarques text,

  defourn_chariots integer default 0,
  defourn_conformes integer default 0,
  defourn_cassees integer default 0,
  defourn_fissurees integer default 0,
  defourn_remarques text,

  emballage_paquets integer default 0,
  emballage_pieces_paquet integer default 0,
  emballage_palettes integer default 0,
  emballage_stock_final integer default 0,
  emballage_remarques text,

  entered_by_user text,
  created_at timestamptz not null default now()
);

comment on table production_entries is 'Suivi de production briqueterie : un poste (presse->séchoir->four->défournement->emballage)';
comment on column production_entries.presse_total_pieces is 'Calculé : presse_chariots × presse_etages_chariot × presse_pieces_etage';

create index if not exists production_entries_entry_date_idx on production_entries (entry_date desc);
create index if not exists production_entries_created_at_idx on production_entries (created_at desc);
create index if not exists production_entries_produit_idx on production_entries (produit);
create index if not exists production_entries_equipe_idx on production_entries (equipe);

alter table production_entries enable row level security;

create policy "Lecture publique production_entries" on production_entries for select using (true);
create policy "Ajout production_entries" on production_entries for insert with check (true);
-- Modification / suppression verrouillées après 72h (déblocage via code admin
-- avec admin_update_production / admin_delete_production, SECURITY DEFINER).
create policy "Modification production_entries" on production_entries for update
  using (created_at > now() - interval '72 hours')
  with check (created_at > now() - interval '72 hours');
create policy "Suppression production_entries" on production_entries for delete
  using (created_at > now() - interval '72 hours');

do $$ begin
  alter publication supabase_realtime add table production_entries;
exception when duplicate_object then null;
end $$;

-- admin_update_production : met à jour une saisie après le verrou de 72h.
-- Payload jsonb (trop de colonnes pour des paramètres nommés).
create or replace function admin_update_production(p_id uuid, p_admin_code text, p jsonb)
returns production_entries
language plpgsql
security definer
set search_path = public
as $$
declare
  v_code text;
  v_result production_entries;
begin
  select value into v_code from app_settings where key = 'admin_code';
  if v_code is null or p_admin_code <> v_code then
    raise exception 'Code administrateur invalide';
  end if;

  update production_entries set
    entry_date = coalesce((p->>'entry_date')::date, entry_date),
    equipe = coalesce(p->>'equipe', equipe),
    poste = coalesce(p->>'poste', poste),
    operateur = nullif(trim(coalesce(p->>'operateur', '')), ''),
    produit = coalesce(p->>'produit', produit),
    presse_chariots = coalesce((p->>'presse_chariots')::int, 0),
    presse_numeros = nullif(trim(coalesce(p->>'presse_numeros', '')), ''),
    presse_pression = (p->>'presse_pression')::numeric,
    presse_pieces_etage = coalesce((p->>'presse_pieces_etage')::int, 0),
    presse_etages_chariot = coalesce((p->>'presse_etages_chariot')::int, 0),
    presse_rebutes = coalesce((p->>'presse_rebutes')::int, 0),
    presse_remarques = nullif(trim(coalesce(p->>'presse_remarques', '')), ''),
    sechoir_entres = coalesce((p->>'sechoir_entres')::int, 0),
    sechoir_sortis = coalesce((p->>'sechoir_sortis')::int, 0),
    sechoir_temperature = (p->>'sechoir_temperature')::numeric,
    sechoir_humidite = (p->>'sechoir_humidite')::numeric,
    sechoir_duree = (p->>'sechoir_duree')::numeric,
    sechoir_rebutes = coalesce((p->>'sechoir_rebutes')::int, 0),
    sechoir_remarques = nullif(trim(coalesce(p->>'sechoir_remarques', '')), ''),
    four_enfournes = coalesce((p->>'four_enfournes')::int, 0),
    four_defournes = coalesce((p->>'four_defournes')::int, 0),
    four_temperature = (p->>'four_temperature')::numeric,
    four_duree = (p->>'four_duree')::numeric,
    four_gaz = (p->>'four_gaz')::numeric,
    four_remarques = nullif(trim(coalesce(p->>'four_remarques', '')), ''),
    defourn_chariots = coalesce((p->>'defourn_chariots')::int, 0),
    defourn_conformes = coalesce((p->>'defourn_conformes')::int, 0),
    defourn_cassees = coalesce((p->>'defourn_cassees')::int, 0),
    defourn_fissurees = coalesce((p->>'defourn_fissurees')::int, 0),
    defourn_remarques = nullif(trim(coalesce(p->>'defourn_remarques', '')), ''),
    emballage_paquets = coalesce((p->>'emballage_paquets')::int, 0),
    emballage_pieces_paquet = coalesce((p->>'emballage_pieces_paquet')::int, 0),
    emballage_palettes = coalesce((p->>'emballage_palettes')::int, 0),
    emballage_stock_final = coalesce((p->>'emballage_stock_final')::int, 0),
    emballage_remarques = nullif(trim(coalesce(p->>'emballage_remarques', '')), '')
  where id = p_id
  returning * into v_result;

  if v_result.id is null then
    raise exception 'Saisie de production introuvable';
  end if;
  return v_result;
end;
$$;

create or replace function admin_delete_production(p_id uuid, p_admin_code text)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_code text;
begin
  select value into v_code from app_settings where key = 'admin_code';
  if v_code is null or p_admin_code <> v_code then
    raise exception 'Code administrateur invalide';
  end if;
  delete from production_entries where id = p_id;
end;
$$;

revoke all on function admin_update_production(uuid, text, jsonb) from public;
revoke all on function admin_delete_production(uuid, text) from public;
grant execute on function admin_update_production(uuid, text, jsonb) to anon, authenticated;
grant execute on function admin_delete_production(uuid, text) to anon, authenticated;


-- ============================================================
-- 3. MAGASIN BEJAIA — sous-onglet "Achats" (achat fournisseur pour revente)
--    Table magasin_achats : bons d'achat auprès des fournisseurs.
--    destination = 'Stock'          -> marchandise ajoutée au stock magasin
--    destination = 'Revente directe' -> pas de stock, juste l'enregistrement
--                                       + client + prix de revente + marge
-- ============================================================
create table if not exists magasin_achats (
  id uuid primary key default gen_random_uuid(),
  bon_number integer not null unique,
  entry_date date not null default current_date,
  entry_time time,
  fournisseur text not null,
  items jsonb not null default '[]'::jsonb,
  total numeric(12, 2) not null default 0,
  payment_mode text default 'Espèces'
    check (payment_mode in ('Espèces', 'Chèque', 'Crédit')),
  cheque_number text,
  cheque_bank text,
  destination text default 'Stock' check (destination in ('Stock', 'Revente directe')),
  client_revente text,
  prix_revente numeric(12, 2),
  marge numeric(12, 2),
  photo_url text,
  observations text,
  entered_by_user text,
  created_at timestamptz not null default now()
);

comment on table magasin_achats is 'Bons d''achat fournisseur du magasin Bejaia (items en jsonb)';
comment on column magasin_achats.items is 'Tableau [{stock_id, reference, designation, quantite, prix_achat, total}]';
comment on column magasin_achats.marge is 'Revente directe : prix_revente - total (achat)';

create index if not exists magasin_achats_created_at_idx on magasin_achats (created_at desc);
create index if not exists magasin_achats_entry_date_idx on magasin_achats (entry_date desc);
create index if not exists magasin_achats_bon_number_idx on magasin_achats (bon_number desc);
create index if not exists magasin_achats_fournisseur_idx on magasin_achats (fournisseur);

alter table magasin_achats enable row level security;

create policy "Lecture publique magasin_achats" on magasin_achats for select using (true);
create policy "Ajout magasin_achats" on magasin_achats for insert with check (true);
create policy "Modification magasin_achats" on magasin_achats for update
  using (created_at > now() - interval '72 hours')
  with check (created_at > now() - interval '72 hours');
create policy "Suppression magasin_achats" on magasin_achats for delete
  using (created_at > now() - interval '72 hours');

do $$ begin
  alter publication supabase_realtime add table magasin_achats;
exception when duplicate_object then null;
end $$;

-- magasin_record_achat : enregistre atomiquement un bon d'achat et, si
-- destination = 'Stock', ajoute la marchandise au stock du magasin :
--   - article rapproché par stock_id, sinon par reference, sinon créé.
create or replace function magasin_record_achat(p jsonb)
returns magasin_achats
language plpgsql
security definer
set search_path = public
as $$
declare
  v_row magasin_achats;
  v_item jsonb;
  v_dest text := coalesce(p->>'destination', 'Stock');
  v_stock_id uuid;
  v_ref text;
  v_qty numeric;
begin
  insert into magasin_achats (
    bon_number, entry_date, entry_time, fournisseur, items, total,
    payment_mode, cheque_number, cheque_bank, destination, client_revente,
    prix_revente, marge, photo_url, observations, entered_by_user
  ) values (
    (p->>'bon_number')::int,
    coalesce((p->>'entry_date')::date, current_date),
    (p->>'entry_time')::time,
    trim(coalesce(p->>'fournisseur', '')),
    coalesce(p->'items', '[]'::jsonb),
    coalesce((p->>'total')::numeric, 0),
    coalesce(p->>'payment_mode', 'Espèces'),
    nullif(trim(coalesce(p->>'cheque_number', '')), ''),
    nullif(trim(coalesce(p->>'cheque_bank', '')), ''),
    v_dest,
    nullif(trim(coalesce(p->>'client_revente', '')), ''),
    (p->>'prix_revente')::numeric,
    (p->>'marge')::numeric,
    nullif(trim(coalesce(p->>'photo_url', '')), ''),
    nullif(trim(coalesce(p->>'observations', '')), ''),
    nullif(trim(coalesce(p->>'entered_by_user', '')), '')
  )
  returning * into v_row;

  if v_dest = 'Stock' then
    for v_item in select * from jsonb_array_elements(coalesce(p->'items', '[]'::jsonb))
    loop
      v_stock_id := nullif(v_item->>'stock_id', '')::uuid;
      v_ref := nullif(trim(coalesce(v_item->>'reference', '')), '');
      v_qty := coalesce((v_item->>'quantite')::numeric, 0);

      if v_stock_id is not null then
        update magasin_stock set quantite = quantite + v_qty where id = v_stock_id;
      elsif v_ref is not null and exists (select 1 from magasin_stock where reference = v_ref) then
        update magasin_stock
          set quantite = quantite + v_qty,
              prix_achat = coalesce((v_item->>'prix_achat')::numeric, prix_achat)
          where reference = v_ref;
      else
        insert into magasin_stock (reference, designation, quantite, prix_achat)
        values (
          v_ref,
          trim(coalesce(v_item->>'designation', 'Article sans nom')),
          v_qty,
          coalesce((v_item->>'prix_achat')::numeric, 0)
        );
      end if;
    end loop;
  end if;

  return v_row;
end;
$$;

revoke all on function magasin_record_achat(jsonb) from public;
grant execute on function magasin_record_achat(jsonb) to anon, authenticated;

-- Code admin : édition / suppression après le verrou de 72h.
create or replace function admin_update_magasin_achat(p_id uuid, p_admin_code text, p jsonb)
returns magasin_achats
language plpgsql
security definer
set search_path = public
as $$
declare
  v_code text;
  v_result magasin_achats;
begin
  select value into v_code from app_settings where key = 'admin_code';
  if v_code is null or p_admin_code <> v_code then
    raise exception 'Code administrateur invalide';
  end if;

  update magasin_achats set
    bon_number = coalesce((p->>'bon_number')::int, bon_number),
    entry_date = coalesce((p->>'entry_date')::date, entry_date),
    fournisseur = nullif(trim(coalesce(p->>'fournisseur', '')), ''),
    total = coalesce((p->>'total')::numeric, 0),
    payment_mode = coalesce(p->>'payment_mode', payment_mode),
    cheque_number = nullif(trim(coalesce(p->>'cheque_number', '')), ''),
    cheque_bank = nullif(trim(coalesce(p->>'cheque_bank', '')), ''),
    destination = coalesce(p->>'destination', destination),
    client_revente = nullif(trim(coalesce(p->>'client_revente', '')), ''),
    prix_revente = (p->>'prix_revente')::numeric,
    marge = (p->>'marge')::numeric,
    observations = nullif(trim(coalesce(p->>'observations', '')), '')
  where id = p_id
  returning * into v_result;

  if v_result.id is null then
    raise exception 'Bon d''achat introuvable';
  end if;
  return v_result;
end;
$$;

create or replace function admin_delete_magasin_achat(p_id uuid, p_admin_code text)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_code text;
begin
  select value into v_code from app_settings where key = 'admin_code';
  if v_code is null or p_admin_code <> v_code then
    raise exception 'Code administrateur invalide';
  end if;
  delete from magasin_achats where id = p_id;
end;
$$;

revoke all on function admin_update_magasin_achat(uuid, text, jsonb) from public;
revoke all on function admin_delete_magasin_achat(uuid, text) from public;
grant execute on function admin_update_magasin_achat(uuid, text, jsonb) to anon, authenticated;
grant execute on function admin_delete_magasin_achat(uuid, text) to anon, authenticated;


-- ============================================================
-- AJOUT 2026-09-03 (2) : CAISSE DU MAGASIN (sous-onglet "Caisse" de la page
-- Magasin Bejaia). Table `magasin_caisse`, totalement séparée de la caisse
-- principale de la briqueterie (`caisse_entries`). Solde propre au magasin.
-- Accès : rôle 'admin' + rôle 'magasin_only' (Aziz), comme le reste du
-- magasin. Notifications ntfy sur le topic Argile_Magasin.
-- ============================================================

-- Bucket photos partagé du magasin (ventes / achats / justificatifs caisse).
-- Les photos passent en pratique par le serveur de photos
-- (VITE_PHOTO_SERVER_URL) ; ce bucket Supabase est créé par cohérence avec
-- les autres modules (caisse-photos, sable-photos...).
insert into storage.buckets (id, name, public)
values ('magasin-photos', 'magasin-photos', true)
on conflict (id) do nothing;

do $$ begin
  create policy "Lecture publique photos magasin" on storage.objects for select
    using (bucket_id = 'magasin-photos');
exception when duplicate_object then null;
end $$;
do $$ begin
  create policy "Ajout photos magasin" on storage.objects for insert
    with check (bucket_id = 'magasin-photos');
exception when duplicate_object then null;
end $$;
do $$ begin
  create policy "Suppression photos magasin" on storage.objects for delete
    using (bucket_id = 'magasin-photos');
exception when duplicate_object then null;
end $$;

create table if not exists magasin_caisse (
  id uuid primary key default gen_random_uuid(),
  bon_number integer not null unique,
  entry_date date not null default current_date,
  entry_time time,
  operation_type text not null
    check (operation_type in ('Encaissement', 'Décaissement', 'Dépense')),
  description text not null,
  amount numeric(12, 2) not null,
  beneficiary text,
  client_name text,
  payment_mode text default 'Espèces'
    check (payment_mode in ('Espèces', 'Chèque', 'Versement', 'Virement')),
  cheque_number text,
  cheque_bank text,
  piece_number text,
  photo_url text,
  category text default 'Autre'
    check (category in ('Fournisseur', 'Client', 'Salaire', 'Frais généraux', 'Autre')),
  category_other text,
  observations text,
  entered_by_user text,
  created_at timestamptz not null default now()
);

comment on table magasin_caisse is 'Caisse du magasin Bejaia (séparée de caisse_entries) : encaissements / décaissements / dépenses';
comment on column magasin_caisse.amount is 'Montant en valeur absolue (DA) ; le signe est déduit de operation_type côté application';

create index if not exists magasin_caisse_created_at_idx on magasin_caisse (created_at desc);
create index if not exists magasin_caisse_entry_date_idx on magasin_caisse (entry_date desc);
create index if not exists magasin_caisse_bon_number_idx on magasin_caisse (bon_number desc);
create index if not exists magasin_caisse_operation_type_idx on magasin_caisse (operation_type);
create index if not exists magasin_caisse_category_idx on magasin_caisse (category);
create index if not exists magasin_caisse_beneficiary_idx on magasin_caisse (beneficiary);
create index if not exists magasin_caisse_client_name_idx on magasin_caisse (client_name);

alter table magasin_caisse enable row level security;

create policy "Lecture publique magasin_caisse" on magasin_caisse for select using (true);
create policy "Ajout magasin_caisse" on magasin_caisse for insert with check (true);
create policy "Modification magasin_caisse" on magasin_caisse for update
  using (created_at > now() - interval '72 hours')
  with check (created_at > now() - interval '72 hours');
create policy "Suppression magasin_caisse" on magasin_caisse for delete
  using (created_at > now() - interval '72 hours');

do $$ begin
  alter publication supabase_realtime add table magasin_caisse;
exception when duplicate_object then null;
end $$;

-- Code admin : édition / suppression après le verrou de 72h (payload jsonb).
create or replace function admin_update_magasin_caisse(p_id uuid, p_admin_code text, p jsonb)
returns magasin_caisse
language plpgsql
security definer
set search_path = public
as $$
declare
  v_code text;
  v_result magasin_caisse;
begin
  select value into v_code from app_settings where key = 'admin_code';
  if v_code is null or p_admin_code <> v_code then
    raise exception 'Code administrateur invalide';
  end if;

  update magasin_caisse set
    bon_number = coalesce((p->>'bon_number')::int, bon_number),
    entry_date = coalesce((p->>'entry_date')::date, entry_date),
    operation_type = coalesce(p->>'operation_type', operation_type),
    description = coalesce(nullif(trim(coalesce(p->>'description', '')), ''), description),
    amount = coalesce((p->>'amount')::numeric, amount),
    beneficiary = nullif(trim(coalesce(p->>'beneficiary', '')), ''),
    client_name = nullif(trim(coalesce(p->>'client_name', '')), ''),
    payment_mode = coalesce(p->>'payment_mode', payment_mode),
    cheque_number = nullif(trim(coalesce(p->>'cheque_number', '')), ''),
    cheque_bank = nullif(trim(coalesce(p->>'cheque_bank', '')), ''),
    piece_number = nullif(trim(coalesce(p->>'piece_number', '')), ''),
    category = coalesce(p->>'category', category),
    category_other = nullif(trim(coalesce(p->>'category_other', '')), ''),
    observations = nullif(trim(coalesce(p->>'observations', '')), '')
  where id = p_id
  returning * into v_result;

  if v_result.id is null then
    raise exception 'Opération de caisse magasin introuvable';
  end if;
  return v_result;
end;
$$;

create or replace function admin_delete_magasin_caisse(p_id uuid, p_admin_code text)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_code text;
begin
  select value into v_code from app_settings where key = 'admin_code';
  if v_code is null or p_admin_code <> v_code then
    raise exception 'Code administrateur invalide';
  end if;
  delete from magasin_caisse where id = p_id;
end;
$$;

revoke all on function admin_update_magasin_caisse(uuid, text, jsonb) from public;
revoke all on function admin_delete_magasin_caisse(uuid, text) from public;
grant execute on function admin_update_magasin_caisse(uuid, text, jsonb) to anon, authenticated;
grant execute on function admin_delete_magasin_caisse(uuid, text) to anon, authenticated;


-- ============================================================
-- MODULE PRODNET (2026-09-03) : suivi du coût de revient des produits finis
-- Onglet "Prodnet". Accès : rôle 'admin' (Ahcene, Massilva) et rôle 'editor'
-- (Halim, Bureau). Voir ROLE_TABS dans src/lib/auth.js.
--
-- 3 tables :
--   prodnet_products     : catalogue des produits finis (stock + prix moyen)
--   prodnet_matieres     : stock des matières premières
--   prodnet_fabrications : historique des fabrications (consommation matières
--                          -> production produit fini, coût de revient)
--
-- Une fabrication consomme des matières premières (jamais en dessous de 0) et
-- alimente le prix moyen pondéré du produit fini avec son coût de revient.
-- ============================================================

-- Nouvel utilisateur Abderhmane : rôle maintenance_only (comme Karim /
-- Sofiane) -> accès Maintenance + Production, 24h/24, code OTP le samedi.
insert into app_users (username, password_hash, requires_verification, role)
values ('Abderhmane', encode(digest('Abderhmane@DPR2024!', 'sha256'), 'hex'), true, 'maintenance_only')
on conflict (username) do nothing;

-- ------------------------------------------------------------
-- prodnet_products
-- ------------------------------------------------------------
create table if not exists prodnet_products (
  id uuid primary key default gen_random_uuid(),
  reference text unique,
  designation text not null,
  quantite numeric(10, 2) default 0,
  prix_moyen_ht numeric(12, 2) default 0,
  montant_ht numeric(14, 2) default 0,
  created_at timestamptz not null default now()
);

comment on table prodnet_products is 'Produits finis Prodnet : stock, prix moyen pondéré HT, valeur';

create index if not exists prodnet_products_designation_idx on prodnet_products (lower(designation));
create unique index if not exists prodnet_products_reference_unique
  on prodnet_products (reference)
  where reference is not null and reference <> '';

alter table prodnet_products enable row level security;
create policy "Lecture publique prodnet_products" on prodnet_products for select using (true);
create policy "Ajout prodnet_products" on prodnet_products for insert with check (true);
create policy "Modification prodnet_products" on prodnet_products for update using (true) with check (true);
create policy "Suppression prodnet_products" on prodnet_products for delete using (true);

do $$ begin
  alter publication supabase_realtime add table prodnet_products;
exception when duplicate_object then null;
end $$;

-- ------------------------------------------------------------
-- prodnet_matieres
-- ------------------------------------------------------------
create table if not exists prodnet_matieres (
  id uuid primary key default gen_random_uuid(),
  designation text not null,
  position_tarifaire text,
  unite text default 'U',
  quantite numeric(12, 2) not null default 0,
  prix_moyen numeric(12, 2) default 0,
  valeur_totale numeric(14, 2) default 0,
  created_at timestamptz not null default now()
);

comment on table prodnet_matieres is 'Matières premières Prodnet : stock consommé par les fabrications';
comment on column prodnet_matieres.quantite is 'Décrémentée par prodnet_record_fabrication ; jamais négative (contrôle applicatif + RPC)';

create index if not exists prodnet_matieres_designation_idx on prodnet_matieres (lower(designation));

alter table prodnet_matieres enable row level security;
create policy "Lecture publique prodnet_matieres" on prodnet_matieres for select using (true);
create policy "Ajout prodnet_matieres" on prodnet_matieres for insert with check (true);
create policy "Modification prodnet_matieres" on prodnet_matieres for update using (true) with check (true);
create policy "Suppression prodnet_matieres" on prodnet_matieres for delete using (true);

do $$ begin
  alter publication supabase_realtime add table prodnet_matieres;
exception when duplicate_object then null;
end $$;

-- ------------------------------------------------------------
-- prodnet_fabrications
-- ------------------------------------------------------------
create table if not exists prodnet_fabrications (
  id uuid primary key default gen_random_uuid(),
  entry_date date not null default current_date,
  entry_time time,
  product_id uuid references prodnet_products(id) on delete set null,
  product_reference text,
  product_designation text,
  quantite_produite integer not null default 1,
  matieres jsonb not null default '[]'::jsonb,
  cout_total numeric(14, 2) not null default 0,
  cout_unitaire numeric(14, 2) default 0,
  observations text,
  entered_by_user text,
  created_at timestamptz not null default now()
);

comment on table prodnet_fabrications is 'Historique des fabrications Prodnet (consommation matières -> produit fini)';
comment on column prodnet_fabrications.matieres is 'Tableau [{matiere_id, designation, quantite_utilisee, prix_unitaire, total}]';

create index if not exists prodnet_fabrications_entry_date_idx on prodnet_fabrications (entry_date desc);
create index if not exists prodnet_fabrications_created_at_idx on prodnet_fabrications (created_at desc);
create index if not exists prodnet_fabrications_product_id_idx on prodnet_fabrications (product_id);

alter table prodnet_fabrications enable row level security;
create policy "Lecture publique prodnet_fabrications" on prodnet_fabrications for select using (true);
create policy "Ajout prodnet_fabrications" on prodnet_fabrications for insert with check (true);
create policy "Modification prodnet_fabrications" on prodnet_fabrications for update
  using (created_at > now() - interval '72 hours')
  with check (created_at > now() - interval '72 hours');
create policy "Suppression prodnet_fabrications" on prodnet_fabrications for delete
  using (created_at > now() - interval '72 hours');

do $$ begin
  alter publication supabase_realtime add table prodnet_fabrications;
exception when duplicate_object then null;
end $$;

-- ------------------------------------------------------------
-- prodnet_record_fabrication : enregistre atomiquement une fabrication.
--   1. vérifie que chaque matière a un stock suffisant (sinon ERREUR, rollback)
--   2. décrémente le stock de chaque matière + recalcule sa valeur_totale
--   3. incrémente le stock du produit fini
--   4. recalcule le prix moyen pondéré du produit
--        nouveau_prix = (ancien_montant + cout_total) / (ancienne_qte + qte_produite)
--   5. insère la ligne prodnet_fabrications
-- ------------------------------------------------------------
create or replace function prodnet_record_fabrication(p jsonb)
returns prodnet_fabrications
language plpgsql
security definer
set search_path = public
as $$
declare
  v_row prodnet_fabrications;
  v_mat jsonb;
  v_mid uuid;
  v_qty numeric;
  v_stock numeric;
  v_desig text;
  v_prod_id uuid := nullif(p->>'product_id', '')::uuid;
  v_qte_produite integer := greatest(coalesce((p->>'quantite_produite')::int, 1), 1);
  v_cout_total numeric := coalesce((p->>'cout_total')::numeric, 0);
begin
  -- 1. contrôle des stocks (verrou de ligne)
  for v_mat in select * from jsonb_array_elements(coalesce(p->'matieres', '[]'::jsonb))
  loop
    v_mid := nullif(v_mat->>'matiere_id', '')::uuid;
    v_qty := coalesce((v_mat->>'quantite_utilisee')::numeric, 0);
    v_desig := coalesce(v_mat->>'designation', '?');
    if v_mid is null then
      raise exception 'Matière première non identifiée (%).', v_desig;
    end if;
    select quantite into v_stock from prodnet_matieres where id = v_mid for update;
    if v_stock is null then
      raise exception 'Matière première introuvable : %.', v_desig;
    end if;
    if v_stock < v_qty then
      raise exception 'Stock insuffisant pour « % » (disponible : %, demandé : %).', v_desig, v_stock, v_qty;
    end if;
  end loop;

  -- 2. décrément des matières + recalcul valeur_totale
  for v_mat in select * from jsonb_array_elements(coalesce(p->'matieres', '[]'::jsonb))
  loop
    v_mid := nullif(v_mat->>'matiere_id', '')::uuid;
    v_qty := coalesce((v_mat->>'quantite_utilisee')::numeric, 0);
    update prodnet_matieres
      set quantite = quantite - v_qty,
          valeur_totale = (quantite - v_qty) * prix_moyen
      where id = v_mid;
  end loop;

  -- 3 + 4. produit fini : stock += qte produite, prix moyen pondéré recalculé
  if v_prod_id is not null then
    update prodnet_products
      set quantite = quantite + v_qte_produite,
          montant_ht = montant_ht + v_cout_total,
          prix_moyen_ht = case
            when (quantite + v_qte_produite) > 0
              then (montant_ht + v_cout_total) / (quantite + v_qte_produite)
            else 0
          end
      where id = v_prod_id;
  end if;

  -- 5. insertion de la fabrication
  insert into prodnet_fabrications (
    entry_date, entry_time, product_id, product_reference, product_designation,
    quantite_produite, matieres, cout_total, cout_unitaire, observations, entered_by_user
  ) values (
    coalesce((p->>'entry_date')::date, current_date),
    (p->>'entry_time')::time,
    v_prod_id,
    nullif(trim(coalesce(p->>'product_reference', '')), ''),
    nullif(trim(coalesce(p->>'product_designation', '')), ''),
    v_qte_produite,
    coalesce(p->'matieres', '[]'::jsonb),
    v_cout_total,
    coalesce((p->>'cout_unitaire')::numeric, case when v_qte_produite > 0 then v_cout_total / v_qte_produite else 0 end),
    nullif(trim(coalesce(p->>'observations', '')), ''),
    nullif(trim(coalesce(p->>'entered_by_user', '')), '')
  )
  returning * into v_row;

  return v_row;
end;
$$;

revoke all on function prodnet_record_fabrication(jsonb) from public;
grant execute on function prodnet_record_fabrication(jsonb) to anon, authenticated;

-- ------------------------------------------------------------
-- Code admin : déblocage après le verrou de 72h.
-- NOTE : admin_update_prodnet_fabrication ne modifie que la date et les
-- observations (les stocks matières / produit ont déjà été impactés à la
-- création et ne sont pas recalculés). admin_delete_prodnet_fabrication ne
-- restaure pas les stocks non plus (correction manuelle via les onglets
-- Produits Finis / Matières Premières).
-- ------------------------------------------------------------
create or replace function admin_update_prodnet_fabrication(p_id uuid, p_admin_code text, p jsonb)
returns prodnet_fabrications
language plpgsql
security definer
set search_path = public
as $$
declare
  v_code text;
  v_result prodnet_fabrications;
begin
  select value into v_code from app_settings where key = 'admin_code';
  if v_code is null or p_admin_code <> v_code then
    raise exception 'Code administrateur invalide';
  end if;

  update prodnet_fabrications set
    entry_date = coalesce((p->>'entry_date')::date, entry_date),
    observations = nullif(trim(coalesce(p->>'observations', '')), '')
  where id = p_id
  returning * into v_result;

  if v_result.id is null then
    raise exception 'Fabrication introuvable';
  end if;
  return v_result;
end;
$$;

create or replace function admin_delete_prodnet_fabrication(p_id uuid, p_admin_code text)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_code text;
begin
  select value into v_code from app_settings where key = 'admin_code';
  if v_code is null or p_admin_code <> v_code then
    raise exception 'Code administrateur invalide';
  end if;
  delete from prodnet_fabrications where id = p_id;
end;
$$;

create or replace function admin_delete_prodnet_product(p_id uuid, p_admin_code text)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_code text;
begin
  select value into v_code from app_settings where key = 'admin_code';
  if v_code is null or p_admin_code <> v_code then
    raise exception 'Code administrateur invalide';
  end if;
  delete from prodnet_products where id = p_id;
end;
$$;

create or replace function admin_delete_prodnet_matiere(p_id uuid, p_admin_code text)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_code text;
begin
  select value into v_code from app_settings where key = 'admin_code';
  if v_code is null or p_admin_code <> v_code then
    raise exception 'Code administrateur invalide';
  end if;
  delete from prodnet_matieres where id = p_id;
end;
$$;

-- Suppression en masse de toutes les matières premières (bouton « Tout
-- supprimer », réservé admin) : utile pour ré-importer un stock à jour.
create or replace function admin_delete_all_prodnet_matieres(p_admin_code text)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_code text;
begin
  select value into v_code from app_settings where key = 'admin_code';
  if v_code is null or p_admin_code <> v_code then
    raise exception 'Code administrateur invalide';
  end if;
  delete from prodnet_matieres;
end;
$$;

revoke all on function admin_update_prodnet_fabrication(uuid, text, jsonb) from public;
revoke all on function admin_delete_prodnet_fabrication(uuid, text) from public;
revoke all on function admin_delete_prodnet_product(uuid, text) from public;
revoke all on function admin_delete_prodnet_matiere(uuid, text) from public;
revoke all on function admin_delete_all_prodnet_matieres(text) from public;
grant execute on function admin_update_prodnet_fabrication(uuid, text, jsonb) to anon, authenticated;
grant execute on function admin_delete_prodnet_fabrication(uuid, text) to anon, authenticated;
grant execute on function admin_delete_prodnet_product(uuid, text) to anon, authenticated;
grant execute on function admin_delete_prodnet_matiere(uuid, text) to anon, authenticated;
grant execute on function admin_delete_all_prodnet_matieres(text) to anon, authenticated;
