-- ============================================================
-- À exécuter dans l'éditeur SQL Supabase (2026-10-25) -- copie du bloc
-- "SESSIONS : HISTORIQUE + LISTE DES COMPTES + SUPPRESSION DE COMPTE" de
-- schema.sql. Prérequis : bloc "SÉCURITÉ PHASE 1" déjà exécuté.
-- Idempotent : peut être relancé sans risque.
-- ============================================================

-- 1. Historique des sessions terminées.
-- Une session terminée (déconnexion, révocation par un admin, expiration,
-- changement de rôle) est SUPPRIMÉE de active_sessions -- c'est ce qui
-- déconnecte l'appareil. Le trigger ci-dessous la copie avant dans
-- session_history, qui sert d'historique.
create table if not exists session_history (
  id uuid primary key,
  username text not null,
  role text,
  device_info text,
  logged_in_at timestamptz not null,
  last_seen_at timestamptz not null,
  ended_at timestamptz not null default now()
);

create index if not exists session_history_username_idx on session_history (username, logged_in_at desc);

comment on table session_history is 'Sessions terminées (copiées depuis active_sessions à leur suppression) -- page Appareils connectés';

-- RLS sans policy : accessible uniquement via les RPC security definer.
alter table session_history enable row level security;

create or replace function active_sessions_archive()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into session_history (id, username, role, device_info, logged_in_at, last_seen_at, ended_at)
  values (
    OLD.id, OLD.username, OLD.role, OLD.device_info, OLD.logged_in_at, OLD.last_seen_at,
    -- Fin réelle : maintenant si l'appareil était encore actif (déconnexion,
    -- révocation), sinon son dernier heartbeat (session expirée / abandonnée).
    case when now() - OLD.last_seen_at < interval '2 minutes' then now() else OLD.last_seen_at end
  )
  on conflict (id) do nothing;
  return OLD;
end;
$$;

drop trigger if exists active_sessions_archive on active_sessions;
create trigger active_sessions_archive
  before delete on active_sessions
  for each row execute function active_sessions_archive();

-- 2. Historique d'un utilisateur (admin uniquement) : 20 dernières sessions
-- terminées par défaut.
create or replace function admin_session_history(p_session_id text, p_username text, p_limit int default 20)
returns table (
  id text,
  username text,
  role text,
  device_info text,
  logged_in_at timestamptz,
  last_seen_at timestamptz,
  ended_at timestamptz
)
language plpgsql
security definer
set search_path = public
as $$
begin
  if app_session_role(p_session_id) is distinct from 'admin' then
    raise exception 'Accès refusé';
  end if;
  return query
    select h.id::text, h.username, h.role, h.device_info, h.logged_in_at, h.last_seen_at, h.ended_at
    from session_history h
    where h.username = p_username
    order by h.logged_in_at desc
    limit least(greatest(coalesce(p_limit, 20), 1), 100);
end;
$$;

-- 3. Liste des comptes et de leur rôle (admin uniquement) : la page
-- Appareils connectés affiche aussi les comptes sans session, et a besoin du
-- rôle pour proposer la suppression des comptes 'disabled'.
create or replace function admin_list_users(p_session_id text)
returns table (username text, role text)
language plpgsql
security definer
set search_path = public
as $$
begin
  if app_session_role(p_session_id) is distinct from 'admin' then
    raise exception 'Accès refusé';
  end if;
  return query select u.username, u.role from app_users u order by u.username;
end;
$$;

-- 4. Suppression d'un compte (admin uniquement) : réservée aux comptes
-- désactivés (rôle 'disabled'), jamais un admin. Supprime aussi ses
-- sessions, son historique, ses tentatives de connexion et ses codes.
-- Les saisies faites par l'utilisateur (entered_by_user...) sont conservées.
create or replace function admin_delete_user(p_session_id text, p_username text)
returns json
language plpgsql
security definer
set search_path = public
as $$
declare
  v_role text;
begin
  if app_session_role(p_session_id) is distinct from 'admin' then
    raise exception 'Accès refusé';
  end if;

  select role into v_role from app_users where username = p_username;
  if v_role is null then
    raise exception 'Compte introuvable';
  end if;
  if v_role = 'admin' then
    raise exception 'Impossible de supprimer un compte admin';
  end if;
  if v_role <> 'disabled' then
    raise exception 'Seul un compte désactivé peut être supprimé';
  end if;

  delete from login_attempts where username = p_username;
  delete from active_sessions where username = p_username;
  delete from session_history where username = p_username;
  delete from verification_codes where username = p_username;
  delete from app_users where username = p_username;

  return json_build_object('success', true, 'message', 'Compte supprimé');
end;
$$;

revoke all on function active_sessions_archive() from public, anon, authenticated;
grant execute on function admin_session_history(text, text, int) to anon, authenticated;
grant execute on function admin_list_users(text) to anon, authenticated;
grant execute on function admin_delete_user(text, text) to anon, authenticated;
