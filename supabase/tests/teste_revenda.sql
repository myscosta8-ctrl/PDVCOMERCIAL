-- Testes: painel do revendedor (empresas, licença, mensalidades e suspensão)
-- Rodar depois de teste_base.sql (reaproveita empresas e usuários).
\set ON_ERROR_STOP 1
set client_min_messages = warning;

create or replace function pg_temp.como(u text) returns void language plpgsql as $$
begin
  perform set_config('request.jwt.claim.sub', u, false);
  execute 'set role authenticated';
end $$;
create or replace function pg_temp.espera_erro(sql text, trecho text) returns void language plpgsql as $$
begin
  begin execute sql;
  exception when others then
    if position(trecho in sqlerrm) = 0 then raise exception 'Erro inesperado: % (esperado: %)', sqlerrm, trecho; end if;
    return;
  end;
  raise exception 'Deveria ter falhado: %', sql;
end $$;

-- A001 (empresa A) é o revendedor
reset role;
insert into auth.users(id, email) values ('00000000-0000-0000-0000-00000000a001', 'a@a') on conflict do nothing;
insert into public.revendedores(user_id, nome) values ('00000000-0000-0000-0000-00000000a001', 'Revenda');

-- Quem não é revendedor não usa as funções
select pg_temp.como('00000000-0000-0000-0000-00000000b001');
select pg_temp.espera_erro($q$select public.revenda_painel()$q$, 'Somente o revendedor');
select pg_temp.espera_erro($q$select public.revenda_criar_empresa('{"razao_social":"X"}', 'Fulano', 'x@x.com')$q$, 'Somente o revendedor');
-- O administrador B não altera a própria licença nem se reativa
update public.empresas set mensalidade = 1, plano = 'essencial', obs_revenda = 'hack' where id = public.auth_empresa_id();
reset role;
do $$ begin
  assert (select mensalidade from public.empresas where id = '00000000-0000-0000-0000-0000000000b1') = 0, 'mensalidade protegida';
  assert (select plano from public.empresas where id = '00000000-0000-0000-0000-0000000000b1') = 'completo', 'plano protegido';
end $$;

-- Revendedor cria empresa com convite
select pg_temp.como('00000000-0000-0000-0000-00000000a001');
create temp table nova(id uuid); grant all on nova to authenticated;
insert into nova select public.revenda_criar_empresa('{"razao_social":"Loja Nova Ltda","nome_fantasia":"Loja Nova","cnpj":"11.222.333/0001-81","uf":"pa","segmento":"vestuario","plano":"fiscal","mensalidade":149.9,"dia_vencimento":5,"cliente_desde":"2026-01-01","contato":{"nome":"Ana","telefone":"91999999999"}}', 'Ana Souza', 'Ana@Loja.com');
select pg_temp.espera_erro($q$select public.revenda_criar_empresa('{"razao_social":"Outra","cnpj":"11222333000181"}', 'B', 'b2@x.com')$q$, 'CNPJ');
select pg_temp.espera_erro($q$select public.revenda_criar_empresa('{"razao_social":"Outra"}', 'B', 'ana@loja.com')$q$, 'já está em uso');
reset role;
do $$ begin
  assert (select uf || segmento || plano || mensalidade from public.empresas where id = (select id from nova)) = 'PAvestuariofiscal149.90', 'dados da empresa';
  assert (select papel from public.convites where email = 'ana@loja.com') = 'administrador', 'convite';
  assert exists (select 1 from public.plano_contas where empresa_id = (select id from nova)), 'plano de contas criado';
end $$;
-- Login da Ana vincula à empresa
insert into auth.users(id, email) values ('00000000-0000-0000-0000-0000000000a9', 'ana@loja.com');
do $$ begin assert (select empresa_id from public.usuarios where id = '00000000-0000-0000-0000-0000000000a9') = (select id from nova), 'vinculada'; end $$;

-- Mensalidades: gera sem duplicar, paga e estorna
select pg_temp.como('00000000-0000-0000-0000-00000000a001');
do $$ begin
  assert public.revenda_gerar_mensalidades('2026-11-15') = 1, 'uma mensalidade (só a empresa com valor)';
  assert public.revenda_gerar_mensalidades('2026-11-01') = 0, 'não duplica';
  assert public.revenda_gerar_mensalidades('2026-10-01') = 1, 'mês anterior';
end $$;
do $$ declare p jsonb := public.revenda_painel(); c jsonb; begin
  select x into c from jsonb_array_elements(p->'clientes') x where x->>'razao_social' = 'Loja Nova Ltda';
  assert (c->>'vencidas')::int >= 1, 'outubro vencida';
  assert (c->>'convite_pendente') is null, 'convite já usado';
  assert (p->'totais'->>'receita_mensal')::numeric = 149.9, 'receita mensal';
  assert (p->'totais'->>'inadimplentes')::int = 1, 'inadimplente';
end $$;
create temp table mens(id uuid); grant all on mens to authenticated;
insert into mens select (x->>'id')::uuid from jsonb_array_elements(public.revenda_mensalidades((select id from nova))) x where x->>'competencia' = '2026-10-01';
select public.revenda_baixar_mensalidade((select id from mens), 'pagar', '2026-11-20', 'PIX');
select pg_temp.espera_erro(format($q$select public.revenda_baixar_mensalidade(%L, 'pagar')$q$, (select id from mens)), 'já está nessa situação');
select public.revenda_baixar_mensalidade((select id from mens), 'estornar');
select public.revenda_baixar_mensalidade((select id from mens), 'pagar', '2026-11-20', 'PIX');

-- A cliente vê as próprias mensalidades, não as dos outros, e não altera
select pg_temp.como('00000000-0000-0000-0000-0000000000a9');
do $$ begin assert (select count(*) from public.licenca_mensalidades) = 2, 'vê as suas'; end $$;
select pg_temp.espera_erro($q$update public.licenca_mensalidades set status = 'paga'$q$, 'permission denied');
do $$ begin assert (public.situacao_acesso()->>'suspensa')::boolean = false, 'ativa'; end $$;

-- Suspensão bloqueia o acesso; reativação devolve
select pg_temp.como('00000000-0000-0000-0000-00000000a001');
select pg_temp.espera_erro($q$select public.revenda_situacao_empresa('00000000-0000-0000-0000-0000000000a1', 'suspender', 'Teste de bloqueio')$q$, 'própria empresa');
select pg_temp.espera_erro(format($q$select public.revenda_situacao_empresa(%L, 'suspender', '')$q$, (select id from nova)), 'motivo');
select public.revenda_situacao_empresa((select id from nova), 'suspender', 'Mensalidade em atraso');
select pg_temp.como('00000000-0000-0000-0000-0000000000a9');
do $$ begin
  assert public.auth_empresa_id() is null, 'sem acesso';
  assert (select count(*) from public.empresas) = 0, 'não vê a empresa';
  assert (public.situacao_acesso()->>'suspensa')::boolean, 'situação suspensa';
  assert public.situacao_acesso()->>'motivo' = 'Mensalidade em atraso', 'motivo';
end $$;
reset role;
select pg_temp.espera_erro(format($q$select public.ler_credenciais_fiscais(%L)$q$, (select id from nova)), 'suspenso');
select pg_temp.espera_erro(format($q$select public.ler_credenciais_pix(%L)$q$, (select id from nova)), 'suspenso');
select pg_temp.como('00000000-0000-0000-0000-00000000a001');
select public.revenda_situacao_empresa((select id from nova), 'reativar');
select pg_temp.como('00000000-0000-0000-0000-0000000000a9');
do $$ begin assert public.auth_empresa_id() = (select id from nova), 'acesso de volta'; end $$;
-- Novo convite
select pg_temp.como('00000000-0000-0000-0000-00000000a001');
select public.revenda_convidar((select id from nova), 'Caixa 1', 'caixa@loja.com', 'operador');
select pg_temp.espera_erro(format($q$select public.revenda_convidar(%L, 'Ana', 'ana@loja.com')$q$, (select id from nova)), 'já tem acesso');
reset role;
-- Limpa para não afetar outros testes
update public.empresas set ativa = true, bloqueada_em = null where id = (select id from nova);
