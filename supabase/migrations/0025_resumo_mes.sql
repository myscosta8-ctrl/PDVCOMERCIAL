-- Grupo J: indicadores do mês para o resumo (escrito por IA quando houver chave, ou por regras fixas).
-- Respeita as regras de acesso de quem consulta; só gerente e administrador.
create or replace function public.indicadores_mes()
returns jsonb language plpgsql stable security invoker set search_path = public as $$
declare
  v_hoje date := (now() at time zone 'America/Sao_Paulo')::date;
  v_ini date := date_trunc('month', v_hoje)::date;
  v_ant date := (date_trunc('month', v_hoje) - interval '1 month')::date;
  v_dia int := extract(day from v_hoje)::int;
  v_ant_ate date;
  r jsonb;
begin
  if public.auth_papel() not in ('administrador','gerente') then raise exception 'Somente gerente ou administrador'; end if;
  -- Mesmo trecho do mês anterior (do dia 1 até o mesmo dia), para comparar de forma justa
  v_ant_ate := least((v_ant + make_interval(days => v_dia - 1))::date, (v_ini - 1));
  with v as (
    select v.id, v.total, v.desconto, v.status, (v.criado_em at time zone 'America/Sao_Paulo')::date dia
      from public.vendas v where (v.criado_em at time zone 'America/Sao_Paulo')::date between v_ant and v_hoje),
  atual as (select * from v where dia >= v_ini and status = 'concluida'),
  anterior as (select * from v where dia between v_ant and v_ant_ate and status = 'concluida'),
  itens as (select i.descricao, i.quantidade, i.total, i.produto_id from public.venda_itens i join atual a on a.id = i.venda_id)
  select jsonb_build_object(
    'mes', to_char(v_ini, 'YYYY-MM'), 'dia', v_dia, 'dias_mes', extract(day from (v_ini + interval '1 month - 1 day'))::int,
    'vendas', jsonb_build_object(
      'total', coalesce((select sum(total) from atual), 0), 'qtd', (select count(*) from atual),
      'descontos', coalesce((select sum(desconto) from atual), 0),
      'canceladas', (select count(*) from v where dia >= v_ini and status = 'cancelada'),
      'dias_com_venda', (select count(distinct dia) from atual)),
    'anterior', jsonb_build_object('total', coalesce((select sum(total) from anterior), 0), 'qtd', (select count(*) from anterior)),
    'margem', coalesce((select sum(i.total - i.quantidade * p.preco_custo) from itens i join public.produtos p on p.id = i.produto_id where p.preco_custo > 0), 0),
    'faturamento_com_custo', coalesce((select sum(i.total) from itens i join public.produtos p on p.id = i.produto_id where p.preco_custo > 0), 0),
    'mais_vendidos', coalesce((select jsonb_agg(m) from (select descricao, sum(quantidade) quantidade, sum(total) total from itens group by 1 order by 3 desc limit 5) m), '[]'::jsonb),
    'formas', coalesce((select jsonb_object_agg(forma, valor) from (
        select p.forma, sum(p.valor) valor from public.venda_pagamentos p join atual a on a.id = p.venda_id group by 1) f), '{}'::jsonb),
    'crediario_atrasado', coalesce((select sum(valor - valor_pago) from public.contas_receber where status = 'aberta' and vencimento < v_hoje), 0),
    'estoque_baixo', (select count(*) from public.produtos where ativo and estoque_atual <= estoque_minimo and estoque_minimo > 0),
    'lotes_vencendo', (select count(*) from public.lotes where quantidade > 0 and validade between v_hoje and v_hoje + 30),
    'lotes_vencidos', (select count(*) from public.lotes where quantidade > 0 and validade < v_hoje),
    'financeiro', (select jsonb_build_object('pagos_mes', f->'pagos_mes', 'compras_mes', f->'compras_mes', 'a_vencer_mes', f->'a_vencer_mes',
                                             'a_receber_total', f->'a_receber_total', 'teto_gastos', f->'teto_gastos')
                     from (select public.painel_financeiro() f) x)
  ) into r;
  return r;
end $$;
revoke execute on function public.indicadores_mes() from public, anon;
grant execute on function public.indicadores_mes() to authenticated;
