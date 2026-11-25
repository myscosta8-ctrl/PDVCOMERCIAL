// Montagem do XML da NFC-e (modelo 65, layout 4.00).
// O XML é gerado já na forma canônica (sem espaços, tags vazias expandidas),
// o que permite calcular a assinatura sem biblioteca de canonicalização.

export const NS_NFE = "http://www.portalfiscal.inf.br/nfe";

export const UF_CODIGO: Record<string, string> = {
  RO: "11", AC: "12", AM: "13", RR: "14", PA: "15", AP: "16", TO: "17", MA: "21", PI: "22", CE: "23",
  RN: "24", PB: "25", PE: "26", AL: "27", SE: "28", BA: "29", MG: "31", ES: "32", RJ: "33", SP: "35",
  PR: "41", SC: "42", RS: "43", MS: "50", MT: "51", GO: "52", DF: "53",
};

export const TEXTO_HOMOLOGACAO_NFE = "NF-E EMITIDA EM AMBIENTE DE HOMOLOGACAO - SEM VALOR FISCAL";
export const TEXTO_HOMOLOGACAO = "NOTA FISCAL EMITIDA EM AMBIENTE DE HOMOLOGACAO - SEM VALOR FISCAL";

export interface Emitente {
  cnpj: string; ie: string; razao_social: string; nome_fantasia?: string | null; crt: number;
  uf: string; municipio_ibge: string;
  endereco: { logradouro: string; numero: string; bairro: string; municipio: string; cep: string; fone?: string };
}
export interface ItemNota {
  codigo: string; ean?: string | null; descricao: string; ncm: string; cest?: string | null; cfop: string;
  unidade: string; quantidade: number; valor_unitario: number; desconto: number;
  origem: number; csosn?: string | null; cst_icms?: string | null;
  aliquota_icms?: number | null; reducao_bc?: number | null; cbenef?: string | null;
  cst_pis?: string | null; aliquota_pis?: number | null; cst_cofins?: string | null; aliquota_cofins?: number | null;
  frete?: number; xPed?: string | null;
  cst_ibscbs?: string | null; cclasstrib?: string | null; reducao_ibscbs?: number | null;
}
export interface PagamentoNota { forma: string; valor: number; bandeira?: string | null; autorizacao?: string | null; credenciadora_cnpj?: string | null }
export interface DadosNota {
  emitente: Emitente; ambiente: 1 | 2; serie: number; numero: number; codigo_numerico: string;
  emissao: Date; itens: ItemNota[]; pagamentos: PagamentoNota[]; troco: number;
  cpf_cnpj_consumidor?: string | null; informacoes?: string | null;
  // Contingência off-line (tpEmis = 9): início da contingência e motivo, impressos no DANFE
  contingencia?: { inicio: Date; justificativa: string } | null;
  aliquotasIBSCBS?: Record<string, AliquotasIBSCBS> | null;
}

// ---------------------------------------------------------------- IBS e CBS (reforma tributária, LC 214/2025)
// Em 2026 o destaque é de teste: CBS 0,9%, IBS estadual 0,1% e municipal 0%, sem somar ao total da nota.
// Obrigatório para o regime normal (CRT 3) e o Simples com excesso de sublimite (CRT 2).
export interface AliquotasIBSCBS { uf: number; mun: number; cbs: number }
export const ALIQUOTAS_IBSCBS_PADRAO: Record<string, AliquotasIBSCBS> = { "2026": { uf: 0.1, mun: 0, cbs: 0.9 } };

export function aliquotasIBSCBS(crt: number, emissao: Date, ajustes?: Record<string, AliquotasIBSCBS> | null): AliquotasIBSCBS | null {
  if (crt !== 2 && crt !== 3) return null;
  const ano = dataHoraBrasilia(emissao).slice(0, 4);
  return ajustes?.[ano] ?? ALIQUOTAS_IBSCBS_PADRAO[ano] ?? null;
}

// CST com destaque (gIBSCBS) e CST só informativos (isenção, imunidade e não incidência)
const CST_IBSCBS_COM_VALOR = new Set(["000", "200"]);
const CST_IBSCBS_SEM_VALOR = new Set(["400", "410"]);

export function totalIBSCBS(t: { vBC: number; vIBSUF: number; vIBSMun: number; vCBS: number }) {
  const z = "0.00";
  const vIBS = arred(t.vIBSUF + t.vIBSMun);
  return tag("IBSCBSTot", tag("vBCIBSCBS", n2(arred(t.vBC))) +
    tag("gIBS", tag("gIBSUF", tag("vDif", z) + tag("vDevTrib", z) + tag("vIBSUF", n2(arred(t.vIBSUF)))) +
      tag("gIBSMun", tag("vDif", z) + tag("vDevTrib", z) + tag("vIBSMun", n2(arred(t.vIBSMun)))) +
      tag("vIBS", n2(vIBS)) + tag("vCredPres", z) + tag("vCredPresCondSus", z)) +
    tag("gCBS", tag("vDif", z) + tag("vDevTrib", z) + tag("vCBS", n2(arred(t.vCBS))) + tag("vCredPres", z) + tag("vCredPresCondSus", z)));
}

// Texto seguro para XML (forma canônica)
export function txt(v: unknown, max = 120): string {
  const s = String(v ?? "")
    .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g, "")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, max);
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}
export const so = (v: unknown) => String(v ?? "").replace(/\D/g, "");
export const n2 = (v: number) => v.toFixed(2);
export const n4 = (v: number) => v.toFixed(4);
const n10 = (v: number) => v.toFixed(10);
export const tag = (nome: string, valor: string) => `<${nome}>${valor}</${nome}>`;
export const arred = (v: number) => Math.round((v + Number.EPSILON) * 100) / 100;

export function digitoChave(chave43: string): number {
  let peso = 2, soma = 0;
  for (let i = chave43.length - 1; i >= 0; i--) {
    soma += Number(chave43[i]) * peso;
    peso = peso === 9 ? 2 : peso + 1;
  }
  const r = soma % 11;
  return r < 2 ? 0 : 11 - r;
}

// Data no formato AAAA-MM-DDThh:mm:ss-03:00 (horário de Brasília)
export function dataHoraBrasilia(d: Date): string {
  const local = new Date(d.getTime() - 3 * 3600 * 1000);
  return local.toISOString().slice(0, 19) + "-03:00";
}

export function montarChave(d: DadosNota, tpEmis = 1) {
  const cUF = UF_CODIGO[d.emitente.uf];
  if (!cUF) throw new Error("UF do emitente inválida");
  const aamm = dataHoraBrasilia(d.emissao).slice(2, 7).replace("-", "");
  const base = cUF + aamm + so(d.emitente.cnpj).padStart(14, "0") + "65" +
    String(d.serie).padStart(3, "0") + String(d.numero).padStart(9, "0") + String(tpEmis) +
    d.codigo_numerico.padStart(8, "0");
  if (base.length !== 43) throw new Error("Chave de acesso com tamanho inválido");
  const dv = digitoChave(base);
  return { chave: base + dv, dv, cUF };
}

// Cartão na maquininha (pagamento não integrado, tpIntegra 2): credenciadora, bandeira e autorização quando informados
export function grupoCartao(p: PagamentoNota) {
  const cnpj = so(p.credenciadora_cnpj);
  const band = /^(0[1-9]|1[0-9]|2[0-7]|99)$/.test(String(p.bandeira ?? "")) ? String(p.bandeira) : "";
  const aut = txt(p.autorizacao ?? "", 20).replace(/[^A-Za-z0-9]/g, "");
  return tag("card", tag("tpIntegra", "2") + (cnpj.length === 14 ? tag("CNPJ", cnpj) : "") + (band ? tag("tBand", band) : "") + (aut ? tag("cAut", aut) : ""));
}

// Código do meio de pagamento (tabela tPag)
export const T_PAG: Record<string, string> = { dinheiro: "01", credito: "03", debito: "04", crediario: "05", pix: "17", outro: "99" };

export function montarInfNFe(d: DadosNota) {
  const tpEmis = d.contingencia ? 9 : 1;
  const { chave, dv, cUF } = montarChave(d, tpEmis);
  if (d.contingencia && txt(d.contingencia.justificativa, 256).length < 15) throw new Error("Justificativa da contingência com menos de 15 letras.");
  const e = d.emitente;
  const homolog = d.ambiente === 2;

  const ide =
    tag("cUF", cUF) + tag("cNF", d.codigo_numerico.padStart(8, "0")) + tag("natOp", "VENDA") +
    tag("mod", "65") + tag("serie", String(d.serie)) + tag("nNF", String(d.numero)) +
    tag("dhEmi", dataHoraBrasilia(d.emissao)) + tag("tpNF", "1") + tag("idDest", "1") +
    tag("cMunFG", so(e.municipio_ibge)) + tag("tpImp", "4") + tag("tpEmis", String(tpEmis)) + tag("cDV", String(dv)) +
    tag("tpAmb", String(d.ambiente)) + tag("finNFe", "1") + tag("indFinal", "1") + tag("indPres", "1") +
    tag("procEmi", "0") + tag("verProc", "PDV Comercial 1.0") +
    (d.contingencia ? tag("dhCont", dataHoraBrasilia(d.contingencia.inicio)) + tag("xJust", txt(d.contingencia.justificativa, 256)) : "");

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

  let dest = "";
  const doc = so(d.cpf_cnpj_consumidor);
  if (doc.length === 11 || doc.length === 14) {
    dest = tag("dest",
      tag(doc.length === 11 ? "CPF" : "CNPJ", doc) +
      (homolog ? tag("xNome", TEXTO_HOMOLOGACAO) : "") +
      tag("indIEDest", "9"));
  }

  const it = montarItens(d.itens, e.crt, homolog ? TEXTO_HOMOLOGACAO : null, undefined, aliquotasIBSCBS(e.crt, d.emissao, d.aliquotasIBSCBS));
  let { vProd, vDesc } = it;
  const { dets, vBCTot, vICMSTot, vPISTot, vCOFINSTot } = it;

  vProd = arred(vProd); vDesc = arred(vDesc);
  const vNF = arred(vProd - vDesc);
  const z = "0.00";
  const total = tag("total", tag("ICMSTot",
    tag("vBC", n2(arred(vBCTot))) + tag("vICMS", n2(arred(vICMSTot))) + tag("vICMSDeson", z) + tag("vFCP", z) + tag("vBCST", z) + tag("vST", z) +
    tag("vFCPST", z) + tag("vFCPSTRet", z) + tag("vProd", n2(vProd)) + tag("vFrete", z) + tag("vSeg", z) +
    tag("vDesc", n2(vDesc)) + tag("vII", z) + tag("vIPI", z) + tag("vIPIDevol", z) + tag("vPIS", n2(arred(vPISTot))) +
    tag("vCOFINS", n2(arred(vCOFINSTot))) + tag("vOutro", z) + tag("vNF", n2(vNF))) + (it.ibscbs ? totalIBSCBS(it.ibscbs) : ""));

  const pag = tag("pag", d.pagamentos.map((p) => {
    const t = T_PAG[p.forma] ?? "99";
    return tag("detPag",
      tag("tPag", t) + (t === "99" ? tag("xPag", "Outros") : "") + tag("vPag", n2(p.valor)) +
      (t === "03" || t === "04" ? grupoCartao(p) : ""));
  }).join("") + (d.troco > 0 ? tag("vTroco", n2(d.troco)) : ""));

  const infAdic = d.informacoes ? tag("infAdic", tag("infCpl", txt(d.informacoes, 2000))) : "";

  const corpo = tag("ide", ide) + tag("emit", emit) + dest + dets + total +
    tag("transp", tag("modFrete", "9")) + pag + infAdic;

  // Atributos em ordem canônica: Id antes de versao
  const infNFe = `<infNFe Id="NFe${chave}" versao="4.00">${corpo}</infNFe>`;
  return { chave, infNFe, vNF, vProd, vDesc, documento: dest ? doc : null };
}

// Itens (det) com ICMS, PIS e COFINS; usado pela NFC-e (65) e pela NF-e (55).
// textoPrimeiro: na NFC-e de homologação, a descrição do 1º item é substituída pelo texto obrigatório.
// extra: grupos opcionais no fim de <imposto> (ex.: ICMSUFDest do DIFAL), recebe o item e a base (valor - desconto + frete)
// extra pode devolver { xml, deduzir }: valor a tirar da base do IBS/CBS (ex.: DIFAL)
// ibscbs: alíquotas do ano; quando informado, cada item leva o grupo IBSCBS.
export function montarItens(itens: ItemNota[], crt: number, textoPrimeiro: string | null = null,
  extra?: (it: ItemNota, base: number, i: number) => string | { xml: string; deduzir?: number },
  ibscbs?: AliquotasIBSCBS | null) {
  const e = { crt };
  let vProd = 0, vDesc = 0, vBCTot = 0, vICMSTot = 0, vPISTot = 0, vCOFINSTot = 0, vFreteTot = 0;
  const rt = { vBC: 0, vIBSUF: 0, vIBSMun: 0, vCBS: 0 };
  const dets = itens.map((it, i) => {
    const bruto = arred(it.quantidade * it.valor_unitario);
    const frete = arred(Number(it.frete || 0));
    vProd += bruto; vDesc += it.desconto; vFreteTot += frete;
    const gtin = /^\d{8}$|^\d{12,14}$/.test(it.ean ?? "") ? it.ean! : "SEM GTIN";
    const descricao = textoPrimeiro && i === 0 ? textoPrimeiro : txt(it.descricao, 120);
    const ncm = so(it.ncm);
    if (ncm.length !== 8) throw new Error(`NCM inválido no produto "${it.descricao}"`);
    const prod =
      tag("cProd", txt(it.codigo, 60)) + tag("cEAN", gtin) + tag("xProd", descricao) + tag("NCM", ncm) +
      (it.cest ? tag("CEST", so(it.cest)) : "") + (it.cbenef ? tag("cBenef", txt(it.cbenef, 10)) : "") + tag("CFOP", so(it.cfop)) + tag("uCom", txt(it.unidade, 6)) +
      tag("qCom", n4(it.quantidade)) + tag("vUnCom", n10(it.valor_unitario)) + tag("vProd", n2(bruto)) +
      tag("cEANTrib", gtin) + tag("uTrib", txt(it.unidade, 6)) + tag("qTrib", n4(it.quantidade)) +
      tag("vUnTrib", n10(it.valor_unitario)) + (frete > 0 ? tag("vFrete", n2(frete)) : "") + (it.desconto > 0 ? tag("vDesc", n2(it.desconto)) : "") +
      tag("indTot", "1") + (it.xPed ? tag("xPed", txt(it.xPed, 15)) : "");

    let icms: string;
    const icmsAntes = vICMSTot, pisAntes = vPISTot, cofinsAntes = vCOFINSTot;
    if (e.crt === 1 || e.crt === 4) {
      const csosn = it.csosn || "102";
      if (csosn === "900") {
        // Outros (ex.: devolução de compra): destaca o ICMS se houver alíquota
        const aliq = Number(it.aliquota_icms || 0);
        const vBC = aliq > 0 ? arred(bruto - it.desconto + frete) : 0;
        const vICMS = arred(vBC * aliq / 100);
        vBCTot += vBC; vICMSTot += vICMS;
        icms = tag("ICMSSN900", tag("orig", String(it.origem)) + tag("CSOSN", csosn) +
          (aliq > 0 ? tag("modBC", "3") + tag("vBC", n2(vBC)) + tag("pICMS", n4(aliq)) + tag("vICMS", n2(vICMS)) : ""));
      } else {
        if (!["102", "103", "300", "400", "500"].includes(csosn)) throw new Error(`CSOSN ${csosn} ainda não suportado`);
        const grupo = csosn === "500" ? "ICMSSN500" : "ICMSSN102";
        icms = tag(grupo, tag("orig", String(it.origem)) + tag("CSOSN", csosn));
      }
    } else {
      const cst = it.cst_icms || "41";
      if (cst === "00" || cst === "20") {
        const red = cst === "20" ? Number(it.reducao_bc || 0) : 0;
        const aliq = Number(it.aliquota_icms || 0);
        const vBC = arred((bruto - it.desconto + frete) * (1 - red / 100));
        const vICMS = arred(vBC * aliq / 100);
        vBCTot += vBC; vICMSTot += vICMS;
        icms = tag(`ICMS${cst}`, tag("orig", String(it.origem)) + tag("CST", cst) + tag("modBC", "3") +
          (cst === "20" ? tag("pRedBC", n4(red)) : "") + tag("vBC", n2(vBC)) + tag("pICMS", n4(aliq)) + tag("vICMS", n2(vICMS)));
      } else if (["40", "41", "50", "60"].includes(cst)) {
        icms = tag(cst === "60" ? "ICMS60" : "ICMS40", tag("orig", String(it.origem)) + tag("CST", cst));
      } else throw new Error(`CST ${cst} ainda não suportado`);
    }
    const contrib = (nome: "PIS" | "COFINS", cstInf?: string | null, aliqInf?: number | null) => {
      const cst = cstInf || "99";
      const aliq = Number(aliqInf || 0);
      const base = arred(bruto - it.desconto + frete);
      if (["04", "05", "06", "07", "08", "09"].includes(cst)) return tag(nome, tag(`${nome}NT`, tag("CST", cst)));
      const valor = arred(base * aliq / 100);
      if (nome === "PIS") vPISTot += valor; else vCOFINSTot += valor;
      const grupo = cst === "01" || cst === "02" ? `${nome}Aliq` : `${nome}Outr`;
      if (cst === "03") throw new Error(`CST ${cst} de ${nome} (por quantidade) ainda não suportado`);
      return tag(nome, tag(grupo, tag("CST", cst) + tag("vBC", n2(aliq > 0 || grupo.endsWith("Aliq") ? base : 0)) +
        tag(`p${nome}`, n4(aliq)) + tag(`v${nome}`, n2(valor))));
    };
    const pis = contrib("PIS", it.cst_pis, it.aliquota_pis);
    const cofins = contrib("COFINS", it.cst_cofins, it.aliquota_cofins);
    const r = extra ? extra(it, arred(bruto - it.desconto + frete), i) : "";
    const adicional = typeof r === "string" ? r : r.xml;
    const deduzir = typeof r === "string" ? 0 : Number(r.deduzir || 0);
    let ibs = "";
    if (ibscbs) {
      const cst = String(it.cst_ibscbs || "000");
      const ccl = String(it.cclasstrib || (cst === "000" ? "000001" : ""));
      if (!/^\d{3}$/.test(cst) || !/^\d{6}$/.test(ccl) || ccl.slice(0, 3) !== cst) {
        throw new Error(`IBS/CBS: CST ${cst} e classificação ${ccl || "(vazia)"} não combinam no produto "${it.descricao}".`);
      }
      if (CST_IBSCBS_SEM_VALOR.has(cst)) {
        ibs = tag("IBSCBS", tag("CST", cst) + tag("cClassTrib", ccl));
      } else if (CST_IBSCBS_COM_VALOR.has(cst)) {
        const red = cst === "200" ? Number(it.reducao_ibscbs || 0) : 0;
        if (cst === "200" && !(red > 0 && red <= 100)) throw new Error(`IBS/CBS: informe o percentual de redução do produto "${it.descricao}" (CST 200).`);
        // Base: valor da operação sem ICMS, PIS, COFINS e DIFAL (LC 214/2025, regra de transição)
        const vBC = Math.max(0, arred(bruto - it.desconto + frete - (vICMSTot - icmsAntes) - (vPISTot - pisAntes) - (vCOFINSTot - cofinsAntes) - deduzir));
        const grupo = (p: number, nomeP: string, nomeV: string) => {
          const ef = Math.round(p * (1 - red / 100) * 10000) / 10000;
          const v = arred(vBC * ef / 100);
          return { v, xml: tag(nomeP, n4(p)) + (red > 0 ? tag("gRed", tag("pRedAliq", n4(red)) + tag("pAliqEfet", n4(ef))) : "") + tag(nomeV, n2(v)) };
        };
        const uf = grupo(ibscbs.uf, "pIBSUF", "vIBSUF"), mun = grupo(ibscbs.mun, "pIBSMun", "vIBSMun"), cbs = grupo(ibscbs.cbs, "pCBS", "vCBS");
        rt.vBC += vBC; rt.vIBSUF += uf.v; rt.vIBSMun += mun.v; rt.vCBS += cbs.v;
        ibs = tag("IBSCBS", tag("CST", cst) + tag("cClassTrib", ccl) + tag("gIBSCBS", tag("vBC", n2(vBC)) +
          tag("gIBSUF", uf.xml) + tag("gIBSMun", mun.xml) + tag("vIBS", n2(arred(uf.v + mun.v))) + tag("gCBS", cbs.xml)));
      } else {
        throw new Error(`IBS/CBS: CST ${cst} ainda não suportado (produto "${it.descricao}"). Use 000, 200, 400 ou 410.`);
      }
    }
    return `<det nItem="${i + 1}">` + tag("prod", prod) + tag("imposto", tag("ICMS", icms) + pis + cofins + adicional + ibs) + `</det>`;
  }).join("");
  return { dets, vProd: arred(vProd), vDesc: arred(vDesc), vFrete: arred(vFreteTot), vBCTot, vICMSTot, vPISTot, vCOFINSTot,
    ibscbs: ibscbs ? { vBC: arred(rt.vBC), vIBSUF: arred(rt.vIBSUF), vIBSMun: arred(rt.vIBSMun), vCBS: arred(rt.vCBS) } : null };
}

// Distribui o desconto da venda entre os itens (proporcional; sobra no maior item)
export function ratearDesconto(itens: { bruto: number; desconto: number }[], descontoGeral: number): number[] {
  const base = itens.map((i) => arred(i.bruto - i.desconto));
  const soma = base.reduce((s, v) => s + v, 0);
  if (descontoGeral <= 0 || soma <= 0) return itens.map((i) => i.desconto);
  const partes = base.map((b) => Math.floor((descontoGeral * b / soma) * 100) / 100);
  let resto = arred(descontoGeral - partes.reduce((s, v) => s + v, 0));
  const maior = base.indexOf(Math.max(...base));
  partes[maior] = arred(partes[maior] + resto);
  return itens.map((i, k) => arred(i.desconto + partes[k]));
}

// QR Code versão 2 (emissão normal)
export async function montarQrCode(chave: string, ambiente: number, cscId: string, csc: string, urlBase: string) {
  const id = String(Number(cscId));
  const parametros = `${chave}|2|${ambiente}|${id}`;
  const dados = new TextEncoder().encode(parametros + csc);
  const hash = Array.from(new Uint8Array(await crypto.subtle.digest("SHA-1", dados)))
    .map((b) => b.toString(16).padStart(2, "0")).join("").toUpperCase();
  return `${urlBase}?p=${parametros}|${hash}`;
}

export function montarInfNFeSupl(qrCode: string, urlChave: string) {
  return `<infNFeSupl><qrCode><![CDATA[${qrCode}]]></qrCode><urlChave>${txt(urlChave, 85)}</urlChave></infNFeSupl>`;
}
