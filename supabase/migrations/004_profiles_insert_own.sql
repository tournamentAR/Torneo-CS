-- Permite que un usuario autenticado cree su fila en public.profiles si no existía
-- (p. ej. cuenta creada antes del trigger o fallo al insertar). Sin esto, un UPDATE
-- puede afectar 0 filas y el cliente no siempre lo reporta como error.

grant insert on table public.profiles to authenticated;

drop policy if exists "profiles_insert_own" on public.profiles;
create policy "profiles_insert_own"
  on public.profiles for insert
  to authenticated
  with check (auth.uid() = id);
