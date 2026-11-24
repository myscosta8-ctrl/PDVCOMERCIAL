-- =====================================================================
-- Grupo A: entrada de mercadoria pelo XML da NF-e, lote e validade na venda,
-- kits de produtos e formação de preço (markup).
-- =====================================================================

alter table public.empresas add column if not exists markup_padrao numeric(7,2) not null default 30 check (markup_padrao >= 0);
alter table public.produtos
  add column if not exists e_kit boolean not null default false,
  add column if not exists markup numeric(7,2) check (markup is null or markup >= 0);

-- Movimento de estoque ligado ao item vendido (permite estornar exatamente o que saiu, inclusive kits e lotes)
alter table public.movimentos_estoque add column if not exists venda_item_id uuid references public.venda_itens(id);
create index if not exists movimentos_venda_item on public.movimentos_estoque(venda_item_id) where venda_item_id is not null;

-- ---------------------------------------------------------------------
-- Kits: o kit não tem estoque próprio; a venda baixa os componentes
-- ---------------------------------------------------------------------
create table public.kit_itens (
  id          uuid primary key default gen_random_uuid(),
  empresa_id  uuid not null references public.empresas(id),
  kit_id      uuid not null references public.produtos(id),
  produto_id  uuid not null references public.produtos(id),
  quantidade  numeric(14,3) not null check (quantidade > 0),
  unique (kit_id, produto_id),
  check (kit_id <> produto_id)
);

-- ---------------------------------------------------------------------
-- Fornecedores, vínculo de códigos e notas de entrada
-- ---------------------------------------------------------------------
create table public.fornecedores (
  id            uuid primary key default gen_random_uuid(),
  empresa_id    uuid not null references public.empresas(id),
  cnpj          text not null,
  razao_social  text not null,
  nome_fantasia text,
  inscricao_estadual text,
  uf            char(2),
  telefone      text,
  criado_em     timestamptz not null default now(),
  unique (empresa_id, cnpj)
);

-- Código do produto no fornecedor -> produto da loja, com fator de conversão (ex.: caixa com 12 = 12 unidades)
create table public.produto_fornecedor (
  id                 uuid primary key default gen_random_uuid(),
  empresa_id         uuid not null references public.empresas(id),
  fornecedor_id      uuid not null references public.fornecedores(id),
  codigo_fornecedor  text not null,
  produto_id         uuid not null references public.produtos(id),
  fator              numeric(12,4) not null default 1 check (fator > 0),
  unique (fornecedor_id, codigo_fornecedor)
);

create table public.notas_entrada (
  id              uuid primary key default gen_random_uuid(),
  empresa_id      uuid not null references public.empresas(id),
  fornecedor_id   uuid not null references public.fornecedores(id),
  chave           text not null check (chave ~ '^\d{44}$'),
  numero          bigint not null,
  serie           integer not null,
  emissao         timestamptz,
  valor_produtos  numeric(14,2) not null default 0,
  valor_total     numeric(14,2) not null default 0,
  duplicatas      jsonb not null default '[]'::jsonb,
  usuario_id      uuid not null default auth.uid(),
  criado_em       timestamptz not null default now(),
  unique (empresa_id, chave)
);

create table public.notas_entrada_itens (
  id                 uuid primary key default gen_random_uuid(),
  empresa_id         uuid not null references public.empresas(id),
  nota_id            uuid not null references public.notas_entrada(id),
  produto_id         uuid not null references public.produtos(id),
  codigo_fornecedor  text,
  descricao          text not null,
  quantidade         numeric(14,3) not null check (quantidade > 0),
  custo_unitario     numeric(12,4) not null,
  lote_id            uuid references public.lotes(id)
);

do $$
declare t text;
begin
  foreach t in array array['kit_itens','fornecedores','produto_fornecedor','notas_entrada','notas_entrada_itens']
  loop
    execute format('create trigger %I before insert or update on public.%I for each row execute function public.fixar_empresa()', t || '_empresa', t);
    execute format('alter table public.%I enable row level security', t);
    execute format('create policy %I on public.%I for select using (empresa_id = public.auth_empresa_id())', t || '_select', t);
  end loop;
  foreach t in array array['kit_itens','fornecedores','produto_fornecedor']
  loop
    execute format('create policy %I on public.%I for insert with check (public.auth_papel() in (''administrador'',''gerente''))', t || '_insert', t);
    execute format('create policy %I on public.%I for update using (empresa_id = public.auth_empresa_id() and public.auth_papel() in (''administrador'',''gerente''))', t || '_update', t);
  end loop;
end $$;
create policy kit_itens_delete on public.kit_itens for delete
  using (empresa_id = public.auth_empresa_id() and public.auth_papel() in ('administrador','gerente'));
-- notas de entrada: gravadas só pela função registrar_entrada_nfe

-- ---------------------------------------------------------------------
-- Lote: escolha automática pelo que vence primeiro (FEFO)
-- ---------------------------------------------------------------------
create or replace function public.lote_fefo(p_produto uuid)
returns uuid language sql stable set search_path = public as $$
  select id from public.lotes
   where produto_id = p_produto and quantidade > 0
     and (validade is null or validade >= (now() at time zone 'America/Sao_Paulo')::date)
   order by validade nulls last, criado_em
   limit 1
$$;

-- Entrada/ajuste manual de estoque, agora com lote e validade
drop function if exists public.lancar_estoque(uuid, text, numeric, uuid, numeric, text);
create or replace function public.lancar_estoque(p_produto uuid, p_tipo text, p_quantidade numeric,
                                                 p_lote uuid default null, p_custo numeric default null, p_obs text default null,
                                                 p_lote_numero text default null, p_validade date default null, p_fabricacao date default null)
returns uuid language plpgsql security definer set search_path = public as $$
declare v_emp uuid := public.auth_empresa_id(); v_id uuid; v_lote uuid := p_lote; v_prod public.produtos;
begin
  if public.auth_papel() not in ('administrador','gerente') then raise exception 'Sem permissão'; end if;
  if p_tipo not in ('entrada','ajuste','perda','inventario') then raise exception 'Tipo inválido'; end if;
  select * into v_prod from public.produtos where id = p_produto and empresa_id = v_emp;
  if not found then raise exception 'Produto não encontrado'; end if;
  if v_prod.e_kit then raise exception 'Kit não tem estoque próprio; movimente os componentes'; end if;
  if v_lote is not null and not exists (select 1 from public.lotes where id = v_lote and produto_id = p_produto) then
    raise exception 'Lote não pertence ao produto';
  end if;
  if v_lote is null and nullif(trim(p_lote_numero), '') is not null then
    insert into public.lotes(empresa_id, produto_id, numero, validade, fabricacao)
    values (v_emp, p_produto, trim(p_lote_numero), p_validade, p_fabricacao)
    on conflict (produto_id, numero) do update set validade = coalesce(excluded.validade, public.lotes.validade)
    returning id into v_lote;
  end if;
  insert into public.movimentos_estoque(empresa_id, produto_id, lote_id, tipo, quantidade, custo_unitario, observacao, usuario_id)
  values (v_emp, p_produto, v_lote, p_tipo,
          case when p_tipo = 'perda' then -abs(p_quantidade) else p_quantidade end, p_custo, p_obs, auth.uid())
  returning id into v_id;
  if p_tipo = 'entrada' and p_custo is not null and p_custo > 0 then
    update public.produtos set preco_custo = p_custo where id = p_produto;
  end if;
  return v_id;
end $$;

-- ---------------------------------------------------------------------
-- Registro da nota de entrada (gerente/administrador)
-- p_nota: {chave, numero, serie, emissao, valor_produtos, valor_total, duplicatas,
--          fornecedor:{cnpj, razao_social, nome_fantasia, inscricao_estadual, uf, telefone},
--          itens:[{produto_id | novo_produto:{descricao, ean, ncm, cest, unidade, preco_venda},
--                  codigo_fornecedor, descricao, fator, quantidade, custo_unitario,
--                  lote?, validade?, fabricacao?, novo_preco_venda?}]}
-- quantidade e custo_unitario já convertidos para a unidade de estoque da loja
-- ---------------------------------------------------------------------
create or replace function public.registrar_entrada_nfe(p_nota jsonb)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_emp uuid := public.auth_empresa_id(); v_forn uuid; v_nota uuid; it jsonb; v_prod uuid; v_lote uuid;
  v_np jsonb; v_qtd numeric; v_custo numeric; n int := 0; novos int := 0;
begin
  if public.auth_papel() not in ('administrador','gerente') then raise exception 'Entrada de nota exige gerente ou administrador'; end if;
  if (p_nota->>'chave') !~ '^\d{44}$' then raise exception 'Chave de acesso inválida'; end if;
  if exists (select 1 from public.notas_entrada where empresa_id = v_emp and chave = p_nota->>'chave') then
    raise exception 'Esta nota já foi lançada';
  end if;
  if jsonb_array_length(coalesce(p_nota->'itens', '[]')) = 0 then raise exception 'Nota sem itens'; end if;

  insert into public.fornecedores(empresa_id, cnpj, razao_social, nome_fantasia, inscricao_estadual, uf, telefone)
  values (v_emp, p_nota->'fornecedor'->>'cnpj', p_nota->'fornecedor'->>'razao_social', p_nota->'fornecedor'->>'nome_fantasia',
          p_nota->'fornecedor'->>'inscricao_estadual', p_nota->'fornecedor'->>'uf', p_nota->'fornecedor'->>'telefone')
  on conflict (empresa_id, cnpj) do update set razao_social = excluded.razao_social,
       nome_fantasia = coalesce(excluded.nome_fantasia, public.fornecedores.nome_fantasia)
  returning id into v_forn;

  insert into public.notas_entrada(empresa_id, fornecedor_id, chave, numero, serie, emissao, valor_produtos, valor_total, duplicatas)
  values (v_emp, v_forn, p_nota->>'chave', (p_nota->>'numero')::bigint, coalesce((p_nota->>'serie')::int, 1),
          (p_nota->>'emissao')::timestamptz, coalesce((p_nota->>'valor_produtos')::numeric, 0),
          coalesce((p_nota->>'valor_total')::numeric, 0), coalesce(p_nota->'duplicatas', '[]'))
  returning id into v_nota;

  for it in select * from jsonb_array_elements(p_nota->'itens') loop
    v_qtd := (it->>'quantidade')::numeric;
    v_custo := round((it->>'custo_unitario')::numeric, 4);
    if v_qtd is null or v_qtd <= 0 then raise exception 'Quantidade inválida em %', it->>'descricao'; end if;
    if v_custo is null or v_custo < 0 then raise exception 'Custo inválido em %', it->>'descricao'; end if;

    if it ? 'novo_produto' then
      v_np := it->'novo_produto';
      insert into public.produtos(empresa_id, descricao, ean, ncm, cest, unidade, preco_custo, preco_venda, controla_lote)
      values (v_emp, v_np->>'descricao', nullif(v_np->>'ean', ''), nullif(v_np->>'ncm', ''), nullif(v_np->>'cest', ''),
              coalesce(nullif(v_np->>'unidade', ''), 'UN'), v_custo, coalesce((v_np->>'preco_venda')::numeric, 0),
              nullif(it->>'lote', '') is not null)
      returning id into v_prod;
      novos := novos + 1;
    else
      v_prod := (it->>'produto_id')::uuid;
      if not exists (select 1 from public.produtos where id = v_prod and empresa_id = v_emp and not e_kit) then
        raise exception 'Produto inválido para %', it->>'descricao';
      end if;
    end if;

    if nullif(it->>'codigo_fornecedor', '') is not null then
      insert into public.produto_fornecedor(empresa_id, fornecedor_id, codigo_fornecedor, produto_id, fator)
      values (v_emp, v_forn, it->>'codigo_fornecedor', v_prod, coalesce((it->>'fator')::numeric, 1))
      on conflict (fornecedor_id, codigo_fornecedor) do update set produto_id = excluded.produto_id, fator = excluded.fator;
    end if;

    v_lote := null;
    if nullif(trim(it->>'lote'), '') is not null then
      insert into public.lotes(empresa_id, produto_id, numero, validade, fabricacao)
      values (v_emp, v_prod, trim(it->>'lote'), (it->>'validade')::date, (it->>'fabricacao')::date)
      on conflict (produto_id, numero) do update set validade = coalesce(excluded.validade, public.lotes.validade)
      returning id into v_lote;
      update public.produtos set controla_lote = true where id = v_prod and not controla_lote;
    end if;

    insert into public.notas_entrada_itens(empresa_id, nota_id, produto_id, codigo_fornecedor, descricao, quantidade, custo_unitario, lote_id)
    values (v_emp, v_nota, v_prod, it->>'codigo_fornecedor', it->>'descricao', v_qtd, v_custo, v_lote);
    insert into public.movimentos_estoque(empresa_id, produto_id, lote_id, tipo, quantidade, custo_unitario, origem_id, observacao, usuario_id)
    values (v_emp, v_prod, v_lote, 'entrada', v_qtd, v_custo, v_nota, 'NF-e ' || (p_nota->>'numero'), auth.uid());
    update public.produtos
       set preco_custo = v_custo,
           preco_venda = coalesce((it->>'novo_preco_venda')::numeric, preco_venda)
     where id = v_prod;
    n := n + 1;
  end loop;

  insert into public.auditoria(empresa_id, acao, entidade, entidade_id, detalhes)
  values (v_emp, 'entrada_nfe', 'nota_entrada', v_nota, jsonb_build_object('chave', p_nota->>'chave', 'itens', n, 'novos', novos));
  return jsonb_build_object('nota_id', v_nota, 'itens', n, 'produtos_novos', novos);
end $$;

-- ---------------------------------------------------------------------
-- Venda: lote escolhido ou automático (FEFO), validade conferida e kits baixando componentes
-- ---------------------------------------------------------------------
create or replace function public.baixar_item_venda(p_emp uuid, p_venda uuid, p_item uuid, p_produto public.produtos,
                                                    p_qtd numeric, p_lote uuid)
returns void language plpgsql security definer set search_path = public as $$
declare v_lote uuid := p_lote; v_val date; c record;
begin
  if p_produto.e_kit then
    if not exists (select 1 from public.kit_itens where kit_id = p_produto.id) then
      raise exception 'Kit % sem componentes cadastrados', p_produto.descricao;
    end if;
    for c in select k.produto_id, k.quantidade from public.kit_itens k where k.kit_id = p_produto.id loop
      insert into public.movimentos_estoque(empresa_id, produto_id, lote_id, tipo, quantidade, origem_id, venda_item_id, usuario_id)
      values (p_emp, c.produto_id, public.lote_fefo(c.produto_id), 'saida_venda', -(p_qtd * c.quantidade), p_venda, p_item, auth.uid());
    end loop;
    return;
  end if;
  if v_lote is not null then
    select validade into v_val from public.lotes where id = v_lote and produto_id = p_produto.id;
    if not found then raise exception 'Lote não pertence ao produto %', p_produto.descricao; end if;
    if v_val < (now() at time zone 'America/Sao_Paulo')::date then
      raise exception 'Lote vencido em % para %', to_char(v_val, 'DD/MM/YYYY'), p_produto.descricao;
    end if;
  elsif p_produto.controla_lote then
    v_lote := public.lote_fefo(p_produto.id);
  end if;
  update public.venda_itens set lote_id = v_lote where id = p_item;
  insert into public.movimentos_estoque(empresa_id, produto_id, lote_id, tipo, quantidade, origem_id, venda_item_id, usuario_id)
  values (p_emp, p_produto.id, v_lote, 'saida_venda', -p_qtd, p_venda, p_item, auth.uid());
end $$;
revoke execute on function public.baixar_item_venda(uuid, uuid, uuid, public.produtos, numeric, uuid) from public, anon, authenticated;

create or replace function public.finalizar_venda(
  p_caixa uuid, p_itens jsonb, p_pagamentos jsonb,
  p_desconto numeric default 0, p_cliente uuid default null, p_cpf text default null)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_emp uuid := public.auth_empresa_id();
  v_papel text := public.auth_papel();
  v_venda uuid; v_num bigint; v_seq smallint := 0; v_item uuid;
  v_sub numeric := 0; v_total numeric; v_pago numeric := 0; v_dinheiro numeric := 0; v_troco numeric;
  it jsonb; pg jsonb; pr public.produtos; v_qtd numeric; v_preco numeric; v_desc numeric;
  v_cli public.clientes; v_sit jsonb; v_conv public.convenios;
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

  v_num := public.proximo_numero(v_emp, 'venda');
  insert into public.vendas(empresa_id, caixa_id, numero, cliente_id, cpf_consumidor, subtotal, desconto, total, operador_id)
  values (v_emp, p_caixa, v_num, p_cliente, coalesce(nullif(p_cpf,''), nullif(v_cli.cpf_cnpj,'')), 0, 0, 0, auth.uid())
  returning id into v_venda;

  for it in select * from jsonb_array_elements(p_itens) loop
    select * into pr from public.produtos where id = (it->>'produto_id')::uuid and empresa_id = v_emp and ativo;
    if not found then raise exception 'Produto não encontrado'; end if;
    v_qtd := (it->>'quantidade')::numeric;
    if v_qtd is null or v_qtd <= 0 then raise exception 'Quantidade inválida para %', pr.descricao; end if;
    v_preco := coalesce((it->>'preco_unitario')::numeric, pr.preco_venda);
    if v_preco <> pr.preco_venda and v_papel = 'operador' then
      raise exception 'Alteração de preço exige gerente (%).', pr.descricao;
    end if;
    v_desc := coalesce((it->>'desconto')::numeric, 0);
    if v_desc < 0 or v_desc > v_qtd * v_preco then raise exception 'Desconto inválido em %', pr.descricao; end if;
    v_seq := v_seq + 1;
    insert into public.venda_itens(empresa_id, venda_id, sequencia, produto_id, descricao, quantidade, preco_unitario, desconto, total)
    values (v_emp, v_venda, v_seq, pr.id, pr.descricao, v_qtd, v_preco, v_desc, round(v_qtd * v_preco - v_desc, 2))
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

-- Cancelamento: estorna exatamente os movimentos que a venda gerou (componentes de kit e lotes)
create or replace function public.cancelar_venda(p_venda uuid, p_motivo text)
returns void language plpgsql security definer set search_path = public as $$
declare v_emp uuid := public.auth_empresa_id(); r record;
begin
  if public.auth_papel() not in ('administrador','gerente') then
    raise exception 'Cancelamento exige gerente ou administrador';
  end if;
  if coalesce(length(trim(p_motivo)),0) < 15 then raise exception 'Informe o motivo (mínimo 15 caracteres)'; end if;
  if exists (select 1 from public.contas_receber where venda_id = p_venda and valor_pago > 0) then
    raise exception 'A venda tem parcelas já recebidas; faça uma devolução em vez de cancelar';
  end if;
  if exists (select 1 from public.devolucoes where venda_id = p_venda) then
    raise exception 'A venda já tem devolução registrada';
  end if;
  update public.vendas set status = 'cancelada', cancelada_em = now(), motivo_cancelamento = p_motivo
   where id = p_venda and empresa_id = v_emp and status = 'concluida';
  if not found then raise exception 'Venda não encontrada ou já cancelada'; end if;
  for r in select produto_id, lote_id, quantidade, venda_item_id from public.movimentos_estoque
            where origem_id = p_venda and tipo = 'saida_venda' and empresa_id = v_emp loop
    insert into public.movimentos_estoque(empresa_id, produto_id, lote_id, tipo, quantidade, origem_id, venda_item_id, usuario_id)
    values (v_emp, r.produto_id, r.lote_id, 'estorno_venda', -r.quantidade, p_venda, r.venda_item_id, auth.uid());
  end loop;
  update public.contas_receber set status = 'cancelada' where venda_id = p_venda and status = 'aberta';
  insert into public.creditos_cliente(empresa_id, cliente_id, valor, origem, referencia_id)
  select v_emp, cliente_id, -valor, 'ajuste', p_venda from public.creditos_cliente where referencia_id = p_venda and origem = 'venda';
  insert into public.auditoria(empresa_id, acao, entidade, entidade_id, detalhes)
  values (v_emp, 'cancelar', 'venda', p_venda, jsonb_build_object('motivo', p_motivo));
end $$;

-- Devolução: devolve ao estoque a parte proporcional do que saiu para o item (kits e lotes)
create or replace function public.devolver_itens(p_venda uuid, p_itens jsonb, p_destino text, p_motivo text,
                                                 p_caixa uuid default null, p_cliente uuid default null)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_emp uuid := public.auth_empresa_id(); v_venda public.vendas; it jsonb; vi public.venda_itens; m record;
  v_qtd numeric; v_valor numeric; v_total numeric := 0; v_dev uuid; v_cli uuid; v_prop numeric;
begin
  if public.auth_papel() not in ('administrador','gerente') then raise exception 'Devolução exige gerente ou administrador'; end if;
  if coalesce(length(trim(p_motivo)),0) < 10 then raise exception 'Informe o motivo (mínimo 10 caracteres)'; end if;
  if p_destino not in ('dinheiro','vale') then raise exception 'Destino inválido'; end if;
  select * into v_venda from public.vendas where id = p_venda and empresa_id = v_emp for update;
  if not found or v_venda.status <> 'concluida' then raise exception 'Venda não encontrada ou cancelada'; end if;
  if jsonb_array_length(coalesce(p_itens, '[]')) = 0 then raise exception 'Selecione os itens devolvidos'; end if;
  v_cli := coalesce(p_cliente, v_venda.cliente_id);
  if p_destino = 'vale' and v_cli is null then raise exception 'Identifique o cliente para gerar o vale-troca'; end if;
  if p_destino = 'dinheiro' and not exists (select 1 from public.caixas where id = p_caixa and empresa_id = v_emp and status = 'aberto') then
    raise exception 'Abra o caixa para devolver em dinheiro';
  end if;
  if exists (select 1 from public.venda_pagamentos where venda_id = p_venda and forma in ('crediario','convenio')) and p_destino = 'dinheiro' then
    raise exception 'Venda a prazo: devolva como vale-troca';
  end if;

  insert into public.devolucoes(empresa_id, venda_id, caixa_id, cliente_id, destino, valor, motivo)
  values (v_emp, p_venda, case when p_destino = 'dinheiro' then p_caixa end, v_cli, p_destino, 0.01, p_motivo)
  returning id into v_dev;

  v_prop := case when v_venda.subtotal > 0 then v_venda.total / v_venda.subtotal else 1 end;
  for it in select * from jsonb_array_elements(p_itens) loop
    select * into vi from public.venda_itens where id = (it->>'venda_item_id')::uuid and venda_id = p_venda for update;
    if not found then raise exception 'Item não pertence à venda'; end if;
    v_qtd := (it->>'quantidade')::numeric;
    if v_qtd is null or v_qtd <= 0 or v_qtd > vi.quantidade - vi.quantidade_devolvida then
      raise exception 'Quantidade inválida para %', vi.descricao;
    end if;
    v_valor := round(vi.total / vi.quantidade * v_qtd * v_prop, 2);
    update public.venda_itens set quantidade_devolvida = quantidade_devolvida + v_qtd where id = vi.id;
    insert into public.devolucao_itens(empresa_id, devolucao_id, venda_item_id, produto_id, quantidade, valor)
    values (v_emp, v_dev, vi.id, vi.produto_id, v_qtd, v_valor);
    if exists (select 1 from public.movimentos_estoque where venda_item_id = vi.id and tipo = 'saida_venda') then
      for m in select produto_id, lote_id, quantidade from public.movimentos_estoque where venda_item_id = vi.id and tipo = 'saida_venda' loop
        insert into public.movimentos_estoque(empresa_id, produto_id, lote_id, tipo, quantidade, origem_id, venda_item_id, usuario_id)
        values (v_emp, m.produto_id, m.lote_id, 'devolucao', round(-m.quantidade * v_qtd / vi.quantidade, 3), v_dev, vi.id, auth.uid());
      end loop;
    else
      -- vendas anteriores a esta versão (sem vínculo do movimento com o item)
      insert into public.movimentos_estoque(empresa_id, produto_id, lote_id, tipo, quantidade, origem_id, usuario_id)
      values (v_emp, vi.produto_id, vi.lote_id, 'devolucao', v_qtd, v_dev, auth.uid());
    end if;
    v_total := v_total + v_valor;
  end loop;

  update public.devolucoes set valor = v_total where id = v_dev;
  if p_destino = 'vale' then
    insert into public.creditos_cliente(empresa_id, cliente_id, valor, origem, referencia_id)
    values (v_emp, v_cli, v_total, 'devolucao', v_dev);
  end if;
  insert into public.auditoria(empresa_id, acao, entidade, entidade_id, detalhes)
  values (v_emp, 'devolver', 'venda', p_venda, jsonb_build_object('devolucao', v_dev, 'valor', v_total, 'destino', p_destino, 'motivo', p_motivo));
  return jsonb_build_object('devolucao_id', v_dev, 'valor', v_total, 'destino', p_destino);
end $$;

-- Estoque disponível de um kit (quantos kits os componentes permitem montar)
create or replace function public.estoque_kit(p_kit uuid)
returns numeric language sql stable set search_path = public as $$
  select coalesce(min(floor(greatest(p.estoque_atual, 0) / k.quantidade)), 0)
    from public.kit_itens k join public.produtos p on p.id = k.produto_id
   where k.kit_id = p_kit
$$;

grant execute on function public.registrar_entrada_nfe(jsonb),
  public.lancar_estoque(uuid, text, numeric, uuid, numeric, text, text, date, date),
  public.estoque_kit(uuid), public.lote_fefo(uuid) to authenticated;
revoke execute on function public.registrar_entrada_nfe(jsonb),
  public.lancar_estoque(uuid, text, numeric, uuid, numeric, text, text, date, date),
  public.estoque_kit(uuid), public.lote_fefo(uuid) from anon, public;

-- ---------------------------------------------------------------------
-- Painel: lotes vencidos e vencendo em 30 dias (com saldo)
-- ---------------------------------------------------------------------
create or replace function public.lotes_alerta()
returns jsonb language sql stable security invoker set search_path = public as $$
  with hoje as (select (now() at time zone 'America/Sao_Paulo')::date d)
  select jsonb_build_object(
    'vencidos', (select count(*) from public.lotes l, hoje where l.quantidade > 0 and l.validade < hoje.d),
    'vencendo', (select count(*) from public.lotes l, hoje where l.quantidade > 0 and l.validade between hoje.d and hoje.d + 30),
    'lista', coalesce((select jsonb_agg(x) from (
       select l.id, l.numero, l.validade, l.quantidade, p.descricao, p.unidade
         from public.lotes l join public.produtos p on p.id = l.produto_id, hoje
        where l.quantidade > 0 and l.validade <= hoje.d + 30
        order by l.validade limit 10) x), '[]'::jsonb))
$$;
grant execute on function public.lotes_alerta() to authenticated;
revoke execute on function public.lotes_alerta() from anon, public;
