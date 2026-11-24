-- DIFAL na NF-e (ajustes da tabela de ICMS por UF) e notas emitidas contra o CNPJ (distribuição de documentos)

alter table public.empresas
  add column if not exists aliquotas_uf jsonb not null default '{}'::jsonb,   -- {UF: {interna, fcp, base_dupla}}: só o que difere do padrão
  add column if not exists dfe_ult_nsu text not null default '000000000000000',
  add column if not exists dfe_max_nsu text,
  add column if not exists dfe_consultado_em timestamptz,
  add column if not exists dfe_liberado_em timestamptz;                      -- antes disso a SEFAZ recusa nova busca

create table public.nfe_recebidas (
  id                     uuid primary key default gen_random_uuid(),
  empresa_id             uuid not null references public.empresas(id),
  chave                  text not null check (chave ~ '^\d{44}$'),
  nsu                    text,
  cnpj_emitente          text,
  nome_emitente          text,
  ie_emitente            text,
  emissao                timestamptz,
  valor                  numeric(14,2),
  tipo_nf                smallint,                 -- 0 entrada, 1 saída (do ponto de vista do emitente)
  situacao               smallint not null default 1 check (situacao in (1, 2, 3)),   -- 1 autorizada, 2 denegada, 3 cancelada
  protocolo              text,
  resumo                 boolean not null default true,
  xml                    text,
  manifestacao           text check (manifestacao in ('ciencia','confirmada','desconhecida','nao_realizada')),
  manifestada_em         timestamptz,
  protocolo_manifestacao text,
  criado_em              timestamptz not null default now(),
  unique (empresa_id, chave)
);
create index on public.nfe_recebidas(empresa_id, emissao desc);
alter table public.nfe_recebidas enable row level security;
-- Leitura pelos gestores; gravação só pelo servidor (função fiscal)
create policy nfe_recebidas_select on public.nfe_recebidas for select
  using (empresa_id = public.auth_empresa_id() and public.auth_papel() in ('administrador','gerente'));
