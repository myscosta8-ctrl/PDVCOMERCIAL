-- Testes: notas recebidas (distribuição de documentos) e tabela de ICMS por UF
\set ON_ERROR_STOP 1
set client_min_messages = warning;
create or replace function pg_temp.como(u text) returns void language plpgsql as $$
begin reset role; perform set_config('request.jwt.claim.sub', u, false); execute 'set role authenticated'; end $$;
create or replace function pg_temp.espera_erro(sql text, trecho text) returns void language plpgsql as $$
begin
  begin execute sql;
  exception when others then
    if position(trecho in sqlerrm) = 0 then raise exception 'Erro inesperado: % (esperado: %)', sqlerrm, trecho; end if;
    return;
  end;
  raise exception 'Deveria ter falhado: %', sql;
end $$;

reset role;
insert into public.nfe_recebidas(empresa_id, chave, nome_emitente, valor) values
  ('00000000-0000-0000-0000-0000000000a1', '15261199888777000166550010000077771000077771', 'Fornecedor A', 100),
  ('00000000-0000-0000-0000-0000000000b1', '15261199888777000166550010000077781000077781', 'Fornecedor B', 200);

-- Gestor vê só as da própria empresa
select pg_temp.como('00000000-0000-0000-0000-00000000a001');
do $$ begin
  if (select count(*) from public.nfe_recebidas) <> 1 then raise exception 'Isolamento entre empresas falhou'; end if;
end $$;
-- Ninguém grava pelo navegador (só a função fiscal)
select pg_temp.espera_erro($q$insert into public.nfe_recebidas(empresa_id, chave) values ('00000000-0000-0000-0000-0000000000a1', '15261199888777000166550010000077791000077791')$q$, 'row-level security');
update public.nfe_recebidas set manifestacao = 'confirmada';
do $$ begin
  if exists (select 1 from public.nfe_recebidas where manifestacao is not null) then raise exception 'Atualização deveria ser ignorada'; end if;
end $$;
-- Operador não vê
select pg_temp.como('00000000-0000-0000-0000-00000000a002');
do $$ begin
  if (select count(*) from public.nfe_recebidas) <> 0 then raise exception 'Operador não deveria ver notas recebidas'; end if;
end $$;

-- Ajustes de ICMS por UF ficam na empresa
select pg_temp.como('00000000-0000-0000-0000-00000000a001');
update public.empresas set aliquotas_uf = '{"AM": {"interna": 20, "fcp": 2, "base_dupla": true}}' where id = '00000000-0000-0000-0000-0000000000a1';
reset role;
do $$ begin
  if (select aliquotas_uf->'AM'->>'fcp' from public.empresas where id = '00000000-0000-0000-0000-0000000000a1') <> '2' then raise exception 'aliquotas_uf não gravou'; end if;
  if (select dfe_ult_nsu from public.empresas where id = '00000000-0000-0000-0000-0000000000a1') <> '000000000000000' then raise exception 'NSU inicial errado'; end if;
end $$;
