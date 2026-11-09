-- =============================================================================
-- Clientes devendo
-- Visão das contas a receber agrupadas por cliente e por cobrança (à vista ou
-- parcelada), com a forma de pagamento combinada e ações rápidas: marcar uma
-- parcela ou a cobrança inteira como paga, e desmarcar (estorno registrado).
-- Usa as mesmas tabelas do financeiro: nada é apagado.
-- =============================================================================

alter table public.finance_entries add column payment_method public.payment_method;
comment on column public.finance_entries.payment_method is 'Forma de pagamento combinada com o cliente (a forma real de cada pagamento fica em finance_payments).';

-- p_data: { direction, description, category_id, client_id, supplier_id, order_id, purchase_id,
--           amount_cents, issue_date, first_due_date, installments, interval_days, notes, payment_method }
-- payment_method: forma combinada (pix, cartão...), opcional.
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
  v_method public.payment_method := nullif(p_data ->> 'payment_method', '')::public.payment_method;
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
      amount_cents, issue_date, due_date, installment_no, installment_count, group_id, notes, created_by, payment_method
    ) values (
      p_company_id, private.next_number(p_company_id, 'finance_entry'), v_dir,
      case when v_n > 1 then format('%s (%s/%s)', v_desc, i, v_n) else v_desc end,
      v_cat, v_client, v_supplier, v_order, v_purchase,
      v_parts[i],
      coalesce(nullif(p_data ->> 'issue_date', '')::date, current_date),
      case when v_interval = 0 then (v_first + make_interval(months => i - 1))::date
           else v_first + (i - 1) * v_interval end,
      i, v_n, v_group, private.clean(p_data ->> 'notes'), auth.uid(), v_method
    );
  end loop;
  return v_group;
end;
$$;


-- Troca a forma combinada de todas as parcelas da cobrança.
create or replace function public.set_entry_group_method(p_group_id uuid, p_method public.payment_method)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_company uuid;
begin
  select company_id into v_company from public.finance_entries where group_id = p_group_id limit 1;
  if not found then
    raise exception 'Cobrança não encontrada' using errcode = 'P0002';
  end if;
  perform private.require_permission(v_company, 'finance.write');
  update public.finance_entries set payment_method = p_method where group_id = p_group_id and company_id = v_company;
end;
$$;

-- Cobranças a receber por cliente. p_only_open: só as que ainda têm saldo.
create or replace function public.receivables_by_client(p_company_id uuid, p_only_open boolean default true)
returns table (
  group_id uuid,
  client_id uuid,
  client_name text,
  client_phone text,
  order_id uuid,
  order_number bigint,
  description text,
  payment_method public.payment_method,
  installment_count int,
  total_cents bigint,
  paid_cents bigint,
  open_cents bigint,
  overdue_cents bigint,
  paid_installments int,
  next_due date,
  first_issue date,
  installments jsonb
)
language plpgsql
stable
security definer
set search_path = ''
as $$
#variable_conflict use_column
declare
  v_today date := (now() at time zone 'America/Sao_Paulo')::date;
begin
  perform private.require_permission(p_company_id, 'finance.read');
  return query
  with e as (
    select * from public.finance_entries
    where company_id = p_company_id and direction = 'in' and canceled_at is null
  ),
  g as (
    select
      e.group_id,
      (array_agg(e.client_id))[1] as client_id,
      (array_agg(e.order_id))[1] as order_id,
      (array_agg(e.description order by e.installment_no))[1] as first_desc,
      (array_agg(e.payment_method order by e.installment_no))[1] as payment_method,
      max(e.installment_count) as installment_count,
      sum(e.amount_cents)::bigint as total_cents,
      sum(e.paid_cents)::bigint as paid_cents,
      sum(e.amount_cents - e.paid_cents)::bigint as open_cents,
      coalesce(sum(e.amount_cents - e.paid_cents) filter (where e.due_date < v_today), 0)::bigint as overdue_cents,
      (count(*) filter (where e.paid_cents >= e.amount_cents))::int as paid_installments,
      min(e.due_date) filter (where e.paid_cents < e.amount_cents) as next_due,
      min(e.issue_date) as first_issue,
      jsonb_agg(jsonb_build_object(
        'id', e.id, 'number', e.number, 'no', e.installment_no, 'amount_cents', e.amount_cents,
        'paid_cents', e.paid_cents, 'due_date', e.due_date, 'status', e.status,
        'last_paid_at', (select max(p.paid_at) from public.finance_payments p where p.entry_id = e.id and p.amount_cents > 0
                          and not exists (select 1 from public.finance_payments r where r.reversal_of = p.id)),
        'last_method', (select p.method from public.finance_payments p where p.entry_id = e.id and p.amount_cents > 0
                          and not exists (select 1 from public.finance_payments r where r.reversal_of = p.id)
                        order by p.paid_at desc, p.created_at desc limit 1)
      ) order by e.installment_no) as installments
    from e
    group by e.group_id
  )
  select g.group_id, g.client_id, c.name, coalesce(c.whatsapp, c.phone), g.order_id, o.number,
         regexp_replace(g.first_desc, ' \(\d+/\d+\)$', ''),
         g.payment_method, g.installment_count, g.total_cents, g.paid_cents, g.open_cents, g.overdue_cents,
         g.paid_installments, g.next_due, g.first_issue, g.installments
  from g
  left join public.clients c on c.id = g.client_id
  left join public.service_orders o on o.id = g.order_id
  where not p_only_open or g.open_cents > 0
  order by g.overdue_cents desc, g.next_due nulls last, c.name;
end;
$$;

-- Marca uma parcela como paga: registra o saldo em aberto dela.
-- p_data: { account_id, method, paid_at }
create or replace function public.pay_installment(p_entry_id uuid, p_data jsonb)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v public.finance_entries;
begin
  select * into v from public.finance_entries where id = p_entry_id;
  if not found then
    raise exception 'Parcela não encontrada' using errcode = 'P0002';
  end if;
  perform private.require_permission(v.company_id, 'finance.write');
  if v.paid_cents >= v.amount_cents then
    raise exception 'Esta parcela já está paga' using errcode = '23514';
  end if;
  return public.register_payment(p_entry_id, p_data || jsonb_build_object(
    'amount_cents', v.amount_cents - v.paid_cents,
    'method', coalesce(nullif(p_data ->> 'method', ''), v.payment_method::text, 'pix')));
end;
$$;

-- Marca a cobrança inteira como paga (todas as parcelas com saldo). Devolve quantas foram pagas.
create or replace function public.pay_entry_group(p_group_id uuid, p_data jsonb)
returns int
language plpgsql
security definer
set search_path = ''
as $$
declare
  r record;
  v_n int := 0;
  v_company uuid;
begin
  select company_id into v_company from public.finance_entries where group_id = p_group_id limit 1;
  if not found then
    raise exception 'Cobrança não encontrada' using errcode = 'P0002';
  end if;
  perform private.require_permission(v_company, 'finance.write');
  for r in
    select id from public.finance_entries
    where group_id = p_group_id and company_id = v_company and canceled_at is null and paid_cents < amount_cents
    order by installment_no
  loop
    perform public.pay_installment(r.id, p_data);
    v_n := v_n + 1;
  end loop;
  if v_n = 0 then
    raise exception 'Esta cobrança já está paga' using errcode = '23514';
  end if;
  return v_n;
end;
$$;

-- Desmarca: estorna todos os pagamentos ainda válidos da parcela (fica registrado).
create or replace function public.unpay_installment(p_entry_id uuid, p_reason text default null)
returns int
language plpgsql
security definer
set search_path = ''
as $$
declare
  v public.finance_entries;
  r record;
  v_n int := 0;
begin
  select * into v from public.finance_entries where id = p_entry_id;
  if not found then
    raise exception 'Parcela não encontrada' using errcode = 'P0002';
  end if;
  perform private.require_permission(v.company_id, 'finance.write');
  for r in
    select p.id from public.finance_payments p
    where p.entry_id = v.id and p.amount_cents > 0
      and not exists (select 1 from public.finance_payments x where x.reversal_of = p.id)
    order by p.created_at
  loop
    perform public.reverse_payment(r.id, coalesce(private.clean(p_reason), 'Desmarcado como pago'));
    v_n := v_n + 1;
  end loop;
  if v_n = 0 then
    raise exception 'Esta parcela não tem pagamento para desmarcar' using errcode = '23514';
  end if;
  return v_n;
end;
$$;

revoke execute on all functions in schema public from public, anon;
revoke execute on all functions in schema private from public, anon;
grant execute on function public.create_finance_entry(uuid, jsonb) to authenticated;
grant execute on function public.set_entry_group_method(uuid, public.payment_method) to authenticated;
grant execute on function public.receivables_by_client(uuid, boolean) to authenticated;
grant execute on function public.pay_installment(uuid, jsonb) to authenticated;
grant execute on function public.pay_entry_group(uuid, jsonb) to authenticated;
grant execute on function public.unpay_installment(uuid, text) to authenticated;
grant execute on function public.signature_view(text) to anon, authenticated;
grant execute on function public.sign_by_link(text, text, text) to anon, authenticated;
grant execute on function public.portal_order(text) to anon, authenticated;
grant execute on function public.portal_decide(text, boolean, text, text) to anon, authenticated;
grant execute on function public.portal_photos(text) to anon, authenticated;
grant execute on function public.charge_view(text) to anon, authenticated;
grant execute on function private.path_uuid(text, int) to anon, authenticated;
grant execute on function private.is_client_visible_photo(text) to anon, authenticated;
