-- Itens independentes de terceiros: regras de tributação, dados para o SPED Fiscal e tabela CMED.

-- =====================================================================
-- 1) Regras de tributação
-- =====================================================================
alter table public.produtos
  add column if not exists reducao_bc      numeric(5,2) not null default 0,
  add column if not exists cbenef          text,
  add column if not exists cst_pis         text,
  add column if not exists aliquota_pis    numeric(7,4) not null default 0,
  add column if not exists cst_cofins      text,
  add column if not exists aliquota_cofins numeric(7,4) not null default 0,
  add column if not exists regra_fiscal_id uuid,
  add column if not exists pmc             numeric(12,2),
  add column if not exists pmc_atualizado_em timestamptz;

create table public.regras_fiscais (
  id              uuid primary key default gen_random_uuid(),
  empresa_id      uuid not null references public.empresas(id),
  nome            text not null,
  ativo           boolean not null default true,
  prioridade      integer not null default 100,
  -- Quando se aplica (vazio = qualquer)
  ncm_prefixo     text check (ncm_prefixo is null or ncm_prefixo ~ '^\d{2,8}$'),
  origem          smallint check (origem is null or origem between 0 and 8),
  -- O que define
  cfop            text not null check (cfop ~ '^\d{4}$'),
  csosn           text check (csosn is null or csosn ~ '^\d{3}$'),
  cst_icms        text check (cst_icms is null or cst_icms ~ '^\d{2}$'),
  aliquota_icms   numeric(5,2) not null default 0 check (aliquota_icms between 0 and 100),
  reducao_bc      numeric(5,2) not null default 0 check (reducao_bc between 0 and 100),
  cbenef          text,
  cst_pis         text check (cst_pis is null or cst_pis ~ '^\d{2}$'),
  aliquota_pis    numeric(7,4) not null default 0,
  cst_cofins      text check (cst_cofins is null or cst_cofins ~ '^\d{2}$'),
  aliquota_cofins numeric(7,4) not null default 0,
  -- Reforma tributária (guardados para a NF-e; ainda não vão no XML)
  cst_ibscbs      text,
  cclasstrib      text,
  observacao      text,
  criado_em       timestamptz not null default now()
);
create index on public.regras_fiscais(empresa_id, ativo);
create trigger regras_fiscais_empresa before insert or update on public.regras_fiscais for each row execute function public.fixar_empresa();
alter table public.regras_fiscais enable row level security;
create policy regras_fiscais_select on public.regras_fiscais for select using (empresa_id = public.auth_empresa_id());
create policy regras_fiscais_insert on public.regras_fiscais for insert with check (public.auth_papel() in ('administrador','gerente'));
create policy regras_fiscais_update on public.regras_fiscais for update using (empresa_id = public.auth_empresa_id() and public.auth_papel() in ('administrador','gerente'));
create policy regras_fiscais_delete on public.regras_fiscais for delete using (empresa_id = public.auth_empresa_id() and public.auth_papel() in ('administrador','gerente'));

-- Regra que vale para o produto: a do NCM mais específico; empate, a de menor prioridade
create or replace function public.regra_do_produto(p_empresa uuid, p_ncm text, p_origem smallint)
returns public.regras_fiscais language sql stable security definer set search_path = public as $$
  select r.* from public.regras_fiscais r
   where r.empresa_id = p_empresa and r.ativo
     and (r.ncm_prefixo is null or coalesce(p_ncm, '') like r.ncm_prefixo || '%')
     and (r.origem is null or r.origem = p_origem)
   order by length(coalesce(r.ncm_prefixo, '')) desc, r.prioridade, r.criado_em
   limit 1
$$;
revoke execute on function public.regra_do_produto(uuid, text, smallint) from public, anon, authenticated;

-- Produto novo ou com NCM/origem alterados recebe a tributação da regra
create or replace function public.tributar_produto()
returns trigger language plpgsql security definer set search_path = public as $$
declare r public.regras_fiscais;
begin
  if tg_op = 'UPDATE' and new.ncm is not distinct from old.ncm and new.origem is not distinct from old.origem then return new; end if;
  r := public.regra_do_produto(new.empresa_id, new.ncm, new.origem);
  if r.id is null then return new; end if;
  new.cfop := r.cfop; new.csosn := r.csosn; new.cst_icms := r.cst_icms; new.aliquota_icms := r.aliquota_icms;
  new.reducao_bc := r.reducao_bc; new.cbenef := r.cbenef; new.cst_pis := r.cst_pis; new.aliquota_pis := r.aliquota_pis;
  new.cst_cofins := r.cst_cofins; new.aliquota_cofins := r.aliquota_cofins; new.regra_fiscal_id := r.id;
  return new;
end $$;
revoke execute on function public.tributar_produto() from public, anon, authenticated;
create trigger produtos_tributar before insert or update of ncm, origem on public.produtos for each row execute function public.tributar_produto();

-- Aplica as regras ao cadastro inteiro (ou só simula)
create or replace function public.aplicar_regras_fiscais(p_simular boolean default true)
returns jsonb language plpgsql security definer set search_path = public as $$
declare v_emp uuid := public.auth_empresa_id(); n int; amostra jsonb; sem_regra int;
begin
  if public.auth_papel() not in ('administrador','gerente') then raise exception 'Somente gerente ou administrador'; end if;
  create temp table if not exists _trib on commit drop as select * from public.regras_fiscais limit 0;
  alter table _trib add column if not exists produto_id uuid;
  truncate _trib;
  insert into _trib
  select (x.r).*, p.id from public.produtos p
   cross join lateral (select public.regra_do_produto(v_emp, p.ncm, p.origem) r) x
   where p.empresa_id = v_emp and (x.r).id is not null
     and (p.cfop, p.csosn, p.cst_icms, p.aliquota_icms, p.reducao_bc, p.cbenef, p.cst_pis, p.aliquota_pis, p.cst_cofins, p.aliquota_cofins, p.regra_fiscal_id)
         is distinct from ((x.r).cfop, (x.r).csosn, (x.r).cst_icms, (x.r).aliquota_icms, (x.r).reducao_bc, (x.r).cbenef, (x.r).cst_pis,
                           (x.r).aliquota_pis, (x.r).cst_cofins, (x.r).aliquota_cofins, (x.r).id);
  select count(*) into n from _trib;
  select count(*) into sem_regra from public.produtos p
   where p.empresa_id = v_emp and p.ativo and public.regra_do_produto(v_emp, p.ncm, p.origem) is null;
  select coalesce(jsonb_agg(x), '[]') into amostra from (
    select p.descricao, p.ncm, t.nome regra,
           jsonb_build_object('cfop', p.cfop, 'csosn', p.csosn, 'cst', p.cst_icms, 'aliquota', p.aliquota_icms) antes,
           jsonb_build_object('cfop', t.cfop, 'csosn', t.csosn, 'cst', t.cst_icms, 'aliquota', t.aliquota_icms) depois
      from _trib t join public.produtos p on p.id = t.produto_id order by p.descricao limit 50) x;
  if not p_simular then
    update public.produtos p set cfop = t.cfop, csosn = t.csosn, cst_icms = t.cst_icms, aliquota_icms = t.aliquota_icms,
           reducao_bc = t.reducao_bc, cbenef = t.cbenef, cst_pis = t.cst_pis, aliquota_pis = t.aliquota_pis,
           cst_cofins = t.cst_cofins, aliquota_cofins = t.aliquota_cofins, regra_fiscal_id = t.id, atualizado_em = now()
      from _trib t where p.id = t.produto_id;
    insert into public.auditoria(empresa_id, acao, entidade, detalhes)
    values (v_emp, 'aplicar_regras_fiscais', 'produto', jsonb_build_object('produtos', n));
  end if;
  return jsonb_build_object('alterados', n, 'sem_regra', sem_regra, 'amostra', amostra);
end $$;

-- Fotografia fiscal de cada item vendido (vale o que estava cadastrado no momento da venda)
alter table public.venda_itens
  add column if not exists cfop text, add column if not exists csosn text, add column if not exists cst_icms text,
  add column if not exists aliquota_icms numeric(5,2), add column if not exists reducao_bc numeric(5,2),
  add column if not exists cst_pis text, add column if not exists aliquota_pis numeric(7,4),
  add column if not exists cst_cofins text, add column if not exists aliquota_cofins numeric(7,4),
  add column if not exists origem smallint, add column if not exists ncm text, add column if not exists cest text,
  add column if not exists cbenef text;

create or replace function public.fiscal_item_venda()
returns trigger language plpgsql set search_path = public as $$
declare p public.produtos;
begin
  if new.cfop is not null then return new; end if;
  select * into p from public.produtos where id = new.produto_id;
  new.cfop := p.cfop; new.csosn := p.csosn; new.cst_icms := p.cst_icms; new.aliquota_icms := p.aliquota_icms;
  new.reducao_bc := p.reducao_bc; new.cst_pis := p.cst_pis; new.aliquota_pis := p.aliquota_pis;
  new.cst_cofins := p.cst_cofins; new.aliquota_cofins := p.aliquota_cofins; new.origem := p.origem;
  new.ncm := p.ncm; new.cest := p.cest; new.cbenef := p.cbenef;
  return new;
end $$;
revoke execute on function public.fiscal_item_venda() from public, anon, authenticated;
create trigger venda_itens_fiscal before insert on public.venda_itens for each row execute function public.fiscal_item_venda();

update public.venda_itens i set cfop = p.cfop, csosn = p.csosn, cst_icms = p.cst_icms, aliquota_icms = p.aliquota_icms,
       reducao_bc = p.reducao_bc, cst_pis = p.cst_pis, aliquota_pis = p.aliquota_pis, cst_cofins = p.cst_cofins,
       aliquota_cofins = p.aliquota_cofins, origem = p.origem, ncm = p.ncm, cest = p.cest, cbenef = p.cbenef
  from public.produtos p where p.id = i.produto_id and i.cfop is null;

-- =====================================================================
-- 2) Dados para o SPED Fiscal (EFD ICMS/IPI)
-- =====================================================================
alter table public.empresas
  add column if not exists contador jsonb not null default '{}'::jsonb,
  add column if not exists sped_perfil char(1) not null default 'A' check (sped_perfil in ('A','B','C')),
  add column if not exists inscricao_municipal text,
  add column if not exists cod_receita_icms text,
  add column if not exists cmed_coluna text;

alter table public.fornecedores
  add column if not exists municipio_ibge text,
  add column if not exists endereco jsonb not null default '{}'::jsonb;
alter table public.notas_entrada add column if not exists fiscal jsonb not null default '{}'::jsonb;
alter table public.notas_entrada_itens
  add column if not exists fiscal jsonb not null default '{}'::jsonb,
  add column if not exists n_item smallint;

-- Código do item no SPED: o mesmo no 0200, C170 e H010
create or replace function public.codigo_item_sped(p public.produtos)
returns text language sql immutable set search_path = public as $$
  select coalesce(nullif(trim(p.codigo), ''), nullif(trim(p.ean), ''), left(p.id::text, 8))
$$;

create or replace function public.dados_sped(p_inicio date, p_fim date, p_inventario date default null)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare v_emp uuid := public.auth_empresa_id(); r jsonb;
begin
  if public.auth_papel() not in ('administrador','gerente') then raise exception 'Somente gerente ou administrador'; end if;
  if p_fim < p_inicio then raise exception 'Período inválido'; end if;
  with notas as (
    select n.* from public.notas_entrada n
     where n.empresa_id = v_emp
       and (n.criado_em at time zone 'America/Sao_Paulo')::date between p_inicio and p_fim),
  itens_nota as (
    select i.nota_id, i.n_item, i.quantidade, i.custo_unitario, i.fiscal, i.descricao, p.id produto_id, public.codigo_item_sped(p) cod_item, p.unidade
      from public.notas_entrada_itens i join public.produtos p on p.id = i.produto_id
     where i.nota_id in (select id from notas)),
  estoque_data as (
    select p.*, public.codigo_item_sped(p) cod_item, p.estoque_atual - coalesce((select sum(m.quantidade) from public.movimentos_estoque m
                                             where m.produto_id = p.id and (m.criado_em at time zone 'America/Sao_Paulo')::date > p_inventario), 0) qtd
      from public.produtos p where p_inventario is not null and p.empresa_id = v_emp and not p.e_kit and not p.e_grade),
  inventario as (select * from estoque_data where qtd > 0),
  itens as (
    select distinct on (p.id) p.id, public.codigo_item_sped(p) cod_item, p.descricao, p.ean, p.unidade, p.ncm, p.cest, p.aliquota_icms
      from public.produtos p
     where p.id in (select produto_id from itens_nota) or p.id in (select id from inventario))
  select jsonb_build_object(
    'empresa', (select to_jsonb(e) - 'certificado_titular' from public.empresas e where e.id = v_emp),
    'notas', coalesce((select jsonb_agg(jsonb_build_object(
        'id', n.id, 'chave', n.chave, 'numero', n.numero, 'serie', n.serie, 'emissao', n.emissao, 'entrada', n.criado_em,
        'valor_produtos', n.valor_produtos, 'valor_total', n.valor_total, 'duplicatas', n.duplicatas, 'fiscal', n.fiscal,
        'fornecedor', (select to_jsonb(f) from public.fornecedores f where f.id = n.fornecedor_id),
        'itens', (select coalesce(jsonb_agg(to_jsonb(i) - 'nota_id' order by i.n_item nulls last), '[]') from itens_nota i where i.nota_id = n.id)
      ) order by n.criado_em) from notas n), '[]'),
    'produtos', coalesce((select jsonb_agg(to_jsonb(i) order by i.cod_item) from itens i), '[]'),
    'inventario', coalesce((select jsonb_agg(jsonb_build_object('cod_item', s.cod_item, 'unidade', s.unidade,
        'quantidade', s.qtd, 'custo', s.preco_custo) order by s.descricao) from inventario s), '[]')
  ) into r;
  return r;
end $$;

-- Entrada da nota guardando os dados fiscais (para o C100/C170) e o endereço do fornecedor (para o 0150)
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

  insert into public.fornecedores(empresa_id, cnpj, razao_social, nome_fantasia, inscricao_estadual, uf, telefone, municipio_ibge, endereco)
  values (v_emp, p_nota->'fornecedor'->>'cnpj', p_nota->'fornecedor'->>'razao_social', p_nota->'fornecedor'->>'nome_fantasia',
          p_nota->'fornecedor'->>'inscricao_estadual', p_nota->'fornecedor'->>'uf', p_nota->'fornecedor'->>'telefone',
          p_nota->'fornecedor'->>'municipio_ibge', coalesce(p_nota->'fornecedor'->'endereco', '{}'))
  on conflict (empresa_id, cnpj) do update set razao_social = excluded.razao_social,
       nome_fantasia = coalesce(excluded.nome_fantasia, public.fornecedores.nome_fantasia),
       inscricao_estadual = coalesce(excluded.inscricao_estadual, public.fornecedores.inscricao_estadual),
       uf = coalesce(excluded.uf, public.fornecedores.uf),
       municipio_ibge = coalesce(excluded.municipio_ibge, public.fornecedores.municipio_ibge),
       endereco = case when excluded.endereco = '{}'::jsonb then public.fornecedores.endereco else excluded.endereco end
  returning id into v_forn;

  insert into public.notas_entrada(empresa_id, fornecedor_id, chave, numero, serie, emissao, valor_produtos, valor_total, duplicatas, fiscal)
  values (v_emp, v_forn, p_nota->>'chave', (p_nota->>'numero')::bigint, coalesce((p_nota->>'serie')::int, 1),
          (p_nota->>'emissao')::timestamptz, coalesce((p_nota->>'valor_produtos')::numeric, 0),
          coalesce((p_nota->>'valor_total')::numeric, 0), coalesce(p_nota->'duplicatas', '[]'), coalesce(p_nota->'fiscal', '{}'))
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

    insert into public.notas_entrada_itens(empresa_id, nota_id, produto_id, codigo_fornecedor, descricao, quantidade, custo_unitario, lote_id, fiscal, n_item)
    values (v_emp, v_nota, v_prod, it->>'codigo_fornecedor', it->>'descricao', v_qtd, v_custo, v_lote,
            coalesce(it->'fiscal', '{}'), coalesce((it->>'n_item')::smallint, (n + 1)::smallint));
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

-- =====================================================================
-- 3) Tabela CMED (preço máximo ao consumidor)
-- =====================================================================
create table public.cmed_precos (
  empresa_id   uuid not null references public.empresas(id),
  ean          text not null,
  produto      text,
  apresentacao text,
  laboratorio  text,
  registro     text,
  tipo         text,
  tarja        text,
  restricao_hospitalar boolean not null default false,
  pmc          numeric(12,2),
  pf           numeric(12,2),
  atualizado_em timestamptz not null default now(),
  primary key (empresa_id, ean)
);
alter table public.cmed_precos enable row level security;
create policy cmed_precos_select on public.cmed_precos for select using (empresa_id = public.auth_empresa_id());

-- p_linhas: [{ean, produto, apresentacao, laboratorio, registro, tipo, tarja, restricao_hospitalar, pmc, pf}]
create or replace function public.importar_cmed(p_linhas jsonb, p_coluna text, p_reiniciar boolean default false)
returns integer language plpgsql security definer set search_path = public as $$
declare v_emp uuid := public.auth_empresa_id(); n int;
begin
  if public.auth_papel() not in ('administrador','gerente') then raise exception 'Somente gerente ou administrador'; end if;
  if p_reiniciar then
    delete from public.cmed_precos where empresa_id = v_emp;
    update public.empresas set cmed_coluna = p_coluna where id = v_emp;
  end if;
  insert into public.cmed_precos(empresa_id, ean, produto, apresentacao, laboratorio, registro, tipo, tarja, restricao_hospitalar, pmc, pf)
  select v_emp, l->>'ean', left(l->>'produto', 200), left(l->>'apresentacao', 300), left(l->>'laboratorio', 200), l->>'registro',
         l->>'tipo', l->>'tarja', coalesce((l->>'restricao_hospitalar')::boolean, false), nullif(l->>'pmc', '')::numeric, nullif(l->>'pf', '')::numeric
    from jsonb_array_elements(p_linhas) l
   where (l->>'ean') ~ '^\d{8,14}$'
  on conflict (empresa_id, ean) do update set produto = excluded.produto, apresentacao = excluded.apresentacao, laboratorio = excluded.laboratorio,
     registro = excluded.registro, tipo = excluded.tipo, tarja = excluded.tarja, restricao_hospitalar = excluded.restricao_hospitalar,
     pmc = excluded.pmc, pf = excluded.pf, atualizado_em = now();
  get diagnostics n = row_count;
  return n;
end $$;

-- Liga a tabela aos produtos (PMC e registro na ANVISA) e devolve a conferência
create or replace function public.conferir_cmed()
returns jsonb language plpgsql security definer set search_path = public as $$
declare v_emp uuid := public.auth_empresa_id(); v_lig int;
begin
  if public.auth_papel() not in ('administrador','gerente') then raise exception 'Somente gerente ou administrador'; end if;
  update public.produtos p set pmc = c.pmc, pmc_atualizado_em = c.atualizado_em,
         registro_ms = coalesce(nullif(p.registro_ms, ''), c.registro)
    from public.cmed_precos c
   where c.empresa_id = v_emp and p.empresa_id = v_emp and c.ean = p.ean
     and (p.pmc is distinct from c.pmc or p.pmc_atualizado_em is distinct from c.atualizado_em or coalesce(p.registro_ms, '') = '');
  update public.produtos p set pmc = null, pmc_atualizado_em = null
   where p.empresa_id = v_emp and p.pmc is not null
     and not exists (select 1 from public.cmed_precos c where c.empresa_id = v_emp and c.ean = p.ean);
  select count(*) into v_lig from public.produtos where empresa_id = v_emp and pmc is not null;
  return jsonb_build_object(
    'tabela', (select count(*) from public.cmed_precos where empresa_id = v_emp),
    'atualizada_em', (select max(atualizado_em) from public.cmed_precos where empresa_id = v_emp),
    'coluna', (select cmed_coluna from public.empresas where id = v_emp),
    'ligados', v_lig,
    'acima', coalesce((select jsonb_agg(jsonb_build_object('id', id, 'descricao', descricao, 'ean', ean, 'preco_venda', preco_venda, 'pmc', pmc) order by descricao)
                         from public.produtos where empresa_id = v_emp and ativo and pmc is not null and pmc > 0 and preco_venda > pmc), '[]'),
    'abaixo', (select count(*) from public.produtos where empresa_id = v_emp and ativo and pmc is not null and preco_venda < pmc),
    'sem_ean_medicamento', (select count(*) from public.produtos where empresa_id = v_emp and ativo and coalesce(registro_ms, '') <> '' and pmc is null)
  );
end $$;

-- p_acao: 'limitar' (só quem está acima do PMC) ou 'igualar' (PMC com desconto opcional em todos os ligados)
create or replace function public.aplicar_cmed(p_acao text, p_desconto numeric default 0)
returns integer language plpgsql security definer set search_path = public as $$
declare v_emp uuid := public.auth_empresa_id(); n int;
begin
  if public.auth_papel() not in ('administrador','gerente') then raise exception 'Somente gerente ou administrador'; end if;
  if p_acao not in ('limitar','igualar') then raise exception 'Ação inválida'; end if;
  if p_desconto is null or p_desconto < 0 or p_desconto >= 100 then raise exception 'Desconto inválido'; end if;
  update public.produtos set preco_venda = case when p_acao = 'limitar' then pmc else round(pmc * (1 - p_desconto / 100), 2) end, atualizado_em = now()
   where empresa_id = v_emp and pmc is not null and pmc > 0
     and (p_acao = 'igualar' or preco_venda > pmc);
  get diagnostics n = row_count;
  insert into public.auditoria(empresa_id, acao, entidade, detalhes)
  values (v_emp, 'aplicar_cmed', 'produto', jsonb_build_object('acao', p_acao, 'desconto', p_desconto, 'produtos', n));
  return n;
end $$;

grant execute on function public.aplicar_regras_fiscais(boolean), public.dados_sped(date, date, date),
  public.importar_cmed(jsonb, text, boolean), public.conferir_cmed(), public.aplicar_cmed(text, numeric) to authenticated;
revoke execute on function public.aplicar_regras_fiscais(boolean), public.dados_sped(date, date, date),
  public.importar_cmed(jsonb, text, boolean), public.conferir_cmed(), public.aplicar_cmed(text, numeric) from anon, public;
revoke execute on function public.codigo_item_sped(public.produtos) from anon, public;
