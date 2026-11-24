-- =====================================================================
-- Grupo C: contas a pagar e a receber, boletos, fluxo de caixa,
-- plano de contas, centros de custo e DRE gerencial.
-- =====================================================================

-- Rotinas do próprio banco (migrações, funções de servidor) podem gravar informando a empresa
create or replace function public.fixar_empresa()
returns trigger language plpgsql set search_path = public as $$
begin
  if tg_op = 'INSERT' then
    if auth.uid() is null and new.empresa_id is not null
       and (coalesce(auth.jwt()->>'role', '') = 'service_role' or current_user in ('postgres', 'supabase_admin')) then
      return new;
    end if;
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
-- Cadastros financeiros
-- ---------------------------------------------------------------------
create table public.plano_contas (
  id          uuid primary key default gen_random_uuid(),
  empresa_id  uuid not null references public.empresas(id),
  codigo      text not null,
  nome        text not null,
  tipo        text not null check (tipo in ('receita','despesa')),
  -- Linha do DRE onde a conta entra; 'estoque' e 'nao_operacional' afetam só o fluxo de caixa
  grupo_dre   text not null check (grupo_dre in ('receita_bruta','deducoes','despesas_operacionais','despesas_financeiras',
                                                 'receitas_financeiras','outras_receitas','estoque','nao_operacional')),
  ativo       boolean not null default true,
  unique (empresa_id, codigo)
);

create table public.centros_custo (
  id          uuid primary key default gen_random_uuid(),
  empresa_id  uuid not null references public.empresas(id),
  nome        text not null,
  ativo       boolean not null default true,
  unique (empresa_id, nome)
);

create table public.contas_bancarias (
  id            uuid primary key default gen_random_uuid(),
  empresa_id    uuid not null references public.empresas(id),
  nome          text not null,
  tipo          text not null default 'banco' check (tipo in ('caixa','banco','carteira')),
  saldo_inicial numeric(14,2) not null default 0,
  data_saldo    date not null default current_date,
  ativo         boolean not null default true,
  unique (empresa_id, nome)
);

-- ---------------------------------------------------------------------
-- Lançamentos (títulos a pagar e a receber) e suas baixas
-- ---------------------------------------------------------------------
create table public.lancamentos (
  id              uuid primary key default gen_random_uuid(),
  empresa_id      uuid not null references public.empresas(id),
  tipo            text not null check (tipo in ('pagar','receber')),
  descricao       text not null,
  fornecedor_id   uuid references public.fornecedores(id),
  cliente_id      uuid references public.clientes(id),
  plano_conta_id  uuid not null references public.plano_contas(id),
  centro_custo_id uuid references public.centros_custo(id),
  documento       text,
  linha_digitavel text,
  valor           numeric(14,2) not null check (valor > 0),
  valor_pago      numeric(14,2) not null default 0 check (valor_pago >= 0),
  vencimento      date not null,
  competencia     date not null,
  parcela         smallint not null default 1,
  parcelas        smallint not null default 1,
  grupo_id        uuid,                          -- parcelas do mesmo lançamento
  nota_entrada_id uuid references public.notas_entrada(id),
  status          text not null default 'aberto' check (status in ('aberto','pago','cancelado')),
  observacao      text,
  usuario_id      uuid not null default auth.uid(),
  criado_em       timestamptz not null default now()
);
create index on public.lancamentos(empresa_id, tipo, status, vencimento);
create unique index lancamentos_boleto_unico on public.lancamentos(empresa_id, linha_digitavel)
  where linha_digitavel is not null and status <> 'cancelado';

create table public.lancamento_baixas (
  id                uuid primary key default gen_random_uuid(),
  empresa_id        uuid not null references public.empresas(id),
  lancamento_id     uuid not null references public.lancamentos(id),
  data              date not null,
  valor             numeric(14,2) not null check (valor > 0),  -- valor abatido do título
  juros             numeric(14,2) not null default 0 check (juros >= 0),
  desconto          numeric(14,2) not null default 0 check (desconto >= 0),
  conta_bancaria_id uuid references public.contas_bancarias(id),
  forma             text,
  usuario_id        uuid not null default auth.uid(),
  criado_em         timestamptz not null default now()
);
create index on public.lancamento_baixas(empresa_id, data);

-- Custo do item no momento da venda (base do CMV no DRE)
alter table public.venda_itens add column if not exists custo_unitario numeric(12,4);
create or replace function public.custo_item_venda()
returns trigger language plpgsql set search_path = public as $$
begin
  if new.custo_unitario is null then
    select case when p.e_kit
                then (select coalesce(sum(k.quantidade * c.preco_custo), 0) from public.kit_itens k join public.produtos c on c.id = k.produto_id where k.kit_id = p.id)
                else p.preco_custo end
      into new.custo_unitario
      from public.produtos p where p.id = new.produto_id;
  end if;
  return new;
end $$;
revoke execute on function public.custo_item_venda() from public, anon, authenticated;
create trigger venda_itens_custo before insert on public.venda_itens for each row execute function public.custo_item_venda();

-- ---------------------------------------------------------------------
-- Gatilhos e RLS
-- ---------------------------------------------------------------------
do $$
declare t text;
begin
  foreach t in array array['plano_contas','centros_custo','contas_bancarias','lancamentos','lancamento_baixas']
  loop
    execute format('create trigger %I before insert or update on public.%I for each row execute function public.fixar_empresa()', t || '_empresa', t);
    execute format('alter table public.%I enable row level security', t);
    -- Financeiro: somente gerente e administrador enxergam
    execute format('create policy %I on public.%I for select using (empresa_id = public.auth_empresa_id() and public.auth_papel() in (''administrador'',''gerente''))', t || '_select', t);
  end loop;
  foreach t in array array['plano_contas','centros_custo','contas_bancarias','lancamentos']
  loop
    execute format('create policy %I on public.%I for insert with check (public.auth_papel() in (''administrador'',''gerente''))', t || '_insert', t);
    execute format('create policy %I on public.%I for update using (empresa_id = public.auth_empresa_id() and public.auth_papel() in (''administrador'',''gerente''))', t || '_update', t);
  end loop;
end $$;
-- Baixas só pela função baixar_lancamento; valor pago e status do título só mudam por ela
create or replace function public.proteger_lancamento()
returns trigger language plpgsql set search_path = public as $$
begin
  if current_setting('pdv.baixa', true) = 'sim' then return new; end if;
  if new.valor_pago is distinct from old.valor_pago or (new.status is distinct from old.status and new.status <> 'cancelado') then
    raise exception 'Use a baixa para registrar pagamentos';
  end if;
  if old.status = 'pago' then raise exception 'Título já pago não pode ser alterado'; end if;
  if new.status = 'cancelado' and old.valor_pago > 0 then raise exception 'Título com pagamento parcial não pode ser cancelado'; end if;
  if new.valor < old.valor_pago then raise exception 'Valor menor que o já pago'; end if;
  return new;
end $$;
revoke execute on function public.proteger_lancamento() from public, anon, authenticated;
create trigger lancamentos_protege before update on public.lancamentos for each row execute function public.proteger_lancamento();

-- ---------------------------------------------------------------------
-- Plano de contas padrão, centro de custo e conta inicial
-- ---------------------------------------------------------------------
create or replace function public.semear_financeiro(p_empresa uuid)
returns void language plpgsql security definer set search_path = public as $$
begin
  if exists (select 1 from public.plano_contas where empresa_id = p_empresa) then return; end if;
  insert into public.plano_contas(empresa_id, codigo, nome, tipo, grupo_dre) values
    (p_empresa, '1.01', 'Vendas de mercadorias (lançamento manual)', 'receita', 'receita_bruta'),
    (p_empresa, '1.02', 'Prestação de serviços', 'receita', 'receita_bruta'),
    (p_empresa, '1.03', 'Rendimentos e juros recebidos', 'receita', 'receitas_financeiras'),
    (p_empresa, '1.04', 'Outras receitas', 'receita', 'outras_receitas'),
    (p_empresa, '1.05', 'Aporte dos sócios e empréstimos recebidos', 'receita', 'nao_operacional'),
    (p_empresa, '2.01', 'Impostos sobre vendas (Simples Nacional/DAS)', 'despesa', 'deducoes'),
    (p_empresa, '3.01', 'Compras de mercadorias para revenda', 'despesa', 'estoque'),
    (p_empresa, '3.02', 'Frete sobre compras', 'despesa', 'estoque'),
    (p_empresa, '4.01', 'Aluguel e condomínio', 'despesa', 'despesas_operacionais'),
    (p_empresa, '4.02', 'Energia, água, telefone e internet', 'despesa', 'despesas_operacionais'),
    (p_empresa, '4.03', 'Salários e encargos', 'despesa', 'despesas_operacionais'),
    (p_empresa, '4.04', 'Pró-labore', 'despesa', 'despesas_operacionais'),
    (p_empresa, '4.05', 'Contabilidade', 'despesa', 'despesas_operacionais'),
    (p_empresa, '4.06', 'Sistemas e assinaturas', 'despesa', 'despesas_operacionais'),
    (p_empresa, '4.07', 'Material de uso, limpeza e embalagens', 'despesa', 'despesas_operacionais'),
    (p_empresa, '4.08', 'Manutenção e conservação', 'despesa', 'despesas_operacionais'),
    (p_empresa, '4.09', 'Marketing e publicidade', 'despesa', 'despesas_operacionais'),
    (p_empresa, '4.10', 'Taxas de cartão e tarifas bancárias', 'despesa', 'despesas_operacionais'),
    (p_empresa, '4.11', 'Outras despesas operacionais', 'despesa', 'despesas_operacionais'),
    (p_empresa, '5.01', 'Juros e multas pagos', 'despesa', 'despesas_financeiras'),
    (p_empresa, '6.01', 'Retirada dos sócios', 'despesa', 'nao_operacional'),
    (p_empresa, '6.02', 'Pagamento de empréstimos (principal)', 'despesa', 'nao_operacional'),
    (p_empresa, '6.03', 'Equipamentos e investimentos', 'despesa', 'nao_operacional');
  insert into public.centros_custo(empresa_id, nome) values (p_empresa, 'Loja') on conflict do nothing;
  insert into public.contas_bancarias(empresa_id, nome, tipo) values (p_empresa, 'Caixa da loja', 'caixa') on conflict do nothing;
end $$;
revoke execute on function public.semear_financeiro(uuid) from public, anon, authenticated;

-- Empresas existentes recebem o plano padrão; novas empresas recebem ao serem criadas
select public.semear_financeiro(id) from public.empresas;
create or replace function public.empresa_nova_financeiro()
returns trigger language plpgsql security definer set search_path = public as $$
begin perform public.semear_financeiro(new.id); return new; end $$;
revoke execute on function public.empresa_nova_financeiro() from public, anon, authenticated;
create trigger empresas_financeiro after insert on public.empresas for each row execute function public.empresa_nova_financeiro();

-- ---------------------------------------------------------------------
-- Baixa (pagamento ou recebimento, total ou parcial)
-- ---------------------------------------------------------------------
create or replace function public.baixar_lancamento(p_lancamento uuid, p_valor numeric, p_data date default null,
                                                    p_conta uuid default null, p_forma text default null,
                                                    p_juros numeric default 0, p_desconto numeric default 0)
returns jsonb language plpgsql security definer set search_path = public as $$
declare v_emp uuid := public.auth_empresa_id(); l public.lancamentos; v_aberto numeric; v_novo numeric;
begin
  if public.auth_papel() not in ('administrador','gerente') then raise exception 'Somente gerente ou administrador'; end if;
  select * into l from public.lancamentos where id = p_lancamento and empresa_id = v_emp for update;
  if not found then raise exception 'Lançamento não encontrado'; end if;
  if l.status <> 'aberto' then raise exception 'Lançamento não está em aberto'; end if;
  v_aberto := l.valor - l.valor_pago;
  if p_valor is null or p_valor <= 0 then raise exception 'Valor inválido'; end if;
  if round(p_valor + coalesce(p_desconto, 0), 2) > v_aberto then
    raise exception 'Valor maior que o saldo em aberto (%)', to_char(v_aberto, 'FM999G999G990D00');
  end if;
  if coalesce(p_juros, 0) < 0 or coalesce(p_desconto, 0) < 0 then raise exception 'Juros e desconto não podem ser negativos'; end if;
  if p_conta is not null and not exists (select 1 from public.contas_bancarias where id = p_conta and empresa_id = v_emp) then
    raise exception 'Conta inválida';
  end if;
  insert into public.lancamento_baixas(empresa_id, lancamento_id, data, valor, juros, desconto, conta_bancaria_id, forma)
  values (v_emp, l.id, coalesce(p_data, (now() at time zone 'America/Sao_Paulo')::date), round(p_valor, 2),
          round(coalesce(p_juros, 0), 2), round(coalesce(p_desconto, 0), 2), p_conta, p_forma);
  v_novo := l.valor_pago + round(p_valor, 2) + round(coalesce(p_desconto, 0), 2);
  perform set_config('pdv.baixa', 'sim', true);
  update public.lancamentos set valor_pago = v_novo, status = case when v_novo >= valor then 'pago' else 'aberto' end where id = l.id;
  perform set_config('pdv.baixa', '', true);
  return jsonb_build_object('lancamento_id', l.id, 'pago', v_novo >= l.valor, 'saldo', greatest(l.valor - v_novo, 0));
end $$;

-- Estorno da última baixa (correção de lançamento errado)
create or replace function public.estornar_baixa(p_baixa uuid)
returns void language plpgsql security definer set search_path = public as $$
declare v_emp uuid := public.auth_empresa_id(); b public.lancamento_baixas;
begin
  if public.auth_papel() <> 'administrador' then raise exception 'Somente o administrador estorna baixas'; end if;
  select * into b from public.lancamento_baixas where id = p_baixa and empresa_id = v_emp;
  if not found then raise exception 'Baixa não encontrada'; end if;
  delete from public.lancamento_baixas where id = b.id;
  perform set_config('pdv.baixa', 'sim', true);
  update public.lancamentos set valor_pago = greatest(valor_pago - b.valor - b.desconto, 0), status = 'aberto' where id = b.lancamento_id;
  perform set_config('pdv.baixa', '', true);
  insert into public.auditoria(empresa_id, acao, entidade, entidade_id, detalhes)
  values (v_emp, 'estornar_baixa', 'lancamento', b.lancamento_id, to_jsonb(b));
end $$;

-- Contas a pagar a partir das duplicatas da nota de entrada
create or replace function public.gerar_pagar_nota(p_nota uuid, p_plano uuid default null)
returns integer language plpgsql security definer set search_path = public as $$
declare v_emp uuid := public.auth_empresa_id(); n public.notas_entrada; d jsonb; v_plano uuid := p_plano; k int := 0; tot int; v_grupo uuid := gen_random_uuid();
begin
  if public.auth_papel() not in ('administrador','gerente') then raise exception 'Somente gerente ou administrador'; end if;
  select * into n from public.notas_entrada where id = p_nota and empresa_id = v_emp;
  if not found then raise exception 'Nota não encontrada'; end if;
  if exists (select 1 from public.lancamentos where nota_entrada_id = p_nota and status <> 'cancelado') then
    raise exception 'As contas desta nota já foram geradas';
  end if;
  if v_plano is null then select id into v_plano from public.plano_contas where empresa_id = v_emp and codigo = '3.01'; end if;
  if v_plano is null then raise exception 'Informe a conta do plano de contas'; end if;
  tot := greatest(jsonb_array_length(n.duplicatas), 1);
  if jsonb_array_length(n.duplicatas) = 0 then
    insert into public.lancamentos(empresa_id, tipo, descricao, fornecedor_id, plano_conta_id, documento, valor, vencimento, competencia, nota_entrada_id, grupo_id)
    values (v_emp, 'pagar', 'NF-e ' || n.numero, n.fornecedor_id, v_plano, n.numero::text, n.valor_total,
            coalesce(n.emissao::date, current_date) + 30, coalesce(n.emissao::date, current_date), p_nota, v_grupo);
    return 1;
  end if;
  for d in select * from jsonb_array_elements(n.duplicatas) loop
    k := k + 1;
    insert into public.lancamentos(empresa_id, tipo, descricao, fornecedor_id, plano_conta_id, documento, valor, vencimento, competencia,
                                   parcela, parcelas, nota_entrada_id, grupo_id)
    values (v_emp, 'pagar', 'NF-e ' || n.numero || ' duplicata ' || coalesce(d->>'numero', k::text), n.fornecedor_id, v_plano,
            n.numero || '/' || coalesce(d->>'numero', k::text), (d->>'valor')::numeric, (d->>'vencimento')::date,
            coalesce(n.emissao::date, current_date), k, tot, p_nota, v_grupo);
  end loop;
  return k;
end $$;

-- ---------------------------------------------------------------------
-- Fluxo de caixa: realizado por dia e previsto pelos títulos em aberto
-- ---------------------------------------------------------------------
create or replace function public.fluxo_caixa(p_inicio date, p_fim date)
returns jsonb language sql stable security invoker set search_path = public as $$
  with dias as (select d::date dia from generate_series(p_inicio, p_fim, interval '1 day') d),
  vendas as (
    select (v.criado_em at time zone 'America/Sao_Paulo')::date dia,
           sum(p.valor) filter (where p.forma not in ('crediario','convenio','vale')) - 0 bruto
      from public.vendas v join public.venda_pagamentos p on p.venda_id = v.id
     where v.status = 'concluida' and (v.criado_em at time zone 'America/Sao_Paulo')::date between p_inicio and p_fim
     group by 1),
  trocos as (select (criado_em at time zone 'America/Sao_Paulo')::date dia, sum(troco) t from public.vendas
              where status = 'concluida' and (criado_em at time zone 'America/Sao_Paulo')::date between p_inicio and p_fim group by 1),
  receb as (select (criado_em at time zone 'America/Sao_Paulo')::date dia, sum(valor) v from public.recebimentos
             where (criado_em at time zone 'America/Sao_Paulo')::date between p_inicio and p_fim group by 1),
  devol as (select (criado_em at time zone 'America/Sao_Paulo')::date dia, sum(valor) v from public.devolucoes
             where destino = 'dinheiro' and (criado_em at time zone 'America/Sao_Paulo')::date between p_inicio and p_fim group by 1),
  baixas as (
    select b.data dia,
           sum(b.valor + b.juros) filter (where l.tipo = 'receber') entradas,
           sum(b.valor + b.juros) filter (where l.tipo = 'pagar') saidas
      from public.lancamento_baixas b join public.lancamentos l on l.id = b.lancamento_id
     where b.data between p_inicio and p_fim group by 1),
  prev as (
    select vencimento dia,
           sum(valor - valor_pago) filter (where tipo = 'receber') entradas,
           sum(valor - valor_pago) filter (where tipo = 'pagar') saidas
      from public.lancamentos where status = 'aberto' and vencimento between p_inicio and p_fim group by 1),
  prev_cli as (select vencimento dia, sum(valor - valor_pago) v from public.contas_receber
                where status = 'aberta' and vencimento between p_inicio and p_fim group by 1),
  linhas as (
    select d.dia,
           coalesce(ve.bruto, 0) - coalesce(tr.t, 0) as vendas,
           coalesce(rc.v, 0) as recebimentos,
           coalesce(bx.entradas, 0) as outras_entradas,
           coalesce(bx.saidas, 0) + coalesce(dv.v, 0) as saidas,
           coalesce(pv.entradas, 0) + coalesce(pc.v, 0) as previsto_entradas,
           coalesce(pv.saidas, 0) as previsto_saidas
      from dias d
      left join vendas ve on ve.dia = d.dia left join trocos tr on tr.dia = d.dia
      left join receb rc on rc.dia = d.dia left join devol dv on dv.dia = d.dia
      left join baixas bx on bx.dia = d.dia left join prev pv on pv.dia = d.dia left join prev_cli pc on pc.dia = d.dia)
  select jsonb_build_object(
    'dias', coalesce(jsonb_agg(to_jsonb(l) order by l.dia), '[]'::jsonb),
    'vencidos_pagar', (select coalesce(sum(valor - valor_pago), 0) from public.lancamentos where status = 'aberto' and tipo = 'pagar' and vencimento < (now() at time zone 'America/Sao_Paulo')::date),
    'vencidos_receber', (select coalesce(sum(valor - valor_pago), 0) from public.lancamentos where status = 'aberto' and tipo = 'receber' and vencimento < (now() at time zone 'America/Sao_Paulo')::date)
      + (select coalesce(sum(valor - valor_pago), 0) from public.contas_receber where status = 'aberta' and vencimento < (now() at time zone 'America/Sao_Paulo')::date)
  ) from linhas l
$$;

-- ---------------------------------------------------------------------
-- DRE gerencial por mês (regime de competência)
-- ---------------------------------------------------------------------
create or replace function public.dre(p_ano integer, p_centro uuid default null)
returns jsonb language sql stable security invoker set search_path = public as $$
  with meses as (select generate_series(1, 12) mes),
  vendas as (
    select extract(month from v.criado_em at time zone 'America/Sao_Paulo')::int mes, sum(v.total) receita
      from public.vendas v
     where v.status = 'concluida' and extract(year from v.criado_em at time zone 'America/Sao_Paulo') = p_ano and p_centro is null
     group by 1),
  devol as (
    select extract(month from d.criado_em at time zone 'America/Sao_Paulo')::int mes, sum(d.valor) valor
      from public.devolucoes d where extract(year from d.criado_em at time zone 'America/Sao_Paulo') = p_ano and p_centro is null group by 1),
  cmv as (
    select extract(month from v.criado_em at time zone 'America/Sao_Paulo')::int mes,
           sum((i.quantidade - i.quantidade_devolvida) * coalesce(i.custo_unitario, p.preco_custo)) custo
      from public.venda_itens i join public.vendas v on v.id = i.venda_id join public.produtos p on p.id = i.produto_id
     where v.status = 'concluida' and extract(year from v.criado_em at time zone 'America/Sao_Paulo') = p_ano and p_centro is null
     group by 1),
  lanc as (
    select extract(month from l.competencia)::int mes, pc.grupo_dre, pc.codigo, pc.nome, sum(l.valor) valor
      from public.lancamentos l join public.plano_contas pc on pc.id = l.plano_conta_id
     where l.status <> 'cancelado' and extract(year from l.competencia) = p_ano
       and (p_centro is null or l.centro_custo_id = p_centro)
     group by 1, 2, 3, 4),
  juros as (
    select extract(month from b.data)::int mes,
           sum(b.juros) filter (where l.tipo = 'pagar') pagos, sum(b.juros) filter (where l.tipo = 'receber') recebidos
      from public.lancamento_baixas b join public.lancamentos l on l.id = b.lancamento_id
     where extract(year from b.data) = p_ano and (p_centro is null or l.centro_custo_id = p_centro) group by 1),
  por_mes as (
    select m.mes,
      coalesce(ve.receita, 0) + coalesce((select sum(valor) from lanc where lanc.mes = m.mes and grupo_dre = 'receita_bruta'), 0) receita_bruta,
      coalesce(dv.valor, 0) devolucoes,
      coalesce((select sum(valor) from lanc where lanc.mes = m.mes and grupo_dre = 'deducoes'), 0) deducoes,
      coalesce(cm.custo, 0) cmv,
      coalesce((select sum(valor) from lanc where lanc.mes = m.mes and grupo_dre = 'despesas_operacionais'), 0) despesas_operacionais,
      coalesce((select sum(valor) from lanc where lanc.mes = m.mes and grupo_dre = 'despesas_financeiras'), 0) + coalesce(j.pagos, 0) despesas_financeiras,
      coalesce((select sum(valor) from lanc where lanc.mes = m.mes and grupo_dre in ('receitas_financeiras','outras_receitas')), 0) + coalesce(j.recebidos, 0) outras_receitas
    from meses m
    left join vendas ve on ve.mes = m.mes left join devol dv on dv.mes = m.mes
    left join cmv cm on cm.mes = m.mes left join juros j on j.mes = m.mes)
  select jsonb_build_object(
    'meses', (select jsonb_agg(jsonb_build_object(
        'mes', mes, 'receita_bruta', receita_bruta, 'devolucoes', devolucoes, 'deducoes', deducoes,
        'receita_liquida', receita_bruta - devolucoes - deducoes, 'cmv', cmv,
        'lucro_bruto', receita_bruta - devolucoes - deducoes - cmv,
        'despesas_operacionais', despesas_operacionais,
        'resultado_operacional', receita_bruta - devolucoes - deducoes - cmv - despesas_operacionais,
        'despesas_financeiras', despesas_financeiras, 'outras_receitas', outras_receitas,
        'resultado', receita_bruta - devolucoes - deducoes - cmv - despesas_operacionais - despesas_financeiras + outras_receitas
      ) order by mes) from por_mes),
    'detalhe', coalesce((select jsonb_agg(jsonb_build_object('mes', mes, 'grupo', grupo_dre, 'codigo', codigo, 'nome', nome, 'valor', valor) order by codigo, mes)
                           from lanc where grupo_dre not in ('estoque','nao_operacional')), '[]'::jsonb)
  )
$$;

grant execute on function public.baixar_lancamento(uuid, numeric, date, uuid, text, numeric, numeric), public.estornar_baixa(uuid),
  public.gerar_pagar_nota(uuid, uuid), public.fluxo_caixa(date, date), public.dre(integer, uuid) to authenticated;
revoke execute on function public.baixar_lancamento(uuid, numeric, date, uuid, text, numeric, numeric), public.estornar_baixa(uuid),
  public.gerar_pagar_nota(uuid, uuid), public.fluxo_caixa(date, date), public.dre(integer, uuid) from anon, public;
