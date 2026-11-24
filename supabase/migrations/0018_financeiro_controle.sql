-- Controle de despesas: despesas fixas mensais, reclassificação de títulos pagos,
-- histórico de alterações do financeiro e relatório por conta e mês.

-- ---------------------------------------------------------------------
-- Despesas fixas (aluguel, energia, salários…): geram a conta a pagar de cada mês
-- ---------------------------------------------------------------------
create table public.despesas_fixas (
  id              uuid primary key default gen_random_uuid(),
  empresa_id      uuid not null references public.empresas(id),
  descricao       text not null check (length(trim(descricao)) > 0),
  plano_conta_id  uuid not null references public.plano_contas(id),
  centro_custo_id uuid references public.centros_custo(id),
  fornecedor_id   uuid references public.fornecedores(id),
  valor           numeric(14,2) not null check (valor > 0),
  valor_variavel  boolean not null default false,   -- energia, água: valor muda todo mês
  dia_vencimento  smallint not null check (dia_vencimento between 1 and 31),
  inicio          date not null default date_trunc('month', current_date)::date,
  fim             date,
  ativo           boolean not null default true,
  observacao      text,
  criado_em       timestamptz not null default now()
);
create index on public.despesas_fixas(empresa_id, ativo);
create trigger despesas_fixas_empresa before insert or update on public.despesas_fixas for each row execute function public.fixar_empresa();
alter table public.despesas_fixas enable row level security;
create policy despesas_fixas_select on public.despesas_fixas for select using (empresa_id = public.auth_empresa_id() and public.auth_papel() in ('administrador','gerente'));
create policy despesas_fixas_insert on public.despesas_fixas for insert with check (public.auth_papel() in ('administrador','gerente'));
create policy despesas_fixas_update on public.despesas_fixas for update using (empresa_id = public.auth_empresa_id() and public.auth_papel() in ('administrador','gerente'));
create policy despesas_fixas_delete on public.despesas_fixas for delete using (empresa_id = public.auth_empresa_id() and public.auth_papel() in ('administrador','gerente'));

alter table public.lancamentos add column if not exists despesa_fixa_id uuid references public.despesas_fixas(id) on delete set null;
-- Uma conta por despesa fixa e mês, mesmo que tenha sido cancelada (não recria)
create unique index if not exists lancamentos_fixa_mes on public.lancamentos(despesa_fixa_id, competencia) where despesa_fixa_id is not null;

-- Gera as contas do mês das despesas fixas ativas. Pode rodar várias vezes: não duplica.
create or replace function public.gerar_despesas_fixas(p_mes date default null)
returns integer language plpgsql security invoker set search_path = public as $$
declare
  v_emp uuid := public.auth_empresa_id();
  v_mes date := date_trunc('month', coalesce(p_mes, (now() at time zone 'America/Sao_Paulo')::date))::date;
  v_fim date := (v_mes + interval '1 month' - interval '1 day')::date;
  n integer;
begin
  if public.auth_papel() not in ('administrador','gerente') then raise exception 'Somente gerente ou administrador'; end if;
  insert into public.lancamentos(empresa_id, tipo, descricao, fornecedor_id, plano_conta_id, centro_custo_id, valor,
                                 vencimento, competencia, despesa_fixa_id, observacao)
  select v_emp, 'pagar', f.descricao, f.fornecedor_id, f.plano_conta_id, f.centro_custo_id, f.valor,
         make_date(extract(year from v_mes)::int, extract(month from v_mes)::int, least(f.dia_vencimento::int, extract(day from v_fim)::int)),
         v_mes, f.id,
         case when f.valor_variavel then concat_ws(' ', 'Valor estimado: confira a fatura e ajuste.', f.observacao) else f.observacao end
    from public.despesas_fixas f
   where f.empresa_id = v_emp and f.ativo and f.inicio <= v_fim and (f.fim is null or f.fim >= v_mes)
  on conflict do nothing;
  get diagnostics n = row_count;
  return n;
end $$;
grant execute on function public.gerar_despesas_fixas(date) to authenticated;
revoke execute on function public.gerar_despesas_fixas(date) from anon, public;

-- ---------------------------------------------------------------------
-- Título pago: permite só reclassificar (plano de contas, centro de custo, observação)
-- ---------------------------------------------------------------------
create or replace function public.proteger_lancamento()
returns trigger language plpgsql set search_path = public as $$
begin
  if current_setting('pdv.baixa', true) = 'sim' then return new; end if;
  if new.valor_pago is distinct from old.valor_pago or (new.status is distinct from old.status and new.status <> 'cancelado') then
    raise exception 'Use a baixa para registrar pagamentos';
  end if;
  if old.status = 'pago' then
    if (to_jsonb(new) - array['plano_conta_id','centro_custo_id','observacao']) = (to_jsonb(old) - array['plano_conta_id','centro_custo_id','observacao']) then
      return new;
    end if;
    raise exception 'Título já pago não pode ser alterado (só a conta, o centro de custo e a observação)';
  end if;
  if new.status = 'cancelado' and old.valor_pago > 0 then raise exception 'Título com pagamento parcial não pode ser cancelado'; end if;
  if new.valor < old.valor_pago then raise exception 'Valor menor que o já pago'; end if;
  return new;
end $$;
revoke execute on function public.proteger_lancamento() from public, anon, authenticated;

-- ---------------------------------------------------------------------
-- Histórico de alterações do financeiro (quem fez o quê e quando)
-- ---------------------------------------------------------------------
create or replace function public.auditar_lancamento()
returns trigger language plpgsql security definer set search_path = public as $$
declare v_acao text; v_antes jsonb := '{}'; v_depois jsonb := '{}'; k text;
  campos text[] := array['descricao','valor','vencimento','competencia','plano_conta_id','centro_custo_id','fornecedor_id','cliente_id','documento','linha_digitavel','observacao'];
begin
  if tg_op = 'INSERT' then
    v_acao := case when new.despesa_fixa_id is not null then 'gerou_fixa' else 'criou' end;
  else
    if current_setting('pdv.baixa', true) = 'sim' then return null; end if;   -- baixa e estorno têm registro próprio
    if new.status = 'cancelado' and old.status <> 'cancelado' then v_acao := 'cancelou';
    else
      foreach k in array campos loop
        if (to_jsonb(new)->k) is distinct from (to_jsonb(old)->k) then
          v_antes := v_antes || jsonb_build_object(k, to_jsonb(old)->k);
          v_depois := v_depois || jsonb_build_object(k, to_jsonb(new)->k);
        end if;
      end loop;
      if v_depois = '{}'::jsonb then return null; end if;
      v_acao := case when old.status = 'pago' then 'reclassificou' else 'editou' end;
    end if;
  end if;
  insert into public.auditoria(empresa_id, acao, entidade, entidade_id, detalhes)
  values (new.empresa_id, v_acao, 'lancamento', new.id, jsonb_build_object(
    'tipo', new.tipo, 'descricao', new.descricao, 'valor', new.valor, 'vencimento', new.vencimento,
    'antes', nullif(v_antes, '{}'::jsonb), 'depois', nullif(v_depois, '{}'::jsonb)));
  return null;
end $$;
revoke execute on function public.auditar_lancamento() from public, anon, authenticated;
create trigger lancamentos_auditoria after insert or update on public.lancamentos for each row execute function public.auditar_lancamento();

create or replace function public.auditar_baixa()
returns trigger language plpgsql security definer set search_path = public as $$
declare l public.lancamentos;
begin
  select * into l from public.lancamentos where id = new.lancamento_id;
  insert into public.auditoria(empresa_id, acao, entidade, entidade_id, detalhes)
  values (new.empresa_id, case when l.tipo = 'pagar' then 'pagou' else 'recebeu' end, 'lancamento', new.lancamento_id, jsonb_build_object(
    'tipo', l.tipo, 'descricao', l.descricao, 'valor', new.valor, 'data', new.data, 'juros', new.juros, 'desconto', new.desconto, 'forma', new.forma));
  return null;
end $$;
revoke execute on function public.auditar_baixa() from public, anon, authenticated;
create trigger lancamento_baixas_auditoria after insert on public.lancamento_baixas for each row execute function public.auditar_baixa();

-- Histórico do financeiro em um período, com o nome de quem fez
create or replace function public.historico_financeiro(p_inicio date, p_fim date)
returns jsonb language sql stable security invoker set search_path = public as $$
  select coalesce(jsonb_agg(jsonb_build_object(
      'id', a.id, 'acao', a.acao, 'quando', a.criado_em, 'usuario', u.nome, 'lancamento_id', a.entidade_id,
      'descricao', coalesce(a.detalhes->>'descricao', l.descricao), 'tipo', coalesce(a.detalhes->>'tipo', l.tipo),
      'valor', coalesce((a.detalhes->>'valor')::numeric, l.valor), 'detalhes', a.detalhes) order by a.criado_em desc), '[]'::jsonb)
    from public.auditoria a
    left join public.usuarios u on u.id = a.usuario_id
    left join public.lancamentos l on l.id = a.entidade_id
   where a.empresa_id = public.auth_empresa_id() and a.entidade = 'lancamento'
     and (a.criado_em at time zone 'America/Sao_Paulo')::date between p_inicio and p_fim
$$;
grant execute on function public.historico_financeiro(date, date) to authenticated;
revoke execute on function public.historico_financeiro(date, date) from anon, public;

-- ---------------------------------------------------------------------
-- Relatório: valor por conta do plano e mês de competência (todas as contas,
-- inclusive compras para estoque e retiradas, que ficam fora da DRE)
-- ---------------------------------------------------------------------
create or replace function public.relatorio_contas(p_inicio date, p_fim date, p_centro uuid default null)
returns jsonb language sql stable security invoker set search_path = public as $$
  select coalesce(jsonb_agg(jsonb_build_object('mes', mes, 'plano_conta_id', id, 'codigo', codigo, 'nome', nome, 'tipo', tipo,
                                               'grupo', grupo_dre, 'valor', valor, 'qtd', qtd) order by codigo, mes), '[]'::jsonb)
    from (select to_char(l.competencia, 'YYYY-MM') mes, pc.id, pc.codigo, pc.nome, pc.tipo, pc.grupo_dre, sum(l.valor) valor, count(*) qtd
            from public.lancamentos l join public.plano_contas pc on pc.id = l.plano_conta_id
           where l.status <> 'cancelado' and l.competencia between p_inicio and p_fim
             and (p_centro is null or l.centro_custo_id = p_centro)
           group by 1, 2, 3, 4, 5, 6) x
$$;
grant execute on function public.relatorio_contas(date, date, uuid) to authenticated;
revoke execute on function public.relatorio_contas(date, date, uuid) from anon, public;
