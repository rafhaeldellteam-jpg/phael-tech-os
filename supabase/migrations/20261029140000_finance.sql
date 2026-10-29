-- =============================================================================
-- Phael Tech OS — Migração 0012: financeiro
-- Regras:
--  * Dinheiro em centavos (bigint). Parcelas somam exatamente o total.
--  * Nada é apagado: cancelamento exige motivo; estorno é um pagamento NEGATIVO
--    que referencia o original (lançamento inverso).
--  * Saldo pago de cada título só muda dentro de RPCs que travam o título.
--  * Distinção: faturamento (títulos emitidos) ≠ recebimentos (dinheiro que
--    entrou) ≠ resultado estimado (faturamento − despesas) ≠ saldo (contas).
-- =============================================================================

create type public.finance_direction as enum ('in', 'out');
create type public.payment_method as enum ('pix', 'cash', 'debit', 'credit', 'transfer', 'boleto', 'other');
create type public.finance_account_kind as enum ('cash', 'bank', 'digital');

-- -----------------------------------------------------------------------------
-- Contas (caixa, banco, carteira digital) e categorias
-- -----------------------------------------------------------------------------
create table public.finance_accounts (
  id                     uuid primary key default gen_random_uuid(),
  company_id             uuid not null references public.companies (id) on delete restrict,
  name                   text not null check (char_length(btrim(name)) between 2 and 80),
  kind                   public.finance_account_kind not null default 'bank',
  opening_balance_cents  bigint not null default 0,
  opening_date           date not null default current_date,
  active                 boolean not null default true,
  created_at             timestamptz not null default now(),
  updated_at             timestamptz not null default now(),
  unique (company_id, id)
);
create unique index finance_accounts_name_uq on public.finance_accounts (company_id, lower(name));

create table public.finance_categories (
  id          uuid primary key default gen_random_uuid(),
  company_id  uuid not null references public.companies (id) on delete restrict,
  name        text not null check (char_length(btrim(name)) between 2 and 80),
  direction   public.finance_direction not null,
  active      boolean not null default true,
  created_at  timestamptz not null default now(),
  unique (company_id, id)
);
create unique index finance_categories_name_uq on public.finance_categories (company_id, direction, lower(name));

create trigger finance_accounts_set_updated_at before update on public.finance_accounts
  for each row execute function private.set_updated_at();
create trigger finance_accounts_audit after insert or update on public.finance_accounts
  for each row execute function private.audit_row_change('company_id');
create trigger finance_categories_audit after insert or update on public.finance_categories
  for each row execute function private.audit_row_change('company_id');

-- Contas e categorias iniciais (só cria o que falta).
create or replace function public.seed_finance_defaults(p_company_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform private.require_permission(p_company_id, 'finance.write');
  insert into public.finance_accounts (company_id, name, kind)
  values (p_company_id, 'Caixa', 'cash'), (p_company_id, 'Conta bancária', 'bank')
  on conflict (company_id, lower(name)) do nothing;

  insert into public.finance_categories (company_id, name, direction)
  select p_company_id, c.name, c.direction::public.finance_direction
  from (values
    ('Serviços de assistência', 'in'), ('Venda de peças', 'in'), ('Sites e serviços digitais', 'in'),
    ('Contratos de manutenção', 'in'), ('Outras receitas', 'in'),
    ('Compra de peças', 'out'), ('Aluguel', 'out'), ('Energia e internet', 'out'), ('Ferramentas e equipamentos', 'out'),
    ('Software e assinaturas', 'out'), ('Impostos e taxas', 'out'), ('Transporte', 'out'), ('Marketing', 'out'),
    ('Pró-labore', 'out'), ('Reembolsos a clientes', 'out'), ('Outras despesas', 'out')
  ) as c(name, direction)
  on conflict (company_id, direction, lower(name)) do nothing;
end;
$$;

-- -----------------------------------------------------------------------------
-- Títulos (contas a receber e a pagar)
-- -----------------------------------------------------------------------------
create table public.finance_entries (
  id                 uuid primary key default gen_random_uuid(),
  company_id         uuid not null references public.companies (id) on delete restrict,
  number             bigint not null,
  direction          public.finance_direction not null,
  description        text not null check (char_length(btrim(description)) between 2 and 200),
  category_id        uuid,
  client_id          uuid,
  supplier_id        uuid,
  order_id           uuid,
  purchase_id        uuid,
  amount_cents       bigint not null check (amount_cents > 0),
  paid_cents         bigint not null default 0 check (paid_cents >= 0),
  issue_date         date not null default current_date,
  due_date           date not null,
  installment_no     int not null default 1 check (installment_no >= 1),
  installment_count  int not null default 1 check (installment_count >= 1),
  group_id           uuid not null default gen_random_uuid(),
  notes              text check (notes is null or char_length(notes) <= 2000),
  canceled_at        timestamptz,
  cancel_reason      text check (cancel_reason is null or char_length(cancel_reason) <= 500),
  status             text generated always as (
                       case
                         when canceled_at is not null then 'canceled'
                         when paid_cents >= amount_cents then 'paid'
                         when paid_cents > 0 then 'partial'
                         else 'open'
                       end
                     ) stored,
  created_by         uuid references auth.users (id) on delete set null,
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now(),
  unique (company_id, id),
  unique (company_id, number),
  check (installment_no <= installment_count),
  check (paid_cents <= amount_cents),
  check ((canceled_at is null) = (cancel_reason is null)),
  foreign key (company_id, category_id) references public.finance_categories (company_id, id) on delete restrict,
  foreign key (company_id, client_id) references public.clients (company_id, id) on delete restrict,
  foreign key (company_id, supplier_id) references public.suppliers (company_id, id) on delete restrict,
  foreign key (company_id, order_id) references public.service_orders (company_id, id) on delete restrict,
  foreign key (company_id, purchase_id) references public.purchases (company_id, id) on delete restrict
);
create index finance_entries_due_idx on public.finance_entries (company_id, direction, due_date);
create index finance_entries_order_idx on public.finance_entries (company_id, order_id) where order_id is not null;
create index finance_entries_client_idx on public.finance_entries (company_id, client_id) where client_id is not null;
create index finance_entries_group_idx on public.finance_entries (group_id);

create trigger finance_entries_set_updated_at before update on public.finance_entries
  for each row execute function private.set_updated_at();
create trigger finance_entries_audit after insert or update on public.finance_entries
  for each row execute function private.audit_row_change('company_id');

-- -----------------------------------------------------------------------------
-- Pagamentos e estornos (somente inserção)
-- -----------------------------------------------------------------------------
create table public.finance_payments (
  id              uuid primary key default gen_random_uuid(),
  company_id      uuid not null,
  entry_id        uuid not null,
  account_id      uuid not null,
  method          public.payment_method not null,
  amount_cents    bigint not null check (amount_cents <> 0),
  paid_at         date not null,
  reversal_of     uuid unique references public.finance_payments (id) on delete restrict,
  notes           text check (notes is null or char_length(notes) <= 500),
  actor_id        uuid references auth.users (id) on delete set null,
  created_at      timestamptz not null default now(),
  unique (company_id, id),
  foreign key (company_id, entry_id) references public.finance_entries (company_id, id) on delete restrict,
  foreign key (company_id, account_id) references public.finance_accounts (company_id, id) on delete restrict,
  check ((reversal_of is null) = (amount_cents > 0))
);
comment on column public.finance_payments.reversal_of is 'Estorno: pagamento negativo que anula o pagamento referenciado (cada um só pode ser estornado uma vez).';
create index finance_payments_entry_idx on public.finance_payments (entry_id);
create index finance_payments_paid_idx on public.finance_payments (company_id, paid_at);

create trigger finance_payments_immutable before update or delete on public.finance_payments
  for each row execute function private.audit_log_immutable();
create trigger finance_payments_audit after insert on public.finance_payments
  for each row execute function private.audit_row_change('company_id');

-- -----------------------------------------------------------------------------
-- Parcelamento: divide o total em N parcelas que somam exatamente o total.
-- A diferença de centavos fica na PRIMEIRA parcela.
-- -----------------------------------------------------------------------------
create or replace function private.split_installments(p_total bigint, p_count int)
returns bigint[]
language sql
immutable
set search_path = ''
as $$
  select array_agg(case when g = 1 then p_total - (p_total / p_count) * (p_count - 1) else p_total / p_count end order by g)
  from generate_series(1, p_count) g;
$$;

-- p_data: { direction, description, category_id, client_id, supplier_id, order_id, purchase_id,
--           amount_cents, issue_date, first_due_date, installments, interval_days, notes }
-- interval_days: 0 = mensal (mesmo dia de cada mês); >0 = a cada N dias.
create or replace function public.create_finance_entry(p_company_id uuid, p_data jsonb)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_dir public.finance_direction := (p_data ->> 'direction')::public.finance_direction;
  v_total bigint := (p_data ->> 'amount_cents')::bigint;
  v_n int := coalesce(nullif(p_data ->> 'installments', '')::int, 1);
  v_interval int := coalesce(nullif(p_data ->> 'interval_days', '')::int, 0);
  v_first date := coalesce(nullif(p_data ->> 'first_due_date', '')::date, current_date);
  v_group uuid := gen_random_uuid();
  v_parts bigint[];
  v_cat uuid := nullif(p_data ->> 'category_id', '')::uuid;
  v_client uuid := nullif(p_data ->> 'client_id', '')::uuid;
  v_supplier uuid := nullif(p_data ->> 'supplier_id', '')::uuid;
  v_order uuid := nullif(p_data ->> 'order_id', '')::uuid;
  v_purchase uuid := nullif(p_data ->> 'purchase_id', '')::uuid;
  v_desc text := btrim(p_data ->> 'description');
  i int;
begin
  perform private.require_permission(p_company_id, 'finance.write');
  if v_total is null or v_total <= 0 then
    raise exception 'Informe um valor maior que zero' using errcode = '23514';
  end if;
  if v_n < 1 or v_n > 60 then
    raise exception 'Parcelas: de 1 a 60' using errcode = '23514';
  end if;
  if v_total < v_n then
    raise exception 'Valor pequeno demais para % parcelas', v_n using errcode = '23514';
  end if;
  if v_interval < 0 or v_interval > 365 then
    raise exception 'Intervalo entre parcelas inválido' using errcode = '23514';
  end if;
  if v_cat is not null and not exists (
    select 1 from public.finance_categories where id = v_cat and company_id = p_company_id and direction = v_dir
  ) then
    raise exception 'Categoria não corresponde ao tipo do lançamento' using errcode = '23514';
  end if;
  if v_dir = 'out' and v_order is not null then
    raise exception 'OS gera contas a receber, não a pagar' using errcode = '23514';
  end if;
  if v_dir = 'in' and v_purchase is not null then
    raise exception 'Compra gera contas a pagar, não a receber' using errcode = '23514';
  end if;
  -- Vínculos precisam ser da mesma empresa (as FKs compostas garantem; aqui só a mensagem).
  if v_order is not null then
    if not exists (select 1 from public.service_orders where id = v_order and company_id = p_company_id) then
      raise exception 'OS não encontrada' using errcode = 'P0002';
    end if;
    select client_id into v_client from public.service_orders where id = v_order;
  end if;
  if v_purchase is not null then
    select supplier_id into v_supplier from public.purchases where id = v_purchase and company_id = p_company_id;
    if not found then
      raise exception 'Compra não encontrada' using errcode = 'P0002';
    end if;
  end if;

  v_parts := private.split_installments(v_total, v_n);
  for i in 1..v_n loop
    insert into public.finance_entries (
      company_id, number, direction, description, category_id, client_id, supplier_id, order_id, purchase_id,
      amount_cents, issue_date, due_date, installment_no, installment_count, group_id, notes, created_by
    ) values (
      p_company_id, private.next_number(p_company_id, 'finance_entry'), v_dir,
      case when v_n > 1 then format('%s (%s/%s)', v_desc, i, v_n) else v_desc end,
      v_cat, v_client, v_supplier, v_order, v_purchase,
      v_parts[i],
      coalesce(nullif(p_data ->> 'issue_date', '')::date, current_date),
      case when v_interval = 0 then (v_first + make_interval(months => i - 1))::date
           else v_first + (i - 1) * v_interval end,
      i, v_n, v_group, private.clean(p_data ->> 'notes'), auth.uid()
    );
  end loop;
  return v_group;
end;
$$;

-- Edita dados descritivos (valor só enquanto não houver pagamento).
create or replace function public.update_finance_entry(p_entry_id uuid, p_data jsonb)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v public.finance_entries;
  v_amount bigint;
begin
  select * into v from public.finance_entries where id = p_entry_id for update;
  if not found then
    raise exception 'Lançamento não encontrado' using errcode = 'P0002';
  end if;
  perform private.require_permission(v.company_id, 'finance.write');
  if v.canceled_at is not null then
    raise exception 'Lançamento cancelado não pode ser alterado' using errcode = '23514';
  end if;
  v_amount := coalesce(nullif(p_data ->> 'amount_cents', '')::bigint, v.amount_cents);
  if v_amount <> v.amount_cents and v.paid_cents > 0 then
    raise exception 'Valor não pode mudar depois de pagamentos. Estorne os pagamentos ou lance a diferença à parte.'
      using errcode = '23514';
  end if;
  if v_amount <= 0 then
    raise exception 'Informe um valor maior que zero' using errcode = '23514';
  end if;

  update public.finance_entries set
    description = coalesce(nullif(btrim(p_data ->> 'description'), ''), description),
    category_id = case when p_data ? 'category_id' then nullif(p_data ->> 'category_id', '')::uuid else category_id end,
    due_date = coalesce(nullif(p_data ->> 'due_date', '')::date, due_date),
    notes = case when p_data ? 'notes' then private.clean(p_data ->> 'notes') else notes end,
    amount_cents = v_amount
  where id = v.id;
end;
$$;

create or replace function public.cancel_finance_entry(p_entry_id uuid, p_reason text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v public.finance_entries;
begin
  select * into v from public.finance_entries where id = p_entry_id for update;
  if not found then
    raise exception 'Lançamento não encontrado' using errcode = 'P0002';
  end if;
  perform private.require_permission(v.company_id, 'finance.write');
  if v.canceled_at is not null then
    raise exception 'Lançamento já cancelado' using errcode = '23514';
  end if;
  if v.paid_cents > 0 then
    raise exception 'Há pagamentos neste lançamento. Estorne-os antes de cancelar.' using errcode = '23514';
  end if;
  if private.clean(p_reason) is null then
    raise exception 'Informe o motivo do cancelamento' using errcode = '23514';
  end if;
  update public.finance_entries set canceled_at = now(), cancel_reason = private.clean(p_reason) where id = v.id;
end;
$$;

-- Registra pagamento (parcial ou total). Trava o título para evitar pagar duas vezes.
create or replace function public.register_payment(p_entry_id uuid, p_data jsonb)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v public.finance_entries;
  v_amount bigint := (p_data ->> 'amount_cents')::bigint;
  v_account uuid := (p_data ->> 'account_id')::uuid;
  v_id uuid;
begin
  select * into v from public.finance_entries where id = p_entry_id for update;
  if not found then
    raise exception 'Lançamento não encontrado' using errcode = 'P0002';
  end if;
  perform private.require_permission(v.company_id, 'finance.write');
  if v.canceled_at is not null then
    raise exception 'Lançamento cancelado não recebe pagamentos' using errcode = '23514';
  end if;
  if v_amount is null or v_amount <= 0 then
    raise exception 'Informe um valor maior que zero' using errcode = '23514';
  end if;
  if v_amount > v.amount_cents - v.paid_cents then
    raise exception 'Valor maior que o saldo em aberto (%)', to_char((v.amount_cents - v.paid_cents) / 100.0, 'FM999G999G990D00')
      using errcode = '23514';
  end if;
  if not exists (select 1 from public.finance_accounts where id = v_account and company_id = v.company_id and active) then
    raise exception 'Conta não encontrada ou inativa' using errcode = 'P0002';
  end if;

  insert into public.finance_payments (company_id, entry_id, account_id, method, amount_cents, paid_at, notes, actor_id)
  values (
    v.company_id, v.id, v_account,
    coalesce(nullif(p_data ->> 'method', ''), 'pix')::public.payment_method,
    v_amount,
    coalesce(nullif(p_data ->> 'paid_at', '')::date, current_date),
    private.clean(p_data ->> 'notes'),
    auth.uid()
  )
  returning id into v_id;

  update public.finance_entries set paid_cents = paid_cents + v_amount where id = v.id;
  return v_id;
end;
$$;

-- Estorno: lançamento inverso (negativo) do pagamento original. Nada é apagado.
create or replace function public.reverse_payment(p_payment_id uuid, p_reason text)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_pay public.finance_payments;
  v_entry public.finance_entries;
  v_id uuid;
begin
  select * into v_pay from public.finance_payments where id = p_payment_id;
  if not found then
    raise exception 'Pagamento não encontrado' using errcode = 'P0002';
  end if;
  perform private.require_permission(v_pay.company_id, 'finance.write');
  select * into v_entry from public.finance_entries where id = v_pay.entry_id for update;
  if v_pay.amount_cents < 0 then
    raise exception 'Um estorno não pode ser estornado' using errcode = '23514';
  end if;
  if exists (select 1 from public.finance_payments where reversal_of = v_pay.id) then
    raise exception 'Este pagamento já foi estornado' using errcode = '23514';
  end if;
  if private.clean(p_reason) is null then
    raise exception 'Informe o motivo do estorno' using errcode = '23514';
  end if;

  insert into public.finance_payments (company_id, entry_id, account_id, method, amount_cents, paid_at, reversal_of, notes, actor_id)
  values (v_pay.company_id, v_pay.entry_id, v_pay.account_id, v_pay.method, -v_pay.amount_cents, current_date, v_pay.id,
          private.clean(p_reason), auth.uid())
  returning id into v_id;

  update public.finance_entries set paid_cents = paid_cents - v_pay.amount_cents where id = v_entry.id;
  return v_id;
end;
$$;

-- -----------------------------------------------------------------------------
-- Relatórios (fórmulas documentadas em docs/FINANCE.md)
-- -----------------------------------------------------------------------------
create or replace function public.finance_summary(p_company_id uuid, p_from date, p_to date)
returns table (
  billed_cents bigint,          -- faturamento: títulos a receber emitidos no período (não cancelados)
  expenses_cents bigint,        -- despesas: títulos a pagar emitidos no período (não cancelados)
  estimated_result_cents bigint,-- resultado estimado = faturamento − despesas
  received_cents bigint,        -- recebimentos: dinheiro que entrou no período (estornos descontados)
  paid_cents bigint,            -- pagamentos: dinheiro que saiu no período (estornos descontados)
  cash_result_cents bigint,     -- resultado de caixa = recebimentos − pagamentos
  receivable_open_cents bigint, -- a receber em aberto (hoje)
  receivable_overdue_cents bigint,
  payable_open_cents bigint,    -- a pagar em aberto (hoje)
  payable_overdue_cents bigint,
  balance_cents bigint          -- saldo financeiro: saldo inicial das contas + todos os pagamentos
)
language plpgsql
stable
security definer
set search_path = ''
as $$
#variable_conflict use_column
begin
  perform private.require_permission(p_company_id, 'finance.read');
  return query
  with e as (
    select * from public.finance_entries where company_id = p_company_id and canceled_at is null
  ), p as (
    select fp.*, fe.direction from public.finance_payments fp
    join public.finance_entries fe on fe.id = fp.entry_id
    where fp.company_id = p_company_id
  )
  select
    coalesce((select sum(amount_cents) from e where direction = 'in' and issue_date between p_from and p_to), 0)::bigint,
    coalesce((select sum(amount_cents) from e where direction = 'out' and issue_date between p_from and p_to), 0)::bigint,
    (coalesce((select sum(amount_cents) from e where direction = 'in' and issue_date between p_from and p_to), 0)
      - coalesce((select sum(amount_cents) from e where direction = 'out' and issue_date between p_from and p_to), 0))::bigint,
    coalesce((select sum(amount_cents) from p where direction = 'in' and paid_at between p_from and p_to), 0)::bigint,
    coalesce((select sum(amount_cents) from p where direction = 'out' and paid_at between p_from and p_to), 0)::bigint,
    (coalesce((select sum(amount_cents) from p where direction = 'in' and paid_at between p_from and p_to), 0)
      - coalesce((select sum(amount_cents) from p where direction = 'out' and paid_at between p_from and p_to), 0))::bigint,
    coalesce((select sum(amount_cents - paid_cents) from e where direction = 'in'), 0)::bigint,
    coalesce((select sum(amount_cents - paid_cents) from e where direction = 'in' and due_date < current_date), 0)::bigint,
    coalesce((select sum(amount_cents - paid_cents) from e where direction = 'out'), 0)::bigint,
    coalesce((select sum(amount_cents - paid_cents) from e where direction = 'out' and due_date < current_date), 0)::bigint,
    (coalesce((select sum(opening_balance_cents) from public.finance_accounts where company_id = p_company_id), 0)
      + coalesce((select sum(case when direction = 'in' then amount_cents else -amount_cents end) from p), 0))::bigint;
end;
$$;

-- Fluxo de caixa realizado por dia ou mês, com saldo acumulado.
create or replace function public.cash_flow(p_company_id uuid, p_from date, p_to date, p_group text default 'day')
returns table (period date, in_cents bigint, out_cents bigint, net_cents bigint, balance_cents bigint)
language plpgsql
stable
security definer
set search_path = ''
as $$
#variable_conflict use_column
declare
  v_opening bigint;
begin
  perform private.require_permission(p_company_id, 'finance.read');
  if p_group not in ('day', 'month') then
    raise exception 'Agrupamento inválido' using errcode = '22023';
  end if;
  select coalesce((select sum(opening_balance_cents) from public.finance_accounts where company_id = p_company_id), 0)
       + coalesce((select sum(case when fe.direction = 'in' then fp.amount_cents else -fp.amount_cents end)
                   from public.finance_payments fp join public.finance_entries fe on fe.id = fp.entry_id
                   where fp.company_id = p_company_id and fp.paid_at < p_from), 0)
  into v_opening;

  return query
  with p as (
    select date_trunc(p_group, fp.paid_at)::date as d,
           sum(fp.amount_cents) filter (where fe.direction = 'in') as i,
           sum(fp.amount_cents) filter (where fe.direction = 'out') as o
    from public.finance_payments fp join public.finance_entries fe on fe.id = fp.entry_id
    where fp.company_id = p_company_id and fp.paid_at between p_from and p_to
    group by 1
  )
  select d, coalesce(i, 0)::bigint, coalesce(o, 0)::bigint, (coalesce(i, 0) - coalesce(o, 0))::bigint,
         (v_opening + sum(coalesce(i, 0) - coalesce(o, 0)) over (order by d))::bigint
  from p order by d;
end;
$$;

-- Margem por OS entregue no período: total cobrado (itens ativos) − custo real dos itens.
create or replace function public.order_margins(p_company_id uuid, p_from date, p_to date)
returns table (order_id uuid, number bigint, client_name text, delivered_at timestamptz,
               revenue_cents bigint, cost_cents bigint, margin_cents bigint, received_cents bigint)
language plpgsql
stable
security definer
set search_path = ''
as $$
#variable_conflict use_column
begin
  perform private.require_permission(p_company_id, 'finance.read');
  return query
  select o.id, o.number, c.name, o.delivered_at,
         coalesce(sum(i.qty * i.unit_price_cents - i.discount_cents), 0)::bigint,
         coalesce(sum(i.qty * i.unit_cost_cents), 0)::bigint,
         coalesce(sum(i.qty * i.unit_price_cents - i.discount_cents - i.qty * i.unit_cost_cents), 0)::bigint,
         coalesce((select sum(fe.paid_cents) from public.finance_entries fe
                   where fe.order_id = o.id and fe.canceled_at is null), 0)::bigint
  from public.service_orders o
  join public.clients c on c.id = o.client_id
  left join public.service_order_items i on i.order_id = o.id and i.returned_at is null
  where o.company_id = p_company_id
    and o.delivered_at is not null
    and o.delivered_at::date between p_from and p_to
  group by o.id, c.name
  order by o.delivered_at desc;
end;
$$;

-- Resultado por categoria de serviço (itens de serviço de OS entregues no período).
create or replace function public.service_category_results(p_company_id uuid, p_from date, p_to date)
returns table (category text, label text, items bigint, revenue_cents bigint, cost_cents bigint, margin_cents bigint)
language plpgsql
stable
security definer
set search_path = ''
as $$
#variable_conflict use_column
begin
  perform private.require_permission(p_company_id, 'finance.read');
  return query
  select coalesce(sc.category, 'other'), coalesce(cat.label, 'Avulsos / outros'), count(*)::bigint,
         sum(i.qty * i.unit_price_cents - i.discount_cents)::bigint,
         sum(i.qty * i.unit_cost_cents)::bigint,
         sum(i.qty * i.unit_price_cents - i.discount_cents - i.qty * i.unit_cost_cents)::bigint
  from public.service_order_items i
  join public.service_orders o on o.id = i.order_id
  left join public.service_catalog sc on sc.id = i.catalog_id
  left join public.service_categories cat on cat.key = coalesce(sc.category, 'other')
  where o.company_id = p_company_id and i.kind = 'service' and i.returned_at is null
    and o.delivered_at is not null and o.delivered_at::date between p_from and p_to
  group by 1, 2
  order by 4 desc;
end;
$$;

-- -----------------------------------------------------------------------------
-- Conciliação por importação de extrato (CSV do banco → linhas → vínculo a pagamentos)
-- -----------------------------------------------------------------------------
create table public.bank_statement_lines (
  id                   uuid primary key default gen_random_uuid(),
  company_id           uuid not null,
  account_id           uuid not null,
  line_date            date not null,
  description          text not null check (char_length(description) <= 300),
  amount_cents         bigint not null check (amount_cents <> 0),
  fingerprint          text not null,
  matched_payment_id   uuid,
  ignored              boolean not null default false,
  imported_by          uuid references auth.users (id) on delete set null,
  created_at           timestamptz not null default now(),
  unique (company_id, fingerprint),
  foreign key (company_id, account_id) references public.finance_accounts (company_id, id) on delete restrict,
  foreign key (company_id, matched_payment_id) references public.finance_payments (company_id, id) on delete restrict
);
create unique index bank_statement_lines_payment_uq on public.bank_statement_lines (matched_payment_id) where matched_payment_id is not null;

-- p_lines: [{ date: 'YYYY-MM-DD', description, amount_cents }]. Reimportar o mesmo arquivo não duplica.
create or replace function public.import_statement(p_account_id uuid, p_lines jsonb)
returns table (imported int, skipped int)
language plpgsql
security definer
set search_path = ''
as $$
#variable_conflict use_column
declare
  v_company uuid;
  v_line jsonb;
  v_ord int := 0;
  v_imp int := 0;
  v_skip int := 0;
  v_fp text;
  v_seen jsonb := '{}'::jsonb;
  v_key text;
begin
  select company_id into v_company from public.finance_accounts where id = p_account_id;
  if not found then
    raise exception 'Conta não encontrada' using errcode = 'P0002';
  end if;
  perform private.require_permission(v_company, 'finance.write');
  if jsonb_array_length(coalesce(p_lines, '[]'::jsonb)) > 2000 then
    raise exception 'Máximo de 2000 linhas por importação' using errcode = '54000';
  end if;

  for v_line in select * from jsonb_array_elements(p_lines) loop
    -- Linhas idênticas no mesmo extrato (ex.: duas tarifas iguais no dia) recebem ordinal.
    v_key := concat_ws('|', v_line ->> 'date', v_line ->> 'description', v_line ->> 'amount_cents');
    v_ord := coalesce((v_seen ->> v_key)::int, 0) + 1;
    v_seen := v_seen || jsonb_build_object(v_key, v_ord);
    v_fp := encode(extensions.digest(concat_ws('|', p_account_id, v_key, v_ord), 'sha256'), 'hex');

    insert into public.bank_statement_lines (company_id, account_id, line_date, description, amount_cents, fingerprint, imported_by)
    values (v_company, p_account_id, (v_line ->> 'date')::date, left(btrim(v_line ->> 'description'), 300),
            (v_line ->> 'amount_cents')::bigint, v_fp, auth.uid())
    on conflict (company_id, fingerprint) do nothing;
    if found then v_imp := v_imp + 1; else v_skip := v_skip + 1; end if;
  end loop;
  return query select v_imp, v_skip;
end;
$$;

-- Vincula linha do extrato a um pagamento da mesma conta com o mesmo valor (sinal pelo tipo).
create or replace function public.match_statement_line(p_line_id uuid, p_payment_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_line public.bank_statement_lines;
  v_pay public.finance_payments;
  v_dir public.finance_direction;
begin
  select * into v_line from public.bank_statement_lines where id = p_line_id for update;
  if not found then
    raise exception 'Linha não encontrada' using errcode = 'P0002';
  end if;
  perform private.require_permission(v_line.company_id, 'finance.write');

  if p_payment_id is null then
    update public.bank_statement_lines set matched_payment_id = null where id = v_line.id;
    return;
  end if;

  select * into v_pay from public.finance_payments where id = p_payment_id and company_id = v_line.company_id;
  if not found then
    raise exception 'Pagamento não encontrado' using errcode = 'P0002';
  end if;
  select direction into v_dir from public.finance_entries where id = v_pay.entry_id;
  if v_pay.account_id <> v_line.account_id then
    raise exception 'O pagamento foi registrado em outra conta' using errcode = '23514';
  end if;
  if (case when v_dir = 'in' then v_pay.amount_cents else -v_pay.amount_cents end) <> v_line.amount_cents then
    raise exception 'Valores diferentes: confira o pagamento escolhido' using errcode = '23514';
  end if;
  update public.bank_statement_lines set matched_payment_id = p_payment_id, ignored = false where id = v_line.id;
end;
$$;

create or replace function public.set_statement_line_ignored(p_line_id uuid, p_ignored boolean)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_company uuid;
begin
  select company_id into v_company from public.bank_statement_lines where id = p_line_id;
  if not found then
    raise exception 'Linha não encontrada' using errcode = 'P0002';
  end if;
  perform private.require_permission(v_company, 'finance.write');
  update public.bank_statement_lines set ignored = p_ignored, matched_payment_id = case when p_ignored then null else matched_payment_id end
  where id = p_line_id;
end;
$$;

-- Sugestões: pagamentos da mesma conta, mesmo valor, até 5 dias de diferença, ainda não conciliados.
create or replace function public.statement_suggestions(p_line_id uuid)
returns table (payment_id uuid, paid_at date, amount_cents bigint, entry_description text, days_apart int)
language plpgsql
stable
security definer
set search_path = ''
as $$
#variable_conflict use_column
declare
  v_line public.bank_statement_lines;
begin
  select * into v_line from public.bank_statement_lines where id = p_line_id;
  if not found then
    raise exception 'Linha não encontrada' using errcode = 'P0002';
  end if;
  perform private.require_permission(v_line.company_id, 'finance.read');
  return query
  select fp.id, fp.paid_at, fp.amount_cents, fe.description, abs(fp.paid_at - v_line.line_date)
  from public.finance_payments fp
  join public.finance_entries fe on fe.id = fp.entry_id
  where fp.company_id = v_line.company_id and fp.account_id = v_line.account_id
    and (case when fe.direction = 'in' then fp.amount_cents else -fp.amount_cents end) = v_line.amount_cents
    and abs(fp.paid_at - v_line.line_date) <= 5
    and not exists (select 1 from public.bank_statement_lines b where b.matched_payment_id = fp.id)
  order by abs(fp.paid_at - v_line.line_date), fp.paid_at
  limit 5;
end;
$$;

-- -----------------------------------------------------------------------------
-- RLS
-- -----------------------------------------------------------------------------
alter table public.finance_accounts enable row level security;
alter table public.finance_categories enable row level security;
alter table public.finance_entries enable row level security;
alter table public.finance_payments enable row level security;
alter table public.bank_statement_lines enable row level security;

grant select, insert on public.finance_accounts to authenticated;
grant update (name, kind, opening_balance_cents, opening_date, active) on public.finance_accounts to authenticated;
create policy finance_accounts_select on public.finance_accounts for select to authenticated
  using (private.has_permission(company_id, 'finance.read'));
create policy finance_accounts_insert on public.finance_accounts for insert to authenticated
  with check (private.has_permission(company_id, 'finance.write'));
create policy finance_accounts_update on public.finance_accounts for update to authenticated
  using (private.has_permission(company_id, 'finance.write')) with check (private.has_permission(company_id, 'finance.write'));

grant select, insert on public.finance_categories to authenticated;
grant update (name, active) on public.finance_categories to authenticated;
create policy finance_categories_select on public.finance_categories for select to authenticated
  using (private.has_permission(company_id, 'finance.read'));
create policy finance_categories_insert on public.finance_categories for insert to authenticated
  with check (private.has_permission(company_id, 'finance.write'));
create policy finance_categories_update on public.finance_categories for update to authenticated
  using (private.has_permission(company_id, 'finance.write')) with check (private.has_permission(company_id, 'finance.write'));

grant select on public.finance_entries, public.finance_payments, public.bank_statement_lines to authenticated;
create policy finance_entries_select on public.finance_entries for select to authenticated
  using (private.has_permission(company_id, 'finance.read'));
create policy finance_payments_select on public.finance_payments for select to authenticated
  using (private.has_permission(company_id, 'finance.read'));
create policy bank_statement_lines_select on public.bank_statement_lines for select to authenticated
  using (private.has_permission(company_id, 'finance.read'));

revoke execute on all functions in schema public from public, anon;
revoke execute on all functions in schema private from public, anon;

grant execute on function public.seed_finance_defaults(uuid) to authenticated;
grant execute on function public.create_finance_entry(uuid, jsonb) to authenticated;
grant execute on function public.update_finance_entry(uuid, jsonb) to authenticated;
grant execute on function public.cancel_finance_entry(uuid, text) to authenticated;
grant execute on function public.register_payment(uuid, jsonb) to authenticated;
grant execute on function public.reverse_payment(uuid, text) to authenticated;
grant execute on function public.finance_summary(uuid, date, date) to authenticated;
grant execute on function public.cash_flow(uuid, date, date, text) to authenticated;
grant execute on function public.order_margins(uuid, date, date) to authenticated;
grant execute on function public.service_category_results(uuid, date, date) to authenticated;
grant execute on function public.import_statement(uuid, jsonb) to authenticated;
grant execute on function public.match_statement_line(uuid, uuid) to authenticated;
grant execute on function public.set_statement_line_ignored(uuid, boolean) to authenticated;
grant execute on function public.statement_suggestions(uuid) to authenticated;
