-- =====================================================================
-- PDV Comercial — estrutura base (multiempresa, qualquer segmento)
-- Cada empresa cliente enxerga apenas os próprios dados (RLS por empresa_id).
-- Não há políticas de DELETE: o histórico é preservado (cancelamento = status).
-- =====================================================================

create extension if not exists pgcrypto;

-- ---------------------------------------------------------------------
-- Empresas e usuários
-- ---------------------------------------------------------------------
create table public.empresas (
  id              uuid primary key default gen_random_uuid(),
  razao_social    text not null,
  nome_fantasia   text,
  cnpj            text unique,
  inscricao_estadual text,
  uf              char(2),
  municipio_ibge  text,
  endereco        jsonb not null default '{}'::jsonb,
  segmento        text not null default 'varejo'
                  check (segmento in ('varejo','farmacia','mercado','restaurante','vestuario','materiais','servicos','outro')),
  regime_tributario text not null default 'simples'
                  check (regime_tributario in ('simples','simples_excesso','normal','mei')),
  -- Configuração fiscal da NFC-e (o certificado A1 e o CSC ficam no Vault, nunca aqui)
  nfce_ambiente   smallint not null default 2 check (nfce_ambiente in (1,2)), -- 1 produção, 2 homologação
  nfce_serie      integer not null default 1,
  nfce_csc_id     text,
  ativa           boolean not null default true,
  criado_em       timestamptz not null default now()
);

create table public.usuarios (
  id          uuid primary key,              -- = auth.users.id
  empresa_id  uuid not null references public.empresas(id),
  nome        text not null,
  email       text not null,
  papel       text not null default 'operador'
              check (papel in ('administrador','gerente','operador')),
  ativo       boolean not null default true,
  criado_em   timestamptz not null default now()
);
create index on public.usuarios(empresa_id);

-- Módulos ligados/desligados por empresa (ex.: lote_validade, controlados, comandas)
create table public.modulos_empresa (
  empresa_id  uuid not null references public.empresas(id),
  modulo      text not null,
  ativo       boolean not null default false,
  primary key (empresa_id, modulo)
);

-- ---------------------------------------------------------------------
-- Funções auxiliares de acesso
-- ---------------------------------------------------------------------
create or replace function public.auth_empresa_id()
returns uuid language sql stable security definer set search_path = public as $$
  select empresa_id from public.usuarios where id = auth.uid() and ativo
$$;

create or replace function public.auth_papel()
returns text language sql stable security definer set search_path = public as $$
  select papel from public.usuarios where id = auth.uid() and ativo
$$;

-- Preenche empresa_id a partir do usuário logado e impede troca posterior
create or replace function public.fixar_empresa()
returns trigger language plpgsql set search_path = public as $$
begin
  if tg_op = 'INSERT' then
    new.empresa_id := public.auth_empresa_id();
    if new.empresa_id is null then
      raise exception 'Usuário sem empresa vinculada';
    end if;
  elsif new.empresa_id is distinct from old.empresa_id then
    raise exception 'Não é permitido alterar a empresa do registro';
  end if;
  return new;
end $$;

-- ---------------------------------------------------------------------
-- Cadastros
-- ---------------------------------------------------------------------
create table public.categorias (
  id          uuid primary key default gen_random_uuid(),
  empresa_id  uuid not null references public.empresas(id),
  nome        text not null,
  ativo       boolean not null default true,
  unique (empresa_id, nome)
);

create table public.produtos (
  id              uuid primary key default gen_random_uuid(),
  empresa_id      uuid not null references public.empresas(id),
  codigo          text,                       -- código interno
  ean             text,                       -- código de barras
  descricao       text not null,
  categoria_id    uuid references public.categorias(id),
  unidade         text not null default 'UN',
  preco_venda     numeric(12,2) not null default 0 check (preco_venda >= 0),
  preco_custo     numeric(12,4) not null default 0 check (preco_custo >= 0),
  estoque_atual   numeric(14,3) not null default 0,
  estoque_minimo  numeric(14,3) not null default 0,
  controla_lote   boolean not null default false,
  -- Dados fiscais
  ncm             text,
  cest            text,
  cfop            text not null default '5102',
  origem          smallint not null default 0,
  csosn           text,           -- Simples Nacional
  cst_icms        text,           -- Regime normal
  aliquota_icms   numeric(5,2) not null default 0,
  -- Segmento farmácia
  registro_ms     text,
  controlado      boolean not null default false,
  ativo           boolean not null default true,
  criado_em       timestamptz not null default now(),
  atualizado_em   timestamptz not null default now()
);
create unique index produtos_ean_unico on public.produtos(empresa_id, ean) where ean is not null and ean <> '';
create unique index produtos_codigo_unico on public.produtos(empresa_id, codigo) where codigo is not null and codigo <> '';
create index produtos_descricao on public.produtos(empresa_id, lower(descricao));

create table public.lotes (
  id          uuid primary key default gen_random_uuid(),
  empresa_id  uuid not null references public.empresas(id),
  produto_id  uuid not null references public.produtos(id),
  numero      text not null,
  validade    date,
  fabricacao  date,
  quantidade  numeric(14,3) not null default 0,
  criado_em   timestamptz not null default now(),
  unique (produto_id, numero)
);

create table public.clientes (
  id          uuid primary key default gen_random_uuid(),
  empresa_id  uuid not null references public.empresas(id),
  nome        text not null,
  cpf_cnpj    text,
  telefone    text,
  email       text,
  limite_credito numeric(12,2) not null default 0,
  ativo       boolean not null default true,
  criado_em   timestamptz not null default now()
);

-- ---------------------------------------------------------------------
-- Estoque (todo ajuste passa por aqui; saldo do produto é consequência)
-- ---------------------------------------------------------------------
create table public.movimentos_estoque (
  id          uuid primary key default gen_random_uuid(),
  empresa_id  uuid not null references public.empresas(id),
  produto_id  uuid not null references public.produtos(id),
  lote_id     uuid references public.lotes(id),
  tipo        text not null check (tipo in ('entrada','saida_venda','estorno_venda','ajuste','perda','inventario')),
  quantidade  numeric(14,3) not null,         -- positiva = entra, negativa = sai
  custo_unitario numeric(12,4),
  origem_id   uuid,                           -- venda, nota de entrada etc.
  observacao  text,
  usuario_id  uuid not null default auth.uid(),
  criado_em   timestamptz not null default now()
);
create index on public.movimentos_estoque(empresa_id, produto_id, criado_em desc);

create or replace function public.aplicar_movimento_estoque()
returns trigger language plpgsql set search_path = public as $$
begin
  update public.produtos
     set estoque_atual = estoque_atual + new.quantidade, atualizado_em = now()
   where id = new.produto_id and empresa_id = new.empresa_id;
  if new.lote_id is not null then
    update public.lotes set quantidade = quantidade + new.quantidade
     where id = new.lote_id and empresa_id = new.empresa_id;
  end if;
  return new;
end $$;

-- ---------------------------------------------------------------------
-- Caixa
-- ---------------------------------------------------------------------
create table public.caixas (
  id              uuid primary key default gen_random_uuid(),
  empresa_id      uuid not null references public.empresas(id),
  operador_id     uuid not null default auth.uid() references public.usuarios(id),
  numero_terminal smallint not null default 1,
  aberto_em       timestamptz not null default now(),
  valor_abertura  numeric(12,2) not null default 0 check (valor_abertura >= 0),
  fechado_em      timestamptz,
  valor_informado numeric(12,2),              -- contado pelo operador no fechamento
  valor_esperado  numeric(12,2),              -- calculado pelo sistema
  status          text not null default 'aberto' check (status in ('aberto','fechado'))
);
create unique index caixa_aberto_por_terminal on public.caixas(empresa_id, numero_terminal) where status = 'aberto';

create table public.caixa_movimentos (
  id          uuid primary key default gen_random_uuid(),
  empresa_id  uuid not null references public.empresas(id),
  caixa_id    uuid not null references public.caixas(id),
  tipo        text not null check (tipo in ('sangria','suprimento')),
  valor       numeric(12,2) not null check (valor > 0),
  motivo      text,
  usuario_id  uuid not null default auth.uid(),
  criado_em   timestamptz not null default now()
);

-- ---------------------------------------------------------------------
-- Vendas
-- ---------------------------------------------------------------------
create table public.vendas (
  id            uuid primary key default gen_random_uuid(),
  empresa_id    uuid not null references public.empresas(id),
  caixa_id      uuid not null references public.caixas(id),
  numero        bigint not null,
  cliente_id    uuid references public.clientes(id),
  cpf_consumidor text,
  subtotal      numeric(12,2) not null,
  desconto      numeric(12,2) not null default 0,
  acrescimo     numeric(12,2) not null default 0,
  total         numeric(12,2) not null,
  troco         numeric(12,2) not null default 0,
  status        text not null default 'concluida' check (status in ('concluida','cancelada')),
  cancelada_em  timestamptz,
  motivo_cancelamento text,
  operador_id   uuid not null default auth.uid() references public.usuarios(id),
  criado_em     timestamptz not null default now(),
  unique (empresa_id, numero)
);
create index on public.vendas(empresa_id, criado_em desc);

create table public.venda_itens (
  id              uuid primary key default gen_random_uuid(),
  empresa_id      uuid not null references public.empresas(id),
  venda_id        uuid not null references public.vendas(id),
  sequencia       smallint not null,
  produto_id      uuid not null references public.produtos(id),
  lote_id         uuid references public.lotes(id),
  descricao       text not null,
  quantidade      numeric(14,3) not null check (quantidade > 0),
  preco_unitario  numeric(12,2) not null,
  desconto        numeric(12,2) not null default 0,
  total           numeric(12,2) not null
);

create table public.venda_pagamentos (
  id          uuid primary key default gen_random_uuid(),
  empresa_id  uuid not null references public.empresas(id),
  venda_id    uuid not null references public.vendas(id),
  forma       text not null check (forma in ('dinheiro','pix','debito','credito','crediario','outro')),
  valor       numeric(12,2) not null check (valor > 0),
  autorizacao text
);

create table public.numeracao (
  empresa_id  uuid not null references public.empresas(id),
  tipo        text not null,
  serie       integer not null default 1,
  ultimo      bigint not null default 0,
  primary key (empresa_id, tipo, serie)
);

-- ---------------------------------------------------------------------
-- NFC-e (o XML assinado e o protocolo ficam registrados; emissão no servidor)
-- ---------------------------------------------------------------------
create table public.nfce_documentos (
  id            uuid primary key default gen_random_uuid(),
  empresa_id    uuid not null references public.empresas(id),
  venda_id      uuid not null references public.vendas(id),
  ambiente      smallint not null,
  serie         integer not null,
  numero        bigint not null,
  chave         text,
  status        text not null default 'pendente'
                check (status in ('pendente','autorizada','rejeitada','contingencia','cancelada','inutilizada')),
  codigo_status text,
  motivo        text,
  protocolo     text,
  xml_autorizado text,
  qrcode_url    text,
  emitida_em    timestamptz,
  criado_em     timestamptz not null default now(),
  unique (empresa_id, ambiente, serie, numero)
);

-- ---------------------------------------------------------------------
-- Auditoria
-- ---------------------------------------------------------------------
create table public.auditoria (
  id          bigint generated always as identity primary key,
  empresa_id  uuid not null references public.empresas(id),
  usuario_id  uuid default auth.uid(),
  acao        text not null,
  entidade    text not null,
  entidade_id uuid,
  detalhes    jsonb,
  criado_em   timestamptz not null default now()
);

-- ---------------------------------------------------------------------
-- Gatilhos de empresa e estoque
-- ---------------------------------------------------------------------
do $$
declare t text;
begin
  foreach t in array array['categorias','produtos','lotes','clientes','movimentos_estoque','caixas',
                           'caixa_movimentos','vendas','venda_itens','venda_pagamentos','nfce_documentos']
  loop
    execute format('create trigger %I before insert or update on public.%I
                    for each row execute function public.fixar_empresa()', t || '_empresa', t);
  end loop;
end $$;

create trigger movimentos_estoque_aplicar after insert on public.movimentos_estoque
  for each row execute function public.aplicar_movimento_estoque();

-- ---------------------------------------------------------------------
-- RLS
-- ---------------------------------------------------------------------
alter table public.empresas          enable row level security;
alter table public.usuarios          enable row level security;
alter table public.modulos_empresa   enable row level security;
alter table public.numeracao         enable row level security;
alter table public.auditoria         enable row level security;

create policy empresas_select on public.empresas for select using (id = public.auth_empresa_id());
create policy empresas_update on public.empresas for update
  using (id = public.auth_empresa_id() and public.auth_papel() = 'administrador');

create policy usuarios_select on public.usuarios for select using (empresa_id = public.auth_empresa_id());
create policy usuarios_admin_insert on public.usuarios for insert
  with check (empresa_id = public.auth_empresa_id() and public.auth_papel() = 'administrador');
create policy usuarios_admin_update on public.usuarios for update
  using (empresa_id = public.auth_empresa_id() and public.auth_papel() = 'administrador');

create policy modulos_select on public.modulos_empresa for select using (empresa_id = public.auth_empresa_id());
create policy modulos_admin on public.modulos_empresa for all
  using (empresa_id = public.auth_empresa_id() and public.auth_papel() = 'administrador')
  with check (empresa_id = public.auth_empresa_id() and public.auth_papel() = 'administrador');

create policy auditoria_select on public.auditoria for select
  using (empresa_id = public.auth_empresa_id() and public.auth_papel() in ('administrador','gerente'));
-- numeracao: só via funções (sem políticas de acesso direto)

do $$
declare t text;
begin
  -- Leitura e inclusão para todos da empresa
  foreach t in array array['categorias','produtos','lotes','clientes','movimentos_estoque','caixas',
                           'caixa_movimentos','vendas','venda_itens','venda_pagamentos','nfce_documentos']
  loop
    execute format('alter table public.%I enable row level security', t);
    execute format('create policy %I on public.%I for select using (empresa_id = public.auth_empresa_id())', t||'_select', t);
  end loop;
  -- Cadastros: inclusão/edição por gerente ou administrador
  foreach t in array array['categorias','produtos','lotes']
  loop
    execute format('create policy %I on public.%I for insert with check (public.auth_papel() in (''administrador'',''gerente''))', t||'_insert', t);
    execute format('create policy %I on public.%I for update using (empresa_id = public.auth_empresa_id() and public.auth_papel() in (''administrador'',''gerente''))', t||'_update', t);
  end loop;
  -- Clientes: qualquer usuário da empresa cadastra/edita
  execute 'create policy clientes_insert on public.clientes for insert with check (public.auth_empresa_id() is not null)';
  execute 'create policy clientes_update on public.clientes for update using (empresa_id = public.auth_empresa_id())';
end $$;
-- Vendas, caixas, movimentos e NFC-e: escrita apenas pelas funções abaixo (sem INSERT/UPDATE direto)

-- ---------------------------------------------------------------------
-- Funções de negócio (executam com as permissões do dono, validando a empresa)
-- ---------------------------------------------------------------------
create or replace function public.proximo_numero(p_empresa uuid, p_tipo text, p_serie integer default 1)
returns bigint language plpgsql security definer set search_path = public as $$
declare v bigint;
begin
  insert into public.numeracao(empresa_id, tipo, serie, ultimo) values (p_empresa, p_tipo, p_serie, 1)
  on conflict (empresa_id, tipo, serie) do update set ultimo = public.numeracao.ultimo + 1
  returning ultimo into v;
  return v;
end $$;
revoke execute on function public.proximo_numero(uuid, text, integer) from public, anon, authenticated;

create or replace function public.abrir_caixa(p_terminal smallint, p_valor numeric)
returns uuid language plpgsql security definer set search_path = public as $$
declare v_emp uuid := public.auth_empresa_id(); v_id uuid;
begin
  if v_emp is null then raise exception 'Usuário sem empresa vinculada'; end if;
  insert into public.caixas(empresa_id, operador_id, numero_terminal, valor_abertura)
  values (v_emp, auth.uid(), p_terminal, coalesce(p_valor,0)) returning id into v_id;
  insert into public.auditoria(empresa_id, acao, entidade, entidade_id, detalhes)
  values (v_emp, 'abrir', 'caixa', v_id, jsonb_build_object('terminal', p_terminal, 'valor', p_valor));
  return v_id;
exception when unique_violation then
  raise exception 'Já existe um caixa aberto neste terminal';
end $$;

create or replace function public.movimentar_caixa(p_caixa uuid, p_tipo text, p_valor numeric, p_motivo text)
returns uuid language plpgsql security definer set search_path = public as $$
declare v_emp uuid := public.auth_empresa_id(); v_id uuid;
begin
  if not exists (select 1 from public.caixas where id = p_caixa and empresa_id = v_emp and status = 'aberto') then
    raise exception 'Caixa não está aberto';
  end if;
  insert into public.caixa_movimentos(empresa_id, caixa_id, tipo, valor, motivo)
  values (v_emp, p_caixa, p_tipo, p_valor, p_motivo) returning id into v_id;
  return v_id;
end $$;

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
           from public.caixa_movimentos where caixa_id = p_caixa)
  select jsonb_build_object(
    'abertura', c.valor_abertura,
    'formas', coalesce((select jsonb_object_agg(forma, total) from pg), '{}'::jsonb),
    'suprimentos', mv.sup,
    'sangrias', mv.san,
    'qtd_vendas', (select count(*) from public.vendas where caixa_id = p_caixa and status = 'concluida'),
    'dinheiro_esperado', c.valor_abertura + mv.sup - mv.san
        + coalesce((select total from pg where forma = 'dinheiro'),0) - tr.t
  ) from c, mv, tr
$$;

create or replace function public.fechar_caixa(p_caixa uuid, p_valor_informado numeric)
returns jsonb language plpgsql security definer set search_path = public as $$
declare v_emp uuid := public.auth_empresa_id(); r jsonb;
begin
  if not exists (select 1 from public.caixas where id = p_caixa and empresa_id = v_emp and status = 'aberto') then
    raise exception 'Caixa não está aberto';
  end if;
  r := public.resumo_caixa(p_caixa);
  update public.caixas set status = 'fechado', fechado_em = now(),
         valor_informado = p_valor_informado,
         valor_esperado = (r->>'dinheiro_esperado')::numeric
   where id = p_caixa;
  insert into public.auditoria(empresa_id, acao, entidade, entidade_id, detalhes)
  values (v_emp, 'fechar', 'caixa', p_caixa, r || jsonb_build_object('informado', p_valor_informado));
  return r;
end $$;

-- Finaliza a venda de forma atômica: valida, numera, grava itens, pagamentos e baixa estoque.
-- p_itens: [{produto_id, quantidade, preco_unitario?, desconto?, lote_id?}]
-- p_pagamentos: [{forma, valor, autorizacao?}]
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
begin
  if v_emp is null then raise exception 'Usuário sem empresa vinculada'; end if;
  if not exists (select 1 from public.caixas where id = p_caixa and empresa_id = v_emp and status = 'aberto') then
    raise exception 'Caixa não está aberto';
  end if;
  if jsonb_array_length(coalesce(p_itens,'[]')) = 0 then raise exception 'Venda sem itens'; end if;
  if coalesce(p_desconto,0) < 0 then raise exception 'Desconto inválido'; end if;

  v_num := public.proximo_numero(v_emp, 'venda');
  insert into public.vendas(empresa_id, caixa_id, numero, cliente_id, cpf_consumidor, subtotal, desconto, total, operador_id)
  values (v_emp, p_caixa, v_num, p_cliente, nullif(p_cpf,''), 0, 0, 0, auth.uid())
  returning id into v_venda;

  for it in select * from jsonb_array_elements(p_itens) loop
    select * into pr from public.produtos
     where id = (it->>'produto_id')::uuid and empresa_id = v_emp and ativo;
    if not found then raise exception 'Produto não encontrado'; end if;
    v_qtd := (it->>'quantidade')::numeric;
    if v_qtd is null or v_qtd <= 0 then raise exception 'Quantidade inválida para %', pr.descricao; end if;
    -- Preço diferente do cadastro só com gerente/administrador
    v_preco := coalesce((it->>'preco_unitario')::numeric, pr.preco_venda);
    if v_preco <> pr.preco_venda and v_papel = 'operador' then
      raise exception 'Alteração de preço exige gerente (%).', pr.descricao;
    end if;
    v_desc := coalesce((it->>'desconto')::numeric, 0);
    if v_desc < 0 or v_desc > v_qtd * v_preco then raise exception 'Desconto inválido em %', pr.descricao; end if;
    v_seq := v_seq + 1;
    insert into public.venda_itens(empresa_id, venda_id, sequencia, produto_id, lote_id, descricao,
                                   quantidade, preco_unitario, desconto, total)
    values (v_emp, v_venda, v_seq, pr.id, (it->>'lote_id')::uuid, pr.descricao,
            v_qtd, v_preco, v_desc, round(v_qtd * v_preco - v_desc, 2));
    insert into public.movimentos_estoque(empresa_id, produto_id, lote_id, tipo, quantidade, origem_id, usuario_id)
    values (v_emp, pr.id, (it->>'lote_id')::uuid, 'saida_venda', -v_qtd, v_venda, auth.uid());
    v_sub := v_sub + round(v_qtd * v_preco - v_desc, 2);
  end loop;

  v_total := round(v_sub - coalesce(p_desconto,0), 2);
  if v_total < 0 then raise exception 'Desconto maior que o total'; end if;

  for pg in select * from jsonb_array_elements(coalesce(p_pagamentos,'[]')) loop
    insert into public.venda_pagamentos(empresa_id, venda_id, forma, valor, autorizacao)
    values (v_emp, v_venda, pg->>'forma', (pg->>'valor')::numeric, pg->>'autorizacao');
    v_pago := v_pago + (pg->>'valor')::numeric;
    if pg->>'forma' = 'dinheiro' then v_dinheiro := v_dinheiro + (pg->>'valor')::numeric; end if;
  end loop;
  if v_pago < v_total then raise exception 'Pagamento insuficiente'; end if;
  v_troco := v_pago - v_total;
  if v_troco > v_dinheiro then raise exception 'Troco só pode sair de pagamento em dinheiro'; end if;

  update public.vendas set subtotal = v_sub, desconto = coalesce(p_desconto,0), total = v_total, troco = v_troco
   where id = v_venda;

  return jsonb_build_object('venda_id', v_venda, 'numero', v_num, 'total', v_total, 'troco', v_troco);
end $$;

create or replace function public.cancelar_venda(p_venda uuid, p_motivo text)
returns void language plpgsql security definer set search_path = public as $$
declare v_emp uuid := public.auth_empresa_id(); r record;
begin
  if public.auth_papel() not in ('administrador','gerente') then
    raise exception 'Cancelamento exige gerente ou administrador';
  end if;
  if coalesce(length(trim(p_motivo)),0) < 15 then raise exception 'Informe o motivo (mínimo 15 caracteres)'; end if;
  update public.vendas set status = 'cancelada', cancelada_em = now(), motivo_cancelamento = p_motivo
   where id = p_venda and empresa_id = v_emp and status = 'concluida';
  if not found then raise exception 'Venda não encontrada ou já cancelada'; end if;
  for r in select produto_id, lote_id, quantidade from public.venda_itens where venda_id = p_venda loop
    insert into public.movimentos_estoque(empresa_id, produto_id, lote_id, tipo, quantidade, origem_id, usuario_id)
    values (v_emp, r.produto_id, r.lote_id, 'estorno_venda', r.quantidade, p_venda, auth.uid());
  end loop;
  insert into public.auditoria(empresa_id, acao, entidade, entidade_id, detalhes)
  values (v_emp, 'cancelar', 'venda', p_venda, jsonb_build_object('motivo', p_motivo));
end $$;

-- Ajuste/entrada manual de estoque (gerente/administrador)
create or replace function public.lancar_estoque(p_produto uuid, p_tipo text, p_quantidade numeric,
                                                 p_lote uuid default null, p_custo numeric default null, p_obs text default null)
returns uuid language plpgsql security definer set search_path = public as $$
declare v_emp uuid := public.auth_empresa_id(); v_id uuid;
begin
  if public.auth_papel() not in ('administrador','gerente') then raise exception 'Sem permissão'; end if;
  if p_tipo not in ('entrada','ajuste','perda','inventario') then raise exception 'Tipo inválido'; end if;
  if not exists (select 1 from public.produtos where id = p_produto and empresa_id = v_emp) then
    raise exception 'Produto não encontrado';
  end if;
  insert into public.movimentos_estoque(empresa_id, produto_id, lote_id, tipo, quantidade, custo_unitario, observacao, usuario_id)
  values (v_emp, p_produto, p_lote, p_tipo,
          case when p_tipo = 'perda' then -abs(p_quantidade) else p_quantidade end, p_custo, p_obs, auth.uid())
  returning id into v_id;
  return v_id;
end $$;

grant execute on function public.abrir_caixa(smallint, numeric), public.movimentar_caixa(uuid, text, numeric, text),
  public.resumo_caixa(uuid), public.fechar_caixa(uuid, numeric),
  public.finalizar_venda(uuid, jsonb, jsonb, numeric, uuid, text),
  public.cancelar_venda(uuid, text), public.lancar_estoque(uuid, text, numeric, uuid, numeric, text)
  to authenticated;
revoke execute on function public.abrir_caixa(smallint, numeric), public.movimentar_caixa(uuid, text, numeric, text),
  public.resumo_caixa(uuid), public.fechar_caixa(uuid, numeric),
  public.finalizar_venda(uuid, jsonb, jsonb, numeric, uuid, text),
  public.cancelar_venda(uuid, text), public.lancar_estoque(uuid, text, numeric, uuid, numeric, text)
  from anon, public;
