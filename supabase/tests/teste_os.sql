-- Testes: ordens de serviço e serviços sem estoque
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
insert into public.produtos(id, descricao, preco_venda, servico) values ('00000000-0000-0000-0000-00000000e001', 'Mão de obra: troca de tela', 80, true);
insert into public.produtos(id, descricao, preco_venda) values ('00000000-0000-0000-0000-00000000e002', 'Tela de reposição', 150);
select public.lancar_estoque('00000000-0000-0000-0000-00000000e002', 'entrada', 5);
create temp table cx(caixa uuid); grant all on cx to authenticated;
insert into cx select public.abrir_caixa(41::smallint, 0);

-- Operador abre a OS (número automático; não nasce entregue)
select pg_temp.como('00000000-0000-0000-0000-00000000a002');
create temp table os(id uuid); grant all on os to authenticated;
with x as (insert into public.ordens_servico(cliente_nome, equipamento, defeito, status) values ('Maria', 'Celular', 'Tela quebrada', 'entregue') returning id) insert into os select id from x;
do $$ begin
  assert (select status from public.ordens_servico where id = (select id from os)) = 'aberta', 'nasce aberta';
  assert (select numero from public.ordens_servico where id = (select id from os)) > 0, 'numerada';
end $$;
select pg_temp.espera_erro(format($q$update public.ordens_servico set status = 'entregue' where id = %L$q$, (select id from os)), 'Entregar e receber');
select pg_temp.espera_erro(format($q$select public.fechar_os(%L, (select caixa from cx), '[{"forma":"dinheiro","valor":10}]')$q$, (select id from os)), 'Inclua os serviços');
-- Itens: serviço acima da tabela (combinado) e peça
insert into public.os_itens(os_id, produto_id, descricao, quantidade, preco_unitario) values
  ((select id from os), '00000000-0000-0000-0000-00000000e001', 'Mão de obra: troca de tela', 1, 120),
  ((select id from os), '00000000-0000-0000-0000-00000000e002', 'Tela de reposição', 1, 150);
update public.ordens_servico set status = 'aprovada' where id = (select id from os);
update public.ordens_servico set status = 'pronta' where id = (select id from os);
do $$ begin assert (select aprovada_em is not null and pronta_em is not null from public.ordens_servico where id = (select id from os)), 'datas das etapas'; end $$;
-- Operador entrega com preço combinado acima da tabela: permitido
create temp table vd(r jsonb); grant all on vd to authenticated;
insert into vd select public.fechar_os((select id from os), (select caixa from cx), '[{"forma":"pix","valor":270}]');
reset role;
do $$ begin
  assert (select (r->>'total')::numeric from vd) = 270, 'total combinado';
  assert (select status from public.ordens_servico where id = (select id from os)) = 'entregue', 'entregue';
  assert (select venda_id from public.ordens_servico where id = (select id from os)) = (select (r->>'venda_id')::uuid from vd), 'venda vinculada';
  assert (select estoque_atual from public.produtos where id = '00000000-0000-0000-0000-00000000e002') = 4, 'peça baixou';
  assert (select estoque_atual from public.produtos where id = '00000000-0000-0000-0000-00000000e001') = 0, 'serviço não movimenta estoque';
  assert not exists (select 1 from public.movimentos_estoque where produto_id = '00000000-0000-0000-0000-00000000e001'), 'sem movimento do serviço';
end $$;
-- Depois de entregue nada muda
select pg_temp.como('00000000-0000-0000-0000-00000000a002');
select pg_temp.espera_erro(format($q$update public.ordens_servico set diagnostico = 'x' where id = %L$q$, (select id from os)), 'já está entregue');
select pg_temp.espera_erro(format($q$insert into public.os_itens(os_id, produto_id, descricao, quantidade, preco_unitario) values (%L, '00000000-0000-0000-0000-00000000e002', 'x', 1, 1)$q$, (select id from os)), 'já está entregue');
-- Desconto abaixo da tabela exige gerente
create temp table os2(id uuid); grant all on os2 to authenticated;
with x as (insert into public.ordens_servico(cliente_nome) values ('João') returning id) insert into os2 select id from x;
insert into public.os_itens(os_id, produto_id, descricao, quantidade, preco_unitario) values ((select id from os2), '00000000-0000-0000-0000-00000000e002', 'Tela', 1, 100);
select pg_temp.espera_erro(format($q$select public.fechar_os(%L, (select caixa from cx), '[{"forma":"pix","valor":100}]')$q$, (select id from os2)), 'exige gerente');
select pg_temp.espera_erro(format($q$update public.ordens_servico set status = 'cancelada' where id = %L$q$, (select id from os2)), 'motivo');
update public.ordens_servico set status = 'cancelada', motivo_cancelamento = 'Cliente desistiu' where id = (select id from os2);
-- Venda comum no caixa: operador continua sem poder mudar preço
select pg_temp.espera_erro($q$select public.finalizar_venda((select caixa from cx), '[{"produto_id":"00000000-0000-0000-0000-00000000e002","quantidade":1,"preco_unitario":10}]', '[{"forma":"pix","valor":10}]')$q$, 'exige gerente');
-- Outra empresa não vê
select pg_temp.como('00000000-0000-0000-0000-00000000b001');
do $$ begin assert (select count(*) from public.ordens_servico) = 0, 'isolado'; end $$;
reset role;
