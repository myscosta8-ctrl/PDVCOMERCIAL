-- Testes: indicadores do mês (gestor vê; operador não)
\set ON_ERROR_STOP 1
set client_min_messages = warning;
create or replace function pg_temp.como(u text) returns void language plpgsql as $$
begin reset role; perform set_config('request.jwt.claim.sub', u, false); execute 'set role authenticated'; end $$;
select pg_temp.como('00000000-0000-0000-0000-00000000a002');
do $$ begin
  begin perform public.indicadores_mes(); raise exception 'operador não deveria ver';
  exception when others then if sqlerrm not like '%Somente gerente%' then raise; end if; end;
end $$;
select pg_temp.como('00000000-0000-0000-0000-00000000a001');
do $$ declare r jsonb := public.indicadores_mes(); begin
  assert (r->'vendas'->>'qtd')::int > 0, 'vendas do mês';
  assert (r->'vendas'->>'total')::numeric > 0, 'total do mês';
  assert jsonb_typeof(r->'mais_vendidos') = 'array', 'mais vendidos';
  assert r->'financeiro' ? 'pagos_mes', 'financeiro';
  assert (r->>'dia')::int between 1 and 31, 'dia';
end $$;
reset role;
