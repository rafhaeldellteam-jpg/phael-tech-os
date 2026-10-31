-- =============================================================================
-- Integração com o Phael Tech Provision + controle de uso da IA
-- Provision: o relatório .txt do Provision é lido no navegador e importado
--   para a ficha do equipamento (cria ou atualiza pelo número de série) com o
--   histórico de provisionamentos.
-- IA: as chamadas passam por uma Edge Function com a chave no Supabase (nunca
--   no navegador). Cada chamada é registrada e há limite diário por empresa.
-- =============================================================================

create table public.equipment_provisionings (
  id              uuid primary key default gen_random_uuid(),
  company_id      uuid not null,
  equipment_id    uuid not null,
  file_name       text check (file_name is null or char_length(file_name) <= 200),
  provisioned_at  timestamp,
  hostname        text check (hostname is null or char_length(hostname) <= 80),
  summary         jsonb not null default '{}',
  log             text check (log is null or char_length(log) <= 60000),
  created_by      uuid references auth.users (id) on delete set null,
  created_at      timestamptz not null default now(),
  foreign key (company_id, equipment_id) references public.equipment (company_id, id) on delete restrict
);
create index equipment_provisionings_eq_idx on public.equipment_provisionings (equipment_id, created_at desc);
create unique index equipment_provisionings_dedupe_uidx on public.equipment_provisionings (equipment_id, provisioned_at, hostname) nulls not distinct;
create trigger equipment_provisionings_audit after insert on public.equipment_provisionings
  for each row execute function private.audit_row_change('company_id', 'log');

-- p_data: { fields: {manufacturer, model, serial_number, asset_tag, processor, memory, storage, graphics, operating_system},
--           type, file_name, provisioned_at, hostname, summary, log }
create or replace function public.import_provision_report(p_company_id uuid, p_client_id uuid, p_data jsonb)
returns table (equipment_id uuid, created boolean)
language plpgsql
security definer
set search_path = ''
as $$
declare
  f jsonb := coalesce(p_data -> 'fields', '{}');
  v_serial text := nullif(btrim(f ->> 'serial_number'), '');
  e public.equipment;
  v_id uuid;
  v_created boolean := false;
begin
  perform private.require_permission(p_company_id, 'equipment.write');
  if not exists (select 1 from public.clients where id = p_client_id and company_id = p_company_id) then
    raise exception 'Cliente não encontrado' using errcode = 'P0002';
  end if;
  if v_serial is null then
    raise exception 'O relatório não tem número de série' using errcode = '23514';
  end if;

  select * into e from public.equipment
  where company_id = p_company_id and lower(serial_number) = lower(v_serial)
  order by archived_at nulls first, created_at limit 1;

  if found then
    if e.client_id <> p_client_id then
      raise exception 'Este número de série já está cadastrado para outro cliente (EQ-%)', lpad(e.code::text, 4, '0') using errcode = '23505';
    end if;
    v_id := e.id;
    update public.equipment set
      manufacturer = coalesce(nullif(f ->> 'manufacturer', ''), manufacturer),
      model = coalesce(nullif(f ->> 'model', ''), model),
      asset_tag = coalesce(nullif(f ->> 'asset_tag', ''), asset_tag),
      processor = coalesce(nullif(f ->> 'processor', ''), processor),
      memory = coalesce(nullif(f ->> 'memory', ''), memory),
      storage = coalesce(nullif(f ->> 'storage', ''), storage),
      graphics = coalesce(nullif(f ->> 'graphics', ''), graphics),
      operating_system = coalesce(nullif(f ->> 'operating_system', ''), operating_system)
    where id = v_id;
  else
    v_id := public.save_equipment(p_company_id, null, f || jsonb_build_object(
      'client_id', p_client_id, 'type', coalesce(nullif(p_data ->> 'type', ''), 'notebook')));
    v_created := true;
  end if;

  insert into public.equipment_provisionings (company_id, equipment_id, file_name, provisioned_at, hostname, summary, log, created_by)
  values (p_company_id, v_id, left(p_data ->> 'file_name', 200), nullif(p_data ->> 'provisioned_at', '')::timestamp,
          left(nullif(p_data ->> 'hostname', ''), 80), coalesce(p_data -> 'summary', '{}'), left(p_data ->> 'log', 60000), auth.uid())
  on conflict do nothing;
  return query select v_id, v_created;
end;
$$;

-- -----------------------------------------------------------------------------
-- IA: registro e limite diário
-- -----------------------------------------------------------------------------
alter table public.companies add column ai_daily_limit int not null default 50 check (ai_daily_limit between 0 and 1000);
grant update (ai_daily_limit) on public.companies to authenticated;

create table public.ai_requests (
  id            bigint generated always as identity primary key,
  company_id    uuid not null references public.companies (id) on delete cascade,
  user_id       uuid references auth.users (id) on delete set null,
  task          text not null check (task in ('diagnosis', 'client_message')),
  order_id      uuid,
  ok            boolean,
  input_tokens  int,
  output_tokens int,
  error         text check (error is null or char_length(error) <= 300),
  created_at    timestamptz not null default now(),
  finished_at   timestamptz
);
create index ai_requests_company_day_idx on public.ai_requests (company_id, created_at desc);

-- Chamado pela Edge Function (com o token do usuário) antes de falar com a IA.
create or replace function public.ai_begin(p_company_id uuid, p_task text, p_order_id uuid)
returns bigint
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_limit int;
  v_used int;
  v_id bigint;
  o public.service_orders;
begin
  if not private.is_member(p_company_id) then
    raise exception 'Acesso negado' using errcode = '42501';
  end if;
  select * into o from public.service_orders where id = p_order_id and company_id = p_company_id;
  if not found or private.can_access_order(o.company_id, o.assigned_to) is not true then
    raise exception 'OS não encontrada' using errcode = 'P0002';
  end if;
  if p_task = 'diagnosis' and not private.has_permission(p_company_id, 'diagnostics.write') then
    raise exception 'Sem permissão para diagnóstico' using errcode = '42501';
  end if;
  select ai_daily_limit into v_limit from public.companies where id = p_company_id;
  select count(*) into v_used from public.ai_requests
  where company_id = p_company_id and created_at >= date_trunc('day', now() at time zone 'America/Sao_Paulo') at time zone 'America/Sao_Paulo';
  if v_used >= v_limit then
    raise exception 'Limite diário de uso da IA atingido (%). Ajuste em Automações.', v_limit using errcode = '23514';
  end if;
  insert into public.ai_requests (company_id, user_id, task, order_id) values (p_company_id, auth.uid(), p_task, p_order_id)
  returning id into v_id;
  return v_id;
end;
$$;

create or replace function public.ai_finish(p_request_id bigint, p_ok boolean, p_input_tokens int, p_output_tokens int, p_error text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  update public.ai_requests set ok = p_ok, input_tokens = p_input_tokens, output_tokens = p_output_tokens,
    error = left(p_error, 300), finished_at = now()
  where id = p_request_id and user_id = auth.uid() and finished_at is null;
end;
$$;

-- -----------------------------------------------------------------------------
-- RLS e permissões
-- -----------------------------------------------------------------------------
alter table public.equipment_provisionings enable row level security;
alter table public.ai_requests enable row level security;
create policy equipment_provisionings_select on public.equipment_provisionings for select to authenticated
  using (private.has_permission(company_id, 'equipment.read'));
create policy ai_requests_select on public.ai_requests for select to authenticated
  using (private.is_member(company_id));
revoke insert, update, delete on public.equipment_provisionings, public.ai_requests from authenticated, anon;
grant select on public.equipment_provisionings, public.ai_requests to authenticated;

revoke execute on all functions in schema public from public, anon;
revoke execute on all functions in schema private from public, anon;
grant execute on function public.import_provision_report(uuid, uuid, jsonb) to authenticated;
grant execute on function public.ai_begin(uuid, text, uuid) to authenticated;
grant execute on function public.ai_finish(bigint, boolean, int, int, text) to authenticated;
grant execute on function public.portal_order(text) to anon, authenticated;
grant execute on function public.portal_decide(text, boolean, text, text) to anon, authenticated;
grant execute on function public.portal_photos(text) to anon, authenticated;
grant execute on function public.charge_view(text) to anon, authenticated;
grant execute on function private.path_uuid(text, int) to anon, authenticated;
grant execute on function private.is_client_visible_photo(text) to anon, authenticated;
