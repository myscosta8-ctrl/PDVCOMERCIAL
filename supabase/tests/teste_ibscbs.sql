-- Testes: IBS/CBS nas regras fiscais e no produto
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
insert into public.regras_fiscais(nome, ncm_prefixo, cfop, csosn, cst_ibscbs, cclasstrib, reducao_ibscbs, prioridade)
values ('Medicamentos IBS/CBS', '300490', '5102', '102', '200', '200014', 60, 1);
select pg_temp.espera_erro($q$insert into public.regras_fiscais(nome, cfop, cst_ibscbs, cclasstrib) values ('x', '5102', '200', '000001')$q$, 'regras_fiscais_ibscbs_check');
select pg_temp.espera_erro($q$insert into public.regras_fiscais(nome, cfop, cst_ibscbs) values ('x', '5102', '20')$q$, 'regras_fiscais_ibscbs_check');

-- Produto novo recebe a classificação da regra
insert into public.produtos(id, descricao, ncm, preco_venda) values ('00000000-0000-0000-0000-00000000ab01', 'Remédio IBS', '30049099', 10);
do $$ declare p record; begin
  select cst_ibscbs, cclasstrib, reducao_ibscbs into p from public.produtos where id = '00000000-0000-0000-0000-00000000ab01';
  if p.cst_ibscbs <> '200' or p.cclasstrib <> '200014' or p.reducao_ibscbs <> 60 then raise exception 'Produto não recebeu IBS/CBS da regra: %', p; end if;
end $$;

-- Aplicar ao cadastro leva a mudança de classificação
update public.regras_fiscais set reducao_ibscbs = 30 where nome = 'Medicamentos IBS/CBS';
select public.aplicar_regras_fiscais(false);
do $$ begin
  if (select reducao_ibscbs from public.produtos where id = '00000000-0000-0000-0000-00000000ab01') <> 30 then raise exception 'Aplicar regras não levou a redução'; end if;
end $$;
