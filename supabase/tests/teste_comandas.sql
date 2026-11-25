-- Testes: mesas e comandas (restaurante)
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

select pg_temp.como('00000000-0000-0000-0000-00000000a001');
insert into public.produtos(id, descricao, preco_venda, cozinha) values
  ('00000000-0000-0000-0000-0000000c0a01', 'Prato feito', 25, true),
  ('00000000-0000-0000-0000-0000000c0a02', 'Refrigerante lata', 6, false);
select public.lancar_estoque('00000000-0000-0000-0000-0000000c0a01', 'entrada', 100);
select public.lancar_estoque('00000000-0000-0000-0000-0000000c0a02', 'entrada', 100);
insert into public.mesas(id, numero, lugares) values ('00000000-0000-0000-0000-0000000c0b01', 1, 4), ('00000000-0000-0000-0000-0000000c0b02', 2, 2);
create temp table cx(caixa uuid); grant all on cx to authenticated;
insert into cx select public.abrir_caixa(31::smallint, 0);

-- Operador (garçom) não cadastra mesa, mas abre comanda e lança
select pg_temp.como('00000000-0000-0000-0000-00000000a002');
select pg_temp.espera_erro($q$insert into public.mesas(numero) values (9)$q$, 'row-level security');
select pg_temp.espera_erro($q$insert into public.comandas(numero) values (1)$q$, 'permission denied');
create temp table cm(id uuid, n text); grant all on cm to authenticated;
insert into cm select public.abrir_comanda('00000000-0000-0000-0000-0000000c0b01', null, 3), 'mesa1';
select pg_temp.espera_erro($q$select public.abrir_comanda('00000000-0000-0000-0000-0000000c0b01')$q$, 'já tem comanda aberta');
select pg_temp.espera_erro($q$select public.abrir_comanda(null, '')$q$, 'identificação');
insert into cm select public.abrir_comanda(null, 'Balcão João'), 'balcao';
select public.lancar_itens_comanda((select id from cm where n = 'mesa1'), '[{"produto_id":"00000000-0000-0000-0000-0000000c0a01","quantidade":2,"observacao":"sem cebola"},{"produto_id":"00000000-0000-0000-0000-0000000c0a02","quantidade":3}]');
select public.lancar_itens_comanda((select id from cm where n = 'balcao'), '[{"produto_id":"00000000-0000-0000-0000-0000000c0a02","quantidade":1}]');
do $$ begin
  assert (select count(*) from public.comanda_itens where cozinha and status = 'pendente') = 1, 'um pedido para a cozinha';
  assert (select preco_unitario from public.comanda_itens where descricao = 'Prato feito') = 25, 'preço vigente';
  assert (select observacao from public.comanda_itens where descricao = 'Prato feito') = 'sem cebola', 'observação';
end $$;
-- Cozinha marca pronto; depois o garçom não cancela sozinho
select public.situacao_item_comanda((select id from public.comanda_itens where descricao = 'Prato feito'), 'pronto');
select pg_temp.espera_erro(format($q$select public.cancelar_item_comanda(%L, 'Desistiu')$q$, (select id from public.comanda_itens where descricao = 'Prato feito')), 'exige gerente');
-- Garçom desfaz o próprio lançamento ainda pendente (bebida)
select public.cancelar_item_comanda((select id from public.comanda_itens where comanda_id = (select id from cm where n = 'mesa1') and descricao = 'Refrigerante lata'), 'Lançado errado');
select public.lancar_itens_comanda((select id from cm where n = 'mesa1'), '[{"produto_id":"00000000-0000-0000-0000-0000000c0a02","quantidade":2}]');
-- Transferir para mesa ocupada não; juntar sim
select pg_temp.espera_erro(format($q$select public.transferir_comanda(%L, '00000000-0000-0000-0000-0000000c0b01')$q$, (select id from cm where n = 'balcao')), 'ocupada');
select public.transferir_comanda((select id from cm where n = 'balcao'), '00000000-0000-0000-0000-0000000c0b02');
select public.juntar_comandas((select id from cm where n = 'balcao'), (select id from cm where n = 'mesa1'));
do $$ begin
  assert (select status from public.comandas where id = (select id from cm where n = 'balcao')) = 'cancelada', 'origem encerrada';
  assert (select count(*) from public.comanda_itens where comanda_id = (select id from cm where n = 'mesa1') and status <> 'cancelado') = 3, 'itens juntados';
  assert (select pessoas from public.comandas where id = (select id from cm where n = 'mesa1')) = 4, 'pessoas somadas';
end $$;
-- Fechar: 2 x 25 + 2 x 6 + 1 x 6 = 68
select pg_temp.espera_erro(format($q$select public.fechar_comanda(%L, (select caixa from cx), '[{"forma":"dinheiro","valor":60}]')$q$, (select id from cm where n = 'mesa1')), 'Pagamento insuficiente');
create temp table vd(r jsonb); grant all on vd to authenticated;
insert into vd select public.fechar_comanda((select id from cm where n = 'mesa1'), (select caixa from cx), '[{"forma":"dinheiro","valor":70}]');
reset role;
do $$ begin
  assert (select (r->>'total')::numeric from vd) = 68, 'total da conta';
  assert (select (r->>'troco')::numeric from vd) = 2, 'troco';
  assert (select status from public.comandas where id = (select id from cm where n = 'mesa1')) = 'fechada', 'comanda fechada';
  assert (select venda_id from public.comandas where id = (select id from cm where n = 'mesa1')) = (select (r->>'venda_id')::uuid from vd), 'venda vinculada';
  assert (select estoque_atual from public.produtos where id = '00000000-0000-0000-0000-0000000c0a02') = 97, 'estoque baixado';
  assert (select count(*) from public.comandas where mesa_id = '00000000-0000-0000-0000-0000000c0b01' and status = 'aberta') = 0, 'mesa livre';
end $$;
select pg_temp.como('00000000-0000-0000-0000-00000000a002');
select pg_temp.espera_erro(format($q$select public.lancar_itens_comanda(%L, '[{"produto_id":"00000000-0000-0000-0000-0000000c0a02","quantidade":1}]')$q$, (select id from cm where n = 'mesa1')), 'não está aberta');
-- Cancelar comanda com itens exige gerente
insert into cm select public.abrir_comanda('00000000-0000-0000-0000-0000000c0b01'), 'nova';
select public.lancar_itens_comanda((select id from cm where n = 'nova'), '[{"produto_id":"00000000-0000-0000-0000-0000000c0a02","quantidade":1}]');
select pg_temp.espera_erro(format($q$select public.cancelar_comanda(%L, 'Cliente foi embora')$q$, (select id from cm where n = 'nova')), 'exige gerente');
select pg_temp.como('00000000-0000-0000-0000-00000000a001');
select public.cancelar_comanda((select id from cm where n = 'nova'), 'Cliente foi embora');
-- Outra empresa não vê
select pg_temp.como('00000000-0000-0000-0000-00000000b001');
do $$ begin assert (select count(*) from public.comandas) = 0 and (select count(*) from public.mesas) = 0, 'isolado'; end $$;
select pg_temp.espera_erro(format($q$select public.lancar_itens_comanda(%L, '[]')$q$, (select id from cm where n = 'nova')), 'não encontrada');
reset role;
