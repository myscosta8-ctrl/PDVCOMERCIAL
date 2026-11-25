-- Testes: PIX dinâmico (cobrança paga amarrada à venda) e dados do cartão da maquininha
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
insert into public.produtos(id, descricao, preco_venda) values ('00000000-0000-0000-0000-0000000001f2', 'Produto PIX', 20);
select public.lancar_estoque('00000000-0000-0000-0000-0000000001f2', 'entrada', 50);
create temp table ctx(caixa uuid); grant all on ctx to authenticated;
insert into ctx select public.abrir_caixa(23::smallint, 0);
-- O navegador não cria nem altera cobranças
select pg_temp.espera_erro($q$insert into public.pix_cobrancas(empresa_id, txid, valor, status) values (public.auth_empresa_id(), 'X1', 20, 'concluida')$q$, 'permission denied');
reset role;
-- Cobranças criadas pelo servidor
insert into public.pix_cobrancas(empresa_id, txid, valor, status) values
  ((select empresa_id from public.usuarios where id = '00000000-0000-0000-0000-00000000a001'), 'PAGA0000000000000000000001', 20, 'concluida'),
  ((select empresa_id from public.usuarios where id = '00000000-0000-0000-0000-00000000a001'), 'ATIVA000000000000000000001', 20, 'ativa'),
  ((select empresa_id from public.usuarios where id = '00000000-0000-0000-0000-00000000b001'), 'OUTRA000000000000000000001', 20, 'concluida');

select pg_temp.como('00000000-0000-0000-0000-00000000a002');
-- Cobrança não paga, de outra empresa ou com outro valor: recusa
select pg_temp.espera_erro($q$select public.finalizar_venda((select caixa from ctx), '[{"produto_id":"00000000-0000-0000-0000-0000000001f2","quantidade":1}]', '[{"forma":"pix","valor":20,"pix_txid":"ATIVA000000000000000000001"}]')$q$, 'não está paga');
select pg_temp.espera_erro($q$select public.finalizar_venda((select caixa from ctx), '[{"produto_id":"00000000-0000-0000-0000-0000000001f2","quantidade":1}]', '[{"forma":"pix","valor":20,"pix_txid":"OUTRA000000000000000000001"}]')$q$, 'não está paga');
select pg_temp.espera_erro($q$select public.finalizar_venda((select caixa from ctx), '[{"produto_id":"00000000-0000-0000-0000-0000000001f2","quantidade":2}]', '[{"forma":"pix","valor":40,"pix_txid":"PAGA0000000000000000000001"}]')$q$, 'outro valor');
select pg_temp.espera_erro($q$select public.finalizar_venda((select caixa from ctx), '[{"produto_id":"00000000-0000-0000-0000-0000000001f2","quantidade":1}]', '[{"forma":"debito","valor":20,"pix_txid":"PAGA0000000000000000000001"}]')$q$, 'outra forma');
-- Paga: amarra à venda; segunda vez recusa
create temp table vd(r jsonb); grant all on vd to authenticated;
insert into vd select public.finalizar_venda((select caixa from ctx), '[{"produto_id":"00000000-0000-0000-0000-0000000001f2","quantidade":1}]', '[{"forma":"pix","valor":20,"pix_txid":"PAGA0000000000000000000001"}]');
select pg_temp.espera_erro($q$select public.finalizar_venda((select caixa from ctx), '[{"produto_id":"00000000-0000-0000-0000-0000000001f2","quantidade":1}]', '[{"forma":"pix","valor":20,"pix_txid":"PAGA0000000000000000000001"}]')$q$, 'já foi usada');
-- Cartão: bandeira inválida recusa; dados válidos gravados
select pg_temp.espera_erro($q$select public.finalizar_venda((select caixa from ctx), '[{"produto_id":"00000000-0000-0000-0000-0000000001f2","quantidade":1}]', '[{"forma":"credito","valor":20,"bandeira":"55"}]')$q$, 'Bandeira');
insert into vd select public.finalizar_venda((select caixa from ctx), '[{"produto_id":"00000000-0000-0000-0000-0000000001f2","quantidade":1}]',
  '[{"forma":"credito","valor":20,"bandeira":"02","autorizacao":"A1B2C3","nsu":"000123","credenciadora_cnpj":"01.027.058/0001-91"}]');
reset role;
do $$ begin
  assert (select venda_id from public.pix_cobrancas where txid = 'PAGA0000000000000000000001') = (select (r->>'venda_id')::uuid from vd limit 1), 'cobrança amarrada';
  assert (select pix_txid from public.venda_pagamentos where forma = 'pix' and pix_txid is not null) = 'PAGA0000000000000000000001', 'txid no pagamento';
  assert (select bandeira || '|' || autorizacao || '|' || nsu || '|' || credenciadora_cnpj from public.venda_pagamentos where forma = 'credito' and bandeira is not null) = '02|A1B2C3|000123|01027058000191', 'dados do cartão';
end $$;
-- Credenciais: operador não salva; servidor lê
select pg_temp.como('00000000-0000-0000-0000-00000000a002');
select pg_temp.espera_erro($q$select public.salvar_credenciais_pix('id', 'segredo')$q$, 'Somente o administrador');
select pg_temp.espera_erro($q$select public.ler_credenciais_pix(public.auth_empresa_id())$q$, 'permission denied');
reset role;
