-- =============================================================================
-- Phael Tech OS — Migração 0010: ordens de serviço
-- Fluxo de status com transições válidas, histórico (quem, quando, motivo),
-- técnico responsável e termos de entrada/entrega.
-- =============================================================================

-- Termos impressos nos comprovantes (editáveis em Dados da empresa).
alter table public.companies
  add column intake_terms text check (intake_terms is null or char_length(intake_terms) <= 4000),
  add column delivery_terms text check (delivery_terms is null or char_length(delivery_terms) <= 4000);
grant update (intake_terms, delivery_terms) on public.companies to authenticated;

-- Atendente registra a entrega ao cliente sem poder mexer no resto da OS.
insert into public.permissions (key, module, description) values
  ('orders.deliver', 'orders', 'Registrar entrega e devolução ao cliente');
insert into public.role_permissions (role, permission_key) values
  ('admin', 'orders.deliver'),
  ('attendant', 'orders.deliver');

-- -----------------------------------------------------------------------------
-- Catálogo de status e transições
-- -----------------------------------------------------------------------------
create table public.service_order_statuses (
  key       text primary key check (key ~ '^[a-z_]+$'),
  label     text not null,
  stage     text not null check (stage in ('open', 'waiting', 'working', 'ready', 'done', 'stopped')),
  sort      int not null,
  is_final  boolean not null default false
);
comment on column public.service_order_statuses.stage is
  'Agrupa para filtros e indicadores: open (entrada), waiting (aguardando terceiros), working (bancada), ready (pronto), done (concluído), stopped (encerrado sem reparo).';

insert into public.service_order_statuses (key, label, stage, sort, is_final) values
  ('received',            'Recebido',              'open',    10, false),
  ('triage',              'Triagem',               'open',    20, false),
  ('diagnosis',           'Diagnóstico',           'working', 30, false),
  ('awaiting_approval',   'Aguardando aprovação',  'waiting', 40, false),
  ('awaiting_parts',      'Aguardando peça',       'waiting', 50, false),
  ('in_repair',           'Em reparo',             'working', 60, false),
  ('testing',             'Em testes',             'working', 70, false),
  ('ready',               'Pronto para retirada',  'ready',   80, false),
  ('delivered',           'Entregue',              'done',    90, false),
  ('closed',              'Encerrado',             'done',   100, true),
  ('quote_refused',       'Orçamento recusado',    'stopped', 110, false),
  ('unrepairable',        'Reparo inviável',       'stopped', 120, false),
  ('returned_unrepaired', 'Devolvido sem reparo',  'stopped', 130, false),
  ('canceled',            'Cancelado',             'stopped', 140, true);

create table public.service_order_transitions (
  from_status      text not null references public.service_order_statuses (key),
  to_status        text not null references public.service_order_statuses (key),
  requires_reason  boolean not null default false,
  primary key (from_status, to_status),
  check (from_status <> to_status)
);

insert into public.service_order_transitions (from_status, to_status, requires_reason) values
  ('received', 'triage', false), ('received', 'diagnosis', false), ('received', 'in_repair', false),
  ('received', 'canceled', true),
  ('triage', 'diagnosis', false), ('triage', 'in_repair', false), ('triage', 'awaiting_approval', false),
  ('triage', 'canceled', true),
  ('diagnosis', 'awaiting_approval', false), ('diagnosis', 'in_repair', false), ('diagnosis', 'awaiting_parts', false),
  ('diagnosis', 'unrepairable', true), ('diagnosis', 'canceled', true),
  ('awaiting_approval', 'in_repair', false), ('awaiting_approval', 'awaiting_parts', false),
  ('awaiting_approval', 'quote_refused', true), ('awaiting_approval', 'canceled', true),
  ('awaiting_parts', 'in_repair', false), ('awaiting_parts', 'canceled', true),
  ('in_repair', 'testing', false), ('in_repair', 'awaiting_parts', false), ('in_repair', 'ready', false),
  ('in_repair', 'unrepairable', true),
  ('testing', 'in_repair', true), ('testing', 'ready', false),
  ('ready', 'delivered', false), ('ready', 'in_repair', true),
  ('quote_refused', 'returned_unrepaired', false),
  ('unrepairable', 'returned_unrepaired', false),
  ('delivered', 'closed', false), ('delivered', 'triage', true),
  ('returned_unrepaired', 'closed', false), ('returned_unrepaired', 'triage', true),
  ('closed', 'triage', true),
  ('canceled', 'triage', true);

-- Transições que representam entrega/devolução ao cliente (permissão orders.deliver basta).
create or replace function private.is_handover_transition(p_from text, p_to text)
returns boolean
language sql
immutable
set search_path = ''
as $$
  select (p_from = 'ready' and p_to = 'delivered')
      or (p_from in ('quote_refused', 'unrepairable') and p_to = 'returned_unrepaired');
$$;

-- -----------------------------------------------------------------------------
-- Ordens de serviço
-- -----------------------------------------------------------------------------
create type public.service_mode as enum ('bench', 'remote', 'onsite');
create type public.order_priority as enum ('low', 'normal', 'high', 'urgent');

create table public.service_orders (
  id                   uuid primary key default gen_random_uuid(),
  company_id           uuid not null references public.companies (id) on delete restrict,
  number               bigint not null,
  client_id            uuid not null,
  equipment_id         uuid,
  mode                 public.service_mode not null default 'bench',
  status               text not null default 'received' references public.service_order_statuses (key),
  priority             public.order_priority not null default 'normal',
  assigned_to          uuid references auth.users (id) on delete set null,
  reported_problem     text not null check (char_length(btrim(reported_problem)) between 3 and 4000),
  symptoms             text check (symptoms is null or char_length(symptoms) <= 4000),
  intake_condition     text check (intake_condition is null or char_length(intake_condition) <= 2000),
  intake_accessories   text[] not null default '{}' check (cardinality(intake_accessories) <= 30),
  device_password_note text check (device_password_note is null or char_length(device_password_note) <= 200),
  due_at               timestamptz,
  received_at          timestamptz not null default now(),
  ready_at             timestamptz,
  delivered_at         timestamptz,
  closed_at            timestamptz,
  created_by           uuid references auth.users (id) on delete set null,
  created_at           timestamptz not null default now(),
  updated_at           timestamptz not null default now(),
  unique (company_id, id),
  unique (company_id, number),
  foreign key (company_id, client_id) references public.clients (company_id, id) on delete restrict,
  foreign key (company_id, equipment_id) references public.equipment (company_id, id) on delete restrict,
  check (mode <> 'bench' or equipment_id is not null)
);
comment on column public.service_orders.device_password_note is
  'Orientação de acesso informada pelo cliente (ex.: "senha com o cliente"). Evite registrar a senha em si.';

create index service_orders_status_idx on public.service_orders (company_id, status);
create index service_orders_assigned_idx on public.service_orders (company_id, assigned_to);
create index service_orders_client_idx on public.service_orders (company_id, client_id);
create index service_orders_equipment_idx on public.service_orders (company_id, equipment_id);
create index service_orders_received_idx on public.service_orders (company_id, received_at desc);

create trigger service_orders_set_updated_at
  before update on public.service_orders
  for each row execute function private.set_updated_at();

create trigger service_orders_audit
  after insert or update on public.service_orders
  for each row execute function private.audit_row_change('company_id', 'device_password_note');

-- Linha do tempo da OS (status, atribuições, observações). Somente inserção.
create type public.order_event_kind as enum ('created', 'status', 'assigned', 'note', 'updated');

create table public.service_order_events (
  id           bigint generated always as identity primary key,
  company_id   uuid not null,
  order_id     uuid not null,
  kind         public.order_event_kind not null,
  from_status  text references public.service_order_statuses (key),
  to_status    text references public.service_order_statuses (key),
  reason       text check (reason is null or char_length(reason) <= 1000),
  note         text check (note is null or char_length(note) <= 4000),
  assigned_to  uuid references auth.users (id) on delete set null,
  actor_id     uuid references auth.users (id) on delete set null,
  created_at   timestamptz not null default now(),
  foreign key (company_id, order_id) references public.service_orders (company_id, id) on delete restrict
);
create index service_order_events_order_idx on public.service_order_events (order_id, created_at);

create trigger service_order_events_immutable
  before update or delete on public.service_order_events
  for each row execute function private.audit_log_immutable();

-- -----------------------------------------------------------------------------
-- Autorização por OS: quem vê todas ou o técnico responsável.
-- -----------------------------------------------------------------------------
create or replace function private.can_access_order(p_company_id uuid, p_assigned_to uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  -- coalesce: OS sem responsável (NULL) nunca conta como "atribuída a mim".
  select coalesce(
    private.has_permission(p_company_id, 'orders.read_all')
      or (private.has_permission(p_company_id, 'orders.read_assigned') and p_assigned_to = auth.uid()),
    false
  );
$$;

create or replace function private.lock_order(p_order_id uuid)
returns public.service_orders
language plpgsql
security definer
set search_path = ''
as $$
declare
  v public.service_orders;
begin
  select * into v from public.service_orders where id = p_order_id for update;
  if not found or private.can_access_order(v.company_id, v.assigned_to) is not true then
    -- Mesma resposta para "não existe" e "não é sua", para não revelar OS alheias.
    raise exception 'Ordem de serviço não encontrada' using errcode = 'P0002';
  end if;
  return v;
end;
$$;

-- Responsável precisa ser membro ativo que possa trabalhar em OS.
create or replace function private.assert_assignable(p_company_id uuid, p_user uuid)
returns void
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if p_user is null then
    return;
  end if;
  if not exists (
    select 1 from public.company_members m
    where m.company_id = p_company_id and m.user_id = p_user and m.status = 'active'
      and m.role in ('admin', 'technician')
  ) then
    raise exception 'O responsável precisa ser um técnico ou administrador ativo' using errcode = '23514';
  end if;
end;
$$;

-- -----------------------------------------------------------------------------
-- Abrir OS
-- p_data: client_id, equipment_id, mode, priority, assigned_to, reported_problem,
--         symptoms, intake_condition, intake_accessories[], device_password_note, due_at
-- -----------------------------------------------------------------------------
create or replace function public.create_service_order(p_company_id uuid, p_data jsonb)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_id uuid;
  v_client uuid := (p_data ->> 'client_id')::uuid;
  v_equipment uuid := nullif(p_data ->> 'equipment_id', '')::uuid;
  v_assigned uuid := nullif(p_data ->> 'assigned_to', '')::uuid;
  v_acc text[];
begin
  perform private.require_permission(p_company_id, 'orders.create');

  if not exists (select 1 from public.clients where id = v_client and company_id = p_company_id and archived_at is null) then
    raise exception 'Cliente não encontrado ou arquivado' using errcode = 'P0002';
  end if;
  if v_equipment is not null and not exists (
    select 1 from public.equipment where id = v_equipment and company_id = p_company_id and client_id = v_client
  ) then
    raise exception 'O equipamento não pertence a este cliente' using errcode = '23514';
  end if;
  perform private.assert_assignable(p_company_id, v_assigned);

  select coalesce(array_agg(btrim(a)) filter (where btrim(a) <> ''), '{}')
  into v_acc
  from jsonb_array_elements_text(coalesce(p_data -> 'intake_accessories', '[]'::jsonb)) a;

  insert into public.service_orders (
    company_id, number, client_id, equipment_id, mode, priority, assigned_to,
    reported_problem, symptoms, intake_condition, intake_accessories, device_password_note, due_at, created_by
  ) values (
    p_company_id,
    private.next_number(p_company_id, 'service_order'),
    v_client,
    v_equipment,
    coalesce(nullif(p_data ->> 'mode', ''), 'bench')::public.service_mode,
    coalesce(nullif(p_data ->> 'priority', ''), 'normal')::public.order_priority,
    v_assigned,
    btrim(p_data ->> 'reported_problem'),
    private.clean(p_data ->> 'symptoms'),
    private.clean(p_data ->> 'intake_condition'),
    v_acc,
    private.clean(p_data ->> 'device_password_note'),
    nullif(p_data ->> 'due_at', '')::timestamptz,
    auth.uid()
  )
  returning id into v_id;

  insert into public.service_order_events (company_id, order_id, kind, to_status, assigned_to, actor_id)
  values (p_company_id, v_id, 'created', 'received', v_assigned, auth.uid());

  return v_id;
end;
$$;

-- -----------------------------------------------------------------------------
-- Editar dados da OS (não muda status; bloqueado em OS finalizada)
-- -----------------------------------------------------------------------------
create or replace function public.update_service_order(p_order_id uuid, p_data jsonb)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v public.service_orders := private.lock_order(p_order_id);
  v_acc text[];
begin
  perform private.require_permission(v.company_id, 'orders.update');
  if v.status in (select key from public.service_order_statuses where stage in ('done', 'stopped')) then
    raise exception 'OS concluída ou encerrada não pode ser editada. Reabra a OS se precisar.' using errcode = '23514';
  end if;

  select coalesce(array_agg(btrim(a)) filter (where btrim(a) <> ''), '{}')
  into v_acc
  from jsonb_array_elements_text(coalesce(p_data -> 'intake_accessories', to_jsonb(v.intake_accessories))) a;

  update public.service_orders set
    priority = coalesce(nullif(p_data ->> 'priority', ''), priority::text)::public.order_priority,
    reported_problem = coalesce(nullif(btrim(p_data ->> 'reported_problem'), ''), reported_problem),
    symptoms = case when p_data ? 'symptoms' then private.clean(p_data ->> 'symptoms') else symptoms end,
    intake_condition = case when p_data ? 'intake_condition' then private.clean(p_data ->> 'intake_condition') else intake_condition end,
    intake_accessories = v_acc,
    device_password_note = case when p_data ? 'device_password_note' then private.clean(p_data ->> 'device_password_note') else device_password_note end,
    due_at = case when p_data ? 'due_at' then nullif(p_data ->> 'due_at', '')::timestamptz else due_at end
  where id = p_order_id;

  insert into public.service_order_events (company_id, order_id, kind, actor_id)
  values (v.company_id, v.id, 'updated', auth.uid());
end;
$$;

-- -----------------------------------------------------------------------------
-- Trocar status (valida a transição, exige motivo quando configurado)
-- -----------------------------------------------------------------------------
create or replace function public.change_service_order_status(p_order_id uuid, p_to text, p_reason text default null)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v public.service_orders := private.lock_order(p_order_id);
  v_rule public.service_order_transitions;
  v_reason text := private.clean(p_reason);
begin
  if not (private.has_permission(v.company_id, 'orders.update')
          or (private.is_handover_transition(v.status, p_to) and private.has_permission(v.company_id, 'orders.deliver'))) then
    raise exception 'Permissão negada: orders.update' using errcode = '42501';
  end if;

  select * into v_rule from public.service_order_transitions where from_status = v.status and to_status = p_to;
  if not found then
    raise exception 'Mudança de status não permitida: % → %',
      (select label from public.service_order_statuses where key = v.status),
      coalesce((select label from public.service_order_statuses where key = p_to), p_to)
      using errcode = '23514';
  end if;
  if v_rule.requires_reason and v_reason is null then
    raise exception 'Informe o motivo desta mudança de status' using errcode = '23514';
  end if;

  update public.service_orders set
    status = p_to,
    ready_at = case when p_to = 'ready' then now() when p_to = 'triage' then null else ready_at end,
    delivered_at = case when p_to in ('delivered', 'returned_unrepaired') then now() when p_to = 'triage' then null else delivered_at end,
    closed_at = case when p_to in ('closed', 'canceled') then now() when p_to = 'triage' then null else closed_at end
  where id = p_order_id;

  insert into public.service_order_events (company_id, order_id, kind, from_status, to_status, reason, actor_id)
  values (v.company_id, v.id, 'status', v.status, p_to, v_reason, auth.uid());
end;
$$;

-- -----------------------------------------------------------------------------
-- Atribuir técnico
-- -----------------------------------------------------------------------------
create or replace function public.assign_service_order(p_order_id uuid, p_user_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v public.service_orders := private.lock_order(p_order_id);
begin
  -- Repassar OS para outra pessoa exige ver todas as OS (coordenação).
  perform private.require_permission(v.company_id, 'orders.update');
  if not private.has_permission(v.company_id, 'orders.read_all') and p_user_id is distinct from auth.uid() then
    raise exception 'Só quem coordena todas as OS pode atribuir a outra pessoa' using errcode = '42501';
  end if;
  perform private.assert_assignable(v.company_id, p_user_id);
  if v.assigned_to is not distinct from p_user_id then
    return;
  end if;

  update public.service_orders set assigned_to = p_user_id where id = p_order_id;
  insert into public.service_order_events (company_id, order_id, kind, assigned_to, actor_id)
  values (v.company_id, v.id, 'assigned', p_user_id, auth.uid());
end;
$$;

-- -----------------------------------------------------------------------------
-- Observação na linha do tempo (qualquer um que acesse a OS)
-- -----------------------------------------------------------------------------
create or replace function public.add_service_order_note(p_order_id uuid, p_note text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v public.service_orders := private.lock_order(p_order_id);
  v_note text := private.clean(p_note);
begin
  if v_note is null then
    raise exception 'Escreva a observação' using errcode = '23514';
  end if;
  insert into public.service_order_events (company_id, order_id, kind, note, actor_id)
  values (v.company_id, v.id, 'note', v_note, auth.uid());
end;
$$;

-- Técnicos e administradores ativos (para escolher responsável).
create or replace function public.list_assignable_members(p_company_id uuid)
returns table (user_id uuid, full_name text, email text, role public.member_role)
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if not (private.has_permission(p_company_id, 'orders.read_all') or private.has_permission(p_company_id, 'orders.create')
          or private.has_permission(p_company_id, 'orders.read_assigned')) then
    raise exception 'Permissão negada' using errcode = '42501';
  end if;
  return query
    select m.user_id, p.full_name, u.email::text, m.role
    from public.company_members m
    join auth.users u on u.id = m.user_id
    left join public.profiles p on p.id = m.user_id
    where m.company_id = p_company_id and m.status = 'active' and m.role in ('admin', 'technician')
    order by coalesce(p.full_name, u.email::text);
end;
$$;

-- Pesquisa global passa a incluir OS.
create or replace function public.global_search(p_company_id uuid, p_query text)
returns table (kind text, id uuid, code bigint, title text, subtitle text)
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_q text := private.normalize_text(btrim(p_query));
  v_digits text := private.digits(p_query);
begin
  if not private.is_member(p_company_id) then
    raise exception 'Permissão negada' using errcode = '42501';
  end if;
  if char_length(v_q) < 2 then
    return;
  end if;

  if v_digits is not null and v_q ~ '^(os)?[\s#-]*[0-9]+$' then
    return query
      select 'order'::text, o.id, o.number, c.name, s.label
      from public.service_orders o
      join public.clients c on c.id = o.client_id
      join public.service_order_statuses s on s.key = o.status
      where o.company_id = p_company_id and o.number = v_digits::bigint
        and private.can_access_order(o.company_id, o.assigned_to);
  end if;

  if private.has_permission(p_company_id, 'clients.read') then
    return query
      select 'client'::text, c.id, c.code, c.name,
             coalesce(nullif(concat_ws(', ', c.whatsapp, c.email), ''), 'Cliente')
      from public.clients c
      where c.company_id = p_company_id and c.archived_at is null
        and c.search_text like '%' || v_q || '%'
      order by c.name
      limit 6;
  end if;

  if private.has_permission(p_company_id, 'equipment.read') then
    return query
      select 'equipment'::text, e.id, e.code,
             coalesce(nullif(concat_ws(' ', e.manufacturer, e.model), ''), t.label),
             c.name
      from public.equipment e
      join public.equipment_types t on t.key = e.type
      join public.clients c on c.id = e.client_id
      where e.company_id = p_company_id and e.archived_at is null
        and e.search_text like '%' || v_q || '%'
      order by e.code desc
      limit 6;
  end if;
end;
$$;

-- Indicadores do painel calculados no banco (respeitam a visibilidade de OS).
create or replace function public.service_order_stats(p_company_id uuid)
returns table (status text, total bigint, overdue bigint)
language sql
stable
security definer
set search_path = ''
as $$
  select o.status, count(*), count(*) filter (where o.due_at < now())
  from public.service_orders o
  join public.service_order_statuses s on s.key = o.status
  where o.company_id = p_company_id
    and s.stage not in ('done', 'stopped')
    and private.can_access_order(o.company_id, o.assigned_to)
  group by o.status;
$$;

-- -----------------------------------------------------------------------------
-- RLS
-- -----------------------------------------------------------------------------
alter table public.service_order_statuses enable row level security;
alter table public.service_order_transitions enable row level security;
alter table public.service_orders enable row level security;
alter table public.service_order_events enable row level security;

grant select on public.service_order_statuses, public.service_order_transitions to authenticated;
grant select on public.service_orders, public.service_order_events to authenticated;

create policy service_order_statuses_select on public.service_order_statuses for select to authenticated using (true);
create policy service_order_transitions_select on public.service_order_transitions for select to authenticated using (true);

create policy service_orders_select on public.service_orders
  for select to authenticated
  using (private.can_access_order(company_id, assigned_to));

create policy service_order_events_select on public.service_order_events
  for select to authenticated
  using (exists (
    select 1 from public.service_orders o
    where o.id = order_id and private.can_access_order(o.company_id, o.assigned_to)
  ));

revoke execute on all functions in schema public from public, anon;
revoke execute on all functions in schema private from public, anon;

grant execute on function public.create_service_order(uuid, jsonb) to authenticated;
grant execute on function public.update_service_order(uuid, jsonb) to authenticated;
grant execute on function public.change_service_order_status(uuid, text, text) to authenticated;
grant execute on function public.assign_service_order(uuid, uuid) to authenticated;
grant execute on function public.add_service_order_note(uuid, text) to authenticated;
grant execute on function public.list_assignable_members(uuid) to authenticated;
grant execute on function public.global_search(uuid, text) to authenticated;
grant execute on function public.service_order_stats(uuid) to authenticated;
grant execute on function private.can_access_order(uuid, uuid) to authenticated;
