-- Numeração sequencial por empresa (o teste de concorrência real está em
-- scripts/test-db-concurrency.sh, com várias conexões simultâneas).
begin;

insert into public.companies (id, name) values
  ('00000000-0000-0000-0000-00000000c0a1', 'Contador A'),
  ('00000000-0000-0000-0000-00000000c0b1', 'Contador B');

select tests.ok(private.next_number('00000000-0000-0000-0000-00000000c0a1', 'service_order') = 1, 'A: primeira OS = 1');
select tests.ok(private.next_number('00000000-0000-0000-0000-00000000c0a1', 'service_order') = 2, 'A: segunda OS = 2');
select tests.ok(private.next_number('00000000-0000-0000-0000-00000000c0b1', 'service_order') = 1, 'B tem sequência própria');
select tests.ok(private.next_number('00000000-0000-0000-0000-00000000c0a1', 'quote') = 1, 'chaves diferentes são independentes');

rollback;
