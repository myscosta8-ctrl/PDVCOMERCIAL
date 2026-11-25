-- Segmento restaurante: mesas, comandas, pedidos para a cozinha e fechamento da conta pela venda normal (com NFC-e).
-- O garçom (operador) abre comandas e lança itens; cancelamentos depois do envio à cozinha exigem gerente.

alter table public.produtos add column if not exists cozinha boolean not null default false;   -- item preparado na cozinha

create table if not exists public.mesas (
  id          uuid primary key default gen_random_uuid(),
  empresa_id  uuid not null references public.empresas(id),
  numero      integer not null check (numero > 0),
  nome        text,
  lugares     smallint check (lugares > 0),
  ativo       boolean not null default true,
  unique (empresa_id, numero)
);

create table if not exists public.comandas (
  id            uuid primary key default gen_random_uuid(),
  empresa_id    uuid not null references public.empresas(id),
  numero        bigint not null,
  mesa_id       uuid references public.mesas(id),
  identificacao text,                       -- cartão, nome do cliente ou "balcão"
  pessoas       smallint not null default 1 check (pessoas between 1 and 99),
  status        text not null default 'aberta' check (status in ('aberta','fechada','cancelada')),
  observacao    text,
  aberta_por    uuid not null default auth.uid(),
  aberta_em     timestamptz not null default now(),
  fechada_em    timestamptz,
  venda_id      uuid references public.vendas(id),
  motivo_cancelamento text,
  unique (empresa_id, numero)
);
create unique index if not exists comandas_mesa_aberta on public.comandas(mesa_id) where status = 'aberta' and mesa_id is not null;
create index if not exists comandas_abertas on public.comandas(empresa_id, status);

create table if not exists public.comanda_itens (
  id             uuid primary key default gen_random_uuid(),
  empresa_id     uuid not null references public.empresas(id),
  comanda_id     uuid not null references public.comandas(id),
  produto_id     uuid not null references public.produtos(id),
  descricao      text not null,
  quantidade     numeric(14,3) not null check (quantidade > 0),
  preco_unitario numeric(12,2) not null check (preco_unitario >= 0),
  observacao     text,
  cozinha        boolean not null default false,
  status         text not null default 'pendente' check (status in ('pendente','pronto','entregue','cancelado')),
  lancado_por    uuid not null default auth.uid(),
  lancado_em     timestamptz not null default now(),
  pronto_em      timestamptz,
  cancelado_por  uuid,
  motivo         text
);
create index if not exists comanda_itens_comanda on public.comanda_itens(comanda_id);
create index if not exists comanda_itens_cozinha on public.comanda_itens(empresa_id, status) where cozinha;

do $$ declare t text; begin
  foreach t in array array['mesas','comandas','comanda_itens'] loop
    execute format('alter table public.%I enable row level security', t);
    execute format('drop trigger if exists %I on public.%I', t || '_empresa', t);
    execute format('create trigger %I before insert or update on public.%I for each row execute function public.fixar_empresa()', t || '_empresa', t);
    execute format('drop policy if exists %I on public.%I', t || '_select', t);
    execute format('create policy %I on public.%I for select to authenticated using (empresa_id = public.auth_empresa_id())', t || '_select', t);
  end loop;
end $$;
-- Mesas: cadastro pelo gerente ou administrador; comandas e itens só pelas funções abaixo
drop policy if exists mesas_gestor on public.mesas;
create policy mesas_gestor on public.mesas for all to authenticated
  using (empresa_id = public.auth_empresa_id() and public.auth_papel() in ('administrador','gerente'))
  with check (empresa_id = public.auth_empresa_id() and public.auth_papel() in ('administrador','gerente'));
revoke insert, update, delete on public.comandas, public.comanda_itens from anon, authenticated;
grant select on public.mesas, public.comandas, public.comanda_itens to authenticated;
grant insert, update on public.mesas to authenticated;

-- ---------------------------------------------------------------- Funções
create or replace function public.comanda_aberta(p_comanda uuid)
returns public.comandas language plpgsql stable security definer set search_path = public as $$
declare c public.comandas;
begin
  select * into c from public.comandas where id = p_comanda and empresa_id = public.auth_empresa_id();
  if not found then raise exception 'Comanda não encontrada'; end if;
  if c.status <> 'aberta' then raise exception 'A comanda nº % não está aberta', c.numero; end if;
  return c;
end $$;
revoke execute on function public.comanda_aberta(uuid) from public, anon, authenticated;

create or replace function public.abrir_comanda(p_mesa uuid default null, p_identificacao text default null, p_pessoas integer default 1)
returns uuid language plpgsql security definer set search_path = public as $$
declare v_emp uuid := public.auth_empresa_id(); v_id uuid; v_num bigint;
begin
  if v_emp is null then raise exception 'Usuário sem empresa vinculada'; end if;
  if p_mesa is null and coalesce(trim(p_identificacao), '') = '' then raise exception 'Escolha a mesa ou informe a identificação da comanda'; end if;
  if p_mesa is not null then
    if not exists (select 1 from public.mesas where id = p_mesa and empresa_id = v_emp and ativo) then raise exception 'Mesa não encontrada'; end if;
    if exists (select 1 from public.comandas where mesa_id = p_mesa and status = 'aberta') then raise exception 'A mesa já tem comanda aberta'; end if;
  end if;
  v_num := public.proximo_numero(v_emp, 'comanda');
  insert into public.comandas(empresa_id, numero, mesa_id, identificacao, pessoas)
  values (v_emp, v_num, p_mesa, nullif(trim(p_identificacao), ''), greatest(1, least(99, coalesce(p_pessoas, 1))))
  returning id into v_id;
  return v_id;
end $$;

-- Lança itens com o preço vigente: [{ produto_id, quantidade, observacao }]
create or replace function public.lancar_itens_comanda(p_comanda uuid, p_itens jsonb)
returns integer language plpgsql security definer set search_path = public as $$
declare c public.comandas; it jsonb; pr public.produtos; v_qtd numeric; n int := 0;
begin
  c := public.comanda_aberta(p_comanda);
  if jsonb_array_length(coalesce(p_itens, '[]')) = 0 then raise exception 'Nenhum item para lançar'; end if;
  for it in select * from jsonb_array_elements(p_itens) loop
    select * into pr from public.produtos where id = (it->>'produto_id')::uuid and empresa_id = c.empresa_id and ativo;
    if not found then raise exception 'Produto não encontrado'; end if;
    if pr.e_grade then raise exception 'Escolha o tamanho e a cor de %', pr.descricao; end if;
    v_qtd := (it->>'quantidade')::numeric;
    if v_qtd is null or v_qtd <= 0 or v_qtd > 999 then raise exception 'Quantidade inválida para %', pr.descricao; end if;
    insert into public.comanda_itens(empresa_id, comanda_id, produto_id, descricao, quantidade, preco_unitario, observacao, cozinha)
    values (c.empresa_id, c.id, pr.id, pr.descricao, v_qtd, (public.preco_vigente(pr.id, v_qtd, null)->>'preco')::numeric,
            nullif(left(trim(it->>'observacao'), 140), ''), pr.cozinha);
    n := n + 1;
  end loop;
  return n;
end $$;

-- Cancela um item: quem lançou pode desfazer enquanto a cozinha não preparou; depois disso, só gerente
create or replace function public.cancelar_item_comanda(p_item uuid, p_motivo text)
returns void language plpgsql security definer set search_path = public as $$
declare i public.comanda_itens; v_papel text := public.auth_papel();
begin
  select * into i from public.comanda_itens where id = p_item and empresa_id = public.auth_empresa_id() for update;
  if not found then raise exception 'Item não encontrado'; end if;
  perform public.comanda_aberta(i.comanda_id);
  if i.status = 'cancelado' then raise exception 'O item já está cancelado'; end if;
  if length(trim(coalesce(p_motivo, ''))) < 3 then raise exception 'Informe o motivo do cancelamento'; end if;
  if v_papel = 'operador' and not (i.lancado_por = auth.uid() and i.status = 'pendente' and (not i.cozinha or i.lancado_em > now() - interval '2 minutes')) then
    raise exception 'Cancelar item já enviado à cozinha ou lançado por outra pessoa exige gerente';
  end if;
  update public.comanda_itens set status = 'cancelado', cancelado_por = auth.uid(), motivo = trim(p_motivo) where id = p_item;
  insert into public.auditoria(empresa_id, acao, entidade, entidade_id, detalhes)
  values (i.empresa_id, 'cancelar_item_comanda', 'comanda', i.comanda_id,
          jsonb_build_object('item', i.descricao, 'quantidade', i.quantidade, 'valor', i.quantidade * i.preco_unitario, 'motivo', trim(p_motivo)));
end $$;

-- Cozinha: pendente -> pronto -> entregue
create or replace function public.situacao_item_comanda(p_item uuid, p_status text)
returns void language plpgsql security definer set search_path = public as $$
declare i public.comanda_itens;
begin
  select * into i from public.comanda_itens where id = p_item and empresa_id = public.auth_empresa_id() for update;
  if not found then raise exception 'Item não encontrado'; end if;
  if p_status not in ('pendente','pronto','entregue') or i.status = 'cancelado' then raise exception 'Situação inválida'; end if;
  update public.comanda_itens set status = p_status, pronto_em = case when p_status = 'pronto' then now() when p_status = 'pendente' then null else pronto_em end
   where id = p_item;
end $$;

create or replace function public.transferir_comanda(p_comanda uuid, p_mesa uuid)
returns void language plpgsql security definer set search_path = public as $$
declare c public.comandas;
begin
  c := public.comanda_aberta(p_comanda);
  if p_mesa is not null then
    if not exists (select 1 from public.mesas where id = p_mesa and empresa_id = c.empresa_id and ativo) then raise exception 'Mesa não encontrada'; end if;
    if exists (select 1 from public.comandas where mesa_id = p_mesa and status = 'aberta' and id <> c.id) then raise exception 'A mesa de destino já está ocupada; use Juntar comandas'; end if;
  elsif c.identificacao is null then
    raise exception 'Informe a identificação antes de tirar a comanda da mesa';
  end if;
  update public.comandas set mesa_id = p_mesa where id = c.id;
end $$;

-- Junta a comanda de origem na de destino (os itens passam para o destino e a origem é encerrada)
create or replace function public.juntar_comandas(p_origem uuid, p_destino uuid)
returns void language plpgsql security definer set search_path = public as $$
declare o public.comandas; d public.comandas;
begin
  if p_origem = p_destino then raise exception 'Escolha comandas diferentes'; end if;
  o := public.comanda_aberta(p_origem);
  d := public.comanda_aberta(p_destino);
  update public.comanda_itens set comanda_id = d.id where comanda_id = o.id;
  update public.comandas set pessoas = least(99, d.pessoas + o.pessoas) where id = d.id;
  update public.comandas set status = 'cancelada', fechada_em = now(), motivo_cancelamento = format('Juntada à comanda nº %s', d.numero) where id = o.id;
end $$;

create or replace function public.cancelar_comanda(p_comanda uuid, p_motivo text)
returns void language plpgsql security definer set search_path = public as $$
declare c public.comandas;
begin
  c := public.comanda_aberta(p_comanda);
  if length(trim(coalesce(p_motivo, ''))) < 5 then raise exception 'Informe o motivo do cancelamento'; end if;
  if exists (select 1 from public.comanda_itens where comanda_id = c.id and status <> 'cancelado')
     and public.auth_papel() not in ('administrador','gerente') then
    raise exception 'Comanda com itens: o cancelamento exige gerente';
  end if;
  update public.comanda_itens set status = 'cancelado', cancelado_por = auth.uid(), motivo = coalesce(motivo, 'Comanda cancelada')
   where comanda_id = c.id and status <> 'cancelado';
  update public.comandas set status = 'cancelada', fechada_em = now(), motivo_cancelamento = trim(p_motivo) where id = c.id;
  insert into public.auditoria(empresa_id, acao, entidade, entidade_id, detalhes)
  values (c.empresa_id, 'cancelar_comanda', 'comanda', c.id, jsonb_build_object('numero', c.numero, 'motivo', trim(p_motivo)));
end $$;

-- Fecha a conta: os itens da comanda viram uma venda normal (mesmas regras de pagamento, estoque e NFC-e).
-- Aceita os mesmos parâmetros da venda; os itens vêm da comanda, com o preço vigente no fechamento.
create or replace function public.fechar_comanda(
  p_comanda uuid, p_caixa uuid, p_pagamentos jsonb, p_itens jsonb default null,
  p_desconto numeric default 0, p_cliente uuid default null, p_cpf text default null, p_tabela uuid default null,
  p_receitas jsonb default null)
returns jsonb language plpgsql security definer set search_path = public as $$
declare c public.comandas; v_itens jsonb; r jsonb;
begin
  select * into c from public.comandas where id = p_comanda and empresa_id = public.auth_empresa_id() for update;
  if not found then raise exception 'Comanda não encontrada'; end if;
  if c.status <> 'aberta' then raise exception 'A comanda nº % não está aberta', c.numero; end if;
  select jsonb_agg(jsonb_build_object('produto_id', produto_id, 'quantidade', q)) into v_itens
    from (select produto_id, sum(quantidade) q from public.comanda_itens where comanda_id = c.id and status <> 'cancelado' group by produto_id) x;
  if v_itens is null then raise exception 'A comanda não tem itens. Cancele a comanda em vez de fechar.'; end if;
  r := public.finalizar_venda(p_caixa, v_itens, p_pagamentos, p_desconto, p_cliente, p_cpf, p_tabela, p_receitas);
  update public.comandas set status = 'fechada', fechada_em = now(), venda_id = (r->>'venda_id')::uuid where id = c.id;
  update public.comanda_itens set status = 'entregue' where comanda_id = c.id and status in ('pendente','pronto');
  return r || jsonb_build_object('comanda', c.numero);
end $$;

revoke execute on function public.abrir_comanda(uuid, text, integer), public.lancar_itens_comanda(uuid, jsonb), public.cancelar_item_comanda(uuid, text),
  public.situacao_item_comanda(uuid, text), public.transferir_comanda(uuid, uuid), public.juntar_comandas(uuid, uuid), public.cancelar_comanda(uuid, text),
  public.fechar_comanda(uuid, uuid, jsonb, jsonb, numeric, uuid, text, uuid, jsonb) from public, anon;
grant execute on function public.abrir_comanda(uuid, text, integer), public.lancar_itens_comanda(uuid, jsonb), public.cancelar_item_comanda(uuid, text),
  public.situacao_item_comanda(uuid, text), public.transferir_comanda(uuid, uuid), public.juntar_comandas(uuid, uuid), public.cancelar_comanda(uuid, text),
  public.fechar_comanda(uuid, uuid, jsonb, jsonb, numeric, uuid, text, uuid, jsonb) to authenticated;
