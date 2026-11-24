-- Testes do Grupo C: plano de contas padrão, lançamentos, baixas, nota -> contas a pagar, fluxo e DRE.
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
create or replace function pg_temp.plano(c text) returns uuid language sql as $$ select id from public.plano_contas where codigo = c $$;

-- 1) Empresas existentes receberam o plano padrão; empresa nova também recebe
do $$ begin
  assert (select count(*) from public.plano_contas where empresa_id = '00000000-0000-0000-0000-0000000000a1') = 23, 'plano da empresa A';
  assert (select count(*) from public.contas_bancarias where empresa_id = '00000000-0000-0000-0000-0000000000b1') = 1, 'conta da empresa B';
end $$;
insert into public.empresas(id, razao_social) values ('00000000-0000-0000-0000-0000000000c1', 'Empresa C');
do $$ begin assert (select count(*) from public.plano_contas where empresa_id = '00000000-0000-0000-0000-0000000000c1') = 23, 'empresa nova'; end $$;

-- 2) Operador não vê nem cria financeiro
select pg_temp.como('00000000-0000-0000-0000-00000000a002');
do $$ begin assert (select count(*) from public.plano_contas) = 0, 'operador não vê plano'; end $$;
select pg_temp.espera_erro($q$insert into public.lancamentos(tipo, descricao, plano_conta_id, valor, vencimento, competencia) values ('pagar','x',gen_random_uuid(),1,current_date,current_date)$q$, 'row-level security');
reset role;

-- 3) Gerente lança aluguel e paga em duas vezes, com juros
select pg_temp.como('00000000-0000-0000-0000-00000000a001');
insert into public.lancamentos(id, tipo, descricao, plano_conta_id, valor, vencimento, competencia)
values ('00000000-0000-0000-0000-0000000002a1', 'pagar', 'Aluguel', pg_temp.plano('4.01'), 1000, current_date, date_trunc('month', current_date)::date);
select pg_temp.espera_erro($q$update public.lancamentos set valor_pago = 1000 where id = '00000000-0000-0000-0000-0000000002a1'$q$, 'Use a baixa');
select public.baixar_lancamento('00000000-0000-0000-0000-0000000002a1', 400, current_date, null, 'pix', 0, 0);
select pg_temp.espera_erro($q$select public.baixar_lancamento('00000000-0000-0000-0000-0000000002a1', 700)$q$, 'maior que o saldo');
select pg_temp.espera_erro($q$update public.lancamentos set status = 'cancelado' where id = '00000000-0000-0000-0000-0000000002a1'$q$, 'pagamento parcial');
select public.baixar_lancamento('00000000-0000-0000-0000-0000000002a1', 600, current_date, null, 'pix', 15, 0);
do $$ begin
  assert (select status from public.lancamentos where id = '00000000-0000-0000-0000-0000000002a1') = 'pago', 'pago';
end $$;
select pg_temp.espera_erro($q$update public.lancamentos set descricao = 'x' where id = '00000000-0000-0000-0000-0000000002a1'$q$, 'já pago');

-- 4) Receita manual e imposto
insert into public.lancamentos(tipo, descricao, plano_conta_id, valor, vencimento, competencia)
values ('receber', 'Serviço de aplicação', pg_temp.plano('1.02'), 200, current_date + 5, current_date),
       ('pagar', 'DAS', pg_temp.plano('2.01'), 50, current_date + 10, current_date),
       ('pagar', 'Retirada', pg_temp.plano('6.01'), 300, current_date, current_date);

-- 5) Contas a pagar a partir da nota (teste_estoque lançou uma nota sem duplicatas)
do $$ declare n uuid := (select id from public.notas_entrada limit 1); begin
  assert public.gerar_pagar_nota(n) = 1, 'gerou título da nota';
  begin perform public.gerar_pagar_nota(n); raise exception 'deveria falhar';
  exception when others then if sqlerrm not like '%já foram geradas%' then raise; end if; end;
end $$;

-- 6) DRE do ano: vendas reais dos testes anteriores + lançamentos
do $$ declare d jsonb := public.dre(extract(year from current_date)::int); m jsonb; begin
  m := d->'meses'->(extract(month from current_date)::int - 1);
  assert (m->>'despesas_operacionais')::numeric = 1000, 'aluguel no DRE: ' || m;
  assert (m->>'despesas_financeiras')::numeric = 15, 'juros no DRE';
  assert (m->>'deducoes')::numeric = 50, 'imposto';
  assert (m->>'receita_bruta')::numeric = (select sum(total) from public.vendas where status = 'concluida'
     and date_trunc('month', criado_em at time zone 'America/Sao_Paulo') = date_trunc('month', now() at time zone 'America/Sao_Paulo')) + 200, 'receita bruta';
  assert (m->>'cmv')::numeric >= 0, 'cmv calculado';
  assert not exists (select 1 from jsonb_array_elements(d->'detalhe') x where x->>'codigo' in ('6.01','3.01')), 'retirada e compras fora do DRE';
end $$;

-- 7) Fluxo de caixa: saída do aluguel com juros no dia
do $$ declare f jsonb := public.fluxo_caixa(current_date, current_date + 10); begin
  assert ((f->'dias'->0)->>'saidas')::numeric >= 1015, 'saídas do dia: ' || (f->'dias'->0);
  assert ((f->'dias'->5)->>'previsto_entradas')::numeric >= 200, 'previsto receber';
end $$;
reset role;

-- 8) Custo gravado no item vendido
do $$ begin
  assert not exists (select 1 from public.venda_itens i join public.vendas v on v.id = i.venda_id
                      where i.custo_unitario is null and v.criado_em > now() - interval '1 hour'), 'custo gravado';
end $$;

-- 9) Isolamento
select pg_temp.como('00000000-0000-0000-0000-00000000b001');
do $$ begin assert (select count(*) from public.lancamentos) = 0, 'isolamento'; end $$;
reset role;
\echo 'TESTES DO FINANCEIRO PASSARAM'
