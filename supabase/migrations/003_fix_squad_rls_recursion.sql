-- Corrige políticas RLS que referencian squad_members dentro de sí mismas:
-- en PostgreSQL eso puede provocar recursión infinita y fallos al leer la tabla.
-- Ejecutá este archivo en Supabase → SQL Editor después de 002.

drop function if exists public.user_in_squad(uuid, uuid);

create or replace function public.current_user_in_squad(p_squad uuid)
returns boolean
language sql
security definer
set search_path = public
stable
as $$
  select exists (
    select 1 from public.squad_members
    where squad_id = p_squad
      and user_id = auth.uid()
      and status in ('pending', 'confirmed')
  );
$$;

grant execute on function public.current_user_in_squad(uuid) to authenticated;

drop policy if exists "squads_select_member" on public.squads;
drop policy if exists "squads_select_if_member" on public.squads;
create policy "squads_select_if_member"
  on public.squads for select
  to authenticated
  using ( public.current_user_in_squad(id) );

drop policy if exists "squad_members_select_same_squad" on public.squad_members;
drop policy if exists "squad_members_select_if_member" on public.squad_members;
create policy "squad_members_select_if_member"
  on public.squad_members for select
  to authenticated
  using ( public.current_user_in_squad(squad_id) );
