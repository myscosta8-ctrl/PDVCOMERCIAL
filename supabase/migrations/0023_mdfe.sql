-- MDF-e (manifesto de carga própria, modal rodoviário)

alter table public.empresas add column if not exists mdfe_serie integer not null default 1;

create table public.mdfe_documentos (
  id               uuid primary key default gen_random_uuid(),
  empresa_id       uuid not null references public.empresas(id),
  uf_inicio        text,
  uf_fim           text,
  percurso         text[] not null default '{}',
  carregamento     jsonb not null default '[]'::jsonb,   -- [{codigo, nome}]
  descargas        jsonb not null default '[]'::jsonb,   -- [{codigo, nome, chaves: [...]}]
  veiculo          jsonb not null default '{}'::jsonb,   -- {placa, renavam, tara, capKG, tpRod, tpCar, uf}
  condutores       jsonb not null default '[]'::jsonb,   -- [{nome, cpf}]
  produto          jsonb not null default '{}'::jsonb,   -- {tpCarga, xProd, ncm}
  valor_carga      numeric(14,2) not null default 0,
  unidade          text not null default '01' check (unidade in ('01','02')),
  peso_carga       numeric(14,4) not null default 0,
  informacoes      text,
  placa            text,
  ambiente         smallint,
  serie            integer,
  numero           bigint,
  chave            text,
  codigo_numerico  text,
  status           text not null default 'rascunho'
                   check (status in ('rascunho','pendente','autorizada','rejeitada','encerrada','cancelada')),
  codigo_status    text,
  motivo           text,
  protocolo        text,
  xml_enviado      text,
  xml_autorizado   text,
  emitida_em       timestamptz,
  encerrada_em     timestamptz,
  encerramento     jsonb,
  cancelada_em     timestamptz,
  justificativa_cancelamento text,
  protocolo_evento text,
  xml_evento       text,
  usuario_id       uuid default auth.uid(),
  criado_em        timestamptz not null default now()
);
create unique index mdfe_numero_unico on public.mdfe_documentos(empresa_id, ambiente, serie, numero) where numero is not null;
create index on public.mdfe_documentos(empresa_id, criado_em desc);
create trigger mdfe_documentos_empresa before insert or update on public.mdfe_documentos for each row execute function public.fixar_empresa();
alter table public.mdfe_documentos enable row level security;
create policy mdfe_select on public.mdfe_documentos for select
  using (empresa_id = public.auth_empresa_id() and public.auth_papel() in ('administrador','gerente'));
-- O usuário só cria e altera rascunhos; emissão, encerramento e cancelamento passam pelo servidor
create policy mdfe_insert on public.mdfe_documentos for insert
  with check (public.auth_papel() in ('administrador','gerente') and status = 'rascunho');
create policy mdfe_update on public.mdfe_documentos for update
  using (empresa_id = public.auth_empresa_id() and public.auth_papel() in ('administrador','gerente') and status in ('rascunho','rejeitada'))
  with check (status in ('rascunho','rejeitada'));
create policy mdfe_delete on public.mdfe_documentos for delete
  using (empresa_id = public.auth_empresa_id() and public.auth_papel() in ('administrador','gerente') and status = 'rascunho');
