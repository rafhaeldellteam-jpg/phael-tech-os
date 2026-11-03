-- =============================================================================
-- Apagar assinatura do cliente também
-- A equipe pode apagar a assinatura do cliente ou da empresa de um comprovante
-- (para pedir de novo). Só por remove_order_signature, com registro na linha do
-- tempo e na auditoria (metadados e SHA-256 da imagem apagada). Ao apagar a do
-- cliente, os links de assinatura daquele documento são cancelados; para pedir
-- de novo, gera-se um link novo.
-- =============================================================================

create or replace function private.order_signatures_guard()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if tg_op = 'DELETE' and current_setting('phael.removing_signature', true) = old.id::text then
    return old;
  end if;
  raise exception 'Assinatura registrada não pode ser alterada' using errcode = '42501';
end;
$$;

create or replace function public.remove_order_signature(
  p_order_id uuid,
  p_document public.signature_document,
  p_role public.signature_role
)
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
  where order_id = v.id and document = p_document and signer_role = p_role
  for update;
  if not found then
    raise exception 'Este documento não tem essa assinatura' using errcode = 'P0002';
  end if;

  if p_role = 'client' then
    -- Solta o vínculo do link usado e cancela os links ainda abertos deste documento.
    update public.signature_requests set signature_id = null where signature_id = s.id;
    update public.signature_requests set revoked_at = now()
    where order_id = v.id and document = p_document and revoked_at is null;
  end if;

  perform set_config('phael.removing_signature', s.id::text, true);
  delete from public.order_signatures where id = s.id;
  perform set_config('phael.removing_signature', '', true);

  insert into public.service_order_events (company_id, order_id, kind, actor_id, note)
  values (v.company_id, v.id, 'note', auth.uid(),
          format('Assinatura %s apagada do comprovante de %s (era de %s, assinada em %s%s; SHA-256 %s)',
                 case p_role when 'client' then 'do cliente' else 'da empresa' end,
                 case p_document when 'intake' then 'entrada' else 'entrega' end,
                 s.signer_name,
                 to_char(s.signed_at at time zone 'America/Sao_Paulo', 'DD/MM/YYYY HH24:MI'),
                 case s.channel when 'remote_link' then ', pelo link' else '' end,
                 left(s.image_sha256, 16)));
end;
$$;

-- Substituída por remove_order_signature.
drop function public.remove_company_signature(uuid, public.signature_document);

revoke execute on all functions in schema public from public, anon;
revoke execute on all functions in schema private from public, anon;
grant execute on function public.remove_order_signature(uuid, public.signature_document, public.signature_role) to authenticated;
grant execute on function public.signature_view(text) to anon, authenticated;
grant execute on function public.sign_by_link(text, text, text) to anon, authenticated;
grant execute on function public.portal_order(text) to anon, authenticated;
grant execute on function public.portal_decide(text, boolean, text, text) to anon, authenticated;
grant execute on function public.portal_photos(text) to anon, authenticated;
grant execute on function public.charge_view(text) to anon, authenticated;
grant execute on function private.path_uuid(text, int) to anon, authenticated;
grant execute on function private.is_client_visible_photo(text) to anon, authenticated;
