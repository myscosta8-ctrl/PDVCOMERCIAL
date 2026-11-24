-- Itens independentes de terceiros: medicamentos controlados (controle interno), PIX com QR fixo e etiqueta de balança.

-- =====================================================================
-- 1) Medicamentos controlados (Portaria SVS/MS 344/98 e antimicrobianos)
-- =====================================================================
alter table public.produtos
  add column if not exists lista_controle text check (lista_controle is null or lista_controle in ('A1','A2','A3','B1','B2','C1','C2','C3','C4','C5','AM')),
  add column if not exists codigo_balanca text;
create unique index if not exists produtos_codigo_balanca on public.produtos(empresa_id, codigo_balanca) where codigo_balanca is not null and codigo_balanca <> '';
update public.produtos set controlado = true where lista_controle is not null and not controlado;

create table public.receitas (
  id                  uuid primary key default gen_random_uuid(),
  empresa_id          uuid not null references public.empresas(id),
  venda_id            uuid not null references public.vendas(id),
  tipo                text not null check (tipo in ('notificacao_a','notificacao_b','notificacao_b2','notificacao_especial','controle_especial','antimicrobiano')),
  numero              text,
  data_emissao        date not null,
  prescritor_nome     text not null,
  prescritor_conselho text not null,
  prescritor_numero   text not null,
  prescritor_uf       char(2) not null,
  paciente_nome       text not null,
  paciente_idade      smallint,
  paciente_sexo       char(1) check (paciente_sexo is null or paciente_sexo in ('M','F')),
  comprador_nome      text not null,
  comprador_documento text not null,
  comprador_orgao     text,
  comprador_endereco  text,
  comprador_telefone  text,
  usuario_id          uuid not null default auth.uid(),
  criado_em           timestamptz not null default now()
);
create index on public.receitas(empresa_id, criado_em);
create table public.receita_itens (
  id            uuid primary key default gen_random_uuid(),
  empresa_id    uuid not null references public.empresas(id),
  receita_id    uuid not null references public.receitas(id),
  produto_id    uuid not null references public.produtos(id),
  lote_id       uuid references public.lotes(id),
  quantidade    numeric(14,3) not null
);
alter table public.receitas enable row level security;
alter table public.receita_itens enable row level security;
create policy receitas_select on public.receitas for select using (empresa_id = public.auth_empresa_id());
create policy receita_itens_select on public.receita_itens for select using (empresa_id = public.auth_empresa_id());

-- Valida e grava as receitas da venda. p_receitas: [{tipo, numero, data_emissao, prescritor_*, paciente_*, comprador_*, produtos:[uuid]}]
create or replace function public.registrar_receitas(p_emp uuid, p_venda uuid, p_receitas jsonb)
returns void language plpgsql security definer set search_path = public as $$
declare
  c record; r jsonb; v_rec uuid; v_tipo text; v_emissao date; v_validade int; v_cobre boolean;
  v_hoje date := (now() at time zone 'America/Sao_Paulo')::date;
begin
  for c in
    select m.produto_id, p.descricao, p.lista_controle, m.lote_id, sum(-m.quantidade) qtd
      from public.movimentos_estoque m join public.produtos p on p.id = m.produto_id
     where m.origem_id = p_venda and m.tipo = 'saida_venda' and m.empresa_id = p_emp and p.controlado
     group by 1, 2, 3, 4
  loop
    v_cobre := false;
    for r in select * from jsonb_array_elements(coalesce(p_receitas, '[]')) loop
      if not (coalesce(r->'produtos', '[]') ? c.produto_id::text) then continue; end if;
      v_cobre := true;
      v_tipo := r->>'tipo';
      -- Tipo de receita compatível com a lista da Portaria 344
      if c.lista_controle is not null and not (
           (c.lista_controle in ('A1','A2','A3') and v_tipo = 'notificacao_a') or
           (c.lista_controle = 'B1' and v_tipo = 'notificacao_b') or
           (c.lista_controle = 'B2' and v_tipo = 'notificacao_b2') or
           (c.lista_controle in ('C2','C3') and v_tipo = 'notificacao_especial') or
           (c.lista_controle in ('C1','C4','C5') and v_tipo = 'controle_especial') or
           (c.lista_controle = 'AM' and v_tipo = 'antimicrobiano')) then
        raise exception 'Tipo de receita não serve para % (lista %)', c.descricao, c.lista_controle;
      end if;
    end loop;
    if not v_cobre then raise exception 'Informe a receita de % (medicamento controlado)', c.descricao; end if;
  end loop;

  for r in select * from jsonb_array_elements(coalesce(p_receitas, '[]')) loop
    v_tipo := r->>'tipo';
    if v_tipo not in ('notificacao_a','notificacao_b','notificacao_b2','notificacao_especial','controle_especial','antimicrobiano') then
      raise exception 'Tipo de receita inválido';
    end if;
    v_emissao := (r->>'data_emissao')::date;
    v_validade := case v_tipo when 'antimicrobiano' then 10 else 30 end;
    if v_emissao is null or v_emissao > v_hoje then raise exception 'Data da receita inválida'; end if;
    if v_emissao < v_hoje - v_validade then raise exception 'Receita vencida: validade de % dias a partir da emissão', v_validade; end if;
    if v_tipo like 'notificacao%' and nullif(trim(r->>'numero'), '') is null then raise exception 'Informe o número da notificação de receita'; end if;
    if nullif(trim(r->>'prescritor_nome'), '') is null or nullif(trim(r->>'prescritor_numero'), '') is null
       or nullif(trim(r->>'prescritor_conselho'), '') is null or (r->>'prescritor_uf') !~ '^[A-Z]{2}$' then
      raise exception 'Informe nome, conselho, número e UF do prescritor';
    end if;
    if nullif(trim(r->>'paciente_nome'), '') is null then raise exception 'Informe o nome do paciente'; end if;
    if v_tipo = 'antimicrobiano' and (nullif(r->>'paciente_idade', '') is null or r->>'paciente_sexo' not in ('M','F')) then
      raise exception 'Antimicrobiano: informe idade e sexo do paciente';
    end if;
    if nullif(trim(r->>'comprador_nome'), '') is null or nullif(trim(r->>'comprador_documento'), '') is null then
      raise exception 'Informe nome e documento do comprador';
    end if;
    insert into public.receitas(empresa_id, venda_id, tipo, numero, data_emissao, prescritor_nome, prescritor_conselho, prescritor_numero, prescritor_uf,
                                paciente_nome, paciente_idade, paciente_sexo, comprador_nome, comprador_documento, comprador_orgao, comprador_endereco, comprador_telefone)
    values (p_emp, p_venda, v_tipo, nullif(trim(r->>'numero'), ''), v_emissao, trim(r->>'prescritor_nome'), upper(trim(r->>'prescritor_conselho')),
            trim(r->>'prescritor_numero'), r->>'prescritor_uf', trim(r->>'paciente_nome'), nullif(r->>'paciente_idade', '')::smallint,
            nullif(r->>'paciente_sexo', ''), trim(r->>'comprador_nome'), trim(r->>'comprador_documento'), nullif(trim(r->>'comprador_orgao'), ''),
            nullif(trim(r->>'comprador_endereco'), ''), nullif(trim(r->>'comprador_telefone'), ''))
    returning id into v_rec;
    insert into public.receita_itens(empresa_id, receita_id, produto_id, lote_id, quantidade)
    select p_emp, v_rec, m.produto_id, m.lote_id, sum(-m.quantidade)
      from public.movimentos_estoque m
     where m.origem_id = p_venda and m.tipo = 'saida_venda' and m.empresa_id = p_emp
       and coalesce(r->'produtos', '[]') ? m.produto_id::text
     group by 3, 4;
  end loop;
end $$;
revoke execute on function public.registrar_receitas(uuid, uuid, jsonb) from public, anon, authenticated;

-- Venda passa a receber as receitas
drop function if exists public.finalizar_venda(uuid, jsonb, jsonb, numeric, uuid, text, uuid);
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
    if v_preco <> (v_vig->>'preco')::numeric and v_papel = 'operador' then
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

    insert into public.venda_pagamentos(empresa_id, venda_id, forma, valor, autorizacao)
    values (v_emp, v_venda, v_forma, v_valor, pg->>'autorizacao');
    v_pago := v_pago + v_valor;
    if v_forma = 'dinheiro' then v_dinheiro := v_dinheiro + v_valor; end if;
  end loop;
  if v_pago < v_total then raise exception 'Pagamento insuficiente'; end if;
  v_troco := v_pago - v_total;
  if v_troco > v_dinheiro then raise exception 'Troco só pode sair de pagamento em dinheiro'; end if;

  update public.vendas set subtotal = v_sub, desconto = coalesce(p_desconto,0), total = v_total, troco = v_troco where id = v_venda;
  return jsonb_build_object('venda_id', v_venda, 'numero', v_num, 'total', v_total, 'troco', v_troco);
end $$;
grant execute on function public.finalizar_venda(uuid, jsonb, jsonb, numeric, uuid, text, uuid, jsonb) to authenticated;
revoke execute on function public.finalizar_venda(uuid, jsonb, jsonb, numeric, uuid, text, uuid, jsonb) from anon, public;

-- Livro de registro: movimentos dos controlados no período, com saldo
create or replace function public.livro_controlados(p_inicio date, p_fim date, p_produto uuid default null)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare v_emp uuid := public.auth_empresa_id();
begin
  if public.auth_papel() not in ('administrador','gerente') then raise exception 'Somente gerente ou administrador'; end if;
  return (
    with prods as (
      select p.id, p.descricao, p.lista_controle, p.registro_ms, p.unidade,
             p.estoque_atual - coalesce((select sum(m.quantidade) from public.movimentos_estoque m
                                          where m.produto_id = p.id and (m.criado_em at time zone 'America/Sao_Paulo')::date >= p_inicio), 0) inicial
        from public.produtos p
       where p.empresa_id = v_emp and p.controlado and (p_produto is null or p.id = p_produto)),
    movs as (
      select m.produto_id, m.criado_em, m.tipo, m.quantidade, l.numero lote, l.validade,
             case
               when m.tipo = 'entrada' then (select 'NF-e ' || n.numero || ', ' || f.razao_social from public.notas_entrada n join public.fornecedores f on f.id = n.fornecedor_id where n.id = m.origem_id)
               when m.tipo in ('saida_venda','estorno_venda') then (select 'Venda ' || v.numero || coalesce(' — receita ' || coalesce(r.numero, 'sem nº') || ', ' || r.prescritor_conselho || ' ' || r.prescritor_numero || '/' || r.prescritor_uf
                                                                         || ', comprador ' || r.comprador_nome, '')
                                                                    from public.vendas v left join lateral (
                                                                      select r2.* from public.receitas r2 join public.receita_itens ri on ri.receita_id = r2.id
                                                                       where r2.venda_id = v.id and ri.produto_id = m.produto_id limit 1) r on true
                                                                   where v.id = m.origem_id)
               when m.tipo = 'devolucao' then 'Devolução de cliente'
               when m.tipo = 'inventario' then coalesce(m.observacao, 'Inventário')
               when m.tipo like 'transferencia%' then coalesce(m.observacao, 'Transferência')
               else coalesce(m.observacao, m.tipo)
             end documento
        from public.movimentos_estoque m left join public.lotes l on l.id = m.lote_id
       where m.empresa_id = v_emp and m.produto_id in (select id from prods)
         and (m.criado_em at time zone 'America/Sao_Paulo')::date between p_inicio and p_fim)
    select coalesce(jsonb_agg(jsonb_build_object(
      'produto_id', p.id, 'descricao', p.descricao, 'lista', p.lista_controle, 'registro_ms', p.registro_ms, 'unidade', p.unidade,
      'inicial', p.inicial,
      'movimentos', coalesce((select jsonb_agg(jsonb_build_object('data', x.criado_em, 'tipo', x.tipo, 'quantidade', x.quantidade, 'lote', x.lote,
                                                                    'validade', x.validade, 'documento', x.documento,
                                                                    'saldo', p.inicial + x.acumulado) order by x.criado_em)
                                from (select mv.*, sum(mv.quantidade) over (order by mv.criado_em rows unbounded preceding) acumulado
                                        from movs mv where mv.produto_id = p.id) x), '[]')
    ) order by p.descricao), '[]') from prods p);
end $$;

-- Balanço do período por produto (base para o balanço de medicamentos psicoativos)
create or replace function public.balanco_controlados(p_inicio date, p_fim date)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare v_emp uuid := public.auth_empresa_id();
begin
  if public.auth_papel() not in ('administrador','gerente') then raise exception 'Somente gerente ou administrador'; end if;
  return (
    select coalesce(jsonb_agg(x order by x.descricao), '[]') from (
      select p.descricao, p.lista_controle lista, p.registro_ms, p.unidade,
             p.estoque_atual - coalesce(sum(m.quantidade) filter (where d >= p_inicio), 0) inicial,
             coalesce(sum(m.quantidade) filter (where d between p_inicio and p_fim and m.tipo in ('entrada','transferencia_entrada')), 0) entradas,
             coalesce(-sum(m.quantidade) filter (where d between p_inicio and p_fim and m.tipo in ('saida_venda','transferencia_saida')), 0)
               - coalesce(sum(m.quantidade) filter (where d between p_inicio and p_fim and m.tipo in ('estorno_venda','devolucao')), 0) saidas,
             coalesce(-sum(m.quantidade) filter (where d between p_inicio and p_fim and m.tipo = 'perda'), 0) perdas,
             coalesce(sum(m.quantidade) filter (where d between p_inicio and p_fim and m.tipo in ('ajuste','inventario')), 0) ajustes,
             p.estoque_atual - coalesce(sum(m.quantidade) filter (where d > p_fim), 0) final
        from public.produtos p
        left join lateral (select mm.*, (mm.criado_em at time zone 'America/Sao_Paulo')::date d from public.movimentos_estoque mm where mm.produto_id = p.id) m on true
       where p.empresa_id = v_emp and p.controlado
       group by p.id) x);
end $$;

-- =====================================================================
-- 2) PIX com QR Code fixo e 3) etiqueta de balança: configurações
-- =====================================================================
alter table public.empresas
  add column if not exists pix_chave text,
  add column if not exists pix_nome text,
  add column if not exists pix_cidade text,
  add column if not exists balanca jsonb not null default '{"ativo": false, "digitos_codigo": 5, "tipo": "preco"}'::jsonb;

grant execute on function public.livro_controlados(date, date, uuid), public.balanco_controlados(date, date) to authenticated;
revoke execute on function public.livro_controlados(date, date, uuid), public.balanco_controlados(date, date) from anon, public;
