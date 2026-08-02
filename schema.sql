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
