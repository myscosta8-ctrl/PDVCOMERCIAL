-- Listas de compras: geradas pelo estoque (abaixo do mínimo ou pelo consumo) ou digitadas à mão,
-- com itens do cadastro ou avulsos (texto livre). Servem para cotar, enviar ao fornecedor e conferir a compra.

create table if not exists public.listas_compra (
  id             uuid primary key default gen_random_uuid(),
  empresa_id     uuid not null references public.empresas(id),
  numero         bigint not null,
  nome           text not null,
  fornecedor_id  uuid references public.fornecedores(id),
  status         text not null default 'aberta' check (status in ('aberta','enviada','concluida','cancelada')),
  observacoes    text,
  criado_por     uuid not null default auth.uid(),
  criado_em      timestamptz not null default now(),
  atualizado_em  timestamptz not null default now(),
  unique (empresa_id, numero)
);
create index if not exists listas_compra_status on public.listas_compra(empresa_id, status);

create table if not exists public.lista_compra_itens (
  id              uuid primary key default gen_random_uuid(),
  empresa_id      uuid not null references public.empresas(id),
  lista_id        uuid not null references public.listas_compra(id) on delete cascade,
  produto_id      uuid references public.produtos(id),      -- nulo = item avulso digitado
  descricao       text not null,
  unidade         text not null default 'UN',
  quantidade      numeric(14,3) not null check (quantidade > 0),
  custo_estimado  numeric(12,4) check (custo_estimado is null or custo_estimado >= 0),
  comprado        boolean not null default false,
  observacao      text,
  origem          text not null default 'manual' check (origem in ('estoque','manual')),
  criado_em       timestamptz not null default now(),
  unique (lista_id, produto_id)
);
create index if not exists lista_compra_itens_lista on public.lista_compra_itens(lista_id);

do $$ declare t text; begin
  foreach t in array array['listas_compra','lista_compra_itens'] loop
    execute format('alter table public.%I enable row level security', t);
    execute format('drop trigger if exists %I on public.%I', t || '_empresa', t);
    execute format('create trigger %I before insert or update on public.%I for each row execute function public.fixar_empresa()', t || '_empresa', t);
    execute format('drop policy if exists %I on public.%I', t || '_empresa', t);
    execute format('create policy %I on public.%I for all to authenticated using (empresa_id = public.auth_empresa_id()) with check (empresa_id = public.auth_empresa_id())', t || '_empresa', t);
  end loop;
end $$;
grant select, insert, update on public.listas_compra to authenticated;
grant select, insert, update, delete on public.lista_compra_itens to authenticated;
revoke delete on public.listas_compra from authenticated;

-- Número sequencial, nome obrigatório e trava das listas concluídas ou canceladas
create or replace function public.listas_compra_regras()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if coalesce(trim(new.nome), '') = '' then raise exception 'Dê um nome à lista'; end if;
  if new.fornecedor_id is not null and not exists (select 1 from public.fornecedores where id = new.fornecedor_id and empresa_id = new.empresa_id) then
    raise exception 'Fornecedor inválido';
  end if;
  if tg_op = 'INSERT' then
    new.numero := public.proximo_numero(new.empresa_id, 'lista_compra');
    new.status := 'aberta';
    return new;
  end if;
  if old.status in ('concluida','cancelada') then raise exception 'A lista nº % já está %', old.numero, old.status; end if;
  new.numero := old.numero; new.criado_por := old.criado_por; new.criado_em := old.criado_em;
  new.atualizado_em := now();
  return new;
end $$;
drop trigger if exists listas_compra_regras on public.listas_compra;
create trigger listas_compra_regras before insert or update on public.listas_compra for each row execute function public.listas_compra_regras();

create or replace function public.lista_compra_itens_regras()
returns trigger language plpgsql security definer set search_path = public as $$
declare v_status text; v_emp uuid;
begin
  select status, empresa_id into v_status, v_emp from public.listas_compra where id = coalesce(new.lista_id, old.lista_id);
  if v_status in ('concluida','cancelada') then raise exception 'A lista já está %; os itens não mudam mais', v_status; end if;
  if tg_op = 'DELETE' then return old; end if;
  if tg_op = 'UPDATE' and new.lista_id <> old.lista_id then raise exception 'Não é permitido mover o item de lista'; end if;
  if new.produto_id is not null and not exists (select 1 from public.produtos where id = new.produto_id and empresa_id = v_emp) then
    raise exception 'Produto inválido';
  end if;
  new.descricao := trim(coalesce(new.descricao, ''));
  if new.descricao = '' then raise exception 'Descreva o item'; end if;
  new.unidade := coalesce(nullif(upper(trim(new.unidade)), ''), 'UN');
  return new;
end $$;
drop trigger if exists lista_compra_itens_regras on public.lista_compra_itens;
create trigger lista_compra_itens_regras before insert or update or delete on public.lista_compra_itens for each row execute function public.lista_compra_itens_regras();

-- Sugestão de compra pelo estoque.
--   Abaixo do mínimo: repõe até o estoque mínimo.
--   Pelo consumo (p_cobertura > 0): média diária vendida nos últimos p_dias, para cobrir p_cobertura dias;
--   vale a maior das duas necessidades. Kits contam pela venda dos componentes.
-- p_fornecedor: só produtos já comprados desse fornecedor.
create or replace function public.sugestao_compra(p_dias integer default 30, p_cobertura integer default 0, p_fornecedor uuid default null)
returns jsonb language plpgsql stable security invoker set search_path = public as $$
declare v_emp uuid := public.auth_empresa_id(); r jsonb;
begin
  if v_emp is null then raise exception 'Usuário sem empresa vinculada'; end if;
  if p_dias is null or p_dias not between 1 and 365 then raise exception 'Informe de 1 a 365 dias de vendas'; end if;
  if p_cobertura is null or p_cobertura not between 0 and 180 then raise exception 'Informe de 0 a 180 dias de cobertura'; end if;
  with consumo as (
    select m.produto_id, -sum(m.quantidade) vendido
      from public.movimentos_estoque m
     where m.empresa_id = v_emp and m.tipo in ('saida_venda','estorno_venda') and m.criado_em >= now() - make_interval(days => p_dias)
     group by m.produto_id),
  ultima as (
    select distinct on (i.produto_id) i.produto_id, n.fornecedor_id, i.custo_unitario, n.criado_em
      from public.notas_entrada_itens i join public.notas_entrada n on n.id = i.nota_id
     where n.empresa_id = v_emp
     order by i.produto_id, n.criado_em desc),
  base as (
    select p.id, p.descricao, p.unidade, p.estoque_atual, p.estoque_minimo, p.preco_custo,
           greatest(coalesce(c.vendido, 0), 0) vendido,
           round(greatest(coalesce(c.vendido, 0), 0) / p_dias, 3) media_dia,
           u.fornecedor_id, u.custo_unitario ultimo_custo
      from public.produtos p
      left join consumo c on c.produto_id = p.id
      left join ultima u on u.produto_id = p.id
     where p.empresa_id = v_emp and p.ativo and not p.e_kit and not coalesce(p.e_grade, false) and not coalesce(p.servico, false)
       and (p_fornecedor is null
            or exists (select 1 from public.notas_entrada_itens i join public.notas_entrada n on n.id = i.nota_id
                        where i.produto_id = p.id and n.fornecedor_id = p_fornecedor)
            or exists (select 1 from public.produto_fornecedor pf where pf.produto_id = p.id and pf.fornecedor_id = p_fornecedor))),
  calc as (
    select b.*,
           greatest(b.estoque_minimo - b.estoque_atual, 0) falta_minimo,
           case when p_cobertura > 0 then greatest(b.media_dia * p_cobertura - b.estoque_atual, 0) else 0 end falta_consumo
      from base b)
  select coalesce(jsonb_agg(jsonb_build_object(
           'produto_id', id, 'descricao', descricao, 'unidade', unidade, 'estoque_atual', estoque_atual, 'estoque_minimo', estoque_minimo,
           'vendido', vendido, 'media_dia', media_dia,
           'sugerida', ceil(greatest(falta_minimo, falta_consumo)),
           'motivo', case when estoque_atual <= 0 then 'zerado' when falta_minimo >= falta_consumo then 'minimo' else 'consumo' end,
           'custo', coalesce(nullif(ultimo_custo, 0), nullif(preco_custo, 0)),
           'fornecedor_id', fornecedor_id)
         order by (estoque_atual <= 0) desc, descricao), '[]'::jsonb)
    into r
    from calc
   where ceil(greatest(falta_minimo, falta_consumo)) > 0;
  return r;
end $$;
revoke execute on function public.sugestao_compra(integer, integer, uuid) from public, anon;
grant execute on function public.sugestao_compra(integer, integer, uuid) to authenticated;
