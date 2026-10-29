-- =============================================================================
-- Phael Tech OS — Migração 0002: empresas, perfis e membros (multiempresa)
-- =============================================================================

-- -----------------------------------------------------------------------------
-- Empresas (tenants)
-- -----------------------------------------------------------------------------
create table public.companies (
  id          uuid primary key default gen_random_uuid(),
  name        text not null check (char_length(btrim(name)) between 2 and 120),
  legal_name  text check (legal_name is null or char_length(legal_name) <= 200),
  tax_id      text check (tax_id is null or tax_id ~ '^[0-9]{11}$|^[0-9]{14}$'),
  email       text check (email is null or email ~* '^[^@\s]+@[^@\s]+\.[^@\s]+$'),
  phone       text check (phone is null or char_length(phone) <= 30),
  timezone    text not null default 'America/Sao_Paulo',
  currency    char(3) not null default 'BRL',
  created_by  uuid references auth.users (id) on delete set null,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);
comment on table public.companies is 'Empresas (tenants). Todo dado empresarial referencia uma empresa.';
comment on column public.companies.tax_id is 'CPF (11) ou CNPJ (14), apenas dígitos. Validação de dígito verificador na aplicação e em private.is_valid_tax_id.';

create trigger companies_set_updated_at
  before update on public.companies
  for each row execute function private.set_updated_at();

-- -----------------------------------------------------------------------------
-- Perfis de usuário (dados públicos mínimos do usuário autenticado)
-- -----------------------------------------------------------------------------
create table public.profiles (
  id          uuid primary key references auth.users (id) on delete cascade,
  full_name   text check (full_name is null or char_length(full_name) <= 120),
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

create trigger profiles_set_updated_at
  before update on public.profiles
  for each row execute function private.set_updated_at();

-- Cria o perfil automaticamente quando um usuário se cadastra no Supabase Auth.
create or replace function private.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.profiles (id, full_name)
  values (
    new.id,
    nullif(left(btrim(coalesce(new.raw_user_meta_data ->> 'full_name', '')), 120), '')
  )
  on conflict (id) do nothing;
  return new;
end;
$$;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function private.handle_new_user();

-- -----------------------------------------------------------------------------
-- Associação usuário ↔ empresa
-- -----------------------------------------------------------------------------
create table public.company_members (
  id          uuid primary key default gen_random_uuid(),
  company_id  uuid not null references public.companies (id) on delete restrict,
  user_id     uuid not null references auth.users (id) on delete cascade,
  role        public.member_role not null,
  status      public.member_status not null default 'active',
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  unique (company_id, user_id)
);
create index company_members_user_idx on public.company_members (user_id) where status = 'active';

create trigger company_members_set_updated_at
  before update on public.company_members
  for each row execute function private.set_updated_at();

-- -----------------------------------------------------------------------------
-- Funções de autorização (usadas pelas políticas RLS e pelas RPCs)
-- SECURITY DEFINER para evitar recursão de RLS ao consultar company_members.
-- Todas usam auth.uid(): o navegador nunca informa "quem é" o usuário.
-- -----------------------------------------------------------------------------
create or replace function private.is_member(p_company_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.company_members m
    where m.company_id = p_company_id
      and m.user_id = auth.uid()
      and m.status = 'active'
  );
$$;

create or replace function private.member_role(p_company_id uuid)
returns public.member_role
language sql
stable
security definer
set search_path = ''
as $$
  select m.role
  from public.company_members m
  where m.company_id = p_company_id
    and m.user_id = auth.uid()
    and m.status = 'active';
$$;

-- Usuários que compartilham ao menos uma empresa ativa com o usuário atual.
create or replace function private.shares_company_with(p_user_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.company_members me
    join public.company_members other
      on other.company_id = me.company_id
    where me.user_id = auth.uid()
      and me.status = 'active'
      and other.user_id = p_user_id
  );
$$;

grant execute on function private.is_member(uuid) to authenticated;
grant execute on function private.member_role(uuid) to authenticated;
grant execute on function private.shares_company_with(uuid) to authenticated;

-- -----------------------------------------------------------------------------
-- Validação de CPF/CNPJ (dígitos verificadores) — também replicada no frontend.
-- -----------------------------------------------------------------------------
create or replace function private.is_valid_tax_id(p_value text)
returns boolean
language plpgsql
immutable
set search_path = ''
as $$
declare
  d int[];
  s int;
  r int;
  i int;
  w1 int[] := array[5,4,3,2,9,8,7,6,5,4,3,2];
  w2 int[] := array[6,5,4,3,2,9,8,7,6,5,4,3,2];
begin
  if p_value is null then
    return true;
  end if;
  if p_value !~ '^[0-9]{11}$' and p_value !~ '^[0-9]{14}$' then
    return false;
  end if;
  -- Sequências repetidas (000..., 111...) são inválidas.
  if p_value ~ '^(.)\1+$' then
    return false;
  end if;
  d := array(select substr(p_value, g, 1)::int from generate_series(1, length(p_value)) g);

  if length(p_value) = 11 then
    s := 0;
    for i in 1..9 loop s := s + d[i] * (11 - i); end loop;
    r := (s * 10) % 11; if r = 10 then r := 0; end if;
    if r <> d[10] then return false; end if;
    s := 0;
    for i in 1..10 loop s := s + d[i] * (12 - i); end loop;
    r := (s * 10) % 11; if r = 10 then r := 0; end if;
    return r = d[11];
  end if;

  s := 0;
  for i in 1..12 loop s := s + d[i] * w1[i]; end loop;
  r := s % 11; r := case when r < 2 then 0 else 11 - r end;
  if r <> d[13] then return false; end if;
  s := 0;
  for i in 1..13 loop s := s + d[i] * w2[i]; end loop;
  r := s % 11; r := case when r < 2 then 0 else 11 - r end;
  return r = d[14];
end;
$$;
grant execute on function private.is_valid_tax_id(text) to authenticated;

alter table public.companies
  add constraint companies_tax_id_valid check (private.is_valid_tax_id(tax_id));
