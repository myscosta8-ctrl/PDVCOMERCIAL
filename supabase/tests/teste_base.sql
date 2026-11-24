-- Testes de regras de negócio e isolamento entre empresas.
\set ON_ERROR_STOP 1
set client_min_messages = warning;

-- Duas empresas, três usuários
insert into public.empresas(id, razao_social, segmento) values
  ('00000000-0000-0000-0000-0000000000a1', 'Empresa A', 'farmacia'),
  ('00000000-0000-0000-0000-0000000000b1', 'Empresa B', 'mercado');
insert into public.usuarios(id, empresa_id, nome, email, papel) values
  ('00000000-0000-0000-0000-00000000a001', '00000000-0000-0000-0000-0000000000a1', 'Adm A', 'a@a', 'administrador'),
  ('00000000-0000-0000-0000-00000000a002', '00000000-0000-0000-0000-0000000000a1', 'Op A',  'o@a', 'operador'),
  ('00000000-0000-0000-0000-00000000b001', '00000000-0000-0000-0000-0000000000b1', 'Adm B', 'b@b', 'administrador');

create or replace function pg_temp.como(u text) returns void language plpgsql as $$
begin
  perform set_config('request.jwt.claim.sub', u, false);
  execute 'set role authenticated';
end $$;

create or replace function pg_temp.espera_erro(sql text, trecho text) returns void language plpgsql as $$
begin
  begin
    execute sql;
  exception when others then
    if position(trecho in sqlerrm) = 0 then
      raise exception 'Erro inesperado: % (esperado: %)', sqlerrm, trecho;
    end if;
    return;
  end;
  raise exception 'Deveria ter falhado: %', sql;
end $$;

-- 1) Administrador A cadastra produto e dá entrada no estoque
select pg_temp.como('00000000-0000-0000-0000-00000000a001');
insert into public.produtos(id, empresa_id, descricao, ean, preco_venda)
values ('00000000-0000-0000-0000-0000000000f1', '00000000-0000-0000-0000-0000000000b1', 'Dipirona 500mg', '7890000000001', 10.00);
-- empresa_id foi forçado para a empresa do usuário, mesmo informando outra
do $$ begin
  assert (select empresa_id from public.produtos where id = '00000000-0000-0000-0000-0000000000f1')
         = '00000000-0000-0000-0000-0000000000a1', 'empresa_id não foi forçado';
end $$;
select public.lancar_estoque('00000000-0000-0000-0000-0000000000f1', 'entrada', 20);
do $$ begin
  assert (select estoque_atual from public.produtos where id = '00000000-0000-0000-0000-0000000000f1') = 20, 'entrada não aplicada';
end $$;
reset role;

-- 2) Operador A abre caixa e vende
select pg_temp.como('00000000-0000-0000-0000-00000000a002');
select pg_temp.espera_erro($q$insert into public.produtos(descricao) values ('x')$q$, 'row-level security');
select pg_temp.espera_erro($q$select public.lancar_estoque('00000000-0000-0000-0000-0000000000f1','entrada',5)$q$, 'Sem permissão');
create temp table ctx(caixa uuid);
insert into ctx select public.abrir_caixa(1::smallint, 100);
select pg_temp.espera_erro($q$select public.abrir_caixa(1::smallint, 0)$q$, 'Já existe um caixa aberto');

-- alterar preço como operador é bloqueado
select pg_temp.espera_erro(format($q$select public.finalizar_venda(%L,
  '[{"produto_id":"00000000-0000-0000-0000-0000000000f1","quantidade":1,"preco_unitario":5}]',
  '[{"forma":"dinheiro","valor":5}]')$q$, (select caixa from ctx)), 'exige gerente');
-- pagamento insuficiente
select pg_temp.espera_erro(format($q$select public.finalizar_venda(%L,
  '[{"produto_id":"00000000-0000-0000-0000-0000000000f1","quantidade":2}]',
  '[{"forma":"pix","valor":10}]')$q$, (select caixa from ctx)), 'Pagamento insuficiente');
-- troco sem dinheiro
select pg_temp.espera_erro(format($q$select public.finalizar_venda(%L,
  '[{"produto_id":"00000000-0000-0000-0000-0000000000f1","quantidade":1}]',
  '[{"forma":"pix","valor":15}]')$q$, (select caixa from ctx)), 'Troco');

-- venda válida: 3 unidades = 30, paga 20 pix + 20 dinheiro, troco 10
create temp table res(r jsonb);
insert into res select public.finalizar_venda((select caixa from ctx),
  '[{"produto_id":"00000000-0000-0000-0000-0000000000f1","quantidade":3}]',
  '[{"forma":"pix","valor":20},{"forma":"dinheiro","valor":20}]');
do $$ declare r jsonb := (select r from res); begin
  assert (r->>'total')::numeric = 30 and (r->>'troco')::numeric = 10 and (r->>'numero')::int = 1, 'venda incorreta: ' || r;
  assert (select estoque_atual from public.produtos where id = '00000000-0000-0000-0000-0000000000f1') = 17, 'estoque não baixou';
end $$;
-- operador não insere venda direto
select pg_temp.espera_erro($q$insert into public.vendas(caixa_id, numero, subtotal, total) values (gen_random_uuid(), 99, 0, 0)$q$, 'row-level security');
-- operador não cancela
select pg_temp.espera_erro(format($q$select public.cancelar_venda(%L, 'cliente desistiu da compra')$q$, (select r->>'venda_id' from res)), 'exige gerente');

select public.movimentar_caixa((select caixa from ctx), 'sangria', 50, 'Depósito');
do $$ declare r jsonb := public.resumo_caixa((select caixa from ctx)); begin
  -- 100 abertura + 20 dinheiro - 10 troco - 50 sangria = 60
  assert (r->>'dinheiro_esperado')::numeric = 60, 'resumo incorreto: ' || r;
end $$;
reset role;

-- 3) Empresa B não enxerga nada da empresa A
select pg_temp.como('00000000-0000-0000-0000-00000000b001');
do $$ begin
  assert (select count(*) from public.produtos) = 0, 'B vê produtos de A';
  assert (select count(*) from public.vendas) = 0, 'B vê vendas de A';
  assert (select count(*) from public.empresas) = 1, 'B vê outras empresas';
end $$;
select pg_temp.espera_erro(format($q$select public.movimentar_caixa(%L,'suprimento',10,'x')$q$, (select caixa from ctx)), 'não está aberto');
select pg_temp.espera_erro($q$select public.lancar_estoque('00000000-0000-0000-0000-0000000000f1','entrada',5)$q$, 'Produto não encontrado');
reset role;

-- 4) Administrador A cancela a venda: estoque volta
select pg_temp.como('00000000-0000-0000-0000-00000000a001');
select pg_temp.espera_erro(format($q$select public.cancelar_venda(%L, 'curto')$q$, (select r->>'venda_id' from res)), 'motivo');
select public.cancelar_venda((select (r->>'venda_id')::uuid from res), 'Cliente desistiu da compra no caixa');
do $$ begin
  assert (select estoque_atual from public.produtos where id = '00000000-0000-0000-0000-0000000000f1') = 20, 'estoque não estornou';
end $$;
select public.fechar_caixa((select caixa from ctx), 80);
do $$ begin
  assert (select status from public.caixas where id = (select caixa from ctx)) = 'fechado', 'caixa não fechou';
end $$;
reset role;

\echo 'TODOS OS TESTES PASSARAM'
