-- Convites: criação, aceite, e-mail errado, reutilização, expiração e revogação.
begin;

select tests.create_user('00000000-0000-0000-0000-0000000000a1', 'admin@a.test');
select tests.create_user('00000000-0000-0000-0000-0000000000d1', 'Convidado@Exemplo.test');
select tests.create_user('00000000-0000-0000-0000-0000000000e1', 'intruso@exemplo.test');

select tests.login('00000000-0000-0000-0000-0000000000a1');
select public.create_company('Empresa A') as company_a \gset
select public.create_invitation(:'company_a', 'convidado@exemplo.test', 'technician') as token \gset
select tests.ok(length(:'token') = 64, 'token tem 64 caracteres hexadecimais');
select tests.ok((select count(*) from public.company_invitations where company_id = :'company_a') = 1,
  'admin vê o convite pendente');
select tests.throws('select token_hash from public.company_invitations', '42501',
  'o hash do token não é legível');
reset role;

select tests.ok(
  (select token_hash from public.company_invitations limit 1) <> convert_to(:'token', 'UTF8'),
  'o token não é armazenado em texto puro');

-- Intruso com o token certo, mas e-mail diferente
select tests.login('00000000-0000-0000-0000-0000000000e1');
select tests.throws(format('select public.accept_invitation(%L)', :'token'), '22023',
  'convite não é aceito por outro e-mail');
select tests.throws($q$select public.accept_invitation('nao-e-um-token')$q$, '22023',
  'token malformado é rejeitado');
reset role;

-- Convidado correto (e-mail com caixa diferente)
select tests.login('00000000-0000-0000-0000-0000000000d1');
select tests.ok(public.accept_invitation(:'token') = :'company_a', 'convidado entra na empresa');
select tests.ok(private.member_role(:'company_a') = 'technician', 'papel do convite é aplicado');
select tests.throws(format('select public.accept_invitation(%L)', :'token'), '22023',
  'convite não pode ser reutilizado');
reset role;

-- Expiração
select tests.login('00000000-0000-0000-0000-0000000000a1');
select tests.throws(
  format($q$select public.create_invitation(%L, 'convidado@exemplo.test', 'finance')$q$, :'company_a'),
  '23505', 'não convida quem já é membro');
select public.create_invitation(:'company_a', 'intruso@exemplo.test', 'attendant') as token2 \gset
reset role;
update public.company_invitations set expires_at = now() - interval '1 minute'
 where email = 'intruso@exemplo.test';
select tests.login('00000000-0000-0000-0000-0000000000e1');
select tests.throws(format('select public.accept_invitation(%L)', :'token2'), '22023',
  'convite expirado é rejeitado');
reset role;

-- Revogação
select tests.login('00000000-0000-0000-0000-0000000000a1');
select public.create_invitation(:'company_a', 'intruso@exemplo.test', 'attendant') as token3 \gset
select tests.ok(
  (select count(*) from public.company_invitations
    where email = 'intruso@exemplo.test' and revoked_at is null and accepted_at is null) = 1,
  'novo convite revoga o pendente anterior');
select id as inv3 from public.company_invitations
 where email = 'intruso@exemplo.test' and revoked_at is null \gset
select public.revoke_invitation(:'inv3');
select tests.throws(
  format($q$select public.create_invitation(%L, 'a@b.test', 'admin', 90)$q$, :'company_a'),
  '22023', 'validade acima de 30 dias é rejeitada');
reset role;
select tests.login('00000000-0000-0000-0000-0000000000e1');
select tests.throws(format('select public.accept_invitation(%L)', :'token3'), '22023',
  'convite revogado é rejeitado');
reset role;

rollback;
