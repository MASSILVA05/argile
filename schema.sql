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
