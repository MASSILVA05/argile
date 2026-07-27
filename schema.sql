-- Schéma Supabase : SARL DPR AXXAM - Suivi de chargement
-- À exécuter dans l'éditeur SQL de Supabase (Database > SQL Editor)

create table if not exists entries (
  id uuid primary key default gen_random_uuid(),
  bon_number integer not null unique,
  entry_date date not null default current_date,
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

create policy "Modification des entrées"
  on entries for update
  using (true)
  with check (true);

create policy "Suppression des entrées"
  on entries for delete
  using (true);

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
