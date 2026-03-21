-- Ejecutar en Supabase → SQL Editor (una vez por proyecto).
--
-- Requiere en el panel de Supabase:
-- • Authentication → Providers → Email: activado; "Confirm email" ON para validar con enlace.
-- • Authentication → URL: Site URL = tu origen (ej. http://localhost:5173).
-- • Redirect URLs: incluir http://localhost:5173/cuenta/ y tu dominio de producción + /cuenta/

create table if not exists public.profiles (
  id uuid primary key references auth.users (id) on delete cascade,
  username text not null,
  created_at timestamptz not null default now()
);

create unique index if not exists profiles_username_lower_idx on public.profiles (lower(username));

alter table public.profiles enable row level security;

create policy "profiles_select_all"
  on public.profiles for select
  to authenticated, anon
  using (true);

create policy "profiles_update_own"
  on public.profiles for update
  to authenticated
  using (auth.uid() = id)
  with check (auth.uid() = id);

create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  u text;
begin
  u := coalesce(
    nullif(lower(trim(new.raw_user_meta_data->>'username')), ''),
    split_part(lower(new.email), '@', 1)
  );
  if length(u) < 1 then
    u := 'user_' || left(replace(new.id::text, '-', ''), 12);
  end if;
  insert into public.profiles (id, username) values (new.id, u);
  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute procedure public.handle_new_user();

grant usage on schema public to anon, authenticated;
grant select on table public.profiles to anon, authenticated;
grant update on table public.profiles to authenticated;
