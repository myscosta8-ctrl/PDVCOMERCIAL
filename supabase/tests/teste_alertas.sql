-- Testes: alertas de vencimento respeitam o papel do usuário e o prazo configurado.
\set ON_ERROR_STOP 1
set client_min_messages = warning;
create or replace function pg_temp.como(u text) returns void language plpgsql as $$
begin reset role; perform set_config('request.jwt.claim.sub', u, false); execute 'set role authenticated'; end $$;

select pg_temp.como('00000000-0000-0000-0000-00000000a001');
create temp table base as select public.alertas_vencimento() inicial;
update public.empresas set alertas = '{"dias_pagar": 3, "dias_validade": 30, "dias_certificado": 30}', certificado_validade = now() + interval '10 days'
 where id = '00000000-0000-0000-0000-0000000000a1';
insert into public.lancamentos(tipo, descricao, plano_conta_id, valor, vencimento, competencia) values
  ('pagar', 'Alerta vencida', (select id from public.plano_contas where tipo = 'despesa' limit 1), 100, current_date - 2, current_date),
  ('pagar', 'Alerta vence em 2 dias', (select id from public.plano_contas where tipo = 'despesa' limit 1), 50, current_date + 2, current_date),
  ('pagar', 'Alerta vence em 10 dias', (select id from public.plano_contas where tipo = 'despesa' limit 1), 70, current_date + 10, current_date),
  ('receber', 'Alerta receber atrasado', (select id from public.plano_contas where tipo = 'receita' limit 1), 40, current_date - 1, current_date);
insert into public.produtos(id, descricao, ean, ncm, preco_venda) values ('00000000-0000-0000-0000-0000000a1e01', 'Produto alerta', '7896000000a11', '30049099', 10);
select public.lancar_estoque('00000000-0000-0000-0000-0000000a1e01', 'entrada', 3, null, 5, null, 'ALV1', current_date - 1);
select public.lancar_estoque('00000000-0000-0000-0000-0000000a1e01', 'entrada', 3, null, 5, null, 'ALV2', current_date + 20);
select public.lancar_estoque('00000000-0000-0000-0000-0000000a1e01', 'entrada', 3, null, 5, null, 'ALV3', current_date + 90);

do $$
declare a jsonb := public.alertas_vencimento(); b jsonb := (select inicial from base);
begin
  assert (a->'pagar_vencidas'->>'qtd')::int = (b->'pagar_vencidas'->>'qtd')::int + 1, 'pagar vencida';
  assert (a->'pagar_vencendo'->>'qtd')::int = (b->'pagar_vencendo'->>'qtd')::int + 1, 'só a de 2 dias entra no prazo de 3';
  assert (a->'receber_atrasadas'->>'qtd')::int >= (b->'receber_atrasadas'->>'qtd')::int + 1, 'receber atrasado';
  assert (a->'lotes_vencidos'->>'qtd')::int = (b->'lotes_vencidos'->>'qtd')::int + 1, 'lote vencido';
  assert (a->'lotes_vencendo'->'lista') @> '[{"numero":"ALV2"}]', 'lote em 20 dias';
  assert not (a->'lotes_vencendo'->'lista') @> '[{"numero":"ALV3"}]', 'lote em 90 dias fica fora';
  assert (a->'certificado'->>'dias')::int between 9 and 10, 'certificado';
end $$;

-- Operador: não vê financeiro nem certificado, mas vê lotes
select pg_temp.como('00000000-0000-0000-0000-00000000a002');
do $$
declare a jsonb := public.alertas_vencimento();
begin
  assert (a->'pagar_vencidas'->>'qtd')::int = 0, 'operador não vê contas a pagar';
  assert a->'certificado' is null, 'operador não vê certificado';
  assert (a->'lotes_vencidos'->>'qtd')::int >= 1, 'operador vê lote vencido';
end $$;
reset role;
select 'alertas ok';
