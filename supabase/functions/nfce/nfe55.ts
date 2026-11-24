// NF-e modelo 55 (layout 4.00): venda a empresas e pessoas, devolução ao fornecedor e outras saídas.
// Reaproveita a montagem dos itens da NFC-e; gerada já na forma canônica.
import {
  UF_CODIGO, TEXTO_HOMOLOGACAO_NFE, T_PAG, type Emitente, type ItemNota,
  txt, so, n2, n4, tag, arred, digitoChave, dataHoraBrasilia, montarItens,
} from "./xml.ts";

export interface Destinatario {
  documento: string;            // CPF ou CNPJ
  nome: string;
  ie?: string | null;
  indIEDest: 1 | 2 | 9;         // 1 contribuinte, 2 isento, 9 não contribuinte
  email?: string | null;
  endereco: { logradouro: string; numero?: string; complemento?: string; bairro: string; municipio: string; municipio_ibge: string; uf: string; cep: string; fone?: string };
}

export interface DadosNFe {
  emitente: Emitente; ambiente: 1 | 2; serie: number; numero: number; codigo_numerico: string; emissao: Date;
  natureza: string;
  finalidade: 1 | 2 | 3 | 4;    // 1 normal, 4 devolução
  presenca: 0 | 1 | 2 | 3 | 9;  // 0 não se aplica, 1 presencial, 2 internet, 3 telefone, 9 outros
  consumidorFinal: boolean;
  destinatario: Destinatario;
  itens: ItemNota[];
  frete: { modalidade: 0 | 1 | 2 | 9; volumes?: { quantidade?: number; especie?: string; pesoLiquido?: number; pesoBruto?: number } | null };
  pagamentos: { forma: string; valor: number }[];   // vazio = sem pagamento (devolução)
  referencias?: string[];       // chaves de NF-e referenciadas (devolução)
  informacoes?: string | null;
  respTecnico?: { cnpj: string; contato: string; email: string; fone: string } | null;
  aliquotasUF?: Record<string, Partial<AliquotaUF>> | null;   // ajustes da empresa sobre a tabela padrão (DIFAL)
}

// ---------------------------------------------------------------- DIFAL (EC 87/2015, LC 190/2022)
export interface AliquotaUF { interna: number; fcp: number; base_dupla: boolean }

// Alíquota interna geral (modal) de cada UF em novembro/2026. O FCP só incide sobre produtos listados
// em lei estadual: fica zerado, exceto no RJ (adicional geral de 2%). A empresa ajusta na configuração.
export const ALIQUOTAS_UF_PADRAO: Record<string, AliquotaUF> = Object.fromEntries(Object.entries({
  AC: 19, AL: 20.5, AM: 20, AP: 18, BA: 20.5, CE: 20, DF: 20, ES: 17, GO: 19, MA: 23, MG: 18, MS: 17, MT: 17, PA: 19,
  PB: 20, PE: 20.5, PI: 22.5, PR: 19.5, RJ: 20, RN: 20, RO: 19.5, RR: 20, RS: 17, SC: 17, SE: 19, SP: 18, TO: 20,
}).map(([uf, interna]) => [uf, { interna, fcp: uf === "RJ" ? 2 : 0, base_dupla: false }]));

const SUL_SUDESTE_SEM_ES = new Set(["PR", "SC", "RS", "SP", "RJ", "MG"]);

// 4% para importados (origem 1, 2, 3 ou 8); 7% de Sul/Sudeste (exceto ES) para N, NE, CO e ES; 12% nos demais casos
export function aliquotaInterestadual(ufOrigem: string, ufDestino: string, origemMercadoria: number) {
  if ([1, 2, 3, 8].includes(Number(origemMercadoria))) return 4;
  if (SUL_SUDESTE_SEM_ES.has(ufOrigem) && !SUL_SUDESTE_SEM_ES.has(ufDestino)) return 7;
  return 12;
}

// Base única: diferença de alíquotas sobre o valor da operação.
// Base dupla: o valor sem o ICMS de origem é "por dentro" da alíquota do destino (interna + FCP).
export function calcularDifal(base: number, pInter: number, uf: AliquotaUF) {
  const icmsOrigem = arred(base * pInter / 100);
  const vBC = uf.base_dupla ? arred((base - icmsOrigem) / (1 - (uf.interna + uf.fcp) / 100)) : base;
  const vICMSUFDest = Math.max(0, arred(vBC * uf.interna / 100 - (uf.base_dupla ? icmsOrigem : vBC * pInter / 100)));
  const vFCPUFDest = arred(vBC * uf.fcp / 100);
  return { vBC, vICMSUFDest, vFCPUFDest };
}

export function montarChave55(d: Pick<DadosNFe, "emitente" | "emissao" | "serie" | "numero" | "codigo_numerico">) {
  const cUF = UF_CODIGO[d.emitente.uf];
  if (!cUF) throw new Error("UF do emitente inválida");
  const aamm = dataHoraBrasilia(d.emissao).slice(2, 7).replace("-", "");
  const base = cUF + aamm + so(d.emitente.cnpj).padStart(14, "0") + "55" +
    String(d.serie).padStart(3, "0") + String(d.numero).padStart(9, "0") + "1" + d.codigo_numerico.padStart(8, "0");
  if (base.length !== 43) throw new Error("Chave de acesso com tamanho inválido");
  const dv = digitoChave(base);
  return { chave: base + dv, dv, cUF };
}

// CFOP de saída conforme o destino: dentro do estado (5xxx) ou para outro estado (6xxx)
export function cfopPorDestino(cfop: string, interestadual: boolean) {
  const c = so(cfop);
  if (c.length !== 4) return c;
  if (interestadual && c[0] === "5") return "6" + c.slice(1);
  if (!interestadual && c[0] === "6") return "5" + c.slice(1);
  return c;
}

export function montarInfNFe55(d: DadosNFe) {
  const { chave, dv, cUF } = montarChave55(d);
  const e = d.emitente;
  const dest = d.destinatario;
  const homolog = d.ambiente === 2;
  const interestadual = dest.endereco.uf !== e.uf;
  if (!UF_CODIGO[dest.endereco.uf]) throw new Error("UF do destinatário inválida.");
  if (so(dest.endereco.municipio_ibge).length !== 7) throw new Error("Informe o código IBGE do município do destinatário (7 dígitos).");
  if (![11, 14].includes(so(dest.documento).length)) throw new Error("CPF ou CNPJ do destinatário inválido.");
  if (dest.indIEDest === 1 && !so(dest.ie)) throw new Error("Destinatário contribuinte precisa da inscrição estadual.");
  // DIFAL: operação interestadual com consumidor final não contribuinte. O Simples Nacional (CRT 1) e o MEI
  // (CRT 4) não recolhem o DIFAL nessa operação e não informam o grupo ICMSUFDest.
  const difal = interestadual && d.consumidorFinal && dest.indIEDest === 9 && [1, 4].includes(d.finalidade) && (e.crt === 2 || e.crt === 3);
  const ufDestino: AliquotaUF | null = difal
    ? { ...(ALIQUOTAS_UF_PADRAO[dest.endereco.uf] ?? { interna: 0, fcp: 0, base_dupla: false }), ...(d.aliquotasUF?.[dest.endereco.uf] ?? {}) } as AliquotaUF
    : null;
  if (ufDestino && !(ufDestino.interna > 0)) throw new Error(`Informe a alíquota interna de ICMS da UF ${dest.endereco.uf} na configuração fiscal.`);
  if (d.finalidade === 4 && !d.referencias?.length) throw new Error("Na devolução, informe a chave da nota que está sendo devolvida.");

  const ide =
    tag("cUF", cUF) + tag("cNF", d.codigo_numerico.padStart(8, "0")) + tag("natOp", txt(d.natureza, 60)) +
    tag("mod", "55") + tag("serie", String(d.serie)) + tag("nNF", String(d.numero)) +
    tag("dhEmi", dataHoraBrasilia(d.emissao)) + tag("dhSaiEnt", dataHoraBrasilia(d.emissao)) + tag("tpNF", "1") +
    tag("idDest", interestadual ? "2" : "1") + tag("cMunFG", so(e.municipio_ibge)) + tag("tpImp", "1") + tag("tpEmis", "1") +
    tag("cDV", String(dv)) + tag("tpAmb", String(d.ambiente)) + tag("finNFe", String(d.finalidade)) +
    tag("indFinal", d.consumidorFinal ? "1" : "0") + tag("indPres", String(d.presenca)) +
    ([2, 3, 4, 9].includes(d.presenca) ? tag("indIntermed", "0") : "") +
    tag("procEmi", "0") + tag("verProc", "PDV Comercial 1.0") +
    (d.referencias ?? []).map((r) => tag("NFref", tag("refNFe", so(r)))).join("");

  const fone = so(e.endereco.fone);
  const emit =
    tag("CNPJ", so(e.cnpj)) + tag("xNome", txt(e.razao_social, 60)) +
    (e.nome_fantasia ? tag("xFant", txt(e.nome_fantasia, 60)) : "") +
    tag("enderEmit",
      tag("xLgr", txt(e.endereco.logradouro, 60)) + tag("nro", txt(e.endereco.numero || "SN", 60)) +
      tag("xBairro", txt(e.endereco.bairro, 60)) + tag("cMun", so(e.municipio_ibge)) +
      tag("xMun", txt(e.endereco.municipio, 60)) + tag("UF", e.uf) + tag("CEP", so(e.endereco.cep)) +
      tag("cPais", "1058") + tag("xPais", "BRASIL") + (fone.length >= 6 ? tag("fone", fone) : "")) +
    tag("IE", so(e.ie)) + tag("CRT", String(e.crt));

  const doc = so(dest.documento);
  const de = dest.endereco;
  const foneDest = so(de.fone);
  const destXml = tag("dest",
    tag(doc.length === 11 ? "CPF" : "CNPJ", doc) +
    tag("xNome", homolog ? TEXTO_HOMOLOGACAO_NFE : txt(dest.nome, 60)) +
    tag("enderDest",
      tag("xLgr", txt(de.logradouro, 60)) + tag("nro", txt(de.numero || "SN", 60)) +
      (de.complemento ? tag("xCpl", txt(de.complemento, 60)) : "") +
      tag("xBairro", txt(de.bairro, 60)) + tag("cMun", so(de.municipio_ibge)) + tag("xMun", txt(de.municipio, 60)) +
      tag("UF", de.uf) + tag("CEP", so(de.cep)) + tag("cPais", "1058") + tag("xPais", "BRASIL") +
      (foneDest.length >= 6 ? tag("fone", foneDest) : "")) +
    tag("indIEDest", String(dest.indIEDest)) +
    (dest.indIEDest === 1 ? tag("IE", so(dest.ie)) : "") +
    (dest.email ? tag("email", txt(dest.email, 60)) : ""));

  // Na saída para outro estado, o ICMS próprio (CST 00/20) usa a alíquota interestadual
  const itens = d.itens.map((i) => ({
    ...i, cfop: cfopPorDestino(i.cfop, interestadual),
    aliquota_icms: interestadual && (e.crt === 2 || e.crt === 3) && ["00", "20"].includes(String(i.cst_icms))
      ? aliquotaInterestadual(e.uf, dest.endereco.uf, i.origem) : i.aliquota_icms,
  }));
  let vFCPUFDest = 0, vICMSUFDest = 0;
  const grupoDifal = (item: ItemNota, base: number) => {
    if (!ufDestino || ["40", "41", "50"].includes(String(item.cst_icms))) return "";
    const pInter = aliquotaInterestadual(e.uf, dest.endereco.uf, item.origem);
    const c = calcularDifal(base, pInter, ufDestino);
    vFCPUFDest += c.vFCPUFDest; vICMSUFDest += c.vICMSUFDest;
    return tag("ICMSUFDest",
      tag("vBCUFDest", n2(c.vBC)) + (ufDestino.fcp > 0 ? tag("vBCFCPUFDest", n2(c.vBC)) + tag("pFCPUFDest", n4(ufDestino.fcp)) : "") +
      tag("pICMSUFDest", n4(ufDestino.interna)) + tag("pICMSInter", n2(pInter)) + tag("pICMSInterPart", "100.0000") +
      (ufDestino.fcp > 0 ? tag("vFCPUFDest", n2(c.vFCPUFDest)) : "") + tag("vICMSUFDest", n2(c.vICMSUFDest)) + tag("vICMSUFRemet", "0.00"));
  };
  const it = montarItens(itens, e.crt, null, grupoDifal);
  vFCPUFDest = arred(vFCPUFDest); vICMSUFDest = arred(vICMSUFDest);
  const z = "0.00";
  const vNF = arred(it.vProd - it.vDesc + it.vFrete);
  const totaisDifal = ufDestino ? tag("vFCPUFDest", n2(vFCPUFDest)) + tag("vICMSUFDest", n2(vICMSUFDest)) + tag("vICMSUFRemet", z) : "";
  const total = tag("total", tag("ICMSTot",
    tag("vBC", n2(arred(it.vBCTot))) + tag("vICMS", n2(arred(it.vICMSTot))) + tag("vICMSDeson", z) + totaisDifal + tag("vFCP", z) + tag("vBCST", z) + tag("vST", z) +
    tag("vFCPST", z) + tag("vFCPSTRet", z) + tag("vProd", n2(it.vProd)) + tag("vFrete", n2(it.vFrete)) + tag("vSeg", z) +
    tag("vDesc", n2(it.vDesc)) + tag("vII", z) + tag("vIPI", z) + tag("vIPIDevol", z) + tag("vPIS", n2(arred(it.vPISTot))) +
    tag("vCOFINS", n2(arred(it.vCOFINSTot))) + tag("vOutro", z) + tag("vNF", n2(vNF))));

  const v = d.frete.volumes;
  const vol = v && (v.quantidade || v.pesoBruto || v.pesoLiquido)
    ? tag("vol", (v.quantidade ? tag("qVol", String(Math.round(v.quantidade))) : "") + (v.especie ? tag("esp", txt(v.especie, 60)) : "") +
        (v.pesoLiquido ? tag("pesoL", Number(v.pesoLiquido).toFixed(3)) : "") + (v.pesoBruto ? tag("pesoB", Number(v.pesoBruto).toFixed(3)) : ""))
    : "";
  const transp = tag("transp", tag("modFrete", String(d.frete.modalidade)) + vol);

  // Sem pagamento (devolução, remessa): tPag 90 com valor zero
  const pags = d.pagamentos.length ? d.pagamentos : [{ forma: "sem_pagamento", valor: 0 }];
  const soma = arred(pags.reduce((s, p) => s + Number(p.valor), 0));
  if (d.pagamentos.length && soma < vNF) throw new Error(`Os pagamentos (${n2(soma)}) não cobrem o total da nota (${n2(vNF)}).`);
  const pag = tag("pag", pags.map((p) => {
    const t = p.forma === "sem_pagamento" ? "90" : (T_PAG[p.forma] ?? T_PAG_NFE[p.forma] ?? "99");
    return tag("detPag",
      tag("tPag", t) + (t === "99" ? tag("xPag", "Outros") : "") + tag("vPag", n2(Number(p.valor))) +
      (t === "03" || t === "04" ? tag("card", tag("tpIntegra", "2")) : ""));
  }).join("") + (soma > vNF ? tag("vTroco", n2(arred(soma - vNF))) : ""));

  const textoDifal = ufDestino
    ? `DIFAL (EC 87/2015) devido a ${dest.endereco.uf}: ICMS R$ ${n2(vICMSUFDest).replace(".", ",")}` +
      (vFCPUFDest > 0 ? `; FCP R$ ${n2(vFCPUFDest).replace(".", ",")}` : "") + "."
    : "";
  const complemento = [d.informacoes, textoDifal].filter(Boolean).join(" ");
  const infAdic = complemento ? tag("infAdic", tag("infCpl", txt(complemento, 2000))) : "";
  const rt = d.respTecnico && so(d.respTecnico.cnpj).length === 14
    ? tag("infRespTec", tag("CNPJ", so(d.respTecnico.cnpj)) + tag("xContato", txt(d.respTecnico.contato, 60)) +
        tag("email", txt(d.respTecnico.email, 60)) + tag("fone", so(d.respTecnico.fone)))
    : "";

  const corpo = tag("ide", ide) + tag("emit", emit) + destXml + it.dets + total + transp + pag + infAdic + rt;
  const infNFe = `<infNFe Id="NFe${chave}" versao="4.00">${corpo}</infNFe>`;
  return { chave, infNFe, vNF, vProd: it.vProd, vDesc: it.vDesc, vFrete: it.vFrete, vBC: arred(it.vBCTot), vICMS: arred(it.vICMSTot), vICMSUFDest, vFCPUFDest };
}

// Formas de pagamento além das do caixa
const T_PAG_NFE: Record<string, string> = { boleto: "15", transferencia: "18", deposito: "16", cheque: "02", credito_loja: "05" };
