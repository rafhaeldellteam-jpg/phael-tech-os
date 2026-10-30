-- =============================================================================
-- Fase 4: Sites e serviços digitais + contratos recorrentes
-- - digital_services: sites, lojas, hospedagem, domínios, e-mails e manutenção
--   por cliente, com vencimento de domínio para alertas.
-- - contracts: cobrança recorrente (mensal, bimestral, trimestral, semestral,
--   anual). generate_contract_charges cria as contas a receber de forma
--   IDEMPOTENTE: cada vencimento de cada contrato vira no máximo um lançamento
--   (índice único em finance_entries (contract_id, period_date)). Rodar de novo
--   não duplica, e uma cobrança cancelada não é recriada.
-- =============================================================================

insert into public.permissions (key, module, description) values
  ('digital.write', 'digital', 'Cadastrar e alterar sites e serviços digitais');
insert into public.role_permissions (role, permission_key) values
  ('admin', 'digital.write'),
  ('attendant', 'digital.write');

create type public.digital_kind as enum ('website', 'ecommerce', 'landing', 'hosting', 'domain', 'email', 'maintenance', 'other');
create type public.digital_status as enum ('planning', 'development', 'active', 'paused', 'canceled');
create type public.contract_status as enum ('active', 'paused', 'ended');

-- -----------------------------------------------------------------------------
-- Serviços digitais
-- -----------------------------------------------------------------------------
create table public.digital_services (
  id                 uuid primary key default gen_random_uuid(),
  company_id         uuid not null references public.companies (id) on delete restrict,
  number             bigint not null,
  client_id          uuid not null,
  kind               public.digital_kind not null default 'website',
  name               text not null check (char_length(btrim(name)) between 2 and 160),
  url                text check (url is null or (char_length(url) <= 300 and url ~* '^https?://[^\s/$.?#].[^\s]*$')),
  status             public.digital_status not null default 'planning',
  repository_url     text check (repository_url is null or (char_length(repository_url) <= 300 and repository_url ~* '^https?://')),
  hosting_provider   text check (hosting_provider is null or char_length(hosting_provider) <= 80),
  domain_expires_on  date,
  launched_on        date,
  notes              text check (notes is null or char_length(notes) <= 4000),
  created_by         uuid references auth.users (id) on delete set null,
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now(),
  unique (company_id, id),
  unique (company_id, number),
  foreign key (company_id, client_id) references public.clients (company_id, id) on delete restrict
);
create index digital_services_client_idx on public.digital_services (company_id, client_id);
create index digital_services_domain_idx on public.digital_services (company_id, domain_expires_on) where domain_expires_on is not null;

create trigger digital_services_set_updated_at before update on public.digital_services
  for each row execute function private.set_updated_at();
create trigger digital_services_audit after insert or update on public.digital_services
  for each row execute function private.audit_row_change('company_id');

-- p_data: client_id, kind, name, url, status, repository_url, hosting_provider, domain_expires_on, launched_on, notes
create or replace function public.save_digital_service(p_company_id uuid, p_id uuid, p_data jsonb)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_id uuid := p_id;
  v_client uuid := nullif(p_data ->> 'client_id', '')::uuid;
begin
  perform private.require_permission(p_company_id, 'digital.write');
  if v_client is null or not exists (select 1 from public.clients where id = v_client and company_id = p_company_id) then
    raise exception 'Cliente não encontrado' using errcode = 'P0002';
  end if;
  if p_id is not null and not exists (select 1 from public.digital_services where id = p_id and company_id = p_company_id) then
    raise exception 'Serviço digital não encontrado' using errcode = 'P0002';
  end if;

  if p_id is null then
    insert into public.digital_services (
      company_id, number, client_id, kind, name, url, status, repository_url, hosting_provider,
      domain_expires_on, launched_on, notes, created_by
    ) values (
      p_company_id, private.next_number(p_company_id, 'digital_service'), v_client,
      coalesce(nullif(p_data ->> 'kind', ''), 'website')::public.digital_kind,
      btrim(coalesce(p_data ->> 'name', '')),
      private.clean(p_data ->> 'url'),
      coalesce(nullif(p_data ->> 'status', ''), 'planning')::public.digital_status,
      private.clean(p_data ->> 'repository_url'),
      private.clean(p_data ->> 'hosting_provider'),
      nullif(p_data ->> 'domain_expires_on', '')::date,
      nullif(p_data ->> 'launched_on', '')::date,
      private.clean(p_data ->> 'notes'),
      auth.uid()
    )
    returning id into v_id;
  else
    update public.digital_services set
      client_id = v_client,
      kind = coalesce(nullif(p_data ->> 'kind', ''), kind::text)::public.digital_kind,
      name = coalesce(nullif(btrim(p_data ->> 'name'), ''), name),
      url = private.clean(p_data ->> 'url'),
      status = coalesce(nullif(p_data ->> 'status', ''), status::text)::public.digital_status,
      repository_url = private.clean(p_data ->> 'repository_url'),
      hosting_provider = private.clean(p_data ->> 'hosting_provider'),
      domain_expires_on = nullif(p_data ->> 'domain_expires_on', '')::date,
      launched_on = nullif(p_data ->> 'launched_on', '')::date,
      notes = private.clean(p_data ->> 'notes')
    where id = p_id;
  end if;
  return v_id;
end;
$$;

-- -----------------------------------------------------------------------------
-- Contratos recorrentes
-- -----------------------------------------------------------------------------
create table public.contracts (
  id                  uuid primary key default gen_random_uuid(),
  company_id          uuid not null references public.companies (id) on delete restrict,
  number              bigint not null,
  client_id           uuid not null,
  digital_service_id  uuid,
  description         text not null check (char_length(btrim(description)) between 3 and 160),
  amount_cents        bigint not null check (amount_cents > 0),
  interval_months     int not null default 1 check (interval_months in (1, 2, 3, 6, 12)),
  billing_day         int not null check (billing_day between 1 and 28),
  start_date          date not null,
  end_date            date,
  category_id         uuid,
  status              public.contract_status not null default 'active',
  status_reason       text check (status_reason is null or char_length(status_reason) <= 500),
  notes               text check (notes is null or char_length(notes) <= 2000),
  created_by          uuid references auth.users (id) on delete set null,
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now(),
  unique (company_id, id),
  unique (company_id, number),
  foreign key (company_id, client_id) references public.clients (company_id, id) on delete restrict,
  foreign key (company_id, digital_service_id) references public.digital_services (company_id, id) on delete restrict,
  foreign key (company_id, category_id) references public.finance_categories (company_id, id) on delete restrict,
  check (end_date is null or end_date >= start_date)
);
create index contracts_client_idx on public.contracts (company_id, client_id);

create trigger contracts_set_updated_at before update on public.contracts
  for each row execute function private.set_updated_at();
create trigger contracts_audit after insert or update on public.contracts
  for each row execute function private.audit_row_change('company_id');

-- Ligação lançamento -> contrato e chave de idempotência por vencimento.
alter table public.finance_entries add column contract_id uuid;
alter table public.finance_entries add column period_date date;
alter table public.finance_entries
  add constraint finance_entries_contract_fk
  foreign key (company_id, contract_id) references public.contracts (company_id, id) on delete restrict;
alter table public.finance_entries add constraint finance_entries_contract_period check ((contract_id is null) = (period_date is null));
create unique index finance_entries_contract_period_uidx on public.finance_entries (contract_id, period_date) where contract_id is not null;

/** Vencimento número k (0, 1, 2…) de um contrato. */
create or replace function private.contract_due(p_start date, p_interval int, p_day int, p_k int)
returns date
language sql
immutable
set search_path = ''
as $$
  select (date_trunc('month', p_start) + make_interval(months => p_k * p_interval))::date + (p_day - 1);
$$;

-- p_data: client_id, digital_service_id, description, amount_cents, interval_months, billing_day,
--         start_date, end_date, category_id, notes
create or replace function public.save_contract(p_company_id uuid, p_id uuid, p_data jsonb)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_id uuid := p_id;
  v_client uuid := nullif(p_data ->> 'client_id', '')::uuid;
  v_service uuid := nullif(p_data ->> 'digital_service_id', '')::uuid;
  v_cat uuid := nullif(p_data ->> 'category_id', '')::uuid;
  v_old public.contracts;
  v_billed boolean;
begin
  perform private.require_permission(p_company_id, 'finance.write');
  if v_client is null or not exists (select 1 from public.clients where id = v_client and company_id = p_company_id) then
    raise exception 'Cliente não encontrado' using errcode = 'P0002';
  end if;
  if v_service is not null and not exists (
    select 1 from public.digital_services where id = v_service and company_id = p_company_id and client_id = v_client
  ) then
    raise exception 'O serviço digital não pertence a este cliente' using errcode = '23514';
  end if;
  if v_cat is not null and not exists (
    select 1 from public.finance_categories where id = v_cat and company_id = p_company_id and direction = 'in'
  ) then
    raise exception 'Escolha uma categoria de receita' using errcode = '23514';
  end if;

  if p_id is not null then
    select * into v_old from public.contracts where id = p_id and company_id = p_company_id for update;
    if not found then
      raise exception 'Contrato não encontrado' using errcode = 'P0002';
    end if;
    if v_old.status = 'ended' then
      raise exception 'Contrato encerrado não pode ser alterado' using errcode = '23514';
    end if;
    v_billed := exists (select 1 from public.finance_entries where contract_id = p_id);
    -- Depois da primeira cobrança, o calendário fica fixo para não desalinhar vencimentos já gerados.
    if v_billed and (
         (p_data ->> 'start_date')::date is distinct from v_old.start_date
      or (p_data ->> 'interval_months')::int is distinct from v_old.interval_months
      or (p_data ->> 'billing_day')::int is distinct from v_old.billing_day
      or v_client is distinct from v_old.client_id
    ) then
      raise exception 'Contrato com cobranças geradas não muda cliente, início, periodicidade ou dia de vencimento. Encerre e crie outro.'
        using errcode = '23514';
    end if;
  end if;

  if p_id is null then
    insert into public.contracts (
      company_id, number, client_id, digital_service_id, description, amount_cents, interval_months,
      billing_day, start_date, end_date, category_id, notes, created_by
    ) values (
      p_company_id, private.next_number(p_company_id, 'contract'), v_client, v_service,
      btrim(coalesce(p_data ->> 'description', '')),
      (p_data ->> 'amount_cents')::bigint,
      coalesce(nullif(p_data ->> 'interval_months', '')::int, 1),
      (p_data ->> 'billing_day')::int,
      (p_data ->> 'start_date')::date,
      nullif(p_data ->> 'end_date', '')::date,
      v_cat,
      private.clean(p_data ->> 'notes'),
      auth.uid()
    )
    returning id into v_id;
  else
    update public.contracts set
      client_id = v_client,
      digital_service_id = v_service,
      description = coalesce(nullif(btrim(p_data ->> 'description'), ''), description),
      amount_cents = (p_data ->> 'amount_cents')::bigint,
      interval_months = (p_data ->> 'interval_months')::int,
      billing_day = (p_data ->> 'billing_day')::int,
      start_date = (p_data ->> 'start_date')::date,
      end_date = nullif(p_data ->> 'end_date', '')::date,
      category_id = v_cat,
      notes = private.clean(p_data ->> 'notes')
    where id = p_id;
  end if;
  return v_id;
end;
$$;

create or replace function public.set_contract_status(p_id uuid, p_status public.contract_status, p_reason text default null)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v public.contracts;
  v_reason text := private.clean(p_reason);
begin
  select * into v from public.contracts where id = p_id for update;
  if not found or not private.is_member(v.company_id) then
    raise exception 'Contrato não encontrado' using errcode = 'P0002';
  end if;
  perform private.require_permission(v.company_id, 'finance.write');
  if not ((v.status = 'active' and p_status in ('paused', 'ended'))
          or (v.status = 'paused' and p_status in ('active', 'ended'))) then
    raise exception 'Mudança de situação não permitida' using errcode = '23514';
  end if;
  if p_status = 'ended' and (v_reason is null or char_length(v_reason) < 3) then
    raise exception 'Informe o motivo do encerramento' using errcode = '23514';
  end if;
  update public.contracts set
    status = p_status,
    status_reason = case when p_status = 'active' then null else v_reason end,
    end_date = case when p_status = 'ended' then coalesce(least(end_date, current_date), current_date) else end_date end
  where id = p_id;
end;
$$;

/**
 * Gera as contas a receber dos contratos ativos com vencimento até p_until.
 * Idempotente: usa ON CONFLICT na chave (contract_id, period_date).
 * Retorna quantos lançamentos foram criados.
 */
create or replace function public.generate_contract_charges(p_company_id uuid, p_until date default null, p_contract_id uuid default null)
returns int
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_until date := coalesce(p_until, current_date + 30);
  c public.contracts;
  v_due date;
  v_k int;
  v_created int := 0;
  v_rows int;
begin
  perform private.require_permission(p_company_id, 'finance.write');
  if v_until > current_date + 400 then
    raise exception 'Gere cobranças com no máximo 400 dias de antecedência' using errcode = '23514';
  end if;

  for c in
    select * from public.contracts
    where company_id = p_company_id and status = 'active'
      and (p_contract_id is null or id = p_contract_id)
    order by number
    for update
  loop
    v_k := 0;
    loop
      v_due := private.contract_due(c.start_date, c.interval_months, c.billing_day, v_k);
      exit when v_due > v_until or (c.end_date is not null and v_due > c.end_date) or v_k > 600;
      if v_due >= c.start_date then
        insert into public.finance_entries (
          company_id, number, direction, description, category_id, client_id, amount_cents,
          issue_date, due_date, contract_id, period_date, notes, created_by
        ) values (
          c.company_id, private.next_number(c.company_id, 'finance_entry'), 'in',
          left(c.description || ' - ' || to_char(v_due, 'MM/YYYY'), 200),
          c.category_id, c.client_id, c.amount_cents,
          least(current_date, v_due), v_due, c.id, v_due,
          'Gerado pelo contrato CT-' || lpad(c.number::text, 4, '0'), auth.uid()
        )
        on conflict (contract_id, period_date) where contract_id is not null do nothing;
        get diagnostics v_rows = row_count;
        v_created := v_created + v_rows;
      end if;
      v_k := v_k + 1;
    end loop;
  end loop;
  return v_created;
end;
$$;

-- Próximo vencimento ainda não gerado de cada contrato (para a tela).
create or replace function public.contract_overview(p_company_id uuid)
returns table (contract_id uuid, next_due date, billed_count bigint, open_cents bigint, overdue_cents bigint)
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  perform private.require_permission(p_company_id, 'finance.read');
  return query
  select
    c.id,
    (select min(d) from (
       select private.contract_due(c.start_date, c.interval_months, c.billing_day, k) as d
       from generate_series(0, 600) k
     ) s
     where s.d >= c.start_date and (c.end_date is null or s.d <= c.end_date)
       and not exists (select 1 from public.finance_entries e where e.contract_id = c.id and e.period_date = s.d)
    ),
    (select count(*) from public.finance_entries e where e.contract_id = c.id and e.canceled_at is null),
    (select coalesce(sum(e.amount_cents - e.paid_cents), 0)::bigint from public.finance_entries e
      where e.contract_id = c.id and e.canceled_at is null),
    (select coalesce(sum(e.amount_cents - e.paid_cents), 0)::bigint from public.finance_entries e
      where e.contract_id = c.id and e.canceled_at is null and e.due_date < current_date)
  from public.contracts c
  where c.company_id = p_company_id;
end;
$$;

-- Domínios vencendo (painel)
create or replace function public.expiring_domains(p_company_id uuid, p_days int default 30)
returns table (id uuid, name text, client_name text, domain_expires_on date)
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  perform private.require_permission(p_company_id, 'clients.read');
  return query
  select d.id, d.name, c.name, d.domain_expires_on
  from public.digital_services d
  join public.clients c on c.id = d.client_id
  where d.company_id = p_company_id
    and d.status not in ('canceled')
    and d.domain_expires_on is not null
    and d.domain_expires_on <= current_date + least(greatest(p_days, 0), 365)
  order by d.domain_expires_on;
end;
$$;

-- -----------------------------------------------------------------------------
-- RLS
-- -----------------------------------------------------------------------------
alter table public.digital_services enable row level security;
alter table public.contracts enable row level security;

create policy digital_services_select on public.digital_services
  for select to authenticated using (private.has_permission(company_id, 'clients.read'));
create policy contracts_select on public.contracts
  for select to authenticated using (private.has_permission(company_id, 'finance.read'));

revoke insert, update, delete on public.digital_services, public.contracts from authenticated, anon;
grant select on public.digital_services, public.contracts to authenticated;

revoke execute on all functions in schema public from public, anon;
revoke execute on all functions in schema private from public, anon;

grant execute on function public.save_digital_service(uuid, uuid, jsonb) to authenticated;
grant execute on function public.save_contract(uuid, uuid, jsonb) to authenticated;
grant execute on function public.set_contract_status(uuid, public.contract_status, text) to authenticated;
grant execute on function public.generate_contract_charges(uuid, date, uuid) to authenticated;
grant execute on function public.contract_overview(uuid) to authenticated;
grant execute on function public.expiring_domains(uuid, int) to authenticated;
grant execute on function private.contract_due(date, int, int, int) to authenticated;
