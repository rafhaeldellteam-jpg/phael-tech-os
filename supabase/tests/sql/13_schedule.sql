-- Agenda: criação, sobreposição por técnico, situações, conversão em OS, permissões e isolamento.
begin;

select tests.create_user('00000000-0000-0000-0000-0000000000a1', 'admin@a.test');
select tests.create_user('00000000-0000-0000-0000-0000000000a2', 'tec@a.test');
select tests.create_user('00000000-0000-0000-0000-0000000000a3', 'fin@a.test');
select tests.create_user('00000000-0000-0000-0000-0000000000a4', 'atend@a.test');
select tests.create_user('00000000-0000-0000-0000-0000000000b1', 'admin@b.test');

select tests.login('00000000-0000-0000-0000-0000000000a1');
select public.create_company('Empresa A') as company_a \gset
select public.save_client(:'company_a', null, '{"kind":"person","name":"Cliente Agenda"}') as cli \gset
select public.save_client(:'company_a', null, '{"kind":"person","name":"Outro Cliente"}') as cli2 \gset
select public.save_equipment(:'company_a', null, format('{"client_id":"%s","type":"notebook"}', :'cli')::jsonb) as eq \gset
reset role;
insert into public.company_members (company_id, user_id, role) values
  (:'company_a', '00000000-0000-0000-0000-0000000000a2', 'technician'),
  (:'company_a', '00000000-0000-0000-0000-0000000000a3', 'finance'),
  (:'company_a', '00000000-0000-0000-0000-0000000000a4', 'attendant');
select tests.create_company_as('00000000-0000-0000-0000-0000000000b1', 'Empresa B') as company_b \gset

select tests.login('00000000-0000-0000-0000-0000000000a1');
select public.save_appointment(:'company_a', null, format(
  '{"kind":"onsite","title":"Visita: rede caindo","client_id":"%s","assigned_to":"00000000-0000-0000-0000-0000000000a2","starts_at":"2026-11-03T13:00:00Z","ends_at":"2026-11-03T15:00:00Z","location":"Rua A, 10"}',
  :'cli')::jsonb) as ap1 \gset
select tests.ok((select number = 1 and status = 'scheduled' from public.appointments where id = :'ap1'), 'agendamento criado com número sequencial');

select tests.throws(format($q$select public.save_appointment(%L, null, '{"title":"Choque","client_id":"%s","assigned_to":"00000000-0000-0000-0000-0000000000a2","starts_at":"2026-11-03T14:00:00Z","ends_at":"2026-11-03T16:00:00Z"}')$q$,
  :'company_a', :'cli2'), '23P01', 'mesmo técnico não tem dois atendimentos sobrepostos');
select public.save_appointment(:'company_a', null, format(
  '{"title":"Logo depois","client_id":"%s","assigned_to":"00000000-0000-0000-0000-0000000000a2","starts_at":"2026-11-03T15:00:00Z","ends_at":"2026-11-03T16:00:00Z"}', :'cli2')::jsonb) as ap2 \gset
select tests.ok(:'ap2' is not null, 'horário encostado (fim = início) não conta como sobreposição');
select public.save_appointment(:'company_a', null, format(
  '{"title":"Sem responsável","client_id":"%s","starts_at":"2026-11-03T14:00:00Z","ends_at":"2026-11-03T15:00:00Z"}', :'cli2')::jsonb) as ap3 \gset
select tests.ok(:'ap3' is not null, 'agendamento sem responsável não bloqueia horário');

select tests.throws(format($q$select public.save_appointment(%L, null, '{"title":"Invertido","client_id":"%s","starts_at":"2026-11-03T15:00:00Z","ends_at":"2026-11-03T14:00:00Z"}')$q$,
  :'company_a', :'cli'), '23514', 'fim antes do início é rejeitado');
select tests.throws(format($q$select public.save_appointment(%L, null, '{"title":"Equipamento alheio","client_id":"%s","equipment_id":"%s","starts_at":"2026-11-04T15:00:00Z","ends_at":"2026-11-04T16:00:00Z"}')$q$,
  :'company_a', :'cli2', :'eq'), '23514', 'equipamento precisa ser do cliente');
select tests.throws(format($q$select public.save_appointment(%L, null, '{"title":"Atendente agenda?","client_id":"%s","assigned_to":"00000000-0000-0000-0000-0000000000a4","starts_at":"2026-11-04T15:00:00Z","ends_at":"2026-11-04T16:00:00Z"}')$q$,
  :'company_a', :'cli'), '23514', 'responsável precisa ser técnico ou administrador');
select tests.throws(format($q$select public.save_appointment(%L, null, '{"title":"Maratona","client_id":"%s","starts_at":"2026-11-04T08:00:00Z","ends_at":"2026-11-04T21:00:00Z"}')$q$,
  :'company_a', :'cli'), '23514', 'agendamento de mais de 12 horas é rejeitado');

-- Editar e mover
select public.save_appointment(:'company_a', :'ap1', format(
  '{"title":"Visita: rede caindo (2º andar)","client_id":"%s","assigned_to":"00000000-0000-0000-0000-0000000000a2","starts_at":"2026-11-03T12:00:00Z","ends_at":"2026-11-03T14:00:00Z"}', :'cli')::jsonb);
select tests.ok((select title like '%2º andar%' and starts_at = '2026-11-03T12:00:00Z' and location = 'Rua A, 10' from public.appointments where id = :'ap1'),
  'edição muda horário e mantém o que não veio');
select tests.throws(format($q$select public.save_appointment(%L, %L, '{"title":"Mover em cima","client_id":"%s","assigned_to":"00000000-0000-0000-0000-0000000000a2","starts_at":"2026-11-03T15:30:00Z","ends_at":"2026-11-03T16:30:00Z"}')$q$,
  :'company_a', :'ap1', :'cli'), '23P01', 'mover para horário ocupado é rejeitado');

-- ---------------------------------------------------------------- situações
select tests.throws(format($q$select public.set_appointment_status(%L, 'canceled')$q$, :'ap2'), '23514', 'cancelar exige motivo');
select public.set_appointment_status(:'ap2', 'canceled', 'Cliente desmarcou');
select tests.ok((select status = 'canceled' and status_reason = 'Cliente desmarcou' from public.appointments where id = :'ap2'), 'cancelado com motivo');
select public.save_appointment(:'company_a', null, format(
  '{"title":"Ocupa o horário liberado","client_id":"%s","assigned_to":"00000000-0000-0000-0000-0000000000a2","starts_at":"2026-11-03T15:00:00Z","ends_at":"2026-11-03T16:00:00Z"}', :'cli')::jsonb) as ap4 \gset
select tests.ok(:'ap4' is not null, 'cancelado libera o horário');
select tests.throws(format($q$select public.set_appointment_status(%L, 'scheduled')$q$, :'ap2'), '23P01', 'reagendar cancelado em horário ocupado é rejeitado');
select tests.throws(format($q$select public.save_appointment(%L, %L, '{"title":"Editar cancelado","client_id":"%s","starts_at":"2026-11-05T15:00:00Z","ends_at":"2026-11-05T16:00:00Z"}')$q$,
  :'company_a', :'ap2', :'cli'), '23514', 'cancelado não é editado');
select public.set_appointment_status(:'ap1', 'confirmed');
select tests.throws(format($q$select public.set_appointment_status(%L, 'scheduled')$q$, :'ap1'), '23514', 'confirmado não volta para agendado');

-- ---------------------------------------------------------------- permissões
select tests.login('00000000-0000-0000-0000-0000000000a2');
select tests.ok((select count(*) from public.appointments) = 4, 'técnico com schedule.read vê a agenda');
select tests.throws(format($q$select public.save_appointment(%L, null, '{"title":"Técnico agenda","client_id":"%s","starts_at":"2026-11-06T15:00:00Z","ends_at":"2026-11-06T16:00:00Z"}')$q$,
  :'company_a', :'cli'), '42501', 'técnico sem schedule.write não cria agendamento');
select tests.throws(format($q$select public.set_appointment_status(%L, 'canceled', 'não quero')$q$, :'ap1'), '42501', 'técnico não cancela');
select public.set_appointment_status(:'ap1', 'done');
select tests.ok((select status from public.appointments where id = :'ap1') = 'done', 'técnico responsável registra que atendeu');
select tests.throws(format($q$select public.set_appointment_status(%L, 'done')$q$, :'ap3'), '42501', 'técnico não conclui atendimento de outro');
select tests.ok((select total from public.appointments_today(:'company_a')) >= 0, 'técnico consulta os atendimentos do dia');

select tests.login('00000000-0000-0000-0000-0000000000a3');
select tests.ok((select count(*) from public.appointments) = 0, 'financeiro sem schedule.read não vê a agenda');
select tests.throws(format($q$select * from public.appointments_today(%L)$q$, :'company_a'), '42501', 'financeiro não consulta o dia');

select tests.login('00000000-0000-0000-0000-0000000000a1');
select tests.throws(format($q$insert into public.appointments (company_id, number, title, client_id, starts_at, ends_at) values (%L, 99, 'Direto', %L, now(), now() + interval '1 hour')$q$,
  :'company_a', :'cli'), '42501', 'agendamento não é gravado direto na tabela');

-- ---------------------------------------------------------------- conversão em OS
select tests.throws(format('select public.convert_appointment_to_order(%L)', :'ap2'), '23514', 'cancelado não vira OS');
select public.convert_appointment_to_order(:'ap1') as os1 \gset
select tests.ok((select mode = 'onsite' and client_id = :'cli'::uuid and assigned_to = '00000000-0000-0000-0000-0000000000a2'::uuid
  and reported_problem like 'Visita: rede caindo%' from public.service_orders where id = :'os1'), 'OS nasce com cliente, modo e técnico do agendamento');
select tests.ok((select order_id = :'os1'::uuid from public.appointments where id = :'ap1'), 'agendamento fica ligado à OS');
select tests.throws(format('select public.convert_appointment_to_order(%L)', :'ap1'), '23505', 'não converte duas vezes');
select public.save_appointment(:'company_a', null, format(
  '{"kind":"dropoff","title":"Cliente traz o notebook","client_id":"%s","starts_at":"2026-11-07T15:00:00Z","ends_at":"2026-11-07T15:30:00Z"}', :'cli')::jsonb) as ap5 \gset
select tests.throws(format('select public.convert_appointment_to_order(%L)', :'ap5'), '23514', 'entrega de equipamento sem equipamento não vira OS de bancada');
select public.save_appointment(:'company_a', :'ap5', format(
  '{"kind":"dropoff","title":"Cliente traz o notebook","client_id":"%s","equipment_id":"%s","starts_at":"2026-11-07T15:00:00Z","ends_at":"2026-11-07T15:30:00Z"}', :'cli', :'eq')::jsonb);
select public.convert_appointment_to_order(:'ap5', 'Tela piscando') as os2 \gset
select tests.ok((select mode = 'bench' and equipment_id = :'eq'::uuid and reported_problem = 'Tela piscando' from public.service_orders where id = :'os2'),
  'entrega de equipamento vira OS de bancada com o problema informado');
select tests.ok(exists (select 1 from public.audit_log where entity = 'appointments' and entity_id = :'ap1'), 'agendamento fica na auditoria');

-- ---------------------------------------------------------------- isolamento
select tests.login('00000000-0000-0000-0000-0000000000b1');
select tests.ok((select count(*) from public.appointments) = 0, 'Empresa B não vê agenda da A');
select tests.throws(format($q$select public.save_appointment(%L, null, '{"title":"Invasão","client_id":"%s","starts_at":"2026-11-08T15:00:00Z","ends_at":"2026-11-08T16:00:00Z"}')$q$,
  :'company_a', :'cli'), '42501', 'Empresa B não agenda na A');
select tests.throws(format($q$select public.save_appointment(%L, null, '{"title":"Cliente alheio","client_id":"%s","starts_at":"2026-11-08T15:00:00Z","ends_at":"2026-11-08T16:00:00Z"}')$q$,
  :'company_b', :'cli'), 'P0002', 'Empresa B não usa cliente da A');
select tests.throws(format($q$select public.set_appointment_status(%L, 'canceled', 'invasão')$q$, :'ap3'), 'P0002', 'Empresa B não altera agendamento da A');
select tests.throws(format('select public.convert_appointment_to_order(%L)', :'ap3'), 'P0002', 'Empresa B não converte agendamento da A');

select tests.login_anon();
select tests.throws(format($q$select * from public.appointments_today(%L)$q$, :'company_a'), '42501', 'anônimo não executa funções da agenda');
reset role;

rollback;
