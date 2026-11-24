-- Resumo do dia para a tela Início (respeita as regras de acesso de quem consulta)
create or replace function public.painel_dia(p_dia date default null)
returns jsonb language sql stable security invoker set search_path = public as $$
  with par as (
    select coalesce(p_dia, (now() at time zone 'America/Sao_Paulo')::date) dia
  ),
  v as (
    select v.*, (v.criado_em at time zone 'America/Sao_Paulo') local
      from public.vendas v, par
     where v.status = 'concluida'
       and (v.criado_em at time zone 'America/Sao_Paulo')::date between par.dia - 1 and par.dia
  ),
  hoje as (select v.* from v, par where v.local::date = par.dia),
  ontem as (select v.* from v, par where v.local::date = par.dia - 1),
  itens as (select i.* from public.venda_itens i join hoje h on h.id = i.venda_id)
  select jsonb_build_object(
    'dia', (select dia from par),
    'total', coalesce((select sum(total) from hoje), 0),
    'qtd', (select count(*) from hoje),
    'itens', coalesce((select sum(quantidade) from itens), 0),
    'descontos', coalesce((select sum(desconto) from hoje), 0) + coalesce((select sum(desconto) from itens), 0),
    'ontem_total', coalesce((select sum(total) from ontem), 0),
    'ontem_qtd', (select count(*) from ontem),
    'canceladas', (select count(*) from public.vendas x, par
                    where x.status = 'cancelada' and (x.criado_em at time zone 'America/Sao_Paulo')::date = par.dia),
    'por_hora', (select jsonb_agg(coalesce(t.total, 0) order by h.hora)
                   from generate_series(0, 23) h(hora)
                   left join (select extract(hour from local)::int hora, sum(total) total from hoje group by 1) t on t.hora = h.hora),
    'formas', coalesce((select jsonb_object_agg(forma, valor) from (
                select p.forma, sum(p.valor) - case when p.forma = 'dinheiro' then coalesce((select sum(troco) from hoje), 0) else 0 end valor
                  from public.venda_pagamentos p join hoje h on h.id = p.venda_id group by p.forma) f), '{}'::jsonb),
    'mais_vendidos', coalesce((select jsonb_agg(m) from (
                select descricao, sum(quantidade) quantidade, sum(total) total
                  from itens group by descricao order by sum(total) desc limit 5) m), '[]'::jsonb),
    'estoque_baixo', coalesce((select jsonb_agg(e) from (
                select id, descricao, estoque_atual, estoque_minimo, unidade from public.produtos
                 where ativo and estoque_atual <= estoque_minimo order by estoque_atual - estoque_minimo limit 8) e), '[]'::jsonb),
    'qtd_estoque_baixo', (select count(*) from public.produtos where ativo and estoque_atual <= estoque_minimo),
    'sem_ncm', (select count(*) from public.produtos where ativo and (ncm is null or length(ncm) <> 8)),
    'produtos_ativos', (select count(*) from public.produtos where ativo),
    'nfce', jsonb_build_object(
      'autorizadas', (select count(*) from public.nfce_documentos d join hoje h on h.id = d.venda_id where d.status = 'autorizada'),
      'pendentes', (select count(*) from public.nfce_documentos where status in ('pendente','rejeitada','contingencia')),
      'sem_nota', (select count(*) from hoje h where not exists (select 1 from public.nfce_documentos d where d.venda_id = h.id and d.status = 'autorizada'))),
    'caixas_abertos', (select count(*) from public.caixas where status = 'aberto'),
    'ultimas', coalesce((select jsonb_agg(u) from (
                select id, numero, total, criado_em from hoje order by criado_em desc limit 6) u), '[]'::jsonb)
  )
$$;
revoke execute on function public.painel_dia(date) from public, anon;
grant execute on function public.painel_dia(date) to authenticated;
