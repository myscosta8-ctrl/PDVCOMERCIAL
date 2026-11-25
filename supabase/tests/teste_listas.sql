-- Testes: listas de compras
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
insert into public.produtos(id, descricao, unidade, preco_venda, preco_custo, estoque_minimo) values
  ('00000000-0000-0000-0000-0000000d0a01', 'Arroz 5 kg', 'FD', 30, 22, 10),
  ('00000000-0000-0000-0000-0000000d0a02', 'Feijão 1 kg', 'UN', 9, 6, 5),
  ('00000000-0000-0000-0000-0000000d0a03', 'Açúcar 1 kg', 'UN', 5, 3.5, 0);
select public.lancar_estoque('00000000-0000-0000-0000-0000000d0a01', 'entrada', 4);    -- abaixo do mínimo (falta 6)
select public.lancar_estoque('00000000-0000-0000-0000-0000000d0a02', 'entrada', 100);  -- fica 40 depois das vendas, acima do mínimo
select public.lancar_estoque('00000000-0000-0000-0000-0000000d0a03', 'entrada', 540); -- fica 10 depois das vendas
reset role;
-- Vendas dos últimos 30 dias: feijão 60 (2/dia), açúcar 30 (1/dia)
insert into public.movimentos_estoque(empresa_id, produto_id, tipo, quantidade, usuario_id)
select p.empresa_id, p.id, 'saida_venda', -q, '00000000-0000-0000-0000-00000000a001'
  from (values ('00000000-0000-0000-0000-0000000d0a02'::uuid, 60), ('00000000-0000-0000-0000-0000000d0a03'::uuid, 30)) v(id, q)
  join public.produtos p on p.id = v.id;
-- Venda antiga não conta
insert into public.movimentos_estoque(empresa_id, produto_id, tipo, quantidade, usuario_id, criado_em)
select empresa_id, id, 'saida_venda', -500, '00000000-0000-0000-0000-00000000a001', now() - interval '60 days'
  from public.produtos where id = '00000000-0000-0000-0000-0000000d0a03';

select pg_temp.como('00000000-0000-0000-0000-00000000a001');
create temp table s(tipo text, r jsonb); grant all on s to authenticated;
insert into s select 'minimo', public.sugestao_compra(30, 0);
insert into s select 'consumo', public.sugestao_compra(30, 30);
select pg_temp.espera_erro($q$select public.sugestao_compra(0, 0)$q$, 'de 1 a 365');
reset role;
do $$ declare m jsonb; c jsonb;
begin
  select r into m from s where tipo = 'minimo';
  select r into c from s where tipo = 'consumo';
  -- Só pelo mínimo: arroz 6
  assert (select (e->>'sugerida')::numeric from jsonb_array_elements(m) e where e->>'produto_id' = '00000000-0000-0000-0000-0000000d0a01') = 6, 'arroz pelo mínimo';
  assert not exists (select 1 from jsonb_array_elements(m) e where e->>'produto_id' in ('00000000-0000-0000-0000-0000000d0a02', '00000000-0000-0000-0000-0000000d0a03')), 'sem feijão e açúcar pelo mínimo';
  -- Pelo consumo (30 dias): feijão 2/dia*30 - 40 = 20
  assert (select (e->>'sugerida')::numeric from jsonb_array_elements(c) e where e->>'produto_id' = '00000000-0000-0000-0000-0000000d0a02') = 20, 'feijão pelo consumo';
  -- Açúcar: a venda antiga baixa o estoque mas não entra na média; 1/dia*30 - 10 = 20
  assert (select (e->>'media_dia')::numeric from jsonb_array_elements(c) e where e->>'produto_id' = '00000000-0000-0000-0000-0000000d0a03') = 1, 'média do açúcar';
  assert (select (e->>'sugerida')::numeric from jsonb_array_elements(c) e where e->>'produto_id' = '00000000-0000-0000-0000-0000000d0a03') = 20, 'açúcar pelo consumo';
  assert (select e->>'motivo' from jsonb_array_elements(c) e where e->>'produto_id' = '00000000-0000-0000-0000-0000000d0a03') = 'consumo', 'motivo consumo';
  assert (select e->>'motivo' from jsonb_array_elements(c) e where e->>'produto_id' = '00000000-0000-0000-0000-0000000d0a01') = 'minimo', 'motivo mínimo';
  assert (select (e->>'custo')::numeric from jsonb_array_elements(c) e where e->>'produto_id' = '00000000-0000-0000-0000-0000000d0a01') = 22, 'custo do cadastro';
end $$;

-- Lista: itens do estoque e avulsos
select pg_temp.como('00000000-0000-0000-0000-00000000a002');
create temp table l(id uuid, n text); grant all on l to authenticated;
select pg_temp.espera_erro($q$insert into public.listas_compra(nome) values ('  ')$q$, 'Dê um nome');
with x as (insert into public.listas_compra(nome, status) values ('Compras da semana', 'concluida') returning id) insert into l select id, 'a' from x;
with x as (insert into public.listas_compra(nome) values ('Outra') returning id) insert into l select id, 'b' from x;
insert into public.lista_compra_itens(lista_id, produto_id, descricao, unidade, quantidade, custo_estimado, origem)
values ((select id from l where n = 'a'), '00000000-0000-0000-0000-0000000d0a01', 'Arroz 5 kg', 'FD', 6, 22, 'estoque');
insert into public.lista_compra_itens(lista_id, descricao, unidade, quantidade) values ((select id from l where n = 'a'), '  Sacolas plásticas ', 'pct', 3);
-- Gerar de novo pelo estoque atualiza a quantidade em vez de duplicar
insert into public.lista_compra_itens(lista_id, produto_id, descricao, unidade, quantidade, origem)
values ((select id from l where n = 'a'), '00000000-0000-0000-0000-0000000d0a01', 'Arroz 5 kg', 'FD', 8, 'estoque')
on conflict (lista_id, produto_id) do update set quantidade = excluded.quantidade;
select pg_temp.espera_erro(format($q$insert into public.lista_compra_itens(lista_id, descricao, quantidade) values (%L, '', 1)$q$, (select id from l where n = 'a')), 'Descreva o item');
select pg_temp.espera_erro(format($q$insert into public.lista_compra_itens(lista_id, descricao, quantidade) values (%L, 'X', 0)$q$, (select id from l where n = 'a')), 'lista_compra_itens_quantidade_check');
update public.lista_compra_itens set comprado = true where descricao = 'Sacolas plásticas';
update public.listas_compra set status = 'enviada', numero = 999 where id = (select id from l where n = 'a');
update public.listas_compra set status = 'concluida' where id = (select id from l where n = 'a');
select pg_temp.espera_erro(format($q$update public.lista_compra_itens set quantidade = 1 where lista_id = %L$q$, (select id from l where n = 'a')), 'não mudam mais');
select pg_temp.espera_erro(format($q$update public.listas_compra set nome = 'x' where id = %L$q$, (select id from l where n = 'a')), 'já está concluida');
select pg_temp.espera_erro(format($q$delete from public.listas_compra where id = %L$q$, (select id from l where n = 'b')), 'permission denied');
-- Item avulso pode ser apagado da lista aberta
delete from public.lista_compra_itens where lista_id = (select id from l where n = 'b');
reset role;
do $$ begin
  assert (select status from public.listas_compra where id = (select id from l where n = 'a')) = 'concluida', 'nasce aberta e conclui';
  assert (select numero from public.listas_compra where id = (select id from l where n = 'b')) = (select numero from public.listas_compra where id = (select id from l where n = 'a')) + 1, 'numeração';
  assert (select count(*) from public.lista_compra_itens where lista_id = (select id from l where n = 'a')) = 2, 'sem duplicar';
  assert (select quantidade from public.lista_compra_itens where produto_id = '00000000-0000-0000-0000-0000000d0a01') = 8, 'quantidade atualizada';
  assert (select descricao || '/' || unidade from public.lista_compra_itens where produto_id is null) = 'Sacolas plásticas/PCT', 'avulso limpo';
end $$;
-- Outra empresa não vê
select pg_temp.como('00000000-0000-0000-0000-00000000b001');
do $$ begin
  assert (select count(*) from public.listas_compra) = 0, 'isolamento das listas';
  assert jsonb_array_length(public.sugestao_compra(30, 15)) = 0, 'isolamento da sugestão';
end $$;
