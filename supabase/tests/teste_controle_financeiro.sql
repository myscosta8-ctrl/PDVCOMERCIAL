-- Testes: despesas fixas, reclassificação de título pago, histórico e relatório por conta.
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
insert into public.despesas_fixas(id, descricao, plano_conta_id, valor, dia_vencimento, inicio) values
  ('00000000-0000-0000-0000-00000000f1f1', 'Aluguel fixo teste', (select id from public.plano_contas where codigo = '4.01'), 1500, 10, '2026-01-01'),
  ('00000000-0000-0000-0000-00000000f1f2', 'Energia fixa teste', (select id from public.plano_contas where codigo = '4.02'), 400, 31, '2026-01-01');
update public.despesas_fixas set valor_variavel = true where id = '00000000-0000-0000-0000-00000000f1f2';

do $$
begin
  assert public.gerar_despesas_fixas('2026-02-15') = 2, 'gera duas em fevereiro';
  assert public.gerar_despesas_fixas('2026-02-01') = 0, 'não duplica';
  assert (select vencimento from public.lancamentos where despesa_fixa_id = '00000000-0000-0000-0000-00000000f1f2' and competencia = '2026-02-01') = '2026-02-28', 'dia 31 vira último dia';
  assert (select observacao from public.lancamentos where despesa_fixa_id = '00000000-0000-0000-0000-00000000f1f2' and competencia = '2026-02-01') like 'Valor estimado%', 'aviso de valor variável';
end $$;
-- Cancelada não volta
update public.lancamentos set status = 'cancelado' where despesa_fixa_id = '00000000-0000-0000-0000-00000000f1f1' and competencia = '2026-02-01';
do $$ begin assert public.gerar_despesas_fixas('2026-02-01') = 0, 'cancelada não é recriada'; end $$;
-- Encerrada não gera
update public.despesas_fixas set fim = '2026-02-28' where id = '00000000-0000-0000-0000-00000000f1f1';
do $$ begin assert public.gerar_despesas_fixas('2026-03-01') = 1, 'só a energia em março'; end $$;

-- Título pago: reclassifica, mas não muda valor
create temp table t(id uuid); grant all on t to authenticated;
insert into t select id from public.lancamentos where despesa_fixa_id = '00000000-0000-0000-0000-00000000f1f2' and competencia = '2026-03-01';
select public.baixar_lancamento((select id from t), 400, '2026-03-30');
update public.lancamentos set plano_conta_id = (select id from public.plano_contas where codigo = '4.11') where id = (select id from t);
select pg_temp.espera_erro($q$update public.lancamentos set valor = 10 where id = (select id from t)$q$, 'já pago');

do $$
declare h jsonb := public.historico_financeiro('2000-01-01', '2100-01-01');
begin
  assert h @> '[{"acao":"gerou_fixa"}]', 'histórico da geração';
  assert h @> '[{"acao":"cancelou"}]', 'histórico do cancelamento';
  assert h @> '[{"acao":"pagou"}]', 'histórico do pagamento';
  assert h @> '[{"acao":"reclassificou"}]', 'histórico da reclassificação';
  assert (select count(*) from jsonb_array_elements(h) e where e->>'acao' = 'editou' and e->>'lancamento_id' = (select id::text from t)) = 0, 'baixa não aparece como edição';
  assert (h->0->>'usuario') is not null, 'nome de quem fez';
end $$;

do $$
declare r jsonb := public.relatorio_contas('2026-01-01', '2026-12-31');
begin
  assert r @> '[{"mes":"2026-03","codigo":"4.11","valor":400}]', 'reclassificada entra na nova conta';
  assert r @> '[{"mes":"2026-02","codigo":"4.02","valor":400}]', 'energia de fevereiro';
  assert not r @> '[{"mes":"2026-02","codigo":"4.01"}]', 'cancelada fica fora';
end $$;

-- Operador não vê nem gera
select pg_temp.como('00000000-0000-0000-0000-00000000a002');
select pg_temp.espera_erro($q$select public.gerar_despesas_fixas()$q$, 'Somente gerente');
do $$ begin assert (select count(*) from public.despesas_fixas) = 0, 'operador não vê despesas fixas'; end $$;
reset role;
select 'controle financeiro ok';
