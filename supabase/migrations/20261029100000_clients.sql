-- =============================================================================
-- Phael Tech OS — Migração 0007: clientes
-- Dados comuns em public.clients; CPF/CNPJ e observações internas em
-- public.client_sensitive (leitura só com clients.read_sensitive).
-- Toda escrita passa por public.save_client (validação + duplicidade + auditoria).
-- =============================================================================

create extension if not exists unaccent with schema extensions;
create extension if not exists pg_trgm with schema extensions;

-- Normalização para busca: minúsculas e sem acentos. IMMUTABLE para uso em índice.
create or replace function private.normalize_text(p text)
returns text
language sql
immutable
parallel safe
set search_path = ''
as $$
  select lower(extensions.unaccent('extensions.unaccent'::regdictionary, coalesce(p, '')));
$$;

create type public.client_kind as enum ('person', 'company');
create type public.contact_channel as enum ('whatsapp', 'phone', 'email');

create table public.clients (
  id                  uuid primary key default gen_random_uuid(),
  company_id          uuid not null references public.companies (id) on delete restrict,
  code                bigint not null,
  kind                public.client_kind not null default 'person',
  name                text not null check (char_length(btrim(name)) between 2 and 160),
  trade_name          text check (trade_name is null or char_length(trade_name) <= 160),
  email               text check (email is null or (email ~* '^[^@\s]+@[^@\s]+\.[^@\s]+$' and char_length(email) <= 254)),
  phone               text check (phone is null or phone ~ '^[0-9]{10,13}$'),
  whatsapp            text check (whatsapp is null or whatsapp ~ '^[0-9]{10,13}$'),
  preferred_channel   public.contact_channel,
  zip_code            text check (zip_code is null or zip_code ~ '^[0-9]{8}$'),
  street              text check (street is null or char_length(street) <= 160),
  street_number       text check (street_number is null or char_length(street_number) <= 20),
  complement          text check (complement is null or char_length(complement) <= 80),
  district            text check (district is null or char_length(district) <= 80),
  city                text check (city is null or char_length(city) <= 80),
  state               char(2) check (state is null or state ~ '^[A-Z]{2}$'),
  marketing_consent   boolean not null default false,
  consent_updated_at  timestamptz,
  has_tax_id          boolean not null default false,
  search_text         text generated always as (
                        private.normalize_text(
                          name || ' ' || coalesce(trade_name, '') || ' ' || coalesce(email, '') || ' ' ||
                          coalesce(phone, '') || ' ' || coalesce(whatsapp, '') || ' ' || code::text
                        )
                      ) stored,
  archived_at         timestamptz,
  created_by          uuid references auth.users (id) on delete set null,
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now(),
  unique (company_id, id),
  unique (company_id, code)
);
comment on column public.clients.has_tax_id is 'Indica se há CPF/CNPJ cadastrado, sem revelar o valor.';
comment on column public.clients.code is 'Número legível do cliente, sequencial por empresa.';

create index clients_company_name_idx on public.clients (company_id, lower(name));
create index clients_search_trgm_idx on public.clients using gin (search_text extensions.gin_trgm_ops);
create index clients_company_email_idx on public.clients (company_id, lower(email)) where email is not null;
create index clients_company_phone_idx on public.clients (company_id, phone) where phone is not null;

create trigger clients_set_updated_at
  before update on public.clients
  for each row execute function private.set_updated_at();

create trigger clients_audit
  after insert or update on public.clients
  for each row execute function private.audit_row_change('company_id');

create table public.client_sensitive (
  client_id       uuid primary key,
  company_id      uuid not null,
  tax_id          text check (tax_id is null or private.is_valid_tax_id(tax_id)),
  internal_notes  text check (internal_notes is null or char_length(internal_notes) <= 4000),
  updated_at      timestamptz not null default now(),
  foreign key (company_id, client_id) references public.clients (company_id, id) on delete cascade
);
create unique index client_sensitive_tax_id_uq on public.client_sensitive (company_id, tax_id) where tax_id is not null;

create trigger client_sensitive_set_updated_at
  before update on public.client_sensitive
  for each row execute function private.set_updated_at();

create trigger client_sensitive_audit
  after insert or update on public.client_sensitive
  for each row execute function private.audit_row_change('company_id', 'tax_id', 'internal_notes');

-- -----------------------------------------------------------------------------
-- Utilitários de validação
-- -----------------------------------------------------------------------------
create or replace function private.digits(p text)
returns text
language sql
immutable
set search_path = ''
as $$
  select nullif(regexp_replace(coalesce(p, ''), '[^0-9]', '', 'g'), '');
$$;

create or replace function private.clean(p text)
returns text
language sql
immutable
set search_path = ''
as $$
  select nullif(btrim(p), '');
$$;

-- -----------------------------------------------------------------------------
-- Possíveis duplicidades (para avisar antes de salvar)
-- Retorna apenas id, código, nome e o motivo; nunca o CPF/CNPJ.
-- -----------------------------------------------------------------------------
create or replace function public.find_client_duplicates(
  p_company_id uuid,
  p_name       text,
  p_email      text default null,
  p_phone      text default null,
  p_tax_id     text default null,
  p_exclude_id uuid default null
)
returns table (id uuid, code bigint, name text, reason text)
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_email text := lower(private.clean(p_email));
  v_phone text := private.digits(p_phone);
  v_tax   text := private.digits(p_tax_id);
begin
  if not (private.has_permission(p_company_id, 'clients.write')
          or private.has_permission(p_company_id, 'clients.read')) then
    raise exception 'Permissão negada: clients.read' using errcode = '42501';
  end if;

  return query
    select c.id, c.code, c.name, r.reason
    from public.clients c
    left join public.client_sensitive s on s.client_id = c.id
    cross join lateral (
      select case
        when v_tax is not null and s.tax_id = v_tax then 'Mesmo CPF/CNPJ'
        when v_email is not null and lower(c.email) = v_email then 'Mesmo e-mail'
        when v_phone is not null and (c.phone = v_phone or c.whatsapp = v_phone) then 'Mesmo telefone'
        when private.normalize_text(c.name) = private.normalize_text(p_name) then 'Mesmo nome'
      end as reason
    ) r
    where c.company_id = p_company_id
      and c.archived_at is null
      and (p_exclude_id is null or c.id <> p_exclude_id)
      and r.reason is not null
    order by c.name
    limit 5;
end;
$$;

-- -----------------------------------------------------------------------------
-- Criar ou atualizar cliente
-- p_data: { kind, name, trade_name, email, phone, whatsapp, preferred_channel,
--           zip_code, street, street_number, complement, district, city, state,
--           marketing_consent }
-- p_sensitive: { tax_id, internal_notes } — só é aplicado se a chave existir no JSON.
--   Quem não tem clients.read_sensitive pode INFORMAR o CPF/CNPJ (cadastro), mas
--   não pode alterar um valor já existente nem as observações internas.
-- -----------------------------------------------------------------------------
create or replace function public.save_client(
  p_company_id uuid,
  p_client_id  uuid,
  p_data       jsonb,
  p_sensitive  jsonb default '{}'::jsonb
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_id uuid := p_client_id;
  v_kind public.client_kind := coalesce(p_data ->> 'kind', 'person')::public.client_kind;
  v_tax text := private.digits(p_sensitive ->> 'tax_id');
  v_has_sensitive_perm boolean := private.has_permission(p_company_id, 'clients.read_sensitive');
  v_current public.client_sensitive;
  v_consent boolean := coalesce((p_data ->> 'marketing_consent')::boolean, false);
  v_old_consent boolean;
begin
  perform private.require_permission(p_company_id, 'clients.write');

  if v_tax is not null and not private.is_valid_tax_id(v_tax) then
    raise exception 'CPF ou CNPJ inválido' using errcode = '23514';
  end if;
  if v_tax is not null and v_kind = 'person' and length(v_tax) <> 11 then
    raise exception 'Pessoa física deve ter CPF (11 dígitos)' using errcode = '23514';
  end if;
  if v_tax is not null and v_kind = 'company' and length(v_tax) <> 14 then
    raise exception 'Pessoa jurídica deve ter CNPJ (14 dígitos)' using errcode = '23514';
  end if;
  if v_tax is not null and exists (
    select 1 from public.client_sensitive s
    where s.company_id = p_company_id and s.tax_id = v_tax and s.client_id is distinct from v_id
  ) then
    raise exception 'Já existe um cliente com este CPF/CNPJ' using errcode = '23505';
  end if;

  if v_id is null then
    insert into public.clients (
      company_id, code, kind, name, trade_name, email, phone, whatsapp, preferred_channel,
      zip_code, street, street_number, complement, district, city, state,
      marketing_consent, consent_updated_at, created_by
    ) values (
      p_company_id,
      private.next_number(p_company_id, 'client'),
      v_kind,
      btrim(p_data ->> 'name'),
      private.clean(p_data ->> 'trade_name'),
      lower(private.clean(p_data ->> 'email')),
      private.digits(p_data ->> 'phone'),
      private.digits(p_data ->> 'whatsapp'),
      nullif(p_data ->> 'preferred_channel', '')::public.contact_channel,
      private.digits(p_data ->> 'zip_code'),
      private.clean(p_data ->> 'street'),
      private.clean(p_data ->> 'street_number'),
      private.clean(p_data ->> 'complement'),
      private.clean(p_data ->> 'district'),
      private.clean(p_data ->> 'city'),
      upper(private.clean(p_data ->> 'state')),
      v_consent,
      case when v_consent then now() end,
      auth.uid()
    )
    returning id into v_id;
  else
    select marketing_consent into v_old_consent
    from public.clients where id = v_id and company_id = p_company_id for update;
    if not found then
      raise exception 'Cliente não encontrado' using errcode = 'P0002';
    end if;

    update public.clients set
      kind = v_kind,
      name = btrim(p_data ->> 'name'),
      trade_name = private.clean(p_data ->> 'trade_name'),
      email = lower(private.clean(p_data ->> 'email')),
      phone = private.digits(p_data ->> 'phone'),
      whatsapp = private.digits(p_data ->> 'whatsapp'),
      preferred_channel = nullif(p_data ->> 'preferred_channel', '')::public.contact_channel,
      zip_code = private.digits(p_data ->> 'zip_code'),
      street = private.clean(p_data ->> 'street'),
      street_number = private.clean(p_data ->> 'street_number'),
      complement = private.clean(p_data ->> 'complement'),
      district = private.clean(p_data ->> 'district'),
      city = private.clean(p_data ->> 'city'),
      state = upper(private.clean(p_data ->> 'state')),
      marketing_consent = v_consent,
      consent_updated_at = case when v_consent is distinct from v_old_consent then now() else consent_updated_at end
    where id = v_id;
  end if;

  -- Dados sensíveis
  select * into v_current from public.client_sensitive where client_id = v_id;

  if p_sensitive ? 'tax_id' then
    if not v_has_sensitive_perm and v_current.tax_id is not null then
      raise exception 'Somente quem vê dados sensíveis pode alterar o CPF/CNPJ já cadastrado' using errcode = '42501';
    end if;
  end if;
  if p_sensitive ? 'internal_notes' and not v_has_sensitive_perm then
    raise exception 'Permissão negada: clients.read_sensitive' using errcode = '42501';
  end if;

  if p_sensitive ? 'tax_id' or p_sensitive ? 'internal_notes' then
    insert into public.client_sensitive (client_id, company_id, tax_id, internal_notes)
    values (
      v_id, p_company_id,
      case when p_sensitive ? 'tax_id' then v_tax end,
      case when p_sensitive ? 'internal_notes' then private.clean(p_sensitive ->> 'internal_notes') end
    )
    on conflict (client_id) do update set
      tax_id = case when p_sensitive ? 'tax_id' then excluded.tax_id else public.client_sensitive.tax_id end,
      internal_notes = case when p_sensitive ? 'internal_notes' then excluded.internal_notes
                            else public.client_sensitive.internal_notes end;
  end if;

  update public.clients
  set has_tax_id = exists (select 1 from public.client_sensitive s where s.client_id = v_id and s.tax_id is not null)
  where id = v_id;

  return v_id;
end;
$$;

-- Arquivar / reativar (não há exclusão: preserva histórico de OS e financeiro).
create or replace function public.set_client_archived(p_client_id uuid, p_archived boolean)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_company uuid;
begin
  select company_id into v_company from public.clients where id = p_client_id;
  if not found then
    raise exception 'Cliente não encontrado' using errcode = 'P0002';
  end if;
  perform private.require_permission(v_company, 'clients.write');
  update public.clients
  set archived_at = case when p_archived then coalesce(archived_at, now()) end
  where id = p_client_id;
end;
$$;

-- Exportação controlada: exige clients.export, inclui CPF/CNPJ só com
-- clients.read_sensitive e registra o evento na auditoria.
create or replace function public.export_clients(p_company_id uuid, p_include_archived boolean default false)
returns table (
  code bigint, kind public.client_kind, name text, trade_name text, tax_id text, email text,
  phone text, whatsapp text, zip_code text, street text, street_number text, complement text,
  district text, city text, state text, marketing_consent boolean, created_at timestamptz
)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_sensitive boolean;
  v_count int;
begin
  perform private.require_permission(p_company_id, 'clients.export');
  v_sensitive := private.has_permission(p_company_id, 'clients.read_sensitive');

  select count(*) into v_count from public.clients c
  where c.company_id = p_company_id and (p_include_archived or c.archived_at is null);

  perform private.write_audit(p_company_id, 'export', 'clients', null,
    jsonb_build_object('rows', v_count, 'with_tax_id', v_sensitive, 'include_archived', p_include_archived));

  return query
    select c.code, c.kind, c.name, c.trade_name,
           case when v_sensitive then s.tax_id end,
           c.email, c.phone, c.whatsapp, c.zip_code, c.street, c.street_number, c.complement,
           c.district, c.city, c.state::text, c.marketing_consent, c.created_at
    from public.clients c
    left join public.client_sensitive s on s.client_id = c.id
    where c.company_id = p_company_id and (p_include_archived or c.archived_at is null)
    order by c.code;
end;
$$;

-- -----------------------------------------------------------------------------
-- RLS
-- -----------------------------------------------------------------------------
alter table public.clients enable row level security;
alter table public.client_sensitive enable row level security;

grant select on public.clients to authenticated;
grant select on public.client_sensitive to authenticated;

create policy clients_select on public.clients
  for select to authenticated
  using (private.has_permission(company_id, 'clients.read'));

create policy client_sensitive_select on public.client_sensitive
  for select to authenticated
  using (private.has_permission(company_id, 'clients.read_sensitive'));

-- Funções: revogar o EXECUTE padrão de PUBLIC e conceder só o necessário.
revoke execute on all functions in schema public from public, anon;
revoke execute on all functions in schema private from public, anon;

grant execute on function public.find_client_duplicates(uuid, text, text, text, text, uuid) to authenticated;
grant execute on function public.save_client(uuid, uuid, jsonb, jsonb) to authenticated;
grant execute on function public.set_client_archived(uuid, boolean) to authenticated;
grant execute on function public.export_clients(uuid, boolean) to authenticated;
grant execute on function private.normalize_text(text) to authenticated;

-- -----------------------------------------------------------------------------
-- Auditoria: tabelas sem coluna "id" (client_sensitive, overrides) passam a
-- registrar a chave natural em entity_id, para o histórico do registro.
-- -----------------------------------------------------------------------------
create or replace function private.audit_row_change()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_company_col text := tg_argv[0];
  v_old jsonb := case when tg_op in ('UPDATE', 'DELETE') then to_jsonb(old) end;
  v_new jsonb := case when tg_op in ('INSERT', 'UPDATE') then to_jsonb(new) end;
  v_row jsonb := coalesce(v_new, v_old);
  v_changes jsonb := '{}'::jsonb;
  v_key text;
  v_sensitive text[] := coalesce(tg_argv[1:], array[]::text[]);
begin
  if tg_op = 'UPDATE' then
    for v_key in select jsonb_object_keys(v_new) loop
      if v_key in ('updated_at', 'search_text') then
        continue;
      end if;
      if (v_old -> v_key) is distinct from (v_new -> v_key) then
        v_changes := v_changes || jsonb_build_object(
          v_key,
          case when v_key = any (v_sensitive)
            then jsonb_build_object('old', '[redacted]', 'new', '[redacted]')
            else jsonb_build_object('old', v_old -> v_key, 'new', v_new -> v_key)
          end
        );
      end if;
    end loop;
    if v_changes = '{}'::jsonb then
      return new;
    end if;
  else
    v_changes := v_row - 'search_text';
    for v_key in select unnest(v_sensitive) loop
      if v_changes ? v_key then
        v_changes := jsonb_set(v_changes, array[v_key], '"[redacted]"'::jsonb);
      end if;
    end loop;
  end if;

  insert into public.audit_log (company_id, actor_id, action, entity, entity_id, changes)
  values (
    (v_row ->> v_company_col)::uuid,
    auth.uid(),
    lower(tg_op),
    tg_table_name,
    coalesce(v_row ->> 'id', v_row ->> 'client_id', v_row ->> 'member_id'),
    v_changes
  );
  return coalesce(new, old);
end;
$$;
revoke execute on function private.audit_row_change() from public, anon, authenticated;
