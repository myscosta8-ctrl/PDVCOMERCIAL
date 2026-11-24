-- Testes: venda de controlados exige receita compatível, livro de registro e balanço.
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
insert into public.produtos(id, descricao, ean, ncm, preco_venda, preco_custo, controlado, lista_controle) values
  ('00000000-0000-0000-0000-0000000c0001', 'Clonazepam 2 mg', '7896000000901', '30049099', 18, 6, true, 'B1'),
  ('00000000-0000-0000-0000-0000000c0002', 'Amoxicilina 500 mg', '7896000000902', '30041019', 25, 9, true, 'AM');
select public.lancar_estoque('00000000-0000-0000-0000-0000000c0001', 'entrada', 10, null, 6, null, 'CLZ1', current_date + 200);
select public.lancar_estoque('00000000-0000-0000-0000-0000000c0002', 'entrada', 5, null, 9);
update public.produtos set controla_lote = true where id = '00000000-0000-0000-0000-0000000c0001';
create temp table cx(id uuid); grant all on cx to authenticated;
insert into cx select id from public.caixas where empresa_id = '00000000-0000-0000-0000-0000000000a1' and status = 'aberto' limit 1;
do $$ begin if (select id from cx) is null then raise exception 'sem caixa aberto para o teste'; end if; end $$;

create or replace function pg_temp.receita(tipo text, produto text, emissao date default current_date, extra jsonb default '{}') returns jsonb language sql as $$
  select jsonb_build_array(jsonb_build_object('tipo', tipo, 'numero', 'PA1234567', 'data_emissao', emissao,
    'prescritor_nome', 'Dra. Maria', 'prescritor_conselho', 'crm', 'prescritor_numero', '1234', 'prescritor_uf', 'PA',
    'paciente_nome', 'Paciente', 'comprador_nome', 'Comprador', 'comprador_documento', '1234567', 'produtos', jsonb_build_array(produto)) || extra)
$$;
grant execute on function pg_temp.receita(text, text, date, jsonb) to authenticated;

-- 1) Sem receita: bloqueia
select pg_temp.espera_erro($q$select public.finalizar_venda((select id from cx), '[{"produto_id":"00000000-0000-0000-0000-0000000c0001","quantidade":1}]', '[{"forma":"pix","valor":18}]')$q$, 'Informe a receita de Clonazepam');
-- 2) Tipo errado (B1 exige notificação B)
select pg_temp.espera_erro($q$select public.finalizar_venda((select id from cx), '[{"produto_id":"00000000-0000-0000-0000-0000000c0001","quantidade":1}]', '[{"forma":"pix","valor":18}]', 0, null, null, null, pg_temp.receita('controle_especial', '00000000-0000-0000-0000-0000000c0001'))$q$, 'não serve');
-- 3) Antimicrobiano vencido (10 dias) e sem idade/sexo
select pg_temp.espera_erro($q$select public.finalizar_venda((select id from cx), '[{"produto_id":"00000000-0000-0000-0000-0000000c0002","quantidade":1}]', '[{"forma":"pix","valor":25}]', 0, null, null, null, pg_temp.receita('antimicrobiano', '00000000-0000-0000-0000-0000000c0002', current_date - 11, '{"paciente_idade":30,"paciente_sexo":"F"}'))$q$, 'vencida');
select pg_temp.espera_erro($q$select public.finalizar_venda((select id from cx), '[{"produto_id":"00000000-0000-0000-0000-0000000c0002","quantidade":1}]', '[{"forma":"pix","valor":25}]', 0, null, null, null, pg_temp.receita('antimicrobiano', '00000000-0000-0000-0000-0000000c0002'))$q$, 'idade e sexo');
do $$ begin assert (select estoque_atual from public.produtos where id = '00000000-0000-0000-0000-0000000c0001') = 10, 'nada baixou nas tentativas'; end $$;

-- 4) Venda correta grava receita e itens com lote
create temp table vd(r jsonb); grant all on vd to authenticated;
insert into vd select public.finalizar_venda((select id from cx), '[{"produto_id":"00000000-0000-0000-0000-0000000c0001","quantidade":2}]', '[{"forma":"pix","valor":36}]', 0, null, null, null,
  pg_temp.receita('notificacao_b', '00000000-0000-0000-0000-0000000c0001'));
insert into vd select public.finalizar_venda((select id from cx), '[{"produto_id":"00000000-0000-0000-0000-0000000c0002","quantidade":1}]', '[{"forma":"pix","valor":25}]', 0, null, null, null,
  pg_temp.receita('antimicrobiano', '00000000-0000-0000-0000-0000000c0002', current_date - 3, '{"paciente_idade":30,"paciente_sexo":"F"}'));
do $$ begin
  assert (select count(*) from public.receitas) = 2, 'duas receitas';
  assert (select prescritor_conselho from public.receitas where tipo = 'notificacao_b') = 'CRM', 'conselho em maiúsculas';
  assert (select ri.quantidade from public.receita_itens ri where ri.produto_id = '00000000-0000-0000-0000-0000000c0001') = 2, 'quantidade na receita';
  assert (select l.numero from public.receita_itens ri join public.lotes l on l.id = ri.lote_id where ri.produto_id = '00000000-0000-0000-0000-0000000c0001') = 'CLZ1', 'lote na receita';
end $$;
-- venda comum continua sem receita
select public.finalizar_venda((select id from cx), '[{"produto_id":"00000000-0000-0000-0000-000000000ff2","quantidade":1}]', '[{"forma":"pix","valor":10}]');

-- 5) Livro e balanço
select public.lancar_estoque('00000000-0000-0000-0000-0000000c0001', 'perda', 1, null, null, 'Quebra');
do $$
declare l jsonb := public.livro_controlados(current_date, current_date, '00000000-0000-0000-0000-0000000c0001'); b jsonb := public.balanco_controlados(current_date, current_date); x jsonb;
begin
  assert (l->0->>'inicial')::numeric = 0, 'saldo inicial';
  assert jsonb_array_length(l->0->'movimentos') = 3, 'entrada, venda e perda';
  assert (l->0->'movimentos'->2->>'saldo')::numeric = 7, 'saldo final 10 - 2 - 1';
  assert (l->0->'movimentos'->1->>'documento') like '%receita PA1234567%', 'venda cita a receita';
  select y into x from jsonb_array_elements(b) y where y->>'descricao' = 'Clonazepam 2 mg';
  assert (x->>'entradas')::numeric = 10 and (x->>'saidas')::numeric = 2 and (x->>'perdas')::numeric = 1 and (x->>'final')::numeric = 7, 'balanço';
end $$;

-- 6) Operador vende com receita, mas não vê livro; B não vê receitas de A
reset role; select pg_temp.como('00000000-0000-0000-0000-00000000a002');
select pg_temp.espera_erro($q$select public.livro_controlados(current_date, current_date)$q$, 'Somente gerente');
reset role; select pg_temp.como('00000000-0000-0000-0000-00000000b001');
do $$ begin assert (select count(*) from public.receitas) = 0, 'isolamento'; end $$;
reset role;
select 'TESTES DE CONTROLADOS PASSARAM' as ok;
