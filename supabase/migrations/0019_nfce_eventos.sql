-- NFC-e: contingência off-line, cancelamento e inutilização de numeração

alter table public.nfce_documentos
  add column if not exists tp_emis smallint not null default 1,
  add column if not exists dh_emissao timestamptz,
  add column if not exists codigo_numerico text,
  add column if not exists dh_contingencia timestamptz,
  add column if not exists justificativa_contingencia text,
  add column if not exists chave_original text,           -- tentativa on-line que ficou sem resposta
  add column if not exists protocolo_cancelamento text,
  add column if not exists justificativa_cancelamento text,
  add column if not exists cancelada_em timestamptz,
  add column if not exists xml_cancelamento text;

-- Emite em contingência sozinho quando a SEFAZ não responde
alter table public.empresas add column if not exists nfce_contingencia boolean not null default true;

create table if not exists public.nfce_inutilizacoes (
  id            uuid primary key default gen_random_uuid(),
  empresa_id    uuid not null references public.empresas(id),
  ambiente      smallint not null,
  serie         integer not null,
  inicio        bigint not null,
  fim           bigint not null check (fim >= inicio),
  justificativa text not null,
  protocolo     text,
  codigo_status text,
  motivo        text,
  xml           text,
  usuario_id    uuid references public.usuarios(id),
  criado_em     timestamptz not null default now()
);
create index if not exists nfce_inutilizacoes_emp on public.nfce_inutilizacoes(empresa_id, ambiente, serie, inicio);
alter table public.nfce_inutilizacoes enable row level security;
create policy nfce_inutilizacoes_select on public.nfce_inutilizacoes for select
  using (empresa_id = public.auth_empresa_id() and public.auth_papel() in ('administrador','gerente'));
-- Gravação só pelo servidor (Edge Function), depois do protocolo da SEFAZ

-- Venda com NFC-e autorizada, em contingência ou sem resposta só é cancelada depois da nota
create or replace function public.cancelar_venda(p_venda uuid, p_motivo text)
returns void language plpgsql security definer set search_path = public as $$
declare v_emp uuid := public.auth_empresa_id(); r record; v_nota text;
begin
  if public.auth_papel() not in ('administrador','gerente') then
    raise exception 'Cancelamento exige gerente ou administrador';
  end if;
  if coalesce(length(trim(p_motivo)),0) < 15 then raise exception 'Informe o motivo (mínimo 15 caracteres)'; end if;
  select status into v_nota from public.nfce_documentos
   where venda_id = p_venda and empresa_id = v_emp and status in ('autorizada','contingencia','pendente') limit 1;
  if v_nota = 'autorizada' then raise exception 'Cancele primeiro a NFC-e desta venda (botão Cancelar NFC-e e venda)'; end if;
  if v_nota = 'contingencia' then raise exception 'A NFC-e desta venda está em contingência: transmita-a à SEFAZ e depois cancele'; end if;
  if v_nota = 'pendente' then raise exception 'A NFC-e desta venda está sem resposta da SEFAZ: transmita as pendentes antes de cancelar'; end if;
  if exists (select 1 from public.contas_receber where venda_id = p_venda and valor_pago > 0) then
    raise exception 'A venda tem parcelas já recebidas; faça uma devolução em vez de cancelar';
  end if;
  if exists (select 1 from public.devolucoes where venda_id = p_venda) then
    raise exception 'A venda já tem devolução registrada';
  end if;
  update public.vendas set status = 'cancelada', cancelada_em = now(), motivo_cancelamento = p_motivo
   where id = p_venda and empresa_id = v_emp and status = 'concluida';
  if not found then raise exception 'Venda não encontrada ou já cancelada'; end if;
  for r in select produto_id, lote_id, quantidade, venda_item_id from public.movimentos_estoque
            where origem_id = p_venda and tipo = 'saida_venda' and empresa_id = v_emp loop
    insert into public.movimentos_estoque(empresa_id, produto_id, lote_id, tipo, quantidade, origem_id, venda_item_id, usuario_id)
    values (v_emp, r.produto_id, r.lote_id, 'estorno_venda', -r.quantidade, p_venda, r.venda_item_id, auth.uid());
  end loop;
  update public.contas_receber set status = 'cancelada' where venda_id = p_venda and status = 'aberta';
  insert into public.creditos_cliente(empresa_id, cliente_id, valor, origem, referencia_id)
  select v_emp, cliente_id, -valor, 'ajuste', p_venda from public.creditos_cliente where referencia_id = p_venda and origem = 'venda';
  insert into public.auditoria(empresa_id, acao, entidade, entidade_id, detalhes)
  values (v_emp, 'cancelar', 'venda', p_venda, jsonb_build_object('motivo', p_motivo));
end $$;

-- Números da série atual que não viraram nota válida: faixas para reenviar ou inutilizar
create or replace function public.numeros_nfce_sem_nota()
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare v_emp uuid := public.auth_empresa_id(); e public.empresas; v_ult bigint; r jsonb;
begin
  if public.auth_papel() not in ('administrador','gerente') then raise exception 'Somente gerente ou administrador'; end if;
  select * into e from public.empresas where id = v_emp;
  select ultimo into v_ult from public.numeracao where empresa_id = v_emp and tipo = 'nfce_' || e.nfce_ambiente and serie = e.nfce_serie;
  if v_ult is null then
    return jsonb_build_object('ambiente', e.nfce_ambiente, 'serie', e.nfce_serie, 'ultimo', 0, 'faixas', '[]'::jsonb);
  end if;
  with nums as (select generate_series(greatest(1, v_ult - 20000), v_ult) n),
  docs as (
    select distinct on (numero) numero, status, venda_id, criado_em from public.nfce_documentos
     where empresa_id = v_emp and ambiente = e.nfce_ambiente and serie = e.nfce_serie and numero <= v_ult
     order by numero, (status in ('autorizada','cancelada','contingencia','pendente')) desc, criado_em desc),
  livres as (
    select n.n, d.status, d.venda_id, coalesce(d.criado_em, now()) criado_em
      from nums n left join docs d on d.numero = n.n
     where coalesce(d.status, 'sem_nota') in ('sem_nota', 'rejeitada')
       and not exists (select 1 from public.nfce_inutilizacoes i where i.empresa_id = v_emp and i.ambiente = e.nfce_ambiente
                        and i.serie = e.nfce_serie and n.n between i.inicio and i.fim)),
  grupos as (
    select n, coalesce(status, 'sem_nota') situacao, venda_id, criado_em,
           n - row_number() over (partition by coalesce(status, 'sem_nota'), (status = 'rejeitada' and venda_id is not null) order by n) g
      from livres)
  select coalesce(jsonb_agg(jsonb_build_object('inicio', ini, 'fim', fim, 'qtd', fim - ini + 1, 'situacao', situacao,
           'venda_numero', venda_numero, 'desde', desde, 'pode_reenviar', coalesce(pode_reenviar, false)) order by ini), '[]'::jsonb) into r
    from (select min(g.n) ini, max(g.n) fim, g.situacao, min(v.numero) venda_numero, min(g.criado_em) desde,
                 bool_and(v.status = 'concluida' and not exists (select 1 from public.nfce_documentos o where o.venda_id = v.id
                   and o.status in ('autorizada','contingencia','cancelada','pendente'))) pode_reenviar
            from grupos g left join public.vendas v on v.id = g.venda_id
           group by g.g, g.situacao, case when g.situacao = 'rejeitada' then g.venda_id end) x;
  return jsonb_build_object('ambiente', e.nfce_ambiente, 'serie', e.nfce_serie, 'ultimo', v_ult, 'faixas', r);
end $$;
grant execute on function public.numeros_nfce_sem_nota() to authenticated;
revoke execute on function public.numeros_nfce_sem_nota() from anon, public;
