-- Testes: travas de cancelamento da venda com NFC-e e números para inutilizar.
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

-- Três vendas da empresa A
select pg_temp.como('00000000-0000-0000-0000-00000000a001');
insert into public.produtos(id, descricao, ean, ncm, preco_venda) values ('00000000-0000-0000-0000-0000000e0e01', 'Produto evento', '7896000000e01', '30049099', 10);
select public.lancar_estoque('00000000-0000-0000-0000-0000000e0e01', 'entrada', 10, null, 5);
create temp table vs(k int, id uuid); grant all on vs to authenticated;
insert into vs select k, (public.finalizar_venda((select id from public.caixas where empresa_id = '00000000-0000-0000-0000-0000000000a1' and status = 'aberto' limit 1),
  '[{"produto_id":"00000000-0000-0000-0000-0000000e0e01","quantidade":1}]', '[{"forma":"dinheiro","valor":10}]')->>'venda_id')::uuid from generate_series(1, 4) k;

reset role;
-- Numeração da série: notas 1 a 9; 1 autorizada, 2 contingência, 3 rejeitada (venda 3), 5 cancelada, 8 inutilizada; 4, 6, 7, 9 sem nota
insert into public.numeracao(empresa_id, tipo, serie, ultimo) values ('00000000-0000-0000-0000-0000000000a1', 'nfce_2', 1, 9)
  on conflict (empresa_id, tipo, serie) do update set ultimo = 9;
insert into public.nfce_documentos(empresa_id, venda_id, ambiente, serie, numero, status) values
  ('00000000-0000-0000-0000-0000000000a1', (select id from vs where k = 1), 2, 1, 1, 'autorizada'),
  ('00000000-0000-0000-0000-0000000000a1', (select id from vs where k = 2), 2, 1, 2, 'contingencia'),
  ('00000000-0000-0000-0000-0000000000a1', (select id from vs where k = 3), 2, 1, 3, 'rejeitada'),
  ('00000000-0000-0000-0000-0000000000a1', (select id from vs where k = 4), 2, 1, 5, 'cancelada');
insert into public.nfce_inutilizacoes(empresa_id, ambiente, serie, inicio, fim, justificativa) values ('00000000-0000-0000-0000-0000000000a1', 2, 1, 8, 8, 'Numeração pulada pelo sistema');

select pg_temp.como('00000000-0000-0000-0000-00000000a001');
select pg_temp.espera_erro($q$select public.cancelar_venda((select id from vs where k = 1), 'Cliente desistiu da compra')$q$, 'Cancele primeiro a NFC-e');
select pg_temp.espera_erro($q$select public.cancelar_venda((select id from vs where k = 2), 'Cliente desistiu da compra')$q$, 'contingência');
-- Rejeitada não trava: a venda pode ser cancelada (o número depois é inutilizado)
select public.cancelar_venda((select id from vs where k = 4), 'Cliente desistiu da compra');

do $$
declare r jsonb := public.numeros_nfce_sem_nota(); f jsonb := r->'faixas';
begin
  assert (r->>'ultimo')::int = 9, 'último número';
  assert f @> '[{"inicio":3,"fim":3,"situacao":"rejeitada","pode_reenviar":true}]', 'rejeitada da venda 3 pode ser reenviada';
  assert f @> '[{"inicio":4,"fim":4,"situacao":"sem_nota"}]', 'número 4';
  assert f @> '[{"inicio":6,"fim":7,"situacao":"sem_nota","qtd":2}]', 'faixa 6 a 7';
  assert f @> '[{"inicio":9,"fim":9,"situacao":"sem_nota"}]', 'número 9';
  assert not f @> '[{"inicio":8}]', 'inutilizado fica fora';
  assert jsonb_array_length(f) = 4, 'quatro faixas';
end $$;

select pg_temp.como('00000000-0000-0000-0000-00000000a002');
select pg_temp.espera_erro($q$select public.numeros_nfce_sem_nota()$q$, 'Somente gerente');
reset role;
select 'nfce eventos ok';
