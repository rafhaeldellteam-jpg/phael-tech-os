-- =============================================================================
-- Fase 4: Relatórios
-- Todas as fórmulas estão documentadas em docs/REPORTS.md. Períodos são datas
-- locais (America/Sao_Paulo) inclusivas: [p_from 00:00, p_to 23:59:59].
-- Valores em centavos; nenhum arredondamento de dinheiro.
-- =============================================================================

-- Receita de um item de OS (sem itens removidos): qtd x preço − desconto.
create or replace function private.item_revenue(i public.service_order_items)
returns bigint
language sql
immutable
set search_path = ''
as $$
  select case when i.returned_at is null then i.qty * i.unit_price_cents - i.discount_cents else 0 end;
$$;

create or replace function private.local_range(p_from date, p_to date)
returns tstzrange
language sql
stable
set search_path = ''
as $$
  select tstzrange((p_from::timestamp at time zone 'America/Sao_Paulo'), ((p_to + 1)::timestamp at time zone 'America/Sao_Paulo'), '[)');
$$;

create or replace function private.check_period(p_from date, p_to date)
returns void
language plpgsql
immutable
set search_path = ''
as $$
begin
  if p_from is null or p_to is null or p_to < p_from then
    raise exception 'Período inválido' using errcode = '22023';
  end if;
  if p_to - p_from > 1100 then
    raise exception 'Período máximo de 3 anos' using errcode = '22023';
  end if;
end;
$$;

-- -----------------------------------------------------------------------------
-- 1. Resumo operacional de OS
-- -----------------------------------------------------------------------------
create or replace function public.report_orders_summary(p_company_id uuid, p_from date, p_to date)
returns table (
  opened bigint,
  delivered bigint,
  canceled bigint,
  unrepairable bigint,
  open_now bigint,
  avg_turnaround_hours numeric,
  median_turnaround_hours numeric,
  due_tracked bigint,
  on_time bigint,
  warranty_returns bigint
)
language plpgsql
stable
security definer
set search_path = ''
as $$
#variable_conflict use_column
declare
  r tstzrange;
begin
  perform private.require_permission(p_company_id, 'reports.operational');
  perform private.check_period(p_from, p_to);
  r := private.local_range(p_from, p_to);
  return query
  with o as (select * from public.service_orders where company_id = p_company_id),
  d as (select * from o where delivered_at <@ r and warranty_of is null)
  select
    (select count(*) from o where received_at <@ r),
    (select count(*) from d),
    (select count(*) from o where status = 'canceled' and updated_at <@ r),
    (select count(*) from o where status in ('unrepairable', 'returned_unrepaired', 'quote_refused') and updated_at <@ r),
    (select count(*) from o join public.service_order_statuses s on s.key = o.status where s.stage not in ('done', 'stopped')),
    (select round(avg(extract(epoch from delivered_at - received_at) / 3600)::numeric, 1) from d),
    (select round((percentile_cont(0.5) within group (order by extract(epoch from delivered_at - received_at) / 3600))::numeric, 1) from d),
    (select count(*) from d where due_at is not null),
    (select count(*) from d where due_at is not null and delivered_at <= due_at),
    (select count(*) from o where warranty_of is not null and received_at <@ r);
end;
$$;

-- -----------------------------------------------------------------------------
-- 2. Desempenho por técnico (OS entregues no período)
-- -----------------------------------------------------------------------------
create or replace function public.report_by_technician(p_company_id uuid, p_from date, p_to date)
returns table (user_id uuid, name text, delivered bigint, avg_turnaround_hours numeric, revenue_cents bigint, warranty_returns bigint)
language plpgsql
stable
security definer
set search_path = ''
as $$
#variable_conflict use_column
declare
  r tstzrange;
  v_fin boolean := private.has_permission(p_company_id, 'reports.financial');
begin
  perform private.require_permission(p_company_id, 'reports.operational');
  perform private.check_period(p_from, p_to);
  r := private.local_range(p_from, p_to);
  return query
  with d as (
    select o.* from public.service_orders o
    where o.company_id = p_company_id and o.delivered_at <@ r and o.warranty_of is null
  )
  select
    d.assigned_to,
    coalesce(p.full_name, u.email::text, 'Sem responsável'),
    count(*),
    round(avg(extract(epoch from d.delivered_at - d.received_at) / 3600)::numeric, 1),
    case when v_fin then (select coalesce(sum(private.item_revenue(i)), 0)::bigint from public.service_order_items i where i.order_id = any (array_agg(d.id))) end,
    (select count(*) from public.warranty_claims w where w.original_order_id = any (array_agg(d.id)))
  from d
  left join public.profiles p on p.id = d.assigned_to
  left join auth.users u on u.id = d.assigned_to
  group by d.assigned_to, p.full_name, u.email
  order by count(*) desc;
end;
$$;

-- -----------------------------------------------------------------------------
-- 3. Serviços e peças mais vendidos (OS entregues no período)
-- -----------------------------------------------------------------------------
create or replace function public.report_top_items(p_company_id uuid, p_from date, p_to date, p_limit int default 15)
returns table (kind public.order_item_kind, description text, qty bigint, orders bigint, revenue_cents bigint, cost_cents bigint)
language plpgsql
stable
security definer
set search_path = ''
as $$
#variable_conflict use_column
declare
  r tstzrange;
  v_cost boolean := private.has_permission(p_company_id, 'reports.financial');
begin
  perform private.require_permission(p_company_id, 'reports.operational');
  perform private.check_period(p_from, p_to);
  r := private.local_range(p_from, p_to);
  return query
  select
    i.kind,
    coalesce(c.name, pr.name, i.description),
    sum(i.qty)::bigint,
    count(distinct i.order_id),
    sum(private.item_revenue(i))::bigint,
    case when v_cost then sum(i.qty * i.unit_cost_cents)::bigint end
  from public.service_order_items i
  join public.service_orders o on o.id = i.order_id
  left join public.service_catalog c on c.id = i.catalog_id
  left join public.products pr on pr.id = i.product_id
  where i.company_id = p_company_id and i.returned_at is null and o.delivered_at <@ r
  group by i.kind, coalesce(c.name, pr.name, i.description)
  order by sum(private.item_revenue(i)) desc, sum(i.qty) desc
  limit least(greatest(coalesce(p_limit, 15), 1), 100);
end;
$$;

-- -----------------------------------------------------------------------------
-- 4. Clientes que mais faturaram (contas a receber emitidas no período)
-- -----------------------------------------------------------------------------
create or replace function public.report_top_clients(p_company_id uuid, p_from date, p_to date, p_limit int default 15)
returns table (client_id uuid, name text, entries bigint, billed_cents bigint, received_cents bigint, open_cents bigint)
language plpgsql
stable
security definer
set search_path = ''
as $$
#variable_conflict use_column
begin
  perform private.require_permission(p_company_id, 'reports.financial');
  perform private.check_period(p_from, p_to);
  return query
  select
    c.id, c.name, count(*),
    sum(e.amount_cents)::bigint,
    sum(e.paid_cents)::bigint,
    sum(e.amount_cents - e.paid_cents)::bigint
  from public.finance_entries e
  join public.clients c on c.id = e.client_id
  where e.company_id = p_company_id and e.direction = 'in' and e.canceled_at is null
    and e.issue_date between p_from and p_to
  group by c.id, c.name
  order by sum(e.amount_cents) desc
  limit least(greatest(coalesce(p_limit, 15), 1), 100);
end;
$$;

-- -----------------------------------------------------------------------------
-- 5. Contas a receber por idade (inadimplência), na data de hoje
-- -----------------------------------------------------------------------------
create or replace function public.report_receivables_aging(p_company_id uuid)
returns table (bucket text, sort int, entries bigint, open_cents bigint)
language plpgsql
stable
security definer
set search_path = ''
as $$
#variable_conflict use_column
begin
  perform private.require_permission(p_company_id, 'reports.financial');
  return query
  with b(bucket, sort, lo, hi) as (
    values ('A vencer', 0, null::int, 0), ('1 a 30 dias', 1, 1, 30), ('31 a 60 dias', 2, 31, 60),
           ('61 a 90 dias', 3, 61, 90), ('Mais de 90 dias', 4, 91, null::int)
  ),
  e as (
    select (current_date - due_date) as late, amount_cents - paid_cents as open
    from public.finance_entries
    where company_id = p_company_id and direction = 'in' and canceled_at is null and paid_cents < amount_cents
  )
  select b.bucket, b.sort, count(e.open), coalesce(sum(e.open), 0)::bigint
  from b
  left join e on (b.lo is null and e.late <= b.hi) or (b.hi is null and e.late >= b.lo) or (e.late between b.lo and b.hi)
  group by b.bucket, b.sort
  order by b.sort;
end;
$$;

-- -----------------------------------------------------------------------------
-- 6. Série mensal: OS abertas/entregues, faturamento, recebimentos e pagamentos
-- -----------------------------------------------------------------------------
create or replace function public.report_monthly(p_company_id uuid, p_months int default 12)
returns table (month date, opened bigint, delivered bigint, billed_cents bigint, received_cents bigint, paid_cents bigint)
language plpgsql
stable
security definer
set search_path = ''
as $$
#variable_conflict use_column
declare
  v_n int := least(greatest(coalesce(p_months, 12), 1), 36);
  v_fin boolean := private.has_permission(p_company_id, 'reports.financial');
  v_first date := (date_trunc('month', (now() at time zone 'America/Sao_Paulo')) - make_interval(months => v_n - 1))::date;
begin
  if not (private.has_permission(p_company_id, 'reports.operational') or v_fin) then
    raise exception 'Sem permissão para relatórios' using errcode = '42501';
  end if;
  return query
  with m as (select generate_series(v_first, v_first + make_interval(months => v_n - 1), interval '1 month')::date as month)
  select
    m.month,
    (select count(*) from public.service_orders o where o.company_id = p_company_id
       and o.received_at <@ private.local_range(m.month, (m.month + interval '1 month' - interval '1 day')::date)),
    (select count(*) from public.service_orders o where o.company_id = p_company_id and o.warranty_of is null
       and o.delivered_at <@ private.local_range(m.month, (m.month + interval '1 month' - interval '1 day')::date)),
    case when v_fin then (select coalesce(sum(e.amount_cents), 0)::bigint from public.finance_entries e
       where e.company_id = p_company_id and e.direction = 'in' and e.canceled_at is null
         and date_trunc('month', e.issue_date) = m.month) end,
    case when v_fin then (select coalesce(sum(p.amount_cents), 0)::bigint from public.finance_payments p
       join public.finance_entries e on e.id = p.entry_id
       where p.company_id = p_company_id and e.direction = 'in' and date_trunc('month', p.paid_at) = m.month) end,
    case when v_fin then (select coalesce(sum(p.amount_cents), 0)::bigint from public.finance_payments p
       join public.finance_entries e on e.id = p.entry_id
       where p.company_id = p_company_id and e.direction = 'out' and date_trunc('month', p.paid_at) = m.month) end
  from m
  order by m.month;
end;
$$;

revoke execute on all functions in schema public from public, anon;
revoke execute on all functions in schema private from public, anon;
grant execute on function public.report_orders_summary(uuid, date, date) to authenticated;
grant execute on function public.report_by_technician(uuid, date, date) to authenticated;
grant execute on function public.report_top_items(uuid, date, date, int) to authenticated;
grant execute on function public.report_top_clients(uuid, date, date, int) to authenticated;
grant execute on function public.report_receivables_aging(uuid) to authenticated;
grant execute on function public.report_monthly(uuid, int) to authenticated;
