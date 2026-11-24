-- Configuração fiscal da NFC-e. O certificado A1, a senha e o CSC ficam no cofre criptografado (Vault),
-- nunca em tabela comum. Só o servidor (Edge Function) consegue ler o conteúdo.

alter table public.empresas
  add column if not exists nfce_url_qrcode text,
  add column if not exists nfce_url_consulta text,
  add column if not exists certificado_titular text,
  add column if not exists certificado_validade timestamptz,
  add column if not exists certificado_atualizado_em timestamptz;

-- Valores padrão do Pará (consulta pública da SEFA-PA)
update public.empresas
   set nfce_url_qrcode = coalesce(nfce_url_qrcode, 'https://appnfc.sefa.pa.gov.br/portal-homologacao/view/consultas/nfce/nfceForm.seam'),
       nfce_url_consulta = coalesce(nfce_url_consulta, 'www.sefa.pa.gov.br/nfce/consulta')
 where uf = 'PA';

alter table public.nfce_documentos
  add column if not exists tentativas integer not null default 0,
  add column if not exists xml_enviado text;

-- Uma nota por venda (exceto rejeitadas, que podem ser reenviadas com novo número)
create unique index if not exists nfce_uma_por_venda on public.nfce_documentos(venda_id)
  where status in ('pendente','autorizada','contingencia','cancelada');

-- Guarda credenciais no cofre (somente administrador da empresa)
create or replace function public.salvar_credenciais_fiscais(p_pfx_base64 text default null, p_senha text default null,
                                                            p_csc_id text default null, p_csc text default null)
returns void language plpgsql security definer set search_path = public, vault as $$
declare
  v_emp uuid := public.auth_empresa_id();
  v_nome text; v_valor text; v_id uuid;
begin
  if public.auth_papel() is distinct from 'administrador' then raise exception 'Somente o administrador'; end if;
  for v_nome, v_valor in
    select * from (values ('pfx', p_pfx_base64), ('senha', p_senha), ('csc', p_csc)) x(n, v) where v is not null and v <> ''
  loop
    select id into v_id from vault.secrets where name = 'nfce_' || v_nome || '_' || v_emp;
    if v_id is null then
      perform vault.create_secret(v_valor, 'nfce_' || v_nome || '_' || v_emp);
    else
      perform vault.update_secret(v_id, v_valor);
    end if;
  end loop;
  if p_csc_id is not null and p_csc_id <> '' then
    update public.empresas set nfce_csc_id = p_csc_id where id = v_emp;
  end if;
  if p_pfx_base64 is not null and p_pfx_base64 <> '' then
    update public.empresas set certificado_atualizado_em = now(), certificado_titular = null, certificado_validade = null where id = v_emp;
  end if;
  insert into public.auditoria(empresa_id, acao, entidade, entidade_id, detalhes)
  values (v_emp, 'credenciais', 'empresa', v_emp,
          jsonb_build_object('certificado', p_pfx_base64 is not null, 'csc', p_csc is not null));
end $$;
revoke execute on function public.salvar_credenciais_fiscais(text, text, text, text) from public, anon;
grant execute on function public.salvar_credenciais_fiscais(text, text, text, text) to authenticated;

-- O que já está configurado (sem revelar conteúdo)
create or replace function public.credenciais_configuradas()
returns jsonb language sql stable security definer set search_path = public, vault as $$
  select jsonb_build_object(
    'certificado', exists(select 1 from vault.secrets where name = 'nfce_pfx_' || public.auth_empresa_id()),
    'senha', exists(select 1 from vault.secrets where name = 'nfce_senha_' || public.auth_empresa_id()),
    'csc', exists(select 1 from vault.secrets where name = 'nfce_csc_' || public.auth_empresa_id()))
  where public.auth_papel() = 'administrador'
$$;
revoke execute on function public.credenciais_configuradas() from public, anon;
grant execute on function public.credenciais_configuradas() to authenticated;

-- Leitura do conteúdo: apenas o servidor (service_role)
create or replace function public.ler_credenciais_fiscais(p_empresa uuid)
returns jsonb language sql stable security definer set search_path = public, vault as $$
  select jsonb_build_object(
    'pfx', (select decrypted_secret from vault.decrypted_secrets where name = 'nfce_pfx_' || p_empresa),
    'senha', (select decrypted_secret from vault.decrypted_secrets where name = 'nfce_senha_' || p_empresa),
    'csc', (select decrypted_secret from vault.decrypted_secrets where name = 'nfce_csc_' || p_empresa))
$$;
revoke execute on function public.ler_credenciais_fiscais(uuid) from public, anon, authenticated;
grant execute on function public.ler_credenciais_fiscais(uuid) to service_role;

grant execute on function public.proximo_numero(uuid, text, integer) to service_role;
