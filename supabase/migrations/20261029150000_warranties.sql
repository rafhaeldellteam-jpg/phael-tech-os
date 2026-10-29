-- =============================================================================
-- Fase 3: Garantias
-- Garantia nasce de cada item da OS (serviço ou peça) com warranty_days, contada
-- a partir da entrega (service_orders.delivered_at). Um acionamento abre uma OS
-- de retorno vinculada à original e segue um ciclo próprio:
--   aberto -> aceito -> resolvido | aberto -> negado
-- Fora do prazo só é aceito como cortesia, com motivo registrado.
-- =============================================================================

alter table public.service_orders add column warranty_of uuid;
alter table public.service_orders
  add constraint service_orders_warranty_of_fk
  foreign key (company_id, warranty_of) references public.service_orders (company_id, id) on delete restrict;
alter table public.service_orders add constraint service_orders_warranty_not_self check (warranty_of is null or warranty_of <> id);
create index service_orders_warranty_of_idx on public.service_orders (company_id, warranty_of) where warranty_of is not null;

create type public.warranty_claim_status as enum ('open', 'accepted', 'denied', 'resolved');

create table public.warranty_claims (
  id                uuid primary key default gen_random_uuid(),
  company_id        uuid not null references public.companies (id) on delete restrict,
  number            bigint not null,
  original_order_id uuid not null,
  item_id           uuid,
  return_order_id   uuid not null,
  reason            text not null check (char_length(btrim(reason)) between 5 and 2000),
  covered           boolean not null,
  expires_on        date,
  courtesy_reason   text check (courtesy_reason is null or char_length(btrim(courtesy_reason)) between 5 and 500),
  status            public.warranty_claim_status not null default 'open',
  resolution        text check (resolution is null or char_length(resolution) <= 2000),
  decided_by        uuid references auth.users (id) on delete set null,
  decided_at        timestamptz,
  created_by        uuid references auth.users (id) on delete set null,
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now(),
  unique (company_id, id),
  unique (company_id, number),
  unique (return_order_id),
  foreign key (company_id, original_order_id) references public.service_orders (company_id, id) on delete restrict,
  foreign key (company_id, return_order_id) references public.service_orders (company_id, id) on delete restrict,
  foreign key (item_id) references public.service_order_items (id) on delete restrict,
  check (covered or courtesy_reason is not null),
  check ((status = 'open') = (decided_at is null))
);
create index warranty_claims_original_idx on public.warranty_claims (company_id, original_order_id);
create index warranty_claims_status_idx on public.warranty_claims (company_id, status);

create trigger warranty_claims_set_updated_at
  before update on public.warranty_claims
  for each row execute function private.set_updated_at();
create trigger warranty_claims_audit
  after insert or update on public.warranty_claims
  for each row execute function private.audit_row_change('company_id');

-- Garantia padrão de peças (o serviço já tinha no catálogo).
alter table public.products add column warranty_days int check (warranty_days is null or warranty_days between 0 and 3650);
grant update (warranty_days) on public.products to authenticated;

-- p_data: { kind, catalog_id | product_id, description, qty, unit_price_cents, discount_cents, serial_number, warranty_days }
create or replace function public.add_order_item(p_order_id uuid, p_data jsonb)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_order public.service_orders := private.lock_order_for_items(p_order_id);
  v_kind public.order_item_kind := (p_data ->> 'kind')::public.order_item_kind;
  v_qty int := coalesce(nullif(p_data ->> 'qty', '')::int, 1);
  v_cat public.service_catalog;
  v_prod public.products;
  v_desc text := private.clean(p_data ->> 'description');
  v_price bigint := nullif(p_data ->> 'unit_price_cents', '')::bigint;
  v_cost bigint := 0;
  v_warranty int;
  v_serial text := private.clean(p_data ->> 'serial_number');
  v_id uuid;
begin
  if v_kind = 'service' then
    if nullif(p_data ->> 'catalog_id', '') is not null then
      select * into v_cat from public.service_catalog
      where id = (p_data ->> 'catalog_id')::uuid and company_id = v_order.company_id;
      if not found then
        raise exception 'Serviço não encontrado no catálogo' using errcode = 'P0002';
      end if;
      v_desc := coalesce(v_desc, v_cat.name);
      v_price := coalesce(v_price, v_cat.price_cents);
      v_cost := v_cat.cost_cents;
      v_warranty := v_cat.warranty_days;
    end if;
    if v_desc is null or v_price is null then
      raise exception 'Informe a descrição e o valor do serviço' using errcode = '23514';
    end if;
  else
    select * into v_prod from public.products
    where id = (p_data ->> 'product_id')::uuid and company_id = v_order.company_id;
    if not found then
      raise exception 'Peça não encontrada no estoque' using errcode = 'P0002';
    end if;
    v_desc := coalesce(v_desc, v_prod.name);
    v_price := coalesce(v_price, v_prod.price_cents);
    v_warranty := v_prod.warranty_days;
  end if;
  -- Garantia informada na inclusão tem precedência sobre o padrão do catálogo/produto.
  if p_data ? 'warranty_days' then
    v_warranty := nullif(p_data ->> 'warranty_days', '')::int;
  end if;

  insert into public.service_order_items (
    company_id, order_id, kind, catalog_id, product_id, description, qty,
    unit_price_cents, unit_cost_cents, discount_cents, serial_number, warranty_days, added_by
  ) values (
    v_order.company_id, v_order.id, v_kind, v_cat.id, v_prod.id, v_desc, v_qty,
    v_price, v_cost, coalesce(nullif(p_data ->> 'discount_cents', '')::bigint, 0), v_serial, v_warranty, auth.uid()
  )
  returning id into v_id;

  if v_kind = 'part' then
    -- Baixa no estoque com o custo médio do momento (trava a linha do produto).
    perform private.move_stock(v_order.company_id, v_prod.id, 'order_consume', v_qty, null,
      format('OS nº %s', v_order.number), v_serial, v_order.id);
    update public.service_order_items
    set unit_cost_cents = (select unit_cost_cents from public.stock_movements
                           where order_id = v_order.id and product_id = v_prod.id
                           order by id desc limit 1)
    where id = v_id;
  end if;

  insert into public.service_order_events (company_id, order_id, kind, note, actor_id)
  values (v_order.company_id, v_order.id, 'updated',
          format('Incluiu %s: %s (x%s)', case when v_kind = 'part' then 'peça' else 'serviço' end, v_desc, v_qty),
          auth.uid());
  return v_id;
end;
$$;

-- -----------------------------------------------------------------------------
-- Prazo de garantia de cada item de OS entregue (fonte única para tela e RPCs).
-- -----------------------------------------------------------------------------
create or replace function private.item_warranty_end(p_delivered_at timestamptz, p_days int)
returns date
language sql
immutable
set search_path = ''
as $$
  select case
    when p_delivered_at is null or coalesce(p_days, 0) <= 0 then null
    else ((p_delivered_at at time zone 'America/Sao_Paulo')::date + p_days)
  end;
$$;

create or replace function private.today_br()
returns date
language sql
stable
set search_path = ''
as $$
  select (now() at time zone 'America/Sao_Paulo')::date;
$$;

-- -----------------------------------------------------------------------------
-- Lista de garantias
-- p_status: 'active' (vigente), 'expiring' (vence em até 15 dias), 'expired', '' (todas)
-- -----------------------------------------------------------------------------
create or replace function public.list_warranties(
  p_company_id uuid,
  p_status text default 'active',
  p_query text default null,
  p_order_id uuid default null,
  p_limit int default 50,
  p_offset int default 0
)
returns table (
  item_id uuid,
  order_id uuid,
  order_number bigint,
  client_id uuid,
  client_name text,
  equipment_label text,
  kind public.order_item_kind,
  description text,
  serial_number text,
  warranty_days int,
  delivered_at timestamptz,
  expires_on date,
  days_left int,
  open_claims int,
  total_count bigint
)
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_q text := nullif(private.normalize_text(p_query), '');
begin
  if not private.is_member(p_company_id) then
    raise exception 'Acesso negado' using errcode = '42501';
  end if;
  if coalesce(p_status, '') not in ('', 'active', 'expiring', 'expired') then
    raise exception 'Filtro de garantia inválido' using errcode = '22023';
  end if;

  return query
  with base as (
    select
      i.id as item_id, o.id as order_id, o.number as order_number, c.id as client_id, c.name as client_name,
      nullif(concat_ws(' ', e.manufacturer, e.model), '') as equipment_label,
      i.kind, i.description, i.serial_number, i.warranty_days, o.delivered_at,
      private.item_warranty_end(o.delivered_at, i.warranty_days) as expires_on
    from public.service_order_items i
    join public.service_orders o on o.id = i.order_id
    join public.clients c on c.id = o.client_id
    left join public.equipment e on e.id = o.equipment_id
    where i.company_id = p_company_id
      and i.returned_at is null
      and coalesce(i.warranty_days, 0) > 0
      and o.delivered_at is not null
      and o.status not in ('canceled')
      and (p_order_id is null or o.id = p_order_id)
      and private.can_access_order(o.company_id, o.assigned_to)
      and (v_q is null
           or private.normalize_text(c.name) like '%' || v_q || '%'
           or private.normalize_text(i.description) like '%' || v_q || '%'
           or private.normalize_text(coalesce(i.serial_number, '')) like '%' || v_q || '%'
           or private.normalize_text(coalesce(e.serial_number, '')) like '%' || v_q || '%'
           or o.number::text = v_q)
  ), filtered as (
    select b.*, (b.expires_on - private.today_br())::int as days_left
    from base b
    where case coalesce(p_status, '')
      when 'active' then b.expires_on >= private.today_br()
      when 'expiring' then b.expires_on between private.today_br() and private.today_br() + 15
      when 'expired' then b.expires_on < private.today_br()
      else true
    end
  )
  select
    f.item_id, f.order_id, f.order_number, f.client_id, f.client_name, f.equipment_label,
    f.kind, f.description, f.serial_number, f.warranty_days, f.delivered_at, f.expires_on, f.days_left,
    (select count(*)::int from public.warranty_claims w
      where w.original_order_id = f.order_id and w.status in ('open', 'accepted')
        and (w.item_id is null or w.item_id = f.item_id)) as open_claims,
    count(*) over () as total_count
  from filtered f
  order by case when coalesce(p_status, '') = 'expired' then -f.days_left else f.days_left end, f.order_number desc, f.item_id
  limit least(greatest(coalesce(p_limit, 50), 1), 200)
  offset greatest(coalesce(p_offset, 0), 0);
end;
$$;

-- -----------------------------------------------------------------------------
-- Acionar garantia: valida prazo, abre a OS de retorno e registra o acionamento.
-- p_data: item_id (opcional), reason, courtesy_reason (obrigatório fora do prazo),
--         assigned_to (opcional), priority (opcional)
-- -----------------------------------------------------------------------------
create or replace function public.open_warranty_claim(p_order_id uuid, p_data jsonb)
returns table (claim_id uuid, return_order_id uuid)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v public.service_orders := private.lock_order(p_order_id);
  v_item uuid := nullif(p_data ->> 'item_id', '')::uuid;
  v_reason text := btrim(coalesce(p_data ->> 'reason', ''));
  v_courtesy text := private.clean(p_data ->> 'courtesy_reason');
  v_assigned uuid := nullif(p_data ->> 'assigned_to', '')::uuid;
  v_expires date;
  v_covered boolean;
  v_return uuid;
  v_claim uuid;
begin
  perform private.require_permission(v.company_id, 'orders.create');

  if v.delivered_at is null or v.status = 'canceled' then
    raise exception 'Só é possível acionar garantia de OS entregue' using errcode = '23514';
  end if;
  if v.warranty_of is not null then
    raise exception 'Esta OS já é um retorno de garantia. Acione a garantia pela OS original.' using errcode = '23514';
  end if;
  if char_length(v_reason) < 5 then
    raise exception 'Descreva o problema relatado pelo cliente (mínimo 5 caracteres)' using errcode = '23514';
  end if;

  if v_item is not null then
    select private.item_warranty_end(v.delivered_at, i.warranty_days) into v_expires
    from public.service_order_items i
    where i.id = v_item and i.order_id = v.id and i.returned_at is null;
    if not found then
      raise exception 'Item não encontrado nesta OS' using errcode = 'P0002';
    end if;
  else
    select max(private.item_warranty_end(v.delivered_at, i.warranty_days)) into v_expires
    from public.service_order_items i
    where i.order_id = v.id and i.returned_at is null;
  end if;

  v_covered := v_expires is not null and v_expires >= private.today_br();
  if not v_covered and v_courtesy is null then
    raise exception 'Fora do prazo de garantia%. Para atender mesmo assim, informe o motivo da cortesia.',
      case when v_expires is null then ' (item sem garantia)' else ' (venceu em ' || to_char(v_expires, 'DD/MM/YYYY') || ')' end
      using errcode = '23514';
  end if;

  if exists (
    select 1 from public.warranty_claims w
    where w.original_order_id = v.id and w.status in ('open', 'accepted')
      and (w.item_id is not distinct from v_item or w.item_id is null or v_item is null)
  ) then
    raise exception 'Já existe um acionamento de garantia em andamento para esta OS' using errcode = '23505';
  end if;

  perform private.assert_assignable(v.company_id, v_assigned);

  insert into public.service_orders (
    company_id, number, client_id, equipment_id, mode, priority, assigned_to,
    reported_problem, warranty_of, created_by
  ) values (
    v.company_id,
    private.next_number(v.company_id, 'service_order'),
    v.client_id,
    v.equipment_id,
    v.mode,
    coalesce(nullif(p_data ->> 'priority', ''), 'high')::public.order_priority,
    coalesce(v_assigned, v.assigned_to),
    left('Garantia da OS ' || v.number || ': ' || v_reason, 4000),
    v.id,
    auth.uid()
  )
  returning id into v_return;

  insert into public.service_order_events (company_id, order_id, kind, to_status, assigned_to, actor_id, note)
  values (v.company_id, v_return, 'created', 'received', coalesce(v_assigned, v.assigned_to), auth.uid(),
          'Retorno em garantia' || case when v_covered then '' else ' (cortesia: ' || v_courtesy || ')' end);

  insert into public.warranty_claims (
    company_id, number, original_order_id, item_id, return_order_id, reason, covered, expires_on, courtesy_reason, created_by
  ) values (
    v.company_id, private.next_number(v.company_id, 'warranty_claim'), v.id, v_item, v_return,
    v_reason, v_covered, v_expires, case when v_covered then null else v_courtesy end, auth.uid()
  )
  returning id into v_claim;

  insert into public.service_order_events (company_id, order_id, kind, actor_id, note)
  values (v.company_id, v.id, 'note', auth.uid(), 'Garantia acionada: ' || v_reason);

  return query select v_claim, v_return;
end;
$$;

-- -----------------------------------------------------------------------------
-- Decidir acionamento: aceito, negado (com motivo) ou resolvido.
-- -----------------------------------------------------------------------------
create or replace function public.decide_warranty_claim(p_claim_id uuid, p_status public.warranty_claim_status, p_note text default null)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  w public.warranty_claims;
  o public.service_orders;
  v_note text := private.clean(p_note);
begin
  select * into w from public.warranty_claims where id = p_claim_id for update;
  if not found then
    raise exception 'Acionamento não encontrado' using errcode = 'P0002';
  end if;
  o := private.lock_order(w.original_order_id);
  perform private.require_permission(w.company_id, 'orders.update');

  if not ((w.status = 'open' and p_status in ('accepted', 'denied'))
          or (w.status = 'accepted' and p_status = 'resolved')) then
    raise exception 'Mudança de situação não permitida' using errcode = '23514';
  end if;
  if p_status = 'denied' and (v_note is null or char_length(v_note) < 5) then
    raise exception 'Informe o motivo da negativa' using errcode = '23514';
  end if;

  update public.warranty_claims set
    status = p_status,
    resolution = coalesce(v_note, resolution),
    decided_by = auth.uid(),
    decided_at = coalesce(decided_at, now())
  where id = w.id;

  insert into public.service_order_events (company_id, order_id, kind, actor_id, note)
  values (w.company_id, w.return_order_id, 'note', auth.uid(),
          'Garantia ' || case p_status when 'accepted' then 'aceita' when 'denied' then 'negada' else 'resolvida' end
          || coalesce(': ' || v_note, ''));
end;
$$;

-- -----------------------------------------------------------------------------
-- Contagem para o painel
-- -----------------------------------------------------------------------------
create or replace function public.warranty_stats(p_company_id uuid)
returns table (active_items bigint, expiring_items bigint, open_claims bigint)
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if not private.is_member(p_company_id) then
    raise exception 'Acesso negado' using errcode = '42501';
  end if;
  return query
  with items as (
    select private.item_warranty_end(o.delivered_at, i.warranty_days) as ends
    from public.service_order_items i
    join public.service_orders o on o.id = i.order_id
    where i.company_id = p_company_id and i.returned_at is null and coalesce(i.warranty_days, 0) > 0
      and o.delivered_at is not null and o.status <> 'canceled'
      and private.can_access_order(o.company_id, o.assigned_to)
  )
  select
    count(*) filter (where ends >= private.today_br()),
    count(*) filter (where ends between private.today_br() and private.today_br() + 15),
    (select count(*) from public.warranty_claims w
      join public.service_orders o on o.id = w.original_order_id
      where w.company_id = p_company_id and w.status in ('open', 'accepted')
        and private.can_access_order(o.company_id, o.assigned_to))
  from items;
end;
$$;

-- -----------------------------------------------------------------------------
-- RLS
-- -----------------------------------------------------------------------------
alter table public.warranty_claims enable row level security;

create policy warranty_claims_select on public.warranty_claims
  for select to authenticated
  using (exists (
    select 1 from public.service_orders o
    where o.id = original_order_id and private.can_access_order(o.company_id, o.assigned_to)
  ));
-- Escrita somente pelas RPCs acima.
revoke insert, update, delete on public.warranty_claims from authenticated, anon;
grant select on public.warranty_claims to authenticated;

revoke execute on all functions in schema public from public, anon;
revoke execute on all functions in schema private from public, anon;

grant execute on function public.list_warranties(uuid, text, text, uuid, int, int) to authenticated;
grant execute on function public.open_warranty_claim(uuid, jsonb) to authenticated;
grant execute on function public.decide_warranty_claim(uuid, public.warranty_claim_status, text) to authenticated;
grant execute on function public.warranty_stats(uuid) to authenticated;
grant execute on function public.add_order_item(uuid, jsonb) to authenticated;
grant execute on function private.item_warranty_end(timestamptz, int) to authenticated;
grant execute on function private.today_br() to authenticated;
