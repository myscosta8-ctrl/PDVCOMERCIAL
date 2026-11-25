-- Grupo I: PIX dinâmico (API Pix do Banco Central, padrão para todos os bancos) e dados do cartão da maquininha.
-- As credenciais do banco (client_id, client_secret e certificado) ficam no cofre (Vault).

alter table public.empresas
  add column if not exists pix_dinamico jsonb,               -- { url_api, url_token, chave, expiracao }
  add column if not exists cartao_credenciadora_cnpj text,   -- CNPJ da credenciadora da maquininha (NFC-e)
  add column if not exists cartao_pedir_dados boolean not null default false;  -- caixa pede bandeira e autorização

alter table public.venda_pagamentos
  add column if not exists bandeira text,
  add column if not exists nsu text,
  add column if not exists credenciadora_cnpj text,
  add column if not exists pix_txid text;

create table if not exists public.pix_cobrancas (
  id            uuid primary key default gen_random_uuid(),
  empresa_id    uuid not null references public.empresas(id),
  caixa_id      uuid references public.caixas(id),
  venda_id      uuid references public.vendas(id),
  txid          text not null,
  valor         numeric(12,2) not null check (valor > 0),
  status        text not null default 'ativa' check (status in ('ativa','concluida','expirada','cancelada')),
  copia_e_cola  text,
  e2eid         text,
  ambiente      text,
  criado_por    uuid default auth.uid(),
  criado_em     timestamptz not null default now(),
  pago_em       timestamptz,
  expira_em     timestamptz,
  unique (empresa_id, txid)
);
create index if not exists pix_cobrancas_empresa on public.pix_cobrancas(empresa_id, criado_em desc);
alter table public.pix_cobrancas enable row level security;
-- Leitura pela empresa; gravação só pelo servidor (Edge Function) e pela venda
drop policy if exists pix_cobrancas_select on public.pix_cobrancas;
create policy pix_cobrancas_select on public.pix_cobrancas for select to authenticated using (empresa_id = public.auth_empresa_id());
revoke insert, update, delete on public.pix_cobrancas from anon, authenticated;
grant select on public.pix_cobrancas to authenticated;

-- Credenciais do banco no cofre (somente administrador)
create or replace function public.salvar_credenciais_pix(p_client_id text default null, p_client_secret text default null,
                                                        p_certificado text default null, p_chave_privada text default null)
returns void language plpgsql security definer set search_path = public, vault as $$
declare
  v_emp uuid := public.auth_empresa_id();
  v_nome text; v_valor text; v_id uuid;
begin
  if public.auth_papel() is distinct from 'administrador' then raise exception 'Somente o administrador'; end if;
  for v_nome, v_valor in
    select * from (values ('client_id', p_client_id), ('client_secret', p_client_secret), ('cert', p_certificado), ('chave', p_chave_privada)) x(n, v)
     where v is not null and v <> ''
  loop
    select id into v_id from vault.secrets where name = 'pix_' || v_nome || '_' || v_emp;
    if v_id is null then perform vault.create_secret(v_valor, 'pix_' || v_nome || '_' || v_emp);
    else perform vault.update_secret(v_id, v_valor); end if;
  end loop;
  insert into public.auditoria(empresa_id, acao, entidade, entidade_id, detalhes)
  values (v_emp, 'credenciais_pix', 'empresa', v_emp, jsonb_build_object('client_id', p_client_id is not null, 'certificado', p_certificado is not null));
end $$;
revoke execute on function public.salvar_credenciais_pix(text, text, text, text) from public, anon;
grant execute on function public.salvar_credenciais_pix(text, text, text, text) to authenticated;

create or replace function public.credenciais_pix_configuradas()
returns jsonb language sql stable security definer set search_path = public, vault as $$
  select jsonb_build_object(
    'client_id', exists(select 1 from vault.secrets where name = 'pix_client_id_' || public.auth_empresa_id()),
    'client_secret', exists(select 1 from vault.secrets where name = 'pix_client_secret_' || public.auth_empresa_id()),
    'certificado', exists(select 1 from vault.secrets where name = 'pix_cert_' || public.auth_empresa_id()),
    'chave', exists(select 1 from vault.secrets where name = 'pix_chave_' || public.auth_empresa_id()))
  where public.auth_papel() = 'administrador'
$$;
revoke execute on function public.credenciais_pix_configuradas() from public, anon;
grant execute on function public.credenciais_pix_configuradas() to authenticated;

create or replace function public.ler_credenciais_pix(p_empresa uuid)
returns jsonb language sql stable security definer set search_path = public, vault as $$
  select jsonb_build_object(
    'client_id', (select decrypted_secret from vault.decrypted_secrets where name = 'pix_client_id_' || p_empresa),
    'client_secret', (select decrypted_secret from vault.decrypted_secrets where name = 'pix_client_secret_' || p_empresa),
    'cert', (select decrypted_secret from vault.decrypted_secrets where name = 'pix_cert_' || p_empresa),
    'chave', (select decrypted_secret from vault.decrypted_secrets where name = 'pix_chave_' || p_empresa))
$$;
revoke execute on function public.ler_credenciais_pix(uuid) from public, anon, authenticated;
grant execute on function public.ler_credenciais_pix(uuid) to service_role;

-- Venda grava os dados do cartão e amarra a cobrança PIX paga
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
