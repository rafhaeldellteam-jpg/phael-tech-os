-- =============================================================================
-- Apagar a assinatura da empresa
-- A assinatura do cliente continua imutável. A da empresa pode ser apagada pela
-- equipe (para assinar de novo), só pela função remove_company_signature, com
-- registro na linha do tempo e na auditoria. A assinatura salva do membro
-- também pode ser apagada.
-- =============================================================================

-- Guarda específico de order_signatures: só libera o DELETE de uma assinatura
-- da empresa quando a própria função marcou aquele id nesta transação.
create or replace function private.order_signatures_guard()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if tg_op = 'DELETE' and old.signer_role = 'company'
     and current_setting('phael.removing_company_signature', true) = old.id::text then
    return old;
  end if;
  raise exception 'Assinatura registrada não pode ser alterada' using errcode = '42501';
end;
$$;

drop trigger order_signatures_immutable on public.order_signatures;
create trigger order_signatures_immutable
  before update or delete on public.order_signatures
  for each row execute function private.order_signatures_guard();
create trigger order_signatures_audit_delete
  after delete on public.order_signatures
  for each row execute function private.audit_row_change('company_id', 'image_data');

create or replace function public.remove_company_signature(p_order_id uuid, p_document public.signature_document)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v public.service_orders := private.lock_order(p_order_id);
  s public.order_signatures;
begin
  if not (private.has_permission(v.company_id, 'orders.update') or private.has_permission(v.company_id, 'orders.deliver')) then
    raise exception 'Sem permissão para apagar assinaturas' using errcode = '42501';
  end if;
  select * into s from public.order_signatures
  where order_id = v.id and document = p_document and signer_role = 'company'
  for update;
  if not found then
    raise exception 'Este documento não tem assinatura da empresa' using errcode = 'P0002';
  end if;

  perform set_config('phael.removing_company_signature', s.id::text, true);
  delete from public.order_signatures where id = s.id;
  perform set_config('phael.removing_company_signature', '', true);

  insert into public.service_order_events (company_id, order_id, kind, actor_id, note)
  values (v.company_id, v.id, 'note', auth.uid(),
          format('Assinatura da empresa apagada do comprovante de %s (era de %s, assinada em %s)',
                 case p_document when 'intake' then 'entrada' else 'entrega' end,
                 s.signer_name, to_char(s.signed_at at time zone 'America/Sao_Paulo', 'DD/MM/YYYY HH24:MI')));
end;
$$;

create or replace function public.delete_my_signature(p_company_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not private.is_member(p_company_id) then
    raise exception 'Acesso negado' using errcode = '42501';
  end if;
  delete from public.member_signatures where company_id = p_company_id and user_id = auth.uid();
end;
$$;

revoke execute on all functions in schema public from public, anon;
revoke execute on all functions in schema private from public, anon;
grant execute on function public.remove_company_signature(uuid, public.signature_document) to authenticated;
grant execute on function public.delete_my_signature(uuid) to authenticated;
grant execute on function public.signature_view(text) to anon, authenticated;
grant execute on function public.sign_by_link(text, text, text) to anon, authenticated;
grant execute on function public.portal_order(text) to anon, authenticated;
grant execute on function public.portal_decide(text, boolean, text, text) to anon, authenticated;
grant execute on function public.portal_photos(text) to anon, authenticated;
grant execute on function public.charge_view(text) to anon, authenticated;
grant execute on function private.path_uuid(text, int) to anon, authenticated;
grant execute on function private.is_client_visible_photo(text) to anon, authenticated;
