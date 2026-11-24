-- Testes do Grupo B: tabelas de preço, promoções e grade.
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

select pg_temp.como('00000000-0000-0000-0000-00000000a001');
insert into public.categorias(id, nome) values ('00000000-0000-0000-0000-0000000000a9', 'Higiene');
insert into public.produtos(id, descricao, preco_venda, categoria_id) values
  ('00000000-0000-0000-0000-0000000001b1', 'Sabonete', 4.00, '00000000-0000-0000-0000-0000000000a9'),
  ('00000000-0000-0000-0000-0000000001b2', 'Shampoo', 20.00, null);
select public.lancar_estoque('00000000-0000-0000-0000-0000000001b1', 'entrada', 100);
select public.lancar_estoque('00000000-0000-0000-0000-0000000001b2', 'entrada', 100);

-- Promoções: 10% na categoria Higiene; shampoo a 17,90; atacado: a partir de 12 sabonetes por 3,20
insert into public.promocoes(id, nome, tipo, inicio, fim, percentual, categoria_id) values
  ('00000000-0000-0000-0000-0000000001c1', 'Semana da higiene', 'percentual', current_date - 1, current_date + 5, 10, '00000000-0000-0000-0000-0000000000a9');
insert into public.promocoes(id, nome, tipo, inicio, fim) values
  ('00000000-0000-0000-0000-0000000001c2', 'Shampoo em oferta', 'preco', current_date, current_date),
  ('00000000-0000-0000-0000-0000000001c3', 'Atacado sabonete', 'quantidade', current_date, current_date + 30),
  ('00000000-0000-0000-0000-0000000001c4', 'Promoção vencida', 'preco', current_date - 10, current_date - 1);
insert into public.promocao_itens(promocao_id, produto_id, preco, quantidade_minima) values
  ('00000000-0000-0000-0000-0000000001c2', '00000000-0000-0000-0000-0000000001b2', 17.90, 1),
  ('00000000-0000-0000-0000-0000000001c3', '00000000-0000-0000-0000-0000000001b1', 3.20, 12),
  ('00000000-0000-0000-0000-0000000001c4', '00000000-0000-0000-0000-0000000001b2', 1.00, 1);
-- Tabela atacado: -15% geral
insert into public.tabelas_preco(id, nome, ajuste_percentual) values ('00000000-0000-0000-0000-0000000001d1', 'Atacado', -15);
do $$ begin
  assert (public.preco_vigente('00000000-0000-0000-0000-0000000001b1', 1)->>'preco')::numeric = 3.60, 'categoria 10%';
  assert (public.preco_vigente('00000000-0000-0000-0000-0000000001b1', 12)->>'preco')::numeric = 3.20, 'quantidade mínima';
  assert (public.preco_vigente('00000000-0000-0000-0000-0000000001b2', 1)->>'preco')::numeric = 17.90, 'preço promocional (vencida ignorada)';
  assert (public.preco_vigente('00000000-0000-0000-0000-0000000001b2', 1, '00000000-0000-0000-0000-0000000001d1')->>'preco')::numeric = 17.00, 'tabela -15% vence promoção';
  assert public.preco_vigente('00000000-0000-0000-0000-0000000001b2', 1, '00000000-0000-0000-0000-0000000001d1')->>'origem' = 'tabela', 'origem tabela';
end $$;
create temp table ctx3(caixa uuid); grant all on ctx3 to authenticated;
insert into ctx3 select public.abrir_caixa(9::smallint, 0);
reset role;

-- Operador vende pelo preço vigente; preço diferente é recusado
select pg_temp.como('00000000-0000-0000-0000-00000000a002');
create temp table vp(r jsonb); grant all on vp to authenticated;
insert into vp select public.finalizar_venda((select caixa from ctx3),
  '[{"produto_id":"00000000-0000-0000-0000-0000000001b1","quantidade":12,"preco_unitario":3.20},{"produto_id":"00000000-0000-0000-0000-0000000001b2","quantidade":1}]',
  '[{"forma":"pix","valor":56.30}]');
do $$ begin
  assert ((select r from vp)->>'total')::numeric = 56.30, 'total com promoções: ' || (select r from vp);
  assert (select preco_origem from public.venda_itens where venda_id = (select (r->>'venda_id')::uuid from vp) and sequencia = 1) = 'promocao', 'origem gravada';
end $$;
select pg_temp.espera_erro(format($q$select public.finalizar_venda(%L, '[{"produto_id":"00000000-0000-0000-0000-0000000001b2","quantidade":1,"preco_unitario":20}]', '[{"forma":"pix","valor":20}]')$q$,
  (select caixa from ctx3)), 'exige gerente');
-- Tabela do cliente aplicada automaticamente
insert into public.clientes(id, nome) values ('00000000-0000-0000-0000-0000000001e1', 'Revendedor');
reset role;
select set_config('request.jwt.claim.sub', '', false);
update public.clientes set tabela_preco_id = '00000000-0000-0000-0000-0000000001d1' where id = '00000000-0000-0000-0000-0000000001e1';
select pg_temp.como('00000000-0000-0000-0000-00000000a002');
do $$ declare r jsonb; begin
  r := public.finalizar_venda((select caixa from ctx3), '[{"produto_id":"00000000-0000-0000-0000-0000000001b2","quantidade":2}]', '[{"forma":"pix","valor":34}]', 0, '00000000-0000-0000-0000-0000000001e1');
  assert (r->>'total')::numeric = 34, 'tabela do cliente';
end $$;
-- Operador não cria promoção
select pg_temp.espera_erro($q$insert into public.promocoes(nome, tipo, inicio, fim) values ('x','preco',current_date,current_date)$q$, 'row-level security');
reset role;

-- Grade
select pg_temp.como('00000000-0000-0000-0000-00000000a001');
insert into public.produtos(id, descricao, preco_venda, preco_custo) values ('00000000-0000-0000-0000-0000000001f1', 'Camiseta básica', 49.90, 20);
do $$ begin
  assert public.gerar_grade('00000000-0000-0000-0000-0000000001f1', array['P','M','G'], array['Azul','Preta']) = 6, 'seis variações';
  assert public.gerar_grade('00000000-0000-0000-0000-0000000001f1', array['P','M','G','GG'], array['Azul','Preta']) = 2, 'só as que faltam';
  assert (select count(*) from public.produtos where produto_pai_id = '00000000-0000-0000-0000-0000000001f1') = 8, 'total variações';
  assert exists (select 1 from public.produtos where descricao = 'Camiseta básica Azul M' and atributos = '{"cor":"Azul","tamanho":"M"}'), 'descrição e atributos';
end $$;
select pg_temp.espera_erro($q$select public.lancar_estoque('00000000-0000-0000-0000-0000000001f1','entrada',5)$q$, 'não tem estoque próprio');
select public.lancar_estoque((select id from public.produtos where descricao = 'Camiseta básica Azul M'), 'entrada', 5);
select pg_temp.espera_erro(format($q$select public.finalizar_venda(%L, '[{"produto_id":"00000000-0000-0000-0000-0000000001f1","quantidade":1}]', '[{"forma":"pix","valor":49.9}]')$q$,
  (select caixa from ctx3)), 'tamanho e a cor');
do $$ declare r jsonb; begin
  r := public.finalizar_venda((select caixa from ctx3), jsonb_build_array(jsonb_build_object('produto_id', (select id from public.produtos where descricao = 'Camiseta básica Azul M'), 'quantidade', 1)), '[{"forma":"pix","valor":49.9}]');
  assert (select estoque_atual from public.produtos where descricao = 'Camiseta básica Azul M') = 4, 'variação vendida';
end $$;
reset role;

select pg_temp.como('00000000-0000-0000-0000-00000000b001');
do $$ begin
  assert (select count(*) from public.promocoes) = 0 and (select count(*) from public.tabelas_preco) = 0, 'isolamento';
end $$;
reset role;
\echo 'TESTES DE PREÇOS E GRADE PASSARAM'
