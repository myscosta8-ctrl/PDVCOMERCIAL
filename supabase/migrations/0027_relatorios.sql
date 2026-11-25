-- Relatórios gerenciais de vendas: resumo com comparação, dia a dia, mapa de horários, produtos (curva ABC),
-- categorias, operadores, formas de pagamento, clientes e produtos parados.
-- Respeita as regras de acesso de quem consulta; só gerente e administrador.
create or replace function public.relatorio_gerencial(p_inicio date, p_fim date)
returns jsonb language plpgsql stable security invoker set search_path = public as $$
declare
  v_dias int := p_fim - p_inicio + 1;
  v_ant_ini date := p_inicio - (p_fim - p_inicio + 1);
  v_ant_fim date := p_inicio - 1;
  r jsonb;
begin
  if public.auth_papel() not in ('administrador','gerente') then raise exception 'Somente gerente ou administrador'; end if;
  if p_inicio is null or p_fim is null or p_fim < p_inicio then raise exception 'Período inválido'; end if;
  if v_dias > 400 then raise exception 'Escolha um período de até 400 dias'; end if;

  with v as (
    select v.*, (v.criado_em at time zone 'America/Sao_Paulo') local
      from public.vendas v
     where (v.criado_em at time zone 'America/Sao_Paulo')::date between v_ant_ini and p_fim),
  atual as (select * from v where local::date >= p_inicio and status = 'concluida'),
  anterior as (select * from v where local::date <= v_ant_fim and status = 'concluida'),
  itens as (
    select i.produto_id, i.descricao, i.quantidade, i.total, i.desconto, a.operador_id, a.id venda_id,
           p.preco_custo, p.categoria_id, coalesce(c.nome, 'Sem categoria') categoria
      from public.venda_itens i join atual a on a.id = i.venda_id
      join public.produtos p on p.id = i.produto_id
      left join public.categorias c on c.id = p.categoria_id),
  itens_ant as (
    select i.quantidade, i.total, p.preco_custo from public.venda_itens i join anterior a on a.id = i.venda_id join public.produtos p on p.id = i.produto_id),
  dev as (
    select d.valor, (d.criado_em at time zone 'America/Sao_Paulo')::date dia from public.devolucoes d
     where (d.criado_em at time zone 'America/Sao_Paulo')::date between v_ant_ini and p_fim),
  resumo as (
    select (select coalesce(sum(total), 0) from atual) total, (select count(*) from atual) qtd,
           (select coalesce(sum(desconto), 0) from atual) + (select coalesce(sum(desconto), 0) from itens) descontos,
           (select coalesce(sum(quantidade), 0) from itens) itens,
           (select coalesce(sum(quantidade * preco_custo), 0) from itens where preco_custo > 0) custo,
           (select coalesce(sum(total), 0) from itens where preco_custo > 0) total_com_custo,
           (select count(*) from v where local::date >= p_inicio and status = 'cancelada') canceladas,
           (select coalesce(sum(valor), 0) from dev where dia >= p_inicio) devolucoes,
           (select count(distinct cliente_id) from atual where cliente_id is not null) clientes),
  resumo_ant as (
    select (select coalesce(sum(total), 0) from anterior) total, (select count(*) from anterior) qtd,
           (select coalesce(sum(quantidade * preco_custo), 0) from itens_ant where preco_custo > 0) custo,
           (select coalesce(sum(total), 0) from itens_ant where preco_custo > 0) total_com_custo,
           (select coalesce(sum(valor), 0) from dev where dia <= v_ant_fim) devolucoes)
  select jsonb_build_object(
    'periodo', jsonb_build_object('inicio', p_inicio, 'fim', p_fim, 'dias', v_dias, 'anterior_inicio', v_ant_ini, 'anterior_fim', v_ant_fim),
    'resumo', (select to_jsonb(resumo) from resumo),
    'anterior', (select to_jsonb(resumo_ant) from resumo_ant),
    'por_dia', (select coalesce(jsonb_agg(jsonb_build_object('dia', d.dia, 'total', coalesce(t.total, 0), 'qtd', coalesce(t.qtd, 0)) order by d.dia), '[]'::jsonb)
                  from generate_series(p_inicio, p_fim, interval '1 day') d(dia)
                  left join (select local::date dia, sum(total) total, count(*) qtd from atual group by 1) t on t.dia = d.dia::date),
    'mapa_horas', (select coalesce(jsonb_agg(jsonb_build_object('dow', dow, 'hora', hora, 'total', total, 'qtd', qtd)), '[]'::jsonb) from (
                    select extract(dow from local)::int dow, extract(hour from local)::int hora, sum(total) total, count(*) qtd from atual group by 1, 2) h),
    'produtos', (select coalesce(jsonb_agg(x order by x.total desc), '[]'::jsonb) from (
                  select produto_id id, max(descricao) descricao, max(categoria) categoria, sum(quantidade) quantidade, sum(total) total,
                         case when bool_and(preco_custo > 0) then sum(quantidade * preco_custo) end custo, count(distinct venda_id) vendas
                    from itens group by produto_id) x),
    'categorias', (select coalesce(jsonb_agg(x order by x.total desc), '[]'::jsonb) from (
                    select categoria nome, sum(quantidade) quantidade, sum(total) total,
                           sum(quantidade * preco_custo) filter (where preco_custo > 0) custo, sum(total) filter (where preco_custo > 0) total_com_custo,
                           count(distinct produto_id) produtos
                      from itens group by categoria) x),
    'operadores', (select coalesce(jsonb_agg(x order by x.total desc), '[]'::jsonb) from (
                    select u.nome, count(*) filter (where v.status = 'concluida') vendas, coalesce(sum(v.total) filter (where v.status = 'concluida'), 0) total,
                           coalesce(sum(v.desconto) filter (where v.status = 'concluida'), 0) descontos, count(*) filter (where v.status = 'cancelada') canceladas
                      from v join public.usuarios u on u.id = v.operador_id
                     where v.local::date >= p_inicio group by u.id, u.nome) x),
    'formas', (select coalesce(jsonb_agg(x order by x.total desc), '[]'::jsonb) from (
                select p.forma, count(distinct p.venda_id) vendas,
                       sum(p.valor) - case when p.forma = 'dinheiro' then (select coalesce(sum(troco), 0) from atual) else 0 end total
                  from public.venda_pagamentos p join atual a on a.id = p.venda_id group by p.forma) x),
    'clientes', (select coalesce(jsonb_agg(x order by x.total desc), '[]'::jsonb) from (
                  select c.nome, count(*) vendas, sum(a.total) total, max(a.local) ultima
                    from atual a join public.clientes c on c.id = a.cliente_id group by c.id, c.nome order by sum(a.total) desc limit 20) x),
    'parados', (select coalesce(jsonb_agg(x order by x.valor_estoque desc), '[]'::jsonb) from (
                 select p.id, p.descricao, p.estoque_atual, p.unidade, p.preco_custo, round(p.estoque_atual * p.preco_custo, 2) valor_estoque,
                        (select max(vv.criado_em) from public.venda_itens vi join public.vendas vv on vv.id = vi.venda_id
                          where vi.produto_id = p.id and vv.status = 'concluida') ultima_venda
                   from public.produtos p
                  where p.ativo and not coalesce(p.e_grade, false) and p.estoque_atual > 0
                    and not exists (select 1 from itens i where i.produto_id = p.id)
                  order by p.estoque_atual * p.preco_custo desc limit 100) x)
  ) into r;
  return r;
end $$;
revoke execute on function public.relatorio_gerencial(date, date) from public, anon;
grant execute on function public.relatorio_gerencial(date, date) to authenticated;
