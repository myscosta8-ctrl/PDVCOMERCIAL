-- =====================================================================
-- Grupo B: tabelas de preço, promoções e grade de tamanho e cor.
-- O preço de cada item é calculado no banco (menor entre base, tabela e promoções vigentes).
-- =====================================================================

-- ---------------------------------------------------------------------
-- Tabelas de preço (ex.: atacado, revendedor): ajuste percentual e/ou preço fixo por produto
-- ---------------------------------------------------------------------
create table public.tabelas_preco (
  id          uuid primary key default gen_random_uuid(),
  empresa_id  uuid not null references public.empresas(id),
  nome        text not null,
  ajuste_percentual numeric(6,2) not null default 0 check (ajuste_percentual > -100),
  ativo       boolean not null default true,
  criado_em   timestamptz not null default now(),
  unique (empresa_id, nome)
);
create table public.tabela_preco_itens (
  id          uuid primary key default gen_random_uuid(),
  empresa_id  uuid not null references public.empresas(id),
  tabela_id   uuid not null references public.tabelas_preco(id) on delete cascade,
  produto_id  uuid not null references public.produtos(id),
  preco       numeric(12,2) not null check (preco >= 0),
  unique (tabela_id, produto_id)
);
alter table public.clientes add column if not exists tabela_preco_id uuid references public.tabelas_preco(id);

-- ---------------------------------------------------------------------
-- Promoções: preço promocional, desconto percentual (produtos ou categoria) e preço por quantidade
-- ---------------------------------------------------------------------
create table public.promocoes (
  id           uuid primary key default gen_random_uuid(),
  empresa_id   uuid not null references public.empresas(id),
  nome         text not null,
  tipo         text not null check (tipo in ('preco','percentual','quantidade')),
  inicio       date not null,
  fim          date not null,
  percentual   numeric(5,2) check (percentual is null or (percentual > 0 and percentual < 100)),
  categoria_id uuid references public.categorias(id),
  ativo        boolean not null default true,
  criado_em    timestamptz not null default now(),
  check (fim >= inicio),
  check (tipo <> 'percentual' or percentual is not null)
);
create table public.promocao_itens (
  id                 uuid primary key default gen_random_uuid(),
  empresa_id         uuid not null references public.empresas(id),
  promocao_id        uuid not null references public.promocoes(id) on delete cascade,
  produto_id         uuid not null references public.produtos(id),
  preco              numeric(12,2) check (preco is null or preco >= 0),
  quantidade_minima  numeric(14,3) not null default 1 check (quantidade_minima > 0),
  unique (promocao_id, produto_id, quantidade_minima)
);

-- Origem do preço gravada no item vendido
alter table public.venda_itens
  add column if not exists preco_base numeric(12,2),
  add column if not exists preco_origem text,
  add column if not exists promocao_id uuid references public.promocoes(id);

-- ---------------------------------------------------------------------
-- Grade: produto modelo (não vendável) + variações com tamanho e cor
-- ---------------------------------------------------------------------
alter table public.produtos
  add column if not exists e_grade boolean not null default false,
  add column if not exists produto_pai_id uuid references public.produtos(id),
  add column if not exists atributos jsonb not null default '{}'::jsonb;
create index if not exists produtos_pai on public.produtos(produto_pai_id) where produto_pai_id is not null;

do $$
declare t text;
begin
  foreach t in array array['tabelas_preco','tabela_preco_itens','promocoes','promocao_itens']
  loop
    execute format('create trigger %I before insert or update on public.%I for each row execute function public.fixar_empresa()', t || '_empresa', t);
    execute format('alter table public.%I enable row level security', t);
    execute format('create policy %I on public.%I for select using (empresa_id = public.auth_empresa_id())', t || '_select', t);
    execute format('create policy %I on public.%I for insert with check (public.auth_papel() in (''administrador'',''gerente''))', t || '_insert', t);
    execute format('create policy %I on public.%I for update using (empresa_id = public.auth_empresa_id() and public.auth_papel() in (''administrador'',''gerente''))', t || '_update', t);
    execute format('create policy %I on public.%I for delete using (empresa_id = public.auth_empresa_id() and public.auth_papel() in (''administrador'',''gerente''))', t || '_delete', t);
  end loop;
end $$;

-- ---------------------------------------------------------------------
-- Preço vigente de um produto: menor entre base, tabela do cliente e promoções do dia
-- ---------------------------------------------------------------------
create or replace function public.preco_vigente(p_produto uuid, p_quantidade numeric default 1, p_tabela uuid default null)
returns jsonb language plpgsql stable security invoker set search_path = public as $$
declare
  pr public.produtos; v_hoje date := (now() at time zone 'America/Sao_Paulo')::date;
  v_preco numeric; v_origem text := 'base'; v_promo uuid; v_nome text; r record; v_tab public.tabelas_preco; v_tp numeric;
begin
  select * into pr from public.produtos where id = p_produto;
  if not found then return null; end if;
  v_preco := pr.preco_venda;

  if p_tabela is not null then
    select * into v_tab from public.tabelas_preco where id = p_tabela and ativo;
    if found then
      select preco into v_tp from public.tabela_preco_itens where tabela_id = v_tab.id and produto_id = pr.id;
      v_tp := coalesce(v_tp, case when v_tab.ajuste_percentual <> 0 then round(pr.preco_venda * (1 + v_tab.ajuste_percentual / 100), 2) end);
      if v_tp is not null and v_tp < v_preco then v_preco := v_tp; v_origem := 'tabela'; v_nome := v_tab.nome; end if;
    end if;
  end if;

  for r in
    select p.id, p.nome,
           case when p.tipo = 'percentual' then round(pr.preco_venda * (1 - p.percentual / 100), 2) else i.preco end as preco
      from public.promocoes p
      left join public.promocao_itens i on i.promocao_id = p.id and i.produto_id = pr.id
     where p.ativo and v_hoje between p.inicio and p.fim
       and (
         (p.tipo in ('preco','quantidade') and i.preco is not null and i.quantidade_minima <= coalesce(p_quantidade, 1))
         or (p.tipo = 'percentual' and (i.id is not null or (p.categoria_id is not null and p.categoria_id = pr.categoria_id)))
       )
  loop
    if r.preco is not null and r.preco < v_preco then
      v_preco := r.preco; v_origem := 'promocao'; v_promo := r.id; v_nome := r.nome;
    end if;
  end loop;

  return jsonb_build_object('produto_id', pr.id, 'preco', v_preco, 'preco_base', pr.preco_venda, 'origem', v_origem,
                            'promocao_id', v_promo, 'nome', v_nome);
end $$;

-- Vários itens de uma vez (para a frente de caixa): [{produto_id, quantidade}]
create or replace function public.precos_itens(p_itens jsonb, p_tabela uuid default null)
returns jsonb language sql stable security invoker set search_path = public as $$
  select coalesce(jsonb_agg(public.preco_vigente((x->>'produto_id')::uuid, coalesce((x->>'quantidade')::numeric, 1), p_tabela) order by n), '[]'::jsonb)
    from jsonb_array_elements(p_itens) with ordinality as t(x, n)
$$;
grant execute on function public.preco_vigente(uuid, numeric, uuid), public.precos_itens(jsonb, uuid) to authenticated;
revoke execute on function public.preco_vigente(uuid, numeric, uuid), public.precos_itens(jsonb, uuid) from anon, public;

-- ---------------------------------------------------------------------
-- Geração da grade (gerente/administrador): cria as variações que faltam
-- ---------------------------------------------------------------------
create or replace function public.gerar_grade(p_pai uuid, p_tamanhos text[], p_cores text[])
returns integer language plpgsql security definer set search_path = public as $$
declare v_emp uuid := public.auth_empresa_id(); pai public.produtos; t text; c text; n int := 0; v_attr jsonb;
begin
  if public.auth_papel() not in ('administrador','gerente') then raise exception 'Sem permissão'; end if;
  select * into pai from public.produtos where id = p_pai and empresa_id = v_emp;
  if not found then raise exception 'Produto não encontrado'; end if;
  if pai.produto_pai_id is not null then raise exception 'Uma variação não pode ter grade própria'; end if;
  if pai.e_kit then raise exception 'Kit não pode ter grade'; end if;
  if exists (select 1 from public.movimentos_estoque where produto_id = p_pai) and not pai.e_grade then
    raise exception 'O produto já tem movimentação de estoque; cadastre a grade em um produto novo';
  end if;
  if coalesce(array_length(p_tamanhos, 1), 0) = 0 and coalesce(array_length(p_cores, 1), 0) = 0 then
    raise exception 'Informe ao menos um tamanho ou uma cor';
  end if;
  update public.produtos set e_grade = true, controla_lote = false where id = p_pai;
  foreach t in array coalesce(nullif(p_tamanhos, '{}'), array[null::text]) loop
    foreach c in array coalesce(nullif(p_cores, '{}'), array[null::text]) loop
      v_attr := jsonb_strip_nulls(jsonb_build_object('tamanho', nullif(trim(t), ''), 'cor', nullif(trim(c), '')));
      if not exists (select 1 from public.produtos where produto_pai_id = p_pai and atributos = v_attr) then
        insert into public.produtos(empresa_id, descricao, unidade, preco_venda, preco_custo, markup, categoria_id, ncm, cest, cfop,
                                    origem, csosn, cst_icms, aliquota_icms, produto_pai_id, atributos, estoque_minimo)
        values (v_emp, trim(pai.descricao || coalesce(' ' || (v_attr->>'cor'), '') || coalesce(' ' || (v_attr->>'tamanho'), '')),
                pai.unidade, pai.preco_venda, pai.preco_custo, pai.markup, pai.categoria_id, pai.ncm, pai.cest, pai.cfop,
                pai.origem, pai.csosn, pai.cst_icms, pai.aliquota_icms, p_pai, v_attr, pai.estoque_minimo);
        n := n + 1;
      end if;
    end loop;
  end loop;
  return n;
end $$;
grant execute on function public.gerar_grade(uuid, text[], text[]) to authenticated;
revoke execute on function public.gerar_grade(uuid, text[], text[]) from anon, public;

-- Produto modelo da grade não tem estoque nem entra em nota
create or replace function public.bloquear_estoque_modelo()
returns trigger language plpgsql set search_path = public as $$
begin
  if exists (select 1 from public.produtos where id = new.produto_id and (e_grade or e_kit)) then
    raise exception 'Este produto não tem estoque próprio (kit ou modelo de grade)';
  end if;
  return new;
end $$;
revoke execute on function public.bloquear_estoque_modelo() from public, anon, authenticated;
create trigger movimentos_bloqueia_modelo before insert on public.movimentos_estoque
  for each row execute function public.bloquear_estoque_modelo();

-- ---------------------------------------------------------------------
-- Finalização de venda com tabela de preço e promoções
-- Item: {produto_id, quantidade, preco_unitario?, desconto?, lote_id?}
-- ---------------------------------------------------------------------
drop function if exists public.finalizar_venda(uuid, jsonb, jsonb, numeric, uuid, text);
create or replace function public.finalizar_venda(
  p_caixa uuid, p_itens jsonb, p_pagamentos jsonb,
  p_desconto numeric default 0, p_cliente uuid default null, p_cpf text default null, p_tabela uuid default null)
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
grant execute on function public.finalizar_venda(uuid, jsonb, jsonb, numeric, uuid, text, uuid) to authenticated;
revoke execute on function public.finalizar_venda(uuid, jsonb, jsonb, numeric, uuid, text, uuid) from anon, public;

-- Nota de entrada não pode apontar para modelo de grade
create or replace function public.bloquear_nota_modelo()
returns trigger language plpgsql set search_path = public as $$
begin
  if exists (select 1 from public.produtos where id = new.produto_id and e_grade) then
    raise exception 'Vincule a nota a uma variação (tamanho/cor), não ao modelo da grade';
  end if;
  return new;
end $$;
revoke execute on function public.bloquear_nota_modelo() from public, anon, authenticated;
create trigger notas_itens_bloqueia_modelo before insert on public.notas_entrada_itens
  for each row execute function public.bloquear_nota_modelo();
