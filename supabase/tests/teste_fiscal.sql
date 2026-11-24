-- Testes: regras de tributação, fotografia fiscal da venda, dados do SPED e tabela CMED.
\set ON_ERROR_STOP 1
set client_min_messages = warning;
create or replace function pg_temp.como(u text) returns void language plpgsql as $$
begin perform set_config('request.jwt.claim.sub', u, false); execute 'set role authenticated'; end $$;
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

-- 1) Regras: padrão + NCM de medicamentos (mais específica vence)
insert into public.regras_fiscais(nome, cfop, csosn, cst_pis, cst_cofins) values ('Padrão', '5102', '102', '99', '99');
insert into public.regras_fiscais(nome, ncm_prefixo, cfop, csosn, cst_pis, cst_cofins) values ('Medicamentos com ST', '3004', '5405', '500', '04', '04');
insert into public.produtos(id, descricao, ean, ncm, preco_venda, preco_custo) values
  ('00000000-0000-0000-0000-000000000ff1', 'Losartana 50 mg', '7896000000011', '30049099', 20, 8),
  ('00000000-0000-0000-0000-000000000ff2', 'Escova macia', '7896000000028', '96032100', 10, 4);
do $$ begin
  assert (select cfop || csosn from public.produtos where id = '00000000-0000-0000-0000-000000000ff1') = '5405500', 'medicamento pegou a regra do NCM';
  assert (select cfop || csosn from public.produtos where id = '00000000-0000-0000-0000-000000000ff2') = '5102102', 'escova pegou a padrão';
  assert (select cst_pis from public.produtos where id = '00000000-0000-0000-0000-000000000ff1') = '04', 'PIS monofásico';
end $$;
-- mudar o NCM reaplica a regra
update public.produtos set ncm = '30049099' where id = '00000000-0000-0000-0000-000000000ff2';
do $$ begin assert (select csosn from public.produtos where id = '00000000-0000-0000-0000-000000000ff2') = '500', 'reaplicou ao mudar NCM'; end $$;
update public.produtos set ncm = '96032100' where id = '00000000-0000-0000-0000-000000000ff2';

-- 2) Aplicar em massa: simula sem mudar, depois aplica
update public.regras_fiscais set csosn = '103' where nome = 'Padrão';
create temp table sim(r jsonb); grant all on sim to authenticated;
insert into sim select public.aplicar_regras_fiscais(true);
do $$ begin
  assert ((select r from sim)->>'alterados')::int >= 1, 'simulação conta';
  assert (select csosn from public.produtos where id = '00000000-0000-0000-0000-000000000ff2') = '102', 'simulação não altera';
end $$;
select public.aplicar_regras_fiscais(false);
do $$ begin assert (select csosn from public.produtos where id = '00000000-0000-0000-0000-000000000ff2') = '103', 'aplicou'; end $$;
reset role; select pg_temp.como('00000000-0000-0000-0000-00000000a002');
select pg_temp.espera_erro($q$select public.aplicar_regras_fiscais(false)$q$, 'Somente gerente');
select pg_temp.espera_erro($q$insert into public.regras_fiscais(nome, cfop) values ('x', '5102')$q$, 'row-level security');
reset role; select pg_temp.como('00000000-0000-0000-0000-00000000a001');

-- 3) Venda guarda a tributação do momento
select public.lancar_estoque('00000000-0000-0000-0000-000000000ff2', 'entrada', 5, null, 4);
reset role; select set_config('request.jwt.claim.sub', '', false);
insert into public.vendas(id, empresa_id, caixa_id, numero, subtotal, total, status, operador_id)
values ('00000000-0000-0000-0000-0000000005f1', '00000000-0000-0000-0000-0000000000a1',
        (select id from public.caixas where empresa_id = '00000000-0000-0000-0000-0000000000a1' limit 1), 99901, 10, 10, 'concluida', '00000000-0000-0000-0000-00000000a001');
insert into public.venda_itens(empresa_id, venda_id, produto_id, sequencia, descricao, quantidade, preco_unitario, desconto, total)
values ('00000000-0000-0000-0000-0000000000a1', '00000000-0000-0000-0000-0000000005f1', '00000000-0000-0000-0000-000000000ff2', 1, 'Escova', 1, 10, 0, 10);
update public.produtos set csosn = '102' where id = '00000000-0000-0000-0000-000000000ff2';
do $$ begin
  assert (select csosn || cfop || ncm from public.venda_itens where venda_id = '00000000-0000-0000-0000-0000000005f1') = '103510296032100', 'fotografia fiscal';
end $$;

-- 4) Entrada guarda os dados fiscais; SPED devolve notas, itens e inventário
select pg_temp.como('00000000-0000-0000-0000-00000000a001');
select public.registrar_entrada_nfe(jsonb_build_object(
  'chave', '15261199888777000166550010000077771000077771', 'numero', 7777, 'serie', 1, 'emissao', now()::text,
  'valor_produtos', 40, 'valor_total', 40, 'fiscal', jsonb_build_object('vBC', 40, 'vICMS', 4.8),
  'fornecedor', jsonb_build_object('cnpj', '99888777000166', 'razao_social', 'Fornecedor Fiscal Ltda', 'uf', 'PA', 'municipio_ibge', '1501402',
                                   'endereco', jsonb_build_object('logradouro', 'Rua A', 'numero', '1', 'bairro', 'Centro', 'cep', '66000000')),
  'itens', jsonb_build_array(jsonb_build_object('produto_id', '00000000-0000-0000-0000-000000000ff2', 'descricao', 'ESCOVA', 'quantidade', 10, 'custo_unitario', 4,
                                                'n_item', 1, 'fiscal', jsonb_build_object('cfop', '5102', 'cst', '000', 'vProd', 40, 'vBC', 40, 'pICMS', 12, 'vICMS', 4.8)))));
create temp table sp(r jsonb); grant all on sp to authenticated;
insert into sp select public.dados_sped(current_date - 1, current_date + 1, current_date);
do $$
declare r jsonb := (select r from sp); n jsonb;
begin
  select x into n from jsonb_array_elements(r->'notas') x where x->>'numero' = '7777';
  assert n is not null, 'nota no período';
  assert n->'fornecedor'->>'municipio_ibge' = '1501402', 'município do fornecedor';
  assert (n->'itens'->0->'fiscal'->>'vICMS')::numeric = 4.8, 'ICMS do item';
  assert n->'itens'->0->>'cod_item' is not null, 'código do item';
  assert exists (select 1 from jsonb_array_elements(r->'inventario') x where (x->>'quantidade')::numeric = 15), 'inventário na data';
  assert jsonb_array_length(r->'produtos') >= 1, 'itens do 0200';
end $$;

-- 5) CMED: importa, liga pelo código de barras, aponta preço acima do PMC e corrige
select public.importar_cmed('[{"ean":"7896000000011","produto":"LOSARTANA","registro":"1234567890123","pmc":18.5,"pf":13.2},{"ean":"abc","pmc":1}]', 'PMC 19%', true);
create temp table cf(r jsonb); grant all on cf to authenticated;
insert into cf select public.conferir_cmed();
do $$
declare r jsonb := (select r from cf);
begin
  assert (r->>'tabela')::int = 1, 'linha inválida ignorada';
  assert jsonb_array_length(r->'acima') = 1, 'losartana acima do PMC';
  assert (select pmc from public.produtos where id = '00000000-0000-0000-0000-000000000ff1') = 18.5, 'PMC ligado';
  assert (select registro_ms from public.produtos where id = '00000000-0000-0000-0000-000000000ff1') = '1234567890123', 'registro preenchido';
end $$;
select pg_temp.espera_erro($q$select public.aplicar_cmed('igualar', 120)$q$, 'Desconto inválido');
do $$ begin assert public.aplicar_cmed('limitar') = 1, 'limitou um'; end $$;
do $$ begin assert (select preco_venda from public.produtos where id = '00000000-0000-0000-0000-000000000ff1') = 18.5, 'preço no PMC'; end $$;
do $$ begin assert public.aplicar_cmed('igualar', 10) = 1, 'igualou'; end $$;
do $$ begin assert (select preco_venda from public.produtos where id = '00000000-0000-0000-0000-000000000ff1') = 16.65, 'PMC com 10% de desconto'; end $$;

-- 6) Isolamento
reset role; select pg_temp.como('00000000-0000-0000-0000-00000000b001');
do $$ begin
  assert (select count(*) from public.regras_fiscais) = 0, 'B não vê regras de A';
  assert (select count(*) from public.cmed_precos) = 0, 'B não vê CMED de A';
end $$;
reset role;
select 'TESTES FISCAIS PASSARAM' as ok;
