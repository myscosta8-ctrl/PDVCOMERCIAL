-- =====================================================================
-- Bloco Vendas: clientes, convênios, crediário, recebimento de contas no caixa,
-- devolução/troca (vale-troca) e orçamentos/pedidos (pré-venda).
-- =====================================================================

-- ---------------------------------------------------------------------
-- Convênios e clientes
-- ---------------------------------------------------------------------
create table public.convenios (
  id                   uuid primary key default gen_random_uuid(),
  empresa_id           uuid not null references public.empresas(id),
  nome                 text not null,
  cnpj                 text,
  desconto_percentual  numeric(5,2) not null default 0 check (desconto_percentual between 0 and 100),
  dia_fechamento       smallint not null default 25 check (dia_fechamento between 1 and 28),
  dias_vencimento      smallint not null default 10 check (dias_vencimento between 0 and 60),
  ativo                boolean not null default true,
  criado_em            timestamptz not null default now(),
  unique (empresa_id, nome)
);

alter table public.clientes
  add column if not exists convenio_id uuid references public.convenios(id),
  add column if not exists matricula text,
  add column if not exists nascimento date,
  add column if not exists endereco jsonb not null default '{}'::jsonb,
  add column if not exists observacoes text,
  add column if not exists bloqueado boolean not null default false;
create unique index if not exists clientes_documento_unico on public.clientes(empresa_id, cpf_cnpj) where cpf_cnpj is not null and cpf_cnpj <> '';

-- ---------------------------------------------------------------------
-- Contas a receber (parcelas de crediário e convênio)
-- ---------------------------------------------------------------------
create table public.contas_receber (
  id          uuid primary key default gen_random_uuid(),
  empresa_id  uuid not null references public.empresas(id),
  cliente_id  uuid not null references public.clientes(id),
  venda_id    uuid references public.vendas(id),
  origem      text not null check (origem in ('crediario','convenio')),
  parcela     smallint not null default 1,
  parcelas    smallint not null default 1,
  valor       numeric(12,2) not null check (valor > 0),
  valor_pago  numeric(12,2) not null default 0 check (valor_pago >= 0),
  vencimento  date not null,
  status      text not null default 'aberta' check (status in ('aberta','paga','cancelada')),
  pago_em     timestamptz,
  criado_em   timestamptz not null default now()
);
create index on public.contas_receber(empresa_id, cliente_id, status, vencimento);

create table public.recebimentos (
  id          uuid primary key default gen_random_uuid(),
  empresa_id  uuid not null references public.empresas(id),
  caixa_id    uuid not null references public.caixas(id),
  cliente_id  uuid not null references public.clientes(id),
  forma       text not null check (forma in ('dinheiro','pix','debito','credito')),
  valor       numeric(12,2) not null check (valor > 0),
  detalhes    jsonb not null default '[]'::jsonb,
  usuario_id  uuid not null default auth.uid(),
  criado_em   timestamptz not null default now()
);

-- Créditos do cliente (vale-troca): positivo = crédito gerado, negativo = crédito usado
create table public.creditos_cliente (
  id            uuid primary key default gen_random_uuid(),
  empresa_id    uuid not null references public.empresas(id),
  cliente_id    uuid not null references public.clientes(id),
  valor         numeric(12,2) not null check (valor <> 0),
  origem        text not null check (origem in ('devolucao','venda','ajuste')),
  referencia_id uuid,
  usuario_id    uuid not null default auth.uid(),
  criado_em     timestamptz not null default now()
);

-- ---------------------------------------------------------------------
-- Devoluções
-- ---------------------------------------------------------------------
alter table public.venda_itens add column if not exists quantidade_devolvida numeric(14,3) not null default 0;

alter table public.movimentos_estoque drop constraint if exists movimentos_estoque_tipo_check;
alter table public.movimentos_estoque add constraint movimentos_estoque_tipo_check
  check (tipo in ('entrada','saida_venda','estorno_venda','devolucao','ajuste','perda','inventario'));

create table public.devolucoes (
  id          uuid primary key default gen_random_uuid(),
  empresa_id  uuid not null references public.empresas(id),
  venda_id    uuid not null references public.vendas(id),
  caixa_id    uuid references public.caixas(id),
  cliente_id  uuid references public.clientes(id),
  destino     text not null check (destino in ('dinheiro','vale')),
  valor       numeric(12,2) not null check (valor > 0),
  motivo      text not null,
  usuario_id  uuid not null default auth.uid(),
  criado_em   timestamptz not null default now()
);
create table public.devolucao_itens (
  id             uuid primary key default gen_random_uuid(),
  empresa_id     uuid not null references public.empresas(id),
  devolucao_id   uuid not null references public.devolucoes(id),
  venda_item_id  uuid not null references public.venda_itens(id),
  produto_id     uuid not null references public.produtos(id),
  quantidade     numeric(14,3) not null check (quantidade > 0),
  valor          numeric(12,2) not null
);

-- ---------------------------------------------------------------------
-- Orçamentos e pedidos (pré-venda)
-- ---------------------------------------------------------------------
create table public.pre_vendas (
  id           uuid primary key default gen_random_uuid(),
  empresa_id   uuid not null references public.empresas(id),
  numero       bigint not null default 0,
  tipo         text not null check (tipo in ('orcamento','pedido')),
  cliente_id   uuid references public.clientes(id),
  cliente_nome text,
  itens        jsonb not null check (jsonb_typeof(itens) = 'array' and jsonb_array_length(itens) > 0),
  desconto     numeric(12,2) not null default 0 check (desconto >= 0),
  total        numeric(12,2) not null check (total >= 0),
  validade     date,
  observacao   text,
  status       text not null default 'aberto' check (status in ('aberto','convertido','cancelado')),
  venda_id     uuid references public.vendas(id),
  criado_por   uuid not null default auth.uid() references public.usuarios(id),
  criado_em    timestamptz not null default now()
);
create index on public.pre_vendas(empresa_id, status, criado_em desc);

create or replace function public.numerar_pre_venda()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if tg_op = 'INSERT' then
    new.numero := public.proximo_numero(new.empresa_id, 'pre_venda_' || new.tipo);
  else
    new.numero := old.numero; new.tipo := old.tipo; new.criado_por := old.criado_por;
  end if;
  return new;
end $$;
revoke execute on function public.numerar_pre_venda() from public, anon, authenticated;

-- ---------------------------------------------------------------------
-- Pagamentos: novas formas
-- ---------------------------------------------------------------------
alter table public.venda_pagamentos drop constraint if exists venda_pagamentos_forma_check;
alter table public.venda_pagamentos add constraint venda_pagamentos_forma_check
  check (forma in ('dinheiro','pix','debito','credito','crediario','convenio','vale','outro'));

-- ---------------------------------------------------------------------
-- Gatilhos e RLS das novas tabelas
-- ---------------------------------------------------------------------
do $$
declare t text;
begin
  foreach t in array array['convenios','contas_receber','recebimentos','creditos_cliente','devolucoes','devolucao_itens','pre_vendas']
  loop
    execute format('create trigger %I before insert or update on public.%I for each row execute function public.fixar_empresa()', t || '_empresa', t);
    execute format('alter table public.%I enable row level security', t);
    execute format('create policy %I on public.%I for select using (empresa_id = public.auth_empresa_id())', t || '_select', t);
  end loop;
end $$;
-- Ordem dos gatilhos: empresa é fixada antes da numeração (nomes em ordem alfabética)
create trigger pre_vendas_numero before insert or update on public.pre_vendas
  for each row execute function public.numerar_pre_venda();

create policy convenios_insert on public.convenios for insert with check (public.auth_papel() in ('administrador','gerente'));
create policy convenios_update on public.convenios for update using (empresa_id = public.auth_empresa_id() and public.auth_papel() in ('administrador','gerente'));
create policy pre_vendas_insert on public.pre_vendas for insert with check (public.auth_empresa_id() is not null);
create policy pre_vendas_update on public.pre_vendas for update using (empresa_id = public.auth_empresa_id());
-- contas_receber, recebimentos, creditos_cliente e devoluções: escrita só pelas funções abaixo

-- ---------------------------------------------------------------------
-- Situação financeira do cliente
-- ---------------------------------------------------------------------
create or replace function public.situacao_cliente(p_cliente uuid)
returns jsonb language sql stable security invoker set search_path = public as $$
  with c as (select * from public.clientes where id = p_cliente),
  ab as (select * from public.contas_receber where cliente_id = p_cliente and status = 'aberta'),
  hoje as (select (now() at time zone 'America/Sao_Paulo')::date d)
  select jsonb_build_object(
    'limite', c.limite_credito,
    'saldo_devedor', coalesce((select sum(valor - valor_pago) from ab), 0),
    'disponivel', greatest(0, c.limite_credito - coalesce((select sum(valor - valor_pago) from ab where origem = 'crediario'), 0)),
    'em_atraso', coalesce((select sum(valor - valor_pago) from ab, hoje where vencimento < hoje.d), 0),
    'dias_atraso', coalesce((select max(hoje.d - vencimento) from ab, hoje where vencimento < hoje.d), 0),
    'vale', coalesce((select sum(valor) from public.creditos_cliente where cliente_id = p_cliente), 0),
    'bloqueado', c.bloqueado,
    'convenio', (select jsonb_build_object('id', v.id, 'nome', v.nome, 'desconto', v.desconto_percentual)
                   from public.convenios v where v.id = c.convenio_id and v.ativo)
  ) from c
$$;
grant execute on function public.situacao_cliente(uuid) to authenticated;
revoke execute on function public.situacao_cliente(uuid) from anon, public;

-- Vencimento de convênio: próximo fechamento + prazo
create or replace function public.vencimento_convenio(p_fechamento smallint, p_dias smallint, p_data date)
returns date language sql immutable as $$
  select (case when extract(day from p_data) <= p_fechamento
               then make_date(extract(year from p_data)::int, extract(month from p_data)::int, p_fechamento)
               else (make_date(extract(year from p_data)::int, extract(month from p_data)::int, p_fechamento) + interval '1 month')::date
          end) + p_dias
$$;

-- ---------------------------------------------------------------------
-- Finalização de venda (substitui a versão anterior): crediário, convênio e vale-troca
-- Pagamento: {forma, valor, parcelas?, primeiro_vencimento?}
-- ---------------------------------------------------------------------
create or replace function public.finalizar_venda(
  p_caixa uuid, p_itens jsonb, p_pagamentos jsonb,
  p_desconto numeric default 0, p_cliente uuid default null, p_cpf text default null)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_emp uuid := public.auth_empresa_id();
  v_papel text := public.auth_papel();
  v_venda uuid; v_num bigint; v_seq smallint := 0;
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
    insert into public.venda_itens(empresa_id, venda_id, sequencia, produto_id, lote_id, descricao, quantidade, preco_unitario, desconto, total)
    values (v_emp, v_venda, v_seq, pr.id, (it->>'lote_id')::uuid, pr.descricao, v_qtd, v_preco, v_desc, round(v_qtd * v_preco - v_desc, 2));
    insert into public.movimentos_estoque(empresa_id, produto_id, lote_id, tipo, quantidade, origem_id, usuario_id)
    values (v_emp, pr.id, (it->>'lote_id')::uuid, 'saida_venda', -v_qtd, v_venda, auth.uid());
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

-- Cancelar venda também cancela as parcelas e devolve o vale usado
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
  for r in select produto_id, lote_id, quantidade from public.venda_itens where venda_id = p_venda loop
    insert into public.movimentos_estoque(empresa_id, produto_id, lote_id, tipo, quantidade, origem_id, usuario_id)
    values (v_emp, r.produto_id, r.lote_id, 'estorno_venda', r.quantidade, p_venda, auth.uid());
  end loop;
  update public.contas_receber set status = 'cancelada' where venda_id = p_venda and status = 'aberta';
  insert into public.creditos_cliente(empresa_id, cliente_id, valor, origem, referencia_id)
  select v_emp, cliente_id, -valor, 'ajuste', p_venda from public.creditos_cliente where referencia_id = p_venda and origem = 'venda';
  insert into public.auditoria(empresa_id, acao, entidade, entidade_id, detalhes)
  values (v_emp, 'cancelar', 'venda', p_venda, jsonb_build_object('motivo', p_motivo));
end $$;

-- ---------------------------------------------------------------------
-- Recebimento de contas no caixa (abate as parcelas mais antigas primeiro)
-- ---------------------------------------------------------------------
create or replace function public.receber_contas(p_caixa uuid, p_cliente uuid, p_valor numeric, p_forma text)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_emp uuid := public.auth_empresa_id(); v_resto numeric := round(p_valor, 2); v_abate numeric;
  r public.contas_receber; v_det jsonb := '[]'::jsonb; v_id uuid; v_devido numeric;
begin
  if not exists (select 1 from public.caixas where id = p_caixa and empresa_id = v_emp and status = 'aberto') then
    raise exception 'Caixa não está aberto';
  end if;
  if p_forma not in ('dinheiro','pix','debito','credito') then raise exception 'Forma de recebimento inválida'; end if;
  if v_resto is null or v_resto <= 0 then raise exception 'Valor inválido'; end if;
  select coalesce(sum(valor - valor_pago), 0) into v_devido from public.contas_receber
   where cliente_id = p_cliente and empresa_id = v_emp and status = 'aberta';
  if v_devido = 0 then raise exception 'Cliente sem contas em aberto'; end if;
  if v_resto > v_devido then raise exception 'Valor maior que o saldo devedor (%)', to_char(v_devido, 'FM999G999G990D00'); end if;

  for r in select * from public.contas_receber where cliente_id = p_cliente and empresa_id = v_emp and status = 'aberta'
           order by vencimento, parcela for update loop
    exit when v_resto <= 0;
    v_abate := least(v_resto, r.valor - r.valor_pago);
    update public.contas_receber
       set valor_pago = valor_pago + v_abate,
           status = case when valor_pago + v_abate >= valor then 'paga' else 'aberta' end,
           pago_em = case when valor_pago + v_abate >= valor then now() else pago_em end
     where id = r.id;
    v_det := v_det || jsonb_build_object('conta_id', r.id, 'valor', v_abate, 'vencimento', r.vencimento);
    v_resto := v_resto - v_abate;
  end loop;

  insert into public.recebimentos(empresa_id, caixa_id, cliente_id, forma, valor, detalhes)
  values (v_emp, p_caixa, p_cliente, p_forma, round(p_valor, 2), v_det) returning id into v_id;
  return jsonb_build_object('recebimento_id', v_id, 'valor', round(p_valor, 2), 'parcelas', v_det);
end $$;

-- ---------------------------------------------------------------------
-- Devolução de itens (gerente/administrador): estoque volta; reembolso em dinheiro ou vale-troca
-- p_itens: [{venda_item_id, quantidade}]
-- ---------------------------------------------------------------------
create or replace function public.devolver_itens(p_venda uuid, p_itens jsonb, p_destino text, p_motivo text,
                                                 p_caixa uuid default null, p_cliente uuid default null)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_emp uuid := public.auth_empresa_id(); v_venda public.vendas; it jsonb; vi public.venda_itens;
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

  -- proporção do desconto geral da venda aplicada a cada item
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
    insert into public.movimentos_estoque(empresa_id, produto_id, lote_id, tipo, quantidade, origem_id, usuario_id)
    values (v_emp, vi.produto_id, vi.lote_id, 'devolucao', v_qtd, v_dev, auth.uid());
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

-- ---------------------------------------------------------------------
-- Resumo do caixa: inclui recebimentos de contas e devoluções em dinheiro
-- ---------------------------------------------------------------------
create or replace function public.resumo_caixa(p_caixa uuid)
returns jsonb language sql stable security definer set search_path = public as $$
  with c as (select * from public.caixas where id = p_caixa and empresa_id = public.auth_empresa_id()),
  pg as (
    select p.forma, sum(p.valor) total
      from public.venda_pagamentos p join public.vendas v on v.id = p.venda_id
     where v.caixa_id = p_caixa and v.status = 'concluida'
     group by p.forma),
  tr as (select coalesce(sum(troco),0) t from public.vendas where caixa_id = p_caixa and status = 'concluida'),
  mv as (select coalesce(sum(valor) filter (where tipo='suprimento'),0) sup,
                coalesce(sum(valor) filter (where tipo='sangria'),0) san
           from public.caixa_movimentos where caixa_id = p_caixa),
  rc as (select forma, sum(valor) total from public.recebimentos where caixa_id = p_caixa group by forma),
  dv as (select coalesce(sum(valor),0) t from public.devolucoes where caixa_id = p_caixa and destino = 'dinheiro')
  select jsonb_build_object(
    'abertura', c.valor_abertura,
    'formas', coalesce((select jsonb_object_agg(forma, total) from pg), '{}'::jsonb),
    'recebimentos', coalesce((select jsonb_object_agg(forma, total) from rc), '{}'::jsonb),
    'devolucoes_dinheiro', dv.t,
    'suprimentos', mv.sup,
    'sangrias', mv.san,
    'qtd_vendas', (select count(*) from public.vendas where caixa_id = p_caixa and status = 'concluida'),
    'dinheiro_esperado', c.valor_abertura + mv.sup - mv.san
        + coalesce((select total from pg where forma = 'dinheiro'),0) - tr.t
        + coalesce((select total from rc where forma = 'dinheiro'),0) - dv.t
  ) from c, mv, tr, dv
$$;

grant execute on function public.receber_contas(uuid, uuid, numeric, text), public.devolver_itens(uuid, jsonb, text, text, uuid, uuid) to authenticated;
revoke execute on function public.receber_contas(uuid, uuid, numeric, text), public.devolver_itens(uuid, jsonb, text, text, uuid, uuid) from anon, public;
revoke execute on function public.vencimento_convenio(smallint, smallint, date) from anon;
