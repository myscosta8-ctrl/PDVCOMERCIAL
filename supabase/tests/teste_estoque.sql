-- Testes do Grupo A: entrada por NF-e, lote/validade (FEFO), kits e devolução/cancelamento de kits.
-- Rodar depois de teste_base.sql e teste_vendas.sql.
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

select pg_temp.como('00000000-0000-0000-0000-00000000a001');

-- 1) Entrada pela NF-e: produto existente (por vínculo) + produto novo, com lote e validade
insert into public.produtos(id, descricao, ean, preco_venda) values ('00000000-0000-0000-0000-0000000000e1', 'Amoxicilina 500 mg', '7890000000011', 25);
create temp table nota(r jsonb); grant all on nota to authenticated;
insert into nota select public.registrar_entrada_nfe(jsonb_build_object(
  'chave', '15261112345678000195550010000012341000012345', 'numero', 1234, 'serie', 1, 'emissao', '2026-11-20T10:00:00-03:00',
  'valor_produtos', 300, 'valor_total', 300,
  'fornecedor', jsonb_build_object('cnpj', '11222333000144', 'razao_social', 'Distribuidora Teste Ltda', 'uf', 'PA'),
  'itens', jsonb_build_array(
    jsonb_build_object('produto_id', '00000000-0000-0000-0000-0000000000e1', 'codigo_fornecedor', 'AMX500', 'descricao', 'AMOXICILINA 500MG CX', 'fator', 12,
                       'quantidade', 24, 'custo_unitario', 8.5, 'lote', 'L-VELHO', 'validade', (current_date + 10)::text, 'novo_preco_venda', 26.9),
    jsonb_build_object('novo_produto', jsonb_build_object('descricao', 'Gaze estéril 7,5 cm', 'ean', '7890000000028', 'ncm', '30059090', 'unidade', 'PCT', 'preco_venda', 4.5),
                       'codigo_fornecedor', 'GAZ75', 'descricao', 'GAZE ESTERIL', 'fator', 1, 'quantidade', 50, 'custo_unitario', 1.8))));
do $$ begin
  assert pg_temp.estoque('00000000-0000-0000-0000-0000000000e1') = 24, 'entrada existente';
  assert (select preco_custo from public.produtos where id = '00000000-0000-0000-0000-0000000000e1') = 8.5, 'custo atualizado';
  assert (select preco_venda from public.produtos where id = '00000000-0000-0000-0000-0000000000e1') = 26.9, 'preço atualizado';
  assert (select controla_lote from public.produtos where id = '00000000-0000-0000-0000-0000000000e1'), 'passou a controlar lote';
  assert (select estoque_atual from public.produtos where ean = '7890000000028') = 50, 'produto novo com estoque';
  assert (select fator from public.produto_fornecedor where codigo_fornecedor = 'AMX500') = 12, 'vínculo com fator';
  assert ((select r from nota)->>'produtos_novos')::int = 1, 'um novo';
end $$;
-- Nota repetida
select pg_temp.espera_erro($q$select public.registrar_entrada_nfe(jsonb_build_object('chave','15261112345678000195550010000012341000012345','numero',1234,
  'fornecedor', jsonb_build_object('cnpj','11222333000144','razao_social','X'), 'itens', jsonb_build_array(jsonb_build_object('produto_id','00000000-0000-0000-0000-0000000000e1','descricao','x','quantidade',1,'custo_unitario',1))))$q$, 'já foi lançada');

-- 2) Segundo lote (vence depois) por lançamento manual; um lote vencido
select public.lancar_estoque('00000000-0000-0000-0000-0000000000e1', 'entrada', 10, null, 9, 'manual', 'L-NOVO', current_date + 200);
select public.lancar_estoque('00000000-0000-0000-0000-0000000000e1', 'entrada', 5, null, 9, 'manual', 'L-VENCIDO', current_date - 1);
do $$ begin
  assert public.lote_fefo('00000000-0000-0000-0000-0000000000e1') = (select id from public.lotes where numero = 'L-VELHO'), 'FEFO escolhe o que vence primeiro e ignora vencido';
end $$;
create temp table ctx2(caixa uuid); grant all on ctx2 to authenticated;
insert into ctx2 select public.abrir_caixa(7::smallint, 0);
reset role;

-- 3) Operador vende sem escolher lote: sai do L-VELHO; lote vencido escolhido manualmente é bloqueado
select pg_temp.como('00000000-0000-0000-0000-00000000a002');
select public.finalizar_venda((select caixa from ctx2), '[{"produto_id":"00000000-0000-0000-0000-0000000000e1","quantidade":2}]', '[{"forma":"pix","valor":53.8}]');
do $$ begin
  assert (select quantidade from public.lotes where numero = 'L-VELHO') = 22, 'baixou do lote FEFO';
end $$;
select pg_temp.espera_erro(format($q$select public.finalizar_venda(%L, %L, '[{"forma":"pix","valor":26.9}]')$q$,
  (select caixa from ctx2), jsonb_build_array(jsonb_build_object('produto_id','00000000-0000-0000-0000-0000000000e1','quantidade',1,'lote_id',(select id from public.lotes where numero='L-VENCIDO')))), 'Lote vencido');
-- Operador não registra nota de entrada
select pg_temp.espera_erro($q$select public.registrar_entrada_nfe('{"chave":"15261112345678000195550010000012351000012345","itens":[{}]}')$q$, 'exige gerente');
reset role;

-- 4) Kit: 1 kit = 2 gazes + 1 amoxicilina
select pg_temp.como('00000000-0000-0000-0000-00000000a001');
insert into public.produtos(id, descricao, preco_venda, e_kit) values ('00000000-0000-0000-0000-0000000000e9', 'Kit curativo', 30, true);
insert into public.kit_itens(kit_id, produto_id, quantidade) values
  ('00000000-0000-0000-0000-0000000000e9', (select id from public.produtos where ean = '7890000000028'), 2),
  ('00000000-0000-0000-0000-0000000000e9', '00000000-0000-0000-0000-0000000000e1', 1);
select pg_temp.espera_erro($q$select public.lancar_estoque('00000000-0000-0000-0000-0000000000e9','entrada',5)$q$, 'Kit não tem estoque');
create temp table vk(r jsonb); grant all on vk to authenticated;
do $$ declare g0 numeric := (select estoque_atual from public.produtos where ean = '7890000000028');
                 a0 numeric := pg_temp.estoque('00000000-0000-0000-0000-0000000000e1'); begin
  insert into vk select public.finalizar_venda((select caixa from ctx2), '[{"produto_id":"00000000-0000-0000-0000-0000000000e9","quantidade":3}]', '[{"forma":"dinheiro","valor":90}]');
  assert (select estoque_atual from public.produtos where ean = '7890000000028') = g0 - 6, 'gazes baixadas';
  assert pg_temp.estoque('00000000-0000-0000-0000-0000000000e1') = a0 - 3, 'amoxicilina baixada';
  assert pg_temp.estoque('00000000-0000-0000-0000-0000000000e9') = 0, 'kit sem estoque próprio';
  -- devolução de 1 kit devolve 2 gazes + 1 amoxicilina
  perform public.devolver_itens((select (r->>'venda_id')::uuid from vk),
    jsonb_build_array(jsonb_build_object('venda_item_id', (select id from public.venda_itens where venda_id = (select (r->>'venda_id')::uuid from vk)), 'quantidade', 1)),
    'dinheiro', 'Cliente devolveu um kit', (select caixa from ctx2));
  assert (select estoque_atual from public.produtos where ean = '7890000000028') = g0 - 4, 'gazes devolvidas';
  assert pg_temp.estoque('00000000-0000-0000-0000-0000000000e1') = a0 - 2, 'amoxicilina devolvida';
  assert public.estoque_kit('00000000-0000-0000-0000-0000000000e9') = least(floor((g0 - 4) / 2), a0 - 2), 'kits possíveis';
end $$;

-- 5) Cancelamento devolve exatamente o que saiu (venda de kit nova)
do $$ declare g0 numeric := (select estoque_atual from public.produtos where ean = '7890000000028'); v jsonb; begin
  v := public.finalizar_venda((select caixa from ctx2), '[{"produto_id":"00000000-0000-0000-0000-0000000000e9","quantidade":1}]', '[{"forma":"pix","valor":30}]');
  perform public.cancelar_venda((v->>'venda_id')::uuid, 'Cancelamento de teste do kit');
  assert (select estoque_atual from public.produtos where ean = '7890000000028') = g0, 'cancelamento estornou componentes';
end $$;
reset role;

-- 6) Isolamento
select pg_temp.como('00000000-0000-0000-0000-00000000b001');
do $$ begin
  assert (select count(*) from public.notas_entrada) = 0 and (select count(*) from public.fornecedores) = 0 and (select count(*) from public.kit_itens) = 0, 'isolamento';
end $$;
reset role;
\echo 'TESTES DE ESTOQUE PASSARAM'
