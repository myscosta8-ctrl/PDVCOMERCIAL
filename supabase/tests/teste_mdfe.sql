-- Testes: MDF-e (rascunho pelo navegador, emissão só pelo servidor)
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

select pg_temp.como('00000000-0000-0000-0000-00000000a001');
insert into public.mdfe_documentos(id, uf_inicio, uf_fim, veiculo) values ('00000000-0000-0000-0000-0000000000f9', 'PA', 'AM', '{"placa":"ABC1D23"}');
select pg_temp.espera_erro($q$insert into public.mdfe_documentos(uf_inicio, status) values ('PA', 'autorizada')$q$, 'row-level security');
update public.mdfe_documentos set peso_carga = 100 where id = '00000000-0000-0000-0000-0000000000f9';
-- Depois de autorizado, o navegador não altera nem apaga
reset role;
grant delete on public.mdfe_documentos to authenticated;  -- no Supabase o papel já tem
update public.mdfe_documentos set status = 'autorizada', numero = 1, ambiente = 2, serie = 1 where id = '00000000-0000-0000-0000-0000000000f9';
select pg_temp.como('00000000-0000-0000-0000-00000000a001');
update public.mdfe_documentos set peso_carga = 1 where id = '00000000-0000-0000-0000-0000000000f9';
delete from public.mdfe_documentos where id = '00000000-0000-0000-0000-0000000000f9';
do $$ begin
  if (select peso_carga from public.mdfe_documentos where id = '00000000-0000-0000-0000-0000000000f9') <> 100 then raise exception 'MDF-e autorizado foi alterado'; end if;
end $$;
-- Operador não vê e outra empresa não vê
select pg_temp.como('00000000-0000-0000-0000-00000000a002');
do $$ begin if (select count(*) from public.mdfe_documentos) <> 0 then raise exception 'Operador vê MDF-e'; end if; end $$;
select pg_temp.como('00000000-0000-0000-0000-00000000b001');
do $$ begin if (select count(*) from public.mdfe_documentos) <> 0 then raise exception 'Outra empresa vê MDF-e'; end if; end $$;
