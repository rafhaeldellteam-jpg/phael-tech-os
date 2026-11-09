-- =============================================================================
-- Marcar como pago sem escolher conta
-- Para quem só quer registrar que foi pago: se não vier conta, o pagamento entra
-- na conta "Caixa" da empresa (criada na hora, se ainda não existir).
-- =============================================================================

create or replace function private.default_receipt_account(p_company_id uuid)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_id uuid;
begin
  select id into v_id from public.finance_accounts
  where company_id = p_company_id and active
  order by (kind = 'cash') desc, (lower(name) = 'caixa') desc, created_at
  limit 1;
  if found then
    return v_id;
  end if;
  select id into v_id from public.finance_accounts where company_id = p_company_id and lower(name) = 'caixa';
  if found then
    update public.finance_accounts set active = true where id = v_id;
    return v_id;
  end if;
  insert into public.finance_accounts (company_id, name, kind) values (p_company_id, 'Caixa', 'cash')
  returning id into v_id;
  return v_id;
end;
$$;

-- Pagamento avulso: conta opcional (sem conta, entra na Caixa).
create or replace function public.register_payment(p_entry_id uuid, p_data jsonb)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v public.finance_entries;
  v_amount bigint := (p_data ->> 'amount_cents')::bigint;
  v_account uuid := nullif(p_data ->> 'account_id', '')::uuid;
  v_id uuid;
begin
  select * into v from public.finance_entries where id = p_entry_id for update;
  if not found then
    raise exception 'Lançamento não encontrado' using errcode = 'P0002';
  end if;
  perform private.require_permission(v.company_id, 'finance.write');
  if v_account is null then
    v_account := private.default_receipt_account(v.company_id);
  end if;
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

-- p_data: { method, paid_at, account_id (opcional) }
create or replace function public.pay_installment(p_entry_id uuid, p_data jsonb)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v public.finance_entries;
  v_account text := nullif(p_data ->> 'account_id', '');
begin
  select * into v from public.finance_entries where id = p_entry_id;
  if not found then
    raise exception 'Parcela não encontrada' using errcode = 'P0002';
  end if;
  perform private.require_permission(v.company_id, 'finance.write');
  if v.paid_cents >= v.amount_cents then
    raise exception 'Esta parcela já está paga' using errcode = '23514';
  end if;
  if v_account is null then
    v_account := private.default_receipt_account(v.company_id)::text;
  end if;
  return public.register_payment(p_entry_id, p_data || jsonb_build_object(
    'account_id', v_account,
    'amount_cents', v.amount_cents - v.paid_cents,
    'method', coalesce(nullif(p_data ->> 'method', ''), v.payment_method::text, 'pix')));
end;
$$;

revoke execute on all functions in schema public from public, anon;
revoke execute on all functions in schema private from public, anon;
grant execute on function public.pay_installment(uuid, jsonb) to authenticated;
grant execute on function public.register_payment(uuid, jsonb) to authenticated;
grant execute on function public.signature_view(text) to anon, authenticated;
grant execute on function public.sign_by_link(text, text, text) to anon, authenticated;
grant execute on function public.portal_order(text) to anon, authenticated;
grant execute on function public.portal_decide(text, boolean, text, text) to anon, authenticated;
grant execute on function public.portal_photos(text) to anon, authenticated;
grant execute on function public.charge_view(text) to anon, authenticated;
grant execute on function private.path_uuid(text, int) to anon, authenticated;
grant execute on function private.is_client_visible_photo(text) to anon, authenticated;
