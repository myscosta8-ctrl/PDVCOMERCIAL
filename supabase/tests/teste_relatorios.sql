-- Testes: relatório gerencial
-- Rodar depois de teste_base.sql (reaproveita empresas e usuários).
\set ON_ERROR_STOP 1
set client_min_messages = warning;

create or replace function pg_temp.como(u text) returns void language plpgsql as $$
begin
  perform set_config('request.jwt.claim.sub', u, false);
  execute 'set role authenticated';
end $$;
create or replace function pg_temp.espera_erro(sql text, trecho text) returns void language plpgsql as $$
begin
  begin execute sql;
  exception when others then
    if position(trecho in sqlerrm) = 0 then raise exception 'Erro inesperado: % (esperado: %)', sqlerrm, trecho; end if;
    return;
  end;
  raise exception 'Deveria ter falhado: %', sql;
end $$;

select pg_temp.como('00000000-0000-0000-0000-00000000a002');
select pg_temp.espera_erro($q$select public.relatorio_gerencial(current_date, current_date)$q$, 'Somente gerente');
select pg_temp.como('00000000-0000-0000-0000-00000000a001');
select pg_temp.espera_erro($q$select public.relatorio_gerencial(current_date, current_date - 1)$q$, 'Período inválido');
select pg_temp.espera_erro($q$select public.relatorio_gerencial(current_date - 500, current_date)$q$, '400 dias');
do $$ declare r jsonb := public.relatorio_gerencial(current_date - 6, current_date); s numeric; begin
  assert (r->'resumo'->>'qtd')::int > 0, 'vendas no período';
  assert jsonb_array_length(r->'por_dia') = 7, 'sete dias';
  select sum((x->>'total')::numeric) into s from jsonb_array_elements(r->'por_dia') x;
  assert s = (r->'resumo'->>'total')::numeric, 'dia a dia soma o total';
  select sum((x->>'total')::numeric) into s from jsonb_array_elements(r->'produtos') x;
  assert s = (select sum(i.total) from public.venda_itens i join public.vendas v on v.id = i.venda_id
               where v.status = 'concluida' and (v.criado_em at time zone 'America/Sao_Paulo')::date >= current_date - 6), 'produtos somam os itens';
  select sum((x->>'total')::numeric) into s from jsonb_array_elements(r->'formas') x;
  assert s = (select sum(v.total) from public.vendas v where v.status = 'concluida' and (v.criado_em at time zone 'America/Sao_Paulo')::date >= current_date - 6
               and exists (select 1 from public.venda_pagamentos p where p.venda_id = v.id)), 'formas somam o total (troco descontado)';
  assert jsonb_array_length(r->'operadores') >= 1, 'operadores';
  assert (r->'periodo'->>'anterior_fim')::date = current_date - 7, 'período anterior';
end $$;
-- Outra empresa não vê as vendas da A
select pg_temp.como('00000000-0000-0000-0000-00000000b001');
do $$ declare r jsonb := public.relatorio_gerencial(current_date - 6, current_date); begin
  assert (r->'resumo'->>'total')::numeric = (select coalesce(sum(total), 0) from public.vendas where status = 'concluida'
     and (criado_em at time zone 'America/Sao_Paulo')::date >= current_date - 6), 'isolado';
end $$;
reset role;
