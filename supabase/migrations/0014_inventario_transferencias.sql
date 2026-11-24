-- Grupo D: inventário com coletor e transferência entre filiais.
-- Inclui também o complemento do financeiro: saldo por conta, transferências entre contas e metas.

alter table public.movimentos_estoque drop constraint if exists movimentos_estoque_tipo_check;
alter table public.movimentos_estoque add constraint movimentos_estoque_tipo_check
  check (tipo in ('entrada','saida_venda','estorno_venda','devolucao','ajuste','perda','inventario','transferencia_saida','transferencia_entrada'));

-- =====================================================================
-- Inventário
-- =====================================================================
create table public.inventarios (
  id             uuid primary key default gen_random_uuid(),
  empresa_id     uuid not null references public.empresas(id),
  numero         bigint not null,
  descricao      text not null,
  escopo         text not null check (escopo in ('todos','categoria','livre')),
  categoria_id   uuid references public.categorias(id),
  status         text not null default 'aberto' check (status in ('aberto','finalizado','cancelado')),
  resumo         jsonb,
  criado_por     uuid not null default auth.uid(),
  criado_em      timestamptz not null default now(),
  finalizado_por uuid,
  finalizado_em  timestamptz
);
create unique index on public.inventarios(empresa_id, numero);

create table public.inventario_itens (
  id              uuid primary key default gen_random_uuid(),
  empresa_id      uuid not null references public.empresas(id),
  inventario_id   uuid not null references public.inventarios(id),
  produto_id      uuid not null references public.produtos(id),
  estoque_sistema numeric(14,3),           -- fotografado na primeira contagem do item
  contado         numeric(14,3),
  contado_em      timestamptz,
  ajuste          numeric(14,3),           -- diferença aplicada ao finalizar
  custo_unitario  numeric(12,4),
  unique (inventario_id, produto_id)
);

create table public.inventario_leituras (
  id            uuid primary key default gen_random_uuid(),
  empresa_id    uuid not null references public.empresas(id),
  inventario_id uuid not null references public.inventarios(id),
  produto_id    uuid not null references public.produtos(id),
  quantidade    numeric(14,3) not null,
  modo          text not null check (modo in ('somar','definir')),
  anterior      numeric(14,3),
  usuario_id    uuid not null default auth.uid(),
  criado_em     timestamptz not null default now()
);
create index on public.inventario_leituras(inventario_id, criado_em desc);

do $$
declare t text;
begin
  foreach t in array array['inventarios','inventario_itens','inventario_leituras'] loop
    execute format('alter table public.%I enable row level security', t);
    execute format('create policy %I on public.%I for select using (empresa_id = public.auth_empresa_id())', t || '_select', t);
  end loop;
end $$;

create or replace function public.abrir_inventario(p_descricao text, p_escopo text default 'todos', p_categoria uuid default null)
returns uuid language plpgsql security definer set search_path = public as $$
declare v_emp uuid := public.auth_empresa_id(); v_id uuid;
begin
  if public.auth_papel() not in ('administrador','gerente') then raise exception 'Somente gerente ou administrador abre inventário'; end if;
  if nullif(trim(p_descricao), '') is null then raise exception 'Informe a descrição do inventário'; end if;
  if p_escopo not in ('todos','categoria','livre') then raise exception 'Abrangência inválida'; end if;
  if p_escopo = 'categoria' and not exists (select 1 from public.categorias where id = p_categoria and empresa_id = v_emp) then
    raise exception 'Escolha a categoria';
  end if;
  insert into public.inventarios(empresa_id, numero, descricao, escopo, categoria_id)
  values (v_emp, public.proximo_numero(v_emp, 'inventario'), trim(p_descricao), p_escopo, case when p_escopo = 'categoria' then p_categoria end)
  returning id into v_id;
  if p_escopo <> 'livre' then
    insert into public.inventario_itens(empresa_id, inventario_id, produto_id)
    select v_emp, v_id, p.id from public.produtos p
     where p.empresa_id = v_emp and p.ativo and not p.e_kit and not p.e_grade
       and (p_escopo = 'todos' or p.categoria_id = p_categoria);
  end if;
  return v_id;
end $$;

-- Registra uma leitura do coletor (qualquer usuário da empresa pode contar)
create or replace function public.contar_inventario(p_inventario uuid, p_codigo text, p_quantidade numeric default 1,
                                                    p_modo text default 'somar', p_produto uuid default null)
returns jsonb language plpgsql security definer set search_path = public as $$
declare v_emp uuid := public.auth_empresa_id(); inv public.inventarios; p public.produtos; it public.inventario_itens; v_novo numeric;
begin
  if v_emp is null then raise exception 'Usuário sem empresa vinculada'; end if;
  select * into inv from public.inventarios where id = p_inventario and empresa_id = v_emp;
  if not found then raise exception 'Inventário não encontrado'; end if;
  if inv.status <> 'aberto' then raise exception 'Inventário já encerrado'; end if;
  if p_modo not in ('somar','definir') then raise exception 'Modo inválido'; end if;
  if p_quantidade is null or (p_modo = 'definir' and p_quantidade < 0) then raise exception 'Quantidade inválida'; end if;
  if p_produto is not null then
    select * into p from public.produtos where id = p_produto and empresa_id = v_emp;
  else
    select * into p from public.produtos
     where empresa_id = v_emp and ativo and (ean = trim(p_codigo) or codigo = trim(p_codigo))
     order by coalesce(ean = trim(p_codigo), false) desc limit 1;
  end if;
  if not found then raise exception 'Produto não encontrado: %', coalesce(p_codigo, ''); end if;
  if p.e_kit then raise exception '% é um kit: conte os itens que o compõem', p.descricao; end if;
  if p.e_grade then raise exception '% é um modelo de grade: leia o código de cada tamanho e cor', p.descricao; end if;

  insert into public.inventario_itens(empresa_id, inventario_id, produto_id) values (v_emp, inv.id, p.id)
  on conflict (inventario_id, produto_id) do nothing;
  select * into it from public.inventario_itens where inventario_id = inv.id and produto_id = p.id for update;
  v_novo := case when p_modo = 'somar' then coalesce(it.contado, 0) + p_quantidade else p_quantidade end;
  if v_novo < 0 then raise exception 'A contagem não pode ficar negativa'; end if;
  update public.inventario_itens
     set contado = v_novo, contado_em = now(),
         estoque_sistema = coalesce(estoque_sistema, p.estoque_atual)
   where id = it.id;
  insert into public.inventario_leituras(empresa_id, inventario_id, produto_id, quantidade, modo, anterior)
  values (v_emp, inv.id, p.id, p_quantidade, p_modo, it.contado);
  return jsonb_build_object('produto_id', p.id, 'descricao', p.descricao, 'unidade', p.unidade, 'contado', v_novo,
                            'sistema', coalesce(it.estoque_sistema, p.estoque_atual));
end $$;

-- Importa o arquivo do coletor: [{codigo, quantidade}]
create or replace function public.importar_contagem(p_inventario uuid, p_linhas jsonb, p_modo text default 'somar')
returns jsonb language plpgsql security definer set search_path = public as $$
declare l jsonb; ok int := 0; faltam jsonb := '[]'::jsonb;
begin
  for l in select * from jsonb_array_elements(p_linhas) loop
    begin
      perform public.contar_inventario(p_inventario, l->>'codigo', coalesce((l->>'quantidade')::numeric, 1), p_modo);
      ok := ok + 1;
    exception when others then
      if sqlerrm like 'Inventário%' or sqlerrm like 'Usuário%' then raise; end if;
      faltam := faltam || jsonb_build_object('codigo', l->>'codigo', 'erro', sqlerrm);
    end;
  end loop;
  return jsonb_build_object('lidos', ok, 'rejeitados', faltam);
end $$;

create or replace function public.desfazer_leitura(p_leitura uuid)
returns void language plpgsql security definer set search_path = public as $$
declare v_emp uuid := public.auth_empresa_id(); l public.inventario_leituras;
begin
  select * into l from public.inventario_leituras where id = p_leitura and empresa_id = v_emp;
  if not found then raise exception 'Leitura não encontrada'; end if;
  if (select status from public.inventarios where id = l.inventario_id) <> 'aberto' then raise exception 'Inventário já encerrado'; end if;
  if l.usuario_id <> auth.uid() and public.auth_papel() = 'operador' then raise exception 'Só é possível desfazer as próprias leituras'; end if;
  if exists (select 1 from public.inventario_leituras where inventario_id = l.inventario_id and produto_id = l.produto_id and criado_em > l.criado_em) then
    raise exception 'Há leituras mais novas deste produto; desfaça-as primeiro';
  end if;
  update public.inventario_itens
     set contado = l.anterior, contado_em = case when l.anterior is null then null else contado_em end,
         estoque_sistema = case when l.anterior is null then null else estoque_sistema end
   where inventario_id = l.inventario_id and produto_id = l.produto_id;
  delete from public.inventario_leituras where id = l.id;
end $$;

-- Aplica as diferenças. Sobra/falta = contado - estoque no momento da 1ª contagem,
-- somada ao estoque atual (vendas feitas durante a contagem continuam valendo).
create or replace function public.finalizar_inventario(p_inventario uuid, p_zerar_nao_contados boolean default false)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_emp uuid := public.auth_empresa_id(); inv public.inventarios; it record; v_dif numeric; v_rest numeric; lt record; v_tira numeric;
  n int := 0; qs numeric := 0; qf numeric := 0; vs numeric := 0; vf numeric := 0; v_obs text;
begin
  if public.auth_papel() not in ('administrador','gerente') then raise exception 'Somente gerente ou administrador finaliza inventário'; end if;
  select * into inv from public.inventarios where id = p_inventario and empresa_id = v_emp for update;
  if not found then raise exception 'Inventário não encontrado'; end if;
  if inv.status <> 'aberto' then raise exception 'Inventário já encerrado'; end if;
  v_obs := 'Inventário nº ' || inv.numero;

  if p_zerar_nao_contados and inv.escopo <> 'livre' then
    update public.inventario_itens i set contado = 0, estoque_sistema = p.estoque_atual
      from public.produtos p where p.id = i.produto_id and i.inventario_id = inv.id and i.contado is null;
  end if;

  for it in
    select i.id, i.produto_id, i.contado, i.estoque_sistema, p.preco_custo, p.controla_lote
      from public.inventario_itens i join public.produtos p on p.id = i.produto_id
     where i.inventario_id = inv.id and i.contado is not null for update of i
  loop
    v_dif := it.contado - it.estoque_sistema;
    update public.inventario_itens set ajuste = v_dif, custo_unitario = it.preco_custo where id = it.id;
    continue when v_dif = 0;
    n := n + 1;
    if v_dif > 0 then
      qs := qs + v_dif; vs := vs + v_dif * it.preco_custo;
      insert into public.movimentos_estoque(empresa_id, produto_id, tipo, quantidade, custo_unitario, origem_id, observacao)
      values (v_emp, it.produto_id, 'inventario', v_dif, it.preco_custo, inv.id, v_obs);
    else
      qf := qf - v_dif; vf := vf - v_dif * it.preco_custo;
      v_rest := -v_dif;
      -- Falta em produto com lote: baixa dos lotes que vencem primeiro
      begin
        for lt in select id, quantidade from public.lotes where produto_id = it.produto_id and quantidade > 0
                   order by validade nulls last, criado_em loop
          exit when v_rest <= 0;
          v_tira := least(v_rest, lt.quantidade);
          insert into public.movimentos_estoque(empresa_id, produto_id, lote_id, tipo, quantidade, custo_unitario, origem_id, observacao)
          values (v_emp, it.produto_id, lt.id, 'inventario', -v_tira, it.preco_custo, inv.id, v_obs);
          v_rest := v_rest - v_tira;
        end loop;
      end;
      if v_rest > 0 then
        insert into public.movimentos_estoque(empresa_id, produto_id, tipo, quantidade, custo_unitario, origem_id, observacao)
        values (v_emp, it.produto_id, 'inventario', -v_rest, it.preco_custo, inv.id, v_obs);
      end if;
    end if;
  end loop;

  update public.inventarios
     set status = 'finalizado', finalizado_por = auth.uid(), finalizado_em = now(),
         resumo = jsonb_build_object('itens_ajustados', n, 'sobra_qtd', qs, 'falta_qtd', qf, 'sobra_valor', round(vs, 2), 'falta_valor', round(vf, 2),
                                     'contados', (select count(*) from public.inventario_itens where inventario_id = inv.id and contado is not null),
                                     'nao_contados', (select count(*) from public.inventario_itens where inventario_id = inv.id and contado is null))
   where id = inv.id;
  insert into public.auditoria(empresa_id, acao, entidade, entidade_id, detalhes)
  values (v_emp, 'finalizar_inventario', 'inventario', inv.id, (select resumo from public.inventarios where id = inv.id));
  return (select resumo from public.inventarios where id = inv.id);
end $$;

create or replace function public.cancelar_inventario(p_inventario uuid)
returns void language plpgsql security definer set search_path = public as $$
begin
  if public.auth_papel() not in ('administrador','gerente') then raise exception 'Somente gerente ou administrador'; end if;
  update public.inventarios set status = 'cancelado', finalizado_por = auth.uid(), finalizado_em = now()
   where id = p_inventario and empresa_id = public.auth_empresa_id() and status = 'aberto';
  if not found then raise exception 'Inventário não está aberto'; end if;
end $$;

-- =====================================================================
-- Transferência entre filiais (empresas do mesmo grupo, cada uma com seu CNPJ)
-- =====================================================================
alter table public.empresas add column if not exists grupo_id uuid;

create or replace function public.filiais()
returns table (id uuid, nome text, cnpj text) language sql stable security definer set search_path = public as $$
  select e.id, coalesce(e.nome_fantasia, e.razao_social), e.cnpj
    from public.empresas e, public.empresas eu
   where eu.id = public.auth_empresa_id() and eu.grupo_id is not null
     and e.grupo_id = eu.grupo_id and e.id <> eu.id and e.ativa
   order by 2
$$;

create table public.transferencias (
  id                 uuid primary key default gen_random_uuid(),
  numero             bigint not null,
  empresa_origem_id  uuid not null references public.empresas(id),
  empresa_destino_id uuid not null references public.empresas(id),
  origem_nome        text not null,
  destino_nome       text not null,
  status             text not null default 'enviada' check (status in ('enviada','recebida','cancelada')),
  observacao         text,
  valor_total        numeric(14,2) not null default 0,
  enviado_por        uuid not null default auth.uid(),
  enviado_em         timestamptz not null default now(),
  recebido_por       uuid,
  recebido_em        timestamptz,
  divergencias       integer not null default 0,
  check (empresa_origem_id <> empresa_destino_id)
);
create unique index on public.transferencias(empresa_origem_id, numero);

create table public.transferencia_itens (
  id                  uuid primary key default gen_random_uuid(),
  transferencia_id    uuid not null references public.transferencias(id),
  produto_origem_id   uuid not null references public.produtos(id),
  produto_destino_id  uuid references public.produtos(id),
  descricao           text not null,
  ean                 text,
  unidade             text not null,
  quantidade          numeric(14,3) not null check (quantidade > 0),
  quantidade_recebida numeric(14,3),
  custo_unitario      numeric(12,4) not null default 0,
  lote_numero         text,
  validade            date
);
create index on public.transferencia_itens(transferencia_id);

alter table public.transferencias enable row level security;
alter table public.transferencia_itens enable row level security;
create policy transferencias_select on public.transferencias for select
  using (public.auth_papel() in ('administrador','gerente')
         and public.auth_empresa_id() in (empresa_origem_id, empresa_destino_id));
create policy transferencia_itens_select on public.transferencia_itens for select
  using (exists (select 1 from public.transferencias t where t.id = transferencia_id));

-- p_itens: [{produto_id, quantidade, lote_id?}]
create or replace function public.enviar_transferencia(p_destino uuid, p_itens jsonb, p_obs text default null)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_emp uuid := public.auth_empresa_id(); v_id uuid; v_num bigint; it jsonb; p public.produtos; lt public.lotes;
  v_qtd numeric; v_total numeric := 0; n int := 0;
begin
  if public.auth_papel() not in ('administrador','gerente') then raise exception 'Somente gerente ou administrador'; end if;
  if not exists (select 1 from public.filiais() f where f.id = p_destino) then raise exception 'Filial de destino inválida'; end if;
  if jsonb_array_length(coalesce(p_itens, '[]')) = 0 then raise exception 'Inclua os produtos'; end if;
  v_num := public.proximo_numero(v_emp, 'transferencia');
  insert into public.transferencias(numero, empresa_origem_id, empresa_destino_id, origem_nome, destino_nome, observacao)
  values (v_num, v_emp, p_destino,
          (select coalesce(nome_fantasia, razao_social) from public.empresas where id = v_emp),
          (select coalesce(nome_fantasia, razao_social) from public.empresas where id = p_destino), nullif(trim(p_obs), ''))
  returning id into v_id;
  for it in select * from jsonb_array_elements(p_itens) loop
    v_qtd := (it->>'quantidade')::numeric;
    if v_qtd is null or v_qtd <= 0 then raise exception 'Quantidade inválida'; end if;
    select * into p from public.produtos where id = (it->>'produto_id')::uuid and empresa_id = v_emp;
    if not found then raise exception 'Produto não encontrado'; end if;
    if p.e_kit or p.e_grade then raise exception '% não tem estoque próprio', p.descricao; end if;
    lt := null;
    if it->>'lote_id' is not null then
      select * into lt from public.lotes where id = (it->>'lote_id')::uuid and produto_id = p.id;
      if not found then raise exception 'Lote inválido para %', p.descricao; end if;
      if lt.quantidade < v_qtd then raise exception 'Lote % de % tem só %', lt.numero, p.descricao, lt.quantidade; end if;
    end if;
    if p.estoque_atual < v_qtd then raise exception 'Estoque insuficiente de % (disponível %)', p.descricao, p.estoque_atual; end if;
    insert into public.transferencia_itens(transferencia_id, produto_origem_id, descricao, ean, unidade, quantidade, custo_unitario, lote_numero, validade)
    values (v_id, p.id, p.descricao, p.ean, p.unidade, v_qtd, p.preco_custo, lt.numero, lt.validade);
    insert into public.movimentos_estoque(empresa_id, produto_id, lote_id, tipo, quantidade, custo_unitario, origem_id, observacao)
    values (v_emp, p.id, lt.id, 'transferencia_saida', -v_qtd, p.preco_custo, v_id, 'Transferência nº ' || v_num);
    v_total := v_total + v_qtd * p.preco_custo; n := n + 1;
  end loop;
  update public.transferencias set valor_total = round(v_total, 2) where id = v_id;
  return jsonb_build_object('transferencia_id', v_id, 'numero', v_num, 'itens', n);
end $$;

-- p_itens: [{item_id, produto_id (do destino; nulo = procurar pelo código de barras ou cadastrar), quantidade_recebida}]
create or replace function public.receber_transferencia(p_transferencia uuid, p_itens jsonb)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_emp uuid := public.auth_empresa_id(); t public.transferencias; i public.transferencia_itens; po public.produtos;
  r jsonb; v_prod uuid; v_qtd numeric; v_lote uuid; v_div int := 0; novos int := 0;
begin
  if public.auth_papel() not in ('administrador','gerente') then raise exception 'Somente gerente ou administrador'; end if;
  select * into t from public.transferencias where id = p_transferencia and empresa_destino_id = v_emp for update;
  if not found then raise exception 'Transferência não encontrada'; end if;
  if t.status <> 'enviada' then raise exception 'Transferência já recebida ou cancelada'; end if;
  for i in select * from public.transferencia_itens where transferencia_id = t.id loop
    select x into r from jsonb_array_elements(p_itens) x where (x->>'item_id')::uuid = i.id;
    v_qtd := coalesce((r->>'quantidade_recebida')::numeric, i.quantidade);
    if v_qtd < 0 then raise exception 'Quantidade recebida inválida'; end if;
    v_prod := (r->>'produto_id')::uuid;
    if v_prod is not null and not exists (select 1 from public.produtos where id = v_prod and empresa_id = v_emp and not e_kit and not e_grade) then
      raise exception 'Produto de destino inválido para %', i.descricao;
    end if;
    if v_prod is null and i.ean is not null then
      select id into v_prod from public.produtos where empresa_id = v_emp and ean = i.ean and not e_kit and not e_grade limit 1;
    end if;
    if v_prod is null then
      select * into po from public.produtos where id = i.produto_origem_id;
      insert into public.produtos(empresa_id, descricao, ean, unidade, preco_venda, preco_custo, controla_lote, ncm, cest, cfop, origem, csosn,
                                  cst_icms, aliquota_icms, registro_ms, controlado)
      values (v_emp, po.descricao, po.ean, po.unidade, po.preco_venda, po.preco_custo, po.controla_lote, po.ncm, po.cest, po.cfop, po.origem,
              po.csosn, po.cst_icms, po.aliquota_icms, po.registro_ms, po.controlado)
      returning id into v_prod;
      novos := novos + 1;
    end if;
    v_lote := null;
    if i.lote_numero is not null then
      insert into public.lotes(empresa_id, produto_id, numero, validade) values (v_emp, v_prod, i.lote_numero, i.validade)
      on conflict (produto_id, numero) do update set validade = coalesce(public.lotes.validade, excluded.validade)
      returning id into v_lote;
    end if;
    if v_qtd > 0 then
      insert into public.movimentos_estoque(empresa_id, produto_id, lote_id, tipo, quantidade, custo_unitario, origem_id, observacao)
      values (v_emp, v_prod, v_lote, 'transferencia_entrada', v_qtd, i.custo_unitario, t.id, 'Transferência nº ' || t.numero || ' de ' || t.origem_nome);
    end if;
    if v_qtd <> i.quantidade then v_div := v_div + 1; end if;
    update public.transferencia_itens set produto_destino_id = v_prod, quantidade_recebida = v_qtd where id = i.id;
  end loop;
  update public.transferencias set status = 'recebida', recebido_por = auth.uid(), recebido_em = now(), divergencias = v_div where id = t.id;
  if v_div > 0 then
    insert into public.auditoria(empresa_id, acao, entidade, entidade_id, detalhes)
    values (v_emp, 'transferencia_divergente', 'transferencia', t.id, jsonb_build_object('numero', t.numero, 'origem', t.origem_nome, 'itens_divergentes', v_div));
  end if;
  return jsonb_build_object('divergencias', v_div, 'produtos_novos', novos);
end $$;

create or replace function public.cancelar_transferencia(p_transferencia uuid)
returns void language plpgsql security definer set search_path = public as $$
declare v_emp uuid := public.auth_empresa_id(); t public.transferencias; m record;
begin
  if public.auth_papel() not in ('administrador','gerente') then raise exception 'Somente gerente ou administrador'; end if;
  select * into t from public.transferencias where id = p_transferencia and empresa_origem_id = v_emp for update;
  if not found then raise exception 'Transferência não encontrada'; end if;
  if t.status <> 'enviada' then raise exception 'Só é possível cancelar antes de a filial receber'; end if;
  for m in select * from public.movimentos_estoque where origem_id = t.id and empresa_id = v_emp and tipo = 'transferencia_saida' loop
    insert into public.movimentos_estoque(empresa_id, produto_id, lote_id, tipo, quantidade, custo_unitario, origem_id, observacao)
    values (v_emp, m.produto_id, m.lote_id, 'transferencia_entrada', -m.quantidade, m.custo_unitario, t.id, 'Cancelamento da transferência nº ' || t.numero);
  end loop;
  update public.transferencias set status = 'cancelada' where id = t.id;
end $$;

-- =====================================================================
-- Financeiro: saldo por conta, movimentos avulsos, transferências e metas
-- =====================================================================
alter table public.empresas
  add column if not exists teto_gastos numeric(14,2),
  add column if not exists meta_retirada_pct numeric(5,2);

create table public.movimentos_conta (
  id                uuid primary key default gen_random_uuid(),
  empresa_id        uuid not null references public.empresas(id),
  conta_bancaria_id uuid not null references public.contas_bancarias(id),
  data              date not null,
  valor             numeric(14,2) not null check (valor <> 0),   -- positivo entra, negativo sai
  tipo              text not null check (tipo in ('transferencia','deposito_vendas','ajuste')),
  descricao         text not null,
  grupo_id          uuid,
  usuario_id        uuid not null default auth.uid(),
  criado_em         timestamptz not null default now()
);
create index on public.movimentos_conta(empresa_id, conta_bancaria_id, data);
create trigger movimentos_conta_empresa before insert or update on public.movimentos_conta for each row execute function public.fixar_empresa();
alter table public.movimentos_conta enable row level security;
create policy movimentos_conta_select on public.movimentos_conta for select
  using (empresa_id = public.auth_empresa_id() and public.auth_papel() in ('administrador','gerente'));

create or replace function public.movimentar_conta(p_conta uuid, p_valor numeric, p_tipo text, p_descricao text,
                                                   p_data date default null, p_destino uuid default null)
returns uuid language plpgsql security definer set search_path = public as $$
declare v_emp uuid := public.auth_empresa_id(); v_g uuid := gen_random_uuid(); v_d date := coalesce(p_data, (now() at time zone 'America/Sao_Paulo')::date);
begin
  if public.auth_papel() not in ('administrador','gerente') then raise exception 'Somente gerente ou administrador'; end if;
  if not exists (select 1 from public.contas_bancarias where id = p_conta and empresa_id = v_emp) then raise exception 'Conta inválida'; end if;
  if nullif(trim(p_descricao), '') is null then raise exception 'Informe a descrição'; end if;
  if p_tipo = 'transferencia' then
    if p_valor is null or p_valor <= 0 then raise exception 'Valor inválido'; end if;
    if p_destino is null or p_destino = p_conta or not exists (select 1 from public.contas_bancarias where id = p_destino and empresa_id = v_emp) then
      raise exception 'Conta de destino inválida';
    end if;
    insert into public.movimentos_conta(empresa_id, conta_bancaria_id, data, valor, tipo, descricao, grupo_id)
    values (v_emp, p_conta, v_d, -round(p_valor, 2), 'transferencia', trim(p_descricao), v_g),
           (v_emp, p_destino, v_d, round(p_valor, 2), 'transferencia', trim(p_descricao), v_g);
  elsif p_tipo in ('deposito_vendas','ajuste') then
    if p_valor is null or p_valor = 0 or (p_tipo = 'deposito_vendas' and p_valor < 0) then raise exception 'Valor inválido'; end if;
    insert into public.movimentos_conta(empresa_id, conta_bancaria_id, data, valor, tipo, descricao, grupo_id)
    values (v_emp, p_conta, v_d, round(p_valor, 2), p_tipo, trim(p_descricao), v_g);
  else
    raise exception 'Tipo inválido';
  end if;
  return v_g;
end $$;

create or replace function public.saldos_contas()
returns jsonb language sql stable security invoker set search_path = public as $$
  select coalesce(jsonb_agg(jsonb_build_object('id', c.id, 'nome', c.nome, 'tipo', c.tipo, 'ativo', c.ativo,
           'saldo', c.saldo_inicial
             + coalesce((select sum(case when l.tipo = 'receber' then b.valor + b.juros else -(b.valor + b.juros) end)
                           from public.lancamento_baixas b join public.lancamentos l on l.id = b.lancamento_id
                          where b.conta_bancaria_id = c.id and b.data >= c.data_saldo), 0)
             + coalesce((select sum(m.valor) from public.movimentos_conta m where m.conta_bancaria_id = c.id and m.data >= c.data_saldo), 0))
         order by c.nome), '[]'::jsonb)
    from public.contas_bancarias c
$$;

-- Visão geral do mês: projeção, comprometido, metas e despesas por conta em 6 meses
create or replace function public.painel_financeiro()
returns jsonb language plpgsql stable security invoker set search_path = public as $$
declare
  v_hoje date := (now() at time zone 'America/Sao_Paulo')::date;
  v_ini date := date_trunc('month', v_hoje)::date;
  v_fim date := (date_trunc('month', v_hoje) + interval '1 month - 1 day')::date;
  v_emp public.empresas;
  r jsonb;
begin
  select * into v_emp from public.empresas where id = public.auth_empresa_id();
  with vendas as (
    select (criado_em at time zone 'America/Sao_Paulo')::date dia, sum(total) total
      from public.vendas where status = 'concluida'
       and (criado_em at time zone 'America/Sao_Paulo')::date >= (v_ini - interval '3 months')::date
     group by 1),
  pagos as (   -- despesas pagas no mês, fora compras de estoque e não operacionais
    select coalesce(sum(b.valor + b.juros), 0) v from public.lancamento_baixas b
      join public.lancamentos l on l.id = b.lancamento_id join public.plano_contas pc on pc.id = l.plano_conta_id
     where l.tipo = 'pagar' and b.data between v_ini and v_fim and pc.grupo_dre not in ('estoque','nao_operacional')),
  a_vencer as (
    select coalesce(sum(l.valor - l.valor_pago), 0) v from public.lancamentos l join public.plano_contas pc on pc.id = l.plano_conta_id
     where l.tipo = 'pagar' and l.status = 'aberto' and l.vencimento <= v_fim and pc.grupo_dre not in ('estoque','nao_operacional')),
  compras as (
    select coalesce(sum(b.valor + b.juros), 0) v from public.lancamento_baixas b
      join public.lancamentos l on l.id = b.lancamento_id join public.plano_contas pc on pc.id = l.plano_conta_id
     where l.tipo = 'pagar' and b.data between v_ini and v_fim and pc.grupo_dre = 'estoque'),
  retiradas as (
    select coalesce(sum(b.valor), 0) v from public.lancamento_baixas b
      join public.lancamentos l on l.id = b.lancamento_id join public.plano_contas pc on pc.id = l.plano_conta_id
     where l.tipo = 'pagar' and b.data between v_ini and v_fim and pc.codigo in ('4.04','6.01')),
  meses as (select generate_series(0, 5) k),
  despesas as (
    select pc.codigo, pc.nome, (date_part('year', age(date_trunc('month', l.competencia), v_ini)) * 12
                                + date_part('month', age(date_trunc('month', l.competencia), v_ini)))::int k, sum(l.valor) v
      from public.lancamentos l join public.plano_contas pc on pc.id = l.plano_conta_id
     where l.tipo = 'pagar' and l.status <> 'cancelado' and pc.grupo_dre not in ('estoque','nao_operacional')
       and l.competencia between (v_ini - interval '5 months')::date and v_fim
     group by 1, 2, 3)
  select jsonb_build_object(
    'hoje', v_hoje, 'dias_mes', extract(day from v_fim)::int,
    'vendas_mes', coalesce((select sum(total) from vendas where dia >= v_ini), 0),
    'dias_com_venda', (select count(*) from vendas where dia >= v_ini),
    'venda_hoje', coalesce((select total from vendas where dia = v_hoje), 0),
    'vendas_3_meses', (select coalesce(jsonb_agg(t order by m), '[]'::jsonb) from (
        select date_trunc('month', dia)::date m, sum(total) t from vendas where dia < v_ini group by 1) x),
    'pagos_mes', (select v from pagos), 'a_vencer_mes', (select v from a_vencer),
    'compras_mes', (select v from compras), 'retiradas_mes', (select v from retiradas),
    'a_pagar_total', (select coalesce(sum(valor - valor_pago), 0) from public.lancamentos where tipo = 'pagar' and status = 'aberto'),
    'a_receber_total', (select coalesce(sum(valor - valor_pago), 0) from public.lancamentos where tipo = 'receber' and status = 'aberto')
                       + (select coalesce(sum(valor - valor_pago), 0) from public.contas_receber where status = 'aberta'),
    'teto_gastos', v_emp.teto_gastos, 'meta_retirada_pct', v_emp.meta_retirada_pct,
    'saldos', public.saldos_contas(),
    'despesas', (select coalesce(jsonb_agg(jsonb_build_object('codigo', codigo, 'nome', nome, 'meses', meses) order by codigo), '[]'::jsonb) from (
        select d.codigo, d.nome, jsonb_agg(jsonb_build_object('k', d.k, 'v', d.v) order by d.k) meses from despesas d group by 1, 2) y)
  ) into r;
  return r;
end $$;

grant execute on function public.abrir_inventario(text, text, uuid), public.contar_inventario(uuid, text, numeric, text, uuid),
  public.importar_contagem(uuid, jsonb, text), public.desfazer_leitura(uuid), public.finalizar_inventario(uuid, boolean),
  public.cancelar_inventario(uuid), public.filiais(), public.enviar_transferencia(uuid, jsonb, text),
  public.receber_transferencia(uuid, jsonb), public.cancelar_transferencia(uuid),
  public.movimentar_conta(uuid, numeric, text, text, date, uuid), public.saldos_contas(), public.painel_financeiro() to authenticated;
revoke execute on function public.abrir_inventario(text, text, uuid), public.contar_inventario(uuid, text, numeric, text, uuid),
  public.importar_contagem(uuid, jsonb, text), public.desfazer_leitura(uuid), public.finalizar_inventario(uuid, boolean),
  public.cancelar_inventario(uuid), public.filiais(), public.enviar_transferencia(uuid, jsonb, text),
  public.receber_transferencia(uuid, jsonb), public.cancelar_transferencia(uuid),
  public.movimentar_conta(uuid, numeric, text, text, date, uuid), public.saldos_contas(), public.painel_financeiro() from anon, public;
