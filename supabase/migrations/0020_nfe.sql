-- NF-e modelo 55: venda a empresas e pessoas, devolução ao fornecedor e outras saídas, com carta de correção

alter table public.empresas
  add column if not exists nfe_serie integer not null default 1,
  add column if not exists resp_tecnico jsonb;   -- {cnpj, contato, email, fone}: exigido por algumas UFs

alter table public.nfce_inutilizacoes add column if not exists modelo smallint not null default 65 check (modelo in (55, 65));

create table public.nfe_documentos (
  id               uuid primary key default gen_random_uuid(),
  empresa_id       uuid not null references public.empresas(id),
  venda_id         uuid references public.vendas(id),
  cliente_id       uuid references public.clientes(id),
  fornecedor_id    uuid references public.fornecedores(id),
  natureza         text not null default 'Venda de mercadoria',
  finalidade       smallint not null default 1 check (finalidade in (1, 2, 3, 4)),
  presenca         smallint not null default 1 check (presenca in (0, 1, 2, 3, 9)),
  consumidor_final boolean not null default true,
  destinatario     jsonb not null default '{}'::jsonb,
  itens            jsonb not null default '[]'::jsonb,
  frete            jsonb not null default '{"modalidade": 9}'::jsonb,
  pagamentos       jsonb not null default '[]'::jsonb,
  referencias      text[] not null default '{}',
  informacoes      text,
  mover_estoque    boolean not null default false,
  estoque_movido   boolean not null default false,
  valor_total      numeric(14,2) not null default 0,
  ambiente         smallint,
  serie            integer,
  numero           bigint,
  chave            text,
  codigo_numerico  text,
  status           text not null default 'rascunho'
                   check (status in ('rascunho','pendente','autorizada','rejeitada','cancelada','inutilizada')),
  codigo_status    text,
  motivo           text,
  protocolo        text,
  xml_enviado      text,
  xml_autorizado   text,
  emitida_em       timestamptz,
  cancelada_em     timestamptz,
  protocolo_cancelamento text,
  justificativa_cancelamento text,
  xml_cancelamento text,
  cces             jsonb not null default '[]'::jsonb,   -- [{sequencia, correcao, protocolo, quando, xml}]
  usuario_id       uuid default auth.uid(),
  criado_em        timestamptz not null default now()
);
create unique index nfe_numero_unico on public.nfe_documentos(empresa_id, ambiente, serie, numero) where numero is not null;
create unique index nfe_uma_por_venda on public.nfe_documentos(venda_id) where venda_id is not null and status in ('pendente','autorizada');
create index on public.nfe_documentos(empresa_id, criado_em desc);
create trigger nfe_documentos_empresa before insert or update on public.nfe_documentos for each row execute function public.fixar_empresa();
alter table public.nfe_documentos enable row level security;
create policy nfe_select on public.nfe_documentos for select
  using (empresa_id = public.auth_empresa_id() and public.auth_papel() in ('administrador','gerente'));
-- O usuário só cria e altera rascunhos; emissão, cancelamento e carta de correção passam pelo servidor
create policy nfe_insert on public.nfe_documentos for insert
  with check (public.auth_papel() in ('administrador','gerente') and status = 'rascunho');
create policy nfe_update on public.nfe_documentos for update
  using (empresa_id = public.auth_empresa_id() and public.auth_papel() in ('administrador','gerente') and status in ('rascunho','rejeitada'))
  with check (status in ('rascunho','rejeitada'));
create policy nfe_delete on public.nfe_documentos for delete
  using (empresa_id = public.auth_empresa_id() and public.auth_papel() in ('administrador','gerente') and status = 'rascunho');

-- Venda com NFC-e não recebe NF-e e vice-versa (a mesma operação não pode ter duas notas)
create or replace function public.conferir_nota_unica()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if new.venda_id is null then return new; end if;
  if tg_table_name = 'nfe_documentos' and exists (select 1 from public.nfce_documentos
       where venda_id = new.venda_id and status in ('autorizada','contingencia','pendente')) then
    raise exception 'Esta venda já tem NFC-e; não dá para emitir NF-e para ela';
  end if;
  if tg_table_name = 'nfce_documentos' and exists (select 1 from public.nfe_documentos
       where venda_id = new.venda_id and status in ('autorizada','pendente')) then
    raise exception 'Esta venda já tem NF-e; não dá para emitir NFC-e para ela';
  end if;
  return new;
end $$;
revoke execute on function public.conferir_nota_unica() from public, anon, authenticated;
create trigger nfe_nota_unica before insert or update of venda_id, status on public.nfe_documentos
  for each row when (new.status in ('rascunho','pendente','autorizada')) execute function public.conferir_nota_unica();
create trigger nfce_nota_unica before insert or update of status on public.nfce_documentos
  for each row when (new.status in ('pendente','autorizada','contingencia')) execute function public.conferir_nota_unica();

-- Venda com NF-e autorizada só é cancelada depois da nota
create or replace function public.bloquear_cancelamento_com_nfe()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if new.status = 'cancelada' and old.status = 'concluida'
     and exists (select 1 from public.nfe_documentos where venda_id = new.id and status in ('autorizada','pendente')) then
    raise exception 'Cancele primeiro a NF-e desta venda (tela Notas fiscais)';
  end if;
  return new;
end $$;
revoke execute on function public.bloquear_cancelamento_com_nfe() from public, anon, authenticated;
create trigger vendas_bloqueia_nfe before update of status on public.vendas
  for each row execute function public.bloquear_cancelamento_com_nfe();

-- Saída de estoque da NF-e avulsa (devolução ao fornecedor, venda fora do caixa), pelo lote que vence primeiro
alter table public.movimentos_estoque drop constraint if exists movimentos_estoque_tipo_check;
alter table public.movimentos_estoque add constraint movimentos_estoque_tipo_check
  check (tipo in ('entrada','saida_venda','estorno_venda','devolucao','ajuste','perda','inventario','transferencia_saida','transferencia_entrada','nfe_saida','nfe_estorno'));

create or replace function public.movimentar_estoque_nfe(p_nfe uuid, p_estornar boolean default false)
returns integer language plpgsql security definer set search_path = public as $$
declare
  v_emp uuid := public.auth_empresa_id(); d public.nfe_documentos; it jsonb; p public.produtos;
  v_resto numeric; v_lote uuid; v_tira numeric; n integer := 0; r record;
begin
  if public.auth_papel() not in ('administrador','gerente') then raise exception 'Somente gerente ou administrador'; end if;
  select * into d from public.nfe_documentos where id = p_nfe and empresa_id = v_emp for update;
  if not found then raise exception 'NF-e não encontrada'; end if;
  if not d.mover_estoque then return 0; end if;
  if p_estornar then
    if not d.estoque_movido then return 0; end if;
    for r in select produto_id, lote_id, quantidade from public.movimentos_estoque where origem_id = d.id and tipo = 'nfe_saida' loop
      insert into public.movimentos_estoque(empresa_id, produto_id, lote_id, tipo, quantidade, origem_id, observacao, usuario_id)
      values (v_emp, r.produto_id, r.lote_id, 'nfe_estorno', -r.quantidade, d.id, 'Cancelamento da NF-e ' || d.numero, auth.uid());
      n := n + 1;
    end loop;
    update public.nfe_documentos set estoque_movido = false where id = d.id;
    return n;
  end if;
  if d.status <> 'autorizada' then raise exception 'A NF-e precisa estar autorizada'; end if;
  if d.estoque_movido then return 0; end if;
  for it in select * from jsonb_array_elements(d.itens) loop
    continue when it->>'produto_id' is null;
    select * into p from public.produtos where id = (it->>'produto_id')::uuid and empresa_id = v_emp;
    continue when not found or p.e_kit;
    v_resto := (it->>'quantidade')::numeric;
    while v_resto > 0 loop
      v_lote := case when p.controla_lote then public.lote_fefo(p.id) end;
      v_tira := case when v_lote is null then v_resto
                     else least(v_resto, (select quantidade from public.lotes where id = v_lote)) end;
      insert into public.movimentos_estoque(empresa_id, produto_id, lote_id, tipo, quantidade, origem_id, observacao, usuario_id)
      values (v_emp, p.id, v_lote, 'nfe_saida', -v_tira, d.id, 'NF-e ' || d.numero, auth.uid());
      v_resto := v_resto - v_tira;
      n := n + 1;
    end loop;
  end loop;
  update public.nfe_documentos set estoque_movido = true where id = d.id;
  return n;
end $$;
grant execute on function public.movimentar_estoque_nfe(uuid, boolean) to authenticated;
revoke execute on function public.movimentar_estoque_nfe(uuid, boolean) from anon, public;
