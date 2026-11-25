-- Ordem de serviço (segmento serviços e assistência técnica) e serviços no cadastro de produtos.
-- Serviço não movimenta estoque e não sai na NFC-e (a nota de serviço é municipal); o restante da venda segue normal.

alter table public.produtos add column if not exists servico boolean not null default false;

create or replace function public.baixar_item_venda(p_emp uuid, p_venda uuid, p_item uuid, p_produto public.produtos,
                                                    p_qtd numeric, p_lote uuid)
returns void language plpgsql security definer set search_path = public as $$
declare v_lote uuid := p_lote; v_val date; c record;
begin
  -- Serviço não movimenta estoque
  if p_produto.servico then return; end if;
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

  update public.vendas set subtotal = v_sub, desconto = coalesce(p_desconto,0), total = v_total, troco = v_troco where id = v_venda;
  return jsonb_build_object('venda_id', v_venda, 'numero', v_num, 'total', v_total, 'troco', v_troco);
end $$;
grant execute on function public.finalizar_venda(uuid, jsonb, jsonb, numeric, uuid, text, uuid, jsonb) to authenticated;
revoke execute on function public.finalizar_venda(uuid, jsonb, jsonb, numeric, uuid, text, uuid, jsonb) from anon, public;

-- ---------------------------------------------------------------- Ordens de serviço
create table if not exists public.ordens_servico (
  id                uuid primary key default gen_random_uuid(),
  empresa_id        uuid not null references public.empresas(id),
  numero            bigint not null,
  status            text not null default 'aberta'
                    check (status in ('aberta','aguardando_aprovacao','aprovada','pronta','entregue','cancelada')),
  cliente_id        uuid references public.clientes(id),
  cliente_nome      text not null,
  cliente_telefone  text,
  equipamento       text,               -- o que foi deixado (aparelho, veículo, peça) ou o serviço pedido
  marca             text,
  modelo            text,
  numero_serie      text,
  acessorios        text,               -- o que veio junto (carregador, capa, chave)
  defeito           text,               -- relato do cliente
  diagnostico       text,
  solucao           text,
  observacoes       text,
  tecnico_id        uuid references public.usuarios(id),
  previsao          date,
  garantia_dias     integer not null default 90 check (garantia_dias between 0 and 3650),
  aprovada_em       timestamptz,
  pronta_em         timestamptz,
  entregue_em       timestamptz,
  venda_id          uuid references public.vendas(id),
  motivo_cancelamento text,
  criado_por        uuid not null default auth.uid(),
  criado_em         timestamptz not null default now(),
  atualizado_em     timestamptz not null default now(),
  unique (empresa_id, numero)
);
create index if not exists ordens_servico_status on public.ordens_servico(empresa_id, status);

create table if not exists public.os_itens (
  id             uuid primary key default gen_random_uuid(),
  empresa_id     uuid not null references public.empresas(id),
  os_id          uuid not null references public.ordens_servico(id) on delete cascade,
  produto_id     uuid not null references public.produtos(id),
  descricao      text not null,
  quantidade     numeric(14,3) not null check (quantidade > 0),
  preco_unitario numeric(12,2) not null check (preco_unitario >= 0),
  criado_em      timestamptz not null default now()
);
create index if not exists os_itens_os on public.os_itens(os_id);

do $$ declare t text; begin
  foreach t in array array['ordens_servico','os_itens'] loop
    execute format('alter table public.%I enable row level security', t);
    execute format('drop trigger if exists %I on public.%I', t || '_empresa', t);
    execute format('create trigger %I before insert or update on public.%I for each row execute function public.fixar_empresa()', t || '_empresa', t);
    execute format('drop policy if exists %I on public.%I', t || '_empresa', t);
    execute format('create policy %I on public.%I for all to authenticated using (empresa_id = public.auth_empresa_id()) with check (empresa_id = public.auth_empresa_id())', t || '_empresa', t);
  end loop;
end $$;
grant select, insert, update on public.ordens_servico to authenticated;
grant select, insert, update, delete on public.os_itens to authenticated;
revoke delete on public.ordens_servico from authenticated;

-- Número, datas de cada etapa e travas: entregue só pelo fechamento; entregue ou cancelada não muda mais
create or replace function public.os_regras()
returns trigger language plpgsql security definer set search_path = public as $$
declare v_fechando boolean := coalesce(current_setting('pdv.os_fechamento', true), '') = 'sim';
begin
  if tg_op = 'INSERT' then
    new.numero := public.proximo_numero(new.empresa_id, 'os');
    new.status := 'aberta'; new.venda_id := null; new.entregue_em := null;
    if coalesce(trim(new.cliente_nome), '') = '' then raise exception 'Informe o cliente'; end if;
    return new;
  end if;
  if old.status in ('entregue','cancelada') and not v_fechando then raise exception 'A OS nº % já está %', old.numero, old.status; end if;
  if new.status = 'entregue' and not v_fechando then raise exception 'Use Entregar e receber para concluir a OS'; end if;
  if new.venda_id is distinct from old.venda_id and not v_fechando then raise exception 'Vínculo com a venda é automático'; end if;
  if new.status = 'cancelada' and old.status <> 'cancelada' then
    if length(trim(coalesce(new.motivo_cancelamento, ''))) < 5 then raise exception 'Informe o motivo do cancelamento'; end if;
  end if;
  if coalesce(trim(new.cliente_nome), '') = '' then raise exception 'Informe o cliente'; end if;
  new.numero := old.numero; new.criado_por := old.criado_por; new.criado_em := old.criado_em;
  if new.status = 'aprovada' and old.status <> 'aprovada' then new.aprovada_em := now(); end if;
  if new.status = 'pronta' and old.status <> 'pronta' then new.pronta_em := now(); end if;
  new.atualizado_em := now();
  return new;
end $$;
drop trigger if exists os_regras on public.ordens_servico;
create trigger os_regras before insert or update on public.ordens_servico for each row execute function public.os_regras();

create or replace function public.os_itens_regras()
returns trigger language plpgsql security definer set search_path = public as $$
declare v_os uuid := coalesce(new.os_id, old.os_id); v_status text;
begin
  select status into v_status from public.ordens_servico where id = v_os;
  if v_status in ('entregue','cancelada') then raise exception 'A OS já está %; os itens não mudam mais', v_status; end if;
  if tg_op = 'DELETE' then return old; end if;
  if tg_op = 'UPDATE' and new.os_id <> old.os_id then raise exception 'Não é permitido mover o item de OS'; end if;
  if not exists (select 1 from public.produtos where id = new.produto_id and empresa_id = new.empresa_id and not coalesce(e_grade, false)) then
    raise exception 'Produto ou serviço inválido';
  end if;
  return new;
end $$;
drop trigger if exists os_itens_regras on public.os_itens;
create trigger os_itens_regras before insert or update or delete on public.os_itens for each row execute function public.os_itens_regras();

-- Entrega e recebimento: os itens viram uma venda normal (peças com NFC-e e baixa de estoque, serviços sem estoque).
-- Vale o preço combinado na OS; preço abaixo da tabela exige gerente.
create or replace function public.fechar_os(
  p_os uuid, p_caixa uuid, p_pagamentos jsonb, p_itens jsonb default null,
  p_desconto numeric default 0, p_cliente uuid default null, p_cpf text default null, p_tabela uuid default null,
  p_receitas jsonb default null)
returns jsonb language plpgsql security definer set search_path = public as $$
declare o public.ordens_servico; v_itens jsonb; r jsonb;
begin
  select * into o from public.ordens_servico where id = p_os and empresa_id = public.auth_empresa_id() for update;
  if not found then raise exception 'OS não encontrada'; end if;
  if o.status in ('entregue','cancelada') then raise exception 'A OS nº % já está %', o.numero, o.status; end if;
  if public.auth_papel() = 'operador' and exists (
      select 1 from public.os_itens i where i.os_id = o.id
         and i.preco_unitario < (public.preco_vigente(i.produto_id, i.quantidade, null)->>'preco')::numeric) then
    raise exception 'Há item com preço abaixo da tabela: a entrega exige gerente';
  end if;
  select jsonb_agg(jsonb_build_object('produto_id', produto_id, 'quantidade', quantidade, 'preco_unitario', preco_unitario) order by criado_em)
    into v_itens from public.os_itens where os_id = o.id;
  if v_itens is null then raise exception 'Inclua os serviços e peças da OS antes de entregar'; end if;
  perform set_config('pdv.preco_os', 'sim', true);
  r := public.finalizar_venda(p_caixa, v_itens, p_pagamentos, p_desconto, coalesce(p_cliente, o.cliente_id), p_cpf, p_tabela, p_receitas);
  perform set_config('pdv.preco_os', '', true);
  perform set_config('pdv.os_fechamento', 'sim', true);
  update public.ordens_servico set status = 'entregue', entregue_em = now(), venda_id = (r->>'venda_id')::uuid where id = o.id;
  perform set_config('pdv.os_fechamento', '', true);
  return r || jsonb_build_object('os', o.numero);
end $$;
revoke execute on function public.fechar_os(uuid, uuid, jsonb, jsonb, numeric, uuid, text, uuid, jsonb) from public, anon;
grant execute on function public.fechar_os(uuid, uuid, jsonb, jsonb, numeric, uuid, text, uuid, jsonb) to authenticated;
