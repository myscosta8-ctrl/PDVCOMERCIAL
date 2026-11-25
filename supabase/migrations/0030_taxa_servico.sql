-- Taxa de serviço em mesas e comandas (gorjeta, Lei 13.419/2017): percentual configurado pela empresa,
-- opcional para o cliente (o caixa tira na hora de fechar). Soma ao total pago, mas não sai na NFC-e
-- (não é mercadoria) e não entra no faturamento dos relatórios.

alter table public.empresas add column if not exists taxa_servico numeric(5,2) not null default 0;
do $$ begin
  alter table public.empresas add constraint empresas_taxa_servico check (taxa_servico between 0 and 20);
exception when duplicate_object then null; end $$;
alter table public.vendas add column if not exists taxa_servico numeric(12,2) not null default 0;

create or replace function public.finalizar_venda(
  p_caixa uuid, p_itens jsonb, p_pagamentos jsonb,
  p_desconto numeric default 0, p_cliente uuid default null, p_cpf text default null, p_tabela uuid default null,
  p_receitas jsonb default null)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_emp uuid := public.auth_empresa_id();
  v_papel text := public.auth_papel();
  v_venda uuid; v_num bigint; v_seq smallint := 0; v_item uuid;
  v_sub numeric := 0; v_total numeric; v_pago numeric := 0; v_dinheiro numeric := 0; v_troco numeric;
  it jsonb; pg jsonb; pr public.produtos; v_qtd numeric; v_preco numeric; v_desc numeric; v_vig jsonb;
  v_cli public.clientes; v_sit jsonb; v_conv public.convenios; v_tabela uuid;
  v_forma text; v_valor numeric; v_np int; v_venc date; v_parc numeric; i int;
  v_hoje date := (now() at time zone 'America/Sao_Paulo')::date;
  v_a_prazo numeric := 0;
  v_txid text;
  -- Taxa de serviço (mesas e comandas): percentual informado pelo fechamento da comanda
  v_pct_taxa numeric := coalesce(nullif(current_setting('pdv.taxa_servico', true), '')::numeric, 0);
  v_taxa numeric := 0;
begin
  if v_emp is null then raise exception 'Usuário sem empresa vinculada'; end if;
  if not exists (select 1 from public.caixas where id = p_caixa and empresa_id = v_emp and status = 'aberto') then
    raise exception 'Caixa não está aberto';
  end if;
  if jsonb_array_length(coalesce(p_itens,'[]')) = 0 then raise exception 'Venda sem itens'; end if;
  if coalesce(p_desconto,0) < 0 then raise exception 'Desconto inválido'; end if;
  if p_cliente is not null then
    select * into v_cli from public.clientes where id = p_cliente and empresa_id = v_emp and ativo;
    if not found then raise exception 'Cliente não encontrado'; end if;
  end if;
  -- Tabela informada ou a do cliente
  v_tabela := coalesce(p_tabela, v_cli.tabela_preco_id);
  if v_tabela is not null and not exists (select 1 from public.tabelas_preco where id = v_tabela and empresa_id = v_emp and ativo) then
    raise exception 'Tabela de preço inválida';
  end if;

  v_num := public.proximo_numero(v_emp, 'venda');
  insert into public.vendas(empresa_id, caixa_id, numero, cliente_id, cpf_consumidor, subtotal, desconto, total, operador_id)
  values (v_emp, p_caixa, v_num, p_cliente, coalesce(nullif(p_cpf,''), nullif(v_cli.cpf_cnpj,'')), 0, 0, 0, auth.uid())
  returning id into v_venda;

  for it in select * from jsonb_array_elements(p_itens) loop
    select * into pr from public.produtos where id = (it->>'produto_id')::uuid and empresa_id = v_emp and ativo;
    if not found then raise exception 'Produto não encontrado'; end if;
    if pr.e_grade then raise exception 'Escolha o tamanho e a cor de %', pr.descricao; end if;
    v_qtd := (it->>'quantidade')::numeric;
    if v_qtd is null or v_qtd <= 0 then raise exception 'Quantidade inválida para %', pr.descricao; end if;
    v_vig := public.preco_vigente(pr.id, v_qtd, v_tabela);
    v_preco := coalesce((it->>'preco_unitario')::numeric, (v_vig->>'preco')::numeric);
    -- Preço combinado na ordem de serviço: a conferência é feita pela função de fechamento da OS
    if v_preco <> (v_vig->>'preco')::numeric and v_papel = 'operador' and coalesce(current_setting('pdv.preco_os', true), '') <> 'sim' then
      raise exception 'Preço de % mudou ou exige gerente (vigente %).', pr.descricao, to_char((v_vig->>'preco')::numeric, 'FM999G999G990D00');
    end if;
    v_desc := coalesce((it->>'desconto')::numeric, 0);
    if v_desc < 0 or v_desc > v_qtd * v_preco then raise exception 'Desconto inválido em %', pr.descricao; end if;
    v_seq := v_seq + 1;
    insert into public.venda_itens(empresa_id, venda_id, sequencia, produto_id, descricao, quantidade, preco_unitario, desconto, total,
                                   preco_base, preco_origem, promocao_id)
    values (v_emp, v_venda, v_seq, pr.id, pr.descricao, v_qtd, v_preco, v_desc, round(v_qtd * v_preco - v_desc, 2),
            pr.preco_venda,
            case when v_preco = (v_vig->>'preco')::numeric then v_vig->>'origem' else 'manual' end,
            case when v_preco = (v_vig->>'preco')::numeric then (v_vig->>'promocao_id')::uuid end)
    returning id into v_item;
    perform public.baixar_item_venda(v_emp, v_venda, v_item, pr, v_qtd, (it->>'lote_id')::uuid);
    v_sub := v_sub + round(v_qtd * v_preco - v_desc, 2);
  end loop;

  -- Medicamentos controlados: exige receita para cada produto controlado vendido (inclusive dentro de kit)
  perform public.registrar_receitas(v_emp, v_venda, p_receitas);

  v_total := round(v_sub - coalesce(p_desconto,0), 2);
  if v_total < 0 then raise exception 'Desconto maior que o total'; end if;
  if v_pct_taxa > 0 then
    v_taxa := round(v_total * v_pct_taxa / 100, 2);
    v_total := v_total + v_taxa;
  end if;

  for pg in select * from jsonb_array_elements(coalesce(p_pagamentos,'[]')) loop
    v_forma := pg->>'forma';
    v_valor := round((pg->>'valor')::numeric, 2);
    if v_valor is null or v_valor <= 0 then raise exception 'Valor de pagamento inválido'; end if;

    if v_forma in ('crediario','convenio','vale') then
      if p_cliente is null then raise exception 'Identifique o cliente para receber em %', v_forma; end if;
      if v_cli.bloqueado then raise exception 'Cliente bloqueado para venda a prazo'; end if;
      v_sit := public.situacao_cliente(p_cliente);
    end if;

    if v_forma = 'crediario' then
      if (v_sit->>'em_atraso')::numeric > 0 and v_papel = 'operador' then
        raise exception 'Cliente com parcelas em atraso: venda no crediário exige gerente';
      end if;
      if v_valor + v_a_prazo > (v_sit->>'disponivel')::numeric then
        raise exception 'Limite de crédito insuficiente (disponível %)', to_char((v_sit->>'disponivel')::numeric, 'FM999G999G990D00');
      end if;
      v_a_prazo := v_a_prazo + v_valor;
      v_np := greatest(1, least(24, coalesce((pg->>'parcelas')::int, 1)));
      v_venc := coalesce((pg->>'primeiro_vencimento')::date, v_hoje + 30);
      if v_venc < v_hoje then raise exception 'Primeiro vencimento no passado'; end if;
      for i in 1..v_np loop
        v_parc := case when i < v_np then trunc(v_valor / v_np, 2) else v_valor - trunc(v_valor / v_np, 2) * (v_np - 1) end;
        insert into public.contas_receber(empresa_id, cliente_id, venda_id, origem, parcela, parcelas, valor, vencimento)
        values (v_emp, p_cliente, v_venda, 'crediario', i, v_np, v_parc, (v_venc + make_interval(months => i - 1))::date);
      end loop;
    elsif v_forma = 'convenio' then
      select * into v_conv from public.convenios where id = v_cli.convenio_id and ativo;
      if not found then raise exception 'Cliente sem convênio ativo'; end if;
      insert into public.contas_receber(empresa_id, cliente_id, venda_id, origem, valor, vencimento)
      values (v_emp, p_cliente, v_venda, 'convenio', v_valor, public.vencimento_convenio(v_conv.dia_fechamento, v_conv.dias_vencimento, v_hoje));
    elsif v_forma = 'vale' then
      if v_valor > (v_sit->>'vale')::numeric then raise exception 'Saldo de vale-troca insuficiente'; end if;
      insert into public.creditos_cliente(empresa_id, cliente_id, valor, origem, referencia_id)
      values (v_emp, p_cliente, -v_valor, 'venda', v_venda);
    end if;

    -- Cartão na maquininha: bandeira, autorização e NSU vão para a NFC-e (grupo card)
    if v_forma in ('debito','credito') and nullif(pg->>'bandeira','') is not null
       and (pg->>'bandeira') !~ '^(0[1-9]|1[0-9]|2[0-7]|99)$' then
      raise exception 'Bandeira do cartão inválida';
    end if;
    -- PIX dinâmico: a cobrança precisa estar paga no banco, com o mesmo valor, e não pode ser usada duas vezes
    v_txid := nullif(pg->>'pix_txid','');
    if v_txid is not null then
      if v_forma <> 'pix' then raise exception 'Cobrança PIX informada em outra forma de pagamento'; end if;
      update public.pix_cobrancas set venda_id = v_venda
       where empresa_id = v_emp and txid = v_txid and status = 'concluida' and venda_id is null and valor = v_valor;
      if not found then raise exception 'A cobrança PIX % não está paga, tem outro valor ou já foi usada', v_txid; end if;
    end if;
    insert into public.venda_pagamentos(empresa_id, venda_id, forma, valor, autorizacao, bandeira, nsu, credenciadora_cnpj, pix_txid)
    values (v_emp, v_venda, v_forma, v_valor, nullif(left(pg->>'autorizacao', 20),''),
            case when v_forma in ('debito','credito') then nullif(pg->>'bandeira','') end,
            case when v_forma in ('debito','credito') then nullif(left(pg->>'nsu', 20),'') end,
            case when v_forma in ('debito','credito') then nullif(regexp_replace(coalesce(pg->>'credenciadora_cnpj',''), '\D', '', 'g'),'') end,
            v_txid);
    v_pago := v_pago + v_valor;
    if v_forma = 'dinheiro' then v_dinheiro := v_dinheiro + v_valor; end if;
  end loop;
  if v_pago < v_total then raise exception 'Pagamento insuficiente'; end if;
  v_troco := v_pago - v_total;
  if v_troco > v_dinheiro then raise exception 'Troco só pode sair de pagamento em dinheiro'; end if;

  update public.vendas set subtotal = v_sub, desconto = coalesce(p_desconto,0), total = v_total, troco = v_troco, taxa_servico = v_taxa where id = v_venda;
  return jsonb_build_object('venda_id', v_venda, 'numero', v_num, 'total', v_total, 'troco', v_troco, 'taxa_servico', v_taxa);
end $$;
grant execute on function public.finalizar_venda(uuid, jsonb, jsonb, numeric, uuid, text, uuid, jsonb) to authenticated;
revoke execute on function public.finalizar_venda(uuid, jsonb, jsonb, numeric, uuid, text, uuid, jsonb) from anon, public;


-- Fechamento da comanda: p_taxa_servico = true cobra a taxa configurada pela empresa
drop function if exists public.fechar_comanda(uuid, uuid, jsonb, jsonb, numeric, uuid, text, uuid, jsonb);
create or replace function public.fechar_comanda(
  p_comanda uuid, p_caixa uuid, p_pagamentos jsonb, p_itens jsonb default null,
  p_desconto numeric default 0, p_cliente uuid default null, p_cpf text default null, p_tabela uuid default null,
  p_receitas jsonb default null, p_taxa_servico boolean default false)
returns jsonb language plpgsql security definer set search_path = public as $$
declare c public.comandas; v_itens jsonb; r jsonb; v_pct numeric := 0;
begin
  select * into c from public.comandas where id = p_comanda and empresa_id = public.auth_empresa_id() for update;
  if not found then raise exception 'Comanda não encontrada'; end if;
  if c.status <> 'aberta' then raise exception 'A comanda nº % não está aberta', c.numero; end if;
  select jsonb_agg(jsonb_build_object('produto_id', produto_id, 'quantidade', q)) into v_itens
    from (select produto_id, sum(quantidade) q from public.comanda_itens where comanda_id = c.id and status <> 'cancelado' group by produto_id) x;
  if v_itens is null then raise exception 'A comanda não tem itens. Cancele a comanda em vez de fechar.'; end if;
  if p_taxa_servico then
    select taxa_servico into v_pct from public.empresas where id = c.empresa_id;
    if coalesce(v_pct, 0) <= 0 then raise exception 'A taxa de serviço não está configurada'; end if;
  end if;
  perform set_config('pdv.taxa_servico', v_pct::text, true);
  r := public.finalizar_venda(p_caixa, v_itens, p_pagamentos, p_desconto, p_cliente, p_cpf, p_tabela, p_receitas);
  perform set_config('pdv.taxa_servico', '', true);
  update public.comandas set status = 'fechada', fechada_em = now(), venda_id = (r->>'venda_id')::uuid where id = c.id;
  update public.comanda_itens set status = 'entregue' where comanda_id = c.id and status in ('pendente','pronto');
  return r || jsonb_build_object('comanda', c.numero);
end $$;
revoke execute on function public.fechar_comanda(uuid, uuid, jsonb, jsonb, numeric, uuid, text, uuid, jsonb, boolean) from public, anon;
grant execute on function public.fechar_comanda(uuid, uuid, jsonb, jsonb, numeric, uuid, text, uuid, jsonb, boolean) to authenticated;

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
    -- Faturamento sem a taxa de serviço (repassada à equipe, não é receita da empresa)
    select x.*, (x.criado_em at time zone 'America/Sao_Paulo') local
      from public.vendas v0
     cross join lateral jsonb_populate_record(v0, jsonb_build_object('total', v0.total - v0.taxa_servico)) x
     where (v0.criado_em at time zone 'America/Sao_Paulo')::date between v_ant_ini and p_fim),
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
           (select count(distinct cliente_id) from atual where cliente_id is not null) clientes,
           (select coalesce(sum(taxa_servico), 0) from atual) taxa_servico),
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
