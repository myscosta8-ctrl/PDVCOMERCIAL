-- Impressão (bobina 58/80 mm, comprovante não fiscal) e alertas de vencimento

alter table public.empresas
  add column if not exists impressao jsonb not null
    default '{"largura": 80, "automatica": true, "comprovante": true, "vias_crediario": 2, "mensagem": ""}'::jsonb,
  add column if not exists alertas jsonb not null
    default '{"dias_pagar": 5, "dias_validade": 60, "dias_certificado": 30}'::jsonb;

-- Alertas de vencimento. Roda com as permissões de quem chama (RLS):
-- o operador não enxerga o financeiro, então só recebe o que pode ver.
create or replace function public.alertas_vencimento()
returns jsonb language plpgsql stable security invoker set search_path = public as $$
declare
  v_emp uuid := public.auth_empresa_id();
  v_hoje date := (now() at time zone 'America/Sao_Paulo')::date;
  c jsonb;
  v_dp int; v_dv int; v_dc int;
  v_cert timestamptz;
  r jsonb := '{}'::jsonb;
begin
  if v_emp is null then return r; end if;
  select coalesce(alertas, '{}'::jsonb), certificado_validade into c, v_cert from public.empresas where id = v_emp;
  v_dp := greatest(0, least(60, coalesce((c->>'dias_pagar')::int, 5)));
  v_dv := greatest(0, least(365, coalesce((c->>'dias_validade')::int, 60)));
  v_dc := greatest(0, least(120, coalesce((c->>'dias_certificado')::int, 30)));

  r := r || jsonb_build_object('dias', jsonb_build_object('pagar', v_dp, 'validade', v_dv, 'certificado', v_dc));

  -- Contas a pagar vencidas e a vencer
  r := r || jsonb_build_object('pagar_vencidas', (
    select jsonb_build_object('qtd', count(*), 'valor', coalesce(sum(valor - valor_pago), 0),
      'lista', coalesce(jsonb_agg(jsonb_build_object('id', id, 'descricao', descricao, 'vencimento', vencimento, 'valor', valor - valor_pago) order by vencimento) filter (where rn <= 8), '[]'::jsonb))
      from (select l.*, row_number() over (order by vencimento) rn from public.lancamentos l
             where l.empresa_id = v_emp and l.tipo = 'pagar' and l.status = 'aberto' and l.vencimento < v_hoje) x));
  r := r || jsonb_build_object('pagar_vencendo', (
    select jsonb_build_object('qtd', count(*), 'valor', coalesce(sum(valor - valor_pago), 0),
      'lista', coalesce(jsonb_agg(jsonb_build_object('id', id, 'descricao', descricao, 'vencimento', vencimento, 'valor', valor - valor_pago) order by vencimento) filter (where rn <= 8), '[]'::jsonb))
      from (select l.*, row_number() over (order by vencimento) rn from public.lancamentos l
             where l.empresa_id = v_emp and l.tipo = 'pagar' and l.status = 'aberto' and l.vencimento between v_hoje and v_hoje + v_dp) x));

  -- A receber em atraso: lançamentos do financeiro + parcelas de crediário e convênio
  r := r || jsonb_build_object('receber_atrasadas', (
    select jsonb_build_object('qtd', count(*), 'valor', coalesce(sum(saldo), 0),
      'lista', coalesce(jsonb_agg(jsonb_build_object('id', id, 'descricao', descricao, 'vencimento', vencimento, 'valor', saldo, 'origem', origem) order by vencimento) filter (where rn <= 8), '[]'::jsonb))
      from (select y.*, row_number() over (order by vencimento) rn from (
              select l.id, l.descricao, l.vencimento, l.valor - l.valor_pago saldo, 'financeiro' origem
                from public.lancamentos l
               where l.empresa_id = v_emp and l.tipo = 'receber' and l.status = 'aberto' and l.vencimento < v_hoje
              union all
              select cr.id, cl.nome || ' (' || cr.origem || ' ' || cr.parcela || '/' || cr.parcelas || ')', cr.vencimento, cr.valor - cr.valor_pago, cr.origem
                from public.contas_receber cr join public.clientes cl on cl.id = cr.cliente_id
               where cr.empresa_id = v_emp and cr.status = 'aberta' and cr.vencimento < v_hoje) y) x));

  -- Lotes com saldo: vencidos e a vencer
  r := r || jsonb_build_object('lotes_vencidos', (
    select jsonb_build_object('qtd', count(*),
      'lista', coalesce(jsonb_agg(jsonb_build_object('id', id, 'descricao', descricao, 'numero', numero, 'vencimento', validade, 'quantidade', quantidade, 'unidade', unidade) order by validade) filter (where rn <= 8), '[]'::jsonb))
      from (select l.id, l.numero, l.validade, l.quantidade, p.descricao, p.unidade, row_number() over (order by l.validade) rn
              from public.lotes l join public.produtos p on p.id = l.produto_id
             where l.empresa_id = v_emp and l.quantidade > 0 and l.validade < v_hoje) x));
  r := r || jsonb_build_object('lotes_vencendo', (
    select jsonb_build_object('qtd', count(*),
      'lista', coalesce(jsonb_agg(jsonb_build_object('id', id, 'descricao', descricao, 'numero', numero, 'vencimento', validade, 'quantidade', quantidade, 'unidade', unidade) order by validade) filter (where rn <= 8), '[]'::jsonb))
      from (select l.id, l.numero, l.validade, l.quantidade, p.descricao, p.unidade, row_number() over (order by l.validade) rn
              from public.lotes l join public.produtos p on p.id = l.produto_id
             where l.empresa_id = v_emp and l.quantidade > 0 and l.validade between v_hoje and v_hoje + v_dv) x));

  -- Certificado digital: só para o administrador
  if public.auth_papel() = 'administrador' and v_cert is not null
     and (v_cert at time zone 'America/Sao_Paulo')::date <= v_hoje + v_dc then
    r := r || jsonb_build_object('certificado', jsonb_build_object(
      'validade', v_cert, 'dias', (v_cert at time zone 'America/Sao_Paulo')::date - v_hoje));
  end if;

  return r;
end $$;

grant execute on function public.alertas_vencimento() to authenticated;
revoke execute on function public.alertas_vencimento() from anon, public;
