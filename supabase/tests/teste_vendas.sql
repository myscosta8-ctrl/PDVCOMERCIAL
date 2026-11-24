-- Testes do bloco Vendas: crediário, convênio, recebimento, devolução, vale-troca e pré-venda.
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

-- Preparação (administrador A): produto, convênio, clientes e caixa
select pg_temp.como('00000000-0000-0000-0000-00000000a001');
insert into public.produtos(id, descricao, preco_venda) values ('00000000-0000-0000-0000-0000000000f2', 'Produto teste', 30);
select public.lancar_estoque('00000000-0000-0000-0000-0000000000f2', 'entrada', 50);
insert into public.convenios(id, nome, dia_fechamento, dias_vencimento) values ('00000000-0000-0000-0000-0000000000c1', 'Prefeitura', 25, 10);
insert into public.clientes(id, nome, limite_credito) values ('00000000-0000-0000-0000-0000000000d1', 'Cliente crediário', 100);
insert into public.clientes(id, nome, convenio_id) values ('00000000-0000-0000-0000-0000000000d2', 'Cliente convênio', '00000000-0000-0000-0000-0000000000c1');
create temp table ctx(caixa uuid); grant all on ctx to authenticated;
insert into ctx select public.abrir_caixa(5::smallint, 100);
reset role;

-- 1) Crediário em 3 parcelas dentro do limite
select pg_temp.como('00000000-0000-0000-0000-00000000a002');
select public.finalizar_venda((select caixa from ctx),
  '[{"produto_id":"00000000-0000-0000-0000-0000000000f2","quantidade":3}]',
  '[{"forma":"crediario","valor":90,"parcelas":3}]', 0, '00000000-0000-0000-0000-0000000000d1');
do $$ begin
  assert (select count(*) from public.contas_receber where cliente_id = '00000000-0000-0000-0000-0000000000d1') = 3, 'parcelas';
  assert (select sum(valor) from public.contas_receber where cliente_id = '00000000-0000-0000-0000-0000000000d1') = 90, 'soma parcelas';
  assert (public.situacao_cliente('00000000-0000-0000-0000-0000000000d1')->>'disponivel')::numeric = 10, 'disponível';
end $$;
-- Limite estourado
select pg_temp.espera_erro(format($q$select public.finalizar_venda(%L,
  '[{"produto_id":"00000000-0000-0000-0000-0000000000f2","quantidade":1}]',
  '[{"forma":"crediario","valor":30}]', 0, '00000000-0000-0000-0000-0000000000d1')$q$, (select caixa from ctx)), 'Limite de crédito');
-- Crediário sem cliente
select pg_temp.espera_erro(format($q$select public.finalizar_venda(%L,
  '[{"produto_id":"00000000-0000-0000-0000-0000000000f2","quantidade":1}]',
  '[{"forma":"crediario","valor":30}]')$q$, (select caixa from ctx)), 'Identifique o cliente');
-- Operador não grava conta a receber direto
select pg_temp.espera_erro($q$insert into public.contas_receber(cliente_id, origem, valor, vencimento) values ('00000000-0000-0000-0000-0000000000d1','crediario',1,current_date)$q$, 'row-level security');
reset role;

-- 2) Atraso bloqueia crediário para operador (ajuste direto, sem usuário logado)
select set_config('request.jwt.claim.sub', '', false);
update public.contas_receber set vencimento = current_date - 5 where cliente_id = '00000000-0000-0000-0000-0000000000d1' and parcela = 1;
update public.clientes set limite_credito = 500 where id = '00000000-0000-0000-0000-0000000000d1';
select pg_temp.como('00000000-0000-0000-0000-00000000a002');
do $$ begin
  assert (public.situacao_cliente('00000000-0000-0000-0000-0000000000d1')->>'em_atraso')::numeric = 30, 'em atraso';
end $$;
select pg_temp.espera_erro(format($q$select public.finalizar_venda(%L,
  '[{"produto_id":"00000000-0000-0000-0000-0000000000f2","quantidade":1}]',
  '[{"forma":"crediario","valor":30}]', 0, '00000000-0000-0000-0000-0000000000d1')$q$, (select caixa from ctx)), 'em atraso');

-- 3) Recebimento de 40 no caixa: quita a 1ª parcela (30) e abate 10 da 2ª
select public.receber_contas((select caixa from ctx), '00000000-0000-0000-0000-0000000000d1', 40, 'dinheiro');
do $$ begin
  assert (select status from public.contas_receber where cliente_id = '00000000-0000-0000-0000-0000000000d1' and parcela = 1) = 'paga', 'parcela 1 paga';
  assert (select valor_pago from public.contas_receber where cliente_id = '00000000-0000-0000-0000-0000000000d1' and parcela = 2) = 10, 'parcela 2 parcial';
  assert (public.resumo_caixa((select caixa from ctx))->>'dinheiro_esperado')::numeric = 140, 'caixa com recebimento: ' || public.resumo_caixa((select caixa from ctx));
end $$;
select pg_temp.espera_erro(format($q$select public.receber_contas(%L, '00000000-0000-0000-0000-0000000000d1', 1000, 'pix')$q$, (select caixa from ctx)), 'maior que o saldo');

-- 4) Convênio gera conta com vencimento do convênio
create temp table v_conv(r jsonb); grant all on v_conv to authenticated;
insert into v_conv select public.finalizar_venda((select caixa from ctx),
  '[{"produto_id":"00000000-0000-0000-0000-0000000000f2","quantidade":1}]',
  '[{"forma":"convenio","valor":30}]', 0, '00000000-0000-0000-0000-0000000000d2');
do $$ begin
  assert (select vencimento from public.contas_receber where cliente_id = '00000000-0000-0000-0000-0000000000d2')
       = public.vencimento_convenio(25::smallint, 10::smallint, (now() at time zone 'America/Sao_Paulo')::date), 'vencimento convênio';
end $$;

-- 5) Venda em dinheiro e devolução
create temp table v_din(r jsonb); grant all on v_din to authenticated;
insert into v_din select public.finalizar_venda((select caixa from ctx),
  '[{"produto_id":"00000000-0000-0000-0000-0000000000f2","quantidade":2}]', '[{"forma":"dinheiro","valor":60}]');
-- operador não devolve
select pg_temp.espera_erro(format($q$select public.devolver_itens(%L, '[]', 'dinheiro', 'motivo qualquer longo', %L)$q$,
  (select r->>'venda_id' from v_din), (select caixa from ctx)), 'exige gerente');
reset role;

select pg_temp.como('00000000-0000-0000-0000-00000000a001');
do $$ declare item uuid := (select id from public.venda_itens where venda_id = (select (r->>'venda_id')::uuid from v_din));
         est numeric := (select estoque_atual from public.produtos where id = '00000000-0000-0000-0000-0000000000f2');
         esperado numeric := (public.resumo_caixa((select caixa from ctx))->>'dinheiro_esperado')::numeric; begin
  perform public.devolver_itens((select (r->>'venda_id')::uuid from v_din), jsonb_build_array(jsonb_build_object('venda_item_id', item, 'quantidade', 1)),
                                'dinheiro', 'Produto com defeito', (select caixa from ctx));
  assert (select estoque_atual from public.produtos where id = '00000000-0000-0000-0000-0000000000f2') = est + 1, 'estoque voltou';
  assert (public.resumo_caixa((select caixa from ctx))->>'dinheiro_esperado')::numeric = esperado - 30, 'reembolso saiu do caixa';
  -- devolver mais do que sobrou
  begin
    perform public.devolver_itens((select (r->>'venda_id')::uuid from v_din), jsonb_build_array(jsonb_build_object('venda_item_id', item, 'quantidade', 2)),
                                  'dinheiro', 'Produto com defeito', (select caixa from ctx));
    raise exception 'deveria falhar';
  exception when others then
    if sqlerrm not like 'Quantidade inválida%' then raise; end if;
  end;
end $$;

-- 6) Devolução em vale-troca e uso do vale em nova venda
do $$ declare item uuid := (select id from public.venda_itens where venda_id = (select (r->>'venda_id')::uuid from v_din)); begin
  perform public.devolver_itens((select (r->>'venda_id')::uuid from v_din), jsonb_build_array(jsonb_build_object('venda_item_id', item, 'quantidade', 1)),
                                'vale', 'Troca por outro tamanho', null, '00000000-0000-0000-0000-0000000000d2');
  assert (public.situacao_cliente('00000000-0000-0000-0000-0000000000d2')->>'vale')::numeric = 30, 'vale gerado';
end $$;
-- venda com venda a prazo não pode ser cancelada após devolução
select pg_temp.espera_erro(format($q$select public.cancelar_venda(%L, 'cliente desistiu da compra toda')$q$, (select r->>'venda_id' from v_din)), 'devolução');
reset role;

select pg_temp.como('00000000-0000-0000-0000-00000000a002');
select public.finalizar_venda((select caixa from ctx),
  '[{"produto_id":"00000000-0000-0000-0000-0000000000f2","quantidade":1}]', '[{"forma":"vale","valor":30}]', 0, '00000000-0000-0000-0000-0000000000d2');
do $$ begin
  assert (public.situacao_cliente('00000000-0000-0000-0000-0000000000d2')->>'vale')::numeric = 0, 'vale usado';
end $$;
select pg_temp.espera_erro(format($q$select public.finalizar_venda(%L,
  '[{"produto_id":"00000000-0000-0000-0000-0000000000f2","quantidade":1}]', '[{"forma":"vale","valor":30}]', 0, '00000000-0000-0000-0000-0000000000d2')$q$,
  (select caixa from ctx)), 'vale-troca insuficiente');

-- 7) Orçamento numerado pelo banco; número não pode ser trocado
insert into public.pre_vendas(tipo, cliente_nome, itens, total) values ('orcamento', 'João', '[{"produto_id":"00000000-0000-0000-0000-0000000000f2","quantidade":1}]', 30);
insert into public.pre_vendas(tipo, cliente_nome, itens, total) values ('orcamento', 'Maria', '[{"produto_id":"00000000-0000-0000-0000-0000000000f2","quantidade":2}]', 60);
update public.pre_vendas set numero = 999, status = 'cancelado' where cliente_nome = 'Maria';
do $$ begin
  assert (select numero from public.pre_vendas where cliente_nome = 'João') = 1, 'numeração 1';
  assert (select numero from public.pre_vendas where cliente_nome = 'Maria') = 2, 'número preservado';
  assert (select status from public.pre_vendas where cliente_nome = 'Maria') = 'cancelado', 'status alterado';
end $$;
reset role;

-- 8) Empresa B não vê nada disso
select pg_temp.como('00000000-0000-0000-0000-00000000b001');
do $$ begin
  assert (select count(*) from public.contas_receber) = 0 and (select count(*) from public.pre_vendas) = 0
     and (select count(*) from public.convenios) = 0 and (select count(*) from public.devolucoes) = 0, 'isolamento';
end $$;
select pg_temp.espera_erro($q$select public.receber_contas((select id from public.caixas limit 1), '00000000-0000-0000-0000-0000000000d1', 1, 'pix')$q$, 'não está aberto');
reset role;

\echo 'TESTES DE VENDAS PASSARAM'

-- 9) Operador não altera limite de crédito
select pg_temp.como('00000000-0000-0000-0000-00000000a002');
select pg_temp.espera_erro($q$update public.clientes set limite_credito = 9999 where id = '00000000-0000-0000-0000-0000000000d1'$q$, 'Somente gerente');
insert into public.clientes(id, nome, limite_credito) values ('00000000-0000-0000-0000-0000000000d3', 'Novo pelo operador', 5000);
do $$ begin assert (select limite_credito from public.clientes where id = '00000000-0000-0000-0000-0000000000d3') = 0, 'limite zerado'; end $$;
reset role;
\echo 'TESTE DE LIMITE PASSOU'
