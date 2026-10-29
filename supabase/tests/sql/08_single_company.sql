-- Uso exclusivo: só a primeira empresa é criada pelo onboarding; o resto entra por convite.
begin;

select tests.create_user('00000000-0000-0000-0000-0000000000a1', 'dono@phael.test');
select tests.create_user('00000000-0000-0000-0000-0000000000c1', 'estranho@x.test');
select tests.create_user('00000000-0000-0000-0000-0000000000d1', 'tecnico@phael.test');

select tests.login('00000000-0000-0000-0000-0000000000a1');
select tests.ok(public.can_create_company(), 'sem empresas, o primeiro usuário pode criar a empresa');
select public.create_company('Phael Tech Support') as company \gset
select tests.ok(not public.can_create_company(), 'depois da primeira, o próprio dono não cria outra');
select public.create_invitation(:'company', 'tecnico@phael.test', 'technician') as token \gset
reset role;

select tests.login('00000000-0000-0000-0000-0000000000c1');
select tests.ok(not public.can_create_company(), 'quem chega depois vê "aguardando convite"');
select tests.throws($q$select public.create_company('Concorrente')$q$, '42501', 'quem chega depois não cria empresa');
select tests.ok((select count(*) from public.companies) = 0, 'quem não tem convite não enxerga a empresa');
reset role;

select tests.login('00000000-0000-0000-0000-0000000000d1');
select tests.ok(public.accept_invitation(:'token') = :'company', 'convidado entra na empresa existente');
select tests.ok((select count(*) from public.companies) = 1, 'convidado passa a ver a empresa');
reset role;

select tests.ok((select count(*) from public.companies) = 1, 'continua existindo uma única empresa');

select tests.login_anon();
select tests.throws('select public.can_create_company()', '42501', 'anon não consulta can_create_company');
reset role;

rollback;
