-- Painel do revendedor: cadastro de empresas clientes, mensalidades da licença, suspensão e acompanhamento de uso.
-- O revendedor é um usuário do sistema marcado na tabela revendedores (o cadastro é feito direto no banco).

create table if not exists public.revendedores (
  user_id    uuid primary key references auth.users(id) on delete cascade,
  nome       text not null,
  criado_em  timestamptz not null default now()
);
alter table public.revendedores enable row level security;
revoke all on public.revendedores from anon, authenticated;

create or replace function public.eh_revendedor()
returns boolean language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.revendedores where user_id = auth.uid())
$$;
revoke execute on function public.eh_revendedor() from public, anon;
grant execute on function public.eh_revendedor() to authenticated;

-- Dados da licença na empresa
alter table public.empresas
  add column if not exists plano text not null default 'completo' check (plano in ('essencial','fiscal','completo')),
  add column if not exists mensalidade numeric(12,2) not null default 0 check (mensalidade >= 0),
  add column if not exists dia_vencimento smallint not null default 10 check (dia_vencimento between 1 and 28),
  add column if not exists cliente_desde date not null default current_date,
  add column if not exists bloqueada_em timestamptz,
  add column if not exists motivo_bloqueio text,
  add column if not exists contato jsonb not null default '{}'::jsonb,   -- { nome, telefone, email }
  add column if not exists obs_revenda text;

-- O administrador da empresa não altera os dados da licença; só o revendedor (pelas funções abaixo)
create or replace function public.proteger_licenca()
returns trigger language plpgsql set search_path = public as $$
begin
  if not public.eh_revendedor() and coalesce(current_setting('pdv.revenda', true), '') <> 'sim' then
    new.plano := old.plano; new.mensalidade := old.mensalidade; new.dia_vencimento := old.dia_vencimento;
    new.cliente_desde := old.cliente_desde; new.bloqueada_em := old.bloqueada_em; new.motivo_bloqueio := old.motivo_bloqueio;
    new.contato := old.contato; new.obs_revenda := old.obs_revenda; new.ativa := old.ativa;
  end if;
  return new;
end $$;
drop trigger if exists proteger_licenca on public.empresas;
create trigger proteger_licenca before update on public.empresas for each row execute function public.proteger_licenca();

-- Mantém as regras anteriores (servidor e rotinas do banco gravam informando a empresa) e acrescenta:
-- as funções do revendedor gravam dados iniciais de outra empresa (plano de contas da empresa nova).
-- A marca pdv.revenda só é ligada dentro dessas funções.
create or replace function public.fixar_empresa()
returns trigger language plpgsql set search_path = public as $$
begin
  if tg_op = 'INSERT' then
    if new.empresa_id is not null and (coalesce(current_setting('pdv.revenda', true), '') = 'sim'
       or (auth.uid() is null and (coalesce(auth.jwt()->>'role', '') = 'service_role' or current_user in ('postgres', 'supabase_admin')))) then
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

-- Empresa suspensa ou encerrada: os usuários perdem o acesso aos dados
create or replace function public.auth_empresa_id()
returns uuid language sql stable security definer set search_path = public as $$
  select u.empresa_id from public.usuarios u join public.empresas e on e.id = u.empresa_id
   where u.id = auth.uid() and u.ativo and e.ativa and e.bloqueada_em is null
$$;
create or replace function public.auth_papel()
returns text language sql stable security definer set search_path = public as $$
  select u.papel from public.usuarios u join public.empresas e on e.id = u.empresa_id
   where u.id = auth.uid() and u.ativo and e.ativa and e.bloqueada_em is null
$$;

-- Mensalidades da licença
create table if not exists public.licenca_mensalidades (
  id          uuid primary key default gen_random_uuid(),
  empresa_id  uuid not null references public.empresas(id),
  competencia date not null check (extract(day from competencia) = 1),
  valor       numeric(12,2) not null check (valor >= 0),
  vencimento  date not null,
  status      text not null default 'aberta' check (status in ('aberta','paga','cancelada')),
  pago_em     date,
  forma       text,
  observacao  text,
  criado_em   timestamptz not null default now(),
  unique (empresa_id, competencia)
);
alter table public.licenca_mensalidades enable row level security;
-- O administrador vê as mensalidades da própria empresa; gravação só pelo revendedor (funções abaixo)
drop policy if exists mensalidades_select on public.licenca_mensalidades;
create policy mensalidades_select on public.licenca_mensalidades for select to authenticated
  using (empresa_id = public.auth_empresa_id() and public.auth_papel() = 'administrador');
revoke insert, update, delete on public.licenca_mensalidades from anon, authenticated;
grant select on public.licenca_mensalidades to authenticated;

-- Situação do acesso de quem entrou (funciona mesmo com a empresa suspensa)
create or replace function public.situacao_acesso()
returns jsonb language sql stable security definer set search_path = public as $$
  select jsonb_build_object(
    'revendedor', public.eh_revendedor(),
    'empresa', e.nome_fantasia, 'razao_social', e.razao_social,
    'suspensa', e.bloqueada_em is not null, 'encerrada', not e.ativa, 'motivo', e.motivo_bloqueio,
    'usuario_ativo', u.ativo,
    'mensalidades_vencidas', (select count(*) from public.licenca_mensalidades m
                               where m.empresa_id = e.id and m.status = 'aberta' and m.vencimento < (now() at time zone 'America/Sao_Paulo')::date),
    'valor_vencido', (select coalesce(sum(valor), 0) from public.licenca_mensalidades m
                       where m.empresa_id = e.id and m.status = 'aberta' and m.vencimento < (now() at time zone 'America/Sao_Paulo')::date))
    from public.usuarios u join public.empresas e on e.id = u.empresa_id where u.id = auth.uid()
$$;
revoke execute on function public.situacao_acesso() from public, anon;
grant execute on function public.situacao_acesso() to authenticated;

-- ---------------------------------------------------------------- Funções do revendedor
create or replace function public.exigir_revendedor()
returns void language plpgsql stable security definer set search_path = public as $$
begin
  if not public.eh_revendedor() then raise exception 'Somente o revendedor'; end if;
end $$;
revoke execute on function public.exigir_revendedor() from public, anon, authenticated;

-- Visão geral: clientes, receita mensal, inadimplência e uso de cada empresa
create or replace function public.revenda_painel()
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare
  v_hoje date := (now() at time zone 'America/Sao_Paulo')::date;
  r jsonb;
begin
  perform public.exigir_revendedor();
  with emp as (
    select e.*,
      (select count(*) from public.usuarios u where u.empresa_id = e.id and u.ativo) usuarios,
      (select max(v.criado_em) from public.vendas v where v.empresa_id = e.id) ultima_venda,
      (select count(*) from public.vendas v where v.empresa_id = e.id and v.status = 'concluida' and v.criado_em >= now() - interval '30 days') vendas_30d,
      (select coalesce(sum(v.total), 0) from public.vendas v where v.empresa_id = e.id and v.status = 'concluida' and v.criado_em >= now() - interval '30 days') faturamento_30d,
      (select count(*) from public.nfce_documentos d where d.empresa_id = e.id and d.status = 'autorizada' and d.criado_em >= now() - interval '30 days') nfce_30d,
      (select count(*) from public.licenca_mensalidades m where m.empresa_id = e.id and m.status = 'aberta' and m.vencimento < v_hoje) vencidas,
      (select coalesce(sum(m.valor), 0) from public.licenca_mensalidades m where m.empresa_id = e.id and m.status = 'aberta' and m.vencimento < v_hoje) valor_vencido,
      (select min(m.vencimento) from public.licenca_mensalidades m where m.empresa_id = e.id and m.status = 'aberta') proximo_vencimento,
      (select c.email from public.convites c where c.empresa_id = e.id and c.papel = 'administrador' and c.usado_em is null order by c.criado_em limit 1) convite_pendente
    from public.empresas e)
  select jsonb_build_object(
    'clientes', coalesce((select jsonb_agg(jsonb_build_object(
        'id', id, 'razao_social', razao_social, 'nome_fantasia', nome_fantasia, 'cnpj', cnpj, 'uf', uf, 'segmento', segmento,
        'regime_tributario', regime_tributario, 'plano', plano, 'mensalidade', mensalidade, 'dia_vencimento', dia_vencimento,
        'cliente_desde', cliente_desde, 'ativa', ativa, 'bloqueada_em', bloqueada_em, 'motivo_bloqueio', motivo_bloqueio,
        'contato', contato, 'obs_revenda', obs_revenda, 'nfce_ambiente', nfce_ambiente, 'certificado_validade', certificado_validade,
        'usuarios', usuarios, 'ultima_venda', ultima_venda, 'vendas_30d', vendas_30d, 'faturamento_30d', faturamento_30d,
        'nfce_30d', nfce_30d, 'vencidas', vencidas, 'valor_vencido', valor_vencido, 'proximo_vencimento', proximo_vencimento,
        'convite_pendente', convite_pendente) order by coalesce(nome_fantasia, razao_social)) from emp), '[]'::jsonb),
    'totais', jsonb_build_object(
      'ativos', (select count(*) from emp where ativa and bloqueada_em is null),
      'suspensos', (select count(*) from emp where ativa and bloqueada_em is not null),
      'encerrados', (select count(*) from emp where not ativa),
      'receita_mensal', (select coalesce(sum(mensalidade), 0) from emp where ativa),
      'inadimplentes', (select count(*) from emp where vencidas > 0 and ativa),
      'valor_vencido', (select coalesce(sum(valor_vencido), 0) from emp where ativa),
      'recebido_mes', (select coalesce(sum(valor), 0) from public.licenca_mensalidades
                        where status = 'paga' and pago_em >= date_trunc('month', v_hoje)::date),
      'sem_uso_7d', (select count(*) from emp where ativa and bloqueada_em is null and (ultima_venda is null or ultima_venda < now() - interval '7 days')))
  ) into r;
  return r;
end $$;

-- Nova empresa cliente com o convite do administrador
create or replace function public.revenda_criar_empresa(p_dados jsonb, p_admin_nome text, p_admin_email text)
returns uuid language plpgsql security definer set search_path = public as $$
declare
  v_id uuid;
  v_cnpj text := nullif(regexp_replace(coalesce(p_dados->>'cnpj', ''), '\D', '', 'g'), '');
  v_email text := lower(trim(coalesce(p_admin_email, '')));
begin
  perform public.exigir_revendedor();
  if coalesce(trim(p_dados->>'razao_social'), '') = '' then raise exception 'Informe a razão social'; end if;
  if v_cnpj is not null and length(v_cnpj) <> 14 then raise exception 'CNPJ inválido'; end if;
  if v_cnpj is not null and exists (select 1 from public.empresas where cnpj = v_cnpj) then raise exception 'Já existe empresa com este CNPJ'; end if;
  if v_email !~ '^[^@\s]+@[^@\s]+\.[^@\s]+$' then raise exception 'E-mail do administrador inválido'; end if;
  if coalesce(trim(p_admin_nome), '') = '' then raise exception 'Informe o nome do administrador'; end if;
  if exists (select 1 from public.usuarios where lower(email) = v_email) or exists (select 1 from public.convites where lower(email) = v_email) then
    raise exception 'Este e-mail já está em uso no sistema';
  end if;
  perform set_config('pdv.revenda', 'sim', true);
  insert into public.empresas(razao_social, nome_fantasia, cnpj, uf, segmento, regime_tributario, plano, mensalidade, dia_vencimento,
                              cliente_desde, contato, obs_revenda)
  values (trim(p_dados->>'razao_social'), nullif(trim(p_dados->>'nome_fantasia'), ''), v_cnpj, nullif(upper(p_dados->>'uf'), ''),
          coalesce(nullif(p_dados->>'segmento', ''), 'varejo'), coalesce(nullif(p_dados->>'regime_tributario', ''), 'simples'),
          coalesce(nullif(p_dados->>'plano', ''), 'completo'), coalesce((p_dados->>'mensalidade')::numeric, 0),
          coalesce((p_dados->>'dia_vencimento')::smallint, 10), coalesce((p_dados->>'cliente_desde')::date, current_date),
          coalesce(p_dados->'contato', '{}'::jsonb), nullif(trim(p_dados->>'obs_revenda'), ''))
  returning id into v_id;
  insert into public.convites(email, empresa_id, nome, papel) values (v_email, v_id, trim(p_admin_nome), 'administrador');
  return v_id;
end $$;

create or replace function public.revenda_atualizar_empresa(p_empresa uuid, p_dados jsonb)
returns void language plpgsql security definer set search_path = public as $$
declare v_cnpj text := nullif(regexp_replace(coalesce(p_dados->>'cnpj', ''), '\D', '', 'g'), '');
begin
  perform public.exigir_revendedor();
  if coalesce(trim(p_dados->>'razao_social'), '') = '' then raise exception 'Informe a razão social'; end if;
  if v_cnpj is not null and length(v_cnpj) <> 14 then raise exception 'CNPJ inválido'; end if;
  if v_cnpj is not null and exists (select 1 from public.empresas where cnpj = v_cnpj and id <> p_empresa) then raise exception 'Já existe empresa com este CNPJ'; end if;
  perform set_config('pdv.revenda', 'sim', true);
  update public.empresas set
    razao_social = trim(p_dados->>'razao_social'), nome_fantasia = nullif(trim(p_dados->>'nome_fantasia'), ''), cnpj = v_cnpj,
    uf = nullif(upper(p_dados->>'uf'), ''), segmento = coalesce(nullif(p_dados->>'segmento', ''), segmento),
    regime_tributario = coalesce(nullif(p_dados->>'regime_tributario', ''), regime_tributario),
    plano = coalesce(nullif(p_dados->>'plano', ''), plano), mensalidade = coalesce((p_dados->>'mensalidade')::numeric, mensalidade),
    dia_vencimento = coalesce((p_dados->>'dia_vencimento')::smallint, dia_vencimento),
    cliente_desde = coalesce((p_dados->>'cliente_desde')::date, cliente_desde),
    contato = coalesce(p_dados->'contato', contato), obs_revenda = nullif(trim(p_dados->>'obs_revenda'), '')
  where id = p_empresa;
  if not found then raise exception 'Empresa não encontrada'; end if;
end $$;

-- Suspende (acesso bloqueado, dados preservados), reativa ou encerra o contrato
create or replace function public.revenda_situacao_empresa(p_empresa uuid, p_acao text, p_motivo text default null)
returns void language plpgsql security definer set search_path = public as $$
begin
  perform public.exigir_revendedor();
  if p_empresa = (select empresa_id from public.usuarios where id = auth.uid()) then
    raise exception 'Você não pode suspender ou encerrar a própria empresa';
  end if;
  if p_acao in ('suspender','encerrar') and length(trim(coalesce(p_motivo, ''))) < 5 then raise exception 'Informe o motivo'; end if;
  perform set_config('pdv.revenda', 'sim', true);
  if p_acao = 'suspender' then
    update public.empresas set bloqueada_em = now(), motivo_bloqueio = trim(p_motivo) where id = p_empresa;
  elsif p_acao = 'reativar' then
    update public.empresas set bloqueada_em = null, motivo_bloqueio = null, ativa = true where id = p_empresa;
  elsif p_acao = 'encerrar' then
    update public.empresas set ativa = false, bloqueada_em = coalesce(bloqueada_em, now()), motivo_bloqueio = trim(p_motivo) where id = p_empresa;
  else
    raise exception 'Ação inválida';
  end if;
  if not found then raise exception 'Empresa não encontrada'; end if;
end $$;

-- Mensalidades do mês para todas as empresas ativas com valor (não duplica)
create or replace function public.revenda_gerar_mensalidades(p_competencia date)
returns integer language plpgsql security definer set search_path = public as $$
declare v_comp date := date_trunc('month', p_competencia)::date; n integer;
begin
  perform public.exigir_revendedor();
  insert into public.licenca_mensalidades(empresa_id, competencia, valor, vencimento)
  select e.id, v_comp, e.mensalidade, make_date(extract(year from v_comp)::int, extract(month from v_comp)::int, e.dia_vencimento)
    from public.empresas e
   where e.ativa and e.mensalidade > 0 and e.cliente_desde <= (v_comp + interval '1 month - 1 day')::date
  on conflict (empresa_id, competencia) do nothing;
  get diagnostics n = row_count;
  return n;
end $$;

create or replace function public.revenda_mensalidades(p_empresa uuid)
returns jsonb language plpgsql stable security definer set search_path = public as $$
begin
  perform public.exigir_revendedor();
  return coalesce((select jsonb_agg(to_jsonb(m) order by m.competencia desc) from public.licenca_mensalidades m where m.empresa_id = p_empresa), '[]'::jsonb);
end $$;

create or replace function public.revenda_baixar_mensalidade(p_id uuid, p_acao text, p_data date default null, p_forma text default null, p_obs text default null)
returns void language plpgsql security definer set search_path = public as $$
begin
  perform public.exigir_revendedor();
  if p_acao = 'pagar' then
    update public.licenca_mensalidades set status = 'paga', pago_em = coalesce(p_data, (now() at time zone 'America/Sao_Paulo')::date),
      forma = nullif(trim(coalesce(p_forma, '')), ''), observacao = nullif(trim(coalesce(p_obs, '')), '') where id = p_id and status = 'aberta';
  elsif p_acao = 'estornar' then
    update public.licenca_mensalidades set status = 'aberta', pago_em = null, forma = null where id = p_id and status = 'paga';
  elsif p_acao = 'cancelar' then
    update public.licenca_mensalidades set status = 'cancelada', observacao = nullif(trim(coalesce(p_obs, '')), '') where id = p_id and status = 'aberta';
  else
    raise exception 'Ação inválida';
  end if;
  if not found then raise exception 'Mensalidade não encontrada ou já está nessa situação'; end if;
end $$;

-- Novo convite para a empresa (ex.: o administrador perdeu o acesso ou trocou de e-mail)
create or replace function public.revenda_convidar(p_empresa uuid, p_nome text, p_email text, p_papel text default 'administrador')
returns void language plpgsql security definer set search_path = public as $$
declare v_email text := lower(trim(coalesce(p_email, '')));
begin
  perform public.exigir_revendedor();
  if v_email !~ '^[^@\s]+@[^@\s]+\.[^@\s]+$' then raise exception 'E-mail inválido'; end if;
  if p_papel not in ('administrador','gerente','operador') then raise exception 'Papel inválido'; end if;
  if exists (select 1 from public.usuarios where lower(email) = v_email) then raise exception 'Este e-mail já tem acesso ao sistema'; end if;
  if not exists (select 1 from public.empresas where id = p_empresa) then raise exception 'Empresa não encontrada'; end if;
  delete from public.convites where lower(email) = v_email and usado_em is null;
  insert into public.convites(email, empresa_id, nome, papel) values (v_email, p_empresa, trim(p_nome), p_papel);
end $$;

revoke execute on function public.revenda_painel(), public.revenda_criar_empresa(jsonb, text, text), public.revenda_atualizar_empresa(uuid, jsonb),
  public.revenda_situacao_empresa(uuid, text, text), public.revenda_gerar_mensalidades(date), public.revenda_mensalidades(uuid),
  public.revenda_baixar_mensalidade(uuid, text, date, text, text), public.revenda_convidar(uuid, text, text, text) from public, anon;
grant execute on function public.revenda_painel(), public.revenda_criar_empresa(jsonb, text, text), public.revenda_atualizar_empresa(uuid, jsonb),
  public.revenda_situacao_empresa(uuid, text, text), public.revenda_gerar_mensalidades(date), public.revenda_mensalidades(uuid),
  public.revenda_baixar_mensalidade(uuid, text, date, text, text), public.revenda_convidar(uuid, text, text, text) to authenticated;

-- Empresa suspensa ou encerrada também não usa o servidor fiscal nem o PIX (as funções do servidor leem as credenciais por aqui)
create or replace function public.ler_credenciais_fiscais(p_empresa uuid)
returns jsonb language plpgsql stable security definer set search_path = public, vault as $$
begin
  if not exists (select 1 from public.empresas where id = p_empresa and ativa and bloqueada_em is null) then
    raise exception 'Acesso da empresa suspenso';
  end if;
  return jsonb_build_object(
    'pfx', (select decrypted_secret from vault.decrypted_secrets where name = 'nfce_pfx_' || p_empresa),
    'senha', (select decrypted_secret from vault.decrypted_secrets where name = 'nfce_senha_' || p_empresa),
    'csc', (select decrypted_secret from vault.decrypted_secrets where name = 'nfce_csc_' || p_empresa));
end $$;
revoke execute on function public.ler_credenciais_fiscais(uuid) from public, anon, authenticated;
grant execute on function public.ler_credenciais_fiscais(uuid) to service_role;

create or replace function public.ler_credenciais_pix(p_empresa uuid)
returns jsonb language plpgsql stable security definer set search_path = public, vault as $$
begin
  if not exists (select 1 from public.empresas where id = p_empresa and ativa and bloqueada_em is null) then
    raise exception 'Acesso da empresa suspenso';
  end if;
  return jsonb_build_object(
    'client_id', (select decrypted_secret from vault.decrypted_secrets where name = 'pix_client_id_' || p_empresa),
    'client_secret', (select decrypted_secret from vault.decrypted_secrets where name = 'pix_client_secret_' || p_empresa),
    'cert', (select decrypted_secret from vault.decrypted_secrets where name = 'pix_cert_' || p_empresa),
    'chave', (select decrypted_secret from vault.decrypted_secrets where name = 'pix_chave_' || p_empresa));
end $$;
revoke execute on function public.ler_credenciais_pix(uuid) from public, anon, authenticated;
grant execute on function public.ler_credenciais_pix(uuid) to service_role;
