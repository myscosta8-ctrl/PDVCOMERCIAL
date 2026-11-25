-- IBS e CBS (reforma tributária): classificação por produto, redução de alíquota e alíquotas por ano

alter table public.produtos
  add column if not exists cst_ibscbs     text check (cst_ibscbs is null or cst_ibscbs ~ '^\d{3}$'),
  add column if not exists cclasstrib     text check (cclasstrib is null or cclasstrib ~ '^\d{6}$'),
  add column if not exists reducao_ibscbs numeric(5,2) not null default 0 check (reducao_ibscbs between 0 and 100);

alter table public.regras_fiscais
  add column if not exists reducao_ibscbs numeric(5,2) not null default 0 check (reducao_ibscbs between 0 and 100);
alter table public.regras_fiscais drop constraint if exists regras_fiscais_ibscbs_check;
alter table public.regras_fiscais add constraint regras_fiscais_ibscbs_check check (
  (cst_ibscbs is null or cst_ibscbs ~ '^\d{3}$') and (cclasstrib is null or (cclasstrib ~ '^\d{6}$' and left(cclasstrib, 3) = coalesce(cst_ibscbs, left(cclasstrib, 3)))));

-- {"2027": {"uf": 0.05, "mun": 0.05, "cbs": 8.7}}: alíquotas dos anos seguintes, quando publicadas (2026 já vem no sistema)
alter table public.empresas add column if not exists ibscbs_aliquotas jsonb not null default '{}'::jsonb;

-- As regras fiscais passam a levar também o IBS/CBS para o produto
-- Produto novo ou com NCM/origem alterados recebe a tributação da regra
create or replace function public.tributar_produto()
returns trigger language plpgsql security definer set search_path = public as $$
declare r public.regras_fiscais;
begin
  if tg_op = 'UPDATE' and new.ncm is not distinct from old.ncm and new.origem is not distinct from old.origem then return new; end if;
  r := public.regra_do_produto(new.empresa_id, new.ncm, new.origem);
  if r.id is null then return new; end if;
  new.cfop := r.cfop; new.csosn := r.csosn; new.cst_icms := r.cst_icms; new.aliquota_icms := r.aliquota_icms;
  new.reducao_bc := r.reducao_bc; new.cbenef := r.cbenef; new.cst_pis := r.cst_pis; new.aliquota_pis := r.aliquota_pis;
  new.cst_cofins := r.cst_cofins; new.aliquota_cofins := r.aliquota_cofins; new.regra_fiscal_id := r.id;
  new.cst_ibscbs := r.cst_ibscbs; new.cclasstrib := r.cclasstrib; new.reducao_ibscbs := r.reducao_ibscbs;
  return new;
end $$;
revoke execute on function public.tributar_produto() from public, anon, authenticated;
drop trigger if exists produtos_tributar on public.produtos;
create trigger produtos_tributar before insert or update of ncm, origem on public.produtos for each row execute function public.tributar_produto();

-- Aplica as regras ao cadastro inteiro (ou só simula)
create or replace function public.aplicar_regras_fiscais(p_simular boolean default true)
returns jsonb language plpgsql security definer set search_path = public as $$
declare v_emp uuid := public.auth_empresa_id(); n int; amostra jsonb; sem_regra int;
begin
  if public.auth_papel() not in ('administrador','gerente') then raise exception 'Somente gerente ou administrador'; end if;
  create temp table if not exists _trib on commit drop as select * from public.regras_fiscais limit 0;
  alter table _trib add column if not exists produto_id uuid;
  truncate _trib;
  insert into _trib
  select (x.r).*, p.id from public.produtos p
   cross join lateral (select public.regra_do_produto(v_emp, p.ncm, p.origem) r) x
   where p.empresa_id = v_emp and (x.r).id is not null
     and (p.cfop, p.csosn, p.cst_icms, p.aliquota_icms, p.reducao_bc, p.cbenef, p.cst_pis, p.aliquota_pis, p.cst_cofins, p.aliquota_cofins, p.regra_fiscal_id, p.cst_ibscbs, p.cclasstrib, p.reducao_ibscbs)
         is distinct from ((x.r).cfop, (x.r).csosn, (x.r).cst_icms, (x.r).aliquota_icms, (x.r).reducao_bc, (x.r).cbenef, (x.r).cst_pis,
                           (x.r).aliquota_pis, (x.r).cst_cofins, (x.r).aliquota_cofins, (x.r).id, (x.r).cst_ibscbs, (x.r).cclasstrib, (x.r).reducao_ibscbs);
  select count(*) into n from _trib;
  select count(*) into sem_regra from public.produtos p
   where p.empresa_id = v_emp and p.ativo and public.regra_do_produto(v_emp, p.ncm, p.origem) is null;
  select coalesce(jsonb_agg(x), '[]') into amostra from (
    select p.descricao, p.ncm, t.nome regra,
           jsonb_build_object('cfop', p.cfop, 'csosn', p.csosn, 'cst', p.cst_icms, 'aliquota', p.aliquota_icms) antes,
           jsonb_build_object('cfop', t.cfop, 'csosn', t.csosn, 'cst', t.cst_icms, 'aliquota', t.aliquota_icms) depois
      from _trib t join public.produtos p on p.id = t.produto_id order by p.descricao limit 50) x;
  if not p_simular then
    update public.produtos p set cfop = t.cfop, csosn = t.csosn, cst_icms = t.cst_icms, aliquota_icms = t.aliquota_icms,
           reducao_bc = t.reducao_bc, cbenef = t.cbenef, cst_pis = t.cst_pis, aliquota_pis = t.aliquota_pis,
           cst_cofins = t.cst_cofins, aliquota_cofins = t.aliquota_cofins, regra_fiscal_id = t.id,
           cst_ibscbs = t.cst_ibscbs, cclasstrib = t.cclasstrib, reducao_ibscbs = t.reducao_ibscbs, atualizado_em = now()
      from _trib t where p.id = t.produto_id;
    insert into public.auditoria(empresa_id, acao, entidade, detalhes)
    values (v_emp, 'aplicar_regras_fiscais', 'produto', jsonb_build_object('produtos', n));
  end if;
  return jsonb_build_object('alterados', n, 'sem_regra', sem_regra, 'amostra', amostra);
end $$;
