-- Testes: taxa de serviço nas comandas
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

-- Rodar depois de teste_comandas.sql (reaproveita os produtos)
select pg_temp.como('00000000-0000-0000-0000-00000000a001');
create temp table cx(caixa uuid); grant all on cx to authenticated;
insert into cx select public.abrir_caixa(32::smallint, 0);
select pg_temp.como('00000000-0000-0000-0000-00000000a002');
create temp table tx(id uuid, n text); grant all on tx to authenticated;
insert into tx select public.abrir_comanda(null, 'Taxa A'), 'a';
insert into tx select public.abrir_comanda(null, 'Taxa B'), 'b';
select public.lancar_itens_comanda((select id from tx where n = 'a'), '[{"produto_id":"00000000-0000-0000-0000-0000000c0a01","quantidade":1},{"produto_id":"00000000-0000-0000-0000-0000000c0a02","quantidade":2}]');
select public.lancar_itens_comanda((select id from tx where n = 'b'), '[{"produto_id":"00000000-0000-0000-0000-0000000c0a02","quantidade":1}]');
-- Sem taxa configurada, não cobra
select pg_temp.espera_erro(format($q$select public.fechar_comanda(%L, (select caixa from cx), '[{"forma":"dinheiro","valor":40}]', p_taxa_servico => true)$q$, (select id from tx where n = 'a')), 'não está configurada');
-- Operador não altera a configuração da empresa
reset role;
update public.empresas set taxa_servico = 10 where id = (select empresa_id from public.usuarios where id = '00000000-0000-0000-0000-00000000a001');
select pg_temp.espera_erro($q$update public.empresas set taxa_servico = 25 where taxa_servico = 10$q$, 'empresas_taxa_servico');
select pg_temp.como('00000000-0000-0000-0000-00000000a002');
-- Conta 25 + 12 = 37, desconto 2 -> 35, taxa 10% = 3,50 -> 38,50
select pg_temp.espera_erro(format($q$select public.fechar_comanda(%L, (select caixa from cx), '[{"forma":"pix","valor":37}]', p_desconto => 2, p_taxa_servico => true)$q$, (select id from tx where n = 'a')), 'Pagamento insuficiente');
create temp table tv(n text, r jsonb); grant all on tv to authenticated;
insert into tv select 'a', public.fechar_comanda((select id from tx where n = 'a'), (select caixa from cx), '[{"forma":"pix","valor":38.5}]', p_desconto => 2, p_taxa_servico => true);
-- Cliente recusou a taxa
insert into tv select 'b', public.fechar_comanda((select id from tx where n = 'b'), (select caixa from cx), '[{"forma":"dinheiro","valor":6}]');
-- Venda no caixa comum nunca leva taxa
reset role;
do $$ begin
  assert (select (r->>'total')::numeric from tv where n = 'a') = 38.5, 'total com taxa';
  assert (select (r->>'taxa_servico')::numeric from tv where n = 'a') = 3.5, 'taxa calculada';
  assert (select taxa_servico from public.vendas where id = (select (r->>'venda_id')::uuid from tv where n = 'a')) = 3.5, 'taxa gravada';
  assert (select subtotal from public.vendas where id = (select (r->>'venda_id')::uuid from tv where n = 'a')) = 37, 'subtotal sem taxa';
  assert (select taxa_servico from public.vendas where id = (select (r->>'venda_id')::uuid from tv where n = 'b')) = 0, 'sem taxa quando recusada';
  assert coalesce(current_setting('pdv.taxa_servico', true), '') = '', 'configuração limpa';
end $$;
-- Relatório: faturamento sem a taxa, taxa à parte
select pg_temp.como('00000000-0000-0000-0000-00000000a001');
create temp table rel(r jsonb); grant all on rel to authenticated;
insert into rel select public.relatorio_gerencial(((now() at time zone 'America/Sao_Paulo')::date), ((now() at time zone 'America/Sao_Paulo')::date));
reset role;
do $$ declare t numeric; begin
  select sum(total - taxa_servico) into t from public.vendas where status = 'concluida'
     and (criado_em at time zone 'America/Sao_Paulo')::date = (now() at time zone 'America/Sao_Paulo')::date
     and empresa_id = (select empresa_id from public.usuarios where id = '00000000-0000-0000-0000-00000000a001');
  assert (select (r->'resumo'->>'total')::numeric from rel) = t, 'faturamento sem taxa';
  assert (select (r->'resumo'->>'taxa_servico')::numeric from rel) = 3.5, 'taxa no resumo';
end $$;
