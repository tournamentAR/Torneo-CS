-- Equipos de cuenta: líder crea squad, invita por username; jugador entra con código.
-- Ejecutar en Supabase → SQL Editor después de 001_player_profiles.sql
--
-- Política: solo funciones SECURITY DEFINER modifican squads/squad_members.
-- Lectura vía RLS para miembros del mismo equipo.

alter table public.profiles
  add column if not exists account_mode text
  check (account_mode is null or account_mode in ('leader', 'player'));

create table if not exists public.squads (
  id uuid primary key default gen_random_uuid(),
  leader_id uuid not null references auth.users (id) on delete cascade,
  name text not null,
  invite_code text not null,
  created_at timestamptz not null default now(),
  constraint squads_name_len check (char_length(trim(name)) >= 2 and char_length(name) <= 80)
);

create unique index if not exists squads_invite_code_upper_idx on public.squads (upper(invite_code));
create unique index if not exists squads_one_per_leader_idx on public.squads (leader_id);

create table if not exists public.squad_members (
  id uuid primary key default gen_random_uuid(),
  squad_id uuid not null references public.squads (id) on delete cascade,
  user_id uuid not null references auth.users (id) on delete cascade,
  is_leader boolean not null default false,
  status text not null check (status in ('pending', 'confirmed', 'declined')),
  created_at timestamptz not null default now(),
  unique (squad_id, user_id)
);

-- Un usuario solo puede tener una membresía activa (pendiente o confirmada) en total.
create unique index if not exists squad_members_one_active
  on public.squad_members (user_id)
  where (status in ('pending', 'confirmed'));

alter table public.squads enable row level security;
alter table public.squad_members enable row level security;

drop policy if exists "squads_select_member" on public.squads;
create policy "squads_select_member"
  on public.squads for select
  to authenticated
  using (
    exists (
      select 1 from public.squad_members m
      where m.squad_id = squads.id
        and m.user_id = (select auth.uid())
        and m.status in ('pending', 'confirmed')
    )
  );

drop policy if exists "squad_members_select_same_squad" on public.squad_members;
create policy "squad_members_select_same_squad"
  on public.squad_members for select
  to authenticated
  using (
    exists (
      select 1 from public.squad_members m2
      where m2.squad_id = squad_members.squad_id
        and m2.user_id = (select auth.uid())
        and m2.status in ('pending', 'confirmed')
    )
  );

grant select on table public.squads to authenticated;
grant select on table public.squad_members to authenticated;

-- ---- Funciones ----

create or replace function public.create_squad(p_name text)
returns json
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  v_id uuid;
  v_code text;
  tries int := 0;
  pos int;
begin
  if v_uid is null then
    raise exception 'Tenés que iniciar sesión';
  end if;
  if length(trim(p_name)) < 2 or length(p_name) > 80 then
    raise exception 'Nombre del equipo: entre 2 y 80 caracteres';
  end if;

  if exists (select 1 from public.squads where leader_id = v_uid) then
    raise exception 'Ya tenés un equipo creado';
  end if;

  loop
    v_code := '';
    for pos in 1..8 loop
      v_code := v_code || substr('ABCDEFGHJKLMNPQRSTUVWXYZ23456789', (floor(random() * 32) + 1)::int, 1);
    end loop;
    tries := tries + 1;
    exit when not exists (select 1 from public.squads where upper(invite_code) = v_code);
    if tries > 50 then
      raise exception 'No se pudo generar código de invitación';
    end if;
  end loop;

  insert into public.squads (leader_id, name, invite_code)
  values (v_uid, trim(p_name), v_code)
  returning id into v_id;

  insert into public.squad_members (squad_id, user_id, is_leader, status)
  values (v_id, v_uid, true, 'confirmed');

  return json_build_object('id', v_id, 'invite_code', v_code);
end;
$$;

create or replace function public.invite_squad_member(p_squad_id uuid, p_username text)
returns json
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  v_target uuid;
  v_uname text := lower(trim(p_username));
begin
  if v_uid is null then
    raise exception 'Tenés que iniciar sesión';
  end if;
  if v_uname is null or length(v_uname) < 1 then
    raise exception 'Indicá un nombre de usuario';
  end if;

  if not exists (
    select 1 from public.squads s where s.id = p_squad_id and s.leader_id = v_uid
  ) then
    raise exception 'No sos el líder de ese equipo';
  end if;

  select id into v_target from public.profiles where lower(username) = v_uname limit 1;
  if v_target is null then
    raise exception 'No hay ninguna cuenta con ese nombre de usuario';
  end if;

  if v_target = v_uid then
    raise exception 'No podés invitarte a vos mismo';
  end if;

  if exists (select 1 from public.squads where leader_id = v_target) then
    raise exception 'Ese usuario ya es líder de otro equipo';
  end if;

  if exists (
    select 1 from public.squad_members
    where user_id = v_target
      and status in ('pending', 'confirmed')
      and squad_id <> p_squad_id
  ) then
    raise exception 'Ese jugador ya está en otro equipo o tiene una invitación pendiente';
  end if;

  if exists (
    select 1 from public.squad_members
    where squad_id = p_squad_id and user_id = v_target and status in ('pending', 'confirmed')
  ) then
    raise exception 'Ese jugador ya está en el equipo o tiene invitación pendiente';
  end if;

  if exists (
    select 1 from public.squad_members
    where squad_id = p_squad_id and user_id = v_target and status = 'declined'
  ) then
    update public.squad_members
    set status = 'pending'
    where squad_id = p_squad_id and user_id = v_target;
    return json_build_object('ok', true, 'reinvited', true);
  end if;

  begin
    insert into public.squad_members (squad_id, user_id, is_leader, status)
    values (p_squad_id, v_target, false, 'pending');
  exception
    when unique_violation then
      raise exception 'Ese jugador ya está en otro equipo o tiene una invitación pendiente en otra partida';
  end;

  return json_build_object('ok', true);
end;
$$;

create or replace function public.join_squad_by_code(p_code text)
returns json
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  v_squad public.squads%rowtype;
  cnorm text := upper(trim(p_code));
begin
  if v_uid is null then
    raise exception 'Tenés que iniciar sesión';
  end if;
  if cnorm is null or length(cnorm) < 4 then
    raise exception 'Código inválido';
  end if;

  if exists (select 1 from public.squads where leader_id = v_uid) then
    raise exception 'Como líder no podés unirte a otro equipo; usá el modo líder';
  end if;

  select * into v_squad from public.squads where upper(invite_code) = cnorm limit 1;
  if v_squad.id is null then
    raise exception 'No encontramos un equipo con ese código';
  end if;

  if exists (
    select 1 from public.squad_members
    where squad_id = v_squad.id and user_id = v_uid and status = 'confirmed'
  ) then
    raise exception 'Ya confirmaste tu lugar en este equipo';
  end if;

  if exists (
    select 1 from public.squad_members
    where squad_id = v_squad.id and user_id = v_uid and status = 'pending'
  ) then
    raise exception 'Ya pediste unirte a este equipo; confirmá o rechazá desde tu perfil';
  end if;

  begin
    insert into public.squad_members (squad_id, user_id, is_leader, status)
    values (v_squad.id, v_uid, false, 'pending');
  exception
    when unique_violation then
      raise exception 'Ya estás en otro equipo o tenés otra invitación pendiente';
  end;

  return json_build_object('squad_id', v_squad.id, 'name', v_squad.name);
end;
$$;

create or replace function public.confirm_squad_membership(p_squad_id uuid)
returns json
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  n int;
begin
  if v_uid is null then
    raise exception 'Tenés que iniciar sesión';
  end if;

  update public.squad_members
  set status = 'confirmed'
  where squad_id = p_squad_id
    and user_id = v_uid
    and is_leader = false
    and status = 'pending';

  get diagnostics n = row_count;
  if n < 1 then
    raise exception 'No tenés una invitación pendiente para ese equipo';
  end if;

  return json_build_object('ok', true);
end;
$$;

create or replace function public.decline_squad_invite(p_squad_id uuid)
returns json
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  n int;
begin
  if v_uid is null then
    raise exception 'Tenés que iniciar sesión';
  end if;

  update public.squad_members
  set status = 'declined'
  where squad_id = p_squad_id
    and user_id = v_uid
    and is_leader = false
    and status = 'pending';

  get diagnostics n = row_count;
  if n < 1 then
    raise exception 'No tenés una invitación pendiente para ese equipo';
  end if;

  return json_build_object('ok', true);
end;
$$;

create or replace function public.delete_my_squad()
returns json
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  sid uuid;
begin
  if v_uid is null then
    raise exception 'Tenés que iniciar sesión';
  end if;

  select id into sid from public.squads where leader_id = v_uid limit 1;
  if sid is null then
    raise exception 'No tenés un equipo para eliminar';
  end if;

  delete from public.squads where id = sid;
  return json_build_object('ok', true);
end;
$$;

grant execute on function public.create_squad(text) to authenticated;
grant execute on function public.invite_squad_member(uuid, text) to authenticated;
grant execute on function public.join_squad_by_code(text) to authenticated;
grant execute on function public.confirm_squad_membership(uuid) to authenticated;
grant execute on function public.decline_squad_invite(uuid) to authenticated;
grant execute on function public.delete_my_squad() to authenticated;
