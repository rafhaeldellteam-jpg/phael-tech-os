-- =============================================================================
-- Fase 3: Agenda
-- Agendamentos de atendimento (visita, remoto, entrega/retirada de equipamento)
-- com responsável, sem sobreposição para o mesmo técnico (constraint de exclusão)
-- e conversão em OS. Situações:
--   scheduled -> confirmed -> done | no_show | canceled   (canceled exige motivo)
-- =============================================================================

create extension if not exists btree_gist with schema extensions;
-- O operador gist para uuid vem do btree_gist (esquema extensions).
set search_path = public, extensions;

create type public.appointment_kind as enum ('onsite', 'remote', 'dropoff', 'pickup', 'other');
create type public.appointment_status as enum ('scheduled', 'confirmed', 'done', 'no_show', 'canceled');

create table public.appointments (
  id             uuid primary key default gen_random_uuid(),
  company_id     uuid not null references public.companies (id) on delete restrict,
  number         bigint not null,
  kind           public.appointment_kind not null default 'onsite',
  title          text not null check (char_length(btrim(title)) between 3 and 160),
  notes          text check (notes is null or char_length(notes) <= 4000),
  client_id      uuid not null,
  equipment_id   uuid,
  order_id       uuid,
  assigned_to    uuid references auth.users (id) on delete set null,
  starts_at      timestamptz not null,
  ends_at        timestamptz not null,
  location       text check (location is null or char_length(location) <= 300),
  status         public.appointment_status not null default 'scheduled',
  status_reason  text check (status_reason is null or char_length(status_reason) <= 500),
  created_by     uuid references auth.users (id) on delete set null,
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now(),
  unique (company_id, id),
  unique (company_id, number),
  foreign key (company_id, client_id) references public.clients (company_id, id) on delete restrict,
  foreign key (company_id, equipment_id) references public.equipment (company_id, id) on delete restrict,
  foreign key (company_id, order_id) references public.service_orders (company_id, id) on delete restrict,
  check (ends_at > starts_at),
  check (ends_at - starts_at <= interval '12 hours'),
  check (status <> 'canceled' or status_reason is not null),
  -- Mesmo técnico não fica em dois atendimentos ativos ao mesmo tempo.
  constraint appointments_no_overlap exclude using gist (
    company_id with =,
    assigned_to with =,
    tstzrange(starts_at, ends_at) with &&
  ) where (assigned_to is not null and status in ('scheduled', 'confirmed'))
);
reset search_path;
create index appointments_company_starts_idx on public.appointments (company_id, starts_at);
create index appointments_assigned_idx on public.appointments (company_id, assigned_to, starts_at);
create index appointments_client_idx on public.appointments (company_id, client_id);

create trigger appointments_set_updated_at
  before update on public.appointments
  for each row execute function private.set_updated_at();
create trigger appointments_audit
  after insert or update on public.appointments
  for each row execute function private.audit_row_change('company_id');

-- Traduz a violação da exclusão para uma mensagem clara.
create or replace function private.raise_overlap()
returns void
language plpgsql
set search_path = ''
as $$
begin
  raise exception 'O responsável já tem outro atendimento nesse horário' using errcode = '23P01';
end;
$$;

-- -----------------------------------------------------------------------------
-- Criar/editar agendamento
-- p_data: kind, title, notes, client_id, equipment_id, assigned_to, starts_at, ends_at, location
-- -----------------------------------------------------------------------------
create or replace function public.save_appointment(p_company_id uuid, p_id uuid, p_data jsonb)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v public.appointments;
  v_id uuid := p_id;
  v_client uuid := (p_data ->> 'client_id')::uuid;
  v_equipment uuid := nullif(p_data ->> 'equipment_id', '')::uuid;
  v_assigned uuid := nullif(p_data ->> 'assigned_to', '')::uuid;
  v_starts timestamptz := (p_data ->> 'starts_at')::timestamptz;
  v_ends timestamptz := (p_data ->> 'ends_at')::timestamptz;
begin
  perform private.require_permission(p_company_id, 'schedule.write');

  if p_id is not null then
    select * into v from public.appointments where id = p_id and company_id = p_company_id for update;
    if not found then
      raise exception 'Agendamento não encontrado' using errcode = 'P0002';
    end if;
    if v.status not in ('scheduled', 'confirmed') then
      raise exception 'Agendamento concluído ou cancelado não pode ser alterado' using errcode = '23514';
    end if;
  end if;

  if v_client is null or not exists (select 1 from public.clients where id = v_client and company_id = p_company_id and archived_at is null) then
    raise exception 'Cliente não encontrado ou arquivado' using errcode = 'P0002';
  end if;
  if v_equipment is not null and not exists (
    select 1 from public.equipment where id = v_equipment and company_id = p_company_id and client_id = v_client
  ) then
    raise exception 'O equipamento não pertence a este cliente' using errcode = '23514';
  end if;
  if v_starts is null or v_ends is null then
    raise exception 'Informe início e fim' using errcode = '23514';
  end if;
  if v_ends <= v_starts then
    raise exception 'O fim precisa ser depois do início' using errcode = '23514';
  end if;
  perform private.assert_assignable(p_company_id, v_assigned);

  begin
    if p_id is null then
      insert into public.appointments (
        company_id, number, kind, title, notes, client_id, equipment_id, assigned_to, starts_at, ends_at, location, created_by
      ) values (
        p_company_id,
        private.next_number(p_company_id, 'appointment'),
        coalesce(nullif(p_data ->> 'kind', ''), 'onsite')::public.appointment_kind,
        btrim(coalesce(p_data ->> 'title', '')),
        private.clean(p_data ->> 'notes'),
        v_client, v_equipment, v_assigned, v_starts, v_ends,
        private.clean(p_data ->> 'location'),
        auth.uid()
      )
      returning id into v_id;
    else
      update public.appointments set
        kind = coalesce(nullif(p_data ->> 'kind', ''), kind::text)::public.appointment_kind,
        title = coalesce(nullif(btrim(p_data ->> 'title'), ''), title),
        notes = case when p_data ? 'notes' then private.clean(p_data ->> 'notes') else notes end,
        client_id = v_client,
        equipment_id = v_equipment,
        assigned_to = v_assigned,
        starts_at = v_starts,
        ends_at = v_ends,
        location = case when p_data ? 'location' then private.clean(p_data ->> 'location') else location end
      where id = p_id;
    end if;
  exception when exclusion_violation then
    perform private.raise_overlap();
  end;
  return v_id;
end;
$$;

-- -----------------------------------------------------------------------------
-- Mudar situação
-- -----------------------------------------------------------------------------
create or replace function public.set_appointment_status(p_id uuid, p_status public.appointment_status, p_reason text default null)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v public.appointments;
  v_reason text := private.clean(p_reason);
begin
  select * into v from public.appointments where id = p_id for update;
  if not found or not private.is_member(v.company_id) then
    raise exception 'Agendamento não encontrado' using errcode = 'P0002';
  end if;
  -- Técnico responsável pode registrar o resultado do próprio atendimento.
  -- coalesce: sem responsável (NULL) nunca conta como "meu atendimento".
  if not coalesce(private.has_permission(v.company_id, 'schedule.write')
          or (v.assigned_to = auth.uid() and p_status in ('done', 'no_show')), false) then
    raise exception 'Sem permissão para alterar este agendamento' using errcode = '42501';
  end if;

  if not ((v.status = 'scheduled' and p_status in ('confirmed', 'done', 'no_show', 'canceled'))
          or (v.status = 'confirmed' and p_status in ('done', 'no_show', 'canceled'))
          or (v.status in ('canceled', 'no_show') and p_status = 'scheduled')) then
    raise exception 'Mudança de situação não permitida' using errcode = '23514';
  end if;
  if p_status = 'canceled' and (v_reason is null or char_length(v_reason) < 3) then
    raise exception 'Informe o motivo do cancelamento' using errcode = '23514';
  end if;

  begin
    update public.appointments
    set status = p_status,
        status_reason = case when p_status = 'scheduled' then null else v_reason end
    where id = p_id;
  exception when exclusion_violation then
    perform private.raise_overlap();
  end;
end;
$$;

-- -----------------------------------------------------------------------------
-- Converter em OS: cria a OS com os dados do agendamento e liga os dois.
-- -----------------------------------------------------------------------------
create or replace function public.convert_appointment_to_order(p_id uuid, p_reported_problem text default null)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v public.appointments;
  v_order uuid;
  v_mode public.service_mode;
begin
  select * into v from public.appointments where id = p_id for update;
  if not found or not private.is_member(v.company_id) then
    raise exception 'Agendamento não encontrado' using errcode = 'P0002';
  end if;
  perform private.require_permission(v.company_id, 'schedule.write');
  if v.order_id is not null then
    raise exception 'Este agendamento já virou uma OS' using errcode = '23505';
  end if;
  if v.status = 'canceled' then
    raise exception 'Agendamento cancelado não vira OS' using errcode = '23514';
  end if;

  v_mode := case v.kind when 'remote' then 'remote' when 'onsite' then 'onsite' else 'bench' end;
  if v_mode = 'bench' and v.equipment_id is null then
    raise exception 'Para OS de bancada, vincule o equipamento ao agendamento' using errcode = '23514';
  end if;

  -- create_service_order valida orders.create e o responsável.
  v_order := public.create_service_order(v.company_id, jsonb_build_object(
    'client_id', v.client_id,
    'equipment_id', v.equipment_id,
    'mode', v_mode,
    'assigned_to', v.assigned_to,
    'reported_problem', coalesce(nullif(btrim(p_reported_problem), ''), v.title || coalesce(E'\n' || v.notes, ''))
  ));

  update public.appointments set order_id = v_order where id = p_id;
  return v_order;
end;
$$;

-- -----------------------------------------------------------------------------
-- Contagem do dia para o painel (fuso da empresa)
-- -----------------------------------------------------------------------------
create or replace function public.appointments_today(p_company_id uuid)
returns table (total bigint, mine bigint, next_starts_at timestamptz)
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_tz text;
  v_day date;
begin
  perform private.require_permission(p_company_id, 'schedule.read');
  select coalesce(timezone, 'America/Sao_Paulo') into v_tz from public.companies where id = p_company_id;
  v_day := (now() at time zone v_tz)::date;
  return query
  select
    count(*),
    count(*) filter (where a.assigned_to = auth.uid()),
    min(a.starts_at) filter (where a.starts_at >= now())
  from public.appointments a
  where a.company_id = p_company_id
    and a.status in ('scheduled', 'confirmed')
    and a.starts_at >= (v_day::timestamp at time zone v_tz)
    and a.starts_at < ((v_day + 1)::timestamp at time zone v_tz);
end;
$$;

-- -----------------------------------------------------------------------------
-- RLS
-- -----------------------------------------------------------------------------
alter table public.appointments enable row level security;

create policy appointments_select on public.appointments
  for select to authenticated
  using (private.has_permission(company_id, 'schedule.read')
         or (assigned_to = auth.uid() and private.is_member(company_id)));

revoke insert, update, delete on public.appointments from authenticated, anon;
grant select on public.appointments to authenticated;

revoke execute on all functions in schema public from public, anon;
revoke execute on all functions in schema private from public, anon;

grant execute on function public.save_appointment(uuid, uuid, jsonb) to authenticated;
grant execute on function public.set_appointment_status(uuid, public.appointment_status, text) to authenticated;
grant execute on function public.convert_appointment_to_order(uuid, text) to authenticated;
grant execute on function public.appointments_today(uuid) to authenticated;
