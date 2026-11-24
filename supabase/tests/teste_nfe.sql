-- Testes: NF-e modelo 55 (rascunho, nota única por venda, estoque da NF-e avulsa)
\set ON_ERROR_STOP 1
set client_min_messages = warning;
create or replace function pg_temp.como(u text) returns void language plpgsql as $$
begin reset role; perform set_config('request.jwt.claim.sub', u, false); execute 'set role authenticated'; end $$;
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
insert into public.produtos(id, descricao, ean, ncm, preco_venda, controla_lote) values ('00000000-0000-0000-0000-00000000fe01', 'Produto NF-e', '7896000000f01', '30049099', 10, true);
select public.lancar_estoque('00000000-0000-0000-0000-00000000fe01', 'entrada', 3, null, 5, null, 'L1', current_date + 30);
select public.lancar_estoque('00000000-0000-0000-0000-00000000fe01', 'entrada', 5, null, 5, null, 'L2', current_date + 90);
create temp table vs(k int, id uuid); grant all on vs to authenticated;
insert into vs select k, (public.finalizar_venda((select id from public.caixas where empresa_id = '00000000-0000-0000-0000-0000000000a1' and status = 'aberto' limit 1),
  '[{"produto_id":"00000000-0000-0000-0000-00000000fe01","quantidade":1}]', '[{"forma":"dinheiro","valor":10}]')->>'venda_id')::uuid from generate_series(1, 2) k;

-- Rascunho avulso com saída de estoque
insert into public.nfe_documentos(id, natureza, finalidade, itens, mover_estoque)
values ('00000000-0000-0000-0000-00000000fd01', 'Devolução de compra', 4, '[{"produto_id":"00000000-0000-0000-0000-00000000fe01","quantidade":4}]', true);
-- Não cria já autorizada
select pg_temp.espera_erro($q$insert into public.nfe_documentos(natureza, status) values ('x', 'autorizada')$q$, 'row-level security');

-- Venda 1 com NFC-e autorizada: NF-e recusada
reset role;
insert into public.nfce_documentos(empresa_id, venda_id, ambiente, serie, numero, status) values ('00000000-0000-0000-0000-0000000000a1', (select id from vs where k = 1), 2, 1, 900, 'autorizada');
select pg_temp.como('00000000-0000-0000-0000-00000000a001');
select pg_temp.espera_erro($q$insert into public.nfe_documentos(venda_id, natureza) values ((select id from vs where k = 1), 'Venda')$q$, 'já tem NFC-e');

-- Venda 2 com NF-e autorizada: NFC-e recusada e cancelamento da venda bloqueado
insert into public.nfe_documentos(id, venda_id, natureza) values ('00000000-0000-0000-0000-00000000fd02', (select id from vs where k = 2), 'Venda');
reset role;
update public.nfe_documentos set status = 'autorizada', numero = 1, ambiente = 2, serie = 1 where id = '00000000-0000-0000-0000-00000000fd02';
select pg_temp.espera_erro($q$insert into public.nfce_documentos(empresa_id, venda_id, ambiente, serie, numero, status) values ('00000000-0000-0000-0000-0000000000a1', (select id from vs where k = 2), 2, 1, 901, 'pendente')$q$, 'já tem NF-e');
select pg_temp.como('00000000-0000-0000-0000-00000000a001');
select pg_temp.espera_erro($q$select public.cancelar_venda((select id from vs where k = 2), 'Cliente desistiu da compra')$q$, 'Cancele primeiro a NF-e');
-- Autorizada não é alterada pelo usuário
update public.nfe_documentos set natureza = 'mexeu' where id = '00000000-0000-0000-0000-00000000fd02';
do $$ begin assert (select natureza from public.nfe_documentos where id = '00000000-0000-0000-0000-00000000fd02') = 'Venda', 'autorizada não muda'; end $$;

-- Estoque: rascunho não move; autorizada tira 4 (3 do lote L1 que vence antes, 1 do L2)
select pg_temp.espera_erro($q$select public.movimentar_estoque_nfe('00000000-0000-0000-0000-00000000fd01')$q$, 'autorizada');
reset role;
update public.nfe_documentos set status = 'autorizada', numero = 2, ambiente = 2, serie = 1 where id = '00000000-0000-0000-0000-00000000fd01';
select pg_temp.como('00000000-0000-0000-0000-00000000a001');
do $$
declare antes numeric := (select estoque_atual from public.produtos where id = '00000000-0000-0000-0000-00000000fe01');
begin
  assert public.movimentar_estoque_nfe('00000000-0000-0000-0000-00000000fd01') = 2, 'dois movimentos (dois lotes)';
  assert public.movimentar_estoque_nfe('00000000-0000-0000-0000-00000000fd01') = 0, 'não repete';
  assert (select estoque_atual from public.produtos where id = '00000000-0000-0000-0000-00000000fe01') = antes - 4, 'saiu 4';
  assert (select quantidade from public.lotes where numero = 'L1' and produto_id = '00000000-0000-0000-0000-00000000fe01') = 0, 'L1 zerado';
  assert public.movimentar_estoque_nfe('00000000-0000-0000-0000-00000000fd01', true) = 2, 'estorno';
  assert (select estoque_atual from public.produtos where id = '00000000-0000-0000-0000-00000000fe01') = antes, 'voltou';
end $$;

select pg_temp.como('00000000-0000-0000-0000-00000000a002');
do $$ begin assert (select count(*) from public.nfe_documentos) = 0, 'operador não vê NF-e'; end $$;
reset role;
select 'nfe ok';
