-- Testes do Grupo D: inventário com coletor, transferência entre filiais e complemento do financeiro.
\set ON_ERROR_STOP 1
set client_min_messages = warning;
create or replace function pg_temp.como(u text) returns void language plpgsql as $$
begin perform set_config('request.jwt.claim.sub', u, false); execute 'set role authenticated'; end $$;
create or replace function pg_temp.espera_erro(sql text, trecho text) returns void language plpgsql as $$
begin
  begin execute sql;
  exception when others then
    if position(trecho in sqlerrm) = 0 then raise exception 'Erro inesperado: % (esperado: %)', sqlerrm, trecho; end if;
    return;
  end;
  raise exception 'Deveria ter falhado: %', sql;
end $$;
create or replace function pg_temp.estoque(p uuid) returns numeric language sql as $$ select estoque_atual from public.produtos where id = p $$;

-- Produtos de teste na empresa A
select pg_temp.como('00000000-0000-0000-0000-00000000a001');
insert into public.produtos(id, descricao, ean, codigo, preco_venda, preco_custo) values
  ('00000000-0000-0000-0000-0000000000d1', 'Sabonete neutro', '7890000000901', 'SAB1', 5, 2),
  ('00000000-0000-0000-0000-0000000000d2', 'Shampoo 300 ml', '7890000000902', 'SHA1', 20, 9),
  ('00000000-0000-0000-0000-0000000000d3', 'Escova dental', '7890000000903', null, 8, 3);
select public.lancar_estoque('00000000-0000-0000-0000-0000000000d1', 'entrada', 10, null, 2);
select public.lancar_estoque('00000000-0000-0000-0000-0000000000d2', 'entrada', 5, null, 9, null, 'LT1', current_date + 30);
select public.lancar_estoque('00000000-0000-0000-0000-0000000000d2', 'entrada', 3, null, 9, null, 'LT2', current_date + 90);
select public.lancar_estoque('00000000-0000-0000-0000-0000000000d3', 'entrada', 4, null, 3);

-- 1) Operador não abre inventário
reset role; select pg_temp.como('00000000-0000-0000-0000-00000000a002');
select pg_temp.espera_erro($q$select public.abrir_inventario('x')$q$, 'Somente gerente');
reset role; select pg_temp.como('00000000-0000-0000-0000-00000000a001');

create temp table inv(id uuid); grant all on inv to authenticated;
insert into inv select public.abrir_inventario('Contagem geral', 'todos');
do $$ begin
  assert (select count(*) from public.inventario_itens where inventario_id = (select id from inv)) >= 3, 'itens carregados';
end $$;

-- 2) Coletor: leituras somam; operador também conta
select public.contar_inventario((select id from inv), '7890000000901');
select public.contar_inventario((select id from inv), 'SAB1', 6);
reset role; select pg_temp.como('00000000-0000-0000-0000-00000000a002');
select public.contar_inventario((select id from inv), '7890000000902', 4);   -- shampoo: sistema 8, contado 4
select pg_temp.espera_erro($q$select public.contar_inventario((select id from inv), '999')$q$, 'Produto não encontrado');
reset role; select pg_temp.como('00000000-0000-0000-0000-00000000a001');
-- importação do arquivo: escova 5 (sobra 1) + código inexistente
create temp table imp(r jsonb); grant all on imp to authenticated;
insert into imp select public.importar_contagem((select id from inv), '[{"codigo":"7890000000903","quantidade":5},{"codigo":"000","quantidade":1}]');
do $$ begin
  assert ((select r from imp)->>'lidos')::int = 1, 'um lido';
  assert jsonb_array_length((select r from imp)->'rejeitados') = 1, 'um rejeitado';
  assert (select contado from public.inventario_itens where produto_id = '00000000-0000-0000-0000-0000000000d1' and inventario_id = (select id from inv)) = 7, 'somou 1 + 6';
end $$;
-- desfazer a última leitura do sabonete volta para 1
select public.desfazer_leitura((select id from public.inventario_leituras where produto_id = '00000000-0000-0000-0000-0000000000d1' order by criado_em desc limit 1));
select public.contar_inventario((select id from inv), '7890000000901', 9, 'definir');   -- sabonete: sistema 10, contado 9
-- venda durante a contagem não pode virar falta: baixa 1 do sabonete depois de contado
select public.lancar_estoque('00000000-0000-0000-0000-0000000000d1', 'perda', 1);

-- 3) Finalizar
create temp table res(r jsonb); grant all on res to authenticated;
insert into res select public.finalizar_inventario((select id from inv), false);
do $$ begin
  assert pg_temp.estoque('00000000-0000-0000-0000-0000000000d1') = 8, 'sabonete: 10 -1 (perda) -1 (falta) = 8';
  assert pg_temp.estoque('00000000-0000-0000-0000-0000000000d2') = 4, 'shampoo ajustado para 4';
  assert pg_temp.estoque('00000000-0000-0000-0000-0000000000d3') = 5, 'escova com sobra';
  -- falta de 4 no shampoo sai do lote que vence primeiro
  assert (select quantidade from public.lotes where numero = 'LT1') = 1, 'LT1 baixado primeiro';
  assert (select quantidade from public.lotes where numero = 'LT2') = 3, 'LT2 intacto';
  assert ((select r from res)->>'itens_ajustados')::int = 3, 'três ajustes';
  assert ((select r from res)->>'falta_valor')::numeric = 2 + 36, 'valor da falta';
  assert ((select r from res)->>'sobra_valor')::numeric = 3, 'valor da sobra';
end $$;
select pg_temp.espera_erro($q$select public.contar_inventario((select id from inv), '7890000000901')$q$, 'encerrado');

-- 4) Inventário livre e zerar não contados não se aplica; inventário por categoria zera os não contados
insert into public.categorias(id, nome) values ('00000000-0000-0000-0000-0000000000c9', 'Higiene pessoal (inventário)');
update public.produtos set categoria_id = '00000000-0000-0000-0000-0000000000c9' where id in ('00000000-0000-0000-0000-0000000000d1','00000000-0000-0000-0000-0000000000d3');
delete from inv; insert into inv select public.abrir_inventario('Higiene', 'categoria', '00000000-0000-0000-0000-0000000000c9');
select public.contar_inventario((select id from inv), '7890000000901', 8, 'definir');
select public.finalizar_inventario((select id from inv), true);
do $$ begin
  assert pg_temp.estoque('00000000-0000-0000-0000-0000000000d1') = 8, 'sabonete sem diferença';
  assert pg_temp.estoque('00000000-0000-0000-0000-0000000000d3') = 0, 'escova não contada foi zerada';
  assert pg_temp.estoque('00000000-0000-0000-0000-0000000000d2') = 4, 'shampoo fora da categoria intacto';
end $$;

-- 5) Isolamento: empresa B não vê inventários de A
reset role; select pg_temp.como('00000000-0000-0000-0000-00000000b001');
do $$ begin assert (select count(*) from public.inventarios) = 0, 'B não vê inventário de A'; end $$;

-- =====================================================================
-- Transferência entre filiais
-- =====================================================================
reset role; select set_config('request.jwt.claim.sub', '', false);
select pg_temp.como('00000000-0000-0000-0000-00000000a001');
select pg_temp.espera_erro($q$select public.enviar_transferencia('00000000-0000-0000-0000-0000000000b1', '[{"produto_id":"00000000-0000-0000-0000-0000000000d1","quantidade":1}]')$q$, 'destino inválida');
reset role; select set_config('request.jwt.claim.sub', '', false);
update public.empresas set grupo_id = '00000000-0000-0000-0000-00000000aaaa' where id in ('00000000-0000-0000-0000-0000000000a1','00000000-0000-0000-0000-0000000000b1');
select pg_temp.como('00000000-0000-0000-0000-00000000a001');
do $$ begin assert (select count(*) from public.filiais()) = 1, 'A enxerga B como filial'; end $$;
select pg_temp.espera_erro($q$select public.enviar_transferencia('00000000-0000-0000-0000-0000000000b1', '[{"produto_id":"00000000-0000-0000-0000-0000000000d1","quantidade":50}]')$q$, 'Estoque insuficiente');
create temp table tr(r jsonb); grant all on tr to authenticated;
insert into tr select public.enviar_transferencia('00000000-0000-0000-0000-0000000000b1', jsonb_build_array(
  jsonb_build_object('produto_id', '00000000-0000-0000-0000-0000000000d1', 'quantidade', 3),
  jsonb_build_object('produto_id', '00000000-0000-0000-0000-0000000000d2', 'quantidade', 2, 'lote_id', (select id from public.lotes where numero = 'LT2'))), 'Reposição');
do $$ begin
  assert pg_temp.estoque('00000000-0000-0000-0000-0000000000d1') = 5, 'saiu da origem';
  assert (select quantidade from public.lotes where numero = 'LT2' and empresa_id = '00000000-0000-0000-0000-0000000000a1') = 1, 'saiu do lote';
  assert (select valor_total from public.transferencias) = 3 * 2 + 2 * 9, 'valor pelo custo';
end $$;
select pg_temp.espera_erro($q$select public.receber_transferencia(((select r from tr)->>'transferencia_id')::uuid, '[]')$q$, 'não encontrada');

-- B recebe: sabonete já existe em B pelo código de barras; shampoo é cadastrado; chega 1 a menos de sabonete
reset role; select pg_temp.como('00000000-0000-0000-0000-00000000b001');
insert into public.produtos(id, descricao, ean, preco_venda) values ('00000000-0000-0000-0000-00000000bb09', 'Sabonete neutro (B)', '7890000000901', 5.5);
do $$ begin assert (select count(*) from public.transferencia_itens) = 2, 'B vê os itens'; end $$;
create temp table rc(r jsonb); grant all on rc to authenticated;
insert into rc select public.receber_transferencia(((select r from tr)->>'transferencia_id')::uuid,
  (select jsonb_agg(jsonb_build_object('item_id', id, 'quantidade_recebida', case when ean = '7890000000901' then 2 else quantidade end)) from public.transferencia_itens));
do $$ begin
  assert pg_temp.estoque('00000000-0000-0000-0000-00000000bb09') = 2, 'entrou no sabonete de B';
  assert (select estoque_atual from public.produtos where ean = '7890000000902' and empresa_id = '00000000-0000-0000-0000-0000000000b1') = 2, 'shampoo criado em B';
  assert (select quantidade from public.lotes where numero = 'LT2' and empresa_id = '00000000-0000-0000-0000-0000000000b1') = 2, 'lote criado em B';
  assert ((select r from rc)->>'divergencias')::int = 1, 'uma divergência';
  assert ((select r from rc)->>'produtos_novos')::int = 1, 'um produto novo';
end $$;
select pg_temp.espera_erro($q$select public.receber_transferencia(((select r from tr)->>'transferencia_id')::uuid, '[]')$q$, 'já recebida');

-- Cancelamento devolve o estoque à origem
reset role; select pg_temp.como('00000000-0000-0000-0000-00000000a001');
delete from tr; insert into tr select public.enviar_transferencia('00000000-0000-0000-0000-0000000000b1', '[{"produto_id":"00000000-0000-0000-0000-0000000000d1","quantidade":2}]');
select public.cancelar_transferencia(((select r from tr)->>'transferencia_id')::uuid);
do $$ begin assert pg_temp.estoque('00000000-0000-0000-0000-0000000000d1') = 5, 'estoque devolvido'; end $$;
reset role; select pg_temp.como('00000000-0000-0000-0000-00000000a002');
do $$ begin assert (select count(*) from public.transferencias) = 0, 'operador não vê transferências'; end $$;

-- =====================================================================
-- Financeiro: saldos, transferência entre contas e painel
-- =====================================================================
reset role; select pg_temp.como('00000000-0000-0000-0000-00000000a001');
insert into public.contas_bancarias(id, nome, tipo, saldo_inicial, data_saldo) values ('00000000-0000-0000-0000-00000000cb01', 'Banco X', 'banco', 1000, current_date - 10);
select public.movimentar_conta('00000000-0000-0000-0000-00000000cb01', 300, 'deposito_vendas', 'Repasse da maquininha');
select public.movimentar_conta('00000000-0000-0000-0000-00000000cb01', 200, 'transferencia', 'Troco para o caixa', null,
  (select id from public.contas_bancarias where nome = 'Caixa da loja'));
select pg_temp.espera_erro($q$select public.movimentar_conta('00000000-0000-0000-0000-00000000cb01', 10, 'transferencia', 'x', null, '00000000-0000-0000-0000-00000000cb01')$q$, 'destino inválida');
do $$
declare s jsonb := public.saldos_contas(); p jsonb := public.painel_financeiro();
begin
  -- Banco X: 1000 + 300 - 200 - (pagamentos do teste do financeiro feitos sem conta não contam)
  assert (select (x->>'saldo')::numeric from jsonb_array_elements(s) x where x->>'nome' = 'Banco X') = 1100, 'saldo do banco';
  assert (select (x->>'saldo')::numeric from jsonb_array_elements(s) x where x->>'nome' = 'Caixa da loja') = 200, 'saldo do caixa';
  assert (p->>'dias_mes')::int >= 28, 'painel responde';
  assert (p->>'retiradas_mes') is not null, 'retiradas';
end $$;
reset role; select pg_temp.como('00000000-0000-0000-0000-00000000a002');
select pg_temp.espera_erro($q$select public.movimentar_conta('00000000-0000-0000-0000-00000000cb01', 1, 'ajuste', 'x')$q$, 'Somente gerente');
reset role;
select 'TESTES DO INVENTÁRIO, TRANSFERÊNCIAS E SALDOS PASSARAM' as ok;
