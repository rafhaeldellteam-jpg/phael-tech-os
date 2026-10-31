-- =============================================================================
-- Stub mínimo do Supabase para rodar migrações e testes em um PostgreSQL puro
-- (CI sem Docker ou máquina sem Supabase CLI).
-- NÃO aplicar em um projeto Supabase real: lá esses objetos já existem.
-- Reproduz apenas o necessário: papéis anon/authenticated/service_role,
-- auth.users e auth.uid()/auth.jwt() lendo request.jwt.claims (como no Supabase).
-- =============================================================================

do $$
begin
  if not exists (select 1 from pg_roles where rolname = 'anon') then
    create role anon nologin noinherit;
  end if;
  if not exists (select 1 from pg_roles where rolname = 'authenticated') then
    create role authenticated nologin noinherit;
  end if;
  if not exists (select 1 from pg_roles where rolname = 'service_role') then
    create role service_role nologin noinherit bypassrls;
  end if;
end;
$$;

grant usage on schema public to anon, authenticated, service_role;

create schema if not exists auth;
grant usage on schema auth to anon, authenticated, service_role;

create table if not exists auth.users (
  id                  uuid primary key default gen_random_uuid(),
  email               varchar(255),
  raw_user_meta_data  jsonb,
  created_at          timestamptz default now()
);

create or replace function auth.jwt()
returns jsonb
language sql
stable
as $$
  select coalesce(
    nullif(current_setting('request.jwt.claim', true), ''),
    nullif(current_setting('request.jwt.claims', true), '')
  )::jsonb;
$$;

create or replace function auth.uid()
returns uuid
language sql
stable
as $$
  select coalesce(
    nullif(current_setting('request.jwt.claim.sub', true), ''),
    (nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'sub')
  )::uuid;
$$;

grant execute on function auth.uid() to anon, authenticated, service_role;
grant execute on function auth.jwt() to anon, authenticated, service_role;

-- No Supabase o esquema "extensions" já existe e é acessível a anon/authenticated
-- (funções de extensões como unaccent rodam como o usuário da requisição).
create schema if not exists extensions;
grant usage on schema extensions to anon, authenticated, service_role;

-- Armazenamento de arquivos (Supabase Storage): só as tabelas e a função que as
-- políticas usam. No Supabase real elas já existem, com RLS ligado.
create schema if not exists storage;
grant usage on schema storage to anon, authenticated, service_role;
create table if not exists storage.buckets (
  id                 text primary key,
  name               text not null,
  public             boolean default false,
  file_size_limit    bigint,
  allowed_mime_types text[]
);
create table if not exists storage.objects (
  id         uuid primary key default gen_random_uuid(),
  bucket_id  text references storage.buckets (id),
  name       text,
  owner      uuid,
  created_at timestamptz default now(),
  metadata   jsonb,
  unique (bucket_id, name)
);
alter table storage.objects enable row level security;
grant select, insert, update, delete on storage.objects to anon, authenticated, service_role;
grant select on storage.buckets to anon, authenticated, service_role;
create or replace function storage.foldername(name text)
returns text[]
language sql
immutable
as $$
  select (string_to_array(name, '/'))[1:cardinality(string_to_array(name, '/')) - 1];
$$;
grant execute on function storage.foldername(text) to anon, authenticated, service_role;
