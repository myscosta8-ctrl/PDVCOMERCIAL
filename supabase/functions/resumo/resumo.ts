// Resumo do mês: texto por regras fixas (sempre disponível) e pedido para a IA (quando houver chave).

export interface Indicadores {
  mes: string; dia: number; dias_mes: number;
  vendas: { total: number; qtd: number; descontos: number; canceladas: number; dias_com_venda: number };
  anterior: { total: number; qtd: number };
  margem: number; faturamento_com_custo: number;
  mais_vendidos: { descricao: string; quantidade: number; total: number }[];
  formas: Record<string, number>;
  crediario_atrasado: number; estoque_baixo: number; lotes_vencendo: number; lotes_vencidos: number;
  financeiro: { pagos_mes: number; compras_mes: number; a_vencer_mes: number; a_receber_total: number; teto_gastos: number | null };
}

const NOMES: Record<string, string> = { dinheiro: "dinheiro", pix: "PIX", debito: "cartão de débito", credito: "cartão de crédito", crediario: "crediário", convenio: "convênio", vale: "vale-troca", outro: "outras formas" };
export const real = (v: number) => "R$ " + Number(v || 0).toFixed(2).replace(".", ",").replace(/\B(?=(\d{3})+(?!\d))/g, ".");
const pct = (v: number) => `${Math.round(v)}%`;
const int = (v: number) => String(Math.round(Number(v || 0))).replace(/\B(?=(\d{3})+(?!\d))/g, ".");

export function textoPorRegras(i: Indicadores): string[] {
  const n = (v: unknown) => Number(v || 0);
  const v = i.vendas, p: string[] = [];
  if (!n(v.qtd)) return ["Ainda não há vendas concluídas neste mês. O resumo aparece a partir da primeira venda."];
  const ticket = n(v.total) / n(v.qtd);
  const projecao = v.dias_com_venda ? n(v.total) / i.dia * i.dias_mes : 0;
  let comp = "";
  if (n(i.anterior.total) > 0) {
    const d = (n(v.total) - n(i.anterior.total)) / n(i.anterior.total) * 100;
    comp = ` Isso é ${pct(Math.abs(d))} ${d >= 0 ? "acima" : "abaixo"} do mesmo período do mês passado (${real(i.anterior.total)}).`;
  }
  p.push(`Até o dia ${i.dia}, o mês soma ${real(v.total)} em ${int(v.qtd)} vendas, com ticket médio de ${real(ticket)}.${comp}` +
    (projecao > 0 ? ` No ritmo atual, o mês deve fechar perto de ${real(projecao)}.` : ""));
  const extras: string[] = [];
  if (n(i.faturamento_com_custo) > 0) extras.push(`a margem bruta dos produtos com custo cadastrado está em ${pct(n(i.margem) / n(i.faturamento_com_custo) * 100)}`);
  if (n(v.descontos) > 0) extras.push(`os descontos somam ${real(v.descontos)} (${pct(n(v.descontos) / (n(v.total) + n(v.descontos)) * 100)} do valor bruto)`);
  if (n(v.canceladas) > 0) extras.push(`${v.canceladas} venda(s) foram canceladas`);
  const formas = Object.entries(i.formas || {}).sort((a, b) => n(b[1]) - n(a[1]));
  if (formas.length) extras.push(`a forma de pagamento mais usada é ${NOMES[formas[0][0]] ?? formas[0][0]} (${pct(n(formas[0][1]) / n(v.total) * 100)} do recebido)`);
  if (extras.length) p.push(extras[0][0].toUpperCase() + extras.join("; ").slice(1) + ".");
  if (i.mais_vendidos?.length) p.push(`Mais vendidos: ${i.mais_vendidos.slice(0, 3).map((m) => `${m.descricao} (${real(m.total)})`).join(", ")}.`);
  const f = i.financeiro ?? {} as Indicadores["financeiro"];
  const fin: string[] = [];
  if (n(f.pagos_mes) > 0) fin.push(`despesas pagas: ${real(f.pagos_mes)}` + (n(f.teto_gastos) > 0 ? ` de um teto de ${real(f.teto_gastos!)}` : ""));
  if (n(f.compras_mes) > 0) fin.push(`compras de mercadoria pagas: ${real(f.compras_mes)}`);
  if (n(f.a_vencer_mes) > 0) fin.push(`ainda vencem neste mês ${real(f.a_vencer_mes)} em contas a pagar`);
  if (fin.length) p.push(fin[0][0].toUpperCase() + fin.join("; ").slice(1) + ".");
  const atencao: string[] = [];
  if (n(i.crediario_atrasado) > 0) atencao.push(`${real(i.crediario_atrasado)} de crediário em atraso`);
  if (n(i.lotes_vencidos) > 0) atencao.push(`${i.lotes_vencidos} lote(s) vencido(s) com saldo`);
  if (n(i.lotes_vencendo) > 0) atencao.push(`${i.lotes_vencendo} lote(s) vencendo em 30 dias`);
  if (n(i.estoque_baixo) > 0) atencao.push(`${i.estoque_baixo} produto(s) no estoque mínimo`);
  if (n(f.teto_gastos) > 0 && n(f.pagos_mes) > n(f.teto_gastos)) atencao.push("as despesas já passaram do teto definido");
  if (atencao.length) p.push(`Atenção: ${atencao.join("; ")}.`);
  return p;
}

export function pedidoIA(i: Indicadores) {
  return {
    system: "Você é um consultor de varejo que escreve para o dono de uma loja pequena no Brasil. Escreva em português do Brasil, com acentuação correta, " +
      "em até 4 parágrafos curtos e sem títulos, listas ou markdown. Use somente os números fornecidos, em reais no formato R$ 1.234,56. " +
      "Comece pelo desempenho de vendas comparado ao mesmo período do mês anterior, depois margem e despesas, e termine com até 3 ações práticas para os próximos dias. " +
      "Não invente dados que não estejam nos indicadores.",
    mensagem: `Indicadores do mês ${i.mes} (até o dia ${i.dia} de ${i.dias_mes}):\n${JSON.stringify(i)}`,
  };
}
