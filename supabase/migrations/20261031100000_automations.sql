-- =============================================================================
-- Fase 4: Automações
-- 1. Cobrança automática dos contratos: todo dia gera as contas a receber que
--    vencem nos próximos N dias (idempotente, reaproveita a chave única por
--    contrato e vencimento). Roda pelo agendador do banco (pg_cron, quando
--    disponível) e também na abertura do painel, no máximo uma vez por dia.
-- 2. Avisos calculados na hora (sem tabela para ficar desatualizada): contas
--    vencidas, contas a pagar próximas, domínios, OS paradas, prontas sem
--    retirada e garantias acabando. Cada aviso respeita as permissões de quem vê.
-- 3. Histórico de execuções (automation_runs), imutável.
-- =============================================================================

alter table public.companies
  add column auto_billing_enabled boolean not null default true,
  add column auto_billing_days_ahead int not null default 10 check (auto_billing_days_ahead between 0 and 60),
  add column stalled_order_days int not null default 7 check (stalled_order_days between 1 and 90);
grant update (auto_billing_enabled, auto_billing_days_ahead, stalled_order_days) on public.companies to authenticated;

create table public.automation_runs (
  id            bigint generated always as identity primary key,
  company_id    uuid not null references public.companies (id) on delete cascade,
  job           text not null check (job in ('contract_billing')),
  trigger       text not null check (trigger in ('schedule', 'dashboard', 'manual')),
  run_date      date not null default (now() at time zone 'America/Sao_Paulo')::date,
  started_at    timestamptz not null default now(),
  finished_at   timestamptz,
  ok            boolean not null,
  created_count int not null default 0,
  detail        text check (detail is null or char_length(detail) <= 1000),
  actor_id      uuid references auth.users (id) on delete set null
);
create index automation_runs_company_idx on public.automation_runs (company_id, started_at desc);
-- No máximo uma execução automática bem-sucedida por empresa, tarefa e dia.
create unique index automation_runs_daily_uidx on public.automation_runs (company_id, job, run_date)
  where ok and trigger in ('schedule', 'dashboard');

create trigger automation_runs_immutable
  before update or delete on public.automation_runs
  for each row execute function private.audit_log_immutable();

-- -----------------------------------------------------------------------------
-- Núcleo da cobrança de contratos (sem checagem de permissão; chamado por quem já checou)
-- -----------------------------------------------------------------------------
create or replace function private.generate_contract_charges_core(p_company_id uuid, p_until date, p_contract_id uuid)
returns int
language plpgsql
security definer
set search_path = ''
as $$
declare
  c public.contracts;
  v_due date;
  v_k int;
  v_created int := 0;
  v_rows int;
begin
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
      exit when v_due > p_until or (c.end_date is not null and v_due > c.end_date) or v_k > 600;
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

-- A função pública mantém a assinatura e as regras; só delega ao núcleo.
create or replace function public.generate_contract_charges(p_company_id uuid, p_until date default null, p_contract_id uuid default null)
returns int
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_until date := coalesce(p_until, current_date + 30);
begin
  perform private.require_permission(p_company_id, 'finance.write');
  if v_until > current_date + 400 then
    raise exception 'Gere cobranças com no máximo 400 dias de antecedência' using errcode = '23514';
  end if;
  return private.generate_contract_charges_core(p_company_id, v_until, p_contract_id);
end;
$$;

-- Executa a cobrança automática de uma empresa e registra o resultado.
create or replace function private.run_contract_billing(p_company_id uuid, p_trigger text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  co public.companies;
  v_today date := (now() at time zone 'America/Sao_Paulo')::date;
  v_n int;
begin
  select * into co from public.companies where id = p_company_id;
  if not co.auto_billing_enabled and p_trigger <> 'manual' then
    return jsonb_build_object('job', 'contract_billing', 'skipped', 'desativada');
  end if;
  if p_trigger <> 'manual' and exists (
    select 1 from public.automation_runs
    where company_id = p_company_id and job = 'contract_billing' and run_date = v_today and ok and trigger in ('schedule', 'dashboard')
  ) then
    return jsonb_build_object('job', 'contract_billing', 'skipped', 'já executada hoje');
  end if;

  begin
    v_n := private.generate_contract_charges_core(p_company_id, v_today + co.auto_billing_days_ahead, null);
    insert into public.automation_runs (company_id, job, trigger, run_date, finished_at, ok, created_count, detail, actor_id)
    values (p_company_id, 'contract_billing', p_trigger, v_today, now(), true, v_n,
            format('Vencimentos até %s', to_char(v_today + co.auto_billing_days_ahead, 'DD/MM/YYYY')), auth.uid())
    on conflict do nothing;
    return jsonb_build_object('job', 'contract_billing', 'created', v_n);
  exception when others then
    insert into public.automation_runs (company_id, job, trigger, run_date, finished_at, ok, detail, actor_id)
    values (p_company_id, 'contract_billing', p_trigger, v_today, now(), false, left(sqlerrm, 1000), auth.uid());
    return jsonb_build_object('job', 'contract_billing', 'error', sqlerrm);
  end;
end;
$$;

-- Chamado pelo painel (qualquer membro ativo dispara; roda no máximo 1x por dia).
create or replace function public.run_automations(p_company_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not private.is_member(p_company_id) then
    raise exception 'Acesso negado' using errcode = '42501';
  end if;
  return jsonb_build_array(private.run_contract_billing(p_company_id, 'dashboard'));
end;
$$;

-- "Rodar agora" na tela de automações: exige quem pode lançar no financeiro.
create or replace function public.run_contract_billing_now(p_company_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform private.require_permission(p_company_id, 'finance.write');
  return private.run_contract_billing(p_company_id, 'manual');
end;
$$;

-- Agendador: todas as empresas.
create or replace function private.run_scheduled_automations()
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  c uuid;
begin
  for c in select id from public.companies loop
    perform private.run_contract_billing(c, 'schedule');
  end loop;
end;
$$;

-- -----------------------------------------------------------------------------
-- Avisos
-- -----------------------------------------------------------------------------
create or replace function public.automation_alerts(p_company_id uuid)
returns table (kind text, severity text, title text, total bigint, amount_cents bigint, items jsonb, link text)
language plpgsql
stable
security definer
set search_path = ''
as $$
#variable_conflict use_column
declare
  v_today date := (now() at time zone 'America/Sao_Paulo')::date;
  v_fin boolean := private.has_permission(p_company_id, 'finance.read');
  v_cli boolean := private.has_permission(p_company_id, 'clients.read');
  v_stall int;
begin
  if not private.is_member(p_company_id) then
    raise exception 'Acesso negado' using errcode = '42501';
  end if;
  select stalled_order_days into v_stall from public.companies where id = p_company_id;

  if v_fin then
    return query
    select 'overdue_receivables', 'danger', 'Contas a receber vencidas', count(*), coalesce(sum(e.amount_cents - e.paid_cents), 0)::bigint,
      coalesce(jsonb_agg(jsonb_build_object('label', e.description, 'sub', coalesce(cl.name, ''), 'date', e.due_date, 'cents', e.amount_cents - e.paid_cents)
        order by e.due_date) filter (where e.rn <= 5), '[]'), '/financeiro?aba=receber'
    from (select f.*, row_number() over (order by f.due_date) rn from public.finance_entries f
          where f.company_id = p_company_id and f.direction = 'in' and f.canceled_at is null and f.paid_cents < f.amount_cents and f.due_date < v_today) e
    left join public.clients cl on cl.id = e.client_id
    having count(*) > 0;

    return query
    select 'payables_due', 'attn', 'Contas a pagar vencendo em até 3 dias (ou vencidas)', count(*), coalesce(sum(e.amount_cents - e.paid_cents), 0)::bigint,
      coalesce(jsonb_agg(jsonb_build_object('label', e.description, 'sub', coalesce(s.name, ''), 'date', e.due_date, 'cents', e.amount_cents - e.paid_cents)
        order by e.due_date) filter (where e.rn <= 5), '[]'), '/financeiro?aba=pagar'
    from (select f.*, row_number() over (order by f.due_date) rn from public.finance_entries f
          where f.company_id = p_company_id and f.direction = 'out' and f.canceled_at is null and f.paid_cents < f.amount_cents and f.due_date <= v_today + 3) e
    left join public.suppliers s on s.id = e.supplier_id
    having count(*) > 0;
  end if;

  if v_cli then
    return query
    select 'domains', 'attn', 'Domínios vencendo em até 30 dias', count(*), null::bigint,
      coalesce(jsonb_agg(jsonb_build_object('label', d.name, 'sub', cl.name, 'date', d.domain_expires_on) order by d.domain_expires_on) filter (where d.rn <= 5), '[]'),
      '/sites'
    from (select x.*, row_number() over (order by x.domain_expires_on) rn from public.digital_services x
          where x.company_id = p_company_id and x.status <> 'canceled' and x.domain_expires_on <= v_today + 30) d
    join public.clients cl on cl.id = d.client_id
    having count(*) > 0;
  end if;

  -- OS: só as que a pessoa pode ver.
  return query
  select 'stalled_orders', 'attn', format('OS paradas há mais de %s dias no mesmo status', v_stall), count(*), null::bigint,
    coalesce(jsonb_agg(jsonb_build_object('label', 'OS-' || lpad(o.number::text, 4, '0'), 'sub', o.status_label, 'date', o.since::date, 'id', o.id)
      order by o.since) filter (where o.rn <= 5), '[]'),
    '/ordens?etapa=active'
  from (
    select so.id, so.number, st.label as status_label, ev.since, row_number() over (order by ev.since) rn
    from public.service_orders so
    join public.service_order_statuses st on st.key = so.status
    cross join lateral (select max(e.created_at) as since from public.service_order_events e
                        where e.order_id = so.id and e.kind in ('created', 'status')) ev
    where so.company_id = p_company_id and st.stage not in ('done', 'stopped', 'ready')
      and ev.since < now() - make_interval(days => v_stall)
      and private.can_access_order(so.company_id, so.assigned_to)
  ) o
  having count(*) > 0;

  return query
  select 'ready_not_picked', 'attn', 'Prontas há mais de 3 dias sem retirada', count(*), null::bigint,
    coalesce(jsonb_agg(jsonb_build_object('label', 'OS-' || lpad(o.number::text, 4, '0'), 'sub', o.client_name, 'date', o.ready_at::date, 'id', o.id)
      order by o.ready_at) filter (where o.rn <= 5), '[]'),
    '/ordens?status=ready'
  from (
    select so.id, so.number, so.ready_at, cl.name as client_name, row_number() over (order by so.ready_at) rn
    from public.service_orders so join public.clients cl on cl.id = so.client_id
    where so.company_id = p_company_id and so.status = 'ready' and so.ready_at < now() - interval '3 days'
      and private.can_access_order(so.company_id, so.assigned_to)
  ) o
  having count(*) > 0;

  return query
  select 'warranties_expiring', 'info', 'Garantias acabando em até 15 dias', count(*), null::bigint,
    coalesce(jsonb_agg(jsonb_build_object('label', w.description, 'sub', w.client_name, 'date', w.expires_on, 'id', w.order_id)
      order by w.expires_on) filter (where w.rn <= 5), '[]'),
    '/garantias'
  from (
    select x.*, row_number() over (order by x.expires_on) rn
    from public.list_warranties(p_company_id, 'expiring', null, null, 200, 0) x
  ) w
  having count(*) > 0;
end;
$$;

-- -----------------------------------------------------------------------------
-- RLS e permissões
-- -----------------------------------------------------------------------------
alter table public.automation_runs enable row level security;
create policy automation_runs_select on public.automation_runs
  for select to authenticated using (private.is_member(company_id));
revoke insert, update, delete on public.automation_runs from authenticated, anon;
grant select on public.automation_runs to authenticated;

revoke execute on all functions in schema public from public, anon;
revoke execute on all functions in schema private from public, anon;
grant execute on function public.portal_order(text) to anon, authenticated;
grant execute on function public.portal_decide(text, boolean, text, text) to anon, authenticated;
grant execute on function public.generate_contract_charges(uuid, date, uuid) to authenticated;
grant execute on function public.run_automations(uuid) to authenticated;
grant execute on function public.run_contract_billing_now(uuid) to authenticated;
grant execute on function public.automation_alerts(uuid) to authenticated;

-- -----------------------------------------------------------------------------
-- Agendamento diário (06:17 em São Paulo = 09:17 UTC), se o pg_cron existir.
-- No PostgreSQL puro do CI ele não existe: o painel cobre a execução diária.
-- -----------------------------------------------------------------------------
do $$
begin
  if exists (select 1 from pg_available_extensions where name = 'pg_cron') then
    begin
      create extension if not exists pg_cron;
      perform cron.unschedule(jobid) from cron.job where jobname = 'phael-automacoes-diarias';
      perform cron.schedule('phael-automacoes-diarias', '17 9 * * *', 'select private.run_scheduled_automations()');
    exception when others then
      raise notice 'Agendamento diário não criado (%). O painel executa as automações uma vez por dia.', sqlerrm;
    end;
  end if;
end $$;
